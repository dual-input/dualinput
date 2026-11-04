//! The crew's poses and the figures this machine draws: this pilot's pose sent at most every
//! 33ms and at least every 1s while they're in the flight, the newest pose kept from each
//! sender, a figure created for each, and `Figure` fed (record/areas/avatars/01-avatars.md,
//! "The pose" and "Drawing on every machine").

use std::collections::BTreeMap;

use clients::{Landing, Level, Notification};
use kernel::{Cx, Handle};
use messages::avatars::slots::{SHOWS_ALL, SHOWS_BODY, SHOWS_FADED, SHOWS_HANDS};
use messages::avatars::{self as wire, Body, Hand, Pose};
use messages::net::PilotId;
use network::{Network, Sender, To};
use session::{MemberGone, Session};
use sim_service::{InitPosition, SimCx};

use crate::figures::{self, Drawn, Look};
use crate::{Avatars, Settings, seats};

/// A pose goes out at most this often, in µs, the tick of the probes whose figure our test
/// pilot judged good (measured on MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "In the
/// right seat, the figure's hands followed the yoke rules").
const EVERY: u64 = 33_000;
/// And at least this often, so a link that comes up has the whole figure within a second.
const AT_LEAST: u64 = 1_000_000;

/// The figure's SimObject (record/areas/avatars/01-avatars.md, "Names"). tools/profile-author's
/// seats.rs creates the figure by the same `TITLE` and freezes it by the same `FREEZES`, so
/// change both together.
const TITLE: &str = "DUALINPUT_FIGURE_PILOT";

/// The sim's freeze events, which hold each figure where `Figure` writes it.
const FREEZES: [&str; 3] = [
    "K:FREEZE_LATITUDE_LONGITUDE_SET",
    "K:FREEZE_ALTITUDE_SET",
    "K:FREEZE_ATTITUDE_SET",
];

#[derive(Default)]
pub(crate) struct Crew {
    /// Each other member's newest pose, by the stamp it carries.
    poses: BTreeMap<PilotId, Pose>,
    /// The figure of each pilot this machine draws, this one's own included.
    figures: BTreeMap<PilotId, Figure>,
    pub(crate) feed_queued: bool,
    /// A create the sim refused, after which this load tries none again: the sim lacks our
    /// figure, so every create would fail the same way.
    refused: bool,
    /// The seat whose figure hides, since this pilot's camera sits in it.
    hidden_seat: Option<String>,
}

#[derive(Default)]
struct Figure {
    object: Option<u32>,
    creating: Option<Handle>,
}

impl Crew {
    /// A member's pose arrived: kept if it's the newest, and drawn at once.
    pub(crate) fn on_pose(me: &mut Avatars, from: Sender, pose: Pose, cx: &mut Cx) {
        let session = cx.read::<Session>();
        if session.me() == Some(from.pilot) || !session.members().contains(&from.pilot) {
            return;
        }
        if me
            .crew
            .poses
            .get(&from.pilot)
            .is_some_and(|p| p.at >= pose.at)
        {
            return;
        }
        // Two pilots took one seat within a trip: the PF keeps it, or else the lower pilot
        // ID, and the other gives it up at once.
        if let (Body::Seated { seat, .. }, Some(Body::Seated { seat: mine, .. }), Some(me_id)) =
            (&pose.body, &me.body, session.me())
            && seat == mine
            && !seats::keeps_against(me_id, from.pilot, session.pf())
        {
            me.seat = None;
        }
        me.crew.poses.insert(from.pilot, pose);
        me.crew.figures.entry(from.pilot).or_default();
        create_waiting(me, cx);
        me.redraw(cx);
    }

    /// A member left: its figure goes.
    pub(crate) fn gone(me: &mut Avatars, gone: &MemberGone, cx: &mut Cx) {
        me.crew.poses.remove(&gone.member);
        if let Some(object) = me.crew.figures.remove(&gone.member).and_then(|f| f.object) {
            cx.sim().remove(object);
        }
        me.redraw(cx);
    }

    /// Feeds `Figure` every figure this machine draws, with this machine's yokes.
    pub(crate) fn feed(me: &mut Avatars, _: (), cx: &mut Cx) {
        me.crew.feed_queued = false;
        let Some(profile) = &me.profile else {
            return;
        };
        let session = cx.read::<Session>();
        let network = cx.read::<Network>();
        let my_id = session.me();
        let pf = session.pf();
        let internet = network.internet();
        let reaches_no_one = internet == Some(false)
            && session
                .members()
                .iter()
                .any(|m| Some(*m) != my_id && !network.up(m));
        let colors = session.colors();
        let yokes = me.model().map_or(&[][..], |m| m.yokes());
        let seat = |pose: &Pose| match &pose.body {
            Body::Seated { seat, .. } => profile.seats.iter().find(|s| s.key == *seat),
            _ => None,
        };
        let mut drawn = Vec::new();
        // This pilot's own figure first, so a crew past the slot's eight loses another's.
        let order = my_id.into_iter().chain(
            me.crew
                .figures
                .keys()
                .copied()
                .filter(|p| Some(*p) != my_id),
        );
        for pilot in order {
            let Some(object) = me.crew.figures.get(&pilot).and_then(|f| f.object) else {
                continue;
            };
            let own = Some(pilot) == my_id;
            let pose = if own {
                me.own.as_ref()
            } else {
                me.crew.poses.get(&pilot)
            };
            let Some(pose) = pose else {
                continue;
            };
            let place = seat(pose);
            let look = if own {
                if reaches_no_one {
                    Look::Gray
                } else {
                    Look::Live
                }
            } else if !session.in_flight(&pilot) {
                Look::Slumped
            } else if network.up(&pilot) {
                Look::Live
            } else {
                match internet {
                    Some(true) => Look::Slumped,
                    Some(false) => Look::Resting,
                    // Before the check answers, a figure holds its last pose.
                    None => Look::Live,
                }
            };
            let hidden =
                !own && place.is_some_and(|s| me.crew.hidden_seat.as_ref() == Some(&s.key));
            let shows = if hidden {
                0
            } else {
                shows(own, &pose.body, &me.settings)
            };
            let rest = rest_hands(place, pf == Some(pilot), yokes);
            drawn.push(Drawn {
                object,
                pose,
                seat: place,
                color: colors.get(&pilot).copied().unwrap_or(0),
                shows,
                look,
                rest,
            });
        }
        // Fed even with none, so `Figure` stops writing objects that are gone.
        let slot = figures::slot(yokes, drawn.into_iter().take(figures::MOST));
        cx.module().feed(wire::FIGURE, &slot);
    }
}

/// What of a figure shows, by the switch for whose it is and where it is: this pilot's own
/// sits with its head at the camera while inside, so it hides its head and neck and fades its
/// hands.
fn shows(own: bool, body: &Body, settings: &Settings) -> u32 {
    let on_foot = matches!(body, Body::OnFoot { .. });
    let on = match (own, on_foot) {
        (true, false) => settings.mine_inside,
        (true, true) => settings.mine_walkaround,
        (false, false) => settings.crew_inside,
        (false, true) => settings.crew_walkaround,
    };
    match (on, own && !on_foot) {
        (false, _) => 0,
        (true, true) => SHOWS_BODY | SHOWS_HANDS | SHOWS_FADED,
        (true, false) => SHOWS_ALL,
    }
}

/// A figure at rest on this machine: the PF's holds the yoke in front of its seat with the
/// hand on its outboard side, and every other figure rests both hands.
fn rest_hands(seat: Option<&seats::Place>, pf: bool, yokes: &[aircraft_model::Yoke]) -> [Hand; 2] {
    let Some(seat) = seat.filter(|_| pf) else {
        return [Hand::Rest; 2];
    };
    if !yokes.iter().any(|y| y.left == seat.left()) {
        return [Hand::Rest; 2];
    }
    if seat.left() {
        [Hand::Grip(wire::Side::Left), Hand::Rest]
    } else {
        [Hand::Rest, Hand::Grip(wire::Side::Right)]
    }
}

/// This pilot's pose, made each frame from their body and hands: kept, and sent to the crew
/// while they're in the flight, when it changed and 33ms have passed, or when 1s has.
pub(crate) fn own_pose(me: &mut Avatars, cx: &mut Cx) {
    let Some(body) = me.body.clone() else {
        return;
    };
    let now = cx.now();
    let rules = me.rules(cx);
    let pose = Pose {
        at: now,
        body,
        hands: me.hands.targets(&rules, now),
    };
    let changed = me
        .own
        .as_ref()
        .is_none_or(|p| p.body != pose.body || p.hands != pose.hands);
    let since = me.sent.map_or(u64::MAX, |s| now.saturating_sub(s));
    if !(changed && since >= EVERY || since >= AT_LEAST) {
        return;
    }
    let session = cx.read::<Session>();
    let my_id = session.me();
    if my_id.is_some_and(|id| session.in_flight(&id)) {
        network::send_one_off(cx, wire::POSES, To::Crew, &pose);
    }
    me.own = Some(pose);
    me.sent = Some(now);
    if let Some(id) = my_id {
        me.crew.figures.entry(id).or_default();
    }
    create_waiting(me, cx);
    me.redraw(cx);
}

/// Whether a figure waits for its object, so the aircraft's pose is read for its first place.
pub(crate) fn waiting(me: &Avatars) -> bool {
    !me.crew.refused
        && me
            .crew
            .figures
            .values()
            .any(|f| f.object.is_none() && f.creating.is_none())
}

/// Creates each figure that waits, at the aircraft's place, once that's read.
pub(crate) fn create_waiting(me: &mut Avatars, cx: &mut Cx) {
    let Some(a) = me.sim.aircraft.filter(|_| !me.crew.refused) else {
        return;
    };
    let at = InitPosition {
        latitude: a.latitude,
        longitude: a.longitude,
        altitude: a.altitude,
        pitch: a.pitch,
        bank: a.bank,
        heading: a.heading,
        on_ground: false,
        airspeed: 0,
    };
    for figure in me.crew.figures.values_mut() {
        if figure.object.is_none() && figure.creating.is_none() {
            figure.creating = Some(cx.sim().create_ai(TITLE, "", at));
        }
    }
}

/// A figure's object came: frozen where it is, so only `Figure`'s writes move it, as p25 to
/// p27 froze theirs (read in experiments/areas/avatars/p25-figure-hands.mjs).
pub(crate) fn created(me: &mut Avatars, call: Handle, object: u32, cx: &mut Cx) {
    let Some(figure) = me
        .crew
        .figures
        .values_mut()
        .find(|f| f.creating == Some(call))
    else {
        // Its member left while it was created.
        cx.sim().remove(object);
        return;
    };
    figure.creating = None;
    figure.object = Some(object);
    for event in FREEZES {
        cx.sim().key_on(object, event, 1);
    }
    me.redraw(cx);
}

/// The sim refused a call, which for a create means it lacks our figure's SimObject.
pub(crate) fn refused(me: &mut Avatars, call: Handle) {
    if let Some(figure) = me
        .crew
        .figures
        .values_mut()
        .find(|f| f.creating == Some(call))
    {
        figure.creating = None;
        me.crew.refused = true;
        tracing::warn!(
            title = TITLE,
            "the sim couldn't create our figure, so avatars draws none until the profile loads again"
        );
    }
}

/// The connection was lost, and every figure with it; each is created again.
pub(crate) fn lost(me: &mut Avatars) {
    for figure in me.crew.figures.values_mut() {
        *figure = Figure::default();
    }
}

/// The seats other figures' newest poses name.
pub(crate) fn seats_held(me: &Avatars, _: &Cx) -> Vec<String> {
    me.crew
        .poses
        .values()
        .filter_map(|p| match &p.body {
            Body::Seated { seat, .. } => Some(seat.clone()),
            _ => None,
        })
        .collect()
}

/// While this pilot's camera sits in a seat another figure holds, that figure hides, and a
/// notification says the seat is taken, led by its holder's head; Ready doesn't wait for a
/// seat.
pub(crate) fn seat_held(me: &mut Avatars, seat: Option<String>, cx: &mut Cx) {
    if seat == me.crew.hidden_seat {
        return;
    }
    match &seat {
        Some(key) => {
            let holder = me.crew.poses.iter().find_map(|(pilot, pose)| {
                matches!(&pose.body, Body::Seated { seat, .. } if seat == key)
                    .then(|| messages::hex(pilot))
            });
            clients::notify(
                cx,
                crate::SEAT,
                Notification {
                    pilot: holder,
                    ..Notification::new(Level::Information, "This seat is taken", Landing::Figures)
                },
            );
        }
        None => clients::clear_notification(cx, crate::SEAT),
    }
    me.crew.hidden_seat = seat;
    me.redraw(cx);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_switch_covers_its_own_figures_where_they_are() {
        let seated = Body::Head {
            eye: [0.0; 3],
            look: [0.0, 0.0, 1.0],
        };
        let on_foot = Body::OnFoot {
            at: [0.0; 3],
            heading: 0.0,
            crouch: false,
        };
        let inside_own = SHOWS_BODY | SHOWS_HANDS | SHOWS_FADED;
        let all = Settings::default();
        assert_eq!(shows(true, &seated, &all), inside_own);
        assert_eq!(shows(true, &on_foot, &all), SHOWS_ALL);
        assert_eq!(shows(false, &seated, &all), SHOWS_ALL);
        assert_eq!(shows(false, &on_foot, &all), SHOWS_ALL);
        let off = |change: fn(&mut Settings)| {
            let mut settings = Settings::default();
            change(&mut settings);
            [
                shows(true, &seated, &settings),
                shows(true, &on_foot, &settings),
                shows(false, &seated, &settings),
                shows(false, &on_foot, &settings),
            ]
        };
        assert_eq!(
            off(|s| s.mine_inside = false),
            [0, SHOWS_ALL, SHOWS_ALL, SHOWS_ALL]
        );
        assert_eq!(
            off(|s| s.mine_walkaround = false),
            [inside_own, 0, SHOWS_ALL, SHOWS_ALL]
        );
        assert_eq!(
            off(|s| s.crew_inside = false),
            [inside_own, SHOWS_ALL, 0, SHOWS_ALL]
        );
        assert_eq!(
            off(|s| s.crew_walkaround = false),
            [inside_own, SHOWS_ALL, SHOWS_ALL, 0]
        );
    }
}
