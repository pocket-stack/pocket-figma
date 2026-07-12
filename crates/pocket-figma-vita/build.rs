//! Embed dist/main.js + dist/main.pak in the Vita executable.
//!
//! The TypeScript driver always rebuilds them first. Keeping the embed step
//! here means the installed VPK is self-contained and the device performs no
//! filesystem parsing or network access at runtime.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = crate_dir.join("../../dist");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());

    let js_src = dist.join("main.js");
    println!("cargo:rerun-if-changed={}", js_src.display());
    let mut js = fs::read(&js_src)
        .unwrap_or_else(|e| panic!("could not read dist/main.js (run `bun run build` first): {e}"));
    js.push(0);
    fs::write(out.join("app.js"), js).unwrap();

    let pak_src = dist.join("main.pak");
    println!("cargo:rerun-if-changed={}", pak_src.display());
    let pak = fs::read(&pak_src).unwrap_or_else(|e| {
        panic!("could not read dist/main.pak (run `bun run build` first): {e}")
    });
    fs::write(out.join("app.pak"), pak).unwrap();

    for name in [
        "POCKET_FIGMA_VITA_CAPTURE_INPUT",
        "POCKET_FIGMA_VITA_CAP_START",
        "POCKET_FIGMA_VITA_CAP_N",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
}
