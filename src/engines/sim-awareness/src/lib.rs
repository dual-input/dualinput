//! Sim awareness: one step function from a signal of the sim to what the sim is doing, its
//! stage, the menu's page, the loaded aircraft and where its flight departed, the pause, and
//! the run of the sim and how it ended (record/areas/core/03-sim-seam-and-wasm-module.md,
//! "Sim awareness").
//!
//! The sim sends many signals for one load, and the sim service raises `SimChanged` for each
//! step that returns true, so a stage moves only on the few signals the design's table of
//! stages names. p08 heard `FLT_LOAD` three times inside one load, and `AircraftLoaded` twice
//! in the main menu before it, and each of those changes nothing here (measured on MSFS 2024,
//! 2026-10-09, record/areas/core/log.md, "2026-10-15: Two of the three `AircraftLoaded` our
//! client heard around a flight load came in the main menu").
//!
//! It holds no clock and does no I/O, so the core's loop, the bench, and the IDE reach the
//! same state from the same signals, which the sim service makes from SimConnect's messages,
//! the sim's process, the menu script's reports, and the flight file.

mod departure;

pub use departure::Departure;
pub use messages::sim::{Aircraft, MenuPage, Stage};

use simconnect_types::{
    SIMCONNECT_FLOW_EVENT, SIMCONNECT_FLOW_EVENT_BACK_TO_MAIN_MENU,
    SIMCONNECT_FLOW_EVENT_FLIGHT_END, SIMCONNECT_FLOW_EVENT_FLIGHT_START,
    SIMCONNECT_FLOW_EVENT_FLT_LOAD, SIMCONNECT_FLOW_EVENT_FLT_LOADED,
    SIMCONNECT_FLOW_EVENT_RTC_END, SIMCONNECT_FLOW_EVENT_RTC_START,
    SIMCONNECT_FLOW_EVENT_TELEPORT_DONE, SIMCONNECT_FLOW_EVENT_TELEPORT_START,
};

/// One thing the sim service heard, which it hands sim awareness as it arrives.
#[derive(Clone, Debug, PartialEq)]
pub enum Signal<'a> {
    /// The sim's process, as the sim edge watches it.
    Process(Process),
    /// The sim's quit message on the platform's connection.
    Quit,
    /// The `AircraftLoaded` system event, with the path of the `aircraft.cfg` it names.
    AircraftLoaded(&'a str),
    /// The answer to the `AircraftLoaded` state, which the platform's connection asks for
    /// as it opens. It names the aircraft of a load that began before the connection
    /// subscribed to the system event.
    AircraftState(&'a str),
    /// The `FlightLoaded` system event.
    FlightLoaded,
    Flow(Flow),
    /// `Pause_EX1`'s flags.
    Pause(u32),
    /// The menu script's report of its master page.
    Page(MenuPage),
    /// The `[Departure]` section of the flight file a `FlightLoaded` named, which the sim
    /// service reads as a job.
    Departure(Departure),
}

/// The sim's process, as the sim edge hands it up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Process {
    /// Found, with its ID and its creation time as a `FILETIME`.
    Found { process: u32, created: u64 },
    /// Exited, with `GetExitCodeProcess`'s code.
    Exited { code: u32 },
}

/// SimConnect's flow events, each the `SIMCONNECT_FLOW_EVENT_` constant of its name, and any
/// other by its number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flow {
    FltLoad,
    FltLoaded,
    TeleportStart,
    TeleportDone,
    BackToMainMenu,
    RtcStart,
    RtcEnd,
    FlightStart,
    FlightEnd,
    /// One no stage needs, such as `PLANE_CRASH`.
    Other(i32),
}

impl Flow {
    /// The flow event a flow event message carries as `id`.
    pub fn from_sdk(id: i32) -> Flow {
        let Ok(event) = SIMCONNECT_FLOW_EVENT::try_from(id) else {
            return Flow::Other(id);
        };
        match event {
            SIMCONNECT_FLOW_EVENT_FLT_LOAD => Flow::FltLoad,
            SIMCONNECT_FLOW_EVENT_FLT_LOADED => Flow::FltLoaded,
            SIMCONNECT_FLOW_EVENT_TELEPORT_START => Flow::TeleportStart,
            SIMCONNECT_FLOW_EVENT_TELEPORT_DONE => Flow::TeleportDone,
            SIMCONNECT_FLOW_EVENT_BACK_TO_MAIN_MENU => Flow::BackToMainMenu,
            SIMCONNECT_FLOW_EVENT_RTC_START => Flow::RtcStart,
            SIMCONNECT_FLOW_EVENT_RTC_END => Flow::RtcEnd,
            SIMCONNECT_FLOW_EVENT_FLIGHT_START => Flow::FlightStart,
            SIMCONNECT_FLOW_EVENT_FLIGHT_END => Flow::FlightEnd,
            _ => Flow::Other(id),
        }
    }
}

/// One run of the sim, which its process's ID and creation time name together
/// (record/areas/architecture/01-spine.md, "IDs").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SimRun {
    pub process: u32,
    pub created: u64,
}

/// How a run of the sim ended, which the apps show, so its type is the message crate's.
pub use messages::sim::Ending;

/// What the sim is doing, as its signals so far say.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SimAwareness {
    pub stage: Stage,
    /// The menu script's last report since the sim's process was found.
    pub page: MenuPage,
    /// The loaded aircraft: the last `AircraftLoaded` heard while Loading, or the
    /// `AircraftLoaded` state's answer when Starting gave way to Ready to fly or Flying.
    pub aircraft: Option<Aircraft>,
    /// The aircraft the sim last loaded, in a load or not, as the main menu loads the one it has
    /// selected, which the apps name before any flight (measured on MSFS 2024, 2026-10-07,
    /// record/areas/flight-controls/log.md).
    pub selected: Option<Aircraft>,
    /// Where the flight the sim service last read departed.
    pub departure: Option<Departure>,
    /// `Pause_EX1`'s flags, 0 when unpaused.
    pub pause: u32,
    /// The run whose process the edge holds, from its process found to its exit.
    pub run: Option<SimRun>,
    /// How the run that ended last ended.
    pub ended: Option<Ending>,
    held: Held,
}

/// What a later step needs and no reader sees, so `step` doesn't count a change to it.
#[derive(Clone, Debug, Default, PartialEq)]
struct Held {
    /// The `AircraftLoaded` state's answer.
    state: Option<Aircraft>,
    /// Whether the quit message came this run, which makes the process's exit a close.
    quit: bool,
}

impl SimAwareness {
    /// Takes one signal, and returns whether any public field changed, which is when the sim
    /// service raises `SimChanged`.
    pub fn step(&mut self, signal: Signal<'_>) -> bool {
        let mut before = self.clone();
        self.apply(signal);
        before.held = self.held.clone();
        *self != before
    }

    fn apply(&mut self, signal: Signal<'_>) {
        match signal {
            Signal::Process(Process::Found { process, created }) => {
                // The quit message closes the stage while the process still runs, and the
                // edge looks for another process only once that one has exited, so a new
                // run starts only when none is held.
                if self.run.is_none() {
                    // The last run's page, aircraft, departure, and pause describe a sim that
                    // has gone, so a new run starts with none, and the new sim reports its
                    // own. How the last run ended stays, for the crew's notification that their sim
                    // closed or crashed (record/areas/sync/04-order-and-recovery.md).
                    *self = SimAwareness {
                        stage: Stage::Starting,
                        run: Some(SimRun { process, created }),
                        ended: self.ended,
                        ..SimAwareness::default()
                    };
                }
            }
            Signal::Process(Process::Exited { code }) => {
                if self.run.take().is_some() {
                    if !self.held.quit {
                        self.ended = Some(Ending::Crash { code });
                    }
                    self.stage = Stage::Closed;
                }
            }
            // While Closed, only a process found moves the stage. A signal after the quit
            // message comes from a sim that's shutting down, so the page, aircraft, and the
            // rest stay as its run left them.
            _ if self.stage == Stage::Closed => {}
            Signal::Quit => {
                self.held.quit = true;
                self.stage = Stage::Closed;
                self.ended = Some(Ending::Close);
            }
            Signal::AircraftLoaded(path) => {
                // The main menu loads an aircraft of its own, and Developer Mode's Aircraft
                // Selector, which Dual Input doesn't support, loads one in a flight, so only
                // an `AircraftLoaded` inside a load names the pilot's aircraft.
                self.selected = aircraft(path);
                if self.stage == Stage::Loading {
                    self.aircraft = self.selected.clone();
                }
            }
            Signal::AircraftState(path) => {
                self.held.state = aircraft(path);
                self.selected = self.held.state.clone();
            }
            Signal::FlightLoaded => {
                // The new flight's file is read after this signal, and one with no
                // `[Departure]` section names no departure, so the last flight's goes now, and
                // Go to never sends a joiner to it.
                self.departure = None;
                if matches!(self.stage, Stage::Starting | Stage::Menu | Stage::Flying) {
                    self.stage = Stage::Loading;
                }
            }
            Signal::Flow(Flow::BackToMainMenu) => self.stage = Stage::Menu,
            // The pause menu's End flight sends FLIGHT_END and no BACK_TO_MAIN_MENU (measured
            // on MSFS 2024, 2026-10-21, record/areas/core/log.md). A Restart or a reload sends
            // FlightLoaded first, so its FLIGHT_END comes while Loading, and moves nothing.
            Signal::Flow(Flow::FlightEnd) => {
                if matches!(self.stage, Stage::ReadyToFly | Stage::Flying) {
                    self.stage = Stage::Menu;
                }
            }
            Signal::Flow(Flow::RtcStart) => {
                if matches!(self.stage, Stage::Starting | Stage::Loading) {
                    self.fly(Stage::ReadyToFly);
                }
            }
            Signal::Flow(Flow::RtcEnd) => {
                if matches!(self.stage, Stage::Starting | Stage::ReadyToFly) {
                    self.fly(Stage::Flying);
                }
            }
            Signal::Flow(_) => {}
            Signal::Pause(flags) => self.pause = flags,
            Signal::Page(page) => {
                self.page = page;
                // No SimConnect signal tells a core that found the sim mid-run whether it's in
                // the main menu or a flight, so the master page decides that once, and the
                // sim's own signals move the stage from there (record/areas/core/
                // 03-sim-seam-and-wasm-module.md, "Leaving Starting").
                if self.stage == Stage::Starting {
                    match page {
                        MenuPage::Main | MenuPage::WorldMap => self.stage = Stage::Menu,
                        MenuPage::InGame => self.fly(Stage::Flying),
                        MenuPage::Unknown => {}
                    }
                }
            }
            Signal::Departure(departure) => self.departure = Some(departure),
        }
    }

    /// Enters Ready to fly or Flying. From Starting, the load began before the platform's
    /// connection subscribed to `AircraftLoaded`, which reports only what happens after
    /// that, so the aircraft is the state's answer (record/learn/foundations/
    /// 04-02-events.md, "System events and state").
    fn fly(&mut self, stage: Stage) {
        if self.stage == Stage::Starting {
            self.aircraft = self.held.state.clone();
        }
        self.stage = stage;
    }
}

/// The aircraft an `aircraft.cfg` path names: the part after `SimObjects\Airplanes\`,
/// without a final `config\aircraft.cfg` or `aircraft.cfg`, lowercase, and with `/` between
/// its parts. So `SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG`
/// names `pa24-250/presets/a2a/pa24-250`. `None` for a path outside `SimObjects\Airplanes\`.
///
/// The sim reported one A350 load twice, 1ms apart, once relative and mixed-case and once
/// absolute and lowercase, so only this part of the path, in one case, names one aircraft
/// both times (record/learn/foundations/02-02-aircraft.md, "Traps").
pub fn aircraft(path: &str) -> Option<Aircraft> {
    // The leading `/` matches `simobjects` only as a whole folder's name.
    let path = format!("/{}", path.to_lowercase().replace('\\', "/"));
    let (_, rest) = path.split_once("/simobjects/airplanes/")?;
    let mut parts: Vec<&str> = rest.split('/').filter(|part| !part.is_empty()).collect();
    if parts.last() == Some(&"aircraft.cfg") {
        parts.pop();
        if parts.last() == Some(&"config") {
            parts.pop();
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(Aircraft {
        path: parts.join("/"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(text: &str) -> Option<String> {
        aircraft(text).map(|a| a.path)
    }

    /// The path the PA-24 reported (record/learn/foundations/02-02-aircraft.md, "How an
    /// aircraft is identified").
    #[test]
    fn a_preset_path_names_its_folder_and_preset() {
        let pa24 =
            aircraft(r"SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG")
                .unwrap();
        assert_eq!(pa24.path, "pa24-250/presets/a2a/pa24-250");
        assert_eq!(pa24.folder(), "pa24-250");
    }

    #[test]
    fn a_path_with_no_config_folder_names_the_aircraft_folder() {
        assert_eq!(
            path(r"SimObjects\Airplanes\bksq-aircraft-baronpropress\aircraft.CFG").as_deref(),
            Some("bksq-aircraft-baronpropress")
        );
    }

    /// The flight file p08's `FlightLoaded` named, then two made-up paths: a folder whose
    /// name ends in `simobjects`, and `SimObjects\Airplanes\` with no aircraft folder.
    #[test]
    fn a_path_outside_an_aircraft_folder_names_no_aircraft() {
        let flight = r"%APPDATA%\Microsoft Flight Simulator 2024\MISSIONS\Custom\CustomFlight\CustomFlight.FLT";
        assert_eq!(path(flight), None);
        assert_eq!(path(r"MySimObjects\Airplanes\pa24-250\aircraft.cfg"), None);
        assert_eq!(path(r"SimObjects\Airplanes\aircraft.cfg"), None);
    }

    #[test]
    fn each_flow_event_reads_by_its_sdk_number() {
        let sdk = |event: SIMCONNECT_FLOW_EVENT| Flow::from_sdk(event as i32);
        assert_eq!(
            sdk(SIMCONNECT_FLOW_EVENT_BACK_TO_MAIN_MENU),
            Flow::BackToMainMenu
        );
        assert_eq!(sdk(SIMCONNECT_FLOW_EVENT_RTC_END), Flow::RtcEnd);
        assert_eq!(
            sdk(simconnect_types::SIMCONNECT_FLOW_EVENT_PLANE_CRASH),
            Flow::Other(simconnect_types::SIMCONNECT_FLOW_EVENT_PLANE_CRASH as i32)
        );
        assert_eq!(Flow::from_sdk(-1), Flow::Other(-1));
    }
}
