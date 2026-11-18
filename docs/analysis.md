# Fase 1 — Analisis 18 video referensi

Sumber: `references/*.mp4` (tidak diubah). Alat: `ffprobe`, `ffmpeg` (contact sheet 1 fps, frame resolusi penuh di momen kunci, strip 6 frame berurutan pada 60 fps, sampling piksel, spectrogram/waveform, `ebur128`, `silencedetect`).
Contact sheet 1 fps tiap video ada di `docs/assets/sheets/<id>.png` (satu petak = 1 detik, baris dibaca kiri→kanan).

Singkatan ID dipakai di seluruh dokumen (ID YouTube di nama file).

---

## 1. Spesifikasi teknis (ffprobe)

Semua 18 video **identik secara format**:

| Properti | Nilai |
|---|---|
| Container | MP4 |
| Video | H.264 High, 1080×1920 (9:16), **60 fps konstan**, yuv420p, BT.709 (primaries + transfer) |
| Audio | AAC-LC, 44.1 kHz, stereo, ~128 kb/s |
| Bitrate video | 0,64–4,39 Mb/s (rendah untuk konten gelap/sederhana, tinggi untuk konten padat partikel) |

| ID | Judul (hook) | Durasi (s) | Video kb/s | Loudness terintegrasi (LUFS) | LRA |
|---|---|---|---|---|---|
| fIoOtZUVeqA | Can a shape with finite area have an infinite edge? | 24.38 | 871 | −18.9 | 14.8 |
| LII8nLzHgeQ | Can two mirrors catch them all? | 30.77 | 2085 | −20.3 | 8.7 |
| i8uPaD_1i00 | Does it work in 3D too? | 31.67 | 3834 | −20.5 | 9.8 |
| iWMn2yrUdIc | How big is our solar system? | 37.55 | 4385 | −15.3 | 4.9 |
| S268JnlAr00 | How many times will they meet? | 30.72 | 2357 | −20.3 | 7.6 |
| C0wirX5ZOdE | The perfect chain reaction | 20.64 | 637 | −23.9 | 4.0 |
| RRXtPoO1XkU | What do 13 : 8 orbits draw? | 30.65 | 1839 | −12.6 | 23.4 |
| X02KQYS_1aw | What is a rosette orbit? | 31.56 | 1501 | −14.2 | 7.9 |
| HFfvFmCxVcA | Where will they all end up? | 32.07 | 1674 | −20.6 | 9.8 |
| _6HvCnCJL-g | Will every ball score? | 30.42 | 2038 | −19.3 | 7.4 |
| 7FCMlA_knNU | Will they all arrive at once? | 31.83 | 1672 | −21.3 | 9.0 |
| pCOT1kPsDag | Will they all come back to me? | 31.67 | 1096 | −21.7 | 7.4 |
| GqlNSVjcn0g | Will they all hit the same point? (peanut) | 31.67 | 2050 | −20.9 | 7.0 |
| pK5TgMQsWRQ | Will they all hit the same point? (ellipse) | 31.67 | 2213 | −19.8 | 8.8 |
| RamGZYVfBw8 | Will they line up again? | 25.05 | 4357 | −16.6 | 5.7 |
| nAlioVXEqbg | Will they still meet if I stretch it? | 33.55 | 1281 | −20.0 | 5.3 |
| wfiLDIhw50s | Will this path ever close? | 33.16 | 1037 | −21.7 | 4.3 |
| gNxrvmhgAw8 | Will this pattern ever close? | 31.14 | 1799 | −21.6 | 6.2 |

Kesimpulan spesifikasi target output: **1080×1920, 60 fps, H.264 High yuv420p BT.709, AAC 44.1 kHz stereo**, durasi 20–38 s (modus ≈ 31 s). Loudness tidak dinormalisasi (−12.6 s/d −23.9 LUFS); median ≈ −20 LUFS.

---

## 2. Pengelompokan berdasarkan jenis simulasi dan mekanismenya

### A. Pantulan pada cermin konik — "banyak bola, satu titik" (10 video, keluarga terbesar)

Mekanisme bersama: partikel titik bergerak lurus dengan kecepatan konstan, memantul elastis (sudut datang = sudut pantul, `v' = v − 2(v·n)n`) pada kurva/permukaan konik. Sifat fokus konik menjamin semua lintasan bertemu di satu titik. Jumlah bola bertambah bertahap (deret Fibonacci atau mirip), lintasan meninggalkan jejak garis tipis yang menumpuk menjadi "kipas pelangi".

| ID | Geometri | Sifat matematis yang dipamerkan |
|---|---|---|
| pK5TgMQsWRQ | Elips vertikal (b/a ≈ 0.685), 2 fokus | Garis dari fokus F₁ memantul ke F₂; panjang F₁→dinding→F₂ = 2a konstan ⇒ semua bola yang lepas bersamaan **tiba bersamaan** (front gelombang berbentuk busur). Jumlah: 1,2,3,5,…,377 (Fibonacci). Tiap kali gelombang tiba di fokus, bola baru ditambahkan. |
| GqlNSVjcn0g | "Kacang": dua busur elips yang berbagi fokus tengah (3 fokus segaris) | Bola dari fokus atas → dinding atas → fokus tengah → dinding bawah → fokus bawah. Jumlah 2,4,6,10,16,26,…,288 (2×Fibonacci). |
| HFfvFmCxVcA | Elips | Lintasan yang melewati fokus berulang-ulang konvergen ke **sumbu mayor** (titik tetap atraktif dari peta billiard elips). Jumlah 1,2,4,7,12,20,33,54,88,143,232 (= Fibonacci−1). Akhir: "All 232 on one line!". |
| i8uPaD_1i00 | **Ellipsoid 3D** (spheroid prolate) diproyeksikan ke 2D dengan grid lintang/bujur | Sifat fokus di 3D; arah awal tersebar merata di bola (dugaan: spiral Fibonacci/golden angle — belum diverifikasi). Jumlah sampai 610. Menunjukkan sistem perlu proyeksi 3D sederhana. |
| nAlioVXEqbg | Lingkaran yang **diregangkan** menjadi elips (parameter eksentrisitas dianimasikan) | Lingkaran = elips dengan 2 fokus berimpit di pusat; saat diregangkan, fokus memisah dan sifat tetap berlaku. Tanpa counter. Menunjukkan parameter geometri berubah selama video. |
| LII8nLzHgeQ | Cermin primer **parabola** berlubang + sekunder **hiperbola** cembung (teleskop Cassegrain) | Bola jatuh vertikal (sinar sejajar sumbu) → parabola → hiperbola → lewat lubang ke fokus bersama. Jumlah 1,2,3,4,6,8,10,13,16,20,24,29,34,40,46,52. |
| S268JnlAr00 | Parabola berlubang + sekunder **elips** cekung (Gregorian) | Sinar bersilangan di fokus primer sebelum sekunder, lalu bertemu lagi di fokus akhir ⇒ "Twice!". Jumlah sama dengan LII8. |
| 7FCMlA_knNU | **Parabola** | Bola jatuh dari garis horizontal yang sama; jarak garis→parabola→fokus konstan ⇒ semua tiba di fokus **pada waktu yang sama**. Jumlah sampai 38. |
| pCOT1kPsDag | Sudut 90° (dua cermin datar, "V") + garis sumber di atas | **Retroreflektor**: dua pantulan pada sudut siku membalik arah ⇒ setiap bola kembali vertikal ke garis asal. Jumlah 1,2,3,5,…,144. |
| _6HvCnCJL-g | Lantai lengkung (2 segmen) + ring basket | **Proyektil di bawah gravitasi** + pantulan elastis; kurva lantai dirancang sehingga lintasan parabola setelah memantul melewati ring. Jumlah sampai 87. |

### B. Billiard satu bola (orbit periodik vs kuasi-periodik) — 2 video

| ID | Geometri | Mekanisme |
|---|---|---|
| wfiLDIhw50s | Segitiga sama sisi | Billiard segitiga; dengan *unfolding* ke kisi segitiga, arah rasional ⇒ orbit periodik. "Closed after 126 bounces". Warna jejak bergeser sepanjang waktu (biru→ungu→merah muda→oranye→hijau). Counter `bounces`. |
| gNxrvmhgAw8 | Lingkaran | Billiard lingkaran; sudut pusat tiap pantulan = 1/φ² putaran (irasional) ⇒ **tidak pernah menutup**, tali busur menyelimuti lingkaran dan membentuk **kaustik** (lingkaran dalam kosong). Frame 0 menampilkan keadaan akhir sebagai *thumbnail*, lalu mulai dari kosong. |

### C. Orbit / gravitasi — 3 video

| ID | Mekanisme |
|---|---|
| X02KQYS_1aw | **Orbit rosette**: orbit Kepler eksentrik (e ≈ 0.70) yang apsisnya berpresesi **prograde 10°/orbit** ⇒ tepat 36 orbit untuk satu putaran penuh (36 titik perihelion kuning membentuk cincin di sekitar Matahari). Gaya sentral non-1/r² (mis. Newton + suku 1/r³ ala GR). Counter `years` (periode ≈ 6 250 tahun; total 225 000). Waktu simulasi **dipercepat** sepanjang video (interval perihelion turun 1.84 s → 1.37 s dalam 6 orbit). |
| RRXtPoO1XkU | **Resonansi 13:8 Venus–Bumi**: dua orbit lingkaran konsentris; garis penghubung kedua planet digambar berkala (string art) ⇒ pola 5-lipatan ("bunga Venus"). Counter `Venus n : m Earth`. Warna garis bergeser biru→ungu→pink→oranye. |
| iWMn2yrUdIc | **Skala tata surya**: kamera perspektif 3D di atas *grid* yang melengkung (sumur gravitasi), zoom-out logaritmik, planet berlabel, sabuk asteroid/Kuiper/awan Oort sebagai awan partikel. Counter `years` dipercepat (0→182). Paling sinematik; matematikanya Kepler sederhana tetapi butuh kamera 3D, partikel, label. |

### D. Osilasi — 1 video

| ID | Mekanisme |
|---|---|
| RamGZYVfBw8 | **Pendulum wave**: 18 bandul dengan panjang berbeda (bandul ke-i berosilasi N₀+i kali dalam siklus Γ) dilepas serentak dari sudut yang sama ⇒ pola gelombang, kekacauan semu, lalu **sejajar kembali** di akhir. Dirender dengan **proyeksi perspektif 3D** (rel penggantung tampak vertikal), jejak berbentuk pita *motion blur*. Waktu simulasi dipercepat di tengah lalu melambat menjelang penjajaran (periode bandul atas teramati 0.90 s → 0.33 s → melambat lagi). |

### E. Fraktal dan reaksi berantai — 2 video

| ID | Mekanisme |
|---|---|
| fIoOtZUVeqA | **Kepingan salju Koch**: iterasi 0→n; sebuah bola "penjejak" menelusuri tepi; counter `edge = 3.00 → 3.33 → … → 15.67 → ∞` (perimeter × 4/3 per iterasi, sementara luas konvergen; lingkaran pembatas tetap). Warna tepi bergeser cyan→ungu→pink→oranye→kuning. |
| C0wirX5ZOdE | **Reaksi berantai (tumbukan elastis 2D)**: bola menabrak pasangan bola ⇒ keduanya terpental ±45°, menabrak cermin pendek, memicu pasangan berikutnya (pohon biner, `moving: 1,2,4,8,…,32`), lalu seluruh reaksi **berbalik** (reversibilitas waktu) hingga bola pertama kembali ke dinding awal. Butuh deteksi tumbukan berbasis event yang presisi. |

### Ringkasan kebutuhan mesin dari 18 video

| Kemampuan | Video yang membutuhkan |
|---|---|
| Ray/partikel + pantulan pada garis, lingkaran, elips, parabola, hiperbola, kurva parametrik | 12 |
| Gravitasi konstan (proyektil) | 1 |
| Integrator ODE (gaya sentral, bandul non-linier) | 3–4 |
| Tumbukan elastis antar-bola | 1 |
| Fraktal / geometri rekursif | 1 |
| Proyeksi 3D (ellipsoid, bandul, tata surya) | 3 |
| Time-warp (waktu simulasi dipercepat/diperlambat terhadap waktu video) | ≥ 4 |
| Spawn bertahap (deret Fibonacci/kustom) | 9 |
| Parameter geometri yang dianimasikan | 2 (nAlio, Koch) |

---

## 3. Gaya visual yang konsisten

Diukur dengan sampling piksel pada frame 1080×1920 (contoh: `pK5TgMQsWRQ` t = 8.5 s).

**Latar.** Gradien vertikal navy→hitam: atas ≈ `#030619` (3,6,25), tengah ≈ `#010310`, bawah ≈ `#000005`. Tanpa tekstur; vignette sangat halus.

**Tata letak (9:16).**
- Judul (pertanyaan hook) di y ≈ 190–260 px, putih kebiruan (`#EEF2FF`-an), satu atau dua baris, rata tengah.
- Baris counter di y ≈ 320–370 px: label putih + nilai **kuning keemasan** (`#FFD23F`-an), mis. `balls: 377`.
- Handle kanal kecil abu-abu transparan di bawah counter (≈ y 430). *Tidak akan ditiru; dijadikan parameter opsional.*
- Area simulasi kira-kira y 410–1450 px (zona atas–tengah). **Sepertiga bawah (y > 1500) sengaja kosong** — zona aman UI Shorts (judul, tombol).
- Konten diposisikan pada sumbu x ≈ 510 (bukan 540) di banyak video — kemungkinan artefak pipeline asli; tidak penting untuk ditiru.

**Tipografi.** Teks mirip **DejaVu Sans Bold** (bentuk "W", "?" dan angka identik). Kalibrasi: judul ≈ 54–58 px (dipaskan ke lebar ≈ 970 px), counter ≈ 55 px. Angka counter berganti instan (tanpa animasi).

**Elemen.**
- **Dinding/cermin**: garis neon cyan, inti `#9CF3FF`–`#A5FBFF`, tebal ≈ 8–10 px, glow lebar ≈ 15–20 px (bloom).
- **Bola**: lingkaran ≈ r 10–14 px berwarna dengan cincin putih tipis dan glow; **ekor komet** meruncing di belakang (≈ 40–80 px).
- **Fokus/target**: cincin emas redup (`#8E823C`, r ≈ 19 px). Saat dicapai: cincin menyala + cincin "ripple" melebar dan memudar.
- **Titik tumbukan**: kilatan putih kecil di dinding saat bola memantul.
- **Jejak**: garis tipis (≈ 1–2 px) semi-transparan dengan blending aditif; ratusan garis menumpuk menjadi gradien pelangi halus. Pada video banyak bola, jejak lama memudar perlahan; pada billiard satu bola jejak permanen.
- **Palet warna bola**: pelangi berurutan (cyan → biru → ungu → pink → merah/oranye → kuning → hijau). Warna ditentukan oleh indeks/sudut peluncuran atau oleh waktu (untuk satu bola).
- **Jawaban akhir**: baris counter diganti teks kuning, mis. `Yes! All 377, every time!`, `Twice! All 52 of them!`, `Yes! Closed after 126 bounces`.

**Gerak (dari strip 60 fps berurutan).** Kecepatan bola konstan ≈ 6–7 px/frame (≈ 400 px/s) di keluarga elips; tidak ada easing pada fisika. Kilatan/ripple ≈ 0.3–0.6 s. Tanpa transisi/potongan kamera (kecuali tata surya).

### Yang berbeda antar jenis
- **Konik banyak bola**: dinding tebal cyan, fokus emas, kipas pelangi aditif, counter `balls:`.
- **Billiard satu bola**: warna jejak berganti seiring waktu, counter `bounces:`, jejak permanen membentuk pola.
- **Orbit**: Matahari bercahaya (inti putih, halo oranye, cakram gelap di sekelilingnya), jejak tipis permanen berwarna menurut waktu, penanda titik peristiwa (titik kuning perihelion), counter `years:` yang dipercepat.
- **Bandul / tata surya**: kamera 3D perspektif, pita motion-blur atau grid melengkung, tanpa dinding neon.
- **Koch / chain reaction**: elemen kecil, warna berubah per generasi/iterasi.

---

## 4. Struktur narasi dan ritme

Pola yang sama di hampir semua video (≈ 31 s):

1. **Hook (frame 0)** — pertanyaan sudah tampil, simulasi langsung berjalan; tidak ada intro. Satu video (gNxrvmhgAw8) memakai frame 0 = keadaan akhir sebagai thumbnail.
2. **Mulai sederhana** — 1 bola / 1 orbit pertama, lambat, mudah diikuti (≈ 0–5 s).
3. **Eskalasi** — jumlah bola bertambah per gelombang (Fibonacci 1,2,3,5,…; atau 1,2,3,4,6,8,10,13,…; atau 2^n), atau waktu simulasi dipercepat. Interval gelombang ≈ 2–3 s, sehingga ada ≈ 10–13 "beat" visual.
4. **Klimaks** — ratusan bola tiba bersamaan / pola menutup (≈ t − 3 s).
5. **Jawaban** — counter diganti teks kuning + kilatan di target; **tahan 1.5–3 s** pada frame akhir.

Counter selalu menjadi "jam" naratif (bola, skor, pantulan, tahun, perimeter).

---

## 5. Audio

- **Tanpa narasi/voiceover, umumnya tanpa musik.** Audio = efek suara yang dipicu **event simulasi** (terbukti: banyak segmen sunyi di antara event; `silencedetect` menemukan 4–11 jeda > 0.5 s di 13 dari 18 video).
- **Keluarga konik / billiard / chain reaction**: "tok/klik" perkusif pendek (transien tajam + badan nada rendah-menengah, peluruhan ≈ 0.1–0.2 s) per pantulan/tumbukan/kedatangan. Di wfiLDIhw50s satu klik per pantulan (makin rapat seiring waktu). Event pertama pK5 di 0.37 s = pantulan dinding pertama.
- **Rosette**: event bernada (chime) setiap **perihelion** (0.99, 2.83, 4.57, 6.21, 7.75, 9.20, 10.57 s → interval memendek karena time-warp).
- **13:8 orbit**: nada lonceng di setiap pertemuan + lonceng panjang di akhir (LRA 23.4 LU — dinamika besar).
- **Pendulum wave**: pad nada berkelanjutan; nada baru (kaya harmonik, sustain panjang) dipicu saat bandul mencapai simpangan (onset 0.95/1.9/2.8/3.6 s = titik balik bandul atas) ⇒ akor yang berevolusi.
- **Tata surya**: drone ambient kontinu + desisan noise (saat sabuk muncul) + stinger nada.
- Penutup: nada/chime lebih panjang saat jawaban muncul.

Implikasi: audio dapat **disintesis secara prosedural dari daftar event simulasi** (deterministik), tidak perlu pustaka musik.

---

## 6. Implikasi untuk sistem

1. Satu set kecil primitif mencakup 12 dari 18 video: partikel + pantulan pada kurva implisit/parametrik + spawn bertahap + jejak aditif + counter.
2. Perlu *time-warp* (pemetaan waktu video → waktu simulasi) sebagai fitur kelas satu.
3. Perlu event bus dari simulasi (pantulan, kedatangan, perihelion) untuk efek visual (kilatan, ripple, titik penanda) **dan** audio.
4. Renderer 2D dengan glow/bloom dan blending aditif; proyeksi 3D sederhana untuk 3 video.
5. Tata letak teks tetap (judul, counter, jawaban) dengan zona aman bawah.
