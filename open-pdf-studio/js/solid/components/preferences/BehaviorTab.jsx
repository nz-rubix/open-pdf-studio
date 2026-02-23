import { useTranslation } from '../../../i18n/useTranslation.js';

export default function BehaviorTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <div class="preferences-section">
        <h3>{t('behavior.startup')}</h3>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.restoreLastSession[0]()} onChange={e => p.restoreLastSession[1](e.target.checked)} />
            <span>{t('behavior.restoreLastSession')}</span>
          </label>
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('behavior.author')}</h3>
        <div class="pref-row">
          <label>{t('behavior.defaultAuthorName')}</label>
          <input type="text" value={p.authorName[0]()} onInput={e => p.authorName[1](e.target.value)} />
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('behavior.snapping')}</h3>
        <div class="pref-row">
          <label>{t('behavior.angleSnap')}</label>
          <input type="number" min="1" max="90" value={p.angleSnapDegrees[0]()} onInput={e => p.angleSnapDegrees[1](parseInt(e.target.value) || 30)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableAngleSnap[0]()} onChange={e => p.enableAngleSnap[1](e.target.checked)} />
            <span>{t('behavior.enableAngleSnapping')}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('behavior.gridSize')}</label>
          <input type="number" min="5" max="100" value={p.gridSize[0]()} onInput={e => p.gridSize[1](parseInt(e.target.value) || 10)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableGridSnap[0]()} onChange={e => p.enableGridSnap[1](e.target.checked)} />
            <span>{t('behavior.enableGridSnapping')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.showGrid[0]()} onChange={e => p.showGrid[1](e.target.checked)} />
            <span>{t('behavior.showGridOverlay')}</span>
          </label>
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('behavior.creation')}</h3>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.autoSelectAfterCreate[0]()} onChange={e => p.autoSelectAfterCreate[1](e.target.checked)} />
            <span>{t('behavior.autoSelectAfterCreation')}</span>
          </label>
        </div>
      </div>

      <div class="preferences-section">
        <h3>{t('behavior.deletion')}</h3>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.confirmBeforeDelete[0]()} onChange={e => p.confirmBeforeDelete[1](e.target.checked)} />
            <span>{t('behavior.confirmBeforeDeleting')}</span>
          </label>
        </div>
      </div>
    </>
  );
}
