//! Authoring's messages: what the profile extension's language server, `dualinput-profile-builder
//! serve`, sends the core's feature `authoring` as commands, the slice `authoring` it watches, and
//! what `authoring` tells its panel module `outline` (record/areas/profiles/04-the-extension-in-the-sim.md,
//! "The connection").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The feature's name: its unit's and its slice's.
pub const NAME: &str = "authoring";

/// The panel module that outlines the display picker's row in the sim, and the name the
/// feature's messages to it go under. `NAME` in src/features/authoring/panel/src/outline.ts names
/// it too, and so does the module's file, panel/outline.ts, so change all three together.
pub const OUTLINE: &str = "outline";

/// Authoring's commands, which only the `profile-extension` client this core serves sends.
pub mod command {
    /// The open files' names, and the open text's bundle when it changed, with `Open`.
    pub const OPEN: &str = "authoring.open";
    /// What the Dual Input panel shows, with `Panel`.
    pub const PANEL: &str = "authoring.panel";
    /// Runs one entry's write, with `Run`.
    pub const RUN: &str = "authoring.run";
}

/// `authoring.open`'s arguments, sent as typing pauses, as files open and close, and again on
/// each new socket.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct Open {
    /// An ID the window's `serve` picks once, which the slice's `window` names while this core
    /// serves that window, so a window whose `serve` connected earlier tells that another has
    /// the sim.
    pub window: String,
    /// Every name call on a `watch:` line of each open file, as the line writes it.
    pub names: Vec<OpenName>,
    /// The open text's bundle of the session's profile, when it differs from the last this
    /// socket sent, and none when it doesn't.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bundle: Option<OpenBundle>,
}

/// One name call on a `watch:` line, such as `L('BKSQ_MixtureLeverPosition_1')`, and how its
/// line watches it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct OpenName {
    pub name: String,
    pub reads: Reads,
}

/// How a line watches its name: a state entry's variable and a counting map's `count:` as a
/// value, and an event entry's event, an `L:` pulse, and a counting map's `inc:`, `dec:`, and
/// `set:` as occurrences.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Reads {
    Value,
    Occurrences,
}

/// The open text's bundle of the session's profile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum OpenBundle {
    /// The bundle's text, as the builder writes it.
    Built { text: String },
    /// The open text doesn't build, with the build's first error, so Run refuses.
    Failed { error: String },
}

/// `authoring.panel`'s arguments: what the Dual Input panel shows.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Panel {
    #[default]
    Nothing,
    /// Run, on the entry `entry`, with the value field's text as `serve` read it, or none while
    /// the field is empty and the entry needs a value.
    Run {
        entry: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        typed: Option<Given>,
    },
    /// The display picker, on the row `active`: a row's key or a shared identifier's heading,
    /// or none before the first row.
    Picker {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        active: Option<String>,
    },
}

/// `authoring.run`'s arguments.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct Run {
    pub entry: String,
    pub given: Given,
}

/// What a Run writes, from the value field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Given {
    Value {
        value: Value,
    },
    /// An event entry's empty field, whose write fires with no value.
    Nothing,
    /// A counting entry's step count, as `+3` or `-2`.
    Steps {
        steps: i32,
    },
}

/// A value as Run and the slice carry it, such as `{"as":"number","value":0.5}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "as", content = "value", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Value {
    Number(f64),
    Text(String),
}

/// The slice `authoring`, which `serve` turns into the editor's boxes, lenses, and panel.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct AuthoringSlice {
    /// The window this core serves, by the ID its `authoring.open` gave, or none before one.
    pub window: Option<String>,
    pub status: Status,
    /// Each name the served window's `authoring.open` named, in its order, once each.
    pub names: Vec<Watched>,
    /// The panel's Run, while it shows one.
    pub run: Option<RunState>,
    /// The last Run's result.
    pub last: Option<RunResult>,
    /// Every open cockpit panel, while the panel shows the picker.
    pub panels: Vec<CockpitPanel>,
}

/// What the status line says.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct Status {
    /// Dual Input's version, which a `profile-extension` client's `hello` has to carry to be
    /// served.
    pub version: String,
    /// Whether this core holds a session.
    pub session: bool,
    /// Whether this pilot is in the session's flight, where live values and Run work.
    pub in_flight: bool,
    /// The aircraft the sim loaded, by its path, as `bksq-aircraft-baronpropress`.
    pub aircraft: Option<String>,
    /// The profile the session flies, once this core has loaded it.
    pub profile: Option<SessionProfile>,
    /// Whether anyone else is in the session.
    pub crew: bool,
    /// Whether this pilot is the pilot flying, without whom Run refuses an entry the pilot
    /// flying owns.
    pub flying: bool,
    /// The pilot flying's name, once the session has one.
    pub pilot_flying: Option<String>,
    pub bundle: BundleState,
}

/// The profile the session flies.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct SessionProfile {
    pub maker: String,
    pub name: String,
    /// The pinned bundle's hash, as 64 hex digits, which tells the open text from the bundle
    /// the crew flies.
    pub hash: String,
    /// Whether the pinned bundle is a local one, from a member's local folder.
    pub local: bool,
}

/// What became of the open text's bundle.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum BundleState {
    /// None has come, or it waits for this pilot to be in the session's flight.
    #[default]
    None,
    /// Run runs it, the bundle with this hash, as 64 hex digits.
    Loaded { hash: String },
    /// Run refuses it, and why.
    Refused { why: String },
}

/// One name the open files watch, and what it got.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct Watched {
    /// The name call, as `authoring.open` gave it.
    pub name: String,
    pub got: Got,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Got {
    /// A name watched as a value that hasn't read yet.
    Waiting,
    Value {
        value: Value,
    },
    /// A name watched as occurrences: how many times it fired since its line was watched, and
    /// the last value it carried, if it carried one.
    Fired {
        times: u32,
        last: Option<f64>,
    },
    /// The sim refused the name, or no panel holds its instrument, in words for the author.
    Error {
        error: String,
    },
}

/// The panel's Run, on one entry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct RunState {
    pub entry: String,
    pub seen: Seen,
    pub preview: Preview,
}

/// The values the entry's watch has read since it was watched.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Seen {
    /// Each value once, in ascending order, at most 8.
    Values { values: Vec<Value> },
    /// More than 8.
    Many,
}

/// What Run sends for the value typed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Preview {
    /// Nothing typed yet, for an entry whose field needs a value.
    Waiting,
    /// The actions in the order Run sends them, none when the write sends nothing.
    Sends { actions: Vec<Planned> },
    /// Why Run can't write it, in words for the author.
    Refused { why: String },
}

/// One action of a write, sent `times` times, `every` apart, such as `1 frame` or `50ms`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct Planned {
    pub action: Action,
    pub times: u64,
    pub every: String,
}

/// An action, its name as the profile writes a name call, such as `L('BKSQ_X')`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Action {
    /// Sets an `L:` or `A:` variable, or calls an input event's preset with a value.
    Set { name: String, value: Value },
    /// Sends a `K:` event with its values.
    Key { name: String, values: Vec<f64> },
    /// Fires an `H:` event, or calls an input event's preset with no value.
    Fire { name: String },
}

/// What came of a Run.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct RunResult {
    /// The Run's number, counting up from 1 for each Run the core took, so a client tells a new
    /// result from the one before it.
    pub run: u32,
    pub entry: String,
    pub outcome: Outcome,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "authoring/")]
pub enum Outcome {
    /// Its actions went to the sim.
    Taken,
    /// Nothing went, and why, in words for the author.
    Refused { why: String },
    /// The watch's value left its reading from before the Run and came back to it, `after_ms`
    /// after the Run's last action.
    Reverted { to: Value, after_ms: u32 },
}

/// An open cockpit panel, as its `hello` names it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct CockpitPanel {
    /// The panel's name, as the sim gives it, such as `VCockpit66`.
    pub name: Option<String>,
    /// Its instruments' keys.
    pub instruments: Vec<String>,
}

/// What `authoring` tells a panel's `outline` module: the instruments of the panel to outline,
/// by their keys, which replace those it outlined before, so none clears it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "authoring/")]
pub struct Outline {
    pub instruments: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `serve` and the bench's fake write these by hand, so their shapes are held here.
    #[test]
    fn the_commands_read_as_serve_writes_them() {
        let open: Open = serde_json::from_str(
            r#"{"window":"w1","names":[{"name":"L('A')","reads":"value"}],"bundle":{"t":"built","text":"maker: x"}}"#,
        )
        .expect("an open should read");
        assert_eq!(open.names[0].reads, Reads::Value);
        assert_eq!(
            open.bundle,
            Some(OpenBundle::Built {
                text: "maker: x".into()
            })
        );
        let unchanged: Open = serde_json::from_str(r#"{"window":"w1","names":[]}"#)
            .expect("an open with no bundle should read");
        assert_eq!(unchanged.bundle, None);
        let run: Run = serde_json::from_str(
            r#"{"entry":"battery","given":{"t":"value","value":{"as":"number","value":1}}}"#,
        )
        .expect("a run should read");
        assert_eq!(
            run.given,
            Given::Value {
                value: Value::Number(1.0)
            }
        );
        let panel: Panel = serde_json::from_str(r#"{"t":"picker","active":"KX155B"}"#)
            .expect("a panel should read");
        assert_eq!(
            panel,
            Panel::Picker {
                active: Some("KX155B".into())
            }
        );
    }
}
