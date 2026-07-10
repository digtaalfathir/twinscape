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
    transform.addEventListener("dragging-changed", (e) => { draggingGizmo = e.value; controls.enabled = !e.value; });
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
    new THREE.MeshStandardMaterial({ color: 0x0e131d, roughness: 0.98, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = "__ground";
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
  animate();
  connectWSForIps();
}

function animate() {
  requestAnimationFrame(animate);
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
  if (m !== "select") { transform?.detach(); selected = null; }
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
// angle-snap the wall cursor relative to the last placed point ("Lurus")
function wallCursor(p) {
  if (!wallDraft || !wallDraft.pts.length || !$("wallStraight")?.checked || !p) return p;
  const prev = wallDraft.pts[wallDraft.pts.length - 1];
  let ang = Math.atan2(p.z - prev.z, p.x - prev.x);
  const step = Math.PI / 12;                     // 15°
  ang = Math.round(ang / step) * step;
  let len = Math.hypot(p.x - prev.x, p.z - prev.z);
  if (snapOn) len = Math.round(len * 2) / 2;
  return new THREE.Vector3(prev.x + Math.cos(ang) * len, 0, prev.z + Math.sin(ang) * len);
}

// =====================================================================
//  POINTER
// =====================================================================
function bindPointer() {
  let dn = null;
  canvas.addEventListener("pointerdown", (e) => { dn = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointermove", (e) => {
    const raw = groundPoint(e);
    const p = mode === "wall" ? wallCursor(raw) : raw;
    if (p) $("statCoords").textContent = `x: ${p.x.toFixed(1)}  z: ${p.z.toFixed(1)} m`;
    if (mode === "wall" && wallDraft) updateWallPreview(p);
    if (mode === "floor" && floorStart) updateFloorPreview(p);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!dn) return;
    const moved = Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 5;
    dn = null;
    if (moved || draggingGizmo) return;
    tap(e);
  });
  canvas.addEventListener("dblclick", () => { if (mode === "wall") finishWall(); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(selected); return; }
    if (ctrl && e.key.toLowerCase() === "c") { if (selected) clipboard = selected; return; }
    if (ctrl && e.key.toLowerCase() === "v") { if (clipboard) duplicate(clipboard); return; }
    if (e.key === "Enter" && mode === "wall") finishWall();
    if (e.key === "Escape") { cancelWall(); cancelFloor(); if (mode !== "select") setMode("select"); }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) removeRecord(selected);
  });
}
function tap(e) {
  if (mode === "select") { pickAt(e); return; }
  if (mode === "door") { doorTap(e); return; }
  const raw = groundPoint(e);
  const p = mode === "wall" ? wallCursor(raw) : raw;
  if (!p) return;
  if (mode === "wall") addWallPoint(p);
  else if (mode === "floor") floorTap(p);
  else if (mode === "pin") placePin(p);
  else if (mode === "text") placeText(p);
}
function pickAt(e) {
  setNdc(e);
  const hits = raycaster.intersectObjects(objects.map((o) => o.obj), true);
  select(hits.length ? recordOf(hits[0].object) : null);
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
function removeRecord(rec) {
  if (!rec) return;
  if (selected === rec) { transform?.detach(); selected = null; }
  if (clipboard === rec) clipboard = null;
  scene.remove(rec.obj);
  objects = objects.filter((o) => o !== rec);
  delete byId[rec.id];
  refreshList(); updateInspector();
}
function select(rec) {
  selected = rec;
  transform?.detach();
  if (transform && rec && (rec.type === "model" || rec.type === "pin" || rec.type === "text")) transform.attach(rec.obj);
  updateInspector();
  refreshList();
  if (rec) $("statCoords").textContent = `Terpilih: ${rec.data.name || rec.data.text || rec.type}  (Ctrl+D duplikat · Delete hapus)`;
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
  rec.data.openings.push(op);
  rebuildWall(rec);
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
  const data = {
    x: r3((a.x + b.x) / 2), z: r3((a.z + b.z) / 2),
    w: r3(Math.abs(b.x - a.x)), d: r3(Math.abs(b.z - a.z)),
    type: $("floorType").value, color: $("floorColor").value, order: nextFloorOrder(),
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
    color: col, roughness: d.type === "green" ? 0.6 : 0.92, metalness: 0,
    emissive: d.type === "green" ? 0x0c3f22 : 0x000000, emissiveIntensity: d.type === "green" ? 0.35 : 0,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(d.x, 0.02 + (d.order || 0) * 0.006, d.z);   // higher order = in front
  m.renderOrder = d.order || 0;
  m.receiveShadow = true;
  return m;
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
function onModelLoaded(root, data) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z) || 1;
  if (maxd > 50 || maxd < 0.3) { root.scale.setScalar(5 / maxd); box.setFromObject(root); box.getSize(size); }
  const c = box.getCenter(new THREE.Vector3());
  root.position.x += controls.target.x - c.x;
  root.position.z += controls.target.z - c.z;
  root.position.y += -box.min.y;
  setMode("select");
  select(addObject("model", root, data));
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
  const [W, D] = areaWD();
  const data = { x: 0, z: 0, w: W, d: D, type: "concrete", color: "#3a3f47", order: nextFloorOrder() };
  select(addObject("floor", buildFloor(data), data));
  toast(`Lantai ${W}×${D} m dibuat`, true);
}

// =====================================================================
//  DUPLICATE / COPY-PASTE
// =====================================================================
function duplicate(rec) {
  if (!rec) { toast("Pilih objek dulu untuk diduplikat", false); return; }
  let nr = null;
  if (rec.type === "wall") {
    const data = JSON.parse(JSON.stringify(rec.data));
    data.points = data.points.map(([x, z]) => [r3(x + 2), r3(z + 2)]);
    nr = addObject("wall", buildWallGroup(data), data);
  } else if (rec.type === "floor") {
    const data = JSON.parse(JSON.stringify(rec.data));
    data.x = r3(data.x + 2); data.z = r3(data.z + 2); data.order = nextFloorOrder();
    nr = addObject("floor", buildFloor(data), data);
  } else if (rec.type === "pin") {
    const g = buildPin(); g.position.copy(rec.obj.position).add(new THREE.Vector3(2, 0, 2));
    nr = addObject("pin", g, { ...rec.data });
  } else if (rec.type === "text") {
    const data = { ...rec.data, x: r3(rec.obj.position.x + 2), y: r3(rec.obj.position.y), z: r3(rec.obj.position.z + 2) };
    nr = addObject("text", makeTextSprite(data), data);
  } else if (rec.type === "model") {
    const clone = rec.obj.clone(true);
    clone.position.x += 2; clone.position.z += 2;
    nr = addObject("model", clone, { ...rec.data });
  }
  if (nr) { setMode("select"); select(nr); toast("Objek diduplikat", true); }
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
  const selType = selected && selected.type;
  show("secWall", mode === "wall");
  show("secFloor", mode === "floor");
  show("secDoor", mode === "door");
  show("secPin", mode === "pin" || selType === "pin");
  show("secText", mode === "text" || selType === "text");
  show("secModel", selType === "model");
  show("secFloorSel", selType === "floor");
  show("secActions", !!selected);

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
  }
}
function refreshList() {
  const ul = $("objList");
  $("statCount").textContent = `${objects.length} objek`;
  if (!objects.length) { ul.innerHTML = `<div class="empty">Belum ada objek.</div>`; return; }
  ul.innerHTML = "";
  objects.forEach((o) => {
    const li = document.createElement("li");
    if (o === selected) li.className = "sel";
    const nm = o.data.name || o.data.text || o.data.ip || o.type;
    li.innerHTML = `<span class="tag">${o.type}</span><span class="nm">${escapeHtml(nm)}</span><span class="x">✕</span>`;
    li.onclick = (ev) => {
      if (ev.target.classList.contains("x")) { removeRecord(o); return; }
      if (mode !== "select") setMode("select");
      select(o);
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
      rotationY: r3(o.obj.rotation.y), scale: r3(o.obj.scale.x),
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
$("btnLoad").onclick = () => $("fileScene").click();
$("fileScene").onchange = (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  f.text().then((t) => { try { loadSceneJSON(JSON.parse(t)); toast("Scene dimuat", true); } catch { toast("JSON tidak valid", false); } });
};
$("btnNew").onclick = () => { if (confirm("Kosongkan scene?")) clearAll(); };

function clearAll() {
  objects.slice().forEach((o) => scene.remove(o.obj));
  objects = []; for (const k in byId) delete byId[k];
  transform?.detach(); selected = null; clipboard = null; floorOrder = 0;
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
      root.position.fromArray(d.position || [0, 0, 0]);
      root.rotation.y = d.rotationY || 0; root.scale.setScalar(d.scale || 1);
      addObject("model", root, { url: d.url, name: d.name, deviceIp: d.deviceIp || "" });
    }, undefined, () => toast("Model tak ditemukan: " + d.url, false));
  });
  if (s.lighting) { Object.assign(lighting, s.lighting); syncLightUI(); applyLighting(); }
  if (s.camera && s.camera.position) { camera.position.fromArray(s.camera.position); controls.target.fromArray(s.camera.target); controls.update(); }
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
    rebuildFloor(selected);
  };
  $("floorSelType").onchange = floorEdit; $("floorSelColor").oninput = floorEdit;
  $("btnFloorFront").onclick = () => { if (selected?.type === "floor") { selected.data.order = nextFloorOrder(); rebuildFloor(selected); toast("Lantai ke depan", true); } };
  $("btnFloorBack").onclick = () => {
    if (selected?.type !== "floor") return;
    const min = Math.min(0, ...objects.filter((o) => o.type === "floor").map((o) => o.data.order || 0));
    selected.data.order = min - 1; rebuildFloor(selected); toast("Lantai ke belakang", true);
  };

  // generic actions
  $("btnDup").onclick = () => duplicate(selected);
  $("btnDel").onclick = () => removeRecord(selected);

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
function connectWSForIps() {
  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (!m.devices) return;
      $("ipList").innerHTML = m.devices.map((d) => `<option value="${d.ip}">${escapeHtml(d.name)}</option>`).join("");
    };
  } catch { /* ignore */ }
}
