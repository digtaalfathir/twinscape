/**
 * PM2 — topologi Twinscape: viewer + agent.
 *   twinscape        → web viewer 3D/2D (konsumsi WS), twinscape/server.js
 *   twinscape-agent  → mesin ping + WS producer (headless), legacy/agent.js
 *
 * Se-box (all-in-one)  : pm2 start ecosystem.config.js            (dua-duanya)
 * Pusat multi-site     : pm2 start ecosystem.config.js --only twinscape
 * Tiap site (probe)    : pm2 start ecosystem.config.js --only twinscape-agent
 */
const path = require("path");
module.exports = {
  apps: [
    {
      name: "twinscape",
      script: "server.js",
      cwd: path.join(__dirname, "twinscape"),
      autorestart: true, max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
      error_file: path.join(__dirname, "twinscape/logs/tw-error.log"),
      out_file: path.join(__dirname, "twinscape/logs/tw-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "twinscape-agent",
      script: "agent.js",
      cwd: path.join(__dirname, "legacy"),
      autorestart: true, max_memory_restart: "300M",
      env: { NODE_ENV: "production" /*, AGENT_PORT: "10101" */ },
      error_file: path.join(__dirname, "legacy/logs/agent-error.log"),
      out_file: path.join(__dirname, "legacy/logs/agent-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
