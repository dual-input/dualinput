//! Our WASM module, as the core sees it: the routines' feeds, which the service writes again
//! every 200ms until a feature feeds another or ends the routine, and the module's status. A
//! module that stopped can't lift the freeze its routine holds, so the core lifts it when the
//! routine ends, as the pilot takes control or leaves, rather than the moment the module
//! stops, which would hand the pilot a flying aircraft unasked
//! (record/areas/architecture/log.md, 2026-10-23).

use std::collections::BTreeMap;
use std::time::Duration;

use kernel::{Cx, TimerId, UnitId};
use messages::module::slots::{HoldSlot, SlotHeader};
use messages::module::{HOLD, ModuleStatus, RoutineId};
use messages::sim::Stage;
use sim_awareness::SimAwareness;
use sim_client::Area;

use crate::SimService;
use crate::connections::Origin;

/// How often the service writes each live routine's last feed again, so the routine host,
/// which drops a routine 1s after its last write, keeps it running while the core runs. The
/// timer runs from the core's start whether or not a routine is live.
pub(crate) const REWRITE: Duration = Duration::from_millis(200);

/// How long the module's counter stays still, in Flying, unpaused, with a routine live,
/// before the core takes the module as stopped, in µs.
const STOPPED: u64 = 3_000_000;

/// The events that turn off each of the three freezes the routine host sets.
const UNFREEZES: [&str; 3] = [
    "K:FREEZE_LATITUDE_LONGITUDE_SET",
    "K:FREEZE_ALTITUDE_SET",
    "K:FREEZE_ATTITUDE_SET",
];

/// Our WASM module's status, which the apps show, so its type is the message crate's.
pub use messages::sim::ModuleState as Status;

/// Feeds preflight's `Hold`, the platform's own routine, on the platform's connection, or ends
/// it, which the session crate asks for as its pilot enters the flight in preflight and as
/// preflight ends (record/areas/architecture/02-code-map.md, "Routines in our WASM module").
pub fn hold(cx: &Cx, on: bool) {
    cx.call(SimService::hold_preflight, on);
}

impl SimService {
    fn hold_preflight(me: &mut SimService, on: bool, cx: &mut Cx) {
        let unit = me.me();
        if on {
            let body = bytemuck::bytes_of(&HoldSlot {}).to_vec();
            SimService::feed(me, (unit, HOLD, body), cx);
        } else {
            SimService::end(me, (unit, HOLD), cx);
        }
    }
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

    /// Every routine a feature has fed, the platform's own left out.
    pub(crate) fn routines_of_features(&self, platform: UnitId) -> Vec<(UnitId, RoutineId)> {
        self.feeds
            .keys()
            .filter(|(unit, _)| *unit != platform)
            .copied()
            .collect()
    }

    /// `unit`'s connection closed, and its slots' areas with it, so its next feed maps its
    /// slot again on the next one.
    pub(crate) fn closed(&mut self, unit: UnitId) {
        for ((u, _), feed) in &mut self.feeds {
            if *u == unit {
                feed.area = None;
            }
        }
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
        let still_frozen = me
            .module
            .feeds
            .iter()
            .any(|((_, other), f)| f.live && other.freezes);
        if me.module.status == Status::Stopped && routine.freezes && !still_frozen {
            tracing::info!(
                routine = routine.name,
                "a routine that held the freeze ended while our WASM module was stopped, so the core lifts it"
            );
            me.unfreeze(cx);
        }
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
    /// and a module unpaused after a long pause isn't taken as stopped before its next write
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "The module's status").
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
                "our WASM module stopped with a routine live, so the aircraft stays frozen until the routine ends"
            );
        }
        // Every moment that can change the status or whether a routine is live runs this,
        // so the notifications follow both from here.
        self.module_notifications(cx);
    }

    /// Turns off all three freezes through the platform's connection, as a client outside the
    /// sim released a frozen Baron (measured on MSFS 2024, 2026-10-03,
    /// record/areas/flight-model/log.md). The events go out in the same input as the
    /// routine's end, with no read of the flags first, so a quit's exit, which takes no
    /// input after it, still carries them out.
    fn unfreeze(&mut self, cx: &Cx) {
        let origin = Origin {
            unit: self.me(),
            handle: None,
        };
        let Some(client) = self.client(origin, cx) else {
            return;
        };
        let ops = UNFREEZES
            .iter()
            .flat_map(|event| client.key(&origin, event, 0))
            .collect();
        self.make(origin, ops, cx);
    }
}
