/* Twinscape — panel remote multi-sesi (Fase 3): SSH (xterm) + VNC (noVNC), banyak tab.
   Server bridge: WS /ssh?device= (shell) · WS /vnc?device= (pipa RFB mentah).
   Target/kredensial SSH resolve server-side (remotes.json). VNC: noVNC bicara RFB end-to-end;
   kalau device minta password, noVNC prompt (user ketik, tak disimpan).
   noVNC di-import DINAMIS di openVNC → kegagalan noVNC tak mematikan SSH/tombol. */

let panel, tabsEl, bodyEl;
const sessions = [];               // {id,type,key,label,tab,wrap, (ssh: term,fit,ws,dataDisp) (vnc: rfb)}
let active = null, seq = 0;

fetch("/api/remote").then((r) => r.json()).then((j) => {
  window.__remote = j;
  document.body.classList.toggle("ssh-on", !!(j && j.enabled));
}).catch(() => { window.__remote = { enabled: false }; });

window.remoteCaps = function (ip) {
  const r = window.__remote;
  if (!r || !r.enabled) return { ssh: false, vnc: false };
  if (r.mode === "single") return { ssh: true, vnc: false };
  const d = r.devices && r.devices[ip];
  return { ssh: !!(d && d.ssh), vnc: !!(d && d.vnc) };
};

function build() {
  panel = document.createElement("div");
  panel.className = "ssh-panel";
  panel.innerHTML =
    '<div class="ssh-head" id="sshHead"><span class="ssh-dot"></span><span class="ssh-title">Remote</span>' +
    '<div class="ssh-tabs" id="sshTabs"></div>' +
    '<button class="ssh-btn" id="sshFull" title="Layar penuh">⛶</button>' +
    '<button class="ssh-btn" id="sshCloseAll" title="Tutup semua sesi">✕</button></div>' +
    '<div class="ssh-body" id="sshBody"></div>';
  document.body.appendChild(panel);
  tabsEl = panel.querySelector("#sshTabs");
  bodyEl = panel.querySelector("#sshBody");
  panel.querySelector("#sshCloseAll").onclick = () => sessions.slice().forEach(closeSession);
  panel.querySelector("#sshFull").onclick = () => setFull(!panel.classList.contains("fullscreen"));
  enableDrag(panel.querySelector("#sshHead"));
  window.addEventListener("resize", () => { if (active && active.type === "ssh") sendResize(active); });
}

function setFull(on) {
  panel.classList.toggle("fullscreen", on);
  panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = "";   // biarkan CSS yang atur ukuran
  const b = panel.querySelector("#sshFull"); if (b) { b.textContent = on ? "❐" : "⛶"; b.title = on ? "Kecilkan" : "Layar penuh"; }
  requestAnimationFrame(() => { if (active && active.type === "ssh") sendResize(active); });   // noVNC auto-refit (scaleViewport)
}

function enableDrag(head) {                                  // geser panel via header (kecuali saat fullscreen / klik tombol-tab)
  let d = null;
  head.addEventListener("mousedown", (e) => {
    if (panel.classList.contains("fullscreen") || e.target.closest(".ssh-btn, .ssh-tab, .ssh-tabs")) return;
    const r = panel.getBoundingClientRect();
    d = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    panel.style.left = r.left + "px"; panel.style.top = r.top + "px"; panel.style.right = "auto"; panel.style.bottom = "auto";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!d) return;
    panel.style.left = Math.max(0, Math.min(window.innerWidth - 90, e.clientX - d.dx)) + "px";
    panel.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy)) + "px";
  });
  window.addEventListener("mouseup", () => { d = null; });
}

function newSession(type, ip, label) {
  if (!panel) build();
  panel.classList.add("open");
  const s = { id: ++seq, type: type, key: ip, label: label || ip };
  s.tab = document.createElement("div");
  s.tab.className = "ssh-tab";
  s.tab.innerHTML = '<span class="ssh-tab-kind"></span><span class="ssh-tab-name"></span><span class="ssh-tab-x" title="Tutup sesi">✕</span>';
  s.tab.querySelector(".ssh-tab-kind").textContent = type === "vnc" ? "🖥" : "›_";
  const nm = s.tab.querySelector(".ssh-tab-name");
  nm.textContent = s.label; nm.title = s.label + " (" + ip + ")";
  s.tab.onclick = (e) => { if (e.target.classList.contains("ssh-tab-x")) closeSession(s); else activate(s); };
  tabsEl.appendChild(s.tab);
  s.wrap = document.createElement("div"); s.wrap.className = "ssh-wrap"; bodyEl.appendChild(s.wrap);
  sessions.push(s);
  return s;
}

// ---- SSH ----
window.openSSH = function (ip, label) {
  if (!window.remoteCaps(ip).ssh) return;
  const s = newSession("ssh", ip, label);
  s.term = new Terminal({
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13, cursorBlink: true, scrollback: 3000,
    theme: { background: "#0a0d16", foreground: "#e6ecf6", cursor: "#3b82f6", selectionBackground: "#27406a" },
  });
  s.fit = new FitAddon.FitAddon(); s.term.loadAddon(s.fit); s.term.open(s.wrap);
  setDot(s, "wait");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  s.ws = new WebSocket(proto + "://" + location.host + "/ssh?device=" + encodeURIComponent(ip));
  s.ws.binaryType = "arraybuffer";
  s.ws.onopen = () => sendResize(s);
  s.ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      try { const m = JSON.parse(e.data);
        if (m.type === "status") setDot(s, /Terhubung/.test(m.msg) ? "ok" : "wait");
        else if (m.type === "error") { setDot(s, "err"); s.term.write("\r\n\x1b[31m" + m.msg + "\x1b[0m\r\n"); }
      } catch (x) {}
      return;
    }
    s.term.write(new Uint8Array(e.data));
  };
  s.ws.onclose = () => setDot(s, "err");
  s.ws.onerror = () => setDot(s, "err");
  s.dataDisp = s.term.onData((d) => { if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ t: "d", d: d })); });
  activate(s);
};

// ---- VNC ----
window.openVNC = function (ip, label) {
  if (!window.remoteCaps(ip).vnc) return;
  const s = newSession("vnc", ip, label);
  setDot(s, "wait");
  activate(s);
  setFull(true);                                            // VNC default layar penuh
  const proto = location.protocol === "https:" ? "wss" : "ws";
  import("/vendor/novnc/core/rfb.js").then(({ default: RFB }) => {
    if (!s.wrap.isConnected) return;                                    // sesi keburu ditutup
    s.rfb = new RFB(s.wrap, proto + "://" + location.host + "/vnc?device=" + encodeURIComponent(ip));
    s.rfb.scaleViewport = true;
    s.rfb.background = "#0a0d16";
    s.rfb.addEventListener("connect", () => setDot(s, "ok"));
    s.rfb.addEventListener("disconnect", () => setDot(s, "err"));
    s.rfb.addEventListener("securityfailure", () => setDot(s, "err"));
    s.rfb.addEventListener("credentialsrequired", () => {
      const pw = window.prompt("Password VNC untuk " + s.label + ":");   // user ketik; tak disimpan
      try { s.rfb.sendCredentials({ password: pw || "" }); } catch (e) {}
    });
  }).catch((e) => { setDot(s, "err"); try { s.term = null; } catch (x) {} });
};

function activate(s) {
  active = s;
  sessions.forEach((x) => { x.wrap.style.display = x === s ? "block" : "none"; x.tab.classList.toggle("active", x === s); });
  requestAnimationFrame(() => {
    if (s.type === "ssh") { sendResize(s); try { s.term.focus(); } catch (e) {} }
    else if (s.rfb) { try { s.rfb.focus(); } catch (e) {} }
  });
}
function sendResize(s) {
  if (!s || s.type !== "ssh" || s.wrap.style.display === "none") return;
  try { s.fit.fit(); } catch (e) {}
  if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ t: "r", cols: s.term.cols, rows: s.term.rows }));
}
function setDot(s, cls) { s.tab.classList.remove("wait", "ok", "err"); s.tab.classList.add(cls); }

function closeSession(s) {
  if (s.type === "ssh") {
    try { s.dataDisp && s.dataDisp.dispose(); } catch (e) {}
    try { s.ws && s.ws.close(); } catch (e) {}
    try { s.term && s.term.dispose(); } catch (e) {}
  } else if (s.rfb) { try { s.rfb.disconnect(); } catch (e) {} }
  s.tab.remove(); s.wrap.remove();
  const i = sessions.indexOf(s); if (i >= 0) sessions.splice(i, 1);
  if (active === s) active = null;
  if (!sessions.length) panel.classList.remove("open");
  else if (!active) activate(sessions[sessions.length - 1]);
}
