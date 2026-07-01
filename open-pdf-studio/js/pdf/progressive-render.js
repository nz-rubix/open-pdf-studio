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
// Tegel-doelgrootte in output-pixels.
const TILE_PX = 256;

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
  const { computeZoomBucket, getBestAvailableBitmap, setCachedBitmapEntry, ensureBitmap } =
    await import('./page-bitmap-cache.js');

  if (!viewport.active || !viewport.filePath || viewport.pageType !== 'raster') return;
  const myGen = ++_progGen;

  // Doelbucket identiek aan bitmap-orchestrator: zoom*dpr, gecapt op 4096 px-as.
  const dpr = window.devicePixelRatio || 1;
  const targetScale = viewport.zoom * dpr;
  const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
  if (maxAxisPt <= 0) return;
  const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
  const useBucket = computeZoomBucket(Math.min(targetScale, capScale));
  const rotation = viewport.rotation || 0;
  // Leg pagina-identiteit vast: de rest van de render gebruikt deze locals, niet
  // live viewport-velden, zodat een tab-/paginawissel midden in de render nooit
  // een verkeerde pagina rendert of cachet (de myGen-guard stopt het publiceren).
  const filePath = viewport.filePath;
  const pageNum = viewport.pageNum;

  // Cache-hit? Meteen tonen. Is het de EXACTE bucket, dan is er niets te doen.
  const cached = getBestAvailableBitmap(filePath, pageNum, rotation, useBucket);
  if (cached && cached.bitmap) {
    viewport.currentBitmap = cached.bitmap;
    viewport.dirty = true;
    if (Math.abs((cached.scale || 0) - useBucket) < 1e-6) return;
  }

  // Volledige bitmapmaat op deze bucket (pixel-equivalent aan ensureBitmap).
  const fullW = Math.max(1, Math.round(viewport.pageW * useBucket));
  const fullH = Math.max(1, Math.round(viewport.pageH * useBucket));

  // Accumulator-canvas. Zonder OffscreenCanvas-ondersteuning: gewone render.
  let acc, actx;
  try {
    acc = new OffscreenCanvas(fullW, fullH);
    actx = acc.getContext('2d');
    actx.fillStyle = '#ffffff';
    actx.fillRect(0, 0, fullW, fullH);
  } catch {
    const e = await ensureBitmap(filePath, pageNum, rotation, useBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  const tiles = computeTileGrid(fullW, fullH, TILE_PX);
  let failed = false;
  let lastPublish = 0; // throttle tussentijdse publicaties (~10 fps)

  const publish = async () => {
    const bmp = await createImageBitmap(acc);
    if (myGen !== _progGen) { try { bmp.close && bmp.close(); } catch {} return null; }
    viewport.currentBitmap = bmp;
    viewport.dirty = true;
    return bmp;
  };

  const renderTile = async (t) => {
    if (myGen !== _progGen || failed) return;
    // output-pixel-tegel -> PDF-punt-regio (scale = useBucket => tegel = t.pw×t.ph px)
    const regionXPt = t.px / useBucket;
    const regionYPt = t.py / useBucket;
    const regionWPt = t.pw / useBucket;
    const regionHPt = t.ph / useBucket;
    let bytes;
    try {
      const res = await invoke('render_pdf_page_region', {
        path: filePath, pageIndex: pageNum - 1,
        scale: useBucket, rotation,
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
    // Tussenstand publiceren, getthrottled zodat grote pagina's niet honderden
    // volledige-canvas-bitmaps maken.
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (now - lastPublish >= 100) {
      lastPublish = now;
      await publish();
    }
  };

  // Beperkte gelijktijdigheid (worker-pool = 4). Wave-runner over de tegels.
  const CONC = 4;
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
    const e = await ensureBitmap(filePath, pageNum, rotation, useBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Klaar: publiceer + cache de volledige bitmap (zoom/pan/re-visit = cache-hit).
  const finalBmp = await createImageBitmap(acc);
  if (myGen !== _progGen) { try { finalBmp.close && finalBmp.close(); } catch {} return; }
  setCachedBitmapEntry(filePath, pageNum, rotation, useBucket, finalBmp, fullW, fullH, useBucket);
  viewport.currentBitmap = finalBmp;
  viewport.dirty = true;
}
