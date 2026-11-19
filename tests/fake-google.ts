// A local stand-in for Google's OAuth and YouTube Data API v3, just enough for the studio's upload path.
// Checks what the real service checks (PKCE, single-use codes, bearer tokens, Content-Range continuity) and lets a test
// switch on failures: quota, revoked/expired tokens, dropped connections, 503s, expired sessions, refused thumbnails.
// It records every request, and answers any DELETE with 405 (and counts it: the studio must never send one).
// Several channels: `ctl.channel` is the channel the NEXT sign-in picks (Google's account/Brand Account picker); every token belongs
// to one channel, every video to the channel whose token created it, and a call with another channel's token is refused (403).
import http from 'node:http';
import crypto from 'node:crypto';
import { imageSize } from '../packages/publish/cover.ts';

export interface FakeChannel { id: string; title: string; customUrl: string }
export const FAKE_MAIN: FakeChannel = { id: 'UCfakechannel', title: 'Fake Science Channel', customUrl: '@fakescience' };
export interface FakeVideo { channelId: string; id: string; title: string; privacy: string; publishAt: string; madeForKids: boolean | null; synthetic: boolean | null; category: string; language: string; tags: string[]; description: string; notify: string;
  polls: number; processed: boolean; thumbBytes: number; thumbDims: string; thumbBeforeProcessed: boolean; publishedAt: string }
export function startFakeGoogle() {
  const ctl = {
    quota: false, quotaPoll: false /* quota error on status checks only: the insert works, the steps after it hit the quota */, revoked: false, thumbReject: 0 as 0 | 403 | 429, dropAfterChunk: -1, fail503Once: false, expireSessions: false, slowChunkMs: 0, processingPolls: 2,
    inserts: 0, deletes: 0, revokes: 0, tokenRefreshes: 0, chunks: 0, updates: [] as string[],
    /** the channel the next sign-in returns; uploadLimit = channels that answer "uploadLimitExceeded" on insert */
    channel: FAKE_MAIN as FakeChannel, uploadLimit: new Set<string>(), insertsBy: {} as Record<string, number>, wrongChannel: 0,
    log: [] as { method: string; path: string }[], videos: new Map<string, FakeVideo>(),
    sessions: new Map<string, { total: number; got: number; meta: any; notify: string; videoId: string; channelId: string }>(),
  };
  const codes = new Map<string, { challenge: string; client: string; redirect: string; channel: FakeChannel }>();
  const tokens = new Map<string, { until: number; channel: string }>(); // access token -> valid until (ms), channel
  const refreshes = new Map<string, FakeChannel>(); // refresh token -> channel
  const everIssued = new Set<string>(); // every refresh token, also revoked ones (the secret scan looks for all of them)
  let refresh = '';
  let base = '';
  const json = (res: http.ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const gErr = (res: http.ServerResponse, code: number, reason: string, message = reason) => json(res, code, { error: { code, message, errors: [{ reason, message }] } });
  const tokenOf = (req: http.IncomingMessage) => tokens.get(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
  const authed = (req: http.IncomingMessage) => (tokenOf(req)?.until ?? 0) > Date.now();
  const issue = (channel: string) => { const at = 'ya29.fake-access-' + crypto.randomBytes(8).toString('hex'); tokens.set(at, { until: Date.now() + 3600e3, channel }); return at; };
  const body = (req: http.IncomingMessage) => new Promise<Buffer>(ok => { const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  const vidView = (v: FakeVideo) => ({ id: v.id, status: { privacyStatus: v.privacy, publishAt: v.publishAt || undefined, uploadStatus: v.processed ? 'processed' : 'uploaded' }, processingDetails: { processingStatus: v.processed ? 'succeeded' : 'processing' } });

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'), p = u.pathname, raw = await body(req);
    ctl.log.push({ method: req.method ?? '', path: p });
    if (req.method === 'DELETE') { ctl.deletes++; res.writeHead(405); res.end(); return; }
    if (p === '/__ctl') { // manual testing: /__ctl?quota=1&thumbReject=403&slowChunkMs=400 (numbers and booleans only)
      for (const [k, v] of u.searchParams) if (k in ctl && typeof (ctl as any)[k] !== 'object') (ctl as any)[k] = typeof (ctl as any)[k] === 'boolean' ? v === '1' || v === 'true' : Number(v);
      json(res, 200, { quota: ctl.quota, revoked: ctl.revoked, thumbReject: ctl.thumbReject, slowChunkMs: ctl.slowChunkMs, inserts: ctl.inserts, deletes: ctl.deletes, videos: [...ctl.videos.values()].map(v => ({ id: v.id, title: v.title, privacy: v.privacy, publishAt: v.publishAt, thumb: v.thumbBytes })) }); return;
    }
    // ---- OAuth ----
    if (p === '/o/oauth2/v2/auth') {
      const code = 'code-' + crypto.randomBytes(6).toString('hex');
      if (u.searchParams.get('code_challenge_method') !== 'S256' || !u.searchParams.get('code_challenge')) { res.writeHead(400); res.end('PKCE required'); return; }
      codes.set(code, { challenge: u.searchParams.get('code_challenge')!, client: u.searchParams.get('client_id')!, redirect: u.searchParams.get('redirect_uri')!, channel: ctl.channel });
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}&scope=${encodeURIComponent(u.searchParams.get('scope')!)}` }); res.end(); return;
    }
    if (p === '/token') {
      const f = new URLSearchParams(raw.toString());
      if (f.get('grant_type') === 'authorization_code') {
        const c = codes.get(f.get('code') ?? ''); codes.delete(f.get('code') ?? '');
        const ok = c && c.client === f.get('client_id') && c.redirect === f.get('redirect_uri') && f.get('client_secret') === 'GOCSPX-fake-secret-123' &&
          crypto.createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === c.challenge;
        if (!ok) { json(res, 400, { error: 'invalid_grant' }); return; }
        refresh = '1//fake-refresh-' + crypto.randomBytes(8).toString('hex'); ctl.revoked = false; refreshes.set(refresh, c!.channel); everIssued.add(refresh);
        const at = issue(c!.channel.id);
        json(res, 200, { access_token: at, refresh_token: refresh, expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.force-ssl', token_type: 'Bearer' }); return;
      }
      if (f.get('grant_type') === 'refresh_token') {
        ctl.tokenRefreshes++;
        const ch = refreshes.get(f.get('refresh_token') ?? '');
        if (ctl.revoked || !ch) { json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }); return; }
        const at = issue(ch.id);
        json(res, 200, { access_token: at, expires_in: 3600 }); return;
      }
      json(res, 400, { error: 'unsupported_grant_type' }); return;
    }
    if (p === '/revoke') {
      ctl.revokes++;
      const t = new URLSearchParams(raw.toString()).get('token') ?? '';
      if (t && refreshes.has(t)) { const ch = refreshes.get(t)!.id; refreshes.delete(t); for (const [k, v] of tokens) if (v.channel === ch) tokens.delete(k); } // one permission
      else { ctl.revoked = true; tokens.clear(); } // no token: everything (a test switch)
      json(res, 200, {}); return;
    }
    // ---- resumable session (no bearer needed: the session URI itself is the credential) ----
    const sm = /^\/upload\/session\/(\w+)$/.exec(p);
    if (sm) {
      const s = ctl.sessions.get(sm[1]);
      if (!s || ctl.expireSessions) { res.writeHead(404); res.end(); return; }
      const cr = req.headers['content-range'] ?? '';
      const done = () => {
        if (!s.videoId) {
          const id = ('vid' + crypto.randomBytes(6).toString('hex')).slice(0, 11), m = s.meta;
          ctl.videos.set(id, { channelId: s.channelId, id, title: m.snippet.title, privacy: m.status.privacyStatus, publishAt: m.status.publishAt ?? '', madeForKids: m.status.selfDeclaredMadeForKids ?? null, synthetic: m.status.containsSyntheticMedia ?? null,
            category: m.snippet.categoryId, language: m.snippet.defaultLanguage, tags: m.snippet.tags, description: m.snippet.description, notify: s.notify, polls: 0, processed: false, thumbBytes: 0, thumbDims: '', thumbBeforeProcessed: false, publishedAt: new Date().toISOString() });
          s.videoId = id;
        }
        json(res, 201, { id: s.videoId, status: { privacyStatus: ctl.videos.get(s.videoId)!.privacy } });
      };
      if (/^bytes \*\//.test(cr)) { if (s.got >= s.total) { done(); return; } res.writeHead(308, s.got ? { range: `bytes=0-${s.got - 1}` } : {}); res.end(); return; }
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr); if (!m) { res.writeHead(400); res.end(); return; }
      if (Number(m[1]) !== s.got || raw.length !== Number(m[2]) - Number(m[1]) + 1) { res.writeHead(400); res.end('non-contiguous'); return; }
      if (ctl.fail503Once) { ctl.fail503Once = false; res.writeHead(503); res.end(); return; }
      if (ctl.slowChunkMs) await new Promise(r => setTimeout(r, ctl.slowChunkMs));
      s.got += raw.length; ctl.chunks++;
      if (ctl.dropAfterChunk === ctl.chunks) { ctl.dropAfterChunk = -1; req.socket.destroy(); return; } // bytes kept, answer lost
      if (s.got >= s.total) { done(); return; }
      res.writeHead(308, { range: `bytes=0-${s.got - 1}` }); res.end(); return;
    }
    // ---- everything else needs a valid bearer token ----
    if (!authed(req)) { gErr(res, 401, 'authError', 'Invalid Credentials'); return; }
    if (p === '/upload/youtube/v3/videos' && req.method === 'POST') {
      if (ctl.quota) { gErr(res, 403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.'); return; }
      const owner = tokenOf(req)!.channel;
      if (ctl.uploadLimit.has(owner)) { gErr(res, 400, 'uploadLimitExceeded', 'The user has exceeded the number of videos they may upload.'); return; }
      ctl.inserts++; ctl.insertsBy[owner] = (ctl.insertsBy[owner] ?? 0) + 1;
      const id = crypto.randomBytes(5).toString('hex');
      ctl.sessions.set(id, { total: Number(req.headers['x-upload-content-length']), got: 0, meta: JSON.parse(raw.toString()), notify: u.searchParams.get('notifySubscribers') ?? '', videoId: '', channelId: owner });
      res.writeHead(200, { location: `${base}/upload/session/${id}?upload_id=SECRETSESSION${id}` }); res.end(); return;
    }
    if (p === '/youtube/v3/channels') {
      const id = tokenOf(req)!.channel, ch = [...refreshes.values(), ctl.channel, FAKE_MAIN].find(c => c.id === id) ?? FAKE_MAIN;
      json(res, 200, { items: [{ id: ch.id, snippet: { title: ch.title, customUrl: ch.customUrl }, contentDetails: { relatedPlaylists: { uploads: 'UU' + ch.id } } }] }); return;
    }
    // a video can only be touched with its own channel's token (the real API answers 403 for another channel)
    const mine = (v: FakeVideo | undefined) => { if (v && v.channelId !== tokenOf(req)!.channel) { ctl.wrongChannel++; gErr(res, 403, 'forbidden', 'The video does not belong to this channel.'); return false; } return true; };
    if (p === '/youtube/v3/videos' && req.method === 'GET') {
      if (ctl.quota || ctl.quotaPoll) { gErr(res, 403, 'quotaExceeded'); return; }
      const ids = (u.searchParams.get('id') ?? '').split(',').map(id => ctl.videos.get(id)).filter(Boolean);
      if (!ids.every(v => mine(v))) return;
      const items = ids.map(v => { v!.polls++; if (v!.polls >= ctl.processingPolls) v!.processed = true; return vidView(v!); });
      json(res, 200, { items }); return;
    }
    if (p === '/youtube/v3/videos' && req.method === 'PUT') {
      if (ctl.quota || ctl.quotaPoll) { gErr(res, 403, 'quotaExceeded'); return; }
      const b = JSON.parse(raw.toString()), v = ctl.videos.get(b.id); if (!v) { gErr(res, 404, 'videoNotFound'); return; } if (!mine(v)) return;
      ctl.updates.push(`${b.id}:${b.status?.privacyStatus}:thumb=${v.thumbBytes > 0}`);
      v.privacy = b.status?.privacyStatus ?? v.privacy; json(res, 200, vidView(v)); return;
    }
    if (p === '/upload/youtube/v3/thumbnails/set') {
      const v = ctl.videos.get(u.searchParams.get('videoId') ?? ''); if (!v) { gErr(res, 404, 'videoNotFound'); return; } if (!mine(v)) return;
      if (ctl.thumbReject) { gErr(res, ctl.thumbReject, ctl.thumbReject === 403 ? 'forbidden' : 'uploadRateLimitExceeded'); return; }
      if (!v.processed) v.thumbBeforeProcessed = true;
      v.thumbBytes = raw.length; { const d = imageSize(raw); v.thumbDims = d ? `${d.width}x${d.height}` : 'unknown'; } json(res, 200, { items: [{ default: { url: 'x' } }] }); return;
    }
    if (p === '/youtube/v3/playlistItems') { const own = tokenOf(req)!.channel; json(res, 200, { items: [...ctl.videos.values()].filter(v => v.channelId === own).reverse().map(v => ({ snippet: { title: v.title, publishedAt: v.publishedAt, resourceId: { videoId: v.id } } })) }); return; }
    gErr(res, 404, 'notFound');
  });
  return new Promise<{ url: string; ctl: typeof ctl; secrets: () => string[]; close: () => void }>(ok => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    ok({ url: base, ctl, secrets: () => [refresh, ...everIssued, ...tokens.keys(), 'GOCSPX-fake-secret-123', 'SECRETSESSION'].filter(Boolean), close: () => { server.closeAllConnections(); server.close(); } });
  }));
}
