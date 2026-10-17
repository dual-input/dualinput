# Core: the core helper

```text
Purpose:     How the core runs the core helper, what features ask of it, and what the helper runs for Raw Input, audio, and speech.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, 02-clients-and-panel-bridge.md, ../network/02-units.md, ../architecture/decisions.md
Decides:     What runs in the helper and what on the loop; what a feature registers and turns on; the pipe's format and messages; when the helper starts, stops, and starts again; what crosses the pipe; the helper's threads, its Raw Input, devices, capture, playback, and speech; its Opus codec and dependencies; the budgets; and the cases for the bench (node 6.5).
```

> **Note**
> Since 2026-10-16, the helper sends `Alive` every 2s whatever else it sends, where [the pipe](#the-pipe) has it send `Alive` only after 2s of nothing, so its silence counts only recorded messages; and a capture can be registered unrecorded, as ATC audio's is ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
> Since 2026-10-17, the voice phrases are a Soon pick (user, 2026-10-17), so v1 builds no want of phrases, no speech thread, no microphone capture, and no microphone setting, which come with that pick as [speech](#speech) and [the devices](#the-devices) design them; [left open](#left-open)'s detector, recognizer, and microphone rate go to that pick, whose research is in the [control log](../control/log.md#2026-10-17-research-puts-silero-vad-and-sherpa-onnx-ahead-for-recognizing-the-voice-phrases-on-the-pilots-pc-and-the-voice-phrases-move-to-soon), as do the [cases for the bench](#cases-for-the-bench) on a missing microphone, Windows' default microphone changing, and our recorded line through desk speakers, and the recognizer in [budgets](#budgets); and take-control registers two sounds, the control-passed cue and a refusal cue, and no recorded line ([take-control](../control/01-take-control.md)).

The core helper runs only what features want of it.
The core-helper-service crate, on the loop, keeps each want a feature registered and turned on, runs the helper while any is on, sends the helper every want whole after each start and each change, and starts it again 2s after it exits.
Across the helper's standard input and output go postcard messages, each after a 4-byte length, and only what a feature asked for crosses: a bound key's or button's press, the next press while the pilot binds one, the mouse while the sim's main window is in front, a phrase heard, and Opus frames.
The helper reads Raw Input, captures a program's audio and the microphone, encodes and decodes Opus through opus-rs, plays streams and sounds on the device the pilot picks or on Windows' default, and listens for phrases through a recognizer that [6.12](../architecture/plan.md#612-control) picks, so the microphone's audio never leaves it.

This answers node 6.5 of the [architecture plan](../architecture/plan.md#65-the-core-helper).
Decisions [004](../../decisions/004-core-works-out-figures-hand.md), [006](../../decisions/006-core-catches-take-control-input.md), [007](../../decisions/007-core-runs-audio.md), [010](../../decisions/010-clients-message-core-every-2s.md), and [019](../../decisions/019-input-and-audio-run-in-helper.md), the spine's [the helper](../architecture/01-spine.md#the-helper), [01-loop-and-edge](01-loop-and-edge.md), and [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `core-helper-service` | Platform | What each feature registered and which of it is on, the helper's life, the pipe's messages, the output device and microphone settings, the slice that lists devices and programs, and the helper's notices | On the loop |
| `apps/core-helper` | App | Raw Input, the audio devices, capture, Opus, playback, sounds, and speech | A process of its own, which the core starts |
| The message crate's `core_helper` module | Engine | `ToHelper` and `FromHelper`, and the types inside them | Wherever the message crate does |
| `apps/core`'s edge | App | Starting the helper's process, reading and writing its pipe, and killing it | On tokio, as [threads](01-loop-and-edge.md#threads) has it |

## What runs where

| Work | Runs in | Because |
| --- | --- | --- |
| What's wanted, when the helper starts, stops, and starts again, and its timers | `core-helper-service` | A replay reproduces each decision only when the loop makes it ([one loop](../architecture/02-code-map.md#one-loop)) |
| Reading the keyboard, flight hardware, and mouse, and dropping all but what's wanted | The helper | Every input the core takes is recorded ([what a recording holds](01-loop-and-edge.md#what-a-recording-holds)), so a keystroke that reached the core would reach a bug report |
| Opus encoding and decoding, the gate that sends nothing in silence, and the adaptive playback buffer | The helper | At 24 kbps a 20ms frame averages 60 bytes, about 3 KB/s, where 48 kHz mono 16-bit audio is 96 KB/s, about 345 MB an hour in every recording (arithmetic); and the buffer counts samples against the device's clock |
| Telling speech from noise, and recognizing phrases | The helper | Only the phrase heard crosses, so the microphone's audio stays out of the core and out of every recording, which a bug report carries off the PC, where [voice phrases](../product/03-v1-scope.md#voice-phrases) keeps audio on the pilot's machine |
| Which program to capture, its bitrate, the gate's level, and the buffer's rule | Each feature | The helper carries out what it's given, so ATC audio's design sets those ([6.14](../architecture/plan.md#614-traffic-and-atc)) |

## What a feature registers and calls

```rust
// a sketch: the take-control key and its cue, beside 01-loop-and-edge's
pub fn register(r: &mut Registry) {
    let me = r.unit::<TakeControl>("take-control");
    me.binding(setting::TAKE_CONTROL_INPUT, TakeControl::on_press);   // a setting of the feature's, holding a keyboard key or a button
    me.sound(sound::CONTROL_PASSED, include_bytes!("sounds/control-passed.opus"));
}

fn start(me: &mut TakeControl, cx: &mut Cx) {
    cx.helper().watch(setting::TAKE_CONTROL_INPUT, true);             // the helper runs while anything is on
}

fn on_press(me: &mut TakeControl, press: &Press, cx: &mut Cx) {
    // press.down and press.at, the helper's own stamp, so a long press is timed here
}
```

Each want is registered once and is off until its feature turns it on:

| Want | Registered with | Turned on by | What comes back | v1's user |
| --- | --- | --- | --- | --- |
| A binding | A setting key, whose value is a keyboard key or a button, and a handler | `watch(setting, on)` | Each press and release, with its stamp | Take-control |
| The next press | Nothing | `next_press(on)` | The next key or button pressed, with a name to show it by, after which it turns itself off | Take-control, while the desktop app binds its key |
| The mouse | A handler | `mouse(Some(pid))`, with the sim's process ID | Left and right presses and releases, and at most one move every 16ms while the left button is held, each with the cursor's place in the sim's main window and the window's size | Avatars |
| A capture | An ID and a handler | `capture(id, Some(source))`, with a program's name, a bitrate, and a gate | 20ms Opus frames, each stamped at its first sample, only above the gate; and whether the program is running and captured | ATC audio, on the ATC host |
| A playback stream | An ID | `stream(id, Some(buffer))`, then `frame(id, number, bytes)` for each frame | Nothing | ATC audio, on the other machines |
| Phrases | A list of phrases and a handler | `listen(on)` | The phrase heard, with stamps for when it began and ended | Voice |

- The service numbers each registration in the order units register, as sources are numbered, and only the same build reads those numbers, in the helper and in a replay ([inputs](01-loop-and-edge.md#inputs)).
- When the clients crate raises a setting changed whose setting key a binding names, the service sends the wants again, as [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md#the-moments-clients-raises-and-the-calls-it-takes) has it.
- Avatars passes the sim's process ID, read from sim awareness, because the service sits on the sim service's line in the code map's [units](../architecture/02-code-map.md#the-units), and a crate depends only on the lines below its own ([tiers](../architecture/02-code-map.md#tiers)).
- A feature also registers sounds, each an ID and an Ogg Opus file embedded in its crate, which the service sends after each `Hello`.
  A sound isn't a want and keeps no helper running: `play(id)` plays it while the helper runs, and a `play` while it's stopped is logged and dropped.
  v1's cues and recorded lines all play in a session, where take-control's binding keeps the helper running.
- The desktop app asks for the devices and programs through a command of the service's, which sets `lists` in the wants until the helper answers, so a helper started for the request gets it with the rest.

## The pipe

- Each message is a 4-byte little-endian length, then the message in postcard, a `ToHelper` on the helper's standard input or a `FromHelper` on its standard output, which settles the spine's [left open](../architecture/01-spine.md#left-open) item on the format.
  - Every message between cores is postcard ([decision 035](../../decisions/035-channels-declare-how-they-travel.md)), and the kernel already folds outputs' postcard into its hash ([outputs](01-loop-and-edge.md#outputs)).
  - postcard writes an enum's variant as its position (read in postcard 1.1.3, `src/ser/serializer.rs`, `serialize_unit_variant`), which is safe here because the core starts the helper from its own folder, so the same build writes and reads every message, and the `Hello` below catches the case where it doesn't.
- A message is at most 1 MiB, where a second of Opus at 24 kbps is about 3 KB (arithmetic).
  - The edge treats a longer length as the helper's exit: it kills the process and hands up its exit.
  - The helper exits with a code other than 0 on a longer length, or on a message that doesn't parse, since only a bug in our one build sends either.
  - A `FromHelper` that doesn't parse is logged and dropped on the loop, as [a message that doesn't parse](02-clients-and-panel-bridge.md#the-protocol) never stops the core.

```rust
// a sketch: the message crate's core_helper module
pub enum ToHelper {
    Wants(Wants),                                       // whole, after Hello and at every change
    Sound { sound: u16, ogg_opus: Vec<u8> },            // each, after Hello
    Play { sound: u16 },
    Frame { stream: u16, number: u32, opus: Vec<u8> },
}

pub struct Wants {
    pub bindings: Vec<(u16, Input)>,     // Input: a key's scan code, or a device's IDs and a button
    pub next_press: bool,
    pub mouse: Option<u32>,              // the sim's process ID
    pub captures: Vec<(u16, Capture)>,   // a program's name, a bitrate, and a gate
    pub streams: Vec<(u16, Buffer)>,     // each stream's buffer, as ATC audio sets it
    pub phrases: Vec<String>,            // listened for while not empty
    pub output: Device,                  // Windows' default, or a device's endpoint ID and name
    pub microphone: Device,
    pub lists: bool,
}

pub enum FromHelper {
    Hello { version: String, hash: String },   // first in every build, with these two fields
    Alive,
    Press { binding: u16, down: bool, at: u64 },
    NextPress { input: Input, name: String },
    Mouse { kind: MouseKind, x: f32, y: f32, width: u32, height: u32, at: u64 },
    Frame { capture: u16, opus: Vec<u8>, at: u64 },
    Capturing { capture: u16, attached: bool },
    Heard { phrase: u16, from: u64, to: u64 },
    Lists { outputs: Vec<DeviceInfo>, microphones: Vec<DeviceInfo>, programs: Vec<String> },
    InUse { output: DeviceInfo, microphone: DeviceInfo },
    Failed { want: WantId, error: String },
}
```

- Every `at`, `from`, and `to` is µs on `QueryPerformanceCounter`, the one timeline every process on the PC reads ([times](../architecture/01-spine.md#times)), taken in the helper as it reads the value, as the spine's rule that the reader stamps asks.
  The queue's own stamp on the input comes later, after the pipe.
- The helper's first message is `Hello`, with Crosscheck's version and the message crate's hash as text ([versions](../architecture/01-spine.md#versions)), and `Hello` stays `FromHelper`'s first variant, with those two fields, in every build, so a helper of another build is always read.
  A helper whose version or hash differs is logged with both and killed, and counts as down; installed together, the two differ only for a developer's stale build.
- The helper sends `Alive` once it has sent nothing for 2s, and the service has the edge kill a helper it hasn't heard from in 8s, since a hung helper's process doesn't exit ([decision 010](../../decisions/010-clients-message-core-every-2s.md)).
  The core sends the helper no keepalive: its standard input closing tells the helper the core is gone.

## The helper's life

- **It runs while anything is wanted.**
  In v1 that's in a session, where take-control watches its binding, and with no session only while the desktop app binds a key or lists devices, as [decision 019](../../decisions/019-input-and-audio-run-in-helper.md) has it, without the service knowing what a session is.
- **Starting:** the service puts out a start, and the edge starts `crosscheck-core-helper.exe` from the core's own folder through tokio's `process::Command`, with its standard input and output piped and its standard error discarded.
  Its process ID, or the error that stopped it starting, comes back as an input.
  The helper is a Windows program with no console, as p08's was (read in `experiments/areas/architecture/flight/helper/src/main.rs`, `windows_subsystem`); p08 piped only its standard output (read in `experiments/areas/architecture/p08-flight.mjs`), so that such a program reads a piped standard input is unverified, and the helper's first build settles it.
- **On `Hello`:** the service sends each sound, then the wants, whole.
  So a helper that started again gets everything in one round, as the session crate sends its keys whole on every `LinkUp` ([moments](../network/02-units.md#moments)).
- **On each change:** the service sends the wants again, whole.
- **A want the helper can't carry out,** such as a microphone that won't open or Raw Input refusing to register, it reports in `Failed`, and runs the rest.
  The service logs it and shows a warning naming the feature whose want failed, until that want goes off or the helper starts again.
- **Stopping:** once nothing is wanted, the service puts out a stop, the edge closes the helper's standard input, and the helper exits; the edge kills it if it hasn't within 1s.
- **Starting again:** when the helper exits while something is wanted, whatever its code, or the edge kills it, the service starts it again 2s later, through a timer, for as long as something is wanted (user, 2026-10-16).
  If no matching `Hello` has come 5s after it went down, the service shows a trouble notice naming the features whose wants are on, and clears it at the next matching `Hello`.
- **The core exiting** closes the helper's standard input, so the helper exits with the core, a crash included (unverified; a bench case kills the core).

## Inside the helper

| Thread | Runs |
| --- | --- |
| Main | Reads each `ToHelper` and hands it to the thread it's for |
| Writer | Writes each `FromHelper`, one at a time, and `Alive` |
| Input | A hidden window that receives Raw Input in sink mode, and its message loop |
| Output | One shared-mode WASAPI stream on the output device, into which it mixes every stream and sound playing |
| One per capture | Finding the program, its process loopback, the gate, and Opus |
| Speech | The microphone, telling speech from noise, and the recognizer |

The helper runs on std's threads and channels, with no async runtime, since each thread waits on its own Windows events or messages.

### Raw Input

- While a binding or the next press is on, the helper registers keyboards, joysticks, gamepads, and multi-axis controllers, the Generic Desktop page's usage 8 (documented, [HID Usage Tables 1.5](https://usb.org/sites/default/files/hut1_5.pdf)), and while the mouse is on, the mouse.
  Each registration is in sink mode, delivered to a hidden window of the helper's own, as p08 registered keyboards, joysticks, and gamepads (read in `experiments/areas/architecture/flight/helper/src/main.rs`).
  In sink mode, with the sim in front, p08's helper got all 3 Page Down presses a person made and 22 changes of a flight-hardware button's state in 10s (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
- **A key** is bound by its scan code and its E0 flag, the physical key, whatever the keyboard's layout, and the helper names it for the next press through `GetKeyNameTextW`.
  The helper reports a press only for a key that isn't already down, so a held key that repeats its press crosses once.
- **A button** is bound by its device's vendor and product IDs, which the helper reads from the device's name, and its button number, which `HidP_GetUsages` gives, as p08 read both.
  The helper keeps each device's buttons that are down and reports only a change, since four devices nobody touched sent 1,447 reports in 4s (measured on our development machine, 2026-10-08, [architecture log][helper]).
  A device's first report after the helper starts, or after the device arrives, only sets which of its buttons are down, so a switch already on never counts as a press, nor gets bound.
  Two devices of one model share both IDs, so a button bound on one fires from the other too.
- **The mouse** reports as our probes' `mouse.mjs` does, less its middle button, wheel, and size changes: the left and right buttons' presses and releases, and at most one move every 16ms, on a mouse event, while the left is held, each with the cursor's place in the window's client area, from −1 to 1, right and up, and that area's size in pixels (read in [mouse.mjs](../../../experiments/tools/mouse.mjs)).
  - The window is the sim's main window: the top-level window of class `AceApp` in the sim's process whose title starts `Microsoft Flight Simulator 2024`, since a popped-out display is a top-level `AceApp` window of the same process (measured on MSFS 2024 1.8.16.0, [06-03](../../learn/foundations/06-03-display-kinds-input-and-pop-outs.md#pop-out-windows)).
  - The helper reports the mouse only while that window itself is in front, so a click in a pop-out or another program crosses nothing.
  - The helper declares itself aware of each monitor's DPI, so the cursor's place and the window's size are both in physical pixels on a monitor scaled above 100%; that they could otherwise differ is unverified, and a bench case at 150% settles it.
- **Nothing else crosses.**
  Every other key, button, and click stays in the helper, so no recording or bug report holds what the pilot typed into another program.

### The devices

- The output device and the microphone are each a setting of the service's: Windows' default device for the role `wasapi` documents as the one "used by most applications" (documented, [wasapi 0.25.0](https://docs.rs/wasapi/0.25.0/wasapi/enum.Role.html)), or a device the pilot picked, kept by its endpoint ID, with its name to show it by.
- On Windows' default changing, each stream on a default device, the output's and the microphone's, opens again on the new default, so a pilot who switches headsets mid-session hears Crosscheck, and is heard by it, in the new one.
- When no device has the picked endpoint ID, the helper takes one with the picked name, since Windows may give a USB headset plugged into another port a new endpoint ID (unverified); with neither, it plays or listens on Windows' default instead, and moves back when the device returns.
  The helper reports what it uses in `InUse`, which the core logs, so a bug report shows where sound went, and the service shows a warning naming the missing device while it's gone.
- While `lists` is on, the helper answers with the output devices, the microphones, and the programs that own an audio session, which FS Copilot's "Choose another…" lists for the ATC app (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Choosing the ATC app"), and the service puts them in a slice for the desktop app.
- The output stream runs in shared mode at 48 kHz, mono, and lets WASAPI convert to the device's format (documented, [wasapi 0.25.0](https://docs.rs/wasapi/0.25.0/wasapi/enum.StreamMode.html), `autoconvert`).
  A capture asks for the same, though whether WASAPI converts a process-loopback stream is unverified until the helper's first build, and the microphone runs at the rate the recognizer takes, which 6.12 sets.

### Capturing a program

- A capture names a program, and the helper looks for it every 2s until it finds it, then captures its oldest process with its process tree through process loopback, as FS Copilot's capture does (same document, "Choosing the ATC app"), through `wasapi`'s `new_application_loopback_client`.
- It watches that process, because a loopback whose program has exited delivers silence at −90dBFS with no error (same document), and looks for the program again once it's gone.
- It divides the program's level in the Windows mixer back out, up to +20dB, since Windows applies it before the capture, which FS Copilot measured with a test tone on 2026-09-06 and reported holding against BeyondATC in a live flight (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Stage 3: the audio path works on one machine").
  It reads that level through the session's `ISimpleAudioVolume`, which `wasapi` 0.25.0 doesn't wrap (read in its docs, `AudioSessionControl`), so the helper calls it through `windows`.
- It encodes 20ms frames at the capture's bitrate, sends a frame only while its level is above the gate, keeps sending for the gate's hangover after it falls below, and sends the frame before an onset with it, so the onset isn't clipped, as FS Copilot's capture does (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Encoding and transport").
- Each frame's stamp is the counter value WASAPI reports for its first sample, which `IAudioCaptureClient::GetBuffer` gives in 100ns units (documented, [GetBuffer](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)), converted to µs.
- FS Copilot's 24 kbps VBR, −50dBFS gate, and 300ms hangover (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Encoding and transport") are ATC audio's starting values, which [6.14](../architecture/plan.md#614-traffic-and-atc) sets.
- A capture's source is a program in v1, and the source is an enum, so the microphone sent to the ATC host that [04-room-for-later](../product/04-room-for-later.md#channels) lists adds a variant, and a plugin's own sound is a program as v1's is.

### Playing

- A playback stream takes frames by the sender's number, decodes each, conceals a missing number through the codec's loss concealment, and plays behind an adaptive buffer whose rule ATC audio sets; a frame that arrives after its turn is dropped ([channels](../network/01-between-machines.md#channels)).
- A sound arrives once after each `Hello`, as an Ogg Opus file at 48 kHz, mono, which the helper decodes then, and `Play` mixes it in from its start.

### Speech

- While phrases are wanted, the helper captures the microphone and hands it to a detector, which tells speech from noise, and to a recognizer, which listens for the phrases, both behind one trait in `apps/core-helper` that [6.12](../architecture/plan.md#612-control) fills.

  ```rust
  // a sketch, inside apps/core-helper
  trait Listener {
      fn phrases(&mut self, phrases: &[String]);
      fn feed(&mut self, samples: &[f32], at: u64) -> Option<Heard>;   // Heard: the phrase's index, and when it began and ended
  }
  ```

- While a sound of ours plays, the speech thread feeds the listener nothing, so a recorded "you have control" that reaches a pilot's microphone through a VR headset's speakers or desk speakers can't open an offer.

### Opus

The helper encodes and decodes Opus through opus-rs, a pure-Rust port of libopus 1.6, at the version the helper's stage of the build pins (user, 2026-10-16).

- Nothing else in Crosscheck depends on ATC audio or the cues, so we take a young codec there, and the codec sits behind three calls, to encode a frame, decode one, and conceal a lost one, with the same build at both ends.
  If the bench finds it falls short, `opus` 0.4.0, bindings to libopus 1.6.1, takes its place, which changes one crate and no message, and puts CMake on every build machine, since `opus` 0.4.0 builds libopus through opusic-sys 0.7, whose bundled build runs CMake (read on crates.io, 2026-10-16; documented, [opusic-sys](https://github.com/DoumanAsh/opusic-sys)).
  Every libopus binding we found builds that way (read 2026-10-16 in the dependencies crates.io lists for opusic-sys 0.7.5, libopus_sys 0.3.2, and opus-codec 0.2.0, each with `cmake`), and nothing else in our build uses CMake (read in our probes' `Cargo.lock` files, which hold `cc` and `ring` and no `cmake`).
- opus-rs claims test suites against libopus, 13 fuzz targets, loss concealment "as libopus does", and speed "competitive with C libopus", and has 53 stars and one maintaining organization (documented, [opus-rs](https://github.com/restsend/opus-rs), read 2026-10-16); we've checked none of it.
- Its notes name a gap in CELT packets of 5 to 6 bytes, which differ from libopus's at their tail and lose some SNR (same page).
  ATC's frames at 24 kbps VBR average 60 bytes (arithmetic), and how many quiet frames come out that small is unverified; the bench's check of opus-rs counts them.
- Its issue #54, opened against 0.1.37 on 2026-10-08 and closed on 2026-10-11, capped CELT encoded from 24 kHz input at about 20dB of SNR, and left 48 kHz input alone (documented, [issue #54](https://github.com/restsend/opus-rs/issues/54)); the helper encodes 48 kHz.

### Its dependencies

| Crate | For | Because |
| --- | --- | --- |
| `wasapi` 0.25.0 | The devices, capture, and output | p02's helper captured a program through it and played on a device it looked up by name (measured on our development machine, 2026-10-08, [architecture log][helper]); it has default devices by role, device notifications, audio sessions with their process IDs, and event-driven streams (documented, [wasapi 0.25.0](https://docs.rs/wasapi/0.25.0/wasapi/)); 0.26.0 came out on 2026-10-11 (read on crates.io, 2026-10-16) |
| `windows` 0.62, the version `wasapi` 0.25.0 brings | Raw Input, DPI awareness, `ISimpleAudioVolume`, and finding a program's process and the sim's window | One Windows crate in the helper, with the COM interfaces `windows-sys` lacks, where p08 read Raw Input through `windows-sys` 0.59 |
| `opus-rs` | Opus | [Above](#opus) |
| `ogg` 0.9.2 | Reading the sounds | Pure Rust, at 11.5 million downloads across its versions (read on crates.io, 2026-10-16); at 24 kbps, an Ogg Opus cue is about 30 times smaller than the same cue as 48 kHz 16-bit WAV, which is what the core embeds and sends at each start (arithmetic) |
| The message crate, with postcard | The pipe | [The pipe](#the-pipe) |

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The helper's CPU | Under 1% of one CPU core through a busy session with ATC captured or playing, beside the recognizer, whose budget 6.12 sets; FS Copilot's Opus, through Concentus, a C# port of libopus, took 0.1% to 0.2% of a CPU it doesn't name (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Stage 3: the audio path works on one machine") |
| The helper's memory | Under 20 MB of private working set, beside the recognizer's model |
| A press | On the queue within 5ms of the helper's stamp, at p99 |
| The pipe | Under 200 messages a second each way: ATC's 50 frames a second, and the mouse's 62 moves a second at most while the left button is held |
| The recording | The ATC host's captured frames, about 3 KB/s of Opus while ATC talks, and about 11 MB in an hour that never fell silent, the Opus alone (arithmetic) |
| Starting again | Running, with every want sent, within 3s of an exit |
| Stopping | Exited within 1s of its standard input closing |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- The helper is killed in a session, and within 3s it runs again, with the take-control key bound as before.
- The helper is suspended, and the core kills it after 8s and starts it again.
- The core is killed, and the helper exits within 1s.
- A helper of another build is logged, killed, and started again, and the trouble notice shows after 5s.
- The microphone is missing: the take-control key and the cues still work, and a warning names voice.
- A bound key held for 2s crosses as one press and one release.
- A key nobody bound, typed into another program, never crosses the pipe, which the recording shows.
- While the desktop app binds a key, with a switch on a throttle quadrant held on, only the button the pilot presses crosses, and then nothing.
- Clicks with another program in front, or in a popped-out display, never cross.
- On a monitor scaled to 150%, a click in the top-left corner of the sim's window's client area crosses as x −1, y 1, and one in the bottom-right as x 1, y −1.
- Windows' default output device changes while a sound plays, and the sound carries on in the new device; Windows' default microphone changes, and a phrase is still heard.
- A picked headset is unplugged: Crosscheck plays on Windows' default and warns, and goes back to the headset when it's plugged into another port.
- Our recorded "you have control" plays through desk speakers beside the microphone, and opens no offer.
- The captured program exits and starts again: the capture stops, then attaches again, and with the program at 30% in the Windows mixer, its frames arrive at full level.
- Audio below the gate never crosses.
- ATC speech recorded from BeyondATC goes through opus-rs at 24 kbps with 5% of frames lost, within the CPU budget, and the bench counts frames of 6 bytes or fewer; at the helper's stage of the build we listen to it, and a fault a pilot would notice swaps in libopus, as [Opus](#opus) has it.

## Left open

- The detector and the recognizer, and the rate the microphone runs at: [6.12](../architecture/plan.md#612-control).
- The bitrate, the gate's level and hangover, the playback buffer's rule, and how the ATC app is picked: [6.14](../architecture/plan.md#614-traffic-and-atc).
- Whether WASAPI converts the format of a process-loopback stream, and whether such a stream reports the counter's value with each read, which the helper's first build settles.
- Whether process loopback captures on Windows 10, which Microsoft documents from build 20348 and OBS runs from 2004, build 19041 (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Capturing"), and which [hearing ATC](../product/03-v1-scope.md#hearing-atc) leaves open.
- Whether Raw Input sees an Xbox controller's buttons, which reach Windows through XInput, which no run has tried.
- Whether the helper reads a piped standard input, and whether it closes when the core crashes, which the first build and a bench case settle.
- A development setting that names the program the core starts as its helper, so the bench can run a stand-in that scripts presses and frames: [node 7](../architecture/plan.md#7-testing).

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[helper]: ../architecture/log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker
