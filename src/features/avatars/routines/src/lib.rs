//! Avatars' routines in our WASM module: `Figure`, which draws every figure this machine
//! shows, each frame (record/areas/avatars/01-avatars.md, "`Figure`, each frame").
//!
//! Avatars feeds it each figure's pose, seat, color, and state, and this machine's yokes.
//! Each frame it eases each hand and the head, holds a hand on a yoke from this machine's own
//! yoke variables, solves the 27 joints, walks or runs a figure on foot, and places each
//! figure through the aircraft's pose: led by 1 frame where the sim flies the aircraft, and
//! as `Follow` says it writes it on a following machine. It writes a joint only when it moved
//! past what shows, and the figure's place only when it moved, since drawing and animating
//! changed joints is what a figure costs a frame (user, 2026-10-25;
//! record/areas/avatars/log.md, "Each figure poses from its own object's variables").

// A panic in our module puts it in the sim's `DIRTY` state, and the sim stops running it, so
// one routine's bug would stop every routine (record/areas/architecture/02-code-map.md, "When
// the module stops"). So the commonest panics fail Clippy, as in the routine host.
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

mod earth;
mod ease;
pub mod solve;
mod spec {
    include!(concat!(env!("OUT_DIR"), "/spec.rs"));
}
mod yoke;

use messages::avatars::FIGURE;
use messages::avatars::slots::{
    BODY_HEAD, BODY_ON_FOOT, FigureSlot, FigureState, HAND_GRIP, HAND_POINT, HAND_THUMB,
    SHOWS_FADED, SHOWS_HANDS, SHOWS_HEAD,
};
use routine_host::{AVATAR, Frame, Routine, USER, VarRef, Wants};

use crate::ease::{Goal, HandEase};
use crate::solve::{Body, L3, add, length, scale, sub, unit};

/// The aircraft's pose, which places every figure, read on the pilot's aircraft and written
/// on each figure's object through the same names.
const PLACE: [(&str, &str); 6] = [
    ("A:PLANE LATITUDE", "degrees"),
    ("A:PLANE LONGITUDE", "degrees"),
    ("A:PLANE ALTITUDE", "feet"),
    ("A:PLANE HEADING DEGREES TRUE", "degrees"),
    ("A:PLANE PITCH DEGREES", "degrees"),
    ("A:PLANE BANK DEGREES", "degrees"),
];

/// A joint that moved less than this since `Figure` last wrote it isn't written: a millimeter,
/// or a tenth of a degree, less than a figure shows from the seat beside it.
const SHOWS_M: f32 = 0.001;
const SHOWS_DEG: f32 = 0.1;
/// A figure's place that moved less than this isn't written: a millimeter, and a twentieth of
/// a degree.
const PLACE_M: f64 = 0.001;
const PLACE_DEG: f64 = 0.05;
/// On foot the arm reaches a spot up to 3m away, and points at a farther one at 0.6m (user,
/// 2026-10-17).
const REACH_ON_FOOT: f32 = 3.0;
const POINT_AT: f32 = 0.6;
/// How fast a figure on foot follows its avatar, the rate of a spring damped just enough not to
/// overshoot.
const FOLLOW: f32 = 20.0;

#[derive(Default)]
pub struct Figure {
    slot: Option<Box<FigureSlot>>,
    /// Whether the feed changed since the last frame, so each yoke's variables are named
    /// again.
    fresh: bool,
    names: Option<Names>,
    stages: [[Option<VarRef>; 2]; 2],
    figures: Vec<Drawn>,
    /// The time and the aircraft's pose at the last frame.
    last: Option<(u64, earth::Pose)>,
}

/// The host's places for the variables `Figure` reads and writes, named at its first frame.
struct Names {
    place: [VarRef; 6],
    joints: [VarRef; 27],
    color: VarRef,
    shows: VarRef,
}

impl Names {
    fn new(want: &mut Wants) -> Option<Names> {
        let mut place = [VarRef(0); 6];
        for (r, (name, unit)) in place.iter_mut().zip(PLACE) {
            *r = want.var(name, unit)?;
        }
        let mut joints = [VarRef(0); 27];
        for (r, channel) in joints.iter_mut().zip(solve::CHANNELS) {
            *r = want.var(&format!("Z:DUALINPUT_FIGURE_{channel}"), "number")?;
        }
        Some(Names {
            place,
            joints,
            color: want.var("Z:DUALINPUT_FIGURE_COLOR", "number")?,
            shows: want.var("Z:DUALINPUT_FIGURE_SHOWS", "number")?,
        })
    }
}

/// One figure as it's drawn: its parts' eased places, and what was last written.
struct Drawn {
    object: u32,
    /// Its hips' center, in the aircraft's frame, and how fast it moved.
    root: [f32; 3],
    velocity: [f32; 3],
    facing: f32,
    eye: L3,
    look: [f32; 2],
    hands: [HandEase; 2],
    /// The gait's phase in radians, how fast the figure walks in m/s, and how far it runs,
    /// from 0, walking, to 1.
    phase: f32,
    speed: f32,
    run: f32,
    written: [Option<f32>; 29],
    placed: Option<earth::Pose>,
}

impl Routine for Figure {
    const ID: messages::module::RoutineId = FIGURE;
    type Slot = FigureSlot;
    type Report = ();

    fn on_slot(&mut self, slot: &FigureSlot) {
        self.slot = Some(Box::new(*slot));
        self.fresh = true;
    }

    fn frame(&mut self, frame: &Frame, want: &mut Wants) {
        let Some(slot) = self.slot.as_deref() else {
            return;
        };
        if self.names.is_none() {
            self.names = Names::new(want);
        }
        let Some(names) = &self.names else {
            return;
        };
        if self.fresh {
            self.fresh = false;
            for (refs, y) in self.stages.iter_mut().zip(&slot.yokes) {
                for (r, s) in refs.iter_mut().zip(&y.stages) {
                    let (name, unit) = yoke::var_of(s);
                    *r = want.var(name, unit);
                }
            }
        }
        let read = |want: &mut Wants, r: VarRef| want.read(USER, r).unwrap_or(0.0);
        // On a following machine `Follow`, before `Figure` in the module's list, says where it
        // puts the aircraft this frame, and the figures sit on that pose as it is. A read
        // would give the pose `Follow` wrote the frame before, and a lead from it lands
        // right only when two frames take the same time.
        let placed = want.placed();
        let aircraft = match placed {
            Some(p) => earth::Pose {
                latitude: p.latitude.to_degrees(),
                longitude: p.longitude.to_degrees(),
                altitude: p.altitude,
                heading: p.heading.to_degrees(),
                pitch: p.pitch.to_degrees(),
                bank: p.bank.to_degrees(),
            },
            None => {
                let mut pose = [0.0; 6];
                for (v, r) in pose.iter_mut().zip(names.place) {
                    *v = read(want, r);
                }
                let [latitude, longitude, altitude, heading, pitch, bank] = pose;
                earth::Pose {
                    latitude,
                    longitude,
                    altitude,
                    heading,
                    pitch,
                    bank,
                }
            }
        };
        let (dt, lead) = match self.last {
            Some((at, last)) => (
                (frame.now.saturating_sub(at) as f32 / 1e6).min(0.1),
                // Only an aircraft the sim flies moves on between this read and its drawing.
                if placed.is_some() {
                    aircraft
                } else {
                    aircraft.led(&last, 1.0)
                },
            ),
            None => (0.0, aircraft),
        };
        self.last = Some((frame.now, aircraft));
        let mut yokes = [None, None];
        for ((out, y), refs) in yokes.iter_mut().zip(&slot.yokes).zip(self.stages) {
            if y.present != 0 {
                let values = refs.map(|r| r.map_or(0.0, |r| read(want, r) as f32));
                *out = Some(yoke::last_frame(y, values));
            }
        }
        let count = (slot.count as usize).min(slot.figures.len());
        let states = slot.figures.get(..count).unwrap_or_default();
        let avatar = states
            .iter()
            .any(on_own_feet)
            .then(|| avatar_place(names, want))
            .flatten()
            .map(|now| {
                let facing = (now.heading - lead.heading).rem_euclid(360.0) as f32;
                (earth::in_frame(&lead, &now), facing)
            });
        self.figures
            .retain(|d| states.iter().any(|s| s.object == d.object));
        for state in states {
            let mut state = *state;
            if let Some((at, heading)) = avatar.filter(|_| on_own_feet(&state)) {
                state.pose.at = at;
                state.pose.heading = heading;
            }
            let at = match self.figures.iter().position(|d| d.object == state.object) {
                Some(at) => at,
                None => {
                    self.figures.push(Drawn::new(&state, &yokes, slot));
                    self.figures.len() - 1
                }
            };
            if let Some(drawn) = self.figures.get_mut(at) {
                drawn.step(&state, &yokes, slot, dt);
                drawn.write(&state, names, &lead, want);
            }
        }
    }
}

/// Whether this is this pilot's own figure on foot, which stands on their avatar with no spring
/// and no lead, a frame behind. The place the core feeds, on the spring, left it 150ms behind,
/// 31cm at 2 m/s. A lead of a frame closed that gap, but the avatar stops dead within a frame,
/// with no sign of it a frame sooner in its place or its speed, so the figure took one step too
/// many at every stop and snapped back (measured on MSFS 2024, 2026-11-05,
/// record/areas/avatars/log.md, "A pilot's own figure on foot stands on its avatar, a frame
/// behind").
fn on_own_feet(s: &FigureState) -> bool {
    s.own != 0 && s.pose.body == BODY_ON_FOOT
}

/// The avatar's place and heading, or `None` if the sim doesn't give them, in which case the
/// figure goes where the core feeds.
fn avatar_place(names: &Names, want: &mut Wants) -> Option<earth::Pose> {
    let [latitude, longitude, altitude, heading, ..] = names.place;
    Some(earth::Pose {
        latitude: want.read(AVATAR, latitude)?,
        longitude: want.read(AVATAR, longitude)?,
        altitude: want.read(AVATAR, altitude)?,
        heading: want.read(AVATAR, heading)?,
        ..earth::Pose::default()
    })
}

/// Where a figure's hips sit and which way it faces, in the aircraft's frame, from its pose.
fn root_of(s: &FigureState) -> ([f32; 3], f32) {
    let p = &s.pose;
    match p.body {
        BODY_ON_FOOT => {
            let hips = if p.crouch != 0 {
                spec::STAND_CROUCH
            } else {
                spec::STAND_HIPS
            };
            (add(p.at, [0.0, hips, 0.0]), p.heading)
        }
        BODY_HEAD => {
            let facing = (-p.look[0]).atan2(p.look[2]).to_degrees();
            (
                sub(p.eye, [0.0, spec::STAND_HEAD - spec::STAND_HIPS, 0.0]),
                facing,
            )
        }
        _ => (s.hip, s.facing),
    }
}

/// The figure's frame's forward and right, in the aircraft's frame, for its facing.
fn axes(facing: f32) -> ([f32; 3], [f32; 3]) {
    let r = facing.to_radians();
    ([-r.sin(), 0.0, r.cos()], [-r.cos(), 0.0, -r.sin()])
}

/// A point of the aircraft's frame in the figure's: forward, right, and up from `root`.
fn local(p: [f32; 3], root: [f32; 3], facing: f32) -> L3 {
    let (f, r) = axes(facing);
    let d = sub(p, root);
    [solve::dot(d, f), solve::dot(d, r), d[1]]
}

/// A direction of the aircraft's frame as yaw and pitch in the figure's, in degrees.
fn look_of(dir: [f32; 3], facing: f32) -> [f32; 2] {
    let l = local(dir, [0.0; 3], facing);
    [
        l[1].atan2(l[0]).to_degrees(),
        l[2].atan2(l[0].hypot(l[1])).to_degrees(),
    ]
}

impl Drawn {
    fn new(s: &FigureState, yokes: &[Option<yoke::Frame3>; 2], slot: &FigureSlot) -> Drawn {
        let (root, facing) = root_of(s);
        let mut d = Drawn {
            object: s.object,
            root,
            velocity: [0.0; 3],
            facing,
            eye: [0.0; 3],
            look: [0.0; 2],
            hands: [HandEase::new([0.0; 3], Goal::Rest); 2],
            phase: 0.0,
            speed: 0.0,
            run: 0.0,
            written: [None; 29],
            placed: None,
        };
        // A new figure starts where its pose puts it, with nothing easing in from elsewhere.
        let targets = d.targets(s, yokes, slot);
        d.hands = targets.map(|(at, goal)| HandEase::new(at, goal));
        let (eye, look) = d.head_target(s);
        d.eye = eye;
        d.look = look;
        d
    }

    /// One frame of `dt` seconds: the root, the head, and the hands eased toward their
    /// targets, and the gait on foot.
    fn step(
        &mut self,
        s: &FigureState,
        yokes: &[Option<yoke::Frame3>; 2],
        slot: &FigureSlot,
        dt: f32,
    ) {
        let (root, facing) = root_of(s);
        if s.pose.body == BODY_ON_FOOT {
            // On foot another pilot's hips follow their avatar on a spring, this pilot's own
            // stand on theirs, and the distance they cover steps the legs.
            let before = self.root;
            if on_own_feet(s) {
                self.root = root;
                self.velocity = [0.0; 3];
            } else {
                let x0 = sub(self.root, root);
                let e = (-FOLLOW * dt).exp();
                let k = add(self.velocity, scale(x0, FOLLOW));
                self.root = add(root, scale(add(x0, scale(k, dt)), e));
                self.velocity = scale(sub(self.velocity, scale(k, FOLLOW * dt)), e);
            }
            let moved = length([self.root[0] - before[0], 0.0, self.root[2] - before[2]]);
            if dt > 0.0 {
                self.speed += (moved / dt - self.speed) * (1.0 - (-dt / 0.2).exp());
            }
            let running = if self.speed > spec::RUN_FROM {
                1.0
            } else {
                0.0
            };
            self.run += (running - self.run) * (1.0 - (-dt / 0.25).exp());
            let stride = spec::WALK_STRIDE + (spec::RUN_STRIDE - spec::WALK_STRIDE) * self.run;
            self.phase = (self.phase + std::f32::consts::TAU * moved / stride.max(0.1))
                % std::f32::consts::TAU;
        } else {
            self.root = root;
            self.velocity = [0.0; 3];
            self.speed = 0.0;
        }
        self.facing = if on_own_feet(s) {
            facing
        } else {
            ease::angle(self.facing, facing, dt)
        };
        let (eye, look) = self.head_target(s);
        self.eye = ease::head(self.eye, eye, dt);
        self.look = [
            ease::angle(self.look[0], look[0], dt),
            ease::angle(self.look[1], look[1], dt),
        ];
        let chest = solve::chest(&self.body([[0.0; 3]; 2], s));
        let targets = self.targets(s, yokes, slot);
        for (side, (hand, (target, goal))) in self.hands.iter_mut().zip(targets).enumerate() {
            let sign = if side == 0 { -1.0 } else { 1.0 };
            hand.step(target, goal, add(chest, solve::shoulder(sign)), dt);
        }
    }

    /// Where the head goes: the pose's eye and look, slumped forward and down while the
    /// figure slumps, and on foot, ahead at the figure's standing height.
    fn head_target(&self, s: &FigureState) -> (L3, [f32; 2]) {
        let p = &s.pose;
        let (mut eye, mut look) = if p.body == BODY_ON_FOOT {
            let lean = spec::RUN_LEAN.to_radians() * self.run;
            let up = spec::STAND_HEAD - spec::STAND_HIPS;
            (
                [spec::EYE_FORWARD + up * lean.sin(), 0.0, up * lean.cos()],
                [0.0, 0.0],
            )
        } else {
            (
                local(p.eye, self.root, self.facing),
                look_of(p.look, self.facing),
            )
        };
        if s.slumps != 0 {
            eye = add(eye, [spec::SLUMP_DROP, 0.0, -spec::SLUMP_DROP]);
            look = [0.0, spec::SLUMP_PITCH];
        }
        (eye, look)
    }

    /// Each hand's target in the figure's frame, and where that has it going.
    fn targets(
        &self,
        s: &FigureState,
        yokes: &[Option<yoke::Frame3>; 2],
        slot: &FigureSlot,
    ) -> [(L3, Goal); 2] {
        let own_yoke = usize::from(s.hip[0] <= 0.0);
        std::array::from_fn(|i| {
            let sign = if i == 0 { -1.0 } else { 1.0 };
            let rest = (self.rest(s, sign), Goal::Rest);
            let Some(h) = s.pose.hands.get(i).filter(|_| s.slumps == 0) else {
                return rest;
            };
            match h.kind {
                HAND_GRIP => {
                    let side = (h.side as usize).min(1);
                    let (Some(Some(frame)), Some(y)) = (yokes.get(side), slot.yokes.get(side))
                    else {
                        return rest;
                    };
                    let grip = y.grips.get(i).copied().unwrap_or_default();
                    (
                        local(yoke::point(frame, grip), self.root, self.facing),
                        Goal::Grip(side),
                    )
                }
                HAND_THUMB => match yokes.get(own_yoke) {
                    Some(Some(frame)) => (
                        local(yoke::point(frame, h.point), self.root, self.facing),
                        Goal::Out,
                    ),
                    _ => rest,
                },
                HAND_POINT => {
                    let mut at = local(h.point, self.root, self.facing);
                    if s.pose.body == BODY_ON_FOOT {
                        let chest = solve::chest(&self.body([[0.0; 3]; 2], s));
                        let from = add(chest, solve::shoulder(sign));
                        let d = sub(at, from);
                        if length(d) > REACH_ON_FOOT {
                            at = add(from, scale(unit(d), POINT_AT));
                        }
                    }
                    (at, Goal::Out)
                }
                _ => rest,
            }
        })
    }

    /// A hand at rest: on the thigh while sitting, and on foot hanging at the side, swinging
    /// as the figure walks or runs.
    fn rest(&self, s: &FigureState, sign: f32) -> L3 {
        if s.pose.body != BODY_ON_FOOT {
            return [
                spec::REST_HAND_FWD,
                sign * spec::REST_HAND_RIGHT,
                spec::REST_HAND_UP,
            ];
        }
        let swing = (spec::WALK_SWING + (spec::RUN_SWING - spec::WALK_SWING) * self.run)
            * (self.speed / 0.5).min(1.0);
        let side = if sign < 0.0 {
            0.0
        } else {
            std::f32::consts::PI
        };
        let chest_up = (spec::STAND_HEAD - spec::STAND_HIPS) * spec::CHEST_AT;
        [
            swing * (self.phase + side).sin(),
            sign * (spec::SHOULDERS_WIDTH / 2.0 + 0.04),
            chest_up - 0.55,
        ]
    }

    /// The figure's parts for the solve: its head, `hands`, and its legs, from the seat while
    /// it sits, and from the gait on foot.
    fn body(&self, hands: [L3; 2], s: &FigureState) -> Body {
        let mut body = Body {
            eye: self.eye,
            look: self.look,
            hips: [0.0; 3],
            hands,
            knees: [[0.0; 3]; 2],
            feet: [None; 2],
        };
        for (i, sign) in [(0, -1.0), (1, 1.0)] {
            let right = sign * spec::LEGS_WIDTH / 2.0;
            if s.pose.body == BODY_ON_FOOT {
                let hips = if s.pose.crouch != 0 {
                    spec::STAND_CROUCH
                } else {
                    spec::STAND_HIPS
                };
                let stride = spec::WALK_STRIDE + (spec::RUN_STRIDE - spec::WALK_STRIDE) * self.run;
                let lift = spec::WALK_LIFT + (spec::RUN_LIFT - spec::WALK_LIFT) * self.run;
                let moving = (self.speed / 0.5).min(1.0);
                let phase = self.phase + if i == 0 { 0.0 } else { std::f32::consts::PI };
                let foot = [
                    -stride / 4.0 * moving * phase.cos(),
                    right,
                    -hips + lift * moving * phase.sin().max(0.0),
                ];
                let from = solve::leg([0.0; 3], sign);
                let half = (spec::STAND_HIPS - spec::LEGS_DOWN) / 2.0;
                if let (Some(k), Some(f)) = (body.knees.get_mut(i), body.feet.get_mut(i)) {
                    *k = solve::knee_between(from, foot, half);
                    *f = Some(foot);
                }
            } else if let (Some(k), Some(f)) = (body.knees.get_mut(i), body.feet.get_mut(i)) {
                let ([ku, kf], [fu, ff]) = (s.knees, s.feet);
                *k = [kf, right, ku];
                *f = Some([ff, right, fu]);
            }
        }
        body
    }

    /// Writes each joint that moved past what shows, the color and what shows when they
    /// changed, and the figure's place when it moved.
    fn write(&mut self, s: &FigureState, names: &Names, lead: &earth::Pose, want: &mut Wants) {
        let [left, right] = &self.hands;
        let values = solve::solve(&self.body([left.at, right.at], s));
        for (i, (&value, r)) in values.iter().zip(names.joints).enumerate() {
            let past = if solve::is_length(i) {
                SHOWS_M
            } else {
                SHOWS_DEG
            };
            if let Some(written) = self.written.get_mut(i)
                && written.is_none_or(|w| (w - value).abs() >= past)
            {
                *written = Some(value);
                want.write(s.object, r, f64::from(value));
            }
        }
        let shows = if s.pose.body == BODY_HEAD {
            s.shows & (SHOWS_HEAD | SHOWS_HANDS | SHOWS_FADED)
        } else {
            s.shows
        };
        for (i, value, r) in [
            (27, s.color as f32, names.color),
            (28, shows as f32, names.shows),
        ] {
            if let Some(written) = self.written.get_mut(i)
                && *written != Some(value)
            {
                *written = Some(value);
                want.write(s.object, r, f64::from(value));
            }
        }
        let place = earth::place(lead, self.root, self.facing);
        let moved = self.placed.is_none_or(|p| {
            let m = |deg: f64| deg.to_radians() * 6_371_000.0;
            m(p.latitude - place.latitude).abs() >= PLACE_M
                || m(p.longitude - place.longitude).abs() >= PLACE_M
                || ((p.altitude - place.altitude) * 0.3048).abs() >= PLACE_M
                || (p.heading - place.heading).abs() >= PLACE_DEG
                || (p.pitch - place.pitch).abs() >= PLACE_DEG
                || (p.bank - place.bank).abs() >= PLACE_DEG
        });
        if moved {
            self.placed = Some(place);
            let values = [
                place.latitude,
                place.longitude,
                place.altitude,
                place.heading,
                place.pitch,
                place.bank,
            ];
            for (value, r) in values.into_iter().zip(names.place) {
                want.write(s.object, r, value);
            }
        }
    }
}

#[cfg(test)]
mod tests;
