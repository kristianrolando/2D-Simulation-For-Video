// Upload the next planned slots of data/schedule.json through the RUNNING studio's own upload path (check → upload with its consent key).
// One at a time, stops at the first problem, never retries, never a second insert: a slot is marked `uploading` BEFORE the upload starts,
// and a slot that is uploading/failed is reconciled from the studio's record, never sent again. Only run after the owner approved the plan.
//   node tools/schedule-run.ts --count 1            upload the next 1 planned slot of data/schedule.json (Photon Lab's plan, as before)
//   node tools/schedule-run.ts --count 15           the next 15
//   node tools/schedule-run.ts                      only bring the plan up to date with the studio's records (nothing is uploaded)
// Channels: each channel has its own plan (tools/schedule-plan.ts --channel). Without --channel this tool only ever uses data/schedule.json,
// which is Photon Lab's plan (the file says so, or it is the plan from before channels existed): it never guesses another channel.
//   node tools/schedule-run.ts --channel "Plasma Pendulum"                    reconcile that channel's plan
//   node tools/schedule-run.ts --channel "Plasma Pendulum" --count 3          dry run: shows the next 3, uploads nothing
//   node tools/schedule-run.ts --channel "Plasma Pendulum" --count 3 --yes    upload them (only if "Upload from Sim Studio" is on for it)
// It stops before sending anything when the channel is not connected, its uploads are switched off, or YouTube said "upload limit"
// for THAT channel in the last 24 hours (other channels are not affected). The daily quota is shared by all channels.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextToUpload, markSlot, planFileFor, planChannel, videoOnChannel, limitHold, LEGACY_PLAN_CHANNEL, type SchedulePlan } from '../packages/publish/schedule.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k: string, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://127.0.0.1:5180'), COUNT = Number(opt('--count', '0')), CH_ARG = opt('--channel').trim();
const DATA = process.env.SIM_DATA_DIR ?? path.join(ROOT, 'data');
const stop = (why: string): never => { console.error(why); process.exit(2); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function api(p: string, init?: RequestInit) { const r = await fetch(BASE + p, { ...init, headers: { 'content-type': 'application/json' } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p}: ${r.status} ${j.error ?? ''}`); return j as any; }
const read = (): SchedulePlan => JSON.parse(fs.readFileSync(PLAN, 'utf8'));
function save(p: SchedulePlan) { fs.copyFileSync(PLAN, PLAN + '.bak'); fs.writeFileSync(PLAN + '.tmp', JSON.stringify(p, null, 1)); fs.renameSync(PLAN + '.tmp', PLAN); }
const local = (iso: string) => { const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const view = async (id: string) => { const l = await api('/api/videos'); return (Array.isArray(l) ? l : l.videos).find((v: any) => v.id === id); };

/** bring the plan in line with what the studio recorded (uploading → uploaded / failed) */
async function reconcile(plan: SchedulePlan): Promise<SchedulePlan> {
  for (const s of plan.slots.filter(x => x.status === 'uploading' || x.status === 'failed')) {
    const v = await view(s.videoId), y = v?.youtube;
    if (y?.stage === 'done' && y.videoId) plan = markSlot(plan, s.videoId, 'uploaded', { youtubeId: y.videoId, error: '' });
    else if (y?.stage === 'failed' && s.status === 'uploading') plan = markSlot(plan, s.videoId, 'failed', { error: String(y.error ?? '').slice(0, 300), ...(y.videoId ? { youtubeId: y.videoId } : {}) });
  }
  save(plan); return plan;
}

const st = await api('/api/youtube');
const conns: any[] = st.connections ?? [];
// which channel: --channel (name or id), or, without it, the plan in data/schedule.json, which names its channel (or is Photon Lab's own)
const conn = CH_ARG ? conns.find(c => c.id === CH_ARG || c.name === CH_ARG) : null;
if (CH_ARG && !conn) stop(`No connected channel is called "${CH_ARG}". Connected: ${conns.map(c => c.name).join(', ') || 'none'}. Nothing was sent.`);
const CHANNEL: string = conn?.name ?? LEGACY_PLAN_CHANNEL;
const PLAN = path.join(DATA, planFileFor(CHANNEL));
if (!fs.existsSync(PLAN)) stop(CH_ARG ? `There is no plan for ${CHANNEL} (${path.basename(PLAN)}). Make one first: node tools/schedule-plan.ts --channel "${CHANNEL}" --write. Nothing was sent.`
  : 'Which channel? There is no data/schedule.json, and without --channel the tool does not guess. Run it with --channel "<name>". Nothing was sent.');
let plan = read();
if (planChannel(plan) !== CHANNEL) stop(`${path.basename(PLAN)} is the plan for ${planChannel(plan)}, not ${CHANNEL}. Nothing was sent.`);
// the plan's channel among the studio's connections: by name; the plan from before channels existed goes with the studio's first channel
const target = conn ?? conns.find(c => c.name === CHANNEL) ?? (CHANNEL === LEGACY_PLAN_CHANNEL ? conns[0] : null);
if (!target?.connected) stop(`The channel ${CHANNEL} is not connected to the studio${target?.disconnected ? ` (${target.disconnected})` : ''}. Nothing was sent.`);
console.log(`channel ${target.name} · plan ${path.basename(PLAN)} · quota today (shared by all channels): ${st.quota.units} units, ${st.quota.uploads} uploads · this channel: ${target.uploadsToday ?? 0} uploads today`);
plan = await reconcile(plan);
if (!COUNT) { console.log(JSON.stringify(plan.slots.reduce((a: Record<string, number>, s) => (a[s.status] = (a[s.status] ?? 0) + 1, a), {}))); process.exit(0); }
const held = limitHold(target.limitAt);
// a channel other than Photon Lab's old plan: a dry run unless --yes (Photon Lab's plan keeps working as it always did)
if (CH_ARG && CHANNEL !== LEGACY_PLAN_CHANNEL && !args.includes('--yes')) {
  for (const s of nextToUpload(plan, Date.now()).slice(0, COUNT)) console.log(`would upload ${s.wib} WIB ${s.videoId} ${s.sceneId}`);
  if (!target.uploadEnabled) console.log(`note: "Upload from Sim Studio" is OFF for ${target.name}; --yes would stop.`);
  if (held) console.log(`note: upload limit noted for ${target.name}; --yes would stop until ${held}.`);
  console.log('dry run: nothing was sent. Add --yes to upload these.'); process.exit(0);
}
if (!target.uploadEnabled) stop(`Uploads from Sim Studio are turned off for ${target.name}. Turn on "Upload from Sim Studio" in YouTube settings, or upload by hand. Nothing was sent.`);
if (held) stop(`YouTube said "upload limit reached" for ${target.name} at ${target.limitAt}. The studio waits until ${held} for this channel (other channels are not affected). Nothing was sent.`);
if (plan.slots.some(s => s.status === 'uploading')) throw new Error('a slot is still uploading; wait for it (or continue it in the studio). Nothing was started.');
const failed = plan.slots.filter(s => s.status === 'failed'); if (failed.length) throw new Error(`slot ${failed[0].wib} (${failed[0].videoId}) failed earlier: ${failed[0].error}. A person decides before more are sent.`);

let n = 0;
for (const s of nextToUpload(plan, Date.now()).slice(0, COUNT)) {
  const v = await view(s.videoId);
  if (!v) throw new Error(`${s.videoId} is not in the studio list`);
  if (!videoOnChannel(v, target.id, CHANNEL)) throw new Error(`${s.videoId} is marked for ${v.channel}, not ${CHANNEL}. Nothing was sent; change the plan or the video's channel.`);
  if (v.uploadedManually) { console.log(`skip ${s.videoId}: marked as uploaded by hand`); plan = markSlot(plan, s.videoId, 'uploaded', { youtubeId: '', error: 'uploaded by hand' }); save(plan); continue; }
  if (v.youtube || v.status !== 'rendered') { console.log(`skip ${s.videoId}: already ${v.status}${v.youtube ? ' with a YouTube record' : ''}`); plan = markSlot(plan, s.videoId, v.youtube?.stage === 'done' ? 'uploaded' : 'failed', { youtubeId: v.youtube?.videoId, error: 'found in the studio before the run' }); save(plan); continue; }
  const options = { mode: 'schedule', at: local(s.slot) };
  const chk = await api(`/api/videos/${s.videoId}/youtube/check`, { method: 'POST', body: JSON.stringify({ options }) });
  if (chk.problems.length) throw new Error(`${s.videoId}: ${chk.problems[0]}`);
  if (new Date(chk.publishAtLocal).toISOString() !== s.slot) throw new Error(`${s.videoId}: the studio understood another time (${chk.publishAtLocal})`);
  plan = markSlot(plan, s.videoId, 'uploading'); save(plan);                         // recorded first: a crash now never leads to a second insert
  console.log(`uploading ${s.wib} WIB ${s.videoId} ${s.sceneId}`);
  try { await api(`/api/videos/${s.videoId}/youtube/upload`, { method: 'POST', body: JSON.stringify({ options, agree: true, consent: chk.consent }) }); }
  catch (e) { plan = markSlot(plan, s.videoId, 'failed', { error: String(e).slice(0, 300) }); save(plan); throw e; }
  for (;;) {                                                                          // wait for this one to finish (upload → processing → thumbnail → done)
    await sleep(10e3); const cur = await view(s.videoId), y = cur?.youtube;
    if (y?.stage === 'done') { plan = markSlot(plan, s.videoId, 'uploaded', { youtubeId: y.videoId }); save(plan); console.log(`  done ${y.videoId} · status ${cur.status} · thumbnail ${y.thumbnail}`); break; }
    if (y?.stage === 'failed') { plan = markSlot(plan, s.videoId, 'failed', { error: String(y.error).slice(0, 300), ...(y.videoId ? { youtubeId: y.videoId } : {}) }); save(plan); throw new Error(`failed at ${y.failedAt}: ${y.error}`); }
    process.stdout.write(`\r  ${y?.stage ?? '?'} ${y?.total ? Math.round(100 * (y.sent ?? 0) / y.total) + '%' : ''}   `);
  }
  n++;
}
console.log(`finished: ${n} uploaded this run`);
