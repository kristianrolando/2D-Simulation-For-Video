// @sim/audio — procedural, deterministic SFX from simulation events.
// Oscillators use a two-term recurrence (y[n] = 2cos(w)·y[n-1] − y[n-2]) seeded with dmath, so the
// signal is bit-identical in every JS engine and ~10x cheaper than calling sin per sample.
import { dcos, dsin, dexp, mulberry32 } from '../core/index.ts';
import type { Mix } from '../core/scene.ts';
import type { AudioStyle } from '../theme/index.ts';

export const SR = 44100;

/** style: the theme's sound palette (themeOf(params).audio); omitted = classic, untouched */
export function createMix(seconds: number, style?: AudioStyle): Mix {
  const sr = SR, n = Math.ceil(seconds * sr);
  const m: Mix = { sr, L: new Float32Array(n), R: new Float32Array(n) };
  if (style) m.style = style;
  return m;
}
/** frequency/decay as shaped by the mix's style (transposition + decay scaling); identity without a style */
const LN2 = 0.6931471805599453;
function styled(mix: Mix, freq: number, decay: number): [number, number] {
  const s = mix.style; if (!s) return [freq, decay];
  return [s.pitch ? freq * dexp((s.pitch / 12) * LN2) : freq, decay * s.decay];
}

/** add a decaying sine partial: amp * exp(-t/decay) * sin(2π f t), with a short attack */
function partial(buf: Float64Array, sr: number, f: number, amp: number, decay: number, attack: number) {
  const w = (2 * Math.PI * f) / sr;
  const c2 = 2 * dcos(w);
  let y1 = 0, y2 = -dsin(w); // sin(0) and sin(-w)
  const k = dexp(-1 / (decay * sr)); let env = amp;
  const na = Math.max(1, Math.round(attack * sr));
  for (let i = 0; i < buf.length; i++) {
    const y0 = c2 * y1 - y2; y2 = y1; y1 = y0;
    const a = i < na ? i / na : 1;
    buf[i] += y2 * env * a; env *= k;
  }
}

function place(mix: Mix, t0: number, buf: Float64Array, gain: number, pan: number) {
  const i0 = Math.round(t0 * mix.sr);
  if (i0 >= mix.L.length) return;
  const n = Math.min(buf.length, mix.L.length - i0);
  const p = Math.max(-1, Math.min(1, pan));
  const gl = gain * Math.sqrt((1 - p) / 2), gr = gain * Math.sqrt((1 + p) / 2);
  for (let k = 0; k < n; k++) { mix.L[i0 + k] += buf[k] * gl; mix.R[i0 + k] += buf[k] * gr; }
}

/** short percussive "tock": pitched body + filtered noise click (bounces, collisions) */
export function tock(mix: Mix, t: number, { freq: f0 = 620, gain = 0.25, decay: d0 = 0.05, pan = 0, seed = 1 } = {}) {
  const [freq, decay] = styled(mix, f0, d0);
  const len = Math.ceil((decay * 7 + 0.01) * mix.sr);
  const buf = new Float64Array(len);
  partial(buf, mix.sr, freq, 0.8, decay, 0.0005);
  partial(buf, mix.sr, freq * 2.71, 0.25, decay * 0.4, 0.0005);
  const rnd = mulberry32(seed); let lp = 0; const kc = dexp(-1 / (0.0025 * mix.sr)); let e = 0.9;
  for (let i = 0; i < Math.min(len, mix.sr * 0.02); i++) { const n = rnd() * 2 - 1; lp += 0.5 * (n - lp); buf[i] += (n - lp) * e; e *= kc; }
  place(mix, t, buf, gain, pan);
}

/** bell / chime: inharmonic partials, long decay */
export function bell(mix: Mix, t: number, { freq: f0 = 880, gain = 0.2, decay: d0 = 1.2, pan = 0 } = {}) {
  const [freq, decay] = styled(mix, f0, d0);
  const buf = cachedVoice(`bell|${mix.sr}|${freq}|${decay}`, () => {
    const b = new Float64Array(Math.ceil(decay * 5 * mix.sr));
    for (const [m, g, d] of [[1, 1, 1], [2.0, 0.45, 0.7], [2.76, 0.3, 0.45], [5.4, 0.12, 0.25]]) partial(b, mix.sr, freq * m, g, decay * d, 0.004);
    return b;
  });
  place(mix, t, buf, gain, pan);
}

/** synthesised voices are pure functions of their parameters: render each distinct one once and reuse
 *  it (the pendulum scene plays 675 notes on 18 pitches -> 18 syntheses instead of 675) */
const voiceCache = new Map<string, Float64Array>();
function cachedVoice(key: string, make: () => Float64Array) {
  let b = voiceCache.get(key);
  if (!b) { b = make(); if (voiceCache.size > 256) voiceCache.clear(); voiceCache.set(key, b); }
  return b;
}

/** soft mallet / music-box note with harmonic partials */
export function pluck(mix: Mix, t: number, { freq: f0 = 440, gain = 0.12, decay: d0 = 1.6, pan = 0 } = {}) {
  const [freq, decay] = styled(mix, f0, d0);
  const buf = cachedVoice(`pluck|${mix.sr}|${freq}|${decay}`, () => {
    const b = new Float64Array(Math.ceil(decay * 4 * mix.sr));
    partial(b, mix.sr, freq, 1, decay, 0.006);
    partial(b, mix.sr, freq * 2, 0.35, decay * 0.5, 0.006);
    partial(b, mix.sr, freq * 3, 0.15, decay * 0.3, 0.006);
    return b;
  });
  place(mix, t, buf, gain, pan);
}

/** soft limiter + peak normalisation (final loudness is set by the renderer, EBU R128) */
export function master(mix: Mix, peak = 0.89): Mix {
  if (mix.style) applyFx(mix);
  // DC blocker (one-pole high-pass ~20 Hz): thousands of stacked one-shot samples can drift off zero
  const a = 1 - (2 * Math.PI * 20) / mix.sr;
  for (const ch of [mix.L, mix.R]) { let x1 = 0, y1 = 0; for (let i = 0; i < ch.length; i++) { const x = ch[i]; const y = x - x1 + a * y1; x1 = x; y1 = y; ch[i] = y; } }
  const k = 1 / Math.tanh(1.2);
  let m = 0;
  for (const ch of [mix.L, mix.R]) for (let i = 0; i < ch.length; i++) {
    const x = ch[i] * 1.2; const e = dexp(-2 * Math.abs(x)); const th = (1 - e) / (1 + e); // tanh, deterministic
    ch[i] = (x < 0 ? -th : th) * k; m = Math.max(m, Math.abs(ch[i]));
  }
  if (m > 0) { const g = peak / m; for (const ch of [mix.L, mix.R]) for (let i = 0; i < ch.length; i++) ch[i] *= g; }
  return mix;
}

const tanhD = (x: number) => { const e = dexp(-2 * Math.abs(x)), t = (1 - e) / (1 + e); return x < 0 ? -t : t; };

/** the style's effect chain, applied once to the finished mix (deterministic: dmath + IEEE ops only) */
function applyFx(mix: Mix) {
  const f = mix.style!.fx, sr = mix.sr, TWO_PI = 2 * Math.PI;
  const peakOf = () => { let m = 0; for (const ch of [mix.L, mix.R]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > m) m = a; } return m; };
  for (const ch of [mix.L, mix.R]) {
    if (f.highpass > 0) { const a = dexp((-TWO_PI * f.highpass) / sr); let x1 = 0, y = 0; for (let i = 0; i < ch.length; i++) { const x = ch[i]; y = a * (y + x - x1); x1 = x; ch[i] = y; } }
    if (f.lowpass > 0) { const b = 1 - dexp((-TWO_PI * f.lowpass) / sr); let y1 = 0, y2 = 0; for (let i = 0; i < ch.length; i++) { y1 += b * (ch[i] - y1); y2 += b * (y1 - y2); ch[i] = y2; } }
  }
  if (f.drive > 0 || f.crushBits > 0 || f.crushRate > 1) {
    const m = peakOf(), g = m > 0 ? 1 / m : 1, k = 1 + 4 * f.drive, nk = 1 / tanhD(k);
    const q = f.crushBits > 0 ? 2 ** (f.crushBits - 1) : 0, hold = Math.max(1, Math.round(f.crushRate));
    for (const ch of [mix.L, mix.R]) {
      let held = 0;
      for (let i = 0; i < ch.length; i++) {
        let x = ch[i] * g;
        if (f.drive > 0) x = tanhD(x * k) * nk;
        if (hold > 1) { if (i % hold === 0) held = x; x = held; }
        if (q) x = Math.round(x * q) / q;
        ch[i] = x;
      }
    }
  }
  if (f.echoMix > 0 && f.echoDelay > 0) {
    const d = Math.max(1, Math.round(f.echoDelay * sr)), bl = new Float32Array(d), br = new Float32Array(d), fb = Math.min(0.9, f.echoFeedback);
    for (let i = 0; i < mix.L.length; i++) {
      const j = i % d, dl = bl[j], dr = br[j], xl = mix.L[i], xr = mix.R[i];
      bl[j] = xl + fb * dr; br[j] = xr + fb * dl; // ping-pong
      mix.L[i] = xl + f.echoMix * dl; mix.R[i] = xr + f.echoMix * dr;
    }
  }
}

export function toWav(mix: Mix): Uint8Array {
  const n = mix.L.length, bytes = 44 + n * 4; const buf = new ArrayBuffer(bytes); const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, mix.sr, true); v.setUint32(28, mix.sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.round(Math.max(-1, Math.min(1, mix.L[i])) * 32767), true); o += 2;
    v.setInt16(o, Math.round(Math.max(-1, Math.min(1, mix.R[i])) * 32767), true); o += 2;
  }
  return new Uint8Array(buf);
}
