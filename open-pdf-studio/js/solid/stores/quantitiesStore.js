// Hoeveelheden — config-store. Solid-signals voor de schedule-config + memo's
// die de pure engine aanroepen. Visibility blijft in scheduleStore (re-exported).
import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';
import { buildSchedule } from '../../quantities/engine.js';
import { countTallies } from './countStore.js';
import { scheduleVisible, setScheduleVisible, toggleSchedule } from './scheduleStore.js';

// --- Config signals ---
const [selectedCategories, setSelectedCategories] = createSignal(['area', 'line-based', 'count']);
const [scheduledFields, setScheduledFields] = createSignal(['type', 'page', 'count']);
const [filters, setFilters] = createSignal([]);
const [sortLevels, setSortLevels] = createSignal([
  { field: 'category', dir: 'asc', group: true, header: true, footer: true },
]);
const [itemize, setItemize] = createSignal(true);
const [grandTotals, setGrandTotals] = createSignal(true);
const [format, setFormat] = createSignal({});
const [appearance, setAppearance] = createSignal({
  gridlines: true, outline: false, stripe: false, showTitle: true, showHeaders: true,
});
const [propertiesVisible, setPropertiesVisible] = createSignal(false);
const [builtInText, setBuiltInText] = createSignal([]);

function countCatName(categoryId) {
  const t = countTallies().find(c => c.id === categoryId);
  return t ? t.name : (categoryId || '');
}

/** Alle elementen: annotaties (count verrijkt met telcategorie-naam) + native tekst. */
function collectElements() {
  const doc = getActiveDocument();
  const anns = (doc?.annotations || []).map(a =>
    a.type === 'count' ? { ...a, __countCatName: countCatName(a.categoryId) } : a
  );
  const bi = selectedCategories().includes('text-built-in') ? builtInText() : [];
  return [...anns, ...bi];
}

export const scheduleResult = createMemo(() => buildSchedule(collectElements(), {
  categories: selectedCategories(),
  fields: scheduledFields(),
  filters: filters(),
  sort: sortLevels(),
  itemize: itemize(),
  format: format(),
}));

/** Laadt native PDF-tekst van de huidige pagina als text-built-in pseudo-elementen. */
export async function loadBuiltInText() {
  const doc = getActiveDocument();
  const invoke = window.__TAURI__?.core?.invoke;
  if (!doc?.filePath || !invoke) { setBuiltInText([]); return; }
  try {
    const page = doc.currentPage || 1;
    const json = await invoke('extract_page_text', { path: doc.filePath, pageIndex: page - 1 });
    const spans = typeof json === 'string' ? JSON.parse(json) : json;
    setBuiltInText((spans || [])
      .filter(s => s && s.text && String(s.text).trim())
      .map((s, i) => ({
        id: `builtin-${page}-${i}`, __category: 'text-built-in', type: 'builtinText', page,
        text: s.text, fontSize: s.fontSize, x: s.x, y: s.y, width: s.width,
      })));
  } catch (e) {
    console.warn('extract_page_text faalde', e);
    setBuiltInText([]);
  }
}

export function clearBuiltInText() { setBuiltInText([]); }

export {
  selectedCategories, setSelectedCategories,
  scheduledFields, setScheduledFields,
  filters, setFilters,
  sortLevels, setSortLevels,
  itemize, setItemize,
  grandTotals, setGrandTotals,
  format, setFormat,
  appearance, setAppearance,
  propertiesVisible, setPropertiesVisible,
  builtInText,
  scheduleVisible, setScheduleVisible, toggleSchedule,
};
