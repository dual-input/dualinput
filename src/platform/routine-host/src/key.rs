//! The sim's events a routine sends with a value, as `Follow` moves a following aircraft's
//! yoke, pedals, and toe brakes (record/areas/architecture/02-code-map.md, "What a routine can
//! ask for").

/// One of the sim's key events that takes a value. The sim's Events API takes an event's
/// number, which the SDK's headers define, so the module's edge holds each one's number and
/// needs no table of names. When a routine needs another event, add it here, in the edge's
/// `Sim::key` in src/sim-package/wasm-module/src/aircraft.rs, and, for what it moves on the
/// stand-in's aircraft, in `move_control` in src/engines/stand-in-sim/src/sim.rs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    /// `K:AXIS_AILERONS_SET`, −16,383 to 16,383.
    AxisAilerons,
    /// `K:AXIS_ELEVATOR_SET`, −16,383 to 16,383.
    AxisElevator,
    /// `K:AXIS_RUDDER_SET`, −16,383 to 16,383.
    AxisRudder,
    /// `K:AXIS_LEFT_BRAKE_SET`, −16,383 off to 16,383 full.
    AxisLeftBrake,
    /// `K:AXIS_RIGHT_BRAKE_SET`, −16,383 off to 16,383 full.
    AxisRightBrake,
}

impl Key {
    /// The event's name, with no `K:`, as SimConnect and the stand-in name it.
    pub fn name(self) -> &'static str {
        match self {
            Key::AxisAilerons => "AXIS_AILERONS_SET",
            Key::AxisElevator => "AXIS_ELEVATOR_SET",
            Key::AxisRudder => "AXIS_RUDDER_SET",
            Key::AxisLeftBrake => "AXIS_LEFT_BRAKE_SET",
            Key::AxisRightBrake => "AXIS_RIGHT_BRAKE_SET",
        }
    }
}
