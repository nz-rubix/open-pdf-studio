import { For, Show, onMount, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import {
  schedules, addScheduleFromTemplate, renameSchedule, removeSchedule,
  STANDARD_SCHEDULE_TEMPLATES,
} from '../../../stores/schedulesStore.js';
import { initScheduleDrop, SCHEDULE_DND_MIME } from '../../../../quantities/schedule-drop.js';

export default function SchedulesPanel() {
  const { t } = useTranslation('properties');
  const [tpl, setTpl] = createSignal(STANDARD_SCHEDULE_TEMPLATES[0].id);
  const [editingId, setEditingId] = createSignal(null);

  // De drop-handler op de viewer is globaal; één keer ophangen bij mount.
  onMount(() => initScheduleDrop());

  function addSelected() {
    const def = STANDARD_SCHEDULE_TEMPLATES.find(x => x.id === tpl());
    if (!def) return;
    addScheduleFromTemplate(def.id, t(def.nameKey));
  }

  function onDragStart(e, s) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(SCHEDULE_DND_MIME, s.id);
    e.dataTransfer.setData('text/plain', s.name);
  }

  function commitRename(s, value) {
    const name = (value || '').trim();
    if (name) renameSchedule(s.id, name);
    setEditingId(null);
  }

  return (
    <div class={`left-panel-content${activeTab() === 'schedules' ? ' active' : ''}`} id="panel-schedules">
      <div class="left-panel-header">
        <span>{t('schedules.title')}</span>
      </div>

      {/* Toevoegen vanaf standaard-sjabloon */}
      <div class="schedules-add">
        <select class="schedules-tpl-select" value={tpl()} onChange={(e) => setTpl(e.currentTarget.value)}>
          <For each={STANDARD_SCHEDULE_TEMPLATES}>
            {(def) => <option value={def.id}>{t(def.nameKey)}</option>}
          </For>
        </select>
        <button class="schedules-add-btn" title={t('schedules.add')} onClick={addSelected}>+</button>
      </div>

      {/* Lijst van staten */}
      <Show when={schedules().length > 0}
        fallback={<div class="measurements-empty">{t('schedules.empty')}</div>}>
        <div class="schedules-hint">{t('schedules.dragHint')}</div>
        <For each={schedules()}>
          {(s) => (
            <div class="schedules-item" draggable={editingId() !== s.id} onDragStart={(e) => onDragStart(e, s)} title={t('schedules.dragHint')}>
              <span class="schedules-grip" innerHTML={gripIcon}></span>
              <Show when={editingId() === s.id}
                fallback={
                  <span class="schedules-name" onDblClick={() => setEditingId(s.id)}>{s.name}</span>
                }>
                <input
                  class="schedules-rename-input"
                  value={s.name}
                  autofocus
                  onBlur={(e) => commitRename(s, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(s, e.currentTarget.value);
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              </Show>
              <button class="schedules-item-btn" title={t('schedules.rename')}
                onClick={() => setEditingId(s.id)}>{renameIcon}</button>
              <button class="schedules-item-btn schedules-item-del" title={t('schedules.delete')}
                onClick={() => removeSchedule(s.id)}>&times;</button>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

const gripIcon = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/></svg>`;
const renameIcon = '✎';
