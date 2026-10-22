//! The client protocol: what the core and its clients send each other over a WebSocket on
//! 127.0.0.1, each message one JSON object with a `t` tag. The clients are the sim's pages,
//! a cockpit panel's bridge among them, and the desktop app
//! (record/areas/core/02-clients-and-panel-bridge.md, "The protocol").
//!
//! A unit's own bodies, a command's arguments and a `unit` message's body, are JSON here,
//! and each unit reads them into its own types in its module of this crate.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// The CommBus event the core announces its port on, to every page in the sim
/// (record/areas/architecture/02-code-map.md, "Names the sim shares").
pub const ANNOUNCE: &str = "DUALINPUT_CORE_ANNOUNCE";

/// The body of the core's announcement, such as `{"port":51234,"session":false}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct Announce {
    /// The port the core's WebSocket server listens on, on 127.0.0.1.
    pub port: u16,
    /// Whether a session runs, without which a cockpit panel doesn't connect.
    pub session: bool,
}

/// The port file, which the core writes in its data folder once its WebSocket server listens,
/// so the apps outside the sim find it. A crashed core leaves the file behind, and Windows
/// may give its process ID to another process, so a reader matches the ID and the creation
/// time together (decision 014).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct PortFile {
    pub port: u16,
    /// The core's process ID.
    pub process: u32,
    /// The core's process's creation time, the `FILETIME` `GetProcessTimes` gives, in 100ns
    /// since 1601.
    pub created: u64,
}

/// The port file's name in the core's data folder.
pub const PORT_FILE: &str = "port.json";

/// The components, as each names itself in its `hello`.
pub mod component {
    /// A cockpit panel's bridge, which our `VCockpit.js` loads into every cockpit panel.
    pub const PANEL_BRIDGE: &str = "panel-bridge";
}

/// A client's first message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct Hello {
    pub component: String,
    pub version: String,
    /// The message crate's hash, `HASH`, as the client's build has it.
    pub hash: String,
    /// A cockpit panel's name, which the sim gives each panel as it loads a flight, such as
    /// `VCockpit66`, and which no other panel of the load shares. A `hello` naming a panel
    /// another socket holds replaces that socket, as a reloaded panel's does, where two
    /// panels can hold instruments of one key, as two of the Black Square Baron's each hold
    /// `GNS_DISABLED`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub panel: Option<String>,
    /// A cockpit panel's instruments, each by its key: its identifier, or its tag's name,
    /// then `|` and its `url` attribute's query where it has one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(optional, as = "Option<Vec<String>>")]
    pub instruments: Vec<String>,
}

/// What a client sends the core.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "clients/")]
pub enum FromClient {
    Hello(Hello),
    /// Sent every 2s, whatever else the client sends.
    Alive,
    /// The slices of client state the client shows, after its `hello` and whenever that
    /// changes.
    Watch {
        slices: Vec<String>,
    },
    /// A command by name, which the core answers with an `answer` of the same ID.
    Command {
        id: u32,
        name: String,
        args: Value,
    },
    /// A message to a unit by its name, such as a panel module's to its feature.
    Unit {
        unit: String,
        body: Value,
    },
}

/// What the core sends a client.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "clients/")]
pub enum ToClient {
    /// Sent every 2s, whatever else the core sends.
    Alive,
    /// One slice's whole value.
    State { slice: String, value: Value },
    /// Whether the command with this ID was taken: `error` is `None` when it was. What a
    /// command led to shows in state.
    Answer {
        id: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        error: Option<String>,
    },
    /// A message from a unit, by the unit's name.
    Unit { unit: String, body: Value },
    /// To a cockpit panel: the panel modules to load, each with the instruments it gets.
    Load { modules: Vec<PanelModule> },
    /// To a cockpit panel: the panel modules to stop.
    Stop { modules: Vec<String> },
    /// To a cockpit panel: nothing for it in this session, so it closes its socket.
    None,
    /// The core is quitting, which the apps tell from a crash.
    Bye,
}

/// A panel module a cockpit panel loads, and the instruments of that panel it gets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct PanelModule {
    pub name: String,
    pub instruments: Vec<String>,
}

/// A notice a unit raises for the apps to show, in the slice `notices`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct Notice {
    /// The raising unit's name, then `.` and its own ID for the notice.
    pub id: String,
    pub level: Level,
    /// In the raising feature's own words.
    pub text: String,
    /// The command a click on the notice sends, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub action: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "clients/")]
pub enum Level {
    Information,
    Warning,
    /// Trouble that costs the pilot a feature.
    Trouble,
}

/// The slice `notices`.
pub const NOTICES: &str = "notices";

/// The slice `settings`: each setting an app may offer.
pub const SETTINGS: &str = "settings";

/// The command that changes a setting, from any client, with `SetSetting` as its arguments.
pub const SET_SETTING: &str = "clients.set-setting";

/// A setting as the apps see it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct Setting {
    pub key: String,
    /// In the registering feature's words.
    pub label: String,
    pub kind: SettingKind,
    pub value: Value,
    pub default: Value,
    /// Whether only the registering feature's part shows it, as take-control's binding,
    /// which its section writes after Bind.
    pub part_only: bool,
}

/// A setting's type, with what an app needs to offer it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[ts(export, export_to = "clients/")]
pub enum SettingKind {
    Bool,
    Number { min: f64, max: f64 },
    Text,
    Choice { choices: Vec<String> },
}

impl SettingKind {
    /// Whether `value` fits the type.
    pub fn fits(&self, value: &Value) -> bool {
        match self {
            SettingKind::Bool => value.is_boolean(),
            SettingKind::Number { min, max } => {
                value.as_f64().is_some_and(|n| n >= *min && n <= *max)
            }
            SettingKind::Text => value.is_string(),
            SettingKind::Choice { choices } => value
                .as_str()
                .is_some_and(|s| choices.iter().any(|c| c == s)),
        }
    }
}

/// The arguments of `SET_SETTING`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct SetSetting {
    pub key: String,
    pub value: Value,
}
