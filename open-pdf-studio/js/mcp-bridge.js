/**
 * MCP <-> WebView bridge.
 *
 * Listens for `mcp:*` events emitted by the Rust MCP server (see
 * `src-tauri/src/mcp_app_bridge.rs`) and dispatches them to the matching
 * in-app function. After each handler completes (or throws) we call
 * `app_response(requestId, result)` so the awaiting MCP tool returns.
 *
 * Expected event payload:
 *   { request_id: number, params: object }
 *
 * Handler return shapes:
 *   { ok: true, ... }       -> success, additional fields are tool-specific
 *   { ok: false, error: s } -> failure (the tool surface still gets a 200 OK)
 *
 * The MCP server side doesn't impose a specific response schema; whatever
 * JSON we send back ends up in the tool's `content[0].text` block verbatim.
 */

// All app-internal imports are resolved lazily inside handlers so the
// bridge module load never pulls the heavy renderer/loader graph at app
// startup. Keeps `initMcpBridge()` import-safe even if a downstream module
// is briefly broken in dev.

/** Best-effort grab of the Tauri invoke fn — falls back to a no-op so this
 *  module is import-safe in the browser/dev-server case. */
function tauriInvoke() {
  return window.__TAURI__?.core?.invoke ?? null;
}

// ─── Console ring buffer for MCP/AI observability ────────────────────────
// Captures the most recent N console messages whose text matches the
// observer regex. The MCP tool `app_get_recent_console` reads this and
// returns the slice the AI client wants. Default-on so an AI agent can
// always look back at what happened during the last few seconds without
// any setup step on the user side.
const CONSOLE_RING = [];
const CONSOLE_RING_MAX = 500;
// Patterns the render pipeline uses: [render], [tile], [wheel-zoom],
// [PERF], [pre-render], STALE markers. Adjust if more subsystems need
// capture later.
const CONSOLE_CAPTURE_RE = /\[render\]|\[tile\]|\[wheel-zoom\]|\[PERF\]|\[pre-render\]|STALE|JANK/;

function _captureConsole(level, args) {
  try {
    const s = args.map(a => typeof a === 'string' ? a : (a && a.message) ? a.message : String(a)).join(' ');
    if (!CONSOLE_CAPTURE_RE.test(s)) return;
    CONSOLE_RING.push({ t: Date.now(), level, text: s });
    if (CONSOLE_RING.length > CONSOLE_RING_MAX) CONSOLE_RING.shift();
  } catch {
    // Swallow — observability MUST NOT crash the app.
  }
}

(function patchConsole() {
  const ORIG_LOG = console.log;
  const ORIG_WARN = console.warn;
  const ORIG_ERROR = console.error;
  console.log = function (...args) { _captureConsole('log', args); ORIG_LOG.apply(console, args); };
  console.warn = function (...args) { _captureConsole('warn', args); ORIG_WARN.apply(console, args); };
  console.error = function (...args) { _captureConsole('error', args); ORIG_ERROR.apply(console, args); };
})();

/** Send the response payload back to the awaiting Rust task. */
async function respond(requestId, result) {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke('app_response', { requestId, result });
  } catch (e) {
    console.warn('[mcp-bridge] app_response failed:', e);
  }
}

/** Resolve once the active document has its PDF.js doc loaded (or `timeoutMs`
 *  elapses). loadPDF is fire-and-forget here because it goes through the
 *  app's own promise queue — we have to poll for the side effect. */
async function waitForActiveLoad(targetDoc, timeoutMs = 30000) {
  const stateMod = await import('./core/state.js');
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (!stateMod.state.documents.includes(targetDoc)) return resolve(false);
      if (targetDoc.pdfDoc && !targetDoc._isLoading) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(check, 50);
    };
    check();
  });
}

/** Composite the PDF canvas + annotation/highlight overlays into a single
 *  PNG and return it as a base64 string (no `data:` prefix).
 *
 *  We deliberately do NOT capture the surrounding chrome (toolbars, panels)
 *  — the regression-test harness only cares about the page view. For a
 *  full-window grab the caller can use OS-level screenshotting. */
async function compositeCurrentView(maxWidth = 2000) {
  const pdfCanvas = document.getElementById('pdf-canvas');
  const annCanvas = document.getElementById('annotation-canvas');
  const hlCanvas  = document.getElementById('text-highlight-canvas');
  if (!pdfCanvas || pdfCanvas.width === 0 || pdfCanvas.height === 0) {
    throw new Error('pdf-canvas not visible');
  }

  // Scale the composite so the longer side fits within maxWidth (avoids
  // multi-megabyte payloads on 4K displays at 800% zoom).
  const longest = Math.max(pdfCanvas.width, pdfCanvas.height);
  const scale = longest > maxWidth ? maxWidth / longest : 1;
  const outW = Math.max(1, Math.round(pdfCanvas.width * scale));
  const outH = Math.max(1, Math.round(pdfCanvas.height * scale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  // White background so transparent regions don't read as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(pdfCanvas, 0, 0, outW, outH);
  if (hlCanvas && hlCanvas.width > 0 && hlCanvas.height > 0) {
    ctx.drawImage(hlCanvas, 0, 0, outW, outH);
  }
  if (annCanvas && annCanvas.width > 0 && annCanvas.height > 0) {
    ctx.drawImage(annCanvas, 0, 0, outW, outH);
  }
  const dataURL = out.toDataURL('image/png');
  // Strip the `data:image/png;base64,` prefix so the returned string is
  // pure base64 (matches the existing `screenshot_page` tool's shape).
  const b64 = dataURL.startsWith('data:') ? dataURL.split(',', 2)[1] : dataURL;
  return { png_base64: b64, width: outW, height: outH };
}

// ─── Per-event handlers ─────────────────────────────────────────────────

async function handleOpenPdf(params) {
  const path = params?.path;
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'missing or invalid params.path' };
  }
  const stateMod = await import('./core/state.js');
  const tabsMod = await import('./ui/chrome/tabs.js');
  const loaderMod = await import('./pdf/loader.js');

  // Reuse existing tab if the file is already open.
  let tabIndex = stateMod.findDocumentByPath(path);
  if (tabIndex === -1) {
    const { index } = tabsMod.createTab(path, false);
    tabIndex = index;
  }
  tabsMod.switchToTab(tabIndex);
  const doc = stateMod.state.documents[tabIndex];
  if (!doc.pdfDoc) {
    try {
      await loaderMod.loadPDF(path, tabIndex);
    } catch (e) {
      return { ok: false, error: `loadPDF: ${e?.message ?? e}` };
    }
  }
  const ready = await waitForActiveLoad(doc, 30000);
  if (!ready) return { ok: false, error: 'load timed out' };
  return {
    ok: true,
    tab_id:     tabIndex,
    page_count: doc.pdfDoc?.numPages ?? 0,
    file_path:  path,
  };
}

async function handleSetZoom(params) {
  const scale = Number(params?.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    return { ok: false, error: 'missing or invalid params.scale' };
  }
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try {
    await rendererMod.setZoom(scale);
  } catch (e) {
    return { ok: false, error: `setZoom: ${e?.message ?? e}` };
  }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, requested: scale, actual };
}

async function handleZoomIn() {
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try { await rendererMod.zoomIn(); } catch (e) { return { ok: false, error: `zoomIn: ${e?.message ?? e}` }; }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleZoomOut() {
  const rendererMod = await import('./pdf/renderer.js');
  const stateMod = await import('./core/state.js');
  try { await rendererMod.zoomOut(); } catch (e) { return { ok: false, error: `zoomOut: ${e?.message ?? e}` }; }
  const vp = window.__pdfViewport;
  const actual = vp?.active ? vp.zoom : (stateMod.getActiveDocument()?.scale ?? null);
  return { ok: true, actual };
}

async function handleScreenshotView(params) {
  const width = Number(params?.width) > 0 ? Number(params.width) : 2000;
  // Yield one frame so any pending zoom / paint has a chance to land.
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  try {
    const out = await compositeCurrentView(width);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: `compositeCurrentView: ${e?.message ?? e}` };
  }
}

// ─── Mouse + keyboard interaction ───────────────────────────────────────
//
// All synthetic events use `bubbles: true` and `cancelable: true` so they
// flow through the standard listener path. Coordinates are CSS pixels in
// the viewport (top-left origin), matching `MouseEvent.clientX/Y`.
//
// Button mapping per the W3C UI Events spec:
//    left=0, middle=1, right=2 (the `button` field)
//    left=1, right=2, middle=4 (the `buttons` bitmask sent during
//    in-flight drags so listeners that gate on `e.buttons` still fire).

const BUTTON_INDEX = { left: 0, middle: 1, right: 2 };
const BUTTONS_MASK = { left: 1, middle: 4, right: 2 };

function buttonIndexFor(name) {
  if (name == null) return 0;
  const v = BUTTON_INDEX[String(name).toLowerCase()];
  return typeof v === 'number' ? v : 0;
}
function buttonsMaskFor(name) {
  if (name == null) return 1;
  const v = BUTTONS_MASK[String(name).toLowerCase()];
  return typeof v === 'number' ? v : 1;
}

/** Build a MouseEventInit with the standard fields populated. */
function makeMouseInit(x, y, opts = {}) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 0,
    ctrlKey: !!opts.ctrlKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    metaKey: !!opts.metaKey,
    relatedTarget: opts.relatedTarget ?? null,
  };
}

/** elementFromPoint can return null if the coords are off-screen — fall
 *  back to document.body so the dispatch still has a target. */
function targetAt(x, y) {
  return document.elementFromPoint(x, y) ?? document.body;
}

function describeTarget(el) {
  if (!el) return null;
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    id: el.id || null,
    classes: el.className && typeof el.className === 'string'
      ? el.className.split(/\s+/).filter(Boolean)
      : [],
  };
}

async function handleMouseMove(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const target = targetAt(x, y);
  const ev = new MouseEvent('mousemove', makeMouseInit(x, y, { buttons: 0 }));
  target.dispatchEvent(ev);
  return { ok: true, x, y, target: describeTarget(target) };
}

async function handleMouseClick(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const buttonName = (params?.button ?? 'left');
  const button = buttonIndexFor(buttonName);
  const buttonsMask = buttonsMaskFor(buttonName);
  const target = targetAt(x, y);

  // Standard sequence: mousemove -> mousedown -> mouseup -> click
  // (or contextmenu for right button).
  target.dispatchEvent(new MouseEvent('mousemove',
    makeMouseInit(x, y, { button: 0, buttons: 0 })));
  target.dispatchEvent(new MouseEvent('mousedown',
    makeMouseInit(x, y, { button, buttons: buttonsMask })));
  target.dispatchEvent(new MouseEvent('mouseup',
    makeMouseInit(x, y, { button, buttons: 0 })));

  if (buttonName === 'right') {
    target.dispatchEvent(new MouseEvent('contextmenu',
      makeMouseInit(x, y, { button, buttons: 0 })));
  } else {
    target.dispatchEvent(new MouseEvent('click',
      makeMouseInit(x, y, { button, buttons: 0 })));
  }
  return { ok: true, x, y, button: buttonName, target: describeTarget(target) };
}

async function handleMouseDrag(params) {
  const x1 = Number(params?.x1);
  const y1 = Number(params?.y1);
  const x2 = Number(params?.x2);
  const y2 = Number(params?.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return { ok: false, error: 'missing or invalid params.x1/y1/x2/y2' };
  }
  const buttonName = (params?.button ?? 'left');
  const button = buttonIndexFor(buttonName);
  const buttonsMask = buttonsMaskFor(buttonName);
  const steps = Math.max(1, Math.min(200, Number(params?.steps) || 10));

  const startTarget = targetAt(x1, y1);
  // mousedown at start
  startTarget.dispatchEvent(new MouseEvent('mousedown',
    makeMouseInit(x1, y1, { button, buttons: buttonsMask })));

  // Interpolated mousemoves. We dispatch each move on the element under
  // that point so hit-testing works as the cursor crosses widgets.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const t2 = targetAt(x, y);
    t2.dispatchEvent(new MouseEvent('mousemove',
      makeMouseInit(x, y, { button, buttons: buttonsMask })));
    // Yield occasionally so pointer-driven raf loops can keep up.
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const endTarget = targetAt(x2, y2);
  endTarget.dispatchEvent(new MouseEvent('mouseup',
    makeMouseInit(x2, y2, { button, buttons: 0 })));
  // Some apps rely on a click after the up. We send it only for left
  // button to avoid spurious context menus.
  if (buttonName === 'left' && (x1 === x2 && y1 === y2)) {
    endTarget.dispatchEvent(new MouseEvent('click',
      makeMouseInit(x2, y2, { button, buttons: 0 })));
  }
  return {
    ok: true,
    from: { x: x1, y: y1 },
    to:   { x: x2, y: y2 },
    button: buttonName,
    steps,
    end_target: describeTarget(endTarget),
  };
}

async function handleScroll(params) {
  const x = Number(params?.x);
  const y = Number(params?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'missing or invalid params.x/y' };
  }
  const dx = Number(params?.dx) || 0;
  const dy = Number(params?.dy) || 0;
  const target = targetAt(x, y);
  const ev = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    deltaX: dx,
    deltaY: dy,
    deltaZ: 0,
    deltaMode: 0, // DOM_DELTA_PIXEL
    ctrlKey: !!params?.ctrlKey,
    shiftKey: !!params?.shiftKey,
    altKey: !!params?.altKey,
    metaKey: !!params?.metaKey,
  });
  target.dispatchEvent(ev);
  return {
    ok: true,
    x, y, dx, dy,
    ctrlKey: !!params?.ctrlKey,
    target: describeTarget(target),
  };
}

/** Map a single character to the W3C `KeyboardEvent.code` value (best
 *  effort — only used as a hint, not gating logic). */
function codeForChar(ch) {
  if (!ch) return '';
  const upper = ch.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^[0-9]$/.test(upper)) return `Digit${upper}`;
  if (ch === ' ') return 'Space';
  return '';
}

/** Build a KeyboardEventInit used for both keydown and keyup. */
function makeKeyInit(key, opts = {}) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    key,
    code: opts.code ?? codeForChar(key.length === 1 ? key : ''),
    location: 0,
    repeat: false,
    isComposing: false,
    ctrlKey: !!opts.ctrlKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    metaKey: !!opts.metaKey,
  };
}

async function handleKey(params) {
  const key = params?.key;
  if (typeof key !== 'string' || !key) {
    return { ok: false, error: 'missing or invalid params.key' };
  }
  const init = {
    ctrlKey: !!params?.ctrl,
    shiftKey: !!params?.shift,
    altKey: !!params?.alt,
    metaKey: !!params?.meta,
  };
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', makeKeyInit(key, init)));
  target.dispatchEvent(new KeyboardEvent('keyup',   makeKeyInit(key, init)));
  return { ok: true, key, modifiers: init, target: describeTarget(target) };
}

async function handleType(params) {
  const text = params?.text;
  if (typeof text !== 'string') {
    return { ok: false, error: 'missing or invalid params.text' };
  }

  let typed = 0;
  for (const ch of text) {
    const target = document.activeElement ?? document.body;
    const init = makeKeyInit(ch, {});
    target.dispatchEvent(new KeyboardEvent('keydown', init));

    // beforeinput + input fire on text inputs so framework controls update.
    // We only inject text into editable controls — refusing to mangle
    // arbitrary DOM text content.
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    const isEditable = (tag === 'input' || tag === 'textarea' ||
                       target.isContentEditable === true);
    if (isEditable) {
      try {
        target.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true,
          inputType: 'insertText', data: ch,
        }));
        if (tag === 'input' || tag === 'textarea') {
          // Manually splice into value so frameworks observing `value`
          // (like SolidJS) see the change. For native fields the spec says
          // the browser maintains value, but synthetic events bypass that.
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? target.value.length;
          target.value = target.value.slice(0, start) + ch + target.value.slice(end);
          const pos = start + ch.length;
          try { target.setSelectionRange(pos, pos); } catch { /* readonly */ }
        } else {
          // contentEditable: insert via execCommand fallback.
          if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, ch);
          }
        }
        target.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: false,
          inputType: 'insertText', data: ch,
        }));
      } catch (e) {
        // best-effort: continue typing
      }
    }
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    typed++;
  }
  return { ok: true, typed };
}

async function handleGetViewportState() {
  // Probe the current viewport state for testing math (zoom-to-cursor,
  // smooth scrolling, etc). Returns the singleton viewport's transform
  // plus canvas + container dimensions so callers can map screen↔world.
  // Also includes render-engine status, tile-overlay state, and the active
  // document scale/page — everything an AI/MCP client needs to observe a
  // zoom/scroll/pan sequence.
  const vp = window.__pdfViewport;
  const pdfCanvas = document.getElementById('pdf-canvas');
  const tileCanvas = document.getElementById('pdf-canvas-tile');
  const container = document.getElementById('pdf-container') || pdfCanvas?.parentElement;
  const cRect = container?.getBoundingClientRect();
  const pRect = pdfCanvas?.getBoundingClientRect();
  const tRect = tileCanvas?.getBoundingClientRect();

  // Pull state.renderEngine + state.renderTiming from the central app state
  // (set by renderer.js after each render). Critical for verifying that
  // PDFium (NOT PDF.js) is the engine actually drawing the page.
  let renderEngine = null;
  let renderTiming = null;
  let docScale = null;
  let activeDocPath = null;
  let activePageNum = null;
  let viewMode = null;
  try {
    const stateMod = await import('/js/core/state.ts');
    renderEngine = stateMod.state?.renderEngine ?? null;
    renderTiming = stateMod.state?.renderTiming ?? null;
    const doc = stateMod.state?.documents?.[stateMod.state.activeDocumentIndex];
    docScale = doc?.scale ?? null;
    activeDocPath = doc?.filePath ?? null;
    activePageNum = doc?.currentPage ?? null;
    viewMode = doc?.viewMode ?? null;
  } catch {
    // Module may not be loaded yet; leave fields null.
  }

  return {
    ok: true,
    // Engine + timing — what the user sees in the status-bar chip.
    engine: renderEngine,
    renderTiming,
    // Active document at the moment of the snapshot.
    doc: {
      filePath: activeDocPath,
      scale: docScale,
      currentPage: activePageNum,
      viewMode,
    },
    // viewport singleton (pdf-viewport.js): the transform that maps world→screen
    viewport: vp ? {
      active: !!vp.active,
      zoom: vp.zoom ?? null,
      offsetX: vp.offsetX ?? null,
      offsetY: vp.offsetY ?? null,
      pageW: vp.pageW ?? null,
      pageH: vp.pageH ?? null,
      filePath: vp.filePath ?? null,
      pageNum: vp.pageNum ?? null,
    } : null,
    // The main canvas backing store
    canvas: pdfCanvas ? {
      width: pdfCanvas.width,
      height: pdfCanvas.height,
      cssWidth: pRect?.width ?? null,
      cssHeight: pRect?.height ?? null,
      cssLeft: pRect?.left ?? null,
      cssTop: pRect?.top ?? null,
    } : null,
    // High-zoom tile overlay (pdf-canvas-tile). When `display !== 'none'`
    // the tile is showing a crisp render of the visible viewport region
    // on top of the cap-stretched main canvas.
    tile: tileCanvas ? {
      display: tileCanvas.style?.display || 'block',
      visible: (tileCanvas.style?.display || 'block') !== 'none',
      width: tileCanvas.width,
      height: tileCanvas.height,
      cssWidth: tRect?.width ?? null,
      cssHeight: tRect?.height ?? null,
      cssLeft: tileCanvas.style?.left || null,
      cssTop: tileCanvas.style?.top || null,
    } : null,
    // The container (visible scrollable area)
    container: cRect ? {
      width: cRect.width,
      height: cRect.height,
      left: cRect.left,
      top: cRect.top,
      scrollLeft: container?.scrollLeft ?? null,
      scrollTop: container?.scrollTop ?? null,
    } : null,
    devicePixelRatio: window.devicePixelRatio ?? 1,
  };
}

async function handleGetRecentConsole(params) {
  // Return the recent capture-buffer of console messages. Defaults to all
  // 500 entries. Filter via `params.since` (epoch-ms cutoff) or
  // `params.tail` (last N entries) to limit volume.
  const since = (params && typeof params.since === 'number') ? params.since : 0;
  const tail = (params && typeof params.tail === 'number') ? params.tail : 0;

  let entries = CONSOLE_RING;
  if (since > 0) entries = entries.filter(e => e.t >= since);
  if (tail > 0 && entries.length > tail) entries = entries.slice(-tail);

  return {
    ok: true,
    serverTimeMs: Date.now(),
    bufferSize: CONSOLE_RING.length,
    bufferMax: CONSOLE_RING_MAX,
    entries: entries.map(e => ({
      t: e.t,
      deltaMs: Date.now() - e.t,
      level: e.level,
      text: e.text,
    })),
  };
}

const HANDLERS = {
  'mcp:open-pdf':           handleOpenPdf,
  'mcp:set-zoom':           handleSetZoom,
  'mcp:zoom-in':            handleZoomIn,
  'mcp:zoom-out':           handleZoomOut,
  'mcp:screenshot-view':    handleScreenshotView,
  'mcp:mouse-move':         handleMouseMove,
  'mcp:mouse-click':        handleMouseClick,
  'mcp:mouse-drag':         handleMouseDrag,
  'mcp:scroll':             handleScroll,
  'mcp:key':                handleKey,
  'mcp:type':               handleType,
  'mcp:get-viewport-state': handleGetViewportState,
  'mcp:get-recent-console': handleGetRecentConsole,
};

/** Wire up all `mcp:*` listeners. Safe to call once at startup. Becomes
 *  a no-op when Tauri isn't present (browser dev mode). */
export async function initMcpBridge() {
  if (!window.__TAURI__?.core?.invoke) {
    // Definitely not in Tauri.
    return;
  }

  // Resolve the event API. Prefer the global, fall back to the npm
  // module so we still work if `withGlobalTauri` is ever turned off.
  let ev = window.__TAURI__?.event;
  if (!ev) {
    try {
      ev = await import('@tauri-apps/api/event');
    } catch (e) {
      console.warn('[mcp-bridge] event API unavailable:', e);
      return;
    }
  }

  const wired = [];
  for (const [name, handler] of Object.entries(HANDLERS)) {
    try {
      await ev.listen(name, async (event) => {
        const payload = event?.payload ?? {};
        const requestId = payload.request_id;
        const params = payload.params ?? {};
        if (typeof requestId !== 'number') {
          console.warn('[mcp-bridge] missing request_id in', name, payload);
          return;
        }
        let result;
        try {
          result = await handler(params);
        } catch (e) {
          console.warn('[mcp-bridge] handler threw for', name, e);
          result = { ok: false, error: `${e?.message ?? e}` };
        }
        await respond(requestId, result);
      });
      wired.push(name);
    } catch (e) {
      console.warn('[mcp-bridge] listen failed for', name, e);
    }
  }
  window.__mcpBridgeReady = true;
  window.__mcpBridgeEvents = wired;
  console.log('[mcp-bridge] ready, events:', wired);
  // Notify the Rust side so we can confirm wire-up from outside the WebView
  // (devtools console isn't visible when launched headless).
  try {
    await window.__TAURI__.core.invoke('mcp_bridge_ready', { events: wired });
  } catch {
    /* harmless when running against an older binary without the cmd */
  }
}
