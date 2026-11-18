// One small set of line icons for the studio interface (24x24, stroke = currentColor, no emoji, no brand marks).
// An icon always sits next to a text label or carries its own aria-label/title on the button. The video styles keep their
// own identity in themes/*.json; the interface shows them with the line icons below (unknown styles fall back to their own icon).
const P: Record<string, string> = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5.5h3.4v13H7zM13.6 5.5H17v13h-3.4z" fill="currentColor" stroke="none"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8"/><path d="M12 16.8v.2"/>',
  pick: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  preview: '<rect x="3.5" y="5" width="17" height="11.5" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  videos: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17M3.5 15h17M8 5v4M16 5v4M8 15v4M16 15v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.6v.2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8 3.5v4M16 3.5v4"/>',
  draft: '<circle cx="12" cy="12" r="7.5"/>',
  rendered: '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none"/>',
  published: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l3 3 5-6"/>',
  upload: '<path d="M12 19V8"/><path d="M7 12.5L12 8l5 4.5"/><path d="M5 4.5h14"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  // video styles (interface only)
  'style-classic': '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  'style-blueprint': '<path d="M4 20L20 4"/><path d="M4 20h9M4 20v-9"/><path d="M7 20v-2M10 20v-2M4 17h2M4 14h2"/>',
  'style-candy': '<circle cx="12" cy="12" r="5"/><path d="M7 7l-3-2v5M17 17l3 2v-5M7 17l-3 2v-5M17 7l3-2v5" /><path d="M10 10c1.5-1 3 .5 4 2"/>',
  'style-chalk': '<rect x="3.5" y="5" width="17" height="12" rx="1.5"/><path d="M7 10h6M7 13h9M8 20h8"/>',
  'style-riso': '<circle cx="9.5" cy="12" r="5.5"/><circle cx="14.5" cy="12" r="5.5"/>',
  'style-terminal': '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 10l3 2.5-3 2.5M13 15h4"/>',
};
/** an inline <svg> string; unknown names give an empty string */
export function icon(name: string, size = 14): string {
  const d = P[name]; if (!d) return '';
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
export const hasIcon = (name: string) => name in P;
/** the interface icon for a video style: ours when we have one, otherwise the style's own icon text */
export function styleIcon(id: string, own: string, size = 14): string { return hasIcon('style-' + id) ? icon('style-' + id, size) : own; }
export const ICON_NAMES = Object.keys(P);

/** fill every <span class="ico-slot" data-icon="name"> in the page with its icon */
export function hydrateIcons(root: ParentNode = document, size = 16) {
  for (const n of root.querySelectorAll<HTMLElement>('.ico-slot[data-icon]')) if (!n.firstChild) n.innerHTML = icon(n.dataset.icon!, size);
}
/** an element holding a style's interface icon (ours, or the style's own text icon) */
export function styleIconEl(id: string, own: string, size = 14): HTMLElement {
  const e = document.createElement('span'); e.className = 'ico-slot'; if (hasIcon('style-' + id)) e.innerHTML = icon('style-' + id, size); else e.textContent = own; return e;
}
