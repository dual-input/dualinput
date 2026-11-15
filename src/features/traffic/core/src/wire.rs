//! What the traffic host reads of each object at each poll, how the gate compares two reads,
//! and how a read goes between cores as a state, at FS Copilot's precision
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "Polling" and "What goes out").

use messages::traffic::slots::Entry;
use messages::traffic::{FLAPS, LIGHTS, State};
use object_mirror::Sample;
use sim_service::{InitPosition, Value, Var};

/// One object as one poll read it, in the units each variable is read in: degrees, feet, feet
/// and radians a second, knots, and percent.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Read {
    pub(crate) lat: f64,
    pub(crate) lon: f64,
    pub(crate) alt: f64,
    pub(crate) pitch: f64,
    pub(crate) bank: f64,
    pub(crate) heading: f64,
    pub(crate) velocity: [f64; 3],
    pub(crate) rotation: [f64; 3],
    pub(crate) ground_speed: f64,
    pub(crate) on_ground: bool,
    /// `A:IS USER SIM`, the pilot's own aircraft, which the host never carries.
    pub(crate) user: bool,
    pub(crate) gear: f64,
    pub(crate) flaps: [f64; 4],
    /// The five light switches, a bit each in `LIGHTS`' order.
    pub(crate) lights: u8,
    /// The engines' count in the high four bits, and each one's combustion, engine 1 lowest.
    pub(crate) engines: u8,
}

/// What a poll reads, in `Read`'s order: FS Copilot's state, less `VERTICAL SPEED`, which
/// nothing on a receiving machine writes, with the five light switches and the four flap
/// surfaces in place of its `LIGHT … ON` and `FLAPS HANDLE INDEX`, and `IS USER SIM` (read in the
/// FS Copilot fork, `FsCopilot/Simulation/TrafficDefinitions.cs`, `ObjectState`;
/// record/areas/traffic-atc/01-traffic-and-atc.md's note of 2026-11-15).
pub(crate) fn polled() -> Vec<Var> {
    let mut vars = vec![
        Var::number("A:PLANE LATITUDE", "degrees"),
        Var::number("A:PLANE LONGITUDE", "degrees"),
        Var::number("A:PLANE ALTITUDE", "feet"),
        Var::number("A:PLANE PITCH DEGREES", "degrees"),
        Var::number("A:PLANE BANK DEGREES", "degrees"),
        Var::number("A:PLANE HEADING DEGREES TRUE", "degrees"),
        Var::number("A:VELOCITY BODY X", "feet per second"),
        Var::number("A:VELOCITY BODY Y", "feet per second"),
        Var::number("A:VELOCITY BODY Z", "feet per second"),
        Var::number("A:ROTATION VELOCITY BODY X", "radians per second"),
        Var::number("A:ROTATION VELOCITY BODY Y", "radians per second"),
        Var::number("A:ROTATION VELOCITY BODY Z", "radians per second"),
        Var::number("A:GROUND VELOCITY", "knots"),
        Var::number("A:SIM ON GROUND", "bool"),
        Var::number("A:IS USER SIM", "bool"),
        Var::number("A:GEAR HANDLE POSITION", "percent"),
    ];
    vars.extend(FLAPS.map(|name| Var::number(name, "percent")));
    vars.extend(LIGHTS.map(|name| Var::number(name, "bool")));
    vars.push(Var::number("A:NUMBER OF ENGINES", "number"));
    vars.extend((1..=4).map(|n| Var::number(&format!("A:GENERAL ENG COMBUSTION:{n}"), "bool")));
    vars
}

impl Read {
    /// A poll's answer for one object, each value by its place in `polled`.
    pub(crate) fn of(values: &[(usize, Value)]) -> Read {
        let mut v = [0.0; 30];
        for (place, value) in values {
            if let (Some(slot), Value::Number(n)) = (v.get_mut(*place), value) {
                *slot = *n;
            }
        }
        let bits = |from: usize, count: usize| {
            (0..count).fold(0u8, |bits, i| bits | (u8::from(v[from + i] != 0.0) << i))
        };
        let count = (v[25].clamp(0.0, 15.0) as u8) << 4;
        Read {
            lat: v[0],
            lon: v[1],
            alt: v[2],
            pitch: v[3],
            bank: v[4],
            heading: v[5],
            velocity: [v[6], v[7], v[8]],
            rotation: [v[9], v[10], v[11]],
            ground_speed: v[12],
            on_ground: v[13] != 0.0,
            user: v[14] != 0.0,
            gear: v[15],
            flaps: [v[16], v[17], v[18], v[19]],
            lights: bits(20, 5),
            engines: count | bits(26, 4),
        }
    }

    /// The state that goes out for this read, read `after_ms` after its batch's base.
    pub(crate) fn state(&self, object: u32, after_ms: u16) -> State {
        let tenths = |v: f64| i16_of(v * 10.0);
        State {
            object,
            after_ms,
            lat: (self.lat * 1e7).round() as i32,
            lon: (self.lon * 1e7).round() as i32,
            alt: self.alt as f32,
            heading: ((self.heading.rem_euclid(360.0) * 100.0).round() as u16) % 36_000,
            pitch: i16_of(self.pitch * 100.0),
            bank: i16_of(self.bank * 100.0),
            ground_speed: tenths(self.ground_speed),
            velocity: self.velocity.map(tenths),
            rotation: self.rotation.map(|v| i16_of(v * 1_000.0)),
            on_ground: self.on_ground,
            gear: percent(self.gear),
            flaps: self.flaps.map(percent),
            lights: self.lights,
            engines: self.engines,
        }
    }
}

fn i16_of(v: f64) -> i16 {
    v.round().clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16
}

fn percent(v: f64) -> u8 {
    v.round().clamp(0.0, 100.0) as u8
}

impl Sample for Read {
    /// FS Copilot's thresholds, each an order above the wire's precision: a tenth of a meter,
    /// half a foot, a tenth of a degree, half a knot, and 5% of the gear's travel, or any change
    /// of the on-ground flag, the flaps, the lights, or the engines (read in the FS Copilot
    /// fork, `FsCopilot/Simulation/TrafficGate.cs`, `Changed`). The flaps compare as the
    /// percent that goes out, so a surface moving by less than that sends nothing.
    fn changed(&self, sent: &Read) -> bool {
        let past = |a: f64, b: f64, by: f64| (a - b).abs() > by;
        past(self.lat, sent.lat, 1e-6)
            || past(self.lon, sent.lon, 1e-6)
            || past(self.alt, sent.alt, 0.5)
            || past(self.heading, sent.heading, 0.1)
            || past(self.pitch, sent.pitch, 0.1)
            || past(self.bank, sent.bank, 0.1)
            || past(self.ground_speed, sent.ground_speed, 0.5)
            || past(self.gear, sent.gear, 5.0)
            || self.on_ground != sent.on_ground
            || self.flaps.map(percent) != sent.flaps.map(percent)
            || self.lights != sent.lights
            || self.engines != sent.engines
    }
}

/// A state as a receiving machine reads it back.
pub(crate) struct Unpacked {
    pub(crate) lat: f64,
    pub(crate) lon: f64,
    pub(crate) alt: f64,
    pub(crate) pitch: f32,
    pub(crate) bank: f32,
    pub(crate) heading: f32,
    pub(crate) ground_speed: f64,
    pub(crate) velocity: [f32; 3],
    pub(crate) rotation: [f32; 3],
}

pub(crate) fn unpack(s: &State) -> Unpacked {
    Unpacked {
        lat: f64::from(s.lat) / 1e7,
        lon: f64::from(s.lon) / 1e7,
        alt: f64::from(s.alt),
        pitch: f32::from(s.pitch) / 100.0,
        bank: f32::from(s.bank) / 100.0,
        heading: f32::from(s.heading) / 100.0,
        ground_speed: f64::from(s.ground_speed) / 10.0,
        velocity: s.velocity.map(|v| f32::from(v) / 10.0),
        rotation: s.rotation.map(|v| f32::from(v) / 1_000.0),
    }
}

/// `Traffic`'s entry for the copy `object` at `at`, on this core's counter.
pub(crate) fn entry(object: u32, at: u64, s: &State) -> Entry {
    let u = unpack(s);
    Entry {
        object,
        removed: 0,
        at,
        lat: u.lat,
        lon: u.lon,
        alt: u.alt,
        pitch: u.pitch,
        bank: u.bank,
        heading: u.heading,
        velocity: u.velocity,
        rotation: u.rotation,
        pad: 0,
    }
}

/// Where a create puts a copy: the state's position, attitude, and on-ground flag, and its
/// ground speed as the airspeed (read in the FS Copilot fork,
/// `FsCopilot/Simulation/TrafficReceiver.cs`, `Create`).
pub(crate) fn init_position(s: &State) -> InitPosition {
    let u = unpack(s);
    InitPosition {
        latitude: u.lat,
        longitude: u.lon,
        altitude: u.alt,
        pitch: f64::from(u.pitch),
        bank: f64::from(u.bank),
        heading: f64::from(u.heading),
        on_ground: s.on_ground,
        airspeed: u.ground_speed.max(0.0) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_read_goes_out_at_the_wires_precision_and_comes_back() {
        let values: Vec<(usize, Value)> = [
            47.123_456_78,
            -122.375,
            13.5,
            -1.25,
            0.5,
            359.99,
            0.0,
            0.0,
            25.3,
            0.0,
            0.012,
            0.0,
            15.04,
            1.0,
            0.0,
            100.0,
            20.0,
            20.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            1.0,
            1.0,
            2.0,
            1.0,
            1.0,
            0.0,
            0.0,
        ]
        .into_iter()
        .enumerate()
        .map(|(i, v)| (i, Value::Number(v)))
        .collect();
        assert_eq!(values.len(), polled().len());
        let read = Read::of(&values);
        assert_eq!(read.lights, 0b1_1100, "taxi, beacon, and nav");
        assert_eq!(read.engines, 0x23, "two engines, both burning");
        let state = read.state(9, 40);
        let back = unpack(&state);
        assert!((back.lat - 47.123_456_8).abs() < 1e-9);
        assert!((back.heading - 359.99).abs() < 1e-3);
        assert_eq!(state.flaps, [20, 20, 0, 0]);
        assert_eq!(back.ground_speed, 15.0);
        assert_eq!(back.rotation[1], 0.012);
    }

    #[test]
    fn a_change_past_a_threshold_or_of_a_surface_goes_out() {
        let parked = Read {
            lat: 47.0,
            lon: 8.0,
            ..Read::default()
        };
        let mut nudged = parked;
        nudged.lat += 5e-7;
        assert!(!nudged.changed(&parked), "5cm is held back");
        nudged.lat += 1e-6;
        assert!(nudged.changed(&parked));
        let mut flaps = parked;
        flaps.flaps[0] = 0.4;
        assert!(
            !flaps.changed(&parked),
            "under 1% of a surface sends nothing"
        );
        flaps.flaps[0] = 1.0;
        assert!(flaps.changed(&parked));
        let mut lit = parked;
        lit.lights = 1;
        assert!(lit.changed(&parked));
    }
}
