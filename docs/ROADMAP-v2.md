# Roadmap v2 — Digital Twin Monitoring (menuju Cisco Spaces)

> Dokumen ini lengkap: status sekarang, catatan dari kartu Trello, rencana
> bertahap (dengan checklist siap jadi kartu), arsitektur, skema data, prioritas,
> dan target jangka panjang (npm sendiri). Konvensi effort: **S** = jam-an, **M** = 1–3 hari, **L** = minggu-an.

---

## 0. Visi & Prinsip  *(REVISI sesuai review 2026-07-11)*

**Visi:** monitoring hardware sebagai *digital twin* untuk **banyak lokasi** —
tiap tempat penyimpanan barang punya peta sendiri (2D & 3D) yang menampilkan
status device real-time. Patokan tampilan **Cisco Spaces**, tapi **ringan,
flat/clean, low-poly** (Cisco pun begitu — lihat referensi), dan gampang dirawat.

**Prinsip (sudah dikoreksi):**
1. **Author sekali → runtime tinggal muat.** Authoring dipisah dari runtime.
2. **Multi-lokasi.** Monitoring mencakup BANYAK tempat, bukan satu. Tiap lokasi
   punya peta sendiri. Yang dibangun sekarang = **1 lokasi contoh**, tapi **nambah
   lokasi harus gampang** (registry + pemilih lokasi ala "Building 01 / 02 …").
3. **2D & 3D = jalur TERPISAH, sumber data BEDA.** `scene.json` **hanya untuk 3D**.
   **2D** pakai builder & data sendiri (gaya SVG floormap yang sudah disukai, mis.
   `layout2d.json`). Yang menyatukan keduanya hanya **status-by-IP**, bukan datanya.
4. **Jembatan device = IP.** `pin.ip` / `model.deviceIp` dicocokkan `device.ip` dari `/ws`.
5. **Flat & ringan = KRITIS (bukan sekadar selera).** Cisco pun low-poly & blok
   sederhana, bukan foto-real. **Ringan menang atas detail.** Tanpa bloom/efek berat.
   Percobaan kemarin masih terasa berat → performa jadi prioritas utama.
6. **Fitur 3D BERDIRI SENDIRI.** Builder 3D + viewer 3D = aplikasi/modul **terpisah**,
   **TIDAK** digabung ke dalam app monitoring (v1). Cukup ambil status lewat WS/API.
   Arah akhir: bisa jadi **package npm** yang dipakai proyek lain.
7. **Jangan ganggu v1.** Dashboard cards lama tetap jalan apa adanya.

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
| tanpa tembok pinggir bisa lebih clean | **Bukan fitur** — cukup tidak digambar saat authoring | — |
| 3d bisa lebih smooth dan tidak berat | Optimasi performa (merge geometri, instancing, dll.) | A2 |
| builder 2d belum ada, denah → svg | Builder 2D + viewer 2D (data `layout2d.json` sendiri) | C |
| tampilan awal langsung di tengah | Kamera auto-center / fit-to-scene | A1 |
| perbagus 3d builder, lebih mudah & berdiri sendiri | UX builder: undo, edit tembok, simpan ke server | B |
| ada tipe 2d & tipe 3d | Satu scene, dua renderer + toggle 2D/3D | D |
| buat npm sendiri (konteks) | Ekstrak jadi package reusable | G |

---

## 3. Roadmap Bertahap

### Fase A — Polish tampilan & UX inti (quick wins) 🎯 mulai di sini

> Catatan: "tanpa tembok pinggir" **bukan fitur** — cukup jangan gambar temboknya saat authoring.

- [x] **A1 — Kamera awal auto-center** (S) ✅ DONE
  - Hitung bounding box seluruh objek scene → set target ke pusat, jarak kamera pas (fit).
  - Kalau `scene.json.camera` ada → pakai itu; kalau tidak → auto-fit.
  - Terapkan di `scene-view.js` dan `unused/v2-cisco/v2.html`.
  - *Acceptance:* buka scene apa pun → langsung ter-frame di tengah, tidak perlu geser manual.

- [x] **A2 — Performa: "smooth & tidak berat"** (M) ✅ DONE (merge tembok + model load-once/clone)
  - **Merge geometri tembok** sewarna via `BufferGeometryUtils.mergeGeometries` → tekan draw-call.
  - **Instancing** untuk model berulang (mis. 6 mesin identik = 1 `InstancedMesh`).
  - Cap `pixelRatio` (sudah). Shadow default OFF (lihat A3).
  - Anjuran aset: model **low-poly**, tekstur kecil, `.glb` ringan (nanti Draco di F1).
  - Frustum culling default; hindari material transparan berlebih.
  - *Acceptance:* scene sedang (ratusan objek) tetap 60fps di laptop biasa; ada toggle "mode ringan".

- [x] **A3 — Default tampilan ringan** (S) ✅ DONE
  - Keputusan: **Grid & Shadow OFF dari awal, tanpa toggle** (flat & ringan). **Labels** tetap punya tombol on/off. (Tombol "Mode Ringan" dari A2 dihapus karena shadow sudah default off.)

---

### Fase B — Builder 3D lebih mudah & berdiri sendiri

- [x] **B1 — Edit objek yang sudah ada** (M) ✅ DONE
  - Pilih tembok → panel "Tembok Terpilih": ubah tinggi/tebal/warna/tutup-loop; **drag titik kuning** di sudut untuk geser vertex; daftar lubang (edit lebar/posisi/atas/ambang + hapus).
- [x] **B2 — Undo / Redo** (M) ✅ DONE — snapshot scene sebelum tiap aksi (buat/hapus/geser/edit). Tombol ↶/↷ + Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z). Kamera tak ikut berubah saat undo.
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

### Fase C — Track 2D: Builder 2D + Viewer 2D (sumber data SENDIRI)

> **Penting (revisi):** 2D punya data & builder **sendiri**, BUKAN dari `scene.json`.
> Output = layout 2D (mis. `layout2d.json`) yang dipakai `floormap.html` (SVG yang sudah disukai).

- [ ] **C1 — Builder 2D (denah → SVG)** (M)  *(catatan kartu: "belum ada")*
  - Upload denah → jiplak jadi ruangan/tembok/pin **top-down** → simpan `layout2d.json`.
  - Boleh meniru gaya "Muat Denah", tapi **output format 2D sendiri** (bukan scene.json 3D).
- [ ] **C2 — Viewer 2D baca `layout2d.json`** (M)
  - `floormap.html` (SVG) dibuat **membaca `layout2d.json`** (bukan denah hardcoded).
  - Marker status live (pola IP sama).
- [ ] **C3 — Export SVG statik** (S) — untuk dokumen/print.

---

### Fase D — Multi-Lokasi & Pemilih 2D/3D

> Menjawab "banyak tempat" + "ada tipe 2D & 3D". 2D & 3D tetap data terpisah;
> toggle hanya memilih viewer + file mana yang dimuat untuk lokasi terpilih.

- [ ] **D1 — Registry lokasi** (M)
  - `locations.json` → `[{ id, name, scene3d: "/scenes/gudang-a.json", layout2d: "/layouts/gudang-a.json" }, …]`.
  - **Nambah lokasi = tambah 1 entri + file-nya.** Itu saja.
- [ ] **D2 — Pemilih lokasi** (S) — dropdown "Building 01 / 02 …" (ala Cisco) untuk pindah tempat.
- [ ] **D3 — Toggle 2D / 3D per lokasi** (S)
  - Satu shell viewer: tombol **2D** memuat `layout2d`, tombol **3D** memuat `scene3d` lokasi terpilih.
  - Deep-link: `?loc=gudang-a&view=3d`.
- [ ] **D4 — Status live lintas lokasi** (S) — device di lokasi mana pun tetap dicocokkan by-IP.

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
- **Data (TERPISAH):** 3D = `scene.json`; 2D = `layout2d.json` (format sendiri). Multi-lokasi via `locations.json`. Ketiganya per-meter/top-down; hanya status-by-IP yang menyatukan.
- **Linking:** IP sebagai "foreign key" device (dari `/ws` app monitoring).
- **Standalone:** builder 3D + viewer 3D = modul **terpisah** dari app monitoring; hanya konsumsi WS/API. Arah akhir = package npm. Untuk sekarang tetap file mandiri (pola `unused/v2-cisco/v2.html`).
- **Pengungkit performa (Fase A3/F1) — KRITIS:** merge geometri, InstancedMesh, low-poly, tekstur kecil, Draco, LOD, cap pixelRatio, toggle shadow. Target: ringan seperti Cisco.
- **Isolasi:** v2 = file terpisah; eksperimen/parkir di `unused/`; dokumen di `docs/`.

---

## 5. Skema Data (TIGA file terpisah)

**Ringkasan:** `scene.json` (3D) · `layout2d.json` (2D) · `locations.json` (daftar lokasi).
Ketiganya independen; hanya dihubungkan lewat **IP device**.

### 5a. `scene.json` — HANYA untuk 3D (target lengkap)

```jsonc
{
  "version": 1,
  "units": "m",
  "walls": [
    { "points": [[x,z], ...], "height": 3, "thickness": 0.15,
      "color": "#8fa3c4", "closed": true,
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
Field baru (`zones`, `level`) **backward-compatible** — runtime lama abaikan yang tidak dikenal.

### 5b. `layout2d.json` — HANYA untuk 2D (top-down / SVG, format sendiri)

```jsonc
{
  "version": 1,
  "viewBox": [0, 0, 1120, 780],                 // koordinat SVG (bukan meter)
  "rooms":  [ { "x": 0, "y": 0, "w": 200, "h": 150, "label": "GUDANG A", "color": "#.." } ],
  "walls":  [ /* garis/segmen 2D */ ],
  "pins":   [ { "x": 320, "y": 180, "ip": "172.19.88.19", "label": "DCS QI F4" } ]
}
```
Dipakai `floormap.html` (SVG blueprint yang sudah disukai). **Tidak** berbagi data dengan `scene.json`.

### 5c. `locations.json` — daftar lokasi (multi-lokasi)

```jsonc
{
  "locations": [
    { "id": "gudang-a", "name": "Gudang A", "scene3d": "/scenes/gudang-a.json", "layout2d": "/layouts/gudang-a.json" },
    { "id": "gudang-b", "name": "Gudang B", "scene3d": "/scenes/gudang-b.json", "layout2d": "/layouts/gudang-b.json" }
  ]
}
```
**Nambah lokasi** = tambah satu entri di sini + file scene/layout-nya.

---

## 6. Prioritas (urutan disarankan)

1. **Fase A** (A1 auto-center, **A2 performa = paling penting**, A3 toggle) — dampak besar, effort kecil, menjawab catatan tampilan.
2. **Fase D1–D2** — registry + pemilih lokasi (fondasi multi-lokasi; bikin nambah tempat gampang sejak awal).
3. **Fase C** — builder 2D + viewer 2D (data sendiri) — menjawab "builder 2D belum ada".
4. **Fase D3** — toggle 2D/3D per lokasi.
5. **Fase B1–B3** — builder 3D lebih enak (edit + simpan ke server).
6. **Fase E** — fitur Cisco (detail, zona, cari) sesuai kebutuhan.
7. **Fase F / G** — optimasi lanjut & package npm.

---

## 7. Risiko & Catatan

- **Render WebGL tidak bisa diverifikasi headless** oleh AI — tes visual selalu di sisi kamu (buka di browser, cek Console F12).
- **Performa** tergantung aset: model berat = berat. Jaga low-poly (A3/F1).
- **Lisensi model** `.glb` dari internet — cek CC0/CC-BY sebelum dipakai.
- **Simpan ke server (B3)** menyentuh backend → tetap sebagai endpoint v2 terpisah, jangan ubah alur v1.
- **Data runtime** (`daily_stats.json`, `logs/`) sudah di-`.gitignore` (fix konflik `git pull`).

---

*Terakhir diperbarui: 2026-07-11 · dokumen hidup, silakan pecah tiap task jadi kartu Trello.*
