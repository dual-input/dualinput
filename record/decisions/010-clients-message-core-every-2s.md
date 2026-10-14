# 010: Every client sends the core a message every 2s

Every page, the desktop app, and the helper send the core a message every 2s, and the core closes a socket it hasn't heard from in 8s, and restarts a helper it hasn't heard from in 8s.
Decided by the user on 2026-10-08, in nodes 1.2 and 1.3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#every-client-sends-the-core-a-message-every-2s).

## Context

[Node 1.2](../areas/architecture/plan.md#12-communication) had to say how the core knows each component is alive and working, so a component in trouble is plain to the pilot and lands in the logs and the recording ([ideas](../areas/product/ideas.md#component-health); user, 2026-10-08).
The core's clients are the sim's pages and the desktop app, each on a WebSocket, and the helper, on its standard input and output ([01-spine](../areas/architecture/01-spine.md#communication)).
Three things keep a link open while nothing answers on its other end:

- A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
- A suspended process holds its sockets open and answers nothing (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Outages are made by suspending a process").
- A hung helper's process doesn't exit.

## Options

1. **Take a socket's close, or the helper's process exiting, as the sign that the client went away.**
   None of the three cases above gives that sign.
2. **Have every client send the core a message every 2s, and close or restart a client that's silent for 8s.**
   FS Copilot's panels use those timings toward their app: they give up on it 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog).
   Sockets in the A2A PA-24's 16 cockpit panels, each renewed every 2s, cost no frame time we could measure (measured on MSFS 2024, 2026-10-08, [interface log](../areas/interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).

## Decision

Option 2.
A message every 2s is the one sign that covers a page gone with its socket still open, a suspended process, and a hung helper.

## What it commits us to

- Each page's first message names the component and its version, so the core logs a page from an older package by name, and names each component it expected and never heard from ([01-spine](../areas/architecture/01-spine.md#how-the-core-knows-a-component-is-alive)).
- The WASM module can't open a socket, so it writes a counter every second instead ([decision 017](017-core-writes-control-slot-every-200ms.md)).
- What counts as trouble for each component, and where the pilot sees it, is for the apps' stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
- This decision leaves open how long the sim keeps a socket open after its page is gone, past 23s.
