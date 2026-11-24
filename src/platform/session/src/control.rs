//! Control: the one value of who flies, a generation and the pilot flying's ID, which every
//! change raises, and which rides the session channel as its own key
//! (record/areas/session/02-units.md, "Control"; record/areas/network/01-between-machines.md,
//! "Control").

use kernel::{Cx, View};
use messages::session::{self as wire, Control, Keys, Phase};
use network::To;

use crate::{ControlPassed, Session, TakeControl};
use messages::hex;

/// A control value from another core, which replaces this core's when it outranks it.
pub(crate) fn arrived(me: &mut Session, control: Control, cx: &Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    if held.control.is_some_and(|c| !control.outranks(&c)) {
        return;
    }
    let before = held.control.replace(control);
    let became = control.pf == held.me && before.is_none_or(|b| b.pf != held.me);
    tracing::info!(
        generation = control.generation,
        pf = hex(&control.pf),
        "control passed"
    );
    cx.raise(ControlPassed {
        before,
        after: control,
        made_here: false,
    });
    if became {
        me.stamp_again(cx);
    }
}

/// Makes a change of control to `pf`, one generation past the highest this core has seen.
pub(crate) fn make(me: &mut Session, pf: messages::net::PilotId, cx: &Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    let control = Control {
        generation: held.control.map_or(1, |c| c.generation + 1),
        pf,
    };
    let before = held.control.replace(control);
    tracing::info!(
        generation = control.generation,
        pf = hex(&pf),
        "this core passed control"
    );
    network::send(
        cx,
        wire::CHANNEL,
        To::Crew,
        &Keys {
            control: Some(control),
            values: Vec::new(),
        },
    );
    cx.raise(ControlPassed {
        before,
        after: control,
        made_here: true,
    });
    if pf == held.me {
        me.stamp_again(cx);
    }
}

/// A pass this core makes itself, as its pilot flying leaves the flight or the session: to a
/// member in the flight, and with `anyone`, to any other member when none is. With v1's two
/// pilots that's the other one; which of several up-to-date members it goes to is for the
/// pick that brings larger crews (record/areas/session/02-units.md, "Control"). Returns
/// whether it passed.
pub(crate) fn pass_on(me: &mut Session, anyone: bool, cx: &Cx) -> bool {
    let Some(mine) = me.me() else {
        return false;
    };
    if me.pf() != Some(mine) {
        return false;
    }
    let others: Vec<_> = me.members().into_iter().filter(|m| *m != mine).collect();
    let to = others
        .iter()
        .find(|m| me.in_flight(m))
        .or(if anyone { others.first() } else { None })
        .copied();
    match to {
        Some(to) => {
            make(me, to, cx);
            true
        }
        None => false,
    }
}

/// A core that restarted, once the crew's first message has told it the control value,
/// passes control it held, so a pilot flying back from a crash never returns holding it.
pub(crate) fn pass_after_restart(me: &mut Session, cx: &Cx) {
    if let Some(held) = &mut me.held {
        held.restarted = false;
    }
    let anyone = me.preflight().phase != Phase::Ended;
    if pass_on(me, anyone, cx) {
        tracing::info!("this core restarted holding control, so it passed control on");
    }
}

/// A core back from a restart whose crew's first message carries no control value makes one
/// naming its own pilot, since without one nobody sets the session's aircraft or may take
/// control. With v1's two pilots, a first message with none means no member holds one, as when
/// the crewmate's core restarted too. When both cores make one, the value naming the lower
/// pilot ID wins on both, so this core makes no pass after the restart, which would add two
/// changes of control and end with the same pilot (record/areas/session/log.md, "Two cores
/// that both restarted never learned who flies").
pub(crate) fn make_after_restart(me: &mut Session, cx: &Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    if !held.restarted || held.control.is_some() {
        return;
    }
    held.restarted = false;
    let mine = held.me;
    tracing::info!(
        "the crew's first message after a restart carried no control value, so this core makes control itself"
    );
    make(me, mine, cx);
}

/// `TakeControl`, once every guard allowed it.
pub(crate) fn take(me: &mut Session, _: TakeControl, cx: &mut Cx) {
    if let Some(mine) = me.me() {
        make(me, mine, cx);
    }
    me.settle(cx);
}

pub(crate) fn build_take(me: &Session, _: &View) -> Option<TakeControl> {
    me.held().then_some(TakeControl)
}

/// The session crate's own guard on control: the take-control input is live only while its
/// pilot is in the flight, after preflight, so nobody takes control in the main menu or at
/// the gate before the countdown (record/areas/session/01-roles-and-members.md, "The PF").
pub(crate) fn own_guard(me: &Session, _: &TakeControl, _: &View) -> Result<(), String> {
    let Some(mine) = me.me() else {
        return Err("There's no session".into());
    };
    if !me.in_flight(&mine) {
        return Err("You can take control once you're in the session's flight".into());
    }
    if me.preflight().phase != Phase::Ended {
        return Err("You can take control once preflight has ended".into());
    }
    Ok(())
}
