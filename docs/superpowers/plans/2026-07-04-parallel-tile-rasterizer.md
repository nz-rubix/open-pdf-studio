# Route A — Parse-once + parallelle tile-rasterizer (zware vectorbladen)

**Doel:** megagrote vectorbladen (MV-03-klasse: ~5M path-ops) volledig renderen in ≤3 s met ≤600 MB piek, door PDFium alleen als (fallback-)parser te gebruiken en tegels parallel te rasteren over een onveranderlijke display-list — het MuPDF/Ghostscript-patroon.

**Besluitgrond (2026-07-04):** deep-research (14 geverifieerde claims) + eigen lab. Kern:
- PDFium is per maintainer-uitspraak niet thread-safe, ook niet voor verschillende documenten; officieel gesanctioneerd is serialisatie of processen (ons huidige model).
- Eigen experiment: 1 PDFium-instantie op 2 threads = crash; 2 hernoemde DLL-instanties = 1,9× sneller maar N×1,1 GB geheugen — snelheid zonder geheugenwinst.
- De thread-unsafety zit aantoonbaar in gedeelde font-/glyph-caches + PartitionAlloc-free-pad → renderen is nooit read-only in PDFium.

## Fase-0-metingen (release, MV-03 p1, zelfde machine)

| Meting | PDFium (worker) | open-pdf-render (onze pijplijn) |
|---|---|---|
| parse | 3-5 s (~1,1 GB parse-state) | lopdf-load 5 ms (lazy); echte parse zit in extract |
| display-list-extractie | n.v.t. | **25,4 s → buffer 138,4 MB** |
| volledige render @0.3 | 11,6 s | 21,2 s (single-thread tiny-skia) |
| piek-RSS proces | ~1,3 GB | **8,1 GB (!)** |

Lezing: het display-list-FORMAAT (138 MB, 8× kleiner dan PDFium-parse-state) valideert het geheugen-einddoel; de extractie-tijd, raster-tijd en vooral de 8,1 GB tussentijdse RSS zijn de te slopen bottlenecks — allemaal eigen code.

## Fasen

### Fase 1 — geheugen & extractie saneren (go/no-go: extractie ≤8 s, RSS ≤1,5 GB)
1. Profileer extract_draw_commands op MV-03 (waar zit 8 GB: tussenbuffers? per-op-allocaties? pixmap-caches?).
2. Streamende extractie: schrijf ops direct het compacte buffer-formaat in (geen tussen-Vec's), hergebruik path-buffers, geen image-decode tijdens extractie (verwijzingen + lazy decode).
3. Disk-cache van de display-list per (path, page, mtime) — tweede keer openen = mmap/lees 138 MB i.p.v. opnieuw 25 s.

### Fase 2 — parallelle tile-raster (go/no-go: volledige render ≤3 s op 8+ cores, pixel-diff ≤2% vs PDFium)
1. Ruimtelijke index over de display-list (bbox per op → grid/R-boom) zodat een tegel alleen zijn ops replayt.
2. rayon-tegelrunner: N threads × eigen tiny-skia-Pixmap over de gedeelde read-only lijst (rayon is al dependency).
3. Pixel-diff-verificatie tegen PDFium-referentie over de bestaande regressie-corpus + alle 15 voorbeeld-PDF's.

### Fase 3 — integratie als zwaar-blad-pad
1. Router in de bestaande progressieve flow: zwaar blad → display-list-pad; tegel met niet-ondersteunde features (exotische shadings/transparantiegroepen/fonts) → bestaand PDFium-worker-pad. Kan dus nooit slechter worden dan nu.
2. Idle-gedrag: display-list vervangt de open PDFium-page-handle → workers kunnen direct trimmen na extractie (structurele geheugenwinst óók in steady state).

### Fase 4 (later) — GPU
Vello/wgpu of skia-safe als de CPU-plafonds bereikt zijn; zie specs/2026-05-11-gpu-rendering-engine-design.md en plans/2026-05-11-skia-native-renderer.md (Renderer-trait daaruit hergebruiken).

## Meetinstrumenten
- `open-pdf-render/examples/mv03_probe.rs` — parse/extract/render-timing + buffergrootte (fase-0-baseline).
- `scratchpad dual-pdfium-probe` (buiten repo) — PDFium-concurrency-referentie: serieel 31,5 s / dual-DLL 16,5 s / single-instance-2-threads crash.
- Rig-meting `mcp-server/measure-spread.mjs` — end-to-end open-tijden + worker-RSS.

## Afgewezen routes (met reden, zie onderzoek)
- **PDFium-fork thread-safe maken**: maintainer acht het "doable", exacte plekken bekend (CFX_FaceCache/CFX_FontCache, PartitionAlloc), maar onbewezen, 6-12+ weken, permanent merge-onderhoud, en geheugen blijft ~1,1 GB (> doel).
- **Multi-DLL-instanties in-proces**: bewezen (1,9×, productie-precedent FoundationDB) maar geheugen N×1,1 GB en crash-isolatie weg; hooguit later nuttig als los lapmiddel.
- **PDFium incremental API's (Start/Continue)**: alleen responsiviteit, geen parallellisme; Chrome-detailclaims konden niet geverifieerd worden (spend-limit) — optioneel klein vervolgonderzoek.
