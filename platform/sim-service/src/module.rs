//! Our WASM module, as the core sees it: the routines' feeds, which the service writes again
//! every 200ms until a feature feeds another or ends the routine, and the module's status,
//! which decides when the core unfreezes the aircraft for a module that stopped
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The module's status").

use std::collections::BTreeMap;
use std::time::Duration;

use kernel::{Cx, TimerId, UnitId};
use messages::module::slots::SlotHeader;
use messages::module::{ModuleStatus, RoutineId};
use messages::sim::Stage;
use sim_awareness::SimAwareness;
use sim_client::{Area, Period, Value, Var};

use crate::SimService;
use crate::connections::Origin;

/// How often the service writes each live routine's last feed again, so the routine host,
/// which drops a routine 1s after its last write, keeps it running while the core runs. The
/// timer runs from the core's start whether or not a routine is live.
pub(crate) const REWRITE: Duration = Duration::from_millis(200);

/// How long the module's counter stays still, in Flying, unpaused, with a routine live,
/// before the core takes the module as stopped, in µs.
const STOPPED: u64 = 3_000_000;

/// The freeze flags the core reads, and the event that turns each off.
const FREEZES: [(&str, &str); 3] = [
    (
        "A:IS LATITUDE LONGITUDE FREEZE ON",
        "K:FREEZE_LATITUDE_LONGITUDE_SET",
    ),
    ("A:IS ALTITUDE FREEZE ON", "K:FREEZE_ALTITUDE_SET"),
    ("A:IS ATTITUDE FREEZE ON", "K:FREEZE_ATTITUDE_SET"),
];

/// Our WASM module's status.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Status {
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

#[derive(Default)]
pub(crate) struct ModuleWatch {
    pub(crate) status: Status,
    counter: Option<u64>,
    /// How long the counter has been still while all of Stopped's conditions held, in µs.
    still: u64,
    /// The stamp of the last check, while the conditions held at it.
    holding_since: Option<u64>,
    feeds: BTreeMap<(UnitId, RoutineId), Feed>,
}

struct Feed {
    /// The feature's count of feeds, which the header carries.
    feeds: u32,
    body: Vec<u8>,
    live: bool,
    /// The slot on the feature's connection, until the connection goes with the sim.
    area: Option<Area>,
}

impl ModuleWatch {
    pub(crate) fn live(&self) -> bool {
        self.feeds.values().any(|f| f.live)
    }

    /// The sim's process ended, and its module with it, so every routine ends, and the next
    /// run of the sim starts none its feature hasn't fed it, and reads Missing until its
    /// module writes.
    pub(crate) fn sim_exited(&mut self) {
        for feed in self.feeds.values_mut() {
            feed.live = false;
            feed.area = None;
        }
        self.status = Status::Missing;
        self.counter = None;
        self.still = 0;
        self.holding_since = None;
    }
}

impl SimService {
    /// `cx.module().feed(...)`, as the service: writes the routine's new feed into its slot,
    /// and keeps writing it again until the next feed or the routine's end.
    pub(crate) fn feed(
        me: &mut SimService,
        (unit, routine, body): (UnitId, RoutineId, Vec<u8>),
        cx: &mut Cx,
    ) {
        let feed = me.module.feeds.entry((unit, routine)).or_insert(Feed {
            feeds: 0,
            body: Vec::new(),
            live: false,
            area: None,
        });
        feed.feeds = feed.feeds.wrapping_add(1);
        feed.body = body;
        feed.live = true;
        me.write_slot(unit, routine, cx);
        me.check_stall(cx);
    }

    /// `cx.module().end(...)`: writes the routine's end mark, which its slot holds until the
    /// next feed.
    pub(crate) fn end(me: &mut SimService, (unit, routine): (UnitId, RoutineId), cx: &mut Cx) {
        let Some(feed) = me.module.feeds.get_mut(&(unit, routine)) else {
            return;
        };
        if !feed.live {
            return;
        }
        feed.live = false;
        me.write_slot(unit, routine, cx);
        me.check_stall(cx);
    }

    pub(crate) fn rewrite(me: &mut SimService, _: TimerId, cx: &mut Cx) {
        let live: Vec<_> = me
            .module
            .feeds
            .iter()
            .filter(|(_, f)| f.live)
            .map(|(&key, _)| key)
            .collect();
        for (unit, routine) in live {
            me.write_slot(unit, routine, cx);
        }
        me.check_stall(cx);
        cx.timer(REWRITE, SimService::rewrite);
    }

    /// Writes a routine's slot as its feed stands: the header, then its struct, or the end
    /// mark once it has ended.
    fn write_slot(&mut self, unit: UnitId, routine: RoutineId, cx: &Cx) {
        let origin = Origin { unit, handle: None };
        let Some(feed) = self.module.feeds.get(&(unit, routine)) else {
            return;
        };
        let header = SlotHeader {
            feeds: feed.feeds,
            end: u32::from(!feed.live),
            slots_hash: messages::SLOTS_HASH,
            counter: cx.now(),
        };
        let mut data = bytemuck::bytes_of(&header).to_vec();
        data.extend_from_slice(&feed.body);
        let (size, area) = (data.len() as u32, feed.area);
        let Some(client) = self.client(origin, cx) else {
            return;
        };
        let mut ops = Vec::new();
        let area = match area {
            Some(area) => area,
            None => {
                let (area, set_up) = client.area(&origin, &routine.slot(), size);
                ops.extend(set_up);
                area
            }
        };
        ops.push(client.write_area(area, data));
        if let Some(feed) = self.module.feeds.get_mut(&(unit, routine)) {
            feed.area = Some(area);
        }
        self.make(origin, ops, cx);
    }

    /// The module wrote its status slot.
    pub(crate) fn status_read(&mut self, bytes: &[u8], cx: &Cx) {
        let Some(bytes) = bytes.get(..size_of::<ModuleStatus>()) else {
            tracing::warn!("the module's status slot held too few bytes");
            return;
        };
        let status: ModuleStatus = bytemuck::pod_read_unaligned(bytes);
        let was = self.module.status;
        if status.slots_hash != messages::SLOTS_HASH {
            self.module.status = Status::Differs;
            if was != Status::Differs {
                tracing::warn!(
                    module = status.version(),
                    core = messages::VERSION,
                    "our WASM module is from another build, so it runs none of this core's feeds"
                );
            }
        } else if self.module.counter != Some(status.counter) {
            self.module.counter = Some(status.counter);
            self.module.status = Status::Running;
            self.module.still = 0;
            if was != Status::Running {
                tracing::info!(module = status.version(), "our WASM module is running");
            }
        }
        self.check_stall(cx);
    }

    /// Counts the time the module's counter has been still while Stopped's conditions held,
    /// at each moment one of them can change, so the 3s count only while all three hold,
    /// and an aircraft unpaused after a long pause isn't unfrozen before the module's next
    /// write (record/areas/core/03-sim-seam-and-wasm-module.md, "The module's status").
    pub(crate) fn check_stall(&mut self, cx: &Cx) {
        let now = cx.now();
        if let Some(since) = self.module.holding_since {
            self.module.still += now.saturating_sub(since);
        }
        let awareness = cx.read::<SimAwareness>();
        let holds = self.module.status == Status::Running
            && awareness.stage == Stage::Flying
            && awareness.pause == 0
            && self.module.live();
        self.module.holding_since = holds.then_some(now);
        if holds && self.module.still >= STOPPED {
            self.module.status = Status::Stopped;
            self.module.holding_since = None;
            tracing::warn!(
                still_ms = self.module.still / 1_000,
                "our WASM module stopped with a routine live, so the core unfreezes the aircraft"
            );
            self.unfreeze(cx);
        }
    }

    /// Reads the three freeze flags through the platform's connection, then turns off each
    /// that's on, as a client outside the sim released a frozen Baron that way (measured on
    /// MSFS 2024, 2026-10-03, record/areas/flight-model/log.md). A module with no routine
    /// live froze nothing, so a freeze now is taken to be ours.
    fn unfreeze(&mut self, cx: &Cx) {
        let origin = Origin {
            unit: self.me(),
            handle: None,
        };
        let Some(client) = self.client(origin, cx) else {
            return;
        };
        let vars: Vec<Var> = FREEZES
            .iter()
            .map(|(var, _)| Var::number(var, "bool"))
            .collect();
        let (watch, ops) = client.watch(&origin, &vars, Period::Once);
        self.platform.freeze = Some(watch.request);
        self.make(origin, ops, cx);
    }

    /// The freeze flags the unfreeze read.
    pub(crate) fn freeze_read(&mut self, values: &[(usize, Value)], cx: &Cx) {
        let origin = Origin {
            unit: self.me(),
            handle: None,
        };
        let Some(client) = self.client(origin, cx) else {
            return;
        };
        let mut ops = Vec::new();
        for (place, value) in values {
            if let (Some((_, event)), Value::Number(on)) = (FREEZES.get(*place), value)
                && *on != 0.0
            {
                ops.extend(client.key(&origin, event, 0));
            }
        }
        self.make(origin, ops, cx);
    }
}
