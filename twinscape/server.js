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

// ---- koneksi upstream PERSISTEN per lokasi ----
// Satu koneksi ke WS tiap lokasi (bukan per-klien). Payload terakhir DI-CACHE, jadi
// klien baru / pindah lokasi langsung dapat data (tak nunggu push berikutnya).
// Status koneksi (up/down) juga dipakai untuk tanda "offline" di dropdown — real-time.
const states = {};   // id -> { up, last, clients:Set, ws }
LOCATIONS.forEach((l) => { states[l.id] = { up: false, last: null, clients: new Set(), ws: null }; });
function broadcast(st, msg) { for (const c of st.clients) if (c.readyState === WebSocket.OPEN) c.send(msg); }
const statusMsg = (up) => JSON.stringify({ type: "pulse_status", up });   // beritahu klien: sumber hidup/mati

function connectUpstream(loc) {
  const st = states[loc.id];
  let ws;
  try { ws = new WebSocket(loc.ws); }
  catch (e) { st.up = false; return setTimeout(() => connectUpstream(loc), 3000); }
  st.ws = ws;
  ws.on("open", () => { st.up = true; console.log(`[pulse] upstream ${loc.id} tersambung`); broadcast(st, statusMsg(true)); });
  ws.on("message", (d) => { st.last = d.toString(); broadcast(st, st.last); });   // cache + fan-out
  ws.on("close", () => { st.up = false; st.last = null; st.ws = null; broadcast(st, statusMsg(false)); setTimeout(() => connectUpstream(loc), 3000); });
  ws.on("error", () => { try { ws.terminate(); } catch {} });   // handler 'close' yang reconnect
}

const app = express();
app.set("trust proxy", 1);          // hormati X-Forwarded-Proto dari nginx (utk cookie Secure)
app.use(express.json());

// ---- LOGIN (publik — tak butuh sesi) ----
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.post("/api/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "?";
  const st = auth.loginStatus(ip);
  if (st.blocked) return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Coba lagi ${st.retryAfter} detik lagi.` });
  const { username, password } = req.body || {};
  const user = auth.loadUsers().find((u) => u.username === username);
  if (!user || !auth.verifyPassword(password || "", user)) { auth.loginFail(ip); return res.status(401).json({ error: "Username atau password salah." }); }
  auth.loginOK(ip);
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
app.get("/api/health", (_req, res) => {
  const statuses = {};
  for (const id in states) statuses[id] = states[id].up ? "up" : "down";
  res.json({ statuses });
});
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
  const st = states[loc.id];
  st.clients.add(client);
  if (client.readyState === WebSocket.OPEN) client.send(statusMsg(st.up));             // status sumber saat ini
  if (st.up && st.last && client.readyState === WebSocket.OPEN) client.send(st.last);   // INSTAN: kirim cache terakhir
  client.on("message", (d) => { if (st.ws && st.ws.readyState === WebSocket.OPEN) st.ws.send(d.toString()); });  // relay perintah → upstream
  client.on("close", () => st.clients.delete(client));
  client.on("error", () => st.clients.delete(client));
});

server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("  Twinscape (v2) — viewer monitoring (konsumen WS eksternal)");
  console.log(`  App     : http://${HOST || "0.0.0.0"}:${PORT}  ${HOST ? "(hanya " + HOST + ")" : "(semua interface — akses via http://IP:" + PORT + ")"}`);
  LOCATIONS.forEach((l) => console.log(`  Lokasi  : ${l.id}  ←  ${l.ws}`));
  console.log(`  WS proxy: /ws?loc=<id>   (default: ${LOCATIONS[0].id})`);
  console.log("========================================");
  LOCATIONS.forEach((l) => connectUpstream(l));   // buka koneksi persisten + cache payload
});
