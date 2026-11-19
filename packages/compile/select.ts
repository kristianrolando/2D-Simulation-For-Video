// Which clips go into which long video, and in what order. Pure and deterministic: the same library and the same seed always give the
// same plan, so a plan can be checked, repeated and explained.
//   1. group      clips of one scene (and one rule/mode) belong together;
//   2. de-twin    clips that look the same (same visual key) count once;
//   3. split      a group longer than a long video is dealt into parts of about the same length, each part holding a spread of looks;
//   4. order      no two neighbours share their main look (container, objects, ...), so it does not feel like the same clip twice.
import { hash32, rng } from '../publish/copywriter.ts';
import { variantTag } from '../publish/describe.ts';
import { FPS, MIN_MIN, MAX_MIN, TARGET_MIN, framesOf, type ClipRef } from './index.ts';

export interface Candidate {
  videoId: string; file: string; sceneId: string; params: Record<string, unknown>; durationSec: number; createdAt: string;
  /** the scene's display name (for labels of scenes that have no variant tag) */
  sceneName?: string;
}
const s = (x: unknown) => String(x ?? '');

/** the rule or mode inside a scene that changes what the video is about ('' for scenes without one) */
export const modeOf = (c: Pick<Candidate, 'sceneId' | 'params'>) => (c.sceneId === 'hammer-smash' ? s(c.params.rule) : c.sceneId === 'sync-lines' ? s(c.params.mode) : '');
/** the group a clip belongs to: one long video theme (scene + mode), or 'mix' for the scenes that have only a few clips each */
export function groupOf(c: Pick<Candidate, 'sceneId' | 'params'>): string {
  const m = modeOf(c);
  return c.sceneId === 'hammer-smash' || c.sceneId === 'sync-lines' ? `${c.sceneId}/${m || 'default'}` : 'mix';
}

/** What a viewer can tell apart. Two clips with the same key look the same (only the seed or the length differs). */
export function visualKey(c: Pick<Candidate, 'sceneId' | 'params'>): string {
  const P = c.params, m = modeOf(c);
  if (c.sceneId === 'hammer-smash') return [c.sceneId, m, P.container, P.objects].map(s).join('/');
  if (c.sceneId === 'sync-lines') {
    if (m === 'lid') return [c.sceneId, m, P.container, P.objects, P.laps, P.motion, P.count, P.lapBase].map(s).join('/');
    if (m === 'close') return [c.sceneId, m, P.container, P.ratio].map(s).join('/');
    if (m === 'orbits') return [c.sceneId, m, P.container, P.objects, P.laps, P.direction, P.count, P.lapBase].map(s).join('/');
    return [c.sceneId, m, P.container, P.hidden].map(s).join('/');
  }
  const skip = new Set(['seed', 'title', 'answer', 'handle', 'bgSettings', 'stylePreset', 'duration', 'counter']);
  return c.sceneId + '/' + JSON.stringify(Object.entries(P).filter(([k]) => !skip.has(k) && !k.startsWith('juice')).sort());
}
/** Keeps the first clip (oldest) of every visual key; returns what was kept and what was dropped as a twin. */
export function dropTwins<T extends Candidate>(clips: T[]): { kept: T[]; twins: T[] } {
  const sorted = [...clips].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.videoId.localeCompare(b.videoId));
  const seen = new Set<string>(), kept: T[] = [], twins: T[] = [];
  for (const c of sorted) { const k = visualKey(c); if (seen.has(k)) twins.push(c); else { seen.add(k); kept.push(c); } }
  return { kept, twins };
}

// ---------------- chapter label ----------------
const RATIO_WORDS: Record<string, string> = { pi: 'π', sqrt2: '√2', golden: 'φ', e: 'e', seeded: 'random' };
const OBJECTS: Record<string, string> = { ball: 'balls', square: 'squares', triangle: 'triangles', gem: 'gems', star: 'stars', mixed: 'mixed shapes' };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** The chapter name: what makes this clip different from its neighbours, in a few true words. Read from the parameters only. */
export function labelFor(c: Candidate): string {
  const P = c.params;
  if (c.sceneId === 'hammer-smash') return `${cap(s(P.container))} with ${OBJECTS[s(P.objects)] ?? 'balls'}`;
  if (c.sceneId === 'sync-lines') {
    if (modeOf(c) === 'close') { const r = s(P.ratio); return `${cap(s(P.container))} frame, ratio ${RATIO_WORDS[r] ?? r}`; }
    return cap(variantTag(c.sceneId, P));
  }
  const name = c.sceneName ?? c.sceneId;
  if (c.sceneId === 'focal-reflection') return `${name}: ${s(P.layout)}`;
  if (c.sceneId === 'billiard') return `${name}: ${s(P.table)} table`;
  return name;
}
/** the two things two neighbouring clips should not share */
const lookOf = (c: Candidate): [string, string] => {
  const P = c.params, m = modeOf(c);
  if (c.sceneId === 'hammer-smash') return [s(P.container), s(P.objects)];
  if (c.sceneId === 'sync-lines') return [s(P.container), m === 'lid' ? s(P.motion) : m === 'close' ? s(P.ratio) : m === 'slider' ? s(P.hidden) : s(P.objects) + s(P.laps)];
  return [c.sceneId, labelFor(c)];
};

// ---------------- split into parts ----------------
/** how many long videos a group of `minutes` becomes: close to TARGET, never above MAX, never below MIN (when that is possible) */
export function partCount(minutes: number): number {
  if (minutes <= 0) return 0;
  const hi = Math.max(1, Math.floor(minutes / MIN_MIN)), lo = Math.max(1, Math.ceil(minutes / MAX_MIN));
  return Math.min(Math.max(Math.round(minutes / TARGET_MIN), lo), Math.max(hi, lo));
}
/** Deals the clips into `n` parts so every part holds a spread of looks and parts have similar length: the clips of each main look
 *  (container, ...) are dealt round robin, starting one part later for each next look, so no part gets always the same second look. */
export function splitParts<T extends Candidate>(clips: T[], n: number): T[][] {
  if (n <= 1) return [clips];
  const byLook = new Map<string, T[]>();
  for (const c of [...clips].sort((a, b) => lookOf(a).join('|').localeCompare(lookOf(b).join('|')) || a.videoId.localeCompare(b.videoId))) { const k = lookOf(c)[0]; if (!byLook.has(k)) byLook.set(k, []); byLook.get(k)!.push(c); }
  const parts: T[][] = Array.from({ length: n }, () => []); const len = new Array<number>(n).fill(0);
  [...byLook.values()].forEach((group, g) => group.forEach((c, j) => { const p = (j + g) % n; parts[p].push(c); len[p] += c.durationSec; }));
  // move clips from the longest part to the shortest while that makes the parts more even
  for (let guard = 0; guard < 200; guard++) {
    const hi = len.indexOf(Math.max(...len)), lo = len.indexOf(Math.min(...len)), gap = len[hi] - len[lo];
    const mv = parts[hi].filter(c => c.durationSec * 2 <= gap).sort((a, b) => b.durationSec - a.durationSec)[0];
    if (!mv) break;
    parts[hi].splice(parts[hi].indexOf(mv), 1); parts[lo].push(mv); len[hi] -= mv.durationSec; len[lo] += mv.durationSec;
  }
  return parts;
}

// ---------------- order ----------------
/** Seeded order in which neighbours differ: never the same container twice in a row, and (when it can be arranged) not the same second look either. */
export function orderClips<T extends Candidate>(clips: T[], seed: number): T[] {
  const r = rng(hash32(`order|${seed}`));
  const left = clips.map(c => ({ c, k: r() })).sort((a, b) => a.k - b.k || a.c.videoId.localeCompare(b.c.videoId)).map(x => x.c);
  const out: T[] = [];
  while (left.length) {
    const prev = out.length ? lookOf(out[out.length - 1]) : null;
    const i = (() => {
      if (!prev) return 0;
      let j = left.findIndex(c => { const l = lookOf(c); return l[0] !== prev[0] && l[1] !== prev[1]; }); if (j >= 0) return j;
      j = left.findIndex(c => lookOf(c)[0] !== prev[0]); return j >= 0 ? j : 0;
    })();
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

// ---------------- the plan ----------------
export interface PlanPart { group: string; part: number; parts: number; clips: Candidate[] }
export interface PlanResult { parts: PlanPart[]; twins: Candidate[]; totalClips: number }
/** The whole lineup: every candidate is used at most once. Groups with a single scene and mode come first, then the mix. */
export function planParts(cands: Candidate[], seed = 20261119): PlanResult {
  const groups = new Map<string, Candidate[]>();
  for (const c of cands) { const g = groupOf(c); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(c); }
  const parts: PlanPart[] = [], twins: Candidate[] = [];
  const names = [...groups.keys()].sort((a, b) => (a === 'mix' ? 1 : 0) - (b === 'mix' ? 1 : 0) || a.localeCompare(b));
  for (const g of names) {
    const { kept, twins: tw } = dropTwins(groups.get(g)!); twins.push(...tw);
    const minutes = kept.reduce((x, c) => x + c.durationSec, 0) / 60, n = partCount(minutes);
    if (!n) continue;
    splitParts(kept, n).forEach((p, i) => { if (p.length) parts.push({ group: g, part: i + 1, parts: n, clips: orderClips(p, hash32(`${g}|${i}|${seed}`)) }); });
  }
  return { parts, twins, totalClips: parts.reduce((x, p) => x + p.clips.length, 0) };
}
export const toClipRef = (c: Candidate): ClipRef => ({ videoId: c.videoId, file: c.file, label: labelFor(c), frames: framesOf(c.durationSec), sceneId: c.sceneId });
export const partMinutes = (clips: Pick<Candidate, 'durationSec'>[]) => clips.reduce((x, c) => x + c.durationSec, 0) / 60;
export { FPS };
