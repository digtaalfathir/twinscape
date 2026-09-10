/* =====================================================================
   Floor Map 2D (v2 / Track 2D) — VIEWER
   Reads a 2D layout (layout2d.json, authored in Floor-map Builder) and
   renders rooms/walls + one live marker per PIN, coloured by device status
   from the SAME /ws WebSocket. SVG-based, own data (NOT scene.json/3D).
   ===================================================================== */

let ws, activeLoc = null, activeFloor = null;   // dari /api/locations (menentukan layout + nama + WS)

// ===== state =====
let deviceByIp = {};        // live data keyed by ip
let markerByIp = {};        // ip -> <g> marker element
let pins = [];              // from layout2d.json
const pinByIp = {};         // ip -> pin {x,y,label}
const lastStatus = {};      // ip -> status sebelumnya (deteksi transisi utk alert E8)
let selectedIp = null, dtTimer = null, filterMode = "all", alertBaseline = false;
let zones2d = [], roomEls = [];   // E2/E7 — zona = ruangan (rect utk warna)
// Kawasan 2D — grup objek per factory + fokus/dim (mirror 3D). factory = {id,name,viewBox}
let districtFactories = [], facById = {}, focusedFactory = "", activeFloor2d = "", facGroups = {};   // fid -> {fp,mk, ffp:{floor:<g>}, fmk:{floor:<g>}}
let baseViewBox = [0, 0, 1120, 780], locSubBase = "";
const ZONE_TINT = false;          // E7 pewarnaan ruangan saat DOWN — dimatikan sementara (set true utk aktifkan)
let wsRetry = 2000, lastDataAt = 0;   // #2 reconnect backoff+jitter · #3 data basi
const STALE_MS = 25000;

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
async function boot() {
  await resolveLocation();
  loadLayout();
}
async function resolveLocation() {
  try {
    const data = await fetch("/api/locations", { cache: "no-store" }).then((r) => r.json());
    const list = data.locations || [];
    const params = new URLSearchParams(location.search);
    activeLoc = list.find((l) => l.id === params.get("loc")) || list[0] || null;   // default = urutan pertama
    const floors = (activeLoc && activeLoc.floors) || [];
    activeFloor = floors.find((f) => f.id === params.get("floor")) || floors[0] || null;   // E5
  } catch { activeLoc = null; activeFloor = null; }
  const el = $("sceneInfo"); if (el) el.textContent = activeLoc ? activeLoc.name : t("monitoring");
}
async function loadLayout() {
  const param = new URLSearchParams(location.search).get("layout");
  const url = param || (activeFloor && activeFloor.layout2d) || (activeLoc && activeLoc.layout2d) || "/layout2d.json";
  const setSub = (t) => { locSubBase = t; const s = $("locSub"); if (s && !focusedFactory) s.textContent = t; };
  let L = await tryFetch(url);
  if (L) setSub(activeFloor ? activeFloor.name : "Live monitoring");
  if (!L && !param) { L = await tryFetch("/layout2d.example.json"); if (L) setSub(activeFloor ? activeFloor.name + " · contoh" : "Denah contoh"); }   // auto-fallback
  if (!L) {
    setSub("Denah belum ada");
    msgEl.style.display = "flex";
    msgEl.innerHTML = `Belum ada denah <b>${url}</b> untuk lokasi ini.<br>Buat di <b>Builder 2D</b> lalu simpan di <b>v2/public/</b>.<br><br>` +
      `<a href="?layout=/layout2d.example.json" style="color:var(--accent);text-decoration:underline">Buka contoh →</a>`;
    buildPins([]);   // total = 0
    connect();       // tetap sambungkan WS supaya summary tetap jalan
    return;
  }
  if (Array.isArray(L.viewBox)) { baseViewBox = L.viewBox.slice(); svg.setAttribute("viewBox", L.viewBox.join(" ")); }
  buildFloorplan(L);
  buildPins(L.pins || []);
  buildZones(L);
  buildFactorySelector2d();
  applyFloorVis();   // factory berlantai → default tampil lantai-1 (walau All)
  const params = new URLSearchParams(location.search);
  const wantFac = params.get("factory"), wantFloor = params.get("floor");
  if (wantFac && facById[wantFac]) { selectFactory2d(wantFac, true); if (wantFloor) selectFloor2d(wantFloor); }   // deep-link ?factory=&floor=
  connect();
}

// ===================================================================
//  KAWASAN 2D — selektor factory (All ⇄ fokus) + zoom viewBox + dim <g>
// ===================================================================
function visibleFloor(fid) {   // 2D flat → tiap factory berlantai tampilkan SATU lantai: aktif (bila difokus) atau lantai-1
  const floors = (facById[fid] && facById[fid].floors) || [];
  if (floors.length < 2) return null;   // single-floor → tak ada swap
  return (fid === focusedFactory && activeFloor2d) ? activeFloor2d : floors[0].id;
}
function inScope(p) {   // All = SEMUA device (semua lantai) → total benar (DOWN di lantai tersembunyi tak hilang dari hitungan); fokus = factory itu + lantai aktif
  if (!focusedFactory) return true;
  if (p.factory !== focusedFactory) return false;
  const floors = (facById[focusedFactory] && facById[focusedFactory].floors) || [];
  if (floors.length < 2 || !p.floor) return true;
  return p.floor === activeFloor2d;
}
function applyFloorVis() {   // swap lantai: sembunyikan grup lantai yg tak tampil (per factory berlantai)
  districtFactories.forEach((f) => {
    const F = facGroups[f.id], showId = visibleFloor(f.id);
    if (!F || !showId) return;
    [F.ffp, F.fmk].forEach((map) => { if (map) for (const fl in map) map[fl].style.display = (fl === showId) ? "" : "none"; });
  });
}
function buildFactorySelector2d() {
  let nav = document.getElementById("factoryNav");
  if (!districtFactories.length) { if (nav) nav.remove(); return; }
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "factoryNav"; nav.className = "factory-nav";
    nav.innerHTML = `<span class="fn-lbl">${t("factory", "Factory")}</span><select id="factorySel"></select>` +
      `<span class="fn-floor" style="display:none"><span class="fn-sep"></span><span class="fn-lbl">${t("floor", "Floor")}</span><select id="floorSel2"></select></span>`;
    stage.appendChild(nav);
    nav.querySelector("#factorySel").addEventListener("change", (e) => selectFactory2d(e.target.value));
    nav.querySelector("#floorSel2").addEventListener("change", (e) => selectFloor2d(e.target.value));
  }
  const sel = document.getElementById("factorySel");
  sel.innerHTML = `<option value="">${t("all_factories", "All")}</option>` +
    districtFactories.map((f) => `<option value="${f.id}">${(f.name || f.id).replace(/</g, "&lt;")}</option>`).join("");
  sel.value = focusedFactory;
  updateFloorSelector2d();
}
function updateFloorSelector2d() {   // sub-selektor Lantai — hanya bila factory fokus punya ≥2 lantai (2D = swap, tanpa "All")
  const wrap = document.querySelector("#factoryNav .fn-floor");
  const fs = document.getElementById("floorSel2");
  const floors = (facById[focusedFactory] && facById[focusedFactory].floors) || [];
  if (!focusedFactory || floors.length < 2) { if (wrap) wrap.style.display = "none"; return; }
  wrap.style.display = "";
  fs.innerHTML = floors.map((fl) => `<option value="${fl.id}">${(fl.name || fl.id).replace(/</g, "&lt;")}</option>`).join("");
  fs.value = activeFloor2d || floors[0].id;
}
function selectFactory2d(id, instant) {
  focusedFactory = id && facById[id] ? id : "";
  const sel = document.getElementById("factorySel"); if (sel) sel.value = focusedFactory;
  const floors = (facById[focusedFactory] && facById[focusedFactory].floors) || [];
  if (!floors.some((fl) => fl.id === activeFloor2d)) activeFloor2d = floors.length ? floors[0].id : "";   // default lantai-1
  districtFactories.forEach((f) => {                 // redup factory lain (opacity <g> + CSS transition)
    const op = (!focusedFactory || f.id === focusedFactory) ? "1" : "0.18";
    const g = facGroups[f.id]; if (g) { if (g.fp) g.fp.style.opacity = op; if (g.mk) g.mk.style.opacity = op; }
  });
  updateFloorSelector2d();
  applyFloorVis();
  animateViewBox(focusedFactory ? padVB(facById[focusedFactory].viewBox) : baseViewBox, instant);
  writeDeepLink();
  const sub = $("locSub"); if (sub) sub.textContent = focusedFactory ? (facById[focusedFactory].name || focusedFactory) + (activeFloor2d && floors.length > 1 ? " · " + (floors.find((x) => x.id === activeFloor2d) || {}).name : "") : locSubBase;
  updateSummary();   // angka panel ikut konteks
}
function selectFloor2d(floorId) {
  const floors = (facById[focusedFactory] && facById[focusedFactory].floors) || [];
  activeFloor2d = floors.some((fl) => fl.id === floorId) ? floorId : (floors[0] && floors[0].id) || "";
  const fs = document.getElementById("floorSel2"); if (fs) fs.value = activeFloor2d;
  applyFloorVis();
  writeDeepLink();
  const sub = $("locSub"); if (sub && focusedFactory) sub.textContent = (facById[focusedFactory].name || focusedFactory) + (activeFloor2d ? " · " + ((floors.find((x) => x.id === activeFloor2d) || {}).name || activeFloor2d) : "");
  updateSummary();
}
function writeDeepLink() {
  const u = new URL(location.href);
  focusedFactory ? u.searchParams.set("factory", focusedFactory) : u.searchParams.delete("factory");
  (focusedFactory && activeFloor2d) ? u.searchParams.set("floor", activeFloor2d) : u.searchParams.delete("floor");
  history.replaceState(null, "", u);
}
function padVB(vb) { const [x, y, w, h] = vb; const px = w * 0.06, py = h * 0.06; return [x - px, y - py, w + px * 2, h + py * 2]; }
let vbAnim = null;
function animateViewBox(target, instant) {
  const from = (svg.getAttribute("viewBox") || baseViewBox.join(" ")).split(/\s+/).map(Number);
  if (instant || from.length !== 4) { svg.setAttribute("viewBox", target.join(" ")); return; }
  const t0 = performance.now(), dur = 420;
  cancelAnimationFrame(vbAnim);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = k * k * (3 - 2 * k);   // smoothstep
    svg.setAttribute("viewBox", from.map((v, i) => v + (target[i] - v) * e).join(" "));
    if (k < 1) vbAnim = requestAnimationFrame(step);
  };
  vbAnim = requestAnimationFrame(step);
}

function buildFloorplan(L) {
  // keep the dotgrid background rect (first child of viewport); rebuild floorplan group
  floorplanG.innerHTML = "";
  roomEls = [];
  facGroups = {};
  districtFactories = (L.factories || []).map((f) => ({ id: f.id, name: f.name, viewBox: f.viewBox || [0, 0, 1120, 780], floors: f.floors || [] }));
  facById = {}; focusedFactory = ""; activeFloor2d = "";
  districtFactories.forEach((f) => (facById[f.id] = f));
  const fpG = (fid, floorId) => {   // sub-<g> per factory (redup) → per lantai (swap); kawasan-level → langsung ke floorplan
    if (!fid || !facById[fid]) return floorplanG;
    const F = facGroups[fid] || (facGroups[fid] = {});
    if (!F.fp) { F.fp = mk("g", { class: "fac2d", "data-factory": fid }); floorplanG.appendChild(F.fp); }
    if (!floorId) return F.fp;
    F.ffp = F.ffp || {};
    if (!F.ffp[floorId]) { const g = mk("g", { class: "floor2d", "data-floor": floorId }); F.fp.appendChild(g); F.ffp[floorId] = g; }
    return F.ffp[floorId];
  };
  (L.rooms || []).forEach((r) => {
    const g = fpG(r.factory, r.floor);
    const rect = mk("rect", { class: "lo-room", x: r.x, y: r.y, width: r.w, height: r.h, rx: 4,
      fill: r.color || "rgba(124,147,184,0.05)" });
    g.appendChild(rect);
    roomEls.push({ room: r, rect });
    if (r.label) {
      const t = mk("text", { class: "lo-label", x: r.x + r.w / 2, y: r.y + r.h / 2 });
      t.textContent = r.label;
      g.appendChild(t);
    }
  });
  (L.walls || []).forEach((w) => {
    const g = fpG(w.factory, w.floor);
    const pts = (w.points || []).map((p) => p.join(",")).join(" ");
    const closeSeg = w.closed && (w.points || []).length > 2 ? " " + w.points[0].join(",") : "";
    g.appendChild(mk("polyline", { class: "lo-wall", points: pts + closeSeg }));
  });
}

function buildPins(pinList) {
  markersG.innerHTML = "";   // buang marker + sub-grup factory/lantai lama
  Object.values(facGroups).forEach((g) => { g.mk = null; g.fmk = null; });
  markerByIp = {}; pins = pinList;
  for (const k in pinByIp) delete pinByIp[k];
  const mkG = (fid, floorId) => {   // sub-<g> marker per factory (redup) → per lantai (swap), sejajar grup floorplan
    if (!fid || !facById[fid]) return markersG;
    const F = facGroups[fid] || (facGroups[fid] = {});
    if (!F.mk) { F.mk = mk("g", { class: "fac2d", "data-factory": fid }); markersG.appendChild(F.mk); }
    if (!floorId) return F.mk;
    F.fmk = F.fmk || {};
    if (!F.fmk[floorId]) { const g = mk("g", { class: "floor2d", "data-floor": floorId }); F.mk.appendChild(g); F.fmk[floorId] = g; }
    return F.fmk[floorId];
  };
  pinList.forEach((p) => {
    pinByIp[p.ip] = p;
    const el = makeMarker(p);
    el.setAttribute("transform", `translate(${p.x} ${p.y})`);
    setLabel(el, p.label || p.ip);
    mkG(p.factory, p.floor).appendChild(el);
    markerByIp[p.ip] = el;
  });
  applyStatus(Object.values(deviceByIp));
}

// ===================================================================
//  WEBSOCKET + live status
// ===================================================================
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const loc = (activeLoc && activeLoc.id) || new URLSearchParams(location.search).get("loc");
  ws = new WebSocket(`${proto}://${location.host}/ws${loc ? "?loc=" + encodeURIComponent(loc) : ""}`);
  ws.onopen = () => { wsRetry = 2000; setConn(true); };                                 // #2
  ws.onclose = () => { setConn(false); setTimeout(connect, wsRetry + Math.random() * 1000); wsRetry = Math.min(30000, wsRetry * 1.7); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "cmd_result") return;
    if (msg.type === "pulse_status") { setConn(msg.up, msg.up ? t("connected") : t("source_offline")); return; }
    if (msg.devices) { applyStatus(msg.devices); lastDataAt = Date.now(); if ($("connDot").classList.contains("stale")) setConn(true); }   // #3
    if (msg.timestamp) { const lu = $("lastUpdate"); if (lu) lu.textContent = `${t("update")} ${msg.timestamp}`; }
  };
}
function setConn(ok, label) {
  $("connDot").classList.remove("stale");   // #3
  $("connDot").classList.toggle("connected", ok);
  $("connLabel").textContent = label || (ok ? t("connected") : t("offline"));
}
// #3 — tandai "Data basi" bila tersambung tapi tak ada payload > STALE_MS
function staleCheck() {
  const dot = $("connDot"), lbl = $("connLabel"); if (!dot || !lbl) return;
  if (!dot.classList.contains("connected") && !dot.classList.contains("stale")) return;
  if (lastDataAt && Date.now() - lastDataAt > STALE_MS) {
    dot.classList.remove("connected"); dot.classList.add("stale");
    lbl.textContent = `Data basi (${Math.floor((Date.now() - lastDataAt) / 1000)}s)`;
  }
}
setInterval(staleCheck, 5000);
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
    // E8: toast hanya utk PERUBAHAN status (bukan snapshot awal)
    const newSt = d ? d.status : null, prev = lastStatus[p.ip];
    if (alertBaseline && newSt && prev !== newSt && window.pulseAlert) {
      if (newSt === "DOWN") window.pulseAlert((d && d.name) || p.label || p.ip, p.ip, "down");
      else if (newSt === "UP" && prev === "DOWN") window.pulseAlert((d && d.name) || p.label || p.ip, p.ip, "up");
    }
    lastStatus[p.ip] = newSt;
  });
  alertBaseline = true;
  if (selectedIp && deviceByIp[selectedIp]) renderDetail(deviceByIp[selectedIp]);
  updateSummary();
  applyFilter();   // E4: pertahankan sorotan filter
  updateZones();   // E2/E7
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

// Ringkasan dihitung dari PIN DI LAYOUT (bukan semua device yang dikirim WS).
function updateSummary() {
  const scoped = pins.filter(inScope);   // kawasan: hanya factory aktif (All = semua)
  const total = scoped.length;
  let up = 0, down = 0, unknown = 0;
  scoped.forEach((p) => {
    const st = deviceByIp[p.ip] ? deviceByIp[p.ip].status : null;
    if (st === "UP") up++; else if (st === "DOWN") down++; else unknown++;
  });
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("totalDevices", total); set("upCount", up); set("downCount", down);
  const uc = $("unknownCount");
  if (uc) { uc.textContent = unknown; const chip = uc.closest(".sp-chip"); if (chip) chip.style.display = unknown ? "" : "none"; }
  const known = up + down;
  const score = (total === 0) ? 100 : (known === 0 ? null : Math.round((up / total) * 100));   // null = belum ada data live
  const el = $("healthScore");
  if (el) { el.textContent = score === null ? "—" : `${score}%`; el.style.color = score === null ? "var(--text-dim)" : score >= 95 ? "var(--up)" : score >= 60 ? "var(--high)" : "var(--down)"; }
  const bar = $("healthBar"); if (bar) bar.style.width = `${score === null ? 0 : score}%`;
  const dot = $("spDot"); if (dot) dot.style.background = down ? "var(--down)" : up ? "var(--up)" : "var(--unknown)";
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
  document.body.classList.add("detail-open");
}
function closeDetail() {
  detailPanel.classList.remove("open");
  document.body.classList.remove("detail-open");
  if (selectedIp && markerByIp[selectedIp]) markerByIp[selectedIp].classList.remove("selected");
  selectedIp = null;
  if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
}
function renderDetail(d) {
  const hasData = d.status != null;
  const isDown = d.status === "DOWN";
  const sev = d.severity || "LOW";
  const availTxt = hasData ? (d.uptimeToday ?? 100) + "%" : "—";
  const trend = (d.history || []).slice(-24);            // E9: kronologis kiri→kanan
  const hist = (d.history || []).slice(-6).reverse();
  const p = pinByIp[d.ip] || { x: "—", y: "—" };
  const rcaps = window.remoteCaps ? window.remoteCaps(d.ip) : { ssh: false, vnc: false };   // kapabilitas remote device ini
  detailContent.innerHTML = `
    <div class="dt-head">
      <div><h2>${esc(d.name)}</h2>
        <div class="dt-ip">${d.ip} · <span class="badge sev-${sev}">${sevIcon(sev)} ${sev}</span></div></div>
      <button class="dt-close" id="dtClose">✕</button>
    </div>
    <div class="dt-body">
      <div class="dt-status-banner ${isDown ? "down" : hasData ? "up" : ""}"${hasData ? "" : ' style="background:var(--hover);color:var(--text-dim);border:1px solid var(--border)"'}><span>●</span><span>${isDown ? t("device_down") : hasData ? t("device_up") : t("no_live_data")}</span>
        ${isDown && d.downSince ? `<span style="margin-left:auto;font-size:12px;font-weight:600" id="dtLive">—</span>` : ""}</div>
      ${hasData ? "" : `<div class="dt-empty" style="margin:0 0 12px">${t("not_reported")}</div>`}
      ${(rcaps.ssh || rcaps.vnc) ? `<div class="dt-actions">
        ${rcaps.ssh ? `<button class="dt-ssh" id="dtSSH">Open SSH</button>` : ``}
        ${rcaps.vnc ? `<button class="dt-ssh vnc" id="dtVNC">Open VNC</button>` : ``}
      </div>` : ``}
      <div class="dt-section">Status Trend</div>
      <div class="mini-trend">${trend.length ? trend.map((h) => `<i class="${h.status === "UP" ? "up" : "down"}"></i>`).join("") : `<span class="empty">${t("no_data_yet")}</span>`}</div>
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
      : `<div class="dt-empty">${t("no_events")}</div>`}</div>
    </div>`;
  $("dtClose").onclick = closeDetail;
  { const b = $("dtSSH"); if (b) b.onclick = () => window.openSSH && window.openSSH(d.ip, d.name); }
  { const v = $("dtVNC"); if (v) v.onclick = () => window.openVNC && window.openVNC(d.ip, d.name); }
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
function sevIcon(sev) { return sev === "CRITICAL" || sev === "HIGH" ? "▲" : sev === "MEDIUM" ? "◆" : "•"; }
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

// ===================================================================
//  FASE E — filter (E4) + fly-to (E3) + hook untuk chrome bersama
// ===================================================================
function applyFilter() {
  pins.forEach((p) => {
    const el = markerByIp[p.ip]; if (!el) return;
    const st = deviceByIp[p.ip] ? deviceByIp[p.ip].status : "UNKNOWN";
    const vis = filterMode === "all" || (filterMode === "up" && st === "UP") || (filterMode === "down" && st === "DOWN");
    el.classList.toggle("dimmed", !vis);
  });
}
function flyTo(ip) {                                    // E3: pusatkan + zoom ke pin
  const p = pinByIp[ip]; if (!p) return;
  const vb = svg.viewBox.baseVal;
  view.k = Math.min(K_MAX, 2.2);
  view.x = (vb.x + vb.width / 2) - view.k * p.x;
  view.y = (vb.y + vb.height / 2) - view.k * p.y;
  viewport.classList.add("flying"); applyView();
  setTimeout(() => viewport.classList.remove("flying"), 450);
}
window.pulseGetTargets = () => pins.map((p) => ({ ip: p.ip, name: (deviceByIp[p.ip] && deviceByIp[p.ip].name) || p.label || p.ip, status: deviceByIp[p.ip] ? deviceByIp[p.ip].status : "UNKNOWN" }));
window.pulseFocus = (ip) => { flyTo(ip); openDetail(ip); };
window.pulseFilter = (mode) => { filterMode = mode || "all"; applyFilter(); };

// ---- E2/E7 — occupancy & pewarnaan zona (zona 2D = ruangan; pin dipetakan ke rect terkecil yg memuatnya) ----
function buildZones(L) {
  zones2d = (L.rooms || []).map((room, i) => ({ name: room.label || `Zona ${i + 1}`, room, rect: roomEls[i] && roomEls[i].rect, ips: [], up: 0, down: 0, total: 0 }));
  pins.forEach((p) => {
    let best = null, bestA = Infinity;
    zones2d.forEach((z) => { const r = z.room; if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { const a = r.w * r.h; if (a < bestA) { bestA = a; best = z; } } });
    if (best) best.ips.push(p.ip);
  });
  updateZones();
}
function updateZones() {
  if (districtFactories.length) { const p = $("zonePanel"); if (p) { p.style.display = "none"; p.innerHTML = ""; } return; }   // kawasan: panel zona by-room lintas factory = bising → ringkasan ber-scope jadi sumber angka
  zones2d.forEach((z) => {
    let up = 0, down = 0;
    z.ips.forEach((ip) => { const d = deviceByIp[ip]; if (d && d.status === "UP") up++; else if (d && d.status === "DOWN") down++; });
    z.up = up; z.down = down; z.total = z.ips.length;
    if (ZONE_TINT && z.rect) { z.rect.classList.toggle("zone-down", down > 0); z.rect.classList.toggle("zone-up", down === 0 && up > 0); }   // E7 (dimatikan)
  });
  renderZonePanel();
}
function renderZonePanel() {
  const panel = $("zonePanel"); if (!panel) return;
  const active = zones2d.filter((z) => z.total > 0);
  if (!active.length) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  panel.style.display = "";
  panel.innerHTML = `<div class="sp-zones-title">Zona (${active.length})</div>` + active.map((z) =>
    `<div class="zone-row" data-zi="${zones2d.indexOf(z)}"><span class="zone-dot ${z.down > 0 ? "down" : z.up > 0 ? "up" : ""}"></span><span class="zone-name">${esc(z.name)}</span><span class="zone-stat"><b class="${z.down > 0 ? "has-down" : ""}">${z.up}</b>/${z.total}</span></div>`
  ).join("");
  panel.querySelectorAll(".zone-row").forEach((row) => (row.onclick = () => flyToZone(zones2d[+row.dataset.zi])));
}
function flyToZone(z) {
  if (!z || !z.room) return;
  const r = z.room, vb = svg.viewBox.baseVal;
  const k = Math.min(K_MAX, Math.max(1, Math.min(vb.width / Math.max(r.w, 1), vb.height / Math.max(r.h, 1)) * 0.6));
  view.k = k; view.x = (vb.x + vb.width / 2) - k * (r.x + r.w / 2); view.y = (vb.y + vb.height / 2) - k * (r.y + r.h / 2);
  viewport.classList.add("flying"); applyView();
  setTimeout(() => viewport.classList.remove("flying"), 450);
}

// ===== Start =====
applyView();
boot();
