# Kredit ElevenLabs: guard satu pintu

Setiap pemakaian kredit ElevenLabs di proyek ini lewat satu fungsi: `runGeneration()` di `packages/sfx-guard/guard.ts`.
Satu-satunya perintah yang bisa memanggilnya adalah `node tools/sfx.ts generate`. Studio, server, render dan pratinjau
tidak pernah memanggil ElevenLabs; mereka hanya membaca sampel yang sudah ada di `assets/sfx/` (peran tanpa sampel memakai synth lokal).

## 1. Peta titik yang bisa menghabiskan kredit (temuan Tahap 1, 2026-11-18)

| Titik | Status |
|---|---|
| Kode proyek (`apps/`, `packages/`, `tools/`) | Sebelum guard: **tidak ada** kode yang memanggil API ElevenLabs. `tools/sfx.ts` lama hanya `plan` / `import` / `reprocess` / `list`, tanpa jaringan. Sekarang satu-satunya kode jaringan ada di `packages/sfx-guard/client.ts` (dicek tes). |
| Studio (`apps/studio/main.ts`) dan render (`apps/server/render-job.ts`) | Hanya membaca `assets/sfx/manifest.json` + berkas `.wav`. Tidak ada jalur generasi. |
| Konektor MCP `mcp__elevenlabs__*` (dipasang di `~/.claude.json`, HTTP ke `api.elevenlabs.io/v1/mcp`) | **Jalur yang dipakai untuk kedua batch sebelumnya.** Bisa memakai kredit tanpa melewati kode proyek: `creative_generate_speech`, `creative_generate_image`, `creative_generate_video`, `creative_edit_image`, `creative_generate_in_flow` (termasuk efek suara), `creative_run_flow_nodes`, `creative_design_voice`, `creative_transcribe_audio`, `agents_*` yang menjalankan percakapan/tes/panggilan (`agents_run_tests`, `agents_outbound_call`, `agents_submit_batch_call`, `agents_generate`, ...). Guard kode tidak bisa mencegatnya; yang berlaku adalah aturan agen di §4. Panggilan baca seperti `account_get_usage` gratis. |
| Kunci API | Tidak ada di proyek ini. Proyek lain (Studio Cerita) menyimpan kunci ElevenLabs di folder Application Support-nya sendiri; guard **tidak** membacanya. |

### Cara kerja penolakan duplikat lama dan celahnya
Lama: `promptHash = sha1(model|prompt|duration)` (16 hex). `plan` tidak mencantumkan hash yang sudah ada di manifest; `import` menolak hash yang sudah ada.

Celah yang ditemukan:
1. Pemeriksaan terjadi **sesudah** kredit terpakai (saat `import`). Generasi lewat MCP tidak melewati pemeriksaan apa pun; `plan` hanya saran.
2. Mengganti `model` di `requests.json` mengubah semua hash, sehingga `plan` akan mencantumkan ulang ke-13 suara.
3. Mengubah sedikit teks prompt (spasi, huruf besar) dianggap prompt baru; `import` lalu **menimpa** berkas asli berbayar di `src/` dan menambah entri ganda di manifest.
4. Hash tidak memuat parameter lain (prompt_influence, loop, format keluaran).
5. Tidak ada catatan panggilan: suara yang sudah dibayar tetapi belum di-import (mis. sesi terputus) akan tercantum lagi.
6. Tidak ada persetujuan, estimasi, sisa kredit, batas jumlah/kredit, atau penanganan kredit habis.
7. Manifest ditulis tidak atomik.

## 2. Aturan guard

1. **Default aman.** `generate` tanpa `--yes` adalah dry run: daftar yang akan dibuat, estimasi kredit, sisa kredit akun (panggilan gratis), dan pemakaian 24 jam. Tanpa `--yes` tidak ada panggilan berbayar.
2. **Sebelum panggilan:** saldo akun terbaca dan cukup; estimasi ≤ batas per run dan ≤ batas 24 jam (dihitung dari ledger); tidak ada duplikat: id sudah di manifest, hash lama atau hash guard (prompt dinormalisasi + model + durasi + prompt_influence + loop + format) sudah ada, teks prompt yang sama sudah ada, berkas `<id>.wav` atau `src/<id>.*` sudah ada, atau ledger mencatatnya.
3. **Ledger** `assets/sfx/ledger.json` (masuk git): nomor, waktu, id, hash guard, model, durasi, estimasi, pemakaian nyata (selisih penghitung akun; `null` bila belum terlihat), status `started`/`ok`/`failed`, galat. Ditulis atomik (berkas sementara + rename). Hanya hash, tanpa teks prompt, tanpa kunci (pesan galat disaring).
4. **Tanpa retry.** Satu panggilan dikirim sekali. Gagal => run berhenti, dicatat `failed`, sisa daftar tidak dikirim. Run berikutnya melewati id itu kecuali pemilik menulis `--again <id>`. Entri `ok` tidak pernah dibuat ulang. Entri `started` tanpa akhir (crash) memblokir id itu sampai pemilik memeriksa akun dan menandainya `failed`.
5. **Kredit habis** (`quota_exceeded`, 402, dsb.) => berhenti dengan pesan jelas. Tidak mencoba lagi, tidak membeli, tidak mengubah paket.
6. **Batas:** 1 take per suara; durasi ≤ `maxDurationSec`; panjang prompt ≤ `maxPromptChars`; panggilan ≤ `maxCallsPerRun`; bila biaya nyata satu panggilan > estimasi × `maxOverrunFactor`, run berhenti.
7. Studio dan render tidak mengimpor guard maupun klien (dicek tes).
8. Berkas asli berbayar di `src/` tidak pernah ditimpa.

### Batas dan konfigurasi
Berkas milik pemilik, di luar proyek: `~/Library/Application Support/Sim Studio/elevenlabs-guard.json`. Bila tidak ada, dipakai default:

```json
{ "maxCallsPerRun": 3, "maxCreditsPerRun": 150, "maxCreditsPer24h": 300, "maxDurationSec": 3, "maxPromptChars": 300, "creditsPerSecond": 40, "maxOverrunFactor": 1.5 }
```

- Opsi perintah (`--max-credits`, `--max-calls`) hanya bisa **menurunkan** batas. Semua nilai dijepit ke `HARD_CEILING` di `guard.ts`.
- `creditsPerSecond` adalah laju estimasi, sengaja konservatif. Batch sebelumnya lewat MCP tercatat sekitar 3,3 kredit/detik; tarif API langsung belum terukur. Setelah ada pemakaian nyata di ledger, pemilik boleh menyesuaikannya.
- Kunci API: `ELEVENLABS_API_KEY` atau `~/Library/Application Support/Sim Studio/elevenlabs.json` berisi `{"apiKey": "..."}`, mode 600. Tidak pernah di proyek, log, ledger, atau chat.

## 3. Perintah

```bash
node tools/sfx.ts plan
```
Luring: apa yang belum ada di pustaka, alasan tiap yang dilewati, masalah yang akan ditolak.

```bash
node tools/sfx.ts generate --only slam-metal
```
Dry run: daftar, estimasi, sisa kredit akun. Tidak ada yang dibayar.

```bash
node tools/sfx.ts generate --only slam-metal --yes
```
Membuat tepat daftar itu (pemilik yang menjalankan, atau agen setelah persetujuan di chat untuk daftar dan estimasi yang sama).

```bash
node tools/sfx.ts ledger
```
Catatan panggilan berbayar.

`import <id> <file>` mendaftarkan berkas yang sudah ada (tanpa kredit) dan menolak duplikat serta penimpaan `src/`.

## 4. Aturan untuk agen (Claude, Codex, dll.)
Ringkasan ini juga ada di `AGENTS.md`.
- Jangan memanggil alat `mcp__elevenlabs__*` yang memakai kredit, atau API ElevenLabs, tanpa persetujuan pemilik di chat untuk **daftar spesifik beserta estimasinya**. Satu persetujuan hanya berlaku untuk daftar itu; daftar lain atau pengulangan butuh persetujuan baru.
- Untuk efek suara, pakai `node tools/sfx.ts generate` (dry run dulu, tunjukkan hasilnya ke pemilik, baru `--yes`), bukan konektor MCP.
- Jangan mengubah `elevenlabs-guard.json`, `HARD_CEILING`, atau ledger untuk melonggarkan batas; jangan menandai entri `started` sebagai `failed` tanpa pemilik.
- Jangan menjalankan ulang panggilan yang gagal; laporkan dan biarkan pemilik memutuskan.
- Jangan pernah membuat suara asli untuk pengujian; tes memakai klien palsu.

## 5. Bukti
`tests/sfx-guard.test.ts` (klien palsu dan fetch palsu, tanpa jaringan): tanpa persetujuan tidak ada panggilan; duplikat ditolak; melebihi batas ditolak; gagal tanpa retry; restart sesudah berhasil tidak mengulang; crash memblokir; kredit habis berhenti; biaya melonjak berhenti; ledger tanpa kunci dan tanpa teks prompt; klien hanya mengirim satu permintaan dan kunci hanya di header; hanya `client.ts` yang menghubungi ElevenLabs, hanya `guard.ts` yang memanggil `generateSound`, `apps/` tidak mengimpor keduanya.
