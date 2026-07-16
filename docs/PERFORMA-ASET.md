# F1 — Optimasi Aset 3D (`.glb`)

Viewer (`v2`) sudah **siap** memuat `.glb` terkompresi **meshopt**; tinggal (a) kompres modelnya dan (b) taruh 1 file decoder. Uncompressed `.glb` tetap jalan tanpa langkah apa pun.

## 1. Kompres `.glb` (meshopt — direkomendasikan)
Pakai [gltf-transform](https://gltf-transform.dev) (CLI Node, sekali jalan di mesin dev — bukan runtime):
```bash
npx @gltf-transform/cli optimize input.glb output.glb --compress meshopt
# atau lebih lengkap: dedup, prune, resize tekstur, weld, lalu meshopt
npx @gltf-transform/cli optimize input.glb output.glb \
  --texture-size 1024 --compress meshopt
```
Taruh hasilnya di `twinscape/public/models/` dan rujuk dari `scene.json` seperti biasa.

## 2. Vendor decoder meshopt (sekali, offline)
Salin **satu file** ini dari paket `three` ke:
```
twinscape/public/vendor/three/addons/libs/meshopt_decoder.module.js
```
Sumbernya: `node_modules/three/examples/jsm/libs/meshopt_decoder.module.js`
(file ini self-contained — wasm-nya sudah embedded base64, jadi cocok untuk offline).

Begitu file ada, `scene-view.js` otomatis mendeteksinya (probe HEAD) dan mengaktifkan
`GLTFLoader.setMeshoptDecoder(...)`. Kalau file tidak ada → dilewati diam-diam.

## 3. Draco (opsional, alternatif)
Kalau lebih suka Draco: vendor `DRACOLoader.js` ke `.../addons/loaders/` **dan** folder
decoder `.../addons/libs/draco/` (beberapa file `.js`/`.wasm`), lalu tambahkan di
`setupDecoders()` (`scene-view.js`):
```js
const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
const d = new DRACOLoader(); d.setDecoderPath("/vendor/three/addons/libs/draco/");
loader.setDRACOLoader(d);
```
Meshopt biasanya cukup dan lebih ringan untuk di-vendor (1 file vs beberapa file wasm).

## 4. LOD (model jauh) — langkah aset
LOD geometris butuh beberapa tingkat detail; hasilkan saat build aset, bukan runtime:
```bash
# contoh: bikin versi simplified untuk dipakai sebagai LOD jauh
npx @gltf-transform/cli simplify input.glb input-lod1.glb --ratio 0.4 --error 0.01
```
Model v2 low-poly + **load-once lalu clone** (A2) + **clipping plane** sudah menahan beban.
Kalau nanti butuh LOD runtime, bungkus level-level itu di `THREE.LOD` saat `addModel()`.
