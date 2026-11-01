//! Tauri embeds the pages in the program as it compiles, and `tools/build.ts` builds them first, so a `cargo` run on its
//! own, as `cargo test` is, needs only a page standing in, or Tauri stops at a folder that isn't there.

use std::path::Path;

fn main() {
    let pages = Path::new("../../../target/desktop-pages");
    if !pages.join("index.html").exists() {
        std::fs::create_dir_all(pages).expect("target/ should be writable");
        std::fs::write(
            pages.join("index.html"),
            "<!doctype html><title>Dual Input</title>Run node tools/build.ts to build this page.",
        )
        .expect("target/ should be writable");
    }
    tauri_build::build();
}
