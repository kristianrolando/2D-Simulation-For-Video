// @sim/theme — the look, presentation motion and sound palette of a video, as data (design tokens).
//
// A theme only changes how a simulation is *shown and heard*: colours, background texture, line and
// ball shapes, typography, presentation easing, juice profile and audio effects. It never touches
// simulation code (which stays dmath-only), so every style renders the exact same physics.
//
// Themes are plain JSON files in /themes (one file per style). Hosts register them once at start-up
// (Node: packages/theme/node.ts, studio: GET /api/themes). Every token falls back to CLASSIC when it is
// missing or invalid, so a partial or broken theme file can never crash a render.
import type { Params } from '../core/schema.ts';
import { EASE_NAMES, type EaseName } from '../core/ease.ts';
import { hexToRgb, mixRgb, rgbToHex, PALETTES, type RGB } from '../core/color.ts';

export type Blend = 'lighter' | 'multiply' | 'source-over' | 'screen';

/** A user-adjustable background setting declared by a style (drives an auto-generated studio control). */
export interface BgParam {
  type: 'number' | 'color' | 'enum';
  label: string; group: string; icon: string; default: number | string;
  min?: number; max?: number; step?: number; unit?: string; options?: string[];
  /** colours only: allowed relative luminance (0..1); keeps the look readable and on-identity */
  lumaMin?: number; lumaMax?: number;
  /** token path(s) this setting overrides, e.g. "color.bg.0", "texture.amount". "palettes.*" = tonal ramp. */
  target: string | string[];
}
export interface BgPreset { id: string; name: string; values: Record<string, number | string> }
export interface BgSpec { params: Record<string, BgParam>; presets: BgPreset[] }

export interface Theme {
  background: BgSpec;
  id: string; name: string; concept: string; bestFor: string; icon: string;
  /** dark background: additive light works; light themes use ink-like blending */
  dark: boolean;
  color: {
    bg: string[]; bgMode: 'linear' | 'radial';
    /** gradient direction (degrees, 0 = top→bottom) and focus point (0..1 of width/height) */
    bgAngle: number; bgCx: number; bgCy: number;
    text: string; accent: string; muted: string; handle: string; guide: string;
    wall: string; wallGlow: string; wall2: string; wall2Glow: string;
    focus: string; focusLit: string; ripple: string; highlight: string; flash: string;
    peg: string; pegHot: string; pegLit: string; pivot: string;
    sunHalo: string; sunCore: string; sunDisc: string; sunRing: string; planetA: string; planetB: string;
  };
  palettes: { cyclic: string[]; timeline: string[]; spectrum: string[]; sparks: string[] };
  texture: { kind: 'none' | 'grain' | 'grid' | 'scanlines' | 'chalk' | 'halftone' | 'sunburst'; color: string; amount: number; spacing: number; vignette: number };
  line: { style: 'neon' | 'flat' | 'misprint' | 'sketch' | 'technical' | 'sticker' | 'pixel'; width: number; glow: number };
  ball: { style: 'glossy' | 'flat' | 'misprint' | 'chalk' | 'pixel' | 'sticker' | 'ring'; outline: string };
  comet: { style: 'tail' | 'flat' | 'none'; alpha: number };
  /** particle / impact-marker shape */
  spark: 'glow' | 'dot' | 'square' | 'confetti' | 'dust' | 'cross';
  focus: 'ring' | 'square' | 'cross';
  /** how trails and light accumulate: 'lighter' (additive glow) on dark themes, ink blends on light ones */
  blend: Blend;
  trail: { alpha: number; width: number; haze: number };
  font: {
    family: string; weight: string; titleSize: number; counterSize: number; lineHeight: number;
    case: 'none' | 'upper' | 'lower'; align: 'center' | 'left';
    counterStyle: 'inline' | 'stack' | 'pill' | 'bracket' | 'tag';
    deco: 'none' | 'highlight' | 'underline' | 'prompt' | 'titleblock';
  };
  motion: {
    pop: EaseName; popAmount: number; roll: EaseName; rollTime: number;
    titleIn: 'none' | 'type' | 'slide' | 'drop' | 'wipe'; titleInDur: number;
    ripple: EaseName; shake: 'random' | 'horizontal' | 'none';
  };
  juice: { shake: number; flash: number; burst: number; squash: number; pop: number; energy: number;
    flashMode: 'add' | 'tint' | 'invert' | 'none'; flashColor: string; blend: Blend };
  audio: AudioStyle;
}

export interface AudioStyle {
  /** semitones added to every sound */
  pitch: number;
  /** quantise pitched events to this scale ('none' keeps the scene's own notes) */
  scale: string;
  /** multiplies synth decay times */
  decay: number;
  /** play a different role instead (e.g. tick -> pop) */
  roleMap: Record<string, string>;
  fx: { lowpass: number; highpass: number; drive: number; crushRate: number; crushBits: number;
    echoDelay: number; echoFeedback: number; echoMix: number; doubler: number };
}

/** The reference-like look the project started with. Also the fallback for every missing token. */
const CLASSIC_BG: BgSpec = {
  params: {
    top: { type: 'color', label: 'Top colour', group: 'Base colours', icon: '🎨', default: '#040822', lumaMax: 0.25, target: 'color.bg.0' },
    mid: { type: 'color', label: 'Middle colour', group: 'Base colours', icon: '🎨', default: '#010312', lumaMax: 0.25, target: 'color.bg.1' },
    bottom: { type: 'color', label: 'Bottom colour', group: 'Base colours', icon: '🎨', default: '#000005', lumaMax: 0.25, target: 'color.bg.2' },
    angle: { type: 'number', label: 'Gradient direction', group: 'Gradient', icon: '🧭', default: 0, min: -60, max: 60, step: 1, unit: '°', target: 'color.bgAngle' },
    pointX: { type: 'number', label: 'Gradient centre (x)', group: 'Gradient', icon: '🎯', default: 0.5, min: 0.2, max: 0.8, step: 0.01, target: 'color.bgCx' },
    pointY: { type: 'number', label: 'Gradient centre (y)', group: 'Gradient', icon: '🎯', default: 0.5, min: 0.2, max: 0.8, step: 0.01, target: 'color.bgCy' },
    wall: { type: 'color', label: 'Neon line colour', group: 'Neon glow', icon: '✨', default: '#9cf3ff', lumaMin: 0.3, target: 'color.wall' },
    glow: { type: 'color', label: 'Glow colour', group: 'Neon glow', icon: '✨', default: '#3fc9ff', lumaMin: 0.12, target: 'color.wallGlow' },
    glowAmount: { type: 'number', label: 'Glow intensity', group: 'Neon glow', icon: '💡', default: 1, min: 0, max: 1.6, step: 0.05, target: 'line.glow' },
    grid: { type: 'enum', label: 'Backdrop grid', group: 'Grid', icon: '▦', default: 'none', options: ['none', 'grid'], target: 'texture.kind' },
    gridSpacing: { type: 'number', label: 'Grid density (spacing)', group: 'Grid', icon: '▦', default: 36, min: 16, max: 90, step: 1, unit: 'px', target: 'texture.spacing' },
    gridAmount: { type: 'number', label: 'Grid strength', group: 'Grid', icon: '▦', default: 0.18, min: 0.04, max: 0.5, step: 0.01, target: 'texture.amount' },
    gridColor: { type: 'color', label: 'Grid colour', group: 'Grid', icon: '▦', default: '#4f8dff', lumaMin: 0.1, target: 'texture.color' },
    vignette: { type: 'number', label: 'Edge darkening', group: 'Gradient', icon: '◐', default: 0, min: 0, max: 0.6, step: 0.01, target: 'texture.vignette' },
  },
  presets: [
    { id: 'navy', name: 'Deep navy', values: {} },
    { id: 'violet', name: 'Midnight violet', values: { top: '#12062e', mid: '#0a0320', bottom: '#030010', wall: '#e0b8ff', glow: '#9b4dff', gridColor: '#9b6bff' } },
    { id: 'ocean', name: 'Ocean', values: { top: '#031c2e', mid: '#02111e', bottom: '#000509', wall: '#9cffe8', glow: '#18d6b4', grid: 'grid', gridColor: '#38e1e6', gridAmount: 0.14 } },
    { id: 'ember', name: 'Ember', values: { top: '#2a0a06', mid: '#150403', bottom: '#050100', wall: '#ffd6a0', glow: '#ff7a1a', angle: 20, gridColor: '#ff8a3d' } },
    { id: 'graphite', name: 'Graphite grid', values: { top: '#1c1f26', mid: '#101217', bottom: '#050608', wall: '#e8eefc', glow: '#7f93c8', glowAmount: 0.6, grid: 'grid', gridColor: '#8b95ad', gridSpacing: 48 } },
  ],
};

export const CLASSIC: Theme = {
  background: CLASSIC_BG,
  id: 'classic', name: 'Classic Neon', icon: '✨',
  concept: 'The original look: neon lines and glowing balls on a navy-black gradient (close to the reference videos).',
  bestFor: 'Matching the original prototypes; not recommended when you want your own identity.',
  dark: true,
  color: {
    bg: ['#040822', '#010312', '#000005'], bgMode: 'linear', bgAngle: 0, bgCx: 0.5, bgCy: 0.5,
    text: '#eef2ff', accent: '#ffd23f', muted: '#c8d2eb', handle: '#7887a5', guide: '#96aad2',
    wall: '#9cf3ff', wallGlow: '#3fc9ff', wall2: '#ffd23f', wall2Glow: '#ff9a3d',
    focus: '#8e823c', focusLit: '#ffd864', ripple: '#ffd864', highlight: '#ffffff', flash: '#ffffff',
    peg: '#96d7f0', pegHot: '#ffc896', pegLit: '#ffffe6', pivot: '#a0e6ff',
    sunHalo: '#ff9628', sunCore: '#ffffeb', sunDisc: '#fff6dc', sunRing: '#ffaa3c', planetA: '#ffd68c', planetB: '#6eb4ff',
  },
  palettes: {
    cyclic: ['#38e1e6', '#4f8dff', '#9b6bff', '#e86cf0', '#ff6f9a', '#ff8a3d', '#ffd23f', '#9be36b'],
    timeline: ['#38e1e6', '#4f8dff', '#9b6bff', '#e86cf0', '#ff7a8a', '#ff9a3d', '#ffd23f', '#b6e36b'],
    spectrum: ['#9be36b', '#ffd23f', '#ff9a3d', '#ff6f6f', '#ff6fb5', '#e86cf0', '#9b6bff', '#4f8dff', '#38e1e6'],
    sparks: ['#ffffff', '#ffd23f', '#9cf3ff'],
  },
  texture: { kind: 'none', color: '#4f8dff', amount: 0.18, spacing: 36, vignette: 0 },
  line: { style: 'neon', width: 1, glow: 1 },
  ball: { style: 'glossy', outline: '#ffffff' },
  comet: { style: 'tail', alpha: 1 },
  spark: 'glow',
  focus: 'ring',
  blend: 'lighter',
  trail: { alpha: 1, width: 1, haze: 1 },
  font: { family: 'DejaVuSansBold', weight: '', titleSize: 58, counterSize: 55, lineHeight: 1.18, case: 'none', align: 'center', counterStyle: 'inline', deco: 'none' },
  motion: { pop: 'outBack', popAmount: 1, roll: 'outCubic', rollTime: 0.35, titleIn: 'none', titleInDur: 0.6, ripple: 'outQuad', shake: 'random' },
  juice: { shake: 1, flash: 1, burst: 1, squash: 1, pop: 1, energy: 1, flashMode: 'add', flashColor: 'event', blend: 'lighter' },
  audio: { pitch: 0, scale: 'none', decay: 1, roleMap: {},
    fx: { lowpass: 0, highpass: 0, drive: 0, crushRate: 1, crushBits: 0, echoDelay: 0, echoFeedback: 0, echoMix: 0, doubler: 0 } },
};

// ---------------- validation + fallback ----------------

const BLENDS = ['lighter', 'multiply', 'source-over', 'screen'];
/** allowed values of every enum token, by dotted path */
const ENUMS: Record<string, readonly string[]> = {
  'color.bgMode': ['linear', 'radial'],
  'texture.kind': ['none', 'grain', 'grid', 'scanlines', 'chalk', 'halftone', 'sunburst'],
  'line.style': ['neon', 'flat', 'misprint', 'sketch', 'technical', 'sticker', 'pixel'],
  'ball.style': ['glossy', 'flat', 'misprint', 'chalk', 'pixel', 'sticker', 'ring'],
  'comet.style': ['tail', 'flat', 'none'],
  spark: ['glow', 'dot', 'square', 'confetti', 'dust', 'cross'],
  focus: ['ring', 'square', 'cross'],
  blend: BLENDS, 'juice.blend': BLENDS,
  'font.case': ['none', 'upper', 'lower'], 'font.align': ['center', 'left'],
  'font.counterStyle': ['inline', 'stack', 'pill', 'bracket', 'tag'],
  'font.deco': ['none', 'highlight', 'underline', 'prompt', 'titleblock'],
  'motion.pop': EASE_NAMES, 'motion.roll': EASE_NAMES, 'motion.ripple': EASE_NAMES,
  'motion.titleIn': ['none', 'type', 'slide', 'drop', 'wipe'], 'motion.shake': ['random', 'horizontal', 'none'],
  'juice.flashMode': ['add', 'tint', 'invert', 'none'],
  'audio.scale': ['none', 'pentatonic', 'major', 'minorPenta', 'lydian', 'wholetone', 'dorian'],
};
/** free-text tokens (no colour check) */
const TEXT = new Set(['id', 'name', 'concept', 'bestFor', 'icon', 'font.family', 'font.weight']);
const HEX = /^#[0-9a-f]{6}$/i;
const isColor = (v: unknown) => typeof v === 'string' && HEX.test(v);

export interface Resolved { theme: Theme; warnings: string[] }

/** Merge a (possibly partial or broken) theme over CLASSIC. Every invalid or missing token falls back. */
export function resolveTheme(input: unknown): Resolved {
  const warnings: string[] = [];
  const walk = (base: any, src: any, path: string): any => {
    if (Array.isArray(base)) {
      if (src === undefined) return base.slice();
      if (Array.isArray(src) && src.length > 0 && src.every(isColor)) return src.slice();
      warnings.push(`${path}: expected a non-empty list of #rrggbb colours`); return base.slice();
    }
    if (base && typeof base === 'object') {
      const out: any = {};
      if (src !== undefined && (typeof src !== 'object' || src === null || Array.isArray(src))) { warnings.push(`${path || 'theme'}: expected an object`); src = undefined; }
      if (path === 'audio.roleMap') {
        const m: Record<string, string> = {};
        for (const [k, v] of Object.entries(src ?? {})) { if (typeof v === 'string') m[k] = v; else warnings.push(`${path}.${k}: expected a role name`); }
        return m;
      }
      for (const k of Object.keys(base)) { if (!path && k === 'background') continue; out[k] = walk(base[k], src?.[k], path ? `${path}.${k}` : k); }
      return out;
    }
    if (src === undefined) return base;
    const ok = ENUMS[path] ? ENUMS[path].includes(src)
      : typeof base === 'number' ? typeof src === 'number' && Number.isFinite(src)
      : typeof base === 'boolean' ? typeof src === 'boolean'
      : TEXT.has(path) ? typeof src === 'string'
      : path === 'juice.flashColor' ? src === 'event' || isColor(src)
      : isColor(src);
    if (!ok) { warnings.push(`${path}: invalid value ${JSON.stringify(src)} (using ${JSON.stringify(base)})`); return base; }
    return src;
  };
  const theme = walk(CLASSIC, input, '') as Theme;
  theme.background = parseBackground(theme, (input as any)?.background, warnings);
  if (theme.id === CLASSIC.id && (input as any)?.id !== CLASSIC.id) warnings.push('id: missing (theme cannot be registered)');
  return { theme, warnings };
}

// ---------------- background settings (per-style, user adjustable) ----------------

const lumaOf = (hex: string) => { const [r, g, b] = hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
/** colour pulled toward `fallback` until its luminance is inside [lo, hi] */
function clampLuma(hex: string, fallback: string, lo = 0, hi = 1) {
  if (lumaOf(hex) >= lo && lumaOf(hex) <= hi) return hex;
  const a = hexToRgb(hex), b = hexToRgb(fallback);
  for (let t = 0.1; t < 1.001; t += 0.1) { const h = rgbToHex(mixRgb(a, b, t)); if (lumaOf(h) >= lo && lumaOf(h) <= hi) return h; }
  return fallback;
}
function pathExists(T: any, path: string) {
  if (path === 'palettes.*') return true;
  let o = T; for (const k of path.split('.')) { if (o == null || typeof o !== 'object' || !(k in o)) return false; o = o[k]; }
  return o !== undefined;
}

/** coerce one raw value to a valid value of the param, or undefined if it is invalid */
function coerce(d: BgParam, v: unknown): number | string | undefined {
  if (d.type === 'number') { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? Math.min(d.max!, Math.max(d.min!, n)) : undefined; }
  if (d.type === 'enum') return typeof v === 'string' && d.options!.includes(v) ? v : undefined;
  return isColor(v) ? clampLuma((v as string).toLowerCase(), d.default as string, d.lumaMin, d.lumaMax) : undefined;
}

/** validate a style's declared background spec; invalid params/presets are dropped with a warning */
export function parseBackground(T: Theme, src: unknown, warnings: string[] = []): BgSpec {
  const out: BgSpec = { params: {}, presets: [] };
  if (src === undefined) return out;
  const o = src as any;
  if (!o || typeof o !== 'object' || typeof o.params !== 'object' || o.params === null) { warnings.push('background: expected { params, presets }'); return out; }
  for (const [k, d] of Object.entries<any>(o.params)) {
    const w = (m: string) => warnings.push(`background.params.${k}: ${m} (parameter dropped)`);
    if (!d || typeof d !== 'object') { w('expected an object'); continue; }
    if (!['number', 'color', 'enum'].includes(d.type)) { w('type must be number, color or enum'); continue; }
    const targets = Array.isArray(d.target) ? d.target : [d.target];
    if (!targets.length || !targets.every((t: unknown) => typeof t === 'string' && pathExists(T, t))) { w('target must name existing theme tokens'); continue; }
    const p: BgParam = { type: d.type, label: typeof d.label === 'string' ? d.label : k, group: typeof d.group === 'string' ? d.group : 'Background',
      icon: typeof d.icon === 'string' ? d.icon : '🎨', default: d.default, target: d.target };
    if (d.type === 'number') {
      if (![d.min, d.max, d.default].every(Number.isFinite) || d.min >= d.max || d.default < d.min || d.default > d.max) { w('needs finite min < max and a default inside them'); continue; }
      Object.assign(p, { min: d.min, max: d.max, step: Number.isFinite(d.step) && d.step > 0 ? d.step : (d.max - d.min) / 100, unit: typeof d.unit === 'string' ? d.unit : undefined });
    } else if (d.type === 'enum') {
      if (!Array.isArray(d.options) || !d.options.length || !d.options.every((x: unknown) => typeof x === 'string') || !d.options.includes(d.default)) { w('needs string options containing the default'); continue; }
      p.options = d.options.slice();
    } else {
      if (!isColor(d.default)) { w('default must be #rrggbb'); continue; }
      if (Number.isFinite(d.lumaMin)) p.lumaMin = d.lumaMin; if (Number.isFinite(d.lumaMax)) p.lumaMax = d.lumaMax;
    }
    out.params[k] = p;
  }
  for (const pr of Array.isArray(o.presets) ? o.presets : []) {
    if (!pr || typeof pr.id !== 'string' || typeof pr.name !== 'string' || typeof pr.values !== 'object' || pr.values === null) { warnings.push('background.presets: entry needs id, name and values (dropped)'); continue; }
    const values: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(pr.values)) {
      const d = out.params[k]; const c = d ? coerce(d, v) : undefined;
      if (c === undefined) warnings.push(`background.presets.${pr.id}.${k}: unknown parameter or invalid value (ignored)`); else values[k] = c;
    }
    out.presets.push({ id: pr.id, name: pr.name, values });
  }
  return out;
}

export interface BgValues { values: Record<string, number | string>; warnings: string[] }
/** Full set of values for a style from stored/raw settings (JSON string or object). Anything missing,
 *  unknown, out of range or invalid falls back to the default (or is clamped); never throws. */
export function sanitizeBackground(T: Theme, raw: unknown): BgValues {
  const warnings: string[] = []; let obj: any = {};
  if (typeof raw === 'string') { if (raw.trim()) { try { obj = JSON.parse(raw); } catch { warnings.push('background settings are not valid JSON (defaults used)'); } } }
  else if (raw && typeof raw === 'object') obj = raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { warnings.push('background settings: expected an object (defaults used)'); obj = {}; }
  const values: Record<string, number | string> = {};
  for (const [k, d] of Object.entries(T.background.params)) {
    const c = k in obj ? coerce(d, obj[k]) : undefined;
    if (k in obj && c === undefined) warnings.push(`${k}: invalid value ${JSON.stringify(obj[k])} (default used)`);
    values[k] = c ?? d.default;
  }
  for (const k of Object.keys(obj)) if (!(k in T.background.params)) warnings.push(`${k}: unknown background setting (ignored)`);
  return { values, warnings };
}
/** compact JSON of only the values that differ from the defaults ('' when none): what the scene param stores */
export function serializeBackground(T: Theme, values: Record<string, number | string>): string {
  const diff: Record<string, number | string> = {};
  for (const [k, d] of Object.entries(T.background.params)) if (values[k] !== undefined && values[k] !== d.default) diff[k] = values[k];
  return Object.keys(diff).length ? JSON.stringify(diff) : '';
}

function setPath(T: any, path: string, v: number | string) {
  if (path === 'palettes.*') {
    const c = hexToRgb(String(v)), ramp = Array.from({ length: 5 }, (_, i) => { const f = i / 4; return rgbToHex(f < 0.5 ? mixRgb(c, [0, 0, 0], (0.5 - f) * 0.7) : mixRgb(c, [255, 255, 255], (f - 0.5) * 0.9)); });
    T.palettes.cyclic = ramp.slice(); T.palettes.timeline = ramp.slice(); T.palettes.spectrum = ramp.slice(); T.palettes.sparks = ['#ffffff', String(v)];
    return;
  }
  const ks = path.split('.'); let o = T; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v;
}

const applied = new Map<string, Theme>();
/** The theme with the user's background settings applied. Cached per (style, settings), so scenes get the
 *  same object every time and nothing is rebuilt per frame. No settings (or all defaults) = the theme itself. */
export function applyBackground(T: Theme, raw: unknown): Theme {
  if (raw === undefined || raw === '' || raw === '{}' || !Object.keys(T.background.params).length) return T;
  const key = T.id + '|' + (typeof raw === 'string' ? raw : JSON.stringify(raw));
  const hit = applied.get(key); if (hit) return hit;
  const { values } = sanitizeBackground(T, raw);
  let out = T;
  for (const [k, d] of Object.entries(T.background.params)) {
    if (values[k] === d.default) continue; // untouched settings keep the theme's own tokens exactly
    if (out === T) out = structuredClone(T);
    for (const t of Array.isArray(d.target) ? d.target : [d.target]) setPath(out, t, values[k]);
  }
  if (applied.size > 64) applied.clear();
  applied.set(key, out); return out;
}

// ---------------- registry ----------------

const registry = new Map<string, Theme>([[CLASSIC.id, CLASSIC]]);

/** register theme definitions (raw JSON); returns the warnings of every theme */
export function registerThemes(list: unknown[]): Record<string, string[]> {
  const report: Record<string, string[]> = {};
  for (const raw of list) {
    const { theme, warnings } = resolveTheme(raw);
    const id = (raw as any)?.id;
    if (typeof id !== 'string' || !id) { report['?'] = [...(report['?'] ?? []), 'theme without id skipped']; continue; }
    if (id === CLASSIC.id) { report[id] = ['classic is built in and cannot be replaced']; continue; }
    registry.set(id, theme); report[id] = warnings;
  }
  return report;
}
export function themeIds(): string[] { return [...registry.keys()]; }
export function allThemes(): Theme[] { return [...registry.values()]; }
/** theme by id; unknown ids fall back to CLASSIC (never throws) */
export function getTheme(id: string | undefined | null): Theme { return (id && registry.get(id)) || CLASSIC; }
/** the theme a scene instance should use: params.style (see commonSchema) */
export function themeOf(P: Params): Theme { return applyBackground(getTheme(String(P.style ?? CLASSIC.id)), P.bgSettings); }

// ---------------- helpers for scenes ----------------

export const rgbOf = (hex: string): RGB => hexToRgb(hex);
/** "r,g,b" for rgba() templates */
export const rgbStr = (hex: string) => hexToRgb(hex).join(',');
export const rgbaOf = (hex: string, a: number) => `rgba(${rgbStr(hex)},${a})`;

/** palette choices offered by every scene: 'theme' = the style's own colours */
export const PALETTE_OPTIONS = ['theme', ...Object.keys(PALETTES)];
/** colours for a scene role. A named palette (user override) is kept as is on dark themes and turned
 *  into an ink version (pulled toward the text colour) on light ones, so it stays readable. */
export function paletteFor(T: Theme, choice: unknown, role: 'cyclic' | 'timeline' | 'spectrum'): string[] {
  const named = typeof choice === 'string' ? PALETTES[choice] : undefined;
  if (!named) return T.palettes[role];
  if (T.dark) return named;
  const ink = hexToRgb(T.color.text);
  return named.map(h => rgbToHex(mixRgb(hexToRgb(h), ink, 0.35)));
}
/** a scene-specific classic colour (kept bit-exact for the classic look) or the theme token otherwise */
export function classicOr<V>(T: Theme, classic: V, themed: V): V { return T.id === CLASSIC.id ? classic : themed; }
