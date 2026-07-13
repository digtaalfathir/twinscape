/**
 * Hardware Monitoring System — Main Application
 *
 * Express server serving:
 *   - Static frontend from /public
 *   - REST API at /api/*
 *   - Health check at /health
 *   - WebSocket at /ws (configurable)
 *   - Monitoring engine running in background
 *
 * Designed for PM2 deployment behind Nginx reverse proxy.
 */

const path = require("path");
const express = require("express");
const http = require("http");

const config = require("../config.json");
const logger = require("./utils/logger");
const { ensureDir } = require("./utils/fileStore");

const monitor = require("./monitor/monitor");
const websocketServer = require("./websocket/websocketServer");
const apiRoutes = require("./routes/api");

// ================= ENSURE DIRECTORIES =================
const ROOT_DIR = path.join(__dirname, "..");
ensureDir(path.join(ROOT_DIR, config.dataDir || "data"));
ensureDir(path.join(ROOT_DIR, config.logDir || "logs"));

// ================= EXPRESS APP =================
const app = express();
const server = http.createServer(app);

// JSON body parsing for potential future POST endpoints
app.use(express.json());
app.set("trust proxy", 1);   // hormati X-Forwarded-Proto (cookie Secure di belakang proxy)

const publicDir = path.join(ROOT_DIR, config.publicDir || "public");

// ================= AUTH: login (publik) =================
const auth = require("./auth");
app.get("/login", (_req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.loadUsers().find((u) => u.username === username);
  if (!user || !auth.verifyPassword(password || "", user)) return res.status(401).json({ error: "Username atau password salah." });
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${auth.COOKIE}=${auth.makeToken(username)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${auth.MAXAGE}${secure}`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${auth.COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// mulai sini WAJIB login (kecuali /login, /api/login, /api/logout, /health)
app.use(auth.middleware);

// ================= STATIC FILES (Frontend) =================
app.use(express.static(publicDir));

// ================= API ROUTES =================
app.use("/api", apiRoutes);

// ================= HEALTH CHECK =================
app.get("/health", apiRoutes.healthCheck);

// ================= SPA FALLBACK =================
// Serve dashboard.html for root and any unmatched routes
app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "dashboard.html"));
});

// ================= WEBSOCKET =================
const wsPath = config.wsPath || "/ws";
websocketServer.init(server, wsPath, monitor, (info, cb) =>
  auth.userFromReq(info.req) ? cb(true) : cb(false, 401, "Unauthorized"));

// ================= START MONITORING ENGINE =================
monitor.start();

// ================= START SERVER =================
const PORT = config.webPort || 3000;
server.listen(PORT, () => {
  logger.info(`========================================`);
  logger.info(`  Hardware Monitoring System v2.0.0`);
  logger.info(`  HTTP  : http://localhost:${PORT}`);
  logger.info(`  WS    : ws://localhost:${PORT}${wsPath}`);
  logger.info(`  API   : http://localhost:${PORT}/api/status`);
  logger.info(`  Health: http://localhost:${PORT}/health`);
  logger.info(`========================================`);
});

// ================= GRACEFUL SHUTDOWN =================
function gracefulExit(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  monitor.shutdown();
  server.close(() => {
    logger.info("HTTP server closed.");
    process.exit(0);
  });
  // Force exit after 5 seconds if server.close hangs
  setTimeout(() => {
    logger.warn("Forced shutdown after timeout.");
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", () => gracefulExit("SIGINT"));
process.on("SIGTERM", () => gracefulExit("SIGTERM"));
