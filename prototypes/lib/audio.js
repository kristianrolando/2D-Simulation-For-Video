// Procedural, deterministic SFX synthesis from simulation events.
// Pure JS on Float32Arrays: the same code can fill a WebAudio AudioBuffer in the
// browser (preview) or be written to WAV in Node (offline render).

import { mulberry32 } from './core.js';

export const SR = 44100;

export function createMix(seconds, sr = SR) {
  const n = Math.ceil(seconds * sr);
  return { sr, L: new Float32Array(n), R: new Float32Array(n) };
}

function addVoice(mix, t0, len, pan, fn) {
  const i0 = Math.round(t0 * mix.sr);
  const n = Math.min(Math.ceil(len * mix.sr), mix.L.length - i0);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let k = 0; k < n; k++) {
    const v = fn(k / mix.sr);
    mix.L[i0 + k] += v * gl;
    mix.R[i0 + k] += v * gr;
  }
}

/** Short percussive "tock": pitched body + noise transient (wall bounce / collision). */
export function tock(mix, t, { freq = 620, gain = 0.25, decay = 0.05, pan = 0, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  let lp = 0;
  addVoice(mix, t, decay * 7 + 0.01, pan, (s) => {
    const env = Math.exp(-s / decay);
    const body = Math.sin(2 * Math.PI * freq * s) * 0.8 + Math.sin(2 * Math.PI * freq * 2.71 * s) * 0.25 * Math.exp(-s / (decay * 0.4));
    const n = rnd() * 2 - 1; lp += 0.5 * (n - lp);
    const click = (n - lp) * Math.exp(-s / 0.0025) * 0.9;
    return gain * (body * env + click);
  });
}

/** Bell / chime: inharmonic partials with long decay. */
export function bell(mix, t, { freq = 880, gain = 0.2, decay = 1.2, pan = 0 } = {}) {
  const partials = [[1, 1, 1], [2.0, 0.45, 0.7], [2.76, 0.3, 0.45], [5.4, 0.12, 0.25]];
  addVoice(mix, t, decay * 5, pan, (s) => {
    const a = Math.min(1, s / 0.004);
    let v = 0;
    for (const [m, g, d] of partials) v += g * Math.exp(-s / (decay * d)) * Math.sin(2 * Math.PI * freq * m * s);
    return gain * a * v;
  });
}

/** Soft mallet / music-box note with harmonic partials (pendulum notes). */
export function pluck(mix, t, { freq = 440, gain = 0.12, decay = 1.6, pan = 0 } = {}) {
  addVoice(mix, t, decay * 4, pan, (s) => {
    const a = Math.min(1, s / 0.006);
    const v = Math.sin(2 * Math.PI * freq * s) + 0.35 * Math.sin(4 * Math.PI * freq * s) * Math.exp(-s / (decay * 0.5))
      + 0.15 * Math.sin(6 * Math.PI * freq * s) * Math.exp(-s / (decay * 0.3));
    return gain * a * Math.exp(-s / decay) * v;
  });
}

/** Soft limiter + normalise peak to `peak` (deterministic). */
export function master(mix, peak = 0.89) {
  let m = 0;
  for (const ch of [mix.L, mix.R]) for (let i = 0; i < ch.length; i++) { ch[i] = Math.tanh(ch[i] * 1.2) / Math.tanh(1.2); m = Math.max(m, Math.abs(ch[i])); }
  if (m > 0) { const k = peak / m; for (const ch of [mix.L, mix.R]) for (let i = 0; i < ch.length; i++) ch[i] *= k; }
  return mix;
}

/** 16-bit PCM WAV bytes. */
export function toWav(mix) {
  const n = mix.L.length, bytes = 44 + n * 4;
  const buf = new ArrayBuffer(bytes); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
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
