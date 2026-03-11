/**
 * Hand tool — pan, select, drag, resize annotations
 */
export const handTool = {
  name: 'hand',
  cursor: 'grab',

  onPointerDown(ctx, e) {
    const { x, y, state, canvas } = ctx;

    // Check for resize handle on selected annotation
    const selAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (selAnn) {
      const handleType = ctx.findHandleAt(x, y, selAnn);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.dragStartX = x;
        state.dragStartY = y;
        state.originalAnnotation = ctx.cloneAnnotation(selAnn);
        canvas.style.cursor = ctx.getCursorForHandle(handleType, selAnn.rotation, selAnn);
        return;
      }
    }

    const clickedAnnotation = ctx.findAnnotationAt(x, y);
    if (clickedAnnotation) {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: initiate Ctrl+drag copy
        if (ctx.isSelected(clickedAnnotation)) {
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          state.originalAnnotations = state.selectedAnnotations.map(a => ctx.cloneAnnotation(a));
          if (state.selectedAnnotations.length === 1) {
            state.originalAnnotation = ctx.cloneAnnotation(state.selectedAnnotations[0]);
          }
          canvas.style.cursor = 'copy';
        } else {
          ctx.addToSelection(clickedAnnotation);
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          state.originalAnnotations = state.selectedAnnotations.map(a => ctx.cloneAnnotation(a));
          if (state.selectedAnnotations.length === 1) {
            state.originalAnnotation = ctx.cloneAnnotation(state.selectedAnnotations[0]);
          }
          canvas.style.cursor = 'copy';
        }
        if (state.selectedAnnotations.length === 1) {
          ctx.showProperties(state.selectedAnnotations[0]);
        } else if (state.selectedAnnotations.length > 1) {
          ctx.showMultiSelectionProperties();
        } else {
          ctx.hideProperties();
        }
      } else {
        state.selectedAnnotations = [clickedAnnotation];
        ctx.showProperties(clickedAnnotation);
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (!isTextMarkup) {
          state.isDragging = true;
          state.dragStartX = x;
          state.dragStartY = y;
          state.originalAnnotation = ctx.cloneAnnotation(clickedAnnotation);
          state.originalAnnotations = [ctx.cloneAnnotation(clickedAnnotation)];
          canvas.style.cursor = 'move';
        }
      }
      ctx.redraw();
    } else {
      ctx.clearSelection();
      ctx.hideProperties();
      if (state.viewMode === 'continuous') {
        ctx.startContinuousPan(e, false);
      } else {
        ctx.startPan(e, false);
      }
      ctx.redraw();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvas } = ctx;

    // Hover: show resize cursors on handles or annotation hover cursor
    const hoverAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (hoverAnn) {
      const handleType = ctx.findHandleAt(x, y, hoverAnn);
      if (handleType) {
        canvas.style.cursor = ctx.getCursorForHandle(handleType, hoverAnn.rotation, hoverAnn);
        return;
      }
    }
    const hoverAnnotation = ctx.findAnnotationAt(x, y);
    canvas.style.cursor = hoverAnnotation ? 'default' : 'grab';
    canvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text)
      ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
  },
};
