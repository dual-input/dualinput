//! Links the SDK's SimConnect.lib, and puts the SDK's SimConnect.dll beside the programs
//! the build makes, since Windows can't start a program that links SimConnect.dll unless it
//! finds the DLL, and looks in the program's own folder first.
//!
//! simconnect-types finds the SDK's folder, checks that it holds the version msfs-sdk.txt
//! names, and hands the folder to this script as DEP_SIMCONNECT_SDK_FOLDER, through its
//! `links` key.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let sdk = PathBuf::from(
        env::var_os("DEP_SIMCONNECT_SDK_FOLDER")
            .expect("simconnect-types' build script should name the SDK's folder"),
    );
    let lib = sdk.join("SimConnect SDK").join("lib");
    // `#[link(name = "SimConnect")]` in src/simconnect.rs names the library found here.
    println!("cargo::rustc-link-search=native={}", lib.display());

    // OUT_DIR is target/<profile>/build/sim-edge-<hash>/out, and Cargo puts the programs it
    // builds in target/<profile>. A test program runs from target/<profile>/deps, and
    // `cargo test` puts target/<profile> on its PATH, so it finds the copy too.
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR"));
    let programs = out
        .ancestors()
        .nth(3)
        .expect("OUT_DIR should be three folders below the profile's");
    let dll = lib.join("SimConnect.dll");
    let copy = programs.join("SimConnect.dll");
    println!("cargo::rerun-if-changed={}", dll.display());
    // Cargo runs this again when a file it names is missing, so a deleted copy comes back.
    // The copy keeps the SDK's file time, which is older than this script's last run, so
    // the copy alone sets off no run.
    println!("cargo::rerun-if-changed={}", copy.display());

    // Windows refuses to overwrite a DLL a running program has loaded, such as a core
    // started from this target folder, so the script copies only when the bytes differ.
    let wanted = fs::read(&dll).expect("the SDK's lib folder should hold SimConnect.dll");
    if fs::read(&copy).ok().as_ref() != Some(&wanted) {
        fs::copy(&dll, &copy).unwrap_or_else(|error| {
            panic!(
                "SimConnect.dll should copy to {}, which a running program may hold: {error}",
                copy.display()
            )
        });
    }
}
