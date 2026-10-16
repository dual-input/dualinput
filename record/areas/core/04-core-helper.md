# Core: the core helper

```text
Purpose:     How the core runs the core helper, what features ask of it, and what the helper runs for Raw Input, audio, and speech.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, 02-clients-and-panel-bridge.md, ../network/02-units.md, ../architecture/decisions.md
Decides:     What runs in the helper and what on the loop; what a feature registers and turns on; the pipe's format and messages; when the helper starts, stops, and starts again; what crosses the pipe; the helper's threads, its Raw Input, devices, capture, playback, and speech; its Opus codec and dependencies; the budgets; and the cases for the bench (node 6.5).
```

The core helper runs only what features want of it.
The core-helper-service crate, on the loop, keeps each want a feature registered and turned on, runs the helper while any is on, sends the helper every want whole after each start and each change, and starts it again 2s after it exits.
Across the helper's standard input and output go postcard messages, each after a 4-byte length, and only what a feature asked for crosses: a bound key's or button's press, the next press while the pilot binds one, the mouse while the sim's window is in front, a phrase heard, and Opus frames.
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
| Opus encoding and decoding, the gate that sends nothing in silence, and the adaptive playback buffer | The helper | At 24 kbps a 20ms frame is 60 bytes, 3 KB/s, where 48 kHz mono 16-bit audio is 96 KB/s, about 345 MB an hour in every recording (arithmetic); and the buffer counts samples against the device's clock |
| Telling speech from noise, and recognizing phrases | The helper | Only the phrase heard crosses, so the microphone's audio never reaches the core, as [voice phrases](../product/03-v1-scope.md#voice-phrases) requires |
| Which program to capture, its bitrate, the gate's level, and the buffer's rule | Each feature | The helper carries out what it's given, so ATC audio's design sets those ([6.14](../architecture/plan.md#614-traffic-and-atc)) |

## What a feature registers and calls

```rust
// a sketch: the take-control key and its cue, beside 01-loop-and-edge's
pub fn register(r: &mut Registry) {
    let me = r.unit::<TakeControl>("take-control");
    me.binding(setting::KEY, TakeControl::on_press);   // a setting of the feature's, holding a key or a button
    me.sound(sound::CONTROL_PASSED, include_bytes!("sounds/control-passed.opus"));
}

fn start(me: &mut TakeControl, cx: &mut Cx) {
    cx.helper().watch(setting::KEY, true);             // the helper runs while anything is on
}

fn on_press(me: &mut TakeControl, press: &Press, cx: &mut Cx) {
    // press.down and press.at, the helper's own stamp, so a long press is timed here
}
```

Each want is registered once and is off until its feature turns it on:

| Want | Registered with | Turned on by | What comes back | v1's user |
| --- | --- | --- | --- | --- |
| A binding | A setting's key, whose value is a key or a button, and a handler | `watch(key, on)` | Each press and release, with its stamp | Take-control |
| The next press | Nothing | `next_press(on)` | The next key or button pressed, with a name to show it by, after which it turns itself off | Take-control, while the desktop app binds its key |
| The mouse | A handler | `mouse(Some(pid))`, with the sim's process ID | Left and right presses and releases, and a move every 16ms while the left button is held, each with the cursor's place in the sim's window and the window's size, only while that window is in front | Avatars |
| A capture | An ID and a handler | `capture(id, Some(source))`, with a program's name, a bitrate, and a gate | 20ms Opus frames, each stamped at its first sample, only above the gate; and whether the program is running and captured | ATC audio, on the ATC host |
| A playback stream | An ID | `stream(id, Some(buffer))`, then `frame(id, number, bytes)` for each frame | Nothing | ATC audio, on the other machines |
| A sound | An ID and an Ogg Opus file, embedded in the feature's crate | Always on; `play(id)` plays it | Nothing | Take-control and voice, for their cues and lines |
| Phrases | A list of phrases and a handler | `listen(on)` | The phrase heard, with stamps for when it began and ended | Voice |

- The service numbers each registration in the order units register, as sources are numbered, and only the same build reads those numbers, in the helper and in a replay ([inputs](01-loop-and-edge.md#inputs)).
- A feature's handler gets what came back, through the kernel, once the service's own handler returns ([hooks](01-loop-and-edge.md#hooks)).
- When the clients crate raises a setting changed whose key a binding names, the service sends the wants again, as [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md#the-moments-clients-raises-and-the-calls-it-takes) has it.
- Avatars passes the sim's process ID, read from sim awareness, because the service sits on the sim service's line in the code map's [units](../architecture/02-code-map.md#the-units), and a crate depends only on the lines below its own ([tiers](../architecture/02-code-map.md#tiers)).
- A sound plays only while the helper runs, and a `play` while it's stopped is logged and dropped; v1's cues and lines all play in a session, where take-control's binding keeps the helper running.
- The desktop app lists devices and programs through a command of the service's, which turns on a want of the service's own until the helper answers.
- Deleting a feature deletes its registrations, its sounds among them, and the service never knew what they were for.

## The pipe

- Each message is a 4-byte little-endian length, then the message in postcard, a `ToHelper` on the helper's standard input or a `FromHelper` on its standard output.
  - Every message between cores is postcard ([decision 035](../../decisions/035-channels-declare-how-they-travel.md)), and the kernel already folds outputs' postcard into its hash ([outputs](01-loop-and-edge.md#outputs)).
  - postcard writes an enum's variant as its position (read in postcard 1.1.3, `src/ser/serializer.rs`, `serialize_unit_variant`), which is safe here because the core starts the helper from its own folder, so the same build writes and reads every message, and the `Hello` below catches the case where it doesn't.
- A message is at most 1 MiB, where a second of Opus at 24 kbps is about 3 KB (arithmetic).
  - The edge treats a longer length as the helper's exit: it kills the process and hands up its exit.
  - The helper exits with a code other than 0 on a longer length, or on a message that doesn't parse, since only a bug in our one build sends either.
  - A `FromHelper` that doesn't parse is logged and dropped on the loop, as [a message that doesn't parse](02-clients-and-panel-bridge.md#the-protocol) never stops the core.
- The edge reads each message off the pipe and pushes its bytes as an input, unparsed, and the service parses it on the loop ([inputs](01-loop-and-edge.md#inputs)).

```rust
// a sketch: the message crate's core_helper module
pub enum ToHelper {
    Wants(Wants),                                       // whole, after Hello and at every change
    Sound { sound: u16, ogg_opus: Vec<u8> },            // each, after Hello
    Play { sound: u16 },
    Frame { stream: u16, number: u32, opus: Vec<u8> },
    List,
}

pub struct Wants {
    pub bindings: Vec<(u16, Input)>,     // Input: a key's scan code, or a device's IDs and a button
    pub next_press: bool,
    pub mouse: Option<u32>,              // the sim's process ID
    pub captures: Vec<(u16, Capture)>,   // a program's name, a bitrate, and a gate
    pub streams: Vec<(u16, Buffer)>,     // each stream's buffer, as ATC audio sets it
    pub phrases: Vec<String>,            // listened for while not empty
    pub output: Device,                  // Windows' default, or a device's endpoint ID
    pub microphone: Device,
}

pub enum FromHelper {
    Hello { version: String, hash: String },
    Alive,
    Press { binding: u16, down: bool, at: u64 },
    NextPress { input: Input, name: String, at: u64 },
    Mouse { kind: MouseKind, x: f32, y: f32, width: u32, height: u32, at: u64 },
    Frame { capture: u16, opus: Vec<u8>, at: u64 },
    Capturing { capture: u16, attached: bool },
    Heard { phrase: u16, from: u64, to: u64 },
    Lists { outputs: Vec<DeviceInfo>, microphones: Vec<DeviceInfo>, programs: Vec<String> },
    InUse { output: DeviceInfo, microphone: DeviceInfo },
}
```

- Every `at`, `from`, and `to` is µs on `QueryPerformanceCounter`, the one timeline every process on the PC reads ([times](../architecture/01-spine.md#times)), taken in the helper as it reads the value, as the spine's rule that the reader stamps asks.
  The queue's own stamp on the input comes later, after the pipe.
- The helper's first message is `Hello`, with Crosscheck's version and the message crate's hash as text ([versions](../architecture/01-spine.md#versions)).
  A helper whose version or hash differs is logged with both, stopped, and not started again while this core runs, and the service shows a trouble notice; installed together, the two differ only for a developer's stale build.
- The helper sends `Alive` once it has sent nothing for 2s, and the service has the edge kill a helper it hasn't heard from in 8s, since a hung helper's process doesn't exit ([decision 010](../../decisions/010-clients-message-core-every-2s.md)).
  The core sends the helper no keepalive: its standard input closing tells the helper the core is gone.

## The helper's life

- **It runs while anything is wanted.**
  In v1 that's in a session, where take-control watches its binding, and with no session only while the desktop app binds a key or lists devices, as [decision 019](../../decisions/019-input-and-audio-run-in-helper.md) has it, without the service knowing what a session is.
- **Starting:** the service puts out a start, and the edge starts `crosscheck-core-helper.exe` from the core's own folder through tokio's `process::Command`, with its standard input and output piped and its standard error discarded.
  Its process ID, or the error that stopped it starting, comes back as an input.
  The helper is a Windows program with no console, as p08's was (read in `experiments/areas/architecture/flight/helper/src/main.rs`, `windows_subsystem`).
- **On `Hello`:** the service sends each sound, then the wants, whole.
  So a helper that started again gets everything in one round, as the session crate sends its keys whole on every `LinkUp` ([moments](../network/02-units.md#moments)).
- **On each change:** the service sends the wants again, whole.
- **Stopping:** once nothing is wanted, the service puts out a stop, the edge closes the helper's standard input, and the helper exits; the edge kills it if it hasn't within 1s.
- **Starting again:** when the helper exits while something is wanted, whatever its code, or the edge kills it for 8s of silence, the service starts it again 2s later, through a timer, for as long as something is wanted (user, 2026-10-16).
  If no `Hello` has come 5s after it went down, the service shows a trouble notice naming what's off, such as the take-control key, voice, ATC, and the cues, from what's wanted, and clears it at the next `Hello`.
  A want the helper can't carry out at all, such as Raw Input refusing to register, ends it with a code other than 0, so this covers it too.
- **The core exiting** closes the helper's standard input, so the helper exits with the core, a crash included (unverified; a bench case kills the core).
- **A replay** starts no helper: its messages come from the recording, as every other input does ([running a replay](01-loop-and-edge.md#running-a-replay)).

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

- The helper registers keyboards, joysticks, and gamepads in sink mode, delivered to a hidden window of its own, as p08's did (read in `experiments/areas/architecture/flight/helper/src/main.rs`), and multi-axis controllers, the Generic Desktop page's usage 8 (documented, [HID Usage Tables 1.5](https://usb.org/sites/default/files/hut1_5.pdf)), while a binding or the next press is on, and the mouse while the mouse is on.
  In sink mode, with the sim in front, p08's helper got all 3 Page Down presses a person made and 22 changes of a flight-hardware button's state in 10s (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
- **A key** is bound by its scan code and its E0 flag, the physical key, whatever the keyboard's layout, and the helper names it for the next press through `GetKeyNameTextW`.
  The helper reports a press only for a key that isn't already down, so a held key that repeats its press crosses once.
- **A button** is bound by its device's vendor and product IDs, which the helper reads from the device's name, and its button number, which `HidP_GetUsages` gives, as p08 read both.
  The helper keeps each device's buttons that are down and reports only a change, since four devices nobody touched sent 1,447 reports in 4s (measured on our development machine, 2026-10-08, [architecture log][helper]).
  Two devices of one model share both IDs, so a button bound on one fires from the other too.
- **The mouse** reports what our probes' `mouse.mjs` reports: the left and right buttons' presses and releases, and a move every 16ms while the left is held, each with the cursor's place in the sim's window's client area, from −1 to 1, right and up, and that area's size in pixels (read in [mouse.mjs](../../../experiments/tools/mouse.mjs)).
  The helper finds the window from the sim's process ID, and reports nothing while another window is in front.
- **Nothing else crosses.**
  Every other key, button, and click stays in the helper, so no recording or bug report holds what the pilot typed into another program.

### The devices

- The output device and the microphone are each a setting of the service's: Windows' default device for the role `wasapi` documents as the one "used by most applications" (documented, [wasapi 0.25.0](https://docs.rs/wasapi/0.25.0/wasapi/enum.Role.html)), or a device the pilot picked, kept by its endpoint ID, with its name to show it by.
- On Windows' default changing, the helper opens its stream again on the new default, so a pilot who switches headsets mid-session hears Crosscheck in the new one, which settles that open question in [hearing ATC](../product/03-v1-scope.md#hearing-atc).
- A picked device that's missing plays or listens on Windows' default instead, and moves back when the device returns; the helper reports what it uses in `InUse`, and the service shows a warning naming the missing device while it's gone.
- On `List`, the helper answers with the output devices, the microphones, and the programs that own an audio session, which FS Copilot's "Choose another…" lists for the ATC app (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Choosing the ATC app"), and the service puts them in a slice for the desktop app.
- Every stream runs in shared mode at 48 kHz, mono, and lets WASAPI convert from the device's format; the microphone runs at the rate the recognizer takes.

### Capturing a program

- A capture names a program, and the helper looks for it every 2s until it finds it, then captures its oldest process with its process tree through process loopback, as FS Copilot's capture does (same document, "Choosing the ATC app"), through `wasapi`'s `new_application_loopback_client`.
- It watches that process, because a loopback whose program has exited delivers silence at −90dBFS with no error (same document), and looks for the program again once it's gone.
- It divides the program's level in the Windows mixer back out, up to +20dB, since Windows applies it before the capture (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Stage 3: the audio path works on one machine"), through the session's `ISimpleAudioVolume`, which `wasapi` 0.25.0 doesn't wrap (read in its docs, `AudioSessionControl`), so the helper calls it through `windows`.
- It encodes 20ms frames at the capture's bitrate, sends a frame only while its level is above the gate, keeps sending for the gate's hangover after it falls below, and sends the frame before an onset with it, so the onset isn't clipped, as FS Copilot's capture does (same document, "Encoding and transport").
- Each frame's stamp is the counter value WASAPI reports for its first sample, which `IAudioCaptureClient::GetBuffer` gives in 100ns units (documented, [GetBuffer](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)), converted to µs.
- FS Copilot's 24 kbps, −50dBFS gate, and 300ms hangover (same document) are ATC audio's starting values, which [6.14](../architecture/plan.md#614-traffic-and-atc) sets.
- A capture's source is a program in v1, and the source is an enum, so the microphone sent to the ATC host that [04-room-for-later](../product/04-room-for-later.md#channels) lists adds a variant, and a plugin's own sound is a program as v1's is.

### Playing

- The output thread mixes every playback stream and every sound playing into its one stream.
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

- Only `Heard` crosses the pipe, so the microphone's audio never reaches the core or a recording.

### Opus

The helper encodes and decodes Opus through opus-rs, a pure-Rust port of libopus 1.6, at the version the helper's stage of the build pins (user, 2026-10-16).

- Nothing else in Crosscheck depends on ATC audio or the cues, so we take a young codec there, and the codec sits behind three calls, to encode a frame, decode one, and conceal a lost one, with the same build at both ends.
  If the bench finds it falls short, `opus` 0.4.0, bindings to libopus 1.6.1, takes its place, which changes one crate and no message, and puts CMake on every build machine, since its bundled build compiles libopus through CMake (documented, [opusic-sys](https://github.com/DoumanAsh/opusic-sys)); every libopus binding we found builds that way, and nothing else in our build uses CMake.
- opus-rs claims test suites against libopus, 13 fuzz targets, loss concealment "as libopus does", and speed "competitive with C libopus", and has 53 stars and one maintaining organization (documented, [opus-rs](https://github.com/restsend/opus-rs), read 2026-10-16); we've checked none of it.
- Its notes name a gap in CELT packets of 5 to 6 bytes, which it makes only below about 6 kbps (same page), where a frame at ATC's 24 kbps is 60 bytes (arithmetic).
- Its issue #54, opened against 0.1.37 on 2026-10-08 and closed on 2026-10-11, capped CELT encoded from 24 kHz input at about 20dB of SNR, and left 48 kHz input alone (documented, [issue #54](https://github.com/restsend/opus-rs/issues/54)); the helper encodes 48 kHz.

### Its dependencies

| Crate | For | Because |
| --- | --- | --- |
| `wasapi` 0.25.0 | The devices, capture, and output | p02's helper captured a program through it and played on a device it looked up by name (measured on our development machine, 2026-10-08, [architecture log][helper]); it has default devices by role, device notifications, audio sessions with their process IDs, and event-driven streams (documented, [wasapi 0.25.0](https://docs.rs/wasapi/0.25.0/wasapi/)); 0.26.0 came out on 2026-10-11 |
| `windows` 0.62, the version `wasapi` 0.25.0 brings | Raw Input, `ISimpleAudioVolume`, and finding a program's process | One Windows crate in the helper, with the COM interfaces `windows-sys` lacks, where p08 read Raw Input through `windows-sys` 0.59 |
| `opus-rs` | Opus | [Above](#opus) |
| `ogg` 0.9.2 | Reading the sounds | Pure Rust, at 11.5 million downloads; an Ogg Opus cue is about 30 times smaller than the same cue as 48 kHz 16-bit WAV, which is what the core embeds and sends at each start (arithmetic) |
| The message crate, with postcard | The pipe | [The pipe](#the-pipe) |

## What this changes elsewhere

- The code map's [platform](../architecture/02-code-map.md#the-platform) row gives `core-helper-service` the bindings, captures, and sounds features register; it also holds the next press, the mouse, playback streams, phrases, the output device and microphone settings, and the slice of devices and programs.
- The spine's [left open](../architecture/01-spine.md#left-open) item on the binary format on the helper's standard input and output is settled by [the pipe](#the-pipe).
- A microphone setting sits beside the output device, which 03-v1-scope's settings don't list, and Crosscheck follows Windows' default device when the pilot switches headsets, which settles [hearing ATC](../product/03-v1-scope.md#hearing-atc)'s open question.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The helper's CPU | Under 1% of one CPU core through a busy session with ATC captured or playing, beside the recognizer, whose budget 6.12 sets; FS Copilot's Opus, through Concentus, a C# port of libopus, took 0.2% (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Encoding and transport") |
| The helper's memory | Under 20 MB of private working set, beside the recognizer's model |
| A press | On the queue within 5ms of the helper's stamp, at p99 |
| The pipe | Under 200 messages a second each way: ATC's 50 frames a second, and the mouse's 62 moves a second while the left button is held |
| The recording | The ATC host's captured frames, at most 3 KB/s while ATC talks, and about 11 MB in an hour that never fell silent (arithmetic) |
| Starting again | Running, with every want sent, within 3s of an exit |
| Stopping | Exited within 1s of its standard input closing |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- The helper is killed in a session, and within 3s it runs again, with the take-control key bound as before.
- The helper is suspended, and the core kills it after 8s and starts it again.
- The core is killed, and the helper exits within 1s.
- A helper of another build is logged, stopped, shown in a notice, and not started again.
- A bound key held for 2s crosses as one press and one release.
- A key nobody bound, typed into another program, never crosses the pipe, which the recording shows.
- While the desktop app binds a key, one press crosses, and then nothing.
- Clicks with another window in front never cross.
- Windows' default output device changes while a sound plays, and the sound carries on in the new device.
- A picked headset is unplugged: Crosscheck plays on Windows' default, warns, and goes back when it returns.
- The captured program exits and starts again: the capture stops, then attaches again, and with the program at 30% in the Windows mixer, its frames arrive at full level.
- Audio below the gate never crosses.
- ATC speech recorded from BeyondATC goes through opus-rs at 24 kbps with 5% of frames lost, within the CPU budget; at the helper's stage of the build we listen to it, and a fault a pilot would notice swaps in libopus, as [Opus](#opus) has it.

## Left open

- The detector and the recognizer, and the rate the microphone runs at: [6.12](../architecture/plan.md#612-control).
- The bitrate, the gate's level and hangover, the playback buffer's rule, and how the ATC app is picked: [6.14](../architecture/plan.md#614-traffic-and-atc).
- Whether WASAPI converts the format of a process-loopback stream, which the helper's first build settles.
- Whether process loopback captures on Windows 10, which Microsoft documents from build 20348 and OBS runs from 2004, build 19041 (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Capturing"), and which [hearing ATC](../product/03-v1-scope.md#hearing-atc) leaves open.
- Whether Raw Input sees an Xbox controller's buttons, which reach Windows through XInput, which no run has tried.
- Whether the helper's standard input closes when the core crashes, which a bench case settles.
- A development setting that names the program the core starts as its helper, so the bench can run a stand-in that scripts presses and frames: [node 7](../architecture/plan.md#7-testing).

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[helper]: ../architecture/log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker
