//! What the desktop app tells the EFB app over its fixed local port, and what the EFB app asks of it. Updates stay out of
//! the core, since an open desktop app window keeps no core running, so the core can't carry their state
//! (record/areas/interface/decisions.md, "The desktop app tells the EFB app about updates and the firewall over a fixed
//! local port").

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The port on 127.0.0.1 the desktop app serves, under Windows' dynamic range, so nothing Windows hands out holds it. If
/// another program holds it anyway, the EFB app shows no update, and a developer's second desktop app runs without the
/// server. `DESKTOP_PORT` in src/platform/efb-shell/src/desktop-link.ts names the same port, so change both together.
pub const DESKTOP_PORT: u16 = 47914;

/// The update, as the EFB app's Settings tab shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "kebab-case")]
#[ts(export, export_to = "desktop/")]
pub enum Update {
    /// Up to date, with when it last checked, in the pilot's words, or `None` before a check.
    Current {
        checked: Option<String>,
    },
    Checking,
    /// Downloading `next`, `done` percent of the way.
    Downloading {
        next: String,
        done: u8,
    },
    Ready {
        next: String,
    },
    Failed {
        next: String,
        error: String,
    },
}

/// Whether Windows Firewall lets the core take connections.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "desktop/")]
pub enum Firewall {
    Allows,
    /// The rule is missing, or a block rule names the core, which the header's Fix mends.
    Blocks,
}

/// All the desktop app says, sent whole when a socket opens and again each time it changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "desktop/")]
pub struct DesktopState {
    pub update: Update,
    pub firewall: Firewall,
    pub start_with_windows: bool,
}

/// What the EFB app asks of the desktop app.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "kebab-case")]
#[ts(export, export_to = "desktop/")]
pub enum ToDesktop {
    CheckForUpdates,
    /// Closes the sim, installs the update, and starts the sim again.
    InstallUpdate,
    /// Closes the sim and starts it again, so it loads the add-on this version of Dual Input wrote.
    RestartSim,
    /// Adds the firewall rule, with the UAC prompt.
    FixFirewall,
    SetStartWithWindows {
        on: bool,
    },
}
