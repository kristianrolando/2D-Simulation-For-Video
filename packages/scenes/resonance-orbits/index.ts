// Scene: orbital resonance string art — two planets on circular orbits with a p:q period ratio; a line
// joins them at regular intervals. After q outer orbits the pattern closes into a (p−q)-fold flower.
import { TimeWarp, commonSchema, samplePalette, PALETTES, frameCount, clamp, dsin, dcos, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { STYLE, bakeStatic, createLayer, drawLayer, copyLayer, restoreLayer, makeBackground, makeBallSprite, makeCometSprite, makeGlowSprite, drawComet, drawSprite, drawHeader, drawRipple } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, classicOr, rgbOf, rgbStr } from '../../theme/index.ts';

const meta = { id: 'resonance-orbits', name: 'Resonance orbits', family: 'orbits', description: 'Two planets in a p:q resonance; joining them over time draws a flower.', width: 1080, height: 1920, fps: 60, loudness: -15 };

const schema: Schema = {
  ...commonSchema({ title: 'What do two orbits draw together?', duration: 30.5, answer: '{n} petals from two circles!' }),
  inner: { type: 'integer', default: 13, min: 2, max: 40, group: 'Orbits', label: 'Inner planet orbits', sim: true },
  outer: { type: 'integer', default: 8, min: 1, max: 39, group: 'Orbits', label: 'Outer planet orbits', sim: true },
  rInner: { type: 'number', default: 270, min: 80, max: 440, step: 1, unit: 'px', group: 'Orbits', label: 'Inner radius' },
  rOuter: { type: 'number', default: 430, min: 120, max: 480, step: 1, unit: 'px', group: 'Orbits', label: 'Outer radius' },
  lines: { type: 'integer', default: 520, min: 40, max: 3000, group: 'Orbits', label: 'Lines drawn per cycle', sim: true },
  innerName: { type: 'text', default: 'inner', group: 'Text', label: 'Inner planet name' },
  outerName: { type: 'text', default: 'outer', group: 'Text', label: 'Outer planet name' },
  closeAt: { type: 'number', default: 28.3, min: 3, max: 88, step: 0.1, unit: 's', group: 'Timing', label: 'Pattern closes at', sim: true },
  speedUp: { type: 'number', default: 2.4, min: 1, max: 6, step: 0.1, group: 'Timing', label: 'Speed at end ÷ start', sim: true },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.4, burst: 0.8 }),
};

const SUN = { x: 540, y: 980 }, TAU = Math.PI * 2;

function warpFor(P: Params) {
  const closeAt = Math.min(+P.closeAt, +P.duration - 0.2), k = +P.speedUp - 1;
  // sim time unit: 1 = one full cycle (outer planet completes `outer` orbits)
  return new TimeWarp({ fps: meta.fps, frames: frameCount(P, meta.fps), anchorFrame: Math.round(closeAt * meta.fps), anchorSim: 1,
    rateAt: t => (t > closeAt ? 0.06 : 1 + k * Math.min(1, t / closeAt) ** 2) });
}
const angle = (n: number, s: number) => -Math.PI / 2 + TAU * n * s;
function planets(P: Params, s: number) {
  const a1 = angle(+P.inner, s), a2 = angle(+P.outer, s);
  return [SUN.x + +P.rInner * dcos(a1), SUN.y + +P.rInner * dsin(a1), SUN.x + +P.rOuter * dcos(a2), SUN.y + +P.rOuter * dsin(a2)];
}
/** conjunctions: inner laps the outer every 1/(inner−outer) of a cycle */
function events(P: Params, warp: TimeWarp) {
  const out: { t: number; type: 'orbitIn' | 'orbitOut' | 'conj'; k: number }[] = [];
  const d = Math.abs(+P.inner - +P.outer) || 1;
  for (let k = 1; k <= +P.inner; k++) out.push({ t: warp.videoTime(k / +P.inner), type: 'orbitIn', k });
  for (let k = 1; k <= +P.outer; k++) out.push({ t: warp.videoTime(k / +P.outer), type: 'orbitOut', k });
  for (let k = 1; k <= d; k++) out.push({ t: warp.videoTime(k / d), type: 'conj', k });
  return out.sort((a, b) => a.t - b.t);
}

function audio(P: Params) {
  const warp = warpFor(P), mix = createMix(frameCount(P, meta.fps) / meta.fps + 0.5, themeOf(P).audio), lim = new VoiceLimiter(0.05, 2);
  for (const e of events(P, warp)) {
    if (e.type === 'orbitIn') sfx(mix, e.t, 'ping', { gain: 0.16, pitch: scaleStep(e.k % 10) - 2, pan: -0.3, seed: e.k }, lim);
    else if (e.type === 'orbitOut') sfx(mix, e.t, 'ping', { gain: 0.2, pitch: scaleStep(e.k % 10) - 12, pan: 0.3, seed: 100 + e.k }, lim);
    else sfx(mix, e.t, 'chime', { gain: 0.3, pitch: scaleStep(e.k) - 5, seed: 200 + e.k }, lim);
  }
  sfx(mix, warp.videoTime(1), 'success', { gain: 0.55 });
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const W = meta.width, H = meta.height, fps = meta.fps, frames = frameCount(P, fps), warp = warpFor(P);
  const T = themeOf(P);
  const juice = new Juice(env, juiceFrom(P), { capacity: 400, seed: 5, gravity: 0, drag: 2.5, theme: T });
  const bg = makeBackground(env, W, H, T);
  const art = createLayer(env, W, H), haze = createLayer(env, W, H, 0.25);
  const rings = createLayer(env, W, H); rings.op = T.blend === 'lighter' ? 'lighter' : 'source-over';
  if (T.line.style === 'technical') rings.ctx.setLineDash([24, 8, 4, 8]);
  for (const r of [+P.rInner, +P.rOuter]) { rings.ctx.strokeStyle = classicOr(T, 'rgba(140,170,220,0.18)', `rgba(${rgbStr(T.color.guide)},${T.dark ? 0.3 : 0.45})`); rings.ctx.lineWidth = 2; rings.ctx.beginPath(); rings.ctx.arc(SUN.x, SUN.y, r, 0, TAU); rings.ctx.stroke(); }
  bakeStatic(bg, rings);
  const pal = paletteFor(T, P.palette, 'timeline');
  const N = 64, cols = Array.from({ length: N }, (_, i) => samplePalette(pal, i / (N - 1), false));
  const cA = rgbOf(T.color.planetA), cB = rgbOf(T.color.planetB);
  const pIn = makeBallSprite(env, cA, 13, {}, T), pOut = makeBallSprite(env, cB, 15, {}, T);
  const cIn = makeCometSprite(env, cA, 60, 8, T), cOut = makeCometSprite(env, cB, 70, 9, T);
  const sunGlow = makeGlowSprite(env, classicOr(T, [255, 160, 50], rgbOf(T.color.sunHalo)), 80, { core: 0.25 }, T), sunCore = makeGlowSprite(env, classicOr(T, [255, 250, 230], rgbOf(T.color.sunCore)), 30, { core: 0.6 }, T);
  // non-glow styles: the sun is a solid body in the style's ball shape (sticker, pixel, ring, chalk...)
  const sunBody = T.spark === 'glow' ? null : makeBallSprite(env, rgbOf(T.color.sunDisc), 24, {}, T);
  const link = classicOr(T, 'rgba(255,255,255,0.55)', `rgba(${rgbStr(T.color.highlight)},0.7)`);
  const ev = events(P, warp).map(e => ({ ...e, f: e.t * fps }));
  const nLines = +P.lines;
  const petals = Math.abs(+P.inner - +P.outer);
  let st = { frame: 0, line: 0, ev: 0, nIn: 0, nOut: 0, conj: [] as { x: number; y: number; t: number }[], closedT: -1 };

  function step() {
    const f = ++st.frame, t = f / fps, s = Math.min(1, warp.sim(f));
    const ci = clamp(Math.floor(s * (N - 1)), 0, N - 1), [r, g, b] = cols[ci].map(Math.round);
    const ac = art.ctx, hc = haze.ctx; ac.globalCompositeOperation = hc.globalCompositeOperation = T.blend;
    ac.strokeStyle = `rgba(${r},${g},${b},${Math.min(1, 0.42 * T.trail.alpha)})`; ac.lineWidth = 1.3 * T.trail.width; hc.strokeStyle = `rgba(${r},${g},${b},${0.035 * T.trail.haze})`; hc.lineWidth = 8;
    ac.beginPath(); hc.beginPath();
    while (st.line < nLines && (st.line + 1) / nLines <= s + 1e-12) {
      st.line++;
      const [x1, y1, x2, y2] = planets(P, st.line / nLines);
      ac.moveTo(x1, y1); ac.lineTo(x2, y2); hc.moveTo(x1, y1); hc.lineTo(x2, y2);
    }
    ac.stroke(); hc.stroke();
    while (st.ev < ev.length && ev[st.ev].f <= f) {
      const e = ev[st.ev++];
      const [x1, y1, x2, y2] = planets(P, Math.min(1, warp.sim(f)));
      if (e.type === 'orbitIn') { st.nIn = e.k; juice.pop('counter', 0.5); juice.burst(x1, y1, 6, { speed: 180, u: 0.8 }); }
      else if (e.type === 'orbitOut') { st.nOut = e.k; juice.pop('counter', 0.7); juice.burst(x2, y2, 8, { speed: 200, u: 0.2 }); }
      else { st.conj.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, t }); juice.shake(3); juice.burst(x2, y2, 14, { speed: 320, u: e.k / Math.max(1, petals) }); }
    }
    st.conj = st.conj.filter(c => t - c.t < 1);
    if (st.closedT < 0 && warp.sim(f) >= 1) { st.closedT = t; juice.flash(0.6, [255, 230, 170]); juice.shake(8); juice.pop('counter', 1.2); const [, , x2, y2] = planets(P, 1); juice.burst(x2, y2, 60, { speed: 600 }); }
    juice.update(1 / fps);
  }

  function draw(ctx: Ctx) {
    const t = st.frame / fps, s = warp.sim(st.frame);
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    ctx.globalCompositeOperation = T.blend;
    ctx.imageSmoothingEnabled = true; drawLayer(ctx, haze); drawLayer(ctx, art);
    for (const c of st.conj) drawRipple(ctx, c.x, c.y, t - c.t, { r0: 10, r1: 120, dur: 1 }, T);
    ctx.globalCompositeOperation = T.juice.blend;
    if (sunBody) { ctx.globalCompositeOperation = 'source-over'; drawSprite(ctx, sunBody, SUN.x, SUN.y); }
    else { drawSprite(ctx, sunGlow, SUN.x, SUN.y); drawSprite(ctx, sunCore, SUN.x, SUN.y); }
    ctx.globalCompositeOperation = T.blend;
    const [x1, y1, x2, y2] = planets(P, s), [px1, py1, px2, py2] = planets(P, s - 0.002);
    ctx.strokeStyle = link; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    drawComet(ctx, cIn, x1, y1, x1 - px1, y1 - py1, 0.9); drawComet(ctx, cOut, x2, y2, x2 - px2, y2 - py2, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    drawSprite(ctx, pIn, x1, y1); drawSprite(ctx, pOut, x2, y2);
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    const counter = st.closedT >= 0 ? [{ text: String(P.answer).replace('{n}', String(petals)), color: T.color.accent }]
      : [{ text: `${P.innerName}  `, color: T.color.planetA }, { text: String(st.nIn), color: T.color.accent }, { text: '  :  ', color: T.color.text },
        { text: String(st.nOut), color: T.color.accent }, { text: `  ${P.outerName}`, color: T.color.planetB }];
    drawHeader(ctx, W, { title: String(P.title), counter, counterScale: juice.popScale('counter'), handle: String(P.handle), t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('resonance-orbits: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), layers: [copyLayer(env, art), copyLayer(env, haze)] }),
    restore(x: any) { st = structuredClone(x.st); juice.restore(x.juice); restoreLayer(art, x.layers[0]); restoreLayer(haze, x.layers[1]); },
    diagnostics: () => { const [x1, y1, x2, y2] = planets(P, 1), [a1, b1, a2, b2] = planets(P, 0); return { closureErrPx: Math.hypot(x1 - a1, y1 - b1) + Math.hypot(x2 - a2, y2 - b2), petals, lines: st.line }; },
    stateVector: () => planets(P, Math.min(1, warp.sim(st.frame))),
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
