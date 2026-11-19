# HANDOFF — Sim Studio

- format: cross-agent-handoff/1
- task_status: partial
- handoff: ready
- writer: none
- updated_at: 2026-11-20T00:10:00+0700
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
- Belum: tidak diputar/didengarkan manusia, tidak diunggah, studio asli sudah di-restart (kode terbaru; 15 entri Long ada di Videos). Perubahan navigasi di bawah butuh restart lagi saat idle.
- Kode (commit `3910825`, `6aa2b1f`, `3a62d69`, `1701294`; `tsc` bersih, `npm test` 253 lulus 3× berturut-turut): `packages/compile/`, `apps/server/compile-*.ts`, `tools/compile.ts`, `apps/studio/compile-ui.ts` + `compile.css`, dokumen `docs/compile.md`, bagian di README.
  Kabel Videos (`videos.ts`, `index.html`) sudah di-commit bersama pekerjaan kalender/jadwal (`640f399`, `c08650f`).
- Catatan pemilik: unggah long video >15 menit butuh channel terverifikasi (nomor telepon); semua video ini di bawah 15 menit. Uploader studio belum mendukung long video (hanya 1080×1920 sampai 3 menit): pekerjaan berikutnya yang terpisah. Jadwal dan status Shorts tidak diubah.

## Navigasi halaman Videos (2026-11-19 ~15:45) — selesai, siap commit/ditinjau
- Pemilih format All / Shorts / Long (hitungan per format; Short + Long = All) di atas chip status; memengaruhi daftar, chip, pencarian, kalender (rencana unggah hanya untuk Shorts; Long hanya tampil bila ada tanggal, ditandai "Long"), dan CSV. Diingat di localStorage (`studio.vformat`) dan di alamat: `#videos/long`, `#videos/shorts/calendar`, `#videos/long/build` (tombol back berjalan).
- Mode: List / Calendar / "Build long video" (dulu "Compile"). Toolbar: pencarian lebar (`/` fokus, `Esc` hapus), menu simulasi dan gaya, urutan (terbaru, jadwal, judul), menu "More" (bahasa Suggestions, CSV format terpilih, cadangan JSON, YouTube, folder data). Banner "N renders…" ringkas, "Add all N…" meminta konfirmasi dan menambah persis berkas yang dihitung (`untrackedFiles` ditambahkan ke GET /api/videos, aditif), "Dismiss" diingat per daftar berkas (`studio.vdismiss`). Keadaan kosong: Long kosong → tombol Build long video; tanpa hasil → Clear filters.
- Kode: `apps/studio/videos-nav.ts` (murni) + `videos-nav.css`, perubahan di `videos.ts`, `index.html`, `calendar-ui.ts`, `main.ts`, `packages/publish/calendar.ts` (`kind`), `server.ts` (hanya `untrackedFiles`). Tes: `tests/videos-nav.test.ts` (6). Tidak menyentuh data/videos.json, jadwal, status, mesin render, YouTube.
- Terverifikasi di studio uji (port lain, salinan data): Shorts/Long/All, terang dan gelap, lebar 1280, 768 dan 375, hash + back/forward, localStorage, banner tutup dan konfirmasi, Clear filters, `/`, panah pada pemilih format, kalender per format, keadaan kosong Long. Belum: pembaca layar sungguhan; layar sangat lebar.
- Tes lama yang kadang gagal ternyata penyebabnya satu: port uji yang ditolak `fetch` ("bad port": 6000, 6665–6669, 6679, 6697) atau dipakai macOS (5000, 7000 = AirPlay). Perbaikan: `tests/ports.ts` (`usablePort`) dipakai semua tes studio, plus batas tunggu start 45 dtk. `npm test` 259 lulus 4× berturut-turut, `tsc` bersih.

## Kontras UI + tombol "Show MP4 in folder" untuk Long (2026-11-19 ~17:10) — selesai
- Penyebab dikonfirmasi: dua blok `.seg` di `style.css`; yang belakangan menimpa warna teks menjadi `--text` sementara latar status tetap (rasio 1,1–1,25 gelap, 2,7–3,0 terang). Sekarang satu blok `.seg`, tiap tombol status memasang latar + `--on-solid` bersama.
- Temuan audit lain (semua diperbaiki lewat token/aturan): batas kolom/pilihan `--field-line` 1,3–1,5:1 gelap dan 2,8:1 terang (kini #6f7a97 / #7a849c, ≥3:1), placeholder gelap 3,6:1 (kini `::placeholder` = `--muted`), tanggal dan chip kalender di luar bulan (opacity .45 → warna muted). Tidak ada warna keras baru di luar token.
- Ukur ulang (`tools/contrast-audit.js`, 20 tampilan × 2 mode, ~24.000 pengukuran): 0 di bawah AA; 44 kontrol nonaktif dikecualikan WCAG. Belum diukur: hover/fokus, tooltip, strip render dengan job nyata (dicek dengan baris contoh).
- Tes pencegah: `tests/contrast.test.ts` (token ≥ AA kedua mode; aturan "latar pressed/on harus punya warna teks"; satu blok `.seg`); terbukti gagal pada CSS lama. Aturan di `docs/ui-modes.md`.
- Tombol "Show MP4 in folder" di detail Long (`compile-ui.ts`), memakai POST /api/reveal. Aturan nama berkas dipindah ke `apps/server/reveal.ts` (hanya nama polos di output/, .mp4/.jpg/.txt; `../`, path absolut, `\`, NUL ditolak 400; tidak ada 404; semua berkas output/ asli lolos). `SIM_NO_OPEN=1` (hanya tes) mencegah membuka Finder. Tes `tests/reveal.test.ts`. Tombol untuk thumbnail/.txt tidak ditambahkan: berkasnya satu folder dengan MP4 di Finder.
- Tambahan kecil: header detail video membungkus di layar sempit (tombol terpotong).
- Studio asli belum di-restart: butuh restart saat idle agar CSS/tombol/rute baru aktif.

## Channel per video + branding channel baru (2026-11-19 ~18:00)
- Tugas 1 SELESAI (commit `ce79c5e`): bidang `channel` di tiap video (default "Photon Lab"), upgrade sekali saat studio dibuka dan boleh menulis (cadangan dulu, schemaVersion tetap 1), lencana di baris/detail, filter "All channels" hanya bila >1 channel. Video baru memakai nama channel YouTube yang terhubung, kalau tidak "Photon Lab". `tests/channel.test.ts` (6); `npm test` 274 lulus, tsc bersih. Diuji di studio uji port 5391 dengan salinan data (dimatikan).
  `data/videos.json` ASLI belum berisi `channel` di disk: studio asli (pid 69773) memakai kode lama; baru tertulis saat studio di-restart (aman, ada cadangan). Tanpa restart pun data lama terbaca sebagai Photon Lab.
- Tugas 2: pemilik memilih **Plasma Pendulum** (@PlasmaPendulum). Kit selesai di `branding/brands/plasma-pendulum.json` + `branding/brands/plasma-pendulum/` (README berisi identitas, teks channel, langkah YouTube Studio, cara pakai Main-2; aset png/svg; `node branding/build.mjs plasma-pendulum`; `node branding/check-contrast.mjs plasma-pendulum`). `build.mjs` menerima id brand; Photon Lab tetap identik (git bersih). Cover contoh dari 2 render nyata 12 dtk (Main-2) di studio uji port 5392, data sementara (dimatikan). Channel BELUM dibuat pemilik; studio masih satu koneksi (Photon Lab). `style-presets/main-2.json` milik pemilik, belum di-commit, tidak diubah.
- Kandidat (cek 2026-11-19): handle @VioletVector, @AmethystAxis, @NebulaBounce, @PlasmaPendulum, @MagentaMechanics, @VioletKinetics = 404 di youtube.com (bebas); @Hyperviolet SUDAH DIPAKAI (dicoret). Langkah "buat channel di YouTube Studio sampai kolom nama" tidak dilakukan (create_channel mengalihkan ke channel Photon Lab; alur channel baru butuh klik akun).

- Channel Plasma Pendulum disetel di Chrome pemilik (2026-11-19 ~20:00): channel sudah dibuat pemilik (@PlasmaPendulum); terpasang profil, banner, watermark, deskripsi (ejaan AS), kata kunci, setelan unggah, 3 playlist Private. Made for Kids = No (disetel atas persetujuan pemilik). Menunggu pemilik: negara (opsional), verifikasi telepon, email/tautan. Dukungan dua channel di uploader: kode selesai 2026-11-19 (lihat bagian "Dua channel di Sim Studio"); koneksi nyata Plasma Pendulum menunggu pemilik. Detail: `branding/brands/plasma-pendulum/README.md`.

## Dua channel di Sim Studio (2026-11-19 ~23:00) — kode selesai, BELUM aktif di studio asli
- Commit `c51f45a` (kredensial multi-koneksi + migrasi), `c707081` (model data + jadwal per channel), `e77822b` (uploader/server per channel, unggah manual), `24a4567` (UI), dan dokumen (commit berikut).
- Rincian teknis: `docs/youtube-upload-plan.md` §3b. Cara pakai: README "Two channels", "Uploading by hand", dan "Uploading to the second channel later".
- Tes: `tests/channels.test.ts` (15, Google tiruan multi-channel, termasuk regresi Photon Lab lewat `schedule-run --count 1` tanpa `--channel`). `npm test` 289 lulus, `tsc` bersih. Branding Photon Lab dan Plasma Pendulum identik setelah dibangun ulang.
- UI dicek di studio uji port 5393 (HOME palsu, salinan data, Google tiruan; sudah dimatikan): dua baris koneksi, sakelar, pemilih channel, bantuan unggah manual + Mark/Undo, kalender menyebut channel, kontras teks ≥ 4,5 di mode gelap dan terang, tanpa error konsol.
- **Studio asli di-restart 2026-11-19 ~17:41 UTC (persetujuan pemilik, idle: tanpa render/unggahan/unggahan tertunda): pid 88437, kode baru, dijalankan `nohup npm run dev` (log `~/Library/Logs/sim-studio-restart.log`).** Terverifikasi: `youtube.json` termigrasi (cadangan `.bak-single-channel`, mode 600), satu koneksi Photon Lab terhubung, Upload On, aktif; 264 video semuanya "Photon Lab" (252 rendered, 9 scheduled, 3 published, tidak berubah); `schedule-run` (rekonsiliasi saja) membaca rencana: 8 uploaded, 1 failed, 223 planned. Belum diuji: unggahan nyata Photon Lab dengan kode baru (tugas 20 Nov 13:00 WIB akan jadi ujian pertama). Catatan lama di bawah ini sebelum restart:
- (sebelum restart) Studio asli (pid 69773) masih KODE LAMA. Saat di-restart (hanya setelah pemilik bilang tidak ada render/unggahan berjalan), `youtube.json` asli dimigrasi sekali: cadangan `youtube.json.bak-single-channel`, Photon Lab = koneksi pertama, Upload On. `data/videos.json` mendapat `channel` (lihat bagian sebelumnya).
- Tugas terjadwal `upload-next-8-photon-lab` (20 Nov 13:00 WIB) tetap jalan dengan kode baru: tanpa `--channel` memakai `data/schedule.json` (Photon Lab). Studio sudah di-restart, jadi `codeStale` false.
- Pemeriksaan OAuth oleh pemilik (2026-11-19): aplikasi OAuth "Sim Studio" berstatus **In production** (External, scope `youtube.force-ssl` saja, 1 dari 100 pengguna), klien Desktop dibuat 2026-11-18. Tanggal pindah dari Testing tidak terlihat, jadi token Photon Lab yang lama mungkin terbit saat Testing (bisa kedaluwarsa ±7 hari). Urutan yang disepakati: migrasi + restart (selesai) → pemilik menghubungkan ulang Photon Lab (YouTube settings → baris Photon Lab → Connect again, bila baris itu berstatus tidak terhubung; kalau masih ✓ connected, tidak perlu) → pemilik menyambungkan Plasma Pendulum. Token tetap bisa putus bila izin dicabut di myaccount.google.com/permissions, kata sandi Google diganti, atau tidak dipakai > 6 bulan; studio lalu menampilkan "Connect again" untuk channel itu saja. Tidak ada isian status OAuth di UI (tidak ditambahkan).
- **Plasma Pendulum TERHUBUNG (2026-11-19, pemilik menyambungkan sendiri):** studio menampilkan dua koneksi: Photon Lab (@photonplayground) terhubung, Upload On, aktif; Plasma Pendulum (@plasmapendulum) terhubung, Upload **Off**, tidak aktif. Kuota hari itu 19 unit, 0 unggahan; `youtube.json` mode 600; studio kode terbaru. Belum ada unggahan ke channel mana pun dengan kode baru.
- Menunggu pemilik:
  - (selesai: Menghubungkan Plasma Pendulum) di dunia nyata (YouTube settings → Connect another channel… → pilih channel di Google → "Connect Plasma Pendulum"). Masuknya bawaan Upload Off.
  - Menyalakan Upload untuk Plasma Pendulum, satu unggahan uji, atau jadwal massal: masing-masing hanya dengan persetujuan di chat.
- Belum terverifikasi: tidak ada panggilan Google nyata. Biaya kuota sebenarnya per unggahan: dokumen (2026-11-18) menyebut unggahan punya ember 100/hari sendiri; brief pemilik menyebut 1.600 unit; data 19 Nov (8 unggahan, ±3.500 unit) cocok dengan dokumen. Teks UI tidak menyebut angka per unggahan.

## Batch Plasma Pendulum (mulai 2026-11-20) — rencana selesai, render BELUM dimulai
- Rencana: `node tools/batch-plan-plasma.ts` (companion; `tools/batch-plan.ts` tidak diubah, hash plan Photon dijaga tes) → `data/batch-plasma/plan.json`: 245 pasangan, Main-2 + classic, `handle` @PlasmaPendulum, `palette: theme`, parameter berbeda dari pasangan Photon (tanda tangan param beda dari semua Photon dan antar-Plasma), judul layar sendiri (maks 2 baris × 32 huruf), urutan berbeda (10 pertama = satu per scene, lalu acak berbenih; hammer-smash tidak berdampingan). Runner: `node tools/batch-run.ts --dir data/batch-plasma [--limit N]` (opsi `--dir` baru; tanpa itu tetap data/batch). Lembar kontak semua video: `node tools/batch-sheet.ts --dir data/batch-plasma --out <folder>`. Tes: `tests/batch-plasma.test.ts` (8).
- Cadangan sebelum render: `data/videos.pre-plasma.json` (salinan penuh, di luar rotasi 50 cadangan store) dan `data/batch-plasma/photon-videos.snapshot.json` (sha256 tiap record yang ada: 264). Data `data/batch/` (Photon) tidak disentuh.
- Perkiraan: 245 video ≈ 78 menit satu per satu (rata-rata Photon per pasangan), ≈ 7,4 GB; disk bebas 229 GB.
- Syarat sebelum render: channel AKTIF studio = Plasma Pendulum (pemilik yang mengatur atau menyetujui di chat); video baru otomatis bertanda channel + channelId aktif. Setelah selesai: kembalikan channel aktif ke Photon Lab bila unggah Photon dari studio dilanjutkan.
- 2026-11-20 ~00:20: channel aktif studio terbaca sudah Plasma Pendulum (tidak perlu diubah; pemilik menyetujui pengaturan di chat). Uji kecil: `node tools/batch-run.ts --dir data/batch-plasma --limit 10` (latar, log `data/batch-plasma/run.log`), keluaran di `output/`.
- Uji kecil SELESAI 2026-11-20 00:35: 10/10 done, 0 gagal, rata-rata 22 dtk; semua `channel` = Plasma Pendulum + `channelId` UCeQFzt0… (benar), status rendered, 1080×1920@60, 23,6–53,5 dtk; cover 1080×1920 dibuat lewat API studio untuk 10 itu. Lembar kontak dari video nyata: `data/batch-plasma/test10-contactsheet.png`, `test10-covers.png`. Catatan: judul publikasi penulis studio untuk pasangan galton `p≠0,5` berbunyi "bell curve" padahal papan miring (juga di Photon); diperbaiki di langkah judul. Menunggu persetujuan pemilik untuk render massal (per 50).
- Tahap berikutnya: render massal, lembar kontak, persetujuan pemilik, lalu render per 50.

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
