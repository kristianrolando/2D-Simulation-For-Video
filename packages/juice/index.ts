// @sim/juice — reusable "game feel" effects for every scene.
// All effects are deterministic (seeded RNG whose state lives in the snapshot), driven by simulation
// events, and individually scalable: intensity 0 switches an effect off. Nothing here allocates per
// frame in the hot path: particles live in a fixed-size struct-of-arrays pool.
import type { Ctx, Env, Params, Schema } from '../core/index.ts';
import { clamp, samplePalette, ease, type RGB } from '../core/index.ts';
import { CLASSIC, rgbOf, type Theme } from '../theme/index.ts';
import { makeGlowSprite, type Sprite } from '../render2d/index.ts';

// easing lives in core (shared with render2d titles/ripples); re-exported for existing imports
export { ease } from '../core/ease.ts';

// ---------------- settings ----------------
export interface JuiceSettings { shake: number; flash: number; burst: number; squash: number; pop: number; energy: number }
export const JUICE_KEYS: (keyof JuiceSettings)[] = ['shake', 'flash', 'burst', 'squash', 'pop', 'energy'];
const LABEL: Record<keyof JuiceSettings, string> = {
  shake: 'Screen shake', flash: 'Flash', burst: 'Particle bursts', squash: 'Squash & stretch', pop: 'Counter pop', energy: 'Energy colour',
};

/** schema block every scene spreads into its own schema (group "Juice"); 0 = off, 1 = default, 2 = loud */
export function juiceSchema(d: Partial<JuiceSettings> = {}): Schema {
  const s: Schema = {};
  for (const k of JUICE_KEYS) s['juice_' + k] = { type: 'number', default: d[k] ?? 1, min: 0, max: 2, step: 0.05, group: 'Juice', label: LABEL[k] };
  return s;
}
export function juiceFrom(p: Params): JuiceSettings {
  const o = {} as JuiceSettings;
  for (const k of JUICE_KEYS) o[k] = Number(p['juice_' + k] ?? 1);
  return o;
}

// ---------------- state (plain data => structuredClone-able for checkpoints) ----------------
interface JuiceState {
  rng: number;
  shake: number; shakeX: number; shakeY: number;
  flash: number; flashRGB: [number, number, number];
  pops: Record<string, number>;
  rolls: Record<string, { from: number; to: number; age: number }>;
  live: number;
}


export class Juice {
  readonly s: JuiceSettings;
  private st: JuiceState;
  // particle pool (struct of arrays)
  readonly cap: number;
  private px: Float32Array; private py: Float32Array; private vx: Float32Array; private vy: Float32Array;
  private life: Float32Array; private max: Float32Array; private size: Float32Array; private col: Uint8Array;
  private sprites: Sprite[];
  private colors: RGB[];
  private gravity: number; private drag: number; private dpr: number;
  private T: Theme;

  constructor(env: Env, settings: JuiceSettings, o: { capacity?: number; seed?: number; gravity?: number; drag?: number; palette?: string[]; theme?: Theme } = {}) {
    const T = (this.T = o.theme ?? CLASSIC);
    // the theme's juice profile scales the user's sliders (classic = x1); 0 still switches an effect off
    this.s = { shake: settings.shake * T.juice.shake, flash: settings.flash * T.juice.flash, burst: settings.burst * T.juice.burst,
      squash: settings.squash * T.juice.squash, pop: settings.pop * T.juice.pop, energy: settings.energy * T.juice.energy };
    this.dpr = env.scale;
    // the preview may ask for fewer particles; the final render always gets the full pool
    const q = env.quality?.particles ?? 1;
    this.cap = Math.max(16, Math.round((o.capacity ?? 600) * q));
    this.px = new Float32Array(this.cap); this.py = new Float32Array(this.cap); this.vx = new Float32Array(this.cap); this.vy = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap); this.max = new Float32Array(this.cap); this.size = new Float32Array(this.cap); this.col = new Uint8Array(this.cap);
    this.gravity = o.gravity ?? 900; this.drag = o.drag ?? 2.2;
    const pal = o.palette ?? T.palettes.sparks;
    this.colors = Array.from({ length: 16 }, (_, i) => samplePalette(pal, i / 15, false));
    this.sprites = this.colors.map(c => makeGlowSprite(env, c, 10, { core: 0.25 }, T));
    this.st = { rng: (o.seed ?? 1) >>> 0, shake: 0, shakeX: 0, shakeY: 0, flash: 0, flashRGB: [255, 255, 255], pops: {}, rolls: {}, live: 0 };
  }

  /** deterministic RNG in [0,1) whose state is part of the snapshot */
  private rand(): number {
    let a = (this.st.rng = (this.st.rng + 0x6d2b79f5) >>> 0);
    a = Math.imul(a ^ (a >>> 15), a | 1); a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }

  // ---- triggers ----
  shake(amount: number) { if (this.s.shake > 0) this.st.shake = Math.min(40, this.st.shake + amount * this.s.shake); }
  flash(amount: number, rgb: [number, number, number] = [255, 255, 255]) {
    if (this.s.flash <= 0 || this.T.juice.flashMode === 'none') return;
    this.st.flash = Math.min(0.85, Math.max(this.st.flash, amount * this.s.flash));
    this.st.flashRGB = this.T.juice.flashColor === 'event' ? rgb : rgbOf(this.T.juice.flashColor);
  }
  /** emit `count` sparks from (x,y); colour u in [0,1] picks from the juice palette */
  burst(x: number, y: number, count: number, o: { speed?: number; u?: number; dir?: number; spread?: number; life?: number; size?: number } = {}) {
    const n = Math.round(count * this.s.burst);
    if (n <= 0) return;
    const speed = o.speed ?? 380, spread = o.spread ?? Math.PI * 2, dir = o.dir ?? 0, lifeT = o.life ?? 0.55;
    for (let k = 0; k < n; k++) {
      // find a free slot (ring scan from the live count); if full, overwrite the oldest-ish slot
      let i = -1;
      for (let j = 0; j < this.cap; j++) { const c = (this.st.live + j) % this.cap; if (this.life[c] <= 0) { i = c; break; } }
      if (i < 0) i = (this.st.live++) % this.cap;
      const a = dir + (this.rand() - 0.5) * spread, v = speed * (0.35 + 0.65 * this.rand());
      this.px[i] = x; this.py[i] = y; this.vx[i] = Math.cos(a) * v; this.vy[i] = Math.sin(a) * v;
      this.max[i] = this.life[i] = lifeT * (0.6 + 0.8 * this.rand());
      this.size[i] = (o.size ?? 1) * (0.5 + this.rand() * 0.7);
      this.col[i] = Math.min(15, Math.max(0, Math.round(((o.u ?? this.rand()) * 15))));
    }
  }
  /** bump a named element (e.g. the counter) — read back with popScale */
  pop(key: string, amount = 1) { if (this.s.pop > 0) this.st.pops[key] = Math.min(1.5, (this.st.pops[key] ?? 0) + amount); }
  popScale(key: string) { const p = this.st.pops[key] ?? 0; return 1 + 0.35 * this.T.motion.popAmount * this.s.pop * ease[this.T.motion.pop](clamp(p, 0, 1)) * p; }
  /** number that rolls towards its new value instead of jumping */
  roll(key: string, target: number): number {
    const r = this.st.rolls[key];
    if (!r) { this.st.rolls[key] = { from: target, to: target, age: 1 }; return target; }
    if (r.to !== target) { r.from = this.rolled(key); r.to = target; r.age = 0; }
    return this.rolled(key);
  }
  private rolled(key: string) { const r = this.st.rolls[key]; if (!r) return 0; const u = this.s.pop > 0 ? ease[this.T.motion.roll](clamp(r.age / this.T.motion.rollTime, 0, 1)) : 1; return r.from + (r.to - r.from) * u; }

  // ---- per-frame update (fixed dt) ----
  update(dt: number) {
    const st = this.st;
    st.shake *= Math.exp(-dt * 9);
    if (st.shake < 0.05) st.shake = 0;
    const a = this.rand() * Math.PI * 2;
    if (this.T.motion.shake === 'horizontal') { st.shakeX = (a < Math.PI ? 1 : -1) * st.shake * 1.4; st.shakeY = 0; } // glitch jitter
    else if (this.T.motion.shake === 'none') { st.shakeX = 0; st.shakeY = 0; }
    else { st.shakeX = Math.cos(a) * st.shake; st.shakeY = Math.sin(a) * st.shake; }
    st.flash *= Math.exp(-dt * 7); if (st.flash < 0.003) st.flash = 0;
    for (const k in st.pops) { st.pops[k] *= Math.exp(-dt * 8); if (st.pops[k] < 0.002) delete st.pops[k]; }
    for (const k in st.rolls) st.rolls[k].age += dt;
    const g = this.gravity * dt, d = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d + g;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt;
    }
  }

  // ---- drawing ----
  /** shake offset is snapped to whole device pixels: a sub-pixel translate forces every full-screen
   *  layer blit through bilinear resampling (measured: p95 frame cost 24 -> 38 ms on the ellipse scene) */
  beginWorld(ctx: Ctx) {
    ctx.save();
    if (this.st.shake > 0) { const k = this.dpr; ctx.translate(Math.round(this.st.shakeX * k) / k, Math.round(this.st.shakeY * k) / k); }
  }
  endWorld(ctx: Ctx) { ctx.restore(); }
  drawParticles(ctx: Ctx) {
    const prev = ctx.globalCompositeOperation; ctx.globalCompositeOperation = this.T.juice.blend;
    for (let i = 0; i < this.cap; i++) {
      const l = this.life[i]; if (l <= 0) continue;
      const u = l / this.max[i], sp = this.sprites[this.col[i]], s = this.size[i] * (0.6 + 0.4 * u);
      ctx.globalAlpha = Math.min(1, u * 1.4);
      ctx.drawImage(sp.canvas as CanvasImageSource, this.px[i] - sp.w * s / 2, this.py[i] - sp.h * s / 2, sp.w * s, sp.h * s);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = prev;
  }
  drawFlash(ctx: Ctx, W: number, H: number) {
    if (this.st.flash <= 0) return;
    const [r, g, b] = this.st.flashRGB, mode = this.T.juice.flashMode;
    ctx.save();
    if (mode === 'invert') { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, this.st.flash * 1.1)})`; }
    else if (mode === 'tint') { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgba(${r},${g},${b},${this.st.flash * 0.45})`; }
    else { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(${r},${g},${b},${this.st.flash * 0.35})`; }
    ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  /** squash & stretch transform for a moving/impacting body: stretch along velocity, squash on impact */
  squash(speed01: number, impactAge = Infinity): { sx: number; sy: number } {
    if (this.s.squash <= 0) return { sx: 1, sy: 1 };
    const st = 1 + 0.35 * this.s.squash * clamp(speed01, 0, 1);
    const hit = impactAge < 0.12 ? 0.35 * this.s.squash * (1 - impactAge / 0.12) : 0;
    const sx = st * (1 - hit), sy = (1 / st) * (1 + hit * 0.8);
    return { sx, sy };
  }
  /** shift a colour toward white-hot with energy e in [0,1] */
  energize(rgb: RGB | number[], e: number): RGB {
    const k = clamp(e, 0, 1) * 0.55 * this.s.energy;
    return [rgb[0] + (255 - rgb[0]) * k, rgb[1] + (255 - rgb[1]) * k, rgb[2] + (255 - rgb[2]) * k];
  }
  liveParticles() { let n = 0; for (let i = 0; i < this.cap; i++) if (this.life[i] > 0) n++; return n; }

  snapshot() {
    return { st: structuredClone(this.st), px: this.px.slice(), py: this.py.slice(), vx: this.vx.slice(), vy: this.vy.slice(), life: this.life.slice(), max: this.max.slice(), size: this.size.slice(), col: this.col.slice() };
  }
  restore(s: ReturnType<Juice['snapshot']>) {
    this.st = structuredClone(s.st);
    this.px.set(s.px); this.py.set(s.py); this.vx.set(s.vx); this.vy.set(s.vy); this.life.set(s.life); this.max.set(s.max); this.size.set(s.size); this.col.set(s.col);
  }
}

/** draw a sprite rotated to `angle` and scaled (sx along the angle, sy across) */
export function drawSquashed(ctx: Ctx, sp: Sprite, x: number, y: number, angle: number, sx: number, sy: number, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = Math.min(1, alpha); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(sx, sy);
  ctx.drawImage(sp.canvas as CanvasImageSource, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.restore();
}
