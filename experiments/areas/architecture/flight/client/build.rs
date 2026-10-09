// Generates the client's declarations from the SDK's SimConnect.h with bindgen,
// links the SDK's SimConnect library, and puts SimConnect.dll beside the
// program. MSFS_SDK names the SDK's folder; without it, the SDK's default
// install folder. bindgen needs libclang, which LIBCLANG_PATH points at.
//
// The clang arguments are FlyByWire's msfs-rs's (read in msfs-rs, its main
// branch on 2026-10-09, msfs/build.rs): SimConnect.h is C++, with extern "C"
// and default arguments.

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=MSFS_SDK");
    println!("cargo:rerun-if-changed=wrapper.h");
    let sdk = PathBuf::from(std::env::var("MSFS_SDK").unwrap_or_else(|_| r"C:\MSFS 2024 SDK".into()));
    let include = sdk.join("SimConnect SDK").join("include");
    let lib = sdk.join("SimConnect SDK").join("lib");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());

    bindgen::Builder::default()
        .header("wrapper.h")
        .clang_args(["-xc++", "-std=c++17", "-fms-extensions", &format!("-I{}", include.display())])
        .allowlist_function("SimConnect_.*")
        .allowlist_type("SIMCONNECT_.*")
        .allowlist_var("SIMCONNECT_.*")
        .prepend_enum_name(false)
        .layout_tests(false)
        .generate()
        .expect("bindgen couldn't read SimConnect.h")
        .write_to_file(out.join("simconnect.rs"))
        .expect("couldn't write the bindings");

    println!("cargo:rustc-link-search=native={}", lib.display());
    println!("cargo:rustc-link-lib=dylib=SimConnect");
    // OUT_DIR is target/<profile>/build/<crate>-<hash>/out, and the program
    // lands in target/<profile>.
    let profile_dir = out.ancestors().nth(3).unwrap().to_path_buf();
    std::fs::copy(lib.join("SimConnect.dll"), profile_dir.join("SimConnect.dll")).expect("copy SimConnect.dll");
}
