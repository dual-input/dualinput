//! `dualinput-profile-builder`: checks each profile and builds its bundle, for authors and CI
//! (record/areas/profiles/02-units.md, "The builder program").
//!
//!   dualinput-profile-builder build <profile or folder> [--out <folder>]
//!   dualinput-profile-builder watch <profile or folder> --out <folder>
//!   dualinput-profile-builder publish --released <level> --pages <folder> [--profiles <folder>]
//!   dualinput-profile-builder levels
//!
//! A profile is a file in a folder named `aircraft`, whose parent is the profiles' folder that
//! imports are found from, as `profiles/aircraft/bksq-baronpro.yaml`.

mod publish;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, SystemTime};

use profile_build::{Built, Compiler, STACK, build};
use profile_engine::Files;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // TypeScript's checker recurses deeply, so the work runs on a thread with the stack the
    // compiler needs, rather than on the main thread's 1 MB.
    let worker = std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || run(&args))
        .expect("the builder's thread should start");
    match worker.join() {
        Ok(Ok(())) => ExitCode::SUCCESS,
        Ok(Err(e)) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
        Err(_) => ExitCode::FAILURE,
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let (command, rest) = args.split_first().ok_or_else(usage)?;
    let flags = Flags::read(rest)?;
    match command.as_str() {
        "build" => {
            let target = flags.target()?;
            let failed = build_all(&target, flags.get("--out"), &mut Compiler::new())?;
            if failed {
                Err("Some profiles have errors".into())
            } else {
                Ok(())
            }
        }
        "watch" => watch(&flags.target()?, flags.need("--out")?),
        "publish" => {
            let released: u32 = flags
                .need("--released")?
                .to_string_lossy()
                .parse()
                .map_err(|_| "--released takes a level, a whole number".to_string())?;
            let profiles = flags.get("--profiles").unwrap_or(Path::new("profiles"));
            let pages = flags.need("--pages")?;
            publish::publish(profiles, pages, released, &utc_now(), &mut Compiler::new())
        }
        "levels" => levels(),
        _ => Err(usage()),
    }
}

fn usage() -> String {
    "Usage:
  dualinput-profile-builder build <profile or folder> [--out <folder>]
  dualinput-profile-builder watch <profile or folder> --out <folder>
  dualinput-profile-builder publish --released <level> --pages <folder> [--profiles <folder>]
  dualinput-profile-builder levels"
        .into()
}

struct Flags {
    target: Option<PathBuf>,
    values: BTreeMap<String, PathBuf>,
}

impl Flags {
    fn read(args: &[String]) -> Result<Flags, String> {
        let mut flags = Flags {
            target: None,
            values: BTreeMap::new(),
        };
        let mut args = args.iter();
        while let Some(a) = args.next() {
            if a.starts_with("--") {
                let value = args.next().ok_or_else(|| format!("{a} takes a value"))?;
                flags.values.insert(a.clone(), PathBuf::from(value));
            } else if flags.target.is_none() {
                flags.target = Some(PathBuf::from(a));
            } else {
                return Err(usage());
            }
        }
        Ok(flags)
    }

    fn target(&self) -> Result<PathBuf, String> {
        self.target.clone().ok_or_else(usage)
    }

    fn get(&self, flag: &str) -> Option<&Path> {
        self.values.get(flag).map(PathBuf::as_path)
    }

    fn need(&self, flag: &str) -> Result<&Path, String> {
        self.get(flag)
            .ok_or_else(|| format!("{flag} is needed\n{}", usage()))
    }
}

/// A profiles' folder on disk, which the engine reads files from by their paths inside it.
pub(crate) struct Disk(pub(crate) PathBuf);

impl Files for Disk {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.0.join(path)).ok()
    }
}

/// The profiles' folder, and each profile's path in it, for a profile's file, a folder of
/// profiles, or the profiles' folder itself.
pub(crate) fn profiles(target: &Path) -> Result<(PathBuf, Vec<String>), String> {
    let named = |p: &Path, name: &str| p.file_name().is_some_and(|n| n == name);
    if target.is_file() {
        let folder = target
            .parent()
            .filter(|f| named(f, "aircraft"))
            .ok_or_else(|| format!("{} isn't in a folder named aircraft", target.display()))?;
        let root = folder.parent().unwrap_or(Path::new("."));
        let name = target
            .file_name()
            .expect("a file has a name")
            .to_string_lossy();
        return Ok((root.to_path_buf(), vec![format!("aircraft/{name}")]));
    }
    let (root, folder) = if named(target, "aircraft") {
        (
            target.parent().unwrap_or(Path::new(".")).to_path_buf(),
            target.to_path_buf(),
        )
    } else {
        (target.to_path_buf(), target.join("aircraft"))
    };
    let mut paths: Vec<String> = std::fs::read_dir(&folder)
        .map_err(|e| format!("couldn't list {}: {e}", folder.display()))?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".yaml"))
        .map(|n| format!("aircraft/{n}"))
        .collect();
    paths.sort();
    Ok((root, paths))
}

/// Builds each profile and prints its report, writing each bundle into `out` under its
/// profile's file name, replacing the last one built. Whether any had an error.
fn build_all(target: &Path, out: Option<&Path>, compiler: &mut Compiler) -> Result<bool, String> {
    let (root, paths) = profiles(target)?;
    let disk = Disk(root);
    let mut failed = false;
    for path in &paths {
        let built = build(&disk, path, compiler);
        print(path, &built);
        failed |= built.report.has_errors();
        if let (Some(out), Some(bundle)) = (out, &built.bundle) {
            std::fs::create_dir_all(out)
                .map_err(|e| format!("couldn't make {}: {e}", out.display()))?;
            let name = Path::new(path)
                .file_name()
                .expect("a profile's path names a file");
            write_whole(&out.join(name), bundle)?;
        }
    }
    Ok(failed)
}

pub(crate) fn print(path: &str, built: &Built) {
    eprint!("{}", built.report);
    match (&built.hash, built.level) {
        (Some(hash), Some(level)) => println!("{path}: level {level}, {hash}"),
        _ => println!("{path}: failed"),
    }
}

/// Writes a file through one beside it renamed over it, so a core reading the folder never
/// reads half a bundle.
pub(crate) fn write_whole(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut new = path.as_os_str().to_owned();
    new.push(".new");
    std::fs::write(&new, bytes)
        .and_then(|()| std::fs::rename(&new, path))
        .map_err(|e| format!("couldn't write {}: {e}", path.display()))
}

/// Builds, then builds again whenever a profile or module changes, checking every 300ms.
fn watch(target: &Path, out: &Path) -> Result<(), String> {
    let (root, _) = profiles(target)?;
    let mut compiler = Compiler::new();
    let mut last = None;
    loop {
        let now = stamps(&root);
        if last.as_ref() != Some(&now) {
            build_all(target, Some(out), &mut compiler)?;
            println!("watching {} for changes", root.display());
            last = Some(now);
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// Each YAML file under the profiles' folder, with when it last changed.
fn stamps(root: &Path) -> BTreeMap<PathBuf, SystemTime> {
    let mut found = BTreeMap::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for entry in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                folders.push(path);
            } else if path.extension().is_some_and(|e| e == "yaml")
                && let Ok(modified) = entry.metadata().and_then(|m| m.modified())
            {
                found.insert(path, modified);
            }
        }
    }
    found
}

/// Writes each level's JSON Schemas, a profile's and a module's, and its declarations into the
/// profile engine's `levels/`, where they're committed; `node tools/check.ts` writes them again
/// and fails on a difference.
fn levels() -> Result<(), String> {
    let folder =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/engines/profile-engine/levels");
    for level in 1..=profile_engine::LEVEL {
        let dir = folder.join(level.to_string());
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("couldn't make {}: {e}", dir.display()))?;
        for file in [
            profile_engine::Schema::Profile,
            profile_engine::Schema::Module,
        ] {
            write_whole(
                &dir.join(file.file_name()),
                profile_engine::schema(level, file).as_bytes(),
            )?;
        }
        write_whole(
            &dir.join("declarations.d.ts"),
            profile_engine::declarations(level).as_bytes(),
        )?;
    }
    Ok(())
}

/// The time now in UTC, as `2026-10-20T14:02:11Z`.
fn utc_now() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("the clock should be after 1970")
        .as_secs();
    utc(secs)
}

/// A count of seconds since 1970 in UTC, by Howard Hinnant's days-to-civil algorithm.
fn utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_time_is_written_as_rfc_3339() {
        assert_eq!(utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc(1_792_505_000), "2026-10-20T14:03:20Z");
        assert_eq!(utc(951_782_400), "2000-02-29T00:00:00Z");
    }
}
