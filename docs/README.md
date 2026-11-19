# Indeks dokumentasi

Satu halaman: tiap dokumen satu baris dan kapan dibaca. Cara pakai proyek: `../README.md`; status kerja: `../HANDOFF.md`; aturan penamaan dan tata letak: `conventions.md`.
Dokumen baru wajib ditambahkan di sini (diperiksa `tests/conventions.test.ts`). Satu topik satu dokumen.

## Panduan dan rujukan aktif
| Dokumen | Isi | Baca saat |
|---|---|---|
| [conventions.md](conventions.md) | penamaan, tata letak, berkas yang tidak dilacak, batas ukuran, cara memeriksa | menambah berkas, folder, atau dokumen |
| [operations.md](operations.md) | restart studio dengan aman (`dev`, `dev:watch`), aplikasi Mac, render dari terminal, tes | akan me-restart studio atau merender dari terminal |
| [videos.md](videos.md) | halaman Videos: teks, status, data lokal, angka dan filter per channel, pilih banyak | memakai atau mengubah halaman Videos |
| [publishing.md](publishing.md) | penulis judul/deskripsi/tag, pemeriksa kualitas, thumbnail dan cover, kalender, riset di baliknya | mengubah teks publikasi atau thumbnail |
| [youtube.md](youtube.md) | unggah ke YouTube (API resmi), dua channel, unggah manual, kuota | menghubungkan channel atau mengunggah |
| [youtube-upload-plan.md](youtube-upload-plan.md) | rencana unggah, fakta API yang dicek, langkah Google Cloud, rancangan per channel (§3b) | mengubah kode unggah atau soal kuota |
| [batches.md](batches.md) | batch render 245 video per channel (Photon Lab, Plasma Pendulum, Fourier Loom) | merender atau mengulang batch |
| [compile.md](compile.md) | video panjang 16:9 dari Shorts (Videos → Build long video) | membuat video panjang |
| [styles.md](styles.md) | sidik jari referensi, lima style, editor style, preset style, pengaturan latar, menambah style | mengubah atau menambah style |
| [architecture.md](architecture.md) | template hammer-smash/sync-lines, juice, suara, arsitektur paket, aturan render deterministik, menambah scene | menambah scene/varian atau menyentuh mesin |
| [ui-modes.md](ui-modes.md) | mode terang/gelap antarmuka, token warna, kontras WCAG | mengubah warna antarmuka |
| [sfx-credits.md](sfx-credits.md) | guard kredit ElevenLabs satu pintu, batas, ledger, aturan agen | sebelum menyentuh apa pun yang memakai kredit |

## Arsip (riwayat keputusan; jangan dipakai sebagai petunjuk kerja)
| Dokumen | Isi |
|---|---|
| [analysis.md](analysis.md) | Fase 1: analisis 18 video referensi (contact sheet di `evidence/reference-sheets/`) |
| [report.md](report.md) | Fase 2–3: laporan prototipe dan rancangan sistem; sumber angka/pengukuran awal (dirujuk komentar kode) |
| [ux-v2.md](ux-v2.md) | audit dan hasil UX v2 (tata letak responsif, ikon, token); bukti di `evidence/ux-v2/` |

## Gambar dan data bukti (`evidence/`)
Gambar dikompres (batas per berkas di `conventions.md`); jangan menaruh gambar di luar folder ini. Hanya berkas `.md` yang perlu didaftarkan.

| Folder | Isi |
|---|---|
| `evidence/reference-sheets/` | contact sheet 1 fps tiap video referensi (nama = id YouTube) |
| `evidence/compare/` | perbandingan prototipe vs referensi dan spektrogram audio |
| `evidence/styles/` | lembar scene × style, bukti style vs referensi; tabel ukur: [evidence/styles/audio-compare.md](evidence/styles/audio-compare.md), [evidence/styles/background-preview-vs-render.md](evidence/styles/background-preview-vs-render.md), [evidence/styles/focal-reflection-evidence.md](evidence/styles/focal-reflection-evidence.md) |
| `evidence/templates/` | lembar frame varian hammer-smash dan sync-lines |
| `evidence/publishing-examples/` | tiga contoh nyata teks + cover + thumbnail: [evidence/publishing-examples/README.md](evidence/publishing-examples/README.md) |
| `evidence/ui-modes/` | tangkapan layar mode terang/gelap |
| `evidence/ux-v1/` · `evidence/ux-v2/` | sebelum/sesudah dua putaran perbaikan UX (+ `metrics.json`, `flows.json`) |
| `evidence/videos/` | tangkapan halaman Videos |
| `evidence/bench/` | hasil benchmark render (`tools/bench.ts`, `tools/bench-compare.ts`) |
