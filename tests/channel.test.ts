// Channel on every video: old lists read as "Photon Lab", the one-time upgrade loses nothing, new videos get the right channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../apps/server/host.ts';
import { DEFAULT_CHANNEL, sanitizeVideo, patchVideo } from '../packages/publish/index.ts';
import { newVideoFor } from '../packages/publish/describe.ts';
import { openStore, parseStore } from '../apps/server/store.ts';
import { channelOf, channelsOf, filterChannel, hasFilters, NO_FILTERS } from '../apps/studio/videos-nav.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sim-channel-'));
const old = (n: number) => Array.from({ length: n }, (_, i) => {
  const { channel: _c, ...rest } = newVideoFor('galton-board', { seed: i + 1 }, { status: (['rendered', 'scheduled', 'published'] as const)[i % 3], scheduledAt: i % 3 === 1 ? '2030-01-01T10:00' : '' })!;
  return { ...rest, id: 'v-old' + i, title: 'T' + i };
});

test('an old record without channel reads as Photon Lab, and nothing else changes', () => {
  const [raw] = old(1); assert.equal('channel' in raw, false);
  const v = sanitizeVideo(raw)!; const { channel, ...rest } = v;
  assert.equal(channel, DEFAULT_CHANNEL); assert.equal(DEFAULT_CHANNEL, 'Photon Lab');
  assert.equal(rest.title, raw.title); assert.equal(rest.status, raw.status); assert.equal(rest.scheduledAt, raw.scheduledAt);
  assert.equal(sanitizeVideo({ ...raw, channel: '  Studio X ' })!.channel, 'Studio X', 'a channel is kept (trimmed)');
  assert.equal(sanitizeVideo({ ...raw, channel: 42 })!.channel, DEFAULT_CHANNEL, 'junk falls back');
  assert.equal(patchVideo(v, { channel: 'Hacked' }).channel, 'Photon Lab', 'not editable from the page');
});

test('parseStore flags old lists as migrated and keeps every video with its status and schedule', () => {
  const vs = old(9); const text = JSON.stringify({ schemaVersion: 1, savedAt: 'x', videos: vs, settings: {} });
  const r = parseStore(text); assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.migrated, true); assert.equal(r.store.videos.length, 9); assert.equal(r.skipped, 0);
  assert.ok(r.store.videos.every(v => v.channel === 'Photon Lab'));
  r.store.videos.forEach((v, i) => { assert.equal(v.id, vs[i].id); assert.equal(v.status, vs[i].status); assert.equal(v.scheduledAt, vs[i].scheduledAt); assert.equal(v.title, vs[i].title); });
  const again = parseStore(JSON.stringify(r.store)); assert.ok(again.ok && !again.migrated, 'a current list is not migrated again');
  assert.equal(schemaOf(text), 1); assert.equal(r.store.schemaVersion, 1, 'schema version is not bumped');
});
const schemaOf = (t: string) => JSON.parse(t).schemaVersion;

test('opening an old data folder writes channel once, backs up the old file first, and the count stays the same', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'videos.json'), JSON.stringify({ schemaVersion: 1, savedAt: 'x', videos: old(12), settings: { suggestLang: 'en' } }, null, 2));
  const before = fs.readFileSync(path.join(dir, 'videos.json'), 'utf8');
  const s = openStore(dir); assert.equal(s.list().length, 12);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8'));
  assert.equal(disk.videos.length, 12); assert.ok(disk.videos.every((v: any) => v.channel === 'Photon Lab')); assert.equal(disk.schemaVersion, 1); assert.equal(disk.settings.suggestLang, 'en');
  const backs = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('videos-'));
  assert.equal(backs.length, 1); assert.equal(fs.readFileSync(path.join(dir, 'backups', backs[0]), 'utf8'), before, 'the backup is the old file, byte for byte');
  const mt = fs.statSync(path.join(dir, 'videos.json')).mtimeMs; openStore(dir); assert.equal(fs.statSync(path.join(dir, 'videos.json')).mtimeMs, mt, 'a second open does not rewrite');
});

test('a read-only studio does not write the upgrade', () => {
  const dir = tmp(); const text = JSON.stringify({ schemaVersion: 1, savedAt: 'x', videos: old(2), settings: {} }); fs.writeFileSync(path.join(dir, 'videos.json'), text);
  fs.writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: 4242 }));
  const s = openStore(dir, { lock: true, pid: 1, isAlive: () => true }); assert.ok(s.readOnly);
  assert.equal(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8'), text); assert.ok(s.list().every(v => v.channel === 'Photon Lab'));
});

test('a new video gets the channel it is given, else Photon Lab', () => {
  assert.equal(newVideoFor('galton-board', {})!.channel, 'Photon Lab');
  assert.equal(newVideoFor('galton-board', {}, { channel: 'Neon Lab' })!.channel, 'Neon Lab');
});

test('channel filter helpers: shown only with 2+ channels; filter keeps the right videos', () => {
  const vs = [{ channel: 'Photon Lab' }, {}, { channel: 'Neon Lab' }];
  assert.deepEqual(channelsOf(vs), ['Neon Lab', 'Photon Lab']); assert.deepEqual(channelsOf([{}, { channel: 'Photon Lab' }]), ['Photon Lab']);
  assert.equal(channelOf({}), 'Photon Lab'); assert.equal(filterChannel(vs, 'Photon Lab').length, 2); assert.equal(filterChannel(vs, '').length, 3);
  assert.equal(hasFilters({ ...NO_FILTERS, channel: 'Neon Lab' }), true); assert.equal(hasFilters(NO_FILTERS), false);
});
