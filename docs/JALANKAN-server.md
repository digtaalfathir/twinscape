# Menjalankan Twinscape (v2) di server — via IP dulu, domain belakangan

Panduan menjalankan **monitoring v2** di server pakai PM2, diakses lewat **`http://<IP-server>:10102`**.
nginx + domain menyusul (lihat `../twinscape/README.md` bagian 5). Builder & v1 **tidak** dijalankan di sini.

---

## ⚡ Kalau "refused to connect" dari PC lain (kasus tersering)

Gejala: di server jalan, tapi dari laptop lain `http://IP:10102` → **ERR_CONNECTION_REFUSED**,
dan `pm2 logs` menampilkan `App : http://127.0.0.1:10102`.

Sebab: server hanya dengar di **localhost**. Perbaiki — pastikan `V2_HOST` **nonaktif**:

```bash
nano twinscape/ecosystem.config.js
```
```js
        V2_PORT: 10102,
        // V2_HOST: "127.0.0.1",   ← pastikan ada // di depan (nonaktif) selama belum pakai nginx
```
Lalu **restart dengan env di-refresh** (penting — restart biasa TIDAK memuat ulang env):
```bash
pm2 delete twinscape-v2
pm2 start twinscape/ecosystem.config.js
pm2 save
```
Cek log harusnya jadi: `App : http://0.0.0.0:10102  (semua interface …)`.
Verifikasi bind:
```bash
ss -ltnp | grep 10102      # harus 0.0.0.0:10102 (bukan 127.0.0.1:10102)
```

---

## Langkah lengkap (dari nol)

### 0. Prasyarat
```bash
node -v                      # v16+
sudo npm install -g pm2
```

### 1. Ambil kode + dependensi
```bash
git clone <repo-url> twinscape && cd twinscape
npm install --omit=dev       # cukup express + ws
# server tanpa internet? salin folder node_modules/ dari mesin lain, jangan npm install
```

### 2. Daftar tempat
```bash
nano twinscape/locations.json       # id, name, ws (sumber WS pabrik), scene3d, layout2d
```

### 3. Akses lewat IP (sebelum ada nginx)
Buka `twinscape/ecosystem.config.js`, pastikan baris `V2_HOST` **dikomentari** (lihat bagian ⚡ di atas).
Default repo sudah nonaktif → dengar semua interface.

### 4. Buat akun login (WAJIB)
```bash
mkdir -p twinscape/logs
node twinscape/adduser.js admin     # ketik password (tersembunyi). Tambah akun lain = ulangi
```

### 5. Jalankan + auto-start saat reboot
```bash
pm2 start twinscape/ecosystem.config.js
pm2 save
pm2 startup                  # jalankan perintah sudo yang tercetak
pm2 status                   # twinscape-v2 = online
```

### 6. Firewall (kalau ufw aktif)
```bash
sudo ufw status
sudo ufw allow 10102/tcp
```

### 7. Akses
```bash
hostname -I                  # IP server, mis. 10.10.1.210
```
Buka di browser: **`http://<IP-server>:10102`** → login pakai akun langkah 4.

---

## Perintah harian
```bash
pm2 logs twinscape-v2           # lihat log (Ctrl-C keluar)
npm run pulse:restart            # sesudah edit locations.json / taruh scene / tambah akun
npm run pulse:stop
pm2 status
```
> Sesudah **edit `ecosystem.config.js`** (mis. ubah port/host), pakai `pm2 delete twinscape-v2 && pm2 start twinscape/ecosystem.config.js` agar env baru terbaca — bukan `restart` biasa.

---

## Troubleshooting
| Gejala | Solusi |
|---|---|
| `ERR_CONNECTION_REFUSED` dari PC lain | `V2_HOST` masih aktif (127.0.0.1) → nonaktifkan + `pm2 delete`/`start`. Cek `ss -ltnp \| grep 10102` = `0.0.0.0`. |
| Bisa dibuka di server (`localhost`) tapi tidak dari luar | Sama seperti di atas (bind), atau firewall → `sudo ufw allow 10102/tcp`. |
| Halaman langsung minta login | Normal. Belum punya akun? `node twinscape/adduser.js <username>`. |
| Status "Disconnected" / device abu | WS pabrik di `locations.json` salah/mati; cek `pm2 logs`. |
| Ganti port | Edit `V2_PORT` di `ecosystem.config.js` → `pm2 delete`/`start` → buka firewall port baru. |

---

## Besok: sambungkan domain
1. Aktifkan lagi `V2_HOST: "127.0.0.1"` di `ecosystem.config.js` → `pm2 delete twinscape-v2 && pm2 start twinscape/ecosystem.config.js && pm2 save`.
2. Pasang `../twinscape/deploy/nginx-pulse.conf.example` (ganti `server_name`) → `sudo certbot --nginx -d <domain>` untuk HTTPS.
3. Detail di `../twinscape/README.md` bagian **5**.
