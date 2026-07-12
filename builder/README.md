# Builder v2 — BERDIRI SENDIRI (authoring 3D & 2D)

App untuk **membuat denah** digital-twin, terpisah total dari monitoring (v2) &
dashboard (v1). **Tidak butuh backend sama sekali** (murni statik; IP device
diketik manual). Hasilnya = `scene.json` (3D) / `layout2d.json` (2D) + file `.glb`,
yang lalu ditaruh di app monitoring (`v2/public/`).

```
builder/
  server.js          ← server statik sendiri (port 10103)
  public/
    index.html       ← shell: toggle 3D | 2D (embed via iframe)
    3d/  index.html + builder.js + builder.css   (builder 3D, WebGL/Three.js)
    2d/  index.html + builder.js + builder.css   (builder 2D, SVG)
    vendor/three/    ← Three.js lokal (offline)
    models/          ← .glb + models.json (katalog model)
```

## Menjalankan
```bash
npm run builder      # http://localhost:10103  → pilih 3D atau 2D
# atau server statik apa pun:
npx serve builder/public
```
Tidak perlu `npm start` / `npm run v2` — builder mandiri.

### Akses dari laptop lain (LAN)
Builder otomatis dengar di **semua interface**, jadi bisa dibuka dari komputer lain tanpa PM2:
```bash
# di server (biar tetap jalan walau terminal/SSH ditutup):
nohup node builder/server.js > builder/builder.log 2>&1 &
# ganti port bila perlu: BUILDER_PORT=10103 nohup node builder/server.js ...
# buka firewall port:
sudo ufw allow 10103/tcp
# cek IP server:
hostname -I
```
Buka di browser laptop lain: **`http://<IP-server>:10103`**.
Stop: `pkill -f "node builder/server.js"`.

> **Internal saja** — builder TANPA login. Cukup di jaringan lokal; **jangan** diarahkan ke domain/publik.
> Batasi ke localhost bila perlu: `BUILDER_HOST=127.0.0.1 node builder/server.js`.

## Alur
1. Pilih **3D** atau **2D** di bar atas.
2. Gambar tembok / lantai / pintu / **pin device (isi IP manual)** / teks / model.
3. **Simpan** → unduh `scene.json` (3D) atau `layout2d.json` (2D).
4. Taruh file itu di **`v2/public/`** (dan `.glb` di `v2/public/models/`) agar Viewer menampilkannya.

## 🗺️ Generate 2D dari 3D (top-down otomatis)
Biar tak menggambar ulang di 2D: bangun sekali di **3D**, lalu klik **"🗺️ Generate 2D"** →
unduh `layout2d.json` hasil proyeksi top-down:
- lantai → **acuan gedung**; green floor → **jalur hijau**; tembok → **tembok**;
- **model → kotak footprint** (rak=biru, gate=amber, forklift=abu, lainnya=abu-biru; ukuran per jenis);
- **pin → pin**; **teks → room berlabel**.
- Model yang tertaruh **jauh di luar gedung** (outlier) otomatis dilewati.

Lalu buka **Builder 2D → Muat** `layout2d.json` untuk **poles manual** (geser / rename / hapus),
Simpan, taruh di `v2/public/`. **Mesin baru** cukup ditaruh di 3D → ikut muncul saat generate lagi.
> Ukuran footprint masih tebakan per nama file. Untuk akurasi, nanti bisa ditambah `footprint` di `models.json`.

## Katalog model (`public/models/models.json`)
```jsonc
{ "models": [ { "file": "forklift.glb", "name": "Forklift" }, … ] }
```
`file` relatif ke `models/`. Di Builder 3D: klik item → taruh di tengah, atau **drag** ke lantai. Tombol ⟳ = muat ulang.

## Pintasan
- **Shift/Ctrl+klik** = pilih banyak · **Ctrl+D** duplikat · **Delete** hapus (semua terpilih).
- **Ctrl+Z / Ctrl+Y** = undo / redo.
- Tembok: **Enter** selesai · **Esc** batal · centang **Lurus** untuk kunci sudut; ujung nempel (snap) ke vertex lain.
- Pilih tembok → drag titik kuning ubah bentuk; edit tinggi/tebal/lubang di panel.

## Pin ↔ device asli
Jembatan = **IP**. Isi `IP` pada pin (atau `Device IP` pada model) sama dengan IP
device asli. Viewer (v2) yang mencocokkan status live-nya.
