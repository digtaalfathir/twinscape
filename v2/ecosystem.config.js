/**
 * PM2 — Stechoq Pulse (monitoring v2) SAJA.
 * Builder & v1 TIDAK ikut di sini (builder = internal, jalankan manual saat perlu).
 *
 * Jalankan dari root repo:
 *   pm2 start v2/ecosystem.config.js
 *   pm2 save        # simpan agar auto-jalan setelah reboot (lihat README)
 *
 * Ubah V2_PORT bila perlu; nginx reverse-proxy domain → port ini.
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "stechoq-pulse",
      script: "server.js",
      cwd: __dirname,                 // = folder v2/ → server.js, locations.json, public/ ada di sini
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,                   // JANGAN true di produksi (locations.json diedit → restart manual)
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        V2_PORT: 10102,               // port internal; nginx yang menghadap domain
        V2_HOST: "127.0.0.1",         // hanya lokal (diakses via nginx). Hapus baris ini utk akses langsung dari LAN
        // MONITOR_WS: "ws://10.10.1.223:10011/ws",  // opsional: fallback bila locations.json kosong
        // PULSE_SECRET: "isi-string-acak-panjang",  // opsional: kunci sesi login (default: auto → v2/.pulse-secret)
      },
      error_file: path.join(__dirname, "logs/pulse-error.log"),
      out_file: path.join(__dirname, "logs/pulse-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
