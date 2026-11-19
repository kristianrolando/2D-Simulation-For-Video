// Hand-over folder maker (branding/pack.mjs): the real kit passes every check, and each check really fails on a planted problem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const pack = (...a: string[]) => spawnSync(process.execPath, ['branding/pack.mjs', ...a], { cwd: ROOT, encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-'));

let good = '';
test('the real kit builds from the brand JSON and passes all checks (0 forbidden words)', () => {
  const out = tmp(); const r = pack('fourier-loom', '--out', out, '--no-build');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 findings/); assert.match(r.stdout, /all checks passed/);
  good = path.join(out, 'channel-kit-fourier-loom');
  for (const f of ['README.md', '1-foto-profil/profile_800.png', '2-banner/banner_2560x1440.png', '2-banner/banner_2560x1440.jpg', '3-watermark/watermark_150.png', '4-teks-siap-tempel/deskripsi-channel.txt', 'B-cadangan/2-banner/banner_2560x1440.png', '5-contoh-sampul-video/contoh-1-sampul-tegak-1080x1920.jpg'])
    assert.ok(fs.existsSync(path.join(good, f)), f);
  assert.ok(fs.existsSync(good + '.zip'));
  assert.ok(!fs.readdirSync(good).some((n) => /DS_Store|MACOSX/.test(n)));
});

const broken = (mutate: (dir: string) => void) => { const d = tmp(); const c = path.join(d, 'kit'); fs.cpSync(good, c, { recursive: true }); mutate(c); return pack('--check', c); };

test('(a) another channel name, an internal term or a personal path in a text file fails', () => {
  for (const bad of ['Inspired by Photon Lab', 'made with the studio preset', 'see /Users/someone/file']) {
    const r = broken((c) => fs.appendFileSync(path.join(c, 'README.md'), '\n' + bad + '\n'));
    assert.equal(r.status, 1, bad); assert.match(r.stderr, /forbidden/);
  }
});
test('(a) a forbidden word in a file name fails; "YouTube Studio" alone is allowed', () => {
  assert.equal(broken((c) => fs.writeFileSync(path.join(c, 'plasma-notes.txt'), 'x')).status, 1);
  assert.equal(broken((c) => fs.appendFileSync(path.join(c, 'README.md'), '\nBuka YouTube Studio.\n')).status, 0);
});
test('(a) a forbidden word hidden in picture metadata fails', () => {
  const r = broken((c) => fs.appendFileSync(path.join(c, '3-watermark/watermark_150.png'), 'made for Photon Lab'));
  assert.equal(r.status, 1);
});
test('(b) a wrong picture size fails', () => {
  const r = broken((c) => fs.copyFileSync(path.join(c, '3-watermark/watermark_150.png'), path.join(c, '1-foto-profil/profile_800.png')));
  assert.equal(r.status, 1); assert.match(r.stderr, /wrong size/);
});
test('(c) a file named in the README that is missing fails', () => {
  const r = broken((c) => fs.rmSync(path.join(c, '3-watermark/watermark_150.png')));
  assert.equal(r.status, 1); assert.match(r.stderr, /missing file/);
});
test('(d) a README that is far too long fails', () => {
  const r = broken((c) => fs.appendFileSync(path.join(c, 'README.md'), 'baris\n'.repeat(60)));
  assert.equal(r.status, 1); assert.match(r.stderr, /README has/);
});
test('(e) the pictures carry no text, EXIF or comment chunks', () => {
  const png = fs.readFileSync(path.join(good, '1-foto-profil/profile_800.png')).toString('latin1');
  assert.ok(!/tEXt|iTXt|zTXt|eXIf/.test(png));
  const jpg = fs.readFileSync(path.join(good, '2-banner/banner_2560x1440.jpg'));
  assert.ok(!jpg.toString('latin1').includes('Exif') && !jpg.toString('latin1').includes('http://ns.adobe.com'));
});
