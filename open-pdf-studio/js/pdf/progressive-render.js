// progressive-render.js
//
// Progressieve whole-page render voor ZWARE raster-pagina's (bv. grote CAD-
// tekeningen): rendert de pagina in tegels via de bestaande
// render_pdf_page_region-worker-pool en blit elke tegel op een accumulator
// zodra hij binnen is, zodat de tekening zichtbaar invult i.p.v. een seconden-
// lang zwart scherm. Alleen bereikt via de aftakking in bitmap-orchestrator.js;
// niet-zware pagina's raken deze code nooit.
//
// De zware app-modules (pdf-viewport, platform, page-bitmap-cache) worden
// DYNAMISCH geïmporteerd binnen de async-functies. Daardoor heeft dit bestand
// geen top-level browser-afhankelijkheden en laadt het onder plain node, zodat
// de pure functies (isHeavyBytes, computeTileGrid) los unit-testbaar zijn.

// Zware-pagina drempel: gecomprimeerde content-stream > 1 MB. Gevalideerd door
// de all-PDF-test zodat geen normale pagina onterecht als zwaar telt.
const HEAVY_CONTENT_BYTES = 1_000_000;
// PDFium / browser canvas axis-limiet (zelfde cap als bitmap-orchestrator).
const MAX_BITMAP_AXIS_PX = 4096;
// Ondergrens tegelgrootte in output-pixels. De werkelijke tegelgrootte schaalt
// mee met de bitmap (zie orchestrator) zodat het aantal tegels ~begrensd blijft
// (~10 per lange as, max ~80) i.p.v. honderden op een grote pagina.
const TILE_MIN_PX = 384;

/** Zwaar zodra de gecomprimeerde content-stream de drempel overschrijdt. */
export function isHeavyBytes(bytes) {
  return typeof bytes === 'number' && bytes > HEAVY_CONTENT_BYTES;
}

/**
 * Verdeel een w×h pixel-vlak in tegels van ~tilePx (laatste kolom/rij = rest).
 * Retour: [{ px, py, pw, ph }] in output-pixels (boven→onder, links→rechts).
 * Aaneensluitend en zonder gaten: dekt exact [0,w) × [0,h).
 */
export function computeTileGrid(w, h, tilePx) {
  const tiles = [];
  for (let py = 0; py < h; py += tilePx) {
    const ph = Math.min(tilePx, h - py);
    for (let px = 0; px < w; px += tilePx) {
      const pw = Math.min(tilePx, w - px);
      tiles.push({ px, py, pw, ph });
    }
  }
  return tiles;
}

// Zwaarte-detectie met cache per (filePath,pageNum). Onbekend/niet-Tauri => false.
const _heavyCache = new Map();

/**
 * Is deze pagina "zwaar" genoeg voor het progressieve pad? Vraagt de
 * gecomprimeerde content-stream-lengte op via het Tauri-command
 * page_content_size (goedkoop, geen decompressie) en vergelijkt met de drempel.
 * Gecachet per (filePath,pageNum); buiten Tauri altijd false.
 */
export async function isHeavyPage(filePath, pageNum) {
  if (!filePath) return false;
  const key = `${filePath}:${pageNum}`;
  if (_heavyCache.has(key)) return _heavyCache.get(key);
  let heavy = false;
  try {
    const { isTauri, invoke } = await import('../core/platform.js');
    if (isTauri()) {
      const bytes = await invoke('page_content_size', { path: filePath, pageIndex: pageNum - 1 });
      heavy = isHeavyBytes(Number(bytes));
    }
  } catch {
    heavy = false;
  }
  _heavyCache.set(key, heavy);
  return heavy;
}

// Generatie-teller voor stale-guards: elke start bumpt hem; na elke await checken
// we of onze generatie nog actueel is voor we viewport-state muteren. Zo kan een
// tragere in-flight progressieve render nooit een nieuwere (zoom/pagina/tab) over-
// schrijven — analoog aan _bitmapGen in bitmap-orchestrator.js.
let _progGen = 0;

/**
 * Progressieve whole-page render voor de actieve ZWARE raster-pagina. Rendert de
 * pagina tegel-voor-tegel via render_pdf_page_region (worker-pool) en publiceert
 * tussentijds een bijgewerkte viewport.currentBitmap zodat de tekening zichtbaar
 * invult. Het eind-composiet is pixel-equivalent aan de gewone whole-page render
 * (zelfde bucket + aaneensluitende regio's) en wordt in de page-bitmap-cache
 * gezet zodat zoom/pan/re-visit cache-hits blijven. Bij een tegel-fout valt hij
 * terug op één gewone render_pdf_page.
 */
export async function ensureProgressiveBitmapForCurrentView() {
  const { viewport } = await import('./pdf-viewport.js');
  const { invoke } = await import('../core/platform.js');
  const { computeZoomBucket, getBestAvailableBitmap, getCachedBitmap, setCachedBitmapEntry, ensureBitmap } =
    await import('./page-bitmap-cache.js');

  if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') return;
  const myGen = ++_progGen;

  // Render-schaal: zoom*dpr, HARD gecapt op 4096 px langste as. Belangrijk: we
  // gebruiken de GECAPTE schaal direct, niet via computeZoomBucket — dat rondt
  // naar boven af en zou de cap overschrijden (bv. 6740 px i.p.v. 4096 op MV-03),
  // wat bij herhaald createImageBitmap tot een geheugen-crash leidde. cacheBucket
  // is enkel de cache-sleutel.
  const dpr = window.devicePixelRatio || 1;
  const targetScale = viewport.zoom * dpr;
  const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
  if (maxAxisPt <= 0) return;
  const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
  const renderScale = Math.min(targetScale, capScale);
  const cacheBucket = computeZoomBucket(renderScale);
  const rotation = viewport.rotation || 0;
  // Leg pagina-identiteit vast: de render gebruikt deze locals, niet live
  // viewport-velden, zodat een tab-/paginawissel nooit de verkeerde pagina rendert.
  const filePath = viewport.filePath;
  const pageNum = viewport.pageNum;

  // Al gerenderd op deze bucket? Meteen tonen en klaar.
  const exact = getCachedBitmap(filePath, pageNum, rotation, cacheBucket);
  if (exact && exact.bitmap) {
    viewport.currentBitmap = exact.bitmap;
    viewport.dirty = true;
    return;
  }
  // Anders: toon vast de best beschikbare (lagere bucket) terwijl we renderen.
  const fallback = getBestAvailableBitmap(filePath, pageNum, rotation, cacheBucket);
  if (fallback && fallback.bitmap) {
    viewport.currentBitmap = fallback.bitmap;
    viewport.dirty = true;
  }

  // Volledige bitmapmaat (≤ 4096 px per as door de cap hierboven).
  const fullW = Math.max(1, Math.round(viewport.pageW * renderScale));
  const fullH = Math.max(1, Math.round(viewport.pageH * renderScale));

  // Accumulator-canvas. Zonder OffscreenCanvas-ondersteuning: gewone render.
  let acc, actx;
  try {
    acc = new OffscreenCanvas(fullW, fullH);
    actx = acc.getContext('2d');
    actx.fillStyle = '#ffffff';
    actx.fillRect(0, 0, fullW, fullH);
  } catch {
    const e = await ensureBitmap(filePath, pageNum, rotation, cacheBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Tegelgrootte schaalt mee zodat het aantal region-renders begrensd blijft
  // (~10 tegels op de lange as → ~80 max), ongeacht paginagrootte.
  const tilePx = Math.max(TILE_MIN_PX, Math.ceil(Math.max(fullW, fullH) / 10));
  const tiles = computeTileGrid(fullW, fullH, tilePx);
  let failed = false;
  let lastPublish = 0;         // throttle tussentijdse publicaties
  let lastIntermediate = null; // vorige tussenstand-bitmap (sluiten na swap)

  // Publiceer de accumulator als viewport-bitmap; sluit de vorige tussenstand
  // meteen na de swap zodat het geheugen begrensd blijft (elke ImageBitmap is
  // ~fullW*fullH*4 bytes; zonder sluiten stapelt dat op tot een OOM-crash). Veilig:
  // JS is single-threaded, dus geen RAF-frame tekent de oude bitmap na de swap.
  const publish = async () => {
    const bmp = await createImageBitmap(acc);
    if (myGen !== _progGen) { try { bmp.close && bmp.close(); } catch {} return; }
    viewport.currentBitmap = bmp;
    viewport.dirty = true;
    if (lastIntermediate) { try { lastIntermediate.close && lastIntermediate.close(); } catch {} }
    lastIntermediate = bmp;
  };

  const renderTile = async (t) => {
    if (myGen !== _progGen || failed) return;
    // output-pixel-tegel -> PDF-punt-regio (scale = renderScale => tegel = t.pw×t.ph px)
    const regionXPt = t.px / renderScale;
    const regionYPt = t.py / renderScale;
    const regionWPt = t.pw / renderScale;
    const regionHPt = t.ph / renderScale;
    let bytes;
    try {
      const res = await invoke('render_pdf_page_region', {
        path: filePath, pageIndex: pageNum - 1,
        scale: renderScale, rotation,
        regionXPt, regionYPt, regionWPt, regionHPt,
      });
      bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
    } catch { failed = true; return; }
    if (myGen !== _progGen) return;
    if (!bytes || bytes.length <= 8) return;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const w = dv.getUint32(0, true);
    const h = dv.getUint32(4, true);
    if (w * h * 4 !== bytes.length - 8) return;
    const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4);
    actx.putImageData(new ImageData(rgba, w, h), t.px, t.py);
    // Tussenstand publiceren, getthrottled zodat grote pagina's niet te veel
    // volledige-canvas-bitmaps maken.
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (now - lastPublish >= 300) {
      lastPublish = now;
      await publish();
    }
  };

  // Serieel (CONC=1). render_pdf_page_region is een SYNCHROON Tauri-command dat op
  // het hoofdthread draait; parallelle in-proc PDFium-renders van hetzelfde document
  // lieten het Rust-proces crashen (de worker-pool gebruikt aparte processen juist
  // daarom). Serieel is stabiel maar bezet het hoofdthread tijdens de render — reden
  // waarom dit pad EXPERIMENTEEL + standaard uitgeschakeld is. Robuuste versie:
  // regio-rendering via de multi-proces worker-pool, zoals hele pagina's.
  const CONC = 1;
  let idx = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (idx < tiles.length && myGen === _progGen && !failed) {
      const t = tiles[idx++];
      await renderTile(t);
    }
  });
  await Promise.all(workers);
  if (myGen !== _progGen) return;

  if (failed) {
    // Terugval: één gewone whole-page render via de bestaande cache-weg.
    const e = await ensureBitmap(filePath, pageNum, rotation, cacheBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Klaar: cache de volledige bitmap (zoom/pan/re-visit = cache-hit); sluit de
  // laatste tussenstand. De finalBmp blijft leven in de cache/viewport.
  const finalBmp = await createImageBitmap(acc);
  if (myGen !== _progGen) { try { finalBmp.close && finalBmp.close(); } catch {} return; }
  if (lastIntermediate) { try { lastIntermediate.close && lastIntermediate.close(); } catch {} }
  setCachedBitmapEntry(filePath, pageNum, rotation, cacheBucket, finalBmp, fullW, fullH, renderScale);
  viewport.currentBitmap = finalBmp;
  viewport.dirty = true;
}
