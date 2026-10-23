//! The helper's audio, from the main thread's side: the output thread while any feature may
//! play a sound or a stream is open, a thread for each capture, the sounds decoded once each,
//! and the lists the desktop app asks for (record/areas/core/04-core-helper.md, "Inside the
//! helper").

mod capture;
mod devices;
pub(crate) mod gate;
mod jitter;
mod output;
mod programs;
mod sound;

use std::collections::BTreeMap;
use std::sync::Arc;

use messages::core_helper::{FromHelper, WantId, Wants};

use crate::clock;
use crate::pipe::Out;
use capture::CaptureThread;
use output::{Command, Output};

pub struct Audio {
    out: Out,
    output: Option<Output>,
    captures: BTreeMap<u16, CaptureThread>,
    sounds: BTreeMap<u16, Arc<[f32]>>,
    /// Whether the lists went for the request now on, so one request lists once.
    listed: bool,
    last: Wants,
}

impl Audio {
    pub fn new(out: Out) -> Audio {
        Audio {
            out,
            output: None,
            captures: BTreeMap::new(),
            sounds: BTreeMap::new(),
            listed: false,
            last: Wants::default(),
        }
    }

    pub fn set(&mut self, wants: &Wants) {
        let playing = wants.sounds || !wants.streams.is_empty();
        match (&self.output, playing) {
            (None, true) => {
                self.output = Some(Output::start(
                    self.out.clone(),
                    wants.output.clone(),
                    wants.streams.clone(),
                ));
            }
            (Some(output), true) => {
                if wants.streams != self.last.streams {
                    output.send(Command::Streams(wants.streams.clone()));
                }
                if wants.output != self.last.output {
                    output.send(Command::Device(wants.output.clone()));
                }
            }
            (Some(_), false) => {
                self.output = None;
                self.out.send(FromHelper::InUse { output: None });
            }
            (None, false) => {}
        }
        self.captures.retain(|number, thread| {
            wants
                .captures
                .iter()
                .any(|(n, c)| n == number && *c == thread.capture)
        });
        for (number, capture) in &wants.captures {
            if !self.captures.contains_key(number) {
                let thread = CaptureThread::start(*number, capture.clone(), self.out.clone());
                self.captures.insert(*number, thread);
            }
        }
        if wants.lists && !self.listed {
            self.list();
        }
        self.listed = wants.lists;
        self.last = wants.clone();
    }

    /// The output devices and the programs that own an audio session, on a thread of its
    /// own, since walking them takes COM calls.
    fn list(&self) {
        let out = self.out.clone();
        std::thread::Builder::new()
            .name("lists".into())
            .spawn(move || {
                let _ = wasapi::initialize_mta();
                match wasapi::DeviceEnumerator::new() {
                    Ok(enumerator) => out.send(FromHelper::Lists {
                        outputs: devices::outputs(&enumerator),
                        programs: programs::with_sessions(),
                    }),
                    Err(error) => out.send(FromHelper::Failed {
                        want: WantId::Lists,
                        error: format!("Windows' audio devices couldn't be listed: {error}"),
                    }),
                }
            })
            .expect("the lists' thread should start");
    }

    /// A feature's sound, decoded now, so playing it later takes no work.
    pub fn sound(&mut self, sound: u16, ogg_opus: &[u8]) {
        // A sound that doesn't decode is a bug in a feature's file, which that feature's own
        // tests catch, so its plays stay silent rather than stopping the rest.
        if let Ok(samples) = sound::decode(ogg_opus) {
            self.sounds.insert(sound, samples.into());
        }
    }

    pub fn play(&self, sound: u16) {
        if let (Some(output), Some(samples)) = (&self.output, self.sounds.get(&sound)) {
            output.send(Command::Play(samples.clone()));
        }
    }

    pub fn frame(&self, stream: u16, number: u32, at: u64, opus: Vec<u8>) {
        if let Some(output) = &self.output {
            output.send(Command::Frame {
                stream,
                number,
                at,
                opus,
                arrived: clock::now(),
            });
        }
    }
}
