// Videos view: texts to copy, status, link and thumbnail frame for every video, plus a coverage map of
// which scene × style combinations were never made. Everything is a local file on the server. Uploading to YouTube
// only happens from the YouTube section (youtube-ui.ts), with the owner's tick per video.
import {
  STATUSES, STATUS_LABEL, LIMITS, filterVideos, statusCounts, coverage, nextStep, tagsLength, parseTags, parseHashtags,
  descriptionWithHashtags, tagsText, utf8Bytes, copyAll, isYoutubeUrl, type Video, type Status,
} from '../../packages/publish/index.ts';
import { suggestFor, topicFor, factsFor, hookFor, descriptionFor } from '../../packages/publish/describe.ts';
import { checkQuality, qualitySummary, SEVERITY_LABEL } from '../../packages/publish/quality.ts';
import { coverText, COVER_TEXT_MAX } from '../../packages/publish/cover.ts';
import { getTheme } from '../../packages/theme/index.ts';
import { friendlyError, fmtSize, needsCounts, firstNeeding, uploadFailed, uploadRunning, uploadWaiting } from './ux.ts';
import { icon } from './icons.ts';
import { initCalendar } from './calendar-ui.ts';
import { initCompile, longDetail } from './compile-ui.ts';
import {
  FORMATS, FORMAT_LABEL, FORMAT_HINT, SORTS, SORT_LABEL, NO_FILTERS, formatCounts, formatOf, inFormat, statusCountsIn, parseHash, formatHash, writeFormat, startNav, browserStore, readSort,
  bannerVisible, bannerText, bannerHelp, addConfirmText, dismissBanner, readDismissed, sortVideos, optionsOf, channelOf, readReverse, writeReverse, type Format, type Mode, type Sort,
} from './videos-nav.ts';
import { rows as rowsFor, chipCounts, channelChoices, channelCards, channelFacts, summaryLine, activeLine, hasActive, validChannel, loadView, saveView, NO_CHANNEL, type ViewState, type ViewCtx } from './videos-view.ts';
import { toCsv } from '../../packages/publish/index.ts';
import './videos-nav.css';
import { youtubePanel, openYoutubeSettings, loadYt, ytState, channelPicker, manualUpload } from './youtube-ui.ts';
import type { SceneModule } from '../../packages/core/index.ts';

type VideoView = Video & { fileExists: boolean; thumbUrl: string; coverUrl: string; thumbProblem?: string };
export interface VideosDeps { scenes: SceneModule[]; styleIds: () => string[]; openScene: (sceneId: string, style: string) => void; onVisibility?: (shown: boolean) => void }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const SYMBOL: Record<string, string> = { none: '·', draft: '○', rendered: '◐', scheduled: '◔', published: '●' };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(path, init); } catch (e) { throw new Error(friendlyError(e)); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `The server answered ${r.status}.`);
  return body as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** a record from an older server may miss newer fields: give them empty values so the page never shows "undefined" */
const fix = (v: VideoView): VideoView => ({ ...v, coverText: v.coverText ?? '', coverFile: v.coverFile ?? '', thumbUrl: v.thumbUrl ?? '', coverUrl: v.coverUrl ?? '', notes: v.notes ?? '' });
const wide = () => !matchMedia('(max-width: 900px)').matches;
const secOpen = (name: string, dflt: boolean) => { try { const v = localStorage.getItem('studio.sec.' + name); return v === null ? dflt : v === '1'; } catch { return dflt; } };

export function initVideos(deps: VideosDeps) {
  let videos: VideoView[] = [], selected = '', status: Status | 'all' = 'all', focus: '' | 'failed' | 'uploading' = '', query = '', untracked = 0, dataDir = 'data', loaded = false, readOnly = false, readOnlyReason = '', lang: 'en' | 'id' = 'en';
  // what the page is showing: the format (All / Shorts / Long), the view, and the extra filters; the format is remembered and is in the address
  const store = browserStore(), first = startNav(location.hash, store);
  let format: Format = first.format, mode: Mode = first.mode, sceneF = '', styleF = '', channelF = '', sortBy: Sort = readSort(store), reverse = readReverse(store), untrackedFiles: string[] = [], manual: string[] = [];
  { const s = loadView(store); channelF = s.channel; status = s.status; query = s.query; sceneF = s.scene; styleF = s.style; } // what was on last time (checked against the real list once it has loaded)
  /** what the list is filtered by, as one value: every count and the rows come from it (videos-view.ts) */
  const viewState = (): ViewState => ({ format, channel: channelF, status, query, scene: sceneF, style: styleF });
  const viewCtx = (): ViewCtx => ({ sceneName, styleName, extra: focus === 'failed' ? uploadFailed : focus === 'uploading' ? uploadRunning : undefined });
  /** the channels the studio knows, in the order they are listed: connected ones first, then the ones added by hand */
  const knownChannels = () => [...(ytState()?.connections ?? []).map(c => ({ name: c.name, kind: 'connected' as const })), ...manual.filter(m => !(ytState()?.connections ?? []).some(c => c.name === m)).map(name => ({ name, kind: 'manual' as const }))];
  const sceneName = (id: string) => id === 'compilation' ? 'Long video' : deps.scenes.find(s => s.meta.id === id)?.meta.name ?? id;
  const styleName = (id: string) => getTheme(id).name;
  const autoTried = new Set<string>(); // videos whose cover was already tried (or that were opened for you, so nothing is made behind your back)
  const view = $('vview'), save = { timer: 0, pending: {} as Record<string, unknown>, id: '', state: '' };

  // ---------- data ----------
  async function refresh() {
    try {
      const r = await call<{ videos: VideoView[]; notice: { level: string; text: string } | null; untracked: number; untrackedFiles?: string[]; dataDir: string; readOnly: boolean; readOnlyReason: string; settings: { suggestLang: 'en' | 'id'; manualChannels?: string[] } }>('/api/videos');
      videos = r.videos.map(fix); untracked = r.untracked; untrackedFiles = r.untrackedFiles ?? []; dataDir = r.dataDir; loaded = true; readOnly = r.readOnly; readOnlyReason = r.readOnlyReason; lang = r.settings.suggestLang; manual = r.settings.manualChannels ?? [];
      if (r.notice) banner(r.notice.text);
      await loadYt();
    } catch (e) { banner((e as Error).message); }
    badge(); if (!view.hidden) { render(); if (view.dataset.mode === 'calendar') void calendar.show(); }
    watchUpload();
  }
  /** while an upload runs: update its progress every second; reload the list when a step changes */
  let ytTimer = 0, lastStage = '';
  function watchUpload() {
    clearTimeout(ytTimer);
    const running = () => ytState()?.live || videos.some(v => v.youtube && ((v.youtube.stage !== 'done' && v.youtube.stage !== 'failed') || v.youtube.waitUntil));
    if (!running()) { lastStage = ''; return; }
    ytTimer = window.setTimeout(async () => {
      const s = await loadYt(), key = s?.live ? `${s.live.videoId}:${s.live.stage}` : 'idle';
      if (key !== lastStage) { lastStage = key; await refresh(); return; }
      if (!view.hidden && s?.live?.videoId === selected) renderDetail();
      watchUpload();
    }, 1000);
  }
  function badge() {
    const n = statusCounts(videos.filter(v => v.kind !== 'long')).rendered, b = $('videosBadge'); // long videos cannot be uploaded from the studio, so they are not "waiting for you"
    b.hidden = n === 0; b.textContent = String(n); b.title = `${n} rendered, not scheduled or published yet`; b.setAttribute('aria-label', b.title);
  }
  function banner(text: string) {
    const box = $('vNotice'); (box.firstElementChild as HTMLElement).textContent = text; box.hidden = !text;
  }
  $('vNotice').querySelector('button')!.onclick = () => banner('');

  /** edits are saved a moment after typing stops; status changes save at once */
  function queueSave(id: string, patch: Record<string, unknown>, now = false): Promise<void> {
    if (save.id && save.id !== id) void flush();
    save.id = id; Object.assign(save.pending, patch); setSaveState('Saving…');
    clearTimeout(save.timer);
    if (now) return flush();
    save.timer = window.setTimeout(() => void flush(), 500);
    return Promise.resolve();
  }
  /** saves run one after another, so a later flush() always waits for the one in flight */
  let chain: Promise<void> = Promise.resolve();
  function flush(): Promise<void> {
    clearTimeout(save.timer);
    const run = chain.then(doFlush); chain = run.catch(() => {}); return run;
  }
  async function doFlush(): Promise<void> {
    const id = save.id, patch = save.pending; save.pending = {}; save.id = '';
    if (!id || !Object.keys(patch).length) return;
    try {
      const v = await call<VideoView>(`/api/videos/${id}`, send('PATCH', patch));
      const i = videos.findIndex(x => x.id === id); if (i >= 0) videos[i] = fix(v);
      setSaveState('Saved ✓'); badge(); renderList(); renderChips(); updateDerived();
    } catch (e) { setSaveState('Not saved: ' + (e as Error).message, true); }
  }
  addEventListener('pagehide', () => { void flush(); });
  function setSaveState(t: string, bad = false) { const s = document.getElementById('vSaved'); if (s) { s.textContent = t; s.className = 'msg' + (bad ? ' bad' : ''); } }

  // ---------- list / calendar ----------
  const calendar = initCalendar({ host: $('vCal'), videos: () => videos, format: () => format, channel: () => channelF, sceneName, open: async (id) => { setMode('list'); await flush(); selected = id; view.dataset.step = 'detail'; render(); } });
  const compile = initCompile({ host: $('vCompile'), onChange: () => { void refresh(); } });
  /** the address names the state (#videos/long/build), so it can be linked and the back button walks through it; it is only written while the page is open */
  function syncHash() { if (view.hidden) return; const h = formatHash({ format, mode }); if (location.hash !== h) { try { history.pushState(null, '', h); } catch { /* the address is a convenience */ } } }
  function setMode(m: Mode, push = true) {
    mode = m; view.dataset.mode = m;
    $('vCal').hidden = m !== 'calendar'; $('vCompile').hidden = m !== 'build'; document.querySelector<HTMLElement>('#vview .vbody')!.hidden = m !== 'list';
    for (const [id, k] of [['vModeList', 'list'], ['vModeCal', 'calendar'], ['vModeCompile', 'build']] as const) $(id).setAttribute('aria-pressed', String(m === k));
    $('vBar').hidden = m !== 'list'; // search, filters and sorting belong to the list
    if (m === 'calendar') void calendar.show(); if (m === 'build') compile.show(); else void compile.hide(); if (m === 'list') void refresh(); // long videos finish while another page is open
    renderBanner(); if (push) syncHash();
  }
  function setFormat(f: Format, push = true) {
    format = f; writeFormat(store, f);
    if (mode === 'build') setMode('list', false); // the builder has no format: picking one takes you back to the videos
    if (selected && !inFormat(videos, f).some(v => v.id === selected)) selected = '';
    sceneF = styleF = ''; render(); if (mode === 'calendar') calendar.render(); if (push) syncHash(); // the channel stays: it is not a part of a format
  }
  $('vModeList').onclick = () => setMode('list'); $('vModeCal').onclick = () => setMode('calendar'); $('vModeCompile').onclick = () => setMode('build');
  /** the address changed (a link, the back button, the menu bar app): follow it */
  function applyHash() {
    const h = parseHash(location.hash);
    if (!h) { if (shown()) void hide(); return; }
    if (h.format && h.format !== format) { format = h.format; writeFormat(store, format); sceneF = styleF = ''; }
    if (!shown()) show(undefined, false);
    const m = h.mode ?? 'list'; if (m !== mode) setMode(m, false); else if (h.format) { render(); if (mode === 'calendar') calendar.render(); }
  }
  addEventListener('hashchange', applyHash);

  // ---------- show / hide ----------
  function show(id?: string, push = true) {
    if (id) selected = id;
    view.hidden = false; document.body.classList.add('view-videos'); view.dataset.step = id ? 'detail' : 'list';
    $('navStudio').setAttribute('aria-pressed', 'false'); $('navVideos').setAttribute('aria-pressed', 'true');
    deps.onVisibility?.(true); setMode(mode, false); render(); if (push) syncHash();
    refresh().then(() => {
      if (id && !videos.some(v => v.id === id)) selected = '';
      const sv = videos.find(v => v.id === selected); if (sv && !inFormat([sv], format).length) { format = formatOf(sv); writeFormat(store, format); syncHash(); } // a video opened from a render belongs to its own format
      if (!selected && wide() && mode === 'list') { const f = firstNeeding(filterVideos(inFormat(videos, format), { status: 'all', query: '' }, { scene: sceneName, style: styleName })); if (f) { selected = f.id; autoTried.add(f.id); } } // open the one that needs you first
      render();
    });
  }
  async function hide() {
    await flush();
    view.hidden = true; document.body.classList.remove('view-videos');
    $('navStudio').setAttribute('aria-pressed', 'true'); $('navVideos').setAttribute('aria-pressed', 'false');
    if (parseHash(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* the address is a convenience */ } }
    deps.onVisibility?.(false);
  }
  const shown = () => !view.hidden;
  $('navStudio').onclick = hide; $('vBack').onclick = hide; $('navVideos').onclick = () => (shown() ? hide() : show());

  // ---------- top bar ----------
  /** All / Shorts / Long with their counts (a radio group: arrow keys move the choice) */
  function renderFormat() {
    const box = $('vFormat'), c = chipCounts(videos, viewState(), viewCtx()).formats, hadFocus = box.contains(document.activeElement); box.replaceChildren();
    for (const f of FORMATS) {
      const b = el('button', { type: 'button', className: f === format ? 'on' : '' }, `${FORMAT_LABEL[f]} `, el('span', { className: 'n' }, String(c[f])));
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(f === format)); b.tabIndex = f === format ? 0 : -1; b.title = FORMAT_HINT[f]; b.dataset.format = f;
      b.onclick = () => setFormat(f);
      b.onkeydown = (e) => {
        const i = FORMATS.indexOf(f), to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % FORMATS.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + FORMATS.length - 1) % FORMATS.length : -1;
        if (to < 0) return; e.preventDefault(); setFormat(FORMATS[to]); $('vFormat').querySelector<HTMLElement>(`[data-format=${FORMATS[to]}]`)?.focus();
      };
      box.append(b);
    }
    if (hadFocus) box.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
  }
  function renderChips() {
    const box = $('vChips'), c = chipCounts(videos, viewState(), viewCtx()).statuses; box.replaceChildren();
    for (const s of ['all', ...STATUSES] as const) {
      const b = el('button', { type: 'button', className: 'chip' + (status === s ? ' on' : '') }, `${s === 'all' ? 'All' : STATUS_LABEL[s]} ${c[s]}`);
      b.setAttribute('aria-pressed', String(status === s)); if (s !== 'all') b.dataset.status = s;
      b.onclick = () => { status = s; focus = ''; render(); }; box.append(b);
    }
  }
  /** the menus of the toolbar: only simulations and styles that exist in this format; none for long videos (they have no simulation or style) */
  const channelSel = $<HTMLSelectElement>('vChannel'), sceneSel = $<HTMLSelectElement>('vScene'), styleSel = $<HTMLSelectElement>('vStyle'), sortSel = $<HTMLSelectElement>('vSort');
  function renderToolbar() {
    const o = optionsOf(inFormat(videos, format)), long = format === 'long';
    if (loaded) { if (!o.scenes.includes(sceneF)) sceneF = ''; if (!o.styles.includes(styleF)) styleF = ''; } // a choice that no longer exists falls back to "all" (not before the list has loaded: then everything would look missing)
    const fill = (sel: HTMLSelectElement, all: string, items: [string, string][], val: string) => { sel.replaceChildren(el('option', { value: '' }, all), ...items.map(([v, t]) => el('option', { value: v }, t))); sel.value = val; };
    fill(sceneSel, 'All simulations', o.scenes.map(id => [id, sceneName(id)]), sceneF); fill(styleSel, 'All styles', o.styles.map(id => [id, styleName(id)]), styleF);
    sceneSel.hidden = styleSel.hidden = long;
    // the channel menu: every channel with its number (what you would see if you picked it); it exists once there is more than one choice
    if (loaded) channelF = validChannel(channelF, videos, knownChannels());
    const { all, choices } = channelChoices(videos, knownChannels(), viewState(), viewCtx());
    channelSel.hidden = choices.length < 2;
    fill(channelSel, `All channels · ${all.toLocaleString('en-US')}`, choices.map(c => [c.key, `${c.name} · ${c.count.toLocaleString('en-US')}`]), channelF);
    sortSel.replaceChildren(...SORTS.map(k => el('option', { value: k }, SORT_LABEL[k]))); sortSel.value = sortBy;
    const dir = $('vSortDir'); dir.textContent = reverse ? '↑' : '↓'; dir.setAttribute('aria-label', reverse ? 'Sort direction: reversed' : 'Sort direction: normal'); dir.setAttribute('aria-pressed', String(reverse));
    $('vCsv').textContent = `Spreadsheet (CSV): ${FORMAT_LABEL[format].toLowerCase()}`;
  }
  channelSel.onchange = () => { channelF = channelSel.value; render(); if (mode === 'calendar') calendar.render(); };
  sceneSel.onchange = () => { sceneF = sceneSel.value; renderList(); }; styleSel.onchange = () => { styleF = styleSel.value; renderList(); };
  sortSel.onchange = () => { sortBy = sortSel.value as Sort; store.set('studio.vsort', sortBy); renderList(); };
  $('vSortDir').onclick = () => { reverse = !reverse; writeReverse(store, reverse); renderToolbar(); renderList(); };
  const searchBox = $<HTMLInputElement>('vSearch');
  searchBox.oninput = () => { query = searchBox.value; renderList(); };
  searchBox.onkeydown = (e) => { if (e.key === 'Escape' && searchBox.value) { e.stopPropagation(); searchBox.value = query = ''; renderList(); } };
  const clearFilters = () => { status = 'all'; focus = ''; query = ''; sceneF = styleF = channelF = ''; searchBox.value = ''; render(); };
  $('vReset').onclick = clearFilters;
  searchBox.value = query; // a remembered search
  const impBtn = $('vAddAll') as HTMLButtonElement;
  /** the one line under the toolbar: what is on, how many rows that gives, and the one-click way out (only when something is on) */
  function renderActive(shown: number) {
    const box = $('vActive'), on = hasActive(viewState(), focus);
    box.hidden = !on || mode === 'build';
    if (!on) return;
    (box.firstElementChild as HTMLElement).textContent = `${shown.toLocaleString('en-US')} of ${inFormat(videos, format).length.toLocaleString('en-US')} shown · ${activeLine(viewState(), viewCtx(), focus)}`;
  }
  /** the channel strip: one line for the chosen channel (or all), and a card per channel to compare them; a click on a card filters to it */
  function renderChannels() {
    const box = $<HTMLDetailsElement>('vChannels'), cards = $('vCards');
    const { choices } = channelChoices(videos, knownChannels(), viewState(), viewCtx());
    box.hidden = mode === 'build' || !loaded || choices.length < 2;
    if (box.hidden) return;
    const chosen = channelF ? choices.find(c => c.key === channelF) : undefined;
    $('vSummary').textContent = summaryLine(channelFacts(videos, channelF, chosen?.name));
    cards.replaceChildren();
    for (const f of channelCards(videos, choices)) {
      const on = f.key === channelF;
      const b = el('button', { type: 'button', className: 'vcard' + (on ? ' on' : '') },
        el('b', {}, f.name), el('span', { className: 'vtotal' }, `${f.total.toLocaleString('en-US')} video${f.total === 1 ? '' : 's'}`),
        el('span', { className: 'vparts' }, `${f.statuses.rendered.toLocaleString('en-US')} rendered · ${f.statuses.scheduled.toLocaleString('en-US')} scheduled · ${f.statuses.published.toLocaleString('en-US')} published${f.statuses.draft ? ` · ${f.statuses.draft} draft` : ''}`),
        el('span', { className: 'vparts' }, `${f.shorts.toLocaleString('en-US')} Shorts · ${f.long.toLocaleString('en-US')} Long`));
      b.setAttribute('aria-pressed', String(on)); b.title = f.key === '' ? 'Show the videos of every channel' : `Show only ${f.name}`;
      b.onclick = () => { channelF = on ? '' : f.key; render(); if (mode === 'calendar') calendar.render(); };
      cards.append(b);
    }
  }
  /** renders in output/ that are not in the list: say how many, ask before adding, add exactly the files that were counted */
  function renderBanner() {
    const n = untrackedFiles.length, ub = $('vUntracked');
    ub.hidden = !bannerVisible({ files: untrackedFiles, dismissedSig: readDismissed(store), readOnly, format, mode });
    ub.querySelector('b')!.textContent = bannerText(n);
    ub.querySelector('.vhelp')!.textContent = ` ${bannerHelp(n)}`;
    impBtn.textContent = n === 1 ? 'Add it to the list…' : `Add all ${n} to the list…`;
  }
  impBtn.onclick = async () => {
    const files = [...untrackedFiles]; if (!files.length || !confirm(addConfirmText(files.length))) return;
    impBtn.disabled = true;
    try { const r = await call<{ added: number; videos: VideoView[] }>('/api/videos/import', send('POST', { files })); videos = r.videos.map(fix); untrackedFiles = []; untracked = 0; banner(`Added ${r.added} render${r.added === 1 ? '' : 's'} to the list.`); }
    catch (e) { banner((e as Error).message); }
    impBtn.disabled = false; badge(); render();
  };
  $('vDismissUntracked').onclick = () => { dismissBanner(store, untrackedFiles); renderBanner(); };
  $('vCsv').onclick = () => {
    const blob = new Blob([toCsv(inFormat(videos, format))], { type: 'text/csv;charset=utf-8' }), a = el('a', { href: URL.createObjectURL(blob), download: `videos-${format}-${new Date().toISOString().slice(0, 10)}.csv` }) as HTMLAnchorElement;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); ($('vExport') as HTMLDetailsElement).open = false;
  };
  document.addEventListener('click', (e) => { const m = $('vExport') as HTMLDetailsElement; if (m.open && !(e.target as HTMLElement).closest('#vExport')) m.open = false; });
  const langSel = $<HTMLSelectElement>('vLang');
  langSel.onchange = async () => {
    try { const r = await call<{ suggestLang: 'en' | 'id' }>('/api/settings', send('PUT', { suggestLang: langSel.value })); lang = r.suggestLang; renderDetail(); }
    catch (e) { banner((e as Error).message); langSel.value = lang; }
  };
  $('vYt').onclick = () => { ($('vExport') as HTMLDetailsElement).open = false; openYoutubeSettings(refresh); };
  // several videos at once: every video the list shows now (same filters), after a confirmation that names the channel
  $('vChanAll').onclick = async () => {
    ($('vExport') as HTMLDetailsElement).open = false;
    const conns = ytState()?.connections ?? [];
    if (conns.length < 2) { banner('Only one channel is connected. Connect another one in YouTube settings first.'); return; }
    const shown = [...$('vList').querySelectorAll<HTMLElement>('.vrow')].map(r => r.dataset.id!).filter(Boolean);
    const pick = prompt(`Put the ${shown.length} videos shown on which channel? Type its number:\n${conns.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}\n\nScheduled, published or uploaded videos keep their channel.`);
    const c = conns[Number(pick) - 1]; if (!c) return;
    try { const r = await call<{ changed: number; skipped: unknown[] }>('/api/videos/channel', send('PUT', { ids: shown, channelId: c.id })); banner(`${r.changed} video${r.changed === 1 ? '' : 's'} now for ${c.name}${r.skipped.length ? `; ${r.skipped.length} kept their channel` : ''}.`); await refresh(); }
    catch (e) { banner((e as Error).message); }
  };
  $('vData').onclick = async () => { try { await call('/api/videos/reveal-data', send('POST')); } catch (e) { banner((e as Error).message); } };

  // ---------- coverage: which scene × style combinations exist ----------
  function renderCoverage() {
    ($('vCoverage') as HTMLElement).hidden = format === 'long'; // the scene × style map is about Shorts
    const styles = deps.styleIds(), scenes = deps.scenes.map(s => s.meta.id), cov = coverage(videos, scenes, styles);
    $('vCovSummary').textContent = cov.none === 0 ? `All ${cov.total} scene × style combinations have a video` : `${cov.none} of ${cov.total} scene × style combinations never made into a video`;
    const box = $('vMatrix'); if (!($('vCoverage') as HTMLDetailsElement).open && box.childElementCount) return;
    const t = el('table', { className: 'matrix' }), head = el('tr', {}, el('th'));
    for (const st of styles) head.append(el('th', { title: styleName(st) }, getTheme(st).icon));
    t.append(head);
    for (const sc of deps.scenes) {
      const tr = el('tr', {}, el('th', { scope: 'row' }, sc.meta.name));
      for (const st of styles) {
        const state = cov.cells[`${sc.meta.id}|${st}`];
        const b = el('button', { type: 'button', className: 'cell s-' + state, title: `${sc.meta.name} × ${styleName(st)}: ${state === 'none' ? 'never made. Click to open it in the studio.' : STATUS_LABEL[state as Status] + '. Click to open it in the studio.'}` }, SYMBOL[state]);
        b.setAttribute('aria-label', `${sc.meta.name}, ${styleName(st)}: ${state === 'none' ? 'not made' : STATUS_LABEL[state as Status]}`);
        b.onclick = async () => { await hide(); deps.openScene(sc.meta.id, st); };
        tr.append(el('td', {}, b));
      }
      t.append(tr);
    }
    box.replaceChildren(t, el('p', { className: 'legend' }, `${SYMBOL.none} never made  ${SYMBOL.draft} draft  ${SYMBOL.rendered} rendered  ${SYMBOL.scheduled} scheduled  ${SYMBOL.published} published`));
  }
  ($('vCoverage') as HTMLDetailsElement).ontoggle = () => renderCoverage();

  // ---------- list ----------
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
  /** one line: what needs you, each part a one-click filter */
  function renderNeeds() {
    const box = $('vNeeds'), n = needsCounts(inFormat(videos, format)); box.replaceChildren();
    const part = (label: string, ic: string, on: boolean, go: () => void, cls = '') => { const b = el('button', { type: 'button', className: cls + (on ? ' on' : '') }); b.innerHTML = icon(ic, 13); b.append(label); b.setAttribute('aria-pressed', String(on)); b.onclick = go; box.append(b); };
    if (n.failed) part(`${n.failed} upload${n.failed === 1 ? '' : 's'} failed`, 'warn', focus === 'failed', () => { status = 'all'; focus = focus === 'failed' ? '' : 'failed'; render(); }, 'bad');
    if (n.uploading) part(`${n.uploading} uploading`, 'upload', focus === 'uploading', () => { status = 'all'; focus = focus === 'uploading' ? '' : 'uploading'; render(); });
    if (n.toSchedule) part(`${n.toSchedule} rendered, not scheduled`, 'rendered', status === 'rendered' && !focus, () => { focus = ''; status = status === 'rendered' ? 'all' : 'rendered'; render(); });
    box.hidden = box.childElementCount === 0;
    if (!box.hidden) box.prepend(el('span', {}, 'Needs you:'));
  }
  /** small neutral tag with the channel name; the full name is the tooltip (long names are cut by CSS) */
  const channelBadge = (name: string) => el('span', { className: 'vbadge ch', title: `Channel: ${name}` }, name);
  function renderList() {
    const box = $('vList'), inF = inFormat(videos, format);
    const list = sortVideos(rowsFor(videos, viewState(), viewCtx()), sortBy, reverse);
    box.replaceChildren(); renderNeeds(); renderActive(list.length); if (loaded) saveView(store, viewState());
    if (!loaded) { box.append(el('p', { className: 'empty' }, 'Loading videos…')); return; }
    const toBuild = () => { const b = el('button', { type: 'button', className: 'primary vshortcut', title: 'Join Shorts into a long 16:9 video' }, 'Build long video →'); b.onclick = () => setMode('build'); return b; };
    if (!videos.length) {
      box.append(el('div', { className: 'empty' }, el('p', {}, 'No videos yet. Every render you make in the studio appears here, with the title, description and tags already written for you.'), (() => { const b = el('button', { type: 'button', className: 'primary' }, 'Go to the studio'); b.onclick = hide; return b; })()));
      return;
    }
    if (!inF.length) {
      box.append(format === 'long'
        ? el('div', { className: 'empty' }, el('p', {}, 'No long videos yet. Join your Shorts into 16:9 videos of 9–18 minutes, one theme each.'), toBuild())
        : el('div', { className: 'empty' }, el('p', {}, 'No Shorts yet. Every render you make in the studio appears here.')));
      return;
    }
    if (format === 'long') box.append(el('div', { className: 'vshortrow' }, toBuild()));
    if (!list.length) { box.append(el('div', { className: 'empty' }, el('p', {}, 'No video matches these filters.'), el('p', { className: 'msg' }, activeLine(viewState(), viewCtx(), focus)), hasActive(viewState(), focus) ? (() => { const b = el('button', { type: 'button', className: 'primary' }, 'Reset filters'); b.onclick = clearFilters; return b; })() : '')); return; }
    for (const v of list) {
      const badges = el('span', { className: 'vbs' });
      const bd = (cls: string, ic: string, text: string) => { const b = el('span', { className: 'vbadge ' + cls }); b.innerHTML = icon(ic, 12); b.append(text); badges.append(b); };
      bd('s-' + v.status, v.status === 'draft' ? 'draft' : v.status === 'rendered' ? 'rendered' : v.status === 'scheduled' ? 'calendar' : 'published', STATUS_LABEL[v.status]);
      if (v.kind === 'long') bd('s-long', 'rendered', 'Long');
      badges.append(channelBadge(channelOf(v)));
      if (uploadFailed(v)) bd('up-failed', 'warn', 'Upload failed'); else if (uploadRunning(v)) bd('up-running', 'upload', uploadWaiting(v) ? 'Waiting for quota' : 'Uploading');
      const when = v.status === 'published' && v.publishedAt ? `published ${v.publishedAt}` : v.status === 'scheduled' && v.scheduledAt ? `for ${v.scheduledAt.replace('T', ' ')}` : fmtDate(v.createdAt);
      const row = el('button', { type: 'button', className: 'vrow' + (v.id === selected ? ' on' : '') },
        el('span', { className: 'vt' }, v.title || '(no title)'), badges,
        el('span', { className: 'vm' }, `${v.kind === 'long' ? `Long video · ${(v.durationSec / 60).toFixed(1)} min` : `${sceneName(v.sceneId)} · ${styleName(v.style)}`} · ${when}${v.status !== 'draft' && !v.fileExists && v.file ? ' · MP4 missing' : ''}`));
      row.setAttribute('role', 'listitem'); row.dataset.id = v.id;
      row.onclick = async () => { await flush(); selected = v.id; view.dataset.step = 'detail'; renderList(); renderDetail(); $('vList').querySelector<HTMLElement>('.vrow.on')?.focus({ preventScroll: true }); };
      box.append(row);
    }
    // one tab stop for the whole list (the open video, or the first); the arrow keys move between rows
    const rows = [...box.querySelectorAll<HTMLElement>('.vrow')], stop = rows.find(r => r.classList.contains('on')) ?? rows[0];
    rows.forEach(r => r.tabIndex = r === stop ? 0 : -1);
  }
  $('vList').addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key; if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Home' && k !== 'End') return;
    const rows = [...$('vList').querySelectorAll<HTMLElement>('.vrow')]; if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLElement), to = k === 'Home' ? 0 : k === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + (k === 'ArrowDown' ? 1 : -1)));
    e.preventDefault(); rows.forEach(r => r.tabIndex = -1); rows[to].tabIndex = 0; rows[to].focus();
  });

  // ---------- detail editor ----------
  /** copy with feedback. If the clipboard API is blocked, try the old way; if that fails too, show the text selected so Ctrl/Cmd+C works. */
  async function copyText(text: string): Promise<'ok' | 'manual'> {
    try { await navigator.clipboard.writeText(text); return 'ok'; } catch { /* blocked or unavailable: fall through */ }
    const ta = el('textarea', { value: text }) as HTMLTextAreaElement; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(ta); ta.focus(); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok ? 'ok' : 'manual';
  }
  const copyBtn = (label: string, text: () => string, cls = '') => {
    const b = el('button', { type: 'button', className: cls }, label); b.dataset.keep = '1';
    b.onclick = async () => {
      const t = text(), r = await copyText(t);
      document.getElementById('vManual')?.remove();
      if (r === 'ok') { b.textContent = 'Copied ✓'; b.classList.add('copied'); }
      else {
        b.textContent = 'Select and copy ↓';
        const box = el('textarea', { id: 'vManual', className: 'manual', value: t, readOnly: true, rows: 6 }) as HTMLTextAreaElement;
        box.setAttribute('aria-label', 'Text to copy: press Ctrl or Cmd+C'); b.closest('.vfield, .vhead, .row')?.after(box); box.focus(); box.select();
      }
      setTimeout(() => { b.textContent = label; b.classList.remove('copied'); }, 1600);
    };
    return b;
  };
  const current = () => videos.find(v => v.id === selected);
  /** the quality checker's context: what the scene is about, the numbers the video really has, and the other titles in the list */
  const qualityCtx = (v: Video) => ({ topic: topicFor(v.sceneId, v.params), facts: factsFor(v.sceneId, v.params), otherTitles: videos.filter(x => x.id !== v.id).map(x => x.title) });
  function warningsBox(v: Video) {
    return checkQuality(v, qualityCtx(v)).map(w => el('li', { className: 'q-' + w.severity }, el('b', { className: 'qb' }, SEVERITY_LABEL[w.severity]), ' ', w.text));
  }
  function qualityLine(v: Video) {
    const q = qualitySummary(checkQuality(v, qualityCtx(v)));
    const parts = [q.error && `${q.error} to fix`, q.warn && `${q.warn} to check`, q.info && `${q.info} tip${q.info === 1 ? '' : 's'}`].filter(Boolean);
    return parts.length ? `Quality check: ${parts.join(' · ')}` : 'Quality check: all good ✓';
  }
  function updateDerived() {
    const v = current(); if (!v) return;
    const set = (id: string, t: string) => { const n = document.getElementById(id); if (n) n.textContent = t; };
    set('cTitle', `${v.title.length}/${LIMITS.title}`); set('cDesc', `${utf8Bytes(v.description)}/${LIMITS.description} bytes`);
    set('cTags', `${tagsLength(v.tags)}/${LIMITS.tags}`); set('cHash', `${v.hashtags.length}/${LIMITS.hashtags}`);
    set('cCover', `${(v.coverText || coverText(v.title)).length}/${COVER_TEXT_MAX}`); set('vQual', qualityLine(v));
    const w = document.getElementById('vWarn'); if (w) w.replaceChildren(...warningsBox(v));
    set('vNext', nextStep(v));
  }
  function field(label: string, input: HTMLElement, counterId: string, copy?: HTMLElement) {
    return el('div', { className: 'vfield' }, el('label', {}, el('span', {}, label), el('span', { className: 'v', id: counterId }), copy ?? ''), input);
  }
  /** a folding section; open/closed is remembered once you toggle it, until then it opens when it is what the video needs now */
  function section(name: string, title: string, hint: string, dflt: boolean, ...kids: (Node | string)[]) {
    const d = el('details', { className: 'vsec', open: secOpen(name, dflt) }) as HTMLDetailsElement;
    d.append(el('summary', {}, title, el('span', { className: 'hint' }, hint)), ...kids);
    // remembered only when YOU click the summary (the automatic default must not count as a choice)
    d.querySelector('summary')!.addEventListener('click', () => setTimeout(() => { try { localStorage.setItem('studio.sec.' + name, d.open ? '1' : '0'); } catch { /* private mode */ } }, 0));
    return d;
  }
  function renderDetail() {
    const box = $('vDetail'), v = current(); box.replaceChildren();
    if (!v) {
      const n = needsCounts(videos), todo = n.failed + n.toSchedule;
      box.append(el('p', { className: 'vempty' }, videos.length ? (todo ? `${todo} video${todo === 1 ? '' : 's'} need${todo === 1 ? 's' : ''} you. ` : '') + 'Pick a video on the left to edit its texts, thumbnail and status.' : ''));
      return;
    }
    const back = el('button', { type: 'button', className: 'link vback' }); back.innerHTML = icon('back', 14); back.append(' All videos'); back.onclick = async () => { await flush(); view.dataset.step = 'list'; };
    box.append(back);
    const id = v.id;
    const patch = (p: Record<string, unknown>, now = false) => { const i = videos.findIndex(x => x.id === id); Object.assign(videos[i], p); queueSave(id, p, now); updateDerived(); };

    // header + status
    const stat = el('div', { className: 'seg', role: 'group', 'aria-label': 'Status' });
    for (const s of STATUSES) {
      const b = el('button', { type: 'button', className: 's-' + s }, STATUS_LABEL[s]); b.setAttribute('aria-pressed', String(v.status === s));
      b.onclick = async () => {
        await flush(); const i = videos.findIndex(x => x.id === id); videos[i].status = s; await queueSave(id, { status: s }, true);
        renderDetail(); if (s === 'published' && !videos[i].youtubeUrl) setTimeout(() => $<HTMLInputElement>('vUrl')?.focus(), 0);
      };
      stat.append(b);
    }
    if (v.kind === 'long') { longDetail(v, box, { patch, openCompile: () => setMode('build'), statusBar: stat, note: nextStep(v), youtube: el('div', { className: 'ytbox' }, el('h3', { className: 'sub' }, 'YouTube'), channelPicker(v, { refresh, flush, readOnly }), manualUpload(v, { refresh, flush, readOnly })) }); return; } // a long video: facts, texts to copy and the owner's own tracking; the texts are edited on the Compile page
    box.append(el('div', { className: 'vhead' },
      el('div', {}, el('h2', {}, `${sceneName(v.sceneId)} · ${styleName(v.style)}`),
        el('p', { className: 'msg' }, channelBadge(channelOf(v)), ` Shorts · 1080×1920 · 60 fps${v.durationSec ? ` · ${v.durationSec.toFixed(1)} s` : ''}${v.sizeBytes ? ' · ' + fmtSize(v.sizeBytes) : ''} · created ${fmtDate(v.createdAt)}`)),
      copyBtn('Copy title, description and tags', () => copyAll(current()!), 'primary')),
      stat, el('p', { className: 'next', id: 'vNext' }, nextStep(v)));

    // video + thumbnail: the best frame is picked automatically; the owner can pick another and edit the hook text
    if (v.fileExists) {
      const player = el('video', { src: '/output/' + v.file, controls: true, preload: 'metadata' }) as HTMLVideoElement;
      const info = el('p', { className: 'msg', id: 'vCoverMsg' }, v.thumbFile ? '' : 'No thumbnail yet.');
      const coverIn = el('input', { type: 'text', value: v.coverText, maxLength: 120, placeholder: coverText(v.title, hookFor(v.sceneId, v.params)) || 'Text on the thumbnail' }) as HTMLInputElement;
      coverIn.setAttribute('aria-label', 'Text on the thumbnail and cover'); coverIn.oninput = () => patch({ coverText: coverIn.value });
      const useBtn = el('button', { type: 'button' }, 'Use this frame') as HTMLButtonElement;
      const autoBtn = el('button', { type: 'button', className: 'primary', title: 'Look through the whole video and take the busiest frame near the climax' }, 'Pick the best frame automatically') as HTMLButtonElement;
      const plainBtn = el('button', { type: 'button', title: 'The same frame without any text' }, 'Without text') as HTMLButtonElement;
      player.ontimeupdate = player.onseeked = () => { useBtn.textContent = `Use this frame (${player.currentTime.toFixed(1)} s)`; };
      const make = async (body: Record<string, unknown>, busy: string) => {
        for (const b of [useBtn, autoBtn, plainBtn]) b.disabled = true; info.textContent = busy; info.className = 'msg';
        try { await flush(); const nv = await call<VideoView>(`/api/videos/${id}/cover`, send('POST', body)); const i = videos.findIndex(x => x.id === id); videos[i] = fix(nv); renderDetail(); }
        catch (e) { info.textContent = (e as Error).message; info.className = 'msg bad'; for (const b of [useBtn, autoBtn, plainBtn]) b.disabled = false; }
      };
      const text = () => coverIn.value.trim() || undefined;
      useBtn.onclick = () => make({ t: player.currentTime, text: text() }, 'Drawing the thumbnail…');
      autoBtn.onclick = () => make({ auto: true, text: text() }, 'Looking for the best frame…');
      plainBtn.onclick = () => make({ t: v.thumbSec ?? player.currentTime, noText: true }, 'Drawing the frame without text…');
      const reveal = el('button', { type: 'button' }, 'Show MP4 in folder'); reveal.onclick = async () => { try { await call('/api/reveal', send('POST', { file: v.file })); } catch (e) { setSaveState((e as Error).message, true); } };
      const pic = (url: string, label: string, cls: string) => url ? el('figure', { className: 'vpic' }, el('a', { href: url, target: '_blank', title: 'Open the picture' }, el('img', { src: url, alt: label, className: 'vthumb ' + cls })), el('figcaption', {}, label)) : '';
      box.append(section('media', 'Video and thumbnail', v.thumbFile ? `frame at ${v.thumbSec?.toFixed(1) ?? '?'} s` : 'no thumbnail yet', !v.thumbFile, el('div', { className: 'vmedia' }, player, el('div', { className: 'vmedia-side' },
        el('div', { className: 'vpics' }, pic(v.coverUrl || v.thumbUrl, v.coverUrl ? 'Shorts thumbnail 1080×1920 (9:16): this is the picture sent to YouTube' : 'Thumbnail (sent to YouTube)', 'tall'), v.coverUrl ? pic(v.thumbUrl, 'Wide 1280×720: not sent for Shorts (YouTube would crop it to 9:16)', 'wide') : ''),
        el('p', { className: 'msg' }, v.thumbSec !== null ? `Frame at ${v.thumbSec.toFixed(1)} s (data/thumbnails/${v.coverFile || v.thumbFile})` : 'The thumbnail is the frame you choose, with the hook on it.'),
        v.thumbProblem ? el('p', { className: 'warnline' }, 'The thumbnail on YouTube is not this one. ' + v.thumbProblem + ' Use "Set the thumbnail again" under YouTube.') : '',
        el('div', { className: 'vfield' }, el('label', {}, el('span', {}, 'Text on the thumbnail'), el('span', { className: 'v', id: 'cCover' })), coverIn),
        el('div', { className: 'row' }, autoBtn, useBtn, plainBtn), info, reveal))));
      if (!v.thumbFile && !readOnly && !autoTried.has(id)) { autoTried.add(id); void make({ auto: true }, 'Picking the best frame…'); }
    } else if (v.file) {
      box.append(el('p', { className: 'warnline' }, `The MP4 (${v.file}) is no longer in output/. The texts and status are kept; render again to get a new file.`));
    } else {
      box.append(el('p', { className: 'msg' }, 'No MP4 yet. When the render finishes, it appears here.'));
    }

    // texts
    const title = el('input', { type: 'text', value: v.title, maxLength: 300 }) as HTMLInputElement; title.oninput = () => patch({ title: title.value });
    const sug = suggestFor(v.sceneId, v.params, lang), ideas = sug?.titles ?? (sug?.titleIdeas ?? []).map(text => ({ text, label: '' }));
    const ideaRow = el('div', { className: 'ideas' }, ...ideas.map(it => { const b = el('button', { type: 'button', className: 'chip idea', title: 'Use this title' }, it.label ? el('small', {}, it.label) : '', it.text); b.onclick = () => { title.value = it.text; patch({ title: it.text }, true); }; return b; }));
    const desc = el('textarea', { rows: 9, value: v.description }) as HTMLTextAreaElement; desc.oninput = () => patch({ description: desc.value });
    const tags = el('input', { type: 'text', value: tagsText(v) }) as HTMLInputElement; tags.oninput = () => patch({ tags: parseTags(tags.value) });
    tags.onblur = () => { tags.value = tagsText({ tags: parseTags(tags.value) }); };
    const hash = el('input', { type: 'text', value: v.hashtags.join(' ') }) as HTMLInputElement; hash.oninput = () => patch({ hashtags: parseHashtags(hash.value) });
    hash.onblur = () => { hash.value = parseHashtags(hash.value).join(' '); };
    const cur = () => current()!;
    const again = el('button', { type: 'button', title: 'Put the title, description, tags and hashtags back to the studio\'s first suggestion' }, 'Reset to suggestion');
    again.onclick = () => {
      const s = suggestFor(v.sceneId, v.params, lang); if (!s || !confirm('Replace the title, description, tags and hashtags with the first suggestion?')) return;
      queueSave(id, { title: s.title, description: s.description, tags: s.tags, hashtags: s.hashtags }, true).then(renderDetail);
    };
    const variants = ((renderDetail as unknown as { variants?: Map<string, number> }).variants ??= new Map<string, number>());
    const another = el('button', { type: 'button', title: 'Write the description again with another layout and wording (same facts). Your title stays.' }, 'Another description');
    another.disabled = lang !== 'en'; if (lang !== 'en') another.title = 'Only for English suggestions.';
    another.onclick = () => {
      const n = (variants.get(id) ?? 0) + 1, d = descriptionFor(v.sceneId, v.params, current()!.title || sug?.title || '', n); if (d === null) return;
      variants.set(id, n); desc.value = d; patch({ description: d }, true);
    };
    box.append(section('texts', 'Texts for YouTube', 'title, description, tags', v.status === 'draft' || v.status === 'rendered',
      field('Title', title, 'cTitle', copyBtn('Copy', () => cur().title)), ideaRow,
      field('Description', desc, 'cDesc', copyBtn('Copy (with hashtags)', () => descriptionWithHashtags(cur()))),
      field('Tags', tags, 'cTags', copyBtn('Copy', () => tagsText(cur()))),
      field('Hashtags', hash, 'cHash', copyBtn('Copy', () => cur().hashtags.join(' '))),
      el('div', { className: 'row' }, copyBtn('Copy everything', () => copyAll(cur())), another, again),
      el('p', { className: 'msg', id: 'vQual' }, qualityLine(v)),
      el('ul', { className: 'warns', id: 'vWarn' }, ...warningsBox(v))));

    // publishing: folded until it matters
    const sched = el('input', { type: 'datetime-local', value: v.scheduledAt }) as HTMLInputElement; sched.onchange = () => patch({ scheduledAt: sched.value }, true);
    const pub = el('input', { type: 'date', value: v.publishedAt }) as HTMLInputElement; pub.onchange = () => patch({ publishedAt: pub.value }, true);
    const url = el('input', { type: 'url', id: 'vUrl', value: v.youtubeUrl, placeholder: 'https://youtube.com/shorts/…' }) as HTMLInputElement;
    url.oninput = () => patch({ youtubeUrl: url.value.trim() });
    const open = el('a', { className: 'btn', target: '_blank', rel: 'noopener', textContent: 'Open ↗' }) as HTMLAnchorElement;
    const syncOpen = () => { open.hidden = !isYoutubeUrl(url.value); open.href = url.value.trim(); }; syncOpen(); url.addEventListener('input', syncOpen);
    const pubBox = el('details', { className: 'group', open: v.status === 'scheduled' || v.status === 'published' }, el('summary', {}, 'Dates and link'),
      el('div', { className: 'vfield' }, el('label', {}, el('span', {}, 'Scheduled for')), sched),
      el('div', { className: 'vfield' }, el('label', {}, el('span', {}, 'Published on')), pub),
      el('div', { className: 'vfield' }, el('label', {}, el('span', {}, 'YouTube link')), el('div', { className: 'ctl' }, url, open)));
    const notes = el('textarea', { rows: 3, value: v.notes, placeholder: 'Anything to remember: ideas for the next one, how it performed…' }) as HTMLTextAreaElement; notes.oninput = () => patch({ notes: notes.value });
    const del = el('button', { type: 'button', className: 'link danger' }, 'Delete this entry');
    del.onclick = async () => {
      if (!confirm('Delete this entry from the list? The rendered MP4 stays in output/. A backup of the list is kept in data/backups/.')) return;
      try { await flush(); await call(`/api/videos/${id}`, send('DELETE')); videos = videos.filter(x => x.id !== id); selected = ''; badge(); render(); } catch (e) { setSaveState((e as Error).message, true); }
    };
    box.append(youtubePanel(v, { refresh, flush, readOnly, onSettings: () => openYoutubeSettings(refresh) }));
    box.append(pubBox, section('notes', 'Notes', v.notes ? 'has notes' : 'empty', !!v.notes, notes), el('div', { className: 'row between' }, el('span', { id: 'vSaved', className: 'msg' }), del));
    updateDerived();
    if (readOnly) for (const c of box.querySelectorAll<HTMLElement>('input, textarea, button, select')) if (!c.dataset.keep && !(c as HTMLElement).closest('video')) (c as HTMLInputElement).disabled = true;
  }

  function render() { renderFormat(); renderToolbar(); renderChannels(); renderChips(); renderList(); renderDetail(); renderCoverage(); renderBanner();
    const ro = $('vReadOnly'); ro.hidden = !readOnly; (ro.firstElementChild as HTMLElement).textContent = `Read-only: ${readOnlyReason} You can look and copy texts, but nothing is saved. Close the other studio, then reload this page.`;
    langSel.value = lang; langSel.disabled = readOnly; }

  // first load happens quietly so the badge is right when the studio opens
  refresh();
  /** the slash shortcut: the search box of the list (the other views have none, so it opens the list first) */
  function focusSearch() { if (mode !== 'list') setMode('list'); searchBox.focus(); searchBox.select(); }
  return { show, hide, shown, refresh, applyHash, focusSearch, loaded: () => loaded,
    /** open the entry that belongs to a render job (used by "Texts & publish" under the preview) */
    async showJob(jobId: string) { await refresh(); const v = videos.find(x => x.jobId === jobId); show(v?.id); } };
}
