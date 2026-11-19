// The Plasma Pendulum batch plan (tools/batch-plan-plasma.ts): a partner for every Photon Lab video, same concept, other parameters,
// Main-2 look, own texts. And the guarantees around it: Photon Lab's plan is byte-identical, the runner can take another folder without
// touching Photon's state. Nothing here renders or talks to a studio of the owner's (a stand-in studio on a random port is used).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sceneById } from '../packages/scenes/index.ts';
import { validate } from '../packages/core/schema.ts';
import { sanitizeStylePreset, serializeStylePreset } from '../packages/theme/index.ts';
import { buildPlan } from '../tools/batch-plan.ts';
import { buildPlasmaPlan, signature, POOL, PLASMA_HANDLE } from '../tools/batch-plan-plasma.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = (x: unknown) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const photon = buildPlan(), plasma = buildPlasmaPlan();
const full = (sceneId: string, params: Record<string, unknown>) => validate(sceneById(sceneId)!.schema, params).params as Record<string, any>;

test('Photon Lab\'s plan is exactly what it was: 245 videos, same hash (the Plasma tool does not change it)', () => {
  assert.equal(photon.length, 245);
  assert.equal(sha(photon), '51bf838c52f66aeeea6a75e29d73035bd328781a2679a87cb2f752de9a8b7f72');
  assert.ok(photon.every(i => i.key.startsWith('preset:') || !i.key.startsWith('plasma:')));
});

test('the Plasma plan is deterministic: two builds give the same plan in the same order', () => {
  assert.equal(sha(buildPlasmaPlan()), sha(plasma));
});

test('one partner for every Photon video: unique "plasma:" keys, same scene, the pair named', () => {
  assert.equal(plasma.length, photon.length);
  assert.equal(new Set(plasma.map(i => i.key)).size, plasma.length);
  assert.ok(plasma.every(i => i.key === 'plasma:' + i.pairOf));
  const byKey = new Map(photon.map(i => [i.key, i]));
  assert.deepEqual([...plasma.map(i => i.pairOf)].sort(), [...photon.map(i => i.key)].sort());
  for (const i of plasma) { const p = byKey.get(i.pairOf)!; assert.equal(i.sceneId, p.sceneId); assert.equal(i.heavy, p.heavy); }
});

test('no Plasma video is the same video as a Photon video or another Plasma video (full parameters, without texts and look)', () => {
  const photonSigs = new Set(photon.map(i => signature(i.sceneId, i.params)));
  const seen = new Set<string>();
  for (const i of plasma) {
    const s = signature(i.sceneId, i.params);
    assert.ok(!photonSigs.has(s), `${i.key} equals a Photon video`);
    assert.ok(!seen.has(s), `${i.key} equals another Plasma video`); seen.add(s);
  }
  // and the pair really differs in what it shows, not only in the texts
  for (const i of plasma) { const p = photon.find(x => x.key === i.pairOf)!; assert.notEqual(signature(i.sceneId, i.params), signature(p.sceneId, p.params)); }
});

test('every item is valid for its scene, short enough, in the Main-2 look with the channel handle, and no Photon-only palette', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'style-presets/main-2.json'), 'utf8'));
  const main2 = serializeStylePreset(sanitizeStylePreset(raw).preset!);
  for (const i of plasma) {
    const sc = sceneById(i.sceneId)!, r = validate(sc.schema, i.params);
    assert.deepEqual(r.errors, [], i.key);
    const P = r.params as Record<string, any>;
    assert.ok(P.duration >= 5 && P.duration <= 180, `${i.key}: duration ${P.duration}`);
    assert.equal(P.style, 'classic'); assert.equal(P.stylePreset, main2, `${i.key}: Main-2`); assert.equal(P.handle, PLASMA_HANDLE); assert.equal(P.bgSettings, '');
    assert.equal(P.palette, 'theme', `${i.key}: the colors come from Main-2`);
    // the moments inside the video stay inside it
    for (const k of ['finalAt', 'closeAt', 'alignAt', 'endAt']) if (k in P) assert.ok(P[k] < P.duration, `${i.key}: ${k} ${P[k]} < ${P.duration}`);
  }
  assert.ok(JSON.stringify(main2).includes('#cd18ff'), 'the preset is the owner\'s Main-2 (purple wall)');
});

test('on-screen titles: US English, at most two lines of 32 characters (so they are not shrunk), none equal to a Photon title', () => {
  const photonTexts = new Set<string>();
  for (const i of photon) {
    const sc = sceneById(i.sceneId)!, P = full(i.sceneId, i.params);
    const t = String(P.title ?? '').trim(); if (t) photonTexts.add(t.toLowerCase());
    if (sc.hook) photonTexts.add(String(sc.hook(P)).toLowerCase());
  }
  for (const i of plasma) {
    const t = String(i.params.title ?? ''); assert.ok(t.trim(), `${i.key}: has a title`);
    const lines = t.split('\n'); assert.ok(lines.length <= 2, `${i.key}: ${lines.length} lines`);
    for (const l of lines) assert.ok(l.length <= 32, `${i.key}: line too long (${l.length}): ${l}`);
    assert.ok(!photonTexts.has(t.toLowerCase()), `${i.key}: same title as a Photon video: ${t}`);
    assert.ok(!/centre|colour|favour|behaviour|programme/i.test(t + String(i.params.answer ?? '')), `${i.key}: UK spelling`);
  }
  // worst case of the pools (the longest value each placeholder can take)
  const worst = { k: '4', shape: 'triangle', n0: '12', n: '20', r: '√2' };
  for (const [name, list] of Object.entries(POOL)) for (const s of list) for (const l of s.replace(/\{(\w+)\}/g, (_, k) => (worst as Record<string, string>)[k] ?? '').split('\n')) assert.ok(l.length <= 32, `${name}: "${l}" is ${l.length} characters`);
});

test('heavy videos (hammer-smash) are never side by side, and the first ten show every scene', () => {
  for (let k = 1; k < plasma.length; k++) assert.ok(!(plasma[k].heavy && plasma[k - 1].heavy), `two heavy videos at ${k}`);
  assert.equal(new Set(plasma.slice(0, 10).map(i => i.sceneId)).size, 10);
  assert.notEqual(plasma.slice(0, 40).map(i => i.pairOf).join(), photon.slice(0, 40).map(i => i.key).join(), 'another order than Photon\'s');
});

// ---------------- the runner with --dir ----------------
test('batch-run --dir uses its own plan and state; the default folder is never touched', { timeout: 60000 }, async () => {
  const A = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-batchA-')), B = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-batchB-'));
  const item = (key: string) => ({ key, sceneId: 'harmonograph', heavy: false, origin: 'variant', params: {} });
  fs.writeFileSync(path.join(A, 'plan.json'), JSON.stringify({ items: [item('photon-x')] }));       // stands in for data/batch (via SIM_BATCH_DIR)
  fs.writeFileSync(path.join(A, 'state.json'), JSON.stringify({ 'photon-x': { jobId: 'old', status: 'done', sentAt: 1, doneAt: 2 } }));
  fs.writeFileSync(path.join(B, 'plan.json'), JSON.stringify({ items: [item('plasma:one'), item('plasma:two')] }));
  const before = sha(fs.readFileSync(path.join(A, 'state.json'), 'utf8'));
  const jobs: { id: string; status: string; started: number; finished: number; size: number }[] = []; let n = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const send = (v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.url === '/api/status') return send({ app: 'sim-studio', readOnly: false, codeStale: false, running: null, queued: 0 });
      if (req.url === '/api/jobs' && req.method === 'GET') return send(jobs);
      if (req.url === '/api/jobs' && req.method === 'POST') { const j = { id: `j${++n}`, status: 'done', started: 1000, finished: 9000, size: 3e6 }; jobs.push(j); return send(j); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  try {
    const out = await new Promise<{ code: number | null; text: string }>(ok => {
      const c = spawn(process.execPath, [path.join(ROOT, 'tools/batch-run.ts'), '--dir', B, '--url', `http://127.0.0.1:${port}`, '--min-free-gb', '0', '--max-load', '1000'], { cwd: ROOT, env: { ...process.env, SIM_BATCH_DIR: A } });
      let text = ''; c.stdout.on('data', d => { text += d; }); c.stderr.on('data', d => { text += d; }); c.on('close', code => ok({ code, text }));
    });
    assert.equal(out.code, 0, out.text);
    const st = JSON.parse(fs.readFileSync(path.join(B, 'state.json'), 'utf8'));
    assert.deepEqual(Object.keys(st).sort(), ['plasma:one', 'plasma:two']); assert.equal(n, 2, 'both videos were sent');
    assert.equal(sha(fs.readFileSync(path.join(A, 'state.json'), 'utf8')), before, 'the other folder\'s state is untouched');
    assert.ok(!fs.existsSync(path.join(B, '.runner.lock')) && !fs.existsSync(path.join(A, '.runner.lock')), 'locks released');
  } finally { server.close(); fs.rmSync(A, { recursive: true, force: true }); fs.rmSync(B, { recursive: true, force: true }); }
});
