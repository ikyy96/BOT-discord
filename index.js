require('dotenv').config();
const ffmpegPath = require('ffmpeg-static');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

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
const distube = new DisTube(client, {
    ffmpeg: {
        path: FFMPEG
    },
    plugins: [
        new YtDlpPlugin({ update: true })
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
            console.error(error);
            message.channel.send('❌ Terjadi kesalahan saat memproses lagu. Silakan coba judul lain atau gunakan link YouTube berbeda.');
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
client.login(TOKEN);