// Profile per-image-stage timing.
// Run: cargo run --release --example profile_image_stages -- <pdf>
//
// This runs render_page identically to profile_render BUT also enables an
// env var that the interpreter reads to print per-stage timing for each
// image-XObject: dereference, decompress (Flate / JPEG), predictor, smask,
// premul, and draw_image. Only emits when OPSR_PROFILE_IMAGES=1.

use std::time::Instant;

fn main() {
    std::env::set_var("OPSR_PROFILE_IMAGES", "1");
    let path = std::env::args().nth(1).expect("usage: profile_image_stages <pdf>");
    let only_page: Option<usize> = std::env::args().nth(2).and_then(|s| s.parse().ok());
    let pdf_bytes = std::fs::read(&path).expect("read pdf");

    let t_load = Instant::now();
    let doc = open_pdf_render::DocumentHandle::load(&pdf_bytes).expect("load pdf");
    let load_ms = t_load.elapsed().as_millis();
    let pages = doc.page_count();
    println!("Load+parse:   {:>6} ms  ({} pages)", load_ms, pages);

    let n = pages.min(8);
    let mut total_render = 0u128;
    for i in 0..n {
        if let Some(p) = only_page {
            if p != i { continue; }
        }
        let (w_pt, _h_pt) = doc.page_dimensions(i).unwrap();
        let scale = 2000.0 / w_pt;
        let t_render = Instant::now();
        let r = doc.render_page(i, scale, 0).expect("render");
        let render_ms = t_render.elapsed().as_millis();
        total_render += render_ms;
        println!(
            "==> p{} render: {:>6} ms ({}x{})",
            i, render_ms, r.width, r.height
        );
    }
    println!("Total render: {:>6} ms over {} pages", total_render, n);
}
