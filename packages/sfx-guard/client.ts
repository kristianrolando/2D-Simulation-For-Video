// The ONLY file in this project that talks to ElevenLabs over the network.
// It is imported only by tools/sfx.ts, which hands the client to the guard (packages/sfx-guard/guard.ts).
// Nothing in apps/ (studio, server, render) or the other packages imports it; tests/sfx-guard.test.ts checks that.
//
// No retries, ever: a paid call is sent once. fetch does not retry on its own, and redirects are refused.
// The API key is read from ELEVENLABS_API_KEY or ~/Library/Application Support/Sim Studio/elevenlabs.json
// ({"apiKey": "..."}, mode 600). It is never logged, never written to the ledger, never put in a URL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const supportDir = () => path.join(os.homedir(), 'Library', 'Application Support', 'Sim Studio');
const BASE = 'https://api.elevenlabs.io';

export interface Balance { used: number; limit: number; remaining: number; resetsAt: string | null }
export interface SoundRequest { text: string; durationSeconds: number; promptInfluence: number; loop: boolean; modelId: string; outputFormat: string }
export interface SfxClient {
  /** free call: the account's credit counter */
  getBalance(): Promise<Balance>;
  /** PAID call. Only the guard may call this. */
  generateSound(r: SoundRequest): Promise<Uint8Array>;
  /** values that must never appear in logs or the ledger */
  secrets(): string[];
}

export class ElevenLabsError extends Error {
  status: number; code: string; quota: boolean;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
    this.quota = /quota_exceeded|insufficient|credit|payment_required/i.test(code) || status === 402;
  }
}

export function loadApiKey(dir = supportDir()): { key: string | null; where: string; warning?: string } {
  if (process.env.ELEVENLABS_API_KEY) return { key: process.env.ELEVENLABS_API_KEY.trim(), where: 'environment variable ELEVENLABS_API_KEY' };
  const f = path.join(dir, 'elevenlabs.json');
  if (!fs.existsSync(f)) return { key: null, where: f };
  const mode = fs.statSync(f).mode & 0o777;
  let key: string | null = null;
  try { key = String(JSON.parse(fs.readFileSync(f, 'utf8')).apiKey ?? '').trim() || null; } catch { /* unreadable: treat as missing */ }
  return { key, where: f, warning: mode & 0o077 ? `${f} is readable by others (mode ${mode.toString(8)}); run: chmod 600 "${f}"` : undefined };
}

async function errorFrom(r: Response): Promise<ElevenLabsError> {
  let code = `http_${r.status}`, msg = r.statusText || 'request failed';
  try {
    const j: any = await r.json();
    const d = j?.detail;
    if (d && typeof d === 'object' && !Array.isArray(d)) { code = String(d.status ?? d.code ?? code); msg = String(d.message ?? msg); }
    else if (Array.isArray(d)) { code = 'validation_error'; msg = d.map((x: any) => x?.msg).filter(Boolean).join('; ') || msg; }
    else if (typeof d === 'string') msg = d;
  } catch { /* body is not JSON */ }
  return new ElevenLabsError(r.status, code, msg.slice(0, 300));
}

export function createElevenLabsClient(apiKey: string, fetchImpl: typeof fetch = fetch, base = BASE): SfxClient {
  const headers = { 'xi-api-key': apiKey };
  return {
    secrets: () => [apiKey],
    async getBalance() {
      const r = await fetchImpl(`${base}/v1/user/subscription`, { headers, redirect: 'error', signal: AbortSignal.timeout(30e3) });
      if (!r.ok) throw await errorFrom(r);
      const j: any = await r.json();
      const used = Number(j.character_count), limit = Number(j.character_limit);
      if (!Number.isFinite(used) || !Number.isFinite(limit)) throw new ElevenLabsError(r.status, 'bad_response', 'subscription response has no credit counter');
      return { used, limit, remaining: limit - used, resetsAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null };
    },
    async generateSound(q) {
      const r = await fetchImpl(`${base}/v1/sound-generation?output_format=${encodeURIComponent(q.outputFormat)}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180e3),
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ text: q.text, duration_seconds: q.durationSeconds, prompt_influence: q.promptInfluence, loop: q.loop, model_id: q.modelId }),
      });
      if (!r.ok) throw await errorFrom(r);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}
