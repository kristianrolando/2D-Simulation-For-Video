# Sim Studio

A local web app for building 2D physics/math simulations, previewing them live, and rendering them
to Shorts-ready MP4s (1080×1920, 60 fps, H.264 High, BT.709, AAC 44.1 kHz). The look and the
spec follow the 18 reference Shorts in `references/` (see `docs/analysis.md`, `docs/report.md`).

## Quick start

```bash
npm install
npm run dev          # studio at http://127.0.0.1:5180
```

In the studio the main path is one click: the studio opens on a ready scene with the default style, so **Render MP4** (or the **R** key) already works without changing anything.

- **Pick.** The left gallery shows every scene and preset as a thumbnail (rendered once by the server, cached in `output/thumbs/`). Search by name or topic (`/` focuses the box, Enter opens the first match), or filter by category chip. Scene presets (bundles of scene settings, read-only) sit right after the scene they belong to (`↳ scene name · scene preset`). `[` and `]` step through the list.
- **Adjust.** The right panel has two tabs. **Basic** holds the scene's main options (the first group open, the rest one click away) and the six **Style** cards, each a thumbnail of *this* scene in that style (keys `1`–`6`). **Advanced** holds the background settings, timing, colours and trails, sound, effects (juice), "Reset scene options" and the simulation check. Under the style cards, **Style presets** lay a saved look (background, colours, font) over the chosen style in any scene; see [Style presets](#style-presets). The preview follows every change; press Space or ▶ to play with sound and drag the timeline to seek. **Preview: Auto** lowers preview quality when frames get slow; the final render is always full quality.
- **Render.** The **Render MP4** button sits next to the transport controls, so it is always on screen. Below the preview a status strip shows what is happening (queued, preparing sound, rendering with percent and time left, finishing) and, when done, **Play**, **Show in folder** and **Texts & publish** (see Videos below). **All renders** lists the last renders, including those from earlier sessions. Files land in `output/` as `<scene>-<layout>-<style>-<timestamp>.mp4` together with a `.job.json`. Errors are explained in plain words with a next step (for example when ffmpeg is missing or the server stopped).

Keyboard shortcuts (press `?` in the studio): Space play/pause, ←/→ frame (Shift: 1 s), `R` render, `V` videos, `/` search, `[` `]` previous/next simulation, `1`–`6` style, `M` sound, `D` preview statistics (hidden by default), `?` list.

#### Your own styles

**＋ New style from this one** (Style section) opens an editor beside the preview: colours, font, line, ball and texture. Save writes
`themes/<id>.json`, usable in every scene at once; shipped styles cannot be overwritten. Details: `docs/styles.md` §4.

### Shorts thumbnail (what YouTube gets)

YouTube crops a Short's custom thumbnail to 9:16 around the centre, so the studio uploads the tall **1080×1920** picture
(`<id>-cover.jpg`), never the wide 1280×720 one. A video already uploaded with the wide picture is flagged in Videos, and
**Set the thumbnail again** fixes it after your approval (50 quota units). Details: `docs/publishing.md`.

## Restarting the studio safely (`dev` and `dev:watch`)

The server loads its code once when it starts, so a code change needs a restart. The render queue survives that:

- **`data/jobs.json`** keeps every render (scene, settings, style, status, times, result; no credentials). It is written atomically with
  backups, like the video list, and a damaged or missing file never stops the studio from starting (the bad file is kept aside and the
  newest good copy is used).
- A render that was **running or queued** when the studio stopped comes back as **⏸ Stopped**, with a **Render again** button. Renders are
  deterministic, so Render again just runs the same scene and settings again (same video), instead of resuming half way.
- **No orphans, no leftovers.** Each render worker runs in its own process group and is stopped together with its ffmpeg when the studio
  stops (SIGTERM, Ctrl+C, a restart by `node --watch`). If the studio is killed outright, the worker notices within about 2 seconds and
  exits; at the next start a worker that is still alive is stopped only if `ps` shows it is our own worker for that job. Request files,
  temp audio and half-written MP4s of interrupted renders are removed; a render that did finish just before the stop is recognised as done.
- A second studio on the same data folder is read-only and never touches the first one's jobs.
- YouTube uploads and the video list were already restart-safe (stages are recorded, **Continue** resumes); that is unchanged.

| Command | Use it for |
|---|---|
| `npm run dev` | Normal work: rendering and uploading. Restarts only when you do it. |
| `npm run dev:watch` | Development sessions where the code changes often: the server restarts itself when a server file changes. |

With `dev:watch`, **do not leave a render or an upload running while files are being edited**: a restart stops the render (you press Render
again) and cuts an upload at its current step (you press Continue). `themes/`, `presets/`, `style-presets/` and `data/` are not watched, and changes to the
studio page itself (`apps/studio/`) reload in the browser without a server restart. A banner at the top says when the running server is older than its files.

## Light and dark mode (interface only)

The top-right corner has three small buttons: **Auto** (follow the system, the default), **Light** and **Dark**. The choice is remembered and applied before the page is drawn, so there is no flash on reload. It changes only the studio's own panels, text, buttons, tables, badges and dialogs: **the video preview, the rendered MP4, thumbnails and the style themes (`themes/*.json`) are never affected**. Colours are CSS tokens at the top of `apps/studio/style.css`; all text meets WCAG AA (4.5:1) in both modes, checked by `tests/mode.test.ts`. Details, numbers and screenshots: `docs/ui-modes.md`.

### Videos: texts, status and tracking (no upload, no login)

Every render you start in the studio becomes an entry in **Videos** (the switch at the top of the left column, or press `V`). The entry is already filled in, so the form is never empty:

- **Texts for YouTube.** **Five titles** in different styles (direct question, what is at stake, starts with a number, curious statement, how/why explainer; click one to use it), a description, tags and exactly three hashtags (`#Shorts` first), written in English from the scene's own parameters (balls, rows, ratios, rule), its topic and the style: same video, same texts (seeded), and videos differ from one another. Titles are at most 100 characters with the hook and the main keyword first; the description opens with the hook and the keyword, explains what happens in two true sentences and has one calm subscribe line, in one of four layouts (**Another description** rewrites it). A **quality check** under the fields flags limits, duplicate tags, a missing keyword, bait phrases, claims the video does not show and numbers that are not in the video. Details: `docs/publishing.md`; the research behind it (patterns only, nothing copied): `docs/publishing-research.md`. Edit anything; counters and gentle warnings follow YouTube's documented limits (title 100 characters, description 5000 **bytes**, tags 500 characters in total with the commas, more than 60 hashtags are ignored, no `<` or `>`). The **Suggestions** menu in the Videos bar picks the language of the suggested title, description and tags: English (default) or Indonesian; it is stored in `data/videos.json` and does not translate the interface. **Copy** buttons sit next to each field and say "Copied ✓"; if the browser blocks the clipboard, the text appears selected in a box so Ctrl/Cmd+C works, and **Copy title, description and tags** at the top copies all three. **Reset to suggestion** puts the first suggestion back. Format: Shorts, 1080×1920, 60 fps.
- **Thumbnail and cover.** When a render finishes, the studio picks the best frame by itself (a busy, tense frame near the climax: the moment the pattern closes or the last ball lands) and draws two pictures in the video's own style with the hook on them: a **1080×1920 Shorts cover** (text in the safe zone) and a **1280×720 thumbnail** (text left, frame right), saved as JPEG in `data/thumbnails/`. The thumbnail is what the YouTube upload sets. In Videos you can edit **Text on the thumbnail**, press **Pick the best frame automatically** again, **Use this frame** for the frame the player is paused on, or **Without text**. A choice you made is never replaced by the automatic one. Free and local (ffmpeg and the canvas the renderer already uses).
- **Status and tracking.** Draft → Rendered → Scheduled → Published, a scheduled date, the published date (filled in with today when you mark it Published), the YouTube link and free notes. Changes save by themselves.
- **List.** Filter by status, search titles, notes, scene, style and links. The top line says how many of the 60 scene × style combinations were never made into a video; open it for the map, and click a cell to open that scene and style in the studio.
- **Renders made outside the studio.** Opening Videos scans `output/` (the import call also accepts `{"files": ["name.mp4"]}` to add only some of them): every MP4 that has its `.job.json` next to it (`npm run render` writes one, with any `--out` name) and is not in the list yet is counted in a banner with one button, **Add all N to the list**. Nothing is imported by itself. Files changed in the last 15 seconds (still being written) are skipped, and a file already in the list is never added twice (matched by file name).
- **Two studios.** Only one studio may write to `data/`. It keeps `data/.lock` (its process id); a second studio on the same folder opens **read-only** with a red banner (you can look and copy, nothing is saved) and takes over by itself when the first one is gone. A lock left by a crashed or killed studio is recognised as stale and replaced.
- **Export.** CSV (opens in a spreadsheet), JSON (a complete backup copy) and **Open data folder**.

Fast path from render to published: **Render MP4** → **Texts & publish** (under the preview) → **Copy title, description and tags** → upload on YouTube yourself → **Published** → paste the link. That is 4 clicks and a paste.

Files are named `<scene>-<layout>-<style>-<timestamp>.mp4` in `output/`; **Play** and **Show in folder** are in the status strip under the preview (with **Texts & publish**), **Copy path** is in the render history (**All renders**), and the video's page has **Show MP4 in folder**.

**Where the data lives.** Everything is local, in `data/` (set `SIM_DATA_DIR` to move it), never inside `references/`:

```
data/videos.json        the list (carries "schemaVersion", plus the suggestion language)
data/.lock              process id of the studio that may write (removed on a clean stop)
data/backups/           a copy of the previous file before every save (newest 50) + one snapshot per day (60 days)
data/thumbnails/        thumbnails (<id>.jpg 1280×720) and Shorts covers (<id>-cover.jpg 1080×1920)
data/videos.damaged-*   a file that could not be read, kept untouched (also videos.newer-* for a newer schema)
```

Saving writes a temporary file, flushes it to disk and renames it over `videos.json`, so a crash or full disk leaves the old file whole. A missing or damaged file never stops the studio: the bad file is set aside, the newest good backup is restored (or the list starts empty), and a yellow notice in the Videos view says what happened. To go back by hand, copy a file from `data/backups/` over `data/videos.json`. The studio never contacts YouTube and asks for no credentials.

Save a look with **Save style preset** (Basic tab, under the style cards); it is written to `style-presets/<id>.json`. The scene presets in `presets/` ship with the studio and are not written by the interface.

To render from the command line:

```bash
npm run render -- --preset mirrors-cassegrain --out output/cassegrain.mp4
```

```bash
npm run render -- focal-reflection --params '{"layout":"peanut","waves":9}'
```

```bash
npm run render -- rosette-orbit --hash /tmp/frames.txt   # also writes a SHA-1 per frame
```

Run the tests: physics accuracy, frame determinism, golden simulation-state hashes, style themes (loading, token fallback, physics unchanged across styles, styles visibly different), background settings, the studio helpers (search, shortcuts, error messages), video tracking (metadata and languages, limits, status changes, atomic writes, backups, recovery, CLI render scan, lock file), and the publishing writer (five title styles, description layouts, tags, the quality checker, best-frame choice, cover drawing on a real MP4).

```bash
npm test
```

```bash
npm run typecheck
```

### Upload to YouTube (free, official API, private first)

The **YouTube** section of a video in **Videos** uploads it with the official YouTube Data API v3. No billing, no paid service, no npm package. The full plan, the facts checked against Google's documentation and the click-by-click Google Cloud setup are in `docs/youtube-upload-plan.md`.

- **Set up once** (Videos → Export → **YouTube settings…**):
  1. In Google Cloud: create a project (no billing), enable *YouTube Data API v3*, set the Auth Platform audience to *External* and **In production**, and add the scope `youtube.force-ssl`.
  2. Create a **Desktop app** client and download its JSON.
  3. In the studio: **Take client_secret_….json from Downloads**. The studio copies it to `~/Library/Application Support/Sim Studio/youtube.json` (mode 600) and deletes the download.
  4. **Connect…**: sign in on Google's page. Google may show "app not verified": choose *Advanced → Go to Sim Studio*; that is allowed for personal use.
  5. For custom thumbnails, verify the channel at youtube.com/verify.
- **Per video** (status *Rendered*):
  - Choose when it goes public (a date ≥30 minutes ahead, or *now*), plus category, language, made for kids, AI label and notify. The title, description + hashtags, tags and the chosen thumbnail frame are used as they are.
  - Press **Upload to YouTube…**. The dialog shows everything and needs your tick per video.
  - The video is uploaded **private**. The thumbnail is set once YouTube has processed it, then it is scheduled or made public.
  - The link fills itself in, and the tracking status becomes **Scheduled** or **Published**.
  - Scheduled → Published flips by itself once YouTube says the video is public (checked when Videos opens and every 15 minutes, once per video; it never demotes).
- **Safety:**
  - **Secrets:** the client secret and the refresh token live only in `~/Library/Application Support/Sim Studio/youtube.json` (mode 600). Access tokens stay in memory, and session URIs are kept in `…/youtube-sessions/` (600). None of them reach the workspace, `data/`, logs or the page.
  - **No repeats:** a video is never uploaded twice, never re-uploaded automatically, and never deleted (the code has no delete call; a test checks this).
  - **Failures:** a quota error shows a message with the reset time (midnight Pacific Time) and is not retried. A dropped connection resumes the same upload session, and after a studio restart **Continue upload** picks it up.
  - **Disconnect** revokes the permission at Google.
- **Quota** (checked 2026-11-18): 100 uploads per day in their own bucket, plus 10,000 units for everything else (thumbnail 50, publish now 50, status checks 1). One upload uses about 60–150 units.
- **Tests:** `tests/youtube.test.ts` runs a real studio against a local stand-in of Google (`tests/fake-google.ts`): OAuth with PKCE, expired and revoked tokens, quota, dropped connections, a killed studio, expired sessions, refused thumbnails, and leaks. No test talks to Google.

## Open it with a double-click (macOS)

`Sim Studio.app` is in the project root. Double-click it: it starts the server if it is not running yet (`apps/server/server.ts`, port 5180), opens the studio in your browser, and puts an icon in the menu bar (top right). A second double-click only opens the browser again; there is never a second icon or a second server.

Menu bar icon (an octagon; a dot in the corner while rendering, a diamond for a problem, faded when the studio is off):
- a status line: *Siap* (ready), *Sedang render: galton-board 42%*, *Antre: n render*, *Selesai: … (3 mnt lalu)* for ten minutes after a render, *Render gagal*, or *Studio belum menyala*;
- **Buka Studio**, **Salin tautan Studio** (copies `http://127.0.0.1:5180` as plain text so you can paste it into any browser; works even when the server is off; the menu bar icon turns into a check mark for about 1.5 s as confirmation), **Buka Videos** (opens `/#videos`), **Buka folder output**, **Buka log**;
- **Mulai otomatis saat login**: **off** unless you tick it. Ticking it registers the app as a login item (or, if macOS refuses, a LaunchAgent at `~/Library/LaunchAgents/local.sim-studio.menu.plist`); unticking removes it. Opened at login it only starts the server, without opening the browser;
- **Keluar** closes the icon only. The server and any render in progress keep running (stop the server with `Ctrl+C` in its terminal, or `kill` its process).

The icon asks `http://127.0.0.1:5180/api/status` about every 5 seconds (and once when you open the menu). That endpoint is localhost-only, read-only and tiny: state (`ready`/`rendering`/`queued`), the running scene and percent, queue length, error count, the last finished render and its age, read-only mode. It carries no parameters, titles or paths. The icon talks to nothing else.

- **In the Dock:** drag `Sim Studio.app` from Finder onto the Dock (left of the Trash divider). It works as a launcher; while running it shows only the menu bar icon, not a Dock icon. Dragging it into *System Settings → General → Login Items* is the manual alternative to the menu checkbox.
- **If you move the project folder**, run `./apps/mac/make_app.sh` again: the app remembers where the project is (and the PATH where Node was found, because an app opened from Finder has no PATH) in `Sim Studio.app/Contents/Resources/location.txt`. The script rebuilds the icon (`apps/mac/icon.py` → `.icns`, standard library only), compiles `apps/mac/menubar.swift` with the `swiftc` that ships with the Command Line Tools, signs ad-hoc, and closes an old icon first. It never stops the server and writes only inside the project folder.
- **Messages.** Node.js missing (or older than 23.6) or the project folder not found: a dialog says so (and the same text goes to the log). Log: `~/Library/Logs/Sim Studio.log` (server output too).
- **Backup:** double-click `Buka Studio.command` (same behaviour, in a Terminal window, no icon).

## Scenes

| Scene | Category | What it shows | Accuracy check (`npm test`) |
|---|---|---|---|
| `focal-reflection` (layouts: ellipse, peanut, parabola, corner, cassegrain, gregorian) | Mirrors | waves of balls reflect off conic mirrors into one focus | miss < 1e-9 px, arrival spread < 1e-9 s, 0 lost balls |
| `rosette-orbit` | Orbits | precessing orbit that closes after 360/precession turns | RK4 vs closed form, closure < 1e-6 px |
| `resonance-orbits` | Orbits | p:q resonance string art, (p−q) petals | pattern closes to < 1e-9 px |
| `pendulum-wave` | Oscillation | pendulums drift apart and line up again (3D) | realignment < 1e-8° |
| `harmonograph` | Oscillation | two damped pendulum pairs draw a decaying figure | closed form |
| `galton-board` | Chance | random bounces stack into a bell curve | bins vs Binomial(R,p): χ² and mean |
| `gravity-bounce` | Chaos | balls 10⁻⁹ px apart under gravity diverge (butterfly effect) | energy drift < 1e-10, contacts on the wall |
| `billiard` (circle, triangle, square) | Geometry | does a single ball's path close? | rational closes (2/7 → 7, 5:3 → 16), 1/φ² never |
| `hammer-smash` (rules: split, box, survive · containers: octagon, circle, square, triangle, ring) | Smash | hammers slam out of the walls and smash the balls; the count explodes until the container bursts, then the video rewinds and loops | same seed = same run (browser = Node, bit for bit), counts obey the rule, balls stay inside |
| `sync-lines` (modes: orbits, lid, slider, close) | Sync | different rhythms that line up again, hit the lid together, hide a shape under a new line every few seconds, or draw a line that may never close | everything is back at the start at the promised moment; fractions close after q turns, π never does |

### The two templates (variants, seed, hooks)

Both are **parametric templates**: one scene, many videos. The studio's Basic tab holds the rule, the container, the objects, the counts and the **Seed**; everything else is under Advanced.

- **Seed.** A number (slider, number box, or **🎲 Random**). The same seed gives the same video in the preview and in the render: the state of the simulation is identical bit for bit between the browser and Node (`node tools/state-sig.ts` prints the same checksum you can read in the browser). Colours, the order of the strikes, the "seeded" lap set and the "seeded" ratio all come from it.
- **Hook.** The on-screen question is empty by default and filled in automatically; it follows the rule and the seed (grey text in the field). **Edit suggestion** copies it into the field so you can change it (`/` starts a second line). The same text becomes the first title idea in Videos.
- **Hammer smash.** `rule`: `split` (a crushed ball becomes 2–4), `box` (the hammers meet and form a box; every bounce inside it adds a ball), `survive` (crushed balls are gone, a lucky wall bounce adds one; the hammer can win). `container`: octagon, circle, square, triangle (hammers come out of the corners), ring (a hub in the middle). `objects`: ball, square, triangle, gem, star, mixed (they are drawn as shapes but collide as discs). 1–4 hammers, gravity, speed, size, capacity (up to 2,500), strike rhythm and how much faster it gets.
- **Sync & close.** `mode`: `orbits` (laps per dot: consecutive, odd, primes or seeded; same or alternating direction; circle, square or triangle track, or a ring), `lid` (bounce rhythm per object, linear/gravity/piston motion; they all meet the lid at the same instant), `slider` (a new line every few seconds, each dot only slides; the hidden shape is a circle, a 4- or 3-petal flower, or a pulse), `close` (a two-arm pen; ratio π, √2, φ, e, 7/3, 5/2, 8/5 or a seeded fraction: fractions close after q turns, irrational ratios get "almost closed" at 7 and 113 turns and never close).
- **Endings.** Hammer smash: the container bursts, then the whole run rewinds to frame 0 (the last frame equals the first). Sync & close: every dot returns to where it started, so the video loops. Both are tested.
- **Presets** for the variants are in the gallery (`hammer-*`, `sync-*`).

### Adding a variant
1. A new *value* of an existing option (a rule, container, lap rule, ratio, hidden shape): add it to the option list at the top of `packages/scenes/hammer-smash/sim.ts` / `packages/sim/shapes.ts` / `packages/scenes/sync-lines/model.ts`, implement it in the same file (it must be a pure function of the parameters and the seed, using only dmath), and add a case to the tests in `tests/templates.test.ts` (the rule's logic, plus the loop ending).
2. A new *bundle of settings*: copy a file in `presets/`, change `params`, and it appears in the gallery. No code.
3. New hook sentences: add them to `HOOKS` in the scene's `index.ts` (`{k}`, `{n}`, `{d}`, `{r}` are filled in). The seed picks one.

## Styles

A style decides how a video **looks, moves and sounds**: colours, background texture, line and ball shapes,
typography, title entrance, counter animation, juice profile and the sound palette. It never touches the
simulation: a scene renders the exact same physics in every style (`tests/theme.test.ts` checks the state hashes).

| Style | Concept | Good for |
|---|---|---|
| `classic` Classic Neon | the original look, close to the reference videos (kept for compatibility) | — |
| `riso` Riso Print | risograph poster: spot inks overprinted on warm paper, misregistered, condensed caps | chance, statistics, pop-science |
| `chalk` Chalkboard | pastel chalk on a smudged green board, handwritten titles, calm pace | step-by-step explanations |
| `terminal` Amber Terminal | amber CRT: scanlines, pixel blocks, typed prompt, chiptune | algorithms, chaos, counting |
| `candy` Candy Pop | cartoon stickers on a violet sunburst, elastic bounces, confetti | light-hearted, kids, reactions |
| `blueprint` Blueprint | engineering drawing: double lines, centre lines, grid, title block | geometry, optics, mechanics |

Pick one in the studio, or pass it as a parameter:

```bash
npm run render -- galton-board --params '{"style":"riso"}'
```

The design (reference fingerprint, axes per style) is in `docs/styles.md`. Compare all styles on one frame:

```bash
node tools/style-sheet.ts galton-board --at 0.6
```

```bash
node tools/style-evidence.ts
```
(the second command measures every style against a reference frame).

### Style presets
A **style preset** is a saved look (background, colours, font) laid over *any* style in *any* scene; it is not a scene template
and not a style of its own. In the studio: Basic tab, under the style cards, click a chip to apply it, **None** to remove it,
**Save style preset** to save what you see now. It is stored in `style-presets/<id>.json` and copied into the scene parameter
`stylePreset`, so the preview, MP4, thumbnails and cover all follow it. Without a preset everything renders exactly as before.
Details, the file format and what it does not touch: `docs/styles.md` §5.

### Background settings (per style)
Every style offers its own background controls in the studio (right panel, under the style cards): colour pickers,
sliders and choices grouped with icons, a few colour presets that go together, and a Reset button. The preview
changes live; the settings are remembered per style and go into the render, so the MP4 matches the preview.
They are stored in the scene parameter `bgSettings` (JSON of the values that differ from the defaults):

```bash
npm run render -- galton-board --params '{"style":"riso","bgSettings":"{\"paper\":\"#fbe9a8\",\"pattern\":\"grain\"}"}'
```

Out-of-range numbers are clamped, colours that would hurt readability are pulled back (`lumaMin`/`lumaMax`), and
anything missing or invalid falls back to the default without an error.

**Declaring background parameters for a new style.** Add a `background` block to `themes/<id>.json`. The studio builds
the controls from it, so no UI code is needed:

```json
"background": {
  "params": {
    "paper":  { "type": "color",  "label": "Paper colour", "group": "Paper", "icon": "📄",
                "default": "#f6eedf", "lumaMin": 0.7, "target": "color.bg.0" },
    "dots":   { "type": "number", "label": "Dot size", "group": "Texture", "icon": "🔘",
                "default": 18, "min": 8, "max": 40, "step": 1, "unit": "px", "target": "texture.spacing" },
    "pattern": { "type": "enum",  "label": "Pattern", "group": "Texture", "icon": "🔘",
                "default": "halftone", "options": ["halftone", "grain", "none"], "target": "texture.kind" }
  },
  "presets": [
    { "id": "default", "name": "Classic", "values": {} },
    { "id": "sun", "name": "Sunny paper", "values": { "paper": "#fbe9a8", "dots": 24 } }
  ]
}
```

- `target` is the token (or list of tokens) the setting overrides: `color.bg.0/1/2`, `color.bgAngle`, `color.bgCx`, `color.bgCy`, `color.wall`, `color.wallGlow`, `color.accent`, `line.glow`, `texture.kind/color/amount/spacing/vignette`, and so on. `palettes.*` rebuilds every ball palette as a tonal ramp of one colour.
- Keep `default` equal to the token's value (a test checks this), so an untouched style looks exactly as designed.
- Choose `min`/`max` and `lumaMin`/`lumaMax` so every allowed value stays readable and on-identity.
- Parameter names, groups and counts are yours: styles do not have to share any (Classic offers glow and a grid, Riso a halftone, Terminal scanlines).
- Invalid parameters or presets are dropped with a warning when the theme loads; `npm test` fails if a shipped theme has any.

### Adding a style
Add **one file**, `themes/<id>.json`; nothing else changes. Start by copying an existing theme. Every token you leave
out, or that is invalid, falls back to `classic`, and the server prints a warning naming it. The studio picks the new file
up on the next page load, without a restart.

| Token group | What it controls |
|---|---|
| `color.*` | background stops (`bg`, `bgMode`), text, accent, walls (`wall`, `wallGlow` = second ink / shadow, `wall2`), focus, pegs, sun, planets |
| `palettes.*` | `cyclic` (many balls), `timeline` (colour over time), `spectrum` (pendulums), `sparks` (particles) |
| `texture` | `none`, `grain`, `grid`, `scanlines`, `chalk`, `halftone` or `sunburst`; plus `amount`, `spacing` and `vignette` (painted once, free per frame) |
| `line.style` | `neon`, `flat`, `misprint`, `sketch`, `technical`, `sticker` or `pixel`; plus a width factor and glow |
| `ball.style`, `comet.style`, `spark`, `focus` | ball sprite (`glossy`, `flat`, `misprint`, `chalk`, `pixel`, `sticker`, `ring`); tail (`tail`, `flat`, `none`); particle shape; target marker |
| `blend`, `trail` | how light accumulates (`lighter` on dark themes; `multiply`, `screen`, `source-over` for ink looks); trail alpha, width and haze factors |
| `font.*` | family stack (end with a bundled DejaVu face), weight, sizes, case, alignment, `counterStyle` (`inline`, `stack`, `pill`, `bracket`, `tag`), `deco` (`highlight`, `underline`, `prompt`, `titleblock`) |
| `motion.*` | easing of the counter pop and roll, the title entrance (`slide`, `drop`, `type`, `wipe`), the ripple easing, and the shake style |
| `juice.*` | multipliers on the user's juice sliders; `flashMode` (`add`, `tint`, `invert`, `none`), flash colour, particle blend |
| `audio.*` | `pitch` (semitones), `scale` (notes are snapped to it), `decay`, `roleMap` (e.g. `tick → pop`), `fx` (`lowpass`, `highpass`, `drive`, `crushRate`/`crushBits`, echo, doubler) |

Fonts: system fonts (Futura, Menlo, Chalkduster, …) work in both the preview and the render. If a font is missing on
a machine, the stack falls back to a bundled DejaVu face (`assets/fonts`, free licence).

## Juice (game feel)

`packages/juice` is a reusable effects kit every scene uses. Each effect is a 0–2 slider in the scene's **Juice** group; 0 switches it off.

| Effect | Triggered by |
|---|---|
| Screen shake | big events (wave, climax); offset snapped to whole pixels |
| Flash | climax / answer reveal |
| Particle bursts | impacts, peg hits, milestones; fixed-size pool, no per-frame allocation |
| Squash & stretch | speed (stretch) and impacts (squash) |
| Counter pop / roll | counter changes: the number scales up and rolls to its new value |
| Energy colour | `energize()` shifts a colour toward white-hot with speed |
| Easing | `ease.outBack`, `outElastic`, `outBounce`, … |

All juice state is plain data, part of the scene snapshot and seeded, so renders stay deterministic. The active style scales these sliders (e.g. Candy Pop ×1.8 squash, Blueprint 0 shake) and picks the particle shape.

## Sound

Scenes request a **role** (`tick`, `bounce`, `drop`, `ping`, `chime`, `note`, `whoosh`, `boom`, `success`, `pop`, and for the hammer and sync templates `slam`, `crush`, `shatter`, `rewind`, `clang`), never a file. `packages/audio/bank.ts` plays a sample from the library when one exists for that role, and falls back to local synthesis otherwise, so audio always renders. Variation:
- pitch follows a musical scale (pentatonic by default, from the event's index or energy);
- each event gets a seed-chosen sample variant;
- a voice limiter turns hundreds of simultaneous hits into one louder hit.

The library lives in `assets/sfx/`:
- `requests.json` is the full list of needed sounds; pitched musical roles are marked synth-only on purpose.
- `manifest.json` records name, role, tags, duration, original prompt and a prompt hash for each sample.
- `src/` keeps the paid-for originals, so they can be reprocessed for free.

To check or reprocess the library:

```bash
node tools/sfx.ts plan
```
Lists only the requests not yet in the library; nothing already generated is ever listed again.

```bash
node tools/sfx.ts reprocess
```
Re-converts the samples from `src/` without spending credits.

`node tools/sfx.ts import <id> <file>` refuses a prompt hash that already exists. Samples are decoded once per process (server) or per session (studio).

## Architecture

```
packages/core       deterministic math (dmath), TimeWarp, parameter schema, scene contract, colours
packages/render2d   Canvas2D kit: neon walls, sprites, comets, trail layers (+snapshot), header text, 3D camera
packages/audio      procedural SFX (recurrence oscillators), sample bank + roles + voice limiter, mixer, WAV
packages/juice      shake, flash, particle pool, squash/stretch, counter pop/roll (all deterministic)
packages/theme      style tokens, validation + fallback to classic, registry, palette helper
packages/publish    video metadata (title/description/tags writer, quality checker, thumbnail logic, status changes, filters, coverage, CSV); topics.ts = what each scene is about; pure; describe.ts links it to the scenes
themes/             one JSON file per style (riso, chalk, terminal, candy, blueprint)
packages/sim        shared by the templates: spatial grid for discs (O(n) broad phase, no allocation), container shapes (octagon, circle, square, triangle, ring)
packages/scenes     one folder per scene: sim (pure) + view + audio + schema; index.ts = registry
apps/studio         web UI (Vite): gallery with search, Basic/Advanced settings, preview player, render status strip; ux.ts = pure helpers (search, shortcuts, error messages); mode.ts + mode-ui.ts = light/dark/auto interface mode (colour tokens live in style.css)
apps/mac            macOS app: menubar.swift (menu bar icon), make_app.sh (builds Sim Studio.app), icon.py (draws the icon)
apps/server         cover.ts (best frame by ffmpeg, cover and thumbnail drawing), youtube.ts (OAuth PKCE, secrets in Application Support, API, resumable upload), uploader.ts (one upload at a time, outside the render queue)
apps/server         HTTP server (Vite middleware + API + SSE; status.ts = the light /api/status summary for the menu bar), render worker (Node + @napi-rs/canvas + ffmpeg), store.ts (atomic video list with backups, lock file), scan.ts (renders in output/ not yet in the list)
tests/              mode.test.ts (interface mode: boot script, contrast, no stray colours, separation from the video), copywriter.test.ts (titles, descriptions, tags, quality checker, best frame, covers), physics.test.ts, determinism.test.ts, new-logic.test.ts, theme.test.ts, background.test.ts, style-preset.test.ts, ux.test.ts, publish.test.ts, templates.test.ts, status.test.ts, youtube.test.ts + fake-google.ts, golden-state.json
assets/sfx/         sound library (manifest.json, requests.json, src/ originals)
tools/              bench.ts (performance, --style), sheet.ts (contact sheet of a scene's frames), state-sig.ts (state checksum, to compare browser and Node), sfx.ts (sound library), style-sheet.ts / style-evidence.ts (style comparison), hash-frames.ts
presets/            scene presets: bundles of scene settings, shipped with the studio (JSON)
style-presets/      style presets: background + colours + font saved from the studio (JSON)
output/             rendered MP4s + their job.json
data/               video list, backups, thumbnails (created on first save)
prototypes/         Phase-2 prototypes (kept for reference)
```

The same scene module runs in the browser preview and in the Node render worker. Only the injected
`env` differs: canvas factory and device scale.

### Rules that keep renders reproducible
- Simulation code uses only `packages/core` math (`dsin`, `dcos`, `dexp`, `datan2`, …) and IEEE-exact operators. Never `Math.sin/cos/exp/pow/atan2`, `Math.random` or `Date`. Engines differ in the last bit of those functions; with dmath, simulation state is bit-identical in Chrome and Node (verified, `tests/golden-state.json`).
- Video time maps to simulation time through a `TimeWarp` table anchored so the climax lands on an exact frame.
- Pixels are identical between renders on the same machine. They are *not* guaranteed identical between the browser preview and the MP4, because the rasterisers differ (≈2/255 mean difference).

### Adding a scene
Create `packages/scenes/<id>/index.ts` exporting `{ meta, schema, create, audio }` (see `packages/core/scene.ts`):
- `create(env, params)` returns `{ frames, frame, seekable, renderFrame(ctx, i), snapshot?, restore?, diagnostics?, stateVector? }`.
- A scene whose visuals accumulate (trails) is `seekable: false` and must implement `snapshot`/`restore` (use `copyLayer`/`restoreLayer` from render2d) so the studio can checkpoint it.
- Register it in `packages/scenes/index.ts` and add accuracy assertions to `tests/physics.test.ts`.
- For game feel, spread `juiceSchema()` into the schema, create a `Juice` in `create`, call `juice.update(1/fps)` per step, and wrap world drawing in `beginWorld`/`endWorld`. Put `juice.snapshot()` in the scene snapshot.
- For sound, call `sfx(mix, t, role, { pitch, pan, seed }, limiter)` from `audio()`.
- Bake static neon geometry into the background with `bakeStatic(bg, layer)`. Use `TrailHistory` for short fading trails: fading an 8-bit canvas leaves permanent ghost lines.
- Respect `env.quality` (preview only) for particle counts and glow.
- Take every colour, shape and font from the style: `const T = themeOf(P)`, pass `T` as the last argument of the render2d builders and to `new Juice(..., { theme: T })`, use `paletteFor(T, P.palette, role)`, `T.blend` instead of a hard-coded `'lighter'`, and `createMix(seconds, themeOf(P).audio)` in `audio()`. Build everything theme-dependent in `create()`, never in the frame loop.

## Requirements
Node ≥ 23.6 (runs TypeScript directly), and `ffmpeg` with libx264 on `PATH`.

### Interface layout (UX v2)

The studio adapts to the window: three columns on wide screens; below 1100 px the settings column becomes a drawer (button **Settings** in the top bar, Esc closes it); below 760 px it shows one pane at a time with a bottom bar (**Pick, Preview, Settings, Videos**). The Videos page shows status badges on every row, a "Needs you" line (rendered but not scheduled, uploads that failed or are running), opens the video that needs you first, and folds its long sections (they remember how you leave them). In the list use ↑/↓ to move and Enter to open; **Esc** goes back to the studio. While a render runs, the browser tab title shows its progress. If the server was started before some of its files changed, a quiet line at the top says so. Details and measurements: `docs/ux-v2.md`.
