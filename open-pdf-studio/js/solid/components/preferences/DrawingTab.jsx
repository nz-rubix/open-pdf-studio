import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';

export default function DrawingTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>{t('drawing.freehandDefaults')}</h3>
        <div class="pref-row">
          <label>{t('drawing.strokeColor')}</label>
          <PrefColorPicker value={p.drawStrokeColor[0]} setValue={p.drawStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.drawLineWidth[0]()} onInput={e => p.drawLineWidth[1](parseInt(e.target.value) || 3)} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.opacity')}</label>
          <input type="number" min="10" max="100" value={p.drawOpacity[0]()} onInput={e => p.drawOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('drawing.lineDefaults')}</h3>
        <div class="pref-row">
          <label>{t('drawing.strokeColor')}</label>
          <PrefColorPicker value={p.lineStrokeColor[0]} setValue={p.lineStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.lineLineWidth[0]()} onInput={e => p.lineLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.borderStyle')}</label>
          <select value={p.lineBorderStyle[0]()} onChange={e => p.lineBorderStyle[1](e.target.value)}>
            <option value="solid">{tCommon('solid')}</option>
            <option value="dashed">{tCommon('dashed')}</option>
            <option value="dotted">{tCommon('dotted')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('drawing.opacity')}</label>
          <input type="number" min="10" max="100" value={p.lineOpacity[0]()} onInput={e => p.lineOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('drawing.arrowDefaults')}</h3>
        <div class="pref-row">
          <label>{t('drawing.strokeColor')}</label>
          <PrefColorPicker value={p.arrowStrokeColor[0]} setValue={p.arrowStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.fillColor')}</label>
          <PrefColorPicker value={p.arrowFillColor[0]} setValue={p.arrowFillColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.arrowLineWidth[0]()} onInput={e => p.arrowLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.borderStyle')}</label>
          <select value={p.arrowBorderStyle[0]()} onChange={e => p.arrowBorderStyle[1](e.target.value)}>
            <option value="solid">{tCommon('solid')}</option>
            <option value="dashed">{tCommon('dashed')}</option>
            <option value="dotted">{tCommon('dotted')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('drawing.startHead')}</label>
          <select value={p.arrowStartHead[0]()} onChange={e => p.arrowStartHead[1](e.target.value)}>
            <option value="none">{tCommon('none')}</option>
            <option value="open">{t('drawing.headOpen')}</option>
            <option value="closed">{t('drawing.headClosed')}</option>
            <option value="diamond">{t('drawing.headDiamond')}</option>
            <option value="circle">{t('drawing.headCircle')}</option>
            <option value="square">{t('drawing.headSquare')}</option>
            <option value="slash">{t('drawing.headSlash')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('drawing.endHead')}</label>
          <select value={p.arrowEndHead[0]()} onChange={e => p.arrowEndHead[1](e.target.value)}>
            <option value="none">{tCommon('none')}</option>
            <option value="open">{t('drawing.headOpen')}</option>
            <option value="closed">{t('drawing.headClosed')}</option>
            <option value="diamond">{t('drawing.headDiamond')}</option>
            <option value="circle">{t('drawing.headCircle')}</option>
            <option value="square">{t('drawing.headSquare')}</option>
            <option value="slash">{t('drawing.headSlash')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('drawing.headSize')}</label>
          <input type="number" min="4" max="40" value={p.arrowHeadSize[0]()} onInput={e => p.arrowHeadSize[1](parseInt(e.target.value) || 12)} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.opacity')}</label>
          <input type="number" min="10" max="100" value={p.arrowOpacity[0]()} onInput={e => p.arrowOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('drawing.polylineDefaults')}</h3>
        <div class="pref-row">
          <label>{t('drawing.strokeColor')}</label>
          <PrefColorPicker value={p.polylineStrokeColor[0]} setValue={p.polylineStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.polylineLineWidth[0]()} onInput={e => p.polylineLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('drawing.opacity')}</label>
          <input type="number" min="10" max="100" value={p.polylineOpacity[0]()} onInput={e => p.polylineOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>
    </>
  );
}
