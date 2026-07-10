# Roadmap v2 — Digital Twin Monitoring (menuju Cisco Spaces)

> Dokumen ini lengkap: status sekarang, catatan dari kartu Trello, rencana
> bertahap (dengan checklist siap jadi kartu), arsitektur, skema data, prioritas,
> dan target jangka panjang (npm sendiri). Konvensi effort: **S** = jam-an, **M** = 1–3 hari, **L** = minggu-an.

---

## 0. Visi & Prinsip

**Visi:** monitoring hardware dalam bentuk *digital twin* 3D (dan 2D) yang bisa
diputar, menampilkan status device real-time — patokan tampilan **Cisco Spaces**,
tapi ringan, flat/clean, dan gampang dirawat.

**Prinsip yang dipegang:**
1. **Author sekali → `scene.json` → runtime tinggal muat.** Authoring dipisah dari runtime.
2. **Satu sumber data (`scene.json`), banyak tampilan** (2D top-down & 3D).
3. **Jembatan device = IP.** `pin.ip` / `model.deviceIp` dicocokkan dengan `device.ip` dari `/ws`.
4. **Jangan ganggu v1.** Semua v2 = file terpisah; v1 (dashboard cards) tetap jalan.
5. **Flat & ringan > wah.** Tanpa bloom/efek berat. Kejelasan status di atas foto-realisme.
6. **Berdiri sendiri.** Komponen bisa dipindah/diaktifkan tanpa merombak app.

---

## 1. Status Sekarang (SUDAH JADI ✅)

| Komponen | File | Fungsi |
|---|---|---|
| v1 dashboard | `public/dashboard.html` (+ backend) | Kartu status device (produksi, jangan diubah) |
| 2D Floor Map | `public/floormap.html` | Denah SVG blueprint + marker status live (denah masih hardcoded) |
| 3D demo | `public/floormap3d.html` + `js/floorplan-data.js` | 3D dari data denah (extrude), flat |
| **Scene Builder** | `public/scene-builder.html` | Authoring 3D: tembok, **lubang pintu/jendela**, lantai (+urutan), pin, **teks**, model `.glb`, lighting, guide "lurus", copy-paste, Simpan/Muat `scene.json` |
| **Scene View** | `public/scene-view.html` | Runtime: muat `scene.json` + status live (WYSIWYG, tooltip + panel detail) |
| **v2 Cisco (parkir)** | `unused/v2-cisco/v2.html` | Standalone 1-file, muat `scene.json` + model, tampilan kartu Cisco flat |
| Skema data | `scene.json` | walls/floors/pins/models/texts/lighting/camera |
| Aset 3D | `public/vendor/three/`, `public/models/` | Three.js ter-vendor (offline), folder model |

**Linking device sudah jalan:** samakan IP → runtime warnai marker hijau/merah.

---

## 2. Catatan dari Kartu → Task

| Catatan | Jadi task | Fase |
|---|---|---|
| tanpa tembok pinggir bisa lebih clean | Toggle sembunyikan tembok (per-tembok / global) | A1 |
| 3d bisa lebih smooth dan tidak berat | Optimasi performa (merge geometri, instancing, dll.) | A3 |
| builder 2d belum ada, denah → svg | Builder 2D + render top-down dari `scene.json` | C |
| tampilan awal langsung di tengah | Kamera auto-center / fit-to-scene | A2 |
| perbagus 3d builder, lebih mudah & berdiri sendiri | UX builder: undo, edit tembok, simpan ke server | B |
| ada tipe 2d & tipe 3d | Satu scene, dua renderer + toggle 2D/3D | D |
| buat npm sendiri (konteks) | Ekstrak jadi package reusable | G |

---

## 3. Roadmap Bertahap

### Fase A — Polish tampilan & UX inti (quick wins) 🎯 mulai di sini

- [ ] **A1 — Opsi sembunyikan tembok** (S)
  - Tambah field `hidden: true` / `heightMode: "none"|"low"|"full"` per tembok di `scene.json`.
  - Di Scene Builder: checkbox "Sembunyikan/rendahkan tembok pinggir" pada tembok terpilih + toggle global.
  - Di Scene View & v2: hormati field itu (tembok tidak dirender / dirender rendah).
  - *Acceptance:* bisa bikin tampilan open-plan tanpa tembok luar, look lebih clean.

- [ ] **A2 — Kamera awal auto-center** (S)
  - Hitung bounding box seluruh objek scene → set target ke pusat, jarak kamera pas (fit).
  - Kalau `scene.json.camera` ada → pakai itu; kalau tidak → auto-fit.
  - Terapkan di `scene-view.js` dan `unused/v2-cisco/v2.html`.
  - *Acceptance:* buka scene apa pun → langsung ter-frame di tengah, tidak perlu geser manual.

- [ ] **A3 — Performa: "smooth & tidak berat"** (M)
  - **Merge geometri tembok** sewarna via `BufferGeometryUtils.mergeGeometries` → tekan draw-call.
  - **Instancing** untuk model berulang (mis. 6 mesin identik = 1 `InstancedMesh`).
  - Cap `pixelRatio` (sudah), matikan shadow opsional (toggle "mode ringan").
  - Anjuran aset: model **low-poly**, tekstur kecil, `.glb` ringan (nanti Draco di F1).
  - Frustum culling default; hindari material transparan berlebih.
  - *Acceptance:* scene sedang (ratusan objek) tetap 60fps di laptop biasa; ada toggle "mode ringan".

- [ ] **A4 — Toggle tampilan cepat** (S)
  - Tombol: Labels on/off (ada), Grid on/off, Shadow on/off, "mode ringan".

---

### Fase B — Builder 3D lebih mudah & berdiri sendiri

- [ ] **B1 — Edit objek yang sudah ada** (M)
  - Geser titik tembok (drag vertex), ubah tinggi/tebal tembok terpilih, hapus/geser lubang pintu.
  - Saat ini tembok/lubang hanya bisa dibuat & dihapus utuh.
- [ ] **B2 — Undo / Redo** (M) — histori aksi (buat/hapus/pindah).
- [ ] **B3 — Simpan ke server (bukan hanya download)** (M)
  - Endpoint POST `/api/scene` (v2, backend terpisah) untuk menulis `public/scene.json`.
  - Tombol "Simpan ke server" di builder → tidak perlu pindah file manual.
- [ ] **B4 — Katalog model** (M)
  - List `.glb` di `public/models/` (butuh endpoint list), pratinjau, drag ke scene.
- [ ] **B5 — Snapping & guide lanjut** (S)
  - Snap ke titik/tembok lain, tampilkan garis bantu sejajar, ukuran antar objek.
- [ ] **B6 — Builder benar-benar standalone** (M)
  - Paket 1 halaman + aset lokal, bisa dibuka tanpa seluruh app (dokumentasi + folder mandiri).

---

### Fase C — Builder 2D (denah → SVG)  *(catatan: "belum ada")*

- [ ] **C1 — Authoring 2D dari denah** (M)
  - Upload gambar denah → jiplak jadi ruangan/tembok/pin **top-down**.
  - Reuse alat "Muat Denah" yang sudah ada di Scene Builder (mode top-view) → output `scene.json` yang sama.
- [ ] **C2 — Render 2D dari `scene.json`** (M)
  - `floormap.html` (SVG) dibuat **membaca `scene.json`** (bukan denah hardcoded): proyeksi top-down tembok/lantai/pin.
  - Marker status live (pola IP yang sama).
- [ ] **C3 — Export SVG** (S)
  - Dari scene → file `.svg` statik (untuk dokumen/print).
- *Catatan arsitektur:* idealnya **tidak** bikin data 2D terpisah — 2D = tampilan top-down dari `scene.json` yang sama. Ini menyatukan Fase C & D.

---

### Fase D — Dua Tipe: 2D & 3D (satu data, toggle)

- [ ] **D1 — Satu `scene.json` → dua renderer** (M)
  - Halaman runtime punya toggle **2D / 3D**; keduanya baca `scene.json` yang sama.
  - 2D = kanvas/SVG top-down; 3D = Three.js (yang sudah ada).
- [ ] **D2 — Marker & status konsisten** (S)
  - Warna/label device sama di 2D & 3D; klik device sinkron.
- [ ] **D3 — Deep-link view** (S) — `?view=2d|3d&scene=...`.

---

### Fase E — Kelengkapan Fitur ala Cisco

- [ ] **E1 — Klik device → panel detail** (S) — latency avg/peak, uptime, downtime, recent events (sudah ada di scene-view; port ke v2 Cisco).
- [ ] **E2 — Panel per-zona / occupancy** (M) — statistik per ruangan/zona (up/down per zona), seperti panel kiri Cisco.
- [ ] **E3 — Cari device / "Where am I"** (S) — search nama/IP → sorot & fly-to marker.
- [ ] **E4 — Filter & sorot** (S) — filter status/severity; device DOWN otomatis berkedip/menonjol.
- [ ] **E5 — Multi-lantai / multi-gedung** (M) — dropdown lantai; `scene.json` per lantai atau field `level`.
- [ ] **E6 — Library equipment 3D** (M) — kumpulan `.glb` (mesin inject, forklift, rak, gate RFID) siap pakai + tipe device.
- [ ] **E7 — Zona berwarna status** (M) — lantai/zona ikut berubah warna kalau ada device down di dalamnya (heat/status zone).
- [ ] **E8 — Alert/notifikasi** (M) — highlight + toast + (opsional) suara saat device turun.
- [ ] **E9 — Kartu status "Cisco"** (S) — kartu melayang polish (sudah di v2), tambah ikon severity & mini-trend.

---

### Fase F — Kualitas, Performa Lanjut, Deploy

- [ ] **F1 — Aset teroptimasi** (M) — kompresi `.glb` Draco/meshopt, LOD untuk model jauh.
- [ ] **F2 — Responsif / mobile** (M) — layout panel adaptif, kontrol sentuh.
- [ ] **F3 — Persistensi & share** (M) — simpan beberapa scene, link share read-only.
- [ ] **F4 — Uji lintas-browser & fallback** (S) — pesan bila WebGL tidak didukung (sudah ada splash di beberapa halaman).

---

### Fase G — Package npm sendiri  *(catatan: "buat npm sendiri untuk berbagai function")*

- [ ] **G1 — Ekstrak core reusable** (L)
  - Modul: builder geometri (`buildWall/buildFloor/makeTextSprite`), loader `scene.json`, sistem linking-by-IP, komponen kartu/pin.
  - API bersih, tanpa dependensi ke app ini.
- [ ] **G2 — Struktur package** (M) — `@rifky/digital-twin-monitor` (nama contoh), build ESM, dokumentasi, contoh.
- [ ] **G3 — Publish & versioning** (S) — npm (privat/publik), semver, changelog.
- *Manfaat:* dipakai ulang di proyek lain (bukan cuma monitoring hardware ini).

---

## 4. Arsitektur & Keputusan Teknis

- **Rendering:** Three.js ter-vendor lokal (offline), flat (tanpa bloom/tone-map berat), soft shadow opsional.
- **Data:** satu `scene.json` (meter). Runtime 2D & 3D baca yang sama.
- **Linking:** IP sebagai "foreign key" device.
- **Pengungkit performa (Fase A3/F1):** merge geometri, InstancedMesh, low-poly, tekstur kecil, Draco, LOD, cap pixelRatio, toggle shadow.
- **Isolasi:** v2 = file terpisah di `public/`; eksperimen/parkir di `unused/`; dokumen di `docs/`.

---

## 5. Skema `scene.json` (target lengkap)

```jsonc
{
  "version": 1,
  "units": "m",
  "view": { "default": "3d", "lightMode": false },          // (rencana D/A)
  "walls": [
    { "points": [[x,z], ...], "height": 3, "thickness": 0.15,
      "color": "#8fa3c4", "closed": true,
      "hidden": false,                                       // (rencana A1)
      "openings": [ { "seg": 0, "dist": 6, "width": 1.2, "top": 2.1, "sill": 0 } ] }
  ],
  "floors": [ { "x": 0, "z": 0, "w": 20, "d": 14, "type": "concrete|green|office|custom", "color": "#..", "order": 1 } ],
  "zones":  [ { "id": "A", "name": "Zona A", "poly": [[x,z]...], "color": "#..", "deviceIps": ["..."] } ], // (rencana E2/E7)
  "texts":  [ { "x": 0, "y": 2, "z": 0, "text": "AREA", "size": 1, "color": "#.." } ],
  "pins":   [ { "x": -6, "z": -4, "ip": "172.19.88.19", "label": "DCS QI F4" } ],
  "models": [ { "url": "/models/x.glb", "name": "..", "deviceIp": "..", "position": [x,y,z], "rotationY": 0, "scale": 1 } ],
  "level":  "F1",                                            // (rencana E5)
  "lighting": { "exposure": 1.05, "sunElevation": 55, "sunAzimuth": 40, "sunIntensity": 2.1, "ambient": 0.45 },
  "camera": { "position": [x,y,z], "target": [x,y,z] }       // opsional; kalau kosong → auto-fit (A2)
}
```
Field baru (`hidden`, `zones`, `view`, `level`) **backward-compatible** — runtime lama abaikan yang tidak dikenal.

---

## 6. Prioritas (urutan disarankan)

1. **Fase A** (A1 tembok, A2 center, A3 performa) — dampak besar, effort kecil, langsung menjawab catatanmu.
2. **Fase C1–C2 + D1** — 2D dari `scene.json` + toggle 2D/3D (menjawab "tipe 2D & 3D" + "builder 2D").
3. **Fase B1–B3** — builder lebih enak (edit + simpan ke server).
4. **Fase E** — fitur Cisco (detail, zona, cari, multi-lantai) sesuai kebutuhan.
5. **Fase F** — optimasi & deploy.
6. **Fase G** — package npm (jangka panjang).

---

## 7. Risiko & Catatan

- **Render WebGL tidak bisa diverifikasi headless** oleh AI — tes visual selalu di sisi kamu (buka di browser, cek Console F12).
- **Performa** tergantung aset: model berat = berat. Jaga low-poly (A3/F1).
- **Lisensi model** `.glb` dari internet — cek CC0/CC-BY sebelum dipakai.
- **Simpan ke server (B3)** menyentuh backend → tetap sebagai endpoint v2 terpisah, jangan ubah alur v1.
- **Data runtime** (`daily_stats.json`, `logs/`) sudah di-`.gitignore` (fix konflik `git pull`).

---

*Terakhir diperbarui: 2026-07-11 · dokumen hidup, silakan pecah tiap task jadi kartu Trello.*
