# Testprotocol Open PDF Studio — alle functies via de MCP-server

**Doel:** elke knop en elke functie van de applicatie geautomatiseerd testen via
de MCP-server, met bewijs (state-probe en/of screenshot) per knop. Dit protocol
is de vaste poort vóór elke release; het vervangt losse ad-hoc-verificaties.

**Bouwt op bestaand werk:**
- `tests/protocol/runner.mjs` — scenario-runner (JSON-scenario's, probes,
  asserties, screenshots, rapport per run onder `tests/protocol/results/`)
- `tests/protocol/scenarios/01…03` — drie bestaande scenario's
- `scripts/verify-rotation-sweep.mjs` — all-PDF-weergavesweep (verplicht bij
  rendering/saver/rotatie-wijzigingen)
- MCP-server met 51 tools (openen, zoomen, navigeren, annotatie-CRUD, undo,
  save, screenshots, console-ring)

---

## 1. Principes

1. **Elke knop = minstens één scenario-stap** met een controleerbaar effect
   (state-verandering, dialoog geopend, annotatie aangemaakt, weergave
   veranderd). "Klik gaf geen fout" is onvoldoende.
2. **Schone staat per scenario**: elk scenario opent zijn eigen bestand of
   nieuw document; na afloop undo/sluiten zonder opslaan. Nooit originele
   testbestanden opslaan.
3. **Rood = blokkade**: een falend scenario blokkeert builds/pushes in het
   betrokken gebied, net als de rotatie-sweep.
4. **Nieuwe knop ⇒ scenario-plicht**: een PR die een knop toevoegt zonder
   scenario-uitbreiding is onvolledig.

## 2. Benodigde MCP-uitbreiding (eenmalig)

De ribbon-knoppen zijn niet allemaal als los MCP-tool ontsloten. Twee
generieke tools maken álles aanstuurbaar (registratie in
`src-tauri/src/mcp_server.rs` + handler in `js/mcp-bridge.js`; Rust-rebuild
vereist):

| Tool | Argumenten | Gedrag |
|---|---|---|
| `app_click_element` | `{selector}` (CSS, meestal `#knop-id`) | Activeert eerst de juiste ribbon-tab als de selector daarbinnen ligt, klikt het element, retourneert `{ok, disabled, found}` |
| `app_ui_state` | `{selector}` | Retourneert `{found, disabled, active, visible, text}` van het element |

Runner-uitbreiding: scenario-acties `clickButton {id}`, `uiState {id, store}`
en assertie-typen `elementEnabled` / `elementActive` / `dialogOpen {titel}`.

## 3. Dekkingsmatrix — alle knoppen per tab

Verwachtingsnotatie: **T**=tool actief (probe `state.currentTool`),
**D**=dialoog/paneel opent, **A**=annotatie/бewerking uitgevoerd (count/props),
**V**=viewport/weergave verandert (zoom/pagina/mode), **S**=selectie vereist
(scenario maakt eerst annotaties + selecteert via `app_select_annotation`),
**X**=alleen enabled/disabled-gedrag toetsbaar (bijv. vereist extern bestand).

### 3.1 Start (HomeTab)
`btn-home-new` D(nieuw document) · `btn-home-ifc-export` D/X · `btn-home-email` X (externe mail) · `btn-home-raster-pdf` D · `tool-hand`/`tool-select` T · `screenshot-split-btn` + `screenshot-menu-page/region/overlay` D/A · `zoom-in-ribbon`/`zoom-out-ribbon` V · `fit-width`/`actual-size-ribbon`/`fit-page-ribbon` V · `first-page`/`prev-page-ribbon`/`next-page-ribbon`/`last-page` V(pagina) · `ribbon-find` D(zoekbalk) · `ribbon-preferences` D

### 3.2 Beeld (ViewTab)
`single-page`/`continuous`/`book-view`/`facing-view` V(viewMode-probe) · `view-rotate-left`/`view-rotate-right` V(paginarotatie ±90, undo-baar) · `thin-lines-toggle` V(voorkeur-probe) · `ribbon-nav-panel`/`ribbon-properties-panel`/`ribbon-annotations-list`/`ribbon-element-visibility`/`ribbon-symbol-palette` D(paneel zichtbaar) · `ribbon-compare` D · `ribbon-fullscreen` V(fullscreen-state) · `ribbon-keystroke-overlay` D(overlay zichtbaar)

### 3.3 Tekenen (DrawingTab — 62 knoppen)
Gereedschappen (T): `dr-select dr-pan dr-line dr-arrow dr-spline-arrow dr-draw dr-rect dr-arc dr-polyline dr-hatch dr-text dr-note dr-spline dr-circle dr-ellipse dr-count dr-l-shape dr-image dr-cloud dr-leader dr-label dr-area dr-length dr-dimension dr-angular dr-radius dr-diameter dr-measure`
Selectie-acties (S→A): `dr-select-all dr-deselect dr-move dr-copy dr-mirror-h dr-mirror-v dr-array dr-rotate dr-trim dr-extend dr-split dr-align dr-explode dr-break dr-join dr-lengthen dr-delete dr-coll-create dr-coll-explode dr-cut dr-clip-copy dr-paste dr-paste-in-place`
Overig: `dr-find` D · `dr-remove-image` S/A · `btn-create-scale-region`(+`-full-page`) A(schaalgebied) · `dr-spot-coord dr-table dr-offset dr-fillet dr-chamfer dr-stretch` X (gepland werk — enabled-gedrag toetsen tot geïmplementeerd)

### 3.4 Annotatie (CommentTab)
`tool-highlight tool-textbox tool-callout tool-comment tool-stamp tool-signature tool-parametric-symbol tool-redaction` T · `btn-apply-redactions` S/A · `color-picker`/`line-width` D(popup) + effect op volgende annotatie · `tool-clear` S/A · `ribbon-clear-all` A(count→0, met bevestigingsdialoog) · `tool-measure-distance/-area/-perimeter/-angle` T · `btn-open-schedule` D(paneel)

### 3.5 PDF bewerken & samenvoegen (OrganizeTab)
`ep-edit-text` T(tekstbewerkmodus) · `ep-add-text` T · `ep-crop-margins` D · `ep-resize-pages` D · `ep-compress-pdf` D · `rotate-left`/`rotate-right` V · `insert-page` D · `delete-page` A(paginacount−1, op kopie!) · `extract-pages` D · `reorder-pages` D(thumbnails-paneel) · `merge-pdfs` D · `add-watermark`/`add-header-footer`/`manage-watermarks` D

### 3.6 Opmaak (FormatTab — contextueel, vereist selectie)
Scenario maakt eerst een rechthoek + selecteert die; daarna: `fmt-fill-color fmt-stroke-color` D(kleurkiezer) + props-effect · `fmt-line-width fmt-opacity fmt-border-style fmt-blend-mode fmt-arrow-start fmt-arrow-end` A(props-probe via `app_get_annotation`) · `fmt-style-gallery fmt-style-more fmt-style-tools` D · `fmt-edit-type` D · `fmt-reset-location` A · `fmt-open fmt-hide fmt-layer` A/V · indicatoren `fmt-fill-indicator fmt-stroke-indicator fmt-fill-icon-rect fmt-stroke-icon-rect` X(klikbaar, opent kiezer)

### 3.7 Afbeelding (ImageTab — contextueel)
Scenario voegt afbeelding-annotatie toe + selecteert: `img-crop` T(cropmodus) · `img-grayscale` A(props) · `img-brightness img-contrast` A(props) · `img-reset-adjust` A(props terug naar default)

### 3.8 Schikken (ArrangeTab — vereist ≥2 geselecteerde annotaties)
Scenario maakt 3 rechthoeken + select-all; daarna alle 26: uitlijnen (`arr-align-*`), verdelen (`arr-dist-*`), maatgelijk (`arr-same-*`), roteren/spiegelen (`arr-rotate-*`, `arr-flip-*`), z-orde (`arr-bring-*`, `arr-send-*`) — telkens A via positie/afmeting/z-orde-probes op de annotaties.

### 3.9 Help (HelpTab)
`ribbon-extensions ribbon-shortcuts ribbon-about ribbon-whats-new ribbon-startup-diagnostics` D · `ribbon-file-assoc` X(OS-dialoog — alleen enabled toetsen) · `ribbon-check-updates` D/X (handmatige check; netwerkafhankelijk — alleen klik + geen crash)

### 3.10 Buiten de ribbon (ook verplicht)
- Documenttabs: nieuwe tab (+), tab sluiten, tab wisselen (`app_switch_tab`)
- Statusbalk: paginanavigatie-invoer, zoomknoppen −/+, weergavemodusknoppen (4)
- Linkerpaneel-iconen (miniaturen, bladwijzers, commentaarlijst, lagen, …)
- Toolpalette: categorie openklappen + symbool activeren
- Eigenschappen-paneel: status-dropdown, kleurvelden
- Sneltoetsen-rooktest: Ctrl+O/S/Z/Y/F/A, Escape, Delete (via `app_key`)

## 4. Scenario-opbouw (fasen)

- **Fase A — knoppen-rooktest** (`scenarios/a-*`): per tab één scenario dat
  álle knoppen langsloopt: `clickButton` → verwachting uit de matrix →
  dialogen direct sluiten (Escape). Doel: geen dode knoppen, geen crashes,
  enabled/disabled klopt met en zonder document/selectie.
- **Fase B — functionele flows** (`scenarios/b-*`): per groep een echte flow
  met inhoudelijke asserties (bijv. tekenen→verplaatsen→undo→redo→opslaan op
  kopie→heropenen→props identiek; meten met gekalibreerde schaal; statussen
  round-trip; multi-select openen; vergelijken-sync).
- **Fase C — integratie**: `verify-rotation-sweep.mjs` (alle PDF's) + de
  bestaande scenario's 01-03 + round-trip-tests (`test-freetext-rotation`,
  `test-status-reply`).

## 5. Uitvoering

```bash
# 1. Rig starten (debug-binary, MCP op 9223)
#    zie docs: OPDS_DETACHED=1 OPS_ENABLE_MCP=1 …\open-pdf-studio.exe --mcp-server
# 2. Volledig protocol:
node tests/protocol/runner.mjs            # alle scenario's (A + B)
node scripts/verify-rotation-sweep.mjs    # fase C sweep
# 3. Deelrun:
node tests/protocol/runner.mjs a-drawing  # alleen de Tekenen-rooktest
```

Rapport per run onder `tests/protocol/results/<timestamp>/` (JSON + screenshots
+ samenvatting). Een release-kandidaat vereist: **alle scenario's groen + sweep
groen** op de release-commit.

## 6. Beheer

- Matrix hierboven is de bron van waarheid; runner rapporteert dekking
  (geteste knop-ids vs. ids in de codebase — `grep id=" ribbon/*.jsx`) zodat
  een nieuwe, ongeteste knop automatisch als GAT verschijnt in het rapport.
- Bekende beperkingen: OS-dialogen (bestand kiezen, printen, e-mail) zijn niet
  scriptbaar — die knoppen toetsen we op enabled-gedrag + dialoog-aanroep tot
  aan de OS-grens; de flows eromheen dekken we via directe MCP-tools
  (`app_open_pdf`, `app_save_pdf`, `app_merge_pdf`).
