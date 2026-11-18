// Preview player: drives a SceneInstance in the browser in real time.
// - The audio clock (AudioContext.currentTime) is the master clock when sound is on.
// - Non-seekable scenes (accumulated trails) are checkpointed every CHECK_EVERY frames by a background
//   "buffer" instance that runs in idle time; seeking restores the nearest checkpoint and steps forward.
import type { Ctx, Env, Params, SceneInstance, SceneModule } from '../../packages/core/index.ts';

const CHECK_EVERY = 60;
const MAX_CHECKPOINTS = 64;

export type Quality = 'auto' | 'high' | 'low';
/** preview settings per tier; the final render ignores all of this (always scale 1, full particles, glow) */
const TIERS = { high: { scale: 1, particles: 1, glow: true }, mid: { scale: 0.5, particles: 1, glow: true }, low: { scale: 0.34, particles: 0.4, glow: false } };
type Tier = keyof typeof TIERS;

function browserEnv(tier: Tier): Env {
  const t = TIERS[tier];
  return { scale: t.scale, quality: { particles: t.particles, glow: t.glow }, createCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } };
}

export interface PlayerStatus { frame: number; frames: number; playing: boolean; buffered: number; drawMs: number; dropped: number; audio: 'off' | 'preparing' | 'on'; tier: string }

export class Player {
  private ctx: Ctx;
  private env!: Env;
  private inst!: SceneInstance;
  private buffer: SceneInstance | null = null;
  private bufferCtx!: Ctx;
  private checkpoints = new Map<number, unknown>();
  private raf = 0; private idle = 0;
  private audioCtx: AudioContext | null = null; private src: AudioBufferSourceNode | null = null;
  private audioCache: { key: string; buf: AudioBuffer } | null = null;
  private clock0 = 0; private frame0 = 0;
  private stats = { drawMs: 0, dropped: 0 };
  scene!: SceneModule; params!: Params;
  playing = false; sound = true; quality: Quality = 'auto'; tier: Tier = 'mid';
  private slowFrames = 0; private emaMs = 0;
  onStatus: (s: PlayerStatus) => void = () => {};

  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; this.ctx = canvas.getContext('2d') as Ctx; }

  get frames() { return this.inst?.frames ?? 0; }
  get frame() { return this.inst?.frame ?? 0; }

  load(scene: SceneModule, params: Params, keepFrame = false) {
    const at = keepFrame ? this.frame : 0;
    const wasPlaying = this.playing;
    this.pause();
    this.scene = scene; this.params = params;
    if (this.quality !== 'auto') this.tier = this.quality === 'high' ? 'high' : 'low';
    const sc = TIERS[this.tier].scale;
    this.canvas.width = Math.round(scene.meta.width * sc); this.canvas.height = Math.round(scene.meta.height * sc);
    this.ctx.setTransform(sc, 0, 0, sc, 0, 0);
    this.env = browserEnv(this.tier);
    this.slowFrames = 0; this.emaMs = 0;
    this.inst = scene.create(this.env, params);
    this.checkpoints.clear();
    this.buffer = null;
    if (!this.inst.seekable && this.inst.snapshot) {
      this.buffer = scene.create(this.env, params);
      const c = document.createElement('canvas'); c.width = 4; c.height = 4; this.bufferCtx = c.getContext('2d') as Ctx;
      this.checkpoints.set(0, this.inst.snapshot());
      this.scheduleBuffering();
    }
    this.seek(Math.min(at, this.frames - 1));
    if (wasPlaying) this.play();
  }

  /** background fill of checkpoints, a few frames per idle slice */
  private scheduleBuffering() {
    cancelIdleCallback(this.idle);
    const work = (dl: IdleDeadline) => {
      const b = this.buffer; if (!b) return;
      while (dl.timeRemaining() > 4 && b.frame < b.frames - 1 && this.checkpoints.size < MAX_CHECKPOINTS) {
        const next = Math.min(b.frames - 1, b.frame + 6);
        b.renderFrame(this.bufferCtx, next);
        if (next % CHECK_EVERY === 0 && !this.checkpoints.has(next)) this.checkpoints.set(next, b.snapshot!());
      }
      this.emit();
      if (b.frame < b.frames - 1 && this.checkpoints.size < MAX_CHECKPOINTS) this.idle = requestIdleCallback(work, { timeout: 200 });
    };
    this.idle = requestIdleCallback(work, { timeout: 200 });
  }

  seek(f: number) {
    f = Math.max(0, Math.min(this.frames - 1, Math.round(f)));
    const inst = this.inst, cur = inst.frame;
    if (!inst.seekable && !(f >= cur && f - cur <= CHECK_EVERY * 2)) {
      // jump: restore the nearest checkpoint at or before f (frame 0 is always stored)
      let best = -1; for (const k of this.checkpoints.keys()) if (k <= f && k > best) best = k;
      if (best >= 0 && (best > cur || f < cur)) inst.restore!(this.checkpoints.get(best));
    }
    const a = performance.now();
    this.inst.renderFrame(this.ctx, f);
    this.stats.drawMs = performance.now() - a;
    if (this.playing) this.restartClock();
    this.emit();
  }

  private audioKey() { return JSON.stringify([this.scene.meta.id, this.params]); }
  private async ensureAudio(): Promise<AudioBuffer | null> {
    if (!this.sound) return null;
    this.audioCtx ??= new AudioContext({ sampleRate: 44100 });
    const key = this.audioKey();
    if (this.audioCache?.key === key) return this.audioCache.buf;
    this.emit('preparing');
    await new Promise(r => setTimeout(r, 0));
    const mix = this.scene.audio(this.params);
    const buf = this.audioCtx.createBuffer(2, mix.L.length, mix.sr);
    buf.copyToChannel(mix.L as Float32Array<ArrayBuffer>, 0); buf.copyToChannel(mix.R as Float32Array<ArrayBuffer>, 1);
    this.audioCache = { key, buf };
    return buf;
  }

  private restartClock() {
    this.src?.stop(); this.src = null;
    const fps = this.scene.meta.fps;
    this.frame0 = this.frame;
    if (this.sound && this.audioCtx && this.audioCache?.key === this.audioKey()) {
      const src = this.audioCtx.createBufferSource(); src.buffer = this.audioCache.buf; src.connect(this.audioCtx.destination);
      const when = this.audioCtx.currentTime + 0.03; src.start(when, this.frame0 / fps); this.src = src;
      this.clock0 = when;
    } else this.clock0 = performance.now() / 1000;
  }
  private now() { return this.src && this.audioCtx ? this.audioCtx.currentTime : performance.now() / 1000; }

  async play() {
    if (this.playing) return;
    if (this.frame >= this.frames - 1) this.seek(0);
    this.playing = true;
    if (this.sound) { await this.ensureAudio(); if (this.audioCtx?.state === 'suspended') await this.audioCtx.resume(); }
    if (!this.playing) return;
    this.stats.dropped = 0;
    this.restartClock();
    const fps = this.scene.meta.fps;
    const tick = () => {
      if (!this.playing) return;
      const target = Math.min(this.frames - 1, this.frame0 + Math.floor(Math.max(0, this.now() - this.clock0) * fps));
      if (target > this.frame) {
        if (target > this.frame + 1) this.stats.dropped += target - this.frame - 1;
        const a = performance.now(); this.inst.renderFrame(this.ctx, target); this.stats.drawMs = performance.now() - a;
        this.autoQuality();
        if (!this.inst.seekable && target % CHECK_EVERY === 0 && !this.checkpoints.has(target) && this.checkpoints.size < MAX_CHECKPOINTS) this.checkpoints.set(target, this.inst.snapshot!());
        this.emit();
      }
      if (target >= this.frames - 1) { this.pause(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }

  pause() {
    this.playing = false; cancelAnimationFrame(this.raf);
    this.src?.stop(); this.src = null; this.emit();
  }

  /** Auto quality: if frames keep costing more than ~70 % of the 16.7 ms budget, drop one tier. */
  private autoQuality() {
    if (this.quality !== 'auto' || this.tier === 'low') return;
    this.emaMs = this.emaMs ? this.emaMs * 0.9 + this.stats.drawMs * 0.1 : this.stats.drawMs;
    this.slowFrames = this.emaMs > 11.5 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 45) { this.tier = 'low'; const at = this.frame; this.load(this.scene, this.params, true); if (at) this.seek(at); }
  }
  setQuality(q: Quality) { this.quality = q; this.tier = q === 'high' ? 'high' : q === 'low' ? 'low' : 'mid'; if (this.scene) this.load(this.scene, this.params, true); }
  /** stop all background work while the page is hidden (no wasted CPU, no heat) */
  setHidden(hidden: boolean) {
    if (hidden) { if (this.playing) this.pause(); cancelIdleCallback(this.idle); }
    else if (this.buffer) this.scheduleBuffering();
  }

  setSound(on: boolean) { this.sound = on; if (this.playing) { this.pause(); this.play(); } }
  diagnostics() { return this.inst?.diagnostics?.() ?? null; }

  private emit(audio?: PlayerStatus['audio']) {
    const buffered = this.buffer ? Math.max(0, ...this.checkpoints.keys()) : this.frames;
    this.onStatus({ frame: this.frame, frames: this.frames, playing: this.playing, buffered, drawMs: this.stats.drawMs, dropped: this.stats.dropped,
      audio: audio ?? (this.sound ? (this.src ? 'on' : 'off') : 'off'), tier: this.tier });
  }
}
