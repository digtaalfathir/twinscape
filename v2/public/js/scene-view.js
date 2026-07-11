/* =====================================================================
   Scene View (v2) — RUNTIME consumer of scene.json.
   Loads a scene authored in Scene Builder, rebuilds walls/floors/models/
   pins + lighting + camera, then attaches LIVE device status from the same
   /ws WebSocket (green=UP, red=DOWN) to any object with a matching IP.
   Rendering matches Scene Builder (ACES + soft shadows, NO bloom) → WYSIWYG.
   ES module. Standalone; touches no v1 code.
   ===================================================================== */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// ---- DOM ----
const stage = document.getElementById("stage");
const canvas = document.getElementById("glcanvas");
const tooltip = document.getElementById("tooltip");
const detailPanel = document.getElementById("detailPanel");
const detailContent = document.getElementById("detailContent");
const splash = document.getElementById("splash");
const splashMsg = document.getElementById("splashMsg");
const $ = (id) => document.getElementById(id);

// ---- three ----
let scene, camera, renderer, labelRenderer, controls, raycaster, clock;
let hemi, amb, keyLight, built;
const loader = new GLTFLoader();
const ndc = new THREE.Vector2();

// ---- state ----
let deviceByIp = {};        // live data from WS
const deviceObjs = {};      // ip -> { bc, name, status }
const rayTargets = [];      // beacon balls (raycast)
const labelEls = [];        // device labels (toggle)
let selectedIp = null, dtTimer = null, labelsVisible = true;
const modelCache = {};      // A2: url -> Promise<gltf.scene> (load-once, lalu clone)

const STATUS_HEX = { UP: 0x10b981, DOWN: 0xef4444 };
const UNKNOWN_HEX = 0x6b7280;

// =====================================================================
try {
  initThree();
  bindInteraction();
  animate();
  connectWS();
  loadDefaultScene();
} catch (err) { showError(err); }

function initThree() {
  const w = stage.clientWidth, h = stage.clientHeight;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b14);

  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 3000);
  camera.position.set(28, 24, 32);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // A3: shadow OFF dari awal (flat & ringan) — tanpa toggle.

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch (e) { console.warn("env map dilewati:", e); }

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  Object.assign(labelRenderer.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
  stage.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 1, 0);

  hemi = new THREE.HemisphereLight(0x9fb4d8, 0x0a0e1a, 0.45);
  amb = new THREE.AmbientLight(0x1a2436, 0.22);
  keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(40, 60, 30);       // arah default (dioverride scene.lighting)
  scene.add(hemi, amb, keyLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x0e131d, roughness: 0.98, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // A3: grid dihilangkan (default off, tanpa toggle)

  built = new THREE.Group();
  scene.add(built);
  window.addEventListener("resize", onResize);
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock ? clock.getElapsedTime() : 0;
  for (const ip in deviceObjs) {
    const o = deviceObjs[ip];
    if (o.status === "DOWN") {
      const ph = (t * 0.9) % 1;
      o.bc.halo.scale.setScalar(1 + ph * 1.8);
      o.bc.halo.material.opacity = 0.4 * (1 - ph);
    } else {
      o.bc.halo.scale.setScalar(1.05);
      o.bc.halo.material.opacity = 0.1;
    }
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
function onResize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
}

// =====================================================================
//  LOAD SCENE
// =====================================================================
async function loadDefaultScene() {
  const url = new URLSearchParams(location.search).get("scene") || "/scene.json";
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = JSON.parse(await res.text());   // throws if it's the SPA-fallback HTML
    buildFromScene(data, url);
    hideSplash();
  } catch (e) {
    splash.classList.remove("hidden"); splash.classList.remove("error");
    splashMsg.innerHTML = `Belum ada <b>${url}</b>.<br>Export dari Scene Builder → taruh file <b>scene.json</b> di folder <b>public/</b>, ` +
      `atau klik tombol <b>“Muat scene.json”</b> di atas untuk mencoba file dari komputer.`;
  }
}
$("btnLoad").onclick = () => $("fileScene").click();
$("fileScene").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  f.text().then((t) => { try { buildFromScene(JSON.parse(t), f.name); hideSplash(); } catch { showError("scene.json tidak valid"); } });
};

function clearBuilt() {
  scene.remove(built);
  built.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
  built = new THREE.Group(); scene.add(built);
  for (const k in deviceObjs) delete deviceObjs[k];
  rayTargets.length = 0; labelEls.length = 0;
  selectedIp = null; closeDetail();
}

// A1 — frame seluruh scene di tengah (dipakai kalau scene.json tak punya camera)
function fitCameraToScene() {
  const box = new THREE.Box3().setFromObject(built);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z, size.y) || 10;
  controls.target.copy(center);
  const dist = maxDim * 1.4 + 6;
  camera.position.set(center.x + dist * 0.6, Math.max(center.y + dist * 0.7, dist * 0.5), center.z + dist * 0.9);
  camera.far = Math.max(3000, maxDim * 25);
  camera.updateProjectionMatrix();
  controls.update();
}

function buildFromScene(s, name) {
  clearBuilt();
  $("sceneInfo").textContent = `scene: ${name || "scene.json"}`;

  if (s.lighting) applyLighting(s.lighting);

  if (s.walls && s.walls.length) built.add(buildWallsMerged(s.walls));   // A2: 1 mesh per warna
  (s.floors || []).forEach((d) => built.add(buildFloor(d)));
  (s.texts || []).forEach((d) => built.add(makeTextSprite(d)));
  (s.pins || []).forEach((d) => addPinDevice(d));
  (s.models || []).forEach((d) => addModel(d));

  if (s.camera && s.camera.position && s.camera.target) {
    camera.position.fromArray(s.camera.position);
    controls.target.fromArray(s.camera.target);
    controls.update();
  } else {
    fitCameraToScene();                       // A1: kalau tak ada camera → auto-center/fit
  }
  // re-apply any live status we already have
  if (Object.keys(deviceByIp).length) applyStatus(Object.values(deviceByIp));
}

function applyLighting(L) {
  if (L.exposure != null) renderer.toneMappingExposure = L.exposure;
  const el = THREE.MathUtils.degToRad(L.sunElevation ?? 55);
  const az = THREE.MathUtils.degToRad(L.sunAzimuth ?? 40);
  const R = 70;
  keyLight.position.set(R * Math.cos(el) * Math.cos(az), R * Math.sin(el), R * Math.cos(el) * Math.sin(az));
  keyLight.intensity = L.sunIntensity ?? 2.1;
  hemi.intensity = L.ambient ?? 0.45;
  amb.intensity = (L.ambient ?? 0.45) * 0.5;
}

// =====================================================================
//  GEOMETRY BUILDERS (identical to Scene Builder → WYSIWYG)
// =====================================================================
// A2 — kumpulkan SEMUA geometri tembok (transform sudah di-bake ke vertex) per
// warna, lalu MERGE jadi 1 mesh per warna → tekan draw-call drastis.
// (Tembok tidak perlu di-raycast di viewer, jadi aman digabung.)
function buildWallsMerged(walls) {
  const byColor = {};
  walls.forEach((d) => collectWallGeoms(d, byColor));
  const group = new THREE.Group();
  for (const hex in byColor) {
    const merged = BufferGeometryUtils.mergeGeometries(byColor[hex], false);
    byColor[hex].forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: parseInt(hex), roughness: 0.6, metalness: 0.12, envMapIntensity: 0.9 }));
    group.add(mesh);
  }
  return group;
}
function collectWallGeoms(d, byColor) {
  const hex = new THREE.Color(d.color || "#8fa3c4").getHex();
  const arr = (byColor[hex] = byColor[hex] || []);
  const pts = d.points || [], openings = d.openings || [], H = d.height || 3, T = d.thickness || 0.15;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push(i);
  if (d.closed && pts.length > 2) segs.push(pts.length - 1);
  const q = new THREE.Quaternion(), eu = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  segs.forEach((i) => {
    const a = i < pts.length - 1 ? pts[i] : pts[pts.length - 1];
    const b = i < pts.length - 1 ? pts[i + 1] : pts[0];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-3) return;
    const ux = dx / L, uz = dz / L, ang = -Math.atan2(dz, dx);
    const add = (s, e2, y0, y1) => {
      const len = e2 - s; if (len < 1e-3 || y1 - y0 < 1e-3) return;
      const mid = (s + e2) / 2;
      const geo = new THREE.BoxGeometry(len, y1 - y0, T);
      eu.set(0, ang, 0); q.setFromEuler(eu);
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(a[0] + ux * mid, (y0 + y1) / 2, a[1] + uz * mid), q, one));
      arr.push(geo);
    };
    const ops = openings.filter((o) => o.seg === i).sort((p, r) => p.dist - r.dist);
    if (!ops.length) { add(-T / 2, L + T / 2, 0, H); return; }
    let cur = 0;
    ops.forEach((op) => {
      const os = Math.max(0, op.dist - op.width / 2), oe = Math.min(L, op.dist + op.width / 2);
      if (os > cur) add(cur === 0 ? -T / 2 : cur, os, 0, H);
      const top = Math.min(H, op.top ?? H), sill = Math.max(0, op.sill ?? 0);
      if (top < H) add(os, oe, top, H);
      if (sill > 0) add(os, oe, 0, sill);
      cur = oe;
    });
    if (cur < L) add(cur, L + T / 2, 0, H);
  });
}

const FLOOR_COL = { concrete: 0x3a3f47, green: 0x1f9e55, office: 0x8790a0 };
function buildFloor(d) {
  const col = d.type === "custom" ? new THREE.Color(d.color).getHex() : (FLOOR_COL[d.type] ?? 0x3a3f47);
  const mat = new THREE.MeshStandardMaterial({
    color: col, roughness: d.type === "green" ? 0.6 : 0.92, metalness: 0,
    emissive: d.type === "green" ? 0x0c3f22 : 0x000000, emissiveIntensity: d.type === "green" ? 0.35 : 0,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(d.x, 0.02 + (d.order || 0) * 0.006, d.z);   // order = which floor sits in front
  m.renderOrder = d.order || 0;
  m.receiveShadow = true;
  return m;
}

// text label (sprite) — identical to Scene Builder
function makeTextSprite(d) {
  const text = d.text || "Teks";
  const fpx = 64;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `700 ${fpx}px Inter, Arial, sans-serif`;
  const cw = Math.ceil(probe.measureText(text).width) + 28, ch = fpx + 24;
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext("2d");
  ctx.font = `700 ${fpx}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(5,7,15,0.85)"; ctx.strokeText(text, cw / 2, ch / 2);
  ctx.fillStyle = d.color || "#e2e8f0"; ctx.fillText(text, cw / 2, ch / 2);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const hgt = d.size || 1;
  spr.scale.set(hgt * (cw / ch), hgt, 1);
  spr.position.set(d.x, d.y ?? 1.6, d.z);
  return spr;
}

// =====================================================================
//  DEVICE MARKERS (status beacons)
// =====================================================================
function makeBeacon(ballY, withStem) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 36),
    new THREE.MeshBasicMaterial({ color: UNKNOWN_HEX, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  let stem = null;
  if (withStem) {
    const hgt = Math.max(0.4, ballY - 0.1);
    stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, hgt, 10),
      new THREE.MeshStandardMaterial({ color: UNKNOWN_HEX, emissive: UNKNOWN_HEX, emissiveIntensity: 0.3 }));
    stem.position.y = hgt / 2; stem.castShadow = true;
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 22),
    new THREE.MeshStandardMaterial({ color: UNKNOWN_HEX, emissive: UNKNOWN_HEX, emissiveIntensity: 0.7, roughness: 0.4 }));
  ball.position.y = ballY; ball.castShadow = true;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 18),
    new THREE.MeshBasicMaterial({ color: UNKNOWN_HEX, transparent: true, opacity: 0.12, depthWrite: false }));
  halo.position.y = ballY;
  g.add(ring, ball, halo); if (stem) g.add(stem);
  return { group: g, ring, stem, ball, halo };
}
function recolorBeacon(bc, hex) {
  bc.ring.material.color.setHex(hex);
  bc.ball.material.color.setHex(hex); bc.ball.material.emissive.setHex(hex);
  bc.halo.material.color.setHex(hex);
  if (bc.stem) { bc.stem.material.color.setHex(hex); bc.stem.material.emissive.setHex(hex); }
}
function registerDevice(ip, name, bc) {
  if (!ip) return;
  bc.ball.userData.ip = ip;
  rayTargets.push(bc.ball);
  const el = document.createElement("div");
  el.className = "mk3d-label";
  el.textContent = name || ip;
  el.style.display = labelsVisible ? "" : "none";
  labelEls.push(el);
  const lbl = new CSS2DObject(el);
  lbl.position.y = bc.ball.position.y + 0.5;
  bc.group.add(lbl);
  deviceObjs[ip] = { bc, name: name || ip, status: "UNKNOWN", labelEl: el };
}

function addPinDevice(d) {
  const bc = makeBeacon(2.35, true);
  bc.group.position.set(d.x, 0, d.z);
  built.add(bc.group);
  registerDevice(d.ip, d.label || d.ip, bc);
}

// A2 — load tiap .glb SEKALI, lalu clone untuk tiap instance (hemat parse + share buffer GPU).
function loadModelOnce(url) {
  if (!modelCache[url]) modelCache[url] = new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej));
  return modelCache[url];
}
function addModel(d) {
  loadModelOnce(d.url).then((proto) => {
    const root = proto.clone(true);
    root.position.fromArray(d.position || [0, 0, 0]);
    if (Array.isArray(d.rotation)) root.rotation.set(d.rotation[0] || 0, d.rotation[1] || 0, d.rotation[2] || 0);
    else root.rotation.set(0, d.rotationY || 0, 0);
    if (Array.isArray(d.scale)) root.scale.set(d.scale[0] || 1, d.scale[1] || 1, d.scale[2] || 1);
    else root.scale.setScalar(d.scale || 1);
    built.add(root);
    if (d.deviceIp) {
      const box = new THREE.Box3().setFromObject(root);
      const topY = isFinite(box.max.y) ? box.max.y : (d.position?.[1] || 0) + 2;
      const bc = makeBeacon(topY + 1, false);
      bc.group.position.set(d.position?.[0] || 0, 0, d.position?.[2] || 0);
      built.add(bc.group);
      registerDevice(d.deviceIp, d.name || d.deviceIp, bc);
      if (Object.keys(deviceByIp).length) applyStatus(Object.values(deviceByIp));
    }
  }).catch(() => console.warn("model tak ditemukan:", d.url));
}

// =====================================================================
//  LIVE STATUS
// =====================================================================
function applyStatus(devices) {
  devices.forEach((d) => {
    const o = deviceObjs[d.ip];
    if (!o) return;
    o.status = d.status;
    recolorBeacon(o.bc, STATUS_HEX[d.status] ?? UNKNOWN_HEX);
  });
  if (selectedIp && deviceByIp[selectedIp]) renderDetail(deviceByIp[selectedIp]);
}
function updateSummary(devices) {
  const total = devices.length;
  const up = devices.filter((d) => d.status === "UP").length;
  $("totalDevices").textContent = total; $("upCount").textContent = up; $("downCount").textContent = total - up;
  const score = total > 0 ? ((up / total) * 100).toFixed(1) : "100.0";
  const el = $("healthScore"); el.textContent = `${score}%`;
  el.style.color = score >= 95 ? "var(--up)" : score >= 80 ? "var(--high)" : "var(--down)";
}

// =====================================================================
//  INTERACTION
// =====================================================================
function bindInteraction() {
  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();
  let dn = null, moved = false;
  canvas.addEventListener("pointerdown", (e) => { dn = { x: e.clientX, y: e.clientY }; moved = false; });
  canvas.addEventListener("pointermove", (e) => {
    if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 5) moved = true;
    if (!dn) hover(e);
  });
  window.addEventListener("pointerup", (e) => { if (dn && !moved) click(e); dn = null; });
  canvas.addEventListener("pointerleave", hideTooltip);

  $("resetView").onclick = () => { camera.position.set(28, 24, 32); controls.target.set(0, 1, 0); controls.update(); };
  $("toggleLabels").onclick = () => { labelsVisible = !labelsVisible; labelEls.forEach((el) => (el.style.display = labelsVisible ? "" : "none")); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
}
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(rayTargets, false);
  return hits.length ? hits[0].object.userData.ip : null;
}
function hover(e) {
  const ip = pick(e);
  if (ip) { canvas.style.cursor = "pointer"; showTooltip(ip, e); }
  else { canvas.style.cursor = ""; hideTooltip(); }
}
function click(e) {
  const ip = pick(e);
  if (ip) openDetail(ip); else closeDetail();
}

// ---- tooltip + detail (same markup as other 3D views) ----
function showTooltip(ip, e) {
  const d = deviceByIp[ip];
  const o = deviceObjs[ip];
  const name = (d && d.name) || (o && o.name) || ip;
  const isDown = d && d.status === "DOWN";
  tooltip.innerHTML = `
    <div class="tt-name">${esc(name)}</div>
    <div class="tt-ip">${ip}</div>
    <div class="tt-row"><span>Status</span><span class="${isDown ? "tt-down" : "tt-up"}">${(d && d.status) || "—"}</span></div>
    <div class="tt-row"><span>Latency</span><span>${d && d.latency != null ? d.latency + " ms" : "—"}</span></div>
    <div class="tt-row"><span>Availability</span><span>${(d && d.uptimeToday) ?? "—"}%</span></div>`;
  tooltip.classList.add("show"); moveTooltip(e);
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
document.addEventListener("pointermove", (e) => { if (tooltip.classList.contains("show")) moveTooltip(e); });

function openDetail(ip) { selectedIp = ip; if (deviceByIp[ip]) renderDetail(deviceByIp[ip]); detailPanel.classList.add("open"); }
function closeDetail() { detailPanel.classList.remove("open"); selectedIp = null; if (dtTimer) { clearInterval(dtTimer); dtTimer = null; } }
function renderDetail(d) {
  const isDown = d.status === "DOWN";
  const avail = d.uptimeToday ?? 100;
  const hist = (d.history || []).slice(-6).reverse();
  detailContent.innerHTML = `
    <div class="dt-head">
      <div><h2>${esc(d.name)}</h2><div class="dt-ip">${d.ip} · <span class="badge sev-${d.severity || "LOW"}">${d.severity || "—"}</span></div></div>
      <button class="dt-close" id="dtClose">✕</button>
    </div>
    <div class="dt-body">
      <div class="dt-status-banner ${isDown ? "down" : "up"}"><span>●</span><span>${isDown ? "DEVICE DOWN" : "DEVICE UP"}</span>
        ${isDown && d.downSince ? `<span style="margin-left:auto;font-size:12px;font-weight:600" id="dtLive">—</span>` : ""}</div>
      <div class="dt-section">Network Quality</div>
      <div class="dt-grid">
        <div class="dt-item"><div class="dt-label">Availability</div><div class="dt-val ${avail >= 99 ? "up" : "down"}">${avail}%</div></div>
        <div class="dt-item"><div class="dt-label">Latency</div><div class="dt-val">${d.latency != null ? d.latency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Avg</div><div class="dt-val">${d.avgLatency != null ? d.avgLatency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Peak</div><div class="dt-val">${d.maxLatency != null ? d.maxLatency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Downtime</div><div class="dt-val">${fmtSec(d.downtimeTodaySec ?? 0)}</div></div>
        <div class="dt-item"><div class="dt-label">Severity</div><div class="dt-val" style="font-size:13px">${d.severity || "—"}</div></div>
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

// =====================================================================
//  WEBSOCKET (same endpoint as v1; read-only)
// =====================================================================
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => setConn(true);
  ws.onclose = () => { setConn(false); setTimeout(connectWS, 3000); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "cmd_result") return;
    if (m.devices) { m.devices.forEach((d) => (deviceByIp[d.ip] = d)); applyStatus(m.devices); updateSummary(m.devices); }
    if (m.timestamp) $("lastUpdate").textContent = `Last update: ${m.timestamp}`;
  };
}
function setConn(ok) {
  $("connDot").classList.toggle("connected", ok);
  $("connLabel").textContent = ok ? "Connected" : "Disconnected";
}

// ---- util ----
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function fmtSec(s) { if (!s) return "0s"; const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`; }
function hideSplash() { splash.classList.add("hidden"); }
function showError(err) {
  console.error(err);
  splash.classList.remove("hidden"); splash.classList.add("error");
  splashMsg.textContent = "Gagal memuat tampilan 3D: " + (err && err.message ? err.message : err) + ". Cek Console (F12).";
}
