// Scene template: Hammer smash — hammers slide out of the walls and smash the balls inside a container.
// Variants: rule (split / box / survive), container (octagon, circle, square, triangle, ring),
// objects (balls, squares, triangles, gems, stars, mixed), hammers 1–4, gravity, seed.
// Ending: the container bursts, then the whole run rewinds to frame 0 (the video loops).
import { commonSchema, samplePalette, frameCount, clamp, ease, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { bakeStatic, createLayer, drawLayer, makeBackground, makeNeon, makeShapeSprite, drawSprite, drawHeader, fontOf, SHAPE_KINDS, type Sprite, type ShapeKind } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep, hash01 } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, rgbOf, rgbaOf } from '../../theme/index.ts';
import { mulberry32 } from '../../core/index.ts';
import { CONTAINER_KINDS } from '../../sim/shapes.ts';
import { HammerSim, RULES, Ev, type Rule, type HammerParams } from './sim.ts';

const meta = { id: 'hammer-smash', name: 'Hammer smash', family: 'smash', description: 'Hammers slam out of the walls: crushed balls split, bounce into more, or vanish — until the container bursts.', width: 1080, height: 1920, fps: 60, loudness: -16 };

const OBJECTS = [...SHAPE_KINDS, 'mixed'];
const schema: Schema = {
  ...commonSchema({ title: '', duration: 55, answer: '' }),
  counter: { type: 'text', default: '', group: 'Text', label: 'Counter label (empty = automatic)' },
  rule: { type: 'enum', default: 'split', options: RULES, group: 'Setup', label: 'Rule', sim: true, help: 'split: a crushed ball becomes several · box: hammers meet, every bounce inside adds a ball · survive: crushed balls are gone, lucky wall bounces add one' },
  container: { type: 'enum', default: 'octagon', options: CONTAINER_KINDS, group: 'Setup', label: 'Container', sim: true },
  objects: { type: 'enum', default: 'ball', options: OBJECTS, group: 'Setup', label: 'Objects' },
  hammers: { type: 'integer', default: 4, min: 1, max: 4, group: 'Setup', label: 'Hammers on the walls', sim: true, help: 'One strikes at a time, in a seeded order. The box rule always uses every wall.' },
  seed: { type: 'integer', default: 7, min: 1, max: 99999, group: 'Setup', label: 'Seed', sim: true, help: 'Same seed = the same run, in the preview and in the render.' },
  splitInto: { type: 'integer', default: 3, min: 2, max: 4, group: 'Balls', label: 'A crushed ball splits into', sim: true },
  capacity: { type: 'integer', default: 1500, min: 30, max: 2500, group: 'Balls', label: 'Capacity (balls when full)', sim: true },
  startBalls: { type: 'integer', default: 1, min: 1, max: 40, group: 'Balls', label: 'Balls at the start', sim: true },
  ballScale: { type: 'number', default: 1, min: 0.5, max: 1.6, step: 0.05, group: 'Balls', label: 'Ball size', sim: true },
  speed: { type: 'number', default: 380, min: 100, max: 900, step: 10, unit: 'px/s', group: 'Balls', label: 'Ball speed', sim: true },
  gravity: { type: 'number', default: 0, min: 0, max: 2500, step: 50, unit: 'px/s²', group: 'Balls', label: 'Gravity', sim: true },
  bonus: { type: 'number', default: 0.45, min: 0.05, max: 1, step: 0.05, group: 'Balls', label: 'Survive: chance a wall bounce adds a ball', sim: true },
  boxSize: { type: 'number', default: 0.5, min: 0.25, max: 0.9, step: 0.05, group: 'Balls', label: 'Box rule: box size', sim: true },
  interval: { type: 'number', default: 4.4, min: 1, max: 10, step: 0.1, unit: 's', group: 'Timing', label: 'Time between strikes (start)', sim: true },
  speedUp: { type: 'number', default: 3, min: 1, max: 6, step: 0.1, group: 'Timing', label: 'Strikes faster by the end ×', sim: true },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.7, burst: 0.8 }),
};

// ---------------- texts that vary per rule and seed ----------------
const HOOKS: Record<Rule, string[]> = {
  split: ['Every smash turns a ball into {k}\nHow full can it get?', 'One crushed ball = {k} new ones\nWhen does it burst?', 'Smash one, get {k}\nCan the {shape} hold them all?'],
  box: ['A bounce inside the box adds a ball\nWill the walls hold?', 'The hammers build a box\nEvery bounce in it = one more ball', 'Trapped balls multiply\nHow long until it bursts?'],
  survive: ['Crushed balls are gone for good\nCan they outgrow the hammer?', 'Lucky bounces make new balls\nBalls or hammer: who wins?', 'One hammer vs {n0} balls\nWill any survive?'],
};
function hook(P: Params) {
  const rule = String(P.rule) as Rule, list = HOOKS[rule] ?? HOOKS.split;
  return list[Math.abs(Math.round(+P.seed)) % list.length].replace('{k}', String(P.splitInto)).replace('{shape}', String(P.container)).replace('{n0}', String(P.startBalls));
}
const titleOf = (P: Params) => (String(P.title).trim() ? String(P.title) : hook(P));
const labelOf = (P: Params) => (String(P.counter) ? String(P.counter) : 'Balls: ');

// ---------------- timing ----------------
const BURST_HOLD = 1.3, REWIND = 1.4;
function timing(P: Params) {
  const frames = frameCount(P, meta.fps), rew = Math.round(REWIND * meta.fps), hold = Math.round(BURST_HOLD * meta.fps);
  const end = Math.max(30, frames - 1 - rew - hold);
  return { frames, end, rewStart: end + hold, rew };
}

const cache = new Map<string, HammerSim>();
function simFor(P: Params): HammerSim {
  const t = timing(P);
  const hp: HammerParams = { rule: String(P.rule) as Rule, container: String(P.container) as any, hammers: +P.hammers, splitInto: +P.splitInto, capacity: +P.capacity,
    startBalls: +P.startBalls, ballScale: +P.ballScale, speed: +P.speed, gravity: +P.gravity, interval: +P.interval, speedUp: +P.speedUp, boxSize: +P.boxSize,
    bonus: +P.bonus, seed: +P.seed, fps: meta.fps, endFrame: t.end };
  const key = JSON.stringify(hp);
  let s = cache.get(key);
  if (!s) { s = new HammerSim(hp); if (cache.size > 2) cache.delete(cache.keys().next().value!); cache.set(key, s); }
  return s;
}

/** final outcome text */
function answerOf(P: Params, S: HammerSim, n: number) {
  if (String(P.answer).trim()) return String(P.answer).replace('{n}', n.toLocaleString('en-US'));
  if (S.clearedAt >= 0) return 'Cleared! The hammer wins.';
  if (P.rule === 'survive') return S.fullAt >= 0 ? `${n.toLocaleString('en-US')} — they won. BOOM!` : `${n.toLocaleString('en-US')} survived. BOOM!`;
  return `${n.toLocaleString('en-US')} balls — BOOM!`;
}

// ---------------- audio ----------------
function audio(P: Params) {
  const S = simFor(P), T = themeOf(P), tm = timing(P);
  S.ensure(tm.end);
  const mix = createMix(tm.frames / meta.fps + 0.6, T.audio);
  const lim = new VoiceLimiter(0.03, 3), cx = S.C.cx;
  let lastCount = 1;
  for (let f = 1; f <= tm.end; f++) {
    const t = f / meta.fps;
    S.eventsAt(f, (type, x, y, a, b) => {
      const pan = (x - cx) / 620;
      switch (type) {
        case Ev.Wall: { const s = clamp(a / 900, 0, 1), ang = Math.atan2(y - S.C.cy, x - cx); sfx(mix, t, 'bounce', { gain: 0.04 + 0.1 * s, pitch: scaleStep(Math.round(((ang + Math.PI) / (2 * Math.PI)) * 10)) - 5, pan, seed: f * 7 + b }, lim); break; }
        case Ev.Ball: sfx(mix, t, 'tick', { gain: 0.03 + 0.06 * clamp(a / 900, 0, 1), pitch: scaleStep(b % 10) - 2, pan, seed: f * 13 + b }, lim); break;
        case Ev.Crush: {
          // pitch climbs with the population: the more balls, the higher the crunch
          const lvl = Math.log2(a + 1);
          sfx(mix, t, 'crush', { gain: 0.22, pitch: scaleStep(Math.round(lvl * 1.4)) - 6, pan, seed: f * 31 + (b & 255) }, lim);
          const born = b >> 8;
          for (let q = 0; q < born; q++) sfx(mix, t + 0.035 * (q + 1), 'pop', { gain: 0.1, pitch: scaleStep(Math.round(lvl * 1.4) + q + 2) - 2, pan, seed: f * 3 + q }, lim);
          break;
        }
        case Ev.Spawn: sfx(mix, t, 'pop', { gain: 0.11, pitch: scaleStep(Math.round(Math.log2(a + 1) * 1.6)) - 3, pan, seed: f * 5 + b }, lim); break;
        case Ev.Strike: sfx(mix, t, 'whoosh', { gain: 0.08 + 0.18 * (lastCount / S.cap), pan: 0, seed: f }); break;
        case Ev.Slam: { const fill = clamp(a, 0, 1); sfx(mix, t, 'slam', { gain: 0.28 + 0.45 * fill, pitch: -2 * fill, pan, seed: f }); if (fill > 0.55) sfx(mix, t + 0.02, 'boom', { gain: 0.15 * fill }); break; }
        case Ev.Full: sfx(mix, t, 'chime', { gain: 0.3 }); break;
        case Ev.Cleared: sfx(mix, t, 'success', { gain: 0.45 }); break;
        case Ev.BoxClosed: sfx(mix, t, 'clang', { gain: 0.3, pitch: 0 }); break;
      }
    });
    lastCount = S.countAt(f);
  }
  // climax: riser, burst, rewind
  const tb = (tm.end + 1) / meta.fps;
  sfx(mix, tb - 0.7, 'whoosh', { gain: 0.45, seed: 99 });
  sfx(mix, tb, 'boom', { gain: 0.8 }); sfx(mix, tb + 0.01, 'shatter', { gain: 0.55, seed: 7 });
  sfx(mix, tm.rewStart / meta.fps, 'rewind', { gain: 0.45, seed: 3 });
  return master(mix);
}

// ---------------- picture ----------------
function create(env: Env, P: Params): SceneInstance {
  const S = simFor(P), T = themeOf(P), tm = timing(P), { frames } = tm;
  const W = meta.width, H = meta.height, fps = meta.fps, C = S.C, r = S.r;
  const juice = new Juice(env, juiceFrom(P), { capacity: 700, seed: +P.seed, gravity: 900, theme: T });
  const bg = makeBackground(env, W, H, T);
  const wall = makeNeon(env, W, H, g => C.path(g as any), { width: 7, blur: 16 }, T);
  // mounts: a short housing on the wall at each hammer slot
  const used = P.rule === 'box' ? S.mounts.length : Math.min(+P.hammers, S.mounts.length);
  const housing = createLayer(env, W, H);
  { const g = housing.ctx; g.fillStyle = T.color.wall2; g.strokeStyle = T.color.wall; g.lineWidth = 3;
    for (let j = 0; j < used; j++) { const m = S.mounts[j]; g.save(); g.translate(m.x, m.y); g.rotate(Math.atan2(m.dy, m.dx)); g.beginPath(); g.roundRect(-14, -S.half[j] * 0.55, 22, S.half[j] * 1.1, 6); g.fill(); g.stroke(); g.restore(); } }
  bakeStatic(bg, wall, housing);
  // cracks that appear as the container fills (seeded, drawn once)
  const cracks = createLayer(env, W, H);
  { const g = cracks.ctx, rnd = mulberry32(+P.seed * 17 + 3); g.strokeStyle = T.color.highlight; g.lineWidth = 2.5; g.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const a = rnd() * Math.PI * 2; let x = C.cx + Math.cos(a) * 2000, y = C.cy + Math.sin(a) * 2000;
      // walk from the centre outward until the wall, then crack inward from there
      for (let d = 0; d < 1200; d += 4) { const xx = C.cx + Math.cos(a) * d, yy = C.cy + Math.sin(a) * d; if (C.inside(xx, yy) < 0) { x = xx; y = yy; break; } }
      g.beginPath(); g.moveTo(x, y);
      let ang = a + Math.PI;
      for (let s = 0; s < 6; s++) { ang += (rnd() - 0.5) * 0.9; x += Math.cos(ang) * (14 + rnd() * 22); y += Math.sin(ang) * (14 + rnd() * 22); g.lineTo(x, y); }
      g.stroke();
    } }
  // sprites: shape x colour
  const pal = paletteFor(T, P.palette, 'cyclic'), NC = 12;
  const cols = Array.from({ length: NC }, (_, i) => samplePalette(pal, i / NC, true));
  const kinds: ShapeKind[] = P.objects === 'mixed' ? SHAPE_KINDS : [String(P.objects) as ShapeKind];
  const sprites: Sprite[][] = kinds.map(k => cols.map(c => makeShapeSprite(env, c, r, k, T, 1.3)));
  const spriteOf = (i: number, c: number) => sprites[kinds.length > 1 ? c % kinds.length : 0][c % NC];
  // hammer head sprite per mount (horizontal, length 2*half, thickness 2*9)
  const heads = S.half.map(h => {
    const L = Math.ceil(2 * h + 8), Hh = 26, c = env.createCanvas(Math.ceil(L * env.scale), Math.ceil(Hh * env.scale)), g = c.getContext('2d') as Ctx;
    g.scale(env.scale, env.scale);
    g.fillStyle = T.color.wall2; g.beginPath(); g.roundRect(4, 4, L - 8, Hh - 8, 6); g.fill();
    g.save(); g.clip(); g.strokeStyle = T.color.accent; g.lineWidth = 5; g.globalAlpha = 0.85;
    for (let x = -Hh; x < L; x += 14) { g.beginPath(); g.moveTo(x, Hh); g.lineTo(x + Hh, 0); g.stroke(); }
    g.restore(); g.strokeStyle = T.color.wall; g.lineWidth = 2.5; g.beginPath(); g.roundRect(4, 4, L - 8, Hh - 8, 6); g.stroke();
    return { canvas: c, w: L, h: Hh } as Sprite;
  });
  // burst: per-ball outward kick (pure function of index) and wall shards
  const shards: { x: number; y: number; vx: number; vy: number; a: number; w: number; len: number }[] = [];
  { const rnd = mulberry32(+P.seed * 5 + 1), pts: number[] = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; for (let d = 1300; d > 0; d -= 4) { const x = C.cx + Math.cos(a) * d, y = C.cy + Math.sin(a) * d; if (C.inside(x, y) >= 0) { pts.push(x, y); break; } } }
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const x0 = pts[k], y0 = pts[k + 1], x1 = pts[k + 2], y1 = pts[k + 3], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = mx - C.cx, dy = my - C.cy, d = Math.hypot(dx, dy) || 1, sp = 500 + rnd() * 900;
      shards.push({ x: mx, y: my, vx: (dx / d) * sp + (rnd() - 0.5) * 200, vy: (dy / d) * sp - 300 * rnd(), a: Math.atan2(y1 - y0, x1 - x0), w: (rnd() - 0.5) * 14, len: Math.hypot(x1 - x0, y1 - y0) });
    } }
  const accent = T.color.accent;
  const makeBgOnly = makeBackground(env, W, H, T); // background without the container (after the burst)

  let st = { frame: 0, shown: 0, lastN: S.countAt(0), burst: false };

  /** which recorded sim frame the video frame f shows (rewind plays the recording backwards) */
  function simFrame(f: number) {
    if (f <= tm.end) return f;
    if (f < tm.rewStart) return tm.end;
    const u = clamp((f - tm.rewStart) / Math.max(1, frames - 1 - tm.rewStart), 0, 1);
    return Math.round(tm.end * (1 - ease.inOutSine(u)));
  }

  function step() {
    const f = ++st.frame;
    if (f <= tm.end) {
      S.eventsAt(f, (type, x, y, a, b) => {
        switch (type) {
          case Ev.Crush: juice.burst(x, y, 5, { speed: 260, u: (b & 255) / NC, life: 0.4, size: 0.6 }); break;
          case Ev.Spawn: juice.burst(x, y, 2, { speed: 140, u: (b & 255) / NC, life: 0.3, size: 0.5 }); break;
          case Ev.Slam: juice.shake(2 + 12 * clamp(a, 0, 1)); juice.burst(x, y, 8, { speed: 420, life: 0.35, size: 0.7 }); break;
          case Ev.BoxClosed: juice.flash(0.18); break;
          case Ev.Full: juice.flash(0.3); juice.pop('counter', 1); break;
          case Ev.Cleared: juice.flash(0.5); juice.pop('counter', 1.2); break;
        }
      });
      const n = S.countAt(f);
      if (n !== st.lastN) { juice.pop('counter', Math.min(0.5, 0.06 + 0.02 * Math.abs(n - st.lastN))); st.lastN = n; }
    } else if (f === tm.end + 1) {
      st.burst = true; juice.flash(0.8); juice.shake(34); juice.pop('counter', 1.5);
      for (let k = 0; k < 24; k++) juice.burst(C.cx + Math.cos(k) * C.R * 0.9, C.cy + Math.sin(k) * C.R * 0.9, 6, { speed: 900, dir: k, spread: 1.2, u: k / 24 });
    }
    juice.update(1 / fps);
  }

  function drawHammers(ctx: Ctx, sf: number) {
    for (let j = 0; j < used; j++) {
      const m = S.mounts[j], e = Math.max(0, S.hammerAt(sf, j)), d = S.rest[j] + e;
      const hx = m.x + m.dx * d, hy = m.y + m.dy * d;
      if (e > 0.5) {
        ctx.strokeStyle = T.color.wall; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(hx - m.dx * 9, hy - m.dy * 9); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3; ctx.stroke(); ctx.globalAlpha = 1;
      }
      // telescopic head: drawn at the length it has at this extension
      const h = heads[j], L = 2 * S.halfAt(j, e) + 8;
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(Math.atan2(m.dy, m.dx) + Math.PI / 2);
      ctx.drawImage(h.canvas as CanvasImageSource, -L / 2, -h.h / 2, L, h.h); ctx.restore();
    }
  }

  function drawBalls(ctx: Ctx, sf: number, burstT: number) {
    const b = S.ballsAt(sf), q = b.q;
    for (let i = b.start; i < b.end; i++) {
      let x = b.xy[2 * i] / q, y = b.xy[2 * i + 1] / q;
      const c = b.col[i], age = b.age[i];
      if (burstT > 0) {
        const k = i - b.start, h1 = hash01(k * 7 + 1), dx = x - C.cx, dy = y - C.cy, d = Math.sqrt(dx * dx + dy * dy) || 1, sp = 300 + 1100 * h1 * (0.4 + d / C.R);
        x += ((dx / d) * sp + (hash01(k * 3) - 0.5) * 300) * burstT; y += ((dy / d) * sp) * burstT + 900 * burstT * burstT;
      }
      const sc = age < 10 ? 0.35 + 0.65 * ease.outBack(age / 10) : 1;
      drawSprite(ctx, spriteOf(i, c), x, y, 1, sc);
    }
  }

  function draw(ctx: Ctx) {
    const f = st.frame, sf = simFrame(f), n = S.countAt(sf), fill = n / S.cap;
    const burstT = f > tm.end && f < tm.rewStart ? (f - tm.end) / fps : 0;
    const rewinding = f >= tm.rewStart && f < frames - 3;
    ctx.globalCompositeOperation = 'source-over';
    if (burstT > 0) {
      // the container is gone: background only, plus its flying shards
      drawLayer(ctx, makeBgOnly);
    } else drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    if (burstT === 0) {
      // pressure: the walls pulse faster and brighter as the container fills; cracks show near capacity
      if (fill > 0.45) {
        const tt = f / fps, rate = 1 + 5 * fill, a = clamp((fill - 0.45) / 0.55, 0, 1) * (0.35 + 0.35 * Math.sin(tt * rate * Math.PI * 2));
        ctx.globalCompositeOperation = wall.op ?? 'source-over'; ctx.globalAlpha = clamp(a, 0, 1); drawLayer(ctx, wall); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      const ca = clamp((fill - 0.75) / 0.25, 0, 1);
      if (ca > 0) { ctx.globalAlpha = ca * (0.75 + 0.25 * Math.sin(f * 0.9)); drawLayer(ctx, cracks); ctx.globalAlpha = 1; }
      drawHammers(ctx, sf);
    } else {
      ctx.strokeStyle = T.color.wall; ctx.lineWidth = 7; ctx.lineCap = 'round';
      for (const s of shards) {
        const x = s.x + s.vx * burstT, y = s.y + s.vy * burstT + 900 * burstT * burstT, a = s.a + s.w * burstT;
        ctx.globalAlpha = clamp(1 - burstT / BURST_HOLD, 0, 1);
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * s.len / 2, y - Math.sin(a) * s.len / 2); ctx.lineTo(x + Math.cos(a) * s.len / 2, y + Math.sin(a) * s.len / 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    drawBalls(ctx, sf, burstT);
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    if (rewinding) {
      // tape-rewind look: a light tint and a ◀◀ mark
      ctx.fillStyle = rgbaOf(T.color.accent, 0.06); ctx.fillRect(0, 0, W, H);
      ctx.font = fontOf(T, 64); ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.fillText('◀◀', W / 2, 470); ctx.textAlign = 'left';
    }
    const ended = f > tm.end && f < tm.rewStart;
    const shownN = n; // exact count every frame (the pop marks each change)
    const counter = ended ? [{ text: answerOf(P, S, n), color: accent }]
      : S.clearedAt >= 0 && sf >= Math.round(S.clearedAt * fps) && !rewinding ? [{ text: answerOf(P, S, 0), color: accent }]
      : [{ text: labelOf(P), color: T.color.text }, { text: shownN.toLocaleString('en-US'), color: accent }];
    drawHeader(ctx, W, { title: titleOf(P), titleY: 255, counter, counterY: 1650, counterScale: juice.popScale('counter'), handle: String(P.handle), handleY: 1725, t: f / fps }, T);
  }
  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('hammer-smash: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: { ...st }, juice: juice.snapshot() }),
    restore(s: any) { st = { ...s.st }; juice.restore(s.juice); },
    diagnostics: () => ({ ballRadius: +S.r.toFixed(2), capacity: S.cap, maxBalls: S.maxN, fullAt: S.fullAt, clearedAt: S.clearedAt, strikes: S.strikes, crushes: S.crushes, spawns: S.spawns, recordedFrames: S.done, recordingMB: +(S.bytes() / 1e6).toFixed(1), seed: +P.seed }),
    stateVector: () => S.stateAt(simFrame(st.frame)),
  };
}

export default { meta, schema, create, audio, hook } satisfies SceneModule;
