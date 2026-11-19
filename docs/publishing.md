# Publishing texts and thumbnails

How the studio writes the title, description, tags and thumbnail of each video, and checks them. Free and local: no
external service, no paid API, no network. Research behind it: the last section of this file.

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
     `docs/evidence/publishing-examples/shorts-crop-before-after.jpg`).
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

## Channel on every video
Each record has a `channel` (display name). Lists from before this field read as **Photon Lab**; the first studio start that can write adds it to `data/videos.json` once (the old file is copied to `data/backups/` first; `schemaVersion` stays 1; nothing else changes). A new video gets the name of the connected YouTube channel, else Photon Lab. The Videos page shows a small channel badge on each row and in the detail, and a **All channels** menu only when videos of 2+ channels exist (the status chips count all channels). The field is not editable from the page; uploads and the schedule are untouched. Tests: `tests/channel.test.ts`.

## Research behind this (patterns only, nothing copied)

Looked at on 2026-11-18, **view only** (no login, no clicks other than opening pages): the Shorts tabs of two channels that make
simulation Shorts, plus the description of one video of each. Nothing was copied. This file keeps the **patterns** and the
**rules we took from them**. Titles, wording and layouts of those channels are not reproduced anywhere in the studio, and
`packages/publish/topics.ts` was written from our own scenes.

### What was visible

| | Channel A (maths and physics, about 70 Shorts) | Channel B (satisfying physics, about 80 Shorts) |
|---|---|---|
| **Title length** | very short, mostly 25 to 55 characters | short to medium, 25 to 90 characters; a few long, sentence-like ones |
| **Hook** | almost always a **question** that the video answers ("will it…", "what does… draw", "how…") | mostly a **question about the stake** ("how long until…", "which one wins…"), sometimes a one-line premise |
| **Numbers** | rare in the title; the counter is on screen instead | often a concrete number from the setup in the title or the first line of the description |
| **Emoji** | one, at the end of most titles | one, at the end of most titles |
| **Hashtags** | three, written inside the title (`#physics #maths #shorts`) | three, written at the top of the description (`#satisfying …`) |
| **Description** | one to three plain sentences of what physically happens; no link spam, no long call to action | the title repeated, then a concrete, step-by-step explanation of the rule (what is born, what bounces, what is random) |
| **Tags** (page keywords) | 15 to 20 specific, long-tail phrases about the topic (the optics or the maths involved) plus 2 or 3 generic ones | not visible |
| **Cover / first frame** | the question is **on screen at the top**, a yellow live counter below it, then the simulation | the question or setup is on screen at the top in capitals, a counter at the bottom, one dominant colour per video |
| **Repeats** | the same question is reused for different set-ups ("will they all come back…" appears several times) and does well | one question reused across dozens of videos; the same format is the channel's identity |

Views vary by more than 100 times inside each channel, with the same kind of title. So the title is **one** factor; the
idea of the video, its first seconds and the timing matter at least as much. We make no claim that any title style wins.

### Principles we took (and how the studio applies them)

1. **A question, not a statement.** The viewer should want to see the answer. → one of the five titles is always a direct
   question, and the default pick often is. The hook must be answered by the video (never a question the video ignores).
2. **Say what is at stake.** "Until it bursts", "who wins", "does it close". → the *stakes* style.
3. **Use the real number.** A number from the setup (balls, rows, a ratio) makes a title concrete. → the *number* style, and
   the checker flags any number that is not in the video's own settings.
4. **Short, hook first.** The first 40 characters carry the hook and the keyword; one emoji at most. → titles are written
   short; the checker tips anything over 70 characters and warns about ALL CAPS, repeated `!`/`?` and more than two emoji.
5. **One main keyword in the title, the first description line and the tags.** The topic's search phrase ("bell curve",
   "orbital resonance", "chain reaction") is the same everywhere. → enforced when writing, checked when editing.
6. **Description = hook + what physically happens.** The most useful description part in both channels is a plain
   explanation of the rule. → hook and keyword in the first sentence, then the mechanic in two sentences, then at most one
   calm subscribe line. Four layouts so descriptions do not all read the same.
7. **Three hashtags, `#Shorts` among them.** YouTube shows the first three above the title. → exactly three: `#Shorts` and
   two topic hashtags.
8. **Specific tags beat generic ones.** Long-tail topic phrases first, generic ones last, no duplicates, under the limit.
9. **The cover repeats the hook** in big, high-contrast text in the safe zone, over the video's own colours, so the feed
   and the channel grid read at a glance.
10. **Consistency is the brand.** The same question shape across set-ups is a strength, not a problem; what must change
    between videos is the set-up and the number. → the writer varies layouts and wording by seed; the facts stay true.

### What we decided **not** to do

- No claim the video does not show (the checker lists claim words such as *black hole*, *3D*, *fireworks*, *ASMR* and flags
  them when the scene does not contain them).
- No "you won't believe", "insane", "impossible", "100%", giveaway or money phrases (flagged as misleading).
- No copying of any title, sentence, hashtag combination or layout from these channels; no scraping; nothing is stored from
  them except this summary.
- No numbers or outcomes invented for effect. Texts come only from the scene's parameters and from sentences in
  `topics.ts` that describe what the simulation does.

### Limits of this research

- Two channels and one video description each; tags were readable for only one of them. It shows patterns, not what *causes*
  views.
- No analytics were available, so nothing here is a measured result for our channel. After a few weeks of uploads, compare
  the title style (the studio shows the style name next to each idea) against views and watch time in YouTube Studio.
