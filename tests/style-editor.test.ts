// Style editor: forms become ordinary theme files; shipped styles are never overwritten or deleted; a custom style renders
// every scene without touching the simulation; the API works end to end in a throw-away themes folder.
import { usablePort } from './ports.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import { validate, hashFloats, type Ctx, type Env } from '../packages/core/index.ts';
import { SCENES } from '../packages/scenes/index.ts';
import { CLASSIC, resolveTheme, registerThemes, getTheme, unregisterTheme } from '../packages/theme/index.ts';
import { readEdit, buildStyle, checkEdit, checkCustomFile, slugify, validId, contrast, FONT_CHOICES, type StyleEdit } from '../packages/theme/editor.ts';
import { readThemeFiles, saveCustomTheme, deleteCustomTheme, customSig, THEME_DIR } from '../packages/theme/node.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const shipped = (id: string) => readThemeFiles().list.find((t: any) => t.id === id) as any;
const classicEdit = (): StyleEdit => readEdit(CLASSIC);

test('slugs and ids are safe file names', () => {
  assert.equal(slugify('My Cool Style!'), 'my-cool-style');
  assert.equal(slugify('  Ünïcode  Éxample '), 'unicode-example');
  assert.equal(slugify('!!'), 'my-style');
  assert.ok(slugify('x'.repeat(80)).length <= 32);
  for (const bad of ['../etc', 'a/b', 'A', 'x', '', 'a b', '-a', 'a'.repeat(33), null, 5]) assert.equal(validId(bad), false, String(bad));
  for (const ok of ['my-style', 'a1', 'candy-2']) assert.equal(validId(ok), true);
});

test('a form becomes a complete theme file that the resolver accepts without a single warning', () => {
  for (const base of [undefined, shipped('candy'), shipped('terminal'), shipped('blueprint')]) {
    const t = resolveTheme(base ?? { id: 'classic' }).theme;
    const e = { ...readEdit(t), name: 'Test style', accent: '#ff00aa', font: 'mono', line: 'flat', texture: 'grid' };
    const raw = buildStyle(base, e, 'test-style', (base as any)?.id ?? 'classic');
    const c = checkCustomFile(raw); assert.ok(c.ok, JSON.stringify(c));
    const r = resolveTheme(raw); assert.deepEqual(r.warnings, []);
    assert.equal(r.theme.color.accent, '#ff00aa'); assert.equal(r.theme.font.family, FONT_CHOICES.find(f => f.id === 'mono')!.family);
    assert.equal(r.theme.line.style, 'flat'); assert.equal(r.theme.texture.kind, 'grid');
    assert.equal((raw as any).custom, true); assert.equal((raw as any).id, 'test-style');
    assert.ok(String((raw as any).font.family).endsWith('DejaVuSansMonoBold'), 'always ends with a bundled font');
  }
});

test('the base style is not modified, and the file keeps its background controls', () => {
  const candy = shipped('candy'), before = JSON.stringify(candy);
  const raw = buildStyle(candy, { ...readEdit(resolveTheme(candy).theme), name: 'x2' }, 'x2', 'candy');
  assert.equal(JSON.stringify(candy), before);
  assert.deepEqual((raw as any).background, candy.background);
  assert.equal((buildStyle(undefined, classicEdit(), 'abc', 'classic') as any).background, undefined, 'classic has none to keep');
});

test('going from a dark to a light background switches the blend away from additive light (and back)', () => {
  const light = buildStyle(undefined, { ...classicEdit(), bg0: '#f6eedf', bg1: '#efe3cc', text: '#222222' }, 'lite', 'classic') as any;
  assert.equal(light.dark, false); assert.equal(light.blend, 'source-over'); assert.equal(light.juice.blend, 'source-over');
  const dark = buildStyle(shipped('candy'), { ...readEdit(resolveTheme(shipped('candy')).theme), bg0: '#101030', bg1: '#000010' }, 'dk', 'candy') as any;
  assert.equal(dark.dark, true); assert.equal(dark.blend, 'lighter');
  const same = buildStyle(undefined, classicEdit(), 'same', 'classic') as any;
  assert.equal(same.blend, CLASSIC.blend, 'no change of class, no change of blend');
});

test('the check: errors block saving, hints only advise', () => {
  assert.deepEqual(checkEdit(classicEdit()).errors, []);
  assert.ok(checkEdit({ ...classicEdit(), name: ' ' }).errors.length);
  assert.ok(checkEdit({ ...classicEdit(), accent: 'red' }).errors[0].includes('accent'));
  assert.ok(checkEdit({ ...classicEdit(), palette: ['#ffffff', '#000000'] }).errors.length, 'a palette needs 3 colours');
  const low = checkEdit({ ...classicEdit(), text: '#0a0a30' });
  assert.equal(low.ok, true); assert.ok(low.hints.some(h => /text colour/.test(h)));
  assert.ok(checkEdit({ ...classicEdit(), palette: ['#05061f', '#06072a', '#070830'] }).hints.some(h => /ball colour/.test(h)));
  assert.ok(contrast('#ffffff', '#000000') > 20 && contrast('#777777', '#777777') === 1);
});

test('the server-side file check refuses broken or unsafe styles', () => {
  const good = buildStyle(undefined, classicEdit(), 'good', 'classic');
  assert.ok(checkCustomFile(good).ok);
  assert.equal(checkCustomFile({ ...good, id: '../evil' }).ok, false);
  assert.equal(checkCustomFile({ ...good, name: '' }).ok, false);
  assert.equal(checkCustomFile({ ...good, line: { style: 'laser', width: 1, glow: 1 } }).ok, false);
  assert.equal(checkCustomFile({ ...good, color: { ...(good as any).color, text: 'red' } }).ok, false);
  assert.equal(checkCustomFile(null).ok, false); assert.equal(checkCustomFile([]).ok, false);
});

// ---------------- files ----------------
function tmpThemes() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-themes-')); for (const f of fs.readdirSync(THEME_DIR)) if (f.endsWith('.json')) fs.copyFileSync(path.join(THEME_DIR, f), path.join(d, f)); return d; }

test('files: save, overwrite your own, never a shipped one; delete only your own; no path tricks', () => {
  const d = tmpThemes();
  const mine = buildStyle(undefined, { ...classicEdit(), name: 'Mine' }, 'mine', 'classic');
  saveCustomTheme(mine, d);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'mine.json'), 'utf8')).custom, true);
  saveCustomTheme({ ...mine, concept: 'changed' }, d); // own style: allowed
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'mine.json'), 'utf8')).concept, 'changed');
  for (const id of ['candy', 'riso', 'classic']) assert.throws(() => saveCustomTheme({ ...mine, id }, d), /shipped|cannot/i, id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'candy.json'), 'utf8')).custom, undefined, 'candy is untouched');
  for (const id of ['../x', 'a/b', '..']) assert.throws(() => saveCustomTheme({ ...mine, id }, d));
  assert.throws(() => deleteCustomTheme('candy', d), /Only styles made/);
  assert.ok(fs.existsSync(path.join(d, 'candy.json')));
  deleteCustomTheme('mine', d); assert.equal(fs.existsSync(path.join(d, 'mine.json')), false);
  assert.throws(() => deleteCustomTheme('mine', d), /no longer exists/);
  assert.equal(fs.readdirSync(d).filter(f => f.endsWith('.tmp')).length, 0, 'no temp files left');
  fs.rmSync(d, { recursive: true, force: true });
});

test('thumbnail cache: only custom styles carry a signature, and it changes when the style changes', () => {
  const d = tmpThemes();
  assert.equal(customSig('candy', d), '', 'shipped keys stay as they were');
  assert.equal(customSig('nope', d), ''); assert.equal(customSig('../x', d), '');
  const a = buildStyle(undefined, { ...classicEdit(), name: 'Sig' }, 'sig', 'classic');
  saveCustomTheme(a, d); const s1 = customSig('sig', d); assert.match(s1, /^[0-9a-f]{8}$/);
  saveCustomTheme({ ...a, accent: '#00ff00' }, d); assert.notEqual(customSig('sig', d), s1);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---------------- rendering ----------------
const S = 0.25, env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: S };
function frame(id: string, p: Record<string, unknown>, f: number) {
  const s = SCENES.find(x => x.meta.id === id)!, inst = s.create(env, validate(s.schema, p).params);
  const c = createCanvas(Math.round(1080 * S), Math.round(1920 * S)), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(S, 0, 0, S, 0, 0);
  inst.renderFrame(ctx, Math.floor(inst.frames * f)); return { px: c.data(), state: hashFloats(inst.stateVector!()) };
}
test('a custom style renders every scene; it changes the picture and never the simulation', () => {
  const e = { ...readEdit(CLASSIC), name: 'Render test', bg0: '#2a0a3a', bg1: '#0a0220', accent: '#7cff6b', palette: ['#ff4fa3', '#ffd23f', '#38e1e6'], line: 'flat', ball: 'flat', texture: 'grid', font: 'serif' } as StyleEdit;
  registerThemes([{ ...buildStyle(undefined, e, 'render-test', 'classic') }]);
  try {
    assert.equal(getTheme('render-test').id, 'render-test');
    for (const s of SCENES) {
      const a = frame(s.meta.id, { style: 'classic' }, 0.4), b = frame(s.meta.id, { style: 'render-test' }, 0.4);
      assert.equal(b.state, a.state, `${s.meta.id}: the simulation is identical`);
      let diff = 0; for (let i = 0; i < a.px.length; i += 4) diff += Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]);
      assert.ok(diff / (a.px.length / 4) > 6, `${s.meta.id}: the picture really changes`);
    }
  } finally { unregisterTheme('render-test'); }
  assert.equal(getTheme('render-test'), CLASSIC, 'forgotten styles fall back to classic');
});

// ---------------- API, end to end in a throw-away themes folder ----------------
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-style-api-'));
const PORT = usablePort(5950 + Math.floor(Math.random() * 40)), BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null, log = '';
before(async () => {
  const themes = path.join(T, 'themes'); fs.mkdirSync(themes); for (const f of fs.readdirSync(THEME_DIR)) if (f.endsWith('.json')) fs.copyFileSync(path.join(THEME_DIR, f), path.join(themes, f));
  fs.mkdirSync(path.join(T, 'data')); fs.mkdirSync(path.join(T, 'out'));
  server = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME: path.join(T, 'home'), PORT: String(PORT), SIM_DATA_DIR: path.join(T, 'data'), SIM_OUT_DIR: path.join(T, 'out'), SIM_THEME_DIR: themes }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.on('data', d => { log += d; }); server.stderr!.on('data', d => { log += d; });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${BASE}/api/themes`)).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('studio did not start:\n' + log);
});
after(() => { server?.kill(); fs.rmSync(T, { recursive: true, force: true }); });
const api = async (method: string, p: string, body?: unknown) => { const r = await fetch(BASE + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() as any }; };

test('API: a new style appears in the list at once, shipped styles are protected, delete removes only your own', async () => {
  const ids = async () => (await api('GET', '/api/themes')).j.themes.map((t: any) => t.id);
  assert.ok((await ids()).includes('candy'));
  const mine = buildStyle(shipped('candy'), { ...readEdit(resolveTheme(shipped('candy')).theme), name: 'API Style' }, 'api-style', 'candy');
  const ok = await api('POST', '/api/themes', { theme: mine });
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.id, 'api-style');
  assert.ok((await ids()).includes('api-style'));
  assert.equal(ok.j.themes.find((t: any) => t.id === 'api-style').warnings.length, 0);
  assert.ok(fs.existsSync(path.join(T, 'themes', 'api-style.json')));
  assert.equal(fs.existsSync(path.join(THEME_DIR, 'api-style.json')), false, 'the real themes folder was not touched');
  // refused
  assert.equal((await api('POST', '/api/themes', { theme: { ...mine, id: 'candy' } })).status, 409);
  assert.equal((await api('POST', '/api/themes', { theme: { ...mine, id: 'classic' } })).status, 409);
  assert.equal((await api('POST', '/api/themes', { theme: { ...mine, id: '../x' } })).status, 400);
  assert.equal((await api('POST', '/api/themes', { theme: { ...mine, id: 'bad-one', line: { style: 'laser', width: 1, glow: 1 } } })).status, 400);
  assert.equal((await api('DELETE', '/api/themes/candy')).status, 409);
  assert.ok(fs.existsSync(path.join(T, 'themes', 'candy.json')));
  // the saved style renders in the style thumbnails list
  const th = await api('GET', '/api/style-thumbs?sceneId=galton-board&params={}');
  assert.ok(th.j.some((x: any) => x.style === 'api-style'));
  // delete your own
  const del = await api('DELETE', '/api/themes/api-style');
  assert.equal(del.status, 200); assert.ok(!(await ids()).includes('api-style'));
  assert.equal(fs.existsSync(path.join(T, 'themes', 'api-style.json')), false);
});
