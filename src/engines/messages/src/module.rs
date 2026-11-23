//! What the core and our WASM module trade through the sim's client data areas, the slots:
//! each routine's slot, which the core writes and the module reads, and each routine's report
//! slot and the module's status slot, which the module writes and the core reads
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "Its slots").
//!
//! The module reads a slot in place, as the bytes of a `#[repr(C)]` struct, so the slots'
//! structs live in files named `slots.rs`, which build.rs hashes into `SLOTS_HASH`. A module
//! from another build then ignores a feed whose header carries another hash, rather than
//! reading its bytes as a struct laid out differently.

pub mod slots;

use bytemuck::{Pod, Zeroable};
use slots::{HTML_AND_INPUT_EVENT_BYTES, HtmlAndInputEventsSlot};

/// The name of the module's status slot.
pub const STATUS: &str = "DUALINPUT_MODULE_STATUS";

/// A routine, by the name its slot carries, such as `HOLD` for `DUALINPUT_ROUTINE_HOLD`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RoutineId {
    pub name: &'static str,
    /// Whether it asks the routine host to freeze the aircraft. A module that stopped can't
    /// lift that freeze, so the core lifts it when the last such routine ends
    /// (record/areas/architecture/log.md, 2026-10-23).
    pub freezes: bool,
}

impl RoutineId {
    /// The client data area the core writes the routine's feeds into. `routineWrites` in
    /// tools/bench/cores.ts builds the same name, so change both together.
    pub fn slot(self) -> String {
        format!("DUALINPUT_ROUTINE_{}", self.name)
    }

    /// The client data area the module writes the routine's reports into, which only the
    /// module can write. `REPORT_PREFIX` in src/engines/stand-in-sim/src/lib.rs names the
    /// same prefix, so change both together.
    pub fn report_slot(self) -> String {
        format!("DUALINPUT_REPORT_{}", self.name)
    }
}

/// Preflight's routine, which holds the pilot's aircraft frozen.
pub const HOLD: RoutineId = RoutineId {
    name: "HOLD",
    freezes: true,
};

/// The platform's routine that reads the camera each frame while a feature subscribes to it.
pub const CAMERA: RoutineId = RoutineId {
    name: "CAMERA",
    freezes: false,
};

/// The platform's routine that fires `H:` events, the HTML events, and calls input events'
/// presets, for whichever features act through sim variables.
pub const HTML_AND_INPUT_EVENTS: RoutineId = RoutineId {
    name: "HTML_AND_INPUT_EVENTS",
    freezes: false,
};

/// One event `HtmlAndInputEvents` makes in the sim, in call order.
#[derive(Clone, Debug, PartialEq)]
pub enum HtmlOrInputEvent {
    /// An `H:` event, its name with no `H:`, as an instrument receives it: the L-1011's engineer
    /// panel answers `onInteractionEvent("FUEL")` for `H:FUEL` (read in inibuilds-aircraft-l1011
    /// 1.0.8, html_ui/Pages/VCockpit/Instruments/L1011_COCKPIT/ENGINEER_PANEL/L1011_ENGINEER_PANEL.js).
    H(String),
    /// An input event's preset, its name with no `B:`, with the value `_Set` takes.
    Preset { name: String, value: Option<f64> },
}

impl HtmlOrInputEvent {
    /// How the event is written into a slot, with no 0 byte.
    fn text(&self) -> String {
        match self {
            HtmlOrInputEvent::H(name) => format!("H{name}"),
            HtmlOrInputEvent::Preset { name, value: None } => format!("B{name}"),
            HtmlOrInputEvent::Preset {
                name,
                value: Some(value),
            } => format!("B{name}={value}"),
        }
    }

    fn read(text: &str) -> Option<HtmlOrInputEvent> {
        match text.split_at_checked(1)? {
            ("H", name) => Some(HtmlOrInputEvent::H(name.to_string())),
            ("B", rest) => Some(match rest.split_once('=') {
                Some((name, value)) => HtmlOrInputEvent::Preset {
                    name: name.to_string(),
                    value: Some(value.parse().ok()?),
                },
                None => HtmlOrInputEvent::Preset {
                    name: rest.to_string(),
                    value: None,
                },
            }),
            _ => None,
        }
    }
}

/// `events` as the slots they take, each batch in call order, since a batch longer than one slot
/// goes in several feeds.
pub fn html_and_input_event_slots(events: &[HtmlOrInputEvent]) -> Vec<HtmlAndInputEventsSlot> {
    let mut slots = Vec::new();
    let mut slot: HtmlAndInputEventsSlot = Zeroable::zeroed();
    let mut used = 0;
    for event in events {
        let text = event.text();
        let bytes = text.as_bytes();
        if used + bytes.len() + 1 > HTML_AND_INPUT_EVENT_BYTES && used > 0 {
            slots.push(std::mem::replace(&mut slot, Zeroable::zeroed()));
            used = 0;
        }
        let Some(place) = slot.names.get_mut(used..used + bytes.len()) else {
            continue;
        };
        place.copy_from_slice(bytes);
        used += bytes.len() + 1;
        slot.count += 1;
    }
    if slot.count > 0 {
        slots.push(slot);
    }
    slots
}

/// The events one slot holds, in call order. A name that doesn't read is left out, which only a
/// feed from another build could hold, and a slots hash keeps those out.
pub fn html_and_input_events(slot: &HtmlAndInputEventsSlot) -> Vec<HtmlOrInputEvent> {
    slot.names
        .split(|&b| b == 0)
        .take(usize::from(slot.count))
        .filter_map(|text| HtmlOrInputEvent::read(std::str::from_utf8(text).ok()?))
        .collect()
}

/// The camera's referentials `Camera` reads, which `SimConnect.h` numbers in
/// `SIMCONNECT_POSITION_REFERENTIAL` and `MSFS_Camera.h` in `FsPositionReferential` alike
/// (read in MSFS 2024 SDK 1.8.1): the aircraft's frame, and the world's.
pub const REFERENTIAL_SIMOBJECT: u32 = 1;
pub const REFERENTIAL_WORLD: u32 = 2;

/// What the module writes into its status slot once a second. Its layout never changes,
/// so a core reads the status of a module from any build, and can say which build it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Pod, Zeroable)]
#[repr(C)]
pub struct ModuleStatus {
    /// The module's count of seconds since it started, which stops when the module does.
    pub counter: u64,
    /// The `SLOTS_HASH` of the module's build.
    pub slots_hash: u64,
    /// The module's `VERSION`, padded with zero bytes.
    pub version: [u8; 16],
}

impl ModuleStatus {
    pub fn new(counter: u64, slots_hash: u64, version: &str) -> ModuleStatus {
        let mut padded = [0; 16];
        for (to, from) in padded.iter_mut().zip(version.bytes()) {
            *to = from;
        }
        ModuleStatus {
            counter,
            slots_hash,
            version: padded,
        }
    }

    /// The module's version, as the text it wrote.
    pub fn version(&self) -> String {
        let text = self.version.split(|&b| b == 0).next().unwrap_or_default();
        String::from_utf8_lossy(text).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_reads_back_in_call_order() {
        let events = vec![
            HtmlOrInputEvent::H("FUEL".into()),
            HtmlOrInputEvent::Preset {
                name: "ELECTRICAL_Battery_1_Toggle".into(),
                value: None,
            },
            HtmlOrInputEvent::Preset {
                name: "INSTRUMENT_ALTIMETER_1_Set".into(),
                value: Some(16_272.5),
            },
        ];
        let slots = html_and_input_event_slots(&events);
        assert_eq!(slots.len(), 1);
        assert_eq!(html_and_input_events(&slots[0]), events);
    }

    #[test]
    fn a_batch_longer_than_a_slot_goes_in_several_in_order() {
        let events: Vec<HtmlOrInputEvent> = (0..2_000)
            .map(|i| HtmlOrInputEvent::H(format!("EVENT_{i}")))
            .collect();
        let slots = html_and_input_event_slots(&events);
        assert!(slots.len() > 1);
        let back: Vec<HtmlOrInputEvent> = slots.iter().flat_map(html_and_input_events).collect();
        assert_eq!(back, events);
    }

    #[test]
    fn a_name_too_long_for_a_slot_is_left_out_and_the_rest_go() {
        let events = vec![
            HtmlOrInputEvent::H("X".repeat(HTML_AND_INPUT_EVENT_BYTES + 1)),
            HtmlOrInputEvent::H("FUEL".into()),
        ];
        let back: Vec<HtmlOrInputEvent> = html_and_input_event_slots(&events)
            .iter()
            .flat_map(html_and_input_events)
            .collect();
        assert_eq!(back, [HtmlOrInputEvent::H("FUEL".into())]);
    }
}
