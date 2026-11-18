# Fase 2–3 — Laporan prototipe dan rancangan sistem

Status: **Fase 1–3 selesai. Sistem final belum dibangun — menunggu persetujuan.**

Legenda: **[V]** = terverifikasi dengan pengukuran di sesi ini · **[A]** = asumsi / belum diuji.
Mesin uji: Apple M5 (10 core), macOS, Node 26.11, ffmpeg (Homebrew), Chrome 156 (browser bawaan aplikasi Claude, panel tersembunyi).

---

## 1. Ringkasan

| | P1 Elips (377 bola) | P2 Rosette orbit | P3 Pendulum wave |
|---|---|---|---|
| Referensi | pK5TgMQsWRQ | X02KQYS_1aw | RamGZYVfBw8 |
| Output | `prototypes/output/p1-ellipse.mp4` | `…/p2-rosette.mp4` | `…/p3-pendulum.mp4` |
| (a) Akurasi | bola meleset dari fokus ≤ 3.5·10⁻¹² px | galat vs solusi analitik 2.1·10⁻⁸ px; presesi 10.000000001°/orbit | galat penjajaran ulang 4.8·10⁻¹² ° |
| (b) Kemiripan visual | tinggi; fase gelombang akhir ±0.2 s | sangat tinggi | tata letak tepat; pola tengah video berbeda fase |
| (c) Determinisme | frame identik bit-per-bit (1900/1900) | identik (1894/1894), MP4 byte-identik | identik (1503/1503) |
| (d) Kecepatan render (Node, termasuk encode + audio) | 31.8 s untuk 31.7 s video (1.0× real-time) | 20.9 s / 31.6 s (1.5×) | 16.1 s / 25.1 s (1.6×) |
| (e) Preview browser (kode sama) | layak, 4 % frame > 16.7 ms | layak | layak |

Semua spesifikasi output **[V]** sama dengan referensi: H.264 High, 1080×1920, 60 fps, yuv420p, tag BT.709, AAC-LC 44.1 kHz stereo 128 kb/s, durasi sama dengan video referensinya (31.67 / 31.56 / 25.05 s), loudness disamakan dengan referensi (−19.8 / −14.2 / −16.7 LUFS).

---

## 2. Pemilihan 3 video

Kriteria: jenis simulasi berbeda, dan setiap prototipe harus menguji **risiko teknis yang berbeda** dari sistem.

1. **pK5TgMQsWRQ — elips, 377 bola** (keluarga pantulan konik, 10 dari 18 video). Paling banyak objek dan jejak di antara 2D-murni: 377 bola, ribuan segmen jejak dengan blending aditif, kilatan per pantulan, spawn bertahap. Menguji **performa render**, sistem jejak, event→efek, dan apakah satu keluarga mekanisme bisa diparametrisasi.
2. **X02KQYS_1aw — orbit rosette** (keluarga orbit). Satu-satunya yang butuh **integrasi ODE jangka panjang** (36 orbit, presisi menentukan apakah orbit menutup tepat di titik awal) dan *time-warp* yang dipercepat. Menguji **akurasi numerik dan determinisme lintas runtime**.
3. **RamGZYVfBw8 — pendulum wave** (keluarga osilasi). Satu-satunya **proyeksi 3D perspektif** + pita *motion blur* + audio tonal kontinu; juga fisika non-linier (amplitudo besar). Menguji **kamera 3D, motion blur, dan sintesis audio musikal**.

Tidak dipilih (dan karenanya **belum teruji**, lihat §8): tata surya 3D (kamera zoom logaritmik, awan partikel), reaksi berantai (tumbukan bola-bola), Koch (geometri rekursif).

---

## 3. Tech stack prototipe dan alasannya

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Bahasa | JavaScript ES modules (tanpa build) | Satu kode jalan di browser dan Node. (Sistem final: TypeScript, lihat §7.) |
| Inti simulasi | Modul murni (`sim.js`), tanpa DOM/Node API | Syarat utama (e): kode sama untuk preview dan render offline. |
| Renderer | **Canvas2D API** | API identik di browser dan di Node via **@napi-rs/canvas** (Skia). |
| Render offline | Node + @napi-rs/canvas → frame RGBA mentah → pipe ke **ffmpeg** (libx264) | Tanpa browser headless: cepat dan sederhana. |
| Audio | Sintesis prosedural dari event simulasi (Float32 → WAV), normalisasi loudness EBU R128 dua tahap | Referensi memakai SFX berbasis event, bukan musik. Kode sintesis yang sama dapat mengisi `AudioBuffer` di browser (sudah dipakai di tombol *Play + audio*). |
| Font | DejaVu Sans Bold (lisensi bebas, dibundel di `assets/fonts/`) | Cocok dengan tipografi referensi. |
| Preview | `prototypes/preview.html` + server statis tanpa dependensi (`tools/serve.mjs`) | Panel parameter dibangkitkan otomatis dari `schema` tiap scene. |

**Tentang HyperFrames.** Skill sudah dibaca. HyperFrames merender HTML dengan *seek* per frame, sehingga frame dirender **tidak berurutan** dan `render(t)` harus fungsi murni dari waktu. Simulasi di sini menumpuk keadaan (jejak ratusan bola, orbit 225 000 tahun), sehingga tiap frame harus dihitung ulang dari awal atau dari tabel pra-hitung. Selain itu, inti produknya adalah timeline GSAP/HTML, bukan simulasi. Karena itu tidak dipakai untuk prototipe. **[A]** Kecepatan render HyperFrames/Chrome-headless tidak diukur; perbandingan kecepatan di §7.3 adalah asumsi.

---

## 4. Hasil uji per butir

### (a) Akurasi matematis / fisika

**P1 — elips** **[V]**
- Lintasan dihitung analitik: perpotongan sinar–elips (persamaan kuadrat) dan pantulan `v' = v − 2(v·n)n`, tanpa langkah waktu numerik.
- Invarian "fokus→dinding→fokus = 2a": pada 12 kedatangan, posisi bola sebelum *snap* meleset dari fokus paling jauh **3.5·10⁻¹² px**. Lalu posisi di-*snap* ke fokus untuk mencegah akumulasi galat (koreksi dicatat, bukan disembunyikan).
- Mekanisme yang ditemukan dari referensi: di setiap kedatangan, **seluruh** bola diluncurkan ulang dengan sudut seragam `θ₀ + 2πk/N`. Ini tak terlihat karena semua bola berimpit di fokus, dan menjelaskan kipas bola yang berjarak rata.

**P2 — rosette** **[V]**
- Gaya `a = −(μ/r² + κ/r³) r̂` dipilih karena memiliki **solusi tertutup** `r(φ) = p / (1 + e·cos(γ(φ−φₚ)))`, sehingga integrator bisa diperiksa terhadap jawaban eksak. Parameter dari pengukuran referensi: r_apo 445 px, r_peri 78 px, presesi 10°/orbit (36 titik perihelion terhitung di frame akhir), periode 6 250 tahun (225 000 / 36).
- RK4 langkah tetap (20 000 langkah/orbit, 720 000 langkah total, 51 ms):

| langkah/orbit | galat radial maks vs analitik | meleset saat menutup (36 orbit) | drift energi relatif | presesi terukur |
|---|---|---|---|---|
| 5 000 | 3.4·10⁻⁶ px | 1.3·10⁻⁵ px | 4.2·10⁻¹⁰ | 10.0000009° |
| 10 000 | 2.0·10⁻⁷ px | 5.5·10⁻⁷ px | 1.3·10⁻¹¹ | 10.00000003° |
| 20 000 (dipakai) | 1.9·10⁻⁸ px | 2.6·10⁻⁸ px | 7.0·10⁻¹³ | 10.000000001° |

Galat turun ≈ 16× saat langkah dibagi dua (konvergensi orde-4, sesuai teori RK4).

**P3 — pendulum wave** **[V]**
- Bandul ke-i melakukan 47−i ayunan dalam siklus 60 s. Semua bob dilepas dengan **simpangan horizontal sama** (seperti referensi), sehingga amplitudonya 15.3°–43.7°.
- Panjang tali dihitung dengan periode eksak amplitudo besar `T = 4√(L/g)·K(sin(θ₀/2))` (integral eliptik via AGM) dan diselesaikan bersama `θ₀ = asin(X₀/L)` dengan iterasi titik tetap. ODE non-linier `θ'' = −(g/L) sin θ` diintegrasikan dengan RK4 2 400 Hz.
- Galat penjajaran ulang di t = 60 s: **4.8·10⁻¹² °**.
- Pembanding: dengan rumus sudut-kecil `L = g(T/2π)²` (pendekatan yang umum dipakai), galat fase mencapai **176°**. Artinya bandul **tidak** akan sejajar kembali. Ini temuan penting: tanpa koreksi non-linier, efek "line up again" gagal.
- Kamera perspektif 3D di-*fit* (Nelder–Mead, `tools/fit-camera.mjs`) ke 6 titik acuan referensi dengan panjang tali fisik: galat RMS **6 px**.

### (b) Kemiripan visual

Perbandingan frame pada titik waktu yang sama (baris atas = referensi, baris bawah = prototipe):
`docs/assets/compare_p1.png`, `compare_p2.png`, `compare_p3.png`.

**Waktu peristiwa** **[V]** (diukur dari kilatan fokus / onset audio referensi):

| | Referensi | Prototipe | Selisih maks |
|---|---|---|---|
| P1 kedatangan di fokus (13×) | 2.58, 5.20, 7.73, 10.20, 12.60, 14.92, 17.18, 19.38, 21.53, 23.62, ~25.65, ~27.63, 29.58 | 2.58, 5.14, 7.68, 10.17, 12.61, 14.98, 17.28, 19.52, 21.68, 23.76, 25.77, 27.71, 29.58 | 0.15 s |
| P2 perihelion 1–7 | 0.99, 2.83, 4.57, 6.21, 7.75, 9.20, 10.57 | 0.95, 2.80, 4.60, 6.31, 7.93, 9.45, 10.87 | 0.30 s (membesar ke orbit ke-7) |
| P2 counter `years` | t=1 s: 3 300 · t=15 s: 64 000 | 3 300 · 62 100 | −3 % di t=15 s |
| P3 penjajaran ulang | 23.47 s | 23.47 s | 0 (dikunci) |

Time-warp referensi dicocokkan dengan kurva: P1 `rate ∝ 1 + 0.000463·t²` (fit 13 titik), P2 `log rate = 0.00674·t + 0.002168·t²` (fit dari counter), P3 `rate ∝ e^{0.06t}` dengan *ease-out* 1.3 s menuju penjajaran.

**Metrik piksel.**
- **SSIM/PSNR layar penuh gagal sebagai metrik [V].** Frame berisi latar kosong saja mendapat SSIM lebih tinggi daripada prototipe (mis. P1 t=20: latar kosong 0.873 vs prototipe 0.802). Latar gelap mendominasi, dan garis tipis yang bergeser 1–2 px dihukum lebih keras daripada tidak ada garis sama sekali.
- **Metrik komposisi** (SSIM pada gambar 135×169 grayscale yang diblur, area konten saja) dengan dua baseline: latar kosong, dan *video referensi lain dari keluarga yang sama* pada detik yang sama ("seberapa mirip dua video si kreator sendiri"):

| | t | prototipe | latar kosong | ref. lain sekeluarga |
|---|---|---|---|---|
| P1 | 2 / 8.5 / 20 / 28.5 / 31.5 | 0.57 / 0.58 / 0.52 / 0.53 / 0.60 | 0.46 / 0.45 / 0.38 / 0.36 / 0.28 | 0.63 / 0.59 / 0.54 / 0.50 / 0.58 |
| P2 | 1 / 15 / 29 / 31 | 0.68 / 0.68 / 0.75 / 0.74 | 0.61 / 0.52 / 0.41 / 0.41 | 0.77 / 0.54 / 0.39 / 0.39 |
| P3 | 1 / 12 / 22 / 24.9 | 0.68 / **0.43** / 0.51 / 0.61 | 0.52 / **0.42** / 0.46 / 0.57 | – |

Bacaan: P1 setara dengan kemiripan antar-video kreator sendiri; P2 jauh di atas kedua baseline; **P3 di pertengahan video (t=12 s) hampir tidak lebih baik dari latar kosong** (lihat §5).

- Statistik warna (luminans rata-rata area konten, ref vs proto): P1 0.096 vs 0.109 (t=20) dan 0.127 vs 0.171 (t=28.5), jadi **P1 10–35 % lebih terang** pada pertengahan–akhir. P2 dalam ±10 %. P3 chroma lebih rendah (0.039 vs 0.029 di t=12), artinya **pita P3 kurang saturasi**.

**Audio** **[V]** — `docs/assets/audio_compare.png` (spectrogram berpasangan ref/proto untuk P1, P2, P3). Struktur event cocok (klik per pantulan yang makin rapat; chime per perihelion; nada per titik balik bandul + akor akhir). Loudness disamakan. Perbedaan dicatat di §5.

### (c) Determinisme

- **Ulang render di mesin yang sama [V]:** SHA-1 tiap frame RGBA dibandingkan antara dua proses terpisah (satu dengan encode video, satu tanpa). Hasil identik untuk **1900/1900, 1894/1894, 1503/1503** frame. File MP4 P2 yang di-encode dua kali **byte-identik** (md5 sama), jadi libx264 deterministik dengan pengaturan ini.
- **Lintas runtime, browser vs Node [V]**, hash state simulasi pada frame yang sama:
  - Awalnya **P2 identik**, tetapi **P1 dan P3 berbeda**. Penyebab: `Math.sin/cos/atan2` di V8 Chrome 156 dan Node 26 berbeda 1 ULP untuk sebagian argumen (spesifikasi JS tidak mewajibkan hasil identik). P2 kebal karena RK4-nya hanya memakai `+ − × ÷ √`, yang dijamin IEEE-754.
  - Perbaikan: `prototypes/lib/dmath.js`, yaitu sin/cos/exp/asin yang hanya memakai operasi dasar IEEE (akurasi ≤ 1.5 ULP terhadap `Math.*`, diuji 200 000 titik). Setelah dipakai di inti simulasi, **6/6 hash state identik** di Chrome dan Node.
- **Piksel, browser vs Node [V, sebagian]:** renderer berbeda (Skia di Node vs Skia+GPU di Chrome). P3 frame 720: selisih rata-rata **1.9/255**, 4.8 % kanal berselisih > 8, maks 227 (tepi antialias/teks). Jadi **preview ≈ output, tetapi tidak identik piksel**. Uji yang sama untuk P1/P2 tidak selesai karena skrip tertahan di panel browser tersembunyi **[A]**.

### (d) Kecepatan render [V]

Render offline penuh di Node (proses tunggal) termasuk sintesis audio, normalisasi loudness, encode x264 `preset medium crf 17`, dan mux:

| | Frame | Draw/frame | Readback/frame | Total | vs durasi video |
|---|---|---|---|---|---|
| P1 | 1900 | 14.7 ms | ~3 ms | 31.8 s | 1.0× real-time |
| P2 | 1894 | 9.5 ms | ~3 ms | 20.9 s | 1.5× |
| P3 | 1503 | 7.3 ms | ~3 ms | 16.1 s | 1.6× |

Sintesis audio: 0.6 s (P1), 1.0 s (P2), **4.8 s (P3, 675 nada bersustain panjang**, kandidat optimasi).
Pelajaran performa yang terukur:
- Menggambar ulang 4 000 garis per frame = 79 ms dan blur layar penuh = 47 ms per frame. Keduanya terlalu mahal. Solusinya: **layer jejak inkremental** (hanya segmen baru yang digambar, lalu di-*fade* dengan `destination-out`), **sprite glow pra-render**, glow geometri statis diblur sekali saat setup, dan "haze" pada canvas ¼ resolusi yang di-upscale (blur murah).
- Satu bug membuat P3 jadi 460 ms/frame: faktor skala perspektif lupa dinormalisasi sehingga lebar garis ≈ 30 000 px. Validasi parameter gambar (mis. lebar garis wajar) layak dimasukkan ke sistem.

### (e) Kode yang sama untuk preview real-time dan render offline [V]

- Modul `scene.js` yang **sama persis** dimuat di Chrome (`prototypes/preview.html`) dan di Node (`render-node.mjs`). Lingkungan disuntikkan lewat `env.createCanvas`; tidak ada cabang khusus per platform di kode scene.
- Biaya per frame di Chrome dengan **sinkronisasi GPU dipaksa tiap frame** (batas atas, panel tersembunyi):

| | p50 | p95 | p99 | maks | frame > 16.7 ms |
|---|---|---|---|---|---|
| P1 | 9.2 ms | 16.4 ms | 17.4 ms | 35.4 ms | 76 / 1900 (4 %) |
| P2 | 6.5 ms | 7.3 ms | 7.5 ms | 12.3 ms | 0 |
| P3 | 5.1 ms | 6.2 ms | 6.4 ms | 25.9 ms | 1 |

  Preview 60 fps layak; P1 sesekali turun frame saat 377 bola. Loop preview memakai jam audio (`AudioContext.currentTime`) sebagai master clock dan melewati frame bila tertinggal, sehingga audio tetap sinkron.
- Audio preview memakai fungsi sintesis yang sama dengan render offline (diisi ke `AudioBuffer`).
- **Batasan [V]:** P1 dan P2 bersifat *stateful* (jejak terakumulasi), sehingga hanya bisa diputar maju. *Scrubbing* mundur berarti simulasi ulang dari awal. P3 dihitung penuh di muka, sehingga bisa di-*seek* bebas.

---

## 5. Selisih dan kegagalan (jujur)

**P1**
- Fase muka gelombang di akhir (t=28.5 s) sedikit di depan referensi: "mangkuk" bola referensi lebih rendah (≈0.2 s).
- Jejak tajam masih lebih terlihat di pertengahan video, dan luminans 10–35 % lebih tinggi.
- Pusat elips di x=540 (referensi x≈510, kemungkinan artefak pipeline mereka). Ini disengaja.
- Audio: saya menambahkan lonceng di tiap kedatangan dan akor akhir panjang. Referensi hanya berisi klik dan diakhiri hening, jadi audio prototipe lebih "musikal" daripada referensi.

**P2**
- Waktu perihelion bergeser hingga 0.30 s pada orbit ke-7, dan counter −3 % di t=15 s. Model time-warp (2 parameter) tidak sempurna; data referensi (counter dibulatkan ke 100 tahun) sendiri bising.
- Setelah orbit menutup, planet referensi bergerak lebih jauh daripada prototipe.
- Glow Matahari prototipe lebih kecil.

**P3**
- Pola di pertengahan video **tidak cocok frame-per-frame** (SSIM komposisi t=12 s ≈ latar kosong). Penyebab: jumlah ayunan per bandul (47…30) dan Γ referensi tidak diketahui; saya mengestimasinya dari pelacakan posisi bola yang bising, sehingga fase di tengah berbeda meski awal dan akhir cocok.
- Pita motion blur kurang tebal dan kurang saturasi dibanding referensi.
- Bola referensi di t=1 s sudah lebih jauh berayun (laju awal referensi ≈10 % lebih cepat).
- Audio referensi punya jeda hening sebelum akor penjajaran; prototipe tidak.
- Referensi tampaknya **tidak** memakai panjang tali fisik (rasio panjang di layar 1.6 vs 2.45 untuk fisik). Prototipe memakai fisika nyata, lalu mencocokkan tata letak lewat kamera (RMS 6 px).

**Umum**
- Render browser ≠ Node secara piksel (selisih rata-rata 1.9/255 di P3).
- Watermark/handle kreator **tidak** ditiru (parameter `handle` default kosong). Judul, teks jawaban, dan arah awal bola sengaja dibuat berbeda dari referensi.

---

## 6. Komponen yang terbukti dibutuhkan

| Komponen | Status | Bukti |
|---|---|---|
| Inti simulasi murni (tanpa DOM), di-*inject* env | [V] | dipakai tanpa perubahan di Chrome dan Node |
| Pustaka matematika deterministik (`dmath`) | [V] | tanpa ini hash state P1/P3 berbeda lintas runtime |
| TimeWarp (frame video → waktu simulasi, tabel deterministik dengan jangkar tepat) | [V] | ketiga referensi memakai waktu yang dipercepat; jangkar menjamin klimaks jatuh di frame yang ditentukan |
| Event bus simulasi → efek visual + audio | [V] | kilatan, ripple, titik perihelion, SFX semuanya dari event yang sama |
| Waktu event sub-frame (interpolasi) untuk audio | [V] | onset audio presisi < 1 frame |
| Layer jejak inkremental + fade + haze ¼-res | [V] | dari 79 ms/frame menjadi 14.7 ms/frame di P1 |
| Sprite glow pra-render, neon statis diblur sekali | [V] | blur per frame (47 ms) dihindari |
| Kamera 3D sederhana + proyeksi | [V] | P3 (RMS 6 px) |
| Validasi fisika otomatis (`report()`/diagnostik per scene) | [V] | galat analitik, energi, penjajaran dicetak tiap render |
| Sintesis audio prosedural + normalisasi loudness R128 | [V] | loudness tepat target ±0.1 LU |
| Encoder ffmpeg dengan tag BT.709 benar | [V] | tanpa `h264_metadata` tag primaries/transfer kosong (temuan) |
| Skema parameter per scene → UI otomatis | [V] (dasar) | `preview.html` membangkitkan slider dari `schema` |
| Checkpoint/seek untuk scene *stateful* | [A] | belum dibangun; dibutuhkan untuk scrubbing |
| Tumbukan bola-bola, partikel 3D ribuan, geometri rekursif | [A] | belum diprototipkan |

---

## 7. Usulan arsitektur sistem final

### 7.1 Prinsip
1. **Inti simulasi** = fungsi/objek murni TypeScript: `createSim(params, seed)` → `advanceTo(simTime)` → `{state, events}`, plus `snapshot()/restore()`. Tidak menyentuh canvas, DOM, waktu nyata, atau `Math.sin` bawaan (hanya `dmath`).
2. **View** = fungsi gambar `draw(ctx, sim, frameCtx)` di atas Canvas2D API standar, dengan state visual sendiri (layer jejak, efek dari event).
3. **Host** menyediakan `env` (pembuat canvas, font) dan jam:
   - *Preview* (browser): jam = `AudioContext.currentTime`, canvas DOM, setengah resolusi opsional.
   - *Offline* (Node worker): jam = indeks frame, @napi-rs/canvas, pipe ke ffmpeg.
4. **Audio** = `events[] → voices[]` (murni) → mixer → buffer. Di browser masuk ke `AudioBuffer`, di Node ke WAV lalu normalisasi R128.
5. **Job render** dideskripsikan penuh oleh JSON `{sceneId, sceneVersion, params, seed}`. JSON yang sama menghasilkan MP4 yang byte-identik (terverifikasi pada mesin yang sama).

```
          ┌────────────── scene package ──────────────┐
params ──▶│ schema.ts  sim.ts (pure, dmath)  view.ts  audio.ts │
          └──────┬──────────────┬───────────────┬──────┘
                 │              │               │
     Browser preview       Node render worker   (sama persis)
  canvas DOM + WebAudio   @napi-rs/canvas + ffmpeg
  jam = audio clock       jam = frame index
```

### 7.2 Skema parameter (contoh)

```ts
export const schema = defineSchema({
  title:   { type: 'text', default: 'Will every ball find the same spot?', group: 'Teks' },
  counts:  { type: 'sequence', default: 'fibonacci', options: ['fibonacci', 'linear', 'custom'], group: 'Simulasi', sim: true },
  A:       { type: 'number', default: 508, min: 300, max: 560, unit: 'px', group: 'Geometri', sim: true },
  finalAt: { type: 'number', default: 29.58, min: 10, max: 58, unit: 's', group: 'Waktu', sim: true },
  palette: { type: 'palette', default: 'rainbow', group: 'Gaya' },
  trailHalfLife: { type: 'number', default: 1.4, min: 0.1, max: 5, group: 'Gaya' },
});
```

- `sim: true` berarti perubahan memaksa simulasi ulang. Tanpanya, cukup gambar ulang (lebih cepat untuk tweak gaya).
- Tipe: `number | integer | bool | enum | text | color | palette | sequence | vec2 | curve` (`curve` untuk kurva time-warp yang bisa diedit).
- Preset disimpan sebagai JSON di `presets/` dan dipakai juga sebagai deskriptor job render.
- Validasi rentang dan "lint" visual (mis. lebar garis > 200 px) dijalankan sebelum render.

### 7.3 Tech stack dan trade-off keputusan penting

| Keputusan | Pilihan | Trade-off |
|---|---|---|
| Bahasa | TypeScript (ESM) | Tipe untuk skema dan kontrak scene. Butuh langkah build (Vite/esbuild), tetapi Node 26 bisa menjalankan `.ts` langsung untuk worker. |
| Renderer | **Canvas2D** (browser + Skia di Node) | (+) satu API, terbukti 1–1.6× real-time, deterministik per mesin. (−) Preview tidak identik piksel dengan output (1.9/255); P1 sesekali > 16.7 ms di browser. Alternatif WebGL: lebih cepat untuk > 1 000 partikel, tetapi render offline Node butuh GL headless atau beralih ke Chrome headless. **Usul:** Canvas2D sebagai default, WebGL opsional per scene bila diperlukan (mis. awan Oort). |
| Render offline | **Node worker + @napi-rs/canvas + ffmpeg** | (+) cepat, tanpa browser, MP4 byte-identik. (−) Piksel ≠ preview. Alternatif: Chrome headless (Playwright/HyperFrames) memberi kesamaan piksel dengan preview, tetapi **[A]** diperkirakan lebih lambat karena tangkapan layar per frame. |
| Model waktu | Sim *stateful* maju + **checkpoint** (snapshot state + bitmap layer jejak ½-res tiap 1 s di preview); pra-hitung penuh bila murah (seperti P3) | Stateful alami untuk fisika/jejak. Checkpoint menambah memori (≈ 2 MB/checkpoint pada ½-res, ≈ 64 MB per video 32 s) **[A]**. Render paralel per potongan hanya mungkin untuk scene yang bisa di-seek. Satu proses per video sudah ≈ real-time, jadi paralelisme dilakukan antar-video, bukan dalam satu video. |
| Matematika | `dmath` wajib di inti simulasi (lint melarang `Math.sin/cos/exp/pow/atan2` di `sim.ts`) | Sedikit lebih lambat, tetapi state identik di semua mesin JS. |
| Audio | Sintesis prosedural dari event | (+) deterministik, selaras sempurna, tanpa lisensi. (−) Kualitas timbre terbatas; sampel WAV bisa ditambahkan sebagai jenis *voice* bila diinginkan. |
| UI | Vite + React (atau Svelte) web app lokal; server Node kecil (HTTP + SSE) untuk antrean render | Server dibutuhkan karena ffmpeg dan Skia berjalan di Node, bukan di browser. |

### 7.4 Struktur folder

```
2D-Simulation-For-Video/
├── references/                 # read-only
├── docs/                       # analysis.md, report.md, assets/
├── packages/
│   ├── core/                   # dmath, rng, timewarp, events, geometry (konik, sinar), integrators (RK4, symplectic), schema helpers
│   ├── render2d/               # style tokens, fx (neon, sprites, comet, ripple), trail layers, text layout, camera3d
│   ├── audio/                  # voices (tock, bell, pluck, …), mixer, wav, loudness
│   └── scenes/
│       ├── conic-reflection/   # keluarga elips/parabola/hiperbola/V (10 video): sim.ts view.ts audio.ts schema.ts presets/
│       ├── billiard/
│       ├── orbit/              # rosette, resonansi, tata surya
│       ├── pendulum-wave/
│       └── …
├── apps/
│   ├── studio/                 # web UI: daftar scene, panel parameter, preview, timeline, tombol Render
│   └── server/                 # job queue, worker render (Node + @napi-rs/canvas + ffmpeg), SSE progres
├── assets/fonts/
├── output/                     # MP4 hasil render + job.json berdampingan
└── tests/                      # uji fisika (analitik), determinisme (hash frame), golden frames
```

### 7.5 Alur pengguna
1. Pilih scene/preset, lalu ubah parameter. Preview real-time berjalan di browser (½ atau penuh resolusi, dengan audio).
2. Tekan **Render**. UI mengirim `job.json` ke server, worker Node merender 1080×1920@60 dengan progres via SSE, lalu MP4 dan `job.json` disimpan di `output/`.
3. Uji otomatis tiap scene: diagnostik fisika (seperti di §4a) dan hash frame *golden* untuk deteksi regresi.

---

## 8. Risiko dan hal yang belum diuji

- **[A]** Tata surya 3D (zoom logaritmik, grid melengkung, ribuan partikel): kemungkinan butuh WebGL atau optimasi khusus. Risiko performa tertinggi.
- **[A]** Reaksi berantai: tumbukan bola-bola berbasis event yang presisi dan reversibel. Sensitif terhadap galat (tidak ada solusi analitik untuk "snap").
- **[A]** Checkpoint/seek untuk scene stateful di preview.
- **[A]** Kecepatan pendekatan Chrome-headless/HyperFrames (tidak diukur).
- **[A]** Determinisme lintas **mesin/OS** untuk piksel (Skia bisa berbeda antar CPU/OS). Yang terverifikasi hanya mesin yang sama; state simulasi seharusnya identik di mana pun berkat `dmath`.
- Selisih visual §5 (terutama P3 di tengah video) bisa ditutup dengan kalibrasi lebih lanjut, tetapi tujuan sistem adalah meniru gaya dan mekanisme, bukan frame persis.

---

## 9. Cara menjalankan prototipe

```bash
# render offline (MP4 + WAV ke prototypes/output/)
node prototypes/lib/render-node.mjs prototypes/p1-ellipse/scene.js
node prototypes/lib/render-node.mjs prototypes/p2-rosette/scene.js --hash /tmp/h.txt   # + hash per frame
# preview interaktif di browser
node tools/serve.mjs   # lalu buka http://127.0.0.1:5173/prototypes/preview.html?scene=p3-pendulum
```

Alat bantu analisis: `tools/compare.sh` (frame berdampingan), `tools/ssim.sh`, `tools/ssim_lo.sh`, `tools/colorstats.mjs`, `tools/state-hash.mjs` (hash state lintas runtime), `tools/fit-camera.mjs`, `tools/track.mjs`, `tools/sample.mjs`.

---

## 10. Keputusan yang menunggu persetujuan Anda

1. Arsitektur §7: inti TS murni + Canvas2D + worker Node/Skia/ffmpeg + web app lokal.
2. Preview yang **mendekati** (bukan identik piksel) dengan output. Alternatifnya Chrome headless untuk kesamaan piksel dengan biaya kecepatan.
3. Urutan pembangunan yang diusulkan: (i) kerangka core + studio + server memakai 3 scene yang sudah ada, (ii) keluarga `conic-reflection` lengkap (menutup 10/18 video), (iii) billiard + orbit, (iv) 3D tata surya dan reaksi berantai (risiko tertinggi).

---

## 11. Status pembangunan (setelah persetujuan, 2026-11-17)

Dibangun sesuai §7, cara pakai di `README.md`:
- **Inti** `packages/core` (dmath + atan2/log/pow, TimeWarp, skema parameter + validasi, kontrak scene), `packages/render2d`, `packages/audio` (osilator rekursif, deterministik).
- **Studio** `apps/studio` + **server** `apps/server`: panel parameter otomatis dari skema, preview dengan audio sebagai jam master, timeline dengan checkpoint latar belakang (seek ≤ 13 ms), preset, antrean render dengan progres via SSE, dan pemutar hasil.
- **Scene**:
  - `focal-reflection` dengan 6 tata letak (ellipse, peanut, parabola, corner, cassegrain, gregorian). Mesinnya event-driven pada kuadrik implisit umum dan dihitung penuh di muka.
  - `rosette-orbit` dan `pendulum-wave`, diport dari prototipe.
- **Uji** (`npm test`, 17 lulus [V]): akurasi fisika tiap scene/tata letak, piksel identik antar render, hash state "golden". 20/20 hash juga identik saat dihitung di Chrome [V].
- **Render dari studio [V]**: Cassegrain 1900 frame dalam 31,2 s (1,02× real-time), −19,9 LUFS (target −19,8), tag BT.709.

Belum dibangun:
- Video referensi yang belum tercakup: HFfv (konvergen ke sumbu), nAlio (elips meregang), i8uP (ellipsoid 3D), bola basket (gravitasi), dua billiard, 13:8, tata surya, Koch, reaksi berantai.
- Preview di panel browser aplikasi ini dibatasi `requestAnimationFrame` ≈ 7 Hz oleh lingkungannya, sehingga 60 fps belum terukur di browser biasa [A].


### 11.1 Sistem style — identitas sendiri (2026-11-18)

Tujuannya agar video tidak terlihat meniru referensi. Desain lengkap ada di `docs/styles.md`, cara pakai dan cara menambah style di README "Styles".

**Sidik jari referensi (zona yang dihindari):**
- latar navy→hitam polos, dinding neon cyan, bola pelangi mengilap dengan glow dan ekor komet;
- jejak aditif tipis, aksen emas, DejaVu Bold rata tengah;
- gerak tanpa easing presentasi, bloom di mana-mana tanpa shake atau partikel;
- audio "tok" dan lonceng yang kering.

**Lima style:** Riso Print, Chalkboard, Amber Terminal, Candy Pop, Blueprint. Masing-masing berbeda di 6–7 dari 7 sumbu (palet, latar/tekstur, bahasa bentuk, tipografi, gerak, juice, audio); tabel lengkapnya di `docs/styles.md` §2. `classic` tetap ada sebagai default demi kompatibilitas.

**Arsitektur [V]:**
- `packages/theme`: token, validasi per token dengan fallback ke `classic`, registry, `paletteFor`. Satu style = satu berkas `themes/<id>.json`.
- Parameter `style` masuk lewat `commonSchema`, sehingga otomatis ikut preset, job render, thumbnail, dan cache audio.
- `render2d` (latar + tekstur, 7 gaya garis, 7 gaya bola, 3 gaya ekor, 6 bentuk partikel, header), `juice`, dan `audio` membaca token.
- Kedelapan scene memakai tema. Kode simulasi (`sim.ts`) tidak disentuh.

**Verifikasi:**
- **Fisika tidak berubah [V]:** state vector setiap scene identik di keenam style (`tests/theme.test.ts`).
- **Classic identik byte-per-byte [V]:** frame dan audio classic sama dengan kode sebelum tema pada 10 konfigurasi (`tools/hash-frames.ts`, dibandingkan dengan salinan tree lama).
- **Render nyata [V]:** scene cermin elips dirender penuh dalam 5 style plus classic (`output/styles/ellipse-*.mp4`; 1900 frame, H.264 High, 1080×1920, 60 fps, BT.709, AAC 44,1 kHz stereo, −19,8 sampai −20,2 LUFS).
- **Render dari tombol studio [V]:** gravity-bounce dengan Candy Pop; job membawa `style: "candy"` dan frame-nya benar.

**Bukti perbedaan [V]** (`node tools/style-evidence.ts`; gambar `docs/styles/ellipse-mp4-frames-t19.png`, `docs/styles/focal-reflection-vs-reference.png`):

| | latar mirip referensi | tinta referensi (cyan/emas) | jarak histogram hue (maks 2) | selisih rata-rata ke referensi |
|---|---|---|---|---|
| Classic Neon | 82 % | 1,5 % | 0,34 | 20 |
| Riso Print | 0 % | 1,5 % ¹ | 1,69 | 195 |
| Chalkboard | 0 % | 0,1 % | 1,68 | 43 |
| Amber Terminal | 2,5 % | 0,4 % | 1,90 | 26 |
| Candy Pop | 0 % | 0,6 % | 1,71 | 124 |
| Blueprint | 0 % | 0,1 % | 1,19 | 57 |

¹ Dari blok sorot kuning di judul Riso, yang dekat dengan emas referensi.

- **Antar-style:** selisih piksel rata-rata 34–209 (dari 255). Tes menjaga agar selisih ini > 12 di dua scene.
- **Pasangan terlemah:** Terminal vs Classic, 24. Keduanya gelap, tetapi hue-nya hampir saling lepas (1,90).
- **Audio:** keenam audio berbeda hash (tes). Centroid spektrum 2,3–4,5 kHz vs classic 5,6 kHz; spektrogram di `docs/styles/audio-spectrograms.png`, tabel di `docs/styles/audio-compare.md`.

**Audio per style.** ElevenLabs: **0 credit**. Tidak ada suara baru; perbedaan dibuat dari pustaka 8 sampel yang sudah ada plus synth:
- transposisi dan kuantisasi ke skala;
- pemetaan peran (mis. `tick → pop`);
- rantai efek deterministik: high/low-pass, drive, bitcrush, echo ping-pong, comb pendek (Blueprint), doubler (Candy).

**Masalah yang ditemukan dan diperbaiki saat verifikasi:**
- `destination-out` pada stroke lingkaran besar hanya terhapus sebagian di Skia, sehingga garis ganda Blueprint pecah. Diganti dengan pemotongan lewat `drawImage`.
- Setup Chalkboard butuh 29 s per instance di Node: 30 ribu `fillRect` destination-out. Diganti satu tile pattern, kini 72 ms; render 1900 frame turun dari 58 s ke 31 s.
- Riso dan Chalk berdengung di antara event: nada panjang (`ping → note`) plus drive membuat jeda hanya 5 dB di bawah tumbukan. Diretune: jeda Riso kini −54 dB, Chalk −32 dB (marimba yang sengaja berdenting ±1 s).
- Counter dalam pill (Candy) sulit terbaca, dan judul slide/typewriter kosong di frame 0 (cover Shorts). Keduanya diperbaiki.
- Latar Terminal terlalu mirip latar referensi (30% piksel). Dibuat lebih hangat, kini 2,5%.

**Performa:**
- **Classic sebelum → sesudah** (Node, 19 preset, draw per frame): sama dalam batas noise.
  - mirrors-ellipse p95 22,2 → 22,0 ms; render penuh 33,0 → 30,9 s.
  - Harmonograph sempat tampak +72%, tetapi pada pengukuran terpisah baseline 15,7 ms dan versi baru 8,8 ms (p50): itu efek urutan di dalam satu proses benchmark.
  - Baseline: `docs/bench/pre-theme-*.json`; sesudah: `post-theme-*.json`.
- **Biaya per style** (Node, resolusi penuh, draw p95 ms, `docs/bench/style-*-node.json`):

  | preset | classic | riso | chalk | terminal | candy | blueprint |
  |---|---|---|---|---|---|---|
  | mirrors-ellipse | 22,0 | 17,4 | 16,9 | 20,4 | 19,8 | 16,1 |
  | galton-board-wide | 13,4 | 3,9 | 3,9 | 13,2 | 3,8 | 3,5 |
  | butterfly-60-balls | 22,7 | 20,7 | 21,0 | 19,2 | 19,6 | 18,7 |

  Setup per instance 11–76 ms. Render penuh 1900 frame: 29,7–32,3 s untuk semua style (≈1× real-time), classic 30,9 s.
- **Preview browser** (Chrome di panel aplikasi, GPU sync, p95 ms):
  - focal-reflection resolusi penuh: classic 8,4, riso 8,5, chalk 8,8, terminal 8,2, candy 6,3, blueprint 8,5;
  - gravity-bounce ½ resolusi: 3,1–3,9;
  - galton ½ resolusi: 0,6–1,3;
  - kenaikan heap ≤ 9,5 MB.
- Semua aset tema (latar, tekstur, dinding, sprite, font) dibuat sekali per instance; loop frame tidak mengalokasi aset baru.

**Belum terverifikasi atau belum selesai:**
- **Font sistem:** font dipakai dari macOS (Avenir Next Condensed, Chalkduster, PT Mono, Arial Rounded, DIN Condensed). Di mesin lain tumpukan font jatuh ke DejaVu bawaan; fallback ini teruji di kode, tetapi tampilannya belum dilihat di mesin lain.
- **Audio didengar:** belum ada orang yang mendengarkan audio style. Perbedaannya hanya terukur (hash, spektrum, level jeda).
- **Classic tetap default:** pengguna perlu memilih style sendiri. Pilihan terakhir diingat studio per browser.
- **Lembar per scene sudah ada** (`docs/styles/*-sheet.png`), tetapi render MP4 penuh baru dibuat untuk satu scene (cermin elips) dalam semua style, plus gravity-bounce dalam Candy Pop.

### 11.2 Background yang bisa diatur per style (2026-11-18)

Memperluas sistem tema yang ada, tanpa sistem baru. Setiap berkas `themes/<id>.json` kini boleh memuat `background: { params, presets }`.

**Cara kerja [V]:**
- Satu parameter mendeklarasikan `type` (`number`, `color`, `enum`), `label`, `group`, `icon`, `default`, batas (`min`/`max`, `options`, `lumaMin`/`lumaMax` untuk warna), dan `target`, yaitu token tema yang ditimpa. Target `palettes.*` membuat deret warna bola dari satu warna.
- `themeOf(params)` menerapkan nilai pengguna pada tema satu kali per kombinasi (cache), jadi semua scene otomatis ikut dan kode simulasi tidak disentuh. Pengaturan yang masih default tidak menimpa apa pun.
- Nilai disimpan di parameter scene `bgSettings` (JSON hanya berisi nilai yang berbeda dari default). Karena itu ikut preset, job render, dan kunci thumbnail.
- Studio membuat kontrolnya dari skema (color picker, slider, pilihan) berikut preset warna dan tombol Reset; tidak ada kode UI per style. Pilihan disimpan per style di `localStorage`.
- Kode render: latar digambar sekali per instance (`makeBackground`, ditambah gradasi berarah dan titik fokus), tidak ada alokasi baru per frame.
- Nilai di luar batas dijepit; warna di luar rentang luminans ditarik ke default; JSON rusak, tipe salah, atau kunci tak dikenal kembali ke default tanpa error.

**Parameter per style** (jumlah: classic 14, riso 11, chalk 9, terminal 12, candy 11, blueprint 12):

| Style | Grup dan parameter | Preset |
|---|---|---|
| Classic Neon | Warna dasar (atas, tengah, bawah); Gradasi (arah −60…60°, titik x/y, pinggir gelap); Neon (warna garis, warna glow, intensitas glow 0…1,6); Grid (aktif, kerapatan, kekuatan, warna) | Deep navy, Midnight violet, Ocean, Ember, Graphite grid |
| Riso Print | Kertas (warna, bayangan bawah, arah); Tinta (tinta 1, tinta 2 misprint, judul, sorot); Tekstur (halftone/grain/none, ukuran titik, kekuatan, warna) | Pink & blue, Teal & coral, Sunny paper, Mint & violet |
| Chalkboard | Papan (3 warna, pinggir gelap); Noda (jenis, jumlah debu, warna debu); Kapur (warna garis, warna garis bawah/angka) | Green board, Blackboard, Blue slate, Freshly wiped |
| Amber Terminal | Layar (3 warna kaca, titik pusat x/y); CRT (kekuatan dan jarak scanline, kelengkungan); Phosphor (bloom, warna garis, warna teks, tint bola) | Amber, Green phosphor, Ice blue, White P4 |
| Candy Pop | Latar (warna tengah, tepi, pinggir gelap); Sunburst (warna, kekuatan, jumlah sinar, titik pusat); Stiker (outline, bayangan, warna angka) | Grape, Bubblegum, Lime soda, Sunset |
| Blueprint | Lembar (3 warna, arah); Grid (jenis, kerapatan, kekuatan, warna); Tinta (garis, garis sumbu, angka "pensil merah") | Blueprint, Teal draft, Graphite, Violet draft |

**Verifikasi:**
- **Tes** (`tests/background.test.ts`, 8 tes; total 48 lulus, `tsc` bersih):
  - skema valid dan berbeda antar style;
  - default sama dengan token tema;
  - semua preset valid;
  - batas nilai, termasuk luminans;
  - fallback untuk 9 jenis masukan rusak di 6 style;
  - deklarasi yang cacat dibuang dengan peringatan;
  - perubahan terlihat di semua 8 scene, sedangkan pengaturan default tidak mengubah piksel sama sekali.
- **Preview vs render [V], 2 style** (`docs/styles/background-preview-vs-render.md`, gambar `docs/styles/background-custom-mp4.png`): gravity-bounce 8 s, pengaturan diubah di studio, MP4 dirender lewat CLI. Warna 7 blok latar di preview browser vs MP4 beda rata-rata 0,55/255 (classic) dan 0,61/255 (riso). Pengaturan itu sendiri menggeser latar 5,8 dan 25,1, jadi kecocokan bukan karena tidak ada perubahan.
- **Studio [V]:** panel muncul, klik preset dan geser slider mengubah preview dan tersimpan; di classic panel menampilkan 4 grup dan 5 preset.
- **Classic tetap identik byte-per-byte [V]** pada 8 scene terhadap tree sebelum tema.
- **Performa [V]:** draw p95 riso 4,0 ms (galton) dan 18,1 ms (cermin elips); blueprint 17,6 ms, sama seperti sebelumnya.

**Belum terverifikasi:**
- Kontrol di studio baru dicoba pada classic dan lewat tes untuk empat style lain; panel keempat style itu belum saya lihat satu per satu di layar.
- Preview vs render diuji pada 2 style (classic, riso), bukan 5.
- Color picker diuji lewat kode (nilai dijepit lalu ditampilkan ulang), tetapi belum diklik dengan mouse.
- Studio ini tidak punya tombol "salin pengaturan ke style lain": pengaturan bersifat per style.

### 11.3 UX dan visual studio (2026-11-18)

Audit berbasis bukti dulu (alur dari nol di 1440×900 dan 1280×720), lalu 10 perbaikan yang disetujui. Screenshot: `docs/ux/before/` dan `docs/ux/after/`. Tidak ada scene, style, atau fitur tracking baru; kode simulasi, render queue, dan render 1080×1920 @60 fps tidak diubah.

**Temuan utama (sebelum):** setelah klik Render tidak ada yang berubah di layar karena daftar render ada di y=2171 dari panel kanan setinggi 2281 px; parameter utama scene baru mulai di y=1350 (di bawah 6 kartu style dan panel background 633 px); galeri 20 kartu tanpa pencarian; error jaringan saat render tidak menampilkan apa pun; statistik mentah selalu tampil; Reset dipakai dua kali dengan arti beda.

**Perubahan:**
1. **Status render selalu terlihat** di bawah preview: antre, menyiapkan suara, merender (persen, fps, sisa waktu), selesai dengan *Play*, *Show in folder*, *Copy path*; berkedip hijau saat selesai dan judul tab berubah bila tab tersembunyi.
2. **Tombol Render pindah ke baris transport** (selalu di layar), tanpa penomoran 1-2-3.
3. **Panel kanan dua tab: Basic dan Advanced.** Basic = opsi utama scene (grup pertama terbuka, grup lain terlipat) + kartu Style. Advanced = background, timing, warna dan jejak, suara, juice, reset, simpan preset, simulation check.
4. **Pencarian scene** (`/`, Enter membuka hasil pertama, Esc membersihkan), chip kategori tetap; preset dikelompokkan di bawah scene induknya (`↳ nama scene`); thumbnail galeri dipotong ke 9:13 agar lebih banyak kartu muat.
5. **Pesan error yang bisa dipahami** (`friendlyError`: server mati, ffmpeg tidak ada, disk penuh, izin tulis, encoder berhenti, proses render crash, scene hilang) beserta langkah berikutnya; tombol menunjukkan "Queuing…"; peringatan validasi jadi satu kalimat tenang; pesan non-job hilang sendiri setelah 10 s.
6. **Shortcut keyboard**: `R` render, `/` cari, `[` `]` scene, `1`–`6` style, `M` suara, `D` statistik, `?` daftar (dialog); Space/panah tetap. Cmd/Ctrl+huruf tidak dibajak; Space pada tombol yang fokus tetap milik tombol itu.
7. **Hasil mudah ditemukan**: *Show in folder* (`POST /api/reveal`, hanya berkas di `output/`), *Copy path*, dan riwayat 5 render terakhir dipulihkan dari `output/` setelah server restart. Nama berkas kini memuat style.
8. **Preview lebih lega**: statistik mentah disembunyikan (tombol `D`), kolom kiri dan kanan memakai lebar `clamp`, deskripsi scene dipotong 2 baris, kartu style 5:4.
9. **Kosakata konsisten**: "Reset scene options" vs "Reset background", grup "Style" milik scene menjadi "Colours & trails", "Effects (juice)", aksen warna kategori dipakai di tab dan kartu style yang terpilih.
10. **Alur satu jalur**: Galeri → Preview → Render, tanpa langkah bernomor.

**Sebelum → sesudah [V]** (Chrome di panel aplikasi, `localStorage` kosong):

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Klik ke render pertama | 1 | 1 (atau tekan `R`) |
| Terlihat bahwa render berjalan | tidak terlihat (gulir ±2171 px) | langsung, tanpa gulir |
| Langkah menemukan hasil | gulir ±2171 px + 1 klik | 0 gulir; 1 klik (*Play* / *Show in folder*) |
| Tinggi panel kanan 1440×900 / 1280×720 | 2281 / 2822 px | 900 (tanpa gulir) / 884 px |
| Kartu Style terlihat tanpa gulir (1440×900) | tidak (y=706–1350) | ya |
| Opsi utama scene mulai di | y=1350 px | di atas kartu Style (y≈100) |
| Ukuran preview 1280×720 | 339×603 px | 323×574 px ¹ |
| Ganti scene (sinkron) | 4–24 ms (pendulum pertama 123 ms) | 11–23 ms (pendulum pertama 183 ms ²) |
| Ganti style (sinkron) | 3–16 ms | 0–1 ms |
| Buka studio | 43–68 ms | 70 ms (satu ukuran, dalam noise) |
| Biaya preview focal ½ res, p95 | 1,5 ms | 1,7 ms (noise) |
| Tes | 48 | 53 (5 tes baru di `tests/ux.test.ts`) |

¹ Preview sedikit lebih kecil karena strip status menempati satu baris di bawah transport; ini harga dari status yang selalu terlihat.
² Biaya sekali jalan pada kunjungan pertama (sintesis font/audio), sama seperti sebelumnya.

**Performa:** baseline tidak menunjukkan masalah (preview p95 ≤ 9,6 ms di resolusi penuh, ganti scene/style < 25 ms), jadi tidak ada optimasi yang dikerjakan.

**Belum terverifikasi:**
- FPS tampilan nyata di layar: `requestAnimationFrame` di panel aplikasi ±11 Hz; yang terukur hanya biaya per frame.
- Tampilan di jendela lain selain 1440×900 dan 1280×720; layar sempit (< 1100 px) belum dirancang.
- *Show in folder* dipanggil lewat server (`open -R` di macOS); jalur Windows (`explorer /select`) dan Linux (`xdg-open`) tertulis tetapi belum dicoba.
- Pesan error untuk ffmpeg hilang, disk penuh, dan izin tulis diuji lewat unit test (teks), bukan dengan memicu kegagalan nyata; yang dipicu nyata hanya server tidak terjangkau.
- Pembacaan layar (screen reader) dan navigasi penuh dengan keyboard belum diuji.

### 11.4 Alur video YouTube dan tracking publikasi (2026-11-18)

Tidak ada upload otomatis dan tidak ada permintaan kredensial; semuanya berkas lokal. Scene, style, dan mesin render (`render-job.ts`, `worker.ts`) tidak diubah; server hanya mencatat render yang dimulai dari studio. Cara pakai di README ("Videos: texts, status and tracking"). Gambar: `docs/videos/`.

**Dibuat:**
- **Metadata** (`packages/publish`): judul (plus 2 ide judul), deskripsi, tag, hashtag, catatan. Terisi otomatis dari hook scene (atau pertanyaan layout bila kosong), deskripsi scene, nama style, dan topik; bisa diedit, ada penghitung dan peringatan lembut sesuai batas YouTube (100/5000/500/60, lihat 11.4.1), tombol salin per kolom, "salin semua", dan "Suggest again". Format Shorts 1080×1920 @60 fps.
- **Hasil render**: nama `<scene>-<layout>-<style>-<stempel waktu>.mp4`; *Play* dan *Show in folder* di strip status, *Copy path* di riwayat render, dan *Show MP4 in folder* di halaman video. **Thumbnail** = memilih frame dari video (jeda lalu "Use this frame"); disimpan sebagai PNG 1080×1920 di `data/thumbnails/` lewat ffmpeg, tanpa editor.
- **Tracking**: status draft, rendered, scheduled, published; tanggal jadwal, tanggal terbit (otomatis hari ini bila kosong), tautan YouTube, catatan; tersimpan otomatis. Entri dibuat otomatis saat render dimulai, menjadi *rendered* saat selesai, dan dibuang bila render gagal dan belum diedit. Tombol "Import earlier renders" memasukkan MP4 lama di `output/`.
- **Daftar**: filter status (dengan jumlah), pencarian (judul, deskripsi, tag, catatan, scene, style, tautan), baris berwarna menurut status, dan **peta cakupan scene × style** (8 × 6 = 48 sel; ringkasannya "N dari 48 belum pernah dijadikan video"; klik sel membuka scene dan style itu di studio). Badge di tombol Videos = jumlah yang sudah dirender tetapi belum diterbitkan. Pintasan `V`.
- **Penyimpanan** (`apps/server/store.ts`, folder `data/`, terpisah dari `references/`; `SIM_DATA_DIR` mengganti lokasinya): tulis ke berkas sementara, fsync, lalu rename; cadangan otomatis sebelum setiap penimpaan (50 terbaru + 1 snapshot per hari selama 60 hari); `schemaVersion` di berkas (ada kait migrasi; versi lebih baru tidak ditimpa); ekspor CSV dan JSON serta "Open data folder". Perubahan bersifat transaksional: bila gagal disimpan, daftar di memori tidak berubah dan studio menampilkan "Not saved: …". Kegagalan pencatatan tidak pernah menggagalkan render.
- **Pemulihan**: berkas hilang, JSON terpotong, kosong, `[]`, `null`, tanpa versi, tanpa daftar, versi skema lebih baru, atau entri rusak tidak membuat studio crash. Berkas rusak dipindahkan utuh ke `data/videos.damaged-*` (atau `videos.newer-*`), cadangan terbaru yang sehat dipulihkan atau daftar dimulai kosong, dan banner kuning menjelaskan apa yang terjadi. Entri rusak dilewati, entri sehat tetap; id ganda diganti.

**Jumlah klik, render → ditandai "dipublikasikan" [V, dilakukan sungguhan di studio]:**

| Langkah | Klik |
|---|---|
| Render MP4 | 1 |
| "Texts & publish" di bawah preview (membuka entri render itu) | 2 |
| "Copy title, description and tags" | 3 |
| *(unggah di YouTube di luar studio)* → "Published" (kolom tautan langsung fokus) | 4 |
| Tempel tautan | 0 klik (ketik/tempel; tersimpan otomatis, tanggal terbit terisi hari ini) |

Total **4 klik + 1 tempel** di dalam studio. Memilih thumbnail menambah 2 aksi (cari frame, "Use this frame") dan bersifat opsional.

**Diverifikasi:**
- **Tes** (`tests/publish.test.ts`, 14 tes; total 67 lulus, `tsc` bersih):
  - saran metadata terisi dan valid untuk 8 scene × 6 style;
  - batas dan peringatan, penguraian tag/hashtag;
  - perubahan status (tanggal otomatis, daftar kolom yang boleh diubah, nilai ngawur, pemisah path dibuang);
  - filter, pencarian (tanpa aksen), peta cakupan, CSV (kutip di-escape);
  - **penulisan atomik**: gagal saat rename dan gagal saat menulis (disk penuh) membuat berkas lama utuh, tanpa berkas `.tmp`, dan daftar di memori tidak berubah;
  - cadangan sebelum setiap penimpaan dan retensi;
  - **pemulihan** dari 7 jenis berkas rusak, rusak tanpa cadangan, hilang dengan dan tanpa cadangan, versi lebih baru, entri rusak, dan folder data yang tak bisa dibuat.
- **Data contoh di server sungguhan** (6 entri semua status): berkas dirusak saat server berjalan lalu diedit (berkas utama pulih dari memori, berkas rusak disimpan); dihapus lalu restart (dipulihkan dari cadangan); terpotong; skema 99; rusak tanpa cadangan (mulai kosong dengan pesan). Tidak ada crash. Banner kuning dan keadaan kosong terlihat di layar.
- **Alur lengkap di browser**: render sungguhan → entri otomatis (rendered, 8,0 MB, 31,7 s) → "Texts & publish" → thumbnail frame 7,3 s menjadi PNG 1080×1920 → Published → tautan tersimpan, tanggal terbit otomatis, badge turun, baris menjadi hijau. Tata letak dicek di 1440×900 dan 1280×720.
- Peta cakupan: klik sel membuka scene dan style yang tepat di studio.
- **Bug yang ketemu dan diperbaiki**: penyimpanan berurutan (status lalu tautan) bisa tumpang tindih, sehingga tampilan dirender sebelum respons server (tanggal terbit kosong di layar). Kini penyimpanan diserialkan dan status menunggu hasilnya.

**Belum terverifikasi:**
- ~~Tombol salin~~ diverifikasi lewat clipboard sistem (11.4.1); tempel di dalam halaman tidak bisa diuji di panel.
- ~~Open data folder / Show in folder~~ sudah diklik di macOS (11.4.1); jalur Windows dan Linux tertulis tetapi tidak dicoba.
- ~~Batas YouTube~~ sudah dicek ke sumber resmi (11.4.1); satu-satunya yang tidak terdokumentasi resmi adalah bentuk tautan `/shorts/` dan `youtu.be/`.
- ~~Hanya bahasa Inggris~~ kini ada pilihan Indonesian (11.4.1); kualitas judul/deskripsi belum dinilai manusia.
- ~~Dua studio sekaligus~~ kini ditangani dengan berkas kunci (11.4.1).
- Peta cakupan menghitung scene × style, bukan layout atau preset; dua video dengan layout berbeda pada scene dan style yang sama terhitung satu sel.
- ~~Render CLI~~ kini muncul lewat banner impor (11.4.1); tidak otomatis diimpor.

#### 11.4.1 Celah yang ditutup (2026-11-18, lanjutan)

Total tes sekarang 72 (67 lama tetap lulus + 5 baru di `tests/publish.test.ts`), `tsc` bersih. Scene, style, dan mesin render tidak diubah.

**1. Render dari CLI tercatat.** `apps/server/scan.ts` memindai `output/` saat Videos dibuka: MP4 di folder itu dengan `.job.json` di sebelahnya (selalu ditulis `renderJob`, nama `--out` bebas) yang belum ada di daftar. Duplikat dihindari lewat nama berkas; berkas yang berubah < 15 detik terakhir (masih ditulis), tanpa `.job.json` atau `.job.json` rusak, scene tidak dikenal, kosong, dan render studio yang sedang jalan atau gagal dilewati. Pemindaian tidak mengubah apa pun di `output/`. UI: banner "N renders are in output/ but not in this list yet" dengan satu tombol "Add all N to the list"; tidak ada impor otomatis.
- Diverifikasi: tes pemindaian (13 kasus berkas); di server sungguhan (data contoh di folder sementara) banner muncul dengan 13, satu klik menambah 13 (daftar 6 → 19), impor kedua menambah 0, tanpa nama ganda; satu render CLI sungguhan (`--out output/zz-cli-test.mp4`) tidak muncul segera (masih < 15 detik), lalu muncul sebagai "1 render" setelah 16 detik.
- Catatan: hitungannya 13, bukan 4 seperti di laporan sebelumnya, karena aturan lama mensyaratkan nama berstempel waktu; aturan baru menerima nama apa pun asal ada `.job.json`, sehingga hasil `npm run render -- --preset …` dan benchmark lama ikut terhitung. Berkas di `output/` tidak disentuh dan tidak ada yang diimpor ke `data/` pengguna.

**2. Kunci `data/.lock`.** Berisi PID dan waktu mulai, dibuat dengan `wx` (eksklusif). Pemegang kunci yang prosesnya sudah mati (cek `kill -0`; EPERM dianggap hidup) dianggap basi dan diambil alih; kunci kosong/rusak dianggap basi hanya bila lebih tua 3 detik. Studio kedua membuka daftar baca-saja: tidak membuat, memindah, memulihkan, atau menulis berkas apa pun di `data/`, semua endpoint tulis menjawab 423 "Read-only: …", banner merah di Videos, kolom edit dinonaktifkan (tombol salin, pemutar, dan daftar tetap berfungsi), dan daftar dimuat ulang dari disk tiap kali diminta. Bila studio pertama hilang, studio kedua mengambil alih sendiri pada permintaan berikutnya. Kunci dilepas saat berhenti normal (SIGINT/SIGTERM/exit).
- Diverifikasi dengan **empat server sungguhan** pada satu folder data (`kill -9`, bukan simulasi): A menulis; B (folder sama) baca-saja, PATCH/import/settings/delete semuanya 423, hash `videos.json` dan isi folder identik sebelum dan sesudah; A dimatikan paksa (`kill -9`, kunci tertinggal dengan PID 12038); B mengambil alih pada permintaan berikutnya (kunci menjadi PID B) dan bisa menyimpan; C mulai saat B hidup → baca-saja; B dimatikan paksa lalu C direstart di atas kunci basi → bisa menulis; berhenti normal menghapus `.lock`. Screenshot baca-saja dengan banner dicek; perubahan dari A langsung terlihat di B.
- Tes unit: pemegang kedua, pengambilalihan, kunci basi, kunci sampah/kosong, folder tak bisa dibuat, berkas data rusak tidak disentuh saat baca-saja.
- Batas: PID bisa dipakai ulang oleh proses lain setelah crash, sehingga kunci basi tampak "hidup" sampai proses itu berhenti (bisa dibersihkan dengan menghapus `data/.lock`); kunci tidak melindungi dari proses di komputer lain pada folder jaringan.

**3. Batas YouTube diverifikasi (dicek 2026-11-18).** Sumber resmi:
- Judul, deskripsi, tag: [YouTube Data API, resource `videos`](https://developers.google.com/youtube/v3/docs/videos). `snippet.title`: maksimum **100 karakter**, tanpa `<` dan `>`. `snippet.description`: maksimum **5000 byte** (bukan karakter), tanpa `<` dan `>`. `snippet.tags[]`: maksimum **500 karakter** total; koma antar-tag dihitung; tag yang berisi spasi dihitung seolah diberi tanda kutip (contoh resmi: "Foo-Baz" = 7, "Foo Baz" = 9).
- Hashtag: [YouTube Help, "Find playlists & videos using hashtags"](https://support.google.com/youtube/answer/6390658?hl=en). Bila lebih dari **60** hashtag, semuanya diabaikan; maksimum tiga hashtag tampil di atas judul; hashtag tanpa spasi.
- Perbedaan dengan kode lama: hashtag **15 → 60** (angka 15 salah); deskripsi kini dihitung dalam **byte UTF-8** (huruf beraksen dan emoji lebih dari 1 byte); peringatan baru untuk `<` dan `>`; hitungan tag sudah sesuai aturan kutip dan koma.
- Format tautan: halaman bantuan resmi ([Share videos and channels](https://support.google.com/youtube/answer/57741?hl=en&co=GENIE.Platform%3DDesktop)) hanya menampilkan bentuk `youtube.com/watch?v=<ID>` dengan ID **11 karakter** (contoh resmi `Ya_4rht4DG8`). Bentuk `youtube.com/shorts/<ID>` dan `youtu.be/<ID>` **tidak dijelaskan di halaman resmi yang saya temukan**; keduanya tetap diterima karena tautan bagikan YouTube memang memakainya (pengetahuan umum dan sumber nonresmi). Validator sekarang mensyaratkan ID tepat 11 karakter `[A-Za-z0-9_-]` dan menerima `watch?...&v=<ID>`.
- Pemeriksaan ini hanya peringatan; tidak ada yang memblokir penyimpanan. Konstanta: `LIMITS` di `packages/publish/index.ts`, dengan tes yang mengunci angkanya.

**4. Tombol salin.** Urutan: Clipboard API → `execCommand('copy')` → kotak teks terpilih ("Select and copy ↓") agar Ctrl/Cmd+C bisa dipakai; tombol berubah "Copied ✓" 1,6 detik.
- Diverifikasi di browser dengan klik sungguhan: umpan balik "Copied ✓"; isi **clipboard macOS** dibaca dengan `pbpaste` setelah klik "Copy" judul (tepat judulnya) dan setelah "Copy title, description and tags" (judul, deskripsi, hashtag, dan "Tags: …" lengkap sesuai layar). Kegagalan Clipboard API dipaksa (di-override) → jatuh ke kotak teks terpilih dengan isi yang benar; kegagalan `execCommand` juga dipaksa.
- **Tidak bisa dilakukan:** menempel ke kolom input di browser. Di panel browser aplikasi, Cmd+V dan Ctrl+V tidak menghasilkan tempelan (tombol sintetis tidak memicu perilaku tempel; `clipboard.readText` ditolak izin). Sebagai gantinya isi clipboard sistem diperiksa lewat `pbpaste`, yang membuktikan isi yang sampai ke clipboard, bukan perilaku menempel di halaman.
- Belum teruji: jalur `execCommand` berhasil (di panel ia mengembalikan false karena klik berasal dari skrip).

**5. "Open data folder" dan "Show in folder" di macOS.** Dua-duanya diklik sungguhan di browser, hasilnya dibaca dari Finder lewat `osascript`: "Open data folder" membuka jendela Finder `uidata` (path folder data yang dipakai server); "Show MP4 in folder" membuka `/Users/aldo/2D-Simulation-For-Video/output/` dengan `orbit-rosette.mp4` terpilih (dicek dua kali, juga dibandingkan dengan `open -R` langsung). Jendela Finder yang saya buka ditutup lagi. Tombol "Show in folder" di strip status memakai endpoint yang sama dan tidak diklik terpisah.

**6. Bahasa saran.** Menu "Suggestions" (English default, Indonesian) di bilah Videos; disimpan di `data/videos.json` (`settings.suggestLang`, kolom opsional sehingga berkas lama tetap sah dan `schemaVersion` tetap 1; nilai tak sah kembali ke English). Dipakai untuk entri baru dari render, "Suggest again", dan ide judul; hanya templat saran, bukan terjemahan UI. Versi Indonesia: judul utama berupa kalimat Indonesia per topik (hook di layar yang berbahasa Inggris tetap menjadi salah satu ide judul), deskripsi, tag (campuran topik Indonesia dan nama scene/style), dan hashtag (#Shorts #fisika #matematika …).
- Diverifikasi: tes untuk 8 scene (judul berbeda, batas panjang terpenuhi, hashtag benar, bahasa default English, nilai tersimpan dan nilai tak sah jatuh ke English); di browser mengganti ke Indonesian lalu "Suggest again" menghasilkan judul, deskripsi, tag, dan hashtag Indonesia yang tersimpan; menu dinonaktifkan saat baca-saja.
- Belum: kualitas bahasa belum dinilai penutur asli; templat Indonesia tidak mengikuti judul khusus tiap layout (satu kalimat per kategori scene).

---

## 12. Tahap "alat produksi" (2026-11-17, lanjutan)

Lihat juga README: Scenes, Juice, Sound.

### Fase 0 — audit & rencana
- **Mekanisme referensi** (lihat `docs/analysis.md` §2): pantulan konik (10), billiard (2), orbit (3), osilasi (1), fraktal + reaksi berantai (2). Yang sudah dibangun sebelum tahap ini: konik (6 tata letak), rosette, pendulum wave.
- **Scene baru, diurutkan dari yang paling berbeda dengan scene lama**:
  - peluang (Galton);
  - chaos (bola di bawah gravitasi);
  - osilasi teredam (harmonograf);
  - resonansi orbit (13:8);
  - billiard (segitiga/lingkaran/persegi).

  Risiko tinggi ditunda: tata surya 3D, reaksi berantai, Koch.
- **Juice**: shake, flash, partikel, squash/stretch, counter pop/roll, warna energi, easing.
- **Suara**: lihat §12 Fase 3.
- **UX**: galeri thumbnail, kategori berwarna dengan ikon, alur 1-2-3, grup lanjutan dilipat, kualitas preview otomatis.
- **Performa**: profil baseline menunjuk dua titik panas, yaitu blit layer layar penuh dan sintesis audio pendulum.

### Fase 1 — scene baru [V]
Enam scene baru dengan pengujian fisika:
- **galton-board**: χ² terhadap Binomial.
- **gravity-bounce**: drift energi 1,8·10⁻¹⁴; celah 10⁻⁹ px menjadi > 50 px dalam 25 s.
- **harmonograph**: bentuk tertutup.
- **resonance-orbits**: penutupan < 10⁻¹¹ px.
- **billiard**: 2/7 → 7 pantulan, 5:3 → 16 pantulan, 1/φ² tidak pernah menutup.

Semuanya hanya memakai dmath, dan hash state golden-nya tercatat.

### Fase 2 — juice [V]
`packages/juice`:
- Pool partikel berukuran tetap (struct-of-arrays) dan RNG ber-seed. State-nya ikut snapshot.
- Tiap efek punya slider 0–2; nilai 0 mematikannya (diuji).
- Dipakai di 8 scene. Pendulum wave tetap bisa di-seek karena efeknya dihitung murni dari waktu.

### Fase 3 — audio [V]
- Daftar kebutuhan ditulis dulu (`assets/sfx/requests.json`): 8 SFX, sedangkan 2 peran bernada sengaja disintesis secara lokal.
- **Satu batch ElevenLabs** (`eleven_text_to_sound_v2`, 1 variasi per suara): estimasi 75 credit, **terpakai 26 credit**. Kuota bulan ini 20 642 → 20 668 dari 38 333.
- Pustaka lokal berisi manifest (nama, peran, tag, durasi, prompt, hash prompt) dan file asli di `src/`, sehingga bisa diproses ulang tanpa credit.
- `tools/sfx.ts import` menolak hash yang sudah ada (diuji). Untuk peran yang belum punya sampel, sintesis lokal dipakai sebagai fallback.
- Ditemukan DC offset −0,029 pada hasil render. Penyebabnya sampel yang tidak simetris lalu ditumpuk ribuan kali. Diperbaiki dengan high-pass 25 Hz pada sampel dan DC blocker di `master()`, sehingga offset menjadi −0,00001 [V].

### Fase 4 — studio [V di browser]
Galeri dengan thumbnail yang dirender sekali di server (dicache dengan kunci hash parameter), filter kategori, langkah 1-2-3, dan antrean render yang di-update di tempat (tanpa membangun ulang DOM).

### Fase 5 — performa
Lihat tabel di `docs/bench/` (`node tools/bench-compare.ts`). Perbaikan yang **terukur**:
- **Offset shake di-snap ke piksel utuh**: p95 elips 38 → 23 ms. Shake sub-piksel memaksa semua blit layar penuh melalui resampling bilinear.
- **`bakeStatic`**: dinding neon digabung ke latar sekali saja, sehingga ada satu blit layar penuh lebih sedikit per frame.
- **`TrailHistory`** menggantikan layer yang di-fade: harmonograf p50 11,0 → 8,7 ms, RSS −16 MB. Ini juga menghilangkan garis hantu 8-bit yang tidak pernah hilang.
- **Cache suara sintesis**: audio pendulum 1423 → 239 ms.
- **Preview**: tier kualitas Auto/High/Low (resolusi, jumlah partikel, glow) dengan penurunan otomatis bila frame lambat. Pekerjaan berhenti saat tab tersembunyi. Render final selalu kualitas penuh.

#### Angka sebelum → sesudah [V]

**Render offline (Node, set preset yang sama, urutan sama, satu proses).** Scene lama kini membawa juice dan tetap lebih cepat. Tabel dihasilkan oleh `node tools/bench-compare.ts docs/bench/baseline-node.json docs/bench/after-node-same-set.json`:

| preset | draw p50 ms | draw p95 ms | draw max ms | full render s | RSS peak MB |
|---|---|---|---|---|---|
| mirrors-cassegrain | 12.21 → 11.43 (-6 %) | 15.04 → 12.91 (-14 %) | 38.2 → 14.2 (-63 %) | 31.42 → 27.29 (-13 %) | 132 → 138 (5 %) |
| mirrors-corner | 14.39 → 12.21 (-15 %) | 18.89 → 16.57 (-12 %) | 27.8 → 25 (-10 %) | 33.62 → 30.66 (-9 %) | 304 → 274 (-10 %) |
| mirrors-ellipse | 12.64 → 11.99 (-5 %) | 23.93 → 23.2 (-3 %) | 72.2 → 26.3 (-64 %) | 32.4 → 33.28 (3 %) | 370 → 347 (-6 %) |
| mirrors-gregorian | 12.58 → 11.2 (-11 %) | 13.95 → 12.83 (-8 %) | 30.1 → 20 (-34 %) | 28.99 → 26.92 (-7 %) | 454 → 407 (-10 %) |
| mirrors-parabola | 12.49 → 10.95 (-12 %) | 14.96 → 11.83 (-21 %) | 25.3 → 13.2 (-48 %) | 33.54 → 26.05 (-22 %) | 372 → 371 (-0 %) |
| mirrors-peanut | 13.77 → 11.64 (-15 %) | 22.91 → 20.22 (-12 %) | 51.9 → 55.8 (8 %) | 33.79 → 30.81 (-9 %) | 488 → 422 (-14 %) |
| orbit-rosette | 8.88 → 8.52 (-4 %) | 10.26 → 10.05 (-2 %) | 18.6 → 19.7 (6 %) | 22.25 → 21.63 (-3 %) | 502 → 448 (-11 %) |
| pendulum-wave | 7.97 → 5.73 (-28 %) | 29.12 → 6.79 (-77 %) | 234.7 → 10.8 (-95 %) | 20.44 → 16.1 (-21 %) | 553 → 478 (-14 %) |

Sintesis audio: pendulum 1423 → 254 ms, rosette 166 → 80 ms, scene cermin 50–82 → 34–61 ms. Delta RSS per scene tidak berubah berarti (0–42 MB). *Kolom "RSS peak" adalah memori kumulatif proses, karena preset dijalankan berurutan dalam satu proses, jadi tidak bisa dibaca sebagai memori per scene.*

Catatan jujur: run benchmark gabungan dengan 19 preset (`after-node.json`) sempat menunjukkan corner p95 61 ms. Dijalankan sendiri, corner p95 17 ms (lebih baik dari baseline 18,9), jadi angka 61 ms itu efek urutan run dan memori proses yang sudah membengkak, bukan regresi kode.

**Preview di browser** (Chrome 156 di panel aplikasi, panel tersembunyi, sinkronisasi GPU dipaksa setiap frame sehingga ini batas atas):

| scene | half-res (tier *mid*, default Auto) p50 / p95 ms | full-res p50 / p95 ms | frame > 16,7 ms |
|---|---|---|---|
| focal-reflection | 5,2 / 9,4 (900 frame); 2,3 / 5,2 (1900 frame) | 11,6 / 17,1 (frame 1300–1900, 377 bola) | 0 di half-res |
| pendulum-wave | 1,6 / 1,9 | 4,3 / 5,4 | 0 |
| gravity-bounce | 3,2 / 3,6 | 9,6 / 10,4 | 0 |
| galton-board | 0,5 / 0,6 | 3,8 / 4,8 | 0 |
| rosette / harmonograph / resonance / billiard | ≤ 1,9 / ≤ 2,1 | — | 0 |

Baseline browser yang sebanding hanya ada dari Fase 2 (prototipe P1 full-res: p50 9,2 / p95 16,4 ms). Proyek ini bukan repo git, sehingga kode lama tidak bisa dijalankan ulang di browser untuk perbandingan langsung.

**[A] Belum terjelaskan:** satu run focal full-res di browser memberi p95 181 ms. Tiga run berikutnya, dengan parameter dan efek yang sama, memberi 17 ms. Kemungkinan penyebabnya tekanan memori GPU dari banyak canvas uji sebelumnya di halaman yang sama, tetapi ini belum dibuktikan.

**[A] 60 fps nyata:** panel browser aplikasi dibatasi `requestAnimationFrame` ≈ 7 Hz, sehingga 60 fps yang benar-benar tampil di layar belum terukur. Yang terukur adalah biaya per frame, yang muat dalam anggaran 16,7 ms.

### Yang belum selesai
- Scene berisiko tinggi: tata surya 3D, reaksi berantai, Koch. Juga varian konik yang belum ada: konvergen ke sumbu, elips meregang, ellipsoid 3D, bola basket.
- Pencocokan visual tata letak cermin dengan referensinya (posisi/ukuran masih estimasi).
- Penurunan kualitas otomatis hanya bergerak mid → low. Tier *high* yang dipilih manual tidak diturunkan.

## 13. Template dari references/2: Hammer smash dan Sync & close (2026-11-18)

Dua template parametrik baru, terdaftar di studio seperti scene lain (kategori **Smash** dan **Sync**), memakai toolkit juice, pustaka suara, style/background yang ada, dan tersambung ke tracking Videos. Arahnya terinspirasi tujuh video di `references/2` (hanya dibaca); judul, handle, dan konten persisnya tidak ditiru: aturan, bentuk, teks, dan palet dirancang sendiri.

### 13.1 Analisis singkat (frame + ritme audio)

| Keluarga | Mekanisme inti | Ketegangan | Klimaks | Akhir |
|---|---|---|---|---|
| A. Palu vs bola | wadah segi delapan dengan 4 dudukan palu; palu keluar bergantian; bola yang terjepit pecah menjadi 3, atau pantulan di dalam kotak (empat palu bertemu) menambah 1 bola | jumlah bola naik kira-kira eksponensial (1 → ±2.000); pukulan makin rapat; suara dasar naik dari sekitar −42 ke −28 dB, tiap pukulan menjadi puncak | wadah penuh dan meledak; audio memuncak di −9 dB | diputar mundur (◀◀) dan hitungan turun ke 1: video bisa di-loop |
| B. Sejajar dan garis menutup | titik dengan periode berbeda disambung satu garis; bandul di dinding V; garis baru tiap 2,5 s yang ternyata menggambar lingkaran; pena dua lengan rasio π; bola yang semuanya menyentuh tutup bersamaan | bentuk berganti (spiral, segi banyak, bintang) menuju garis lurus; hitungan "LINES k/24", "turns"; audio crescendo | kembali berbaris / "almost closed" di 7 dan 113 putaran / pengungkapan | kalimat pengungkap atau "it never closes" |

Catatan jujur: sebagian keluarga B sudah ada di proyek (`pendulum-wave`, `rosette-orbit`, preset parabola di `focal-reflection`), jadi template B sengaja berfokus pada mekanisme yang belum ada: lap berbeda yang sejajar lagi, pantulan yang semuanya menyentuh tutup, garis yang menyembunyikan bentuk, dan pena yang menutup atau tidak.

### 13.2 Template dan varian

**Hammer smash** (`packages/scenes/hammer-smash/`): 3 aturan × 5 wadah × 6 jenis objek × 1–4 palu × gravitasi, ditambah seed.

| Varian | Aturan |
|---|---|
| `split` | bola yang terjepit palu pecah menjadi k (2–4); kalah/menang: wadah penuh lalu meledak |
| `box` | keempat palu bertemu dan membentuk kotak; tiap pantulan di dalam kotak yang tertutup menambah satu bola (muncul di luar kotak) |
| `survive` | bola yang terjepit hilang; pantulan dinding menambah bola dengan peluang `bonus`; palu menang bila semua bola habis (hasil tergantung seed) |
| wadah | segi delapan, lingkaran, kotak, segitiga (palu keluar dari sudut), cincin (hub di tengah) |
| objek | bola, kotak, segitiga, permata, bintang, campuran (digambar sebagai bentuk, bertumbukan sebagai lingkaran) |
| gravitasi | bola menumpuk di bawah, palu menembus tumpukan |

Palu berbentuk teleskopik: panjang kepalanya menyesuaikan lebar wadah di tiap kedalaman, sehingga tidak pernah menembus dinding dan bola yang terjepit di ujung selalu hancur.

**Sync & close** (`packages/scenes/sync-lines/`): 4 mode × 4 bentuk × aturan lap/gerak/bentuk tersembunyi/rasio.

| Mode | Aturan | Menang/selesai |
|---|---|---|
| `orbits` | objek k mengitari lintasannya m_k kali (berurutan, ganjil, prima, atau acak berseed; searah atau bergantian); satu garis menyambung semuanya | semua kembali satu garis tepat di detik yang dijanjikan (bukti: tes) |
| `lid` | objek k memantul lantai↔tutup dengan (m_k + ½) pulang-pergi; gerak linear/gravitasi/piston | semua menyentuh tutup pada instan yang sama |
| `slider` | garis baru tiap beberapa detik; tiap titik hanya meluncur lurus | bentuk tersembunyi muncul: lingkaran, bunga 4 daun, bunga 3 daun, atau lingkaran yang bernapas |
| `close` | pena dua lengan, lengan cepat = rasio × lengan lambat (π, √2, φ, e, 7/3, 5/2, 8/5, atau pecahan berseed) | pecahan menutup setelah q putaran; irasional tidak pernah menutup, "hampir menutup" di 7 dan 113 putaran (π), dengan kaca pembesar dan celahnya dalam piksel |

Seed, tombol **🎲 Random**, kotak angka seed, dan teks hook otomatis (yang mengikuti aturan dan seed, bisa diedit) ada di panel Basic. Preset varian ada di galeri (`hammer-*`, `sync-*`, 12 berkas di `presets/`). Cara menambah varian: lihat README ("Adding a variant").

### 13.3 Bagaimana permintaan "satisfying" diwujudkan

- **Ketegangan naik.** Jarak antar pukulan menyusut sampai 1/3 (parameter `speedUp`); dinding berdenyut makin cepat dan terang setelah 45 % penuh; retakan muncul setelah 75 %; getaran dan kilatan tiap pukulan membesar mengikuti isi wadah. Audio: pukulan makin berat, nada hancuran naik mengikuti jumlah bola, lalu riser sebelum ledakan. Di mode sync, detak jam yang makin cepat dan naik nadanya selama 7 detik terakhir, lalu whoosh. Terukur dari MP4 (RMS tiap 2,5 detik): hammer split −41 → −15 dB; hammer box −42 → −16 dB.
- **Klimaks.** Hammer: wadah pecah menjadi serpihan, bola berhamburan, flash, getar 34, `boom` + `shatter`. Sync: flash, getar, semburan partikel di tiap objek, akor dari objek yang bertemu, `boom` + `success`.
- **Suara tumbukan ala ASMR.** Tiap pantulan dinding berbunyi dengan nada dari tangga pentatonik menurut sudut dinding; bola-bola saling bunyi dengan nada dari warnanya; pembatas suara (`VoiceLimiter`) mengubah ratusan benturan sekaligus menjadi satu hantaman yang lebih keras, bukan noise. Tiap event punya varian sampel berseed.
- **Hitungan di layar.** Penghitung selalu tepat di tiap frame dan "memantul" (pop) tiap kali berubah; mode sync menampilkan `In line: 12 / 12`, `Lid hits`, `Lines k / N` dengan bilah segmen, dan `Slow-arm turns`.
- **Akhir yang bisa di-loop.** Hammer: ledakan, lalu seluruh rekaman diputar mundur ke frame 0 dengan tanda ◀◀; frame terakhir sama dengan frame pertama. Sync: semua kembali ke posisi awal (orbits/lid/close), garis memudar (slider). Diuji untuk semua varian.

### 13.4 Detail teknis (performa dan determinisme)

- **Struktur data.** `packages/sim/grid.ts`: grid seragam untuk cakram sama besar, dibangun ulang tiap sub-langkah dengan counting sort (O(n)), semua typed array dialokasikan sekali di awal, tanpa alokasi di loop per-frame; pasangan dikunjungi dalam urutan tetap (tes membuktikan hasilnya sama dengan pencarian brute force dan tidak ada pasangan ganda). Partikel memakai pool `Juice` yang sudah ada.
- **Rekaman malas.** Simulasi hammer berjalan maju dengan langkah tetap dan merekam tiap frame (posisi dikuantisasi 1/8 px, warna, ekstensi palu, event); preview, render, dan `audio()` membaca rekaman yang sama, jadi tidak mungkin berbeda. Memori: sekitar 13 MB untuk 1.500 bola dan 26 MB untuk 2.500 bola selama 55 detik.
- **Determinisme.** Simulasi hanya memakai `dmath` dan aritmetika IEEE-exact; seed menentukan semua acakan. Hash state dipatok di `tests/golden-state.json` (7 kasus baru).

### 13.5 Hasil verifikasi

| Butir | Hasil |
|---|---|
| Tes | **99 lulus, 0 gagal** (sebelumnya 72; 27 baru: 20 di `tests/templates.test.ts` dan 7 kasus golden), `tsc` bersih |
| Tiap varian dilihat | lembar frame per varian di `docs/templates/` (hammer: split/octagon, box/circle/candy, survive/triangle/chalk, split/triangle/blueprint, box/ring/terminal; sync: orbits, lid, slider, close) |
| Seed sama = sama | state simulasi **identik bit demi bit** antara Chrome (preview) dan Node (render) di 5 kasus (hammer split, hammer box, orbits, close, slider; 3–6 frame tiap kasus); juga sama di kualitas preview rendah vs penuh (tes). Cara memeriksa: `node tools/state-sig.ts <scene> '<params>' <frame,...>` dan potongan kode yang sama di konsol browser (`window.__studio`). |
| Piksel preview vs render | selisih rata-rata 1,0–1,6 dari 255 di 4 dari 5 frame uji; **7,7 / 255 di mode `close` detik 40** (ratusan garis tambahan menumpuk, rasterizer Chrome dan Skia berbeda; tidak diselidiki lebih jauh) |
| Render lengkap + audio | 4 MP4 1080×1920 @60, H.264 BT.709, AAC 44,1 kHz: `hammer-smash-split-seed7` (55 s), `hammer-smash-box-circle` (55 s), `sync-lines-orbits-seed7` (40 s), `sync-lines-close-pi` (45 s), semuanya di `output/`. Kecepatan render: hammer 1,5–1,6× real-time (5,4–6,5 ms gambar per frame), sync 2,6–2,9×. Loudness terukur −14,6 … −21,6 LUFS sebelum normalisasi. |
| Tracking | server uji dengan folder data terpisah: job `hammer-smash` menghasilkan entri Videos dengan judul otomatis dari hook ("Trapped balls multiply — How long until it bursts?"), deskripsi, 14 tag, hashtag, status Rendered. Berkas uji di `output/` sudah dihapus. |

**Ukur performa** (loop sinkron di browser, `getImageData` memaksa GPU selesai tiap frame; 600 frame terakhir saat paling penuh; hasil p50 / p95 / maks dalam ms; batas 60 FPS = 16,7 ms):

| Kasus | skala | p50 | p95 | maks | frame > 16,7 ms |
|---|---|---|---|---|---|
| hammer split, **2.500 bola** | 0,5 | 4,4 | 7,3 | 8,7 | 0 |
| hammer split, 2.500 bola | **1,0** | 7,9 | 8,7 | 11,6 | 0 |
| hammer box, lingkaran, objek campuran, 2.500 bola | 0,5 | 4,3 | 5,4 | 8,4 | 0 |
| sync orbits, 40 objek | 0,5 / 1,0 | 0,8 / 1,6 | 1,6 / 3,1 | 3,9 / 8,0 | 0 |
| sync lid cincin 40, slider 40 | 0,5 | 0,8 | 1,0 / 1,3 | 4,5 / 4,1 | 0 |
| sync close π | 0,5 / 1,0 | 0,4 / 1,3 | 0,6 / 2,3 | 2,3 / 9,2 | 0 |

### 13.6 ElevenLabs

Dicek dulu: semua suara yang ada dipakai ulang. Daftar kebutuhan baru ditulis di `assets/sfx/requests.json`, satu batch kecil **5 suara** (`eleven_text_to_sound_v2`, 1 variasi, satu kali generate, tidak ada yang diulang): `slam-metal` (peran `slam`), `crush-glass` (`crush`), `shatter-burst` (`shatter`), `rewind-tape` (`rewind`), `clang-lid` (`clang`). Tersimpan di `assets/sfx/` dengan manifest dan file asli di `src/`; `node tools/sfx.ts plan` kini melaporkan 0 yang perlu dibuat, dan import ulang ditolak (prompt hash sudah ada).

- Estimasi sebelum jalan: **51 credit**. Biaya per generasi yang dilaporkan layanan: 2,67 + 1,67 + 5 + 5 + 2,67 ≈ **17 credit**.
- Penghitung akun (`account_get_usage`) masih menunjukkan 20.668 dari 38.333 sebelum dan sesudah, jadi angka itu tidak (belum) mencerminkan batch ini; total yang terpakai saya laporkan dari biaya per generasi, bukan dari penghitung akun.
- `clang-lid` hanya 0,12 detik setelah pemangkasan hening otomatis (diminta 0,8 detik); cukup untuk denting pendek, tetapi tanpa ring panjang.
- Tiap peran masih punya fallback synth bila sampel tidak ada.

### 13.7 Yang belum selesai / belum terverifikasi

- **Kelancaran preview real-time (60 FPS) belum diukur.** Panel browser aplikasi membatasi `requestAnimationFrame` ke sekitar 15 Hz (juga di halaman kosong), jadi pemutaran sungguhan (termasuk sinkron dengan audio) tidak bisa dinilai di sini. Yang terukur: biaya per frame lewat loop sinkron (tabel di atas, p95 ≤ 8,7 ms untuk 2.500 bola, di bawah batas 16,7 ms). Uji pemutaran di Chrome biasa belum dilakukan.
- **Suara belum didengar.** Yang diperiksa: loudness per 2,5 detik dari MP4, kenaikannya, dan tidak ada keheningan awal (mode orbits diperbaiki setelah ketahuan senyap 5 detik pertama). Kualitas nada dan kenyamanan telinga belum dinilai manusia.
- Tombol **Edit suggestion** (menyalin hook ke kolom judul) dan ketik manual seed tidak diklik satu per satu; yang diklik dan diperiksa: tombol Random, kotak seed, dan placeholder hook.
- Objek bukan-bola (kotak, segitiga, permata, bintang) bertumbukan sebagai lingkaran; tampilannya bentuk, fisikanya tidak berputar.
- `survive` bisa berakhir dengan "palu menang" untuk sebagian seed (itu aturannya), dan keseimbangannya hanya diuji di beberapa seed (6 seed segitiga, 4 seed segi delapan), bukan semua kombinasi.
- Mode `close` pada detik 40 berbeda piksel 7,7/255 dari render (lihat di atas); penyebab yang dicurigai adalah akumulasi garis aditif, belum dibuktikan.
- Tidak membuat tampilan "dinding V" dan bandul seperti satu video referensi, dan tidak menyalin deret Fibonacci "lid"; `focal-reflection` tetap menangani yang mirip.
- Empat video contoh di `output/` sudah diimpor ke Videos atas permintaan (status Rendered, teks otomatis dari hook). Untuk itu `POST /api/videos/import` kini menerima daftar opsional `{"files": [...]}` yang membatasi impor; tanpa daftar, perilakunya sama seperti banner (semua render yang belum tercatat). 13 render lama tetap belum tercatat.

## 14. App macOS dan ikon menu bar (2026-11-18)

**Pola yang dipelajari (hanya dibaca):** `/Users/aldo/Animation-Claude-Video-V2` (`studio/app/menubar.swift`, `make_app.sh`, `icon.py`, `Studio Cerita.app`, `Buka Studio.command`, bagian "Buka" di CLAUDE.md). Diikuti perilakunya (satu instans, nyalakan server dengan `nohup` supaya hidup walau ikon ditutup, lokasi proyek + PATH dicatat di Resources, Keluar hanya menutup ikon, mulai-otomatis default mati). Kode ditulis sendiri untuk proyek ini; bedanya: endpoint status baru, menu Buka Videos dan Buka folder output, ikon digambar dengan pustaka standar Python (tanpa Pillow, yang tidak terpasang di Python bawaan Mac ini), dan server dikenali dari `/api/status` (bukan dari judul halaman).

### Berkas
| Berkas | Isi |
|---|---|
| `Sim Studio.app` (akar proyek, dibuat skrip) | app AppKit tanpa ikon Dock (`LSUIElement`), id `local.sim-studio`, tanda tangan ad-hoc |
| `apps/mac/menubar.swift` | ikon menu bar + menu + peluncur server (±250 baris, hanya AppKit/ServiceManagement) |
| `apps/mac/make_app.sh` | membuat ulang app; mencatat `ROOT` dan `PATH` di `Contents/Resources/location.txt` |
| `apps/mac/icon.py` | menggambar ikon 1024 px (octagon neon, tiga bola) → iconset → `.icns`; ±4 detik |
| `Buka Studio.command` | cadangan sederhana (menyalakan server bila belum jalan, membuka browser) |
| `apps/server/status.ts` + `GET /api/status` | ringkasan ringan, hanya localhost (juga ditolak 403 bila bukan loopback) |
| `tests/status.test.ts` | 6 tes (lihat bawah) |
| `apps/studio/main.ts` | `#videos` di URL membuka daftar Videos (untuk menu "Buka Videos") |

### Cara pakai
Klik dua kali `Sim Studio.app`. Menu: status (Siap / Sedang render: scene NN% / Antre / Selesai: … / Render gagal / Studio belum menyala), Buka Studio, Salin tautan Studio (menyalin `http://127.0.0.1:5180` sebagai teks polos lewat NSPasteboard, aktif walau server mati; menu menutup saat diklik, jadi tandanya ikon menu bar berubah jadi centang ±1,5 detik plus tooltip "Tautan Studio disalin"; tanpa notifikasi atau izin baru), Buka Videos, Buka folder output, Buka log (`~/Library/Logs/Sim Studio.log`), Mulai otomatis saat login (**mati** kecuali dicentang), Keluar (hanya ikon). Membuat ulang setelah folder dipindah: `./apps/mac/make_app.sh`. Menaruh di Dock: seret `Sim Studio.app` dari Finder ke Dock. Mulai otomatis: centang di menu (SMAppService, bila ditolak macOS: LaunchAgent `~/Library/LaunchAgents/local.sim-studio.menu.plist`; membuka via login hanya menyalakan server, tanpa membuka browser); hilangkan centang untuk menghapusnya.

### Yang diverifikasi
| Butir | Cara dan hasil |
|---|---|
| Tes | **105 lulus, 0 gagal** (99 + 6 baru di `tests/status.test.ts`: bentuk status, persen render, antre, render terakhir dan gagal, tanpa parameter/path, hanya loopback, dan satu **server sungguhan** yang menjawab `/api/status` < 500 ms dengan < 600 byte, POST ditolak 404); `tsc` bersih |
| Server mati → klik dua kali | `open "Sim Studio.app"` (server dimatikan dulu): server menyala dari app dengan PATH kosong, log berisi baris "studio: http://127.0.0.1:5180/", `data/.lock` dibuat |
| Browser terbuka | koneksi masuk ke port 5180 dari proses jaringan Safari (browser bawaan) dan tab "Sim Studio" terlihat pada tangkapan layar |
| Ikon menu bar | tangkapan layar area menu bar: ikon octagon terlihat; menu terbuka difoto dengan semua butir; keadaan **Siap**, **Sedang render: galton-board 6%** (dengan titik di sudut ikon) dan **Selesai: galton-board (baru saja)** difoto, memakai server uji dan data uji terpisah |
| Satu instans | dua `open` tambahan berturut-turut: 1 ikon, 1 server, pid server sama |
| Keluar | `quit` (sama dengan item Keluar): ikon hilang, server hidup dengan pid yang sama |
| Server sudah jalan | app dibuka saat server sudah ada (dinyalakan `.command` atau app sebelumnya): tidak ada server kedua, pid sama |
| Node tidak ditemukan | salinan app dengan PATH tanpa Node: skrip peluncur keluar 9, pesan "Node.js tidak ditemukan…" tercatat di log, tidak ada server yang menyala |
| Folder proyek hilang | salinan app dengan `ROOT` palsu: pesan "Folder proyek tidak ditemukan di /nonexistent/folder…" tercatat di log |
| `.command` | dingin (menyalakan server) dan hangat (tidak membuat server kedua): keluar 0 |
| Bersih | server dan folder data uji, 4 render uji di `output/`, dan salinan app uji dihapus; `data/` hanya berisi `videos.json` dan `.lock` dari server asli |

### Belum diverifikasi
- **Kotak dialog error tidak terlihat di layar.** Saya hanya membuktikan jalur kodenya (kode keluar dan pesan di log); jendela peringatannya tidak muncul di daftar jendela yang bisa saya baca, jadi tampilannya belum saya lihat.
- **Mulai otomatis saat login tidak diuji sama sekali**, sesuai aturan (tidak dinyalakan). Jalur SMAppService dan LaunchAgent belum pernah dijalankan; `--login` (tidak membuka browser) hanya diuji lewat argumen, bukan lewat login sungguhan.
- Ikon di mode gelap/terang dan di layar non-Retina tidak dibandingkan; ikonnya template image sehingga mengikuti warna menu bar.
- Menaruh app di Dock tidak dicoba (hanya instruksi).
- Port 5180 dipakai program lain: kodenya menampilkan "Port 5180 dipakai program lain", tidak diuji.
- Notarisasi tidak ada (tanda tangan ad-hoc): bila app diunduh dari tempat lain, macOS akan meminta persetujuan Gatekeeper; yang dibuat di Mac ini tidak mengalaminya.

## 15. Unggah ke YouTube dari halaman Videos (2026-11-18)

Rencana yang disetujui: `docs/youtube-upload-plan.md`. Rencana itu memuat fakta API yang dicek ulang ke dokumentasi resmi Google pada 2026-11-18, panduan Google Cloud, dan 12 keputusan; semua keputusan mengikuti rekomendasi. Pola keamanan diambil dari `Animation-Claude-Video-V2` (hanya dibaca), tetapi kodenya ditulis sendiri.

### Berkas
| Berkas | Isi |
|---|---|
| `apps/server/youtube.ts` | OAuth desktop PKCE (S256) + `state` sekali pakai, redirect loopback `127.0.0.1:5180/oauth/youtube`; rahasia hanya di `~/Library/Application Support/Sim Studio/youtube.json` (600, tulis atomik); access token di memori; `redact()` untuk semua pesan; unggah resumable (potongan kelipatan 256 KB, lanjut dari `Range`, ulang hanya 5xx/putus); tunggu pemrosesan; thumbnail; publik; cek status; cari unggahan setelah sesi kedaluwarsa; hitung kuota per hari PT. Tanpa paket npm dan tanpa panggilan hapus |
| `apps/server/uploader.ts` | satu unggahan pada satu waktu, di luar antrean render; langkah `uploading → processing → thumbnail → finishing → done` dicatat di record Video lewat `store.mutate` (atomik, dengan cadangan); setelah server mati, langkah yang berjalan menjadi "failed at" dan bisa dilanjutkan; sinkron Scheduled → Published sekali saja |
| `packages/publish/index.ts` | field opsional `youtube` (tanpa naik versi skema, tidak bisa diubah dari halaman), `uploadProblems` (cek siap-unggah), `consentKey` (sidik persetujuan) |
| `apps/server/server.ts` | rute `/api/youtube*`, `/oauth/youtube`, `/api/videos/:id/youtube/{check,upload,resume,skip-thumbnail}`; `SIM_OUT_DIR` (khusus tes) |
| `apps/studio/youtube-ui.ts` + `videos.ts` + `index.html` | dialog YouTube settings (menu Export), bagian YouTube per video, dialog konfirmasi dengan centang, progres |
| `tests/fake-google.ts`, `tests/youtube.test.ts` | Google tiruan lokal + 16 tes |

### Aturan yang ditegakkan kode
- Unggah selalu **privat** dulu. Thumbnail dipasang setelah `processingStatus = succeeded`. Mode "sekarang" baru dibuat publik setelah thumbnail terpasang.
- Hanya video **Rendered**, 1080×1920, ≤3 menit, dengan teks dalam batas.
- **Persetujuan per video:** centang ditambah kunci persetujuan yang cocok dengan isi dialog dan hanya bisa dipakai sekali.
- **Tidak ada unggah ulang:** video yang punya `youtube` tidak bisa diunggah lagi. Unggah ulang otomatis juga tidak ada.
- **Kuota habis:** pesan dengan jam reset, tanpa percobaan ulang.
- **Tidak ada hapus:** tes memindai sumber dan server tiruan menghitung permintaan DELETE.
- **Satu status pelacakan:** Scheduled/Published memakai `status` yang sudah ada, dan `youtubeUrl`/`scheduledAt`/`publishedAt` terisi sendiri.

### Verifikasi
| Butir | Hasil |
|---|---|
| Tes | **121 lulus, 0 gagal** (105 + 16 di `tests/youtube.test.ts`), `tsc` bersih |
| Server Google tiruan (tes) | OAuth (PKCE dicek tiruan, `state` palsu ditolak, callback tidak bisa diulang); unggah terjadwal (privat + `publishAt`, thumbnail setelah diproses, 1 `insert`); koneksi putus + 503 di tengah (sesi sama, setiap byte tiba sekali); mode sekarang (publik setelah thumbnail); kuota habis (pesan, tepat 1 percobaan, record bersih); thumbnail ditolak 403 (tetap privat dan terjadwal, lalu dilanjutkan); studio di-`kill -9` di tengah unggah lalu dinyalakan → Continue (tanpa `insert` kedua, file sesi 600); sesi kedaluwarsa (record dibersihkan, perlu persetujuan baru); access token kedaluwarsa (diperbarui diam-diam); izin dicabut (pesan "connect again", tidak ada yang dikirim); Scheduled → Published sekali dan tidak diulang setelah dikembalikan manual; **tanpa kebocoran** (token, secret, URL sesi tidak ada di workspace, `data/`, `output/`, log server, `~/Library/Logs/Sim Studio.log`, maupun semua respons API); Disconnect mencabut di Google |
| Browser (studio di port terpisah + Google tiruan + data sementara) | menu Export → YouTube settings; ambil file klien dari Downloads (file unduhan terhapus, `youtube.json` 600); Connect → halaman "Connected ✓ Fake Science Channel"; bagian YouTube dengan bawaan; dialog konfirmasi (tombol mati sampai dicentang); progres "Uploading 15% · 16.0 MB / 100.2 MB"; hasil "◷ Scheduled on YouTube" + tautan; daftar berubah ke Scheduled dengan tanggal; pesan kuota habis di dialog; konsol hanya berisi 429 yang memang diharapkan |
| Studio asli | dimulai ulang dengan kode baru; `~/Library/Application Support/Sim Studio` belum dibuat (belum ada yang dihubungkan) |

### Belum diverifikasi
- **Tidak ada satu pun panggilan ke Google sungguhan.** Uji nyata (satu video privat terjadwal, Anda yang menghapus) menunggu file klien dari Anda. Sampai itu, hal-hal berikut hanya teruji terhadap tiruan:
  - layar persetujuan Google yang asli dan peringatan "app not verified";
  - nama kesalahan yang persis dari Google (`quotaExceeded`, `forbidden` untuk thumbnail);
  - umur sesi resumable;
  - perilaku `publishAt`.
- Thumbnail Shorts lewat API (fitur 3 Nov 2026) dan syarat channel terverifikasi belum pernah dicoba di channel sungguhan.
- Di panel browser aplikasi, `window.open` membuka login di tab yang sama (tiruan); di browser biasa login terbuka di tab baru. Saat uji, `confirm()` di tab uji diganti otomatis "OK".
- Ikon menu bar belum menampilkan progres unggah (opsional di rencana, tidak dibuat).

## 16. UX v2: tata letak responsif, Videos yang menunjuk langkah berikutnya (2026-11-18)

Dasar: `docs/ux-v2.md` (audit, 7 usulan U1–U7, hasil terukur, bukti sebelum/sesudah di `docs/ux-v2/`). Pembanding hanya dibaca: `/Users/aldo/Animation-Claude-Video-V2` (kode UI, rencana UI, satu tampilan nyata); hanya prinsipnya yang dipakai, tanpa nama, ikon, atau palet khasnya.

Berkas: `apps/studio/{index.html,main.ts,videos.ts,ux.ts,style.css}`, baru `apps/studio/icons.ts`; `apps/server/{status.ts,server.ts}` (+`codeStale`); tes `tests/{ux,status,mode}.test.ts` diperluas (149 lulus). Tidak disentuh: mesin render, scene, `themes/`, data Videos, `references/`.

Hasil utama: tanpa scroll horizontal di 400–1440 px (sebelum: 550 px di jendela 400); emoji antarmuka 11 → 0; ukuran huruf 9 → 6; kartu galeri terlihat 4 → 6; klik ke video yang perlu tindakan 2 → 1; progres render di judul tab; galat konsol 2 → 0 (server baru). Klik mulai render dan klik studio→teks publikasi tidak bertambah (1 dan 4).

Belum terverifikasi: server 5180 masih kode lama (perlu dimulai ulang agar peringatan "server lama" dan perbaikan `/cover` berlaku); layar sentuh/ponsel fisik, Safari, Firefox; FPS preview.
