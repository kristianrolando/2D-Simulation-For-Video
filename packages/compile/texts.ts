// The words of a long video: title ideas (five styles, as the Shorts writer does), a description whose chapter list comes from the real
// clip lengths, tags, hashtags, the thumbnail words, and a checker. Pure. Describes only what the clips show: the numbers are
// the clip count and the minutes of this very video, nothing else.
//
// Patterns learned from the research (docs/compile.md): a number first, one clear keyword, a short parenthetical or question,
// chapters with real names, no bait. Nothing here copies another channel's wording.
import { LIMITS, parseTags, parseHashtags, tagsLength, utf8Bytes } from '../publish/index.ts';
import { CLICKBAIT } from '../publish/quality.ts';
import { CLAIM_TERMS, TITLE_STYLES, TITLE_STYLE_LABEL, type TitleStyle } from '../publish/topics.ts';
import { stripEmoji, fill, numbersIn, hash32, rng } from '../publish/copywriter.ts';
import { chapterLines, chapterProblems, totalSeconds, type ClipRef } from './index.ts';

export interface LongTopic {
  keyword: string; keywords: string[]; emoji: string;
  /** the big words on the thumbnail (upper case, short lines) */
  thumb: string;
  /** one sentence that contains the keyword; no digits */
  lead: string;
  /** plain, true sentences about what happens in every clip of this group; no digits */
  mechanic: string[];
  tags: string[]; hash: [string, string];
  /** words the videos truthfully show (the claim check allows these) */
  vocab: string[];
  /** two per style; {n} clips, {min} minutes, {scenes} kinds of simulation */
  titles: Record<TitleStyle, string[]>;
}
const T = (t: LongTopic) => t;
const HAMMER_VOCAB = ['ball', 'balls', 'hammer', 'hammers', 'smash', 'crush', 'split', 'burst', 'bursts', 'box', 'bounce', 'bounces', 'walls', 'multiply', 'chain', 'reaction', 'growth', 'exponential', 'container', 'octagon', 'circle', 'square', 'triangle', 'ring', 'luck', 'lucky', 'race', 'survive', 'satisfying', 'gems', 'stars'];
const SYNC_VOCAB = ['ball', 'balls', 'dot', 'dots', 'bounce', 'rhythm', 'rhythms', 'lid', 'sync', 'synchronization', 'lap', 'laps', 'line', 'lines', 'pen', 'arm', 'arms', 'loop', 'closed', 'ratio', 'speed', 'shape', 'curve', 'hidden', 'slide', 'sliding', 'circle', 'square', 'triangle', 'ring', 'satisfying', 'orbit'];

export const LONG_TOPICS: Record<string, LongTopic> = {
  'hammer-smash/split': T({
    keyword: 'chain reaction', keywords: ['chain reaction', 'hammer', 'smash'], emoji: '🔨', thumb: 'CHAIN REACTIONS',
    lead: 'Hammer chain reactions where every crushed ball splits into new balls until the container bursts.',
    mechanic: ['Hammers slam out of the walls, and every ball they crush splits into more balls.', 'Each clip uses a different container and different objects, and shows when the container is full and bursts.'],
    tags: ['chain reaction', 'hammer smash', 'exponential growth', 'bouncing balls', 'multiplying balls', 'oddly satisfying', 'satisfying simulation', 'ball physics'], hash: ['#satisfying', '#physics'], vocab: HAMMER_VOCAB,
    titles: {
      question: ['How Fast Do Smashed Balls Multiply? {n} Hammer Chain Reactions', 'When Does It Burst? {n} Hammer Chain Reactions'],
      stakes: ['{n} Chain Reactions, One Hammer Rule: When Does Each Container Burst?', '{n} Containers Fill With Balls Until They Burst: Hammer Chain Reactions'],
      number: ['{n} Hammer Chain Reactions in {min} Minutes', '{n} Hammer Smash Chain Reactions, {min} Minutes of Exponential Growth'],
      curious: ['Every Smash Makes More Balls: {n} Chain Reactions to Watch', 'One Crushed Ball Becomes Several: {n} Hammer Chain Reactions'],
      explain: ['Why Crushed Balls Split Into More: {n} Hammer Chain Reactions', 'How a Hammer Chain Reaction Fills a Container: {n} Simulations'],
    },
  }),
  'hammer-smash/box': T({
    keyword: 'chain reaction', keywords: ['chain reaction', 'hammer', 'box'], emoji: '📦', thumb: 'HAMMER BOX',
    lead: 'Hammer box chain reactions where every bounce inside the box adds one more ball.',
    mechanic: ['Hammers push out of the walls and meet to build a box, and every bounce inside the box adds one more ball.', 'The balls multiply until the walls give way. Each clip uses a different container and different objects.'],
    tags: ['chain reaction', 'hammer box', 'bouncing balls', 'exponential growth', 'multiplying balls', 'oddly satisfying', 'satisfying simulation', 'ball physics'], hash: ['#satisfying', '#physics'], vocab: HAMMER_VOCAB,
    titles: {
      question: ['How Many Bounces Until the Box Breaks? {n} Hammer Chain Reactions', 'When Do the Walls Give Way? {n} Hammer Box Chain Reactions'],
      stakes: ['{n} Hammer Boxes: Every Bounce Adds a Ball, Then the Walls Give Way', '{n} Chain Reactions Inside a Hammer Box: Which Container Bursts?'],
      number: ['{n} Hammer Box Chain Reactions in {min} Minutes', '{n} Hammer Box Simulations, {min} Minutes of Bouncing Balls'],
      curious: ['Every Bounce Adds a Ball: {n} Hammer Box Chain Reactions', 'Hammers Build a Box and the Balls Multiply: {n} Chain Reactions'],
      explain: ['Why Bouncing Balls Multiply Inside a Hammer Box: {n} Simulations', 'How a Hammer Box Turns Bounces Into Balls: {n} Chain Reactions'],
    },
  }),
  'hammer-smash/survive': T({
    keyword: 'hammer', keywords: ['hammer', 'survive', 'bouncing balls'], emoji: '🔨', thumb: 'HAMMER VS BALLS',
    lead: 'A race between the hammer and bouncing balls: crushed balls are gone for good, and a lucky wall bounce adds one.',
    mechanic: ['Hammers slam out of the walls, and every ball they crush is gone for good.', 'Each bounce off a wall has a chance to add a new ball, so it is a race between the hammer and the luck of the bounces. Each clip uses a different container and different objects.'],
    tags: ['hammer', 'survival', 'bouncing balls', 'probability', 'luck vs hammer', 'oddly satisfying', 'satisfying simulation', 'ball physics'], hash: ['#satisfying', '#physics'], vocab: HAMMER_VOCAB,
    titles: {
      question: ['Can the Balls Outrun the Hammer? {n} Survival Simulations', 'Who Survives the Hammer? {n} Bouncing Ball Simulations'],
      stakes: ['{n} Hammer Showdowns: Crushed Balls Are Gone for Good, Lucky Bounces Add One', '{n} Simulations, One Question: Do Any Balls Survive the Hammer?'],
      number: ['{n} Hammer vs Bouncing Ball Simulations in {min} Minutes', '{n} Hammer Survival Simulations, {min} Minutes to Watch'],
      curious: ['A Race Between the Hammer and Lucky Bounces: {n} Simulations', 'Luck Against a Hammer: {n} Bouncing Ball Simulations'],
      explain: ['How Luck Fights a Hammer: {n} Bouncing Ball Simulations', 'Why Some Balls Survive the Hammer: {n} Simulations'],
    },
  }),
  'sync-lines/lid': T({
    keyword: 'sync', keywords: ['sync', 'lid', 'rhythm'], emoji: '🥁', thumb: 'SYNC TESTS',
    lead: 'Sync tests: balls bounce at different rhythms, and the question is whether they ever hit the lid together.',
    mechanic: ['Every ball bounces up and down with its own rhythm.', 'Each clip shows whether they hit the lid at the same moment, on a different track, motion and set of laps.'],
    tags: ['sync', 'synchronization', 'rhythm', 'bouncing balls', 'lid', 'patterns', 'oddly satisfying', 'satisfying simulation', 'math visualization'], hash: ['#satisfying', '#math'], vocab: SYNC_VOCAB,
    titles: {
      question: ['Will They Ever Hit the Lid Together? {n} Bounce Rhythm Sync Tests', 'Do the Rhythms Line Up? {n} Lid Sync Simulations'],
      stakes: ['{n} Sync Tests: Every Ball Bounces at Its Own Rhythm', '{n} Bounce Rhythms, One Lid: When Do They Hit Together?'],
      number: ['{n} Bounce Rhythm Sync Tests in {min} Minutes', '{n} Lid Sync Simulations, {min} Minutes of Rhythm'],
      curious: ['Every Ball Has Its Own Beat: {n} Lid Sync Simulations', 'Different Rhythms, One Lid: {n} Sync Simulations to Watch'],
      explain: ['How Different Bounce Rhythms Meet at the Lid: {n} Sync Simulations', 'Why Bounce Rhythms Sometimes Sync: {n} Lid Tests'],
    },
  }),
  'sync-lines/close': T({
    keyword: 'closed loop', keywords: ['closed loop', 'loop', 'pen'], emoji: '♾️', thumb: 'CLOSED LOOP?',
    lead: 'Two spinning arms and a pen: does the line ever close into a closed loop?',
    mechanic: ['Two arms turn at different speeds and a pen at the end draws a line.', 'The speed ratio decides whether the pen ever returns to its start and closes the loop. Each clip uses a different ratio.'],
    tags: ['closed loop', 'speed ratio', 'two arm pen', 'irrational numbers', 'rational numbers', 'spirograph', 'patterns', 'oddly satisfying', 'satisfying simulation', 'math visualization'], hash: ['#math', '#satisfying'], vocab: SYNC_VOCAB,
    titles: {
      question: ['Does the Line Ever Close Into a Loop? {n} Two-Arm Pen Simulations', 'Will the Pen Find Its Start? {n} Closed Loop Tests'],
      stakes: ['{n} Speed Ratios, One Pen: Which Ones Make a Closed Loop?', '{n} Pen Tests: When Does a Line Become a Closed Loop?'],
      number: ['{n} Closed Loop Tests in {min} Minutes', '{n} Two-Arm Pen Simulations, {min} Minutes of Patterns'],
      curious: ['A Pen on Two Spinning Arms: {n} Ratios, One Question', 'Same Pen, Different Speeds: {n} Closed Loop Simulations'],
      explain: ['How a Speed Ratio Decides if a Pen Draws a Closed Loop: {n} Simulations', 'Why Some Pens Close the Loop and Some Never Do: {n} Tests'],
    },
  }),
  'sync-lines/orbits': T({
    keyword: 'synchronization', keywords: ['synchronization', 'line up', 'laps'], emoji: '⭕', thumb: 'LINE UP?',
    lead: 'Synchronization tests: dots circle at different speeds, and the question is when they line up again.',
    mechanic: ['The dots start in one line and each one laps at its own pace.', 'Because every pace is different they spread out, and each clip shows when they come back into one line, on a different track.'],
    tags: ['synchronization', 'sync', 'orbit lines', 'laps', 'least common multiple', 'patterns', 'oddly satisfying', 'satisfying simulation', 'math visualization'], hash: ['#satisfying', '#math'], vocab: SYNC_VOCAB,
    titles: {
      question: ['When Do They Line Up Again? {n} Orbit Synchronization Tests', 'Will the Dots Ever Line Up? {n} Synchronization Simulations'],
      stakes: ['{n} Synchronization Tests: Dots Circle at Different Speeds', '{n} Orbits, One Question: When Do the Dots Line Up?'],
      number: ['{n} Orbit Synchronization Simulations in {min} Minutes', '{n} Synchronization Tests, {min} Minutes of Orbiting Dots'],
      curious: ['Every Dot Laps at Its Own Pace: {n} Synchronization Simulations', 'Different Speeds, One Line: {n} Synchronization Simulations to Watch'],
      explain: ['Why Dots at Different Speeds Line Up Again: {n} Synchronization Simulations', 'How Different Laps Reach Synchronization: {n} Orbit Simulations'],
    },
  }),
  'sync-lines/slider': T({
    keyword: 'hidden shape', keywords: ['hidden shape', 'shape', 'straight lines'], emoji: '📐', thumb: 'HIDDEN SHAPES',
    lead: 'Hidden shapes appear from straight lines: every dot only slides back and forth along a line.',
    mechanic: ['Every dot only slides back and forth along a line, and a new line is drawn every moment.', 'No curve is drawn on purpose: each shape comes out of the straight lines alone. Each clip hides a different shape.'],
    tags: ['hidden shape', 'straight lines', 'envelope curve', 'string art', 'sliding dots', 'patterns', 'oddly satisfying', 'satisfying simulation', 'math visualization'], hash: ['#satisfying', '#math'], vocab: SYNC_VOCAB,
    titles: {
      question: ['Can You Guess the Hidden Shape? {n} Straight-Line Simulations', 'What Shape Is Hiding in the Lines? {n} Simulations'],
      stakes: ['{n} Hidden Shapes Made Only of Straight Lines: Can You Spot Them?', '{n} Simulations, No Curves Drawn: Which Shape Appears?'],
      number: ['{n} Hidden Shape Simulations in {min} Minutes', '{n} Straight-Line Simulations, {min} Minutes of Hidden Shapes'],
      curious: ['No Curve Is Drawn, Yet a Shape Appears: {n} Hidden Shape Simulations', 'Straight Lines Only: {n} Simulations With a Hidden Shape'],
      explain: ['How Straight Lines Draw a Hidden Shape: {n} Sliding Dot Simulations', 'Why Straight Lines Make a Curve: {n} Hidden Shape Simulations'],
    },
  }),
  mix: T({
    keyword: 'physics simulation', keywords: ['physics simulation', 'simulation', 'physics'], emoji: '🔭', thumb: 'PHYSICS SIMS',
    lead: 'A mix of physics and math simulations: mirrors, billiard paths, pendulums, orbits and more.',
    mechanic: ['Every clip is a different kind of simulation, from balls bouncing off mirrors to a pendulum that lines up and a pen that draws a closed pattern.', 'Each one runs on exact maths, so the same settings always give the same result.'],
    tags: ['physics simulation', 'math visualization', 'simulation mix', 'mirror reflection', 'billiard path', 'pendulum wave', 'harmonograph', 'oddly satisfying', 'satisfying simulation', 'science'], hash: ['#physics', '#math'],
    vocab: ['ball', 'balls', 'mirror', 'mirrors', 'reflection', 'focal', 'billiard', 'billiards', 'pendulum', 'pendulums', 'orbit', 'orbits', 'galton', 'board', 'bounce', 'gravity', 'harmonograph', 'rosette', 'resonance', 'wave', 'path', 'curve', 'satisfying', 'pen'],
    titles: {
      question: ['What Do {scenes} Different Physics Simulations Look Like? {n} Clips', 'Can You Guess How Each One Ends? {n} Physics Simulations'],
      stakes: ['{n} Physics Simulations, {scenes} Kinds: Mirrors, Billiards, Pendulums and More', '{n} Simulations Where Exact Maths Decides Every Bounce'],
      number: ['{n} Physics Simulations in {min} Minutes', '{n} Physics and Math Simulations, {min} Minutes to Watch'],
      curious: ['Balls, Mirrors, Pendulums and Orbits: {n} Physics Simulations', 'Same Maths, {scenes} Different Looks: {n} Simulations'],
      explain: ['How Exact Maths Moves Every Ball: {n} Physics Simulations', 'Why These {n} Physics Simulations Always Repeat Exactly'],
    },
  }),
};
export const topicOf = (group: string): LongTopic => LONG_TOPICS[group] ?? LONG_TOPICS.mix;

export interface LongTextInput { group: string; part: number; parts: number; clips: Pick<ClipRef, 'frames' | 'label' | 'sceneId'>[]; seed: number }
export interface LongTitle { text: string; style: TitleStyle; label: string }
export interface LongTexts { title: string; titles: LongTitle[]; description: string; tags: string[]; hashtags: string[]; thumbText: string; thumbNumber: number }

export const minutesOf = (clips: Pick<ClipRef, 'frames'>[]) => Math.max(1, Math.round(totalSeconds(clips) / 60));
const scenesIn = (clips: Pick<ClipRef, 'sceneId'>[]) => new Set(clips.map(c => c.sceneId)).size;
const sentence = (x: string) => (/[.?!…]$/.test(x) ? x : x + '.');

/** five titles, one per style, each with the part number when the group is split. ≤ 100 characters, keyword in it, no stray numbers. */
export function writeLongTitles(i: LongTextInput): LongTitle[] {
  const t = topicOf(i.group), r = rng(hash32(`long|${i.group}|${i.part}|${i.seed}`));
  const vars = { n: String(i.clips.length), min: String(minutesOf(i.clips)), scenes: String(scenesIn(i.clips)) };
  const suffix = i.parts > 1 ? ` — Part ${i.part}` : '';
  return TITLE_STYLES.map(style => {
    const options = t.titles[style].map(x => fill(x, vars)).filter((x): x is string => !!x && (x + suffix).length <= LIMITS.title);
    const text = (options.length ? options[Math.floor(r() * options.length)] : fill(t.titles.number[0], vars)!) + suffix;
    return { text, style, label: TITLE_STYLE_LABEL[style] };
  });
}

/** the description: the hook and keyword first, what the viewer sees, a note on flashes, the chapter list, one question, one calm subscribe line */
export function writeLongDescription(i: LongTextInput, title: string): string {
  const t = topicOf(i.group), n = i.clips.length, min = minutesOf(i.clips);
  const lines = [
    `${sentence(stripEmoji(title))} ${t.lead}`, '',
    `${n} simulations, about ${min} minutes. ${t.mechanic.join(' ')}`, '',
    'Everything on screen is a real 2D simulation with exact, repeatable maths: same settings, same result. Every sound is made by the simulation itself: collisions play the notes, with no voice and no music track.',
    'Photosensitivity note: this video contains flashes of light and quick colour changes.', '',
    'Chapters:', ...chapterLines(i.clips), '',
    'Which one was your favourite? Tell me its number in the comments.',
    'New simulations every week. Subscribe if you like this kind of thing.',
  ];
  return lines.join('\n');
}
export function writeLongTags(group: string): string[] {
  const t = topicOf(group), out: string[] = [], seen = new Set<string>();
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
  for (const tag of parseTags([t.keyword, ...t.tags, 'simulation compilation', 'physics simulation', 'math visualization', 'science'])) {
    const k = norm(tag); if (!k || seen.has(k)) continue;
    if (tagsLength([...out, tag]) > LIMITS.tags - 40) break; seen.add(k); out.push(tag);
  }
  return out;
}
/** three hashtags; never #Shorts (this is a long video) */
export const writeLongHashtags = (group: string) => parseHashtags([...topicOf(group).hash, '#simulation', '#science']).filter(h => h.toLowerCase() !== '#shorts').slice(0, 3);

export function writeLongTexts(i: LongTextInput): LongTexts {
  const titles = writeLongTitles(i), first = titles[hash32(`long-pick|${i.group}|${i.part}|${i.seed}`) % titles.length];
  return { title: first.text, titles, description: writeLongDescription(i, first.text), tags: writeLongTags(i.group), hashtags: writeLongHashtags(i.group), thumbText: topicOf(i.group).thumb, thumbNumber: i.clips.length };
}

// ---------------- checker ----------------
export type Severity = 'error' | 'warn';
export interface LongIssue { code: string; severity: Severity; text: string }
export interface LongCheckInput { group: string; title: string; description: string; tags: string[]; hashtags: string[]; clips: Pick<ClipRef, 'frames' | 'label' | 'sceneId'>[]; part?: number; parts?: number }
const words = (x: string) => x.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const EMOJI_G = /\p{Extended_Pictographic}/gu;

/** Everything that could make the texts wrong or misleading, in plain words. The numbers must be the ones of THIS video. */
export function checkLongTexts(c: LongCheckInput): LongIssue[] {
  const out: LongIssue[] = [], add = (code: string, severity: Severity, text: string) => { out.push({ code, severity, text }); };
  const t = topicOf(c.group), n = c.clips.length, dur = totalSeconds(c.clips), min = Math.round(dur / 60);
  const title = c.title.trim(), desc = c.description.trim();
  if (!title) add('title-empty', 'error', 'The title is empty.');
  if (title.length > LIMITS.title) add('title-long', 'error', `The title is ${title.length} characters; YouTube accepts ${LIMITS.title}.`);
  if (utf8Bytes(desc) > LIMITS.description) add('desc-long', 'error', `The description is ${utf8Bytes(desc)} bytes; YouTube accepts ${LIMITS.description}.`);
  if (tagsLength(c.tags) > LIMITS.tags) add('tags-long', 'error', `Tags are ${tagsLength(c.tags)} characters; YouTube accepts ${LIMITS.tags}.`);
  if (/[<>]/.test(title + desc + c.tags.join(''))) add('angle', 'error', 'YouTube does not accept < or > in the title, description or tags.');
  const has = (x: string, list: string[]) => list.some(k => x.toLowerCase().includes(k));
  if (title && !has(title, t.keywords)) add('title-keyword', 'warn', `The title does not contain the main keyword (${t.keyword}).`);
  if (desc && !has(desc.split('\n')[0] ?? '', t.keywords)) add('desc-keyword', 'warn', `The first line of the description does not contain the main keyword (${t.keyword}).`);
  if (title && (title.match(/\b[A-Z]{4,}\b/g) ?? []).length >= 2) add('title-caps', 'warn', 'Several words in ALL CAPS read as shouting.');
  if (/[!?]{2,}/.test(title) || (title.match(/!/g) ?? []).length > 1) add('title-punct', 'warn', 'Repeated ! or ? marks look like bait.');
  if ((title.match(EMOJI_G) ?? []).length > 2) add('title-emoji', 'warn', 'More than two emoji in the title.');
  for (const [re, what] of CLICKBAIT) { const m = re.exec(`${title}\n${desc}`); if (m) add('clickbait', 'warn', `"${m[0]}" is ${what}. These are simulations: describe what they show, not a promise.`); }
  const vocab = new Set(t.vocab.map(w => w.toLowerCase())), seen = new Set<string>(), all = `${title}\n${desc}\n${c.tags.join(' ')}`;
  for (const [name, re] of Object.entries(CLAIM_TERMS)) { const m = re.exec(all); if (!m || seen.has(name)) continue; seen.add(name); if (!words(m[0]).some(w => vocab.has(w))) add('claim', 'warn', `The texts mention "${m[0]}", but these videos do not show that.`); }
  // numbers: only the clip count, the minutes, the part, the number of kinds, and the chapter numbers 1..n are facts of this video
  const allowed = new Set<number>([1, n, min, c.part ?? 1, c.parts ?? 1, scenesIn(c.clips)]); for (let k = 1; k <= n; k++) allowed.add(k);
  const body = desc.split('\n').filter(l => !/^(?:\d+:)?\d{1,2}:\d{2}\s/.test(l)).join('\n');
  const bad = [...new Set(numbersIn(stripEmoji(`${title}\n${body}`).replace(/\b\d+\s?D\b/gi, '').replace(/#\w+/g, '')).filter(x => !allowed.has(x)))];
  if (bad.length) add('number', 'warn', `The texts use ${bad.length === 1 ? 'the number' : 'the numbers'} ${bad.join(', ')}, which ${bad.length === 1 ? 'is' : 'are'} not a fact of this video.`);
  const said = /(\d+) simulations?, about (\d+) minutes?/.exec(desc);
  if (!said) add('facts-line', 'warn', 'The description has no "N simulations, about M minutes" line.');
  else {
    if (+said[1] !== n) add('count', 'error', `The description says ${said[1]} simulations, but this video has ${n}.`);
    if (Math.abs(+said[2] - dur / 60) > 0.75) add('minutes', 'error', `The description says about ${said[2]} minutes, but this video is ${(dur / 60).toFixed(1)} minutes long.`);
  }
  for (const p of chapterProblems(desc, dur)) add('chapters', 'error', p);
  const expected = chapterLines(c.clips), got = desc.split('\n').filter(l => /^(?:\d+:)?\d{1,2}:\d{2}\s/.test(l));
  if (got.length === expected.length && got.some((l, i) => l !== expected[i])) add('chapters-time', 'warn', 'The chapter times in the description differ from the real clip lengths. Use "Write the texts again" to refresh them.');
  if (c.hashtags.some(h => h.toLowerCase() === '#shorts')) add('hashtag-shorts', 'error', 'The hashtag #Shorts must not be on a long video.');
  if (c.hashtags.length > 3) add('hashtags-many', 'warn', 'YouTube shows only the first three hashtags.');
  if ((desc.match(/subscribe/gi) ?? []).length > 1) add('desc-cta', 'warn', 'The description asks to subscribe more than once.');
  const twins = new Set<string>(); for (const tg of c.tags) { const k = tg.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, ''); if (twins.has(k)) { add('tags-duplicate', 'warn', `Duplicate tag "${tg}".`); break; } twins.add(k); }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
