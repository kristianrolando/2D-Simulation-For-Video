// The pure part of the style editor: which tokens the form edits, how a form turns into a theme file, and the checks around
// it. Nothing here touches the disk or the DOM, so it runs in the studio, the server and the tests alike.
// A style made here is an ordinary themes/<id>.json file (plus "custom": true), so it renders, previews and gets
// thumbnails exactly like the shipped ones. The video engine, the scenes and the shipped styles are not touched.
import { resolveTheme, CLASSIC, type Theme } from './index.ts';

/** font stacks the editor offers. Every stack ends with a bundled font, so a render never falls back to a random system font. */
export const FONT_CHOICES: { id: string; label: string; family: string }[] = [
  { id: 'sans', label: 'Bold sans (bundled)', family: 'DejaVuSansBold' },
  { id: 'condensed', label: 'Condensed bold', family: '"Avenir Next Condensed", DejaVuSansCondensedBold' },
  { id: 'impact', label: 'Impact poster', family: 'Impact, DejaVuSansCondensedBold' },
  { id: 'rounded', label: 'Rounded', family: '"Arial Rounded MT Bold", DejaVuSansBold' },
  { id: 'mono', label: 'Monospace', family: 'Menlo, DejaVuSansMonoBold' },
  { id: 'serif', label: 'Serif bold', family: 'Georgia, DejaVuSerifBold' },
  { id: 'hand', label: 'Handwritten', family: 'Chalkduster, "Marker Felt", DejaVuSansBold' },
];

export const LINE_STYLES = ['neon', 'flat', 'misprint', 'sketch', 'technical', 'sticker', 'pixel'] as const;
export const BALL_STYLES = ['glossy', 'flat', 'misprint', 'chalk', 'pixel', 'sticker', 'ring'] as const;
export const TEXTURES = ['none', 'grain', 'grid', 'scanlines', 'chalk', 'halftone', 'sunburst'] as const;
export const SPARKS = ['glow', 'dot', 'square', 'confetti', 'dust', 'cross'] as const;

/** what the form edits (everything else is inherited from the style it started from) */
export interface StyleEdit {
  name: string; icon: string; concept: string;
  bg0: string; bg1: string; bgMode: 'linear' | 'radial';
  text: string; accent: string; muted: string; wall: string;
  /** ball / trail colours, 3 to 8 */
  palette: string[];
  font: string; fontCase: 'none' | 'upper' | 'lower'; fontAlign: 'center' | 'left';
  line: string; lineGlow: number; ball: string; texture: string; textureAmount: number; spark: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const lum = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
/** WCAG contrast ratio of two #rrggbb colours */
export function contrast(a: string, b: string): number { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');

/** an id for a file name: lower-case letters, digits, hyphens; 2 to 32 characters */
export function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32).replace(/-$/, '');
  return s.length >= 2 ? s : 'my-style';
}
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,31}$/.test(id);
export const fontIdOf = (family: string) => FONT_CHOICES.find(f => f.family === family)?.id ?? 'sans';

/** the form values that describe a theme (used to fill the form when a style is opened) */
export function readEdit(t: Theme): StyleEdit {
  const cyc = t.palettes.cyclic;
  return {
    name: t.name, icon: t.icon, concept: t.concept,
    bg0: t.color.bg[0], bg1: t.color.bg[t.color.bg.length - 1], bgMode: t.color.bgMode,
    text: t.color.text, accent: t.color.accent, muted: t.color.muted, wall: t.color.wall,
    palette: cyc.slice(0, 8),
    font: fontIdOf(t.font.family), fontCase: t.font.case, fontAlign: t.font.align,
    line: t.line.style, lineGlow: t.line.glow, ball: t.ball.style, texture: t.texture.kind, textureAmount: t.texture.amount, spark: t.spark,
  };
}

/** Builds the theme file: the base style (raw JSON file, or nothing for the built-in classic) with the form applied on top.
 *  The result is complete (every token present), so it no longer depends on the base. `id` must be valid. */
export function buildStyle(baseRaw: unknown, e: StyleEdit, id: string, basedOn: string): Record<string, unknown> {
  const base = resolveTheme(baseRaw ?? { id: CLASSIC.id }).theme;
  const t: any = JSON.parse(JSON.stringify(base)); delete t.background;
  const bg = base.color.bg, n = Math.max(2, bg.length);
  t.color.bg = Array.from({ length: n }, (_, i) => i === 0 ? e.bg0 : i === n - 1 ? e.bg1 : mix(e.bg0, e.bg1, i / (n - 1)));
  Object.assign(t.color, { bgMode: e.bgMode, text: e.text, accent: e.accent, muted: e.muted, wall: e.wall });
  t.palettes.cyclic = e.palette.slice(0, 8);
  const f = FONT_CHOICES.find(x => x.id === e.font) ?? FONT_CHOICES[0];
  Object.assign(t.font, { family: f.family, case: e.fontCase, align: e.fontAlign });
  Object.assign(t.line, { style: e.line, glow: e.lineGlow });
  t.ball.style = e.ball; Object.assign(t.texture, { kind: e.texture, amount: e.textureAmount }); t.spark = e.spark;
  // a light background cannot use additive light (it would wash out): switch the blend with the brightness class
  const dark = lum(e.bg0) < 0.2; if (dark !== base.dark) { t.blend = dark ? 'lighter' : 'source-over'; t.juice.blend = t.blend; }
  t.dark = dark;
  const out: Record<string, unknown> = { ...t, id, name: e.name.trim().slice(0, 40) || 'My style', icon: [...e.icon.trim()].slice(0, 2).join('') || '🎨', concept: e.concept.trim().slice(0, 200) || 'A style made in the studio.', bestFor: (base.id === CLASSIC.id ? '' : base.bestFor).slice(0, 200), custom: true, basedOn };
  const bgRaw = (baseRaw as any)?.background; if (bgRaw !== undefined) out.background = bgRaw;
  return out;
}

export interface StyleCheck { ok: boolean; errors: string[]; hints: string[] }
/** Is this form acceptable, and anything worth a word: low text contrast, a palette too close to the background. */
export function checkEdit(e: StyleEdit): StyleCheck {
  const errors: string[] = [], hints: string[] = [];
  if (!e.name.trim()) errors.push('Give the style a name.');
  for (const [k, v] of Object.entries({ background: e.bg0, 'background 2': e.bg1, text: e.text, accent: e.accent, muted: e.muted, wall: e.wall })) if (!HEX.test(v)) errors.push(`The ${k} colour is not a #rrggbb colour.`);
  if (e.palette.length < 3 || e.palette.length > 8 || e.palette.some(c => !HEX.test(c))) errors.push('The ball palette needs 3 to 8 colours.');
  if (errors.length) return { ok: false, errors, hints };
  const mid = mix(e.bg0, e.bg1, 0.5);
  const cText = contrast(e.text, mid), cAcc = contrast(e.accent, mid);
  if (cText < 4.5) hints.push(`The text colour is hard to read on this background (contrast ${cText.toFixed(1)}:1; 4.5:1 or more reads well in a Short).`);
  if (cAcc < 3) hints.push(`The accent colour is close to the background (contrast ${cAcc.toFixed(1)}:1), so numbers and answers may fade.`);
  const weak = e.palette.filter(c => contrast(c, mid) < 1.8).length;
  if (weak) hints.push(`${weak} ball colour${weak === 1 ? ' is' : 's are'} very close to the background and may disappear.`);
  return { ok: true, errors, hints };
}

/** what the server accepts as a custom style file: a complete theme with no warnings from the resolver and the editor's markers */
export function checkCustomFile(raw: unknown): { ok: true; raw: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'The style is not an object.' };
  const r = raw as Record<string, any>;
  if (!validId(r.id)) return { ok: false, error: 'The style id must be 2 to 32 letters, digits or hyphens.' };
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 40) return { ok: false, error: 'The name must be 1 to 40 characters.' };
  const { warnings } = resolveTheme(r);
  if (warnings.length) return { ok: false, error: `Invalid style: ${warnings[0]}` };
  return { ok: true, raw: { ...r, custom: true } };
}
