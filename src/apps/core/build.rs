//! Finds what a recording's header names about the build: its commit, a hash of what wasn't
//! committed yet, its profile, its rustc, and the versions of the MSVC tools and the Windows
//! SDK it links the C runtime from. A replay built from another commit refuses, and one
//! built with another compiler or C runtime warns, since either can change the core's math
//! (record/areas/core/01-loop-and-edge.md, "Running a replay").
//!
//! It writes them as constants into OUT_DIR/build_info.rs, which src/recording/build_info.rs includes.

use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};

fn main() {
    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo should set CARGO_MANIFEST_DIR"),
    );
    let root = manifest.join("../../..");
    let paths = sources(&root);

    // Cargo runs this again when one of these changes, and only then, so the core's own
    // code compiles again only when the commit or its sources change.
    for path in &paths {
        println!("cargo::rerun-if-changed={}", root.join(path).display());
    }
    // HEAD names the branch, and the branch's file or packed-refs names its commit. Once
    // `git gc` packs the branch, a commit writes a new branch file that wasn't there to
    // watch, so the script also watches logs/HEAD, which git appends to at every commit,
    // checkout, and reset.
    let branch = git(&root, &["symbolic-ref", "-q", "HEAD"]).unwrap_or_default();
    for git_file in ["HEAD", "logs/HEAD", "packed-refs", &branch]
        .into_iter()
        .filter(|f| !f.is_empty())
    {
        if let Some(path) = git(&root, &["rev-parse", "--git-path", git_file]) {
            let path = root.join(path);
            if path.exists() {
                println!("cargo::rerun-if-changed={}", path.display());
            }
        }
    }
    for variable in ["LIB", "VCINSTALLDIR", "WindowsSdkDir"] {
        println!("cargo::rerun-if-env-changed={variable}");
    }

    let commit = git(&root, &["rev-parse", "HEAD"])
        .expect("dualinput-core's build reads the commit with git, so git should be on PATH and this a clone");
    let uncommitted = uncommitted(&root, &paths);
    let profile = env::var("PROFILE").expect("Cargo should set PROFILE");
    let rustc = Command::new(env::var_os("RUSTC").expect("Cargo should set RUSTC"))
        .arg("-V")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .expect("rustc -V should run");
    let (msvc, windows_sdk) = linker_versions();

    let build_info = format!(
        "pub const COMMIT: &str = {commit:?};\n\
         pub const UNCOMMITTED: Option<&str> = {uncommitted:?};\n\
         pub const PROFILE: &str = {profile:?};\n\
         pub const RUSTC: &str = {rustc:?};\n\
         pub const MSVC: &str = {msvc:?};\n\
         pub const WINDOWS_SDK: &str = {windows_sdk:?};\n"
    );
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR"));
    std::fs::write(out.join("build_info.rs"), build_info).expect("OUT_DIR should be writable");
}

/// What the core is built from, relative to the root, as git takes paths: the workspace's
/// own files, and each crate's manifest, build script, and source, but not its tests or
/// generated files, such as the message crate's ts/, which `cargo test` writes again.
fn sources(root: &Path) -> Vec<String> {
    let mut paths: Vec<String> = [
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain.toml",
        ".cargo/config.toml",
    ]
    .map(String::from)
    .to_vec();
    // When the core comes to link crates from another top folder, add it here.
    let mut crates = Vec::new();
    for tier in ["src/engines", "src/platform", "src/sim-package"] {
        crates.extend(
            subfolders(&root.join(tier))
                .into_iter()
                .map(|c| format!("{tier}/{c}")),
        );
    }
    for feature in subfolders(&root.join("src/features")) {
        crates.extend(
            subfolders(&root.join("src/features").join(&feature))
                .into_iter()
                .map(|p| format!("src/features/{feature}/{p}")),
        );
    }
    crates.push("src/apps/core".into());
    crates.sort();
    for folder in crates {
        if !root.join(&folder).join("Cargo.toml").exists() {
            continue;
        }
        for part in ["Cargo.toml", "build.rs", "src"] {
            if root.join(&folder).join(part).exists() {
                paths.push(format!("{folder}/{part}"));
            }
        }
    }
    paths
}

fn subfolders(folder: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect()
}

/// A SHA-256 of every change to `paths` that isn't committed, as 64 lowercase hex digits,
/// or `None` when there's none. It covers the diff against the commit and each untracked
/// file's name and bytes.
fn uncommitted(root: &Path, paths: &[String]) -> Option<String> {
    let status = git(
        root,
        &[
            &["status", "--porcelain", "--untracked-files=all", "--"][..],
            &as_str(paths),
        ]
        .concat(),
    )?;
    if status.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    let diff = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["diff", "HEAD", "--binary", "--"])
        .args(paths)
        .output()
        .expect("git diff should run");
    hasher.update(&diff.stdout);
    let untracked = git(
        root,
        &[
            &["ls-files", "--others", "--exclude-standard", "--"][..],
            &as_str(paths),
        ]
        .concat(),
    )
    .unwrap_or_default();
    for file in untracked.lines() {
        hasher.update(file.as_bytes());
        hasher.update([0]);
        hasher.update(std::fs::read(root.join(file)).unwrap_or_default());
    }
    Some(
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}

fn as_str(paths: &[String]) -> Vec<&str> {
    paths.iter().map(String::as_str).collect()
}

/// git's output, trimmed, or `None` when git fails.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// The versions of the MSVC tools and the Windows SDK the linker takes its libraries from,
/// as the folders in its `LIB` name them, such as
/// `...\VC\Tools\MSVC\14.44.35207\lib\x64` and `...\Windows Kits\10\lib\10.0.26100.0\ucrt\x64`.
/// rustc finds the linker the way the cc crate does, so cc's answer is the linker's.
fn linker_versions() -> (String, String) {
    let lib = cc::windows_registry::find_tool("x86_64-pc-windows-msvc", "link.exe")
        .and_then(|tool| {
            tool.get_envs()
                .rev()
                .find(|(k, _)| k.eq_ignore_ascii_case(OsStr::new("LIB")))
                .map(|(_, v)| v.to_owned())
        })
        .or_else(|| env::var_os("LIB"))
        .unwrap_or_default();
    let mut msvc = None;
    let mut sdk = None;
    for folder in env::split_paths(&lib) {
        let parts: Vec<String> = folder
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let after = |name: &str| {
            parts
                .iter()
                .position(|p| p.eq_ignore_ascii_case(name))
                .and_then(|i| parts.get(i + 1))
                .cloned()
        };
        if msvc.is_none() {
            msvc = after("MSVC");
        }
        if sdk.is_none() && parts.iter().any(|p| p.eq_ignore_ascii_case("ucrt")) {
            sdk = after("lib");
        }
    }
    let unknown = || {
        println!(
            "cargo::warning=the linker's LIB names no MSVC or Windows SDK version, so a recording's header can't name them"
        );
        "unknown".to_string()
    };
    (msvc.unwrap_or_else(unknown), sdk.unwrap_or_else(unknown))
}
