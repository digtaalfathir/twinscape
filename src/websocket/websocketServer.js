/**
 * WebSocket Server
 * Handles real-time client connections, upgrades from Express server
 */

const WebSocket = require("ws");
const { dateTimeLocal } = require("../utils/time");
const logger = require("../utils/logger");

let wss = null;

/**
 * Initialize WebSocket server attached to HTTP server with path
 */
function init(server, wsPath, monitor, verifyClient) {
  const opts = { server, path: wsPath };
  if (verifyClient) opts.verifyClient = verifyClient;   // auth: tolak WS tanpa sesi login
  wss = new WebSocket.Server(opts);

  // Inject broadcast function into monitor
  monitor.setBroadcast(broadcast);

  wss.on("connection", (ws, req) => {
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    logger.info(`WebSocket client connected from ${clientIp}`);

    // Send initial snapshot
    const snapshotPayload = {
      type: "snapshot",
      timestamp: dateTimeLocal(),
      ...monitor.buildFullPayload(),
    };
    ws.send(JSON.stringify(snapshotPayload));

    // Handle incoming commands
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "command") {
          monitor.handleDeviceCommand(msg, ws);
        }
      } catch (e) {
        logger.error(`Invalid WS message: ${e.message}`);
      }
    });

    ws.on("close", () => {
      logger.info(`WebSocket client disconnected from ${clientIp}`);
    });

    ws.on("error", (err) => {
      logger.error(`WebSocket error from ${clientIp}: ${err.message}`);
    });
  });

  logger.info(`WebSocket server initialized on path: ${wsPath}`);
}

/**
 * Broadcast data to all connected clients
 */
function broadcast(data) {
  if (!wss) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

/**
 * Get connected client count
 */
function getClientCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) count++;
  });
  return count;
}

module.exports = {
  init,
  broadcast,
  getClientCount,
};
