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
    /// `COMPONENT` in src/platform/panel-bridge/src/start.ts names it too, so change both
    /// together.
    pub const PANEL_BRIDGE: &str = "panel-bridge";
    /// The menu script, which our copy of BlurPage brings into the sim's menu.
    /// src/sim-package/pages/menu.ts names it too, so change both together.
    pub const MENU_SCRIPT: &str = "menu-script";
    /// The desktop app's Rust side.
    pub const DESKTOP: &str = "desktop";
    /// Our app in the sim's EFB. `CoreLink`'s constructor in
    /// src/engines/page-client/src/core-link.ts names it too, so change both together.
    pub const EFB_APP: &str = "efb-app";
    /// The banner's page, in the panel the EFB app's code opens in each flight of a session.
    /// `CoreLink`'s constructor in src/engines/page-client/src/core-link.ts names it too, so
    /// change both together.
    pub const BANNER: &str = "banner";
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

/// A notification a unit raises for the apps to show, in the slice `notifications`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct Notification {
    /// The raising unit's name, then `.` and its own ID for the notification.
    pub id: String,
    pub level: Level,
    /// In the raising feature's own words: the title of its card on the banner.
    pub text: String,
    /// A line under the title, in those words too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    /// The pilot it's about, as 32 hex digits, whose head leads its card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pilot: Option<String>,
    /// That pilot is out of the flight, so their head hangs dim.
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(as = "Option<bool>", optional)]
    pub out: bool,
    /// Something happening now that ends by itself, which a spinner leads.
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(as = "Option<bool>", optional)]
    pub busy: bool,
    /// Shown once rather than held while its cause lasts: its card stays 6s, and the clients
    /// crate takes it out of the slice soon after, so a page that opens later doesn't show it.
    #[serde(default, skip_serializing_if = "is_false")]
    #[ts(as = "Option<bool>", optional)]
    pub once: bool,
    /// The command a click on the notification sends, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub action: Option<String>,
    /// Each thing a card counts, such as the controls that couldn't sync.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[ts(as = "Option<Vec<String>>", optional)]
    pub list: Vec<String>,
    /// Where a click outside its action lands in the EFB app.
    pub landing: Landing,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl Notification {
    /// A held notification with its title alone, whose `id` `clients::notify` fills in.
    pub fn new(level: Level, text: impl Into<String>, landing: Landing) -> Self {
        Self {
            id: String::new(),
            level,
            text: text.into(),
            detail: None,
            pilot: None,
            out: false,
            busy: false,
            once: false,
            action: None,
            list: Vec::new(),
            landing,
        }
    }

    /// Each thing the card counts.
    pub fn list(mut self, list: Vec<String>) -> Self {
        self.list = list;
        self
    }

    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// Says which pilot it's about, by their ID as 32 hex digits.
    pub fn about(mut self, pilot: String) -> Self {
        self.pilot = Some(pilot);
        self
    }

    pub fn out(mut self) -> Self {
        self.out = true;
        self
    }

    pub fn busy(mut self) -> Self {
        self.busy = true;
        self
    }

    pub fn once(mut self) -> Self {
        self.once = true;
        self
    }
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

/// Where a click on a notification lands in the EFB app: where it's explained or acted on, which
/// the raising unit knows (record/areas/interface/decisions.md, "A notification's click opens the
/// EFB app where it's explained or acted on").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "clients/")]
pub enum Landing {
    /// The Session tab, which holds the take-control strip, the crew rows, the checklist, and the
    /// differences.
    Session,
    /// The header, opened on the row that repeats the notification.
    Header,
    /// The Figures tab, which explains seats.
    Figures,
}

/// The slice `notifications`: every notification up, as a list.
pub const NOTIFICATIONS: &str = "notifications";

/// The slice `banner`: `true` while a banner page's socket is open, which the clients crate
/// closes 8s after the page's last message. A closed panel's page is gone while its socket
/// stays open, so the clients crate's close of that socket, not the page's own close, says the
/// banner is gone, and the EFB app's code calls the toolbar again until the slice is `true`
/// (record/areas/interface/01-apps.md, "The banner").
pub const BANNER: &str = "banner";

/// The command for a click on a notification outside its action, from any client, with
/// `NotificationClicked` as its arguments. It sends the EFB app `EfbAppOrder::OpenEfb`.
pub const NOTIFICATION_CLICKED: &str = "clients.notification-clicked";

/// The command that opens our Discord, in the pilot's Discord app if they have it and otherwise
/// in their browser, from any client. It takes no arguments, and the link is the core's to
/// hold, since any add-on's page in the sim can send a command, and a core that opened what it
/// was told would open anything for any of them.
pub const OPEN_DISCORD: &str = "clients.open-discord";

/// Where `OPEN_DISCORD` goes in a browser, which for a pilot not signed in there is a form to
/// create an account.
pub const DISCORD_INVITE: &str = "https://discord.gg/Z8MqaSFczT";

/// Where `OPEN_DISCORD` goes in the Discord app. Discord documents no form for this, so a later
/// app may not take it (measured on Discord 1.0.9266, 2026-11-02, record/areas/interface/log.md,
/// "2026-11-02: A `discord:` link opens an invite in the Discord app, from closed").
pub const DISCORD_APP_INVITE: &str = "discord:///invite/Z8MqaSFczT";

/// The arguments of `NOTIFICATION_CLICKED`. A click carries its card's landing, rather than the
/// core looking it up by the ID, since a notification can clear while the click is on its way,
/// and the banner's preflight summary, whose click lands on the Session tab too, is no
/// notification.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct NotificationClicked {
    /// The notification's full ID, as the slice `notifications` gives it.
    pub id: String,
    pub landing: Landing,
}

/// What the clients crate orders the EFB app to do, in a `unit` message from `clients`, such as
/// `{"t":"open-efb","landing":"header","id":"sim-service.module-stopped"}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "clients/")]
pub enum EfbAppOrder {
    /// Opens the EFB onto our app, after a click on a notification outside its action, and lands
    /// where the click said. `id` is the clicked notification's, which picks the header's row.
    OpenEfb { landing: Landing, id: String },
}

/// The slice `core`, a `CoreSlice`.
pub const CORE: &str = "core";

/// What a client compares or offers of the core itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "clients/")]
pub struct CoreSlice {
    /// Dual Input's version, which the EFB app compares with its own for setup's "Add-on version
    /// mismatch" box (record/areas/interface/decisions.md, "Without the service the EFB app
    /// shows one of three screens, and another version shows setup's box").
    pub version: String,
    /// The message crate's hash, `HASH`, as the core's build has it.
    pub hash: String,
    /// The Windows username, which first-time setup's name field starts with, in a core that
    /// started with setup not yet done.
    pub username: Option<String>,
}

// `SETUP_DONE` and `GUIDE_DONE` in src/platform/efb-shell/src/settings/setting.ts name the
// same two settings, so change both together.

/// The setting that says first-time setup is done, so it shows once.
pub const SETUP_DONE: &str = "app.setup-done";
/// The setting that says the guide on a first visit to home is closed for good.
pub const GUIDE_DONE: &str = "app.guide-done";

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
    Number {
        min: f64,
        max: f64,
    },
    Text,
    /// Text of at most `max` characters, where an app's field stops.
    LimitedText {
        max: u32,
    },
    Choice {
        choices: Vec<String>,
    },
    /// An audio device the pilot picked from the core helper's list, a
    /// `core_helper::DeviceInfo`, or `null` for Windows' default.
    Device,
    /// A key or button the core helper named at the next press, a `core_helper::Bound`, or
    /// `null` for none.
    Input,
    /// A list of relays, each a `net::Relay`.
    Relays,
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
            SettingKind::LimitedText { max } => value
                .as_str()
                .is_some_and(|s| s.chars().count() <= *max as usize),
            SettingKind::Choice { choices } => value
                .as_str()
                .is_some_and(|s| choices.iter().any(|c| c == s)),
            SettingKind::Device => {
                Option::<crate::core_helper::DeviceInfo>::deserialize(value).is_ok()
            }
            SettingKind::Input => Option::<crate::core_helper::Bound>::deserialize(value).is_ok(),
            SettingKind::Relays => Vec::<crate::net::Relay>::deserialize(value).is_ok(),
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
