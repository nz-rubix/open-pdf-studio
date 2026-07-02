use anyhow::{anyhow, Context, Result};
use pdfium_render::prelude::*;
use std::sync::OnceLock;

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

// Eén Pdfium-instantie voor de levensduur van de worker. Nodig om geladen
// documenten te kunnen CACHEN: PdfDocument leent van Pdfium, en via een
// 'static Pdfium krijgt de handle een 'static levensduur (zelfde patroon als
// pdfium_renderer.rs in de app). NB: pdfium-render staat maar ÉÉN binding per
// proces toe (PdfiumLibraryBindingsAlreadyInitialized) — alles loopt dus via
// deze ene instantie.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

fn pdfium() -> Result<&'static Pdfium> {
    if PDFIUM.get().is_none() {
        let bindings = Pdfium::bind_to_system_library()
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./")))
            .context("PDFium DLL not found (system or ./)")?;
        let _ = PDFIUM.set(Pdfium::new(bindings));
    }
    Ok(PDFIUM.get().expect("PDFIUM set above"))
}

/// Gecachet geladen document. Houdt de bytes levend voor de document-
/// levensduur; veldvolgorde is belangrijk (document dropt vóór bytes).
///
/// Safety: `document` leent uit `_bytes` (heap-buffer verplaatst niet, ook
/// niet als de struct move't) en uit PDFIUM ('static, nooit gedropt). De
/// bytes leven per constructie langer dan het document binnen deze struct.
struct CachedDoc {
    path: String,
    mtime: Option<std::time::SystemTime>,
    len: u64,
    document: PdfDocument<'static>,
    _bytes: Vec<u8>,
}

/// Max gecachete documenten per worker. Zware CAD-documenten kunnen honderden
/// MB's parse-state dragen; 2 dekt "actief document + vergelijk-/vorig doc"
/// zonder het werkgeheugen te laten ontsporen.
const DOC_CACHE_CAP: usize = 2;

pub struct Renderer {
    cache: Vec<CachedDoc>,
}

impl Renderer {
    pub fn new() -> Result<Self> {
        // Bind PDFium meteen zodat een ontbrekende DLL bij worker-start faalt
        // (Ready wordt dan nooit gemeld) i.p.v. pas bij de eerste render.
        pdfium()?;
        Ok(Self { cache: Vec::new() })
    }

    /// Cache-lookup met verversing: hit alleen als pad + mtime + lengte
    /// overeenkomen (het bestand kan herschreven zijn door opslaan van
    /// annotaties). Miss → lees + parse en evict de oudste boven de cap.
    /// De parse van een zwaar CAD-document kost seconden — deze cache is
    /// wat regio-tegels goedkoop maakt.
    fn get_or_load(&mut self, path: &str) -> Result<usize> {
        let meta = std::fs::metadata(path).with_context(|| format!("stat {}", path))?;
        let mtime = meta.modified().ok();
        let len = meta.len();

        if let Some(i) = self.cache.iter().position(|c| c.path == path && c.mtime == mtime && c.len == len) {
            return Ok(i);
        }
        // Verouderde versie van hetzelfde pad weggooien.
        self.cache.retain(|c| c.path != path);

        let bytes = std::fs::read(path).with_context(|| format!("read {}", path))?;
        // Safety: zie CachedDoc — buffer-adres is stabiel en de bytes blijven
        // in dezelfde struct levend zolang het document bestaat.
        let bytes_ref: &'static [u8] = unsafe { std::slice::from_raw_parts(bytes.as_ptr(), bytes.len()) };
        let document = pdfium()?
            .load_pdf_from_byte_slice(bytes_ref, None)
            .map_err(|e| anyhow!("PDFium parse: {}", e))?;

        if self.cache.len() >= DOC_CACHE_CAP {
            self.cache.remove(0);
        }
        self.cache.push(CachedDoc {
            path: path.to_string(),
            mtime,
            len,
            document,
            _bytes: bytes,
        });
        Ok(self.cache.len() - 1)
    }

    pub fn render(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<RenderResult> {
        let idx = self.get_or_load(path)?;
        let doc = &self.cache[idx].document;
        let pages = doc.pages();
        let page = pages.get(page_index as i32)
            .map_err(|e| anyhow!("page {}: {}", page_index, e))?;

        let w_pt = page.width().value;
        let h_pt = page.height().value;
        let target_w = (w_pt * scale).ceil() as i32;
        let target_h = (h_pt * scale).ceil() as i32;

        let rot = match rotation.rem_euclid(360) {
            0 => PdfPageRenderRotation::None,
            90 => PdfPageRenderRotation::Degrees90,
            180 => PdfPageRenderRotation::Degrees180,
            270 => PdfPageRenderRotation::Degrees270,
            other => return Err(anyhow!("unsupported rotation {}", other)),
        };

        let config = PdfRenderConfig::new()
            .set_target_width(target_w)
            .set_maximum_height(target_h)
            .rotate(rot, true)
            .render_form_data(true)
            .render_annotations(false)
            .use_lcd_text_rendering(true)
            .set_format(PdfBitmapFormat::BGRA);

        let bitmap = page.render_with_config(&config)
            .map_err(|e| anyhow!("PDFium render: {}", e))?;

        Ok(RenderResult {
            width: bitmap.width() as u32,
            height: bitmap.height() as u32,
            rgba: bitmap.as_rgba_bytes(),
        })
    }

    /// Render a sub-region of a page at `scale` into an output bitmap of
    /// (region_w_pt*scale × region_h_pt*scale) px. `rotation` (extra
    /// gebruikersrotatie) must be 0.
    ///
    /// De regio-coördinaten komen uit de viewer in WEERGAVE-ruimte (na de
    /// intrinsieke /Rotate van de pagina). De matrix-API van PDFium werkt
    /// in RUWE paginaruimte, dus voor /Rotate-pagina's wordt de rotatie in
    /// de matrix meegebakken.
    pub fn render_region(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        region_x_pt: f32,
        region_y_pt: f32,
        region_w_pt: f32,
        region_h_pt: f32,
    ) -> Result<RenderResult> {
        if rotation != 0 {
            return Err(anyhow!("render_region: rotation {} not supported", rotation));
        }
        if region_w_pt <= 0.0 || region_h_pt <= 0.0 {
            return Err(anyhow!("render_region: region must be positive"));
        }
        let idx = self.get_or_load(path)?;
        let doc = &self.cache[idx].document;
        let pages = doc.pages();
        let page = pages.get(page_index as i32)
            .map_err(|e| anyhow!("page {}: {}", page_index, e))?;

        let bitmap_w = (region_w_pt * scale).ceil() as i32;
        let bitmap_h = (region_h_pt * scale).ceil() as i32;
        if bitmap_w <= 0 || bitmap_h <= 0 {
            return Err(anyhow!("render_region: invalid bitmap {}x{}", bitmap_w, bitmap_h));
        }

        // De matrix van FPDF_RenderPageBitmapWithMatrix werkt in WEERGAVE-ruimte
        // (ná de intrinsieke /Rotate van de pagina), y-omlaag vanaf linksboven —
        // exact de ruimte waarin de viewer regio's aanlevert. Empirisch
        // vastgesteld met hoek-probes op /Rotate=0- én /Rotate=90-pagina's
        // (titelblok/logo-ankers): een plain schaal+translatie-matrix levert
        // voor élke paginarotatie de juiste tegel. Geen rotatie-mapping nodig.
        let config = PdfRenderConfig::new()
            .set_fixed_size(bitmap_w, bitmap_h)
            .transform(scale, 0.0, 0.0, scale, -region_x_pt * scale, -region_y_pt * scale)
            .map_err(|e2| anyhow!("invalid transform: {}", e2))?
            .render_annotations(false)
            .use_lcd_text_rendering(true)
            .set_format(PdfBitmapFormat::BGRA);

        let bitmap = page.render_with_config(&config)
            .map_err(|e| anyhow!("PDFium region render: {}", e))?;

        Ok(RenderResult {
            width: bitmap.width() as u32,
            height: bitmap.height() as u32,
            rgba: bitmap.as_rgba_bytes(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn renders_a4_at_scale_1() {
        let _r = Renderer::new();
    }
}
