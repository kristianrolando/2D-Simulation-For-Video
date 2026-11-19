// YouTube Data API v3 for the studio (docs/youtube-upload-plan.md). No npm packages: Node's fetch only.
//
// Secrets (OAuth client id + secret, refresh token) live ONLY in
//   ~/Library/Application Support/Sim Studio/youtube.json        (mode 600)
// and resumable-upload session URIs (usable to upload without signing in) only in
//   ~/Library/Application Support/Sim Studio/youtube-sessions/   (mode 600)
// Access tokens stay in memory. Nothing secret is written to the workspace, data/, a log, or an API response;
// every error message goes through redact() first.
//
// Rules this module enforces: one scope (youtube.force-ssl), uploads always start PRIVATE, quota errors are reported and
// never retried, and there is no delete call anywhere (tests scan this file for it).
//
// Several channels can be connected through the ONE OAuth client (one Google Cloud project, so one shared daily quota).
// Each connection has its own refresh token, its own access token in memory, and its own "Upload from Sim Studio" switch.
// Every call that touches a channel names it (channelId); a call can never borrow another channel's token.
// The file written before connections existed ({ refresh, channel } at the top) is read as one connection and rewritten
// once in the new shape, after a backup next to it (youtube.json.bak-single-channel, mode 600).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
// SIM_GOOGLE_FAKE=http://127.0.0.1:<port> points every call at a local stand-in of Google (tests only).
const FAKE = process.env.SIM_GOOGLE_FAKE;
const AUTH = FAKE ? `${FAKE}/o/oauth2/v2/auth` : 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = FAKE ? `${FAKE}/token` : 'https://oauth2.googleapis.com/token';
const REVOKE = FAKE ? `${FAKE}/revoke` : 'https://oauth2.googleapis.com/revoke';
const API = FAKE ? `${FAKE}/youtube/v3` : 'https://www.googleapis.com/youtube/v3';
const UPLOAD = FAKE ? `${FAKE}/upload/youtube/v3/videos` : 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMB = FAKE ? `${FAKE}/upload/youtube/v3/thumbnails/set` : 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

/** resolved at call time, so tests can point HOME at a temporary folder */
export const supportDir = () => path.join(os.homedir(), 'Library', 'Application Support', 'Sim Studio');
const fileOf = () => path.join(supportDir(), 'youtube.json');
const sessDir = () => path.join(supportDir(), 'youtube-sessions');

export interface Defaults { categoryId: string; language: string; madeForKids: boolean; synthetic: boolean; notify: boolean; lastTime: string }
export const DEFAULTS: Defaults = { categoryId: '28', language: 'en', madeForKids: false, synthetic: false, notify: true, lastTime: '19:00' };
/** One connected (or once connected) channel. `refresh` is the only secret here. */
export interface Connection {
  channelId: string; name: string; handle: string;
  refresh: string; scope?: string; connectedAt: string;
  /** why it stopped working ('' = fine); the channel stays listed so it can be connected again */
  disconnected?: string;
  /** "Upload from Sim Studio": off = every upload path to this channel refuses (the owner uploads by hand) */
  uploadEnabled: boolean;
  /** uploads this studio started for this channel today (Pacific day) — the channel's OWN upload limit is per channel */
  uploads?: { day: string; count: number };
  /** when YouTube last answered "uploadLimitExceeded" for THIS channel (the other channels are not affected) */
  limitAt?: string;
}
interface Secrets {
  client?: { id: string; secret: string; project?: string };
  connections?: Connection[];
  /** the channel new videos are made for (the studio's "active channel") */
  activeChannelId?: string;
  defaults?: Partial<Defaults>;
  /** the studio's own count of what it spent today, SHARED by all channels: the quota belongs to the Cloud project, not a channel */
  quota?: { day: string; units: number; uploads: number };
  // the single-channel shape (before connections existed); only ever read, then migrated
  refresh?: string; scope?: string; channel?: { id: string; name: string; handle: string }; connectedAt?: string; disconnected?: string;
}

// ---------------- secret file: atomic write, mode 600 ----------------
/** the single-channel file → one connection (Upload from Sim Studio on, as it always was). Pure, for the tests. */
export function migrateSecrets(raw: Record<string, any>): { data: Secrets; migrated: boolean } {
  const d: Secrets = { ...raw };
  if (Array.isArray(d.connections)) return { data: d, migrated: false };
  const had = !!(raw.refresh || raw.channel);
  const conns: Connection[] = [];
  if (raw.channel?.id) {
    const day = ptDay();
    conns.push({ channelId: String(raw.channel.id), name: String(raw.channel.name ?? ''), handle: String(raw.channel.handle ?? ''), refresh: String(raw.refresh ?? ''),
      ...(raw.scope ? { scope: String(raw.scope) } : {}), connectedAt: String(raw.connectedAt ?? ''),
      ...(raw.disconnected ? { disconnected: String(raw.disconnected) } : !raw.refresh ? { disconnected: 'Connect again in YouTube settings.' } : {}),
      uploadEnabled: true, ...(raw.quota?.day === day ? { uploads: { day, count: Number(raw.quota.uploads) || 0 } } : {}) });
  }
  for (const k of ['refresh', 'scope', 'channel', 'connectedAt', 'disconnected'] as const) delete d[k];
  d.connections = conns;
  if (conns[0]) d.activeChannelId = conns[0].channelId;
  return { data: d, migrated: had };
}
function readSecrets(): Secrets {
  let raw: Record<string, any>;
  try { raw = JSON.parse(fs.readFileSync(fileOf(), 'utf8')); } catch { return { connections: [] }; }
  const { data, migrated } = migrateSecrets(raw);
  if (migrated) {
    try {
      const bak = fileOf() + '.bak-single-channel';
      if (!fs.existsSync(bak)) { fs.copyFileSync(fileOf(), bak); fs.chmodSync(bak, 0o600); }
      writeSecret(fileOf(), data);
    } catch { /* still usable in memory; the next write saves the new shape */ }
  }
  return data;
}
const conns = (d: Secrets) => d.connections ?? [];
const live = (c: Connection | undefined) => !!(c && c.refresh && !c.disconnected);
function writeSecret(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, file); fs.chmodSync(file, 0o600);
}
function change<T>(fn: (d: Secrets) => T): T { const d = readSecrets(); const r = fn(d); writeSecret(fileOf(), d); return r; }
const connOf = (d: Secrets, channelId: string) => conns(d).find(c => c.channelId === channelId);

// ---------------- redaction ----------------
/** access tokens, per channel, in memory only */
const access = new Map<string, { token: string; until: number }>();
const forget = (channelId?: string) => { if (channelId) access.delete(channelId); else access.clear(); };
/** Remove anything that could act as a credential from a text before it is shown, stored or logged. */
export function redact(text: unknown): string {
  let s = String(text ?? '');
  let d: Secrets = {}; try { d = readSecrets(); } catch { /* unreadable: the patterns below still apply */ }
  for (const secret of [...conns(d).map(c => c.refresh), d.client?.secret, ...[...access.values()].map(a => a.token)]) if (secret && secret.length > 6) s = s.split(secret).join('[hidden]');
  return s
    .replace(/ya29\.[\w.-]+/g, '[hidden]')                         // access tokens
    .replace(/1\/\/[\w./-]{10,}/g, '[hidden]')                      // refresh tokens
    .replace(/GOCSPX-[\w-]+/g, '[hidden]')                          // client secrets
    .replace(/(upload_id|code|access_token|refresh_token|client_secret)=[^&\s"']+/gi, '$1=[hidden]')
    .replace(/https?:\/\/[^\s"']*upload[^\s"']*/gi, '[upload session]')
    .replace(/"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]*"/gi, '"$1":"[hidden]"');
}

/** An error the page may show as it is (already redacted). kind decides what the studio does next. */
export class YtError extends Error {
  kind: 'auth' | 'quota' | 'expired' | 'retry' | 'fatal' | 'thumbnail' | 'off';
  /** quota only: the DAILY quota (resets at midnight Pacific Time, so waiting for the reset helps); false = the channel's own upload limit */
  daily: boolean;
  constructor(kind: YtError['kind'], msg: string, daily = false) { super(redact(msg)); this.kind = kind; this.daily = daily; this.name = 'YtError'; }
}

// ---------------- what the page may see ----------------
/** the active channel: the one chosen in YouTube settings, else the first connection */
const activeOf = (d: Secrets) => connOf(d, d.activeChannelId ?? '') ?? conns(d)[0];
/** what the page may see about one connection (never the token) */
export interface ConnectionView { id: string; name: string; handle: string; connected: boolean; disconnected: string; connectedAt: string; uploadEnabled: boolean; active: boolean; uploadsToday: number; limitAt: string }
const viewOf = (d: Secrets, c: Connection): ConnectionView => {
  const day = ptDay();
  return { id: c.channelId, name: c.name, handle: c.handle, connected: live(c), disconnected: c.disconnected ?? '', connectedAt: c.connectedAt, uploadEnabled: c.uploadEnabled,
    active: activeOf(d)?.channelId === c.channelId, uploadsToday: c.uploads?.day === day ? c.uploads.count : 0, limitAt: c.limitAt ?? '' };
};
export function status() {
  const d = readSecrets(), a = activeOf(d);
  return {
    client: !!d.client?.id,
    clientHint: d.client?.id ? `…${d.client.id.split('-')[0].slice(-6)}` : '',
    // the active channel, in the shape the page used before there were several
    connected: live(a),
    channel: a ? { id: a.channelId, name: a.name, handle: a.handle } : null,
    disconnected: a?.disconnected ?? '',
    activeChannelId: a?.channelId ?? '',
    connections: conns(d).map(c => viewOf(d, c)),
    defaults: { ...DEFAULTS, ...(d.defaults ?? {}) },
    /** shared by every channel: one Cloud project, one daily quota */
    quota: quotaToday(d),
  };
}
/** the active channel when it is connected (new videos are made for it) */
export function channel() { const a = activeOf(readSecrets()); return live(a) ? { id: a!.channelId, name: a!.name, handle: a!.handle } : null; }
/** every connection, as the page sees it */
export function connections(): ConnectionView[] { const d = readSecrets(); return conns(d).map(c => viewOf(d, c)); }
export function connection(channelId: string): ConnectionView | null { const d = readSecrets(), c = connOf(d, channelId); return c ? viewOf(d, c) : null; }

/** Which connection a video goes to: its own channelId; else the connection with its channel name; a record from before channels were
 *  recorded (no channelId, channel = the default name) goes to the FIRST connection, the one the studio always had. Anything else: none. */
export function connectionFor(v: { channelId?: string; channel?: string }, defaultName: string): ConnectionView | null {
  const d = readSecrets(), all = conns(d);
  const c = v.channelId ? all.find(x => x.channelId === v.channelId)
    : all.find(x => x.name && x.name === v.channel) ?? (!v.channel || v.channel === defaultName ? all[0] : undefined);
  return c ? viewOf(d, c) : null;
}
export const UPLOADS_OFF = 'Uploads from Sim Studio are turned off for this channel. Turn on "Upload from Sim Studio" in YouTube settings, or upload it by hand in YouTube Studio.';
/** Every path that sends something to a channel calls this first: connected, switched on, and the right one. Throws a readable YtError. */
export function assertCanUpload(channelId: string): ConnectionView {
  const d = readSecrets(), c = connOf(d, channelId);
  if (!c) throw new YtError('auth', 'This video\'s channel is not connected to Sim Studio. Connect it in YouTube settings.');
  if (!live(c)) throw new YtError('auth', `The channel ${c.name} is not connected (${c.disconnected || 'no permission'}). Connect again in YouTube settings.`);
  if (!c.uploadEnabled) throw new YtError('off', UPLOADS_OFF);
  return viewOf(d, c);
}

/** The channel new videos are made for. */
export function setActive(channelId: string) {
  change(d => { if (!connOf(d, channelId)) throw new YtError('fatal', 'That channel is not in the list.'); d.activeChannelId = channelId; });
  return status();
}
/** "Upload from Sim Studio" for one channel. Turning it ON for a channel that is not the active one needs the channel's name typed back
 *  (the page asks "Turn on uploads to <name>?"), so a click on the wrong row cannot start sending to a channel. */
export function setUploadEnabled(channelId: string, on: boolean, confirmName = '') {
  change(d => {
    const c = connOf(d, channelId); if (!c) throw new YtError('fatal', 'That channel is not in the list.');
    if (on && !c.uploadEnabled && activeOf(d)?.channelId !== channelId && confirmName !== c.name) throw new YtError('fatal', `Confirm with the channel name (${c.name}) to turn on uploads to a channel that is not the active one.`);
    c.uploadEnabled = on;
  });
  return status();
}
export function setDefaults(p: Partial<Defaults>) {
  return change(d => {
    const cur = { ...DEFAULTS, ...(d.defaults ?? {}) };
    if (typeof p.categoryId === 'string' && /^\d{1,3}$/.test(p.categoryId)) cur.categoryId = p.categoryId;
    if (typeof p.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(p.language)) cur.language = p.language;
    for (const k of ['madeForKids', 'synthetic', 'notify'] as const) if (typeof p[k] === 'boolean') cur[k] = p[k] as boolean;
    if (typeof p.lastTime === 'string' && /^\d\d:\d\d$/.test(p.lastTime)) cur.lastTime = p.lastTime;
    d.defaults = cur; return cur;
  });
}

// ---------------- quota bookkeeping (resets at midnight Pacific Time) ----------------
export const ptDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
function quotaToday(d: Secrets) { const day = ptDay(); return d.quota?.day === day ? { units: d.quota.units, uploads: d.quota.uploads } : { units: 0, uploads: 0 }; }
function spend(units: number, uploads = 0, channelId = '') {
  try {
    change(d => {
      const day = ptDay(); if (d.quota?.day !== day) d.quota = { day, units: 0, uploads: 0 }; d.quota!.units += units; d.quota!.uploads += uploads;
      const c = channelId ? connOf(d, channelId) : undefined;
      if (c && uploads) { if (c.uploads?.day !== day) c.uploads = { day, count: 0 }; c.uploads.count += uploads; }
    });
  } catch { /* bookkeeping only */ }
}
/** YouTube said "uploadLimitExceeded" for this channel: note it on THAT connection only */
function noteLimit(channelId: string) { try { change(d => { const c = connOf(d, channelId); if (c) c.limitAt = new Date().toISOString(); }); } catch { /* bookkeeping only */ } }
/** The next midnight Pacific Time after `now` (YouTube's daily quota resets then). Pacific offsets are whole hours, so it falls on a UTC hour. */
export function nextQuotaReset(now = new Date()): Date {
  for (let h = 0; h < 48; h++) {
    const t = new Date(Math.ceil((now.getTime() + 1) / 3600e3) * 3600e3 + h * 3600e3);
    if (Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(t)) === 0) return t;
  }
  return new Date(now.getTime() + 24 * 3600e3);
}
/** When to try again after the daily quota ran out: two minutes after the reset, by the wall clock (a timer would drift while the Mac sleeps).
 *  SIM_YT_QUOTA_WAIT_MS: tests only. */
export const quotaWaitUntil = (now = new Date()): Date => process.env.SIM_YT_QUOTA_WAIT_MS ? new Date(now.getTime() + Number(process.env.SIM_YT_QUOTA_WAIT_MS)) : new Date(nextQuotaReset(now).getTime() + 2 * 60e3);
/** "Quota resets at 15.00" in the Mac's own time zone (midnight PT moves with daylight saving) */
export function quotaResetLocal(now = new Date()): string {
  for (let h = 0; h < 48; h++) {
    const t = new Date(Math.ceil(now.getTime() / 3600e3) * 3600e3 + h * 3600e3);
    const hh = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(t);
    if (Number(hh) === 0) return t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return '';
}

// ---------------- OAuth client file ----------------
/** The JSON Google gives for a "Desktop app" client: {"installed": {client_id, client_secret, ...}} */
export function saveClient(text: string) {
  let j: any; try { j = JSON.parse(text); } catch { throw new YtError('fatal', 'That file is not JSON. Choose the client_secret_….json file from Google Cloud.'); }
  const k = j?.installed;
  if (!k) throw new YtError('fatal', j?.web ? 'This is a "Web application" client. Create a client of type "Desktop app" in Google Cloud.' : 'File not recognised. Choose the client_secret_….json of a "Desktop app" client.');
  if (!/\.apps\.googleusercontent\.com$/.test(k.client_id || '') || !k.client_secret) throw new YtError('fatal', 'The client file is incomplete (client_id or client_secret missing).');
  change(d => {
    if (d.client?.id && d.client.id !== k.client_id) { for (const c of conns(d)) { c.refresh = ''; c.disconnected = 'The OAuth client was replaced; connect again.'; } forget(); }
    d.client = { id: k.client_id, secret: k.client_secret, project: k.project_id || undefined };
  });
  return status();
}
/** Take the newest client_secret_*.json from ~/Downloads, store it in Application Support, then delete the download. */
export function importClientFromDownloads(): { file: string } {
  const dir = path.join(os.homedir(), 'Downloads');
  const files = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => /^client_secret_.*\.json$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  if (!files.length) throw new YtError('fatal', 'No client_secret_….json in your Downloads folder. Download it from Google Cloud (Clients → Download JSON) first.');
  const full = path.join(dir, files[0].f);
  saveClient(fs.readFileSync(full, 'utf8'));
  fs.rmSync(full, { force: true }); // the copy in Application Support is the only one now
  return { file: files[0].f };
}

// ---------------- sign in: PKCE (S256) + state, both single use, 15 minutes ----------------
const pending = new Map<string, { verifier: string; redirect: string; at: number }>();
export function loginUrl(redirect: string): string {
  const d = readSecrets(); if (!d.client?.id) throw new YtError('fatal', 'Add the OAuth client file first.');
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60e3) pending.delete(k);
  const state = crypto.randomBytes(16).toString('hex'), verifier = crypto.randomBytes(48).toString('base64url');
  pending.set(state, { verifier, redirect, at: Date.now() });
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return `${AUTH}?${new URLSearchParams({ client_id: d.client.id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline',
    prompt: 'consent select_account', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
}
/** A second (third…) channel waits here, in memory only, until the owner confirms it on the page: Google's account picker is easy to
 *  click wrong, so the studio shows which channel came back before it keeps the permission. Single use, 15 minutes. */
const awaiting = new Map<string, { at: number; refresh: string; scope: string; channel: { id: string; name: string; handle: string } }>();
export type LoginResult = { connected: true; name: string; handle: string } | { connected: false; confirm: string; name: string; handle: string };
/** The browser comes back here (loopback). The first channel (or one that was connected before) is kept at once; a NEW extra channel
 *  waits for confirmConnection(). A channel that is already connected is refused (nothing changes). */
export async function finishLogin(q: URLSearchParams): Promise<LoginResult> {
  const state = q.get('state') ?? '', p = pending.get(state);
  pending.delete(state);
  if (q.get('error')) throw new YtError('fatal', q.get('error') === 'access_denied' ? 'You declined access on the Google page. Nothing was connected.' : `Google answered: ${q.get('error')}`);
  if (!p || Date.now() - p.at > 15 * 60e3) throw new YtError('fatal', 'This sign-in link is old or was already used. Press Connect in the studio again.');
  const d = readSecrets(); if (!d.client) throw new YtError('fatal', 'The OAuth client file is missing.');
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    code: q.get('code') ?? '', client_id: d.client.id, client_secret: d.client.secret, redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new YtError('fatal', `Google did not accept the sign-in (${j.error ?? r.status}).`);
  if (!j.refresh_token) throw new YtError('fatal', 'Google did not give a long-lived permission. Remove "Sim Studio" at myaccount.google.com/permissions and connect again.');
  if (j.scope && !String(j.scope).split(' ').includes(SCOPE)) throw new YtError('fatal', 'The YouTube permission was not granted (tick it on the Google page).');
  const ch: any = await (await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${j.access_token}` } })).json().catch(() => ({}));
  spend(1);
  const c = ch?.items?.[0];
  if (!c?.id) throw new YtError('fatal', 'This Google account has no YouTube channel. Create one first, or pick the right account/channel.');
  const found = { id: String(c.id), name: String(c.snippet?.title ?? ''), handle: String(c.snippet?.customUrl ?? '') };
  const known = connOf(readSecrets(), found.id);
  if (live(known)) throw new YtError('fatal', `The channel ${found.name}${found.handle ? ` (${found.handle})` : ''} is already connected. Nothing was changed. To add another channel, pick that channel on the Google page.`);
  const remember = () => access.set(found.id, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60e3 });
  if (known || !conns(readSecrets()).length) { // connected before (permission expired) or the very first channel: keep it now, as the studio always did
    keep(found, j.refresh_token, j.scope || SCOPE); remember();
    return { connected: true, name: found.name, handle: found.handle };
  }
  for (const [k, v] of awaiting) if (Date.now() - v.at > 15 * 60e3) awaiting.delete(k);
  const confirm = crypto.randomBytes(16).toString('hex');
  awaiting.set(confirm, { at: Date.now(), refresh: j.refresh_token, scope: j.scope || SCOPE, channel: found });
  return { connected: false, confirm, name: found.name, handle: found.handle };
}
function keep(ch: { id: string; name: string; handle: string }, refresh: string, scope: string) {
  change(x => {
    const list = conns(x), old = connOf(x, ch.id), first = !list.length;
    const c: Connection = { channelId: ch.id, name: ch.name, handle: ch.handle, refresh, scope, connectedAt: new Date().toISOString(),
      // a channel that was here before keeps its switch; the first channel uploads (as before); every NEW extra channel starts switched OFF
      uploadEnabled: old ? old.uploadEnabled : first, ...(old?.uploads ? { uploads: old.uploads } : {}), ...(old?.limitAt ? { limitAt: old.limitAt } : {}) };
    x.connections = old ? list.map(o => (o.channelId === ch.id ? c : o)) : [...list, c];
    if (!x.activeChannelId || !connOf(x, x.activeChannelId)) x.activeChannelId = ch.id;
  });
}
/** The owner confirmed (or cancelled) the extra channel shown after Google's page. */
export function confirmConnection(token: string, yes: boolean): { name: string; handle: string; connected: boolean } {
  const a = awaiting.get(token); awaiting.delete(token);
  if (!a || Date.now() - a.at > 15 * 60e3) throw new YtError('fatal', 'This confirmation is old or was already used. Press "Connect another channel" in the studio again.');
  if (!yes) { void fetch(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: a.refresh }) }).catch(() => {}); return { ...a.channel, connected: false }; }
  if (live(connOf(readSecrets(), a.channel.id))) throw new YtError('fatal', `The channel ${a.channel.name} is already connected. Nothing was changed.`);
  keep(a.channel, a.refresh, a.scope);
  return { name: a.channel.name, handle: a.channel.handle, connected: true };
}
/** Revoke ONE channel's permission at Google (best effort) and forget its token. The other channels stay connected; videos and their
 *  records stay untouched (nothing is ever deleted on YouTube). Without a channelId: the active channel. */
export async function disconnect(channelId = '') {
  const d = readSecrets(), c = channelId ? connOf(d, channelId) : activeOf(d);
  if (!c) return status();
  if (c.refresh) { try { await fetch(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.refresh }) }); } catch { /* offline: forget locally anyway */ } }
  change(x => {
    x.connections = conns(x).filter(o => o.channelId !== c.channelId);
    if (x.activeChannelId === c.channelId) x.activeChannelId = conns(x)[0]?.channelId;
  });
  forget(c.channelId);
  return status();
}

// ---------------- access token + calls ----------------
/** a call without a channel means the active one (old callers); the uploader always names the channel */
const pick = (channelId?: string) => channelId || activeOf(readSecrets())?.channelId || '';
async function token(channelId?: string): Promise<string> {
  const id = pick(channelId), a = access.get(id);
  if (a && Date.now() < a.until) return a.token;
  const d = readSecrets(), c = connOf(d, id);
  if (!d.client || !c?.refresh) throw new YtError('auth', c ? `The channel ${c.name} is not connected. Connect again in YouTube settings.` : 'YouTube is not connected. Connect it in YouTube settings.');
  let r: Response;
  try { r = await fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: d.client.id, client_secret: d.client.secret, refresh_token: c.refresh, grant_type: 'refresh_token' }) }); }
  catch { throw new YtError('retry', 'No connection to Google.'); }
  const j: any = await r.json().catch(() => ({}));
  if (j.error === 'invalid_grant' || r.status === 400 || r.status === 401) {
    change(x => { const o = connOf(x, id); if (o) { o.refresh = ''; o.disconnected = 'The YouTube permission was revoked, expired, or unused for 6 months. Connect again in YouTube settings.'; } });
    forget(id);
    throw new YtError('auth', 'The YouTube connection is gone (permission revoked, expired, or unused for 6 months). Connect again in YouTube settings.');
  }
  if (!r.ok || !j.access_token) throw new YtError('retry', `Google token service answered ${r.status}.`);
  access.set(id, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60e3 });
  return j.access_token;
}

/** turn a Google error response into a YtError (quota is never retried) */
async function failure(r: Response, what: string): Promise<YtError> {
  const j: any = await r.json().catch(() => ({}));
  const reason = j?.error?.errors?.[0]?.reason ?? j?.error?.status ?? '';
  const msg = j?.error?.message ?? '';
  if (r.status === 403 && /quota|dailyLimit|rateLimitExceeded/i.test(reason + msg)) return new YtError('quota', `YouTube's daily quota is used up (it resets at midnight Pacific Time, ${quotaResetLocal()} here).`, true);
  if ((r.status === 400 || r.status === 429) && reason === 'uploadLimitExceeded') return new YtError('quota', 'This channel has reached its own upload limit for now. Try again later.');
  if (r.status === 401) return new YtError('auth', 'YouTube refused the permission. Connect again in YouTube settings.');
  if ([500, 502, 503, 504].includes(r.status)) return new YtError('retry', `${what}: YouTube is busy (${r.status}).`);
  return new YtError('fatal', `${what}: ${r.status} ${reason} ${msg}`.trim());
}
/** an authorised JSON call; a 401 refreshes the token once */
async function call(method: 'GET' | 'PUT' | 'POST', url: string, body: unknown, units: number, what: string, channelId?: string): Promise<any> {
  const id = pick(channelId);
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try { r = await fetch(url, { method, headers: { authorization: `Bearer ${await token(id)}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60e3) }); }
    catch (e) { if (e instanceof YtError) throw e; throw new YtError('retry', `${what}: no connection to YouTube.`); }
    if (r.status === 401 && attempt === 0) { forget(id); continue; }
    spend(units);
    if (!r.ok) throw await failure(r, what);
    return r.json().catch(() => ({}));
  }
}

// ---------------- the upload itself ----------------
export interface UploadMeta { title: string; description: string; tags: string[]; categoryId: string; language: string; madeForKids: boolean; synthetic: boolean; notify: boolean; publishAt: string }
const sessFile = (key: string) => path.join(sessDir(), `${key.replace(/[^\w-]/g, '_')}.json`);
export const hasSession = (key: string) => fs.existsSync(sessFile(key));
export const dropSession = (key: string) => fs.rmSync(sessFile(key), { force: true });

/** Start a resumable session. The video is created PRIVATE (publishAt only when scheduled). */
export async function startSession(key: string, file: string, meta: UploadMeta, channelId?: string): Promise<{ total: number }> {
  const id = pick(channelId);
  const total = fs.statSync(file).size;
  const body = {
    snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId, defaultLanguage: meta.language },
    status: { privacyStatus: 'private', ...(meta.publishAt ? { publishAt: meta.publishAt } : {}), selfDeclaredMadeForKids: meta.madeForKids, containsSyntheticMedia: meta.synthetic },
  };
  const url = `${UPLOAD}?uploadType=resumable&part=snippet,status&notifySubscribers=${meta.notify ? 'true' : 'false'}`;
  let r: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${await token(id)}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(total), 'x-upload-content-type': 'video/mp4' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60e3) }); }
    catch (e) { if (e instanceof YtError) throw e; throw new YtError('retry', 'Could not reach YouTube to start the upload.'); }
    if (r.status === 401 && attempt === 0) { forget(id); continue; } // refresh once (a revoked permission shows up here)
    break;
  }
  r = r!;
  if (!r.ok) { const e = await failure(r, 'Starting the upload'); if (e.kind === 'quota' && !e.daily) noteLimit(id); throw e; }
  const uri = r.headers.get('location'); if (!uri) throw new YtError('fatal', 'YouTube did not return an upload session.');
  spend(0, 1, id);
  writeSecret(sessFile(key), { uri, total, startedAt: new Date().toISOString(), channelId: id });
  return { total };
}

/** Send the file through the saved session, from wherever YouTube says it is. Returns the YouTube video id. */
export async function sendFile(key: string, file: string, onProgress: (sent: number, total: number) => void, chunk = 8 * 1024 * 1024): Promise<string> {
  let s: { uri: string; total: number };
  try { s = JSON.parse(fs.readFileSync(sessFile(key), 'utf8')); } catch { throw new YtError('expired', 'There is no upload session to continue.'); }
  if (fs.statSync(file).size !== s.total) throw new YtError('fatal', 'The MP4 changed since the upload started. It is not sent again automatically.');
  chunk = Math.max(256 * 1024, Math.floor(chunk / (256 * 1024)) * 256 * 1024); // a multiple of 256 KB
  const fd = fs.openSync(file, 'r'), buf = Buffer.allocUnsafe(chunk);
  let failures = 0, offset = await queryOffset(s.uri, s.total);
  try {
    while (true) {
      if (typeof offset === 'string') return offset; // already complete
      onProgress(offset, s.total);
      const n = fs.readSync(fd, buf, 0, Math.min(chunk, s.total - offset), offset);
      let r: Response | null = null;
      try { r = await fetch(s.uri, { method: 'PUT', headers: { 'content-length': String(n), 'content-range': `bytes ${offset}-${offset + n - 1}/${s.total}` }, body: buf.subarray(0, n), signal: AbortSignal.timeout(180e3) }); }
      catch { r = null; }
      if (r && (r.status === 200 || r.status === 201)) { const j: any = await r.json().catch(() => ({})); if (!j.id) throw new YtError('fatal', 'YouTube finished the upload without a video id.'); onProgress(s.total, s.total); return j.id; }
      if (r && r.status === 308) { offset = nextFrom(r.headers.get('range')); failures = 0; continue; }
      if (r && r.status === 404) throw new YtError('expired', 'The upload session has expired.');
      if (r && ![500, 502, 503, 504].includes(r.status)) throw await failure(r, 'Uploading');
      // lost connection or a retryable 5xx: wait, ask how far YouTube got, continue from there (same session, no new upload)
      if (++failures > 6) throw new YtError('retry', 'The connection keeps dropping. Press "Continue upload" to resume from where it stopped.');
      await new Promise(res => setTimeout(res, Math.min(32e3, 500 * 2 ** failures)));
      offset = await queryOffset(s.uri, s.total);
    }
  } finally { fs.closeSync(fd); }
}
const nextFrom = (range: string | null) => { const m = /bytes=0-(\d+)/.exec(range ?? ''); return m ? Number(m[1]) + 1 : 0; };
/** how many bytes YouTube has; a string is the finished video's id */
async function queryOffset(uri: string, total: number): Promise<number | string> {
  for (let i = 0; i < 6; i++) {
    let r: Response;
    try { r = await fetch(uri, { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${total}` }, signal: AbortSignal.timeout(60e3) }); }
    catch { await new Promise(res => setTimeout(res, 500 * 2 ** i)); continue; }
    if (r.status === 308) return nextFrom(r.headers.get('range'));
    if (r.status === 200 || r.status === 201) { const j: any = await r.json().catch(() => ({})); if (j.id) return String(j.id); }
    if (r.status === 404) throw new YtError('expired', 'The upload session has expired.');
    if (![500, 502, 503, 504].includes(r.status)) throw await failure(r, 'Checking the upload');
    await new Promise(res => setTimeout(res, 500 * 2 ** i));
  }
  throw new YtError('retry', 'YouTube could not be asked how far the upload got. Press "Continue upload" later.');
}

/** Wait until YouTube has processed the video (needed before a Shorts thumbnail). ≤ 1 unit per check. */
export async function waitProcessed(videoId: string, { every = 20e3, max = 15 * 60e3 } = {}, channelId?: string): Promise<void> {
  const until = Date.now() + max;
  while (true) {
    const j = await call('GET', `${API}/videos?part=processingDetails,status&id=${encodeURIComponent(videoId)}`, null, 1, 'Checking the processing', channelId);
    const v = j?.items?.[0];
    if (!v) throw new YtError('fatal', 'YouTube does not know this video (any more).');
    const st = v.processingDetails?.processingStatus;
    if (st === 'succeeded' || st === 'terminated') return;
    if (st === 'failed' || v.status?.uploadStatus === 'rejected' || v.status?.uploadStatus === 'failed') throw new YtError('fatal', `YouTube could not process the video (${v.processingDetails?.processingFailureReason ?? v.status?.rejectionReason ?? v.status?.failureReason ?? 'unknown'}).`);
    if (Date.now() > until) throw new YtError('retry', 'YouTube is still processing the video. Press "Continue" in a few minutes.');
    await new Promise(res => setTimeout(res, every));
  }
}

export async function setThumbnail(videoId: string, png: string, channelId?: string): Promise<void> {
  const id = pick(channelId);
  const data = fs.readFileSync(png);
  if (data.length > 50 * 1024 * 1024) throw new YtError('thumbnail', 'The thumbnail is larger than 50 MB.');
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try { r = await fetch(`${THUMB}?videoId=${encodeURIComponent(videoId)}`, { method: 'POST', headers: { authorization: `Bearer ${await token(id)}`, 'content-type': data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : 'image/png' }, body: data, signal: AbortSignal.timeout(120e3) }); }
    catch (e) { if (e instanceof YtError) throw e; throw new YtError('retry', 'Could not reach YouTube to set the thumbnail.'); }
    if (r.status === 401 && attempt === 0) { forget(id); continue; }
    spend(50);
    if (r.ok) return;
    const e = await failure(r, 'Setting the thumbnail');
    if (e.kind === 'quota' || e.kind === 'auth' || e.kind === 'retry') throw e;
    throw new YtError('thumbnail', r.status === 403 ? 'YouTube refused the custom thumbnail. Usually the channel is not verified yet (youtube.com/verify).' : r.status === 429 ? 'Too many thumbnails were uploaded recently. Try again later.' : e.message);
  }
}

/** Make an uploaded private video public (the whole status part is sent, as videos.update requires). 50 units. */
export async function makePublic(videoId: string, meta: Pick<UploadMeta, 'madeForKids' | 'synthetic'>, channelId?: string): Promise<void> {
  await call('PUT', `${API}/videos?part=status`, { id: videoId, status: { privacyStatus: 'public', selfDeclaredMadeForKids: meta.madeForKids, containsSyntheticMedia: meta.synthetic } }, 50, 'Publishing', channelId);
}

/** privacy status of up to 50 videos in one call (1 unit) */
export async function privacyOf(ids: string[], channelId?: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await call('GET', `${API}/videos?part=status&id=${ids.slice(i, i + 50).map(encodeURIComponent).join(',')}`, null, 1, 'Checking published videos', channelId);
    for (const v of j?.items ?? []) out[v.id] = v.status?.privacyStatus ?? '';
  }
  return out;
}

/** After an expired session: did the upload arrive anyway? Looks for the same title in the channel's last uploads (2 units). */
export async function findRecentUpload(title: string, sinceMs: number, channelId?: string): Promise<string> {
  const c = await call('GET', `${API}/channels?part=contentDetails&mine=true`, null, 1, 'Looking up the uploads', channelId);
  const list = c?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads; if (!list) return '';
  const p = await call('GET', `${API}/playlistItems?part=snippet&maxResults=25&playlistId=${encodeURIComponent(list)}`, null, 1, 'Looking up the uploads', channelId);
  const hit = (p?.items ?? []).find((it: any) => it.snippet?.title === title && Date.parse(it.snippet?.publishedAt ?? '') >= sinceMs - 60e3);
  return hit?.snippet?.resourceId?.videoId ?? '';
}
