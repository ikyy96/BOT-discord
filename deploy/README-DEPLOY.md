# 🚀 Panduan Deploy IKYYBOT ke VPS

Panduan lengkap menaikkan bot ini (Discord Music Bot: discord.js + DisTube + yt-dlp)
ke VPS Linux agar jalan 24/7 dan otomatis restart kalau crash.

---

## 0. Sebelum Mulai (WAJIB)

1. **Reset token bot** (token lama sudah pernah bocor).
   Discord Developer Portal → pilih aplikasi → **Bot** → **Reset Token** → simpan.
2. **Aktifkan Message Content Intent** (bot ini pakai perintah prefix `!`).
   Discord Developer Portal → **Bot** → **Privileged Gateway Intents** →
   aktifkan **MESSAGE CONTENT INTENT** → Save.
3. Pastikan bot sudah di-invite ke server kamu (scope `bot` + permission voice).

---

## 1. Metode A — Otomatis (paling mudah, Ubuntu/Debian & RHEL-family)

Upload/clone folder project ini ke VPS, lalu jalankan:

```bash
cd "bot discord"          # folder project
sudo bash deploy/setup-vps.sh
```

Script akan otomatis:
- install **Node.js 22 LTS** + **ffmpeg**,
- copy project ke `/opt/ikyybot`,
- `npm ci` (dependency Linux),
- menyiapkan `.env` (menanyakan token bila belum ada),
- membuat systemd service `ikyybot` yang auto-start & auto-restart.

Cek status:
```bash
systemctl status ikyybot
journalctl -u ikyybot -f
```

---

## 2. Metode B — Manual (systemd)

Cocok kalau mau kontrol penuh. Contoh di Ubuntu, instal di `/opt/ikyybot`.

```bash
# 1) Dependensi sistem
sudo apt update
sudo apt install -y curl ffmpeg rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # harus >= v20

# 2) Pindahkan project
sudo mkdir -p /opt/ikyybot
sudo rsync -a --exclude node_modules --exclude .env --exclude '*-player-script.js' \
  ./ /opt/ikyybot/

# 3) Install dependency
cd /opt/ikyybot
sudo npm ci --omit=dev

# 4) Konfigurasi token
sudo cp .env.example .env
sudo nano .env          # isi DISCORD_TOKEN=...
sudo chmod 600 .env
```

Pasang service (ganti path/user bila perlu):

```bash
sudo cp deploy/ikyybot.service /etc/systemd/system/ikyybot.service
sudo sed -i 's|__USER__|root|g; s|__APP_DIR__|/opt/ikyybot|g' /etc/systemd/system/ikyybot.service
sudo systemctl daemon-reload
sudo systemctl enable --now ikyybot
sudo journalctl -u ikyybot -f
```

> Ganti `root` dengan user biasa (mis. `ubuntu`) lebih aman. Kalau pakai user biasa,
> pastikan `/opt/ikyybot` (termasuk `node_modules`) dimiliki user tersebut:
> `sudo chown -R <user>:<user> /opt/ikyybot`.

---

## 3. Metode C — PM2 (alternatif systemd)

```bash
sudo npm i -g pm2
cd /opt/ikyybot
pm2 start ecosystem.config.js
pm2 logs ikyybot          # lihat log
pm2 save                  # simpan daftar proses
pm2 startup               # ikuti perintah yang muncul agar otomatis start saat boot
```

Perintah PM2 berguna:
```bash
pm2 restart ikyybot
pm2 stop ikyybot
pm2 delete ikyybot
```

---

## 4. Metode D — Docker (OS VPS apa saja)

Butuh Docker + Docker Compose.

```bash
cp .env.example .env
nano .env                 # isi DISCORD_TOKEN
docker compose up -d --build
docker compose logs -f
```

Stop / update:
```bash
docker compose down
docker compose up -d --build
```

> Image sudah terpasang **ffmpeg** dan di-set `FFMPEG_PATH=/usr/bin/ffmpeg`.

---

## 5. Konfigurasi `.env`

| Variabel       | Wajib | Default        | Keterangan |
|----------------|-------|----------------|------------|
| `DISCORD_TOKEN`| ✅    | –              | Token bot dari Developer Portal |
| `PREFIX`       | ➖    | `!`            | Prefix perintah chat |
| `FFMPEG_PATH`  | ➖    | `ffmpeg-static`| Isi `/usr/bin/ffmpeg` untuk pakai ffmpeg sistem |
| `NODE_ENV`     | ➖    | –              | Set `production` |

---

## 6. Hal Penting yang Perlu Diketahui

- **yt-dlp otomatis**: plugin `@distube/yt-dlp` v2 mengunduh sendiri binary yt-dlp
  sesuai OS ke `node_modules/@distube/yt-dlp/bin`. Pastikan VPS punya internet dan
  folder itu **bisa ditulis** oleh user service.
- **Update yt-dlp**: setiap restart bot akan mengambil yt-dlp versi terbaru —
  bagus untuk mengatasi perubahan YouTube. Cukup `systemctl restart ikyybot`.
- **ffmpeg**: wajib ada. Pakai sistem (`apt install ffmpeg`) atau `ffmpeg-static`
  (otomatis terpasang lewat `npm ci`).
- **Voice**: `opusscript` (pure JS) dipakai, jadi tidak perlu build native.
- **File sampah**: `*-player-script.js` (2,5 MB × banyak) adalah artefak unduhan,
  aman dihapus & sudah masuk `.gitignore`:
  `rm -f *-player-script.js`
- **File Windows-only**: `yt-dlp.bat` hanya untuk Windows, tidak dipakai di Linux.

---

## 7. Update Bot di VPS

```bash
cd /opt/ikyybot
sudo -u ikyybot git pull            # atau rsync/ganti file manual
sudo -u ikyybot npm ci --omit=dev
sudo systemctl restart ikyybot
```

---

## 8. Troubleshooting

| Gejala | Penyebab & Solusi |
|--------|-------------------|
| `DISCORD_TOKEN tidak ditemukan` | `.env` belum diisi / salah lokasi. Pastikan `EnvironmentFile` benar. |
| Bot online tapi `!play` diam | **Message Content Intent** belum aktif di Developer Portal. |
| `SIGILL` / error `@discordjs/opus` | Jangan pakai `@discordjs/opus`; project ini pakai `opusscript` (sudah aman). |
| Suara tidak keluar | Pastikan `ffmpeg` terinstall / `FFMPEG_PATH` benar. |
| yt-dlp gagal / 403 | Restart service (yt-dlp auto-update), atau update: `systemctl restart ikyybot`. |
| Bot mati terus | Lihat `journalctl -u ikyybot -n 100` untuk pesan error. |
| Token pernah bocor | **Reset token** di Developer Portal, lalu update `.env` dan restart. |
