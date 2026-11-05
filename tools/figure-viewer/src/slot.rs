//! `Figure`'s slot as avatars feeds it: this machine's yokes, laid out from aircraft-model's
//! as avatars' figures.rs lays them out in `yoke`, so change both together, and one figure.

use aircraft_model::Yoke;
use messages::avatars::slots::{FigureSlot, FigureState, PoseSlot, SAMPLES, StageSlot, YokeSlot};

use crate::seat::Seat;

/// The figure's object, as `create_ai` would give it.
pub const OBJECT: u32 = 0x100;

/// Each yoke's slot, the pilot's then the copilot's, with none where the model has none.
pub fn yokes(found: &[Yoke]) -> [YokeSlot; 2] {
    let mut out: [YokeSlot; 2] = bytemuck::Zeroable::zeroed();
    for y in found {
        out[usize::from(!y.left)] = yoke(y);
    }
    out
}

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

/// What a script feeds for its one figure, in the frame avatars works in.
#[derive(Clone, Copy, Debug)]
pub struct Fed {
    pub pose: PoseSlot,
    pub color: u32,
    pub shows: u32,
    pub slumps: bool,
}

/// The slot for one figure in `seat`, with `yokes`.
pub fn slot(yokes: &[YokeSlot; 2], seat: &Seat, fed: &Fed) -> FigureSlot {
    let mut slot: FigureSlot = bytemuck::Zeroable::zeroed();
    slot.yokes = *yokes;
    slot.figures[0] = FigureState {
        object: OBJECT,
        color: fed.color,
        shows: fed.shows,
        slumps: u32::from(fed.slumps),
        own: 0,
        hip: seat.hip,
        knees: seat.knees,
        feet: seat.feet,
        facing: seat.facing,
        pose: fed.pose,
    };
    slot.count = 1;
    slot
}

#[cfg(test)]
mod tests {
    use aircraft_model::{Var, YokeStage};

    use super::*;

    #[test]
    fn a_copilots_yoke_goes_second_with_its_variable_named_and_padded() {
        let stage = YokeStage {
            before: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            var: Var {
                kind: 'A',
                name: "YOKE Y POSITION WITH AP".into(),
                unit: "Percent".into(),
            },
            slope: 0.5,
            intercept: 50.0,
            length: 100.0,
            samples: vec![([0.0; 3], [0.0, 0.0, 0.0, 1.0]); SAMPLES],
            scale: [1.0; 3],
        };
        let copilot = Yoke {
            left: false,
            node: 3,
            last: 4,
            base: [0.0; 12],
            stages: vec![stage],
            grips: [[0.1, 0.0, 0.0], [-0.1, 0.0, 0.0]],
        };
        let [pilot, copilot] = yokes(&[copilot]);
        assert_eq!(pilot.present, 0);
        assert_eq!((copilot.present, copilot.stage_count), (1, 1));
        let var = &copilot.stages[0].var;
        assert_eq!(&var[..25], b"A:YOKE Y POSITION WITH AP");
        assert_eq!(var[25], 0);
        assert_eq!(&copilot.stages[0].unit[..8], b"Percent\0");
    }
}
