//! Take-control's messages: the names of its settings and commands, and the slice its part in the
//! EFB app draws from (record/areas/control/01-take-control.md).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::core_helper::Bound;

/// The feature's name: its unit's and its slice's. `NAME` in
/// src/features/take-control/efb/names.ts names it too, so change both together.
pub const NAME: &str = "take-control";

/// The setting that holds the key or button that takes control, a `core_helper::Bound`, or `null`
/// for none. `INPUT` in src/features/take-control/efb/names.ts names it too.
pub const INPUT: &str = "take-control.input";

/// The setting that says whether the binding takes a hold rather than a press. `LONG_PRESS` in
/// src/features/take-control/efb/names.ts names it too.
pub const LONG_PRESS: &str = "take-control.long-press";

/// The command the EFB app's button sends once it has been held, with no arguments. `REQUEST` in
/// src/features/take-control/efb/names.ts names it too.
pub const REQUEST: &str = "take-control.request";

/// The command that turns the next press on or off, with `Bind` as its arguments. `BIND` in
/// src/features/take-control/efb/names.ts names it too.
pub const BIND: &str = "take-control.bind";

/// The arguments of `BIND`. Off also forgets a next press that came, which the part sends once it
/// has written that press into `INPUT`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "take-control/")]
pub struct Bind {
    pub on: bool,
}

/// What the EFB app's part draws, beside the two settings, which it reads from the slice of
/// settings.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "take-control/")]
pub struct TakeControlSlice {
    /// This pilot is in the flight and preflight has ended, the only time the input counts and the
    /// button shows (record/areas/session/01-roles-and-members.md, "The PF").
    pub live: bool,
    /// This pilot holds control.
    pub mine: bool,
    /// Each guard's reason for refusing this pilot control now, so the button says why before it's
    /// pressed. Empty while the request is allowed, while it isn't `live`, and while this pilot
    /// holds control.
    pub denied: Vec<String>,
    /// What taking control does while this core's link to the pilot flying is lost, which a pilot
    /// reaching for the button should read first.
    pub warning: Option<String>,
    /// Bind waits for the next press.
    pub waiting: bool,
    /// The next press that came, which the part writes into `INPUT`.
    pub next_press: Option<Bound>,
}
