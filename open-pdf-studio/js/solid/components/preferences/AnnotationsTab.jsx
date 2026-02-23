import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';

export default function AnnotationsTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>{t('annotations.generalDefaults')}</h3>
        <div class="pref-row">
          <label>{t('annotations.defaultAnnotationColor')}</label>
          <PrefColorPicker value={p.defaultAnnotationColor[0]} setValue={p.defaultAnnotationColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.defaultLineWidth')}</label>
          <input type="number" min="1" max="20" value={p.defaultLineWidth[0]()} onInput={e => p.defaultLineWidth[1](parseInt(e.target.value) || 3)} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.defaultFontSize')}</label>
          <input type="number" min="8" max="72" value={p.defaultFontSize[0]()} onInput={e => p.defaultFontSize[1](parseInt(e.target.value) || 16)} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.highlightOpacity')}</label>
          <input type="number" min="10" max="100" value={p.highlightOpacity[0]()} onInput={e => p.highlightOpacity[1](parseInt(e.target.value) || 30)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('annotations.textBoxDefaults')}</h3>
        <div class="pref-row">
          <label>{t('annotations.fillColor')}</label>
          <PrefColorPicker value={p.textboxFillColor[0]} setValue={p.textboxFillColor[1]} noneChecked={p.textboxFillNone[0]} setNoneChecked={p.textboxFillNone[1]} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.strokeColor')}</label>
          <PrefColorPicker value={p.textboxStrokeColor[0]} setValue={p.textboxStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.borderWidth')}</label>
          <input type="number" min="0" max="10" value={p.textboxBorderWidth[0]()} onInput={e => p.textboxBorderWidth[1](parseInt(e.target.value) || 1)} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.borderStyle')}</label>
          <select value={p.textboxBorderStyle[0]()} onChange={e => p.textboxBorderStyle[1](e.target.value)}>
            <option value="solid">{tCommon('solid')}</option>
            <option value="dashed">{tCommon('dashed')}</option>
            <option value="dotted">{tCommon('dotted')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('annotations.opacity')}</label>
          <input type="number" min="10" max="100" value={p.textboxOpacity[0]()} onInput={e => p.textboxOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.fontSize')}</label>
          <input type="number" min="8" max="72" value={p.textboxFontSize[0]()} onInput={e => p.textboxFontSize[1](parseInt(e.target.value) || 14)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('annotations.calloutDefaults')}</h3>
        <div class="pref-row">
          <label>{t('annotations.fillColor')}</label>
          <PrefColorPicker value={p.calloutFillColor[0]} setValue={p.calloutFillColor[1]} noneChecked={p.calloutFillNone[0]} setNoneChecked={p.calloutFillNone[1]} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.strokeColor')}</label>
          <PrefColorPicker value={p.calloutStrokeColor[0]} setValue={p.calloutStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.borderWidth')}</label>
          <input type="number" min="0" max="10" value={p.calloutBorderWidth[0]()} onInput={e => p.calloutBorderWidth[1](parseInt(e.target.value) || 1)} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.borderStyle')}</label>
          <select value={p.calloutBorderStyle[0]()} onChange={e => p.calloutBorderStyle[1](e.target.value)}>
            <option value="solid">{tCommon('solid')}</option>
            <option value="dashed">{tCommon('dashed')}</option>
            <option value="dotted">{tCommon('dotted')}</option>
          </select>
        </div>
        <div class="pref-row">
          <label>{t('annotations.opacity')}</label>
          <input type="number" min="10" max="100" value={p.calloutOpacity[0]()} onInput={e => p.calloutOpacity[1](parseInt(e.target.value) || 100)} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.fontSize')}</label>
          <input type="number" min="8" max="72" value={p.calloutFontSize[0]()} onInput={e => p.calloutFontSize[1](parseInt(e.target.value) || 14)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('annotations.highlightDefaults')}</h3>
        <div class="pref-row">
          <label>{t('annotations.color')}</label>
          <PrefColorPicker value={p.highlightColor[0]} setValue={p.highlightColor[1]} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('annotations.commentNoteDefaults')}</h3>
        <div class="pref-row">
          <label>{t('annotations.color')}</label>
          <PrefColorPicker value={p.commentColor[0]} setValue={p.commentColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('annotations.icon')}</label>
          <select value={p.commentIcon[0]()} onChange={e => p.commentIcon[1](e.target.value)}>
            <option value="comment">{t('annotations.iconComment')}</option>
            <option value="key">{t('annotations.iconKey')}</option>
            <option value="note">{t('annotations.iconNote')}</option>
            <option value="help">{t('annotations.iconHelp')}</option>
            <option value="newParagraph">{t('annotations.iconNewParagraph')}</option>
            <option value="paragraph">{t('annotations.iconParagraph')}</option>
            <option value="insert">{t('annotations.iconInsert')}</option>
          </select>
        </div>
      </div>
    </>
  );
}
