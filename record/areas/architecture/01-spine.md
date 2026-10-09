# Architecture: the spine

```text
Purpose:     What every other part of Crosscheck rests on: its components, how they talk, the conventions they share, and its languages.
Depends on:  decisions.md, ../product/plan.md (step 7), ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     Which components Crosscheck runs, where each runs, and what each owns (node 1.1); what each does with no session, and what moves it into one and back (node 1.1.2); how they reach each other, and how the core knows each is alive (node 1.2); what language and toolchain each is built with, where the core's input and audio work runs, where a plugin's code runs and what it's written in, and how profiles and plugins reach pilots (node 1.3); the IDs, times, encodings, and versions every component shares, and who a pilot is after their core restarts (node 1.4).
```

Each section answers one child of node 1 in the [architecture plan](plan.md), and the tentative decisions behind it, with their findings, are in [decisions.md](decisions.md).
The watcher and the core are the two processes in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture), and the core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)).
The flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).
A pilot is in a session from starting or joining it until leaving it, or until 5 minutes cut off ([the connection](../product/03-v1-scope.md#the-connection)).

## Components

Crosscheck runs as the watcher, the core, and the core's helper on each pilot's PC, with the desktop app when the pilot opens it, six pieces of code inside the sim, and three services off the pilots' machines.
The core owns everything a session does.
The desktop app and the EFB app show its state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
The components in the sim carry out what the core tells them, and undo it on their own once the core goes quiet ([what moves them](#what-moves-them)).
The watcher works while the core may not be running, and the services off the pilots' machines connect the crew, collect reports, and hold releases.

| Component | Runs in | Owns |
| --- | --- | --- |
| Watcher | A process of its own, from the pilot's login | Noticing the sim's start and stop, starting the core with the sim and again if it exits, the BlurPage copy, and, while the sim is closed, plugins' changes to aircraft files and updates |
| Core | A process of its own, started by the watcher or the desktop app | SimConnect, the session, the network, the profile engine and plugins, sim awareness, recording, audio, the take-control input, the figure's hand, AI traffic, and the checks |
| Helper | A process of its own, which the core starts and restarts | The core's Windows input and audio work: reading the keyboard, flight hardware, and mouse through Raw Input, capturing the microphone and the ATC app, running the speech recognizer, and playing sound |
| Desktop app | A window of its own, opened by the pilot, optional | Settings, bindings, the output device, the recording mode, the report page, and the session's view |
| EFB app | The EFB's document in the sim | The controls a pilot needs in flight, and the EFB's opening onto it when a notice is clicked |
| Banner panel | An in-game panel of ours | Notices |
| Toolbar script | The toolbar's document, through our toolbar icon | The banner panel's opening |
| Menu script | The main menu's document, through our copy of BlurPage | Go to, through the world map's requests, and reports of which menu page is up |
| Panel bridge | Every cockpit panel, through our `VCockpit.js` override | Pointer sync, the modules that features name, and what plugins ask of the panels |
| WASM module | The sim, as a standalone module from boot | The figures' placement, the aircraft's hold and writes, and the undoing of our state in the sim when the core goes quiet |
| Relay | Off the pilots' machines | Invite codes, introductions between cores, and a session's traffic when the cores can't link directly |
| Backend | Off the pilots' machines | Each pilot's part of a bug report, and later features that need a server of ours, such as [telemetry](../product/ideas.md#telemetry) |
| Release host | Off the pilots' machines | Installers and updates |

Plugins aren't components: a plugin's code runs only in the core, and reaches the cockpit panels and our WASM module through APIs our own code carries out ([plugins](#plugins)), and the watcher applies a plugin's changes to its aircraft's files while the sim is closed ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
The installer runs once, and puts the app and our Community package in place ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
The figure is the other pilot's, which our WASM module draws ([avatar sync](../product/03-v1-scope.md#avatar-sync)).

Where each sits, and why:

- Step 7 gives the watcher the jobs [installing and updating](../product/03-v1-scope.md#installing-and-updating) gives programs the sim launches, such as the warning at sim start that an update is waiting ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and the [tentative decisions](decisions.md#the-watcher-keeps-the-blurpage-copy-current) give it the BlurPage copy.
- The core reads the take-control input ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)), runs the audio ([tentative decisions](decisions.md#the-core-runs-crosschecks-audio)), and works out where the figure's hand goes ([tentative decisions](decisions.md#the-core-works-out-where-the-figures-hand-goes)), with its helper doing the Windows input and audio work ([the helper](#the-helper)).
  It also reads the clipboard when the pilot selects the EFB app's code box ([invite code](../product/03-v1-scope.md#invite-code)), reads the flight file that names the PF's stand ([preflight](../product/03-v1-scope.md#preflight)), and uploads a bug report when the pilot asks from the desktop app's report page ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- AI traffic is injected and written from the core, outside the sim.
  FS Copilot's app freezes each copy and writes it in SimConnect's `Frame` event (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficReceiver.cs`, `Render`, and `FsCopilot/Connection/SimTraffic.cs`), and the fork's prototype injector, driving copies the same way, moved them more smoothly than BeyondATC moves its own ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
- The core's checks are the version check at join ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), the [preflight match check](../product/03-v1-scope.md#preflight-match-check), and the check for another package's `VCockpit.js` override.
- The EFB app, the banner panel, the toolbar script, and the menu script each reach the sim's documents by a route we measured on MSFS 2024: an app registered with the EFB ([interface log, 2026-10-06](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), an in-game panel ([2026-10-04](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), a script that our toolbar icon loads ([2026-10-04](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)), and a script that our copy of BlurPage loads ([2026-10-06](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
- The panel bridge loads one module per file, so one module's syntax error reaches no other ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)).
- The WASM module writes inside the sim's frame and outlives the core ([tentative decisions](decisions.md#our-wasm-module-writes-the-following-aircraft)).
  Whether the profile engine fires `H:` events through SimConnect's client events or through calculator code our module runs, since the client events may not reach them (unverified, [01-profile-entries](../sync/01-profile-entries.md#the-writer-api)), is open ([left open](#left-open)).
- The relay holds a session's invite code, as fsc-editor's does (read in fsc-editor, `relay/src/index.ts`), and introduces the cores, which try a direct link first and fall back to the relay ([network log](../network/log.md#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month)).
- The backend's candidate is a Cloudflare Worker with D1 and R2 ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- The release host is GitHub Releases (user, 2026-10-08), which fsc-editor's `electron-updater` updates fsc-editor from (read in fsc-editor, `package.json`, `electron-builder.yml`, and `src/main/updates.ts`).

## Components with no session

With no session, each component does only what lets a session start, and nothing that serves one.
A pilot may fly the Baron every day and with a crew once a week, so on the other six days no profile loads, no plugin runs, and nothing watches the cockpit (user, 2026-10-07).
Each component has to be told to idle, because an app can do session work with nobody to fly with: FS Copilot's app connected to its relay and registered with its rendezvous server at launch, session or not (read in the FS Copilot fork, `FsCopilot/Program.cs`, `BuildAvaloniaApp`, and `FsCopilot/Network/RelayNetwork.cs` and `P2PNetwork.cs`, their constructors).
So the core tells every component below when a session starts.

| Component | With no session | In a session |
| --- | --- | --- |
| Watcher | Notices the sim's process starting and stopping, keeps the BlurPage copy current, applies plugins' changes to aircraft files before the sim boots, and starts the core | No different |
| Core | Holds its SimConnect connection and its masking group; follows the sim's system and flow events; serves its clients on 127.0.0.1 | Also brings up the network, loads the profile and plugins while the pilot's aircraft is loaded, watches the cockpit, records, runs the audio, and reads the take-control input |
| Helper | Not running, except while the desktop app binds a key or lists the output devices | Reads the take-control input and the cursor, and captures and plays the audio, for the core |
| Desktop app | Optional; offers to start or join a session | Optional; shows the session |
| WASM module | Runs, and does nothing each frame | Places the figures, holds the aircraft in preflight, and on a following machine writes the aircraft |
| Panel bridge | Runs in every cockpit panel, loads no modules, and captures nothing | Runs pointer sync, loads the modules that features name, and carries out plugins' requests |
| EFB app | Offers to start a session or enter a code | Shows the session's controls |
| Toolbar script | Waits for the core | Opens the banner panel when the session has something to show |
| Banner panel | Closed, so it has no page | Shows the session's notices |
| Menu script | Answers the core when asked, and watches nothing | Reports which menu page is up, and runs Go to |

The core's masking group holds `K:SIM_RATE_INCR`, which it listens to and doesn't mask, and takes its priority as the sim starts ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
Three components run whether or not the pilot is in a session, because the sim starts them:

- The sim loads our WASM module when it mounts our package at boot, and keeps it through the main menu, every flight, and every aircraft change ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#gauge-vs-standalone-modules-and-the-sandbox)).
- A `VCockpit.js` override runs in every cockpit panel as the panel loads: FS Copilot's put its bridge into all 14 of the Synaptic A220's panels about 7 minutes before its app's first peer link (measured on MSFS 2024, 2026-09-08, FS Copilot fork, `record/pointer-forwarding/results/session-2026-09-08-app.txt`).
- Our EFB app's code runs from sim start, with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).

The banner panel has no page while it's closed, because closing our in-game panel destroyed its page ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).

## What moves them

- **Starting or joining a session,** from the desktop app or the EFB app: the core brings up the network.
  Once the pilot is in a flight, it loads the profile and plugins and tells the components in the sim.
  The core knows when Ready to fly last came, because it has followed the sim's flow events since the sim started.
  If that was 1.5 minutes ago or more, the aircraft counts as settled ([03-catch-up](../sync/03-catch-up.md#settling-after-a-load)); if it was sooner, the quiet window can start only once the profile loads, a case 03-catch-up's rule doesn't cover.
- **Changing aircraft in a session:** the core unloads the old aircraft's profile and plugins and loads the new aircraft's.
- **Leaving the flight but not the session,** at the main menu or in another flight ([the connection](../product/03-v1-scope.md#the-connection)): the core keeps the session and the network, unloads the profile and plugins with the aircraft, and loads them again once the pilot is back in a flight as a late joiner.
- **Leaving the session, or being cut off for 5 minutes:** each component undoes what the session started.
  So every module Crosscheck loads into a panel or the sim can tear itself down, which is also what [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks of anything in the pilot's input path.
- **The core stopping:** nothing in the sim stays in a session's state.
  - The core's masks end with its connection ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
  - The WASM module hears from the core on every machine in a session, and after 1s with no word from it, unfreezes the aircraft and clears every variable of ours that holds something back.
    FS Copilot's module works that way: once 1s passes with no control packet from its app, it sets `L:FSC_CONTROL` to 0 and unfreezes the aircraft, whatever the machine's role (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone`, `g_last_seen`).
  - A panel blocks input only while the core keeps telling it to, as FS Copilot's panels block only while their app's renewals arrive, and drop to a warning that blocks nothing 8s to 10s after the last one (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog).

The core exits once the sim has closed, no session is held, and the desktop app isn't open.
While a session is held, the core stays up through a sim restart, so it can tell the crew the sim crashed and rejoin the pilot as a late joiner ([the connection](../product/03-v1-scope.md#the-connection)).

## Communication

Every link between our components ends at the core, except the watcher's to the release host ([tentative decisions](decisions.md#every-link-between-our-components-ends-at-the-core)).
v1's features need no other: a click on a notice in the banner panel, for one, opens the EFB onto our app by way of the core, and a panel's action meant for the WASM module goes to the core over a WebSocket, then to the module through a SimConnect client data area, which this document calls a data slot.
A page here is a document the sim runs in Coherent GT, one of those the inspector lists; the documents WebView2 draws in the desktop app's window are always called the desktop app's pages.

```text
 Watcher ──starts──▶ Core ◀── WebSocket ──▶ Desktop app
                      │ ▲
                      │ └── WebSocket, after a CommBus announcement ── EFB app, banner panel,
                      │                                             toolbar script, menu script,
                      │                                             panel bridge
                      ├── SimConnect ── the sim: masks, events, AI traffic, and the CommBus
                      ├── SimConnect data slots ── WASM module
                      ├── starts it; its standard input and output ── helper
                      └── the network ── other pilots' cores, the relay, the backend
 Watcher ── HTTPS ── release host
```

| Link | Means | What crosses | How the core knows it's alive |
| --- | --- | --- | --- |
| Watcher to core | The watcher starts the core's process | Nothing else | It can't: the watcher sends it nothing |
| Desktop app and core | WebSocket on 127.0.0.1, found through the port file | The core's state one way, commands the other | Messages every 2s |
| EFB app and menu script, and core | WebSocket, found through the CommBus, whether or not a session runs | The EFB's controls and state, Go to, and which menu page is up | The same, and a first message naming the component and its version |
| Toolbar script and core | The same, while a session runs | The banner's opening | The same |
| Banner panel and core | The same, while the panel is open | Notices, and a click on one | The same |
| Panel bridge and core | The same, from every cockpit panel when a session starts, kept open only by the panels the profile or a plugin names | Pointer presses, `H:` events, plugins' requests and their answers, and the locks' renewals | The same; no panel's first message ever arriving means our panel bridge didn't load, as when another package's `VCockpit.js` wins |
| Core and WASM module | Data slots, one for each kind of message | The session's state and a counter, the pose and velocities, the figures' poses, and the module's version | A counter the module writes every second |
| Core and helper | The core starts the helper's process and talks to it over the helper's standard input and output | Key and button presses, the cursor, recognized phrases, and captured ATC one way; what to capture and what to play the other | The helper's process exiting, or its message every 2s stopping, as every client's does |
| Core and other machines | The network, [below](#between-machines) | The six channels of [04-room-for-later](../product/04-room-for-later.md#channels), invite codes, and reports | For the node that designs how the cores reach each other |
| Watcher and release host | HTTPS | Updates | Not needed |

### Finding the core

The core listens on 127.0.0.1, on a port Windows picks.
A page in the sim learns the port over the CommBus, and an app outside it from a file ([tentative decisions](decisions.md#the-sims-pages-find-the-core-over-the-commbus-and-talk-to-it-over-a-websocket)).

The core calls `SimConnect_CallCommBusEvent` for JavaScript every 2s with its port and whether a session runs, and at once, on the CommBus and on every socket, when a session starts or ends, and a page that hears it opens a WebSocket to that port.
The page doesn't ask, and the core's next announcement reaches a page that loaded before the core, as the EFB app's code runs from the sim's start ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
In the main menu, 13 of the 14 pages heard a SimConnect client's calls, mainUi, the toolbar's page, and the EFB's among them, and in a flight, 30 of 31, among them all 16 of the A2A PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log][coverage]); our own in-game panel heard them in an earlier flight ([interface log][links]).
The page that heard nothing, "transition", runs none of our code.
A page could call the core through the CommBus, but a call the toolbar's page made before its listener reported ready never arrived ([interface log][coverage]), so our pages don't call it.
mainUi and the menu's toolbar page have no `Coherent`, so our script there triggers `ADD_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS` and takes the core's calls as `EVENT_FROM_VIEW_LISTENER`, the way mainUi's own view listeners take events (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`).
That route rests on the sim's own page code rather than on the SDK's CommBus API ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so a sim update could change it, as it could the BlurPage copy.
In a page that has the sim's `common.js` but not its `Services/CommBus.js`, such as the toolbar's in a flight and our banner's, our script loads `CommBus.js` and listens through `RegisterCommBusListener`.
An `L:` variable can't carry the port: mainUi can't read one, and a flight load reset ours to 0 ([interface log][links]).

The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so among programs outside the sim, only a SimConnect client of the pilot's sim can call on its CommBus, and a development core attached to a stand-in sim can't reach the real sim's pages, which no run has tried.

The CommBus carries these announcements and nothing else, for two reasons:

- A CommBus call reaches every page listening on its name, so each page would sort the whole session's traffic, as every panel did on FS Copilot's CommBus path (documented in the FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, "What exists").
- Its limits for a SimConnect client are unmeasured.

The core writes its port and process ID to a file in its data folder, and one core runs for each data folder: a core that finds the file naming a core that's still running exits ([tentative decisions](decisions.md#apps-outside-the-sim-find-the-core-through-a-port-file)).
So a pilot's PC runs one core, and a development core with a data folder of its own runs beside it.

### The sim's pages

- The EFB app and the menu script connect whenever they hear the core's announcement: with no session, the EFB app is where a pilot starts one, and the core asks the menu script which page is up ([components with no session](#components-with-no-session)).
- The toolbar script connects while a session runs, since it opens the banner panel only when the session has something to show.
- The banner panel connects while it's open, since closing it destroys its page ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).
- Every cockpit panel's panel bridge connects when it hears that a session started, sends a first message naming the instruments it holds, and gets back the modules to load, and a panel the core gives nothing closes its socket ([tentative decisions](decisions.md#cockpit-panels-connect-only-in-a-session-and-only-the-ones-in-use-stay)).
  Once it has loaded the profile and the plugins, the core keeps the panels holding the displays pointer sync replays into, one panel to listen for `H:` events, and those holding the instruments a plugin reads or writes.

A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log][coverage]).
So each page sends the core a message every 2s, and the core closes a socket it hasn't heard from in 8s, as FS Copilot's panels give up on their app 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog).

A socket in each of the PA-24's 16 cockpit panels cost no frame time we could measure: uncapped, at about 83 fps, the two windows with nothing of ours read 12.25ms and 12.07ms a frame, and the windows with our sockets idle, taking a message every 2s, or taking 30 messages of about 200 characters a second, each parsed as JSON, read 12.01ms to 12.07ms (measured on MSFS 2024, 2026-10-08, [interface log][links]; message size and parsing read in `experiments/areas/interface/p13-sim-links.mjs`).

The core accepts a WebSocket only when its `Origin` is `coui://html_ui` or absent ([tentative decisions](decisions.md#the-core-accepts-a-websocket-only-with-the-sims-origin-or-none)).
Every page we use sent `coui://html_ui`, all 14 in the main menu and all 32 in the A2A PA-24's flight (measured on MSFS 2024, 2026-10-08, [interface log][links]), and the desktop app connects from its Rust side, which sends none ([the desktop app](#the-desktop-app)).

### The WASM module

The WASM module can't open a socket, so it reaches the core through data slots, as FS Copilot's and fsc-editor's modules do ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module); [tentative decisions](decisions.md#the-core-writes-the-wasm-modules-control-slot-every-200ms)).

- The module creates the slots when it loads at the sim's start, and leaves its version in one, as fsc-editor's module does (read in fsc-editor, `link/src/module.cpp`, `module_init`), so the core can tell a missing module from a present one.
- Each kind of message has a slot of its own, because whether two writes to one slot in one frame both reach the reader is unmeasured ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).
- In a session, the core writes the module's control slot every 200ms, with the session's state and a counter.
  The module learns that a session ended from that state, and takes 1s with no write to mean the core stopped ([what moves them](#what-moves-them)).
  A slot carries more than the 5 writes a second this takes: fsc-editor's module streamed values to its app through one at 15Hz (read in fsc-editor, `link/src/module.cpp`, `k_interval_seconds`; measured on MSFS 2024, 2026-08-27, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal").
- The module writes a counter every second, so the core can tell a running module from one that stopped.

### The watcher and the desktop app

- The watcher starts the core when the sim starts, and again if the core exits while the sim runs ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)).
  The crew sees a restarted core as the same pilot ([the session file, and a core that restarts](#the-session-file-and-a-core-that-restarts)).
- The watcher reads the core's process ID from the port file and shows its CPU and memory use beside its own ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
  It opens no socket to the core.
- The desktop app starts the core when the port file names no running process, and waits for the file to be written again.
- The core launches the desktop app when it isn't open: when the pilot presses the EFB app's button that brings it to the front ([EFB app](../product/03-v1-scope.md#efb-app)), and after a sim crash, to show the Rejoin button ([ideas](../product/ideas.md#telling-the-crew-a-sim-crashed)).

### Between machines

The core talks to other pilots' cores, directly when it can and through the relay when it can't, and to the backend over HTTPS.
The watcher alone talks to the release host, over HTTPS.
How the cores reach each other is for a top-level node after node 1 (user, 2026-10-08): the topology, the transport, getting through home routers, the relay, and encryption.

Two findings go to it.
A Cloudflare Worker takes HTTP requests, WebSocket upgrades among them, and Cloudflare's docs say it can't take a raw inbound TCP connection (documented, [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), as of 2026-10-08).
A Cloudflare post of 2026-08-03 announces raw inbound TCP through Spectrum in a private beta, and names UDP only as a goal (documented, [gRPC on Workers](https://blog.cloudflare.com/grpc-workers/)).
So a Worker can't relay UDP as of 2026-10-08, which our FS Copilot record also says, without a source (FS Copilot fork, `record/self-hosted-relay/docs/02-hosting-choice.md`), and fsc-editor's Worker relay carries its sessions over WebSocket, on TCP.
Cloudflare's Realtime TURN service relays UDP only: its FAQ says it doesn't implement RFC 6062, the TURN extension for TCP relays, and TURN without it relays UDP (documented, [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), as of 2026-10-08; [RFC 8656](https://www.rfc-editor.org/rfc/rfc8656)).
It charges $0.05 a GB sent from Cloudflare to the client ([TURN](https://developers.cloudflare.com/realtime/turn/)), after 1,000 GB free each month ([Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)), each documented as of 2026-10-08.
Its pages describe it for WebRTC clients, so whether a client that isn't WebRTC, such as a core with a UDP transport of its own, can use it is unverified, and asking Cloudflare's TURN for a relay from such a client settles it.

### How the core knows a component is alive

Every link but two tells the core when its component goes quiet: a page's or the desktop app's messages stop, a first message never comes, the module's counter stops, or the helper's process exits or its messages stop.
The core can't tell whether the watcher runs, because the watcher sends it nothing, and how it learns that the relay or another pilot's core went quiet is for the node that designs how the cores reach each other.
Each page's first message names the component and its version, and the WASM module leaves its version in a slot, so the core logs a page from an older package by name, and names each component it expected and never heard from.
The core logs every connection, first message, and close, and the recording keeps them, so a bug report shows which component stopped and when ([ideas](../product/ideas.md#component-health)).
What counts as trouble for each component, and where the pilot sees it, is [left open](#left-open).

[links]: ../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one
[coverage]: ../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel

## Language and toolchains

Crosscheck is written in Rust, and in TypeScript wherever a JavaScript engine runs it: the sim's pages, the desktop app's pages, plugins and the profile's write functions in the core's engine, and the backend ([tentative decisions](decisions.md#crosscheck-is-written-in-rust-and-in-typescript-where-an-engine-runs-it)).

| Component | Runs in | Language |
| --- | --- | --- |
| Core | A Windows program of its own | Rust |
| Helper | A Windows program of its own | Rust |
| Watcher | A Windows program of its own | Rust |
| Desktop app | Tauri: a Rust program whose window shows the desktop app's pages, which WebView2 draws | Rust, and TypeScript for its pages |
| WASM module | The sim's WebAssembly | Rust |
| EFB app, banner panel, toolbar script, menu script, and panel bridge | Coherent GT | TypeScript, compiled to the syntax Coherent GT parses |
| Plugins, and the profile's write functions | QuickJS-ng, embedded in the core | TypeScript, compiled to JavaScript |
| Backend | A Cloudflare Worker, its candidate host | TypeScript |

The relay's language is for the node that designs how the cores reach each other.

### The core

The core is a Rust program (user, 2026-10-08).

- It reaches the sim through the SDK's own `SimConnect.dll`.
  A Rust client on it connected to MSFS 2024, called mainUi over the CommBus and heard each answer, followed the "1sec" system event, and traded data slots with our Rust module, all at the main menu (measured on MSFS 2024, 2026-10-08, [architecture log][client]).
  In our probes, what a flight adds, such as masking, AI objects with liveries, input events, the camera, and a flight load's flow events, has run only through node-simconnect 4.2.0, a JavaScript client that speaks the same protocol to the same server (version read in `experiments/package.json`; measured in the probes behind the [aircraft](../aircraft/log.md), [flight-controls](../flight-controls/log.md), [avatars](../avatars/log.md), and [sync](../sync/log.md) logs).
  FS Copilot runs AI objects and input events through the SDK's managed wrapper over the same `SimConnect.dll` ([04-01](../../learn/foundations/04-01-connection-and-data.md#what-it-is)), and whether each works from our core through the SDK's library is [left open](#left-open).
- Its bindings to SimConnect, like the WASM module's to the sim, are generated from the SDK's headers, as FlyByWire's msfs-rs generates them with bindgen (read in [msfs-rs](https://github.com/flybywiresim/msfs-rs), its main branch on 2026-10-08, `msfs/build.rs`), so that no type is copied by hand.
  The core's client in the measurement above ran on declarations written by hand from the header, where `HANDLE` is a pointer, and they worked ([architecture log][client]).
  The module's hand-written bindings gave `HANDLE` 32 bits where its headers give 64, and broke it ([code in the sim](#code-in-the-sim)).
  That bindgen's output gets each type right is unverified, because it needs libclang, which our development machine lacked as of 2026-10-08; a bindgen run over the module's headers settles it.
- Plugins and the profile's write functions run in QuickJS-ng, the fork of QuickJS that rquickjs embeds ([plugins](#plugins)).
  In a Rust host it started in 1.7ms to 2.6ms over two runs, idled at 0.9 MB of private working set, ran 100 hypothetical write functions a frame, 60 frames a second, in 75µs a frame on average, and stopped an endless allocation at its 64 MB limit and an endless loop at its 100ms limit, while the host ran on (measured on our development machine, 2026-10-08, [architecture log][engine]).
  V8 was as fast, but as built, its process died on the endless allocation; with TurboFan, its top optimizing compiler, off, the host ran on.
  A run with only Maglev, its mid-tier compiler, off still failed, but its output wasn't saved, so that TurboFan alone is the cause is unverified (same entry).
  Its memory limit also needed an allocator of ours that counted ArrayBuffers, which its heap limit misses (same entry).
  A real profile's write functions, and the engine inside a core doing its other work, haven't run (same entry).

### The desktop app

The desktop app is a Tauri app: a Rust program whose window shows the desktop app's pages, which the system's WebView2 draws, written in TypeScript (user, 2026-10-08).

- In one run each, its window took about as much memory as an Electron window showing the same page, 72.3 MB of private working set over seven processes against 66.5 MB over four, and its program is 8.0 MB on disk against Electron's 347.4 MB (measured on our development machine, 2026-10-08, [architecture log][tauri]).
  The 8.0 MB leaves out WebView2's runtime, 861.2 MB on disk on our machine, which Microsoft includes with Windows 11, while "a small number of Windows 10 devices don't have" it (documented, [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)), and which Tauri's installer adds where it's missing (documented, [Tauri's webview versions](https://v2.tauri.app/reference/webview-versions/)).
- It connects to the core from its Rust side, which sent no `Origin` through tokio-tungstenite 0.30.0, while the desktop app's pages sent `http://tauri.localhost`, which the core refuses ([the sim's pages](#the-sims-pages); same entry).

### Code in the sim

Code that runs in Coherent GT is written in TypeScript and compiled to the syntax the engine parses, as the A220's DisplayUnits bundle is, which spells `??` out the long way ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)); A2A's tablet is TSX that esbuild bundles ([EFB app](../product/03-v1-scope.md#efb-app)).
Step 7 has a check that every file run in Coherent GT parses within the engine's measured limits ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and we run it on the compiled output, which is what the engine parses.
Compiling doesn't fill in the built-ins Coherent GT lacks, such as `Object.fromEntries`, whose calls throw when they run, and a parse check doesn't see them ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), so the build also fills them in or rejects their use.

Our WASM module is Rust, built by Navigraph's cargo-msfs and packaged by our own script: a module built that way loaded on MSFS 2024, ran its update about 136 times a second, and traded data slots with a SimConnect client at the main menu, and nobody has run it in a flight (measured on MSFS 2024, 2026-10-08, [architecture log][module]).

- cargo-msfs fetches the SDK from the SDK site's public download, `sdk.flightsimulator.com`, and unpacks it without running the installer (read in navigraph/cargo-msfs v1.1.0, `src/sdk.rs`), so the repository holds none of the SDK.
  No run has built the module on a CI runner.
  Installing cargo-msfs builds Binaryen's C++ through its `wasm-opt` 0.116.1 dependency (read in navigraph/cargo-msfs v1.1.0, `Cargo.toml`), so a runner needs a C++ compiler; we saw that compile only in the build's console, which wasn't saved ([architecture log][module]).
- The module's hand-written bindings gave SimConnect's `HANDLE` 32 bits where the SDK's WebAssembly headers give it 64 (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_WindowsTypes.h`), and they compiled and loaded, while the first call after `SimConnect_Open` returned `E_FAIL` (same entry); so its bindings are generated from the headers too ([the core](#the-core)).
- Each standalone module gets a package of its own until two working modules in one package are tried (same entry).

### The helper

The core's work with Windows input and audio runs in the helper, a Rust program the core starts, and starts again if it exits ([tentative decisions](decisions.md#the-cores-input-and-audio-work-runs-in-a-helper-it-starts)).
A crash there, such as in a speech recognizer's C or C++ library, costs the take-control input, the figure's hand, and the audio only until the core restarts it, while in the core's own process it would take the pilot out of the session until the watcher restarted the core and they rejoined.

- Our probes already work this way: mouse.mjs starts PowerShell, which compiles C# that reads the mouse through Raw Input, and the probe reads that program's reports line by line from its standard output ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
- A Rust build played a 440Hz tone on the default output device, which it looked up by name, and a second copy captured it through process loopback at the level it played, −26dBFS peak.
  It also captured the default input device, a Focusrite input, though whether a microphone was on it is untested.
  Registered for Raw Input in sink mode, with its own window never in front, it received F24 presses and releases that another program sent, and, in the same 4s, 1,447 HID reports from four devices nobody touched, which the probe didn't identify (measured on our development machine, 2026-10-08, [architecture log][helper]).
  Whether it receives them with the sim in front, and from a key a person presses, is untested ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)).
- Its build linked with Visual Studio 2022's linker; Rust's GNU target failed with Rust's own tools, and we haven't tried it with a full MinGW ([architecture log][helper]).
  rustup documents Visual Studio's "Desktop Development with C++" workload for the MSVC target, and says its Build Tools edition, without the IDE, needs a license to Visual Studio's Community, Professional, or Enterprise edition (documented, [rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html)).
- The speech recognizer runs in it, and the recognizer is chosen when the voice phrases are built ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

### The watcher

The watcher is Rust because it runs all day, shows the pilot its own memory use ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and Rust is the language of our other programs.
In Rust, a tray icon alone cost 1.0 MB of private working set, the figure Task Manager's Memory column shows; in .NET 9 Native AOT, 1.6 MB; and over Electron 43.4.0's main process and the two processes it started, 39.7 MB.
None used CPU we could measure (measured on our development machine, 2026-10-08, [architecture log][tray]).

### Plugins

A plugin is TypeScript that implements an interface of ours and runs only in the core, in the QuickJS-ng engine that also runs the profile's write functions ([the core](#the-core)), and it reaches everything else through APIs our own code carries out, so nothing a plugin ships runs in a cockpit panel or in the WASM module (user, 2026-10-08; [tentative decisions](decisions.md#plugin-code-runs-only-in-the-core)).

- When a plugin needs something done in a panel, such as reading a setting that lives only in a gauge's JavaScript, our panel bridge does it through a generic API, and when it needs something done inside the sim's frame, our WASM module does it, such as writing given variables every frame, running given calculator code, or placing an object.
  So Crosscheck's code owns each mechanism and the plugin owns the policy, as [04-room-for-later](../product/04-room-for-later.md#plugins) asks, and our panel code keeps the fail-open rules [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) sets for anything in the pilot's input path, whatever a plugin asks of it.
- A plugin's logic inside the frame goes in calculator code our module runs, and logic beyond what calculator code expresses is [left out](decisions.md#plugin-code-runs-only-in-the-core), since no v1 plugin is known to need it.
  The one call that runs calculator code, `execute_calculator_code`, is deprecated with no replacement ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)), and it ran on MSFS 2024 on 2026-08-25 (measured, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean"); FS Copilot's module makes every write to the aircraft through it (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_physics`, `apply_control`, and `dispatch`).
- The watcher applies file changes before the sim boots, usually while the core, the one place plugin code runs, isn't running, so a plugin's changes are files and patches the watcher reads, not code it runs.
- Profiles and plugins reach pilots apart from Crosscheck's releases, signed, and pinned for each session by hash ([tentative decisions](decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)), so a fix to a profile or a plugin needs no new Crosscheck and no sim restart, except for a plugin's file changes, which wait for the next sim start.

### Messages between components

The Rust components share one crate that defines each message they trade: the core's with the helper over its standard input and output, with the WASM module through the data slots, and with the desktop app over its WebSocket, so both ends of each of those links compile against one definition.
Three TypeScript sides trade those messages too: the sim's pages, the desktop app's pages, and plugins calling the core's host functions.
A message passed between languages needs one definition both sides are checked against ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)), so the TypeScript sides' types come from that crate ([messages and their types](#messages-and-their-types)).

[client]: log.md#2026-10-08-a-rust-program-on-the-sdks-own-simconnectdll-connects-to-msfs-2024-trades-commbus-calls-with-mainui-follows-system-events-and-trades-data-slots-with-our-rust-module
[engine]: log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off
[tauri]: log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin
[module]: log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide
[helper]: log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker
[tray]: log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron

## Shared conventions

Every component names sessions and pilots by random UUIDs carried as text, and every time in a message is in µs on the sending PC's monotonic clock, which the core reads for the pages and plugins that can't.
Every message is defined in one Rust crate, which ts-rs turns into TypeScript for the TypeScript sides, and every first message and join carries one version number and a hash of that crate.
A pilot keeps their ID when their core restarts, and the core counts its restarts, so the other machines can tell a core that restarted from one returning after an outage.
The tentative decisions behind each are in [decisions.md](decisions.md#sessions-and-pilots-are-named-by-random-uuids-carried-as-text).

### IDs

- A session's ID is a version 4 UUID, which has 122 random bits ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562#section-5.4)), drawn by the host's core when it starts the session and given to each pilot as they join.
  It labels each pilot's recording and their part of a bug report, which the invite code can't, since a later session can draw the same six characters ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- A pilot's ID is a version 4 UUID too, drawn by the pilot's core when they join a session, and kept through every rejoin of it.
  A pilot's ID also keys their counters in the vector clocks ([below](#the-session-file-and-a-core-that-restarts)), and the conflict rule's tie-break compares two pilots' IDs as lowercase text, which orders them as their 128-bit values do ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
- The user chose 122 random bits over 64 (user, 2026-10-09): among 10 million sessions, a hypothetical lifetime total, the chance that any two share an ID is about 1 in 10^23 with 122 random bits, against about 1 in 370,000 with 64.
  As text, a UUID is 36 characters; a session's ID crosses once, when a pilot joins, and a pilot's once as each link opens, unless the encoding between cores writes the ID into every vector clock rather than the pilot's place in the member list, which is [left open](#left-open).
- Each crosses as its text, such as `3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a`.
  A 128-bit ID can't cross as a number: `BigInt` was missing from the one cockpit panel's document we probed for it (measured on MSFS 2024, 2026-08-30, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), and a JavaScript number holds every integer exactly only up to 2^53, as p07 showed when a time of 2^53 + 1µs, plus 1 in a plugin, came back from QuickJS-ng as 2^53 rather than 2^53 + 2 (measured on our development machine, 2026-10-09, [architecture log][types]).
- A run of the sim is named by its process's ID and the time the process was created, which `GetProcessTimes` gives (documented, [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)), because a process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)).

### The session file, and a core that restarts

The core keeps a session file in its data folder from the pilot's first join of a session until they press Leave session or the core learns the session has ended.
It holds the session's ID and invite code, the pilot's ID, a restart count, the run of the sim the pilot was in, and, for each sender and channel, the last message number the core applied.
One core runs for each data folder ([finding the core](#finding-the-core)), so a development core beside the pilot's has a session file, and a pilot ID, of its own.

- The restart count goes up by 1 each time the core starts while the file exists.
- Between cores, a link opens by naming the sender's pilot ID and restart count, so each message on it carries its number in its channel without repeating the ID or the count.
  A receiver keeps the last number it applied from each sender in each channel, and drops the second copy of a message that came both directly and through the relay ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
  - A link that opens again with the same restart count is the same core, back from an outage, so the receiver keeps its numbers and drops the copies a replay brings.
  - A link with a higher restart count is a core that restarted and numbers from 1 again, so the receiver starts that sender's numbers afresh, where without the count it would drop the restarted core's messages as copies until their numbers passed the last one it applied before the restart.
  - In the vector clocks, each counter belongs to a pilot's ID and a restart count, so a restarted core starts a counter of its own, and no counter goes backward.
- A core could instead save the number of each message it sends and go on numbering after a restart, but that puts a disk write ahead of every send; the restart count costs one write per start.
- FS Copilot made a restarted app a new peer instead: "Both the peer id and the session id are per app run, so a restarted peer is a new peer in every respect", and the fix its pre-PR review settled on lived with three limits: up to one acknowledgment interval of events could apply twice on a restarted peer, a restarted sender's history was gone, and a new third person got a replay they didn't need (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03).
- A core that restarts while the sim keeps running, such as after a crash, rejoins the pilot under the same ID, and replays what they missed, as after a network outage ([the connection](../product/03-v1-scope.md#the-connection); user, 2026-10-09).
  It reads from the session file the last number it applied from each sender in each channel, and asks the other machines for the messages after them.
  It writes each number to the session file after applying the message, which delays no message, so only a message it was applying as it crashed can apply again.
  What it had sent that no machine had received when it crashed is lost with its process, as FS Copilot's sender history was.
- A core whose sim restarted too, which it tells from the run in the session file, rejoins the pilot under the same ID as a late joiner ([the connection](../product/03-v1-scope.md#the-connection)).

### Times

- Every time in a message is a whole number of µs on Windows' `QueryPerformanceCounter`, whose ticks become µs through `QueryPerformanceFrequency`.
  The counter counts from the PC's start, gives consistent readings across processes, never goes backward, and ignores changes to the system clock (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)).
  - The conversion to µs runs in 128 bits: Windows fixes the counter at 10 MHz under a hypervisor, "or always in some newer versions of Windows", so ticks times 1,000,000 passes a signed 64-bit integer after about 10.7 days of the PC running (documented, same page).
  - A core that restarts goes on along the timeline it left, and a PC that restarts starts a new one, unless Windows' Fast Startup carries the counter over, which is untested.
    Both open their links with a higher restart count, so the count tells a receiver that the sender's timeline may have changed, not that it did.
  - Whole µs round a stamp by under 1µs, where whole ms would round it by up to 1ms, a quarter of a frame at 240 fps, and 2^53µs is about 285 years, so a stamp fits a JavaScript number exactly.
- A value is stamped when it's read, not when its message is built, sent, or parsed.
  Our traffic work found that "Sample times must not be arrival times", because arrival times carry the network's jitter into the path ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)), and fsc-editor stamped each value as it was parsed, so about 192 values that arrived in one 8 KB message landed 0ms to 3ms apart, in the order they were parsed (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — The right answer was being sorted last for arriving 2 ms early").
- A page in the sim can't read `QueryPerformanceCounter`, and a plugin gets no clock of its own, so the core stamps each of their messages as it arrives, the nearest it comes to when the value was read.
  A page that needs a span measures it on its own clock and sends the span, as our fork's pointer sync sends with each gesture its `GapMs`, the idle time since the gesture before it, capped at 1,000ms (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`; [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage)), which its panel code measures with `Date.now()` (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `_gapBefore`).
- A receiver reads a peer's stamps through an offset it estimates for that peer, and keeps estimating, because two PCs' counters drift apart.
  A PC's crystal is typically within 50 ppm and can be off by as much as 500 ppm, so two counters can part by about 8.6s a day, and by up to about 86s (documented, same page).
  Recent versions of Windows "detect the frequency offset and compensate for it to the extent possible" when Windows starts (same page), and how far two PCs' counters part in practice is unmeasured; logging two PCs' offset over a few hours settles it.
  How the offset is estimated is for the flight-model sync and the node on how the cores reach each other ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
- No frame count crosses between machines, because each sim runs its own frames ([08-01](../../learn/foundations/08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)).
  A pace in frames, such as a profile's `every(1, 'frame')` or the duplicate filter's 3 frames, counts the frames of the machine that runs it ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api); [02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
- Wall-clock time, in UTC, appears only where a person reads it, such as when a recording started and the dates on the report page.

### Messages and their types

The crate that defines the messages ([messages between components](#messages-between-components)) fixes how each link carries them:

- Over a WebSocket, to the sim's pages and the desktop app, a message is JSON that serde_json writes.
  Coherent GT parses JSON with no library of ours, at no frame time we could measure in the PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log][links]; [the sim's pages](#the-sims-pages)).
- Between the desktop app's Rust side and its pages, Tauri carries a command's arguments and its answer, and an event's payload, as JSON (documented, [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)), so the crate's messages reach the pages in the shape ts-rs types, while tauri-specta, not ts-rs, would type the command calls themselves (documented, [tauri-specta](https://docs.rs/tauri-specta/2.0.0-rc.21/tauri_specta/)).
  No probe has sent messages through Tauri; sending p07's samples from the Rust side to a page as a command's answer and as an event's payload, checked against ts-rs's types, settles it.
- A plugin gets each message as an object, through QuickJS-ng's own JSON parser, and its answer comes back to the core the same way (measured on our development machine, 2026-10-09, [architecture log][types]).
- In a data slot, a message is a struct of fixed-width fields, which the module reads in place.
  The crate asserts each struct's size and field offsets and builds for both x86_64 and wasm32, and the structs in our probe p07 kept one layout on both, while a struct holding a pointer-sized `usize` was 16 bytes on x86_64 and 8 on wasm32 (same entry).
- Over the helper's standard input and output, a message is binary and prefixed with its length, since it carries audio.
- Between cores, the encoding is for the node on how the cores reach each other.

The TypeScript sides take their types from ts-rs, which generates them from the crate.
Its large-integer setting, `TS_RS_LARGE_INT` or `Config::with_large_int`, is `number`, because serde_json writes a `u64` as a JSON number, and on its default, `bigint`, every sample carrying a time failed p07's type check (same entry).
So a `u64` reaches TypeScript exactly only up to 2^53: a time in µs stays under it for about 285 years ([times](#times)), and a field that can pass it crosses as text, as the IDs do ([IDs](#ids)).
Its output is types alone, which erase when compiled, so nothing of it runs in Coherent GT.
In p07, ts-rs's types took every message serde_json wrote and refused each of five wrong ones, while specta needed two opt-ins on a release candidate, and typeshare couldn't express an internally tagged enum ([architecture log][types]).

### Versions

- The watcher, the core, the helper, the desktop app, and the Community package, with the WASM module in it, carry one version number, which the build writes into each from one place.
  They update together ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), and a version number nothing reads drifts: fsc-editor's package version sat at 0.0.1 while its module's reached 0.3.0, until its build derived one from the other ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
- Each first message, the module's version slot, and each pilot's join carry that version and a hash of the message crate, both as text.
  - Between pilots, a core refuses a join whose version or hash differs from its own, so two development builds of one version whose messages differ refuse each other too.
  - On one machine, the core logs a component whose version or hash differs from its own, by name ([how the core knows a component is alive](#how-the-core-knows-a-component-is-alive)).
- Profiles and plugins carry versions of their own, and each declares the version of our plugin API it needs ([tentative decisions](decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)).

[types]: log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32

## Left open

- What counts as trouble for each component, and where the pilot sees it: the desktop app, the EFB app for a pilot in VR, or a notice on the banner when it costs them a feature ([ideas](../product/ideas.md#component-health)).
- How the cores reach each other ([between machines](#between-machines)).
- Letting a web page connect to the core, which the `Origin` check refuses (user, 2026-10-08): if an integration ever needs it, a site the pilot approves once, or one carrying a token, as the off-by-default listener for the tablet would ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
- How each module, and each hook our panel code installs for a plugin, tears itself down, for the panel bridge and the WASM module to design.
- Choices that stay inside one part:
  - the compiler and syntax target for code in Coherent GT, where no ECMAScript version matches the engine ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits))
  - the framework for the desktop app's pages
  - the core's async runtime and WebSocket library
  - the WebSocket client in the desktop app's Rust side, which has to send no `Origin` or `coui://html_ui`
  - whether the bindings to the SDK come from msfs-rs or from our own run of bindgen
  - how the build hashes the message crate, and the check in CI that ts-rs's files match it
  - whether the desktop app's pages take messages from its Rust side through Tauri's commands or its events
  - the binary format on the helper's standard input and output, since both its ends are Rust built against the crate
- How the cores pack each field of a message, such as whether a vector clock names each pilot by ID or by place in the member list, for the node on how the cores reach each other ([shared conventions](#shared-conventions)).
- Whether a clock our WASM module can read counts the same ticks as `QueryPerformanceCounter`, which decides whether the module can use the core's stamps without an offset, for the part that designs the flight-model sync ([times](#times)); a probe in which the module and the core each stamp the same data-slot write settles it.
- Which clock a page in the sim measures a span on, for the part that designs the panel bridge.
  The one cockpit panel's document probed for it, the A220's DisplayUnits, has `performance.now()` (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/results/p08-environment-vcockpit02-displayunits-2026-08-30-11-48-57.txt`), and the EFB's, the toolbar's, the banner's, and the menu's pages are untested; whether it runs steady in Coherent GT is unmeasured too, and our fork's panel code measured its spans with `Date.now()` instead.
  Timing each page's `performance.now()` against the core's counter over a few minutes settles it.
- What a core that restarts mid-flight gives up by registering its masks after the aircraft loaded, since on the A2A PA-24 a mask registered after the aircraft loaded didn't get ahead of the aircraft's own (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)), for the part that designs the core; restarting the core mid-flight on the PA-24 and checking whether its masks still get ahead of Accu-Sim settles it.
- Whether the SDK's library does what node-simconnect did beyond the main menu: masking, including a group that takes its priority as the sim starts, AI objects with liveries, input events, the camera, and a flight load's flow events, which tell the core when Ready to fly came ([what moves them](#what-moves-them)); a probe in a flight settles it, for the part that designs the core ([the core](#the-core)).
- Whether the toolbar script can open the banner outside a Build and Mount, at a flight load or mid-flight when a session starts then: we've seen it open the panel only after Build and Mounts, two times in three ([03-v1-scope](../product/03-v1-scope.md#notification-banner)).
- Where profiles and plugins are served from, how their signing keys are kept, and how often the core checks for new versions, for the part that designs profiles and updates; the profile registry, a Later pick, would deliver community profiles the same way ([ideas](../product/ideas.md#profile-registry)).
- Which APIs our panel bridge and WASM module offer plugins, for the part that designs plugins: the Baron 58P's plugin is the first case, and its profile settles what it needs ([plugins](../product/03-v1-scope.md#plugins)).
- How the core judges an aircraft settled in a session started before [03-catch-up](../sync/03-catch-up.md#settling-after-a-load)'s rule could call it settled.
  One way keeps [03-catch-up](../sync/03-catch-up.md#settling-after-a-load)'s 30s floor from Ready to fly and counts its 15s quiet window from when the profile loads.
- Whether the profile engine fires `H:` events through SimConnect's client events or through the calculator code our WASM module runs for plugins, which a probe of whether SimConnect's client events reach `H:` events settles.
