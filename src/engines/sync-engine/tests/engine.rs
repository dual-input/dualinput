//! The sync engine's own tests, with no core and no sim: each machine is an engine, a frame is a
//! `frame` call, and the test plays the aircraft's readings and the stream's deliveries by hand,
//! from the sync units' cases for the bench (record/areas/sync/05-units.md, "Cases for the
//! bench").

// The timing test reads the clock, which the root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use profile_engine::{
    Arg, Count, EventEntry, Name, Owner, Resolved, StateEntry, Steps, Watch as Watches, Write,
};
use sync_engine::{
    Action, Applied, Arrived, CatchUpState, Change, Control, Ctx, Engine, Load, Origin, Out, Ready,
    Sandbox, Seen, Stamp, Value, VectorClock, Why,
};

const SECOND: u64 = 1_000_000;
/// When each machine's profile loads, 100s after a Ready to fly at 0, so the aircraft has
/// settled unless a test says otherwise.
const START: u64 = 100 * SECOND;
/// A frame at about 60 fps.
const FRAME: u64 = 16_667;

const PF: Origin = Origin {
    pilot: [1; 16],
    restart: 0,
};
const PM: Origin = Origin {
    pilot: [2; 16],
    restart: 0,
};

fn l(name: &str) -> Name {
    Name::L {
        name: name.into(),
        unit: None,
    }
}

fn k(name: &str) -> Name {
    Name::K {
        name: name.into(),
        values: Vec::new(),
    }
}

fn state(key: &str, watch: Name, write: Write) -> StateEntry {
    StateEntry {
        key: key.into(),
        name: key.replace('_', " "),
        description: None,
        watch: Watches::Name(watch),
        write,
        owner: Owner::Shared,
        only: Vec::new(),
        ignore: Vec::new(),
        features: Default::default(),
    }
}

fn event(key: &str, watch: Name, write: Write) -> EventEntry {
    EventEntry {
        key: key.into(),
        name: key.replace('_', " "),
        watch,
        write,
        only: Vec::new(),
        ignore: Vec::new(),
        features: Default::default(),
    }
}

fn profile(state: Vec<StateEntry>, events: Vec<EventEntry>) -> Resolved {
    Resolved {
        variant: "base".into(),
        pace: None,
        state,
        events,
        features: Default::default(),
    }
}

/// One machine: its engine, who it is, what it puts out, and the stream's numbering of its own
/// changes.
struct Machine {
    engine: Engine,
    me: Origin,
    pf: Origin,
    at: u64,
    preflight_ended: bool,
    catching_up: bool,
    out: Vec<Out>,
    clock: VectorClock,
}

impl Machine {
    fn new(me: Origin, profile: &Resolved) -> Machine {
        Machine::loaded(me, profile, Ready::At(0))
    }

    fn loaded(me: Origin, profile: &Resolved, ready: Ready) -> Machine {
        let load = Load {
            at: START,
            ready,
            settle: sync_engine::SETTLE,
        };
        let (engine, out) = Engine::load(profile, Sandbox::new(), load);
        let mut m = Machine {
            engine,
            me,
            pf: PF,
            at: START,
            preflight_ended: true,
            catching_up: false,
            out,
            clock: VectorClock::default(),
        };
        m.out.clear();
        m
    }

    fn cx(&self) -> Ctx {
        Ctx {
            at: self.at,
            me: self.me,
            control: Control {
                generation: 1,
                pf: self.pf.pilot,
            },
            catching_up: self.catching_up,
            preflight_ended: self.preflight_ended,
        }
    }

    /// The watch for `entry`'s name `name`.
    fn watch(&self, name: &Name) -> usize {
        self.engine
            .watches()
            .iter()
            .position(|w| &w.name == name)
            .unwrap_or_else(|| panic!("no watch for {name}"))
    }

    fn read(&mut self, name: &Name, value: f64) {
        let watch = self.watch(name);
        let out = self.engine.seen(
            Seen::Value {
                watch,
                value: Value::Number(value),
            },
            self.cx(),
        );
        self.out.extend(out);
    }

    fn fired(&mut self, name: &Name, value: Option<f64>) {
        let watch = self.watch(name);
        let out = self.engine.seen(Seen::Fired { watch, value }, self.cx());
        self.out.extend(out);
    }

    fn frame(&mut self) {
        self.at += FRAME;
        let out = self.engine.frame(self.cx());
        self.out.extend(out);
    }

    /// Frames until `us` has passed.
    fn wait(&mut self, us: u64) {
        let until = self.at + us;
        while self.at < until {
            self.frame();
        }
    }

    fn arrive(&mut self, entry: &str, value: f64, stamp: Stamp) -> Applied {
        let (applied, out) = self.engine.arrived(
            entry,
            Arrived::Change {
                value: Value::Number(value),
                stamp,
            },
            self.cx(),
        );
        self.out.extend(out);
        applied
    }

    fn arrive_fired(&mut self, entry: &str, value: Option<f64>) -> Applied {
        let (applied, out) = self.engine.arrived(
            entry,
            Arrived::Fired {
                value: value.map(Value::Number),
            },
            self.cx(),
        );
        self.out.extend(out);
        applied
    }

    /// The stream sends each change this machine handed it, numbering it, and returns each with
    /// its stamp, as `CockpitSent` hands state sync the stamp.
    fn send_all(&mut self) -> Vec<(Change, Stamp)> {
        let mut sent = Vec::new();
        for o in std::mem::take(&mut self.out) {
            match o {
                Out::Send(change) => {
                    let number = self.clock.bump(self.me);
                    let stamp = Stamp {
                        origin: self.me,
                        number,
                        clock: self.clock.clone(),
                        pilot_flying: self.pf.pilot,
                    };
                    self.engine.sent(&change.entry, stamp.clone());
                    sent.push((change, stamp));
                }
                other => self.out.push(other),
            }
        }
        sent
    }

    /// Takes the outs so far.
    fn take(&mut self) -> Vec<Out> {
        std::mem::take(&mut self.out)
    }

    /// The actions put out so far, which are taken.
    fn acts(&mut self) -> Vec<Action> {
        let mut acts = Vec::new();
        for o in self.take() {
            match o {
                Out::Act(a) => acts.push(a),
                other => self.out.push(other),
            }
        }
        acts
    }

    fn sends(&self) -> Vec<&Change> {
        self.out
            .iter()
            .filter_map(|o| match o {
                Out::Send(c) => Some(c),
                _ => None,
            })
            .collect()
    }

    fn flags(&self) -> usize {
        self.out
            .iter()
            .filter(|o| matches!(o, Out::Flag(_)))
            .count()
    }
}

/// A stamp of another machine's, made after it saw `seen`'s changes.
fn stamp(origin: Origin, number: u64, seen: &[(Origin, u64)]) -> Stamp {
    let mut clock = VectorClock::default();
    clock.set(origin, number);
    for (o, n) in seen {
        clock.set(*o, *n);
    }
    Stamp {
        origin,
        number,
        clock,
        pilot_flying: PF.pilot,
    }
}

fn set(name: &Name, value: f64) -> Action {
    Action::Set {
        name: name.clone(),
        value: Value::Number(value),
    }
}

#[test]
fn a_knob_turned_a_detent_a_frame_sends_nothing_back_while_its_reading_lags() {
    let hdg = l("HDG");
    let p = profile(
        vec![state("heading", hdg.clone(), Write::Name(hdg.clone()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 99.0);
    for (n, value) in [100.0, 101.0, 102.0].into_iter().enumerate() {
        assert_eq!(
            pm.arrive("heading", value, stamp(PF, n as u64 + 1, &[])),
            Applied::Done
        );
        pm.frame();
        // The reading a frame behind the write.
        if value > 100.0 {
            pm.read(&hdg, value - 1.0);
        }
    }
    pm.read(&hdg, 102.0);
    pm.wait(2 * SECOND);
    assert_eq!(
        pm.acts(),
        vec![set(&hdg, 100.0), set(&hdg, 101.0), set(&hdg, 102.0)]
    );
    assert!(
        pm.sends().is_empty(),
        "a lagging reading is the echo of a write: {:?}",
        pm.out
    );
    assert_eq!(pm.flags(), 0);

    // A pilot turning it back through 101 a second later is heard.
    pm.read(&hdg, 101.0);
    assert_eq!(pm.sends().len(), 1);
}

#[test]
fn a_stepping_write_counts_its_own_steps_and_aims_again_from_its_count() {
    let hdg = Name::A {
        name: "AUTOPILOT HEADING LOCK DIR".into(),
        unit: "Degrees".into(),
    };
    let write = Write::Steps(Steps {
        inc: k("HEADING_BUG_INC"),
        dec: k("HEADING_BUG_DEC"),
        step: 1.0,
        wrap: Some(true),
        range: Some((0.0, 359.0)),
        pace: None,
    });
    let p = profile(vec![state("heading", hdg.clone(), write)], vec![]);
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 358.0);
    // 358 to 2 is four steps up through 0, the shorter way round.
    assert_eq!(
        pm.arrive("heading", 2.0, stamp(PF, 1, &[])),
        Applied::Stepping
    );
    pm.frame();
    pm.read(&hdg, 359.0);
    // A new value while it steps aims again from its count, 0, not from the lagging reading.
    assert_eq!(
        pm.arrive("heading", 3.0, stamp(PF, 2, &[])),
        Applied::Stepping
    );
    for _ in 0..6 {
        pm.frame();
    }
    for value in [0.0, 1.0, 2.0, 3.0] {
        pm.read(&hdg, value);
    }
    let outs = pm.take();
    let steps = outs
        .iter()
        .filter(
            |o| matches!(o, Out::Act(Action::Key { name, .. }) if *name == k("HEADING_BUG_INC")),
        )
        .count();
    assert_eq!(
        steps, 5,
        "358 to 3 is five steps, and none past it: {outs:?}"
    );
    assert!(outs.iter().any(|o| *o == Out::Stepped("heading".into())));
    assert!(!outs.iter().any(|o| matches!(o, Out::Send(_))), "{outs:?}");
}

#[test]
fn a_toggle_over_a_lamp_that_lights_late_flips_once_and_is_flagged() {
    let beacon = l("BEACON_LAMP");
    let toggle = k("TOGGLE_BEACON_LIGHTS");
    let p = profile(
        vec![state(
            "beacon",
            beacon.clone(),
            Write::Toggle(toggle.clone()),
        )],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&beacon, 0.0);
    pm.arrive("beacon", 1.0, stamp(PF, 1, &[]));
    pm.wait(2 * SECOND);
    pm.read(&beacon, 1.0);
    pm.wait(SECOND);
    let flips = pm
        .out
        .iter()
        .filter(|o| matches!(o, Out::Act(Action::Key { name, .. }) if *name == toggle))
        .count();
    assert_eq!(flips, 1, "a write gets one attempt: {:?}", pm.out);
    assert_eq!(pm.flags(), 1);
}

#[test]
fn a_write_function_that_writes_nothing_is_flagged_live_and_in_catch_up() {
    let battery = l("BATTERY");
    let xpdr = l("XPDR");
    let function = r#"(value) => {
      if (state.battery === 0) return
      write(K('SET_XPDR_MODE'), value)
    }"#;
    let p = profile(
        vec![
            state("battery", battery.clone(), Write::Name(battery.clone())),
            state("xpdr", xpdr.clone(), Write::Function(function.into())),
        ],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&battery, 0.0);
    pm.read(&xpdr, 0.0);
    pm.arrive("xpdr", 2.0, stamp(PF, 1, &[]));
    assert!(
        pm.acts().is_empty(),
        "with the battery off the function writes nothing"
    );
    pm.wait(2 * SECOND);
    assert_eq!(
        pm.flags(),
        1,
        "a run that writes nothing is judged by the cockpit"
    );

    // In catch-up's burst, right behind the battery, whose reading hasn't come yet.
    let mut late = Machine::new(PM, &p);
    late.read(&battery, 0.0);
    late.read(&xpdr, 0.0);
    late.catching_up = true;
    let out = late.engine.take(
        &CatchUpState {
            entries: vec![entry("battery", 1.0), entry("xpdr", 2.0)],
        },
        late.cx(),
    );
    late.out.extend(out);
    assert_eq!(late.acts(), vec![set(&battery, 1.0)]);
    late.read(&battery, 1.0);
    late.wait(2 * SECOND);
    assert_eq!(
        late.flags(),
        1,
        "the transponder's write made nothing behind the battery"
    );
}

fn entry(key: &str, value: f64) -> sync_engine::CatchUpEntry {
    sync_engine::CatchUpEntry {
        key: key.into(),
        value: Value::Number(value),
        stamp: None,
    }
}

#[test]
fn a_value_read_back_within_f32_isnt_flagged() {
    let alt = l("ALT");
    let p = profile(
        vec![state("alt", alt.clone(), Write::Name(alt.clone()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&alt, 0.0);
    pm.arrive("alt", 165.0, stamp(PF, 1, &[]));
    pm.frame();
    pm.read(&alt, 165.000002);
    pm.wait(2 * SECOND);
    assert_eq!(pm.flags(), 0);
    assert!(pm.sends().is_empty());
}

#[test]
fn a_reading_that_matches_what_a_write_function_returned_is_its_echo() {
    let bug = l("BUG");
    // The 58P's heading-bug preset rounds to 1/16,384ths of a turn, so 1° reads back as 46 of
    // them.
    let rounded = 46.0 * 360.0 / 16384.0;
    let heading = |function: &str| {
        profile(
            vec![state(
                "heading_bug",
                bug.clone(),
                Write::Function(function.into()),
            )],
            vec![],
        )
    };
    let returns = heading(
        r#"(value) => {
      write(B('INSTRUMENT_Heading_Bug_Set'), value)
      return Math.round(value * 16384 / 360) * 360 / 16384
    }"#,
    );
    let mut pm = Machine::new(PM, &returns);
    pm.read(&bug, 0.0);
    pm.arrive("heading_bug", 1.0, stamp(PF, 1, &[]));
    pm.frame();
    pm.read(&bug, rounded);
    pm.wait(2 * SECOND);
    assert!(pm.sends().is_empty(), "{:?}", pm.out);
    assert_eq!(pm.flags(), 0);

    // A catch-up's 1° finds the bug already on 46 steps, so the sim reports no change, and the
    // write waits for none.
    pm.catching_up = true;
    let out = pm.engine.take(
        &CatchUpState {
            entries: vec![entry("heading_bug", 1.0)],
        },
        pm.cx(),
    );
    pm.out.extend(out);
    pm.wait(2 * SECOND);
    assert_eq!(pm.flags(), 0, "{:?}", pm.out);
    assert!(pm.sends().is_empty());

    // Without a value returned, the rounded reading is this pilot's own turn. A function written
    // `(value) => write(...)` returns write()'s chain, which still writes and counts as no value.
    let silent = heading("(value) => write(B('INSTRUMENT_Heading_Bug_Set'), value)");
    let mut pm = Machine::new(PM, &silent);
    pm.read(&bug, 0.0);
    pm.arrive("heading_bug", 1.0, stamp(PF, 1, &[]));
    pm.frame();
    let preset = Name::B {
        name: "INSTRUMENT_Heading_Bug_Set".into(),
    };
    assert_eq!(pm.acts(), vec![set(&preset, 1.0)]);
    pm.read(&bug, rounded);
    assert_eq!(pm.sends().len(), 1);
}

#[test]
fn two_pilots_changing_one_entry_at_once_end_on_one_value() {
    let bat = l("BAT");
    let p = profile(
        vec![state("battery", bat.clone(), Write::Name(bat.clone()))],
        vec![],
    );
    let mut pf = Machine::new(PF, &p);
    let mut pm = Machine::new(PM, &p);
    for m in [&mut pf, &mut pm] {
        m.read(&bat, 0.5);
    }
    // Within 50ms, neither seeing the other's: the flying machine's wins on both.
    pf.read(&bat, 0.0);
    pm.read(&bat, 1.0);
    let (_, a) = pf.send_all().remove(0);
    let (_, b) = pm.send_all().remove(0);
    assert_eq!(pf.arrive("battery", 1.0, b), Applied::Skipped);
    assert_eq!(pm.arrive("battery", 0.0, a), Applied::Done);
    assert_eq!(pm.acts(), vec![set(&bat, 0.0)]);

    // Again while the pilot monitoring's change is still held: the arrival from the flying
    // machine wins, and the held change is withdrawn.
    pm.read(&bat, 0.0);
    pm.read(&bat, 1.0);
    assert_eq!(pm.sends().len(), 1);
    pm.take();
    pf.read(&bat, 0.25);
    let (_, a) = pf.send_all().remove(0);
    assert_eq!(pm.arrive("battery", 0.25, a), Applied::Done);
    let out = pm.take();
    assert!(out.contains(&Out::Withdraw("battery".into())), "{out:?}");

    // And while the flying machine's change is held: it wins, and goes out after.
    pf.read(&bat, 0.75);
    assert_eq!(pf.sends().len(), 1);
    pm.read(&bat, 0.0);
    let (_, b) = pm.send_all().remove(0);
    assert_eq!(pf.arrive("battery", 0.0, b), Applied::Skipped);
}

#[test]
fn catch_up_writes_in_the_order_the_flying_machine_first_took_each_value() {
    let battery = l("BATTERY");
    let apu = l("APU_MASTER");
    let p = profile(
        vec![
            state("apu", apu.clone(), Write::Name(apu.clone())),
            state("battery", battery.clone(), Write::Name(battery.clone())),
        ],
        vec![],
    );
    let mut pf = Machine::new(PF, &p);
    pf.read(&apu, 0.0);
    pf.read(&battery, 0.0);
    pf.wait(SECOND);
    pf.read(&battery, 1.0);
    pf.wait(SECOND);
    pf.read(&apu, 1.0);
    pf.wait(SECOND);
    pf.read(&battery, 0.0);
    pf.wait(SECOND);
    pf.read(&battery, 1.0);
    let given = pf.engine.give();
    let order: Vec<&str> = given.entries.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(
        order,
        vec!["battery", "apu"],
        "the battery first took on before the APU"
    );

    let mut pm = Machine::loaded(PM, &p, Ready::At(0));
    pm.read(&apu, 0.0);
    pm.read(&battery, 0.0);
    pm.catching_up = true;
    let out = pm.engine.take(&given, pm.cx());
    pm.out.extend(out);
    assert_eq!(pm.acts(), vec![set(&battery, 1.0), set(&apu, 1.0)]);
    let out = pm.take();
    assert!(
        out.contains(&Out::CatchUpMade) && out.contains(&Out::CatchUpDone),
        "{out:?}"
    );
}

#[test]
fn ready_to_fly_after_the_load_settles_30s_after_it_and_nothing_goes_out_before_preflight_ends() {
    let switch = l("SWITCH");
    let p = profile(
        vec![state("switch", switch.clone(), Write::Name(switch.clone()))],
        vec![],
    );
    let mut pm = Machine::loaded(PM, &p, Ready::Yet);
    pm.preflight_ended = false;
    pm.read(&switch, 0.0);
    pm.wait(20 * SECOND);
    assert!(!pm.engine.settled());
    let rtc = pm.at;
    pm.engine.ready_to_fly(rtc);
    pm.wait(5 * SECOND);
    // The aircraft restoring its switches.
    pm.read(&switch, 1.0);
    pm.wait(24 * SECOND);
    assert!(!pm.engine.settled(), "settled only 30s after Ready to fly");
    pm.wait(2 * SECOND);
    assert!(pm.engine.settled());
    assert!(
        pm.sends().is_empty(),
        "nothing is sent before preflight ends"
    );
}

#[test]
fn a_restarted_core_is_settled_at_once_and_its_shadows_take_the_flying_machines() {
    let speed = Watches::Count(Box::new(Count {
        default: 80.0,
        inc: Some(k("SPD_INC")),
        dec: Some(k("SPD_DEC")),
        step: 1.0,
        set: None,
        count: None,
        wrap: false,
        range: (0.0, 399.0),
    }));
    let write = Write::Steps(Steps {
        inc: k("SPD_INC"),
        dec: k("SPD_DEC"),
        step: 1.0,
        wrap: None,
        range: None,
        pace: None,
    });
    let mut entry = state("speed", l("unused"), write);
    entry.watch = speed;
    let p = profile(vec![entry], vec![]);
    let mut pm = Machine::loaded(PM, &p, Ready::Missed);
    assert!(pm.engine.settled());
    pm.catching_up = true;
    let out = pm.engine.take(
        &CatchUpState {
            entries: vec![sync_engine::CatchUpEntry {
                key: "speed".into(),
                value: Value::Number(250.0),
                stamp: None,
            }],
        },
        pm.cx(),
    );
    assert!(
        !out.iter().any(|o| matches!(o, Out::Act(_))),
        "no steps: {out:?}"
    );
    assert!(
        pm.engine
            .give()
            .entries
            .iter()
            .any(|e| e.value == Value::Number(250.0))
    );

    // A machine that saw its own Ready to fly steps its shadow there instead, and counts the
    // steps as they land, sending none of them back.
    let mut late = Machine::new(PM, &p);
    late.catching_up = true;
    let out = late.engine.take(
        &CatchUpState {
            entries: vec![sync_engine::CatchUpEntry {
                key: "speed".into(),
                value: Value::Number(83.0),
                stamp: None,
            }],
        },
        late.cx(),
    );
    late.out.extend(out);
    late.wait(SECOND / 10);
    let steps = late.acts().len();
    assert_eq!(steps, 3);
    for _ in 0..3 {
        late.fired(&k("SPD_INC"), None);
    }
    assert!(late.sends().is_empty());
    assert_eq!(late.engine.give().entries[0].value, Value::Number(83.0));
}

#[test]
fn an_entry_the_aircraft_changes_every_3s_on_both_machines_stops_syncing_within_30s() {
    let ticker = l("TICKER");
    let p = profile(
        vec![state("ticker", ticker.clone(), Write::Name(ticker.clone()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&ticker, 0.0);
    let mut n = 0;
    let mut stopped = None;
    for tick in 1..=12 {
        pm.wait(3 * SECOND);
        pm.read(&ticker, f64::from(tick));
        n += 1;
        pm.arrive("ticker", f64::from(tick) + 0.5, stamp(PF, n, &[]));
        if pm.out.iter().any(|o| {
            matches!(
                o,
                Out::Stop {
                    why: Why::Driven,
                    ..
                }
            )
        }) {
            stopped = Some(tick * 3);
            break;
        }
    }
    let at = stopped.expect("the entry should stop syncing");
    assert!(at <= 33, "it stopped {at}s in");
    pm.take();
    pm.read(&ticker, 100.0);
    assert!(pm.sends().is_empty(), "a stopped entry sends nothing");
    assert_eq!(
        pm.arrive("ticker", 3.0, stamp(PF, n + 1, &[])),
        Applied::Skipped
    );
}

#[test]
fn a_pilot_flying_entry_moved_on_a_following_machine_is_put_back_and_never_flagged() {
    let throttle = l("THROTTLE_1");
    let mut entry = state(
        "throttle_1",
        throttle.clone(),
        Write::Name(throttle.clone()),
    );
    entry.owner = Owner::PilotFlying;
    let p = profile(vec![entry], vec![]);
    let mut pm = Machine::new(PM, &p);
    pm.read(&throttle, 0.0);
    pm.arrive("throttle_1", 0.8, stamp(PF, 1, &[]));
    pm.frame();
    pm.read(&throttle, 0.8);
    pm.take();
    // The pilot monitoring's hardware moves it for 3s.
    let mut puts = 0;
    for f in 0..180 {
        pm.read(&throttle, 0.5 - f64::from(f) * 0.001);
        puts += pm
            .acts()
            .iter()
            .filter(|a| **a == set(&throttle, 0.8))
            .count();
        pm.frame();
    }
    assert_eq!(puts, 180, "put back at once, each time");
    pm.wait(3 * SECOND);
    assert!(pm.sends().is_empty());
    assert_eq!(pm.flags(), 0);
}

#[test]
fn each_write_that_never_lands_is_flagged_not_only_the_first() {
    let bug = l("HEADING_BUG");
    let p = profile(
        vec![state("heading_bug", bug.clone(), Write::Name(bug.clone()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&bug, 0.0);
    pm.arrive("heading_bug", 90.0, stamp(PF, 1, &[]));
    pm.wait(2 * SECOND);
    pm.arrive("heading_bug", 180.0, stamp(PF, 2, &[]));
    pm.wait(2 * SECOND);
    assert_eq!(pm.flags(), 2, "each miss gets its log line: {:?}", pm.out);
}

#[test]
fn a_pilot_flying_entry_its_own_systems_move_on_a_following_machine_is_never_flagged() {
    let trim = l("ELEVATOR_TRIM");
    let mut trims = state("elevator_trim", trim.clone(), Write::Name(trim.clone()));
    trims.owner = Owner::PilotFlying;
    let p = profile(vec![trims], vec![]);
    let mut pm = Machine::new(PM, &p);
    pm.read(&trim, 0.0);
    pm.arrive("elevator_trim", -5.0, stamp(PF, 1, &[]));
    pm.arrive("elevator_trim", -6.0, stamp(PF, 2, &[]));
    assert_eq!(pm.acts(), vec![set(&trim, -5.0), set(&trim, -6.0)]);
    // Its writes still go pending, so a reading that lags behind them is their echo.
    pm.read(&trim, -5.0);
    pm.read(&trim, -6.0);
    assert!(pm.acts().is_empty(), "a lagging echo starts no put-back");
    // Its autopilot trims the frozen aircraft faster than putting it back brings it home.
    for f in 0..120 {
        pm.read(&trim, -6.0 - f64::from(f) * 0.1);
        pm.frame();
    }
    pm.wait(2 * SECOND);
    assert_eq!(pm.flags(), 0, "{:?}", pm.out);

    // Nor in a catch-up.
    let mut late = Machine::new(PM, &p);
    late.read(&trim, 0.0);
    late.catching_up = true;
    let out = late.engine.take(
        &CatchUpState {
            entries: vec![entry("elevator_trim", -5.0)],
        },
        late.cx(),
    );
    late.out.extend(out);
    late.read(&trim, -7.0);
    late.wait(2 * SECOND);
    assert_eq!(late.flags(), 0, "{:?}", late.out);
}

#[test]
fn a_machine_that_takes_control_writes_what_the_pf_owns_at_the_old_pfs_last_values() {
    let trim = l("ELEVATOR_TRIM");
    let beacon = l("BEACON");
    let mut entry = state("elevator_trim", trim.clone(), Write::Name(trim.clone()));
    entry.owner = Owner::PilotFlying;
    let p = profile(
        vec![
            entry,
            state("beacon", beacon.clone(), Write::Name(beacon.clone())),
        ],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&trim, 0.0);
    pm.read(&beacon, 0.0);
    pm.arrive("elevator_trim", -5.0, stamp(PF, 1, &[]));
    pm.read(&trim, -5.0);
    // Its own autopilot runs the trim away while it follows.
    pm.read(&trim, -30.0);
    pm.take();

    let out = pm.engine.control_passed(pm.cx());
    assert!(
        out.is_empty(),
        "a machine that goes on following writes nothing: {out:?}"
    );
    pm.pf = PM;
    let out = pm.engine.control_passed(pm.cx());
    assert_eq!(
        out,
        vec![Out::Act(set(&trim, -5.0))],
        "only what the PF owns, and only where it differs"
    );
}

#[test]
fn an_event_entry_doesnt_send_back_what_its_write_fires_and_stops_when_it_comes_too_late() {
    let h = Name::H {
        name: "SOME_KEY_PRESSED".into(),
    };
    let b = Name::B {
        name: "SOME_KEY_PRESS_1".into(),
    };
    let p = profile(
        vec![],
        vec![event("key", h.clone(), Write::Name(b.clone()))],
    );
    let mut pm = Machine::new(PM, &p);
    pm.arrive_fired("key", None);
    assert_eq!(pm.acts(), vec![Action::Fire { name: b.clone() }]);
    pm.frame();
    pm.fired(&h, None);
    assert!(
        pm.sends().is_empty(),
        "the token takes the aircraft's own report"
    );

    // When the aircraft fires it 2s after each write, past the token's 1s, it goes out, and the
    // driven-entry test stops the entry within 30s.
    let mut stopped = false;
    for _ in 0..20 {
        pm.arrive_fired("key", None);
        pm.wait(2 * SECOND);
        pm.fired(&h, None);
        if pm.out.iter().any(|o| {
            matches!(
                o,
                Out::Stop {
                    why: Why::Driven,
                    ..
                }
            )
        }) {
            stopped = true;
            break;
        }
    }
    assert!(stopped, "{:?}", pm.out);
}

#[test]
fn what_an_event_entrys_function_returns_goes_unused() {
    let h = Name::H {
        name: "SOME_KEY_PRESSED".into(),
    };
    // The builder types an event's function to return anything, as `false` here.
    let function = "(value) => { write(H('SOME_KEY_PRESSED')); return false }";
    let p = profile(
        vec![],
        vec![event("key", h.clone(), Write::Function(function.into()))],
    );
    let mut pm = Machine::new(PM, &p);
    pm.arrive_fired("key", None);
    assert_eq!(pm.acts(), vec![Action::Fire { name: h }]);
}

#[test]
fn a_write_function_stuck_in_a_loop_stops_its_entry() {
    let x = l("X");
    let function = "(value) => { while (true) { write(K('X'), value) } }";
    let p = profile(
        vec![state("x", x.clone(), Write::Function(function.into()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&x, 0.0);
    assert_eq!(pm.arrive("x", 1.0, stamp(PF, 1, &[])), Applied::Skipped);
    let out = pm.take();
    assert!(
        out.iter().any(|o| matches!(
            o,
            Out::Stop {
                why: Why::Limit(_),
                ..
            }
        )),
        "{out:?}"
    );
    assert!(!out.iter().any(|o| matches!(o, Out::Act(_))));
    assert_eq!(pm.arrive("x", 2.0, stamp(PF, 2, &[])), Applied::Skipped);
}

#[test]
fn an_input_event_reported_twice_a_frame_apart_goes_out_once() {
    let b = Name::B {
        name: "ELECTRICAL_Battery_1".into(),
    };
    let p = profile(
        vec![],
        vec![event("battery_press", b.clone(), Write::Name(b.clone()))],
    );
    let mut pm = Machine::new(PM, &p);
    pm.fired(&b, Some(1.0));
    pm.frame();
    pm.fired(&b, Some(1.0));
    assert_eq!(pm.sends().len(), 1);
    // The same report 261ms later is a real repeat.
    pm.wait(261_000);
    pm.fired(&b, Some(1.0));
    assert_eq!(pm.sends().len(), 2);

    // At 4 fps, a frame passes 200ms, so a report a frame later goes out too.
    let mut slow = Machine::new(PM, &p);
    slow.fired(&b, Some(1.0));
    slow.at += 250_000;
    let out = slow.engine.frame(slow.cx());
    slow.out.extend(out);
    slow.fired(&b, Some(1.0));
    assert_eq!(slow.sends().len(), 2);
}

#[test]
fn a_token_nothing_uses_expires_after_1s() {
    let ap = k("AP_MASTER");
    let p = profile(
        vec![],
        vec![event("ap_master", ap.clone(), Write::Name(ap.clone()))],
    );
    let mut pm = Machine::new(PM, &p);
    pm.arrive_fired("ap_master", None);
    pm.wait(1_100_000);
    pm.fired(&ap, None);
    assert_eq!(
        pm.sends().len(),
        1,
        "the pilot's press after the token expired goes out"
    );
}

#[test]
fn a_chain_spaces_its_actions_at_its_pace_and_one_that_doesnt_read_fails_its_write() {
    let hdg = l("HDG");
    let function = r#"(value) => {
      write(L('HDG_SET'), value)
      write(K('HDG_INC')).repeat(3).every('2 frames')
      write(H('DONE'))
    }"#;
    let p = profile(
        vec![state(
            "heading",
            hdg.clone(),
            Write::Function(function.into()),
        )],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 0.0);
    assert_eq!(
        pm.arrive("heading", 10.0, stamp(PF, 1, &[])),
        Applied::Stepping
    );
    let mut per_frame = vec![pm.acts().len()];
    for _ in 0..5 {
        pm.frame();
        per_frame.push(pm.acts().len());
    }
    assert_eq!(
        per_frame,
        vec![2, 0, 1, 0, 2, 0],
        "two at once, then the chain's two more 2 frames apart, then the last"
    );
    assert!(pm.out.contains(&Out::Stepped("heading".into())));

    let bad = "(value) => { write(K('HDG_INC')).every('1.5 frames') }";
    let p = profile(
        vec![state("heading", hdg.clone(), Write::Function(bad.into()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 0.0);
    pm.arrive("heading", 10.0, stamp(PF, 1, &[]));
    assert!(
        pm.acts().is_empty(),
        "a pace that doesn't read fails the write"
    );
    pm.wait(2 * SECOND);
    assert_eq!(pm.flags(), 1);
}

#[test]
fn a_k_events_value_goes_where_value_marks_it() {
    let baro = l("BARO");
    let write = Write::Name(Name::K {
        name: "KOHLSMAN_SET".into(),
        values: vec![Arg::Number(2.0), Arg::Value],
    });
    let p = profile(vec![state("baro", baro.clone(), write)], vec![]);
    let mut pm = Machine::new(PM, &p);
    pm.read(&baro, 0.0);
    pm.arrive("baro", 16272.0, stamp(PF, 1, &[]));
    assert_eq!(
        pm.acts(),
        vec![Action::Key {
            name: Name::K {
                name: "KOHLSMAN_SET".into(),
                values: vec![Arg::Number(2.0), Arg::Value],
            },
            values: vec![2.0, 16272.0],
        }]
    );
}

#[test]
fn a_write_waits_for_the_entrys_first_reading() {
    let toggle = k("TOGGLE_X");
    let x = l("X");
    let p = profile(
        vec![state("x", x.clone(), Write::Toggle(toggle.clone()))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.arrive("x", 1.0, stamp(PF, 1, &[]));
    assert!(pm.acts().is_empty(), "a toggle never flips blind");
    pm.read(&x, 1.0);
    assert!(
        pm.acts().is_empty(),
        "the first reading matches, so nothing flips"
    );
    pm.arrive("x", 0.0, stamp(PF, 2, &[]));
    assert_eq!(pm.acts().len(), 1);
}

#[test]
fn a_catch_up_write_whose_entry_never_reads_is_made_and_flagged_a_check_later() {
    // An `instrument()` entry that no panel reads gets no first reading and no refusal.
    let x = l("X");
    let p = profile(
        vec![state("x", x.clone(), Write::Toggle(k("TOGGLE_X")))],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.catching_up = true;
    let out = pm.engine.take(
        &CatchUpState {
            entries: vec![entry("x", 1.0)],
        },
        pm.cx(),
    );
    pm.out.extend(out);
    pm.wait(SECOND);
    let out = pm.take();
    assert!(
        !out.contains(&Out::CatchUpMade),
        "the write waits for the entry's first reading: {out:?}"
    );
    pm.wait(SECOND);
    assert_eq!(pm.flags(), 1, "the write never landed");
    let out = pm.take();
    assert!(out.contains(&Out::CatchUpMade), "{out:?}");
    assert!(out.contains(&Out::CatchUpDone), "{out:?}");
    assert!(
        !out.iter().any(|o| matches!(o, Out::Act(_))),
        "a toggle never flips blind: {out:?}"
    );
}

#[test]
fn a_catch_up_answer_for_500_entries_takes_under_64_kb() {
    let entries: Vec<StateEntry> = (0..500)
        .map(|i| {
            let name = l(&format!("BKSQ_SomeSwitchPosition_{i}"));
            state(
                &format!("some_switch_position_{i}"),
                name.clone(),
                Write::Name(name),
            )
        })
        .collect();
    let p = profile(entries, vec![]);
    let mut pf = Machine::new(PF, &p);
    let names: Vec<Name> = pf.engine.watches().iter().map(|w| w.name.clone()).collect();
    for name in &names {
        pf.read(name, 0.0);
        pf.read(name, 1.0);
    }
    let sent = pf.send_all();
    assert_eq!(sent.len(), 500);
    let bytes = postcard::to_stdvec(&pf.engine.give()).unwrap().len();
    println!("budget: a catch-up's answer for 500 entries took {bytes} bytes, against 65,536");
    assert!(bytes < 64 * 1024, "{bytes} bytes");
}

#[test]
#[ignore = "a timing, measured by hand in a release build"]
fn an_engine_call_and_compiling_300_write_functions_take_this_long() {
    // cargo test -p sync-engine --release --test engine -- --ignored --nocapture an_engine_call_and_compiling
    let entries: Vec<StateEntry> = (0..300)
        .map(|i| {
            let name = l(&format!("SWITCH_{i}"));
            let f = format!(
                "(value) => {{ write(L('SWITCH_{i}'), value); write(H('SWITCH_{i}_CLICK')) }}"
            );
            state(&format!("switch_{i}"), name, Write::Function(f))
        })
        .collect();
    let p = profile(entries, vec![]);
    let started = std::time::Instant::now();
    let mut pm = Machine::new(PM, &p);
    let compile = started.elapsed();
    let names: Vec<Name> = pm.engine.watches().iter().map(|w| w.name.clone()).collect();
    for name in &names {
        pm.read(name, 0.0);
    }
    let mut slowest = std::time::Duration::ZERO;
    for (n, i) in (0..300).cycle().take(3_000).enumerate() {
        let started = std::time::Instant::now();
        pm.arrive(
            &format!("switch_{i}"),
            (n % 2) as f64 + 1.0,
            stamp(PF, n as u64 + 1, &[]),
        );
        pm.frame();
        slowest = slowest.max(started.elapsed());
        pm.take();
    }
    println!(
        "timing: compiling 300 write functions took {:.2}ms, against 10ms; the slowest arrival and frame of 3,000 took {}µs, against 1,000µs",
        compile.as_secs_f64() * 1_000.0,
        slowest.as_micros()
    );
}

fn heading_steps(pace: Option<profile_engine::Pace>) -> (Name, Resolved) {
    let hdg = Name::A {
        name: "AUTOPILOT HEADING LOCK DIR".into(),
        unit: "Degrees".into(),
    };
    let write = Write::Steps(Steps {
        inc: k("HEADING_BUG_INC"),
        dec: k("HEADING_BUG_DEC"),
        step: 1.0,
        wrap: Some(true),
        range: Some((0.0, 359.0)),
        pace,
    });
    (
        hdg.clone(),
        profile(vec![state("heading", hdg, write)], vec![]),
    )
}

fn steps_up(out: &[Out]) -> usize {
    out.iter()
        .filter(
            |o| matches!(o, Out::Act(Action::Key { name, .. }) if *name == k("HEADING_BUG_INC")),
        )
        .count()
}

#[test]
fn a_stepping_write_that_ended_starts_its_next_from_its_last_step_not_a_lagging_reading() {
    let (hdg, p) = heading_steps(None);
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 100.0);
    pm.arrive("heading", 103.0, stamp(PF, 1, &[]));
    pm.frame();
    pm.frame();
    // The reading lags the last step, which went 2 frames ago.
    pm.read(&hdg, 101.0);
    pm.arrive("heading", 104.0, stamp(PF, 2, &[]));
    pm.wait(SECOND / 10);
    let out = pm.take();
    assert_eq!(
        steps_up(&out),
        4,
        "100 to 104 is four steps, and none past it: {out:?}"
    );
}

#[test]
fn a_new_value_already_at_the_count_stops_the_stepping_write_there() {
    let (hdg, p) = heading_steps(None);
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 100.0);
    assert_eq!(
        pm.arrive("heading", 110.0, stamp(PF, 1, &[])),
        Applied::Stepping
    );
    for _ in 0..4 {
        pm.frame();
    }
    // The count is at 105 when the pilot flying's turn back to 105 arrives.
    assert_eq!(
        pm.arrive("heading", 105.0, stamp(PF, 2, &[])),
        Applied::Done
    );
    pm.wait(SECOND / 5);
    let out = pm.take();
    assert_eq!(steps_up(&out), 5, "{out:?}");
    assert!(
        out.contains(&Out::Stepped("heading".into())),
        "the first arrival counts as applied"
    );
}

#[test]
fn a_put_back_during_a_catch_ups_stepping_write_still_makes_the_catch_up() {
    let (hdg, p) = heading_steps(Some(profile_engine::Pace::Frames(2)));
    let mut pm = Machine::new(PM, &p);
    pm.read(&hdg, 0.0);
    pm.catching_up = true;
    let out = pm.engine.take(
        &CatchUpState {
            entries: vec![entry("heading", 6.0)],
        },
        pm.cx(),
    );
    pm.out.extend(out);
    pm.frame();
    pm.frame();
    // The aircraft restores its own heading while the catch-up steps, which is put back.
    pm.read(&hdg, 50.0);
    pm.wait(SECOND);
    let out = pm.take();
    assert!(out.contains(&Out::CatchUpMade), "{out:?}");
}

#[test]
fn value_in_a_functions_k_event_takes_the_functions_value() {
    let baro = l("BARO");
    let function = "(v) => { write(K('KOHLSMAN_SET', 2, value)) }";
    let p = profile(
        vec![state(
            "baro",
            baro.clone(),
            Write::Function(function.into()),
        )],
        vec![],
    );
    let mut pm = Machine::new(PM, &p);
    pm.read(&baro, 0.0);
    pm.arrive("baro", 16272.0, stamp(PF, 1, &[]));
    let acts = pm.acts();
    assert!(
        matches!(acts.as_slice(), [Action::Key { values, .. }] if *values == vec![2.0, 16272.0]),
        "{acts:?}"
    );
}
