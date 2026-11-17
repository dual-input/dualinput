//! `Figure` run natively through the routine host, as its own tests run it, over a script's
//! frames, with what it wrote on the figure's object read back each frame: what the sim
//! would hold, joints left unwritten below what shows included.

use std::collections::BTreeMap;

use avatars_routines::Figure;
use avatars_routines::solve::CHANNELS;
use messages::avatars::FIGURE;
use messages::avatars::slots::{FigureSlot, YokeSlot};
use messages::module::slots::SlotHeader;
use routine_host::{Flag, Host, Ids, Named, Sim, USER};
use serde::Serialize;

use crate::place::{self, Placed};
use crate::scripts::Script;
use crate::seat::Seat;
use crate::slot::{self, OBJECT};

/// The sim's frame rate the scripts run at, and the page plays them at.
pub const FPS: u32 = 60;

/// The sim, as a test's stand-in for it: each variable by its object and name, and how many
/// writes the last frame made.
#[derive(Default)]
struct World {
    values: BTreeMap<(u32, String), f64>,
    names: Vec<String>,
    writes: u32,
}

impl Sim for World {
    fn frozen(&mut self, _: Flag) -> bool {
        false
    }
    fn set_frozen(&mut self, _: Flag, _: bool) {}
    fn look_up(&mut self, _: u32, named: &Named) -> Option<Ids> {
        let var = match self.names.iter().position(|n| *n == named.name) {
            Some(at) => at,
            None => {
                self.names.push(named.name.clone());
                self.names.len() - 1
            }
        };
        Some(Ids {
            var: var as i32,
            unit: 0,
        })
    }
    fn get(&mut self, object: u32, _: routine_host::Space, ids: Ids) -> Option<f64> {
        let name = self.names.get(ids.var as usize)?;
        Some(
            self.values
                .get(&(object, name.clone()))
                .copied()
                .unwrap_or(0.0),
        )
    }
    fn set(&mut self, object: u32, _: routine_host::Space, ids: Ids, value: f64) {
        if let Some(name) = self.names.get(ids.var as usize) {
            self.writes += 1;
            self.values.insert((object, name.clone()), value);
        }
    }
    fn reset(&mut self) -> bool {
        false
    }

    fn fire_h(&mut self, _: &str) {}

    fn call_preset(&mut self, _: &str, _: Option<f64>) {}

    fn key(&mut self, _: routine_host::Key, _: i32) {}

    fn camera(&mut self, _: u32) -> Option<messages::module::slots::CameraRead> {
        None
    }
}

impl World {
    fn on_figure(&self, name: &str) -> f64 {
        self.values
            .get(&(OBJECT, name.to_string()))
            .copied()
            .unwrap_or(0.0)
    }
}

/// One frame of the figure as the sim holds it after `Figure`'s writes.
#[derive(Clone, Debug, Serialize)]
pub struct Frame {
    /// Seconds into the script.
    pub t: f32,
    /// The 27 channels, in `CHANNELS`'s order, then the color and what shows.
    pub values: Vec<f32>,
    pub at: [f32; 3],
    pub facing: f32,
    pub pitch: f32,
    pub bank: f32,
    /// How many variables `Figure` wrote this frame, of the 35 a frame can write.
    pub writes: u32,
    /// Where each hand was sent, for a `Point`, in the aircraft's frame.
    pub targets: [Option<[f32; 3]>; 2],
}

/// Runs `script` from its start, feeding the slot each frame as the core rewrites it, with a
/// new feed whenever what it holds changed.
pub fn run(script: &Script, seat: &Seat, yokes: &[YokeSlot; 2]) -> Vec<Frame> {
    let mut host = Host::new(
        routine_host::routines![Figure],
        messages::SLOTS_HASH,
        messages::VERSION,
    );
    let mut world = World::default();
    let mut feeds = 0;
    let mut last: Option<FigureSlot> = None;
    let count = (script.seconds * FPS as f32).round() as u32;
    let mut frames = Vec::with_capacity(count as usize);
    for k in 0..=count {
        let t = k as f32 / FPS as f32;
        let clock = 1_000 + u64::from(k) * 1_000_000 / u64::from(FPS);
        let input = (script.at)(t);
        for (name, value) in &input.aircraft {
            let name = name.strip_prefix("A:").unwrap_or(name);
            world.values.insert((USER, name.to_string()), *value);
        }
        let slot = slot::slot(yokes, seat, &input.fed);
        if last.is_none_or(|l| bytemuck::bytes_of(&l) != bytemuck::bytes_of(&slot)) {
            feeds += 1;
            last = Some(slot);
        }
        let header = SlotHeader {
            feeds,
            end: 0,
            slots_hash: messages::SLOTS_HASH,
            counter: clock,
        };
        let mut bytes = bytemuck::bytes_of(&header).to_vec();
        bytes.extend_from_slice(bytemuck::bytes_of(&slot));
        host.written(FIGURE, &bytes, clock);
        world.writes = 0;
        host.frame(clock, &mut world);
        let mut values: Vec<f32> = CHANNELS
            .iter()
            .map(|c| world.on_figure(&format!("DUALINPUT_FIGURE_{c}")) as f32)
            .collect();
        values.push(world.on_figure("DUALINPUT_FIGURE_COLOR") as f32);
        values.push(world.on_figure("DUALINPUT_FIGURE_SHOWS") as f32);
        let Placed {
            at,
            facing,
            pitch,
            bank,
        } = place::in_aircraft(
            world.on_figure("PLANE LATITUDE"),
            world.on_figure("PLANE LONGITUDE"),
            world.on_figure("PLANE ALTITUDE"),
            world.on_figure("PLANE HEADING DEGREES TRUE"),
            world.on_figure("PLANE PITCH DEGREES"),
            world.on_figure("PLANE BANK DEGREES"),
        );
        frames.push(Frame {
            t,
            values,
            at,
            facing,
            pitch,
            bank,
            writes: world.writes,
            targets: input.targets,
        });
    }
    frames
}

#[cfg(test)]
mod tests {
    use messages::avatars::slots::{BODY_SEATED, HAND_POINT, PoseSlot, SHOWS_ALL};

    use super::*;
    use crate::scripts::Input;
    use crate::slot::Fed;

    fn seated(seat: &Seat, hand: Option<[f32; 3]>) -> Input {
        let mut pose: PoseSlot = bytemuck::Zeroable::zeroed();
        pose.body = BODY_SEATED;
        pose.eye = seat.eye_point();
        pose.look = seat.forward();
        if let Some(p) = hand {
            pose.hands[0].kind = HAND_POINT;
            pose.hands[0].point = p;
        }
        Input {
            fed: Fed {
                pose,
                color: 1,
                shows: SHOWS_ALL,
                slumps: false,
            },
            aircraft: Vec::new(),
            targets: [hand, None],
        }
    }

    #[test]
    fn a_seated_figure_is_placed_at_its_hip_and_writes_nothing_once_still() {
        let seat = Seat::at([0.28, 0.13, -0.05]);
        let script = Script {
            name: "still",
            title: "Still",
            seconds: 1.0,
            at: Box::new(move |_| seated(&seat, None)),
        };
        let frames = run(&script, &seat, &bytemuck::Zeroable::zeroed());
        let first = &frames[0];
        for (got, want) in first.at.iter().zip(seat.hip) {
            assert!(
                (got - want).abs() < 0.001,
                "{:?} against {:?}",
                first.at,
                seat.hip
            );
        }
        assert_eq!(
            first.writes, 35,
            "every joint, the color, what shows, and the place"
        );
        assert_eq!(first.values[27], 1.0, "the color");
        assert!(frames[1..].iter().all(|f| f.writes == 0));
    }

    #[test]
    fn a_reaching_hand_stretches_its_arm_and_the_feed_counts_only_changes() {
        let seat = Seat::at([0.28, 0.13, -0.05]);
        let spot = [0.1, 0.6, 0.7];
        let script = Script {
            name: "reach",
            title: "Reach",
            seconds: 1.0,
            at: Box::new(move |t| seated(&seat, (t >= 0.2).then_some(spot))),
        };
        let frames = run(&script, &seat, &bytemuck::Zeroable::zeroed());
        let arm = CHANNELS.iter().position(|c| *c == "ARM_L_LEN").unwrap();
        let (before, after) = (frames[6].values[arm], frames.last().unwrap().values[arm]);
        assert!(
            after > before + 0.1,
            "the left arm reached out: {before} to {after}"
        );
        assert!(frames.last().unwrap().targets[0] == Some(spot));
    }
}
