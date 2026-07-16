/**
 * Logger utility
 * Writes daily log files with timestamp prefixes
 */

const fs = require("fs");
const path = require("path");
const { dateStrLocal, dateTimeLocal } = require("./time");

const config = require("../../config.json");
const LOG_DIR = path.join(__dirname, "..", "..", config.logDir || "logs");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFilePathFor(date = new Date()) {
  const fname = `${dateStrLocal(date)}.log`;
  return path.join(LOG_DIR, fname);
}

function appendLogLine(line, date = new Date()) {
  const file = logFilePathFor(date);
  const final = `[${dateTimeLocal(date)}] ${line}\n`;
  fs.appendFile(file, final, (err) => {
    if (err) console.error("Failed to write log:", err);
  });
}

function info(message) {
  const now = new Date();
  console.log(`[${dateTimeLocal(now)}] ${message}`);
  appendLogLine(message, now);
}

function error(message) {
  const now = new Date();
  console.error(`[${dateTimeLocal(now)}] ERROR: ${message}`);
  appendLogLine(`ERROR: ${message}`, now);
}

function warn(message) {
  const now = new Date();
  console.warn(`[${dateTimeLocal(now)}] WARN: ${message}`);
  appendLogLine(`WARN: ${message}`, now);
}

module.exports = {
  LOG_DIR,
  appendLogLine,
  info,
  error,
  warn,
};
