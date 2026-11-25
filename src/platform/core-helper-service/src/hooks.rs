//! What a feature registers with the service: its bindings, the next press, the mouse, its
//! captures, playback streams, and sounds, each off until the feature turns it on
//! (record/areas/core/04-core-helper.md, "What a feature registers and calls").

use kernel::{Cx, Handler, Unit, UnitId};
use messages::core_helper::{Bound, Buffer, Capture, MouseKind};

use crate::CoreHelper;

/// A binding's key or button went down or up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Press {
    pub down: bool,
    /// In µs on the PC's performance counter, as the helper read it, so a feature times a
    /// long press from here.
    pub at: u64,
}

/// The next key or button pressed, with the name the helper gave it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NextPressed {
    pub bound: Bound,
    pub at: u64,
}

/// What the mouse did in the sim's main window: the cursor's place in its client area, from
/// −1 to 1, right and up, and that area's size in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mouse {
    pub kind: MouseKind,
    pub x: f32,
    pub y: f32,
    pub width: u32,
    pub height: u32,
    pub at: u64,
}

/// What a capture brings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Captured {
    /// 20ms of Opus, stamped at its first sample.
    Frame { opus: Vec<u8>, at: u64 },
    /// The program captured, or `None` while the helper waits for one.
    Program(Option<String>),
}

pub(crate) struct Binding {
    pub(crate) number: u16,
    /// The setting that holds the binding's `Bound`, which the feature registers with the
    /// clients crate.
    pub(crate) setting: &'static str,
    /// The title of the warning while the helper can't carry the want out, as the feature
    /// registered it.
    pub(crate) warning: &'static str,
    pub(crate) handler: Handler<Press>,
    /// The feature's name while it has the binding on.
    pub(crate) on: Option<&'static str>,
}

/// A want that one unit turns on for itself, such as the mouse.
pub(crate) struct Owned<A> {
    pub(crate) unit: UnitId,
    pub(crate) warning: &'static str,
    pub(crate) handler: Handler<A>,
    pub(crate) on: Option<&'static str>,
}

pub(crate) struct CaptureReg {
    pub(crate) number: u16,
    pub(crate) unit: UnitId,
    pub(crate) id: &'static str,
    pub(crate) warning: &'static str,
    pub(crate) handler: Handler<Captured>,
    pub(crate) on: Option<(Capture, &'static str)>,
}

pub(crate) struct StreamReg {
    pub(crate) number: u16,
    pub(crate) unit: UnitId,
    pub(crate) id: &'static str,
    pub(crate) warning: &'static str,
    pub(crate) on: Option<(Buffer, &'static str)>,
}

pub(crate) struct SoundReg {
    pub(crate) number: u16,
    pub(crate) unit: UnitId,
    pub(crate) id: &'static str,
    pub(crate) ogg_opus: &'static [u8],
}

/// The service's hooks on a unit, as it registers.
///
/// A pilot knows a feature by what it does for them, not by its unit's name, so each want but a
/// sound comes with its `warning`: the title of the warning the pilot sees while the helper
/// can't carry the want out, in their words, as in "Your figure's pointing isn't working".
pub trait HelperUnit<S> {
    /// A binding to the key or button in the setting `setting`, which calls `f` at each
    /// press and release while the feature has it on, through `watch`.
    fn binding(
        &mut self,
        setting: &'static str,
        warning: &'static str,
        f: fn(&mut S, Press, &mut Cx),
    ) -> &mut Self;

    /// Calls `f` with the next key or button pressed, after the feature turns the next press
    /// on, through `next_press`.
    fn next_press(
        &mut self,
        warning: &'static str,
        f: fn(&mut S, NextPressed, &mut Cx),
    ) -> &mut Self;

    /// Calls `f` with each click, move, and wheel turn in the sim's main window while the
    /// feature has the mouse on, through `mouse`.
    fn mouse(&mut self, warning: &'static str, f: fn(&mut S, Mouse, &mut Cx)) -> &mut Self;

    /// A capture, by an ID of the unit's own, which calls `f` with each frame while the
    /// feature has it on, through `capture`.
    fn capture(
        &mut self,
        id: &'static str,
        warning: &'static str,
        f: fn(&mut S, Captured, &mut Cx),
    ) -> &mut Self;

    /// A playback stream, by an ID of the unit's own, which the feature opens through
    /// `stream` and feeds through `frame`.
    fn stream(&mut self, id: &'static str, warning: &'static str) -> &mut Self;

    /// A sound, by an ID of the unit's own: an Ogg Opus file at 48 kHz, mono, embedded in
    /// the feature's crate, which `play` plays while the helper runs.
    fn sound(&mut self, id: &'static str, ogg_opus: &'static [u8]) -> &mut Self;
}

impl<S: 'static> HelperUnit<S> for Unit<'_, S> {
    fn binding(
        &mut self,
        setting: &'static str,
        warning: &'static str,
        f: fn(&mut S, Press, &mut Cx),
    ) -> &mut Self {
        let handler =
            self.handler(move |state: &mut S, press: Press, cx: &mut Cx| f(state, press, cx));
        let me = self.registry().state_mut::<CoreHelper>();
        assert!(
            !me.bindings.iter().any(|b| b.setting == setting),
            "the binding to {setting} should be registered once"
        );
        let number = me.number();
        me.bindings.push(Binding {
            number,
            setting,
            warning,
            handler,
            on: None,
        });
        self
    }

    fn next_press(
        &mut self,
        warning: &'static str,
        f: fn(&mut S, NextPressed, &mut Cx),
    ) -> &mut Self {
        let unit = self.id();
        let handler =
            self.handler(move |state: &mut S, next: NextPressed, cx: &mut Cx| f(state, next, cx));
        let me = self.registry().state_mut::<CoreHelper>();
        assert!(
            !me.next_press.iter().any(|o| o.unit == unit),
            "a unit should register the next press once"
        );
        me.next_press.push(Owned {
            unit,
            warning,
            handler,
            on: None,
        });
        self
    }

    fn mouse(&mut self, warning: &'static str, f: fn(&mut S, Mouse, &mut Cx)) -> &mut Self {
        let unit = self.id();
        let handler =
            self.handler(move |state: &mut S, mouse: Mouse, cx: &mut Cx| f(state, mouse, cx));
        let me = self.registry().state_mut::<CoreHelper>();
        assert!(
            !me.mouse.iter().any(|o| o.unit == unit),
            "a unit should register the mouse once"
        );
        me.mouse.push(Owned {
            unit,
            warning,
            handler,
            on: None,
        });
        self
    }

    fn capture(
        &mut self,
        id: &'static str,
        warning: &'static str,
        f: fn(&mut S, Captured, &mut Cx),
    ) -> &mut Self {
        let unit = self.id();
        let handler = self
            .handler(move |state: &mut S, captured: Captured, cx: &mut Cx| f(state, captured, cx));
        let me = self.registry().state_mut::<CoreHelper>();
        assert!(
            !me.captures.iter().any(|c| c.unit == unit && c.id == id),
            "capture {id} should be registered once"
        );
        let number = me.number();
        me.captures.push(CaptureReg {
            number,
            unit,
            id,
            warning,
            handler,
            on: None,
        });
        self
    }

    fn stream(&mut self, id: &'static str, warning: &'static str) -> &mut Self {
        let unit = self.id();
        let me = self.registry().state_mut::<CoreHelper>();
        assert!(
            !me.streams.iter().any(|s| s.unit == unit && s.id == id),
            "stream {id} should be registered once"
        );
        let number = me.number();
        me.streams.push(StreamReg {
            number,
            unit,
            id,
            warning,
            on: None,
        });
        self
    }

    fn sound(&mut self, id: &'static str, ogg_opus: &'static [u8]) -> &mut Self {
        let unit = self.id();
        let me = self.registry().state_mut::<CoreHelper>();
        assert!(
            !me.sounds.iter().any(|s| s.unit == unit && s.id == id),
            "sound {id} should be registered once"
        );
        let number = me.number();
        me.sounds.push(SoundReg {
            number,
            unit,
            id,
            ogg_opus,
        });
        self
    }
}
