//! Aircraft awareness: the loaded aircraft's facts, which the session's match check and
//! avatars read, so no feature takes the aircraft's package from another's key. While a
//! session is held, at each aircraft load, a job finds the package that holds the aircraft's
//! folder in the packages folders `UserCfg.opt` names, and reads its `package_version`; and at
//! each load, the platform's connection reads the aircraft's title and livery
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The aircraft's facts").

use clients::{Clients, ClientsUnit, SettingDef};
use kernel::{Cx, Job, JobId, Moment};
use messages::clients::SettingKind;
use messages::sim::{Aircraft, AircraftFacts, Location};
use serde_json::json;
use sim_awareness::SimAwareness;
use sim_client::{Period, Value, Var};

use crate::SimService;
use crate::connections::Origin;

/// The development setting that names the sim's `UserCfg.opt` files, separated by `;`, which
/// the bench points at a packages folder of its own. A path may start with `%APPDATA%` or
/// `%LOCALAPPDATA%`, which the core's edge fills in.
pub const USER_CFG: &str = "sim.user-cfg";

/// Steam's `UserCfg.opt`, then the Microsoft Store's (record/areas/install/
/// 01-installing-and-updating.md, "The packages folders"). `userCfgs` in tools/lib/install.ts
/// names the same files, so change both together.
const USER_CFGS: &str = r"%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt;%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt";

/// The facts changed, the search's result included.
pub struct AircraftChanged;

impl Moment for AircraftChanged {}

/// Turns aircraft awareness on as a session starts, and off as it ends, since every v1 reader
/// of the facts is in a session.
pub fn aircraft_awareness(cx: &Cx, on: bool) {
    cx.call(SimService::set_awareness, on);
}

#[derive(Default)]
pub(crate) struct Awareness {
    on: bool,
    facts: Option<AircraftFacts>,
    /// The search running: its aircraft, the packages folders found so far, the reads of
    /// `UserCfg.opt` still out, and the job it waits on.
    search: Option<Search>,
    /// The once-read of the title and livery the platform's connection waits on.
    pub(crate) read: Option<u32>,
}

struct Search {
    aircraft: Aircraft,
    folders: Vec<String>,
    reads: Vec<JobId>,
    find: Option<JobId>,
    manifest: Option<(JobId, String, Location)>,
}

impl SimService {
    /// The loaded aircraft's facts, once aircraft awareness has found any.
    pub fn aircraft_facts(&self) -> Option<&AircraftFacts> {
        self.aware.facts.as_ref()
    }

    fn set_awareness(me: &mut SimService, on: bool, cx: &mut Cx) {
        me.aware.on = on;
        if !on {
            me.aware.search = None;
            return;
        }
        me.look(cx);
    }

    /// At each load that reaches Ready to fly or Flying: reads the title and livery, and while
    /// a session is held, searches for the aircraft's package.
    pub(crate) fn aircraft_loaded(&mut self, cx: &Cx) {
        let awareness = cx.read::<SimAwareness>();
        let Some(aircraft) = awareness.aircraft.clone() else {
            return;
        };
        let facts = AircraftFacts {
            aircraft: Some(aircraft),
            ..AircraftFacts::default()
        };
        self.aware.facts = Some(facts);
        self.read_title(cx);
        if self.aware.on {
            self.look(cx);
        }
        cx.raise(AircraftChanged);
    }

    fn read_title(&mut self, cx: &Cx) {
        let origin = Origin {
            unit: self.me(),
            handle: None,
        };
        let Some(client) = self.client(origin, cx) else {
            return;
        };
        let (watch, ops) = client.watch(
            &origin,
            &[Var::text("A:TITLE"), Var::text("A:LIVERY NAME")],
            Period::Once,
        );
        self.aware.read = Some(watch.request);
        self.make(origin, ops, cx);
    }

    /// The title and livery came, which the log shows beside the aircraft's path.
    pub(crate) fn title_read(&mut self, values: &[(usize, Value)], cx: &Cx) {
        let text = |at: usize| {
            values
                .iter()
                .find(|(i, _)| *i == at)
                .and_then(|(_, v)| match v {
                    Value::Text(t) if !t.is_empty() => Some(t.clone()),
                    _ => None,
                })
        };
        let (title, livery) = (text(0), text(1));
        let aircraft = cx.read::<SimAwareness>().aircraft.clone();
        tracing::info!(
            title,
            livery,
            aircraft = aircraft.as_ref().map(|a| a.path.as_str()),
            "the loaded aircraft's title and livery"
        );
        if let Some(facts) = &mut self.aware.facts
            && facts.aircraft == aircraft
        {
            facts.title = title;
            facts.livery = livery;
            cx.raise(AircraftChanged);
        }
    }

    /// Starts the search for the loaded aircraft's package: first each `UserCfg.opt`.
    fn look(&mut self, cx: &Cx) {
        let awareness = cx.read::<SimAwareness>();
        let flying = matches!(
            awareness.stage,
            messages::sim::Stage::ReadyToFly | messages::sim::Stage::Flying
        );
        let Some(aircraft) = awareness.aircraft.clone().filter(|_| flying) else {
            return;
        };
        let cfgs = cx
            .read::<Clients>()
            .setting_as::<String>(USER_CFG)
            .unwrap_or_else(|| USER_CFGS.to_string());
        let reads = cfgs
            .split(';')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(|path| cx.job(Job::read(path), SimService::user_cfg_read))
            .collect();
        self.aware.search = Some(Search {
            aircraft,
            folders: Vec::new(),
            reads,
            find: None,
            manifest: None,
        });
    }

    fn user_cfg_read(
        me: &mut SimService,
        job: JobId,
        result: Result<Vec<u8>, String>,
        cx: &mut Cx,
    ) {
        let Some(search) = &mut me.aware.search else {
            return;
        };
        let Some(at) = search.reads.iter().position(|j| *j == job) else {
            return;
        };
        search.reads.remove(at);
        if let Ok(bytes) = result
            && let Some(folder) = packages_folder(&String::from_utf8_lossy(&bytes))
        {
            search.folders.push(folder);
        }
        if !search.reads.is_empty() {
            return;
        }
        if search.folders.is_empty() {
            tracing::info!(
                "no UserCfg.opt names a packages folder, so the aircraft counts as streamed"
            );
            return me.searched(None, cx);
        }
        let roots = search
            .folders
            .iter()
            .flat_map(|folder| ROOTS.map(|(name, depth, _)| (format!(r"{folder}\{name}"), depth)))
            .collect();
        let holding = format!(r"SimObjects\Airplanes\{}", search.aircraft.folder());
        search.find = Some(cx.job(Job::find(roots, holding), SimService::package_found));
    }

    fn package_found(
        me: &mut SimService,
        job: JobId,
        result: Result<Vec<u8>, String>,
        cx: &mut Cx,
    ) {
        let Some(search) = &mut me.aware.search else {
            return;
        };
        if search.find != Some(job) {
            return;
        }
        search.find = None;
        let found = match result {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(error) => {
                tracing::warn!(error, "the search for the aircraft's package failed");
                String::new()
            }
        };
        // The first root, in the order the sim prefers a package found in two, that holds one.
        let best = ROOTS.iter().find_map(|(name, _, location)| {
            let path = found.lines().find(|path| {
                search
                    .folders
                    .iter()
                    .any(|f| path.starts_with(&format!(r"{f}\{name}\")))
            })?;
            Some((path.to_string(), *location))
        });
        match best {
            Some((package, location)) => {
                let manifest = format!(r"{package}\manifest.json");
                let job = cx.job(Job::read(manifest), SimService::manifest_read);
                search.manifest = Some((job, package, location));
            }
            None => me.searched(None, cx),
        }
    }

    fn manifest_read(
        me: &mut SimService,
        job: JobId,
        result: Result<Vec<u8>, String>,
        cx: &mut Cx,
    ) {
        let Some((_, package, location)) = me
            .aware
            .search
            .as_mut()
            .and_then(|s| s.manifest.take_if(|(j, _, _)| *j == job))
        else {
            return;
        };
        let version = result.ok().and_then(|bytes| {
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()?
                .get("package_version")?
                .as_str()
                .map(str::to_string)
        });
        let name = package.rsplit('\\').next().unwrap_or(&package).to_string();
        me.searched(Some((name, location, version)), cx);
    }

    /// The search ended: a package, where it's installed, and its version, or none, which
    /// counts as streamed, since a streamed package keeps no aircraft folder on disk
    /// (record/areas/aircraft/log.md, 2026-10-16).
    fn searched(&mut self, package: Option<(String, Location, Option<String>)>, cx: &Cx) {
        let Some(search) = self.aware.search.take() else {
            return;
        };
        let Some(facts) = &mut self.aware.facts else {
            return;
        };
        if facts.aircraft.as_ref() != Some(&search.aircraft) {
            return;
        }
        let (package, location, version) = match package {
            Some((name, location, version)) => (Some(name), location, version),
            None => (None, Location::Streamed, None),
        };
        tracing::info!(
            package,
            ?location,
            version,
            aircraft = search.aircraft.path,
            "the aircraft's package"
        );
        facts.package = package;
        facts.location = Some(location);
        facts.version = version;
        cx.raise(AircraftChanged);
    }
}

/// The packages folders' children that hold packages, how deep a package sits under each, and
/// where a package there is installed, in the order the sim prefers one found in two: a
/// package in `Community2024` over `Community`, and either over an Official one (documented,
/// [Virtual File System Information](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/Virtual_File_System_Information.htm)).
/// The Official folders hold a folder for each store, such as `Steam`, with the packages
/// inside it (record/areas/aircraft/log.md, 2026-10-16).
const ROOTS: [(&str, u8, Location); 4] = [
    ("Community2024", 1, Location::Community2024),
    ("Community", 1, Location::Community),
    ("Official2024", 2, Location::Official),
    ("Official2020", 2, Location::Official),
];

/// The folder `UserCfg.opt`'s `InstalledPackagesPath` line names, matched by its name and a
/// space, so a longer name such as `InstalledPackagesPathNextBoot` doesn't match.
/// `packagesFolders` in tools/lib/install.ts reads the line the same way, so change both
/// together.
fn packages_folder(cfg: &str) -> Option<String> {
    let line = cfg
        .lines()
        .find_map(|l| l.trim_start().strip_prefix("InstalledPackagesPath "))?;
    let folder = line.trim().trim_matches('"').trim_end_matches('\\');
    (!folder.is_empty()).then(|| folder.to_string())
}

/// Registers the setting that names the sim's `UserCfg.opt` files.
pub(crate) fn setting(me: &mut kernel::Unit<'_, SimService>) {
    me.setting(
        USER_CFG,
        SettingDef {
            label: "The sim's UserCfg.opt files, separated by ;",
            kind: SettingKind::Text,
            default: json!(USER_CFGS),
            part_only: false,
            development: true,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_packages_folder_is_the_line_named_installedpackagespath() {
        let cfg = "Version 1\r\nInstalledPackagesPathNextBoot \"D:\\Other\"\r\nInstalledPackagesPath \"D:\\MSFS\\Packages\"\r\n";
        assert_eq!(packages_folder(cfg).as_deref(), Some(r"D:\MSFS\Packages"));
        assert_eq!(packages_folder("Version 1\r\n"), None);
    }
}
