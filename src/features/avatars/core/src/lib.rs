//! Avatars, the feature that shows each pilot's figure in the cockpit, looking where they look
//! and reaching for what they click or change (record/areas/avatars/01-avatars.md).
//!
//! A pilot's own core works out their figure: it reads the camera each frame and the mouse
//! through the core helper, takes a seat by where the camera is, casts each click's ray into
//! the aircraft's own model, and decides where each hand goes and when. It sends the whole
//! figure to the crew as a pose, at most every 33ms. On every machine, it creates a figure
//! for each pilot and feeds `Figure`, the routine that draws them all in our WASM module.
//!
//! Register it after every crate of the platform.

mod crew;
mod figures;
mod hands;
mod model;
mod mouse;
mod ray;
mod seats;
mod sim;
mod v3;

use std::collections::BTreeMap;

use clients::{Clients, ClientsUnit, SettingChanged, SettingDef};
use cockpit_stream::CockpitSent;
use core_helper_service::HelperUnit;
use kernel::{Cx, Handle, JobId, Registry, View};
use messages::avatars::{self as wire, AircraftNote, AvatarsSlice, Body, ModelRead, Pose};
use messages::clients::SettingKind;
use network::{LinkLost, LinkUp, NetUnit};
use profile_engine::features::avatars::Location;
use profile_loader::{ProfileLoaded, ProfileUnloaded, Profiles};
use serde_json::json;
use session::{ControlPassed, FlightChanged, KeyChanged, MemberGone, Session, SessionUnit};
use sim_service::{AircraftChanged, Camera, SimService, SimUnit};

use crate::hands::Hands;
use crate::seats::Place;

/// Which figures show: this pilot's own and the crew's, each inside the aircraft and on a
/// walkaround (record/areas/interface/decisions.md, "The Figures tab holds the pilot's figure
/// and explains what its figures can do"). The Figures tab, in src/features/avatars/efb/part.tsx,
/// names the same settings, so change both together.
pub const MINE_INSIDE: &str = "avatars.mine-inside";
pub const MINE_WALKAROUND: &str = "avatars.mine-walkaround";
pub const CREW_INSIDE: &str = "avatars.crew-inside";
pub const CREW_WALKAROUND: &str = "avatars.crew-walkaround";

/// The notification that this pilot's camera sits in a seat another figure holds, whose full
/// ID, `avatars.seat`, the banner's stand-in shows.
const SEAT: &str = "seat";

/// The feature's state.
#[derive(Default)]
pub struct Avatars {
    /// The loaded profile's seats and located entries, for this pilot's variant.
    profile: Option<Loaded>,
    sim: sim::SimState,
    model: ModelState,
    /// Where this pilot is: the seat their camera holds, and their figure's body.
    seat: Option<usize>,
    body: Option<Body>,
    hands: Hands,
    mouse: mouse::Mouse,
    /// This pilot's pose as their own figure draws it, and when it last went to the crew.
    own: Option<Pose>,
    sent: Option<u64>,
    /// Each entry's number when its hand last reached for it, for its `deadband`.
    reached: BTreeMap<String, f64>,
    crew: crew::Crew,
    settings: Settings,
}

struct Loaded {
    seats: Vec<Place>,
    /// Each entry with a location for this pilot's variant: its point and its `deadband`.
    located: BTreeMap<String, ([f32; 3], Option<f64>)>,
}

#[derive(Default)]
enum ModelState {
    #[default]
    None,
    /// The job building the model for this aircraft, by what it was built from.
    Building {
        job: JobId,
        from: aircraft_model::Aircraft,
    },
    Ready {
        model: Box<aircraft_model::Model>,
        from: aircraft_model::Aircraft,
        /// The watch on the variables its code reads.
        watch: Option<Handle>,
    },
    /// This machine can't read the model.
    Failed { from: aircraft_model::Aircraft },
}

struct Settings {
    mine_inside: bool,
    mine_walkaround: bool,
    crew_inside: bool,
    crew_walkaround: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            mine_inside: true,
            mine_walkaround: true,
            crew_inside: true,
            crew_walkaround: true,
        }
    }
}

impl Settings {
    fn read(clients: &Clients) -> Settings {
        let on = |key| clients.setting_as(key).unwrap_or(true);
        Settings {
            mine_inside: on(MINE_INSIDE),
            mine_walkaround: on(MINE_WALKAROUND),
            crew_inside: on(CREW_INSIDE),
            crew_walkaround: on(CREW_WALKAROUND),
        }
    }
}

/// Registers avatars.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Avatars>("avatars");
    me.channel(wire::POSES, crew::Crew::on_pose)
        .mouse(mouse::on_mouse)
        .on_sim(sim::on_sim)
        .ends_with_profile()
        .on::<ProfileLoaded>(Avatars::loaded)
        .on::<ProfileUnloaded>(Avatars::unloaded)
        .on::<AircraftChanged>(|me, _, cx| me.start_model(cx))
        .on::<CockpitSent>(Avatars::sent)
        .on::<ControlPassed>(|me, _, cx| me.redraw(cx))
        .on::<FlightChanged>(|me, _, cx| me.redraw(cx))
        .on::<LinkUp>(|me, _, cx| me.redraw(cx))
        .on::<LinkLost>(|me, _, cx| me.redraw(cx))
        .on::<MemberGone>(crew::Crew::gone)
        .on::<SettingChanged>(Avatars::setting_changed)
        .on::<KeyChanged>(Avatars::key_changed)
        .match_item(wire::MODEL, compare)
        .client_state(wire::SLICE, |me: &Avatars, _: &View| AvatarsSlice {
            note: me.note(),
        });
    for (key, label) in [
        (MINE_INSIDE, "Your figure inside the aircraft"),
        (MINE_WALKAROUND, "Your figure on a walkaround"),
        (CREW_INSIDE, "The crew's figures inside the aircraft"),
        (CREW_WALKAROUND, "The crew's figures on a walkaround"),
    ] {
        me.setting(
            key,
            SettingDef {
                label,
                kind: SettingKind::Bool,
                default: json!(true),
                part_only: true,
                development: false,
            },
        );
    }
}

/// The match check's comparison, at the `info` level, since nothing went wrong. It names no
/// one, since a crew of ten on a Marketplace aircraft would fill the line, and nobody can act
/// on the names (record/areas/avatars/01-avatars.md's note of 2026-11-04).
fn compare(values: &[(String, ModelRead)], _: Option<usize>) -> Option<session::Found> {
    let unreadable = values
        .iter()
        .filter(|(_, v)| *v == ModelRead::Unreadable)
        .count();
    let figures = match unreadable {
        0 => return None,
        all if all == values.len() => "Figures",
        _ => "Some figures",
    };
    Some(session::Found {
        level: messages::session::Severity::Info,
        words: format!("{figures} won't be able to interact with the cockpit"),
        note: None,
    })
}

impl Avatars {
    /// The profile loaded: its seats and located entries, the mouse on, the sim's frames,
    /// and the model's job.
    fn loaded(me: &mut Avatars, _: &ProfileLoaded, cx: &mut Cx) {
        let Some(loaded) = cx.read::<Profiles>().loaded() else {
            return;
        };
        let profile = &loaded.profile;
        let seats = profile
            .features
            .avatars
            .seats
            .iter()
            .map(Place::of)
            .collect();
        let at = |location: &Option<Location>| {
            location
                .as_ref()
                .and_then(|l| l.at(&profile.variant))
                .map(v3::of)
        };
        let mut located = BTreeMap::new();
        for e in &profile.state {
            if let Some(p) = at(&e.features.avatars.location) {
                located.insert(e.key.clone(), (p, e.features.avatars.deadband));
            }
        }
        for e in &profile.events {
            if let Some(p) = at(&e.features.avatars.location) {
                located.insert(e.key.clone(), (p, None));
            }
        }
        me.profile = Some(Loaded { seats, located });
        me.settings = Settings::read(cx.read::<Clients>());
        core_helper_service::mouse(cx, true);
        sim::start(me, cx);
        me.start_model(cx);
    }

    /// The profile unloaded: the mouse off, and every figure gone, which the platform's close
    /// of avatars' connection removes from the sim, so avatars calls the sim for none of it.
    fn unloaded(me: &mut Avatars, _: &ProfileUnloaded, cx: &mut Cx) {
        core_helper_service::mouse(cx, false);
        session::clear_match(cx, wire::MODEL);
        clients::clear_notification(cx, SEAT);
        *me = Avatars::default();
    }

    /// Why the figures do less in the loaded aircraft. One note shows, so the one that takes
    /// more away comes first: with no seats, no figure sits anywhere.
    fn note(&self) -> Option<AircraftNote> {
        if self.profile.as_ref()?.seats.is_empty() {
            return Some(AircraftNote::Seats);
        }
        matches!(self.model, ModelState::Failed { .. }).then_some(AircraftNote::Model)
    }

    /// Starts the model's job once both hold, the profile loaded and the aircraft's package
    /// folder found, since nothing orders the two, and again when the aircraft or its title
    /// changes.
    fn start_model(&mut self, cx: &mut Cx) {
        let Some(profile) = &self.profile else {
            return;
        };
        let service = cx.read::<SimService>();
        let (Some(folder), Some(facts)) = (service.package_folder(), service.aircraft_facts())
        else {
            return;
        };
        let Some(path) = facts.aircraft.as_ref().map(|a| a.path.clone()) else {
            return;
        };
        let from = aircraft_model::Aircraft {
            package: folder.to_string(),
            path,
            title: facts.title.clone(),
            eyes: profile.seats.iter().map(|s| s.eye).collect(),
            hand_radius: hands::HAND_RADIUS,
        };
        let same = match &self.model {
            ModelState::Building { from: f, .. }
            | ModelState::Ready { from: f, .. }
            | ModelState::Failed { from: f } => *f == from,
            ModelState::None => false,
        };
        if same {
            return;
        }
        if let ModelState::Building { job, .. } = self.model {
            cx.cancel_job(job);
        }
        tracing::info!(
            package = from.package,
            path = from.path,
            "avatars builds the aircraft's model"
        );
        session::clear_match(cx, wire::MODEL);
        let job = cx.job(model::job(&from), Avatars::model_built);
        self.model = ModelState::Building { job, from };
    }

    fn model_built(me: &mut Avatars, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let from = match std::mem::take(&mut me.model) {
            ModelState::Building { job: j, from } if j == job => from,
            other => {
                me.model = other;
                return;
            }
        };
        match result.and_then(aircraft_model::Model::take) {
            Ok(model) => {
                let report = model.report();
                tracing::info!(
                    posed = report.posed,
                    animation_codes = report.animation_codes,
                    visibility_codes = report.visibility_codes,
                    yokes = model.yokes().len(),
                    "avatars took the aircraft's model"
                );
                let vars: Vec<sim_service::Var> = model.vars().iter().map(model::sim_var).collect();
                let watch = (!vars.is_empty()).then(|| {
                    sim_service::SimCx::sim(cx).watch(&vars, sim_service::Period::OnChange)
                });
                me.model = ModelState::Ready {
                    model: Box::new(model),
                    from,
                    watch,
                };
                session::set_match(cx, wire::MODEL, &ModelRead::Read);
            }
            Err(why) => {
                tracing::warn!(why, "avatars couldn't read the aircraft's model");
                me.model = ModelState::Failed { from };
                session::set_match(cx, wire::MODEL, &ModelRead::Unreadable);
            }
        }
        me.redraw(cx);
    }

    /// The model, once it's taken.
    fn model(&self) -> Option<&aircraft_model::Model> {
        match &self.model {
            ModelState::Ready { model, .. } => Some(model),
            _ => None,
        }
    }

    fn model_mut(&mut self) -> Option<&mut aircraft_model::Model> {
        match &mut self.model {
            ModelState::Ready { model, .. } => Some(model),
            _ => None,
        }
    }

    /// This machine's own change went out: for an entry with a location, the hand reaches
    /// for it (record/areas/avatars/01-avatars.md, "A change made without a click").
    fn sent(me: &mut Avatars, sent: &CockpitSent, cx: &mut Cx) {
        if !sent.names_entry {
            return;
        }
        let Some(&(point, deadband)) = me.profile.as_ref().and_then(|p| p.located.get(&sent.key))
        else {
            return;
        };
        if let (Some(number), Some(deadband)) = (sent.number, deadband) {
            if let Some(&last) = me.reached.get(&sent.key)
                && (number - last).abs() < deadband
            {
                return;
            }
            me.reached.insert(sent.key.clone(), number);
        }
        let Some(eye) = me.eye() else {
            return;
        };
        // The hand's side comes from where the wheel is, which takes a posed model, and no click
        // may have posed it yet.
        if let Some(model) = me.model_mut() {
            model.pose();
        }
        let toward = v3::unit(v3::sub(eye, point));
        let target = hands::Target::Point {
            at: v3::add(point, v3::scale(toward, hands::HAND_RADIUS)),
            normal: toward,
        };
        let rules = me.rules(cx);
        let hand = me.hands.hand_for(&rules, me.left_of_center(point));
        me.hands.located(&sent.key, hand, target, cx.now());
    }

    /// The eye this pilot's figure looks from.
    fn eye(&self) -> Option<[f32; 3]> {
        match self.body.as_ref()? {
            Body::Seated { eye, .. } | Body::Head { eye, .. } => Some(*eye),
            Body::OnFoot { at, .. } => Some(v3::add(*at, [0.0, 1.6, 0.0])),
        }
    }

    /// The hand rules for this pilot's figure as it sits.
    fn rules(&self, cx: &Cx) -> hands::Rules {
        let session = cx.read::<Session>();
        let pf = session.me().is_some() && session.pf() == session.me();
        let seat = self.seat.and_then(|i| self.profile.as_ref()?.seats.get(i));
        let left_seat = seat.is_none_or(Place::left);
        let yoke = seat.and_then(|s| {
            let model = self.model()?;
            model
                .yokes()
                .iter()
                .any(|y| y.left == s.left())
                .then_some(if s.left() {
                    wire::Side::Left
                } else {
                    wire::Side::Right
                })
        });
        hands::Rules {
            yoke,
            pf,
            left_seat,
        }
    }

    /// How far left of the center that picks a hand `point` is: the seat's own yoke's wheel,
    /// or its hip with no yoke, or on foot or in no seat, the figure's middle.
    fn left_of_center(&self, point: [f32; 3]) -> f32 {
        let seat = self.seat.and_then(|i| self.profile.as_ref()?.seats.get(i));
        if let Some(seat) = seat {
            let wheel = self.model().and_then(|m| {
                let yoke = m.yokes().iter().find(|y| y.left == seat.left())?;
                m.world(aircraft_model::Scene::Interior, yoke.node)
            });
            let center = wheel.map_or(seat.hip[0], |w| w.columns[3][0]);
            return point[0] - center;
        }
        let (at, forward) = match &self.body {
            Some(Body::OnFoot { at, heading, .. }) => (*at, v3::facing(*heading)),
            Some(Body::Head { eye, look }) => (*eye, *look),
            _ => return 0.0,
        };
        let left = v3::unit([forward[2], 0.0, -forward[0]]);
        v3::dot(v3::sub(point, at), left)
    }

    fn setting_changed(me: &mut Avatars, changed: &SettingChanged, cx: &mut Cx) {
        if !changed.key.starts_with("avatars.") {
            return;
        }
        me.settings = Settings::read(cx.read::<Clients>());
        me.redraw(cx);
    }

    /// A member's entry changed, which may give their figure another color.
    fn key_changed(me: &mut Avatars, changed: &KeyChanged, cx: &mut Cx) {
        if changed.key == messages::session::MEMBER.number {
            me.redraw(cx);
        }
    }

    /// Feeds `Figure` again, at most once an input, after this handler and every other
    /// that changes a figure in the same input.
    fn redraw(&mut self, cx: &mut Cx) {
        if !self.crew.feed_queued {
            self.crew.feed_queued = true;
            cx.call(crew::Crew::feed, ());
        }
    }
}

/// Whether the camera is inside the aircraft: within the interior model's box, or on a
/// machine with no model, within the box around every seat's eye grown by 1m.
pub(crate) fn camera_inside(me: &Avatars, camera: &Camera) -> bool {
    let p = v3::of(camera.position);
    match me.model() {
        Some(m) => m.inside(p),
        None => me
            .profile
            .as_ref()
            .is_some_and(|l| seats::inside_seats(&l.seats, p)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_match_item_says_figures_or_some_figures_as_an_info() {
        let read = |name: &str, v| (name.to_string(), v);
        assert_eq!(compare(&[read("James", ModelRead::Read)], None), None);
        let found = compare(
            &[
                read("James", ModelRead::Unreadable),
                read("Mira", ModelRead::Read),
            ],
            None,
        )
        .unwrap();
        assert_eq!(found.level, messages::session::Severity::Info);
        assert_eq!(
            found.words,
            "Some figures won't be able to interact with the cockpit"
        );
        let both = compare(
            &[
                read("James", ModelRead::Unreadable),
                read("Mira", ModelRead::Unreadable),
            ],
            None,
        )
        .unwrap();
        assert_eq!(
            both.words,
            "Figures won't be able to interact with the cockpit"
        );
    }
}
