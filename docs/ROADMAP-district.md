# Roadmap — Kawasan (Multi-Factory): All · Fokus · Multi-lantai  (Opsi 2)

> Status: **konsep + rencana** (belum ada kode). Pendekatan **Opsi 2**: satu **scene kawasan**
> gabungan (bukan reload per pilihan), dibangun dengan **me-merge JSON per-factory yang sudah ada**
> di Builder + menggambar penghubung, lalu di-viewer bisa **All / fokus-zoom / buramkan lainnya**.
> Konvensi effort: **S** = jam-an, **M** = 1–3 hari, **L** = minggu-an.

---

## Tujuan akhir
Satu **kawasan hidup** per lokasi/PT:
- **All** → lihat seluruh kawasan (semua factory + **jalan/gerbang penghubung**) — terasa satu ekosistem, bukan 4 kartu bercelah.
- **Pilih Factory N** → kamera **zoom** ke factory itu, factory lain **diredupkan/buram** (pakai mekanisme dim yang sudah ada). Tanpa reload.
- **Factory 2-lantai** → saat fokus, muncul **sub-selektor lantai**; lantai **bertumpuk** (offset Y), lantai aktif jelas, lainnya redup.
- Dibangun dari **JSON per-factory yang sudah ada** (di-merge di Builder) — **bukan dari 0**.

## Prinsip
1. **Muat sekali (kawasan), navigasi = kamera + dim.** Reload hanya antar-**lokasi/PT** yang beda, bukan antar-factory.
2. **Reuse authoring lama.** JSON per-factory di-import ke scene kawasan; tak menggambar ulang.
3. **Tag = perekat.** Tiap objek tahu `factory` (+ opsional `floor`) → dasar untuk grup, bounds kamera, dan dim.

## Model data (target)
Scene kawasan = satu JSON, tiap objek dapat `factory` (id) + opsional `floor` (id), plus manifest ringkas:
```json
{
  "factories": [
    { "id": "f2", "name": "Factory 2" },
    { "id": "f3", "name": "Factory 3" },
    { "id": "f4", "name": "Factory 4", "floors": [ {"id":"l1","name":"Lantai 1"}, {"id":"l2","name":"Lantai 2"} ] }
  ],
  "floors": [ … ], "walls": [ … ], "models": [ … ], "pins": [ … ]
  // tiap item punya "factory":"f2" (+ "floor":"l1" bila perlu). Objek penghubung (jalan) boleh tanpa factory = milik kawasan.
}
```
- **Bounds per factory** dihitung otomatis dari objek ber-tag (min/max XZ) → untuk fit kamera + fokus.
- Objek tanpa `factory` (jalan/tanah kawasan) = lapisan penghubung, selalu tampil.

---

## Fase

### Fase 1 — Builder: merge + tag (bikin scene kawasan)  · M–L
Kemampuan baru di Builder (authoring):
- **Import/append scene** — muat JSON factory yang ada **ke scene sekarang** (bukan replace), lalu **geser** (drag) ke posisinya. Ulang untuk tiap factory.
- **Auto-tag `factory`** — set yang di-import otomatis dicap id/nama factory (bisa diedit). Objek yang digambar setelahnya (jalan) = tanpa factory (milik kawasan).
- **Penghubung** — gambar jalan/gerbang antar-factory pakai tool yang sudah ada (lantai/tembok), sambil melihat semua → presisi.
- **Multi-lantai** — objek factory 2-lantai diberi `floor` id; sediakan cara set floor + tinggi (offset Y) per lantai.
- **Simpan** sebagai satu JSON kawasan + manifest `factories` (dengan `floors` bila ada).
- *Acceptance:* satu JSON kawasan berisi semua factory + jalan; tiap objek ber-tag `factory` (dan `floor` utk yg berlantai); buka di Builder → tampil menyatu.

### Fase 2 — Viewer: All + fokus-dim (factory 1-lantai dulu)  · M
- Muat scene kawasan; **grup objek per `factory`**; hitung **bounds** tiap factory.
- Selektor **Factory** + opsi **All** (mengganti/`memperluas` dropdown lantai sekarang).
- **All** = kamera **fit** ke seluruh kawasan (semua penuh).
- **Fokus Factory N** = **fly-to-bounds** + **redup/desaturasi grup factory lain** (perluas mekanisme dim device → level grup; animasikan). Tanpa reload.
- Deep-link `?loc=&factory=&view=`.
- *Acceptance:* All → semua kelihatan + jalan; pilih Factory 2 → zoom mulus + factory lain buram; balik All → normal.

### Fase 3 — Multi-lantai (factory berlantai)  · M
- Saat fokus factory yang punya `floors` → muncul **sub-selektor Lantai (1 | 2)**.
- Tampilkan **bertumpuk** (offset Y); **lantai aktif terang, lainnya redup** (konsisten tema buram). Alternatif: swap tampil satu lantai bila tumpukan menghalangi.
- Deep-link tambah `&floor=`.
- *Acceptance:* fokus factory 2-lantai → pilih lantai; bertumpuk, lantai aktif jelas.

### Fase 4 — Polish: panel/statistik & performa  · M
- Panel kiri + filter status **mengikuti konteks**: All = seluruh kawasan; fokus = factory itu saja.
- **Performa All**: sandarkan mode grafis (Auto/Lite) + instancing + **LOD** (detail turun saat zoom-out/redup, naik saat fokus). Lazy-load bila perlu.
- Label factory + hint menyesuaikan mode (All vs fokus).
- *Acceptance:* All tetap enak di PC sedang; angka panel benar per konteks.

### Fase 5 (opsional) — Maintainability  · M
- Per-factory JSON tetap **sumber kebenaran**; Builder bisa **regenerate** JSON kawasan (re-import) saat factory berubah — kawasan = artefak, bukan diedit ganda.
- *Acceptance:* ubah 1 factory → re-merge → kawasan ter-update tanpa gambar ulang jalan (posisi/penghubung dipertahankan).

---

## Keputusan & risiko (dicatat)
- **Dim grup**: perluas mekanisme dim device (opacity/desaturate) ke grup factory; material perlu `transparent`. Animasi transisi.
- **Bounds**: dari objek ber-tag; objek kawasan (jalan) diabaikan saat hitung bounds factory.
- **Koordinat**: offset diatur via drag di Builder → tersimpan sebagai posisi absolut objek di JSON kawasan.
- **Reload**: hanya antar-lokasi; dalam kawasan murni kamera+dim.
- **Berat**: All memuat semua factory sekaligus → performa jadi perhatian (Fase 4).
- **2D**: floormap (SVG) ikut belakangan — All/fokus versi 2D bisa fase tersendiri.

## Ringkas alur akhir
`Builder: import per-factory + geser + gambar jalan + tag → simpan 1 JSON kawasan`
→ `Viewer: All (fit) ⇄ Fokus factory (zoom + buram lainnya) ⇄ Sub-lantai (tumpuk)`.
