//! A capture's thread: it looks every 2s for the first running program the capture names,
//! captures its oldest process with its process tree through process loopback, divides the
//! program's level in the Windows mixer back out, and sends 20ms Opus frames above the gate,
//! as FS Copilot's capture does (record/areas/core/04-core-helper.md, "Capturing a program").

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use messages::core_helper::{Capture, FromHelper, WantId};
use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};

use super::gate::{self, Gate};
use super::programs::{self, MixerLevel, Watched};
use crate::clock;
use crate::opus::{self, Encoder};
use crate::pipe::Out;

/// How often the thread looks for the program while none of those named runs.
const LOOK_EVERY: Duration = Duration::from_secs(2);

/// How often it reads the program's level in the mixer again.
const LEVEL_EVERY: Duration = Duration::from_secs(1);

/// The most the mixer's level is divided back out by: +20dB.
const MOST_GAIN: f32 = 10.0;

/// How long the thread waits for audio before it checks on the process again. A loopback
/// whose program has exited delivers silence at −90dBFS with no error, so the thread watches
/// the process itself (FS Copilot fork, record/traffic-atc/docs/01-design.md, "Choosing the
/// ATC app").
const WAIT_MS: u32 = 100;

/// A capture's thread, from the main thread's side, which ends once this drops.
pub struct CaptureThread {
    pub capture: Capture,
    stop: Arc<AtomicBool>,
}

impl CaptureThread {
    pub fn start(number: u16, capture: Capture, out: Out) -> CaptureThread {
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let wanted = capture.clone();
        std::thread::Builder::new()
            .name(format!("capture-{number}"))
            .spawn(move || run(number, &wanted, &out, &stopping))
            .expect("a capture's thread should start");
        CaptureThread { capture, stop }
    }
}

impl Drop for CaptureThread {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn run(number: u16, capture: &Capture, out: &Out, stop: &AtomicBool) {
    let _ = wasapi::initialize_mta();
    let mut reported: Option<Option<String>> = None;
    let mut report = |program: Option<String>| {
        if reported.as_ref() != Some(&program) {
            out.send(FromHelper::Capturing {
                capture: number,
                program: program.clone(),
            });
            reported = Some(program);
        }
    };
    while !stop.load(Ordering::Relaxed) {
        let Some(found) = programs::find_first(&capture.programs) else {
            report(None);
            sleep_unless_stopped(LOOK_EVERY, stop);
            continue;
        };
        let Some(watched) = Watched::open(found.process) else {
            sleep_unless_stopped(LOOK_EVERY, stop);
            continue;
        };
        report(Some(found.name.clone()));
        if let Err(error) = take(number, capture, found.process, &watched, out, stop) {
            out.send(FromHelper::Failed {
                want: WantId::Capture(number),
                error: format!("{} couldn't be captured: {error}", found.name),
            });
            sleep_unless_stopped(LOOK_EVERY, stop);
        }
        // A capture whose programs changed is stopped while its replacement, under the same
        // number, may already have reported its own program, so a stopped thread says
        // nothing more.
        if !stop.load(Ordering::Relaxed) {
            report(None);
        }
    }
}

fn sleep_unless_stopped(how_long: Duration, stop: &AtomicBool) {
    let until = Instant::now() + how_long;
    while Instant::now() < until && !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Captures one process until it exits or the capture stops.
fn take(
    number: u16,
    capture: &Capture,
    process: u32,
    watched: &Watched,
    out: &Out,
    stop: &AtomicBool,
) -> Result<(), String> {
    // Whether WASAPI converts a process-loopback stream to another format is unverified, so
    // the capture asks for the format our probe p02's did, 48 kHz stereo float, which got its
    // program at the level it played, and the thread mixes it to mono (measured on our
    // development machine, 2026-10-08, record/areas/architecture/log.md, "A Rust program
    // captures one process's audio, plays on a device it looks up by name, and receives
    // keyboard and HID input through Raw Input in sink mode, and builds with Visual Studio's
    // linker").
    let format = WaveFormat::new(32, 32, &SampleType::Float, opus::RATE as usize, 2, None);
    let mut client =
        AudioClient::new_application_loopback_client(process, true).map_err(|e| e.to_string())?;
    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 2_000_000,
            },
        )
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let reader = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;
    let mut encoder = Encoder::new(capture.bitrate)?;
    let mut gate: Gate<Vec<f32>> = Gate::new(capture.gate_dbfs, capture.hangover_ms);
    let mut mixer = MixerLevel::new(process);
    let mut gain = 1.0;
    let mut level_read = None::<Instant>;
    let mut pending: Vec<f32> = Vec::with_capacity(opus::FRAME * 4);
    // The stamp of `pending`'s first sample, in µs on the performance counter.
    let mut pending_at = 0;
    let mut packet = vec![0u8; 48_000 * 8];
    while !stop.load(Ordering::Relaxed) && watched.running() {
        if level_read.is_none_or(|t| t.elapsed() >= LEVEL_EVERY) {
            level_read = Some(Instant::now());
            // Windows applies the program's mixer level before the capture, so the thread
            // divides it back out, as FS Copilot measured with a test tone (FS Copilot fork,
            // record/traffic-atc/docs/build/log.md, "Stage 3: the audio path works on one
            // machine").
            gain = mixer.read().map_or(1.0, |level| {
                (1.0 / level.max(1.0 / MOST_GAIN)).min(MOST_GAIN)
            });
        }
        let _ = event.wait_for_event(WAIT_MS);
        loop {
            let (frames, info) = reader
                .read_from_device(&mut packet)
                .map_err(|e| e.to_string())?;
            if frames == 0 {
                break;
            }
            // Each packet's stamp is the counter's value at its first sample, in 100ns units
            // (documented, IAudioCaptureClient::GetBuffer).
            let at = clock::from_wasapi(info.timestamp);
            if pending.is_empty() {
                pending_at = at;
            }
            let bytes = &packet[..frames as usize * 8];
            if info.flags.silent {
                pending.extend(std::iter::repeat_n(0.0, frames as usize));
            } else {
                pending.extend(bytes.chunks_exact(8).map(|f| {
                    let left = f32::from_le_bytes([f[0], f[1], f[2], f[3]]);
                    let right = f32::from_le_bytes([f[4], f[5], f[6], f[7]]);
                    (left + right) / 2.0 * gain
                }));
            }
            // Only a frame that crosses the gate is encoded, so silence costs no encoding,
            // which is most of the helper's CPU while it captures.
            while pending.len() >= opus::FRAME {
                let frame: Vec<f32> = pending.drain(..opus::FRAME).collect();
                let level = gate::level_dbfs(&frame);
                for (frame, at) in gate.frame(level, frame, pending_at) {
                    out.send(FromHelper::Frame {
                        capture: number,
                        opus: encoder.encode(&frame)?,
                        at,
                    });
                }
                pending_at += 20_000;
            }
        }
    }
    let _ = client.stop_stream();
    Ok(())
}
