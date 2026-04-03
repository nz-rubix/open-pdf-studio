use crate::font_parser::OutlineCommand;
use crate::fonts::{FontEntry, FontRegistry};
use crate::draw_commands::DrawCommandBuffer;

/// Render a text string as vector glyph outlines.
pub fn render_text_glyphs(
    text_bytes: &[u8],
    font_entry: &FontEntry,
    font_size: f32,
    tx: f32,
    ty: f32,
    fill_rgba: u32,
    buf: &mut DrawCommandBuffer,
) -> f32 {
    let parsed = match &font_entry.parsed {
        Some(p) => p,
        None => return 0.0,
    };
    let scale = font_size / parsed.units_per_em as f32;
    let mut advance = 0.0f32;

    for &byte in text_bytes {
        let glyph_id = match FontRegistry::char_to_glyph_id(font_entry, byte) {
            Some(id) => id,
            None => continue,
        };
        if let Some(outline) = parsed.glyphs.get(&glyph_id) {
            if !outline.commands.is_empty() {
                buf.save_state();
                buf.transform(scale, 0.0, 0.0, scale, tx + advance, ty);
                buf.begin_path();
                for cmd in &outline.commands {
                    match cmd {
                        OutlineCommand::MoveTo(x, y) => buf.move_to(*x, *y),
                        OutlineCommand::LineTo(x, y) => buf.line_to(*x, *y),
                        OutlineCommand::CubicTo(x1, y1, x2, y2, x, y) => {
                            buf.cubic_to(*x1, *y1, *x2, *y2, *x, *y)
                        }
                        OutlineCommand::Close => buf.close_path(),
                    }
                }
                buf.set_fill(fill_rgba);
                buf.fill();
                buf.restore_state();
            }
            advance += outline.advance_width * scale;
        }
    }
    advance
}
