// -----------------------------------------------------------------------------
// Wrapper yt-dlp lintas-platform (Windows / Linux / macOS).
//
// CATATAN: Untuk @distube/yt-dlp v2, file ini TIDAK dipakai karena plugin sudah
// otomatis mengunduh & memakai binary yt-dlp yang sesuai OS. File ini hanya
// dipertahankan sebagai fallback/manual runner bila diperlukan.
//
// Cara pakai manual:  node yt-dlp-wrapper.js <argumen yt-dlp...>
// -----------------------------------------------------------------------------
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveYtDlp() {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

  const candidates = [
    path.join(__dirname, 'node_modules', '@distube', 'yt-dlp', 'bin', exeName),
    path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', exeName),
    path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'dist', exeName),
    // fallback: pakai yt-dlp yang ada di PATH sistem
    isWin ? 'yt-dlp.exe' : 'yt-dlp',
  ];

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return exeName;
}

function main() {
  const args = process.argv.slice(2);
  const ytDlp = resolveYtDlp();

  const child = spawn(ytDlp, args, { shell: false });
  let output = '';

  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  child.on('error', (err) => {
    console.error(`Gagal menjalankan yt-dlp (${ytDlp}): ${err.message}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd >= 0) {
      console.log(output.slice(jsonStart, jsonEnd + 1));
    } else {
      console.log(output);
    }
    process.exit(code === 0 ? 0 : 1);
  });
}

main();
