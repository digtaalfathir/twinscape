# v2 — Stechoq Pulse (Monitoring Viewer)

App v2 = **monitoring** (viewer), branded **“Stechoq Pulse”**. Terpisah dari dashboard v1
dan dari **Builder** (app authoring sendiri, lihat `../builder/`). v2 hanya **menampilkan**
denah + **status device live** yang diterima dari **WS server yang sudah running** (di-proxy per-lokasi).

```
v2/
  server.js            ← server statik v2 + proxy /ws?loc=<id> → WS server tiap lokasi
  locations.json       ← daftar lokasi (id, name, ws, scene3d, layout2d)
  public/
    index.html         ← Stechoq Pulse — masuk web langsung ke monitoring 3D (default)
                          topbar: toggle 3D|2D (2D disabled/segera) + toggle tema gelap/terang
    js/scene-view.js   ← viewer 3D (konsumen scene.json)
    css/pulse.css       ← tema Pulse (dark/light, aksen biru)
    floormap.html      + js/floormap.js + css/floormap.css   (viewer 2D — standalone, dipakai saat toggle 2D diaktifkan)
    scene.example.json · layout2d.example.json     ← contoh (dipakai otomatis kalau scene.json belum ada)
    models/            ← file .glb (dipakai scene 3D)
    vendor/three/      ← Three.js lokal (offline)
```
> **Builder ada di folder terpisah `builder/`** (repo root) — jalankan `npm run builder`.

## Menjalankan
```bash
npm run v2    # app monitoring v2 di :10102 — buka http://localhost:10102 (langsung 3D)
```
Status device (warna pin, detail) datang dari **WS server eksternal** yang di-set di `locations.json`
(mis. `ws://10.10.1.223:10011/ws`). Tak perlu `npm start`; v2 bukan yang nge-ping device.

## Alur pakai
1. Buat denah di **Builder** (`npm run builder`, :10103) → **Simpan** `scene.json` (3D) / `layout2d.json` (2D) + siapkan `.glb`.
2. Taruh `scene.json` / `layout2d.json` di **`v2/public/`**, model `.glb` di **`v2/public/models/`**.
   (Kalau `scene.json` belum ada, viewer otomatis memuat `scene.example.json` sebagai contoh.)
3. Set WS tiap lokasi di **`locations.json`**. Buka **`/`** → langsung 3D monitoring + status live.

**Pin ↔ device asli** dicocokkan lewat **IP** (`pin.ip` / `model.deviceIp` = `device.ip`).
