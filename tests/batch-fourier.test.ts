// The Fourier Loom batch plan (tools/batch-plan-fourier.ts): a third partner for every Photon Lab video, same concept, parameters unlike ALL
// Photon and Plasma videos, Main-3 look, own texts. And the guarantees around it: the Photon and Plasma plans are byte-identical.
// Nothing here renders or talks to a studio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sceneById } from '../packages/scenes/index.ts';
import { validate } from '../packages/core/schema.ts';
import { sanitizeStylePreset, serializeStylePreset } from '../packages/theme/index.ts';
import { buildPlan } from '../tools/batch-plan.ts';
import { buildPlasmaPlan, signature } from '../tools/batch-plan-plasma.ts';
import { buildFourierPlanFull, FOURIER_POOL, FOURIER_HANDLE } from '../tools/batch-plan-fourier.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = (x: unknown) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const photon = buildPlan(), plasma = buildPlasmaPlan(), { items: fourier, short } = buildFourierPlanFull();
const full = (sceneId: string, params: Record<string, unknown>) => validate(sceneById(sceneId)!.schema, params).params as Record<string, any>;

test('the Photon Lab and Plasma plans are exactly what they were (this tool changes neither)', () => {
  assert.equal(sha(photon), '51bf838c52f66aeeea6a75e29d73035bd328781a2679a87cb2f752de9a8b7f72');
  assert.equal(plasma.length, 245);
  assert.equal(sha(buildPlasmaPlan()), sha(plasma));
});

test('the Fourier plan is deterministic and complete: 245 partners, none missing', () => {
  assert.equal(sha(buildFourierPlanFull().items), sha(fourier));
  assert.equal(short.length, 0); assert.equal(fourier.length, photon.length);
});

test('one partner for every Photon video: unique "fourier:" keys, same scene, the pair named', () => {
  assert.equal(new Set(fourier.map(i => i.key)).size, fourier.length);
  assert.ok(fourier.every(i => i.key === 'fourier:' + i.pairOf));
  const byKey = new Map(photon.map(i => [i.key, i]));
  assert.deepEqual([...fourier.map(i => i.pairOf)].sort(), [...photon.map(i => i.key)].sort());
  for (const i of fourier) { const p = byKey.get(i.pairOf)!; assert.equal(i.sceneId, p.sceneId); assert.equal(i.heavy, p.heavy); }
});

test('no Fourier video is the same video as any Photon, Plasma or other Fourier video (full parameters, without texts and look)', () => {
  const others = new Set([...photon, ...plasma].map(i => signature(i.sceneId, i.params)));
  assert.equal(others.size, 489, '490 Photon + Plasma videos; two Photon ones (preset:billiard-golden-circle, table:circle) were always the same video');
  const seen = new Set<string>();
  for (const i of fourier) {
    const s = signature(i.sceneId, i.params);
    assert.ok(!others.has(s), `${i.key} equals a Photon or Plasma video`);
    assert.ok(!seen.has(s), `${i.key} equals another Fourier video`); seen.add(s);
  }
});

test('every item is valid for its scene, in the Main-3 look with the channel handle, colors from the preset', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'style-presets/main-3.json'), 'utf8'));
  const main3 = serializeStylePreset(sanitizeStylePreset(raw).preset!);
  for (const i of fourier) {
    const r = validate(sceneById(i.sceneId)!.schema, i.params);
    assert.deepEqual(r.errors, [], i.key);
    const P = r.params as Record<string, any>;
    assert.ok(P.duration >= 5 && P.duration <= 180, `${i.key}: duration ${P.duration}`);
    assert.equal(P.style, 'classic'); assert.equal(P.stylePreset, main3, `${i.key}: Main-3`); assert.equal(P.handle, FOURIER_HANDLE); assert.equal(P.bgSettings, '');
    assert.equal(P.palette, 'theme');
    for (const k of ['finalAt', 'closeAt', 'alignAt', 'endAt']) if (k in P) assert.ok(P[k] < P.duration, `${i.key}: ${k} ${P[k]} < ${P.duration}`);
  }
  assert.ok(JSON.stringify(main3).includes('e8eefc'), 'the preset is the owner\'s Main-3 (silver wall)');
});

test('on-screen titles: US English, at most two lines of 32 characters, none equal to a Photon or Plasma title, none repeated more than the pool allows', () => {
  const taken = new Set<string>();
  for (const i of photon) { const P = full(i.sceneId, i.params), sc = sceneById(i.sceneId)!; const t = String(P.title ?? '').trim(); if (t) taken.add(t.toLowerCase()); if (sc.hook) taken.add(String(sc.hook(P)).toLowerCase()); }
  for (const i of plasma) taken.add(String(i.params.title ?? '').trim().toLowerCase());
  for (const i of fourier) {
    const t = String(i.params.title ?? ''); assert.ok(t.trim(), `${i.key}: has a title`);
    const lines = t.split('\n'); assert.ok(lines.length <= 2, `${i.key}: ${lines.length} lines`);
    for (const l of lines) assert.ok(l.length <= 32, `${i.key}: line too long (${l.length}): ${l}`);
    assert.ok(!taken.has(t.toLowerCase()), `${i.key}: same title as a Photon or Plasma video: ${t}`);
    assert.ok(!/centre|colour|favour|behaviour|programme/i.test(t + String(i.params.answer ?? '')), `${i.key}: UK spelling`);
  }
  const worst = { k: '4', shape: 'triangle', n0: '12', n: '20', r: '√2' };
  for (const [name, list] of Object.entries(FOURIER_POOL)) for (const s of list) for (const l of s.replace(/\{(\w+)\}/g, (_, k) => (worst as Record<string, string>)[k] ?? '').split('\n')) assert.ok(l.length <= 32, `${name}: "${l}" is ${l.length} characters`);
});

test('heavy videos (hammer-smash) are never side by side, the first ten show every scene, the order is not Photon\'s or Plasma\'s', () => {
  for (let k = 1; k < fourier.length; k++) assert.ok(!(fourier[k].heavy && fourier[k - 1].heavy), `two heavy videos at ${k}`);
  assert.equal(new Set(fourier.slice(0, 10).map(i => i.sceneId)).size, 10);
  assert.notEqual(fourier.slice(0, 40).map(i => i.pairOf).join(), photon.slice(0, 40).map(i => i.key).join());
  assert.notEqual(fourier.slice(0, 40).map(i => i.pairOf).join(), plasma.slice(0, 40).map(i => i.pairOf).join());
});

test('the plan never touches the other batches\' data and does not mention another channel on screen', () => {
  for (const i of fourier) { const p = JSON.stringify(i.params); assert.ok(!/photon|plasma|mathcarlooo|betonthecolor/i.test(p.replace(/"stylePreset":"[^"]*"/, '')), i.key); }
});
