// ============================================================================
// Interactive image-crop overlay.
//
// Activated from the contextual "Afbeelding" ribbon tab (Croppen button). While
// active it draws a crop rectangle with draggable edge + corner handles inside
// the selected image annotation and dims the trimmed-away border. Dragging a
// handle updates the annotation's non-destructive crop fractions
// (cropLeft/cropTop/cropRight/cropBottom, 0-1 per side — same fields used by the
// properties panel and the saved AP stream, issue #212).
//
// The overlay installs its own pointer handlers on the annotation canvas so it
// stays fully isolated from the main tool dispatcher. The draw pass is invoked
// from redrawAnnotations() via drawImageCropOverlay().
// ============================================================================

import { state, getActiveDocument } from '../core/state.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { resolvePointerCoords } from '../tools/tool-context.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { recordPropertyChange } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';

// The annotation currently being cropped (null when inactive).
let _cropAnn = null;
// Pre-edit snapshot fractions, used to build a single undo step on commit.
let _snapshot = null;
// Live drag state.
let _dragHandle = null; // 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br'
let _installed = false;

const MIN_VISIBLE = 0.1; // keep at least 10% of the source visible per axis

function clampFrac(v) { return Math.max(0, Math.min(0.9, v || 0)); }

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function effScale() {
  const doc = getActiveDocument();
  const dpr = window.devicePixelRatio || 1;
  const vp = window.__pdfViewport;
  if (vp && vp.active && doc?.filePath) return vp.zoom;
  return (doc?.scale || 1.5) * dpr;
}

// Compute the crop rect (app-space, un-rotated) from the annotation + fractions.
function cropRect(ann) {
  const cl = clampFrac(ann.cropLeft), ct = clampFrac(ann.cropTop);
  const cr = clampFrac(ann.cropRight), cb = clampFrac(ann.cropBottom);
  return {
    x: ann.x + ann.width * cl,
    y: ann.y + ann.height * ct,
    w: ann.width * (1 - cl - cr),
    h: ann.height * (1 - ct - cb),
  };
}

// Handle centre points in app-space (un-rotated local frame).
function handlePoints(ann) {
  const r = cropRect(ann);
  const mx = r.x + r.w / 2, my = r.y + r.h / 2;
  return {
    tl: { x: r.x, y: r.y }, tr: { x: r.x + r.w, y: r.y },
    bl: { x: r.x, y: r.y + r.h }, br: { x: r.x + r.w, y: r.y + r.h },
    t: { x: mx, y: r.y }, b: { x: mx, y: r.y + r.h },
    l: { x: r.x, y: my }, r: { x: r.x + r.w, y: my },
  };
}

// Map a screen PointerEvent to the annotation's un-rotated local app-space.
function toLocal(e, ann) {
  const c = resolvePointerCoords(e);
  let px = c.x, py = c.y;
  // Undo the annotation rotation about its centre so hit-testing / dragging
  // work in the same local frame the crop fractions live in.
  if (ann.rotation) {
    const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
    const a = -ann.rotation * Math.PI / 180;
    const dx = px - cx, dy = py - cy;
    px = cx + dx * Math.cos(a) - dy * Math.sin(a);
    py = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  return { x: px, y: py };
}

function hitHandle(local, ann) {
  const tol = 10 / effScale(); // ~10 screen px
  const pts = handlePoints(ann);
  for (const key of ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']) {
    const p = pts[key];
    if (Math.abs(local.x - p.x) <= tol && Math.abs(local.y - p.y) <= tol) return key;
  }
  return null;
}

function onPointerDown(e) {
  if (!_cropAnn || e.button !== 0) return;
  const local = toLocal(e, _cropAnn);
  const h = hitHandle(local, _cropAnn);
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  _dragHandle = h;
  try { annotationCanvas?.setPointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
}

function onPointerMove(e) {
  if (!_cropAnn) return;
  if (!_dragHandle) {
    // Hover cursor feedback.
    const local = toLocal(e, _cropAnn);
    const h = hitHandle(local, _cropAnn);
    if (annotationCanvas) {
      annotationCanvas.style.cursor = h
        ? ((h === 'l' || h === 'r') ? 'ew-resize'
          : (h === 't' || h === 'b') ? 'ns-resize'
          : (h === 'tl' || h === 'br') ? 'nwse-resize' : 'nesw-resize')
        : 'default';
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const ann = _cropAnn;
  const local = toLocal(e, ann);
  // Convert the pointer position into fractions along each axis.
  const fx = (local.x - ann.x) / ann.width;
  const fy = (local.y - ann.y) / ann.height;
  const h = _dragHandle;
  if (h.includes('l')) ann.cropLeft = Math.max(0, Math.min(fx, 1 - (ann.cropRight || 0) - MIN_VISIBLE));
  if (h.includes('r')) ann.cropRight = Math.max(0, Math.min(1 - fx, 1 - (ann.cropLeft || 0) - MIN_VISIBLE));
  if (h.includes('t')) ann.cropTop = Math.max(0, Math.min(fy, 1 - (ann.cropBottom || 0) - MIN_VISIBLE));
  if (h.includes('b')) ann.cropBottom = Math.max(0, Math.min(1 - fy, 1 - (ann.cropTop || 0) - MIN_VISIBLE));
  redraw();
}

function onPointerUp(e) {
  if (!_dragHandle) return;
  _dragHandle = null;
  try { annotationCanvas?.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
  const ann = _cropAnn;
  if (ann && _snapshot) {
    // Only record undo if something actually changed since activation.
    const changed = ['cropLeft', 'cropTop', 'cropRight', 'cropBottom']
      .some(k => (ann[k] || 0) !== (_snapshot[k] || 0));
    if (changed) {
      // Temporarily restore the snapshot so recordPropertyChange captures the
      // pre-crop state, then re-apply the new crop.
      const now = { cropLeft: ann.cropLeft, cropTop: ann.cropTop, cropRight: ann.cropRight, cropBottom: ann.cropBottom };
      Object.assign(ann, _snapshot);
      recordPropertyChange(ann);
      Object.assign(ann, now);
      ann.modifiedAt = new Date().toISOString();
      _snapshot = { cropLeft: ann.cropLeft, cropTop: ann.cropTop, cropRight: ann.cropRight, cropBottom: ann.cropBottom };
      showProperties(ann);
    }
  }
}

function onKeyDown(e) {
  // Enter commits the crop (bakes it into the geometry); Escape cancels it and
  // restores the pre-edit fractions. Both leave crop mode via the ribbon store,
  // which calls back into stopImageCrop() — so we don't stop here directly.
  if (e.key === 'Enter') {
    e.preventDefault();
    import('../solid/stores/imageEditStore.js').then(m => m.stopCropMode(true)).catch(() => {});
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (_cropAnn && _snapshot) Object.assign(_cropAnn, _snapshot); // revert crop
    import('../solid/stores/imageEditStore.js').then(m => m.stopCropMode(false)).catch(() => {});
  }
}

function install() {
  if (_installed || !annotationCanvas) return;
  annotationCanvas.addEventListener('pointerdown', onPointerDown, true);
  annotationCanvas.addEventListener('pointermove', onPointerMove, true);
  annotationCanvas.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  _installed = true;
}

function uninstall() {
  if (!_installed) return;
  annotationCanvas?.removeEventListener('pointerdown', onPointerDown, true);
  annotationCanvas?.removeEventListener('pointermove', onPointerMove, true);
  annotationCanvas?.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('keydown', onKeyDown, true);
  if (annotationCanvas) annotationCanvas.style.cursor = '';
  _installed = false;
}

// Public API ----------------------------------------------------------------

export function startImageCrop(ann) {
  if (!ann || ann.type !== 'image') return false;
  _cropAnn = ann;
  _snapshot = {
    cropLeft: ann.cropLeft || 0, cropTop: ann.cropTop || 0,
    cropRight: ann.cropRight || 0, cropBottom: ann.cropBottom || 0,
  };
  state.imageCropMode = true;
  install();
  redraw();
  return true;
}

// Bake the current crop into the annotation geometry: shrink width/height (and
// reposition x/y) to the on-page crop rectangle so the visible image is
// genuinely smaller and stays that way after saving.
//
// The crop FRACTIONS are preserved on purpose. They describe which window of
// the *source* image is shown; the render path (rendering.js) slices that
// window and maps it onto the full annotation rect. Because the new rect equals
// the window's current on-page box, the same source window now maps onto the
// smaller rect at the same position → identical pixels, but the annotation's
// dimensions have actually shrunk. Trimmed-away source stays available, so a
// later crop pass can drag handles back outward to reveal it.
//
// A single undo step (recordPropertyChange) captures the whole geometry commit.
function commitCrop(ann) {
  if (!ann) return;
  const cl = clampFrac(ann.cropLeft), ct = clampFrac(ann.cropTop);
  const cr = clampFrac(ann.cropRight), cb = clampFrac(ann.cropBottom);
  if (!(cl || ct || cr || cb)) return; // nothing cropped
  const r = cropRect(ann);
  if (r.w <= 0 || r.h <= 0) return;

  recordPropertyChange(ann);
  ann.x = r.x; ann.y = r.y;
  ann.width = r.w; ann.height = r.h;
  ann.modifiedAt = new Date().toISOString();
  showProperties(ann);

  // Refresh the pre-edit snapshot so a subsequent commit in the same session
  // diffs against the new baked geometry.
  _snapshot = {
    cropLeft: ann.cropLeft || 0, cropTop: ann.cropTop || 0,
    cropRight: ann.cropRight || 0, cropBottom: ann.cropBottom || 0,
  };
}

export function stopImageCrop(commit = true) {
  if (commit && _cropAnn && !_cropAnn.locked) commitCrop(_cropAnn);
  uninstall();
  _cropAnn = null;
  _snapshot = null;
  _dragHandle = null;
  state.imageCropMode = false;
  redraw();
}

export function isImageCropActive() { return !!_cropAnn; }

// Draw the crop overlay. Called from redrawAnnotations() in the annotation
// canvas' app-space (already scaled/translated). No-op when inactive or when
// the cropped annotation isn't on the current page.
export function drawImageCropOverlay(ctx, curPage) {
  const ann = _cropAnn;
  if (!ann) return;
  if (curPage !== undefined && ann.page !== curPage) return;

  const sc = effScale();
  ctx.save();
  // Match the image's rotation so the overlay tracks a rotated image.
  if (ann.rotation) {
    const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(ann.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  const r = cropRect(ann);

  // Dim the trimmed-away border (everything in the image rect outside crop).
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.rect(ann.x, ann.y, ann.width, ann.height);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');

  // Crop rectangle border.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / sc;
  ctx.setLineDash([]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  // Rule-of-thirds guide lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  for (let i = 1; i <= 2; i++) {
    ctx.moveTo(r.x + (r.w * i) / 3, r.y);
    ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
    ctx.moveTo(r.x, r.y + (r.h * i) / 3);
    ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
  }
  ctx.stroke();

  // Handles — Windows-style solid black squares (~8 screen px) on the 4 corners
  // and 4 edge midpoints, matching the selection/resize grips. A thin white
  // outline keeps them visible over dark image content.
  const hs = 8 / sc;
  const pts = handlePoints(ann);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / sc;
  for (const key of ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']) {
    const p = pts[key];
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
  }

  ctx.restore();
}
