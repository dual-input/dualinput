# 019: The core's input and audio work runs in a helper it starts

The core's work with Windows input and audio, through Raw Input, the microphone, ATC capture, playback, and the speech recognizer, runs in the helper, a program of its own.
The core starts the helper in a session and while the desktop app binds a key or lists the output devices, starts it again if it exits, and talks to it over its standard input and output.
Decided by the user on 2026-10-08, in node 1.3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-cores-input-and-audio-work-runs-in-a-helper-it-starts).

## Context

The core reads the pilot's keyboard and flight hardware for the take-control input ([decision 006](006-core-catches-take-control-input.md)), and runs Dual Input's audio: the microphone and the speech recognizer, the ATC app's audio captured by process, and playback on the device the pilot picks ([decision 007](007-core-runs-audio.md)).
Node 1.1 raised whether that native code runs in the core's own process or in a process the core supervises, since a crash in native code inside the core's process takes the core down, and the pilot out of the session until the core restarts ([architecture plan](../areas/architecture/plan.md#13-language-and-toolchains)).

## Options

1. **In the core's own process.**
   A crash in that code, such as in a speech recognizer's C or C++ library, takes the core down, and the pilot out of the session until the watcher restarts the core and they rejoin ([01-spine](../areas/architecture/01-spine.md#the-helper)).
2. **In the helper, a program the core starts and restarts.**
   A crash there costs the take-control input, the figure's hand, and the audio only until the core restarts the helper ([01-spine](../areas/architecture/01-spine.md#the-helper)), and the work's messages cross between two processes, over the helper's standard input and output.

## Decision

Option 2.
The core restarts a helper that crashes, and the session goes on.
Our probes already read Raw Input from a program they start, line by line over its standard output ([mouse.mjs](../../experiments/tools/mouse.mjs)), and a Rust helper did the helper's work: it played a tone on a device it looked up by name, captured it through process loopback, and received keys through Raw Input in sink mode (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)).
In a flight, with the sim in front, a later build got all 3 Page Down presses a person made, and 22 changes of a flight-hardware button's state in 10s (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).

## What it commits us to

- With no session, the helper doesn't run, except while the desktop app binds a key or lists the output devices ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
- The helper sends the core a message every 2s, and the core restarts a helper it hasn't heard from in 8s, because a hung helper's process doesn't exit ([decision 010](010-clients-message-core-every-2s.md)).
- A message over the helper's standard input and output is binary and prefixed with its length ([decision 025](025-messages-in-one-rust-crate.md)).
- This decision leaves out the fields of the helper's messages, which the crate the Rust components share defines for both ends ([01-spine](../areas/architecture/01-spine.md#messages-between-components)), and their binary format, a choice inside the core and the helper ([01-spine](../areas/architecture/01-spine.md#left-open)).
