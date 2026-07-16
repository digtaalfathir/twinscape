# Publikasikan Twinscape via Cloudflare Tunnel

PC ini di balik VPN/NAT (tak punya IP publik sendiri). **Cloudflare Tunnel** membuat koneksi
**keluar** dari PC ke Cloudflare, lalu Cloudflare menyajikan app ke internet (HTTPS + WebSocket
otomatis). Tak perlu buka port / atur gerbang. `cloudflared` menyambung langsung ke app di
`http://localhost:10102` — **nginx tidak dipakai lagi**.

> Satu syarat untuk memakai domain asli `iot-node.sugity.stechoq-j.com`:
> zona **`stechoq-j.com` harus dikelola di Cloudflare** (lead menambah domain ke akun Cloudflare
> + ganti nameserver ke Cloudflare). Kalau belum bisa, pakai **Quick Tunnel** (Bagian 2) yang
> memberi URL publik instan tanpa domain.

---

## 0. Bersihkan nginx + pastikan app jalan
```bash
cd ~/Documents/Hardware/twinscape
# nginx tak dipakai lagi (tunnel langsung ke app)
sudo rm -f /etc/nginx/sites-enabled/iot-node.conf /etc/nginx/sites-enabled/default
sudo systemctl stop nginx && sudo systemctl disable nginx

# (disarankan) kunci app hanya untuk lokal + tunnel
nano twinscape/ecosystem.config.js         # aktifkan lagi: V2_HOST: "127.0.0.1"
pm2 delete twinscape-v2 && pm2 start twinscape/ecosystem.config.js && pm2 save

# pastikan app hidup di :10102
curl -I http://localhost:10102/login    # harus 200
```

## 1. Install cloudflared (Debian/Ubuntu)
```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
cloudflared --version
```

## 2. Tes cepat — URL publik instan (tanpa akun/domain)
```bash
cloudflared tunnel --url http://localhost:10102
```
Akan muncul baris seperti:
```
https://xxxx-xxxx-xxxx.trycloudflare.com
```
Buka URL itu dari HP/laptop mana pun (data seluler pun bisa) → **login Twinscape muncul**, live data jalan (WS lewat wss otomatis). Ini membuktikan tunnel bekerja. Tekan **Ctrl-C** untuk stop.
> URL ini **sementara** (ganti tiap dijalankan). Untuk domain tetap → Bagian 3.

## 3. Tunnel permanen + domain asli (metode dashboard/token — paling mudah)
Prasyarat: `stechoq-j.com` sudah ada di akun Cloudflare (langkah lead).

1. Buka **https://one.dash.cloudflare.com** → **Networks → Tunnels → Create a tunnel**.
2. Pilih **Cloudflared** → beri nama mis. `pulse` → **Save**.
3. Muncul perintah instalasi berisi **token panjang**. Salin & jalankan di PC:
   ```bash
   sudo cloudflared service install eyJ....(token panjang dari dashboard)....
   ```
   Ini memasang **service systemd** yang auto-jalan & tahan reboot.
   Cek: `sudo systemctl status cloudflared` → `active (running)`.
4. Di halaman tunnel tadi → tab **Public Hostname → Add a public hostname**:
   - **Subdomain**: `iot-node.sugity`
   - **Domain**: `stechoq-j.com`   (hasil: `iot-node.sugity.stechoq-j.com`)
   - **Type**: `HTTP`
   - **URL**: `localhost:10102`
   - **Save**. (Cloudflare otomatis membuat DNS-nya.)
5. WebSocket sudah aktif default. (Kalau ragu: Public hostname → Additional application settings → pastikan tidak dimatikan.)

Tunggu ±1 menit, lalu buka **https://iot-node.sugity.stechoq-j.com** → login Twinscape, gembok 🔒 aktif.

## 4. Verifikasi & catatan
- **Cek service**: `sudo systemctl status cloudflared` (harus running) · log: `sudo journalctl -u cloudflared -f`.
- **HTTPS + cookie aman**: Cloudflare menyajikan HTTPS; app sudah `trust proxy` → cookie login otomatis `Secure`.
- **WebSocket**: didukung Cloudflare Tunnel tanpa config tambahan.
- **Keamanan**: akses tetap dijaga **login** app. (Opsional lebih ketat: Cloudflare Access/Zero Trust untuk gerbang login di depan.)
- **Firewall**: tak perlu buka port masuk apa pun (tunnel keluar). Kalau tadi sempat `ufw allow 10102`, boleh dihapus: `sudo ufw delete allow 10102/tcp`.
- **Update app**: cukup `npm run pulse:restart` seperti biasa — tunnel tetap jalan.

## Troubleshooting
| Gejala | Solusi |
|---|---|
| Quick tunnel error "connection refused" | App belum jalan di :10102 → `pm2 status`, `curl -I http://localhost:10102/login`. |
| Domain 502/1033 | Tunnel service mati atau URL salah → `systemctl status cloudflared`; pastikan Public Hostname URL = `localhost:10102`. |
| Domain tak bisa dibuat di dashboard | Zona `stechoq-j.com` belum di Cloudflare → minta lead menambah domain + ganti nameserver ke Cloudflare. |
| Live data tak masuk (pin abu) | WS: pastikan Public Hostname Type `HTTP` (bukan `HTTPS`) ke `localhost:10102`; WS jalan otomatis. |
