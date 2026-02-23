import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, updateOpacity, getLineWidthLabel } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function AppearanceSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.appearance}>
      <CollapsibleSection title={t('appearance.title')} name="appearance" id="prop-appearance-section">
        <Show when={sectionVis.iconGroup}>
          <div class="property-group">
            <label>{t('appearance.icon')}</label>
            <select value={annotProps.icon} disabled={isLocked()}
              onChange={(e) => updateAnnotProp('icon', e.target.value)}>
              <option value="comment">{t('appearance.iconComment')}</option>
              <option value="note">{t('appearance.iconNote')}</option>
              <option value="help">{t('appearance.iconHelp')}</option>
              <option value="insert">{t('appearance.iconInsert')}</option>
              <option value="key">{t('appearance.iconKey')}</option>
              <option value="newparagraph">{t('appearance.iconNewParagraph')}</option>
              <option value="paragraph">{t('appearance.iconParagraph')}</option>
              <option value="check">{t('appearance.iconCheck')}</option>
              <option value="circle">{t('appearance.iconCircle')}</option>
              <option value="cross">{t('appearance.iconCross')}</option>
              <option value="star">{t('appearance.iconStar')}</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.fillColorGroup}>
          <ColorPalettePicker
            label={t('appearance.fillColor')}
            color={() => annotProps.fillColor}
            showNone={true}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('fillColor', color)}
            onNone={() => updateAnnotProp('fillColor', null)}
          />
        </Show>

        <Show when={sectionVis.strokeColorGroup}>
          <ColorPalettePicker
            label={t('appearance.strokeColor')}
            color={() => annotProps.strokeColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('strokeColor', color)}
          />
        </Show>

        <Show when={sectionVis.colorGroup}>
          <ColorPalettePicker
            label={t('appearance.color')}
            color={() => annotProps.color}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('color', color)}
          />
        </Show>

        <Show when={sectionVis.opacityGroup}>
          <div class="property-group">
            <label>{t('appearance.opacity')}</label>
            <div class="opacity-slider-wrapper">
              <input type="range" min="0" max="100"
                value={annotProps.opacity}
                disabled={isLocked()}
                onInput={(e) => updateOpacity(e.target.value, e.ctrlKey)} />
              <span>{annotProps.opacity}%</span>
            </div>
          </div>
        </Show>

        <Show when={sectionVis.lineWidthGroup}>
          <div class="property-group">
            <label>{getLineWidthLabel()}</label>
            <select class="ribbon-input" value={annotProps.lineWidth} disabled={isLocked()}
              onChange={(e) => updateAnnotProp('lineWidth', e.target.value)}>
              <option value="0">0</option>
              <option value="0.5">0.5</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="6">6</option>
              <option value="8">8</option>
              <option value="10">10</option>
              <option value="12">12</option>
            </select>
          </div>
        </Show>

        <Show when={sectionVis.borderStyleGroup}>
          <div class="property-group">
            <label>{t('appearance.borderStyle')}</label>
            <select value={annotProps.borderStyle} disabled={isLocked()}
              onChange={(e) => updateAnnotProp('borderStyle', e.target.value)}>
              <option value="solid">{tCommon('solid')}</option>
              <option value="dashed">{tCommon('dashed')}</option>
              <option value="dotted">{tCommon('dotted')}</option>
            </select>
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
