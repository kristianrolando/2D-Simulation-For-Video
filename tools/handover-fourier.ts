// Hand-over folder of the Fourier Loom videos for the friend who runs the channel: output/serah-terima-video-fourier-loom/
//   node tools/handover-fourier.ts            copies the videos and covers (the originals in output/ stay), writes daftar.csv and README.md, then checks
//   node tools/handover-fourier.ts --check    only checks an existing folder
// Needs the studio running (reads the video list through its API; changes nothing there). Check: no other channel's name, no internal tool names,
// no personal paths, in the texts, the file names and the bytes of every file ("pendulum" alone is physics and allowed; "Plasma Pendulum" is not).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'output/serah-terima-video-fourier-loom');
const BASE = 'http://127.0.0.1:5180';
const FORBID = /photon|plasma|playground|mathcarlooo|betonthecolor|satisfying2dsims|mathmotion|sim[ -]?studio|(?<!youtube )studio|preset|main-?[123]\b|classic|\bnpm\b|\bnode\b|uploader|youtube api|\btoken\b|\bbatch\b|render|elevenlabs|\/users\/|aldo|2d-simulation/i;
const csv = (x: unknown) => `"${String(x).replace(/"/g, '""')}"`;

function check(dir: string): string[] {
  const bad: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else {
    if (FORBID.test(e.name)) bad.push(`file name: ${path.relative(dir, p)}`);
    if (/\.(csv|md|txt)$/.test(e.name)) { const t = fs.readFileSync(p, 'utf8'); const m = t.match(new RegExp(FORBID.source, 'gi')); if (m) bad.push(`${path.relative(dir, p)}: ${[...new Set(m.map(x => x.toLowerCase()))].join(', ')}`); }
  } } };
  walk(dir);
  // the bytes of the videos and covers (metadata, hidden text)
  // long names can only be text, so the whole file is searched; short words (npm, node, token, ...) would match random video bytes, so for those only the
  // container's metadata (ffprobe tags) is read
  const LONG = 'photon|plasma|playground|mathcarlooo|betonthecolor|satisfying2dsims|mathmotion|sim[ -]?studio|preset|classic|uploader|youtube api|elevenlabs|/users/|2d-simulation';
  const g = spawnSync('grep', ['-rlaiE', LONG, '--include=*.mp4', '--include=*.jpg', dir], { encoding: 'utf8' });
  for (const f of g.stdout.split('\n').filter(Boolean)) bad.push('inside the bytes: ' + path.relative(dir, f));
  for (const f of fs.readdirSync(dir).filter(x => /\.(mp4|jpg)$/.test(x))) {
    const meta = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'default=nw=1', path.join(dir, f)], { encoding: 'utf8' }).stdout;
    if (FORBID.test(meta)) bad.push('metadata: ' + f);
  }
  if (/plasma pendulum/i.test(fs.readFileSync(path.join(dir, 'daftar.csv'), 'utf8'))) bad.push('daftar.csv names another channel');
  return bad;
}

if (process.argv.includes('--check')) { const b = check(OUT); console.log(b.length ? b.join('\n') : 'forbidden words: 0 findings'); process.exit(b.length ? 1 : 0); }

const plan: { items: { key: string; sceneId: string }[] } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/batch-fourier/plan.json'), 'utf8'));
const state: Record<string, { jobId: string; status: string }> = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/batch-fourier/state.json'), 'utf8'));
const listed: any = await (await fetch(BASE + '/api/videos')).json(); const videos: any[] = Array.isArray(listed) ? listed : listed.videos;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const rows: string[] = [['nomor', 'berkas_video', 'berkas_cover', 'judul', 'deskripsi', 'tag', 'durasi_detik'].join(',')];
let n = 0, bytes = 0;
for (const it of plan.items) {
  const v = videos.find(x => x.jobId === state[it.key]?.jobId); if (!v || state[it.key].status !== 'done') throw new Error('not rendered: ' + it.key);
  n++; const num = String(n).padStart(3, '0'), slug = it.sceneId, vf = `${num}-${slug}.mp4`, cf = `${num}-${slug}-cover.jpg`;
  fs.copyFileSync(path.join(ROOT, 'output', v.file), path.join(OUT, vf)); fs.copyFileSync(path.join(ROOT, 'data/thumbnails', v.coverFile), path.join(OUT, cf));
  bytes += fs.statSync(path.join(OUT, vf)).size + fs.statSync(path.join(OUT, cf)).size;
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(OUT, vf)]).toString().trim();
  const tags = (v.tags as string[]).filter(t => !/classic/i.test(t)).join(', ');   // "classic neon" names an internal look, not a topic
  rows.push([num, vf, cf, csv(v.title), csv(v.description), csv(tags), (+dur).toFixed(1)].map((x, i) => (i >= 3 && i <= 5 ? x : x)).join(','));
}
fs.writeFileSync(path.join(OUT, 'daftar.csv'), '﻿' + rows.join('\r\n') + '\r\n');
fs.writeFileSync(path.join(OUT, 'README.md'), `# Video Fourier Loom: serah-terima

Folder ini berisi ${n} video Shorts (vertikal 1080×1920, 22 sampai 59 detik) beserta cover dan satu daftar teks. Semuanya sudah jadi; tinggal diunggah oleh kamu.

## Isi folder
- \`001-...mp4\` sampai \`${String(n).padStart(3, '0')}-...mp4\`: videonya, berurutan. Nama berkas hanya menyebut jenis simulasinya.
- \`001-...-cover.jpg\`: cover tegak 1080×1920 untuk video dengan nomor yang sama (boleh dipakai atau diabaikan).
- \`daftar.csv\`: satu baris per video: nomor, berkas video, berkas cover, judul, deskripsi, tag, durasi (detik).

## Cara memakai daftar.csv
1. Buka dengan Google Sheets atau Excel (pilih format UTF-8 bila hurufnya aneh). Judul, deskripsi, dan tag sudah berbahasa Inggris AS dan siap ditempel.
2. Ambil satu baris, unggah berkas video bernomor sama, lalu tempel judul, deskripsi, dan tag-nya (tag dipisah koma).
3. Kategori dan bahasa video sudah diatur di pengaturan bawaan channel (Science & Technology, English (US)).

## Saran jadwal (titik awal, sesuaikan dengan data channel-mu)
Untuk penonton AS, mulai dengan 2 sampai 3 video per hari, misalnya sekitar pukul 12:00, 17:00, dan 20:00 waktu Timur AS. Lihat jam ramai penontonmu di YouTube Analytics lalu geser seperlunya.

Jangan unggah semuanya sekaligus: sebar bertahap supaya setiap video punya waktu mendapat penonton.
`);
const bad = check(OUT);
console.log(`videos ${n} · folder ${(bytes / 1e9).toFixed(2)} GB · ${bad.length ? 'FORBIDDEN:\n' + bad.join('\n') : 'forbidden words: 0 findings'}`);
process.exit(bad.length ? 1 : 0);
