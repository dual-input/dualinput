//! Generates SimConnect's types and constants from the SDK's SimConnect.h.
//!
//! Every build of Dual Input uses the one SDK version the root's msfs-sdk.txt names, so a
//! build of an old commit, such as one that replays a pilot's recording, reads the headers
//! that commit was built with. This script reads the SDK that `node tools/setup.ts`
//! installed, and stops the build when it isn't that version
//! (record/areas/build/01-the-build.md, "The SDK").

// A build script runs as the crate builds, never on the core's loop, so reading files and
// the environment is its job, which the root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo should set CARGO_MANIFEST_DIR"),
    );
    let wanted_file = manifest.join("..").join("..").join("msfs-sdk.txt");
    let sdk = sdk_folder();
    let version_file = sdk.join("version.txt");
    for file in [&wanted_file, &version_file, &manifest.join("wrapper.h")] {
        println!("cargo::rerun-if-changed={}", file.display());
    }
    println!("cargo::rerun-if-env-changed=MSFS_SDK");
    println!("cargo::rerun-if-env-changed=APPDATA");

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
    println!("cargo::rustc-env=SIMCONNECT_SDK_VERSION={wanted}");

    let include = sdk.join("SimConnect SDK").join("include");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR"));
    bindgen::Builder::default()
        .header(manifest.join("wrapper.h").to_string_lossy())
        .clang_args([
            "-xc++",
            "-std=c++17",
            "-fms-extensions",
            &format!("-I{}", include.display()),
        ])
        .allowlist_type("SIMCONNECT_.*")
        .allowlist_var("SIMCONNECT_.*")
        // SimConnect's own names already start with their enum's, as in
        // SIMCONNECT_RECV_ID_OPEN, so bindgen adds no second prefix.
        .prepend_enum_name(false)
        .derive_default(true)
        // Tells Cargo every header bindgen read, so a new SDK in the same folder builds the
        // types again.
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect(
            "bindgen should read the SDK's SimConnect.h, through the libclang LIBCLANG_PATH names",
        )
        .write_to_file(out.join("simconnect.rs"))
        .expect("OUT_DIR should be writable");
}

/// The SDK's folder: `MSFS_SDK`, which cargo-msfs sets when it builds our WASM module, and
/// otherwise the folder cargo-msfs installs into, `%APPDATA%\cargo-msfs\data\msfs2024`.
/// `sdkFolder` in tools/lib/sdk.ts and `sdk_folder` in tools/msfs-sdk/src/main.rs name the
/// same folder, so change all three together.
fn sdk_folder() -> PathBuf {
    if let Some(sdk) = env::var_os("MSFS_SDK") {
        return PathBuf::from(sdk);
    }
    let appdata = env::var_os("APPDATA").expect("Windows should set APPDATA");
    PathBuf::from(appdata)
        .join("cargo-msfs")
        .join("data")
        .join("msfs2024")
}
