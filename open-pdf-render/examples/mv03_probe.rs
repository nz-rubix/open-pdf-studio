//! Route-A go/no-go: kan ÓNZE parser/renderer (open-pdf-render) het
//! 5M-ops-blad MV-03 aan, en met welke tijden/geheugen?
//!   1. load (lopdf-parse)
//!   2. extract_draw_commands (display-list — kern van route A)
//!   3. render_page @0.3 (zelfde workload als de PDFium-probe: 11,6 s ref)
use std::time::Instant;

const PDF: &str = "C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf";

fn main() {
    let bytes = std::fs::read(PDF).expect("read pdf");
    println!("bestand: {:.1} MB", bytes.len() as f64 / 1048576.0);

    let t0 = Instant::now();
    let doc = match open_pdf_render::DocumentHandle::load(&bytes) {
        Ok(d) => d,
        Err(e) => { println!("LOAD FOUT: {e:?}"); return; }
    };
    println!("load/parse: {} ms", t0.elapsed().as_millis());

    let t1 = Instant::now();
    match doc.extract_draw_commands(0, 0) {
        Ok(buf) => println!(
            "extract_draw_commands: {} ms, buffer {:.1} MB",
            t1.elapsed().as_millis(),
            buf.len() as f64 / 1048576.0
        ),
        Err(e) => println!("EXTRACT FOUT na {} ms: {e:?}", t1.elapsed().as_millis()),
    }

    let t2 = Instant::now();
    match doc.render_page(0, 0.3, 0) {
        Ok(p) => {
            println!(
                "render_page @0.3: {} ms ({}x{})",
                t2.elapsed().as_millis(), p.width, p.height
            );
            if let Some(pixmap) = tiny_skia::Pixmap::from_vec(
                p.rgba.clone(),
                tiny_skia::IntSize::from_wh(p.width, p.height).unwrap(),
            ) {
                let out = std::env::temp_dir().join("mv03_probe_render.png");
                let _ = pixmap.save_png(&out);
                println!("png: {}", out.display());
            }
        }
        Err(e) => println!("RENDER FOUT na {} ms: {e:?}", t2.elapsed().as_millis()),
    }
    println!("TOTAAL: {} ms", t0.elapsed().as_millis());
}
