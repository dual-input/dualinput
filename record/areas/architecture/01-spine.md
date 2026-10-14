# Architecture: the spine

```text
Purpose:     What every other part of Crosscheck rests on: its components, how they talk, the conventions they share, its languages and frameworks, and its parts.
Depends on:  decisions.md, ../product/plan.md (step 7), ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     Which components Crosscheck runs, where each runs, and what each owns (node 1.1); what each does with no session, and what moves it into one and back (node 1.1.2); how they reach each other, and how the core knows each is alive (node 1.2); what language and toolchain each is built with, where the core's input and audio work runs, where a plugin's code runs and what it's written in, and how profiles and plugins reach pilots (node 1.3); the IDs, times, encodings, and versions every component shares, and who a pilot is after their core restarts (node 1.4); which frameworks each component builds on, how our code in the sim is compiled, and the check that keeps it within what Coherent GT runs (node 1.6); which parts Crosscheck's design divides into, where each is designed, and which part each open question belongs to (node 1).
```

> **Note**
> Since 2026-10-11, invite codes and introductions between cores are the backend's, not the relay's, and no running session waits on the backend; the relay runs n0's `iroh-relay` unmodified, admitting only Crosscheck: it carries a session's traffic when the cores can't link directly, and tells each core its public address ([01-between-machines](../network/01-between-machines.md#who-does-what)).
> That design doc also answers what this one leaves to node 2 in [between machines](#between-machines), [how the core knows a component is alive](#how-the-core-knows-a-component-is-alive), and the network's items in [left open](#left-open).
> It adds two items to the flight-model sync's list in [left open](#left-open): how far the following machine carries the aircraft on its last velocities through a short gap in the flying machine's data, how it eases it to the true position when data returns, and how the flying machine marks a stretch in which its sim stopped on purpose ([01-between-machines](../network/01-between-machines.md#softening-a-short-gap)); and easing the clock offset the following machine applies rather than stepping it ([01-between-machines](../network/01-between-machines.md#clock-offsets)).
> A pilot is cut off from the session after 30 minutes without a connection, not the 5 minutes this document gives in [what moves them](#what-moves-them) and [the session file](#the-session-file-and-a-core-that-restarts), and the session file also holds the core's endpoint key for the session, the crew's endpoint IDs, and the session's relay list with its tokens ([01-between-machines](../network/01-between-machines.md#coming-back)).
> Node 3 answers the sync items in [left open](#left-open), in [04-order-and-recovery](../sync/04-order-and-recovery.md): a core that crashes while the sim runs comes back as a late joiner, as a sim that closed does, rather than replaying what its pilot missed as [the session file](#the-session-file-and-a-core-that-restarts) says, so the session file needs nothing more; a vector clock names each counter by its pilot ID and restart count, and is each machine's one record of what it applied; and a session started after the aircraft loaded counts its quiet window from the profile's load.
> Node 2's control value answers [left open](#left-open)'s question of which of two take-control presses came first: every change of PF raises the generation, and of two changes with the same generation, the lower pilot ID wins ([01-between-machines](../network/01-between-machines.md#control)).
> A session flies one aircraft, its PF's, so [what moves them](#what-moves-them)'s change of aircraft within a session doesn't happen: a pilot who loads another aircraft is out of the flight, and once preflight has ended, a session with no pilot in the flight ends ([roles and members](../session/01-roles-and-members.md#the-pf)).
> A sim that closes counts as leaving the flight, so [the session file](#the-session-file-and-a-core-that-restarts)'s pilot whose sim restarted comes back as a late joiner, with control passed on if they were the PF.
> v1 has eight channels: the six that [between machines](#between-machines) counts, catch-up's stream from the flying machine, and a heartbeat once a second from every machine ([01-between-machines](../network/01-between-machines.md#channels)).
> Node 4 answers the profile items in [left open](#left-open), in [01-format-and-delivery](../profiles/01-format-and-delivery.md): CI publishes each profile from a public repository to GitHub Pages as one file with its modules and its compiled plugin in it, and the core fetches it by hash, unsigned, where [plugins](#plugins) says signed, since neither a profile nor a plugin reaches the pilot's files or the network; each time the core starts, it brings its cache of those files up to date, session or not, which its row in [components with no session](#components-with-no-session) leaves out, and it loads every profile from that cache; plugins' changes to aircraft files wait until a plugin needs one, and so do the watcher's jobs for them in [components](#components) and [communication](#communication), and the core's setting of which plugins may change files; a profile carries no version of its own, where [versions](#versions) gives it one, since the core computes its hash and CI works out its level; and the format and the plugin API share that level, which each release that adds to either raises, so a release runs everything at or below its own level.
> A profile's script, its write functions among it, is JavaScript in its YAML, which TypeScript checks against our declarations, where [language and toolchains](#language-and-toolchains) calls the profile's write functions TypeScript; plugins are TypeScript ([01-format-and-delivery](../profiles/01-format-and-delivery.md#names)).
> Since 2026-10-14, step 8 runs as nodes 5 to 8 of [the architecture plan](plan.md#5-the-code-map): the parts that [Parts](#parts) leaves to step 8 are designed in the children of [node 6](plan.md#6-systems), and an item that [Left open](#left-open) leaves to a stage of step 8 goes to the child for the system that owns it.

Each section up to [Frameworks](#frameworks) answers one child of node 1 in the [architecture plan](plan.md), and [Parts](#parts) and [Left open](#left-open) answer node 1 itself; the tentative decisions behind them, with their findings, are in [decisions.md](decisions.md).
The watcher and the core are Crosscheck's two long-running processes (user, 2026-10-06), and the core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)).
The flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).
A pilot is in a session from starting or joining it until leaving it, or until 5 minutes cut off ([the connection](../product/03-v1-scope.md#the-connection)).

## Components

Crosscheck runs as the watcher, the core, and the core's helper on each pilot's PC, with the desktop app when the pilot opens it, five pieces of code inside the sim, and three services off the pilots' machines.
The core owns everything a session does.
The desktop app and the EFB app show its state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
The components in the sim carry out what the core tells them, and undo it on their own once the core goes quiet ([what moves them](#what-moves-them)).
The watcher works while the core may not be running, and the services off the pilots' machines connect the crew, collect reports, and hold releases.

| Component | Runs in | Owns |
| --- | --- | --- |
| Watcher | A process of its own, from the pilot's login | Noticing the sim's start and stop from the operating system, starting the core with the sim and again if it exits, the BlurPage copy, and, while the sim is closed, plugins' changes to aircraft files and updates |
| Core | A process of its own, out of sight, started by the watcher or the desktop app | SimConnect, the session, the network, the profile engine and plugins, sim awareness, recording, audio, the take-control input, the figure's hand, AI traffic, the checks, and the pilot's settings |
| Helper | A process of its own, which the core starts and restarts | The core's Windows input and audio work: reading the keyboard, flight hardware, and mouse through Raw Input, capturing the microphone and the ATC app, running the speech recognizer, and playing sound |
| Desktop app | A window of its own, opened by the pilot, optional | Editing the settings the core keeps, the report page, and the session's view |
| EFB app | The EFB's document in the sim | The controls a pilot needs in flight, the EFB's opening onto it when a notice is clicked, and the banner panel's opening |
| Banner panel | An in-game panel of ours | Notices |
| Menu script | The main menu's document, through our copy of BlurPage | Go to, through the world map's requests, and reports of which menu page is up |
| Panel bridge | Every cockpit panel, through our `VCockpit.js` override | Pointer sync, the modules that features name, and what plugins ask of the panels |
| WASM module | The sim, as a standalone module from boot | The figures' placement, the aircraft's hold and writes, and the undoing of our state in the sim when the core goes quiet |
| Relay | Off the pilots' machines | Invite codes, introductions between cores, and a session's traffic when the cores can't link directly |
| Backend | Off the pilots' machines | Each pilot's part of a bug report, and later features that need a server of ours, such as [telemetry](../product/ideas.md#telemetry) |
| Release host | Off the pilots' machines | Installers and updates |

Plugins aren't components: a plugin's code runs only in the core, and reaches the cockpit panels and our WASM module through APIs our own code carries out ([plugins](#plugins)), and the watcher applies a plugin's changes to its aircraft's files while the sim is closed ([tentative decisions](decisions.md#plugin-code-runs-only-in-the-core)).
The installer runs once, and puts the app and our Community package in place ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
The figure is the other pilot's, which our WASM module draws ([avatar sync](../product/03-v1-scope.md#avatar-sync)).

Where each sits, and why:

- The watcher takes the jobs [installing and updating](../product/03-v1-scope.md#installing-and-updating) gives a program the sim launches, such as the warning at sim start that an update is waiting (user, 2026-10-06), and the [tentative decisions](decisions.md#the-watcher-keeps-the-blurpage-copy-current) give it the BlurPage copy.
- The core reads the take-control input ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)), runs the audio ([tentative decisions](decisions.md#the-core-runs-crosschecks-audio)), and works out where the figure's hand goes ([tentative decisions](decisions.md#the-core-works-out-where-the-figures-hand-goes)), with its helper doing the Windows input and audio work ([the helper](#the-helper)).
  It keeps the pilot's settings in its data folder, such as the take-control binding, the output device, the recording mode, and which plugins may change aircraft files, because it needs them while the desktop app is closed, as it is for a pilot flying in VR; the desktop app edits them by command, and the EFB app offers no setting in v1 ([EFB app](../product/03-v1-scope.md#efb-app); [tentative decisions](decisions.md#the-core-keeps-the-pilots-settings)).
  It also reads the clipboard when the pilot selects the EFB app's code box ([invite code](../product/03-v1-scope.md#invite-code)), reads the flight file that names the PF's stand ([preflight](../product/03-v1-scope.md#preflight)), and uploads a bug report when the pilot asks from the desktop app's report page ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- AI traffic is injected and written from the core, outside the sim.
  FS Copilot's app freezes each copy and writes it in SimConnect's `Frame` event (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficReceiver.cs`, `Render`, and `FsCopilot/Connection/SimTraffic.cs`), and the fork's prototype injector, driving copies the same way, moved them more smoothly than BeyondATC moves its own ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
- The core's checks are the version check at join ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), the [preflight match check](../product/03-v1-scope.md#preflight-match-check), and the check for another package's `VCockpit.js` override.
- The EFB app, the banner panel, and the menu script each reach the sim's documents by a route we measured on MSFS 2024: an app registered with the EFB ([interface log, 2026-10-06](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), an in-game panel ([2026-10-04](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), and a script that our copy of BlurPage loads ([2026-10-06](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
- The EFB app's code opens the banner panel, as it did from our installed package after a flight load and mid-flight; a script our toolbar icon loads did too, but only through a trick in the icon's markup that a sim update could stop, so Crosscheck ships none ([interface log, 2026-10-09](../interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus); [tentative decisions](decisions.md#the-efb-apps-code-opens-the-banner-panel)).
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
| EFB app | Offers to start a session or enter a code | Shows the session's controls, and opens the banner panel when the session has something to show |
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
                      │                                             menu script, panel bridge
                      ├── SimConnect ── the sim: masks, events, AI traffic, and the CommBus
                      ├── SimConnect data slots ── WASM module
                      ├── starts it; its standard input and output ── helper
                      └── the network ── other pilots' cores, the relay, the backend
 Watcher ── HTTPS ── release host
 Watcher ◀── files the core writes in its data folder ── Core
```

| Link | Means | What crosses | How the core knows it's alive |
| --- | --- | --- | --- |
| Watcher to core | The watcher starts the core's process, and reads files the core writes in its data folder | The port file's process ID and creation time, the date of the pilot's last session, each checked plugin's file changes, and which plugins the pilot lets change files | It can't: the watcher sends it nothing |
| Desktop app and core | WebSocket on 127.0.0.1, found through the port file | The core's state one way, commands the other | Messages every 2s |
| EFB app and menu script, and core | WebSocket, found through the CommBus, whether or not a session runs | The EFB's controls and state, the banner's opening, Go to, and which menu page is up | The same, and a first message naming the component and its version |
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
mainUi has no `Coherent`, so our menu script triggers `ADD_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS` and takes the core's calls as `EVENT_FROM_VIEW_LISTENER`, the way mainUi's own view listeners take events (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`).
That route rests on the sim's own page code rather than on the SDK's CommBus API ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so a sim update could change it, as it could the BlurPage copy.
In a page that has the sim's `common.js` but not its `Services/CommBus.js`, such as the EFB's and our banner's, our script loads `CommBus.js` and listens through `RegisterCommBusListener`.
An `L:` variable can't carry the port: mainUi can't read one, and a flight load reset ours to 0 ([interface log][links]).

The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so among programs outside the sim, only a SimConnect client of the pilot's sim can call on its CommBus, and a development core attached to a stand-in sim can't reach the real sim's pages, which no run has tried.

The CommBus carries these announcements and nothing else, for two reasons:

- A CommBus call reaches every page listening on its name, so each page would sort the whole session's traffic, as every panel did on FS Copilot's CommBus path (documented in the FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, "What exists").
- Its limits for a SimConnect client are unmeasured.

The core writes its port, its process ID, and its process's creation time, the `FILETIME` that `GetProcessTimes` gives, as for a run of the sim ([IDs](#ids)), to a file in its data folder, and one core runs for each data folder: a core that finds the file naming a core that's still running, with that ID and that creation time, exits ([tentative decisions](decisions.md#apps-outside-the-sim-find-the-core-through-a-port-file)).
Every reader of the file matches both, because a crashed core leaves its file behind, and Windows may give its process ID to another process ([IDs](#ids)).
So a pilot's PC runs one core, and a development core with a data folder of its own runs beside it.

### The sim's pages

- The EFB app and the menu script connect whenever they hear the core's announcement: with no session, the EFB app is where a pilot starts one, and the core asks the menu script which page is up ([components with no session](#components-with-no-session)).
  In a session, the EFB app's code also opens the banner panel when the core says the session has something to show.
- The banner panel connects while it's open, since closing it destroys its page ([interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).
- Every cockpit panel's panel bridge connects when it hears that a session started, sends a first message naming the instruments it holds, and gets back the modules to load, and a panel the core gives nothing closes its socket ([tentative decisions](decisions.md#cockpit-panels-connect-only-in-a-session-and-only-the-ones-in-use-stay)).
  Once it has loaded the profile and the plugins, the core keeps the panels holding the displays pointer sync replays into, one panel to listen for `H:` events, and those holding the instruments a plugin reads or writes.

A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log][coverage]).
So each page sends the core a message every 2s, and the core closes a socket it hasn't heard from in 8s, as FS Copilot's panels give up on their app 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog).

A socket in each of the PA-24's 16 cockpit panels cost no frame time we could measure.
With the frame rate uncapped, at about 83 fps, the two 10s measurements with nothing of ours read 12.25ms and 12.07ms a frame.
The measurements with our sockets read 12.01ms to 12.07ms, whether the sockets sat idle, took a message every 2s, or each took 30 messages a second, every message about 200 characters and parsed as JSON (measured on MSFS 2024, 2026-10-08, [interface log][links]; message size and parsing read in `experiments/areas/interface/p13-sim-links.mjs`).

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
- The watcher reads the core's process ID and creation time from the port file and shows its CPU and memory use beside its own ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
  It opens no socket to the core, and takes what its jobs need from files the core writes beside the port file: the date of the pilot's last session, which decides whether the warning that an update is waiting shows ([installing and updating](../product/03-v1-scope.md#installing-and-updating)); the file changes of each plugin the core fetched and checked; and which plugins the pilot lets change files ([plugins](../product/03-v1-scope.md#plugins)).
- The desktop app starts the core when the port file names no running process with that ID and creation time, and waits for the file to be written again.
- The core launches the desktop app when it isn't open and the pilot presses the EFB app's button that brings it to the front ([EFB app](../product/03-v1-scope.md#efb-app)).
  The Rejoin button the desktop app would show after a sim crash isn't in v1, which picked only the crew's notice that a pilot's sim crashed ([the product plan](../product/plan.md#3-v1-or-later); [ideas](../product/ideas.md#telling-the-crew-a-sim-crashed)).

### Between machines

The core talks to other pilots' cores, directly when it can and through the relay when it can't, and to the backend over HTTPS.
The watcher alone talks to the release host, over HTTPS.
How the cores reach each other is for [node 2](plan.md#2-how-the-cores-reach-each-other) of the architecture plan (user, 2026-10-08): the topology, the transport, getting through home routers, the relay, and encryption.

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
| EFB app, banner panel, menu script, and panel bridge | Coherent GT | TypeScript, compiled to the syntax Coherent GT parses |
| Plugins, and the profile's write functions | QuickJS-ng, embedded in the core | TypeScript, compiled to JavaScript |
| Backend | A Cloudflare Worker, its candidate host | TypeScript |

The relay's language is for the node that designs how the cores reach each other.

### The core

The core is a Rust program (user, 2026-10-08).

- It reaches the sim through the SDK's own `SimConnect.dll`.
  A Rust client on it connected to MSFS 2024, called mainUi over the CommBus and heard each answer, followed the "1sec" system event, and traded data slots with our Rust module, all at the main menu (measured on MSFS 2024, 2026-10-08, [architecture log][client]).
  In a flight in the A2A PA-24, a Rust client on it masked the elevator ahead of Accu-Sim with a group it took as the sim booted, created an AI PA-24 in another livery and our figure, read the camera, read, set, and heard an input event, called a cockpit panel over the CommBus, and followed the flight load's flow events, and all 66 of its calls returned `S_OK` (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
  `SimConnect_Open` returned `S_OK` 46s before the sim's open reply arrived, and the calls the client made in between took effect, so the core takes its masking group as soon as `SimConnect_Open` succeeds (same entry).
  Clearing one of a client's groups also cut the axis off from the client's other group, though each group held a client event of its own (read in `experiments/areas/architecture/flight/client/src/main.rs`), as removing a client event did through node-simconnect (same entry), so the core never clears a group, or removes a client event from one, while another of its groups hears that sim event.
- Its bindings to SimConnect, like the WASM module's to the sim, are generated from the SDK's headers, as FlyByWire's msfs-rs generates them with bindgen (read in [msfs-rs](https://github.com/flybywiresim/msfs-rs), its main branch on 2026-10-08, `msfs/build.rs`), so that no type is copied by hand.
  The core's client at the main menu ran on declarations written by hand from the header, where `HANDLE` is a pointer, and they worked ([architecture log][client]).
  The module's hand-written bindings gave `HANDLE` 32 bits where its headers give 64, and broke it ([code in the sim](#code-in-the-sim)).
  bindgen 0.72.1, with libclang from LLVM 23.1.3, gave `HANDLE` a pointer in the client and 64 bits in the module, as each header declares it, and the client and the module both ran in a flight on its declarations ([architecture log][flight]).
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
How it's compiled, and the check that keeps every file we ship into the sim within what Coherent GT runs, are in [frameworks](#frameworks).

Our WASM module is Rust, built by Navigraph's cargo-msfs and packaged by our own script: a module built that way loaded on MSFS 2024, ran its update about 136 times a second, and traded data slots with a SimConnect client at the main menu (measured on MSFS 2024, 2026-10-08, [architecture log][module]), and in a flight it echoed every write the client made, its update running 89.2 times a second (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).

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
  In a flight, with the sim in front, a later build got all 3 Page Down presses a person made, and 22 changes of a flight-hardware button's state in 10s, from its device by vendor and product ID (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
- Its build linked with Visual Studio 2022's linker; Rust's GNU target failed with Rust's own tools, and we haven't tried it with a full MinGW ([architecture log][helper]).
  rustup documents Visual Studio's "Desktop Development with C++" workload for the MSVC target, and says its Build Tools edition, without the IDE, needs a license to Visual Studio's Community, Professional, or Enterprise edition (documented, [rustup](https://rust-lang.github.io/rustup/installation/windows-msvc.html)).
- The speech recognizer runs in it, and the recognizer is chosen when the voice phrases are built ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

### The watcher

The watcher is Rust because it runs all day, shows the pilot its own memory use ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), and Rust is the language of our other programs.
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

The Rust components share one crate that defines each message they trade: the core's with the helper over its standard input and output, with the WASM module through the data slots, with the desktop app over its WebSocket, and with other pilots' cores over the network, so both ends of each of those links compile against one definition.
Three TypeScript sides trade those messages too: the sim's pages, the desktop app's pages, and plugins calling the core's host functions.
A message passed between languages needs one definition both sides are checked against ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)), so the TypeScript sides' types come from that crate ([messages and their types](#messages-and-their-types)).

[client]: log.md#2026-10-08-a-rust-program-on-the-sdks-own-simconnectdll-connects-to-msfs-2024-trades-commbus-calls-with-mainui-follows-system-events-and-trades-data-slots-with-our-rust-module
[engine]: log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off
[tauri]: log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin
[module]: log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide
[helper]: log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker
[tray]: log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron
[flight]: log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start

## Shared conventions

Every component names sessions and pilots by random UUIDs, carried as text wherever JSON or TypeScript reads them.
Every stamp in a message, the moment a value was read, is in µs on the sending PC's monotonic clock, and every span is in µs too.
The sim's pages and plugins can't stamp on that clock, so the core stamps their messages as they arrive, and it stamps each value it requests through SimConnect, and the WASM module's data-slot writes, the same way, unless the flight-model sync has the module stamp on its own clock, which counts the counter's ticks from an origin near the sim's start ([times](#times)).
Every message between our components on a pilot's PC, and between cores, is defined in one Rust crate, which ts-rs turns into TypeScript for the TypeScript sides, and every first message and join carries one version number and a hash of that crate.
A pilot keeps their ID when their core restarts, and the core counts its restarts, so the other machines can tell a core that restarted from one returning after an outage.
The tentative decisions behind each are in [decisions.md](decisions.md#sessions-and-pilots-are-named-by-random-uuids-carried-as-text-where-json-or-typescript-reads-them).

### IDs

- A session's ID is a version 4 UUID, which has 122 random bits ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562#section-5.4)), drawn by the host's core when it starts the session and given to each pilot as they join.
  It labels each pilot's recording and their part of a bug report, which the invite code can't, since a later session can draw the same six characters ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- A pilot's ID is a version 4 UUID too, drawn by the pilot's core when they start or join a session, and kept through every rejoin of it.
  A pilot's ID, with their core's restart count, keys their counters in the vector clocks ([the session file](#the-session-file-and-a-core-that-restarts)), and the conflict rule's tie-break compares two pilots' IDs as lowercase text, which orders them as their 128-bit values do ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
- Each crosses as its lowercase text, such as `3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a`, wherever JSON or TypeScript reads it, because there a 128-bit ID can't cross as a number; in a binary serde format, as between cores could be, the `uuid` crate writes its 16 bytes instead (read in uuid 1.27.0, `src/external/serde_support.rs`, `is_human_readable`).
  `BigInt` was missing from the one cockpit panel's document we probed for it (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/results/p08-environment-vcockpit02-displayunits-2026-08-30-11-48-57.txt`), and a JavaScript number holds every integer exactly only up to 2^53.
  In our probe [p07](../../../experiments/areas/architecture/p07-types.mjs), QuickJS-ng held a time of 2^53 + 1µs as 2^53, so a plugin that added 1 returned 2^53, not 2^53 + 2 (measured on our development machine, 2026-10-09, [architecture log][types]).
- The user chose 122 random bits over 64 (user, 2026-10-09): among 10 million sessions, a hypothetical lifetime total, the chance that any two share an ID is about 1 in 10^23 with 122 random bits, against about 1 in 370,000 with 64.
  A UUID is 36 characters as text and 16 bytes in a binary format.
  A session's ID crosses once, when a pilot joins, and a pilot's ID and restart count once as each link opens, or with every message on a link that carries several senders' messages ([the session file](#the-session-file-and-a-core-that-restarts)).
  If the encoding between cores names each vector clock counter by its pilot's ID and restart count rather than by a place in the [member list](../product/04-room-for-later.md#people-beyond-the-crew), every message's clock carries one ID for each counter: 32 bytes with two pilots in a binary format, 72 characters as text, and one more ID for each restart in the session.
  That choice, and how a place in the member list would name a restart count, is [left open](#left-open).
- A run of the sim is named by its process's ID and its creation time, the `FILETIME` that `GetProcessTimes` gives (documented, [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)), so a core that restarts can tell from its session file whether the sim restarted too ([the session file](#the-session-file-and-a-core-that-restarts)).
  The ID alone can't tell, because a process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)).

### The session file, and a core that restarts

The core keeps a session file in its data folder from when the pilot starts or first joins a session until they press Leave session, the session ends for them after 5 minutes cut off ([the connection](../product/03-v1-scope.md#the-connection)), or the core learns the session has ended.
It holds the session's ID and invite code, the pilot's ID, the core's restart count, and the run of the sim the pilot was in, and the part that designs sync may keep there what a restarted core needs to replay ([left open](#left-open)).
One core runs for each data folder ([finding the core](#finding-the-core)), so a development core beside the pilot's has a session file, and a pilot ID, of its own.

- The restart count goes up by 1 each time the core starts while the file exists, and the core flushes the raised count to disk before it opens any link, because a core that sent under a count it hadn't saved would reuse that count after a crash, and the others would drop its messages, numbered from 1 again, as copies.
- Between cores, a link opens by naming the sender's pilot ID and restart count, and each message on it carries its number in its channel.
  So every message is named by its sender's pilot ID, restart count, channel, and number.
  Where a link carries only its sender's messages, the pilot ID and restart count cross once, as it opens, rather than with each message, and a link that carries several senders' messages, as a relay's or a forwarding machine's could, carries each message's pilot ID and restart count with it.
  Whether any link does is for the node on how the cores reach each other.
  - A receiver uses that name to drop the second copy of a message that came both directly and through the relay ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
    How each channel tells a copy from a late message is [left open](#left-open): one that applies a sender's messages in order can keep the last number it applied and drop any at or below it, while one that keeps the newest sample of each object, as traffic's does ([channels](../product/04-room-for-later.md#channels)), can't drop by that number alone.
  - A link that opens again with the same restart count is the same core, back from an outage, so the receiver keeps what it knew of that sender's numbers, and drops the copies a replay brings.
  - A higher restart count for a sender, whether a link opens with it or a message on a link that carries several senders' messages brings it, is a core that restarted and numbers from 1 again, so the receiver starts that sender's numbers afresh, where without the count it would take the restarted core's messages for copies of old ones.
  - In the vector clocks, each counter belongs to a pilot's ID and a restart count, where [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) keeps one counter per pilot, so a restarted core starts a counter of its own, no counter goes backward, and each restart adds a counter to every clock for the rest of the session.
- A core could instead save the number of each message it sends and go on numbering after a restart, but that would put a disk write ahead of every send, where the restart count costs one write per start.
- A core that restarts while the sim keeps running, such as after a crash, rejoins the pilot under the same ID and replays what they missed, as [the connection](../product/03-v1-scope.md#the-connection) asks for a returning pilot whose sim kept running (user, 2026-10-09).
  It lost everything the sync engine held only in memory, among it its vector clock, each state entry's conflict stamp (the vector clock, pilot ID, and PF behind its value), its shadow values, which it can't read back from the aircraft ([01-profile-entries](../sync/01-profile-entries.md#keeping-a-shadow-value)), its state object, its record of which messages it had applied, the messages it held back for their predecessors, and its echo tokens ([02-live-sync](../sync/02-live-sync.md)).
  It also lost what it had sent that no machine had received, and if it was down longer than 1s, our WASM module has unfrozen the aircraft and cleared our variables that hold something back ([what moves them](#what-moves-them)).
  For pointer presses there's a lead: FS Copilot's panels kept what the pilot pressed while their app was down, "30 s, 200 events at most" (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03); it covers nothing a pilot changes through hardware or a key binding.
  The part that designs sync lists what its engine keeps in memory, and decides how a restarted core keeps or rebuilds each, so that the replay applies nothing twice, holds nothing back for good, and gets the others the changes its pilot made that never reached them ([left open](#left-open)).
- A core whose sim restarted too, which it tells from the run in the session file, rejoins the pilot under the same ID as a late joiner ([the connection](../product/03-v1-scope.md#the-connection)).
- FS Copilot made a restarted app a new peer instead: "Both the peer id and the session id are per app run, so a restarted peer is a new peer in every respect", and the fix its pre-PR review settled on lived with three limits: up to one acknowledgment interval of events could apply twice on a restarted peer, a restarted sender's history was gone, and a new third person got a replay they didn't need (same document, R03).
  The first two are for the part that designs sync, above, and the third doesn't arise in Crosscheck, since a pilot joining for the first time catches up state rather than replaying ([03-catch-up](../sync/03-catch-up.md#which-catch-up-runs-when)).

### Times

- Every stamp in a message, the moment a value was read, is a whole number of µs on Windows' `QueryPerformanceCounter`, whose ticks become µs through `QueryPerformanceFrequency`, and every span in a message, such as a gap between two presses, is a whole number of µs, whatever clock measured it.
  The counter counts from the PC's start, gives consistent readings across processes, never goes backward, and ignores changes to the system clock (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)).
  - The conversion to µs runs in 128 bits, because Windows fixes the counter at 10 MHz under a hypervisor, "or always in some newer versions of Windows" (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)), and at 10 MHz, ticks times 1,000,000 passes a signed 64-bit integer after about 10.7 days of the PC running.
  - A core that restarts goes on along the timeline it left, and a PC that restarts starts a new one, unless Windows' Fast Startup carries the counter over, which is untested.
    Both open their links with a higher restart count, so the count tells a receiver that the sender's timeline may have changed, not that it did.
  - Whole µs round a stamp by under 1µs, where whole ms would round it by up to 1ms, a quarter of a frame at 240 fps.
    2^53µs is about 285 years, so a stamp fits a JavaScript number exactly.
- The component that reads a value stamps it as it reads it, not when it builds, sends, or parses the message.
  Our traffic work found that "Sample times must not be arrival times", because arrival times carry the network's jitter into the path the receiver draws each aircraft along (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not"; [08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
  fsc-editor stamped each value as it was parsed, so about 192 values that arrived in one 8 KB message landed 0ms to 3ms apart, in the order they were parsed (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — The right answer was being sorted last for arriving 2 ms early").
- A page in the sim can't read `QueryPerformanceCounter`, and a plugin reads only QuickJS-ng's `Date.now()` and `performance.now()`, which rquickjs's full context includes (read in rquickjs-core 0.14.0, `src/context/builder.rs`, `intrinsic::All`) and which aren't shown to count the same ticks, so the core stamps each of their messages as it arrives, the nearest it comes to when the value was read.
  In a flight, from 20s after Ready to fly, at 89 module updates a second, a data-slot write the client made came back from our module in a round trip of 16.6ms median and 44.6ms at most, which bounds a data-slot write's one-way delay there; between the sim's open reply and Ready to fly, round trips reached 2.8s, past the module's 1s timeout ([what moves them](#what-moves-them); [left open](#left-open)); and a variable the module set in the same frame, requested through SimConnect each sim frame it changed, arrived 1.79ms median after the slot, and 193ms at most (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
  How long a page's message takes is unmeasured ([left open](#left-open)); the core can time, on its own counter, a page's echo of a message it sent, and that round trip bounds a page message's one-way delay.
  A page that needs a span measures it on its own clock and sends it in whole µs.
  FS Copilot's pointer sync does the same in ms: each gesture carries its `GapMs`, the idle time since the gesture before it, capped at 1,000ms (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`; [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage)).
  Its panel code measures that gap with `Date.now()` (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `_gapBefore`).
- WASI's monotonic clock, which our WASM module reads through `clock_time_get`, counts `QueryPerformanceCounter`'s ticks, 100ns on our 10 MHz machine, from an origin near the sim's start, not the PC's: one constant offset fit all 1,476 echoes over 299s of a flight, within ±33 ppm (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
  So the module can stamp what it reads, and its stamps reach the core's timeline through one offset per run of the sim, which the core estimates from the echoes' round trips; whether it does, rather than the core stamping each data-slot write as it arrives, as it does a page's messages, is for the flight-model sync ([left open](#left-open)).
- A receiver reads a sender's stamps through an offset it estimates for that sender, and keeps estimating, because two PCs' counters drift apart.
  A PC's crystal is typically within 50 ppm and can be off by as much as 500 ppm, and recent versions of Windows, "particularly Windows 8", compensate for a crystal's offset "to the extent possible" when Windows starts (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)).
  So two counters off in opposite directions part by about 8.6s a day at 50 ppm, and about 86s a day at 500 ppm, before that compensation, and how far two PCs' counters part in practice is unmeasured; logging two PCs' offset over a few hours settles it.
  How the offset is estimated, and what a higher restart count does to it, is [left open](#left-open) ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
- No frame count crosses between machines, because each sim runs its own frames ([08-01](../../learn/foundations/08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)).
  A pace in frames, such as a profile's `every(1, 'frame')` or the duplicate filter's 3 frames, counts the frames of the machine that runs it ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api); [02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
- Wall-clock time, in UTC, appears in a message only where a person reads it, such as when a recording started and the dates on the report page, and in the session file and the port file only inside a process's name, which the core compares and never measures with; the date of the pilot's last session, beside the port file, is the one wall-clock date a component compares with today ([the watcher and the desktop app](#the-watcher-and-the-desktop-app)).

### Messages and their types

The crate that defines the messages ([messages between components](#messages-between-components)) fixes how each link carries them:

- Over a WebSocket, to the sim's pages and the desktop app, a message is JSON that serde_json writes.
  Coherent GT parses JSON with no library of ours, at no frame time we could measure in the PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log][links]; [the sim's pages](#the-sims-pages)).
- Between the desktop app's Rust side and its pages, a message is the JSON text serde_json writes, carried as a string both ways, in a command's argument or answer or an event's payload (documented, [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)).
  A page parses the text it gets, as the sim's pages do, and the Rust side parses a page's text with serde_json, so each side reads the same text p07 checked ts-rs's types against, whatever Tauri does with a value it serializes itself.
  ts-rs types each message, but not the call that names a command and binds its arguments, which tauri-specta types (documented, [tauri-specta](https://docs.rs/tauri-specta/2.0.0-rc.21/tauri_specta/)); whether the desktop app types those calls with tauri-specta is [left open](#left-open).
- A plugin gets each message as an object, through QuickJS-ng's own JSON parser, and its answer comes back to the core the same way (measured on our development machine, 2026-10-09, [architecture log][types]).
- In a data slot, a message is a struct of fixed-width fields, which the module reads in place.
  The crate asserts each struct's size and field offsets and builds for both x86_64 and wasm32, and p07's structs kept one layout on both, while a struct holding a pointer-sized `usize` was 16 bytes on x86_64 and 8 on wasm32 (measured on our development machine, 2026-10-09, [architecture log][types]).
- Over the helper's standard input and output, a message is binary and prefixed with its length, since it carries audio.
- Between cores, the messages are the crate's, and their encoding is for the node on how the cores reach each other.

The TypeScript sides take their types from ts-rs, which generates them from the crate.
We set its large-integer setting, `TS_RS_LARGE_INT` or `Config::with_large_int`, to `number`, away from its default, `bigint` (read in ts-rs 12.0.1, `src/lib.rs`), because serde_json writes a `u64` as a JSON number, and on `bigint` every p07 sample carrying a time failed the type check ([architecture log][types]).
The setting covers `i64`, `u64`, `i128`, and `u128`, so each of them reaches TypeScript exactly only up to 2^53: a time in µs stays under it for about 285 years ([times](#times)), and a field that can pass it crosses as text, as the IDs do ([IDs](#ids)).
Its output is types alone, which erase when compiled, so nothing of it runs in Coherent GT.
In p07, ts-rs's types, with that setting, took every message serde_json wrote and refused each of five wrong ones, while specta needed two opt-ins on a release candidate, and typeshare couldn't express an internally tagged enum ([architecture log][types]).

### Versions

- The watcher, the core, the helper, the desktop app, and the Community package, with the WASM module in it, carry one version number, which the build writes into each from one place.
  They update together ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), and a version number nothing reads drifts: fsc-editor's package version sat at 0.0.1 while its module's reached 0.3.0, until its build derived one from the other ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
- Each first message, the module's version slot, and each pilot's join carry that version and a hash of the message crate, both as text.
  - Between pilots, a core refuses a join whose version or hash differs from its own, so two development builds of one version whose messages differ refuse each other too.
  - On one machine, the core logs a component whose version or hash differs from its own, by name ([how the core knows a component is alive](#how-the-core-knows-a-component-is-alive)); whether it then stops exchanging messages with that component is [left open](#left-open).
- Profiles and plugins carry versions of their own, and each declares the version of our plugin API it needs ([tentative decisions](decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)); how that version relates to Crosscheck's is [left open](#left-open).

[types]: log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32

## Frameworks

The core runs on tokio, the desktop app's pages are React, and our interface in the sim is the MSFS Avionics Framework's.
Our code in the sim is type-checked against ES2017 and bundled by esbuild at `es2017`, and a check run after every edit and in CI keeps every file we ship into the sim within what Coherent GT runs.
The tentative decisions behind these start at [decisions.md](decisions.md#the-core-runs-on-tokio).

| Component | Built on |
| --- | --- |
| Core | tokio, the async runtime Tauri runs on too; its WebSocket library is a choice inside the core ([left open](#left-open)) |
| Desktop app | Tauri, with pages in React, built with Vite and styled with Tailwind |
| Banner panel | The MSFS Avionics Framework's FSComponent, from our own pinned copy of `@microsoft/msfs-sdk` |
| EFB app | The same framework, registered through Asobo's EFB API; whether from our pinned copy or the sim's own is [left open](#left-open) |
| Menu script and panel bridge | No framework: TypeScript compiled as the rest of our code in the sim is |
| Plugins and the profile's write functions | QuickJS-ng in the core ([the core](#the-core)) |
| Watcher, helper, and WASM module | No framework beyond the libraries and toolchains in [language and toolchains](#language-and-toolchains) |
| Backend and relay | Open: the backend's for its part, the relay's for node 2 ([left open](#left-open)) |

### Compiling our code in the sim

- TypeScript checks the types with its `lib` set to `DOM`, `DOM.Iterable`, `ES2017`, and `ES2021.WeakRef`, as the MSFS Avionics Framework's own build sets it (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/sdk/tsconfig.json`), so a built-in from ES2018 on that the engine lacks, such as `Object.fromEntries`, fails the type check ([Coherent GT's JavaScript](coherent-gt.md#built-ins)); `Intl`, which ES5's lib declares, passes it.
- esbuild bundles each page's code at `es2017`, the target the framework, FlyByWire's TypeScript and instruments, and every other project we read compile to ([architecture log][research]).
  TypeScript 7.0.2 and esbuild 0.28.2 at `es2017` both lowered every later syntax our test module used, and it ran in the EFB's document and a cockpit panel, while esbuild refused FlyByWire's `safari11` target for an object rest in a parameter ([architecture log][p09]).
  esbuild lowers the code it bundles from packages too, where the framework's own pipeline, TypeScript then Rollup, compiles only its own files; that pipeline also runs the framework's TypeScript plugin, which rewrites `for`-`of` loops because Coherent GT runs them slowly (documented, `@microsoft/msfs-ts-transformer` 1.0.0 on npm), and esbuild can't run it ([left open](#left-open)).
- The banner panel bundles our own copy of `@microsoft/msfs-sdk`, pinned to one exact version, since the copy the sim provides can change with a sim update, as Working Title's G1000 pins 2.4.3 and ships its own (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/workingtitle-instruments-g1000/package.json`).
  Whether the EFB app can is [left open](#left-open): our probe apps registered with the EFB and drew with the sim's own copy, its global `msfssdk`, and no run has registered one drawn with a second copy.
  The framework's license is MIT, for use only in Microsoft Flight Simulator (read in the same repository, `LICENSE`).
- The EFB app and the desktop app's pages share TypeScript logic and the types ts-rs generates, not interface: a module of that kind, compiled at `es2017`, ran in the EFB's document ([architecture log][p09]).

### The check

Every JavaScript file we ship into the sim, experiments' files included, passes a check run after every edit and in CI, as step 7 asks ([the product plan](../product/plan.md#7-tech-stack-and-architecture)); nobody maintains a rule set for Coherent GT that we could use instead ([architecture log][research]).
The check is a tool of its own, built for our needs in a repository of its own under Crosscheck's GitHub organization, and published as it is, for anyone to use, without support (user, 2026-10-09).
It holds what [Coherent GT's JavaScript](coherent-gt.md) lists as one data file, and does two things to each file:

1. It parses the file at ECMAScript 2017, with the pattern of each regex literal and of each `new RegExp(...)` given a fixed string, so syntax newer than ES2017, in our code or in a package's, fails with its file, line, and column.
   - That covers the regex features from ES2018 on, which neither TypeScript 7.0.2 nor esbuild 0.28.2 makes work. TypeScript leaves such a regex as written, flagging named groups and the `s` flag but not lookbehind. esbuild hides it in a `new RegExp(...)` call, which parses and then throws when it runs ([Coherent GT's JavaScript](coherent-gt.md#syntax)).
   - A regex built from a pattern computed at run time escapes it.
   - A parse at ES2017 rejects object rest too, which the engine parses, so code written as JavaScript keeps to ES2017.
   - `node --check` passes such syntax, `?.` among it, because Node accepts it.
2. It fails any use of a built-in or web API the data lists as missing or filled in only in some documents, since TypeScript's DOM types declare every missing web API, such as `ResizeObserver`, ES5's lib declares `Intl`, and the type check doesn't see our JavaScript files.

Until the check exists, [CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks for `node --check` and a look at the reference.

[research]: log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework
[p09]: log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild

## Parts

A part is a piece of Crosscheck's design that a node of the [architecture plan](plan.md) or a stage of [step 8](../product/plan.md#8-v1-build-plan) designs, and its design docs and build stages go in its area under `record/areas/`.
A part may span several components, and a component may serve several parts.

| Part | What it covers | Components | Area | Designed in |
| --- | --- | --- | --- | --- |
| The core | SimConnect and the sim's events, sim awareness, the clients' protocol, the pilot's settings, the checks, and versions | Core, helper, menu script | `core/` | Step 8 |
| The network | The topology, the transport, home routers, the relay, encryption, each channel's delivery, and clock offsets between machines | Core, relay | `network/` | [Node 2](plan.md#2-how-the-cores-reach-each-other) |
| Sync | State sync, catch-up, conflicts, and the profile engine | Core, WASM module | `sync/` | [Node 3](plan.md#3-sync-and-the-session), then step 8 |
| The session | The invite code, the connection, roles, members, preflight and Go to, the match check, and the time, date, sim rate, and pause | Core, EFB app, desktop app, menu script, WASM module, watcher | `session/` | Node 3, then step 8 |
| Control | The take-control key and buttons, and voice phrases | Core, helper | `control/` | Step 8 |
| Profiles and plugin delivery | The profile format, how profiles and plugins reach pilots, and plugins' changes to aircraft files | Core, watcher, the server they come from | `profiles/` | [Node 4](plan.md#4-profiles-and-plugin-delivery) |
| Plugins and the hosts in the sim | The APIs and hooks plugins use, and the panel bridge and the WASM module as hosts that load modules by name | Core, panel bridge, WASM module | `plugins/` | Step 8 |
| Flight-model sync | The flying machine's pose and velocities on the following machines | Core, WASM module | `flight-model/` | Step 8 |
| Pointer sync | Presses on displays and panels | Panel bridge, core | `pointer-sync/` | Step 8 |
| Avatars | The figures, and the hand | Core, WASM module, helper | `avatars/` | Step 8 |
| Traffic and ATC | Traffic sync, and hearing ATC | Core, helper | `traffic-atc/` | Step 8 |
| The apps | The desktop app, the EFB app, and the banner | Desktop app, EFB app, banner panel | `interface/` | Step 8 |
| Recording and bug reports | The recording, bug reports, and the backend | Core, desktop app, backend | `recording/` | Step 8 |
| Installing and updating | The installer, and Crosscheck's updates | Watcher, release host | `install/` | Step 8 |
| The build | The message crate's generated types and hash, the version stamp, the checks CI runs, among them the Coherent GT parse check whose rules [1.6](plan.md#16-frameworks) sets, and the test bench | None | `build/` | Step 8 |

Findings so far stay in the logs that hold them: the time, date, sim rate, and pause in [environment](../environment/log.md), masking in [flight-controls](../flight-controls/log.md), and the CommBus in [commbus](../commbus/log.md).

### Sim awareness

Sim awareness is the piece of the core that reports whether the sim is closed, starting, in the menu and on which page, loading, at Ready to fly, or in a flight and with which aircraft (user, 2026-10-06).
It reports state only and knows nothing of features: a feature that depends on the sim's state reads it there rather than watching the sim itself, and decides on its own what to do with it, as preflight's Go to button is unavailable on a page it can't work from ([preflight](../product/03-v1-scope.md#preflight); [interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
Its sources are the sim's process, SimConnect's system and flow events, and the page the menu script reports ([components](#components)), and it reports a page it doesn't know as unknown rather than guessing.

## Left open

Each item sits under its part from [Parts](#parts), and names the node or the stage of step 8 that settles it.

**The core**, in its stage of step 8 unless an item says otherwise:

- The core's WebSocket library, which accepts a connection only with the `Origin` the core allows ([the sim's pages](#the-sims-pages)), and runs on tokio ([frameworks](#frameworks)).
- What a core that restarts mid-flight gives up by registering its masks after the aircraft loaded, since on the A2A PA-24 a mask registered after the aircraft loaded didn't get ahead of the aircraft's own (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
  Only the [input layer](../product/04-room-for-later.md#an-input-layer), a Soon pick that v1 doesn't build, masks, so the input layer's design after v1 settles it, not the core's stage of step 8; restarting the core mid-flight on the PA-24 and checking whether its masks still get ahead of Accu-Sim settles it.
- What the core does with a component on its own machine whose version or hash differs from its own, beyond logging it, such as a WASM module the sim loaded at boot from an older package, whose data slots the core would write in a layout the module doesn't read ([versions](#versions)).
- How a client beyond the PC is let in: v1 builds a protocol that can listen beyond the PC, off by default ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), while the core listens on 127.0.0.1 and its `Origin` check refuses a web page ([finding the core](#finding-the-core); [the sim's pages](#the-sims-pages)).
  The tablet would carry a token from the desktop app's QR code, and a web page, if an integration ever needs one, could be a site the pilot approves once, or one carrying a token (user, 2026-10-08).
- How the core tells a sim crash from the pilot closing the sim, which [the connection](../product/03-v1-scope.md#the-connection) leaves open, for sim awareness.
- Whether the bindings to the SDK, the core's and the WASM module's, come from msfs-rs or from our own run of bindgen ([the core](#the-core)).
- The binary format on the helper's standard input and output, since both its ends are Rust built against the crate ([messages and their types](#messages-and-their-types)).

**The network**, in [node 2](plan.md#2-how-the-cores-reach-each-other):

- How the cores reach each other ([between machines](#between-machines)).
- How the cores pack each field of a message; how each channel other than the cockpit's tells a copy from a late message, since the transport decides how each channel delivers, in order and resent or newest only ([channels](../product/04-room-for-later.md#channels)); and whether the relay's and the backend's messages are the crate's ([the session file](#the-session-file-and-a-core-that-restarts)).
- What a core does when it starts and finds a session file after being down long enough that its pilot may have been cut off for more than 5 minutes, as after a PC crash, since the file holds no time the core measures with ([the session file](#the-session-file-and-a-core-that-restarts)).
- How a receiver estimates each sender's offset, what a higher restart count does to that estimate, and how far two PCs' counters part in practice, which the flight-model sync uses ([times](#times)); logging two PCs' offset over a few hours settles the last.

**Sync**, in [node 3](plan.md#3-sync-and-the-session) unless an item says otherwise:

- How a core that restarted while the sim kept running recovers ([the session file](#the-session-file-and-a-core-that-restarts)).
  Node 3 lists what the sync engine keeps in memory, and decides how a restarted core keeps or rebuilds each, and what of it the core writes to the session file and when.
  It also decides how the cockpit channel tells a copy from a late message, how the conflict rule orders two changes from one pilot under two restart counts, which comparing pilot IDs can't, and how the others get the changes the pilot made that never reached them.
- Whether a vector clock names each counter by its pilot's ID and restart count or by a place in the [member list](../product/04-room-for-later.md#people-beyond-the-crew), and how a place would name a restart count ([IDs](#ids)).
- How the core judges an aircraft settled in a session started before [03-catch-up](../sync/03-catch-up.md#settling-after-a-load)'s rule could call it settled.
  One way keeps 03-catch-up's 30s floor from Ready to fly and counts its 15s quiet window from when the profile loads.
- Whether the profile engine fires `H:` events through SimConnect's client events or through the calculator code our WASM module runs for plugins, in sync's stage of step 8, which a probe of whether SimConnect's client events reach `H:` events settles.

**Control**, in its stage of step 8 unless an item says otherwise:

- How the machines agree on which of two take-control presses came first, which [the take-control key](../product/03-v1-scope.md#take-control-key) leaves to the architecture, in node 3, since the PF is the first role in its table of roles.
  Each machine reads another's stamps through an offset of its own ([times](#times)), so two presses closer than the offsets' error could order differently on two machines; the flying machine, the session's authority at every moment ([the connection](../product/03-v1-scope.md#the-connection)), could decide for every machine, which makes the machines agree, but for presses closer than that error can still pick the later one, against the take-control key's rule that the earlier press wins however small the gap.
- How Crosscheck tells speech from noise before it listens for a phrase, which [voice phrases](../product/03-v1-scope.md#voice-phrases) leaves to the architecture, with the intent to run recognition only while the pilot's microphone is loud enough to be speech; it runs in the helper, with the recognizer that stage chooses ([the helper](#the-helper)).

**Profiles and plugin delivery**, in [node 4](plan.md#4-profiles-and-plugin-delivery):

- Where profiles and plugins are served from, how their signing keys are kept, and how often the core checks for new versions; the profile registry, a Later pick, would deliver community profiles the same way ([ideas](../product/ideas.md#profile-registry)).
- How the version of our plugin API that each profile and plugin declares relates to Crosscheck's version ([versions](#versions)).

**Plugins and the hosts in the sim**, in their stage of step 8:

- Which APIs our panel bridge and WASM module offer plugins: the Baron 58P's plugin is the first case, and its profile settles what it needs ([plugins](../product/03-v1-scope.md#plugins)).
- How each module, and each hook our panel code installs for a plugin, tears itself down ([what moves them](#what-moves-them)).
- How our WASM module takes the session up again when the core's writes come back after a flight load, and how the core keeps the module's counter going quiet during a load from counting as trouble, since sim awareness reports the load ([sim awareness](#sim-awareness)).
  During a load, the client's round trips through the module reached 2.8s (measured on MSFS 2024, 2026-10-09, [architecture log][flight]), past the module's 1s timeout, after which it undoes our state as if the core had stopped.
  That costs a v1 session nothing: preflight holds an aircraft only once its pilot is in the flight ([preflight](../product/03-v1-scope.md#preflight)), and a load that starts while the module holds or writes an aircraft unloads that aircraft, as when its pilot leaves the flight ([the connection](../product/03-v1-scope.md#the-connection)).

**Flight-model sync**, in its stage of step 8:

- Whether the module stamps what it reads on WASI's monotonic clock, through one offset per run of the sim, rather than the core stamping each data-slot write as it arrives; which event in the sim's start sets that clock's 0; and how the core estimates the offset ([times](#times)).
- How far the core's arrival stamp trails the sim's read for a page's message, which each page that sends values needs too ([times](#times)); timing on the core's counter a page's echo of the core's message bounds it.

**Pointer sync**, in its stage of step 8:

- Which clock the panel bridge measures a span on; the apps' stage settles it for any other page that sends a span.
  The A220's DisplayUnits has `performance.now()` (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/results/p08-environment-vcockpit02-displayunits-2026-08-30-11-48-57.txt`), and FS Copilot's panel code measured its spans with `Date.now()` instead.
  In a flight, the EFB's, the toolbar's, and a PA-24 cockpit panel's `performance.now()` showed no jump over 145s against the core's counter, but about 8 samples each, through the inspector's 20ms round trips, couldn't tell its rate apart from the counter's below tens of ppm, and the menu's page is untested (measured on MSFS 2024, 2026-10-09, [architecture log][flight]); a longer run that keeps its samples settles it.

**The apps**, in their stage of step 8 unless an item says otherwise:

- What counts as trouble for each component, and where the pilot sees it: the desktop app, the EFB app for a pilot in VR, or a notice on the banner when it costs them a feature, with what the logs and the recording keep ([ideas](../product/ideas.md#component-health)).
- Whether the EFB app's code opens the banner during a flight load, before Ready to fly, and after a second flight load in one run of the sim, which no run has tried; it opened the panel 177s and 279s after Ready to fly ([interface log, 2026-10-09](../interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)).
- Whether the EFB app bundles our pinned copy of the MSFS Avionics Framework or draws with the sim's own, its global `msfssdk`, which our probe apps and FSTRaK's EFB app used ([architecture log][research]); no run has registered an EFB app drawn with a second copy, and p08's EFB app rebuilt against a bundled copy settles it ([frameworks](#frameworks)).
- Which version of `@microsoft/msfs-sdk` we pin, with 2.3.3 npm's newest as of 2026-10-09 while the framework's repository is at 2.4.3, and how its versions track sim updates, which no document states (same entry); the apps' stage picks the version, and re-running p09 and our pages after each sim update tracks it.
- The WebSocket client in the desktop app's Rust side, which must send either no `Origin` or `coui://html_ui` ([the desktop app](#the-desktop-app)).
- Whether the desktop app's pages and its Rust side trade the messages' JSON text through Tauri's commands or its events, and whether tauri-specta types the command calls ([messages and their types](#messages-and-their-types)).

**Recording and bug reports**, in its stage of step 8:

- What the backend runs on, which [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) leaves to the architecture, and its framework; a Cloudflare Worker with D1 and R2 is the candidate ([components](#components)).

**The build**, in its stage of step 8 unless an item says otherwise:

- How [the check](#the-check)'s tool is built: its parser, with p09's failing samples as its test; its list of banned built-ins and web APIs, with an exception for a package's own fill-in; and whether it also offers an ESLint config, for warnings in the editor as our sources are written.
- Whether the MSFS Avionics Framework's `for`-`of` rewrite, run through TypeScript before esbuild bundles, pays for itself in our interface, which a frame-time probe of the EFB app and the banner, built with it and without it, settles ([compiling our code in the sim](#compiling-our-code-in-the-sim)).
- How the build hashes the message crate, which has to cover each message's encoding as well as its fields, since FS Copilot's fingerprint covers a type's fields and not its codec, so a codec that wrote them in a new order would pass it ([09-05](../../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
- The check in CI that ts-rs's generated files match the crate.
- A stand-in for the second pilot's sim, so a developer runs a whole session on one PC ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and whether a second MSFS with its own Crosscheck runs in a virtual machine on the same PC, which a probe settles, both for the test bench; node 2's transport lets two cores run on one PC.
