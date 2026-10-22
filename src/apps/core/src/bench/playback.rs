//! The playback that feeds the load unit, on a thread of its own as an edge's: a flight's
//! capture at the pace it was captured, and a session's other inputs beside it at p10's
//! rates (record/areas/build/02-testing.md, "The loop under load").

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::fs::File;
use std::io::Read;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use kernel::SourceId;

use super::load::{
    ATC, CURSOR, END, LINK_AVATAR, LINK_COCKPIT, LINK_HEARTBEAT, PANEL, START, input,
};
use crate::clock;
use crate::queue::Queue;
use crate::run_context::{self, Context};

/// Starts the thread that plays the capture at `path`, `plays` times over, with a session's
/// made-up inputs beside it, each pushed when its time comes, as an edge pushes what it
/// hears, and then the input that ends the run.
pub fn play(path: PathBuf, plays: u32, queue: Arc<Queue>, source: SourceId, context: Arc<Context>) {
    let started = std::thread::Builder::new()
        .name("bench-playback".into())
        .spawn(move || {
            run_context::enter(context);
            match Capture::read(&path) {
                Ok(capture) => {
                    tracing::info!(
                        records = capture.records.len(),
                        plays,
                        "the playback started"
                    );
                    playback(capture, plays, &queue, source);
                    tracing::info!("the playback ended");
                }
                Err(error) => {
                    tracing::error!(%error, path = %path.display(), "the playback couldn't read its capture");
                }
            }
        });
    if let Err(error) = started {
        tracing::error!(%error, "the playback's thread didn't start");
    }
}

/// A capture of a flight's inputs, in the format tools/bench/fixtures/README.md gives.
struct Capture {
    bytes: Vec<u8>,
    /// Each record's time in µs from the capture's first, its kind, and where its bytes are.
    records: Vec<(u64, u16, Range<usize>)>,
}

impl Capture {
    fn read(path: &Path) -> std::io::Result<Capture> {
        let mut bytes = Vec::new();
        zstd::stream::read::Decoder::new(File::open(path)?)?.read_to_end(&mut bytes)?;
        let mut records = Vec::new();
        let mut first = None;
        let mut at = 0;
        while at < bytes.len() {
            let head = bytes
                .get(at..at + 14)
                .ok_or_else(|| cut("a record's head"))?;
            let us = u64::from_le_bytes(head[0..8].try_into().expect("8 bytes"));
            let kind = u16::from_le_bytes(head[8..10].try_into().expect("2 bytes"));
            let length = u32::from_le_bytes(head[10..14].try_into().expect("4 bytes")) as usize;
            let range = at + 14..at + 14 + length;
            if range.end > bytes.len() {
                return Err(cut("a record's bytes"));
            }
            let first = *first.get_or_insert(us);
            records.push((us.saturating_sub(first), kind, range.clone()));
            at = range.end;
        }
        Ok(Capture { bytes, records })
    }

    /// From the first record's time to just past the last's.
    fn length(&self) -> u64 {
        self.records.last().map_or(0, |(us, ..)| us + 1)
    }
}

fn cut(inside: &str) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("the capture ends inside {inside}"),
    )
}

/// Inputs due at times of their own, in µs from the playback's start.
trait Stream: Send {
    /// When the next input is due, if there is one.
    fn due(&self) -> Option<u64>;
    /// The next input, or `None` when it's due but makes none, as a cursor between drags.
    fn take(&mut self) -> Option<Vec<u8>>;
}

/// The capture, from the top again each play.
struct Played {
    capture: Capture,
    next: usize,
    play: u64,
}

impl Stream for Played {
    fn due(&self) -> Option<u64> {
        let (us, ..) = self.capture.records.get(self.next)?;
        Some(self.play * self.capture.length() + us)
    }

    fn take(&mut self) -> Option<Vec<u8>> {
        let (_, kind, range) = self.capture.records.get(self.next)?.clone();
        self.next += 1;
        if self.next == self.capture.records.len() {
            self.next = 0;
            self.play += 1;
        }
        Some(input(kind, &self.capture.bytes[range]))
    }
}

/// One input of `kind` every `period` µs, made by `make` from its count.
struct Periodic {
    kind: u16,
    period: u64,
    n: u64,
    make: Box<dyn FnMut(u64) -> Option<Vec<u8>> + Send>,
}

impl Stream for Periodic {
    fn due(&self) -> Option<u64> {
        Some(self.n * self.period)
    }

    fn take(&mut self) -> Option<Vec<u8>> {
        self.n += 1;
        (self.make)(self.n - 1).map(|bytes| input(self.kind, &bytes))
    }
}

fn periodic(
    kind: u16,
    period: u64,
    make: impl FnMut(u64) -> Option<Vec<u8>> + Send + 'static,
) -> Box<dyn Stream> {
    Box::new(Periodic {
        kind,
        period,
        n: 0,
        make: Box::new(make),
    })
}

/// xorshift64*, so made-up inputs vary the way real ones do: a compressor can't shrink
/// coded audio, and gains little on a pose.
struct Noise(u64);

impl Noise {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn bytes(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.next() as u8).collect()
    }

    /// Values that move a little each time, as a pose or a cursor does.
    fn drift(&mut self, values: &mut [f64]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(values.len() * 8);
        for value in values {
            *value += ((self.next() % 2001) as f64 - 1000.0) * 1e-5;
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }
}

/// p10's made-up inputs of a session, with the link's raised to 140 a second, where p10's
/// added up to 51: the network's budget for one link.
fn session() -> Vec<Box<dyn Stream>> {
    let (mut cockpit, mut atc) = (Noise(10), Noise(12));
    let (mut avatar, mut pose) = (Noise(11), [0.0; 15]);
    let (mut cursor, mut at) = (Noise(13), [0.0; 2]);
    vec![
        // A cockpit change: an entry, a value, and a vector clock naming two pilots, about
        // 84 bytes, 109 a second.
        periodic(LINK_COCKPIT, 9_174, move |_| {
            let mut bytes = ((cockpit.next() % 304) as u32).to_le_bytes().to_vec();
            bytes.extend_from_slice(&((cockpit.next() % 100) as f64).to_le_bytes());
            bytes.extend_from_slice(&cockpit.bytes(72));
            Some(bytes)
        }),
        periodic(LINK_AVATAR, 33_333, move |_| Some(avatar.drift(&mut pose))),
        periodic(LINK_HEARTBEAT, 1_000_000, |n| {
            Some([n.to_le_bytes().to_vec(), vec![0; 56]].concat())
        }),
        // 20 panels, each with a message every 2s.
        periodic(PANEL, 100_000, |n| {
            Some([((n % 20) as u32).to_le_bytes().to_vec(), vec![0; 44]].concat())
        }),
        // A 20ms frame of coded ATC audio.
        periodic(ATC, 20_000, move |_| Some(atc.bytes(64))),
        // A drag, 60 cursor positions a second for 2s, every 20s.
        periodic(CURSOR, 16_667, move |n| {
            (n % 1_200 < 120).then(|| cursor.drift(&mut at))
        }),
    ]
}

fn playback(capture: Capture, plays: u32, queue: &Queue, source: SourceId) {
    let until = capture.length() * u64::from(plays);
    let mut streams = session();
    streams.push(Box::new(Played {
        capture,
        next: 0,
        play: 0,
    }));
    let mut due: BinaryHeap<Reverse<(u64, usize)>> = streams
        .iter()
        .enumerate()
        .filter_map(|(i, stream)| stream.due().map(|at| Reverse((at, i))))
        .collect();
    let start = clock::now();
    queue.push(source, input(START, &[]));
    while let Some(Reverse((at, i))) = due.pop() {
        if at >= until {
            break;
        }
        let now = clock::now();
        if start + at > now {
            std::thread::sleep(Duration::from_micros(start + at - now));
        }
        if let Some(bytes) = streams[i].take() {
            queue.push(source, bytes);
        }
        if let Some(next) = streams[i].due() {
            due.push(Reverse((next, i)));
        }
    }
    queue.push(source, input(END, &[]));
}
