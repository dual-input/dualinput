//! The rules that give state sync's two panel modules their panels, and the paths the
//! `instrument-reads` module reads (record/areas/sync/05-units.md, "`H:` events", and
//! record/areas/plugins/01-plugins.md, "Reading it in the panel").

use clients::To;
use kernel::{Cx, View};
use messages::state_sync::{INSTRUMENT_READS, InstrumentPath, InstrumentPaths};
use profile_engine::{Name, Resolved, Watch as EntryWatch, key_names};
use profile_loader::Profiles;
use sync_engine::Watch;

use crate::StateSync;

fn profile<'v>(view: &'v View<'_>) -> Option<&'v Resolved> {
    view.read::<Profiles>().loaded().map(|l| &l.profile)
}

/// Whether the loaded variant watches an `H:` name, in an event entry or in a counting entry's
/// events. The rules read the profile, not the engine, since the clients crate can answer a
/// panel before state sync hears of the load.
pub(crate) fn any_h_event(view: &View) -> bool {
    let h = |name: &Name| matches!(name, Name::H { .. });
    profile(view).is_some_and(|p| {
        p.events.iter().any(|e| h(&e.watch))
            || p.state.iter().any(|s| match &s.watch {
                EntryWatch::Count(c) => [&c.inc, &c.dec, &c.set].into_iter().flatten().any(h),
                EntryWatch::Name(name) => h(name),
            })
    })
}

/// `h-events` goes to one panel, since a handler in every panel would hear each event once in
/// each: the first asked about after the load, and that panel again, by its instruments' keys,
/// after it reloads. A panel whose instrument the sim created after its `hello` joins again
/// naming that one too, so the panel is the one whose keys include every key kept.
pub(crate) fn h_events_rule(view: &View, instruments: &[String]) -> Vec<String> {
    if !any_h_event(view) {
        return Vec::new();
    }
    let me = view.read::<StateSync>();
    let mut chosen = me.h_events_panel.borrow_mut();
    if chosen
        .as_ref()
        .is_some_and(|keys| !keys.iter().all(|k| instruments.contains(k)))
    {
        return Vec::new();
    }
    *chosen = Some(instruments.to_vec());
    instruments.to_vec()
}

/// Each `instrument()` the loaded variant's state entries name, by its key.
fn instrument_keys(profile: &Resolved) -> impl Iterator<Item = &String> {
    profile.state.iter().filter_map(|e| match &e.watch {
        EntryWatch::Name(Name::Instrument { key, .. }) => Some(key),
        _ => None,
    })
}

pub(crate) fn any_instrument(view: &View) -> bool {
    profile(view).is_some_and(|p| instrument_keys(p).next().is_some())
}

/// `instrument-reads` goes to each panel holding an instrument an `instrument()` names.
pub(crate) fn instruments_rule(view: &View, instruments: &[String]) -> Vec<String> {
    let Some(profile) = profile(view) else {
        return Vec::new();
    };
    instruments
        .iter()
        .filter(|i| instrument_keys(profile).any(|k| key_names(k, i)))
        .cloned()
        .collect()
}

/// Sends a panel's `instrument-reads` module the paths its instruments serve, each numbered by
/// its watch's place, which the module's readings name it by.
pub(crate) fn send_paths(watches: &[Watch], instruments: &[String], socket: u64, cx: &Cx) {
    let mut paths = Vec::new();
    for (number, watch) in watches.iter().enumerate() {
        let Name::Instrument { key, path, text } = &watch.name else {
            continue;
        };
        for instrument in instruments.iter().filter(|i| key_names(key, i)) {
            paths.push(InstrumentPath {
                number: number as u32,
                instrument: instrument.clone(),
                path: path.clone(),
                text: *text,
            });
        }
    }
    clients::send(
        cx,
        To::Socket(socket),
        INSTRUMENT_READS,
        &InstrumentPaths { paths },
    );
}
