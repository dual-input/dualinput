# 017: The core writes the WASM module's control slot every 200ms

In a session, the core writes the WASM module's control slot every 200ms, with the session's state and a counter, and each kind of message has a SimConnect client data area, a data slot, of its own.
The module leaves its version in a slot when it loads, and writes a counter every second.
Decided by the user on 2026-10-08, in node 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-writes-the-wasm-modules-control-slot-every-200ms).

## Context

Our WASM module holds every machine's aircraft still in preflight and writes the following aircraft, and when it hasn't heard from the core for 1s, on any machine in a session, it unfreezes the aircraft and clears every variable of ours that holds something back ([decision 005](005-wasm-module-writes-following-aircraft.md)).
Node 1.1.2 raised how the module hears from the core every second on every machine in a session ([architecture plan](../areas/architecture/plan.md#12-communication)), and the core has to tell a running module from a missing or stopped one ([01-spine](../areas/architecture/01-spine.md#how-the-core-knows-a-component-is-alive)).
The module can't open a socket, so data slots are its link ([05-02](../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)).

## Options

1. **One data slot that every kind of message shares.**
   Whether two writes to one slot in one frame both arrive is unmeasured ([04-03](../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)), so a message written in the same frame as another could be lost.
2. **A slot for each kind of message, with each side's liveness read from what the slots hold.**
   A slot keeps its last value after its writer restarts (documented, [04-03](../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)), so a value that stays put can't tell a stopped writer from a running one.
3. **A slot for each kind of message, a control slot the core writes every 200ms with a counter, and a counter the module writes every second.**
   The control slot takes 5 writes a second, and a slot carries more: fsc-editor's module streamed values to its app through one at 15Hz (read in fsc-editor, `link/src/module.cpp`, `k_interval_seconds`; measured on MSFS 2024, 2026-08-27, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal").

## Decision

Option 3.
FS Copilot's app writes its module's control slot every 200ms (read in the FS Copilot fork, `FsCopilot/Connection/SimClient.cs`, the constructor), and its module unfreezes after 1s with none, which we've flown with ([decision 005](005-wasm-module-writes-following-aircraft.md)).
Only a counter that moves tells the core the module is still running, and the version the module leaves at load tells a missing module from a present one ([01-spine](../areas/architecture/01-spine.md#the-wasm-module)).

## What it commits us to

- The module learns from the control slot's state that a session ended, and takes 1s with no write to mean the core stopped ([01-spine](../areas/architecture/01-spine.md#the-wasm-module)).
- No two kinds of message share a slot, so each new kind between the core and the module takes a slot of its own.
- During a flight load, round trips through the module reached 2.8s (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), past the module's 1s timeout, after which it undoes our state as if the core had stopped.
  How the module takes the session up again after a load, and how the core keeps the counter going quiet during a load from counting as trouble, are for the stage of step 8 that designs plugins and the hosts in the sim ([01-spine](../areas/architecture/01-spine.md#left-open)).
