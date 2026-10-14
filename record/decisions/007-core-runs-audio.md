# 007: The core runs Crosscheck's audio

The core captures the pilot's microphone and runs the speech recognizer, captures the ATC app's audio by process, and plays ATC and Crosscheck's own sounds on the device the pilot picks, in the helper the core starts ([decision 019](019-input-and-audio-run-in-helper.md)), so the desktop app stays optional.
Decided by the user on 2026-10-07 and 2026-10-08, in nodes 1.1 and 1.3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-runs-crosschecks-audio).

## Context

Crosscheck's audio does three things in v1:

- The ATC app's audio on the traffic host's machine, captured by process, plays on every other pilot's machine, on the output device each pilot picks, with no window needed, so a pilot in VR hears it too ([hearing ATC](../areas/product/03-v1-scope.md#hearing-atc)).
- Crosscheck's own sounds, such as the handover cues, play on the same device (same section).
- The PF offers control by voice and the PM answers, heard through each pilot's own microphone by a recognizer that runs locally ([voice phrases](../areas/product/03-v1-scope.md#voice-phrases)).

Node 1.1 had to place that work in one of Crosscheck's components.

## Options

1. **The desktop app, as FS Copilot's desktop process does it.**
   FS Copilot's desktop process captures the ATC app by process with WASAPI's process loopback and plays it back (read in the FS Copilot fork, `FsCopilot/Audio/`), and the fork's `tools/AtcAudio` captured BeyondATC that way in a live flight (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
   The desktop app is optional, so ATC and the handover cues would stop whenever the pilot closes it.
2. **The core.**
   Node 1.1 raised for [node 1.3](../areas/architecture/plan.md#13-language-and-toolchains) whether its native audio code runs in the core's own process or in a process the core supervises, since a crash in native code inside the core's process takes the core down, and the pilot out of the session until the core restarts.

## Decision

Option 2, with the audio in the helper ([decision 019](019-input-and-audio-run-in-helper.md)).
ATC and the handover cues play with no window open, so a pilot in VR hears them ([hearing ATC](../areas/product/03-v1-scope.md#hearing-atc)), and the core runs whether or not the desktop app is open ([decision 002](002-core-starts-with-every-sim-run.md)).
The capture FS Copilot's process does works from Rust: a Rust build captured another process through process loopback at the level it played, and played a tone on a device it looked up by name (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)).

## What it commits us to

- The output device is a setting the core keeps in its data folder, and the desktop app edits it by command ([decision 016](016-core-keeps-pilots-settings.md)).
- The helper runs the audio in a session, and with no session runs only while the desktop app binds a key or lists the output devices ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
- A crash in the helper, such as in a speech recognizer's C or C++ library, costs the audio until the core restarts it, and the session goes on ([01-spine](../areas/architecture/01-spine.md#the-helper)).
- No run has captured a microphone or played on a device other than the default ([architecture log](../areas/architecture/log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)), or run the helper's audio in a flight ([architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- This decision leaves the choice of recognizer to the building of the voice phrases ([the product plan](../areas/product/plan.md#6-probes-that-retire-architecture-risks)), and how Crosscheck tells speech from noise before it listens for a phrase to control's stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
