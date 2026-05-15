import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { viewport, zoomStepAtPoint, suppressNextFit, addPanVelocity, stopPanMomentum } from '../../pdf/pdf-viewport.js';
import { getTool } from '../../tools/tool-registry.js';

// ─── Wheel Zoom + Pan + Page Navigation ───────────────────────────────────
// Single source of truth for the wheel event on the main view.
// In vector viewport mode:
//   Ctrl+wheel  → zoom at cursor (snaps to discrete preset levels)
//   plain wheel → pan inside the current page; at the page edge in the wheel
//                 direction, navigate to next/previous page.
// In legacy mode it falls back to scroll-position-based page nav.

let _pageNavCooldown = false;
// Pixels of slack at the page edge before we treat the page as "at the edge"
// and trigger a page change. Without this, sub-pixel float offsets prevent nav.
const EDGE_SLACK = 1;

// Trackpad pinch-zoom synthesizes wheel events with `ctrlKey` set and small
// deltaY values (often 1–10). A real mouse wheel notch sends ~100. We
// accumulate small deltas across events and only fire a discrete zoom step
// when the accumulator exceeds the threshold, so a single trackpad pinch
// doesn't slingshot through 5 zoom levels.
let _zoomAccum = 0;
let _zoomAccumSign = 0;
const ZOOM_DELTA_THRESHOLD = 50;
let _zoomAccumResetTimer = null;
function _resetZoomAccumSoon() {
  if (_zoomAccumResetTimer) clearTimeout(_zoomAccumResetTimer);
  _zoomAccumResetTimer = setTimeout(() => {
    _zoomAccum = 0;
    _zoomAccumSign = 0;
    _zoomAccumResetTimer = null;
  }, 200);
}

// Wheel-zoom generation counter — fixes the rapid-zoom scroll-anchor stack-up.
// Each ctrl+wheel handler captures its own _myWheelGen at entry. Multiple
// rapid handlers all read the SAME oldScale (sync part), AWAIT zoomIn(), then
// post-zoom each tries to adjust container.scrollLeft to anchor the cursor to
// its captured worldX. With N rapid wheels, N near-identical dxScroll values
// stack up — the page visibly springs left/right past the intended anchor.
// The gen check after the await ensures only the LATEST wheel handler runs
// the scroll adjustment; earlier ones bail out so their dxScroll doesn't get
// applied on top of the latest one's.
let _wheelZoomGen = 0;

export function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    const activeDoc = getActiveDocument();
    if (!activeDoc?.pdfDoc) return;

    // Delegate to active tool first (e.g. arc bulge adjustment)
    const _wheelTool = getTool(state.currentTool);
    if (_wheelTool && _wheelTool.onWheel) {
      const _wheelCtx = { state, redraw: () => {
        viewport.dirty = true;
      }};
      _wheelTool.onWheel(_wheelCtx, e);
      if (e.defaultPrevented) return;
    }

    // Ctrl+wheel = zoom (snaps to discrete preset levels at the cursor).
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // Starting a zoom gesture: kill any in-flight pan momentum so the page
      // doesn't keep gliding mid-zoom (would tear the cursor anchor away).
      stopPanMomentum();
      // Legacy path (vector viewport inactive). Used for blank docs (no
      // filePath) and any PDF whose vector viewport didn't activate. The
      // zoom flow is doc.scale → renderPage → canvas resized. We anchor the
      // cursor by capturing the pre-zoom position of the cursor inside the
      // canvas (in PDF point units, i.e. canvas-CSS-pixels / scale), then
      // after the re-render adjust the scroll container so the same PDF
      // point sits under the cursor again.
      if (!viewport.active) {
        // Stamp this wheel-zoom invocation with a fresh generation. Re-checked
        // after the awaited zoomIn/zoomOut. Older invocations bail out of the
        // post-zoom scroll-anchor adjustment so their (already-stale) dxScroll
        // doesn't pile on top of the latest one. See _wheelZoomGen comment.
        const myWheelGen = ++_wheelZoomGen;
        const dy = e.deltaY || 0;
        const direction = dy < 0 ? 1 : -1;
        const m = await import('../../pdf/renderer.js');
        const pdfCanvas = document.getElementById('pdf-canvas');
        const container = document.getElementById('pdf-container');

        // ── Pre-zoom anchor capture ───────────────────────────────────────
        // Capture the cursor position as a NORMALIZED FRACTION of the canvas
        // (0.0 = canvas-left, 1.0 = canvas-right). This is scale-independent
        // and uses ONLY the visible canvas CSS geometry — no `doc.scale`.
        //
        // Why scale-independent: zoomIn() updates `doc.scale` synchronously,
        // but the predictive canvas CSS resize happens inside renderPage()
        // AFTER `await analyze_page_type` (which takes 50-300ms for BARN-class
        // PDFs). During that window, doc.scale is at the new value but the
        // canvas CSS dimensions are still at the OLD value. If a second wheel
        // event arrives in this window, reading `doc.scale` gives the new
        // scale but `canvasRect` gives the old size — the worldX formula
        // `(clientX - rect.left) / oldScale` produces a stale world point,
        // and the cursor anchor visibly drifts. The user reported this as
        // "geen fixatie rondom mijn muis".
        //
        // Using fractionX (CSS-pixels / CSS-pixels = unitless) avoids the
        // mismatch entirely. Post-zoom we recover screen-X as
        // `newRect.left + fractionX * newRect.width`, which is mathematically
        // equivalent to the old `newRect.left + worldX * newScale` formula
        // (since `newRect.width = pageWidthPt * newScale`) but cannot race
        // with an inconsistent doc.scale.
        let fractionX = null, fractionY = null;
        const clientX = e.clientX, clientY = e.clientY;
        if (pdfCanvas && container) {
          const canvasRect = pdfCanvas.getBoundingClientRect();
          if (canvasRect.width > 0 && canvasRect.height > 0) {
            fractionX = (clientX - canvasRect.left) / canvasRect.width;
            fractionY = (clientY - canvasRect.top) / canvasRect.height;
          }
        }

        if (direction > 0) await m.zoomIn(); else await m.zoomOut();

        // Post-zoom: only the LATEST wheel-zoom invocation runs the scroll
        // adjustment. Earlier rapid wheels bail out — otherwise N rapid wheel
        // notches stack N near-identical dxScroll values and the page springs
        // visibly past the cursor anchor.
        if (myWheelGen !== _wheelZoomGen) {
          console.log(`[wheel-zoom] STALE gen ${myWheelGen} (current ${_wheelZoomGen}) — skipping scroll adjustment`);
          return;
        }

        // Shift scroll so the cursor's world point (captured as a 0..1 fraction
        // of the canvas) is still under the cursor at the new zoom. With flex
        // `safe center`, the canvas is auto-centered when it fits the
        // container — scrolling clamps to 0 in that case and the canvas stays
        // centered (correct fallback).
        if (fractionX !== null && pdfCanvas && container) {
          const newCanvasRect = pdfCanvas.getBoundingClientRect();
          const targetClientX = newCanvasRect.left + fractionX * newCanvasRect.width;
          const targetClientY = newCanvasRect.top + fractionY * newCanvasRect.height;
          const dxScroll = targetClientX - clientX;
          const dyScroll = targetClientY - clientY;
          if (dxScroll !== 0) container.scrollLeft += dxScroll;
          if (dyScroll !== 0) container.scrollTop += dyScroll;
        }
        return;
      }
      // Always anchor to pdf-canvas rect. The cursor may be over a non-canvas
      // overlay (textLayer span, annotation overlay child) whose own rect is
      // offset from the canvas — using e.target.getBoundingClientRect() in
      // that case gives wrong sx/sy and the zoom anchor drifts. The
      // pdf-canvas, annotation-canvas and text-highlight-canvas all share the
      // same rect, so the pdf-canvas rect is the authoritative reference.
      const _pdfCanvas = document.getElementById('pdf-canvas');
      const rect = _pdfCanvas?.getBoundingClientRect()
        || e.target.closest('canvas')?.getBoundingClientRect()
        || e.target.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const dy = e.deltaY || 0;
      const direction = dy < 0 ? 1 : -1;  // wheel up = zoom in (+1)

      // Mouse wheel notch (large deltaY) → step immediately.
      // Trackpad pinch (small deltaY) → accumulate, only step at threshold.
      if (Math.abs(dy) >= ZOOM_DELTA_THRESHOLD) {
        _zoomAccum = 0;
        _zoomAccumSign = 0;
        zoomStepAtPoint(sx, sy, direction);
      } else {
        // Reset accumulator if direction reversed
        if (_zoomAccumSign !== 0 && _zoomAccumSign !== direction) {
          _zoomAccum = 0;
        }
        _zoomAccumSign = direction;
        _zoomAccum += Math.abs(dy);
        if (_zoomAccum >= ZOOM_DELTA_THRESHOLD) {
          _zoomAccum = 0;
          zoomStepAtPoint(sx, sy, direction);
        }
        _resetZoomAccumSoon();
      }
      return;
    }

    // ─── Vector viewport mode: pan + edge-triggered page nav ──────────────
    if (viewport.active) {
      e.preventDefault();
      const pdfCanvas = document.getElementById('pdf-canvas');
      if (!pdfCanvas) return;

      const dx = e.deltaX || 0;
      const dy = e.deltaY || 0;
      const pageScreenH = viewport.pageH * viewport.zoom;
      const pageScreenW = viewport.pageW * viewport.zoom;
      const canvasH = pdfCanvas.height;
      const canvasW = pdfCanvas.width;

      // Where the page edges sit on the visible canvas right now
      const pageTop = viewport.offsetY;
      const pageBottom = viewport.offsetY + pageScreenH;
      const pageLeft = viewport.offsetX;
      const pageRight = viewport.offsetX + pageScreenW;

      // "At edge" tests — true if the page bottom/top is already inside the viewport
      const atTop = pageTop >= -EDGE_SLACK;                       // can't pan up further
      const atBottom = pageBottom <= canvasH + EDGE_SLACK;        // can't pan down further

      // Page nav: only if scroll direction matches an exhausted edge AND we're
      // single-page mode AND not already cooling down from a previous nav.
      if (activeDoc.viewMode === 'single' && !_pageNavCooldown && Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0 && atBottom && activeDoc.currentPage < activeDoc.pdfDoc.numPages) {
          _pageNavCooldown = true;
          // Kill any in-flight pan momentum so the new page doesn't inherit
          // the previous page's residual scroll velocity (would slingshot
          // past the top into the centered fit position).
          stopPanMomentum();
          // Tell the next setPage() to keep the current zoom instead of
          // running fitToViewport(), so the user's zoom level survives the
          // page change with no flash to fit-zoom in between.
          suppressNextFit();
          await goToPage(activeDoc.currentPage + 1);
          alignPageToTop();
          setTimeout(() => { _pageNavCooldown = false; }, 250);
          return;
        }
        if (dy < 0 && atTop && activeDoc.currentPage > 1) {
          _pageNavCooldown = true;
          stopPanMomentum();
          suppressNextFit();
          await goToPage(activeDoc.currentPage - 1);
          alignPageToBottom();
          setTimeout(() => { _pageNavCooldown = false; }, 250);
          return;
        }
      }

      // Smooth pan: feed wheel deltas into the velocity accumulator instead
      // of writing offsetX/Y directly. The RAF loop in pdf-viewport applies
      // and decays the velocity over multiple frames, producing Apple-style
      // momentum scroll — a single wheel notch glides to a smooth stop.
      // Skip the contribution on any axis where the page already fits the
      // viewport (no scroll headroom on that axis).
      const vx = (pageScreenW <= canvasW) ? 0 : dx;
      const vy = (pageScreenH <= canvasH) ? 0 : dy;
      if (vx !== 0 || vy !== 0) {
        addPanVelocity(vx, vy);
      }
      return;
    }

    // ─── Legacy mode: scroll-position-based page nav ──────────────────────
    if (activeDoc?.viewMode !== 'single') return;
    if (_pageNavCooldown) return;

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;

    const canScroll = pdfContainer.scrollHeight > pdfContainer.clientHeight + 1;
    const atBottomLegacy = !canScroll || pdfContainer.scrollTop + pdfContainer.clientHeight >= pdfContainer.scrollHeight - 5;
    const atTopLegacy = !canScroll || pdfContainer.scrollTop <= 5;

    if (e.deltaY > 0 && atBottomLegacy && activeDoc.currentPage < activeDoc.pdfDoc.numPages) {
      e.preventDefault();
      _pageNavCooldown = true;
      await goToPage(activeDoc.currentPage + 1);
      setTimeout(() => { _pageNavCooldown = false; }, 300);
    } else if (e.deltaY < 0 && atTopLegacy && activeDoc.currentPage > 1) {
      e.preventDefault();
      _pageNavCooldown = true;
      await goToPage(activeDoc.currentPage - 1);
      setTimeout(() => { _pageNavCooldown = false; }, 300);
    }
  }, { passive: false });
}

// After advancing forward via wheel, snap the new page so its TOP is at the
// top of the viewport (so the user can keep scrolling down through it).
// If the new page fits the viewport entirely it will be centered instead —
// the viewport's clampAndCenter() in _render() handles that automatically,
// but we set offsetY = 0 here so the FIRST paint is already correct (no
// one-frame flash to a stale position).
function alignPageToTop() {
  viewport.offsetY = 0;
  viewport.dirty = true;
}

// After going back via wheel, snap the new page so its BOTTOM is at the
// bottom of the viewport. clampAndCenter() will center it later if it fits.
function alignPageToBottom() {
  const pdfCanvas = document.getElementById('pdf-canvas');
  if (!pdfCanvas) return;
  const pageScreenH = viewport.pageH * viewport.zoom;
  viewport.offsetY = pdfCanvas.height - pageScreenH;
  viewport.dirty = true;
}

export function cancelPendingZoom() {
  // No-op — viewport zoom is instant, no pending renders
}
