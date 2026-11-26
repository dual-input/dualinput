//! One entry's write outside a sync, which the profile extension's Run makes with a value its
//! author types, and the write's plan, which Run's preview shows
//! (record/areas/profiles/04-the-extension-in-the-sim.md, "The sync engine's single write").
//!
//! Both build the write the same way, and only `write_once` starts it, so from the same
//! readings the preview is what Run then sends.

use profile_engine::{Name, Steps, Write};

use crate::events::Unfired;
use crate::runs::{Chain, Run, action};
use crate::script::RunFailed;
use crate::{Ctx, Engine, Given, Out, Planned, Slot, Value};

/// A write outside a sync, built and not yet started.
struct Once {
    slot: Slot,
    run: Run,
    /// The value its state entry will read once a name's, a toggle's, or a function's write
    /// lands, which goes pending as the write starts; a stepping write's steps go pending one by
    /// one as they're sent.
    reads: Option<Value>,
}

impl Engine {
    /// Writes `entry` with `given`, as a receiving machine writes an arrival, from this engine's
    /// readings and its `state`, but outside a sync: with no stamp, no conflict rule, and no wait
    /// for another entry's pending value. A stepping write's later steps, and a chain's later
    /// actions, come out of the `frame` calls after it, at their pace, and a second write of the
    /// entry cuts the first short, as a new arrival does.
    ///
    /// It leaves what a receiving machine's write leaves, so the engine takes the reading that
    /// follows as the write's read back: a state entry's values go pending, though no check flags
    /// them, and an event entry's write leaves a token for the name it watches. So a stepping
    /// write started again before its last step reads back starts from that step, not from a
    /// reading that lags it.
    ///
    /// It fails where `plan` fails, writing nothing, with the same words. What it returns is only
    /// actions. In an engine from `Engine::load_only_asked`, so is everything `frame` returns:
    /// the rest of these writes and nothing else. In an engine that syncs, `frame` also carries
    /// on the sync's own writes, such as a put-back that steps.
    pub fn write_once(&mut self, entry: &str, given: Given, cx: Ctx) -> Result<Vec<Out>, String> {
        let Once { slot, run, reads } = self.once(entry, given)?;
        // A Run's write belongs to no row of the Sync log, which shows state sync's engine alone
        // (record/areas/profiles/06-the-sync-log.md, "Run and the Sync log").
        match slot {
            Slot::State(i) => {
                if let Some(value) = reads {
                    self.pend(i, value, None, false, 0);
                }
            }
            Slot::Event(i) => {
                if let Some(watched) = self.events.get(i).map(|e| e.entry.watch.clone()) {
                    self.leave_token(&watched, None, cx, slot, 0);
                }
            }
        }
        let mut out = Vec::new();
        self.start(slot, run, cx, &mut out);
        Ok(out)
    }

    /// What `write_once` would send for `entry` and `given`, from the same readings, changing
    /// nothing in the engine: nothing goes pending and no write starts. A write function runs in
    /// the sandbox to say what it writes, which leaves there only what any run leaves, such as a
    /// global the function set. The error says why nothing can be written, in words for the
    /// profile's author.
    pub fn plan(&mut self, entry: &str, given: Given) -> Result<Vec<Planned>, String> {
        Ok(self.once(entry, given)?.run.planned())
    }

    fn once(&mut self, entry: &str, given: Given) -> Result<Once, String> {
        match self.keys.get(entry).copied() {
            Some(Slot::State(i)) => self.state_once(entry, i, given),
            Some(Slot::Event(i)) => self.event_once(entry, i, given),
            None => Err(no_entry(entry)),
        }
    }

    fn state_once(&mut self, entry: &str, i: usize, given: Given) -> Result<Once, String> {
        let Some(slot) = self.state.get(i) else {
            return Err(no_entry(entry));
        };
        let write = slot.entry.write.clone();
        if matches!(write, Write::None) {
            return Err(format!(
                "`{entry}` is watch-only, with `write: none`, so it has nothing to write"
            ));
        }
        if slot.counted().is_some() {
            return match (write, given) {
                (Write::Steps(s), Given::Steps(n)) => Ok(self.counted_steps(i, &s, n)),
                (Write::Steps(_), _) => Err(format!(
                    "`{entry}` counts into a shadow value, which only state sync keeps, so it takes a step count, such as +3 or -2"
                )),
                _ => Err(format!(
                    "`{entry}` counts into a shadow value, which only state sync keeps, so it takes a step count, which only a write with `inc` and `dec` sends"
                )),
            };
        }
        let wanted = match given {
            Given::Value(value) => value,
            Given::Nothing => return Err(format!("`{entry}` takes a value to write")),
            Given::Steps(_) => {
                return Err(format!(
                    "`{entry}` takes a value to write, and only a counting entry takes a step count"
                ));
            }
        };
        // In a sync, every write to a state entry waits for its first reading, so a toggle never
        // flips blind, and outside one there's no later reading to wait for.
        let Some(reading) = slot.reading.clone() else {
            return Err(format!(
                "`{entry}` has no reading yet, and its write waits for one"
            ));
        };
        let there = reading.same(&wanted);
        let pace = self.pace;
        let single = |name: &Name, value: Option<&Value>| {
            Run::new(vec![Chain {
                action: action(name, value),
                times: 1,
                pace,
                step: None,
            }])
        };
        let (mut run, reads) = match write {
            Write::None => unreachable!("a watch-only entry returned above"),
            // A name writes only a value the cockpit doesn't already read, as in a sync, since a
            // name that sends no value, such as an `H:` event, would flip a switch that already
            // matches.
            Write::Name(_) | Write::Toggle(_) if there => (Run::new(Vec::new()), None),
            Write::Name(name) => (single(&name, Some(&wanted)), Some(wanted)),
            Write::Toggle(name) => (single(&name, None), Some(wanted)),
            Write::Steps(s) => {
                let Some((chain, count)) = self.steps_to(i, &s, &wanted) else {
                    return Err(format!(
                        "`{entry}` steps with `inc` and `dec`, from a number to a number"
                    ));
                };
                let mut run = Run::new(vec![chain]);
                run.count = Some(count);
                (run, None)
            }
            Write::Function(_) => {
                let ran = self
                    .script
                    .run(Slot::State(i), Some(&wanted))
                    .map_err(|failed| function_failed(entry, failed))?;
                // A function's value goes pending whatever it wrote, as in a sync, unless the
                // cockpit already reads it and so reports no change to match it.
                let reads = ran.reads.unwrap_or(wanted);
                let reads = (!reading.same(&reads)).then_some(reads);
                (Run::new(self.chains_of(ran.written)), reads)
            }
        };
        run.flags = false;
        Ok(Once {
            slot: Slot::State(i),
            run,
            reads,
        })
    }

    /// A counting entry's `n` steps of its write's `inc`, or `-n` of its `dec`. A shadow has
    /// nothing to read back, so nothing goes pending, and each step leaves a token for the event
    /// the count hears, as a sync's write of a counting entry does.
    fn counted_steps(&self, i: usize, s: &Steps, n: i32) -> Once {
        let mut run = Run::new(vec![Chain {
            action: action(if n > 0 { &s.inc } else { &s.dec }, None),
            times: u64::from(n.unsigned_abs()),
            pace: s.pace.unwrap_or(self.pace),
            step: None,
        }]);
        run.checked = false;
        run.flags = false;
        run.tokens = true;
        Once {
            slot: Slot::State(i),
            run,
            reads: None,
        }
    }

    fn event_once(&mut self, entry: &str, i: usize, given: Given) -> Result<Once, String> {
        let Some(write) = self.events.get(i).map(|e| e.entry.write.clone()) else {
            return Err(no_entry(entry));
        };
        let value = match given {
            Given::Value(value) => Some(value),
            Given::Nothing => None,
            Given::Steps(_) => {
                return Err(format!(
                    "`{entry}` is an event entry, which takes a value or none, and only a counting entry takes a step count"
                ));
            }
        };
        let chains = self
            .firing(i, write, value.as_ref())
            .map_err(|unfired| match unfired {
                Unfired::NoValue(name) => {
                    format!("`{entry}`'s write sets `{name}`, so it takes a value")
                }
                Unfired::Failed(failed) => function_failed(entry, failed),
                Unfired::Refused => format!(
                    "`{entry}` is an event entry whose write toggles, steps, or writes none, which a profile's check refuses"
                ),
            })?;
        let mut run = Run::new(chains);
        run.checked = false;
        run.flags = false;
        Ok(Once {
            slot: Slot::Event(i),
            run,
            reads: None,
        })
    }
}

fn no_entry(entry: &str) -> String {
    format!("the profile has no entry `{entry}`")
}

fn function_failed(entry: &str, failed: RunFailed) -> String {
    match failed {
        RunFailed::Limit(limit) => format!("`{entry}`'s write function stopped: {limit}"),
        RunFailed::Wrong(error) => format!("`{entry}`'s write function failed: {error}"),
    }
}
