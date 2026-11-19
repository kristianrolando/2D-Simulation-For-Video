// Pure studio helpers (no DOM), so they can be unit-tested in Node: gallery search and ordering,
// keyboard shortcut mapping, readable error messages, and small formatters.

/** every word of the query must appear somewhere in the text (case-insensitive, accent-insensitive) */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(fields.join(' '));
  return words.every(w => hay.includes(w));
}

/** gallery order: scenes in registry order, each followed by its presets (so presets stay under their scene) */
export function groupByScene<T extends { kind: string; sceneId: string; name: string }>(items: T[], sceneOrder: string[]): T[] {
  const rank = (id: string) => { const i = sceneOrder.indexOf(id); return i < 0 ? sceneOrder.length : i; };
  return items.map((it, i) => ({ it, i })).sort((a, b) =>
    rank(a.it.sceneId) - rank(b.it.sceneId) || (a.it.kind === b.it.kind ? 0 : a.it.kind === 'scene' ? -1 : 1) || a.i - b.i).map(x => x.it);
}

export type ShortcutAction =
  | 'play' | 'render' | 'videos' | 'search' | 'prevScene' | 'nextScene' | 'mute' | 'help' | 'debug'
  | 'stepBack' | 'stepFwd' | 'jumpBack' | 'jumpFwd' | 'back' | `style:${number}`;
export interface KeyLike { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/** one place that decides what a key press means (the DOM layer only skips text fields and open dialogs) */
export function shortcutFor(e: KeyLike, styleCount = 6): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.code === 'Space' || e.key === ' ') return 'play';
  switch (e.key) {
    case 'ArrowRight': return e.shiftKey ? 'jumpFwd' : 'stepFwd';
    case 'ArrowLeft': return e.shiftKey ? 'jumpBack' : 'stepBack';
    case 'Escape': return 'back';
    case '/': return 'search';
    case '?': return 'help';
    case '[': return 'prevScene';
    case ']': return 'nextScene';
  }
  const k = e.key.toLowerCase();
  if (k === 'r') return 'render';
  if (k === 'v') return 'videos';
  if (k === 'm') return 'mute';
  if (k === 'd') return 'debug';
  if (/^[1-9]$/.test(k) && +k <= styleCount) return `style:${+k - 1}`;
  return null;
}

/** shown in the "?" dialog; keep in sync with shortcutFor (a test checks that every row maps to an action) */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Space'], label: 'Play / pause the preview' },
  { keys: ['←', '→'], label: 'Previous / next frame (hold Shift: 1 second)' },
  { keys: ['R'], label: 'Render MP4' },
  { keys: ['V'], label: 'Videos: texts, status and links' },
  { keys: ['Esc'], label: 'Back from Videos to the studio' },
  { keys: ['↑', '↓'], label: 'In the Videos list: previous / next video (Enter opens it)' },
  { keys: ['/'], label: 'Search simulations' },
  { keys: ['[', ']'], label: 'Previous / next simulation' },
  { keys: ['1', '–', '6'], label: 'Pick a style' },
  { keys: ['M'], label: 'Sound on / off' },
  { keys: ['D'], label: 'Show / hide preview statistics' },
  { keys: ['?'], label: 'This list' },
];

/** turn a raw failure into "what happened + what to do". Never throws; unknown messages are kept as detail. */
export function friendlyError(raw: unknown): string {
  const msg = (raw instanceof Error ? raw.message : String(raw ?? '')).trim();
  const has = (re: RegExp) => re.test(msg);
  if (has(/failed to fetch|networkerror|load failed|fetch failed|econnrefused/i))
    return 'Cannot reach the studio server. Check that it is still running (npm run dev) and reload this page.';
  if (has(/ffmpeg.*(not found|enoent)|spawn ffmpeg|enoent.*ffmpeg/i))
    return 'ffmpeg was not found. Install it (macOS: brew install ffmpeg), restart the studio and render again.';
  if (has(/ENOSPC|no space left/i)) return 'The disk is full. Free some space (old files in output/ are safe to delete) and render again.';
  if (has(/EACCES|EPERM/)) return 'The studio is not allowed to write into the output/ folder. Check the folder permissions and render again.';
  if (has(/ffmpeg failed/i)) return `The video encoder stopped. Render again; if it repeats, change the style or scene options. (${msg.replace(/^ffmpeg failed:\s*/i, '').slice(0, 160)})`;
  if (has(/unknown scene/i)) return 'This simulation is no longer available. Reload the page and pick one again.';
  if (has(/body too large/i)) return 'The settings are too large to send. Press Reset on the scene options and try again.';
  if (has(/worker exited/i)) return 'The render process crashed before finishing. Render again; if it repeats, try another style.';
  if (!msg) return 'Something went wrong. Try again.';
  return `Something went wrong: ${msg.slice(0, 200)}`;
}

/** parameter-validation messages from the server ("duration: must be ≥ 5") shown as a calm one-liner */
export function friendlyWarnings(warnings: string[] | undefined): string {
  if (!warnings?.length) return '';
  return `Some settings were out of range and were adjusted: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''}`;
}

export function fmtSecs(s: number): string {
  if (!isFinite(s) || s < 0) return '';
  s = Math.round(s);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
export function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** the tab title while a render runs, so progress is visible from another tab; null = leave the title alone */
export function progressTitle(status: string, percent: number, base = 'Sim Studio'): string | null {
  if (status === 'running') return `Render ${Math.max(0, Math.min(100, Math.round(percent)))}% · ${base}`;
  if (status === 'queued') return `Queued · ${base}`;
  return null;
}

/** Videos that need the owner: rendered but not yet scheduled/published, and uploads that failed or stopped */
export interface NeedVideo { status: string; kind?: string; fileExists?: boolean; youtube?: { stage: string; waitUntil?: string } }
/** stopped for YouTube's daily quota: the studio continues by itself after the reset, so it is not a failure that needs the owner */
export const uploadWaiting = (v: NeedVideo) => v.youtube?.stage === 'failed' && !!v.youtube.waitUntil;
export const uploadFailed = (v: NeedVideo) => v.youtube?.stage === 'failed' && !v.youtube.waitUntil;
export const uploadRunning = (v: NeedVideo) => !!v.youtube && ((v.youtube.stage !== 'done' && v.youtube.stage !== 'failed') || uploadWaiting(v));
export function needsCounts(vs: NeedVideo[]) { return { toSchedule: vs.filter(v => v.kind !== 'long' && v.status === 'rendered' && !uploadFailed(v) && !uploadRunning(v)).length, failed: vs.filter(uploadFailed).length, uploading: vs.filter(uploadRunning).length }; }
/** index of the video to open first: a failed upload, then a running one, then the newest "rendered", else the first */
export function firstNeeding<T extends NeedVideo>(vs: T[]): T | undefined {
  return vs.find(uploadFailed) ?? vs.find(uploadRunning) ?? vs.find(v => v.status === 'rendered' && v.kind !== 'long') ?? vs[0];
}
