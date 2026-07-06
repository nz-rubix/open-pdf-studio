//! Corpus-pixel-diff: onze parallelle tegel-rasterizer vs PDFium-referentie,
//! over alle testbestanden. Gate voor de zwaar-blad-router (fase 2, trap b).
//!
//! Referentie: pdfium.dll via libloading (raw FPDF), BGRA → wit-composiet RGB.
//! Kandidaat: extract_draw_commands → TileScene (512px-tegels) → wit-composiet.
//! Metriek per pagina: % pixels met max-kanaal-delta > 16, gemiddelde delta.
//!
//! Gebruik: corpus_diff <map-of-pdf> [nog een map/pdf ...]

use libloading::{Library, Symbol};
use open_pdf_render::tile_render::TileScene;
use std::ffi::CString;
use std::os::raw::{c_char, c_double, c_int, c_void};
use std::path::{Path, PathBuf};
use std::time::Instant;

const TARGET_LONG_PX: f32 = 1400.0;
const DELTA_THRESH: i32 = 16;

struct Fpdf {
    _lib: &'static Library,
    load_doc: Symbol<'static, unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_void>,
    close_doc: Symbol<'static, unsafe extern "C" fn(*mut c_void)>,
    page_count: Symbol<'static, unsafe extern "C" fn(*mut c_void) -> c_int>,
    load_page: Symbol<'static, unsafe extern "C" fn(*mut c_void, c_int) -> *mut c_void>,
    close_page: Symbol<'static, unsafe extern "C" fn(*mut c_void)>,
    page_w: Symbol<'static, unsafe extern "C" fn(*mut c_void) -> c_double>,
    page_h: Symbol<'static, unsafe extern "C" fn(*mut c_void) -> c_double>,
    bmp_create: Symbol<'static, unsafe extern "C" fn(c_int, c_int, c_int) -> *mut c_void>,
    bmp_destroy: Symbol<'static, unsafe extern "C" fn(*mut c_void)>,
    bmp_fill: Symbol<'static, unsafe extern "C" fn(*mut c_void, c_int, c_int, c_int, c_int, u32)>,
    render: Symbol<'static, unsafe extern "C" fn(*mut c_void, *mut c_void, c_int, c_int, c_int, c_int, c_int, c_int)>,
    bmp_buffer: Symbol<'static, unsafe extern "C" fn(*mut c_void) -> *mut c_void>,
    bmp_stride: Symbol<'static, unsafe extern "C" fn(*mut c_void) -> c_int>,
}

impl Fpdf {
    fn load(dll: &str) -> Result<Self, String> {
        unsafe {
            let lib = Box::leak(Box::new(Library::new(dll).map_err(|e| e.to_string())?));
            let init: Symbol<unsafe extern "C" fn()> =
                lib.get(b"FPDF_InitLibrary\0").map_err(|e| e.to_string())?;
            init();
            Ok(Fpdf {
                load_doc: lib.get(b"FPDF_LoadDocument\0").map_err(|e| e.to_string())?,
                close_doc: lib.get(b"FPDF_CloseDocument\0").map_err(|e| e.to_string())?,
                page_count: lib.get(b"FPDF_GetPageCount\0").map_err(|e| e.to_string())?,
                load_page: lib.get(b"FPDF_LoadPage\0").map_err(|e| e.to_string())?,
                close_page: lib.get(b"FPDF_ClosePage\0").map_err(|e| e.to_string())?,
                page_w: lib.get(b"FPDF_GetPageWidth\0").map_err(|e| e.to_string())?,
                page_h: lib.get(b"FPDF_GetPageHeight\0").map_err(|e| e.to_string())?,
                bmp_create: lib.get(b"FPDFBitmap_Create\0").map_err(|e| e.to_string())?,
                bmp_destroy: lib.get(b"FPDFBitmap_Destroy\0").map_err(|e| e.to_string())?,
                bmp_fill: lib.get(b"FPDFBitmap_FillRect\0").map_err(|e| e.to_string())?,
                render: lib.get(b"FPDF_RenderPageBitmap\0").map_err(|e| e.to_string())?,
                bmp_buffer: lib.get(b"FPDFBitmap_GetBuffer\0").map_err(|e| e.to_string())?,
                bmp_stride: lib.get(b"FPDFBitmap_GetStride\0").map_err(|e| e.to_string())?,
                _lib: lib,
            })
        }
    }

    /// Render pagina → RGB op witte achtergrond + (w, h, pt-afmetingen).
    fn render_rgb(&self, path: &str, page: usize, scale: f32) -> Result<(u32, u32, Vec<u8>), String> {
        unsafe {
            let cpath = CString::new(path).map_err(|e| e.to_string())?;
            let doc = (self.load_doc)(cpath.as_ptr(), std::ptr::null());
            if doc.is_null() {
                return Err("FPDF_LoadDocument null".into());
            }
            let n = (self.page_count)(doc);
            if page as c_int >= n {
                (self.close_doc)(doc);
                return Err(format!("pagina {} > count {}", page, n));
            }
            let pg = (self.load_page)(doc, page as c_int);
            if pg.is_null() {
                (self.close_doc)(doc);
                return Err("FPDF_LoadPage null".into());
            }
            let w = ((self.page_w)(pg) as f32 * scale).ceil().max(1.0) as c_int;
            let h = ((self.page_h)(pg) as f32 * scale).ceil().max(1.0) as c_int;
            let bmp = (self.bmp_create)(w, h, 0);
            if bmp.is_null() {
                (self.close_page)(pg);
                (self.close_doc)(doc);
                return Err("FPDFBitmap_Create null".into());
            }
            (self.bmp_fill)(bmp, 0, 0, w, h, 0xFFFF_FFFF);
            (self.render)(bmp, pg, 0, 0, w, h, 0, 0);
            let stride = (self.bmp_stride)(bmp) as usize;
            let buf = (self.bmp_buffer)(bmp) as *const u8;
            let mut rgb = vec![0u8; w as usize * h as usize * 3];
            for y in 0..h as usize {
                let row = std::slice::from_raw_parts(buf.add(y * stride), w as usize * 4);
                for x in 0..w as usize {
                    // BGRA (opaque na FillRect) → RGB
                    let d = &mut rgb[(y * w as usize + x) * 3..(y * w as usize + x) * 3 + 3];
                    d[0] = row[x * 4 + 2];
                    d[1] = row[x * 4 + 1];
                    d[2] = row[x * 4];
                }
            }
            (self.bmp_destroy)(bmp);
            (self.close_page)(pg);
            (self.close_doc)(doc);
            Ok((w as u32, h as u32, rgb))
        }
    }
}

/// Onze kant: premultiplied RGBA → wit-composiet RGB.
fn ours_rgb(page: &open_pdf_render::RenderedPage) -> Vec<u8> {
    let mut rgb = vec![0u8; page.width as usize * page.height as usize * 3];
    for (i, px) in page.rgba.chunks_exact(4).enumerate() {
        let a = px[3] as u32;
        // premultiplied over wit: c + (255 - a)
        rgb[i * 3] = (px[0] as u32 + (255 - a)).min(255) as u8;
        rgb[i * 3 + 1] = (px[1] as u32 + (255 - a)).min(255) as u8;
        rgb[i * 3 + 2] = (px[2] as u32 + (255 - a)).min(255) as u8;
    }
    rgb
}

fn collect_pdfs(args: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for a in args {
        let p = Path::new(a);
        if p.is_dir() {
            if let Ok(rd) = std::fs::read_dir(p) {
                for e in rd.flatten() {
                    let f = e.path();
                    if f.extension().map_or(false, |x| x.eq_ignore_ascii_case("pdf")) {
                        out.push(f);
                    }
                }
            }
        } else if p.is_file() {
            out.push(p.to_path_buf());
        }
    }
    out.sort();
    out
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dll = "C:/Users/rickd/AppData/Local/Temp/opds-tile-wt/open-pdf-studio/src-tauri/binaries/win-x64/pdfium.dll";
    let fpdf = Fpdf::load(dll).expect("pdfium.dll laden");
    let pdfs = collect_pdfs(&args);
    println!("corpus: {} bestanden\n", pdfs.len());
    println!("{:<44} {:>5} {:>9} {:>9} {:>8} {:>8} {:>8}", "bestand", "pag", "ref ms", "tile ms", ">16 %", "gem d", "status");

    let mut worst: Vec<(f64, String)> = Vec::new();
    let mut csv = String::from("bestand	pagina	content_bytes	buffer_bytes	ref_ms	extract_ms	index_ms	render_ms	diff_pct	ds_diff_pct
");
    for pdf in &pdfs {
        let name = pdf.file_name().unwrap().to_string_lossy().to_string();
        let short: String = name.chars().take(42).collect();
        let bytes = match std::fs::read(pdf) {
            Ok(b) => b,
            Err(e) => { println!("{:<44} {:>5} lees-fout: {}", short, "-", e); continue; }
        };

        // Kandidaat-document één keer laden
        let doc = match open_pdf_render::DocumentHandle::load(&bytes) {
            Ok(d) => d,
            Err(e) => { println!("{:<44} {:>5} onze load-fout: {:?}", short, "-", e); continue; }
        };
        let pages_total = doc.page_count();
        let test_pages: Vec<usize> = (0..pages_total.min(8)).collect();

        for &pg in &test_pages {
            let (w_pt, h_pt) = match doc.page_dimensions(pg) {
                Ok(d) => d,
                Err(e) => { println!("{:<44} {:>5} dims-fout: {:?}", short, pg + 1, e); continue; }
            };
            let scale = (TARGET_LONG_PX / w_pt.max(h_pt)).min(2.0);

            let tr = Instant::now();
            let refr = match fpdf.render_rgb(&pdf.to_string_lossy(), pg, scale) {
                Ok(r) => r,
                Err(e) => { println!("{:<44} {:>5} ref-fout: {}", short, pg + 1, e); continue; }
            };
            let ref_ms = tr.elapsed().as_millis();

            let te = Instant::now();
            let extracted = doc.extract_draw_commands(pg, 0).map(|b| b.into_bytes());
            let extract_ms = te.elapsed().as_millis();
            let (scene, buf_len, index_ms) = match extracted {
                Ok(bytes) => {
                    let n = bytes.len();
                    let ti = Instant::now();
                    match TileScene::build(bytes) {
                        Ok(sc) => (Some(sc), n, ti.elapsed().as_millis()),
                        Err(e) => { println!("{:<44} {:>5} scene-fout: {}", short, pg + 1, e); continue; }
                    }
                }
                Err(e) => { println!("{:<44} {:>5} extract-fout: {:?}", short, pg + 1, e); continue; }
            };
            let scene = scene.unwrap();
            let tr2 = Instant::now();
            let ours = scene.render_full_parallel(scale, 512);
            let render_ms = tr2.elapsed().as_millis();
            let tile_ms = extract_ms + index_ms + render_ms;

            if ours.width != refr.0 || ours.height != refr.1 {
                println!("{:<44} {:>5} maten verschillen: {}x{} vs {}x{}", short, pg + 1, ours.width, ours.height, refr.0, refr.1);
                continue;
            }
            let ours_rgb = ours_rgb(&ours);
            let total = (refr.0 * refr.1) as usize;
            let mut over = 0usize;
            let mut sum: u64 = 0;
            for (a, b) in refr.2.chunks_exact(3).zip(ours_rgb.chunks_exact(3)) {
                let d = (0..3).map(|c| (a[c] as i32 - b[c] as i32).abs()).max().unwrap();
                sum += d as u64;
                if d > DELTA_THRESH { over += 1; }
            }
            let pct = 100.0 * over as f64 / total as f64;
            let mean = sum as f64 / total as f64;
            // Downsampled metriek (4x4-box): meet 'inkt per gebied' en negeert
            // AA-verdelingsverschillen tussen rasterizers.
            let dw = (refr.0 / 4).max(1) as usize;
            let dh = (refr.1 / 4).max(1) as usize;
            let mut ds_over = 0usize;
            for by in 0..dh {
                for bx in 0..dw {
                    let (mut ra, mut ga, mut ba, mut rb, mut gb, mut bb, mut n) = (0u32, 0u32, 0u32, 0u32, 0u32, 0u32, 0u32);
                    for y in by * 4..((by * 4 + 4).min(refr.1 as usize)) {
                        for x in bx * 4..((bx * 4 + 4).min(refr.0 as usize)) {
                            let i = (y * refr.0 as usize + x) * 3;
                            ra += refr.2[i] as u32; ga += refr.2[i + 1] as u32; ba += refr.2[i + 2] as u32;
                            rb += ours_rgb[i] as u32; gb += ours_rgb[i + 1] as u32; bb += ours_rgb[i + 2] as u32;
                            n += 1;
                        }
                    }
                    if n == 0 { continue; }
                    let d = ((ra / n) as i32 - (rb / n) as i32).abs()
                        .max(((ga / n) as i32 - (gb / n) as i32).abs())
                        .max(((ba / n) as i32 - (bb / n) as i32).abs());
                    if d > 12 { ds_over += 1; }
                }
            }
            let ds_pct = 100.0 * ds_over as f64 / (dw * dh) as f64;
            let content = 0u64; // content-bytes meet de app-router al; buffer_bytes is hier de feature
            let status = if ds_pct <= 2.0 { "OK" } else { "AFWIJKEND" };
            println!("{:<44} {:>5} {:>9} {:>9} {:>7.2}% {:>7.2}% {:>8}", short, pg + 1, ref_ms, tile_ms, pct, ds_pct, status);
            csv.push_str(&format!("{}	{}	{}	{}	{}	{}	{}	{}	{:.3}	{:.3}
",
                name, pg + 1, content, buf_len, ref_ms, extract_ms, index_ms, render_ms, pct, ds_pct));
            worst.push((ds_pct, format!("{} p{}", name, pg + 1)));
        }
    }
    let _ = std::fs::write("C:/Users/rickd/AppData/Local/Temp/corpus_bench.tsv", &csv);
    println!("
csv: C:/Users/rickd/AppData/Local/Temp/corpus_bench.tsv");
    worst.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    println!("\nslechtste 5:");
    for (pct, label) in worst.iter().take(5) {
        println!("  {:>6.2}%  {}", pct, label);
    }
}
