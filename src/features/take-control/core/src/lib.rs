//! Take-control, the feature that lets a pilot become the pilot flying, from a bound key or
//! hardware button or from the button under the EFB app's tabs, and marks each pass of control on
//! every machine in the flight with a cue and a notification
//! (record/areas/control/01-take-control.md).
//!
//! Every way of asking meets one request of the session crate's, whose guards decide, and a
//! refused press answers with a cue of its own, since a pilot pressing hardware in VR may not be
//! looking at the banner.

use std::time::Duration;

use clients::{Clients, ClientsUnit, SettingDef};
use core_helper_service::{HelperUnit, NextPressed, Press};
use kernel::{Cx, Registry, TimerId, Verdict, View};
use messages::clients::{Landing, Level, Notification, SettingKind};
use messages::core_helper::Bound;
use messages::hex;
use messages::net::PilotId;
use messages::take_control::{BIND, Bind, INPUT, LONG_PRESS, NAME, REQUEST, TakeControlSlice};
use network::{LinkLost, LinkUp, Network};
use serde_json::{Value, json};
use session::{
    ControlPassed, FlightChanged, MemberGone, PreflightEnded, Session, SessionEnded, SessionStarted,
};

/// How long a bound key's hold takes control after its down, the same as the EFB app's button, so
/// the gesture has one number. `HOLD_MS` in src/features/take-control/efb/hold.ts holds it too,
/// so change both together.
const HOLD: Duration = Duration::from_millis(350);

/// The cue at a pass of control. src/apps/core-helper's `writes_take_controls_cues` wrote it, and
/// writes it again when it should change.
const CONTROL_PASSED: &str = "control-passed";
const REFUSED: &str = "refused";

/// A pass of control and a refusal each show once. A pass keeps one ID, so a newer pass replaces
/// the card of the last, and a stale "You have control" never sits beside the news that it isn't
/// so.
const PASS: &str = "pass";
const REFUSAL: &str = "refused";
/// Held while this core's link to the pilot flying is lost.
const LOST: &str = "lost-pf";

/// Take-control's state.
#[derive(Default)]
pub struct TakeControl {
    /// A hold's timer, from its down until it fires or its up comes.
    hold: Option<TimerId>,
    /// Bind waits for the next press.
    waiting: bool,
    /// The next press that came, until the part has written it into the setting.
    next_press: Option<Bound>,
    /// The stamp of the input in which a lost link last came back. A connection's first message
    /// is handed over in the same input as its `LinkUp`, and carries control, so a pass stamped
    /// the same was made while the link was lost.
    back_at: Option<u64>,
}

/// Registers take-control. Register it after the session crate and the core helper's service.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<TakeControl>(NAME);
    me.setting(
        INPUT,
        SettingDef {
            label: "The key or button that takes control",
            kind: SettingKind::Input,
            default: Value::Null,
            part_only: true,
            development: false,
        },
    )
    .setting(
        LONG_PRESS,
        SettingDef {
            label: "Whether that key or button takes a hold rather than a press",
            kind: SettingKind::Bool,
            // A hold keeps a brushed button from taking control.
            // src/features/take-control/efb/binding.tsx draws this until the settings arrive, so
            // change both together.
            default: json!(true),
            part_only: true,
            development: false,
        },
    )
    .binding(INPUT, TakeControl::on_press)
    .next_press(TakeControl::on_next_press)
    .sound(CONTROL_PASSED, include_bytes!("sounds/control-passed.opus"))
    .sound(REFUSED, include_bytes!("sounds/refused.opus"))
    .command(REQUEST, |me: &mut TakeControl, (): (), cx: &mut Cx| {
        me.ask(cx);
        Ok(())
    })
    .command(BIND, TakeControl::bind)
    .client_state(NAME, TakeControl::slice);
    me.on::<SessionStarted>(TakeControl::started)
        .on::<SessionEnded>(TakeControl::ended)
        .on::<ControlPassed>(TakeControl::passed)
        .on::<LinkUp>(TakeControl::link_up)
        .on::<LinkLost>(|me, _: &LinkLost, cx| me.hold_warning(cx))
        .on::<MemberGone>(|me, _: &MemberGone, cx| me.hold_warning(cx))
        .on::<FlightChanged>(|me, _: &FlightChanged, cx| me.hold_warning(cx))
        .on::<PreflightEnded>(|me, _: &PreflightEnded, cx| me.hold_warning(cx));
}

/// Whether this pilot holds control.
fn holds_control(session: &Session) -> bool {
    session.pf().is_some() && session.pf() == session.me()
}

/// The pilot flying, while this core's link to them is lost. A pilot flying who left the session
/// counts as gone rather than lost, since their Leave's close says they've gone, so no warning
/// shows (record/areas/network/01-between-machines.md, "Leaving").
fn lost_pf(session: &Session, network: &Network) -> Option<PilotId> {
    let pf = session.pf()?;
    (session.me() != Some(pf) && session.members().contains(&pf) && !network.up(&pf)).then_some(pf)
}

/// What taking control does while the link to `pf` is lost, since on reconnect the higher
/// generation wins, and `pf`'s aircraft moves to this pilot's
/// (record/areas/interface/decisions.md, "Take control is a held button under the tabs").
fn warning(session: &Session, pf: &PilotId) -> String {
    format!(
        "{} may still be flying. If you take control, their aircraft will jump to yours when they reconnect.",
        session.name_of(pf)
    )
}

impl TakeControl {
    /// The sounds run the whole of a session, so the cues play for a pilot who takes control from
    /// the buttons alone. The binding does too, though the service wants nothing of the helper
    /// for it until a key or button is set, so a pilot can bind mid-session
    /// (record/areas/control/01-take-control.md, "What it registers").
    fn started(_: &mut TakeControl, _: &SessionStarted, cx: &mut Cx) {
        core_helper_service::sounds(cx, true);
        core_helper_service::watch(cx, INPUT, true);
    }

    fn ended(me: &mut TakeControl, _: &SessionEnded, cx: &mut Cx) {
        core_helper_service::sounds(cx, false);
        core_helper_service::watch(cx, INPUT, false);
        if let Some(timer) = me.hold.take() {
            cx.cancel_timer(timer);
        }
        me.back_at = None;
        clients::clear_notification(cx, LOST);
    }

    fn on_press(me: &mut TakeControl, press: Press, cx: &mut Cx) {
        if cx.read::<Clients>().setting_as::<bool>(LONG_PRESS) != Some(true) {
            if press.down {
                me.ask(cx);
            }
            return;
        }
        if !press.down {
            if let Some(timer) = me.hold.take() {
                cx.cancel_timer(timer);
            }
        } else if me.hold.is_none() {
            // The helper stamped the down as it read it, so the hold counts from there, not from
            // when the press reached the loop.
            let held = Duration::from_micros(cx.now().saturating_sub(press.at));
            me.hold = Some(cx.timer(HOLD.saturating_sub(held), TakeControl::held));
        }
    }

    fn held(me: &mut TakeControl, _: TimerId, cx: &mut Cx) {
        me.hold = None;
        me.ask(cx);
    }

    /// What the binding and the button both ask (record/areas/control/01-take-control.md, "Taking
    /// control"). This pilot holding control, and the input not counting, end it with no cue,
    /// where the session crate's own guard would deny the request and play the refusal.
    fn ask(&mut self, cx: &Cx) {
        let session = cx.read::<Session>();
        if holds_control(session) {
            return;
        }
        if !session.live_in_flight() {
            tracing::debug!("a press to take control, while the input doesn't count");
            return;
        }
        match cx.verdict::<session::TakeControl>() {
            Some(Verdict::Allowed) => cx.ask(session::TakeControl),
            Some(Verdict::Denied(reasons)) => {
                tracing::info!(?reasons, "a press to take control was refused");
                core_helper_service::play(cx, REFUSED);
                clients::notify(
                    cx,
                    REFUSAL,
                    Notification::new(Level::Warning, "Couldn't take control", Landing::Session)
                        .detail(reasons.join(" "))
                        .once(),
                );
            }
            None => {}
        }
    }

    /// `BIND`: turns the next press on or off. Off also forgets one that came, once the part has
    /// written it into the setting, so a page that opens later doesn't write it again.
    fn bind(me: &mut TakeControl, Bind { on }: Bind, cx: &mut Cx) -> Result<(), String> {
        me.waiting = on;
        me.next_press = None;
        core_helper_service::next_press(cx, on);
        Ok(())
    }

    fn on_next_press(me: &mut TakeControl, next: NextPressed, _: &mut Cx) {
        me.waiting = false;
        me.next_press = Some(next.bound);
    }

    /// The cue and the notification, on every machine whose pilot is in the flight, at each pass
    /// from one pilot to another: not a joiner's first hearing of who flies, and not a machine
    /// whose pilot just left the flight (record/areas/control/01-take-control.md, "A pass").
    fn passed(me: &mut TakeControl, passed: &ControlPassed, cx: &mut Cx) {
        me.hold_warning(cx);
        let Some(before) = passed.before.filter(|before| before.pf != passed.after.pf) else {
            return;
        };
        let session = cx.read::<Session>();
        let Some(mine) = session.me().filter(|mine| session.in_flight(mine)) else {
            return;
        };
        core_helper_service::play(cx, CONTROL_PASSED);
        let pf = passed.after.pf;
        // Word of who has control leads with their head, and what a pilot lost through a cut
        // leads with the warning's own icon.
        let said = if pf == mine {
            let said = Notification::new(Level::Information, "You have control", Landing::Session)
                .about(hex(&pf));
            if session.in_flight(&before.pf) {
                said
            } else {
                said.detail(format!("{} left the flight.", session.name_of(&before.pf)))
            }
        } else if before.pf == mine && me.back_at == Some(cx.now()) {
            let who = session.name_of(&pf);
            Notification::new(
                Level::Warning,
                format!("{who} took control while you were disconnected"),
                Landing::Session,
            )
            .detail(format!(
                "What you changed in that time was undone, and your pages and FMS entries may differ from {who}'s."
            ))
        } else {
            Notification::new(
                Level::Information,
                format!("{} has control", session.name_of(&pf)),
                Landing::Session,
            )
            .about(hex(&pf))
        };
        clients::notify(cx, PASS, said.once());
    }

    fn link_up(me: &mut TakeControl, up: &LinkUp, cx: &mut Cx) {
        if up.again {
            me.back_at = Some(cx.now());
        }
        me.hold_warning(cx);
    }

    /// Holds "Reconnecting to James" while this core's link to the pilot flying is lost. It says
    /// what taking control does only while this pilot could.
    fn hold_warning(&self, cx: &Cx) {
        let session = cx.read::<Session>();
        match lost_pf(session, cx.read::<Network>()) {
            Some(pf) => {
                let said = Notification::new(
                    Level::Warning,
                    format!("Reconnecting to {}", session.name_of(&pf)),
                    Landing::Session,
                );
                let said = if session.live_in_flight() {
                    said.detail(warning(session, &pf))
                } else {
                    said
                };
                clients::notify(cx, LOST, said);
            }
            None => clients::clear_notification(cx, LOST),
        }
    }

    fn slice(me: &TakeControl, view: &View) -> TakeControlSlice {
        let session = view.read::<Session>();
        let live = session.live_in_flight();
        let mine = holds_control(session);
        // A pilot flying's machine can run a replay of what the other pilot changed in a cut,
        // which the guard refuses control through, and that pilot has nothing to take.
        let denied = match view.verdict::<session::TakeControl>() {
            Some(Verdict::Denied(reasons)) if live && !mine => reasons,
            _ => Vec::new(),
        };
        TakeControlSlice {
            live,
            mine,
            denied,
            warning: lost_pf(session, view.read::<Network>())
                .filter(|_| live)
                .map(|pf| warning(session, &pf)),
            waiting: me.waiting,
            next_press: me.next_press.clone(),
        }
    }
}
