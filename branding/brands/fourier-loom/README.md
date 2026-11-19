# Fourier Loom — brand kit (third channel)

Status 2026-11-19: **kit ready, channel NOT created yet** (the owner creates it in YouTube). Nothing is installed in YouTube/Chrome, nothing uploaded, studio not connected to this channel (connecting it to the uploader is separate, later work). Photon Lab (`branding/brand.json`, `branding/png/`) and Plasma Pendulum (`branding/brands/plasma-pendulum*`) are byte-identical after every build.

## Identity (derived from the style preset Main-3, `style-presets/main-3.json`, unchanged)
| | |
|---|---|
| Name / handle | **Fourier Loom** · **@FourierLoom** (youtube.com/@FourierLoom was HTTP 404 on 2026-11-19; may change before you create it). Backup: **Tangent Loom** @TangentLoom (also 404 that day); other free handles: @FourierLoomLab, @TangentLoomHQ |
| Tagline | Curves, drawn by physics. |
| Background | vertical gradient `#000000` → `#101217` → `#004d13` (Main-3 `bg`, black to dark green) |
| Main color | silver `#e8eefc` (Main-3 wall), halo steel `#7f93c8` (Main-3 wall glow) |
| Highlights | green `#9be36b` (Main-3 palette) only as the thin "echo" curve and decor; accent yellow `#ffd23f` small (dot, tagline) |
| Text / muted / grid | `#eef2ff` · `#c8d2eb` · `#939db4` (Main-3 `text`, `muted`, texture color); grid spacing 59, opacity 0.17 like Main-3 |
| Font | DejaVu Sans Bold (same as the video text), normal case, `assets/fonts/DejaVuSans-Bold.ttf` |
| Mark | a thick 3:2 Lissajous curve (silver) with a thin green echo curve and a yellow moving dot, over a faint grid, in a dark disc with a steel ring. New; not the Photon ring+P and not the Plasma pendulum |
| Adjustments from Main-3 | none to the palette. Only additions: the mark sits on a dark disc (the green end of the gradient is lighter), and the banner/cover decor uses curves instead of bouncing-ball trails. The `hi` color is Main-3's palette green. Mark and curves are silver on dark, ≥ 8.7:1 even on the lightest gradient color. |

## Files (`node branding/build.mjs fourier-loom`; edit `branding/brands/fourier-loom.json`, never the SVGs)
| File (`png/`, SVG sources in `svg/`) | Use |
|---|---|
| `profile_800.png` | profile picture 800×800 (shown round; everything inside the circle) |
| `banner_2560x1440.png` / `.jpg` | banner; important content inside the 1546×423 center (text block 1466 px) |
| `watermark_150.png` | video watermark 150×150 (transparent) |
| `example_galton-board_cover_1080x1920.jpg`, `example_sync-lines_cover_1080x1920.jpg` | **real** Shorts covers (the picture uploaded for Shorts), made by the studio's cover maker from real 12 s renders with Main-3 |
| `example_galton-board_thumb_1280x720.jpg`, `example_sync-lines_thumb_1280x720.jpg` | matching wide thumbnails (not sent for Shorts) |
| `shorts_cover_1080x1920.png`, `thumb_1280x720.png` | drawn layout templates (no real video) |
| `*_guides.png` | the templates with safe zones marked |
| `check_small_sizes.png` | round profile at 160/98/48/32 px, banner as TV / desktop / phone, cover and thumbnail at feed size (`node branding/check-contrast.mjs fourier-loom`) |

## Checks (`node branding/check-contrast.mjs fourier-loom`, all PASS)
Text colors on the three gradient colors: `text` 18.8 / 16.8 / 9.1 : 1, `accent` 14.5 / 13.0 / 7.0, `muted` 13.9 / 12.4 / 6.7 (need 4.5). Banner, measured against the lightest background pixel in the safe area: name 7.1, tagline 5.5, banner line 5.2 (need 4.5). Graphics (need 3): `core` silver ≥ 8.7, `glow` steel 6.9 / 6.2 / 3.3 (3.3 only on the green end, where nothing important sits; the ring is decorative). The 32 px profile still shows a silver curve knot with a yellow dot. The banner's small third line is tiny on a phone (like Plasma's); name and tagline carry the banner.

## Channel texts (US English)
**Name:** Fourier Loom  **Handle:** @FourierLoom  **Tagline:** Curves, drawn by physics.

**Description** (the first two lines show before "more"; paste as is):
```
Waves, curves and loops that draw themselves: satisfying physics and math simulations in 2D.
New Shorts every week. Watch a pattern form, then see why it had to.

Every video is a real simulation computed with exact, repeatable math: bouncing balls, swinging arms, rolling waves, chance turning into a curve. No CGI, no tricks.
Make a guess before the answer shows up, then tell me in the comments what you expected.

Subscribe and watch the next curve take shape.
```
**Channel keywords:** `satisfying, physics simulation, math simulation, lissajous curve, harmonograph, bell curve, galton board, oddly satisfying, 2D simulation, science shorts, math shorts, geometry`
**Contact / links:** leave empty until you decide (use a separate business email, not your personal one). Later, one link titled "More simulations".
**Default upload settings** (Studio → Settings → Upload defaults): category **Science & Technology**, language **English (US)**, title/description empty (the studio writes them), visibility **Private**, comments on.
**Playlists** (create after the first uploads): 1. "Curves That Close" 2. "Chance Draws a Shape" 3. "Waves & Loops"

## Steps for you in YouTube Studio (✋ = only you can do it)
1. ✋ Sign in to the Google account that should own the channel (a Brand Account is cleanest: youtube.com → profile picture → Switch account → Create a channel).
2. ✋ Create the channel named **Fourier Loom**, then set the handle **@FourierLoom** (Customization → Basic info). If either is refused, use the backup **Tangent Loom / @TangentLoom** and tell me, so I can rebuild the kit.
3. Customization → Branding: upload `profile_800.png`, `banner_2560x1440.png` (or `.jpg`), `watermark_150.png` (display time "Entire video").
4. Customization → Basic info: paste description and keywords; links/contact optional.
5. ✋ Settings → Upload defaults: Science & Technology, English (US), Private.
6. ✋ Verify with a phone number (youtube.com/verify) for custom thumbnails and videos over 15 minutes. ✋ Accept the terms YouTube shows. ✋ "Made for Kids" (your answer; Photon Lab and Plasma are "No") and country of residence.
7. Tell me when it exists. Connecting it to the studio uploader is a separate job.

## Rebuild if the name or handle is refused
Edit `name`, `handle` (and `tagline`) in `branding/brands/fourier-loom.json` (or copy it to `branding/brands/<new-id>.json`), then `node branding/build.mjs <id>` and `node branding/check-contrast.mjs <id>`. Real examples keep working (cover text does not contain the channel name). Handle appears on the drawn templates only.

## Making videos in the Main-3 look
1. In the studio, pick the scene, then **Basic** tab → *Style presets* → **Main-3** (keep Style = Classic). Render as usual; cover and thumbnail follow the preset.
2. Videos already rendered are **not** re-rendered (the preset is stored per video).
3. The `channel` tag of a new video follows the studio's active channel. The studio supports two channels; the third is NOT connected, so new videos would carry another channel's tag until the third channel is connected (separate later work).

## How the examples were made
A test studio on port 5391 with temporary data (`SIM_DATA_DIR`, `SIM_OUT_DIR`, `SIM_STYLE_PRESET_DIR`), two 12 s renders (galton-board, sync-lines) with the Main-3 preset, covers from the studio's own cover maker, then the test studio was stopped. The running studio was not touched.
