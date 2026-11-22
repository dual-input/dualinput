//! What authoring holds while it serves a client in this pilot's flight: the names it watches,
//! the open text's bundle in an engine of its own, Run, its preview and its revert notice, and the
//! display picker's outline (record/areas/profiles/04-the-extension-in-the-sim.md, "What
//! `authoring` does").

use std::collections::BTreeMap;
use std::time::Duration;

use clients::To;
use kernel::{Cx, Handle, Job, JobId};
use messages::authoring::{
    self as wire, BundleState, OUTLINE, OpenBundle, OpenName, Outcome, Panel, Preview,
};
use messages::session::Phase;
use messages::sync::Value;
use profile_engine::{LEVEL, Owner, Profile, Resolved, Shown, key_names};
use profile_loader::Profiles;
use sandbox::Sandbox;
use session::Session;
use sim_service::SimCx;
use sim_variables::{Got, VariablesCx, VariablesEvent};
use sync_engine::{Action, Ctx, Engine, Given, Load, Origin, Out, Planned, Ready, Seen};

use crate::names::{For, Key, Names, key_of};
use crate::{Authoring, PanelSeen};

/// How long after a Run's last action its revert notice watches for the value to come back,
/// which caught 97.4% of the 6,760 reverts fsc-editor saw across 101 variables
/// (record/areas/profiles/04-the-extension-in-the-sim.md, "The panel's Run").
const REVERT_WINDOW: Duration = Duration::from_secs(1);

/// What a Run and a preview say while a job reads the open text's new bundle.
const READING: &str = "the open text's new bundle is still being read";

pub(crate) struct Live {
    /// The client served, by its socket.
    socket: u64,
    pub(crate) names: Names,
    bundle: Option<Bundle>,
    state: BundleState,
    /// The open text's bundle as last given, which a profile's load checks again.
    given: Option<OpenBundle>,
    /// The job reading a newer bundle than `bundle`, with that bundle's hash.
    reading: Option<(JobId, String)>,
    frames: Handle,
    panel: Panel,
    preview: Option<Preview>,
    revert: Option<Revert>,
    /// The instruments outlined in each panel, by the panel's socket.
    outlined: BTreeMap<u64, Vec<String>>,
}

/// The open text's bundle, loaded.
struct Bundle {
    hash: String,
    shown: Shown,
    profile: Resolved,
    engine: Engine,
}

/// A Run whose value the revert notice watches.
struct Revert {
    run: u32,
    entry: String,
    /// The entry's watch.
    key: Key,
    /// Its reading before the Run.
    before: Value,
    /// When the Run's last action went, once it has.
    last_action: Option<u64>,
    /// Whether the reading has left `before`.
    left: bool,
}

impl Live {
    pub(crate) fn start(socket: u64, names: &[OpenName], cx: &Cx) -> Live {
        let mut live = Live {
            socket,
            names: Names::default(),
            bundle: None,
            state: BundleState::None,
            given: None,
            reading: None,
            frames: cx.sim().frames(),
            panel: Panel::Nothing,
            preview: None,
            revert: None,
            outlined: BTreeMap::new(),
        };
        live.names.open(names, cx);
        live
    }

    /// Stops every watch, closes authoring's connection with its frames, and clears the
    /// outline.
    pub(crate) fn end(mut self, cx: &Cx) {
        self.names.end(cx);
        cx.sim().close();
        self.outline(None, &[], cx);
    }

    pub(crate) fn socket(&self) -> u64 {
        self.socket
    }

    pub(crate) fn frames(&self) -> Handle {
        self.frames
    }

    pub(crate) fn bundle_state(&self) -> &BundleState {
        &self.state
    }

    pub(crate) fn preview(&self) -> Option<&Preview> {
        self.preview.as_ref()
    }

    pub(crate) fn open(&mut self, names: &[OpenName], cx: &Cx) {
        self.names.open(names, cx);
    }

    /// The open text's bundle, which a job reads and checks off the loop, as the profile loader
    /// reads the pinned one, since a profile the size of the 58P's takes a handler past its 1ms.
    pub(crate) fn load(&mut self, given: Option<OpenBundle>, cx: &Cx) {
        self.given = given;
        let text = match &self.given {
            None => return self.unload(BundleState::None, cx),
            Some(OpenBundle::Failed { error }) => {
                let why = format!("the open text doesn't build: {error}");
                return self.unload(BundleState::Refused { why }, cx);
            }
            Some(OpenBundle::Built { text }) => text.clone(),
        };
        let hash = profile_engine::hash(text.as_bytes());
        let reading = self.reading.as_ref().map(|(_, h)| h);
        if self.bundle.as_ref().map(|b| &b.hash) == Some(&hash) && reading.is_none()
            || reading == Some(&hash)
        {
            return;
        }
        if let Some((job, _)) = self.reading.take() {
            cx.cancel_job(job);
        }
        let job = cx.job(
            Job::bytes(text.into_bytes()).then(checked),
            Authoring::bundle_read,
        );
        self.reading = Some((job, hash));
        self.replan();
    }

    /// The job's read of the open text's bundle: loaded into an engine that runs only the writes
    /// it's asked for, whose watches get every reading sim variables already holds as they
    /// start, since the engine holds an entry's write until its first reading and a still switch
    /// sends none.
    pub(crate) fn bundle_read(&mut self, job: JobId, result: Result<Vec<u8>, String>, cx: &Cx) {
        let Some(hash) = self
            .reading
            .take_if(|(reading, _)| *reading == job)
            .map(|(_, hash)| hash)
        else {
            return;
        };
        let profile = result.and_then(|bytes| {
            postcard::from_bytes::<Result<Profile, String>>(&bytes)
                .map_err(|e| format!("the job's result didn't decode: {e}"))?
        });
        match profile.and_then(|profile| on_aircraft(profile, cx)) {
            Ok((shown, profile)) => {
                let load = Load {
                    at: cx.now(),
                    ready: Ready::Missed,
                    settle: 0,
                };
                let (engine, outs) = Engine::load_only_asked(&profile, Sandbox::new(), load);
                for out in outs {
                    if let Out::Stop { entry, why, .. } = out {
                        tracing::info!(entry, ?why, "an entry of the open text can't run");
                    }
                }
                self.names.watch_engine(engine.watches(), cx);
                tracing::info!(hash, "authoring loaded the open text's bundle");
                self.state = BundleState::Loaded { hash: hash.clone() };
                self.bundle = Some(Bundle {
                    hash,
                    shown,
                    profile,
                    engine,
                });
                self.revert = None;
                self.replan();
            }
            Err(why) => {
                tracing::info!(hash, why, "authoring refused the open text's bundle");
                self.unload(BundleState::Refused { why }, cx);
            }
        }
    }

    fn unload(&mut self, state: BundleState, cx: &Cx) {
        if let Some((job, _)) = self.reading.take() {
            cx.cancel_job(job);
        }
        if self.bundle.take().is_some() {
            self.names.end_engine(cx);
        }
        self.state = state;
        self.revert = None;
        self.replan();
    }

    /// The session's profile loaded, so a bundle refused for want of it, or one held for the
    /// profile before it, is read again.
    pub(crate) fn profile_loaded(&mut self, cx: &Cx) {
        let session = cx
            .read::<Profiles>()
            .loaded()
            .map(|l| (l.shown.maker.clone(), l.shown.name.clone()));
        let same = self
            .bundle
            .as_ref()
            .is_some_and(|b| Some((b.shown.maker.clone(), b.shown.name.clone())) == session);
        if !same {
            self.bundle = None;
            self.names.end_engine(cx);
            self.load(self.given.clone(), cx);
        }
    }

    pub(crate) fn panel(&mut self, panel: Panel, panels: &[PanelSeen], cx: &Cx) {
        let active = match &panel {
            Panel::Picker { active } => active.clone(),
            _ => None,
        };
        self.panel = panel;
        self.replan();
        self.outline(active.as_deref(), panels, cx);
    }

    /// What Run sends for the value typed, worked out by the engine with nothing sent.
    fn replan(&mut self) {
        let Panel::Run { entry, typed } = &self.panel else {
            self.preview = None;
            return;
        };
        self.preview = Some(match (&mut self.bundle, typed) {
            _ if self.reading.is_some() => Preview::Refused {
                why: READING.into(),
            },
            (None, _) => Preview::Refused {
                why: refusal(&self.state),
            },
            (Some(_), None) => Preview::Waiting,
            (Some(bundle), Some(given)) => match bundle.engine.plan(entry, given_of(given)) {
                Ok(planned) => Preview::Sends {
                    actions: planned.iter().map(planned_of).collect(),
                },
                Err(why) => Preview::Refused { why },
            },
        });
    }

    /// The values the panel's entry's watch has read, for its buttons.
    pub(crate) fn seen(&self, entry: &str) -> wire::Seen {
        match self
            .bundle
            .as_ref()
            .and_then(|b| watch_of(&b.profile, entry))
        {
            Some(key) => self.names.seen(&key),
            None => wire::Seen::Values { values: Vec::new() },
        }
    }

    /// A reading, a firing, or a failure of a watch: the engine's go to the engine, whose
    /// readings of the panel's entry change what Run sends, as a toggle over a switch that moved.
    pub(crate) fn got(&mut self, event: &VariablesEvent, cx: &Cx) {
        if self.names.got(event) != For::Engine {
            return;
        }
        let (Some(bundle), Some(ctx)) = (self.bundle.as_mut(), engine_ctx(cx)) else {
            return;
        };
        let seen = match &event.got {
            Got::Read(value) => Seen::Value {
                watch: event.place,
                value: value.clone(),
            },
            Got::Fired(value) => Seen::Fired {
                watch: event.place,
                value: *value,
            },
            Got::Failed(_) => Seen::Refused { watch: event.place },
        };
        let outs = bundle.engine.seen(seen, ctx);
        carry_out(outs, cx);
        let ours = match &self.panel {
            Panel::Run { entry, .. } => bundle
                .engine
                .watches()
                .get(event.place)
                .is_some_and(|w| w.entry == *entry),
            _ => false,
        };
        if ours {
            self.replan();
        }
    }

    /// Runs one entry's write, numbered `run`, and says what came of it.
    pub(crate) fn run(&mut self, run: u32, asked: &wire::Run, cx: &Cx) -> Outcome {
        let refused = |why: String| Outcome::Refused { why };
        // A Run runs the open text, so while a job reads a newer text's bundle, a Run refuses
        // rather than run the older one.
        if self.reading.is_some() {
            return refused(READING.into());
        }
        let Some(bundle) = self.bundle.as_mut() else {
            return refused(refusal(&self.state));
        };
        let entry = asked.entry.as_str();
        let Some(owner) = owner_of(&bundle.profile, entry) else {
            return refused(format!("the profile has no entry `{entry}`"));
        };
        let session = cx.read::<Session>();
        // State sync puts back any change a pilot monitoring makes to an entry the pilot flying
        // owns, so a Run of one would only flicker.
        if owner == Owner::PilotFlying && session.pf() != session.me() {
            return refused(format!(
                "`{entry}` belongs to the pilot flying, so Run waits until you have control"
            ));
        }
        let Some(ctx) = engine_ctx(cx) else {
            return refused("the session hasn't said who flies yet".into());
        };
        let watch = watch_of(&bundle.profile, entry);
        let before = watch
            .as_ref()
            .and_then(|key| self.names.value(key))
            .cloned();
        let outs = match bundle.engine.write_once(entry, given_of(&asked.given), ctx) {
            Ok(outs) => outs,
            Err(why) => return refused(why),
        };
        let sent = carry_out(outs, cx);
        let writing = bundle.engine.writing(entry);
        self.revert = match (watch, before) {
            (Some(key), Some(before)) if sent => Some(Revert {
                run,
                entry: entry.to_string(),
                key,
                before,
                last_action: (!writing).then(|| cx.now()),
                left: false,
            }),
            _ => None,
        };
        self.replan();
        Outcome::Taken
    }

    /// One of the sim's frames: the engine's due steps go out, and the revert notice reads the
    /// Run's watch, returning the Run's number and its notice once its value came back.
    pub(crate) fn frame(&mut self, cx: &Cx) -> Option<(u32, Outcome)> {
        let ctx = engine_ctx(cx)?;
        let bundle = self.bundle.as_mut()?;
        let outs = bundle.engine.frame(ctx);
        carry_out(outs, cx);
        let revert = self.revert.as_mut()?;
        let now = cx.now();
        let Some(at) = revert.last_action else {
            if !bundle.engine.writing(&revert.entry) {
                revert.last_action = Some(now);
            }
            return None;
        };
        let since = now.saturating_sub(at);
        if since > REVERT_WINDOW.as_micros() as u64 {
            self.revert = None;
            return None;
        }
        let reading = self.names.value(&revert.key)?;
        if !reading.same(&revert.before) {
            revert.left = true;
            return None;
        }
        if !revert.left {
            return None;
        }
        let notice = (
            revert.run,
            Outcome::Reverted {
                to: crate::shown(&revert.before),
                after_ms: (since / 1_000) as u32,
            },
        );
        self.revert = None;
        Some(notice)
    }

    /// Outlines the instruments `active` names in each panel that holds one, all of them for a
    /// key two panels hold, and clears the outline from the panels that held the row before.
    fn outline(&mut self, active: Option<&str>, panels: &[PanelSeen], cx: &Cx) {
        let wanted: BTreeMap<u64, Vec<String>> = active
            .map(|active| {
                panels
                    .iter()
                    .filter_map(|p| {
                        let keys: Vec<String> = p
                            .instruments
                            .iter()
                            .filter(|i| key_names(active, i))
                            .cloned()
                            .collect();
                        (!keys.is_empty()).then_some((p.socket, keys))
                    })
                    .collect()
            })
            .unwrap_or_default();
        for (&socket, instruments) in &wanted {
            if self.outlined.get(&socket) != Some(instruments) {
                send_outline(socket, instruments.clone(), cx);
            }
        }
        for &socket in self.outlined.keys() {
            if !wanted.contains_key(&socket) {
                send_outline(socket, Vec::new(), cx);
            }
        }
        self.outlined = wanted;
    }

    /// A panel's socket closed, and its module with it.
    pub(crate) fn panel_left(&mut self, socket: u64) {
        self.outlined.remove(&socket);
    }
}

fn send_outline(socket: u64, instruments: Vec<String>, cx: &Cx) {
    clients::send(
        cx,
        To::Socket(socket),
        OUTLINE,
        &wire::Outline { instruments },
    );
}

/// Runs at the edge on the open text's bundle: its profile, checked at this core's level, or why
/// it doesn't read.
fn checked(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let profile = profile_engine::read(&bytes, LEVEL)
        .map_err(|report| format!("the bundle doesn't read: {report}"));
    postcard::to_stdvec(&profile).map_err(|e| e.to_string())
}

/// The open text's profile as this pilot's variant has it, as the profile loader resolves the
/// pinned one, unless its profile isn't the one the session flies, by the maker and model the
/// EFB app names it by, so a Run never writes one aircraft's values into another.
fn on_aircraft(profile: Profile, cx: &Cx) -> Result<(Shown, Resolved), String> {
    let Some(loaded) = cx.read::<Profiles>().loaded() else {
        return Err("the session's profile hasn't loaded yet".into());
    };
    let shown = Shown::of(&profile);
    let session = &loaded.shown;
    if shown.maker != session.maker || shown.name != session.name {
        return Err(format!(
            "this profile is for the {} {}, and the session flies the {} {}",
            shown.maker, shown.name, session.maker, session.name
        ));
    }
    let session = cx.read::<Session>();
    let aircraft = session
        .me()
        .and_then(|me| session.member_key(messages::session::STATUS, &me))
        .and_then(|s| s.aircraft)
        .map(|a| a.path)
        .unwrap_or_default();
    let Some(variant) = profile.covers(&aircraft).map(str::to_string) else {
        return Err(format!(
            "this profile covers none of the session's aircraft, `{aircraft}`"
        ));
    };
    Ok((shown, profile.resolve(&variant)))
}

/// What the engine's calls know of the session, or `None` before this core has a control value.
fn engine_ctx(cx: &Cx) -> Option<Ctx> {
    let session = cx.read::<Session>();
    Some(Ctx {
        at: cx.now(),
        me: Origin {
            pilot: session.me()?,
            restart: session.restart()?,
        },
        control: session.control()?,
        // The engine runs no catch-up, so it has no catch-up to say is running.
        catching_up: false,
        preflight_ended: session.preflight().phase == Phase::Ended,
    })
}

/// Carries out the engine's actions through sim variables, in their order, and says whether
/// any went. An engine from `Engine::load_only_asked` returns only actions.
fn carry_out(outs: Vec<Out>, cx: &Cx) -> bool {
    let actions: Vec<sim_variables::Action> = outs
        .into_iter()
        .filter_map(|out| match out {
            Out::Act(action) => Some(action_of(action)),
            _ => None,
        })
        .collect();
    let any = !actions.is_empty();
    if any {
        cx.variables().act(actions);
    }
    any
}

fn action_of(action: Action) -> sim_variables::Action {
    match action {
        Action::Set { name, value } => sim_variables::Action::Set { name, value },
        Action::Key { name, values } => sim_variables::Action::Key { name, values },
        Action::Fire { name } => sim_variables::Action::Fire { name },
    }
}

fn planned_of(planned: &Planned) -> wire::Planned {
    wire::Planned {
        action: match &planned.action {
            Action::Set { name, value } => wire::Action::Set {
                name: name.to_string(),
                value: crate::shown(value),
            },
            Action::Key { name, values } => wire::Action::Key {
                name: name.to_string(),
                values: values.clone(),
            },
            Action::Fire { name } => wire::Action::Fire {
                name: name.to_string(),
            },
        },
        times: planned.times,
        every: planned.every.to_string(),
    }
}

fn given_of(given: &wire::Given) -> Given {
    match given {
        wire::Given::Value { value } => Given::Value(crate::value_of(value)),
        wire::Given::Nothing => Given::Nothing,
        wire::Given::Steps { steps } => Given::Steps(*steps),
    }
}

/// Who owns an entry, or none for a key the profile lacks. An event entry is everyone's.
fn owner_of(profile: &Resolved, entry: &str) -> Option<Owner> {
    if let Some(state) = profile.state.iter().find(|e| e.key == entry) {
        return Some(state.owner);
    }
    profile
        .events
        .iter()
        .any(|e| e.key == entry)
        .then_some(Owner::Shared)
}

/// The watch whose value an entry holds: a state entry's name, as the engine watches it. A
/// counting entry's shadow and an event's firings have no value the panel shows.
fn watch_of(profile: &Resolved, entry: &str) -> Option<Key> {
    let state = profile.state.iter().find(|e| e.key == entry)?;
    match &state.watch {
        profile_engine::Watch::Name(name) => Some(key_of(name, wire::Reads::Value)),
        profile_engine::Watch::Count(_) => None,
    }
}

/// The words a Run or a preview refuses with while the open text's bundle isn't loaded.
fn refusal(state: &BundleState) -> String {
    match state {
        BundleState::Refused { why } => why.clone(),
        _ => "the open text's bundle hasn't come yet".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::names::engine_key;

    #[test]
    fn the_engines_key_for_a_state_entrys_watch_is_the_panels() {
        let name = profile_engine::Name::L {
            name: "BEACON".into(),
            unit: None,
        };
        let watch = sync_engine::Watch {
            name: name.clone(),
            watching: sync_engine::Watching::Value,
            entry: "beacon".into(),
        };
        assert_eq!(engine_key(&watch), key_of(&name, wire::Reads::Value));
    }
}
