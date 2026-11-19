# Publishing texts and thumbnails

How the studio writes the title, description, tags and thumbnail of each video, and checks them. Free and local: no
external service, no paid API, no network. Research behind it: `docs/publishing-research.md`.

## Where things live

| File | Job |
|---|---|
| `packages/publish/topics.ts` | What each scene is about: keyword, lead sentence, true "what happens" sentences, two title variants for each of five styles, tags, hashtags, vocabulary. One entry per scene (and per rule/mode for the hammer and sync templates). |
| `packages/publish/copywriter.ts` | Fills the topic with the video's own numbers and picks among variants with a seeded generator. Pure. |
| `packages/publish/describe.ts` | Bridge to the scenes: `factsFor` (what the parameters say), `topicFor`, `hookFor`, `suggestFor`, `descriptionFor`. |
| `packages/publish/quality.ts` | The quality checker. |
| `packages/publish/cover.ts` | Pure thumbnail logic: best-frame scoring, hook text, layout boxes and unsafe zones. |
| `apps/server/cover.ts` | ffmpeg frame analysis and the drawing of both pictures (`@napi-rs/canvas`). |
| `apps/studio/videos.ts` | The Videos page. |

The render engine, `references/` and the scenes are not touched: everything reads a scene's parameters and the finished MP4.

## Titles: five styles, ≤ 100 characters

For every video the writer proposes five titles, each in a different style, labelled in the page:

| Style | Idea | Example shape |
|---|---|---|
| Direct question | the video answers it | "Will … ever …?" |
| What is at stake | the outcome in question | "How long until … bursts?" |
| Starts with a number | a real number from the settings | "{balls} balls, {rows} rows: …?" |
| Curious statement | a true oddity, no promise | "Random bounces that add up to …" |
| How / why explainer | the keyword first | "Why does chance draw …?" |

Rules built in: hook first, the topic keyword in every title, no more than one emoji (and never on the explainer), at most
100 characters, no `<` or `>`, and **only numbers that are in the video's settings**. A style whose numbers a video cannot
supply (a placeholder with no value) is replaced by an unused variant of another style, so a text never shows a blank or an
invented number.

Which of the five becomes the default is a seeded choice from the scene, its own seed and the style, so videos of one scene
do not all start with the same style. **Click any idea to use it.**

## Description: one of four layouts

The first line is the hook (the title) plus one sentence that contains the main keyword. After it, in one of four layouts
(plain, setup-first, "what you are watching", short), come two true sentences about what happens, a line that the video is a
real deterministic simulation (three wordings), a question for the comments (four wordings) and **one** calm subscribe line
(four wordings). Maximum 5000 bytes; the description is far shorter in practice. **Another description** writes it again
with a different layout and wording (variant 1, 2, 3, …; the same facts, your title stays the hook).

## Tags and hashtags

Tags: the keyword first, then specific topic phrases, the scene name, a few generic ones, the style name last. No duplicates
(also not singular/plural twins such as "ball" and "balls"), total kept at least 30 characters under YouTube's 500.
Hashtags: exactly three, `#Shorts` first, then two topic hashtags.

## Deterministic

The same scene, parameters and style always give the same texts, on any computer: the choices come from a seeded generator
(FNV-1a hash into mulberry32), never from `Math.random` or the clock. Two different videos differ because their seed,
scene, style or parameters differ. `tests/copywriter.test.ts` checks this.

## Quality checker (Videos → Texts for YouTube)

Shown under the fields with a label: **Fix** (YouTube will refuse or cut it), **Check** (fix it before publishing) and
**Tip**. It never blocks saving. It re-runs as you type.

| Check | Severity | What it looks for |
|---|---|---|
| Limits | Fix | title > 100 characters, description > 5000 **bytes**, tags > 500 characters, `<` or `>` |
| Keyword missing | Check | main keyword not in the title, the first description line or the tags |
| Duplicate tags | Check | same tag twice in any case, or singular and plural of the same word |
| Misleading phrases | Check | "you won't believe", "insane", "impossible", "100%", giveaway/click lines, ALL CAPS words, repeated `!?`, more than two emoji |
| Claims the video does not show | Check | words such as black hole, 3D, fireworks, galaxy, ASMR, AI, record, money when the scene does not contain them |
| Numbers not in the video | Check | a number in the title or description that is not one of this video's settings |
| Repeated title | Check | another video in the list has the same title |
| Description | Check/Tip | empty, no hook in the first line, more than one subscribe line, many emoji |
| Hashtags | Check/Tip | `#Shorts` missing; more than three (only the first three show above the title) |
| Thumbnail | Tip | none yet |

The writer's own output passes this checker for every scene, rule and style (a test).

## Thumbnail and cover

1. **Best frame, automatically.** When a render finishes, the studio looks at the finished MP4: ffmpeg samples 36 small
   frames between 10 % and 98.5 % of the video; each gets a *detail* score (fine structure) and an *ink* score (how much of the
   picture is in use); the best score near the **climax** wins. The climax is the scene's own moment when it has one (the last
   ball lands, the pattern closes, the pendulums line up: `finalAt`, `closeAt`, `alignAt`), otherwise about 80 % into the video.
   This is a heuristic for "busy and tense", not a judgement of beauty: **Pick the best frame automatically** re-runs it,
   **Use this frame** takes the frame the player is paused on.
2. **Hook text.** The cover shows the title as a short hook (≤ 56 characters, a question stays whole, no emoji or hashtags).
   Edit it in the field **Text on the thumbnail**, or press **Without text** for the bare frame.
3. **Two pictures, in the video's own style:**
   - **Shorts thumbnail 1080×1920 (9:16): the one uploaded.** The frame with the text in the safe zone (below YouTube's top bar,
     above the side buttons); a solid band hides the video's own title strip so text is never drawn twice. Saved as
     `data/thumbnails/<id>-cover.jpg`. **YouTube crops a Short's custom thumbnail to 9:16 around the centre** (resource
     `thumbnails`, field `shortsAspectRatio`; Help "Add video thumbnails" recommends 9:16), and this picture already is 9:16,
     so nothing is cut.
   - **Wide 1280×720: not uploaded for Shorts.** Kept (`<id>.jpg`) for other uses only. Its centre 9:16 crop is 405 px wide
     and removes the text and half the panel: a first upload of this picture reached YouTube as a lone "?" (see
     `docs/publishing-examples/shorts-crop-before-after.png`).
   The uploader sends `coverFile` (fallback `thumbFile` for older records), refuses any picture that is not 9:16 or is over
   50 MB, and records the file name it sent (`youtube.thumbSent`).
4. **Manual override is always kept.** The automatic pick runs only when a video has no thumbnail yet; after you choose a
   frame or edit the text it never replaces it by itself.

## A video that already has the wrong thumbnail

Records uploaded before `thumbSent` existed, and any whose picture was drawn again after the upload, are flagged in Videos
("Wrong thumbnail on YouTube"). **Set the thumbnail again** puts the current 9:16 picture on the video. It asks first, uses 50 of
the 10,000 daily quota units, changes your channel, and touches nothing else (no title, schedule, privacy or status change). The
studio never does this by itself.

## Limits and honest notes

- The quality checker finds what can be found by rules. It cannot know whether a title *feels* misleading; it does not
  replace reading the video once.
- The best-frame choice is a heuristic and can pick a frame you dislike; the manual button is the answer.
- YouTube's rules for custom thumbnails (channel verification) and for how Shorts show covers can change; the layout keeps
  clear of the areas YouTube covers *today* (approximate, from `branding/`).
- Indonesian suggestions keep the older single-style writer; the five-style writer is English only, as requested.

## Upload schedule calendar

Videos → **Calendar** shows the YouTube upload schedule as a month grid (Monday first, times in WIB, UTC+7). It reads `data/schedule.json`
(made by `npm run schedule:plan -- --write`) through `GET /api/schedule` and merges it with the studio's own video records, so a slot shows
what really happened: **Planned** (dashed), **Scheduled on YouTube**, **Published**, **Uploading**, **Waiting for quota**, **Upload failed**.
Click a day for its list; click a video to open it in the Videos list. On a phone the cells show a count and the day list carries the titles.
The view is read only: it never uploads or changes anything. It needs a studio started after this change (`codeStale: true` = restart when idle).
Code: `packages/publish/calendar.ts` (pure), `apps/studio/calendar-ui.ts`; tests `tests/calendar.test.ts`.
