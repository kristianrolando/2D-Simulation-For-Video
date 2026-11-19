// Navigation of the Videos page, pure (no DOM): the Shorts / Long format, the address (#videos/long/build), what is remembered,
// the "renders not in the list" banner and its dismissal, sorting and the scene/style filter. Unit-tested in Node (tests/videos-nav.test.ts).
// UI only: it reads the video list and never changes a video, a schedule or a status.
import { statusCounts, type Video } from '../../packages/publish/index.ts';
import { hash8 } from '../../packages/compile/index.ts';

export type Format = 'all' | 'shorts' | 'long';
export const FORMATS: readonly Format[] = ['all', 'shorts', 'long'];
export const FORMAT_LABEL: Record<Format, string> = { all: 'All', shorts: 'Shorts', long: 'Long' };
export const FORMAT_HINT: Record<Format, string> = { all: 'Shorts and long videos together', shorts: 'Shorts (1080×1920, up to 3 minutes)', long: 'Long videos (16:9, built from Shorts)' };
export type Mode = 'list' | 'calendar' | 'build';
export const MODES: readonly Mode[] = ['list', 'calendar', 'build'];
export const MODE_LABEL: Record<Mode, string> = { list: 'List', calendar: 'Calendar', build: 'Build long video' };
export const MODE_HINT: Record<Mode, string> = {
  list: 'The videos as a list, with their texts and status',
  calendar: 'The upload schedule as a calendar (the plan is for Shorts)',
  build: 'Join Shorts into long 16:9 videos: suggest, edit, build',
};

// ---------------- format ----------------
type K = Pick<Video, 'kind'>;
/** a Short unless the record says it is a long video (older lists have no kind at all) */
export const formatOf = (v: K): 'shorts' | 'long' => (v.kind === 'long' ? 'long' : 'shorts');
export const inFormat = <T extends K>(vs: T[], f: Format): T[] => (f === 'all' ? vs : vs.filter(v => formatOf(v) === f));
/** the numbers on the format picker; shorts + long is always all */
export const formatCounts = (vs: K[]): Record<Format, number> => { const long = vs.filter(v => formatOf(v) === 'long').length; return { all: vs.length, shorts: vs.length - long, long }; };
/** the numbers on the status chips, for the chosen format only */
export const statusCountsIn = (vs: Video[], f: Format) => statusCounts(inFormat(vs, f));

// ---------------- address ----------------
export interface Nav { format: Format; mode: Mode }
/** '#videos', '#videos/long', '#videos/shorts/calendar', '#videos/long/build' … → what it names (a part that is missing is undefined); null for any other address */
export function parseHash(hash: string): Partial<Nav> | null {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  if (parts[0] !== 'videos') return null;
  const out: Partial<Nav> = {};
  for (const p of parts.slice(1)) { if ((FORMATS as readonly string[]).includes(p)) out.format = p as Format; else if ((MODES as readonly string[]).includes(p)) out.mode = p as Mode; }
  return out;
}
/** the address that names a state: '#videos/long', '#videos/shorts/calendar' */
export const formatHash = (n: Nav) => `#videos/${n.format}${n.mode === 'list' ? '' : '/' + n.mode}`;

// ---------------- remembered choices (localStorage can be missing or throw: then nothing is remembered and nothing breaks) ----------------
export interface Store { get(key: string): string | null; set(key: string, value: string): void }
export const browserStore = (): Store => ({
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode or full: not remembered */ } },
});
export const FORMAT_KEY = 'studio.vformat', SORT_KEY = 'studio.vsort', DISMISS_KEY = 'studio.vdismiss';
export function readFormat(s: Store): Format { try { const v = s.get(FORMAT_KEY); return (FORMATS as readonly (string | null)[]).includes(v) ? (v as Format) : 'all'; } catch { return 'all'; } }
export function writeFormat(s: Store, f: Format) { try { s.set(FORMAT_KEY, f); } catch { /* not remembered */ } }
/** the address wins over what was remembered, and what was remembered wins over the default (all, list) */
export function startNav(hash: string, s: Store): Nav {
  const h = parseHash(hash) ?? {};
  return { format: h.format ?? readFormat(s), mode: h.mode ?? 'list' };
}

// ---------------- the "renders not in this list yet" banner ----------------
/** one value for a list of files: the same files give the same value, any other list gives another */
export const filesSig = (files: string[]) => (files.length ? hash8([...files].sort().join('|')) : '');
export function bannerVisible(o: { files: string[]; dismissedSig: string; readOnly?: boolean; format?: Format; mode?: Mode }): boolean {
  if (!o.files.length || o.readOnly) return false;
  if (o.format === 'long' || (o.mode && o.mode !== 'list')) return false; // renders are Shorts; the banner belongs on the list
  return filesSig(o.files) !== o.dismissedSig;
}
export const readDismissed = (s: Store) => { try { return s.get(DISMISS_KEY) ?? ''; } catch { return ''; } };
export function dismissBanner(s: Store, files: string[]) { try { s.set(DISMISS_KEY, filesSig(files)); } catch { /* not remembered */ } }
export const bannerText = (n: number) => `${n} render${n === 1 ? '' : 's'} in output/ ${n === 1 ? 'is' : 'are'} not in this list yet.`;
export const addConfirmText = (n: number) => `Add ${n} render${n === 1 ? '' : 's'} from output/ to the list? Nothing is uploaded or deleted; each gets a draft title and description.`;

// ---------------- sort and filter ----------------
export type Sort = 'newest' | 'schedule' | 'title';
export const SORTS: readonly Sort[] = ['newest', 'schedule', 'title'];
export const SORT_LABEL: Record<Sort, string> = { newest: 'Newest first', schedule: 'By schedule date', title: 'By title (A–Z)' };
export const readSort = (s: Store): Sort => { try { const v = s.get(SORT_KEY); return (SORTS as readonly (string | null)[]).includes(v) ? (v as Sort) : 'newest'; } catch { return 'newest'; } };
const when = (v: Video) => v.youtube?.publishAt || v.scheduledAt || v.publishedAt || '';
/** a new sorted list: 'schedule' puts videos with a date first (earliest first) and the rest after, newest first */
export function sortVideos<T extends Video>(vs: T[], by: Sort): T[] {
  const newest = (a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt);
  const out = [...vs];
  if (by === 'title') return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || newest(a, b));
  if (by === 'schedule') return out.sort((a, b) => { const x = when(a), y = when(b); return x && y ? x.localeCompare(y) || newest(a, b) : x ? -1 : y ? 1 : newest(a, b); });
  return out.sort(newest);
}
export interface Filters { status: string; query: string; scene: string; style: string; focus: string }
export const NO_FILTERS: Filters = { status: 'all', query: '', scene: '', style: '', focus: '' };
export const hasFilters = (f: Filters) => f.status !== 'all' || f.query.trim() !== '' || f.scene !== '' || f.style !== '' || f.focus !== '';
export const filterBy = <T extends Pick<Video, 'sceneId' | 'style'>>(vs: T[], f: Pick<Filters, 'scene' | 'style'>): T[] => vs.filter(v => (!f.scene || v.sceneId === f.scene) && (!f.style || v.style === f.style));
/** the scenes and styles that exist in a list, for the two filter menus */
export const optionsOf = (vs: Pick<Video, 'sceneId' | 'style'>[]) => ({ scenes: [...new Set(vs.map(v => v.sceneId))].sort(), styles: [...new Set(vs.map(v => v.style))].sort() });

// ---------------- calendar ----------------
/** What the calendar gets for a format: the upload plan is for Shorts only, so a Long-only calendar has no plan slots and shows just the
 *  long videos the owner marked Scheduled or Published with a date. In "All" both appear and long ones carry a "Long" mark. */
export function calendarInput<T extends K>(plan: { slots: unknown[] } | null, vs: T[], f: Format) { return { plan: f === 'long' ? null : plan, videos: inFormat(vs, f) }; }
export const CALENDAR_NOTE: Record<Format, string> = {
  all: 'Long videos are marked "Long". They are not part of the Shorts upload plan: only a long video with a date you entered shows here.',
  shorts: '',
  long: 'The upload plan is for Shorts, so no slots are planned here. Only long videos you marked Scheduled or Published with a date show up.',
};
