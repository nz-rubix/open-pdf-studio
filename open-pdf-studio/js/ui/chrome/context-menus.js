import { state, isSelected } from '../../core/state.js';
import { annotationCanvas } from '../dom-elements.js';
import { setTool } from '../../tools/manager.js';
import { recordAdd } from '../../core/undo-manager.js';
import {
  showAnnotationMenu, showMultiAnnotationMenu, showPageMenu,
  showTextSelectionMenu, hideMenu,
} from '../../bridge.js';

export function showContextMenu(e, annotation) {
  e.preventDefault();
  const isMultiSelect = state.selectedAnnotations.length > 1 && isSelected(annotation);
  if (isMultiSelect) {
    showMultiAnnotationMenu(e.clientX, e.clientY, state.selectedAnnotations.length);
  } else {
    showAnnotationMenu(e.clientX, e.clientY, annotation);
  }
}

export function showPageContextMenu(e) {
  e.preventDefault();
  showPageMenu(e.clientX, e.clientY);
}

export function showTextSelectionContextMenu(e) {
  e.preventDefault();
  showTextSelectionMenu(e.clientX, e.clientY);
}

export function hideContextMenu() {
  hideMenu();
}

export function initContextMenus() {
  document.addEventListener('contextmenu', (e) => {
    const nonDrawTools = ['select', 'hand'];
    // Check if any multi-click tool is in progress
    const isMultiClickActive = state.isDrawingPolyline || state.isDrawingCloudPolyline ||
      state.isDrawingDimension || (state.measurePoints && state.measurePoints.length >= 1);
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !isMultiClickActive) {
      e.preventDefault();
      e.stopPropagation();
      setTool('hand');
    }
  }, true);

  if (annotationCanvas) {
    annotationCanvas.addEventListener('contextmenu', (e) => {
      if (!state.pdfDoc) return;

      // Let tool handle its own right-click behavior (polyline finish, measurement finish, etc.)
      // These are handled via the pointerdown handler with e.button === 2
      const isMultiClickActive = state.isDrawingPolyline || state.isDrawingCloudPolyline ||
        state.isDrawingDimension || (state.measurePoints && state.measurePoints.length >= 1);
      if (isMultiClickActive) {
        e.preventDefault();
        return;
      }

      const rect = annotationCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.scale;
      const y = (e.clientY - rect.top) / state.scale;

      import('../../annotations/geometry.js').then(({ findAnnotationAt }) => {
        const annotation = findAnnotationAt(x, y);
        if (annotation) {
          showContextMenu(e, annotation);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
