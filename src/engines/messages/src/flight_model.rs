//! Flight-model sync's messages: the sample the flying machine's core sends the crew, and the
//! routines `Lead` and `Follow` in our WASM module
//! (record/areas/flight-model/01-flight-model-sync.md, "The sample").

pub mod slots;

pub use slots::{Sample, Snapshot};

use crate::module::RoutineId;
use crate::net::{Channel, Delivery, OneOff, Wait};

/// The flying machine's samples, as one-off packets of which only the newest waits to go,
/// handed over after the heartbeat's and before avatars' poses
/// (record/areas/network/01-between-machines.md, "Channels" and "Sending"). A sample carries
/// nothing of control: its sender is its PF, since only the flying machine sends them.
pub const SAMPLES: Channel<Sample> = Channel::new(6, Delivery::Newest, 220);

/// How long `Lead` leaves between two reports, in µs, so samples come 20 a second, which puts
/// 8 of them in the 400ms a following machine draws behind.
pub const PERIOD: u64 = 50_000;

impl OneOff for Sample {
    /// A connection is to one member, and only its newest sample is worth sending.
    fn wait(&self) -> Wait {
        Wait::Newest { key: 0 }
    }
}

/// The routine that reads the flying aircraft, about 20 times a second.
pub const LEAD: RoutineId = RoutineId {
    name: "LEAD",
    freezes: false,
};

/// The routine that freezes a following aircraft and draws it from the samples.
pub const FOLLOW: RoutineId = RoutineId {
    name: "FOLLOW",
    freezes: true,
};

#[cfg(test)]
mod tests {
    use super::*;

    /// The design counts a sample under 90 bytes
    /// (record/areas/flight-model/01-flight-model-sync.md, "The sample").
    #[test]
    fn a_sample_is_under_90_bytes_in_postcard() {
        let sample = Sample {
            at: u64::MAX,
            snapshot: Snapshot {
                lat: 0.9,
                lon: -1.2,
                alt: 35_000.0,
                pitch: -0.1,
                bank: 0.5,
                heading: 6.2,
                velocity: [-3.0, 20.0, 352.0],
                rotation: [0.1, -0.2, 0.3],
                surfaces: [i16::MIN, i16::MAX, -16_384],
                brakes: [u16::MAX, 32_767],
                pad: 0,
            },
        };
        let bytes = postcard::to_stdvec(&sample).unwrap();
        assert!(bytes.len() < 90, "{} bytes", bytes.len());
        let back: Sample = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(back, sample);
    }
}
