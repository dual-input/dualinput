//! One test for each rule of the kernel's interface (record/areas/core/01-loop-and-edge.md,
//! "The kernel's interface"), driven from outside the kernel as the core's edge drives it:
//! units register, inputs go in, outputs come out.

use std::time::Duration;

use kernel::{
    Cx, Exit, FIRST, Handler, Input, JOBS, Job, JobId, Kernel, Moment, Output, Registry, SetTimer,
    SourceId, StartJob, Started, TIMERS, TimerId, Verdict, View, Work, first_input,
};
use serde::Serialize;

const SEED: [u8; 32] = [7; 32];

fn input(seq: u64, stamp: u64, source: SourceId, bytes: Vec<u8>) -> Input {
    Input {
        seq,
        stamp,
        source,
        bytes,
    }
}

/// A kernel of the units `register` adds, past its first input.
fn started(register: impl FnOnce(&mut Registry)) -> (Kernel, Vec<Output>) {
    let mut registry = Registry::new();
    register(&mut registry);
    let mut kernel = Kernel::new(registry);
    let outputs = kernel.handle(&input(0, 1_000, FIRST, first_input(SEED, vec![])));
    (kernel, outputs)
}

fn values<T: Clone + 'static>(outputs: Vec<Output>) -> Vec<T> {
    outputs
        .into_iter()
        .filter_map(|o| o.into_value().downcast::<T>().ok().map(|v| *v))
        .collect()
}

/// What the test units put out: the unit's name and what it saw.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct Said(&'static str, String);

#[derive(Default)]
struct Counter {
    pokes: u32,
}

#[derive(Default)]
struct Watcher;

impl Counter {
    fn on_input(me: &mut Counter, _: &Input, cx: &mut Cx) {
        me.pokes += 1;
        cx.out(Said("counter", me.pokes.to_string()));
    }
}

#[test]
fn a_handler_holds_its_own_state_and_reads_anothers() {
    struct Key;
    fn watch(_: &mut Watcher, _: &Started, cx: &mut Cx) {
        cx.out(Said("watcher", cx.read::<Counter>().pokes.to_string()));
    }
    let (mut kernel, outputs) = started(|r| {
        r.unit::<Counter>("counter")
            .source::<Key>(Counter::on_input);
        r.unit::<Watcher>("watcher").on::<Started>(watch);
    });
    assert_eq!(values::<Said>(outputs), [Said("watcher", "0".into())]);
    let source = kernel
        .source::<Key>()
        .expect("the counter registered a source");
    assert_eq!(source, SourceId(3), "the kernel's three sources come first");
    kernel.handle(&input(1, 2_000, source, vec![]));
    let outputs = kernel.handle(&input(2, 3_000, source, vec![]));
    assert_eq!(values::<Said>(outputs), [Said("counter", "2".into())]);
}

#[test]
#[should_panic(expected = "unit counter read its own state through the kernel")]
fn a_handler_that_reads_its_own_state_through_cx_panics() {
    fn read_self(_: &mut Counter, _: &Started, cx: &mut Cx) {
        cx.read::<Counter>();
    }
    started(|r| {
        r.unit::<Counter>("counter").on::<Started>(read_self);
    });
}

#[test]
#[should_panic(expected = "should be no other unit's")]
fn two_units_cant_share_a_type_of_state() {
    let mut registry = Registry::new();
    registry.unit::<Counter>("counter");
    registry.unit::<Counter>("another");
}

/// A crate of the platform's keeps what units register with it in its own state, and the
/// kernel calls a registered handler once the platform's own handler has returned, so the
/// called handler can read the platform's state, and its answer comes back the same way.
#[test]
fn a_hook_runs_after_the_handler_that_calls_it() {
    #[derive(Default)]
    struct Commands {
        registered: Vec<Handler<String>>,
        dispatched: u32,
        answers: Vec<String>,
    }
    struct Key;
    impl Commands {
        fn on_input(me: &mut Commands, input: &Input, cx: &mut Cx) {
            me.dispatched += 1;
            for handler in &me.registered {
                cx.call_handler(handler, String::from_utf8(input.bytes.clone()).unwrap());
            }
        }
        fn answer(me: &mut Commands, answer: String, cx: &mut Cx) {
            me.answers.push(answer);
            cx.out(Said("commands", me.answers.join(",")));
        }
    }
    #[derive(Default)]
    struct Feature;
    impl Feature {
        fn command(_: &mut Feature, text: String, cx: &mut Cx) {
            let dispatched = cx.read::<Commands>().dispatched;
            cx.out(Said("feature", format!("{text} after {dispatched}")));
            cx.call(Commands::answer, format!("{text} done"));
        }
    }
    let (mut kernel, _) = started(|r| {
        r.unit::<Commands>("commands")
            .source::<Key>(Commands::on_input);
        let mut feature = r.unit::<Feature>("feature");
        let handler = feature.handler(Feature::command);
        feature
            .registry()
            .state_mut::<Commands>()
            .registered
            .push(handler);
    });
    let source = kernel.source::<Key>().unwrap();
    let outputs = kernel.handle(&input(1, 2_000, source, b"go".to_vec()));
    assert_eq!(
        values::<Said>(outputs),
        [
            Said("feature", "go after 1".into()),
            Said("commands", "go done".into())
        ]
    );
}

#[derive(Clone)]
struct Rang(u32);
impl Moment for Rang {}

/// A moment queues behind those already waiting, and every one runs before the next input.
#[test]
fn moments_run_in_the_order_raised_before_the_next_input() {
    #[derive(Default)]
    struct Bell;
    fn ring(_: &mut Bell, _: &Started, cx: &mut Cx) {
        cx.raise(Rang(1));
        cx.raise(Rang(2));
        cx.out(Said("bell", "raised".into()));
    }
    fn first(_: &mut Counter, rang: &Rang, cx: &mut Cx) {
        cx.out(Said("counter", rang.0.to_string()));
        if rang.0 == 1 {
            cx.raise(Rang(3));
        }
    }
    fn second(_: &mut Watcher, rang: &Rang, cx: &mut Cx) {
        cx.out(Said("watcher", rang.0.to_string()));
    }
    let (_, outputs) = started(|r| {
        r.unit::<Bell>("bell").on::<Started>(ring);
        r.unit::<Counter>("counter").on::<Rang>(first);
        r.unit::<Watcher>("watcher").on::<Rang>(second);
    });
    let said: Vec<String> = values::<Said>(outputs)
        .into_iter()
        .map(|s| format!("{} {}", s.0, s.1))
        .collect();
    assert_eq!(
        said,
        [
            "bell raised",
            "counter 1",
            "watcher 1",
            "counter 2",
            "watcher 2",
            "counter 3",
            "watcher 3"
        ]
    );
}

#[test]
#[should_panic(expected = "queued over 1000 moments and calls for one input, which is a cycle")]
fn a_cycle_of_moments_panics_after_1000() {
    fn ring(_: &mut Counter, _: &Started, cx: &mut Cx) {
        cx.raise(Rang(0));
    }
    fn again(_: &mut Counter, rang: &Rang, cx: &mut Cx) {
        cx.raise(Rang(rang.0 + 1));
    }
    started(|r| {
        r.unit::<Counter>("counter")
            .on::<Started>(ring)
            .on::<Rang>(again);
    });
}

/// The session crate's control, in miniature: a request the platform decides, a guard a
/// feature adds, and the verdict kept current after each input.
mod requests {
    use super::*;

    pub struct TakeControl;

    #[derive(Default)]
    pub struct Control {
        pub holder: Option<&'static str>,
        pub wants: bool,
    }

    #[derive(Default)]
    pub struct Instructor {
        pub allows: bool,
    }

    pub struct ControlKey;
    pub struct InstructorKey;

    impl Control {
        fn on_input(me: &mut Control, input: &Input, cx: &mut Cx) {
            me.wants = input.bytes == b"want";
            if input.bytes == b"ask" {
                cx.ask(TakeControl);
            }
        }
        fn decide(me: &mut Control, _: TakeControl, cx: &mut Cx) {
            me.holder = Some("this pilot");
            cx.out(Said("control", "passed".into()));
        }
        fn build(me: &Control, _: &View) -> Option<TakeControl> {
            me.wants.then_some(TakeControl)
        }
    }

    impl Instructor {
        fn on_input(me: &mut Instructor, input: &Input, _: &mut Cx) {
            me.allows = input.bytes == b"allow";
        }
        fn only_the_instructor(
            me: &Instructor,
            _: &TakeControl,
            view: &View,
        ) -> Result<(), String> {
            let holder = view.read::<Control>().holder;
            if me.allows || holder.is_some() {
                Ok(())
            } else {
                Err("Only the instructor can pass control".into())
            }
        }
    }

    pub fn register(r: &mut Registry) {
        let mut control = r.unit::<Control>("control");
        control.source::<ControlKey>(Control::on_input);
        control.request(Control::decide, Control::build);
        let mut instructor = r.unit::<Instructor>("instructor");
        instructor.source::<InstructorKey>(Instructor::on_input);
        instructor.guard(Instructor::only_the_instructor);
    }
}

#[test]
fn a_guard_refuses_a_request_and_its_verdict_stays_current() {
    use requests::*;
    struct Peek;
    #[derive(Default)]
    struct Shows;
    fn show(_: &mut Shows, _: &Input, cx: &mut Cx) {
        cx.out(Said("shows", format!("{:?}", cx.verdict::<TakeControl>())));
    }
    let (mut kernel, _) = started(|r| {
        register(r);
        r.unit::<Shows>("shows").source::<Peek>(show);
    });
    let control = kernel.source::<ControlKey>().unwrap();
    let instructor = kernel.source::<InstructorKey>().unwrap();
    let peek = kernel.source::<Peek>().unwrap();
    let mut seq = 0;
    let mut send = |kernel: &mut Kernel, source, bytes: &[u8]| {
        seq += 1;
        values::<Said>(kernel.handle(&input(seq, seq * 1_000, source, bytes.to_vec())))
    };
    assert_eq!(send(&mut kernel, peek, b""), [Said("shows", "None".into())]);
    send(&mut kernel, control, b"want");
    let refused = Verdict::Denied(vec!["Only the instructor can pass control".into()]);
    assert_eq!(
        send(&mut kernel, peek, b""),
        [Said("shows", format!("{:?}", Some(refused)))]
    );
    assert_eq!(
        send(&mut kernel, control, b"ask"),
        [],
        "the guard refused the request"
    );
    send(&mut kernel, instructor, b"allow");
    send(&mut kernel, control, b"want");
    assert_eq!(
        send(&mut kernel, peek, b""),
        [Said("shows", format!("{:?}", Some(Verdict::Allowed)))]
    );
    assert_eq!(
        send(&mut kernel, control, b"ask"),
        [Said("control", "passed".into())]
    );
}

#[derive(Default)]
struct Waiter {
    timer: Option<TimerId>,
    job: Option<JobId>,
}

impl Waiter {
    fn start(me: &mut Waiter, _: &Started, cx: &mut Cx) {
        me.timer = Some(cx.timer(Duration::from_millis(5), Waiter::rang));
        me.job = Some(cx.job(Job::read("settings.json"), Waiter::read));
    }
    fn rang(me: &mut Waiter, id: TimerId, cx: &mut Cx) {
        assert_eq!(me.timer, Some(id));
        cx.out(Said("waiter", format!("rang at {}", cx.now())));
    }
    fn read(_: &mut Waiter, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        cx.out(Said("waiter", format!("read {result:?}")));
    }
}

#[test]
fn timers_and_jobs_come_back_as_inputs() {
    let (mut kernel, outputs) = started(|r| {
        r.unit::<Watcher>("watcher");
        r.unit::<Waiter>("waiter").on::<Started>(Waiter::start);
    });
    let mut outputs = outputs.into_iter();
    let set = *outputs
        .next()
        .unwrap()
        .into_value()
        .downcast::<SetTimer>()
        .unwrap();
    assert_eq!(
        set.due,
        1_000 + 5_000,
        "a timer is due at its input's stamp plus its delay"
    );
    assert_eq!(
        (set.id.handle().unit(), set.id.handle().n()),
        (1, 0),
        "the core's first handle, named for the waiter"
    );
    let job = *outputs
        .next()
        .unwrap()
        .into_value()
        .downcast::<StartJob>()
        .unwrap();
    assert_eq!(
        job.job.work,
        Work::Read {
            path: "settings.json".into()
        }
    );
    assert_eq!(job.id.handle().n(), 1);

    let said = values::<Said>(kernel.handle(&input(1, 6_100, TIMERS, set.id.fired())));
    assert_eq!(said, [Said("waiter", "rang at 6100".into())]);
    let said =
        values::<Said>(kernel.handle(&input(2, 7_000, JOBS, job.id.finished(Ok(b"{}".to_vec())))));
    assert_eq!(said, [Said("waiter", "read Ok([123, 125])".into())]);
}

#[test]
fn a_canceled_timer_that_fires_anyway_is_dropped() {
    #[derive(Default)]
    struct Canceler;
    fn start(_: &mut Canceler, _: &Started, cx: &mut Cx) {
        let id = cx.timer(Duration::from_secs(1), never);
        cx.cancel_timer(id);
    }
    fn never(_: &mut Canceler, _: TimerId, _: &mut Cx) {
        panic!("a canceled timer should never call its handler");
    }
    let (mut kernel, outputs) = started(|r| {
        r.unit::<Canceler>("canceler").on::<Started>(start);
    });
    let set = outputs
        .into_iter()
        .next()
        .unwrap()
        .into_value()
        .downcast::<SetTimer>()
        .unwrap();
    assert!(
        kernel
            .handle(&input(1, 2_000_000, TIMERS, set.id.fired()))
            .is_empty()
    );
}

#[derive(Default)]
struct Drawer {
    draws: usize,
}

impl Drawer {
    fn draw(me: &mut Drawer, _: &Started, cx: &mut Cx) {
        for _ in 0..me.draws {
            cx.out(Said("drawer", cx.new_id().to_string()));
        }
    }
}

#[derive(Default)]
struct Other;

impl Other {
    fn draw(_: &mut Other, _: &Started, cx: &mut Cx) {
        cx.out(Said("other", cx.new_id().to_string()));
        cx.out(Said("other", format!("{:?}", cx.random_bytes::<4>())));
    }
}

/// Every unit draws from the core's one generator, which the first input's seed keys, so a
/// replay of the same inputs draws the same IDs.
#[test]
fn ids_follow_the_seed() {
    let ids = || {
        let (_, outputs) = started(|r| {
            r.unit::<Drawer>("drawer").on::<Started>(Drawer::draw);
            r.state_mut::<Drawer>().draws = 2;
            r.unit::<Other>("other").on::<Started>(Other::draw);
        });
        values::<Said>(outputs)
    };
    let (first, again) = (ids(), ids());
    assert_eq!(first, again, "the same seed draws the same IDs");
    assert_ne!(first[0], first[1]);
    assert_ne!(
        first[1].1, first[2].1,
        "another unit's draw comes next in the one sequence"
    );
    let id: uuid::Uuid = first[0].1.parse().unwrap();
    assert_eq!(id.get_version_num(), 4);
}

#[test]
fn start_files_arrive_with_the_first_input_before_started() {
    #[derive(Default)]
    struct Settings {
        bytes: Option<Vec<u8>>,
    }
    fn settings(me: &mut Settings, bytes: Option<&[u8]>, _: &mut Cx) {
        me.bytes = bytes.map(<[u8]>::to_vec);
    }
    fn session(_: &mut Settings, bytes: Option<&[u8]>, cx: &mut Cx) {
        cx.out(Said("settings", format!("session {bytes:?}")));
    }
    fn start(me: &mut Settings, _: &Started, cx: &mut Cx) {
        cx.out(Said("settings", format!("started with {:?}", me.bytes)));
    }
    let mut registry = Registry::new();
    registry
        .unit::<Settings>("settings")
        .start_file("settings.json", settings)
        .start_file("session.json", session)
        .on::<Started>(start);
    let mut kernel = Kernel::new(registry);
    assert_eq!(kernel.start_files(), ["settings.json", "session.json"]);
    let first = first_input(
        SEED,
        vec![
            ("settings.json".into(), Some(b"{}".to_vec())),
            ("session.json".into(), None),
        ],
    );
    let said = values::<Said>(kernel.handle(&input(0, 1_000, FIRST, first)));
    assert_eq!(
        said,
        [
            Said("settings", "session None".into()),
            Said("settings", "started with Some([123, 125])".into())
        ]
    );
}

#[test]
fn outputs_come_out_in_the_order_put_out() {
    #[derive(Default)]
    struct Leaver;
    fn leave(_: &mut Leaver, _: &Started, cx: &mut Cx) {
        cx.out(Said("leaver", "bye".into()));
        cx.out(Exit);
    }
    let (_, outputs) = started(|r| {
        r.unit::<Leaver>("leaver").on::<Started>(leave);
    });
    let mut outputs = outputs.into_iter().map(Output::into_value);
    assert!(outputs.next().unwrap().downcast::<Said>().is_ok());
    assert!(outputs.next().unwrap().downcast::<Exit>().is_ok());
    assert!(outputs.next().is_none());
}
