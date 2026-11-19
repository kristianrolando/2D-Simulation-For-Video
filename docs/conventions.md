# Konvensi proyek

Singkat dan praktis. Aturan ini mengikuti kebiasaan yang sudah dominan di repo (periksa dulu, jangan memaksakan gaya baru) dan **tidak boleh menyalahi nama yang dipakai kode atau data aktif**. Diperiksa otomatis oleh `tests/conventions.test.ts`.

```bash
node --test tests/conventions.test.ts     # kurang dari 1 dtk; juga ikut `npm test`
```

## 1. Penamaan berkas dan folder
- **Kebab-case huruf kecil** untuk semua berkas dan folder yang dilacak git: `job-store.ts`, `batch-plan-plasma.ts`, `publishing.md`, `tests/videos-nav.test.ts`. Tanpa spasi, tanpa huruf besar, tanpa garis bawah.
- **Satu bahasa per nama, dan namanya Inggris** (sama dengan nama di kode); isi dokumen internal boleh Indonesia. Salah: `catatan-render.md`, `laporan-hasil.md`. Benar: `render-notes.md`.
- **Ekstensi lazim saja**: `ts mjs js sh py swift json md html css png jpg svg wav mp3 ttf icns plist txt`. Foto/tangkapan layar = `.jpg`; gambar datar/diagram kecil boleh `.png`.
- Tes: `tests/<topik>.test.ts`. Dokumen: `docs/<topik>.md`. Skrip: `tools/<kata-kerja-atau-topik>.ts`.
- **Pengecualian yang sah** (daftar eksplisit beserta alasan ada di `NAME_EXCEPTIONS`, `tests/conventions.test.ts`): `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`, `README.md` (nama konvensi), `Sim Studio.app/`, `Buka Studio.command` (peluncur macOS pemilik), `apps/mac/make_app.sh` (namanya tertulis di pesan app yang sudah dikompilasi), `assets/fonts/DejaVu*` (nama dari pembuat font), `docs/evidence/reference-sheets/<id-youtube>.jpg` (nama = id video), dan keluaran `branding/build.mjs` (`banner_2560x1440.png`, dst.; dipakai `pack.mjs` dan tes).

## 2. Id di data
Id yang sudah tersimpan **tidak pernah diganti** (data pemilik, video, jadwal, jejak catatan).
- **preset scene, preset style, style, scene, brand**: kebab-case huruf kecil, boleh angka, sama dengan nama berkas JSON-nya: `mirrors-cassegrain`, `main-2`, `plasma-pendulum`, `galton-board`. Nama tampil ("Main-1", "Photon Lab") boleh bebas dan terpisah dari id.
- **channel**: nama tampil apa adanya ("Photon Lab"); channel terhubung membawa `channelId` YouTube, channel manual tidak.
- **id video**: dibuat studio (`v-…`); id YouTube asli dipakai apa adanya; slug video panjang kebab-case.
- Kunci rencana batch berawalan nama channel (`plasma:`); jangan memakai awalan yang sama untuk channel lain.

## 3. Tata letak: apa di mana
- **Akar repo** hanya: `README.md`, `HANDOFF.md`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`; folder `apps packages tools tests assets presets style-presets themes docs branding prototypes`; folder lokal tidak dilacak `data output work references node_modules`; peluncur macOS `Sim Studio.app` dan `Buka Studio.command`. Berkas atau folder baru di akar = tidak boleh tanpa persetujuan pemilik.
- **Kode**: `apps/` (server, antarmuka, app Mac), `packages/` (pustaka bersama, satu folder per paket/scene), `tools/` (skrip, **datar**, daftar di `tools/README.md`), `tests/` (datar).
- **Dokumen baru** → `docs/<topik>.md`, lalu satu baris di `docs/README.md`. README = cara pakai; HANDOFF = status kerja saja; `docs/` = rujukan. Satu topik satu dokumen: perluas yang ada sebelum membuat yang baru.
- **Gambar bukti** (tangkapan layar, lembar kontak, hasil ukur) → `docs/evidence/<topik>/`, bukan di samping dokumen.
- **Skrip tool** → `tools/` (tidak ada subfolder), tambahkan satu baris di `tools/README.md`.
- **Hasil sementara**, render, coretan → `output/`, `work/`, atau folder sementara sesi; tidak pernah dilacak.
- **Folder baru** hanya bila isinya minimal 4 berkas atau satu kesatuan yang jelas (satu scene, satu brand). Jangan membuat folder berlapis untuk 1–3 berkas.

## 4. Tidak boleh dilacak git
`*.log`, `*.bak`, `*.tmp`, `*.orig`, `.DS_Store`, folder `tmp`/`temp`, `node_modules`, hasil render (`output/`), data dan cadangan pemilik (`data/`), video referensi (`references/`), tangkapan layar sementara (`work/`), `.claude/settings.local.json`. Polanya ada di `.gitignore` (dikomentari); bila sebuah berkas terlanjur dilacak: `git rm --cached <berkas>`.

## 5. Dokumen
- `README.md` = cara pakai (ringkas, ada daftar isi dan peta folder). `HANDOFF.md` = status kerja saat ini, bukan sejarah (riwayat panjang masuk `docs/`). `docs/` = rujukan.
- Tautan relatif markdown harus menunjuk berkas yang ada; dokumen dipindah = perbarui semua rujukan (`grep` jalur lama, sisa harus nol).
- Dokumen arsip (`analysis.md`, `report.md`, `ux-v2.md`) tidak ditulis ulang; koreksi dicatat di dokumen aktif.

## 6. Bahasa
Dokumen internal dan komentar proyek: **Indonesia** (dokumen lama berbahasa Inggris tidak diterjemahkan ulang; bagian baru ditulis Indonesia). Teks di layar studio, nama tombol, teks video, judul/deskripsi/tag YouTube: **English (US)**. Nama berkas dan identifier kode: Inggris.

## 7. Keringanan
- Satu berkas dilacak ≤ **1 MiB**; gambar/data bukti di `docs/` ≤ **700 KiB** (dasar angka: audit 2026-11-20, sebelum kompresi 39 gambar docs > 500 KB, sesudah semua ≤ 700 KB; berkas terbesar di luar docs 976 KB).
- Kompres gambar bukti sebelum commit: foto/tangkapan layar ke JPEG q80–82 (`sips -s format jpeg -s formatOptions 80 a.png --out a.jpg`, macOS), lalu perbarui rujukannya. Biner besar tidak dilacak. Keluaran `branding/build.mjs` tidak dikompres (harus identik byte).
- Tidak ada paket di `package.json` tanpa impor/pemakaian, dan tidak ada berkas kode yang tidak dirujuk siapa pun (periksa dengan `git grep` nama berkas/ekspor sebelum menambah atau membiarkan).

## 8. Cara memeriksa
`node --test tests/conventions.test.ts` memeriksa: (1) nama berkas, (2) tidak ada log/bak/tmp/.DS_Store terlacak, (3) tautan relatif markdown di README, HANDOFF, AGENTS, docs, branding, tools, (4) tiap `.md` di `docs/` ada di `docs/README.md`, (5) batas ukuran. Pesan kegagalan menyebut berkas dan cara memperbaikinya. Pengecualian baru ditambahkan di tes itu **dengan alasan**, bukan dengan melonggarkan aturan.
