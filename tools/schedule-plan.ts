// Plan the YouTube schedule for the rendered videos (5 slots a day, WIB). Read-only on videos.json and output/; the only thing it writes is
// data/schedule.json (atomic, with one backup). It never talks to YouTube and never starts an upload.
// One plan per channel, same WIB slots for each (counted per channel). --channel is required: the tool never guesses which channel.
//   node tools/schedule-plan.ts --channel "Photon Lab"               dry run: prints the table and the skipped list (writes nothing)
//   node tools/schedule-plan.ts --channel "Photon Lab" --write       also saves the plan: Photon Lab → data/schedule.json (as before),
//                                                                    another channel → data/schedule-<name>.json (refuses to overwrite a plan
//                                                                    that already has uploads, unless --replan)
//   --channel takes the channel name or its id (UC…). Only videos marked for that channel are planned.
//   options: --seed N (default 20261119)  --now ISO (tests)  --json
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitizeVideo, uploadProblems, uploadThumbName, type Video, type FileFacts, type UploadOptions } from '../packages/publish/index.ts';
import { checkQuality } from '../packages/publish/quality.ts';
import { topicFor, factsFor } from '../packages/publish/describe.ts';
import { imageSize, isShortsRatio, THUMB_MAX_BYTES } from '../packages/publish/cover.ts';
import { buildSlots, pickBalanced, wibParts, SLOTS_WIB, planFileFor, videoOnChannel, type Cand, type SchedulePlan, type PlanSlot } from '../packages/publish/schedule.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k: string, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DATA = process.env.SIM_DATA_DIR ? path.resolve(process.env.SIM_DATA_DIR) : path.join(ROOT, 'data');
const OUT = process.env.SIM_OUT_DIR ? path.resolve(process.env.SIM_OUT_DIR) : path.join(ROOT, 'output');
const SEED = Number(opt('--seed', '20261119')), NOW = opt('--now') ? Date.parse(opt('--now')) : Date.now();
const CH_ARG = opt('--channel').trim();
if (!CH_ARG) {
  console.error('Which channel? Every channel has its own plan, so the tool does not guess. Run it again with --channel and the channel name (or id), for example:\n  node tools/schedule-plan.ts --channel "Photon Lab"\nNothing was written.');
  process.exit(2);
}

const store = JSON.parse(fs.readFileSync(path.join(DATA, 'videos.json'), 'utf8'));
const every: Video[] = store.videos.map((x: unknown) => sanitizeVideo(x)).filter((v: Video | null): v is Video => !!v);
// an id on the command line: the name comes from the videos that carry it
const CHANNEL = /^UC[\w-]{10,}$/.test(CH_ARG) ? every.find(v => v.channelId === CH_ARG)?.channel ?? CH_ARG : CH_ARG;
const PLAN = path.join(DATA, planFileFor(CHANNEL));
const all: Video[] = every.filter(v => videoOnChannel(v, CH_ARG, CHANNEL));

function probe(file: string): FileFacts {
  let st: fs.Stats; try { st = fs.statSync(file); } catch { return { exists: false, width: 0, height: 0, durationSec: 0, sizeBytes: 0, mtimeMs: 0 }; }
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  let j: any = {}; try { j = JSON.parse(r.stdout); } catch { /* unreadable */ }
  return { exists: st.size > 0, width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0, durationSec: Number(j.format?.duration) || 0, sizeBytes: st.size, mtimeMs: st.mtimeMs };
}
/** the picture the uploader would send: the tall 9:16 cover, real JPEG/PNG, ≤ 50 MB (same checks as apps/server/uploader.ts thumbToSend) */
function thumbProblem(v: Video): string {
  const name = uploadThumbName(v) ? path.basename(uploadThumbName(v)) : ''; if (!name) return 'no cover picture';
  const file = path.join(DATA, 'thumbnails', name); if (!fs.existsSync(file)) return `cover file missing (${name})`;
  const data = fs.readFileSync(file), dim = imageSize(data);
  if (!dim) return 'cover is not a JPEG/PNG'; if (data.length > THUMB_MAX_BYTES) return 'cover over 50 MB';
  if (!isShortsRatio(dim.width, dim.height)) return `cover is ${dim.width}×${dim.height}, not 9:16`;
  return '';
}

const skipped: SchedulePlan['skipped'] = [], good: { v: Video; cand: Cand }[] = [];
const dummy: UploadOptions = { mode: 'schedule', at: new Date(NOW + 86400e3).toISOString(), categoryId: '28', language: 'en', madeForKids: false, synthetic: false, notify: true };
for (const v of all) {
  if (v.status !== 'rendered' || v.youtube || v.youtubeUrl) continue;       // already on YouTube or tracked as such: untouched, not counted
  const skip = (reason: string) => skipped.push({ id: v.id, file: v.file, reason });
  if (!v.file || /\//.test(v.file) || /test/i.test(v.file) || /test/i.test(v.id)) { skip('test or nested file'); continue; }
  const f = probe(path.join(OUT, v.file));
  if (!f.exists) { skip('MP4 missing or 0 bytes'); continue; }
  const up = uploadProblems(v, f, dummy, new Date(NOW));
  if (up.length) { skip('upload check: ' + up[0]); continue; }
  const tp = thumbProblem(v); if (tp) { skip('thumbnail: ' + tp); continue; }
  const q = checkQuality(v, { topic: topicFor(v.sceneId, v.params), facts: factsFor(v.sceneId, v.params), otherTitles: all.filter(x => x.id !== v.id).map(x => x.title) }).filter(i => i.severity !== 'info');
  if (q.length) { skip('quality: ' + q.map(i => `${i.code}`).join(', ') + ' — ' + q[0].text.slice(0, 90)); continue; }
  const P = v.params as Record<string, unknown>, s = (k: string) => String(P[k] ?? '');
  const look = (v.sceneId === 'hammer-smash' || v.sceneId === 'sync-lines') ? `${v.style}/${s('container')}` : `${v.style}/${v.sceneId}`;
  const group = [v.sceneId, s('rule') || s('mode'), s('container'), s('objects')].join('|');
  const head = v.title.split(' — ')[0].replace(/[\p{Extended_Pictographic}\s]+$/gu, '').trim().toLowerCase();
  good.push({ v, cand: { id: v.id, sceneId: v.sceneId, look, group, head } });
}
const slots = buildSlots(NOW, good.length);
const { placed, reserve } = pickBalanced(good.map(g => g.cand), slots, { seed: SEED });
const byId = new Map(good.map(g => [g.v.id, g.v]));

const plan: SchedulePlan = {
  version: 1, channel: CHANNEL, createdAt: new Date(NOW).toISOString(), seed: SEED, timezone: 'WIB (UTC+7)', slotsWib: [...SLOTS_WIB], skipped,
  slots: placed.map(p => { const v = byId.get(p.cand.id)!; return { slot: new Date(p.slot).toISOString(), wib: `${wibParts(p.slot).date} ${wibParts(p.slot).time}`, videoId: v.id, sceneId: v.sceneId, title: v.title, status: 'planned', ...(p.relaxed.length ? { relaxed: p.relaxed } : {}) } as PlanSlot; }),
  reserve: reserve.map(c => ({ id: c.id, sceneId: c.sceneId, title: byId.get(c.id)!.title, reason: 'only its own scene was left to put it next to (no two videos of one scene in a row)' })),
};

if (args.includes('--json')) console.log(JSON.stringify(plan, null, 1));
else {
  const sc: Record<string, number> = {}; for (const s of plan.slots) sc[s.sceneId] = (sc[s.sceneId] ?? 0) + 1;
  console.log(`channel ${CHANNEL} → ${path.relative(ROOT, PLAN)} · now ${new Date(NOW).toISOString()} · seed ${SEED} · rendered candidates ${good.length + skipped.length} · eligible ${good.length} · skipped ${skipped.length} · scheduled ${plan.slots.length} · reserve ${plan.reserve.length}`);
  console.log('composition', JSON.stringify(sc), plan.slots.some(s => s.relaxed) ? `· relaxed rules at ${plan.slots.filter(s => s.relaxed).length} slots` : '');
  console.log(`first ${plan.slots[0]?.wib} · last ${plan.slots.at(-1)?.wib}`);
  if (args.includes('--table')) for (const s of plan.slots) console.log(`${s.wib}\t${s.videoId}\t${s.sceneId}\t${s.title}`);
}
if (args.includes('--write')) {
  const old: SchedulePlan | null = fs.existsSync(PLAN) ? JSON.parse(fs.readFileSync(PLAN, 'utf8')) : null;
  if (old?.slots.some(s => s.status !== 'planned') && !args.includes('--replan')) throw new Error(`${path.basename(PLAN)} already has uploads; refusing to overwrite it (use the runner to continue it).`);
  fs.mkdirSync(DATA, { recursive: true });
  if (old) fs.copyFileSync(PLAN, PLAN + '.bak');
  fs.writeFileSync(PLAN + '.tmp', JSON.stringify(plan, null, 1)); fs.renameSync(PLAN + '.tmp', PLAN);
  console.log('saved', path.relative(ROOT, PLAN));
}
