# HANDOFF — Sim Studio

- format: cross-agent-handoff/1
- task_status: partial
- handoff: ready
- writer: none
- updated_at: 2026-11-19T13:40:00+0700
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
Verified (diperiksa 2026-11-19 08:46):
- Fondasi: studio, scene, style, render, audio, juice, Videos, unggah YouTube. Teks publikasi + thumbnail (5 gaya judul, deskripsi, tag, pemeriksa kualitas, cover 9:16): `docs/publishing.md`.
- Thumbnail Shorts: yang diunggah gambar tegak 1080×1920; tombol "Set the thumbnail again" untuk video lama.
- Mode terang/gelap (hanya antarmuka): `docs/ui-modes.md`. Editor style (`themes/<id>.json`): `docs/styles.md` §4.
- Antrean render tahan restart (`data/jobs.json`, status Stopped, Render again, `dev:watch`): `apps/server/job-store.ts`, `server.ts`, `worker.ts`; tes `tests/job-queue.test.ts`.
- Preset style (lapisan tampilan di atas Style, `style-presets/<id>.json`, parameter scene `stylePreset`, tab Basic): `docs/styles.md` §5; kode `packages/theme/index.ts`, `packages/theme/style-preset.ts`, `/api/style-presets`; tes `tests/style-preset.test.ts`.
  `presets/main-1.json` dihapus; tampilannya jadi preset style `Main-1`.
- Ketahanan kerja (2026-11-19, lima tahap kecil, tiap tahap di-commit dan diuji; rincian dan cara pakai di README bagian "Restarting the studio safely" dan YouTube):
  A antrean: record job queued/running tidak pernah terbuang (`pruneJobs`, sebelumnya hanya 30 terbaru apa pun statusnya) · B batch: `tools/batch-chain.ts`, runner mengikuti "Render again", stopped dijalankan lewat `/again`, kunci `data/batch/.runner.lock` ·
  C kuota harian YouTube: `waitUntil`/`needsSession` di record unggahan, lanjut sendiri 2 menit setelah tengah malam Pacific (jam dinding, cek tiap 30 dtk dan saat start), insert pertama hanya bila terbukti belum ada video, berkas utuh, jadwal masih ≥ 30 menit; tampil "Waiting for quota" + "Try now" ·
  D `health.ts`, `sweep.ts`, `log.ts` (cap waktu, redaksi, rotasi 5 MB), `awake.ts` (caffeinate), `tools/state.ts`; banner masalah di halaman, render ditolak bila disk < 2 GB · E `tests/dev-watch.test.ts`, README "Which one?".
- Pohon kerja git bersih di cabang `main` setelah commit tahap E (lihat `git log`).
Unfinished / unknown:
- Cek thumbnail `KYUpU2KtKUw` di YouTube Studio (sudah dipasang ulang dengan gambar 9:16; tampilan belum dilihat pemilik).
- Video `60J5S2RCJ1Y` (Published) masih bergambar thumbnail lama; "Set the thumbnail again" tersedia tapi perlu persetujuan pemilik (50 unit kuota).
- Render scene lain untuk mengisi peta scene × style.
Decisions: lihat `docs/styles.md`, `docs/publishing.md` dan memori proyek. Aturan tetap:
- Kredensial hanya di `~/Library/Application Support/Sim Studio/` (mode 600); tidak pernah di folder proyek, log, atau chat.
- Tidak pernah menghapus video di YouTube.
- `references/` (video kompetitor) tidak di git dan tidak diubah. `data/` dan `output/` tidak di git.
- Mesin render, scene, dan style bawaan tidak diubah oleh fitur antarmuka/penerbitan.
- Guard kredit ElevenLabs (commit `98c9533`): satu pintu `runGeneration()` di `packages/sfx-guard/guard.ts`, klien jaringan satu-satunya `packages/sfx-guard/client.ts`,
  CLI `node tools/sfx.ts generate` (default dry run, `--yes` untuk membayar), ledger `assets/sfx/ledger.json` (belum ada; dibuat pada panggilan berbayar pertama),
  batas di `~/Library/Application Support/Sim Studio/elevenlabs-guard.json` (belum ada; default dipakai). Dokumen `docs/sfx-credits.md`; aturan agen di `AGENTS.md`; tes `tests/sfx-guard.test.ts`.
  Kunci API untuk Sim Studio belum dipasang, jadi `generate` belum bisa membaca saldo; belum pernah ada panggilan nyata lewat guard. Tarif estimasi 40 kredit/detik belum dikalibrasi.
  Konektor MCP `mcp__elevenlabs__*` tidak bisa dicegat kode; aturan agen di `AGENTS.md` + aturan izin `ask` di `.claude/settings.json` (tiap panggilan butuh klik pemilik; berlaku sesudah sesi baru).
Writers / operations: tidak ada penulis lain teramati pada 08:46. Studio TIDAK berjalan (`curl localhost:5180/api/status` gagal, tidak ada proses `apps/server`); studio yang dinyalakan berikutnya memuat semua kode baru dengan sendirinya.
Jangan percaya catatan ini soal studio; tanyakan ke keadaan sebenarnya (hanya baca):

```bash
node tools/state.ts
```

Ia menampilkan git, studio (pid, `codeStale`, antrean), jumlah render dan batch, disk, dan header handoff. `codeStale: true` = restart (`Ctrl+C`, lalu `npm run dev`); jangan restart saat render atau unggahan berjalan.
Pilihan perintah: `npm run dev` untuk merender/mengunggah, `npm run dev:watch` hanya saat mengubah kode server dan tidak ada render atau unggahan berjalan (render yang berjalan menjadi **Stopped**, lalu **Render again**).

## Batch 245 video (selesai 2026-11-18)
- 245/245 video `done`, 0 gagal, sekitar 7,4 GB; keadaan di `data/batch/state.json` (tidak di git), rencana `data/batch/plan.json`, runner `npm run batch:run` (`tools/batch-run.ts`, `--dry-run` untuk melihat saja; menunggu bila beban CPU tinggi atau disk bebas < 40 GB; `data/batch/PAUSE` menjeda).
- Ukuran waktu dari batch itu: median 15 dtk per video (`sync-lines` 14, `hammer-smash` 25,5, maksimum 39) pada 60 fps; setup + audio sekitar 0,3 dtk, gambar 2,8 ms + tunggu encode 2,4 ms per frame (2,7× real-time). Karena itu render tidak dipecah per segmen: render ulang penuh dari parameter tersimpan lebih murah dan lebih aman (sambungan H.264, audio, dan fisika berstatus mulai dari frame 0).
- Judul 249 video dibuat unik (`variantTag`, `node tools/batch-titles.ts --apply`; batalkan `--undo`, judul lama di `data/batch/old-titles.json`). Cover tidak dibuat ulang.
- Dua preset (`harmonograph-5-4`, `orbits-5-3`) membawa palet sendiri sehingga warnanya tidak sepenuhnya Main-1. Untuk 2 render paralel studio harus dinyalakan `JOBS=2` (default 1; konkurensi rata-rata batch lalu hanya sekitar 0,7, kemungkinan karena JOBS=1 dan jeda runner, belum diverifikasi).

## Jadwal unggah YouTube (tahap 1 selesai 2026-11-19, MENUNGGU persetujuan pemilik; belum ada unggahan)
- Permintaan: 5 slot/hari WIB (05:00, 06:30, 08:00, 19:30, 00:00 menuju tanggal berikutnya), mulai 19 Nov 2026, via jalur unggah studio yang ada.
- Dibuat: `packages/publish/schedule.ts` (slot + pemilihan seimbang, murni), `tools/schedule-plan.ts` (dry run; `--write` menyimpan `data/schedule.json`), `tests/schedule.test.ts` (10 tes). `npm run schedule:plan`.
- Rencana tersimpan: `data/schedule.json` (seed 20261119, 232 slot planned, 14 cadangan sync-lines, 0 dilewati), tabel `data/schedule-table.md`. Sumber kebenaran status slot: planned/uploading/uploaded/failed.
- Tahap 2 uji SATU video selesai 09:40: slot 1 (19 Nov 19:30 WIB) `v-mwm56vufxr2z` → YouTube `zkiYMdkwRcU`, status scheduled, thumbnail 9:16 terpasang; dicek di YouTube Studio (judul, deskripsi, 12 tag, thumbnail, Scheduled 19 Nov 2026 19:30, kategori Science & technology, bukan Made for Kids). Runner: `node tools/schedule-run.ts --count N` (satu per satu, berhenti di masalah pertama, tanpa retry; `--reconcile` tanpa argumen). Belum ada lanjutan: 231 slot masih planned, menunggu persetujuan pemilik untuk batch (usulan 15/hari).
- Batch 15 dimulai 2026-11-19 ~09:50 WIB: `node tools/schedule-run.ts --count 15` (log di scratchpad sesi; status per slot di data/schedule.json). Cek `node tools/schedule-run.ts` (rekonsiliasi) sebelum menjalankan lagi; jangan jalankan dua pelari sekaligus.
- Batch 15 (19 Nov) berhenti di unggahan ke-9: 8 slot uploaded (sampai 21 Nov 05:00), slot 21 Nov 06:30 `v-mwm5fvnr16gu` failed (429 batas unggah channel, tidak ada video terbentuk), 223 planned. Pemilik setuju coba lagi besok: tugas terjadwal `upload-next-8-photon-lab` (20 Nov 13:00 WIB, 8 video, butuh aplikasi + studio berjalan dan Mac menyala).
- Tampilan kalender jadwal: Videos → Calendar (`apps/studio/calendar-ui.ts`, `packages/publish/calendar.ts`, `GET /api/schedule`, docs/publishing.md). Diuji di studio uji port lain dengan salinan data (dimatikan); studio asli masih kode lama, restart saat idle agar kalender tampil.
- Tahap 2 (uji 1 video, lalu bertahap) hanya setelah pemilik menyetujui; tiap unggahan butuh consent key studio (`/api/videos/:id/youtube/check` lalu `upload`).

## Long video (kompilasi 16:9) — SELESAI sampai "siap unggah" (2026-11-19 ~13:35); belum diunggah
- 15 long video dibangun dari 239 klip (7 kembar tidak dipakai; 3 Short gagal pemeriksa teks tidak dipakai), 9:20–13:45 menit, 1920×1080 60 fps H.264 + AAC, total sekitar 6,1 GB. Daftar: `output/long-videos-ready.md`. Per video di `output/`: `long-<slug>.mp4`, `long-<slug>-thumbnail.jpg` (1280×720), `long-<slug>.txt` (judul, deskripsi dengan bab, tag, hashtag). Catatan build: `data/compilations/build.log`; rekaman: `data/compilations/<id>.json` (15, status built); cache klip 6,1 GB di `data/compilations/cache/` (hapus lewat "Free disk" di halaman Compile atau biarkan untuk build ulang cepat).
- Terverifikasi: tiap video lolos pemeriksaan di akhir build DAN `node tools/compile.ts verify <slug>` terpisah (resolusi, fps 60/1, h264 yuv420p, AAC 44,1 kHz stereo, jumlah frame = jumlah klip, durasi gambar = suara, decode penuh tanpa kesalahan, tanpa frame hitam); teks lolos pemeriksa (angka dan bab sesuai frame nyata). Frame lembar kontak dan 15 thumbnail dilihat.
- Belum: tidak diputar/didengarkan manusia, tidak diunggah, studio asli (pid 22755, kode lama) belum di-restart, jadi halaman Compile dan entri "Long" di Videos baru muncul setelah restart saat tidak ada render/unggahan (entri dibuat otomatis saat start).
- Kode (commit `3910825`, `6aa2b1f`, `3a62d69`, `1701294`; `tsc` bersih, `npm test` 253 lulus 3× berturut-turut): `packages/compile/`, `apps/server/compile-*.ts`, `tools/compile.ts`, `apps/studio/compile-ui.ts` + `compile.css`, dokumen `docs/compile.md`, bagian di README.
  BELUM di-commit: kabel Videos di `apps/studio/videos.ts` + `apps/studio/index.html` (tombol Compile, lencana "Long", detail long); bercampur dengan pekerjaan kalender/jadwal yang belum di-commit, jadi commit keduanya bersama. Jangan `git stash` dan jangan `git add -A` sembarangan.
- Catatan pemilik: unggah long video >15 menit butuh channel terverifikasi (nomor telepon); semua video ini di bawah 15 menit. Uploader studio belum mendukung long video (hanya 1080×1920 sampai 3 menit): pekerjaan berikutnya yang terpisah. Jadwal dan status Shorts tidak diubah.

## Evidence
- 2026-11-19 08:46: `npm run typecheck` lulus; `npm test` 223 lulus, 0 gagal (tes baru: job-queue +1, batch-run 5, youtube +4 untuk kuota, housekeeping 6, dev-watch 1, ux +1). Semua tanpa jaringan nyata, tanpa kredit, tanpa unggahan.
- Uji nyata di studio uji (port lain, Google palsu): halaman Videos menampilkan "Waiting for quota", "Try now", hitungan "1 uploading", dan banner "Heads up" untuk disk; studio uji dimatikan sesudahnya. Belum diuji: kuota YouTube sungguhan, jam reset sungguhan (hanya fungsi `nextQuotaReset` diuji pada tanggal tetap), Mac tidur, `caffeinate` sungguhan di bawah render panjang.
- Studio asli (`localhost:5180`) tidak berjalan dan tidak disentuh.

## Next
Pemilik: cek thumbnail `KYUpU2KtKUw` di YouTube Studio, putuskan thumbnail `60J5S2RCJ1Y`. Agen: render scene lain atas permintaan pemilik untuk mengisi peta scene × style. Bila memakai ElevenLabs: pasang kunci API Sim Studio (`~/Library/Application Support/Sim Studio/elevenlabs.json`, mode 600) dan kalibrasi tarif estimasi dari ledger.

## Recent outcomes
- 2026-11-19: ketahanan kerja tahap A–E (antrean, batch, kuota YouTube, kerapian, dev:watch + dokumen).
- 2026-11-18: guard kredit ElevenLabs satu pintu + aturan agen + izin `ask` untuk `mcp__elevenlabs` (`98c9533`, `617e96e` dst. lihat `git log`).
- 2026-11-18: batch 245 video dan judul unik (`34abdf1`); preset style (`af0d5f7`); antrean render tahan restart (`facd630`); cross-agent handoff.
