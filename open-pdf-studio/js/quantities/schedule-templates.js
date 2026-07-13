// Standaard schedule-sjablonen (staten) + omzetting van een engine-resultaat
// naar een tabel-annotatie. Puur, geen UI-deps. De sjablonen leiden hun
// categorieën/velden af uit categories.js zodat ze consistent blijven met de
// bestaande hoeveelheden-functionaliteit.

// Elk sjabloon levert een config die 1-op-1 aan quantities/engine.buildSchedule
// gevoerd kan worden. `nameKey` verwijst naar i18n (namespace 'properties').
export const STANDARD_SCHEDULE_TEMPLATES = [
  {
    id: 'area',
    nameKey: 'schedules.tpl.area',
    config: {
      categories: ['area'],
      fields: ['type', 'page', 'label', 'area', 'count'],
      sort: [{ field: 'type', dir: 'asc', group: true, header: true, footer: true }],
      itemize: true,
    },
  },
  {
    id: 'length',
    nameKey: 'schedules.tpl.length',
    config: {
      categories: ['line-based'],
      fields: ['type', 'page', 'label', 'length', 'count'],
      sort: [{ field: 'type', dir: 'asc', group: true, header: true, footer: true }],
      itemize: true,
    },
  },
  {
    id: 'count',
    nameKey: 'schedules.tpl.count',
    config: {
      categories: ['count'],
      fields: ['countCat', 'page', 'count'],
      sort: [{ field: 'countCat', dir: 'asc', group: true, header: true, footer: true }],
      itemize: false,
    },
  },
  {
    id: 'symbol',
    nameKey: 'schedules.tpl.symbol',
    config: {
      categories: ['symbol'],
      fields: ['symbolId', 'page', 'count'],
      sort: [{ field: 'symbolId', dir: 'asc', group: true, header: true, footer: true }],
      itemize: false,
    },
  },
  {
    id: 'text',
    nameKey: 'schedules.tpl.text',
    config: {
      categories: ['text-annotation'],
      fields: ['text', 'page', 'count'],
      sort: [{ field: 'page', dir: 'asc', group: false }],
      itemize: true,
    },
  },
  {
    id: 'full',
    nameKey: 'schedules.tpl.full',
    config: {
      categories: ['area', 'line-based', 'count', 'symbol', 'text-annotation', 'image'],
      fields: ['category', 'type', 'page', 'count'],
      sort: [{ field: 'category', dir: 'asc', group: true, header: true, footer: true }],
      itemize: true,
    },
  },
];

export function getTemplateById(id) {
  return STANDARD_SCHEDULE_TEMPLATES.find(t => t.id === id) || null;
}

// --- Cel-formattering (gelijk aan SchedulePanel zodat plaatsen consistent is) ---
export function formatCell(val, col) {
  if (val == null || val === '') return '';
  if (typeof val === 'number') return Number.isFinite(val) ? val.toFixed(col.decimals ?? 0) : '';
  return String(val);
}

export function fmtTotal(val, col) {
  if (val == null) return '';
  return val.toFixed(col.decimals ?? 2) + (col.unit ? ` ${col.unit}` : '');
}

// Zet een buildSchedule-resultaat om naar de tabel-vorm die de scheduleTable-
// annotatie rendert: { columns: string[], rows: {cells, group?, total?, grand?}[] }.
// Retourneert tevens berekende breedte/hoogte in app-space punten.
export function scheduleResultToTable(r, title) {
  const columns = r.columns.map(c => c.label + (c.unit ? ` (${c.unit})` : ''));
  const rows = [];
  for (const g of r.groups) {
    if (g.key !== null) rows.push({ group: true, cells: [`${g.key} (${g.rows.length})`] });
    if (r.itemize) {
      for (const row of g.rows) {
        rows.push({ cells: r.columns.map(c => formatCell(row.vals[c.key], c)) });
      }
    }
    rows.push({ total: true, cells: r.columns.map((c, i) => i === 0 ? 'Subtotaal' : fmtTotal(g.subtotals[c.key], c)) });
  }
  rows.push({ total: true, grand: true, cells: r.columns.map((c, i) => i === 0 ? 'Eindtotaal' : fmtTotal(r.grandTotals[c.key], c)) });

  const width = Math.max(300, columns.length * 90);
  const height = 24 + (rows.length + 1) * 18;
  return { columns, rows, width, height, title: title || 'Hoeveelheden' };
}
