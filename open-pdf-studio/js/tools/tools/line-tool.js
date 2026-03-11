/**
 * Line tool — handles line, arrow
 * Uses same drag-to-create pattern as shape-tool but for line-type annotations
 */
import { shapeTool } from './shape-tool.js';

// Line and arrow share the exact same behavior as shape tools
// (buildAnnotationProps handles angle snapping internally)
export const lineTool = { ...shapeTool, name: 'line', cursor: 'crosshair' };
