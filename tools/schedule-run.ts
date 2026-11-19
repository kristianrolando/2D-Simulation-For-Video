// Upload the next planned slots of data/schedule.json through the RUNNING studio's own upload path (check → upload with its consent key).
// One at a time, stops at the first problem, never retries, never a second insert: a slot is marked `uploading` BEFORE the upload starts,
// and a slot that is uploading/failed is reconciled from the studio's record, never sent again. Only run after the owner approved the plan.
//   node tools/schedule-run.ts --count 1            upload the next 1 planned slot (the test)
//   node tools/schedule-run.ts --count 15           the next 15
//   node tools/schedule-run.ts --reconcile          only bring the plan up to date with the studio's records
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextToUpload, markSlot, type SchedulePlan } from '../packages/publish/schedule.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k: string, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://127.0.0.1:5180'), COUNT = Number(opt('--count', '0'));
const PLAN = path.join(process.env.SIM_DATA_DIR ?? path.join(ROOT, 'data'), 'schedule.json');
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

let plan = read();
const st = await api('/api/youtube');
if (!st.connected) throw new Error('YouTube is not connected.');
console.log(`quota today: ${st.quota.units} units, ${st.quota.uploads} uploads · channel ${st.channel.name}`);
plan = await reconcile(plan);
if (!COUNT) { console.log(JSON.stringify(plan.slots.reduce((a: Record<string, number>, s) => (a[s.status] = (a[s.status] ?? 0) + 1, a), {}))); process.exit(0); }
if (plan.slots.some(s => s.status === 'uploading')) throw new Error('a slot is still uploading; wait for it (or continue it in the studio). Nothing was started.');
const failed = plan.slots.filter(s => s.status === 'failed'); if (failed.length) throw new Error(`slot ${failed[0].wib} (${failed[0].videoId}) failed earlier: ${failed[0].error}. A person decides before more are sent.`);

let n = 0;
for (const s of nextToUpload(plan, Date.now()).slice(0, COUNT)) {
  const v = await view(s.videoId);
  if (!v) throw new Error(`${s.videoId} is not in the studio list`);
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
