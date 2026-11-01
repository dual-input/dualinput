//! Pointer sync, the feature that plays one pilot's presses and drags on a synced display, an
//! instrument the profile's `displays` names, on the crew's copies of that display, and locks
//! those displays while a press there can't be synced
//! (record/areas/pointer-sync/01-pointer-sync.md).
//!
//! Its panel module, `pointer-sync`, captures each gesture in its panel and plays the crew's
//! there. This crate sends each message the module captured on the cockpit stream, keyed by
//! its instrument's key, hands each arriving one to the panels serving an instrument of that
//! key, and says in a slice whether this machine's displays lock.
//!
//! A gesture keeps its instrument's whole key, since a profile that names a bare identifier
//! such as `FCP` opts in the A220's four FCPs, `FCP|type=vs` to `FCP|type=speed`, which only
//! the query tells apart. So a key whose query carries the livery, as the A220's
//! `DisplayUnits|config=N324DU` does, plays nothing on another livery, a known limit (user,
//! 2026-10-25; record/areas/pointer-sync/log.md).

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use clients::{ClientLeft, ClientsUnit, Sender, To};
use cockpit_stream::{Answer, Applying, CockpitCx, CockpitStream, CockpitUnit, Delivered};
use kernel::{Cx, Registry, TimerId, View};
use messages::pointer_sync::{FromPanel, GESTURE, Gesture, Lock, NAME, Play};
use messages::session::Phase;
use network::Network;
use profile_loader::Profiles;
use session::Session;

/// An up holds back every cockpit message after it until its click has played, so one whose
/// panels never say they played it counts as applied after this, and a broken module holds
/// back no later message, state sync's included, for longer (user, 2026-10-23).
const UP_WAITS: Duration = Duration::from_secs(1);

/// Pointer sync's state.
#[derive(Default)]
pub struct PointerSync {
    /// The instruments each panel's module serves, by their keys, by the panel's socket.
    panels: BTreeMap<u64, Vec<String>>,
    /// The up the panels are playing. The stream applies no other message while one is
    /// unfinished, but the next of its kind and key, so at most one waits.
    up: Option<WaitingUp>,
    /// The last up's number, which the panels' `Done` names.
    last_up: u32,
}

struct WaitingUp {
    number: u32,
    /// Its instrument's key.
    display: String,
    applying: Applying,
    /// The panels serving the instrument that haven't said they played the up.
    panels: BTreeSet<u64>,
    timer: TimerId,
}

/// Registers pointer sync.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<PointerSync>(NAME);
    me.panel_module(NAME, PointerSync::displays, PointerSync::any_displays)
        .client_messages(NAME, PointerSync::from_panel)
        .client_state(NAME, PointerSync::lock);
    // A panel whose socket a reload replaced leaves too, as the clients crate closes the old
    // socket, so an up handed to it counts as played.
    me.on::<ClientLeft>(PointerSync::left);
    me.cockpit_kind(GESTURE, PointerSync::play);
}

/// Whether one of the profile's displays opts in an instrument by its key: a bare identifier,
/// such as `FCP`, names every instrument that carries it, whatever its url's query, and a full
/// key names exactly that instrument (record/areas/profiles/01-format-and-delivery.md,
/// "Displays").
fn names(display: &str, instrument: &str) -> bool {
    if display.contains('|') {
        display == instrument
    } else {
        instrument.split('|').next() == Some(display)
    }
}

/// The loaded profile's displays, or none while no profile is loaded.
fn profile_displays<'v>(view: &'v View<'_>) -> &'v [String] {
    view.read::<Profiles>()
        .loaded()
        .map(|l| profile_engine::features::pointer_sync::displays(&l.profile))
        .unwrap_or_default()
}

impl PointerSync {
    /// The panel module's rule: the instruments of a panel that the loaded profile's displays
    /// name.
    fn displays(view: &View, instruments: &[String]) -> Vec<String> {
        let displays = profile_displays(view);
        instruments
            .iter()
            .filter(|i| displays.iter().any(|d| names(d, i)))
            .cloned()
            .collect()
    }

    /// Whether the loaded profile names a display for the panel module to serve.
    fn any_displays(view: &View) -> bool {
        !profile_displays(view).is_empty()
    }

    fn from_panel(me: &mut PointerSync, from: Sender, message: FromPanel, cx: &mut Cx) {
        match message {
            FromPanel::Displays { displays } => {
                tracing::debug!(
                    socket = from.socket,
                    ?displays,
                    "a panel's pointer sync module serves its displays"
                );
                // A module that stopped serves none, so no up waits on its panel.
                if let Some(up) = me.up.as_mut()
                    && !displays.contains(&up.display)
                {
                    up.panels.remove(&from.socket);
                }
                me.panels.insert(from.socket, displays);
                me.maybe_applied(cx);
            }
            // The stream sends none before preflight ends or while this member is out of the
            // flight, so a press then acts on its own display alone.
            FromPanel::Gesture { display, gesture } => {
                cx.cockpit().send(GESTURE, &display, &gesture)
            }
            FromPanel::Done { up } => me.played(from.socket, up, cx),
        }
    }

    /// Another machine's gesture message, in the stream's order.
    fn play(me: &mut PointerSync, d: Delivered<Gesture>, cx: &mut Cx) -> Answer {
        // The stream counts an up still waiting as applied once the next message for its
        // display comes, so the panels' answer to it counts for nothing.
        if me.up.as_ref().is_some_and(|u| u.display == d.key)
            && let Some(up) = me.up.take()
        {
            cx.cancel_timer(up.timer);
        }
        // Any catch-up but preflight's end's skips gestures, since its displays may show other
        // pages than the ones a gesture was made on. Preflight's end's skips none, since
        // neither cockpit's displays were touched in preflight, so the PF's first presses play
        // once its writes are made (record/areas/pointer-sync/01-pointer-sync.md, "Playing a
        // gesture").
        if cx.read::<CockpitStream>().catching_up() == Some(false) {
            return Answer::Skipped;
        }
        // The panels serving an instrument of the key, which alone get the message, so a panel
        // gets none of the messages for another panel's display.
        let panels: BTreeSet<u64> = me
            .panels
            .iter()
            .filter(|(_, instruments)| instruments.contains(&d.key))
            .map(|(&socket, _)| socket)
            .collect();
        if panels.is_empty() {
            return Answer::Skipped;
        }
        let up = matches!(d.body, Gesture::Up { .. }).then(|| {
            me.last_up = me.last_up.wrapping_add(1);
            me.last_up
        });
        let play = Play {
            display: d.key.clone(),
            gesture: d.body,
            up,
        };
        for &socket in &panels {
            clients::send(cx, To::Socket(socket), NAME, &play);
        }
        let Some(number) = up else {
            return Answer::Done;
        };
        me.up = Some(WaitingUp {
            number,
            display: d.key,
            applying: d.id,
            panels,
            timer: cx.timer(UP_WAITS, PointerSync::up_waited),
        });
        Answer::Unfinished
    }

    /// A panel played the up numbered `number` through.
    fn played(&mut self, socket: u64, number: u32, cx: &mut Cx) {
        if let Some(up) = self.up.as_mut().filter(|u| u.number == number) {
            up.panels.remove(&socket);
        }
        self.maybe_applied(cx);
    }

    fn left(me: &mut PointerSync, left: &ClientLeft, cx: &mut Cx) {
        if me.panels.remove(&left.socket).is_none() {
            return;
        }
        if let Some(up) = me.up.as_mut() {
            up.panels.remove(&left.socket);
        }
        me.maybe_applied(cx);
    }

    fn maybe_applied(&mut self, cx: &mut Cx) {
        if self.up.as_ref().is_some_and(|u| u.panels.is_empty())
            && let Some(up) = self.up.take()
        {
            cx.cancel_timer(up.timer);
            cx.cockpit().applied(up.applying);
        }
    }

    fn up_waited(me: &mut PointerSync, timer: TimerId, cx: &mut Cx) {
        if me.up.as_ref().is_some_and(|u| u.timer == timer)
            && let Some(up) = me.up.take()
        {
            tracing::info!(
                display = up.display,
                panels = up.panels.len(),
                "a display's panel didn't say it played another pilot's up within 1s, so the up counts as applied"
            );
            cx.cockpit().applied(up.applying);
        }
    }

    /// The visible lock's slice. On a machine other than the PF's, every synced display locks
    /// while this core has no link up to the PF, naming taking control as the way out, and
    /// while a replay or a catch-up runs here, since its pilot's presses would otherwise reach
    /// the crew's displays while their gestures play nowhere. Preflight locks nothing, since
    /// the stream sends no gesture then.
    fn lock(_: &PointerSync, view: &View) -> Lock {
        let session = view.read::<Session>();
        let (Some(me), Some(pf)) = (session.me(), session.pf()) else {
            return Lock::None;
        };
        if me == pf || session.preflight().phase != Phase::Ended {
            return Lock::None;
        }
        if !view.read::<Network>().up(&pf) {
            return Lock::NoLink;
        }
        let stream = view.read::<CockpitStream>();
        if stream.catching_up().is_some() || !stream.replaying().is_empty() {
            Lock::CatchingUp
        } else {
            Lock::None
        }
    }
}

#[cfg(test)]
mod tests {
    use messages::cockpit::{Cockpit, CockpitMessage, Origin, VectorClock};
    use messages::pointer_sync::{GESTURE, Gesture, Point};
    use messages::session::Control;

    use super::names;

    /// A drag sends about 30 moves a second, so at about 100 bytes each, the design's estimate,
    /// it costs about 3 KB/s before packet headers, and 120 bytes, 3.6 KB/s, is past "about"
    /// (record/areas/pointer-sync/01-pointer-sync.md, "Budgets"). Pilot IDs, in the sender, the
    /// clock's two counters, and the control value, take 64 of the bytes.
    #[test]
    fn a_moves_cockpit_message_is_about_100_bytes() {
        let me = Origin {
            pilot: [1; 16],
            restart: 2,
        };
        let mut clock = VectorClock::default();
        clock.set(me, 12_000);
        clock.set(
            Origin {
                pilot: [2; 16],
                restart: 0,
            },
            3_000,
        );
        let point = Point { x: 0.5, y: 0.25 };
        let message = CockpitMessage {
            sender: me,
            clock,
            control: Control::default(),
            gap: 33_000,
            kind: GESTURE.number,
            key: "BlackSquareTablet".into(),
            body: postcard::to_stdvec(&Gesture::Move { point }).expect("a move should encode"),
        };
        let bytes = postcard::to_stdvec(&Cockpit::Message(message))
            .expect("a cockpit message should encode")
            .len();
        println!("budget: a move's cockpit message is {bytes} bytes, against about 100");
        assert!(bytes <= 120, "{bytes} bytes");
    }

    #[test]
    fn a_bare_identifier_names_every_instrument_that_carries_it_and_a_full_key_names_one() {
        assert!(names("DisplayUnits", "DisplayUnits|config=N324DU"));
        assert!(names("BlackSquareTablet", "BlackSquareTablet"));
        assert!(!names(
            "DisplayUnits|config=Default",
            "DisplayUnits|config=N324DU"
        ));
        assert!(names("CTP|side=left", "CTP|side=left"));
        assert!(!names("CTP|side=left", "CTP|side=right"));
        assert!(!names("Display", "DisplayUnits"));
    }
}
