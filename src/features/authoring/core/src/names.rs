//! What `authoring` watches through sim variables: every name the open files' `watch:` lines
//! name, and every name its engine's bundle reads, so a write function sees `state` as this
//! cockpit stands. For each it keeps the last reading or error, its firings, and its distinct
//! values (record/areas/profiles/04-the-extension-in-the-sim.md, "What `authoring` does").

use std::collections::{BTreeMap, BTreeSet};

use kernel::{Cx, Handle};
use messages::authoring::{self as wire, OpenName, Reads};
use messages::sync::Value;
use profile_engine::{Name, read_name};
use sim_variables::{Got, VariablesCx, VariablesEvent, Watch};
use sync_engine::Watching;

/// The most distinct values a name keeps, one more than the panel shows, so it tells 8 from
/// more than 8 (record/areas/profiles/04-the-extension-in-the-sim.md, "The panel's Run").
const KEPT: usize = 9;

/// A name as it's watched: the name call as `Name`'s `Display` writes it, so two spellings of
/// one call share a key, and how it's read.
pub(crate) type Key = (String, Reads);

pub(crate) fn key_of(name: &Name, reads: Reads) -> Key {
    (name.to_string(), reads)
}

/// The key the engine's watch of a name has.
pub(crate) fn engine_key(watch: &sync_engine::Watch) -> Key {
    key_of(&watch.name, reads_of(watch.watching))
}

fn reads_of(watching: Watching) -> Reads {
    match watching {
        Watching::Occurrence => Reads::Occurrences,
        Watching::Value | Watching::Pulse => Reads::Value,
    }
}

/// One name call the open files name, as `authoring.open` gave it.
pub(crate) struct Opened {
    pub(crate) text: String,
    pub(crate) reads: Reads,
    /// The name it calls, or none for a text that isn't a name call.
    pub(crate) name: Option<Name>,
}

#[derive(Default)]
struct Record {
    value: Option<Value>,
    error: Option<String>,
    /// Each value it has read, once, in the order it first read them.
    seen: Vec<Value>,
    /// Its occurrences since its line was watched, and the last value one carried.
    fired: u32,
    carried: Option<f64>,
    /// An `L:` pulse's last value, whose every rise from 0 is one occurrence, as the sync engine
    /// counts a pulse.
    pulse: Option<f64>,
}

/// Whose watch an event of `on_variables` came for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum For {
    Engine,
    Open,
    /// A watch whose name another watch counts, as a name dropped and typed again is counted by
    /// its new watch.
    Nobody,
}

/// One name of a watch of open names: its key, and whether it's an `L:` pulse.
type Place = (Key, bool);

#[derive(Default)]
pub(crate) struct Names {
    /// The open files' name calls, each text once, in the order they came.
    opened: Vec<Opened>,
    records: BTreeMap<Key, Record>,
    /// Each watch of open names, by its handle, with each place's name.
    open: BTreeMap<Handle, Vec<Place>>,
    /// The watch and place each open name's occurrences count from. A name dropped and typed
    /// again gets a watch of its own while the earlier watch may still hold it for other names,
    /// and both would otherwise count each of its firings.
    owner: BTreeMap<Key, (Handle, usize)>,
    /// The engine's watch, with each place's key.
    engine: Option<(Handle, Vec<Key>)>,
}

impl Names {
    /// The open files' names as `authoring.open` gave them: the names new to this list get their
    /// watch, all of them in one, and a name the list leaves out stops counting its firings, so
    /// one typed again counts from 0.
    pub(crate) fn open(&mut self, names: &[OpenName], cx: &Cx) {
        self.opened.clear();
        let mut wanted: Vec<(Key, Name)> = Vec::new();
        for open in names {
            if self.opened.iter().any(|o| o.text == open.name) {
                continue;
            }
            let name = read_name(&open.name);
            if let Some(name) = &name {
                let key = key_of(name, open.reads);
                if !wanted.iter().any(|(k, _)| *k == key) {
                    wanted.push((key, name.clone()));
                }
            }
            self.opened.push(Opened {
                text: open.name.clone(),
                reads: open.reads,
                name,
            });
        }
        let keys: BTreeSet<&Key> = wanted.iter().map(|(k, _)| k).collect();
        let dropped: Vec<Key> = self
            .owner
            .keys()
            .filter(|k| !keys.contains(k))
            .cloned()
            .collect();
        for key in &dropped {
            self.owner.remove(key);
            if let Some(record) = self.records.get_mut(key) {
                record.fired = 0;
                record.carried = None;
                record.pulse = None;
            }
        }
        let added: Vec<(Key, Name)> = wanted
            .into_iter()
            .filter(|(k, _)| !self.owner.contains_key(k))
            .collect();
        if !added.is_empty() {
            let watches: Vec<Watch> = added
                .iter()
                .map(|((_, reads), name)| Watch {
                    name: name.clone(),
                    reads: watched_as(*reads),
                })
                .collect();
            let handle = cx.variables().watch(&watches);
            for (place, (key, _)) in added.iter().enumerate() {
                self.owner.insert(key.clone(), (handle, place));
                self.records.entry(key.clone()).or_default();
            }
            let places = added
                .into_iter()
                .map(|(key, name)| {
                    let pulse = key.1 == Reads::Occurrences && matches!(name, Name::L { .. });
                    (key, pulse)
                })
                .collect();
            self.open.insert(handle, places);
        }
        self.end_unowned(cx);
        self.prune();
    }

    /// Watches the engine's names, in its order, in place of the engine's before.
    pub(crate) fn watch_engine(&mut self, watches: &[sync_engine::Watch], cx: &Cx) {
        if let Some((handle, _)) = self.engine.take() {
            cx.variables().end(handle);
        }
        let names: Vec<Watch> = watches
            .iter()
            .map(|w| Watch {
                name: w.name.clone(),
                reads: watched_as(reads_of(w.watching)),
            })
            .collect();
        let keys: Vec<Key> = watches.iter().map(engine_key).collect();
        for key in &keys {
            self.records.entry(key.clone()).or_default();
        }
        self.engine = Some((cx.variables().watch(&names), keys));
        self.prune();
    }

    /// Stops watching the engine's names.
    pub(crate) fn end_engine(&mut self, cx: &Cx) {
        if let Some((handle, _)) = self.engine.take() {
            cx.variables().end(handle);
        }
        self.prune();
    }

    /// Stops every watch.
    pub(crate) fn end(&mut self, cx: &Cx) {
        self.end_engine(cx);
        for handle in std::mem::take(&mut self.open).into_keys() {
            cx.variables().end(handle);
        }
        self.owner.clear();
        self.records.clear();
    }

    /// Notes what a watch got, and says whose watch it was.
    pub(crate) fn got(&mut self, event: &VariablesEvent) -> For {
        if let Some((handle, keys)) = &self.engine
            && *handle == event.watch
        {
            if let Some(record) = keys.get(event.place).and_then(|k| self.records.get_mut(k)) {
                note(record, &event.got, None);
            }
            return For::Engine;
        }
        let Some((key, pulse)) = self.open.get(&event.watch).and_then(|p| p.get(event.place))
        else {
            return For::Nobody;
        };
        if self.owner.get(key) != Some(&(event.watch, event.place)) {
            return For::Nobody;
        }
        if let Some(record) = self.records.get_mut(key) {
            note(record, &event.got, Some(*pulse));
        }
        For::Open
    }

    /// The open files' names, each once, in their order.
    pub(crate) fn opened(&self) -> &[Opened] {
        &self.opened
    }

    /// What a name the open files name shows, or none before it read anything, as a value, or
    /// its firings, or its error.
    pub(crate) fn shown(&self, opened: &Opened) -> wire::Got {
        let Some(name) = &opened.name else {
            return wire::Got::Error {
                error: format!("`{}` isn't a name call", opened.text),
            };
        };
        let Some(record) = self.records.get(&key_of(name, opened.reads)) else {
            return wire::Got::Waiting;
        };
        if let Some(error) = &record.error {
            return wire::Got::Error {
                error: error.clone(),
            };
        }
        match (opened.reads, &record.value) {
            (Reads::Occurrences, _) => wire::Got::Fired {
                times: record.fired,
                last: record.carried,
            },
            (Reads::Value, Some(value)) => wire::Got::Value {
                value: crate::shown(value),
            },
            (Reads::Value, None) => wire::Got::Waiting,
        }
    }

    /// A name's last reading.
    pub(crate) fn value(&self, key: &Key) -> Option<&Value> {
        self.records.get(key).and_then(|r| r.value.as_ref())
    }

    /// The values a name has read since it was watched, in ascending order, or more than 8.
    pub(crate) fn seen(&self, key: &Key) -> wire::Seen {
        let seen = self.records.get(key).map_or(&[][..], |r| &r.seen[..]);
        if seen.len() >= KEPT {
            return wire::Seen::Many;
        }
        let mut values = seen.to_vec();
        values.sort_by(ascending);
        wire::Seen::Values {
            values: values.iter().map(crate::shown).collect(),
        }
    }

    fn end_unowned(&mut self, cx: &Cx) {
        let owned: BTreeSet<Handle> = self.owner.values().map(|(h, _)| *h).collect();
        let unowned: Vec<Handle> = self
            .open
            .keys()
            .filter(|h| !owned.contains(h))
            .copied()
            .collect();
        for handle in unowned {
            self.open.remove(&handle);
            cx.variables().end(handle);
        }
    }

    /// Forgets the records of names nothing watches.
    fn prune(&mut self) {
        let engine: BTreeSet<&Key> = self.engine.iter().flat_map(|(_, keys)| keys).collect();
        let owner = &self.owner;
        self.records
            .retain(|key, _| owner.contains_key(key) || engine.contains(key));
    }
}

fn watched_as(reads: Reads) -> sim_variables::Reads {
    match reads {
        Reads::Value => sim_variables::Reads::Value,
        Reads::Occurrences => sim_variables::Reads::Occurrences,
    }
}

/// Notes what a name got. `counts` is whether this watch counts its firings, `Some` with
/// whether the name is a pulse, and `None` for a watch that doesn't, as the engine's doesn't
/// beside the open files' own.
fn note(record: &mut Record, got: &Got, counts: Option<bool>) {
    match got {
        Got::Read(value) => {
            record.error = None;
            if record.seen.len() < KEPT && !record.seen.iter().any(|v| v.same(value)) {
                record.seen.push(value.clone());
            }
            if counts == Some(true) {
                let now = value.number().unwrap_or(0.0);
                if record.pulse.replace(now) == Some(0.0) && now != 0.0 {
                    record.fired = record.fired.saturating_add(1);
                    record.carried = Some(now);
                }
            }
            record.value = Some(value.clone());
        }
        Got::Fired(value) => {
            if counts.is_some() {
                record.fired = record.fired.saturating_add(1);
                record.carried = *value;
            }
        }
        Got::Failed(error) => record.error = Some(error.clone()),
    }
}

/// Numbers before texts, each in ascending order.
fn ascending(a: &Value, b: &Value) -> std::cmp::Ordering {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.total_cmp(b),
        (Value::Number(_), Value::Text(_)) => std::cmp::Ordering::Less,
        (Value::Text(_), Value::Number(_)) => std::cmp::Ordering::Greater,
        (Value::Text(a), Value::Text(b)) => a.cmp(b),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(n: f64) -> Got {
        Got::Read(Value::Number(n))
    }

    #[test]
    fn a_pulse_counts_each_rise_from_0_but_not_its_first_reading() {
        let mut record = Record::default();
        for n in [1.0, 0.0, 1.0, 1.0, 0.0, 2.0] {
            note(&mut record, &read(n), Some(true));
        }
        assert_eq!(record.fired, 2, "0 to 1 and 0 to 2, and not the first 1");
        assert_eq!(record.carried, Some(2.0));
    }

    #[test]
    fn a_watch_that_doesnt_count_firings_still_notes_values() {
        let mut record = Record::default();
        note(&mut record, &Got::Fired(Some(3.0)), None);
        note(&mut record, &read(1.0), None);
        assert_eq!(record.fired, 0);
        assert_eq!(record.value, Some(Value::Number(1.0)));
    }

    #[test]
    fn values_seen_keep_9_distinct_as_f32_and_show_8_in_ascending_order_or_more() {
        let mut names = Names::default();
        let key: Key = ("L('X')".into(), Reads::Value);
        names.records.insert(key.clone(), Record::default());
        let record = names.records.get_mut(&key).expect("the record");
        for n in [3.0, 1.0, 1.000_000_01, 2.0] {
            note(record, &read(n), None);
        }
        assert_eq!(
            names.seen(&key),
            wire::Seen::Values {
                values: [1.0, 2.0, 3.0].map(wire::Value::Number).to_vec()
            },
            "1 and 1.00000001 read the same as f32"
        );
        let record = names.records.get_mut(&key).expect("the record");
        for n in 4..=9 {
            note(record, &read(f64::from(n)), None);
        }
        assert!(matches!(names.seen(&key), wire::Seen::Many), "9 values");
    }

    #[test]
    fn an_error_shows_until_the_name_reads_again() {
        let mut record = Record::default();
        note(&mut record, &Got::Failed("refused".into()), None);
        assert_eq!(record.error.as_deref(), Some("refused"));
        note(&mut record, &read(1.0), None);
        assert_eq!(record.error, None);
    }
}
