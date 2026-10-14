# 041: A core that crashes comes back as a late joiner

A core that crashes while its sim keeps running comes back as a sim that closed does: the watcher restarts it, it counts its pilot as having left the flight, passes control on if they held it, and rejoins its pilot as a late joiner, and the crew's notice asks for a bug report.
Because the aircraft didn't reload, each shadow value starts at the flying machine's, and the aircraft counts as settled at once.
Decided by the user on 2026-10-11 and 2026-10-12, in node 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-core-that-crashes-comes-back-as-a-late-joiner).

## Context

The watcher restarts a core that exits while the sim runs ([decision 002](002-core-starts-with-every-sim-run.md)), and the restarted core keeps its pilot's ID and counts its restarts ([decision 023](023-pilot-id-and-restart-count.md)).
It has lost everything the sync engine held only in memory: its vector clock, each state entry's conflict stamp, its shadow values, which it can't read back from the aircraft, its state object, its record of which messages it had applied, the messages it held back for their predecessors, and its echo tokens ([01-spine](../areas/architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
It has also lost what it had sent that no machine had received, and if it was down longer than 1s, our WASM module has unfrozen the aircraft and cleared our variables that hold something back (same section).
The spine left node 3 to say how such a core recovers, and what it keeps beyond the session file ([01-spine](../areas/architecture/01-spine.md#left-open)).

The PF is the pilot flying, the flying machine is the PF's, and a following machine is any other pilot's ([03-v1-scope](../areas/product/03-v1-scope.md)).
A shadow value is Crosscheck's own copy of a value the aircraft keeps out of sight, counted from the events that change it ([01-profile-entries](../areas/sync/01-profile-entries.md#keeping-a-shadow-value)).

## Options

1. **Recover in place, and replay what the pilot missed,** as [the connection](../areas/product/03-v1-scope.md#the-connection) does for a returning pilot whose sim kept running, which the user first chose for a crashed core too (user, 2026-10-09).
   Recovering in place needed a journal written before every send, a rebuild of four structures, a comparison with the sim, and a wait for the panels (user, 2026-10-12).
2. **Come back as a late joiner, as a sim that closed does ([decision 039](039-cut-link-replays-others-late-join.md)).**
   A PF whose core crashes loses control, and their aircraft then follows the new PF's, so it jumps back by the seconds the core was down, and presses either pilot made in that window are lost (user, 2026-10-12).
   Each shadow value is right only if its pilot didn't touch that control while the core was down ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#known-limits)).

## Decision

Option 2.
Crosscheck aims for a core that never crashes, so a crash is a bug to report and fix rather than a state to recover from, and a late join reuses the path a sim crash already takes (user, 2026-10-12).
A restarted core's aircraft kept the controls it had, which matched the flying machine's, so the flying machine's shadow values are the nearest to its own, and nothing restores itself in an aircraft that didn't load, so it counts as settled at once ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#a-core-that-restarts)).

## What it commits us to

- The restarted core's catch-up starts at once, since the sim is still in the flight.
- The recording's minimal mode keeps the cockpit stream, from which catch-up takes its order ([decision 040](040-catch-up-first-final-value-order.md)).
- The session file needs nothing beyond what [decision 023](023-pilot-id-and-restart-count.md) puts in it.
- It answers the spine's question of how a restarted core recovers, and what it keeps beyond the session file ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It leaves out a shadow value's turns its pilot made while the core was down, and the presses either pilot made in that window, which are lost.
