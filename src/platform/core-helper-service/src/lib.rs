//! The core helper's service, the platform's crate that runs the core helper: a program of
//! its own that the core starts, which reads Raw Input and runs the audio, so a crash in that
//! native code costs the pilot those features only until the core starts it again (decision
//! 019). The service keeps each want a feature registered and turned on, runs the helper
//! while any is on, sends it every want whole after each start and each change, and starts
//! it again 2s after it exits (record/areas/core/04-core-helper.md).
//!
//! Register it after the clients crate, whose settings, slice, command, and notices it uses,
//! and before every feature that registers a want with it.

mod edge;
mod hooks;
mod life;

pub use edge::{Pipe, PipeOut, PipeUp};
pub use hooks::{Captured, HelperUnit, Mouse, NextPressed, Press};

use std::collections::BTreeMap;

use clients::{Clients, ClientsUnit, Level, SettingChanged, SettingDef};
use kernel::{Cx, Registry, TimerId, UnitId, View};
use messages::clients::SettingKind;
use messages::core_helper::{
    Bound, Buffer, Capture, DeviceInfo, HelperSlice, LIST, SLICE, ToHelper, WantId, Wants,
};
use serde_json::{Value, json};

use crate::hooks::{Binding, CaptureReg, Owned, SoundReg, StreamReg};

/// The setting that holds the output device the pilot picked, or `null` for Windows'
/// default.
pub const OUTPUT: &str = "core-helper.output";

/// The development setting that names the program the core starts as its helper, which is
/// `dualinput-core-helper.exe` beside the core when it's empty. The bench names its stand-in
/// core helper here (record/areas/build/02-testing.md, "The stand-in core helper").
/// `PROGRAM` in src/apps/core/src/edges/core_helper.rs and this setting's label below name the
/// same file, so change all three together.
pub const PROGRAM: &str = "core-helper.program";

/// The service's state.
#[derive(Default)]
pub struct CoreHelper {
    /// The number the next registration takes. Registrations are numbered in the order units
    /// register, which one build always repeats, so the helper and a replay read them alike.
    next: u16,
    bindings: Vec<Binding>,
    next_press: Vec<Owned<NextPressed>>,
    mouse: Vec<Owned<Mouse>>,
    captures: Vec<CaptureReg>,
    streams: Vec<StreamReg>,
    sounds: Vec<SoundReg>,
    /// The features that have their sounds on, by unit, with each one's name.
    sounds_on: BTreeMap<UnitId, &'static str>,
    /// Whether the desktop app asked for the lists, until the helper answers.
    lists: bool,
    life: life::Life,
    /// The number of the last run started.
    runs: u32,
    /// The wants the running helper was last sent.
    sent: Option<Wants>,
    /// The 5s timer that raises the trouble notice while the helper is down.
    trouble: Option<TimerId>,
    listed: HelperSlice,
    /// The warning raised for each want the helper reported it couldn't carry out.
    failed: BTreeMap<WantId, String>,
}

impl CoreHelper {
    fn number(&mut self) -> u16 {
        let number = self.next;
        self.next = self
            .next
            .checked_add(1)
            .expect("the core helper should have under 2^16 registrations");
        number
    }

    /// Every want that's on, with the bindings' inputs and the output device from their
    /// settings.
    fn wants(&self, clients: &Clients) -> Wants {
        Wants {
            bindings: self
                .bindings
                .iter()
                .filter(|b| b.on.is_some())
                .filter_map(|b| {
                    let bound = clients.setting_as::<Option<Bound>>(b.setting).flatten()?;
                    Some((b.number, bound.input))
                })
                .collect(),
            next_press: self.next_press.iter().any(|o| o.on.is_some()),
            mouse: self.mouse.iter().any(|o| o.on.is_some()),
            captures: self
                .captures
                .iter()
                .filter_map(|c| Some((c.number, c.on.as_ref()?.0.clone())))
                .collect(),
            streams: self
                .streams
                .iter()
                .filter_map(|s| Some((s.number, s.on.as_ref()?.0.clone())))
                .collect(),
            sounds: !self.sounds_on.is_empty(),
            output: clients.setting_as::<Option<DeviceInfo>>(OUTPUT).flatten(),
            lists: self.lists,
        }
    }

    /// The names of the features with a want on, each once, for the trouble notice.
    fn owners(&self) -> Vec<&'static str> {
        let mut owners: Vec<&'static str> = self
            .bindings
            .iter()
            .filter_map(|b| b.on)
            .chain(self.next_press.iter().filter_map(|o| o.on))
            .chain(self.mouse.iter().filter_map(|o| o.on))
            .chain(self.captures.iter().filter_map(|c| Some(c.on.as_ref()?.1)))
            .chain(self.streams.iter().filter_map(|s| Some(s.on.as_ref()?.1)))
            .chain(self.sounds_on.values().copied())
            .collect();
        owners.sort_unstable();
        owners.dedup();
        owners
    }
}

/// Registers the service.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<CoreHelper>("core-helper");
    me.source::<Pipe>(CoreHelper::pipe);
    me.on::<SettingChanged>(CoreHelper::setting_changed)
        .setting(
            OUTPUT,
            SettingDef {
                label: "Where Dual Input plays its sounds and the crew's ATC",
                kind: SettingKind::Device,
                default: Value::Null,
                part_only: false,
                development: false,
            },
        )
        .setting(
            PROGRAM,
            SettingDef {
                label: "The program the core starts as its helper, dualinput-core-helper.exe beside the core when empty",
                kind: SettingKind::Text,
                default: json!(""),
                part_only: false,
                development: true,
            },
        )
        .client_state(SLICE, |me: &CoreHelper, _: &View| me.listed.clone())
        .command(LIST, CoreHelper::list);
}

/// The name of the unit whose handler calls the service, for its notices.
fn caller() -> &'static str {
    kernel::running_unit().unwrap_or("core")
}

/// Turns the binding to `setting` on or off. While it's on and the setting holds a key or
/// button, the helper runs, and each press and release calls the feature's handler.
pub fn watch(cx: &Cx, setting: &'static str, on: bool) {
    cx.call(CoreHelper::set_binding, (setting, on.then(caller)));
}

/// Turns the running unit's next press on or off. It turns itself off once the next press
/// comes.
pub fn next_press(cx: &Cx, on: bool) {
    cx.call(CoreHelper::set_next_press, (cx.unit(), on.then(caller)));
}

/// Turns the running unit's mouse on or off.
pub fn mouse(cx: &Cx, on: bool) {
    cx.call(CoreHelper::set_mouse, (cx.unit(), on.then(caller)));
}

/// Turns the running unit's capture `id` on with `capture`, or off with `None`.
pub fn capture(cx: &Cx, id: &'static str, capture: Option<Capture>) {
    let capture = capture.map(|c| (c, caller()));
    cx.call(CoreHelper::set_capture, (cx.unit(), id, capture));
}

/// Opens the running unit's playback stream `id` with `buffer`, or closes it with `None`.
pub fn stream(cx: &Cx, id: &'static str, buffer: Option<Buffer>) {
    let buffer = buffer.map(|b| (b, caller()));
    cx.call(CoreHelper::set_stream, (cx.unit(), id, buffer));
}

/// Hands an open playback stream a frame, by its number from the sender and its stamp there.
/// A frame for a stream that's closed, or while the helper isn't running, is dropped.
pub fn frame(cx: &Cx, id: &'static str, number: u32, at: u64, opus: Vec<u8>) {
    cx.call(CoreHelper::send_frame, (cx.unit(), id, number, at, opus));
}

/// Turns the running unit's sounds on or off. The helper runs while any feature's are on,
/// so a sound plays at once.
pub fn sounds(cx: &Cx, on: bool) {
    cx.call(CoreHelper::set_sounds, (cx.unit(), on.then(caller)));
}

/// Plays the running unit's sound `id`. While the helper isn't running, the call is logged
/// and dropped.
pub fn play(cx: &Cx, id: &'static str) {
    cx.call(CoreHelper::play_sound, (cx.unit(), id));
}

impl CoreHelper {
    fn set_binding(
        me: &mut CoreHelper,
        (setting, on): (&'static str, Option<&'static str>),
        cx: &mut Cx,
    ) {
        let Some(binding) = me.bindings.iter_mut().find(|b| b.setting == setting) else {
            return tracing::error!(setting, "a unit turned on a binding no unit registered");
        };
        binding.on = on;
        me.changed(cx);
    }

    fn set_next_press(
        me: &mut CoreHelper,
        (unit, on): (UnitId, Option<&'static str>),
        cx: &mut Cx,
    ) {
        let Some(owned) = me.next_press.iter_mut().find(|o| o.unit == unit) else {
            return tracing::error!("a unit turned on the next press without registering it");
        };
        owned.on = on;
        me.changed(cx);
    }

    fn set_mouse(me: &mut CoreHelper, (unit, on): (UnitId, Option<&'static str>), cx: &mut Cx) {
        let Some(owned) = me.mouse.iter_mut().find(|o| o.unit == unit) else {
            return tracing::error!("a unit turned on the mouse without registering it");
        };
        owned.on = on;
        me.changed(cx);
    }

    fn set_capture(
        me: &mut CoreHelper,
        (unit, id, on): (UnitId, &'static str, Option<(Capture, &'static str)>),
        cx: &mut Cx,
    ) {
        let Some(capture) = me
            .captures
            .iter_mut()
            .find(|c| c.unit == unit && c.id == id)
        else {
            return tracing::error!(id, "a unit turned on a capture it didn't register");
        };
        capture.on = on;
        me.changed(cx);
    }

    fn set_stream(
        me: &mut CoreHelper,
        (unit, id, on): (UnitId, &'static str, Option<(Buffer, &'static str)>),
        cx: &mut Cx,
    ) {
        let Some(stream) = me.streams.iter_mut().find(|s| s.unit == unit && s.id == id) else {
            return tracing::error!(id, "a unit opened a stream it didn't register");
        };
        stream.on = on;
        me.changed(cx);
    }

    fn set_sounds(me: &mut CoreHelper, (unit, on): (UnitId, Option<&'static str>), cx: &mut Cx) {
        match on {
            Some(name) => me.sounds_on.insert(unit, name),
            None => me.sounds_on.remove(&unit),
        };
        me.changed(cx);
    }

    fn send_frame(
        me: &mut CoreHelper,
        (unit, id, number, at, opus): (UnitId, &'static str, u32, u64, Vec<u8>),
        cx: &mut Cx,
    ) {
        let Some(stream) = me
            .streams
            .iter()
            .find(|s| s.unit == unit && s.id == id && s.on.is_some())
        else {
            return tracing::trace!(id, "a frame for a stream that's closed was dropped");
        };
        let message = ToHelper::Frame {
            stream: stream.number,
            number,
            at,
            opus,
        };
        if !me.send(message, cx) {
            tracing::trace!(
                id,
                "a frame was dropped, since the core helper isn't running"
            );
        }
    }

    fn play_sound(me: &mut CoreHelper, (unit, id): (UnitId, &'static str), cx: &mut Cx) {
        let Some(sound) = me.sounds.iter().find(|s| s.unit == unit && s.id == id) else {
            return tracing::error!(id, "a unit played a sound it didn't register");
        };
        let sound = sound.number;
        if !me.send(ToHelper::Play { sound }, cx) {
            tracing::info!(
                id,
                "a sound wasn't played, since the core helper isn't running"
            );
        }
    }

    /// `LIST`, from the desktop app: the helper lists the output devices and the programs
    /// that own an audio session, in the slice, once it runs.
    fn list(me: &mut CoreHelper, _: Value, cx: &mut Cx) -> Result<(), String> {
        me.lists = true;
        me.changed(cx);
        Ok(())
    }

    fn setting_changed(me: &mut CoreHelper, changed: &SettingChanged, cx: &mut Cx) {
        if changed.key == OUTPUT {
            // The helper's next `InUse` says whether the new pick is connected.
            clients::clear_notice(cx, "missing-output");
            me.changed(cx);
        } else if me.bindings.iter().any(|b| b.setting == changed.key) {
            me.changed(cx);
        }
    }

    /// Warns while the helper plays on another device than the one the pilot picked, since
    /// it's missing and the helper plays on Windows' default. The helper takes a device with
    /// the picked name when no device has its endpoint ID, since a USB headset plugged into
    /// another port may get a new one. While the helper plays on nothing, a device that
    /// won't open shows as its `Failed` warning instead.
    fn check_output(&self, cx: &Cx) {
        let picked = cx
            .read::<Clients>()
            .setting_as::<Option<DeviceInfo>>(OUTPUT)
            .flatten();
        let in_use = self.listed.in_use.as_ref();
        match picked {
            Some(picked)
                if self.running()
                    && in_use.is_some_and(|u| u.id != picked.id && u.name != picked.name) =>
            {
                clients::notice(
                    cx,
                    "missing-output",
                    Level::Warning,
                    &format!(
                        "{} isn't connected, so Dual Input plays on Windows' default device until it is",
                        picked.name
                    ),
                    None,
                );
            }
            _ => clients::clear_notice(cx, "missing-output"),
        }
    }
}
