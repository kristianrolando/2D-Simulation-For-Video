# HANDOFF — Sim Studio

- format: cross-agent-handoff/1
- task_status: partial
- handoff: ready
- writer: none
- updated_at: 2026-11-18T21:30:00+0700
- language: id

Satu-satunya checkpoint proyek ini. Perbarui di akhir tiap langkah kerja yang substansial, bukan hanya di akhir sesi.

## Project
Identity: Sim Studio (`sim2d-studio`): studio lokal untuk membuat video simulasi 2D (scene, style, render, audio, publikasi ke YouTube) untuk channel Photon Lab.
Map: pengantar dan cara pakai `README.md`; stack Node >= 23.6 (TypeScript dijalankan langsung), `package.json`; kode server `apps/server/`, inti `packages/`;
dokumen `docs/` (`publishing.md`, `styles.md`, `ui-modes.md`, `youtube-upload-plan.md`); scene template `presets/`, style `themes/`, preset style `style-presets/`;
tes `tests/`. Tidak ada backlog terpisah; daftar "Belum" di bawah adalah satu-satunya.

## Task
Goal and authorized scope: tidak ada tugas aktif. Kelanjutan: kerjakan "Next" di bawah atau permintaan pemilik berikutnya. Unggah ke YouTube, pasang ulang thumbnail, dan ubah channel hanya dengan persetujuan pemilik.
Acceptance criteria: tiap fitur punya tesnya di `tests/` dan dokumennya di `docs/`; `npm run typecheck` dan `npm test` lulus.

## State
Verified (diperiksa 2026-11-18 19:07):
- Fondasi: studio, scene, style, render, audio, juice, Videos, unggah YouTube. Teks publikasi + thumbnail (5 gaya judul, deskripsi, tag, pemeriksa kualitas, cover 9:16): `docs/publishing.md`.
- Thumbnail Shorts: yang diunggah gambar tegak 1080×1920; tombol "Set the thumbnail again" untuk video lama.
- Mode terang/gelap (hanya antarmuka): `docs/ui-modes.md`. Editor style (`themes/<id>.json`): `docs/styles.md` §4.
- Antrean render tahan restart (`data/jobs.json`, status Stopped, Render again, `dev:watch`): `apps/server/job-store.ts`, `server.ts`, `worker.ts`; tes `tests/job-queue.test.ts`.
- Preset style (lapisan tampilan di atas Style, `style-presets/<id>.json`, parameter scene `stylePreset`, tab Basic): `docs/styles.md` §5; kode `packages/theme/index.ts`, `packages/theme/style-preset.ts`, `/api/style-presets`; tes `tests/style-preset.test.ts`.
  `presets/main-1.json` dihapus; tampilannya jadi preset style `Main-1`.
- Pohon kerja git bersih di cabang `main`, commit terakhir `af0d5f7`.
Unfinished / unknown:
- Cek thumbnail `KYUpU2KtKUw` di YouTube Studio (sudah dipasang ulang dengan gambar 9:16; tampilan belum dilihat pemilik).
- Video `60J5S2RCJ1Y` (Published) masih bergambar thumbnail lama; "Set the thumbnail again" tersedia tapi perlu persetujuan pemilik (50 unit kuota).
- Render scene lain untuk mengisi peta scene × style.
Decisions: lihat `docs/styles.md`, `docs/publishing.md` dan memori proyek. Aturan tetap:
- Kredensial hanya di `~/Library/Application Support/Sim Studio/` (mode 600); tidak pernah di folder proyek, log, atau chat.
- Tidak pernah menghapus video di YouTube.
- `references/` (video kompetitor) tidak di git dan tidak diubah. `data/` dan `output/` tidak di git.
- Mesin render, scene, dan style bawaan tidak diubah oleh fitur antarmuka/penerbitan.
- Guard kredit ElevenLabs (belum di-commit): satu pintu `runGeneration()` di `packages/sfx-guard/guard.ts`, klien jaringan satu-satunya `packages/sfx-guard/client.ts`,
  CLI `node tools/sfx.ts generate` (default dry run, `--yes` untuk membayar), ledger `assets/sfx/ledger.json` (belum ada; dibuat pada panggilan berbayar pertama),
  batas di `~/Library/Application Support/Sim Studio/elevenlabs-guard.json` (belum ada; default dipakai). Dokumen `docs/sfx-credits.md`; aturan agen di `AGENTS.md`; tes `tests/sfx-guard.test.ts`.
  Kunci API untuk Sim Studio belum dipasang, jadi `generate` belum bisa membaca saldo; belum pernah ada panggilan nyata lewat guard. Tarif estimasi 40 kredit/detik belum dikalibrasi.
  Konektor MCP `mcp__elevenlabs__*` tidak bisa dicegat kode; aturan agen di `AGENTS.md` + aturan izin `ask` di `.claude/settings.json` (tiap panggilan butuh klik pemilik; berlaku sesudah sesi baru).
Writers / operations: tidak ada penulis lain teramati pada 19:07. Studio berjalan di `localhost:5180` (pid 77570, uptime 72 detik, `state: ready`, antrean 0, tidak ada render, `codeStale: false`).
Apakah studio memuat kode terbaru? Jangan percaya catatan ini; tanyakan ke studio:

```bash
curl -s localhost:5180/api/status
```

`"codeStale": false` = terbaru. `true` = restart (`Ctrl+C`, lalu `npm run dev`); jangan restart saat render atau unggahan berjalan.
Dengan `npm run dev:watch` restart otomatis; render yang berjalan menjadi **Stopped** dan bisa **Render again**.

## Batch 245 video (percobaan 3 video selesai 2026-11-18 19:55; sisa 242 BELUM dijalankan, menunggu persetujuan pemilik)
- Percobaan: `preset:billiard-golden-circle` (23 dtk, 9,9 MB), `preset:hammer-box-circle` (32 dtk, 111,6 MB), `preset:billiard-square` (22 dtk, 2,5 MB); semua `done`, tampilan Main-1 terlihat di frame.
  Tercatat di `data/batch/state.json`; menjalankan ulang runner melewati ketiganya. Dua video billiard mendapat judul saran yang sama ("Will this billiard path ever close?").
- Lingkup yang disetujui pemilik: semua scene + 31 preset scene + varian struktural + jenis objek hanya untuk hammer-smash, semua dengan preset style `Main-1` (di atas style `classic`).
  Rencana: `data/batch/plan.json` (245 video; dibuat `npm run batch:plan`, kode `tools/batch-plan.ts`). Runner: `npm run batch:run` (`tools/batch-run.ts`); belum pernah menjalankan render.
- Runner memakai antrean studio (`/api/jobs`), maksimal 2 video berjalan, tidak pernah dua hammer-smash bersamaan, jeda 1,6 dtk antar kiriman, berhenti jika 5 gagal berturut-turut,
  menunggu bila beban CPU > 8 atau disk bebas < 40 GB; berkas `data/batch/PAUSE` menjeda; keadaan di `data/batch/state.json`, bisa dilanjutkan.
- Agar 2 paralel sungguhan, studio harus dinyalakan `JOBS=2 npm run dev` (default 1). Setiap video juga masuk daftar Videos dan dibuatkan cover otomatis.
- Perkiraan (dari 3 render uji): disk sekitar 12 GB (hammer-smash 94 × sekitar 90 MB), waktu sekitar 2 jam dengan 2 paralel (belum diukur).
- Dua preset (`harmonograph-5-4` palet ember, `orbits-5-3` palet ice) membawa palet sendiri sehingga warnanya tidak sepenuhnya Main-1.

- Batch selesai 2026-11-18: 245/245 video `done`, 0 gagal, sekitar 7,4 GB (`data/batch/state.json`, log `data/batch/run.log`).
- Judul diperbaiki: sebelumnya hanya 37 judul berbeda untuk 249 video. Sekarang `facts.tag` (`variantTag` di `packages/publish/describe.ts`, dipakai `writeTitles` di `copywriter.ts`)
  menambah " — <ciri varian>" (wadah, objek, jenis putaran, gerak, bentuk tersembunyi) pada judul hammer-smash dan sync-lines; tes di `tests/publish.test.ts`.
  `node tools/batch-titles.ts --apply` menulis ulang judul + deskripsi 245 video batch (judul kembar sisa diganti ide judul lain) lewat `PATCH /api/videos/:id`; hasil: 249 judul berbeda untuk 249 video.
  Judul lama disimpan di `data/batch/old-titles.json`; batalkan dengan `node tools/batch-titles.ts --undo`. Cover tidak dibuat ulang (teks cover diambil dari bagian sebelum " — ").
  Studio yang berjalan memakai kode lama; restart agar render berikutnya memakai penulis judul baru.

## Evidence
- 2026-11-18 21:30, guard kredit: `npm run typecheck` lulus; `npm test` 207 lulus, 0 gagal (14 tes baru di `tests/sfx-guard.test.ts`, klien/fetch palsu, tanpa jaringan dan tanpa kredit). `node tools/sfx.ts generate` (tanpa kunci) = dry run, 13/13 dilewati, tidak ada panggilan.
- `npm run typecheck`: lulus (2026-11-18 19:08, pohon bersih `af0d5f7`).
- `npm test`: 192 lulus, 0 gagal (sama waktunya). Cakupan: tes unit/integrasi `tests/*.test.ts`; tidak menguji tampilan UI, render nyata, atau YouTube sungguhan.
- Status studio: `curl localhost:5180/api/status` → ready, `codeStale: false`.

## Next
Pemilik: cek thumbnail `KYUpU2KtKUw` di YouTube Studio, lalu putuskan apakah thumbnail `60J5S2RCJ1Y` dipasang ulang. Agen: render scene lain (atas permintaan pemilik) untuk mengisi peta scene × style.

## Recent outcomes
- 2026-11-18: guard kredit ElevenLabs satu pintu + aturan agen; belum di-commit.
- 2026-11-18: preset style (`Main-1` jadi preset style), tes dan dokumen; commit `af0d5f7`.
- 2026-11-18: antrean render tahan restart, status Stopped, Render again, `dev:watch`; commit `facd630`.
- 2026-11-18: cross-agent handoff diinisialisasi; HANDOFF.md disesuaikan ke format checkpoint, ditambah `AGENTS.md` dan `CLAUDE.md`.
