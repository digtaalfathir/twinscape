/**
 * Network Manager
 * Handles network-level state: latency values, downSince tracking, lastStatus
 */

const { dateTimeLocal } = require("../utils/time");
const logger = require("../utils/logger");

// Runtime state (in-memory)
const lastStatus = {};
const downSince = {};
const latency = {};

function getLastStatus() {
  return lastStatus;
}

function getDownSince() {
  return downSince;
}

function getLatency() {
  return latency;
}

function setLastStatus(name, status) {
  lastStatus[name] = status;
}

function setDownSince(name, since) {
  downSince[name] = since;
}

function clearDownSince(name) {
  delete downSince[name];
}

function setLatency(name, value) {
  latency[name] = value;
}

function restoreState(snapshot) {
  if (snapshot && snapshot.lastStatus) {
    Object.assign(lastStatus, snapshot.lastStatus);
    Object.assign(downSince, snapshot.downSince || {});
  }
}

function initDeviceStatus(devices) {
  devices.forEach((d) => {
    if (!lastStatus[d.name]) {
      lastStatus[d.name] = d.status || "UNKNOWN";
    }
  });
}

function migrateDeviceName(oldName, newName) {
  lastStatus[newName] = lastStatus[oldName] || "UNKNOWN";
  delete lastStatus[oldName];
  if (downSince[oldName]) {
    downSince[newName] = downSince[oldName];
    delete downSince[oldName];
  }
  if (latency[oldName] !== undefined) {
    latency[newName] = latency[oldName];
    delete latency[oldName];
  }
}

function deleteDevice(name) {
  delete lastStatus[name];
  delete downSince[name];
  delete latency[name];
}

/**
 * Calculate downtime duration text
 */
function calcDowntimeDuration(sinceStr) {
  if (!sinceStr) return "";
  try {
    const now = dateTimeLocal();
    const s = sinceStr.replace(" ", "T");
    const e = now.replace(" ", "T");
    const d1 = new Date(s);
    const d2 = new Date(e);
    const diffMs = d2 - d1;
    const sec = Math.floor(diffMs / 1000);
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    return ` (downtime: ${hh}h ${mm}m ${ss}s)`;
  } catch {
    return "";
  }
}

module.exports = {
  getLastStatus,
  getDownSince,
  getLatency,
  setLastStatus,
  setDownSince,
  clearDownSince,
  setLatency,
  restoreState,
  initDeviceStatus,
  migrateDeviceName,
  deleteDevice,
  calcDowntimeDuration,
};
