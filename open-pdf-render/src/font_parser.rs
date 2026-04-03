use std::collections::HashMap;

/// A single outline command for a glyph.
#[derive(Debug, Clone)]
pub enum OutlineCommand {
    MoveTo(f32, f32),
    LineTo(f32, f32),
    CubicTo(f32, f32, f32, f32, f32, f32),
    Close,
}

/// Extracted glyph outline with advance width.
#[derive(Debug, Clone)]
pub struct GlyphOutline {
    pub commands: Vec<OutlineCommand>,
    pub advance_width: f32,
}

/// Parsed font data with glyph outlines and character mapping.
pub struct ParsedFont {
    pub units_per_em: u16,
    pub glyphs: HashMap<u16, GlyphOutline>,
    pub cmap: HashMap<u32, u16>,
}

/// Builder that implements ttf_parser::OutlineBuilder to collect outline commands.
struct OutlineCollector {
    commands: Vec<OutlineCommand>,
}

impl OutlineCollector {
    fn new() -> Self {
        OutlineCollector {
            commands: Vec::new(),
        }
    }
}

impl ttf_parser::OutlineBuilder for OutlineCollector {
    fn move_to(&mut self, x: f32, y: f32) {
        self.commands.push(OutlineCommand::MoveTo(x, y));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.commands.push(OutlineCommand::LineTo(x, y));
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        // Convert quadratic bezier to cubic bezier.
        // Given quadratic control point Q and endpoints P0 (last point), P2 (x,y):
        //   CP1 = P0 + 2/3 * (Q - P0)
        //   CP2 = P2 + 2/3 * (Q - P2)
        // We don't have P0 here, so we get it from the last command.
        let (p0x, p0y) = self.last_point();
        let cp1x = p0x + (2.0 / 3.0) * (x1 - p0x);
        let cp1y = p0y + (2.0 / 3.0) * (y1 - p0y);
        let cp2x = x + (2.0 / 3.0) * (x1 - x);
        let cp2y = y + (2.0 / 3.0) * (y1 - y);
        self.commands
            .push(OutlineCommand::CubicTo(cp1x, cp1y, cp2x, cp2y, x, y));
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.commands
            .push(OutlineCommand::CubicTo(x1, y1, x2, y2, x, y));
    }

    fn close(&mut self) {
        self.commands.push(OutlineCommand::Close);
    }
}

impl OutlineCollector {
    fn last_point(&self) -> (f32, f32) {
        for cmd in self.commands.iter().rev() {
            match cmd {
                OutlineCommand::MoveTo(x, y)
                | OutlineCommand::LineTo(x, y)
                | OutlineCommand::CubicTo(_, _, _, _, x, y) => return (*x, *y),
                OutlineCommand::Close => continue,
            }
        }
        (0.0, 0.0)
    }
}

/// Parse a TrueType/OpenType font from raw bytes.
/// Extracts glyph outlines and builds a Unicode-to-glyph-ID mapping.
pub fn parse_truetype(font_data: &[u8]) -> Result<ParsedFont, String> {
    let face =
        ttf_parser::Face::parse(font_data, 0).map_err(|e| format!("Failed to parse font: {}", e))?;

    let units_per_em = face.units_per_em();
    let num_glyphs = face.number_of_glyphs();

    let mut glyphs = HashMap::new();

    // Extract outlines for all glyphs
    for gid in 0..num_glyphs {
        let glyph_id = ttf_parser::GlyphId(gid);
        let advance_width = face
            .glyph_hor_advance(glyph_id)
            .unwrap_or(0) as f32;

        let mut collector = OutlineCollector::new();
        let has_outline = face.outline_glyph(glyph_id, &mut collector).is_some();

        if has_outline || advance_width > 0.0 {
            glyphs.insert(
                gid,
                GlyphOutline {
                    commands: collector.commands,
                    advance_width,
                },
            );
        }
    }

    // Build cmap: unicode codepoint -> glyph ID
    let mut cmap = HashMap::new();
    for codepoint in 0x0020u32..=0xFFFEu32 {
        if let Some(ch) = char::from_u32(codepoint) {
            if let Some(glyph_id) = face.glyph_index(ch) {
                if glyph_id.0 != 0 {
                    cmap.insert(codepoint, glyph_id.0);
                }
            }
        }
    }

    Ok(ParsedFont {
        units_per_em,
        glyphs,
        cmap,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ttf_parser::OutlineBuilder;

    #[test]
    fn test_outline_collector_quad_to_cubic() {
        let mut collector = OutlineCollector::new();
        collector.move_to(0.0, 0.0);
        collector.quad_to(50.0, 100.0, 100.0, 0.0);
        collector.close();

        assert_eq!(collector.commands.len(), 3);
        match &collector.commands[1] {
            OutlineCommand::CubicTo(x1, y1, x2, y2, x, y) => {
                // CP1 = (0,0) + 2/3*(50-0, 100-0) = (33.33, 66.67)
                assert!((x1 - 33.333).abs() < 0.01);
                assert!((y1 - 66.667).abs() < 0.01);
                // CP2 = (100,0) + 2/3*(50-100, 100-0) = (66.67, 66.67)
                assert!((x2 - 66.667).abs() < 0.01);
                assert!((y2 - 66.667).abs() < 0.01);
                assert_eq!(*x, 100.0);
                assert_eq!(*y, 0.0);
            }
            _ => panic!("Expected CubicTo"),
        }
    }
}
