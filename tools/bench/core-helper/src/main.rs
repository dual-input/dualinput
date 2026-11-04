//! The bench's stand-in core helper. A bench core starts it in the real helper's place, so the
//! core's own path runs: it starts the program, sends it every want, reads its `Hello`, and
//! starts it again when it exits. Only the Windows calls behind the pipe differ, which the
//! helper's own tests and its cases in the sim run (record/areas/build/02-testing.md, "The
//! stand-in core helper").
//!
//! The core owns both ends of the pipe, so the bench reaches the stand-in over a line of its
//! own: the bench starts the core with `DUALINPUT_BENCH_HELPER` naming a local port, the
//! stand-in inherits it from the core, connects there, says what the core sent it, and does
//! what the bench tells it, one JSON line each way.
//!
//! A core whose scenario has no business with its helper starts the stand-in with no port, since
//! every session runs a helper for take-control's sounds. With no line to be told on, it says its
//! hello at once, so the core counts it up.

use std::io::{BufRead, BufReader, Read, Stdout, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use messages::bench::{StandInHelperAct, StandInHelperLine};
use messages::core_helper::{self, FromHelper, MouseKind, ToHelper};
use windows_sys::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

type Shared<T> = Arc<Mutex<T>>;

/// The stamp on the last press the bench told it to make, which a `play` line counts from.
static LAST_PRESS: AtomicU64 = AtomicU64::new(0);

fn main() {
    let to_core: Shared<Stdout> = Arc::new(Mutex::new(std::io::stdout()));
    let to_bench = match std::env::var("DUALINPUT_BENCH_HELPER") {
        Ok(port) => {
            let Some(bench) = port
                .parse::<u16>()
                .ok()
                .and_then(|port| TcpStream::connect(("127.0.0.1", port)).ok())
            else {
                std::process::exit(1);
            };
            let to_bench: Shared<TcpStream> = Arc::new(Mutex::new(
                bench.try_clone().expect("the bench's line should clone"),
            ));
            tell(
                Some(&to_bench),
                &StandInHelperLine::Started {
                    process: std::process::id(),
                },
            );
            let core = to_core.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(bench).lines() {
                    let Ok(line) = line else { break };
                    if let Ok(act) = serde_json::from_str::<StandInHelperAct>(&line) {
                        act_on(act, &core);
                    }
                }
            });
            Some(to_bench)
        }
        Err(_) => {
            act_on(
                StandInHelperAct::Hello {
                    version: None,
                    hash: None,
                },
                &to_core,
            );
            None
        }
    };
    let to_bench = to_bench.as_ref();
    let mut stdin = std::io::stdin().lock();
    loop {
        let mut head = [0; 4];
        if stdin.read_exact(&mut head).is_err() {
            break;
        }
        let Some(length) = core_helper::length(head) else {
            std::process::exit(2);
        };
        let mut bytes = vec![0; length];
        if stdin.read_exact(&mut bytes).is_err() {
            break;
        }
        let Ok(message) = core_helper::decode::<ToHelper>(&bytes) else {
            std::process::exit(3);
        };
        tell(to_bench, &heard(message));
    }
    tell(to_bench, &StandInHelperLine::Closed);
    std::process::exit(0);
}

/// What the bench hears of a message from the core.
fn heard(message: ToHelper) -> StandInHelperLine {
    match message {
        ToHelper::Wants(w) => StandInHelperLine::Wants {
            bindings: w.bindings,
            next_press: w.next_press,
            mouse: w.mouse,
            captures: w.captures.iter().map(|(n, _)| *n).collect(),
            streams: w.streams.iter().map(|(n, _)| *n).collect(),
            sounds: w.sounds,
            lists: w.lists,
        },
        ToHelper::Sound { sound, ogg_opus } => StandInHelperLine::Sound {
            sound,
            bytes: ogg_opus.len() as u32,
        },
        ToHelper::Play { sound } => StandInHelperLine::Play {
            sound,
            since_press_us: match LAST_PRESS.load(Ordering::Relaxed) {
                0 => 0,
                press => now().saturating_sub(press),
            },
        },
        ToHelper::Frame { stream, number, .. } => StandInHelperLine::Frame { stream, number },
    }
}

fn act_on(act: StandInHelperAct, core: &Shared<Stdout>) {
    match act {
        StandInHelperAct::Hello { version, hash } => send(
            core,
            &FromHelper::Hello {
                version: version.unwrap_or_else(|| messages::VERSION.into()),
                hash: hash.unwrap_or_else(|| messages::HASH.into()),
            },
        ),
        StandInHelperAct::Press { binding, down } => {
            let at = now();
            LAST_PRESS.store(at, Ordering::Relaxed);
            send(core, &FromHelper::Press { binding, down, at });
        }
        StandInHelperAct::NextPress { input, name } => send(
            core,
            &FromHelper::NextPress {
                input,
                name,
                at: now(),
            },
        ),
        StandInHelperAct::Click { x, y } => {
            for kind in [MouseKind::LeftDown, MouseKind::LeftUp] {
                send(core, &mouse(kind, x, y));
            }
        }
        StandInHelperAct::Mouse { kind, x, y } => send(core, &mouse(kind, x, y)),
        StandInHelperAct::Moves { per_second, for_ms } => {
            let core = core.clone();
            std::thread::spawn(move || {
                let every = Duration::from_secs(1) / per_second.max(1);
                let until = Instant::now() + Duration::from_millis(for_ms);
                let mut next = Instant::now();
                while next < until {
                    send(&core, &mouse(MouseKind::Move, 0.0, 0.0));
                    next += every;
                    std::thread::sleep(next.saturating_duration_since(Instant::now()));
                }
            });
        }
        StandInHelperAct::Frame { capture, bytes } => send(
            core,
            &FromHelper::Frame {
                capture,
                opus: vec![0; bytes as usize],
                at: now(),
            },
        ),
        StandInHelperAct::Capturing { capture, program } => {
            send(core, &FromHelper::Capturing { capture, program })
        }
        StandInHelperAct::Failed { want, error } => send(core, &FromHelper::Failed { want, error }),
        StandInHelperAct::Lists { outputs, programs } => {
            send(core, &FromHelper::Lists { outputs, programs })
        }
        StandInHelperAct::InUse { output } => send(core, &FromHelper::InUse { output }),
        StandInHelperAct::Exit { code } => std::process::exit(code),
    }
}

fn mouse(kind: MouseKind, x: f32, y: f32) -> FromHelper {
    FromHelper::Mouse {
        kind,
        x,
        y,
        width: 1920,
        height: 1080,
        at: now(),
    }
}

fn send(core: &Shared<Stdout>, message: &FromHelper) {
    let Ok(bytes) = core_helper::frame(message) else {
        return;
    };
    let mut out = core.lock().unwrap_or_else(|p| p.into_inner());
    if out.write_all(&bytes).and_then(|()| out.flush()).is_err() {
        std::process::exit(0);
    }
}

fn tell(bench: Option<&Shared<TcpStream>>, line: &StandInHelperLine) {
    let Some(bench) = bench else {
        return;
    };
    let mut text = serde_json::to_vec(line).expect("serde_json should write the stand-in's line");
    text.push(b'\n');
    let _ = bench
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .write_all(&text);
}

/// Now, in µs on the performance counter, as the real helper stamps. `clock::now` in
/// src/apps/core and in src/apps/core-helper read it the same way, so change all three together.
fn now() -> u64 {
    let (mut ticks, mut frequency) = (0, 0);
    // SAFETY: each call writes one i64 to the pointer it's given.
    unsafe {
        QueryPerformanceCounter(&mut ticks);
        QueryPerformanceFrequency(&mut frequency);
    }
    (u128::from(ticks.unsigned_abs()) * 1_000_000 / u128::from(frequency.unsigned_abs().max(1)))
        as u64
}
