import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';

export default function ShapesTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>{t('shapes.rectangleDefaults')}</h3>
        <div class="pref-row">
          <label>{t('shapes.fillColor')}</label>
          <PrefColorPicker value={p.rectFillColor[0]} setValue={p.rectFillColor[1]} noneChecked={p.rectFillNone[0]} setNoneChecked={p.rectFillNone[1]} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.strokeColor')}</label>
          <PrefColorPicker value={p.rectStrokeColor[0]} setValue={p.rectStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.borderWidth')}</label>
          <input type="number" min="1" max="20" value={p.rectBorderWidth[0]()} onInput={e => p.rectBorderWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.borderStyle')}</label>
          <select value={p.rectBorderStyle[0]()} onChange={e => p.rectBorderStyle[1](e.target.value)}>
            <option value="solid">{tCommon('solid')}</option>
            <option value="dashed">{tCommon('dashed')}</option>
            <option value="dotted">{tCommon('dotted')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('shapes.opacity')}</label>
          <input type="number" min="10" max="100" value={p.rectOpacity[0]()} onInput={e => p.rectOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('shapes.ellipseDefaults')}</h3>
        <div class="pref-row">
          <label>{t('shapes.fillColor')}</label>
          <PrefColorPicker value={p.circleFillColor[0]} setValue={p.circleFillColor[1]} noneChecked={p.circleFillNone[0]} setNoneChecked={p.circleFillNone[1]} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.strokeColor')}</label>
          <PrefColorPicker value={p.circleStrokeColor[0]} setValue={p.circleStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.borderWidth')}</label>
          <input type="number" min="1" max="20" value={p.circleBorderWidth[0]()} onInput={e => p.circleBorderWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.borderStyle')}</label>
          <select value={p.circleBorderStyle[0]()} onChange={e => p.circleBorderStyle[1](e.target.value)}>
            <option value="solid">{tCommon('solid')}</option>
            <option value="dashed">{tCommon('dashed')}</option>
            <option value="dotted">{tCommon('dotted')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('shapes.opacity')}</label>
          <input type="number" min="10" max="100" value={p.circleOpacity[0]()} onInput={e => p.circleOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('shapes.polygonDefaults')}</h3>
        <div class="pref-row">
          <label>{t('shapes.strokeColor')}</label>
          <PrefColorPicker value={p.polygonStrokeColor[0]} setValue={p.polygonStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.polygonLineWidth[0]()} onInput={e => p.polygonLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.opacity')}</label>
          <input type="number" min="10" max="100" value={p.polygonOpacity[0]()} onInput={e => p.polygonOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('shapes.cloudDefaults')}</h3>
        <div class="pref-row">
          <label>{t('shapes.strokeColor')}</label>
          <PrefColorPicker value={p.cloudStrokeColor[0]} setValue={p.cloudStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.cloudLineWidth[0]()} onInput={e => p.cloudLineWidth[1](parseInt(e.target.value) || 2)} />
        </div>
        <div class="pref-row">
          <label>{t('shapes.opacity')}</label>
          <input type="number" min="10" max="100" value={p.cloudOpacity[0]()} onInput={e => p.cloudOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>
    </>
  );
}
