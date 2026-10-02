// -----------------------------------------------------------------------------
// Diagnosa yt-dlp / streaming (tanpa Discord, tanpa menjalankan bot).
//
// Pakai:
//     node deploy/doctor.js
// atau:
//     npm run doctor
//
// Yang diperiksa:
//   - binary yt-dlp (ada/versi/js runtime) + konfigurasi yt-dlp
//   - ffmpeg (wajib untuk streaming)
//   - perbandingan yt-dlp TANPA vs DENGAN JavaScript runtime (--js-runtimes)
//   - kemampuan mengambil URL audio (yang dipakai bot saat memutar)
// Diakhiri kesimpulan + perintah perbaikan yang relevan.
// -----------------------------------------------------------------------------
require('dotenv').config({ quiet: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getYtDlpState, formatYtDlpStatus, BUNDLED_PATH, JS_RUNTIME_MIN_VERSION } = require('../ytdlp-setup');

const TEST_QUERY = 'ytsearch1:hindia';
const FALLBACK_VIDEO = 'https://www.youtube.com/watch?v=lB8ASupNtlw';
const TIMEOUT_MS = 120000;

function line(title) {
    console.log(`\n=== ${title} ===`);
}

function run(binary, args, timeout = TIMEOUT_MS) {
    try {
        const res = spawnSync(binary, args, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
        return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
    } catch (err) {
        return { status: null, stdout: '', stderr: '', error: err };
    }
}

function tail(text, count = 10) {
    const lines = String(text || '').trim().split(/\r?\n/).filter((l) => l.trim());
    return lines.slice(-count).join('\n');
}

function jsonTitle(stdout) {
    try {
        const data = JSON.parse(stdout);
        const entry = Array.isArray(data.entries) ? data.entries[0] : data;
        return entry && (entry.title || entry.fulltitle || entry.id) ? String(entry.title || entry.id) : null;
    } catch {
        return null;
    }
}

function hasRemoteUrl(stdout) {
    try {
        const data = JSON.parse(stdout);
        return typeof data.url === 'string' && /^https?:\/\//i.test(data.url);
    } catch {
        return false;
    }
}

function botCheckSignature(text) {
    return /sign in to confirm|not a bot|confirm you're not a bot|login required|cookies/i.test(String(text || ''));
}
function reportEnvironment() {
    line('Lingkungan');
    console.log(`platform    : ${process.platform} ${process.arch}`);
    console.log(`node        : ${process.version} (${process.execPath})`);
    console.log(`HOME        : ${os.homedir()}`);
    console.log(`cwd         : ${process.cwd()}`);

    const state = getYtDlpState();
    console.log('\nyt-dlp:');
    for (const l of formatYtDlpStatus(state)) console.log(`  ${l}`);
    console.log(`  config path      : ${state.config.path || '-'}`);
    console.log(`  binary bawaan    : ${BUNDLED_PATH} (${fs.existsSync(BUNDLED_PATH) ? 'ada' : 'TIDAK ADA'})`);

    const ffmpegSystem = run('ffmpeg', ['-version'], 20000);
    console.log(`\nffmpeg sistem : ${ffmpegSystem.status === 0 ? String(ffmpegSystem.stdout).split('\n')[0].trim() : 'TIDAK ADA'}`);
    try {
        const ffmpegStatic = require('ffmpeg-static');
        console.log(`ffmpeg-static : ${ffmpegStatic || '-'} (${ffmpegStatic && fs.existsSync(ffmpegStatic) ? 'ada' : 'TIDAK ADA'})`);
    } catch {
        console.log('ffmpeg-static : tidak terpasang');
    }
    return state;
}

function probe(binary, label, args) {
    const res = run(binary, args);
    console.log(`\n--- ${label} ---`);
    console.log(`perintah : yt-dlp ${args.join(' ')}`);
    console.log(`exit code: ${res.status}`);
    if (res.error) console.log(`spawn err: ${res.error.message}`);
    const title = jsonTitle(res.stdout);
    if (title) console.log(`hasil     : ${title}`);
    else if (res.stdout.trim() && res.stdout.trim().length <= 80) console.log(`stdout    : ${res.stdout.trim()}`);
    if (res.stderr.trim()) console.log(`stderr (akhir):\n${tail(res.stderr)}`);
    return res;
}

function main() {
    const state = reportEnvironment();
    const binary = fs.existsSync(state.binary) ? state.binary : BUNDLED_PATH;
    const jsRuntime = state.jsRuntime || 'node';

    line('Uji yt-dlp');
    if (!fs.existsSync(binary)) {
        console.log(`❌ Binary yt-dlp tidak ditemukan di ${binary}`);
        console.log('   → Install yt-dlp: sudo apt install python3-pip && sudo pip3 install -U yt-dlp');
        console.log('     lalu ulangi `npm run doctor` (bot otomatis memakai yt-dlp sistem).');
        return finish(1);
    }

    probe(binary, 'Versi', ['--version'], 30000);

    const baseArgs = ['--dump-single-json', '--no-warnings', TEST_QUERY];
    const withoutRuntime = state.jsRuntimeSupported
        ? probe(binary, 'Pencarian TANPA JavaScript runtime', baseArgs)
        : { status: null, stdout: '', stderr: '' };
    const withRuntime = probe(binary, 'Pencarian DENGAN JavaScript runtime', ['--js-runtimes', jsRuntime, ...baseArgs]);

    const streamArgs = ['-f', 'ba/ba*', '--dump-single-json', '--no-warnings', '--js-runtimes', jsRuntime];
    const streamProbe = probe(binary, 'Ambil link audio (format ba/ba*)', [...streamArgs, FALLBACK_VIDEO]);

    line('Kesimpulan');
    const withOk = withRuntime.status === 0 && jsonTitle(withRuntime.stdout) !== null;
    const withoutOk = state.jsRuntimeSupported && withoutRuntime.status === 0 && jsonTitle(withoutRuntime.stdout) !== null;
    const streamHasUrl = hasRemoteUrl(streamProbe.stdout);

    if (!state.jsRuntimeSupported) {
        console.log(`⚠️  yt-dlp ${state.version || '(versi tidak diketahui)'} lebih tua dari ${JS_RUNTIME_MIN_VERSION}.`);
        console.log(`   → Update: "${binary}" -U   (atau install yt-dlp terbaru)`);
    }
    if (withOk && !withoutOk) {
        console.log('✅ JavaScript runtime (Node) MEMPERBAIKI YouTube.');
        console.log('   → Pastikan dipakai bot: ~/.config/yt-dlp/config berisi `--js-runtimes node`');
        console.log('     atau set YTDLP_JS_RUNTIME=node di .env, lalu restart service.');
    } else if (withOk && streamHasUrl) {
        console.log('✅ yt-dlp, JavaScript runtime, dan pengambilan link audio semuanya OK.');
    } else if (!withOk && botCheckSignature(withRuntime.stderr)) {
        console.log('❌ YouTube minta verifikasi ("Sign in to confirm you\'re not a bot") dari IP VPS ini.');
        console.log('   → Solusi: pakai cookies akun YouTube.');
        console.log('     1) Export cookies (ekstensi "Get cookies.txt") ke cookies.txt di folder project');
        console.log('     2) Tambahkan di .env: YTDLP_COOKIES=/path/ke/cookies.txt');
        console.log('     3) systemctl restart ikyybot');
        console.log('   → Alternatif: install Deno (runtime default yt-dlp) atau ubah YTDLP_EXTRACTOR_ARGS.');
    } else if (withOk && !streamHasUrl) {
        console.log('❌ Pencarian berhasil tetapi URL audio tidak didapat (format terbatas).');
        console.log(`   → Update yt-dlp: "${binary}" -U, lalu restart service.`);
        console.log('   → Bila IP VPS ditandai bot oleh YouTube, tambahkan YTDLP_COOKIES.');
    } else {
        console.log('❌ yt-dlp gagal total. Lihat blok stderr di atas untuk penyebab persisnya.');
        console.log('   → Bila GitHub/jaringan diblokir: install yt-dlp via pip (lihat README-DEPLOY, bagian Troubleshooting).');
    }

    console.log('\nSetelah perbaikan, uji ulang: npm run verify-search');
    return finish(withOk && streamHasUrl ? 0 : 1);
}

// Keluar dengan rapi (hindari "Assertion failed" libuv di Windows).
function finish(code) {
    setTimeout(() => process.exit(code), 300);
}

main();