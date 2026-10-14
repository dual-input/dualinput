# 024: A time in a message is µs on the sender's PC's monotonic clock

Every stamp in a message, the moment a value was read, is a whole number of µs on Windows' `QueryPerformanceCounter` on the sender's PC, whose ticks become µs through `QueryPerformanceFrequency`, and every span in a message is a whole number of µs, whatever clock measured it.
A value is stamped when it's read, a receiver reads a sender's stamps through an offset it keeps estimating for that sender, and no frame count crosses between machines.
Decided by the user on 2026-10-09, in node 1.4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-time-in-a-message-is-µs-on-the-senders-pcs-monotonic-clock).

## Context

The sync design gives times in both frames and milliseconds: the duplicate filter's window is 3 frames and at most 200ms ([02-live-sync](../areas/sync/02-live-sync.md#keeping-a-change-from-applying-twice)), so [node 1.4](../areas/architecture/plan.md#14-shared-conventions) of the architecture plan asks for the form of a time.
A stamp is read on one PC and compared on another, and not every component can read the same clock: a page in the sim can't read `QueryPerformanceCounter`, and a plugin reads only QuickJS-ng's `Date.now()` and `performance.now()`, which aren't shown to count the same ticks ([01-spine](../areas/architecture/01-spine.md#times)).

## Options

For the clock a stamp is on:

1. **The wall clock, in UTC.**
   A stamp on it moves when Windows sets that clock (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)).
2. **A frame count.**
   Each sim runs its own frames ([08-01](../learn/foundations/08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)), so a frame on one machine names no moment on another.
3. **`QueryPerformanceCounter` on the sender's PC.**
   It counts from the PC's start, gives consistent readings across processes, never goes backward, and ignores changes to the system clock (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)).
   Two PCs' counters can part by about 8.6s a day when both crystals sit 50 ppm off in opposite directions, before Windows compensates at start ([01-spine](../areas/architecture/01-spine.md#times)), and three home PCs' counters parted by up to 39 ppm, 3.4s a day ([decision 038](038-clock-offset-from-timed-exchange.md)), so a receiver can't rely on one offset estimated once.

For the unit:

1. **Whole ms.**
   A stamp rounds by up to 1ms, a quarter of a frame at 240 fps ([01-spine](../areas/architecture/01-spine.md#times)).
2. **Whole µs.**
   A stamp rounds by under 1µs, and counted in µs from the PC's start it fits a JavaScript number exactly for about 285 years ([01-spine](../areas/architecture/01-spine.md#times)).
   At 10 MHz, ticks times 1,000,000 passes a signed 64-bit integer after about 10.7 days of the PC running, so the conversion runs in 128 bits (same section).

For when a value is stamped:

1. **As its message arrives or is parsed.**
   Samples stamped as they arrived carried the network's jitter into our traffic work's paths ([08-05](../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)), and fsc-editor's values stamped as they were parsed landed 0ms to 3ms apart, in the order they were parsed (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — The right answer was being sorted last for arriving 2 ms early").
2. **As it's read, by the component that reads it.**
   A page or a plugin can't read the counter, so the core stamps their messages as they arrive, the nearest it comes to when the value was read ([01-spine](../areas/architecture/01-spine.md#times)).

## Decision

`QueryPerformanceCounter`, in whole µs, stamped as each value is read.
The counter ignores changes to the system clock, so a restarted core goes on along the timeline it left, and a receiver reads each sender's stamps through an offset it keeps estimating, since two PCs' counters drift apart.
Stamping when a value is read keeps the network's jitter and the order of parsing out of the times a receiver draws a path along.

## What it commits us to

- The conversion to µs runs in 128 bits, so it doesn't overflow on a PC that has run for weeks.
- The core stamps each message from a page in the sim or a plugin, and each value it requests through SimConnect, as it arrives, and a page that needs a span measures it on its own clock and sends the span.
- The core stamps each data-slot write from our WASM module as it arrives, unless the flight-model sync has the module stamp on WASI's monotonic clock, which counts the counter's ticks from an origin near the sim's start (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), so its stamps reach the core's timeline through one offset per run of the sim.
- A pace in frames counts the frames of the machine that runs it.
- Wall-clock time, in UTC, appears in a message only where a person reads it, and in the session file only inside a run's name, which the core compares and never measures with.
- This decision leaves out how the offset is estimated, what a higher restart count does to it, and how far two PCs' counters part in practice, for the flight-model sync and the node on how the cores reach each other; [decision 038](038-clock-offset-from-timed-exchange.md) answers them.
- It leaves out whether the module stamps on its own clock, which event sets that clock's 0, and how the core estimates its offset, for the flight-model sync ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It leaves out how far the core's arrival stamp trails the sim's read for a page's message, and which clock a page measures a span on ([01-spine](../areas/architecture/01-spine.md#left-open)).
