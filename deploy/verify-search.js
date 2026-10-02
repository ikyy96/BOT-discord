// -----------------------------------------------------------------------------
// Verifikasi rantai "cari + ambil link audio" tanpa menjalankan bot / tanpa Discord.
//
// Pakai:
//     node deploy/verify-search.js hindia
// atau:
//     npm run verify-search
//
// Kalau script ini sukses, berarti `!play <judul>` di Discord juga bisa jalan
// (masalah NO_RESULT biasanya dari sini).
// -----------------------------------------------------------------------------
require('dotenv').config({ quiet: true });
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { enableSearch } = require('../ytdlp-search');

const query = process.argv.slice(2).join(' ').trim() || 'hindia';

// Keluar dengan rapi (hindari "Assertion failed" libuv di Windows).
function finish(code) {
    setTimeout(() => process.exit(code), 300);
}

(async () => {
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
    console.error('   → Kalau errorCode NO_RESULT: kata kunci tidak ketemu, coba kata kunci lain atau link YouTube.');
    console.error('   → Kalau YTDLP_ERROR: yt-dlp gagal (YouTube berubah / butuh update) — restart bot agar binary di-update.');
    finish(1);
});
