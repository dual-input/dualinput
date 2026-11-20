//! The kernel at work: handling one input, the moments, calls, and requests it sets off,
//! and what a handler sees and does through `Cx`.

use std::any::{Any, TypeId};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, VecDeque};
use std::time::Duration;

use chacha20::ChaCha20Rng;
use chacha20::rand_core::{Rng, SeedableRng};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::edge::{
    CancelTimer, FIRST, First, Handle, Input, JOBS, Job, JobId, SetTimer, SourceId, StartJob,
    TIMERS, TimerId,
};
use crate::registry::{Handler, Registered, Registry, Request, UnitId, downcast_mut};
use crate::{Moment, Started};

/// More moments, calls, and requests than this for one input is a cycle, such as two units
/// raising moments that each handle by raising the other's, and a cycle is a bug, so the
/// kernel panics rather than run forever.
const MOST_PENDING: u32 = 1_000;

thread_local! {
    static RUNNING: Cell<Option<&'static str>> = const { Cell::new(None) };
}

/// The unit whose handler is running on this thread, if one is. The core's panic hook logs
/// it, and it stays set when a handler panics.
pub fn running_unit() -> Option<&'static str> {
    RUNNING.with(Cell::get)
}

/// Every unit's state and what each registered, and the call that handles one input.
pub struct Kernel {
    states: Vec<Option<Box<dyn Any>>>,
    table: Registry,
    work: Work,
    /// Each request's verdict as of the last input, which handlers and slices read, and only
    /// `refresh_verdicts` changes, between inputs.
    verdicts: Vec<Option<Verdict>>,
}

/// What handlers change through `Cx`, apart from their own state.
struct Work {
    /// The stamp of the input being handled.
    stamp: u64,
    outputs: Vec<Output>,
    pending: VecDeque<Pending>,
    /// The moments and calls queued for the input being handled.
    queued: u32,
    /// The number of the next handle.
    next: u64,
    /// The generator of random IDs, which the first input seeds.
    rng: Option<ChaCha20Rng>,
    timers: BTreeMap<Handle, TimerFn>,
    jobs: BTreeMap<Handle, JobFn>,
    /// The running hash of every output.
    hash: Sha256,
    started: bool,
}

type TimerFn = Box<dyn FnOnce(&mut dyn Any, TimerId, &mut Cx)>;
type JobFn = Box<dyn FnOnce(&mut dyn Any, JobId, Result<Vec<u8>, String>, &mut Cx)>;
type CallFn = Box<dyn FnOnce(&mut dyn Any, &mut Cx)>;

enum Pending {
    Moment(TypeId, Box<dyn Any>),
    Call(u32, CallFn),
    Ask(usize, Box<dyn Any>),
}

impl Kernel {
    pub fn new(mut registry: Registry) -> Kernel {
        let states = std::mem::take(&mut registry.states);
        let verdicts = registry.requests.iter().map(|_| None).collect();
        Kernel {
            states,
            table: registry,
            work: Work {
                stamp: 0,
                outputs: Vec::new(),
                pending: VecDeque::new(),
                queued: 0,
                next: 0,
                rng: None,
                timers: BTreeMap::new(),
                jobs: BTreeMap::new(),
                hash: Sha256::new(),
                started: false,
            },
            verdicts,
        }
    }

    /// The number of the source `K` names, for the edge to push its inputs under.
    pub fn source<K: 'static>(&self) -> Option<SourceId> {
        self.table.source_keys.get(&TypeId::of::<K>()).copied()
    }

    /// The files the units asked for at the core's start, for the edge to read into the
    /// first input, each named once.
    pub fn start_files(&self) -> Vec<&'static str> {
        let mut names = Vec::new();
        for file in &self.table.start_files {
            if !names.contains(&file.name) {
                names.push(file.name);
            }
        }
        names
    }

    /// Each unit's name, by its place in the registry, so the bench can name a unit whose
    /// sim connection it acts on.
    pub fn units(&self) -> Vec<&'static str> {
        self.table.units.iter().map(|u| u.name).collect()
    }

    /// The first 8 bytes of the SHA-256 of everything the units have put out so far, which
    /// the recording's checkpoints hold.
    pub fn hash(&self) -> u64 {
        let digest = self.work.hash.clone().finalize();
        u64::from_be_bytes(digest[..8].try_into().expect("a SHA-256 has 32 bytes"))
    }

    /// Handles one input: its own handler, then every moment, call, and request it set off,
    /// in the order they were queued, then each request's verdict again. Returns the outputs
    /// in the order the handlers put them out.
    pub fn handle(&mut self, input: &Input) -> Vec<Output> {
        assert!(
            self.work.started || input.source == FIRST,
            "input {} came from source {} before the core's first input",
            input.seq,
            input.source.0
        );
        self.work.stamp = input.stamp;
        self.work.queued = 0;
        match input.source {
            FIRST => self.first(input),
            TIMERS => self.fired(input),
            JOBS => self.finished(input),
            source => {
                let Some(Some(handler)) = self.table.sources.get(source.0 as usize) else {
                    panic!(
                        "input {} came from source {}, which no unit registered",
                        input.seq, source.0
                    )
                };
                run(
                    &mut self.states,
                    &self.table,
                    &mut self.work,
                    &self.verdicts,
                    handler.unit,
                    |state, cx| (handler.f)(state, input, cx),
                );
            }
        }
        self.drain();
        self.refresh_verdicts();
        std::mem::take(&mut self.work.outputs)
    }

    fn first(&mut self, input: &Input) {
        assert!(
            !self.work.started,
            "the core's first input should come once"
        );
        let first: First =
            postcard::from_bytes(&input.bytes).expect("the first input should decode");
        self.work.rng = Some(ChaCha20Rng::from_seed(first.seed));
        self.work.started = true;
        for file in &self.table.start_files {
            let bytes = first
                .files
                .iter()
                .find(|(name, _)| name == file.name)
                .and_then(|(_, b)| b.as_deref());
            run(
                &mut self.states,
                &self.table,
                &mut self.work,
                &self.verdicts,
                file.unit,
                |state, cx| (file.f)(state, bytes, cx),
            );
        }
        self.work
            .pending
            .push_back(Pending::Moment(TypeId::of::<Started>(), Box::new(Started)));
    }

    fn fired(&mut self, input: &Input) {
        let handle: Handle =
            postcard::from_bytes(&input.bytes).expect("a timer's input should decode");
        match self.work.timers.remove(&handle) {
            Some(f) => run(
                &mut self.states,
                &self.table,
                &mut self.work,
                &self.verdicts,
                handle.unit,
                |state, cx| f(state, TimerId(handle), cx),
            ),
            None => tracing::trace!(?handle, "a timer canceled after it fired was dropped"),
        }
    }

    fn finished(&mut self, input: &Input) {
        // Borrowed, then copied whole, since decoding into a `Vec<u8>` takes it a byte at a time,
        // and avatars' model is tens of megabytes. Postcard writes the two the same way.
        let (handle, result): (Handle, Result<&[u8], String>) =
            postcard::from_bytes(&input.bytes).expect("a job's input should decode");
        let result = result.map(<[u8]>::to_vec);
        match self.work.jobs.remove(&handle) {
            Some(f) => run(
                &mut self.states,
                &self.table,
                &mut self.work,
                &self.verdicts,
                handle.unit,
                |state, cx| f(state, JobId(handle), result, cx),
            ),
            None => tracing::trace!(?handle, "a job canceled after it ended was dropped"),
        }
    }

    fn drain(&mut self) {
        while let Some(pending) = self.work.pending.pop_front() {
            match pending {
                Pending::Moment(type_id, moment) => {
                    let Some(handlers) = self.table.moments.get(&type_id) else {
                        continue;
                    };
                    for handler in handlers {
                        run(
                            &mut self.states,
                            &self.table,
                            &mut self.work,
                            &self.verdicts,
                            handler.unit,
                            |state, cx| (handler.f)(state, &*moment, cx),
                        );
                    }
                }
                Pending::Call(unit, f) => run(
                    &mut self.states,
                    &self.table,
                    &mut self.work,
                    &self.verdicts,
                    unit,
                    f,
                ),
                Pending::Ask(index, request) => {
                    let entry = &self.table.requests[index];
                    match judge(&self.states, &self.table, &self.verdicts, entry, &*request) {
                        Verdict::Allowed => run(
                            &mut self.states,
                            &self.table,
                            &mut self.work,
                            &self.verdicts,
                            entry.decider,
                            |state, cx| (entry.decide)(state, request, cx),
                        ),
                        Verdict::Denied(reasons) => {
                            tracing::debug!(?reasons, "a request was refused")
                        }
                    }
                }
            }
        }
    }

    /// Builds each request as this pilot would make it now, and runs its guards on it, so
    /// the apps can say why not before the pilot asks.
    fn refresh_verdicts(&mut self) {
        let view = View {
            states: &self.states,
            table: &self.table,
            verdicts: &self.verdicts,
        };
        let verdicts = self
            .table
            .requests
            .iter()
            .map(|entry| {
                let decider = slot(&self.states, &self.table, entry.decider);
                let request = as_unit(&self.table, entry.decider, || (entry.build)(decider, &view));
                request.map(|request| {
                    judge(&self.states, &self.table, &self.verdicts, entry, &*request)
                })
            })
            .collect();
        self.verdicts = verdicts;
    }
}

/// Runs `f` on one unit's state, with the unit's state taken out of its slot, so `f` holds
/// the only `&mut` to it while every other unit's stays readable.
fn run(
    states: &mut [Option<Box<dyn Any>>],
    table: &Registry,
    work: &mut Work,
    verdicts: &[Option<Verdict>],
    unit: u32,
    f: impl FnOnce(&mut dyn Any, &mut Cx),
) {
    let mut state = states[unit as usize]
        .take()
        .expect("one handler of a unit should run at a time");
    let previous = RUNNING.replace(Some(table.units[unit as usize].name));
    f(
        &mut *state,
        &mut Cx {
            states,
            table,
            work: RefCell::new(work),
            verdicts,
            unit,
        },
    );
    RUNNING.set(previous);
    states[unit as usize] = Some(state);
}

/// Runs `f`, a unit's guard or builder, with that unit named as running, so its log lines
/// and a panic in it name the unit.
fn as_unit<R>(table: &Registry, unit: u32, f: impl FnOnce() -> R) -> R {
    let previous = RUNNING.replace(Some(table.units[unit as usize].name));
    let result = f();
    RUNNING.set(previous);
    result
}

fn judge(
    states: &[Option<Box<dyn Any>>],
    table: &Registry,
    verdicts: &[Option<Verdict>],
    entry: &Request,
    request: &dyn Any,
) -> Verdict {
    let view = View {
        states,
        table,
        verdicts,
    };
    let reasons: Vec<String> = entry
        .guards
        .iter()
        .filter_map(|guard: &Registered<_>| {
            as_unit(table, guard.unit, || {
                (guard.f)(slot(states, table, guard.unit), request, &view).err()
            })
        })
        .collect();
    if reasons.is_empty() {
        Verdict::Allowed
    } else {
        Verdict::Denied(reasons)
    }
}

fn slot<'s>(states: &'s [Option<Box<dyn Any>>], table: &Registry, unit: u32) -> &'s dyn Any {
    match &states[unit as usize] {
        Some(state) => &**state,
        None => panic!(
            "unit {} read its own state through the kernel, but its handler already holds it",
            table.units[unit as usize].name
        ),
    }
}

fn read<'s, T: 'static>(states: &'s [Option<Box<dyn Any>>], table: &Registry) -> &'s T {
    slot(states, table, table.unit_of::<T>())
        .downcast_ref()
        .expect("a unit's state should be its own type")
}

/// Whether a request was allowed, or each guard's reason for refusing it, in the order the
/// guards registered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    Allowed,
    Denied(Vec<String>),
}

/// Every unit's state, read-only, for a guard, for building a request, and for a slice of
/// client state, with each request's verdict as of the last input.
pub struct View<'k> {
    states: &'k [Option<Box<dyn Any>>],
    table: &'k Registry,
    verdicts: &'k [Option<Verdict>],
}

impl View<'_> {
    pub fn read<T: 'static>(&self) -> &T {
        read(self.states, self.table)
    }

    /// The verdict on the request `R` that this pilot would make now, as of the last input,
    /// or `None` when they couldn't make one at all, which a slice shows so the apps say why
    /// not before the pilot asks.
    pub fn verdict<R: 'static>(&self) -> Option<Verdict> {
        verdict::<R>(self.table, self.verdicts)
    }
}

fn verdict<R: 'static>(table: &Registry, verdicts: &[Option<Verdict>]) -> Option<Verdict> {
    let index = *table
        .request_by_type
        .get(&TypeId::of::<R>())
        .unwrap_or_else(|| {
            panic!(
                "request {} should be declared by a unit",
                std::any::type_name::<R>()
            )
        });
    verdicts[index].clone()
}

/// An output a unit put out, for the edge to hand to the sink it registered for the
/// output's type.
pub struct Output {
    unit: UnitId,
    unit_name: &'static str,
    type_name: &'static str,
    value: Box<dyn Any + Send>,
}

impl Output {
    pub fn unit(&self) -> UnitId {
        self.unit
    }

    pub fn unit_name(&self) -> &'static str {
        self.unit_name
    }

    pub fn type_name(&self) -> &'static str {
        self.type_name
    }

    pub fn value_type(&self) -> TypeId {
        (*self.value).type_id()
    }

    pub fn into_value(self) -> Box<dyn Any + Send> {
        self.value
    }
}

/// What a handler does everything through, besides changing its own state.
pub struct Cx<'k> {
    states: &'k [Option<Box<dyn Any>>],
    table: &'k Registry,
    work: RefCell<&'k mut Work>,
    verdicts: &'k [Option<Verdict>],
    /// The unit whose handler is running.
    unit: u32,
}

impl Cx<'_> {
    /// The input's stamp, in µs on the PC's performance counter, which is the only time a
    /// handler has.
    pub fn now(&self) -> u64 {
        self.work.borrow().stamp
    }

    /// The unit whose handler is running.
    pub fn unit(&self) -> UnitId {
        UnitId(self.unit)
    }

    /// Another unit's state, read-only. A handler that reads its own through here panics,
    /// since it already holds it.
    pub fn read<T: 'static>(&self) -> &T {
        read(self.states, self.table)
    }

    /// Every other unit's state, read-only, for a function another unit registered, as the
    /// clients crate builds a feature's slice of client state.
    pub fn view(&self) -> View<'_> {
        View {
            states: self.states,
            table: self.table,
            verdicts: self.verdicts,
        }
    }

    /// Puts out `output`, for the edge to carry out once the input and everything it set
    /// off are handled. The output also goes into the running hash, by its postcard
    /// encoding. A `HashMap` or `HashSet` encodes its entries in an order seeded at random
    /// each run, so a replay would part from its run with no bug to find, and an output type
    /// holds a `BTreeMap`, a `BTreeSet`, or a `Vec` instead.
    pub fn out<O: Serialize + Send + 'static>(&self, output: O) {
        let bytes = postcard::to_stdvec(&output).expect("an output should encode with postcard");
        let mut work = self.work.borrow_mut();
        work.hash.update(self.unit.to_le_bytes());
        work.hash.update((bytes.len() as u64).to_le_bytes());
        work.hash.update(&bytes);
        work.outputs.push(Output {
            unit: UnitId(self.unit),
            unit_name: self.table.units[self.unit as usize].name,
            type_name: std::any::type_name::<O>(),
            value: Box::new(output),
        });
    }

    /// Raises a moment, which every unit that registered for it handles, in the order they
    /// registered, after the moments and calls already queued and before the next input.
    pub fn raise<M: Moment>(&self, moment: M) {
        self.queue(Pending::Moment(TypeId::of::<M>(), Box::new(moment)));
    }

    /// Has the kernel call `f` on the state of the unit that holds a `T`, once this handler
    /// has returned, so `f` can read this unit's state too. A crate lower in the platform
    /// offers its callers a function that does this, as the clients crate offers the
    /// session crate its goodbye to the clients.
    pub fn call<T: 'static, A: 'static>(&self, f: fn(&mut T, A, &mut Cx), arg: A) {
        let unit = self.table.unit_of::<T>();
        self.queue(Pending::Call(
            unit,
            Box::new(move |state, cx| f(downcast_mut(state), arg, cx)),
        ));
    }

    /// Has the kernel call a handler another unit registered, once this handler has
    /// returned, as the clients crate calls a feature's command.
    pub fn call_handler<A: 'static>(&self, handler: &Handler<A>, arg: A) {
        let f = handler.f.clone();
        self.queue(Pending::Call(
            handler.unit,
            Box::new(move |state, cx| f(state, arg, cx)),
        ));
    }

    /// Asks for a request a crate of the platform's decides: once this handler has
    /// returned, the request's guards run, and if none refuses it, its crate decides it.
    pub fn ask<R: 'static>(&self, request: R) {
        let index = self.request::<R>();
        self.queue(Pending::Ask(index, Box::new(request)));
    }

    /// The verdict on the request `R` that this pilot would make now, as of the last input,
    /// or `None` when they couldn't make one at all.
    pub fn verdict<R: 'static>(&self) -> Option<Verdict> {
        verdict::<R>(self.table, self.verdicts)
    }

    /// Sets a timer that fires `after` this input's stamp, as an input of its own, which
    /// calls `f`. `f` is a handler of the running unit's.
    pub fn timer<S: 'static>(&self, after: Duration, f: fn(&mut S, TimerId, &mut Cx)) -> TimerId {
        self.own::<S>("sets a timer");
        let id = TimerId(self.handle());
        let due = self
            .now()
            .saturating_add(u64::try_from(after.as_micros()).unwrap_or(u64::MAX));
        self.work.borrow_mut().timers.insert(
            id.0,
            Box::new(move |state, id, cx| f(downcast_mut(state), id, cx)),
        );
        self.out(SetTimer { id, due });
        id
    }

    /// Cancels a timer. If it already fired, the kernel drops its input.
    pub fn cancel_timer(&self, id: TimerId) {
        if self.work.borrow_mut().timers.remove(&id.0).is_some() {
            self.out(CancelTimer { id });
        }
    }

    /// Starts a job at the edge, whose result, or its error, comes back as an input that
    /// calls `f`. `f` is a handler of the running unit's.
    pub fn job<S: 'static>(
        &self,
        job: Job,
        f: fn(&mut S, JobId, Result<Vec<u8>, String>, &mut Cx),
    ) -> JobId {
        self.own::<S>("starts a job");
        let id = JobId(self.handle());
        self.work.borrow_mut().jobs.insert(
            id.0,
            Box::new(move |state, id, result, cx| f(downcast_mut(state), id, result, cx)),
        );
        self.out(StartJob { id, job });
        id
    }

    /// Cancels a job. Its result, when it comes, is dropped.
    pub fn cancel_job(&self, id: JobId) {
        self.work.borrow_mut().jobs.remove(&id.0);
    }

    /// The next handle, for a call that waits for an answer, such as one of the sim's, named
    /// for the running unit.
    pub fn handle(&self) -> Handle {
        let mut work = self.work.borrow_mut();
        let n = work.next;
        work.next += 1;
        Handle { unit: self.unit, n }
    }

    /// A version 4 UUID from the core's generator, so a replay draws the same one.
    pub fn new_id(&self) -> Uuid {
        uuid::Builder::from_random_bytes(self.random_bytes()).into_uuid()
    }

    /// Random bytes from the core's generator, such as a key's.
    pub fn random_bytes<const N: usize>(&self) -> [u8; N] {
        let mut bytes = [0; N];
        self.work
            .borrow_mut()
            .rng
            .as_mut()
            .expect("the core's first input should come before any handler draws an ID")
            .fill_bytes(&mut bytes);
        bytes
    }

    fn queue(&self, pending: Pending) {
        let mut work = self.work.borrow_mut();
        work.queued += 1;
        assert!(
            work.queued <= MOST_PENDING,
            "unit {} queued over {MOST_PENDING} moments and calls for one input, which is a cycle",
            self.table.units[self.unit as usize].name
        );
        work.pending.push_back(pending);
    }

    fn request<R: 'static>(&self) -> usize {
        *self
            .table
            .request_by_type
            .get(&TypeId::of::<R>())
            .unwrap_or_else(|| {
                panic!(
                    "request {} should be declared by a unit",
                    std::any::type_name::<R>()
                )
            })
    }

    fn own<S: 'static>(&self, what: &str) {
        let unit = self.table.units[self.unit as usize].name;
        assert!(
            self.table.unit_of::<S>() == self.unit,
            "unit {unit} {what} with another unit's handler"
        );
    }
}
