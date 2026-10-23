# 047: The sandbox's time limit counts QuickJS-ng's interrupt checks, not the clock

A call into a profile's script or a plugin stops after a fixed count of the interrupt checks QuickJS-ng makes, which stage 12 sets to about 100ms of a call on our development machine, where [decision 046](046-sandbox-runtimes-and-limits.md) stops it at 100ms by the clock.
This changes 046's time limit alone: its runtimes, its memory limit, its cap on a value, and what a call at a limit does all stay.
Decided by the user on 2026-10-23, in a review of the designs against CLAUDE.md's rule on mechanisms ([architecture log](../areas/architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).

## Context

A clock read on the loop is the one place a run and its replay could part with no bug to find, so [one loop](../areas/architecture/02-code-map.md#one-loop) allows one: the sandbox's interrupt handler calls a check the core's edge hands it, which reads the clock, and the recording holds the count of interrupt calls at which each stopped call stopped, so a replay stops at the same one.
That takes an edge hook into the sandbox, a record of its own in every recording, and a run and a replay that stop a call by two paths.
QuickJS-ng calls the interrupt handler once every 10,000 ticks of its own counter (read in `quickjs.c`, `JS_INTERRUPT_COUNTER_INIT`, [architecture log][loop]), so the count of checks a call makes repeats in a replay of the same inputs, though where a call's first check lands depends on every call into the context before it ([plugins and the sandbox](../areas/plugins/01-plugins.md#the-sandbox)).

## Options

1. **100ms by the clock, with the count recorded where a call stopped.**
   Live and replay take two paths, and a healthy call on a PC MSFS keeps busy can wait past the limit and stop, which 046 answered by setting the limit far above a healthy call's time (user, 2026-10-12).
2. **A fixed count of interrupt checks.**
   A run and its replay stop a call at the same check through one path with nothing recorded, and a healthy call stops nowhere a busy PC slows it; a runaway call on a slower PC holds the loop longer than 100ms before it stops.

## Decision

Option 2.
The limit is for bugs, a loop that never ends, and not for timing a healthy call (046's context), so the work a call does is the right thing to count.

## What it commits us to

- The loop reads no clock: the sandbox's check counts, and the core's edge hands the sandbox nothing.
- A recording holds no sandbox's stops, so [what a recording holds](../areas/core/01-loop-and-edge.md#what-a-recording-holds) loses that record.
- Stage 12 measures how long the count's checks take on our development machine, sets the count to about 100ms there, and records it in the plugins' log.
- A call at the limit fails as 046 has it: a write function's write fails and its entry is flagged.

[loop]: ../areas/architecture/log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
