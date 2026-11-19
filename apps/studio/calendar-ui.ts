// Calendar view of the YouTube upload schedule (Videos → Calendar). Read only: it shows data/schedule.json next to the studio's own
// video records, in WIB. Clicking a video opens it in the Videos list. Nothing here uploads or changes anything.
import { calendarEntries, groupByDay, monthWeeks, monthOf, shiftMonth, startMonth, CAL_LABEL, type CalEntry, type CalState } from '../../packages/publish/calendar.ts';
import { wibParts } from '../../packages/publish/schedule.ts';
import type { Video } from '../../packages/publish/index.ts';
import { calendarInput, CALENDAR_NOTE, type Format } from './videos-nav.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATES: CalState[] = ['planned', 'scheduled', 'published', 'uploading', 'waiting', 'failed'];
export interface CalendarDeps { host: HTMLElement; videos: () => Video[]; /** which videos the page shows: the upload plan is for Shorts, so a Long-only calendar has no plan slots */ format: () => Format; sceneName: (id: string) => string; open: (videoId: string) => void }

export function initCalendar(d: CalendarDeps) {
  let plan: { slots: any[] } | null = null, month = '', day = '', loaded = false, error = '';
  async function load() {
    try { const r = await fetch('/api/schedule'); const j = await r.json(); plan = j.plan ?? null; error = ''; } catch { error = 'Could not read the schedule from the studio.'; }
    loaded = true;
  }
  const label = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const dayLabel = (date: string) => { const [y, m, dd] = date.split('-').map(Number); return `${DAYS[(new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7]} ${dd} ${MONTHS[m - 1]}`; };

  function render() {
    const inp = calendarInput(plan, d.videos(), d.format()), entries = calendarEntries(inp.plan as { slots: any[] } | null, inp.videos), by = groupByDay(entries), today = wibParts(Date.now()).date;
    if (!month) month = startMonth(entries);
    const [y, m] = month.split('-').map(Number), weeks = monthWeeks(y, m);
    const count = (s: CalState) => entries.filter(e => e.state === s).length;
    const lastOn = [...entries].reverse().find(e => e.state === 'scheduled' || e.state === 'published');
    const head = el('div', { className: 'cal-head' });
    const nav = (txt: string, aria: string, by_: number) => { const b = el('button', { type: 'button', className: 'cal-nav', title: aria }, txt); b.setAttribute('aria-label', aria); b.onclick = () => { month = shiftMonth(month, by_); day = ''; render(); }; return b; };
    const todayBtn = el('button', { type: 'button', className: 'cal-today' }, 'Today'); todayBtn.onclick = () => { month = monthOf(today); day = today; render(); };
    head.append(nav('‹', 'Previous month', -1), el('h2', { className: 'cal-title', ariaLive: 'polite' }, label(month)), nav('›', 'Next month', 1), todayBtn);
    const sum = el('p', { className: 'cal-sum' }, entries.length
      ? `${entries.length} slots · ${count('scheduled') + count('published')} on YouTube · ${count('planned')} planned${count('failed') ? ` · ${count('failed')} failed` : ''}${lastOn ? ` · filled until ${dayLabel(lastOn.date)} ${lastOn.time} WIB` : ''}`
      : d.format() === 'long' ? 'No long video has a date yet.' : 'No schedule yet. Make one with: npm run schedule:plan -- --write');
    const legend = el('div', { className: 'cal-legend', 'aria-label': 'Legend' } as any);
    for (const s of STATES) if (s === 'planned' || s === 'scheduled' || count(s)) legend.append(el('span', { className: 'cal-key' }, el('i', { className: 'cal-dot st-' + s }), CAL_LABEL[s]));
    legend.append(el('span', { className: 'cal-key muted' }, 'Times are WIB (UTC+7)'));

    const grid = el('div', { className: 'cal-grid', role: 'grid' } as any); grid.setAttribute('aria-label', label(month));
    for (const n of DAYS) grid.append(el('div', { className: 'cal-dow', role: 'columnheader' } as any, n));
    for (const wk of weeks) for (const date of wk) {
      const list = by.get(date) ?? [], inMonth = monthOf(date) === month;
      const cell = el('div', { className: 'cal-cell' + (inMonth ? '' : ' out') + (date === today ? ' today' : '') + (date === day ? ' sel' : '') + (list.length ? ' has' : ''), role: 'gridcell' } as any);
      cell.dataset.date = date;
      const num = el('button', { type: 'button', className: 'cal-num' }, String(Number(date.slice(8))));
      num.setAttribute('aria-label', `${dayLabel(date)}: ${list.length} video${list.length === 1 ? '' : 's'}`); num.setAttribute('aria-pressed', String(date === day));
      num.onclick = () => { day = day === date ? '' : date; render(); };
      cell.append(num);
      if (list.length) {
        const chips = el('div', { className: 'cal-chips' });
        for (const e of list) chips.append(chip(e));
        cell.append(chips, el('span', { className: 'cal-count' }, el('i', { className: 'cal-dot st-' + dominant(list) }), String(list.length)));
      }
      grid.append(cell);
    }
    const panel = el('div', { className: 'cal-day' });
    const sel = day && by.get(day);
    if (sel) {
      panel.append(el('h3', {}, `${dayLabel(day)} · ${sel.length} video${sel.length === 1 ? '' : 's'}`));
      for (const e of sel) panel.append(row(e));
    } else panel.hidden = true;
    const note = CALENDAR_NOTE[d.format()];
    d.host.replaceChildren(head, sum, ...(note ? [el('p', { className: 'cal-note msg' }, note)] : []), ...(error ? [el('p', { className: 'cal-err' }, error)] : []), legend, grid, panel);
  }
  const dominant = (list: CalEntry[]): CalState => STATES.find(s => list.some(e => e.state === s) && s !== 'planned') ?? 'planned';
  const short = (e: CalEntry) => (e.kind === 'long' ? 'Long video' : d.sceneName(e.sceneId));
  function chip(e: CalEntry) {
    const b = el('button', { type: 'button', className: 'cal-chip st-' + e.state }, el('b', {}, e.time), ' ', short(e));
    b.title = `${e.date} ${e.time} WIB · ${CAL_LABEL[e.state]}\n${e.title}`; b.setAttribute('aria-label', `${e.date} ${e.time}, ${short(e)}, ${CAL_LABEL[e.state]}: ${e.title}`);
    b.onclick = () => d.open(e.videoId); return b;
  }
  function row(e: CalEntry) {
    const b = el('button', { type: 'button', className: 'cal-row' }, el('span', { className: 'cal-rt' }, e.time), el('i', { className: 'cal-dot st-' + e.state }),
      el('span', { className: 'cal-rtitle' }, e.title), el('span', { className: 'cal-rm' }, `${short(e)} · ${CAL_LABEL[e.state]}`));
    b.onclick = () => d.open(e.videoId); return b;
  }
  return { async show() { await load(); render(); }, render() { if (loaded) render(); } };
}
