# Pixel-Perfect PDF Text Rendering

## Doel

100% correcte tekst rendering in de open-pdf-render Rust crate door embedded font glyph outlines te extraheren als vector paden. Tekst wordt als bezier paden in de draw command stroom gezet — geen fillText(), geen system fonts, exacte weergave zoals het originele PDF.

## Architectuur

```
PDF content stream
    ↓ Tf operator (set font)
[FontRegistry] Zoek font in Resources → parse FontDescriptor → cache FontFile bytes
    ↓
[FontParser] Parse TrueType/Type1/CFF → extraheer glyph outlines per glyph index
    ↓ Tj/TJ operator (show text)
[EncodingResolver] Vertaal character codes → glyph indices
    ↓
[TextRenderer] Glyph outlines → bezier paden → DrawCommandBuffer
    ↓
Resultaat: MoveTo/LineTo/CubicTo/Fill commands in de draw stroom
```

## Nieuwe Modules

### 1. `src/fonts.rs` — Font Registry

Verantwoordelijk voor:
- Opzoeken van fonts in het Resources/Font dictionary
- Parsen van font dictionaries (BaseFont, Subtype, Encoding, FontDescriptor)
- Extraheren van embedded font bytes (FontFile, FontFile2, FontFile3)
- Caching van geparsede fonts per document (font naam → ParsedFont)

```rust
pub struct FontRegistry {
    fonts: HashMap<String, ParsedFont>,
}

pub struct ParsedFont {
    pub name: String,
    pub subtype: FontSubtype,
    pub encoding: Encoding,
    pub glyph_outlines: HashMap<u16, GlyphOutline>, // glyph index → outline
    pub char_to_glyph: HashMap<u8, u16>,             // char code → glyph index
    pub cid_to_glyph: Option<HashMap<u16, u16>>,     // CID → glyph index (Type0)
    pub widths: HashMap<u16, f32>,                     // glyph index → advance width
    pub units_per_em: u16,
}

pub enum FontSubtype {
    TrueType,
    Type1,
    Type0,    // CID composite
    Type3,    // PDF drawing operators
    CFF,      // OpenType/CFF
}

pub struct GlyphOutline {
    pub commands: Vec<OutlineCommand>,
    pub advance_width: f32,
}

pub enum OutlineCommand {
    MoveTo(f32, f32),
    LineTo(f32, f32),
    QuadTo(f32, f32, f32, f32),       // TrueType
    CubicTo(f32, f32, f32, f32, f32, f32), // Type1/CFF
    Close,
}
```

### 2. `src/font_parser.rs` — Glyph Outline Extraction

Verantwoordelijk voor:
- TrueType parsing via `ttf-parser` crate → quadratic bezier outlines
- Type1 CharString parsing → cubic bezier outlines
- CFF (Compact Font Format) parsing via `ttf-parser` → cubic bezier outlines
- Type3 font glyph rendering via recursieve content stream interpretatie

**TrueType** (FontFile2):
```rust
fn parse_truetype(font_data: &[u8]) -> Result<HashMap<u16, GlyphOutline>> {
    let face = ttf_parser::Face::parse(font_data, 0)?;
    let mut outlines = HashMap::new();
    for glyph_id in 0..face.number_of_glyphs() {
        let id = ttf_parser::GlyphId(glyph_id);
        let mut builder = OutlineBuilder::new();
        face.outline_glyph(id, &mut builder);
        outlines.insert(glyph_id, builder.finish());
    }
    Ok(outlines)
}
```

**Type1** (FontFile — PFB/PFA):
- Parse PFB header (binary) of PFA (ASCII)
- Decode eexec encrypted private dict
- Parse CharStrings: Type1 charstring operators (hlineto, vlineto, rrcurveto, etc.)
- Converteer naar OutlineCommand sequences

**CFF** (FontFile3):
- `ttf-parser` ondersteunt CFF outlines via dezelfde `outline_glyph` API
- Behandel als TrueType maar met cubic bezier outlines

**Type3** (PDF drawing operators per glyph):
- Elke glyph is een PDF content stream
- Recursief interpreteren met de bestaande interpreter
- Resultaat: draw commands per glyph, gecached

### 3. `src/encoding.rs` — Character Code → Glyph Index Mapping

Verantwoordelijk voor:
- Standaard encoding tabellen (WinAnsiEncoding, MacRomanEncoding, StandardEncoding)
- Custom Differences arrays
- ToUnicode CMap parsing
- CID mapping (Identity-H, Identity-V, custom CMaps)

**Standaard encodings** — hardcoded lookup tabellen:
```rust
pub fn win_ansi_to_glyph_name(code: u8) -> &'static str {
    match code {
        0x20 => "space",
        0x41 => "A",
        0x42 => "B",
        // ... volledige Windows-1252 tabel
        0xB0 => "degree",    // °
        0xB2 => "twosuperior", // ²
        0xB1 => "plusminus",   // ±
        _ => ".notdef",
    }
}
```

**Differences array** — overschrijft specifieke codes:
```rust
// /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding
//              /Differences [128 /Euro /bullet ...] >>
pub fn apply_differences(base: &Encoding, differences: &[Object]) -> Encoding {
    // Parse array: [code name name ... code name ...]
}
```

**CID mapping** (Type0 fonts):
```rust
pub fn identity_h_decode(bytes: &[u8]) -> Vec<u16> {
    // 2 bytes per character, big-endian
    bytes.chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect()
}
```

**ToUnicode CMap parsing:**
```rust
// Extracts beginbfchar/beginbfrange mappings
// <0041> <0041>  → glyph 0x41 = 'A'
pub fn parse_to_unicode(cmap_stream: &[u8]) -> HashMap<u16, char> { ... }
```

### 4. `src/text_renderer.rs` — Text → Glyph Outlines → Draw Commands

Verantwoordelijk voor:
- Vertalen van tekst strings naar glyph outline sequences
- Positionering: text matrix × font size × glyph advance widths
- Scaling: glyph coordinates (in font units) → PDF user space
- Output: MoveTo/LineTo/CubicTo/Fill commands naar DrawCommandBuffer

```rust
pub fn render_text_to_commands(
    text_bytes: &[u8],
    font: &ParsedFont,
    text_state: &TextState,
    buf: &mut DrawCommandBuffer,
) {
    let font_scale = text_state.font_size / font.units_per_em as f32;
    let mut x = text_state.tx;
    let y = text_state.ty;

    for &byte in text_bytes {
        let glyph_idx = font.char_to_glyph.get(&byte).copied().unwrap_or(0);
        if let Some(outline) = font.glyph_outlines.get(&glyph_idx) {
            // Transform glyph outline to PDF coordinates
            buf.save_state();
            buf.transform(font_scale, 0.0, 0.0, font_scale, x, y);

            // Apply text matrix
            buf.transform(
                text_state.tm[0], text_state.tm[1],
                text_state.tm[2], text_state.tm[3],
                0.0, 0.0,
            );

            // Emit glyph outline as draw commands
            buf.begin_path();
            for cmd in &outline.commands {
                match cmd {
                    OutlineCommand::MoveTo(px, py) => buf.move_to(*px, *py),
                    OutlineCommand::LineTo(px, py) => buf.line_to(*px, *py),
                    OutlineCommand::QuadTo(cx, cy, px, py) => {
                        // Convert quadratic to cubic bezier
                        // ... (standard conversion formula)
                        buf.cubic_to(/* ... */);
                    }
                    OutlineCommand::CubicTo(c1x, c1y, c2x, c2y, px, py) => {
                        buf.cubic_to(*c1x, *c1y, *c2x, *c2y, *px, *py);
                    }
                    OutlineCommand::Close => buf.close_path(),
                }
            }
            // Fill with current text color
            buf.set_fill(text_state.fill_color);
            buf.fill();
            buf.restore_state();

            // Advance position
            x += outline.advance_width * font_scale;
        }
    }
}
```

## PDF Font Types — Volledige Ondersteuning

| Font Type | Subtype | Glyph Data Bron | Parser |
|-----------|---------|-----------------|--------|
| TrueType | `/TrueType` | FontFile2 (TTF) | `ttf-parser` crate |
| OpenType/TrueType | `/TrueType` | FontFile2 (TTF in OTF) | `ttf-parser` crate |
| Type1 | `/Type1` | FontFile (PFB/PFA) | Eigen CharString parser |
| Type1C (CFF) | `/Type1` | FontFile3 (CFF) | `ttf-parser` CFF support |
| Type0/CID-TrueType | `/Type0` | CIDFont + FontFile2 | `ttf-parser` + CID mapping |
| Type0/CID-CFF | `/Type0` | CIDFont + FontFile3 | `ttf-parser` + CID mapping |
| Type3 | `/Type3` | PDF content streams | Recursieve interpreter |
| Standard 14 | `/Type1` | Geen FontFile (built-in) | Hardcoded metrics + system font fallback |

## Encoding Ondersteuning

| Encoding | Type | Implementatie |
|----------|------|---------------|
| WinAnsiEncoding | Standaard | Hardcoded lookup tabel (256 entries) |
| MacRomanEncoding | Standaard | Hardcoded lookup tabel |
| StandardEncoding | Standaard | Hardcoded lookup tabel |
| MacExpertEncoding | Standaard | Hardcoded lookup tabel |
| Identity-H | CID | 2-byte big-endian directe mapping |
| Identity-V | CID | 2-byte big-endian directe mapping (verticaal) |
| Custom Differences | Per-font | Parse Differences array uit Encoding dict |
| ToUnicode CMap | Unicode mapping | Parse beginbfchar/beginbfrange |
| Predefined CMaps | CID | Hardcoded voor veelvoorkomende (90ms-RKSJ-H, etc.) |

## PDF Versie Compatibiliteit

Alle versies PDF 1.0 t/m 2.0 worden ondersteund. De content stream operators zijn identiek in alle versies. Verschillen zitten in font embedding formaat:

- PDF 1.0-1.3: Type1, TrueType, standaard encodings
- PDF 1.4+: Tagged PDF, ToUnicode verplicht voor accessibility
- PDF 1.6+: OpenType/CFF embedding
- PDF 2.0: UTF-8 text strings in document metadata (niet in content streams)

## Dependencies

| Crate | Versie | Rol |
|-------|--------|-----|
| `ttf-parser` | latest | TrueType + OpenType/CFF glyph outline parsing |
| Bestaand: `lopdf` | 0.34 | PDF structure + font dict parsing |

Geen andere nieuwe dependencies. Type1 CharString parsing is eigen code (~200 regels).

## Fallback Strategie

Als een font niet geparsed kan worden (corrupt, onbekend formaat):
1. Probeer system font met dezelfde naam (via font naam matching)
2. Als geen match: gebruik "Helvetica" metrics met rechthoek-glyphs
3. Log een warning zodat de gebruiker weet welk font ontbreekt

De Standard 14 PDF fonts (Helvetica, Times, Courier, etc.) zijn NIET embedded in PDF's. Hiervoor gebruiken we hardcoded metrics + system font glyphs als fallback.

## Crate Structuur (na implementatie)

```
open-pdf-render/src/
├── lib.rs              # Publieke API
├── parser.rs           # PDF page parsing + content stream extraction
├── interpreter.rs      # Content stream interpreter (alle operators)
├── graphics_state.rs   # Graphics state stack
├── renderer.rs         # tiny-skia bitmap rendering (fallback)
├── draw_commands.rs    # Binary draw command buffer
├── color.rs            # Color space conversie
├── image_decode.rs     # Image decompression
├── fonts.rs            # NEW: Font registry + caching
├── font_parser.rs      # NEW: TrueType/Type1/CFF glyph extraction
├── encoding.rs         # NEW: PDF encoding tables + CMap parsing
└── text_renderer.rs    # NEW: Text → glyph outlines → draw commands
```

## Performance

| Operatie | Target | Hoe |
|----------|--------|-----|
| Font parsing (per font) | < 50ms | Eenmalig per font, gecached |
| Glyph lookup | < 0.01ms | HashMap lookup |
| Text rendering (per string) | < 1ms | Pre-cached glyph outlines |
| Totaal per pagina | < 100ms | Font cache hergebruik |

## Succes Criteria

1. Bouwtekeningen uit Allplan/AutoCAD/Revit — alle tekst pixel-perfect
2. Maatvoeringen — getallen exact op de juiste positie en grootte
3. Tekeningkader/stempel — alle tekst inclusief °, ², ±, €
4. CJK tekst — Japans/Chinees/Koreaans correct gerenderd
5. Glyph outlines — exacte match met embedded font, geen system font substitutie
6. Standard 14 fonts — leesbare fallback met correcte metrics
7. Type3 fonts — custom symbolen correct via recursieve interpretatie
8. Alle PDF versies 1.0-2.0 — geen versie-specifieke beperkingen
