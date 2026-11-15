//! A receiving machine, any whose pilot isn't the traffic host: it keeps each sender's
//! identities and newest states, and while its pilot is in the flight shows the traffic host's
//! objects as copies, each created, released, frozen, dressed, and fed to `Traffic`, which draws
//! it (record/areas/traffic-atc/01-traffic-and-atc.md, "A receiving machine").

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use kernel::{Cx, Handle, TimerId};
use messages::net::PilotId;
use messages::traffic::slots::{ENTRIES, Entry, TrafficSlot};
use messages::traffic::{FLAPS, Identity, Kind, LIGHTS, State, TRAFFIC};
use network::{Network, Sender, Slewed};
use sim_service::{SimCx, Value, Var};

use crate::wire::{entry, init_position};

/// How long a copy goes with no state before it's removed, in µs, keeping its identity, so the
/// next state creates it again: three of the host's 5s samples, since two lost in a row would
/// otherwise take a parked copy away for the rest of the session.
const STALE: u64 = 15_000_000;

/// How long a state that came before its identity waits for it, in µs, as FS Copilot's did
/// (record/areas/traffic-atc/results/2026-10-17-fsc-traffic-code.txt, point 2).
const PENDING: u64 = 10_000_000;

/// How often the machine looks for stale copies.
pub(crate) const UPKEEP: Duration = Duration::from_secs(1);

/// What a create that threw is made again as, with no livery, for an aircraft and a
/// helicopter; a ground object has none. The aircraft's is FS Copilot's (read in the FS Copilot
/// fork, `FsCopilot/Simulation/TrafficFallbacks.cs`). Its helicopter, `Asobo PassiveAircraft
/// Bell 407`, isn't among MSFS 2024's passive helicopters, which refused it, so the helicopter's
/// is the Bell 505, the nearest that is (measured on MSFS 2024, 2026-11-15,
/// record/areas/traffic-atc/log.md).
const STAND_IN_AIRCRAFT: &str = "Asobo PassiveAircraft Citation CJ4";
const STAND_IN_HELICOPTER: &str = "Asobo PassiveAircraft B505";

/// The events that freeze a copy, each sent with 1, after which the sim moves it only where
/// it's written, as FS Copilot's copies read back `IS ... FREEZE ON` as 1 on all three (FS
/// Copilot fork, `record/traffic-atc/docs/build/log.md`, "Jitter measured, not eyeballed").
const FREEZES: [&str; 3] = [
    "K:FREEZE_LATITUDE_LONGITUDE_SET",
    "K:FREEZE_ALTITUDE_SET",
    "K:FREEZE_ATTITUDE_SET",
];

/// What one sender sent, kept apart from every other sender's.
#[derive(Default)]
struct From {
    identities: BTreeMap<u32, Identity>,
    /// Each object's newest state, its time on the sender's counter, and when it arrived on
    /// this core's.
    states: BTreeMap<u32, (u64, State, u64)>,
    /// Its restart count, which its clock offset goes with.
    restart: u32,
    offset: Slewed,
    /// The offset its last batch was fed with, once the network had one.
    applied: Option<i64>,
}

/// One copy of an object of the shown sender's, by the sender's object ID.
struct Copy {
    made: Made,
    /// Whether it's the stand-in, after its own title's create threw.
    stand_in: bool,
    /// When its last state arrived, on this core's counter.
    last: u64,
    /// The dress last written, so only a change writes again.
    dressed: Option<Dress>,
}

enum Made {
    /// Its create is out, by its call.
    Creating(Handle),
    /// In the sim, by its object ID there.
    Created(u32),
    /// Its create threw, and its stand-in's too, or it has none.
    Missing,
}

/// The gear and lights, the four flap surfaces, and the engines, each written through a
/// definition of its own, so a model that won't take one of them loses only that write, as FS
/// Copilot wrote each engine apart so a twin was never asked about its third (read in the FS
/// Copilot fork, `FsCopilot/Simulation/TrafficDefinitions.cs`, `EngineState`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Dress {
    gear_lights: (u8, u8),
    flaps: [u8; 4],
    engines: u8,
}

impl Dress {
    fn of(s: &State) -> Dress {
        Dress {
            gear_lights: (s.gear, s.lights),
            flaps: s.flaps,
            engines: s.engines,
        }
    }
}

/// The definitions a copy is dressed through, on traffic's connection, made at its first copy.
#[derive(Clone, Copy)]
struct Definitions {
    gear_lights: Handle,
    flaps: Handle,
    engines: [Handle; 4],
}

#[derive(Default)]
pub(crate) struct Receiving {
    from: BTreeMap<PilotId, From>,
    /// The sender whose copies show: the member traffic's key names, while this pilot is in
    /// the flight.
    shown: Option<PilotId>,
    in_flight: bool,
    copies: BTreeMap<u32, Copy>,
    /// Each copy's object, by its object ID in this sim.
    by_object: BTreeMap<u32, u32>,
    definitions: Option<Definitions>,
    /// Whether `Traffic` is fed.
    drawing: bool,
    /// The removals `Traffic` hasn't been fed yet.
    removed: Vec<u32>,
    upkeep: Option<TimerId>,
}

impl Receiving {
    /// The copies' objects in this sim, which a count of aircraft and the host's poll skip.
    pub(crate) fn objects(&self) -> BTreeSet<u32> {
        self.by_object.keys().copied().collect()
    }

    /// The shown sender's aircraft and helicopters this sim shows as a stand-in or not at all,
    /// since a ground object that won't create says nothing about traffic packs.
    pub(crate) fn missing(&self) -> u32 {
        let Some(from) = self.shown.and_then(|s| self.from.get(&s)) else {
            return 0;
        };
        self.copies
            .iter()
            .filter(|(object, copy)| {
                let kind = from.identities.get(object).map(|i| i.kind);
                kind != Some(Kind::Ground) && (copy.stand_in || matches!(copy.made, Made::Missing))
            })
            .count() as u32
    }

    pub(crate) fn shown(&self) -> Option<PilotId> {
        self.shown.filter(|_| self.in_flight)
    }

    /// Follows the key and this pilot's flight: copies of the member traffic's key names while
    /// this pilot is in the flight. Returns the objects of the copies it removed.
    pub(crate) fn settle(
        &mut self,
        holder: Option<PilotId>,
        in_flight: bool,
        cx: &Cx,
    ) -> BTreeSet<u32> {
        let mut removed = BTreeSet::new();
        if holder != self.shown {
            // The key stopped naming its sender, the new traffic host's own machine included:
            // its copies go, and its identities with them.
            removed = self.remove_all(cx);
            if let Some(old) = self.shown {
                self.from.remove(&old);
            }
            if let Some(new) = holder {
                tracing::info!(
                    host = messages::hex(&new),
                    "another member is the traffic host"
                );
            }
            self.shown = holder;
        }
        if self.in_flight != in_flight {
            self.in_flight = in_flight;
            if in_flight {
                self.create_held(cx);
            } else {
                // A pilot who leaves the flight keeps the identities and newest states, so the
                // copies come back when they're in the flight again.
                removed.extend(self.remove_all(cx));
            }
        }
        let upkeep = self.shown().is_some();
        match (upkeep, self.upkeep) {
            (true, None) => self.upkeep = Some(cx.timer(UPKEEP, crate::Traffic::upkeep)),
            (false, Some(timer)) => {
                cx.cancel_timer(timer);
                self.upkeep = None;
            }
            _ => {}
        }
        removed
    }

    /// The session ended: everything every sender sent goes.
    pub(crate) fn clear(&mut self, cx: &Cx) {
        self.settle(None, false, cx);
        self.from.clear();
    }

    pub(crate) fn identity(
        &mut self,
        sender: Sender,
        object: u32,
        identity: Option<Identity>,
        cx: &Cx,
    ) {
        let from = self.from.entry(sender.pilot).or_default();
        match identity {
            Some(identity) => {
                from.identities.insert(object, identity);
                let waited = from
                    .states
                    .get(&object)
                    .is_some_and(|(_, _, arrived)| cx.now().saturating_sub(*arrived) < PENDING);
                if self.shown() == Some(sender.pilot)
                    && waited
                    && !self.copies.contains_key(&object)
                {
                    self.create(object, cx);
                }
            }
            None => {
                // It has gone from the traffic host's sim.
                from.identities.remove(&object);
                from.states.remove(&object);
                if self.shown() == Some(sender.pilot) {
                    self.remove(object, cx);
                    self.feed_removed(cx);
                }
            }
        }
    }

    /// A batch of states: each object's newest is kept, and while its sender shows, each copy
    /// with an identity is created, dressed, and fed to `Traffic` on this core's counter, once
    /// the network holds the sender's clock offset.
    pub(crate) fn states(&mut self, sender: Sender, base: u64, states: &[State], cx: &Cx) {
        let now = cx.now();
        let estimate = cx.read::<Network>().offset(sender);
        let from = self.from.entry(sender.pilot).or_default();
        if from.restart != sender.restart {
            from.restart = sender.restart;
            from.offset = Slewed::default();
            from.applied = None;
        }
        let offset = estimate.map(|e| from.offset.apply(e, now));
        from.applied = offset.or(from.applied);
        for state in states {
            let at = base.saturating_add(u64::from(state.after_ms) * 1_000);
            let newer = from
                .states
                .get(&state.object)
                .is_none_or(|(t, _, _)| *t < at);
            if newer {
                from.states.insert(state.object, (at, *state, now));
            }
        }
        if self.shown() != Some(sender.pilot) {
            return;
        }
        let mut fed = Vec::new();
        for state in states {
            if !self
                .from
                .get(&sender.pilot)
                .is_some_and(|f| f.identities.contains_key(&state.object))
            {
                continue;
            }
            let Some(copy) = self.copies.get_mut(&state.object) else {
                self.create(state.object, cx);
                continue;
            };
            copy.last = now;
            if let Made::Created(sim) = copy.made {
                let at = base.saturating_add(u64::from(state.after_ms) * 1_000);
                if let Some(offset) = offset {
                    fed.push(entry(sim, at.saturating_add_signed(-offset), state));
                }
                self.dress(state.object, cx);
            }
        }
        self.feed(&fed, cx);
    }

    /// Creates the copy of every object with an identity and a state, as this pilot comes into
    /// the flight.
    fn create_held(&mut self, cx: &Cx) {
        let Some(from) = self.shown().and_then(|s| self.from.get(&s)) else {
            return;
        };
        let objects: Vec<u32> = from
            .identities
            .keys()
            .filter(|o| from.states.contains_key(o))
            .copied()
            .collect();
        for object in objects {
            self.create(object, cx);
        }
    }

    /// Creates `object`'s copy at its newest state: an aircraft or a helicopter with its tail,
    /// as `AICreateNonATCAircraft_EX1` does, or a ground object, as `AICreateSimulatedObject_EX1`
    /// does, or its stand-in after a create that threw.
    fn create(&mut self, object: u32, cx: &Cx) {
        let stand_in = self.copies.get(&object).is_some_and(|c| c.stand_in);
        let Some(from) = self.shown.and_then(|s| self.from.get(&s)) else {
            return;
        };
        let (Some(identity), Some((_, state, _))) =
            (from.identities.get(&object), from.states.get(&object))
        else {
            return;
        };
        let at = init_position(state);
        let sim = cx.sim();
        let call = match (identity.kind, stand_in) {
            (Kind::Ground, _) => sim.create_ai(&identity.title, &identity.livery, at),
            (_, false) => {
                sim.create_aircraft(&identity.title, &identity.livery, &identity.tail, at)
            }
            (kind, true) => {
                let title = if kind == Kind::Helicopter {
                    STAND_IN_HELICOPTER
                } else {
                    STAND_IN_AIRCRAFT
                };
                sim.create_aircraft(title, "", &identity.tail, at)
            }
        };
        self.copies.insert(
            object,
            Copy {
                made: Made::Creating(call),
                stand_in,
                last: cx.now(),
                dressed: None,
            },
        );
    }

    /// A create's object: it's released from the sim's AI, frozen, dressed, and drawn from its
    /// newest state; or, when the copy went while the create was out, removed at once.
    pub(crate) fn created(&mut self, call: Handle, sim: u32, cx: &Cx) -> bool {
        let Some((&object, copy)) = self
            .copies
            .iter_mut()
            .find(|(_, c)| matches!(c.made, Made::Creating(h) if h == call))
        else {
            return false;
        };
        copy.made = Made::Created(sim);
        self.by_object.insert(sim, object);
        let calls = cx.sim();
        calls.release(sim);
        for event in FREEZES {
            calls.key_on(sim, event, &[1]);
        }
        self.dress(object, cx);
        let first = self.shown.and_then(|s| self.from.get(&s)).and_then(|from| {
            let (at, state, _) = from.states.get(&object)?;
            Some(entry(sim, at.saturating_add_signed(-from.applied?), state))
        });
        self.feed(first.as_slice(), cx);
        true
    }

    /// The sim refused a call of the copies': a create, which is made again as its kind's
    /// stand-in, or once that fails too, leaves the copy missing.
    pub(crate) fn refused(&mut self, call: Handle, cx: &Cx) -> bool {
        let Some((&object, copy)) = self
            .copies
            .iter_mut()
            .find(|(_, c)| matches!(c.made, Made::Creating(h) if h == call))
        else {
            return false;
        };
        let kind = self
            .shown
            .and_then(|s| self.from.get(&s))
            .and_then(|f| f.identities.get(&object))
            .map(|i| (i.kind, i.title.clone()));
        match kind {
            Some((Kind::Aircraft | Kind::Helicopter, title)) if !copy.stand_in => {
                tracing::info!(
                    title,
                    "the sim refused a copy's title, so traffic creates its stand-in"
                );
                copy.stand_in = true;
                self.create(object, cx);
            }
            other => {
                tracing::info!(
                    title = other.map(|(_, t)| t),
                    "the sim refused a copy, so it's missing"
                );
                copy.made = Made::Missing;
            }
        }
        true
    }

    /// Writes the copy's dress where it changed: its gear and lights, its flap surfaces, and
    /// each of its engines, since a created aircraft comes with its engines running; a ground
    /// object answers each with `DATA_ERROR`, so it gets none (read in the FS Copilot fork,
    /// `FsCopilot/Simulation/TrafficDefinitions.cs`, `Appearance`).
    fn dress(&mut self, object: u32, cx: &Cx) {
        let Some(from) = self.shown.and_then(|s| self.from.get(&s)) else {
            return;
        };
        let (Some(identity), Some((_, state, _))) =
            (from.identities.get(&object), from.states.get(&object))
        else {
            return;
        };
        if identity.kind == Kind::Ground {
            return;
        }
        let dress = Dress::of(state);
        let Some(copy) = self.copies.get_mut(&object) else {
            return;
        };
        let Made::Created(sim) = copy.made else {
            return;
        };
        let was = copy.dressed.replace(dress);
        if was == Some(dress) {
            return;
        }
        let definitions = *self.definitions.get_or_insert_with(|| define(cx));
        let calls = cx.sim();
        if was.map(|w| w.gear_lights) != Some(dress.gear_lights) {
            let (gear, lights) = dress.gear_lights;
            let mut values = vec![Value::Number(f64::from(gear))];
            values.extend((0..LIGHTS.len()).map(|i| Value::Number(f64::from((lights >> i) & 1))));
            calls.write_into(definitions.gear_lights, sim, values);
        }
        if was.map(|w| w.flaps) != Some(dress.flaps) {
            let values = dress
                .flaps
                .iter()
                .map(|f| Value::Number(f64::from(*f)))
                .collect();
            calls.write_into(definitions.flaps, sim, values);
        }
        if was.map(|w| w.engines) != Some(dress.engines) {
            // Each engine apart, so a twin is never asked for its third engine.
            let count = usize::from(dress.engines >> 4).min(4);
            for (n, definition) in definitions.engines.iter().enumerate().take(count) {
                let burning = (dress.engines >> n) & 1;
                calls.write_into(*definition, sim, vec![Value::Number(f64::from(burning))]);
            }
        }
    }

    /// Removes `object`'s copy, with `AIRemoveObject`, rather than by closing the connection,
    /// since the connection stays open for the rest.
    fn remove(&mut self, object: u32, cx: &Cx) -> Option<u32> {
        let copy = self.copies.remove(&object)?;
        match copy.made {
            Made::Created(sim) => {
                self.by_object.remove(&sim);
                cx.sim().remove(sim);
                self.removed.push(sim);
                Some(sim)
            }
            // A create still out is removed once its object comes, as `created` finds no copy
            // waiting for it.
            Made::Creating(_) | Made::Missing => None,
        }
    }

    /// Removes every copy, and ends `Traffic` with no feed of their removals, since it has
    /// nothing left to draw. As this pilot leaves the flight, a profile's unload may already
    /// have closed traffic's connection, which a feed would open again.
    fn remove_all(&mut self, cx: &Cx) -> BTreeSet<u32> {
        let objects: Vec<u32> = self.copies.keys().copied().collect();
        let removed = objects
            .into_iter()
            .filter_map(|o| self.remove(o, cx))
            .collect();
        self.removed.clear();
        if self.drawing {
            self.drawing = false;
            cx.module().end(TRAFFIC);
        }
        removed
    }

    /// A create answered for a copy that went while it was out.
    pub(crate) fn orphan(&mut self, sim: u32, cx: &Cx) {
        cx.sim().remove(sim);
    }

    /// Every 1s: copies with no state for 15s go, keeping their identities, and states that
    /// waited 10s for an identity are dropped.
    pub(crate) fn upkeep(&mut self, timer: TimerId, cx: &Cx) {
        if self.upkeep != Some(timer) {
            return;
        }
        self.upkeep = Some(cx.timer(UPKEEP, crate::Traffic::upkeep));
        let now = cx.now();
        let stale: Vec<u32> = self
            .copies
            .iter()
            .filter(|(_, c)| now.saturating_sub(c.last) >= STALE)
            .map(|(&o, _)| o)
            .collect();
        for object in stale {
            self.remove(object, cx);
        }
        for from in self.from.values_mut() {
            let identities = &from.identities;
            from.states.retain(|object, (_, _, arrived)| {
                identities.contains_key(object) || now.saturating_sub(*arrived) < PENDING
            });
        }
        self.feed_removed(cx);
    }

    /// Traffic's connection went, lost or closed by a profile's unload, and every copy and
    /// definition with it: each copy is created again at its next state.
    pub(crate) fn lost(&mut self, cx: &Cx) {
        self.copies.clear();
        self.by_object.clear();
        self.removed.clear();
        self.definitions = None;
        if self.drawing {
            self.drawing = false;
            cx.module().end(TRAFFIC);
        }
    }

    fn feed_removed(&mut self, cx: &Cx) {
        let removed: Vec<Entry> = std::mem::take(&mut self.removed)
            .into_iter()
            .map(|object| Entry {
                object,
                removed: 1,
                ..Entry::default()
            })
            .collect();
        self.feed(&removed, cx);
    }

    /// Feeds `Traffic` `entries` in slots of up to `ENTRIES`, starting it at its first copy and
    /// ending it once no copy is left.
    fn feed(&mut self, entries: &[Entry], cx: &Cx) {
        let module = cx.module();
        for chunk in entries.chunks(ENTRIES) {
            if !self.drawing && chunk.iter().all(|e| e.removed != 0) {
                continue;
            }
            let mut slot = TrafficSlot {
                count: chunk.len() as u32,
                ..TrafficSlot::default()
            };
            slot.entries[..chunk.len()].copy_from_slice(chunk);
            module.feed(TRAFFIC, &slot);
            self.drawing = true;
        }
        if self.drawing && self.by_object.is_empty() {
            self.drawing = false;
            module.end(TRAFFIC);
        }
    }
}

/// The definitions a copy is dressed through.
fn define(cx: &Cx) -> Definitions {
    let sim = cx.sim();
    let mut gear_lights = vec![Var::number("A:GEAR HANDLE POSITION", "percent")];
    gear_lights.extend(LIGHTS.map(|name| Var::number(name, "bool")));
    let flaps: Vec<Var> = FLAPS.map(|name| Var::number(name, "percent")).to_vec();
    Definitions {
        gear_lights: sim.definition(&gear_lights),
        flaps: sim.definition(&flaps),
        engines: [1, 2, 3, 4].map(|n| {
            sim.definition(&[Var::number(
                &format!("A:GENERAL ENG COMBUSTION:{n}"),
                "bool",
            )])
        }),
    }
}
