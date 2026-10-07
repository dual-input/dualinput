# Architecture: the spine

```text
Purpose:     What every other part of Crosscheck rests on: its components, how they talk, the conventions they share, and its language.
Depends on:  ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     Node 1 of the architecture plan, one section for each of its child nodes.
```

This document answers node 1 of the [architecture plan](plan.md), the spine every other part of Crosscheck rests on, with one section for each of its child nodes.
The tentative decisions behind each section, with their findings, are in [decisions.md](decisions.md).
The watcher and the core are the two processes in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture), the core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)), and a session is the time from starting or joining one to leaving it ([03-v1-scope](../product/03-v1-scope.md#a-session-from-start-to-finish)).

## Components with no session

With no session, each component does only what lets a session start, and nothing that serves one.
A pilot may fly the Baron every day and with a crew once a week, so on the other six days no profile loads, no plugin runs, and nothing watches the cockpit (user, 2026-10-07).
None of that comes from there being no other pilots: FS Copilot's app opened its relay link and its rendezvous registration at launch, session or not (read in the FS Copilot fork, `FsCopilot/Program.cs`, `BuildAvaloniaApp`, and `FsCopilot/Network/RelayNetwork.cs` and `P2PNetwork.cs`, their constructors), so every component below is told when a session starts.

| Component | With no session | In a session |
| --- | --- | --- |
| Watcher | The same in both | The same in both |
| Core | Holds its SimConnect connection and its masking group, which listens to one event and masks nothing ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)); follows the sim's system and flow events, so it knows the sim's state, such as when Ready to fly last came; serves its clients on 127.0.0.1 | Also brings up the network, loads the profile and plugins while the session's aircraft is loaded, watches the cockpit, records, runs the audio, and reads the take-control input |
| Desktop app | Optional, and offers to start or join a session | Optional, and shows the session |
| WASM module | Loaded when the sim boots, which the sim does whether or not a session runs (measured for fsc-editor's module, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module must export MSFS's allocator. Hand-driving clang was the wrong call."), and does nothing each frame | Places the figures, and on a following machine freezes and writes the aircraft |
| Panel bridge | Loaded into every cockpit panel, which the sim does with our `VCockpit.js` override whether or not a session runs (measured on MSFS 2024, 2026-09-08, FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`); loads no modules and captures nothing | Runs pointer sync, and loads the modules that features and plugins name |
| EFB app | Its code runs from sim start, with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), and offers to start a session or enter a code | Shows the session's controls |
| Banner panel | Closed, so it has no page: closing our in-game panel destroyed its page ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)) | Opened by the toolbar script whenever the session has something to show, mid-flight included |
| Menu script | Answers the core when asked, and watches nothing | Reports which menu page is up, and runs Go to |

## What moves them

- **Starting or joining a session,** from the desktop app or the EFB app: the core brings up the network.
  Once the pilot is in a flight, it loads the profile and plugins and tells the components in the sim.
  A session started mid-flight still knows whether the aircraft has settled, since the core has followed Ready to fly since the sim started ([03-catch-up](../sync/03-catch-up.md#settling-after-a-load)).
- **Changing aircraft in a session:** the profile and plugins change with it.
- **Leaving the session, or being cut off for 5 minutes** ([the connection](../product/03-v1-scope.md#the-connection)): each component undoes what the session started.
  So every module Crosscheck loads into a panel or the sim can tear itself down, which is also what [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks of anything in the pilot's input path.
- **The core stopping:** nothing in the sim stays in a session's state.
  The core's masks end with its connection ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)), and the WASM module unfreezes the aircraft within about 1s and clears every variable of ours that holds something back ([tentative decisions](decisions.md#our-wasm-module-writes-the-following-aircraft)).
  A panel blocks input only while the core keeps telling it to, as FS Copilot's panels block only while its app's renewals arrive and give up after 8s of silence (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`).

The core exits once the sim has closed, no session is held, and the desktop app isn't open.
While a session is held, the core stays up through a sim restart, so it can rejoin the pilot as a late joiner ([the connection](../product/03-v1-scope.md#the-connection)).

## Left to later nodes

- How the core tells the components in the sim that a session started, such as an idle socket in every panel or one `L:` variable they all read, is node 1.2's.
- How each module tears itself down is the panel bridge's and the plugins' to design.
- Whether the toolbar script opens the banner every time the core asks is the banner's open question: it opened the panel after two of three Build and Mounts ([03-v1-scope](../product/03-v1-scope.md#notification-banner)).
