// Hand-over folder for a channel's owner: node branding/pack.mjs <brand-id> [--out <dir>] [--no-build] | --check <folder>
//   node branding/pack.mjs fourier-loom   builds the kit (and its backup kit named in "backup"), writes output/channel-kit-fourier-loom/ and .zip, then runs the checks
//   --out <dir>    put the folder and zip in <dir> instead of output/      --no-build   do not rebuild the pictures (use the ones already in branding/brands/)
//   --check <dir>  only run the checks on an existing hand-over folder (and its .zip next to it, when there is one)
// The folder is for someone who knows nothing about our tools: no other channel names, no internal terms, no personal data, no picture metadata.
// Texts (description, keywords, playlists) come from the "copy" block of branding/brands/<id>.json. Exit code 1 when any check fails.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BRANDING = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(BRANDING, '..');
const BAD_CHANNELS = ['photon', 'plasma', 'pendulum', 'playground', 'mathcarlooo', 'betonthecolor', 'satisfying2dsims', 'mathmotion'];
const BAD_INTERNAL = [/\bsim studio\b/i, /\bstudio\b/i, /\bpresets?\b/i, /\bmain-\d\b/i, /\bclassic\b/i, /\bnode\b/i, /\bnpm\b/i, /\bterminal\b/i, /\buploader\b/i, /\byoutube api\b/i, /\btokens?\b/i, /\bbatch\b/i, /\brender\w*/i, /\belevenlabs\b/i, /\brepo\b/i, /\bgit\b/i];
const BAD_PERSONAL = [/\/Users\//, /\/private\//, /\/home\//, /[A-Za-z]:\\/, /@gmail\./i, /@icloud\./i, /\baldo\b/i, /\bkristian\b/i, /\blimantara\b/i, /\brolando\b/i, /2D-Simulation/i];
const BAD_BINARY = [...BAD_CHANNELS, 'sim studio', 'elevenlabs', 'youtube api', '/users/', 'kristian', 'limantara', 'gmail.com'];

// ---------- picture helpers ----------
function pngInfo(b) { if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] }; }
function jpgInfo(b) {
  let i = 2; while (i < b.length) { if (b[i] !== 0xff) throw new Error('bad JPEG'); const t = b[i + 1], n = b.readUInt16BE(i + 2); if (t >= 0xc0 && t <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + n; }
  throw new Error('no size in JPEG');
}
const picInfo = (f) => { const b = fs.readFileSync(f); return /\.png$/i.test(f) ? pngInfo(b) : jpgInfo(b); };
// keep only what shows the picture: PNG critical + colour chunks, JPEG JFIF + colour profile (drops text, EXIF, XMP, comments)
function cleanPng(b) {
  const keep = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'iCCP', 'sBIT']);
  const out = [b.subarray(0, 8)]; let i = 8;
  while (i < b.length) { const n = b.readUInt32BE(i), t = b.toString('latin1', i + 4, i + 8); if (keep.has(t)) out.push(b.subarray(i, i + 12 + n)); i += 12 + n; }
  return Buffer.concat(out);
}
function cleanJpg(b) {
  const out = [b.subarray(0, 2)]; let i = 2;
  while (i < b.length) {
    const t = b[i + 1];
    if (t === 0xda) { out.push(b.subarray(i)); break; }
    const n = b.readUInt16BE(i + 2), seg = b.subarray(i, i + 2 + n);
    const icc = t === 0xe2 && seg.toString('latin1', 4, 15) === 'ICC_PROFILE';
    if (t === 0xe0 || icc || !(t >= 0xe0 && t <= 0xef || t === 0xfe)) out.push(seg);
    i += 2 + n;
  }
  return Buffer.concat(out);
}
function copyPic(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); const b = fs.readFileSync(src); fs.writeFileSync(dst, /\.png$/i.test(dst) ? cleanPng(b) : cleanJpg(b)); }

// ---------- texts ----------
const brandJson = (id) => JSON.parse(fs.readFileSync(path.join(BRANDING, 'brands', id + '.json'), 'utf8'));
const brandPng = (id) => path.join(BRANDING, 'brands', id, 'png');
function writeTexts(dir, B) {
  fs.mkdirSync(dir, { recursive: true });
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s.endsWith('\n') ? s : s + '\n');
  w('deskripsi-channel.txt', B.copy.description);
  w('kata-kunci.txt', B.copy.keywords.join(', '));
  w('playlist.txt', B.copy.playlists.join('\n'));
  w('tautan-dan-kontak.txt', ['(Sengaja dikosongkan. Isi sendiri bila perlu; boleh dibiarkan kosong.)', '', 'Email bisnis: pakai alamat khusus channel, bukan email pribadi. Kosongkan kalau belum punya.', 'Tautan: satu tautan saja, judulnya "More simulations", baru diisi kalau sudah ada situs atau halaman tujuan.'].join('\n'));
}
function copyKit(outDir, id, B) {
  const P = brandPng(id);
  copyPic(path.join(P, 'profile_800.png'), path.join(outDir, '1-foto-profil', 'profile_800.png'));
  copyPic(path.join(P, 'banner_2560x1440.png'), path.join(outDir, '2-banner', 'banner_2560x1440.png'));
  copyPic(path.join(P, 'banner_2560x1440.jpg'), path.join(outDir, '2-banner', 'banner_2560x1440.jpg'));
  copyPic(path.join(P, 'watermark_150.png'), path.join(outDir, '3-watermark', 'watermark_150.png'));
  writeTexts(path.join(outDir, '4-teks-siap-tempel'), B);
}

function readme(B, K) {
  return `# ${B.name}: paket setup channel YouTube

Paket setup channel YouTube **${B.name}**, siap pakai: gambar, teks siap tempel, dan daftar langkah. Ikuti to-do di bawah dari atas ke bawah.

## Identitas
| | |
|---|---|
| Nama | ${B.name} |
| Handle | ${B.handle} |
| Tagline | ${B.tagline} |
| Bahasa / target | Inggris AS (ejaan Amerika), penonton Amerika Serikat |
| Kategori | Science & Technology (Shorts simulasi fisika dan matematika) |

Kalau YouTube menolak nama atau handle, pakai folder \`B-cadangan/\` (${K.name} / ${K.handle}). Jangan mengubah nama sendiri tanpa kabar ke pembuat konten, karena gambar memuat nama.

## Isi folder
- \`1-foto-profil/\`: foto profil 800x800.
- \`2-banner/\`: banner 2560x1440 (PNG dipakai dulu; JPG jika ukuran PNG ditolak).
- \`3-watermark/\`: watermark 150x150 untuk pojok video.
- \`4-teks-siap-tempel/\`: deskripsi, kata kunci, nama playlist, dan kolom tautan/kontak (kosong).
- \`5-contoh-sampul-video/\`: contoh tampilan sampul dan thumbnail video (hanya gambaran, tidak perlu diunggah).
- \`B-cadangan/\`: kit lengkap nama cadangan (isi sama seperti 1 sampai 4).

## To-do
Nama menu YouTube bisa sedikit berbeda dari tulisan di sini; ikuti menu yang paling mirip.
- [ ] Masuk ke akun Google milikmu. Sebaiknya pakai Brand Account: youtube.com, klik foto profil, Switch account, Create a channel.
- [ ] Buat channel bernama **${B.name}**, lalu atur handle **${B.handle}** (YouTube Studio, Customization, Profile; di versi lama: Basic info).
- [ ] YouTube Studio, Customization, Profile (versi lama: Branding): unggah \`1-foto-profil/profile_800.png\` sebagai Picture, \`2-banner/banner_2560x1440.png\` sebagai Banner image (jika ditolak, pakai \`.jpg\`), dan \`3-watermark/watermark_150.png\` sebagai Video watermark dengan Display time: Entire video.
- [ ] Customization, Profile (versi lama: Basic info): tempel isi \`4-teks-siap-tempel/deskripsi-channel.txt\` ke Description.
- [ ] Settings, Channel, Basic info: tempel isi \`4-teks-siap-tempel/kata-kunci.txt\` ke Keywords, lalu Save.
- [ ] Settings, Upload defaults: Category = Science & Technology, Video language = English (US), Visibility = Private, komentar aktif.
- [ ] Settings, Channel, Advanced settings, Audience: pilih "No, set this channel as not made for kids" (rekomendasi; kamu yang memutuskan).
- [ ] Verifikasi nomor telepon di youtube.com/verify, supaya bisa memakai thumbnail kustom dan mengunggah video lebih dari 15 menit.
- [ ] Buat 3 playlist dengan nama di \`4-teks-siap-tempel/playlist.txt\` (boleh kosong dan Private dulu).
- [ ] Cek halaman publik channel di ponsel dan di desktop: foto profil bulat utuh, nama dan tagline di banner terbaca.
- [ ] Kabari pembuat konten: handle final, tautan channel, dan apakah memakai nama utama atau cadangan.

## Setup untuk penonton AS
- Semua teks channel berbahasa Inggris AS; jangan diterjemahkan.
- Country/Region (Settings, Channel, Basic info) = negara tempat tinggalmu yang sebenarnya; jangan diisi AS kalau bukan. Penonton AS dijangkau lewat bahasa dan jam tayang, bukan lewat setelan negara.
- Jam tayang awal (titik awal untuk dicoba, bukan fakta): hari kerja 18.00-21.00 ET atau 15.00-18.00 PT, akhir pekan sedikit lebih siang. Setelah ada data, sesuaikan dengan Analytics, Audience, "When your viewers are on YouTube".
- Kalau nanti ikut program monetisasi YouTube: Google meminta informasi pajak AS untuk penghasilan dari penonton AS lewat akun AdSense. Ikuti panduan resmi di pusat bantuan YouTube/Google.

## Keputusan yang hanya kamu yang boleh dan bisa buat
Audiens Made for Kids, negara tempat tinggal, email bisnis dan tautan, serta menyetujui syarat dan ketentuan YouTube.

Video dan judul/deskripsi tiap video dikirim terpisah oleh pembuat konten.
`;
}

// ---------- checks ----------
function walk(dir) { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
export function checkFolder(dir, zip) {
  const bad = [], ok = [];
  const files = walk(dir), rel = (f) => path.relative(dir, f);
  const isText = (f) => /\.(md|txt)$/i.test(f), isPic = (f) => /\.(png|jpe?g)$/i.test(f);
  // (a) forbidden words: names, text, picture bytes and metadata, zip listing
  let hits = 0; const hit = (where, what) => { hits++; bad.push(`forbidden: ${what} in ${where}`); };
  const scanText = (where, s) => {
    const t = s.replace(/YouTube Studio/g, 'YouTube');
    for (const w of BAD_CHANNELS) if (t.toLowerCase().includes(w)) hit(where, w);
    for (const r of [...BAD_INTERNAL, ...BAD_PERSONAL]) if (r.test(t)) hit(where, String(r));
  };
  for (const f of files) {
    scanText('name ' + rel(f), rel(f));
    if (isText(f)) scanText(rel(f), fs.readFileSync(f, 'utf8'));
    else if (isPic(f)) {
      const s = fs.readFileSync(f).toString('latin1').toLowerCase();
      for (const w of BAD_BINARY) if (s.includes(w)) hit(rel(f), w + ' (picture bytes)');
      const sp = spawnSync('sips', ['-g', 'all', f], { encoding: 'utf8' });
      if (sp.status === 0) scanText(rel(f) + ' (metadata)', sp.stdout.split('\n').filter((l) => !l.startsWith('/')).join('\n'));
    } else bad.push(`unexpected file type: ${rel(f)}`);
    if (/(^|\/)(\.DS_Store|__MACOSX)/.test(rel(f))) bad.push(`junk file: ${rel(f)}`);
  }
  if (zip && fs.existsSync(zip)) {
    const list = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    scanText('zip listing', list.join('\n'));
    if (list.some((n) => /\.DS_Store|__MACOSX/.test(n))) bad.push('junk in zip');
    const base = path.basename(dir), want = files.map((f) => base + '/' + rel(f)).sort(), got = list.filter((n) => !n.endsWith('/')).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) bad.push('zip contents differ from the folder');
    const t = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim(), u = spawnSync('unzip', ['-q', zip, '-d', t], { encoding: 'utf8' });
    if (u.status !== 0) bad.push('zip does not unpack'); else for (const f of walk(t)) { if (isPic(f)) { const s = fs.readFileSync(f).toString('latin1').toLowerCase(); for (const w of BAD_BINARY) if (s.includes(w)) hit('zip ' + path.basename(f), w); } else scanText('zip ' + path.basename(f), fs.readFileSync(f, 'utf8')); }
    fs.rmSync(t, { recursive: true, force: true });
  }
  ok.push(`forbidden words / internal terms / personal data: ${hits} findings`);
  // (b) sizes
  const MB = 1024 * 1024;
  const rules = [[/profile_800\.png$/, 800, 800, 4 * MB], [/banner_2560x1440\.(png|jpg)$/, 2560, 1440, 6 * MB], [/watermark_150\.png$/, 150, 150, 1 * MB], [/(sampul|cover).*1080x1920\.jpg$/, 1080, 1920, 2 * MB], [/thumbnail.*1280x720\.jpg$/, 1280, 720, 2 * MB]];
  let nPics = 0;
  for (const f of files.filter(isPic)) {
    const r = rules.find((x) => x[0].test(f)); if (!r) { bad.push(`picture without a size rule: ${rel(f)}`); continue; }
    nPics++; const i = picInfo(f), sz = fs.statSync(f).size;
    if (i.w !== r[1] || i.h !== r[2]) bad.push(`wrong size ${i.w}x${i.h}: ${rel(f)}`);
    if (sz > r[3]) bad.push(`file too big (${sz} bytes): ${rel(f)}`);
    if (/watermark/.test(f) && i.colorType !== 6) bad.push(`watermark has no alpha channel: ${rel(f)}`);
  }
  ok.push(`picture sizes and file sizes: ${nPics} pictures checked`);
  // (c) files named in the README exist
  const readmeFile = path.join(dir, 'README.md');
  if (!fs.existsSync(readmeFile)) bad.push('README.md missing');
  else {
    const rd = fs.readFileSync(readmeFile, 'utf8'); let refs = 0;
    for (const m of rd.matchAll(/`([^`\s]+)`/g)) { const r = m[1]; if (!/\/|\.(png|jpg|txt)$/.test(r) || /^\./.test(r)) continue; refs++; if (!fs.existsSync(path.join(dir, r))) bad.push(`README names a missing file: ${r}`); }
    ok.push(`files named in the README exist: ${refs} references`);
    // (d) length
    const lines = rd.split('\n').length - 1; if (lines > 80 || lines < 20) bad.push(`README has ${lines} lines (want 20 to 80)`);
    ok.push(`README length: ${lines} lines`);
  }
  // (e) absolute paths / user names are covered by BAD_PERSONAL above (text, names, picture bytes, zip)
  ok.push('no absolute paths or user names (text, names, picture bytes, zip)');
  return { bad, ok };
}

// ---------- main ----------
function main() {
  const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--check')) { const d = path.resolve(opt('--check')); const r = checkFolder(d, d + '.zip'); console.log(r.ok.join('\n')); if (r.bad.length) { console.error('FAIL\n' + r.bad.join('\n')); process.exit(1); } console.log('all checks passed'); return; }
  const id = args[0];
  if (!id || id.startsWith('--') || !/^[a-z0-9-]+$/.test(id)) { console.error('usage: node branding/pack.mjs <brand-id> [--out <dir>] [--no-build] | --check <folder>'); process.exit(1); }
  const B = brandJson(id); if (!B.copy) { console.error(`branding/brands/${id}.json has no "copy" block`); process.exit(1); }
  const K = B.backup ? brandJson(B.backup) : null; if (!K) { console.error('the brand needs a "backup" brand'); process.exit(1); }
  if (!args.includes('--no-build')) for (const b of [id, B.backup]) { const r = spawnSync(process.execPath, [path.join(BRANDING, 'build.mjs'), b], { stdio: 'inherit' }); if (r.status !== 0) process.exit(1); }
  const outBase = path.resolve(opt('--out') || path.join(ROOT, 'output')), name = 'channel-kit-' + id, dir = path.join(outBase, name), zip = dir + '.zip';
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(zip, { force: true }); fs.mkdirSync(dir, { recursive: true });
  copyKit(dir, id, B); copyKit(path.join(dir, 'B-cadangan'), B.backup, K);
  const P = brandPng(id), covers = fs.readdirSync(P).filter((f) => /^example_.*_cover_1080x1920\.jpg$/.test(f)).sort();
  covers.forEach((c, n) => { const t = c.replace('_cover_1080x1920', '_thumb_1280x720'); copyPic(path.join(P, c), path.join(dir, '5-contoh-sampul-video', `contoh-${n + 1}-sampul-tegak-1080x1920.jpg`)); copyPic(path.join(P, t), path.join(dir, '5-contoh-sampul-video', `contoh-${n + 1}-thumbnail-1280x720.jpg`)); });
  fs.writeFileSync(path.join(dir, 'README.md'), readme(B, K));
  const z = spawnSync('zip', ['-X', '-q', '-r', zip, name], { cwd: outBase, encoding: 'utf8' }); if (z.status !== 0) { console.error(z.stderr); process.exit(1); }
  const r = checkFolder(dir, zip);
  console.log(`folder: ${dir}\nzip:    ${zip} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`); console.log(r.ok.join('\n'));
  if (r.bad.length) { console.error('FAIL\n' + r.bad.join('\n')); process.exit(1); }
  console.log('all checks passed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
