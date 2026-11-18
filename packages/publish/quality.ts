// Quality checker for the texts of one video: YouTube's limits, duplicate tags, missing keyword, and anything that could
// mislead (clickbait phrases, claims the video does not show, numbers that are not in the video). Pure; never throws and
// never blocks saving. Each issue has a severity: error = YouTube will refuse or cut it, warn = fix before publishing, info = a tip.
import { checkMetadata, tagsLength, utf8Bytes, LIMITS, type Video } from './index.ts';
import { CLAIM_TERMS, type Topic } from './topics.ts';
import { numbersIn, stripEmoji, type Facts } from './copywriter.ts';

export type Severity = 'error' | 'warn' | 'info';
export type QualityField = 'title' | 'description' | 'tags' | 'hashtags' | 'cover' | 'youtubeUrl' | 'scheduledAt' | 'file';
export interface QualityIssue { code: string; severity: Severity; field: QualityField; text: string }
export interface QualityContext {
  /** what the scene is about (keywords, vocabulary); without it only the generic checks run */
  topic?: Topic | null;
  /** the numbers the video really contains; without it the number check is skipped */
  facts?: Facts | null;
  /** titles of the other videos in the list, to catch a repeated title */
  otherTitles?: string[];
}

/** phrases that promise more than a simulation delivers, or that read as bait */
export const CLICKBAIT: [RegExp, string][] = [
  [/you won'?t believe|nobody (is )?talking|they don'?t want you|doctors hate|what happens next will/i, 'a "you will not believe" style promise'],
  [/\b(shocking|mind[- ]?blowing|insane|unbelievable|jaw[- ]?dropping|illegal|banned)\b/i, 'an exaggerated word'],
  [/\b(gone wrong|gone sexual|i tried|exposed|secret trick|life[- ]?hack|hack)\b/i, 'a bait phrase'],
  [/\b(impossible|never before seen|world'?s first|only one in the world)\b/i, 'a claim that cannot be backed up'],
  [/\b(100%|guaranteed|proof that|proves that)\b/i, 'an absolute claim'],
  [/\b(free money|giveaway|win cash|click (here|now))\b/i, 'a giveaway or click-bait line'],
];
const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const stem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
const EMOJI_G = /\p{Extended_Pictographic}/gu;
const firstLine = (d: string) => d.trim().split('\n')[0] ?? '';
const includesAny = (text: string, list: string[]) => { const t = text.toLowerCase(); return list.some(k => t.includes(k.toLowerCase())); };

export function checkQuality(v: Video, ctx: QualityContext = {}): QualityIssue[] {
  const out: QualityIssue[] = [];
  const add = (code: string, severity: Severity, field: QualityField, text: string) => { out.push({ code, severity, field, text }); };

  // 1) YouTube's own limits and publishing details (the same checks as before, with a severity)
  for (const w of checkMetadata(v)) add('limit', w.field === 'youtubeUrl' || w.field === 'scheduledAt' ? 'warn' : 'error', w.field as QualityField, w.text);

  const title = v.title.trim(), desc = v.description.trim(), topic = ctx.topic ?? null;
  const all = `${title}\n${desc}\n${v.tags.join(' ')}`;

  // 2) title
  if (title && title.length > 70 && title.length <= LIMITS.title) add('title-long', 'info', 'title', `The title is ${title.length} characters. Phones may cut it after about 60-70, so keep the hook and the keyword at the start.`);
  if (title && topic && !includesAny(title, topic.keywords)) add('title-keyword', 'warn', 'title', `The title does not contain the main keyword (${topic.keyword}). People searching for it will not find this video as easily.`);
  if (title && ctx.otherTitles?.some(t => t.trim().toLowerCase() === title.toLowerCase())) add('title-duplicate', 'warn', 'title', 'Another video in your list has exactly this title. Give each video its own title.');
  if (title) {
    const caps = (title.match(/\b[A-Z]{4,}\b/g) ?? []).length;
    if (caps >= 2) add('title-caps', 'warn', 'title', 'Several words in ALL CAPS read as shouting. Use normal capitals.');
    if (/[!?]{2,}/.test(title) || (title.match(/!/g) ?? []).length > 1) add('title-punct', 'warn', 'title', 'Repeated ! or ? marks look like bait. One mark is enough.');
    if ((title.match(EMOJI_G) ?? []).length > 2) add('title-emoji', 'warn', 'title', 'More than two emoji in the title. One is plenty.');
  }

  // 3) misleading: bait phrases and claims the video does not back up
  for (const [re, what] of CLICKBAIT) {
    const m = re.exec(`${title}\n${desc}`);
    if (m) add('clickbait', 'warn', re.test(title) ? 'title' : 'description', `"${m[0]}" is ${what}. The video is a simulation: describe what it shows, not a promise.`);
  }
  if (topic) {
    const vocab = new Set(topic.vocab.map(w => w.toLowerCase())), seen = new Set<string>();
    for (const [name, re] of Object.entries(CLAIM_TERMS)) {
      const m = re.exec(all); if (!m || seen.has(name)) continue; seen.add(name);
      if (!words(m[0]).some(w => vocab.has(w))) add('claim', 'warn', re.test(title) ? 'title' : re.test(desc) ? 'description' : 'tags', `The texts mention "${m[0]}", but this video does not show that. Remove it, or it may count as misleading.`);
    }
  }
  if (ctx.facts) {
    const allowed = new Set([1, ...ctx.facts.numbers]);
    const clean = (s: string) => stripEmoji(s).replace(/\b\d+\s?D\b/gi, '').replace(/#\w+/g, '');
    for (const [where, text] of [['title', title], ['description', desc]] as const) {
      const bad = [...new Set(numbersIn(clean(text)).filter(n => !allowed.has(n)))];
      if (bad.length) add('number', 'warn', where, `The ${where} uses ${bad.length === 1 ? 'the number' : 'the numbers'} ${bad.join(', ')}, which ${bad.length === 1 ? 'is' : 'are'} not in this video's settings. Numbers must match what the viewer sees.`);
    }
  }

  // 4) description
  if (desc) {
    const fl = firstLine(desc);
    if (topic && !includesAny(fl, topic.keywords)) add('desc-keyword', 'warn', 'description', `The first line of the description does not contain the main keyword (${topic.keyword}). It is the part search and the feed read first.`);
    if (!/\?/.test(fl) && !(title && stripEmoji(fl).toLowerCase().includes(stripEmoji(title).toLowerCase().replace(/[.?!]$/, '')))) add('desc-hook', 'info', 'description', 'The first line has no hook. Start with the question or the hook of the video.');
    if ((desc.match(/subscribe/gi) ?? []).length > 1) add('desc-cta', 'warn', 'description', 'The description asks to subscribe more than once. One calm line is enough.');
    if ((desc.match(EMOJI_G) ?? []).length > 6) add('desc-emoji', 'info', 'description', 'A lot of emoji in the description. A few at most keeps it readable.');
    const b = utf8Bytes(desc); if (b > 4500 && b <= LIMITS.description) add('desc-near', 'info', 'description', `The description is ${b} of ${LIMITS.description} bytes: close to the limit.`);
  } else if (title) add('desc-empty', 'warn', 'description', 'The description is empty. Add at least the hook and one sentence about what the viewer sees.');

  // 5) tags: duplicates (also singular/plural twins), too few, no keyword, claims
  const seenTag = new Map<string, string>(), twins: string[] = [];
  for (const t of v.tags) { const k = stem(t); if (!k) continue; const prev = seenTag.get(k); if (prev !== undefined) twins.push(prev.toLowerCase() === t.toLowerCase() ? `"${t}"` : `"${prev}" and "${t}"`); else seenTag.set(k, t); }
  if (twins.length) add('tags-duplicate', 'warn', 'tags', `Duplicate tags: ${[...new Set(twins)].join('; ')}. Keep one of each.`);
  if (v.tags.length > 0 && v.tags.length < 5) add('tags-few', 'info', 'tags', `Only ${v.tags.length} tags. Five to ten relevant tags are a good range.`);
  if (!v.tags.length) add('tags-empty', 'info', 'tags', 'No tags yet. Tags help YouTube place the video next to similar ones.');
  if (topic && v.tags.length && !includesAny(v.tags.join(' | '), topic.keywords)) add('tags-keyword', 'warn', 'tags', `None of the tags contains the main keyword (${topic.keyword}).`);
  if (tagsLength(v.tags) > LIMITS.tags * 0.9 && tagsLength(v.tags) <= LIMITS.tags) add('tags-near', 'info', 'tags', `Tags use ${tagsLength(v.tags)} of ${LIMITS.tags} characters.`);

  // 6) hashtags: #Shorts and three at most are shown
  if (!v.hashtags.some(h => h.toLowerCase() === '#shorts')) add('hashtags-shorts', 'warn', 'hashtags', 'The hashtag #Shorts is missing.');
  if (v.hashtags.length > 3) add('hashtags-many', 'info', 'hashtags', `${v.hashtags.length} hashtags. YouTube shows only the first three above the title, so put the best ones first (three is enough).`);

  // 7) cover
  if (v.file && !v.thumbFile) add('cover-missing', 'info', 'cover', 'No thumbnail yet. Pick the best frame in the Thumbnail section.');

  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const SEVERITY_LABEL: Record<Severity, string> = { error: 'Fix', warn: 'Check', info: 'Tip' };
export const qualitySummary = (issues: QualityIssue[]) => ({ error: issues.filter(i => i.severity === 'error').length, warn: issues.filter(i => i.severity === 'warn').length, info: issues.filter(i => i.severity === 'info').length });
