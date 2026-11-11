//! Writing our package into each packages folder's `Community` where it's missing or of another version, at the app's start
//! and each time the sim closes, which writes it at an install, after an update or a reinstall, and after a pilot or a mod
//! deletes it (record/areas/install/01-installing-and-updating.md, "Our package"). Only an installed app writes it, since a
//! rebuild keeps the version and this rule would never copy a developer's rebuild in; `node tools/build.ts install` does.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Our package's folder, which the release holds beside the programs. `PACKAGE_NAME` in tools/lib/package.ts names the same
/// folder, so change both together.
pub const NAME: &str = "dualinput";

/// What a write did in one packages folder.
#[derive(Debug, PartialEq)]
pub enum Wrote {
    /// The package there was already this version.
    Current,
    Written,
    /// The sim started during the copy, so nothing was swapped, and the next close writes it.
    SimStarted,
}

/// The version a package's `manifest.json` gives, if it reads.
fn version_in(package: &Path) -> Option<String> {
    let text = fs::read_to_string(package.join("manifest.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    manifest
        .get("package_version")?
        .as_str()
        .map(str::to_string)
}

/// Writes `package`, whose version is `version`, into `packages`' `Community`, unless what's there is that version.
/// `sim_running` is asked right before the swap, since the sim reads packages only as it starts, and a swap under a starting
/// sim could hand it half of each.
pub fn write(
    package: &Path,
    version: &str,
    packages: &Path,
    sim_running: impl Fn() -> bool,
) -> io::Result<Wrote> {
    let community = packages.join("Community");
    let installed = community.join(NAME);
    if version_in(&installed).as_deref() == Some(version) {
        return Ok(Wrote::Current);
    }
    fs::create_dir_all(&community)?;
    // A pilot can make Community a junction to another drive, and a rename can't cross drives, so the copy goes beside the
    // folder the junction leads to. That folder can be anything, such as %APPDATA%, where a fixed name could be the pilot's
    // data folder, so the copy goes in a folder made fresh for it, and nothing it didn't make is deleted
    // (record/areas/install/log.md, 2026-10-21). `copyInto` in tools/lib/install.ts copies the same way, so change both
    // together.
    let real = fs::canonicalize(&community)?;
    let beside = real.parent().unwrap_or(&real);
    let stage = fresh_folder(beside)?;
    let wrote = swap_in(package, &stage, &real.join(NAME), &sim_running);
    // The old copy may be a junction a pilot made, which goes as a link alone.
    remove(&stage.join("old"))?;
    remove(&stage)?;
    wrote
}

fn swap_in(
    package: &Path,
    stage: &Path,
    installed: &Path,
    sim_running: &impl Fn() -> bool,
) -> io::Result<Wrote> {
    // A copy made inside Community would most likely mount as a second package, and our FS Copilot exerciser's sync that
    // deleted before it copied "deleted 349 of 355 files" before it reached one in use, so it copies first, then swaps.
    let fresh = stage.join(NAME);
    copy_folder(package, &fresh)?;
    if sim_running() {
        return Ok(Wrote::SimStarted);
    }
    let old = stage.join("old");
    if exists(installed) {
        fs::rename(installed, &old)?;
    }
    fs::rename(&fresh, installed)?;
    Ok(Wrote::Written)
}

/// A folder beside `community`'s target named `dualinput-install-` and a suffix no other copy has.
fn fresh_folder(beside: &Path) -> io::Result<PathBuf> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.subsec_nanos());
    for attempt in 0..100u32 {
        let folder = beside.join(format!(
            "dualinput-install-{}-{nanos:x}-{attempt}",
            std::process::id()
        ));
        match fs::create_dir(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other(
        "no fresh folder could be made for the copy",
    ))
}

fn copy_folder(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_folder(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Whether `path` exists, a junction that leads nowhere included.
fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// Deletes `path`, or only the link when it's a junction or a symbolic link, since fsc-editor found two packages in our
/// Community folder that were junctions to folders under Program Files (read in fsc-editor, `src/main/sim/install.ts`,
/// `removeEntry`). The standard library takes a junction for a symbolic link here.
pub fn remove(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
        Ok(found) if found.file_type().is_symlink() => fs::remove_dir(path),
        Ok(found) if found.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
    }
}

/// Deletes our package from `packages`' `Community`, as an uninstall does.
pub fn delete(packages: &Path) -> io::Result<()> {
    remove(&packages.join("Community").join(NAME))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("dualinput-package-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn package(at: &Path, version: &str) -> PathBuf {
        let package = at.join(NAME);
        fs::create_dir_all(package.join("modules")).unwrap();
        fs::write(
            package.join("manifest.json"),
            format!(r#"{{"package_version": "{version}"}}"#),
        )
        .unwrap();
        fs::write(package.join("modules").join("dualinput.wasm"), version).unwrap();
        package
    }

    fn only_community(packages: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(packages)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_missing_or_other_version_is_written_and_a_current_one_left() {
        let folder = Folder::new("versions");
        let ours = package(&folder.0.join("release"), "1.0.3");
        let packages = folder.0.join("Packages");
        assert_eq!(
            write(&ours, "1.0.3", &packages, || false).unwrap(),
            Wrote::Written
        );
        let installed = packages.join("Community").join(NAME);
        assert_eq!(version_in(&installed).as_deref(), Some("1.0.3"));

        assert_eq!(
            write(&ours, "1.0.3", &packages, || false).unwrap(),
            Wrote::Current
        );

        package(&packages.join("Community"), "1.0.2");
        assert_eq!(
            write(&ours, "1.0.3", &packages, || false).unwrap(),
            Wrote::Written
        );
        assert_eq!(
            fs::read_to_string(installed.join("modules").join("dualinput.wasm")).unwrap(),
            "1.0.3"
        );
        assert_eq!(only_community(&packages), ["Community"]);
    }

    #[test]
    fn a_sim_that_starts_during_the_copy_leaves_the_old_package() {
        let folder = Folder::new("sim");
        let ours = package(&folder.0.join("release"), "1.0.3");
        let packages = folder.0.join("Packages");
        package(&packages.join("Community"), "1.0.2");
        assert_eq!(
            write(&ours, "1.0.3", &packages, || true).unwrap(),
            Wrote::SimStarted
        );
        assert_eq!(
            version_in(&packages.join("Community").join(NAME)).as_deref(),
            Some("1.0.2")
        );
        assert_eq!(only_community(&packages), ["Community"]);
    }

    #[test]
    fn a_junction_is_unlinked_and_what_it_leads_to_kept() {
        let folder = Folder::new("junction");
        let target = package(&folder.0.join("elsewhere"), "0.9.0");
        let community = folder.0.join("Packages").join("Community");
        fs::create_dir_all(&community).unwrap();
        let link = community.join(NAME);
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .unwrap();
        assert!(made.status.success(), "mklink should make a junction");
        delete(&folder.0.join("Packages")).unwrap();
        assert!(!exists(&link));
        assert!(target.join("manifest.json").exists());
    }
}
