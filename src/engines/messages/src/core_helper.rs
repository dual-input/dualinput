//! What the core and the core helper send each other. The core helper is a program the core
//! starts, which does the core's work with Windows' input and audio
//! (record/areas/core/04-core-helper.md). Each message crosses its standard input or output
//! as a 4-byte little-endian length, then the message in postcard.
//!
//! postcard writes an enum's variant as its position, and reads a message only into the
//! types it was written from, which holds because the core starts the helper from its own
//! folder, so one build writes and reads every message. A helper of another build is told
//! apart by its `Hello`, which stays `FromHelper`'s first variant, with its two fields, in
//! every build. postcard can't read an enum that serde tags inside its content, so no type
//! here carries `#[serde(tag)]`, and the settings that hold an `Input` or a device are JSON
//! in serde's default shape, such as
//! `{"key":{"scan":30,"extended":false,"ctrl":true,"shift":false,"alt":false}}`.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The longest message either side sends, where a second of Opus at 32 kbps is about 4 KB.
/// Only a bug in our one build sends a longer one.
pub const MOST: usize = 1024 * 1024;

/// A message as it crosses the pipe: its length, then its postcard bytes.
pub fn frame<T: Serialize>(message: &T) -> Result<Vec<u8>, postcard::Error> {
    let mut bytes = postcard::to_stdvec(message)?;
    let length = u32::try_from(bytes.len()).map_err(|_| postcard::Error::SerializeBufferFull)?;
    bytes.splice(0..0, length.to_le_bytes());
    Ok(bytes)
}

/// The length a message's first 4 bytes give, or `None` when it's over `MOST`.
pub fn length(head: [u8; 4]) -> Option<usize> {
    let length = u32::from_le_bytes(head) as usize;
    (length <= MOST).then_some(length)
}

/// A message from the bytes that followed its length.
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

/// The slice of client state that lists the output devices and the programs that own an
/// audio session, for the EFB app.
pub const SLICE: &str = "core-helper";

/// The command that asks the helper for its lists, which come in the slice.
pub const LIST: &str = "core-helper.list";

/// What the core sends the helper.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ToHelper {
    /// Every want, whole, after each `Hello` and each change.
    Wants(Wants),
    /// A sound a feature registered, sent once after each `Hello`.
    Sound {
        sound: u16,
        ogg_opus: Vec<u8>,
    },
    Play {
        sound: u16,
    },
    /// One frame for a playback stream, by its number from the sender and its stamp there.
    Frame {
        stream: u16,
        number: u32,
        at: u64,
        opus: Vec<u8>,
    },
}

/// Everything the features want of the helper. The helper runs while any of it is on.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Wants {
    /// Each binding that's on and holds an input, by the number the core gave it.
    pub bindings: Vec<(u16, Input)>,
    /// The next key or button pressed, while a pilot binds one.
    pub next_press: bool,
    /// The mouse, while the sim's main window is in front.
    pub mouse: bool,
    pub captures: Vec<(u16, Capture)>,
    pub streams: Vec<(u16, Buffer)>,
    /// Whether any feature may play a sound, which keeps the output device open.
    pub sounds: bool,
    /// The output device the pilot picked, or `None` for Windows' default.
    pub output: Option<DeviceInfo>,
    /// The output devices and the programs that own an audio session, until the helper
    /// answers with them.
    pub lists: bool,
}

/// A keyboard key or a flight-hardware button.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "core_helper/")]
pub enum Input {
    /// A key by its scan code and whether it's an E0 key, so the physical key, whatever the
    /// keyboard's layout. The three flags are the modifiers held as it goes down, each on
    /// either side, as `ctrl` with F9's scan code is Ctrl+F9. A setting written without them
    /// reads as none held.
    Key {
        scan: u16,
        extended: bool,
        #[serde(default)]
        ctrl: bool,
        #[serde(default)]
        shift: bool,
        #[serde(default)]
        alt: bool,
    },
    /// A button by its device's vendor and product IDs and its number. Two devices of one
    /// model share both IDs, so a button bound on one fires from the other too.
    Button {
        vendor: u16,
        product: u16,
        button: u16,
    },
}

/// What a binding's setting holds: the input, with the name the helper gave it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "core_helper/")]
pub struct Bound {
    pub input: Input,
    pub name: String,
}

/// An audio device, by its endpoint ID, with its name to show it by.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export, export_to = "core_helper/")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

/// A program's audio to capture, as the feature that wants it sets it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Capture {
    /// Program names, such as `BeyondATC`, each a running program's file name without
    /// `.exe`; the helper captures the first that's running.
    pub programs: Vec<String>,
    /// Opus's bitrate, VBR, in bits a second.
    pub bitrate: u32,
    /// A frame is sent only while the program's level is above this, in dBFS.
    pub gate_dbfs: f32,
    /// And for this long after it falls below.
    pub hangover_ms: u32,
}

/// How a playback stream holds its frames before it plays them
/// (record/areas/traffic-atc/01-traffic-and-atc.md, "The buffer").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Buffer {
    /// The depth each transmission starts at lies between these.
    pub least_ms: u16,
    pub most_ms: u16,
    /// The depth is the smallest that would have played this share of the last `history`
    /// frames on time.
    pub on_time_percent: u8,
    pub history: u16,
    /// A stamp this far past what the frames' numbers account for starts a new transmission.
    pub new_after_ms: u16,
    /// The stream's gain, from 0 to 1.
    pub gain: f32,
}

/// What the helper sends the core.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum FromHelper {
    /// The helper's first message, with Dual Input's version and the message crate's hash.
    /// It stays the first variant, with these two fields, in every build, so a helper of
    /// another build is always read.
    Hello { version: String, hash: String },
    /// A binding's input went down or up, stamped in µs on `QueryPerformanceCounter` as the
    /// helper read it, as every `at` is.
    Press { binding: u16, down: bool, at: u64 },
    /// The next key or button pressed, with the name to show it by. The helper reports one,
    /// then reports no more until the core turns the next press on again.
    NextPress { input: Input, name: String, at: u64 },
    /// The cursor's place in the sim's main window's client area, from −1 to 1, right and
    /// up, and that area's size in physical pixels.
    Mouse {
        kind: MouseKind,
        x: f32,
        y: f32,
        width: u32,
        height: u32,
        at: u64,
    },
    /// A captured frame of 20ms of Opus, stamped at its first sample.
    Frame {
        capture: u16,
        opus: Vec<u8>,
        at: u64,
    },
    /// The program a capture takes, or `None` while it waits for one.
    Capturing {
        capture: u16,
        program: Option<String>,
    },
    /// A transmission on a playback stream ended.
    Played {
        stream: u16,
        played: u32,
        concealed: u32,
        late: u32,
        depth_ms: u16,
    },
    Lists {
        outputs: Vec<DeviceInfo>,
        programs: Vec<String>,
    },
    /// The output device the helper plays on, or `None` when it found none.
    InUse { output: Option<DeviceInfo> },
    /// A want the helper can't carry out, while it carries out the rest.
    Failed { want: WantId, error: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "core_helper/")]
pub enum MouseKind {
    LeftDown,
    LeftUp,
    RightDown,
    /// With how far the mouse moved while the button was held, in its raw counts, each
    /// report's move added as its length, as our probes' `mouse.mjs` adds them.
    RightUp {
        travel: u32,
    },
    /// At most one each 16ms, while the left button is held.
    Move,
    /// Turns of the wheel, away from the pilot positive.
    Wheel {
        notches: i16,
    },
}

/// Which want failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export, export_to = "core_helper/")]
pub enum WantId {
    Binding(u16),
    NextPress,
    Mouse,
    Capture(u16),
    Stream(u16),
    Output,
    Lists,
}

/// The slice `core-helper`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "core_helper/")]
pub struct HelperSlice {
    /// The output devices and the programs that own an audio session, as the helper last
    /// listed them.
    pub outputs: Vec<DeviceInfo>,
    pub programs: Vec<String>,
    /// The device the helper plays on, while it runs.
    pub in_use: Option<DeviceInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_is_its_length_then_its_postcard() {
        let message = FromHelper::Hello {
            version: "0.1.0".into(),
            hash: "ab".into(),
        };
        let bytes = frame(&message).unwrap();
        let head: [u8; 4] = bytes[..4].try_into().unwrap();
        assert_eq!(length(head), Some(bytes.len() - 4));
        assert_eq!(decode::<FromHelper>(&bytes[4..]).unwrap(), message);
    }

    #[test]
    fn a_length_over_the_most_is_none() {
        assert_eq!(length((MOST as u32).to_le_bytes()), Some(MOST));
        assert_eq!(length((MOST as u32 + 1).to_le_bytes()), None);
    }

    /// A helper of another build reads the first variant's two strings from what any build
    /// writes, since postcard writes the variant's position first.
    #[test]
    fn hello_is_the_first_variant() {
        let bytes = postcard::to_stdvec(&FromHelper::Hello {
            version: "v".into(),
            hash: "h".into(),
        })
        .unwrap();
        assert_eq!(bytes, [0, 1, b'v', 1, b'h']);
    }

    #[test]
    fn a_bound_combination_reads_from_its_setting_and_a_key_saved_before_combinations_holds_none() {
        let read = |json: &str| serde_json::from_str::<Bound>(json).unwrap().input;
        let input = Input::Key {
            scan: 30,
            extended: false,
            ctrl: true,
            shift: false,
            alt: true,
        };
        let json = serde_json::to_string(&Bound {
            input: input.clone(),
            name: "Ctrl+Alt+A".into(),
        })
        .unwrap();
        assert_eq!(read(&json), input);
        assert_eq!(
            read(r#"{"input":{"key":{"scan":30,"extended":false}},"name":"A"}"#),
            Input::Key {
                scan: 30,
                extended: false,
                ctrl: false,
                shift: false,
                alt: false
            }
        );
    }

    /// postcard writes every field by its place, so a combination crosses the pipe whole, its
    /// `serde(default)`s used only when JSON leaves a field out.
    #[test]
    fn a_combination_crosses_the_pipe_whole() {
        let wants = Wants {
            bindings: vec![(
                1,
                Input::Key {
                    scan: 67,
                    extended: false,
                    ctrl: true,
                    shift: true,
                    alt: false,
                },
            )],
            ..Wants::default()
        };
        let bytes = frame(&ToHelper::Wants(wants.clone())).unwrap();
        assert_eq!(
            decode::<ToHelper>(&bytes[4..]).unwrap(),
            ToHelper::Wants(wants)
        );
    }
}
