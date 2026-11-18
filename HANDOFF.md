# HANDOFF — Sim Studio

Catatan singkat antar sesi. Perbarui di akhir tiap sesi kerja. Terakhir diperbarui: 2026-11-18.

## Apakah studio yang berjalan memuat kode terbaru?

Jangan percaya catatan ini; tanyakan ke studio:

```bash
curl -s localhost:5180/api/status
```

`"codeStale": false` = kode terbaru. `true` = ada berkas server yang lebih baru dari saat studio menyala; restart (`Ctrl+C`, lalu `npm run dev`).
Jangan restart saat ada render atau unggahan berjalan (lihat "Needs you" di Videos). Dengan `npm run dev:watch` restart terjadi otomatis;
render yang berjalan menjadi **Stopped** dan bisa **Render again**.

## Selesai dan di-commit (cabang main)

- Fondasi: studio, scene, style, render, audio, juice, Videos, unggah YouTube.
- Teks publikasi + thumbnail (5 gaya judul, deskripsi, tag, pemeriksa kualitas, cover 9:16 yang diunggah). `docs/publishing.md`.
- Mode terang/gelap (hanya antarmuka). `docs/ui-modes.md`.
- Thumbnail Shorts: yang diunggah gambar tegak 1080×1920 (YouTube memotong ke 9:16); tombol "Set the thumbnail again" untuk video lama.
- Editor style (style buatan sendiri → `themes/<id>.json`). `docs/styles.md` §4.
- Antrean render tahan restart: `data/jobs.json`, status Stopped, Render again, worker satu grup proses, sapu sisa berkas, `dev:watch`.
  Kode: `apps/server/job-store.ts`, `apps/server/server.ts`, `apps/server/worker.ts`. Tes: `tests/job-queue.test.ts`.

## Belum / perlu pemilik

- Restart studio agar memuat kode terbaru (lihat atas).
- Cek thumbnail `KYUpU2KtKUw` di YouTube Studio (sudah dipasang ulang dengan gambar 9:16; tampilan belum dilihat). Video `60J5S2RCJ1Y` (Published)
  masih punya thumbnail lama; tombol "Set the thumbnail again" tersedia, perlu persetujuan (50 unit kuota).
- Render scene lain untuk mengisi peta scene × style.
- `presets/main-1.json` (preset buatan pemilik) belum di-commit; commit bila ingin disimpan di riwayat.

## Aturan tetap

- Kredensial hanya di `~/Library/Application Support/Sim Studio/` (mode 600); tidak pernah di folder proyek, log, atau chat.
- Tidak pernah menghapus video di YouTube. Unggah, pasang ulang thumbnail, dan ubah channel hanya atas persetujuan pemilik.
- `references/` (video kompetitor) tidak di git dan tidak diubah. `data/` dan `output/` tidak di git.
- Mesin render, scene, dan style bawaan tidak diubah oleh fitur antarmuka/penerbitan.
