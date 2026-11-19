// The operations on long videos that both the studio server (apps/server/compile-service.ts) and the command line (tools/compile.ts) use,
// so the studio and the terminal can never disagree: which clips may be used, how a record is made, how its texts and thumbnail are
// written, what happens when a build finishes, and how the Videos list tracks a long video. No HTTP and no job queue in here.
import fs from 'node:fs';
import path from 'node:path';
import { newId, sanitizeVideo, type Video } from '../../packages/publish/index.ts';
import { checkQuality } from '../../packages/publish/quality.ts';
import { topicFor, factsFor } from '../../packages/publish/describe.ts';
import { sceneById } from '../../packages/scenes/index.ts';
import { LONG_SCENE_ID, RECIPE, framesOf, newCompilationId, outFileFor, type ClipRef, type Compilation } from '../../packages/compile/index.ts';
import { planParts, toClipRef, groupOf, type Candidate, type PlanPart } from '../../packages/compile/select.ts';
import { writeLongTexts, writeLongDescription, checkLongTexts, type LongIssue } from '../../packages/compile/texts.ts';
import { makeLongThumb } from './compile-cover.ts';
import type { BuildReport, BuildRequest } from './compile-build.ts';

export interface Library { candidates: Candidate[]; /** how many Shorts exist and why the others are left out */ total: number; left: { videoId: string; file: string; why: string }[] }

/** The Shorts a long video may use: tracked in the list (rendered, scheduled or published), not a test, the MP4 is there, and the texts pass the
 *  publishing quality check. Scheduled and published Shorts are fine: a long video only reads their file and never changes their schedule. */
export function library(videos: Video[], outDir: string): Library {
  const left: Library['left'] = [], candidates: Candidate[] = [], shorts = videos.filter(v => v.kind !== 'long');
  for (const v of shorts) {
    const no = (why: string) => { left.push({ videoId: v.id, file: v.file, why }); };
    if (v.status === 'draft') { no('not rendered yet'); continue; }
    if (!v.file || /\//.test(v.file) || /test/i.test(v.file) || /test/i.test(v.id)) { no('test or nested file'); continue; }
    let size = 0; try { size = fs.statSync(path.join(outDir, v.file)).size; } catch { size = 0; }
    if (!size) { no('MP4 missing or empty'); continue; }
    if (!(v.durationSec > 0)) { no('no duration'); continue; }
    const q = checkQuality(v, { topic: topicFor(v.sceneId, v.params), facts: factsFor(v.sceneId, v.params), otherTitles: shorts.filter(x => x.id !== v.id).map(x => x.title) }).filter(i => i.severity !== 'info');
    if (q.length) { no(`the Short's texts fail the quality check (${q.map(i => i.code).join(', ')})`); continue; }
    candidates.push({ videoId: v.id, file: v.file, sceneId: v.sceneId, params: v.params, durationSec: v.durationSec, createdAt: v.createdAt, sceneName: sceneById(v.sceneId)?.meta.name });
  }
  return { candidates, total: shorts.length, left };
}

const slugOf = (group: string, part: number, parts: number) => {
  const base = group === 'mix' ? 'physics-simulations-mix' : group.replace(/\//g, '-');
  return parts > 1 ? `${base}-part-${part}` : base;
};
/** a new draft long video from one part of the plan; the texts are written right away */
export function newCompilation(part: PlanPart, existing: Compilation[], seed: number, now: Date = new Date()): Compilation {
  const clips = part.clips.map(toClipRef), taken = new Set(existing.map(c => c.slug));
  let slug = slugOf(part.group, part.part, part.parts), k = 2; while (taken.has(slug)) slug = `${slugOf(part.group, part.part, part.parts)}-${k++}`;
  const t = writeLongTexts({ group: part.group, part: part.part, parts: part.parts, clips, seed });
  return {
    id: newCompilationId(now), slug, group: part.group, part: part.part, parts: part.parts,
    title: t.title, titleIdeas: t.titles.map(x => x.text), description: t.description, tags: t.tags, hashtags: t.hashtags, thumbText: t.thumbText, seed, clips,
    status: 'draft', jobId: '', error: '', note: '', file: '', durationSec: 0, sizeBytes: 0, thumbFile: '', videoId: '', builtAt: '', recipe: RECIPE,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}
/** Write the texts again from the clips as they are now (the chapter list always follows the real clip lengths).
 *  `keepTitle` keeps the title that is there; `titleIndex` takes one of the five ideas instead. */
export function rewriteTexts(c: Compilation, opts: { keepTitle?: boolean; titleIndex?: number } = {}): Compilation {
  const input = { group: c.group, part: c.part, parts: c.parts, clips: c.clips, seed: c.seed }, t = writeLongTexts(input);
  const title = opts.titleIndex !== undefined && t.titles[opts.titleIndex] ? t.titles[opts.titleIndex].text : opts.keepTitle && c.title ? c.title : t.title;
  return { ...c, title, titleIdeas: t.titles.map(x => x.text), description: writeLongDescription(input, title), tags: t.tags, hashtags: t.hashtags, thumbText: c.thumbText || t.thumbText, updatedAt: new Date().toISOString() };
}
export const issuesOf = (c: Compilation): LongIssue[] => checkLongTexts({ group: c.group, title: c.title, description: c.description, tags: c.tags, hashtags: c.hashtags, clips: c.clips, part: c.part, parts: c.parts });

/** the request the build worker reads. `outDir` is output/, `cacheDir` is data/compilations/cache. */
export function buildRequest(c: Compilation, outDir: string, cacheDir: string): BuildRequest {
  return { compilationId: c.id, out: path.join(outDir, outFileFor(c)), cacheDir, clips: c.clips.map(k => ({ videoId: k.videoId, file: path.join(outDir, k.file), label: k.label })) };
}
/** disk space (GB) a build may need: the clip cache plus the finished video, about 0.9 MB per second each, and a little room */
export const needGB = (c: Compilation) => (c.clips.reduce((s, k) => s + k.frames, 0) / 60) * 0.9 * 2 / 1024 + 1.5;

/** a finished build: the exact frame counts replace the planned ones, the texts follow them, and the record says built */
export function applyReport(c: Compilation, r: BuildReport, now: Date = new Date()): Compilation {
  const clips: ClipRef[] = c.clips.map((k, i) => ({ ...k, frames: r.clipFrames[i] ?? k.frames }));
  const next: Compilation = { ...c, clips, status: 'built', error: '', note: `Checked: ${r.checks.join('; ')}.`, file: outFileFor(c), durationSec: r.durationSec, sizeBytes: r.sizeBytes, builtAt: now.toISOString(), recipe: RECIPE, updatedAt: now.toISOString() };
  // the chapters of the description must match the real clip lengths (they almost always do: the plan counts duration × 60 frames)
  return clips.some((k, i) => k.frames !== c.clips[i].frames) ? rewriteTexts(next, { keepTitle: true }) : next;
}

/** the thumbnail: four frames spread over the clips (each Short's own best frame), the number and the words. Returns the file name. */
export async function makeThumbnail(c: Compilation, videos: Video[], outDir: string, thumbDir: string): Promise<string> {
  const byId = new Map(videos.map(v => [v.id, v]));
  const clips = c.clips.map(k => { const v = byId.get(k.videoId); return { mp4: path.join(outDir, k.file), t: v?.thumbSec ?? Math.max(1, (k.frames / 60) * 0.8), params: v?.params ?? {} }; });
  const name = `${c.id}-long.jpg`;
  await makeLongThumb({ clips, number: c.clips.length, words: c.thumbText, outFile: path.join(thumbDir, name) });
  return name;
}

/** The Videos-list entry of a long video, created or refreshed from its record. The owner's own fields (status, dates, link, notes) are never overwritten. */
export function videoFor(c: Compilation, existing: Video | undefined, now: Date = new Date()): Video {
  const own = { title: c.title, description: c.description, tags: c.tags, hashtags: c.hashtags, file: c.file, durationSec: c.durationSec, sizeBytes: c.sizeBytes, thumbFile: c.thumbFile, kind: 'long' as const, compilationId: c.id };
  if (existing) return sanitizeVideo({ ...existing, ...own, updatedAt: now.toISOString() }, now.toISOString())!;
  return sanitizeVideo({ id: newId(now), ...own, notes: '', sceneId: LONG_SCENE_ID, style: 'classic', params: {}, status: 'rendered', jobId: '', thumbSec: null, coverFile: '', coverText: '', scheduledAt: '', publishedAt: '', youtubeUrl: '', createdAt: now.toISOString(), updatedAt: now.toISOString() }, now.toISOString())!;
}
export { planParts, groupOf, framesOf };
