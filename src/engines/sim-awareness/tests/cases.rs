//! The design's cases for the bench that sim awareness answers alone, each fed the signals a
//! run of the sim recorded, restated here with their source
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench").

use sim_awareness::{
    Departure, Ending, Flow, MenuPage, Process, Signal, SimAwareness, SimRun, Stage,
};

/// The path p08's `AircraftLoaded` named each time, which the probe wrote with `%APPDATA%`
/// in place of the folder (read in experiments/areas/architecture/results/
/// p08-flight-2026-10-09-17-12-31.ndjson).
const PA24: &str = r"%APPDATA%\microsoft flight simulator 2024\packages\community\a2a-aircraft-pa24\simobjects\airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.cfg";

/// The PA-24's path as the `AircraftLoaded` state names it (record/learn/foundations/
/// 02-02-aircraft.md, "How an aircraft is identified").
const PA24_STATE: &str = r"SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG";

/// The path sync's p01 heard in `AircraftLoaded` for the Black Square Baron (read in
/// experiments/areas/sync/results/p01-guided-load-2026-10-05-17-29-24.ndjson).
const BARON: &str = r"%APPDATA%\microsoft flight simulator 2024\packages\community\bksq-aircraft-baronpro\simobjects\airplanes\bksq-aircraft-baronpropress\aircraft.cfg";

/// Two runs of the sim, by made-up process IDs and creation times.
const FIRST: SimRun = SimRun {
    process: 4_321,
    created: 134_052_000_000_000_000,
};
const SECOND: SimRun = SimRun {
    process: 8_765,
    created: 134_052_000_100_000_000,
};

fn found(run: SimRun) -> Signal<'static> {
    Signal::Process(Process::Found {
        process: run.process,
        created: run.created,
    })
}

/// A flow event by SimConnect's number for it, as a recording writes it.
fn flow(id: i32) -> Signal<'static> {
    Signal::Flow(Flow::from_sdk(id))
}

/// What a run of signals changed: how many steps returned true, and each stage entered.
#[derive(Debug, PartialEq)]
struct Changes {
    steps: usize,
    entered: Vec<Stage>,
}

fn feed(sim: &mut SimAwareness, signals: Vec<Signal<'_>>) -> Changes {
    let mut changes = Changes {
        steps: 0,
        entered: Vec::new(),
    };
    for signal in signals {
        let stage = sim.stage;
        if sim.step(signal) {
            changes.steps += 1;
        }
        if sim.stage != stage {
            changes.entered.push(sim.stage);
        }
    }
    changes
}

/// A run of the sim from its process found to Ready to fly pressed, in the aircraft at
/// `path`.
fn flying(path: &str) -> SimAwareness {
    let mut sim = SimAwareness::default();
    feed(
        &mut sim,
        vec![
            found(FIRST),
            Signal::FlightLoaded,
            Signal::AircraftLoaded(path),
            Signal::Flow(Flow::RtcStart),
            Signal::Flow(Flow::RtcEnd),
        ],
    );
    assert_eq!(sim.stage, Stage::Flying);
    sim
}

/// What p08's client heard on MSFS 2024 on 2026-10-09, from its subscription as the sim
/// booted to the pilot pressing Ready to fly, with seconds from the probe's start in the
/// comments (read in experiments/areas/architecture/results/
/// p08-flight-2026-10-09-17-12-31.ndjson; record/areas/core/log.md, "2026-10-15: Two of the
/// three `AircraftLoaded` our client heard around a flight load came in the main menu").
#[test]
fn p08s_load_is_one_loading_one_ready_to_fly_and_one_flying() {
    let mut sim = SimAwareness::default();
    let menu = feed(
        &mut sim,
        vec![
            found(FIRST),
            flow(3),                      // 163.4s, TELEPORT_START
            flow(4),                      // TELEPORT_DONE
            Signal::AircraftLoaded(PA24), // 171.8s
            flow(3),                      // 199.6s
            flow(4),
            Signal::AircraftLoaded(PA24), // 204.5s
        ],
    );
    let starting = Changes {
        steps: 2,
        entered: vec![Stage::Starting],
    };
    assert_eq!(
        menu, starting,
        "the main menu's AircraftLoaded changes only the selected aircraft, once"
    );
    assert_eq!(sim.aircraft, None);
    assert_eq!(
        sim.selected.as_ref().map(|a| a.path.as_str()),
        Some("pa24-250/presets/a2a/pa24-250")
    );

    let load = feed(
        &mut sim,
        vec![
            Signal::FlightLoaded, // 220.3s, CustomFlight.FLT
            flow(1),              // 220.4s, FLT_LOAD and FLT_LOADED for apron.flt
            flow(2),
            flow(1), // and for CustomFlight.FLT
            flow(2),
            flow(3), // a teleport
            flow(4),
            Signal::AircraftLoaded(PA24), // 227.1s
            flow(14),                     // 236.6s, FLIGHT_START
            flow(1),                      // FLT_LOAD and FLT_LOADED for apron.flt
            flow(2),
            flow(10), // RTC_START
            flow(11), // 294.3s, RTC_END
        ],
    );
    let entered = vec![Stage::Loading, Stage::ReadyToFly, Stage::Flying];
    assert_eq!(load, Changes { steps: 4, entered });
    let aircraft = sim.aircraft.unwrap();
    assert_eq!(aircraft.path, "pa24-250/presets/a2a/pa24-250");
    assert_eq!(aircraft.folder(), "pa24-250");
}

/// A Restart from the pause menu in sync's p01, on MSFS 2024 on 2026-10-05, from a flight in
/// the Baron, with the system events and flow events our platform's connection subscribes to
/// and seconds from the probe's start (read in experiments/areas/sync/results/
/// p01-guided-load-2026-10-05-17-29-24.ndjson; record/areas/core/log.md, "2026-10-15: The
/// `Sim` state reads 1 in the main menu and through a load's screen, and a Restart sends
/// `FLIGHT_END` inside its load").
#[test]
fn a_restart_is_one_loading_and_no_menu() {
    let mut sim = flying(BARON);
    let restart = feed(
        &mut sim,
        vec![
            Signal::Pause(8),     // 379.3s, the pause menu
            Signal::FlightLoaded, // 384.1s
            flow(15),             // 384.2s, FLIGHT_END
            flow(1),              // FLT_LOAD and FLT_LOADED for CustomFlight.FLT
            flow(2),
            flow(3), // a teleport
            flow(4),
            Signal::Pause(0),              // 389.4s
            Signal::AircraftLoaded(BARON), // 395.5s
            flow(14),                      // 396.5s, FLIGHT_START
            flow(1),                       // FLT_LOAD and FLT_LOADED for apron.flt
            flow(2),
            flow(10), // RTC_START
            flow(11), // 397.6s, RTC_END
        ],
    );
    let entered = vec![Stage::Loading, Stage::ReadyToFly, Stage::Flying];
    assert_eq!(restart, Changes { steps: 5, entered });
    assert_eq!(sim.aircraft.unwrap().path, "bksq-aircraft-baronpropress");
}

/// The A350's one load, which the sim reported twice, 1ms apart
/// (record/learn/foundations/02-02-aircraft.md, "Traps"). The chapter elides the preset
/// folder and the absolute path's middle, so `inibuilds\a350-1000` and the folders between
/// `c:\users\` and `community\` are made up.
#[test]
fn the_a350s_two_paths_for_one_load_name_one_aircraft() {
    let relative = r"SimObjects\Airplanes\A350\presets\iniBuilds\A350-1000\config\aircraft.CFG";
    let absolute = r"c:\users\<user>\appdata\roaming\microsoft flight simulator 2024\packages\community\inibuilds-aircraft-a350\simobjects\airplanes\a350\presets\inibuilds\a350-1000\config\aircraft.cfg";
    let mut sim = SimAwareness::default();
    feed(&mut sim, vec![found(FIRST), Signal::FlightLoaded]);
    assert!(sim.step(Signal::AircraftLoaded(relative)));
    assert!(!sim.step(Signal::AircraftLoaded(absolute)));
    assert_eq!(
        sim.aircraft.unwrap().path,
        "a350/presets/inibuilds/a350-1000"
    );
}

/// `AircraftLoaded` in the main menu, inside the load, and in the flight, the last as
/// Developer Mode's Aircraft Selector would send it (record/areas/core/
/// 03-sim-seam-and-wasm-module.md, "The aircraft").
#[test]
fn aircraft_loaded_around_one_load_moves_no_stage() {
    let mut sim = SimAwareness::default();
    feed(&mut sim, vec![found(FIRST), Signal::Page(MenuPage::Main)]);
    let load = feed(
        &mut sim,
        vec![
            Signal::AircraftLoaded(PA24),
            Signal::FlightLoaded,
            Signal::AircraftLoaded(PA24),
            Signal::Flow(Flow::RtcStart),
            Signal::Flow(Flow::RtcEnd),
            Signal::AircraftLoaded(BARON),
        ],
    );
    let entered = vec![Stage::Loading, Stage::ReadyToFly, Stage::Flying];
    assert_eq!(load, Changes { steps: 6, entered });
    assert_eq!(sim.aircraft.unwrap().path, "pa24-250/presets/a2a/pa24-250");
    assert_eq!(
        sim.selected.unwrap().path,
        "bksq-aircraft-baronpropress",
        "what the sim last loaded, whatever the load"
    );
}

/// A core that finds the sim already running learns where it is from the menu script's
/// master page, `MasterPage` in the main menu and `MasterPage_InGame` in a flight (measured
/// on MSFS 2024, 2026-10-06, record/areas/interface/log.md).
#[test]
fn the_main_menus_master_page_leaves_starting_for_menu() {
    let mut sim = SimAwareness::default();
    let changes = feed(
        &mut sim,
        vec![
            found(FIRST),
            Signal::AircraftState(PA24_STATE),
            Signal::Page(MenuPage::Main),
        ],
    );
    let entered = vec![Stage::Starting, Stage::Menu];
    assert_eq!(changes, Changes { steps: 3, entered });
    assert_eq!(sim.page, MenuPage::Main);
    assert_eq!(
        sim.aircraft, None,
        "the main menu's aircraft isn't the pilot's"
    );
    assert!(sim.selected.is_some(), "the apps name it all the same");
}

#[test]
fn the_world_maps_page_leaves_starting_for_menu() {
    let mut sim = SimAwareness::default();
    feed(
        &mut sim,
        vec![found(FIRST), Signal::Page(MenuPage::WorldMap)],
    );
    assert_eq!(sim.stage, Stage::Menu);
    assert_eq!(sim.page, MenuPage::WorldMap);
}

#[test]
fn a_flights_master_page_leaves_starting_for_flying_in_the_states_aircraft() {
    let mut sim = SimAwareness::default();
    let changes = feed(
        &mut sim,
        vec![
            found(FIRST),
            Signal::AircraftState(PA24_STATE),
            Signal::Page(MenuPage::InGame),
        ],
    );
    let entered = vec![Stage::Starting, Stage::Flying];
    assert_eq!(changes, Changes { steps: 3, entered });
    assert_eq!(sim.aircraft.unwrap().path, "pa24-250/presets/a2a/pa24-250");
}

#[test]
fn a_master_page_outside_starting_moves_no_stage() {
    let mut sim = flying(PA24);
    assert!(sim.step(Signal::Page(MenuPage::Main)), "the page changed");
    assert_eq!(sim.stage, Stage::Flying);

    let mut sim = SimAwareness::default();
    feed(&mut sim, vec![found(FIRST), Signal::Page(MenuPage::Main)]);
    sim.step(Signal::Page(MenuPage::InGame));
    assert_eq!(sim.stage, Stage::Menu);
}

/// The sim sent `BACK_TO_MAIN_MENU`, with `FLIGHT_END`, as the pilot left a flight (measured
/// on MSFS 2024, 2026-10-08, record/areas/interface/log.md).
#[test]
fn leaving_a_flight_reaches_menu() {
    let mut sim = flying(PA24);
    let changes = feed(
        &mut sim,
        vec![
            Signal::Flow(Flow::FlightEnd),
            Signal::Flow(Flow::BackToMainMenu),
        ],
    );
    let entered = vec![Stage::Menu];
    assert_eq!(changes, Changes { steps: 1, entered });
}

/// The pause menu's End flight, then a load of the L-1011, as p05 heard them beside stage 4's
/// core, with seconds from the probe's start (measured on MSFS 2024, 2026-10-21,
/// experiments/areas/core/results/p05-leaving-a-flight-2026-10-21.txt): no
/// `BACK_TO_MAIN_MENU` came.
#[test]
fn ending_a_flight_from_the_pause_menu_reaches_menu() {
    const L1011: &str = r"%APPDATA%\microsoft flight simulator 2024\packages\community\inibuilds-aircraft-l1011\simobjects\airplanes\inibuilds-l1011\presets\inibuilds\l1011-500-stair-pod\config\aircraft.cfg";
    let mut sim = flying(PA24);
    let changes = feed(
        &mut sim,
        vec![
            Signal::Pause(8),              // 60.9
            flow(15),                      // 63.8 FLIGHT_END
            flow(3),                       // 71.8 TELEPORT_START
            flow(4),                       //      TELEPORT_DONE
            flow(1),                       //      FLT_LOAD hangar.flt
            flow(2),                       //      FLT_LOADED hangar.flt
            Signal::AircraftLoaded(L1011), // 79.1, the main menu's aircraft
            Signal::Pause(0),              //      at once
            Signal::FlightLoaded,          // 89.4
            flow(1),
            flow(2),
            Signal::AircraftLoaded(L1011), // 97.0
            flow(14),                      // 109.7 FLIGHT_START
            flow(10),                      // 109.8 RTC_START
            flow(11),                      // 110.9 RTC_END
        ],
    );
    let entered = vec![
        Stage::Menu,
        Stage::Loading,
        Stage::ReadyToFly,
        Stage::Flying,
    ];
    assert_eq!(changes.entered, entered);
    let path = sim.aircraft.map(|a| a.path);
    assert_eq!(
        path.as_deref(),
        Some("inibuilds-l1011/presets/inibuilds/l1011-500-stair-pod")
    );
}

/// No run of ours has recorded a clean close, so the exit code 0 here is made up.
#[test]
fn the_quit_message_then_the_exit_ends_the_run_as_a_close() {
    let mut sim = flying(PA24);
    assert!(sim.step(Signal::Quit));
    assert_eq!(sim.stage, Stage::Closed);
    assert_eq!(sim.ended, Some(Ending::Close));
    assert_eq!(sim.run, Some(FIRST), "the process still runs");

    assert!(
        !sim.step(Signal::Pause(8)),
        "a closing sim's signals change nothing"
    );
    assert!(
        !sim.step(found(SECOND)),
        "the edge still holds the first process"
    );

    assert!(sim.step(Signal::Process(Process::Exited { code: 0 })));
    assert_eq!(sim.stage, Stage::Closed);
    assert_eq!(sim.ended, Some(Ending::Close));
    assert_eq!(sim.run, None);
}

/// Each sim crash in our aircraft harness logged exception `0xc0000005` (record/areas/core/
/// log.md, "2026-10-15: Every sim crash our aircraft harness saw closed SimConnect's
/// connection with no quit message before it").
#[test]
fn an_exit_with_no_quit_message_is_a_crash_with_its_code() {
    let mut sim = flying(PA24);
    assert!(sim.step(Signal::Process(Process::Exited { code: 0xC000_0005 })));
    assert_eq!(sim.stage, Stage::Closed);
    assert_eq!(sim.ended, Some(Ending::Crash { code: 0xC000_0005 }));
    assert_eq!(sim.run, None);
}

#[test]
fn a_new_process_after_a_close_or_a_crash_starts_a_new_run() {
    let close = vec![Signal::Quit, Signal::Process(Process::Exited { code: 0 })];
    let crash = vec![Signal::Process(Process::Exited { code: 0xC000_0005 })];
    for ending in [close, crash] {
        let mut sim = flying(PA24);
        let departure = Departure {
            airport: "EGBB".into(),
            stand_name: "GATE".into(),
            stand_number: 58,
        };
        feed(
            &mut sim,
            vec![
                Signal::AircraftState(PA24_STATE),
                Signal::Page(MenuPage::InGame),
                Signal::Departure(departure),
                Signal::Pause(8),
            ],
        );
        feed(&mut sim, ending);
        let ended = sim.ended;

        assert!(sim.step(found(SECOND)));
        assert_eq!(sim.stage, Stage::Starting);
        assert_eq!(sim.run, Some(SECOND));
        assert_eq!(sim.ended, ended, "how the last run ended stays");
        assert_eq!(sim.page, MenuPage::Unknown);
        assert_eq!(sim.aircraft, None);
        assert_eq!(sim.departure, None);
        assert_eq!(sim.pause, 0);

        sim.step(Signal::Page(MenuPage::InGame));
        assert_eq!(sim.stage, Stage::Flying);
        assert_eq!(sim.aircraft, None, "the last run's state answer is gone");
    }
}
