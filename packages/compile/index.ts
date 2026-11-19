// Long videos ("compilations"): several finished Shorts joined into one 16:9 video. This file is the pure core: the record, the
// timeline (frames → seconds → chapters), YouTube's chapter rules, and the cache fingerprint. No DOM, no fs, no ffmpeg: it is
// unit-tested in Node and also runs in the studio page.
//
// Time is counted in FRAMES (60 fps), never in guessed seconds: every clip is normalised to an exact number of frames and its audio
// to exactly frames × 735 samples (44 100 / 60), so the video, the audio and the chapter times cannot drift apart.

export const FPS = 60;
export const OUT_W = 1920, OUT_H = 1080;
export const SAMPLE_RATE = 44100;
export const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS; // 735, an integer on purpose
/** bump when the way a clip is normalised changes: old cache files then no longer match and are made again */
export const RECIPE = 1;
/** length of a long video the owner asked for (minutes) */
export const MIN_MIN = 9, MAX_MIN = 18, TARGET_MIN = 13;
/** YouTube: the first chapter starts at 0:00, at least three chapters, each at least 10 seconds */
export const CHAPTER_MIN_SEC = 10, CHAPTER_MIN_COUNT = 3;
export const COMPILE_SCHEMA = 1;
/** the id the Videos list gives these records as `sceneId` (it is not a scene, so the scene × style map ignores them) */
export const LONG_SCENE_ID = 'compilation';

export type CompileStatus = 'draft' | 'building' | 'built' | 'failed';
export interface ClipRef {
  videoId: string;
  /** MP4 file name inside output/ */
  file: string;
  /** short label of what makes this clip different (container, objects, ...): the chapter name */
  label: string;
  /** exact frame count of the finished 16:9 clip; the planned value (duration × 60) until the clip has been made */
  frames: number;
  sceneId: string;
}
export interface Compilation {
  id: string; slug: string;
  /** what the videos have in common, e.g. 'hammer-smash/split' */
  group: string; part: number; parts: number;
  title: string; titleIdeas: string[]; description: string; tags: string[]; hashtags: string[];
  /** the big words on the thumbnail */
  thumbText: string;
  seed: number; clips: ClipRef[];
  status: CompileStatus; jobId: string; error: string; note: string;
  /** the finished video (name inside output/) and the Videos-list record that tracks it */
  file: string; durationSec: number; sizeBytes: number; thumbFile: string; videoId: string; builtAt: string;
  recipe: number; createdAt: string; updatedAt: string;
}

// ---------------- timeline ----------------
export const framesOf = (durationSec: number) => Math.max(0, Math.round(durationSec * FPS));
export const totalFrames = (clips: Pick<ClipRef, 'frames'>[]) => clips.reduce((s, c) => s + c.frames, 0);
export const totalSeconds = (clips: Pick<ClipRef, 'frames'>[]) => totalFrames(clips) / FPS;
/** the second at which each clip starts (exact: a running sum of frames ÷ 60) */
export function startTimes(clips: Pick<ClipRef, 'frames'>[]): number[] {
  const out: number[] = []; let f = 0;
  for (const c of clips) { out.push(f / FPS); f += c.frames; }
  return out;
}
/** YouTube chapter time: m:ss, or h:mm:ss from one hour on. Whole seconds, rounded down (a chapter never starts before its clip). */
export function stamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec + 1e-9)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export const chapterName = (index: number, label: string) => `${index + 1}. ${label}`;
/** "0:00 1. Octagon with gems" … one line per clip, times from the real frame counts */
export function chapterLines(clips: Pick<ClipRef, 'frames' | 'label'>[]): string[] {
  const t = startTimes(clips);
  return clips.map((c, i) => `${stamp(t[i])} ${chapterName(i, c.label)}`);
}
/** the YouTube rules for a chapter list written in a description; [] = valid */
export function chapterProblems(description: string, durationSec: number): string[] {
  const rows = [...description.matchAll(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(\S.*)$/gm)].map(m => ({ sec: (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3], name: m[4].trim() }));
  const p: string[] = [];
  if (rows.length < CHAPTER_MIN_COUNT) p.push(`Chapters need at least ${CHAPTER_MIN_COUNT} timestamps (found ${rows.length}).`);
  if (rows.length && rows[0].sec !== 0) p.push('The first chapter must start at 0:00.');
  for (let i = 1; i < rows.length; i++) if (rows[i].sec <= rows[i - 1].sec) { p.push(`Chapter ${i + 1} does not come after chapter ${i}.`); break; }
  for (let i = 0; i < rows.length; i++) {
    const end = i + 1 < rows.length ? rows[i + 1].sec : durationSec;
    if (end - rows[i].sec < CHAPTER_MIN_SEC - 1e-6) { p.push(`Chapter ${i + 1} is shorter than ${CHAPTER_MIN_SEC} seconds.`); break; }
  }
  if (rows.length && rows[rows.length - 1].sec >= durationSec) p.push('The last chapter starts after the video ends.');
  return p;
}

// ---------------- cache fingerprint ----------------
/** FNV-1a, 8 hex digits: enough to tell "the same input" from "changed input" in a file name */
export function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** Name of a clip's cache file. Anything that changes the picture changes the name: the source file (size and mtime), the clip's
 *  position (its number is drawn on the first seconds), the label, how many clips there are, and the recipe version. */
export function clipCacheName(c: Pick<ClipRef, 'videoId' | 'label'>, source: { sizeBytes: number; mtimeMs: number }, position: number, count: number): string {
  const h = hash8(JSON.stringify([RECIPE, source.sizeBytes, Math.round(source.mtimeMs), position, count, c.label]));
  return `clip-${c.videoId}-${h}.mp4`;
}

// ---------------- the stored record ----------------
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const nat = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
const num = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
const fileName = (x: unknown) => { const s = typeof x === 'string' ? x.split('/').pop()!.split('\\').pop()! : ''; return /^[\w .,()+-]{1,200}$/.test(s) && !s.startsWith('.') ? s : ''; };
const idOf = (x: unknown) => (typeof x === 'string' && /^[\w.-]{3,120}$/.test(x) ? x : '');
const iso = (x: unknown, d = '') => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : d);
const list = (x: unknown, max: number, len: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').map(s => s.slice(0, len)).slice(0, max) : []);
const STATUS: CompileStatus[] = ['draft', 'building', 'built', 'failed'];

export function sanitizeClip(raw: unknown): ClipRef | null {
  if (!isObj(raw)) return null;
  const videoId = typeof raw.videoId === 'string' && /^[\w-]{3,80}$/.test(raw.videoId) ? raw.videoId : '', file = fileName(raw.file);
  if (!videoId || !file) return null;
  return { videoId, file, label: str(raw.label, 120) || file, frames: nat(raw.frames), sceneId: str(raw.sceneId, 80) };
}
/** a stored record → a valid Compilation, or null when it cannot be one. Bad fields fall back to safe defaults. */
export function sanitizeCompilation(raw: unknown, now: string = new Date().toISOString()): Compilation | null {
  if (!isObj(raw)) return null;
  const id = idOf(raw.id); if (!id) return null;
  const clips = (Array.isArray(raw.clips) ? raw.clips : []).map(sanitizeClip).filter((c): c is ClipRef => !!c);
  const created = iso(raw.createdAt, now);
  const status = STATUS.includes(raw.status as CompileStatus) ? (raw.status as CompileStatus) : 'draft';
  return {
    id, slug: str(raw.slug, 80).replace(/[^a-z0-9-]+/g, '-') || id,
    group: str(raw.group, 80), part: nat(raw.part) || 1, parts: nat(raw.parts) || 1,
    title: str(raw.title, 300), titleIdeas: list(raw.titleIdeas, 8, 300), description: str(raw.description, 10000), tags: list(raw.tags, 60, 100), hashtags: list(raw.hashtags, 10, 60),
    thumbText: str(raw.thumbText, 80), seed: Number.isFinite(Number(raw.seed)) ? Math.trunc(Number(raw.seed)) : 0, clips,
    // a build can never be "building" after a restart: the server turns it into failed/stopped before it serves anything
    status, jobId: idOf(raw.jobId), error: str(raw.error, 400), note: str(raw.note, 300),
    file: fileName(raw.file), durationSec: num(raw.durationSec), sizeBytes: nat(raw.sizeBytes), thumbFile: fileName(raw.thumbFile), videoId: idOf(raw.videoId), builtAt: iso(raw.builtAt),
    recipe: nat(raw.recipe), createdAt: created, updatedAt: iso(raw.updatedAt, created),
  };
}
export const newCompilationId = (now: Date = new Date()) => 'c-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
/** the file name of the finished MP4 (inside output/) */
export const outFileFor = (c: Pick<Compilation, 'slug' | 'id'>) => `long-${c.slug}.mp4`;
