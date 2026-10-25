//! Aircraft awareness: the loaded aircraft's facts, which the session's match check and
//! avatars read, so no feature takes the aircraft's package from another's key. While a
//! session is held, at each aircraft load, a job finds the package that holds the aircraft's
//! folder in the packages folders `UserCfg.opt` names, and reads its `package_version`; and at
//! each load, the platform's connection reads the aircraft's title and livery
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The aircraft's facts").
//!
//! The same search names the aircraft the sim last loaded, in a session or not, from its
//! `aircraft.cfg`, and finds whether a package on disk holds a folder a profile covers
//! (record/areas/interface/decisions.md, "Home names the loaded aircraft and offers Host and
//! Join, in any aircraft").

use clients::{Clients, ClientsUnit, SettingDef};
use kernel::{Cx, Job, JobId, Moment};
use messages::clients::SettingKind;
use messages::sim::{Aircraft, AircraftFacts, Location, NamedAircraft};
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
/// 01-installing-and-updating.md, "The packages folders"). `userCfgs` in tools/lib/install.ts,
/// `sim_has_run` in src/apps/desktop/src/screens.rs, and `USER_CFGS` in tools/profile-author's
/// cockpit.rs name the same files, so change all four together.
const USER_CFGS: &str = r"%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt;%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt";

/// The facts changed, the search's result included.
pub struct AircraftChanged;

impl Moment for AircraftChanged {}

/// `find_package`'s answer: whether a package on disk holds this folder under
/// `SimObjects\Airplanes\`. A streamed copy keeps no folder on disk, so it answers no.
pub struct PackageFound {
    pub folder: String,
    pub installed: bool,
}

impl Moment for PackageFound {}

/// Turns aircraft awareness on as a session starts, and off as it ends, since every v1 reader
/// of the facts is in a session.
pub fn aircraft_awareness(cx: &Cx, on: bool) {
    cx.call(SimService::set_awareness, on);
}

/// Looks for a package on disk that holds `folder`, answering in `PackageFound`.
pub fn find_package(cx: &Cx, folder: String) {
    cx.call(SimService::find_folder, folder);
}

#[derive(Default)]
pub(crate) struct Awareness {
    on: bool,
    facts: Option<AircraftFacts>,
    /// The package's folder on this PC, which avatars' model job reads from. It stays out of
    /// the facts, which the match check hands the crew, since a path on disk can name the
    /// pilot's home folder.
    folder: Option<String>,
    /// The searches running, at most one for the facts and one for the name.
    searches: Vec<Search>,
    /// The once-read of the title and livery the platform's connection waits on.
    pub(crate) read: Option<u32>,
    /// The aircraft the sim last loaded, by name.
    named: Option<NamedAircraft>,
    /// The once-read of `A:ATC ID` the platform's connection waits on.
    pub(crate) tail_read: Option<u32>,
}

/// What a search for a package is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Finding {
    /// The session's facts: the package, where it's installed, and its version.
    Facts,
    /// The start card's name for the aircraft.
    Name,
    /// `find_package`'s answer.
    Installed,
}

/// A search running: what it's for, its aircraft, the packages folders found so far, the reads
/// of `UserCfg.opt` still out, and the job it waits on.
struct Search {
    finding: Finding,
    aircraft: Aircraft,
    folders: Vec<String>,
    reads: Vec<JobId>,
    find: Option<JobId>,
    manifest: Option<(JobId, String, Location)>,
    /// The read of the aircraft's `aircraft.cfg`, the package that holds it, and whether this is
    /// the second place it can be.
    cfg: Option<(JobId, String, bool)>,
}

impl SimService {
    /// The loaded aircraft's facts, once aircraft awareness has found any.
    pub fn aircraft_facts(&self) -> Option<&AircraftFacts> {
        self.aware.facts.as_ref()
    }

    /// The aircraft the sim last loaded, as the slice `sim` names it, with what's been read of
    /// its name so far.
    pub(crate) fn named_aircraft(&self, awareness: &SimAwareness) -> Option<NamedAircraft> {
        let aircraft = awareness.selected.as_ref()?;
        Some(
            self.aware
                .named
                .clone()
                .filter(|n| n.path == aircraft.path)
                .unwrap_or_else(|| NamedAircraft {
                    path: aircraft.path.clone(),
                    maker: None,
                    model: None,
                    tail: None,
                }),
        )
    }

    /// The loaded aircraft's package folder on this PC, such as
    /// `<packages>\Community\bksq-aircraft-baronpro`, once the search has found one.
    pub fn package_folder(&self) -> Option<&str> {
        self.aware.folder.as_deref()
    }

    fn set_awareness(me: &mut SimService, on: bool, cx: &mut Cx) {
        me.aware.on = on;
        if !on {
            me.aware.searches.retain(|s| s.finding != Finding::Facts);
            return;
        }
        me.look(cx);
    }

    /// The sim loaded another aircraft, the main menu's own included: reads its tail and looks
    /// for its name.
    pub(crate) fn name_aircraft(&mut self, cx: &Cx) {
        let Some(aircraft) = cx.read::<SimAwareness>().selected.clone() else {
            self.aware.named = None;
            return;
        };
        self.aware.named = Some(NamedAircraft {
            path: aircraft.path.clone(),
            maker: None,
            model: None,
            tail: None,
        });
        self.read_tail(cx);
        self.search(Finding::Name, aircraft, cx);
    }

    /// Whether `A:ATC ID` reads at the main menu or the world map is unmeasured, and a read the sim
    /// refuses leaves the tail unknown, so each flight's load reads it again.
    fn read_tail(&mut self, cx: &Cx) {
        let origin = Origin {
            unit: self.me(),
            handle: None,
        };
        let Some(client) = self.client(origin, cx) else {
            return;
        };
        let (watch, ops) = client.watch(&origin, &[Var::text("A:ATC ID")], Period::Once);
        self.aware.tail_read = Some(watch.request);
        self.make(origin, ops, cx);
    }

    pub(crate) fn tail_read(&mut self, values: &[(usize, Value)]) {
        if let (Some(named), Some((_, Value::Text(tail)))) = (&mut self.aware.named, values.first())
            && !tail.is_empty()
        {
            named.tail = Some(tail.clone());
        }
    }

    fn find_folder(me: &mut SimService, folder: String, cx: &mut Cx) {
        me.search(Finding::Installed, Aircraft { path: folder }, cx);
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
        self.aware.folder = None;
        self.read_title(cx);
        self.read_tail(cx);
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
        self.search(Finding::Facts, aircraft, cx);
    }

    /// Starts a search, in place of any for the same aircraft's facts or name, whose answer the
    /// new one replaces: first each `UserCfg.opt`.
    fn search(&mut self, finding: Finding, aircraft: Aircraft, cx: &Cx) {
        if finding != Finding::Installed {
            self.aware.searches.retain(|s| s.finding != finding);
        }
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
        self.aware.searches.push(Search {
            finding,
            aircraft,
            folders: Vec::new(),
            reads,
            find: None,
            manifest: None,
            cfg: None,
        });
    }

    /// The search `waits` picks out by what it waits on.
    fn search_of(&mut self, waits: impl Fn(&Search) -> bool) -> Option<&mut Search> {
        self.aware.searches.iter_mut().find(|s| waits(s))
    }

    fn user_cfg_read(
        me: &mut SimService,
        job: JobId,
        result: Result<Vec<u8>, String>,
        cx: &mut Cx,
    ) {
        let Some(search) = me.search_of(|s| s.reads.contains(&job)) else {
            return;
        };
        search.reads.retain(|j| *j != job);
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
            let finding = (search.finding, search.aircraft.clone());
            return me.searched(finding, None, cx);
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
        let Some(search) = me.search_of(|s| s.find == Some(job)) else {
            return;
        };
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
        let finding = (search.finding, search.aircraft.clone());
        match (search.finding, best) {
            (Finding::Facts, Some((package, location))) => {
                let manifest = format!(r"{package}\manifest.json");
                let job = cx.job(Job::read(manifest), SimService::manifest_read);
                search.manifest = Some((job, package, location));
            }
            (Finding::Name, Some((package, _))) => {
                let job = cx.job(
                    Job::read(cfg_path(&package, &search.aircraft, false)).then(ui_names),
                    SimService::cfg_read,
                );
                search.cfg = Some((job, package, false));
            }
            (Finding::Installed, Some((package, location))) => {
                me.searched(finding, Some((package, location, None)), cx);
            }
            (_, None) => me.searched(finding, None, cx),
        }
    }

    fn manifest_read(
        me: &mut SimService,
        job: JobId,
        result: Result<Vec<u8>, String>,
        cx: &mut Cx,
    ) {
        let Some(search) = me.search_of(|s| matches!(s.manifest, Some((j, _, _)) if j == job))
        else {
            return;
        };
        let finding = (search.finding, search.aircraft.clone());
        let Some((_, package, location)) = search.manifest.take() else {
            return;
        };
        let version = result.ok().and_then(|bytes| {
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()?
                .get("package_version")?
                .as_str()
                .map(str::to_string)
        });
        me.searched(finding, Some((package, location, version)), cx);
    }

    /// The name's read of `aircraft.cfg`, which tries its second place when the first isn't there.
    fn cfg_read(me: &mut SimService, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let Some(search) = me.search_of(|s| matches!(s.cfg, Some((j, _, _)) if j == job)) else {
            return;
        };
        let finding = (search.finding, search.aircraft.clone());
        let Some((_, package, second)) = search.cfg.take() else {
            return;
        };
        let names = match result {
            Ok(bytes) => postcard::from_bytes::<(Option<String>, Option<String>)>(&bytes).ok(),
            Err(_) if !second => {
                let job = cx.job(
                    Job::read(cfg_path(&package, &search.aircraft, true)).then(ui_names),
                    SimService::cfg_read,
                );
                search.cfg = Some((job, package, true));
                return;
            }
            Err(error) => {
                tracing::info!(error, "the aircraft's aircraft.cfg couldn't be read");
                None
            }
        };
        if let Some((maker, model)) = names
            && let Some(named) = &mut me.aware.named
            && named.path == finding.1.path
        {
            named.maker = maker;
            named.model = model;
        }
        me.searched(finding, None, cx);
    }

    /// The search ended: a package's folder, where it's installed, and its version, or none,
    /// which counts as streamed, since a streamed package keeps no aircraft folder on disk
    /// (record/areas/aircraft/log.md, 2026-10-16).
    fn searched(
        &mut self,
        (finding, aircraft): (Finding, Aircraft),
        package: Option<(String, Location, Option<String>)>,
        cx: &Cx,
    ) {
        self.aware
            .searches
            .retain(|s| s.finding != finding || s.aircraft != aircraft);
        match finding {
            Finding::Facts => {}
            Finding::Name => return,
            Finding::Installed => {
                return cx.raise(PackageFound {
                    folder: aircraft.path,
                    installed: package.is_some(),
                });
            }
        }
        let Some(facts) = &mut self.aware.facts else {
            return;
        };
        if facts.aircraft.as_ref() != Some(&aircraft) {
            return;
        }
        let (folder, location, version) = match package {
            Some((folder, location, version)) => (Some(folder), location, version),
            None => (None, Location::Streamed, None),
        };
        let package = folder
            .as_deref()
            .map(|f| f.rsplit('\\').next().unwrap_or(f).to_string());
        self.aware.folder = folder;
        tracing::info!(
            package,
            ?location,
            version,
            aircraft = aircraft.path,
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
/// inside it (record/areas/aircraft/log.md, 2026-10-16). `ROOTS` in tools/profile-author's
/// cockpit.rs holds the same folders, which its `package` searches the same way, so change
/// both together.
const ROOTS: [(&str, u8, Location); 4] = [
    ("Community2024", 1, Location::Community2024),
    ("Community", 1, Location::Community),
    ("Official2024", 2, Location::Official),
    ("Official2020", 2, Location::Official),
];

/// The folder `UserCfg.opt`'s `InstalledPackagesPath` line names, matched by its name and a
/// space, so a longer name such as `InstalledPackagesPathNextBoot` doesn't match.
/// `packagesFolders` in tools/lib/install.ts and `packages_folders` in tools/profile-author's
/// cockpit.rs read the line the same way, so change all three together.
fn packages_folder(cfg: &str) -> Option<String> {
    let line = cfg
        .lines()
        .find_map(|l| l.trim_start().strip_prefix("InstalledPackagesPath "))?;
    let folder = line.trim().trim_matches('"').trim_end_matches('\\');
    (!folder.is_empty()).then(|| folder.to_string())
}

/// Where an aircraft's `aircraft.cfg` is in its package: in its folder or preset, or in the
/// `config` folder there.
fn cfg_path(package: &str, aircraft: &Aircraft, config: bool) -> String {
    let folder = aircraft.path.replace('/', "\\");
    let config = if config { r"config\" } else { "" };
    format!(r"{package}\SimObjects\Airplanes\{folder}\{config}aircraft.cfg")
}

/// Runs at the edge on an `aircraft.cfg`, so the recording holds only what the core reads of it:
/// the first `ui_manufacturer` and `ui_type`, as the sim's own menu names the aircraft.
fn ui_names(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let cfg = String::from_utf8_lossy(&bytes);
    postcard::to_stdvec(&(
        cfg_value(&cfg, "ui_manufacturer"),
        cfg_value(&cfg, "ui_type"),
    ))
    .map_err(|e| e.to_string())
}

/// The first value of `key` in an `aircraft.cfg`, such as `Airbus` from the line
/// `ui_manufacturer = "Airbus" ; e.g. Boeing, Cessna`. A value that's a token of the sim's
/// localization, as `TT:AIRCRAFT.UI_MANUFACTURER`, names nothing the core can show.
fn cfg_value(cfg: &str, key: &str) -> Option<String> {
    let value = cfg.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        name.trim().eq_ignore_ascii_case(key).then_some(value)
    })?;
    let value = value.trim_start();
    let value = match value.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next().unwrap_or(quoted),
        None => value.split(';').next().unwrap_or(value),
    };
    let value = value.trim();
    (!value.is_empty() && !value.starts_with("TT:")).then(|| value.to_string())
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

    #[test]
    fn a_cfg_value_comes_without_its_quotes_or_comment_and_a_token_names_nothing() {
        let cfg = "[FLTSIM.0]\r\ntitle = \"A\"\r\n  ui_manufacturer = \"Airbus\" ; e.g. Boeing, Cessna\r\nui_type = A320 ; a type\r\nui_createdby = \"TT:AIRCRAFT.BY\"\r\n[FLTSIM.1]\r\nui_type = \"A321\"\r\n";
        assert_eq!(cfg_value(cfg, "ui_manufacturer").as_deref(), Some("Airbus"));
        assert_eq!(cfg_value(cfg, "ui_type").as_deref(), Some("A320"));
        assert_eq!(cfg_value(cfg, "ui_createdby"), None);
        assert_eq!(cfg_value(cfg, "ui_variation"), None);
    }
}
