# Stechoq Pulse — Monitoring (v2)

Viewer monitoring digital-twin (2D & 3D) untuk status hardware, terinspirasi Cisco Spaces.
**Read-only**: v2 TIDAK meng-ping device — ia **konsumen** yang menerima data dari **WS server yang
sudah running** (format `{ devices, timestamp }`), lalu memetakan status ke marker **berdasarkan IP**.

- Buka web → **langsung masuk monitoring 3D** (tanpa memilih).
- Toggle **3D ↔ 2D**, tema **gelap/terang**, multi-lokasi & multi-lantai, cari device, filter, alert.
- **Yang di-deploy hanya v2 (monitoring).** Builder = alat internal (folder `../builder/`), **tidak** ikut di server.

---

## 1. Struktur folder

```
v2/
  server.js              server statik + API + proxy WS  (port default 10102)
  ecosystem.config.js    konfigurasi PM2 (hanya monitoring)
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
[WS server tiap lokasi]  --(sudah running di tempat lain)-->  v2/server.js  --proxy /ws?loc=<id>-->  browser
        (ws://IP:PORT/ws)                                     (locations.json)                      (viewer)
```

- **URL WS upstream disimpan di server** (`locations.json`), **tidak** diekspos ke browser.
- Marker device diwarnai dengan mencocokkan **IP**: `pin.ip` (2D/3D) atau `model.deviceIp` (3D) **=** `device.ip` dari WS.
- Denah **3D** (`scene.json`) dan **2D** (`layout2d.json`) adalah **file terpisah** — dibuat di Builder.

---

## 3. Jalankan lokal (development)

```bash
npm install
npm run v2            # → http://localhost:10102  (langsung 3D)
```
Belum ada `scene.json`/`layout2d.json`? Viewer otomatis menampilkan **contoh** bawaan.

---

## 4. Deploy produksi dengan PM2

Prasyarat server: **Node.js ≥ 16**, **PM2** (`npm i -g pm2`), dan (untuk domain) **nginx**.

```bash
# 1. ambil kode + dependensi
git clone <repo> && cd ServerSideMonitoring
npm install --omit=dev          # cukup express + ws untuk v2

# 2. siapkan folder log + isi locations.json (lihat bagian 6)
mkdir -p v2/logs
nano v2/locations.json

# 2b. buat akun login (WAJIB — tanpa akun tak ada yang bisa masuk)
node v2/adduser.js <username>         # diminta password (lihat bagian "Login & akun")

# 3. jalankan HANYA monitoring lewat PM2
pm2 start v2/ecosystem.config.js      # atau: npm run pulse:start
pm2 save                              # simpan daftar proses
pm2 startup                           # ikuti perintah yang dicetak → auto-start saat reboot

# cek
pm2 status
pm2 logs stechoq-pulse                # atau: npm run pulse:logs
```

Proses bernama **`stechoq-pulse`**, listen di **127.0.0.1:10102** (lihat `ecosystem.config.js`).
Builder & v1 **tidak** disertakan di config ini.

**Perintah harian:**
```bash
npm run pulse:restart     # setelah edit locations.json / taruh scene baru
npm run pulse:stop
npm run pulse:logs
```

### Ubah port / binding
Edit `env` di `v2/ecosystem.config.js` lalu `pm2 restart stechoq-pulse --update-env`:
- `V2_PORT` — port internal (default 10102).
- `V2_HOST` — `127.0.0.1` (hanya via nginx, disarankan) atau hapus untuk akses langsung dari LAN.
- `MONITOR_WS` — sumber WS fallback bila `locations.json` kosong (opsional).
- `PULSE_SECRET` — kunci penanda-tangan sesi login. Opsional: kalau tak diisi, dibuat otomatis & disimpan di `v2/.pulse-secret`. Isi sendiri (string acak panjang) bila menjalankan >1 instance.

## 4b. Login & akun

Akses dibatasi **akun terdaftar**. Halaman/`API`/`WS` semuanya butuh sesi login (kecuali halaman login).

```bash
node v2/adduser.js madani            # tambah akun, diminta password (tersembunyi)
node v2/adduser.js madani rahasia123 # atau non-interaktif (password sbagai argumen)
```
- Akun disimpan di **`v2/users.json`** (password di-hash **scrypt**, bukan plaintext). File ini **tidak** di-commit (`.gitignore`).
- **Tambah/ubah** akun = jalankan `adduser` lagi (username sama = password di-update). **Hapus** akun = buka `v2/users.json`, hapus entri-nya.
- Setelah tambah/hapus akun, **tak perlu restart** — dibaca saat login.
- **Logout**: tombol ⎋ di kanan-atas topbar (atau hapus cookie). Sesi bertahan **7 hari**.
- Password lupa? Set ulang: `node v2/adduser.js <username>` (menimpa yang lama).

> Cookie sesi otomatis pakai flag **Secure** saat via HTTPS (butuh `X-Forwarded-Proto` dari nginx — sudah ada di contoh config).

---

## 5. Sambungkan ke domain (nginx + HTTPS)

```bash
sudo cp v2/deploy/nginx-pulse.conf.example /etc/nginx/sites-available/pulse.conf
sudo nano /etc/nginx/sites-available/pulse.conf          # ganti server_name → domainmu
sudo ln -s /etc/nginx/sites-available/pulse.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS otomatis (Let's Encrypt)
sudo certbot --nginx -d pulse.contoh.com
```
Config sudah menyertakan **upgrade header untuk `/ws`** (wajib, kalau tidak status live gagal connect).
Setelah HTTPS, browser pakai `wss://` otomatis (viewer mengikuti protokol halaman).

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
   - `scene.json` / `layout2d.json` → `v2/public/` (boleh diberi nama unik, mis. `scene-gudang-b.json`,
     atau rapikan ke subfolder `v2/public/scenes/` & `v2/public/layouts/`).
   - model `.glb` → `v2/public/models/`.
3. **Tambah 1 entri** di `v2/locations.json` (lihat skema di atas) — set `id`, `name`, `ws`,
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
- **Alert**: toast saat device turun/pulih; tombol 🔔 untuk suara (opsional).
- **Share** 🔗 — salin deep-link read-only lokasi/lantai/view saat ini.
- **Tema** gelap/terang (🌙/☀️), tersimpan otomatis.
- **Deep-link**: `?loc=<id>&floor=<id>&view=3d|2d`.
- **Fallback**: perangkat tanpa WebGL diarahkan ke tampilan 2D.
- *Panel "Zona" & pewarnaan zona ada tapi dinonaktifkan sementara — lihat `docs/ROADMAP-v2.md`.*

---

## 9. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Status "Disconnected", marker abu semua | WS upstream di `locations.json` salah/mati; cek `pm2 logs stechoq-pulse`. Via domain: pastikan blok `/ws` nginx (upgrade header) terpasang. |
| Denah kosong / "Belum ada scene.json" | File `scene3d`/`layout2d` di `locations.json` tak ada di `public/`. Taruh filenya lalu `pulse:restart`. |
| Device online tapi marker tetap abu | IP tidak cocok — samakan `pin.ip`/`model.deviceIp` dengan `device.ip` dari WS. |
| Model `.glb` tak muncul | File tak ada di `public/models/` atau path `url` di scene salah. |
| 3D tak jalan di perangkat lama | Tak ada WebGL → otomatis muncul tautan ke tampilan 2D. |
| Setelah edit `locations.json` tak berubah | Perlu `npm run pulse:restart` (server baca file saat start). |

Optimasi aset `.glb` (kompresi/meshopt/LOD): lihat [`../docs/PERFORMA-ASET.md`](../docs/PERFORMA-ASET.md).
