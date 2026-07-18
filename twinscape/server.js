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
const net = require("net");
const fs = require("fs");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const auth = require("./auth");

// Muat twinscape/.env kalau ada (KEY=VALUE per baris) → process.env. Tanpa dependensi.
// Env asli (mis. dari PM2/inline) tetap menang. Kalau file tak ada → dilewati diam-diam.
(function loadDotenv() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s[0] === "#") continue;
      const i = s.indexOf("=");
      if (i < 0) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
        v = v.slice(1, -1);                              // ber-kutip → literal (boleh mengandung #/spasi)
      } else {
        const h = v.indexOf(" #");                       // tanpa kutip → buang komentar inline " #..."
        if (h >= 0) v = v.slice(0, h).trim();
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* abaikan .env rusak */ }
})();

const PORT = process.env.V2_PORT || 10102;
const HOST = process.env.V2_HOST || undefined;   // undefined = semua interface; set 127.0.0.1 di belakang nginx

// ---- Remote SSH (Fase 1 MVP): bridge WS↔SSH ke SATU device dari env. OFF kecuali REMOTE_ENABLE=1. ----
// Identitas remote TERPISAH dari monitoring (host/port/user/pass sendiri). Kredensial server-side, tak ke browser.
const { Client: SSHClient } = require("ssh2");
const REMOTE_ENABLE = process.env.REMOTE_ENABLE === "1";
const SSH = {
  host: process.env.REMOTE_SSH_HOST,
  port: parseInt(process.env.REMOTE_SSH_PORT || "22", 10),
  username: process.env.REMOTE_SSH_USER,
};
function sshAuth() {                                   // kredensial DEFAULT dari env (dipakai bila device tak override)
  if (process.env.REMOTE_SSH_KEY_FILE) return { privateKey: fs.readFileSync(process.env.REMOTE_SSH_KEY_FILE), passphrase: process.env.REMOTE_SSH_PASSPHRASE };
  if (process.env.REMOTE_SSH_PASSWORD) return { password: process.env.REMOTE_SSH_PASSWORD };
  return {};
}

// ---- Fase 2: remotes.json — target + KAPABILITAS per device (key = IP monitoring). ----
// { defaults:{ssh:{port,username,...}}, devices:{ "<ip-monitoring>":{ label, ssh:{host,port,username,keyFile?,passwordEnv?}, vnc:{host,port} } } }
// Kredensial TIDAK plaintext di sini: pakai keyFile (path) / passwordEnv (nama env) / default env. Absen → fallback mode env (Fase 1).
const REMOTES_FILE = process.env.REMOTES_FILE || path.join(__dirname, "remotes.json");   // boleh taruh di luar repo
function loadRemotes() {
  try { const j = JSON.parse(fs.readFileSync(REMOTES_FILE, "utf8")); return (j && j.devices) ? j : null; }
  catch { return null; }
}
let REMOTES = loadRemotes();
const hasMap = () => !!(REMOTES && REMOTES.devices && Object.keys(REMOTES.devices).length);
const sshConfigured = () => !!(REMOTE_ENABLE && (hasMap() || (SSH.host && SSH.username)));

function deviceCaps(rec) { return { ssh: !!(rec && rec.ssh && rec.ssh.host), vnc: !!(rec && rec.vnc && rec.vnc.host) }; }
function resolveAuth(s, dd) {                          // s=device.ssh, dd=defaults.ssh
  const keyFile = s.keyFile || dd.keyFile;
  if (keyFile) { try { const pf = s.passphraseEnv || dd.passphraseEnv; return { privateKey: fs.readFileSync(keyFile), passphrase: pf ? process.env[pf] : process.env.REMOTE_SSH_PASSPHRASE }; } catch (e) { console.warn(`[remote] keyFile tak terbaca: ${keyFile} (${e.code || e.message}) → coba password`); } }
  const pw = s.password || dd.password;               // password langsung di remotes.json (semua-di-satu-tempat)
  if (pw) return { password: pw };
  const pwEnv = s.passwordEnv || dd.passwordEnv;       // atau rujuk NAMA env
  if (pwEnv && process.env[pwEnv]) return { password: process.env[pwEnv] };
  return sshAuth();                                    // atau default env REMOTE_SSH_* (fallback lama)
}
function resolveSSH(deviceKey) {                        // → {host,port,username,...auth} | null
  if (hasMap()) {
    const rec = REMOTES.devices[deviceKey];
    if (!rec || !rec.ssh || !rec.ssh.host) return null;
    const dd = (REMOTES.defaults && REMOTES.defaults.ssh) || {}, s = rec.ssh;
    const username = s.username || dd.username || process.env.REMOTE_SSH_USER;
    if (!username) return null;
    return { host: s.host, port: s.port || dd.port || 22, username, ...resolveAuth(s, dd) };
  }
  if (SSH.host && SSH.username) return { host: SSH.host, port: SSH.port, username: SSH.username, ...sshAuth() };  // fallback env (Fase 1)
  return null;
}
function resolveVNC(deviceKey) {                        // → {host,port,startCommand?,startDelayMs} | null. VNC hanya via remotes.json.
  if (!hasMap()) return null;
  const rec = REMOTES.devices[deviceKey];
  if (!rec || !rec.vnc || !rec.vnc.host) return null;
  const dd = (REMOTES.defaults && REMOTES.defaults.vnc) || {};
  return {
    host: rec.vnc.host, port: rec.vnc.port || dd.port || 5900,
    startCommand: rec.vnc.startCommand || dd.startCommand || null,   // mis. "x11vnc …" — dijalankan via SSH sebelum konek
    startDelayMs: rec.vnc.startDelayMs || dd.startDelayMs || 1500,   // jeda beri waktu server VNC bind
  };
}

// ---- Fase 4: RBAC (role → izin device/grup). AKTIF hanya bila remotes.json punya "roles". ----
// remotes.json: { "roles": { "admin":{"remote":"*"}, "operator":{"remote":["group:injection","172.19.88.8"]}, "viewer":{"remote":[]} }, ... }
// device boleh punya "group". User punya "role" di users.json. Tanpa "roles" → RBAC off (perilaku Fase 3).
const DEFAULT_ROLE = process.env.REMOTE_DEFAULT_ROLE || "viewer";
const rbacOn = () => !!(REMOTES && REMOTES.roles);
function reqUser(req) {                                  // {name,role} | null
  const name = auth.userFromReq(req);
  if (!name) return null;
  const u = auth.loadUsers().find((x) => x.username === name);
  return { name, role: (u && u.role) || DEFAULT_ROLE };
}
function canRemote(role, deviceKey) {
  if (!rbacOn()) return true;                            // RBAC nonaktif → izinkan
  const p = role && REMOTES.roles[role];
  if (!p) return false;                                  // role tak dikenal / kosong → tolak (default-deny)
  if (p.remote === "*") return true;
  if (!Array.isArray(p.remote)) return false;
  const dev = REMOTES.devices[deviceKey] || {};
  return p.remote.some((tok) => tok === deviceKey || (dev.group && tok === "group:" + dev.group));
}

// ---- Audit log (siapa remote apa, kapan, berapa lama) → JSON per baris. Selalu aktif. ----
const AUDIT_FILE = process.env.AUDIT_FILE || path.join(__dirname, "logs", "remote-audit.log");
function audit(ev) {
  try { fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true }); } catch { /* abaikan */ }
  fs.appendFile(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n", () => {});
}

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
// kapabilitas remote per device (key = IP monitoring) — HANYA boolean ssh/vnc + label. TANPA host/kredensial.
app.get("/api/remote", (req, res) => {
  if (!sshConfigured()) return res.json({ enabled: false });
  const u = reqUser(req);
  if (hasMap()) {
    const devices = {};
    for (const k in REMOTES.devices) {
      if (!canRemote(u && u.role, k)) continue;          // RBAC: hanya tampilkan device yang boleh (tombol pun ikut tersaring)
      const c = deviceCaps(REMOTES.devices[k]);
      if (c.ssh || c.vnc) devices[k] = { ssh: c.ssh, vnc: c.vnc, label: REMOTES.devices[k].label || undefined };
    }
    return res.json({ enabled: true, mode: "map", role: u && u.role, devices });
  }
  res.json({ enabled: true, mode: "single", target: `${SSH.username}@${SSH.host}:${SSH.port}` });   // Fase 1: semua device → SSH
});
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);

// ---- WS: /ws (monitoring) + /ssh (bridge SSH) + /vnc (pipa RFB) — satu router upgrade, semua butuh login ----
const wss = new WebSocketServer({ noServer: true });
const sshWss = new WebSocketServer({ noServer: true });
const vncWss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, "http://x").pathname; } catch { return socket.destroy(); }
  if (!auth.userFromReq(req)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); return socket.destroy(); }   // gerbang login
  if (pathname === "/ws") wss.handleUpgrade(req, socket, head, (c) => wss.emit("connection", c, req));
  else if (pathname === "/ssh" && sshConfigured()) sshWss.handleUpgrade(req, socket, head, (c) => sshWss.emit("connection", c, req));
  else if (pathname === "/vnc" && REMOTE_ENABLE && hasMap()) vncWss.handleUpgrade(req, socket, head, (c) => vncWss.emit("connection", c, req));
  else socket.destroy();
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

// ---- /ssh?device=<ip-monitoring>: 1 koneksi WS = 1 sesi shell. Target di-resolve SERVER-SIDE. Protokol: ----
//   client→server (text JSON): {t:"d",d:"<keystroke>"} | {t:"r",cols,rows}
//   server→client: frame BINARY = output terminal · frame TEXT (JSON) = {type:"status"|"error",msg}
sshWss.on("connection", (client, req) => {
  let deviceKey = null;
  try { deviceKey = new URL(req.url, "http://x").searchParams.get("device"); } catch {}
  const ctrl = (o) => { try { client.send(JSON.stringify(o)); } catch {} };
  const u = reqUser(req);
  if (!canRemote(u && u.role, deviceKey)) {              // RBAC: gerbang sebenarnya (walau tombol disembunyikan)
    audit({ user: u && u.name, role: u && u.role, action: "ssh", device: deviceKey, event: "denied" });
    ctrl({ type: "error", msg: "Kamu tak diizinkan me-remote device ini." }); return client.close();
  }
  const target = resolveSSH(deviceKey);
  if (!target) { ctrl({ type: "error", msg: "Device tak dikenal / tak bisa di-SSH." }); return client.close(); }
  const startedAt = Date.now();
  audit({ user: u && u.name, role: u && u.role, action: "ssh", device: deviceKey, event: "open" });

  const conn = new SSHClient();
  let stream = null;
  conn.on("ready", () => {
    conn.shell({ term: "xterm-256color" }, (err, s) => {
      if (err) { ctrl({ type: "error", msg: err.message }); return client.close(); }
      stream = s;
      ctrl({ type: "status", msg: `Terhubung — ${target.username}@${target.host}` });
      s.on("data", (d) => { try { client.send(d); } catch {} });        // Buffer → frame binary = output
      s.stderr.on("data", (d) => { try { client.send(d); } catch {} });
      s.on("close", () => { try { client.close(); } catch {} conn.end(); });
    });
  });
  conn.on("error", (e) => { ctrl({ type: "error", msg: e.message }); try { client.close(); } catch {} });
  client.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === "d" && stream) stream.write(m.d);
    else if (m.t === "r" && stream) stream.setWindow(m.rows, m.cols, 0, 0);
  });
  client.on("close", () => { try { conn.end(); } catch {} audit({ user: u && u.name, action: "ssh", device: deviceKey, event: "close", durationMs: Date.now() - startedAt }); });
  ctrl({ type: "status", msg: "Menyambung SSH…" });
  conn.connect({ ...target, readyTimeout: 12000, keepaliveInterval: 15000 });   // target = {host,port,username,+auth}
});

// ---- /vnc?device=<ip>: pipa MENTAH WS↔TCP (RFB). noVNC (browser) yang bicara protokol; server cuma teruskan byte. ----
// Opsional: vnc.startCommand → jalankan (mis. x11vnc) via SSH device ini dulu, tunggu startDelayMs, baru pipa.
vncWss.on("connection", (client, req) => {
  let deviceKey = null;
  try { deviceKey = new URL(req.url, "http://x").searchParams.get("device"); } catch {}
  const ctrl = (o) => { try { client.send(JSON.stringify(o)); } catch {} };
  const u = reqUser(req);
  if (!canRemote(u && u.role, deviceKey)) {
    audit({ user: u && u.name, role: u && u.role, action: "vnc", device: deviceKey, event: "denied" });
    ctrl({ type: "error", msg: "Kamu tak diizinkan me-remote device ini." }); try { client.close(); } catch {} return;
  }
  const target = resolveVNC(deviceKey);
  if (!target) { try { client.close(); } catch {} return; }
  const startedAt = Date.now();
  audit({ user: u && u.name, role: u && u.role, action: "vnc", device: deviceKey, event: "open" });
  let tcp = null, prep = null;

  function openPipe() {
    tcp = net.connect(target.port, target.host);
    tcp.on("data", (d) => { if (client.readyState === WebSocket.OPEN) client.send(d); });   // TCP → WS
    tcp.on("close", () => { try { client.close(); } catch {} });
    tcp.on("error", (e) => { ctrl({ type: "error", msg: "Konek VNC gagal: " + e.message }); try { client.close(); } catch {} });
  }

  if (target.startCommand) {                          // siapkan server VNC via SSH dulu
    const sshT = resolveSSH(deviceKey);
    if (!sshT) { ctrl({ type: "error", msg: "startCommand butuh config SSH device ini." }); return client.close(); }
    ctrl({ type: "status", msg: "Menyiapkan VNC (menjalankan perintah via SSH)…" });
    prep = new SSHClient();
    prep.on("ready", () => prep.exec(target.startCommand, (err, stream) => {
      if (err) { ctrl({ type: "error", msg: "Gagal start VNC: " + err.message }); return client.close(); }
      stream.on("data", () => {}); stream.stderr.on("data", () => {}); stream.on("close", () => {});   // biarkan jalan (x11vnc)
      setTimeout(() => { if (client.readyState === WebSocket.OPEN) openPipe(); }, target.startDelayMs);
    }));
    prep.on("error", (e) => { ctrl({ type: "error", msg: "SSH (start VNC) gagal: " + e.message }); try { client.close(); } catch {} });
    prep.connect({ ...sshT, readyTimeout: 12000 });
  } else {
    openPipe();
  }

  client.on("message", (d) => { try { tcp && tcp.write(d); } catch {} });                  // WS → TCP (aman: RFB server bicara duluan)
  client.on("close", () => { try { tcp && tcp.destroy(); } catch {} try { prep && prep.end(); } catch {} audit({ user: u && u.name, action: "vnc", device: deviceKey, event: "close", durationMs: Date.now() - startedAt }); });
  client.on("error", () => { try { tcp && tcp.destroy(); } catch {} try { prep && prep.end(); } catch {} });
});

server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("  Twinscape (v2) — viewer monitoring (konsumen WS eksternal)");
  console.log(`  App     : http://${HOST || "0.0.0.0"}:${PORT}  ${HOST ? "(hanya " + HOST + ")" : "(semua interface — akses via http://IP:" + PORT + ")"}`);
  LOCATIONS.forEach((l) => console.log(`  Lokasi  : ${l.id}  ←  ${l.ws}`));
  console.log(`  WS proxy: /ws?loc=<id>   (default: ${LOCATIONS[0].id})`);
  console.log(`  Remote  : ${!sshConfigured() ? "OFF (set REMOTE_ENABLE=1 + remotes.json / REMOTE_SSH_HOST)" : hasMap() ? `SSH ON → remotes.json (${Object.keys(REMOTES.devices).length} device)` : `SSH ON → env single: ${SSH.username}@${SSH.host}:${SSH.port}`}`);
  if (sshConfigured()) console.log(`  RBAC    : ${rbacOn() ? `ON (${Object.keys(REMOTES.roles).length} role) · audit → ${path.relative(process.cwd(), AUDIT_FILE)}` : "OFF (tambah \"roles\" di remotes.json untuk aktifkan) · audit tetap jalan"}`);
  console.log("========================================");
  LOCATIONS.forEach((l) => connectUpstream(l));   // buka koneksi persisten + cache payload
});
