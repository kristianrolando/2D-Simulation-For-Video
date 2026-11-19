// YouTube on the Videos page: the settings dialog (client file, connect, defaults, quota) and the per-video section
// (form → check → confirmation dialog with a tick per video → progress → result). The server does every check again;
// this page never sees a token or a secret (docs/youtube-upload-plan.md).
import type { Video } from '../../packages/publish/index.ts';
import { fmtSize } from './ux.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `The server answered ${r.status}.`);
  return j as T;
}

interface Defaults { categoryId: string; language: string; madeForKids: boolean; synthetic: boolean; notify: boolean; lastTime: string }
export interface YtStatus { client: boolean; clientHint: string; connected: boolean; channel: { name: string; handle: string } | null; disconnected: string; defaults: Defaults;
  quota: { units: number; uploads: number }; resetAt: string; minLeadMin: number; live: { videoId: string; stage: string; sent: number; total: number } | null }
const CATEGORIES: [string, string][] = [['28', 'Science & Technology'], ['27', 'Education'], ['1', 'Film & Animation'], ['24', 'Entertainment']];
const LANGS: [string, string][] = [['en', 'English'], ['id', 'Indonesian']];
const STAGE_TEXT: Record<string, string> = { uploading: 'Uploading', processing: 'YouTube is processing the video…', thumbnail: 'Setting the thumbnail…', finishing: 'Finishing…' };

let state: YtStatus | null = null;
export async function loadYt(): Promise<YtStatus | null> { try { state = await call<YtStatus>('/api/youtube'); } catch { state = null; } return state; }
export const ytState = () => state;

function select(options: [string, string][], value: string) { const s = el('select') as HTMLSelectElement; for (const [v, t] of options) s.append(el('option', { value: v, textContent: t, selected: v === value })); return s; }
function yesNo(value: boolean) { return select([['false', 'No'], ['true', 'Yes']], String(value)); }
const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

// ---------------- settings dialog ----------------
export function openYoutubeSettings(onChange: () => void) {
  const dlg = el('dialog', { className: 'ytdlg' }) as HTMLDialogElement;
  dlg.setAttribute('aria-label', 'YouTube settings');
  const body = el('div'), msg = el('p', { className: 'msg' });
  dlg.append(el('h3', {}, 'YouTube'), body, msg, el('form', { method: 'dialog' }, el('button', {}, 'Close')));
  document.body.append(dlg);
  let poll = 0;
  const say = (t: string, bad = false) => { msg.textContent = t; msg.className = 'msg' + (bad ? ' bad' : ''); };
  async function draw() {
    const s = await loadYt(); body.replaceChildren();
    if (!s) { body.append(el('p', { className: 'msg bad' }, 'The studio server is not answering.')); return; }
    // 1. client
    const client = el('div', { className: 'ytstep' }, el('b', {}, '1. OAuth client  '), el('span', { className: 'msg' }, s.client ? `✓ stored (${s.clientHint}) in ~/Library/Application Support/Sim Studio` : 'not added yet'));
    const fromDl = el('button', { type: 'button' }, s.client ? 'Replace with the newest file in Downloads' : 'Take client_secret_….json from Downloads') as HTMLButtonElement;
    fromDl.onclick = async () => {
      if (!confirm('The studio copies the newest client_secret_….json from your Downloads folder into ~/Library/Application Support/Sim Studio (readable only by you) and then deletes the download. Go on?')) return;
      try { const r = await call<{ imported: string }>('/api/youtube/client', 'POST', { fromDownloads: true }); say(`Stored ${r.imported} and deleted it from Downloads.`); await draw(); onChange(); } catch (e) { say((e as Error).message, true); }
    };
    const paste = el('details', {}, el('summary', {}, 'or paste the file\'s contents'));
    const ta = el('textarea', { rows: 3, placeholder: '{"installed": {"client_id": …}}' }) as HTMLTextAreaElement;
    const saveBtn = el('button', { type: 'button' }, 'Save') as HTMLButtonElement;
    saveBtn.onclick = async () => { try { await call('/api/youtube/client', 'POST', { text: ta.value }); ta.value = ''; say('Stored. Delete the downloaded file yourself (it holds the client secret).'); await draw(); onChange(); } catch (e) { say((e as Error).message, true); } };
    paste.append(ta, saveBtn);
    client.append(el('div', { className: 'row' }, fromDl), paste);
    // 2. channel
    const ch = el('div', { className: 'ytstep' }, el('b', {}, '2. Channel  '), el('span', { className: 'msg' + (s.disconnected ? ' bad' : '') },
      s.connected ? `✓ ${s.channel!.name}${s.channel!.handle ? ` (${s.channel!.handle})` : ''}` : s.disconnected || 'not connected'));
    const connect = el('button', { type: 'button', className: 'primary', disabled: !s.client }, s.connected ? 'Connect another time' : 'Connect…') as HTMLButtonElement;
    connect.onclick = async () => {
      try {
        const { url } = await call<{ url: string }>('/api/youtube/connect', 'POST');
        window.open(url, '_blank', 'noopener');
        say('Finish the sign-in in the new tab (if Google says the app is not verified: Advanced → Go to Sim Studio). This window updates by itself.');
        clearInterval(poll); const was = s.connected && s.channel?.name; let n = 0;
        poll = window.setInterval(async () => { const t = await loadYt(); if ((t?.connected && t.channel?.name !== was) || ++n > 90) { clearInterval(poll); await draw(); onChange(); if (t?.connected) say(`Connected: ${t.channel!.name}`); } }, 2000);
      } catch (e) { say((e as Error).message, true); }
    };
    const disc = el('button', { type: 'button', className: 'link danger', hidden: !s.connected }, 'Disconnect') as HTMLButtonElement;
    disc.onclick = async () => { if (!confirm('Disconnect YouTube? The permission is revoked at Google. Videos on YouTube and the entries here are not touched.')) return; try { await call('/api/youtube/disconnect', 'POST'); say('Disconnected.'); await draw(); onChange(); } catch (e) { say((e as Error).message, true); } };
    ch.append(el('div', { className: 'row' }, connect, disc));
    // 3. defaults
    const d = s.defaults, cat = select(CATEGORIES, d.categoryId), lang = select(LANGS, d.language), kids = yesNo(d.madeForKids), ai = yesNo(d.synthetic), notify = el('input', { type: 'checkbox', checked: d.notify }) as HTMLInputElement;
    const saveDefaults = async () => { try { await call('/api/youtube/defaults', 'PUT', { categoryId: cat.value, language: lang.value, madeForKids: kids.value === 'true', synthetic: ai.value === 'true', notify: notify.checked }); say('Defaults saved.'); } catch (e) { say((e as Error).message, true); } };
    for (const c of [cat, lang, kids, ai, notify]) c.onchange = saveDefaults;
    const defs = el('div', { className: 'ytstep' }, el('b', {}, '3. Defaults for new uploads (can be changed per video)'),
      el('div', { className: 'ytgrid' }, el('label', {}, 'Category'), cat, el('label', {}, 'Language of title/description'), lang,
        el('label', { title: 'YouTube requires this answer. It is a legal statement (COPPA): is the video made for children?' }, 'Made for kids'), kids,
        el('label', { title: 'Required for realistic AI or altered content. Animated, clearly unrealistic videos do not need it.' }, 'Altered/synthetic (AI) label'), ai,
        el('label', {}, 'Notify subscribers'), notify));
    const q = el('p', { className: 'msg' }, `Used today by this studio: ${s.quota.units} of 10,000 units · ${s.quota.uploads} of 100 uploads. Resets at ${s.resetAt} (midnight Pacific Time).`);
    body.append(client, ch, defs, q);
  }
  dlg.addEventListener('close', () => { clearInterval(poll); dlg.remove(); });
  void draw(); dlg.showModal();
}

// ---------------- per-video section ----------------
export interface PanelHooks { refresh: () => Promise<void>; flush: () => Promise<void>; readOnly: boolean; onSettings: () => void }
export function youtubePanel(v: Video & { fileExists: boolean; thumbUrl: string; coverUrl?: string; thumbProblem?: string }, h: PanelHooks): HTMLElement {
  const box = el('div', { className: 'ytbox' });
  const s = state, y = v.youtube;
  const head = el('h3', { className: 'sub' }, 'YouTube ', el('span', { className: 'hint' }, s?.connected ? `channel: ${s.channel!.name}` : ''));
  const settingsBtn = el('button', { type: 'button', className: 'link' }, 'YouTube settings…') as HTMLButtonElement; settingsBtn.dataset.keep = '1'; settingsBtn.onclick = h.onSettings;
  box.append(head);
  const live = s?.live?.videoId === v.id ? s.live : null;

  // already sent: show where it is, and only the buttons that continue it
  if (y) {
    if (live || (y.stage !== 'done' && y.stage !== 'failed')) {
      const pct = live && live.total ? Math.floor((100 * live.sent) / live.total) : 0;
      const t = (live?.stage ?? y.stage) === 'uploading' ? `Uploading ${pct}% · ${fmtSize(live?.sent ?? 0)} / ${fmtSize(live?.total ?? y.total)}` : STAGE_TEXT[live?.stage ?? y.stage] ?? 'Working…';
      box.append(el('div', { className: 'ytprog' }, el('div', { className: 'bar' }, el('div', { style: `width:${(live?.stage ?? y.stage) === 'uploading' ? pct : 100}%` })), el('p', { className: 'msg' }, `${t} · keep the studio running until the thumbnail is set.`)));
      return box;
    }
    const link = v.youtubeUrl ? el('a', { href: v.youtubeUrl, target: '_blank', rel: 'noopener' }, 'Open on YouTube ↗') : '';
    if (y.stage === 'done') {
      const where = y.mode === 'schedule' ? (v.status === 'published' ? '✓ Public on YouTube' : `◷ Scheduled on YouTube · goes public ${fmtWhen(y.publishAt)}`) : '✓ Public on YouTube';
      box.append(el('p', {}, where, '  ', link), el('p', { className: 'msg' }, `Uploaded ${fmtWhen(y.uploadedAt)} to ${y.channelName} · thumbnail ${y.thumbnail === 'set' ? 'set' : y.thumbnail === 'skipped' ? 'chosen by YouTube' : y.thumbnail}`));
      if (v.thumbProblem) { // the thumbnail on YouTube is the wide picture: offer the fix, never do it by itself
        const again = el('button', { type: 'button', className: 'primary' }, 'Set the thumbnail again (Pasang thumbnail lagi)') as HTMLButtonElement;
        again.onclick = async () => {
          if (!confirm('Replace the thumbnail on YouTube with the 9:16 picture shown above?\n\nThis changes your channel and uses 50 of the 10,000 daily quota units. The video, title, schedule and privacy stay as they are.')) return;
          again.disabled = true;
          try { await call(`/api/videos/${v.id}/youtube/rethumb`, 'POST', { agree: true }); await h.refresh(); } catch (e) { alert((e as Error).message); again.disabled = false; }
        };
        box.append(el('p', { className: 'warnline' }, 'Wrong thumbnail on YouTube. ' + v.thumbProblem), el('div', { className: 'row' }, again));
      }
    } else {
      box.append(el('p', { className: 'warnline' }, y.error || 'The upload stopped.'), link ? el('p', {}, link) : '');
      if (y.waitUntil) box.append(el('p', { className: 'msg' }, `⏳ Waiting for YouTube's daily quota to reset · continues by itself about ${fmtWhen(y.waitUntil)}. Keep the studio running (the Mac may sleep; it continues when it wakes).`));
      const row = el('div', { className: 'row' });
      const go = el('button', { type: 'button', className: 'primary' }, y.waitUntil ? 'Try now' : y.failedAt === 'uploading' ? 'Continue upload' : y.failedAt === 'thumbnail' ? 'Try the thumbnail again' : 'Continue') as HTMLButtonElement;
      go.onclick = async () => { go.disabled = true; try { await call(`/api/videos/${v.id}/youtube/resume`, 'POST'); await h.refresh(); } catch (e) { alert((e as Error).message); go.disabled = false; } };
      row.append(go);
      if (y.failedAt === 'thumbnail') {
        const skip = el('button', { type: 'button' }, y.mode === 'now' ? 'Publish without a custom thumbnail' : 'Keep YouTube\'s own thumbnail') as HTMLButtonElement;
        skip.onclick = async () => { if (!confirm(y.mode === 'now' ? 'Make the video public with the frame YouTube picked?' : 'Leave the thumbnail to YouTube? The schedule stays.')) return; try { await call(`/api/videos/${v.id}/youtube/skip-thumbnail`, 'POST'); await h.refresh(); } catch (e) { alert((e as Error).message); } };
        row.append(skip);
      }
      box.append(row);
    }
    if (y.fileSig && v.sizeBytes && !y.fileSig.startsWith(String(v.sizeBytes) + '-')) box.append(el('p', { className: 'msg' }, 'The MP4 changed since it was uploaded. YouTube keeps the uploaded version; the studio never uploads again by itself.'));
    box.append(el('p', { className: 'msg' }, 'Deleting or replacing a video on YouTube is done in YouTube Studio, never from here.'));
    return box;
  }

  if (!s?.connected) { box.append(el('p', { className: 'msg' }, s?.disconnected || 'YouTube is not connected yet. Add the client file and connect a channel (about 5 minutes, once).'), settingsBtn); return box; }
  if (v.status !== 'rendered') { box.append(el('p', { className: 'msg' }, v.status === 'draft' ? 'Uploading becomes possible when the render has finished (status Rendered).' : 'Only videos with status Rendered can be uploaded (set the status back to Rendered if this one is not on YouTube yet).')); return box; }

  // the form
  const d = s.defaults, tomorrow = new Date(Date.now() + 864e5); const [hh, mm] = d.lastTime.split(':').map(Number); tomorrow.setHours(hh, mm, 0, 0);
  const mSched = el('input', { type: 'radio', name: `ytm-${v.id}`, checked: true }) as HTMLInputElement, mNow = el('input', { type: 'radio', name: `ytm-${v.id}` }) as HTMLInputElement;
  const at = el('input', { type: 'datetime-local', value: localInput(tomorrow) }) as HTMLInputElement;
  mSched.onchange = mNow.onchange = () => { at.disabled = mNow.checked; };
  const cat = select(CATEGORIES, d.categoryId), lang = select(LANGS, d.language), kids = yesNo(d.madeForKids), ai = yesNo(d.synthetic), notify = el('input', { type: 'checkbox', checked: d.notify }) as HTMLInputElement;
  const opts = () => ({ mode: mNow.checked ? 'now' : 'schedule', at: at.value, categoryId: cat.value, language: lang.value, madeForKids: kids.value === 'true', synthetic: ai.value === 'true', notify: notify.checked });
  const out = el('ul', { className: 'warns' });
  const btn = el('button', { type: 'button', className: 'primary' }, 'Upload to YouTube…') as HTMLButtonElement;
  btn.onclick = async () => {
    btn.disabled = true; out.replaceChildren();
    try {
      await h.flush(); // the texts typed a moment ago are what gets uploaded
      const o = opts(), c = await call<any>(`/api/videos/${v.id}/youtube/check`, 'POST', { options: o });
      if (c.problems.length) { out.append(...c.problems.map((p: string) => el('li', {}, p))); btn.disabled = false; return; }
      confirmDialog(v, c, o, h, () => { btn.disabled = false; });
    } catch (e) { out.append(el('li', {}, (e as Error).message)); btn.disabled = false; }
  };
  box.append(
    el('div', { className: 'ytgrid' },
      el('label', {}, 'Goes public'), el('div', { className: 'row' }, el('label', { className: 'chk' }, mSched, ' on'), at, el('label', { className: 'chk' }, mNow, ' now (after the thumbnail is set)')),
      el('label', {}, 'Category'), cat, el('label', {}, 'Language'), lang, el('label', {}, 'Made for kids'), kids, el('label', {}, 'Altered/synthetic (AI) label'), ai, el('label', {}, 'Notify subscribers'), notify),
    el('p', { className: 'msg' }, `It is always uploaded as private first. Title, description (with hashtags), tags and the thumbnail frame above are used as they are now${v.coverUrl || v.thumbUrl ? '' : ' (no thumbnail frame chosen: YouTube will pick one)'}.`),
    el('div', { className: 'row' }, btn, settingsBtn), out);
  return box;
}

function confirmDialog(v: Video, c: any, o: Record<string, unknown>, h: PanelHooks, done: () => void) {
  const dlg = el('dialog', { className: 'ytdlg' }) as HTMLDialogElement;
  const tick = el('input', { type: 'checkbox' }) as HTMLInputElement;
  const go = el('button', { type: 'button', className: 'primary', disabled: true }, o.mode === 'now' ? 'Upload, then make public' : 'Upload & schedule') as HTMLButtonElement;
  const cancel = el('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
  const msg = el('p', { className: 'msg' });
  const cat = CATEGORIES.find(x => x[0] === o.categoryId)?.[1] ?? o.categoryId;
  const rows: [string, string][] = [
    ['Channel', `${c.channel.name}${c.channel.handle ? ` (${c.channel.handle})` : ''}`], ['Title', v.title],
    ['Goes public', o.mode === 'now' ? 'right after the thumbnail is set' : fmtWhen(new Date(String(o.at)).toISOString())],
    ['While uploading', 'private'], ['Thumbnail', c.thumbnail ? `frame at ${v.thumbSec?.toFixed(1)} s` : 'none chosen: YouTube picks a frame'],
    ['Category · language', `${cat} · ${LANGS.find(x => x[0] === o.language)?.[1] ?? o.language}`],
    ['Made for kids', o.madeForKids ? 'Yes' : 'No'], ['AI label', o.synthetic ? 'Yes' : 'No'], ['Notify subscribers', o.notify ? 'Yes' : 'No'],
    ['File', `${v.file} · ${c.file.width}×${c.file.height} · ${c.file.durationSec} s · ${fmtSize(c.file.sizeBytes)}`],
    ['Quota today', `${c.quota.uploads} of 100 uploads used by this studio`],
  ];
  dlg.append(el('h3', {}, 'Upload to YouTube?'), el('dl', {}, ...rows.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)])),
    el('label', { className: 'chk' }, tick, ` I agree that this video is uploaded to the channel ${c.channel.name}.`), msg, el('div', { className: 'row' }, go, cancel));
  tick.onchange = () => { go.disabled = !tick.checked; };
  cancel.onclick = () => dlg.close();
  dlg.addEventListener('close', () => { dlg.remove(); done(); });
  go.onclick = async () => {
    go.disabled = true; tick.disabled = true; msg.textContent = 'Starting…';
    try { await call(`/api/videos/${v.id}/youtube/upload`, 'POST', { options: o, consent: c.consent, agree: tick.checked }); dlg.close(); await loadYt(); await h.refresh(); }
    catch (e) { msg.textContent = (e as Error).message; msg.className = 'msg bad'; }
  };
  document.body.append(dlg); dlg.showModal();
}
