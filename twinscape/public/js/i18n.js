/* Twinscape — i18n ringan. Default English. Ganti bahasa = reload (semua re-render).
   Static HTML: data-i18n / data-i18n-ph / data-i18n-title / data-i18n-html.
   Dinamis (JS): window.t("key","fallback"). Konten scene (label device dari JSON) TIDAK diterjemahkan. */
(function () {
  var D = {
    // ── menu / settings ──
    menu: { en: "Menu", id: "Menu" },
    settings: { en: "Settings", id: "Pengaturan" },
    language: { en: "Language", id: "Bahasa" },
    theme: { en: "Theme", id: "Tema" },
    light: { en: "Light", id: "Terang" },
    dark: { en: "Dark", id: "Gelap" },
    sound: { en: "Alert sound", id: "Suara alert" },
    sound_sub: { en: "beep when a device goes down", id: "bunyi saat device down" },
    graphics: { en: "Graphics", id: "Grafis" },
    graphics_sub: { en: "quality · reloads", id: "kualitas · muat ulang" },
    gfx_auto: { en: "Auto", id: "Auto" },
    gfx_high: { en: "High", id: "Tinggi" },
    gfx_lite: { en: "Lite", id: "Ringan" },
    gfx_chip_title: { en: "Lite graphics active — click to change", id: "Grafis ringan aktif — klik untuk ubah" },
    fps_low: { en: "Low frame rate", id: "Frame rate rendah" },
    fps_ask: { en: "Switch to Lite for a smoother view?", id: "Aktifkan Mode Ringan biar lebih mulus?" },
    fps_enable: { en: "Enable Lite", id: "Aktifkan Ringan" },
    fps_dismiss: { en: "Dismiss", id: "Tutup" },
    logout: { en: "Log out", id: "Keluar" },
    // ── topbar / status ──
    search_ph: { en: "Search device / IP…", id: "Cari device / IP…" },
    connecting: { en: "Connecting…", id: "Menyambung…" },
    connected: { en: "Connected", id: "Terhubung" },
    offline: { en: "Offline", id: "Offline" },
    source_offline: { en: "Source offline", id: "Sumber offline" },
    update: { en: "Update", id: "Update" },
    // ── stat panel ──
    live_monitoring: { en: "Live monitoring", id: "Monitoring langsung" },
    monitoring: { en: "Monitoring", id: "Monitoring" },
    device_online: { en: "devices online", id: "device online" },
    health: { en: "Health", id: "Health" },
    down: { en: "Down", id: "Down" },
    all: { en: "All", id: "Semua" },
    up: { en: "Up", id: "Up" },
    no_data: { en: "No data", id: "No data" },
    zones: { en: "Zones", id: "Zona" },
    // ── controls / hint / legend ──
    reset_cam: { en: "Reset camera", id: "Reset kamera" },
    reset_view: { en: "Reset view", id: "Reset tampilan" },
    zoom_in: { en: "Zoom in", id: "Zoom in" },
    zoom_out: { en: "Zoom out", id: "Zoom out" },
    export_svg: { en: "Export static SVG", id: "Export SVG statik" },
    hint_3d: { en: "<b>Drag</b> rotate · <kbd>scroll</kbd> zoom · <b>click</b> a device for details", id: "<b>Drag</b> putar · <kbd>scroll</kbd> zoom · <b>klik</b> device untuk detail" },
    legend_status: { en: "Status", id: "Status" },
    legend_severity: { en: "Severity", id: "Severity" },
    up_online: { en: "Up / Online", id: "Up / Online" },
    down_offline: { en: "Down / Offline", id: "Down / Offline" },
    unmapped: { en: "Unmapped", id: "Belum terpetakan" },
    critical: { en: "Critical", id: "Critical" },
    high: { en: "High", id: "High" },
    medium: { en: "Medium", id: "Medium" },
    low: { en: "Low", id: "Low" },
    // ── splash ──
    loading_scene: { en: "Loading scene…", id: "Memuat scene…" },
    preparing_3d: { en: "Preparing 3D view…", id: "Menyiapkan tampilan 3D…" },
    // ── detail panel ──
    device_up: { en: "DEVICE UP", id: "DEVICE UP" },
    device_down: { en: "DEVICE DOWN", id: "DEVICE DOWN" },
    no_live_data: { en: "NO LIVE DATA", id: "TIDAK ADA DATA LIVE" },
    not_reported: { en: "This device IP hasn't reported from this location's WS.", id: "Device IP ini belum melapor dari WS lokasi ini." },
    status_trend: { en: "Status Trend", id: "Status Trend" },
    network_quality: { en: "Network Quality", id: "Network Quality" },
    availability: { en: "Availability", id: "Availability" },
    latency: { en: "Latency", id: "Latency" },
    avg: { en: "Avg", id: "Avg" },
    peak: { en: "Peak", id: "Peak" },
    downtime: { en: "Downtime", id: "Downtime" },
    severity: { en: "Severity", id: "Severity" },
    device_info: { en: "Device Info", id: "Device Info" },
    owner: { en: "Owner", id: "Owner" },
    location: { en: "Location", id: "Location" },
    vendor: { en: "Vendor", id: "Vendor" },
    recent_events: { en: "Recent Events", id: "Recent Events" },
    no_data_yet: { en: "No data yet.", id: "Belum ada data." },
    no_events: { en: "No events yet.", id: "Belum ada event." },
    position_xy: { en: "Position (x,y)", id: "Posisi (x,y)" },
    open_ssh: { en: "Open SSH", id: "Open SSH" },
    open_vnc: { en: "Open VNC", id: "Open VNC" },
    // ── alerts ──
    alert_recovered: { en: "RECOVERED (UP)", id: "PULIH (UP)" },
    // ── remote panel ──
    remote: { en: "Remote", id: "Remote" },
    close_all: { en: "Close all sessions", id: "Tutup semua sesi" },
    close_session: { en: "Close session", id: "Tutup sesi" },
    fullscreen: { en: "Fullscreen", id: "Layar penuh" },
    minimize: { en: "Restore size", id: "Kecilkan" },
    connecting_ssh: { en: "Connecting SSH…", id: "Menyambung SSH…" },
    preparing_vnc: { en: "Preparing VNC (running command via SSH)…", id: "Menyiapkan VNC (menjalankan perintah via SSH)…" },
    vnc_pw: { en: "VNC password for", id: "Password VNC untuk" },
    remote_denied: { en: "You're not allowed to remote this device.", id: "Kamu tak diizinkan me-remote device ini." },
    // ── kawasan / district ──
    factory: { en: "Factory", id: "Factory" },
    all_factories: { en: "All", id: "Semua" },
    floor: { en: "Floor", id: "Lantai" },
    all_floors: { en: "All", id: "Semua" },
    hint_focus: { en: "Press <kbd>Esc</kbd> or pick <b>All</b> to zoom out", id: "Tekan <kbd>Esc</kbd> atau pilih <b>Semua</b> untuk keluar fokus" },
  };

  var LANG = localStorage.getItem("pulse-lang") || "en";
  window.PULSE_LANG = LANG;
  function tr(key) { var e = D[key]; return e ? (e[LANG] || e.en) : null; }
  window.t = function (key, fb) { var v = tr(key); return v != null ? v : (fb !== undefined ? fb : key); };
  window.setLang = function (l) { if (l !== LANG) { localStorage.setItem("pulse-lang", l); location.reload(); } };

  window.applyI18n = function (root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach(function (el) { var v = tr(el.getAttribute("data-i18n")); if (v != null) el.textContent = v; });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) { var v = tr(el.getAttribute("data-i18n-html")); if (v != null) el.innerHTML = v; });
    root.querySelectorAll("[data-i18n-ph]").forEach(function (el) { var v = tr(el.getAttribute("data-i18n-ph")); if (v != null) el.setAttribute("placeholder", v); });
    root.querySelectorAll("[data-i18n-title]").forEach(function (el) { var v = tr(el.getAttribute("data-i18n-title")); if (v != null) el.setAttribute("title", v); });
  };

  window.applyBrand = function () {                       // nama tampilan (window.BRAND dari /brand.js); default → biarkan
    var b = window.BRAND;
    if (!b || b === "Twinscape") return;
    document.querySelectorAll("[data-brand]").forEach(function (el) { el.textContent = b; });
    if (document.title) document.title = document.title.replace(/Twinscape/g, b);
  };

  function onReady() { window.applyI18n(); window.applyBrand(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();
})();
