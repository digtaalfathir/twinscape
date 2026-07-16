/**
 * Device Manager
 * Handles CRUD operations for monitored devices
 */

const path = require("path");
const { readJSON, writeJSON } = require("../utils/fileStore");
const logger = require("../utils/logger");

const config = require("../../config.json");
const DEVICES_FILE = path.join(__dirname, "..", "..", config.dataDir || "data", "devices.json");

let devices = [];

function loadDevices() {
  const list = readJSON(DEVICES_FILE, []);
  devices = list.map((d) => ({
    name: d.name,
    ip: d.ip,
    severity: d.severity || "MEDIUM",
    status: "UNKNOWN",
    owner: d.owner || "",
    location: d.location || "",
    vendor: d.vendor || "",
    notes: d.notes || "",
  }));
  return devices;
}

function saveDevices() {
  const toSave = devices.map((d) => ({
    name: d.name,
    ip: d.ip,
    severity: d.severity,
    owner: d.owner || "",
    location: d.location || "",
    vendor: d.vendor || "",
    notes: d.notes || "",
  }));
  writeJSON(DEVICES_FILE, toSave);
  logger.appendLogLine(`DEVICES saved to ${DEVICES_FILE} (${devices.length} devices)`);
}

function getDevices() {
  return devices;
}

function findDevice(name) {
  return devices.find((d) => d.name === name);
}

function findDeviceIndex(name) {
  return devices.findIndex((d) => d.name === name);
}

function addDevice(data) {
  const { name, ip, severity, owner, location, vendor, notes } = data;
  if (!name || !ip) return { ok: false, message: "Name dan IP wajib diisi." };
  if (devices.find((d) => d.name === name)) return { ok: false, message: `Device '${name}' sudah ada.` };
  if (devices.find((d) => d.ip === ip)) return { ok: false, message: `IP '${ip}' sudah digunakan.` };

  const sev = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(severity) ? severity : "MEDIUM";
  devices.push({
    name,
    ip,
    severity: sev,
    status: "UNKNOWN",
    owner: owner || "",
    location: location || "",
    vendor: vendor || "",
    notes: notes || "",
  });
  saveDevices();
  logger.appendLogLine(`DEVICE ADDED: ${name} (${ip}) severity=${sev}`);
  return { ok: true, message: `Device '${name}' berhasil ditambahkan.` };
}

function editDevice(originalName, data, migrateCallback) {
  const { name, ip, severity, owner, location, vendor, notes } = data;
  const idx = findDeviceIndex(originalName);
  if (idx === -1) return { ok: false, message: `Device '${originalName}' tidak ditemukan.` };

  if (name !== originalName && devices.find((d) => d.name === name)) {
    return { ok: false, message: `Nama '${name}' sudah digunakan.` };
  }
  if (ip !== devices[idx].ip && devices.find((d) => d.ip === ip)) {
    return { ok: false, message: `IP '${ip}' sudah digunakan.` };
  }

  const sev = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(severity) ? severity : devices[idx].severity;

  // Migrate state if name changed
  if (name !== originalName && typeof migrateCallback === "function") {
    migrateCallback(originalName, name);
  }

  devices[idx].name = name;
  devices[idx].ip = ip;
  devices[idx].severity = sev;
  if (owner !== undefined) devices[idx].owner = owner;
  if (location !== undefined) devices[idx].location = location;
  if (vendor !== undefined) devices[idx].vendor = vendor;
  if (notes !== undefined) devices[idx].notes = notes;

  saveDevices();
  logger.appendLogLine(`DEVICE EDITED: ${originalName} -> ${name} (${ip}) severity=${sev}`);
  return { ok: true, message: `Device berhasil diupdate.` };
}

function deleteDevice(name) {
  const idx = findDeviceIndex(name);
  if (idx === -1) return { ok: false, message: `Device '${name}' tidak ditemukan.` };

  devices.splice(idx, 1);
  saveDevices();
  logger.appendLogLine(`DEVICE DELETED: ${name}`);
  return { ok: true, message: `Device '${name}' berhasil dihapus.` };
}

function updateNotes(name, data) {
  const idx = findDeviceIndex(name);
  if (idx === -1) return { ok: false, message: `Device '${name}' tidak ditemukan.` };

  if (data.owner !== undefined) devices[idx].owner = data.owner;
  if (data.location !== undefined) devices[idx].location = data.location;
  if (data.vendor !== undefined) devices[idx].vendor = data.vendor;
  if (data.notes !== undefined) devices[idx].notes = data.notes;

  saveDevices();
  logger.appendLogLine(`DEVICE NOTES UPDATED: ${name}`);
  return { ok: true, message: `Notes untuk '${name}' berhasil diupdate.` };
}

module.exports = {
  loadDevices,
  saveDevices,
  getDevices,
  findDevice,
  findDeviceIndex,
  addDevice,
  editDevice,
  deleteDevice,
  updateNotes,
};
