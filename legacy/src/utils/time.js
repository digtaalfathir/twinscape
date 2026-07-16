/**
 * Time utility functions
 * Centralized timezone-aware date/time formatting
 */

const config = require("../../config.json");

const TIMEZONE = config.timezone || "Asia/Jakarta";

function nowDateObj() {
  return new Date();
}

function dateStrLocal(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function timeStrLocal(date = new Date()) {
  return date.toLocaleTimeString("en-GB", { timeZone: TIMEZONE });
}

function dateTimeLocal(date = new Date()) {
  return `${dateStrLocal(date)} ${timeStrLocal(date)}`;
}

module.exports = {
  nowDateObj,
  dateStrLocal,
  timeStrLocal,
  dateTimeLocal,
  TIMEZONE,
};
