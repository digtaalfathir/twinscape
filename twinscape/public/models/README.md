# Folder Model 3D (.glb / .gltf)

Taruh file model 3D kamu di folder ini (mis. hasil download dari Sketchfab / Poly Haven).

- Format yang didukung: **`.glb`** (disarankan, satu file) atau `.gltf`.
- Di **Scene Builder** (`/scene-builder.html`), muat model lewat path, contoh: `/models/inject-machine.glb`.
- File yang sama akan dimuat otomatis oleh dashboard 3D runtime saat membaca `scene.json`.

Contoh isi:
```
public/models/
  inject-machine.glb
  forklift.glb
  pallet-rack.glb
```

Tips: pilih model yang sudah "low-poly / game-ready" agar ringan di browser. Cek lisensi (CC0 / CC-BY) sebelum dipakai.
