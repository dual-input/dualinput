//! Each unit's connection: opening it, making calls on it, and making its setup again on
//! the next connection after a loss (record/areas/architecture/02-code-map.md, "A
//! connection for each feature, for each load").

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use kernel::{Cx, Handle, UnitId};
use sim_client::{Client, Connection, Op, SimCall, Tag, Watch};

use crate::{SimEvent, SimService};

/// The edge keeps the packet IDs of this many recent calls on each connection, and the
/// service their origins, so an exception the sim sends late still finds its call
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "Its thread"). `KEPT` in
/// src/engines/sim-edge/src/sent.rs is the edge's count, so change both together.
const RECENT: usize = 4_096;

/// The profile unloaded. The profile loader says so right after it raises `ProfileUnloaded`,
/// so this runs once every unit has handled that moment: each feature's routines end, and
/// each feature's connection closes, taking what the feature set up and created in the sim
/// with it, so its first call after the next load opens an empty one
/// (record/areas/architecture/02-code-map.md, "A connection for each feature, for each
/// load"). A sim call a feature makes as it hears `ProfileUnloaded` runs after this, and
/// opens its connection again, so a feature makes none then.
pub fn profile_unloaded(cx: &Cx) {
    cx.call(SimService::unloaded, ());
}

impl SimService {
    fn unloaded(me: &mut SimService, _: (), cx: &mut Cx) {
        let platform = me.me();
        for routine in me.module.routines_of_features(platform) {
            SimService::end(me, routine, cx);
        }
        let features: Vec<UnitId> = me
            .holders
            .values()
            .map(|h| h.unit)
            .filter(|&u| u != platform)
            .collect();
        for unit in features {
            me.close(unit, cx);
            me.module.closed(unit);
        }
    }
}

/// Who a call was made for: the unit, and the handle its call returned, which none of the
/// platform's own calls has.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Origin {
    pub(crate) unit: UnitId,
    pub(crate) handle: Option<Handle>,
}

/// One unit's connection, kept across its opens.
pub(crate) struct Holder {
    pub(crate) unit: UnitId,
    /// How many times the unit has opened a connection, which numbers the next.
    opens: u32,
    pub(crate) current: Option<Conn>,
    /// The connection's IDs and setup, which outlive a lost connection, so the next one
    /// makes the same setup with the same IDs.
    pub(crate) client: Client<Origin>,
    /// Each watch's handle by the request its values come under, and whether it reads once.
    pub(crate) routes: BTreeMap<u32, (Handle, bool)>,
    /// Each watch by its handle, for a write into its variables, a read once's until its answer.
    pub(crate) watches: BTreeMap<Handle, Watch>,
    /// Each create's handle by its request, until the object's ID comes.
    pub(crate) creates: BTreeMap<u32, Handle>,
    /// The objects the connection created and hasn't removed.
    pub(crate) objects: BTreeSet<u32>,
    /// The camera calls waiting for their answers, oldest first.
    pub(crate) cameras: VecDeque<Handle>,
    /// Each `frames` call's handle by the client event its `Frame` messages carry, which
    /// the next connection subscribes again with the rest of the setup.
    pub(crate) frames: BTreeMap<u32, Handle>,
    /// Each `listen` call's handle by the client event its messages carry.
    pub(crate) listens: BTreeMap<u32, Handle>,
    /// Each `input` call's handle, by the request its first value comes under, until it comes.
    pub(crate) input_reads: BTreeMap<u32, Handle>,
    /// The `input` calls reading each input event, by its hash, since two entries can.
    pub(crate) inputs: BTreeMap<u64, Vec<Handle>>,
    /// The tag of the unit's next call, from the unit's own count, and each recent call's
    /// origin by its tag.
    next_tag: u64,
    tags: BTreeMap<u64, Origin>,
}

impl Holder {
    fn new(unit: UnitId, opens: u32) -> Holder {
        Holder {
            unit,
            opens,
            current: None,
            client: Client::default(),
            routes: BTreeMap::new(),
            watches: BTreeMap::new(),
            creates: BTreeMap::new(),
            objects: BTreeSet::new(),
            cameras: VecDeque::new(),
            frames: BTreeMap::new(),
            listens: BTreeMap::new(),
            input_reads: BTreeMap::new(),
            inputs: BTreeMap::new(),
            next_tag: 0,
            tags: BTreeMap::new(),
        }
    }
}

pub(crate) struct Conn {
    pub(crate) connection: Connection,
    pub(crate) open: bool,
    /// Calls that set nothing up, made while the connection was still opening, which go out
    /// once it opens, after its setup.
    pending: Vec<(Origin, Op)>,
    /// The tags of the calls made on it, oldest first.
    sent: VecDeque<u64>,
}

/// The platform's own uses of its connection: the client events and requests whose
/// messages it reads itself.
#[derive(Default)]
pub(crate) struct Platform {
    pub(crate) set_up: bool,
    pub(crate) aircraft_loaded: u32,
    pub(crate) flight_loaded: u32,
    pub(crate) pause: u32,
    pub(crate) aircraft_state: Option<u32>,
    pub(crate) status: u32,
}

impl SimService {
    pub(crate) fn me(&self) -> UnitId {
        self.me
            .expect("the service should know its own unit once it has registered")
    }

    pub(crate) fn is_open(&self, unit: UnitId) -> bool {
        self.holders
            .get(&unit.place())
            .is_some_and(|h| h.current.is_some())
    }

    /// Whether `unit`'s connection is open and has had its open's result.
    pub(crate) fn is_ready(&self, unit: UnitId) -> bool {
        self.holders
            .get(&unit.place())
            .and_then(|h| h.current.as_ref())
            .is_some_and(|c| c.open)
    }

    /// Whether a run of the sim is live: its process found, and no quit message yet.
    pub(crate) fn running(&self) -> bool {
        self.process.is_some() && !self.quit
    }

    /// The client of `unit`'s connection, which a call that's about to be made reads its
    /// IDs from. `None` when there's no sim to call, and then the call fails at once, so
    /// nothing it would have set up waits for the next connection.
    pub(crate) fn client(&mut self, origin: Origin, cx: &Cx) -> Option<&mut Client<Origin>> {
        if !self.running() {
            if let Some(call) = origin.handle {
                self.tell(origin.unit, SimEvent::Failed { call }, cx);
            }
            return None;
        }
        if !self.is_open(origin.unit) {
            self.open(origin.unit, cx);
        }
        self.holders
            .get_mut(&origin.unit.place())
            .map(|h| &mut h.client)
    }

    /// Opens a new connection for `unit`, numbered by the unit's own count of opens.
    pub(crate) fn open(&mut self, unit: UnitId, cx: &Cx) {
        let holder = self
            .holders
            .entry(unit.place())
            .or_insert_with(|| Holder::new(unit, 0));
        holder.opens += 1;
        let connection = Connection {
            unit: unit.place(),
            open: holder.opens,
        };
        holder.current = Some(Conn {
            connection,
            open: false,
            pending: Vec::new(),
            sent: VecDeque::new(),
        });
        cx.out(SimCall::Open {
            connection,
            name: "Dual Input".into(),
        });
    }

    /// The holder whose current connection is `connection`, or `None` for a connection the
    /// service closed or never opened, whose inputs it drops.
    pub(crate) fn holder_of(&mut self, connection: Connection) -> Option<&mut Holder> {
        self.holders
            .get_mut(&connection.unit)
            .filter(|h| h.current.as_ref().map(|c| c.connection) == Some(connection))
    }

    /// The connection opened. Makes its setup, which a lost connection took with it, then
    /// the calls made while it opened.
    pub(crate) fn opened(&mut self, connection: Connection, cx: &Cx) {
        let Some(holder) = self.holder_of(connection) else {
            return;
        };
        let setup: Vec<(Origin, Op)> = holder.client.setup().to_vec();
        let Some(conn) = holder.current.as_mut() else {
            return;
        };
        conn.open = true;
        let pending = std::mem::take(&mut conn.pending);
        for (origin, op) in setup.into_iter().chain(pending) {
            self.send(connection, origin, op, cx);
        }
    }

    /// Makes `ops` on `origin`'s connection, which `client` opened if it was closed. While it
    /// opens, the calls that set nothing up wait, and the setup goes out with the rest of
    /// the connection's setup as it opens.
    pub(crate) fn make(&mut self, origin: Origin, ops: Vec<Op>, cx: &Cx) {
        let Some(holder) = self.holders.get_mut(&origin.unit.place()) else {
            return;
        };
        let Some(conn) = holder.current.as_mut() else {
            return;
        };
        if !conn.open {
            let setup = holder.client.setup();
            conn.pending.extend(
                ops.into_iter()
                    .filter(|op| !setup.iter().any(|(_, s)| s == op))
                    .map(|op| (origin, op)),
            );
            return;
        }
        let connection = conn.connection;
        for op in ops {
            self.send(connection, origin, op, cx);
        }
    }

    /// `unit`'s connection is gone: lost, quit, or with the sim's process. The calls waiting
    /// for it fail, and the unit hears that what it set up in the sim went with it.
    pub(crate) fn gone(&mut self, unit: UnitId, cx: &Cx) {
        let Some(holder) = self.holders.get_mut(&unit.place()) else {
            return;
        };
        let Some(conn) = holder.current.take() else {
            return;
        };
        for tag in conn.sent {
            holder.tags.remove(&tag);
        }
        // The objects went with the connection, and the answers it was waiting for with them.
        holder.creates.clear();
        holder.objects.clear();
        holder.cameras.clear();
        for (origin, _) in conn.pending {
            if let Some(call) = origin.handle {
                self.tell(origin.unit, SimEvent::Failed { call }, cx);
            }
        }
        if unit != self.me() {
            self.tell(unit, SimEvent::Lost, cx);
        }
    }

    /// Closes `unit`'s connection on purpose, as its profile unloads: removes each object it
    /// created first, on the same connection, since the SDK says a close removes them but only
    /// a killed client has been measured to (record/areas/architecture/02-code-map.md, "A
    /// connection for each feature, for each load"), then forgets its setup. The unit hears
    /// no loss, since it asked for nothing to outlive its profile.
    pub(crate) fn close(&mut self, unit: UnitId, cx: &Cx) {
        let Some(holder) = self.holders.get_mut(&unit.place()) else {
            return;
        };
        let objects: Vec<u32> = std::mem::take(&mut holder.objects).into_iter().collect();
        let origin = Origin { unit, handle: None };
        let removes: Vec<Op> = objects
            .into_iter()
            .map(|o| holder.client.remove(o))
            .collect();
        let connection = holder.current.as_ref().map(|c| c.connection);
        self.make(origin, removes, cx);
        if let Some(connection) = connection {
            cx.out(SimCall::Close { connection });
        }
        if let Some(conn) = self
            .holders
            .get_mut(&unit.place())
            .and_then(|h| h.current.take())
        {
            for (origin, _) in conn.pending {
                if let Some(call) = origin.handle {
                    self.tell(origin.unit, SimEvent::Failed { call }, cx);
                }
            }
        }
        self.forget(unit);
    }

    /// Forgets `unit`'s setup, once its connection is gone, so its next call opens an empty
    /// connection. The next one numbers on from the last, so an input still on its way for
    /// an old one is dropped.
    pub(crate) fn forget(&mut self, unit: UnitId) {
        if let Some(holder) = self.holders.get_mut(&unit.place()) {
            *holder = Holder::new(unit, holder.opens);
        }
    }

    /// Puts out one call on an open connection, tagged, so an exception it causes finds it.
    fn send(&mut self, connection: Connection, origin: Origin, op: Op, cx: &Cx) {
        let Some(holder) = self.holders.get_mut(&connection.unit) else {
            return;
        };
        let tag = holder.next_tag;
        holder.next_tag += 1;
        holder.tags.insert(tag, origin);
        if let Some(conn) = holder.current.as_mut() {
            conn.sent.push_back(tag);
            if conn.sent.len() > RECENT
                && let Some(old) = conn.sent.pop_front()
            {
                holder.tags.remove(&old);
            }
        }
        cx.out(SimCall::On {
            connection,
            tag: Tag(tag),
            op,
        });
    }

    /// Hands `event` to `unit`'s `on_sim` handler, once this handler returns.
    pub(crate) fn tell(&self, unit: UnitId, event: SimEvent, cx: &Cx) {
        match self.hooks.get(&unit.place()) {
            Some(hook) => cx.call_handler(hook, event),
            None => tracing::debug!(
                unit = unit.place(),
                ?event,
                "a unit with no on_sim handler missed what the sim said"
            ),
        }
    }

    /// The origin of the call `tag` names on `connection`, while the service still holds it.
    pub(crate) fn origin(&self, connection: Connection, tag: Tag) -> Option<Origin> {
        self.holders
            .get(&connection.unit)?
            .tags
            .get(&tag.0)
            .copied()
    }
}
