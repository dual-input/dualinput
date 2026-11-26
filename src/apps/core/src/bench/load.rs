//! The loop under load's test unit, which stands in for the sim service and the network, and
//! runs state sync's write functions, in one sync engine of its own
//! (record/areas/build/02-testing.md, "The loop under load"). The playback feeds it.
//!
//! The rates and costs are p10's, the probe that first ran this load on a loop of its own:
//! a flight's capture at the pace it was captured, made-up inputs at a session's rates, 100
//! write functions on each flight-model input, and a write function stopped at its limit
//! once a minute (record/areas/architecture/log.md, "2026-10-16: A flying machine that hosts
//! traffic at EGLL takes in 285 MB of inputs an hour, 45 MB with zstd, mostly traffic, and one
//! loop carries them at 0.5% of a core and replays them exactly").
//!
//! The engine gets what state sync gives it: a frame before each flight-model input, and each
//! write back as the sim's reading of it. Without both, every write's value stayed pending, and
//! a run grew slower each minute, to 12,273 inputs over 1ms (measured on our development
//! machine, 2026-11-09, record/areas/sync/log.md, "Stage 14's session in the sim passed in four
//! aircraft, and no aircraft took an H: event our module fired").

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use kernel::{Cx, Exit, Input, Job, JobId, Registry, TimerId};
use messages::cockpit::{Origin, VectorClock};
use messages::session::Control;
use messages::sync::{Stamp, Value};
use profile_engine::{Name, Owner, Resolved, StateEntry, Watch, Write};
use sandbox::Sandbox;
use serde::Serialize;
use sync_engine::{Action, Arrived, Ctx, Engine, Load as EngineLoad, Out, Ready, SETTLE, Seen};

// Each input's bytes start with its kind, two bytes little-endian. The capture's own kinds
// are p10's, from 1 to 13, as tools/bench/fixtures/README.md lists them.
pub const FLIGHT_MODEL: u16 = 1;
pub const PROFILE: u16 = 2;
// The made-up inputs of a session, which the playback makes.
pub const LINK_COCKPIT: u16 = 100;
pub const LINK_AVATAR: u16 = 101;
pub const LINK_HEARTBEAT: u16 = 102;
pub const PANEL: u16 = 103;
pub const ATC: u16 = 104;
pub const CURSOR: u16 = 105;
pub const START: u16 = 200;
pub const END: u16 = 201;

/// The input of `kind` with `bytes` after it.
pub fn input(kind: u16, bytes: &[u8]) -> Vec<u8> {
    let mut input = kind.to_le_bytes().to_vec();
    input.extend_from_slice(bytes);
    input
}

/// Where the values start in `SIMCONNECT_RECV_SIMOBJECT_DATA`: after its 12-byte header and
/// seven DWORDs.
const DATA_AT: usize = 40;
const WRITES: u16 = 100;
/// The two machines of the load's one engine: this one, and the pilot flying whose changes it
/// applies.
const ME: Origin = Origin {
    pilot: [2; 16],
    restart: 0,
};
const PF: Origin = Origin {
    pilot: [1; 16],
    restart: 0,
};
/// The limit a write function is stopped at (record/areas/architecture/02-code-map.md,
/// "Budgets").
const LIMIT: Duration = Duration::from_millis(100);
const STOP_EVERY: Duration = Duration::from_secs(60);
/// p10's timer firings, 5 a second, and its jobs, one every 30s with a 1 KB result, which
/// run here as the kernel's own timers and jobs.
const TICK: Duration = Duration::from_millis(200);
const JOB_EVERY: Duration = Duration::from_secs(30);
const JOB_FILE: &str = "bench-load.bin";

/// Names the source the playback pushes under.
pub struct Playback;

/// What the load unit puts out, in place of what the units it stands for would. Each goes
/// into the outputs' hash, so the replay checks it.
#[derive(Serialize)]
pub enum Wrote {
    /// A write function's write of a value's bits to an entry.
    Entry {
        entry: u16,
        bits: u64,
    },
    /// A profile entry the sim changed.
    Changed {
        id: u32,
        bits: u64,
    },
    /// An input passed on whole, as traffic passes on each object's record.
    Passed(Vec<u8>),
    Tick(u64),
    Stopped(u64),
    Read(u64),
}

#[derive(Default)]
pub struct Load {
    /// How many inputs of each kind came.
    inputs: BTreeMap<u16, u64>,
    ticks: u64,
    stops: u64,
    /// One sync engine, whose 100 entries each write through a function, and how many changes
    /// the pilot flying has made of them.
    engine: Option<Engine>,
    changes: u64,
    /// Each entry's watch, by the entry's place, which a write's reading comes back under.
    watch_of: Vec<usize>,
}

/// An entry that reads a variable and writes it through a function that reads the state object,
/// as a write function that guards on another entry does.
fn entry(place: u16) -> StateEntry {
    let name = format!("BENCH_{place}");
    let function = format!(
        "(value) => {{ if (state.e{} !== undefined) write(L('{name}'), value) }}",
        (place + 1) % WRITES,
    );
    StateEntry {
        key: format!("e{place}"),
        name: format!("Entry {place}"),
        description: None,
        watch: Watch::Name(Name::L { name, unit: None }),
        write: Write::Function(function),
        owner: Owner::Shared,
        only: Vec::new(),
        ignore: Vec::new(),
        features: Default::default(),
    }
}

fn ctx(at: u64) -> Ctx {
    Ctx {
        at,
        me: ME,
        control: Control {
            generation: 0,
            pf: PF.pilot,
        },
        catching_up: false,
        preflight_ended: true,
    }
}

impl Load {
    pub fn register(r: &mut Registry) {
        r.unit::<Load>("bench-load").source::<Playback>(Load::input);
    }

    fn input(me: &mut Load, input: &Input, cx: &mut Cx) {
        let Some((kind, bytes)) = input.bytes.split_first_chunk::<2>() else {
            return;
        };
        let kind = u16::from_le_bytes(*kind);
        *me.inputs.entry(kind).or_default() += 1;
        match kind {
            START => {
                cx.timer(TICK, Load::tick);
                cx.timer(STOP_EVERY, Load::stop);
                cx.timer(JOB_EVERY, Load::job);
                let file = cx.random_bytes::<1024>().to_vec();
                cx.job(Job::write(JOB_FILE, file), Load::written);
                me.load_engine(cx);
            }
            FLIGHT_MODEL => {
                let values: Vec<u64> = words(bytes.get(DATA_AT..).unwrap_or_default()).collect();
                me.changes += 1;
                let number = me.changes;
                let at = cx.now();
                let Some(engine) = me.engine.as_mut() else {
                    return;
                };
                engine.frame(ctx(at));
                let mut clock = VectorClock::default();
                clock.set(PF, number);
                for entry in 0..WRITES {
                    let bits = match values.len() {
                        0 => 0,
                        n => values[usize::from(entry) % n],
                    };
                    let change = Arrived::Change {
                        value: Value::Number(bits as f64),
                        stamp: Stamp {
                            origin: PF,
                            number,
                            clock: clock.clone(),
                            pilot_flying: PF.pilot,
                        },
                    };
                    let (_, out) = engine.arrived(&format!("e{entry}"), change, ctx(at));
                    for out in out {
                        if let Out::Act(Action::Set { value, .. }) = out {
                            let bits = value.number().unwrap_or(0.0).to_bits();
                            cx.out(Wrote::Entry { entry, bits });
                            if let Some(&watch) = me.watch_of.get(usize::from(entry)) {
                                engine.seen(Seen::Value { watch, value }, ctx(at));
                            }
                        }
                    }
                }
            }
            PROFILE => {
                for item in bytes.get(DATA_AT..).unwrap_or_default().chunks_exact(12) {
                    let (id, value) = item.split_at(4);
                    cx.out(Wrote::Changed {
                        id: u32::from_le_bytes(id.try_into().expect("4 bytes")),
                        bits: u64::from_le_bytes(value.try_into().expect("8 bytes")),
                    });
                }
            }
            LINK_COCKPIT => {
                if let [a, b, rest @ ..] = bytes {
                    cx.out(Wrote::Entry {
                        entry: u16::from_le_bytes([*a, *b]),
                        bits: words(rest.get(2..).unwrap_or_default()).next().unwrap_or(0),
                    });
                }
            }
            LINK_AVATAR | LINK_HEARTBEAT | PANEL | CURSOR => {}
            END => cx.out(Exit),
            _ => cx.out(Wrote::Passed(bytes.to_vec())),
        }
    }

    /// Loads the engine, with each entry's first reading, since the engine holds a write until
    /// its entry has one.
    fn load_engine(&mut self, cx: &Cx) {
        let profile = Resolved {
            variant: "bench".into(),
            pace: None,
            state: (0..WRITES).map(entry).collect(),
            events: Vec::new(),
            features: Default::default(),
        };
        let load = EngineLoad {
            at: cx.now(),
            ready: Ready::At(0),
            settle: SETTLE,
        };
        let mut engine = Engine::load(&profile, Sandbox::new(), load);
        self.watch_of = (0..WRITES)
            .map(|place| {
                let key = format!("e{place}");
                engine
                    .watches()
                    .iter()
                    .position(|w| w.entry == key)
                    .unwrap_or(usize::MAX)
            })
            .collect();
        for watch in 0..engine.watches().len() {
            let seen = Seen::Value {
                watch,
                value: Value::Number(0.0),
            };
            engine.seen(seen, ctx(cx.now()));
        }
        self.engine = Some(engine);
    }

    fn tick(me: &mut Load, _: TimerId, cx: &mut Cx) {
        me.ticks += 1;
        cx.out(Wrote::Tick(me.ticks));
        cx.timer(TICK, Load::tick);
    }

    fn stop(me: &mut Load, _: TimerId, cx: &mut Cx) {
        hold(Instant::now(), LIMIT);
        me.stops += 1;
        cx.out(Wrote::Stopped(me.stops));
        cx.timer(STOP_EVERY, Load::stop);
    }

    fn job(_: &mut Load, _: TimerId, cx: &mut Cx) {
        cx.job(Job::read(JOB_FILE), Load::read);
        cx.timer(JOB_EVERY, Load::job);
    }

    fn read(_: &mut Load, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        cx.out(Wrote::Read(result.map_or(0, |bytes| bytes.len() as u64)));
    }

    fn written(_: &mut Load, _: JobId, _: Result<Vec<u8>, String>, _: &mut Cx) {}
}

/// Keeps the loop until `long` has passed since `started`, as a function's run would. No
/// other handler reads the clock, since what it read would differ in a replay, but this one
/// only waits on it and puts out nothing that turns on it, so the replay still matches, and
/// takes as long.
fn hold(started: Instant, long: Duration) {
    while started.elapsed() < long {
        std::hint::spin_loop();
    }
}

fn words(bytes: &[u8]) -> impl Iterator<Item = u64> + '_ {
    bytes
        .chunks_exact(8)
        .map(|w| u64::from_le_bytes(w.try_into().expect("8 bytes")))
}
