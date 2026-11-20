//! A live run of the core: starting, the loop, and exiting
//! (record/areas/core/01-loop-and-edge.md, "Starting and stopping").

use std::any::TypeId;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use kernel::{CancelTimer, Exit, FIRST, Kernel, Registry, SetTimer, SourceId, StartJob};
use recording_format::{Checkpoint, Header, Record};
use tracing::level_filters::LevelFilter;
use windows_sys::Win32::Security::Cryptography::{
    BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom,
};

use crate::edges::jobs::Jobs;
use crate::edges::timer::Timers;
use crate::log;
use crate::loop_stats::Stats;
use crate::queue::Queue;
use crate::recording::convert::to_record;
use crate::recording::{build_info, writer};
use crate::run_context;
use crate::sinks::Sinks;
use crate::{clock, cpu, data_folder};

/// A profile's write functions run on the loop's thread, in the sandbox, which lets QuickJS-ng
/// use `STACK` in src/engines/sandbox/src/lib.rs below each call into JS, so the loop needs
/// that much above its own frames. p10, the probe that ran a core's whole load on one thread,
/// gave its loop 16 MB with no reason recorded (record/areas/core/01-loop-and-edge.md,
/// "Threads"). `LOOP_STACK` in src/engines/sandbox/tests/sandbox.rs gives the sandbox's tests
/// the same, so change both together.
// TODO: size it from what QuickJS-ng needs, once the bench, which runs whole cores on one
// PC, has measured the sandbox on it.
pub(crate) const STACK: usize = 16 * 1024 * 1024;

/// How long the edges have, once the exit goes out, to carry out the outputs already put
/// out, such as the crew's goodbye. `CLOSE_WITHIN` in src/engines/transport/src/lib.rs gives
/// the endpoint's close the same, and `GRACE` in tools/bench/droplet/src/main.rs gives the
/// bench's droplet program the same, so change all three together. FS Copilot, the
/// shared-cockpit app we worked on before Dual Input, gave its goodbye on the way out this
/// long (record/areas/core/01-loop-and-edge.md, "Exiting").
const GRACE: Duration = Duration::from_millis(750);

/// An input that waited longer than this, in µs, means the loop is falling behind, which
/// the log says once until it catches up, so a test that loads the core can see it.
const BEHIND: u64 = 100_000;

pub struct Options {
    /// The data folder, which one core holds at a time.
    pub data: PathBuf,
    pub level: LevelFilter,
    /// Puts a checkpoint before every input rather than once a second, for tests that want
    /// a replay to name the very input where it parted.
    pub checkpoint_every_input: bool,
    /// Ends the process at a panic once the hook has run. Only a test that runs the core in
    /// its own process turns it off.
    pub abort_on_panic: bool,
}

pub enum Ran {
    /// Another core holds the data folder, so this one never started.
    AlreadyRunning,
    Exited {
        /// The run's folder in `recordings\`, which holds `inputs.zst` and `log.txt`.
        recording: PathBuf,
        /// From the exit going out to the run's end.
        exit_took: Duration,
    },
}

/// What the loop's thread reports once the units have registered.
struct Ready {
    start_files: Vec<&'static str>,
    /// The sim service's source, when the core has one, which the sim's side of the seam
    /// pushes under.
    seam: Option<SourceId>,
    /// The clients crate's source, when the core has one, which the WebSocket server pushes
    /// under.
    sockets: Option<SourceId>,
    /// The core helper's service's source, when the core has one, which the helper's edge
    /// pushes under.
    helper: Option<SourceId>,
    /// The network crate's source, when the core has one, which the transport pushes under.
    network: Option<SourceId>,
    /// The recording crate's source, when the core has one, which the writer tells of a stop.
    recording: Option<SourceId>,
    #[cfg(feature = "stand-in")]
    bench: Option<crate::bench::Sources>,
}

/// What the loop's thread needs from the edge before its first input.
struct Go {
    queue: Arc<Queue>,
    sinks: Sinks,
    writer: writer::Handle,
    checkpoint_every_input: bool,
}

/// Runs the core with `units` until a unit puts out an exit.
pub fn run(options: &Options, units: &[fn(&mut Registry)]) -> std::io::Result<Ran> {
    cpu::fma3_off();
    std::fs::create_dir_all(&options.data)?;
    let Some(_lock) = data_folder::lock(&options.data) else {
        return Ok(Ran::AlreadyRunning);
    };
    let folder = data_folder::run_folder(&options.data)?;
    let (context, _scope) = run_context::open(
        &folder.join("log.txt"),
        Some(log::CAP),
        options.level,
        options.abort_on_panic,
    )?;
    tracing::info!(commit = build_info::COMMIT, uncommitted = ?build_info::UNCOMMITTED, profile = build_info::PROFILE, messages = messages::HASH, "the core started");
    let seed = seed()?;
    let queue = Arc::new(Queue::default());

    // The units' handlers can hold state that isn't `Send`, such as QuickJS-ng's runtimes,
    // so the kernel is built on the loop's own thread, which reports back what the edge
    // needs before the first input.
    let (ready, units_ready) = mpsc::channel();
    let (go, gone) = mpsc::channel::<Go>();
    let units = units.to_vec();
    let loop_context = context.clone();
    let looper = std::thread::Builder::new()
        .name("loop".into())
        .stack_size(STACK)
        .spawn(move || {
            run_context::enter(loop_context);
            let mut kernel = build(&units);
            let _ = ready.send(Ready {
                start_files: kernel.start_files(),
                seam: kernel.source::<sim_client::Seam>(),
                sockets: kernel.source::<clients::Sockets>(),
                helper: kernel.source::<core_helper_service::Pipe>(),
                network: kernel.source::<network::Transport>(),
                recording: kernel.source::<::recording::Writer>(),
                #[cfg(feature = "stand-in")]
                bench: crate::bench::Sources::of(&kernel),
            });
            gone.recv().ok().map(|go| live(&mut kernel, go))
        })?;
    let Ok(Ready {
        start_files,
        seam,
        sockets,
        helper,
        network,
        recording,
        #[cfg(feature = "stand-in")]
        bench,
    }) = units_ready.recv()
    else {
        std::panic::resume_unwind(
            looper
                .join()
                .expect_err("the loop's thread ends early only by a panic"),
        );
    };
    // Read before the writer starts, so a start that fails leaves no thread behind.
    let files = start_files
        .into_iter()
        .map(|name| Ok((name.to_string(), start_file(&options.data.join(name))?)))
        .collect::<std::io::Result<_>>()?;

    let (cpu, fma3) = cpu::cpu();
    let header = Header {
        commit: build_info::COMMIT.into(),
        uncommitted: build_info::UNCOMMITTED.map(Into::into),
        profile: build_info::PROFILE.into(),
        rustc: build_info::RUSTC.into(),
        msvc: build_info::MSVC.into(),
        windows_sdk: build_info::WINDOWS_SDK.into(),
        simconnect_sdk: simconnect_types::SDK_VERSION.into(),
        cpu,
        fma3,
        checkpoint_every_input: options.checkpoint_every_input,
    };
    let stopped_queue = queue.clone();
    let (writer, writer_thread) = writer::start(
        &folder.join("inputs.zst"),
        &header,
        context.clone(),
        move |why| {
            if let Some(source) = recording {
                stopped_queue.push(source, ::recording::stopped_input(why));
            }
        },
    )?;
    let _ = context.writer.set(writer.clone());
    queue.push(FIRST, kernel::first_input(seed, files));

    let (timers, timer_thread) = Timers::start(queue.clone(), context.clone())?;
    let tokio_context = context.clone();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        // The clients' WebSocket server's sockets, the core helper's pipe and its 1s to exit
        // once stopped, and the transport's endpoint and its timers.
        .enable_io()
        .enable_time()
        .worker_threads(2)
        .max_blocking_threads(4)
        .thread_name("tokio")
        .on_thread_start(move || run_context::enter(tokio_context.clone()))
        .build()?;
    let jobs = Jobs {
        runtime: runtime.handle().clone(),
        queue: queue.clone(),
        data: Arc::new(options.data.clone()),
        http: crate::edges::jobs::http(),
    };
    let mut sinks = Sinks::default();
    let set = timers.clone();
    sinks.on(move |s: SetTimer| set.set(s.id, s.due));
    let cancel = timers.clone();
    sinks.on(move |c: CancelTimer| cancel.cancel(c.id));
    sinks.on(move |s: StartJob| jobs.start(s));
    let server = sockets
        .map(|source| {
            crate::edges::sockets::start(
                runtime.handle(),
                queue.clone(),
                source,
                &options.data,
                &mut sinks,
            )
        })
        .transpose()?;
    // Closing the runtime at the exit drops the helper's standard input, which tells it to
    // exit with the core.
    if let Some(source) = helper {
        crate::edges::core_helper::start(runtime.handle(), queue.clone(), source, &mut sinks);
    }
    let transport = network.map(|source| {
        crate::edges::network::start(runtime.handle(), queue.clone(), source, &mut sinks)
    });
    // The sim's side of the seam: the sim edge on SimConnect.dll, or in a bench build the
    // stand-in sim, which the bench's edge starts.
    #[cfg(not(feature = "stand-in"))]
    let sim = seam
        .map(|source| crate::edges::sim::start(queue.clone(), source, context.clone(), &mut sinks))
        .transpose()?;
    #[cfg(feature = "stand-in")]
    if let Some(sources) = bench {
        crate::bench::start(
            &options.data,
            queue.clone(),
            sources,
            seam,
            context.clone(),
            &mut sinks,
        )?;
    }
    let _ = go.send(Go {
        queue,
        sinks,
        writer: writer.clone(),
        checkpoint_every_input: options.checkpoint_every_input,
    });

    let exited = match looper.join() {
        Ok(exited) => exited.expect("the loop's thread got what it needed to run"),
        Err(panic) => std::panic::resume_unwind(panic),
    };
    // Shutting the runtime down drops its tasks where they wait, so the endpoint's close,
    // which sends each connection's close to the other cores, finishes first.
    if let Some(transport) = transport {
        transport.finish(GRACE.saturating_sub(exited.elapsed()));
    }
    runtime.shutdown_timeout(GRACE.saturating_sub(exited.elapsed()));
    if let Some(server) = server {
        server.stop();
    }
    timers.stop();
    let _ = timer_thread.join();
    #[cfg(not(feature = "stand-in"))]
    if let Some((edge, thread)) = sim {
        edge.stop();
        let _ = thread.join();
    }
    writer.finish();
    let _ = writer_thread.join();
    let exit_took = exited.elapsed();
    tracing::info!(exit_took_ms = exit_took.as_millis(), "the core exited");
    Ok(Ran::Exited {
        recording: folder,
        exit_took,
    })
}

pub(crate) fn build(units: &[fn(&mut Registry)]) -> Kernel {
    let mut registry = Registry::new();
    for register in units {
        register(&mut registry);
    }
    Kernel::new(registry)
}

/// A start file's bytes, or `None` when it doesn't exist. Any other error stops the start,
/// since a unit takes `None` as "no file", and a session crate that read a locked session
/// file as none would drop the pilot's session; the desktop app starts the core again.
fn start_file(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(std::io::Error::new(
            e.kind(),
            format!("couldn't read {}: {e}", path.display()),
        )),
    }
}

/// The loop: one input at a time, from the first until a unit puts out an exit. Returns
/// when the exit went out.
fn live(kernel: &mut Kernel, go: Go) -> Instant {
    let Go {
        queue,
        mut sinks,
        writer,
        checkpoint_every_input,
    } = go;
    let mut first = None;
    let mut checkpointed = 0;
    let mut behind = false;
    let mut stats = Stats::new();
    loop {
        let input = queue.pop();
        let popped = Instant::now();
        let waited = clock::now().saturating_sub(input.stamp);
        if waited > BEHIND && !behind {
            behind = true;
            tracing::warn!(
                seq = input.seq,
                waited_ms = waited / 1_000,
                "the loop is behind its queue"
            );
        } else if waited <= BEHIND && behind {
            behind = false;
            tracing::info!(seq = input.seq, "the loop caught up with its queue");
        }

        // A checkpoint holds the hash of every output before this input, so it goes in
        // before the input does, each time an input's stamp starts a new second since the
        // first input's.
        let second = (input.stamp - *first.get_or_insert(input.stamp)) / 1_000_000;
        if checkpoint_every_input || second > checkpointed {
            writer.record(Record::Checkpoint(Checkpoint {
                seq: input.seq,
                hash: kernel.hash(),
            }));
            checkpointed = second;
        }
        writer.record(Record::Input(to_record(&input)));

        let input = Rc::new(input);
        run_context::handling(input.clone());
        let handling = Instant::now();
        let outputs = kernel.handle(&input);
        let took = handling.elapsed();
        run_context::done();
        let mut exit = None;
        for output in outputs {
            if output.value_type() == TypeId::of::<Exit>() {
                exit = Some(Instant::now());
            } else {
                sinks.carry(output);
            }
        }
        // The loop is busy from taking an input to asking for the next, its checkpoint,
        // its record, and its outputs' sinks included.
        stats.handled(&input, waited, took, popped.elapsed());
        if let Some(exited) = exit {
            // One more checkpoint, as if before an input that never came, so a replay
            // checks the run's last second too.
            writer.record(Record::Checkpoint(Checkpoint {
                seq: input.seq + 1,
                hash: kernel.hash(),
            }));
            tracing::info!(seq = input.seq, "the core is exiting");
            stats.finish();
            return exited;
        }
    }
}

/// 256 bits from the operating system, which seed every unit's random IDs.
fn seed() -> std::io::Result<[u8; 32]> {
    let mut seed = [0; 32];
    // SAFETY: BCryptGenRandom writes `seed.len()` bytes into `seed`.
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            seed.as_mut_ptr(),
            seed.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(std::io::Error::other(format!(
            "BCryptGenRandom failed with {status:#x}"
        )));
    }
    Ok(seed)
}
