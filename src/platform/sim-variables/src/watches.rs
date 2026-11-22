//! Features' watches, shared by what the sim reads: each source has one watch in the sim
//! however many features watch it, and keeps its last reading, so a feature that starts
//! watching it later gets that reading at once. A watch already live in the sim reports only
//! changes (read in src/engines/sim-client/src/client.rs, `watch_on`, `FLAG_CHANGED`), so a
//! profile reloaded in a test session would otherwise never read its switches
//! (record/areas/profiles/04-the-extension-in-the-sim.md, "Reaching the sim by name").

use std::collections::BTreeMap;

use messages::sync::Value;
use profile_engine::Name;

use crate::{Got, Reads, Watch};

/// What the sim, or a panel module, reads for a name, which every watch of that name shares.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Source {
    /// An `L:` or `A:` variable, by its name as SimConnect takes it and its unit, so `L('X')` and
    /// `L('X', 'Number')` are one.
    Variable { name: String, unit: String },
    /// A `K:` event, which one listen hears.
    Key(String),
    /// An input event, by its name with no `B:`.
    Input(String),
    /// An `H:` event, by its name with no `H:`.
    Html(String),
    /// A value in a gauge's JavaScript.
    Instrument {
        key: String,
        path: String,
        text: bool,
    },
}

impl Source {
    pub(crate) fn of(name: &Name) -> Source {
        match name {
            Name::L { name, unit } => Source::Variable {
                name: format!("L:{name}"),
                unit: unit.clone().unwrap_or_else(|| "Number".to_string()),
            },
            Name::A { name, unit } => Source::Variable {
                name: name.clone(),
                unit: unit.clone(),
            },
            Name::B { name } => Source::Input(name.clone()),
            Name::K { name, .. } => Source::Key(name.clone()),
            Name::H { name } => Source::Html(name.clone()),
            Name::Instrument { key, path, text } => Source::Instrument {
                key: key.clone(),
                path: path.clone(),
                text: *text,
            },
        }
    }

    pub(crate) fn is_instrument(&self) -> bool {
        matches!(self, Source::Instrument { .. })
    }

    /// Whether a panel module reads it: `h-events` an `H:` event, and `instrument-reads` an
    /// `instrument()` value.
    pub(crate) fn in_a_panel(&self) -> bool {
        matches!(self, Source::Html(_) | Source::Instrument { .. })
    }
}

/// A source's last reading.
#[derive(Clone, Debug, PartialEq)]
enum Last {
    Value(Value),
    Failed(String),
}

/// Every feature's watches, by the key each watch's call returned, `W`, which is a kernel
/// handle in the core.
pub(crate) struct Watches<W> {
    /// Each watch's names, as sources, with how each reads, in the watch's order.
    watches: BTreeMap<W, Vec<(Source, Reads)>>,
    /// Each source's watchers: a watch, and the place of the name in it.
    watchers: BTreeMap<Source, Vec<(W, usize)>>,
    last: BTreeMap<Source, Last>,
}

impl<W> Default for Watches<W> {
    fn default() -> Self {
        Watches {
            watches: BTreeMap::new(),
            watchers: BTreeMap::new(),
            last: BTreeMap::new(),
        }
    }
}

impl<W: Copy + Ord> Watches<W> {
    /// Adds a watch. Returns the sources no watch watched before, and what the watch gets at
    /// once: each name's last reading, which an input event watched as occurrences leaves out,
    /// since a reading says only where the input stands.
    pub(crate) fn add(&mut self, watch: W, names: &[Watch]) -> (Vec<Source>, Vec<(W, usize, Got)>) {
        let mut new = Vec::new();
        let mut now = Vec::new();
        let mut kept = Vec::new();
        for (place, name) in names.iter().enumerate() {
            let source = Source::of(&name.name);
            let watchers = self.watchers.entry(source.clone()).or_default();
            if watchers.is_empty() {
                new.push(source.clone());
            }
            watchers.push((watch, place));
            match self.last.get(&source) {
                Some(Last::Failed(error)) => now.push((watch, place, Got::Failed(error.clone()))),
                Some(Last::Value(value))
                    if name.reads == Reads::Value || !matches!(source, Source::Input(_)) =>
                {
                    now.push((watch, place, Got::Read(value.clone())));
                }
                _ => {}
            }
            kept.push((source, name.reads));
        }
        self.watches.insert(watch, kept);
        (new, now)
    }

    /// Ends a watch. Returns the sources no watch watches now. An instrument's last reading
    /// goes with its last watcher, since its panel module stops reading it, while the sim's
    /// watch of a variable or an event goes on until the flight ends.
    pub(crate) fn end(&mut self, watch: W) -> Vec<Source> {
        let Some(names) = self.watches.remove(&watch) else {
            return Vec::new();
        };
        let mut gone = Vec::new();
        for (source, _) in names {
            let Some(watchers) = self.watchers.get_mut(&source) else {
                continue;
            };
            watchers.retain(|(w, _)| *w != watch);
            if watchers.is_empty() {
                self.watchers.remove(&source);
                if source.is_instrument() {
                    self.last.remove(&source);
                }
                gone.push(source);
            }
        }
        gone
    }

    /// Every source some watch watches.
    pub(crate) fn watched(&self) -> impl Iterator<Item = &Source> {
        self.watchers.keys()
    }

    /// A value `source` read. `first` marks an input event's read as watching starts, which
    /// says only where the input stands, so a watch of its occurrences leaves it out; every
    /// other read of an input event is one occurrence, carrying its new value.
    pub(crate) fn read(
        &mut self,
        source: &Source,
        value: Value,
        first: bool,
    ) -> Vec<(W, usize, Got)> {
        self.last.insert(source.clone(), Last::Value(value.clone()));
        let input = matches!(source, Source::Input(_));
        self.each(source, |reads| match reads {
            Reads::Occurrences if input && first => None,
            Reads::Occurrences if input => Some(Got::Fired(value.number())),
            _ => Some(Got::Read(value.clone())),
        })
    }

    /// `source` fired, with the value it carried.
    pub(crate) fn fired(&self, source: &Source, value: Option<f64>) -> Vec<(W, usize, Got)> {
        self.each(source, |_| Some(Got::Fired(value)))
    }

    /// The sim refused `source`, or a panel couldn't read it, for the reason `error` says.
    pub(crate) fn failed(&mut self, source: &Source, error: String) -> Vec<(W, usize, Got)> {
        self.last
            .insert(source.clone(), Last::Failed(error.clone()));
        self.each(source, |_| Some(Got::Failed(error.clone())))
    }

    /// The flight ended, and the sim's watches with it, so no last reading still holds.
    pub(crate) fn forget_readings(&mut self) {
        self.last.clear();
    }

    /// What each watcher of `source` gets, by how its watch reads the name.
    fn each(&self, source: &Source, got: impl Fn(Reads) -> Option<Got>) -> Vec<(W, usize, Got)> {
        let Some(watchers) = self.watchers.get(source) else {
            return Vec::new();
        };
        watchers
            .iter()
            .filter_map(|&(watch, place)| {
                let reads = self.watches.get(&watch)?.get(place)?.1;
                Some((watch, place, got(reads)?))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(name: &str, unit: Option<&str>) -> Watch {
        Watch {
            name: Name::L {
                name: name.into(),
                unit: unit.map(str::to_string),
            },
            reads: Reads::Value,
        }
    }

    fn b(name: &str, reads: Reads) -> Watch {
        Watch {
            name: Name::B { name: name.into() },
            reads,
        }
    }

    fn strobe() -> Source {
        Source::of(&l("STROBE", None).name)
    }

    #[test]
    fn two_spellings_of_one_variable_share_its_watch() {
        let mut watches = Watches::default();
        let (new, _) = watches.add(1, &[l("STROBE", None)]);
        assert_eq!(new.len(), 1);
        let (new, _) = watches.add(2, &[l("STROBE", Some("Number"))]);
        assert!(new.is_empty(), "an L: with no unit reads as Number");
        let got = watches.read(&strobe(), Value::Number(1.0), false);
        assert_eq!(
            got,
            [
                (1, 0, Got::Read(Value::Number(1.0))),
                (2, 0, Got::Read(Value::Number(1.0)))
            ]
        );
    }

    #[test]
    fn a_watch_that_starts_later_gets_the_last_reading_at_once() {
        let mut watches = Watches::default();
        watches.add(1, &[l("STROBE", None)]);
        watches.read(&strobe(), Value::Number(1.0), false);
        let (new, now) = watches.add(2, &[l("STROBE", None)]);
        assert!(new.is_empty());
        assert_eq!(now, [(2, 0, Got::Read(Value::Number(1.0)))]);
    }

    #[test]
    fn ending_a_watch_stops_its_readings_and_leaves_the_others() {
        let mut watches = Watches::default();
        watches.add(1, &[l("STROBE", None)]);
        watches.add(2, &[l("STROBE", None)]);
        assert!(
            watches.end(1).is_empty(),
            "watch 2 still watches the strobe"
        );
        let got = watches.read(&strobe(), Value::Number(0.0), false);
        assert_eq!(got, [(2, 0, Got::Read(Value::Number(0.0)))]);
        assert_eq!(watches.end(2), [strobe()]);
        assert!(
            watches
                .read(&strobe(), Value::Number(1.0), false)
                .is_empty()
        );
    }

    #[test]
    fn an_input_event_watched_as_occurrences_leaves_out_its_first_read() {
        let mut watches = Watches::default();
        watches.add(
            1,
            &[b("BATTERY", Reads::Value), b("BATTERY", Reads::Occurrences)],
        );
        let source = Source::Input("BATTERY".into());
        let first = watches.read(&source, Value::Number(0.0), true);
        assert_eq!(first, [(1, 0, Got::Read(Value::Number(0.0)))]);
        let next = watches.read(&source, Value::Number(1.0), false);
        assert_eq!(
            next,
            [
                (1, 0, Got::Read(Value::Number(1.0))),
                (1, 1, Got::Fired(Some(1.0)))
            ]
        );
        let (_, now) = watches.add(
            2,
            &[b("BATTERY", Reads::Occurrences), b("BATTERY", Reads::Value)],
        );
        assert_eq!(
            now,
            [(2, 1, Got::Read(Value::Number(1.0)))],
            "a later occurrence watch gets no reading"
        );
    }

    #[test]
    fn a_refusal_reaches_every_watcher_and_a_later_one() {
        let mut watches = Watches::default();
        let wrong = Watch {
            name: Name::A {
                name: "NO SUCH VARIABLE".into(),
                unit: "Number".into(),
            },
            reads: Reads::Value,
        };
        watches.add(1, std::slice::from_ref(&wrong));
        watches.add(2, std::slice::from_ref(&wrong));
        let source = Source::of(&wrong.name);
        let got = watches.failed(&source, "refused".into());
        assert_eq!(
            got,
            [
                (1, 0, Got::Failed("refused".into())),
                (2, 0, Got::Failed("refused".into()))
            ]
        );
        let (_, now) = watches.add(3, &[wrong]);
        assert_eq!(now, [(3, 0, Got::Failed("refused".into()))]);
    }

    #[test]
    fn an_instrument_forgets_its_reading_with_its_last_watcher() {
        let mut watches = Watches::default();
        let gauge = Watch {
            name: Name::Instrument {
                key: "KR87A".into(),
                path: "bfoMode".into(),
                text: false,
            },
            reads: Reads::Value,
        };
        watches.add(1, std::slice::from_ref(&gauge));
        let source = Source::of(&gauge.name);
        watches.read(&source, Value::Number(1.0), false);
        assert_eq!(watches.end(1), [source]);
        let (_, now) = watches.add(2, &[gauge]);
        assert!(now.is_empty(), "no panel reads it while nothing watches it");
    }

    #[test]
    fn the_flights_end_forgets_every_reading() {
        let mut watches = Watches::default();
        watches.add(1, &[l("STROBE", None)]);
        watches.read(&strobe(), Value::Number(1.0), false);
        watches.forget_readings();
        let (_, now) = watches.add(2, &[l("STROBE", None)]);
        assert!(now.is_empty());
    }
}
