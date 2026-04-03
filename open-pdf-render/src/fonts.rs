use std::collections::HashMap;
use lopdf::{Dictionary, Document, Object};
use crate::encoding;
use crate::font_parser::{self, ParsedFont};

/// Cached font entry with parsed outlines and encoding info.
pub struct FontEntry {
    pub parsed: Option<ParsedFont>,
    pub encoding_name: Option<String>,
    pub differences: HashMap<u8, String>,
    pub base_font: String,
}

/// Registry that caches font lookups per font name.
pub struct FontRegistry {
    fonts: HashMap<String, FontEntry>,
}

impl FontRegistry {
    pub fn new() -> Self {
        FontRegistry {
            fonts: HashMap::new(),
        }
    }

    /// Look up a font by name from the page Resources/Font dictionary.
    /// Caches results so each font is only parsed once.
    pub fn get_font<'a>(
        &'a mut self,
        name: &str,
        doc: &Document,
        resources: &Dictionary,
    ) -> Option<&'a FontEntry> {
        if self.fonts.contains_key(name) {
            return self.fonts.get(name);
        }

        // Look up font dictionary from Resources -> Font -> <name>
        let font_dict = Self::resolve_font_dict(name, doc, resources)?;

        // Extract base font name
        let base_font = font_dict
            .get(b"BaseFont")
            .ok()
            .and_then(|o| Self::resolve_obj(o, doc))
            .and_then(|o| match o {
                Object::Name(n) => Some(String::from_utf8_lossy(&n).to_string()),
                _ => None,
            })
            .unwrap_or_default();

        // Extract encoding info
        let (encoding_name, differences) = Self::extract_encoding(&font_dict, doc);

        // Try to extract and parse embedded font data
        let parsed = Self::extract_and_parse_font(&font_dict, doc);

        let entry = FontEntry {
            parsed,
            encoding_name,
            differences,
            base_font,
        };

        self.fonts.insert(name.to_string(), entry);
        self.fonts.get(name)
    }

    /// Resolve a character code to a glyph ID using the font entry.
    pub fn char_to_glyph_id(entry: &FontEntry, char_code: u8) -> Option<u16> {
        let parsed = entry.parsed.as_ref()?;

        // Resolve byte to Unicode character
        let ch = encoding::resolve_char_code(
            entry.encoding_name.as_deref(),
            &entry.differences,
            char_code,
        );

        // Look up in cmap
        let codepoint = ch as u32;
        parsed.cmap.get(&codepoint).copied()
    }

    /// Resolve the Font dictionary for a given font name from resources.
    fn resolve_font_dict(name: &str, doc: &Document, resources: &Dictionary) -> Option<Dictionary> {
        let font_res = resources.get(b"Font").ok()?;
        let font_res = Self::resolve_obj(font_res, doc)?;
        let font_dict_parent = match font_res {
            Object::Dictionary(d) => d.clone(),
            _ => return None,
        };

        let font_obj = font_dict_parent.get(name.as_bytes()).ok()?;
        let font_obj = Self::resolve_obj(font_obj, doc)?;
        match font_obj {
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        }
    }

    /// Extract encoding name and Differences array from font dictionary.
    fn extract_encoding(
        font_dict: &Dictionary,
        doc: &Document,
    ) -> (Option<String>, HashMap<u8, String>) {
        let enc_obj = match font_dict.get(b"Encoding") {
            Ok(o) => Self::resolve_obj(o, doc),
            Err(_) => None,
        };

        match enc_obj {
            Some(Object::Name(n)) => {
                let name = String::from_utf8_lossy(&n).to_string();
                (Some(name), HashMap::new())
            }
            Some(Object::Dictionary(d)) => {
                let enc_name = d
                    .get(b"BaseEncoding")
                    .ok()
                    .and_then(|o| Self::resolve_obj(o, doc))
                    .and_then(|o| match o {
                        Object::Name(n) => Some(String::from_utf8_lossy(&n).to_string()),
                        _ => None,
                    });

                let diffs = d
                    .get(b"Differences")
                    .ok()
                    .and_then(|o| Self::resolve_obj(o, doc))
                    .and_then(|o| match o {
                        Object::Array(arr) => Some(encoding::parse_differences(&arr)),
                        _ => None,
                    })
                    .unwrap_or_default();

                (enc_name, diffs)
            }
            _ => (None, HashMap::new()),
        }
    }

    /// Try to extract embedded font data (FontFile2 or FontFile3) and parse it.
    fn extract_and_parse_font(font_dict: &Dictionary, doc: &Document) -> Option<ParsedFont> {
        // Get FontDescriptor
        let desc_obj = font_dict.get(b"FontDescriptor").ok()?;
        let desc_obj = Self::resolve_obj(desc_obj, doc)?;
        let desc = match desc_obj {
            Object::Dictionary(d) => d,
            _ => return None,
        };

        // Try FontFile2 (TrueType), then FontFile3 (CFF/OpenType)
        let font_stream_obj = desc
            .get(b"FontFile2")
            .or_else(|_| desc.get(b"FontFile3"))
            .ok()?;

        let font_data = Self::get_stream_data(font_stream_obj, doc)?;

        match font_parser::parse_truetype(&font_data) {
            Ok(parsed) => Some(parsed),
            Err(_) => None,
        }
    }

    /// Get decompressed stream data from an object (possibly a reference).
    fn get_stream_data(obj: &Object, doc: &Document) -> Option<Vec<u8>> {
        let resolved = Self::resolve_obj(obj, doc)?;
        match resolved {
            Object::Stream(stream) => stream.decompressed_content().ok(),
            _ => None,
        }
    }

    /// Resolve an object reference, following indirect references.
    fn resolve_obj(obj: &Object, doc: &Document) -> Option<Object> {
        match obj {
            Object::Reference(id) => doc.get_object(*id).ok().cloned(),
            other => Some(other.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_font_registry_new() {
        let registry = FontRegistry::new();
        assert!(registry.fonts.is_empty());
    }

    #[test]
    fn test_char_to_glyph_id_no_parsed_font() {
        let entry = FontEntry {
            parsed: None,
            encoding_name: None,
            differences: HashMap::new(),
            base_font: "TestFont".to_string(),
        };
        assert_eq!(FontRegistry::char_to_glyph_id(&entry, b'A'), None);
    }
}
