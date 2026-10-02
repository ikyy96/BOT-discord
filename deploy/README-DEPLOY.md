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
- menyiapkan `.env` (menanyakan token bila belum ada / masih placeholder),
- membuat systemd service `ikyybot` yang auto-start & auto-restart,
- **memverifikasi token ke Discord** di akhir proses (memberi tahu kalau token salah).

Cek status:
```bash
systemctl status ikyybot
journalctl -u ikyybot -f
```

> ⚠️ **Penting:** installer hanya menyalin `.env` dari folder project kalau isinya bukan
> placeholder. Kalau token di `.env` sudah **kedaluwarsa/di-reset** (formatnya benar tapi
> ditolak Discord), installer akan melaporkan **verifikasi token GAGAL** walau service
> berstatus `active`. Perbaiki langsung di VPS:
> ```bash
> sudo nano /opt/ikyybot/.env      # isi DISCORD_TOKEN yang baru
> sudo systemctl restart ikyybot
> journalctl -u ikyybot -f
> ```
> Cek token kapan saja tanpa menjalankan bot: `cd /opt/ikyybot && npm run verify-token`

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
| `YTDLP_SEARCH_PREFIX` | ➖ | `ytsearch1:` | Awalan pencarian yt-dlp untuk `!play <judul>` |
| `YTDLP_JS_RUNTIME` | ➖ | `node`      | JavaScript runtime untuk YouTube (wajib sejak yt-dlp 2025.11.12) |
| `YTDLP_COOKIES` | ➖   | –              | Path `cookies.txt` bila YouTube minta verifikasi ("not a bot") |
| `YTDLP_EXTRACTOR_ARGS` | ➖ | –         | Argumen ekstraktor, mis. `youtube:player_client=web_safari` |
| `YTDLP_FORMAT` | ➖    | `ba/ba*`       | Format audio untuk streaming |

### Cek token (paling sering jadi sebab bot offline)

```bash
npm run verify-token      # atau: node deploy/verify-token.js
```

Script ini memeriksa format token + login sungguhan ke Discord, **tanpa** menjalankan bot.
Kalau muncul `TokenInvalid`, token harus di-reset di Developer Portal lalu diperbarui di `.env`.

### Cek pencarian lagu (`!play <judul>`)

```bash
npm run verify-search                 # uji kata kunci "hindia"
npm run verify-search -- "no doubt"   # uji kata kunci lain
npm run doctor                        # diagnosa lengkap (yt-dlp, JS runtime, ffmpeg)
```

`verify-search` menjalankan rantai cari → ambil link audio (persis yang dipakai bot), tanpa Discord.
`doctor` membandingkan yt-dlp **tanpa vs dengan** JavaScript runtime dan menyimpulkan penyebabnya.

> ⚠️ **JavaScript runtime = syarat wajib sekarang.** Sejak yt-dlp **2025.11.12**,
> YouTube memerlukan runtime JS eksternal (Deno default; **Node** harus diaktifkan dengan
> `--js-runtimes node`). Tanpa itu, bot bisa gagal saat `!play` (`YTDLP_ERROR`).
> Bot ini menanganinya otomatis: `ytdlp-setup.js` menulis `~/.config/yt-dlp/config`
> berisi `--js-runtimes node` (hanya kalau file itu belum ada) dan memakai Node yang
> menjalankan bot. Matikan dengan `YTDLP_SKIP_USER_CONFIG=1` bila tidak diinginkan.

---

## 6. Hal Penting yang Perlu Diketahui

- **yt-dlp otomatis**: plugin `@distube/yt-dlp` v2 mengunduh sendiri binary yt-dlp
  sesuai OS ke `node_modules/@distube/yt-dlp/bin`. Pastikan VPS punya internet dan
  folder itu **bisa ditulis** oleh user service.
- **Pencarian kata kunci**: `ytdlp-search.js` menambal kekurangan plugin
  `@distube/yt-dlp` v2 (tidak punya `searchSong` & bertipe `playable-extractor`),
  supaya `!play <judul>` bisa jalan — bukan hanya `!play <link>`.
- **JavaScript runtime (wajib)**: sejak yt-dlp 2025.11.12 YouTube butuh runtime JS.
  `ytdlp-setup.js` mengaktifkan **Node** (`--js-runtimes node`) dan menulis
  `~/.config/yt-dlp/config` bila belum ada. Alternatif: install **Deno** (aktif default).
- **yt-dlp sistem**: kalau binary bawaan plugin gagal diunduh dari GitHub (umum di VPS),
  bot otomatis memakai `yt-dlp` sistem (`/usr/local/bin/yt-dlp`, `/usr/bin/yt-dlp`, ...)
  dengan menyalinnya ke `./.ytdlp/`. Cara install:
  `sudo apt install python3-pip && sudo pip3 install -U yt-dlp`
- **Cookies YouTube**: kalau IP VPS ditandai bot ("Sign in to confirm you're not a bot"),
  export `cookies.txt` dari browser yang sudah login, taruh di folder bot, lalu set
  `YTDLP_COOKIES=/path/cookies.txt` di `.env`.
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
| **Service `active` tapi bot tidak online** | Token ditolak Discord, bukan crash. Jalankan `npm run verify-token`. Kalau muncul `TokenInvalid`, reset token & update `.env`, lalu `systemctl restart ikyybot`. |
| `DisTubeError [NO_RESULT]` saat `!play <judul>` | Sudah diperbaiki oleh `ytdlp-search.js`. Penyebabnya: `@distube/yt-dlp` v2 tidak punya `searchSong` **dan** bertipe `playable-extractor`, sedangkan DisTube hanya mencari via plugin bertipe `extractor`. Pastikan `ytdlp-search.js` ikut ter-deploy dan `index.js` memakai `enableSearch(...)`. Uji tanpa Discord: `npm run verify-search`. |
| Pesan bot `❌ yt-dlp gagal mengambil lagu ini` (`YTDLP_ERROR`) | yt-dlp gagal di sisi YouTube/binary. Jalankan **`npm run doctor`** — hasilnya menyimpulkan penyebab (JS runtime / binary hilang / cookies / versi tua). Lihat juga stderr di `journalctl -u ikyybot -n 50`. |
| `WARNING: No supported JavaScript runtime could be found` | YouTube butuh runtime JS (yt-dlp ≥ 2025.11.12). Pastikan `~/.config/yt-dlp/config` berisi `--js-runtimes node` (bot menulisnya otomatis) atau set `YTDLP_JS_RUNTIME=node` di `.env`. |
| `Sign in to confirm you're not a bot` / 403 dari VPS | IP VPS ditandai bot oleh YouTube. Export `cookies.txt` dari browser yang login, lalu set `YTDLP_COOKIES=/path/cookies.txt` di `.env` dan restart service. |
| `spawn ... ENOENT` / binary yt-dlp hilang | Plugin gagal unduh dari GitHub (diblokir/rate-limit). Bot akan pakai `yt-dlp` sistem kalau ada: `sudo apt install python3-pip && sudo pip3 install -U yt-dlp`. |
| `!play <link>` jalan tetapi `!play <judul>` gagal | Biasanya JS runtime/cookies. Cek dengan `npm run doctor`, lalu ikuti kesimpulannya. |
| `!play` jalan tapi tidak ada suara | ffmpeg belum terpasang / `FFMPEG_PATH` salah, atau bot tidak punya izin `Speak` di voice channel. |
| `TokenInvalid: An invalid token was provided` | Token di `.env` sudah di-**reset**/kedaluwarsa/salah copy. Reset di Developer Portal → **Bot → Reset Token**, update `DISCORD_TOKEN` di `.env`, lalu `systemctl restart ikyybot`. |
| Token format terlihat benar (3 bagian) tapi tetap invalid | Token **lama** yang sudah di-reset. Format token lama & baru sama, jadi wajib pakai token terbaru dari portal. |
| `DISCORD_TOKEN tidak ditemukan` | `.env` belum diisi / salah lokasi. Pastikan `EnvironmentFile` benar. |
| Bot online tapi `!play` diam | **Message Content Intent** belum aktif di Developer Portal. |
| `SIGILL` / error `@discordjs/opus` | Jangan pakai `@discordjs/opus`; project ini pakai `opusscript` (sudah aman). |
| Suara tidak keluar | Pastikan `ffmpeg` terinstall / `FFMPEG_PATH` benar. |
| yt-dlp gagal / 403 | Restart service (yt-dlp auto-update), atau update: `systemctl restart ikyybot`. |
| Bot mati terus | Lihat `journalctl -u ikyybot -n 100` untuk pesan error. |
| Token pernah bocor | **Reset token** di Developer Portal, lalu update `.env` dan restart. |
