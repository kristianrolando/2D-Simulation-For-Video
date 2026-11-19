# Unggah ke YouTube dan dua channel

Pindahan dari README (isi asli, bahasa Inggris). Kapan dibaca: sebelum menghubungkan channel, mengunggah, atau mengatur unggah manual. Rencana dan fakta API: `docs/youtube-upload-plan.md`.

## Upload to YouTube (free, official API, private first)

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
  - **Failures:** a dropped connection resumes the same upload session, and after a studio restart **Continue upload** picks it up. When YouTube's **daily quota** is used up the upload is not lost: it shows "Waiting for quota" and the studio continues **by itself** about two minutes after the next midnight Pacific Time (compared with the wall clock every 30 seconds and at start, so a sleeping Mac or a restart does not matter; keep the studio running). After the video exists the same video simply continues. If the quota was already gone at the very first request, nothing exists yet; the approved upload (with exactly the choices you approved) makes its one and only `videos.insert` after the reset, and only if the MP4 is unchanged and a schedule is still at least 30 minutes ahead. Otherwise the attempt is dropped with a notice and you approve a new one. A channel's own upload limit is different and always waits for you. **Try now** retries at once.
  - **Disconnect** revokes the permission at Google.
- **Quota** (checked 2026-11-18): 100 uploads per day in their own bucket, plus 10,000 units for everything else (thumbnail 50, publish now 50, status checks 1). One upload uses about 60–150 units.
- **Tests:** `tests/youtube.test.ts` runs a real studio against a local stand-in of Google (`tests/fake-google.ts`): OAuth with PKCE, expired and revoked tokens, quota, dropped connections, a killed studio, expired sessions, refused thumbnails, and leaks. No test talks to Google.

### Two channels (Photon Lab and Plasma Pendulum)

The studio can keep **several channels connected** through the same OAuth client. YouTube settings shows one row per channel:

- **Active channel** (the radio button): new videos are made for it. A style preset never changes the channel; you pick it per video.
- **Upload from Sim Studio** (per channel): *On* = the studio may upload to it (each upload still asks for your tick); *Off* = every sending path refuses with "Uploads from Sim Studio are turned off for this channel": Upload, Continue, the waiting quota upload, *Set the thumbnail again* and `tools/schedule-run.ts`. Videos for that channel can still be rendered, written and given covers. Turning it **on** asks for a confirmation that names the channel. Photon Lab is *On*; Plasma Pendulum starts *Off* (you upload it by hand).
- **Connect another channel…**: sign in and pick the channel on Google's page. A new channel is only kept after you press **Connect &lt;name&gt;** on the page that follows; a channel that is already connected is refused. **Disconnect** on a row revokes only that channel; the others stay connected. Nothing is ever deleted on YouTube.
- **Quota:** one daily quota for all channels (it belongs to the Google Cloud project, not to a channel; a second project to get more quota is against YouTube's API terms). YouTube settings shows the shared units used today and the uploads today per channel. Uploads you make by hand in YouTube Studio use no API quota. A channel's own *upload limit* ("uploadLimitExceeded") is noted on that channel only; the schedule runner holds that channel for 24 hours, other channels keep going.
- **Per video:** the YouTube section shows *For channel* (a menu while it can still change; a scheduled, published or uploaded video keeps its channel). **More → Channel for the videos shown…** sets it for every video the list shows. The upload dialog names the target channel in bold, and the approval is tied to it.

### Uploading by hand (Plasma Pendulum for now)

For a video whose channel has *Upload from Sim Studio: Off* (or under **Upload by hand instead**), the YouTube section lists what you need in YouTube Studio: **Copy title / description / tags** and **Open YouTube Studio**; the files are the buttons next to the video itself (**Show MP4 in folder**, **Show cover in folder**, **Show thumbnail in folder**) (opens studio.youtube.com in your browser; nothing is uploaded). After you published it there, **Mark as uploaded manually** (optional YouTube link or id, and the date) sets the video to *Published*. That calls nothing at YouTube, takes it out of every upload path and plan, and can be undone (**Undo the mark** → *Rendered*).

### Uploading to the second channel later

When you want the studio to upload Plasma Pendulum too: YouTube settings → Plasma Pendulum row → tick **Upload from Sim Studio** and confirm. No code change. Then per video as usual, or a plan of its own:

```bash
node tools/schedule-plan.ts --channel "Plasma Pendulum" --write
```

```bash
node tools/schedule-run.ts --channel "Plasma Pendulum" --count 3
```

The second command is a dry run; add `--yes` to send. Photon Lab keeps `data/schedule.json` and `node tools/schedule-run.ts --count N` works for it exactly as before (the plan file says which channel it is for; for any other channel the tool needs `--channel` and never guesses). Every upload counts against the one shared quota (see **Quota** above).
