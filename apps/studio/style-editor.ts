// Style editor: make a new style from an existing one, or change one you made. It edits the look only (colours, font, line,
// ball and texture styles); the preview behind the panel is the real studio preview, redrawn as you change things.
// A saved style is a themes/<id>.json file, listed with the shipped styles and usable in every scene. The video engine,
// the simulations and the shipped styles are never touched; shipped styles cannot be overwritten or deleted here.
import { getTheme } from '../../packages/theme/index.ts';
import { readEdit, buildStyle, checkEdit, slugify, FONT_CHOICES, LINE_STYLES, BALL_STYLES, TEXTURES, SPARKS, type StyleEdit } from '../../packages/theme/editor.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e;
};
export interface StyleBase { id: string; name: string; raw: unknown }
export interface EditorHooks {
  /** draw the preview with this style (a complete theme file), or restore the style that was selected before (null) */
  preview(raw: Record<string, unknown> | null): void;
  /** the style was saved on the server: reload the list and select it */
  saved(id: string): Promise<void>;
  /** the style was deleted on the server */
  removed(id: string): Promise<void>;
  existingIds(): string[];
}

async function call(path: string, method: string, body?: unknown): Promise<any> {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`); return j;
}

let open: HTMLDialogElement | null = null;
/** open the editor. `editing` = the base is a style made in the editor: Save overwrites it. Otherwise Save makes a new style. */
export function openStyleEditor(base: StyleBase, editing: boolean, hooks: EditorHooks) {
  open?.close(); open = null;
  const T = getTheme(base.id);
  const ed: StyleEdit = readEdit(T);
  if (!editing) { ed.name = `${base.name} (mine)`.slice(0, 40); ed.concept = ''; }
  const takenIds = hooks.existingIds().filter(i => !(editing && i === base.id));
  const idFor = () => {
    if (editing) return base.id;
    const stem = slugify(ed.name); let id = stem, n = 2;
    while (takenIds.includes(id)) id = `${stem.slice(0, 28)}-${n++}`;
    return id;
  };

  const dlg = el('dialog', { className: 'side', id: 'styleEditor' }) as HTMLDialogElement;
  dlg.setAttribute('aria-label', 'Style editor');
  const msg = el('p', { className: 'msg', role: 'status' }), hints = el('ul', { className: 'hints' });
  const saveBtn = el('button', { type: 'button', className: 'primary' }, editing ? 'Save changes' : 'Save as new style') as HTMLButtonElement;
  const cancelBtn = el('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;

  const refresh = () => {
    const c = checkEdit(ed);
    hints.replaceChildren(...c.hints.map(h => el('li', {}, h)));
    msg.className = 'msg' + (c.errors.length ? ' bad' : ''); msg.textContent = c.errors[0] ?? '';
    saveBtn.disabled = !c.ok;
    if (c.ok) hooks.preview(buildStyle(base.raw, ed, idFor(), base.id));
  };
  const row = (label: string, ctl: HTMLElement) => el('label', { className: 'edrow' }, el('span', {}, label), ctl);
  const color = (label: string, k: 'bg0' | 'bg1' | 'text' | 'accent' | 'muted' | 'wall') => {
    const i = el('input', { type: 'color', value: ed[k] }) as HTMLInputElement; i.oninput = () => { ed[k] = i.value; refresh(); }; return row(label, i);
  };
  const select = (label: string, k: keyof StyleEdit, options: readonly (string | { id: string; label: string })[]) => {
    const s = el('select', {}, ...options.map(o => { const id = typeof o === 'string' ? o : o.id; return el('option', { value: id, selected: ed[k] === id }, typeof o === 'string' ? o : o.label); })) as HTMLSelectElement;
    s.onchange = () => { (ed as any)[k] = s.value; refresh(); }; return row(label, s);
  };
  const slider = (label: string, k: 'lineGlow' | 'textureAmount', min: number, max: number, step: number) => {
    const out = el('span', { className: 'v' }, String(ed[k]));
    const i = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(ed[k]) }) as HTMLInputElement;
    i.oninput = () => { ed[k] = Number(i.value); out.textContent = i.value; refresh(); }; return row(label, el('span', { className: 'edslide' }, i, out));
  };
  const text = (label: string, k: 'name' | 'icon' | 'concept', max: number, ph = '') => {
    const i = el('input', { type: 'text', value: ed[k], maxLength: max, placeholder: ph }) as HTMLInputElement; i.oninput = () => { ed[k] = i.value; refresh(); }; return row(label, i);
  };
  const paletteBox = el('div', { className: 'edpal' });
  const drawPalette = () => {
    paletteBox.replaceChildren(...ed.palette.map((c, i) => {
      const inp = el('input', { type: 'color', value: c, title: `Ball colour ${i + 1}` }) as HTMLInputElement; inp.oninput = () => { ed.palette[i] = inp.value; refresh(); };
      return inp;
    }));
    const add = el('button', { type: 'button', title: 'Add a colour', disabled: ed.palette.length >= 8 }, '+') as HTMLButtonElement;
    const del = el('button', { type: 'button', title: 'Remove the last colour', disabled: ed.palette.length <= 3 }, '−') as HTMLButtonElement;
    add.onclick = () => { ed.palette.push(ed.palette[ed.palette.length - 1]); drawPalette(); refresh(); };
    del.onclick = () => { ed.palette.pop(); drawPalette(); refresh(); };
    paletteBox.append(add, del);
  };
  drawPalette();

  const close = (restore = true) => { if (restore) hooks.preview(null); dlg.close(); dlg.remove(); if (open === dlg) open = null; };
  cancelBtn.onclick = () => close();
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  saveBtn.onclick = async () => {
    const c = checkEdit(ed); if (!c.ok) return;
    const theme = buildStyle(base.raw, ed, idFor(), base.id);
    saveBtn.disabled = true; msg.className = 'msg'; msg.textContent = 'Saving…';
    try { await call('/api/themes', 'POST', { theme }); close(false); await hooks.saved(theme.id as string); }
    catch (e) { msg.className = 'msg bad'; msg.textContent = (e as Error).message; saveBtn.disabled = false; }
  };
  const actions = el('div', { className: 'row' }, saveBtn, cancelBtn);
  if (editing) {
    const del = el('button', { type: 'button', className: 'danger' }, 'Delete this style') as HTMLButtonElement;
    del.onclick = async () => {
      if (!confirm(`Delete the style “${base.name}”?\n\nVideos already rendered keep their look. Entries in Videos that used it fall back to Classic Neon.`)) return;
      try { await call(`/api/themes/${base.id}`, 'DELETE'); close(false); await hooks.removed(base.id); } catch (e) { msg.className = 'msg bad'; msg.textContent = (e as Error).message; }
    };
    actions.append(del);
  }

  dlg.append(
    el('h3', {}, editing ? `Edit “${base.name}”` : `New style from “${base.name}”`),
    el('p', { className: 'msg' }, 'The preview behind this panel changes as you edit. Everything not listed here is kept from the style you started with.'),
    el('fieldset', {}, el('legend', {}, 'Name'), text('Name', 'name', 40), text('Icon', 'icon', 4, '🎨'), text('Description', 'concept', 200, 'Optional')),
    el('fieldset', {}, el('legend', {}, 'Colours'), color('Background', 'bg0'), color('Background 2', 'bg1'), select('Gradient', 'bgMode', ['linear', 'radial']),
      color('Text', 'text'), color('Accent', 'accent'), color('Secondary text', 'muted'), color('Walls and lines', 'wall'), row('Balls', paletteBox)),
    el('fieldset', {}, el('legend', {}, 'Text'), select('Font', 'font', FONT_CHOICES.map(f => ({ id: f.id, label: f.label }))), select('Capitals', 'fontCase', ['none', 'upper', 'lower']), select('Alignment', 'fontAlign', ['center', 'left'])),
    el('fieldset', {}, el('legend', {}, 'Look'), select('Lines', 'line', LINE_STYLES), slider('Line glow', 'lineGlow', 0, 1.5, 0.05), select('Balls', 'ball', BALL_STYLES),
      select('Texture', 'texture', TEXTURES), slider('Texture strength', 'textureAmount', 0, 0.4, 0.01), select('Sparks', 'spark', SPARKS)),
    hints, msg, actions,
  );
  document.body.append(dlg); dlg.show(); open = dlg; refresh();
  (dlg.querySelector('input[type=text]') as HTMLInputElement | null)?.focus();
}
export const closeStyleEditor = () => { open?.dispatchEvent(new Event('cancel', { cancelable: true })); };
