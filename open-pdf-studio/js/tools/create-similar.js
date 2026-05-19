// CS (Create Similar) — copy the selected annotation's style and switch to
// its drawing tool so the next draw produces the same visual result.
//
// Inspired by AutoCAD's "COPYM"/"COPY" command family. Triggered from
// keyboard-handlers.js via the CAD chord "cs". Quietly no-ops when no
// annotation is selected or when the annotation type has no obvious draw
// tool.

import { state, getActiveDocument } from '../core/state.js';
import { setTool } from './manager.js';

// Map of annotation type → tool name to activate. Most annotation types
// match a tool name 1:1 (line→line, box→box, arrow→arrow, etc.) — listed
// here only if the mapping diverges.
const TYPE_TO_TOOL = {
  freetext: 'textbox',   // legacy "freetext" type uses the textbox tool
  freeText: 'textbox',
  free_text: 'textbox',
  ellipse: 'circle',     // ellipse annotations come from the circle tool
  squiggly: 'highlight', // best draw-tool match
  underline: 'highlight',
  strikeout: 'highlight',
};

// Props we copy from the source annotation onto state.toolOverrides. Each
// tool reads a subset of these in annotation-creators.js / its own tool
// module. Anything missing on the source is simply not copied (the tool
// falls back to its normal prefs default).
const STYLE_PROPS = [
  'color', 'strokeColor', 'fillColor',
  'lineWidth', 'opacity', 'borderStyle',
  'startHead', 'endHead', 'headSize',
  'fontFamily', 'fontSize', 'fontColor', 'textAlign',
  'fillType', 'hatchPattern', 'hatchScale', 'hatchAngle',
  'arcRadius', 'cloudRadius',
  'subject',
];

/**
 * Trigger Create Similar on whatever annotation is currently selected.
 * Returns true if a tool switch happened, false otherwise (no selection,
 * unknown type, etc).
 */
export function startCreateSimilar() {
  const doc = getActiveDocument();
  if (!doc) return false;

  // Pick source: prefer the first of selectedAnnotations[], fall back to
  // singular selectedAnnotation. Both are populated by select-tool.js.
  const sel = (doc.selectedAnnotations && doc.selectedAnnotations[0])
    || doc.selectedAnnotation
    || null;
  if (!sel || !sel.type) return false;

  const toolName = TYPE_TO_TOOL[sel.type] || sel.type;

  // Build overrides object from whatever style props the source has.
  const overrides = {};
  for (const k of STYLE_PROPS) {
    if (sel[k] !== undefined && sel[k] !== null) overrides[k] = sel[k];
  }

  // setTool() resets state.toolOverrides to null when switching (unless the
  // target tool is 'stamp'). So order matters: switch first, override second.
  try {
    setTool(toolName);
  } catch (_) {
    // Unknown tool name — silently abort. User sees no-op which is preferable
    // to a thrown error from a keystroke.
    return false;
  }

  // Only set toolOverrides if we actually have style to carry over. This
  // keeps the "Active" highlight on the tool button correct in ToolPalette
  // (which checks `state.toolOverrides == null` for the base-active state).
  if (Object.keys(overrides).length > 0) {
    state.toolOverrides = overrides;
  }

  return true;
}
