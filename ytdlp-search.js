// -----------------------------------------------------------------------------
// Dukungan pencarian kata kunci untuk plugin @distube/yt-dlp v2.
//
// MASALAH (dua lapis, keduanya harus ditambal)
//   1) @distube/yt-dlp v2 TIDAK punya method `searchSong`, padahal DisTube
//      memanggilnya saat input `!play` BUKAN url (contoh: `!play hindia`).
//   2) Plugin itu bertipe "playable-extractor", sedangkan DisTube hanya mencari
//      lewat plugin bertipe "extractor" (distube/dist/index.js:1609).
//   Di distube/dist/index.js:1585-1590 error dari kedua hal di atas dibungkus
//   `try/catch` dan diubah menjadi:
//       DisTubeError [NO_RESULT]: Cannot find any song with this query (hindia)
//
// SOLUSI
//   - lengkapi `plugin.searchSong` yang menjalankan
//         yt-dlp "ytsearch1:<kata kunci>" --dump-single-json
//     mengambil hasil pencarian TERATAS lalu membungkusnya jadi `Song`,
//   - ubah `plugin.type` menjadi "extractor" agar ikut diikutsertakan
//     dalam pencarian (streaming tetap jalan: lihat enableSearch()).
//
// Catatan: memutar URL langsung (`!play <link>`) tetap jalan tanpa tambalan ini.
// -----------------------------------------------------------------------------
const { Song, DisTubeError } = require('distube');
const { json: ytDlpJson } = require('@distube/yt-dlp');

// Awalan pencarian yt-dlp. Bisa diubah lewat .env, contoh: YTDLP_SEARCH_PREFIX=ytsearch5:
const SEARCH_PREFIX = process.env.YTDLP_SEARCH_PREFIX || 'ytsearch1:';

// Argumen yt-dlp: hanya ambil metadata, tanpa mengunduh file.
const SEARCH_FLAGS = {
    dumpSingleJson: true,
    noWarnings: true,
    preferFreeFormats: true,
    skipDownload: true,
    simulate: true,
};

function pickThumbnail(entry) {
    if (entry.thumbnail) return entry.thumbnail;
    const list = entry.thumbnails;
    if (Array.isArray(list) && list.length) return list[list.length - 1].url;
    return undefined;
}

// Ubah satu entri hasil yt-dlp menjadi objek Song milik DisTube.
function toSong(plugin, entry, options, query) {
    if (!entry || !entry.id) throw new DisTubeError('NO_RESULT', query);

    // `ytsearch` mengembalikan _type "playlist"; entri di dalamnya sudah punya
    // webpage_url video asli. Fallback ke URL watch standar kalau kosong.
    const url = typeof entry.webpage_url === 'string' && /^https?:\/\//i.test(entry.webpage_url)
        ? entry.webpage_url
        : `https://www.youtube.com/watch?v=${entry.id}`;

    return new Song({
        plugin,
        source: entry.extractor || 'youtube',
        playFromSource: true,
        id: entry.id,
        name: entry.title || entry.fulltitle || entry.id,
        url,
        isLive: Boolean(entry.is_live),
        thumbnail: pickThumbnail(entry),
        duration: entry.duration,
        uploader: { name: entry.uploader, url: entry.uploader_url },
        views: entry.view_count,
        likes: entry.like_count,
        dislikes: entry.dislike_count,
        reposts: entry.repost_count,
        ageRestricted: Boolean(entry.age_limit) && Number(entry.age_limit) >= 18,
    }, options);
}

// Cari satu lagu dari kata kunci.
async function searchSong(plugin, query, options = {}) {
    let info;
    try {
        info = await ytDlpJson(`${SEARCH_PREFIX}${query}`, SEARCH_FLAGS);
    } catch (err) {
        // DisTube akan mengubah error ini menjadi NO_RESULT, jadi log detailnya di sini.
        console.error(`[ytdlp-search] yt-dlp gagal mencari "${query}":`, String(err.stderr || err.message || err).slice(0, 500));
        throw new DisTubeError('YTDLP_ERROR', `${err.stderr || err}`);
    }
    const entry = Array.isArray(info.entries) ? info.entries[0] : info;
    return toSong(plugin, entry, options, query);
}

// Pasang method searchSong ke instance plugin (hanya kalau belum ada) dan
// ubah `type` menjadi "extractor".
//
// KENAPA `type` DIUBAH:
//   DisTube hanya mencari kata kunci lewat plugin bertipe "extractor"
//   (distube/dist/index.js:1609 -> `plugins.filter(p => p.type === "extractor")`).
//   @distube/yt-dlp bertipe "playable-extractor", sehingga pencarian melempar
//   NO_EXTRACTOR_PLUGIN yang berujung jadi NO_RESULT. Streaming & getStreamURL
//   tetap jalan karena attachStreamInfo (baris 1629) menerima KEDUA tipe itu.
function enableSearch(plugin) {
    if (typeof plugin.searchSong !== 'function') {
        plugin.searchSong = (query, options) => searchSong(plugin, query, options);
    }
    plugin.type = 'extractor';
    return plugin;
}

module.exports = { enableSearch, searchSong, SEARCH_PREFIX };
