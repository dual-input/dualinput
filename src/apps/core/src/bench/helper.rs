//! The test unit that stands in for the features that want things of the core helper:
//! take-control's binding, next press, and sounds, avatars' mouse, and ATC audio's capture and
//! stream. It tells the bench what each want brings, as a line of text
//! (record/areas/build/02-testing.md, "Its place").

use std::time::Duration;

use clients::{ClientsUnit, SettingDef};
use core_helper_service::{Captured, HelperUnit, Mouse, NextPressed, Press};
use kernel::{Cx, Input, Registry, TimerId};
use messages::bench::{HelperAct, ToCore};
use messages::clients::SettingKind;
use messages::core_helper::{Buffer, Capture};
use serde_json::Value;

use super::sim::Heard;

/// Names the source the bench's lines for this unit come in under.
pub struct Acts;

/// The setting its binding holds, a `core_helper::Bound`, which a scenario writes in the
/// core's settings before it starts, or sets through a fake page.
pub const INPUT: &str = "bench.input";

/// 2s of 440Hz and 554Hz, each for half a second, at −20dBFS RMS, as Ogg Opus at 48 kHz, which
/// `writes_the_bench_tone` in src/apps/core-helper wrote, and writes again when it should change.
/// It stays short: the core sends every sound in each of the helper's `Hello`s, and a debug
/// build took 1.95ms to hash a 10s version, 48 KB, past a handler's 1ms.
const TONE: &[u8] = include_bytes!("tone.opus");

#[derive(Default)]
pub struct BenchHelper {
    frames: Option<Frames>,
    /// While the loop is on, the number of the next captured frame handed to the stream.
    looped: Option<u32>,
}

struct Frames {
    every: Duration,
    bytes: usize,
    until: u64,
    number: u32,
    /// When the next frame is due, so a timer that fires late doesn't push back every
    /// frame after it.
    due: u64,
}

impl BenchHelper {
    pub fn register(r: &mut Registry) {
        let mut me = r.unit::<BenchHelper>("bench-helper");
        me.source::<Acts>(BenchHelper::act);
        me.setting(
            INPUT,
            SettingDef {
                label: "A key or button the bench binds",
                kind: SettingKind::Input,
                default: Value::Null,
                part_only: false,
                development: false,
            },
        )
        .binding(INPUT, BenchHelper::pressed)
        .next_press(BenchHelper::next)
        .mouse(BenchHelper::mouse)
        .capture("bench", BenchHelper::captured)
        .stream("bench")
        .sound("bench", TONE);
    }

    fn act(me: &mut BenchHelper, input: &Input, cx: &mut Cx) {
        let Ok(ToCore::Helper { act }) = serde_json::from_slice(&input.bytes) else {
            tracing::warn!("a line for the core helper's test unit isn't one of its acts");
            return;
        };
        match act {
            HelperAct::Binding { on } => core_helper_service::watch(cx, INPUT, on),
            HelperAct::NextPress { on } => core_helper_service::next_press(cx, on),
            HelperAct::Mouse { on } => core_helper_service::mouse(cx, on),
            HelperAct::Capture { programs } => {
                // ATC audio's starting values: 32 kbps, and FS Copilot's gate and hangover
                // (record/areas/core/04-core-helper.md's note of 2026-10-23).
                let capture = programs.map(|programs| Capture {
                    programs,
                    bitrate: 32_000,
                    gate_dbfs: -50.0,
                    hangover_ms: 300,
                });
                core_helper_service::capture(cx, "bench", capture);
            }
            HelperAct::Stream { on } => {
                // ATC audio's buffer (record/areas/traffic-atc/01-traffic-and-atc.md, "The
                // buffer").
                let buffer = on.then_some(Buffer {
                    least_ms: 60,
                    most_ms: 300,
                    on_time_percent: 98,
                    history: 500,
                    new_after_ms: 30,
                    gain: 1.0,
                });
                core_helper_service::stream(cx, "bench", buffer);
            }
            HelperAct::Loop { on } => me.looped = on.then_some(0),
            HelperAct::Sounds { on } => core_helper_service::sounds(cx, on),
            HelperAct::Play => core_helper_service::play(cx, "bench"),
            HelperAct::Frames {
                per_second,
                bytes,
                for_ms,
            } => {
                let every = Duration::from_secs(1) / per_second.max(1);
                me.frames = Some(Frames {
                    every,
                    bytes: bytes as usize,
                    until: cx.now() + for_ms * 1_000,
                    number: 0,
                    due: cx.now() + every.as_micros() as u64,
                });
                cx.timer(every, BenchHelper::frame);
            }
        }
    }

    fn frame(me: &mut BenchHelper, _: TimerId, cx: &mut Cx) {
        let Some(frames) = &mut me.frames else { return };
        core_helper_service::frame(cx, "bench", frames.number, cx.now(), vec![0; frames.bytes]);
        frames.number += 1;
        frames.due += frames.every.as_micros() as u64;
        if frames.due <= frames.until {
            let after = Duration::from_micros(frames.due.saturating_sub(cx.now()));
            cx.timer(after, BenchHelper::frame);
        } else {
            me.frames = None;
        }
    }

    /// Says how long after the helper's stamp the press reached the loop, which the queue
    /// stamps as it takes the input.
    fn pressed(_: &mut BenchHelper, press: Press, cx: &mut Cx) {
        let state = if press.down { "down" } else { "up" };
        let after = cx.now().saturating_sub(press.at);
        cx.out(Heard(format!("press {state} {after}us after its stamp")));
    }

    /// Says the press's name, and all of it, which a desk run writes into the binding's setting
    /// as a feature's part would.
    fn next(_: &mut BenchHelper, next: NextPressed, cx: &mut Cx) {
        cx.out(Heard(format!("next press {}", next.bound.name)));
        let bound = serde_json::to_string(&next.bound).expect("a bound input should encode");
        cx.out(Heard(format!("next input {bound}")));
    }

    fn mouse(_: &mut BenchHelper, mouse: Mouse, cx: &mut Cx) {
        cx.out(Heard(format!(
            "mouse {:?} {:.3} {:.3}",
            mouse.kind, mouse.x, mouse.y
        )));
    }

    /// Says each frame's bytes in hex, so a desk run can decode what the helper captured.
    fn captured(me: &mut BenchHelper, captured: Captured, cx: &mut Cx) {
        let heard = match captured {
            Captured::Frame { opus, at } => {
                let hex: String = opus.iter().map(|b| format!("{b:02x}")).collect();
                let heard = format!("captured {} bytes {hex}", opus.len());
                if let Some(number) = &mut me.looped {
                    core_helper_service::frame(cx, "bench", *number, at, opus);
                    *number += 1;
                }
                heard
            }
            Captured::Program(program) => format!("capturing {program:?}"),
        };
        cx.out(Heard(heard));
    }
}
