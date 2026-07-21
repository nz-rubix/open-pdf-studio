"""Hulpscript voor de MuPDF-vergelijkings-sweep (verify-mupdf-compare.mjs).

Subcommando's (alle output is JSON op stdout):
  info   <pdf>                          -> {pages, sizes:[[w,h],...]}
  render <pdf> <outdir> <p1,p2,...>     -> rendert pagina's (schaal 1.0) als
                                           ref-p<N>.png en geeft per pagina het
                                           inkt-percentage terug
  compare <ref_png> <app_png>           -> cropt het paginavlak uit de
                                           app-screenshot, normaliseert beide
                                           naar NORM x NORM grijswaarden en geeft
                                           inkt- en occupancy-metrieken terug

Metriek-definities (gekalibreerd op de eerste sweep-run):
  - inkt-%      : fractie pixels met grijswaarde < DARK_T op de genormaliseerde
                  weergave (densiteit; gevoelig voor lijndikte-beleid).
  - occupancy   : 8x8-grid; per cel de fractie 'niet-witte' pixels (< PRES_T,
                  vangt ook tot lichtgrijs verdunde haarlijnen). Een cel telt
                  alleen als mismatch met hysterese: de ene kant duidelijk
                  bezet (> HYST_HI) en de andere kant duidelijk leeg
                  (< HYST_LO). Richting wordt gesplitst:
                    occ_miss  = cellen met inhoud in referentie, leeg in app
                                (kandidaat ontbrekende inhoud — ernstig)
                    occ_extra = cellen met inhoud in app, leeg in referentie
                                (meestal lijnverdikking bij sterke verkleining)
                  occ_match = 1 - (occ_miss + occ_extra) / 64.

Kalibratie-achtergrond: MuPDF rendert haarlijnen op schaal 1.0 getrouw dun;
bij verkleinen naar de vergelijkingsresolutie verdunnen die naar bijna-wit,
terwijl de app (raster-engine) bij kleine zoom een minimale lijndikte tekent.
Een symmetrische binaire occupancy op een 'donker'-drempel gaf daardoor
massaal vals-positieven op CAD-tekeningen. De niet-wit-drempel + hysterese +
richtingssplitsing houden echte ontbrekende inhoud (occ_miss) scherp
detecteerbaar en dempen het lijndikte-artefact.
"""
import json
import os
import sys

DARK_T = 200      # grijswaarde-drempel voor 'donkere' (inkt-)pixels
PRES_T = 242      # 'niet-wit'-drempel voor aanwezigheid van inhoud in een cel
NORM = 512        # normalisatie-resolutie (NORM x NORM)
GRID = 8          # occupancy-grid (8x8 cellen)
HYST_HI = 0.04    # cel duidelijk bezet boven deze niet-wit-fractie
HYST_LO = 0.01    # cel duidelijk leeg onder deze niet-wit-fractie


def cmd_info(pdf):
    import fitz
    doc = fitz.open(pdf)
    sizes = []
    for p in doc:
        r = p.rect  # incl. /Rotate, dus zoals een viewer de pagina toont
        sizes.append([round(r.width, 1), round(r.height, 1)])
    out = {"pages": doc.page_count, "sizes": sizes}
    doc.close()
    print(json.dumps(out))


def _ink(img, t=DARK_T):
    px = img.getdata()
    return 100.0 * sum(1 for v in px if v < t) / (NORM * NORM)


def _cell_fracs(img, t=PRES_T):
    px = list(img.getdata())
    cell = NORM // GRID
    dark = [1 if v < t else 0 for v in px]
    out = []
    for gy in range(GRID):
        for gx in range(GRID):
            s = 0
            for y in range(gy * cell, (gy + 1) * cell):
                base = y * NORM + gx * cell
                s += sum(dark[base:base + cell])
            out.append(s / (cell * cell))
    return out


def cmd_render(pdf, outdir, pages_csv):
    import fitz
    from PIL import Image
    os.makedirs(outdir, exist_ok=True)
    doc = fitz.open(pdf)
    result = {}
    for pno in [int(x) for x in pages_csv.split(",") if x]:
        page = doc[pno - 1]
        pm = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        dest = os.path.join(outdir, f"ref-p{pno}.png")
        pm.save(dest)
        img = Image.open(dest).convert("L").resize((NORM, NORM), Image.BILINEAR)
        result[str(pno)] = {"ink": round(_ink(img), 2), "w": pm.width, "h": pm.height}
    doc.close()
    print(json.dumps(result))


def _find_page_rect(img, bg_tol=15):
    """Zoek het paginavlak in een app-screenshot (canvas-only, effen bg).

    De achtergrondkleur wordt uit de vier hoeken bepaald (met fit-page ligt er
    altijd marge op minstens één as, dus de hoeken zijn achtergrond). Het
    paginavlak loopt van de eerste tot de laatste rij/kolom waarin een
    substantieel deel (>35%) van de pixels van de achtergrond afwijkt. Bewust
    géén strikte aaneengesloten-run-eis: pagina-rijen met bijna-achtergrond-
    kleurige vlakken (lichtgrijze celvulling e.d.) zouden zo'n run breken.
    """
    w, h = img.size
    px = img.load()
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))  # mediaan-achtig

    def differs(p):
        return (abs(p[0] - bg[0]) > bg_tol or abs(p[1] - bg[1]) > bg_tol
                or abs(p[2] - bg[2]) > bg_tol)

    # Sample-raster (elke 2 pixels) voor snelheid
    step = 2
    xs = range(0, w, step)
    ys = range(0, h, step)
    row_frac = []
    for y in ys:
        c = sum(1 for x in xs if differs(px[x, y]))
        row_frac.append(c / len(list(xs)))
    col_frac = []
    for x in xs:
        c = sum(1 for y in ys if differs(px[x, y]))
        col_frac.append(c / len(list(ys)))

    def span(fracs, thr=0.35):
        above = [i for i, f in enumerate(fracs) if f > thr]
        if not above:
            return (0, 0)
        return (above[0], above[-1] + 1)

    y0, y1 = span(row_frac)
    x0, x1 = span(col_frac)
    if x1 - x0 < 5 or y1 - y0 < 5:
        return None
    return (x0 * step, y0 * step, x1 * step, y1 * step)


def cmd_compare(ref_png, app_png):
    from PIL import Image
    ref_img = Image.open(ref_png).convert("L")
    rw, rh = ref_img.size
    ref = ref_img.resize((NORM, NORM), Image.BILINEAR)
    app_rgb = Image.open(app_png).convert("RGB")
    rect = _find_page_rect(app_rgb)
    out = {"crop": rect, "exp_aspect": round(rw / rh, 3)}
    if rect is None:
        out.update({"error": "paginavlak niet gevonden"})
        print(json.dumps(out))
        return
    crop = app_rgb.crop(rect)
    cw, ch = crop.size
    out["app_aspect"] = round(cw / ch, 3)
    app = crop.convert("L").resize((NORM, NORM), Image.BILINEAR)
    fr = _cell_fracs(ref)
    fa = _cell_fracs(app)
    miss = sum(1 for a, b in zip(fr, fa) if a > HYST_HI and b < HYST_LO)
    extra = sum(1 for a, b in zip(fr, fa) if b > HYST_HI and a < HYST_LO)
    ink_r = _ink(ref)
    ink_a = _ink(app)
    out.update({
        "ink_ref": round(ink_r, 2),
        "ink_app": round(ink_a, 2),
        "ink_diff": round(ink_a - ink_r, 2),
        "occ_miss": miss,
        "occ_extra": extra,
        "occ_match": round(1 - (miss + extra) / (GRID * GRID), 3),
    })
    # Bewaar de genormaliseerde crop naast de screenshot voor visuele inspectie.
    crop.save(app_png.replace(".png", "-crop.png"))
    print(json.dumps(out))


def main():
    cmd = sys.argv[1]
    if cmd == "info":
        cmd_info(sys.argv[2])
    elif cmd == "render":
        cmd_render(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "compare":
        cmd_compare(sys.argv[2], sys.argv[3])
    else:
        print(json.dumps({"error": f"onbekend commando {cmd}"}))
        sys.exit(2)


if __name__ == "__main__":
    main()
