// -----------------------------------------------------------------------------
// Penyiapan lingkungan yt-dlp untuk IKYYBOT.
//
// MASALAH YANG DITANGANI
//  1. Sejak yt-dlp 2025.11.12, YouTube BUTUH JavaScript runtime eksternal
//     (Deno aktif default; Node perlu diaktifkan dengan `--js-runtimes node`).
//     Tanpa runtime, resolusi format streaming gagal/terbatas -> `!play` error.
//  2. Plugin @distube/yt-dlp mengunduh binary yt-dlp dari GitHub saat start.
//     Kalau GitHub diblokir / kena rate-limit (umum di VPS), binary tidak ada
//     sehingga SEMUA pemanggilan yt-dlp gagal (spawn ENOENT).
//
// Module ini:
//  - memilih binary yt-dlp: pakai milik plugin kalau ada; kalau tidak, pakai
//    yt-dlp sistem (disalin ke ./.ytdlp supaya binary sistem tidak tertimpa),
//  - menulis konfigurasi user yt-dlp (~/.config/yt-dlp/config) berisi
//    `--js-runtimes node` bila belum ada (Linux/macOS),
//  - menyediakan flag tambahan (js runtime, cookies, extractor-args) untuk
//    pemanggilan yt-dlp milik bot.
//
// Semua opsional lewat environment:
//   YTDLP_JS_RUNTIME     default: node            (mis. node:/usr/bin)
//   YTDLP_COOKIES        path file cookies.txt    (solusi "Sign in to confirm")
//   YTDLP_EXTRACTOR_ARGS mis. youtube:player_client=web_safari
//   YTDLP_SKIP_USER_CONFIG=1  -> jangan tulis config user
// -----------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// yt-dlp >= versi ini membutuhkan JS runtime eksternal untuk YouTube.
const JS_RUNTIME_MIN_VERSION = '2025.11.12';

const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BUNDLED_DIR = path.join(__dirname, 'node_modules', '@distube', 'yt-dlp', 'bin');
const BUNDLED_PATH = path.join(BUNDLED_DIR, BIN_NAME);
const LOCAL_DIR = path.join(__dirname, '.ytdlp');
const LOCAL_PATH = path.join(LOCAL_DIR, BIN_NAME);

const SYSTEM_CANDIDATES = process.platform === 'win32'
    ? []
    : [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        '/snap/bin/yt-dlp',
        '/opt/homebrew/bin/yt-dlp',
        path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
    ];

let cachedState = null;

function log(message) {
    console.log(`[ytdlp] ${message}`);
}

// ---------- Utilitas versi ----------
function parseVersion(version) {
    return String(version || '')
        .trim()
        .split(/[.\s-]+/)
        .map((part) => Number.parseInt(part, 10))
        .map((part) => (Number.isFinite(part) ? part : 0));
}

function versionAtLeast(version, minimum) {
    if (!version) return false;
    const a = parseVersion(version);
    const b = parseVersion(minimum);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const x = a[i] || 0;
        const y = b[i] || 0;
        if (x !== y) return x > y;
    }
    return true;
}

function ytDlpVersion(binaryPath) {
    if (!binaryPath || !fs.existsSync(binaryPath)) return null;
    try {
        const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf8', timeout: 20000 });
        if (result.status === 0 && result.stdout) return String(result.stdout).trim();
    } catch {
        /* abaikan */
    }
    return null;
}

function findSystemBinary() {
    for (const candidate of SYSTEM_CANDIDATES) {
        const version = ytDlpVersion(candidate);
        if (version) return { path: candidate, version };
    }
    return null;
}

// Salin yt-dlp sistem ke folder project supaya plugin tidak menimpa yang asli.
function prepareLocalCopy(sourcePath) {
    try {
        fs.mkdirSync(LOCAL_DIR, { recursive: true });
        fs.copyFileSync(sourcePath, LOCAL_PATH);
        fs.chmodSync(LOCAL_PATH, 0o755);
        return LOCAL_PATH;
    } catch {
        return null;
    }
}

// ---------- Konfigurasi user yt-dlp ----------
function userConfigPath() {
    if (process.platform === 'win32') return null;
    const xdg = process.env.XDG_CONFIG_HOME;
    const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config');
    return path.join(base, 'yt-dlp', 'config');
}

// Tulis config default HANYA kalau belum ada (jangan ganggu config milik user).
function ensureUserConfig(jsRuntime) {
    const configPath = userConfigPath();
    if (!configPath || process.env.YTDLP_SKIP_USER_CONFIG) return { status: 'skipped', path: configPath };
    try {
        if (fs.existsSync(configPath)) return { status: 'exists', path: configPath };
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(
            configPath,
            [
                '# Dibuat otomatis oleh IKYYBOT (ytdlp-setup.js).',
                '# YouTube membutuhkan JavaScript runtime sejak yt-dlp 2025.11.12.',
                `--js-runtimes ${jsRuntime}`,
                '',
            ].join('\n'),
            { mode: 0o644 },
        );
        return { status: 'created', path: configPath };
    } catch (err) {
        return { status: 'failed', path: configPath, error: err.message };
    }
}

// ---------- Konfigurasi utama ----------
function configureYtDlp({ force = false, quiet = false } = {}) {
    if (cachedState && !force) return cachedState;

    const state = {
        binary: BUNDLED_PATH,
        source: 'bundled',
        version: null,
        jsRuntime: process.env.YTDLP_JS_RUNTIME || 'node',
        jsRuntimeSupported: false,
        config: { status: 'skipped', path: userConfigPath() },
        warnings: [],
    };

    if (fs.existsSync(BUNDLED_PATH)) {
        state.binary = BUNDLED_PATH;
        state.source = 'bundled';
        state.version = ytDlpVersion(BUNDLED_PATH);
    } else {
        const system = findSystemBinary();
        if (system) {
            const copy = prepareLocalCopy(system.path);
            const usePath = copy || system.path;
            process.env.YTDLP_DIR = path.dirname(usePath);
            process.env.YTDLP_FILENAME = path.basename(usePath);
            state.binary = usePath;
            state.source = copy ? 'system (disalin ke .ytdlp)' : 'system';
            state.version = system.version;
            state.warnings.push(`binary bawaan plugin tidak ada -> memakai yt-dlp sistem (${system.path})`);
        } else {
            state.warnings.push(
                'binary yt-dlp belum ada. Plugin akan mencoba mengunduh dari GitHub saat start; ' +
                'kalau GitHub diblokir: sudo apt install python3-pip && sudo pip3 install -U yt-dlp',
            );
        }
    }

    state.jsRuntimeSupported = versionAtLeast(state.version, JS_RUNTIME_MIN_VERSION);
    if (state.version && !state.jsRuntimeSupported) {
        state.warnings.push(
            `yt-dlp ${state.version} lebih tua dari ${JS_RUNTIME_MIN_VERSION}; dukungan YouTube bisa terbatas. ` +
            `Update: "${state.binary}" -U`,
        );
    }

    // Config user hanya perlu kalau versi sudah mendukung flag js-runtimes
    // (kalau dipaksa ke yt-dlp lama, justru error "no such option").
    if (state.jsRuntimeSupported) {
        state.config = ensureUserConfig(state.jsRuntime);
        if (state.config.status === 'created' && !quiet) {
            log(`konfigurasi yt-dlp dibuat: ${state.config.path} (--js-runtimes ${state.jsRuntime})`);
        } else if (state.config.status === 'failed' && !quiet) {
            log(`GAGAL menulis konfigurasi yt-dlp (${state.config.path}): ${state.config.error}`);
        }
    }

    cachedState = state;
    if (!quiet) {
        log(`binary: ${state.binary} | versi: ${state.version || 'tidak diketahui'} | sumber: ${state.source}`);
        for (const warning of state.warnings) log(`WARNING: ${warning}`);
    }
    return state;
}

function getYtDlpState() {
    return cachedState || configureYtDlp({ quiet: true });
}

// Flag tambahan untuk pemanggilan yt-dlp milik bot (dipakai dargs).
function ytDlpFlags() {
    const state = getYtDlpState();
    const flags = {};
    if (state.jsRuntimeSupported && state.jsRuntime) flags.jsRuntimes = state.jsRuntime;
    if (process.env.YTDLP_COOKIES) flags.cookies = process.env.YTDLP_COOKIES;
    if (process.env.YTDLP_EXTRACTOR_ARGS) flags.extractorArgs = process.env.YTDLP_EXTRACTOR_ARGS;
    return flags;
}

// Ringkasan untuk log / script doctor.
function formatYtDlpStatus(state = getYtDlpState()) {
    const lines = [
        `binary     : ${state.binary}`,
        `sumber     : ${state.source}`,
        `versi      : ${state.version || 'tidak diketahui'}`,
        `js-runtimes: ${state.jsRuntimeSupported ? state.jsRuntime + ' (dipakai)' : 'TIDAK dipakai'}`,
        `config     : ${state.config.path || '-'} (${state.config.status})`,
    ];
    if (state.config.status === 'failed') lines.push(`config err : ${state.config.error}`);
    return lines;
}

module.exports = {
    configureYtDlp,
    getYtDlpState,
    ytDlpFlags,
    formatYtDlpStatus,
    ytDlpVersion,
    versionAtLeast,
    JS_RUNTIME_MIN_VERSION,
    BUNDLED_PATH,
    LOCAL_PATH,
    userConfigPath,
};