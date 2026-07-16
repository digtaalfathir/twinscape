/**
 * Monitor Engine
 * Core monitoring loop — pings all devices, updates state, broadcasts via WebSocket
 */

const ping = require("ping");
const config = require("../../config.json");
const { dateTimeLocal } = require("../utils/time");
const logger = require("../utils/logger");

const deviceManager = require("./deviceManager");
const historyManager = require("./historyManager");
const statsManager = require("./statsManager");
const networkManager = require("./networkManager");

const INTERVAL_MS = config.monitorInterval || 3000;
const PING_TIMEOUT = config.pingTimeout || 1;

// Console color codes
const color = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  reset: "\x1b[0m",
};

let broadcastFn = null;
let monitorTimer = null;

/**
 * Set broadcast function (injected from websocketServer)
 */
function setBroadcast(fn) {
  broadcastFn = fn;
}

/**
 * Build device payload for a single device
 */
function buildDevicePayload(dev) {
  const avail = statsManager.getAvailability(dev.name);
  const latStats = statsManager.getLatencyStats(dev.name);
  const lat = networkManager.getLatency();
  const ds = networkManager.getDownSince();

  return {
    name: dev.name,
    ip: dev.ip,
    status: dev.status,
    latency: lat[dev.name] !== undefined ? lat[dev.name] : null,
    avgLatency: latStats.avgLatency,
    maxLatency: latStats.maxLatency,
    severity: dev.severity,
    downSince: ds[dev.name] || null,
    uptimeToday: avail.uptimeToday,
    downtimeTodaySec: avail.downtimeTodaySec,
    history: historyManager.getHistory(dev.name),
    owner: dev.owner || "",
    location: dev.location || "",
    vendor: dev.vendor || "",
    notes: dev.notes || "",
  };
}

/**
 * Build full update payload
 */
function buildFullPayload() {
  const devices = deviceManager.getDevices();
  return {
    type: "update",
    timestamp: dateTimeLocal(),
    devices: devices.map((dev) => buildDevicePayload(dev)),
  };
}

/**
 * Get health score
 */
function getHealthScore() {
  const devices = deviceManager.getDevices();
  const total = devices.length;
  if (total === 0) return { totalDevices: 0, upDevices: 0, downDevices: 0, healthScore: 100 };

  const upDevices = devices.filter((d) => d.status === "UP").length;
  const downDevices = devices.filter((d) => d.status === "DOWN").length;
  const healthScore = parseFloat(((upDevices / total) * 100).toFixed(1));

  return { totalDevices: total, upDevices, downDevices, healthScore };
}

/**
 * Broadcast full update to all clients
 */
function broadcastFullUpdate() {
  if (broadcastFn) {
    broadcastFn(buildFullPayload());
  }
}

/**
 * Handle device CRUD commands from WebSocket
 */
function handleDeviceCommand(msg, ws) {
  const reply = (ok, message, extra) => {
    const data = JSON.stringify({ type: "cmd_result", ok, message, ...extra });
    ws.send(data);
  };

  // Migration callback — moves state when device name changes
  const migrateCallback = (oldName, newName) => {
    networkManager.migrateDeviceName(oldName, newName);
    statsManager.migrateDeviceName(oldName, newName);
    historyManager.migrateDeviceName(oldName, newName);
  };

  let result;

  switch (msg.action) {
    case "add_device":
      result = deviceManager.addDevice(msg);
      if (result.ok) {
        networkManager.setLastStatus(msg.name, "UNKNOWN");
      }
      reply(result.ok, result.message);
      if (result.ok) broadcastFullUpdate();
      break;

    case "edit_device":
      result = deviceManager.editDevice(msg.originalName, msg, migrateCallback);
      reply(result.ok, result.message);
      if (result.ok) broadcastFullUpdate();
      break;

    case "delete_device":
      result = deviceManager.deleteDevice(msg.name);
      if (result.ok) {
        networkManager.deleteDevice(msg.name);
        statsManager.deleteDevice(msg.name);
        historyManager.deleteDevice(msg.name);
      }
      reply(result.ok, result.message);
      if (result.ok) broadcastFullUpdate();
      break;

    case "update_notes":
      result = deviceManager.updateNotes(msg.name, msg);
      reply(result.ok, result.message);
      if (result.ok) broadcastFullUpdate();
      break;

    default:
      reply(false, `Action '${msg.action}' tidak dikenal.`);
  }
}

/**
 * Console table helpers
 */
function tableLine(widths) {
  let out = "+";
  widths.forEach((w) => (out += "-".repeat(w + 2) + "+"));
  return out;
}

function tableRow(cols, widths) {
  let out = "|";
  cols.forEach((c, i) => {
    out += " " + c.toString().padEnd(widths[i]) + " |";
  });
  return out;
}

/**
 * Main check cycle — ping all devices and update state
 */
async function checkAll() {
  const devices = deviceManager.getDevices();

  // Ping all devices
  const pingTasks = devices.map((dev) =>
    ping.promise
      .probe(dev.ip, { timeout: PING_TIMEOUT })
      .then((res) => ({
        dev,
        alive: res.alive,
        time: res.alive ? parseFloat(res.time) : null,
      }))
      .catch(() => ({ dev, alive: false, time: null }))
  );

  const results = await Promise.all(pingTasks);
  const lastSt = networkManager.getLastStatus();
  const ds = networkManager.getDownSince();

  // Update status
  results.forEach((r) => {
    const dev = r.dev;
    const alive = r.alive;
    const newStatus = alive ? "UP" : "DOWN";
    const prev = lastSt[dev.name] || "UNKNOWN";

    // Update latency
    const latMs = alive && r.time !== null && !isNaN(r.time) ? Math.round(r.time) : null;
    networkManager.setLatency(dev.name, latMs);
    statsManager.updateLatencyStats(dev.name, latMs);
    statsManager.updateAvailability(dev.name, newStatus);

    // Status changed
    if (prev !== newStatus) {
      if (newStatus === "DOWN") {
        const since = dateTimeLocal();
        networkManager.setDownSince(dev.name, since);
        logger.appendLogLine(`ALERT: ${dev.name} (${dev.ip}) -> DOWN (started at ${since})`);
      } else if (newStatus === "UP") {
        const since = ds[dev.name];
        const durText = networkManager.calcDowntimeDuration(since);
        const now = dateTimeLocal();
        logger.appendLogLine(`INFO: ${dev.name} (${dev.ip}) -> UP at ${now}${durText}`);
        networkManager.clearDownSince(dev.name);
      } else {
        logger.appendLogLine(`INFO: ${dev.name} (${dev.ip}) -> ${newStatus}`);
      }

      networkManager.setLastStatus(dev.name, newStatus);
      historyManager.updateHistory(dev.name, newStatus);
    }

    dev.status = newStatus;
  });

  // Save snapshot
  statsManager.saveSnapshot({
    lastStatus: networkManager.getLastStatus(),
    downSince: networkManager.getDownSince(),
  });

  // Broadcast to WebSocket clients
  broadcastFullUpdate();

  // Console output
  const widths = [26, 15, 8, 10, 10];
  console.clear();
  console.log(`${color.cyan}=== DEVICE STATUS MONITORING ===${color.reset}`);
  console.log("Last update:", dateTimeLocal());
  console.log("");
  console.log(tableLine(widths));
  console.log(tableRow(["DEVICE", "IP ADDRESS", "STATUS", "LATENCY", "SEVERITY"], widths));
  console.log(tableLine(widths));

  devices.forEach((d) => {
    const statusColor = d.status === "UP" ? color.green : color.red;
    const statusStr = `${statusColor}${d.status}${color.reset}`;
    const latMs = networkManager.getLatency()[d.name];
    const latStr = latMs !== null && latMs !== undefined ? `${latMs} ms` : "-";
    const sevStr = d.severity || "-";

    console.log(tableRow([d.name, d.ip, statusStr, latStr, sevStr], widths));

    if (d.status === "DOWN" && ds[d.name]) {
      console.log("  " + color.yellow + `down since: ${ds[d.name]}` + color.reset);
    }

    const avail = statsManager.getAvailability(d.name);
    if (avail.downtimeTodaySec > 0) {
      console.log(
        "  " +
          color.magenta +
          `availability: ${avail.uptimeToday}% | downtime: ${avail.downtimeTodaySec}s` +
          color.reset
      );
    }
  });

  console.log(tableLine(widths));
}

/**
 * Initialize and start the monitoring engine
 */
function start() {
  // Load persisted data
  deviceManager.loadDevices();
  historyManager.loadHistory();
  statsManager.loadDailyStats();

  const devices = deviceManager.getDevices();
  const snapshot = statsManager.loadSnapshot();

  // Restore state from snapshot
  if (snapshot) {
    networkManager.restoreState(snapshot);
  } else {
    networkManager.initDeviceStatus(devices);
  }

  // Start monitoring loop
  monitorTimer = setInterval(checkAll, INTERVAL_MS);
  checkAll();

  logger.info(`Monitor engine started — ${devices.length} devices, interval: ${INTERVAL_MS}ms`);
}

/**
 * Graceful shutdown — save all data
 */
function shutdown() {
  console.log("\nShutting down... saving all data.");
  if (monitorTimer) clearInterval(monitorTimer);

  statsManager.saveSnapshot({
    lastStatus: networkManager.getLastStatus(),
    downSince: networkManager.getDownSince(),
  });
  statsManager.saveDailyStats();
  historyManager.saveHistory();

  logger.info("Monitor engine stopped gracefully.");
}

module.exports = {
  start,
  shutdown,
  setBroadcast,
  buildDevicePayload,
  buildFullPayload,
  getHealthScore,
  broadcastFullUpdate,
  handleDeviceCommand,
};
