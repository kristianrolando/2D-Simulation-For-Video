# tools/

Skrip bantu, satu berkas per tugas, folder sengaja datar (aturan: `docs/conventions.md`). Setiap skrip menjelaskan opsinya di baris komentar paling atas.
Skrip yang memakai ElevenLabs hanya `sfx.ts` (dry run dulu; aturan di `docs/sfx-credits.md`). Tidak satu pun skrip membuka YouTube kecuali `schedule-run.ts` lewat studio yang berjalan.

## Batch (render massal per channel; `docs/batches.md`)
- `batch-plan.ts` — rencana batch Photon Lab (`data/batch/plan.json`); tidak merender.
- `batch-plan-plasma.ts` — rencana pasangan Plasma Pendulum (`data/batch-plasma/plan.json`).
- `batch-plan-fourier.ts` — rencana pasangan Fourier Loom (`data/batch-fourier/plan.json`).
- `batch-run.ts` — runner: mengirim video rencana ke studio yang berjalan, pelan-pelan (`--dir`, `--limit`, `--dry-run`).
- `batch-chain.ts` — fungsi murni runner (diuji tanpa studio); bukan perintah.
- `batch-titles.ts` — judul/deskripsi publikasi unik per video batch (`--apply`, `--undo`, `--strict`, `--own-title`).
- `batch-sheet.ts` — lembar kontak satu frame per video rencana, tanpa studio.
- `handover-fourier.ts` — folder serah-terima video Fourier Loom untuk teman pemilik (`--check`).

## Jadwal dan video panjang
- `schedule-plan.ts` — rencana slot unggah 5 per hari (`data/schedule.json`; `--write` menyimpan; `--channel`).
- `schedule-run.ts` — mengunggah slot berikutnya lewat jalur unggah studio, satu per satu (`--count`, `--yes`, `--channel`).
- `compile.ts` — video panjang 16:9 dari terminal (`plan`, `build all`, `verify <slug>`).

## Analisis (bukti, perbandingan, kinerja)
- `bench.ts` · `bench-compare.ts` — benchmark render Node dan perbandingan dua hasilnya (`docs/evidence/bench/`).
- `style-sheet.ts` · `style-evidence.ts` — satu frame dalam semua style berdampingan; ukuran perbedaan style terhadap referensi (`docs/evidence/styles/`).
- `sheet.ts` — lembar kontak frame sebuah scene.
- `hash-frames.ts` · `state-sig.ts` · `state-hash.mjs` — hash frame/audio dan checksum state untuk membuktikan determinisme (browser = Node).
- `compare.sh` · `ssim.sh` · `ssim-lo.sh` · `audio-compare.sh` · `colorstats.mjs` — perbandingan dengan video referensi (SSIM, audio, warna).
- `sample.mjs` · `track.mjs` · `fit-camera.mjs` — pengukuran piksel/posisi dan penyesuaian kamera prototipe P3.
- `contrast-audit.js` — audit kontras antarmuka (ditempel di konsol browser; lihat `docs/ui-modes.md`).

## Utilitas
- `state.ts` — keadaan nyata proyek, hanya baca (git, studio, antrean, batch, disk, header handoff).
- `sfx.ts` — manajer pustaka suara: `plan`, `reprocess`, `import`, `generate` (berbayar, guard satu pintu).
- `serve.mjs` — server statis kecil untuk pratinjau prototipe (`.claude/launch.json`: `sim-preview`).
