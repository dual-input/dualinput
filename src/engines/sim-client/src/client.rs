//! One connection's bookkeeping on the loop: the IDs it hands out, the calls that set it
//! up, and what turns a unit's call into SimConnect's calls
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim client").

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use simconnect_types::{
    SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET, SIMCONNECT_DATA_REQUEST_FLAG_CHANGED,
    SIMCONNECT_DATA_REQUEST_FLAG_TAGGED, SIMCONNECT_DATATYPE_FLOAT64,
    SIMCONNECT_DATATYPE_STRING256, SIMCONNECT_EVENT_FLAG_GROUPID_IS_PRIORITY,
    SIMCONNECT_GROUP_PRIORITY_HIGHEST, SIMCONNECT_OBJECT_ID_USER, SIMCONNECT_PERIOD_ONCE,
    SIMCONNECT_PERIOD_SIM_FRAME,
};

use crate::message::Data;
use crate::{InitPosition, Op};

/// A string variable's value takes this many bytes, `STRING256`'s.
const TEXT: usize = 256;

/// How many polls a connection keeps waiting for their last answer. A poll whose answers
/// never all came, as when the sim drops some, would otherwise stay for the connection's life,
/// so the oldest past this many is forgotten, and an answer that comes for it after is dropped.
/// Traffic polls three kinds of object twice a second, and drops a poll still out after 2s, so
/// it has 12 out at most; `POLL` and `POLL_WITHIN` in src/features/traffic/core/src/host.rs set
/// those, so change them together.
const OPEN_POLLS: usize = 32;

/// How a request reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Reads {
    /// Every sim frame in which a value changed.
    Changes,
    /// Once, and it's over with its answer.
    Once,
    /// Once on each object of a kind, over with its last object's answer.
    Poll,
}

/// The value of `var` in `bytes` at `at`, which moves past it.
fn value_at(var: &Var, bytes: &[u8], at: &mut usize) -> Option<Value> {
    Some(match var {
        Var::Number { .. } => {
            let value = bytes.get(*at..*at + 8)?;
            *at += 8;
            Value::Number(f64::from_le_bytes(value.try_into().ok()?))
        }
        Var::Text { .. } => {
            let field = bytes.get(*at..*at + TEXT)?;
            *at += TEXT;
            let end = field.iter().position(|&b| b == 0).unwrap_or(TEXT);
            Value::Text(String::from_utf8_lossy(&field[..end]).into_owned())
        }
    })
}

/// A variable a watch reads, named as the sim spells it, such as `A:IS ALTITUDE FREEZE ON`
/// in `bool`, or `L:Battery1Switch` in `number`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Var {
    /// A number, which SimConnect hands over as a `FLOAT64` in `unit`.
    Number { name: String, unit: String },
    /// A string, such as `A:TITLE`, which SimConnect hands over as a `STRING256`.
    Text { name: String },
}

impl Var {
    pub fn number(name: &str, unit: &str) -> Var {
        Var::Number {
            name: name.into(),
            unit: unit.into(),
        }
    }

    pub fn text(name: &str) -> Var {
        Var::Text { name: name.into() }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Number(f64),
    Text(String),
}

/// How often a watch reads its variables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Period {
    /// Once, as traffic reads each new object's identity.
    Once,
    /// Every sim frame in which a value changed.
    OnChange,
}

/// A watch on a connection: the definition that names its variables, the request whose
/// answers carry their values, and the object it reads, which a write through it writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Watch {
    pub request: u32,
    pub definition: u32,
    pub object: u32,
}

impl Watch {
    /// The same definition on `object`, which a write through it writes.
    pub fn on(self, object: u32) -> Watch {
        Watch { object, ..self }
    }
}

/// A client data area on a connection, and the definition that covers it whole.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Area {
    pub area: u32,
    pub definition: u32,
}

/// One connection's IDs and setup. `K` says who asked for each setup call, so the sim
/// service can route an exception the call causes again on a later connection.
pub struct Client<K> {
    next: Next,
    setup: Vec<(K, Op)>,
    definitions: BTreeMap<u32, Vec<Var>>,
    /// Each request a watch or a poll made, by its ID: its definition, and how it reads.
    requests: BTreeMap<u32, (u32, Reads)>,
    /// The polls whose last answer hasn't come, oldest first.
    polls: VecDeque<u32>,
    /// The definition each set of variables read once has, which every later read of the
    /// same set reuses.
    once: BTreeMap<Vec<Var>, u32>,
    /// The client event each sim event is mapped to.
    events: BTreeMap<String, u32>,
    /// The one group `listen` adds its events to, once a first event is in it.
    listening: Option<u32>,
    inputs: Inputs<K>,
}

/// The loaded aircraft's input events on this connection. The sim names each by a hash that
/// only `EnumerateInputEvents` gives, so a `B:` call waits until the list is whole
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim client").
struct Inputs<K> {
    /// The request the list's pages come under, once asked for.
    asked: Option<u32>,
    /// Each name's hash, from the pages so far, under the name in capitals. The sim lists names
    /// in capitals, the Baron 58P's `ELECTRICAL_Battery_1` as `ELECTRICAL_BATTERY_1`, while an
    /// aircraft's files and our profiles spell them as the aircraft declares them (measured on
    /// MSFS 2024, 2026-11-09, record/areas/sync/log.md).
    hashes: BTreeMap<String, u64>,
    /// Whether the last page has come.
    whole: bool,
    /// The calls waiting for the whole list.
    waiting: Vec<(K, String)>,
    /// The hashes already subscribed to, since two entries can read one input event.
    subscribed: BTreeSet<u64>,
}

impl<K> Default for Inputs<K> {
    fn default() -> Self {
        Inputs {
            asked: None,
            hashes: BTreeMap::new(),
            whole: false,
            waiting: Vec::new(),
            subscribed: BTreeSet::new(),
        }
    }
}

/// A call that reads an input event by name, once the connection knows its hash.
#[derive(Debug, PartialEq)]
pub struct InputReady<K> {
    pub by: K,
    pub name: String,
    /// The request its first value comes under and its hash, or `None` for a name the sim
    /// doesn't list.
    pub found: Option<(u32, u64)>,
    pub ops: Vec<Op>,
}

/// What came of asking to read an input event.
#[derive(Debug, PartialEq)]
pub enum InputAsk<K> {
    /// The list isn't whole yet, so the call waits for `input_page`; these calls ask for it.
    Waiting(Vec<Op>),
    Ready(InputReady<K>),
}

/// SimConnect's IDs, each kind counted from 1 on each connection, on the loop, so a replay
/// hands out the same ones. A data definition and a client data area's definition share one
/// count, since whether SimConnect keeps their IDs apart on one connection is unverified, and
/// p08's client gave its areas' definitions IDs apart from its data definitions' (read in
/// experiments/areas/architecture/flight/client/src/main.rs).
#[derive(Default)]
struct Next {
    definition: u32,
    request: u32,
    event: u32,
    group: u32,
    area: u32,
}

fn take(counter: &mut u32) -> u32 {
    *counter += 1;
    *counter
}

impl<K: Clone> Default for Client<K> {
    fn default() -> Self {
        Client {
            next: Next::default(),
            setup: Vec::new(),
            definitions: BTreeMap::new(),
            requests: BTreeMap::new(),
            polls: VecDeque::new(),
            once: BTreeMap::new(),
            events: BTreeMap::new(),
            listening: None,
            inputs: Inputs::default(),
        }
    }
}

impl<K: Clone> Client<K> {
    /// The calls that set the connection up, in the order they were made, which the next
    /// connection after a loss makes again: every call but a read once, a write, and an
    /// event sent (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim client").
    pub fn setup(&self) -> &[(K, Op)] {
        &self.setup
    }

    /// Watches `vars` on the pilot's aircraft, tagged, so each value names its variable by
    /// its place in `vars`. Returns the watch, and the calls that make it.
    pub fn watch(&mut self, by: &K, vars: &[Var], period: Period) -> (Watch, Vec<Op>) {
        self.watch_on(by, SIMCONNECT_OBJECT_ID_USER, vars, period)
    }

    /// Watches `vars` on the object `object`, such as `SIMCONNECT_OBJECT_ID_USER_AVATAR` or an
    /// object the connection created.
    pub fn watch_on(
        &mut self,
        by: &K,
        object: u32,
        vars: &[Var],
        period: Period,
    ) -> (Watch, Vec<Op>) {
        let (definition, mut ops) = self.definition(by, vars, period == Period::Once);
        let request = take(&mut self.next.request);
        let (period_id, flags) = match period {
            Period::Once => (SIMCONNECT_PERIOD_ONCE, SIMCONNECT_DATA_REQUEST_FLAG_TAGGED),
            Period::OnChange => (
                SIMCONNECT_PERIOD_SIM_FRAME,
                SIMCONNECT_DATA_REQUEST_FLAG_TAGGED | SIMCONNECT_DATA_REQUEST_FLAG_CHANGED,
            ),
        };
        let op = Op::RequestDataOnSimObject {
            request,
            definition,
            object,
            period: period_id,
            flags,
        };
        ops.push(match period {
            Period::Once => op,
            Period::OnChange => self.set_up(by, op),
        });
        let reads = match period {
            Period::Once => Reads::Once,
            Period::OnChange => Reads::Changes,
        };
        self.requests.insert(request, (definition, reads));
        (
            Watch {
                request,
                definition,
                object,
            },
            ops,
        )
    }

    /// A definition of `vars` for writing alone, which reads nothing: on the pilot's aircraft,
    /// as a write function's target that no entry watches, or through `Watch::on` on an object
    /// the connection created, as traffic dresses each copy through one definition.
    pub fn define(&mut self, by: &K, vars: &[Var]) -> (Watch, Vec<Op>) {
        let (definition, ops) = self.definition(by, vars, false);
        let watch = Watch {
            request: 0,
            definition,
            object: SIMCONNECT_OBJECT_ID_USER,
        };
        (watch, ops)
    }

    /// Reads `vars` once on each object of `kind` within `radius` meters of the pilot's
    /// aircraft, such as every object within 50m, which lists the C152's seat objects
    /// `SEAT_C152_Pilot` and `SEAT_C152_Pax` (measured on MSFS 2024, 2026-10-02,
    /// record/areas/avatars/log.md, "Seat objects place the other pilot in the cockpit"). The
    /// sim answers once for each object, each answer naming its object and its number among
    /// them, and carries no mark of its poll but the request, so each poll takes a request of
    /// its own, and an answer that comes after the next poll still names its own (read in the FS
    /// Copilot fork, `FsCopilot/Simulation/TrafficDefinitions.cs`, `TrafficReq`). A poll is
    /// forgotten at its last answer, or once `OPEN_POLLS` newer ones wait. Returns the request
    /// its answers carry, and the calls that make it.
    pub fn poll(&mut self, by: &K, kind: i32, radius: u32, vars: &[Var]) -> (u32, Vec<Op>) {
        let (definition, mut ops) = self.definition(by, vars, true);
        let request = take(&mut self.next.request);
        ops.push(Op::RequestDataOnSimObjectType {
            request,
            definition,
            radius,
            kind,
        });
        self.requests.insert(request, (definition, Reads::Poll));
        self.polls.push_back(request);
        while self.polls.len() > OPEN_POLLS {
            if let Some(old) = self.polls.pop_front() {
                self.requests.remove(&old);
            }
        }
        (request, ops)
    }

    /// Whether `request` is a poll still waiting for its last answer.
    pub fn polling(&self, request: u32) -> bool {
        self.requests
            .get(&request)
            .is_some_and(|(_, reads)| *reads == Reads::Poll)
    }

    /// The data definition that names `vars`, tagged, and the calls that make it. A read
    /// once `reuses` the definition of every earlier read of the same set.
    fn definition(&mut self, by: &K, vars: &[Var], reuse: bool) -> (u32, Vec<Op>) {
        if reuse && let Some(&definition) = self.once.get(vars) {
            return (definition, Vec::new());
        }
        let definition = take(&mut self.next.definition);
        let mut ops = Vec::new();
        for (datum, var) in vars.iter().enumerate() {
            let (name, unit, datatype) = match var {
                Var::Number { name, unit } => (name, unit.clone(), SIMCONNECT_DATATYPE_FLOAT64),
                Var::Text { name } => (name, String::new(), SIMCONNECT_DATATYPE_STRING256),
            };
            ops.push(self.set_up(
                by,
                Op::AddToDataDefinition {
                    definition,
                    name: var_name(name).to_string(),
                    unit,
                    datatype,
                    datum: datum as u32,
                },
            ));
        }
        self.definitions.insert(definition, vars.to_vec());
        if reuse {
            self.once.insert(vars.to_vec(), definition);
        }
        (definition, ops)
    }

    /// The values a watch's or a poll's answer carries, each with its place in the
    /// variables, or `None` for data no watch or poll of this connection asked for. A watch
    /// that read once is forgotten with its answer, and a poll with its last, and a poll's
    /// answer that found no object carries no values.
    pub fn values(&mut self, data: &Data) -> Option<Vec<(usize, Value)>> {
        let &(definition, reads) = self.requests.get(&data.request)?;
        let last_of_poll = reads == Reads::Poll && data.entry >= data.out_of;
        if reads == Reads::Once || last_of_poll {
            self.requests.remove(&data.request);
            self.polls.retain(|&r| r != data.request);
        }
        if reads == Reads::Poll && data.out_of == 0 {
            return Some(Vec::new());
        }
        let vars = self.definitions.get(&definition)?;
        let mut at = 0;
        // `SimConnect_RequestDataOnSimObjectType` takes no flags, so its answers hold every
        // variable in the definition's order with no tags, and a tagged read would take a
        // title's first bytes for a tag and lose the whole answer.
        if data.flags & SIMCONNECT_DATA_REQUEST_FLAG_TAGGED == 0 {
            return vars
                .iter()
                .enumerate()
                .map(|(datum, var)| Some((datum, value_at(var, &data.bytes, &mut at)?)))
                .collect();
        }
        let mut values = Vec::new();
        for _ in 0..data.count {
            let datum = u32::from_le_bytes(data.bytes.get(at..at + 4)?.try_into().ok()?) as usize;
            at += 4;
            values.push((datum, value_at(vars.get(datum)?, &data.bytes, &mut at)?));
        }
        Some(values)
    }

    /// Writes `values` into a watch's variables on the object it reads, one for each, in the
    /// watch's order. `None` when they don't match the watch's variables.
    pub fn write(&self, watch: Watch, values: &[Value]) -> Option<Op> {
        let vars = self.definitions.get(&watch.definition)?;
        if vars.len() != values.len() {
            return None;
        }
        let mut data = Vec::new();
        for (var, value) in vars.iter().zip(values) {
            match (var, value) {
                (Var::Number { .. }, Value::Number(n)) => data.extend_from_slice(&n.to_le_bytes()),
                (Var::Text { .. }, Value::Text(t)) => {
                    let mut field = [0; TEXT];
                    let n = t.len().min(TEXT - 1);
                    field[..n].copy_from_slice(&t.as_bytes()[..n]);
                    data.extend_from_slice(&field);
                }
                _ => return None,
            }
        }
        Some(Op::SetDataOnSimObject {
            definition: watch.definition,
            object: watch.object,
            data,
        })
    }

    /// Sends the sim's event `name`, such as `K:FREEZE_ALTITUDE_SET`, with one value, to the
    /// pilot's aircraft, mapping it first if this connection hasn't.
    pub fn key(&mut self, by: &K, name: &str, data: u32) -> Vec<Op> {
        self.key_on(by, SIMCONNECT_OBJECT_ID_USER, name, data)
    }

    /// Sends the sim's event `name` to the object `object`, as avatars freezes each figure
    /// it creates.
    pub fn key_on(&mut self, by: &K, object: u32, name: &str, data: u32) -> Vec<Op> {
        self.key_values(by, object, name, &[data])
    }

    /// Sends the sim's event `name` with `values`, by the legacy call for one value or none and
    /// by `_EX1` only for more, since the PMDG 777's module dropped a masked axis sent with
    /// `_EX1` and acted on the same event sent with the legacy call (measured on MSFS 2024,
    /// 2026-10-01, record/areas/flight-controls/log.md). Delivery starts at the highest priority,
    /// so our own sends reach the group `listen` adds its events to.
    pub fn key_values(&mut self, by: &K, object: u32, name: &str, values: &[u32]) -> Vec<Op> {
        let (event, mut ops) = self.event(by, name);
        let group = SIMCONNECT_GROUP_PRIORITY_HIGHEST;
        let flags = SIMCONNECT_EVENT_FLAG_GROUPID_IS_PRIORITY;
        ops.push(if values.len() <= 1 {
            Op::TransmitClientEvent {
                object,
                event,
                data: values.first().copied().unwrap_or(0),
                group,
                flags,
            }
        } else {
            let mut data = [0; 5];
            for (to, from) in data.iter_mut().zip(values) {
                *to = *from;
            }
            Op::TransmitClientEventEx1 {
                object,
                event,
                group,
                flags,
                data,
            }
        });
        ops
    }

    /// Hears the sim's event `name` from now on, through one group of the connection's that
    /// never masks, at the highest priority, as FS Copilot hears a profile's `K:` entries
    /// (record/areas/sync/05-units.md, "Reaching the sim"). Returns the client event its
    /// messages carry, and the calls that make it. The sim refused a priority for a group with
    /// no events in it, so the group's first event goes in first (measured on MSFS 2024,
    /// 2026-10-07, record/areas/flight-controls/log.md).
    pub fn listen(&mut self, by: &K, name: &str) -> (u32, Vec<Op>) {
        let (event, mut ops) = self.event(by, name);
        let first = self.listening.is_none();
        let group = match self.listening {
            Some(group) => group,
            None => {
                let group = take(&mut self.next.group);
                self.listening = Some(group);
                group
            }
        };
        ops.push(self.set_up(
            by,
            Op::AddClientEventToNotificationGroup {
                group,
                event,
                maskable: false,
            },
        ));
        if first {
            ops.push(self.set_up(
                by,
                Op::SetNotificationGroupPriority {
                    group,
                    priority: SIMCONNECT_GROUP_PRIORITY_HIGHEST,
                },
            ));
        }
        (event, ops)
    }

    /// Reads the input event `name` once and subscribes to its changes, since subscribing alone
    /// reports nothing until the value changes (measured on MSFS 2024, fsc-editor,
    /// `docs/sim-vars/build/v1-log.md`). The first `B:` call on a connection asks for the list
    /// of input events, and every call waits until it's whole.
    pub fn input(&mut self, by: &K, name: &str) -> InputAsk<K> {
        let name = sim_name(name, "B:").to_string();
        if self.inputs.whole {
            return InputAsk::Ready(self.input_ready(by.clone(), name));
        }
        self.inputs.waiting.push((by.clone(), name));
        if self.inputs.asked.is_some() {
            return InputAsk::Waiting(Vec::new());
        }
        let request = take(&mut self.next.request);
        self.inputs.asked = Some(request);
        let op = self.set_up(by, Op::EnumerateInputEvents { request });
        InputAsk::Waiting(vec![op])
    }

    /// One page of the list of input events. Once the last has come, every waiting call goes.
    /// `dwEntryNumber` counts the sends the list is chopped into, from 0 to `dwOutOf` − 1 (read
    /// in MSFS 2024 SDK 1.7.3, `SimConnect.h`).
    pub fn input_page(
        &mut self,
        request: u32,
        entry: u32,
        out_of: u32,
        events: Vec<crate::message::InputEvent>,
    ) -> Vec<InputReady<K>> {
        if self.inputs.asked != Some(request) || self.inputs.whole {
            return Vec::new();
        }
        for event in events {
            self.inputs
                .hashes
                .insert(event.name.to_ascii_uppercase(), event.hash);
        }
        if entry + 1 < out_of {
            return Vec::new();
        }
        self.inputs.whole = true;
        std::mem::take(&mut self.inputs.waiting)
            .into_iter()
            .map(|(by, name)| self.input_ready(by, name))
            .collect()
    }

    fn input_ready(&mut self, by: K, name: String) -> InputReady<K> {
        let Some(&hash) = self.inputs.hashes.get(&name.to_ascii_uppercase()) else {
            return InputReady {
                by,
                name,
                found: None,
                ops: Vec::new(),
            };
        };
        let request = take(&mut self.next.request);
        let mut ops = vec![Op::GetInputEvent { request, hash }];
        if self.inputs.subscribed.insert(hash) {
            ops.push(self.set_up(&by, Op::SubscribeInputEvent { hash }));
        }
        InputReady {
            by,
            name,
            found: Some((request, hash)),
            ops,
        }
    }

    /// Creates an object of the SimObject `title`. Returns the request its object ID comes
    /// back under. An object goes with its connection, so its creation is no setup.
    pub fn create(&mut self, title: &str, livery: &str, at: InitPosition) -> (u32, Op) {
        let request = take(&mut self.next.request);
        let op = Op::AICreateSimulatedObject {
            title: title.into(),
            livery: livery.into(),
            at,
            request,
        };
        (request, op)
    }

    /// Creates an aircraft or a helicopter of the SimObject `title`, with the tail `tail`, which
    /// no ATC flies. Returns the request its object ID comes back under.
    pub fn create_aircraft(
        &mut self,
        title: &str,
        livery: &str,
        tail: &str,
        at: InitPosition,
    ) -> (u32, Op) {
        let request = take(&mut self.next.request);
        let op = Op::AICreateNonAtcAircraft {
            title: title.into(),
            livery: livery.into(),
            tail: tail.into(),
            at,
            request,
        };
        (request, op)
    }

    /// Takes an object the connection created away from the sim's AI.
    pub fn release(&mut self, object: u32) -> Op {
        let request = take(&mut self.next.request);
        Op::AIReleaseControl { object, request }
    }

    /// Removes an object the connection created.
    pub fn remove(&mut self, object: u32) -> Op {
        let request = take(&mut self.next.request);
        Op::AIRemoveObject { object, request }
    }

    /// Subscribes to the sim's `Frame` event, whose messages carry the client event this
    /// returns.
    pub fn frames(&mut self, by: &K) -> (u32, Op) {
        self.system_event(by, "Frame")
    }

    /// A notification group at `priority` that listens to `events` without masking them,
    /// such as the masking group the platform takes as the sim starts, held open by
    /// `K:SIM_RATE_INCR`. The sim refused a priority for a group with no events in it, so
    /// the events go in first (measured on MSFS 2024, 2026-10-07,
    /// record/areas/flight-controls/log.md).
    pub fn group(&mut self, by: &K, priority: u32, events: &[&str]) -> (u32, Vec<Op>) {
        let group = take(&mut self.next.group);
        let mut ops = Vec::new();
        for name in events {
            let (event, mapped) = self.event(by, name);
            ops.extend(mapped);
            ops.push(self.set_up(
                by,
                Op::AddClientEventToNotificationGroup {
                    group,
                    event,
                    maskable: false,
                },
            ));
        }
        ops.push(self.set_up(by, Op::SetNotificationGroupPriority { group, priority }));
        (group, ops)
    }

    /// Subscribes to the system event `name`, such as `AircraftLoaded`. Returns the client
    /// event its messages carry.
    pub fn system_event(&mut self, by: &K, name: &str) -> (u32, Op) {
        let event = take(&mut self.next.event);
        let op = self.set_up(
            by,
            Op::SubscribeToSystemEvent {
                event,
                name: name.into(),
            },
        );
        (event, op)
    }

    pub fn flow_events(&mut self, by: &K) -> Op {
        self.set_up(by, Op::SubscribeToFlowEvent)
    }

    /// Asks the sim once for the state `name`, such as `AircraftLoaded`. Returns the request
    /// its answer carries.
    pub fn system_state(&mut self, name: &str) -> (u32, Op) {
        let request = take(&mut self.next.request);
        let op = Op::RequestSystemState {
            request,
            state: name.into(),
        };
        (request, op)
    }

    /// The client data area `name`, of `size` bytes, mapped and defined whole.
    pub fn area(&mut self, by: &K, name: &str, size: u32) -> (Area, Vec<Op>) {
        let area = take(&mut self.next.area);
        let definition = take(&mut self.next.definition);
        let ops = vec![
            self.set_up(
                by,
                Op::MapClientDataNameToId {
                    name: name.into(),
                    area,
                },
            ),
            self.set_up(by, Op::AddToClientDataDefinition { definition, size }),
        ];
        (Area { area, definition }, ops)
    }

    /// Reads an area each time its creator writes it. Returns the request its answers carry.
    pub fn read_area(&mut self, by: &K, area: Area) -> (u32, Op) {
        let request = take(&mut self.next.request);
        let op = self.set_up(
            by,
            Op::RequestClientData {
                area: area.area,
                request,
                definition: area.definition,
                period: SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET,
                flags: 0,
            },
        );
        (request, op)
    }

    pub fn write_area(&self, area: Area, data: Vec<u8>) -> Op {
        Op::SetClientData {
            area: area.area,
            definition: area.definition,
            data,
        }
    }

    /// The client event mapped to the sim's event `name`, and the call that maps it when
    /// this connection hasn't yet.
    fn event(&mut self, by: &K, name: &str) -> (u32, Vec<Op>) {
        let name = sim_name(name, "K:");
        if let Some(&event) = self.events.get(name) {
            return (event, Vec::new());
        }
        let event = take(&mut self.next.event);
        self.events.insert(name.to_string(), event);
        let op = self.set_up(
            by,
            Op::MapClientEventToSimEvent {
                event,
                name: name.into(),
            },
        );
        (event, vec![op])
    }

    fn set_up(&mut self, by: &K, op: Op) -> Op {
        self.setup.push((by.clone(), op.clone()));
        op
    }
}

/// The name SimConnect takes for a variable, so `A:TITLE` is `TITLE`, while `L:` stays on.
/// SimConnect reads an environment variable with no prefix too, so `E:IS AVATAR` is `IS AVATAR`,
/// and it answers `NAME_UNRECOGNIZED` to the prefix, which left a pilot on foot seated (measured
/// on MSFS 2024, 2026-11-05, record/areas/avatars/log.md, "The session in the sim").
fn var_name(name: &str) -> &str {
    name.strip_prefix("A:")
        .or_else(|| name.strip_prefix("E:"))
        .unwrap_or(name)
}

/// The name SimConnect takes: a variable's or event's name without the prefix it takes by
/// default, so `K:PAUSE_SET` is `PAUSE_SET`.
fn sim_name<'n>(name: &'n str, default: &str) -> &'n str {
    name.strip_prefix(default).unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::Data;

    #[test]
    fn simconnect_takes_a_variable_with_no_prefix_but_an_l_variable_keeps_its_own() {
        assert_eq!(var_name("A:TITLE"), "TITLE");
        assert_eq!(var_name("E:IS AVATAR"), "IS AVATAR");
        assert_eq!(var_name("L:DUALINPUT_P01"), "L:DUALINPUT_P01");
    }

    #[test]
    fn a_watch_reads_its_tagged_values_by_place() {
        let mut client = Client::<()>::default();
        let vars = [
            Var::number("A:IS ALTITUDE FREEZE ON", "bool"),
            Var::text("A:TITLE"),
        ];
        let (watch, ops) = client.watch(&(), &vars, Period::OnChange);
        assert_eq!(
            ops[0],
            Op::AddToDataDefinition {
                definition: 1,
                name: "IS ALTITUDE FREEZE ON".into(),
                unit: "bool".into(),
                datatype: SIMCONNECT_DATATYPE_FLOAT64,
                datum: 0,
            }
        );
        assert_eq!(client.setup().len(), 3, "a watch on change is all setup");
        let mut bytes = 1u32.to_le_bytes().to_vec();
        let mut title = [0u8; TEXT];
        title[..4].copy_from_slice(b"Asob");
        bytes.extend_from_slice(&title);
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&1.0f64.to_le_bytes());
        let data = Data {
            request: watch.request,
            object: 0,
            definition: watch.definition,
            flags: 2,
            count: 2,
            entry: 1,
            out_of: 1,
            bytes,
        };
        assert_eq!(
            client.values(&data),
            Some(vec![
                (1, Value::Text("Asob".into())),
                (0, Value::Number(1.0))
            ])
        );
    }

    #[test]
    fn a_read_once_reuses_its_definition_and_isnt_setup() {
        let mut client = Client::<()>::default();
        let vars = [Var::number("A:IS ATTITUDE FREEZE ON", "bool")];
        let (first, ops) = client.watch(&(), &vars, Period::Once);
        assert_eq!(ops.len(), 2);
        let (second, ops) = client.watch(&(), &vars, Period::Once);
        assert_eq!(ops.len(), 1, "only the request");
        assert_eq!(first.definition, second.definition);
        assert_ne!(first.request, second.request);
        assert_eq!(client.setup().len(), 1, "only the definition is setup");
    }

    #[test]
    fn a_poll_hears_each_object_shares_a_read_onces_definition_and_ends_at_its_last() {
        let mut client = Client::<()>::default();
        let vars = [Var::text("A:TITLE")];
        let (watch, _) = client.watch(&(), &vars, Period::Once);
        let (request, ops) = client.poll(&(), 1, 50, &vars);
        assert_eq!(
            ops,
            [Op::RequestDataOnSimObjectType {
                request,
                definition: watch.definition,
                radius: 50,
                kind: 1,
            }]
        );
        for (entry, object) in [(1, 0x10), (2, 0x11)] {
            let mut bytes = vec![0; TEXT];
            bytes[..4].copy_from_slice(b"SEAT");
            let data = Data {
                request,
                object,
                definition: watch.definition,
                flags: 0,
                count: 1,
                entry,
                out_of: 2,
                bytes,
            };
            assert!(
                client.polling(request),
                "the poll waits for its last answer"
            );
            assert_eq!(
                client.values(&data),
                Some(vec![(0, Value::Text("SEAT".into()))]),
                "object {object:#x}"
            );
        }
        assert!(!client.polling(request), "and is forgotten with it");
    }

    #[test]
    fn a_poll_that_finds_nothing_ends_and_the_oldest_of_too_many_waiting_go() {
        let mut client = Client::<()>::default();
        let vars = [Var::number("A:IS USER SIM", "bool")];
        let (empty, _) = client.poll(&(), 1, 50, &vars);
        let data = |request| Data {
            request,
            object: 0,
            definition: 0,
            flags: 0,
            count: 1,
            entry: 0,
            out_of: 0,
            bytes: Vec::new(),
        };
        assert_eq!(client.values(&data(empty)), Some(Vec::new()));
        assert!(!client.polling(empty));
        let first = client.poll(&(), 1, 50, &vars).0;
        for _ in 0..OPEN_POLLS {
            client.poll(&(), 1, 50, &vars);
        }
        assert!(
            !client.polling(first),
            "the oldest of too many waiting is forgotten"
        );
        assert_eq!(client.values(&data(first)), None);
    }

    #[test]
    fn an_answer_with_no_tags_holds_every_variable_in_the_definitions_order() {
        let mut client = Client::<()>::default();
        let vars = [
            Var::text("A:TITLE"),
            Var::number("A:PLANE LATITUDE", "degrees"),
        ];
        let (request, _) = client.poll(&(), 1, 50, &vars);
        let definition = client.requests[&request].0;
        let mut bytes = vec![0; TEXT];
        bytes[..4].copy_from_slice(b"SEAT");
        bytes.extend_from_slice(&41.7f64.to_le_bytes());
        let data = Data {
            request,
            object: 0x10,
            definition,
            flags: 0,
            count: 2,
            entry: 1,
            out_of: 1,
            bytes,
        };
        assert_eq!(
            client.values(&data),
            Some(vec![
                (0, Value::Text("SEAT".into())),
                (1, Value::Number(41.7))
            ])
        );
    }

    #[test]
    fn a_key_with_several_values_goes_by_ex1_and_one_or_none_by_the_legacy_call() {
        let mut client = Client::<()>::default();
        let ops = client.key_values(&(), 0, "K:KOHLSMAN_SET", &[16_272, 2]);
        assert!(matches!(
            ops[1],
            Op::TransmitClientEventEx1 {
                data: [16_272, 2, 0, 0, 0],
                ..
            }
        ));
        let none = client.key_values(&(), 0, "K:KOHLSMAN_SET", &[]);
        assert!(matches!(
            none[..],
            [Op::TransmitClientEvent { data: 0, .. }]
        ));
    }

    #[test]
    fn listening_adds_every_event_to_one_group_and_sets_its_priority_once() {
        let mut client = Client::<()>::default();
        let (first, ops) = client.listen(&(), "K:AP_MASTER");
        assert_eq!(ops.len(), 3, "the map, the add, and the priority");
        assert!(
            matches!(ops[2], Op::SetNotificationGroupPriority { group: 1, .. }),
            "the priority comes after the group has an event"
        );
        let (second, ops) = client.listen(&(), "K:TOGGLE_FLIGHT_DIRECTOR");
        assert_ne!(first, second);
        assert_eq!(ops.len(), 2, "the map and the add");
        assert!(matches!(
            ops[1],
            Op::AddClientEventToNotificationGroup {
                group: 1,
                maskable: false,
                ..
            }
        ));
    }

    #[test]
    fn an_input_waits_for_the_whole_list_and_a_name_it_lacks_is_found_missing() {
        use crate::message::InputEvent;
        let mut client = Client::<u8>::default();
        // The aircraft's spelling, which the sim lists in capitals.
        let InputAsk::Waiting(ops) = client.input(&1, "B:LIGHTING_Beacon_1") else {
            panic!("the list isn't known yet");
        };
        let [Op::EnumerateInputEvents { request }] = ops[..] else {
            panic!("the first call asks for the list: {ops:?}");
        };
        assert_eq!(
            client.input(&2, "NOT_ON_THE_LIST"),
            InputAsk::Waiting(Vec::new()),
            "the list is asked for once"
        );
        let page = |name: &str, hash| {
            vec![InputEvent {
                name: name.into(),
                hash,
            }]
        };
        assert!(
            client
                .input_page(request, 0, 2, page("LIGHTING_BEACON_1", 7))
                .is_empty()
        );
        let ready = client.input_page(request, 1, 2, page("LIGHTING_NAV_1", 8));
        assert_eq!(ready.len(), 2);
        assert_eq!(ready[0].by, 1);
        let (get, hash) = ready[0].found.unwrap();
        assert_eq!(hash, 7);
        assert_eq!(
            ready[0].ops,
            [
                Op::GetInputEvent { request: get, hash },
                Op::SubscribeInputEvent { hash }
            ]
        );
        assert_eq!(ready[1].by, 2);
        assert_eq!(ready[1].found, None);
    }

    #[test]
    fn a_key_maps_its_event_once() {
        let mut client = Client::<()>::default();
        assert_eq!(client.key(&(), "K:FREEZE_ALTITUDE_SET", 0).len(), 2);
        let ops = client.key(&(), "K:FREEZE_ALTITUDE_SET", 1);
        assert!(matches!(ops[..], [Op::TransmitClientEvent { data: 1, .. }]));
        assert_eq!(client.setup().len(), 1);
    }
}
