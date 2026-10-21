//! The sim client, on the core's loop: what crosses the sim seam, the line where the core's
//! code meets SimConnect's own calls and messages. Below the seam sits the sim edge on
//! SimConnect.dll, the bench's stand-in sim, or a replay of the recorded queue, and nothing
//! above it can tell which (record/areas/architecture/02-code-map.md, "The sim seam").
//!
//! Everything that comes up is an input, recorded like any other, so the loop decides
//! when to open a connection and when to try again, and a replay runs a sim's boot and
//! restart too.

use serde::{Deserialize, Serialize};

/// Names the source the seam's inputs come up under, through `Kernel::source::<Seam>()`.
pub struct Seam;

/// One SimConnect connection. The sim service numbers each one by the place of the unit
/// that holds it and that unit's own count of opens, so a unit that opens fewer in a replay
/// shifts no other unit's numbers (record/areas/core/03-sim-seam-and-wasm-module.md,
/// "Connections").
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Connection {
    pub unit: u32,
    pub open: u32,
}

/// What the sim's side of the seam hands up, as one input's bytes
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "Its inputs").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Up {
    /// A message SimConnect handed over on a connection, copied whole, starting with its
    /// `SIMCONNECT_RECV` header, which says what kind it is. The sim's quit message comes
    /// up this way too, and the sim service takes it as its connection's loss.
    Message {
        connection: Connection,
        record: Vec<u8>,
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
