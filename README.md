# 🤖 IKYYBOT — Discord Music Bot

Bot musik Discord sederhana: putar lagu dari YouTube/URL di voice channel
(discord.js v14 + DisTube v5 + yt-dlp + ffmpeg).

## Perintah
| Perintah | Fungsi |
|----------|--------|
| `!play <judul / link>` | Putar lagu / tambah ke antrean |
| `!skip` | Lewati lagu |
| `!stop` | Hentikan musik & hapus antrean |
| `!help` | Tampilkan bantuan |

## Menjalankan Lokal
```bash
npm install
cp .env.example .env      # lalu isi DISCORD_TOKEN
npm start
```

## Deploy ke VPS
Panduan lengkap (systemd / PM2 / Docker, otomatis maupun manual):
👉 **[deploy/README-DEPLOY.md](deploy/README-DEPLOY.md)**

Cara tercepat (VPS Ubuntu/Debian, sebagai root):
```bash
sudo bash deploy/setup-vps.sh
```

## Struktur File Penting
| File | Keterangan |
|------|------------|
| `index.js` | Kode utama bot |
| `ytdlp-search.js` | Tambalan pencarian kata kunci `!play <judul>` untuk plugin `@distube/yt-dlp` v2 |
| `.env` | Konfigurasi rahasia (token) — jangan di-commit |
| `.env.example` | Template konfigurasi |
| `Dockerfile`, `docker-compose.yml` | Deploy via Docker |
| `ecosystem.config.js` | Deploy via PM2 |
| `deploy/setup-vps.sh` | Installer otomatis VPS |
| `deploy/verify-token.js` | Cek token bot via `npm run verify-token` |
| `deploy/verify-search.js` | Cek pencarian lagu via `npm run verify-search` |
| `deploy/ikyybot.service` | Unit systemd |
| `deploy/README-DEPLOY.md` | Dokumentasi deploy |
