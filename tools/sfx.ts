// Sound library manager (credit-safe).
//   node tools/sfx.ts plan                 -> requests that are NOT yet in the library (only these may be generated)
//   node tools/sfx.ts import <id> <file>   -> convert (ffmpeg: mono 44.1 kHz 16-bit, trimmed, peak-normalised) and register
//   node tools/sfx.ts reprocess            -> re-run the conversion from assets/sfx/src/<id>.mp3 (no generation, no credits)
//   node tools/sfx.ts list                 -> what the library holds
// A request is identified by promptHash = sha1(model + prompt + duration). import refuses a hash that already
// exists, and plan never lists it, so the same prompt can never be generated (and paid for) twice.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DIR = path.resolve(import.meta.dirname, '../assets/sfx');
const REQ = JSON.parse(fs.readFileSync(path.join(DIR, 'requests.json'), 'utf8'));
const MAN = path.join(DIR, 'manifest.json');
const manifest = fs.existsSync(MAN) ? JSON.parse(fs.readFileSync(MAN, 'utf8')) : { version: 1, samples: [] };
export const promptHash = (r: { prompt: string; duration: number }) => createHash('sha1').update(`${REQ.model}|${r.prompt}|${r.duration}`).digest('hex').slice(0, 16);
const have = new Set(manifest.samples.map((s: any) => s.promptHash));
const [cmd, a, b] = process.argv.slice(2);

/** mono 44.1 kHz 16-bit, DC removed (high-pass 25 Hz), silence trimmed, loudness-normalised */
function convert(input: string, output: string) {
  const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le',
    '-af', 'highpass=f=25,silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
    output], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
}

if (cmd === 'plan') {
  const todo = REQ.requests.filter((r: any) => !have.has(promptHash(r)));
  console.log(JSON.stringify({ alreadyInLibrary: REQ.requests.length - todo.length, toGenerate: todo.map((r: any) => ({ ...r, promptHash: promptHash(r) })) }, null, 2));
} else if (cmd === 'import') {
  const r = REQ.requests.find((x: any) => x.id === a);
  if (!r) throw new Error('no request with id ' + a);
  const h = promptHash(r);
  if (have.has(h)) { console.error(`refused: ${a} (prompt hash ${h}) is already in the library`); process.exit(2); }
  const out = `${r.id}.wav`;
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true });
  const src = path.join(DIR, 'src', r.id + path.extname(b));
  if (path.resolve(b) !== src) fs.copyFileSync(b, src); // keep the paid-for original for local reprocessing
  convert(src, path.join(DIR, out));
  const dur = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(DIR, out)], { encoding: 'utf8' }).stdout);
  manifest.samples.push({ id: r.id, file: out, role: r.role, tags: r.tags, duration: +dur.toFixed(3), prompt: r.prompt, promptHash: h, source: 'elevenlabs', model: REQ.model, created: new Date().toISOString().slice(0, 10) });
  fs.writeFileSync(MAN, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`imported ${r.id} -> ${out} (${dur.toFixed(2)} s)`);
} else if (cmd === 'reprocess') {
  for (const smp of manifest.samples) {
    const src = fs.readdirSync(path.join(DIR, 'src')).find(f => f.startsWith(smp.id + '.'));
    if (!src) { console.log('no source for', smp.id); continue; }
    convert(path.join(DIR, 'src', src), path.join(DIR, smp.file));
    smp.duration = +parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(DIR, smp.file)], { encoding: 'utf8' }).stdout).toFixed(3);
    console.log('reprocessed', smp.id);
  }
  fs.writeFileSync(MAN, JSON.stringify(manifest, null, 2) + '\n');
} else {
  for (const s of manifest.samples) console.log(`${s.role.padEnd(8)} ${s.id.padEnd(16)} ${s.duration}s  ${s.source}  ${s.promptHash}`);
  if (!manifest.samples.length) console.log('(library empty — every role uses the synth fallback)');
}
