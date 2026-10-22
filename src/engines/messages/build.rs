//! Computes `messages::HASH`, a fingerprint of the message crate, and `messages::SLOTS_HASH`,
//! a fingerprint of the routines' slots alone.
//!
//! Dual Input's programs, on one PC and between the two pilots' PCs, talk in the messages
//! this crate defines. Two builds whose messages differ would misread each other, so each
//! program sends the hash in its first message, and two builds with different hashes
//! refuse to talk. A new version of an encoding crate such as serde can change the bytes a
//! message becomes, so the hash covers the version of every crate this one depends on, as
//! well as its source (decision 026).
//!
//! Our WASM module reads a routine's slot in place, so it needs only the slots' layouts to
//! match the core's, and the slots hash covers only the files named `slots.rs`. A change to
//! any other message then leaves our module's build as good as it was, and a developer
//! needn't restart the sim for one (record/areas/core/03-sim-seam-and-wasm-module.md, "A
//! module from another build").
//!
//! tests/hash.rs compiles this file into its tests, so the functions they call are `pub`.

// A build script runs as the crate builds, never on the core's loop, so reading files is
// its job, which the root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::{
    collections::{BTreeSet, HashMap},
    env, fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

fn main() {
    let crate_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo should set CARGO_MANIFEST_DIR"),
    );
    let lock_path = find_lock(&crate_dir);
    let lock =
        fs::read_to_string(&lock_path).expect("the workspace's Cargo.lock should be readable");

    let hash = crate_hash(&crate_dir, &lock);
    let slots = slots_hash(&crate_dir);
    let out =
        PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR")).join("hash.rs");
    let source = format!(
        "/// A SHA-256 fingerprint of this crate and every crate it depends on, as 64 lowercase\n\
         /// hex digits. Each program sends it in its first message; build.rs says why.\n\
         pub const HASH: &str = \"{hash}\";\n\
         /// The first 8 bytes of a SHA-256 of the routines' slots, the files named `slots.rs`.\n\
         /// Each slot's header carries it; build.rs says why.\n\
         pub const SLOTS_HASH: u64 = {slots:#018x};\n"
    );
    fs::write(out, source).expect("OUT_DIR should be writable");

    // A build script with no rerun-if-changed runs again after any change in its package.
    // tools/build.ts rewrites ts/ on every build, so without these lines this script would
    // run on every build too. These name what `source_files` and `reachable_packages`
    // read, so when you change what they read, change these too.
    for path in ["Cargo.toml", "build.rs", "src"] {
        println!("cargo::rerun-if-changed={}", crate_dir.join(path).display());
    }
    println!("cargo::rerun-if-changed={}", lock_path.display());
}

pub fn crate_hash(crate_dir: &Path, lock: &str) -> String {
    let mut hasher = Sha256::new();
    hash_files(&mut hasher, source_files(crate_dir));
    for (name, version) in reachable_packages(lock, "messages") {
        hasher.update(format!("{name} {version}\n").as_bytes());
    }
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The first 8 bytes of the SHA-256 of every file under `src/` named `slots.rs`, read as a
/// big-endian number.
pub fn slots_hash(crate_dir: &Path) -> u64 {
    let mut hasher = Sha256::new();
    let slots = source_files(crate_dir)
        .into_iter()
        .filter(|(name, _)| name.starts_with("src/") && name.ends_with("/slots.rs"));
    hash_files(&mut hasher, slots);
    let digest = hasher.finalize();
    u64::from_be_bytes(digest[..8].try_into().expect("a SHA-256 has 32 bytes"))
}

fn hash_files(hasher: &mut Sha256, files: impl IntoIterator<Item = (String, PathBuf)>) {
    for (name, path) in files {
        let bytes = fs::read(&path).expect("a source file should be readable");
        let text = lf_endings(&bytes);
        // The name and length mark where each file starts and ends. Without them, moving a
        // line from the end of one file to the start of the next would hash the same bytes.
        hasher.update(name.as_bytes());
        hasher.update([0]);
        hasher.update((text.len() as u64).to_le_bytes());
        hasher.update(&text);
    }
}

/// `Cargo.toml`, `build.rs`, and every file under `src/`, each named by its path from the
/// crate's folder, such as `src/lib.rs`. Names use `/` and the list is sorted, so two PCs
/// give the same hash whatever their path separator, and whatever order `read_dir` lists
/// files in.
pub fn source_files(crate_dir: &Path) -> Vec<(String, PathBuf)> {
    let mut files = vec![
        ("Cargo.toml".to_owned(), crate_dir.join("Cargo.toml")),
        ("build.rs".to_owned(), crate_dir.join("build.rs")),
    ];
    let mut stack = vec![crate_dir.join("src")];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).expect("src/ should be readable") {
            let path = entry.expect("src/ should be listable").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let name = path
                    .strip_prefix(crate_dir)
                    .expect("a file under src/ should be under the crate")
                    .to_string_lossy()
                    .replace('\\', "/");
                files.push((name, path));
            }
        }
    }
    files.sort();
    files
}

/// The bytes with each CRLF turned into LF, so a checkout with Git's `core.autocrlf` on
/// gives the same hash as one with it off.
pub fn lf_endings(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// The name and version of every package `Cargo.lock` reaches from `root`, such as
/// `("serde", "1.0.228")`, sorted. The lock doesn't say whether a dependency is a normal,
/// build, or dev one, so all three count.
pub fn reachable_packages(lock: &str, root: &str) -> Vec<(String, String)> {
    let table: toml::Table = lock.parse().expect("Cargo.lock should be TOML");
    let packages: Vec<Package> = table
        .get("package")
        .and_then(|p| p.as_array())
        .map(|list| list.iter().filter_map(Package::from_toml).collect())
        .unwrap_or_default();

    let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, p) in packages.iter().enumerate() {
        by_name.entry(p.name.as_str()).or_default().push(i);
    }

    // A workspace member has no `source`, which tells it from a crates.io package of the
    // same name.
    let start = packages
        .iter()
        .position(|p| p.name == root && p.source.is_none())
        .unwrap_or_else(|| panic!("Cargo.lock should hold the workspace's `{root}`"));
    let mut seen = BTreeSet::from([start]);
    let mut stack = vec![start];
    while let Some(i) = stack.pop() {
        for dep in &packages[i].dependencies {
            let found = resolve(dep, &packages, &by_name)
                .unwrap_or_else(|| panic!("Cargo.lock should hold the package `{dep}` names"));
            if seen.insert(found) {
                stack.push(found);
            }
        }
    }
    let mut reached: Vec<(String, String)> = seen
        .into_iter()
        .filter(|&i| i != start)
        .map(|i| (packages[i].name.clone(), packages[i].version.clone()))
        .collect();
    reached.sort();
    reached
}

struct Package {
    name: String,
    version: String,
    source: Option<String>,
    dependencies: Vec<String>,
}

impl Package {
    fn from_toml(value: &toml::Value) -> Option<Package> {
        let t = value.as_table()?;
        let text = |key: &str| t.get(key).and_then(|v| v.as_str()).map(str::to_owned);
        Some(Package {
            name: text("name")?,
            version: text("version")?,
            source: text("source"),
            dependencies: t
                .get("dependencies")
                .and_then(|d| d.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|d| d.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
        })
    }
}

/// A lock names a dependency as `serde`, `toml 1.1.8`, or `toml 1.1.8 (registry+...)`.
/// Cargo adds the version only when the lock holds two versions of that name, and the
/// source only when it holds two sources of that version.
fn resolve(dep: &str, packages: &[Package], by_name: &HashMap<&str, Vec<usize>>) -> Option<usize> {
    let mut parts = dep.splitn(3, ' ');
    let name = parts.next()?;
    let version = parts.next();
    let source = parts
        .next()
        .map(|s| s.trim_start_matches('(').trim_end_matches(')'));
    by_name.get(name)?.iter().copied().find(|&i| {
        version.is_none_or(|v| packages[i].version == v)
            && source.is_none_or(|s| packages[i].source.as_deref() == Some(s))
    })
}

fn find_lock(crate_dir: &Path) -> PathBuf {
    crate_dir
        .ancestors()
        .map(|dir| dir.join("Cargo.lock"))
        .find(|lock| lock.is_file())
        .expect("Cargo should have written Cargo.lock above the crate before running build scripts")
}
