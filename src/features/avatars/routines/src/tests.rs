// A test may panic and index freely, which the crate's lints forbid the routine.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use std::collections::BTreeMap;

use messages::avatars::slots::{BODY_ON_FOOT, BODY_SEATED, FigureSlot, HAND_POINT, SHOWS_ALL};
use messages::module::slots::SlotHeader;
use routine_host::{Flag, Host, Ids, Named, Sim, Space};

use super::*;

const HASH: u64 = 7;
const OBJECT: u32 = 0x100;

/// The sim: each variable by its object and name, and each write in the last frame.
#[derive(Default)]
struct World {
    values: BTreeMap<(u32, String), f64>,
    names: Vec<(Space, String)>,
    writes: Vec<String>,
}

impl Sim for World {
    fn frozen(&mut self, _: Flag) -> bool {
        false
    }
    fn set_frozen(&mut self, _: Flag, _: bool) {}
    fn look_up(&mut self, _: u32, named: &Named) -> Option<Ids> {
        self.names.push((named.space, named.name.clone()));
        Some(Ids {
            var: self.names.len() as i32 - 1,
            unit: 0,
        })
    }
    fn get(&mut self, object: u32, _: Space, ids: Ids) -> Option<f64> {
        let (_, name) = self.names.get(ids.var as usize)?;
        Some(*self.values.get(&(object, name.clone())).unwrap_or(&0.0))
    }
    fn set(&mut self, object: u32, _: Space, ids: Ids, value: f64) {
        let (_, name) = &self.names[ids.var as usize];
        self.writes.push(name.clone());
        self.values.insert((object, name.clone()), value);
    }
    fn reset(&mut self) -> bool {
        false
    }
}

fn seated() -> FigureSlot {
    let mut slot: FigureSlot = bytemuck::Zeroable::zeroed();
    slot.count = 1;
    let f = &mut slot.figures[0];
    f.object = OBJECT;
    f.color = 1;
    f.shows = SHOWS_ALL;
    f.hip = [0.31, 0.12, 1.4];
    f.knees = [0.05, 0.45];
    f.feet = [-0.42, 0.62];
    f.pose.body = BODY_SEATED;
    f.pose.eye = [0.31, 0.75, 1.35];
    f.pose.look = [0.0, 0.0, 1.0];
    slot
}

fn feed(host: &mut Host, feeds: u32, slot: &FigureSlot, clock: u64) {
    let header = SlotHeader {
        feeds,
        end: 0,
        slots_hash: HASH,
        counter: clock,
    };
    let mut bytes = bytemuck::bytes_of(&header).to_vec();
    bytes.extend_from_slice(bytemuck::bytes_of(slot));
    host.written(FIGURE, &bytes, clock);
}

fn frame(host: &mut Host, world: &mut World, clock: u64) -> Vec<String> {
    world.writes.clear();
    host.frame(clock, world);
    std::mem::take(&mut world.writes)
}

#[test]
fn a_still_figure_writes_its_joints_and_place_once_then_nothing() {
    let mut host = Host::new(routine_host::routines![Figure], HASH, "0.1.0");
    let mut world = World::default();
    feed(&mut host, 1, &seated(), 0);
    let first = frame(&mut host, &mut world, 1_000);
    assert_eq!(first.len(), 27 + 2 + 6, "{first:?}");
    assert!(first.contains(&"DUALINPUT_FIGURE_COLOR".to_string()));
    for t in 1..30 {
        let writes = frame(&mut host, &mut world, 1_000 + t * 16_667);
        assert!(writes.is_empty(), "frame {t} wrote {writes:?}");
    }
}

#[test]
fn a_hand_reaching_out_writes_only_its_arm_and_settles() {
    let mut host = Host::new(routine_host::routines![Figure], HASH, "0.1.0");
    let mut world = World::default();
    let mut slot = seated();
    feed(&mut host, 1, &slot, 0);
    frame(&mut host, &mut world, 1_000);
    slot.figures[0].pose.hands[0].kind = HAND_POINT;
    slot.figures[0].pose.hands[0].point = [0.4, 0.6, 1.9];
    feed(&mut host, 2, &slot, 2_000);
    let mut all = Vec::new();
    for t in 1..60 {
        all.extend(frame(&mut host, &mut world, 1_000 + t * 16_667));
    }
    assert!(all.iter().any(|w| w.starts_with("DUALINPUT_FIGURE_ARM_L")));
    assert!(
        all.iter().all(|w| w.starts_with("DUALINPUT_FIGURE_ARM_L")),
        "only the left arm moved: {all:?}"
    );
    assert!(
        frame(&mut host, &mut world, 2_000_000).is_empty(),
        "the hand settled"
    );
}

#[test]
fn a_figure_in_a_moving_aircraft_moves_with_it_led_by_a_frame() {
    let mut host = Host::new(routine_host::routines![Figure], HASH, "0.1.0");
    let mut world = World::default();
    feed(&mut host, 1, &seated(), 0);
    let lat = |w: &World, o| {
        *w.values
            .get(&(o, "PLANE LATITUDE".to_string()))
            .unwrap_or(&0.0)
    };
    world.values.insert((0, "PLANE LATITUDE".into()), 47.0);
    frame(&mut host, &mut world, 1_000);
    world.values.insert((0, "PLANE LATITUDE".into()), 47.001);
    let writes = frame(&mut host, &mut world, 17_667);
    assert!(writes.contains(&"PLANE LATITUDE".to_string()));
    let ahead = lat(&world, OBJECT) - 47.002;
    assert!(ahead.abs() < 1e-4, "led by one frame's change: {ahead}");
}

#[test]
fn a_pilots_own_figure_on_foot_stands_on_their_avatar_and_another_trails_on_its_spring() {
    let mut host = Host::new(routine_host::routines![Figure], HASH, "0.1.0");
    let mut world = World::default();
    let mut slot = seated();
    slot.count = 2;
    slot.figures[1] = slot.figures[0];
    slot.figures[1].object = OBJECT + 1;
    for f in &mut slot.figures[..2] {
        f.pose.body = BODY_ON_FOOT;
    }
    slot.figures[0].own = 1;
    let lat = |w: &World, o| w.values[&(o, "PLANE LATITUDE".to_string())];
    world.values.insert((0, "PLANE LATITUDE".into()), 47.0);
    world.values.insert((AVATAR, "PLANE LATITUDE".into()), 47.0);
    feed(&mut host, 1, &slot, 0);
    frame(&mut host, &mut world, 1_000);
    // A step of about 1.1m, with the core still feeding the place it had.
    world
        .values
        .insert((AVATAR, "PLANE LATITUDE".into()), 47.00001);
    let moved = [0.0, 0.0, 1.1];
    slot.figures[1].pose.at = moved;
    feed(&mut host, 2, &slot, 2_000);
    frame(&mut host, &mut world, 34_333);
    let own = lat(&world, OBJECT) - 47.00001;
    assert!(own.abs() < 1e-7, "on the avatar, with no lead: {own}");
    let trailing = lat(&world, OBJECT + 1) - 47.0;
    assert!(
        trailing > 1e-7 && trailing < 0.9e-5,
        "the other is on its way: {trailing}"
    );
}

#[test]
fn a_figure_on_foot_steps_as_it_moves_and_runs_past_a_speed() {
    let mut host = Host::new(routine_host::routines![Figure], HASH, "0.1.0");
    let mut world = World::default();
    let mut slot = seated();
    slot.figures[0].pose.body = BODY_ON_FOOT;
    slot.figures[0].pose.at = [3.0, 0.0, 0.0];
    let mut legs = Vec::new();
    // Walk at 1.4 m/s, then run at 4 m/s, fed each 33ms.
    for t in 0..120u32 {
        let speed = if t < 60 { 1.4 } else { 4.0 };
        let clock = u64::from(t) * 33_333;
        slot.figures[0].pose.at[2] += speed * 0.033_333;
        feed(&mut host, t + 1, &slot, clock);
        frame(&mut host, &mut world, clock + 1);
        legs.push(
            *world
                .values
                .get(&(OBJECT, "DUALINPUT_FIGURE_LEG_L_PITCH".into()))
                .unwrap_or(&0.0),
        );
    }
    let swing = |run: &[f64]| {
        run.iter().cloned().fold(f64::MIN, f64::max) - run.iter().cloned().fold(f64::MAX, f64::min)
    };
    let (walking, running) = (swing(&legs[20..60]), swing(&legs[80..120]));
    assert!(walking > 5.0, "the thigh swings as it walks: {walking}°");
    assert!(
        running > walking * 1.5,
        "a run's stride swings it farther: {running}° against {walking}°"
    );
}
