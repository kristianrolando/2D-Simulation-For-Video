// Style themes: loading, token fallback, and the guarantee that a theme changes only the look and sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import { validate, hashFloats, type Ctx, type Env } from '../packages/core/index.ts';
import { SCENES } from '../packages/scenes/index.ts';
import { CLASSIC, resolveTheme, registerThemes, getTheme, themeOf, themeIds, paletteFor } from '../packages/theme/index.ts';
import { readThemeFiles } from '../packages/theme/node.ts';

const NEW = ['riso', 'chalk', 'terminal', 'candy', 'blueprint'];

test('every theme file loads cleanly (no invalid or missing tokens)', () => {
  const { list, errors } = readThemeFiles();
  assert.deepEqual(errors, []);
  const ids = list.map((t: any) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'theme ids are unique');
  for (const id of NEW) assert.ok(ids.includes(id), `themes/${id}.json exists`);
  for (const raw of list) {
    const { theme, warnings } = resolveTheme(raw);
    assert.deepEqual(warnings, [], `${theme.id} has no invalid tokens`);
    assert.ok(theme.name && theme.concept && theme.bestFor && theme.icon, `${theme.id} documents itself`);
  }
  for (const id of NEW) assert.ok(themeIds().includes(id), `${id} registered by the host`);
});

test('missing tokens fall back to classic, one by one', () => {
  const { theme, warnings } = resolveTheme({ id: 'partial', color: { accent: '#123456' }, font: { align: 'left' } });
  assert.deepEqual(warnings, []);
  assert.equal(theme.color.accent, '#123456');
  assert.equal(theme.font.align, 'left');
  assert.equal(theme.color.text, CLASSIC.color.text, 'unspecified colour = classic');
  assert.deepEqual(theme.palettes, CLASSIC.palettes, 'unspecified palettes = classic');
  assert.deepEqual(theme.audio, CLASSIC.audio, 'unspecified audio = classic');
  const empty = resolveTheme({});
  const { background: _a, ...e } = empty.theme, { background: _b, ...c } = CLASSIC;
  assert.deepEqual({ ...e, id: 'classic' }, c);
  assert.deepEqual(empty.theme.background, { params: {}, presets: [] }, 'a style without a spec has no background controls');
});

test('invalid tokens are rejected individually and reported', () => {
  const { theme, warnings } = resolveTheme({
    id: 'broken', color: { text: 'red', bg: [], accent: '#00ff00' }, line: { style: 'laser' }, font: { titleSize: 'big' },
    motion: { pop: 'wobble' }, texture: 'grain', audio: { roleMap: { tick: 5, bounce: 'pop' }, fx: { lowpass: NaN } },
  });
  assert.equal(theme.color.text, CLASSIC.color.text);
  assert.deepEqual(theme.color.bg, CLASSIC.color.bg);
  assert.equal(theme.color.accent, '#00ff00', 'valid siblings survive');
  assert.equal(theme.line.style, CLASSIC.line.style);
  assert.equal(theme.font.titleSize, CLASSIC.font.titleSize);
  assert.equal(theme.motion.pop, CLASSIC.motion.pop);
  assert.deepEqual(theme.texture, CLASSIC.texture);
  assert.deepEqual(theme.audio.roleMap, { bounce: 'pop' });
  assert.equal(theme.audio.fx.lowpass, CLASSIC.audio.fx.lowpass);
  for (const p of ['color.text', 'color.bg', 'line.style', 'font.titleSize', 'motion.pop', 'texture', 'audio.roleMap.tick', 'audio.fx.lowpass'])
    assert.ok(warnings.some(w => w.startsWith(p)), `warning for ${p}`);
});

test('unknown style ids and the built-in classic are safe', () => {
  assert.equal(getTheme('does-not-exist'), CLASSIC);
  assert.equal(getTheme(undefined), CLASSIC);
  assert.equal(themeOf({ style: 'nope' }), CLASSIC);
  assert.deepEqual(registerThemes([{ id: 'classic', color: { text: '#000000' } }]).classic, ['classic is built in and cannot be replaced']);
  assert.equal(getTheme('classic').color.text, CLASSIC.color.text);
  assert.ok(registerThemes([{ name: 'no id' }])['?'], 'a theme without id is skipped');
});

test('named palettes become ink colours on light themes, theme palette by default', () => {
  const riso = getTheme('riso');
  assert.deepEqual(paletteFor(riso, 'theme', 'cyclic'), riso.palettes.cyclic);
  assert.notDeepEqual(paletteFor(riso, 'rainbow', 'cyclic'), paletteFor(CLASSIC, 'rainbow', 'cyclic'));
  assert.deepEqual(paletteFor(getTheme('chalk'), 'rainbow', 'cyclic'), paletteFor(CLASSIC, 'rainbow', 'cyclic'), 'dark themes keep named palettes');
});

// ---- the guarantee: a style changes pixels and sound, never the simulation ----

const S = 0.25;
const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: S };
function frame(id: string, p: Record<string, unknown>, f: number) {
  const s = SCENES.find(x => x.meta.id === id)!;
  const inst = s.create(env, validate(s.schema, p).params);
  const c = createCanvas(Math.round(1080 * S), Math.round(1920 * S)), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(S, 0, 0, S, 0, 0);
  const at = Math.floor(inst.frames * f); inst.renderFrame(ctx, at);
  return { px: c.data(), state: hashFloats(inst.stateVector!()) };
}

test('every scene renders in every style; simulation state is identical across styles', () => {
  for (const s of SCENES) {
    const ref = frame(s.meta.id, { style: 'classic' }, 0.4).state;
    for (const st of NEW) assert.equal(frame(s.meta.id, { style: st }, 0.4).state, ref, `${s.meta.id}/${st}: theme must not touch the simulation`);
  }
});

test('a theme with most tokens missing still renders every scene (fallback in action)', () => {
  registerThemes([{ id: 'sparse-test', color: { bg: ['#ffffff'], text: '#000000' }, line: { style: 'flat' } }]);
  for (const s of SCENES) assert.ok(frame(s.meta.id, { style: 'sparse-test' }, 0.3).px.length > 0);
});

test('styled renders are deterministic, and styled audio differs from classic but repeats exactly', () => {
  const a = frame('galton-board', { style: 'candy' }, 0.5).px, b = frame('galton-board', { style: 'candy' }, 0.5).px;
  assert.ok(Buffer.compare(a, b) === 0, 'same style twice = same pixels');
  const s = SCENES.find(x => x.meta.id === 'billiard')!;
  const h = (style: string) => { const m = s.audio(validate(s.schema, { style, duration: 8, endAt: 7 }).params); return createHash('sha1').update(Buffer.from(m.L.buffer)).digest('hex'); };
  const base = h('classic'), seen = new Set([base]);
  for (const st of NEW) { const x = h(st); assert.equal(h(st), x, `${st} audio repeats`); assert.ok(!seen.has(x), `${st} audio differs from the others`); seen.add(x); }
});

/** mean absolute difference (0..255) of two RGBA buffers, over RGB */
function diff(a: Uint8Array, b: Uint8Array) { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / ((a.length / 4) * 3); }

test('the five styles are clearly different from each other and from classic (same frame)', () => {
  for (const id of ['focal-reflection', 'galton-board']) {
    const px = Object.fromEntries(['classic', ...NEW].map(st => [st, frame(id, { style: st }, 0.6).px]));
    const ids = Object.keys(px);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const d = diff(px[ids[i]], px[ids[j]]);
      assert.ok(d > 12, `${id}: ${ids[i]} vs ${ids[j]} mean pixel difference ${d.toFixed(1)} should exceed 12/255`);
    }
  }
});
