// Determinism: (1) rendering twice gives identical pixels; (2) simulation state vectors match pinned
// "golden" hashes. State hashes only use dmath + IEEE-exact arithmetic, so they must be identical on
// any machine and in any JS engine (browser preview == offline render). Pixel hashes are only
// compared within one run (Skia rasterisation may differ across CPUs/OSes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import '../apps/server/host.ts'; // bundled fonts + style themes
import { createCanvas } from '@napi-rs/canvas';
import { validate, hashFloats, type Env, type Ctx } from '../packages/core/index.ts';
import { SCENES } from '../packages/scenes/index.ts';

const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: 1 };
const GOLDEN = 'tests/golden-state.json';
const golden: Record<string, string> = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
const update = process.env.UPDATE_GOLDEN === '1';
const cases: [string, Record<string, unknown>][] = [
  ['focal-reflection', { layout: 'ellipse' }], ['focal-reflection', { layout: 'peanut' }], ['focal-reflection', { layout: 'cassegrain' }],
  ['rosette-orbit', {}], ['pendulum-wave', {}],
  ['galton-board', {}], ['harmonograph', {}], ['gravity-bounce', {}], ['resonance-orbits', {}], ['billiard', {}], ['billiard', { table: 'circle' }],
  ['hammer-smash', {}], ['hammer-smash', { rule: 'box', container: 'circle' }], ['hammer-smash', { rule: 'survive', startBalls: 6 }],
  ['sync-lines', {}], ['sync-lines', { mode: 'lid', container: 'square' }], ['sync-lines', { mode: 'slider' }], ['sync-lines', { mode: 'close' }],
];

function run(id: string, p: Record<string, unknown>, frames: number[]) {
  const s = SCENES.find(x => x.meta.id === id)!;
  const inst = s.create(env, validate(s.schema, p).params);
  const c = createCanvas(s.meta.width, s.meta.height); const ctx = c.getContext('2d') as unknown as Ctx;
  const px: string[] = [], st: string[] = [];
  for (const f of frames) { inst.renderFrame(ctx, f); px.push(createHash('sha1').update(c.data()).digest('hex')); st.push(hashFloats(inst.stateVector!())); }
  return { px, st };
}

for (const [id, p] of cases) {
  const key = `${id}:${JSON.stringify(p)}`;
  test(`deterministic: ${key}`, () => {
    const frames = [0, 30, 240, 600];
    const a = run(id, p, frames), b = run(id, p, frames);
    assert.deepEqual(a.px, b.px, 'pixels differ between two runs');
    const sig = a.st.join(',');
    if (update || !golden[key]) golden[key] = sig;
    else assert.equal(sig, golden[key], 'simulation state drifted from the golden hash');
  });
}

test('write golden file', () => { if (update || Object.keys(golden).length) fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n'); });
