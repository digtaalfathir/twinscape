/* =====================================================================
   Scene Builder (v2) — author a 3D "digital twin" once, export scene.json.
   Units = meters. Standalone; no v1 code touched.
   Features: default area/size, wall openings (door/window), layout guides
   (angle-snap + length/angle readout), copy/paste, text labels, floor
   layering (which floor is in front).
   ===================================================================== */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ---- DOM ----
const view = document.getElementById("view");
const canvas = document.getElementById("c3d");
let glLost = false, renderPaused = false;   // stabilitas GPU (context-lost / tab tersembunyi)
const tipEl = document.getElementById("tip");
const $ = (id) => document.getElementById(id);

// ---- three globals ----
let scene, camera, renderer, composer = null, bloomPass = null, controls, transform;
let hemi, amb, keyLight, plotGuide = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const loader = new GLTFLoader();

// ---- data model ----
let objects = [];         // { id, type, obj, data }
const byId = {};
let idc = 1;
let mode = "select";
const MODE_LABEL = { select: "Pilih", wall: "Tembok", floor: "Lantai", door: "Pintu/Jendela", pin: "Pin Device", text: "Teks" };
let selected = null;
let snapOn = true;
let draggingGizmo = false;
let refPlane = null, refAspect = 1;
let floorOrder = 0;       // z-layer counter for floors
let clipboard = null;     // for copy/paste
let history = [], redoStack = [];   // B2: undo/redo (snapshots of scene JSON)
const HISTORY_MAX = 60;
let wallHandles = null;   // B1: draggable vertex handles for selected wall
let vDrag = null;         // B1: { rec, vi } while dragging a wall vertex
let selection = [];       // multi-select (array of records); `selected` = primary (terakhir)
let selectionHelpers = []; // BoxHelper kuning saat pilih >1 objek
const SNAP_DIST = 0.6;    // B5 snapping (jarak snap, meter)
let snapMarker = null, snapGuideX = null, snapGuideZ = null;   // deklarasi di atas (dipakai clearSnapViz saat init)

const lighting = {
  exposure: 1.05, sunElevation: 55, sunAzimuth: 40, sunIntensity: 2.1,
  ambient: 0.45, bloom: { strength: 0, threshold: 0.9, radius: 0.5 },
};

// ---- drafting ----
let wallDraft = null;     // { pts:[Vector3], line, dots:Group }
let floorStart = null, floorPreview = null;

const r3 = (n) => Math.round(n * 1000) / 1000;

// =====================================================================
window.addEventListener("error", (e) => {
  if (e.target && e.target !== window) return;
  showFatal((e.error && e.error.stack) || e.message || "unknown error");
});
window.addEventListener("unhandledrejection", (e) => showFatal("Promise: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
try {
  init();
  window.__sbReady = true;
} catch (err) { showFatal((err && err.stack) || String(err)); }

function showFatal(msg) {
  console.error("[SceneBuilder]", msg);
  let el = document.getElementById("fatal");
  if (!el) {
    el = document.createElement("div");
    el.id = "fatal";
    el.style.cssText = "position:absolute;inset:0;z-index:99;background:rgba(10,14,26,0.96);color:#fca5a5;" +
      "padding:22px;font:12px/1.6 ui-monospace,monospace;overflow:auto;white-space:pre-wrap;";
    (document.getElementById("view") || document.body).appendChild(el);
  }
  el.textContent = "⚠️ Scene Builder error (kirim teks ini ke saya):\n\n" + msg;
}

function init() {
  const w = view.clientWidth || 800, h = view.clientHeight || 600;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b14);
  scene.fog = new THREE.Fog(0x080b14, 120, 400);

  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
  camera.position.set(28, 24, 32);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch (e) { console.warn("[SceneBuilder] environment map dilewati:", e); }

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 1, 0);

  try {
    transform = new TransformControls(camera, canvas);
    transform.setTranslationSnap(0.5);
    transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    transform.addEventListener("dragging-changed", (e) => { draggingGizmo = e.value; controls.enabled = !e.value; if (e.value) pushHistory(); });
    scene.add(transform.getHelper());
  } catch (e) { console.warn("[SceneBuilder] TransformControls dilewati:", e); transform = null; }

  hemi = new THREE.HemisphereLight(0x9fb4d8, 0x0a0e1a, lighting.ambient);
  amb = new THREE.AmbientLight(0x1a2436, lighting.ambient * 0.5);
  keyLight = new THREE.DirectionalLight(0xffffff, lighting.sunIntensity);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.6;
  const sc = keyLight.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
  sc.updateProjectionMatrix();
  scene.add(hemi, amb, keyLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x090d15, roughness: 1, metalness: 0, envMapIntensity: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true; ground.name = "__ground";
  scene.add(ground);
  const grid = new THREE.GridHelper(160, 160, 0x263352, 0x172036);
  grid.position.y = 0.001; grid.material.transparent = true; grid.material.opacity = 0.45;
  scene.add(grid);

  applyLighting();
  bindUI();
  bindPointer();
  updatePlot();
  setMode("select");
  window.addEventListener("resize", onResize);
  // stabilitas GPU: bebaskan context saat tinggalkan halaman, pause saat tab tersembunyi, tangani context-lost
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); glLost = true; try { toast("Tampilan 3D terputus (GPU sibuk). Muat ulang halaman.", false); } catch (x) {} }, false);
  canvas.addEventListener("webglcontextrestored", () => { glLost = false; }, false);
  window.addEventListener("pagehide", () => { try { renderer.forceContextLoss(); renderer.dispose(); } catch (x) {} });
  document.addEventListener("visibilitychange", () => { renderPaused = document.hidden; });
  animate();
  loadCatalog();
}

function animate() {
  requestAnimationFrame(animate);
  if (glLost || renderPaused) return;   // jangan render saat context hilang / tab tersembunyi
  controls.update();
  renderer.render(scene, camera);
}
function onResize() {
  const w = view.clientWidth, h = view.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// =====================================================================
//  LIGHTING
// =====================================================================
function applyLighting() {
  renderer.toneMappingExposure = lighting.exposure;
  const el = THREE.MathUtils.degToRad(lighting.sunElevation);
  const az = THREE.MathUtils.degToRad(lighting.sunAzimuth);
  const R = 70;
  keyLight.position.set(R * Math.cos(el) * Math.cos(az), R * Math.sin(el), R * Math.cos(el) * Math.sin(az));
  keyLight.intensity = lighting.sunIntensity;
  hemi.intensity = lighting.ambient;
  amb.intensity = lighting.ambient * 0.5;
}

// =====================================================================
//  MODES
// =====================================================================
function setMode(m) {
  cancelWall(); cancelFloor();
  mode = m;
  document.querySelectorAll(".btn.mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  if (m !== "select") { transform?.detach(); clearWallHandles(); clearSelectionHelpers(); selection = []; selected = null; }
  $("statMode").innerHTML = `Mode: <b>${MODE_LABEL[m]}</b>`;
  updateInspector();
  setTip();
}
function setTip() {
  const tips = {
    select: "<b>Pilih</b>: klik objek. Model/Pin/Teks bisa digeser (gizmo). <b>Ctrl+D</b> duplikat · <b>Delete</b> hapus.",
    wall: "<b>Tembok</b>: klik titik demi titik. <b>Enter</b>/dobel-klik = selesai · <b>Esc</b> batal. Aktifkan “Lurus” agar sudut ngunci.",
    floor: "<b>Lantai</b>: klik 2 sudut untuk kotak lantai.",
    door: "<b>Pintu/Jendela</b>: klik di sebuah <b>tembok</b> untuk melubanginya.",
    pin: "<b>Pin</b>: klik di lantai untuk menaruh titik status device.",
    text: "<b>Teks</b>: isi teks di panel kanan lalu klik di lantai untuk menaruhnya.",
  };
  tipEl.innerHTML = tips[mode] || "";
}

// =====================================================================
//  RAYCAST helpers
// =====================================================================
function groundPoint(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(GROUND, p)) return null;
  if (snapOn) { p.x = Math.round(p.x * 2) / 2; p.z = Math.round(p.z * 2) / 2; p.y = 0; }
  return p;
}
function setNdc(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
// ---- B5: snapping (vertex-snap + axis-align guides) + angle-snap "Lurus" ----
function clearSnapViz() {
  [snapMarker, snapGuideX, snapGuideZ].forEach((o) => o && scene.remove(o));
  snapMarker = snapGuideX = snapGuideZ = null;
}
function collectVertices(exclude) {
  const out = [];
  objects.forEach((o) => { if (o.type === "wall" && o !== exclude) o.data.points.forEach((pt) => out.push({ x: pt[0], z: pt[1] })); });
  if (wallDraft) wallDraft.pts.forEach((v) => out.push({ x: v.x, z: v.z }));
  return out;
}
function guideLine() {
  const g = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x22e0a0, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.6 }));
  scene.add(g); return g;
}
// vertex-snap (menang) → angle-snap "Lurus" (relatif prev) → axis-align guide
function resolveSnap(raw, exclude, angleSnap, prev) {
  clearSnapViz();
  if (!raw) return raw;
  const cands = collectVertices(exclude);
  let best = null, bd = SNAP_DIST;
  cands.forEach((c) => { const d = Math.hypot(c.x - raw.x, c.z - raw.z); if (d < bd) { bd = d; best = c; } });
  if (best) {
    if (!snapMarker) { snapMarker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0x22e0a0, side: THREE.DoubleSide })); snapMarker.rotation.x = -Math.PI / 2; scene.add(snapMarker); }
    snapMarker.position.set(best.x, 0.15, best.z);
    return new THREE.Vector3(best.x, 0, best.z);
  }
  let p = raw;
  if (angleSnap && prev) {
    let ang = Math.atan2(raw.z - prev.z, raw.x - prev.x);
    const step = Math.PI / 12; ang = Math.round(ang / step) * step;
    let len = Math.hypot(raw.x - prev.x, raw.z - prev.z); if (snapOn) len = Math.round(len * 2) / 2;
    p = new THREE.Vector3(prev.x + Math.cos(ang) * len, 0, prev.z + Math.sin(ang) * len);
  }
  let ax = null, az = null;
  cands.forEach((c) => { if (ax === null && Math.abs(c.x - p.x) < SNAP_DIST) ax = c.x; if (az === null && Math.abs(c.z - p.z) < SNAP_DIST) az = c.z; });
  if (ax !== null) { p = new THREE.Vector3(ax, 0, p.z); snapGuideX = guideLine(); snapGuideX.geometry.setFromPoints([new THREE.Vector3(ax, 0.12, -200), new THREE.Vector3(ax, 0.12, 200)]); snapGuideX.computeLineDistances(); }
  if (az !== null) { p = new THREE.Vector3(p.x, 0, az); snapGuideZ = guideLine(); snapGuideZ.geometry.setFromPoints([new THREE.Vector3(-200, 0.12, az), new THREE.Vector3(200, 0.12, az)]); snapGuideZ.computeLineDistances(); }
  return p;
}
function wallSnapCursor(raw) {
  const prev = wallDraft?.pts.length ? wallDraft.pts[wallDraft.pts.length - 1] : null;
  return resolveSnap(raw, null, $("wallStraight")?.checked, prev);
}

// =====================================================================
//  POINTER
// =====================================================================
function bindPointer() {
  let dn = null;
  canvas.addEventListener("pointerdown", (e) => {
    dn = { x: e.clientX, y: e.clientY };
    // B1: mulai geser vertex tembok bila klik salah satu handle kuning
    if (mode === "select" && wallHandles && selected?.type === "wall") {
      setNdc(e);
      const hits = raycaster.intersectObjects(wallHandles.children, false);
      if (hits.length) { pushHistory(); vDrag = { rec: selected, vi: hits[0].object.userData.vi }; controls.enabled = false; }
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (vDrag) {
      const raw = groundPoint(e); if (!raw) return;
      const p = resolveSnap(raw, vDrag.rec, false, null);   // B5: snap vertex ke titik/align
      vDrag.rec.data.points[vDrag.vi] = [r3(p.x), r3(p.z)];
      rebuildWall(vDrag.rec); positionWallHandles(vDrag.rec);
      $("statCoords").textContent = `vertex → ${p.x.toFixed(1)}, ${p.z.toFixed(1)} m`;
      return;
    }
    const raw = groundPoint(e);
    const p = mode === "wall" ? wallSnapCursor(raw) : raw;
    if (p) $("statCoords").textContent = `x: ${p.x.toFixed(1)}  z: ${p.z.toFixed(1)} m`;
    if (mode === "wall" && wallDraft) updateWallPreview(p);
    if (mode === "floor" && floorStart) updateFloorPreview(p);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (vDrag) { vDrag = null; controls.enabled = true; dn = null; clearSnapViz(); refreshList(); return; }
    if (!dn) return;
    const moved = Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 5;
    dn = null;
    if (moved || draggingGizmo) return;
    tap(e);
  });
  window.addEventListener("pointerup", () => { if (vDrag) { vDrag = null; controls.enabled = true; clearSnapViz(); refreshList(); } });
  canvas.addEventListener("dblclick", () => { if (mode === "wall") finishWall(); });
  // B4 — drag model dari katalog → jatuhkan ke lantai
  canvas.addEventListener("dragover", (e) => e.preventDefault());
  canvas.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.getData("text/model-file"); if (f) loadModelByPath(f, groundPoint(e)); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(selection); return; }
    if (ctrl && e.key.toLowerCase() === "c") { if (selection.length) clipboard = selection.slice(); return; }
    if (ctrl && e.key.toLowerCase() === "v") { if (clipboard) duplicate(clipboard); return; }
    if (e.key === "Enter" && mode === "wall") finishWall();
    if (e.key === "Escape") { cancelWall(); cancelFloor(); if (mode !== "select") setMode("select"); }
    if ((e.key === "Delete" || e.key === "Backspace") && selection.length) removeSelection();
  });
}
function tap(e) {
  if (mode === "select") { pickAt(e); return; }
  if (mode === "door") { doorTap(e); return; }
  const raw = groundPoint(e);
  const p = mode === "wall" ? wallSnapCursor(raw) : raw;
  if (!p) return;
  if (mode === "wall") addWallPoint(p);
  else if (mode === "floor") floorTap(p);
  else if (mode === "pin") placePin(p);
  else if (mode === "text") placeText(p);
}
function pickAt(e) {
  setNdc(e);
  const hits = raycaster.intersectObjects(objects.map((o) => o.obj), true);
  const rec = hits.length ? recordOf(hits[0].object) : null;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (!rec && additive) return;              // shift/ctrl + klik kosong: jangan hapus selection
  select(rec, additive);
}
function recordOf(o) {
  while (o) { if (o.userData && o.userData.recId != null) return byId[o.userData.recId]; o = o.parent; }
  return null;
}

// =====================================================================
//  OBJECTS
// =====================================================================
function addObject(type, obj, data) {
  const id = idc++;
  obj.userData.recId = id;
  const rec = { id, type, obj, data };
  objects.push(rec); byId[id] = rec;
  scene.add(obj);
  refreshList();
  return rec;
}
function removeCore(rec) {
  scene.remove(rec.obj);
  objects = objects.filter((o) => o !== rec);
  delete byId[rec.id];
  const si = selection.indexOf(rec); if (si >= 0) selection.splice(si, 1);
  if (Array.isArray(clipboard)) { const ci = clipboard.indexOf(rec); if (ci >= 0) clipboard.splice(ci, 1); }
}
function removeRecord(rec) {              // hapus 1 objek (tombol ✕ di daftar)
  if (!rec) return;
  pushHistory();
  removeCore(rec);
  if (selected === rec) { transform?.detach(); clearWallHandles(); selected = selection[selection.length - 1] || null; }
  updateSelectionHelpers(); refreshList(); updateInspector();
}
function removeSelection() {              // hapus SEMUA yang terpilih
  if (!selection.length) { toast("Tidak ada objek terpilih", false); return; }
  pushHistory();
  selection.slice().forEach(removeCore);
  selection = []; selected = null;
  transform?.detach(); clearWallHandles(); clearSelectionHelpers();
  refreshList(); updateInspector();
}
function select(rec, additive) {
  if (!rec) selection = [];
  else if (additive) { const i = selection.indexOf(rec); if (i >= 0) selection.splice(i, 1); else selection.push(rec); }
  else selection = [rec];
  selected = selection.length ? selection[selection.length - 1] : null;
  const single = selection.length === 1 ? selected : null;
  transform?.detach();
  clearWallHandles();
  if (single && transform && (single.type === "model" || single.type === "pin" || single.type === "text")) transform.attach(single.obj);
  if (single && single.type === "wall") showWallHandles(single);
  updateSelectionHelpers();
  updateInspector();
  refreshList();
  if (selection.length > 1) $("statCoords").textContent = `${selection.length} objek terpilih (Ctrl+D duplikat semua · Delete hapus semua)`;
  else if (selected) $("statCoords").textContent = `Terpilih: ${selected.data.name || selected.data.text || selected.type}  ·  Shift+klik untuk pilih banyak`;
}
function selectMany(recs) {
  selection = recs.slice();
  selected = selection.length ? selection[selection.length - 1] : null;
  transform?.detach(); clearWallHandles();
  updateSelectionHelpers(); updateInspector(); refreshList();
}

// =====================================================================
//  WALLS (+ openings)
// =====================================================================
function addWallPoint(p) {
  if (!wallDraft) {
    wallDraft = { pts: [], line: null, dots: new THREE.Group() };
    scene.add(wallDraft.dots);
    wallDraft.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8ab4ff }));
    scene.add(wallDraft.line);
  }
  wallDraft.pts.push(p.clone());
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshBasicMaterial({ color: 0x8ab4ff }));
  dot.position.copy(p).setY(0.1);
  wallDraft.dots.add(dot);
  updateWallPreview(p);
}
function updateWallPreview(cursor) {
  if (!wallDraft) return;
  const pts = wallDraft.pts.map((v) => new THREE.Vector3(v.x, 0.1, v.z));
  if (cursor) pts.push(new THREE.Vector3(cursor.x, 0.1, cursor.z));
  wallDraft.line.geometry.setFromPoints(pts);
  // live length + angle readout (guide)
  if (cursor && wallDraft.pts.length) {
    const prev = wallDraft.pts[wallDraft.pts.length - 1];
    const len = Math.hypot(cursor.x - prev.x, cursor.z - prev.z);
    let deg = Math.atan2(cursor.z - prev.z, cursor.x - prev.x) * 180 / Math.PI;
    deg = ((Math.round(deg) % 360) + 360) % 360;
    $("statCoords").textContent = `panjang: ${len.toFixed(2)} m   ∠ ${deg}°`;
  }
}
function finishWall() {
  if (!wallDraft || wallDraft.pts.length < 2) { cancelWall(); return; }
  pushHistory();
  const data = {
    points: wallDraft.pts.map((p) => [r3(p.x), r3(p.z)]),
    height: clampNum($("wallH").value, 3, 0.2, 50),
    thickness: clampNum($("wallT").value, 0.15, 0.02, 5),
    color: $("wallColor").value,
    closed: $("wallClosed").checked,
    openings: [],
  };
  const rec = addObject("wall", buildWallGroup(data), data);
  cancelWall();
  toast("Tembok dibuat", true);
  return rec;
}
function cancelWall() {
  clearSnapViz();
  if (!wallDraft) return;
  scene.remove(wallDraft.line, wallDraft.dots);
  wallDraft = null;
}
function segEndpoints(d, seg) {
  const pts = d.points, n = pts.length;
  return seg < n - 1 ? [pts[seg], pts[seg + 1]] : [pts[n - 1], pts[0]];
}
function buildWallGroup(d) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(d.color || "#8fa3c4"), roughness: 0.6, metalness: 0.12, envMapIntensity: 0.9 });
  const pts = d.points || [];
  const openings = d.openings || [];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push(i);
  if (d.closed && pts.length > 2) segs.push(pts.length - 1);
  segs.forEach((i) => {
    const [a, b] = segEndpoints(d, i);
    buildWallSegment(g, mat, a, b, i, openings.filter((o) => o.seg === i), d.height, d.thickness);
  });
  return g;
}
function buildWallSegment(g, mat, a, b, seg, ops, H, T) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 1e-3) return;
  const ux = dx / L, uz = dz / L, ang = -Math.atan2(dz, dx);
  const add = (s, e, y0, y1) => {
    const len = e - s; if (len < 1e-3 || y1 - y0 < 1e-3) return;
    const mid = (s + e) / 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, T), mat);
    m.position.set(a[0] + ux * mid, (y0 + y1) / 2, a[1] + uz * mid);
    m.rotation.y = ang; m.castShadow = true; m.receiveShadow = true; m.userData.seg = seg;
    g.add(m);
  };
  const sorted = ops.slice().sort((p, q) => p.dist - q.dist);
  if (!sorted.length) { add(-T / 2, L + T / 2, 0, H); return; }
  let cur = 0;
  sorted.forEach((op) => {
    const os = Math.max(0, op.dist - op.width / 2), oe = Math.min(L, op.dist + op.width / 2);
    if (os > cur) add(cur === 0 ? -T / 2 : cur, os, 0, H);
    const top = Math.min(H, op.top ?? H), sill = Math.max(0, op.sill ?? 0);
    if (top < H) add(os, oe, top, H);      // header above opening
    if (sill > 0) add(os, oe, 0, sill);    // sill below (window)
    cur = oe;
  });
  if (cur < L) add(cur, L + T / 2, 0, H);
}
function rebuildWall(rec) {
  scene.remove(rec.obj);
  const g = buildWallGroup(rec.data);
  g.userData.recId = rec.id;
  scene.add(g);
  rec.obj = g;
}
function doorTap(e) {
  setNdc(e);
  const wallObjs = objects.filter((o) => o.type === "wall").map((o) => o.obj);
  const hits = raycaster.intersectObjects(wallObjs, true);
  if (!hits.length) { toast("Klik tepat pada tembok", false); return; }
  const hit = hits[0];
  const rec = recordOf(hit.object);
  if (!rec) return;
  const seg = hit.object.userData.seg ?? 0;
  const [a, b] = segEndpoints(rec.data, seg);
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L;
  let dist = (hit.point.x - a[0]) * ux + (hit.point.z - a[1]) * uz;
  dist = Math.max(0, Math.min(L, dist));
  const op = {
    seg,
    dist: r3(dist),
    width: clampNum($("doorW").value, 0.9, 0.2, 20),
    top: clampNum($("doorTop").value, 2.1, 0.3, 50),
    sill: clampNum($("doorSill").value, 0, 0, 40),
  };
  rec.data.openings = rec.data.openings || [];
  pushHistory();
  rec.data.openings.push(op);
  rebuildWall(rec);
  if (selected === rec) renderOpenings();
  toast(op.sill > 0 ? "Jendela dibuat" : "Pintu dibuat", true);
}

// =====================================================================
//  FLOORS (+ layer order)
// =====================================================================
function nextFloorOrder() { return ++floorOrder; }
function floorTap(p) {
  if (!floorStart) { floorStart = p.clone(); return; }
  const a = floorStart, b = p;
  clearFloorPreview(); floorStart = null;
  if (Math.abs(b.x - a.x) < 0.2 || Math.abs(b.z - a.z) < 0.2) { toast("Area terlalu kecil", false); return; }
  pushHistory();
  const data = {
    x: r3((a.x + b.x) / 2), z: r3((a.z + b.z) / 2),
    w: r3(Math.abs(b.x - a.x)), d: r3(Math.abs(b.z - a.z)),
    type: $("floorType").value, color: $("floorColor").value, order: nextFloorOrder(),
    elev: clampNum($("floorElev").value, 0, 0, 20), shape: $("floorShape").value, dir: $("floorDir").value,
  };
  addObject("floor", buildFloor(data), data);
  toast("Lantai dibuat", true);
}
function updateFloorPreview(cursor) {
  if (!floorStart || !cursor) return;
  clearFloorPreview();
  const a = floorStart, b = cursor;
  const w = Math.max(Math.abs(b.x - a.x), 0.1), d = Math.max(Math.abs(b.z - a.z), 0.1);
  floorPreview = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  floorPreview.rotation.x = -Math.PI / 2;
  floorPreview.position.set((a.x + b.x) / 2, 0.06, (a.z + b.z) / 2);
  scene.add(floorPreview);
}
function clearFloorPreview() { if (floorPreview) { scene.remove(floorPreview); floorPreview = null; } }
function cancelFloor() { floorStart = null; clearFloorPreview(); }
const FLOOR_COL = { concrete: 0x3a3f47, green: 0x1f9e55, office: 0x8790a0 };
function buildFloor(d) {
  const col = d.type === "custom" ? new THREE.Color(d.color).getHex() : FLOOR_COL[d.type];
  const mat = new THREE.MeshStandardMaterial({
    color: col, roughness: d.type === "green" ? 0.6 : 0.92, metalness: 0, envMapIntensity: 0.4,
    emissive: d.type === "green" ? 0x0c3f22 : 0x000000, emissiveIntensity: d.type === "green" ? 0.35 : 0,
  });
  const H = 0.25;                               // volume/tebal lantai
  const base = 0.03 + (d.order || 0) * 0.006;   // permukaan dasar; order tinggi = di depan
  const elev = d.elev || 0;
  const shape = d.shape || "flat";
  let obj;
  if (shape === "ramp" && elev > 0) obj = buildRamp(d, mat, H, base, elev);
  else if (shape === "stairs" && elev > 0) obj = buildStairs(d, mat, base, elev);
  else {                                        // datar (platform bila elev>0)
    obj = new THREE.Mesh(new THREE.BoxGeometry(d.w, H, d.d), mat);
    obj.position.set(d.x, base + elev - H / 2, d.z);   // permukaan atas di base+elev
    obj.receiveShadow = true;
  }
  obj.renderOrder = d.order || 0;
  return obj;
}
// ponytail: ramp = box dimiringkan, visual-only (tanpa collision). Ujung bawah menempel base.
function buildRamp(d, mat, H, base, elev) {
  const axis = d.dir === "+x" || d.dir === "-x" ? "x" : "z";
  const run = axis === "x" ? d.w : d.d;
  const ang = Math.atan2(elev, run);
  const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, H, d.d), mat);
  m.receiveShadow = true;
  if (axis === "x") m.rotation.z = (d.dir === "+x" ? ang : -ang);
  else m.rotation.x = (d.dir === "+z" ? -ang : ang);
  m.position.set(d.x, base + (run / 2) * Math.sin(ang), d.z);   // ujung rendah ~base, ujung tinggi ~base+elev
  return m;
}
function buildStairs(d, mat, base, elev) {
  const axis = d.dir === "+x" || d.dir === "-x" ? "x" : "z";
  const run = axis === "x" ? d.w : d.d;
  const n = Math.max(2, Math.round(elev / 0.25));   // ~25cm per anak tangga
  const stepH = elev / n, stepRun = run / n;
  const sign = d.dir === "+x" || d.dir === "+z" ? 1 : -1;
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const h = stepH * (i + 1);                       // blok padat dari base ke tinggi anak tangga
    const geo = axis === "x" ? new THREE.BoxGeometry(stepRun, h, d.d) : new THREE.BoxGeometry(d.w, h, stepRun);
    const s = new THREE.Mesh(geo, mat);
    s.receiveShadow = true; s.castShadow = true;
    const off = sign * (-run / 2 + stepRun * (i + 0.5));   // dari ujung entri (rendah) ke ujung tinggi
    if (axis === "x") s.position.set(off, base + h / 2, 0);
    else s.position.set(0, base + h / 2, off);
    g.add(s);
  }
  g.position.set(d.x, 0, d.z);
  return g;
}
function rebuildFloor(rec) {
  scene.remove(rec.obj);
  const m = buildFloor(rec.data);
  m.userData.recId = rec.id;
  scene.add(m);
  rec.obj = m;
}

// =====================================================================
//  PINS
// =====================================================================
function placePin(p) {
  pushHistory();
  const g = buildPin();
  g.position.set(p.x, 0, p.z);
  select(addObject("pin", g, { ip: $("pinIp").value.trim(), label: $("pinLabel").value.trim() }));
}
function buildPin() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 36), new THREE.MeshBasicMaterial({ color: 0x6366f1, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x6366f1, emissive: 0x4338ca, emissiveIntensity: 0.15 }));
  stem.position.y = 1.1; stem.castShadow = true;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0x818cf8, emissive: 0x6366f1, emissiveIntensity: 0.3 }));
  ball.position.y = 2.35; ball.castShadow = true;
  g.add(ring, stem, ball);
  return g;
}

// =====================================================================
//  TEXT (sprite label — raycastable, saved to scene.json)
// =====================================================================
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
function placeText(p) {
  pushHistory();
  const data = { x: r3(p.x), y: 1.6, z: r3(p.z), text: $("textContent").value || "Teks", size: clampNum($("textSize").value, 1, 0.2, 20), color: $("textColor").value };
  select(addObject("text", makeTextSprite(data), data));
}
function rebuildText(rec) {
  rec.data.x = r3(rec.obj.position.x); rec.data.y = r3(rec.obj.position.y); rec.data.z = r3(rec.obj.position.z);
  scene.remove(rec.obj);
  const spr = makeTextSprite(rec.data);
  spr.userData.recId = rec.id;
  scene.add(spr);
  rec.obj = spr;
  if (selected === rec) transform?.attach(spr);
}

// =====================================================================
//  MODELS
// =====================================================================
$("btnModel").onclick = () => $("fileModel").click();
$("fileModel").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  toast("Memuat model…", true);
  f.arrayBuffer().then((buf) => {
    loader.parse(buf, "", (gltf) => {
      onModelLoaded(gltf.scene, { url: "/models/" + f.name, name: f.name.replace(/\.(glb|gltf)$/i, ""), deviceIp: "" });
      toast("Model dimuat. Salin file ke public/models/" + f.name, true);
    }, (err) => toast("Gagal parse model: " + err, false));
  });
};
function onModelLoaded(root, data, at) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z) || 1;
  if (maxd > 50 || maxd < 0.3) { root.scale.setScalar(5 / maxd); box.setFromObject(root); box.getSize(size); }
  const c = box.getCenter(new THREE.Vector3());
  const tx = at ? at.x : controls.target.x, tz = at ? at.z : controls.target.z;
  root.position.x += tx - c.x;
  root.position.z += tz - c.z;
  root.position.y += -box.min.y;
  pushHistory();
  setMode("select");
  select(addObject("model", root, data));
}
// B4 — muat model dari path (katalog / drag-drop). `at` = titik lantai opsional.
function loadModelByPath(file, at) {
  const url = file.startsWith("/") ? file : "/models/" + file;
  toast("Memuat " + file + "…", true);
  loader.load(url, (gltf) => onModelLoaded(gltf.scene, { url, name: file.replace(/^.*\//, "").replace(/\.(glb|gltf)$/i, ""), deviceIp: "" }, at),
    undefined, () => toast("Gagal memuat " + url + " (pastikan ada di public/models/)", false));
}
// B4 — katalog model dari manifest statis models.json
function loadCatalog() {
  fetch("/models/models.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { models: [] }))
    .then((j) => renderCatalog(Array.isArray(j.models) ? j.models : []))
    .catch(() => renderCatalog([]));
}
function renderCatalog(list) {
  const box = $("catalogList"); if (!box) return;
  if (!list.length) { box.innerHTML = `<div class="empty">Belum ada model. Tambah .glb ke public/models/ lalu daftarkan di models.json.</div>`; return; }
  box.innerHTML = "";
  list.forEach((m) => {
    const el = document.createElement("div");
    el.className = "cat-item"; el.draggable = true;
    el.innerHTML = `<span class="cat-ic">📦</span><span class="cat-nm">${escapeHtml(m.name || m.file)}</span>`;
    el.onclick = () => loadModelByPath(m.file);
    el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/model-file", m.file));
    box.appendChild(el);
  });
}

// =====================================================================
//  AREA / DEFAULT SIZE
// =====================================================================
function areaWD() { return [clampNum($("areaW").value, 30, 1, 500), clampNum($("areaD").value, 20, 1, 500)]; }
function updatePlot() {
  const [W, D] = areaWD();
  if (plotGuide) { scene.remove(plotGuide); plotGuide.geometry.dispose(); }
  const hw = W / 2, hd = D / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]].map(([x, z]) => new THREE.Vector3(x, 0.02, z));
  plotGuide = new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners),
    new THREE.LineDashedMaterial({ color: 0x6366f1, dashSize: 0.7, gapSize: 0.45, transparent: true, opacity: 0.75 }));
  plotGuide.computeLineDistances();
  plotGuide.visible = $("areaShow").checked;
  scene.add(plotGuide);
}
function createWallBox() {
  pushHistory();
  const [W, D] = areaWD(); const hw = W / 2, hd = D / 2;
  const data = {
    points: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [r3(x), r3(z)]),
    height: clampNum($("wallH").value, 3, 0.2, 50), thickness: clampNum($("wallT").value, 0.15, 0.02, 5),
    color: $("wallColor").value, closed: true, openings: [],
  };
  select(addObject("wall", buildWallGroup(data), data));
  toast(`Tembok kotak ${W}×${D} m dibuat`, true);
}
function createFloorFull() {
  pushHistory();
  const [W, D] = areaWD();
  const data = { x: 0, z: 0, w: W, d: D, type: "concrete", color: "#3a3f47", order: nextFloorOrder() };
  select(addObject("floor", buildFloor(data), data));
  toast(`Lantai ${W}×${D} m dibuat`, true);
}

// =====================================================================
//  DUPLICATE / COPY-PASTE
// =====================================================================
function duplicateOne(rec) {
  if (rec.type === "wall") {
    const data = JSON.parse(JSON.stringify(rec.data));
    data.points = data.points.map(([x, z]) => [r3(x + 2), r3(z + 2)]);
    return addObject("wall", buildWallGroup(data), data);
  } else if (rec.type === "floor") {
    const data = JSON.parse(JSON.stringify(rec.data));
    data.x = r3(data.x + 2); data.z = r3(data.z + 2); data.order = nextFloorOrder();
    return addObject("floor", buildFloor(data), data);
  } else if (rec.type === "pin") {
    const g = buildPin(); g.position.copy(rec.obj.position).add(new THREE.Vector3(2, 0, 2));
    return addObject("pin", g, { ...rec.data });
  } else if (rec.type === "text") {
    const data = { ...rec.data, x: r3(rec.obj.position.x + 2), y: r3(rec.obj.position.y), z: r3(rec.obj.position.z + 2) };
    return addObject("text", makeTextSprite(data), data);
  } else if (rec.type === "model") {
    const clone = rec.obj.clone(true);
    clone.position.x += 2; clone.position.z += 2;
    return addObject("model", clone, { ...rec.data });
  }
  return null;
}
// Duplikat 1 objek ATAU banyak sekaligus (list). Satu langkah undo untuk semua.
function duplicate(list) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : (list ? [list] : []);
  if (!arr.length) { toast("Pilih objek dulu untuk diduplikat", false); return; }
  pushHistory();
  const created = arr.map(duplicateOne).filter(Boolean);
  if (created.length) { setMode("select"); selectMany(created); toast(`${created.length} objek diduplikat`, true); }
}

// =====================================================================
//  DENAH (tracing aid — not saved)
// =====================================================================
$("btnDenah").onclick = () => $("fileDenah").click();
$("fileDenah").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    refAspect = (tex.image.height || 1) / (tex.image.width || 1);
    if (refPlane) scene.remove(refPlane);
    refPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: +$("denahOp").value, depthWrite: false }));
    refPlane.rotation.x = -Math.PI / 2; refPlane.position.y = 0.008;
    scene.add(refPlane); updateDenah();
    $("secDenah").classList.remove("hidden");
    toast("Denah dimuat sebagai alas jiplak", true);
  });
};
function updateDenah() {
  if (!refPlane) return;
  const w = +$("denahW").value || 40;
  refPlane.scale.set(w, w * refAspect, 1);
  refPlane.material.opacity = +$("denahOp").value;
  refPlane.visible = $("denahShow").checked;
}

// =====================================================================
//  INSPECTOR + LIST
// =====================================================================
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function updateInspector() {
  const multi = selection.length > 1;
  const selType = multi ? null : (selected && selected.type);   // multi: sembunyikan panel per-objek
  show("secWall", mode === "wall");
  show("secWallSel", selType === "wall");
  show("secFloor", mode === "floor");
  show("secDoor", mode === "door");
  show("secPin", mode === "pin" || selType === "pin");
  show("secText", mode === "text" || selType === "text");
  show("secModel", selType === "model");
  show("secFloorSel", selType === "floor");
  show("secActions", selection.length > 0);

  if (selType === "model") {
    $("modelName").value = selected.data.name || "";
    $("modelPath").value = selected.data.url || "";
    $("modelIp").value = selected.data.deviceIp || "";
  }
  if (selType === "pin") { $("pinIp").value = selected.data.ip || ""; $("pinLabel").value = selected.data.label || ""; }
  if (selType === "text") {
    $("textContent").value = selected.data.text || "";
    $("textSize").value = selected.data.size ?? 1;
    $("textColor").value = selected.data.color || "#e2e8f0";
  }
  if (selType === "floor") {
    $("floorSelType").value = selected.data.type || "concrete";
    $("floorSelColor").value = selected.data.color || "#3a3f47";
    $("floorSelElev").value = selected.data.elev || 0;
    $("floorSelShape").value = selected.data.shape || "flat";
    $("floorSelDir").value = selected.data.dir || "+x";
  }
  if (selType === "wall") populateWallSel();
}
function refreshList() {
  const ul = $("objList");
  $("statCount").textContent = `${objects.length} objek`;
  if (!objects.length) { ul.innerHTML = `<div class="empty">Belum ada objek.</div>`; return; }
  ul.innerHTML = "";
  objects.forEach((o) => {
    const li = document.createElement("li");
    if (selection.includes(o)) li.className = "sel";
    const nm = o.data.name || o.data.text || o.data.ip || o.type;
    li.innerHTML = `<span class="tag">${o.type}</span><span class="nm">${escapeHtml(nm)}</span><span class="x">✕</span>`;
    li.onclick = (ev) => {
      if (ev.target.classList.contains("x")) { removeRecord(o); return; }
      if (mode !== "select") setMode("select");
      select(o, ev.shiftKey || ev.ctrlKey || ev.metaKey);
    };
    ul.appendChild(li);
  });
}

// =====================================================================
//  SAVE / LOAD / NEW
// =====================================================================
function buildSceneJSON() {
  return {
    version: 1, units: "m",
    walls: objects.filter((o) => o.type === "wall").map((o) => o.data),
    floors: objects.filter((o) => o.type === "floor").map((o) => o.data),
    models: objects.filter((o) => o.type === "model").map((o) => ({
      url: o.data.url, name: o.data.name, deviceIp: o.data.deviceIp || "",
      position: [r3(o.obj.position.x), r3(o.obj.position.y), r3(o.obj.position.z)],
      rotation: [r3(o.obj.rotation.x), r3(o.obj.rotation.y), r3(o.obj.rotation.z)],   // rotasi PENUH (x,y,z)
      scale: [r3(o.obj.scale.x), r3(o.obj.scale.y), r3(o.obj.scale.z)],               // skala PENUH
    })),
    pins: objects.filter((o) => o.type === "pin").map((o) => ({
      x: r3(o.obj.position.x), z: r3(o.obj.position.z), ip: o.data.ip || "", label: o.data.label || "",
    })),
    texts: objects.filter((o) => o.type === "text").map((o) => ({
      x: r3(o.obj.position.x), y: r3(o.obj.position.y), z: r3(o.obj.position.z),
      text: o.data.text, size: o.data.size, color: o.data.color,
    })),
    lighting: JSON.parse(JSON.stringify(lighting)),
    camera: {
      position: [r3(camera.position.x), r3(camera.position.y), r3(camera.position.z)],
      target: [r3(controls.target.x), r3(controls.target.y), r3(controls.target.z)],
    },
  };
}
$("btnSave").onclick = () => {
  const blob = new Blob([JSON.stringify(buildSceneJSON(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "scene.json"; a.click();
  toast("scene.json diunduh. Taruh di public/ agar dashboard memuatnya.", true);
};

// ➊ Generate 2D dari 3D — proyeksi top-down scene → layout2d.json (lalu poles di Builder 2D)
function buildLayout2D() {
  const s = buildSceneJSON();
  const floors = s.floors || [], walls = s.walls || [], models = s.models || [], pins = s.pins || [], texts = s.texts || [];

  // frame denah = batas gedung (dari lantai + titik tembok). Model outlier tak dipakai jadi acuan.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (x, z) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; };
  floors.forEach((f) => { grow(f.x - f.w / 2, f.z - f.d / 2); grow(f.x + f.w / 2, f.z + f.d / 2); });
  walls.forEach((w) => (w.points || []).forEach((p) => grow(p[0], p[1])));
  if (!isFinite(minX)) { toast("Belum ada lantai/tembok sebagai acuan denah.", false); return null; }

  const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
  const PAD = 40, scale = (1120 - 2 * PAD) / spanX;
  const VBW = Math.round(spanX * scale + 2 * PAD), VBH = Math.round(spanZ * scale + 2 * PAD);
  const PX = (x) => +(PAD + (x - minX) * scale).toFixed(1);
  const PY = (z) => +(PAD + (z - minZ) * scale).toFixed(1);
  const inFrame = (x, z) => x >= minX - 0.5 && x <= maxX + 0.5 && z >= minZ - 0.5 && z <= maxZ + 0.5;

  // footprint (m) & warna per jenis model — heuristik nama (belum ada metadata di models.json)
  const foot = (url) => {
    const u = (url || "").toLowerCase();
    if (u.includes("gate") || u.includes("rfid")) return { w: 2.2, d: 0.7, color: "rgba(245,158,11,0.6)" };
    if (u.includes("pallet") || u.includes("rack") || u.includes("crate") || u.includes("stack")) return { w: 1.3, d: 1.3, color: "rgba(56,120,220,0.5)" };
    if (u.includes("forklift") || u.includes("agv")) return { w: 1.1, d: 2.2, color: "rgba(148,163,184,0.5)" };
    return { w: 1.4, d: 1.4, color: "rgba(120,140,170,0.5)" };
  };

  const rooms = [], outWalls = [], outPins = [];
  outWalls.push({ points: [[PX(minX), PY(minZ)], [PX(maxX), PY(minZ)], [PX(maxX), PY(maxZ)], [PX(minX), PY(maxZ)]], closed: true }); // batas gedung
  floors.forEach((f) => {                                  // jalur hijau → room hijau
    if (f.type === "green") rooms.push({ x: PX(f.x - f.w / 2), y: PY(f.z - f.d / 2), w: +(f.w * scale).toFixed(1), h: +(f.d * scale).toFixed(1), color: "rgba(34,197,94,0.55)" });
  });
  texts.forEach((t) => {                                   // teks → room berlabel (ukuran default; edit manual)
    const w = 3.6, d = 3;
    rooms.push({ x: PX(t.x - w / 2), y: PY(t.z - d / 2), w: +(w * scale).toFixed(1), h: +(d * scale).toFixed(1), label: t.text, color: "rgba(48,49,61,0.5)" });
  });
  walls.forEach((w) => {                                   // tembok scene (partisi) → walls
    const pts = (w.points || []).map((p) => [PX(p[0]), PY(p[1])]);
    if (pts.length > 1) outWalls.push({ points: pts, closed: !!w.closed });
  });
  models.forEach((m) => {                                  // model → kotak footprint (skip outlier)
    const x = m.position[0], z = m.position[2]; if (!inFrame(x, z)) return;
    const f = foot(m.url);
    let w = f.w * (Math.abs(m.scale ? m.scale[0] : 1) || 1), d = f.d * (Math.abs(m.scale ? m.scale[2] : 1) || 1);
    const ry = Math.abs((((m.rotation && m.rotation[1]) || 0) % Math.PI));
    if (Math.abs(ry - Math.PI / 2) < 0.4) { const t = w; w = d; d = t; }   // dirotasi ~90° di Y → tukar footprint
    rooms.push({ x: PX(x - w / 2), y: PY(z - d / 2), w: +(w * scale).toFixed(1), h: +(d * scale).toFixed(1), color: f.color });
  });
  pins.forEach((p) => outPins.push({ x: PX(p.x), y: PY(p.z), ip: p.ip || "", label: p.label || "" }));  // pin → pin

  return { version: 1, viewBox: [0, 0, VBW, VBH], rooms, walls: outWalls, pins: outPins };
}
$("btnGen2D").onclick = () => {
  const layout = buildLayout2D(); if (!layout) return;
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "layout2d.json"; a.click();
  toast(`layout2d.json dibuat (${layout.rooms.length} area, ${layout.pins.length} pin). Buka Builder 2D → Muat untuk poles/rename.`, true);
};
$("btnLoad").onclick = () => $("fileScene").click();
$("fileScene").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  f.text().then((t) => { try { pushHistory(); loadSceneJSON(JSON.parse(t)); toast("Scene dimuat", true); } catch { toast("JSON tidak valid", false); } });
};
$("btnNew").onclick = () => { if (confirm("Kosongkan scene?")) { pushHistory(); clearAll(); } };

// Terapkan transform model (kompatibel format lama rotationY/scalar & baru array)
function applyModelTransform(root, d) {
  root.position.fromArray(d.position || [0, 0, 0]);
  if (Array.isArray(d.rotation)) root.rotation.set(d.rotation[0] || 0, d.rotation[1] || 0, d.rotation[2] || 0);
  else root.rotation.set(0, d.rotationY || 0, 0);
  if (Array.isArray(d.scale)) root.scale.set(d.scale[0] || 1, d.scale[1] || 1, d.scale[2] || 1);
  else root.scale.setScalar(d.scale || 1);
}
function clearAll() {
  objects.slice().forEach((o) => scene.remove(o.obj));
  objects = []; for (const k in byId) delete byId[k];
  transform?.detach(); clearWallHandles(); clearSelectionHelpers();
  selection = []; selected = null; clipboard = null; floorOrder = 0;
  refreshList(); updateInspector();
}
function loadSceneJSON(s) {
  clearAll();
  (s.walls || []).forEach((d) => { if (!d.openings) d.openings = []; addObject("wall", buildWallGroup(d), d); });
  (s.floors || []).forEach((d) => { floorOrder = Math.max(floorOrder, d.order || 0); addObject("floor", buildFloor(d), d); });
  (s.pins || []).forEach((d) => { const g = buildPin(); g.position.set(d.x, 0, d.z); addObject("pin", g, { ip: d.ip, label: d.label }); });
  (s.texts || []).forEach((d) => addObject("text", makeTextSprite(d), { ...d }));
  (s.models || []).forEach((d) => {
    loader.load(d.url, (gltf) => {
      const root = gltf.scene;
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      applyModelTransform(root, d);
      addObject("model", root, { url: d.url, name: d.name, deviceIp: d.deviceIp || "" });
    }, undefined, () => toast("Model tak ditemukan: " + d.url, false));
  });
  if (s.lighting) { Object.assign(lighting, s.lighting); syncLightUI(); applyLighting(); }
  if (s.camera && s.camera.position) { camera.position.fromArray(s.camera.position); controls.target.fromArray(s.camera.target); controls.update(); }
}

// =====================================================================
//  B2 — UNDO / REDO   +   B1 — WALL EDIT (handles + openings)
// =====================================================================
function pushHistory() {
  history.push(buildSceneJSON());
  if (history.length > HISTORY_MAX) history.shift();
  redoStack = [];
  updateUndoButtons();
}
function restoreState(json) {
  const cp = camera.position.clone(), ct = controls.target.clone();   // undo tak menggeser kamera
  loadSceneJSON(json);
  camera.position.copy(cp); controls.target.copy(ct); controls.update();
}
function undo() {
  if (!history.length) { toast("Tidak ada yang bisa di-undo", false); return; }
  redoStack.push(buildSceneJSON());
  restoreState(history.pop());
  updateUndoButtons(); toast("Undo", true);
}
function redo() {
  if (!redoStack.length) { toast("Tidak ada yang bisa di-redo", false); return; }
  history.push(buildSceneJSON());
  restoreState(redoStack.pop());
  updateUndoButtons(); toast("Redo", true);
}
function updateUndoButtons() {
  if ($("btnUndo")) $("btnUndo").disabled = !history.length;
  if ($("btnRedo")) $("btnRedo").disabled = !redoStack.length;
}

// ---- wall vertex handles (drag to reshape) ----
function showWallHandles(rec) {
  clearWallHandles();
  if (!rec || rec.type !== "wall") return;
  wallHandles = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc22 });
  rec.data.points.forEach((pt, vi) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 14), mat);
    h.position.set(pt[0], 0.3, pt[1]); h.userData.vi = vi;
    wallHandles.add(h);
  });
  scene.add(wallHandles);
}
function positionWallHandles(rec) {
  if (!wallHandles || !rec) return;
  rec.data.points.forEach((pt, vi) => { const h = wallHandles.children[vi]; if (h) h.position.set(pt[0], 0.3, pt[1]); });
}
function clearWallHandles() { if (wallHandles) { scene.remove(wallHandles); wallHandles = null; } }

// ---- multi-select highlight (kotak kuning saat pilih >1 objek) ----
function clearSelectionHelpers() { selectionHelpers.forEach((h) => scene.remove(h)); selectionHelpers = []; }
function updateSelectionHelpers() {
  clearSelectionHelpers();
  if (selection.length < 2) return;   // 1 objek → sudah ada gizmo/handle
  selection.forEach((rec) => { const h = new THREE.BoxHelper(rec.obj, 0xffcc22); scene.add(h); selectionHelpers.push(h); });
}

// ---- selected-wall inspector (edit props + openings) ----
function populateWallSel() {
  if (selected?.type !== "wall") return;
  const d = selected.data;
  $("wsH").value = d.height; $("wsT").value = d.thickness;
  $("wsColor").value = d.color || "#8fa3c4"; $("wsClosed").checked = !!d.closed;
  renderOpenings();
}
function renderOpenings() {
  const box = $("wsOpenings"); if (!box || selected?.type !== "wall") return;
  const ops = selected.data.openings || [];
  if (!ops.length) { box.innerHTML = `<div class="empty">Belum ada lubang. Pakai mode "Pintu/Jendela".</div>`; return; }
  box.innerHTML = "";
  ops.forEach((op, idx) => {
    const isWin = (op.sill || 0) > 0;
    const w = document.createElement("div");
    w.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:7px";
    w.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
         <b style="font-size:11px">${isWin ? "Jendela" : "Pintu"} #${idx + 1} · seg ${op.seg}</b>
         <span data-del="${idx}" style="color:var(--text-dim);cursor:pointer;font-weight:700">✕</span></div>
       <div class="row"><label>Lebar</label><input type="number" step="0.1" min="0.2" data-f="width" data-i="${idx}" value="${op.width}"></div>
       <div class="row"><label>Posisi</label><input type="number" step="0.1" min="0" data-f="dist" data-i="${idx}" value="${op.dist}"></div>
       <div class="row"><label>Atas</label><input type="number" step="0.1" min="0.3" data-f="top" data-i="${idx}" value="${op.top ?? 2.1}"></div>
       <div class="row"><label>Ambang</label><input type="number" step="0.1" min="0" data-f="sill" data-i="${idx}" value="${op.sill ?? 0}"></div>`;
    box.appendChild(w);
  });
  box.querySelectorAll("[data-del]").forEach((el) => (el.onclick = () => {
    pushHistory();
    selected.data.openings.splice(+el.dataset.del, 1);
    rebuildWall(selected); renderOpenings(); toast("Lubang dihapus", true);
  }));
  box.querySelectorAll("input[data-f]").forEach((el) => (el.onchange = () => {
    pushHistory();
    const op = selected.data.openings[+el.dataset.i];
    op[el.dataset.f] = clampNum(el.value, op[el.dataset.f] ?? 0, 0, 100);
    rebuildWall(selected);
  }));
}

// =====================================================================
//  UI BINDINGS
// =====================================================================
function bindUI() {
  document.querySelectorAll(".btn.mode").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("btnTop").onclick = () => { camera.position.set(controls.target.x, 55, controls.target.z + 0.001); controls.update(); };
  $("snap").onchange = (e) => { snapOn = e.target.checked; };

  // area / default size
  ["areaW", "areaD", "areaShow"].forEach((id) => ($(id).oninput = updatePlot));
  $("btnWallBox").onclick = createWallBox;
  $("btnFloorFull").onclick = createFloorFull;
  $("catRefresh").onclick = loadCatalog;   // B4

  // model fields
  $("modelName").oninput = () => { if (selected?.type === "model") { selected.data.name = $("modelName").value; refreshList(); } };
  $("modelPath").oninput = () => { if (selected?.type === "model") selected.data.url = $("modelPath").value; };
  $("modelIp").oninput = () => { if (selected?.type === "model") selected.data.deviceIp = $("modelIp").value; };
  document.querySelectorAll(".tmodes .btn").forEach((b) => (b.onclick = () => {
    transform?.setMode(b.dataset.tm);
    document.querySelectorAll(".tmodes .btn").forEach((x) => x.classList.toggle("active", x === b));
  }));

  // pin fields
  $("pinIp").oninput = () => { if (selected?.type === "pin") { selected.data.ip = $("pinIp").value; refreshList(); } };
  $("pinLabel").oninput = () => { if (selected?.type === "pin") selected.data.label = $("pinLabel").value; };

  // text fields (live edit of selected)
  const textEdit = () => {
    if (selected?.type !== "text") return;
    selected.data.text = $("textContent").value;
    selected.data.size = clampNum($("textSize").value, 1, 0.2, 20);
    selected.data.color = $("textColor").value;
    rebuildText(selected); refreshList();
  };
  $("textContent").oninput = textEdit; $("textSize").oninput = textEdit; $("textColor").oninput = textEdit;

  // selected-floor edit + layering
  const floorEdit = () => {
    if (selected?.type !== "floor") return;
    selected.data.type = $("floorSelType").value;
    selected.data.color = $("floorSelColor").value;
    selected.data.elev = clampNum($("floorSelElev").value, 0, 0, 20);
    selected.data.shape = $("floorSelShape").value;
    selected.data.dir = $("floorSelDir").value;
    rebuildFloor(selected);
  };
  $("floorSelType").onchange = floorEdit; $("floorSelColor").oninput = floorEdit;
  $("floorSelElev").oninput = floorEdit; $("floorSelShape").onchange = floorEdit; $("floorSelDir").onchange = floorEdit;
  $("btnFloorFront").onclick = () => { if (selected?.type === "floor") { pushHistory(); selected.data.order = nextFloorOrder(); rebuildFloor(selected); toast("Lantai ke depan", true); } };
  $("btnFloorBack").onclick = () => {
    if (selected?.type !== "floor") return;
    pushHistory();
    const min = Math.min(0, ...objects.filter((o) => o.type === "floor").map((o) => o.data.order || 0));
    selected.data.order = min - 1; rebuildFloor(selected); toast("Lantai ke belakang", true);
  };

  // B1 — selected wall edit (props); geometri titik lewat drag handle
  const wallSelEdit = () => {
    if (selected?.type !== "wall") return;
    pushHistory();
    selected.data.height = clampNum($("wsH").value, 3, 0.2, 50);
    selected.data.thickness = clampNum($("wsT").value, 0.15, 0.02, 5);
    selected.data.color = $("wsColor").value;
    selected.data.closed = $("wsClosed").checked;
    rebuildWall(selected);
  };
  ["wsH", "wsT", "wsColor", "wsClosed"].forEach((id) => ($(id).onchange = wallSelEdit));

  // B2 — undo / redo
  $("btnUndo").onclick = undo;
  $("btnRedo").onclick = redo;

  // generic actions (jalan untuk 1 ATAU banyak objek terpilih)
  $("btnDup").onclick = () => duplicate(selection);
  $("btnDel").onclick = () => removeSelection();

  // denah
  ["denahW", "denahOp", "denahShow"].forEach((id) => ($(id).oninput = updateDenah));

  // lighting sliders
  const bind = (id, fmt, apply) => { $(id).oninput = () => { apply(+$(id).value); $(fmt).textContent = fmtVal(id, +$(id).value); applyLighting(); }; };
  bind("lgExp", "vExp", (v) => (lighting.exposure = v));
  bind("lgElev", "vElev", (v) => (lighting.sunElevation = v));
  bind("lgAzi", "vAzi", (v) => (lighting.sunAzimuth = v));
  bind("lgInt", "vInt", (v) => (lighting.sunIntensity = v));
  bind("lgAmb", "vAmb", (v) => (lighting.ambient = v));
}
function fmtVal(id, v) { return (id === "lgElev" || id === "lgAzi") ? v + "°" : v.toFixed(2).replace(/\.00$/, ""); }
function syncLightUI() {
  $("lgExp").value = lighting.exposure; $("vExp").textContent = lighting.exposure;
  $("lgElev").value = lighting.sunElevation; $("vElev").textContent = lighting.sunElevation + "°";
  $("lgAzi").value = lighting.sunAzimuth; $("vAzi").textContent = lighting.sunAzimuth + "°";
  $("lgInt").value = lighting.sunIntensity; $("vInt").textContent = lighting.sunIntensity;
  $("lgAmb").value = lighting.ambient; $("vAmb").textContent = lighting.ambient;
}

// =====================================================================
//  UTIL + WS
// =====================================================================
function clampNum(v, def, min, max) { v = parseFloat(v); if (isNaN(v)) return def; return Math.min(max, Math.max(min, v)); }
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
let toastT;
function toast(msg, ok) {
  const t = $("toast"); t.textContent = msg; t.className = (ok ? "ok" : "err") + " show";
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
}
