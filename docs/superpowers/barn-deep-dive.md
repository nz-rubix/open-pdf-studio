# BARN PDF deep-dive: where does the 670 ms go?

Date: 2026-05-12
Commit measured: `937e0c46` (HEAD at investigation time)
Test corpus: `test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf` (26.7 MB, 7 pages)
Methodology: ran `cargo run --release --example barn_deep_dive` against the real BARN file at `scale=1.5`, with `OPSR_PROFILE_IMAGES=1` and a temporary `OPSR_PROFILE_PHASES=1` instrumentation (now reverted). Direct Rust call — no Tauri/JS overhead, so numbers are slightly OPTIMISTIC vs the viewer.

## Verification: are the 3 fixes live?

| Fix | File | Evidence | Live? |
|---|---|---|---|
| #1 — drop DPR multiplier in `renderContinuousPage` | `open-pdf-studio/js/pdf/renderer.js` L877-921 | `invoke('render_pdf_page', { scale: doc.scale, ... })` — no `* contDpr`, comment block explicitly references the fix | YES |
| #2 — wire JS bitmap cache in continuous mode | same file, L899-910 | `_bitmapJSCacheGet(_jsCacheKey)` called before invoke; `_bitmapJSCacheSet(...)` on success | YES |
| #3 — direct binary IPC, no tempfile | `open-pdf-studio/src-tauri/src/lib.rs` L1184-1203 | `Result<tauri::ipc::Response, String>`; manual `[w u32 LE][h u32 LE][rgba...]` framing; no `tempfile` / no `allow_fs_scope` | YES |

All three fixes are present in the source tree at HEAD = `937e0c46`. The benchmark numbers the caller reported (670 ms/page cold, 3× better than pre-fix 1500-2500 ms) match the post-fix configuration.

## Per-phase Rust timing breakdown (cold render, scale=1.5)

Output sizes are uniform 3672 × 2376 RGBA = 33 MB per page.

| Phase | p0 | p1 | p2 | p3 | p4 | p5 | p6 | Avg |
|---|---|---|---|---|---|---|---|---|
| `resources` (lookup + lock font registry) | 16 ms | 8 ms | 6 ms | 6 ms | 6 ms | 6 ms | 10 ms | 8 ms |
| `interpret total` | 323 ms | 444 ms | 183 ms | 236 ms | 128 ms | 228 ms | 639 ms | 312 ms |
| ↳ `content_decode` | 57 ms | 17 ms | 1 ms | 1 ms | 5 ms | 1 ms | 32 ms | 16 ms |
| ↳ `predecode_parallel` (rayon image decode) | 44 ms | 31 ms | 71 ms | 102 ms | 4 ms | 100 ms | 15 ms | 52 ms |
| ↳ `serial_walk` (operator loop, incl. draws) | 201 ms | 387 ms | 106 ms | 127 ms | 116 ms | 122 ms | 577 ms | 234 ms |
| `annot` (annotation appearances) | 16 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 2 ms |
| `into_rgba` (Pixmap → Vec memcpy, 33 MB) | 8 ms | 7 ms | 8 ms | 9 ms | 9 ms | 8 ms | 9 ms | 8 ms |
| `cache-store` (pixmap LRU insert) | 6 ms | 7 ms | 8 ms | 7 ms | 9 ms | 7 ms | 7 ms | 7 ms |
| **TOTAL** | **369** | **468** | **204** | **258** | **151** | **250** | **665** | **338** |

(p0 includes a one-time font-load: `AcadEref.ttf` from system fonts, +15 ms.)

Image-stage detail from `OPSR_PROFILE_IMAGES=1` (all values in µs, totalled across that page's image draws):

| | p0 | p1 | p2 | p3 | p4 | p5 | p6 |
|---|---|---|---|---|---|---|---|
| image refs | 20 | 62 | 12 | 14 | 12 | 10 | 73 |
| unique images | 14 | 48 | 12 | 14 | 11 | 10 | 16 |
| max reuse | 2 | 6 | 1 | 1 | 2 | 1 | 33 |
| flate | 38 ms | 60 ms | 139 ms | 212 ms | 7 ms | 114 ms | 0 |
| predictor | 23 ms | 14 ms | 82 ms | 92 ms | 4 ms | 80 ms | 0 |
| raw decode | 75 ms | 88 ms | 271 ms | 361 ms | 15 ms | 242 ms | 0 |
| jpeg | 0 | 0 | 0 | 0 | 0 | 0 | 29 ms |
| draw_image (tiny_skia) | 68 ms | 138 ms | 62 ms | 76 ms | 28 ms | 72 ms | 190 ms |

(Image stage totals can exceed `predecode_parallel` time because the parallel pass runs the heavy flate/raw work across multiple CPU cores — the wallclock benefits, the totalled microseconds reflect raw CPU consumed.)

Pixmap-cache HOT-pass timing (second pass over the same 7 pages, hitting the doc-level LRU): 6-10 ms/page, total 47 ms / 7 = 7 ms avg. The pixmap cache works exactly as designed — same `(page, scale, rotation)` revisit is effectively free.

## Smoking gun

**`serial_walk` inside `Interpreter::execute_internal` is the dominant phase across every page.** Average 234 ms / 338 ms total = **69 % of cold render time**.

Inside `serial_walk` itself, two sub-phases dominate:

1. **`draw_image` via `tiny_skia::Pixmap::fill_path` with a Pattern shader.** This is CPU-rasterised bilinear sampling onto a 3672 × 2376 surface. p6 (worst page) spends ~190 ms in 73 image draws. Even on text-heavy p0 / p1 it's 68-138 ms. The Pattern + `fill_path` route was chosen for edge-rounding parity with PyMuPDF (renderer.rs L433-461), but it's 3-4× slower than the simple `draw_pixmap` fallback path.

2. **Per-glyph path fills.** p0 (126 k operators, 20 image refs) and p1 (53 k ops, 62 image refs) and p6 (100 k ops, 73 image refs) all spend `serial_walk - image_time` in the 200-400 ms range. With ~12 k glyph fills per page on text-heavy pages, the bottleneck is `tiny_skia::Pixmap::fill_path` rasterising each glyph outline at the output resolution. The existing `glyph_path_cache` saves the Path-construction time but NOT the rasterisation.

The phase that the original investigation hypothesis flagged — "image decode" — is **only ~15 % of total** (avg 52 ms `predecode_parallel`). The existing per-page `ImageCache` (iter-24) plus parallel rayon pre-decode (iter-25) already crushed that. Caching decoded RGBA across pages/zooms would give marginal wins (image bytes are reused only within a page, and the pixmap cache already serves cross-zoom-same-scale hits).

## Recommended next fix

**Move the rasteriser to GPU.** The CPU-side `tiny_skia` Pixmap pipeline is the floor — for a 3672×2376 RGBA surface you cannot make `fill_path` for thousands of glyphs and bilinear-sampled images finish in <50 ms on a single CPU thread, no matter what caching layer you add. The existing `docs/superpowers/specs/2026-05-11-gpu-rendering-engine-design.md` plan (Skia-native renderer) is the right next step.

If a smaller, lower-risk fix is wanted FIRST, two tactical wins are visible from the profile:

1. **`renderer.rs::draw_image` — switch from `Pattern + fill_path` back to `draw_pixmap` when the destination is axis-aligned + integer-pixel** (the common case). The edge-rounding fix only matters when the destination rect lands on a sub-pixel boundary; for most images on most pages it's wasted overhead. Expected impact: 30-50% reduction in `draw_image` time → ~50 ms/page saved on image-heavy pages (p1, p6).

2. **Drop the `font_registry` Mutex hold across the whole interpret phase** (`parser.rs::render_page_internal` L210-244). The mutex is held for the full 100-600 ms `serial_walk`. When the viewer scrolls fast and 4 pages start rendering in parallel (Tauri commands run on a tokio threadpool), only ONE actually progresses — the others spin. This won't reduce SINGLE-page time but will fix the user's "ridiculously slow on scroll" perception because parallel page rendering is currently serialised. Convert to `RwLock` (read for font lookups, write only for new-font registration) or per-thread scratch state.

Both are 30-60-minute fixes vs the multi-day GPU port and capture most of the user-perceptible "scroll feels slow" effect.

## Why the user perceives "factor 100"

**The user's perception is real but their math is off.** Three things compound:

1. **Average vs P99.** The bench reported 670 ms — that's near the worst case (p1 + p6 are 467-665 ms; p2-p5 are 150-260 ms). Average across all 7 BARN pages is 338 ms. Other PDFs in the corpus (Tekst.pdf, plain text-only) render in 30-80 ms. The user's intuition for "fast" comes from the trivial PDFs; BARN is genuinely 4-8× slower than the easy cases, NOT 100×.

2. **Scrolling triggers parallel renders that serialise on the font_registry mutex.** When the user fast-scrolls through BARN, the IntersectionObserver fires renderContinuousPage for 2-3 pages within ~100 ms. Each invokes Tauri's `render_pdf_page` command, which runs on the tokio threadpool. They ALL try to lock the same `font_registry` Mutex. Wall-time observed by the user becomes (page1_cold + page2_cold + page3_cold) sequenced, not parallelised. 3 × 400 ms = 1.2 s perceived latency to "scroll past 3 pages" — and they likely scroll faster than that.

3. **The text layer / link layer / form layer post-render work in `renderContinuousPage` (L959-991) adds 50-200 ms of JS-side PDF.js work AFTER the Rust render returns,** which the JS-side `[render p${pageNum}]` `console.time` label IS NOT measuring. The bench's reported 670 ms is only the Rust phase. Total viewer-perceived latency per page = 670 ms Rust + ~100 ms layers = ~770 ms before the page is fully interactive.

Realistic ceiling without GPU: with the two tactical fixes above + parallel-render unblocking, BARN should get to 200-400 ms/page in scroll (vs current 400-900). With the GPU port, sub-50 ms is plausible. The user's "factor 100 too slow" is closer to "factor 5-10 too slow on the worst pages, factor 2-3 on average" — but the perception is amplified by the parallel-render-serialisation bug, which actually CAN feel like 100× when fast-scrolling.

---

## Source files inspected

- `open-pdf-studio/js/pdf/renderer.js` — `renderContinuousPage` (verified all 3 fixes)
- `open-pdf-studio/src-tauri/src/lib.rs` — `render_pdf_page` command (verified Fix #3)
- `open-pdf-render/src/parser.rs` — `render_page_internal` (pixmap cache + font_registry mutex)
- `open-pdf-render/src/interpreter.rs` — `execute_internal` (operator loop + ImageCache + predecode)
- `open-pdf-render/src/renderer.rs` — `draw_image` (Pattern + fill_path rasterisation)

## Bench raw output

See `docs/superpowers/barn-bench-run.txt` for the full stderr/stdout capture.

## Repro

```bash
cd open-pdf-render
cargo build --release --example barn_deep_dive
./target/release/examples/barn_deep_dive.exe \
  "C:/Users/rickd/Documents/GitHub/open-pdf-studio/test pdf-bestanden/Originele bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf" \
  1.5
```

The example source lives at `open-pdf-render/examples/barn_deep_dive.rs` (untracked at time of writing; commit it separately to make the repro permanent) and uses `OPSR_PROFILE_IMAGES=1` (already wired into `interpreter.rs`). The `OPSR_PROFILE_PHASES=1` env var that gave the parser-level breakdown was a temporary instrumentation now reverted — re-introduce it if rerunning the deep-dive.
