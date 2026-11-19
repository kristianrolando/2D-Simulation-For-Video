# Operasi studio: restart aman, aplikasi Mac, perintah, tes

Pindahan dari README (isi asli, bahasa Inggris). Kapan dibaca: sebelum me-restart studio, saat memakai `Sim Studio.app`, atau saat merender dari terminal.

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
- **A long queue is never cut.** Every queued or running job stays in `data/jobs.json` however many there are; only finished ones are trimmed (newest 30 kept).
- **Batch runner** (`tools/batch-run.ts`): follows "Render again" (a video you restarted is that same video, not a failure and not sent twice), runs stopped videos again through the studio's own link, and only one runner works on a plan at a time (`data/batch/.runner.lock`).
- **Housekeeping:** at start and every hour the studio checks ffmpeg, free disk and the output/data folders (problems appear in the banner at the top of the page and in `/api/status`; a render is refused with a clear message when less than 2 GB are free), sweeps old temporary files nobody owns (`*.tmp`, orphan `<job>.wav`, stray request files), and rotates the log. Every log line has a time stamp and no secrets; when `~/Library/Logs/Sim Studio.log` passes 5 MB the old part is kept once as `Sim Studio.log.1`. While a render or an upload is active the Mac is kept from idle sleep (`caffeinate`, ends with the server).
- **Where does the work stand?** `node tools/state.ts` (read-only) prints git, the running studio (up since, old code or current, queue), the render and batch counts, the disk and the handoff header. Use it instead of trusting a note.
- **ElevenLabs credits** never run from the studio; see `docs/sfx-credits.md`.

| Command | Use it for |
|---|---|
| `npm run dev` | Normal work: rendering and uploading. Restarts only when you do it. |
| `npm run dev:watch` | Development sessions where the code changes often: the server restarts itself when a server file changes. `tests/dev-watch.test.ts` proves a running render comes back as Stopped with no orphan worker and no leftovers. |

**Which one?** Rendering a batch or uploading: `npm run dev` (or the app), and restart it yourself only when `node tools/state.ts` says nothing is running and the code is old. Changing server code: `npm run dev:watch` on a studio with no render or upload in progress.

With `dev:watch`, **do not leave a render or an upload running while files are being edited**: a restart stops the render (you press Render
again) and cuts an upload at its current step (you press Continue). `themes/`, `presets/`, `style-presets/` and `data/` are not watched, and changes to the
studio page itself (`apps/studio/`) reload in the browser without a server restart. A banner at the top says when the running server is older than its files.

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

## Rendering and tests from the command line

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
