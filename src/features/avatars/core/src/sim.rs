//! What avatars hears from the sim: the camera each frame, a `Frame` event each frame, which
//! moves the hands on, and the watches on the avatar on foot, the aircraft's pose, and the
//! variables the model's code reads (record/areas/avatars/01-avatars.md, "A seat" and "The
//! ray").

use kernel::{Cx, Handle};
use messages::avatars::Body;
use sim_service::{Camera, Period, SimCx, SimEvent, Value, Var};
use simconnect_types::{
    SIMCONNECT_OBJECT_ID_USER_AVATAR, SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT,
    SIMCONNECT_POSITION_REFERENTIAL_WORLD,
};

use crate::ray::{self, AircraftPose};
use crate::{Avatars, ModelState, crew, seats, v3};

const SIMOBJECT: u32 = SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT as u32;
const WORLD: u32 = SIMCONNECT_POSITION_REFERENTIAL_WORLD as u32;

/// The aircraft's pose, which turns the avatar's place and the `WORLD` camera into the
/// aircraft's frame on foot, and gives a new figure its first place.
fn pose_vars() -> [Var; 6] {
    [
        Var::number("A:PLANE LATITUDE", "degrees"),
        Var::number("A:PLANE LONGITUDE", "degrees"),
        Var::number("A:PLANE ALTITUDE", "feet"),
        Var::number("A:PLANE HEADING DEGREES TRUE", "degrees"),
        Var::number("A:PLANE PITCH DEGREES", "degrees"),
        Var::number("A:PLANE BANK DEGREES", "degrees"),
    ]
}

/// The avatar on foot: its place, its facing, and whether it crouches, which its own object
/// gives every sim frame (measured on MSFS 2024, 2026-10-02, record/areas/avatars/log.md,
/// "The avatar's own object ID gives its position, speed, and facing every sim frame").
fn avatar_vars() -> [Var; 5] {
    [
        Var::number("A:PLANE LATITUDE", "degrees"),
        Var::number("A:PLANE LONGITUDE", "degrees"),
        Var::number("A:PLANE ALTITUDE", "feet"),
        Var::number("A:PLANE HEADING DEGREES TRUE", "degrees"),
        Var::number("A:IS CROUCH", "bool"),
    ]
}

#[derive(Default)]
pub(crate) struct SimState {
    frames: Option<Handle>,
    cameras: Option<Handle>,
    /// The camera as it last came, in the referential the pilot's place calls for.
    pub(crate) camera: Option<Camera>,
    is_avatar: Option<Handle>,
    /// Whether the pilot is on foot, which `E:IS AVATAR` on the pilot's object tells, since it
    /// swapped with `E:IS AIRCRAFT` when the pilot sat down (same entry).
    pub(crate) on_foot: bool,
    avatar_watch: Option<Handle>,
    avatar: [f64; 5],
    aircraft_read: Option<Handle>,
    pub(crate) aircraft: Option<AircraftPose>,
}

/// At the profile's load: the camera, the frames, the avatar, and a first read of the
/// aircraft's pose.
pub(crate) fn start(me: &mut Avatars, cx: &Cx) {
    let sim = cx.sim();
    me.sim.cameras = Some(sim.cameras());
    me.sim.frames = Some(sim.frames());
    me.sim.is_avatar = Some(sim.watch(&[Var::number("E:IS AVATAR", "bool")], Period::OnChange));
    me.sim.avatar_watch = Some(sim.watch_on(
        SIMCONNECT_OBJECT_ID_USER_AVATAR,
        &avatar_vars(),
        Period::OnChange,
    ));
    me.sim.aircraft_read = Some(sim.watch(&pose_vars(), Period::Once));
}

pub(crate) fn on_sim(me: &mut Avatars, event: SimEvent, cx: &mut Cx) {
    match event {
        SimEvent::Frame { call, .. } if Some(call) == me.sim.frames => frame(me, cx),
        SimEvent::Camera {
            call,
            simobject,
            world,
        } if Some(call) == me.sim.cameras => {
            let camera = if me.sim.on_foot { world } else { simobject };
            camera_read(me, camera, cx);
        }
        SimEvent::Values { watch, values } => values_read(me, watch, &values, cx),
        SimEvent::Created { call, object } => crew::created(me, call, object, cx),
        SimEvent::Exception {
            call, exception, ..
        } => {
            tracing::warn!(exception, "the sim refused a call of avatars'");
            if let Some(call) = call {
                forget_call(me, call);
                crew::refused(me, call);
            }
        }
        SimEvent::Failed { call } => forget_call(me, call),
        SimEvent::Lost => {
            // The figures went with the connection, and the calls it was answering; the next
            // connection makes the camera, the frames, and the watches again.
            me.sim.aircraft_read = None;
            crew::lost(me);
        }
        _ => {}
    }
}

fn forget_call(me: &mut Avatars, call: Handle) {
    if me.sim.aircraft_read == Some(call) {
        me.sim.aircraft_read = None;
    }
}

/// Each frame: the hands' time and this pilot's pose move on, whether or not a camera came
/// this frame, since whether SimConnect sends a report our module set to the same bytes, as
/// when the camera holds still, and whether the sim runs our module in active pause are both
/// unmeasured; and the aircraft's pose is read while the pilot is on foot or a figure waits
/// for its first place.
fn frame(me: &mut Avatars, cx: &mut Cx) {
    if (me.sim.on_foot || crew::waiting(me)) && me.sim.aircraft_read.is_none() {
        me.sim.aircraft_read = Some(cx.sim().watch(&pose_vars(), Period::Once));
    }
    let rules = me.rules(cx);
    me.hands.tick(&rules, cx.now());
    crew::own_pose(me, cx);
}

fn values_read(me: &mut Avatars, watch: Handle, values: &[(usize, Value)], cx: &mut Cx) {
    let numbers = values.iter().filter_map(|(i, v)| match v {
        Value::Number(n) => Some((*i, *n)),
        Value::Text(_) => None,
    });
    if Some(watch) == me.sim.is_avatar {
        for (_, n) in numbers {
            me.sim.on_foot = n != 0.0;
        }
        // The aircraft's pose was last read at the profile's load, as far off as the flight since
        // has been long, so a first pose on foot waits for a fresh one.
        if me.sim.on_foot {
            me.seat = None;
            me.sim.aircraft = None;
        }
    } else if Some(watch) == me.sim.avatar_watch {
        for (i, n) in numbers {
            if let Some(slot) = me.sim.avatar.get_mut(i) {
                *slot = n;
            }
        }
    } else if Some(watch) == me.sim.aircraft_read {
        me.sim.aircraft_read = None;
        let mut pose = [0.0; 6];
        for (i, n) in numbers {
            if let Some(slot) = pose.get_mut(i) {
                *slot = n;
            }
        }
        let [latitude, longitude, altitude, heading, pitch, bank] = pose;
        me.sim.aircraft = Some(AircraftPose {
            latitude,
            longitude,
            altitude,
            heading,
            pitch,
            bank,
        });
        crew::create_waiting(me, cx);
    } else if let ModelState::Ready {
        model,
        watch: Some(w),
        ..
    } = &mut me.model
        && *w == watch
    {
        for (i, n) in numbers {
            model.set(i, n);
        }
    }
}

/// The camera, as it came this frame: the body it puts this pilot's figure in.
fn camera_read(me: &mut Avatars, camera: Camera, cx: &mut Cx) {
    me.sim.camera = Some(camera);
    if me.sim.on_foot {
        crew::seat_held(me, None, cx);
        if camera.referential == WORLD
            && let Some(aircraft) = me.sim.aircraft
        {
            let [lat, lon, alt, heading, crouch] = me.sim.avatar;
            let at = ray::world_to_frame(&aircraft, lat, lon, alt);
            let heading = (heading - aircraft.heading).rem_euclid(360.0) as f32;
            me.body = Some(Body::OnFoot {
                at,
                heading,
                crouch: crouch != 0.0,
            });
        }
    } else if camera.referential == SIMOBJECT {
        in_the_aircraft(me, &camera, cx);
    }
}

/// In the aircraft: the seat the camera takes or holds, a head in no seat, or in an outside
/// view the seat held, looking forward from its eye.
fn in_the_aircraft(me: &mut Avatars, camera: &Camera, cx: &mut Cx) {
    let Some(profile) = &me.profile else {
        return;
    };
    let p = v3::of(camera.position);
    let others = crew::seats_held(me, cx);
    let held = |key: &str| others.iter().any(|k| k == key);
    if crate::camera_inside(me, camera) {
        let seat = seats::take(&profile.seats, p, &held)
            .or(me.seat.filter(|&i| seats::keeps(&profile.seats[i], p)));
        let in_held = seats::nearest(&profile.seats, p)
            .filter(|&i| held(&profile.seats[i].key) && seat != Some(i))
            .map(|i| profile.seats[i].key.clone());
        let look = ray::look(camera);
        me.body = Some(match seat {
            Some(i) => Body::Seated {
                seat: profile.seats[i].key.clone(),
                eye: p,
                look,
            },
            None => Body::Head { eye: p, look },
        });
        me.seat = seat;
        crew::seat_held(me, in_held, cx);
    } else {
        if let Some(s) = me.seat.and_then(|i| profile.seats.get(i)) {
            me.body = Some(Body::Seated {
                seat: s.key.clone(),
                eye: s.eye,
                look: s.forward(),
            });
        }
        crew::seat_held(me, None, cx);
    }
}
