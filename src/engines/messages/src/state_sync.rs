//! State sync's messages: its cockpit kinds and catch-up step, its routine's slot, its panel
//! modules' messages to the feature and back, and its slice (record/areas/sync/05-units.md,
//! "State sync").

pub mod slots;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cockpit::CockpitKind;
use crate::module::RoutineId;
use crate::sync::Value;
use slots::{NAMED_EVENT_BYTES, NamedEventsSlot};

/// The feature's name: its unit's and its slice's.
pub const NAME: &str = "state-sync";
/// The panel module that hears `H:` events, and the name its messages go under. `NAME` in
/// src/features/state-sync/panel/src/h-events.ts names it too, and so does the module's file,
/// panel/h-events.ts, so change all three together.
pub const H_EVENTS: &str = "h-events";
/// The panel module that reads `instrument()` values, and the name its messages go under.
/// `NAME` in src/features/state-sync/panel/src/instrument-reads.ts names it too, and so does the
/// module's file, panel/instrument-reads.ts, so change all three together.
pub const INSTRUMENT_READS: &str = "instrument-reads";

/// A shared entry's new value, keyed by the entry.
pub const CHANGE: CockpitKind<Value> = CockpitKind::new(20);
/// A value only the flying machine sends, keyed by the entry, which a replay collapses.
pub const PF_CHANGE: CockpitKind<Value> = CockpitKind::new(21);
/// An event entry's firing, with its value if it carried one, keyed by the entry.
pub const FIRED: CockpitKind<Option<Value>> = CockpitKind::new(22);
/// State sync's catch-up step.
pub const STATE: u16 = 20;

/// The routine that fires `H:` events and calls input events' presets.
pub const NAMED_EVENTS: RoutineId = RoutineId {
    name: "NAMED_EVENTS",
    freezes: false,
};

/// One event `NamedEvents` makes in the sim, in call order.
#[derive(Clone, Debug, PartialEq)]
pub enum NamedEvent {
    /// An `H:` event, its name with no `H:`, as an instrument receives it: the L-1011's engineer
    /// panel answers `onInteractionEvent("FUEL")` for `H:FUEL` (read in inibuilds-aircraft-l1011
    /// 1.0.8, html_ui/Pages/VCockpit/Instruments/L1011_COCKPIT/ENGINEER_PANEL/L1011_ENGINEER_PANEL.js).
    H(String),
    /// An input event's preset, its name with no `B:`, with the value `_Set` takes.
    Preset { name: String, value: Option<f64> },
}

impl NamedEvent {
    /// How the event is written into a slot, with no 0 byte.
    fn text(&self) -> String {
        match self {
            NamedEvent::H(name) => format!("H{name}"),
            NamedEvent::Preset { name, value: None } => format!("B{name}"),
            NamedEvent::Preset {
                name,
                value: Some(value),
            } => format!("B{name}={value}"),
        }
    }

    fn read(text: &str) -> Option<NamedEvent> {
        match text.split_at_checked(1)? {
            ("H", name) => Some(NamedEvent::H(name.to_string())),
            ("B", rest) => Some(match rest.split_once('=') {
                Some((name, value)) => NamedEvent::Preset {
                    name: name.to_string(),
                    value: Some(value.parse().ok()?),
                },
                None => NamedEvent::Preset {
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
pub fn named_event_slots(events: &[NamedEvent]) -> Vec<NamedEventsSlot> {
    let mut slots = Vec::new();
    let mut slot: NamedEventsSlot = bytemuck::Zeroable::zeroed();
    let mut used = 0;
    for event in events {
        let text = event.text();
        let bytes = text.as_bytes();
        if used + bytes.len() + 1 > NAMED_EVENT_BYTES && used > 0 {
            slots.push(std::mem::replace(&mut slot, bytemuck::Zeroable::zeroed()));
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
pub fn named_events(slot: &NamedEventsSlot) -> Vec<NamedEvent> {
    slot.names
        .split(|&b| b == 0)
        .take(usize::from(slot.count))
        .filter_map(|text| NamedEvent::read(std::str::from_utf8(text).ok()?))
        .collect()
}

/// What the `h-events` module tells its feature.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct HeardH {
    /// The event's name as the instrument receives it, with no `H:`.
    pub name: String,
    /// The instrument it was aimed at, if the sim named one.
    pub target: Option<String>,
}

/// What the `instrument-reads` module tells its feature.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "state-sync/")]
pub enum FromInstrumentReads {
    /// The module started, serving these instruments, by their keys.
    Started { instruments: Vec<String> },
    /// Each path whose value changed since the last message.
    Read { readings: Vec<PathReading> },
}

/// One path's new reading, by the number `InstrumentPaths` gave it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct PathReading {
    pub number: u32,
    pub reading: Reading,
}

/// What a path read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "as", content = "value", rename_all = "kebab-case")]
#[ts(export, export_to = "state-sync/")]
pub enum Reading {
    Number(f64),
    Text(String),
    /// The path threw, or read something an entry can't hold, and why, which goes out once
    /// until the path reads a value again.
    Error(String),
}

/// What state sync tells the `instrument-reads` module.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct InstrumentPaths {
    pub paths: Vec<InstrumentPath>,
}

/// One value the module reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct InstrumentPath {
    pub number: u32,
    /// The instrument's key, as the module's `start` was given it.
    pub instrument: String,
    pub path: String,
}

/// One row of the pilot flying's preflight checklist: a counted control and the value it starts
/// at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct ChecklistRow {
    pub id: String,
    pub name: String,
    pub default: String,
    pub description: Option<String>,
}

/// The slice `state-sync`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "state-sync/")]
pub struct StateSyncSlice {
    /// The pilot flying's checklist, which is empty for any other pilot and once preflight has
    /// ended.
    pub checklist: Vec<ChecklistRow>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_reads_back_in_call_order() {
        let events = vec![
            NamedEvent::H("FUEL".into()),
            NamedEvent::Preset {
                name: "ELECTRICAL_Battery_1_Toggle".into(),
                value: None,
            },
            NamedEvent::Preset {
                name: "INSTRUMENT_ALTIMETER_1_Set".into(),
                value: Some(16_272.5),
            },
        ];
        let slots = named_event_slots(&events);
        assert_eq!(slots.len(), 1);
        assert_eq!(named_events(&slots[0]), events);
    }

    #[test]
    fn a_batch_longer_than_a_slot_goes_in_several_in_order() {
        let events: Vec<NamedEvent> = (0..2_000)
            .map(|i| NamedEvent::H(format!("EVENT_{i}")))
            .collect();
        let slots = named_event_slots(&events);
        assert!(slots.len() > 1);
        let back: Vec<NamedEvent> = slots.iter().flat_map(named_events).collect();
        assert_eq!(back, events);
    }

    #[test]
    fn a_name_too_long_for_a_slot_is_left_out_and_the_rest_go() {
        let events = vec![
            NamedEvent::H("X".repeat(NAMED_EVENT_BYTES + 1)),
            NamedEvent::H("FUEL".into()),
        ];
        let back: Vec<NamedEvent> = named_event_slots(&events)
            .iter()
            .flat_map(named_events)
            .collect();
        assert_eq!(back, [NamedEvent::H("FUEL".into())]);
    }
}
