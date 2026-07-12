/**
 * v2 — MONITORING (Viewer 3D/2D) — SERVER SENDIRI, config per-lokasi.
 *
 * Konsep BEDA dari v1: v2 TIDAK meng-ping device. Ia KONSUMEN — menerima data
 * dari WS server yang MEMANG SUDAH RUNNING (format sama: { devices, timestamp }).
 * Tiap "tempat" bisa punya sumber WS sendiri (IP:port beda/sama) → didefinisikan
 * di v2/locations.json. Server ini mem-PROXY /ws?loc=<id> ke sumber tempat itu.
 *
 *   npm run v2                 → http://localhost:10102
 *   V2_PORT=xxxx               → ganti port
 *   MONITOR_WS=ws://host/ws     → fallback sumber default (kalau locations.json tak ada)
 *
 * API: GET /api/locations → daftar tempat (id, name, scene3d, layout2d) untuk
 * pemilih lokasi (multi-tempat, Fase D). WS URL upstream disimpan server-side.
 */

const path = require("path");
const http = require("http");
const fs = require("fs");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.V2_PORT || 10102;

// ---- daftar lokasi (sumber WS per tempat) ----
function loadLocations() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, "locations.json"), "utf8"));
    if (Array.isArray(j.locations) && j.locations.length) return j.locations;
  } catch { /* pakai fallback di bawah */ }
  return [{ id: "default", name: "Default", ws: process.env.MONITOR_WS || "ws://localhost:10101/ws", scene3d: "/scene.json", layout2d: "/layout2d.json" }];
}
let LOCATIONS = loadLocations();
const findLoc = (id) => LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];

const app = express();
// daftar tempat untuk frontend (URL WS upstream TIDAK diekspos)
app.get("/api/locations", (_req, res) => {
  res.json({ locations: LOCATIONS.map((l) => ({ id: l.id, name: l.name, scene3d: l.scene3d || "/scene.json", layout2d: l.layout2d || "/layout2d.json" })) });
});
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

// ---- WS proxy: /ws?loc=<id> → WS server tempat itu (yang sudah running) ----
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (client, req) => {
  let loc;
  try { loc = findLoc(new URL(req.url, "http://x").searchParams.get("loc")); }
  catch { loc = LOCATIONS[0]; }
  const upstream = new WebSocket(loc.ws);
  const closeBoth = () => { try { client.close(); } catch {} try { upstream.close(); } catch {} };
  upstream.on("message", (d) => { if (client.readyState === WebSocket.OPEN) client.send(d.toString()); });
  client.on("message", (d) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(d.toString()); });
  upstream.on("close", closeBoth);
  client.on("close", closeBoth);
  upstream.on("error", (e) => { console.warn(`[v2] WS upstream (${loc.id}) error:`, e.message); closeBoth(); });
  client.on("error", closeBoth);
});

server.listen(PORT, () => {
  console.log("========================================");
  console.log("  v2 MONITORING — viewer (konsumen WS eksternal)");
  console.log(`  App     : http://localhost:${PORT}`);
  LOCATIONS.forEach((l) => console.log(`  Lokasi  : ${l.id}  ←  ${l.ws}`));
  console.log(`  WS proxy: /ws?loc=<id>   (default: ${LOCATIONS[0].id})`);
  console.log("========================================");
});
