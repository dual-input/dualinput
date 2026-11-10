// Generates the module's declarations with bindgen from the SDK that cargo-msfs fetched, as
// p08's module/build.rs does, with the same clang arguments and the Events API added.

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
        ])
        .allowlist_function("fsVars.*")
        .allowlist_function("fsEvents.*")
        .prepend_enum_name(false)
        .layout_tests(false)
        .generate()
        .expect("bindgen couldn't read the SDK's headers")
        .write_to_file(out.join("msfs.rs"))
        .expect("couldn't write the bindings");
}
