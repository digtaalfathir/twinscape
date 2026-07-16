/**
 * History Manager
 * Manages 24-hour event history per device
 */

const path = require("path");
const { readJSON, writeJSON } = require("../utils/fileStore");
const { dateTimeLocal } = require("../utils/time");

const config = require("../../config.json");
const HISTORY_FILE = path.join(__dirname, "..", "..", config.dataDir || "data", "history.json");
const HISTORY_MAX_AGE_MS = config.historyMaxAgeMs || 24 * 60 * 60 * 1000;

let history = {};

function loadHistory() {
  history = readJSON(HISTORY_FILE, {});
  return history;
}

function saveHistory() {
  writeJSON(HISTORY_FILE, history);
}

function pruneOldHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  for (const deviceName of Object.keys(history)) {
    history[deviceName] = (history[deviceName] || []).filter((entry) => {
      try {
        const ts = entry.timestamp.replace(" ", "T");
        return new Date(ts).getTime() >= cutoff;
      } catch {
        return false;
      }
    });
  }
}

function updateHistory(deviceName, newStatus) {
  if (!history[deviceName]) {
    history[deviceName] = [];
  }
  history[deviceName].push({
    timestamp: dateTimeLocal(),
    status: newStatus,
  });
  pruneOldHistory();
  saveHistory();
}

function getHistory(deviceName) {
  return history[deviceName] || [];
}

function getAllHistory() {
  return history;
}

function migrateDeviceName(oldName, newName) {
  if (history[oldName]) {
    history[newName] = history[oldName];
    delete history[oldName];
    saveHistory();
  }
}

function deleteDevice(name) {
  delete history[name];
  saveHistory();
}

module.exports = {
  loadHistory,
  saveHistory,
  updateHistory,
  getHistory,
  getAllHistory,
  migrateDeviceName,
  deleteDevice,
};
