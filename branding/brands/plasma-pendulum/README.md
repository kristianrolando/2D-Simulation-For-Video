# Plasma Pendulum — brand kit (second channel)

Status 2026-11-19: **channel created by the owner** (youtube.com/@PlasmaPendulum, channel ID `UCeQFzt0OiCBlpnwWIi0rymw`). Set up in the owner's Chrome with Claude in Chrome the same day: profile picture, banner, watermark (entire video), description (US spelling), 12 channel keywords, upload defaults (Private, Science & technology, video and title/description language English (US), comments on, tags empty), three private empty playlists. Links, contact email and country left empty on purpose. **Still pending (owner):** Made for Kids answer, country of residence (optional), phone verification (youtube.com/verify), business email/links. The studio is NOT connected to this channel and nothing is uploaded; connecting a second channel to the uploader is a separate, postponed stage. Photon Lab (`branding/brand.json`, `branding/png/`) is untouched; its files are byte-identical after every build.

## Identity (derived from the style preset Main-2, `style-presets/main-2.json`)
| | |
|---|---|
| Name / handle | **Plasma Pendulum** · **@PlasmaPendulum** (was a 404 on youtube.com on 2026-11-19; may change before you create it; backup: **Violet Kinetics** @VioletKinetics) |
| Tagline | Physics, in neon. |
| Background | vertical gradient `#174074` → `#010312` → `#02223b` (Main-2 `bg`, angle 0) |
| Main color | purple `#cd18ff` (Main-2 wall), halo magenta `#ff00ea` (Main-2 wall glow) |
| Accent / text / muted | `#ffd23f` · `#eef2ff` · `#c8d2eb` (Main-2 `accent`, `text`, `muted`) |
| Font | DejaVu Sans Bold (same as the video text), normal case, from `assets/fonts/DejaVuSans-Bold.ttf` |
| Mark | a swinging pendulum bob with fading echoes on a glowing arc (new; not the Photon ring + P) |
| Adjustments from Main-2 | none to the palette. Only the mark sits on a dark disc, because purple `#cd18ff` is 2.6:1 on the light top of the gradient (`#174074`) but 5.1:1 on `#010312`. All text uses `text`/`accent`/`muted` (≥ 6.8:1 on every gradient color). Grid color for the faint banner grid is Main-2's blue `#4f8dff`. |

## Files (`node branding/build.mjs plasma-pendulum`; edit `branding/brands/plasma-pendulum.json`, never the SVGs)
| File (`png/`, SVG sources in `svg/`) | Use |
|---|---|
| `profile_800.png` | profile picture 800×800 (shown round; all content inside the circle) |
| `banner_2560x1440.png` / `.jpg` | banner; important content inside the 1546×423 center (text block 1461 px wide) |
| `watermark_150.png` | video watermark 150×150 (transparent) |
| `example_pendulum-wave_cover_1080x1920.jpg`, `example_hammer-smash_cover_1080x1920.jpg` | **real** Shorts covers (the picture uploaded for Shorts), made by the studio from real 12 s renders with Main-2 applied |
| `example_pendulum-wave_thumb_1280x720.jpg`, `example_hammer-smash_thumb_1280x720.jpg` | the matching wide thumbnails (not sent for Shorts; for the channel page and long videos) |
| `shorts_cover_1080x1920.png`, `thumb_1280x720.png` | drawn templates of the brand layout (no real video) |
| `*_guides.png` | the same templates with the safe zones marked (title, counter, simulation frame, YouTube UI areas) |
| `check_small_sizes.png` | round profile at 160/98/48/32 px, banner as TV / desktop / phone, cover and thumbnail at feed size (`node branding/check-contrast.mjs plasma-pendulum`) |

Checked: all text colors ≥ 4.5:1 on every gradient color and on the lightest banner background pixel (5.2–7.1:1); `core`/`glow` are graphics only (≥ 3:1 on the dark parts they sit on; `core` on the light top is 2.6:1, so nothing important sits there). The banner's small third line is hard to read on a phone (about 7 px high at 320 wide): the name and tagline carry the banner.

## Channel texts (English, global audience)
**Name:** Plasma Pendulum  **Handle:** @PlasmaPendulum  **Tagline:** Physics, in neon.

**Description** (the first two lines show before "more"; paste as is):
```
Satisfying physics and math simulations in glowing neon, one short question at a time.
New Shorts every week: bouncing balls, pendulum waves, chain reactions and more.

Every video is a real 2D simulation, computed with exact, deterministic math. No tricks, no CGI.
Pick your guess before the answer, then tell me in the comments what surprised you.

Subscribe so you do not miss the next one.
```
**Channel keywords** (YouTube Studio → Customization → Basic info → Keywords; about 400 characters of room):
`satisfying, physics simulation, math simulation, oddly satisfying, 2D simulation, bouncing balls, pendulum wave, chain reaction, neon, science shorts, ASMR, physics shorts`

**Contact / links:** add a business email only if you want one (use a separate address; do not use your personal one). Suggested link: none until you have a site; later one link titled "More simulations". Leave the country and the "Made for Kids" answer to yourself (Made for Kids: No).
**Default upload settings** (Studio → Settings → Upload defaults): category **Science & Technology**, language **English (US)**, title/description empty (the studio writes them), visibility Private, comments on, "Altered content" as the studio sets it.
**Playlists** (create after the first uploads): 1. "Satisfying Bounces" 2. "Pendulum & Wave Patterns" 3. "Math You Can Watch"

## Steps for you in YouTube Studio (✋ = only you can do it)
1. ✋ Sign in to the Google account that should own the channel (a new Brand Account is cleanest: youtube.com → profile picture → Switch account → Create a channel).
2. ✋ Create the channel with the name **Plasma Pendulum**, then set the handle **@PlasmaPendulum** (Customization → Basic info). If either is refused, use the backup name/handle above and tell me, so I can rebuild the kit (`name`, `handle` in the JSON, then `node branding/build.mjs plasma-pendulum`).
3. Customization → Branding: upload `profile_800.png` (Picture), `banner_2560x1440.png` or `.jpg` (Banner), `watermark_150.png` (Video watermark, display time "Entire video").
4. Customization → Basic info: paste the description and the keywords; add links/contact only if you want.
5. ✋ Settings → Upload defaults: category Science & Technology, language English (US).
6. ✋ Verify the channel with a phone number (youtube.com/verify) if you want custom thumbnails and videos over 15 minutes. ✋ Accept any terms YouTube shows.
7. Tell me when it exists. The studio is still connected to ONE channel (Photon Lab); a second connection and two-channel uploads are not built yet.

## Making videos in the new look (Main-2)
1. In the studio, pick the scene, then on the **Basic** tab under *Style presets* click **Main-2** (leave the Style as Classic).
2. Render as usual. The cover and thumbnail follow the preset automatically (DejaVu Sans Bold, Main-2 colors).
3. Videos already rendered or uploaded are **not** re-rendered; the preset is stored per video (`stylePreset` parameter), so old videos keep their look. New videos get the studio's connected channel as their `channel` tag, so for now set it by connecting the new channel (not built) or leave them as Photon Lab and tell me when you want a rename.
