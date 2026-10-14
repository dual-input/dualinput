# 005: Our WASM module writes the following aircraft

Our WASM module holds every machine's aircraft still in [preflight](../areas/product/03-v1-scope.md#preflight), and on a following machine freezes the aircraft and writes the flying machine's pose and velocities inside the sim's frame.
When it hasn't heard from the core for 1s, on any machine in a session, it unfreezes the aircraft, as [flight-model sync](../areas/product/03-v1-scope.md#flight-model-sync) requires, and clears every variable of ours that holds something back ([01-spine](../areas/architecture/01-spine.md#what-moves-them)).
Decided by the user on 2026-10-07, in node 1.1 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#our-wasm-module-writes-the-following-aircraft).

## Context

v1 flies the traditional way: the following machine freezes its aircraft's position, altitude, and attitude, and takes the flying machine's values ([take-control key](../areas/product/03-v1-scope.md#take-control-key)).
In preflight, every aircraft in the crew, the PF's included, holds its position, altitude, and attitude ([preflight](../areas/product/03-v1-scope.md#preflight)).
A frozen aircraft keeps integrating its own velocities, so the following machine writes them along with the pose, every frame: with the pose alone, a replayed Baron's airspeed was 22 kt off within two minutes, where written velocities kept it within 3.2 kt (measured on MSFS 2024, 2026-10-03, [flight-model log](../areas/flight-model/log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)).
If Crosscheck stops on the following machine, the aircraft unfreezes within about 1s and nothing writes to it afterward ([flight-model sync](../areas/product/03-v1-scope.md#flight-model-sync)).

Where the writes come from decides whether the aircraft moves smoothly.
Written from outside the sim each frame, the pose and velocities held on a parked Baron ([flight-model log](../areas/flight-model/log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)).
But an object written from outside stuttered in a moving cockpit (measured on MSFS 2024, 2026-10-03, [avatars log](../areas/avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)), and one written from inside the sim's frame by a WASM module kept up with a flying aircraft (measured on MSFS 2024, 2026-10-03, [avatars log](../areas/avatars/log.md#2026-10-03-written-from-inside-the-sims-frame-by-a-wasm-module-an-object-keeps-up-with-a-flying-aircraft)).

## Options

1. **Write the following aircraft from outside the sim, through the core's SimConnect connection.**
   An object written that way stuttered in a moving cockpit, and no lead steadied it ([avatars log](../areas/avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)); nobody has flown the following aircraft itself written that way.
   Unfreezing the aircraft once the core stops would also need code that outlives the core and can reach the aircraft, and the watcher has no SimConnect link, since it notices the sim from the operating system ([01-spine](../areas/architecture/01-spine.md#components)).
2. **Write it from inside the sim's frame, in our WASM module, as FS Copilot's module does.**
   FS Copilot's module freezes the aircraft, writes the pose and four velocities, `A:VELOCITY BODY Y` and `Z` and `A:VELOCITY WORLD X` and `Z`, from samples 400ms in the past, and unfreezes the aircraft after 1s with no word from its app (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_physics`, and `wasm_module.h`, `k_delay_sec`), and we've flown with it (from our experience with FS Copilot).
   It leaves out the body X and rotation velocities, which a frozen aircraft keeps integrating ([flight-model log](../areas/flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)).

## Decision

Option 2.
Writes from inside the sim's frame keep up with a flying aircraft where writes from outside stuttered, and our WASM module runs inside the sim, so it outlives the core and can still reach the aircraft to unfreeze it.
Our probe module, `crosscheck-p12-follow`, held a figure in its seat from inside the sim's frame ([avatars log](../areas/avatars/log.md#2026-10-03-nose-up-and-right-wing-down-are-negative-and-turned-by-full-attitude-a-wasm-written-figure-holds-its-seat)), and the product's figures need the same module, since Crosscheck's own features hold avatars through it rather than through the aircraft's files ([decision 001](001-changing-other-developers-packages.md)).

## What it commits us to

- On a following machine, the module writes the pose and the body and rotation velocities every frame ([flight-model sync](../areas/product/03-v1-scope.md#flight-model-sync)), among them the body X and rotation velocities that FS Copilot's module leaves out.
- In a session, the module hears from the core through the control slot the core writes every 200ms ([decision 017](017-core-writes-control-slot-every-200ms.md)).
- During a flight load, round trips through the module reached 2.8s, past its 1s timeout (measured on MSFS 2024, 2026-10-09, [architecture log](../areas/architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), after which the module undoes our state as if the core had stopped.
  That costs a v1 session nothing, because a load that starts while the module holds or writes an aircraft unloads that aircraft ([01-spine](../areas/architecture/01-spine.md#left-open)).
  How the module takes the session up again when the core's writes come back is for the part that designs plugins and the hosts in the sim (same section).
- This decision leaves out whether the following aircraft itself, written from outside the sim, stutters in flight, which nobody has flown, and we won't, because nothing would be gained (user, 2026-10-07).
