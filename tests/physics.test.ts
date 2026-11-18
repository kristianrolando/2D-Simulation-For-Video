// Physics / math accuracy: every scene is checked against an analytic answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dsin, dcos, dexp, datan2, TimeWarp, validate, sequence } from '../packages/core/index.ts';
import { layout, LAYOUTS } from '../packages/scenes/focal-reflection/presets.ts';
import { simulate } from '../packages/scenes/focal-reflection/sim.ts';
import { constants, initState, advance, diagnostics } from '../packages/scenes/rosette-orbit/sim.ts';
import { createSim as pendulums } from '../packages/scenes/pendulum-wave/sim.ts';

const ulp = (a: number, b: number) => Math.abs(a - b) / (Math.abs(b) * 2.220446049250313e-16 || 1e-300);

test('dmath agrees with Math.* to ≤ 2 ulp', () => {
  let m = 0;
  for (let i = 1; i < 50000; i++) {
    const x = ((i * 0.6180339887) % 1 - 0.5) * 200, y = ((i * 0.41421356) % 1 - 0.5) * 200;
    m = Math.max(m, ulp(dsin(x), Math.sin(x)), ulp(dcos(x), Math.cos(x)), ulp(datan2(y, x), Math.atan2(y, x)), ulp(dexp(x / 10), Math.exp(x / 10)));
  }
  assert.ok(m <= 2, `max ulp ${m}`);
});

test('TimeWarp hits its anchor exactly and is monotonic', () => {
  const w = new TimeWarp({ fps: 60, frames: 600, rateAt: t => 1 + t * t, anchorFrame: 540, anchorSim: 123.456 });
  assert.equal(w.sim(540), 123.456);
  for (let f = 1; f <= 600; f++) assert.ok(w.sim(f) > w.sim(f - 1));
  assert.ok(Math.abs(w.videoTime(w.sim(300)) - 5) < 1e-9);
});

test('schema validation clamps and reports', () => {
  const { params, errors } = validate({ n: { type: 'number', default: 1, min: 0, max: 2 } }, { n: 5, zz: 1 });
  assert.equal(params.n, 2); assert.equal(errors.length, 2);
  assert.deepEqual(sequence('fibonacci', 6), [1, 2, 3, 5, 8, 13]);
});

for (const kind of LAYOUTS) {
  test(`focal-reflection/${kind}: every ball reaches the focus, simultaneously`, () => {
    const L = layout(kind, { ellipseRx: 348, ellipseRy: 508 });
    const seq = sequence(L.seq.kind, L.seq.n);
    const r = simulate(L, seq);
    assert.equal(r.lost, 0, 'balls escaped');
    assert.equal(r.waves.length, seq.length);
    assert.ok(r.maxMissPx < 1e-9, `focus miss ${r.maxMissPx}px`);
    assert.ok(r.maxSyncSpread < 1e-9, `arrival spread ${r.maxSyncSpread}s`);
    assert.ok(r.tFinal > 0);
  });
}

test('rosette orbit matches the closed-form solution and closes after 36 orbits', () => {
  const K = constants({ rApo: 445, rPeri: 78, precessDeg: 10, periodYears: 6250, startAngleDeg: 90, stepsPerOrbit: 20000 });
  const S = initState(K);
  const { events } = advance(K, S, K.closeYears, 1e9);
  const close = events.find(e => e.type === 'close');
  const d = diagnostics(S);
  assert.ok(close && close.type === 'close' && close.miss < 1e-6, `closure miss ${close && 'miss' in close ? close.miss : '?'}`);
  assert.ok(d.maxRadialErrorPx < 1e-6, `radial error ${d.maxRadialErrorPx}`);
  assert.ok(d.maxEnergyDriftRel < 1e-10);
  assert.equal(d.periapses, 36);
  assert.ok(Math.abs((d.meanPrecessionDeg ?? 0) - 10) < 1e-6);
});

test('pendulum wave realigns exactly; small-angle lengths would not', () => {
  const d = pendulums({ hz: 1200 }).diagnostics();
  assert.ok(d.realignMaxErrDeg < 1e-8, `realign ${d.realignMaxErrDeg}`);
  assert.ok(d.smallAngleLengthsPhaseErrDeg > 90);
});
