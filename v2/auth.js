/**
 * Auth sederhana TANPA dependensi (pakai crypto bawaan Node).
 * - Akun di v2/users.json  → { "users": [ { username, salt, hash } ] }  (password di-hash scrypt)
 * - Sesi = cookie ber-tanda-tangan HMAC (stateless; tahan restart). Rahasia dari
 *   env PULSE_SECRET, atau otomatis dibuat & disimpan di v2/.pulse-secret.
 * - Tambah akun: `node v2/adduser.js <username>`
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const USERS_FILE = path.join(__dirname, "users.json");
const SECRET_FILE = path.join(__dirname, ".pulse-secret");
const COOKIE = "pulse_sess";
const MAXAGE = 7 * 24 * 3600; // 7 hari (detik)

function getSecret() {
  if (process.env.PULSE_SECRET) return process.env.PULSE_SECRET;
  try { const s = fs.readFileSync(SECRET_FILE, "utf8").trim(); if (s) return s; } catch { /* buat baru */ }
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch (e) { console.warn("[auth] tak bisa simpan .pulse-secret:", e.message); }
  return s;
}
const SECRET = getSecret();

function loadUsers() {
  try { const j = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); return Array.isArray(j.users) ? j.users : []; }
  catch { return []; }
}
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const h = crypto.scryptSync(password, user.salt, 64).toString("hex");
  const a = Buffer.from(h, "hex"), b = Buffer.from(user.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64u = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (p) => crypto.createHmac("sha256", SECRET).update(p).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function makeToken(username) {
  const payload = { u: username, exp: Math.floor(Date.now() / 1000) + MAXAGE };
  const p = b64u(JSON.stringify(payload));
  return p + "." + sign(p);
}
function verifyToken(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expected = sign(p);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; }
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.u;
}

function readCookie(req, name) {
  const h = req.headers && req.headers.cookie; if (!h) return null;
  for (const part of h.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return null;
}
function userFromReq(req) { return verifyToken(readCookie(req, COOKIE)); }

// middleware Express: lindungi semua kecuali halaman & API login
function middleware(req, res, next) {
  if (req.path === "/login" || req.path === "/api/login") return next();
  if (userFromReq(req)) return next();
  if (req.method === "GET" && (req.headers.accept || "").includes("text/html")) {
    return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  }
  return res.status(401).json({ error: "unauthorized" });
}

module.exports = { COOKIE, MAXAGE, USERS_FILE, loadUsers, hashPassword, verifyPassword, makeToken, userFromReq, middleware };
