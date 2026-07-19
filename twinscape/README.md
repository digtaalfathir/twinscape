# Twinscape — Viewer (2D/3D + Remote)

Viewer digital-twin (2D & 3D) untuk **memonitor sekaligus mengoperasikan** hardware, terinspirasi Cisco Spaces.
Data monitoring: v2 TIDAK meng-ping sendiri — ia **konsumen** yang menerima feed `{ devices, timestamp }` dari
**WS producer (Twinscape Agent)** yang sudah running, lalu memetakan status ke marker **berdasarkan IP**.
Untuk kontrol: klik device → **SSH/VNC in-browser** (dijembatani server, RBAC + audit).

- Buka web → **langsung masuk monitoring 3D** (tanpa memilih).
- Toggle **3D ↔ 2D**, bahasa **EN/ID**, tema **gelap/terang**, multi-lokasi & multi-lantai, cari device, filter, alert.
- **Remote** (opsional, `REMOTE_ENABLE=1`): SSH terminal + VNC desktop per device, multi-tab, gerbang **role (RBAC)** + **audit log**. Lihat `../docs/ROADMAP-remote.md`.
- Sumber data = **Twinscape Agent** (`../legacy/agent.js`, PM2 `twinscape-agent`) — ping + WS producer. Builder = alat internal (`../builder/`).

---

## 1. Struktur folder

```
twinscape/
  server.js              server statik + API + proxy WS  (port default 10102)
  ecosystem.config.js    konfigurasi PM2 (viewer; agent terpisah di ../legacy/agent.js)
  locations.json         ← DAFTAR TEMPAT (kamu edit ini untuk nambah lokasi)
  deploy/
    nginx-pulse.conf.example   contoh reverse-proxy domain + WebSocket
  logs/                  log PM2 (dibuat saat deploy)
  public/
    index.html           viewer 3D (default)  + js/scene-view.js
    floormap.html        viewer 2D (SVG)       + js/floormap.js
    js/pulse-chrome.js   topbar bersama: tema, toggle, dropdown, cari, filter, alert, share
    css/pulse.css        tema (dark/light, aksen biru, responsif)
    scene.example.json · layout2d.example.json   contoh (dipakai bila file asli belum ada)
    models/              file .glb untuk scene 3D
    vendor/three/        Three.js lokal (offline, tanpa CDN)
```

## 2. Cara kerja data (penting)

```
[WS server tiap lokasi]  --(sudah running di tempat lain)-->  twinscape/server.js  --proxy /ws?loc=<id>-->  browser
        (ws://IP:PORT/ws)                                     (locations.json)                      (viewer)
```

- **URL WS upstream disimpan di server** (`locations.json`), **tidak** diekspos ke browser.
- Marker device diwarnai dengan mencocokkan **IP**: `pin.ip` (2D/3D) atau `model.deviceIp` (3D) **=** `device.ip` dari WS.
- Denah **3D** (`scene.json`) dan **2D** (`layout2d.json`) adalah **file terpisah** — dibuat di Builder.

---

## 3. Jalankan lokal (development)

```bash
npm install
npm start            # → http://localhost:10102  (langsung 3D)
```
Belum ada `scene.json`/`layout2d.json`? Viewer otomatis menampilkan **contoh** bawaan.

---

## 4. Deploy produksi dengan PM2

Prasyarat server: **Node.js ≥ 16**, **PM2** (`npm i -g pm2`), dan (untuk domain) **nginx**.

```bash
# 1. ambil kode + dependensi
git clone <repo> && cd twinscape
npm install --omit=dev          # cukup express + ws untuk v2

# 2. siapkan folder log + isi locations.json (lihat bagian 6)
mkdir -p twinscape/logs
nano twinscape/locations.json

# 2b. buat akun login (WAJIB — tanpa akun tak ada yang bisa masuk)
node twinscape/adduser.js <username>         # diminta password (lihat bagian "Login & akun")

# 3. jalankan viewer lewat PM2
pm2 start twinscape/ecosystem.config.js      # atau: npm run pulse:start (viewer saja)
pm2 save                              # simpan daftar proses
pm2 startup                           # ikuti perintah yang dicetak → auto-start saat reboot

# cek
pm2 status
pm2 logs twinscape                # atau: npm run pulse:logs
```

Proses bernama **`twinscape`**, listen di **127.0.0.1:10102** (lihat `ecosystem.config.js`).
Builder & v1 **tidak** disertakan di config ini.

**Perintah harian:**
```bash
npm run pulse:restart     # setelah edit locations.json / taruh scene baru
npm run pulse:stop
npm run pulse:logs
```

### Ubah port / binding
Edit `env` di `twinscape/ecosystem.config.js` lalu `pm2 restart twinscape --update-env`:
- `V2_PORT` — port internal (default 10102).
- `V2_HOST` — `127.0.0.1` (hanya via nginx, disarankan) atau hapus untuk akses langsung dari LAN.
- `MONITOR_WS` — sumber WS fallback bila `locations.json` kosong (opsional).
- `PULSE_SECRET` — kunci penanda-tangan sesi login. Opsional: kalau tak diisi, dibuat otomatis & disimpan di `twinscape/.pulse-secret`. Isi sendiri (string acak panjang) bila menjalankan >1 instance.

## 4b. Login & akun

Akses dibatasi **akun terdaftar**. Halaman/`API`/`WS` semuanya butuh sesi login (kecuali halaman login).

```bash
node twinscape/adduser.js madani            # tambah akun, diminta password (tersembunyi)
node twinscape/adduser.js madani rahasia123 # atau non-interaktif (password sbagai argumen)
```
- Akun disimpan di **`twinscape/users.json`** (password di-hash **scrypt**, bukan plaintext). File ini **tidak** di-commit (`.gitignore`).
- **Tambah/ubah** akun = jalankan `adduser` lagi (username sama = password di-update). **Hapus** akun = buka `twinscape/users.json`, hapus entri-nya.
- Setelah tambah/hapus akun, **tak perlu restart** — dibaca saat login.
- **Logout**: tombol ⎋ di kanan-atas topbar (atau hapus cookie). Sesi bertahan **7 hari**.
- Password lupa? Set ulang: `node twinscape/adduser.js <username>` (menimpa yang lama).

> Cookie sesi otomatis pakai flag **Secure** saat via HTTPS (butuh `X-Forwarded-Proto` dari nginx — sudah ada di contoh config).

---

## 5. Sambungkan ke domain (Cloudflare Tunnel)

Server ini di balik VPN/NAT (tanpa IP publik), jadi domain dipublikasikan lewat **Cloudflare Tunnel**
(koneksi keluar; HTTPS + WebSocket otomatis; tak perlu buka port). Panduan lengkap:
**[`../docs/DEPLOY-cloudflare.md`](../docs/DEPLOY-cloudflare.md)**.

Ringkas: install `cloudflared` → tes cepat `cloudflared tunnel --url http://localhost:10102`
(dapat URL publik instan) → untuk domain tetap, buat tunnel di dashboard Cloudflare +
Public Hostname `iot-node.sugity.stechoq-j.com → localhost:10102`.

---

## 6. `locations.json` — daftar tempat

Ini **satu-satunya file** yang perlu kamu ubah untuk mengelola tempat. Skema:

```json
{
  "locations": [
    {
      "id": "jmp",                       // unik, dipakai di URL ?loc=jmp
      "name": "JMP Warehouse",           // nama tampil (dropdown + panel)
      "ws": "ws://10.10.1.223:10011/ws", // sumber WS tempat ini (server-side, tak diekspos)
      "scene3d": "/scenejmp.json",       // denah 3D (file di public/)
      "layout2d": "/layout2djmp.json"    // denah 2D (file di public/)
    }
  ]
}
```

Multi-lantai (opsional) — tambah `floors`; tiap lantai punya file sendiri, WS tetap satu per lokasi:
```json
{
  "id": "jmp", "name": "JMP Warehouse", "ws": "ws://10.10.1.223:10011/ws",
  "scene3d": "/scenejmp.json", "layout2d": "/layout2djmp.json",
  "floors": [
    { "id": "l1", "name": "Lantai 1", "scene3d": "/scenes/jmp-l1.json", "layout2d": "/layouts/jmp-l1.json" },
    { "id": "l2", "name": "Lantai 2", "scene3d": "/scenes/jmp-l2.json", "layout2d": "/layouts/jmp-l2.json" }
  ]
}
```
Dropdown lokasi muncul otomatis bila **>1 lokasi**; dropdown lantai muncul bila lokasi punya **>1 lantai**.

---

## 7. Menambah tempat baru (langkah)

1. **Buat denah** di Builder (internal): `npm run builder` (port 10103) → buat 3D & 2D → **Simpan**
   `scene.json` dan `layout2d.json`. Siapkan model `.glb` yang dipakai.
2. **Taruh file** di server:
   - `scene.json` / `layout2d.json` → `twinscape/public/` (boleh diberi nama unik, mis. `scene-gudang-b.json`,
     atau rapikan ke subfolder `twinscape/public/scenes/` & `twinscape/public/layouts/`).
   - model `.glb` → `twinscape/public/models/`.
3. **Tambah 1 entri** di `twinscape/locations.json` (lihat skema di atas) — set `id`, `name`, `ws`,
   dan `scene3d`/`layout2d` menunjuk ke file tadi.
4. **Restart**: `npm run pulse:restart`.
5. Buka domain → tempat baru muncul di dropdown. Deep-link: `https://domain/?loc=<id>&view=3d`.

> **Pencocokan device**: pastikan `pin.ip` / `model.deviceIp` di denah **sama** dengan `device.ip`
> yang dikirim WS tempat itu. IP yang tidak cocok → marker abu-abu ("belum terpetakan").

---

## 8. Fitur viewer (ringkas)

- **Toggle 3D/2D** (kanan-atas) — pindah viewer, bawa lokasi/lantai/tema.
- **Cari** device (nama/IP) → sorot + fly-to. **Filter** Semua/Up/Down.
- **Klik device** → panel detail (latency, uptime, downtime, events, trend).
- **Alert**: toast saat device turun/pulih; suara opsional (di menu ☰).
- **Remote**: klik device → **Open SSH / Open VNC** (kalau device remotable + role mengizinkan).
- **Bahasa** EN/ID & **tema** gelap/terang — di menu ☰, tersimpan otomatis.
- **Deep-link**: `?loc=<id>&floor=<id>&view=3d|2d`.
- **Fallback**: perangkat tanpa WebGL diarahkan ke tampilan 2D.
- *Panel "Zona" & pewarnaan zona ada tapi dinonaktifkan sementara — lihat `docs/ROADMAP-v2.md`.*

---

## 9. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Status "Disconnected", marker abu semua | WS upstream di `locations.json` salah/mati; cek `pm2 logs twinscape`. Via domain: pastikan blok `/ws` nginx (upgrade header) terpasang. |
| Denah kosong / "Belum ada scene.json" | File `scene3d`/`layout2d` di `locations.json` tak ada di `public/`. Taruh filenya lalu `pulse:restart`. |
| Device online tapi marker tetap abu | IP tidak cocok — samakan `pin.ip`/`model.deviceIp` dengan `device.ip` dari WS. |
| Model `.glb` tak muncul | File tak ada di `public/models/` atau path `url` di scene salah. |
| 3D tak jalan di perangkat lama | Tak ada WebGL → otomatis muncul tautan ke tampilan 2D. |
| Setelah edit `locations.json` tak berubah | Perlu `npm run pulse:restart` (server baca file saat start). |

Optimasi aset `.glb` (kompresi/meshopt/LOD): lihat [`../docs/PERFORMA-ASET.md`](../docs/PERFORMA-ASET.md).
