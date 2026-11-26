//! What the editor shows of the sim: the boxes after `watch:` lines, which `dualInput/values`
//! carries, and the Dual Input panel's view, which `dualInput/panel` carries
//! (record/areas/profiles/04-the-extension-in-the-sim.md, "Live values" and "The Dual Input
//! panel").
//!
//! The view's types serialize to the JSON src/apps/profile-extension/panel/src/view.ts reads, a
//! `PanelView` without its `palette`, which the extension adds; the test
//! `the_views_serve_sends_are_the_extensions_types` writes some as a TypeScript file that `tsc`
//! checks against view.ts, so change the two together.

use messages::authoring::{self as wire, Given, Got};
use profile_engine::{Name, read_name};
use serde::{Serialize, Serializer};

/// One box, after line `line`, from 0.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct LineBox {
    pub(crate) line: usize,
    pub(crate) text: String,
    pub(crate) kind: BoxKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum BoxKind {
    Value,
    Firing,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct ServerView {
    pub(crate) status: Status,
    pub(crate) unpinned: bool,
    pub(crate) body: Body,
    pub(crate) recorder: Recorder,
}

/// The recorder's island (record/areas/profiles/05-the-recorder.md, "The recorder's island"),
/// from the slice `tape` and the saved check.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Recorder {
    /// Nothing recorded, and Record can start.
    Empty,
    Recording {
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
    },
    Recorded {
        #[serde(rename = "lengthMs")]
        length_ms: u64,
        stopped: Option<Stopped>,
    },
    /// Playback's catch-up, which restores the cockpit.
    PuttingBack {
        #[serde(rename = "lengthMs")]
        length_ms: u64,
    },
    Playing {
        #[serde(rename = "atMs")]
        at_ms: u64,
        #[serde(rename = "lengthMs")]
        length_ms: u64,
    },
    /// Record and Play can't act, and why, with the recording's length when there is one.
    Off {
        why: RecorderOff,
        #[serde(rename = "lengthMs")]
        length_ms: Option<u64>,
    },
}

/// Why the recorder's buttons are off, which the island says only where the status line doesn't
/// (record/areas/profiles/05-the-recorder.md, "When the recorder works").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RecorderOff {
    NoFlight,
    /// In the flight before preflight ends, when the status line already says "In a flight" and
    /// the cockpit stream sends nothing yet.
    Preflight,
    /// Playback's pretend sender would hold back a crewmate's cockpit stream.
    Crew,
    /// The profile is loading, as after a save, until the session flies it.
    Loading,
    /// Playback runs the bundle the session pinned, so the open text has to be it.
    Unsaved,
}

/// What stopped a recording or a playback other than Stop.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Stopped {
    pub(crate) what: Stopping,
    pub(crate) by: StoppedBy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Stopping {
    Recording,
    Playback,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum StoppedBy {
    /// The profile reloaded, as a save reloads it.
    Reload,
    Joined {
        who: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Status {
    NotRunning,
    OtherRelease {
        extension: String,
        #[serde(rename = "dualInput")]
        dual_input: String,
        update: Update,
    },
    OtherWindow,
    NoSession,
    NotInFlight,
    InFlight {
        aircraft: String,
        runs: bool,
        crew: bool,
    },
    /// In the session's flight, in an aircraft no profile covers, named by its `A:TITLE`.
    NoProfile {
        title: String,
        crew: bool,
    },
}

/// The side that's behind, and updates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Update {
    Extension,
    DualInput,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Body {
    Nothing,
    Run { run: RunView },
    Picker { picker: PickerView },
    Add { add: AddView },
}

/// The loaded aircraft, by the path the core matches a profile on, and what in the open profile
/// covers it (record/areas/profiles/07-adding-an-aircraft.md, "The island").
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct AddView {
    pub(crate) title: String,
    pub(crate) folder: String,
    /// Its whole path, or none for an aircraft that gives its folder alone.
    pub(crate) preset: Option<String>,
    pub(crate) cover: Option<AddCover>,
    pub(crate) named: AddNamed,
    pub(crate) variants: Vec<String>,
    pub(crate) suggested: AddSuggested,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct AddCover {
    pub(crate) variant: String,
    pub(crate) by: By,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum By {
    Preset,
    Folder,
}

/// The variant that already names each of the aircraft's paths, if any.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct AddNamed {
    pub(crate) preset: Option<String>,
    pub(crate) folder: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct AddSuggested {
    pub(crate) preset: String,
    pub(crate) folder: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct RunView {
    pub(crate) name: String,
    pub(crate) key: String,
    pub(crate) takes: Takes,
    pub(crate) live: Vec<Reading>,
    pub(crate) field: String,
    pub(crate) seen: Seen,
    pub(crate) preview: Preview,
    pub(crate) refused: Option<Refusal>,
    pub(crate) revert: Option<Revert>,
}

/// What a Run's value field takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Takes {
    Value,
    /// A value or none, for an event entry.
    Event,
    /// A step count, as `+3`, for a counting entry.
    Steps,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Reading {
    pub(crate) of: Option<String>,
    pub(crate) value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) carried: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub(crate) error: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// The values a watch has read, at most 8, or `many`, which view.ts writes as `string[] |
/// "many"`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Seen {
    Values(Vec<String>),
    Many,
}

impl Serialize for Seen {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Seen::Values(values) => values.serialize(s),
            Seen::Many => s.serialize_str("many"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Preview {
    Waiting,
    Sends {
        actions: Vec<Action>,
    },
    Error {
        message: String,
        #[serde(rename = "where")]
        place: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Action {
    pub(crate) does: Does,
    pub(crate) name: String,
    pub(crate) values: Vec<String>,
    pub(crate) times: u64,
    pub(crate) apart: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Does {
    Set,
    Fire,
    Call,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Refusal {
    PilotFlyingOnly {
        #[serde(rename = "pilotFlying")]
        pilot_flying: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Revert {
    pub(crate) to: String,
    #[serde(rename = "afterMs")]
    pub(crate) after_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct PickerView {
    pub(crate) groups: Vec<PickerGroup>,
    pub(crate) active: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum PickerGroup {
    Single {
        row: DisplayRow,
    },
    Shared {
        identifier: String,
        rows: Vec<DisplayRow>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct DisplayRow {
    pub(crate) key: String,
    #[serde(rename = "fullKey")]
    pub(crate) full_key: String,
    pub(crate) panels: u32,
    pub(crate) ticked: bool,
    pub(crate) refused: Option<RowRefusal>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RowRefusal {
    WasmInstrument,
}

/// A number as a box shows it, as fsc-editor showed one: its trailing zeros dropped and at most 3
/// decimals, so `1.000000` reads `1` and a lever's `0.2500001` reads `0.25`
/// (read in fsc-editor, src/renderer/src/lib/live-decorations.ts, `formatValue`).
pub(crate) fn number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        // As an integer, which also writes -0 as 0.
        return format!("{}", n as i64);
    }
    let fixed = format!("{n:.3}");
    let trimmed = fixed.trim_end_matches('0').trim_end_matches('.');
    match trimmed {
        "-0" => "0".to_string(),
        other => other.to_string(),
    }
}

/// Whether a name reads in the unit `Bool`, whose values a box shows as `true` and `false`.
pub(crate) fn boolean(name: &Name) -> bool {
    match name {
        Name::L {
            unit: Some(unit), ..
        }
        | Name::A { unit, .. } => unit.eq_ignore_ascii_case("bool"),
        _ => false,
    }
}

/// A value as a box and the panel's live value show it, in `name`'s unit.
pub(crate) fn shown(value: &wire::Value, name: &Name) -> String {
    match value {
        wire::Value::Number(n) if boolean(name) => (*n != 0.0).to_string(),
        wire::Value::Number(n) => number(*n),
        wire::Value::Text(t) => t.clone(),
    }
}

/// A value as Run's value field takes it back, so a value seen fills the field with what runs.
pub(crate) fn typed(value: &wire::Value) -> String {
    match value {
        wire::Value::Number(n) => number(*n),
        wire::Value::Text(t) => t.clone(),
    }
}

/// The box a watch line's name gets, or none while it waits for its first reading.
pub(crate) fn box_text(got: &Got, name: &Name) -> Option<(String, BoxKind)> {
    match got {
        Got::Waiting => None,
        Got::Value { value } => Some((shown(value, name), BoxKind::Value)),
        Got::Fired { times, last } => {
            let text = match last {
                Some(last) => format!(
                    "×{times}, last {}",
                    shown(&wire::Value::Number(*last), name)
                ),
                None => format!("×{times}"),
            };
            Some((text, BoxKind::Firing))
        }
        Got::Error { error } => Some((error.clone(), BoxKind::Error)),
    }
}

/// The panel's live value of one of an entry's names, or none while it waits.
pub(crate) fn reading(got: &Got, name: &Name, of: Option<&str>) -> Option<Reading> {
    let of = of.map(str::to_string);
    match got {
        Got::Waiting => None,
        Got::Value { value } => Some(Reading {
            of,
            value: shown(value, name),
            carried: None,
            error: false,
        }),
        Got::Fired { times, last } => Some(Reading {
            of,
            value: format!("×{times}"),
            carried: last.map(|l| shown(&wire::Value::Number(l), name)),
            error: false,
        }),
        Got::Error { error } => Some(Reading {
            of,
            value: error.clone(),
            carried: None,
            error: true,
        }),
    }
}

/// What a Run writes from the value field's text, or none for an empty field where the entry
/// needs a value: an event entry's empty field fires with no value, a counting entry's `+3` or
/// `-2` is a step count, and any other text is a number when it reads as one, or else text.
pub(crate) fn given(text: &str, takes: Takes) -> Option<Given> {
    let text = text.trim();
    if text.is_empty() {
        return (takes == Takes::Event).then_some(Given::Nothing);
    }
    if takes == Takes::Steps
        && let Some(steps) = steps(text)
    {
        return Some(Given::Steps { steps });
    }
    let value = match text.parse::<f64>() {
        Ok(n) if n.is_finite() => wire::Value::Number(n),
        _ => wire::Value::Text(text.to_string()),
    };
    Some(Given::Value { value })
}

/// A step count, `+3`, `-2`, or `3`, a whole number with or without its sign.
fn steps(text: &str) -> Option<i32> {
    let digits = text.strip_prefix(['+', '-']).unwrap_or(text);
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.strip_prefix('+').unwrap_or(text).parse().ok()
}

/// One of the sync engine's planned actions as the preview shows it, its name with its prefix, as
/// `L:BKSQ_MixtureLeverPosition_1`.
pub(crate) fn action(planned: &wire::Planned) -> Action {
    let (does, name, values) = match &planned.action {
        wire::Action::Set { name, value } => {
            let input = read_name(name).is_some_and(|n| matches!(n, Name::B { .. }));
            let does = if input { Does::Call } else { Does::Set };
            (does, name, vec![typed(value)])
        }
        wire::Action::Key { name, values } => (
            Does::Fire,
            name,
            values.iter().map(|v| number(*v)).collect(),
        ),
        wire::Action::Fire { name } => {
            let input = read_name(name).is_some_and(|n| matches!(n, Name::B { .. }));
            let does = if input { Does::Call } else { Does::Fire };
            (does, name, Vec::new())
        }
    };
    Action {
        does,
        name: prefixed(name),
        values,
        times: planned.times,
        apart: (planned.times > 1).then(|| planned.every.clone()),
    }
}

/// A name call as the sim names it, `L('X')` as `L:X`, or as it's written when it doesn't read.
fn prefixed(call: &str) -> String {
    match read_name(call) {
        Some(Name::L { name, .. }) => format!("L:{name}"),
        Some(Name::A { name, .. }) => format!("A:{name}"),
        Some(Name::B { name }) => format!("B:{name}"),
        Some(Name::K { name, .. }) => format!("K:{name}"),
        Some(Name::H { name }) => format!("H:{name}"),
        Some(Name::Instrument { key, path, .. }) => format!("{key}.{path}"),
        None => call.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(unit: Option<&str>) -> Name {
        Name::L {
            name: "X".into(),
            unit: unit.map(str::to_string),
        }
    }

    #[test]
    fn a_number_drops_its_trailing_zeros_and_keeps_at_most_3_decimals() {
        for (n, text) in [
            (1.0, "1"),
            (0.25, "0.25"),
            (0.250_000_1, "0.25"),
            (0.123_456, "0.123"),
            (16_272.0, "16272"),
            (-0.000_1, "0"),
            (-0.0, "0"),
            (-2.5, "-2.5"),
            (0.999_9, "1"),
        ] {
            assert_eq!(number(n), text, "{n}");
        }
    }

    #[test]
    fn each_kind_of_reading_gets_its_box() {
        let number = |n| Got::Value {
            value: wire::Value::Number(n),
        };
        assert_eq!(
            box_text(&number(0.82), &l(None)),
            Some(("0.82".into(), BoxKind::Value))
        );
        assert_eq!(
            box_text(&number(1.0), &l(Some("Bool"))),
            Some(("true".into(), BoxKind::Value))
        );
        assert_eq!(
            box_text(&number(0.0), &l(Some("bool"))),
            Some(("false".into(), BoxKind::Value))
        );
        let text = Got::Value {
            value: wire::Value::Text("KJFK".into()),
        };
        assert_eq!(
            box_text(&text, &l(None)),
            Some(("KJFK".into(), BoxKind::Value))
        );
        let fired = Got::Fired {
            times: 3,
            last: Some(16_272.0),
        };
        assert_eq!(
            box_text(&fired, &l(None)),
            Some(("×3, last 16272".into(), BoxKind::Firing))
        );
        let bare = Got::Fired {
            times: 0,
            last: None,
        };
        assert_eq!(
            box_text(&bare, &l(None)),
            Some(("×0".into(), BoxKind::Firing))
        );
        let error = Got::Error {
            error: "no panel holds `KX155B_9`".into(),
        };
        assert_eq!(
            box_text(&error, &l(None)),
            Some(("no panel holds `KX155B_9`".into(), BoxKind::Error))
        );
        assert_eq!(box_text(&Got::Waiting, &l(None)), None);
    }

    #[test]
    fn a_runs_text_becomes_what_it_writes() {
        let n = |n| {
            Some(Given::Value {
                value: wire::Value::Number(n),
            })
        };
        assert_eq!(given("", Takes::Event), Some(Given::Nothing));
        assert_eq!(given("  ", Takes::Value), None);
        assert_eq!(given("", Takes::Steps), None);
        assert_eq!(given("+3", Takes::Steps), Some(Given::Steps { steps: 3 }));
        assert_eq!(given("-2", Takes::Steps), Some(Given::Steps { steps: -2 }));
        assert_eq!(given("4", Takes::Steps), Some(Given::Steps { steps: 4 }));
        assert_eq!(given("+3", Takes::Value), n(3.0));
        assert_eq!(given(" 0.5 ", Takes::Value), n(0.5));
        assert_eq!(given("16272", Takes::Event), n(16_272.0));
        assert_eq!(
            given("KJFK", Takes::Value),
            Some(Given::Value {
                value: wire::Value::Text("KJFK".into())
            })
        );
        assert_eq!(
            given("inf", Takes::Value),
            Some(Given::Value {
                value: wire::Value::Text("inf".into())
            })
        );
        assert_eq!(
            given("0.5", Takes::Steps),
            n(0.5),
            "the engine refuses a value for a counting entry, in words of its own"
        );
    }

    #[test]
    fn a_planned_action_reads_with_its_prefix_and_its_pace_between_repeats() {
        let planned = |action, times| wire::Planned {
            action,
            times,
            every: "1 frame".into(),
        };
        let set = planned(
            wire::Action::Set {
                name: "L('BKSQ_MixtureLeverPosition_1')".into(),
                value: wire::Value::Number(0.5),
            },
            1,
        );
        assert_eq!(
            action(&set),
            Action {
                does: Does::Set,
                name: "L:BKSQ_MixtureLeverPosition_1".into(),
                values: vec!["0.5".into()],
                times: 1,
                apart: None
            }
        );
        let steps = planned(
            wire::Action::Fire {
                name: "H('kas297b_100_INC')".into(),
            },
            3,
        );
        assert_eq!(action(&steps).does, Does::Fire);
        assert_eq!(action(&steps).apart.as_deref(), Some("1 frame"));
        let preset = planned(
            wire::Action::Fire {
                name: "B('LIGHTING_NAV_1_Toggle')".into(),
            },
            1,
        );
        assert_eq!(
            (action(&preset).does, action(&preset).name),
            (Does::Call, "B:LIGHTING_NAV_1_Toggle".to_string())
        );
        let key = planned(
            wire::Action::Key {
                name: "K('KOHLSMAN_SET')".into(),
                values: vec![16_272.0],
            },
            1,
        );
        assert_eq!(action(&key).values, ["16272"]);
    }
}
