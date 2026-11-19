# Light and dark mode of the studio interface

The switch is in the **top-right corner** of the studio (next to the `?` help button): three small icon buttons, **Auto**
(follow the system), **Light** and **Dark**. Each has a tooltip; the group is a keyboard radio group (Tab to reach it,
arrow keys / Home / End to change, the choice applies at once). The choice is stored in `localStorage` (`studio.theme` =
`auto | light | dark`, default **Auto**) and applied by a small script in the `<head>` of `apps/studio/index.html`
**before the first paint**, so a reload never flashes the other mode.

## What it changes, and what it never changes

| Changes (interface only) | Never changes |
|---|---|
| panels, text, buttons, inputs, chips, tables (coverage map), status badges, dialogs, menus, notices, the quality list, the Videos page, the YouTube sections, the OAuth result page | the preview canvas, the rendered MP4, the gallery and style thumbnails, the covers and thumbnails made for YouTube, `themes/*.json` and the **style** of a video |

The separation is in code: `apps/studio/mode.ts` and `mode-ui.ts` are used only by the studio page; `tests/mode.test.ts`
fails if anything under `packages/`, `themes/` or the render worker/CLI mentions the interface mode. In the browser the
preview canvas gave the same pixel hash in Dark, Light and Auto.

## How colours are organised

All interface colours are CSS tokens at the top of `apps/studio/style.css`: `:root` (dark, the original look) and
`html[data-theme="light"]`. Everything else in the file uses `var(--token)`; the test fails on any other colour literal
(allowed: `#000` for the video, `#111` on the gold badge, one 20 % black on the key hint inside the primary button).
The only colours in code are the **category accents** (one per physics family) in `mode.ts`, as a light and a dark tone
joined with CSS `light-dark()`. To change a colour, change a token, then run `npm test`; the contrast test tells you if it
no longer reads.

## Contrast (WCAG AA, text 4.5:1)

`tests/mode.test.ts` reads the tokens from `style.css` and checks 47 text/background pairs in **each** mode plus every
category accent as text on its panels, on its own 18 % tint, and under the selected chip. All pass.

| | Lowest ratio | Typical |
|---|---|---|
| **Dark** | 4.58 (white on the primary blue button) | body text 14.3, muted 6.1, label 11.3, links 12.9 |
| **Light** | 4.66 (green "published" on its cell) | body text 16.2, muted 6.3, label 9.6, links 6.1 |

**Rules (added after active status buttons turned out unreadable: two `.seg` blocks, one painting the background and one the text colour,
ended up as pale on pale).**

- A rule that paints a pressed / selected / "on" background must set its **text colour in the same rule**. Status buttons and chips use
  the status colour with `--on-solid` (dark ink on the pale dark-mode colours, white on the deep light-mode ones); the plain switches use
  `--seg-on` with `--text`. There is one `.seg` block.
- Component borders (fields, selects, buttons) must be 3:1 against the surface behind them: `--field-line` is tuned for that in both modes.
- Placeholders use `--muted` (`::placeholder`), never the browser default grey. Dimming is done with a muted colour, not `opacity`
  (the calendar's days outside the month).
- `tests/contrast.test.ts` fails if a key token pair (text, muted, links, primary button, status ink on its colour, banners, field borders)
  drops below AA in either mode, or if a pressed/on rule sets a background without a text colour.

**Whole-page measurement:** `tools/contrast-audit.js` (load it in the open studio, then `window.__audit()`) measures every visible text,
placeholder, icon and form-control border with the backgrounds composited, and lists what is below 4.5:1 (3:1 for large text, icons and
borders). The last run covered 20 views in each mode (studio Basic and Advanced, help, settings drawer, style editor, Videos list, menu,
coverage map, four video details, YouTube dialog, Long list and detail, calendar, Build long video with suggestion and detail), about 24,000
measurements, and found **nothing below AA**. Disabled controls (44 in those views) are exempt under WCAG and not counted. Not measured:
hover and focus states, tooltips, the render strip while a real job runs (checked with sample rows), and text over pictures (none found).

## Auto

Auto resolves from `prefers-color-scheme` when the page loads and follows the system while the page is open. The
`change` event is listened to, and the choice is looked at again when the window gets focus or becomes visible, in case an
event was missed. If neither storage nor the media query is available the studio stays dark (its original look).

## Screenshots

`docs/evidence/ui-modes/`: `studio-dark.jpg`, `studio-light.jpg`, `videos-dark.jpg`, `videos-light.jpg`.
