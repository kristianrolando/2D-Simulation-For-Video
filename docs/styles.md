# Style — sidik jari referensi dan 5 style sendiri

## 1. Sidik jari referensi ("zona yang dihindari")

Disimpulkan dari `docs/analysis.md` §3–§5 dan contact sheet 18 video (frame pada t = 20 s).

| Sumbu | Gaya bersama ke-18 video referensi |
|---|---|
| Palet | Navy→hitam (#030619 → #000005), dinding neon **cyan** #9CF3FF, bola **pelangi berurutan**, aksen **emas** #FFD23F untuk angka dan jawaban |
| Latar | Gradien polos tanpa tekstur, vignette sangat halus |
| Bentuk & garis | Garis neon tipis dengan bloom; bola bulat mengilap dengan cincin putih dan glow; ekor komet; jejak string-art aditif tipis; cincin fokus bulat |
| Tipografi | DejaVu Sans Bold, rata tengah, judul pertanyaan ±58 px di sepertiga atas; counter `label: nilai` dengan nilai emas; handle abu-abu kecil |
| Gerak & easing | Kecepatan fisik konstan, tanpa easing presentasi; tanpa kamera atau transisi; angka counter langsung melompat |
| Tingkat efek | Bloom dan blending aditif di mana-mana; ripple/kilatan 0,3–0,6 s; tanpa shake, partikel, atau squash |
| Audio | "Tok" kering per tumbukan, chime lonceng pada event, tanpa musik dan tanpa reverb; sunyi di antara event |

Style `classic` (bawaan, untuk kompatibilitas) sengaja tetap di zona ini. Kelima style di bawah menghindarinya.

## 2. Lima style

Setiap style berbeda di 6–7 dari 7 sumbu, baik dari referensi maupun satu sama lain:

| | Riso Print | Chalkboard | Amber Terminal | Candy Pop | Blueprint |
|---|---|---|---|---|---|
| Konsep | Poster risograf: dua tinta spot dicetak tumpuk di kertas hangat, sedikit meleset | Papan tulis guru: kapur pastel goyah di papan hijau bernoda | Monitor CRT amber: satu warna fosfor, scanline, blok piksel | Stiker kartun di sunburst ungu | Gambar teknik: garis ganda putih di kertas biru bergrid |
| Cocok untuk | Peluang/statistik, pop-science yang terasa "dicetak" | Penjelasan langkah demi langkah, pembuktian | Algoritma, chaos, konten penuh hitungan | Konten santai, anak-anak, reaksi | Geometri, optik, mekanika |
| Palet | Pink fluoresen + biru federal + kuning, **terang** | Kapur pastel di hijau tua | Monokrom amber | Pastel jenuh + putih di ungu | Putih/biru pucat + "pensil merah" |
| Latar / tekstur | Kertas krem + halftone pink | Noda kapur, bekas hapusan, debu | Scanline + vignette CRT | Sunburst + taburan titik | Grid mayor/minor |
| Bahasa bentuk | Blok tebal datar, tinta kedua meleset 5 px (multiply) | Garis berlapis bergetar, berpori | Piksel: garis dan bola kotak | Outline putih tebal + bayangan keras | Garis ganda + garis sumbu titik-strip, bola = cincin bercrosshair |
| Tipografi | Condensed 800 KAPITAL, rata kiri, blok sorot di judul, angka besar ("stack") | Tulisan tangan (Chalkduster), garis bawah coretan | Monospace huruf kecil, prompt `>`, kursor, counter `[ … ]` | Rounded bold, counter dalam pill putih | DIN Condensed KAPITAL dalam kotak title block "FIG. 01" |
| Gerak presentasi | Judul slide-in, pop outBack ×1,3 | Judul wipe lambat, easing sinus, tanpa shake | Judul diketik, counter berdetak 6 langkah, shake glitch horizontal | Judul jatuh memantul, pop elastis ×1,8 | Wipe presisi, linear, tanpa shake |
| Profil juice | Burst confetti ×1,3, squash ×1,2, flash = tinta kuning | Debu kapur, squash ×0,4, flash lembut | Partikel kotak, flash **invert** | Confetti ×1,8, squash ×1,8, shake ×1,5 | Penanda silang, burst ×0,6, tanpa squash/shake |
| Blending | multiply (tinta) | screen | aditif | normal | screen |
| Palet audio | −2 st, mayor, low-pass 3,8 kHz, drive pita, slapback | −5 st, minor pentatonik, chime→marimba, gema ruang kelas | +7 st, whole-tone, bitcrush 7-bit/11 kHz | +5 st, mayor, tick/bounce→pop, doubler | −3 st, lidia, kering, high-pass 300 Hz, chime→klik |

## 3. Bukti perbedaan

Dihasilkan oleh `node tools/style-evidence.ts` (tabel: `docs/styles/focal-reflection-evidence.md`, gambar: `docs/styles/focal-reflection-vs-reference.png`) dan dijaga oleh `tests/theme.test.ts` (selisih piksel rata-rata antar-style > 12/255 pada dua scene). Lembar per scene: `docs/styles/<scene>-sheet.png`.


## 4. Style editor (styles made in the studio)

In the Style section of the studio: **＋ New style from this one** starts from the style that is selected; **Edit this style**
appears for styles you made. A panel opens beside the preview and the preview redraws as you change things. You can set the name,
icon and description, the colours (two background colours, gradient type, text, accent, secondary text, walls and lines, 3 to 8 ball
colours), the font (seven stacks that all end with a bundled font), capitals and alignment, and the look (line style and glow,
ball style, texture and its strength, spark shape). Everything not listed (motion, juice, audio, the background controls) is
copied from the style you started with, so the result is a complete file that no longer depends on it.

- **Save** writes `themes/<id>.json` with `"custom": true` and `"basedOn"`. The style is listed at once (no restart), works in every
  scene, and its thumbnails and covers follow it. The id comes from the name (`Violet Lab` → `violet-lab`).
- **Shipped styles are protected.** A file without `"custom": true` is never overwritten or deleted by the editor, and `classic`
  cannot be replaced. The server refuses such requests (409).
- **Delete** (own styles only) removes the file. Videos already rendered keep their look; entries in Videos that used it fall back to
  Classic Neon.
- **Hints, not blocks:** the editor warns when the text colour has less than 4.5:1 contrast on the background, when the accent is close
  to the background, or when a ball colour would disappear. It only blocks a missing name or an invalid colour.
- A light background cannot use additive light: when you change the background from dark to light (or back), the editor switches the
  blend (`lighter` ↔ `source-over`) for you.
- While the panel is open the preview shows a draft and **Render MP4 is paused** (a message says so), so a draft is never rendered.
- You can still write a style file by hand; the editor only automates the common case. `SIM_THEME_DIR` points the studio at another
  themes folder (the tests use it).

Code: `packages/theme/editor.ts` (pure), `packages/theme/node.ts` (files), `apps/studio/style-editor.ts` (panel),
`/api/themes` POST and DELETE in `apps/server/server.ts`. Tests: `tests/style-editor.test.ts`.
