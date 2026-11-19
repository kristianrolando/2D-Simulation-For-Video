// Contrast audit of the studio UI: paste into the browser console (or Browser pane javascript_tool) on the open studio.
// window.__audit(label) measures every visible text, placeholder, icon and form-control border against its effective background
// (backgrounds are composited through the ancestors, transparency and opacity included) and returns what is below WCAG AA:
// 4.5:1 for text, 3:1 for large text (>= 24px, or >= 18.66px bold), icons and component borders. Disabled controls are listed apart
// (WCAG exempts them). Gradient backgrounds and text over pictures cannot be measured here and are listed as "manual".
// It only reads the page; it changes nothing.
window.__audit = (label = '') => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); cv.canvas.width = cv.canvas.height = 1;
  const rgba = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a ? [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const root = rgba(getComputedStyle(document.documentElement).backgroundColor), page = over(root, [255, 255, 255, 1]);
  /** the colour behind an element: its ancestors' backgrounds composited from the top; {grad:true} when a gradient or picture is in the way */
  const behind = (el, includeSelf) => {
    const chain = []; for (let e = includeSelf ? el : el.parentElement; e; e = e.parentElement) chain.push(e);
    let bg = page, grad = false, opacity = 1;
    for (const e of chain.reverse()) {
      const cs = getComputedStyle(e); opacity *= Number(cs.opacity);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') grad = true;
      const c = rgba(cs.backgroundColor); if (c[3] > 0) bg = over(c, bg);
    }
    return { bg, grad, opacity };
  };
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && el.closest('[hidden]') === null; };
  const sel = el => { const p = []; for (let e = el, n = 0; e && e !== document.body && n < 4; e = e.parentElement, n++) p.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('') + (e.getAttribute('aria-pressed') === 'true' ? '[on]' : '')); return p.join(' > '); };
  const out = [], manual = [], disabled = [], seen = new Set(); let checked = 0;
  const add = (kind, el, text, fg, b, need, extra = {}) => {
    checked++; const r = ratio(fg, b.bg); if (r >= need) return;
    const key = kind + sel(el) + text; if (seen.has(key)) return; seen.add(key);
    const rec = { kind, sel: sel(el), text: text.slice(0, 28), fg: fg.slice(0, 3).map(Math.round).join(','), bg: b.bg.slice(0, 3).map(Math.round).join(','), ratio: +r.toFixed(2), need, ...extra };
    (el.disabled || el.closest('[disabled],[aria-disabled=true]') ? disabled : out).push(rec);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (!el || !(el instanceof HTMLElement || el instanceof SVGElement) || ['SCRIPT', 'STYLE', 'CANVAS', 'VIDEO', 'IMG', 'OPTION'].includes(el.tagName) || !visible(el)) continue;
    const cs = getComputedStyle(el), own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (el instanceof HTMLElement && own) {
      const b = behind(el, true), fgc = rgba(cs.color), fg = over([fgc[0], fgc[1], fgc[2], fgc[3] * b.opacity], b.bg), px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      if (b.grad) { manual.push({ sel: sel(el), text: own.slice(0, 28), why: 'gradient or picture behind' }); continue; }
      add('text', el, own, fg, b, need, { px, bold });
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (!el.value && el.placeholder) { const b = behind(el, true), pc = rgba(getComputedStyle(el, '::placeholder').color); add('placeholder', el, el.placeholder, over(pc, b.bg), b, 4.5); }
    }
    if (el instanceof SVGSVGElement && el.closest('button, a, summary, label')) { const b = behind(el.parentElement, true), c = rgba(cs.color); add('icon', el, el.closest('button, a, summary, label').innerText || el.getAttribute('aria-label') || 'icon', over([c[0], c[1], c[2], c[3] * b.opacity], b.bg), b, 3); }
    if (el instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['checkbox', 'radio', 'range', 'color', 'file'].includes(el.type) && parseFloat(cs.borderTopWidth) > 0) {
      const b = behind(el, false), bc = rgba(cs.borderTopColor); add('border', el, el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), over(bc, b.bg), b, 3);
    }
  }
  return { label, theme: document.documentElement.dataset.theme, checked, below: out.length, failures: out, disabled: disabled.length, disabledSample: disabled.slice(0, 6), manual: manual.slice(0, 12), manualCount: manual.length };
};
'audit ready';
