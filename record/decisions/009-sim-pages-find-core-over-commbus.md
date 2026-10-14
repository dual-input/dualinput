# 009: The sim's pages find the core over the CommBus and talk to it over a WebSocket

The core announces its port and whether a session runs on the CommBus every 2s, and at once when a session starts or ends, and a page in the sim that hears it opens a WebSocket to the core on 127.0.0.1.
Between the core and our pages, the CommBus carries only those announcements, and the core listens on a port Windows picks.
Decided by the user on 2026-10-08, in node 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-sims-pages-find-the-core-over-the-commbus-and-talk-to-it-over-a-websocket).

## Context

Four of our components run in the sim's pages, the documents the sim runs in Coherent GT: the EFB app, the banner panel, the menu script, and the panel bridge in every cockpit panel ([01-spine](../areas/architecture/01-spine.md#components)).
Each has to find the core and learn whether a session runs, and every link ends at the core ([decision 008](008-every-link-ends-at-core.md)).
Every page held a WebSocket to a program on the PC: all 14 the inspector listed in the main menu and all 32 in a flight in the A2A PA-24, mainUi and the 16 cockpit panels among them (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).
A development core gets a data folder of its own and runs beside the pilot's, each with its own ports and identity ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)), so a page has to find its own pilot's core.

## Options

1. **Announce the port in an `L:` variable, with a session flag beside it,** as node 1.2.1's design under test did (user, 2026-10-08).
   The menu's page, mainUi, can't read an `L:` variable, and a flight load reset ours to 0 (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).
2. **Listen on a fixed port, or on a range the pages scan.**
   Another program could take a fixed port first.
   FS Copilot's panels scan ports 9020 to 9024 and take whichever instance answers first, one of the three reasons its test bench can't run beside a live sim (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").
3. **Have each page ask the core for its port over the CommBus.**
   Calls from 29 of 31 pages in a flight reached our probe client, but a call the toolbar's page made before its listener reported ready never arrived (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
4. **Carry the session itself over the CommBus.**
   A CommBus call reaches every page listening on its name, so every page would sort every message, as every panel did on FS Copilot's CommBus path (documented in the FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, "What exists"), and the CommBus's limits for a SimConnect client are unmeasured.
5. **Have the core announce its port on the CommBus, and each page that hears it open a WebSocket.**
   FS Copilot refused to announce its port over its CommBus path, because a bus that's down would take the WebSocket with it (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.2 Port discovery: range scan 9020–9024").
   mainUi has no `Coherent`, so our menu script takes the core's calls the way mainUi's own view listeners take events, a route that rests on the sim's own page code (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`).

## Decision

Option 5.
In the main menu, 13 of the 14 pages heard a SimConnect client's CommBus calls, mainUi, the toolbar's page, and the EFB's among them, and in a flight, 30 of 31, among them all 16 of the A2A PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
The page that heard nothing, "transition", runs none of our code ([01-spine](../areas/architecture/01-spine.md#finding-the-core)).
The core announces rather than waits to be asked, so a page that loaded before the core hears the next announcement.

FS Copilot's CommBus path ran through its WASM module, while ours runs through the core's own SimConnect connection, without which the core has no sim to serve.
The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so among programs outside the sim, only a SimConnect client of the pilot's sim can call on its CommBus.
So the core needs no fixed port that another program could take first, and a development core attached to a stand-in sim can't reach the real sim's pages, which no run has tried.
The session travels on the WebSocket, where a socket in each of the 16 cockpit panels cost no frame time we could measure ([interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).

## What it commits us to

- Our menu script triggers `ADD_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS` and takes the core's calls as `EVENT_FROM_VIEW_LISTENER`, and a page that has the sim's `common.js` but not its `Services/CommBus.js` loads `CommBus.js` and listens through `RegisterCommBusListener` ([01-spine](../areas/architecture/01-spine.md#finding-the-core)).
- Apps outside the sim hold no SimConnect connection, so they find the core through a port file instead ([decision 014](014-apps-find-core-through-port-file.md)).
- The core accepts a WebSocket only with the sim's `Origin` or none ([decision 013](013-core-accepts-sim-origin-or-none.md)).
- This decision leaves open a sim update that changes how mainUi takes view listeners' events, which the menu script's route rests on (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`).
- It also leaves open the CommBus's limits for a SimConnect client, which nobody has measured; our probes' 12 or 13 calls to each page all arrived ([interface log](../areas/interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
