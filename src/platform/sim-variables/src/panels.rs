//! The rules that give the two panel modules their panels, what the modules tell the core, and
//! the paths the `instrument-reads` module reads (record/areas/sync/05-units.md, "`H:` events",
//! and record/areas/plugins/01-plugins.md, "Reading it in the panel").

use std::collections::BTreeMap;

use clients::{Sender, To};
use kernel::{Cx, View};
use messages::sim_variables::{
    FromInstrumentReads, HeardH, INSTRUMENT_READS, InstrumentPath, InstrumentPaths, Reading,
};
use messages::sync::Value;
use profile_engine::key_names;

use crate::SimVariables;
use crate::watches::Source;

/// The `instrument-reads` modules running, and the number each path goes by.
#[derive(Default)]
pub(crate) struct Panels {
    /// Each running module's instruments, by its panel's socket, from the module's start.
    modules: BTreeMap<u64, Vec<String>>,
    /// Each path's number, which its readings name it by. A number is never given twice, so a
    /// reading still on its way for a path no watch reads now finds nothing.
    numbers: BTreeMap<Source, u32>,
    paths: BTreeMap<u32, Source>,
    next: u32,
}

impl Panels {
    /// A panel's socket closed, and its module with it.
    pub(crate) fn left(&mut self, socket: u64) {
        self.modules.remove(&socket);
    }

    /// Forgets the numbers of paths no watch reads.
    pub(crate) fn forget(&mut self, gone: &[Source]) {
        for source in gone {
            if let Some(number) = self.numbers.remove(source) {
                self.paths.remove(&number);
            }
        }
    }

    fn number(&mut self, source: &Source) -> u32 {
        if let Some(&number) = self.numbers.get(source) {
            return number;
        }
        let number = self.next;
        self.next += 1;
        self.numbers.insert(source.clone(), number);
        self.paths.insert(number, source.clone());
        number
    }
}

fn watched<'v>(view: &'v View<'_>) -> impl Iterator<Item = &'v Source> + 'v {
    view.read::<SimVariables>().watches.watched()
}

/// Whether a feature watches an `H:` event.
pub(crate) fn any_html_event(view: &View) -> bool {
    watched(view).any(|s| matches!(s, Source::Html(_)))
}

/// `h-events` takes every instrument of its panel, and the clients crate keeps it to one panel,
/// since it's registered with `one_panel_module`, as a handler in every panel would hear each
/// event once in each (record/areas/sync/05-units.md, "`H:` events").
pub(crate) fn h_events_rule(view: &View, instruments: &[String]) -> Vec<String> {
    if any_html_event(view) {
        instruments.to_vec()
    } else {
        Vec::new()
    }
}

/// The key of each `instrument()` a feature watches.
fn instrument_keys<'v>(view: &'v View<'_>) -> impl Iterator<Item = &'v String> + 'v {
    watched(view).filter_map(|s| match s {
        Source::Instrument { key, .. } => Some(key),
        _ => None,
    })
}

pub(crate) fn any_instrument(view: &View) -> bool {
    instrument_keys(view).next().is_some()
}

/// `instrument-reads` goes to each panel holding an instrument a watched `instrument()` names.
/// It takes every instrument of that panel, as `h-events` does, so an `instrument()` watched
/// later on another of them is read too, since `clients` carries on a module a panel keeps with
/// the instruments it started with. `send_paths` sends it only the paths a watch names.
pub(crate) fn instruments_rule(view: &View, instruments: &[String]) -> Vec<String> {
    let named = instruments
        .iter()
        .any(|i| instrument_keys(view).any(|k| key_names(k, i)));
    if named {
        instruments.to_vec()
    } else {
        Vec::new()
    }
}

impl SimVariables {
    /// An `H:` event heard in the panel that holds `h-events`.
    pub(crate) fn heard_h(me: &mut SimVariables, from: Sender, heard: HeardH, cx: &mut Cx) {
        tracing::trace!(socket = from.socket, name = heard.name, target = ?heard.target, "a panel heard an H: event");
        let got = me.watches.fired(&Source::Html(heard.name), None);
        me.hand_on(got, cx);
    }

    /// A message from an `instrument-reads` module: it started, or some paths' values changed.
    pub(crate) fn instrument_reads(
        me: &mut SimVariables,
        from: Sender,
        message: FromInstrumentReads,
        cx: &mut Cx,
    ) {
        match message {
            FromInstrumentReads::Started { instruments } => {
                me.panels.modules.insert(from.socket, instruments);
                me.send_paths(from.socket, cx);
            }
            FromInstrumentReads::Read { readings } => {
                for r in readings {
                    let Some(source) = me.panels.paths.get(&r.number).cloned() else {
                        continue;
                    };
                    let got = match r.reading {
                        Reading::Number(n) => me.watches.read(&source, Value::Number(n), false),
                        Reading::Text(t) => me.watches.read(&source, Value::Text(t), false),
                        Reading::Error(error) => me.watches.failed(&source, error),
                    };
                    me.hand_on(got, cx);
                }
            }
        }
    }

    /// Sends every running `instrument-reads` module its paths again, as the paths watched
    /// changed. A module that reads a new set of paths reads each at once, so a watch of one
    /// gets its reading within the module's next read.
    pub(crate) fn send_every_panel_paths(&mut self, cx: &Cx) {
        let sockets: Vec<u64> = self.panels.modules.keys().copied().collect();
        for socket in sockets {
            self.send_paths(socket, cx);
        }
    }

    /// Sends a panel's `instrument-reads` module the paths a watch names on its instruments.
    fn send_paths(&mut self, socket: u64, cx: &Cx) {
        let Some(instruments) = self.panels.modules.get(&socket).cloned() else {
            return;
        };
        let sources: Vec<Source> = self
            .watches
            .watched()
            .filter(|s| s.is_instrument())
            .cloned()
            .collect();
        let mut paths = Vec::new();
        for source in sources {
            let Source::Instrument { key, path, text } = &source else {
                continue;
            };
            for instrument in instruments.iter().filter(|i| key_names(key, i)) {
                paths.push(InstrumentPath {
                    number: self.panels.number(&source),
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
}
