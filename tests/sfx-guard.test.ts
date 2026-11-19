// ElevenLabs credit guard. Fake client and fake fetch only: no network, no real credits, no real sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGeneration, loadLimits, planGeneration, readLedger, DEFAULT_LIMITS, HARD_CEILING, type Limits } from '../packages/sfx-guard/guard.ts';
import { createElevenLabsClient, ElevenLabsError, type SfxClient, type SoundRequest } from '../packages/sfx-guard/client.ts';
import { legacyHash, type Converter } from '../packages/sfx-guard/library.ts';

const KEY = 'sk_FAKEKEY0123456789abcdefFAKE';
const conv: Converter = { convert: (i, o) => fs.copyFileSync(i, o), duration: () => 0.4 };

function lib(requests: any[], samples: any[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-guard-'));
  fs.writeFileSync(path.join(dir, 'requests.json'), JSON.stringify({ model: 'eleven_text_to_sound_v2', requests }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, samples }));
  return { dir, ledgerFile: path.join(dir, 'ledger.json') };
}
const req = (id: string, prompt = `sound ${id}`, duration = 0.5) => ({ id, role: id, duration, prompt, tags: [] });

function fakeClient(o: { remaining?: number; fail?: (r: SoundRequest, n: number) => Error | null; costPerCall?: number } = {}) {
  let used = 1000; const limit = used + (o.remaining ?? 10000);
  const c = {
    generateCalls: 0, balanceCalls: 0, sent: [] as SoundRequest[],
    secrets: () => [KEY],
    async getBalance() { c.balanceCalls++; return { used, limit, remaining: limit - used, resetsAt: null }; },
    async generateSound(r: SoundRequest) {
      c.generateCalls++; c.sent.push(r);
      const err = o.fail?.(r, c.generateCalls); if (err) throw err;
      used += o.costPerCall ?? 2; return new Uint8Array([1, 2, 3]);
    },
  };
  return c satisfies SfxClient;
}
const limits = (p: Partial<Limits> = {}): Limits => ({ ...DEFAULT_LIMITS, ...p });

test('no approval: dry run lists and estimates, makes no paid call, writes no ledger', async () => {
  const l = lib([req('a'), req('b', 'b', 1)]); const c = fakeClient();
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: false, converter: conv });
  assert.equal(r.status, 'dry-run');
  assert.equal(c.generateCalls, 0);
  assert.equal(c.balanceCalls, 1, 'the balance is shown in the dry run');
  assert.equal(r.estimate, 20 + 40);
  assert.ok(!fs.existsSync(l.ledgerFile));
});

test('approved: one take per item, original kept, sample imported, ledger records estimate and actual', async () => {
  const l = lib([req('a'), req('b')]); const c = fakeClient({ costPerCall: 3 });
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: true, converter: conv });
  assert.equal(r.status, 'done'); assert.equal(c.generateCalls, 2);
  assert.ok(fs.existsSync(path.join(l.dir, 'src/a.mp3')) && fs.existsSync(path.join(l.dir, 'a.wav')));
  const man = JSON.parse(fs.readFileSync(path.join(l.dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(man.samples.map((s: any) => s.id), ['a', 'b']);
  const led = readLedger(l.ledgerFile);
  assert.deepEqual(led.entries.map(e => [e.id, e.status, e.estimate, e.actual]), [['a', 'ok', 20, 3], ['b', 'ok', 20, 3]]);
});

test('restart after success: nothing is generated again (ledger, manifest and files are each enough)', async () => {
  const l = lib([req('a')]);
  await runGeneration({ ...l, limits: limits(), client: fakeClient(), approved: true, converter: conv });
  const c2 = fakeClient();
  const r2 = await runGeneration({ ...l, limits: limits(), client: c2, approved: true, converter: conv });
  assert.equal(r2.status, 'nothing-to-do'); assert.equal(c2.generateCalls, 0);
  // even with the library wiped, the ledger still blocks a second paid call
  fs.writeFileSync(path.join(l.dir, 'manifest.json'), JSON.stringify({ version: 1, samples: [] }));
  fs.rmSync(path.join(l.dir, 'a.wav')); fs.rmSync(path.join(l.dir, 'src'), { recursive: true });
  const c3 = fakeClient();
  const r3 = await runGeneration({ ...l, limits: limits(), client: c3, approved: true, converter: conv });
  assert.equal(c3.generateCalls, 0); assert.match(r3.skipped[0].reason, /already generated/);
});

test('duplicates are refused: same prompt hash, same prompt text, existing file, repeated request', async () => {
  const old = { id: 'old', file: 'old.wav', role: 'x', duration: 0.5, prompt: 'Soft  Pop', promptHash: legacyHash('eleven_text_to_sound_v2', { prompt: 'Soft  Pop', duration: 0.5 }), source: 'elevenlabs' };
  const l = lib([req('p1', 'soft pop'), req('p2', 'Soft  Pop'), req('f'), req('d1', 'same thing'), req('d2', 'same thing')], [old]);
  fs.writeFileSync(path.join(l.dir, 'old.wav'), 'x');
  fs.mkdirSync(path.join(l.dir, 'src')); fs.writeFileSync(path.join(l.dir, 'src/f.mp3'), 'paid earlier');
  const p = planGeneration({ ...l, limits: limits() });
  assert.deepEqual(p.todo.map(t => t.id), ['d1']);
  const why = Object.fromEntries(p.skipped.map(s => [s.id, s.reason]));
  assert.match(why.p1, /same prompt/); assert.match(why.p2, /prompt hash/); assert.match(why.f, /file already exists/); assert.match(why.d2, /duplicate/);
});

test('caps: duration, calls per run, credits per run, 24 h, balance — refused before any paid call', async () => {
  const cases: [any[], Partial<Limits>, number, RegExp][] = [
    [[req('long', 'long', 5)], {}, 10000, /per-generation cap/],
    [[req('a'), req('b'), req('c'), req('d')], {}, 10000, /cap is 3 per run/],
    [[req('a', 'a', 3), req('b', 'b', 3)], {}, 10000, /per-run cap/],
    [[req('a')], { maxCreditsPer24h: 10 }, 10000, /24 h cap/],
    [[req('a')], {}, 5, /credits left/],
  ];
  for (const [rs, lim, remaining, msg] of cases) {
    const l = lib(rs); const c = fakeClient({ remaining });
    const r = await runGeneration({ ...l, limits: limits(lim), client: c, approved: true, converter: conv });
    assert.equal(r.status, 'refused', String(msg)); assert.match(r.message, msg); assert.equal(c.generateCalls, 0);
  }
  // no key: never generates
  const l = lib([req('a')]);
  const r = await runGeneration({ ...l, limits: limits(), client: null, approved: true, converter: conv });
  assert.equal(r.status, 'refused');
});

test('24 h cap counts what the ledger already spent', async () => {
  const l = lib([req('a'), req('b')]);
  await runGeneration({ ...l, limits: limits(), client: fakeClient({ costPerCall: 30 }), only: ['a'], approved: true, converter: conv });
  const c = fakeClient();
  const r = await runGeneration({ ...l, limits: limits({ maxCreditsPer24h: 40 }), client: c, approved: true, converter: conv });
  assert.equal(r.status, 'refused'); assert.equal(r.spent24h, 30); assert.equal(c.generateCalls, 0);
});

test('limits: options can only lower; config is clamped to the hard ceiling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-cfg-')), f = path.join(dir, 'g.json');
  fs.writeFileSync(f, JSON.stringify({ maxCallsPerRun: 999, maxCreditsPerRun: 80, creditsPerSecond: 0.0001 }));
  const r = loadLimits(f, { maxCreditsPerRun: 5000, maxCallsPerRun: 2, creditsPerSecond: 0.01 } as any);
  assert.equal(r.limits.maxCallsPerRun, 2);
  assert.equal(r.limits.maxCreditsPerRun, 80, 'an option cannot raise a cap');
  assert.ok(r.limits.creditsPerSecond >= 1, 'the estimate rate cannot be pushed to ~0');
  assert.equal(loadLimits(f).limits.maxCallsPerRun, HARD_CEILING.maxCallsPerRun);
  assert.deepEqual(loadLimits(path.join(dir, 'missing.json')).limits, DEFAULT_LIMITS);
});

test('failure: no retry, the run stops, the next run skips it unless --again', async () => {
  const l = lib([req('a'), req('b')]);
  const c = fakeClient({ fail: (_r, n) => n === 1 ? new ElevenLabsError(500, 'server_error', 'boom') : null });
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: true, converter: conv });
  assert.equal(r.status, 'failed'); assert.equal(c.generateCalls, 1, 'not retried, b not sent');
  assert.equal(readLedger(l.ledgerFile).entries[0].status, 'failed');
  const c2 = fakeClient();
  const r2 = await runGeneration({ ...l, limits: limits(), client: c2, approved: true, converter: conv });
  assert.deepEqual(c2.sent.map(s => s.text), ['sound b'], 'a is skipped after a failure');
  assert.match(r2.skipped.find(s => s.id === 'a')!.reason, /--again a/);
  const c3 = fakeClient();
  await runGeneration({ ...l, limits: limits(), client: c3, again: ['a'], approved: true, converter: conv });
  assert.equal(c3.generateCalls, 1);
});

test('credits exhausted: clear stop, no retry, nothing else sent', async () => {
  const l = lib([req('a'), req('b')]);
  const c = fakeClient({ fail: () => new ElevenLabsError(401, 'quota_exceeded', 'This request exceeds your quota') });
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: true, converter: conv });
  assert.equal(r.status, 'credits-exhausted'); assert.equal(c.generateCalls, 1);
  assert.match(r.message, /used up/); assert.match(r.message, /nothing on the account was changed or bought/);
});

test('a call that never finished (crash) blocks any new attempt', async () => {
  const l = lib([req('a')]);
  fs.writeFileSync(l.ledgerFile, JSON.stringify({ version: 1, note: '', entries: [{ seq: 1, at: new Date().toISOString(), id: 'a', guardHash: 'x', model: 'm', duration: 0.5, estimate: 20, actual: null, status: 'started' }] }));
  const c = fakeClient();
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: true, converter: conv });
  assert.equal(r.status, 'refused'); assert.match(r.message, /never finished/); assert.equal(c.generateCalls, 0);
});

test('cost far above the estimate stops the run', async () => {
  const l = lib([req('a'), req('b')]); const c = fakeClient({ costPerCall: 200 });
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: true, converter: conv });
  assert.equal(r.status, 'overrun'); assert.equal(c.generateCalls, 1);
});

test('the ledger never holds the API key, even when an error message carries it', async () => {
  const l = lib([req('a')]);
  const c = fakeClient({ fail: () => new Error(`bad key ${KEY} (xi-api-key: ${KEY})`) });
  const r = await runGeneration({ ...l, limits: limits(), client: c, approved: true, converter: conv });
  const text = fs.readFileSync(l.ledgerFile, 'utf8');
  assert.ok(!text.includes(KEY) && !text.includes('FAKEKEY')); assert.ok(!r.message.includes(KEY));
  assert.ok(!text.includes('sound a'), 'no prompt text either, hashes only');
});

test('real client against a fake server: one request, key only in the header, quota error recognised', async () => {
  const calls: { url: string; init: any }[] = [];
  const fakeFetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'You have 0 credits remaining' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const cl = createElevenLabsClient(KEY, fakeFetch, 'http://fake.invalid');
  await assert.rejects(cl.generateSound({ text: 't', durationSeconds: 0.5, promptInfluence: 0.3, loop: false, modelId: 'eleven_text_to_sound_v2', outputFormat: 'mp3_44100_128' }),
    (e: any) => e instanceof ElevenLabsError && e.quota && !String(e.message).includes(KEY));
  assert.equal(calls.length, 1, 'no retry');
  assert.ok(!calls[0].url.includes(KEY)); assert.equal(calls[0].init.headers['xi-api-key'], KEY); assert.equal(calls[0].init.redirect, 'error');
});

test('single door: only the client reaches ElevenLabs, only the guard calls generateSound, studio and render never import them', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|mjs|js|html)$/.test(f.name)) files.push(p); } };
  for (const d of ['apps', 'packages', 'tools']) walk(d);
  const src = (f: string) => fs.readFileSync(f, 'utf8');
  const hits = (re: RegExp) => files.filter(f => re.test(src(f))).map(f => f.split(path.sep).join('/'));
  assert.deepEqual(hits(/api\.elevenlabs\.io|\/v1\/sound-generation|\/v1\/user\/subscription/), ['packages/sfx-guard/client.ts']);
  assert.deepEqual(hits(/\.generateSound\(/), ['packages/sfx-guard/guard.ts']);
  assert.deepEqual(hits(/createElevenLabsClient\(/).sort(), ['packages/sfx-guard/client.ts', 'tools/sfx.ts']);
  const importers = hits(/sfx-guard\//).filter(f => !f.startsWith('packages/sfx-guard/'));
  assert.deepEqual(importers, ['tools/sfx.ts'], 'apps (studio, server, render) never import the guard or the client');
  // render and preview read samples from assets/sfx only
  assert.match(src('apps/server/render-job.ts'), /assets\/sfx/); assert.match(src('apps/studio/main.ts'), /\/assets\/sfx\//);
});
