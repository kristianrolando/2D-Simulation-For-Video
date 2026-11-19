// Konvensi proyek (docs/conventions.md): nama berkas, sampah terlacak, tautan markdown, indeks docs, batas ukuran.
// Cepat, tanpa jaringan, tanpa menjalankan studio. Aturan ditulis sebagai fungsi murni; tiap aturan juga dicoba pada contoh pelanggaran
// buatan (tanpa menyentuh repo) supaya terbukti bisa gagal. Jalankan sendiri: node --test tests/conventions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);

// ---------------------------------------------------------------- pengecualian (jujur dan beralasan; jangan menambah tanpa alasan)
type Exc = { re: RegExp; why: string };

/** Berkas yang namanya tidak boleh mengikuti kebab-case huruf kecil. */
const NAME_EXCEPTIONS: Exc[] = [
  { re: /^(AGENTS|CLAUDE|HANDOFF)\.md$/, why: 'nama konvensi agen, dikenali alat (AGENTS.md, CLAUDE.md) dan skill handoff' },
  { re: /(^|\/)README\.md$/, why: 'nama konvensi GitHub/editor di tiap folder' },
  { re: /^Buka Studio\.command$/, why: 'berkas klik-ganda pemilik di Finder; diganti hanya atas keputusan pemilik' },
  { re: /^Sim Studio\.app\//, why: 'bundel macOS (spasi, huruf besar, tanpa ekstensi dibuat oleh aturan macOS dan make-app.sh)' },
  { re: /^apps\/mac\/make_app\.sh$/, why: 'nama ini tertulis di pesan kesalahan Sim Studio.app yang sudah dikompilasi; ganti nama hanya bersama membangun ulang app' },
  { re: /^\.gitignore$|^\.claude\//, why: 'berkas konfigurasi bertitik' },
  { re: /^assets\/fonts\//, why: 'nama berkas font DejaVu dari pembuatnya (tersambung ke CSS dan host.ts)' },
  { re: /^docs\/evidence\/reference-sheets\//, why: 'nama = id video YouTube referensi (huruf besar/kecil dan _ - bermakna)' },
  { re: /^branding\/(brands\/[^/]+\/)?(png|svg)\/[a-z0-9_.-]+$/, why: 'keluaran branding/build.mjs (snake_case + ukuran); namanya dipakai pack.mjs, tes, dan README channel' },
];

/** Berkas yang boleh lebih besar dari batas. Kosongkan bila bisa. */
const SIZE_EXCEPTIONS: Exc[] = [];

export const MAX_BYTES = 1024 * 1024;        // satu berkas dilacak git
export const MAX_DOC_IMAGE_BYTES = 700 * 1024; // gambar/data bukti di docs/

const EXTENSIONS = new Set(['ts', 'mjs', 'js', 'sh', 'py', 'swift', 'json', 'md', 'html', 'css', 'png', 'jpg', 'svg', 'wav', 'mp3', 'ttf', 'icns', 'plist', 'txt']);
const ID_LANG_WORDS = /(^|[-_.])(catatan|rencana|laporan|panduan|hasil|bukti|jadwal|pemeriksaan|serah|terima)([-_.]|$)/;

// ---------------------------------------------------------------- aturan murni
export function checkNames(paths: string[]): string[] {
  const bad: string[] = [];
  for (const p of paths) {
    if (NAME_EXCEPTIONS.some(e => e.re.test(p))) continue;
    for (const seg of p.split('/')) {
      if (!/^[a-z0-9][a-z0-9.-]*$/.test(seg)) { bad.push(`${p}: nama "${seg}" harus kebab-case huruf kecil tanpa spasi/garis bawah. Perbaiki: git mv "${p}" <nama-baru> lalu perbarui rujukannya (grep nama lama). Pengecualian sah hanya lewat NAME_EXCEPTIONS di tests/conventions.test.ts dengan alasan.`); break; }
      if (ID_LANG_WORDS.test(seg)) { bad.push(`${p}: nama "${seg}" bercampur bahasa. Nama berkas selalu Inggris (isi dokumen boleh Indonesia). Perbaiki: git mv ke nama Inggris.`); break; }
    }
    const ext = path.posix.basename(p).split('.').slice(1).pop();
    if (!ext || !EXTENSIONS.has(ext)) bad.push(`${p}: ekstensi "${ext ?? '(tanpa)'}" tidak lazim. Pakai ${[...EXTENSIONS].join(', ')}, atau tambahkan pengecualian beralasan.`);
  }
  return bad;
}

export function checkJunk(paths: string[]): string[] {
  const bad: string[] = [];
  for (const p of paths) {
    const base = path.posix.basename(p);
    const segs = p.split('/');
    if (/\.(log|bak|tmp|orig|rej|swp)$/.test(base) || base === '.DS_Store' || base.endsWith('~') || segs.some(s => /^(tmp|temp|node_modules)$/.test(s))) {
      bad.push(`${p}: berkas sementara/log/cadangan tidak boleh dilacak git. Perbaiki: git rm --cached "${p}" dan tambahkan polanya ke .gitignore.`);
    }
  }
  return bad;
}

/** Tautan markdown relatif: `files` = {jalur berkas md: isi}. `exists` memeriksa jalur dari akar repo. */
export function checkLinks(files: Record<string, string>, exists: (p: string) => boolean): string[] {
  const bad: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const body = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of body.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      let target = m[1];
      if (/^([a-z][a-z0-9+.-]*:|#)/i.test(target)) continue; // http:, mailto:, #jangkar
      target = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!target) continue;
      const resolved = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(file), target));
      if (!exists(resolved)) bad.push(`${file}: tautan "${m[1]}" menunjuk "${resolved}" yang tidak ada. Perbaiki: betulkan jalurnya (berkas mungkin dipindah) atau hapus tautannya.`);
    }
  }
  return bad;
}

/** Tiap .md di docs/ (selain docs/README.md) harus tersebut di docs/README.md dengan jalurnya dari docs/. */
export function checkDocsIndex(paths: string[], indexText: string): string[] {
  const bad: string[] = [];
  for (const p of paths) {
    if (!p.startsWith('docs/') || !p.endsWith('.md') || p === 'docs/README.md') continue;
    const rel = p.slice('docs/'.length);
    if (!indexText.includes(rel)) bad.push(`${p}: tidak ada di indeks docs/README.md. Perbaiki: tambahkan satu baris (isi + kapan dibaca) yang memuat "${rel}".`);
  }
  return bad;
}

export function checkSizes(sizes: Record<string, number>): string[] {
  const bad: string[] = [];
  for (const [p, n] of Object.entries(sizes)) {
    if (SIZE_EXCEPTIONS.some(e => e.re.test(p))) continue;
    const kb = Math.round(n / 1024);
    if (n > MAX_BYTES) bad.push(`${p}: ${kb} KB melebihi batas ${MAX_BYTES / 1024} KB per berkas dilacak. Perbaiki: kompres (JPEG q80 untuk foto/tangkapan layar) atau jangan lacak berkas besar (letakkan di output/ atau work/, tidak dilacak).`);
    else if (p.startsWith('docs/') && /\.(png|jpg|svg)$/.test(p) && n > MAX_DOC_IMAGE_BYTES) bad.push(`${p}: ${kb} KB melebihi batas gambar docs ${MAX_DOC_IMAGE_BYTES / 1024} KB. Perbaiki: kompres (sips -s format jpeg -s formatOptions 80) lalu perbarui rujukannya.`);
  }
  return bad;
}

// ---------------------------------------------------------------- data repo nyata
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const mdFiles = tracked.filter(p => p.endsWith('.md') && (/^(README|HANDOFF|AGENTS|CLAUDE)\.md$/.test(p) || /^(docs|branding|tools)\//.test(p)) && exists(p));
const sizes = Object.fromEntries(tracked.filter(exists).map(p => [p, fs.statSync(path.join(ROOT, p)).size]));
const report = (bad: string[]) => bad.length ? '\n' + bad.join('\n') : '';

test('nama berkas dilacak: kebab-case, tanpa spasi, tanpa campur bahasa, ekstensi lazim', () => {
  const bad = checkNames(tracked);
  assert.equal(bad.length, 0, report(bad));
});

test('tidak ada .log/.bak/tmp/.DS_Store/node_modules yang dilacak git', () => {
  const bad = checkJunk(tracked);
  assert.equal(bad.length, 0, report(bad));
});

test('tautan relatif markdown (README, HANDOFF, AGENTS, docs, branding, tools) menunjuk berkas yang ada', () => {
  const bad = checkLinks(Object.fromEntries(mdFiles.map(p => [p, read(p)])), exists);
  assert.equal(bad.length, 0, report(bad));
});

test('tiap .md di docs/ ada di indeks docs/README.md', () => {
  assert.ok(exists('docs/README.md'), 'docs/README.md (indeks) belum ada. Perbaiki: buat indeks satu halaman, satu baris per dokumen.');
  const bad = checkDocsIndex(tracked, read('docs/README.md'));
  assert.equal(bad.length, 0, report(bad));
});

test('tidak ada berkas dilacak melebihi batas ukuran (gambar docs lebih ketat)', () => {
  const bad = checkSizes(sizes);
  assert.equal(bad.length, 0, report(bad));
});

// ---------------------------------------------------------------- bukti: tiap aturan gagal pada pelanggaran contoh
test('bukti: aturan nama menolak contoh pelanggaran dan menerima nama sah', () => {
  const bad = checkNames(['tools/My Script.ts', 'docs/catatan-render.md', 'apps/server/Job_Store.ts', 'tools/run.exe', 'tools/ssim_lo.sh', 'docs/Panduan.md']);
  assert.equal(bad.length, 6, report(bad));
  assert.match(bad[0], /git mv/);
  assert.deepEqual(checkNames(['tools/batch-run.ts', 'docs/evidence/styles/riso-sheet.jpg', 'README.md', 'presets/main-1.json', 'branding/png/banner_2560x1440.png']), []);
});

test('bukti: aturan sampah menolak .log, .bak, tmp, .DS_Store', () => {
  const bad = checkJunk(['x/run.log', 'data/schedule.json.bak', 'tools/tmp/a.ts', '.DS_Store', 'docs/a.md~']);
  assert.equal(bad.length, 5, report(bad));
  assert.deepEqual(checkJunk(['tools/state.ts', 'docs/a.md']), []);
});

test('bukti: aturan tautan menolak tautan rusak, melewati http, jangkar, dan kode', () => {
  const ok = new Set(['docs/a.md', 'README.md']);
  const files = { 'docs/b.md': 'Lihat [a](a.md), [r](../README.md#x), [web](https://x.test/y), [j](#bagian), dan `[k](tidak-ada.md)`.\n```\n[z](juga-tidak-ada.md)\n```' };
  assert.deepEqual(checkLinks(files, p => ok.has(p)), []);
  const bad = checkLinks({ 'docs/b.md': 'rusak: [x](hilang.md) dan ![g](gambar/hilang.png)' }, p => ok.has(p));
  assert.equal(bad.length, 2, report(bad));
  assert.match(bad[0], /docs\/hilang\.md/);
});

test('bukti: aturan indeks docs menolak dokumen yang tidak terdaftar', () => {
  const bad = checkDocsIndex(['docs/README.md', 'docs/a.md', 'docs/b.md', 'docs/evidence/x/n.md', 'README.md'], 'indeks: a.md dan evidence/x/n.md');
  assert.deepEqual(bad.map(s => s.split(':')[0]), ['docs/b.md']);
});

test('bukti: aturan ukuran menolak berkas besar dan gambar docs yang melewati batas', () => {
  const bad = checkSizes({ 'assets/big.bin': MAX_BYTES + 1, 'docs/evidence/ux/x.png': MAX_DOC_IMAGE_BYTES + 1, 'docs/evidence/ux/y.jpg': 100_000, 'branding/png/banner_2560x1440.png': MAX_BYTES - 1 });
  assert.equal(bad.length, 2, report(bad));
  assert.match(bad[1], /kompres/);
});
