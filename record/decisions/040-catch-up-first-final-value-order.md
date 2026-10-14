# 040: Catch-up writes in the order the flying machine's cockpit first took each value

Catch-up writes each entry at the flying machine's value, in the order the flying machine's cockpit first took each of those values, read from its recording, with entries it took before the session or never changed first.
It carries the flying machine's vector clock, and ends once it has made its last write and its aircraft has settled, whichever comes later.
Decided by the user on 2026-10-11 and 2026-10-12, in node 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#catch-up-writes-in-the-order-the-flying-machines-cockpit-first-took-each-value).

## Context

The PF is the pilot flying, the flying machine is the PF's, and a following machine is any other pilot's ([03-v1-scope](../areas/product/03-v1-scope.md)).
Catch-up brings a cockpit that missed changes, or never had them, to the flying machine's state: at the end of preflight, for a late joiner, and for a pilot back from a sim, core, or PC that went down ([decision 039](039-cut-link-replays-others-late-join.md)).
It writes each entry once, at the flying machine's value, so an APU the PF started, stopped, and started again starts once ([03-catch-up](../areas/sync/03-catch-up.md#catching-up-state)).

The order of those writes matters wherever an interlock does: a control that acts once, when it's set, and only if another control is already set.
On a hypothetical aircraft whose APU master, written before the battery, tries to start the APU, fails, and leaves the switch reading on, the check finds no mismatch to retry, and the APU stays off; which real aircraft behave like this is unverified ([03-catch-up](../areas/sync/03-catch-up.md#choosing-the-order)).
03-catch-up weighed two orders, leaned toward the second, and left the choice to step 7.

A review of node 3's answer found two more gaps: a catch-up of a settled aircraft had no end, and an input event reports no value until it changes ([architecture plan](../areas/architecture/plan.md#3-sync-and-the-session)).
The spine also left open how the settle rule runs in a session started after the aircraft loaded ([01-spine](../areas/architecture/01-spine.md#left-open)).

## Options

The order:

1. **The order the PF last changed each entry.**
   The stamps from the conflict rule already record it, so it needs nothing more.
   Say the PF turned the battery on, then the APU master, then cycled the battery off and on: the battery's last change came after the APU's, so this order writes the APU master first, while the catching-up machine's battery is still off, and on the hypothetical aircraft the APU stays off with nothing flagged ([03-catch-up](../areas/sync/03-catch-up.md#choosing-the-order)).
2. **The order each entry first took the value it holds now.**
   It needs the session's history, kept in the recording.
   In the same case, the battery first took "on" before the APU did, so this order writes the battery first, and the APU starts (same section).

When a catch-up ends:

3. **When the aircraft has settled,** 03-catch-up's rule ([03-catch-up](../areas/sync/03-catch-up.md#while-catch-up-runs)).
   An aircraft that settled long ago, at the end of preflight, for an ex-PF, or after a core restart, would end its catch-up the moment it began, while its writes were still landing.
4. **Once it has made its last write and its aircraft has settled, whichever comes later.**

## Decision

Options 2 and 4.
Where an interlock makes order matter, option 2 writes the battery before the hypothetical APU master, and where order doesn't matter it costs nothing, so no probe of interlocks could change the choice ([03-catch-up](../areas/sync/03-catch-up.md#choosing-the-order)).
The history it needs is there, since the recording keeps every change of the session ([recording and bug reports](../areas/product/03-v1-scope.md#recording-and-bug-reports)).
Option 4 gives a catch-up of a settled aircraft an end that waits for its writes.

## What it commits us to

- Entries the flying machine took before the session began, or never changed, go first.
- Catch-up carries the flying machine's vector clock, which the catching-up machine takes for every counter but its own, which never goes back, so every message the state already holds drops as a copy.
- If control passes between other pilots while a catch-up runs, it starts again from the new flying machine, skipping what already matches.
  Control can't pass to the catching-up pilot ([decision 039](039-cut-link-replays-others-late-join.md)), since their changes aren't sent while catch-up runs ([03-catch-up](../areas/sync/03-catch-up.md#while-catch-up-runs)), so a cockpit taken over halfway would differ from the others' with nothing sent to bring them together.
- The last write counts as made once the engine has carried out every entry's write, a stepping write's last step included; whether each write landed is for sync's stage of step 8 ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#catch-up)).
- The core reads an input event's value once when it starts watching it, so a catch-up can tell whether that entry matches.
  Subscribing to an input event reports nothing until its value changes (fsc-editor, `docs/sim-vars/build/v1-log.md`), and our Rust client read one in a flight (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- A session started after the aircraft loaded counts the settle rule's 30s floor from Ready to fly and its 15s quiet window from the profile's load.
- v1's catch-up pipeline has one step, catching up state.
  The simulation rate and pause reach a late joiner as session keys, the time and date aren't synced in v1, and traffic reaches them as the host's objects, which a receiver spawns whenever its sim is in a flight.
- Every machine's recording keeps the cockpit stream, its minimal mode included, since catch-up takes its order from the flying machine's recording ([decision 041](041-core-crash-comes-back-as-late-joiner.md)).
- It settles [03-catch-up](../areas/sync/03-catch-up.md#choosing-the-order)'s order, and the spine's question of settling in a session started after the aircraft loaded ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It leaves the pipeline's later steps to the picks that need them ([04-room-for-later](../areas/product/04-room-for-later.md#a-catch-up-pipeline)).
