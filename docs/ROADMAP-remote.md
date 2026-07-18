# Roadmap — Remote Access (SSH dulu, VNC menyusul)

> Status: **konsep + rencana**. Belum ada kode. Monitoring tetap default;
> remote = modul opsional yang bisa dimatikan. Prinsip: **SSH dulu**, **lokal dulu**,
> **role/izin belakangan**. Konvensi effort: **S** = jam-an, **M** = 1–3 hari, **L** = minggu-an.

---

## 0. Prinsip

1. **SSH dulu.** Teks, ringan, paling sering dipakai, paling cepat dibuktikan. VNC (desktop) menyusul.
2. **Lokal dulu — tapi ini soal KEAMANAN, bukan batas teknis.** (Lihat §5. Online sebenarnya "gratis" begitu bridge ada; yang belum boleh = mengeksposnya publik sebelum ada RBAC/audit.)
3. **Identitas monitoring ≠ identitas remote.** IP yang tampil di monitoring **tidak** selalu = IP untuk SSH/VNC. Begitu juga **port, username, password**. Butuh config sendiri.
4. **Config: default + override.** Banyak device sama → satu **default**; yang beda tinggal **override** per-device. Tidak perlu isi satu-satu semua.
5. **Kredensial & target remote = SERVER-SIDE saja.** Tak pernah dikirim ke browser — persis seperti `locations.json` menyembunyikan URL WS upstream. Browser cuma tahu "device ini remotable: ya/tidak".
6. **Role (siapa boleh remote apa) = fase belakangan.** MVP: siapa yang sudah login bisa remote (di jaringan lokal). Pengetatan menyusul.

---

## 1. Arsitektur (kenapa cocok)

Server Twinscape sudah **duduk di LAN yang sama dengan device** (dia yang monitor mereka), jadi bisa menjangkau `device:22`. Browser **tak bisa buka TCP mentah** → butuh **bridge WebSocket ↔ TCP** di server. Browser nyambung ke server; server yang buka SSH ke device.

```
Browser (xterm.js)  ──WSS──▶  Twinscape server (di LAN)  ──TCP:22──▶  device
                    (tunnel)   [bridge WS↔SSH]              (LAN)
```

**Keputusan ditunda:** pakai **Apache Guacamole** (gateway matang: SSH+VNC+RDP, auth, session-recording — hemat kerja) **vs DIY ringan** (`xterm.js` + Node `ssh2` untuk SSH; `noVNC` + `websockify` untuk VNC). Untuk MVP SSH, DIY `ssh2` cukup enteng; kalau nanti mau VNC+RDP+audit sekaligus, timbang Guacamole.

---

## 2. Pemisahan identitas: monitoring vs remote  ⭐ (poin kunci)

| | Monitoring | Remote (SSH/VNC) |
|---|---|---|
| IP | `pin.ip` / `model.deviceIp` di scene | **host tersendiri** (bisa beda subnet/VLAN) |
| Port | — (WS upstream) | 22 (SSH) / 5900 (VNC), bisa beda |
| Kredensial | tak ada | username + password/**SSH key** |

Jembatannya: **identitas monitoring → target remote**. Device di scene sudah punya identitas (`pin.ip`); config remote memetakan identitas itu ke `{host, port, user, auth}`.

---

## 3. Model config (default + override), server-side

Contoh file server-side (mis. `twinscape/remotes.json` — **tak** disajikan ke browser, sama seperti `locations.json`):

```json
{
  "defaults": {
    "ssh": { "port": 22, "username": "admin", "auth": "key" }
  },
  "devices": {
    "10.10.1.50": {
      "label": "Server Rak A",
      "ssh": { "host": "192.168.9.50", "username": "root" }
    },
    "10.10.1.51": {
      "ssh": { "host": "192.168.9.51" }
    }
  }
}
```

- **key** = identitas monitoring (`pin.ip`). Nilai = target remote NYATA.
- Field yang tak diisi → ambil dari `defaults` (device `.51` pakai port 22 + user `admin`).
- **Password/SSH key TIDAK ditaruh plaintext di sini.** Di-resolve server-side: SSH key di server, atau env/secrets vault, atau prompt per-sesi.
- Device yang **tak** ada di `devices` (dan tak ada default host) → dianggap **tidak remotable** → tak muncul tombol remote.
- **Grouping** (mengelompokkan default per tipe/lokasi) = perbaikan belakangan; struktur ini sudah cukup untuk mulai.

---

## 4. Fase

### Fase 0 — sekarang
Monitoring only. Belum ada remote.

### Fase 1 — MVP: SSH ke SATU device (buktikan bridge jalan)  · M
- Bridge WS↔SSH sederhana di server (`ssh2`).
- Terminal `xterm.js` di panel web.
- Config manual untuk **1 device** (host/port/user + key/pass dari env).
- **Diakses dari jaringan lokal.** Tujuan: konek, ketik, dapat shell. Titik.
- *Acceptance:* buka Twinscape (lokal) → device uji → "Open SSH" → shell hidup, bisa jalankan perintah.

### Fase 2 — SSH beneran dipakai  · ✅ SUDAH DIBANGUN (2026-07-14)
- `twinscape/remotes.json` (default + override, key = IP monitoring) **+ kapabilitas** `ssh`/`vnc` per device. Absen → fallback mode env (Fase 1).
- WS **`/ssh?device=<ip>`** → target/kredensial di-resolve **server-side** (`resolveSSH`). `/api/remote` kirim **peta kapabilitas** (boolean ssh/vnc + label), **tanpa** host/kredensial (diverifikasi tak bocor).
- Panel detail device: tombol **Open SSH** (aktif kalau `ssh`), **Open VNC** (tampil-nonaktif "menyusul" kalau `vnc`) — hanya muncul sesuai kapabilitas. Device tak terdaftar = tak ada tombol.
- Terminal **multi-tab** (banyak sesi paralel; tiap tab titik status kuning/hijau/merah; ✕ per tab).
- E2E lolos: peta kapabilitas benar, resolve per-device, device asing ditolak, host/cred tak bocor, Fase 1 (env) tetap jalan.
- **Cara pakai:** `cp twinscape/remotes.example.json twinscape/remotes.json` → isi map **IP-monitoring → target SSH asli** (lihat §3). `remotes.json` gitignored (berisi host/username internal). Kredensial: default env `REMOTE_SSH_PASSWORD`/`REMOTE_SSH_KEY_FILE`; per-device override `keyFile`/`passwordEnv`.
- **Sisa kecil:** tombol remote baru di viewer **3D**; belum di panel detail **2D** (floormap) — follow-up ringan.

### Fase 3 — VNC (desktop)  · ✅ SUDAH DIBANGUN (2026-07-14)
- **Server = pipa MENTAH WS↔TCP** (`/vnc?device=<ip>`, pakai `net`). Tak perlu library VNC — noVNC (browser) yang bicara RFB; server cuma teruskan byte. Target dari `remotes.json` blok `vnc:{host,port}`.
- **noVNC** di-vendor offline (`twinscape/public/vendor/novnc/` — **core/ + vendor/pako** dua-duanya wajib; pako = zlib yang di-import core). Import **DINAMIS** di `openVNC` → kegagalan noVNC tak mematikan SSH/tombol.
- Panel remote jadi `remote-panel.js` (module): **SSH (xterm) + VNC (noVNC) dalam multi-tab yang sama**. Tombol **Open VNC** (ungu) muncul kalau device punya blok `vnc`.
- **`vnc.startCommand` (opsional):** server jalankan perintah (mis. `x11vnc …`) **via SSH** dulu → jeda `startDelayMs` → baru buka pipa VNC. Otomatiskan alur "SSH → x11vnc → buka VNC" jadi satu klik. Tanpa `-bg` → x11vnc mati saat sesi ditutup. Terverifikasi (exec→delay→pipe).
- **Password VNC:** kalau server VNC minta, **noVNC prompt** (user ketik per-sesi, tak disimpan). Injeksi password VNC server-side = Fase 4.
- `REMOTES_FILE` env (opsional) → taruh `remotes.json` di luar repo.
- E2E lolos: passthrough byte dua arah, kapabilitas vnc benar, device tanpa vnc ditolak. SSH (Fase 1/2) tanpa regresi.
- **Prasyarat pakai:** device tujuan harus menjalankan **server VNC** (port 5900 dst). 2D floormap tetap belum (ditunda).

### Fase 4 — Keamanan serius (sebelum boleh dibuka ke luar)  · sebagian ✅

**✅ SUDAH DIBANGUN (app-code) — RBAC + Audit:**
- **RBAC** (opt-in): `remotes.json` → blok `roles` + `group` per device; user punya `role` di `users.json` (`node twinscape/adduser.js <user> <pass> --role <role>`). `roles: {admin:{remote:"*"}, operator:{remote:["group:injection","<ip>"]}, viewer:{remote:[]}}`. **Default-deny** (role tak dikenal/kosong → tolak). Tanpa blok `roles` → RBAC **nonaktif** (perilaku Fase 3, tak merusak setup lama).
- **Enforcement 2 lapis**: `/api/remote` **menyaring** device per role (tombol ikut hilang) **+** WS `/ssh`/`/vnc` **menolak** device di luar izin (gerbang sebenarnya, walau tombol disembunyikan). Verified admin=semua / operator=grup / viewer=none.
- **Audit log** (selalu aktif): `twinscape/logs/remote-audit.log` (JSON per baris) — `{ts,user,role,action:ssh|vnc,device,event:open|close|denied,durationMs}`. Path via env `AUDIT_FILE`.
- Env baru: `USERS_FILE`, `REMOTES_FILE`, `AUDIT_FILE` (taruh di luar repo), `REMOTE_DEFAULT_ROLE` (default `viewer`).

**⏳ Sisa (infra/keputusanmu — belum dibangun):**
- **Kredensial** ✅ (keputusan: **semua di remotes.json**, `.env` cukup `REMOTE_ENABLE=1`): auth SSH per-device/`defaults` — urutan `keyFile` > `password` (langsung) > `passwordEnv`. **Catatan jujur:** password di remotes.json = plaintext, TAPI file gitignored + chmod → **sama amannya dengan `.env`**, cuma satu tempat & simpel untuk banyak device (password sekali di `defaults`, device baru cukup host+label+group). Hash TAK bisa (satu-arah — server perlu password asli untuk login). `keyFile` tetap opsi per-device paling aman. Enkripsi-dengan-master-key = "nanti" kalau perlu.
- **Gerbang depan**: pilihanmu — **Tailscale/WireGuard** (rekomendasi, tak butuh Cloudflare), CF Access, reverse-proxy SSO, atau MFA di app. Belum diputuskan.
- Setelah kredensial-key + gerbang depan siap → **baru aman aktifkan remote lewat domain (online)**.

### Fase 5 — Level tertinggi: lintas-jaringan / multi-site  · L
Untuk device di jaringan yang **server pusat tak bisa jangkau** (subnet/site lain) → **agent/bridge kecil di jaringan itu** yang "dial home" ke server pusat. Baru di sini "remote di mana saja, device di mana saja" benar-benar lengkap.

---

## 5. "Remote online" — bisa atau tidak? (untuk pengetahuan)

**Kabar baik: online sebenarnya hampir gratis** dengan topologi sekarang. Cloudflare Tunnel sudah membuktikan server **reachable dari mana saja**. Bridge SSH berjalan **di server** (yang ada di LAN) → dari luar jaringan pun, browser cukup nyambung ke server lewat tunnel, dan **server** yang buka SSH ke device. Jadi remote dari luar **secara teknis jalan** begitu bridge ada.

**Lalu kenapa "lokal dulu"?** Karena **keamanan**, bukan keterbatasan teknis: membuka gerbang SSH lewat tunnel publik **sebelum ada RBAC + audit + kredensial aman (Fase 4)** = berisiko. Jadi:

- **Fase 1–3 dites & dipakai di jaringan lokal** (server bind lokal untuk endpoint remote, atau tak diekspos ke domain dulu).
- **Aktifkan online setelah Fase 4.**

**Yang benar-benar TIDAK gratis** (batas teknis nyata): device yang berada di jaringan **yang server Twinscape sendiri tak bisa jangkau** (site/subnet lain). Tunnel menghubungkan *browser→server*, bukan *server→device* di jaringan asing. Itu butuh **agent di jaringan device** (Fase 5).

Ringkas:
| Kasus | Bisa? | Butuh |
|---|---|---|
| Browser di LAN → device di LAN sama | ✅ | bridge di server (Fase 1) |
| Browser di luar → device di LAN server | ✅ *teknis* | bridge + tunnel (sudah ada). **Tunda sampai Fase 4 demi keamanan** |
| Browser di mana saja → device di jaringan LAIN | ⛔ (belum) | agent per-site (Fase 5) |

---

## 6. Fase 1 — ✅ SUDAH DIBANGUN (2026-07-14)

Bridge `WS /ssh` di `twinscape/server.js` (`ssh2`) + terminal `xterm.js` (`twinscape/public/js/ssh-term.js`, xterm di-vendor offline). Tombol **"Open SSH"** muncul di panel detail device (3D) **hanya kalau remote aktif**. Login-gate + I/O dua arah + resize sudah terverifikasi end-to-end.

**Aktifkan (env — kredensial/target SERVER-SIDE, terpisah dari IP monitoring):**

| Env | Arti |
|---|---|
| `REMOTE_ENABLE=1` | wajib — kalau tak diset, fitur OFF (tombol tak muncul, `/ssh` ditolak) |
| `REMOTE_SSH_HOST` | **host SSH sebenarnya** (bukan IP monitoring) |
| `REMOTE_SSH_PORT` | default `22` |
| `REMOTE_SSH_USER` | username SSH |
| `REMOTE_SSH_PASSWORD` | password, **atau** ↓ |
| `REMOTE_SSH_KEY_FILE` (+ `REMOTE_SSH_PASSPHRASE`) | path private key di server (disarankan) |

**Coba lokal (1 device):**
```bash
REMOTE_ENABLE=1 REMOTE_SSH_HOST=<ip-ssh> REMOTE_SSH_USER=<user> \
REMOTE_SSH_PASSWORD=<pass> npm start
# buka http://localhost:10102 (lokal) → klik device → "Open SSH" → shell
```

⚠️ **Jangan set `REMOTE_ENABLE=1` di produksi (lewat tunnel) dulu** — tunggu Fase 4 (RBAC + audit). MVP ini untuk dites di **jaringan lokal**.

**Batas MVP (sengaja):** 1 target dari env (belum per-device `remotes.json` — itu Fase 2); tombol muncul di semua device (targetnya sama); belum ada RBAC.
```
