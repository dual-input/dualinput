//! The aircraft's variables a snapshot holds, which `Lead` reads and `Follow` writes
//! (record/areas/flight-model/01-flight-model-sync.md, "The sample").

use messages::flight_model::Snapshot;
use routine_host::{Pose, USER, VarRef, Wants};

use crate::pose::{brake, surface};

/// Each variable of the pose and the velocities, with the unit the snapshot holds it in, in
/// the snapshot's order.
const PLACED: [(&str, &str); 12] = [
    ("A:PLANE LATITUDE", "radians"),
    ("A:PLANE LONGITUDE", "radians"),
    ("A:PLANE ALTITUDE", "feet"),
    ("A:PLANE PITCH DEGREES", "radians"),
    ("A:PLANE BANK DEGREES", "radians"),
    ("A:PLANE HEADING DEGREES TRUE", "radians"),
    ("A:VELOCITY BODY X", "feet per second"),
    ("A:VELOCITY BODY Y", "feet per second"),
    ("A:VELOCITY BODY Z", "feet per second"),
    ("A:ROTATION VELOCITY BODY X", "radians per second"),
    ("A:ROTATION VELOCITY BODY Y", "radians per second"),
    ("A:ROTATION VELOCITY BODY Z", "radians per second"),
];

/// The control surfaces and the toe brakes, which `Follow` sends as axis events rather than
/// writes.
const CONTROLS: [(&str, &str); 5] = [
    ("A:AILERON POSITION", "position 16k"),
    ("A:ELEVATOR POSITION", "position 16k"),
    ("A:RUDDER POSITION", "position 16k"),
    ("A:BRAKE LEFT POSITION", "position 32k"),
    ("A:BRAKE RIGHT POSITION", "position 32k"),
];

/// The host's places for a snapshot's variables, named at a routine's first frame.
pub(crate) struct Names {
    placed: [VarRef; 12],
    controls: [VarRef; 5],
}

impl Names {
    pub(crate) fn new(want: &mut Wants) -> Option<Names> {
        let mut placed = [VarRef(0); 12];
        for (r, (name, unit)) in placed.iter_mut().zip(PLACED) {
            *r = want.var(name, unit)?;
        }
        let mut controls = [VarRef(0); 5];
        for (r, (name, unit)) in controls.iter_mut().zip(CONTROLS) {
            *r = want.var(name, unit)?;
        }
        Some(Names { placed, controls })
    }

    /// The pilot's aircraft now, or `None` when the sim can't read its pose or its
    /// velocities, since a snapshot with a 0 in place of a latitude would put a following
    /// aircraft in the Gulf of Guinea. A control the sim can't read counts as centered, or a
    /// brake as off.
    pub(crate) fn read(&self, want: &mut Wants) -> Option<Snapshot> {
        let mut placed = [0.0; 12];
        for (v, r) in placed.iter_mut().zip(self.placed) {
            *v = want.read(USER, r)?;
        }
        let controls = self.controls.map(|r| want.read(USER, r).unwrap_or(0.0));
        let [lat, lon, alt, pitch, bank, heading, vx, vy, vz, rx, ry, rz] = placed;
        let [aileron, elevator, rudder, left, right] = controls;
        Some(Snapshot {
            lat,
            lon,
            alt,
            pitch: pitch as f32,
            bank: bank as f32,
            heading: heading as f32,
            velocity: [vx as f32, vy as f32, vz as f32],
            rotation: [rx as f32, ry as f32, rz as f32],
            surfaces: [surface(aileron), surface(elevator), surface(rudder)],
            brakes: [brake(left), brake(right)],
            pad: 0,
        })
    }

    /// Writes the snapshot's pose and both velocities into the pilot's aircraft, once every
    /// routine's frame has run. A frozen aircraft keeps integrating its own velocities, so
    /// the pose alone left a replayed 58P's airspeed 22 kt off within two minutes (measured on
    /// MSFS 2024, 2026-10-03, record/areas/flight-model/log.md, "Written every frame, the
    /// velocities hold").
    pub(crate) fn write(&self, s: &Snapshot, want: &mut Wants) {
        let [vx, vy, vz] = s.velocity.map(f64::from);
        let [rx, ry, rz] = s.rotation.map(f64::from);
        let placed = [
            s.lat,
            s.lon,
            s.alt,
            f64::from(s.pitch),
            f64::from(s.bank),
            f64::from(s.heading),
            vx,
            vy,
            vz,
            rx,
            ry,
            rz,
        ];
        for (r, value) in self.placed.into_iter().zip(placed) {
            want.write(USER, r, value);
        }
        // `Figure` runs after `Follow` and seats its figures on this pose, since a read would
        // give it the pose of the frame before.
        want.place(Pose {
            latitude: s.lat,
            longitude: s.lon,
            altitude: s.alt,
            pitch: f64::from(s.pitch),
            bank: f64::from(s.bank),
            heading: f64::from(s.heading),
        });
    }
}
