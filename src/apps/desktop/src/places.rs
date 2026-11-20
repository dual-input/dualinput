//! Where the desktop app finds what it reads and writes. One runs for each data folder, as one core does: the pilot's,
//! `%APPDATA%\DualInput\`, unless `--data` names a development core's, as the bench's does (record/areas/install/
//! 01-installing-and-updating.md, "One program from login"). The app reads the development settings it shares with the core
//! from the core's `settings.json` there, so one file says where a development build's packages folders are for both.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use messages::clients::PORT_FILE;
use serde_json::Value;

/// The core's program, which a release lays out beside this one (record/areas/build/01-the-build.md, "What a release holds").
const CORE: &str = "dualinput-core.exe";
/// The session file, which the core writes in the data folder while a session is held. `NAME` in
/// src/platform/session/src/file.rs names the same file, so change both together.
const SESSION_FILE: &str = "session.json";
/// The core's settings, which it keeps every key of, ours among them. `FILE` in src/platform/clients/src/settings.rs names
/// the same file, so change both together.
const SETTINGS_FILE: &str = "settings.json";
/// The development setting that names the sim's `UserCfg.opt` files, separated by `;`. `USER_CFG` in
/// src/platform/sim-service/src/aircraft.rs names the same key, so change both together.
const USER_CFG: &str = "sim.user-cfg";
/// Steam's `UserCfg.opt`, then the Microsoft Store's. `USER_CFGS` in src/platform/sim-service/src/aircraft.rs, `userCfgs`
/// in tools/lib/install.ts, and `USER_CFGS` in tools/profile-author's cockpit.rs name the same files, so change all four
/// together.
const USER_CFGS: &str = r"%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt;%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt";

static DATA: OnceLock<Data> = OnceLock::new();

struct Data {
    folder: PathBuf,
    /// Whether `--data` named it, which a core this app starts is told too.
    named: bool,
}

/// Sets the data folder, from `--data` or the pilot's own. Called once, before anything reads it.
pub fn set_data_folder(named: Option<PathBuf>) {
    let data = match named {
        Some(folder) => Data {
            folder,
            named: true,
        },
        None => Data {
            folder: pilots_folder().unwrap_or_else(|| PathBuf::from("DualInput")),
            named: false,
        },
    };
    let _ = DATA.set(data);
}

/// `%APPDATA%\DualInput`, the pilot's data folder.
pub fn pilots_folder() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|data| Path::new(&data).join("DualInput"))
}

fn data() -> &'static Data {
    DATA.get().expect("main should set the data folder first")
}

pub fn data_folder() -> &'static Path {
    &data().folder
}

/// The data folder `--data` named, if any, which a core this app starts takes too.
pub fn named_data_folder() -> Option<&'static Path> {
    data().named.then(|| data().folder.as_path())
}

/// The folder that holds what the desktop app writes for itself, its log and its figures.
pub fn app_folder() -> PathBuf {
    data_folder().join("app")
}

/// The folder this program runs from, Velopack's `current\` in a release.
pub fn program_folder() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|program| program.parent().map(Path::to_path_buf))
        .unwrap_or_default()
}

/// The core's program, beside this one, which the firewall rule names.
pub fn core_program() -> PathBuf {
    program_folder().join(CORE)
}

pub fn port_file() -> PathBuf {
    data_folder().join(PORT_FILE)
}

pub fn session_held() -> bool {
    data_folder().join(SESSION_FILE).exists()
}

/// A development setting from the core's `settings.json`, which a developer or the bench writes. A file that doesn't read
/// holds none, as the core takes it.
pub fn setting(key: &str) -> Option<Value> {
    let text = std::fs::read_to_string(data_folder().join(SETTINGS_FILE)).ok()?;
    let mut all: serde_json::Map<String, Value> = serde_json::from_str(&text).ok()?;
    all.remove(key)
}

/// The sim's `UserCfg.opt` files, as the core's sim service finds them: the setting's paths, each with `%APPDATA%` or
/// `%LOCALAPPDATA%` filled in, and a relative one in the data folder.
pub fn user_cfgs() -> Vec<PathBuf> {
    let listed = setting(USER_CFG)
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| USER_CFGS.to_string());
    listed
        .split(';')
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter_map(|path| {
            let filled = fill(path)?;
            Some(if filled.is_absolute() {
                filled
            } else {
                data_folder().join(filled)
            })
        })
        .collect()
}

/// `path` with a leading `%APPDATA%` or `%LOCALAPPDATA%` filled in, or none when Windows names no such folder.
fn fill(path: &str) -> Option<PathBuf> {
    for (name, variable) in [("%APPDATA%", "APPDATA"), ("%LOCALAPPDATA%", "LOCALAPPDATA")] {
        if let Some(rest) = path.strip_prefix(name) {
            let base = std::env::var_os(variable)?;
            return Some(PathBuf::from(format!("{}{rest}", base.to_string_lossy())));
        }
    }
    Some(PathBuf::from(path))
}

/// The packages folder each `UserCfg.opt` names, once each.
pub fn packages_folders() -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = Vec::new();
    for cfg in user_cfgs() {
        let Ok(text) = std::fs::read_to_string(&cfg) else {
            continue;
        };
        let Some(folder) = packages_folder(&text) else {
            crate::log::line(&format!(
                "{} names no packages folder, so our add-on goes in none it might name",
                cfg.display()
            ));
            continue;
        };
        if !folders
            .iter()
            .any(|known| same_path(known, Path::new(&folder)))
        {
            folders.push(PathBuf::from(folder));
        }
    }
    folders
}

/// The folder `UserCfg.opt`'s `InstalledPackagesPath` line names, matched by its name and a space, so a longer name such as
/// `InstalledPackagesPathNextBoot` doesn't match. `packages_folder` in src/platform/sim-service/src/aircraft.rs,
/// `packagesFolders` in tools/lib/install.ts, and `packages_folders` in tools/profile-author's cockpit.rs read the line the
/// same way, so change all four together.
fn packages_folder(cfg: &str) -> Option<String> {
    let line = cfg
        .lines()
        .find_map(|l| l.trim_start().strip_prefix("InstalledPackagesPath "))?;
    let folder = line.trim().trim_matches('"').trim_end_matches('\\');
    (!folder.is_empty()).then(|| folder.to_string())
}

/// Whether two paths name one file, as Windows compares them, without regard to letter case.
pub fn same_path(a: &Path, b: &Path) -> bool {
    let plain = |path: &Path| {
        path.to_string_lossy()
            .trim_end_matches('\\')
            .replace('/', "\\")
            .to_lowercase()
    };
    plain(a) == plain(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_packages_folder_is_the_line_named_installedpackagespath() {
        let cfg = "Version 1\r\nInstalledPackagesPathNextBoot \"D:\\Other\"\r\nInstalledPackagesPath \"D:\\MSFS\\Packages\\\"\r\n";
        assert_eq!(packages_folder(cfg).as_deref(), Some(r"D:\MSFS\Packages"));
        assert_eq!(packages_folder("Version 1\r\n"), None);
    }

    #[test]
    fn paths_compare_as_windows_compares_them() {
        assert!(same_path(
            Path::new(r"C:\Users\Pilot\AppData\Local\DualInput\current\dualinput-core.exe"),
            Path::new(r"c:\users\pilot\appdata\local\dualinput\CURRENT\dualinput-core.exe"),
        ));
        assert!(same_path(
            Path::new(r"D:\Packages\"),
            Path::new("D:/Packages")
        ));
        assert!(!same_path(
            Path::new(r"D:\Packages"),
            Path::new(r"D:\Packages2")
        ));
    }
}
