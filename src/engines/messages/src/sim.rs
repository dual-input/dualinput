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

impl Stage {
    /// Whether the sim is in a flight: at Ready to fly or flying.
    pub fn in_a_flight(self) -> bool {
        matches!(self, Stage::ReadyToFly | Stage::Flying)
    }
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
    /// `MasterPage` with `FreeFlightPage` on it, Free flight's world map.
    WorldMap,
    /// `MasterPage_InGame`, a flight's.
    InGame,
}

/// Where the pilot is, which the aircraft picker and Join turn on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum Place {
    MainMenu,
    WorldMap,
    Flight,
}

impl Place {
    /// A load counts as a flight, since no aircraft can be picked once it's begun.
    pub fn of(stage: Stage, page: MenuPage) -> Place {
        match (stage, page) {
            (Stage::Loading | Stage::ReadyToFly | Stage::Flying, _) => Place::Flight,
            (Stage::Menu, MenuPage::WorldMap) => Place::WorldMap,
            _ => Place::MainMenu,
        }
    }
}

/// The aircraft the sim last loaded, the main menu's own included, as the start card names it.
/// A name stays `None` where it can't be read: a streamed copy keeps no `aircraft.cfg` on disk,
/// and an `aircraft.cfg` may give a name as a token of the sim's localization.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct NamedAircraft {
    pub path: String,
    /// `ui_manufacturer` in its `aircraft.cfg`.
    pub maker: Option<String>,
    /// `ui_type` in its `aircraft.cfg`.
    pub model: Option<String>,
    /// `A:ATC ID`.
    pub tail: Option<String>,
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
    /// `inFolders` in src/platform/efb-shell/src/session/pick.ts reads a path the same way, so
    /// change both together.
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

/// What the menu script sends the sim service: a report of its master page, or the answer to
/// a world map request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "sim/")]
pub enum FromMenuScript {
    Answer(WorldMapAnswer),
    Page(MenuReport),
}

/// A world map request, which the sim service sends the menu script as a `unit` message, with
/// the number of the call its answer names (record/areas/session/02-units.md, "The menu
/// script").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct WorldMapCall {
    pub call: u64,
    pub request: WorldMapRequest,
}

/// The menu script's answer to one request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct WorldMapAnswer {
    pub call: u64,
    pub outcome: WorldMapOutcome,
}

/// What the menu script does at Free flight's world map. It decides nothing beyond which list
/// entry matches a request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "do", rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum WorldMapRequest {
    /// Searches for the airport, and selects the result whose `ICAO` matches.
    DepartureAirport { icao: String },
    /// Selects the stand whose list name is `name` and `number` followed by ` --` or nothing,
    /// as "PARKING 140 -- RAMP CARGO" is for `GateName=PARKING; GateNumber=140`.
    DepartureStand { name: String, number: u32 },
    /// Selects the first runway the departure lists.
    DepartureRunway,
    /// Answers whether the aircraft list has the aircraft whose `SimObjects\Airplanes\` folder
    /// is `folder`, preferring the variation titled `title`, without selecting it.
    FindAircraft {
        folder: String,
        title: Option<String>,
    },
    /// Selects that aircraft.
    Aircraft {
        folder: String,
        title: Option<String>,
    },
    /// Selects the pilot flying's livery for the selected aircraft: the one named `name`, their
    /// `A:LIVERY NAME`, or with none, the one whose name ends `title`, their `A:TITLE`.
    Livery { name: Option<String>, title: String },
    /// Starts the flight.
    LaunchFlight,
    /// Presses Ready to fly.
    ReadyToFly,
}

/// How a request went.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "as", rename_all = "kebab-case")]
#[ts(export, export_to = "sim/")]
pub enum WorldMapOutcome {
    Done,
    /// No list entry matches, such as a stand the airport doesn't have.
    NoMatch,
    Failed {
        why: String,
    },
}

/// The sim service's slice of client state, `sim`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "sim/")]
pub struct SimSlice {
    pub stage: Stage,
    pub page: MenuPage,
    #[serde(rename = "where")]
    pub place: Place,
    pub aircraft: Option<NamedAircraft>,
    /// `Pause_EX1`'s flags, 0 when unpaused.
    pub pause: u32,
    /// How the run that ended last ended.
    pub ended: Option<Ending>,
    pub module: ModuleState,
}

/// The slice `SimSlice` is sent as.
pub const SLICE: &str = "sim";
