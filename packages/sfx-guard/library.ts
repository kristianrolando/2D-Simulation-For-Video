// The local sound library (assets/sfx): request list, manifest, hashes and import. No network, no credits.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export interface SfxRequest {
  id: string; role: string; duration: number; prompt: string; tags?: string[];
  promptInfluence?: number; loop?: boolean; outputFormat?: string;
}
export interface RequestFile { model: string; requests: SfxRequest[]; outputFormat?: string }
export interface ManifestSample {
  id: string; file: string; role: string; tags?: string[]; duration: number; prompt: string;
  promptHash: string; guardHash?: string; source: string; model?: string; created?: string;
}
export interface Manifest { version: 1; samples: ManifestSample[] }

export const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
export const DEFAULT_PROMPT_INFLUENCE = 0.3;

/** Hash used since the first batch (model + prompt + duration). Kept so existing entries still match. */
export const legacyHash = (model: string, r: { prompt: string; duration: number }) =>
  createHash('sha1').update(`${model}|${r.prompt}|${r.duration}`).digest('hex').slice(0, 16);

export const normalizePrompt = (p: string) => p.trim().replace(/\s+/g, ' ').toLowerCase();

export function params(file: RequestFile, r: SfxRequest) {
  return {
    modelId: file.model, durationSeconds: r.duration,
    promptInfluence: r.promptInfluence ?? DEFAULT_PROMPT_INFLUENCE,
    loop: r.loop ?? false,
    outputFormat: r.outputFormat ?? file.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
  };
}

/** Hash of the normalised prompt plus every parameter that changes what is generated (and paid for). */
export function guardHash(file: RequestFile, r: SfxRequest) {
  const p = params(file, r);
  return createHash('sha1').update(JSON.stringify({ m: p.modelId, p: normalizePrompt(r.prompt), d: p.durationSeconds, i: p.promptInfluence, l: p.loop, f: p.outputFormat })).digest('hex').slice(0, 16);
}

export function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export const readRequests = (dir: string): RequestFile => JSON.parse(fs.readFileSync(path.join(dir, 'requests.json'), 'utf8'));
export function readManifest(dir: string): Manifest {
  const f = path.join(dir, 'manifest.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { version: 1, samples: [] };
}

/** files that already exist for a request id: the converted wav and any paid-for original in src/ */
export function existingFiles(dir: string, id: string): string[] {
  const out: string[] = [];
  if (fs.existsSync(path.join(dir, id + '.wav'))) out.push(id + '.wav');
  const src = path.join(dir, 'src');
  if (fs.existsSync(src)) for (const f of fs.readdirSync(src)) if (f.startsWith(id + '.')) out.push('src/' + f);
  return out;
}

export interface Converter { convert(input: string, output: string): void; duration(file: string): number }

/** mono 44.1 kHz 16-bit, DC removed (high-pass 25 Hz), silence trimmed, loudness-normalised */
export const ffmpegConverter: Converter = {
  convert(input, output) {
    const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le',
      '-af', 'highpass=f=25,silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
      output], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(res.stderr);
  },
  duration(file) {
    return parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
  },
};

/** Register a source file (already on disk in src/ or elsewhere) for request `id`. Refuses anything already in the library. */
export function importSample(dir: string, id: string, file: string, conv: Converter = ffmpegConverter, today = new Date().toISOString().slice(0, 10)) {
  const reqs = readRequests(dir), man = readManifest(dir);
  const r = reqs.requests.find(x => x.id === id);
  if (!r) throw new Error('no request with id ' + id);
  const lh = legacyHash(reqs.model, r), gh = guardHash(reqs, r);
  const dup = man.samples.find(s => s.id === id || s.promptHash === lh || (s.guardHash && s.guardHash === gh));
  if (dup) throw new Error(`refused: ${id} (prompt hash ${lh}) is already in the library as ${dup.id}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const src = path.join(dir, 'src', id + (path.extname(file) || '.mp3'));
  if (path.resolve(file) !== src) {
    if (fs.existsSync(src)) throw new Error(`refused: ${path.relative(dir, src)} already exists (a paid-for original is never overwritten)`);
    fs.copyFileSync(file, src);
  }
  const out = path.join(dir, id + '.wav');
  conv.convert(src, out);
  const dur = conv.duration(out);
  man.samples.push({ id, file: id + '.wav', role: r.role, tags: r.tags, duration: +dur.toFixed(3), prompt: r.prompt, promptHash: lh, guardHash: gh, source: 'elevenlabs', model: reqs.model, created: today });
  writeJsonAtomic(path.join(dir, 'manifest.json'), man);
  return { id, file: id + '.wav', duration: dur };
}
