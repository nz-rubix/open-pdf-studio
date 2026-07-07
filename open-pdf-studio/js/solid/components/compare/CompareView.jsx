import { createEffect, createMemo, createSignal, onCleanup, onMount, For, Show } from 'solid-js';
import {
  compareActive,
  compareOldPath,
  compareNewPath,
  compareMode,
  compareOldPage,
  compareNewPage,
  compareOffset,
  compareZoom,
  compareChanges,
  compareFocusedChange,
  compareShowAdded,
  compareShowRemoved,
  compareShowModified,
  compareFitRequest,
  setCompareShowAdded,
  setCompareShowRemoved,
  setCompareShowModified,
  setFocusedChange,
  exitCompare,
  nextPagePair,
  prevPagePair,
  setCompareZoom,
  setCompareOffset,
  requestCompareFit,
  requestCompareReset,
} from '../../../compare/compare-store.js';
import {
  renderCompareSideBySide,
  renderCompareOverlay,
  paintHighlights,
  clearCompareDocCache,
} from '../../../compare/compare-viewport.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { diffAnnotationsForPair } from '../../../compare/compare-annotations.js';

export default function CompareView() {
  const { t } = useTranslation('ribbon');
  let oldCanvasRef;
  let newCanvasRef;
  let oldHiCanvasRef;   // side-by-side: diff overlay on OLD page
  let newHiCanvasRef;   // side-by-side: diff overlay on NEW page
  let overlayNewCanvasRef;
  let overlayHighlightCanvasRef;
  let bodyRef;
  let overlayWrapRef;
  // Side-by-side: elk document in een EIGEN scroll-paneel, met gespiegelde
  // scrollpositie — zo toont links en rechts altijd dezelfde plek, ook diep
  // ingezoomd (één gedeelde scroller schoof het andere document uit beeld).
  let oldPaneRef;
  let newPaneRef;
  let oldWrapRef;  // scaled wrapper holding OLD page + its diff overlay
  let newWrapRef;  // scaled wrapper holding NEW page + its diff overlay
  let _scrollSyncing = false;
  // Spiegel de scrollpositie proportioneel: de twee pagina's kunnen
  // verschillende afmetingen hebben, dus een absolute pixel-kopie zou
  // uiteenlopen. We rekenen met de fractie van de scrollbare ruimte zodat
  // "midden van links" ook "midden van rechts" toont.
  const syncScroll = (src, dst) => {
    if (_scrollSyncing || !src || !dst) return;
    _scrollSyncing = true;
    const sx = src.scrollWidth - src.clientWidth;
    const sy = src.scrollHeight - src.clientHeight;
    const dx = dst.scrollWidth - dst.clientWidth;
    const dy = dst.scrollHeight - dst.clientHeight;
    dst.scrollLeft = sx > 0 ? (src.scrollLeft / sx) * dx : src.scrollLeft;
    dst.scrollTop = sy > 0 ? (src.scrollTop / sy) * dy : src.scrollTop;
    requestAnimationFrame(() => { _scrollSyncing = false; });
  };
  // Pannen door slepen in een paneel; de scroll-sync spiegelt de beweging
  // automatisch naar het andere paneel. Pointer-capture zorgt dat snelle
  // sleepbewegingen buiten het element niet verloren gaan.
  const startPanDrag = (e, pane) => {
    // Left button or middle button drags to pan.
    if (!pane || (e.button !== 0 && e.button !== 1)) return;
    const rect = pane.getBoundingClientRect();
    // Klik op de scrollbalk zelf niet kapen.
    if (e.clientX - rect.left > pane.clientWidth || e.clientY - rect.top > pane.clientHeight) return;
    e.preventDefault();
    try { pane.setPointerCapture?.(e.pointerId); } catch {}
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev) => {
      pane.scrollLeft -= ev.clientX - lastX;
      pane.scrollTop -= ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const up = () => {
      try { pane.releasePointerCapture?.(e.pointerId); } catch {}
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [highlight, setHighlight] = createSignal(null); // {x,y,w,h} flash highlight
  let highlightTimer = null;

  // Instant CSS-transform preview while zooming. The bitmap stays at the
  // last hi-quality render scale; we visually scale the wrapper so the user
  // sees an immediate response. After a short debounce we trigger a true
  // re-render at the new scale and reset cssScale back to 1.
  const [cssScale, setCssScale] = createSignal(1);
  // The compareZoom value at which the current bitmap was rendered.
  let renderedZoom = compareZoom();
  let zoomDebounceTimer = null;
  const ZOOM_DEBOUNCE_MS = 150;
  // Set true when a zoom already re-anchored the scroll position itself (e.g.
  // cursor-anchored wheel, center-anchored +/− buttons). In that case the
  // post-render f-multiply must be skipped: the scroll is already expressed in
  // final visual terms, and the bitmap swap keeps the same visual size, so
  // re-scaling the scroll would double-apply the zoom factor and drift.
  let _scrollAlreadyAnchored = false;

  const visibleTypes = () => ({
    added: compareShowAdded(),
    removed: compareShowRemoved(),
    modified: compareShowModified(),
  });

  // Detection-px -> bitmap-px ratio. Maps a change bbox (measured in the fixed
  // detection raster) onto the CURRENTLY RENDERED bitmap. We use renderedZoom,
  // not the live zoom, because the highlight canvas is sized to the bitmap and
  // rides the same CSS `scale(cssScale)` wrapper as the page canvas — so any
  // in-progress zoom preview is applied once, by the wrapper, to both.
  const highlightRatio = () => {
    const visualScale = 1.5 * renderedZoom;
    const list = compareChanges();
    const detectScale = list[0]?.detectScale || visualScale;
    return visualScale / detectScale;
  };

  // Structurele annotatie-verschillen — los van de pixel-diff van de PDF-inhoud.
  // De app-annotaties zitten in een aparte overlay (doc.annotations), niet in
  // het gerenderde PDF-raster, dus de pixel-diff ziet ze niet. Reactief op het
  // pagina-paar én op de annotaties van beide documenten.
  const annotationChanges = createMemo(() =>
    compareActive()
      ? diffAnnotationsForPair(compareOldPath(), compareOldPage(), compareNewPath(), compareNewPage())
      : []
  );
  // Gecombineerde lijst voor het wijzigingen-paneel: PDF-inhoud + annotaties.
  const allChanges = createMemo(() => [...(compareChanges() || []), ...annotationChanges()]);
  // Navigatie/flash-ratio: annotatie-records staan in pagina-coördinaten
  // (× visualScale), inhouds-records in detectie-px (× highlightRatio).
  const changeRatio = (c) => (c && c.source === 'annotation') ? (1.5 * renderedZoom) : highlightRatio();

  // Paint one highlight canvas restricted to a subset of change types. Used by
  // both modes: overlay shows all three; side-by-side shows removed+modified on
  // OLD and added+modified on NEW so each edit lands on the page it belongs to.
  const paintPaneHighlights = (canvas, allow) => {
    if (!canvas) return;
    const v = visibleTypes();
    const sel = compareFocusedChange();
    // Only draw the selection accent on a pane that shows the selected type,
    // so a "removed" selection doesn't get a border on the NEW pane.
    const selForPane = sel && allow[sel.type] && v[sel.type] ? sel : null;
    paintHighlights(canvas, compareChanges(), {
      ratio: highlightRatio(),
      visibleTypes: {
        added: !!v.added && !!allow.added,
        removed: !!v.removed && !!allow.removed,
        modified: !!v.modified && !!allow.modified,
      },
      selected: selForPane,
    });
  };

  // Keep every highlight canvas the same pixel size as its page canvas, then
  // repaint. Runs after a render and whenever the change list/toggles change.
  const repaintHighlights = () => {
    if (compareMode() === 'overlay') {
      if (!overlayHighlightCanvasRef || !overlayNewCanvasRef) return;
      overlayHighlightCanvasRef.width = overlayNewCanvasRef.width;
      overlayHighlightCanvasRef.height = overlayNewCanvasRef.height;
      paintPaneHighlights(overlayHighlightCanvasRef, { added: true, removed: true, modified: true });
    } else {
      if (oldHiCanvasRef && oldCanvasRef) {
        oldHiCanvasRef.width = oldCanvasRef.width;
        oldHiCanvasRef.height = oldCanvasRef.height;
        paintPaneHighlights(oldHiCanvasRef, { added: false, removed: true, modified: true });
      }
      if (newHiCanvasRef && newCanvasRef) {
        newHiCanvasRef.width = newCanvasRef.width;
        newHiCanvasRef.height = newCanvasRef.height;
        paintPaneHighlights(newHiCanvasRef, { added: true, removed: false, modified: true });
      }
    }
  };

  // Scroll a single pane so the change's centre lands in the middle of the
  // viewport. Shared by overlay (bodyRef) and side-by-side (both panes).
  const scrollPaneToChange = (pane, wrap, c, smooth = true) => {
    if (!pane || !wrap) return;
    // highlightRatio() maps to bitmap-px; the wrapper's CSS scale turns that
    // into on-screen (content) px, so fold cssScale in to hit the right spot
    // even if a zoom preview is still in flight.
    const ratio = changeRatio(c) * cssScale();
    const cx = wrap.offsetLeft + (c.x + c.width / 2) * ratio;
    const cy = wrap.offsetTop + (c.y + c.height / 2) * ratio;
    pane.scrollTo({
      left: Math.max(0, cx - pane.clientWidth / 2),
      top: Math.max(0, cy - pane.clientHeight / 2),
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  const focusOnChange = (c) => {
    // Toggle selection if same record clicked again.
    const cur = compareFocusedChange();
    if (cur === c) {
      setFocusedChange(null);
      repaintHighlights();
      return;
    }
    setFocusedChange(c);

    if (compareMode() === 'overlay') {
      if (bodyRef && overlayWrapRef) {
        scrollPaneToChange(bodyRef, overlayWrapRef, c);
        const ratio = changeRatio(c);
        setHighlight({ x: c.x * ratio, y: c.y * ratio, w: c.width * ratio, h: c.height * ratio });
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => setHighlight(null), 1000);
      }
    } else {
      // Side-by-side: scroll BOTH panes to the same spot. Guard the sync so
      // the two programmatic scrolls don't fight each other.
      _scrollSyncing = true;
      scrollPaneToChange(oldPaneRef, oldWrapRef, c);
      scrollPaneToChange(newPaneRef, newWrapRef, c);
      requestAnimationFrame(() => { _scrollSyncing = false; });
    }
    repaintHighlights();
  };

  let busy = false;
  let pending = false;
  // When set, the next doRender() will skip change detection. Used by zoom-
  // only re-renders since detection bboxes are computed in a fixed
  // detection-px space and are independent of the display scale.
  let pendingSkipDetection = false;

  const doRender = async (opts2 = {}) => {
    if (busy) {
      pending = true;
      // Keep skip flag sticky-true so zoom-only renders never trigger
      // detection, but if any non-zoom render is requested while busy, clear
      // it so detection runs once after the busy render.
      if (!opts2.skipDetection) pendingSkipDetection = false;
      return;
    }
    busy = true;
    const skipDetection = !!opts2.skipDetection || pendingSkipDetection;
    pendingSkipDetection = false;
    const zoomAtRender = compareZoom();
    try {
      const opts = {
        oldPath: compareOldPath(),
        newPath: compareNewPath(),
        oldPage: compareOldPage(),
        newPage: compareNewPage(),
        scale: 1.5 * zoomAtRender,
        offset: compareOffset(),
        skipDetection,
      };
      if (!opts.oldPath || !opts.newPath) return;
      if (compareMode() === 'overlay') {
        if (overlayNewCanvasRef && overlayHighlightCanvasRef) {
          await renderCompareOverlay(
            null,
            overlayNewCanvasRef,
            opts,
            overlayHighlightCanvasRef,
          );
          repaintHighlights();
        }
      } else {
        if (oldCanvasRef && newCanvasRef) {
          await renderCompareSideBySide(oldCanvasRef, newCanvasRef, opts);
          repaintHighlights();
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[compare] render failed', err);
    } finally {
      busy = false;
      // The freshly painted bitmap matches zoomAtRender. Reset CSS preview
      // so what the user sees is the crisp HQ bitmap (not a CSS-stretched
      // copy). We also remember the zoom so further wheel events can compute
      // a fresh CSS-only delta from this baseline.
      const prevZoom = renderedZoom;
      renderedZoom = zoomAtRender;
      // Zoom-anker: de content is een factor f groter/kleiner geworden —
      // schaal de scrollposities mee zodat beide panelen (en de overlay)
      // dezelfde plek blijven tonen i.p.v. naar linksboven te driften.
      // Dit vertaalt de scrollpositie uit de CSS-preview-ruimte (bitmap nog op
      // de oude schaal) naar de nieuwe native-bitmap-ruimte. Bij cursor-zoom
      // is de scroll al op het cursor-punt gezet in preview-ruimte; deze factor
      // houdt datzelfde punt vast wanneer de scherpe bitmap de preview vervangt.
      const f = prevZoom > 0 ? zoomAtRender / prevZoom : 1;
      if (_scrollAlreadyAnchored) {
        // Scroll was pre-set to hold a specific anchor; the visual size is
        // unchanged by the bitmap swap, so leave scroll untouched.
        _scrollAlreadyAnchored = false;
      } else if (Math.abs(f - 1) > 1e-4) {
        _scrollSyncing = true;
        for (const pane of [oldPaneRef, newPaneRef, bodyRef]) {
          if (!pane) continue;
          pane.scrollLeft *= f;
          pane.scrollTop *= f;
        }
        requestAnimationFrame(() => { _scrollSyncing = false; });
      }
      // If the user kept zooming during render, recompute cssScale relative
      // to the new baseline so the preview stays consistent.
      const cur = compareZoom();
      setCssScale(cur === renderedZoom ? 1 : cur / renderedZoom);
      // Repaint highlights at the crisp scale (ratio changed with the bitmap).
      repaintHighlights();
      if (pending) {
        pending = false;
        doRender();
      }
    }
  };

  const scheduleHQRender = () => {
    if (zoomDebounceTimer) clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(() => {
      zoomDebounceTimer = null;
      // Zoom-only re-render: skip change detection entirely. Bbox results
      // are in detection-pixel space and don't change with display scale.
      doRender({ skipDetection: true });
    }, ZOOM_DEBOUNCE_MS);
  };

  // Non-zoom deps trigger an immediate HQ render. Zoom is handled in a
  // separate effect below with debouncing + CSS-transform preview.
  createEffect(() => {
    compareOldPath();
    compareNewPath();
    compareMode();
    compareOldPage();
    compareNewPage();
    compareOffset();
    if (compareActive()) {
      // Reset CSS preview state — after a path/page/mode change the bitmap
      // baseline is whatever the next render produces.
      setCssScale(1);
      if (zoomDebounceTimer) {
        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = null;
      }
      queueMicrotask(doRender);
    }
  });

  // Zoom: instant CSS preview + debounced HQ re-render.
  createEffect(() => {
    const z = compareZoom();
    if (!compareActive()) return;
    // Visual scale relative to whatever the bitmap was last rendered at.
    if (renderedZoom > 0) {
      setCssScale(z / renderedZoom);
    }
    scheduleHQRender();
  });

  // Repaint highlight overlay when the changes list, visibility toggles, or
  // selection change — without re-running the full PDF render. Runs in BOTH
  // modes now (side-by-side paints per pane, overlay paints one canvas).
  createEffect(() => {
    compareChanges();
    compareShowAdded();
    compareShowRemoved();
    compareShowModified();
    compareFocusedChange();
    compareMode();
    if (compareActive()) {
      queueMicrotask(repaintHighlights);
    }
  });

  // Fit / reset requests from the toolbar. Compute a zoom that makes the NEW
  // page fill the available viewport (fit) or snap to 100% (reset).
  createEffect(() => {
    const req = compareFitRequest();
    if (!req.kind || !compareActive()) return;
    // Reset scroll to the top-left so the (re)fitted page is fully framed
    // rather than left scrolled where the previous zoom sat. Flag the upcoming
    // render to keep this scroll instead of scaling the old one.
    const resetScroll = () => {
      _scrollAlreadyAnchored = true;
      _scrollSyncing = true;
      for (const p of [oldPaneRef, newPaneRef, bodyRef]) { if (p) { p.scrollLeft = 0; p.scrollTop = 0; } }
      requestAnimationFrame(() => { _scrollSyncing = false; });
    };
    if (req.kind === 'reset') {
      setCompareZoom(1);
      resetScroll();
      return;
    }
    // Fit: the rendered bitmap is (natural * 1.5 * renderedZoom) px. Work out
    // the natural (scale-1.5) size, then pick a zoom so it fits the pane.
    queueMicrotask(() => {
      const baseCanvas = compareMode() === 'overlay' ? overlayNewCanvasRef : newCanvasRef;
      const pane = compareMode() === 'overlay' ? bodyRef : newPaneRef;
      if (!baseCanvas || !pane || renderedZoom <= 0) return;
      const naturalW = baseCanvas.width / renderedZoom;   // px at zoom=1
      const naturalH = baseCanvas.height / renderedZoom;
      if (naturalW <= 0 || naturalH <= 0) return;
      const padding = 28; // breathing room inside the pane
      const availW = Math.max(1, pane.clientWidth - padding);
      const availH = Math.max(1, pane.clientHeight - padding);
      const z = Math.min(availW / naturalW, availH / naturalH);
      setCompareZoom(z);
      resetScroll();
    });
  });

  onCleanup(() => {
    if (zoomDebounceTimer) {
      clearTimeout(zoomDebounceTimer);
      zoomDebounceTimer = null;
    }
    clearCompareDocCache();
  });

  // Esc closes compare mode (capture phase so it wins over other Esc handlers)
  onMount(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && compareActive()) {
        e.preventDefault();
        e.stopPropagation();
        exitCompare();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  // Cursor-anchored wheel zoom, matching the main viewer's feel: the point
  // under the cursor stays put while zooming. Works without Ctrl (the previous
  // implementation was a no-op unless Ctrl was held — the main reason zoom felt
  // "limited"). Shift+wheel keeps native scrolling; Ctrl+wheel still zooms.
  // Zoom by `factor`, keeping the viewport point (ax, ay) — expressed in the
  // pane's client coordinates — fixed on screen. Immediately adjusts scroll so
  // the anchor holds through the CSS preview; flags the render to skip its
  // post-swap re-scale so the factor isn't double-applied.
  const zoomAnchored = (pane, ax, ay, factor) => {
    if (!pane) { setCompareZoom(compareZoom() * factor); return; }
    const rect = pane.getBoundingClientRect();
    const offX = ax - rect.left;
    const offY = ay - rect.top;
    // Point under the anchor, in the current rendered coordinate space.
    const px = pane.scrollLeft + offX;
    const py = pane.scrollTop + offY;
    const z0 = compareZoom();
    const z1 = Math.max(0.1, Math.min(8, z0 * factor));
    const applied = z1 / z0;
    if (Math.abs(applied - 1) < 1e-6) return;
    const newLeft = Math.max(0, px * applied - offX);
    const newTop = Math.max(0, py * applied - offY);
    _scrollAlreadyAnchored = true;
    setCompareZoom(z1);
    _scrollSyncing = true;
    pane.scrollLeft = newLeft;
    pane.scrollTop = newTop;
    if (compareMode() === 'side') {
      const other = pane === oldPaneRef ? newPaneRef : oldPaneRef;
      if (other) { other.scrollLeft = newLeft; other.scrollTop = newTop; }
    }
    requestAnimationFrame(() => { _scrollSyncing = false; });
  };

  // The pane the cursor/interaction is currently over (side-by-side) or the
  // overlay scroll body.
  const activePane = (clientX) => {
    if (compareMode() !== 'side') return bodyRef;
    if (clientX == null || !oldPaneRef || !newPaneRef) return oldPaneRef;
    return clientX < oldPaneRef.getBoundingClientRect().right ? oldPaneRef : newPaneRef;
  };

  const handleWheel = (e) => {
    // Wheels over the change-list side panel scroll that list natively.
    if (e.target?.closest?.('.compare-change-list')) return;
    // Shift+wheel: let the browser scroll natively (horizontal), don't zoom.
    if (e.shiftKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAnchored(activePane(e.clientX), e.clientX, e.clientY, factor);
  };

  // +/− buttons zoom around the centre of the (first) pane so the view doesn't
  // lurch toward the top-left corner.
  const zoomButton = (factor) => {
    const pane = compareMode() === 'side' ? oldPaneRef : bodyRef;
    if (!pane) { setCompareZoom(compareZoom() * factor); return; }
    const rect = pane.getBoundingClientRect();
    zoomAnchored(pane, rect.left + pane.clientWidth / 2, rect.top + pane.clientHeight / 2, factor);
  };

  // Click outside the change list deselects the focused change.
  const handleBodyClick = () => {
    if (compareFocusedChange()) setFocusedChange(null);
  };

  return (
    <Show when={compareActive()}>
      <div
        class="compare-view"
        style="position:absolute; inset:0; display:flex; flex-direction:column; background:#2a2a2a;"
        onWheel={handleWheel}
      >
        <div
          class="compare-toolbar"
          style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:linear-gradient(#ffffff, #f5f5f5); border-bottom:1px solid #d4d4d4; color:#222; font-size:12px;"
        >
          <strong>{t('compare.title') || 'Compare PDFs'}</strong>
          <span>·</span>
          <span>{compareMode() === 'overlay' ? (t('compare.overlay') || 'Overlay') : (t('compare.sideBySide') || 'Side-by-side')}</span>
          <span style="margin-left:12px;">{t('compare.page') || 'Page'}: {compareOldPage()} / {compareNewPage()}</span>
          <button class="pref-btn pref-btn-secondary" onClick={prevPagePair}>{'<'}</button>
          <button class="pref-btn pref-btn-secondary" onClick={nextPagePair}>{'>'}</button>
          <span style="margin-left:12px;">Zoom:</span>
          <button class="pref-btn pref-btn-secondary" onClick={() => zoomButton(1 / 1.2)}>-</button>
          <span style="min-width:40px; text-align:center;">{Math.round(compareZoom() * 100)}%</span>
          <button class="pref-btn pref-btn-secondary" onClick={() => zoomButton(1.2)}>+</button>
          <button class="pref-btn pref-btn-secondary" title={t('compare.fit') || 'Passend'} onClick={requestCompareFit}>{t('compare.fit') || 'Passend'}</button>
          <button class="pref-btn pref-btn-secondary" title={t('compare.reset') || '100%'} onClick={requestCompareReset}>100%</button>
          <Show when={compareMode() === 'overlay'}>
            <span style="margin-left:12px;">{t('compare.align') || 'Align'} dx:</span>
            <input
              type="number"
              style="width:60px;"
              value={compareOffset().dx}
              onInput={(e) => setCompareOffset({ dx: parseFloat(e.target.value) || 0 })}
            />
            <span>dy:</span>
            <input
              type="number"
              style="width:60px;"
              value={compareOffset().dy}
              onInput={(e) => setCompareOffset({ dy: parseFloat(e.target.value) || 0 })}
            />
            <span>rot:</span>
            <input
              type="number"
              step="0.1"
              style="width:60px;"
              value={compareOffset().rotation}
              onInput={(e) => setCompareOffset({ rotation: parseFloat(e.target.value) || 0 })}
            />
          </Show>
          <span style="flex:1;"></span>
          <button
            onClick={exitCompare}
            style="background:#dc2626; color:#fff; border:1px solid #b91c1c; padding:4px 14px; font-size:12px; font-weight:600; cursor:default;"
            title="Esc"
          >
            ✕ {t('compare.exit') || 'Vergelijken sluiten'}
          </button>
        </div>
        <div style="flex:1; display:flex; min-height:0;">
          <div
            class="compare-body"
            ref={bodyRef}
            onClick={handleBodyClick}
            onPointerDown={(e) => { if (compareMode() !== 'side') startPanDrag(e, bodyRef); }}
            style={compareMode() === 'side'
              ? 'flex:1; overflow:hidden; display:flex; align-items:stretch; padding:0; gap:0;'
              : 'flex:1; overflow:auto; display:flex; align-items:flex-start; justify-content:center; padding:14px; gap:14px;'}
          >
            <Show
              when={compareMode() === 'side'}
              fallback={
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                  {/* Overlay: NEW page rendered normally; diff regions drawn as
                      translucent rectangles on a separate highlight canvas. */}
                  <div
                    ref={overlayWrapRef}
                    style={`position:relative; background:#ffffff; box-shadow:0 0 0 1px #444; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                  >
                    <canvas ref={overlayNewCanvasRef} style="display:block;"></canvas>
                    {/* OLD page is rasterized for change detection only via
                        an offscreen canvas in compare-viewport.js — no DOM
                        element required. */}
                    <canvas
                      ref={overlayHighlightCanvasRef}
                      style="position:absolute; left:0; top:0; pointer-events:none;"
                    ></canvas>
                    <Show when={highlight()}>
                      {(h) => (
                        <div
                          style={`position:absolute; left:${h().x}px; top:${h().y}px; width:${h().w}px; height:${h().h}px; border:2px solid #ffd700; background:rgba(255,215,0,0.15); pointer-events:none; box-sizing:border-box;`}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              }
            >
              <div style="flex:1 1 50%; min-width:0; position:relative; display:flex; border-right:1px solid #555;">
                <div style="position:absolute; top:6px; left:8px; z-index:2; padding:2px 8px; background:rgba(40,40,40,0.85); color:#ddd; font-size:11px; pointer-events:none;">
                  {t('compare.oldDoc') || 'Old'}
                </div>
                <div
                  ref={oldPaneRef}
                  class="compare-pane compare-pane-old"
                  onScroll={() => syncScroll(oldPaneRef, newPaneRef)}
                  onPointerDown={(e) => startPanDrag(e, oldPaneRef)}
                  style="flex:1; overflow:auto;"
                >
                  <div style="padding:14px; display:inline-block; line-height:0;">
                    {/* Page + diff overlay share a scaled wrapper so the red/
                        yellow highlights stay pixel-aligned with the render. */}
                    <div
                      ref={oldWrapRef}
                      style={`position:relative; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                    >
                      <canvas
                        ref={oldCanvasRef}
                        style="display:block; background:#ffffff; box-shadow:0 0 0 1px #444;"
                      ></canvas>
                      <canvas
                        ref={oldHiCanvasRef}
                        style="position:absolute; left:0; top:0; pointer-events:none;"
                      ></canvas>
                    </div>
                  </div>
                </div>
              </div>
              <div style="flex:1 1 50%; min-width:0; position:relative; display:flex;">
                <div style="position:absolute; top:6px; left:8px; z-index:2; padding:2px 8px; background:rgba(40,40,40,0.85); color:#ddd; font-size:11px; pointer-events:none;">
                  {t('compare.newDoc') || 'New'}
                </div>
                <div
                  ref={newPaneRef}
                  class="compare-pane compare-pane-new"
                  onScroll={() => syncScroll(newPaneRef, oldPaneRef)}
                  onPointerDown={(e) => startPanDrag(e, newPaneRef)}
                  style="flex:1; overflow:auto;"
                >
                  <div style="padding:14px; display:inline-block; line-height:0;">
                    <div
                      ref={newWrapRef}
                      style={`position:relative; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                    >
                      <canvas
                        ref={newCanvasRef}
                        style="display:block; background:#ffffff; box-shadow:0 0 0 1px #444;"
                      ></canvas>
                      <canvas
                        ref={newHiCanvasRef}
                        style="position:absolute; left:0; top:0; pointer-events:none;"
                      ></canvas>
                    </div>
                  </div>
                </div>
              </div>
            </Show>
          </div>
          <ChangeListPanel
            t={t}
            changes={allChanges}
            onFocus={focusOnChange}
            focused={compareFocusedChange}
          />
        </div>
      </div>
    </Show>
  );
}

function ChangeListPanel(props) {
  const typeLabel = (type) => {
    const k = type === 'added' ? 'compare.added'
      : type === 'removed' ? 'compare.removed'
      : 'compare.modified';
    return props.t(k) || (type === 'added' ? 'Toegevoegd' : type === 'removed' ? 'Verwijderd' : 'Gewijzigd');
  };
  const typeIcon = (type) => type === 'added' ? '+' : type === 'removed' ? '−' : 'Δ';
  const typeColor = (type) => type === 'added' ? '#16a34a' : type === 'removed' ? '#dc2626' : '#ca8a04';

  // Per-type collapse state (default: expanded).
  const [collapsed, setCollapsed] = createSignal({ added: false, removed: false, modified: false });
  const toggleCollapsed = (type) => {
    setCollapsed({ ...collapsed(), [type]: !collapsed()[type] });
  };

  const groupedByType = () => {
    const result = { added: [], removed: [], modified: [] };
    const list = props.changes() || [];
    list.forEach((c, idx) => {
      // Preserve original index for stable numbering.
      const type = result[c.type] ? c.type : 'modified';
      result[type].push({ change: c, index: idx });
    });
    return result;
  };

  const visibleFor = (type) => {
    if (type === 'added') return compareShowAdded();
    if (type === 'removed') return compareShowRemoved();
    return compareShowModified();
  };
  const setVisibleFor = (type, val) => {
    if (type === 'added') setCompareShowAdded(val);
    else if (type === 'removed') setCompareShowRemoved(val);
    else setCompareShowModified(val);
  };

  const TypeToggle = (tProps) => (
    <button
      onClick={() => setVisibleFor(tProps.type, !visibleFor(tProps.type))}
      title={typeLabel(tProps.type)}
      style={`flex:1; display:flex; align-items:center; justify-content:center; gap:4px; padding:4px 6px; border:1px solid #b5b5b5; background:${visibleFor(tProps.type) ? '#ffffff' : '#e5e5e5'}; cursor:pointer; font-size:11px; color:${visibleFor(tProps.type) ? '#222' : '#888'};`}
    >
      <span
        style={`width:10px; height:10px; display:inline-block; background:${visibleFor(tProps.type) ? typeColor(tProps.type) : '#bbb'}; border:1px solid #555;`}
      ></span>
      {typeLabel(tProps.type)} ({tProps.count})
    </button>
  );

  const total = () => (props.changes() || []).length;

  return (
    <div
      class="compare-change-list"
      onClick={(e) => e.stopPropagation()}
      style="width:260px; background:#f5f5f5; border-left:1px solid #d4d4d4; display:flex; flex-direction:column; color:#222; font-size:12px;"
    >
      <div
        style="padding:6px 10px; background:linear-gradient(#ffffff, #f5f5f5); border-bottom:1px solid #d4d4d4; font-weight:bold;"
      >
        {(props.t('compare.changes') || 'Wijzigingen')}: {total()}
      </div>
      <div style="display:flex; gap:4px; padding:6px 8px; border-bottom:1px solid #d4d4d4; background:#fafafa;">
        <TypeToggle type="added" count={groupedByType().added.length} />
        <TypeToggle type="removed" count={groupedByType().removed.length} />
        <TypeToggle type="modified" count={groupedByType().modified.length} />
      </div>
      <div style="flex:1; overflow:auto;">
        <Show
          when={total() > 0}
          fallback={
            <div style="padding:14px; color:#666; font-style:italic;">
              {props.t('compare.noChanges') || 'Geen wijzigingen'}
            </div>
          }
        >
          <For each={['added', 'removed', 'modified']}>
            {(type) => (
              <Show when={visibleFor(type) && groupedByType()[type].length > 0}>
                <div>
                  <div
                    onClick={() => toggleCollapsed(type)}
                    style={`padding:5px 10px; background:#e8e8e8; border-bottom:1px solid #d4d4d4; cursor:pointer; display:flex; align-items:center; gap:6px; font-weight:bold; user-select:none;`}
                  >
                    <span style="width:10px; display:inline-block;">{collapsed()[type] ? '▶' : '▼'}</span>
                    <span
                      style={`width:10px; height:10px; display:inline-block; background:${typeColor(type)}; border:1px solid #555;`}
                    ></span>
                    <span>{typeLabel(type)} ({groupedByType()[type].length})</span>
                  </div>
                  <Show when={!collapsed()[type]}>
                    <For each={groupedByType()[type]}>
                      {(item) => {
                        const c = item.change;
                        const isFocused = () => props.focused() === c;
                        return (
                          <div
                            onClick={(e) => { e.stopPropagation(); props.onFocus(c); }}
                            style={`height:50px; padding:6px 10px; border-bottom:1px solid #e0e0e0; display:flex; align-items:center; gap:8px; cursor:pointer; background:${isFocused() ? '#dbeafe' : '#ffffff'};`}
                            onMouseEnter={(e) => { if (!isFocused()) e.currentTarget.style.background = '#eaf3ff'; }}
                            onMouseLeave={(e) => { if (!isFocused()) e.currentTarget.style.background = '#ffffff'; }}
                          >
                            <div
                              style={`width:22px; height:22px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; background:${typeColor(c.type)}; color:#fff; font-weight:bold; font-size:13px;`}
                            >
                              {typeIcon(c.type)}
                            </div>
                            <div style="flex:1; min-width:0;">
                              <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                {item.index + 1}. {c.source === 'annotation' ? c.label : typeLabel(c.type)}
                              </div>
                              <div style="color:#666; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                {c.source === 'annotation'
                                  ? `✎ ${props.t('compare.annotation') || 'Annotatie'}`
                                  : `~${Math.round(c.width)}×${Math.round(c.height)} px @ (${Math.round(c.x)}, ${Math.round(c.y)})`}
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
