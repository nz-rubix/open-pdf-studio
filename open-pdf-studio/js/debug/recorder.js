// Action recorder — captures user input + selected app-state snapshots into
// an in-memory buffer so a debugging session can replay or inspect WHAT the
// user did and WHEN, without needing to be live-attached. Drives the
// `mcp:record-*` family of bridge handlers (and the F4 / "REC" chord
// keyboard shortcuts in keyboard-handlers.js).
//
// The buffer is bounded so a long-running recording can't OOM the WebView.
// When the cap is reached we shift() older events off the front — recent
// events are always more useful than ancient ones for "what just happened".
//
// Events stored:
//   mousedown / mouseup / mousemove (throttled) / click / dblclick
//   wheel
//   keydown / keyup
//   scroll  (on #pdf-container)
//
// Each entry has: { t: ms-since-start, type, ...payload }. The "heavier"
// events (mousedown/up, wheel, start, stop) carry a thin `state` snapshot
// so post-hoc analysis can correlate user input with viewport state.

const MAX_EVENTS = 5000;

const state = {
  active: false,
  startedAt: 0,
  events: [],
  _lastMoveT: 0,
};

const MOVE_THROTTLE_MS = 33; // ~30 Hz

function describeTarget(el) {
  if (!el) return null;
  return {
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    id: el.id || null,
    classes: el.className && typeof el.className === 'string'
      ? el.className.split(/\s+/).filter(Boolean).slice(0, 4)
      : [],
  };
}

function captureState() {
  const out = { zoom: null, offsetX: null, offsetY: null, page: null, scrollTop: null, scrollLeft: null, viewMode: null };
  try {
    const vp = window.__pdfViewport;
    if (vp?.active) {
      out.zoom = vp.zoom ?? null;
      out.offsetX = vp.offsetX ?? null;
      out.offsetY = vp.offsetY ?? null;
    }
    const cont = document.getElementById('pdf-container');
    if (cont) {
      out.scrollTop = cont.scrollTop;
      out.scrollLeft = cont.scrollLeft;
    }
  } catch { /* observability MUST NOT throw */ }
  return out;
}

function push(type, payload, withState = false) {
  if (!state.active) return;
  const ev = { t: Date.now() - state.startedAt, type, ...payload };
  if (withState) ev.state = captureState();
  state.events.push(ev);
  if (state.events.length > MAX_EVENTS) state.events.shift();
}

function onMouseDown(e) {
  push('mousedown', {
    x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons,
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey,
    target: describeTarget(e.target),
  }, true);
}
function onMouseUp(e) {
  push('mouseup', {
    x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons,
    target: describeTarget(e.target),
  }, true);
}
function onMouseMove(e) {
  const now = performance.now();
  if (now - state._lastMoveT < MOVE_THROTTLE_MS) return;
  state._lastMoveT = now;
  push('mousemove', { x: e.clientX, y: e.clientY, buttons: e.buttons });
}
function onClick(e) {
  push('click', { x: e.clientX, y: e.clientY, button: e.button, target: describeTarget(e.target) });
}
function onDblClick(e) {
  push('dblclick', { x: e.clientX, y: e.clientY, target: describeTarget(e.target) });
}
function onWheel(e) {
  push('wheel', {
    x: e.clientX, y: e.clientY,
    deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey,
  }, true);
}
function onKeyDown(e) {
  push('keydown', {
    key: e.key, code: e.code,
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    repeat: !!e.repeat,
    target: describeTarget(e.target),
  });
}
function onKeyUp(e) {
  push('keyup', { key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
}
function onScroll(e) {
  const el = e.target;
  if (el && el.id === 'pdf-container') {
    push('scroll', { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
  }
}

let _listenersAttached = false;
function attach() {
  if (_listenersAttached) return;
  _listenersAttached = true;
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onDblClick, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('scroll', onScroll, true);
}
function detach() {
  if (!_listenersAttached) return;
  _listenersAttached = false;
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('dblclick', onDblClick, true);
  document.removeEventListener('wheel', onWheel, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('keyup', onKeyUp, true);
  document.removeEventListener('scroll', onScroll, true);
}

export function startRecording() {
  if (state.active) return getRecording();
  state.active = true;
  state.startedAt = Date.now();
  state.events = [];
  state._lastMoveT = 0;
  attach();
  push('start', { startedAt: state.startedAt }, true);
  try { window.dispatchEvent(new CustomEvent('recorder:state', { detail: { active: true } })); } catch {}
  return getRecording();
}

export function stopRecording() {
  if (!state.active) return getRecording();
  push('stop', { stoppedAt: Date.now() }, true);
  const result = getRecording();
  state.active = false;
  detach();
  try { window.dispatchEvent(new CustomEvent('recorder:state', { detail: { active: false } })); } catch {}
  return result;
}

export function toggleRecording() {
  return state.active ? stopRecording() : startRecording();
}

export function getRecording(opts = {}) {
  const since = Number(opts?.since) || 0;
  const tail = Number(opts?.tail) || 0;
  let entries = state.events;
  if (since > 0) entries = entries.filter(e => e.t >= since);
  if (tail > 0 && entries.length > tail) entries = entries.slice(-tail);
  return {
    active: state.active,
    startedAt: state.startedAt || null,
    durationMs: state.active ? Date.now() - state.startedAt : null,
    eventCount: state.events.length,
    bufferCap: MAX_EVENTS,
    entries,
  };
}

export function clearRecording() {
  state.events = [];
  return { ok: true, cleared: true, active: state.active };
}

export function isRecording() { return state.active; }

try { window.__recorder = { isRecording, toggleRecording, startRecording, stopRecording, getRecording, clearRecording }; } catch {}
