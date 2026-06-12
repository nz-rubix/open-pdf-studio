import { createSignal, createMemo, createEffect, Show, For, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { createBlankPDF, createDocFromTemplate } from '../../../pdf/loader.js';
import { scanFrames, openFramesFolder } from '../../../pdf/frames.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const PAPER_SIZES = {
  a0:      { width: 2384, height: 3370, label: 'A0', widthMm: 841, heightMm: 1189 },
  a1:      { width: 1684, height: 2384, label: 'A1', widthMm: 594, heightMm: 841 },
  a2:      { width: 1191, height: 1684, label: 'A2', widthMm: 420, heightMm: 594 },
  a3:      { width: 842,  height: 1191, label: 'A3', widthMm: 297, heightMm: 420 },
  a4:      { width: 595,  height: 842,  label: 'A4', widthMm: 210, heightMm: 297 },
  a5:      { width: 420,  height: 595,  label: 'A5', widthMm: 148, heightMm: 210 },
  a6:      { width: 298,  height: 420,  label: 'A6', widthMm: 105, heightMm: 148 },
  b3:      { width: 1001, height: 1417, label: 'B3', widthMm: 353, heightMm: 500 },
  b4:      { width: 709,  height: 1001, label: 'B4', widthMm: 250, heightMm: 353 },
  b5:      { width: 499,  height: 709,  label: 'B5', widthMm: 176, heightMm: 250 },
  letter:  { width: 612,  height: 792,  label: 'Letter', widthMm: 216, heightMm: 279 },
  legal:   { width: 612,  height: 1008, label: 'Legal', widthMm: 216, heightMm: 356 },
  tabloid: { width: 792,  height: 1224, label: 'Tabloid', widthMm: 279, heightMm: 432 },
  ledger:  { width: 1224, height: 792,  label: 'Ledger', widthMm: 432, heightMm: 279 },
};

export { PAPER_SIZES };

export default function NewDocDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [paperSize, setPaperSize] = createSignal('a4');
  const [orientation, setOrientation] = createSignal('portrait');
  const [numPages, setNumPages] = createSignal(1);
  const [customWidth, setCustomWidth] = createSignal(210);
  const [customHeight, setCustomHeight] = createSignal(297);
  // OpenAEC frame styles: pick a STIJL (detailblad / voorblad / grootformaat
  // / any new prefix found on disk); the paper-size + orientation controls
  // below then resolve WHICH frame PDF is used. '' = blanco document.
  const [frameIndex, setFrameIndex] = createSignal(null); // { stijlen, byStijl }
  const [stijl, setStijl] = createSignal('');

  onMount(async () => {
    try {
      setFrameIndex(await scanFrames());
    } catch (e) {
      console.warn('[new-doc] kaders niet leesbaar:', e);
    }
  });

  const stijlGroup = () => {
    const idx = frameIndex();
    return idx && stijl() ? idx.byStijl.get(stijl()) : null;
  };
  // Formats available for the chosen style ('' → all standard sizes)
  const availableFormats = createMemo(() => {
    const g = stijlGroup();
    if (!g) return null;
    return [...g.formaten].sort();
  });
  const orientationAvailable = (orient) => {
    const g = stijlGroup();
    if (!g) return true;
    const richting = orient === 'landscape' ? 'liggend' : 'staand';
    return g.byKey.has(`${paperSize()}|${richting}`);
  };
  const resolvedFrame = () => {
    const g = stijlGroup();
    if (!g) return null;
    const richting = orientation() === 'landscape' ? 'liggend' : 'staand';
    return g.byKey.get(`${paperSize()}|${richting}`) || null;
  };

  // Keep paper size + orientation valid for the chosen style.
  createEffect(() => {
    const fmts = availableFormats();
    if (!fmts || fmts.length === 0) return;
    if (!fmts.includes(paperSize())) setPaperSize(fmts[0]);
    const g = stijlGroup();
    if (g) {
      const richting = orientation() === 'landscape' ? 'liggend' : 'staand';
      if (!g.byKey.has(`${paperSize()}|${richting}`)) {
        const other = richting === 'liggend' ? 'portrait' : 'landscape';
        const otherR = richting === 'liggend' ? 'staand' : 'liggend';
        if (g.byKey.has(`${paperSize()}|${otherR}`)) setOrientation(other);
      }
    }
  });

  const getDimensions = createMemo(() => {
    const size = paperSize();

    if (size === 'custom') {
      const wMm = customWidth();
      const hMm = customHeight();
      const wPt = Math.round((wMm / 25.4) * 72);
      const hPt = Math.round((hMm / 25.4) * 72);
      if (orientation() === 'landscape') {
        return { widthPt: hPt, heightPt: wPt, widthMm: hMm, heightMm: wMm, label: 'Custom' };
      }
      return { widthPt: wPt, heightPt: hPt, widthMm: wMm, heightMm: hMm, label: 'Custom' };
    }

    const info = PAPER_SIZES[size];
    if (orientation() === 'landscape') {
      return {
        widthPt: info.height,
        heightPt: info.width,
        widthMm: info.heightMm,
        heightMm: info.widthMm,
        label: info.label,
      };
    }
    return {
      widthPt: info.width,
      heightPt: info.height,
      widthMm: info.widthMm,
      heightMm: info.heightMm,
      label: info.label,
    };
  });

  const previewStyle = createMemo(() => {
    const dims = getDimensions();
    const maxW = 100;
    const maxH = 130;
    const aspect = dims.widthPt / dims.heightPt;
    let w, h;
    if (aspect > maxW / maxH) {
      w = maxW;
      h = maxW / aspect;
    } else {
      h = maxH;
      w = maxH * aspect;
    }
    return { width: Math.round(w) + 'px', height: Math.round(h) + 'px' };
  });

  const previewText = createMemo(() => {
    const dims = getDimensions();
    const base = `${dims.widthMm} x ${dims.heightMm} mm (${dims.label})`;
    const f = resolvedFrame();
    return f ? `${base} — ${f.fileName}` : base;
  });

  const close = () => closeDialog('new-doc');

  const handleOk = () => {
    const frame = resolvedFrame();
    if (frame) {
      // New document FROM the OpenAEC frame matching stijl+formaat+richting.
      createDocFromTemplate(frame.path);
      close();
      return;
    }
    const dims = getDimensions();
    createBlankPDF(dims.widthPt, dims.heightPt, numPages());
    close();
  };

  const footer = (
    <div>
      <div></div>
      <div class="new-doc-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleOk}>{tCommon('ok')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t('newDoc.title')}
      overlayClass="new-doc-overlay"
      dialogClass="new-doc-dialog"
      headerClass="new-doc-header"
      bodyClass="new-doc-content"
      footerClass="new-doc-footer"
      onClose={close}
      footer={footer}
    >
      <div class="new-doc-form">
        <div class="new-doc-row">
          <label class="new-doc-label">OpenAEC stijl</label>
          <select
            class="new-doc-select"
            value={stijl()}
            onChange={(e) => setStijl(e.target.value)}
            style="flex:1"
          >
            <option value="">Geen (blanco pagina)</option>
            <For each={frameIndex()?.stijlen || []}>{(s) => (
              <option value={s}>{_cap(s)}</option>
            )}</For>
          </select>
          <button
            title="Kaders-map openen — eigen kaders (zelfde naamgeving) verschijnen hier automatisch"
            style="margin-left:6px;padding:2px 8px;border:1px solid var(--theme-border,#acacac);background:var(--theme-surface,#fff);color:var(--theme-text,#333);cursor:pointer;height:24px"
            onClick={() => openFramesFolder()}
          >&#128193;</button>
        </div>
        <div class="new-doc-row">
          <label class="new-doc-label">{t('newDoc.paperSize')}</label>
          <Show when={availableFormats()} fallback={
            <select
              class="new-doc-select"
              value={paperSize()}
              onChange={(e) => setPaperSize(e.target.value)}
            >
              <optgroup label={t('newDoc.isoASeries')}>
                <option value="a0">A0 (841 x 1189 mm)</option>
                <option value="a1">A1 (594 x 841 mm)</option>
                <option value="a2">A2 (420 x 594 mm)</option>
                <option value="a3">A3 (297 x 420 mm)</option>
                <option value="a4">A4 (210 x 297 mm)</option>
                <option value="a5">A5 (148 x 210 mm)</option>
                <option value="a6">A6 (105 x 148 mm)</option>
              </optgroup>
              <optgroup label={t('newDoc.isoBSeries')}>
                <option value="b3">B3 (353 x 500 mm)</option>
                <option value="b4">B4 (250 x 353 mm)</option>
                <option value="b5">B5 (176 x 250 mm)</option>
              </optgroup>
              <optgroup label={t('newDoc.northAmerican')}>
                <option value="letter">Letter (8.5 x 11 in)</option>
                <option value="legal">Legal (8.5 x 14 in)</option>
                <option value="tabloid">Tabloid (11 x 17 in)</option>
                <option value="ledger">Ledger (17 x 11 in)</option>
              </optgroup>
              <optgroup label={t('newDoc.other')}>
                <option value="custom">{t('newDoc.customSize')}</option>
              </optgroup>
            </select>
          }>
            {/* Style chosen: only the formats that exist as frame PDFs */}
            <select
              class="new-doc-select"
              value={paperSize()}
              onChange={(e) => setPaperSize(e.target.value)}
            >
              <For each={availableFormats()}>{(f) => (
                <option value={f}>{f.toUpperCase()}{PAPER_SIZES[f] ? ` (${PAPER_SIZES[f].widthMm} x ${PAPER_SIZES[f].heightMm} mm)` : ''}</option>
              )}</For>
            </select>
          </Show>
        </div>
        <Show when={paperSize() === 'custom'}>
          <div class="new-doc-row new-doc-custom-row">
            <label class="new-doc-label">{t('newDoc.widthMm')}</label>
            <input
              type="number"
              class="new-doc-input"
              value={customWidth()}
              min="10"
              max="5000"
              step="1"
              onInput={(e) => setCustomWidth(parseInt(e.target.value) || 10)}
            />
            <label class="new-doc-label new-doc-label-inline">{t('newDoc.heightMm')}</label>
            <input
              type="number"
              class="new-doc-input"
              value={customHeight()}
              min="10"
              max="5000"
              step="1"
              onInput={(e) => setCustomHeight(parseInt(e.target.value) || 10)}
            />
          </div>
        </Show>
        <div class="new-doc-row">
          <label class="new-doc-label">{t('newDoc.orientation')}</label>
          <div class="new-doc-radio-group">
            <label class="new-doc-radio-label" style={!orientationAvailable('portrait') ? 'opacity:0.4' : ''}>
              <input
                type="radio"
                name="new-doc-orientation"
                value="portrait"
                disabled={!orientationAvailable('portrait')}
                checked={orientation() === 'portrait'}
                onChange={() => setOrientation('portrait')}
              /> {tCommon('portrait')}
            </label>
            <label class="new-doc-radio-label" style={!orientationAvailable('landscape') ? 'opacity:0.4' : ''}>
              <input
                type="radio"
                name="new-doc-orientation"
                value="landscape"
                disabled={!orientationAvailable('landscape')}
                checked={orientation() === 'landscape'}
                onChange={() => setOrientation('landscape')}
              /> {tCommon('landscape')}
            </label>
          </div>
        </div>
        <div class="new-doc-row" style={stijl() ? 'opacity:0.45;pointer-events:none' : ''}>
          <label class="new-doc-label">{t('newDoc.pagesCount')}</label>
          <input
            type="number"
            class="new-doc-input"
            value={numPages()}
            min="1"
            max="999"
            step="1"
            onInput={(e) => setNumPages(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
      </div>
      <div class="new-doc-preview-area">
        <div class="new-doc-preview-box">
          <div class="new-doc-preview-page" style={previewStyle()}></div>
        </div>
        <div class="new-doc-preview-text">{previewText()}</div>
      </div>
    </Dialog>
  );
}
