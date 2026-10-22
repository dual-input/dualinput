//! A core of the tests' own units, run in this process through the edge's real threads,
//! queue, writer, and replay: it records a run and exits, and the recording replays to
//! every checkpoint, while a copy with one input changed names where it parted. Each test
//! keeps its data folder under Cargo's temporary folder for integration tests.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::Duration;

use dualinput_core::{Options, Outcome, Ran, Replay, replay, run};
use kernel::{Cx, Exit, JOBS, Job, JobId, Registry, Started, TimerId};
use recording_format::{Checkpoint, Header, Reader, Record, Writer};
use tracing::level_filters::LevelFilter;

fn data_folder(name: &str) -> PathBuf {
    let folder = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("core")
        .join(name);
    if folder.exists() {
        std::fs::remove_dir_all(&folder).expect("a test's own folder should be removable");
    }
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

fn options(data: &Path) -> Options {
    Options {
        data: data.to_path_buf(),
        level: LevelFilter::INFO,
        checkpoint_every_input: false,
        abort_on_panic: false,
    }
}

/// Every 100ms, 25 times, reads `note.txt` from the data folder and writes what it read to
/// `copy.txt`, so its outputs turn on a job's result, and exits once the 25th copy is
/// written, however long the PC takes over the jobs.
#[derive(Default)]
struct Copier {
    ticks: u32,
    copies: u32,
}

impl Copier {
    const TICKS: u32 = 25;

    fn register(r: &mut Registry) {
        r.unit::<Copier>("copier").on::<Started>(Copier::start);
    }

    fn start(_: &mut Copier, _: &Started, cx: &mut Cx) {
        cx.timer(Duration::from_millis(100), Copier::tick);
    }

    fn tick(me: &mut Copier, _: TimerId, cx: &mut Cx) {
        me.ticks += 1;
        cx.job(Job::read("note.txt"), Copier::read);
        if me.ticks < Copier::TICKS {
            cx.timer(Duration::from_millis(100), Copier::tick);
        }
    }

    fn read(_: &mut Copier, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let note = result.expect("note.txt should read");
        cx.job(Job::write("copy.txt", note), Copier::wrote);
    }

    fn wrote(me: &mut Copier, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        result.expect("copy.txt should write");
        me.copies += 1;
        if me.copies == Copier::TICKS {
            cx.out(Exit);
        }
    }
}

const UNITS: &[fn(&mut Registry)] = &[Copier::register];

fn read_all(file: &Path) -> (Header, Vec<Record>) {
    let (header, mut reader) = Reader::new(File::open(file).unwrap()).unwrap();
    let mut records = Vec::new();
    while let Some(record) = reader.next_record().unwrap() {
        records.push(record);
    }
    (header, records)
}

fn write_all(file: &Path, header: &Header, records: &[Record]) {
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    let mut writer = Writer::new(File::create(file).unwrap(), header).unwrap();
    for record in records {
        if matches!(record, Record::Checkpoint(_)) {
            writer.end_frame().unwrap();
        }
        writer.write(record).unwrap();
    }
    writer.finish().unwrap();
}

#[test]
fn records_a_run_exits_within_a_second_and_replays_to_every_checkpoint() {
    let data = data_folder("records-a-run");
    std::fs::write(data.join("note.txt"), "a note").unwrap();
    let Ran::Exited {
        recording,
        exit_took,
    } = run(&options(&data), UNITS).unwrap()
    else {
        panic!("a new data folder should be free");
    };
    assert!(
        exit_took < Duration::from_secs(1),
        "the core took {exit_took:?} to exit"
    );
    assert_eq!(
        std::fs::read_to_string(data.join("copy.txt")).unwrap(),
        "a note"
    );
    let log = std::fs::read_to_string(recording.join("log.txt")).unwrap();
    assert!(
        log.contains("the core started") && log.contains("the core exited"),
        "{log}"
    );

    let file = recording.join("inputs.zst");
    let Replay { warnings, outcome } = replay(&file, UNITS, LevelFilter::INFO, false).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let Outcome::Matched {
        inputs,
        checkpoints,
        truncated,
    } = outcome
    else {
        panic!("the replay should match the run it replays");
    };
    // The first input, then 25 timers, 25 reads, and 25 writes, over 2.5s.
    assert_eq!(inputs, 76);
    assert!(checkpoints >= 2, "{checkpoints} checkpoints");
    assert!(!truncated);

    // The first read of the note, with its last byte changed, changes what the copier
    // writes, so the first checkpoint after it differs.
    let (header, mut records) = read_all(&file);
    let changed = records
        .iter()
        .position(
            |r| matches!(r, Record::Input(i) if i.source == JOBS.0 && i.bytes.ends_with(b"a note")),
        )
        .expect("the recording should hold the note's first read");
    let Record::Input(input) = &mut records[changed] else {
        unreachable!()
    };
    let seq = input.seq;
    *input.bytes.last_mut().unwrap() = b'f';
    let (since, checkpoint) = {
        let checkpoints: Vec<&Checkpoint> = records
            .iter()
            .filter_map(|r| {
                if let Record::Checkpoint(c) = r {
                    Some(c)
                } else {
                    None
                }
            })
            .collect();
        let after = checkpoints
            .iter()
            .position(|c| c.seq > seq)
            .expect("a checkpoint should follow the change");
        (
            if after == 0 {
                0
            } else {
                checkpoints[after - 1].seq
            },
            checkpoints[after].seq,
        )
    };
    let copy = data.join("changed").join("inputs.zst");
    write_all(&copy, &header, &records);
    let Replay { outcome, .. } = replay(&copy, UNITS, LevelFilter::INFO, false).unwrap();
    match outcome {
        Outcome::Parted {
            checkpoint: at,
            since: from,
            ..
        } => assert_eq!((at, from), (checkpoint, since)),
        _ => {
            panic!("the changed copy should part from the run at the checkpoint after input {seq}")
        }
    }
}

/// A test unit that reads the clock in one handler is caught at the next checkpoint of its
/// replay (record/areas/core/01-loop-and-edge.md, "Cases for the bench").
#[test]
fn a_unit_that_reads_the_clock_is_caught_at_the_next_checkpoint() {
    #[derive(Default)]
    struct Clocked {
        ticks: u32,
    }
    impl Clocked {
        fn start(_: &mut Clocked, _: &Started, cx: &mut Cx) {
            cx.timer(Duration::from_millis(100), Clocked::tick);
        }
        fn tick(me: &mut Clocked, _: TimerId, cx: &mut Cx) {
            me.ticks += 1;
            if me.ticks == 3 {
                // What no handler may do, which Clippy fails in the loop's crates.
                let now = std::time::SystemTime::now();
                cx.job(
                    Job::write("now.txt", format!("{now:?}").into_bytes()),
                    Clocked::wrote,
                );
            }
            if me.ticks > 15 {
                cx.out(Exit);
            } else {
                cx.timer(Duration::from_millis(100), Clocked::tick);
            }
        }
        fn wrote(_: &mut Clocked, _: JobId, _: Result<Vec<u8>, String>, _: &mut Cx) {}
    }
    fn register(r: &mut Registry) {
        r.unit::<Clocked>("clocked").on::<Started>(Clocked::start);
    }
    let data = data_folder("reads-the-clock");
    let Ran::Exited { recording, .. } = run(&options(&data), &[register]).unwrap() else {
        panic!()
    };
    let file = recording.join("inputs.zst");
    let (_, records) = read_all(&file);
    let first = records
        .iter()
        .find_map(|r| {
            if let Record::Checkpoint(c) = r {
                Some(c.seq)
            } else {
                None
            }
        })
        .expect("a 1.6s run should hold a checkpoint");
    let Replay { outcome, .. } = replay(&file, &[register], LevelFilter::INFO, false).unwrap();
    match outcome {
        Outcome::Parted {
            checkpoint,
            since,
            second,
        } => assert_eq!((checkpoint, since, second), (first, 0, 1)),
        _ => panic!("the replay should part at the first checkpoint after the clock was read"),
    }
}

/// A replay on another commit refuses, naming the commit to check out
/// (record/areas/core/01-loop-and-edge.md, "Cases for the bench").
#[test]
fn a_replay_built_from_another_commit_refuses_naming_the_commit() {
    let data = data_folder("another-commit");
    std::fs::write(data.join("note.txt"), "a note").unwrap();
    let Ran::Exited { recording, .. } = run(&options(&data), UNITS).unwrap() else {
        panic!()
    };
    let (mut header, records) = read_all(&recording.join("inputs.zst"));
    header.commit = "0123456789abcdef0123456789abcdef01234567".into();
    let copy = data.join("another").join("inputs.zst");
    write_all(&copy, &header, &records);
    let Replay { outcome, .. } = replay(&copy, UNITS, LevelFilter::INFO, false).unwrap();
    match outcome {
        Outcome::Refused(reason) => {
            assert!(
                reason.contains("check out 0123456789abcdef0123456789abcdef01234567"),
                "{reason}"
            )
        }
        _ => panic!("a replay built from another commit should refuse"),
    }
}

/// The core links the C runtime statically, so it imports none of the runtime's DLLs
/// (record/areas/build/01-the-build.md, "Cases for the bench").
#[test]
fn the_core_imports_no_c_runtime_dll() {
    let mut dumpbin = cc::windows_registry::find("x86_64-pc-windows-msvc", "dumpbin.exe")
        .expect("dumpbin should come with the MSVC tools");
    let output = dumpbin
        .arg("/imports")
        .arg(env!("CARGO_BIN_EXE_dualinput-core"))
        .output()
        .unwrap();
    let imports = String::from_utf8_lossy(&output.stdout).to_lowercase();
    assert!(
        imports.contains("kernel32.dll"),
        "dumpbin should list the core's imports: {imports}"
    );
    assert!(!imports.contains("api-ms-win-crt-"), "{imports}");
    assert!(!imports.contains("vcruntime140"), "{imports}");
}

/// A timer fires within 2ms of its deadline at p99 on an idle PC
/// (record/areas/core/01-loop-and-edge.md, "Budgets"). It measures timing, which another
/// program's load moves, so it runs by hand, on our development machine:
///
///   cargo test -p dualinput-core --release --test core -- --ignored --nocapture timers_fire
#[test]
#[ignore = "a timing budget, measured by hand"]
fn timers_fire_within_2ms_at_p99() {
    #[derive(Default)]
    struct Timed {
        due: u64,
        late: Vec<u64>,
    }
    impl Timed {
        const TIMERS: usize = 1_000;
        fn start(me: &mut Timed, _: &Started, cx: &mut Cx) {
            Timed::next(me, cx);
        }
        fn next(me: &mut Timed, cx: &mut Cx) {
            me.due = cx.now() + 10_000;
            cx.timer(Duration::from_millis(10), Timed::fired);
        }
        fn fired(me: &mut Timed, _: TimerId, cx: &mut Cx) {
            me.late.push(cx.now() - me.due);
            if me.late.len() < Timed::TIMERS {
                Timed::next(me, cx);
            } else {
                let text: Vec<String> = me.late.iter().map(u64::to_string).collect();
                cx.job(
                    Job::write("late.txt", text.join("\n").into_bytes()),
                    Timed::written,
                );
            }
        }
        fn written(_: &mut Timed, _: JobId, _: Result<Vec<u8>, String>, cx: &mut Cx) {
            cx.out(Exit);
        }
    }
    fn register(r: &mut Registry) {
        r.unit::<Timed>("timed").on::<Started>(Timed::start);
    }
    let data = data_folder("timers");
    run(&options(&data), &[register]).unwrap();
    let mut late: Vec<u64> = std::fs::read_to_string(data.join("late.txt"))
        .unwrap()
        .lines()
        .map(|l| l.parse().unwrap())
        .collect();
    late.sort_unstable();
    let p = |q: f64| late[((late.len() as f64 * q).ceil() as usize).clamp(1, late.len()) - 1];
    println!(
        "TIMERS\t{} fired\tp50 {}µs\tp99 {}µs\tmax {}µs late",
        late.len(),
        p(0.5),
        p(0.99),
        late[late.len() - 1]
    );
    assert!(p(0.99) <= 2_000, "a timer fired {}µs late at p99", p(0.99));
}

/// The core holds under 30 MB of private working set with no session
/// (record/areas/core/01-loop-and-edge.md, "Budgets"). It runs by hand, as above.
#[test]
#[ignore = "a memory budget, measured by hand"]
fn the_core_idles_under_30_mb() {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2,
    };
    let data = data_folder("idle");
    let mut core = std::process::Command::new(env!("CARGO_BIN_EXE_dualinput-core"))
        .args(["--data", data.to_str().unwrap()])
        .spawn()
        .unwrap();
    std::thread::sleep(Duration::from_secs(10));
    let mut counters = PROCESS_MEMORY_COUNTERS_EX2 {
        cb: size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
        ..Default::default()
    };
    // SAFETY: the core's handle stays open until `kill`, and the call writes `cb` bytes.
    let read = unsafe {
        GetProcessMemoryInfo(
            core.as_raw_handle(),
            (&raw mut counters).cast::<PROCESS_MEMORY_COUNTERS>(),
            counters.cb,
        )
    };
    core.kill().unwrap();
    assert_ne!(
        read, 0,
        "GetProcessMemoryInfo should read the core's counters"
    );
    let mb = counters.PrivateWorkingSetSize as f64 / 1e6;
    println!("MEMORY\t{mb:.1} MB of private working set, idle with no session");
    assert!(mb < 30.0, "the core held {mb:.1} MB");
}
