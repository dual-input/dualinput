//! Generates the module's declarations of the sim's APIs from the SDK's own headers, so each
//! type has the width the sim gives it. A declaration written by hand with a wrong width
//! compiles and loads, and nothing reports it until the sim's calls fail: p03's 32-bit
//! `HANDLE` made every call after `SimConnect_Open` fail (measured on MSFS 2024, 2026-10-08,
//! record/areas/architecture/log.md).
//!
//! cargo-msfs names the SDK in `MSFS_SDK` and its WASI sysroot in `WASI_SYSROOT`, so the
//! module builds only through cargo-msfs, as `node tools/build.ts` runs it. Every build of
//! Dual Input uses the SDK version the root's msfs-sdk.txt names, so this stops the build
//! when the SDK isn't that version, as src/engines/simconnect-types/build.rs does; change the two
//! checks together.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo should set CARGO_MANIFEST_DIR"),
    );
    println!("cargo::rerun-if-env-changed=MSFS_SDK");
    println!("cargo::rerun-if-env-changed=WASI_SYSROOT");
    let sdk = PathBuf::from(env::var_os("MSFS_SDK").expect(
        "MSFS_SDK should be set: build the module with cargo-msfs, as node tools/build.ts does",
    ));
    let sysroot = PathBuf::from(
        env::var_os("WASI_SYSROOT").expect("cargo-msfs should set WASI_SYSROOT beside MSFS_SDK"),
    );

    let wanted_file = manifest.join("../../../msfs-sdk.txt");
    let version_file = sdk.join("version.txt");
    for file in [&wanted_file, &version_file, &manifest.join("wrapper.h")] {
        println!("cargo::rerun-if-changed={}", file.display());
    }
    let wanted = fs::read_to_string(&wanted_file)
        .expect("msfs-sdk.txt should be at the repository's root")
        .trim()
        .to_string();
    // Only the first line counts: tools/msfs-sdk writes the version alone, and a
    // version.txt cargo-msfs installed adds a build number on a second line.
    let installed = fs::read_to_string(&version_file)
        .ok()
        .and_then(|text| text.lines().next().map(|line| line.trim().to_string()));
    if installed.as_deref() != Some(wanted.as_str()) {
        let has = match installed {
            Some(version) => format!("SDK {version} is installed"),
            None => "no SDK is installed".to_string(),
        };
        eprintln!(
            "msfs-sdk.txt names SDK {wanted}, but {has} in {}; run node tools/setup.ts",
            sdk.display()
        );
        std::process::exit(1);
    }

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR"));
    // The clang arguments are FlyByWire's msfs-rs's, with the sysroot cargo-msfs gives C
    // code, as p08's module, which ran in a flight, built them (read in
    // experiments/areas/architecture/flight/module/build.rs).
    bindgen::Builder::default()
        .header(manifest.join("wrapper.h").to_string_lossy())
        .clang_args([
            "-xc++".to_string(),
            "-std=c++17".into(),
            "-fms-extensions".into(),
            "-fvisibility=default".into(),
            "-D_MSFS_WASM=1".into(),
            format!("--sysroot={}", sysroot.display()),
            format!("-I{}", sdk.join("WASM").join("include").display()),
            format!("-I{}", sdk.join("SimConnect SDK").join("include").display()),
        ])
        .allowlist_function("SimConnect_.*")
        .allowlist_function("fsVars.*")
        .allowlist_function("fsEvents.*")
        .allowlist_type("SIMCONNECT_.*")
        .allowlist_var("SIMCONNECT_.*")
        .allowlist_var("FS_OBJECT_ID_USER_AIRCRAFT")
        .allowlist_var("KEY_FREEZE_(LATITUDE_LONGITUDE|ALTITUDE|ATTITUDE)_SET")
        .allowlist_var("KEY_AXIS_(AILERONS|ELEVATOR|RUDDER|LEFT_BRAKE|RIGHT_BRAKE)_SET")
        // SimConnect's and the SDK's names already start with their enum's, as in
        // SIMCONNECT_RECV_ID_OPEN, so bindgen adds no second prefix.
        .prepend_enum_name(false)
        .layout_tests(false)
        // Tells Cargo every header bindgen read, so a new SDK in the same folder builds the
        // declarations again.
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("bindgen should read the SDK's headers, through the libclang LIBCLANG_PATH names")
        .write_to_file(out.join("sim.rs"))
        .expect("OUT_DIR should be writable");
}
