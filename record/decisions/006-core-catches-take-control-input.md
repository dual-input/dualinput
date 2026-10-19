# 006: The core catches the take-control key and buttons

The core reads the pilot's keyboard and flight hardware through Windows' input APIs, by way of the helper it starts ([decision 019](019-input-and-audio-run-in-helper.md)), rather than mapping the input through SimConnect.
Decided by the user on 2026-10-07 and 2026-10-08, in nodes 1.1 and 1.3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-catches-the-take-control-key-and-buttons).

## Context

A pilot takes control with a button in Dual Input's app or its EFB app, a keyboard key, or a button on their flight hardware, and binds the key or hardware button in Dual Input's settings, not the sim's, as a single press or a long press ([take-control key](../areas/product/03-v1-scope.md#take-control-key)).
So Dual Input needs each press and release, and one of its components has to catch them, which the record didn't name before [node 1.1](../areas/architecture/plan.md#11-components).

## Options

1. **A shortcut API in the desktop app, such as Electron's `globalShortcut`.**
   It reports no release (documented in fsc-editor, `docs/sim-vars/08-marks.md`), and it would stop whenever the pilot closes the optional desktop app.
2. **Map the input through SimConnect.**
   `SimConnect_MapInputEventToClientEvent_EX1` takes an event for the press and one for the release (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`, `SimConnect_MapInputEventToClientEvent_EX1`), and the user ruled it out as a hack (user, 2026-10-07).
3. **Read the keyboard and flight hardware through Windows' input APIs, for the core.**
   Native input code in the core's own process takes the core down if it crashes, and the pilot out of the session until the core restarts, which node 1.1 raised for [node 1.3](../areas/architecture/plan.md#13-language-and-toolchains).

## Decision

Option 3, with the input code in the helper, a program of its own that the core starts and restarts ([decision 019](019-input-and-audio-run-in-helper.md)).
Through Raw Input in sink mode, with the sim in front, a Rust helper got all 3 Page Down presses a person made, and 22 changes of a flight-hardware button's state in 10s, named by its device's vendor and product ID (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
The core runs whether or not the desktop app is open ([decision 002](002-core-starts-with-every-sim-run.md)), so the key works with the desktop app closed.

## What it commits us to

- The binding is a setting the core keeps in its data folder, and the desktop app edits it by command ([decision 016](016-core-keeps-pilots-settings.md)).
- The helper reads the take-control input in a session, and with no session runs only while the desktop app binds a key or lists the output devices ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
- A crash in the helper costs the take-control input until the core restarts it, and the session goes on ([01-spine](../areas/architecture/01-spine.md#the-helper)).
