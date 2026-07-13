# Testprotocol — Open PDF Studio op Linux

Handmatig testprotocol voor de Linux-build (AppImage / .deb) op **Ubuntu 24.04 /
X11 / AMD (radeonsi)**. Nadruk op **OS-specifieke** acties (opslaan, e-mailen,
printen, bestandsdialogen, GPU-rendering) en op het openen/renderen van diverse
PDF-bestanden.

- **Branch:** `main`, versie 1.71.0
- **Testmachine:** Linux 6.17, X11, GPU = AMD Ryzen 7 9700X iGPU (radeonsi),
  Node 20.20, standaard mailclient = Thunderbird
- **Testbestanden:** privé-repo `OpenAEC-Foundation/verification-files`
  → map `PDF-bestanden/` en `FEM2D/` (client-materiaal — **niet publiceren**,
  buiten de app-repo houden)

Vul per stap in: **✅ OK / ❌ Fout / ⚠️ Deels**. Noteer bij fouten het gedrag en
relevante regels uit de terminal (start de AppImage vanuit een terminal om de
`log::`-uitvoer te zien).

---

## 0. Build & installatie

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 0.1 | `APPIMAGE_EXTRACT_AND_RUN=1 npx tauri build --bundles appimage deb` | Bundelt zonder fatale fout; de niet-nul exit aan het eind is enkel de optionele updater-signing-stap (geen `TAURI_SIGNING_PRIVATE_KEY` lokaal) | |
| 0.2 | AppImage aanwezig | `src-tauri/target/release/bundle/appimage/Open PDF Studio_1.71.0_amd64.AppImage` (~97 MB) | |
| 0.3 | .deb aanwezig | `src-tauri/target/release/bundle/deb/*.deb` | |
| 0.4 | `libpdfium.so` in bundel | `usr/lib/Open PDF Studio/libpdfium.so` zit in de AppImage (bundle.resources uit `tauri.linux.conf.json`) | |
| 0.5 | .deb installeert schoon | `sudo apt install ./Open*_amd64.deb`; start via app-menu | |

> Start voor alle tests vanuit een terminal:
> `./Open\ PDF\ Studio_1.71.0_amd64.AppImage` — zo zie je de logregels.

---

## 1. Opstarten, venster & GPU-rendering

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 1.1 | App start | Venster opent met titel *"Open PDF Studio v1.71.0"*; UI (ribbon) laadt; log toont `[mcp-bridge] WebView ready` | |
| 1.2 | PDFium init | Log toont `PDFium initialised from ...` (géén `initialisation failed`) | |
| 1.3 | GPU-pad WebKitGTK | UI rendert vloeiend, geen zwart/blanco venster. Bij blanco venster (Wayland/Nvidia): herstart met `WEBKIT_DISABLE_DMABUF_RENDERER=1` — noteer of dit nodig was | |
| 1.4 | Hardware-GL beschikbaar | `glxinfo \| grep "OpenGL renderer"` toont de AMD radeonsi-renderer (referentie, niet in-app) | |
| 1.5 | Venster schalen/maximaliseren | Herschalen soepel, canvas herrendert scherp (geen wazige/uitgerekte pagina) | |
| 1.6 | HiDPI (indien beschikbaar) | Scherpe tekst/lijnen bij schaal 125/150/200 % | |
| 1.7 | Cursor-regel (CLAUDE.md) | Standaard-cursor overal, behálve boven het PDF-weergavegebied | |

---

## 2. PDF's openen & renderen (diverse bestanden)

Open elk bestand via **Bestand → Openen** (native GTK-dialoog). Controleer per
bestand: opent zonder crash, **eerste pagina rendert**, thumbnails vullen,
scrollen/paginawissel werkt, in-/uitzoomen scherp.

| # | Bestand (`PDF-bestanden/`) | ~Grootte | Karakter / waarop te letten | Res |
|---|----------------------------|----------|------------------------------|-----|
| 2.1 | `Tekst.pdf` | 158 KB | Puur tekst — basis-render, tekstselectie | |
| 2.2 | `Text pdf gecombineerd.pdf` | 1,7 MB | Tekst + elementen gecombineerd | |
| 2.3 | `rapport-constructie.pdf` | 1,7 MB | Rapport, meerdere pagina's, koppen/tabellen | |
| 2.4 | `Technische tekening.pdf` | 1,0 MB | Vectortekening — dunne lijnen scherp op zoom | |
| 2.5 | `Combinatie Raster, vector, tekening images.pdf` | 704 KB | Raster + vector + afbeeldingen gemengd | |
| 2.6 | `3131-CLT-Set.pdf` | 1,5 MB | Bouwkundige set, meerdere bladen | |
| 2.7 | `NKE2D2_opm_aw.pdf` | 5,9 MB | NL-tekening met opmerkingen/annotaties | |
| 2.8 | `Zware vector PDF.pdf` | 18 MB | **Zware vector** — let op rendertijd/geheugen, geen bevriezing | |
| 2.9 | `NKD1a_opm_aw.pdf` | 25 MB | Grote NL-tekening met annotaties | |
| 2.10 | `20260316 - Barn Relocation ... for Permit.pdf` | 27 MB | Grote architectuurset — smoke-referentie (1693×1191 render) | |
| 2.11 | `2885 Demo project.pdf` | 40 MB | **Grootste** — stresstest laadtijd/geheugen/scroll | |
| 2.12 | `FEM2D/Betonligger berekening.pdf`, `Calc 2.pdf`, `portal-frame.pdf` | — | Berekeningsrapporten (FEM2D-export) | |

Aandachtspunten:
- **NL/IFC-symbolen** in annotaties correct getoond (regressie uit 1.67.0).
- Meerdere PDF's tegelijk open → tabs/vensters stabiel.
- Paginawissel snel (miniatuur-placeholder + idle-prefetch, 1.66.0).

---

## 3. OS-specifiek: Opslaan / Opslaan als

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 3.1 | **Opslaan** (Ctrl+S) op bestaand bestand | Schrijft naar bestaand pad, geen dialoog; wijzigingen (annotaties) bewaard | |
| 3.2 | **Opslaan als** | Native GTK-opslagdialoog; kiezen van map/naam werkt; `.pdf`-extensie afgedwongen | |
| 3.3 | Opslaan van **nieuw/untitled** document | Vraagt om pad via dialoog (savePDF prompt) | |
| 3.4 | Opgeslagen bestand heropenen | Annotaties/wijzigingen aanwezig en correct gerenderd | |
| 3.5 | Opslaan naar map **zonder schrijfrechten** | Nette foutmelding, geen crash | |
| 3.6 | Annotaties zichtbaar in **andere viewer** | Open resultaat in `xdg-open` / evince / Firefox → annotaties + NL/IFC-symbolen correct (regressie 1.65.0/1.67.0) | |
| 3.7 | Bestandsnaam met **spaties/diacrieten** | Correct opslaan/openen (bv. testbestanden met spaties) | |

---

## 4. OS-specifiek: E-mailen

Op Linux roept `email_pdf` **`xdg-email --subject <naam> --attach <pad>`** aan →
opent een **concept** in de standaard mailclient (hier Thunderbird). De app
verstuurt zelf nooit; de gebruiker beoordeelt en verzendt.

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 4.1 | **Verzenden per e-mail** op opgeslagen PDF | Thunderbird opent met nieuw concept, PDF als **bijlage**, onderwerp = bestandsnaam | |
| 4.2 | E-mailen van **niet-opgeslagen** doc | Slaat eerst op (dialoog), daarna concept met bijlage | |
| 4.3 | Bijlage-inhoud | Bijlage is de **actuele** PDF incl. net gemaakte annotaties | |
| 4.4 | Standaard-mailclient = mailto-handler | `xdg-mime query default x-scheme-handler/mailto` → `thunderbird...` | |
| 4.5 | Geen mailclient geïnstalleerd | Nette foutmelding *"xdg-email niet beschikbaar"*, geen crash | |
| 4.6 | Groot bestand (bv. 2.11, 40 MB) | Concept opent; evt. grootte-waarschuwing van de mailclient (verwacht) | |

---

## 5. OS-specifiek: Printen

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 5.1 | **Afdrukken** (Ctrl+P) | Print-dialoog verschijnt (PrintDialog), voorbeeld correct | |
| 5.2 | Afdruk-**oriëntatie** | Portret/landschap correct (regressie 1.65.0) | |
| 5.3 | Afdrukvoorbeeld | Preview komt overeen met paginainhoud incl. annotaties | |
| 5.4 | Printen naar **PDF** (CUPS "Print to File") | Levert geldige PDF op | |
| 5.5 | **Raster-export**-knop | Exporteert pagina als raster (functie uit 1.65.0) | |

---

## 6. OS-specifiek: Bestandsdialogen, klembord, drag & drop

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 6.1 | **Openen**-dialoog | Native GTK-dialoog, `.pdf`-filter werkt | |
| 6.2 | **Drag & drop** PDF op venster | Bestand opent (tauri-plugin-drag) | |
| 6.3 | Kopiëren/plakken **Ctrl+C/V/Z** | Werkt in tekst/annotatievelden en op annotaties (regressie 1.68.0) | |
| 6.4 | Ctrl+klik-**kopie** van annotatie | Dupliceert annotatie (1.68.0) | |
| 6.5 | Tekst **selecteren & kopiëren** uit PDF | Selectie in `Tekst.pdf` naar systeemklembord | |
| 6.6 | Ingebedde **afbeelding selecteren/verwijderen** | Werkt (recente main-feature) | |
| 6.7 | Recent-bestanden / heropenen | Onthoudt en heropent laatste pad correct | |

---

## 7. Teken-/annotatiegereedschap (functioneel, platform-neutraal maar meetesten)

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 7.1 | Cirkel/ellipse-tekentool | Tekent correct (1.68.0) | |
| 7.2 | Vormen/lijnen/tekst-annotatie | Plaatsen, verplaatsen, schalen | |
| 7.3 | Pagina **roteren** | Rotatie klopt en blijft na opslaan (regressie 1.68.0) | |
| 7.4 | Zoom met muiswiel (voorkeur) | Instelbaar: met/zonder Ctrl (recente main-feature) | |
| 7.5 | Ribbon-labels | Breken alleen op woordgrenzen (recente main-fix) | |

---

## 8. Rendering-regressietest (geïsoleerd, zonder UI)

Verifieert PDFium-rendering los van de UI:

```bash
cd open-pdf-studio/src-tauri
OPEN_PDF_STUDIO_TEST_DLL_DIR=binaries/linux-x64 \
OPEN_PDF_STUDIO_TEST_PDF="/home/maarten/Documents/GitHub/verification-files/PDF-bestanden/20260316 - Barn Relocation - 389 E Hemenway Lane - for Permit.pdf" \
cargo test -p open-pdf-studio --release --test pdfium_smoke -- --nocapture
```

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 8.1 | Smoke-test Barn | `page 1 rendered: ...px, ... non-white pixels` (niet-blanco) | |
| 8.2 | Smoke-test op zware vector (2.8) | Rendert zonder fout | |
| 8.3 | `pdfium_region_smoke` | Slaagt | |

---

## 9. Robuustheid / randgevallen

| # | Actie | Verwacht | Res |
|---|-------|----------|-----|
| 9.1 | Beschadigde PDF openen | Nette foutmelding, geen crash (guard in `load_from_bytes`) | |
| 9.2 | Versleutelde/wachtwoord-PDF | Wachtwoordprompt of nette weigering | |
| 9.3 | PDFium ontbreekt (hernoem `libpdfium.so`) | App **start toch**, log `initialisation failed (rendering disabled)`, render toont nette fout i.p.v. crash (non-fataal init, #4) | |
| 9.4 | Zeer groot bestand (2.11, 40 MB) | Geen out-of-memory/bevriezing; blijft responsief | |
| 9.5 | App sluiten met niet-opgeslagen wijzigingen | Vraagt om opslaan | |

---

## Bevindingen

> Noteer hier per gefaalde stap: bestand, stap-#, waargenomen gedrag, relevante
> logregels, en of `WEBKIT_DISABLE_DMABUF_RENDERER=1` nodig was.
