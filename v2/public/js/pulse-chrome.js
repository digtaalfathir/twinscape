/* =====================================================================
   Stechoq Pulse — CHROME bersama (dipakai index.html [3D] & floormap.html [2D])
   Tanggung jawab: tema gelap/terang, toggle 2D/3D, deep-link ?loc=&view=,
   dan pemilih lokasi (dropdown ala Cisco) dari /api/locations.
   Data scene/summary tetap diurus scene-view.js / floormap.js masing-masing.
   ===================================================================== */
(function () {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const CURRENT_VIEW = document.body.dataset.view === "2d" ? "2d" : "3d";
  const locParam = params.get("loc");

  const floorParam = params.get("floor");
  function buildURL(loc, view, floor) {
    const page = view === "2d" ? "/floormap.html" : "/";
    const qs = new URLSearchParams();
    if (loc) qs.set("loc", loc);
    if (floor) qs.set("floor", floor);
    qs.set("view", view);
    return `${page}?${qs.toString()}`;
  }
  const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; };

  // ---- deep-link: hormati ?view= kalau beda dgn halaman ini (mis. /?view=2d → pindah ke 2D) ----
  const wantView = params.get("view");
  if (wantView === "2d" && CURRENT_VIEW === "3d") { location.replace(buildURL(locParam, "2d", floorParam)); return; }
  if (wantView === "3d" && CURRENT_VIEW === "2d") { location.replace(buildURL(locParam, "3d", floorParam)); return; }

  // ---- tema ----
  const themeBtn = document.getElementById("themeToggle");
  function applyTheme(t) {
    html.setAttribute("data-theme", t);
    localStorage.setItem("pulse-theme", t);
    if (themeBtn) themeBtn.textContent = t === "light" ? "☀️" : "🌙";
    window.dispatchEvent(new CustomEvent("pulse-theme", { detail: t }));   // scene-view.js dengarkan (kanvas 3D)
  }
  if (themeBtn) {
    themeBtn.onclick = () => applyTheme(html.getAttribute("data-theme") === "light" ? "dark" : "light");
    themeBtn.textContent = html.getAttribute("data-theme") === "light" ? "☀️" : "🌙";
  }

  // ---- toggle 2D / 3D (pindah viewer, bawa lokasi + view) ----
  let activeLocId = locParam, activeFloorId = floorParam;   // di-update setelah fetch
  const t3d = document.getElementById("t3d"), t2d = document.getElementById("t2d");
  if (t3d) t3d.onclick = () => { if (CURRENT_VIEW !== "3d") location.href = buildURL(activeLocId, "3d", activeFloorId); };
  if (t2d) t2d.onclick = () => { if (CURRENT_VIEW !== "2d") location.href = buildURL(activeLocId, "2d", activeFloorId); };

  // ---- pemilih lokasi (D2) + pemilih lantai (E5) ----
  const nav = document.getElementById("locNav");
  fetch("/api/locations", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      const list = data.locations || [];
      const active = list.find((l) => l.id === locParam) || list[0] || null;
      activeLocId = active ? active.id : locParam;
      const floors = (active && active.floors) || [];
      const activeFloor = floors.find((f) => f.id === floorParam) || floors[0] || null;
      activeFloorId = activeFloor ? activeFloor.id : null;
      if (!nav) return;
      // dropdown lokasi — hanya jika >1 lokasi (1 lokasi → nama sudah di panel kiri)
      if (list.length > 1) {
        const sel = document.createElement("select");
        sel.className = "loc-select"; sel.setAttribute("aria-label", "Pilih lokasi");
        list.forEach((l) => { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; if (active && l.id === active.id) o.selected = true; sel.appendChild(o); });
        sel.onchange = () => (location.href = buildURL(sel.value, CURRENT_VIEW));   // pindah lokasi → lantai reset ke default
        nav.appendChild(sel);
        // tandai lokasi yang server WS-nya down (poll /api/health tiap 20s)
        const applyHealth = (statuses) => {
          Array.from(sel.options).forEach((o) => {
            const l = list.find((x) => x.id === o.value); const nm = l ? l.name : o.value;
            o.textContent = statuses[o.value] === "down" ? `⚠ ${nm} — offline` : nm;
          });
        };
        const pollHealth = () => fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h) => applyHealth(h.statuses || {})).catch(() => {});
        pollHealth();
        setInterval(pollHealth, 20000);
      }
      // dropdown lantai — hanya jika lokasi aktif punya >1 lantai
      if (floors.length > 1) {
        const fsel = document.createElement("select");
        fsel.className = "loc-select floor-select"; fsel.setAttribute("aria-label", "Pilih lantai");
        floors.forEach((f) => { const o = document.createElement("option"); o.value = f.id; o.textContent = f.name; if (activeFloor && f.id === activeFloor.id) o.selected = true; fsel.appendChild(o); });
        fsel.onchange = () => (location.href = buildURL(activeLocId, CURRENT_VIEW, fsel.value));   // pindah lantai, lokasi+view tetap
        nav.appendChild(fsel);
      }
    })
    .catch(() => {});

  // ---- E3: cari device (nama/IP) → sorot & fly-to. Data & fly-to dari viewer via hook. ----
  const box = document.getElementById("searchBox");
  const results = document.getElementById("searchResults");
  const dotColor = (s) => (s === "UP" ? "var(--up)" : s === "DOWN" ? "var(--down)" : "var(--unknown)");
  let items = [], active = -1;
  function render(q) {
    if (!results) return;
    const ql = q.trim().toLowerCase();
    const all = window.pulseGetTargets ? window.pulseGetTargets() : [];
    items = ql ? all.filter((t) => (t.name || "").toLowerCase().includes(ql) || (t.ip || "").toLowerCase().includes(ql)).slice(0, 10) : [];
    active = -1;
    if (!ql) { results.classList.remove("show"); results.innerHTML = ""; return; }
    results.innerHTML = items.length
      ? items.map((t, i) => `<div class="sr-item" data-i="${i}"><span class="sr-dot" style="background:${dotColor(t.status)}"></span><span class="sr-name">${t.name || t.ip}</span><span class="sr-ip">${t.ip}</span></div>`).join("")
      : `<div class="sr-empty">Tak ada yang cocok.</div>`;
    results.classList.add("show");
    results.querySelectorAll(".sr-item").forEach((el) => (el.onclick = () => choose(+el.dataset.i)));
  }
  function mark() { results.querySelectorAll(".sr-item").forEach((el, i) => el.classList.toggle("active", i === active)); }
  function choose(i) {
    const t = items[i]; if (!t) return;
    if (window.pulseFocus) window.pulseFocus(t.ip);
    results.classList.remove("show"); if (box) box.blur();
  }
  if (box) {
    box.addEventListener("input", () => render(box.value));
    box.addEventListener("focus", () => box.value && render(box.value));
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { box.value = ""; results.classList.remove("show"); box.blur(); return; }
      if (!items.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active >= 0 ? active : 0); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".tb-search")) results.classList.remove("show"); });
  }

  // ---- E4: filter status (Semua / Up / Down) → viewer redupkan yg tak cocok ----
  const filterBox = document.getElementById("statusFilter");
  if (filterBox) {
    filterBox.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        filterBox.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        if (window.pulseFilter) window.pulseFilter(btn.dataset.f);
      };
    });
  }

  // ---- E8: alert (toast + suara) saat device turun/pulih. Viewer memanggil window.pulseAlert(). ----
  const toastWrap = document.createElement("div");
  toastWrap.className = "toast-wrap";
  document.body.appendChild(toastWrap);

  let audioCtx = null, soundOn = localStorage.getItem("pulse-sound") === "1";
  const soundBtn = document.getElementById("soundToggle");
  function setSound(on) {
    soundOn = on; localStorage.setItem("pulse-sound", on ? "1" : "0");
    if (soundBtn) { soundBtn.textContent = on ? "🔔" : "🔕"; soundBtn.title = on ? "Suara alert: ON" : "Suara alert: OFF"; }
    if (on && !audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }   // dibuka saat gesture klik → tak diblokir
  }
  if (soundBtn) { soundBtn.onclick = () => setSound(!soundOn); setSound(soundOn); }
  function beep() {
    if (!soundOn || !audioCtx) return;
    try {
      if (audioCtx.state === "suspended") audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
      o.connect(g); g.connect(audioCtx.destination); o.type = "sine"; o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.start(t); o.stop(t + 0.3);
    } catch (e) {}
  }
  window.pulseAlert = (name, ip, kind) => {
    const down = kind === "down";
    const el = document.createElement("div");
    el.className = "toast " + (down ? "down" : "up");
    el.innerHTML = `<span class="toast-ico">${down ? "▲" : "✓"}</span>
      <div class="toast-body"><div class="toast-title">${esc(name || ip)}</div>
        <div class="toast-sub">${esc(ip)} · ${down ? "DEVICE DOWN" : "PULIH (UP)"}</div></div>`;
    el.onclick = () => { if (window.pulseFocus) window.pulseFocus(ip); };
    toastWrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    if (down) beep();
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 320); }, 6000);
  };

  // ---- F3: Share — salin deep-link read-only (lokasi + lantai + view saat ini) ----
  function chromeToast(msg) {
    const el = document.createElement("div");
    el.className = "toast info";
    el.innerHTML = `<span class="toast-ico">🔗</span><div class="toast-body"><div class="toast-title">${esc(msg)}</div></div>`;
    toastWrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 320); }, 3500);
  }
  const shareBtn = document.getElementById("shareBtn");
  if (shareBtn) shareBtn.onclick = async () => {
    const url = location.origin + buildURL(activeLocId, CURRENT_VIEW, activeFloorId);
    try { await navigator.clipboard.writeText(url); chromeToast("Link monitor disalin ✓"); }
    catch (e) { chromeToast(url); }
  };

  // ---- #3: Keluar (hapus sesi) ----
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.onclick = async () => {
    try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
    location.href = "/login";
  };
})();
