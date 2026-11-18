// Title / description / tag writer, the quality checker, and the thumbnail logic (best frame, hook text, layout, drawing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../apps/server/host.ts';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { SCENES } from '../packages/scenes/index.ts';
import { themeIds, getTheme } from '../packages/theme/index.ts';
import { LIMITS, utf8Bytes, tagsLength, type Video } from '../packages/publish/index.ts';
import { stripEmoji } from '../packages/publish/copywriter.ts';
import { newVideoFor, suggestFor, topicFor, factsFor, descriptionFor } from '../packages/publish/describe.ts';
import { checkQuality, type QualityIssue } from '../packages/publish/quality.ts';
import { TOPICS, TITLE_STYLES } from '../packages/publish/topics.ts';
import { pickBestFrame, coverText, sampleTimes, climaxSecFor, COVER_TALL, COVER_WIDE, overlaps, COVER_TEXT_MAX, type FrameStat } from '../packages/publish/cover.ts';
import { drawCovers, analyseVideo, makeCovers } from '../apps/server/cover.ts';

/** every real configuration worth writing for: each scene, each rule/mode/layout, a few seeds and styles */
const CASES: { id: string; params: Record<string, unknown> }[] = [];
for (const s of SCENES) CASES.push({ id: s.meta.id, params: {} });
for (const rule of ['split', 'box', 'survive']) for (const seed of [1, 7, 12]) CASES.push({ id: 'hammer-smash', params: { rule, seed, startBalls: seed === 1 ? 1 : 5, splitInto: 2 + (seed % 3) } });
for (const mode of ['orbits', 'lid', 'slider', 'close']) for (const seed of [3, 7]) CASES.push({ id: 'sync-lines', params: { mode, seed, count: 8 + seed } });
for (const layout of ['ellipse', 'peanut', 'parabola', 'corner', 'cassegrain', 'gregorian']) CASES.push({ id: 'focal-reflection', params: { layout } });
for (const table of ['circle', 'triangle', 'square']) CASES.push({ id: 'billiard', params: { table } });
const styles = themeIds();
const stem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
const ctxOf = (id: string, params: Record<string, unknown>) => ({ topic: topicFor(id, params), facts: factsFor(id, params) });
const bad = (issues: QualityIssue[]) => issues.filter(i => i.severity !== 'info');

// ---------------- titles ----------------
test('five titles per video: different styles, ≤ 100 characters, the keyword in each, only numbers the video has', () => {
  for (const c of CASES) for (const style of [styles[0], styles[styles.length - 1]]) {
    const p = { ...c.params, style }, s = suggestFor(c.id, p)!, ctx = ctxOf(c.id, p), tag = `${c.id} ${JSON.stringify(c.params)} ${style}`;
    assert.equal(s.titles!.length, 5, `${tag}: five titles`);
    assert.ok(new Set(s.titles!.map(t => t.style)).size >= 4, `${tag}: at least four different styles`);
    assert.ok(new Set(s.titles!.map(t => t.text.toLowerCase())).size === 5, `${tag}: all different`);
    for (const t of s.titles!) {
      assert.ok(t.text.length > 10 && t.text.length <= LIMITS.title, `${tag}: length of "${t.text}"`);
      assert.ok(ctx.topic.keywords.some(k => t.text.toLowerCase().includes(k)), `${tag}: keyword in "${t.text}"`);
      assert.ok(!/[<>]/.test(t.text) && !/\{|\}/.test(t.text), `${tag}: clean "${t.text}"`);
      assert.equal(t.text.charAt(0), t.text.charAt(0).toUpperCase(), `${tag}: capital first letter`);
    }
    assert.ok(s.titles!.some(t => t.style === 'question' && t.text.includes('?')), `${tag}: a real question`);
  }
});

test('the titles use the scene parameters: balls, rows, ratios, rule', () => {
  const g = suggestFor('galton-board', { balls: 777, rows: 9 })!.titles!.map(t => t.text).join(' | ');
  assert.match(g, /777/); assert.match(g, /\b9\b/);
  const h = suggestFor('hammer-smash', { rule: 'split', splitInto: 4, container: 'circle' })!.titles!.map(t => t.text).join(' | ');
  assert.match(h, /\b4\b/); assert.match(h, /circle/);
  const o = suggestFor('resonance-orbits', { inner: 7, outer: 3 })!.titles!.map(t => t.text).join(' | ');
  assert.match(o, /7:3|7 : 3|7 orbits/); assert.match(o, /\b4 petals/, 'petals = |inner − outer|, as the video says');
  assert.match(suggestFor('sync-lines', { mode: 'lid', count: 21 })!.titles!.map(t => t.text).join(' | '), /21/);
  assert.notDeepEqual(suggestFor('hammer-smash', { rule: 'box' })!.titles, suggestFor('hammer-smash', { rule: 'survive' })!.titles, 'each rule tells its own story');
  assert.equal(factsFor('resonance-orbits', { inner: 13, outer: 8 }).vars.petals, '5');
  assert.equal(factsFor('rosette-orbit', { precessDeg: 10 }).vars.turns, '36');
});

test('every title variant written in topics.ts contains its topic keyword and fits 100 characters', () => {
  const filled = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => (k === 's' ? '' : 'seven'));
  for (const [key, t] of Object.entries(TOPICS)) {
    for (const st of TITLE_STYLES) for (const v of t.titles[st]) { assert.ok(t.keywords.some(k => filled(v).toLowerCase().includes(k)), `${key}/${st}: "${v}"`); assert.ok(filled(v).length <= 90, `${key}: too long "${v}"`); }
    assert.ok(t.keywords.some(k => filled(t.lead).toLowerCase().includes(k)), `${key}: lead has the keyword`);
  }
});

// ---------------- description ----------------
test('description: keyword and hook in the first line, ≤ 5000 bytes, three hashtags with #Shorts, one calm subscribe line', () => {
  for (const c of CASES) {
    const p = { ...c.params, style: styles[1] }, s = suggestFor(c.id, p)!, ctx = ctxOf(c.id, p), tag = `${c.id} ${JSON.stringify(c.params)}`;
    const first = s.description.split('\n')[0];
    assert.ok(ctx.topic.keywords.some(k => first.toLowerCase().includes(k)), `${tag}: keyword in the first line: ${first}`);
    assert.ok(first.toLowerCase().includes(stripEmoji(s.title).replace(/[.?!]$/, '').toLowerCase()), `${tag}: the hook (the title) opens the description`);
    assert.ok(utf8Bytes(s.description) <= LIMITS.description && s.description.length > 150, `${tag}: size`);
    assert.equal(s.hashtags.length, 3, `${tag}: three hashtags`);
    assert.ok(s.hashtags.includes('#Shorts') && s.hashtags[0] === '#Shorts');
    assert.ok((s.description.match(/subscribe/gi) ?? []).length === 1, `${tag}: exactly one subscribe line`);
    assert.ok(!/[<>]/.test(s.description) && !/\{|\}|undefined|NaN/.test(s.description), `${tag}: no leftovers`);
  }
});

test('descriptions are not all the same: layouts and wording vary between videos, and "another description" changes it', () => {
  const layout = (d: string) => (/^The setup:/m.test(d) ? 'setup' : /^What you are watching:/m.test(d) ? 'watch' : d.split('\n\n').length >= 5 ? 'plain' : 'short');
  const seen = new Set<string>(), texts = new Set<string>();
  for (const c of CASES) for (const style of styles) { const d = suggestFor(c.id, { ...c.params, style })!.description; seen.add(layout(d)); texts.add(d); }
  assert.ok(seen.size >= 3, `layouts used: ${[...seen]}`);
  const hammer = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(seed => suggestFor('hammer-smash', { seed })!.description));
  assert.ok(hammer.size >= 4, `ten seeds of one scene give ${hammer.size} different descriptions`);
  const title = suggestFor('galton-board', {})!.title;
  const variants = new Set([0, 1, 2, 3, 4, 5].map(n => descriptionFor('galton-board', {}, title, n)));
  assert.ok(variants.size >= 3, 'variants differ');
  for (const d of variants) assert.ok(d!.startsWith(stripEmoji(title).replace(/[.?!]$/, '')), 'the owner\'s title stays the hook');
  assert.equal(descriptionFor('nope', {}, 'x', 1), null);
});

// ---------------- tags ----------------
test('tags: relevant, no duplicates (also not plural twins), under 500 characters, headroom kept', () => {
  for (const c of CASES) for (const style of styles) {
    const s = suggestFor(c.id, { ...c.params, style })!, ctx = ctxOf(c.id, c.params);
    assert.ok(s.tags.length >= 5 && s.tags.length <= 25, `${c.id}: ${s.tags.length} tags`);
    assert.ok(tagsLength(s.tags) <= LIMITS.tags - 30, `${c.id}/${style}: ${tagsLength(s.tags)} characters`);
    assert.equal(new Set(s.tags.map(stem)).size, s.tags.length, `${c.id}: duplicate tags in ${s.tags}`);
    assert.ok(s.tags.some(t => ctx.topic.keywords.some(k => t.toLowerCase().includes(k))), `${c.id}: keyword among the tags`);
    assert.ok(s.tags.includes(getTheme(style).name.toLowerCase()), 'style name tag kept (older behaviour)');
  }
});

// ---------------- deterministic ----------------
test('deterministic: the same video always gets the same texts; another seed or style can change them', () => {
  for (const c of CASES.slice(0, 12)) assert.deepEqual(suggestFor(c.id, c.params), suggestFor(c.id, c.params), c.id);
  const a = suggestFor('hammer-smash', { seed: 1 })!, b = suggestFor('hammer-smash', { seed: 1 })!, c2 = suggestFor('hammer-smash', { seed: 2, style: styles[2] })!;
  assert.deepEqual(a, b);
  assert.ok(a.title !== c2.title || a.description !== c2.description, 'a different video reads differently');
  assert.deepEqual(newVideoFor('galton-board', {}, {}, new Date(0))!.title, newVideoFor('galton-board', {}, {}, new Date(99999))!.title, 'time does not change the text');
});

test('everything the writer produces passes its own checker: nothing to fix, nothing to check', () => {
  for (const c of CASES) for (const style of styles) {
    const v = newVideoFor(c.id, { ...c.params, style })!, issues = bad(checkQuality(v, ctxOf(c.id, { ...c.params, style })));
    assert.deepEqual(issues, [], `${c.id} ${JSON.stringify(c.params)} ${style}: ${issues.map(i => i.text).join(' / ')}`);
    for (const t of suggestFor(c.id, { ...c.params, style })!.titles!) {
      const other = { ...v, title: t.text }, is = bad(checkQuality(other, ctxOf(c.id, { ...c.params, style })));
      assert.deepEqual(is, [], `title "${t.text}": ${is.map(i => i.text)}`);
    }
  }
  for (const key of Object.keys(TOPICS)) { const t = TOPICS[key]; for (const st of TITLE_STYLES) assert.equal(t.titles[st].length, 2, `${key}/${st}`); assert.ok(t.keywords.includes(t.keyword) || t.keywords.some(k => t.keyword.includes(k))); }
});

// ---------------- checker ----------------
const base = (over: Partial<Video> = {}) => ({ ...newVideoFor('galton-board', {})!, ...over });
const ctx = ctxOf('galton-board', {});
const codes = (v: Video, extra = {}) => checkQuality(v, { ...ctx, ...extra }).map(i => i.code);
test('checker: YouTube limits are errors', () => {
  const long = checkQuality(base({ title: 'a bell curve '.repeat(10) }), ctx);
  assert.ok(long.some(i => i.severity === 'error' && i.field === 'title' && /characters/.test(i.text)));
  const d = checkQuality(base({ description: 'bell curve ' + 'é'.repeat(2600) }), ctx);
  assert.ok(d.some(i => i.severity === 'error' && i.field === 'description' && /bytes/.test(i.text)), 'bytes, not characters');
  const tg = checkQuality(base({ tags: Array.from({ length: 90 }, (_, i) => 'bell curve ' + i) }), ctx);
  assert.ok(tg.some(i => i.severity === 'error' && i.field === 'tags'));
  assert.ok(checkQuality(base({ title: 'bell <b>curve' }), ctx).some(i => i.severity === 'error'), 'angle brackets');
  assert.ok(codes(base({ title: '' })).includes('limit'));
});
test('checker: duplicate tags (any case, singular/plural) and missing keyword', () => {
  const t = checkQuality(base({ tags: ['bell curve', 'Bell Curve', 'ball', 'balls', 'physics'] }), ctx).find(i => i.code === 'tags-duplicate')!;
  assert.ok(t && /Bell Curve|bell curve/.test(t.text) && /ball/.test(t.text));
  assert.ok(codes(base({ tags: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] })).includes('tags-keyword'));
  assert.ok(codes(base({ title: 'Watch this simulation' })).includes('title-keyword'));
  assert.ok(codes(base({ description: 'A nice video.\n\nSubscribe.' })).includes('desc-keyword'));
  assert.ok(!codes(base()).includes('title-keyword'));
  assert.ok(codes(base({ tags: ['a', 'b'] })).includes('tags-few'));
  assert.ok(codes(base({ description: '' })).includes('desc-empty'));
});
test('checker: misleading titles and descriptions get a clear warning', () => {
  for (const title of ['You won\'t believe this bell curve', 'Insane bell curve!!', 'The impossible bell curve', '100% proof that chance draws a bell curve', 'BELL CURVE FROM CHANCE ALONE']) {
    assert.ok(bad(checkQuality(base({ title }), ctx)).length > 0, title);
  }
  const claim = checkQuality(base({ title: 'A black hole made of balls: bell curve' }), ctx).find(i => i.code === 'claim')!;
  assert.ok(claim && /black hole/i.test(claim.text) && claim.severity === 'warn');
  assert.ok(codes(base({ description: 'Real bell curve in 3D with fireworks.\nSubscribe' })).includes('claim'));
  const topicOrbits = ctxOf('resonance-orbits', {});
  assert.ok(!checkQuality(base({ title: 'Orbital resonance: planets in orbit' }), { ...topicOrbits }).some(i => i.code === 'claim'), 'a claim the video backs up is fine');
  const n = checkQuality(base({ title: '100000 balls make a bell curve' }), ctx).find(i => i.code === 'number')!;
  assert.ok(n && /100000/.test(n.text), 'a number that is not in the video');
  assert.ok(!codes(base({ title: '520 balls make a bell curve' })).includes('number'), 'a number that is in the video is fine');
  assert.ok(codes(base({ description: 'bell curve. Subscribe now and subscribe again!' })).includes('desc-cta'));
  assert.ok(codes(base({ title: base().title }), { otherTitles: [base().title.toUpperCase()] }).includes('title-duplicate'));
});
test('checker: hashtags, severity order, never throws on odd input', () => {
  assert.ok(codes(base({ hashtags: ['#math'] })).includes('hashtags-shorts'));
  assert.ok(codes(base({ hashtags: ['#Shorts', '#a', '#b', '#c', '#d'] })).includes('hashtags-many'));
  const issues = checkQuality(base({ title: 'x'.repeat(130), tags: ['a'], hashtags: [] }), ctx), rank = { error: 0, warn: 1, info: 2 };
  assert.deepEqual(issues.map(i => rank[i.severity]), issues.map(i => rank[i.severity]).sort(), 'errors first');
  assert.doesNotThrow(() => checkQuality(base({ title: '', description: '', tags: [], hashtags: [] })));
  assert.doesNotThrow(() => checkQuality({ ...base(), params: {} }, {}));
});

// ---------------- thumbnail logic ----------------
test('best frame: busy and close to the climax, never the empty start; deterministic', () => {
  const dur = 30, mk = (f: (t: number) => [number, number]): FrameStat[] => sampleTimes(dur).map(t => { const [detail, ink] = f(t); return { t, detail, ink }; });
  const growing = mk(t => [t, t / 3]), pick = pickBestFrame(growing, dur)!;
  assert.ok(pick.t > dur * 0.6 && pick.t <= dur * 0.985, `late busy frame, got ${pick.t}`);
  assert.deepEqual(pickBestFrame(growing, dur), pick, 'same input, same answer');
  const earlyBusy = mk(t => (t < 2.5 ? [90, 0.9] : [10, 0.1]));
  assert.ok(pickBestFrame(earlyBusy, dur)!.t >= dur * 0.1, 'never from the first 10 %');
  const spike = mk(t => (Math.abs(t - 18) < 0.5 ? [100, 1] : [30, 0.3])), withClimax = pickBestFrame(spike, dur, 18.5)!;
  assert.ok(Math.abs(withClimax.t - 18) < 1.5, `the scene's own climax moment wins: ${withClimax.t}`);
  assert.equal(pickBestFrame([], dur), null); assert.equal(pickBestFrame(growing, 0), null);
  assert.equal(pickBestFrame([{ t: 99, detail: 1, ink: 1 }], dur), null, 'times outside the video are ignored');
  assert.equal(climaxSecFor('galton-board', { finalAt: 27 }), 27); assert.equal(climaxSecFor('hammer-smash', { finalAt: 3 }), undefined); assert.equal(climaxSecFor('pendulum-wave', {}), undefined);
  const st = sampleTimes(20, 10); assert.equal(st.length, 10); assert.ok(st[0] >= 2 && st[9] <= 20 && st.every((t, i) => !i || t > st[i - 1]));
});
test('hook text: short, no emoji or hashtags, a question stays whole, long ones are cut at a word', () => {
  assert.equal(coverText('Will they all come back? 🔦 #physics'), 'Will they all come back?');
  assert.equal(coverText('Every smash turns a ball into 3\nHow full can it get?'), 'How full can it get?', 'the question line of a two-line hook');
  assert.equal(coverText('', 'A fallback title'), 'A fallback title');
  const long = coverText('Chain reaction explained: one ball becomes 3 per smash and then it keeps on going and going');
  assert.ok(long.length <= COVER_TEXT_MAX && long.endsWith('…') && !/\s…$/.test(long), long);
  assert.equal(coverText(''), ''); assert.equal(coverText('🔥🔥'), '');
  for (const c of CASES) { const s = suggestFor(c.id, c.params)!; assert.ok(coverText(s.title).length > 3 && coverText(s.title).length <= COVER_TEXT_MAX, `${c.id}: "${coverText(s.title)}"`); }
});
test('cover layouts keep the text out of YouTube\'s own buttons and text', () => {
  for (const z of COVER_TALL.unsafe) assert.ok(!overlaps(COVER_TALL.text, z), 'tall text zone is safe');
  for (const z of COVER_WIDE.unsafe) { assert.ok(!overlaps(COVER_WIDE.text, z) && !overlaps(COVER_WIDE.panel, z), 'wide layout is safe'); }
  assert.ok(COVER_TALL.text.x + COVER_TALL.text.w <= COVER_TALL.w && COVER_TALL.text.y + COVER_TALL.text.h <= COVER_TALL.scrimBottom);
  assert.ok(COVER_WIDE.text.x + COVER_WIDE.text.w <= COVER_WIDE.panel.x, 'text and picture do not overlap');
});

test('drawing: both pictures have the right size, are small enough for YouTube, use the video\'s style, and the text changes them', async () => {
  const c = createCanvas(1080, 1920), x = c.getContext('2d'); x.fillStyle = '#05060f'; x.fillRect(0, 0, 1080, 1920);
  for (let i = 0; i < 300; i++) { x.fillStyle = `hsl(${i * 7},90%,60%)`; x.beginPath(); x.arc(200 + ((i * 97) % 700), 600 + ((i * 53) % 700), 14, 0, 7); x.fill(); }
  const png = c.toBuffer('image/png');
  for (const style of styles) {
    const { thumb, cover } = await drawCovers(png, 'Will every ball score a point?', getTheme(style));
    const t = await loadImage(thumb), v = await loadImage(cover);
    assert.deepEqual([t.width, t.height], [1280, 720]); assert.deepEqual([v.width, v.height], [1080, 1920]);
    assert.ok(thumb.length < 2e6 && cover.length < 2e6, `${style}: ${thumb.length}/${cover.length} bytes (YouTube accepts 2 MB)`);
    assert.equal(thumb[0], 0xff); assert.equal(thumb[1], 0xd8, 'JPEG');
  }
  const a = await drawCovers(png, 'Will every ball score a point?', getTheme('classic')), b = await drawCovers(png, '', getTheme('classic'));
  assert.ok(!a.cover.equals(b.cover) && !a.thumb.equals(b.thumb), 'the hook text is drawn');
  const classic = await drawCovers(png, 'Same text', getTheme(styles[0])), other = await drawCovers(png, 'Same text', getTheme(styles[styles.length - 1]));
  assert.ok(!classic.thumb.equals(other.thumb), 'colours come from the style');
  const again = await drawCovers(png, 'Will every ball score a point?', getTheme('classic'));
  assert.ok(a.cover.equals(again.cover) && a.thumb.equals(again.thumb), 'deterministic');
});

test('a real MP4: the frame is picked automatically (same pick twice), and both files are written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-')), mp4 = path.join(dir, 't.mp4');
  // a clip that fills up: a growing box of noise-free colour on black, 8 s, tall
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=216x384:r=10:d=8', '-vf', "drawbox=x=0:y=0:w=216:h='384*(1-t/8)':color=black@1:t=fill", '-pix_fmt', 'yuv420p', mp4]);
  assert.equal(r.status, 0, String(r.stderr));
  const a = await analyseVideo(mp4, 8), b = await analyseVideo(mp4, 8);
  assert.ok(a.pick && a.pick.t >= 0.8 && a.pick.t <= 8, `pick ${a.pick?.t}`);
  assert.deepEqual(a.pick, b.pick, 'repeatable');
  assert.ok(a.stats.length >= 30 && a.stats.every(s => s.detail >= 0 && s.ink >= 0 && s.ink <= 1));
  const out = path.join(dir, 'out'), res = await makeCovers({ mp4, id: 'v1', outDir: out, theme: getTheme('classic'), text: 'A test question?', durationSec: 8 });
  assert.deepEqual([res.thumbFile, res.coverFile], ['v1.jpg', 'v1-cover.jpg']);
  const t = await loadImage(fs.readFileSync(path.join(out, res.thumbFile))); assert.equal(t.width, 1280);
  const manual = await makeCovers({ mp4, id: 'v2', outDir: out, theme: getTheme('classic'), text: '', t: 2 });
  assert.equal(manual.t, 2); assert.equal(manual.reason, 'the frame you chose');
  await assert.rejects(() => makeCovers({ mp4: path.join(dir, 'missing.mp4'), id: 'v3', outDir: out, theme: getTheme('classic'), text: 'x', t: 1 }), /ffmpeg failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});
