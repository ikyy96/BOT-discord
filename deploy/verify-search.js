// -----------------------------------------------------------------------------
// Verifikasi rantai "cari + ambil link audio" tanpa menjalankan bot / tanpa Discord.
//
// Pakai:
//     node deploy/verify-search.js hindia
// atau:
//     npm run verify-search
//     npm run verify-search -- "no doubt dont speak"
//
// Kalau script ini sukses, berarti `!play <judul>` di Discord juga bisa jalan.
// -----------------------------------------------------------------------------
require('dotenv').config({ quiet: true });
const { getYtDlpState, formatYtDlpStatus, ytDlpFlags } = require('../ytdlp-setup');

// require('../ytdlp-search') otomatis menjalankan configureYtDlp() SEBELUM
// plugin @distube/yt-dlp dimuat, jadi urutan import ini penting.
const { enableSearch, shortError } = require('../ytdlp-search');
const { YtDlpPlugin } = require('@distube/yt-dlp');

const query = process.argv.slice(2).join(' ').trim() || 'hindia';

// Keluar dengan rapi (hindari "Assertion failed" libuv di Windows).
function finish(code) {
    setTimeout(() => process.exit(code), 300);
}

(async () => {
    const state = getYtDlpState();
    console.log('ℹ️  Info yt-dlp:');
    for (const line of formatYtDlpStatus(state)) console.log(`   ${line}`);
    const flags = ytDlpFlags();
    console.log(`   flag tambahan : ${Object.keys(flags).length ? JSON.stringify(flags) : '(tidak ada)'}`);
    console.log('');

    const plugin = enableSearch(new YtDlpPlugin({ update: false }));

    console.log(`🔎 Mencari: "${query}" ...`);
    const song = await plugin.searchSong(query, {});
    console.log(`✅ Ketemu   : ${song.name}`);
    console.log(`   sumber   : ${song.source}`);
    console.log(`   durasi   : ${song.formattedDuration}`);
    console.log(`   uploader : ${song.uploader?.name}`);
    console.log(`   url      : ${song.url}`);

    console.log('\n🎧 Mengambil link audio (getStreamURL) ...');
    const streamUrl = await plugin.getStreamURL(song);
    console.log(`✅ Link audio didapat: ${String(streamUrl).slice(0, 70)}...`);

    console.log('\n🎉 Semua OK — `!play <judul>` seharusnya sudah bisa dipakai di Discord.');
    finish(0);
})().catch((err) => {
    console.error(`❌ Gagal: ${err.errorCode ? err.errorCode + ' - ' : ''}${err.message}`);
    if (err.stderr) console.error(`   detail yt-dlp: ${shortError(err)}`);
    console.error('   → Jalankan `npm run doctor` untuk diagnosa lengkap (JS runtime, binary, ffmpeg).');
    finish(1);
});