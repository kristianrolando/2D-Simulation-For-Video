// Per-style background settings: schema, limits, presets, fallback, and effect on pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import { validate, type Ctx, type Env } from '../packages/core/index.ts';
import { SCENES, sceneById } from '../packages/scenes/index.ts';
import { allThemes, getTheme, themeOf, parseBackground, sanitizeBackground, serializeBackground, applyBackground, resolveTheme, CLASSIC } from '../packages/theme/index.ts';

const ids = ['classic', 'riso', 'chalk', 'terminal', 'candy', 'blueprint'];
const firstOf = (T: ReturnType<typeof getTheme>, type: string) => Object.entries(T.background.params).find(([, d]) => d.type === type)!;

test('all six styles declare valid, different background controls', () => {
  const keySets = new Set<string>();
  for (const id of ids) {
    const T = getTheme(id), warn: string[] = [];
    const spec = parseBackground(T, JSON.parse(JSON.stringify(T.background)), warn);
    assert.deepEqual(warn, [], `${id}: spec has no warnings`);
    assert.deepEqual(Object.keys(spec.params), Object.keys(T.background.params), `${id}: no parameter dropped`);
    assert.ok(Object.keys(T.background.params).length >= 9, `${id}: offers at least 9 controls`);
    assert.ok(T.background.presets.length >= 4, `${id}: has presets`);
    const groups = new Set(Object.values(T.background.params).map(p => p.group));
    assert.ok(groups.size >= 3, `${id}: controls are grouped`);
    keySets.add(Object.keys(T.background.params).sort().join(','));
  }
  assert.equal(keySets.size, ids.length, 'parameter sets are not copies of one another');
});

test('defaults equal the theme tokens, so untouched settings never change the look', () => {
  for (const id of ids) {
    const T = getTheme(id);
    for (const [k, d] of Object.entries(T.background.params)) {
      for (const t of [d.target].flat()) {
        if (t === 'palettes.*') continue;
        const v = t.split('.').reduce((o: any, key) => o[key], T);
        assert.equal(String(v).toLowerCase(), String(d.default).toLowerCase(), `${id}.${k} default vs token ${t}`);
      }
    }
    assert.equal(applyBackground(T, ''), T); assert.equal(applyBackground(T, '{}'), T);
    assert.deepEqual(sanitizeBackground(T, '').values, Object.fromEntries(Object.entries(T.background.params).map(([k, d]) => [k, d.default])));
  }
});

test('every preset is valid and yields a valid, different-looking theme', () => {
  for (const id of ids) {
    const T = getTheme(id);
    for (const pr of T.background.presets) {
      const { values, warnings } = sanitizeBackground(T, pr.values);
      assert.deepEqual(warnings, [], `${id}/${pr.id}`);
      for (const [k, v] of Object.entries(pr.values)) assert.equal(values[k], v, `${id}/${pr.id}.${k} survives the limits unchanged`);
      const raw = serializeBackground(T, values), A = applyBackground(T, raw);
      assert.deepEqual(resolveTheme({ ...A }).warnings.filter(w => !w.startsWith('id:')), [], `${id}/${pr.id}: resulting theme is valid`);
    }
  }
});

test('values are clamped to their limits', () => {
  for (const id of ids) {
    const T = getTheme(id);
    const [kn, dn] = firstOf(T, 'number') as [string, any];
    const hi = sanitizeBackground(T, { [kn]: 1e9 }).values[kn], lo = sanitizeBackground(T, { [kn]: -1e9 }).values[kn];
    assert.equal(hi, dn.max); assert.equal(lo, dn.min);
    assert.equal(sanitizeBackground(T, { [kn]: String(dn.max) }).values[kn], dn.max, 'numeric strings are accepted');
  }
  // colour luminance limits keep each look readable
  const riso = getTheme('riso'); assert.ok(sanitizeBackground(riso, { paper: '#000000' }).values.paper !== '#000000', 'riso paper cannot go black');
  const L = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  assert.ok(L(sanitizeBackground(riso, { paper: '#000000' }).values.paper as string) >= 0.7);
  const cl = getTheme('classic'); assert.ok(L(sanitizeBackground(cl, { top: '#ffffff' }).values.top as string) <= 0.25, 'classic background cannot turn bright');
  const bp = getTheme('blueprint'); assert.ok(L(sanitizeBackground(bp, { ink: '#000000' }).values.ink as string) >= 0.6, 'blueprint ink stays light');
});

test('invalid or missing stored values fall back to defaults without throwing', () => {
  for (const id of ids) {
    const T = getTheme(id), def = sanitizeBackground(T, '').values;
    for (const bad of ['{not json', 'null', '[]', '42', '"x"', '{"top":5,"angle":"abc","grid":"nope","wall":"red"}', { top: null }, undefined, 7]) {
      const r = sanitizeBackground(T, bad as any);
      assert.deepEqual(Object.keys(r.values), Object.keys(def));
      assert.doesNotThrow(() => applyBackground(T, bad as any));
    }
    const r = sanitizeBackground(T, { zzz: 1, [Object.keys(def)[0]]: 'bad' });
    assert.deepEqual(r.values, def, 'unknown keys ignored, invalid value replaced by default');
    assert.ok(r.warnings.length >= 2);
  }
  assert.equal(themeOf({ style: 'riso', bgSettings: '{broken' }).color.bg[0], getTheme('riso').color.bg[0], 'broken JSON renders the default look');
});

test('malformed background declarations are dropped with warnings, valid ones kept', () => {
  const warn: string[] = [];
  const spec = parseBackground(CLASSIC, { params: {
    ok: { type: 'number', label: 'ok', default: 1, min: 0, max: 2, target: 'line.glow' },
    badRange: { type: 'number', default: 5, min: 0, max: 2, target: 'line.glow' },
    badTarget: { type: 'color', default: '#000000', target: 'color.nope' },
    badType: { type: 'wat', default: 1, target: 'line.glow' },
    badEnum: { type: 'enum', default: 'c', options: ['a', 'b'], target: 'texture.kind' },
    badColor: { type: 'color', default: 'red', target: 'color.wall' },
  }, presets: [{ id: 'p', name: 'P', values: { ok: 9, ghost: 1 } }, { name: 'no id' }] }, warn);
  assert.deepEqual(Object.keys(spec.params), ['ok']);
  assert.equal(spec.presets.length, 1); assert.equal(spec.presets[0].values.ok, 2, 'preset value clamped');
  assert.ok(warn.length >= 6);
  assert.deepEqual(parseBackground(CLASSIC, 'nope', []), { params: {}, presets: [] });
});

// ---- effect on the picture ----
const S = 0.25, env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: S };
function frame(id: string, p: Record<string, unknown>) {
  const s = sceneById(id)!, inst = s.create(env, validate(s.schema, p).params);
  const c = createCanvas(Math.round(1080 * S), Math.round(1920 * S)), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(S, 0, 0, S, 0, 0);
  inst.renderFrame(ctx, 90); return c.data();
}
const diff = (a: Uint8Array, b: Uint8Array) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return d / (a.length / 4) / 3; };

test('changing a background setting changes the picture, in every scene, and defaults change nothing', () => {
  for (const s of SCENES) {
    const base = frame(s.meta.id, { style: 'blueprint' });
    assert.equal(diff(base, frame(s.meta.id, { style: 'blueprint', bgSettings: '{}' })), 0, `${s.meta.id}: explicit defaults = unchanged`);
    assert.ok(diff(base, frame(s.meta.id, { style: 'blueprint', bgSettings: JSON.stringify({ sheet: '#3f2a82', sheet2: '#32216a', sheet3: '#241850' }) })) > 5, `${s.meta.id}: background colour applied`);
  }
  for (const id of ids) {
    const T = getTheme(id), pr = T.background.presets[1], raw = serializeBackground(T, sanitizeBackground(T, pr.values).values);
    assert.ok(diff(frame('galton-board', { style: id }), frame('galton-board', { style: id, bgSettings: raw })) > 2, `${id}/${pr.id} visibly differs from the default`);
  }
});

test('the same settings render the same pixels twice (preview and render share this path)', () => {
  const raw = JSON.stringify({ pattern: 'grain', dotAmount: 0.3, paper: '#fbe9a8' });
  assert.equal(diff(frame('billiard', { style: 'riso', bgSettings: raw }), frame('billiard', { style: 'riso', bgSettings: raw })), 0);
});
