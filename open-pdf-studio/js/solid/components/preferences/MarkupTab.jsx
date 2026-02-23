import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';

export default function MarkupTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>{t('markup.redactionDefaults')}</h3>
        <div class="pref-row">
          <label>{t('markup.overlayColor')}</label>
          <PrefColorPicker value={p.redactionOverlayColor[0]} setValue={p.redactionOverlayColor[1]} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('markup.measurementDefaults')}</h3>
        <div class="pref-row">
          <label>{t('markup.strokeColor')}</label>
          <PrefColorPicker value={p.measureStrokeColor[0]} setValue={p.measureStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('markup.lineWidth')}</label>
          <input type="number" min="1" max="20" value={p.measureLineWidth[0]()} onInput={e => p.measureLineWidth[1](parseInt(e.target.value) || 1)} />
        </div>
        <div class="pref-row">
          <label>{t('markup.opacity')}</label>
          <input type="number" min="10" max="100" value={p.measureOpacity[0]()} onInput={e => p.measureOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
      </div>
    </>
  );
}
