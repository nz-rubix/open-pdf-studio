/**
 * Select tool — click-select, rubber band, drag, resize, Ctrl+drag copy
 * Also used for selectComments tool (same behavior)
 */
export const selectTool = {
  name: 'select',
  cursor: 'default',

  onPointerDown(ctx, e) {
    const { x, y, state, canvas } = ctx;
    const pdfaLocked = ctx.isPdfAReadOnly();

    // Check resize handle on selected annotation
    const selAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (!pdfaLocked && selAnn) {
      const handleType = ctx.findHandleAt(x, y, selAnn);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.originalAnnotation = ctx.cloneAnnotation(selAnn);
        canvas.style.cursor = ctx.getCursorForHandle(handleType, selAnn.rotation, selAnn);
        return;
      }
    }

    const clickedAnnotation = ctx.findAnnotationAt(x, y);
    if (clickedAnnotation) {
      // Double-click to edit textbox/callout
      if (!pdfaLocked && e.detail === 2 && ['textbox', 'callout'].includes(clickedAnnotation.type)) {
        ctx.startTextEditing(clickedAnnotation);
        return;
      }

      // Click on comment: open popup
      if (clickedAnnotation.type === 'comment') {
        state.selectedAnnotations = [clickedAnnotation];
        ctx.showProperties(clickedAnnotation);
        ctx.openStickyPopup(clickedAnnotation);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (ctx.isSelected(clickedAnnotation)) {
          // Ctrl+click on already selected: initiate Ctrl+drag copy
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = state.selectedAnnotations.map(a => ctx.cloneAnnotation(a));
            if (state.selectedAnnotations.length === 1) {
              state.originalAnnotation = ctx.cloneAnnotation(state.selectedAnnotations[0]);
            }
            canvas.style.cursor = 'copy';
          }
        } else {
          // Ctrl+click on unselected: add and allow drag
          ctx.addToSelection(clickedAnnotation);
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = state.selectedAnnotations.map(a => ctx.cloneAnnotation(a));
            if (state.selectedAnnotations.length === 1) {
              state.originalAnnotation = ctx.cloneAnnotation(state.selectedAnnotations[0]);
            }
            canvas.style.cursor = 'copy';
          }
        }
        if (state.selectedAnnotations.length === 1) {
          ctx.showProperties(state.selectedAnnotations[0]);
        } else if (state.selectedAnnotations.length > 1) {
          ctx.showMultiSelectionProperties();
        } else {
          ctx.hideProperties();
        }
        ctx.redraw();
      } else {
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (ctx.isSelected(clickedAnnotation) && state.selectedAnnotations.length > 1) {
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotations = state.selectedAnnotations.map(a => ctx.cloneAnnotation(a));
            canvas.style.cursor = 'move';
          }
        } else {
          state.selectedAnnotations = [clickedAnnotation];
          ctx.showProperties(clickedAnnotation);
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotation = ctx.cloneAnnotation(clickedAnnotation);
            state.originalAnnotations = [ctx.cloneAnnotation(clickedAnnotation)];
            canvas.style.cursor = 'move';
          }
        }
      }
    } else {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click on empty space: keep selection
      } else {
        // Start rubber band selection
        state.isRubberBanding = true;
        state.rubberBandStartX = x;
        state.rubberBandStartY = y;
        ctx.clearSelection();
        ctx.hideProperties();
        ctx.redraw();
      }
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvas, canvasCtx } = ctx;

    // Rubber band drawing
    if (state.isRubberBanding) {
      ctx.redraw();
      canvasCtx.save();
      canvasCtx.scale(state.scale, state.scale);
      canvasCtx.strokeStyle = '#0066cc';
      canvasCtx.lineWidth = 1 / state.scale;
      canvasCtx.setLineDash([4 / state.scale, 4 / state.scale]);
      canvasCtx.fillStyle = 'rgba(0, 102, 204, 0.1)';
      const rbX = Math.min(state.rubberBandStartX, x);
      const rbY = Math.min(state.rubberBandStartY, y);
      const rbW = Math.abs(x - state.rubberBandStartX);
      const rbH = Math.abs(y - state.rubberBandStartY);
      canvasCtx.fillRect(rbX, rbY, rbW, rbH);
      canvasCtx.strokeRect(rbX, rbY, rbW, rbH);
      canvasCtx.setLineDash([]);
      canvasCtx.restore();
      return;
    }

    // Hover: show handle cursors
    const hoverAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (hoverAnn) {
      const handleType = ctx.findHandleAt(x, y, hoverAnn);
      if (handleType) {
        canvas.style.cursor = ctx.getCursorForHandle(handleType, hoverAnn.rotation, hoverAnn);
        return;
      }
    }
    const hoverAnnotation = ctx.findAnnotationAt(x, y);
    canvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text)
      ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
    canvas.style.cursor = 'default';
  },

  onPointerUp(ctx, e) {
    const { x, y, state } = ctx;

    // Rubber band selection end
    if (state.isRubberBanding) {
      state.isRubberBanding = false;

      const rbX = Math.min(state.rubberBandStartX, x);
      const rbY = Math.min(state.rubberBandStartY, y);
      const rbW = Math.abs(x - state.rubberBandStartX);
      const rbH = Math.abs(y - state.rubberBandStartY);

      if (rbW > 3 || rbH > 3) {
        const selected = [];
        for (const ann of state.annotations) {
          if (ann.page !== ctx.pageNum) continue;
          const bounds = ctx.getAnnotationBounds(ann);
          if (!bounds) continue;
          if (bounds.x < rbX + rbW && bounds.x + bounds.width > rbX &&
              bounds.y < rbY + rbH && bounds.y + bounds.height > rbY) {
            selected.push(ann);
          }
        }
        if (selected.length > 0) {
          state.selectedAnnotations = selected;
          if (selected.length === 1) {
            ctx.showProperties(selected[0]);
          } else {
            ctx.showMultiSelectionProperties();
          }
        }
      }
      ctx.redraw();
      return true; // handled
    }
    return false; // not handled — let dispatcher do drag/resize finalization
  },
};
