require('dotenv').config();
const ffmpegPath = require('ffmpeg-static');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { enableSearch } = require('./ytdlp-search');

// ---------- Konfigurasi dari environment (.env) ----------
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || '!';
// FFMPEG_PATH opsional: pakai ffmpeg sistem kalau diisi (mis. /usr/bin/ffmpeg),
// kalau kosong pakai binary dari paket ffmpeg-static.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegPath;

if (!TOKEN) {
    console.error('❌ DISCORD_TOKEN tidak ditemukan. Salin .env.example menjadi .env lalu isi tokennya.');
    process.exit(1);
}

// Inisialisasi Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Inisialisasi DisTube
// Catatan: plugin @distube/yt-dlp v2 OTOMATIS mengunduh binary yt-dlp yang
// sesuai OS (yt-dlp.exe di Windows, yt-dlp di Linux/macOS) ke folder
// node_modules/@distube/yt-dlp/bin saat pertama dijalankan, jadi tidak perlu
// setting path manual. Pastikan folder tsb bisa ditulis oleh user service.
//
// PENTING: @distube/yt-dlp v2 belum punya `searchSong` DAN bertipe
// "playable-extractor", sehingga pencarian kata kunci (`!play hindia`) gagal
// dengan NO_RESULT. enableSearch() menambal keduanya (lihat ytdlp-search.js).
// Pemutaran lewat link tetap seperti biasa.
const ytDlpPlugin = enableSearch(new YtDlpPlugin({ update: true }));

const distube = new DisTube(client, {
    ffmpeg: {
        path: FFMPEG
    },
    plugins: [
        ytDlpPlugin
    ]
});

client.once('clientReady', () => {
    console.log(`🤖 IKYYBOT Berhasil Online sebagai ${client.user.tag}!`);
    client.user.setActivity(PREFIX + 'help', { type: ActivityType.Listening });
});

client.on('warn', (msg) => console.warn('Discord warn:', msg));
client.on('error', (err) => console.error('Discord client error:', err));

// Handle Perintah Chat (Prefix: !)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = PREFIX;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'help') {
        return message.reply('Perintah tersedia:\n`!play <judul/link>` - Putar musik\n`!skip` - Lewati lagu\n`!stop` - Hentikan musik');
    }

    // Perintah !play <judul lagu / link>
    if (command === 'play') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('Kamu harus masuk ke voice channel terlebih dahulu!');
        }

        const query = args.join(' ');
        if (!query) return message.reply('Tolong masukkan judul lagu atau link musiknya!');

        try {
            message.reply(`🔍 Mencari lagu: **${query}**...`);
            await distube.play(voiceChannel, query, {
                textChannel: message.channel,
                member: message.member,
            });
        } catch (error) {
            console.error('Gagal memproses lagu:', error);
            const code = error && error.errorCode;
            let pesan;
            if (code === 'NO_RESULT') {
                pesan = `❌ Tidak ada hasil untuk **${query}**. Coba kata kunci lain atau tempel link YouTube-nya langsung.`;
            } else if (code === 'YTDLP_ERROR') {
                pesan = '❌ yt-dlp gagal mengambil lagu ini (YouTube sering berubah). Coba lagi atau pakai link lain.';
            } else if (code === 'NOT_SUPPORTED_URL') {
                pesan = '❌ Link itu belum didukung. Pakai link YouTube atau kata kunci pencarian.';
            } else {
                pesan = '❌ Terjadi kesalahan saat memproses lagu. Silakan coba judul lain atau gunakan link YouTube berbeda.';
            }
            message.channel.send(pesan);
        }
    }

    // Perintah !skip
    if (command === 'skip') {
        try {
            const queue = distube.getQueue(message);
            if (!queue) return message.reply('Tidak ada lagu yang sedang diputar.');
            await distube.skip(message);
            message.reply('⏭️ Lagu dilewati!');
        } catch (error) {
            message.reply('❌ Tidak ada lagu berikutnya untuk di-skip.');
        }
    }

    // Perintah !stop
    if (command === 'stop') {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('Tidak ada musik yang sedang diputar.');
        distube.stop(message);
        message.reply('🛑 Musik dihentikan dan antrean dihapus!');
    }
});

// Event Listener dari DisTube
distube.on('playSong', (queue, song) => {
    queue.textChannel.send(`🎶 Sedang memutar: **${song.name}** - \`${song.formattedDuration}\`\nDiminta oleh: ${song.user}`);
});

distube.on('addSong', (queue, song) => {
    queue.textChannel.send(`✅ Menambahkan **${song.name}** ke antrean.`);
});

// Event lifecycle DisTube tambahan
distube.on('empty', (queue) => {
    queue.textChannel?.send('📭 Voice channel kosong, bot keluar dari channel.').catch(() => {});
});

distube.on('disconnect', (queue) => {
    queue.textChannel?.send('👋 Bot terputus dari voice channel.').catch(() => {});
});

distube.on('finish', (queue) => {
    queue.textChannel?.send('✅ Antrean selesai, semua lagu sudah diputar.').catch(() => {});
});

// Error handling internal agar bot tidak langsung mati jika streaming gagal
distube.on('error', (channel, error) => {
    console.error('DisTube Error:', error);
    if (channel && typeof channel.send === 'function') {
        channel.send(`❌ Terjadi masalah pada pemutaran: ${String(error.message || error).slice(0, 100)}...`)
            .catch(() => {});
    }
});

// ---------- Anti-crash & graceful shutdown (penting untuk VPS/service) ----------
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n⏹️  Menerima ${signal}, menutup bot...`);
    try { client.destroy(); } catch (e) { /* abaikan */ }
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Login ke Discord
// Penting: kalau login gagal (mis. token invalid), tanpa .catch() error-nya hanya
// muncul sebagai "unhandled rejection" dan proses tetap hidup -> systemd/PM2
// melaporkan service "running" padahal bot sebenarnya TIDAK online.
client.login(TOKEN).catch((err) => {
    const code = err && err.code ? err.code : '';
    console.error(`❌ Gagal login ke Discord: ${code ? code + ' - ' : ''}${err && err.message ? err.message : err}`);

    if (code === 'TokenInvalid') {
        console.error('   → Token di .env TIDAK VALID (sudah di-reset / salah copy / terpotong).');
        console.error('   → Reset token: https://discord.com/developers/applications → Bot → Reset Token,');
        console.error('     lalu update DISCORD_TOKEN di .env dan restart: systemctl restart ikyybot');
        console.error('   → Cek token tanpa menjalankan bot: npm run verify-token');
    } else if (/disallowed intents/i.test(String(err && err.message))) {
        console.error('   → Aktifkan MESSAGE CONTENT INTENT di Discord Developer Portal → Bot → Privileged Gateway Intents.');
    } else {
        console.error('   → Cek koneksi internet server, lalu coba lagi.');
    }

    // Tutup client dulu lalu keluar (menghindari "Assertion failed" libuv di Windows).
    // Keluar dengan kode error penting: systemd/PM2 jadi bisa melaporkan service gagal,
    // dan alasannya terlihat jelas di `journalctl -u ikyybot`.
    try { client.destroy(); } catch (e) { /* abaikan */ }
    setTimeout(() => process.exit(1), 300);
});