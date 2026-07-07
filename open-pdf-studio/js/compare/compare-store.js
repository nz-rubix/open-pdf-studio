// Compare/Overlay session store.
// Tracks which two PDFs are being compared, the mode, current page-pair and offset.
// Reactive via solid-js signals so UI re-renders when fields change.

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';

const [active, setActive] = createSignal(false);
const [oldPath, setOldPath] = createSignal(null);
const [newPath, setNewPath] = createSignal(null);
const [mode, setMode] = createSignal('overlay'); // 'overlay' | 'side'
const [oldPage, setOldPage] = createSignal(1);
const [newPage, setNewPage] = createSignal(1);
// Aantal pagina's per document, zodat pagina-navigatie binnen de grenzen
// blijft. Zonder deze grens liep nextPagePair ongelimiteerd door: de render
// klemt intern naar de laatste pagina, dus je bleef "vooruit" klikken terwijl
// dezelfde laatste pagina zichtbaar bleef en de teller doorliep. Documenten
// mogen verschillende paginaaantallen hebben — elk kent zijn eigen maximum.
const [oldPageCount, setOldPageCount] = createSignal(1);
const [newPageCount, setNewPageCount] = createSignal(1);
const [offset, setOffset] = createSignal({ dx: 0, dy: 0, rotation: 0 });
const [zoom, setZoom] = createSignal(1);
const [changes, setChangesSignal] = createSignal([]);
const [focusedChange, setFocusedChangeSignal] = createSignal(null);
const [showAdded, setShowAdded] = createSignal(true);
const [showRemoved, setShowRemoved] = createSignal(true);
const [showModified, setShowModified] = createSignal(true);
// Highlight style toggles: filled box and/or contour outline. Both on by default.
const [showBox, setShowBox] = createSignal(true);
const [showContour, setShowContour] = createSignal(true);
// True when the compare TAB is the currently-shown view (vs. a normal PDF tab).
// The compare session stays "active" while a PDF tab is focused; this flag just
// controls whether the compare view is on screen.
const [focused, setFocused] = createSignal(false);
// Bumped as a counter to request a "fit page to viewport" recalculation. The
// view watches this signal and, on change, re-fits the zoom to the current
// container size. Carries the desired kind: 'fit' (fill the pane) or 'reset'
// (jump to exactly 100%). We use {kind,seq} so two consecutive identical
// requests still trigger the effect.
const [fitRequest, setFitRequest] = createSignal({ kind: null, seq: 0 });

export {
  active as compareActive,
  oldPath as compareOldPath,
  newPath as compareNewPath,
  mode as compareMode,
  oldPage as compareOldPage,
  newPage as compareNewPage,
  oldPageCount as compareOldPageCount,
  newPageCount as compareNewPageCount,
  offset as compareOffset,
  zoom as compareZoom,
  changes as compareChanges,
  focusedChange as compareFocusedChange,
  showAdded as compareShowAdded,
  showRemoved as compareShowRemoved,
  showModified as compareShowModified,
  setShowAdded as setCompareShowAdded,
  setShowRemoved as setCompareShowRemoved,
  setShowModified as setCompareShowModified,
  showBox as compareShowBox,
  showContour as compareShowContour,
  setShowBox as setCompareShowBox,
  setShowContour as setCompareShowContour,
  focused as compareFocused,
  fitRequest as compareFitRequest,
};

// Bring the compare tab to the front (show the compare view).
export function focusCompareTab() { if (active()) setFocused(true); }
// Send the compare tab to the back (a normal PDF tab is shown instead). The
// compare session stays alive so switching back is instant.
export function blurCompareTab() { setFocused(false); }

// Request the view to fit the page(s) to the available space.
export function requestCompareFit() {
  setFitRequest((r) => ({ kind: 'fit', seq: r.seq + 1 }));
}

// Request the view to reset zoom to exactly 100%.
export function requestCompareReset() {
  setFitRequest((r) => ({ kind: 'reset', seq: r.seq + 1 }));
}

export function setChanges(list) {
  setChangesSignal(Array.isArray(list) ? list : []);
}

export function setFocusedChange(change) {
  setFocusedChangeSignal(change || null);
}

// Zoek het paginaaantal van een geopend document op via het pdf.js-doc dat de
// hoofd-viewer al geladen heeft. Valt terug op 1 als het onbekend is.
function _pageCountFor(filePath) {
  const doc = (state.documents || []).find(d => d && d.filePath === filePath);
  return doc?.pdfDoc?.numPages || doc?.pageCount || 1;
}

export function startCompare({ oldFilePath, newFilePath, mode: m, oldPage: op = 1, newPage: np = 1 }) {
  setOldPath(oldFilePath);
  setNewPath(newFilePath);
  setMode(m || 'overlay');
  const oc = Math.max(1, _pageCountFor(oldFilePath));
  const nc = Math.max(1, _pageCountFor(newFilePath));
  setOldPageCount(oc);
  setNewPageCount(nc);
  // Klem de start-pagina's binnen hun document zodat we nooit op een
  // niet-bestaande pagina beginnen.
  setOldPage(Math.max(1, Math.min(oc, op)));
  setNewPage(Math.max(1, Math.min(nc, np)));
  setOffset({ dx: 0, dy: 0, rotation: 0 });
  setZoom(1);
  setFocusedChangeSignal(null); // clean slate — no change selected yet
  setActive(true);
  setFocused(true); // open the compare tab in front
}

export function exitCompare() {
  setActive(false);
  setFocused(false);
  setOldPath(null);
  setNewPath(null);
}

export function setCompareMode(m) {
  setMode(m);
}

// Kan het pagina-paar nog vooruit/achteruit? Waar als ten minste één document
// nog een volgende/vorige pagina heeft. Gebruikt om de knoppen te dimmen.
export function canNextPagePair() {
  return oldPage() < oldPageCount() || newPage() < newPageCount();
}
export function canPrevPagePair() {
  return oldPage() > 1 || newPage() > 1;
}

export function nextPagePair() {
  // Elk document stapt op tot zijn eigen laatste pagina. Zo blijf je bij
  // ongelijke paginaaantallen vloeiend doorlopen: het kortere document blijft
  // op zijn laatste pagina staan terwijl het langere verder gaat.
  if (!canNextPagePair()) return;
  setOldPage(p => Math.min(oldPageCount(), p + 1));
  setNewPage(p => Math.min(newPageCount(), p + 1));
}

export function prevPagePair() {
  if (!canPrevPagePair()) return;
  setOldPage(p => Math.max(1, p - 1));
  setNewPage(p => Math.max(1, p - 1));
}

export function setPagePair(op, np) {
  if (op != null) setOldPage(Math.max(1, Math.min(oldPageCount(), op)));
  if (np != null) setNewPage(Math.max(1, Math.min(newPageCount(), np)));
}

export function setCompareZoom(z) {
  setZoom(Math.max(0.1, Math.min(8, z)));
}

export function setCompareOffset(o) {
  setOffset({ ...offset(), ...o });
}
