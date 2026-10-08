// Builds one of p03's variants, chosen by environment variables that build.mjs
// sets for each cargo-msfs run:
//   P03_TAG       the letter in the variant's names (CROSSCHECK_P03<TAG>_...)
//   P03_BASE_ID   the first SimConnect ID its data slots use
//   P03_VERSIONS  if set, link the SDK's MSFS_WasmVersions.a, which the SDK's
//                 MSBuild toolset links into every module and which exports the
//                 API versions the module was built against (GetSimConnectVersion,
//                 GetExtensionVersion, GetExtensionVersionBuffer); cargo-msfs links
//                 none of it

use std::io::Write;

fn main() {
    for var in ["P03_TAG", "P03_BASE_ID", "P03_VERSIONS"] {
        println!("cargo:rerun-if-env-changed={var}");
    }
    let tag = std::env::var("P03_TAG").unwrap_or_else(|_| "A".into());
    let base: u32 = std::env::var("P03_BASE_ID").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("config.rs");
    let mut f = std::fs::File::create(out).unwrap();
    writeln!(f, "pub const TAG: &str = {tag:?};").unwrap();
    writeln!(f, "pub const BASE_ID: u32 = {base};").unwrap();
    if std::env::var_os("P03_VERSIONS").is_some() {
        let sdk = std::env::var("MSFS_SDK").expect("cargo-msfs sets MSFS_SDK");
        println!("cargo:rustc-link-arg={sdk}/WASM/WasmVersions/MSFS_WasmVersions.a");
        for name in ["GetSimConnectVersion", "GetExtensionVersion", "GetExtensionVersionBuffer"] {
            println!("cargo:rustc-link-arg=--export={name}");
        }
    }
}
