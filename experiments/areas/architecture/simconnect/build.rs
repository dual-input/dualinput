// Links the SDK's own SimConnect library, and puts SimConnect.dll beside the
// program, which loads it at start. MSFS_SDK names the SDK's folder; without
// it, the SDK's default install folder.

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=MSFS_SDK");
    let sdk = std::env::var("MSFS_SDK").unwrap_or_else(|_| r"C:\MSFS 2024 SDK".into());
    let lib = PathBuf::from(&sdk).join("SimConnect SDK").join("lib");
    println!("cargo:rustc-link-search=native={}", lib.display());
    println!("cargo:rustc-link-lib=dylib=SimConnect");
    // OUT_DIR is target/<profile>/build/<crate>-<hash>/out, and the program
    // lands in target/<profile>.
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let profile_dir = out.ancestors().nth(3).unwrap().to_path_buf();
    std::fs::copy(lib.join("SimConnect.dll"), profile_dir.join("SimConnect.dll")).expect("copy SimConnect.dll");
}
