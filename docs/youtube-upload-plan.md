# Rencana: unggah ke YouTube dari halaman Videos

Status: **disetujui 2026-11-18 dan dibangun** (fase 1–4; hasil dan verifikasi di `docs/report.md` §15). Fase 5 (uji nyata ke YouTube) menunggu file klien dari pemilik. Pola dan aturan keamanan mengikuti `Animation-Claude-Video-V2` (`studio/youtube.mjs`, `catatan/RENCANA-YOUTUBE.md`, `catatan/analisis/RISET-UNGGAH-OTOMATIS.md`), yang hanya dibaca. Semua angka di bawah dicek ulang ke dokumentasi resmi Google pada **2026-11-18**, bukan disalin dari contoh. Nomor [n] merujuk ke daftar Sumber di akhir dokumen.

## 0. Fakta API yang dicek ulang (2026-11-18)

| Hal | Isi resmi | Sumber |
|---|---|---|
| Kuota unggah | `videos.insert` punya ember kuota sendiri: **100 panggilan per hari**, tiap panggilan 1 | [1][2][3] |
| Kuota lain | **10.000 unit per hari** untuk semua metode lain: `thumbnails.set` 50, `videos.update` 50, `videos.list` 1, `channels.list` 1, `playlistItems.list` 1 | [1][2] |
| Reset kuota | tengah malam **Pacific Time** (PT). Sama dengan 15.00 WIB saat PST, atau 14.00 WIB saat PDT | [2] |
| Proyek API yang belum diaudit | sejak **2 Nov 2026** tidak lagi dipaksa privat. Privasi yang tidak diisi menjadi `public`, jadi studio selalu mengisi `private` | [3][4] |
| Thumbnail Shorts lewat API | sejak **3 Nov 2026**, `thumbnails.set` menerima Shorts, tetapi hanya **setelah `processingStatus` = `succeeded`**. JPEG/PNG, ≤50 MB, ±50 unit. Gambar dipotong ke **9:16** | [3][5][6] |
| Thumbnail kustom | YouTube Help: thumbnail sendiri hanya untuk akun yang **terverifikasi** (termasuk Shorts). Halaman API sendiri tidak menyebut syarat ini; bila tidak terpenuhi, API menjawab 403 `forbidden` | [5][7] |
| Jadwal | `publishAt` hanya bisa diisi bila video `private` dan **belum pernah dipublikasikan**; format ISO 8601. Jadwal yang tidak valid → 400 `invalidPublishAt` | [8][4] |
| Batas teks | judul ≤100 karakter dan tanpa `<` `>`; deskripsi ≤5000 **byte**; tag ≤500 karakter total (koma ikut dihitung, tag berspasi dihitung dengan tanda kutip) | [8] |
| Label AI | `status.containsSyntheticMedia` untuk konten **realistis** yang diubah atau sintetis. Tidak wajib untuk konten tidak realistis atau **animasi**. Musik AI yang menjadi fokus video wajib diungkap | [8][9][10] |
| `notifySubscribers` | bawaan `true` | [4] |
| `videos.update` | bila bagian `snippet` dikirim, `categoryId` wajib. Satu bagian dikirim utuh (yang tidak disebut dihapus) | [8][11] |
| Refresh token | mati bila: aplikasi *Testing* + tipe *External* (**7 hari**), tidak dipakai **6 bulan**, dicabut pengguna, atau lebih dari **100 token per akun per klien** | [12] |
| OAuth desktop | klien jenis **Desktop app** (*public client*, secret tidak dianggap rahasia), **PKCE wajib** (S256 dianjurkan), redirect loopback `http://127.0.0.1:<port>`. Skema URI kustom dan OOB tidak didukung lagi. Token `https://oauth2.googleapis.com/token`, cabut `…/revoke` | [13] |
| Aplikasi tanpa verifikasi | "untuk pemakaian pribadi" (<100 pengguna) tidak wajib diverifikasi; pengguna melewati layar peringatan saat login | [14] |
| Resumable upload | sesi `uploadType=resumable` → `Location`. Potongan kelipatan **256 KB**. Status: `PUT` kosong `Content-Range: bytes */TOTAL` → `308` + `Range`. Ulang hanya untuk 500/502/503/504 atau putus koneksi. `404` = sesi kedaluwarsa (umurnya tidak disebutkan) | [15] |
| Panjang Shorts | maksimal 3 menit, vertikal atau persegi | [16] |

**Belum pasti:** jarak waktu terjauh untuk `publishAt` (tidak disebut di dokumentasi), umur sesi resumable (tidak disebut), dan apakah `defaultAudioLanguage` boleh "tanpa bahasa" (video kita tanpa ucapan). Rencananya: kolom itu tidak diisi.

## 1. Alur pengguna di halaman Videos

Unggah ditambahkan ke panel detail video yang sudah ada. Tidak ada halaman baru, dan pelacakan memakai status yang sudah ada: **Draft → Rendered → Scheduled → Published**.

```
┌ YouTube ─────────────────────────────── Terhubung: <nama channel> ┐
│ Siap diunggah ✓ (MP4 1080×1920 · 40 dtk · 14 MB)                    │
│ Judul / Deskripsi / Tag / Hashtag   ← isian yang sudah ada di panel  │
│ Thumbnail   [frame 12,4 s ✓]  (frame yang sudah dipilih di panel)    │
│ Tayang   ( ) Sekarang   (•) Jadwal [2026-11-20] [19:00]  WIB         │
│ Bahasa: English ▾  Kategori: Science & Technology ▾                  │
│ Untuk anak: Tidak ▾   Label AI: Tidak (animasi) ▾   Beri tahu: Ya    │
│                          [ Unggah ke YouTube… ]                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Sebelum unggah**
- Bagian ini hanya muncul bila status video **Rendered** dan YouTube terhubung. Selain itu tampil satu baris penjelasan dan tombol menuju Pengaturan YouTube.
- **"Siap diunggah"** dicek di server:
  - MP4 masih ada di `output/`;
  - 1080×1920 dan ≤180 detik;
  - judul tidak kosong;
  - batas teks dan tanpa `<` `>` (cek yang sudah ada di Videos);
  - belum pernah diunggah.
- Isian judul, deskripsi, tag, dan hashtag adalah isian yang sudah ada; tidak ada salinan kedua. Deskripsi yang dikirim = deskripsi + hashtag, seperti tombol "Copy (with hashtags)" sekarang.
- **Thumbnail** = frame yang sudah dipilih di panel (`data/thumbnails/<id>.png`, 1080×1920). Tanpa frame terpilih, YouTube memakai frame otomatis, dan dialog memberi tahu hal itu.

**Dialog konfirmasi** (satu per video)
- Ringkasan: channel, judul, jadwal (tanggal lengkap + WIB), privasi saat diunggah (privat), thumbnail, untuk anak, label AI, ukuran file.
- Centang wajib: **"Saya setuju video ini diunggah ke channel <nama>."**
- Tombol: **"Unggah & jadwalkan"** atau **"Unggah, lalu tayangkan setelah thumbnail terpasang"**. Tombol nonaktif sebelum dicentang, dan nonaktif lagi begitu diklik.

**Saat berjalan** (di luar antrean render; render boleh jalan bersamaan)
- Strip progres di panel dan di baris daftar:
  - "Mengunggah 45% · 6,3 / 14 MB";
  - "YouTube memproses…";
  - "Memasang thumbnail…";
  - "Menayangkan…".
- Menutup halaman tidak menghentikan unggahan. Menghentikan server menghentikannya; setelah server menyala lagi muncul tombol **"Lanjutkan unggahan"** (sesi yang sama, bukan unggah ulang).

**Hasil**
- `youtubeUrl` terisi otomatis, dan status pelacakan berubah sendiri:
  - jadwal → **Scheduled**, dengan `scheduledAt` sesuai jadwal;
  - sekarang → **Published**, dengan `publishedAt` hari ini.
- Panel menampilkan "◷ Terjadwal · tayang Jum 20 Nov 19.00 WIB · tautan ↗" atau "✓ Tayang · tautan ↗".
- **Scheduled → Published otomatis, sekali saja:** saat YouTube mengonfirmasi video itu `public` (`videos.list`, 1 unit untuk ≤50 video sekaligus). Pengecekan berjalan saat Videos dibuka dan tiap 15 menit selama ada video Scheduled.
- Status tetap bisa diubah manual seperti sekarang. Sistem tidak pernah menurunkan Published.
- **Gagal:** pesan jelas tanpa token, ditambah tombol yang sesuai: "Lanjutkan unggahan", "Pasang thumbnail lagi", atau "Selesaikan". Tidak ada percobaan ulang otomatis untuk `videos.insert`.

**Pengaturan YouTube** (panel kecil dibuka dari menu Videos)
- Pilih file klien, Hubungkan, nama channel, Putuskan.
- Bawaan untuk kategori, bahasa, untuk anak, label AI, dan jam jadwal terakhir.
- Pemakaian kuota hari ini (dihitung studio).

## 2. Yang perlu Anda kerjakan sendiri (klik demi klik)

Langkah yang perlu keputusan ditandai **[K]**, dan rekomendasi saya ada di bagian 5.

1. Buka **console.cloud.google.com** dengan akun Google pemilik channel. Pilih proyek di atas → **New project** → nama misalnya "Sim Studio" → Create. **Tidak perlu billing.**
2. **APIs & Services → Library** → cari "YouTube Data API v3" → **Enable**. Setujui ketentuan YouTube API Services bila diminta.
3. **Google Auth Platform** (dulu "OAuth consent screen") → **Get started**:
   - Branding: nama aplikasi "Sim Studio" dan email dukungan Anda.
   - Audience: **External**.
   - Contact: email Anda → Create.
4. **Data Access → Add or remove scopes** → centang satu scope. **[K]**
   - Rekomendasi: `https://www.googleapis.com/auth/youtube.force-ssl`. Mencakup unggah, thumbnail, cek status, ubah jadwal, dan ubah teks. Scope ini juga *mengizinkan* hapus, tetapi kode studio tidak akan pernah memanggilnya (dan dites).
   - Alternatif lebih sempit: `youtube.upload` + `youtube.readonly`. Unggah dan cek status tetap bisa, tetapi ubah jadwal dan teks harus di YouTube Studio. "Tayangkan setelah thumbnail" juga tidak bisa, karena butuh `videos.update`.
   - Save.
5. **Audience → Publish app → In production.** **[K]** Bila tetap *Testing*, refresh token mati tiap 7 hari [12]. Tanpa verifikasi Google, saat login muncul "Google hasn't verified this app": klik *Advanced → Go to Sim Studio (unsafe)*. Untuk pemakaian pribadi (<100 pengguna) ini diizinkan [14].
6. **Clients → Create client → Application type: Desktop app** → nama "Sim Studio Mac" → Create → **Download JSON**.
   - Jangan taruh file itu di folder proyek.
   - Di studio: Videos → Pengaturan YouTube → **Pilih file klien**. Studio menyalin isinya ke `~/Library/Application Support/Sim Studio/youtube.json` (mode 600), lalu **menghapus file unduhan itu** (dengan konfirmasi).
7. Di studio: **Hubungkan** → browser membuka Google → pilih akun → pilih **channel** (bila ada beberapa, termasuk brand account) **[K]** → izinkan. Halaman kembali ke studio dan menampilkan nama channel.
8. **Verifikasi channel** untuk thumbnail kustom: **youtube.com/verify** (nomor telepon). Cek di **youtube.com/features**. Tanpa ini, unggahan tetap jalan, tetapi `thumbnails.set` ditolak dan studio menampilkan "Thumbnail ditolak: channel belum terverifikasi".

## 3. Rancangan teknis

**Modul baru**
- `apps/server/youtube.ts`: OAuth, penyimpanan rahasia, dan panggilan API. Hanya `fetch` Node; tidak ada paket npm baru.
- `apps/server/uploader.ts`: satu unggahan berjalan pada satu waktu, terpisah dari antrean render.
- Rute baru di `apps/server/server.ts`. Bagian UI di `apps/studio/videos.ts`.

**Rahasia**
- Hanya di `~/Library/Application Support/Sim Studio/youtube.json` (mode 600). Isinya: klien (id + secret), refresh token, id/nama/handle channel, scope, bawaan isian, dan hitungan kuota.
- Access token (±1 jam) hanya di memori.
- URI sesi unggah disimpan di `…/Sim Studio/youtube-sessions/<videoId-studio>.json` (600), karena URI itu bisa dipakai mengunggah tanpa login.
- Tidak pernah ditulis ke workspace, `data/`, log, `.job.json`, atau respons API studio. Respons hanya memuat `{connected, channelName, clientIdHint}`.
- Semua pesan error disaring dulu: token, kode, secret, dan URL sesi diganti `[hidden]`.
- **Putuskan:** memanggil `revoke`, lalu menghapus refresh token dari file.

**OAuth**
- Desktop + PKCE (S256) + `state` acak.
- Redirect `http://127.0.0.1:5180/oauth/youtube`. Server studio memang hanya mendengar di 127.0.0.1, dan rute ini menolak `state` yang tidak dikenal atau kedaluwarsa (15 menit, sekali pakai).
- `access_type=offline`, `prompt=consent select_account`. Setelah login: `channels.list mine=true` (1 unit) untuk nama channel.

**Data per video**
- Satu objek opsional `youtube` di record Video yang sudah ada, tanpa naik `schemaVersion`, sama seperti `settings`. Isinya:
  ```json
  { "videoId": "abc…", "channelId": "UC…", "stage": "uploading|processing|thumbnail|finishing|done|failed",
    "privacyAtUpload": "private", "publishAt": "2026-11-20T12:00:00Z", "uploadedAt": "…",
    "thumbnail": "set|skipped|rejected", "fileSig": "<ukuran+mtime MP4 saat diunggah>", "error": "pesan tanpa rahasia" }
  ```
- `stage` hanya langkah teknis unggahan, supaya bisa dilanjutkan. Status pelacakan tetap satu, yaitu `status` yang sudah ada (Scheduled/Published), ditambah `youtubeUrl`, `scheduledAt`, dan `publishedAt`. **Tidak ada sistem status kedua.**
- Ditulis lewat `store.mutate` yang sudah ada: atomik, dengan cadangan, dan tetap mematuhi kunci baca-saja.

**Langkah unggah**
1. **Cek** di server: siap-unggah (bagian 1), token, dan persetujuan. Permintaan membawa `consent` = hash dari (id video, ukuran+mtime file, judul, deskripsi, tag, jadwal, channel) yang dibuat untuk dialog itu. Server menolak hash yang tidak cocok atau sudah dipakai. Ini mencegah klik ganda, dua tab, dan isian yang berubah setelah dicentang.
2. **Mulai sesi resumable** [15]. Metadata:
   - `snippet` {title, description+hashtag, tags, categoryId, defaultLanguage};
   - `status` {privacyStatus: **private**, publishAt? (jadwal), selfDeclaredMadeForKids, containsSyntheticMedia};
   - `notifySubscribers`.
3. **Kirim** potongan 8 MB (kelipatan 256 KB) dengan progres.
   - Putus koneksi atau 500/502/503/504: tanya `bytes */TOTAL`, lalu lanjut dari `Range`. Ada backoff, maksimal 6 kali. Ini melanjutkan sesi yang sama, bukan `insert` baru.
   - `404` (sesi kedaluwarsa): **berhenti**. Studio memeriksa daftar unggahan channel (`playlistItems`, 1 unit) mencari judul yang sama dalam 24 jam terakhir. Ditemukan → `videoId` dicatat dan lanjut. Tidak ditemukan → "Unggahan tidak selesai. Unggah ulang?" dengan persetujuan baru.
4. **201 → `videoId` langsung disimpan**, dan `youtubeUrl` = `https://www.youtube.com/shorts/<id>`.
5. **Tunggu pemrosesan:** `videos.list part=processingDetails,status` tiap 20 detik, maksimal 15 menit (≤45 unit).
6. **Thumbnail:** `thumbnails.set` (50 unit) bila ada frame terpilih. Gagal (403 belum terverifikasi, 429, `invalidImage`) → video tetap privat atau terjadwal, ditambah pesan dan tombol "Pasang thumbnail lagi".
7. **Selesai:**
   - Jadwal: status pelacakan **Scheduled**.
   - Sekarang: `videos.update part=status` (50 unit) → `public`, dengan bagian status dikirim utuh. Lalu status **Published**. Video tidak pernah tampil publik sebelum thumbnail terpasang.
   - Sesi dihapus.

**Yang tidak pernah dilakukan kode**
- Memanggil `videos.delete` atau endpoint hapus apa pun. Dites dengan memindai sumber modul dan memantau server tiruan.
- Unggah ulang otomatis.
- Mengubah privasi menjadi publik sebelum thumbnail.
- Mengunggah video tanpa centang persetujuan.

**Kuota dan penanganannya**

| Langkah | Ember | Unit |
|---|---|---|
| Hubungkan (`channels.list`) | lain-lain | 1 |
| Unggah (`videos.insert`) | unggahan | 1 dari **100/hari** |
| Tunggu pemrosesan | lain-lain | ≤45 (biasanya 3–9) |
| Thumbnail | lain-lain | 50 |
| Tayangkan sekarang (`videos.update`) | lain-lain | 50 |
| Cek Scheduled → Published | lain-lain | 1 tiap 15 menit, untuk ≤50 video sekaligus |

- **Satu unggahan memakai ±60–150 unit**, jadi 10.000 unit cukup untuk ±65 unggahan per hari. Batas yang lebih dulu tercapai adalah 100 `insert` per hari.
- **Batas channel sendiri** (`uploadLimitExceeded`) bisa lebih ketat dan tidak terlihat sebelumnya.
- **`403 quotaExceeded`:** pesan "Kuota YouTube hari ini habis. Coba lagi setelah 15.00 WIB" (14.00 WIB saat jam musim panas AS). **Tidak dicoba ulang otomatis.** Langkah yang tertunda tetap bisa diklik lagi besok (lanjutkan sesi, pasang thumbnail, selesaikan).
- **Hitungan kuota studio:** studio menghitung unit yang dipakainya hari itu (reset tengah malam PT) di `youtube.json` dan menampilkannya. Itu hanya perkiraan: Google tidak memberi sisa kuota lewat API.

**Status server untuk ikon menu bar** (opsional, kecil): `/api/status` ditambah `uploading: {percent}` tanpa judul, supaya ikon bisa menulis "Mengunggah 45%".

## 4. Tes dan verifikasi

**Server YouTube tiruan** (`tests/fake-google.ts`, lokal di port acak). Server studio diarahkan ke sana lewat variabel uji (`SIM_GOOGLE_FAKE`) dengan `HOME` sementara, sehingga tidak menyentuh Application Support asli. Skenario:
- OAuth lengkap: PKCE diverifikasi oleh server tiruan, `state` salah ditolak, kode sekali pakai.
- Access token kedaluwarsa → diperbarui. Refresh token dicabut (`invalid_grant`) → pesan "Hubungkan lagi", tanpa mengirim apa pun.
- Kuota habis (403 `quotaExceeded`) → pesan, dan tepat satu permintaan (tidak ada ulang).
- Unggahan putus di tengah (koneksi ditutup / 503) → lanjut dari `Range` tanpa `insert` kedua.
- Server studio dimatikan di tengah unggahan → dinyalakan → "Lanjutkan" memakai sesi yang sama.
- Sesi kedaluwarsa (404) → cek daftar unggahan.
- Thumbnail ditolak (403, 429) → video tetap privat, ditambah tombol ulang.
- Pemrosesan gagal atau lama → pesan.
- Klik ganda / dua tab / persetujuan basi → satu `insert`.
- **Tidak ada kebocoran:** refresh token, access token, secret, dan URL sesi dicari (grep) di folder proyek, `data/`, log server, `~/Library/Logs/Sim Studio.log`, `output/*.job.json`, dan semua respons `/api/*`. Hasil harus nol.
- `youtube.json` dan file sesi bermode 600.
- Kode tidak memanggil endpoint hapus (pemindaian sumber + server tiruan menolak DELETE dan mencatatnya).
- Jalur Scheduled → Published otomatis dan sekali saja.

**Tes lama tetap lulus** (105 sekarang).

**Uji nyata** hanya setelah Anda setuju dan memberi file klien:
1. Hubungkan.
2. Cek nama channel, mode 600, dan tidak ada rahasia di workspace maupun log.
3. Unggah **satu video uji privat** dengan jadwal +2 hari: muncul di tab Shorts, teks/bahasa/kategori benar, thumbnail terpasang.
4. Cek Scheduled di studio.
5. Ubah jadwal, lalu batalkan jadwal (tetap privat).

Saya tidak menghapus video itu; Anda yang memutuskan dan menghapusnya manual di YouTube Studio.

## 5. Keputusan Anda (dengan rekomendasi)

| # | Keputusan | Rekomendasi |
|---|---|---|
| 1 | Scope | `youtube.force-ssl` (ubah jadwal/teks + tayang setelah thumbnail). Kode tidak pernah menghapus |
| 2 | Aplikasi Google | **In production** tanpa verifikasi; terima layar peringatan saat login (token tidak mati tiap 7 hari) |
| 3 | Channel | satu channel per koneksi (yang dipilih saat login). Multi-channel tidak sekarang |
| 4 | Verifikasi telepon channel | **Ya** (thumbnail kustom) |
| 5 | Untuk anak (`selfDeclaredMadeForKids`) | **Tidak** sebagai bawaan: konten sains umum, bukan ditujukan khusus untuk anak. Ini keputusan hukum Anda (COPPA); bisa diubah per video |
| 6 | Label AI (`containsSyntheticMedia`) | **Tidak**: simulasi animasi tidak realistis, dan suaranya efek, bukan musik AI yang jadi fokus [9][10]. Bisa diubah per video |
| 7 | Kategori | **28 Science & Technology** (alternatif 27 Education). Daftar dicek lewat `videoCategories.list` saat menghubungkan |
| 8 | Bahasa | `defaultLanguage` mengikuti bahasa saran (English/Indonesian); `defaultAudioLanguage` tidak diisi (tanpa ucapan) |
| 9 | Jadwal | dipilih tiap kali, minimal **30 menit** ke depan; studio mengingat jam terakhir; ditampilkan dalam waktu lokal Mac (WIB) |
| 10 | Tayang sekarang | diunggah privat, baru publik setelah thumbnail terpasang (tidak pernah publik dengan thumbnail otomatis) |
| 11 | Beri tahu subscriber | **Ya** sebagai bawaan |
| 12 | Uji nyata | channel utama, satu video privat terjadwal +2 hari; Anda yang menghapusnya |

## 6. Fase pengerjaan setelah disetujui

| Fase | Isi | Hasil yang bisa Anda lihat |
|---|---|---|
| 1 | Penyimpanan rahasia, pilih file klien, OAuth PKCE, Hubungkan/Putuskan, server tiruan + tes OAuth/kebocoran | "Terhubung: <channel>" |
| 2 | Unggah privat resumable + progres + lanjutkan, data `youtube` di Video, `youtubeUrl` | video privat (di server tiruan) |
| 3 | Pemrosesan, thumbnail, jadwal / tayang sekarang, Scheduled/Published otomatis | status pelacakan berubah sendiri |
| 4 | Kasus pinggir + semua tes server tiruan + README + docs/report.md | tes lulus |
| 5 | Uji nyata (setelah file klien dari Anda) | satu video uji privat |

## 7. Sengaja tidak dibuat
- Hapus video dari studio.
- Unggah ulang otomatis, unggah massal, dan studio yang memilih jam tayang sendiri.
- Playlist, komentar, analytics, caption.
- Multi-channel.
- TikTok/Instagram.
- Permintaan tambah kuota dan verifikasi aplikasi Google.

## Sumber (diakses 2026-11-18)
1. Getting started (100 `videos.insert`, 10.000 unit lain): https://developers.google.com/youtube/v3/getting-started
2. Quota costs + "Daily quotas reset at midnight Pacific Time (PT)": https://developers.google.com/youtube/v3/determine_quota_cost
3. Revision history (1 Jun, 2 Nov, 3 Nov 2026): https://developers.google.com/youtube/v3/revision_history
4. videos.insert (scope, `notifySubscribers`, `invalidPublishAt`, `uploadLimitExceeded`): https://developers.google.com/youtube/v3/docs/videos/insert
5. thumbnails.set (Shorts setelah `succeeded`, ≤50 MB, JPEG/PNG, 403/429): https://developers.google.com/youtube/v3/docs/thumbnails/set
6. Resource thumbnails (Shorts dipotong 9:16, `shortsAspectRatio`): https://developers.google.com/youtube/v3/docs/thumbnails
7. YouTube Help, Add video thumbnails (akun terverifikasi, Shorts 9:16, 50 MB): https://support.google.com/youtube/answer/72431
8. Resource videos (`publishAt`, privasi, label, batas teks, `processingStatus`): https://developers.google.com/youtube/v3/docs/videos
9. YouTube Help, pengungkapan konten AI/sintetis (contoh wajib dan tidak wajib): https://support.google.com/youtube/answer/14328491
10. YouTube Blog, "Improving AI labels" (27 Mei 2026): https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/
11. videos.update: https://developers.google.com/youtube/v3/docs/videos/update
12. Google OAuth 2.0, kedaluwarsa refresh token: https://developers.google.com/identity/protocols/oauth2
13. OAuth untuk aplikasi desktop (loopback, PKCE, public client): https://developers.google.com/identity/protocols/oauth2/native-app
14. Google Cloud Help, kapan verifikasi tidak diperlukan (pemakaian pribadi <100 pengguna): https://support.google.com/cloud/answer/13464323
15. Resumable upload protocol: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
16. YouTube Help, Shorts tiga menit: https://support.google.com/youtube/answer/15424877
