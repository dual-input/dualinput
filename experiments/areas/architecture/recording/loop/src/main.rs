//! p10's loop: one thread that owns the handlers, their state, and a QuickJS-ng
//! runtime, and takes every input, stamped, from one queue, as 5.1.1's entry in
//! record/areas/architecture/log.md (2026-10-14) has the core do. Edge threads
//! feed it a capture from p10-capture at the pace it was captured, and made-up
//! inputs at the rates a session would bring; slow work runs on a worker and
//! comes back as an input. It records every input, compressed, then replays the
//! recording twice through fresh handlers and compares what each run put out.
//!
//!   p10-loop size <capture>
//!   p10-loop run <capture | --synthetic> <writers.js> <out folder> [minutes]
//!
//! writers.js is p04's bundle of 100 write functions
//! (experiments/areas/architecture/engine/dist/writers.js).

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::fs::File;
use std::hash::{DefaultHasher, Hasher};
use std::io::{BufReader, BufWriter, Read};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use p10_common::*;
use rquickjs::function::Opt;
use rquickjs::{Array, Context, Function, Object, Runtime};

const MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const TIME_LIMIT: Duration = Duration::from_millis(100);
const STACK: usize = 16 * 1024 * 1024;
// SIMCONNECT_RECV_SIMOBJECT_DATA's dwDefineCount and dwData: a 12-byte
// SIMCONNECT_RECV, then seven DWORDs (SimConnect.h).
const DEFINE_COUNT_AT: usize = 36;
const DATA_AT: usize = 40;
const FM_DOUBLES: usize = 21;
const WRITERS: usize = 100;

// ---------------------------------------------------------------- the clock

static BASE: OnceLock<Instant> = OnceLock::new();

fn now_us() -> u64 {
    BASE.get_or_init(Instant::now).elapsed().as_micros() as u64
}

fn sleep_until(us: u64) {
    let now = now_us();
    if us > now {
        std::thread::sleep(Duration::from_micros(us - now));
    }
}

// ---------------------------------------------------------------- made-up bytes

/// xorshift64*, so made-up inputs vary the way real ones do, run after run.
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
}

/// A value that drifts a little each sample, as a gauge or a pose does.
fn drift(v: &mut [f64], noise: &mut Noise) -> Vec<u8> {
    let mut out = vec![];
    for x in v.iter_mut() {
        *x += ((noise.next() % 2001) as f64 - 1000.0) * 1e-5;
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn simobject(request: u32, object: u32, items: u32, data: &[u8]) -> Vec<u8> {
    let mut b = vec![0u8; DATA_AT];
    b[0..4].copy_from_slice(&((DATA_AT + data.len()) as u32).to_le_bytes());
    b[8..12].copy_from_slice(&8u32.to_le_bytes());
    b[12..16].copy_from_slice(&request.to_le_bytes());
    b[16..20].copy_from_slice(&object.to_le_bytes());
    b[DEFINE_COUNT_AT..DATA_AT].copy_from_slice(&items.to_le_bytes());
    b.extend_from_slice(data);
    b
}

// ---------------------------------------------------------------- the edges

struct Edges {
    stop: Arc<AtomicBool>,
    end_us: u64,
}

impl Edges {
    /// Sends one input every `period_us` until the run ends.
    fn periodic(&self, tx: &Sender<Input>, kind: u16, period_us: u64, mut make: impl FnMut(u64) -> Option<Vec<u8>> + Send + 'static) -> JoinHandle<()> {
        let (tx, stop, end) = (tx.clone(), self.stop.clone(), self.end_us);
        std::thread::spawn(move || {
            let mut next = now_us();
            let mut n = 0u64;
            while !stop.load(Ordering::Relaxed) && next < end {
                sleep_until(next);
                if let Some(bytes) = make(n) {
                    if tx.send(Input { us: now_us(), kind, bytes }).is_err() {
                        return;
                    }
                }
                next += period_us;
                n += 1;
            }
        })
    }

    /// The capture, at the pace it was captured, from the top again if the run
    /// outlasts it, each input stamped as it's queued.
    fn capture(&self, tx: &Sender<Input>, inputs: Vec<Input>) -> JoinHandle<()> {
        let (tx, stop, end) = (tx.clone(), self.stop.clone(), self.end_us);
        std::thread::spawn(move || {
            if inputs.is_empty() {
                return;
            }
            let first = inputs.first().map_or(0, |i| i.us);
            let length = inputs.last().map_or(1, |i| i.us - first + 1);
            let start = now_us();
            for cycle in 0.. {
                for i in &inputs {
                    let due = start + cycle * length + (i.us - first);
                    if stop.load(Ordering::Relaxed) || due >= end {
                        return;
                    }
                    sleep_until(due);
                    if tx.send(Input { us: now_us(), kind: i.kind, bytes: i.bytes.clone() }).is_err() {
                        return;
                    }
                }
            }
        })
    }

    /// A stand-in for the sim when there's no capture yet: the flight model and
    /// the camera at 60 fps, 10 profile changes a second, and 60 AI aircraft
    /// every 500ms.
    fn synthetic_sim(&self, tx: &Sender<Input>) -> Vec<JoinHandle<()>> {
        let mut fm = (vec![0.5; FM_DOUBLES], Noise(1));
        let mut cam = (vec![0.0; 8], Noise(2));
        let mut prof = Noise(3);
        let mut traffic = (vec![10.0; 60 * 12], Noise(4));
        let t2 = tx.clone();
        let (stop, end) = (self.stop.clone(), self.end_us);
        vec![
            self.periodic(tx, FM, 16_667, move |_| Some(simobject(1, 1, FM_DOUBLES as u32, &drift(&mut fm.0, &mut fm.1)))),
            self.periodic(tx, CAMERA, 16_667, move |_| Some(drift(&mut cam.0, &mut cam.1))),
            self.periodic(tx, PROFILE, 100_000, move |_| {
                let mut items = vec![];
                for _ in 0..2 {
                    items.extend_from_slice(&((prof.next() % 304) as u32).to_le_bytes());
                    items.extend_from_slice(&((prof.next() % 100) as f64).to_le_bytes());
                }
                Some(simobject(2, 1, 2, &items))
            }),
            std::thread::spawn(move || {
                let mut next = now_us();
                while !stop.load(Ordering::Relaxed) && next < end {
                    sleep_until(next);
                    let all = drift(&mut traffic.0, &mut traffic.1);
                    for (o, chunk) in all.chunks(12 * 8).enumerate() {
                        let _ = t2.send(Input { us: now_us(), kind: TRAFFIC_AIR, bytes: simobject(3, 100 + o as u32, 12, chunk) });
                    }
                    next += 500_000;
                }
            }),
        ]
    }

    /// The other pilot's core, the panels, the helper, timers, and a worker.
    fn session(&self, tx: &Sender<Input>) -> Vec<JoinHandle<()>> {
        let mut cockpit = Noise(10);
        let mut avatar = (vec![0.0; 15], Noise(11));
        let mut atc = Noise(12);
        let mut cursor = (vec![0.0; 2], Noise(13));
        let t2 = tx.clone();
        let (stop, end) = (self.stop.clone(), self.end_us);
        vec![
            // A cockpit change, 2.2's 84 bytes, about: an entry, a value, and a
            // vector clock naming two pilots by ID and restart count.
            self.periodic(tx, NET_COCKPIT, 50_000, move |_| {
                let mut b = ((cockpit.next() % 304) as u32).to_le_bytes().to_vec();
                b.extend_from_slice(&((cockpit.next() % 100) as f64).to_le_bytes());
                b.extend_from_slice(&cockpit.bytes(72));
                Some(b)
            }),
            self.periodic(tx, NET_AVATAR, 33_333, move |_| Some(drift(&mut avatar.0, &mut avatar.1))),
            self.periodic(tx, NET_HEARTBEAT, 1_000_000, |n| Some([n.to_le_bytes().to_vec(), vec![0u8; 56]].concat())),
            // 20 panels, each with its message every 2s.
            self.periodic(tx, PANEL, 100_000, |n| Some([((n % 20) as u32).to_le_bytes().to_vec(), vec![0u8; 44]].concat())),
            // A 20ms Opus frame at 24 kbps is 60 bytes (FS Copilot fork,
            // record/traffic-atc/docs/04-transport.md, "The MTU floor"); coded
            // audio is noise to a compressor.
            self.periodic(tx, HELPER_ATC, 20_000, move |_| Some(atc.bytes(64))),
            // A drag, 60 cursor positions a second for 2s, every 20s.
            self.periodic(tx, HELPER_CURSOR, 16_667, move |n| if n % 1200 < 120 { Some(drift(&mut cursor.0, &mut cursor.1)) } else { None }),
            self.periodic(tx, TIMER_SLOT, 200_000, |n| Some(n.to_le_bytes().to_vec())),
            self.periodic(tx, TIMER_STALL, 60_000_000, |n| if n > 0 { Some(vec![]) } else { None }),
            // A profile fetch or a model load: 150ms on a worker, then its result.
            std::thread::spawn(move || {
                let mut next = now_us() + 30_000_000;
                let mut noise = Noise(14);
                while !stop.load(Ordering::Relaxed) && next < end {
                    sleep_until(next);
                    std::thread::sleep(Duration::from_millis(150));
                    let _ = t2.send(Input { us: now_us(), kind: JOB_RESULT, bytes: noise.bytes(1024) });
                    next += 30_000_000;
                }
            }),
        ]
    }
}

// ---------------------------------------------------------------- the handlers

#[derive(Default)]
struct Out {
    hash: DefaultHasher,
    count: u64,
}

impl Out {
    fn emit(&mut self, tag: u16, data: &[u8]) {
        self.hash.write_u16(tag);
        self.hash.write(data);
        self.count += 1;
    }
}

/// What a core would do with each input, in cost if not in meaning. Nothing in
/// it reads a clock but the time limit, iterates a hash map, or does I/O, so the
/// same inputs give the same outputs.
struct Core {
    _rt: Runtime,
    ctx: Context,
    out: Rc<RefCell<Out>>,
    deadline: Rc<Cell<Option<Instant>>>,
    state: BTreeMap<u32, f64>,
    frames: u64,
    errors: u64,
}

impl Core {
    fn new(writers_js: &str) -> Core {
        let rt = Runtime::new().unwrap();
        rt.set_memory_limit(MEMORY_LIMIT);
        let deadline: Rc<Cell<Option<Instant>>> = Default::default();
        let d = deadline.clone();
        rt.set_interrupt_handler(Some(Box::new(move || d.get().is_some_and(|t| Instant::now() >= t))));
        let ctx = Context::full(&rt).unwrap();
        let out: Rc<RefCell<Out>> = Default::default();
        ctx.with(|ctx| {
            let writer = Object::new(ctx.clone()).unwrap();
            let o = out.clone();
            let k = Function::new(ctx.clone(), move |name: String, a: Opt<f64>, b: Opt<f64>| {
                let mut v = name.into_bytes();
                for x in [a.0, b.0].into_iter().flatten() {
                    v.extend_from_slice(&x.to_le_bytes());
                }
                o.borrow_mut().emit(1, &v);
            })
            .unwrap();
            writer.set("k", k).unwrap();
            let o = out.clone();
            let l = Function::new(ctx.clone(), move |name: String, v: f64, _unit: String| o.borrow_mut().emit(2, &[name.into_bytes(), v.to_le_bytes().to_vec()].concat())).unwrap();
            writer.set("l", l).unwrap();
            let o = out.clone();
            let b = Function::new(ctx.clone(), move |name: String, v: f64| o.borrow_mut().emit(3, &[name.into_bytes(), v.to_le_bytes().to_vec()].concat())).unwrap();
            writer.set("b", b).unwrap();
            let o = out.clone();
            let h = Function::new(ctx.clone(), move |name: String| o.borrow_mut().emit(4, name.as_bytes())).unwrap();
            writer.set("h", h).unwrap();
            ctx.globals().set("__writer", writer).unwrap();
            ctx.eval::<(), _>(writers_js).expect("evaluate writers.js");
            ctx.eval::<(), _>("globalThis.__writers = Object.keys(writersBundle).sort().map((k) => writersBundle[k]); globalThis.__stall = () => { for (;;) {} }").unwrap();
        });
        Core { _rt: rt, ctx, out, deadline, state: BTreeMap::new(), frames: 0, errors: 0 }
    }

    fn write(&mut self, values: &[(usize, f64)]) {
        let errors = self.ctx.with(|ctx| {
            let writers: Array = ctx.globals().get("__writers").unwrap();
            let writer: Object = ctx.globals().get("__writer").unwrap();
            let mut errors = 0;
            for &(i, v) in values {
                let f: Function = writers.get(i % WRITERS).unwrap();
                self.deadline.set(Some(Instant::now() + TIME_LIMIT));
                if f.call::<_, ()>((v, writer.clone())).is_err() {
                    errors += 1;
                }
                self.deadline.set(None);
            }
            errors
        });
        self.errors += errors;
    }

    fn handle(&mut self, input: &Input) {
        let b = &input.bytes;
        match input.kind {
            // Every sim frame: a flight-model sample out every third frame, about
            // 20 a second, and the 100 write functions, as many as any one frame
            // could ask for.
            FM => {
                self.frames += 1;
                let values: Vec<f64> = b.get(DATA_AT..).unwrap_or(&[]).chunks_exact(8).take(FM_DOUBLES).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect();
                if self.frames % 3 == 0 {
                    self.out.borrow_mut().emit(FM, &b[DATA_AT.min(b.len())..]);
                }
                if !values.is_empty() {
                    let calls: Vec<(usize, f64)> = (0..WRITERS).map(|i| (i, (values[i % values.len()].abs() * 1000.0) % 100.0)).collect();
                    self.write(&calls);
                }
            }
            // Tagged: a datum ID and a value for each entry that changed, each a
            // change to send to the crew.
            PROFILE => {
                let items = b.get(DATA_AT..).unwrap_or(&[]);
                for c in items.chunks_exact(12) {
                    let id = u32::from_le_bytes(c[0..4].try_into().unwrap());
                    let v = f64::from_le_bytes(c[4..12].try_into().unwrap());
                    self.state.insert(id, v);
                    self.out.borrow_mut().emit(PROFILE, c);
                }
            }
            // A change from the other pilot, written through its entry's function.
            NET_COCKPIT if b.len() >= 12 => {
                let i = u32::from_le_bytes(b[0..4].try_into().unwrap()) as usize;
                let v = f64::from_le_bytes(b[4..12].try_into().unwrap());
                self.write(&[(i, v)]);
            }
            TIMER_SLOT => self.out.borrow_mut().emit(TIMER_SLOT, &input.us.to_le_bytes()),
            // A plugin call that never returns, stopped at the time limit. What it
            // puts out doesn't turn on where the limit stopped it.
            TIMER_STALL => {
                let stopped = self.ctx.with(|ctx| {
                    let f: Function = ctx.globals().get("__stall").unwrap();
                    self.deadline.set(Some(Instant::now() + TIME_LIMIT));
                    let r = f.call::<_, ()>(());
                    self.deadline.set(None);
                    r.is_err()
                });
                self.out.borrow_mut().emit(TIMER_STALL, &[stopped as u8]);
            }
            NET_HEARTBEAT | PANEL | HELPER_CURSOR => {
                self.state.insert(1_000_000 + input.kind as u32, b.len() as f64);
            }
            kind => self.out.borrow_mut().emit(kind, b),
        }
    }

    fn result(&self) -> (u64, u64) {
        let o = self.out.borrow();
        (o.hash.finish(), o.count)
    }
}

// ---------------------------------------------------------------- figures

fn pct(sorted: &[u32], p: f64) -> u32 {
    if sorted.is_empty() {
        return 0;
    }
    let i = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len()) - 1;
    sorted[i]
}

fn mb(bytes: u64) -> f64 {
    bytes as f64 / 1e6
}

fn zstd_size(data: &[u8], level: i32) -> u64 {
    zstd::encode_all(data, level).unwrap().len() as u64
}

// ---------------------------------------------------------------- size

fn size(path: &str) {
    let raw = std::fs::read(path).expect("read the capture");
    let inputs = read_all(&mut &raw[..]).expect("parse the capture");
    let secs = match (inputs.first(), inputs.last()) {
        (Some(a), Some(z)) => (z.us - a.us) as f64 / 1e6,
        _ => 0.0,
    };
    let hours = secs / 3600.0;
    println!("CAPTURE\t{secs:.1} s\t{} inputs\t{:.2} MB raw", inputs.len(), mb(raw.len() as u64));
    let mut by: BTreeMap<u16, (u64, u64)> = BTreeMap::new();
    for i in &inputs {
        let e = by.entry(i.kind).or_default();
        e.0 += 1;
        e.1 += (HEADER + i.bytes.len()) as u64;
    }
    for (kind, (n, bytes)) in &by {
        println!("KIND\t{}\t{n}\t{:.1} a second\t{:.2} MB raw\t{:.1} MB an hour raw", kind_name(*kind), *n as f64 / secs, mb(*bytes), mb(*bytes) / hours);
    }
    for level in [3, 19] {
        let z = zstd_size(&raw, level);
        println!("ZSTD\tlevel {level}\t{:.2} MB\t{:.1} MB an hour\t{:.1}x", mb(z), mb(z) / hours, raw.len() as f64 / z as f64);
    }
}

// ---------------------------------------------------------------- run

struct Stats {
    lat: BTreeMap<u16, Vec<u32>>,
    took: BTreeMap<u16, (u64, u64)>,
    busy_us: u64,
    secs: f64,
    hash: u64,
    outputs: u64,
    errors: u64,
}

fn run_live(sim: Option<Vec<Input>>, writers_js: String, record_path: String, minutes: f64) -> (Stats, u64, u64) {
    let (tx, rx) = mpsc::channel::<Input>();
    let (rec_tx, rec_rx) = mpsc::channel::<Input>();

    let recorder = std::thread::spawn(move || {
        let file = BufWriter::new(File::create(&record_path).expect("create the recording"));
        let mut z = zstd::stream::write::Encoder::new(file, 3).unwrap();
        let mut raw = 0u64;
        for i in rec_rx {
            raw += write_input(&mut z, &i).unwrap() as u64;
        }
        z.finish().unwrap();
        (raw, std::fs::metadata(&record_path).unwrap().len())
    });

    let core = std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let mut core = Core::new(&writers_js);
            let start = now_us();
            let end = start + (minutes * 60e6) as u64;
            let edges = Edges { stop: Arc::new(AtomicBool::new(false)), end_us: end };
            let mut threads = match sim {
                Some(inputs) => vec![edges.capture(&tx, inputs)],
                None => edges.synthetic_sim(&tx),
            };
            threads.extend(edges.session(&tx));
            drop(tx);

            let mut lat: BTreeMap<u16, Vec<u32>> = BTreeMap::new();
            let mut took: BTreeMap<u16, (u64, u64)> = BTreeMap::new();
            let mut busy_us = 0u64;
            loop {
                let input = match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(i) => i,
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                let taken = now_us();
                lat.entry(input.kind).or_default().push(taken.saturating_sub(input.us) as u32);
                let _ = rec_tx.send(input.clone());
                core.handle(&input);
                let done = now_us();
                busy_us += done - taken;
                let t = took.entry(input.kind).or_default();
                t.0 += done - taken;
                t.1 = t.1.max(done - taken);
            }
            edges.stop.store(true, Ordering::Relaxed);
            for t in threads {
                let _ = t.join();
            }
            let secs = (now_us() - start) as f64 / 1e6;
            let (hash, outputs) = core.result();
            Stats { lat, took, busy_us, secs, hash, outputs, errors: core.errors }
        })
        .unwrap();
    let stats = core.join().expect("the loop panicked");
    let (raw, zstd) = recorder.join().unwrap();
    (stats, raw, zstd)
}

fn replay(record_path: &str, writers_js: &str) -> (f64, u64, u64, u64, f64) {
    let file = BufReader::new(File::open(record_path).unwrap());
    let mut dec = zstd::stream::read::Decoder::new(file).unwrap();
    let mut raw = vec![];
    dec.read_to_end(&mut raw).unwrap();
    let inputs = read_all(&mut &raw[..]).unwrap();
    let span = match (inputs.first(), inputs.last()) {
        (Some(a), Some(z)) => (z.us - a.us) as f64 / 1e6,
        _ => 0.0,
    };
    let js = writers_js.to_string();
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let mut core = Core::new(&js);
            let t = Instant::now();
            for i in &inputs {
                core.handle(i);
            }
            let secs = t.elapsed().as_secs_f64();
            let (hash, outputs) = core.result();
            (secs, hash, outputs, inputs.len() as u64, span)
        })
        .unwrap()
        .join()
        .unwrap()
}

fn run(source: &str, writers: &str, folder: &str, minutes: f64) {
    let writers_js = std::fs::read_to_string(writers).expect("read writers.js");
    let sim = if source == "--synthetic" {
        None
    } else {
        let raw = std::fs::read(source).expect("read the capture");
        Some(read_all(&mut &raw[..]).expect("parse the capture"))
    };
    std::fs::create_dir_all(folder).unwrap();
    let record_path = format!("{folder}/p10-loop-recording.bin.zst");
    let (s, raw, zstd) = run_live(sim, writers_js.clone(), record_path.clone(), minutes);

    let all: Vec<u32> = {
        let mut v: Vec<u32> = s.lat.values().flatten().copied().collect();
        v.sort_unstable();
        v
    };
    let hours = s.secs / 3600.0;
    println!("RUN\t{:.1} s\t{} inputs\t{:.0} a second\tbusy {:.1}%\t{} outputs\t{} write errors", s.secs, all.len(), all.len() as f64 / s.secs, s.busy_us as f64 / (s.secs * 1e6) * 100.0, s.outputs, s.errors);
    println!("LATENCY\tall\tp50 {} us\tp99 {} us\tp99.9 {} us\tmax {} us", pct(&all, 0.5), pct(&all, 0.99), pct(&all, 0.999), all.last().copied().unwrap_or(0));
    for (kind, v) in &s.lat {
        let mut v = v.clone();
        v.sort_unstable();
        let (total, max) = s.took[kind];
        println!(
            "KIND\t{}\t{} inputs\t{:.1} a second\tqueue p50 {} us\tp99 {} us\tmax {} us\thandled in {:.1} us on average, {} us at most",
            kind_name(*kind),
            v.len(),
            v.len() as f64 / s.secs,
            pct(&v, 0.5),
            pct(&v, 0.99),
            v.last().copied().unwrap_or(0),
            total as f64 / v.len() as f64,
            max
        );
    }
    println!("RECORDING\t{:.2} MB raw\t{:.2} MB with zstd at level 3\t{:.1} MB an hour raw\t{:.1} MB an hour compressed", mb(raw), mb(zstd), mb(raw) / hours, mb(zstd) / hours);
    println!("LIVE\thash {:016x}\t{} outputs", s.hash, s.outputs);
    for n in 1..=2 {
        let (secs, hash, outputs, inputs, span) = replay(&record_path, &writers_js);
        println!(
            "REPLAY\t{n}\t{} inputs in {secs:.1} s, {:.0}x the recording's {span:.0} s\thash {hash:016x}\t{outputs} outputs\t{}",
            inputs,
            span / secs,
            if hash == s.hash && outputs == s.outputs { "matches the live run" } else { "DIFFERS from the live run" }
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        [_, "size", capture] => size(capture),
        [_, "run", source, writers, folder] => run(source, writers, folder, 10.0),
        [_, "run", source, writers, folder, minutes] => run(source, writers, folder, minutes.parse().expect("minutes")),
        _ => {
            eprintln!("usage: p10-loop size <capture>\n       p10-loop run <capture | --synthetic> <writers.js> <out folder> [minutes]");
            std::process::exit(2);
        }
    }
}
