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
// (~10 per lange as, max ~80) i.p.v. honderden op een grote pagina. Laag genoeg
// dat óók de fit-zoom-accumulator (~500px) in ~4x3 tegels vult: dat spreidt het
// zware rasterwerk over alle workers én geeft zichtbare progressie.
const TILE_MIN_PX = 192;

/** Zwaar zodra de gecomprimeerde content-stream de drempel overschrijdt. */
export function isHeavyBytes(bytes) {
  return typeof bytes === 'number' && bytes > HEAVY_CONTENT_BYTES;
}

// Route A: pagina's waarvoor de display-list-scene niet werkt (image-zwaar,
// exotische features) vallen blijvend terug op het PDFium-pool-pad.
const _sceneBroken = new Set();

/**
 * Tegel-invoke met scene-first en per-pagina PDFium-fallback. De eigen
 * display-list-engine rastert tegels parallel uit één gecachete scene
 * (~140 MB op een 5M-ops blad) i.p.v. PDFium-parse-state van ~1,1 GB per
 * worker; zelfde wire-format ([w u32][h u32][rgba]) en dezelfde argumenten
 * als render_pdf_page_region.
 */
export async function invokeTileRegion(args) {
  const { invoke } = await import('../core/platform.js');
  const key = `${args.path}|${args.pageIndex}|${args.rotation || 0}`;
  const sceneWorthIt = (await pageContentBytes(args.path, args.pageIndex + 1)) > SCENE_CONTENT_BYTES;
  if (sceneWorthIt && !_sceneBroken.has(key)) {
    try {
      const res = await invoke('render_tile_scene_region', args);
      try {
        const { reportActiveEngine } = await import('../solid/stores/engineStatusStore.js');
        reportActiveEngine('scene');
      } catch {}
      return res;
    } catch (e) {
      _sceneBroken.add(key);
      console.log(`[prog] scene-fallback p${args.pageIndex + 1}: ${String(e).slice(0, 140)}`);
    }
  }
  const res = await invoke('render_pdf_page_region', { ...args, spread: false });
  try {
    const { reportActiveEngine } = await import('../solid/stores/engineStatusStore.js');
    reportActiveEngine('pdfium');
  } catch {}
  return res;
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

// Content-groottes met cache per (filePath,pageNum): de RUWE bytes, zodat
// zowel de prog-drempel (1 MB) als de engine-keuze (scene vanaf
// SCENE_CONTENT_BYTES) uit één goedkope meting komen. Onbekend/niet-Tauri => 0.
const _contentBytesCache = new Map();

async function pageContentBytes(filePath, pageNum) {
  if (!filePath) return 0;
  const key = `${filePath}:${pageNum}`;
  if (_contentBytesCache.has(key)) return _contentBytesCache.get(key);
  let bytes = 0;
  try {
    const { isTauri, invoke } = await import('../core/platform.js');
    if (isTauri()) {
      bytes = Number(await invoke('page_content_size', { path: filePath, pageIndex: pageNum - 1 })) || 0;
    }
  } catch {
    bytes = 0;
  }
  _contentBytesCache.set(key, bytes);
  return bytes;
}

/**
 * Is deze pagina "zwaar" genoeg voor het progressieve pad? Vraagt de
 * gecomprimeerde content-stream-lengte op via het Tauri-command
 * page_content_size (goedkoop, geen decompressie) en vergelijkt met de drempel.
 * Gecachet per (filePath,pageNum); buiten Tauri altijd false.
 */
export async function isHeavyPage(filePath, pageNum) {
  return isHeavyBytes(await pageContentBytes(filePath, pageNum));
}

// Engine-BELEID: PDFium is de basis-engine voor alles. De eigen engine
// (AEC-PDF v1, de parallelle tegel-scene) wordt uitsluitend ingezet waar
// performance dat afdwingt: extreme CAD-bladen in de MV-03-klasse (8,5 MB
// content → PDFium-parse 3-7 s en ~1,1 GB per worker; AEC-PDF v1 doet het
// volle blad in ~3 s met ~290 MB). Bewust hoog gelegd — AEC-PDF v1 wordt
// ondertussen doorontwikkeld tot volwaardige engine (clips, images, tekst-
// randgevallen) en de drempel zakt pas wanneer de corpus-benchmark
// (examples/corpus_diff.rs) dat per bladklasse aantoont.
const SCENE_CONTENT_BYTES = 6_000_000;

// Generatie-teller voor stale-guards: elke start bumpt hem; na elke await checken
// we of onze generatie nog actueel is voor we viewport-state muteren. Zo kan een
// tragere in-flight progressieve render nooit een nieuwere (zoom/pagina/tab) over-
// schrijven — analoog aan _bitmapGen in bitmap-orchestrator.js.
let _progGen = 0;

// In-flight-dedupe: renderPage vuurt tijdens één open meerdere keren (open,
// fit, her-render). Zonder dedupe herstart elke aanroep de progressieve run
// (verse witte accumulator overschrijft de bijna-volle!). Zelfde doelrun
// (pad+pagina+schaal+rotatie) → meteen terugkeren (aanroepers zijn
// fire-and-forget; de lopende run publiceert zelf).
let _inflightKey = null;

// Herstart-demper: tijdens openen/fit wisselt de zoom een paar keer kort
// achter elkaar en zou elke wissel een verse run starten, terwijl de al
// ingediende tegels van de vorige run nog op de (gepinde) worker in de rij
// staan — die stale tegels kosten seconden per stuk. Een vervangende run
// wacht daarom kort; komt er binnen die tijd wéér een nieuwe schaal, dan
// wint die en vervalt deze stilletjes.
let _restartToken = 0;
const RESTART_DEBOUNCE_MS = 300;

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

  // Render-schaal: zoom*dpr, HARD gecapt op 4096 px langste as. Belangrijk: we
  // gebruiken de GECAPTE schaal direct, niet via computeZoomBucket — dat rondt
  // naar boven af en zou de cap overschrijden (bv. 6740 px i.p.v. 4096 op MV-03),
  // wat bij herhaald createImageBitmap tot een geheugen-crash leidde. cacheBucket
  // is enkel de cache-sleutel.
  const dpr = window.devicePixelRatio || 1;
  const maxAxisPt = Math.max(viewport.pageW, viewport.pageH);
  if (maxAxisPt <= 0) return;
  const capScale = MAX_BITMAP_AXIS_PX / maxAxisPt;
  let renderScale = Math.min(viewport.zoom * dpr, capScale);
  const rotation = viewport.rotation || 0;
  // Leg pagina-identiteit vast: de render gebruikt deze locals, niet live
  // viewport-velden, zodat een tab-/paginawissel nooit de verkeerde pagina rendert.
  const filePath = viewport.filePath;
  const pageNum = viewport.pageNum;

  // Zelfde doelrun al bezig? Niet herstarten (zie _inflightKey).
  let runKey = `${filePath}:${pageNum}:${rotation}:${renderScale.toFixed(4)}`;
  if (_inflightKey === runKey) return;
  // Vervangt deze aanroep een LOPENDE run op een andere schaal? Even dempen
  // (zie _restartToken) zodat een fit-/zoomcascade één echte run oplevert.
  // Ná de demping gaan we door met de dán actuele schaal — de laatste
  // aanroep rendert dus altijd de eindstand.
  if (_inflightKey !== null) {
    const tok = ++_restartToken;
    await new Promise((r) => setTimeout(r, RESTART_DEBOUNCE_MS));
    if (tok !== _restartToken) return; // alweer vervangen door een nieuwere
    if (!viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum) return;
    renderScale = Math.min(viewport.zoom * dpr, capScale);
    runKey = `${filePath}:${pageNum}:${rotation}:${renderScale.toFixed(4)}`;
    if (_inflightKey === runKey) return; // lopende run is al de juiste
  }
  const cacheBucket = computeZoomBucket(renderScale);
  const myGen = ++_progGen;
  _inflightKey = runKey;

  // Al gerenderd op deze bucket? Meteen tonen en klaar.
  const exact = getCachedBitmap(filePath, pageNum, rotation, cacheBucket);
  if (exact && exact.bitmap) {
    viewport.currentBitmap = exact.bitmap;
    viewport.dirty = true;
    _inflightKey = null;
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
    // Seed met de beste beschikbare bitmap: tussenstanden zijn dan altijd
    // "oude weergave + nieuwe tegels" en kunnen nooit terugvallen naar wit.
    if (fallback && fallback.bitmap) {
      try { actx.drawImage(fallback.bitmap, 0, 0, fullW, fullH); } catch {}
    }
  } catch {
    _inflightKey = null;
    const e = await ensureBitmap(filePath, pageNum, rotation, cacheBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Tegelgrootte schaalt mee zodat het aantal region-renders HARD begrensd
  // blijft (~4 op de lange as → ~12 totaal). Belangrijk: op extreme vector-
  // pagina's betaalt élke tegel een flink deel van de display-list-walk, dus
  // meer tegels = meer totaaltijd. 6-12 tegels geeft zichtbare progressie én
  // een begrensde totaaltijd, op elke schaal.
  const tilePx = Math.max(TILE_MIN_PX, Math.ceil(Math.max(fullW, fullH) / 4));
  const tiles = computeTileGrid(fullW, fullH, tilePx);
  let failed = false;
  let lastPublish = 0;         // throttle tussentijdse publicaties
  let lastIntermediate = null; // vorige tussenstand-bitmap (sluiten na swap)
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  let tilesDone = 0;
  console.log(`[prog] start ${fullW}x${fullH}px, ${tiles.length} tegels (tile=${tilePx}px) p${pageNum}`);

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
      const res = await invokeTileRegion({
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
    tilesDone++;
    // Tussenstand publiceren: de EERSTE tegel direct (snelste eerste content),
    // daarna getthrottled zodat grote pagina's niet te veel volledige-canvas-
    // bitmaps maken.
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    if (tilesDone === 1) {
      console.log(`[prog] eerste tegel @${Math.round(now - t0)}ms`);
      lastPublish = now;
      await publish();
    } else if (now - lastPublish >= 300) {
      lastPublish = now;
      await publish();
    }
  };

  // De tegels gaan GEPIND naar één worker (die draagt als enige de dure
  // parse-state; zie routing.rs) en worden daar geserialiseerd door de
  // per-worker request-lock. CONC=2 houdt de pijplijn gevuld (er staat
  // altijd een volgende tegel klaar) zonder dat een gen-wissel veel al
  // ingediende — en dus niet meer te annuleren — stale tegels achterlaat.
  const CONC = 2; // zie routing: gepind → serieel op de warme worker
  let idx = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (idx < tiles.length && myGen === _progGen && !failed) {
      const t = tiles[idx++];
      await renderTile(t);
    }
  });
  await Promise.all(workers);
  if (myGen !== _progGen) { if (_inflightKey === runKey) _inflightKey = null; return; }

  if (failed) {
    // Terugval: één gewone whole-page render via de bestaande cache-weg.
    console.warn('[prog] tegel-fout — terugval naar whole-page render');
    if (_inflightKey === runKey) _inflightKey = null;
    const e = await ensureBitmap(filePath, pageNum, rotation, cacheBucket);
    if (myGen === _progGen && e && e.bitmap) { viewport.currentBitmap = e.bitmap; viewport.dirty = true; }
    return;
  }

  // Klaar: cache de volledige bitmap (zoom/pan/re-visit = cache-hit); sluit de
  // laatste tussenstand. De finalBmp blijft leven in de cache/viewport.
  const finalBmp = await createImageBitmap(acc);
  if (myGen !== _progGen) { try { finalBmp.close && finalBmp.close(); } catch {} if (_inflightKey === runKey) _inflightKey = null; return; }
  if (lastIntermediate) { try { lastIntermediate.close && lastIntermediate.close(); } catch {} }
  setCachedBitmapEntry(filePath, pageNum, rotation, cacheBucket, finalBmp, fullW, fullH, renderScale);
  viewport.currentBitmap = finalBmp;
  viewport.dirty = true;
  if (_inflightKey === runKey) _inflightKey = null;
  const tEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  console.log(`[prog] klaar @${Math.round(tEnd - t0)}ms (${tiles.length} tegels)`);

  // Thumbnail alsnog laten maken: die is voor zware pagina's uitgesteld
  // (zie left-panel renderThumbnailToDataURL) en knipt nu gratis uit de
  // zojuist gecachete whole-page-bitmap.
  try {
    const lp = await import('../ui/panels/left-panel.js');
    lp.invalidateThumbnail(pageNum);
  } catch { /* thumbnail is best-effort */ }

  // 300%-pre-cache: warm de zoom-tegels voor de huidige view alvast op zodat
  // gecentreerd inzoomen direct scherp is. Fire-and-forget; de pre-warm stopt
  // zelf bij tab-/paginawissel.
  try {
    const orch = await import('./bitmap-orchestrator.js');
    orch.prewarmZoomTiles(filePath, pageNum);
  } catch { /* pre-warm is best-effort */ }
}
