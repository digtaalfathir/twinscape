/**
 * Builder (v2) — SERVER SENDIRI, terpisah dari monitoring.
 *
 * Authoring app (3D + 2D) untuk membuat scene.json / layout2d.json.
 * TIDAK butuh backend/monitoring sama sekali — murni statik.
 *
 *   npm run builder            → http://localhost:10103
 *   BUILDER_PORT=xxxx          → ganti port
 *   BUILDER_HOST=127.0.0.1     → batasi ke localhost (default: semua interface → bisa dari LAN)
 *
 * Hasil: unduh scene.json (3D) / layout2d.json (2D) + siapkan .glb, lalu taruh
 * di app monitoring (v2/public/) untuk ditampilkan Viewer.
 * Catatan: builder INTERNAL — tak ada login. Cukup diakses di jaringan lokal, jangan ekspos ke publik.
 */
const path = require("path");
const express = require("express");

const PORT = process.env.BUILDER_PORT || 10103;
const HOST = process.env.BUILDER_HOST || undefined;   // undefined = semua interface (LAN)
const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("  Builder v2 — BERDIRI SENDIRI (tanpa backend)");
  console.log(`  App    : http://${HOST || "0.0.0.0"}:${PORT}  ${HOST ? "(hanya " + HOST + ")" : "(semua interface — akses via http://IP:" + PORT + ")"}`);
  console.log("  (internal — tanpa login; jangan diekspos ke publik)");
  console.log("========================================");
});
