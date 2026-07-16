/**
 * File Store utility
 * Generic JSON file read/write with error handling
 */

const fs = require("fs");
const logger = require("./logger");

function readJSON(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    logger.error(`Failed to read ${filePath}: ${e.message}`);
  }
  return fallback;
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.error(`Failed to write ${filePath}: ${e.message}`);
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  readJSON,
  writeJSON,
  ensureDir,
};
