//! The output thread: one shared-mode WASAPI stream on the output device, at 48 kHz mono,
//! with WASAPI converting to the device's own format, into which it mixes every playback
//! stream and sound playing. It opens the stream again on the new device when Windows'
//! default changes, plays on the default while the picked device is missing, and moves back
//! when it returns (record/areas/core/04-core-helper.md, "The devices" and "Playing").

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use messages::core_helper::{Buffer, DeviceInfo, FromHelper, WantId};
use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

use super::devices::{self, DeviceChange};
use super::jitter::{Jitter, Turn};
use crate::clock;
use crate::opus::{self, Decoder};
use crate::pipe::Out;

/// The device's buffer, in 100ns units: 40ms, room for two of our frames.
const BUFFER: i64 = 400_000;

/// How long the thread waits for the device before it checks its commands again.
const WAIT_MS: u32 = 20;

/// How often it tries again to open a device after none would open.
const RETRY: Duration = Duration::from_secs(2);

pub enum Command {
    Streams(Vec<(u16, Buffer)>),
    Device(Option<DeviceInfo>),
    Play(Arc<[f32]>),
    Frame {
        stream: u16,
        number: u32,
        at: u64,
        opus: Vec<u8>,
        arrived: u64,
    },
    Changed(DeviceChange),
    Stop,
}

/// The output thread, from the main thread's side.
pub struct Output {
    commands: mpsc::Sender<Command>,
}

impl Output {
    pub fn start(out: Out, picked: Option<DeviceInfo>, streams: Vec<(u16, Buffer)>) -> Output {
        let (commands, received) = mpsc::channel();
        let changes = commands.clone();
        std::thread::Builder::new()
            .name("output".into())
            .spawn(move || run(out, picked, streams, received, changes))
            .expect("the output thread should start");
        Output { commands }
    }

    pub fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
    }
}

/// One playback stream: its buffer, its decoder, and its decoded samples still to play.
struct Player {
    jitter: Jitter,
    decoder: Option<Decoder>,
    samples: VecDeque<f32>,
    gain: f32,
}

#[derive(Default)]
struct Mixer {
    streams: BTreeMap<u16, Player>,
    sounds: Vec<(Arc<[f32]>, usize)>,
}

impl Mixer {
    fn set_streams(&mut self, streams: Vec<(u16, Buffer)>) {
        self.streams
            .retain(|id, _| streams.iter().any(|(s, _)| s == id));
        for (id, rule) in streams {
            let gain = rule.gain.clamp(0.0, 1.0);
            match self.streams.get_mut(&id) {
                Some(player) => player.gain = gain,
                None => {
                    self.streams.insert(
                        id,
                        Player {
                            jitter: Jitter::new(rule),
                            decoder: Decoder::new(1).ok(),
                            samples: VecDeque::new(),
                            gain,
                        },
                    );
                }
            }
        }
    }

    /// The next `n` samples of every stream and sound, mixed.
    fn mix(&mut self, n: usize, out: &Out) -> Vec<f32> {
        let mut mixed = vec![0.0f32; n];
        let now = clock::now();
        for (&id, player) in &mut self.streams {
            while player.samples.len() < n {
                // The frame that's due once the samples already decoded have played.
                let ahead = player.samples.len() as u64 * 1_000_000 / u64::from(opus::RATE);
                let Some(turn) = player.jitter.pull(now + ahead) else {
                    break;
                };
                let decoded = match (turn, player.decoder.as_mut()) {
                    (Turn::Play(packet), Some(decoder)) => decoder
                        .decode(&packet, 1)
                        .unwrap_or_else(|_| decoder.conceal()),
                    (Turn::Conceal, Some(decoder)) => decoder.conceal(),
                    (Turn::End(report), _) => {
                        out.send(FromHelper::Played {
                            stream: id,
                            played: report.played,
                            concealed: report.concealed,
                            late: report.late,
                            depth_ms: report.depth_ms,
                        });
                        continue;
                    }
                    (_, None) => vec![0.0; opus::FRAME],
                };
                player.samples.extend(decoded);
            }
            for (m, s) in mixed
                .iter_mut()
                .zip(player.samples.drain(..n.min(player.samples.len())))
            {
                *m += s * player.gain;
            }
        }
        for (sound, at) in &mut self.sounds {
            let rest = &sound[(*at).min(sound.len())..];
            for (m, s) in mixed.iter_mut().zip(rest) {
                *m += s;
            }
            *at += n;
        }
        self.sounds.retain(|(sound, at)| *at < sound.len());
        for m in &mut mixed {
            *m = m.clamp(-1.0, 1.0);
        }
        mixed
    }
}

/// What ended a device's stream.
enum Ended {
    Stop,
    /// Open a device again: the picked one changed, Windows' default changed, the device
    /// went, or the picked one came back.
    Reopen,
}

fn run(
    out: Out,
    mut picked: Option<DeviceInfo>,
    streams: Vec<(u16, Buffer)>,
    commands: mpsc::Receiver<Command>,
    changes: mpsc::Sender<Command>,
) {
    let _ = wasapi::initialize_mta();
    let Ok(enumerator) = DeviceEnumerator::new() else {
        out.send(FromHelper::Failed {
            want: WantId::Output,
            error: "Windows' audio devices couldn't be listed".into(),
        });
        return;
    };
    let (device_changes, from_windows) = mpsc::channel();
    let _registration = devices::watch(&enumerator, device_changes);
    std::thread::Builder::new()
        .name("device-changes".into())
        .spawn(move || {
            for change in from_windows {
                if changes.send(Command::Changed(change)).is_err() {
                    break;
                }
            }
        })
        .expect("the device changes' thread should start");
    let mut mixer = Mixer::default();
    mixer.set_streams(streams);
    loop {
        let ended = match devices::pick(&enumerator, picked.as_ref()) {
            Ok((device, on_picked)) => {
                let info = devices::info(&device).ok();
                out.send(FromHelper::InUse { output: info });
                play(
                    &device,
                    on_picked,
                    &mut picked,
                    &enumerator,
                    &mut mixer,
                    &commands,
                    &out,
                )
            }
            Err(error) => {
                out.send(FromHelper::InUse { output: None });
                out.send(FromHelper::Failed {
                    want: WantId::Output,
                    error,
                });
                wait(&mut picked, &mut mixer, &commands, RETRY)
            }
        };
        if let Ended::Stop = ended {
            return;
        }
    }
}

/// Plays on `device` until something ends its stream.
fn play(
    device: &wasapi::Device,
    on_picked: bool,
    picked: &mut Option<DeviceInfo>,
    enumerator: &DeviceEnumerator,
    mixer: &mut Mixer,
    commands: &mpsc::Receiver<Command>,
    out: &Out,
) -> Ended {
    let format = WaveFormat::new(32, 32, &SampleType::Float, opus::RATE as usize, 1, None);
    let opened = (|| {
        let mut client = device.get_iaudioclient()?;
        client.initialize_client(
            &format,
            &Direction::Render,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: BUFFER,
            },
        )?;
        let event = client.set_get_eventhandle()?;
        let render = client.get_audiorenderclient()?;
        client.start_stream()?;
        Ok::<_, wasapi::WasapiError>((client, event, render))
    })();
    let (client, event, render) = match opened {
        Ok(opened) => opened,
        Err(error) => {
            out.send(FromHelper::Failed {
                want: WantId::Output,
                error: format!("the output device didn't open: {error}"),
            });
            return wait(picked, mixer, commands, RETRY);
        }
    };
    loop {
        while let Ok(command) = commands.try_recv() {
            match command {
                Command::Streams(streams) => mixer.set_streams(streams),
                Command::Device(device) if device != *picked => {
                    *picked = device;
                    return Ended::Reopen;
                }
                Command::Device(_) => {}
                Command::Play(sound) => mixer.sounds.push((sound, 0)),
                Command::Frame {
                    stream,
                    number,
                    at,
                    opus,
                    arrived,
                } => {
                    if let Some(player) = mixer.streams.get_mut(&stream) {
                        player.jitter.push(number, at, opus, arrived);
                    }
                }
                Command::Changed(DeviceChange::Default) if !on_picked => return Ended::Reopen,
                // The picked device came back, so the stream moves back to it.
                Command::Changed(_) => {
                    if !on_picked
                        && picked
                            .as_ref()
                            .is_some_and(|p| devices::find(enumerator, p).is_some())
                    {
                        return Ended::Reopen;
                    }
                }
                Command::Stop => return Ended::Stop,
            }
        }
        let _ = event.wait_for_event(WAIT_MS);
        // A device that went makes these fail, and the stream opens again elsewhere.
        let Ok(frames) = client.get_available_space_in_frames() else {
            return Ended::Reopen;
        };
        if frames == 0 {
            continue;
        }
        let mixed = mixer.mix(frames as usize, out);
        let bytes: Vec<u8> = mixed.iter().flat_map(|s| s.to_le_bytes()).collect();
        if render
            .write_to_device(frames as usize, &bytes, None)
            .is_err()
        {
            return Ended::Reopen;
        }
    }
}

/// Waits `how_long` with no device, taking commands, before a device is tried again.
fn wait(
    picked: &mut Option<DeviceInfo>,
    mixer: &mut Mixer,
    commands: &mpsc::Receiver<Command>,
    how_long: Duration,
) -> Ended {
    let until = Instant::now() + how_long;
    while let Some(left) = until.checked_duration_since(Instant::now()) {
        match commands.recv_timeout(left) {
            Ok(Command::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => return Ended::Stop,
            Ok(Command::Device(device)) => *picked = device,
            Ok(Command::Streams(streams)) => mixer.set_streams(streams),
            Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
    Ended::Reopen
}
