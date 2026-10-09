// Generates the module's declarations with bindgen from the SDK that cargo-msfs
// fetched, which it names in MSFS_SDK, with its WASI sysroot in WASI_SYSROOT.
// bindgen needs libclang, which LIBCLANG_PATH points at.
//
// The clang arguments are FlyByWire's msfs-rs's (read in msfs-rs, its main
// branch on 2026-10-09, msfs/build.rs), with the sysroot that cargo-msfs gives
// C code (read in navigraph/cargo-msfs v1.1.0, src/main.rs, its CFLAGS). The
// module's hand-written declarations in p03 gave HANDLE 32 bits where these
// headers give it 64, and every call after SimConnect_Open failed (measured on
// MSFS 2024, 2026-10-08, record/areas/architecture/log.md).

use std::path::PathBuf;

fn main() {
    for var in ["MSFS_SDK", "WASI_SYSROOT"] {
        println!("cargo:rerun-if-env-changed={var}");
    }
    println!("cargo:rerun-if-changed=wrapper.h");
    let sdk = PathBuf::from(std::env::var("MSFS_SDK").expect("cargo-msfs sets MSFS_SDK"));
    let sysroot = std::env::var("WASI_SYSROOT").expect("cargo-msfs sets WASI_SYSROOT");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());

    bindgen::Builder::default()
        .header("wrapper.h")
        .clang_args([
            "-xc++".to_string(),
            "-std=c++17".into(),
            "-fms-extensions".into(),
            "-fvisibility=default".into(),
            "-D_MSFS_WASM=1".into(),
            format!("--sysroot={sysroot}"),
            format!("-I{}", sdk.join("WASM").join("include").display()),
            format!("-I{}", sdk.join("SimConnect SDK").join("include").display()),
        ])
        .allowlist_function("SimConnect_.*")
        .allowlist_function("fsVars.*")
        .allowlist_type("SIMCONNECT_.*")
        .allowlist_var("SIMCONNECT_.*")
        .prepend_enum_name(false)
        .layout_tests(false)
        .generate()
        .expect("bindgen couldn't read the SDK's headers")
        .write_to_file(out.join("msfs.rs"))
        .expect("couldn't write the bindings");
}
