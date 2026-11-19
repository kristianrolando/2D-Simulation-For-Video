// Videos → Compile: build long 16:9 videos from finished Shorts. Suggest a lineup, edit the clips and texts, build (the same queue as renders),
// look at the chapters and the checks, make the thumbnail. Everything is local: nothing here uploads anything (the uploader takes Shorts only).
import './compile.css';
import { friendlyError, fmtSize } from './ux.ts';
import type { Video } from '../../packages/publish/index.ts';

interface Issue { code: string; severity: 'error' | 'warn'; text: string }
interface Comp {
  id: string; slug: string; group: string; part: number; parts: number; title: string; titleIdeas: string[]; description: string; tags: string[]; hashtags: string[]; thumbText: string;
  clips: { videoId: string; label: string; frames: number; sceneId: string }[]; status: 'draft' | 'building' | 'built' | 'failed'; error: string; note: string;
  file: string; durationSec: number; sizeBytes: number; minutes: number; issues: Issue[]; fileExists: boolean; thumbUrl: string; chapters: string[]; starts: string[]; cacheGB: number;
  job: { id: string; status: string; progress: { frame: number; frames: number; phase: string } } | null;
}
interface LibClip { videoId: string; label: string; sceneId: string; seconds: number; usedBy: string }
interface Suggestion { usable: number; total: number; left: number; twins: number; parts: { group: string; part: number; parts: number; clipIds: string[]; count: number; minutes: number; title: string; created: boolean }[] }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response; try { r = await fetch(path, init); } catch (e) { throw new Error(friendlyError(e)); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? `The server answered ${r.status}.`); return b as T;
}
const STATUS_TEXT: Record<Comp['status'], string> = { draft: 'Draft', building: 'Building', built: 'Built', failed: 'Stopped' };
const PHASE: Record<string, string> = { queued: 'Waiting in the queue', normalize: 'Preparing clips', concat: 'Joining clips', verify: 'Checking the video', done: 'Done' };
const GROUP_NAME: Record<string, string> = { 'hammer-smash/split': 'Hammer smash: split', 'hammer-smash/box': 'Hammer smash: box', 'hammer-smash/survive': 'Hammer smash: survive', 'sync-lines/lid': 'Sync lines: lid', 'sync-lines/close': 'Sync lines: close', 'sync-lines/orbits': 'Sync lines: orbits', 'sync-lines/slider': 'Sync lines: slider', mix: 'Science simulations mix' };
const groupName = (c: Pick<Comp, 'group' | 'part' | 'parts'>) => `${GROUP_NAME[c.group] ?? c.group}${c.parts > 1 ? `, part ${c.part} of ${c.parts}` : ''}`;
const fmtMin = (m: number) => `${m.toFixed(1)} min`;

/** copy text; falls back to a selected text box when the clipboard is blocked */
async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = el('textarea', { value: text }) as HTMLTextAreaElement; ta.style.cssText = 'position:fixed;left:-9999px;opacity:0'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); return ok;
}

export interface CompileDeps { host: HTMLElement; onChange?: () => void }
export function initCompile(d: CompileDeps) {
  let comps: Comp[] = [], lib: LibClip[] = [], libInfo = { total: 0, usable: 0, left: 0 }, sug: Suggestion | null = null, selected = '', notice = '', error = '', readOnly = false, loaded = false, timer = 0, saveTimer = 0;
  const pending: Record<string, unknown> = {};

  async function load() {
    try {
      const r = await call<{ compilations: Comp[]; notice: string; readOnly: boolean; library: { total: number; usable: number; left: number; clips: LibClip[] } }>('/api/compile');
      comps = r.compilations; lib = r.library.clips; libInfo = r.library; readOnly = r.readOnly; notice = r.notice; error = ''; loaded = true;
      if (sug) sug = await call<Suggestion>('/api/compile/suggest').catch(() => sug); // the open suggestion follows what was created since
    } catch (e) { error = (e as Error).message; loaded = true; }
    poll(); render();
  }
  /** while something is building, look again every 1.5 s (the page that is not open does not poll) */
  function poll() { clearTimeout(timer); if (!d.host.hidden && comps.some(c => c.status === 'building')) timer = window.setTimeout(load, 1500); }
  const cur = () => comps.find(c => c.id === selected);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); error = ''; } catch (e) { error = (e as Error).message; } await load(); d.onChange?.(); };

  function flushSave(): Promise<void> {
    clearTimeout(saveTimer); const id = selected, body = { ...pending }; for (const k of Object.keys(pending)) delete pending[k];
    if (!id || !Object.keys(body).length) return Promise.resolve();
    return call<Comp>(`/api/compilations/${id}`, send('PATCH', body)).then(c => { const i = comps.findIndex(x => x.id === id); if (i >= 0) comps[i] = c; const m = document.getElementById('cmpIssues'); if (m && selected === id) renderIssues(c, m); }, e => { error = (e as Error).message; render(); });
  }
  const queue = (p: Record<string, unknown>) => { Object.assign(pending, p); clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void flushSave(), 700); };

  // ---------- views ----------
  function renderIssues(c: Comp, box: HTMLElement) {
    box.replaceChildren(...(c.issues.length ? c.issues.map(i => el('li', { className: 'q-' + i.severity }, el('b', { className: 'qb' }, i.severity === 'error' ? 'Fix' : 'Check'), ' ', i.text)) : [el('li', { className: 'q-ok' }, 'Texts check: all good ✓')]));
  }
  function suggestion() {
    const box = el('section', { className: 'cmp-sug' });
    if (!sug) return box;
    box.append(el('p', { className: 'msg' }, `${sug.usable} of ${sug.total} Shorts can be used (${sug.left} left out: their texts fail the quality check). ${sug.twins} near-identical Shorts count once.`));
    const t = el('table', { className: 'cmp-table' }); t.append(el('tr', {}, ...['Theme', 'Clips', 'Length', 'Title it would get', ''].map(h => el('th', {}, h))));
    for (const p of sug.parts) {
      const b = el('button', { type: 'button', className: p.created ? '' : 'primary' }, p.created ? 'Created' : 'Create') as HTMLButtonElement; b.disabled = p.created || readOnly;
      b.onclick = () => act(() => call('/api/compilations', send('POST', { group: p.group, clipIds: p.clipIds })).then(() => { p.created = true; }));
      t.append(el('tr', {}, el('td', {}, groupName(p)), el('td', {}, String(p.count)), el('td', {}, fmtMin(p.minutes)), el('td', {}, p.title), el('td', {}, b)));
    }
    const all = el('button', { type: 'button', className: 'primary' }, 'Create all as drafts') as HTMLButtonElement; all.disabled = readOnly || sug.parts.every(p => p.created);
    all.onclick = () => act(async () => { await call('/api/compilations', send('POST', { suggest: true })); sug = await call<Suggestion>('/api/compile/suggest'); });
    box.append(t, all);
    return box;
  }
  function card(c: Comp) {
    const pct = c.job && c.job.progress.frames ? Math.min(100, Math.round((100 * c.job.progress.frame) / c.job.progress.frames)) : 0;
    const row = el('button', { type: 'button', className: 'cmp-card' + (c.id === selected ? ' on' : '') + ' st-' + c.status });
    row.append(c.thumbUrl ? el('img', { src: c.thumbUrl, alt: '', className: 'cmp-thumb', loading: 'lazy' }) : el('span', { className: 'cmp-thumb none' }, 'No thumbnail'),
      el('span', { className: 'cmp-meta' }, el('b', { className: 'cmp-t' }, c.title || '(no title)'),
        el('span', { className: 'msg' }, `${groupName(c)} · ${c.clips.length} clips · ${fmtMin(c.minutes)}${c.status === 'built' && c.sizeBytes ? ' · ' + fmtSize(c.sizeBytes) : ''}`),
        c.status === 'building' ? el('span', { className: 'cmp-bar' }, el('i', { style: `width:${pct}%` }), el('em', {}, `${PHASE[c.job?.progress.phase ?? 'queued'] ?? 'Building'} ${pct}%`)) : '',
        c.issues.some(i => i.severity === 'error') ? el('span', { className: 'cmp-bad' }, `${c.issues.filter(i => i.severity === 'error').length} to fix`) : ''),
      el('span', { className: 'vbadge cmp-st st-' + c.status }, STATUS_TEXT[c.status]));
    row.onclick = async () => { await flushSave(); selected = c.id; render(); };
    return row;
  }
  function detail(c: Comp) {
    const box = el('section', { className: 'cmp-detail' }), ro = readOnly;
    const busy = c.status === 'building', locked = busy || ro;
    const back = el('button', { type: 'button', className: 'link' }, '← All long videos'); back.onclick = async () => { await flushSave(); selected = ''; render(); };
    // actions
    const build = el('button', { type: 'button', className: 'primary' }, c.status === 'built' ? 'Build again' : c.status === 'failed' ? 'Continue the build' : 'Build') as HTMLButtonElement; build.disabled = locked;
    build.onclick = () => act(async () => { await flushSave(); await call(`/api/compilations/${c.id}/build`, send('POST')); });
    const stop = el('button', { type: 'button' }, 'Stop') as HTMLButtonElement; stop.hidden = !busy; stop.onclick = () => act(() => call(`/api/compilations/${c.id}/stop`, send('POST')));
    const thumb = el('button', { type: 'button' }, 'Make the thumbnail again') as HTMLButtonElement; thumb.disabled = locked || !c.fileExists; thumb.title = c.fileExists ? 'Takes four frames from the Shorts and draws the number and words' : 'Available once the video is built';
    thumb.onclick = () => act(() => call(`/api/compilations/${c.id}/thumbnail`, send('POST')));
    const texts = el('button', { type: 'button', title: 'Chapters and numbers follow the clips as they are now. Your edits of the description are replaced.' }, 'Write the texts again') as HTMLButtonElement; texts.disabled = locked;
    texts.onclick = () => act(async () => { await flushSave(); await call(`/api/compilations/${c.id}`, send('PATCH', { rewrite: true })); });
    const open = el('a', { href: '/output/' + c.file, target: '_blank', className: 'btn' }, 'Play the video') as HTMLAnchorElement; open.hidden = !c.fileExists;
    const free = el('button', { type: 'button', title: 'Deletes only the prepared clips of this long video (about ' + c.cacheGB + ' GB). The Shorts and the finished video stay.' }, `Free disk (${c.cacheGB} GB)`) as HTMLButtonElement; free.disabled = locked || !c.cacheGB;
    free.onclick = () => act(() => call(`/api/compilations/${c.id}/cache`, send('DELETE')));
    const del = el('button', { type: 'button', className: 'danger' }, 'Remove this draft') as HTMLButtonElement; del.disabled = locked || c.status === 'built';
    del.onclick = () => { if (confirm('Remove this draft from the list? The Shorts are not touched.')) act(async () => { await call(`/api/compilations/${c.id}`, send('DELETE')); selected = ''; }); };
    box.append(back, el('h2', {}, groupName(c)), el('div', { className: 'row cmp-actions' }, build, stop, texts, thumb, open, free, del));
    if (c.status === 'building') box.append(el('p', { className: 'msg' }, `${PHASE[c.job?.progress.phase ?? 'queued'] ?? 'Building'}… finished clips are kept if you stop.`));
    if (c.error) box.append(el('p', { className: 'msg bad' }, c.error)); if (c.note) box.append(el('p', { className: 'msg' }, c.note));
    box.append(el('p', { className: 'msg' }, `${c.clips.length} clips · ${fmtMin(c.minutes)} · 1920×1080 · 60 fps · uploading long videos is not supported by the studio yet (and over 15 minutes YouTube needs a verified channel).`));

    // texts
    const field = (label: string, input: HTMLElement, hint = '') => el('div', { className: 'vfield' }, el('label', {}, el('span', {}, label), el('span', { className: 'v' }, hint)), input);
    const title = el('input', { type: 'text', value: c.title, maxLength: 100, disabled: locked }) as HTMLInputElement; title.oninput = () => queue({ title: title.value });
    const ideas = el('div', { className: 'cmp-ideas' }); c.titleIdeas.forEach((t, i) => { const b = el('button', { type: 'button', className: 'cmp-idea' + (t === c.title ? ' on' : ''), title: 'Use this title and write the description again' }, t) as HTMLButtonElement; b.disabled = locked; b.onclick = () => act(async () => { await flushSave(); await call(`/api/compilations/${c.id}`, send('PATCH', { titleIndex: i })); }); ideas.append(b); });
    const desc = el('textarea', { value: c.description, rows: 14, disabled: locked, spellcheck: false }) as HTMLTextAreaElement; desc.oninput = () => queue({ description: desc.value });
    const tags = el('input', { type: 'text', value: c.tags.join(', '), disabled: locked }) as HTMLInputElement; tags.oninput = () => queue({ tags: tags.value.split(',').map(s => s.trim()).filter(Boolean) });
    const hash = el('input', { type: 'text', value: c.hashtags.join(' '), disabled: locked }) as HTMLInputElement; hash.oninput = () => queue({ hashtags: hash.value.split(/\s+/).filter(Boolean) });
    const words = el('input', { type: 'text', value: c.thumbText, maxLength: 80, disabled: locked }) as HTMLInputElement; words.oninput = () => queue({ thumbText: words.value });
    const cp = (label: string, text: () => string) => { const b = el('button', { type: 'button', className: 'link' }, label); b.onclick = async () => { await flushSave(); b.textContent = (await copy(text())) ? 'Copied ✓' : 'Select the text and copy it'; setTimeout(() => { b.textContent = label; }, 1600); }; return b; };
    const issues = el('ul', { className: 'hints', id: 'cmpIssues' }); renderIssues(c, issues);
    box.append(field('Title', title, `${c.title.length}/100`), ideas, field('Description (the chapters are part of it)', desc, `${new TextEncoder().encode(c.description).length}/5000 bytes`), field('Tags', tags), field('Hashtags (three are shown)', hash), field('Words on the thumbnail', words), issues,
      el('div', { className: 'row' }, cp('Copy title', () => cur()!.title), cp('Copy description with hashtags', () => `${cur()!.description}\n\n${cur()!.hashtags.join(' ')}`), cp('Copy tags', () => cur()!.tags.join(', '))));
    if (c.thumbUrl) box.append(el('img', { src: c.thumbUrl, alt: 'Thumbnail, 1280 by 720', className: 'cmp-bigthumb' }));

    // clips
    const list = el('ol', { className: 'cmp-clips' });
    c.clips.forEach((k, i) => {
      const move = (by: number) => act(async () => { await flushSave(); const ids = c.clips.map(x => x.videoId); const j = i + by; [ids[i], ids[j]] = [ids[j], ids[i]]; await call(`/api/compilations/${c.id}`, send('PATCH', { clipIds: ids })); });
      const up = el('button', { type: 'button', title: 'Move up' }, '↑') as HTMLButtonElement, dn = el('button', { type: 'button', title: 'Move down' }, '↓') as HTMLButtonElement, rm = el('button', { type: 'button', title: 'Take it out' }, '✕') as HTMLButtonElement;
      up.disabled = locked || i === 0; dn.disabled = locked || i === c.clips.length - 1; rm.disabled = locked || c.clips.length <= 1;
      up.onclick = () => move(-1); dn.onclick = () => move(1); rm.onclick = () => act(async () => { await flushSave(); await call(`/api/compilations/${c.id}`, send('PATCH', { clipIds: c.clips.filter((_, x) => x !== i).map(x => x.videoId) })); });
      list.append(el('li', {}, el('span', { className: 'cmp-time' }, c.starts[i] ?? ''), el('span', { className: 'cmp-lab' }, k.label), el('span', { className: 'msg' }, `${(k.frames / 60).toFixed(0)} s`), up, dn, rm));
    });
    const free_ = lib.filter(x => !x.usedBy), pick = el('select', { disabled: locked || !free_.length }) as HTMLSelectElement;
    pick.append(el('option', { value: '' }, free_.length ? `Add a clip (${free_.length} not used yet)…` : 'Every usable Short is already in a long video'));
    for (const x of free_) pick.append(el('option', { value: x.videoId }, `${x.label} · ${x.sceneId}`));
    pick.onchange = () => { if (!pick.value) return; const ids = [...c.clips.map(x => x.videoId), pick.value]; void act(async () => { await flushSave(); await call(`/api/compilations/${c.id}`, send('PATCH', { clipIds: ids })); }); };
    box.append(el('h3', {}, 'Clips'), el('p', { className: 'msg' }, 'Changing the clips writes the title and description again (the chapter times follow the real clip lengths).'), list, pick);
    return box;
  }
  function render() {
    const host = d.host; host.replaceChildren();
    if (!loaded) { host.append(el('p', { className: 'empty' }, 'Loading…')); return; }
    if (error) host.append(el('p', { className: 'msg bad' }, error));
    if (notice) host.append(el('p', { className: 'msg' }, notice));
    if (readOnly) host.append(el('p', { className: 'msg bad' }, 'Another studio owns the data folder, so this page is read-only.'));
    const c = cur(); if (c) { host.append(detail(c)); return; }
    const sBtn = el('button', { type: 'button', className: 'primary' }, sug ? 'Hide the suggestion' : 'Suggest long videos') as HTMLButtonElement;
    sBtn.onclick = () => { if (sug) { sug = null; render(); } else void act(async () => { sug = await call<Suggestion>('/api/compile/suggest'); }); };
    host.append(el('div', { className: 'row cmp-top' }, el('h2', {}, 'Long videos'), sBtn), el('p', { className: 'msg' }, `${libInfo.usable} of ${libInfo.total} Shorts can be joined into 16:9 long videos (9–18 minutes, one theme each). Nothing is uploaded.`));
    if (sug) host.append(suggestion());
    if (!comps.length) host.append(el('p', { className: 'empty' }, 'No long videos yet. Press "Suggest long videos" to see the lineup, then create the drafts.'));
    else host.append(el('div', { className: 'cmp-list' }, ...comps.map(card)));
  }
  return { show: () => { render(); void load(); }, hide: async () => { clearTimeout(timer); await flushSave(); }, refresh: load };
}

/** The Videos-list detail of a long video: the facts, the texts to copy and the owner's own tracking (status, link). The texts are edited on the Compile page. */
export function longDetail(v: Video & { fileExists: boolean; thumbUrl: string }, box: HTMLElement, o: { patch: (p: Record<string, unknown>, now?: boolean) => void; openCompile: () => void; statusBar: HTMLElement; note: string }) {
  const open = el('button', { type: 'button', className: 'primary' }, 'Edit in Compile'); open.onclick = o.openCompile;
  const cp = (label: string, text: string) => { const b = el('button', { type: 'button' }, label); b.onclick = async () => { b.textContent = (await copy(text)) ? 'Copied ✓' : 'Select and copy by hand'; setTimeout(() => { b.textContent = label; }, 1600); }; return b; };
  // the same button and the same call as a Short's detail; a missing file is answered by the server and shown right under the header
  const where = el('p', { className: 'msg', role: 'status' }), reveal = el('button', { type: 'button' }, 'Show MP4 in folder');
  reveal.onclick = async () => { where.textContent = ''; where.className = 'msg'; try { await call('/api/reveal', send('POST', { file: v.file })); } catch (e) { where.textContent = (e as Error).message; where.className = 'msg bad'; } };
  box.append(el('div', { className: 'vhead' }, el('div', {}, el('h2', {}, v.title), el('p', { className: 'msg' }, el('span', { className: 'vbadge ch', title: `Channel: ${v.channel || 'Photon Lab'}` }, v.channel || 'Photon Lab'), ` Long video · 1920×1080 · 60 fps · ${(v.durationSec / 60).toFixed(1)} min${v.sizeBytes ? ' · ' + fmtSize(v.sizeBytes) : ''}${v.fileExists ? '' : ' · MP4 missing'}`)),
    el('div', { className: 'row' }, open, cp('Copy title', v.title), cp('Copy description with hashtags', `${v.description}\n\n${v.hashtags.join(' ')}`), cp('Copy tags', v.tags.join(', ')), reveal)),
    where, o.statusBar, el('p', { className: 'next' }, o.note));
  if (v.thumbUrl) box.append(el('img', { src: v.thumbUrl, alt: 'Thumbnail, 1280 by 720', className: 'cmp-bigthumb' }));
  if (v.fileExists) box.append(el('video', { src: '/output/' + v.file, controls: true, preload: 'metadata', className: 'cmp-video' }));
  const notes = el('textarea', { value: v.notes, rows: 4, placeholder: 'Notes (only for you)' }) as HTMLTextAreaElement; notes.oninput = () => o.patch({ notes: notes.value });
  box.append(el('div', { className: 'vfield' }, el('label', {}, el('span', {}, 'Notes')), notes));
}
