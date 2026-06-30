// Hoeveelheden — element-classificatie + veld-register (pure, geen UI-deps).
// Elk element (annotatie of native pseudo-element) krijgt een categorie en een
// set uitleesbare velden. Eén register, géén per-type code elders.

export const CATEGORY_LABELS = {
  'text-annotation': 'Tekst (annotatie)',
  'text-built-in': 'Tekst (native)',
  'area': 'Oppervlakte',
  'line-based': 'Lijnvormig',
  'count': 'Telling',
  'symbol': 'Symbool',
  'image': 'Afbeelding',
  'other': 'Overig',
};

export const CATEGORY_ORDER = [
  'area', 'line-based', 'count', 'text-annotation', 'text-built-in', 'symbol', 'image', 'other',
];

const TYPE_TO_CATEGORY = {
  textbox: 'text-annotation', callout: 'text-annotation', comment: 'text-annotation', text: 'text-annotation',
  measureArea: 'area', filledArea: 'area', box: 'area', circle: 'area', ellipse: 'area',
  polygon: 'area', cloud: 'area', cloudPolyline: 'area', scaleRegion: 'area', redaction: 'area', highlight: 'area',
  measureDistance: 'line-based', measurePerimeter: 'line-based', line: 'line-based', arrow: 'line-based',
  polyline: 'line-based', wall: 'line-based', spline: 'line-based', arc: 'line-based', draw: 'line-based', measureAngle: 'line-based',
  count: 'count', parametricSymbol: 'symbol', stamp: 'symbol', signature: 'symbol', image: 'image',
};

/** Categorie-key van een element (pseudo-elementen kunnen __category forceren). */
export function categoryOf(el) {
  return el.__category || TYPE_TO_CATEGORY[el.type] || 'other';
}

// Vriendelijke type-namen (parallel aan scheduleStore ELEMENT_TYPE_NAMES).
export const TYPE_NAMES = {
  line: 'Lijn', arrow: 'Pijl', wall: 'Wand', box: 'Rechthoek', mask: 'Maskeer',
  redaction: 'Redactie', circle: 'Cirkel', ellipse: 'Ellips', highlight: 'Markering',
  cloud: 'Wolk', polygon: 'Polygoon', polyline: 'Polylijn', cloudPolyline: 'Wolk-polylijn',
  spline: 'Spline', arc: 'Boog', draw: 'Pen', filledArea: 'Gevuld vlak',
  textbox: 'Tekstvak', callout: 'Tekstballon', comment: 'Notitie', text: 'Tekst',
  stamp: 'Stempel', signature: 'Handtekening', image: 'Afbeelding',
  parametricSymbol: 'Symbool', count: 'Telmarkering',
  measureDistance: 'Afstand', measureArea: 'Oppervlakte', measurePerimeter: 'Omtrek',
  measureAngle: 'Hoek', scaleRegion: 'Schaalgebied', viewport: 'Viewport',
  scheduleTable: 'Hoeveelheden-tabel', builtinText: 'Tekst',
};

const F = (key, label, kind, get, unit = '', dec) => ({ key, label, kind, unit, get, dec });

function areaValue(el) {
  return (el.type === 'measureArea' && typeof el.measureValue === 'number') ? el.measureValue : null;
}
function lengthValue(el) {
  return ((el.type === 'measureDistance' || el.type === 'measurePerimeter') && typeof el.measureValue === 'number')
    ? el.measureValue : null;
}
function realArea(el) {
  const a = areaValue(el);
  if (a == null) return null;
  const d = el.dakhoek || 0;
  return d ? a / Math.cos(d * Math.PI / 180) : a;
}

// Gemeenschappelijke velden voor élke categorie. 'count' (=1 per rij) levert
// Revit-stijl tellingen via groeperen + subtotalen.
const COMMON = [
  F('category', 'Categorie', 'text', el => CATEGORY_LABELS[categoryOf(el)]),
  F('type', 'Type', 'text', el => TYPE_NAMES[el.type] || el.type),
  F('page', 'Pagina', 'number', el => el.page || 1, '', 0),
  F('label', 'Label', 'text', el => el.label || el.subject || ''),
  F('color', 'Kleur', 'text', el => el.color || el.strokeColor || el.fillColor || ''),
  F('count', 'Aantal', 'number', () => 1, '', 0),
];

export const FIELD_REGISTRY = {
  'area': [...COMMON,
    F('area', 'Oppervlakte', 'number', areaValue, 'm²'),
    F('dakhoek', 'Dakhoek', 'number', el => el.dakhoek || 0, '°', 0),
    F('realArea', 'Werkelijk opp.', 'number', realArea, 'm²'),
  ],
  'line-based': [...COMMON,
    F('length', 'Lengte', 'number', lengthValue, 'm'),
  ],
  'count': [...COMMON,
    F('countCat', 'Telcategorie', 'text', el => el.__countCatName || el.categoryId || ''),
  ],
  'text-annotation': [...COMMON,
    F('text', 'Inhoud', 'text', el => el.text || ''),
    F('fontSize', 'Grootte', 'number', el => el.fontSize || 0, 'pt', 0),
    F('fontFamily', 'Lettertype', 'text', el => el.fontFamily || ''),
  ],
  'text-built-in': [...COMMON,
    F('text', 'Inhoud', 'text', el => el.text || ''),
    F('fontSize', 'Grootte', 'number', el => Math.round((el.fontSize || 0) * 10) / 10, 'pt', 1),
  ],
  'symbol': [...COMMON,
    F('symbolId', 'Symbool', 'text', el => el.symbolId || el.stampType || ''),
  ],
  'image': [...COMMON,
    F('width', 'Breedte', 'number', el => el.originalWidth || el.width || 0, 'px', 0),
    F('height', 'Hoogte', 'number', el => el.originalHeight || el.height || 0, 'px', 0),
  ],
  'other': [...COMMON],
};

/** Unie van velddefinities over geselecteerde categorieën, uniek op key (eerste wint). */
export function fieldsForCategories(cats) {
  const m = new Map();
  for (const c of (cats || [])) {
    for (const f of (FIELD_REGISTRY[c] || [])) {
      if (!m.has(f.key)) m.set(f.key, f);
    }
  }
  return [...m.values()];
}

/** Eén velddefinitie op key, binnen de geselecteerde categorieën. */
export function fieldByKey(cats, key) {
  return fieldsForCategories(cats).find(f => f.key === key) || null;
}
