// Sample bank + event-driven SFX. Samples come from the local library (assets/sfx/manifest.json),
// are decoded ONCE by the host (Node: from disk; browser: fetched once) and handed to setSampleBank.
// Scenes ask for a *role* ("tick", "bounce", ...) and never for a file: if the library has no sample
// for a role, a local synth fallback plays instead, so audio always renders.
import type { Mix } from '../core/scene.ts';
import { tock, bell, pluck } from './index.ts';
import { dexp, dsin, mulberry32 } from '../core/index.ts';

export interface SampleEntry {
  id: string; file: string; role: string; tags: string[]; duration: number;
  prompt: string; promptHash: string; source: 'elevenlabs' | 'synth' | 'other'; model?: string; created?: string;
}
export interface Manifest { version: 1; samples: SampleEntry[] }
export interface Sample { id: string; role: string; sr: number; data: Float32Array }

let bank = new Map<string, Sample[]>();     // role -> samples
export function setSampleBank(samples: Sample[]) {
  bank = new Map();
  for (const s of samples) { const l = bank.get(s.role) ?? []; l.push(s); bank.set(s.role, l); }
}
export function bankRoles() { return [...bank.keys()]; }

/** RIFF/WAVE PCM16 or float32 -> mono Float32 (deterministic, no WebAudio decode needed) */
export function parseWav(bytes: Uint8Array, id = '', role = ''): Sample {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file: ' + id);
  let o = 12, fmt = 1, ch = 1, sr = 44100, bits = 16, dataOff = -1, dataLen = 0;
  while (o + 8 <= v.byteLength) {
    const id4 = tag(o), len = v.getUint32(o + 4, true);
    if (id4 === 'fmt ') { fmt = v.getUint16(o + 8, true); ch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    else if (id4 === 'data') { dataOff = o + 8; dataLen = Math.min(len, v.byteLength - o - 8); break; }
    o += 8 + len + (len & 1);
  }
  if (dataOff < 0) throw new Error('WAV without data chunk: ' + id);
  const bps = bits / 8, n = Math.floor(dataLen / (bps * ch)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) {
      const p = dataOff + (i * ch + c) * bps;
      acc += fmt === 3 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : bits === 24 ? ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608) : (v.getUint8(p) - 128) / 128;
    }
    out[i] = acc / ch;
  }
  return { id, role, sr, data: out };
}

// ---------------- musical helpers ----------------
export const SCALES: Record<string, number[]> = {
  pentatonic: [0, 2, 4, 7, 9], major: [0, 2, 4, 5, 7, 9, 11], minorPenta: [0, 3, 5, 7, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  wholetone: [0, 2, 4, 6, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
};
/** move a semitone offset onto the nearest note of `scale` (keeps any fractional detune) */
export function snapToScale(p: number, scale: number[]) {
  const r = Math.round(p), frac = p - r, o = Math.floor(r / 12), d = r - o * 12;
  let best = scale[0], bd = 99;
  for (const s of [...scale, 12]) { const dd = Math.abs(s - d); if (dd < bd) { bd = dd; best = s; } }
  return o * 12 + best + frac;
}
/** semitone offset of scale degree `i` (wraps into octaves) */
export function scaleStep(i: number, scale = SCALES.pentatonic) {
  const n = scale.length, o = Math.floor(i / n), d = ((i % n) + n) % n;
  return o * 12 + scale[d];
}
/** stable pseudo-random in [0,1) from an integer (variation without storing state) */
export function hash01(n: number) { const r = mulberry32((n * 2654435761) >>> 0); r(); return r(); }

// ---------------- voice limiter ----------------
/** Cap simultaneous voices per role: hundreds of collisions in one frame become one louder hit. */
export class VoiceLimiter {
  private last = new Map<string, { t: number; n: number }>();
  private window: number; private perWindow: number;
  constructor(window = 0.012, perWindow = 3) { this.window = window; this.perWindow = perWindow; }
  /** returns gain multiplier to use, or 0 to skip this voice */
  admit(role: string, t: number): number {
    const l = this.last.get(role);
    if (!l || t - l.t > this.window) { this.last.set(role, { t, n: 1 }); return 1; }
    l.n++;
    return l.n <= this.perWindow ? 1 / Math.sqrt(l.n) : 0;
  }
}

// ---------------- playback ----------------
function place(mix: Mix, t0: number, s: Sample, gain: number, pitch: number, pan: number) {
  const rate = (s.sr / mix.sr) * dexp((pitch / 12) * 0.6931471805599453);
  const i0 = Math.round(t0 * mix.sr);
  if (i0 >= mix.L.length) return;
  const n = Math.min(Math.floor((s.data.length - 1) / rate), mix.L.length - i0);
  const p = Math.max(-1, Math.min(1, pan)), gl = gain * Math.sqrt((1 - p) / 2), gr = gain * Math.sqrt((1 + p) / 2);
  let pos = 0;
  for (let k = 0; k < n; k++) {
    const j = Math.floor(pos), f = pos - j, v = s.data[j] + (s.data[j + 1] - s.data[j]) * f;
    mix.L[i0 + k] += v * gl; mix.R[i0 + k] += v * gr; pos += rate;
  }
}

function noiseSweep(mix: Mix, t: number, gain: number, dur: number, seed: number, pan: number) {
  const rnd = mulberry32(seed), n = Math.ceil(dur * mix.sr), i0 = Math.round(t * mix.sr);
  let lp = 0;
  const p = Math.max(-1, Math.min(1, pan)), gl = gain * Math.sqrt((1 - p) / 2), gr = gain * Math.sqrt((1 + p) / 2);
  for (let k = 0; k < n && i0 + k < mix.L.length; k++) {
    const u = k / n, env = dsin(Math.PI * u) ** 2, a = 0.02 + 0.5 * u; // filter opens over the sweep
    lp += a * ((rnd() * 2 - 1) - lp);
    mix.L[i0 + k] += lp * env * gl; mix.R[i0 + k] += lp * env * gr;
  }
}
function thump(mix: Mix, t: number, gain: number, pan: number) {
  const n = Math.ceil(0.5 * mix.sr), i0 = Math.round(t * mix.sr);
  let ph = 0;
  for (let k = 0; k < n && i0 + k < mix.L.length; k++) {
    const s = k / mix.sr, f = 38 + 90 * dexp(-s * 18); ph += (2 * Math.PI * f) / mix.sr;
    const v = dsin(ph) * dexp(-s * 7) * gain; mix.L[i0 + k] += v; mix.R[i0 + k] += v;
  }
}

export interface SfxOpts { gain?: number; pitch?: number; pan?: number; seed?: number }

/** Play a role: a library sample if present (variation by seed), else the synth fallback. */
export function sfx(mix: Mix, t: number, role: string, o: SfxOpts = {}, limiter?: VoiceLimiter, doubled = false) {
  if (t < 0) return;
  const st = mix.style;
  let gain = o.gain ?? 0.3, pitch = o.pitch ?? 0; const pan = o.pan ?? 0, seed = o.seed ?? 1;
  if (st) {
    role = st.roleMap[role] ?? role;
    if (st.scale !== 'none' && SCALES[st.scale] && pitch !== 0) pitch = snapToScale(pitch, SCALES[st.scale]);
    // doubler: a second, slightly sharp and late copy (chorus-like "cartoon" thickness)
    if (st.fx.doubler > 0 && !doubled) sfx(mix, t + 0.011, role, { gain: gain * 0.6 * st.fx.doubler, pitch: pitch + 0.15, pan: -pan, seed: seed + 7 }, undefined, true);
  }
  if (limiter) { const k = limiter.admit(role, t); if (k === 0) return; gain *= k; }
  const list = bank.get(role);
  // samples are transposed here; synth voices apply the style's pitch/decay themselves (audio/index.ts)
  if (list && list.length) { place(mix, t, list[Math.floor(hash01(seed) * list.length)], gain, pitch + (st?.pitch ?? 0), pan); return; }
  const hz = (base: number) => base * dexp((pitch / 12) * 0.6931471805599453);
  switch (role) {
    case 'tick': tock(mix, t, { freq: hz(1400), gain: gain * 0.6, decay: 0.018, pan, seed }); break;
    case 'bounce': tock(mix, t, { freq: hz(560), gain, decay: 0.05, pan, seed }); break;
    case 'drop': tock(mix, t, { freq: hz(220), gain: gain * 1.2, decay: 0.08, pan, seed }); break;
    case 'ping': bell(mix, t, { freq: hz(1046.5), gain: gain * 0.6, decay: 0.6, pan }); break;
    case 'chime': bell(mix, t, { freq: hz(784), gain: gain * 0.6, decay: 1.2, pan }); break;
    case 'note': pluck(mix, t, { freq: hz(440), gain: gain * 0.6, decay: 1.4, pan }); break;
    case 'whoosh': noiseSweep(mix, t, gain * 0.5, 0.6, seed, pan); break;
    case 'boom': thump(mix, t, gain * 1.4, pan); break;
    case 'success': for (const m of [1, 1.25, 1.5, 2]) bell(mix, t, { freq: hz(392) * m, gain: gain * 0.4, decay: 2.2, pan }); break;
    case 'pop': pluck(mix, t, { freq: hz(880), gain: gain * 0.5, decay: 0.08, pan }); break;
    // roles added for the hammer / sync templates (library samples preferred, these are the fallbacks)
    case 'slam': thump(mix, t, gain * 0.9, pan); tock(mix, t, { freq: hz(180), gain: gain * 0.8, decay: 0.09, pan, seed }); break;
    case 'crush': noiseSweep(mix, t, gain * 0.7, 0.09, seed, pan); tock(mix, t, { freq: hz(900), gain: gain * 0.5, decay: 0.03, pan, seed }); break;
    case 'shatter': for (let k = 0; k < 6; k++) tock(mix, t + k * 0.023, { freq: hz(1800 + 400 * k), gain: gain * 0.35, decay: 0.05, pan: pan + (k % 2 ? 0.3 : -0.3), seed: seed + k }); noiseSweep(mix, t, gain * 0.6, 0.5, seed, pan); break;
    case 'rewind': noiseSweep(mix, t, gain * 0.8, 1.2, seed, pan); break;
    case 'clang': bell(mix, t, { freq: hz(523.25), gain: gain * 0.5, decay: 0.35, pan }); bell(mix, t, { freq: hz(1350), gain: gain * 0.25, decay: 0.2, pan }); break;
    default: tock(mix, t, { freq: hz(700), gain, decay: 0.04, pan, seed });
  }
}

/** the sound roles scenes may use (also the shopping list for the sample library) */
export const ROLES = ['tick', 'bounce', 'drop', 'ping', 'chime', 'note', 'whoosh', 'boom', 'success', 'pop', 'slam', 'crush', 'shatter', 'rewind', 'clang'] as const;
