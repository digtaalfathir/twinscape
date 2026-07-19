/**
 * Twinscape Agent — headless: mesin ping + WS producer (TANPA UI).
 * Sumber data untuk viewer Twinscape (dikonsumsi via WS `{devices,timestamp}`).
 * Pakai mesin yang SAMA dengan v1 (legacy/src) — cuma tanpa Express/static/UI.
 * Jalan sebagai PM2 app "twinscape-agent". Per-site (multi-lokasi) atau se-box dengan viewer.
 */
const path = require("path");
const http = require("http");

const config = require("./config.json");
const logger = require("./src/utils/logger");
const { ensureDir } = require("./src/utils/fileStore");
const monitor = require("./src/monitor/monitor");
const websocketServer = require("./src/websocket/websocketServer");
const auth = require("./src/auth");

const ROOT_DIR = __dirname;
ensureDir(path.join(ROOT_DIR, config.dataDir || "data"));
ensureDir(path.join(ROOT_DIR, config.logDir || "logs"));

const PORT = process.env.AGENT_PORT || config.webPort || 10101;   // port WS yang dikonsumsi viewer (lihat twinscape/locations.json)
const HOST = process.env.AGENT_HOST || undefined;                 // undefined = semua interface (via LAN/VPN); set 127.0.0.1 utk lokal saja
const wsPath = config.wsPath || "/ws";

// server http minimal — hanya /health; sisanya 404. (WS di-attach ke server ini.)
const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, ts: Date.now() })); }
  res.writeHead(404); res.end();
});

// connect WS TERBUKA (viewer/relay bisa konsumsi tanpa cookie); command tetap digerbang authFn.
websocketServer.init(server, wsPath, monitor, (req) => auth.wsAuthOK(req));
monitor.start();

server.listen(PORT, HOST, () => {
  logger.info("========================================");
  logger.info("  Twinscape Agent — ping + WS producer (headless)");
  logger.info(`  WS    : ws://${HOST || "0.0.0.0"}:${PORT}${wsPath}`);
  logger.info(`  Health: http://${HOST || "0.0.0.0"}:${PORT}/health`);
  logger.info("========================================");
});

function bye(sig) {
  logger.info(`Agent: terima ${sig}, matikan…`);
  try { monitor.shutdown(); } catch (e) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGINT", () => bye("SIGINT"));
process.on("SIGTERM", () => bye("SIGTERM"));
