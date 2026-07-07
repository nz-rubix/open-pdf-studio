// Dev-time converter: elektra-legenda DXF (NLRS-blokken) → SVG-stempels in
// js/solid/data/elektraSymbols.js
//
// Leest de lokale elektra-renvooi-DXF, groepeert de BLOCK-definities (elk blok
// = één symbool), zet LINE / ARC / CIRCLE / HATCH-randen om naar genormaliseerde
// SVG-paden (viewBox 0 0 64 64, y-flip want DXF is y-up), en schrijft één
// compacte JS-datamodule met per symbool { id, name, svg }. De palette-categorie
// "Elektra" (nlSymbolLibrary.js) plaatst deze als statische stempels.
//
// Gebruik:  node scripts/dxf-elektra-convert.mjs "<pad naar .dxf of map>"

import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.argv[2] ||
  'C:\\Users\\rickd\\Documents\\GitHub\\verification-files\\DWG-DXF\\elektra';
const OUT = new URL('../js/solid/data/elektraSymbols.js', import.meta.url);

// ── DXF-parsing: code/waarde-paren (twee regels per paar) ──────────────────
function parsePairs(text) {
  const lines = text.split(/\r\n|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([lines[i].trim(), lines[i + 1]]);
  }
  return pairs;
}

// Verzamel alle BLOCK…ENDBLK-definities uit de BLOCKS-sectie.
function parseBlocks(pairs) {
  const blocks = [];
  let inBlocksSec = false;
  let cur = null;      // huidig block
  let ent = null;      // huidige entiteit binnen block
  let seenName = false;

  const pushEnt = () => { if (cur && ent) cur.ents.push(ent); ent = null; };

  for (let i = 0; i < pairs.length; i++) {
    const [code, rawVal] = pairs[i];
    const val = (rawVal ?? '').trim();

    if (code === '2' && val === 'BLOCKS') { inBlocksSec = true; continue; }
    if (code === '0' && val === 'ENDSEC' && inBlocksSec) { pushEnt(); cur = null; inBlocksSec = false; continue; }
    if (!inBlocksSec) continue;

    if (code === '0') {
      if (val === 'BLOCK') {
        pushEnt();
        if (cur) blocks.push(cur);
        cur = { name: '', ents: [] };
        seenName = false;
        ent = null;
        continue;
      }
      if (val === 'ENDBLK') { pushEnt(); if (cur) { blocks.push(cur); cur = null; } continue; }
      // Nieuwe entiteit binnen het block.
      pushEnt();
      ent = { type: val, g: {}, pairs: [] };
      continue;
    }
    if (!cur) continue;

    // Blocknaam = eerste code-2 na BLOCK (voor de eerste entiteit).
    if (!ent) {
      if (code === '2' && !seenName) { cur.name = val; seenName = true; }
      continue;
    }
    // Verzamel numerieke groepscodes; meerdere waarden per code (bv. vertices).
    (ent.g[code] ||= []).push(val);
    ent.pairs.push([code, val]);
  }
  if (ent && cur) cur.ents.push(ent);
  if (cur) blocks.push(cur);
  return blocks;
}

const num = v => parseFloat(v);
const first = (g, code) => (g[code] ? num(g[code][0]) : undefined);

function arcPts(cx, cy, r, a0deg, a1deg) {
  let a0 = (a0deg || 0) * Math.PI / 180;
  let a1 = (a1deg ?? 360) * Math.PI / 180;
  if (a1 <= a0) a1 += 2 * Math.PI;
  const segs = Math.max(3, Math.ceil((a1 - a0) / (Math.PI / 16)));
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// HATCH-omtrek → gevuld pad. Loopt de geordende paren van de boundary-data af:
// 91 = aantal boundary-paths, 93 = aantal edges in het path, 72 = edge-type
// (1=lijn, 2=boog, 3=ellipsboog, 4=spline). Per edge de bijhorende geometrie.
// De solid seed-points (na code 98) worden genegeerd.
function hatchLoops(ent) {
  const pairs = ent.pairs || [];
  const loops = [];
  let i = 0;
  // Zoek de start van de boundary-paths (na code 91 = aantal paths).
  while (i < pairs.length && pairs[i][0] !== '91') i++;
  if (i >= pairs.length) return [];
  const nPaths = parseInt(pairs[i][1]) || 0;
  i++;
  const readNum = () => num(pairs[i][1]);
  for (let p = 0; p < nPaths; p++) {
    // Volgende code 93 = aantal edges.
    while (i < pairs.length && pairs[i][0] !== '93') i++;
    if (i >= pairs.length) break;
    const nEdges = parseInt(pairs[i][1]) || 0;
    i++;
    const pts = [];
    for (let e = 0; e < nEdges; e++) {
      // Volgende code 72 = edge-type.
      while (i < pairs.length && pairs[i][0] !== '72') i++;
      if (i >= pairs.length) break;
      const type = parseInt(pairs[i][1]) || 0;
      i++;
      if (type === 1) {
        // Lijn: 10/20 start, 11/21 eind.
        let x1, y1, x2, y2;
        for (; i < pairs.length && pairs[i][0] !== '72'; i++) {
          const [c, v] = pairs[i];
          if (c === '10') x1 = num(v); else if (c === '20') y1 = num(v);
          else if (c === '11') x2 = num(v); else if (c === '21') { y2 = num(v); }
          if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) { i++; break; }
        }
        if (x1 !== undefined) { if (!pts.length) pts.push({ x: x1, y: y1 }); pts.push({ x: x2, y: y2 }); }
      } else if (type === 2) {
        // Boog: 10/20 centrum, 40 straal, 50/51 hoeken, 73 tegen de klok in.
        let cx, cy, r, a0, a1, ccw = 1;
        for (; i < pairs.length && pairs[i][0] !== '72'; i++) {
          const [c, v] = pairs[i];
          if (c === '10') cx = num(v); else if (c === '20') cy = num(v);
          else if (c === '40') r = num(v); else if (c === '50') a0 = num(v);
          else if (c === '51') a1 = num(v); else if (c === '73') { ccw = num(v); i++; break; }
        }
        if (cx !== undefined) {
          const ap = arcPts(cx, cy, r, a0, a1);
          for (const pt of ap) if (!pts.length || pts[pts.length - 1].x !== pt.x || pts[pts.length - 1].y !== pt.y) pts.push(pt);
        }
      } else {
        // Onbekend edge-type: sla vooruit tot volgende 72 / einde path.
        while (i < pairs.length && pairs[i][0] !== '72' && pairs[i][0] !== '97' && pairs[i][0] !== '93') i++;
      }
    }
    if (pts.length >= 2) loops.push({ closed: true, fill: true, pts });
  }
  return loops;
}

// Entiteit → lijst paden { closed, fill, pts }.
function entToPaths(e) {
  const g = e.g;
  switch (e.type) {
    case 'LINE': {
      const x1 = first(g, '10'), y1 = first(g, '20');
      const x2 = first(g, '11'), y2 = first(g, '21');
      if ([x1, y1, x2, y2].some(v => v === undefined)) return [];
      return [{ closed: false, fill: false, pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }] }];
    }
    case 'CIRCLE': {
      const cx = first(g, '10'), cy = first(g, '20'), r = first(g, '40');
      if ([cx, cy, r].some(v => v === undefined)) return [];
      return [{ closed: true, fill: false, pts: arcPts(cx, cy, r, 0, 360) }];
    }
    case 'ARC': {
      const cx = first(g, '10'), cy = first(g, '20'), r = first(g, '40');
      const a0 = first(g, '50'), a1 = first(g, '51');
      if ([cx, cy, r].some(v => v === undefined)) return [];
      return [{ closed: false, fill: false, pts: arcPts(cx, cy, r, a0, a1) }];
    }
    case 'LWPOLYLINE': {
      const xs = g['10'] || [], ys = g['20'] || [];
      const n = Math.min(xs.length, ys.length);
      if (n < 2) return [];
      const closed = (parseInt(g['70']?.[0] || '0') & 1) === 1;
      const pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: num(xs[i]), y: num(ys[i]) });
      return [{ closed, fill: false, pts }];
    }
    case 'HATCH':
      return hatchLoops(e);
    default:
      return [];
  }
}

// Nette familienamen voor het geval het label generiek is ("Type 1").
const FAMILY_LABELS = {
  meterkast: 'Meterkast',
  bewegingsdetector: 'Bewegingsdetector',
  bel: 'Bel',
};

function familyOf(name) {
  const m = name.match(/NLRS_63_[A-Z]{2}_([a-z0-9]+)/i);
  return m ? m[1].toLowerCase() : 'overig';
}

// De legenda-teksten in de DXF gebruiken afkortingen ("enkelpol schak",
// "kinderbesc met beschermbev"). Voor nette palette-labels breiden we die
// per heel woord uit naar de volledige NL-term.
const ABBREV = {
  'schak': 'schakelaar',
  'enkelpol': 'enkelpolige',
  'kinderbesc': 'kinderbescherming',
  'beschermbev': 'beschermingsbegeleider',
};
function expandAbbrev(s) {
  s = s.replace(/[A-Za-zÀ-ÿ]+/g, w => ABBREV[w.toLowerCase()] || w);
  // Normaliseer "2 polige" → "2-polige" (consistent met "2-polige …").
  s = s.replace(/\b(\d+)\s+polige\b/g, '$1-polige');
  return s;
}

// ── Blocknaam → nette NL-label ─────────────────────────────────────────────
// "NLRS_63_GA_stopcontact_symb - 1 stopcontact-525581-M_63_01_..." → "Stopcontact"
function labelOf(name) {
  const fam = familyOf(name);
  let s = name;
  const dash = s.indexOf(' - ');
  if (dash >= 0) s = s.slice(dash + 3);          // deel na " - "
  s = s.replace(/-\d{4,}.*$/, '');               // trailing "-525581-M_63..."
  // Leidend getal is meestal een volgnummer ("1 schakelaar") en mag weg, MAAR
  // bij meervoud ("2 stopcontacten", "3 stopcontacten") is het een aantal dat
  // twee verschillende symbolen onderscheidt → dan behouden.
  const qty = s.match(/^\s*(\d+)\s+(\S*en)\b/);
  if (qty) s = s.replace(/^\s*(\d+)\s+/, '$1× ');
  else s = s.replace(/^\s*\d+\s+/, '');          // gewoon volgnummer weg
  s = s.replace(/\s+2$/, '');                     // dubbele-set-suffix " 2" (lichtpunt)
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  s = expandAbbrev(s);                             // afkortingen → volledige NL-term
  // Generiek "Type N" of leeg → gebruik de nette familienaam.
  if (!s || /^type\s+\d+$/i.test(s)) {
    const fl = FAMILY_LABELS[fam];
    if (fl) s = fl;
  }
  if (!s) s = name;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── SVG-generatie ──────────────────────────────────────────────────────────
function toSvg(paths) {
  // Bounding box over alle punten.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const pt of p.pts) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  const w = maxX - minX, h = maxY - minY;
  if (!(w > 0) && !(h > 0)) return null;
  const VB = 64, PAD = 6;
  const span = Math.max(w, h) || 1;
  const s = (VB - 2 * PAD) / span;
  // Centreer in viewBox; y-flip (DXF y-up → SVG y-down).
  const offX = PAD + (VB - 2 * PAD - w * s) / 2;
  const offY = PAD + (VB - 2 * PAD - h * s) / 2;
  const tx = x => +(offX + (x - minX) * s).toFixed(2);
  const ty = y => +(offY + (maxY - y) * s).toFixed(2);

  const strokeParts = [];
  const fillParts = [];
  for (const p of paths) {
    if (p.pts.length < 2) continue;
    let d = `M${tx(p.pts[0].x)} ${ty(p.pts[0].y)}`;
    for (let i = 1; i < p.pts.length; i++) d += `L${tx(p.pts[i].x)} ${ty(p.pts[i].y)}`;
    if (p.closed) d += 'Z';
    if (p.fill) fillParts.push(`<path d="${d}"/>`);
    else strokeParts.push(`<path d="${d}"/>`);
  }
  let inner = '';
  if (strokeParts.length) inner += `<g fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${strokeParts.join('')}</g>`;
  if (fillParts.length) inner += `<g fill="#000" stroke="none">${fillParts.join('')}</g>`;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// ── Hoofdroutine ───────────────────────────────────────────────────────────
function dxfFilesUnder(dir) {
  const st = statSync(dir);
  if (st.isFile()) return dir.toLowerCase().endsWith('.dxf') ? [dir] : [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...dxfFilesUnder(full));
    else if (name.toLowerCase().endsWith('.dxf')) out.push(full);
  }
  return out;
}

const symbols = [];
const usedIds = new Set();
const usedLabels = new Set();
let skipped = 0, deduped = 0;
const files = dxfFilesUnder(ROOT);
for (const file of files) {
  const blocks = parseBlocks(parsePairs(readFileSync(file, 'latin1')));
  for (const b of blocks) {
    if (!b.name || b.name.startsWith('*')) continue;           // layout-blokken
    if (!/NLRS/i.test(b.name)) continue;                       // alleen renvooi-symbolen
    const paths = b.ents.flatMap(entToPaths).filter(p => p.pts.length >= 2);
    if (!paths.length) { skipped++; continue; }
    const svg = toSvg(paths);
    if (!svg) { skipped++; continue; }
    const label = labelOf(b.name);
    // Sla exacte dubbele legenda-entries over (lichtpunt heeft een " 2"-set die
    // na normalisatie identiek is aan de reguliere set).
    if (usedLabels.has(label.toLowerCase())) { deduped++; continue; }
    usedLabels.add(label.toLowerCase());
    let id = 'elektra-' + slug(label);
    let k = 2;
    while (usedIds.has(id)) id = 'elektra-' + slug(label) + '-' + (k++);
    usedIds.add(id);
    symbols.push({ id, name: label, family: familyOf(b.name), svg });
  }
}

// Sorteer op familie + label voor een nette palette-volgorde.
const FAM_ORDER = ['stopcontact', 'schakelaar', 'lichtpunt', 'aansluitpunt', 'bel', 'meterkast', 'bewegingsdetector'];
symbols.sort((a, b) => {
  const fa = FAM_ORDER.indexOf(a.family), fb = FAM_ORDER.indexOf(b.family);
  const oa = fa < 0 ? 99 : fa, ob = fb < 0 ? 99 : fb;
  if (oa !== ob) return oa - ob;
  return a.name.localeCompare(b.name, 'nl', { numeric: true });
});

const out = symbols.map(({ id, name, svg }) => ({ id, name, svg }));
const header = `// AUTO-GEGENEREERD door scripts/dxf-elektra-convert.mjs — niet met de hand bewerken.
// Elektra-legendasymbolen (NLRS) omgezet uit de lokale elektra-renvooi-DXF naar
// statische SVG-stempels (viewBox 0 0 64 64, y-down). Regenereren met:
//   node scripts/dxf-elektra-convert.mjs "<pad naar .dxf of map>"

`;
writeFileSync(OUT, header + 'export const ELEKTRA_SYMBOLS = ' + JSON.stringify(out, null, 0) + ';\n');
console.log(`Wrote ${out.length} elektra-symbolen naar`, OUT.pathname, `(geen geometrie: ${skipped}, dubbel: ${deduped})`);
for (const s of out) console.log('  ', s.id, '—', s.name);
