/**
 * API Routes
 * REST endpoints for device status, summary, and health checks
 */

const express = require("express");
const router = express.Router();

const deviceManager = require("../monitor/deviceManager");
const monitor = require("../monitor/monitor");
const websocketServer = require("../websocket/websocketServer");

const startTime = Date.now();

/**
 * GET /api/status
 * Returns full device status with all monitoring data
 */
router.get("/status", (req, res) => {
  const devices = deviceManager.getDevices();
  const payload = devices.map((dev) => monitor.buildDevicePayload(dev));
  res.json({
    timestamp: new Date().toISOString(),
    devices: payload,
  });
});

/**
 * GET /api/devices
 * Returns device list (name, ip, severity, metadata)
 */
router.get("/devices", (req, res) => {
  const devices = deviceManager.getDevices();
  res.json({
    total: devices.length,
    devices: devices.map((d) => ({
      name: d.name,
      ip: d.ip,
      severity: d.severity,
      status: d.status,
      owner: d.owner,
      location: d.location,
      vendor: d.vendor,
      notes: d.notes,
    })),
  });
});

/**
 * GET /api/summary
 * Returns health score summary
 */
router.get("/summary", (req, res) => {
  const summary = monitor.getHealthScore();
  res.json(summary);
});

/**
 * GET /health
 * Health check endpoint for monitoring the server itself
 */
router.get("/health", (req, res) => {
  // Note: this is mounted at /health, not /api/health
  // But we define it here for organizational convenience
});

module.exports = router;

/**
 * Health check handler (exported separately for mounting at /health)
 */
module.exports.healthCheck = (req, res) => {
  const devices = deviceManager.getDevices();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  res.json({
    status: "OK",
    uptime: uptimeSeconds,
    monitoredDevices: devices.length,
    connectedClients: websocketServer.getClientCount(),
  });
};
