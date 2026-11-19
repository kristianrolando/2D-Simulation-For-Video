// Video tracking and YouTube metadata. Pure data logic (no DOM, no fs), shared by the server (storage)
// and the studio (editing), and unit-tested in Node. Nothing here talks to YouTube.

import { writeCopy } from './copywriter.ts';
import { genericTopic, type Topic } from './topics.ts';
import type { Facts, TitleIdea } from './copywriter.ts';

export const SCHEMA_VERSION = 1;
/** the channel every video belonged to before channels were recorded; also the fallback when no YouTube channel is connected */
export const DEFAULT_CHANNEL = 'Photon Lab';
export const STATUSES = ['draft', 'rendered', 'scheduled', 'published'] as const;
export type Status = typeof STATUSES[number];
export const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', rendered: 'Rendered', scheduled: 'Scheduled', published: 'Published' };

/** YouTube limits, checked against the official pages on 2026-11-18 (see docs/report.md §11.4):
 *  title 100 characters; description 5000 BYTES (UTF-8); tags 500 characters in total (commas count, a tag with a space counts 2 more for the quotes);
 *  more than 60 hashtags and YouTube ignores all of them; title, description and tags may not contain < or >. */
export const LIMITS = { title: 100, description: 5000, tags: 500, hashtags: 60 };
export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export interface Video {
  id: string;
  title: string; description: string; tags: string[]; hashtags: string[]; notes: string;
  sceneId: string; style: string; params: Record<string, unknown>;
  status: Status;
  /** MP4 file name inside output/ ('' until the render has finished) */
  file: string; jobId: string; durationSec: number; sizeBytes: number;
  /** chosen thumbnail frame (seconds) and its PNG in data/thumbnails/ */
  thumbSec: number | null; thumbFile: string;
  /** the 1080×1920 Shorts cover made next to the thumbnail ('' until one is made) and the hook text drawn on both ('' = automatic) */
  coverFile: string; coverText: string;
  /** 'YYYY-MM-DDTHH:mm' (local), 'YYYY-MM-DD', or '' */
  scheduledAt: string; publishedAt: string; youtubeUrl: string;
  createdAt: string; updatedAt: string;
  /** set by the studio's YouTube upload only (never editable from the page); absent for videos never uploaded */
  youtube?: YoutubeState;
  /** the YouTube channel this video is made for (a display name). Older lists have none and read as DEFAULT_CHANNEL. Not editable from the page. */
  channel: string;
  /** 'long' = a 16:9 long video built from Shorts (the Compile page); absent for every Short, so older lists stay valid */
  kind?: 'long';
  /** the long video record (data/compilations/<id>.json) this entry tracks */
  compilationId?: string;
}

/** Technical progress of one upload, so it can be resumed. The tracking status stays `status` (no second status system).
 *  Never holds a secret: no token, no session URI (those live only in Application Support, mode 600). */
export const YT_STAGES = ['uploading', 'processing', 'thumbnail', 'finishing', 'done', 'failed'] as const;
export type YtStage = typeof YT_STAGES[number];
export interface YoutubeState {
  videoId: string; channelId: string; channelName: string;
  stage: YtStage;
  /** which step failed, so the right button can continue it */
  failedAt: '' | 'uploading' | 'processing' | 'thumbnail' | 'finishing';
  /** 'schedule' (publishAt) or 'now' (made public once the thumbnail is set) */
  mode: 'schedule' | 'now';
  /** ISO UTC, '' for 'now' */
  publishAt: string;
  uploadedAt: string;
  thumbnail: 'pending' | 'set' | 'skipped' | 'rejected';
  /** size+mtime of the MP4 when it was uploaded (a later re-render is shown, never re-uploaded) */
  fileSig: string;
  /** last error, already stripped of anything secret */
  error: string;
  /** bytes sent so far / total, for the progress line after a restart */
  sent: number; total: number;
  /** the studio has set Published once from YouTube's answer; it never does it again for this video */
  autoPublished: boolean;
  /** file name of the picture that was sent as the thumbnail ('' = not recorded: videos uploaded before this field existed) */
  thumbSent: string;
  /** ISO UTC: YouTube's daily quota ran out and the studio continues by itself from this time ('' = not waiting) */
  waitUntil: string;
  /** the first videos.insert was refused for quota, so no upload session exists yet; waiting continues by creating it (the only insert there will ever be) */
  needsSession: boolean;
  /** the owner's upload choices, kept so a continued upload (even after a restart) uses exactly what was approved */
  opts?: { categoryId: string; language: string; madeForKids: boolean; synthetic: boolean; notify: boolean };
}
export interface Settings { suggestLang: 'en' | 'id' }
export interface VideoStore { schemaVersion: number; savedAt: string; videos: Video[]; /** optional, so files written before it existed stay valid (no schema bump) */ settings?: Partial<Settings> }

// ---------------- sanitising: anything read from disk or from the client goes through here ----------------
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number, fallback = '') => (typeof x === 'string' ? x.slice(0, max) : fallback);
const isoOr = (x: unknown, fallback: string) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : fallback);

export function parseTags(input: unknown): string[] {
  const list = Array.isArray(input) ? input.map(String) : typeof input === 'string' ? input.split(/[,\n]/) : [];
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of list) {
    const t = raw.replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    if (out.length >= 60) break;
  }
  return out;
}
export function parseHashtags(input: unknown): string[] {
  const list = Array.isArray(input) ? input.map(String) : typeof input === 'string' ? input.split(/[\s,]+/) : [];
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of list) {
    const core = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 50);
    if (core && !seen.has(core.toLowerCase())) { seen.add(core.toLowerCase()); out.push('#' + core); }
    if (out.length >= 80) break;
  }
  return out;
}
const dateOnly = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d\d-\d\d$/.test(x) && !Number.isNaN(Date.parse(x)) ? x : '');
const dateTime = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(x) && !Number.isNaN(Date.parse(x)) ? x : '');
const safeFile = (x: unknown) => (typeof x === 'string' ? x.replace(/[\\/]/g, '').slice(0, 200) : '');

export function newId(now: Date = new Date()): string { return 'v-' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6); }

/** a stored record -> a valid Video, or null when it is not even an object. Bad fields fall back to defaults. */
export function sanitizeVideo(raw: unknown, now: string = new Date().toISOString()): Video | null {
  if (!isObj(raw)) return null;
  const status = STATUSES.includes(raw.status as Status) ? (raw.status as Status) : 'draft';
  const created = isoOr(raw.createdAt, now);
  const sec = Number(raw.thumbSec);
  return {
    id: str(raw.id, 80) || newId(),
    title: str(raw.title, 300), description: str(raw.description, 10000), tags: parseTags(raw.tags), hashtags: parseHashtags(raw.hashtags), notes: str(raw.notes, 10000),
    sceneId: str(raw.sceneId, 80), style: str(raw.style, 80) || 'classic', params: isObj(raw.params) ? raw.params : {},
    status, file: safeFile(raw.file), jobId: str(raw.jobId, 120),
    durationSec: Number.isFinite(Number(raw.durationSec)) && Number(raw.durationSec) > 0 ? Number(raw.durationSec) : 0,
    sizeBytes: Number.isFinite(Number(raw.sizeBytes)) && Number(raw.sizeBytes) > 0 ? Number(raw.sizeBytes) : 0,
    thumbSec: raw.thumbSec !== null && raw.thumbSec !== undefined && Number.isFinite(sec) && sec >= 0 ? sec : null, thumbFile: safeFile(raw.thumbFile),
    coverFile: safeFile(raw.coverFile), coverText: str(raw.coverText, 120),
    scheduledAt: dateTime(raw.scheduledAt), publishedAt: dateOnly(raw.publishedAt), youtubeUrl: str(raw.youtubeUrl, 400).trim(),
    createdAt: created, updatedAt: isoOr(raw.updatedAt, created), channel: str(raw.channel, 120).trim() || DEFAULT_CHANNEL,
    ...(isObj(raw.youtube) ? { youtube: sanitizeYoutube(raw.youtube) } : {}),
    ...(raw.kind === 'long' ? { kind: 'long' as const, compilationId: str(raw.compilationId, 80) } : {}),
  };
}

export function sanitizeYoutube(r: Record<string, unknown>): YoutubeState {
  const pick = <T extends string>(x: unknown, list: readonly T[], d: T): T => (list.includes(x as T) ? (x as T) : d);
  const n = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Math.floor(Number(x)) : 0);
  return {
    videoId: /^[\w-]{1,20}$/.test(String(r.videoId ?? '')) ? String(r.videoId) : '',
    channelId: str(r.channelId, 40), channelName: str(r.channelName, 120),
    stage: pick(r.stage, YT_STAGES, 'failed'),
    failedAt: pick(r.failedAt, ['', 'uploading', 'processing', 'thumbnail', 'finishing'] as const, ''),
    mode: pick(r.mode, ['schedule', 'now'] as const, 'schedule'),
    publishAt: isoOr(r.publishAt, ''), uploadedAt: isoOr(r.uploadedAt, ''),
    thumbnail: pick(r.thumbnail, ['pending', 'set', 'skipped', 'rejected'] as const, 'pending'),
    fileSig: str(r.fileSig, 60), error: str(r.error, 400), sent: n(r.sent), total: n(r.total), autoPublished: r.autoPublished === true,
    thumbSent: /^[\w.-]{1,80}$/.test(String(r.thumbSent ?? '')) ? String(r.thumbSent) : '',
    waitUntil: isoOr(r.waitUntil, ''), needsSession: r.needsSession === true,
    ...(isObj(r.opts) ? { opts: { categoryId: str(r.opts.categoryId, 10), language: str(r.opts.language, 10), madeForKids: r.opts.madeForKids === true, synthetic: r.opts.synthetic === true, notify: r.opts.notify === true } } : {}),
  };
}

// ---------------- upload readiness + consent (pure; the server supplies the file facts) ----------------
export interface UploadOptions { mode: 'schedule' | 'now'; /** local 'YYYY-MM-DDTHH:mm' for 'schedule' */ at: string; categoryId: string; language: string; madeForKids: boolean; synthetic: boolean; notify: boolean }
export interface FileFacts { exists: boolean; width: number; height: number; durationSec: number; sizeBytes: number; mtimeMs: number }
/** the description YouTube receives: the description plus the hashtags, exactly as "Copy (with hashtags)" gives it */
export const uploadDescription = (v: Pick<Video, 'description' | 'hashtags'>) => descriptionWithHashtags(v);
export const fileSig = (f: Pick<FileFacts, 'sizeBytes' | 'mtimeMs'>) => `${f.sizeBytes}-${Math.round(f.mtimeMs)}`;
export const MIN_LEAD_MIN = 30;

/** Everything that blocks an upload, in plain words ([] = ready). */
export function uploadProblems(v: Video, f: FileFacts, o: UploadOptions, now: Date = new Date()): string[] {
  // the uploader only knows Shorts (1080×1920, up to 3 minutes); long videos are a separate piece of work, so they are never sent
  if (v.kind === 'long') return ['Long videos cannot be uploaded from the studio yet: the uploader only takes Shorts. Upload this one yourself in YouTube Studio.'];
  const p: string[] = [];
  if (v.youtube?.videoId || (v.youtube && v.youtube.stage !== 'failed')) p.push('This video was already sent to YouTube. The studio never uploads it a second time.');
  if (v.status !== 'rendered') p.push('Only videos with status Rendered can be uploaded.');
  if (!f.exists) p.push('The MP4 is not in output/ any more.');
  else {
    if (f.width !== 1080 || f.height !== 1920) p.push(`The MP4 is ${f.width}×${f.height}, not 1080×1920.`);
    if (!(f.durationSec > 0 && f.durationSec <= 180)) p.push('A Short can be at most 3 minutes long.');
  }
  if (!v.title.trim()) p.push('The title is empty.');
  if (v.title.length > LIMITS.title) p.push(`The title is ${v.title.length} characters; YouTube accepts ${LIMITS.title}.`);
  const d = uploadDescription(v);
  if (utf8Bytes(d) > LIMITS.description) p.push(`The description with hashtags is ${utf8Bytes(d)} bytes; YouTube accepts ${LIMITS.description}.`);
  if (tagsLength(v.tags) > LIMITS.tags) p.push(`Tags are ${tagsLength(v.tags)} characters; YouTube accepts ${LIMITS.tags} in total.`);
  if (/[<>]/.test(v.title + d + v.tags.join(''))) p.push('YouTube does not accept < or > in the title, description or tags.');
  if (o.mode === 'schedule') {
    const t = Date.parse(o.at);
    if (!o.at || Number.isNaN(t)) p.push('Pick a date and time for the schedule.');
    else if (t < now.getTime() + MIN_LEAD_MIN * 60e3) p.push(`The schedule must be at least ${MIN_LEAD_MIN} minutes from now.`);
  }
  return [...new Set(p)];
}

/** A fingerprint of exactly what the owner agreed to: changing any of it (or reusing it) invalidates the consent. */
export function consentKey(v: Video, f: FileFacts, o: UploadOptions, channelId: string): string {
  const parts = [v.id, fileSig(f), v.title, uploadDescription(v), v.tags.join(','), uploadThumbName(v), o.mode, o.mode === 'schedule' ? o.at : '', o.categoryId, o.language, o.madeForKids, o.synthetic, o.notify, channelId];
  let h1 = 0x811c9dc5, h2 = 0x1b873593; const s = JSON.stringify(parts);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** today as YYYY-MM-DD in local time */
export const localDate = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const EDITABLE = ['title', 'description', 'tags', 'hashtags', 'notes', 'status', 'scheduledAt', 'publishedAt', 'youtubeUrl', 'thumbSec', 'thumbFile', 'coverFile', 'coverText'] as const;

/** apply a partial edit from the studio. Only editable fields count; values are re-sanitised; status changes fill in dates. */
export function patchVideo(v: Video, patch: unknown, now: Date = new Date()): Video {
  if (!isObj(patch)) return v;
  const merged: Record<string, unknown> = { ...v };
  for (const k of EDITABLE) if (k in patch) merged[k] = patch[k];
  const next = sanitizeVideo(merged, now.toISOString())!;
  next.id = v.id; next.createdAt = v.createdAt;
  if (next.status !== v.status && next.status === 'published' && !next.publishedAt) next.publishedAt = localDate(now);
  next.updatedAt = now.toISOString();
  return next;
}

// ---------------- metadata: editable starting point, never an empty form ----------------
export interface SuggestInput {
  sceneName: string; family: string; sceneDescription: string; hook: string; styleName: string; durationSec?: number;
  /** from describe.ts: what the scene is about and what its parameters say. Without them a generic, still-true text is written. */
  sceneId?: string; seed?: number; topic?: Topic; facts?: Facts;
  /** which description wording to use (0 = standard); see copywriter.ts */
  variant?: number;
}
export interface Suggestion { title: string; titleIdeas: string[]; /** the same five, with their style (question, stakes, number, curious, explain) */ titles?: TitleIdea[]; description: string; tags: string[]; hashtags: string[] }

const FAMILY: Record<string, { idea: string; tags: string[]; hash: string }> = {
  'conic mirrors': { idea: 'Every ball lands on the same spot. Here is why.', tags: ['mirror', 'reflection', 'optics', 'ellipse', 'parabola', 'focus point', 'geometry'], hash: 'optics' },
  orbits: { idea: 'This orbit draws a flower. Watch it close.', tags: ['orbit', 'gravity', 'planets', 'resonance', 'astronomy', 'string art'], hash: 'orbits' },
  oscillations: { idea: 'Watch the chaos sort itself out.', tags: ['pendulum', 'harmonic motion', 'waves', 'oscillation', 'resonance'], hash: 'pendulum' },
  probability: { idea: 'Pure randomness draws a perfect curve.', tags: ['probability', 'statistics', 'bell curve', 'normal distribution', 'randomness'], hash: 'probability' },
  chaos: { idea: 'A billionth of a pixel changes everything.', tags: ['chaos theory', 'butterfly effect', 'gravity', 'bouncing balls'], hash: 'chaos' },
  geometry: { idea: 'Does this path ever close?', tags: ['billiards', 'geometry', 'math puzzle', 'golden ratio', 'irrational numbers'], hash: 'geometry' },
  smash: { idea: 'One ball. A few hammers. Watch it get out of hand.', tags: ['satisfying', 'hammer', 'bouncing balls', 'chain reaction', 'exponential growth', 'asmr', 'oddly satisfying'], hash: 'satisfying' },
  sync: { idea: 'Different rhythms, one perfect moment.', tags: ['satisfying', 'synchronization', 'patterns', 'rhythm', 'irrational numbers', 'geometry', 'asmr'], hash: 'satisfying' },
};
const GENERIC_TAGS = ['physics simulation', 'math', 'science', 'shorts', '2D simulation'];

export type SuggestLang = 'en' | 'id';
export const LANGS: { id: SuggestLang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'id', label: 'Indonesian' }];
export const isLang = (x: unknown): x is SuggestLang => x === 'en' || x === 'id';

/** Indonesian templates: the title idea, a one-sentence blurb of the topic, and topic tags/hashtag per scene family */
const FAMILY_ID: Record<string, { idea: string; blurb: string; tags: string[]; hash: string }> = {
  'conic mirrors': { idea: 'Semua bola mendarat di satu titik. Ini alasannya.', blurb: 'Bola-bola memantul di cermin berbentuk elips, parabola, dan lainnya, lalu bertemu tepat di titik fokus.', tags: ['cermin', 'pantulan', 'optika', 'elips', 'parabola', 'titik fokus', 'geometri'], hash: 'optika' },
  orbits: { idea: 'Orbit ini menggambar bunga. Lihat bagaimana ia menutup.', blurb: 'Planet-planet bergerak dalam resonansi dan menggambar pola bunga yang rapi.', tags: ['orbit', 'gravitasi', 'planet', 'resonansi', 'astronomi', 'string art'], hash: 'orbit' },
  oscillations: { idea: 'Lihat kekacauan ini merapikan dirinya sendiri.', blurb: 'Bandul-bandul bergerak lepas dari fase lalu sejajar lagi pada saat yang tepat.', tags: ['bandul', 'gerak harmonik', 'gelombang', 'osilasi', 'resonansi'], hash: 'bandul' },
  probability: { idea: 'Kebetulan murni menggambar kurva yang sempurna.', blurb: 'Ratusan pantulan acak kiri-kanan menumpuk menjadi kurva lonceng.', tags: ['probabilitas', 'statistika', 'kurva lonceng', 'distribusi normal', 'acak'], hash: 'probabilitas' },
  chaos: { idea: 'Selisih sepersejuta piksel mengubah segalanya.', blurb: 'Bola-bola yang mulai nyaris sama persis akhirnya terpisah jauh: efek kupu-kupu.', tags: ['teori kekacauan', 'efek kupu-kupu', 'gravitasi', 'bola memantul'], hash: 'kekacauan' },
  geometry: { idea: 'Apakah lintasan ini pernah menutup?', blurb: 'Satu bola memantul di dalam bidang tertutup. Kapan lintasannya kembali ke awal?', tags: ['bilyar', 'geometri', 'teka-teki matematika', 'rasio emas', 'bilangan irasional'], hash: 'geometri' },
  smash: { idea: 'Satu bola, beberapa palu. Lihat bagaimana jumlahnya meledak.', blurb: 'Palu keluar dari dinding dan menghantam bola: tiap hantaman menambah bola sampai wadahnya penuh dan pecah.', tags: ['memuaskan', 'palu', 'bola memantul', 'reaksi berantai', 'pertumbuhan eksponensial', 'asmr'], hash: 'memuaskan' },
  sync: { idea: 'Irama berbeda, satu momen yang pas.', blurb: 'Benda-benda bergerak dengan irama berbeda, lalu bertemu lagi pada saat yang sama, atau garisnya tidak pernah menutup.', tags: ['memuaskan', 'sinkron', 'pola', 'irama', 'bilangan irasional', 'geometri', 'asmr'], hash: 'memuaskan' },
};
const GENERIC_TAGS_ID = ['simulasi fisika', 'matematika', 'sains', 'shorts', 'simulasi 2D'];

const fit = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

export function suggestMetadata(i: SuggestInput, lang: SuggestLang = 'en'): Suggestion {
  if (lang === 'en') {
    // English: the copywriter (five title styles, four description layouts, true to the parameters, seeded)
    const topic = i.topic ?? genericTopic(i.sceneName, i.family, i.sceneDescription);
    const c = writeCopy({ sceneId: i.sceneId ?? topic.key, sceneName: i.sceneName, sceneDescription: i.sceneDescription, family: i.family, hook: i.hook, styleName: i.styleName, durationSec: i.durationSec, seed: i.seed ?? 0, topic, facts: i.facts ?? { vars: {}, numbers: [] }, variant: i.variant });
    const hook = i.hook.trim().replace(/\s*\n\s*/g, ' — ');
    const ideas = [...new Set([...c.titles.map(t => t.text), ...(!i.topic && hook && hook.length <= LIMITS.title ? [hook] : [])])];
    return { title: c.title, titleIdeas: ideas, titles: c.titles, description: c.description, tags: c.tags, hashtags: c.hashtags };
  }
  const id = lang === 'id';
  const fam = FAMILY[i.family] ?? { idea: i.hook, tags: [], hash: i.family.replace(/\W+/g, '').toLowerCase() };
  const fid = FAMILY_ID[i.family];
  const hook = (i.hook || fam.idea || i.sceneName).trim();
  // Indonesian: the on-screen hook is English, so it stays as one of the ideas; the lead title is the Indonesian one
  const title = fit(id && fid ? fid.idea : hook, LIMITS.title);
  const titleIdeas = [...new Set([title, ...(id && fid ? [fit(hook, LIMITS.title)] : [fit(fam.idea, LIMITS.title)]), fit(`${id && fid ? fid.idea : hook} (${i.sceneName})`, LIMITS.title)])];
  const description = (id
    ? [title, fid?.blurb ?? i.sceneDescription, '', 'Semua yang tampil di layar adalah simulasi 2D sungguhan, dihitung dengan matematika yang tepat dan deterministik. Tanpa trik, tanpa CGI.', 'Bagian mana yang paling mengejutkanmu? Tulis di kolom komentar.', '', 'Simulasi baru setiap minggu. Subscribe agar tidak ketinggalan.']
    : [hook, i.sceneDescription, '', 'Everything on screen is a real 2D simulation, computed with exact, deterministic maths. No tricks, no CGI.', 'Which part surprised you? Tell me in the comments.', '', 'New simulations every week. Subscribe so you do not miss the next one.']).join('\n');
  const tags: string[] = []; let len = 0;
  const base = id ? [...(fid?.tags ?? fam.tags), i.sceneName.toLowerCase(), i.styleName.toLowerCase(), ...GENERIC_TAGS_ID] : [...fam.tags, i.sceneName.toLowerCase(), i.styleName.toLowerCase(), ...GENERIC_TAGS];
  for (const t of parseTags(base)) {
    if (len + t.length + 1 > LIMITS.tags - 50) break; // keep headroom under YouTube's 500-character total
    tags.push(t); len += t.length + 1;
  }
  const hashtags = parseHashtags(id ? ['#Shorts', '#fisika', '#matematika', fid ? '#' + fid.hash : '', '#simulasi'] : ['#Shorts', '#physics', '#math', fam.hash ? '#' + fam.hash : '', '#simulation']);
  return { title, titleIdeas, description, tags, hashtags };
}

/** text for the copy buttons. Hashtags go at the end of the description (that is where YouTube reads them). */
export function descriptionWithHashtags(v: Pick<Video, 'description' | 'hashtags'>): string {
  const missing = v.hashtags.filter(h => !v.description.toLowerCase().includes(h.toLowerCase()));
  return missing.length ? `${v.description.replace(/\s+$/, '')}\n\n${missing.join(' ')}` : v.description;
}
export const tagsText = (v: Pick<Video, 'tags'>) => v.tags.join(', ');
export function copyAll(v: Video): string {
  return `${v.title}\n\n${descriptionWithHashtags(v)}\n\nTags: ${tagsText(v)}`;
}

export interface Warning { field: 'title' | 'description' | 'tags' | 'hashtags' | 'youtubeUrl' | 'scheduledAt' | 'file'; text: string }
/** watch?v=<11 characters> is the documented form; /shorts/ and youtu.be/ are YouTube's own share links (not described on the help pages) */
export const isYoutubeUrl = (u: string) => /^https?:\/\/(www\.|m\.)?(youtube\.com\/(shorts\/|live\/|watch\?(?:[^#\s]*&)?v=)|youtu\.be\/)[\w-]{11}(?![\w-])/i.test(u.trim());
export const tagsLength = (tags: string[]) => tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

/** gentle checks, shown next to the fields; they never block saving */
export function checkMetadata(v: Video): Warning[] {
  const w: Warning[] = [];
  if (!v.title.trim()) w.push({ field: 'title', text: 'The title is empty.' });
  if (v.title.length > LIMITS.title) w.push({ field: 'title', text: `The title is ${v.title.length} characters; YouTube keeps ${LIMITS.title}.` });
  if (utf8Bytes(v.description) > LIMITS.description) w.push({ field: 'description', text: `The description is ${utf8Bytes(v.description)} bytes; YouTube keeps ${LIMITS.description} (accented letters and emoji take more than one).` });
  if (/[<>]/.test(v.title + v.description + v.tags.join(''))) w.push({ field: 'title', text: 'YouTube does not accept the characters < and > in the title, description or tags.' });
  if (tagsLength(v.tags) > LIMITS.tags) w.push({ field: 'tags', text: `Tags are ${tagsLength(v.tags)} characters; YouTube accepts ${LIMITS.tags} in total.` });
  if (v.hashtags.length > LIMITS.hashtags) w.push({ field: 'hashtags', text: `More than ${LIMITS.hashtags} hashtags: YouTube then ignores all of them.` });
  if (v.youtubeUrl && !isYoutubeUrl(v.youtubeUrl)) w.push({ field: 'youtubeUrl', text: 'This does not look like a YouTube link (youtube.com/shorts/…, youtu.be/… or watch?v=…).' });
  if (v.status === 'published' && !v.youtubeUrl) w.push({ field: 'youtubeUrl', text: 'Published, but there is no link yet. Paste it here.' });
  if (v.status === 'scheduled' && !v.scheduledAt) w.push({ field: 'scheduledAt', text: 'Scheduled, but no date yet.' });
  return w;
}

export function nextStep(v: Video): string {
  if (v.kind === 'long' && v.status === 'rendered') return 'Upload it yourself in YouTube Studio (the studio cannot upload long videos yet), then mark it Scheduled or Published.';
  switch (v.status) {
    case 'draft': return v.file ? 'Check the texts, then mark it Rendered.' : 'Render it from the studio (Render MP4).';
    case 'rendered': return 'Upload the MP4 on YouTube (use the copy buttons), then mark it Scheduled or Published.';
    case 'scheduled': return 'When it goes live, paste the YouTube link and mark it Published.';
    case 'published': return v.youtubeUrl ? 'Done.' : 'Done. Add the link so you can find it later.';
  }
}

// ---------------- list: filter, search, summary, coverage ----------------
export interface VideoFilter { status?: Status | 'all'; query?: string }
export function filterVideos<T extends Video>(videos: T[], f: VideoFilter, names: { scene?: (id: string) => string; style?: (id: string) => string } = {}): T[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = norm(f.query ?? '').split(/\s+/).filter(Boolean);
  return videos.filter(v => {
    if (f.status && f.status !== 'all' && v.status !== f.status) return false;
    if (!words.length) return true;
    const hay = norm([v.title, v.description, v.tags.join(' '), v.hashtags.join(' '), v.notes, v.youtubeUrl, v.sceneId, v.style, names.scene?.(v.sceneId) ?? '', names.style?.(v.style) ?? '', STATUS_LABEL[v.status]].join(' '));
    return words.every(w => hay.includes(w));
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function statusCounts(videos: Video[]): Record<Status | 'all', number> {
  const c = { all: videos.length, draft: 0, rendered: 0, scheduled: 0, published: 0 };
  for (const v of videos) c[v.status]++;
  return c;
}

export type CellState = 'none' | Status;
export interface Coverage { cells: Record<string, CellState>; total: number; none: number }
/** which scene × style combinations have a video, and how far along the best one is */
export function coverage(videos: Video[], sceneIds: string[], styleIds: string[]): Coverage {
  const rank: CellState[] = ['none', 'draft', 'rendered', 'scheduled', 'published'];
  const cells: Record<string, CellState> = {};
  for (const s of sceneIds) for (const t of styleIds) cells[`${s}|${t}`] = 'none';
  for (const v of videos) {
    const k = `${v.sceneId}|${v.style}`;
    if (v.kind !== 'long' && k in cells && rank.indexOf(v.status) > rank.indexOf(cells[k])) cells[k] = v.status;
  }
  const total = sceneIds.length * styleIds.length;
  return { cells, total, none: Object.values(cells).filter(c => c === 'none').length };
}

// ---------------- export ----------------
const csvCell = (x: unknown) => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** a simple spreadsheet export (UTF-8 with BOM so Excel reads it correctly) */
export function toCsv(videos: Video[]): string {
  const head = ['id', 'status', 'title', 'scene', 'style', 'scheduled_at', 'published_at', 'youtube_url', 'tags', 'hashtags', 'file', 'duration_s', 'notes', 'created_at', 'updated_at'];
  const rows = videos.map(v => [v.id, v.status, v.title, v.sceneId, v.style, v.scheduledAt, v.publishedAt, v.youtubeUrl, v.tags.join('; '), v.hashtags.join(' '), v.file, v.durationSec, v.notes, v.createdAt, v.updatedAt]);
  return '\uFEFF' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------------- which picture YouTube gets ----------------
/** The picture sent as a Short's thumbnail: the tall 9:16 cover (YouTube crops Shorts thumbnails to 9:16, so a wide picture
 *  would lose its sides). Older records without a cover fall back to their thumbnail, which was a tall picture back then. */
export const uploadThumbName = (v: Pick<Video, 'thumbFile' | 'coverFile'>): string => v.coverFile || v.thumbFile;
/** '' when the thumbnail YouTube has is the right one (or none was set); otherwise why it is wrong. Videos from before
 *  `thumbSent` existed sent `thumbFile`, which for them was the wide picture whenever a cover exists. */
export function thumbProblem(v: Pick<Video, 'thumbFile' | 'coverFile' | 'youtube'>): string {
  const y = v.youtube; if (!y?.videoId || y.thumbnail !== 'set') return '';
  const sent = y.thumbSent || v.thumbFile, want = uploadThumbName(v);
  if (!sent || !want || sent === want) return '';
  return v.coverFile && sent === v.thumbFile ? 'YouTube has the wide 1280×720 picture, which it crops to 9:16 for Shorts, so the hook text is cut off.' : 'The picture on YouTube is not the current one (an older picture was sent).';
}
