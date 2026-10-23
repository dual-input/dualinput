//! The sim client, on the core's loop: what crosses the sim seam, the line where the core's
//! code meets SimConnect's own calls and messages. Below the seam sits the sim edge on
//! SimConnect.dll, the bench's stand-in sim, or a replay of the recorded queue, and nothing
//! above it can tell which (record/areas/architecture/02-code-map.md, "The sim seam").
//!
//! Everything that comes up is an input, recorded like any other, so the loop decides
//! when to open a connection and when to try again, and a replay runs a sim's boot and
//! restart too.
//!
//! `Client` keeps what each connection needs on the loop: the IDs it hands out, and the
//! calls that set it up, which it makes again on the next connection. `message` reads what
//! SimConnect hands over.

mod client;
pub mod message;

pub use client::{Area, Client, Period, Value, Var, Watch};

use serde::{Deserialize, Serialize};

/// Names the source the seam's inputs come up under, through `Kernel::source::<Seam>()`.
pub struct Seam;

/// One SimConnect connection: the place of the unit that holds it, and which of that unit's
/// opens it is, so the sim service hands each message to its unit and drops one from a
/// connection it has since closed (record/areas/core/03-sim-seam-and-wasm-module.md,
/// "Connections").
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Connection {
    pub unit: u32,
    pub open: u32,
}

/// A number the sim service gives each call it makes on a connection. The edge keeps it
/// with the call's packet ID, and hands it back with an exception the call caused, since
/// an exception names its call only by that packet ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Tag(pub u64);

/// What the sim's side of the seam hands up, as one input's bytes
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "Its inputs").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Up {
    /// A message SimConnect handed over on a connection, copied whole, starting with its
    /// `SIMCONNECT_RECV` header, which says what kind it is. The sim's quit message comes
    /// up this way too, and the sim service takes it as its connection's loss. An
    /// exception carries the tag of the call that caused it, when the edge still holds
    /// that call's packet ID.
    Message {
        connection: Connection,
        record: Vec<u8>,
        call: Option<Tag>,
    },
    /// What `SimConnect_Open` returned for the connection, an `HRESULT`.
    Opened { connection: Connection, result: i32 },
    /// A call on the connection returned an error.
    Lost { connection: Connection },
    /// The sim's process was found: its ID, and its creation time as a `FILETIME`, in 100ns
    /// since 1601, which together name one run of the sim.
    Found { process: u32, created: u64 },
    /// The sim's process ended, with this exit code.
    Exited { code: u32 },
}

impl Up {
    pub fn encode(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("postcard should encode an input of the seam")
    }

    /// The input `encode` made, or `None` for bytes it couldn't have made.
    pub fn decode(bytes: &[u8]) -> Option<Up> {
        postcard::from_bytes(bytes).ok()
    }
}

/// What the loop asks of the sim's side of the seam: the output type the sim edge, or the
/// stand-in, carries out.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum SimCall {
    /// Looks for the sim's process, which hands up `Up::Found` when there's one and none
    /// is held yet.
    FindProcess,
    /// Opens a connection with `SimConnect_Open`, under `name`, which hands up
    /// `Up::Opened`.
    Open {
        connection: Connection,
        name: String,
    },
    /// Closes a connection with `SimConnect_Close`, which takes everything the connection
    /// set up with it.
    Close { connection: Connection },
    /// Calls one of SimConnect's functions on an open connection.
    On {
        connection: Connection,
        tag: Tag,
        op: Op,
    },
}

/// One call of a SimConnect function, with its arguments owned, so the edge makes it as
/// one call, and the stand-in answers it as the sim would (record/areas/core/
/// 03-sim-seam-and-wasm-module.md, "The sim client"). Each takes the connection's handle
/// first, which the edge holds. When a unit's call needs a function this lacks, add it
/// here, to the edge, and to the stand-in together.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Op {
    /// `SimConnect_MapClientEventToSimEvent`: the sim's event `name`, such as
    /// `FREEZE_ALTITUDE_SET`, under the client event `event`.
    MapClientEventToSimEvent { event: u32, name: String },
    /// `SimConnect_TransmitClientEvent`.
    TransmitClientEvent {
        object: u32,
        event: u32,
        data: u32,
        group: u32,
        flags: u32,
    },
    /// `SimConnect_AddClientEventToNotificationGroup`.
    AddClientEventToNotificationGroup {
        group: u32,
        event: u32,
        maskable: bool,
    },
    /// `SimConnect_SetNotificationGroupPriority`.
    SetNotificationGroupPriority { group: u32, priority: u32 },
    /// `SimConnect_SubscribeToSystemEvent`: the system event `name`, such as
    /// `AircraftLoaded`, under the client event `event`.
    SubscribeToSystemEvent { event: u32, name: String },
    /// `SimConnect_SubscribeToFlowEvent`.
    SubscribeToFlowEvent,
    /// `SimConnect_RequestSystemState`: the state `state`, such as `AircraftLoaded`.
    RequestSystemState { request: u32, state: String },
    /// `SimConnect_AddToDataDefinition`, with no epsilon.
    AddToDataDefinition {
        definition: u32,
        name: String,
        unit: String,
        datatype: i32,
        datum: u32,
    },
    /// `SimConnect_RequestDataOnSimObject`, with no origin, interval, or limit.
    RequestDataOnSimObject {
        request: u32,
        definition: u32,
        object: u32,
        period: i32,
        flags: u32,
    },
    /// `SimConnect_SetDataOnSimObject`, one entry of the definition's values in order.
    SetDataOnSimObject {
        definition: u32,
        object: u32,
        data: Vec<u8>,
    },
    /// `SimConnect_MapClientDataNameToID`.
    MapClientDataNameToId { name: String, area: u32 },
    /// `SimConnect_AddToClientDataDefinition`, from the area's start, with no epsilon.
    AddToClientDataDefinition { definition: u32, size: u32 },
    /// `SimConnect_RequestClientData`, with no origin, interval, or limit.
    RequestClientData {
        area: u32,
        request: u32,
        definition: u32,
        period: i32,
        flags: u32,
    },
    /// `SimConnect_SetClientData`, the whole definition.
    SetClientData {
        area: u32,
        definition: u32,
        data: Vec<u8>,
    },
    /// `SimConnect_CallCommBusEvent`: the CommBus event `name`, to the listeners `broadcast`
    /// names, such as `SIMCONNECT_COMM_BUS_BROADCAST_TO_JS`, with `data` as its text.
    CallCommBusEvent {
        name: String,
        broadcast: u32,
        data: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_input_decodes_to_what_was_encoded() {
        let connection = Connection { unit: 3, open: 2 };
        for up in [
            Up::Message {
                connection,
                record: vec![12, 0, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0],
                call: Some(Tag(7)),
            },
            Up::Opened {
                connection,
                result: i32::MIN,
            },
            Up::Lost { connection },
            Up::Found {
                process: 4_321,
                created: 134_052_000_000_000_000,
            },
            Up::Exited { code: 0xC000_0005 },
        ] {
            assert_eq!(Up::decode(&up.encode()), Some(up));
        }
        assert_eq!(Up::decode(&[0xFF]), None);
    }
}
