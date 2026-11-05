//! One connection's bookkeeping on the loop: the IDs it hands out, the calls that set it
//! up, and what turns a unit's call into SimConnect's calls
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim client").

use std::collections::BTreeMap;

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
    /// Each request a watch made, by its ID: its definition, and whether it reads once.
    requests: BTreeMap<u32, (u32, bool)>,
    /// The definition each set of variables read once has, which every later read of the
    /// same set reuses.
    once: BTreeMap<Vec<Var>, u32>,
    /// The client event each sim event is mapped to.
    events: BTreeMap<String, u32>,
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
            once: BTreeMap::new(),
            events: BTreeMap::new(),
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
        self.requests
            .insert(request, (definition, period == Period::Once));
        (
            Watch {
                request,
                definition,
                object,
            },
            ops,
        )
    }

    /// Reads `vars` once on each object of `kind` within `radius` meters of the pilot's
    /// aircraft, such as every object within 50m, which lists the C152's seat objects
    /// `SEAT_C152_Pilot` and `SEAT_C152_Pax` (measured on MSFS 2024, 2026-10-02,
    /// record/areas/avatars/log.md, "Seat objects place the other pilot in the cockpit"). The
    /// sim answers once for each object, each answer naming its object, so the request stays
    /// until the connection goes. Returns the request its answers carry, and the calls that
    /// make it.
    pub fn read_by_type(&mut self, by: &K, kind: i32, radius: u32, vars: &[Var]) -> (u32, Vec<Op>) {
        let (definition, mut ops) = self.definition(by, vars, true);
        let request = take(&mut self.next.request);
        ops.push(Op::RequestDataOnSimObjectType {
            request,
            definition,
            radius,
            kind,
        });
        self.requests.insert(request, (definition, false));
        (request, ops)
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

    /// The values a watch's answer carries, each with its place in the watch's variables, or
    /// `None` for data no watch of this connection asked for. A watch that read once is
    /// forgotten with its answer.
    pub fn values(&mut self, data: &Data) -> Option<Vec<(usize, Value)>> {
        let &(definition, once) = self.requests.get(&data.request)?;
        if once {
            self.requests.remove(&data.request);
        }
        let vars = self.definitions.get(&definition)?;
        let mut values = Vec::new();
        let mut at = 0;
        for _ in 0..data.count {
            let datum = u32::from_le_bytes(data.bytes.get(at..at + 4)?.try_into().ok()?) as usize;
            at += 4;
            let value = match vars.get(datum)? {
                Var::Number { .. } => {
                    let bytes = data.bytes.get(at..at + 8)?;
                    at += 8;
                    Value::Number(f64::from_le_bytes(bytes.try_into().ok()?))
                }
                Var::Text { .. } => {
                    let field = data.bytes.get(at..at + TEXT)?;
                    at += TEXT;
                    let end = field.iter().position(|&b| b == 0).unwrap_or(TEXT);
                    Value::Text(String::from_utf8_lossy(&field[..end]).into_owned())
                }
            };
            values.push((datum, value));
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
        let (event, mut ops) = self.event(by, name);
        ops.push(Op::TransmitClientEvent {
            object,
            event,
            data,
            group: SIMCONNECT_GROUP_PRIORITY_HIGHEST,
            flags: SIMCONNECT_EVENT_FLAG_GROUPID_IS_PRIORITY,
        });
        ops
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
    fn a_read_by_type_hears_each_object_and_shares_a_read_onces_definition() {
        let mut client = Client::<()>::default();
        let vars = [Var::text("A:TITLE")];
        let (watch, _) = client.watch(&(), &vars, Period::Once);
        let (request, ops) = client.read_by_type(&(), 1, 50, &vars);
        assert_eq!(
            ops,
            [Op::RequestDataOnSimObjectType {
                request,
                definition: watch.definition,
                radius: 50,
                kind: 1,
            }]
        );
        for object in [0x10, 0x11] {
            let mut bytes = 0u32.to_le_bytes().to_vec();
            bytes.extend_from_slice(&[0; TEXT]);
            let data = Data {
                request,
                object,
                definition: watch.definition,
                flags: 2,
                count: 1,
                bytes,
            };
            assert!(client.values(&data).is_some(), "object {object:#x}");
        }
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
