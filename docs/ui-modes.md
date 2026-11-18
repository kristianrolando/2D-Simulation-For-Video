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

In the browser a scan of every visible text element (computed colours, backgrounds composited) found **no text below
4.5:1** in either mode on: the studio (Basic and Advanced tabs), the render history popup, the help dialog, the Videos list
and detail, the coverage map and the Export menu (about 140 to 205 texts per view). Pictures and video are excluded.

Not covered by WCAG text rules and kept as before: decorative borders in the dark mode (light mode uses stronger control
borders, about 3:1).

## Auto

Auto resolves from `prefers-color-scheme` when the page loads and follows the system while the page is open. The
`change` event is listened to, and the choice is looked at again when the window gets focus or becomes visible, in case an
event was missed. If neither storage nor the media query is available the studio stays dark (its original look).

## Screenshots

`docs/ui-modes/`: `studio-dark.jpg`, `studio-light.jpg`, `videos-dark.jpg`, `videos-light.jpg`.
