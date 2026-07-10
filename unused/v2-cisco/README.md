# v2 — 3D Monitoring gaya Cisco (standalone, parkir)

Prototipe v2 **berdiri sendiri dalam satu file**: `v2.html`.
Isi: 1 tempat, 1 scene, **2 titik device**, tampilan patokan **Cisco Spaces**
(flat/clean, tanpa glow). Disimpan di `unused/` supaya repo rapi dan tidak
mengganggu v1 — tinggal diaktifkan kalau mau dilanjut.

## Mengaktifkan (kalau lagi pengen bikin)
File di `unused/` **tidak** disajikan server (Express hanya menyajikan `public/`).
Untuk menjalankan:

```bash
cp unused/v2-cisco/v2.html public/v2.html
npm start
# buka http://localhost:10101/v2.html
```

Butuh server jalan karena file ini memakai:
- `/vendor/three/…` (Three.js yang sudah di-vendor di `public/vendor/`)
- `/ws` (WebSocket status device — sama dengan v1)

Kalau selesai coba dan mau merapikan lagi: `rm public/v2.html`.

## Cara pin device nyambung ke device asli
**Jembatannya = IP.** Tiap titik device di scene punya field `ip`. Server
mengirim daftar device live via `/ws`, tiap item punya `ip` + `status`.
Kode mencocokkan `device.ip === pin.ip`, lalu mewarnai pin
(**hijau = UP, merah = DOWN**) dan mengisi kartu status melayang.

Mau ganti device yang dipantau? Edit array `DEVICES` di dalam `v2.html`:

```js
const DEVICES = [
  { ip: "172.19.88.19", name: "DCS QI F4",        x: -5.5, z: 0 },
  { ip: "172.19.88.16", name: "DCS PLAYMAKER F4", x:  5.5, z: 0 },
];
```

- `ip`   → device asli yang dipantau (kunci pencocokan).
- `name` → teks di kartu.
- `x,z`  → posisi titik di scene (meter).

Tidak ada konfigurasi lain: samakan `ip` = otomatis tersambung.

## Hubungan dengan tool v2 lain (yang sudah ada di `public/`)
File ini versi ringkas/parkir. Alur penuh v2 ada di:
- `scene-builder.html` — bikin denah 3D (tembok/lantai/pintu/pin/teks) → export `scene.json`.
- `scene-view.html` — muat `scene.json` + status live (pola linking yang sama, by-IP).

`v2.html` ini mengambil pola yang sama tapi scene-nya di-hardcode di satu file,
supaya gampang jadi titik awal eksperimen mandiri.
