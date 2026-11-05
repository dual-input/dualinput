//! The figures this machine draws, and `Figure`'s slot, which carries them with each yoke
//! (record/areas/avatars/01-avatars.md, "Drawing on every machine").

use aircraft_model::Yoke;
use messages::avatars::slots::{
    BODY_HEAD, BODY_ON_FOOT, BODY_SEATED, FIGURES, FigureSlot, FigureState, HAND_GRIP, HAND_POINT,
    HAND_REST, HAND_THUMB, HandSlot, PoseSlot, SAMPLES, StageSlot, YokeSlot,
};
use messages::avatars::{Body, GRAY, Hand, Pose, Side};

use crate::seats::Place;

/// How a figure looks on this machine, from its member's state as this machine sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Look {
    /// As its pose has it.
    Live,
    /// Slumped and gray: its member out of the flight, or its link lost while this PC
    /// reaches the internet.
    Slumped,
    /// At rest in its own colors, the PF's holding its yoke: this PC reaches no one.
    Resting,
    /// Gray without slumping: this pilot's own figure while this PC reaches no one.
    Gray,
}

/// One figure as the slot carries it.
pub(crate) struct Drawn<'a> {
    pub(crate) object: u32,
    /// Whether it's this pilot's own.
    pub(crate) own: bool,
    pub(crate) pose: &'a Pose,
    pub(crate) seat: Option<&'a Place>,
    pub(crate) color: u8,
    pub(crate) shows: u32,
    pub(crate) look: Look,
    /// For `Look::Resting`: the hands at rest, the PF's holding its yoke.
    pub(crate) rest: [Hand; 2],
}

/// The slot `Figure` is fed: this machine's yokes, then each figure, up to the slot's
/// eight.
pub(crate) fn slot<'a>(yokes: &[Yoke], figures: impl Iterator<Item = Drawn<'a>>) -> FigureSlot {
    let mut slot: FigureSlot = bytemuck::Zeroable::zeroed();
    for y in yokes {
        slot.yokes[usize::from(!y.left)] = yoke(y);
    }
    let mut count = 0;
    for (place, figure) in slot.figures.iter_mut().zip(figures) {
        *place = state(&figure);
        count += 1;
    }
    slot.count = count;
    slot
}

/// A yoke's grips and animations, as `Figure`'s slot holds them. `yoke` in
/// tools/figure-viewer's slot.rs lays them out the same way, so change both together.
fn yoke(y: &Yoke) -> YokeSlot {
    let mut slot: YokeSlot = bytemuck::Zeroable::zeroed();
    slot.present = 1;
    slot.stage_count = y.stages.len().min(2) as u32;
    slot.base = y.base;
    slot.grips = y.grips;
    for (to, from) in slot.stages.iter_mut().zip(&y.stages) {
        *to = StageSlot {
            var: padded(&format!("{}:{}", from.var.kind, from.var.name)),
            unit: padded(if from.var.unit.is_empty() {
                "number"
            } else {
                &from.var.unit
            }),
            slope: from.slope,
            intercept: from.intercept,
            length: from.length,
            before: from.before,
            scale: from.scale,
            samples: std::array::from_fn(|i| {
                let (t, r) = from.samples.get(i).copied().unwrap_or_default();
                [t[0], t[1], t[2], r[0], r[1], r[2], r[3]]
            }),
        };
    }
    debug_assert!(y.stages.iter().all(|s| s.samples.len() == SAMPLES));
    slot
}

/// `text` in `N` bytes, padded with zero bytes, cut to leave at least one.
fn padded<const N: usize>(text: &str) -> [u8; N] {
    let mut out = [0; N];
    let n = text.len().min(N - 1);
    out[..n].copy_from_slice(&text.as_bytes()[..n]);
    out
}

fn state(f: &Drawn) -> FigureState {
    let (hip, knees, feet, facing) = f.seat.map_or(([0.0; 3], [0.0; 2], [0.0; 2], 0.0), |s| {
        (s.hip, s.knees, s.feet, s.facing)
    });
    let mut pose = pose_slot(f.pose);
    let gray = matches!(f.look, Look::Slumped | Look::Gray);
    if f.look == Look::Resting {
        pose.hands = f.rest.map(hand_slot);
    }
    FigureState {
        object: f.object,
        color: u32::from(if gray { GRAY } else { f.color }),
        shows: f.shows,
        slumps: u32::from(f.look == Look::Slumped),
        own: u32::from(f.own),
        hip,
        knees,
        feet,
        facing,
        pose,
    }
}

fn pose_slot(pose: &Pose) -> PoseSlot {
    let mut slot: PoseSlot = bytemuck::Zeroable::zeroed();
    match &pose.body {
        Body::Seated { eye, look, .. } => {
            slot.body = BODY_SEATED;
            slot.eye = *eye;
            slot.look = *look;
        }
        Body::Head { eye, look } => {
            slot.body = BODY_HEAD;
            slot.eye = *eye;
            slot.look = *look;
        }
        Body::OnFoot {
            at,
            heading,
            crouch,
        } => {
            slot.body = BODY_ON_FOOT;
            slot.at = *at;
            slot.heading = *heading;
            slot.crouch = u32::from(*crouch);
        }
    }
    slot.hands = pose.hands.map(hand_slot);
    slot
}

fn hand_slot(hand: Hand) -> HandSlot {
    let (kind, side, point) = match hand {
        Hand::Rest => (HAND_REST, 0, [0.0; 3]),
        Hand::Grip(side) => (HAND_GRIP, u32::from(side == Side::Right), [0.0; 3]),
        Hand::Thumb(p) => (HAND_THUMB, 0, p),
        Hand::Point(p) => (HAND_POINT, 0, p),
    };
    HandSlot { kind, side, point }
}

/// The most figures one slot holds, which a crew of eight fills.
pub(crate) const MOST: usize = FIGURES;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slumped_figure_turns_gray_and_a_resting_one_rests_its_hands() {
        let pose = Pose {
            at: 0,
            body: Body::Head {
                eye: [0.3, 0.8, 1.3],
                look: [0.0, 0.0, 1.0],
            },
            hands: [Hand::Point([0.4, 0.6, 1.9]), Hand::Rest],
        };
        let drawn = |look| Drawn {
            object: 0x100,
            own: false,
            pose: &pose,
            seat: None,
            color: 1,
            shows: messages::avatars::slots::SHOWS_ALL,
            look,
            rest: [Hand::Grip(Side::Left), Hand::Rest],
        };
        let slot = slot(
            &[],
            [drawn(Look::Slumped), drawn(Look::Resting)].into_iter(),
        );
        assert_eq!(slot.count, 2);
        assert_eq!(
            (slot.figures[0].color, slot.figures[0].slumps),
            (u32::from(GRAY), 1)
        );
        assert_eq!(slot.figures[1].color, 1);
        assert_eq!(slot.figures[1].pose.hands[0].kind, HAND_GRIP);
        assert_eq!(slot.yokes[0].present, 0);
    }
}
