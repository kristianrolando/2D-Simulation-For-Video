# branding/

Kit identitas visual channel YouTube (foto profil, banner, watermark, cover Shorts, thumbnail) dan pembangunnya. Gambar dibuat oleh kode, bukan digambar tangan.

| Entri | Fungsi |
|---|---|
| `brand.json` | Definisi **Photon Lab** (channel utama, id bawaan): nama, handle, warna, huruf, teks contoh. |
| `build.mjs` | Pembangun: `node branding/build.mjs` (Photon Lab → `svg/` dan `png/` di sini) atau `node branding/build.mjs <id>` (brand lain → `brands/<id>/svg` dan `png`). |
| `check-contrast.mjs` | Pemeriksaan kontras WCAG dan ukuran kecil: `node branding/check-contrast.mjs [<id>]`. |
| `pack.mjs` | Paket serah-terima untuk pemilik channel lain: `node branding/pack.mjs <id>` (folder + zip di `output/`, lalu pemeriksaan otomatis). |
| `svg/`, `png/` | Keluaran Photon Lab (aktif). Berkas `.png` dan `.svg` di sini dan di `brands/*/` adalah **keluaran build.mjs**: jangan disunting tangan, bangun ulang. |
| `brands/<id>.json` | Definisi brand lain; `brands/<id>/` berisi `README.md`, `svg/`, `png/` keluarannya. Aktif: `plasma-pendulum` (channel kedua, unggah manual), `fourier-loom` (channel ketiga, dikelola teman pemilik). Cadangan nama: `tangent-loom`. |
| `preview.html` | Halaman lihat-cepat keluaran Photon Lab (`png/`) dalam ukuran asli YouTube; buka langsung di browser. |

## Aturan penting
- Hasil Photon Lab dan Plasma Pendulum harus **identik byte demi byte** setelah dibangun ulang: sesudah `node branding/build.mjs` dan `node branding/build.mjs plasma-pendulum`, `git status branding/` harus bersih. Kunci opsional baru di `build.mjs` tidak boleh mengubah keluaran brand yang tidak memakainya.
- Nama berkas keluaran (`banner_2560x1440.png`, `profile_800.png`, …) dipakai `pack.mjs`, `tests/channel-kit.test.ts`, dan README tiap brand; jangan diubah (pengecualian di `tests/conventions.test.ts`).
- Tumpang tindih yang disengaja: `fourier-loom` dan `tangent-loom` menghasilkan profil, watermark, dan beberapa contoh yang sama persis (hash identik, diperiksa 2026-11-20). Keduanya dibangun ulang oleh `pack.mjs fourier-loom`, jadi salinan tidak dihapus tangan (akan muncul lagi saat build).
- Teks channel (deskripsi, kata kunci, playlist) ada di blok `copy` pada JSON brand; README tiap brand menjelaskan langkah pemasangan di YouTube Studio.
