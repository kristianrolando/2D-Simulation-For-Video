# Sim Studio

Studio web lokal untuk membuat simulasi fisika/matematika 2D, melihatnya langsung, lalu merendernya menjadi MP4 siap Shorts
(1080×1920, 60 fps, H.264 High, BT.709, AAC 44,1 kHz). Tampilan dan spesifikasinya mengikuti 18 Shorts referensi
(analisis: `docs/analysis.md`, `docs/report.md`). Teks di layar studio dan teks YouTube berbahasa Inggris (AS); dokumen proyek berbahasa Indonesia
(beberapa dokumen lama di `docs/` masih berbahasa Inggris dan tidak diterjemahkan ulang).

Dokumen ini = **cara pakai**. Status kerja saat ini ada di `HANDOFF.md`; semua rujukan ada di `docs/README.md`; aturan penamaan dan tata letak di `docs/conventions.md`.

## Isi
- [Mulai cepat](#mulai-cepat) · [Peta folder](#peta-folder) · [Perintah sehari-hari](#perintah-sehari-hari)
- [Scene](#scene) · [Style](#style) · [Videos dan YouTube](#videos-dan-youtube) · [Persyaratan](#persyaratan)

## Mulai cepat

```bash
npm install
npm run dev          # studio di http://127.0.0.1:5180
```

Studio terbuka di scene yang siap dengan style bawaan, jadi **Render MP4** (atau tombol **R**) langsung bisa dipakai.

- **Pick.** Galeri kiri menampilkan tiap scene dan preset sebagai thumbnail (dirender sekali oleh server, disimpan di `output/thumbs/`). Cari lewat nama/topik (`/` memfokuskan kotak, Enter membuka hasil pertama) atau chip kategori. Preset scene (paket pengaturan, hanya baca) muncul tepat setelah scene-nya (`↳ nama scene · scene preset`). `[` dan `]` berpindah di daftar.
- **Adjust.** Panel kanan punya dua tab. **Basic**: pengaturan utama scene dan enam kartu **Style** (thumbnail *scene ini* dalam style itu; tombol `1`–`6`). **Advanced**: latar, waktu, warna dan jejak, suara, efek (juice), "Reset scene options", dan pemeriksaan simulasi. Di bawah kartu style ada **Style presets** (lapisan tampilan tersimpan di atas style apa pun; lihat `docs/styles.md` §5). Pratinjau mengikuti tiap perubahan; Space atau ▶ memutar dengan suara; geser timeline untuk mencari. **Preview: Auto** menurunkan kualitas pratinjau bila frame lambat; render akhir selalu kualitas penuh.
- **Render.** Tombol **Render MP4** ada di sebelah kontrol pemutar. Strip status di bawah pratinjau menunjukkan antre, menyiapkan suara, merender (persen dan sisa waktu), menyelesaikan, lalu **Play**, **Show in folder**, **Texts & publish**. **All renders** memuat render terakhir termasuk dari sesi lama. Berkas masuk `output/` sebagai `<scene>-<layout>-<style>-<timestamp>.mp4` bersama `.job.json`. Kesalahan dijelaskan dengan kata biasa beserta langkah berikutnya.

Pintasan (tekan `?` di studio): Space putar/jeda, ←/→ frame (Shift: 1 dtk), `R` render, `V` videos, `/` cari, `[` `]` simulasi sebelumnya/berikutnya, `1`–`6` style, `M` suara, `D` statistik pratinjau (tersembunyi), `?` daftar.

**Style sendiri.** **＋ New style from this one** membuka editor di samping pratinjau (warna, huruf, garis, bola, tekstur). Simpan menulis `themes/<id>.json`, langsung bisa dipakai di semua scene; style bawaan tidak bisa ditimpa. Rincian: `docs/styles.md` §4.

**Thumbnail Shorts.** YouTube memotong thumbnail kustom Short ke 9:16 di tengah, jadi studio mengunggah gambar tegak **1080×1920** (`<id>-cover.jpg`), bukan 1280×720. Video lama yang terlanjur diunggah dengan gambar lebar ditandai di Videos; **Set the thumbnail again** memperbaikinya setelah persetujuan pemilik (50 unit kuota). Rincian: `docs/publishing.md`.

**Mode terang/gelap** (hanya antarmuka): tiga tombol di pojok kanan atas (Auto, Light, Dark). Video, MP4, thumbnail, dan style tidak terpengaruh; rincian `docs/ui-modes.md`.

**Tata letak.** Tiga kolom di layar lebar; di bawah 1100 px kolom pengaturan menjadi laci (tombol **Settings**, Esc menutup); di bawah 760 px satu panel sekaligus dengan bilah bawah (**Pick, Preview, Settings, Videos**). Rincian dan ukuran: `docs/ux-v2.md`.

**Klik ganda (macOS).** `Sim Studio.app` menyalakan server bila belum hidup, membuka studio, dan menaruh ikon di bilah menu; cadangannya `Buka Studio.command`. Rincian: `docs/operations.md`.

## Peta folder

Satu baris per entri di akar. Aturan tata letak: `docs/conventions.md`.

| Entri | Isi | Git |
|---|---|---|
| `apps/` | `server/` (server HTTP, worker render, YouTube, penyimpanan), `studio/` (antarmuka web), `mac/` (ikon bilah menu, pembuat `Sim Studio.app`) | ya |
| `packages/` | inti bersama: `core` (matematika deterministik), `render2d`, `audio`, `juice`, `theme`, `sim`, `scenes/<id>`, `publish`, `compile`, `sfx-guard` | ya |
| `tools/` | skrip bantu satu berkas per tugas (batch, jadwal, analisis, utilitas); daftar: `tools/README.md` | ya |
| `tests/` | tes `node --test` (`tests/<topik>.test.ts`) dan `golden-state.json` | ya |
| `presets/` | preset scene: paket pengaturan scene (JSON), dikirim bersama studio | ya |
| `style-presets/` | preset style: lapisan latar + warna + huruf yang disimpan dari studio | ya |
| `themes/` | satu JSON per style tambahan (riso, chalk, terminal, candy, blueprint; `classic` ada di kode) | ya |
| `assets/` | `fonts/` (DejaVu), `sfx/` (pustaka suara, manifest, ledger, sampel asli di `src/`) | ya |
| `branding/` | kit identitas channel (Photon Lab `brand.json`, `brands/*`) dan pembangun gambarnya: `branding/README.md` | ya |
| `docs/` | rujukan; indeks `docs/README.md`; gambar bukti di `docs/evidence/` | ya |
| `prototypes/` | prototipe Fase 2 (disimpan sebagai rujukan, dipakai `docs/report.md`); `prototypes/output/` tidak dilacak | sebagian |
| `data/` | catatan pribadi pemilik: daftar video, antrean render, jadwal, batch, cadangan, thumbnail (`SIM_DATA_DIR` memindahkannya) | tidak |
| `output/` | hasil render (MP4, `.job.json`, cache thumbnail, video panjang, paket serah-terima) | tidak |
| `references/` | video kompetitor untuk dipelajari saja; tidak diubah | tidak |
| `work/` | kertas coretan analisis/bench lokal | tidak |
| `node_modules/` | dependensi (`npm install`) | tidak |
| `Sim Studio.app`, `Buka Studio.command` | peluncur macOS (lokasi proyek dicatat di `Contents/Resources/location.txt`) | ya |
| `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md` | aturan agen (termasuk kredit ElevenLabs), penunjuk ke AGENTS, status kerja | ya |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.claude/` | konfigurasi | ya |

## Perintah sehari-hari

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Studio untuk kerja normal (render, unggah). Restart hanya oleh Anda. |
| `npm run dev:watch` | Studio yang restart sendiri saat berkas server berubah; jangan dipakai saat ada render atau unggahan. |
| `node tools/state.ts` | Keadaan nyata (hanya baca): git, studio, antrean, batch, disk, header handoff. |
| `npm run render -- <scene> --params '{…}'` | Render dari terminal (`--preset`, `--out`, `--hash`). |
| `npm test` · `npm run typecheck` | Tes penuh dan pemeriksaan tipe. |
| `node --test tests/conventions.test.ts` | Hanya tes konvensi (nama, tautan, ukuran; kurang dari 1 dtk). |
| `npm run batch:run` · `npm run schedule:plan` | Batch render dan rencana jadwal unggah (`docs/batches.md`, `docs/youtube.md`). |

Restart studio dengan aman, aplikasi Mac, perintah render, dan tes: `docs/operations.md`.

## Scene

| Scene | Kategori | Yang ditampilkan | Pemeriksaan akurasi (`npm test`) |
|---|---|---|---|
| `focal-reflection` (layout: ellipse, peanut, parabola, corner, cassegrain, gregorian) | Mirrors | gelombang bola memantul di cermin kerucut menuju satu fokus | meleset < 1e-9 px, sebaran tiba < 1e-9 dtk, 0 bola hilang |
| `rosette-orbit` | Orbits | orbit berpresesi yang menutup setelah 360/presesi putaran | RK4 vs bentuk tertutup, penutupan < 1e-6 px |
| `resonance-orbits` | Orbits | seni benang resonansi p:q, (p−q) kelopak | pola menutup < 1e-9 px |
| `pendulum-wave` | Oscillation | bandul menyebar lalu sejajar lagi (3D) | penyejajaran ulang < 1e-8° |
| `harmonograph` | Oscillation | dua pasang bandul teredam menggambar bentuk yang meluruh | bentuk tertutup |
| `galton-board` | Chance | pantulan acak menumpuk menjadi kurva lonceng | bin vs Binomial(R,p): χ² dan rerata |
| `gravity-bounce` | Chaos | bola berjarak 10⁻⁹ px di bawah gravitasi menyimpang (efek kupu-kupu) | drift energi < 1e-10, kontak di dinding |
| `billiard` (circle, triangle, square) | Geometry | apakah lintasan satu bola menutup? | rasional menutup (2/7 → 7, 5:3 → 16), 1/φ² tidak pernah |
| `hammer-smash` (aturan: split, box, survive · wadah: octagon, circle, square, triangle, ring) | Smash | palu keluar dari dinding dan menghancurkan bola; jumlah meledak sampai wadah pecah, lalu video memutar balik dan mengulang | seed sama = jalan sama (browser = Node, bit demi bit), jumlah mengikuti aturan, bola tetap di dalam |
| `sync-lines` (mode: orbits, lid, slider, close) | Sync | ritme berbeda yang sejajar lagi, mengenai tutup bersamaan, menyembunyikan bentuk di bawah garis baru, atau menggambar garis yang tak pernah menutup | semuanya kembali ke awal pada saat yang dijanjikan; pecahan menutup setelah q putaran, π tidak pernah |

Dua template parametrik (hammer smash dan sync & close: seed, hook, varian) dan cara menambah scene/varian: `docs/architecture.md`.

## Style

Style menentukan bagaimana video **tampil, bergerak, dan berbunyi**: warna, tekstur latar, bentuk garis dan bola, tipografi, masuknya judul, animasi penghitung, profil juice, palet suara. Style tidak menyentuh simulasi: scene merender fisika yang persis sama di semua style (`tests/theme.test.ts` memeriksa hash state).

| Style | Konsep | Cocok untuk |
|---|---|---|
| `classic` Classic Neon | tampilan asli, dekat dengan video referensi (dipertahankan demi kompatibilitas) | — |
| `riso` Riso Print | poster risograph: tinta spot bertumpuk di kertas hangat, salah-registrasi, huruf kapital sempit | peluang, statistik, sains populer |
| `chalk` Chalkboard | kapur pastel di papan hijau kotor, judul tulisan tangan, tenang | penjelasan langkah demi langkah |
| `terminal` Amber Terminal | CRT amber: scanline, blok piksel, prompt ketik, chiptune | algoritma, kekacauan, menghitung |
| `candy` Candy Pop | stiker kartun di sunburst ungu, pantulan elastis, konfeti | ringan, anak-anak, reaksi |
| `blueprint` Blueprint | gambar teknik: garis ganda, garis tengah, grid, blok judul | geometri, optika, mekanika |

```bash
npm run render -- galton-board --params '{"style":"riso"}'
node tools/style-sheet.ts galton-board --at 0.6      # bandingkan semua style pada satu frame
```

**Style preset** (lapisan tampilan: latar, warna, huruf) dipasang di atas style apa pun pada scene apa pun; tab Basic, di bawah kartu style. Disimpan di `style-presets/<id>.json` dan disalin ke parameter scene `stylePreset`, sehingga pratinjau, MP4, thumbnail, dan cover mengikutinya. Tanpa preset semuanya dirender persis seperti sebelumnya. Rincian, pengaturan latar per style, dan cara menambah style: `docs/styles.md`.

## Videos dan YouTube

Tiap render menjadi entri di **Videos** (tombol `V`): lima judul usulan, deskripsi, tag, tiga hashtag, pemeriksa kualitas, cover 1080×1920 dan thumbnail 1280×720 otomatis, status Draft → Rendered → Scheduled → Published, kalender, CSV. Jalur cepat: **Render MP4** → **Texts & publish** → **Copy title, description and tags** → unggah → **Published** → tempel tautan.

- Halaman Videos, angka dan filter per channel, pilih banyak, video panjang (16:9): `docs/videos.md`; rincian video panjang: `docs/compile.md`.
- Teks dan thumbnail (aturan, batas YouTube, riset): `docs/publishing.md`.
- Unggah ke YouTube (API resmi, privat dulu), dua channel, unggah manual, kuota: `docs/youtube.md` dan `docs/youtube-upload-plan.md`.
- Batch render per channel (245 video): `docs/batches.md`.
- Kredit ElevenLabs hanya lewat guard: `docs/sfx-credits.md`.
- Data lokal di `data/` (tidak di git); daftar video ditulis atomik dengan cadangan: `docs/videos.md`.

## Persyaratan

Node ≥ 23.6 (menjalankan TypeScript langsung) dan `ffmpeg` dengan libx264 di `PATH`.
