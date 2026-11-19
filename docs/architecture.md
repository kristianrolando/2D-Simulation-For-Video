# Arsitektur dan cara memperluas: scene, varian, style, juice, suara

Pindahan dari README (isi asli, bahasa Inggris). Kapan dibaca: sebelum menambah scene, varian, atau style, atau mengubah kode simulasi/render.

## The two templates (variants, seed, hooks)

Both are **parametric templates**: one scene, many videos. The studio's Basic tab holds the rule, the container, the objects, the counts and the **Seed**; everything else is under Advanced.

- **Seed.** A number (slider, number box, or **🎲 Random**). The same seed gives the same video in the preview and in the render: the state of the simulation is identical bit for bit between the browser and Node (`node tools/state-sig.ts` prints the same checksum you can read in the browser). Colours, the order of the strikes, the "seeded" lap set and the "seeded" ratio all come from it.
- **Hook.** The on-screen question is empty by default and filled in automatically; it follows the rule and the seed (grey text in the field). **Edit suggestion** copies it into the field so you can change it (`/` starts a second line). The same text becomes the first title idea in Videos.
- **Hammer smash.** `rule`: `split` (a crushed ball becomes 2–4), `box` (the hammers meet and form a box; every bounce inside it adds a ball), `survive` (crushed balls are gone, a lucky wall bounce adds one; the hammer can win). `container`: octagon, circle, square, triangle (hammers come out of the corners), ring (a hub in the middle). `objects`: ball, square, triangle, gem, star, mixed (they are drawn as shapes but collide as discs). 1–4 hammers, gravity, speed, size, capacity (up to 2,500), strike rhythm and how much faster it gets.
- **Sync & close.** `mode`: `orbits` (laps per dot: consecutive, odd, primes or seeded; same or alternating direction; circle, square or triangle track, or a ring), `lid` (bounce rhythm per object, linear/gravity/piston motion; they all meet the lid at the same instant), `slider` (a new line every few seconds, each dot only slides; the hidden shape is a circle, a 4- or 3-petal flower, or a pulse), `close` (a two-arm pen; ratio π, √2, φ, e, 7/3, 5/2, 8/5 or a seeded fraction: fractions close after q turns, irrational ratios get "almost closed" at 7 and 113 turns and never close).
- **Endings.** Hammer smash: the container bursts, then the whole run rewinds to frame 0 (the last frame equals the first). Sync & close: every dot returns to where it started, so the video loops. Both are tested.
- **Presets** for the variants are in the gallery (`hammer-*`, `sync-*`).

## Adding a variant
1. A new *value* of an existing option (a rule, container, lap rule, ratio, hidden shape): add it to the option list at the top of `packages/scenes/hammer-smash/sim.ts` / `packages/sim/shapes.ts` / `packages/scenes/sync-lines/model.ts`, implement it in the same file (it must be a pure function of the parameters and the seed, using only dmath), and add a case to the tests in `tests/templates.test.ts` (the rule's logic, plus the loop ending).
2. A new *bundle of settings*: copy a file in `presets/`, change `params`, and it appears in the gallery. No code.
3. New hook sentences: add them to `HOOKS` in the scene's `index.ts` (`{k}`, `{n}`, `{d}`, `{r}` are filled in). The seed picks one.

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

`node tools/sfx.ts import <id> <file>` refuses a prompt hash that already exists and never overwrites an original in `src/`. Samples are decoded once per process (server) or per session (studio).

New sounds cost ElevenLabs credits, and every paid call goes through one guard (`packages/sfx-guard/guard.ts`):

```bash
node tools/sfx.ts generate --only <id>
```
Dry run: the list, the credit estimate and the account balance; nothing is paid. Add `--yes` to generate exactly that list. Caps, the ledger (`assets/sfx/ledger.json`) and the rules for agents: `docs/sfx-credits.md`. The studio and the renderer never call ElevenLabs.

## Architecture

```
packages/core       deterministic math (dmath), TimeWarp, parameter schema, scene contract, colours
packages/render2d   Canvas2D kit: neon walls, sprites, comets, trail layers (+snapshot), header text, 3D camera
packages/audio      procedural SFX (recurrence oscillators), sample bank + roles + voice limiter, mixer, WAV
packages/juice      shake, flash, particle pool, squash/stretch, counter pop/roll (all deterministic)
packages/theme      style tokens, validation + fallback to classic, registry, palette helper
packages/publish    video metadata (title/description/tags writer, quality checker, thumbnail logic, status changes, filters, coverage, CSV); topics.ts = what each scene is about; pure; describe.ts links it to the scenes
packages/compile    long videos from Shorts: selection, order, chapters (exact frame sums), texts and their checker; pure (docs/compile.md)
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

## Rules that keep renders reproducible
- Simulation code uses only `packages/core` math (`dsin`, `dcos`, `dexp`, `datan2`, …) and IEEE-exact operators. Never `Math.sin/cos/exp/pow/atan2`, `Math.random` or `Date`. Engines differ in the last bit of those functions; with dmath, simulation state is bit-identical in Chrome and Node (verified, `tests/golden-state.json`).
- Video time maps to simulation time through a `TimeWarp` table anchored so the climax lands on an exact frame.
- Pixels are identical between renders on the same machine. They are *not* guaranteed identical between the browser preview and the MP4, because the rasterisers differ (≈2/255 mean difference).

## Adding a scene
Create `packages/scenes/<id>/index.ts` exporting `{ meta, schema, create, audio }` (see `packages/core/scene.ts`):
- `create(env, params)` returns `{ frames, frame, seekable, renderFrame(ctx, i), snapshot?, restore?, diagnostics?, stateVector? }`.
- A scene whose visuals accumulate (trails) is `seekable: false` and must implement `snapshot`/`restore` (use `copyLayer`/`restoreLayer` from render2d) so the studio can checkpoint it.
- Register it in `packages/scenes/index.ts` and add accuracy assertions to `tests/physics.test.ts`.
- For game feel, spread `juiceSchema()` into the schema, create a `Juice` in `create`, call `juice.update(1/fps)` per step, and wrap world drawing in `beginWorld`/`endWorld`. Put `juice.snapshot()` in the scene snapshot.
- For sound, call `sfx(mix, t, role, { pitch, pan, seed }, limiter)` from `audio()`.
- Bake static neon geometry into the background with `bakeStatic(bg, layer)`. Use `TrailHistory` for short fading trails: fading an 8-bit canvas leaves permanent ghost lines.
- Respect `env.quality` (preview only) for particle counts and glow.
- Take every colour, shape and font from the style: `const T = themeOf(P)`, pass `T` as the last argument of the render2d builders and to `new Juice(..., { theme: T })`, use `paletteFor(T, P.palette, role)`, `T.blend` instead of a hard-coded `'lighter'`, and `createMix(seconds, themeOf(P).audio)` in `audio()`. Build everything theme-dependent in `create()`, never in the frame loop.
