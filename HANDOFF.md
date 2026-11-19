# HANDOFF — Sim Studio

- format: cross-agent-handoff/1
- task_status: partial
- handoff: ready
- writer: none
- updated_at: 2026-11-20T01:30:00+0700
- language: id

Satu-satunya checkpoint proyek ini: **status kerja saat ini saja**. Cara pakai ada di `README.md`, rujukan di `docs/README.md`, riwayat pekerjaan selesai di `docs/work-log.md` (dipindah dari sini 2026-11-20). Perbarui di akhir tiap langkah kerja yang substansial.

## Project
Identity: Sim Studio (`sim2d-studio`): studio lokal untuk membuat video simulasi 2D (scene, style, render, audio, publikasi YouTube) untuk tiga channel: Photon Lab (utama, unggah lewat studio), Plasma Pendulum (kedua, unggah manual), Fourier Loom (dikelola teman pemilik, hanya serah-terima berkas).
Map: `README.md` (peta folder root), stack Node >= 23.6 (TypeScript langsung), kode `apps/` + `packages/`, skrip `tools/` (`tools/README.md`), tes `tests/`, kit channel `branding/` (`branding/README.md`), aturan penamaan/tata letak `docs/conventions.md` (diperiksa `tests/conventions.test.ts`). Tidak ada backlog terpisah; daftar "Belum" di bawah adalah satu-satunya.

## Task
Goal and authorized scope: tidak ada tugas aktif. Perapian ringan repo (2026-11-20) selesai; Tahap 4 menunggu persetujuan pemilik (di bawah). Unggah ke YouTube, pasang ulang thumbnail, dan ubah channel hanya dengan persetujuan pemilik.
Acceptance criteria: tiap fitur punya tes di `tests/` dan dokumen di `docs/`; `npm run typecheck` dan `npm test` lulus.

## State
Verified (2026-11-20 ~01:20, setelah perapian): `npm run typecheck` bersih; `npm test` 340 lulus, 0 gagal (±57 dtk; baseline sebelum perapian 330 lulus, 60 dtk); `node branding/build.mjs` dan `... plasma-pendulum` menghasilkan byte identik (hash sebelum = sesudah, `git status branding` bersih).
- Fondasi lengkap: studio, scene, style, preset style, render, audio, juice, Videos (angka/filter per channel, channel manual, pilih banyak, kalender), unggah YouTube (kuota, dua channel, unggah manual), antrean tahan restart, batch per channel, video panjang 16:9, kit branding tiga channel. Rincian per fitur: `docs/README.md`.
- Perapian 2026-11-20 (commit `35be95e`, `53a703c`, dan commit handoff ini): README 466 → 129 baris (cara pakai + peta folder), sisanya dipindah apa adanya ke `docs/operations.md`, `videos.md`, `youtube.md`, `batches.md`, `architecture.md`, `styles.md` §6–7; gambar bukti ke `docs/evidence/` dan 40 PNG besar dikompres ke JPEG (docs 45,8 → 23,7 MB, berkas dilacak 66,2 → 44,0 MB); `publishing-research.md` digabung ke `publishing.md`; `tools/ssim_lo.sh` → `ssim-lo.sh`; paket `dejavu-fonts-ttf` dihapus (tak dipakai; font dimuat dari `assets/fonts/`). Jalur lama nol sisa (grep). Tidak ada kode di `apps/` atau `packages/` yang berubah; studio asli tetap `codeStale: false`.
- Aturan baru dan cara memeriksa: `docs/conventions.md`; `node --test tests/conventions.test.ts` (nama berkas, tanpa log/bak/tmp terlacak, tautan markdown, indeks docs, batas ukuran 1 MiB / gambar docs 700 KiB). Terbukti gagal pada contoh pelanggaran.
Operasi nyata (jangan percaya catatan ini; tanya keadaan sebenarnya, hanya baca): `node tools/state.ts`. Pada 01:20 studio pid 83344 berjalan, idle, kode terkini (`codeStale: false`), antrean 0, tanpa render/batch/unggahan. `npm run dev` untuk merender/mengunggah; `npm run dev:watch` hanya bila tidak ada render atau unggahan.

Unfinished / unknown (menunggu pemilik):
- **Tahap 4 perapian**: pemilik menyetujui "semua yang aman" (2026-11-20); dieksekusi hanya `data/videos-ui-checks/` (kosong), `prototypes/output/` (62 MB) dan `output/thumbs/` (33 MB cache). Sisanya TETAP menunggu keputusan (tidak dapat dibuat ulang atau perlu keputusan lain): lihat tabel.
- Unggah Photon Lab: jadwal 8 uploaded / 1 failed (`v-mwm5fvnr16gu`, 429 batas unggah channel) / 223 planned. Tugas terjadwal `upload-next-8-photon-lab` (20 Nov 13:00 WIB) tidak dibatalkan; keputusan pemilik soal slot failed dan penyebab 429 belum ada (`docs/work-log.md`, bagian pemeriksaan API). Kuota YouTube per unggahan belum terverifikasi (dokumen resmi 1 unit vs data nyata ±3.500 unit untuk 8 unggahan).
- Plasma Pendulum: 245 video siap (`channel` benar, cover ada), tersambung, Upload Off; diunggah manual oleh pemilik. Fourier Loom: 245 video + folder serah-terima `output/serah-terima-video-fourier-loom/` siap, belum diserahkan ke teman; tidak ada unggah/penjadwalan.
- 15 video panjang (kompilasi 16:9) siap unggah, belum diunggah, belum diputar manusia; uploader studio belum mendukung video panjang.
- Cek thumbnail `KYUpU2KtKUw` di YouTube Studio; thumbnail `60J5S2RCJ1Y` perlu "Set the thumbnail again" (50 unit, persetujuan pemilik).
- Token OAuth Photon Lab bisa kedaluwarsa bila terbit saat aplikasi masih Testing; studio menampilkan "Connect again" bila putus.
- Temuan terbuka (tidak dikerjakan): (1) Build long video tidak punya filter channel; (2) grup "No channel" tidak pernah muncul dari server; (3) daftar Videos menggambar semua baris sekaligus (509 sekarang, ±750 dengan Fourier Loom; usul daftar bertahap bila > 1000); (4) penandaan "Fourier Loom" saat render butuh opsi server + restart (kini lewat More → Channel for the videos shown…); (5) 11 ekspor tanpa pemakai (Tahap 4).
Decisions: lihat `docs/styles.md`, `docs/publishing.md`, `docs/conventions.md`, memori proyek. Aturan tetap:
- Kredensial hanya di `~/Library/Application Support/Sim Studio/` (mode 600); tidak pernah di folder proyek, log, atau chat.
- Tidak pernah menghapus video di YouTube. Unggah hanya dengan persetujuan pemilik di chat; tiap unggahan butuh consent key studio.
- `references/` (video kompetitor) tidak di git dan tidak diubah. `data/` dan `output/` tidak di git dan tidak disentuh perapian.
- Mesin render, scene, dan style bawaan tidak diubah oleh fitur antarmuka/penerbitan.
- Guard kredit ElevenLabs: satu pintu `runGeneration()` di `packages/sfx-guard/guard.ts`, CLI `node tools/sfx.ts generate` (default dry run, `--yes` untuk membayar), ledger `assets/sfx/ledger.json` (belum ada; jangan diubah), batas di `~/Library/Application Support/Sim Studio/elevenlabs-guard.json`. Dokumen `docs/sfx-credits.md`; aturan agen di `AGENTS.md`; tes `tests/sfx-guard.test.ts`. Kunci API Sim Studio belum dipasang; belum pernah ada panggilan nyata. Konektor MCP `mcp__elevenlabs__*` tidak bisa dicegat kode: aturan `ask` di `.claude/settings.json`.
- Perapian ringan: tidak memindahkan `apps/ packages/ tools/ tests/`; tidak menulis ulang riwayat git; tidak mengubah `assets/sfx/ledger.json`; keluaran branding Photon/Plasma identik byte.
Writers / operations: tidak ada penulis lain teramati (01:20). Catatan kejadian perapian: lima berkas `apps/server/*.ts` sempat tertimpa waktu-ubahnya (isi tidak berubah, `git diff` kosong) sehingga studio melapor `codeStale: true`; waktu-ubah dikembalikan ke waktu commit terakhir masing-masing dan status kembali `false`.

## Tahap 4: usulan menunggu persetujuan (belum dieksekusi)
Ukuran per 2026-11-20. "Kode" = dirujuk kode/skrip (grep di apps, packages, tools, tests, branding, `.command`).

| Item | Isi | Ukuran | Kode? | Usulan |
|---|---|---|---|---|
| `work/` | coretan analisis/bench: skrip `.mjs`, frame dan PNG perbandingan, `main.ts.bak-uxv2` | 94 MB | hanya `tools/compare.sh` menulis ke `work/cmp`; `docs/ux-v2.md` menyebut skripnya | arsipkan ke luar repo, lalu hapus; simpan `cdp.mjs`/`shots.mjs`/`flows.mjs` bila ingin mengulang ukur UX |
| `prototypes/output/` | render prototipe lama (tidak dilacak) | 62 MB | tidak (dibuat ulang oleh `prototypes/lib/render-node.mjs`) | **DIHAPUS 2026-11-20 (disetujui pemilik)**; 13 berkas terlacak di `prototypes/` dipakai `tools/fit-camera.mjs`, `serve.mjs`, `state-hash.mjs` dan `docs/report.md`: simpan |
| `references/` | 18 video kompetitor (2 folder) | 606 MB | `tools/compare.sh`, `style-evidence.ts --ref`; `docs/analysis.md` | simpan (sumber analisis, tidak bisa dibuat ulang); bila ruang sempit pindah ke disk luar |
| gambar docs | sudah dikompres (45,8 → 23,7 MB); 3 tangkapan layar identik di `docs/evidence/ux-v2/after/pane-*-768.jpg` + `videos-400-dark`/`videos-detail-400` (±0,25 MB) | 23,7 MB | `flows.json` menyebut namanya | simpan; hapus 3 salinan identik bila pemilik setuju |
| `data/backups/` | cadangan `videos.json`/`jobs.json` (rotasi 50 terbaru + harian 60 hari) | 116 MB | ya (`store.ts`, `job-store.ts` menulis dan memangkas sendiri) | simpan; hanya pangkas manual yang > 30 hari bila perlu ruang |
| `data/videos.pre-fourier.json`, `videos.pre-plasma.json` | titik kembali sebelum batch Plasma dan Fourier | 1,6 + 0,8 MB | tidak (dirujuk `docs/work-log.md`) | arsipkan; hapus setelah pemilik yakin batch benar |
| `data/schedule.json.bak` | cadangan otomatis rencana jadwal | 62 KB | ya (`schedule-plan.ts` membuatnya) | simpan (dibuat ulang bila dihapus) |
| `data/backup-pre-upload-2026-11-19/` | salinan `schedule.json` + `videos.json` sebelum unggah | 1,9 MB | tidak | simpan sampai unggahan lanjutan stabil, lalu hapus |
| `data/videos-ui-checks/` | folder kosong | 0 B | tidak | **DIHAPUS 2026-11-20 (disetujui pemilik)** |
| `Sim Studio.app`, `Buka Studio.command` | peluncur macOS pemilik | 0,7 MB | `location.txt` mencatat jalur proyek; `.command` memanggil `apps/server/server.ts` | simpan, tidak diubah |
| `output/` | hasil render: serah-terima Fourier 9,2 GB, video panjang ±6,1 GB, Shorts Photon/Plasma, 14 MP4 uji awal tanpa record (±105 MB) | 39 GB (193 GB bebas) | tidak (dibaca studio saat berjalan) | simpan dulu; setelah folder serah-terima diserahkan, hapus (bisa dibuat ulang `tools/handover-fourier.ts`, ±18 mnt); putuskan 14 MP4 uji |
| cache | `output/thumbs` 33 MB (cache galeri, dibuat ulang), `data/thumbnails` 323 MB (cover/thumbnail yang dipakai unggah) | 356 MB | ya | `output/thumbs` **DIHAPUS 2026-11-20 (disetujui pemilik; dibuat ulang otomatis oleh studio)**; `data/thumbnails` simpan |
| `.git` | riwayat; membesar 60 → 77 MB karena blob JPEG baru (blob PNG lama tetap di riwayat) | 74 MB | — | `git gc` sudah dijalankan (60 → 77 → 74 MB); memperkecil riwayat butuh filter-branch, tidak diusulkan |
| 11 ekspor tanpa pemakai | `dpow`, `segParam`, `simKeys`, `bankRoles`, `ROLES`, `ICON_NAMES`, `MODE_LABEL`/`MODE_HINT`, `closeStyleEditor`, `styleThumbs`, `FOURIER_CHANNEL`, `buildFourierPlan` (nol rujukan di apps/packages/tools/tests) | < 60 baris | tidak | hapus saat studio memang akan di-restart (sebagian di `apps/server/`, menjadikan studio `codeStale`); `dpow` bagian API matematika deterministik, simpan bila ragu |
| duplikat byte-identik | `branding/brands/{fourier-loom,tangent-loom}/…` (8 berkas: profil, watermark, 4 contoh, 2 svg) | ±0,4 MB | ya (dibangun ulang `build.mjs`/`pack.mjs`) | simpan |

## Evidence
- Baseline (sebelum perubahan): root 29 entri, 479 berkas dilacak (66,2 MB), `.git` 60 MB, 330 tes lulus 59,8 dtk, `tsc` 1,4 dtk. Sesudah: 29 entri (isi akar sama, hanya README/AGENTS/.gitignore/package.json berubah), 488 berkas (44,0 MB), 340 tes lulus ±57 dtk.
- Konvensi: `node --test tests/conventions.test.ts` 10 tes; 5 aturan terbukti gagal pada berkas pelanggaran sungguhan (`git add -N` sementara: nama berspasi, `.log`, 1,3 MB, tautan rusak, dokumen tak terdaftar), berkas contoh sudah dibuang.
- Pekerjaan studio/YouTube/batch sebelumnya diperiksa di studio uji port lain dengan salinan data; detailnya di `docs/work-log.md`.

## Next
Pemilik: putuskan baris Tahap 4 (satu per satu atau "semua yang aman"), slot failed Photon dan tugas 13:00, serah-terima folder Fourier ke teman, cek thumbnail `KYUpU2KtKUw`. Agen: eksekusi Tahap 4 hanya yang disetujui; render scene lain atas permintaan. Bila memakai ElevenLabs: pasang kunci API Sim Studio dan kalibrasi tarif dari ledger.

## Recent outcomes
- 2026-11-20: perapian ringan repo (docs/evidence, README/HANDOFF ringkas, konvensi + tes, dependensi tak terpakai).
- 2026-11-20: batch Fourier Loom 245 video + folder serah-terima; batch Plasma Pendulum 245 video (2026-11-20 04:10 jam catatan lama) — `docs/work-log.md`.
- 2026-11-19: dua channel di uploader, video panjang, kalender, navigasi Videos, kontras UI, ketahanan kerja A–E.
- 2026-11-18: guard kredit ElevenLabs (`98c9533`), batch 245 video Photon (`34abdf1`), preset style, antrean render tahan restart.
