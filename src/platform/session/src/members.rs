//! The members: who takes part in the session, each one's status, and who is in the flight
//! (record/areas/session/02-units.md, "Members" and "In the flight").

use clients::{Landing, Level};
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
        let Some(held) = &mut self.held else {
            return;
        };
        if held.others.remove(&member).is_none() {
            return;
        }
        held.left.insert(member);
        held.crew.remove(&member);
        held.was_in.remove(&member);
        held.store.forget(member);
        clients::clear_notification(cx, &notification_id(&member));
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

/// The notification for each other member out of the flight, by its pilot ID.
fn notification_id(member: &PilotId) -> String {
    format!("out-{}", hex(member))
}

/// What the crew hears of members out of the flight once the session has an aircraft: a
/// member whose sim closed or crashed, one in another aircraft, and one that left the flight
/// (record/areas/product/03-v1-scope.md, "The connection"); and this pilot's own notification to
/// load the session's aircraft, such as "Load the L1011-500 Cabin w/ Lounge to fly with
/// James" (record/areas/session/02-units.md, "In the flight").
pub(crate) fn notifications(me: &mut Session, cx: &Cx) {
    let Some(held) = &me.held else {
        return;
    };
    let mine = held.me;
    let preflight = me.preflight();
    let name = |m: &PilotId| {
        me.member_key(wire::MEMBER, m)
            .map_or_else(|| "A pilot".to_string(), |e| e.name)
    };
    let named = |status: &Status| {
        status
            .title
            .clone()
            .or_else(|| status.aircraft.as_ref().map(|a| a.folder().to_string()))
            .unwrap_or_else(|| "another aircraft".into())
    };
    let pf_status = me.pf().and_then(|pf| me.member_key(wire::STATUS, &pf));
    // This pilot, in a flight with another aircraft than the session's.
    let mine_status = me.member_key(wire::STATUS, &mine);
    let elsewhere = preflight.aircraft.is_some()
        && mine_status
            .as_ref()
            .is_some_and(|s| flying(s.stage) && !me.in_flight(&mine));
    match (elsewhere, me.pf(), &pf_status) {
        (true, Some(pf), Some(status)) if pf != mine => clients::notify(
            cx,
            "load",
            Level::Warning,
            &format!("Load the {} to fly with {}", named(status), name(&pf)),
            None,
            Landing::Session,
        ),
        _ => clients::clear_notification(cx, "load"),
    }
    let mut came_in = Vec::new();
    for member in me.members().into_iter().filter(|m| *m != mine) {
        let in_flight = me.in_flight(&member);
        if in_flight {
            came_in.push(member);
        }
        let status = me.member_key(wire::STATUS, &member).unwrap_or_default();
        let was_in = held.was_in.contains(&member);
        let text = match (in_flight, status.stage, status.ended) {
            (true, _, _) => None,
            _ if preflight.aircraft.is_none() => None,
            (_, Stage::Closed, Some(Ending::Crash { .. })) if was_in => Some((
                Level::Warning,
                format!(
                    "{}'s sim crashed. Dual Input rejoins them once they're back in a flight",
                    name(&member)
                ),
            )),
            (_, Stage::Closed, _) if was_in => Some((
                Level::Information,
                format!(
                    "{}'s sim closed. Dual Input rejoins them once they're back in a flight",
                    name(&member)
                ),
            )),
            (_, stage, _) if flying(stage) => Some((
                Level::Information,
                format!("{} is in the {}", name(&member), named(&status)),
            )),
            _ if was_in => Some((
                Level::Information,
                format!(
                    "{} left the flight. Dual Input rejoins them once they're back in it",
                    name(&member)
                ),
            )),
            _ => None,
        };
        match text {
            Some((level, text)) => clients::notify(
                cx,
                &notification_id(&member),
                level,
                &text,
                None,
                Landing::Session,
            ),
            None => clients::clear_notification(cx, &notification_id(&member)),
        }
    }
    if let Some(held) = &mut me.held {
        held.was_in.extend(came_in);
    }
}

/// Clears every notification of the session's, as it ends.
pub(crate) fn clear_notifications(held: &crate::Held, cx: &Cx) {
    clients::clear_notification(cx, "load");
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
