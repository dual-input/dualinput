//! The bench's socket: TCP on 127.0.0.1, at a port Windows picks, which the core writes to
//! `bench-port` in its data folder, so the bench finds a core whichever program started it.
//! Each line is a message of `messages::bench` as JSON, and the core's first is its version
//! and hash (record/areas/build/02-testing.md, "Its place").

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use messages::bench::{Called, FromCore, Hello, Signal as BenchSignal, StandInAct, ToCore};
use stand_in_sim::{Act, Signal, StandIn};

use super::module::BenchModule;
use super::{Sources, ToBench, playback};
use crate::queue::Queue;
use crate::run_context::{self, Context};

pub fn start(
    data: &Path,
    queue: Arc<Queue>,
    sources: Sources,
    stand_in: Option<StandIn>,
    to_bench: ToBench,
    context: Arc<Context>,
) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    // Written whole, then renamed, so the bench never reads half a port.
    let new = data.join("bench-port.new");
    std::fs::write(&new, port.to_string())?;
    std::fs::rename(&new, data.join("bench-port"))?;
    tracing::info!(port, "the bench's socket is listening");
    let bench = Bench {
        queue,
        sources,
        stand_in,
        to_bench,
        context,
    };
    std::thread::Builder::new()
        .name("bench-socket".into())
        .spawn(move || {
            run_context::enter(bench.context.clone());
            // One bench at a time, and the next once it hangs up.
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => bench.serve(stream),
                    Err(error) => tracing::warn!(%error, "the bench couldn't connect"),
                }
            }
        })?;
    Ok(())
}

struct Bench {
    queue: Arc<Queue>,
    sources: Sources,
    stand_in: Option<StandIn>,
    to_bench: ToBench,
    context: Arc<Context>,
}

impl Bench {
    fn serve(&self, stream: TcpStream) {
        let hello = Hello {
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
        };
        let mut hello = serde_json::to_vec(&hello).expect("serde_json should write the hello");
        hello.push(b'\n');
        if (&stream).write_all(&hello).is_err() {
            return;
        }
        if let Ok(writer) = stream.try_clone() {
            *self
                .to_bench
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(writer);
        }
        for line in BufReader::new(&stream).split(b'\n') {
            let Ok(mut line) = line else {
                return;
            };
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            match serde_json::from_slice(&line) {
                // A load is the bench acting on the core's surroundings, which then send
                // their inputs, so it starts the playback rather than reaching the loop.
                Ok(ToCore::Load { capture, plays }) => playback::play(
                    PathBuf::from(capture),
                    plays,
                    self.queue.clone(),
                    self.sources.load,
                    self.context.clone(),
                ),
                // So is anything done to the sim, which the stand-in's thread carries out.
                Ok(ToCore::StandIn { act }) => self.stand_in(act),
                Ok(ToCore::Sim { .. }) => self.queue.push(self.sources.sim, line),
                Ok(ToCore::Clients { .. }) => self.queue.push(self.sources.clients, line),
                Ok(_) => self.queue.push(self.sources.lines, line),
                Err(error) => {
                    tracing::warn!(%error, "a line from the bench isn't one of its messages")
                }
            }
        }
    }

    fn stand_in(&self, act: StandInAct) {
        let Some(stand_in) = &self.stand_in else {
            tracing::warn!("a line for the stand-in came to a core without a sim service");
            return;
        };
        let unit = |name: &str| self.sources.units.iter().position(|u| *u == name);
        let act = match act {
            StandInAct::Watch { process } => Act::Watch { process },
            StandInAct::Lose { unit: name } => match unit(&name) {
                Some(place) => Act::Lose { unit: place as u32 },
                None => return tracing::warn!(name, "the bench named no unit of the core's"),
            },
            StandInAct::Quit => Act::Quit,
            StandInAct::Play { signals } => Act::Play(
                signals
                    .into_iter()
                    .map(|played| {
                        let signal = match played.signal {
                            BenchSignal::AircraftLoaded { path } => Signal::AircraftLoaded(path),
                            BenchSignal::FlightLoaded { path } => Signal::FlightLoaded(path),
                            BenchSignal::Flow { event } => Signal::Flow(event),
                            BenchSignal::Pause { flags } => Signal::Pause(flags),
                        };
                        (played.after_ms, signal)
                    })
                    .collect(),
            ),
            StandInAct::Reject { name } => Act::Reject { name },
            StandInAct::OpenReply { delay_ms } => Act::OpenReply {
                delay: Duration::from_millis(delay_ms),
            },
            StandInAct::Frames { per_second } => Act::Frames { per_second },
            StandInAct::StopModule => Act::StopModule,
            StandInAct::ModuleFrom { slots_hash } => {
                match u64::from_str_radix(slots_hash.trim_start_matches("0x"), 16) {
                    Ok(hash) => Act::Module(Box::new(BenchModule::new(hash))),
                    Err(_) => return tracing::warn!(slots_hash, "a slots hash that isn't hex"),
                }
            }
            StandInAct::Stale { unit: name } => match unit(&name) {
                Some(place) => Act::Stale { unit: place as u32 },
                None => return tracing::warn!(name, "the bench named no unit of the core's"),
            },
            StandInAct::Report => {
                let Some(report) = stand_in.report() else {
                    return tracing::warn!("the stand-in's thread has ended");
                };
                let calls = report
                    .calls
                    .into_iter()
                    .map(|called| {
                        let arguments = format!("{:?}", called.op);
                        let function = arguments
                            .split([' ', '{'])
                            .next()
                            .unwrap_or_default()
                            .to_string();
                        Called {
                            unit: called.connection.unit,
                            open: called.connection.open,
                            function,
                            arguments,
                            before_open_reply: called.before_open_reply,
                        }
                    })
                    .collect();
                self.to_bench.send(&FromCore::StandIn {
                    opens: report.opened.iter().map(|c| (c.unit, c.open)).collect(),
                    calls,
                    variables: report.variables,
                    module_stopped: report.module_stopped,
                });
                return;
            }
        };
        stand_in.act(act);
    }
}
