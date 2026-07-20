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
let selectedIp = null, dtTimer = null, labelsVisible = true, filterMode = "all", alertBaseline = false;
let zones3d = [];           // E2/E7 — zona = lantai (bounds XZ + mesh utk warna)
const ZONE_TINT = false;    // E7 pewarnaan lantai saat DOWN — dimatikan sementara (set true utk aktifkan)
let glLost = false, renderPaused = false;              // stabilitas GPU (context-lost / tab tersembunyi)
let modelsPending = 0, sceneReadyFired = false, readyTimer = null;   // #1: splash ditahan sampai model selesai
let wsRetry = 2000, lastDataAt = 0;   // #2 reconnect backoff+jitter · #3 deteksi data basi
const STALE_MS = 25000;               // data dianggap "basi" bila tak ada payload selama ini
let lite = false, frameMs = 0, lastFrame = 0;   // #4 mode ringan (grafis hemat GPU) + cap FPS
let baseDPR = 1, curDPR = 1, dprSmooth = 16.7, dprCooldown = 0;   // perf: resolusi adaptif (jaga frame-time stabil)
let fpsWarm = 0, fpsStart = 0, fpsFrames = 0, fpsLast = 0, fpsDone = false;   // pengukur FPS → saran Ringan
let camAnim = null, savedCam = null, lastT = 0;   // klik→zoom ke titik, tutup→balik
const modelCache = {};      // A2: url -> Promise<gltf.scene> (load-once, lalu clone)

// Fase 2/3 kawasan — grup objek per factory (dan per-lantai) + fokus/dim (bounds dari objek ber-tag)
// factory = { id, name, floors:[{id,name,y}], box:Box3, groups: { "<floorId|''>": {objs:[], cur:1, target:1} } }
let districtFactories = [], facById = {}, focusedFactory = "", activeFloorId = "";
function facGroup(f, floorId) {   // ambil/buat grup (factory, lantai) — key "" = objek factory tanpa lantai (selubung/tanah)
  const key = floorId || "";
  return f.groups[key] || (f.groups[key] = { objs: [], cur: 1, target: 1 });
}
function tagObj(obj, fid, floorId) {   // catat obj ke grup (factory,lantai) + perluas bounds factory
  if (!fid || !facById[fid] || !obj) return;
  obj.userData.factory = fid;
  facGroup(facById[fid], floorId).objs.push(obj);
  facById[fid].box.expandByObject(obj);
}
function tagDevice(ip, fid, floorId) {   // beacon TIDAK masuk grup struktur — diredupkan via renderBeacon (dimF), hindari 2 penulis opacity
  if (!fid || !facById[fid]) return;
  const o = deviceObjs[ip]; if (o) { o.factory = fid; o.floor = floorId || ""; }
}
function inScope(o) {   // Fase 4: device masuk konteks aktif? (All=semua; fokus=factory itu, opsional lantai aktif)
  if (!focusedFactory) return true;
  if (o.factory !== focusedFactory) return false;
  return !activeFloorId || !o.floor || o.floor === activeFloorId;
}
// SATU penulis untuk ball/ring/stem/label = gabungan (filter status × redup konteks). Halo diurus di animate().
function renderBeacon(o) {
  const op = o.dimmed ? 0.1 : (o.dimF ?? 1);
  [o.bc.ball, o.bc.ring].forEach((m) => { m.material.transparent = true; m.material.opacity = op; });
  if (o.bc.stem) { o.bc.stem.material.transparent = true; o.bc.stem.material.opacity = op; }
  if (o.labelEl) o.labelEl.style.opacity = o.dimmed ? "0.1" : ((o.dimF ?? 1) < 0.6 ? "0.28" : "");
}
function staticize(obj) {   // perf: objek statis (lantai/tembok/model/teks) → matriks tak dihitung ulang tiap frame. Aman: tak pernah bergerak; redup hanya ubah material, bukan transform.
  obj.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
}
function applyGroupDim(g, op) {   // skala opacity relatif thd nilai asli (jaga halo/sprite tetap proporsional)
  g.objs.forEach((obj) => obj.traverse((o) => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (!m) return;
      if (m.userData._op0 === undefined) m.userData._op0 = m.opacity;
      m.transparent = op < 0.999 || m.userData._op0 < 0.999;
      m.opacity = m.userData._op0 * op;
    });
  }));
}
// satu sumber kebenaran: target redup tiap grup + tiap device dari (focusedFactory, activeFloorId)
function applyDimState() {
  districtFactories.forEach((f) => {
    const facOn = !focusedFactory || f.id === focusedFactory;
    for (const key in f.groups) {
      let op = 1;
      if (!facOn) op = 0.16;                                                   // factory lain: buram
      else if (focusedFactory && activeFloorId && key && key !== activeFloorId) op = 0.28;   // lantai non-aktif di factory fokus
      f.groups[key].target = op;
    }
  });
  for (const ip in deviceObjs) {
    const o = deviceObjs[ip];
    if (!o.factory) { o.dimF = 1; renderBeacon(o); continue; }                  // beacon kawasan (jalan) selalu tampil
    const facOn = !focusedFactory || o.factory === focusedFactory;
    const floorOn = !focusedFactory || !activeFloorId || !o.floor || o.floor === activeFloorId;
    o.dimF = !facOn ? 0.2 : (floorOn ? 1 : 0.3);
    renderBeacon(o);
  }
  updateSummary();   // Fase 4: angka panel ikut konteks (All ⇄ fokus)
  updateHint();
}
let locSubBase = "", hintBase = null;   // subtitle & hint dasar (dipulihkan saat kembali ke All)
function updateHint() {   // Fase 4: subtitle panel + hint bawah menyesuaikan All vs fokus
  const sub = document.getElementById("locSub");
  if (sub) {
    if (focusedFactory) {
      const f = facById[focusedFactory];
      const fl = activeFloorId && (f.floors || []).find((x) => x.id === activeFloorId);
      sub.textContent = (f.name || focusedFactory) + (fl ? " · " + (fl.name || fl.id) : "");
    } else sub.textContent = locSubBase;
  }
  const hint = document.querySelector(".hint");
  if (hint) {
    if (hintBase === null) hintBase = hint.innerHTML;
    hint.innerHTML = focusedFactory ? t("hint_focus", "Press <kbd>Esc</kbd> or pick <b>All</b> to zoom out") : hintBase;
  }
}

const STATUS_HEX = { UP: 0x10b981, DOWN: 0xef4444 };
const UNKNOWN_HEX = 0x6b7280;

// Bidang potong: buang apa pun di bawah PERMUKAAN LANTAI (hanya diterapkan ke material model).
// constant = -floorTop → sisakan y >= floorTop. Di-set saat scene dimuat (default 1e6 = tak memotong).
const modelClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);

// =====================================================================
// F4 — cek dukungan WebGL dulu; kalau tak ada, tampilkan pesan + tawarkan tampilan 2D (SVG).
if (!webglSupported()) {
  splash.classList.remove("hidden"); splash.classList.add("error");
  const l = new URLSearchParams(location.search).get("loc");
  splashMsg.innerHTML = `Browser / perangkat ini tidak mendukung <b>WebGL</b> untuk tampilan 3D.<br>` +
    `Coba browser modern (Chrome/Edge/Firefox) atau aktifkan akselerasi hardware.<br><br>` +
    `<a href="/floormap.html${l ? "?loc=" + encodeURIComponent(l) : ""}" style="color:var(--accent);text-decoration:underline">Buka tampilan 2D →</a>`;
} else {
  try {
    lite = decideLite(); window.__pulseLite = lite; frameMs = lite ? 33 : 0;   // #4 (dikontrol via Settings)
    initThree();
    bindInteraction();
    animate();
    showGfxChip();                        // chip "⚡ Ringan" kalau lite aktif
    boot();
  } catch (err) { showError(err); }
}
function webglSupported() {
  try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); }
  catch (e) { return false; }
}
// #4 — grafis 3-state (localStorage pulse-gfx: auto|high|lite). Auto → auto-deteksi PC lemah.
function currentGfx() {
  const m = localStorage.getItem("pulse-gfx");
  if (m === "auto" || m === "high" || m === "lite") return m;
  const old = localStorage.getItem("pulse-lite");                 // migrasi dari toggle lama (1/0)
  return old === "1" ? "lite" : old === "0" ? "high" : "auto";
}
function decideLite() {
  const m = currentGfx();
  window.__pulseGfx = m;                                          // dibaca menu Pengaturan
  return m === "lite" ? true : m === "high" ? false : autoLite();
}
function autoLite() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/swiftshader|llvmpipe|software|microsoft basic|mesa/i.test(r)) return true;   // tanpa akselerasi HW
  } catch (e) {}
  if ((navigator.deviceMemory || 8) <= 3) return true;
  if ((navigator.hardwareConcurrency || 8) <= 2) return true;
  return false;
}
// Chip indikator "⚡ Ringan" — hanya muncul saat lite aktif; klik → buka menu Pengaturan. (Kontrol 3-state ada di pulse-chrome.js.)
function showGfxChip() {
  if (!lite || document.getElementById("gfxChip")) return;
  const c = document.createElement("div");
  c.id = "gfxChip"; c.className = "gfx-chip";
  c.textContent = "⚡ " + t("gfx_lite", "Lite");
  c.title = t("gfx_chip_title", "Lite graphics active — click to change");
  c.onclick = () => { const m = document.getElementById("menuBtn"); if (m) m.click(); };
  const vt = document.querySelector(".view-toggle");      // taruh di kiri toggle 3D|2D (sebaris)
  if (vt) vt.insertBefore(c, vt.firstChild); else document.body.appendChild(c);
}

// FPS-suggestion — hanya saat mode AUTO & belum lite: ukur FPS nyata (warmup 4s, sampel 3s), kalau <30 → tawarkan Ringan.
function measureFps(now) {
  if (fpsDone || lite || window.__pulseGfx !== "auto" || !now) return;
  if (!fpsWarm) { fpsWarm = now; fpsLast = now; return; }
  if (now - fpsWarm < 4000) { fpsLast = now; return; }               // lewati loading/settle
  if (now - fpsLast > 500) { fpsStart = 0; fpsFrames = 0; }           // jeda besar (tab hidden/stall) → ukur ulang
  fpsLast = now;
  if (!fpsStart) { fpsStart = now; fpsFrames = 0; return; }
  fpsFrames++;
  if (now - fpsStart >= 3000) {
    fpsDone = true;
    const fps = fpsFrames / ((now - fpsStart) / 1000);
    if (fps < 30 && !sessionStorage.getItem("pulse-fps-dismiss")) suggestLite(Math.round(fps));
  }
}
function suggestLite(fps) {
  if (document.getElementById("fpsSuggest")) return;
  const el = document.createElement("div");
  el.id = "fpsSuggest"; el.className = "fps-suggest";
  el.innerHTML = `<span>${t("fps_low", "Low frame rate")} (~${fps} fps). ${t("fps_ask", "Switch to Lite for a smoother view?")}</span>` +
    `<div class="fps-actions"><button class="fps-yes">${t("fps_enable", "Enable Lite")}</button><button class="fps-no">${t("fps_dismiss", "Dismiss")}</button></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  el.querySelector(".fps-yes").onclick = () => { localStorage.setItem("pulse-gfx", "lite"); location.reload(); };
  el.querySelector(".fps-no").onclick = () => { sessionStorage.setItem("pulse-fps-dismiss", "1"); el.classList.remove("show"); setTimeout(() => el.remove(), 300); };
}

// Lokasi + lantai aktif (dari locations.json) → menentukan scene + nama panel + WS.
let activeLoc = null, activeFloor = null;
async function boot() {
  await resolveLocation();
  await setupDecoders();     // F1: aktifkan .glb terkompresi bila decoder-nya sudah di-vendor
  connectWS();
  loadScene();
}
// F1 — dukung .glb meshopt (EXT_meshopt_compression) BILA decoder-nya ada di /vendor.
// Aman kalau belum: probe HEAD dulu → tak ada = dilewati (.glb non-kompresi tetap jalan). Draco: lihat docs.
async function setupDecoders() {
  const url = "/vendor/three/addons/libs/meshopt_decoder.module.js";
  try {
    const r = await fetch(url, { method: "HEAD" });
    if (r.ok) { const { MeshoptDecoder } = await import(url); loader.setMeshoptDecoder(MeshoptDecoder); }
  } catch (e) { /* decoder belum tersedia */ }
}
async function resolveLocation() {
  try {
    const data = await fetch("/api/locations", { cache: "no-store" }).then((r) => r.json());
    const list = data.locations || [];
    const params = new URLSearchParams(location.search);
    activeLoc = list.find((l) => l.id === params.get("loc")) || list[0] || null;   // default = urutan pertama
    const floors = (activeLoc && activeLoc.floors) || [];
    activeFloor = floors.find((f) => f.id === params.get("floor")) || floors[0] || null;   // E5: lantai default = pertama
  } catch { activeLoc = null; activeFloor = null; }
  const el = $("sceneInfo"); if (el) el.textContent = activeLoc ? activeLoc.name : t("monitoring");
}

function initThree() {
  const w = stage.clientWidth, h = stage.clientHeight;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d16);   // di-override applyTheme sesuai tema

  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 3000);
  camera.position.set(28, 24, 32);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: "high-performance" });
  baseDPR = lite ? 1 : Math.min(window.devicePixelRatio, 1.5);   // #4/perf: cap 1.5 (turun dari 2) → lebih sedikit fragment, lebih smooth
  curDPR = baseDPR;
  renderer.setPixelRatio(curDPR);
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;   // aktifkan clip per-material (motong model nembus lantai)
  // A3: shadow OFF dari awal (flat & ringan) — tanpa toggle.

  // env-map = pencahayaan lembut untuk material PBR. Biaya cuma SEKALI (bikin cubemap),
  // per-frame murah → tetap dipakai di mode ringan supaya scene tak jadi gelap. #4
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

  // TANPA plane tanah & grid — lantai (dari scene.json) melayang di atas background polos, ala Cisco.

  // tema gelap/terang: kanvas 3D ikut. Baca tema awal + dengarkan perubahan dari topbar.
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark");
  window.addEventListener("pulse-theme", (e) => applyTheme(e.detail));

  built = new THREE.Group();
  scene.add(built);
  window.addEventListener("resize", onResize);

  // stabilitas GPU: bebaskan context saat pindah/refresh halaman (cegah context menumpuk → "WebGL not
  // supported"), pause render saat tab tersembunyi, dan tangani context-lost tanpa crash.
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); glLost = true; onContextLost(); }, false);
  canvas.addEventListener("webglcontextrestored", () => { glLost = false; }, false);
  window.addEventListener("pagehide", freeGL);
  document.addEventListener("visibilitychange", () => { renderPaused = document.hidden; });
}
function freeGL() { try { renderer.forceContextLoss(); } catch (e) {} try { renderer.dispose(); } catch (e) {} }
function onContextLost() {
  splash.classList.remove("hidden"); splash.classList.add("error");
  splashMsg.innerHTML = "Tampilan 3D terhenti sesaat (GPU sibuk).<br>" +
    "<a href=\"#\" onclick=\"location.reload();return false\" style=\"color:var(--accent);text-decoration:underline\">Muat ulang</a>";
}
// #1: sembunyikan splash hanya setelah SEMUA model 3D selesai load (atau 12s sbg pengaman)
function markModelDone() { if (modelsPending > 0) modelsPending--; if (modelsPending <= 0) fireSceneReady(); }
function fireSceneReady() { if (sceneReadyFired) return; sceneReadyFired = true; clearTimeout(readyTimer); hideSplash(); }

function animate(now) {
  requestAnimationFrame(animate);
  if (glLost || renderPaused) return;   // jangan render saat context hilang / tab tersembunyi
  if (frameMs && now && now - lastFrame < frameMs) return;   // #4: batasi FPS di mode ringan
  const frameDt = (now && lastFrame) ? now - lastFrame : 16.7;   // ms antar-frame yg benar-benar dirender
  lastFrame = now || 0;
  const t = clock ? clock.getElapsedTime() : 0;
  const dt = Math.min(0.1, t - lastT); lastT = t;
  for (const ip in deviceObjs) {
    const o = deviceObjs[ip];
    if (o.dimmed) { o.bc.halo.material.opacity = 0; continue; }   // E4: disembunyikan filter
    const df = o.dimF ?? 1;   // Fase 2: beacon factory lain diredupkan saat fokus
    if (o.status === "DOWN") {
      const ph = (t * 0.9) % 1;
      o.bc.halo.scale.setScalar(1 + ph * 1.8);
      o.bc.halo.material.opacity = 0.4 * (1 - ph) * df;
    } else {
      o.bc.halo.scale.setScalar(1.05);
      o.bc.halo.material.opacity = 0.1 * df;
    }
  }
  for (const f of districtFactories) {   // Fase 2/3: animasikan redup tiap grup (factory,lantai) menuju target
    for (const key in f.groups) {
      const g = f.groups[key];
      if (Math.abs(g.cur - g.target) > 0.004) {
        g.cur += (g.target - g.cur) * Math.min(1, dt * 6);
        applyGroupDim(g, g.cur);
      }
    }
  }
  if (camAnim) {
    camAnim.t += dt / camAnim.dur;
    const k = Math.min(1, camAnim.t), e = k * k * (3 - 2 * k);   // smoothstep
    camera.position.lerpVectors(camAnim.fromP, camAnim.toP, e);
    controls.target.lerpVectors(camAnim.fromT, camAnim.toT, e);
    camera.lookAt(controls.target);
    if (k >= 1) { camAnim = null; controls.enabled = true; }
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  adaptResolution(frameDt);              // perf: auto turun/naik resolusi supaya frame-time tetap halus
  measureFps(now);                       // saran mode Ringan bila FPS nyata rendah (mode Auto saja)
}
// Resolusi adaptif — kalau frame berat, turunkan pixelRatio (gambar sedikit lebih lembut tapi lancar);
// kalau lega, naikkan lagi sampai baseDPR. Menjaga kelancaran di hardware apa pun tanpa perlu diatur manual.
// ponytail: heuristik EMA sederhana + cooldown; kalau butuh lebih presisi baru pakai kurva/pengukuran GPU.
function adaptResolution(frameDt) {
  if (frameDt <= 0 || frameDt > 500) return;                // abaikan lonjakan (tab kembali, hitch besar)
  dprSmooth += (frameDt - dprSmooth) * 0.1;                 // rata-rata bergerak
  if (dprCooldown > 0) { dprCooldown--; return; }           // beri jeda tiap ganti resolusi (hindari osilasi)
  const budget = frameMs || 16.7;                           // target: pakai cap FPS bila ada, else ~60fps
  if (dprSmooth > budget * 1.35 && curDPR > 0.6) {          // berat → turunkan
    curDPR = Math.max(0.6, curDPR - 0.15); renderer.setPixelRatio(curDPR); dprCooldown = 45;
  } else if (dprSmooth < budget * 1.05 && curDPR < baseDPR) {   // lega → naikkan bertahap
    curDPR = Math.min(baseDPR, curDPR + 0.1); renderer.setPixelRatio(curDPR); dprCooldown = 90;
  }
}
function onResize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
}

// =====================================================================
//  LOAD SCENE
// =====================================================================
async function loadScene() {
  const forced = new URLSearchParams(location.search).get("scene");
  const url = forced || (activeFloor && activeFloor.scene3d) || (activeLoc && activeLoc.scene3d) || "/scene.json";
  const setSub = (t) => { locSubBase = t; const s = $("locSub"); if (s && !focusedFactory) s.textContent = t; };
  const tryLoad = async (u) => {
    const res = await fetch(u, { cache: "no-store" });
    const data = JSON.parse(await res.text());   // throws if it's the SPA-fallback HTML
    buildFromScene(data);   // splash ditutup oleh fireSceneReady() setelah SEMUA model 3D selesai load
  };
  try {
    await tryLoad(url);
    setSub(activeFloor ? activeFloor.name : "Live monitoring");
  } catch (e) {
    // tidak dipaksa via ?scene= → coba contoh bawaan supaya langsung ada tampilan
    if (!forced) {
      try { await tryLoad("/scene.example.json"); setSub(activeFloor ? activeFloor.name + " · contoh" : "Denah contoh"); return; }
      catch (_) { /* jatuh ke pesan bantuan */ }
    }
    splash.classList.remove("hidden"); splash.classList.remove("error");
    splashMsg.innerHTML = `Belum ada denah <b>${url}</b> untuk lokasi ini.<br>Export dari Scene Builder → taruh <b>scene.json</b> di <b>v2/public/</b>, ` +
      `atau klik tombol <b>📂</b> (kanan bawah) untuk memuat file dari komputer.`;
  }
}
const _bl = $("btnLoad"), _fs = $("fileScene");   // opsional (mungkin sudah dihapus dari UI)
if (_bl && _fs) {
  _bl.onclick = () => _fs.click();
  _fs.onchange = (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    f.text().then((t) => { try { buildFromScene(JSON.parse(t)); hideSplash(); } catch { showError("scene.json tidak valid"); } });
  };
}

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

// Fase 2 — kamera + selektor factory (All ⇄ fokus), tanpa reload
function frameBox(box, mult) {   // animasikan kamera membingkai sebuah bounds
  if (!box || box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z, size.y) || 10;
  const dist = maxDim * (mult || 1.4) + 6;
  const toP = new THREE.Vector3(center.x + dist * 0.6, Math.max(center.y + dist * 0.7, dist * 0.5), center.z + dist * 0.9);
  startCamAnim(toP, center.clone());
}
function buildFactorySelector() {
  let nav = document.getElementById("factoryNav");
  if (!districtFactories.length) { if (nav) nav.remove(); return; }
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "factoryNav"; nav.className = "factory-nav";
    nav.innerHTML =
      `<span class="fn-lbl">${t("factory", "Factory")}</span><select id="factorySel"></select>` +
      `<span class="fn-floor" style="display:none"><span class="fn-sep"></span><span class="fn-lbl">${t("floor", "Floor")}</span><select id="floorSel"></select></span>`;
    stage.appendChild(nav);
    nav.querySelector("#factorySel").addEventListener("change", (e) => selectFactory(e.target.value));
    nav.querySelector("#floorSel").addEventListener("change", (e) => selectFloor(e.target.value));
  }
  const sel = document.getElementById("factorySel");
  sel.innerHTML = `<option value="">${t("all_factories", "All")}</option>` +
    districtFactories.map((f) => `<option value="${f.id}">${(f.name || f.id).replace(/</g, "&lt;")}</option>`).join("");
  sel.value = focusedFactory;
  updateFloorSelector();
}
function updateFloorSelector() {   // Fase 3: sub-selektor lantai — hanya bila factory fokus punya ≥2 lantai
  const wrap = document.querySelector("#factoryNav .fn-floor");
  const fs = document.getElementById("floorSel");
  const floors = (facById[focusedFactory] && facById[focusedFactory].floors) || [];
  if (!focusedFactory || floors.length < 2) { if (wrap) wrap.style.display = "none"; return; }
  wrap.style.display = "";
  fs.innerHTML = `<option value="">${t("all_floors", "All")}</option>` +
    floors.map((fl) => `<option value="${fl.id}">${(fl.name || fl.id).replace(/</g, "&lt;")}</option>`).join("");
  fs.value = activeFloorId;
}
function setDeepLink() {
  const u = new URL(location.href);
  focusedFactory ? u.searchParams.set("factory", focusedFactory) : u.searchParams.delete("factory");
  activeFloorId ? u.searchParams.set("floor", activeFloorId) : u.searchParams.delete("floor");
  history.replaceState(null, "", u);
}
function selectFactory(id) {
  focusedFactory = id && facById[id] ? id : "";
  activeFloorId = "";   // ganti factory → default semua lantai
  const sel = document.getElementById("factorySel"); if (sel) sel.value = focusedFactory;
  updateFloorSelector();
  applyDimState();
  setDeepLink();
  if (!focusedFactory) frameBox(new THREE.Box3().setFromObject(built), 1.4);   // All = fit seluruh kawasan
  else frameBox(facById[focusedFactory].box, 1.5);
}
function selectFloor(floorId) {   // Fase 3: pilih lantai aktif (bright), lainnya redup — tanpa gerakkan kamera
  const floors = (facById[focusedFactory] && facById[focusedFactory].floors) || [];
  activeFloorId = floors.some((fl) => fl.id === floorId) ? floorId : "";
  const fs = document.getElementById("floorSel"); if (fs) fs.value = activeFloorId;
  applyDimState();
  setDeepLink();
}
function syncFactoryDimFor(fid) {   // objek async (model .glb) selesai → samakan redup dgn fokus/lantai aktif (tanpa gerakkan kamera)
  const f = facById[fid]; if (!f) return;
  applyDimState();   // pastikan target grup (termasuk yg baru) benar
  for (const key in f.groups) { const g = f.groups[key]; g.cur = g.target; applyGroupDim(g, g.cur); }   // snap objek baru agar tak berkedip
}

function buildFromScene(s) {
  clearBuilt();
  // nama panel = name lokasi (di-set resolveLocation), BUKAN nama scene (terlalu teknis).

  districtFactories = (s.factories || []).map((f) => ({ id: f.id, name: f.name, floors: f.floors || [], box: new THREE.Box3(), groups: {} }));
  facById = {}; focusedFactory = ""; activeFloorId = "";
  districtFactories.forEach((f) => { facById[f.id] = f; });

  if (s.lighting) applyLighting(s.lighting);

  if (s.walls && s.walls.length) { const wg = buildWallsMerged(s.walls); staticize(wg); built.add(wg); }   // A2: 1 mesh per warna, di-grup per factory
  let floorTop = null;
  zones3d = [];
  (s.floors || []).forEach((d, i) => {
    const fm = buildFloor(d);
    tagObj(fm, d.factory, d.floor);
    staticize(fm);
    built.add(fm);
    zones3d.push({                             // E2/E7: tiap lantai = 1 zona
      name: d.name || d.label || `Zona ${i + 1}`,
      bounds: { minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minZ: d.z - d.d / 2, maxZ: d.z + d.d / 2 },
      mesh: fm, baseHex: (fm.material || fm.children[0]?.material)?.color.getHex() ?? 0x3a3f47, up: 0, down: 0, total: 0,
    });
    const t = 0.03 + (d.order || 0) * 0.006;   // = permukaan atas (samakan dengan buildFloor)
    if (floorTop === null || t > floorTop) floorTop = t;
  });
  modelClip.constant = floorTop === null ? 1e6 : -floorTop;   // ada lantai → potong model di garis lantai
  (s.texts || []).forEach((d) => { const sp = makeTextSprite(d); tagObj(sp, d.factory, d.floor); staticize(sp); built.add(sp); });
  (s.pins || []).forEach((d) => addPinDevice(d));
  sceneReadyFired = false;
  modelsPending = (s.models || []).length;
  clearTimeout(readyTimer); readyTimer = setTimeout(fireSceneReady, 12000);   // pengaman bila ada model gagal/hang
  if (splashMsg && modelsPending) splashMsg.textContent = t("preparing_3d");
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
  updateSummary();   // tampilkan total pin scene walau data live belum masuk
  if (modelsPending === 0) fireSceneReady();   // tak ada model → langsung siap (splash ditutup)

  buildFactorySelector();
  const params = new URLSearchParams(location.search);
  const wantFac = params.get("factory"), wantFloor = params.get("floor");
  if (wantFac && facById[wantFac]) { selectFactory(wantFac); if (wantFloor) selectFloor(wantFloor); }   // deep-link ?factory=&floor=
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
  const group = new THREE.Group();
  const bySet = {};   // "factory|floor" → dinding; merge per (factory,lantai) agar bisa diredupkan terpisah
  walls.forEach((d) => { const k = (d.factory || "") + "|" + (d.floor || ""); (bySet[k] = bySet[k] || []).push(d); });
  Object.keys(bySet).forEach((k) => {
    const [fid, floorId] = k.split("|");
    const byColor = {};
    bySet[k].forEach((d) => collectWallGeoms(d, byColor));
    for (const hex in byColor) {
      const merged = BufferGeometryUtils.mergeGeometries(byColor[hex], false);
      byColor[hex].forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: parseInt(hex), roughness: 0.6, metalness: 0.12, envMapIntensity: 0.9 }));
      tagObj(mesh, fid, floorId);
      group.add(mesh);
    }
  });
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
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(a[0] + ux * mid, (d.baseY || 0) + (y0 + y1) / 2, a[1] + uz * mid), q, one));   // baseY: dinding lantai bertumpuk
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
    color: col, roughness: d.type === "green" ? 0.6 : 0.92, metalness: 0, envMapIntensity: 0.4,
    emissive: d.type === "green" ? 0x0c3f22 : 0x000000, emissiveIntensity: d.type === "green" ? 0.35 : 0,
  });
  const H = 0.25;                               // volume/tebal lantai (bukan plane tipis)
  const base = 0.03 + (d.order || 0) * 0.006;   // permukaan dasar; order = mana yang di depan
  const elev = d.elev || 0;
  const shape = d.shape || "flat";
  let obj;
  if (shape === "ramp" && elev > 0) obj = buildRamp(d, mat, H, base, elev);
  else if (shape === "stairs" && elev > 0) obj = buildStairs(d, mat, base, elev);
  else {                                        // datar (platform bila elev>0)
    obj = new THREE.Mesh(new THREE.BoxGeometry(d.w, H, d.d), mat);
    obj.position.set(d.x, base + elev - H / 2, d.z);
    obj.receiveShadow = true;
  }
  obj.renderOrder = d.order || 0;
  return obj;
}
// samakan persis dengan Scene Builder. ponytail: ramp/tangga visual-only (tanpa collision).
function buildRamp(d, mat, H, base, elev) {
  const axis = d.dir === "+x" || d.dir === "-x" ? "x" : "z";
  const run = axis === "x" ? d.w : d.d;
  const ang = Math.atan2(elev, run);
  const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, H, d.d), mat);
  m.receiveShadow = true;
  if (axis === "x") m.rotation.z = d.dir === "+x" ? ang : -ang;
  else m.rotation.x = d.dir === "+z" ? -ang : ang;
  m.position.set(d.x, base + (run / 2) * Math.sin(ang), d.z);
  return m;
}
function buildStairs(d, mat, base, elev) {
  const axis = d.dir === "+x" || d.dir === "-x" ? "x" : "z";
  const run = axis === "x" ? d.w : d.d;
  const n = Math.max(2, Math.round(elev / 0.25));
  const stepH = elev / n, stepRun = run / n;
  const sign = d.dir === "+x" || d.dir === "+z" ? 1 : -1;
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const h = stepH * (i + 1);
    const geo = axis === "x" ? new THREE.BoxGeometry(stepRun, h, d.d) : new THREE.BoxGeometry(d.w, h, stepRun);
    const s = new THREE.Mesh(geo, mat);
    s.receiveShadow = true;
    const off = sign * (-run / 2 + stepRun * (i + 0.5));
    if (axis === "x") s.position.set(off, base + h / 2, 0);
    else s.position.set(0, base + h / 2, off);
    g.add(s);
  }
  g.position.set(d.x, 0, d.z);
  return g;
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, lite ? 20 : 36),   // #4 segmen lebih rendah di mode ringan
    new THREE.MeshBasicMaterial({ color: UNKNOWN_HEX, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  let stem = null;
  if (withStem) {
    const hgt = Math.max(0.4, ballY - 0.1);
    stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, hgt, lite ? 6 : 10),
      new THREE.MeshStandardMaterial({ color: UNKNOWN_HEX, emissive: UNKNOWN_HEX, emissiveIntensity: 0.3 }));
    stem.position.y = hgt / 2; stem.castShadow = true;
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, lite ? 12 : 22, lite ? 12 : 22),
    new THREE.MeshStandardMaterial({ color: UNKNOWN_HEX, emissive: UNKNOWN_HEX, emissiveIntensity: 0.7, roughness: 0.4 }));
  ball.position.y = ballY; ball.castShadow = true;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.34, lite ? 10 : 18, lite ? 10 : 18),
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
  deviceObjs[ip] = { bc, name: name || ip, status: "UNKNOWN", labelEl: el, pos: { x: bc.group.position.x, z: bc.group.position.z } };
}

function addPinDevice(d) {
  const bc = makeBeacon(2.35, true);
  bc.group.position.set(d.x, d.y || 0, d.z);   // y: pin lantai bertumpuk
  built.add(bc.group);
  registerDevice(d.ip, d.label || d.ip, bc);
  tagDevice(d.ip, d.factory, d.floor);
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
    // potong bagian model yang tertanam/tembus di bawah lantai (rapi dari segala sudut)
    root.traverse((o) => {
      if (o.isMesh && o.material) {
        // kawasan: clone material per-instance supaya redup 1 factory tak menular ke model ber-URL sama di factory lain
        if (d.factory) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => {
          mm.clippingPlanes = [modelClip]; mm.needsUpdate = true;
        });
      }
    });
    built.add(root);
    tagObj(root, d.factory, d.floor);
    staticize(root);   // model statis → hemat matriks per-frame (beacon-nya tetap dinamis, ditambah terpisah)
    if (d.deviceIp) {
      const box = new THREE.Box3().setFromObject(root);
      const topY = isFinite(box.max.y) ? box.max.y : (d.position?.[1] || 0) + 2;
      const bc = makeBeacon(topY + 1, false);
      bc.group.position.set(d.position?.[0] || 0, 0, d.position?.[2] || 0);
      built.add(bc.group);
      registerDevice(d.deviceIp, d.name || d.deviceIp, bc);
      tagDevice(d.deviceIp, d.factory, d.floor);
      if (Object.keys(deviceByIp).length) applyStatus(Object.values(deviceByIp));
      updateSummary();   // model .glb load async → refresh hitungan saat beacon-nya siap
    }
    if (d.factory) syncFactoryDimFor(d.factory);   // samakan redup model async dgn fokus aktif (tanpa gerakkan kamera)
    markModelDone();   // #1
  }).catch(() => { console.warn("model tak ditemukan:", d.url); markModelDone(); });
}

// =====================================================================
//  LIVE STATUS
// =====================================================================
function applyStatus(devices) {
  devices.forEach((d) => {
    const o = deviceObjs[d.ip];
    if (!o) return;
    const prev = o.status;
    o.status = d.status;
    recolorBeacon(o.bc, STATUS_HEX[d.status] ?? UNKNOWN_HEX);
    if (alertBaseline && prev !== d.status && window.pulseAlert) {   // E8: toast hanya utk PERUBAHAN (bukan snapshot awal)
      if (d.status === "DOWN") window.pulseAlert(o.name || d.name || d.ip, d.ip, "down");
      else if (d.status === "UP" && prev === "DOWN") window.pulseAlert(o.name || d.name || d.ip, d.ip, "up");
    }
  });
  alertBaseline = true;
  if (selectedIp && deviceByIp[selectedIp]) renderDetail(deviceByIp[selectedIp]);
  updateSummary();
  applyFilter();   // E4: pertahankan sorotan filter saat status berubah
}

// E4 — filter status: redupkan beacon yang tak cocok (Semua/Up/Down)
function beaconMatches(o) {
  if (filterMode === "up") return o.status === "UP";
  if (filterMode === "down") return o.status === "DOWN";
  return true;   // "all"
}
function applyFilter() {
  for (const ip in deviceObjs) {
    const o = deviceObjs[ip];
    o.dimmed = !beaconMatches(o);   // filter status; renderBeacon gabungkan dgn redup konteks (dimF)
    renderBeacon(o);
  }
}
function sevIcon(sev) { return sev === "CRITICAL" || sev === "HIGH" ? "▲" : sev === "MEDIUM" ? "◆" : "•"; }

// ---- hook untuk chrome bersama (E3 cari/fly-to, E4 filter) ----
window.pulseGetTargets = () => Object.keys(deviceObjs).map((ip) => ({ ip, name: deviceObjs[ip].name, status: deviceObjs[ip].status }));
window.pulseFocus = (ip) => { if (deviceObjs[ip]) openDetail(ip); };
window.pulseFilter = (mode) => { filterMode = mode || "all"; applyFilter(); };

// Ringkasan dihitung dari PIN DI SCENE (deviceObjs), bukan semua device yang dikirim WS.
// Jadi kalau scene punya 2 pin tapi WS kirim 3 device, total tetap 2.
function updateSummary() {
  const ips = Object.keys(deviceObjs).filter((ip) => inScope(deviceObjs[ip]));   // Fase 4: hanya device dalam konteks aktif
  const total = ips.length;
  let up = 0, down = 0, unknown = 0;
  ips.forEach((ip) => {
    const st = deviceObjs[ip].status;
    if (st === "UP") up++; else if (st === "DOWN") down++; else unknown++;
  });
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("totalDevices", total); set("upCount", up); set("downCount", down);
  const uc = $("unknownCount");
  if (uc) { uc.textContent = unknown; const chip = uc.closest(".sp-chip"); if (chip) chip.style.display = unknown ? "" : "none"; }
  const known = up + down;
  const score = (total === 0) ? 100 : (known === 0 ? null : Math.round((up / total) * 100));   // null = belum ada data live
  const el = $("healthScore");
  if (el) {
    el.textContent = score === null ? "—" : `${score}%`;
    el.style.color = score === null ? "var(--text-dim)" : score >= 95 ? "var(--up)" : score >= 60 ? "var(--high)" : "var(--down)";
  }
  const bar = $("healthBar"); if (bar) bar.style.width = `${score === null ? 0 : score}%`;
  const dot = $("spDot"); if (dot) dot.style.background = down ? "var(--down)" : up ? "var(--up)" : "var(--unknown)";
  updateZones();   // E2/E7
}

// E2/E7 — occupancy & pewarnaan zona (zona 3D = lantai; device dipetakan by koordinat XZ)
function zoneAt(x, z) {
  let best = null, bestArea = Infinity;                 // pilih zona terkecil yang memuat titik
  for (const zn of zones3d) {
    const b = zn.bounds;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      const a = (b.maxX - b.minX) * (b.maxZ - b.minZ);
      if (a < bestArea) { bestArea = a; best = zn; }
    }
  }
  return best;
}
function updateZones() {
  // Kawasan: panel zona (occupancy by-XZ) tak cocok utk lantai bertumpuk (l1/l2 satu XZ) → sembunyikan; ringkasan ber-scope jadi sumber angka. ponytail: per-floor zone mapping kalau memang dibutuhkan.
  if (districtFactories.length) { const p = $("zonePanel"); if (p) { p.style.display = "none"; p.innerHTML = ""; } return; }
  if (!zones3d.length) { const p = $("zonePanel"); if (p) { p.style.display = "none"; p.innerHTML = ""; } return; }
  zones3d.forEach((z) => { z.up = 0; z.down = 0; z.total = 0; });
  for (const ip in deviceObjs) {
    const o = deviceObjs[ip]; if (!o.pos) continue;
    const z = zoneAt(o.pos.x, o.pos.z); if (!z) continue;
    z.total++;
    if (o.status === "UP") z.up++; else if (o.status === "DOWN") z.down++;
  }
  if (ZONE_TINT) zones3d.forEach((z) => { const mm = z.mesh && (z.mesh.material || z.mesh.children[0]?.material); if (mm) mm.color.setHex(z.down > 0 ? 0x7a2533 : z.baseHex); });   // E7 (dimatikan)
  renderZonePanel(zones3d);
}
function renderZonePanel(zones) {
  const panel = $("zonePanel"); if (!panel) return;
  const active = zones.filter((z) => z.total > 0);
  if (!active.length) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  panel.style.display = "";
  panel.innerHTML = `<div class="sp-zones-title">Zona (${active.length})</div>` + active.map((z) =>
    `<div class="zone-row" data-zi="${zones.indexOf(z)}"><span class="zone-dot ${z.down > 0 ? "down" : z.up > 0 ? "up" : ""}"></span><span class="zone-name">${esc(z.name)}</span><span class="zone-stat"><b class="${z.down > 0 ? "has-down" : ""}">${z.up}</b>/${z.total}</span></div>`
  ).join("");
  panel.querySelectorAll(".zone-row").forEach((row) => (row.onclick = () => focusZone(zones[+row.dataset.zi])));
}
function focusZone(z) {
  if (!z) return;
  const b = z.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) || 10;
  const target = new THREE.Vector3(cx, 0.5, cz);
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = size * 1.1 + 8;
  startCamAnim(target.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * 0.5, 0)), target);
}

// tema gelap/terang untuk kanvas 3D (background polos + intensitas cahaya ambien)
function applyTheme(theme) {
  if (!scene) return;
  const light = theme === "light";
  scene.background = new THREE.Color(light ? 0xeef2f8 : 0x0a0d16);
  if (hemi) hemi.intensity = light ? 0.9 : 0.5;
  if (amb) amb.intensity = light ? 0.55 : 0.24;
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

  const rv = $("resetView"); if (rv) rv.onclick = () => { camera.position.set(28, 24, 32); controls.target.set(0, 1, 0); controls.update(); };
  const tl = $("toggleLabels"); if (tl) tl.onclick = () => { labelsVisible = !labelsVisible; labelEls.forEach((el) => (el.style.display = labelsVisible ? "" : "none")); };
  document.addEventListener("keydown", (e) => {   // Esc: tutup detail dulu; kalau tak ada & sedang fokus factory → kembali ke All
    if (e.key !== "Escape") return;
    if (selectedIp) { closeDetail(); return; }
    if (focusedFactory) selectFactory("");
  });
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

function startCamAnim(toP, toT) {
  camAnim = { fromP: camera.position.clone(), toP, fromT: controls.target.clone(), toT, t: 0, dur: 0.5 };
  controls.enabled = false;
}
function focusOn(worldPos) {
  if (!savedCam) savedCam = { pos: camera.position.clone(), target: controls.target.clone() };
  const dir = camera.position.clone().sub(controls.target).normalize();
  const toP = worldPos.clone().add(dir.multiplyScalar(13)).add(new THREE.Vector3(0, 4, 0));  // zoom sedang
  startCamAnim(toP, worldPos.clone());
}
function restoreCam() {
  if (!savedCam) return;
  startCamAnim(savedCam.pos.clone(), savedCam.target.clone());
  savedCam = null;
}
function openDetail(ip) {
  selectedIp = ip;
  const d = deviceByIp[ip] || { ip, name: (deviceObjs[ip] && deviceObjs[ip].name) || ip };   // E1: tetap render walau belum ada data live
  renderDetail(d);
  detailPanel.classList.add("open");
  document.body.classList.add("detail-open");
  const o = deviceObjs[ip];
  if (o) { const wp = new THREE.Vector3(); o.bc.group.getWorldPosition(wp); wp.y += 1.2; focusOn(wp); }
}
function closeDetail() {
  detailPanel.classList.remove("open");
  document.body.classList.remove("detail-open");
  selectedIp = null;
  if (dtTimer) { clearInterval(dtTimer); dtTimer = null; }
  restoreCam();
}
function renderDetail(d) {
  const hasData = d.status != null;
  const isDown = d.status === "DOWN";
  const sev = d.severity || "LOW";
  const avail = d.uptimeToday ?? 100;
  const trend = (d.history || []).slice(-24);            // E9: kronologis kiri→kanan
  const hist = (d.history || []).slice(-6).reverse();
  const rcaps = window.remoteCaps ? window.remoteCaps(d.ip) : { ssh: false, vnc: false };   // Fase 2: kapabilitas remote device ini
  detailContent.innerHTML = `
    <div class="dt-head">
      <div><h2>${esc(d.name)}</h2><div class="dt-ip">${d.ip} · <span class="badge sev-${sev}">${sevIcon(sev)} ${sev}</span></div></div>
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
        <div class="dt-item"><div class="dt-label">Availability</div><div class="dt-val ${hasData ? (avail >= 99 ? "up" : "down") : ""}">${hasData ? avail + "%" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Latency</div><div class="dt-val">${d.latency != null ? d.latency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Avg</div><div class="dt-val">${d.avgLatency != null ? d.avgLatency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Peak</div><div class="dt-val">${d.maxLatency != null ? d.maxLatency + " ms" : "—"}</div></div>
        <div class="dt-item"><div class="dt-label">Downtime</div><div class="dt-val">${fmtSec(d.downtimeTodaySec ?? 0)}</div></div>
        <div class="dt-item"><div class="dt-label">Severity</div><div class="dt-val" style="font-size:13px">${sev}</div></div>
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

// =====================================================================
//  WEBSOCKET (same endpoint as v1; read-only)
// =====================================================================
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const loc = (activeLoc && activeLoc.id) || new URLSearchParams(location.search).get("loc");   // lokasi aktif
  const ws = new WebSocket(`${proto}://${location.host}/ws${loc ? "?loc=" + encodeURIComponent(loc) : ""}`);
  ws.onopen = () => { wsRetry = 2000; setConn(true); };                                 // #2: reset backoff saat sukses
  ws.onclose = () => { setConn(false); setTimeout(connectWS, wsRetry + Math.random() * 1000); wsRetry = Math.min(30000, wsRetry * 1.7); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "cmd_result") return;
    if (m.type === "pulse_status") { setConn(m.up, m.up ? t("connected") : t("source_offline")); return; }   // status sumber (upstream)
    if (m.devices) {
      m.devices.forEach((d) => (deviceByIp[d.ip] = d)); applyStatus(m.devices);   // applyStatus → updateSummary
      lastDataAt = Date.now(); if ($("connDot").classList.contains("stale")) setConn(true);   // #3: data segar lagi
    }
    if (m.timestamp) $("lastUpdate").textContent = `${t("update")} ${m.timestamp}`;
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
  if (!dot.classList.contains("connected") && !dot.classList.contains("stale")) return;   // hanya saat dianggap tersambung
  if (lastDataAt && Date.now() - lastDataAt > STALE_MS) {
    dot.classList.remove("connected"); dot.classList.add("stale");
    lbl.textContent = `Data basi (${Math.floor((Date.now() - lastDataAt) / 1000)}s)`;
  }
}
setInterval(staleCheck, 5000);

// ---- util ----
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function fmtSec(s) { if (!s) return "0s"; const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`; }
function hideSplash() { splash.classList.add("hidden"); }
function showError(err) {
  console.error(err);
  splash.classList.remove("hidden"); splash.classList.add("error");
  splashMsg.textContent = "Gagal memuat tampilan 3D: " + (err && err.message ? err.message : err) + ". Cek Console (F12).";
}
