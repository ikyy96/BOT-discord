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
require('dotenv').config({ quiet: true });
const { configureYtDlp, ytDlpFlags } = require('./ytdlp-setup');

// Pastikan binary + JS runtime yt-dlp siap SEBELUM plugin @distube/yt-dlp
// dimuat, karena plugin membaca env YTDLP_DIR/YTDLP_FILENAME saat di-require.
configureYtDlp({ quiet: true });

const { Song, DisTubeError } = require('distube');
const { json: ytDlpJson } = require('@distube/yt-dlp');

// Awalan pencarian yt-dlp. Bisa diubah lewat .env, contoh: YTDLP_SEARCH_PREFIX=ytsearch5:
const SEARCH_PREFIX = process.env.YTDLP_SEARCH_PREFIX || 'ytsearch1:';

// Format audio untuk streaming (best audio). Bisa diubah lewat env YTDLP_FORMAT.
const STREAM_FORMAT = process.env.YTDLP_FORMAT || 'ba/ba*';

// Argumen yt-dlp: hanya ambil metadata, tanpa mengunduh file.
const SEARCH_FLAGS = {
    dumpSingleJson: true,
    noWarnings: true,
    preferFreeFormats: true,
    skipDownload: true,
    simulate: true,
};

// Gabungan argumen dasar + argumen lingkungan (--js-runtimes, --cookies, dll).
function metadataFlags(extra = {}) {
    return { ...SEARCH_FLAGS, ...ytDlpFlags(), ...extra };
}

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
        info = await ytDlpJson(`${SEARCH_PREFIX}${query}`, metadataFlags());
    } catch (err) {
        // DisTube akan mengubah error ini menjadi NO_RESULT, jadi log detailnya di sini.
        console.error(`[ytdlp-search] yt-dlp gagal mencari "${query}":`, shortError(err));
        throw new DisTubeError('YTDLP_ERROR', `${err.stderr || err}`);
    }
    const entry = Array.isArray(info.entries) ? info.entries[0] : info;
    return toSong(plugin, entry, options, query);
}

// Ambil URL audio langsung dari yt-dlp (dipakai DisTube saat mulai memutar).
// Diambil alih dari plugin agar memakai flag tambahan (--js-runtimes, cookies).
async function getStreamURL(song) {
    if (!song || !song.url) {
        throw new DisTubeError('YTDLP_PLUGIN_INVALID_SONG', 'Cannot get stream url from invalid song.');
    }
    let info;
    try {
        info = await ytDlpJson(song.url, metadataFlags({ format: STREAM_FORMAT }));
    } catch (err) {
        console.error(`[ytdlp-search] gagal mengambil link audio "${song.url}":`, shortError(err));
        throw new DisTubeError('YTDLP_ERROR', `${err.stderr || err}`);
    }
    if (Array.isArray(info.entries) || !info.url) {
        throw new DisTubeError('YTDLP_ERROR', 'yt-dlp tidak mengembalikan URL audio (format tidak tersedia).');
    }
    return info.url;
}

// Ringkas pesan error yt-dlp supaya log tetap terbaca.
function shortError(err) {
    if (err && err.stderr) return String(err.stderr).trim().slice(0, 1000);
    if (err && err.message) return String(err.message).slice(0, 1000);
    return String(err).slice(0, 1000);
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
    // Ambil alih pengambilan link audio agar ikut memakai --js-runtimes/cookies.
    plugin.getStreamURL = getStreamURL;
    plugin.type = 'extractor';
    return plugin;
}

module.exports = { enableSearch, searchSong, getStreamURL, shortError, SEARCH_PREFIX, STREAM_FORMAT };
