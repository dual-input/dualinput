//! The helper's life: started while anything is wanted, sent every want whole after its
//! `Hello` and each change, stopped once nothing is, and started again 2s after it exits
//! while something still is (record/areas/core/04-core-helper.md, "The helper's life").

use std::time::Duration;

use clients::{Clients, Level};
use kernel::{Cx, Input, TimerId};
use messages::core_helper::{self, Bound, FromHelper, ToHelper, WantId, Wants};

use crate::hooks::{Captured, Mouse, NextPressed, Press};
use crate::{CoreHelper, PROGRAM, PipeOut, PipeUp};

/// How long after the helper exits, while something is wanted, the service starts it again
/// (user, 2026-10-16).
const AGAIN: Duration = Duration::from_secs(2);

/// How long after the helper goes down the trouble notice shows, if no matching `Hello` has
/// come by then.
const TROUBLE: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Default)]
pub(crate) enum Life {
    /// Nothing is wanted, and no helper runs.
    #[default]
    Stopped,
    /// A start went out as this run.
    Starting { run: u32 },
    /// The helper runs, and has sent a matching `Hello` once `hello` is true.
    Running { run: u32, process: u32, hello: bool },
    /// A stop went out, and the service waits for the helper's exit.
    Stopping { run: u32 },
    /// The helper went down while something is wanted, and this timer starts it again.
    Waiting { timer: TimerId },
}

/// Whether anything is wanted, which keeps the helper running.
fn wanted(wants: &Wants) -> bool {
    !wants.bindings.is_empty()
        || wants.next_press
        || wants.mouse
        || !wants.captures.is_empty()
        || !wants.streams.is_empty()
        || wants.sounds
        || wants.lists
}

impl CoreHelper {
    /// Whether a helper runs that sent its matching `Hello`.
    pub(crate) fn running(&self) -> bool {
        matches!(self.life, Life::Running { hello: true, .. })
    }

    /// Sends the running helper a message, or returns false when none runs.
    pub(crate) fn send(&self, message: ToHelper, cx: &Cx) -> bool {
        match self.life {
            Life::Running {
                run, hello: true, ..
            } => {
                cx.out(PipeOut::Send { run, message });
                true
            }
            _ => false,
        }
    }

    /// After any change to what's wanted: starts the helper, sends it the wants, or stops it.
    pub(crate) fn changed(&mut self, cx: &Cx) {
        let wants = self.wants(cx.read::<Clients>());
        let wanted = wanted(&wants);
        self.clear_failed_wants_off(&wants, cx);
        match self.life {
            Life::Stopped if wanted => self.start(cx),
            Life::Running {
                hello: true, run, ..
            } if wanted && self.sent.as_ref() != Some(&wants) => {
                cx.out(PipeOut::Send {
                    run,
                    message: ToHelper::Wants(wants.clone()),
                });
                self.sent = Some(wants);
            }
            Life::Starting { run } | Life::Running { run, .. } if !wanted => {
                tracing::info!(run, "nothing is wanted of the core helper, so it stops");
                cx.out(PipeOut::Stop { run });
                self.life = Life::Stopping { run };
                self.sent = None;
            }
            Life::Waiting { timer } if !wanted => {
                cx.cancel_timer(timer);
                self.life = Life::Stopped;
                self.clear_trouble(cx);
            }
            _ => {}
        }
    }

    fn start(&mut self, cx: &Cx) {
        self.runs += 1;
        let run = self.runs;
        let program = cx
            .read::<Clients>()
            .setting_as::<String>(PROGRAM)
            .unwrap_or_default();
        tracing::info!(run, program, "the core helper starts");
        cx.out(PipeOut::Start { run, program });
        self.life = Life::Starting { run };
        self.sent = None;
    }

    /// The helper exited, didn't start, or was killed, so it counts as down. While
    /// something is wanted, it starts again 2s later, and the trouble notice shows if no
    /// matching `Hello` comes within 5s of the first time it went down.
    fn went_down(&mut self, cx: &Cx) {
        self.sent = None;
        self.listed.in_use = None;
        if wanted(&self.wants(cx.read::<Clients>())) {
            self.life = Life::Waiting {
                timer: cx.timer(AGAIN, CoreHelper::again),
            };
            if self.trouble.is_none() {
                self.trouble = Some(cx.timer(TROUBLE, CoreHelper::trouble));
            }
        } else {
            self.life = Life::Stopped;
            self.clear_trouble(cx);
        }
    }

    fn again(me: &mut CoreHelper, _: TimerId, cx: &mut Cx) {
        if matches!(me.life, Life::Waiting { .. }) {
            me.life = Life::Stopped;
            me.changed(cx);
        }
    }

    fn trouble(me: &mut CoreHelper, _: TimerId, cx: &mut Cx) {
        me.trouble = None;
        let owners = me.owners();
        if me.running() || owners.is_empty() {
            return;
        }
        let text = format!(
            "Dual Input's helper for input and audio isn't running, so {} can't work until it starts again",
            owners.join(", ")
        );
        tracing::warn!(text, "the core helper is down");
        clients::notice(cx, "down", Level::Trouble, &text, None);
    }

    fn clear_trouble(&mut self, cx: &Cx) {
        if let Some(timer) = self.trouble.take() {
            cx.cancel_timer(timer);
        }
        clients::clear_notice(cx, "down");
    }

    /// The edge's input: the helper started, didn't, sent a message, or exited.
    pub(crate) fn pipe(me: &mut CoreHelper, input: &Input, cx: &mut Cx) {
        let Some(up) = PipeUp::decode(&input.bytes) else {
            return tracing::error!("an input from the core helper's edge didn't decode");
        };
        match (up, me.life) {
            (PipeUp::Started { run, process }, Life::Starting { run: r }) if run == r => {
                tracing::info!(run, process, "the core helper's process started");
                me.life = Life::Running {
                    run,
                    process,
                    hello: false,
                };
            }
            (PipeUp::NotStarted { run, error }, Life::Starting { run: r }) if run == r => {
                tracing::error!(run, error, "the core helper didn't start");
                me.went_down(cx);
            }
            // Nothing was wanted by the time the start failed, so the stop that went out
            // found no process to stop, and no exit will come.
            (PipeUp::NotStarted { run, error }, Life::Stopping { run: r }) if run == r => {
                tracing::error!(run, error, "the core helper didn't start");
                me.life = Life::Stopped;
                me.changed(cx);
            }
            (
                PipeUp::Message { run, bytes },
                Life::Running {
                    run: r,
                    hello,
                    process,
                },
            ) if run == r => {
                me.message(run, process, hello, &bytes, cx);
            }
            (PipeUp::Exited { run, code }, Life::Stopping { run: r }) if run == r => {
                tracing::info!(run, code, "the core helper exited");
                me.life = Life::Stopped;
                me.changed(cx);
            }
            (PipeUp::Exited { run, code }, Life::Starting { run: r })
            | (PipeUp::Exited { run, code }, Life::Running { run: r, .. })
                if run == r =>
            {
                tracing::warn!(
                    run,
                    code,
                    "the core helper exited while something was wanted of it"
                );
                me.went_down(cx);
            }
            // An input from a run the service already counts as gone, such as the exit of
            // a helper it killed.
            (up, _) => tracing::trace!(
                ?up,
                "an input from a past run of the core helper was dropped"
            ),
        }
    }

    fn message(&mut self, run: u32, process: u32, hello: bool, bytes: &[u8], cx: &mut Cx) {
        let message: FromHelper = match core_helper::decode(bytes) {
            Ok(message) => message,
            Err(error) => {
                return tracing::warn!(%error, "a message from the core helper didn't parse, so it was dropped");
            }
        };
        if !hello {
            return match message {
                FromHelper::Hello { version, hash }
                    if version == messages::VERSION && hash == messages::HASH =>
                {
                    self.hello(run, process, cx)
                }
                FromHelper::Hello { version, hash } => {
                    tracing::warn!(
                        theirs = version,
                        their_hash = hash,
                        ours = messages::VERSION,
                        our_hash = messages::HASH,
                        "a core helper of another build said hello, so the core killed it"
                    );
                    cx.out(PipeOut::Kill { run });
                    self.went_down(cx);
                }
                _ => {
                    tracing::warn!(
                        "the core helper's first message wasn't its hello, so the core killed it"
                    );
                    cx.out(PipeOut::Kill { run });
                    self.went_down(cx);
                }
            };
        }
        match message {
            FromHelper::Hello { .. } => {
                tracing::warn!("the core helper said hello again, which was dropped");
            }
            FromHelper::Press { binding, down, at } => {
                if let Some(b) = self
                    .bindings
                    .iter()
                    .find(|b| b.number == binding && b.on.is_some())
                {
                    cx.call_handler(&b.handler, Press { down, at });
                }
            }
            FromHelper::NextPress { input, name, at } => {
                if let Some(owned) = self.next_press.iter_mut().find(|o| o.on.is_some()) {
                    tracing::info!(name, "the core helper found the next press");
                    owned.on = None;
                    cx.call_handler(
                        &owned.handler,
                        NextPressed {
                            bound: Bound { input, name },
                            at,
                        },
                    );
                    self.changed(cx);
                }
            }
            FromHelper::Mouse {
                kind,
                x,
                y,
                width,
                height,
                at,
            } => {
                for owned in self.mouse.iter().filter(|o| o.on.is_some()) {
                    let mouse = Mouse {
                        kind,
                        x,
                        y,
                        width,
                        height,
                        at,
                    };
                    cx.call_handler(&owned.handler, mouse);
                }
            }
            FromHelper::Frame { capture, opus, at } => {
                if let Some(c) = self
                    .captures
                    .iter()
                    .find(|c| c.number == capture && c.on.is_some())
                {
                    cx.call_handler(&c.handler, Captured::Frame { opus, at });
                }
            }
            FromHelper::Capturing { capture, program } => {
                if let Some(c) = self
                    .captures
                    .iter()
                    .find(|c| c.number == capture && c.on.is_some())
                {
                    tracing::info!(capture = c.id, program, "the core helper's capture changed");
                    cx.call_handler(&c.handler, Captured::Program(program));
                }
            }
            FromHelper::Played {
                stream,
                played,
                concealed,
                late,
                depth_ms,
            } => {
                let id = self
                    .streams
                    .iter()
                    .find(|s| s.number == stream)
                    .map(|s| s.id);
                tracing::info!(
                    stream = id,
                    played,
                    concealed,
                    late,
                    depth_ms,
                    "a transmission on a playback stream ended"
                );
            }
            FromHelper::Lists { outputs, programs } => {
                tracing::info!(
                    outputs = outputs.len(),
                    programs = programs.len(),
                    "the core helper listed its devices and programs"
                );
                self.listed.outputs = outputs;
                self.listed.programs = programs;
                self.lists = false;
                self.changed(cx);
            }
            FromHelper::InUse { output } => {
                tracing::info!(
                    output = output.as_ref().map(|o| o.name.as_str()),
                    "the core helper plays on this output device"
                );
                if output.is_some()
                    && let Some(id) = self.failed.remove(&WantId::Output)
                {
                    clients::clear_notice(cx, &id);
                }
                self.listed.in_use = output;
                self.check_output(cx);
            }
            FromHelper::Failed { want, error } => {
                self.failed(want, &error, cx);
                // The lists won't come, so the request ends here rather than keeping the
                // helper running for it.
                if want == WantId::Lists {
                    self.lists = false;
                    self.changed(cx);
                }
            }
        }
    }

    /// The helper's matching `Hello`: each sound, then the wants, whole, so a helper that
    /// started again gets everything in one round.
    fn hello(&mut self, run: u32, process: u32, cx: &mut Cx) {
        tracing::info!(run, process, "the core helper said hello");
        self.life = Life::Running {
            run,
            process,
            hello: true,
        };
        self.clear_trouble(cx);
        for id in std::mem::take(&mut self.failed).into_values() {
            clients::clear_notice(cx, &id);
        }
        for sound in &self.sounds {
            cx.out(PipeOut::Send {
                run,
                message: ToHelper::Sound {
                    sound: sound.number,
                    ogg_opus: sound.ogg_opus.to_vec(),
                },
            });
        }
        self.changed(cx);
    }

    /// A want the helper can't carry out: a warning naming the feature, until the want goes
    /// off or the helper starts again.
    fn failed(&mut self, want: WantId, error: &str, cx: &Cx) {
        let (owner, what) = match want {
            WantId::Binding(n) => (
                self.bindings
                    .iter()
                    .find(|b| b.number == n)
                    .and_then(|b| b.on),
                "bound key or button",
            ),
            WantId::NextPress => (
                self.next_press.iter().find_map(|o| o.on),
                "binding of a key or button",
            ),
            WantId::Mouse => (self.mouse.iter().find_map(|o| o.on), "mouse"),
            WantId::Capture(n) => (
                self.captures
                    .iter()
                    .find(|c| c.number == n)
                    .and_then(|c| Some(c.on.as_ref()?.1)),
                "audio capture",
            ),
            WantId::Stream(n) => (
                self.streams
                    .iter()
                    .find(|s| s.number == n)
                    .and_then(|s| Some(s.on.as_ref()?.1)),
                "playback",
            ),
            WantId::Output => (Some("Dual Input"), "output device"),
            WantId::Lists => (Some("The desktop app"), "list of devices"),
        };
        let owner = owner.unwrap_or("Dual Input");
        tracing::warn!(
            ?want,
            owner,
            error,
            "the core helper couldn't carry out a want"
        );
        let id = match want {
            WantId::Binding(n) => format!("failed.binding-{n}"),
            WantId::NextPress => "failed.next-press".into(),
            WantId::Mouse => "failed.mouse".into(),
            WantId::Capture(n) => format!("failed.capture-{n}"),
            WantId::Stream(n) => format!("failed.stream-{n}"),
            WantId::Output => "failed.output".into(),
            WantId::Lists => "failed.lists".into(),
        };
        clients::notice(
            cx,
            &id,
            Level::Warning,
            &format!("{owner}'s {what} isn't working: {error}"),
            None,
        );
        self.failed.insert(want, id);
    }

    /// Clears each failed want's warning once its want is off.
    fn clear_failed_wants_off(&mut self, wants: &Wants, cx: &Cx) {
        let off: Vec<WantId> = self
            .failed
            .keys()
            .copied()
            .filter(|want| match *want {
                WantId::Binding(n) => !wants.bindings.iter().any(|(b, _)| *b == n),
                WantId::NextPress => !wants.next_press,
                WantId::Mouse => !wants.mouse,
                WantId::Capture(n) => !wants.captures.iter().any(|(c, _)| *c == n),
                WantId::Stream(n) => !wants.streams.iter().any(|(s, _)| *s == n),
                // The output device is wanted while anything may play on it.
                WantId::Output => !wants.sounds && wants.streams.is_empty(),
                WantId::Lists => !wants.lists,
            })
            .collect();
        for want in off {
            if let Some(id) = self.failed.remove(&want) {
                clients::clear_notice(cx, &id);
            }
        }
    }
}
