//! ATC audio, the feature that plays the ATC host's ATC app in every other pilot's headset
//! (record/areas/traffic-atc/01-traffic-and-atc.md, "ATC audio").
//!
//! On the ATC host, the pilot ATC audio's key names, the core helper captures the ATC app, and
//! this crate sends the crew each 20ms Opus frame with its number and stamp. On every other
//! machine, it opens the helper's playback stream and hands it each frame from the ATC host,
//! which the helper plays behind a depth it picks at each transmission's start. Both run while
//! a session runs, in the flight or not.
//!
//! Register it after every crate of the platform.

use clients::{Clients, ClientsUnit, SettingChanged, SettingDef};
use core_helper_service::{Captured, HelperUnit};
use kernel::{Cx, Registry, View};
use messages::atc_audio::{self as wire, APP, AUTOMATIC, AtcSlice, Frame, HOST, VOLUME};
use messages::clients::SettingKind;
use messages::core_helper::{Buffer, Capture};
use messages::net::PilotId;
use network::{NetUnit, Sender, To};
use serde_json::json;
use session::{KeyChanged, Session, SessionEnded, SessionStarted, SessionUnit};

/// The capture's and the stream's IDs among the unit's own.
const ATC: &str = "atc";

/// The capture's bitrate, VBR, in bits a second: above FS Copilot's 24 kbps, since the helper
/// encodes in Opus's Audio mode, at 27.6 kbps on BeyondATC's speech, where a listener told it
/// from the original no more than any other setting (user, 2026-10-23; record/areas/core/log.md,
/// 2026-10-23).
const BITRATE: u32 = 32_000;

/// The gate and its hangover, FS Copilot's: a frame goes out only while the app's level is
/// above −50dBFS, and for 300ms after it falls below (FS Copilot fork,
/// `record/traffic-atc/docs/01-design.md`, "Encoding and transport").
const GATE_DBFS: f32 = -50.0;
const HANGOVER_MS: u32 = 300;

/// The buffer's rule (record/areas/traffic-atc/01-traffic-and-atc.md, "The buffer"): each
/// transmission starts at the smallest depth between 60ms and 300ms that would have played 98%
/// of the last 500 frames on time, and a stamp 30ms past what consecutive numbers account for
/// starts a new one.
const LEAST_MS: u16 = 60;
const MOST_MS: u16 = 300;
const ON_TIME_PERCENT: u8 = 98;
const HISTORY: u16 = 500;
const NEW_AFTER_MS: u16 = 30;

/// The feature's state.
#[derive(Default)]
pub struct AtcAudio {
    role: Role,
    /// While capturing: the frames sent since the capture turned on, and the program it takes.
    sent: u32,
    capturing: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Role {
    #[default]
    Neither,
    /// This pilot is the ATC host, capturing the programs of the ATC app setting.
    Host,
    /// Another member is, whose frames play here, under the restart count their first frame
    /// came with, once one has.
    Listen { host: PilotId, restart: Option<u32> },
}

/// Registers ATC audio.
pub fn register(r: &mut Registry) {
    r.unit::<AtcAudio>("atc-audio")
        // The ATC audio tab, src/features/atc-audio/efb/part.tsx, finds the role by this label,
        // and the dev loop's stand-in core, src/platform/efb-shell/dev/stand-in.ts, holds it too,
        // so change all three together.
        .role_key(HOST, "Share my ATC")
        .channel(wire::FRAMES, AtcAudio::on_frame)
        .capture(ATC, "Sharing your ATC isn't working", AtcAudio::captured)
        .stream(ATC, "The crew's ATC isn't playing")
        .on::<KeyChanged>(|me, changed, cx| {
            if changed.key == HOST.number {
                me.settle(cx);
            }
        })
        .on::<SessionStarted>(|me, _, cx| me.settle(cx))
        .on::<SessionEnded>(|me, _, cx| me.settle(cx))
        .on::<SettingChanged>(AtcAudio::setting_changed)
        .setting(
            APP,
            SettingDef {
                label: "The ATC app your crew hears while you share your ATC, Automatic when empty",
                kind: SettingKind::Text,
                default: json!(""),
                part_only: true,
                development: false,
            },
        )
        .setting(
            VOLUME,
            SettingDef {
                label: "The volume of the crew's ATC, in percent",
                kind: SettingKind::Number {
                    min: 0.0,
                    max: 100.0,
                },
                default: json!(100),
                part_only: true,
                development: false,
            },
        )
        .client_state(wire::SLICE, |me: &AtcAudio, _: &View| AtcSlice {
            capturing: me.capturing.clone().filter(|_| me.role == Role::Host),
        });
}

impl AtcAudio {
    /// Follows the key while a session runs: the ATC host captures, and every other machine
    /// listens to the member the key names.
    fn settle(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let me = session.me();
        let holder = session.key(HOST).flatten();
        let wanted = match (me, holder) {
            (Some(me), Some(holder)) if holder == me => Role::Host,
            (Some(_), Some(host)) => match self.role {
                Role::Listen { host: was, restart } if was == host => {
                    Role::Listen { host, restart }
                }
                _ => Role::Listen {
                    host,
                    restart: None,
                },
            },
            _ => Role::Neither,
        };
        if wanted == self.role {
            return;
        }
        match (self.role, wanted) {
            (Role::Host, _) => {
                core_helper_service::capture(cx, ATC, None);
                self.capturing = None;
            }
            // A new ATC host gets a fresh decoder and buffer, as FS Copilot's receiver did
            // (record/areas/traffic-atc/results/2026-10-17-fsc-atc-code.txt, point 8).
            (Role::Listen { .. }, _) => core_helper_service::stream(cx, ATC, None),
            (Role::Neither, _) => {}
        }
        self.role = wanted;
        match wanted {
            Role::Host => {
                tracing::info!("this pilot shares their ATC, so ATC audio captures their ATC app");
                self.sent = 0;
                core_helper_service::capture(cx, ATC, Some(capture(cx.read::<Clients>())));
            }
            Role::Listen { host, .. } => {
                tracing::info!(
                    host = messages::hex(&host),
                    "another member is the ATC host"
                );
                core_helper_service::stream(cx, ATC, Some(buffer(cx.read::<Clients>())));
            }
            Role::Neither => tracing::info!("nobody shares ATC"),
        }
    }

    fn setting_changed(me: &mut AtcAudio, changed: &SettingChanged, cx: &mut Cx) {
        match me.role {
            Role::Host if changed.key == APP => {
                core_helper_service::capture(cx, ATC, Some(capture(cx.read::<Clients>())));
            }
            Role::Listen { .. } if changed.key == VOLUME => {
                core_helper_service::stream(cx, ATC, Some(buffer(cx.read::<Clients>())));
            }
            _ => {}
        }
    }

    /// What the capture brings: each frame goes to the crew, numbered from the capture's start,
    /// and its deadline 300ms past its stamp.
    fn captured(me: &mut AtcAudio, captured: Captured, cx: &mut Cx) {
        if me.role != Role::Host {
            return;
        }
        match captured {
            Captured::Frame { opus, at } => {
                let frame = Frame {
                    number: me.sent,
                    at,
                    opus,
                };
                me.sent = me.sent.wrapping_add(1);
                network::send_one_off(cx, wire::FRAMES, To::Crew, &frame);
            }
            Captured::Program(program) => {
                tracing::info!(program, "ATC audio's capture takes this program");
                me.capturing = program;
            }
        }
    }

    /// A frame from another core, which plays only from the ATC host. A host that restarted
    /// numbers its frames from 0 again, so its higher restart count opens the stream anew.
    fn on_frame(me: &mut AtcAudio, from: Sender, frame: Frame, cx: &mut Cx) {
        let Role::Listen { host, restart } = &mut me.role else {
            return;
        };
        if from.pilot != *host {
            return;
        }
        match *restart {
            Some(was) if from.restart < was => return,
            Some(was) if from.restart > was => {
                core_helper_service::stream(cx, ATC, None);
                core_helper_service::stream(cx, ATC, Some(buffer(cx.read::<Clients>())));
            }
            _ => {}
        }
        *restart = Some(from.restart);
        core_helper_service::frame(cx, ATC, frame.number, frame.at, frame.opus);
    }
}

/// The capture the ATC app setting names: one program, or Automatic's list, the first that's
/// running.
fn capture(clients: &Clients) -> Capture {
    let app = clients.setting_as::<String>(APP).unwrap_or_default();
    let programs = if app.trim().is_empty() {
        AUTOMATIC.map(str::to_string).to_vec()
    } else {
        vec![app.trim().to_string()]
    };
    Capture {
        programs,
        bitrate: BITRATE,
        gate_dbfs: GATE_DBFS,
        hangover_ms: HANGOVER_MS,
    }
}

/// The stream's buffer, with the ATC volume as its gain, since the helper mixes ATC with every
/// feature's sounds into one output stream, so the Windows mixer can't turn ATC down alone.
fn buffer(clients: &Clients) -> Buffer {
    let volume = clients.setting_as::<f64>(VOLUME).unwrap_or(100.0);
    Buffer {
        least_ms: LEAST_MS,
        most_ms: MOST_MS,
        on_time_percent: ON_TIME_PERCENT,
        history: HISTORY,
        new_after_ms: NEW_AFTER_MS,
        gain: (volume / 100.0).clamp(0.0, 1.0) as f32,
    }
}
