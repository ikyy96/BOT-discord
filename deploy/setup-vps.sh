#!/usr/bin/env bash
# =====================================================================
#  IKYYBOT - Installer otomatis untuk VPS Linux (Ubuntu/Debian/CentOS)
#  Cara pakai (dari folder project ini, di dalam VPS):
#       sudo bash deploy/setup-vps.sh
#  Yang dilakukan script:
#    1. Install Node.js 22 LTS + ffmpeg
#    2. Copy project ke /opt/ikyybot (tanpa node_modules)
#    3. npm ci (install dependency Linux)
#    4. Siapkan file .env
#    5. Pasang & jalankan systemd service (auto restart + auto start saat boot)
# =====================================================================
set -euo pipefail

APP_NAME="ikyybot"
APP_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
RUN_USER="${APP_NAME}"
NODE_MAJOR="22"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Jalankan sebagai root:  sudo bash deploy/setup-vps.sh"
[ -f "${SRC_DIR}/index.js" ] || die "index.js tidak ditemukan. Jalankan script dari dalam folder project."

# ---------------------------------------------------------------------
# 1. Deteksi distro + install paket dasar
# ---------------------------------------------------------------------
log "Mendeteksi sistem operasi..."
if command -v apt-get >/dev/null 2>&1; then
  PKG="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG="yum"
else
  die "Distro tidak dikenali (tidak ada apt/dnf/yum)."
fi
log "Package manager: ${PKG}"

install_pkgs() {
  case "$PKG" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get update -y \
         && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
  esac
}

log "Menginstall paket dasar (curl, ca-certificates, ffmpeg, rsync)..."
install_pkgs curl ca-certificates ffmpeg rsync

# ---------------------------------------------------------------------
# 2. Install Node.js (kalau belum >= 20)
# ---------------------------------------------------------------------
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$CUR_MAJOR" -ge 20 ] 2>/dev/null; then
    NEED_NODE=0
    log "Node.js $(node -v) sudah terinstall, dilewati."
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  log "Menginstall Node.js ${NODE_MAJOR} LTS..."
  case "$PKG" in
    apt)       curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
               install_pkgs nodejs ;;
    dnf|yum)   curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
               install_pkgs nodejs ;;
  esac
fi
command -v node >/dev/null 2>&1 || die "Instalasi Node.js gagal."
log "Node.js: $(node -v) | npm: $(npm -v)"

# ---------------------------------------------------------------------
# 3. Buat user sistem khusus
# ---------------------------------------------------------------------
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  log "Membuat user sistem '${RUN_USER}'..."
  NOLOGIN="/usr/sbin/nologin"
  [ -x "$NOLOGIN" ] || NOLOGIN="/sbin/nologin"
  [ -x "$NOLOGIN" ] || NOLOGIN="/bin/false"
  useradd --system --create-home --shell "$NOLOGIN" "$RUN_USER"
fi

# ---------------------------------------------------------------------
# 4. Copy project ke ${APP_DIR} (tanpa node_modules / .env / sampah)
# ---------------------------------------------------------------------
log "Menyalin project ke ${APP_DIR} ..."
install -d -o "$RUN_USER" -g "$RUN_USER" "$APP_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude 'logs' \
    --exclude '.env' --exclude '*-player-script.js' \
    "$SRC_DIR"/ "$APP_DIR"/
else
  cp -a "$SRC_DIR"/. "$APP_DIR"/
  rm -rf "$APP_DIR/node_modules" "$APP_DIR/.git" "$APP_DIR/.env"
fi
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"

# ---------------------------------------------------------------------
# 5. Install dependency (Linux)
# ---------------------------------------------------------------------
log "Menginstall dependency npm (npm ci)..."
sudo -u "$RUN_USER" -H bash -lc "cd '${APP_DIR}' && npm ci --omit=dev"

# Folder bin yt-dlp harus bisa ditulis plugin saat runtime (auto-download binary)
install -d -o "$RUN_USER" -g "$RUN_USER" "$APP_DIR/node_modules/@distube/yt-dlp/bin" 2>/dev/null || true

# Ingatkan bila yt-dlp belum tersedia (unduhan dari GitHub sering diblokir di VPS).
if [ ! -x "${APP_DIR}/node_modules/@distube/yt-dlp/bin/yt-dlp" ] && ! command -v yt-dlp >/dev/null 2>&1; then
  warn "yt-dlp belum tersedia. Bila unduhan dari GitHub gagal, install manual:"
  warn "  apt install -y python3-pip && pip3 install -U yt-dlp"
fi

# ---------------------------------------------------------------------
# 5b. Aktifkan JavaScript runtime untuk YouTube (wajib sejak yt-dlp 2025.11.12)
# ---------------------------------------------------------------------
YTDLP_HOME="$(sudo -u "$RUN_USER" -H bash -lc 'echo $HOME' 2>/dev/null || true)"
YTDLP_CONF_DIR="${YTDLP_HOME}/.config/yt-dlp"
if [ -n "${YTDLP_HOME}" ] && [ ! -f "${YTDLP_CONF_DIR}/config" ]; then
  log "Mengaktifkan JavaScript runtime Node untuk yt-dlp (${YTDLP_CONF_DIR}/config)..."
  install -d -o "$RUN_USER" -g "$RUN_USER" "${YTDLP_CONF_DIR}"
  printf -- '--js-runtimes node\n' > "${YTDLP_CONF_DIR}/config"
  chown "$RUN_USER":"$RUN_USER" "${YTDLP_CONF_DIR}/config"
fi

# ---------------------------------------------------------------------
# 6. Siapkan .env
# ---------------------------------------------------------------------
# Cek apakah sebuah file .env sudah punya DISCORD_TOKEN yang terisi &
# bukan token contoh (placeholder).
env_token_ok() {
  [ -f "$1" ] || return 1
  local tok
  tok="$(sed -n 's/^DISCORD_TOKEN=//p' "$1" | head -n1)"
  [ -n "${tok}" ] || return 1
  case "${tok}" in
    *isi_token_bot_discord_kamu_di_sini*) return 1 ;;
  esac
  return 0
}

if [ ! -f "${APP_DIR}/.env" ]; then
  if env_token_ok "${SRC_DIR}/.env"; then
    log "Menyalin .env dari project..."
    cp "${SRC_DIR}/.env" "${APP_DIR}/.env"
  else
    if [ -f "${SRC_DIR}/.env" ]; then
      warn "Token di .env project kosong / masih placeholder -> akan menanyakan token baru."
    fi
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
    printf '\n'
    read -rp "Masukkan DISCORD_TOKEN bot kamu: " TOKEN_INPUT
    [ -n "${TOKEN_INPUT}" ] || die "DISCORD_TOKEN tidak boleh kosong."
    sed -i "s|^DISCORD_TOKEN=.*|DISCORD_TOKEN=${TOKEN_INPUT}|" "${APP_DIR}/.env"
  fi
  chown "$RUN_USER":"$RUN_USER" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
else
  log ".env sudah ada, tidak diubah."
fi

if ! env_token_ok "${APP_DIR}/.env"; then
  warn "PERINGATAN: DISCORD_TOKEN di ${APP_DIR}/.env masih kosong/placeholder!"
fi

# ---------------------------------------------------------------------
# 7. Pasang systemd service
# ---------------------------------------------------------------------
log "Memasang systemd service..."
sed -e "s|__USER__|${RUN_USER}|g" \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    "${APP_DIR}/deploy/ikyybot.service" > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"

sleep 3
systemctl --no-pager --full status "${SERVICE_NAME}" || true

# ---------------------------------------------------------------------
# 8. Verifikasi token ke Discord (agar tahu bot benar-benar bisa online)
# ---------------------------------------------------------------------
log "Memverifikasi token bot ke Discord (maks 40 detik)..."
if sudo -u "$RUN_USER" -H bash -lc "cd '${APP_DIR}' && timeout 40 node deploy/verify-token.js"; then
  log "Token VALID — bot seharusnya sudah online. Cek di Discord atau: journalctl -u ${SERVICE_NAME} -f"
else
  warn "Verifikasi token GAGAL — bot TIDAK akan online sampai token diperbaiki."
  warn " 1) Reset token : https://discord.com/developers/applications -> Bot -> Reset Token"
  warn " 2) Update      : sudo nano ${APP_DIR}/.env   (isi DISCORD_TOKEN yang baru)"
  warn " 3) Restart     : systemctl restart ${SERVICE_NAME}"
  warn " Pesan error detail: journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
fi

# Cek log service: kalau ada TokenInvalid, beri tahu jelas.
if journalctl -u "${SERVICE_NAME}" --no-pager -n 100 2>/dev/null | grep -q 'TokenInvalid'; then
  warn "Log service menunjukkan 'TokenInvalid' -> DISCORD_TOKEN di ${APP_DIR}/.env salah/kedaluwarsa."
fi

# ---------------------------------------------------------------------
# 9. Verifikasi pencarian lagu (yt-dlp + JavaScript runtime)
# ---------------------------------------------------------------------
log "Menguji pencarian lagu (maks 120 detik)..."
if sudo -u "$RUN_USER" -H bash -lc "cd '${APP_DIR}' && timeout 120 npm run verify-search"; then
  log "Pencarian lagu OK - '!play <judul>' seharusnya sudah bisa dipakai."
else
  warn "Pencarian lagu GAGAL - jalankan diagnosa: cd ${APP_DIR} && npm run doctor"
  warn "  Penyebab umum: GitHub diblokir (binary yt-dlp tidak ada) atau YouTube minta cookies."
fi

printf '\n\033[1;32m[setup] Selesai!\033[0m\n'
printf '  Status  : systemctl status %s\n'  "$SERVICE_NAME"
printf '  Log live: journalctl -u %s -f\n'  "$SERVICE_NAME"
printf '  Restart : systemctl restart %s\n' "$SERVICE_NAME"
printf '  Stop    : systemctl stop %s\n'    "$SERVICE_NAME"
printf '  Update  : cd %s && git pull && npm ci --omit=dev && systemctl restart %s\n' "$APP_DIR" "$SERVICE_NAME"
