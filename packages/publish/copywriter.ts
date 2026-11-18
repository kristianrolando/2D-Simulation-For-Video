// Title, description, tag and hashtag writer for YouTube Shorts. Pure and deterministic: the same scene, parameters
// and style always give the same texts (a seeded choice among templates), and different videos get different ones.
// It never invents: every number comes from the video's own parameters (see `Facts`), every sentence from topics.ts.
import { LIMITS, parseTags, parseHashtags, tagsLength } from './index.ts';
import { TITLE_STYLES, TITLE_STYLE_LABEL, type Topic, type TitleStyle } from './topics.ts';

/** what the video's parameters say, in words and numbers. `vars` fill {placeholders}; `numbers` are the only numbers a title may use. */
export interface Facts { vars: Record<string, string>; numbers: number[] }
export interface CopyInput {
  sceneId: string; sceneName: string; sceneDescription: string; family: string;
  /** the question or hook shown on screen */
  hook: string;
  styleName: string; durationSec?: number;
  /** the scene's own seed (0 when it has none): part of what makes two videos of one scene differ */
  seed: number;
  topic: Topic; facts: Facts;
  /** 0 = the standard text; 1, 2, … = other description layouts and wordings for the same video (still deterministic) */
  variant?: number;
}
export interface TitleIdea { text: string; style: TitleStyle; label: string }
export interface Copy { title: string; titles: TitleIdea[]; description: string; tags: string[]; hashtags: string[] }

// ---------------- seeded choices ----------------
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32: a tiny seeded generator (same seed, same sequence, on every machine) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length) % list.length];

/** replace {name}; null when a placeholder has no value, so a text never shows a blank or a made-up number */
export function fill(text: string, vars: Record<string, string>): string | null {
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (_, k: string) => { const v = vars[k]; if (v === undefined) { missing = true; return ''; } return v; });
  return missing ? null : out.replace(/\s+/g, ' ').trim();
}
const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;
const HAS_EMOJI = /\p{Extended_Pictographic}/u;
export const stripEmoji = (s: string) => s.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
const sentence = (s: string) => (/[.?!…]$/.test(s) ? s : s + '.');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------- titles ----------------
/** Five differently styled titles: direct question, what is at stake, number first, curious statement, how/why explainer.
 *  Each is ≤ 100 characters, puts the hook first, contains the topic keyword, and uses only numbers from the video. */
export function writeTitles(i: CopyInput): TitleIdea[] {
  const r = rng(hash32(`${i.sceneId}|${i.seed}|${i.styleName}|titles`));
  const usable = (style: TitleStyle) => i.topic.titles[style].map(t => fill(t, i.facts.vars)).filter((t): t is string => !!t && t.length <= LIMITS.title && !/[<>]/.test(t));
  const out: TitleIdea[] = [], seen = new Set<string>();
  const add = (text: string, style: TitleStyle) => { const k = text.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ text, style, label: TITLE_STYLE_LABEL[style] }); return true; } return false; };
  for (const style of TITLE_STYLES) { const u = usable(style); if (u.length) add(pick(r, u), style); }
  // a style with nothing usable (a placeholder the video cannot fill) is replaced by an unused variant of another style
  for (const style of TITLE_STYLES) { if (out.length >= TITLE_STYLES.length) break; for (const t of usable(style)) { if (out.length >= TITLE_STYLES.length) break; add(t, style); } }
  // one or two get a single emoji, the way short titles often do; never the explainer
  const room = out.map((t, k) => ({ k, ok: t.style !== 'explain' && t.text.length + 2 <= LIMITS.title && !HAS_EMOJI.test(t.text) })).filter(x => x.ok);
  for (let n = 0; n < 2 && room.length; n++) { const [x] = room.splice(Math.floor(r() * room.length), 1); out[x.k] = { ...out[x.k], text: `${out[x.k].text} ${i.topic.emoji}` }; }
  return out;
}

// ---------------- description ----------------
const REAL = [
  'Everything on screen is a real 2D simulation with exact, repeatable maths: same settings, same result.',
  'Every frame comes from a physics simulation, not from hand-made animation.',
  'This is a deterministic simulation, so the same settings always give the same video.',
];
const ASK = [
  'What is your guess? Leave it in the comments before you watch the ending.',
  'Which part surprised you most? Tell me in the comments.',
  'Would you have guessed it? Let me know below.',
  'Want to see another setup? Suggest one in the comments.',
];
const CTA = [
  'New simulations every week. Subscribe if you like this kind of thing.',
  'More physics and math simulations are on the way. Subscribe to see them.',
  'If this was fun to watch, subscribe for the next one.',
  'Subscribe for a new simulation every week.',
];

/** The first line holds the hook (the chosen title) and the main keyword; the rest is a short explanation, a question for
 *  the comments and one calm subscribe line. Four layouts, chosen by seed, so videos do not all read the same. */
export function writeDescription(i: CopyInput, title: string): string {
  const r = rng(hash32(`${i.sceneId}|${i.seed}|${i.styleName}|desc|${title}|${i.variant ?? 0}`));
  const v = i.facts.vars, t = i.topic;
  const lead = fill(t.lead, v) ?? `A ${t.keyword} simulation.`;
  const mech = t.mechanic.map(m => fill(m, v)).filter((m): m is string => !!m);
  const setup = t.setup ? fill(t.setup, v) : null;
  const first = `${sentence(stripEmoji(title))} ${lead}`;
  const m1 = mech[0] ?? sentence(i.sceneDescription), m2 = mech[1] ?? '';
  const real = pick(r, REAL), ask = pick(r, ASK), cta = pick(r, CTA);
  const layouts: (string | null)[][] = [
    [first, '', [m1, m2].filter(Boolean).join(' '), '', real, '', ask, cta],
    [first, '', setup ? `The setup: ${setup}.` : null, m1, m2, '', ask, '', `${real} ${cta}`],
    [first, '', `What you are watching: ${m1}`, m2 ? `Keep an eye on this: ${m2}` : null, '', real, ask, '', cta],
    [first, '', m1, m2, '', `${ask} ${cta}`],
  ];
  const lines = layouts[Math.floor(r() * layouts.length) % layouts.length].filter((l): l is string => l !== null);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------- tags and hashtags ----------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
/** relevant tags first, most specific first; no duplicates (also not singular/plural twins); 500-character total with headroom */
export function writeTags(i: CopyInput): string[] {
  const base = [i.topic.keyword, ...i.topic.tags, i.sceneName.toLowerCase(), 'physics simulation', 'math visualization', 'science', i.styleName.toLowerCase()];
  const out: string[] = [], seen = new Set<string>();
  for (const t of parseTags(base)) {
    const k = norm(t); if (!k || seen.has(k)) continue;
    if (tagsLength([...out, t]) > LIMITS.tags - 40) break; // keep headroom under YouTube's 500-character total
    seen.add(k); out.push(t);
  }
  return out;
}
/** exactly three: #Shorts and the two topic hashtags (YouTube shows the first three above the title) */
export function writeHashtags(i: CopyInput): string[] {
  const list = parseHashtags(['#Shorts', ...i.topic.hash, '#simulation', '#science']);
  return list.slice(0, 3);
}

export function writeCopy(i: CopyInput): Copy {
  const titles = writeTitles(i);
  const first = titles.length ? titles[hash32(`${i.sceneId}|${i.seed}|${i.styleName}|pick`) % titles.length] : { text: i.hook || i.sceneName, style: 'question' as TitleStyle, label: '' };
  const title = first.text.slice(0, LIMITS.title);
  if (!titles.length) titles.push({ text: title, style: 'question', label: TITLE_STYLE_LABEL.question });
  return { title, titles, description: writeDescription(i, title), tags: writeTags(i), hashtags: writeHashtags(i) };
}

/** every number written in a text (digits only), e.g. "13 : 8 orbits" -> [13, 8] */
export const numbersIn = (s: string): number[] => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
export { tagsLength };
