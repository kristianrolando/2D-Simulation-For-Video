# UX v2: audit, rencana, dan hasil

Tahap 1 (audit dan rencana) disetujui penuh (U1–U7). Hasil Tahap 2 ada di bagian 8 di bawah. Koreksi atas audit awal: kontras teks sebenarnya sudah dijaga `tests/mode.test.ts` (WCAG AA, kedua mode); ukuran huruf di bagian 3 dihitung dengan skrip lain (11), skrip ukur yang dipakai di Tahap 2 hanya menghitung elemen yang tampak (9 sebelum, 6 sesudah).

Tanggal audit: 2026-11-18. Sumber banding: kode `studio/ui/*`, `catatan/RENCANA-UI.md`, bagian UI di `CLAUDE.md` pada `/Users/aldo/Animation-Claude-Video-V2`, dan satu tampilan nyata di `localhost:4820` (hanya dilihat, tanpa klik). Hanya **prinsipnya** yang diambil. Nama, ikon, palet, dan istilah khas contoh tidak dipakai.

Angka Sim Studio diukur di browser pane pada studio yang berjalan (port 5180, data nyata: 17 video, 34 kartu simulasi). Lebar 1440×900, 1280×720, dan 400×860.

## 1. Perbandingan singkat

| Hal | Contoh (prinsip yang dipelajari) | Sim Studio sekarang |
|---|---|---|
| Layar pertama | Status semua pekerjaan dulu (jumlah per status, "perlu tindakan"), pembuatan baru dibuka lewat satu tombol | Langsung ke tugas membuat: galeri, pratinjau, pengaturan. Status video hanya di halaman Videos |
| Navigasi | Satu tempat: kepala atas; menu ganda dibuang; di layar sempit pindah ke bilah bawah berlabel | Satu tempat (tombol Studio/Videos di kolom kiri). Di layar sempit tidak ada pengganti: halaman melebar |
| Status | Lencana = ikon + teks + warna (tiga pembeda); keadaan kerja berupa banner berwarna dengan tombol | Strip render di bawah pratinjau sudah jelas. Di daftar Videos status hanya titik berwarna |
| Ikon | Satu set garis, tanpa emoji | 11 emoji/simbol campur (🔊, ✨, ▶, ⚙, …) |
| Skala visual | Token: 6 ukuran huruf, 3 radius, jarak 4–48 | 11 ukuran huruf berbeda (10 sampai 18 px) di satu layar |
| Teks panjang | Dilipat atau diringkas, diingat | Bagian pengaturan sudah dilipat (baik). Detail Videos 618 kata, 124 kontrol dalam satu kolom |
| Empty state | Menawarkan langkah berikut | Videos kosong-pilihan: "Pick a video on the left…" tanpa tindakan |
| Tema | Terang/gelap/otomatis | Sudah ada dan baik (terang/gelap/otomatis, tanpa kedip) |
| Keyboard | Fokus terkunci di modal, Esc menutup | Sudah kuat: Spasi, R, V, /, [ ], 1–6, M, D, ?, panah; dialog bantuan |

## 2. Yang sudah baik (tidak boleh rusak)

- **Satu klik sampai render:** studio terbuka di simulasi terakhir (`studio.last`) dan tombol **Render MP4 (R)** terlihat tanpa scroll di 1280×720 (puncak tombol di y=622 dari 720).
- Mode terang/gelap/otomatis, diterapkan sebelum cat pertama.
- Strip render: tahap, progres, kecepatan, Play, tampilkan di folder, "Texts & publish", riwayat; pesan galat berbentuk "apa yang terjadi + apa yang dilakukan".
- Pencarian `/`, filter kategori, `[` `]` ganti simulasi, 1–6 ganti gaya, bantuan `?`.
- Pengaturan Basic/Advanced dan bagian yang dilipat; deterministik (seed + tombol acak).
- Videos: filter status, ekspor CSV/JSON, saran teks, peringatan batas YouTube, persetujuan unggah per video.
- Muat cepat: DOMContentLoaded 66 ms, load 102 ms (lokal).

## 3. Temuan, berurutan menurut dampak

Baseline diukur sendiri (tanda ✔ = terukur di browser).

| # | Temuan | Dampak | Bukti |
|---|---|---|---|
| 1 | **Layar sempit rusak.** Di 400 px halaman melebar jadi 550 px (scroll horizontal), kolom detail Videos menyempit ±70 px sehingga tak terbaca, strip render saling tumpang ("Show in folder / Texts & publish / All renders" menumpuk) | Tinggi: tidak bisa dipakai di jendela kecil atau layar ponsel/tablet | ✔ `scrollWidth 550 > innerWidth 400`; screenshot Studio dan Videos 400×860 |
| 2 | **Videos tidak memberi tahu apa yang perlu dilakukan.** Status hanya titik berwarna (warna saja sebagai pembeda); tidak ada kelompok "perlu tindakan" (sudah dirender tapi belum dijadwalkan, unggah gagal/terhenti); lencana angka di tombol Videos ("16") tidak dijelaskan; panel kanan kosong saat pertama dibuka | Tinggi: tugas "apa berikutnya" butuh membaca 17 baris | ✔ screenshot; 17 baris, 0 teks status per baris |
| 3 | **Dua kesalahan nyata terlihat di Videos.** (a) Kolom "Text on the thumbnail" menampilkan harfiah `undefined`; (b) `POST /api/videos/:id/cover` menjawab 404 dan konsol memuat 1 galat. Penyebab paling mungkin: server yang berjalan lebih tua dari kode di disk (API-nya tidak mengirim `coverText`, rute `/cover` belum ada di proses itu), dan UI tidak tahan field yang hilang (`value: v.coverText`). Studio tidak memberi tanda bahwa servernya perlu dimulai ulang | Sedang: membingungkan dan tampak rusak | ✔ `/api/videos` tanpa `coverText`; log jaringan |
| 4 | **Ikon dan simbol tidak konsisten.** 11 emoji/simbol di layar studio, tampilannya bergantung font sistem dan tidak bisa mengikuti warna tema | Sedang | ✔ 11 emoji (`\p{Extended_Pictographic}`) |
| 5 | **Skala huruf berlebih.** 11 ukuran berbeda (10, 10,5, 10,83, 11, 11,5, 12, 13, 15, 15,21, 16, 18 px); teks 10–11 px untuk keterangan | Sedang: terasa tidak rapi dan sulit dibaca di layar kecil | ✔ |
| 6 | **Progres render tak terlihat dari tab lain.** Judul tab tetap "Sim Studio"; render sering berjalan lama sementara pengguna di tab lain | Sedang | kode: `<title>` statis |
| 7 | **Detail Videos terlalu panjang dalam satu kolom.** 618 kata dan 124 kontrol (video, thumbnail, YouTube, tiga teks, saran) tanpa bagian yang dilipat | Sedang | ✔ |
| 8 | **Galeri 34 kartu dalam kolom ±220 px**, dua kartu per baris; gambar kartu tinggi, jadi hanya ±4 simulasi terlihat tanpa scroll. Pencarian dan filter sudah membantu | Rendah–sedang | ✔ screenshot 1280×720 |
| 9 | **Videos tidak bisa dioperasikan dengan keyboard saja** (daftar tidak dapat dinavigasi dengan panah; tidak ada Esc untuk kembali ke Studio dari daftar) | Rendah–sedang | kode `ux.ts`: `V` saja |
| 10 | **Kontras dan target sentuh belum diaudit** di kedua tema | Tidak diketahui | belum diukur; dimasukkan ke verifikasi |

## 4. Usulan perubahan

Hanya yang bernilai. Tidak ada fitur baru yang bukan perbaikan navigasi/kejelasan. Urutan = urutan pengerjaan.

### U1. Tata letak responsif (temuan 1)
- **Masalah:** di bawah ±900 px halaman melebar dan kolom saling menindih.
- **Perubahan:** ≤1100 px kolom kanan (pengaturan) menjadi laci di bawah pratinjau; ≤760 px satu kolom dengan bilah bawah berlabel **Pilih · Pratinjau · Atur · Videos**; strip render membungkus rapi (tombol turun ke baris kedua, tidak menumpuk). Videos ≤900 px: daftar lalu detail sebagai dua layar (tombol kembali), bukan dua kolom. Desktop tidak berubah.
- **Ukuran berhasil:** `scrollWidth == innerWidth` di 400, 768, 1024, 1280, 1440; 0 kontrol di luar layar; tombol Render terjangkau (dalam 1 scroll) di 400×860; screenshot sebelum/sesudah tiap lebar.

### U2. Videos: "apa berikutnya" lebih dulu (temuan 2, 7, 9)
- **Masalah:** status hanya titik; tidak ada ringkasan tindakan; panel kosong; detail panjang.
- **Perubahan:**
  1. Setiap baris: lencana status = ikon + teks + warna (Draft, Rendered, Scheduled, Published) dan keadaan unggah (mengunggah, gagal, terhenti) sebagai lencana tersendiri.
  2. Satu baris ringkasan di atas daftar: "3 siap dijadwalkan · 1 unggah gagal", tiap bagian = filter satu klik. Data sudah ada (`status`, `youtube`).
  3. Panel kanan terbuka otomatis di video pertama yang butuh tindakan (atau yang terakhir dibuka); bila daftar kosong, empty state dengan satu tombol "Buat video di Studio".
  4. Detail dibagi dalam bagian yang dilipat dan diingat: Thumbnail, Teks YouTube, Unggah. Bagian yang belum selesai terbuka bawaan.
  5. Lencana angka di tombol Videos diberi tooltip dan label ("16 siap dijadwalkan").
  6. Daftar dapat dioperasikan dengan ↑/↓ + Enter, `Esc` kembali ke Studio.
- **Ukuran berhasil:** klik dari membuka studio ke video yang butuh tindakan: 2 (Videos + baris) → 1 (Videos; terbuka otomatis); baris dengan teks status: 0 → 100%; tinggi detail awal (kata terlihat tanpa scroll): 618 → ≤ 250; seluruh daftar Videos dapat dijalankan tanpa mouse.

### U3. Perbaikan kesalahan dan tanda server lama (temuan 3)
- **Masalah:** `undefined` dan 404 di Videos.
- **Perubahan:** UI memakai nilai bawaan untuk field yang hilang (`coverText ?? ''`); respons video selalu menyertakan semua field (normalisasi sisi server sudah ada di `packages/publish`, periksa jalurnya); `/api/status` menyertakan stempel waktu berkas server dan studio menampilkan satu baris tenang "Server memakai kode lama: mulai ulang" bila berkas di disk lebih baru (tanpa menghentikan render yang berjalan).
- **Ukuran berhasil:** 0 galat di konsol saat membuka Videos dan memilih video; tidak ada kata `undefined` di UI (uji otomatis memindai teks); uji unit untuk field hilang.

### U4. Satu set ikon garis, tanpa emoji (temuan 4)
- **Masalah:** 11 emoji/simbol campur.
- **Perubahan:** berkas `apps/studio/icons.ts` kecil (±15 ikon SVG inline: suara, putar, folder, salin, tautan, kalender, centang, peringatan, pengaturan, kembali, cari, unggah, jam, acak, bantuan), `stroke=currentColor`, selalu bersama label atau `aria-label`. Gaya video (nama tema di `themes/`) tidak diubah; hanya antarmuka.
- **Ukuran berhasil:** emoji di antarmuka 11 → 0; ukuran berkas ikon ≤ 6 KB; ikon mengikuti warna di terang dan gelap.

### U5. Skala visual bertoken (temuan 5, 10)
- **Masalah:** 11 ukuran huruf, radius dan jarak tersebar.
- **Perubahan:** token di `style.css`: huruf 11/12/13/15/18/24 (min. 11 px), radius 6/10/14, jarak 4/8/12/16/24; warna tetap memakai variabel tema yang ada (palet tidak diubah). Audit kontras terang/gelap; perbaiki hanya yang di bawah 4,5:1. Target sentuh tombol utama ≥ 40 px di layar sempit.
- **Ukuran berhasil:** ukuran huruf berbeda di layar studio 11 → ≤ 6; semua teks ≥ 4,5:1 (diukur skrip di kedua tema); tak ada teks < 11 px.

### U6. Progres di judul tab (temuan 6)
- **Masalah:** progres render tak terlihat dari tab lain.
- **Perubahan:** `document.title` = "Render 42% · Sim Studio" saat berjalan, "Selesai · Sim Studio" sesaat setelahnya, lalu kembali ke "Sim Studio". Tanpa notifikasi sistem, tanpa izin baru.
- **Ukuran berhasil:** judul berubah selama render dan kembali normal; uji dengan SSE tiruan.

### U7. Galeri lebih padat (temuan 8)
- **Masalah:** ±4 simulasi terlihat tanpa scroll.
- **Perubahan:** kartu galeri lebih rendah (gambar 16:10 di dalam kartu, nama satu baris), tetap dua kolom; jumlah kartu terlihat ditulis di judul ("Simulations · 34"). Pilihan simulasi tetap satu klik.
- **Ukuran berhasil:** kartu terlihat tanpa scroll di 1280×720: ±4 → ≥ 6; klik memilih simulasi tetap 1.

## 5. Ukuran berhasil gabungan (sebelum → target)

| Ukuran | Sebelum | Target |
|---|---|---|
| Klik dari membuka studio sampai render dimulai (simulasi terakhir) | 1 (R) | 1 (tidak boleh naik) |
| Klik memilih simulasi + gaya lalu render | 3 | 3 |
| Klik dari render selesai ke teks publikasi | 1 | 1 |
| Klik ke video Videos yang butuh tindakan | 2 | 1 |
| Scroll horizontal di 400/768/1024 px | ada di 400 | 0 di semua |
| Emoji di antarmuka | 11 | 0 |
| Ukuran huruf berbeda (studio) | 11 | ≤ 6 |
| Galat konsol saat membuka Videos | 1 | 0 |
| Waktu muat (DOMContentLoaded / load) | 66 / 102 ms | tidak lebih dari +10% |
| Berkas tambahan di jalur muat | – | ≤ 8 KB kode baru, 0 dependensi |
| Semua tes | 146 lulus | 146+ lulus, `tsc` bersih |

## 6. Yang sengaja tidak diusulkan

- Beranda status terpisah, analytics, chart, atau halaman Pengaturan baru: Sim Studio tidak membutuhkannya; Videos sudah menjadi pusat status.
- Mengganti tema, palet, atau gaya video (`themes/`), mesin render, scene, atau data Videos.
- Menjalankan render dari daftar Videos, atau fitur unggah baru.
- Dependensi UI (framework, pustaka ikon, pustaka chart).

## 7. Batas audit ini

- FPS preview tidak dinilai (browser pane membatasi `requestAnimationFrame`).
- Dugaan penyebab temuan 3 (server lebih lama dari disk) belum dikonfirmasi dengan memulai ulang server; itu menunggu persetujuan karena menyentuh proses yang berjalan.
- Kontras dan target sentuh belum diukur (temuan 10).
- Studio contoh dilihat satu layar (beranda, tema gelap); halaman filmnya dipelajari dari kode dan rencana, bukan dari tampilan.
- Tangkapan layar studio contoh memuat akun milik pemilik; tidak disalin ke dokumen ini.

## 8. Hasil Tahap 2 (2026-11-18)

Cara ukur: Chrome headless pribadi (profil sementara, tidak menyentuh Chrome Anda) lewat `work/cdp.mjs`, `work/shots.mjs`, `work/flows.mjs`; studio uji di port lain dengan salinan data (dihapus sesudahnya, data asli tidak ditulis). Bukti gambar: `docs/ux-v2/before/` dan `docs/ux-v2/after/` (studio dan Videos, terang dan gelap, 1440×900, 1280×720, 400×860, plus laci 1024, panel 400/768, daftar→detail Videos). Angka mentah: `before/metrics.json`, `after/metrics.json`, `after/flows.json`.

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Lebar halaman di jendela 400 px | 550 px (scroll horizontal) | 400 px, tanpa scroll horizontal di 400/768/1024/1280/1440 |
| Kontrol di luar layar di Videos 400 px | 18 | 0 |
| Emoji/simbol gambar di antarmuka studio | 11 | 0 (tersisa 2–3 di teks saran judul, itu isi tulisan YouTube) |
| Ukuran huruf berbeda yang tampak (studio / Videos) | 9 / 9 | 6 / 5 |
| Galat konsol (studio dan Videos, jendela baru) | 2 (`favicon.ico` 404, `/cover` 404) | 0 pada server baru. Di server lama tersisa 1 (`/cover` 404, lihat bawah) |
| Kata `undefined` di Videos | ada | tidak ada (diperiksa juga pada server lama di 5180) |
| Klik ke video yang perlu tindakan | 2 | 1 (Videos); terbuka otomatis |
| Baris Videos dengan teks status | 0 dari 17 | semua (lencana ikon + teks + warna) |
| Kata terlihat di detail Videos tanpa scroll (1280×720) | ±300 (satu kolom panjang) | ±160 (bagian dilipat, hanya yang dibutuhkan terbuka) |
| Kartu simulasi terlihat tanpa scroll (1280×720) | 4 | 6 |
| Klik dari studio sampai teks publikasi | 4 (kartu, gaya, Render, Texts & publish) | 4 (tidak naik) |
| Klik mulai render dari simulasi terakhir | 1 (R) | 1 |
| Judul tab saat render | tetap "Sim Studio" | "Render 42% · Sim Studio" lalu kembali; diuji pada render nyata 4 detik |
| Waktu muat | DOMContentLoaded 66 ms, load 102 ms | tidak diukur ulang di studio sibuk; kode baru ±17 KB sumber secara total (`icons.ts` 4,5 KB), 0 dependensi |
| Tes | 146 lulus | 149 lulus; `tsc` bersih |

Yang berubah, per usulan:

- **U1 responsif.** ≤1100 px pengaturan menjadi laci (tombol Settings di atas, tutup dengan klik di luar atau Esc); ≤760 px satu panel dengan bilah bawah berlabel (Pick · Preview · Settings · Videos); memilih simulasi di layar sempit langsung menampilkan pratinjau; strip render membungkus rapi. Videos ≤900 px: daftar lalu detail dengan tombol "All videos". Desktop tidak berubah selain rincian di bawah.
- **U2 Videos.** Lencana status (ikon + teks + warna) dan lencana unggah (Uploading / Upload failed) di tiap baris; baris "Needs you" dengan filter satu klik; video yang perlu tindakan terbuka otomatis (tanpa membuat thumbnail di belakang layar); bagian Video & thumbnail, Texts, Notes dapat dilipat (terbuka sesuai kebutuhan, diingat setelah Anda mengkliknya); panah ↑/↓, Home/End dan satu perhentian Tab untuk daftar; Esc kembali ke Studio; tooltip lencana angka.
- **U3 kesalahan.** Bidang yang hilang dari server lama diisi kosong; ikon tab (favicon) ditambahkan; `/api/status` memuat `codeStale` dan studio menampilkan satu baris peringatan bila berkas server di disk lebih baru dari server yang berjalan.
- **U4 ikon.** `apps/studio/icons.ts`: 25 ikon garis (termasuk satu per gaya video; gaya yang tidak dikenal memakai ikonnya sendiri). `themes/` tidak disentuh.
- **U5 skala.** Token ukuran huruf (11/12/13/15/18/24), radius (6/10/14) dan jarak di `style.css`; semua `font-size` dan `border-radius` memakai token. Jarak baru dipakai di aturan baru (belum semua aturan lama). Tes kontras diperluas untuk lencana baru: terendah 4,58:1 (gelap) dan 4,66:1 (terang).
- **U6 judul tab.** Progres render di judul tab.
- **U7 galeri.** Kartu lebih rendah (gambar 4:3, nama dan keluarga satu baris dengan tooltip nama lengkap), judul "Simulations · 34".

## 9. Belum terverifikasi dan catatan

- **Server di port 5180 masih kode lama.** Bagian klien baru sudah terpakai (Vite), tetapi server itu dimulai sebelum perbaikan: ia belum punya `codeStale`, jadi peringatan "mulai ulang" belum bisa muncul di sana, dan satu galat 404 `/cover` tersisa saat memilih video tanpa thumbnail. Itu hilang setelah server dimulai ulang (belum saya lakukan, karena itu proses Anda: tutup lalu buka lagi Sim Studio.app, atau `pkill -f apps/server/server.ts`).
- Layar sentuh sungguhan, Safari/Firefox, dan ponsel fisik tidak diuji (hanya Chrome headless dengan lebar dan agen emulasi).
- FPS preview tidak dinilai.
- Waktu muat tidak dibandingkan angka demi angka setelah perubahan.
- Daftar alat uji (`work/*.mjs`) bukan bagian studio; boleh dihapus.
