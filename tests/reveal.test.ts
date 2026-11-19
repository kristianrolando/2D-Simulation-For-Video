// "Show MP4 in folder": the rule for which file may be opened (a plain name inside output/), and the real route with a long video and with
// dangerous names. SIM_NO_OPEN keeps the test from opening a file manager.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { usablePort } from './ports.ts';
import { revealTarget } from '../apps/server/reveal.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-reveal-')), OUT = path.join(T, 'out');
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['long-hammer-smash-box-part-1.mp4', 'long-hammer-smash-box-part-1-thumbnail.jpg', 'long-hammer-smash-box-part-1.txt', 'short render 2026.mp4']) fs.writeFileSync(path.join(OUT, f), 'x');
fs.mkdirSync(path.join(T, 'data', 'thumbnails'), { recursive: true }); for (const f of ['v-1.jpg', 'v-1-cover.jpg']) fs.writeFileSync(path.join(T, 'data', 'thumbnails', f), 'x');
fs.mkdirSync(path.join(OUT, 'folder.mp4')); fs.writeFileSync(path.join(T, 'secret.mp4'), 'secret');
let proc: ChildProcess | null = null;
after(() => { proc?.kill('SIGKILL'); fs.rmSync(T, { recursive: true, force: true }); });

test('a long video, its thumbnail and its text file can be shown; Shorts keep working', () => {
  for (const n of ['long-hammer-smash-box-part-1.mp4', 'long-hammer-smash-box-part-1-thumbnail.jpg', 'long-hammer-smash-box-part-1.txt', 'short render 2026.mp4']) assert.deepEqual(revealTarget(OUT, n), { ok: true, file: path.join(OUT, n) }, n);
});
test('anything that is not a plain name inside output/ is refused before the disk is looked at', () => {
  for (const n of ['../secret.mp4', '..', '/etc/passwd', path.join(T, 'secret.mp4'), 'a/b.mp4', '..\\secret.mp4', 'x\0.mp4', '', undefined, null, 42, 'run.sh', 'long.mp4/../../secret.mp4', '.hidden.mp4', 'a..b.mp4'])
    assert.equal(revealTarget(OUT, n).ok, false, String(n)), assert.equal((revealTarget(OUT, n) as { status: number }).status, 400);
  assert.deepEqual(revealTarget(OUT, 'gone.mp4'), { ok: false, status: 404, error: 'That file is no longer in output/.' });
  assert.equal((revealTarget(OUT, 'folder.mp4') as { status: number }).status, 404, 'a folder is not a file');
});
test('the studio route: a long video is accepted, dangerous names are refused, a missing file says so', { timeout: 120000 }, async () => {
  const port = usablePort(8420 + Math.floor(Math.random() * 60)), base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME: path.join(T, 'home'), PORT: String(port), SIM_DATA_DIR: path.join(T, 'data'), SIM_OUT_DIR: OUT, SIM_NO_OPEN: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/jobs')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  const post = async (file: unknown) => { const r = await fetch(base + '/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file }) }); return { status: r.status, body: (await r.json()) as { ok?: boolean; path?: string; error?: string } }; };
  const ok = await post('long-hammer-smash-box-part-1.mp4'); assert.equal(ok.status, 200); assert.equal(ok.body.ok, true); assert.equal(ok.body.path, path.join(OUT, 'long-hammer-smash-box-part-1.mp4'));
  for (const bad of ['../secret.mp4', path.join(T, 'secret.mp4'), 'a/b.mp4']) { const r = await post(bad); assert.equal(r.status, 400, bad); assert.match(r.body.error ?? '', /not a file name/); }
  // the picture files: { where: 'thumbnails' } looks inside data/thumbnails only, with the same rule for names
  const pic = async (file: unknown) => { const r = await fetch(base + '/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, where: 'thumbnails' }) }); return { status: r.status, body: (await r.json()) as { ok?: boolean; path?: string; error?: string } }; };
  for (const f of ['v-1.jpg', 'v-1-cover.jpg']) { const r = await pic(f); assert.equal(r.status, 200, f); assert.equal(r.body.path, path.join(T, 'data', 'thumbnails', f)); }
  for (const bad of ['../videos.json', '../../secret.mp4', path.join(T, 'secret.mp4'), '/etc/passwd', 'a/b.jpg', '..\\x.jpg', '']) assert.equal((await pic(bad)).status, 400, `thumbnails: ${bad}`);
  assert.equal((await pic('nope.jpg')).status, 404, 'an unknown picture says so');
  assert.equal((await pic('long-hammer-smash-box-part-1.mp4')).status, 404, 'a file of output/ is not looked for in thumbnails');
  const gone = await post('long-gone.mp4'); assert.equal(gone.status, 404); assert.match(gone.body.error ?? '', /no longer in output/);
});
test('the long video detail has the same "Show MP4 in folder" button and calls the same route', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'apps/studio/compile-ui.ts'), 'utf8'), shorts = fs.readFileSync(path.join(ROOT, 'apps/studio/videos.ts'), 'utf8');
  assert.match(ui, /'Show MP4 in folder'/); assert.match(ui, /\/api\/reveal/); assert.match(shorts, /'Show MP4 in folder'/);
  assert.match(ui, /className: 'msg bad'/, 'an error is shown, not swallowed');
});
test('every "Show MP4 in folder" has its picture buttons from ONE shared function, with the thumbnails payload; no second pair on the same screen', () => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8'), yt = read('apps/studio/youtube-ui.ts'), shorts = read('apps/studio/videos.ts'), long = read('apps/studio/compile-ui.ts');
  assert.match(shorts, /revealImageButtons\(v,/); assert.match(long, /revealImageButtons\(v,/);
  assert.match(yt, /where: 'thumbnails'/); assert.match(yt, /'Show cover in folder'/); assert.match(yt, /'Show thumbnail in folder'/);
  assert.match(yt, /Cover 1080×1920: the picture uploaded for Shorts/); assert.match(yt, /Thumbnail 1280×720/);
  assert.equal((yt.match(/mk\('Show cover in folder'/g) ?? []).length, 1, 'defined once'); assert.ok(!/Show MP4 in folder/.test(yt), 'the by-hand box no longer repeats the header buttons');
  assert.match(yt, /why\) \{ b\.disabled = true;/, 'no picture: the button is off and says why');
});
