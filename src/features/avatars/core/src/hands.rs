//! Where this pilot's figure's hands go: home at rest, out to a press or a located change,
//! and back (record/areas/avatars/01-avatars.md, "Which hand, and its target", and "A change
//! made without a click").
//!
//! The pilot's machine decides every target, the overlap of two hands on a yoke included,
//! so `Figure` only eases each hand to the target it's given. Every time below is a starting
//! value, p27's, to be tuned in the 58P in the sim (record/areas/avatars/decisions.md, "The hands
//! follow a pilot's habits"). Times are in µs on the core's counter, from the input each change
//! came in, so a replay moves the hands the same way.

use messages::avatars::{Hand, Side};

use crate::v3::{self, V3};

/// How long a hand stays on its spot after a release.
const SPOT: u64 = 150_000;
/// After a wheel notch.
const SPOT_WHEEL: u64 = 1_000_000;
/// A notch within this long of the last keeps the hand on its spot.
const NOTCHES: u64 = 600_000;
/// How long a hand hovers off its spot before the hands go home.
const HOVER: u64 = 500_000;
/// How far off the spot a hand hovers, along the surface's normal, in meters.
const HOVER_OFF: f32 = 0.015;
/// How long a hand takes to come home, the length of `Figure`'s curve back, and how long
/// past its arrival the hand that stood in on the yoke keeps its grip.
const HOME: u64 = 300_000;
const OVERLAP: u64 = 300_000;
/// A located change waits this long before its hand reaches, and a second entry's change
/// within it brings no hand, so a hardware panel that sends many switches at once moves none
/// (user, 2026-10-17).
const SETTLE: u64 = 100_000;
/// A click this far either side of the wheel's center picks the hand on that side; between
/// the two, the free hand clicks.
const BAND: f32 = 0.05;
/// The figure's hand's radius, in meters, which a hand's center sits out from a surface, the
/// probes' (read in experiments/areas/avatars/p25-figure-hands.mjs, `HAND_RADIUS`). The
/// figure's spec, src/features/avatars/figure/figure.json, gives its hand the same radius, so
/// change both together.
pub(crate) const HAND_RADIUS: f32 = 0.038;

/// How the hands sit at rest and which picks a click.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Rules {
    /// The yoke in front of the seat, when this machine's model has it and the pilot sits.
    pub(crate) yoke: Option<Side>,
    /// Whether this pilot flies, so their figure holds that yoke at rest.
    pub(crate) pf: bool,
    /// In the left seat, the left hand holds the yoke at rest; in the right seat, the right.
    pub(crate) left_seat: bool,
}

impl Rules {
    /// The hand that holds the yoke at rest, the PF's alone.
    fn holder(&self) -> Option<usize> {
        let _ = self.yoke.filter(|_| self.pf)?;
        Some(if self.left_seat { 0 } else { 1 })
    }

    fn grip(&self) -> Hand {
        self.yoke.map_or(Hand::Rest, Hand::Grip)
    }
}

/// What a hand reaches for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Target {
    /// Its center at `at`, which hovers along `normal`.
    Point { at: V3, normal: V3 },
    /// A button of the seat's own yoke, in the frame of its last animated node.
    Thumb(V3),
    /// A grab of the yoke's wheel.
    Grip(Side),
}

#[derive(Clone, Debug, PartialEq)]
struct Out {
    hand: usize,
    target: Target,
    /// While the press is held, the hand stays.
    held: bool,
    spot_until: u64,
    hover_until: u64,
    /// The wheel's last notch, while the hand is out for one.
    notch: Option<u64>,
    /// The located entry it reached for, while it's out for one.
    entry: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct Waiting {
    entry: String,
    target: Target,
    hand: usize,
    since: u64,
    crowded: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Hands {
    out: Option<Out>,
    /// The hand that held the yoke while its holder was out keeps its grip until then.
    letting_go: Option<(usize, u64)>,
    waiting: Option<Waiting>,
}

impl Hands {
    /// Which hand a press picks, from how far left of the wheel's center, or of the figure's
    /// middle, the press is, in meters.
    pub(crate) fn hand_for(&self, rules: &Rules, left_of_center: f32) -> usize {
        if rules.holder().is_none() {
            return if left_of_center >= 0.0 { 0 } else { 1 };
        }
        if left_of_center > BAND {
            0
        } else if left_of_center < -BAND {
            1
        } else {
            1 - self.yoke_hand(rules).unwrap_or(0)
        }
    }

    /// The hand on the yoke now, while the PF's figure holds one.
    fn yoke_hand(&self, rules: &Rules) -> Option<usize> {
        let holder = rules.holder()?;
        match &self.out {
            Some(o) if o.hand == holder && !matches!(o.target, Target::Thumb(_)) => {
                Some(1 - holder)
            }
            _ => Some(holder),
        }
    }

    /// A press sets its hand's target at once. A hand leaving the yoke goes at once too,
    /// since the sim acts on the click at once.
    pub(crate) fn press(&mut self, hand: usize, target: Target) {
        self.out = Some(Out {
            hand,
            target,
            held: true,
            spot_until: 0,
            hover_until: 0,
            notch: None,
            entry: None,
        });
        self.waiting = None;
    }

    /// While a press is held, a hand out to a spot follows the cursor. A hand on the yoke stays
    /// there, since the mouse's tremor during a press would otherwise take it off the horn.
    pub(crate) fn drag(&mut self, target: Target) {
        if let Some(o) = self
            .out
            .as_mut()
            .filter(|o| o.held && matches!(o.target, Target::Point { .. }))
        {
            o.target = target;
        }
    }

    pub(crate) fn release(&mut self, now: u64) {
        if let Some(o) = self.out.as_mut().filter(|o| o.held) {
            o.held = false;
            o.spot_until = now + SPOT;
            o.hover_until = o.spot_until + HOVER;
        }
    }

    /// A wheel notch is a tap that stays on its spot 1s, and a notch within 600ms of the
    /// last keeps the hand where it is.
    pub(crate) fn notch(&mut self, hand: usize, target: Target, now: u64) {
        let keeps = self
            .out
            .as_ref()
            .and_then(|o| o.notch)
            .is_some_and(|last| now.saturating_sub(last) <= NOTCHES);
        if !keeps {
            self.press(hand, target);
        }
        if let Some(o) = self.out.as_mut() {
            o.held = false;
            o.notch = Some(now);
            o.spot_until = now + SPOT_WHEEL;
            o.hover_until = o.spot_until + HOVER;
        }
    }

    /// A located entry changed with no click: its hand reaches after 100ms, unless a hand is
    /// out from a press, or another entry changes within that time. A run of one entry's
    /// changes keeps its hand on the spot.
    pub(crate) fn located(&mut self, entry: &str, hand: usize, target: Target, now: u64) {
        if let Some(o) = self.out.as_mut() {
            if o.entry.as_deref() == Some(entry) {
                o.spot_until = now + SPOT;
                o.hover_until = o.spot_until + HOVER;
            }
            return;
        }
        match self.waiting.as_mut() {
            Some(w) if w.entry != entry && now.saturating_sub(w.since) <= SETTLE => {
                w.crowded = true;
                w.since = now;
            }
            Some(w) if w.entry == entry => {
                w.target = target;
                w.hand = hand;
            }
            _ => {
                self.waiting = Some(Waiting {
                    entry: entry.to_string(),
                    target,
                    hand,
                    since: now,
                    crowded: false,
                })
            }
        }
    }

    /// Moves the hands on as time passes: a located reach starts once it has settled, and
    /// a hand whose hover is over goes home.
    pub(crate) fn tick(&mut self, rules: &Rules, now: u64) {
        if let Some(w) = self.waiting.take() {
            if now.saturating_sub(w.since) < SETTLE {
                self.waiting = Some(w);
            } else if !w.crowded && self.out.is_none() {
                self.out = Some(Out {
                    hand: w.hand,
                    target: w.target,
                    held: false,
                    spot_until: now + SPOT,
                    hover_until: now + SPOT + HOVER,
                    notch: None,
                    entry: Some(w.entry),
                });
            }
        }
        if self.letting_go.is_some_and(|(_, until)| now >= until) {
            self.letting_go = None;
        }
        let Some(o) = self
            .out
            .as_ref()
            .filter(|o| !o.held && now >= o.hover_until)
        else {
            return;
        };
        // The hand coming to the yoke takes it first, and the hand that stood in keeps its
        // grip until 0.3s after the other's arrival, so both hold it for that time.
        if rules.holder() == Some(o.hand) && !matches!(o.target, Target::Thumb(_)) {
            self.letting_go = Some((1 - o.hand, now + HOME + OVERLAP));
        }
        self.out = None;
    }

    /// Where each hand goes now, the left then the right.
    pub(crate) fn targets(&self, rules: &Rules, now: u64) -> [Hand; 2] {
        let mut hands = [Hand::Rest; 2];
        if let Some(h) = rules.holder() {
            hands[h] = rules.grip();
        }
        // Before a hand that's out, which leaves the yoke at once, and only while this pilot's
        // figure holds a yoke, so control passed lets go at once too.
        if let Some((h, until)) = self.letting_go
            && now < until
            && rules.holder().is_some()
        {
            hands[h] = rules.grip();
        }
        if let Some(o) = &self.out {
            let hovering = !o.held && now >= o.spot_until;
            hands[o.hand] = match o.target {
                Target::Point { at, normal } if hovering => {
                    Hand::Point(v3::add(at, v3::scale(normal, HOVER_OFF)))
                }
                Target::Point { at, .. } => Hand::Point(at),
                Target::Thumb(p) => Hand::Thumb(p),
                Target::Grip(side) => Hand::Grip(side),
            };
            if self.yoke_hand(rules) == Some(1 - o.hand) {
                hands[1 - o.hand] = rules.grip();
            }
        }
        hands
    }
}

/// A hit's target: the hand's center one hand's radius out along the normal.
pub(crate) fn point(hit: V3, normal: V3) -> Target {
    Target::Point {
        at: v3::add(hit, v3::scale(normal, HAND_RADIUS)),
        normal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PF_LEFT: Rules = Rules {
        yoke: Some(Side::Left),
        pf: true,
        left_seat: true,
    };
    const MS: u64 = 1_000;

    fn spot() -> Target {
        point([0.4, 0.6, 1.9], [0.0, 0.0, -1.0])
    }

    /// 01-avatars' case: a left tap on the left side of the panel by the PF in the left
    /// seat: the left hand reaches, the right takes the yoke at once, and 650ms after the
    /// release the left takes the yoke and the right lets go 0.3s after it arrives.
    #[test]
    fn a_left_tap_by_the_pf_in_the_left_seat_swaps_the_yoke_and_back() {
        let mut hands = Hands::default();
        let grip = Hand::Grip(Side::Left);
        assert_eq!(hands.targets(&PF_LEFT, 0), [grip, Hand::Rest]);
        let hand = hands.hand_for(&PF_LEFT, 0.2);
        assert_eq!(hand, 0);
        hands.press(hand, spot());
        let [left, right] = hands.targets(&PF_LEFT, 0);
        assert!(matches!(left, Hand::Point(_)));
        assert_eq!(right, grip, "the right takes the yoke at once");
        hands.release(100 * MS);
        hands.tick(&PF_LEFT, 249 * MS);
        let Hand::Point(on) = hands.targets(&PF_LEFT, 249 * MS)[0] else {
            panic!()
        };
        let Hand::Point(off) = hands.targets(&PF_LEFT, 250 * MS)[0] else {
            panic!()
        };
        assert!(
            (v3::distance(on, off) - HOVER_OFF).abs() < 1e-6,
            "it hovers 1.5cm off"
        );
        hands.tick(&PF_LEFT, 749 * MS);
        assert!(matches!(
            hands.targets(&PF_LEFT, 749 * MS)[0],
            Hand::Point(_)
        ));
        hands.tick(&PF_LEFT, 750 * MS);
        assert_eq!(hands.targets(&PF_LEFT, 750 * MS), [grip, grip]);
        hands.tick(&PF_LEFT, 1_349 * MS);
        assert_eq!(hands.targets(&PF_LEFT, 1_349 * MS), [grip, grip]);
        hands.tick(&PF_LEFT, 1_350 * MS);
        assert_eq!(hands.targets(&PF_LEFT, 1_350 * MS), [grip, Hand::Rest]);
    }

    /// Runs of clicks are the normal case: the hand letting go of the yoke leaves at once for a
    /// new press, and at once when control passes.
    #[test]
    fn a_hand_letting_go_leaves_at_once_for_a_press_and_for_control_passed() {
        let mut hands = Hands::default();
        hands.press(0, spot());
        hands.release(0);
        hands.tick(&PF_LEFT, 650 * MS);
        assert_eq!(
            hands.targets(&PF_LEFT, 650 * MS),
            [Hand::Grip(Side::Left), Hand::Grip(Side::Left)]
        );
        let pm = Rules {
            pf: false,
            ..PF_LEFT
        };
        assert_eq!(
            hands.targets(&pm, 650 * MS),
            [Hand::Rest, Hand::Rest],
            "control passed lets go of the yoke at once"
        );
        hands.press(1, spot());
        let [left, right] = hands.targets(&PF_LEFT, 800 * MS);
        assert_eq!(left, Hand::Grip(Side::Left));
        assert!(
            matches!(right, Hand::Point(_)),
            "the hand letting go reaches at once: {right:?}"
        );
    }

    /// A press on the wheel with a hand's tremor keeps the hand on the horn.
    #[test]
    fn a_drag_moves_a_hand_out_to_a_spot_and_no_hand_on_the_yoke() {
        let mut hands = Hands::default();
        hands.press(0, Target::Grip(Side::Left));
        hands.drag(spot());
        assert_eq!(hands.targets(&PF_LEFT, 0)[0], Hand::Grip(Side::Left));
        hands.press(1, Target::Thumb([0.1, 0.0, 0.0]));
        hands.drag(spot());
        assert_eq!(hands.targets(&PF_LEFT, 0)[1], Hand::Thumb([0.1, 0.0, 0.0]));
        hands.press(0, spot());
        let next = point([0.0, 0.5, 1.9], [0.0, 0.0, -1.0]);
        hands.drag(next);
        let Hand::Point(at) = hands.targets(&PF_LEFT, 0)[0] else {
            panic!()
        };
        assert!(v3::distance(at, [0.0, 0.5, 1.9 - HAND_RADIUS]) < 1e-6);
    }

    #[test]
    fn the_band_picks_the_free_hand_and_a_figure_off_the_yoke_picks_by_side() {
        let hands = Hands::default();
        assert_eq!(hands.hand_for(&PF_LEFT, -0.06), 1);
        assert_eq!(hands.hand_for(&PF_LEFT, 0.03), 1, "the right is free");
        let pm = Rules {
            pf: false,
            ..PF_LEFT
        };
        assert_eq!(hands.hand_for(&pm, 0.01), 0);
        assert_eq!(hands.hand_for(&pm, -0.01), 1);
        assert_eq!(hands.targets(&pm, 0), [Hand::Rest; 2]);
    }

    #[test]
    fn a_thumb_leaves_the_holding_hand_on_the_yoke() {
        let mut hands = Hands::default();
        hands.press(1, Target::Thumb([0.1, 0.0, 0.0]));
        assert_eq!(
            hands.targets(&PF_LEFT, 0),
            [Hand::Grip(Side::Left), Hand::Thumb([0.1, 0.0, 0.0])]
        );
        hands.press(0, Target::Thumb([0.2, 0.0, 0.0]));
        assert_eq!(
            hands.targets(&PF_LEFT, 0),
            [Hand::Thumb([0.2, 0.0, 0.0]), Hand::Rest],
            "the holding hand's own thumb leaves the other at rest"
        );
    }

    #[test]
    fn a_notch_within_600ms_keeps_the_hand_on_its_spot_until_1_5s_after_the_last() {
        let mut hands = Hands::default();
        hands.notch(0, spot(), 0);
        hands.notch(0, point([0.0, 0.0, 0.0], [0.0, 1.0, 0.0]), 500 * MS);
        let Hand::Point(at) = hands.targets(&PF_LEFT, 600 * MS)[0] else {
            panic!()
        };
        assert!(v3::distance(at, [0.4, 0.6, 1.9 - HAND_RADIUS]) < 1e-6);
        hands.tick(&PF_LEFT, 1_999 * MS);
        assert!(matches!(
            hands.targets(&PF_LEFT, 1_999 * MS)[0],
            Hand::Point(_)
        ));
        hands.tick(&PF_LEFT, 2_000 * MS);
        assert_eq!(
            hands.targets(&PF_LEFT, 2_000 * MS)[1],
            Hand::Grip(Side::Left)
        );
    }

    #[test]
    fn a_located_change_waits_100ms_and_two_entries_at_once_bring_no_hand() {
        let mut hands = Hands::default();
        hands.located("battery", 0, spot(), 0);
        hands.tick(&PF_LEFT, 99 * MS);
        assert!(!matches!(
            hands.targets(&PF_LEFT, 99 * MS)[0],
            Hand::Point(_)
        ));
        hands.tick(&PF_LEFT, 100 * MS);
        assert!(matches!(
            hands.targets(&PF_LEFT, 100 * MS)[0],
            Hand::Point(_)
        ));

        let mut hands = Hands::default();
        hands.located("battery", 0, spot(), 0);
        hands.located("alternator", 0, spot(), 50 * MS);
        hands.tick(&PF_LEFT, 200 * MS);
        assert_eq!(
            hands.targets(&PF_LEFT, 200 * MS),
            [Hand::Grip(Side::Left), Hand::Rest]
        );

        let mut hands = Hands::default();
        hands.press(0, spot());
        hands.located("battery", 0, point([0.0; 3], [0.0, 1.0, 0.0]), 0);
        hands.tick(&PF_LEFT, 500 * MS);
        let Hand::Point(at) = hands.targets(&PF_LEFT, 500 * MS)[0] else {
            panic!()
        };
        assert!(
            v3::distance(at, [0.4, 0.6, 1.9 - HAND_RADIUS]) < 1e-6,
            "a hand out from a press keeps its target"
        );
    }

    #[test]
    fn a_run_of_one_entrys_changes_keeps_its_hand_on_the_spot() {
        let mut hands = Hands::default();
        hands.located("trim", 0, spot(), 0);
        hands.tick(&PF_LEFT, 100 * MS);
        for t in [200, 400, 600, 800] {
            hands.located("trim", 0, spot(), t * MS);
            hands.tick(&PF_LEFT, t * MS);
        }
        let Hand::Point(at) = hands.targets(&PF_LEFT, 900 * MS)[0] else {
            panic!()
        };
        assert!(
            v3::distance(at, [0.4, 0.6, 1.9 - HAND_RADIUS]) < 1e-6,
            "still on the spot"
        );
    }
}
