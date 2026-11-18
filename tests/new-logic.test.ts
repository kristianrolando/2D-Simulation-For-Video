// Tests for the logic added in the "production tool" pass: new scenes, juice, audio bank, trails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { validate, type Env } from '../packages/core/index.ts';
import { simulate as galton, binomialExpected } from '../packages/scenes/galton-board/sim.ts';
import { simulate as bounce, posAt } from '../packages/scenes/gravity-bounce/sim.ts';
import billiard, { billiardPath } from '../packages/scenes/billiard/index.ts';
import resonance from '../packages/scenes/resonance-orbits/index.ts';
import { Juice, juiceFrom, juiceSchema } from '../packages/juice/index.ts';
import { TrailHistory } from '../packages/render2d/index.ts';
import { createMix, toWav } from '../packages/audio/index.ts';
import { parseWav, setSampleBank, sfx, VoiceLimiter, scaleStep } from '../packages/audio/bank.ts';

const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: 1 };
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('galton: bins follow Binomial(R, p) (chi-square, mean)', () => {
  for (const p of [0.5, 0.3]) {
    const S = galton({ balls: 2000, rows: 12, p, seed: 3, interval: 0.05 });
    const n = S.balls.length; let chi = 0, dof = 0;
    for (let k = 0; k <= 12; k++) { const e = binomialExpected(n, 12, p, k); if (e >= 5) { chi += (S.counts[k] - e) ** 2 / e; dof++; } }
    const mean = S.counts.reduce((s, c, k) => s + c * k, 0) / n;
    assert.ok(Math.abs(mean - 12 * p) < 0.15, `mean ${mean}`);
    assert.ok(chi < 3 * dof, `chi² ${chi} for ${dof} bins`);
    assert.equal(S.counts.reduce((a, b) => a + b, 0), n);
  }
});

test('gravity-bounce: energy conserved, contacts exactly on the wall, chaos amplifies a 1e-9 px gap', () => {
  const S = bounce({ balls: 6, radius: 430, ballR: 14, g: 1800, offset: 1e-9, startX: 680, startY: 700, vx0: 0, tEnd: 30 });
  assert.ok(S.maxEnergyDriftRel < 1e-10, `energy drift ${S.maxEnergyDriftRel}`);
  assert.ok(S.maxRadiusErrPx < 1e-6, `radius error ${S.maxRadiusErrPx}`);
  const gap = (t: number) => { const a = posAt(S, 0, t), b = posAt(S, 5, t); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  assert.ok(gap(1) < 1e-6 && gap(25) > 50, `gap 1s ${gap(1)}, 25s ${gap(25)}`);
});

test('billiard: rational directions close, the golden-ratio circle never does', () => {
  const P = (o: Record<string, unknown>) => validate(billiard.schema, o).params;
  assert.equal(billiardPath(P({ table: 'circle', turn: 2 / 7 })).closedAt, 7);
  assert.equal(billiardPath(P({ table: 'square', dirA: 5, dirB: 3 })).closedAt, 16);
  assert.ok(billiardPath(P({ table: 'triangle' })).closedAt > 0);
  assert.equal(billiardPath(P({ table: 'circle' })).closedAt, -1);
});

test('resonance: pattern closes after one cycle with (inner − outer) petals', () => {
  const inst = resonance.create(env, validate(resonance.schema, {}).params);
  const d = inst.diagnostics!() as any;
  assert.ok(d.closureErrPx < 1e-9); assert.equal(d.petals, 5);
});

test('juice: deterministic, and intensity 0 switches an effect off', () => {
  const run = (o: Record<string, unknown>) => {
    const j = new Juice(env, juiceFrom(validate(juiceSchema(), o).params), { capacity: 64, seed: 5 });
    j.burst(100, 100, 20); j.shake(10); j.flash(1); j.pop('c');
    for (let i = 0; i < 10; i++) j.update(1 / 60);
    return j;
  };
  const a = run({}), b = run({});
  assert.deepEqual(a.snapshot(), b.snapshot());
  const off = run({ juice_burst: 0, juice_shake: 0, juice_flash: 0, juice_pop: 0 });
  assert.equal(off.liveParticles(), 0);
  assert.equal(off.popScale('c'), 1);
  assert.ok(a.liveParticles() > 0);
});

test('trail history leaves no residue once points are older than maxAge', () => {
  const tr = new TrailHistory(1, 32);
  const c = createCanvas(64, 64); const g = c.getContext('2d') as any;
  for (let f = 0; f < 20; f++) tr.push(0, 2 + f * 3, 32, f);
  g.lineCap = 'round'; tr.draw(g, 0, 20, 10, '255,255,255', 1, 3);
  const lit = (x: number) => g.getImageData(x, 32, 1, 1).data[3];
  assert.ok(lit(2 + 18 * 3) > 0, 'recent part drawn');
  assert.equal(lit(2 + 2 * 3), 0, 'old part fully gone');
});

test('audio bank: WAV round-trip, pitch shift, fallback, voice limiter', () => {
  const m = createMix(0.2); for (let i = 0; i < m.L.length; i++) m.L[i] = m.R[i] = Math.sin(i / 10) * 0.5;
  const s = parseWav(toWav(m), 'x', 'test');
  assert.equal(s.sr, 44100); assert.ok(Math.abs(s.data[100] - Math.sin(10) * 0.5) < 1e-3);
  setSampleBank([s]);
  const a = createMix(0.5), b = createMix(0.5);
  sfx(a, 0, 'test', { pitch: 0 }); sfx(b, 0, 'test', { pitch: 12 });
  const len = (x: Float32Array) => { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] !== 0) n = i; return n; };
  assert.ok(Math.abs(len(b.L) / len(a.L) - 0.5) < 0.02, 'an octave up plays twice as fast');
  setSampleBank([]);
  const c = createMix(0.5); sfx(c, 0, 'bounce'); assert.ok(peak(c.L) > 0, 'synth fallback when the library has no sample');
  const lim = new VoiceLimiter(0.01, 2); const g = [0, 0.001, 0.002, 0.003].map(t => lim.admit('r', t));
  assert.ok(g[0] === 1 && g[1] > 0 && g[2] === 0 && g[3] === 0);
  assert.equal(scaleStep(5), 12);
});

test('sample library manifest is consistent and credit-safe (unique prompt hashes)', () => {
  const man = JSON.parse(fs.readFileSync('assets/sfx/manifest.json', 'utf8'));
  const hashes = man.samples.map((x: any) => x.promptHash);
  assert.equal(new Set(hashes).size, hashes.length);
  for (const x of man.samples) { assert.ok(fs.existsSync('assets/sfx/' + x.file), x.file); assert.ok(x.prompt && x.role && x.duration > 0); }
});
