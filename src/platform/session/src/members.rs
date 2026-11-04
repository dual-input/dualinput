//! The members: who takes part in the session, each one's status, and who is in the flight
//! (record/areas/session/02-units.md, "Members" and "In the flight").

use clients::{Landing, Level, Notification};
use kernel::Cx;
use messages::net::PilotId;
use messages::session::{self as wire, Link, Phase, Status};
use messages::sim::{Ending, Stage};
use network::{LinkLost, LinkUp, Member, MemberOut, To};
use sim_service::{SimAwareness, SimService};

use crate::{FlightChanged, MemberGone, MemberJoined, Other, Session, control, joining};
use messages::hex;

/// Whether a member's sim is in a flight: at Ready to fly or Flying.
pub(crate) fn flying(stage: Stage) -> bool {
    matches!(stage, Stage::ReadyToFly | Stage::Flying)
}

/// A member's link came up: it's a member from its first, and every `LinkUp` gets this
/// core's keys whole, since a key changed after this core's first message went out, but
/// before the other side's passed here, went to no member
/// (record/areas/network/02-units.md, "Moments").
pub(crate) fn link_up(me: &mut Session, up: &LinkUp, cx: &mut Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    let member = up.member;
    if held.left.contains(&member.pilot) {
        return;
    }
    held.dialing = false;
    let new = !held.others.contains_key(&member.pilot);
    let order = match held.others.get(&member.pilot) {
        Some(other) => other.order,
        None => {
            held.joined += 1;
            held.joined
        }
    };
    held.others.insert(
        member.pilot,
        Other {
            link: Link::Up,
            order,
        },
    );
    let crew_changed = held.crew.insert(member.pilot, member.endpoint) != Some(member.endpoint);
    network::send(cx, wire::CHANNEL, To::Member(member.pilot), &me.all_keys());
    if new {
        tracing::info!(member = hex(&member.pilot), "a member joined the session");
        cx.raise(MemberJoined {
            member: member.pilot,
        });
    }
    if crew_changed {
        joining::write_file(me, cx);
    }
    me.settle(cx);
}

/// A member's link was lost. A member that loses a link during preflight writes its Ready
/// off, so it comes back unready (record/areas/session/02-units.md, "Preflight").
pub(crate) fn link_lost(me: &mut Session, lost: &LinkLost, cx: &mut Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    if let Some(other) = held.others.get_mut(&lost.member) {
        other.link = Link::Lost;
    }
    if matches!(me.preflight().phase, Phase::Running | Phase::Countdown) {
        crate::preflight::unready(me, "its link to another member was lost", cx);
    }
    me.settle(cx);
}

/// 30 minutes without a connection to a member counts it out, and a core with no member left
/// leaves the session (record/areas/network/01-between-machines.md, "Coming back").
pub(crate) fn member_out(me: &mut Session, out: &MemberOut, cx: &mut Cx) {
    me.gone(out.member, cx);
    if me.held.as_ref().is_some_and(|h| h.others.is_empty()) {
        tracing::info!("no member answered for 30 minutes, so this pilot leaves the session");
        me.leave(cx, false);
    }
}

impl Session {
    /// A member left the session: its own keys go with it, and every role's key that names it
    /// is cleared.
    pub(crate) fn gone(&mut self, member: PilotId, cx: &mut Cx) {
        let who = self.name_of(&member);
        let Some(held) = &mut self.held else {
            return;
        };
        if held.others.remove(&member).is_none() {
            return;
        }
        held.left.insert(member);
        held.crew.remove(&member);
        held.was_in.remove(&member);
        held.away.remove(&member);
        held.store.forget(member);
        clients::notify(
            cx,
            &notification_id(&member),
            Notification::new(
                Level::Information,
                format!("{who} left the session"),
                Landing::Session,
            )
            .about(hex(&member))
            .out()
            .once(),
        );
        if held.flight.remove(&member) == Some(true) {
            cx.raise(FlightChanged {
                member,
                in_flight: false,
            });
        }
        tracing::info!(member = hex(&member), "a member left the session");
        cx.raise(MemberGone { member });
        let roles: Vec<u16> = self
            .declared
            .iter()
            .filter(|(_, d)| d.names_member)
            .map(|(&n, _)| n)
            .collect();
        for number in roles {
            let names = self
                .held
                .as_ref()
                .and_then(|h| h.store.get(number, None))
                .and_then(|h| h.value.as_deref())
                .and_then(crate::decode::<Option<PilotId>>)
                .flatten();
            if names == Some(member) {
                self.write_bytes(number, None, cx);
            }
        }
        joining::write_file(self, cx);
        self.settle(cx);
    }
}

/// After keys arrive: dials a member another's entry names that this core holds no link to,
/// so two pilots who join at once, each listed by the backend without the other, still find
/// each other; and counts out a member another member's status lists as left, since that
/// member's leave may not reach this core (record/areas/network/01-between-machines.md,
/// "Channels" and "Leaving").
pub(crate) fn learn(me: &mut Session, _from: network::Sender, cx: &mut Cx) {
    let Some(held) = &me.held else {
        return;
    };
    let mut gone = Vec::new();
    for pilot in held.store.members_of(wire::MEMBER.number) {
        if pilot == held.me || held.others.contains_key(&pilot) || held.left.contains(&pilot) {
            continue;
        }
        if let Some(entry) = me.member_key(wire::MEMBER, &pilot) {
            network::dial(
                cx,
                Member {
                    pilot,
                    restart: 0,
                    endpoint: entry.endpoint,
                },
            );
        }
    }
    for pilot in held.store.members_of(wire::STATUS.number) {
        let Some(status) = me.member_key(wire::STATUS, &pilot) else {
            continue;
        };
        for (other, link) in status.links {
            if link == Link::Left
                && let Some(other) = messages::unhex::<16>(&other)
                && held.others.contains_key(&other)
            {
                gone.push(other);
            }
        }
    }
    for member in gone {
        me.gone(member, cx);
    }
}

/// Writes this member's status from its sim awareness and its links, when it changed.
pub(crate) fn write_status(me: &mut Session, cx: &mut Cx) {
    let Some(held) = &me.held else {
        return;
    };
    let awareness = cx.read::<SimAwareness>();
    let facts = cx.read::<SimService>().aircraft_facts();
    let title = facts
        .filter(|f| f.aircraft == awareness.aircraft)
        .and_then(|f| f.title.clone());
    let mut links: Vec<(String, Link)> = held
        .others
        .iter()
        .map(|(pilot, other)| (hex(pilot), other.link))
        .chain(held.left.iter().map(|pilot| (hex(pilot), Link::Left)))
        .collect();
    links.sort();
    let status = Status {
        stage: awareness.stage,
        aircraft: awareness.aircraft.clone(),
        title,
        pause: awareness.pause,
        ended: awareness.ended,
        links,
    };
    let run = awareness.run.map(|r| (r.process, r.created));
    let run_changed = run.is_some() && held.run != run;
    if me.member_key(wire::STATUS, &held.me).as_ref() != Some(&status) {
        me.write(wire::STATUS, Some(&status), cx);
    }
    if run_changed {
        if let Some(held) = &mut me.held {
            held.run = run;
        }
        joining::write_file(me, cx);
    }
}

/// Raises `FlightChanged` for each member whose answer changed. A pilot flying who leaves
/// the flight passes control first, to a member still in it. Returns whether any answer
/// changed.
pub(crate) fn flight_changes(me: &mut Session, cx: &mut Cx) -> bool {
    let Some(held) = &me.held else {
        return false;
    };
    let mine = held.me;
    let changes: Vec<(PilotId, bool)> = me
        .members()
        .into_iter()
        .filter_map(|member| {
            let now = me.in_flight(&member);
            let before = held.flight.get(&member).copied().unwrap_or(false);
            (now != before).then_some((member, now))
        })
        .collect();
    if changes.is_empty() {
        return false;
    }
    // This core's own pilot leaving the flight while flying passes control before anything
    // hears the change, so the aircraft stays the one the new pilot flying flies.
    if changes.contains(&(mine, false)) && me.pf() == Some(mine) {
        control::pass_on(me, false, cx);
    }
    for (member, in_flight) in changes {
        if let Some(held) = &mut me.held {
            held.flight.insert(member, in_flight);
        }
        tracing::info!(
            member = hex(&member),
            in_flight,
            "a member {} the flight",
            if in_flight { "entered" } else { "left" }
        );
        cx.raise(FlightChanged { member, in_flight });
        if member == mine
            && !in_flight
            && matches!(me.preflight().phase, Phase::Running | Phase::Countdown)
        {
            crate::preflight::unready(me, "this pilot left the flight", cx);
        }
    }
    true
}

/// The notification for each other member's comings and goings, by its pilot ID.
fn notification_id(member: &PilotId) -> String {
    format!("crew-{}", hex(member))
}

/// Where a crewmate who was in the flight went, which the rest hear once each time it changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Away {
    LeftFlight,
    ClosedSim,
    Crashed,
}

/// What the crew hears of a member once the session has an aircraft, each shown once, since their
/// crew row says the rest: leaving the flight, closing their sim, crashing, and coming back
/// (record/areas/interface/decisions.md, "The banner carries what a pilot must see without the
/// EFB, and the rest shows where it's acted on").
pub(crate) fn notifications(me: &mut Session, cx: &Cx) {
    let Some(held) = &me.held else {
        return;
    };
    let mine = held.me;
    let preflight = me.preflight();
    let name = |m: &PilotId| me.name_of(m);
    let mut came_in = Vec::new();
    let mut away_now = Vec::new();
    for member in me.members().into_iter().filter(|m| *m != mine) {
        let in_flight = me.in_flight(&member);
        if in_flight {
            came_in.push(member);
        }
        let status = me.member_key(wire::STATUS, &member).unwrap_or_default();
        let before = held.away.get(&member).copied();
        let away = if in_flight || preflight.aircraft.is_none() || !held.was_in.contains(&member) {
            None
        } else {
            Some(match (status.stage, status.ended, before) {
                (Stage::Closed, Some(Ending::Crash { .. }), _) => Away::Crashed,
                (Stage::Closed, ..) => Away::ClosedSim,
                // A sim starting again after it closed or crashed is a pilot coming back, not
                // one leaving the flight, so nothing new is said until they're back in it.
                (_, _, Some(closed @ (Away::ClosedSim | Away::Crashed))) => closed,
                _ => Away::LeftFlight,
            })
        };
        if away == before {
            continue;
        }
        away_now.push((member, away));
        let who = name(&member);
        const STILL_IN: &str = "They're still in the session.";
        let told = |level, text: String| {
            Notification::new(level, text, Landing::Session)
                .about(hex(&member))
                .once()
        };
        let said = match away {
            Some(Away::LeftFlight) => told(Level::Information, format!("{who} left the flight"))
                .out()
                .detail(STILL_IN),
            Some(Away::ClosedSim) => told(Level::Information, format!("{who} closed their sim"))
                .out()
                .detail(STILL_IN),
            Some(Away::Crashed) => told(Level::Warning, format!("{who}'s sim crashed"))
                .out()
                .detail(STILL_IN),
            None if in_flight => told(Level::Information, format!("{who} is back in the flight")),
            None => continue,
        };
        clients::notify(cx, &notification_id(&member), said);
    }
    if let Some(held) = &mut me.held {
        held.was_in.extend(came_in);
        for (member, away) in away_now {
            match away {
                Some(away) => held.away.insert(member, away),
                None => held.away.remove(&member),
            };
        }
    }
}

/// Clears every notification of the session's, as it ends.
pub(crate) fn clear_notifications(held: &crate::Held, cx: &Cx) {
    for member in held.others.keys().chain(held.left.iter()) {
        clients::clear_notification(cx, &notification_id(member));
    }
}

/// Once preflight has ended, a session with no pilot in the flight ends, so control never
/// rests with a pilot who has no aircraft (record/areas/session/01-roles-and-members.md, "The
/// PF").
pub(crate) fn end_if_nobody_flies(me: &mut Session, cx: &mut Cx) {
    if me.preflight().phase != Phase::Ended {
        return;
    }
    if me.members().iter().any(|m| me.in_flight(m)) {
        return;
    }
    tracing::info!("preflight has ended and no member is in the flight, so the session ends");
    me.leave(cx, false);
}
