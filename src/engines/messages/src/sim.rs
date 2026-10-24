//! What the core knows of the sim, which the apps show: the stage the sim is in, the menu's
//! page, and the loaded aircraft (record/areas/core/03-sim-seam-and-wasm-module.md, "Sim
//! awareness").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where the sim is, from its process found to its close.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum Stage {
    /// No sim runs, or the one that ran has quit or crashed.
    #[default]
    Closed,
    /// The sim's process was found, and no signal has said yet whether it's in the main
    /// menu or a flight.
    Starting,
    Menu,
    Loading,
    ReadyToFly,
    Flying,
}

/// The menu's page, as the menu script last reported it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum MenuPage {
    /// No report yet, or none since the sim's process was found.
    #[default]
    Unknown,
    /// `MasterPage`, the main menu's.
    Main,
    /// `MasterPage_InGame`, a flight's.
    InGame,
}

/// The loaded aircraft, by the part of its `aircraft.cfg` path that names its folder and
/// preset, such as `pa24-250/presets/a2a/pa24-250`: lowercase, with `/` between its parts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct Aircraft {
    pub path: String,
}

impl Aircraft {
    /// The aircraft's folder under `SimObjects\Airplanes\`, the path's first part.
    pub fn folder(&self) -> &str {
        self.path.split('/').next().unwrap_or(&self.path)
    }
}

/// Where a package is installed: a Community folder, an Official one, or streamed, which
/// keeps no package of the aircraft's on disk (record/areas/aircraft/log.md, 2026-10-16).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum Location {
    Community,
    Community2024,
    Official,
    Streamed,
}

/// The loaded aircraft's facts, aircraft awareness, which the sim service finds while a
/// session is held (record/areas/core/03-sim-seam-and-wasm-module.md, "The aircraft's facts").
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct AircraftFacts {
    /// The aircraft these facts are of.
    pub aircraft: Option<Aircraft>,
    /// The package that holds the aircraft's folder, by its folder's name, unless it's
    /// streamed.
    pub package: Option<String>,
    /// Where it's installed, once the search has run.
    pub location: Option<Location>,
    /// The package's `package_version`, where its `manifest.json` has one.
    pub version: Option<String>,
    /// `A:LIVERY NAME`.
    pub livery: Option<String>,
    /// `A:TITLE`, which names the aircraft to the crew.
    pub title: Option<String>,
}

/// How a run of the sim ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "as", rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum Ending {
    /// The quit message came.
    Close,
    /// The process exited with no quit message before it, with this exit code.
    Crash { code: u32 },
}

/// Our WASM module's status, as the sim service reads it
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "The module's status").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum ModuleState {
    /// No write to the status slot heard yet.
    #[default]
    Missing,
    /// The module's slots hash isn't the core's, so it runs none of this core's feeds.
    Differs,
    /// Its counter moves.
    Running,
    /// Its counter has been still for 3s spent in Flying, unpaused, with a routine live.
    Stopped,
}

/// The menu script's report of its master page, a `unit` message to the sim service, which
/// asks for one with an empty `unit` message as the script's socket joins
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "Leaving Starting").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct MenuReport {
    pub master: MenuPage,
}

/// The unit the menu script's report goes to, and its ask comes from.
/// src/sim-package/pages/menu.ts names it too, so change both together.
pub const MENU_UNIT: &str = "sim-service";

/// The sim service's slice of client state, `sim`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct SimSlice {
    pub stage: Stage,
    pub page: MenuPage,
    pub aircraft: Option<Aircraft>,
    /// `Pause_EX1`'s flags, 0 when unpaused.
    pub pause: u32,
    /// How the run that ended last ended.
    pub ended: Option<Ending>,
    pub module: ModuleState,
}

/// The slice `SimSlice` is sent as.
pub const SLICE: &str = "sim";
