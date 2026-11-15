//! Traffic's messages: the traffic host's key, each AI object's identity and states, which the
//! traffic host's core sends the crew, the routine `Traffic`, which draws each copy in our WASM
//! module, and the slice the Traffic tab draws from
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "What goes out").

pub mod slots;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::module::RoutineId;
use crate::net::{Channel, Delivery, OneOff, PilotId, Wait};
use crate::session::{Key, Writer};

/// The traffic host, a role's key that any member writes through the Traffic tab's switch,
/// which names the pilot whose AI traffic every other pilot's sim shows
/// (record/areas/interface/decisions.md, "Traffic and ATC audio are shared apart, each by a
/// switch of its own").
pub const HOST: Key<Option<PilotId>> = Key::role(7, Writer::Anyone);

/// Each object's identity, the newest value of each, on a stream below the cockpit's, sent
/// whole again on a new connection (record/areas/network/01-between-machines.md, "Channels").
pub const IDENTITIES: Channel<Identified> = Channel::new(7, Delivery::Stream, 200);

/// Each poll's states, in batches, as one-off packets of which only the newest of each place
/// waits to go, handed over after every other one-off channel's
/// (record/areas/network/01-between-machines.md, "Sending").
pub const STATES: Channel<Batch> = Channel::new(8, Delivery::Newest, 100);

/// The routine that draws every copy each frame, 1s behind the traffic host's reads.
pub const TRAFFIC: RoutineId = RoutineId {
    name: "TRAFFIC",
    freezes: false,
};

/// One object's identity on the identities' stream, keyed by the traffic host's object ID:
/// what a receiving machine creates its copy from, or `None` once the object has gone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identified {
    pub object: u32,
    pub identity: Option<Identity>,
}

/// What the traffic host reads of an object once, as it first sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    /// `A:TITLE`, the SimObject's title, which a create names.
    pub title: String,
    /// `A:LIVERY NAME`, empty for a package that bakes its livery into its title, as FSLTL's do.
    pub livery: String,
    /// `A:ATC ID`, the tail, which a copy takes as its own.
    pub tail: String,
    /// `A:ATC AIRLINE` and `A:ATC FLIGHT NUMBER`.
    pub airline: String,
    pub flight_number: String,
    pub kind: Kind,
}

/// What kind of object a copy is, by the poll that found it, which picks its create.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    Aircraft,
    Helicopter,
    Ground,
}

/// One batch of a poll's states, under 1,162 bytes in postcard, keyed by its place among its
/// poll's batches, so a newer poll's batch at the same place replaces one still waiting.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Batch {
    /// When the batch's earliest state was read, in µs on the traffic host's counter.
    pub base: u64,
    pub place: u8,
    pub states: Vec<State>,
}

impl OneOff for Batch {
    fn wait(&self) -> Wait {
        Wait::Newest {
            key: u64::from(self.place),
        }
    }
}

/// One object at one poll, at FS Copilot's precision, which keeps each field an order below the
/// gate's thresholds, so the wire never brings back motion the gate held back (read in the FS
/// Copilot fork, `FsCopilot/Simulation/TrafficPackets.cs`, `TrafficState.Write`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    /// The traffic host's object ID.
    pub object: u32,
    /// When it was read, in ms after the batch's base.
    pub after_ms: u16,
    /// `A:PLANE LATITUDE` and `A:PLANE LONGITUDE`, in units of 10⁻⁷ degrees, about 1cm.
    pub lat: i32,
    pub lon: i32,
    /// `A:PLANE ALTITUDE`, in feet MSL.
    pub alt: f32,
    /// `A:PLANE HEADING DEGREES TRUE`, `A:PLANE PITCH DEGREES`, and `A:PLANE BANK DEGREES`, in
    /// hundredths of a degree, pitch and bank negative for nose up and right wing down.
    pub heading: u16,
    pub pitch: i16,
    pub bank: i16,
    /// `A:GROUND VELOCITY`, in tenths of a knot, which a create takes as its airspeed.
    pub ground_speed: i16,
    /// `A:VELOCITY BODY X`, `Y`, and `Z`, in tenths of a foot a second.
    pub velocity: [i16; 3],
    /// `A:ROTATION VELOCITY BODY X`, `Y`, and `Z`, in thousandths of a radian a second.
    pub rotation: [i16; 3],
    pub on_ground: bool,
    /// `A:GEAR HANDLE POSITION`, in percent.
    pub gear: u8,
    /// `A:TRAILING EDGE FLAPS LEFT PERCENT`, `RIGHT`, `A:LEADING EDGE FLAPS LEFT PERCENT`, and
    /// `RIGHT`, in percent, the surfaces the original's model draws
    /// (record/areas/traffic-atc/01-traffic-and-atc.md's note of 2026-11-15).
    pub flaps: [u8; 4],
    /// The five light switches, a bit each in `LIGHTS`' order.
    pub lights: u8,
    /// `A:NUMBER OF ENGINES` in the high four bits, and each engine's `A:GENERAL ENG
    /// COMBUSTION`, engine 1 the lowest bit.
    pub engines: u8,
}

/// The light switches a state carries, in the order of its bits, lowest first, the variables
/// the traffic host reads and a copy is written, rather than `LIGHT … ON`, which read on for
/// every parked AI aircraft in FS Copilot's captures (record/areas/traffic-atc/log.md,
/// 2026-11-15).
pub const LIGHTS: [&str; 5] = [
    "A:LIGHT STROBE",
    "A:LIGHT LANDING",
    "A:LIGHT TAXI",
    "A:LIGHT BEACON",
    "A:LIGHT NAV",
];

/// The flap surfaces a state carries, in its order.
pub const FLAPS: [&str; 4] = [
    "A:TRAILING EDGE FLAPS LEFT PERCENT",
    "A:TRAILING EDGE FLAPS RIGHT PERCENT",
    "A:LEADING EDGE FLAPS LEFT PERCENT",
    "A:LEADING EDGE FLAPS RIGHT PERCENT",
];

/// The slice `traffic`, a `TrafficSlice`.
pub const SLICE: &str = "traffic";

/// The command that lists this PC's traffic packs into the slice. It takes no arguments.
pub const LIST_PACKS: &str = "traffic.list-packs";

/// What the Traffic tab shows of the feature's state.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "traffic/")]
pub struct TrafficSlice {
    /// The traffic host's aircraft and helicopters this sim shows as a stand-in or not at all,
    /// 0 unless another member is the traffic host and this pilot is in the flight.
    pub missing: u32,
    /// The aircraft and helicopters in this sim that are neither this pilot's nor copies, once
    /// two counts in a row have found some, 0 under the same rule.
    pub others: u32,
    /// This PC's traffic packs, once a page has asked for them.
    pub packs: Option<Vec<Pack>>,
}

/// One traffic pack in a packages folder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "traffic/")]
pub struct Pack {
    /// Its folder's name.
    pub name: String,
    /// Its manifest's `package_version`, or `None` when the manifest names none or won't read.
    pub version: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The design counts about 23 states to a batch under 1,162 bytes, a state at FS Copilot's
    /// precision with each flap surface a byte (record/areas/traffic-atc/01-traffic-and-atc.md's
    /// note of 2026-11-15). postcard writes each integer in as few bytes as its value takes.
    #[test]
    fn a_taxiing_airliners_state_lets_23_fit_a_batch_and_the_largest_takes_60_bytes() {
        let taxiing = State {
            object: 218_644_480,
            after_ms: 480,
            lat: 514_700_000,
            lon: -4_500_000,
            alt: 83.0,
            heading: 27_000,
            pitch: -150,
            bank: 30,
            ground_speed: 150,
            velocity: [0, 0, 253],
            rotation: [0, 12, 0],
            on_ground: true,
            gear: 100,
            flaps: [5, 5, 0, 0],
            lights: 0b1_1100,
            engines: 0x23,
        };
        let one = postcard::to_stdvec(&taxiing).unwrap().len();
        let fit = (crate::net::ONE_OFF_ROOM - 12) / one;
        assert!(fit >= 23, "{one} bytes a state, {fit} to a batch");
        let largest = State {
            object: u32::MAX,
            after_ms: u16::MAX,
            lat: i32::MIN,
            lon: i32::MAX,
            alt: 41_000.0,
            heading: 35_999,
            pitch: i16::MIN,
            bank: i16::MAX,
            ground_speed: i16::MAX,
            velocity: [i16::MIN; 3],
            rotation: [i16::MAX; 3],
            on_ground: true,
            gear: 100,
            flaps: [100; 4],
            lights: 0b1_1111,
            engines: 0x4F,
        };
        let bytes = postcard::to_stdvec(&largest).unwrap();
        assert_eq!(bytes.len(), 60);
        let back: State = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(back, largest);
    }
}
