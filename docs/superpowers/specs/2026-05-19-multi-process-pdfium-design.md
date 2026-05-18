# Multi-Process PDFium — Design Spec

**Status:** Draft, awaiting user review
**Date:** 2026-05-19
**Branch:** `feat/fast-open-barn`
**Target version:** v1.59.0
**Authors:** Claude + Rick (algemeen3bm@gmail.com)

---

## Goal

Reduce per-page cold-navigation time on huge construction-PDF pages (NKD1a's
5156×2384 pt pages) from ~1.7 s to ~450 ms by rendering across **5 PDFium
instances in parallel** (1 in main process + 4 sidecar workers) instead of the
current single-instance bottleneck.

## Background

Measured today on NKD1a v1.58.x:

| Phase | Cost |
|---|---|
| analyze_page_type (JS cache hit) | 5 ms |
| renderPage JS code path | ~30 ms |
| **PDFium render of one tile page** | **~1.5–2.7 s** ← bottleneck |
| Bitmap-orchestrator + canvas paint | ~50 ms |

PDFium runs single-threaded with a global mutex in the
`pdfium-render` crate (the `thread_safe` feature acquires the mutex on every
call). Background prefetch made things WORSE in v1.55-v1.56 because it
contended with thumbnail rendering for the same mutex. The single-process
ceiling for PDFium on this hardware is ~1 page every 1.5–2.7 s for huge pages.

Multi-process parallelism is the only way past that ceiling without changing
the renderer.

## Architecture

### Components

```
┌────────────────────────────────────────────────────────────────────┐
│                       Tauri main process                            │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  WebView (SolidJS UI + vanilla JS render orchestration)       │ │
│  │  invoke('render_pdf_page', {path, page_index, scale, rot})    │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │ Tauri IPC                       │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │  src-tauri/src/worker_pool.rs (NEW)                            │ │
│  │  ┌──────────────────────────────────────────────────────┐     │ │
│  │  │  PoolRouter — hash(path+page)%4 + overflow fallback   │     │ │
│  │  │  WorkerState×5: { stdin, stdout, shm, queue_depth }    │     │ │
│  │  └──────────────────────────────────────────────────────┘     │ │
│  │                       │                                         │ │
│  │     ┌─────────────────┼─────────────────┐                       │ │
│  │     ▼                 ▼                 ▼                       │ │
│  └─────│─────────────────│─────────────────│───────────────────────┘ │
│        │                 │                 │                          │
│  PDFium (in-proc)   stdin+SHM #0   stdin+SHM #1  ...                  │
│        │                                                              │
└────────│──────────────────────────────────────────────────────────────┘
         │
   ┌─────▼──────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ Worker #1  │  │ Worker #2  │  │ Worker #3  │  │ Worker #4  │
   │  PDFium    │  │  PDFium    │  │  PDFium    │  │  PDFium    │
   │  SHM 64MB  │  │  SHM 64MB  │  │  SHM 64MB  │  │  SHM 64MB  │
   │  bytes$    │  │  bytes$    │  │  bytes$    │  │  bytes$    │
   │  pixmap$   │  │  pixmap$   │  │  pixmap$   │  │  pixmap$   │
   └────────────┘  └────────────┘  └────────────┘  └────────────┘
        pdfium-worker.exe (sidecar binary, NEW crate)
```

**5 PDFium instances total**, persistent from app start:
- 1 in the Tauri main process (existing `pdfium_renderer.rs` path, unchanged
  for callers that don't go via `worker_pool` — e.g. legacy commands that
  haven't migrated yet)
- 4 in sidecar `pdfium-worker.exe` subprocesses, spawned at app init

**Per worker:**
- Own PDFium runtime (loads DLL once, ~50 ms startup × 4 = ~200 ms added to
  cold app start — acceptable, parallelised with WebView init)
- Own bytes cache (path → file bytes)
- Own pixmap cache (path, page, scale_q, rot) → RGBA bytes — bounded to
  40 entries with LRU eviction
- Own 64 MB shared-memory region (memmap2) for bitmap output transfer
- stdin/stdout pipes for control plane

### IPC: hybrid control + data plane

**Control plane: NDJSON over stdin/stdout**

Single line per message, terminated by `\n`. Simple, debuggable in any shell.

```jsonc
// Main → worker (stdin)
{"id":42,"op":"render","path":"C:/foo.pdf","page_index":5,"scale":0.25,"rotation":0}

// Worker → main (stdout) — success
{"id":42,"ok":true,"w":1289,"h":596,"shm_bytes":3072512}

// Worker → main (stdout) — error
{"id":42,"ok":false,"error":"PDFium failed: out of memory"}

// At spawn time, worker → main once
{"op":"ready","shm_name":"pdfium-worker-2","shm_size":67108864}

// At shutdown
{"op":"shutdown"}
```

**Data plane: shared memory via memmap2**

Each worker memmaps a 64 MB file (Windows: pagefile-backed, Unix: tmpfs). Wire
layout per slot:

```
offset 0..3     : width  (u32 LE)
offset 4..7     : height (u32 LE)
offset 8..31    : reserved (zero-padded)
offset 32..     : RGBA payload (width × height × 4 bytes)
```

Worker writes payload before sending ack on stdout. Main mmaps the same region
read-only after receiving ack, slices `shm_bytes` and forwards via
`tauri::ipc::Response` to JS — zero-copy from worker render to JS receiver.

**Fallback for >64 MB bitmaps:** an A0 at high zoom can exceed the SHM region.
In that case the worker sends `{"ok":true,"shm_bytes":0,"base64":"..."}` with
the RGBA base64-encoded inline. Slow but correct. Expected to be rare; logged
as `[worker-N] SHM overflow, falling back to base64`.

**Concurrency model:** 1 in-flight request per worker. PDFium can't render
multiple pages concurrently in one process anyway (its internal locking
serialises). Multiple in-flight per worker would only add SHM-slot management
without speedup.

### Routing: hybrid affinity + overflow

```
fn pick_worker(path, page_index, depths: [usize; 5]) -> usize {
    let affinity = hash(path, page_index) % 5;
    if depths[affinity] <= 2 {
        return affinity;
    }
    // Overflow: pick least-busy
    depths.iter().enumerate().min_by_key(|(_, d)| **d).0
}
```

Main process is `worker_id == 0` in this scheme — it participates in routing
like the others. The PoolRouter tracks queue depth via atomic counters: incr
before sending, decr after receiving ack.

**Why hybrid:** pure affinity cache-locks well but a user dwelling on one
page would idle 4 of 5 workers. Pure least-busy load-balances but a hot page
might bounce between 5 workers' caches (5× memory + 5× cold render cost).
Hybrid hits cache when the user is browsing different pages (most common
case) and falls back to balance when one slot is hot.

### Worker lifecycle

**Spawn (at app init, before WebView is ready):**
1. Main process spawns 4 workers via `tauri::async_runtime::Command::sidecar()`
2. Each worker:
   - Loads pdfium DLL (one-off ~50 ms per worker)
   - Creates SHM region `pdfium-worker-{N}` (64 MB)
   - Sets up stdin reader + stdout writer (Tokio async)
   - Writes `{"op":"ready",...}` line to stdout
3. Main waits for 4× ready (with 5 s timeout) before resolving pool init
4. If any worker fails to start within timeout: pool starts with N<4 workers,
   log warning, continue. App is still usable.

**Per-render flow:**
1. JS invokes `render_pdf_page` (existing Tauri command, unchanged from JS side)
2. `lib.rs` `render_pdf_page` checks if `WorkerPool` is ready:
   - If yes: forwards to `pool.render(...)` (async)
   - If no (still initializing or all workers dead): falls back to in-proc
     PDFium render (current code path)
3. `pool.render`:
   - Computes affinity worker → checks queue depth → picks final target
   - If target == 0 (main): call in-proc `pdfium_renderer::render_page_to_rgba`
   - Else: increment target's depth, write JSON request to its stdin, await
     ack line on stdout, mmap SHM, decrement depth, return bytes
4. Returns RGBA bytes to JS via `tauri::ipc::Response`

**Crash recovery:**
- Detected by EOF on worker stdout reader
- `WorkerState::status = Dead`
- In-flight request to that worker (one pending future) → fail with retry-able
  error; PoolRouter retries to a different worker
- Schedule respawn after 1 s delay
- Track crash count: 3× crashes within 30 s → `status = DeadPermanent`,
  log error, continue with remaining workers
- The app stays functional even with all 4 workers dead (main-process
  fallback)

**Shutdown:**
- App quit signal arrives at Tauri exit hook
- Main writes `{"op":"shutdown"}` to each worker's stdin
- Worker receives shutdown → cleans SHM, exits 0
- Main waits 2 s for clean exit; SIGKILLs hangers
- SHM regions cleaned by OS on process exit (Windows: file mapping closes,
  Unix: shm_unlink)

## Components (file structure)

| File | Type | Responsibility |
|------|------|---------------|
| `pdfium-worker/Cargo.toml` | NEW | Crate manifest. Deps: pdfium-render 0.9.1, memmap2 0.9, serde_json 1, tokio (rt + io). Built as `pdfium-worker.exe`. |
| `pdfium-worker/src/main.rs` | NEW | Worker entry. Loads PDFium, opens SHM, runs stdin/stdout loop dispatching `op` to handlers. |
| `pdfium-worker/src/handlers.rs` | NEW | Per-op handlers: `render`, `shutdown`. Returns `Result<Response, String>`. |
| `src-tauri/src/worker_pool.rs` | NEW | `PoolRouter` (affinity+overflow), `WorkerState` (subprocess handle, SHM, queue depth atomic), `init_pool()` called from Tauri setup. |
| `src-tauri/src/lib.rs` | MODIFY | `render_pdf_page` Tauri command: try pool first, fallback to in-proc on pool unavailability. Add `.manage(WorkerPool)` at builder. |
| `src-tauri/Cargo.toml` | MODIFY | Add workspace member `../pdfium-worker`, add memmap2 dep, add `[[bin]]` section if needed for sidecar bundling. |
| `src-tauri/tauri.conf.json` | MODIFY | Add `externalBin` to bundle pdfium-worker.exe with the app. |
| `mcp-server/multi-process-perf.mjs` | NEW | Probe: cold open NKD1a, time 7 sequential page nav, report per-page render time + total. Compare against v1.58.3 baseline. |

**Non-files** (no JS changes needed):
- JS continues to `invoke('render_pdf_page', ...)` unchanged
- bitmap-orchestrator, engine-router, page-bitmap-cache: zero changes
- The pool is transparent to JS

## Data Flow Walkthrough — NKD1a p4 cold render

1. User clicks page 4 thumbnail (after page 1 is already shown)
2. `renderer.js renderPage(4)` → analyze_page_type → 'tile' → activates raster
   viewport → `bitmap-orchestrator.ensureBitmapForCurrentView` fires
3. Orchestrator calls `page-bitmap-cache.ensureBitmap(..., bucket=0.25)` →
   `engine-router.renderPdfPage(...)` → `invoke('render_pdf_page', {...})`
4. Tauri main process receives the command → `lib.rs render_pdf_page`
   delegates to `WorkerPool::render(path="NKD1a.pdf", page=3, scale=0.25)`
5. PoolRouter computes `affinity = hash("NKD1a.pdf", 3) % 5 = 2` (worker #2)
6. Worker #2 queue depth = 0 ≤ 2 → use affinity
7. Increment worker #2 depth (now 1), write request JSON to stdin
8. Worker #2 reads request, calls `PdfDocument::render_page_to_rgba(...)` —
   ~1.5–2.7 s of PDFium CPU
9. Worker #2 writes RGBA bytes to its SHM region (offset 32 onwards)
10. Worker #2 writes ack: `{"id":42,"ok":true,"w":1289,"h":596,"shm_bytes":3072512}\n`
11. Main process reads ack line, mmaps worker #2's SHM, slices `[32..32+3072512]`,
    decrements depth
12. Main returns bytes to JS via `tauri::ipc::Response`
13. `page-bitmap-cache` creates ImageBitmap, viewport.currentBitmap set, RAF
    paints it

**Total wall clock for that one page** (with no contention):
- IPC overhead (JSON ser + write + read ack): ~2 ms
- PDFium render in worker: ~1500–2700 ms (same as in-proc)
- SHM read + ImageBitmap create: ~5 ms
- JS paint: ~30 ms
- **Total: ~1540–2740 ms** (single page, no parallelism win)

**Total wall clock for browsing 4 pages in succession (cold):**
- Current (single-proc): 4 × 1500 = 6000 ms sequential
- With pool: pages 2/3/4/5 route to workers 2/3/4/0 (via hash), all start
  immediately → ~1500 ms (bounded by slowest single render)
- **Speedup: ~4×** on multi-page cold browsing
- **Single-page cold time unchanged** (PDFium can't render one page in parallel)

## Error Handling

| Failure | Behaviour |
|---|---|
| Worker spawn timeout (>5 s for ready) | Pool starts with N<4, log warning, continue |
| Worker crash (EOF on stdout) | Mark dead, retry in-flight request on another worker, respawn after 1 s |
| 3 crashes in 30 s | Mark `DeadPermanent`, stop respawning, continue with N-1 |
| Worker timeout (>10 s without ack) | Force kill + respawn (same as crash) |
| SHM init failure (out of swap, etc.) | Worker exits, treated as spawn failure |
| Bitmap > 64 MB (extreme zoom on huge page) | Fall back to base64 inline ack — slow but correct |
| All workers dead | Fall back to in-proc PDFium for every render — slower but works |

The user-visible UX never sees a render failure unless the in-proc fallback
ALSO fails. The pool is a perf optimisation layered transparently underneath.

## Out of Scope

- **Worker render of `render_pdf_page_region`** (tile augment for high zoom).
  Region rendering stays single-process for v1.59.0. Tile-orch already caches
  aggressively so this rarely bottlenecks. Can route through pool in v1.59.1.
- **Worker render of `render_thumbnail`**. Thumbnail rendering is its own
  pipeline (left-panel.js → `render_thumbnail` Tauri command → JPEG-encoded
  response). Routing thumbnails through workers is a follow-up — needs JPEG
  encode/decode round-trip thinking.
- **Worker render of `extract_draw_commands`** (lopdf vector parsing). Not
  PDFium-bound, no win from multi-process.
- **Dynamic worker pool size** (e.g. spawn more under load). Fixed 4 for v1.59.
- **Cross-platform support beyond Windows.** memmap2 works on Linux/Mac too
  but we'll verify after Windows ships.
- **WASM workers in WebView.** Not pursued — separate process gives better
  crash isolation and avoids WebView memory pressure.

## Success Criteria

1. ✅ NKD1a per-page cold nav: 4 sequential page renders complete in
   ≤ 1800 ms total (vs ~6000 ms current). Single-page time unchanged.
2. ✅ Existing tests pass: `npm run test:render:auto` shows same pixel-diff
   distribution as before (workers must render identically to main proc).
3. ✅ Worker crash doesn't take down the app: kill `pdfium-worker.exe` mid-
   render, user observes the page renders ~1 s later (retry path) and
   subsequent renders work normally.
4. ✅ Cold app start with workers: +200 ms (4 × 50 ms PDFium DLL load,
   parallelised). Acceptable.
5. ✅ Memory: idle pool ≈ 4 × (50 MB PDFium runtime + 64 MB SHM) = 456 MB
   constant overhead. Under load, can grow with pixmap caches. Hard cap
   per-worker = 40 entries × (avg 5 MB) = 200 MB. Total worst case:
   ~456 + 4×200 = 1.3 GB. Acceptable for a desktop app on a workstation.

## Testing Plan

- Unit tests in `src-tauri/src/worker_pool.rs`: routing logic edge cases
  (all-empty, one-overflowed, dead workers, etc.).
- Integration test: spawn one worker programmatically, render NKD1a p4 via
  pool AND via in-proc, compare pixels — must be byte-identical.
- Stress test (`mcp-server/multi-process-perf.mjs`): cold-open NKD1a, fire
  app_go_to_page rapidly across all 7 pages, measure total time. Compare to
  v1.58.3 baseline.
- Crash test: external script kills pdfium-worker pid mid-render, verify
  app keeps working + retry succeeds.

## Migration

v1.58.x → v1.59.0:
- No user-facing config changes
- Engine selector behaviour unchanged (Rust-alpha still uses
  `render_pdf_page_skia`; pool only affects PDFium path)
- Settings page gets one new entry: "Render workers" (read-only count of
  alive workers, for diagnostics)

---

## Self-Review

- **Placeholders**: none.
- **Internal consistency**: architecture diagram + components table match
  walkthrough + error-handling table.
- **Scope check**: single implementation plan, all changes interdependent
  (can't ship part of multi-process). Bounded by the explicit "Out of scope"
  list.
- **Ambiguity check**: "Main process is worker_id 0 in the pool" — explicit.
  "Hybrid affinity+overflow with threshold 2" — explicit threshold.
- **Memory budget**: worst case 1.3 GB documented in Success Criteria.
