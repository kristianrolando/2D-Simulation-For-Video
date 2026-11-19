# Batch render: Photon Lab, Plasma Pendulum, Fourier Loom

Pindahan dari README dan HANDOFF (isi asli sebagian Inggris). Kapan dibaca: sebelum merender atau mengulang batch 245 video untuk sebuah channel.

## Photon Lab (245 video, selesai 2026-11-18)

- Rencana `data/batch/plan.json`, keadaan `data/batch/state.json` (tidak di git). Runner: `npm run batch:run` (`tools/batch-run.ts`, `--dry-run` hanya melihat). Runner menunggu bila beban CPU tinggi atau disk bebas < 40 GB; `data/batch/PAUSE` menjeda; 5 kegagalan berturut-turut menghentikannya; satu runner per rencana (`.runner.lock`); runner mengikuti "Render again" dan menolak jalan bila studio memakai kode lama (`codeStale`).
- Ukuran waktu: median 15 dtk per video pada 60 fps (setup + audio sekitar 0,3 dtk; gambar 2,8 ms + tunggu encode 2,4 ms per frame). Render tidak dipecah per segmen: render ulang penuh dari parameter tersimpan lebih murah dan lebih aman.
- Judul unik: `node tools/batch-titles.ts --apply` (batalkan `--undo`; judul lama di `data/batch/old-titles.json`). Dua preset (`harmonograph-5-4`, `orbits-5-3`) membawa palet sendiri. Untuk 2 render paralel nyalakan studio dengan `JOBS=2` (bawaan 1).

## Plasma Pendulum batch (245 videos, Main-2 look)

The second channel has its own batch, a partner for every Photon Lab batch video. Nothing in `data/batch/` (Photon Lab's plan, state and titles) is touched.

- **Plan:** `node tools/batch-plan-plasma.ts` writes `data/batch-plasma/plan.json` (`--check` only prints; `--verify` also simulates the hammer-smash videos). Deterministic: same files, same plan, same order. Keys start with `plasma:`.
- **What makes a partner different** (the concept and the scene stay): the *Main-2* style preset on Classic with `palette: theme`; parameters changed per scene (object counts, seed, speed, size, ratio, a slightly different length with its end moments moved along); its own on-screen title (two lines, at most 32 characters each, so it is not shrunk); `handle` = `@PlasmaPendulum`; another order (one of each scene first, then a seeded shuffle, hammer-smash never side by side). No Plasma video has the same scene and parameters as any Photon video or another Plasma video (texts and look not counted). In `sync-lines` modes `close` and `slider` few parameters change what is shown, so those partners differ mostly in timing and line count.
- **Render:** make sure the studio's **active channel is Plasma Pendulum** (YouTube settings), then `node tools/batch-run.ts --dir data/batch-plasma --limit 50` and again for the next 50 (`--limit 10` first as a trial). Same gentle rules as Photon's batch (load, disk ≥ 40 GB, 5 failures in a row stop it, `data/batch-plasma/PAUSE` pauses). New videos are marked with the active channel (name and id). Put the active channel back to Photon Lab afterwards if you go on uploading Photon Lab from the studio.
- **Texts:** `node tools/batch-titles.ts --dir data/batch-plasma --strict --apply` gives every video its own publishing title and description with the studio's writer (nothing equal or nearly equal, word overlap under 0.75, to any title outside the batch; the keyword of the topic stays in the title; the old texts are saved in `data/batch-plasma/old-titles.json`, undo with `--undo`).
- **Look at the plan first:** `node tools/batch-sheet.ts --dir data/batch-plasma --out <folder>` draws a frame near the end of every video into contact sheets (no studio needed).
- **Uploading:** by hand in YouTube Studio (video page → *Manual upload* → *Mark as uploaded manually*); uploads from the studio stay off for Plasma Pendulum until you turn them on. Videos already rendered are never re-rendered.
- **Tests:** `tests/batch-plasma.test.ts`.

## Fourier Loom batch (245 videos, Main-3 look, channel run by a friend)

The third channel is run by the owner's friend and is **not connected** to the studio: the videos are only rendered and handed over as files. Nothing in `data/batch/` or `data/batch-plasma/` is touched.

- **Plan:** `node tools/batch-plan-fourier.ts` writes `data/batch-fourier/plan.json` (`--check` only prints). A third partner for every Photon video: Main-3 on Classic with `palette: theme`, handle `@FourierLoom`, parameters unlike all 490 Photon and Plasma videos and each other, own on-screen titles. Tests: `tests/batch-fourier.test.ts`.
- **Channel mark:** add the channel by hand once (`POST /api/channels/manual {"name":"Fourier Loom"}`, or *Add a channel by hand* on the Videos page). The studio tags new renders with its active channel, so after each stage run `node data/batch-fourier/retag.mjs` (tags the finished batch videos "Fourier Loom", no channel id, and checks them). `data/batch-fourier/run-stages.sh` does render + retag in five stages (`touch data/batch-fourier/PAUSE` pauses).
- **Texts:** `node tools/batch-titles.ts --dir data/batch-fourier --strict --own-title --apply` (`--own-title` also offers the video's own on-screen title and shorter variant tags, so no title is nearly the same as one outside the batch).
- **Hand-over folder:** `node tools/handover-fourier.ts` copies the videos and covers to `output/serah-terima-video-fourier-loom/` with `daftar.csv` and a README for the friend, then checks that no other channel's name, internal term or personal path is in it (`--check` only checks; about 18 minutes for the byte scan).
