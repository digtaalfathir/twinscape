/**
 * Stats Manager
 * Manages daily uptime/downtime statistics, latency tracking, and snapshots
 */

const path = require("path");
const { readJSON, writeJSON } = require("../utils/fileStore");
const { dateStrLocal } = require("../utils/time");

const config = require("../../config.json");
const DATA_DIR = path.join(__dirname, "..", "..", config.dataDir || "data");

const DAILY_STATS_FILE = path.join(DATA_DIR, "daily_stats.json");
const SNAPSHOT_FILE = path.join(DATA_DIR, "status_snapshot.json");

const INTERVAL_SEC = (config.monitorInterval || 3000) / 1000;
const LATENCY_WINDOW_SIZE = config.latencyWindowSize || 20;

// ================= DAILY STATS =================
let dailyStats = {};

function loadDailyStats() {
  dailyStats = readJSON(DAILY_STATS_FILE, {});
  return dailyStats;
}

function saveDailyStats() {
  writeJSON(DAILY_STATS_FILE, dailyStats);
}

function checkDailyReset() {
  const today = dateStrLocal();
  if (dailyStats.date && dailyStats.date !== today) {
    const logger = require("../utils/logger");
    logger.appendLogLine(`DAILY RESET: statistik hari ${dailyStats.date} direset untuk hari baru ${today}`);
    dailyStats = { date: today, devices: {} };
    saveDailyStats();
  }
  if (!dailyStats.date) {
    dailyStats.date = today;
    dailyStats.devices = dailyStats.devices || {};
  }
}

function updateAvailability(deviceName, status) {
  checkDailyReset();
  if (!dailyStats.devices[deviceName]) {
    dailyStats.devices[deviceName] = { upSeconds: 0, downSeconds: 0 };
  }
  const d = dailyStats.devices[deviceName];
  if (status === "UP") {
    d.upSeconds += INTERVAL_SEC;
  } else if (status === "DOWN") {
    d.downSeconds += INTERVAL_SEC;
  }
  saveDailyStats();
}

function getAvailability(deviceName) {
  checkDailyReset();
  const d = dailyStats.devices && dailyStats.devices[deviceName];
  if (!d || d.upSeconds + d.downSeconds === 0) {
    return { uptimeToday: 100, downtimeTodaySec: 0 };
  }
  const total = d.upSeconds + d.downSeconds;
  const uptimeToday = parseFloat(((d.upSeconds / total) * 100).toFixed(2));
  return { uptimeToday, downtimeTodaySec: d.downSeconds };
}

function getDailyStats() {
  return dailyStats;
}

// ================= LATENCY STATS (rolling window) =================
const latencyHistory = {};

function updateLatencyStats(deviceName, latMs) {
  if (!latencyHistory[deviceName]) {
    latencyHistory[deviceName] = [];
  }
  if (latMs !== null && latMs !== undefined && !isNaN(latMs)) {
    latencyHistory[deviceName].push(latMs);
    if (latencyHistory[deviceName].length > LATENCY_WINDOW_SIZE) {
      latencyHistory[deviceName] = latencyHistory[deviceName].slice(-LATENCY_WINDOW_SIZE);
    }
  }
}

function getLatencyStats(deviceName) {
  const samples = latencyHistory[deviceName] || [];
  if (samples.length === 0) {
    return { avgLatency: null, maxLatency: null };
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / samples.length);
  const max = Math.max(...samples);
  return { avgLatency: avg, maxLatency: max };
}

function getLatencyHistory() {
  return latencyHistory;
}

// ================= SNAPSHOT =================
function saveSnapshot(data) {
  writeJSON(SNAPSHOT_FILE, data);
}

function loadSnapshot() {
  return readJSON(SNAPSHOT_FILE, null);
}

// ================= MIGRATION =================
function migrateDeviceName(oldName, newName) {
  // Latency history
  if (latencyHistory[oldName]) {
    latencyHistory[newName] = latencyHistory[oldName];
    delete latencyHistory[oldName];
  }
  // Daily stats
  if (dailyStats.devices && dailyStats.devices[oldName]) {
    dailyStats.devices[newName] = dailyStats.devices[oldName];
    delete dailyStats.devices[oldName];
    saveDailyStats();
  }
}

function deleteDevice(name) {
  delete latencyHistory[name];
  if (dailyStats.devices) {
    delete dailyStats.devices[name];
    saveDailyStats();
  }
}

module.exports = {
  loadDailyStats,
  saveDailyStats,
  updateAvailability,
  getAvailability,
  getDailyStats,
  updateLatencyStats,
  getLatencyStats,
  getLatencyHistory,
  saveSnapshot,
  loadSnapshot,
  migrateDeviceName,
  deleteDevice,
};
