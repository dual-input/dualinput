//! `serve`'s side of the Sync log: the rows it keeps of the steps state sync's engine logged, and
//! the notes beside a row (record/areas/profiles/06-the-sync-log.md).
//!
//! State sync sends each engine call's steps once, as a `unit` message, so `serve` keeps the
//! history: the last 10,000 rows, through a save's reload and past the session's end, until the
//! author presses Clear or VS Code closes. A row's words are the engine's own, as keys of the
//! list of words src/apps/profile-extension/src/words.ts holds with their definitions, and the
//! view's types serialize to the JSON whose types src/apps/profile-extension/sync-log/src/view.ts
//! holds, so change each pair together.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::time::{Duration, Instant};

use messages::authoring::{Planned, Preview};
use messages::state_sync::{Source, SyncLog};
use messages::sync::{Step, Stopping, Value, Withdrawal};
use serde::Serialize;

use super::view::number;

/// How many rows `serve` keeps, dropping the oldest first (user, 2026-11-25).
pub(crate) const KEPT: usize = 10_000;
/// The engine's check, the time it gives any write to read back, which is also how long after a
/// Run's last action a local change of its entry gets the note, so a note never lands on a
/// change made long after. `CHECK` in src/engines/sync-engine/src/lib.rs is the engine's, so
/// change both together.
const CHECK: Duration = Duration::from_millis(1_500);
/// A pace in frames, timed for the note at 30 frames a second, slower than a flight usually runs,
/// so the note still reaches the last step of a stepping Run on a slow PC.
const FRAME: Duration = Duration::from_micros(33_334);

/// The rows `serve` keeps, oldest first.
#[derive(Default)]
pub(crate) struct SyncLogRows {
    rows: VecDeque<Row>,
    /// Each row's id by its load and its number there.
    ids: BTreeMap<(u64, u32), u64>,
    next: u64,
    /// The newest load a step came from.
    newest: Option<u64>,
    /// The Run `serve` last sent.
    ran: Option<Ran>,
    /// The rows that changed since the view last heard, by id.
    changed: BTreeSet<u64>,
    /// Whether the rows were cleared since the view last heard.
    cleared: bool,
}

/// A Run `serve` sent: its entry, when, and until when a local change of the entry gets the note.
struct Ran {
    entry: String,
    sent: Instant,
    until: Instant,
}

struct Row {
    id: u64,
    load: u64,
    row: u32,
    entry: String,
    /// When its first step reached `serve`, in ms since the Unix epoch, which the view shows as
    /// the time of day, since a step's own time is the PC's counter.
    time: u64,
    from: Option<Source>,
    /// Each step with its time on the PC's counter, in µs.
    steps: Vec<(u64, Step)>,
    notes: Vec<Note>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Note {
    /// The author ran the entry this long before the row began. It says when, not that the Run
    /// caused the change, so the row stays the engine's decision.
    Ran { ms: u64 },
    /// The profile unloaded before the row's write finished, and the engine that would have
    /// finished it is gone.
    Unloaded,
}

/// What the view hears: the rows that changed, whole, and the id of the oldest row `serve` still
/// keeps, so the view drops every row before it, all of them after a Clear.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Update {
    pub(crate) rows: Vec<RowView>,
    pub(crate) first: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct RowView {
    pub(crate) id: u64,
    /// ms since the Unix epoch.
    pub(crate) time: u64,
    /// The entry's key, which the view shows, since an author knows an entry by the key they
    /// wrote (user, 2026-11-25).
    pub(crate) entry: String,
    pub(crate) cause: Cause,
    /// The value the cause brings, as a box shows a value.
    pub(crate) value: Option<String>,
    /// The latest step's word, which is the row's verdict.
    pub(crate) verdict: &'static str,
    /// Whether the row waits on more of the engine, which the view marks as under way, so the
    /// view never decides it from the words. A row of a load that unloaded waits on nothing.
    pub(crate) open: bool,
    pub(crate) steps: Vec<StepView>,
    pub(crate) notes: Vec<Note>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Cause {
    LocalChange,
    /// A crewmate's change, by name, or a playback's.
    Arrived {
        from: Option<String>,
        playback: bool,
    },
    CatchUp {
        from: Option<String>,
        playback: bool,
    },
    ControlPassed,
}

/// One step: its time from the row's first, in ms, its word, and what it carries.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct StepView {
    pub(crate) ms: u64,
    pub(crate) word: &'static str,
    /// A value, the actions written, or an error's words.
    pub(crate) detail: Option<String>,
    /// A second word of the engine's the step carries, as `landed` on a read back.
    pub(crate) also: Option<&'static str>,
    /// The keys of the entries the step names, as the ones a write waits for, each a link to
    /// its line.
    pub(crate) links: Vec<String>,
}

impl SyncLogRows {
    /// The steps of one engine call, as state sync sent them, which reached `serve` at `now` and
    /// `wall`, in ms since the Unix epoch.
    pub(crate) fn heard(&mut self, log: SyncLog, now: Instant, wall: u64) {
        // Each load's stamp is the core's counter as it loaded, so a newer load's is larger.
        if self.newest.is_none_or(|n| log.load > n) {
            if self.newest.is_some() {
                self.unloaded(log.load);
            }
            self.newest = Some(log.load);
        }
        for step in log.steps {
            let key = (log.load, step.row);
            if let Some(&id) = self.ids.get(&key) {
                if let Some(row) = self.row_mut(id) {
                    row.steps.push((step.at, step.step));
                    self.changed.insert(id);
                }
                continue;
            }
            // A step for a row that began before the extension connected joins nothing.
            if !starts(&step.step) {
                continue;
            }
            let from = match step.step {
                Step::Arrived { .. } | Step::CaughtUp { .. } => log.from.clone(),
                _ => None,
            };
            let mut notes = Vec::new();
            if matches!(step.step, Step::LocalChange { .. })
                && let Some(ran) = self.ran.as_ref()
                && ran.entry == step.entry
                && now <= ran.until
            {
                let ms = now.saturating_duration_since(ran.sent).as_millis();
                notes.push(Note::Ran {
                    ms: u64::try_from(ms).unwrap_or(u64::MAX),
                });
            }
            let id = self.next;
            self.next += 1;
            self.ids.insert(key, id);
            self.changed.insert(id);
            self.rows.push_back(Row {
                id,
                load: log.load,
                row: step.row,
                entry: step.entry,
                time: wall,
                from,
                steps: vec![(step.at, step.step)],
                notes,
            });
            if self.rows.len() > KEPT
                && let Some(old) = self.rows.pop_front()
            {
                self.ids.remove(&(old.load, old.row));
                self.changed.remove(&old.id);
            }
        }
    }

    /// Notes each row of an older load whose write was still pending or waiting, since the
    /// engine that would have finished it went with the load.
    fn unloaded(&mut self, newer: u64) {
        for row in self.rows.iter_mut().filter(|r| r.load < newer) {
            if open(row) && !row.notes.contains(&Note::Unloaded) {
                row.notes.push(Note::Unloaded);
                self.changed.insert(row.id);
            }
        }
    }

    /// A Run `serve` sent for `entry` at `now`, whose plan its preview showed, so a local change
    /// of the entry while the Run runs, or within the engine's check after its last action, gets
    /// the note.
    pub(crate) fn ran(&mut self, entry: &str, now: Instant, preview: Option<&Preview>) {
        let takes = match preview {
            Some(Preview::Sends { actions }) => lasts(actions),
            _ => Duration::ZERO,
        };
        self.ran = Some(Ran {
            entry: entry.to_string(),
            sent: now,
            until: now + takes + CHECK,
        });
    }

    pub(crate) fn clear(&mut self) {
        self.rows.clear();
        self.ids.clear();
        self.changed.clear();
        self.cleared = true;
    }

    /// What the view hasn't heard, if anything.
    pub(crate) fn update(&mut self) -> Option<Update> {
        if self.changed.is_empty() && !self.cleared {
            return None;
        }
        self.cleared = false;
        let changed = std::mem::take(&mut self.changed);
        let rows = changed
            .iter()
            .filter_map(|&id| self.row(id))
            .map(view)
            .collect();
        let first = self.rows.front().map_or(self.next, |r| r.id);
        Some(Update { rows, first })
    }

    fn row(&self, id: u64) -> Option<&Row> {
        // Ids rise with the rows, so the row's place is its id less the first's.
        let first = self.rows.front()?.id;
        self.rows.get(usize::try_from(id.checked_sub(first)?).ok()?)
    }

    fn row_mut(&mut self, id: u64) -> Option<&mut Row> {
        // Ids rise with the rows, so the row's place is its id less the first's.
        let first = self.rows.front()?.id;
        let place = usize::try_from(id.checked_sub(first)?).ok()?;
        self.rows.get_mut(place)
    }
}

/// Whether a step is a row's cause, which starts it.
fn starts(step: &Step) -> bool {
    matches!(
        step,
        Step::LocalChange { .. }
            | Step::Arrived { .. }
            | Step::CaughtUp { .. }
            | Step::ControlPassed { .. }
    )
}

/// Whether a row whose latest step is `step` waits on more of the engine: a value pending, a
/// write waiting, a stepping write still stepping or reading back, a value to compare, or a change
/// the stream hasn't sent. A write a crew member's value or a catch-up started is checked, so its
/// `writes` waits on what follows, where a put-back's and control passing's are done. A stop ends
/// every row it cuts off, and a checked write the cockpit already reads ends `already matches`,
/// so no row waits on a step the engine won't take.
fn open(row: &Row) -> bool {
    let checked = matches!(
        row.steps.first().map(|(_, s)| s),
        Some(Step::Arrived { .. } | Step::CaughtUp { .. })
    );
    row.steps.last().is_some_and(|(_, step)| {
        matches!(
            step,
            Step::LocalChange { .. }
                | Step::AwaitingReading
                | Step::FirstReading { .. }
                | Step::WaitsFor { .. }
                | Step::NowReads { .. }
                | Step::Pending { .. }
                | Step::ReadBack { landed: false, .. }
                | Step::Compared
        ) || (checked && matches!(step, Step::Writes { .. }))
    })
}

/// How long a Run's plan takes from its first action to its last: each action after a chain's
/// first, its pace apart.
fn lasts(actions: &[Planned]) -> Duration {
    actions
        .iter()
        .map(|a| {
            pace(&a.every)
                .saturating_mul(u32::try_from(a.times.saturating_sub(1)).unwrap_or(u32::MAX))
        })
        .sum()
}

/// A pace as the plan writes it, such as `1 frame`, `2 frames`, or `50ms`, which the profile
/// engine's `Pace` reads and writes.
fn pace(every: &str) -> Duration {
    match profile_engine::Pace::parse(every) {
        Some(profile_engine::Pace::Ms(ms)) => Duration::from_millis(u64::from(ms)),
        Some(profile_engine::Pace::Frames(n)) => FRAME.saturating_mul(n),
        None => FRAME,
    }
}

fn value(v: &Value) -> String {
    match v {
        Value::Number(n) => number(*n),
        Value::Text(t) => t.clone(),
    }
}

fn view(row: &Row) -> RowView {
    let first = row.steps.first().map_or(0, |(at, _)| *at);
    let (cause, carried) = match row.steps.first().map(|(_, s)| s) {
        Some(Step::Arrived { value: v }) => (
            source(
                Cause::Arrived {
                    from: None,
                    playback: false,
                },
                row.from.as_ref(),
            ),
            v.as_ref().map(value),
        ),
        Some(Step::CaughtUp { value: v }) => (
            source(
                Cause::CatchUp {
                    from: None,
                    playback: false,
                },
                row.from.as_ref(),
            ),
            Some(value(v)),
        ),
        Some(Step::ControlPassed { value: v }) => (Cause::ControlPassed, Some(value(v))),
        Some(Step::LocalChange { value: v }) => (Cause::LocalChange, v.as_ref().map(value)),
        _ => (Cause::LocalChange, None),
    };
    RowView {
        id: row.id,
        time: row.time,
        entry: row.entry.clone(),
        cause,
        value: carried,
        verdict: row.steps.last().map_or("local-change", |(_, s)| verdict(s)),
        open: open(row) && !row.notes.contains(&Note::Unloaded),
        steps: row
            .steps
            .iter()
            .map(|(at, s)| {
                let shown = said(s);
                StepView {
                    ms: at.saturating_sub(first) / 1_000,
                    word: shown.word,
                    detail: shown.detail,
                    also: shown.also,
                    links: shown.links,
                }
            })
            .collect(),
        notes: row.notes.clone(),
    }
}

fn source(cause: Cause, from: Option<&Source>) -> Cause {
    let (from, playback) = match from {
        Some(Source::Member(name)) => (Some(name.clone()), false),
        Some(Source::Playback) => (None, true),
        None => (None, false),
    };
    match cause {
        Cause::Arrived { .. } => Cause::Arrived { from, playback },
        Cause::CatchUp { .. } => Cause::CatchUp { from, playback },
        other => other,
    }
}

/// A row's verdict: its latest step's word, as `landed` for the read back of its last value.
fn verdict(step: &Step) -> &'static str {
    match step {
        Step::ReadBack { landed: true, .. } => "landed",
        other => said(other).word,
    }
}

/// A step as the view shows it.
struct Shown {
    word: &'static str,
    detail: Option<String>,
    also: Option<&'static str>,
    links: Vec<String>,
}

fn said(step: &Step) -> Shown {
    let word = |word| Shown {
        word,
        detail: None,
        also: None,
        links: Vec::new(),
    };
    let with = |word, detail: Option<String>| Shown {
        word,
        detail,
        also: None,
        links: Vec::new(),
    };
    match step {
        Step::LocalChange { value: v } => with("local-change", v.as_ref().map(value)),
        Step::Arrived { value: v } => with("arrived", v.as_ref().map(value)),
        Step::CaughtUp { value: v } => with("catch-up", Some(value(v))),
        Step::ControlPassed { value: v } => with("control-passed", Some(value(v))),
        Step::Sent => word("sent"),
        Step::Replaced => word("replaced"),
        Step::Withdrawn { why } => Shown {
            also: Some(match why {
                Withdrawal::Lost => "lost",
                Withdrawal::Undone => "undone",
            }),
            ..word("withdrawn")
        },
        Step::NotSentDuringPreflight => word("not-sent-during-preflight"),
        Step::PutBack { value: v } => with("put-back", Some(value(v))),
        Step::PutBackCarriesOn => word("put-back-carries-on"),
        Step::MatchesSyncedValue => word("matches-synced-value"),
        Step::NotSent => word("not-sent"),
        Step::TooLarge { bytes } => with("too-large", Some(format!("{bytes} bytes"))),
        Step::Stopped { why } => match why {
            Stopping::Driven => Shown {
                also: Some("driven"),
                ..word("stopped")
            },
            Stopping::Limit { error } | Stopping::Compile { error } => {
                with("stopped", Some(error.clone()))
            }
        },
        Step::ReportedTwice => word("reported-twice"),
        Step::Ignored { event } => with("ignored", Some(event.clone())),
        Step::Lost => word("lost"),
        Step::Won => word("won"),
        Step::Compared => word("compared"),
        Step::Matches => word("matches"),
        Step::Differs { reading } => with("differs", reading.as_ref().map(value)),
        Step::AwaitingReading => word("waits-for-first-reading"),
        Step::FirstReading { value: v } => with("first-reading", Some(value(v))),
        Step::WaitsFor { ahead } => Shown {
            detail: Some(ahead.join(", ")),
            links: ahead.clone(),
            ..word("waits-for")
        },
        Step::NowReads { value: v } => with("now-reads", Some(value(v))),
        Step::AlreadyMatches => word("already-matches"),
        Step::Writes { actions } => {
            let written: Vec<String> = actions
                .iter()
                .map(|a| {
                    let values: Vec<String> = a.values.iter().map(value).collect();
                    match values.is_empty() {
                        true => a.name.clone(),
                        false => format!("{} {}", a.name, values.join(" ")),
                    }
                })
                .collect();
            // A write function's run that wrote nothing carries no actions.
            with("writes", (!written.is_empty()).then(|| written.join(", ")))
        }
        Step::FunctionFailed { error } => with("function-failed", Some(error.clone())),
        Step::Pending { value: v } => with("pending", Some(value(v))),
        Step::ReadBack { value: v, landed } => Shown {
            also: landed.then_some("landed"),
            ..with("read-back", Some(value(v)))
        },
        Step::NeverLanded { reading } => with("never-landed", reading.as_ref().map(value)),
        Step::WarningSkipped => word("warning-skipped"),
        Step::TokenUsed => word("token-used"),
        Step::TokenExpired => word("token-expired"),
        Step::IgnoreExpired { event } => with("ignore-expired", Some(event.clone())),
        Step::NoValue => word("no-value"),
        Step::DroppedRefused => word("dropped-refused"),
        Step::ShadowRestored { value: v } => with("shadow-restored", Some(value(v))),
        Step::SkippedStopped => word("skipped-stopped"),
    }
}

#[cfg(test)]
mod tests {
    use messages::state_sync::{Source, SyncLog};
    use messages::sync::{LogStep, Step, Value};

    use super::*;

    const LOAD: u64 = 1_000;

    fn step(row: u32, at: u64, entry: &str, step: Step) -> LogStep {
        LogStep {
            row,
            at,
            entry: entry.into(),
            step,
        }
    }

    fn log(load: u64, from: Option<Source>, steps: Vec<LogStep>) -> SyncLog {
        SyncLog { load, from, steps }
    }

    fn local(row: u32, entry: &str, n: f64) -> LogStep {
        step(
            row,
            0,
            entry,
            Step::LocalChange {
                value: Some(Value::Number(n)),
            },
        )
    }

    #[test]
    fn a_row_gathers_its_steps_and_its_verdict_is_its_latest_word() {
        let mut rows = SyncLogRows::default();
        let now = Instant::now();
        let arrived = Step::Arrived {
            value: Some(Value::Number(1.0)),
        };
        let pending = Step::Pending {
            value: Value::Number(1.0),
        };
        let from = Some(Source::Member("Ana".into()));
        rows.heard(
            log(
                LOAD,
                from,
                vec![
                    step(1, 0, "battery", arrived),
                    step(1, 0, "battery", pending),
                ],
            ),
            now,
            7,
        );
        let read_back = Step::ReadBack {
            value: Value::Number(1.0),
            landed: true,
        };
        rows.heard(
            log(LOAD, None, vec![step(1, 84_000, "battery", read_back)]),
            now,
            8,
        );
        let update = rows.update().expect("an update");
        let row = &update.rows[0];
        assert_eq!(row.verdict, "landed");
        assert_eq!(row.time, 7, "a row's time is its first step's");
        assert_eq!(
            row.cause,
            Cause::Arrived {
                from: Some("Ana".into()),
                playback: false
            }
        );
        assert_eq!(
            row.steps.last().map(|s| (s.ms, s.also)),
            Some((84, Some("landed")))
        );
        assert!(rows.update().is_none(), "nothing new");
    }

    #[test]
    fn the_10001st_row_drops_the_first_and_clear_empties_them_all() {
        let mut rows = SyncLogRows::default();
        let now = Instant::now();
        let steps = (1..=10_001)
            .map(|n| local(n, "lever", f64::from(n)))
            .collect();
        rows.heard(log(LOAD, None, steps), now, 0);
        let update = rows.update().expect("an update");
        assert_eq!(update.rows.len(), KEPT);
        assert_eq!(update.first, 1, "the first row, id 0, dropped");
        rows.clear();
        let update = rows.update().expect("the clear");
        assert!(update.rows.is_empty());
        assert_eq!(update.first, 10_001, "every row before the next id drops");
    }

    #[test]
    fn a_row_is_open_while_it_waits_on_the_engine_and_a_put_backs_write_waits_on_nothing() {
        let mut rows = SyncLogRows::default();
        let writes = || Step::Writes {
            actions: Vec::new(),
        };
        let arrived = Step::Arrived {
            value: Some(Value::Number(1.0)),
        };
        let put_back = Step::PutBack {
            value: Value::Number(0.8),
        };
        rows.heard(
            log(
                LOAD,
                None,
                vec![
                    step(1, 0, "battery", arrived),
                    step(1, 0, "battery", writes()),
                    local(2, "throttle", 0.5),
                    step(2, 0, "throttle", put_back),
                    step(2, 0, "throttle", writes()),
                    local(3, "beacon", 1.0),
                ],
            ),
            Instant::now(),
            0,
        );
        let open: Vec<(String, bool)> = rows
            .update()
            .expect("an update")
            .rows
            .into_iter()
            .map(|r| (r.entry, r.open))
            .collect();
        assert_eq!(
            open,
            vec![
                ("battery".into(), true),
                ("throttle".into(), false),
                ("beacon".into(), true),
            ],
            "an arrival's write waits on its check, a put-back's is unchecked, and a local change waits to be sent"
        );
    }

    #[test]
    fn a_step_for_a_row_never_seen_to_begin_drops() {
        let mut rows = SyncLogRows::default();
        let pending = Step::Pending {
            value: Value::Number(1.0),
        };
        rows.heard(
            log(LOAD, None, vec![step(4, 0, "battery", pending)]),
            Instant::now(),
            0,
        );
        assert!(rows.update().is_none());
    }

    #[test]
    fn a_local_change_during_a_run_or_within_the_check_after_it_gets_the_note() {
        let mut rows = SyncLogRows::default();
        let sent = Instant::now();
        let plan = Preview::Sends {
            actions: vec![Planned {
                action: messages::authoring::Action::Fire {
                    name: "K('CRS_INC')".into(),
                },
                times: 31,
                every: "1 frame".into(),
            }],
        };
        rows.ran("course", sent, Some(&plan));
        // A stepping Run of 31 steps takes 1s at 30 frames a second, so its rows get the note
        // until 2.5s after it was sent.
        rows.heard(
            log(LOAD, None, vec![local(1, "course", 91.0)]),
            sent + Duration::from_millis(40),
            0,
        );
        rows.heard(
            log(LOAD, None, vec![local(2, "course", 120.0)]),
            sent + Duration::from_millis(2_400),
            0,
        );
        rows.heard(
            log(LOAD, None, vec![local(3, "course", 121.0)]),
            sent + Duration::from_millis(2_600),
            0,
        );
        rows.heard(
            log(LOAD, None, vec![local(4, "battery", 1.0)]),
            sent + Duration::from_millis(50),
            0,
        );
        let notes: Vec<Vec<Note>> = rows
            .update()
            .expect("an update")
            .rows
            .into_iter()
            .map(|r| r.notes)
            .collect();
        assert_eq!(
            notes,
            vec![
                vec![Note::Ran { ms: 40 }],
                vec![Note::Ran { ms: 2_400 }],
                vec![],
                vec![],
            ]
        );
    }

    #[test]
    fn a_newer_loads_step_notes_each_older_row_still_pending() {
        let mut rows = SyncLogRows::default();
        let now = Instant::now();
        let arrived = Step::Arrived {
            value: Some(Value::Number(1.0)),
        };
        let pending = Step::Pending {
            value: Value::Number(1.0),
        };
        rows.heard(
            log(
                LOAD,
                None,
                vec![
                    step(1, 0, "battery", arrived),
                    step(1, 0, "battery", pending),
                ],
            ),
            now,
            0,
        );
        rows.heard(
            log(
                LOAD,
                None,
                vec![local(2, "beacon", 1.0), step(2, 0, "beacon", Step::Sent)],
            ),
            now,
            0,
        );
        rows.update();
        rows.heard(log(LOAD + 1, None, vec![local(1, "beacon", 0.0)]), now, 0);
        let update = rows.update().expect("an update");
        assert!(
            !update.rows[0].open,
            "a row whose load unloaded waits on nothing"
        );
        let notes: Vec<(String, Vec<Note>)> = update
            .rows
            .into_iter()
            .map(|r| (r.entry, r.notes))
            .collect();
        assert_eq!(
            notes,
            vec![
                ("battery".into(), vec![Note::Unloaded]),
                ("beacon".into(), vec![]),
            ],
            "the sent row is done, and the new load's row has no note"
        );
    }
}
