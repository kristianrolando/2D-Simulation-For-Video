# Long videos (Videos → Compile)

Joins finished Shorts (1080×1920) into **long 16:9 videos** (1920×1080, 60 fps, H.264 + AAC), with chapters, texts and a 1280×720
thumbnail, ready to upload by hand. **Nothing is uploaded**: the studio's uploader only takes Shorts (1080×1920, up to 3 minutes), so a
long video is finished at "ready to upload" and its status is tracked by you in Videos. Long video upload is separate, later work.
Uploading a video over 15 minutes also needs a channel verified with a phone number (only you can do that).

## How to use it

1. Open **Videos → Compile**. **Suggest long videos** shows the lineup: one theme per scene and mode (hammer smash: split / box / survive,
   sync lines: lid / close / orbits / slider, and one mix of the scenes that have only a few clips), 9–18 minutes each.
2. **Create** a draft (or **Create all as drafts**). Open one to look at the clips, their order, the five title ideas, the description with
   chapters, the tags and the checks.
3. **Build**. It runs in the same queue as renders (one job at a time, in its own process). You can **Stop** at any time and press
   **Continue the build**: finished clips are reused. After a restart a build shows as *Stopped* in the same way.
4. The finished MP4 is in `output/long-<slug>.mp4`, the thumbnail in `data/thumbnails/`, and the video appears in **Videos** with a *Long* badge
   (copy buttons for title, description with hashtags and tags). Mark it Scheduled or Published yourself after you upload it.

Terminal (same operations, for many at once, or while the studio does not have this code): `node tools/compile.ts plan` (dry run),
`plan --write`, `list`, `check <slug>`, `texts <slug> [--title N]`, `build <slug|all>`, `thumb <slug>`, `verify <slug>`.
The tool never edits `data/videos.json`; the studio adds the Videos entry the next time it starts with this code. While a studio that
knows long videos is running, the tool refuses to write (the studio owns the records).

## Which Shorts, and how they are grouped (`packages/compile/select.ts`)

* Usable: tracked in the video list as rendered, scheduled or published; not a test; the MP4 exists; the Short's own texts pass the publishing
  quality check. Scheduled and published Shorts are fine: a long video only **reads** their file and never changes a Short or its schedule.
* Twins (same look, only the seed or length differs: the *visual key*) count once, the oldest is kept.
* A group longer than 18 minutes is split into parts of about 13 minutes (never under 9 when that can be avoided). Each part gets a spread of looks
  (the clips of every container are dealt round robin), and the order is seeded so **no two neighbours share their container** or second look.
* Every clip is used at most once. The same seed always gives the same plan.

## The pipeline (`apps/server/compile-build.ts`)

1. **Clip cache** (`data/compilations/cache/clip-<videoId>-<hash>.mp4`). The Short is centred at full height (608×1080), the sides are a dark
   blur of the clip itself (a 240×135 copy, blurred, brightened a little so its colours show), and its number (#01…) and name are drawn on the first
   two seconds. Exact frame count (from ffprobe), 60 fps, libx264 crf 21. The hash covers the source file (size, mtime), the position, the label and
   the recipe version. A cache file is trusted only if ffprobe still finds the expected size and frame count.
2. **Sound** (`aud-<videoId>-<hash>.wav`): the clip's own audio, gain to about −16 LUFS (−6…+9 dB, with a limiter), 60 ms fades at both ends, exactly
   frames × 735 samples (44 100 ÷ 60). No ElevenLabs, no music.
3. **Join**: video cache files with `-c copy`; the WAVs are joined and encoded to AAC **once** (no seams); written to `<out>.part`.
4. **Check**, then rename to the final name: 1920×1080, 60/1 fps, h264 yuv420p, AAC 44.1 kHz stereo, frame count = sum of the clips, duration
   and sound length equal, a **full decode** without a single decoder complaint, no black frames. A failed check leaves no final file.

Chapter times are exact sums of frames ÷ 60 (never guessed seconds), rounded down to whole seconds. YouTube's rules are checked: the first chapter
at 0:00, at least three, each at least 10 seconds, in order.

## Texts (`packages/compile/texts.ts`)

Five title ideas (question, stakes, number, curious, explain) per theme, ≤ 100 characters, the keyword in each. The description: hook and keyword first,
"N simulations, about M minutes", what the viewer sees, a flash warning, **Chapters:**, one question, one calm subscribe line. Hashtags never include
#Shorts. The checker flags: wrong clip count or minutes, numbers that are not facts of this video, bait phrases, claims the clips do not show,
bad chapters, #Shorts, limits. Changing the clips writes the title and description again; "Write the texts again" refreshes the chapters.

## Files and safety

* `data/compilations/<id>.json`: one small file per long video (clips, order, chapters' labels, texts, status), written atomically with the previous
  version kept as `.bak`; a damaged file is set aside (kept) and the `.bak` is restored; a newer schema is never overwritten. Removing a draft moves
  its file to `data/compilations/removed/`.
* `data/videos.json` gets one entry per finished long video (`kind: 'long'`, `compilationId`); Shorts are unchanged and old lists stay valid. The
  scene × style map ignores long videos, and `uploadProblems` always refuses them.
* One builder at a time (`data/compilations/cache/.builder.lock`, stale after a kill). A build needs about 1.8 MB of disk per second of video
  (cache + final); the studio refuses to start with too little room. **Free disk** on a long video deletes only its own prepared clips.
* Nothing here talks to YouTube or ElevenLabs, and no Short, schedule or render setting is changed.

## Measured (on this Mac, 10 cores)

A 55-second Short takes about 18 s to prepare (≈ 3× real time); joining and the full check about 1 min for 14 minutes. A second build with a
warm cache takes seconds. A 14-minute video is about 600 MB.
