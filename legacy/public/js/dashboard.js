/**
 * Dashboard Frontend — JavaScript
 * WebSocket-based real-time monitoring client
 */

// ===== WebSocket URL — auto-detect protocol and host for Nginx compatibility =====
const protocol = location.protocol === "https:" ? "wss" : "ws";
const WS_URL = `${protocol}://${location.host}/ws`;

let ws, devicesData = [], downtimeTimers = {};
let editingDevice = null;
let wsRetry = 2000;   // #2 reconnect backoff+jitter

// ===== Filter State =====
let filterStatus = 'ALL';
let filterSeverity = 'ALL';
let filterSearch = '';
let filterSortBy = 'name';
let filterFactory = 'ALL';

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
// "factory" = field location tiap device (mis. "Cibitung - F4")
const factoryOf = (d) => (d.location && d.location.trim()) ? d.location.trim() : 'Tanpa Lokasi';

function getFilteredDevices() {
  let list = devicesData.slice();
  if (filterSearch) {
    const q = filterSearch.toLowerCase();
    list = list.filter(d => d.name.toLowerCase().includes(q) || d.ip.includes(q));
  }
  if (filterStatus !== 'ALL') {
    list = list.filter(d => d.status === filterStatus);
  }
  if (filterSeverity !== 'ALL') {
    list = list.filter(d => d.severity === filterSeverity);
  }
  if (filterFactory !== 'ALL') {
    list = list.filter(d => factoryOf(d) === filterFactory);
  }
  list.sort((a, b) => {
    switch (filterSortBy) {
      case 'status': return (a.status === 'DOWN' ? 0 : 1) - (b.status === 'DOWN' ? 0 : 1);
      case 'severity': return (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);
      case 'latency': return ((a.latency ?? 9999) - (b.latency ?? 9999));
      case 'availability': return (a.uptimeToday ?? 100) - (b.uptimeToday ?? 100);
      default: return a.name.localeCompare(b.name);
    }
  });
  return list;
}

// ===== WebSocket =====
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { wsRetry = 2000; setConn(true); };
  ws.onclose = () => { setConn(false); setTimeout(connect, wsRetry + Math.random() * 1000); wsRetry = Math.min(30000, wsRetry * 1.7); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'cmd_result') {
      showToast(msg.message, msg.ok);
      if (msg.ok) closeModal();
      return;
    }
    if (msg.devices) { devicesData = msg.devices; render(); }
    if (msg.timestamp) document.getElementById('lastUpdate').textContent = `Last update: ${msg.timestamp}`;
  };
}

function sendCmd(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', ...payload }));
  } else {
    showToast('WebSocket tidak terhubung', false);
  }
}

function setConn(ok) {
  document.getElementById('connDot').classList.toggle('connected', ok);
  document.getElementById('connLabel').textContent = ok ? 'Connected' : 'Disconnected';
}

// ===== Render =====
function render() {
  const grid = document.getElementById('deviceGrid');
  const total = devicesData.length;
  const upCount = devicesData.filter(d => d.status === 'UP').length;
  const downCount = devicesData.filter(d => d.status === 'DOWN').length;
  const healthScore = total > 0 ? ((upCount / total) * 100).toFixed(1) : 100;

  document.getElementById('totalDevices').textContent = total;
  document.getElementById('upCount').textContent = upCount;
  document.getElementById('downCount').textContent = downCount;

  // Health Score
  const scoreEl = document.getElementById('healthScore');
  if (scoreEl) {
    scoreEl.textContent = `${healthScore}%`;
    scoreEl.style.color = healthScore >= 95 ? 'var(--up)' : healthScore >= 80 ? 'var(--high)' : 'var(--down)';
  }

  updateFactoryOptions();
  const filtered = getFilteredDevices();
  const countEl = document.getElementById('filterCount');
  if (filtered.length < total) {
    countEl.textContent = `Showing ${filtered.length} of ${total}`;
  } else {
    countEl.textContent = '';
  }

  // kelompokkan per factory (location); tiap grup punya header + grid kartu sendiri
  const groups = {};
  filtered.forEach(d => { const f = factoryOf(d); (groups[f] = groups[f] || []).push(d); });
  const order = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  grid.innerHTML = order.length ? order.map(f => {
    const list = groups[f];
    const up = list.filter(d => d.status === 'UP').length;
    const down = list.filter(d => d.status === 'DOWN').length;
    return `
    <section class="factory-group">
      <div class="factory-head">
        <span class="fh-name">${esc(f)}</span>
        <span class="fh-count">${list.length} device</span>
        <span class="fh-stat"><span class="fh-dot" style="background:var(--up)"></span>${up}</span>
        <span class="fh-stat"><span class="fh-dot" style="background:var(--down)"></span>${down}</span>
        <span class="fh-line"></span>
      </div>
      <div class="grid">${list.map(cardHTML).join('')}</div>
    </section>`;
  }).join('') : `<div class="empty-msg">Tak ada device yang cocok filter/pencarian.</div>`;

  startDowntimeCounters();
}

function cardHTML(d) {
  const isDown = d.status === 'DOWN';
  const latStr = d.latency !== null && d.latency !== undefined ? `${d.latency} ms` : '—';
  const avgStr = d.avgLatency !== null && d.avgLatency !== undefined ? `${d.avgLatency} ms` : '—';
  const peakStr = d.maxLatency !== null && d.maxLatency !== undefined ? `${d.maxLatency} ms` : '—';
  const avail = d.uptimeToday ?? 100;
  const downSec = d.downtimeTodaySec ?? 0;
  const hist = (d.history || []).slice(-5).reverse();
  const eName = escAttr(d.name);

  return `
    <div class="card status-${d.status.toLowerCase()}" data-name="${eName}" onclick="openDetail('${eName}')">
      <div class="card-top">
        <div><div class="dev-name">${esc(d.name)}</div><div class="dev-ip">${d.ip}</div></div>
        <span class="badge sev-${d.severity}">${d.severity}</span>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Status</div><div class="stat-value ${isDown ? 'down' : 'up'}">${d.status}</div></div>
        <div class="stat"><div class="stat-label">Latency</div><div class="stat-value latency">${latStr}</div></div>
        <div class="stat"><div class="stat-label">Avail</div><div class="stat-value" style="color:${avail >= 99 ? 'var(--up)' : avail >= 95 ? 'var(--high)' : 'var(--down)'}">${avail}%</div></div>
      </div>
      <div class="lat-stats">
        <span>Avg: <em class="val">${avgStr}</em></span>
        <span>Peak: <em class="val peak">${peakStr}</em></span>
      </div>
      <div class="avail-bar"><div class="avail-fill" style="width:${avail}%"></div></div>
      <div class="avail-text"><span>Uptime today</span><span>Downtime: ${fmtSec(downSec)}</span></div>
      <div class="downtime-live" id="dt-${cssName(d.name)}" style="display:${isDown && d.downSince ? 'flex' : 'none'}" data-since="${d.downSince || ''}">
        <div class="pulse"></div>
        <span>Down for <strong class="dt-counter">00h 00m 00s</strong></span>
      </div>
      ${hist.length ? `
      <div class="history-section">
        <div class="history-title">Recent Events</div>
        <div class="timeline">${hist.map(h => `
          <div class="tl-item">
            <div class="tl-dot ${h.status.toLowerCase()}"></div>
            <span class="tl-time">${h.timestamp}</span>
            <span class="tl-status" style="color:${h.status === 'UP' ? 'var(--up)' : 'var(--down)'}">${h.status}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}
      <div class="card-actions">
        <button class="btn-edit" onclick="event.stopPropagation();openEdit('${eName}')">Edit</button>
        <button class="btn-del" onclick="event.stopPropagation();confirmDelete('${eName}')">Delete</button>
      </div>
    </div>`;
}

// isi dropdown factory dari daftar location device (pertahankan pilihan)
function updateFactoryOptions() {
  const sel = document.getElementById('filterFactory');
  if (!sel) return;
  const factories = [...new Set(devicesData.map(factoryOf))].sort((a, b) => a.localeCompare(b));
  const sig = factories.join('|');
  if (sel._sig !== sig) {
    sel.innerHTML = '<option value="ALL">Semua Factory</option>' +
      factories.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
    sel._sig = sig;
  }
  if (filterFactory !== 'ALL' && !factories.includes(filterFactory)) filterFactory = 'ALL';
  sel.value = filterFactory;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function cssName(n) { return n.replace(/[^a-zA-Z0-9]/g, '_'); }
function fmtSec(s) { if (!s) return '0s'; const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`; }

function startDowntimeCounters() {
  Object.values(downtimeTimers).forEach(clearInterval);
  downtimeTimers = {};
  document.querySelectorAll('.downtime-live[data-since]').forEach(el => {
    const since = el.dataset.since;
    if (!since || el.style.display === 'none') return;
    const id = el.id;
    const counter = el.querySelector('.dt-counter');
    function tick() {
      const s = since.replace(' ', 'T');
      const diff = Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 1000));
      const hh = String(Math.floor(diff / 3600)).padStart(2, '0');
      const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      const ss = String(diff % 60).padStart(2, '0');
      counter.textContent = `${hh}h ${mm}m ${ss}s`;
    }
    tick();
    downtimeTimers[id] = setInterval(tick, 1000);
  });
}

// ===== Modal =====
const overlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const inputName = document.getElementById('inputName');
const inputIp = document.getElementById('inputIp');
const inputSev = document.getElementById('inputSev');
const btnSubmit = document.getElementById('btnSubmit');

document.getElementById('fabAdd').onclick = () => openAdd();
document.getElementById('btnCancel').onclick = () => closeModal();
overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

btnSubmit.onclick = () => {
  const name = inputName.value.trim();
  const ip = inputIp.value.trim();
  const severity = inputSev.value;
  if (!name || !ip) return showToast('Name dan IP wajib diisi.', false);
  if (editingDevice) {
    sendCmd({ action: 'edit_device', originalName: editingDevice, name, ip, severity });
  } else {
    sendCmd({ action: 'add_device', name, ip, severity });
  }
};

function openAdd() {
  editingDevice = null;
  modalTitle.textContent = 'Add Device';
  btnSubmit.textContent = 'Add Device';
  inputName.value = ''; inputIp.value = ''; inputSev.value = 'MEDIUM';
  overlay.classList.add('open');
  inputName.focus();
}

function openEdit(name) {
  const realName = name.replace(/\\'/g, "'");
  const d = devicesData.find(x => x.name === realName);
  if (!d) return;
  editingDevice = realName;
  modalTitle.textContent = 'Edit Device';
  btnSubmit.textContent = 'Save Changes';
  inputName.value = d.name;
  inputIp.value = d.ip;
  inputSev.value = d.severity;
  overlay.classList.add('open');
  inputName.focus();
}

function closeModal() {
  overlay.classList.remove('open');
  editingDevice = null;
}

function confirmDelete(name) {
  const realName = name.replace(/\\'/g, "'");
  if (confirm(`Hapus device "${realName}"?`)) {
    sendCmd({ action: 'delete_device', name: realName });
  }
}

// ===== Toast =====
let toastTimer;
function showToast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (ok ? 'ok' : 'err') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ===== Filter Controls =====
document.getElementById('filterSearch').addEventListener('input', (e) => {
  filterSearch = e.target.value.trim();
  render();
});

document.querySelectorAll('#statusPills .filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    filterStatus = btn.dataset.status;
    document.querySelectorAll('#statusPills .filter-pill').forEach(b => {
      b.className = 'filter-pill';
    });
    if (filterStatus === 'ALL') btn.classList.add('active');
    else if (filterStatus === 'UP') btn.classList.add('active-up');
    else btn.classList.add('active-down');
    render();
  });
});

document.getElementById('filterSeverity').addEventListener('change', (e) => {
  filterSeverity = e.target.value;
  render();
});

document.getElementById('filterSort').addEventListener('change', (e) => {
  filterSortBy = e.target.value;
  render();
});

document.getElementById('filterFactory').addEventListener('change', (e) => {
  filterFactory = e.target.value;
  render();
});

// ===== Keyboard shortcut =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeDetail(); }
});

// ===== Detail Modal =====
const detailOverlay = document.getElementById('detailOverlay');
const detailModal = document.getElementById('detailModal');
detailOverlay.onclick = (e) => { if (e.target === detailOverlay) closeDetail(); };

function openDetail(name) {
  const realName = name.replace(/\\'/g, "'");
  const d = devicesData.find(x => x.name === realName);
  if (!d) return;
  const isDown = d.status === 'DOWN';
  const latStr = d.latency !== null && d.latency !== undefined ? `${d.latency} ms` : '—';
  const avgStr = d.avgLatency !== null && d.avgLatency !== undefined ? `${d.avgLatency} ms` : '—';
  const peakStr = d.maxLatency !== null && d.maxLatency !== undefined ? `${d.maxLatency} ms` : '—';
  const avail = d.uptimeToday ?? 100;

  detailModal.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${esc(d.name)}</h2>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px;font-family:monospace">${d.ip} · <span class="badge sev-${d.severity}" style="font-size:9px;vertical-align:middle">${d.severity}</span></div>
      </div>
      <button class="detail-close" onclick="closeDetail()">✕</button>
    </div>
    <div class="detail-section-title">Network Quality</div>
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Status</div><div class="detail-val ${isDown ? 'down' : 'up'}">${d.status}</div></div>
      <div class="detail-item"><div class="detail-label">Availability</div><div class="detail-val" style="color:${avail >= 99 ? 'var(--up)' : 'var(--down)'}">${avail}%</div></div>
      <div class="detail-item"><div class="detail-label">Current Latency</div><div class="detail-val" style="color:var(--accent)">${latStr}</div></div>
      <div class="detail-item"><div class="detail-label">Average Latency</div><div class="detail-val" style="color:var(--text-bright)">${avgStr}</div></div>
      <div class="detail-item"><div class="detail-label">Peak Latency</div><div class="detail-val" style="color:#f59e0b">${peakStr}</div></div>
      <div class="detail-item"><div class="detail-label">Downtime Today</div><div class="detail-val">${fmtSec(d.downtimeTodaySec ?? 0)}</div></div>
    </div>
    <div class="detail-section-title">Device Information</div>
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Owner</div><input class="detail-meta-input" id="detOwner" value="${escHtml(d.owner || '')}" placeholder="e.g. Production"></div>
      <div class="detail-item"><div class="detail-label">Location</div><input class="detail-meta-input" id="detLocation" value="${escHtml(d.location || '')}" placeholder="e.g. Factory 4"></div>
      <div class="detail-item"><div class="detail-label">Vendor</div><input class="detail-meta-input" id="detVendor" value="${escHtml(d.vendor || '')}" placeholder="e.g. ABC Automation"></div>
      <div class="detail-item full"><div class="detail-label">Notes</div><textarea class="detail-notes" id="detNotes" placeholder="Catatan tentang device ini...">${escHtml(d.notes || '')}</textarea></div>
    </div>
    <button class="detail-save" onclick="saveNotes('${escAttr(d.name)}')">Save Notes</button>
  `;
  detailOverlay.classList.add('open');
}

function closeDetail() {
  detailOverlay.classList.remove('open');
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function saveNotes(name) {
  const realName = name.replace(/\\'/g, "'");
  sendCmd({
    action: 'update_notes',
    name: realName,
    owner: document.getElementById('detOwner').value.trim(),
    location: document.getElementById('detLocation').value.trim(),
    vendor: document.getElementById('detVendor').value.trim(),
    notes: document.getElementById('detNotes').value.trim(),
  });
}

// ===== Theme toggle (default light) =====
(function () {
  const html = document.documentElement, btn = document.getElementById('themeToggle');
  function apply(t) { html.setAttribute('data-theme', t); localStorage.setItem('dash-theme', t); if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙'; }
  if (btn) {
    btn.onclick = () => apply(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    btn.textContent = html.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  }
})();

// ===== Logout =====
(function () {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.onclick = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    location.href = '/login';
  };
})();

// ===== Start =====
connect();
