//! The profile loader, the platform's crate for profiles in the core: the published profiles'
//! index and bundles, fetched at each start into a cache in the data folder; the local folder
//! of bundles an author built; the bundle a session pins, which the pilot flying's loader
//! chooses; a test session's new local bundles, which reach the crew over the session; loading
//! the pinned bundle on this pilot's aircraft; and the match check's item
//! (record/areas/profiles/02-units.md).
//!
//! The core builds no bundle: it reads one, checks it at its level in a job, and decodes the
//! checked profile on the loop, so a load never waits on the network, and a replay decodes the
//! same profile from the recording with no file read.
//!
//! Register it after the session crate, whose keys, match check, and moments it uses, and
//! before every feature that reads the loaded profile.

mod cache;
mod local;
mod test_sessions;

use std::collections::{BTreeMap, BTreeSet};

use clients::{Clients, ClientsUnit, SettingChanged, SettingDef};
use kernel::{Cx, Handle, JobId, Moment, Registry, Started, View};
use messages::clients::SettingKind;
use messages::net::PilotId;
use messages::profiles::{
    self as wire, BUNDLE, BUNDLES, Bundle, LoadedProfile, PIN, Pick, Pin, ProfilesSlice,
    SupportedAircraft,
};
use messages::session::{MATCH, Phase, Severity};
use messages::sim::{MenuPage, Stage, WorldMapOutcome, WorldMapRequest};
use messages::{hex, unhex};
use network::{LinkUp, NetUnit};
use profile_engine::{Index, IndexBundle, Profile, ProfileStatus, Resolved, Shown};
use serde_json::json;
use session::{
    ControlPassed, FlightChanged, Found, KeyChanged, Session, SessionEnded, SessionStarted,
    SessionUnit, WriteKeys, clear_match, set_match,
};
use sim_service::{PackageFound, SimAwareness, SimCx, SimEvent, SimService, SimUnit};

/// The development setting that names the profiles' site, which the bench points at its own.
pub const SITE: &str = "profiles.site";
/// The site every release fetches from, a subdomain of ours pointed at the repository's Pages
/// site (record/areas/profiles/02-units.md, "Where the core fetches from").
const SITE_URL: &str = "https://profiles.dualinput.app";
/// The development setting that names the local folder: bundles an author built, which a
/// session takes over a published one for the aircraft they cover. Empty, the default, means
/// `profiles\local\` in the data folder (record/areas/profiles/02-units.md, "The local folder").
pub const LOCAL: &str = "profiles.local";

/// A profile loaded on this pilot's aircraft, which the features read.
pub struct ProfileLoaded;
/// The profile unloaded: this member left the flight, the pin changed, or the session ended.
pub struct ProfileUnloaded;

impl Moment for ProfileLoaded {}
impl Moment for ProfileUnloaded {}

/// The pinned bundle, loaded on this pilot's aircraft.
#[derive(Clone, Debug)]
pub struct Loaded {
    pub pin: Pin,
    /// The profile's maker and model, as the EFB app names it, which `Resolved` leaves out, and
    /// by which the profile extension's Run tells the session's profile from another.
    pub shown: Shown,
    /// Each block as this pilot's variant has it.
    pub profile: Resolved,
}

/// Where loading the pinned bundle stands.
#[derive(Debug, Default)]
enum Load {
    #[default]
    Idle,
    Reading {
        job: JobId,
        pin: Pin,
    },
    Loaded(Loaded),
    /// The bundle covers none of this pilot's aircraft, so nothing loads until the pin changes.
    Uncovered(Pin),
    /// The bundle couldn't be fetched, found, or read.
    Failed(Pin),
}

#[derive(Default)]
pub struct Profiles {
    pub(crate) cache: cache::Cache,
    pub(crate) local: local::Local,
    /// The session's aircraft, as last seen, to see it change.
    aircraft: Option<String>,
    /// The pilot flying's loader has a choice to write, since the session's aircraft changed
    /// before preflight ended.
    repin: bool,
    /// The pin this core asked for, and the input it asked in, so it asks once an input, and asks
    /// again in a later one if the session crate refused it.
    asked: Option<(u64, Option<Pin>)>,
    load: Load,
    /// Whether a package on disk holds each folder a published profile covers, by the folder in
    /// lowercase, as far as the sim service has answered.
    installed: BTreeMap<String, bool>,
    /// The aircraft picker's ask of the world map, on its way.
    picking: Option<Handle>,
    /// How many picks the world map couldn't carry out.
    pick_failed: u32,
    pub(crate) test: test_sessions::Test,
}

impl Profiles {
    /// The pinned bundle, while it's loaded on this pilot's aircraft.
    pub fn loaded(&self) -> Option<&Loaded> {
        match &self.load {
            Load::Loaded(l) => Some(l),
            _ => None,
        }
    }
}

/// Registers the profile loader.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Profiles>("profile-loader");
    me.start_file(cache::INDEX, cache::index_file)
        .start_file(cache::ETAG, cache::etag_file)
        .on::<Started>(Profiles::started)
        .on::<SessionStarted>(Profiles::session_started)
        .on::<SessionEnded>(|me, _, cx| me.update(cx))
        .on::<KeyChanged>(|me, _, cx| me.update(cx))
        .on::<ControlPassed>(|me, _, cx| me.update(cx))
        .on::<FlightChanged>(Profiles::flight_changed)
        .on::<SettingChanged>(Profiles::setting_changed)
        .on::<PackageFound>(Profiles::package_found)
        .on::<LinkUp>(test_sessions::link_up)
        .channel(BUNDLES, test_sessions::on_bundle)
        .command(wire::command::PICK, Profiles::pick)
        .on_sim(Profiles::on_sim)
        .client_state(wire::SLICE, Profiles::slice)
        .session_key(PIN)
        .match_item(BUNDLE, compare);
    me.setting(
        SITE,
        SettingDef {
            label: "The profiles' site, the release's own when empty",
            kind: SettingKind::Text,
            default: json!(""),
            part_only: false,
            development: true,
        },
    )
    .setting(
        LOCAL,
        SettingDef {
            label: "A folder of bundles you built, which a session takes over the published ones, profiles\\local in the data folder when empty",
            kind: SettingKind::Text,
            default: json!(""),
            part_only: false,
            development: true,
        },
    );
}

impl Profiles {
    fn started(me: &mut Profiles, _: &Started, cx: &mut Cx) {
        cache::start(me, cx);
        local::refresh(me, false, cx);
        me.update(cx);
    }

    /// A fetch that failed at start is tried again at the next Host or Join, and the local folder
    /// is listed again, as what a test session's changes count from, and then each second.
    fn session_started(me: &mut Profiles, _: &SessionStarted, cx: &mut Cx) {
        if me.cache.start_failed {
            tracing::info!("the profiles' fetch failed at start, so a new session tries it again");
            cache::start(me, cx);
        }
        local::refresh(me, true, cx);
        local::start_polling(me, cx);
        me.update(cx);
    }

    /// A pin's fetch that failed is tried again each time this member enters the flight.
    fn flight_changed(me: &mut Profiles, changed: &FlightChanged, cx: &mut Cx) {
        let mine = cx.read::<Session>().me() == Some(changed.member);
        if mine && changed.in_flight {
            me.cache.failed.clear();
            if let Load::Failed(_) = me.load {
                me.load = Load::Idle;
            }
        }
        me.update(cx);
    }

    fn setting_changed(me: &mut Profiles, changed: &SettingChanged, cx: &mut Cx) {
        if changed.key == LOCAL {
            local::refresh(me, true, cx);
            me.update(cx);
        }
    }

    fn package_found(me: &mut Profiles, found: &PackageFound, _: &mut Cx) {
        me.installed.insert(found.folder.clone(), found.installed);
    }

    /// `profiles.pick`, from the aircraft picker: has the menu script select the aircraft on the
    /// world map, as Join selects the pilot flying's, by a folder its profile covers, one a package
    /// on disk holds where the sim service has found one (record/areas/interface/decisions.md, "The
    /// aircraft picker loads an aircraft through the world map's store, and only at the world
    /// map"). The picker sees the pick land when the sim's loaded aircraft is in one of the
    /// slice's `folders` for it, and fail in `pick_failed`.
    fn pick(me: &mut Profiles, pick: Pick, cx: &mut Cx) -> Result<(), String> {
        let sim = cx.read::<SimAwareness>();
        if sim.stage != Stage::Menu
            || sim.page != MenuPage::WorldMap
            || !cx.read::<SimService>().menu_script()
        {
            return Err("The aircraft picker loads an aircraft only at the world map".into());
        }
        let folders = me
            .published()
            .find(|b| b.shown.maker == pick.maker && b.shown.name == pick.model)
            .map(folders_of)
            .unwrap_or_default();
        let Some(chosen) = folders
            .iter()
            .find(|f| me.installed.get(*f) == Some(&true))
            .or(folders.first())
            .cloned()
        else {
            return Err(format!(
                "No published profile is {} {}",
                pick.maker, pick.model
            ));
        };
        tracing::info!(
            pick.maker,
            pick.model,
            folder = chosen,
            "the aircraft picker loads an aircraft"
        );
        let request = WorldMapRequest::Aircraft {
            folder: chosen,
            title: None,
        };
        me.picking = Some(cx.sim().world_map(request));
        Ok(())
    }

    /// The world map's answer to the picker's ask.
    fn on_sim(me: &mut Profiles, event: SimEvent, _: &mut Cx) {
        let (call, done) = match event {
            SimEvent::WorldMap { call, outcome } => (call, outcome == WorldMapOutcome::Done),
            SimEvent::Failed { call } => (call, false),
            _ => return,
        };
        if me.picking != Some(call) {
            return;
        }
        me.picking = None;
        if !done {
            tracing::info!("the world map couldn't load the aircraft the picker asked for");
            me.pick_failed += 1;
        }
    }

    /// The slice `profiles`.
    fn slice(me: &Profiles, view: &View) -> ProfilesSlice {
        let selected = view.read::<SimAwareness>().selected.as_ref();
        ProfilesSlice {
            loaded: selected
                .and_then(|aircraft| me.status_of(&aircraft.path))
                .map(|status| LoadedProfile {
                    status: shown(status),
                }),
            supported: me
                .published()
                .map(|b| {
                    let folders = folders_of(b);
                    SupportedAircraft {
                        maker: b.shown.maker.clone(),
                        model: b.shown.name.clone(),
                        status: shown(b.shown.status),
                        installed: folders.iter().any(|f| me.installed.get(f) == Some(&true)),
                        folders,
                    }
                })
                .collect(),
            pick_failed: me.pick_failed,
            test: test_sessions::slice(me, view.read::<Session>()),
        }
    }

    /// Each bundle the index gives this core's level.
    fn published(&self) -> impl Iterator<Item = &IndexBundle> {
        self.cache
            .index
            .iter()
            .flat_map(|index| &index.profiles)
            .filter_map(|p| p.bundle_for(profile_engine::LEVEL))
    }

    /// The status of the profile a session would take for an aircraft, by the same order as
    /// the pilot flying's choice: a local bundle first.
    fn status_of(&self, aircraft: &str) -> Option<ProfileStatus> {
        self.local.status_of(aircraft).or_else(|| {
            self.published()
                .find(|b| b.covers(aircraft))
                .map(|b| b.shown.status)
        })
    }

    /// Asks the sim service about each folder a published profile covers that it hasn't been
    /// asked about.
    fn find_installed(&mut self, cx: &Cx) {
        let folders: BTreeSet<String> = self
            .published()
            .flat_map(|b| &b.variants)
            .map(|v| folder(v))
            .filter(|f| !self.installed.contains_key(f))
            .collect();
        for folder in folders {
            self.installed.insert(folder.clone(), false);
            sim_service::find_package(cx, folder);
        }
    }

    /// Brings the pin, the load, and the match check's item up to date with the session, the
    /// cache, and the local folder. Every handler ends here.
    pub(crate) fn update(&mut self, cx: &mut Cx) {
        self.find_installed(cx);
        let session = cx.read::<Session>();
        let aircraft = session
            .held()
            .then(|| session.preflight().aircraft.map(|a| a.path))
            .flatten();
        if aircraft != self.aircraft {
            self.aircraft = aircraft.clone();
            if session.preflight().phase != Phase::Ended {
                self.repin = true;
            }
        }
        self.pin(cx);
        test_sessions::offer(self, cx);
        test_sessions::send_pinned(self, cx);
        self.fetch_pin(cx);
        self.load(cx);
        self.match_item(cx);
        test_sessions::notice(self, cx);
    }

    /// On the pilot flying's core, writes its choice into the pin: whenever the session's
    /// aircraft changes before preflight ends, and whenever the pin holds none and the choice
    /// becomes one, after preflight ends too. So a pass of control keeps the pin, and a
    /// session whose fetch finishes late still pins a bundle (record/areas/profiles/02-units.md,
    /// "The pin").
    fn pin(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let pf = session.held() && session.me().is_some() && session.pf() == session.me();
        let Some(aircraft) = self.aircraft.clone().filter(|_| pf) else {
            self.repin = false;
            return;
        };
        // The choice waits for the cache's folder and the local folder to be listed, which
        // takes a moment, so a bundle already on disk isn't pinned as none first.
        if self.local.busy() || !self.cache.listed() {
            return;
        }
        let held = session.key(PIN);
        let choice = self.choice(&aircraft, session.me());
        let write = self.repin || held.is_none() || (held == Some(None) && choice.is_some());
        self.repin = false;
        if !write || held == Some(choice) || self.asked == Some((cx.now(), choice)) {
            return;
        }
        match choice {
            Some(pin) => tracing::info!(
                hash = hex(&pin.hash),
                local = pin.local,
                aircraft,
                "the pilot flying pinned the session's profile"
            ),
            None => tracing::info!(
                aircraft,
                "the pilot flying pinned no profile, since none covers the session's aircraft"
            ),
        }
        self.asked = Some((cx.now(), choice));
        cx.ask(WriteKeys::one(PIN, &choice));
    }

    /// A local bundle that covers the aircraft, this pilot's own, `me`, or else the bundle the
    /// cached index gives this core's level for it, when the cache holds that bundle, or else
    /// none.
    fn choice(&self, aircraft: &str, me: Option<PilotId>) -> Option<Pin> {
        if let Some(local) = self.local.covering(aircraft, me) {
            return Some(local);
        }
        let index = self.cache.index.as_ref()?;
        let bundle = index
            .profiles
            .iter()
            .filter_map(|p| p.bundle_for(profile_engine::LEVEL))
            .find(|b| b.covers(aircraft))?;
        if !self.cache.holds(&bundle.hash) {
            return None;
        }
        Some(Pin {
            hash: unhex(&bundle.hash)?,
            local: false,
            from: None,
        })
    }

    /// Fetches a published pin the cache lacks as soon as the pin names it, whether or not
    /// this member is in the flight, so it's there when they enter.
    fn fetch_pin(&mut self, cx: &mut Cx) {
        let Some(Some(pin)) = cx.read::<Session>().key(PIN) else {
            return;
        };
        if !pin.local {
            cache::fetch_bundle(self, &hex(&pin.hash), cx);
        }
    }

    /// Loads the pinned bundle while this member is in the flight, and unloads it, first of
    /// anything, when they leave it, the pin changes, or the session ends.
    fn load(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let want = session
            .me()
            .filter(|me| session.held() && session.in_flight(me))
            .and_then(|_| session.key(PIN).flatten());
        let current = match &self.load {
            Load::Idle => None,
            Load::Reading { pin, .. }
            | Load::Uncovered(pin)
            | Load::Failed(pin)
            | Load::Loaded(Loaded { pin, .. }) => Some(*pin),
        };
        if current.is_some() && current != want {
            match std::mem::take(&mut self.load) {
                Load::Loaded(_) => {
                    tracing::info!("the profile unloaded");
                    cx.raise(ProfileUnloaded);
                    clients::profile_unloaded(cx);
                    sim_service::profile_unloaded(cx);
                }
                Load::Reading { job, .. } => cx.cancel_job(job),
                _ => {}
            }
        }
        let (Some(pin), Load::Idle) = (want, &self.load) else {
            return;
        };
        let hash = hex(&pin.hash);
        // A local bundle this core doesn't hold yet waits for the pilot flying's core to send it,
        // and a published one for its fetch.
        let Some(path) = self.held_path(&hash) else {
            if !pin.local && self.cache.failed.contains(&hash) {
                self.load = Load::Failed(pin);
            }
            return;
        };
        let job = cx.job(
            kernel::Job::read(path).then(checked_bundle),
            Profiles::read_back,
        );
        self.load = Load::Reading { job, pin };
    }

    fn read_back(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let pin = match &me.load {
            Load::Reading { job: reading, pin } if *reading == job => *pin,
            // A result for a pin or a flight other than the one this core loads for.
            _ => return,
        };
        let hash = hex(&pin.hash);
        let checked = result.and_then(|bytes| {
            postcard::from_bytes::<(String, Result<Profile, String>)>(&bytes)
                .map_err(|e| format!("the job's result didn't decode: {e}"))
        });
        me.load = match checked {
            Ok((read, _)) if read != hash => {
                tracing::warn!(
                    hash,
                    read,
                    local = pin.local,
                    "a bundle's bytes don't match its name"
                );
                if pin.local {
                    Load::Failed(pin)
                } else {
                    cache::forget(me, &hash, cx);
                    Load::Idle
                }
            }
            Ok((_, Ok(profile))) => me.on_aircraft(pin, profile, cx),
            Ok((_, Err(why))) | Err(why) => {
                tracing::info!(
                    hash,
                    why,
                    "couldn't get the session's profile, since its bundle doesn't read"
                );
                Load::Failed(pin)
            }
        };
        me.update(cx);
    }

    /// The checked profile on this pilot's aircraft: the variant that covers it, resolved.
    fn on_aircraft(&self, pin: Pin, profile: Profile, cx: &mut Cx) -> Load {
        let session = cx.read::<Session>();
        let aircraft = session
            .me()
            .and_then(|me| session.member_key(messages::session::STATUS, &me))
            .and_then(|s| s.aircraft)
            .map(|a| a.path);
        let Some(variant) = aircraft
            .as_deref()
            .and_then(|a| profile.covers(a))
            .map(str::to_string)
        else {
            tracing::info!(
                hash = hex(&pin.hash),
                ?aircraft,
                "the pinned bundle covers none of this pilot's aircraft, so nothing loads until the pin changes"
            );
            return Load::Uncovered(pin);
        };
        let loaded = Loaded {
            pin,
            shown: Shown::of(&profile),
            profile: profile.resolve(&variant),
        };
        tracing::info!(
            hash = hex(&pin.hash),
            local = pin.local,
            variant,
            "the profile loaded"
        );
        cx.raise(ProfileLoaded);
        clients::profile_loaded(cx);
        Load::Loaded(loaded)
    }

    /// Hands the session crate this member's value of the match check's item, and takes it
    /// back while it isn't known, as while this member is out of the flight.
    fn match_item(&self, cx: &mut Cx) {
        let value = self.mine(cx.read::<Session>());
        // The session crate writes this member's match key only when a value changes.
        match value {
            Some(value) => set_match(cx, BUNDLE, &value),
            None => clear_match(cx, BUNDLE),
        }
    }

    /// This member's value of the match check's item.
    fn mine(&self, session: &Session) -> Option<Bundle> {
        match session.key(PIN)? {
            None => Some(Bundle::NoProfile),
            Some(pin) => match &self.load {
                Load::Loaded(l) if l.pin == pin => Some(Bundle::Loaded(pin)),
                Load::Failed(p) if *p == pin => Some(Bundle::Unavailable),
                _ if self.cache.failed.contains(&hex(&pin.hash)) => Some(Bundle::Unavailable),
                _ if session.me().is_some_and(|me| session.in_flight(&me)) => Some(Bundle::Loading),
                _ => None,
            },
        }
    }

    /// Where this core holds a bundle, by its hash: its cache, or else its local folder.
    pub(crate) fn held_path(&self, hash: &str) -> Option<String> {
        if self.cache.holds(hash) {
            Some(cache::path(hash))
        } else {
            self.local.file(hash)
        }
    }

    /// A member's value of the match check's item: this member's own as the loader holds it, and
    /// another's as its `match` key carries it.
    pub(crate) fn value_of(&self, session: &Session, member: &PilotId) -> Option<Bundle> {
        if session.me().as_ref() == Some(member) {
            return self.mine(session);
        }
        let values = session.member_key(MATCH, member)?;
        let (_, bytes) = values.items.iter().find(|(n, _)| *n == BUNDLE.number)?;
        postcard::from_bytes(bytes).ok()
    }
}

/// The match check's comparison: a member with no profile, or without the session's, is an
/// error, even when every member shows it, since state sync, pointer sync, and avatars find
/// nothing to load (record/areas/session/02-units.md, "The match check"). The words are the
/// frames' (`HEADS_UP` in experiments/areas/interface/bench/src/frames/home.tsx), from the side of
/// the pilot reading them, `mine` (user, 2026-11-17).
fn compare(values: &[(String, Bundle)], mine: Option<usize>) -> Option<Found> {
    if values.iter().any(|(_, v)| *v == Bundle::NoProfile) {
        return Some(Found {
            level: Severity::Error,
            words: "No profile for this aircraft".into(),
            note: Some("The cockpits won't sync".into()),
        });
    }
    // The pinned bundle is local, unpublished, when the pilot flying's own folder holds it.
    let unpublished = values
        .iter()
        .position(|(_, v)| matches!(v, Bundle::Loaded(pin) if pin.local));
    if mine.is_some_and(|i| values[i].1 == Bundle::Unavailable) {
        let words = match unpublished {
            Some(holder) => format!(
                "{}'s profile for this aircraft is unpublished, so you don't have it",
                values[holder].0
            ),
            None => "Your PC couldn't download this aircraft's profile".into(),
        };
        return Some(Found {
            level: Severity::Error,
            words,
            note: Some("Your switches, knobs, and displays won't sync".into()),
        });
    }
    let missing: Vec<&str> = values
        .iter()
        .enumerate()
        .filter(|(i, (_, v))| Some(*i) != mine && *v == Bundle::Unavailable)
        .map(|(_, (name, _))| name.as_str())
        .collect();
    if let [one] = missing.as_slice() {
        return Some(Found {
            level: Severity::Error,
            words: lacks(one, "doesn't", unpublished, mine, values),
            note: Some(format!("{one}'s switches, knobs, and displays won't sync")),
        });
    }
    if !missing.is_empty() {
        let (last, rest) = missing.split_last()?;
        let who = format!("{} and {last}", rest.join(", "));
        return Some(Found {
            level: Severity::Error,
            words: lacks(&who, "don't", unpublished, mine, values),
            note: Some("Their switches, knobs, and displays won't sync".into()),
        });
    }
    let hashes: BTreeSet<[u8; 32]> = values
        .iter()
        .filter_map(|(_, v)| match v {
            Bundle::Loaded(pin) => Some(pin.hash),
            _ => None,
        })
        .collect();
    (hashes.len() > 1).then(|| Found {
        level: Severity::Error,
        words: "The pilots loaded different profiles".into(),
        note: None,
    })
}

/// What the members `who` lack: a published bundle they couldn't download, or the unpublished one
/// the member at `unpublished` pinned, this pilot's own or another's.
fn lacks(
    who: &str,
    do_not: &str,
    unpublished: Option<usize>,
    mine: Option<usize>,
    values: &[(String, Bundle)],
) -> String {
    match unpublished {
        Some(holder) if Some(holder) == mine => {
            format!("{who} {do_not} have your unpublished profile for this aircraft")
        }
        Some(holder) => format!(
            "{who} {do_not} have {}'s unpublished profile for this aircraft",
            values[holder].0
        ),
        None => format!("{who} couldn't download this aircraft's profile"),
    }
}

/// The folder a variant is in, a preset's first part, in lowercase.
fn folder(variant: &str) -> String {
    variant
        .split('/')
        .next()
        .unwrap_or(variant)
        .to_ascii_lowercase()
}

/// The folders a bundle's variants cover, each once, in the variants' order, so `pick` asks for
/// the first one installed.
fn folders_of(bundle: &IndexBundle) -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    for f in bundle.variants.iter().map(|v| folder(v)) {
        if !folders.contains(&f) {
            folders.push(f);
        }
    }
    folders
}

fn shown(status: ProfileStatus) -> wire::ProfileStatus {
    match status {
        ProfileStatus::Flawless => wire::ProfileStatus::Flawless,
        ProfileStatus::Complete => wire::ProfileStatus::Complete,
        ProfileStatus::Partial => wire::ProfileStatus::Partial,
        ProfileStatus::Experimental => wire::ProfileStatus::Experimental,
    }
}

/// The site's address, with no `/` at its end.
pub(crate) fn site(cx: &Cx) -> String {
    cx.read::<Clients>()
        .setting_as::<String>(SITE)
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| SITE_URL.into())
        .trim_end_matches('/')
        .to_string()
}

/// Runs at the edge on a bundle the loader reads to load: its hash, and its profile checked
/// at this core's level, or why it doesn't read.
fn checked_bundle(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let profile = profile_engine::read(&bytes, profile_engine::LEVEL).map_err(|r| r.to_string());
    postcard::to_stdvec(&(profile_engine::hash(&bytes), profile)).map_err(|e| e.to_string())
}

/// Each bundle the index gives this core's level, by its profile.
pub(crate) fn chosen(index: &Index) -> BTreeMap<String, String> {
    index
        .profiles
        .iter()
        .filter_map(|p| {
            p.bundle_for(profile_engine::LEVEL)
                .map(|b| (p.path.clone(), b.hash.clone()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(n: u8) -> Pin {
        Pin {
            hash: [n; 32],
            local: false,
            from: None,
        }
    }

    #[test]
    fn no_profile_is_an_error_even_when_every_member_shows_it() {
        let found = compare(
            &[
                ("A".into(), Bundle::NoProfile),
                ("B".into(), Bundle::NoProfile),
            ],
            Some(0),
        );
        assert_eq!(
            found.map(|f| f.words).as_deref(),
            Some("No profile for this aircraft")
        );
    }

    #[test]
    fn the_same_bundle_everywhere_shows_nothing() {
        assert_eq!(
            compare(
                &[
                    ("A".into(), Bundle::Loaded(pin(1))),
                    ("B".into(), Bundle::Loaded(pin(1)))
                ],
                Some(0)
            ),
            None
        );
        let values = [
            ("A".into(), Bundle::Loaded(pin(1))),
            ("B".into(), Bundle::Unavailable),
        ];
        let words = |mine| compare(&values, mine).map(|f| f.words);
        assert_eq!(
            words(Some(0)).as_deref(),
            Some("B couldn't download this aircraft's profile")
        );
        assert_eq!(
            words(Some(1)).as_deref(),
            Some("Your PC couldn't download this aircraft's profile")
        );
    }

    #[test]
    fn a_member_still_loading_shows_no_difference() {
        let values = [
            ("A".into(), Bundle::Loaded(pin(1))),
            ("B".into(), Bundle::Loading),
        ];
        assert_eq!(compare(&values, Some(0)), None);
        assert_eq!(compare(&values, Some(1)), None);
    }

    #[test]
    fn an_unpublished_bundle_names_whose_it_is_from_each_side() {
        let local = Pin {
            hash: [1; 32],
            local: true,
            from: None,
        };
        let values = [
            ("James".into(), Bundle::Loaded(local)),
            ("Adam".into(), Bundle::Unavailable),
        ];
        let words = |mine| compare(&values, mine).map(|f| f.words);
        assert_eq!(
            words(Some(0)).as_deref(),
            Some("Adam doesn't have your unpublished profile for this aircraft")
        );
        assert_eq!(
            words(Some(1)).as_deref(),
            Some("James's profile for this aircraft is unpublished, so you don't have it")
        );
    }
}
