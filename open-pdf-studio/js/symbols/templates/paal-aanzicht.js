// Parametric PILE ELEVATIONS (paal-aanzichten) — geometry taken from the
// local DXF component library (17 Palen, mm, y-down after flip).
//
// Two fixed types (same drawing convention, different width/point curve):
//   Type 1 — 168 wide   Type 2 — 250 wide
// Shape: straight shaft below ground level, a dashed head sticking 30 above
// it, and a curved tip at the bottom: open arc on the left half, solid
// filled lens on the right half (the classic NL pile-elevation symbol).
//
// Same contract as the steel/floor templates: fixed real-world size
// (geometry × schaal, no graphic resize handles), scale-region aware via
// realSizeMm, snappable corners/centre.

const _snapPoints = (params, bbox) => {
  const { x, y, width: w, height: h } = bbox;
  return [
    { kind: 'center', x: x + w / 2, y: y + h / 2 },
    { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
    { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
    { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
    { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
  ];
};

function _schaalOf(params) {
  const v = parseFloat(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

// Sample a circular arc between (x1,y) and (x2,y) with sagitta `sag`
// (positive = bulge downward in y-down space). Returns N+1 points.
function _arcPts(x1, x2, y, sag, n = 16) {
  const c = Math.abs(x2 - x1);
  const r = (c * c) / (8 * Math.abs(sag)) + Math.abs(sag) / 2;
  const cx = (x1 + x2) / 2;
  const cy = sag > 0 ? y + sag - r : y + sag + r; // centre opposite the bulge
  const a1 = Math.atan2(y - cy, x1 - cx);
  const a2 = Math.atan2(y - cy, x2 - cx);
  // Walk the SHORT way around (these are shallow arcs, |Δ| < π).
  let d = a2 - a1;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + (d * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// Geometry constants from the DXF blocks (units = mm in the source drawing).
const _PAAL_TYPES = {
  1: { b: 168, kop: 30, schacht: 300, sagLens: 10.36, sagOpen: 11.76 },
  2: { b: 250, kop: 30, schacht: 300, sagLens: 21.53, sagOpen: 21.5 },
};

function _paalTemplate(typeNr) {
  const g = _PAAL_TYPES[typeNr];
  const H = g.kop + g.schacht + g.sagOpen; // local drawing height
  return {
    id: `paal-aanzicht-type-${typeNr}`,
    name: `Paal aanzicht type ${typeNr}`,
    nameEn: `Pile elevation type ${typeNr}`,
    category: 'NL Constructie',
    defaultSize: { width: 40, height: 80 },
    fixedSize: true,
    params: [
      { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
    ],
    realSizeMm(params) {
      const f = _schaalOf(params);
      return { width: g.b * f, height: H * f };
    },
    snapPoints: _snapPoints,
    render(params, bbox) {
      const s = Math.min(bbox.width / g.b, bbox.height / H);
      const x0 = bbox.x + (bbox.width - g.b * s) / 2;
      const y0 = bbox.y + (bbox.height - H * s) / 2;
      const X = (v) => x0 + v * s;
      const Y = (v) => y0 + v * s;
      const half = g.b / 2;
      const yTop = 0;           // top of the dashed head
      const yMv = g.kop;        // ground level (maaiveld)
      const yBot = g.kop + g.schacht; // bottom of the straight shaft
      const cmds = [];

      // Dashed head above ground level (3 sides of a small rectangle).
      const dash = [6 * s, 4 * s];
      cmds.push({ kind: 'line', x1: X(0), y1: Y(yMv), x2: X(0), y2: Y(yTop), dash });
      cmds.push({ kind: 'line', x1: X(0), y1: Y(yTop), x2: X(g.b), y2: Y(yTop), dash });
      cmds.push({ kind: 'line', x1: X(g.b), y1: Y(yTop), x2: X(g.b), y2: Y(yMv), dash });

      // Straight shaft sides.
      cmds.push({ kind: 'line', x1: X(0), y1: Y(yMv), x2: X(0), y2: Y(yBot) });
      cmds.push({ kind: 'line', x1: X(g.b), y1: Y(yMv), x2: X(g.b), y2: Y(yBot) });

      // Curved tip — left half: open arc bulging down.
      const left = _arcPts(0, half, yBot, g.sagOpen).map(p => ({ x: X(p.x), y: Y(p.y) }));
      cmds.push({ kind: 'polyline', points: left });

      // Curved tip — right half: solid filled lens (arc down + arc back up).
      const lensDown = _arcPts(half, g.b, yBot, g.sagLens);
      const lensUp = _arcPts(g.b, half, yBot, -g.sagLens);
      const lens = [...lensDown, ...lensUp.slice(1)].map(p => ({ x: X(p.x), y: Y(p.y) }));
      cmds.push({ kind: 'polyline', points: lens, close: true, fill: '#1a1a1a' });

      return cmds;
    },
  };
}

export const paalType1Template = _paalTemplate(1);
export const paalType2Template = _paalTemplate(2);
