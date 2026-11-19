// Style presets: a look (background + colours + font) laid over ANY style and applied to ANY scene. It never changes scene
// parameters, juice or the simulation; without a preset nothing changes; old scene-format files cannot break anything;
// files are written atomically.
import { usablePort } from './ports.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../apps/server/host.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { validate, hashFloats, type Ctx, type Env } from '../packages/core/index.ts';
import { SCENES, sceneById } from '../packages/scenes/index.ts';
import { getTheme, themeOf, applyStylePreset, sanitizeStylePreset, serializeStylePreset, captureStylePreset, CLASSIC, type StylePresetData } from '../packages/theme/index.ts';
import { toFile, checkStylePresetFile } from '../packages/theme/style-preset.ts';
import { readStylePresets, saveStylePreset, deleteStylePreset } from '../packages/theme/node.ts';
import { thumbKey } from '../apps/server/thumbs.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OCEAN: StylePresetData = {
  id: 'ocean-test', name: 'Ocean Test',
  background: { bg: ['#031c2e', '#02111e', '#000509'], bgMode: 'linear', bgAngle: 12, bgCx: 0.5, bgCy: 0.45, wall: '#9cffe8', wallGlow: '#18d6b4', lineGlow: 0.75,
    texture: { kind: 'grid', color: '#38e1e6', amount: 0.14, spacing: 40, vignette: 0.44 } },
  look: { text: '#e8fff9', accent: '#ffb347', muted: '#a8d8cf', palette: ['#38e1e6', '#9be36b', '#ffd23f', '#ff6f9a'], font: { family: '"Arial Rounded MT Bold", DejaVuSansBold', case: 'upper', align: 'left' } },
};
const PRESET = serializeStylePreset(OCEAN);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));

// ---------------- the layer ----------------
test('no preset (or an unusable one) returns the very same theme object', () => {
  for (const id of ['classic', 'riso', 'candy']) {
    const T = getTheme(id);
    for (const none of [undefined, null, '']) assert.equal(applyStylePreset(T, none), T);
    for (const bad of ['{nope', '[]', '42', '{"id":"x"}', JSON.stringify({ ...OCEAN, look: { ...OCEAN.look, text: 'red' } })]) assert.equal(applyStylePreset(T, bad), T, bad);
    assert.equal(themeOf({ style: id, bgSettings: '', stylePreset: '' }), T);
  }
});

test('capture, serialise and read back give the same preset', () => {
  const back = sanitizeStylePreset(PRESET);
  assert.deepEqual(back.warnings, []); assert.deepEqual(back.preset, OCEAN);
  assert.equal(serializeStylePreset(back.preset!), PRESET, 'stable string');
  for (const id of ['classic', 'riso', 'chalk', 'terminal', 'candy', 'blueprint']) {
    const cap = captureStylePreset(getTheme(id), 'cap-' + id, 'Cap ' + id);
    const r = sanitizeStylePreset(serializeStylePreset(cap)); assert.deepEqual(r.warnings, [], id); assert.deepEqual(r.preset, cap, id);
    // a preset captured from a style looks like that style when laid back over it
    const T = getTheme(id), A = applyStylePreset(T, serializeStylePreset(cap));
    assert.deepEqual([A.color.bg, A.color.text, A.color.wall, A.texture, A.font.family, A.palettes.cyclic], [T.color.bg, T.color.text, T.color.wall, T.texture, T.font.family, T.palettes.cyclic.slice(0, 8)], id);
  }
});

test('it overrides only the look: juice, trails, motion, audio, ball and line shapes stay the base style\'s', () => {
  for (const id of ['classic', 'riso', 'chalk', 'terminal', 'candy', 'blueprint']) {
    const T = getTheme(id), A = applyStylePreset(T, PRESET);
    assert.notEqual(A, T); assert.equal(T.color.bg[0] === '#031c2e' && id !== 'classic', false, 'the base theme object is not mutated');
    assert.deepEqual(A.color.bg, OCEAN.background.bg); assert.equal(A.color.accent, '#ffb347'); assert.equal(A.font.family, OCEAN.look.font.family);
    assert.equal(A.font.case, 'upper'); assert.deepEqual(A.palettes.cyclic, OCEAN.look.palette); assert.equal(A.texture.kind, 'grid'); assert.equal(A.line.glow, 0.75);
    for (const k of ['motion', 'audio', 'comet', 'trail', 'ball', 'spark', 'focus'] as const) assert.deepEqual(A[k], T[k], `${id}: ${k} untouched`);
    assert.deepEqual({ ...A.juice, blend: '' }, { ...T.juice, blend: '' }, `${id}: juice untouched (only its blend follows the light/dark switch)`);
    assert.equal(A.line.style, T.line.style); assert.equal(A.line.width, T.line.width);
    assert.deepEqual(A.palettes.spectrum, T.palettes.spectrum);
  }
});

test('a dark look on a light style (and back) switches the blend so lines stay visible', () => {
  const riso = getTheme('riso'), onRiso = applyStylePreset(riso, PRESET);
  assert.equal(riso.blend, 'multiply'); assert.equal(onRiso.dark, true); assert.equal(onRiso.blend, 'lighter'); assert.equal(onRiso.juice.blend, 'lighter');
  const light: StylePresetData = { ...OCEAN, id: 'paper-test', name: 'Paper', background: { ...OCEAN.background, bg: ['#f6eedf', '#efe3cc'] } };
  const onClassic = applyStylePreset(CLASSIC, serializeStylePreset(light));
  assert.equal(onClassic.dark, false); assert.equal(onClassic.blend, 'source-over'); assert.equal(onClassic.juice.blend, 'source-over');
  assert.equal(applyStylePreset(CLASSIC, PRESET).blend, 'lighter', 'dark on dark: unchanged');
});

test('themeOf: the preset wins over background settings', () => {
  const T = themeOf({ style: 'classic', bgSettings: '{"top":"#102030"}', stylePreset: PRESET });
  assert.deepEqual(T.color.bg, OCEAN.background.bg);
});

// ---------------- any scene ----------------
const S = 0.25, env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: S };
function render(id: string, p: Record<string, unknown>) {
  const s = sceneById(id)!, inst = s.create(env, validate(s.schema, p).params);
  const c = createCanvas(Math.round(1080 * S), Math.round(1920 * S)), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(S, 0, 0, S, 0, 0);
  inst.renderFrame(ctx, 90);
  return { c, state: hashFloats(inst.stateVector!()) };
}
const px = (c: any, x: number, y: number) => [...c.getContext('2d').getImageData(x, y, 1, 1).data].join(',');
const W = Math.round(1080 * S), H = Math.round(1920 * S);

test('the same preset gives three different scenes the same background, colours and font', () => {
  const ids = ['focal-reflection', 'galton-board', 'billiard'];
  const tokens = ids.map(id => { const T = themeOf(validate(sceneById(id)!.schema, { stylePreset: PRESET }).params); return JSON.stringify([T.color.bg, T.color.text, T.color.accent, T.color.wall, T.palettes.cyclic, T.font, T.texture]); });
  assert.equal(new Set(tokens).size, 1, 'identical tokens in every scene');
  const corners = ids.map(id => { const { c } = render(id, { stylePreset: PRESET }); return [px(c, 2, H - 3), px(c, W - 3, H - 3), px(c, 2, 2), px(c, W - 3, 2)].join('|'); });
  assert.equal(new Set(corners).size, 1, `background pixels agree in every scene: ${corners.join(' / ')}`);
  const plain = ids.map(id => { const { c } = render(id, {}); return px(c, 2, H - 3); });
  assert.notEqual(plain[0], corners[0].split('|')[0], 'and they differ from the same scenes without the preset');
});

test('scene parameters and the simulation do not change', () => {
  for (const s of SCENES) {
    const a = validate(s.schema, {}).params, b = validate(s.schema, { stylePreset: PRESET }).params;
    assert.deepEqual({ ...b, stylePreset: '' }, a, `${s.meta.id}: only stylePreset differs`);
    const A = render(s.meta.id, {}), B = render(s.meta.id, { stylePreset: PRESET });
    assert.equal(A.state, B.state, `${s.meta.id}: simulation state identical`);
  }
});

test('it lays over every style in every scene without a warning and changes the picture', () => {
  for (const style of ['classic', 'riso', 'chalk', 'terminal', 'candy', 'blueprint']) {
    const a = render('galton-board', { style }).c, b = render('galton-board', { style, stylePreset: PRESET }).c;
    assert.notEqual(px(a, 2, H - 3), px(b, 2, H - 3), `${style}: background changed`);
  }
});

test('thumbnail keys: unchanged without a preset, different with one', () => {
  const k0 = thumbKey('galton-board', {}), k1 = thumbKey('galton-board', { stylePreset: '' }), k2 = thumbKey('galton-board', { stylePreset: PRESET });
  assert.equal(k0, k1); assert.notEqual(k0, k2);
});

// ---------------- files ----------------
const sceneFormat = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'presets', 'billiard-square.json'), 'utf8'));
test('old scene-format files and broken files are ignored with a clear message, valid ones still load', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ocean-test.json'), JSON.stringify(toFile(OCEAN, 'classic')));
  fs.writeFileSync(path.join(dir, 'old-scene.json'), JSON.stringify(sceneFormat()));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(dir, 'future.json'), JSON.stringify({ ...toFile(OCEAN, 'classic'), id: 'future', version: 99 }));
  fs.writeFileSync(path.join(dir, 'wrongname.json'), JSON.stringify(toFile(OCEAN, 'classic')));
  fs.writeFileSync(path.join(dir, 'badcolour.json'), JSON.stringify({ ...toFile(OCEAN, 'classic'), id: 'badcolour', look: { ...OCEAN.look, text: 'red' } }));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  const r = readStylePresets(dir);
  assert.deepEqual(r.presets.map(p => p.id), ['ocean-test']);
  const msg = Object.fromEntries(r.problems.map(p => [p.file, p.message]));
  assert.match(msg['old-scene.json'], /scene preset/); assert.match(msg['broken.json'], /not valid JSON/); assert.match(msg['future.json'], /version/);
  assert.match(msg['wrongname.json'], /file name/); assert.match(msg['badcolour.json'], /look\.text/);
  assert.equal(r.problems.length, 5);
  assert.deepEqual(readStylePresets(path.join(dir, 'missing')), { presets: [], problems: [] }, 'a missing folder is fine');
  assert.equal(checkStylePresetFile(sceneFormat()).ok, false);
  fs.rmSync(dir, { recursive: true });
});

test('saving is atomic, never overwrites by accident, and leaves no temporary files', () => {
  const dir = tmp(), f = toFile(OCEAN, 'classic');
  saveStylePreset(f, dir);
  assert.deepEqual(fs.readdirSync(dir), ['ocean-test.json']);
  const before = fs.readFileSync(path.join(dir, 'ocean-test.json'), 'utf8');
  assert.throws(() => saveStylePreset({ ...f, name: 'Other' }, dir), /already exists/);
  assert.equal(fs.readFileSync(path.join(dir, 'ocean-test.json'), 'utf8'), before, 'untouched');
  assert.deepEqual(fs.readdirSync(dir), ['ocean-test.json'], 'no .tmp left after a refusal');
  saveStylePreset({ ...f, name: 'Other' }, dir, true);
  assert.equal(readStylePresets(dir).presets[0].name, 'Other');
  assert.deepEqual(fs.readdirSync(dir), ['ocean-test.json']);
  for (const id of ['../x', 'a/b', 'A', '', 'x']) assert.throws(() => saveStylePreset({ ...f, id }, dir), /cannot be used/, id);
  fs.rmSync(dir, { recursive: true });
});

test('delete removes a style preset and nothing else', () => {
  const dir = tmp();
  saveStylePreset(toFile(OCEAN, 'classic'), dir);
  fs.writeFileSync(path.join(dir, 'old-scene.json'), JSON.stringify(sceneFormat()));
  assert.throws(() => deleteStylePreset('old-scene', dir), /leaves it alone/);
  assert.throws(() => deleteStylePreset('../old-scene', dir), /Unknown/);
  assert.throws(() => deleteStylePreset('nothing-here', dir), /no longer exists/);
  deleteStylePreset('ocean-test', dir);
  assert.deepEqual(fs.readdirSync(dir), ['old-scene.json']);
  fs.rmSync(dir, { recursive: true });
});

// ---------------- API, end to end in throw-away folders ----------------
const A = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-sp-api-'));
const PORT = usablePort(5990 + Math.floor(Math.random() * 40)), /* fetch refuses some ports (tests/ports.ts) */ BASE = `http://127.0.0.1:${PORT}`;
const SPDIR = path.join(A, 'style-presets'), PRDIR = path.join(A, 'presets');
let server: ChildProcess | null = null, log = '';
before(async () => {
  for (const d of ['data', 'out', 'style-presets', 'presets']) fs.mkdirSync(path.join(A, d));
  fs.copyFileSync(path.join(ROOT, 'presets', 'billiard-square.json'), path.join(PRDIR, 'billiard-square.json'));
  fs.writeFileSync(path.join(PRDIR, 'broken.json'), '{ nope');
  fs.writeFileSync(path.join(PRDIR, 'no-scene.json'), JSON.stringify({ kind: 'style-preset', id: 'x' }));
  fs.writeFileSync(path.join(PRDIR, 'ghost-scene.json'), JSON.stringify({ sceneId: 'does-not-exist', params: {} }));
  server = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME: path.join(A, 'home'), PORT: String(PORT), SIM_DATA_DIR: path.join(A, 'data'), SIM_OUT_DIR: path.join(A, 'out'), SIM_STYLE_PRESET_DIR: SPDIR, SIM_PRESETS_DIR: PRDIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.on('data', d => { log += d; }); server.stderr!.on('data', d => { log += d; });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${BASE}/api/style-presets`)).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('studio did not start:\n' + log);
});
after(() => { server?.kill(); fs.rmSync(A, { recursive: true, force: true }); });
const api = async (method: string, p: string, body?: unknown) => { const r = await fetch(BASE + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) as any }; };

test('API: save, list, replace, delete style presets; scene-format files are reported and left alone', async () => {
  fs.writeFileSync(path.join(SPDIR, 'old-scene.json'), JSON.stringify(sceneFormat()));
  const empty = await api('GET', '/api/style-presets');
  assert.equal(empty.status, 200); assert.deepEqual(empty.j.presets, []); assert.match(empty.j.problems[0].message, /scene preset/);
  const { id: _i, name: _n, ...look } = OCEAN;
  const ok = await api('POST', '/api/style-presets', { name: 'API Look', preset: look, basedOn: 'classic' });
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.id, 'api-look');
  const saved = ok.j.presets.find((p: any) => p.id === 'api-look');
  assert.equal(sanitizeStylePreset(saved.value).preset?.name, 'API Look'); assert.deepEqual(sanitizeStylePreset(saved.value).preset?.background, OCEAN.background);
  assert.ok(fs.existsSync(path.join(SPDIR, 'api-look.json'))); assert.equal(fs.existsSync(path.join(ROOT, 'style-presets', 'api-look.json')), false, 'the real folder was not touched');
  assert.deepEqual(fs.readdirSync(SPDIR).filter(f => f.endsWith('.tmp')), []);
  assert.equal((await api('POST', '/api/style-presets', { name: 'API Look', preset: look })).status, 409, 'same name is refused');
  assert.equal((await api('POST', '/api/style-presets', { name: 'API Look', preset: { ...look, look: { ...look.look, accent: '#000000' } }, overwrite: true })).status, 200);
  assert.equal(sanitizeStylePreset((await api('GET', '/api/style-presets')).j.presets[0].value).preset?.look.accent, '#000000');
  // refused: no name, a bad value, a scene-format body
  assert.equal((await api('POST', '/api/style-presets', { name: '  ', preset: look })).status, 400);
  assert.equal((await api('POST', '/api/style-presets', { name: 'Bad', preset: { ...look, look: { ...look.look, text: 'red' } } })).status, 400);
  assert.equal((await api('POST', '/api/style-presets', { name: 'Scene', preset: sceneFormat() })).status, 400);
  // delete: only style presets
  assert.equal((await api('DELETE', '/api/style-presets/old-scene')).status, 409); assert.ok(fs.existsSync(path.join(SPDIR, 'old-scene.json')));
  assert.equal((await api('DELETE', '/api/style-presets/api-look')).status, 200); assert.equal(fs.existsSync(path.join(SPDIR, 'api-look.json')), false);
  assert.equal((await api('DELETE', '/api/style-presets/api-look')).status, 409);
});

test('API: bad files in presets/ never break the gallery, and saving a scene preset is gone', async () => {
  const g = await api('GET', '/api/gallery');
  assert.equal(g.status, 200); assert.ok(Array.isArray(g.j));
  assert.deepEqual(g.j.filter((i: any) => i.kind === 'preset').map((i: any) => i.name), ['billiard-square']);
  const list = await api('GET', '/api/presets'); assert.equal(list.status, 200); assert.deepEqual(list.j.map((p: any) => p.name), ['billiard-square']);
  const post = await api('POST', '/api/presets', { name: 'x', sceneId: 'billiard', params: {} });
  assert.notEqual(post.status, 200); assert.equal(fs.existsSync(path.join(PRDIR, 'x.json')), false);
});

test('the style presets that ship in style-presets/ are all valid, and the scene presets are untouched by them', () => {
  const r = readStylePresets();
  assert.deepEqual(r.problems, [], 'no ignored file in the real folder');
  assert.ok(r.presets.some(p => p.id === 'main-1'));
  const scene = fs.readdirSync(path.join(ROOT, 'presets')).filter(f => f.endsWith('.json'));
  assert.equal(scene.length, 31); assert.equal(scene.includes('main-1.json'), false);
});
