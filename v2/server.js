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
 *   V2_HOST=127.0.0.1          → bind ke host tertentu (mis. di belakang nginx). default: semua interface
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
const auth = require("./auth");

const PORT = process.env.V2_PORT || 10102;
const HOST = process.env.V2_HOST || undefined;   // undefined = semua interface; set 127.0.0.1 di belakang nginx

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

// ---- cek kesehatan tiap lokasi (untuk tanda "offline" di dropdown) ----
// Coba connect ke WS tiap lokasi secara berkala; catat up/down. Ringan: connect → cek → tutup.
const healthById = {};                 // id -> "up" | "down"
function probe(loc) {
  return new Promise((resolve) => {
    let ws, done = false;
    const finish = (s) => { if (done) return; done = true; try { ws && ws.terminate(); } catch {} resolve(s); };
    try { ws = new WebSocket(loc.ws); } catch { return resolve("down"); }
    const t = setTimeout(() => finish("down"), 5000);   // tak connect dalam 5s = down
    ws.on("open", () => { clearTimeout(t); finish("up"); });
    ws.on("error", () => { clearTimeout(t); finish("down"); });
  });
}
async function runHealthChecks() {
  await Promise.all(LOCATIONS.map(async (l) => { healthById[l.id] = await probe(l); }));
}

const app = express();
app.set("trust proxy", 1);          // hormati X-Forwarded-Proto dari nginx (utk cookie Secure)
app.use(express.json());

// ---- LOGIN (publik — tak butuh sesi) ----
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
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

// ---- mulai sini WAJIB login ----
app.use(auth.middleware);

// daftar tempat untuk frontend (URL WS upstream TIDAK diekspos)
app.get("/api/locations", (_req, res) => {
  res.json({
    locations: LOCATIONS.map((l) => ({
      id: l.id, name: l.name,
      scene3d: l.scene3d || "/scene.json", layout2d: l.layout2d || "/layout2d.json",
      // E5: lantai (opsional) — file per lantai, WS upstream tetap TIDAK diekspos
      floors: Array.isArray(l.floors) ? l.floors.map((f) => ({ id: f.id, name: f.name, scene3d: f.scene3d, layout2d: f.layout2d })) : undefined,
    })),
  });
});
// status koneksi per lokasi (up/down) untuk tanda di dropdown
app.get("/api/health", (_req, res) => res.json({ statuses: healthById }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

// ---- WS proxy: /ws?loc=<id> → WS server tempat itu (yang sudah running). Butuh sesi login. ----
const wss = new WebSocketServer({
  server, path: "/ws",
  verifyClient: (info, cb) => (auth.userFromReq(info.req) ? cb(true) : cb(false, 401, "Unauthorized")),
});
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

server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("  Stechoq Pulse (v2) — viewer monitoring (konsumen WS eksternal)");
  console.log(`  App     : http://${HOST || "localhost"}:${PORT}`);
  LOCATIONS.forEach((l) => console.log(`  Lokasi  : ${l.id}  ←  ${l.ws}`));
  console.log(`  WS proxy: /ws?loc=<id>   (default: ${LOCATIONS[0].id})`);
  console.log("========================================");
  runHealthChecks();                       // cek awal + tiap 20s
  setInterval(runHealthChecks, 20000).unref();
});
