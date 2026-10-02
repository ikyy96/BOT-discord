// -----------------------------------------------------------------------------
// Verifikasi token bot Discord TANPA menjalankan bot penuh.
//
// Pakai:
//     node deploy/verify-token.js
// atau:
//     npm run verify-token
//
// Berguna untuk memastikan masalah "bot tidak online" bukan karena token.
// Script ini:
//   1. membaca DISCORD_TOKEN dari .env (atau environment),
//   2. memeriksa format token (3 bagian dipisah titik),
//   3. login sungguhan ke Discord lalu logout lagi.
// Token TIDAK pernah ditampilkan, hanya panjang & strukturnya.
// -----------------------------------------------------------------------------
require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;

function fail(msg, hint) {
    console.error(`❌ ${msg}`);
    if (hint) console.error(`   → ${hint}`);
    process.exit(1);
}

// ---------- 1. Token ada? ----------
if (!TOKEN) {
    fail(
        'DISCORD_TOKEN tidak ditemukan.',
        'Buat/isi file .env (lihat .env.example), contoh: DISCORD_TOKEN=xxxxx.yyyyy.zzzzz'
    );
}

if (/isi_token_bot_discord_kamu_di_sini/.test(TOKEN)) {
    fail(
        '.env masih memakai token contoh (placeholder), belum diisi token asli.',
        'Ganti DISCORD_TOKEN di .env dengan token dari Discord Developer Portal → Bot → Reset Token.'
    );
}

// ---------- 2. Format token ----------
const parts = TOKEN.trim().split('.');
console.log('📋 Info token (tanpa membocorkan isinya):');
console.log(`   panjang      : ${TOKEN.length} karakter`);
console.log(`   jumlah bagian: ${parts.length} (token valid harus 3 bagian, dipisah titik)`);
console.log(`   panjang bagian: ${parts.map((p) => p.length).join(' / ')}`);

if (/\s/.test(TOKEN)) {
    fail('Token mengandung spasi/baris baru.', 'Hapus spasi atau tanda kutip yang ikut ter-copy di .env.');
}
if (/^["']|["']$/.test(TOKEN)) {
    fail('Token diawali/diakhiri tanda kutip.', 'Di .env jangan pakai tanda kutip, tulis: DISCORD_TOKEN=abcd.efgh.ijkl');
}
if (/^Bot\s+/i.test(TOKEN)) {
    fail('Token diawali kata "Bot ".', 'Di .env cukup tokennya saja, tanpa awalan "Bot ".');
}
if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    fail(
        'Format token tidak sesuai (harus 3 bagian dipisah titik).',
        'Token terpotong / salah copy. Ambil ulang dari Developer Portal → Bot → Reset Token.'
    );
}
if (!parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) {
    fail(
        'Token berisi karakter tidak valid.',
        'Karakter yang boleh: A-Z a-z 0-9 _ - . (selain itu tidak valid).'
    );
}

// ---------- 3. Uji login sungguhan ----------
console.log('\n🔐 Menguji login ke Discord...');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Keluar dengan rapi: tutup client dulu, beri jeda sesaat agar libuv selesai
// menutup handle (kalau tidak, di Windows muncul "Assertion failed" saat exit).
function finish(code) {
    try { client.destroy(); } catch (e) { /* abaikan */ }
    setTimeout(() => process.exit(code), 300);
}

const TIMEOUT_MS = 30000;
const timer = setTimeout(() => {
    console.error('❌ Timeout saat login (30 detik).');
    console.error('   → Cek koneksi internet/DNS & firewall server (port 443 harus terbuka).');
    finish(1);
}, TIMEOUT_MS);

client.once('clientReady', () => {
    clearTimeout(timer);
    console.log(`✅ Token VALID. Bot login sebagai: ${client.user.tag} (id: ${client.user.id})`);
    console.log(`   Token ini milik aplikasi: ${client.application ? client.application.name || '-' : '-'}`);
    console.log('   Kalau status bot tetap "offline" di Discord, berarti masalahnya BUKAN token:');
    console.log('   cek MESSAGE CONTENT INTENT & pastikan bot sudah di-invite ke server.');
    finish(0);
});

client.login(TOKEN).catch((err) => {
    clearTimeout(timer);
    const code = err && err.code ? err.code : '';
    console.error(`❌ Login GAGAL: ${code ? code + ' - ' : ''}${err && err.message ? err.message : err}`);

    if (code === 'TokenInvalid') {
        console.error('   → Token tidak dikenali Discord (sudah di-reset / salah copy / bot dihapus).');
        console.error('   → Discord Developer Portal → aplikasi → Bot → Reset Token, lalu update DISCORD_TOKEN di .env.');
    } else if (/disallowed intents/i.test(String(err && err.message))) {
        console.error('   → Aktifkan MESSAGE CONTENT INTENT di Developer Portal → Bot → Privileged Gateway Intents.');
    } else {
        console.error('   → Cek koneksi internet server, lalu coba lagi.');
    }
    finish(1);
});