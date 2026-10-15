// p08's build script (flight/module/build.rs), with bindgen writing for the 2024
// edition, which wants `unsafe extern` blocks: declarations bindgen generates
// from the SDK that cargo-msfs names in MSFS_SDK, with its WASI sysroot in
// WASI_SYSROOT, through the libclang LIBCLANG_PATH points at.

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
        .rust_edition(bindgen::RustEdition::Edition2024)
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
        .allowlist_var("FS_OBJECT_ID_.*")
        .prepend_enum_name(false)
        .layout_tests(false)
        .generate()
        .expect("bindgen couldn't read the SDK's headers")
        .write_to_file(out.join("msfs.rs"))
        .expect("couldn't write the bindings");
}
