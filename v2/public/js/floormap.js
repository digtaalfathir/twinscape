/* =====================================================================
   Floor Map 2D (v2 / Track 2D) — VIEWER
   Reads a 2D layout (layout2d.json, authored in Floor-map Builder) and
   renders rooms/walls + one live marker per PIN, coloured by device status
   from the SAME /ws WebSocket. SVG-based, own data (NOT scene.json/3D).
   ===================================================================== */

const protocol = location.protocol === "https:" ? "wss" : "ws";
const _loc = new URLSearchParams(location.search).get("loc");   // tempat mana (multi-lokasi)
const WS_URL = `${protocol}://${location.host}/ws${_loc ? "?loc=" + encodeURIComponent(_loc) : ""}`;
let ws;

// ===== state =====
let deviceByIp = {};        // live data keyed by ip
let markerByIp = {};        // ip -> <g> marker element
let pins = [];              // from layout2d.json
const pinByIp = {};         // ip -> pin {x,y,label}
let selectedIp = null, dtTimer = null;

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("floormap");
const viewport = document.getElementById("viewport");
const floorplanG = document.getElementById("floorplan");
const markersG = document.getElementById("markers");
const stage = document.getElementById("stage");
const tooltip = document.getElementById("tooltip");
const detailPanel = document.getElementById("detailPanel");
const detailContent = document.getElementById("detailContent");
const msgEl = document.getElementById("msg");
const $ = (id) => document.getElementById(id);

// ===================================================================
//  LOAD LAYOUT (layout2d.json) → build floorplan + pins
// ===================================================================
async function tryFetch(u) {
  try { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) return null; return JSON.parse(await r.text()); }
  catch { return null; }
}
async function loadLayout() {
  const param = new URLSearchParams(location.search).get("layout");
  let L = await tryFetch(param || "/layout2d.json");
  let info = param ? param.split("/").pop() : "layout2d.json";
  if (!L && !param) { L = await tryFetch("/layout2d.example.json"); info = "contoh (example)"; }   // auto-fallback
  if (!L) {
    msgEl.style.display = "flex";
    msgEl.innerHTML = `Belum ada <b>layout2d.json</b>.<br>Buat di <b>Builder 2D</b> lalu simpan di <b>v2/public/</b>.<br><br>` +
      `<a href="?layout=/layout2d.example.json" style="color:#818cf8;text-decoration:underline">Buka contoh →</a>`;
    connect();     // tetap sambungkan WS supaya summary tetap jalan
    return;
  }
  if (Array.isArray(L.viewBox)) svg.setAttribute("viewBox", L.viewBox.join(" "));
  buildFloorplan(L);
  buildPins(L.pins || []);
  $("layoutInfo").textContent = "layout: " + info;
  connect();
}

function buildFloorplan(L) {
  // keep the dotgrid background rect (first child of viewport); rebuild floorplan group
  floorplanG.innerHTML = "";
  (L.rooms || []).forEach((r) => {
    const rect = mk("rect", { class: "lo-room", x: r.x, y: r.y, width: r.w, height: r.h, rx: 4,
      fill: r.color || "rgba(124,147,184,0.05)" });
    floorplanG.appendChild(rect);
    if (r.label) {
      const t = mk("text", { class: "lo-label", x: r.x + r.w / 2, y: r.y + r.h / 2 });
      t.textContent = r.label;
      floorplanG.appendChild(t);
    }
  });
  (L.walls || []).forEach((w) => {
    const pts = (w.points || []).map((p) => p.join(",")).join(" ");
    const closeSeg = w.closed && (w.points || []).length > 2 ? " " + w.points[0].join(",") : "";
    floorplanG.appendChild(mk("polyline", { class: "lo-wall", points: pts + closeSeg }));
  });
}

function buildPins(pinList) {
  Object.values(markerByIp).forEach((el) => el.remove());
  markerByIp = {}; pins = pinList;
  for (const k in pinByIp) delete pinByIp[k];
  pinList.forEach((p) => {
    pinByIp[p.ip] = p;
    const el = makeMarker(p);
    el.setAttribute("transform", `translate(${p.x} ${p.y})`);
    setLabel(el, p.label || p.ip);
    markersG.appendChild(el);
    markerByIp[p.ip] = el;
  });
  applyStatus(Object.values(deviceByIp));
}

// ===================================================================
//  WEBSOCKET + live status
// ===================================================================
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "cmd_result") return;
    if (msg.devices) { applyStatus(msg.devices); updateSummary(msg.devices); }
    if (msg.timestamp) $("lastUpdate").textContent = `Last update: ${msg.timestamp}`;
  };
}
function setConn(ok) {
  $("connDot").classList.toggle("connected", ok);
  $("connLabel").textContent = ok ? "Connected" : "Disconnected";
}
// recolour each pin-marker by its matching device's live status (grey if unmapped)
function applyStatus(devices) {
  devices.forEach((d) => (deviceByIp[d.ip] = d));
  pins.forEach((p) => {
    const el = markerByIp[p.ip]; if (!el) return;
    const d = deviceByIp[p.ip];
    const status = d ? (d.status || "").toLowerCase() : "unknown";
    const sev = (d && d.severity) || "LOW";
    let cls = `fm-marker status-${status} sev-${sev}`;
    if (p.ip === selectedIp) cls += " selected";
    el.setAttribute("class", cls);
    setLabel(el, p.label || (d && d.name) || p.ip);
  });
  if (selectedIp && deviceByIp[selectedIp]) renderDetail(deviceByIp[selectedIp]);
}

function makeMarker(p) {
  const g = document.createElementNS(SVG_NS, "g");
  g.dataset.ip = p.ip;
  g.setAttribute("class", "fm-marker status-unknown sev-LOW");
  g.append(
    mk("circle", { class: "fm-pulse", r: 12 }),
    mk("circle", { class: "fm-ring", r: 12 }),
    mk("circle", { class: "fm-core", r: 6.5 }),
    mk("rect", { class: "mk-label-bg", rx: 5, y: 20, height: 17 }),
    mk("text", { class: "mk-label", y: 28.5 })
  );
  g.addEventListener("mouseenter", (e) => showTooltip(p.ip, e));
  g.addEventListener("mousemove", (e) => moveTooltip(e));
  g.addEventListener("mouseleave", hideTooltip);
  return g;
}
function setLabel(el, name) {
  const label = el.querySelector(".mk-label");
  if (label.textContent === name) return;
  label.textContent = name;
  const w = Math.max(40, name.length * 6.6 + 14);
  const bg = el.querySelector(".mk-label-bg");
  bg.setAttribute("x", -w / 2);
  bg.setAttribute("width", w);
}
function mk(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function updateSummary(devices) {
  const total = devices.length, up = devices.filter((d) => d.status === "UP").length;
  $("totalDevices").textContent = total; $("upCount").textContent = up; $("downCount").textContent = total - up;
  const score = total > 0 ? ((up / total) * 100).toFixed(1) : "100.0";
  const el = $("healthScore"); el.textContent = `${score}%`;
  el.style.color = score >= 95 ? "var(--up)" : score >= 80 ? "var(--high)" : "var(--down)";
}

// ===================================================================
//  TOOLTIP + DETAIL (unchanged behaviour)
// ===================================================================
function showTooltip(ip, e) {
  const d = deviceByIp[ip];
  const p = pinByIp[ip];
  const name = (d && d.name) || (p && p.label) || ip;
  const isDown = d && d.status === "DOWN";
  tooltip.innerHTML = `
    <div class="tt-name">${esc(name)}</div>
    <div class="tt-ip">${ip}</div>
    <div class="tt-row"><span>Status</span><span class="${isDown ? "tt-down" : "tt-up"}">${(d && d.status) || "—"}</span></div>
    <div class="tt-row"><span>Latency</span><span>${d && d.latency != null ? d.latency + " ms" : "—"}</span></div>
    <div class="tt-row"><span>Availability</span><span>${(d && d.uptimeToday) ?? "—"}%</span></div>
    <div class="tt-row"><span>Severity</span><span>${(d && d.severity) || "—"}</span></div>`;
  tooltip.classList.add("show");
  moveTooltip(e);
}
function moveTooltip(e) {
  const r = stage.getBoundingClientRect();
  let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  if (x + tw > r.width) x = e.clientX - r.left - tw - 16;
  if (y + th > r.height) y = r.height - th - 8;
  tooltip.style.left = `${x}px`; tooltip.style.top = `${y}px`;
}
function hideTooltip() { tooltip.classList.remove("show"); }

function openDetail(ip) {
  selectedIp = ip;
  Object.entries(markerByIp).forEach(([k, el]) => el.classList.toggle("selected", k === ip));
  renderDetail(deviceByIp[ip] || { ip, name: (pinByIp[ip] && pinByIp[ip].label) || ip });
  detailPanel.classList.add("open");
}
function closeDetail() {
  detailPanel.classList.remove("open");
  if (selectedIp && markerByIp[selectedIp]) markerByIp[selectedIp].classList.remove("selected");
  selectedIp = null;
  if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
}
function renderDetail(d) {
  const hasData = d.status != null;
  const isDown = d.status === "DOWN";
  const availTxt = hasData ? (d.uptimeToday ?? 100) + "%" : "—";
  const hist = (d.history || []).slice(-6).reverse();
  const p = pinByIp[d.ip] || { x: "—", y: "—" };
  detailContent.innerHTML = `
    <div class="dt-head">
      <div><h2>${esc(d.name)}</h2>
        <div class="dt-ip">${d.ip} · <span class="badge sev-${d.severity || "LOW"}">${d.severity || "—"}</span></div></div>
      <button class="dt-close" id="dtClose">✕</button>
    </div>
    <div class="dt-body">
      <div class="dt-status-banner ${isDown ? "down" : hasData ? "up" : ""}"${hasData ? "" : ' style="background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid var(--border)"'}><span>●</span><span>${isDown ? "DEVICE DOWN" : hasData ? "DEVICE UP" : "TIDAK ADA DATA LIVE"}</span>
        ${isDown && d.downSince ? `<span style="margin-left:auto;font-size:12px;font-weight:600" id="dtLive">—</span>` : ""}</div>
      ${hasData ? "" : `<div class="dt-empty" style="margin:0 0 12px">Device dengan IP ini belum melapor. Pastikan backend monitoring (npm start) jalan.</div>`}
      <div class="dt-section">Network Quality</div>
      <div class="dt-grid">
        <div class="dt-item"><div class="dt-label">Availability</div><div class="dt-val ${hasData ? (d.uptimeToday >= 99 ? "up" : "down") : ""}">${availTxt}</div></div>
        <div class="dt-item"><div class="dt-label">Latency</div><div class="dt-val">${d.latency != null ? d.latency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Avg</div><div class="dt-val">${d.avgLatency != null ? d.avgLatency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Peak</div><div class="dt-val">${d.maxLatency != null ? d.maxLatency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Downtime</div><div class="dt-val">${fmtSec(d.downtimeTodaySec ?? 0)}</div></div>
        <div class="dt-item"><div class="dt-label">Posisi (x,y)</div><div class="dt-val" style="font-size:11px">${p.x}, ${p.y}</div></div>
      </div>
      <div class="dt-section">Device Info</div>
      <div class="dt-meta">
        <div class="m-row"><span class="m-k">Owner</span><span class="m-v">${esc(d.owner) || "—"}</span></div>
        <div class="m-row"><span class="m-k">Location</span><span class="m-v">${esc(d.location) || "—"}</span></div>
        <div class="m-row"><span class="m-k">Vendor</span><span class="m-v">${esc(d.vendor) || "—"}</span></div>
      </div>
      <div class="dt-section">Recent Events</div>
      <div class="dt-events">${hist.length ? hist.map((h) => `
        <div class="dt-ev"><span class="ev-dot ${h.status.toLowerCase()}"></span><span class="ev-time">${h.timestamp}</span>
        <span class="ev-status" style="color:${h.status === "UP" ? "var(--up)" : "var(--down)"}">${h.status}</span></div>`).join("")
      : `<div class="dt-empty">Belum ada event.</div>`}</div>
    </div>`;
  $("dtClose").onclick = closeDetail;
  startDtLive(d);
}
function startDtLive(d) {
  if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
  const el = $("dtLive"); if (!el || !d.downSince) return;
  const since = new Date(d.downSince.replace(" ", "T")).getTime();
  const tick = () => {
    const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
    el.textContent = `Down ${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  tick(); dtTimer = setInterval(tick, 1000);
}

function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function fmtSec(s) { if (!s) return "0s"; const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`; }

// ===================================================================
//  EXPORT SVG statik (C3)
// ===================================================================
const EXPORT_CSS = `
svg{background:#0a0e1a}
.lo-room{stroke:#7c93b8;stroke-width:1.5}
.lo-label{fill:#8fa3c4;font:700 14px Inter,Arial,sans-serif;text-anchor:middle;dominant-baseline:central}
.lo-wall{stroke:#aebfdd;stroke-width:4;fill:none}
.fm-pulse{fill:none}
.fm-ring{fill:rgba(10,14,26,0.85);stroke-width:2.5}
.fm-marker.sev-CRITICAL .fm-ring{stroke:#ef4444}.fm-marker.sev-HIGH .fm-ring{stroke:#f59e0b}
.fm-marker.sev-MEDIUM .fm-ring{stroke:#3b82f6}.fm-marker.sev-LOW .fm-ring{stroke:#6b7280}
.fm-core{stroke:rgba(10,14,26,0.6);stroke-width:1}
.fm-marker.status-up .fm-core{fill:#10b981}.fm-marker.status-down .fm-core{fill:#ef4444}.fm-marker.status-unknown .fm-core{fill:#64748b}
.mk-label-bg{fill:rgba(10,14,26,0.82);stroke:rgba(255,255,255,0.1)}
.mk-label{fill:#f8fafc;font:600 11px Inter,Arial,sans-serif;text-anchor:middle;dominant-baseline:central}`;
function exportSVG() {
  const clone = svg.cloneNode(true);
  const vp = clone.querySelector("#viewport"); if (vp) vp.removeAttribute("transform");   // export unzoomed
  const style = document.createElementNS(SVG_NS, "style"); style.textContent = EXPORT_CSS;
  clone.insertBefore(style, clone.firstChild);
  const s = new XMLSerializer().serializeToString(clone);
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', s], { type: "image/svg+xml" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "floormap.svg"; a.click();
}

// ===================================================================
//  PAN / ZOOM (viewBox-aware)
// ===================================================================
let view = { x: 0, y: 0, k: 1 };
const K_MIN = 0.4, K_MAX = 6;
function applyView() { viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`); }
function toUser(clientX, clientY) { const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }
function zoomAt(clientX, clientY, factor) {
  const u = toUser(clientX, clientY);
  const newK = Math.min(K_MAX, Math.max(K_MIN, view.k * factor));
  const r = newK / view.k;
  view.x = u.x - (u.x - view.x) * r; view.y = u.y - (u.y - view.y) * r; view.k = newK;
  applyView();
}
svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
let panning = false, didPan = false, startU = null, startView = null, downMarker = null;
svg.addEventListener("pointerdown", (e) => {
  panning = true; didPan = false;
  downMarker = e.target.closest ? e.target.closest(".fm-marker") : null;
  startU = toUser(e.clientX, e.clientY); startView = { x: view.x, y: view.y };
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener("pointermove", (e) => {
  if (!panning) return;
  const u = toUser(e.clientX, e.clientY);
  const dx = u.x - startU.x, dy = u.y - startU.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) { didPan = true; stage.classList.add("dragging"); }
  view.x = startView.x + dx; view.y = startView.y + dy; applyView();
});
function endPan(e) {
  if (!panning) return;
  panning = false; stage.classList.remove("dragging");
  try { svg.releasePointerCapture(e.pointerId); } catch {}
  if (!didPan && downMarker && downMarker.dataset.ip) openDetail(downMarker.dataset.ip);
  downMarker = null;
}
svg.addEventListener("pointerup", endPan);
svg.addEventListener("pointercancel", endPan);
function zoomCenter(factor) { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor); }
$("zoomIn").onclick = () => zoomCenter(1.25);
$("zoomOut").onclick = () => zoomCenter(1 / 1.25);
$("zoomReset").onclick = () => { view = { x: 0, y: 0, k: 1 }; applyView(); };
$("btnExport").onclick = exportSVG;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

// ===== Start =====
applyView();
loadLayout();
