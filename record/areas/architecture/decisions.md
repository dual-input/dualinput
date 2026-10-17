# Architecture: tentative decisions

What the architecture's nodes settled, each with the findings behind it and what it leaves out.
Step 7's are numbered as decisions in `record/decisions/` since 2026-10-13, once its top-level answers passed the walk through a session, as [the plan](plan.md#where-answers-go) says; step 8's, from [Crosscheck's code is a platform, engines, and features](#crosschecks-code-is-a-platform-engines-and-features-and-deleting-a-features-crate-leaves-the-rest-whole) on, are numbered once step 8's top-level answers pass theirs.
The numbered decision is the one that holds, and a change to it is a new decision that reverses it ([writing.md](../../../.claude/rules/writing.md#decisions)).
The watcher and the core are the two long-running processes in [the spine](01-spine.md), and the flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).

## The core starts with every sim run

Numbered as [decision 002](../../decisions/002-core-starts-with-every-sim-run.md) on 2026-10-13.

- **Decided:** the watcher starts the core whenever the sim starts, and again if the core exits while the sim runs, and the desktop app starts it when the pilot opens the app and the core isn't running.
  No code in the sim, such as a panel or the EFB app, starts the core.
  Settled in node 1.1 by the user, 2026-10-07, and the restart in node 1.2 by the user, 2026-10-08.
- **Because:**
  - Without the restart, a core that crashes mid-flight stays down until the pilot opens the desktop app.
  - A mask registered before the A2A PA-24 loaded got ahead of the aircraft's own, and one registered after it loaded didn't ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
    A core that starts after the flight loads couldn't hold back input on such an aircraft for soft takeover or mixed flight controls ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
  - A group that took its priority as the sim started, held open by an event it only listened to, masked the PA-24's elevator ahead of Accu-Sim once the axis was added after the flight loaded, and held nothing back until then; SimConnect answered before the main menu loaded its aircraft ([flight-controls log](../flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
  - The watcher takes over the jobs of programs the sim would launch (user, 2026-10-06), so it, rather than a program the sim launches, starts the core early enough.
  - Code in the sim reaches a program on the PC only if that program is already listening on 127.0.0.1 ([interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)), and we found no way for a panel to start one (unverified).
    A start button in the EFB app would need the watcher to listen and start the core, which is more than the watcher should do (user, 2026-10-07).
  - A core that runs through every sim run, session or not, has to cost little: a Rust program showing only a tray icon took 1.0 MB of private working set and no measurable CPU (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)); an idle core holding its SimConnect connection and its listener is unmeasured.
  - The desktop app's start covers a host who starts a session before the sim runs ([invite code](../product/03-v1-scope.md#invite-code)).
- **Leaves out:**
  - what the core and the other components do while no session runs, which [node 1.1.2](plan.md#112-components-with-no-session) designs
  - a pilot who has quit the watcher or turned it off, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) allows, so that nothing starts the core with the sim until they open the desktop app
  - when the core exits

## The watcher keeps the BlurPage copy current

Numbered as [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) on 2026-10-13.

- **Decided:** the watcher, not the core, makes our copy of the sim's BlurPage component from the sim's own file, watches that file, and makes the copy again whenever the file's hash differs from the one the copy was made from.
  This changes the [interface log's 2026-10-06 entry](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly), which gives the job to the core.
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:** the sim loads a package only when it boots ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so the copy has to be right before the sim starts, when the core may not be running yet, and the watcher, which starts with Windows, runs then.
- **Leaves out:** whether a sim update can change `fs-base-ui` while the sim boots, after the watcher's last check, which no run has tried ([interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).

## The core works out where the figure's hand goes

Numbered as [decision 004](../../decisions/004-core-works-out-figures-hand.md) on 2026-10-13.

- **Decided:** on the clicking pilot's machine, the core reads the aircraft's models, the camera, and the cursor, and finds each hand's point.
  This changes the avatars' tentative decision, which gave the job to the desktop app ([avatars decisions](../avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)).
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - The desktop app and the EFB app show Crosscheck's state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), and a hand worked out in the desktop app would stop whenever the app is closed.
  - Our avatar probes read the pilot's mouse from a program outside the sim through Windows' Raw Input in sink mode, which sits in nobody's input path ([mouse.mjs](../../../experiments/tools/mouse.mjs)).

## Our WASM module writes the following aircraft

Numbered as [decision 005](../../decisions/005-wasm-module-writes-following-aircraft.md) on 2026-10-13.

- **Decided:** our WASM module holds every machine's aircraft still in [preflight](../product/03-v1-scope.md#preflight), and on a following machine freezes the aircraft and writes the flying machine's pose and velocities inside the sim's frame.
  When it hasn't heard from the core for 1s, on any machine in a session, it unfreezes the aircraft, as [flight-model sync](../product/03-v1-scope.md#flight-model-sync) requires, and clears every variable of ours that holds something back ([01-spine](01-spine.md#what-moves-them)).
  Settled in node 1.1 by the user, 2026-10-07.
- **Because:**
  - Written from outside the sim each frame, the pose and velocities held on a parked Baron ([flight-model log](../flight-model/log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)), but an object written from outside stuttered in a moving cockpit, and one written from inside the sim's frame didn't ([avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)).
  - FS Copilot's module freezes the aircraft, writes the pose and four velocities, `A:VELOCITY BODY Y` and `Z` and `A:VELOCITY WORLD X` and `Z`, from samples 400ms in the past, and unfreezes the aircraft after 1s with no word from its app (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_physics`, and `wasm_module.h`, `k_delay_sec`), and we've flown with it (from our experience with FS Copilot).
    It leaves out the body X and rotation velocities, which a frozen aircraft keeps integrating ([flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)).
  - Unfreezing once the core stops needs code that outlives the core and can reach the aircraft: the watcher has no SimConnect link, since it notices the sim from the operating system ([01-spine](01-spine.md#components)), and our WASM module runs inside the sim.
  - Our probe module, `crosscheck-p12-follow`, held a figure in its seat from inside the sim's frame ([avatars log](../avatars/log.md#2026-10-03-nose-up-and-right-wing-down-are-negative-and-turned-by-full-attitude-a-wasm-written-figure-holds-its-seat)), and the product's figures need the same module.
- **Leaves out:** whether the following aircraft itself, written from outside the sim, stutters in flight, which nobody has flown, and we won't, because nothing would be gained (user, 2026-10-07).

## The core catches the take-control key and buttons

Numbered as [decision 006](../../decisions/006-core-catches-take-control-input.md) on 2026-10-13.

- **Decided:** the core reads the pilot's keyboard and flight hardware through Windows' input APIs, by way of the helper it starts ([below](#the-cores-input-and-audio-work-runs-in-a-helper-it-starts)), rather than mapping the input through SimConnect.
  Settled in node 1.1 by the user, 2026-10-07, and the helper in node 1.3 by the user, 2026-10-08.
- **Because:**
  - Pilots bind the key or a hardware button in Crosscheck's settings, as a single press or a long press ([take-control key](../product/03-v1-scope.md#take-control-key)), so Crosscheck needs each press and release.
  - A shortcut API in the desktop app, such as Electron's `globalShortcut`, which reports no release (documented in fsc-editor, `docs/sim-vars/08-marks.md`), would stop whenever the pilot closes the optional desktop app.
  - SimConnect's input mapping takes an event for the press and one for the release (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`, `SimConnect_MapInputEventToClientEvent_EX1`), and the user ruled it out as a hack (user, 2026-10-07).
  - Through Raw Input in sink mode, with the sim in front, a Rust helper got all 3 Page Down presses a person made, and 22 changes of a flight-hardware button's state in 10s, named by its device's vendor and product ID (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).

## The core runs Crosscheck's audio

Numbered as [decision 007](../../decisions/007-core-runs-audio.md) on 2026-10-13.

- **Decided:** the core captures the pilot's microphone and runs the speech recognizer, captures the ATC app's audio by process, and plays ATC and Crosscheck's own sounds on the device the pilot picks, in the helper the core starts ([below](#the-cores-input-and-audio-work-runs-in-a-helper-it-starts)), so the desktop app stays optional.
  Settled in node 1.1 by the user, 2026-10-07, and the helper in node 1.3 by the user, 2026-10-08.
- **Because:**
  - ATC and the handover cues play with no window open, so a pilot in VR hears them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).
  - FS Copilot's desktop process captures the ATC app by process with WASAPI's process loopback and plays it back (read in the FS Copilot fork, `FsCopilot/Audio/`), and the fork's `tools/AtcAudio` captured BeyondATC that way in a live flight (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled").
- **Leaves out:** the choice of recognizer, which is made when the voice phrases are built ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

## Every link between our components ends at the core

Numbered as [decision 008](../../decisions/008-every-link-ends-at-core.md) on 2026-10-13.

- **Decided:** no two of Crosscheck's components talk to each other directly, apart from the watcher downloading updates from the release host: each talks to the core, and the core passes on what another needs.
  Apart from the announcements through which the sim's pages find the core and learn whether a session runs ([below](#the-sims-pages-find-the-core-over-the-commbus-and-talk-to-it-over-a-websocket)), the core uses the CommBus and `L:` variables only to reach the aircraft's state; soft takeover, a Soon pick, would add a hold flag for each lever as an `L:` variable for the pilot's binding tool to read, and whether such a tool can make a binding wait on one is unverified ([ideas](../product/ideas.md#soft-takeover-on-handover)).
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - Each of v1's features needs only links that end at the core: a click on a notice in the banner panel, for one, opens the EFB onto our app by way of the core ([01-spine](01-spine.md#communication)).
  - One hub gives one place that logs every link, which component health needs ([ideas](../product/ideas.md#component-health)), and one owner of the session.
- **Leaves out:** a direct link that a later feature might need for speed.
  A panel's action meant for the WASM module takes a WebSocket and then a data slot, and nothing in v1 needs it faster.

## The sim's pages find the core over the CommBus and talk to it over a WebSocket

Numbered as [decision 009](../../decisions/009-sim-pages-find-core-over-commbus.md) on 2026-10-13.

- **Decided:** the core announces its port and whether a session runs on the CommBus every 2s, and at once when a session starts or ends, and a page in the sim that hears it opens a WebSocket to the core on 127.0.0.1.
  The CommBus carries only those announcements, and the core listens on a port Windows picks.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - In the main menu, 13 of the 14 pages heard a SimConnect client's CommBus calls, mainUi, the toolbar's page, and the EFB's among them, and in a flight, 30 of 31, among them all 16 of the A2A PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
    A page asking is less sure: a call the toolbar's page made before its listener reported ready never arrived (same entry).
  - Every page held a WebSocket to a program on the PC ([interface log](../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)).
  - An `L:` variable couldn't carry the port: the menu's page can't read one, and a flight load reset ours to 0 (same entry).
  - The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), so among programs outside the sim, only a SimConnect client of the pilot's sim can call on its CommBus.
    The core needs no fixed port that another program could take first, and a development core attached to a stand-in sim can't reach the real sim's pages, which no run has tried.
    FS Copilot's panels scan ports 9020 to 9024 and take whichever instance answers first, one of the three reasons its test bench can't run beside a live sim (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").
  - FS Copilot refused to announce its port over its CommBus path, because a bus that's down would take the WebSocket with it (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.2 Port discovery: range scan 9020–9024").
    That path ran through its WASM module; ours runs through the core's own SimConnect connection, without which the core has no sim to serve.
  - A CommBus call reaches every page listening on its name, so carrying the session over it would have every page sort every message, while a socket in each of 16 cockpit panels cost no frame time we could measure (same entry).
- **Leaves out:**
  - a sim update that changes how mainUi takes view listeners' events, which its route rests on (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`)
  - the CommBus's limits for a SimConnect client, which nobody has measured; our probes' 12 or 13 calls to each page all arrived ([interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel))

## Every client sends the core a message every 2s

Numbered as [decision 010](../../decisions/010-clients-message-core-every-2s.md) on 2026-10-13.

- **Decided:** every page, the desktop app, and the helper send the core a message every 2s, and the core closes a socket it hasn't heard from in 8s, and restarts a helper it hasn't heard from in 8s.
  Settled in node 1.2 by the user, 2026-10-08, and the helper's messages in node 1.3 by the user, 2026-10-08.
- **Because:**
  - A page's socket doesn't close when the page goes away: a cockpit panel's was still open when the run ended 23s after the panel reloaded, and all 16 cockpit panels' were still open as the inspector stopped listing them after the pilot left the flight (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel)).
  - FS Copilot's panels give up on their app 8s to 10s after its last 2s renewal (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`, `STATE_DEADMAN_MS` and its 2s watchdog), and a suspended process holds its sockets open and answers nothing (documented in the FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Outages are made by suspending a process").
  - A hung helper's process doesn't exit, so only its messages stopping tells the core it hung.
- **Leaves out:** how long the sim keeps a socket open after its page is gone, past 23s.

## Cockpit panels connect only in a session, and only the ones in use stay

Numbered as [decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md) on 2026-10-13.

- **Decided:** the panel bridge in a cockpit panel connects when it hears that a session started, names the instruments it holds in its first message, and gets back the modules to load, and a panel the core gives nothing closes its socket.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - With no session, nothing watches the cockpit ([01-spine](01-spine.md#components-with-no-session)).
  - The exchange is cheap: one per panel at a session's start, 20 on the Baron, whose cockpit has 20 panels ([interface log](../interface/log.md#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges)).
  - A first message from every panel tells the core the panel bridge loaded at all, which it doesn't when another package's `VCockpit.js` override wins ([installing and updating](../product/03-v1-scope.md#installing-and-updating)) or our own bridge fails to parse ([CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)).

## The EFB app's code opens the banner panel

Numbered as [decision 012](../../decisions/012-efb-app-opens-banner-panel.md) on 2026-10-13.

- **Decided:** in a session, the EFB app's code opens the banner panel when the core says the session has something to show, and closes it, by calling `TOOLBAR_BUTTON_TOGGLE` from the EFB's document.
  Crosscheck ships no script in the toolbar's document.
  This changes [03-v1-scope](../product/03-v1-scope.md#notification-banner), whose banner depends on a script that our toolbar icon puts into the toolbar.
  Settled in node 1.5 by the user, 2026-10-09.
- **Because:**
  - From our package installed in the Community folder, with no Build and Mount, the EFB app's code opened the panel and closed it again, 177s and again 279s after Ready to fly, and each call resolved; the toolbar listed the panel open, the inspector listed its page, and screenshots showed its card (measured on MSFS 2024, 2026-10-09, [interface log](../interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)).
  - The EFB app's code runs from the sim's start with the EFB closed ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), so it's there whenever the core has something to show.
  - A toolbar script did the same in the same run, but it reaches the toolbar's document through markup in our toolbar icon, which the toolbar runs, a trick a sim update could stop ([interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)), and it would be one more component to ship and watch (user, 2026-10-09).
- **Leaves out:** opening the panel during a flight load, before Ready to fly, and after a second flight load in one run of the sim, which no run has tried ([01-spine](01-spine.md#left-open)); and how the banner shows in VR, which waits for a headset ([the product plan](../product/plan.md#6-probes-that-retire-architecture-risks)).

## The core accepts a WebSocket only with the sim's Origin or none

Numbered as [decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md) on 2026-10-13.

- **Decided:** the core accepts a WebSocket whose `Origin` is `coui://html_ui` or missing, and refuses every other, and the desktop app connects from its Rust side.
  Settled in node 1.2 by the user, 2026-10-08, and the desktop app's side in node 1.3 by the user, 2026-10-08, with the desktop app a Tauri app.
- **Because:**
  - Every page we use sent `coui://html_ui`, all 14 in the main menu and all 32 in the A2A PA-24's flight (measured on MSFS 2024, 2026-10-08, [interface log](../interface/log.md#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one)); no other aircraft's pages were tried.
  - A Tauri app's pages sent `http://tauri.localhost`, as RFC 6455 requires of a browser client, and its Rust side, through tokio-tungstenite 0.30.0, sent no `Origin`, which the RFC allows a client that isn't a browser (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin); [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455#section-4.1), section 4.1).
  - Any page in a browser on the PC can open a WebSocket to 127.0.0.1 ([06-04](../../learn/foundations/06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost), its traps), so without the check, a page the pilot happens to have open could join them to a stranger's session or take control of their aircraft.
    Chrome may ask the pilot first for the local network (unverified, as of 2026-10-08), and the check doesn't rely on it.
- **Leaves out:**
  - a web page the pilot wants to connect, which a one-time approval or a token could let in later ([01-spine](01-spine.md#left-open))
  - a program on the PC, which can send any `Origin` and could do worse anyway

## Apps outside the sim find the core through a port file

Numbered as [decision 014](../../decisions/014-apps-find-core-through-port-file.md) on 2026-10-13.

- **Decided:** the core writes its port, its process ID, and its process's creation time, the `FILETIME` that `GetProcessTimes` gives, to a file in its data folder, and a core that finds the file naming a core that's still running, with that ID and that creation time, exits, so one core runs for each data folder.
  The desktop app reads the port there, and starts the core when the file names no running process with that ID and creation time; the watcher reads the process ID and creation time, and shows the CPU and memory use of the process that matches both beside its own.
  Settled in node 1.2 by the user, 2026-10-08, and the creation time in node 1.2 by the user, 2026-10-09, after node 1's walk through a session reopened it.
- **Because:**
  - The desktop app and the watcher hold no SimConnect connection, so the CommBus can't reach them.
  - A development core gets a data folder of its own, so it runs beside the pilot's, each with its own ports and identity, as [the product plan](../product/plan.md#7-tech-stack-and-architecture) asks.
  - A crashed core leaves its port file behind, and a process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)), so the ID alone could name another program, and a restarted core could find it and exit.

## The watcher reads what its jobs need from files the core writes

Numbered as [decision 015](../../decisions/015-watcher-reads-files-core-writes.md) on 2026-10-13.

- **Decided:** beside the port file, the core writes what the watcher's jobs need, the date of the pilot's last session.
  The watcher reads it, and opens no socket to the core.
  Settled in node 1.2 by the user, 2026-10-09, after node 1's walk through a session reopened it.
- **Because:**
  - The watcher warns of a waiting update only if the pilot flew lately ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), while the core, which knows when they last flew, may not be running ([01-spine](01-spine.md#components-with-no-session)).
- **Leaves out:**
  - how recent a last session has to be for the watcher to warn, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) leaves open
  - plugins' changes to aircraft files, which the watcher would apply before the sim boots from files the core writes, and which wait with how a plugin changes an aircraft's files ([plugin code runs only in the core](#plugin-code-runs-only-in-the-core))

## The core keeps the pilot's settings

Numbered as [decision 016](../../decisions/016-core-keeps-pilots-settings.md) on 2026-10-13.

- **Decided:** the core keeps the pilot's settings in its data folder, such as the take-control binding, the output device, and the recording mode, and reads them when it starts.
  The desktop app edits them by command, and decides nothing ([01-spine](01-spine.md#components)); the EFB app offers no setting in v1 ([EFB app](../product/03-v1-scope.md#efb-app)).
  [03-v1-scope](../product/03-v1-scope.md#efb-app)'s settings stay in the desktop app as the place a pilot edits them, and the core keeps their values.
  Settled in node 1.1 by the user, 2026-10-09, after node 1's walk through a session reopened it.
- **Because:**
  - The desktop app is optional, and a pilot in VR flies with it closed, while the core still needs the bound key ([take-control key](../product/03-v1-scope.md#take-control-key)), plays ATC "on the output device each pilot picks, with no window needed" ([hearing ATC](../product/03-v1-scope.md#hearing-atc)), and records in the mode a setting chooses ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
  - The desktop app and the EFB app show Crosscheck's state and send it commands, and decide nothing ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)), so the values the core acts on live with the core rather than in a file of the desktop app's.
- **Leaves out:**
  - the watcher's own settings, such as whether it starts with Windows, which the watcher keeps ([installing and updating](../product/03-v1-scope.md#installing-and-updating))
  - which plugins may change aircraft files, which waits with how a plugin changes an aircraft's files ([plugin code runs only in the core](#plugin-code-runs-only-in-the-core))

## The core writes the WASM module's control slot every 200ms

Numbered as [decision 017](../../decisions/017-core-writes-control-slot-every-200ms.md) on 2026-10-13.

- **Decided:** in a session, the core writes the WASM module's control slot every 200ms, with the session's state and a counter, and each kind of message has a SimConnect client data area, a data slot, of its own.
  The module leaves its version in a slot when it loads, and writes a counter every second.
  Settled in node 1.2 by the user, 2026-10-08.
- **Because:**
  - The module can't open a socket, so data slots are its link ([05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)).
  - FS Copilot's app writes its module's control slot every 200ms (read in the FS Copilot fork, `FsCopilot/Connection/SimClient.cs`, the constructor), and its module unfreezes after 1s with none, which we've flown with ([our WASM module writes the following aircraft](#our-wasm-module-writes-the-following-aircraft)).
  - Whether two writes to one slot in one frame both arrive is unmeasured ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)), so no two kinds of message share a slot.
  - A slot keeps its last value after its writer restarts (documented, same chapter), so a value that stays put can't show that the module still runs, and only a counter that moves tells the core it does.

## Crosscheck is written in Rust, and in TypeScript where an engine runs it

Numbered as [decision 018](../../decisions/018-rust-and-typescript.md) on 2026-10-13.

- **Decided:** the core, the helper, the watcher, the desktop app's program, and the WASM module are Rust.
  TypeScript is for the code in Coherent GT, the desktop app's pages, plugins, and the backend ([01-spine](01-spine.md#language-and-toolchains)), and a profile's script is JavaScript in its YAML, which TypeScript checks against our declarations ([01-format-and-delivery](../profiles/01-format-and-delivery.md#names)).
  The core reaches the sim through the SDK's own `SimConnect.dll`, and runs plugins and write functions in QuickJS-ng, embedded through rquickjs, with memory and time limits; the desktop app is a Tauri app; and the WASM module is built with Navigraph's cargo-msfs and packaged by our own script.
  The Rust code's bindings to the SDK are generated from the SDK's headers, and the Rust components share one crate that defines the messages they trade.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - The user chose Rust for every component a JavaScript engine doesn't run (user, 2026-10-08).
  - At the main menu, a Rust client on the SDK's own `SimConnect.dll` did what the core does there: it connected, traded calls with mainUi over the CommBus, followed a system event, and traded data slots with our module (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-rust-program-on-the-sdks-own-simconnectdll-connects-to-msfs-2024-trades-commbus-calls-with-mainui-follows-system-events-and-trades-data-slots-with-our-rust-module)).
  - A standalone module built by cargo-msfs ran on MSFS 2024 at the main menu and traded data slots with a SimConnect client (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)).
  - A Rust helper did the helper's Windows input and audio work, built with Visual Studio's linker (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-rust-program-captures-one-processs-audio-plays-on-a-device-it-looks-up-by-name-and-receives-keyboard-and-hid-input-through-raw-input-in-sink-mode-and-builds-with-visual-studios-linker)).
  - A Rust program showing only a tray icon took a fortieth of the memory Electron's processes took for the same (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)).
  - Embedded in Rust, QuickJS-ng held its memory and time limits as built, with the host running on, while V8's process died on an endless allocation unless TurboFan was off, and Node's `vm` module has no memory limit (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)).
  - A Tauri window took about the memory of an Electron one, with a program a fortieth of the size, and its Rust side's WebSocket sends no `Origin` (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).
  - The module's hand-written bindings gave `HANDLE` the wrong width for the SDK's WebAssembly headers, and nothing reported it until the sim's calls failed (measured on MSFS 2024, 2026-10-08, [architecture log](log.md#2026-10-08-a-standalone-module-built-from-rust-with-cargo-msfs-and-packaged-by-our-own-script-runs-on-msfs-2024-and-trades-data-slots-with-a-simconnect-client-once-its-simconnect-handle-is-64-bits-wide)), so no type is copied by hand.
  - The user chose TypeScript for the code a JavaScript engine runs: the sim's pages, the desktop app's pages, plugins and write functions, and the backend (user, 2026-10-06 and 2026-10-08), and Coherent GT, WebView2, QuickJS-ng, and a Cloudflare Worker each run the JavaScript it compiles to.
  - In a flight, a Rust client on the SDK's `SimConnect.dll` masked the elevator ahead of Accu-Sim with a group it took as the sim booted, created AI objects with liveries, read the camera, read, set, and heard an input event, called a cockpit panel over the CommBus, and followed the flight load's flow events, and our Rust module echoed every slot write the client made, both on declarations bindgen generated from the SDK's headers (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- **Leaves out:**
  - a build without Visual Studio's linker, which failed with Rust's own tools ([01-spine](01-spine.md#the-helper))
  - the relay's language ([01-spine](01-spine.md#language-and-toolchains)), and the choices that stay inside one part ([01-spine](01-spine.md#left-open))

## The core's input and audio work runs in a helper it starts

Numbered as [decision 019](../../decisions/019-input-and-audio-run-in-helper.md) on 2026-10-13.

- **Decided:** the core's work with Windows input and audio, through Raw Input, the microphone, ATC capture, playback, and the speech recognizer, runs in the helper, a program of its own.
  The core starts the helper in a session and while the desktop app binds a key or lists the output devices, starts it again if it exits, and talks to it over its standard input and output.
  Settled in node 1.3 by the user, 2026-10-08.
- **Because:**
  - A crash in that code, such as in a speech recognizer's C or C++ library, takes the core down if it runs in the core's process, and the pilot out of the session until the watcher restarts the core and they rejoin ([01-spine](01-spine.md#the-helper)), while the core restarts a helper that crashes, and the session goes on.
  - Our probes read Raw Input from a program they start, line by line over its standard output ([mouse.mjs](../../../experiments/tools/mouse.mjs)).
- **Leaves out:** the fields of the helper's messages, which the crate the Rust components share defines for both ends ([01-spine](01-spine.md#messages-between-components)), and their binary format, a choice inside the core and the helper ([01-spine](01-spine.md#left-open)).

## Plugin code runs only in the core

Numbered as [decision 020](../../decisions/020-plugin-code-runs-only-in-core.md) on 2026-10-13.

- **Decided:** a plugin is TypeScript that implements an interface of ours and runs only in the core, in QuickJS-ng embedded there under memory and time limits ([above](#crosscheck-is-written-in-rust-and-in-typescript-where-an-engine-runs-it)), and it reaches the cockpit panels, the WASM module, and the sim only through APIs our own code carries out, and never the pilot's files or the network.
  Nothing a plugin ships runs in a panel or in the module: for something inside the sim's frame, our module offers mechanisms the plugin drives, such as writing given variables every frame, running given calculator code, or placing an object, and for something in a panel, our panel bridge offers generic operations.
  A plugin belongs to one profile and sits beside it, runs on every variant the profile covers, and writes only through `write()`, with the panel bridge's operations among its targets ([01-format-and-delivery](../profiles/01-format-and-delivery.md#plugins)).
  This changes [04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim), which gives plugins hooks in the panels and in the WASM module that load their modules by name, and answers [03-v1-scope](../product/03-v1-scope.md#plugins)'s question of where each part of a plugin runs.
  Settled in node 1.3 by the user, 2026-10-08, and narrowed to the sim and the aircraft in node 4, 2026-10-11.
- **Because:**
  - Plugins implement a framework API, the way a class implements an interface, and their code runs only in the core's engine; when a plugin needs something done in panel code, we offer the API, and our own panel code carries it out (user, 2026-10-08).
  - Crosscheck's own code owns each mechanism, and a plugin owns the policy, and code that serves one product lives in a plugin, never in Crosscheck's own code ([04-room-for-later](../product/04-room-for-later.md#plugins)), so frame logic and panel code for one aircraft stay out of our module and our panel bridge.
  - Our generic panel code keeps the fail-open rules for anything in the pilot's input path ([CLAUDE.md](../../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)), whatever a plugin asks of it.
  - A plugin that's only JavaScript and data can reach pilots apart from Crosscheck's releases ([below](#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)), while the WASM module and the panel bridge load only when the sim boots or a panel loads.
  - A plugin that read the pilot's files, published from a hijacked repository, could pass them to a crewmate over a channel; with no files or network, a plugin can do no worse than a profile, which only spoils a flight, so neither needs signing, and the 58P's plugin is expected to read its gauges' JavaScript and DataStorage through our panel bridge and need no files, which is unverified until a panel probe reaches those settings (user, 2026-10-11).
- **Leaves out:**
  - which APIs our panel bridge and module offer, for the part that designs plugins; the Baron 58P's plugin is the first case, and its profile settles what it needs ([plugins](../product/03-v1-scope.md#plugins))
  - a plugin that needs logic inside the frame beyond what calculator code expresses, which no v1 plugin is known to need
  - how a plugin changes an aircraft's files, which waits until a plugin needs it, with [decision 001](../../decisions/001-changing-other-developers-packages.md) holding meanwhile (user, 2026-10-11)

## Profiles and plugins reach pilots apart from Crosscheck's releases

Numbered as [decision 021](../../decisions/021-profiles-and-plugins-apart-from-releases.md) on 2026-10-13.

- **Decided:** profiles and plugins update apart from Crosscheck's releases.
  They live in one public repository of flat files, and on each merge CI builds each profile into a bundle, one YAML file with its modules merged in and its plugin compiled to JavaScript under a `plugin:` key only the builder writes, checks it, works out its level, and publishes it on GitHub Pages: an index of every published bundle, with its profile's path, the variants it covers, its hash, the date CI published it, and its level, and every bundle under its hash, kept for good.
  Each time the core starts, it fetches the index and downloads the newest bundle of each profile at or below its own level that its cache lacks, checking the bytes against the hash; it never rebuilds a published bundle, and it loads every profile from that cache.
  A session flies one aircraft and pins one bundle, by hash, which doesn't change mid-session outside a test session; a pilot whose machine lacks the pinned bundle fetches it by its hash.
  The format and the plugin API share one level, an integer that each release adding to either raises by 1, and a release runs every bundle at or below its own level.
  Nothing is signed, and a profile carries no version or date of its own.
  For testing, the core builds the same bundle from a local folder, and shows it in the match check as "unpublished".
  This changes [03-v1-scope](../product/03-v1-scope.md#plugins), whose plugins ship and update with Crosscheck, and settles the spine's questions of whether profiles reach pilots apart from Crosscheck's releases, where they're served from, how often the core checks, and how the plugin API's version relates to Crosscheck's.
  Settled in node 1.3 by the user, 2026-10-08, and in node 4, 2026-10-11 and 2026-10-12 ([01-format-and-delivery](../profiles/01-format-and-delivery.md#delivery)).
- **Because:**
  - If profiles and plugins shipped in releases, every fix to one would take a new Crosscheck.
    A pilot installs a new Crosscheck only with the sim closed, and pilots on different versions can't fly together, so after each fix two pilots couldn't fly until both had closed the sim to install it (user, 2026-10-08; [installing and updating](../product/03-v1-scope.md#installing-and-updating)).
  - The [preflight match check](../product/03-v1-scope.md#preflight-match-check) already compares each profile by a hash, and the profile registry, a Later pick, would fetch a profile by that hash ([04-room-for-later](../product/04-room-for-later.md#profiles)).
  - A plugin published apart from its profile escaped the profile's hash, pin, and level: a merge that changed only the plugin left the hash the same while two pilots ran different plugins, and a plugin needing a newer level could ride beside an older profile (node 4's review, 2026-10-12).
  - Plugin code runs only in the core ([above](#plugin-code-runs-only-in-the-core)), so the core can load a new version whenever a session isn't using the old one.
  - A cache brought up to date at each start lets the core load a profile at any moment a session needs one, such as a session started with the aircraft already loaded, with no wait on the network, and a session changes no bundle midway anyway (user, 2026-10-12).
  - The repository authors edit is the one CI publishes from, and GitHub Pages "sites have a soft bandwidth limit of 100 GB per month" (documented, [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)), while GitHub's REST API allows an unauthenticated address 60 requests an hour (documented, [rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  - Neither a profile's script nor a plugin reaches the pilot's files or the network ([above](#plugin-code-runs-only-in-the-core)), so a hijacked repository could publish something that spoils flights and nothing more, and a signature would help only with a key kept off GitHub, a manual step in every publish (user, 2026-10-11).
  - A strict loader refuses what it doesn't know: our FS Copilot fork's new `pointer:` key "bricks profile loading on older releases" (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, item 6), so a core has to know which version it can run, and a level CI works out asks nothing of authors (user, 2026-10-11).
  - Versions are hard for an average author, and a date the author writes is missing from 4 of FS Copilot's 56 profiles (fsc-editor, `docs/sim-vars/18-language-core.md`, `header-updated`), so the hash is computed and the date is when CI published (user, 2026-10-11).
- **Leaves out:** which pilot's bundle the session pins when two pilots' cores took different ones, which compiler the core embeds for a local build, and test sessions, in which the author's core sends each saved bundle to the crew and every machine reloads it, with the three needs [01-format-and-delivery](../profiles/01-format-and-delivery.md#testing-an-edit) lists, for step 8; and signing, if a later plugin needs the pilot's files.

## Sessions and pilots are named by random UUIDs, carried as text where JSON or TypeScript reads them

Numbered as [decision 022](../../decisions/022-random-uuids-as-text.md) on 2026-10-13.

- **Decided:** a session's ID and a pilot's ID are each a version 4 UUID, which has 122 random bits.
  The host's core draws the session's when it starts the session, and each pilot's core draws theirs when they start or join a session, and keeps it through every rejoin of it; each crosses as its lowercase text wherever JSON or TypeScript reads it.
  A run of the sim is named by its process's ID and the time the process was created.
  This answers [03-v1-scope](../product/03-v1-scope.md#recording-and-bug-reports)'s question of what form the session's ID takes, and [02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)'s of a pilot ID's form.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - The user chose 122 random bits over 64 for the margin against two sessions sharing an ID (user, 2026-10-09).
    As text, an ID costs 36 characters each time it crosses: once per join or link, in every message on a link that carries several senders' messages, and in every message if the vector clocks name each counter by ID ([01-spine](01-spine.md#ids)).
  - `BigInt` was missing from the one cockpit panel's document we probed for it, and a JavaScript number holds every integer exactly only up to 2^53, which our QuickJS-ng run showed, so a 128-bit ID can't cross as a JavaScript number ([01-spine](01-spine.md#ids)).
  - The invite code can't name a session for a bug report, since a later session can draw the same six characters ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
  - A process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)), so the ID alone can't tell one run of the sim from the next.
- **Leaves out:** how the cores pack each vector clock counter's key, by pilot ID and restart count or by place in the member list ([01-spine](01-spine.md#left-open)).

## A pilot keeps their ID through a core restart, and the core counts its restarts

Numbered as [decision 023](../../decisions/023-pilot-id-and-restart-count.md) on 2026-10-13.

- **Decided:** the core keeps a session file in its data folder, from when the pilot starts or first joins a session until they press Leave session, the session ends for them after 30 minutes cut off ([01-between-machines](../network/01-between-machines.md#coming-back)), or the core learns the session has ended.
  The file holds the session's ID and invite code, the pilot's ID, the core's restart count, the run of the sim the pilot was in, the core's endpoint key for the session, the crew's endpoint IDs, and the session's relay list with its tokens ([01-between-machines](../network/01-between-machines.md#joining)).
  The restart count goes up by 1 each time the core starts while the file exists, and the core flushes the raised count to disk before it opens any link.
  Between cores, every message is named by its sender's pilot ID, restart count, channel, and number: a link that carries only its sender's messages names the pilot ID and restart count once, as it opens, and a link that carries several senders' messages carries them with each message; a receiver keeps what it knew of a sender's numbers when its link opens again with the same count, and starts them afresh when it sees a higher count for that sender, on a link that opens with it or on a message that carries it.
  In the vector clocks, each counter belongs to a pilot's ID and a restart count.
  This changes [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)'s and [04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew)'s one counter per pilot, and gives 02-live-sync's message ID its form.
  A core that restarts rejoins the pilot under the same ID as a late joiner, whether its sim kept running or restarted too ([below](#a-core-that-crashes-comes-back-as-a-late-joiner)).
  This settles node 1.4's question of what a pilot's identity is across a core restart ([architecture plan](plan.md#14-shared-conventions)).
  Settled in node 1.4 by the user, 2026-10-09, and a restarted core's late join in node 3 by the user, 2026-10-12.
- **Because:**
  - A receiver drops a message it has already applied ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)), so a receiver that didn't know a core restarted would take its messages, numbered from 1 again, for copies of old ones.
    A link back from an outage under the same count is the same core, whose replay the receiver dedupes against the numbers it kept.
  - FS Copilot made a restarted app a new peer, and the fix its pre-PR review settled on lived with three limits: up to one acknowledgment interval of events could apply twice on a restarted peer, a restarted sender's history was gone, and a new third person got a replay they didn't need (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03); the third doesn't arise in Crosscheck, since a first join catches up state ([01-spine](01-spine.md#the-session-file-and-a-core-that-restarts)).
  - [The connection](../product/03-v1-scope.md#the-connection) reconnects a returning pilot from session state saved on their machine; the user first chose that a crashed core replays what its pilot missed (user, 2026-10-09), then that it comes back as a late joiner, the path a sim crash already takes (user, 2026-10-12).
  - A core could instead save the number of each message it sends and go on numbering after a restart, but that puts a disk write ahead of every send, where the restart count costs one write per start.
- **Leaves out:**
  - how a restarted core recovers everything the sync engine held only in memory, and gets the others the changes its pilot made that never reached them, which node 3 answers with a late join ([below](#a-core-that-crashes-comes-back-as-a-late-joiner))
  - how each channel tells a copy from a late message, for the part that designs sync and the node on how the cores reach each other ([01-spine](01-spine.md#left-open))
  - how the conflict rule orders two changes from one pilot under two restart counts, which comparing pilot IDs can't, for the part that designs sync ([01-spine](01-spine.md#left-open))
  - what a core does when it starts and finds a session file after being down long enough that its pilot may have been cut off for more than 30 minutes, which node 2 answers ([01-between-machines](../network/01-between-machines.md#a-session-file-after-a-long-outage))
  - what a core that restarts mid-flight gives up by registering its masks after the aircraft loaded ([01-spine](01-spine.md#left-open))

## A time in a message is µs on the sender's PC's monotonic clock

Numbered as [decision 024](../../decisions/024-times-in-microseconds-on-monotonic-clock.md) on 2026-10-13.

- **Decided:** every stamp in a message, the moment a value was read, is a whole number of µs on Windows' `QueryPerformanceCounter` on the sender's PC, whose ticks become µs through `QueryPerformanceFrequency`, and every span in a message is a whole number of µs, whatever clock measured it.
  The conversion to µs runs in 128 bits, so it doesn't overflow on a PC that has run for weeks.
  A value is stamped when it's read, and the core stamps each message from a page in the sim or a plugin, and each value it requests through SimConnect, as it arrives, since a page can't read the counter, and the clocks a plugin can read, QuickJS-ng's `Date.now()` and `performance.now()`, aren't shown to count the same ticks; a page that needs a span measures it on its own clock and sends the span.
  The core stamps each data-slot write from our WASM module as it arrives, unless the flight-model sync has the module stamp on WASI's monotonic clock, which counts the counter's ticks from an origin near the sim's start (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), so its stamps reach the core's timeline through one offset per run of the sim.
  A receiver reads a sender's stamps through an offset it keeps estimating for that sender.
  No frame count crosses between machines: a pace in frames counts the frames of the machine that runs it.
  Wall-clock time, in UTC, appears in a message only where a person reads it, and in the session file only inside a run's name, which the core compares and never measures with.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - `QueryPerformanceCounter` counts from the PC's start, gives consistent readings across processes, never goes backward, and ignores changes to the system clock, while a stamp on the wall clock moves when Windows sets that clock (documented, [Acquiring high-resolution time stamps](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps)); so a restarted core goes on along the timeline it left.
  - Two PCs' counters can part by about 8.6s a day when both crystals sit 50 ppm off in opposite directions, before Windows compensates at start, and how far they part in practice is unmeasured ([01-spine](01-spine.md#times)), so one offset estimated once doesn't hold.
  - A stamp, counted in µs from the PC's start, fits a JavaScript number exactly for about 285 years ([01-spine](01-spine.md#times)).
  - Each sim runs its own frames ([08-01](../../learn/foundations/08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)), so a frame on one machine names no moment on another.
  - Samples stamped as they arrived carried the network's jitter into our traffic work's paths ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)), and fsc-editor's values stamped as they were parsed landed 0ms to 3ms apart, in the order they were parsed (measured on MSFS 2024, 2026-08-24, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — The right answer was being sorted last for arriving 2 ms early").
- **Leaves out:** how the offset is estimated, what a higher restart count does to it, and how far two PCs' counters part in practice, for the flight-model sync and the node on how the cores reach each other; whether the module stamps on its own clock, which event sets that clock's 0, and how the core estimates its offset, for the flight-model sync; how far the core's arrival stamp trails the sim's read for a page's message; and which clock a page measures a span on ([01-spine](01-spine.md#left-open)).

## Messages are defined in one Rust crate: JSON typed by ts-rs for TypeScript, fixed-width structs in data slots, and length-prefixed binary to the helper

Numbered as [decision 025](../../decisions/025-messages-in-one-rust-crate.md) on 2026-10-13.

- **Decided:** over a WebSocket, into a plugin, and both ways between the desktop app's Rust side and its pages, as a string each side parses, a message is JSON that serde_json writes, and the TypeScript sides take their types from ts-rs, generated from the crate that defines the messages, with ts-rs's large-integer setting at `number`, which types `i64`, `u64`, `i128`, and `u128` alike, so an integer field that can pass 2^53 crosses as text, as the IDs do.
  In a data slot, a message is a struct of fixed-width fields, with its size and field offsets asserted in the crate, which builds for x86_64 and wasm32.
  Over the helper's standard input and output, a message is binary and prefixed with its length.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - ts-rs's types, with its large-integer setting at `number`, took every message serde_json wrote, the plugin that answered them type-checked, and each of five wrong messages was refused; specta did the same only with two opt-ins, `PhasesFormat` and a `specta_typescript::Number` mark on each 64-bit field, and only as a release candidate; and typeshare refused a `u64` until each was marked `serialized_as = "U53"`, then refused an internally tagged enum, which we found no opt-in for (measured on our development machine, 2026-10-09, [architecture log](log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32)).
  - A format written twice drifts: fsc-editor writes its module's wire format in TypeScript and in C++, and "nothing but `src/main/sim/link.test.ts` notices when the two" drift (read in fsc-editor, `link/README.md`).
  - Coherent GT parses JSON with no library of ours, at no frame time we could measure in the PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [01-spine](01-spine.md#the-sims-pages)).
  - The desktop app's Rust side and its pages trade serde_json's text as a string, which each side parses, so each reads the same text p07 checked ts-rs's types against, whatever Tauri does with a value it serializes itself ([01-spine](01-spine.md#messages-and-their-types)).
  - The data slots' structs kept one layout on x86_64 and wasm32, while a struct with a pointer-sized field didn't (measured on our development machine, 2026-10-09, [architecture log](log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32)).
- **Leaves out:** the encoding between cores, for the node on how the cores reach each other; whether the desktop app's pages and its Rust side trade the messages' text through Tauri's commands or its events, and whether tauri-specta types the command calls; and the choices inside the crate's build ([01-spine](01-spine.md#left-open)).

## Every first message carries one version number and a hash of the message crate

Numbered as [decision 026](../../decisions/026-first-message-carries-version-and-hash.md) on 2026-10-13.

- **Decided:** the watcher, the core, the helper, the desktop app, and the Community package, with the WASM module in it, carry one version number, which the build writes into each from one place.
  Each first message, the module's version slot, and each pilot's join carry that version and a hash of the message crate, both as text.
  A core refuses a join whose version or hash differs from its own, and on one machine the core logs a component whose version or hash differs from its own.
  Settled in node 1.4 by the user, 2026-10-09.
- **Because:**
  - Crosscheck's programs and its package update together, as one version, and pilots on different versions can't join each other ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
  - A version number nothing reads drifts: fsc-editor's package version sat at 0.0.1 while its module's reached 0.3.0, until its build derived one from the other ([05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
  - Two development builds can carry one version number with different messages, and the hash tells them apart, as FS Copilot's check of a hash of each packet type refuses a peer whose types differ ([09-05](../../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
- **Leaves out:**
  - pilots on different versions flying together, which v1 doesn't offer ([installing and updating](../product/03-v1-scope.md#installing-and-updating)) and which would need a version both sides speak rather than equal ones
  - how the build hashes the message crate, which has to cover each message's encoding as well as its fields ([01-spine](01-spine.md#left-open))
  - what the core does with a component on its own machine whose version or hash differs from its own, beyond logging it, for the part that designs the core ([01-spine](01-spine.md#left-open))

## The core runs on tokio

Numbered as [decision 027](../../decisions/027-core-runs-on-tokio.md) on 2026-10-13.

- **Decided:** the core's Rust code runs its sockets, timers, and other waiting work on tokio, the async runtime.
  Its WebSocket library is a choice inside the core, which accepts a connection only with the `Origin` it allows ([above](#the-core-accepts-a-websocket-only-with-the-sims-origin-or-none)) and can listen beyond the PC, off by default ([01-spine](01-spine.md#left-open)).
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - The core holds many connections at once, about 20 cockpit panels' sockets on top of the desktop app's, the network, and its uploads ([01-spine](01-spine.md#communication)), and an async runtime runs them on a few threads where blocking code would hold one thread for each.
  - Tauri, the desktop app's framework, runs on tokio: "Tauri uses tokio Runtime to initialize code" (documented, [tauri::async_runtime](https://docs.rs/tauri/latest/tauri/async_runtime/index.html), tauri 2.12.2, as of 2026-10-09).
  - The desktop app's Rust side reached a WebSocket server through tokio-tungstenite 0.30.0, which runs on tokio (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-a-tauri-2-window-takes-723-mb-of-memory-over-seven-processes-against-electrons-665-mb-over-four-its-program-is-80-mb-against-3474-mb-and-its-rust-sides-websocket-sends-no-origin)).
- **Leaves out:** the core's WebSocket library, for the core's stage of step 8 ([01-spine](01-spine.md#left-open)).

## The desktop app's pages are React, built with Vite and styled with Tailwind

Numbered as [decision 028](../../decisions/028-desktop-pages-react-vite-tailwind.md) on 2026-10-13.

- **Decided:** the desktop app's pages are TypeScript and React, built with Vite and styled with Tailwind.
  They share no interface with the EFB app, only TypeScript logic and the types ts-rs generates from the message crate.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - fsc-editor, our last desktop app, is built that way, on React 19, Vite 7, and Tailwind 4 (read in fsc-editor, `package.json`).
  - Tauri "is frontend agnostic and supports most frontend frameworks out of the box", and recommends Vite for React (documented, [Tauri's frontend configuration](https://v2.tauri.app/start/frontend/), as of 2026-10-09).
  - The EFB app is its own app on the sim's EFB framework, not the desktop app reused ([03-v1-scope](../product/03-v1-scope.md#efb-app)), so its interface is built from that framework's FSComponent components, which are class-based and don't re-render on new props ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)), and the desktop app's choice of framework doesn't reach it.
- **Leaves out:** nothing; the shared logic's compiling is settled [below](#our-code-in-the-sim-is-type-checked-against-es2017-and-bundled-by-esbuild-at-es2017).

## Our interface in the sim is built on the MSFS Avionics Framework

Numbered as [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) on 2026-10-13.

- **Decided:** the EFB app and the banner panel draw their interface with the MSFS Avionics Framework's FSComponent, in TypeScript, and the EFB app registers with the sim's EFB through Asobo's EFB API.
  The banner panel bundles our own copy of `@microsoft/msfs-sdk`, pinned to one exact version, not the copy the sim provides.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - The framework is Microsoft's, Asobo's, and Working Title's library for glass cockpits in Coherent GT, and the SDK says many of MSFS 2024's own aircraft use it (documented, [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
  - Shipping EFB apps are built on it: A2A's tablet is TSX on Asobo's EFB API and the framework (read in a2a-aircraft-aerostar600 1.0.6, `A2ATabletApp.js`; [03-v1-scope](../product/03-v1-scope.md#efb-app)), and our own probe apps registered through the EFB API and drew with the copy of the framework the sim provides, its global `msfssdk` (measured on MSFS 2024, 2026-10-06 and 2026-10-09, [interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
  - Its components don't re-render on new props, and state reaches the page through values that update it directly ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)), which suits an interface showing state the core streams to it.
  - One way of drawing serves both of our pages in the sim, while the desktop app's pages stay React ([above](#the-desktop-apps-pages-are-react-built-with-vite-and-styled-with-tailwind); user, 2026-10-09).
  - The framework's authors pin and ship their own copy: Working Title's G1000 pins `@microsoft/msfs-sdk` 2.4.3 and copies it into its own folder, while the copy the sim provides can change with a sim update, and the framework's license is MIT, for use only in Microsoft Flight Simulator ([architecture log](log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework); user, 2026-10-09).
- **Leaves out:**
  - whether the EFB app can bundle our pinned copy too, since no run has registered an EFB app drawn with a second copy of the framework, which p08's EFB app rebuilt against a bundled copy settles ([01-spine](01-spine.md#left-open))
  - which version we pin, since 2.4.3 isn't on npm and 2.3.3 is its newest there as of 2026-10-09, and how the framework's versions track sim updates, which no document states, for the apps' stage ([01-spine](01-spine.md#left-open))

## Our code in the sim is type-checked against ES2017 and bundled by esbuild at es2017

Numbered as [decision 030](../../decisions/030-in-sim-code-es2017-esbuild.md) on 2026-10-13.

- **Decided:** TypeScript checks the types of our code in the sim with its `lib` set to `DOM`, `DOM.Iterable`, `ES2017`, and `ES2021.WeakRef`, and esbuild bundles each page's code, our pinned framework included, at `es2017`.
  The EFB app and the desktop app's pages share TypeScript logic and ts-rs's types, compiled this way for the EFB app.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - Coherent GT parses all of ES2017 and object rest, and no other syntax from ES2018 on, and has every ES2015 to ES2017 built-in we tried and `WeakRef`, and no other from ES2018 on of its own (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild)).
  - A module using `?.`, `??`, `??=`, class and `#private` fields, object spread and rest, and a numeric separator, bundled by esbuild 0.28.2 at `es2017`, ran in the EFB's document and a cockpit panel and passed each of its checks, as it did compiled by TypeScript 7.0.2 (same entry).
  - The framework compiles to `es2017` with the same `lib`, and FlyByWire and every other project we read compile to `es2017` or near it (read, [architecture log](log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework)).
  - esbuild applies its target to every file it bundles, packages included, while the framework's own pipeline compiles only its own files with TypeScript and has Rollup bundle them with no second compile (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/sdk`), so an npm package that pipeline bundled would reach Coherent GT as its author wrote it.
  - esbuild refused FlyByWire's `safari11` target for an object rest in a parameter ([architecture log](log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild)), so `es2017` is the target both compilers take.
- **Leaves out:** whether the framework's `for`-`of` rewrite, which esbuild can't run, pays for itself in our interface ([01-spine](01-spine.md#left-open)).

## A tool of our own checks every file we ship into the sim against Coherent GT's measured limits

Numbered as [decision 031](../../decisions/031-coherent-gt-check-tool.md) on 2026-10-13.

- **Decided:** every JavaScript file we ship into the sim, experiments' files included, passes a check run after every edit and in CI.
  The check parses each file at ECMAScript 2017, with the pattern of each regex literal and of each `new RegExp(...)` given a fixed string, and fails any use of a built-in or web API [Coherent GT's JavaScript](coherent-gt.md) lists as missing or filled in only in some documents.
  It's a tool of its own, holding that list as one data file, built for our needs in a repository of its own under Crosscheck's GitHub organization, and published as it is, for anyone to use, without support.
  Settled in node 1.6 by the user, 2026-10-09.
- **Because:**
  - Step 7 asks for a check that every file run in Coherent GT, experiments included, parses within the engine's measured limits, run in CI and after edits ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), and nobody maintains a rule set for the engine we could use instead ([architecture log](log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework)).
  - A syntax error takes out the whole file, and `node --check` passes the syntax the engine rejects, such as `?.` ([06-01](../../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)).
  - Neither TypeScript 7.0.2 nor esbuild 0.28.2 makes the regex features from ES2018 on work: TypeScript leaves them as written and flags some, and esbuild hides each in a `new RegExp(...)` call that a check of its output can't see (measured on our development machine, 2026-10-09, [architecture log](log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild)).
  - TypeScript's DOM types declare web APIs the engine lacks, such as `ResizeObserver`, ES5's lib declares `Intl`, which the engine lacks too, and the sim's own scripts fill in some built-ins in some documents only (same entry).
  - Other MSFS projects have no such check either, and the user wants ours usable by them without our supporting it (user, 2026-10-09).
- **Leaves out:** a regex built from a pattern computed at run time, which a parse can't see; and how the tool is built, for the build's stage of step 8 ([01-spine](01-spine.md#left-open)).

## Every pair of cores holds one QUIC connection through iroh 1.3, directly or through our relays

Numbered as [decision 032](../../decisions/032-one-quic-connection-through-iroh.md) on 2026-10-13.

- **Decided:** each core runs one iroh 1.3 endpoint, under a key drawn fresh for each session and kept in the session file, and holds one QUIC connection to every other core in the session.
  iroh makes the connection directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't, and moves it between the two.
  Each link is up, lost after 5s with nothing on its connection, when its core closes the connection and redials, or disconnected after 30 minutes without one; any packet counts as hearing from a member, and a heartbeat goes once a second.
  A joining core dials every member, and after a lost link both cores redial; when two connections between a pair pass their first message, a higher restart count closes the older restart's connection, and of two from one restart the one the lower endpoint ID dialed stays, or of two one side dialed, the newer.
  A core keys what it keeps about a sender by the sender's pilot ID and restart count, never by a connection; v1 forwards nothing, and a later feature that forwards carries each message's sender with it.
  QUIC's TLS 1.3 encryption stays on, and Crosscheck builds nothing for encryption.
  This answers how the cores reach each other, which the spine leaves to node 2 ([01-spine](01-spine.md#between-machines)), and how a core learns another went quiet ([01-spine](01-spine.md#how-the-core-knows-a-component-is-alive)), and picks [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)'s link between every pair.
  Settled in node 2 by the user, 2026-10-11 ([01-between-machines](../network/01-between-machines.md)).
- **Because:**
  - iroh finds paths, opens router ports, and relays with no glue of ours, where ICE through `is` with TURN and quinn needs about 2,500 to 4,000 lines by an agent's estimate ([network log, 2.1][n21]).
  - From each of two friends' home networks to ours, 10 of 10 connections went direct, and iroh's relay and its move to the relay met the user's pass lines ([network log, 2.3][n23]).
  - A fresh connection carried data 0.3s to 1.4s after a total outage ended, while one that lived through a 10s outage took 5s to 7s ([network log, p07][p07]).
  - A rule that each side applies from what it holds itself picks the same connection however two dials race; one in which each side listed the connections it still held let each close the other's, because both sent their first message before seeing the other's dial.
  - Endpoint IDs are the one thing both sides of a pair always agree on; a rule by who is PF would break after a takeover during a cut, when each side counts itself PF, keeps the other's dial, closes the one the other kept, and redials again.
    The relay such a rule would choose, the dialed endpoint's home relay ([network log, p05][p05]), helps only when the PF's own link loses packets ([network log, 2.3][n23]).
  - Two endpoints in two processes on one PC each drew their own endpoint ID and ports and connected directly in 2.2ms ([network log, p04][p04]).
  - In our FS Copilot work, two connections between one pair carried every packet twice, and a duplicate arriving at the same instant made the traffic receiver's aircraft stutter (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", item 5).
  - A key that outlives a session would let the backend and the relays link every session one pilot joins (user, 2026-10-11).
- **Leaves out:** Wi-Fi, carrier-grade NAT, double NAT, mobile links, and two friends' routers paired with each other, which no run has covered and v1's recordings count ([01-between-machines](../network/01-between-machines.md#the-way-through-home-routers)).

## Our relays run iroh-relay unmodified, in at least two regions, and admit only Crosscheck

Numbered as [decision 033](../../decisions/033-relays-run-iroh-relay-unmodified.md) on 2026-10-13.

- **Decided:** a relay runs n0's `iroh-relay`, in Rust, with nothing of ours on it, in at least two regions.
  It admits only clients that present one of its shared tokens, and caps each client's rate.
  Each release carries the default relay list, each entry with its URL, token, and cap, and a setting overrides the list; a token changes only with a release, and a relay lists the old token and the new one until the old release is out of use.
  A change of tokens or an upgrade restarts a relay, which drops the relayed connections through it, so relays restart at a quiet hour.
  A session uses its host's relay list: a joining core builds its endpoint from iroh's `presets::Minimal` with `RelayMode::Custom` and exactly that list.
  Each pilot homes at the relay with the lowest latency, as iroh picks it.
  This settles the relay's language ([01-spine](01-spine.md#language-and-toolchains)), and changes [01-aims](../product/01-aims.md#relay-and-license)' one relay.
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - iroh's relay carries packets over TCP, and a lost packet held back the ones behind it longer the farther the sender was from the relay: at 3% loss, 53ms at p99 at 22ms away and 534ms at 131ms ([network log, 2.3][n23]), and every channel shares that lateness ([network log, p06][p06]).
  - `iroh-relay` admits everyone by default, and with shared tokens admits only a client that presents one of those its configuration lists, which can be two at once, and reads that list only when it starts (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig`).
  - Every member of a session runs one release, so tokens that ship with the release need no serving (user, 2026-10-11).
  - iroh presents a relay's token only to relays in its own list, so two pilots whose lists differed couldn't reach each other's home relays (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `start_active_relay`).
  - iroh's `presets::N0` publishes each pilot's endpoint ID and home relay to n0's DNS (read in iroh 1.3.0, `src/endpoint/presets.rs`).
  - iroh homes at the relay with the best latency over the last 5 minutes, and moves only for one under two-thirds of the current one's (read in iroh 1.3.0, `src/net_report.rs`, `add_report_history_and_set_preferred_relay`).
- **Leaves out:** who hosts the relays, our own servers or n0's managed relays, which changes nothing else ([01-between-machines](../network/01-between-machines.md#the-relays)).

## The backend matches invite codes to the crew's endpoint IDs, and no running session waits on it

Numbered as [decision 034](../../decisions/034-backend-matches-invite-codes.md) on 2026-10-13.

- **Decided:** the backend draws each invite code and keeps the session under it: its ID, the host's Crosscheck version and message crate hash, its relay list with each relay's token, and each member's pilot ID, display name, kind, crew in v1, and endpoint ID ([01-between-machines](../network/01-between-machines.md#joining)).
  A joining core looks up the code; the backend refuses a joiner whose version or message crate hash differs from the session's, naming who is behind, and otherwise answers with the session's ID, its relay list, and the crew, and lists the joiner only once the joiner registers itself, after its first message has passed with a member.
  A joining core dials each member by endpoint ID through every relay in the session's list, and iroh finds the direct path, so the backend and the session file keep endpoint IDs and no addresses.
  Each core renews its place every 10 minutes, the backend drops a member after 30 minutes without renewal, Leave session tells it at once, and it frees the code once the crew is empty.
  Each request a core makes about itself carries a signature by its endpoint key, requests and answers are JSON with the message crate's types and a version of the backend's own, and the backend counts only wrong codes against an address.
  A core accepts a connection whose first message carries its session's code, version, and hash, and a joiner counts as crew only once that first message has passed; a returning pilot dials the crew from the session file and asks the backend only if nobody answers.
  The relays speak only iroh's protocol.
  This changes the spine, which gave invite codes and introductions to the relay ([01-spine](01-spine.md#components)), and answers its question of whether the relay's and the backend's messages are the crate's ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - A stock relay keeps code of ours off the relays, so n0's releases or n0's managed relays drop in unchanged (user, 2026-10-11).
  - A backend that a running session never waits on can't end one by going down (user, 2026-10-11).
  - Until a connection has chosen a path, iroh sends its first packets to every address it knows, and an endpoint's address holds several relays at once (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `handle_msg_send_datagram`, and iroh-base 1.3.0, `src/endpoint_addr.rs`).
  - FS Copilot counted a handshake that later failed as a peer, and locked the pilot's panels for 5 minutes ([09-06](../../learn/foundations/09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
  - iroh's handshake checks the accepting core's key against the endpoint ID the dialer asked for and has the dialer sign with its own key (read in iroh 1.3.0, `src/tls/verifier.rs`).
- **Leaves out:** what the backend runs on, for which the spine's candidate is a Cloudflare Worker ([01-spine](01-spine.md#components)).

## Each channel declares how it travels, and only the cockpit stream is replayed

Numbered as [decision 035](../../decisions/035-channels-declare-how-they-travel.md) on 2026-10-13.

- **Decided:** the core keeps a registry of the session's channels, each declaring who sends and receives it, its delivery, its priority, and whether it joins the cockpit's shared order.
  v1's channels have fixed numbers in the message crate, each stream opens with a header naming its channel, a channel in the cockpit's shared order rides the cockpit stream tagged with its channel, and a plugin opens only instances of the kinds Crosscheck provides, announcing each on the session channel.
  The cockpit stream is the one replayed log; the session channel and traffic's identities carry the newest value of each key, all of them again on a new connection, and catch-up starts again there.
  A new connection's first message carries every session key, and a core applies nothing else from the connection until it has passed; a receiver merges traffic's identity set, and a copy with no sample for 15s is removed and its identity forgotten (changed in node 3, [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
  Every session key but control carries a stamp, the control value its writer held, a number one past the highest its writer has seen on that key, and the writer's pilot ID, and every receiver keeps the value with the highest stamp, comparing control values first, as control orders them, then the numbers, with the lower pilot ID winning a tie; a core that takes control writes every session-wide key again under the new value.
  Each member writes its own entry, its pilot ID, display name, kind, and endpoint ID, as a session key, and a core dials any member it learns of and holds no connection to.
  The flight model's samples, which also carry the yoke, rudder, and toe-brake positions the flying aircraft applied, the avatars, traffic's samples, ATC audio, and a heartbeat once a second ride one-off packets.
  The PF's engine levers and trim ride the cockpit stream, and the following machine writes the PF's last value back when the PM moves one.
  The core holds only the newest packet for each connection, channel, and key, and ATC frames in a short queue with a deadline, hands them to a QUIC queue of a few packets in a fixed order as it has room, keeps a traffic batch under 1,162 bytes, and paces what it sends through a relay below the cap the relay list gives.
  Every message between cores is postcard, and each channel but the cockpit's tells a copy from a late value by the rule [01-between-machines](../network/01-between-machines.md#channels) gives it.
  This answers the spine's questions of how the cores pack a message and how each channel other than the cockpit's tells a copy from a late message ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - postcard packed every v1 message smallest but one, with a stable wire format and serde's derives ([network log, 2.2][n22]).
  - A replayed stale pause or sim-rate change would undo the session's state, where each key's newest value can't.
  - QUIC keeps no order across streams, so state sent on its own stream could arrive after the replay it should precede.
  - Two pilots who change pause during a cut each hold a value the other's numbering can't order, so without a stamp each would take the other's and the two sims would swap.
  - An ex-PF that sets the sim rate alone during a cut stamps it higher than the value the new PF holds and never changed, so without the rewrite the ex-PF's rate would win on return.
  - An object the sim removes during a cut never sends its removal, so its copy gets no more samples, and the 15s rule removes it.
  - The yoke and rudder move nearly every frame while the PF hand-flies, which would flood the cockpit stream and its replay (user, 2026-10-11), and in the flight model's samples they cost no packets of their own.
  - noq queues one-off packets in order and drops the oldest, of any channel, only to make room for a new one (read in noq-proto 1.3.0, `src/connection/datagrams.rs`); on iroh's relay that never happened, and nothing a sender did changed when its channels arrived ([network log, p06][p06]).
  - QUIC keeps no order across streams, so a channel in the cockpit's shared order can only keep it on the cockpit's own stream, and a stream that waited on an announcement on another stream could arrive first.
  - A relayed packet crosses links that discover their packet size separately, so FS Copilot budgeted to the smallest (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The MTU floor").
- **Leaves out:** how the cockpit channel tells a copy from a late message, for node 3; which fields each message carries, for node 3 and the flight-model sync ([network log, 2.2][n22]); and how one-off packets behave on a direct path under loss, which the network's stage of step 8 checks ([01-between-machines](../network/01-between-machines.md#left-open)).

## Control is one value, a generation and the PF's pilot ID

Numbered as [decision 036](../../decisions/036-control-is-one-value.md) on 2026-10-13.

- **Decided:** every change of PF, by the take-control key, by voice, by a PF leaving the flight, or by a takeover while a link is lost, raises the generation one past the highest its maker has seen, and of two changes with the same generation, the one naming the lower pilot ID wins.
  The value rides the session channel as one key, in a new connection's first message, and every cockpit message and flight-model sample carries the whole value it was made under.
  A receiver drops a sample made under an older value than the newest it knows, and of cockpit messages only those a superseded value's PF made under it that the change of control's vector clock doesn't include, live or in a replay (changed in node 3, [04-order-and-recovery](../sync/04-order-and-recovery.md#a-change-of-control)); a dropped message counts as delivered for the cockpit's causal order.
  A receiver that meets a newer value on any message or sample adopts it.
  A PF who leaves the flight or the session, or quits, passes control as an ordinary handover to a pilot still in the flight, in v1 the PM, and leaves only once that pilot's messages carry the new value or 1s has passed; a PF whose sim closes, by a crash or otherwise, has left the flight, and its core, which stays up, passes control the same way (user, 2026-10-11, in node 3; [04-order-and-recovery](../sync/04-order-and-recovery.md#a-sim-that-closed)); and if no pilot is in the flight once preflight has ended, the session ends ([below](#v1s-table-of-roles-holds-the-pf-and-the-traffic-and-atc-host-whom-a-pilot-chooses-by-hand)).
  This replaces [the take-control key](../product/03-v1-scope.md#take-control-key)'s rule that the earlier press wins, however small the gap.
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - Two machines that compare the moments of two presses, each through its own estimate of the other's clock, can order them differently, and a generation and a pilot ID compare the same on both; two presses within one round trip are settled by pilot ID, which no pilot can notice (user, 2026-10-11).
  - A replay of an ex-PF's solo flying into the new PF's cockpit would repeat FS Copilot's replay of solo input into a fresh session (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R04).
  - A switch the PF flipped in the round trip before it learned of a takeover is in its own cockpit and nobody else's, so the ex-PF catches up state from the new PF, which undoes it in its cockpit too.
  - Two pilots who take control from the same generation make values that differ only in the PF, so a message tagged with the generation alone couldn't tell the loser's from the winner's.
  - A sim that closed has lost its pages, FMS, and avionics state, which nothing restores, so the machine whose cockpit is intact flies on (user, 2026-10-11).
  - noq lets a peer drop stream data it hasn't delivered once a close arrives (read in noq 1.3.0, `src/connection.rs`, `Connection::close`), so a handover sent just before a Leave's close could be lost; FS Copilot's master leaving on purpose locked the other pilot, and making that pilot master was deferred (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R02).
- **Leaves out:** who may change control and when, which the table of roles sets ([roles and members](../session/01-roles-and-members.md#the-pf)).

## While a link is lost, the PF flies on, a PM that lost the flying machine locks, and any pilot can take control

Numbered as [decision 037](../../decisions/037-while-a-link-is-lost.md) on 2026-10-13.

- **Decided:** iroh's path idle timeout is 2s and its path keep-alive 0.67s, and the core sends no copies over a second path.
  Through a short gap, the following machine carries the aircraft on its last velocities and eases it to the true position when samples come again.
  While a link is lost, the PF flies on, a PM that lost the flying machine locks its synced displays, every pilot's banner lists each crew member's link and whether this PC reaches the internet, and any pilot whose role may hold control can take it, a PM with a warning that names what follows; no core decides who lost the connection.
  A new connection's first message carries the session's state whole, control among it, and then each side sends the cockpit stream's replay: each core keeps every sender's cockpit messages it applied until every member has acknowledged them on the heartbeat, for up to 30 minutes, and sends the other what it lacks.
  Within 30 minutes a returning pilot whose sim and core kept running gets a replay, which its 2s cap on each gap bounds at 2s a change ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-replay)); at 30 minutes without a connection to any member, a core leaves the session, PF or PM.
  A core that starts with a session file asks the crew whether its pilot is still in, since a crew member timed the silence.
  Leave session's goodbye is QUIC's close, with an application code that only Leave sends, and closing Crosscheck any other way sends a quit code that the others treat as a Leave.
  This changes [the take-control key](../product/03-v1-scope.md#take-control-key)'s rule that control passes to the PM when the PF's connection drops, and [the connection](../product/03-v1-scope.md#the-connection)'s 5-minute cut-off, and answers which ways to soften a short gap v1 builds ([the connection](../product/03-v1-scope.md#the-connection)) and what a core does with a session file found after a long outage ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-10 and 2026-10-11.
- **Because:**
  - iroh moved to the relay 2.0s after a firewall cut the direct path, every time, and samples came again through the relay at once; no move happened that a cut didn't cause ([network log, 2.3][n23]).
  - Telling which pilot lost the connection takes a third party both cores trust, and a pilot who sees the crew's links, warned of what a takeover does, decides as well (user, 2026-10-11).
  - A replay brings back what a profile can't read, such as a display's page or an FMS, so after a long outage a few minutes of replay beat a quick catch-up of state, and a flight cut off for 30 minutes has usually ended (user, 2026-10-11).
  - noq lets a peer drop stream data it hasn't delivered once a close arrives, and closes a connection with code 0 when every handle to it is dropped (read in noq 1.3.0, `src/connection.rs`).
  - One friend's router forgot an idle port within 30s ([network log, 2.3][n23]).
  - iroh sends on one path at a time ([network log, 2.1][n21]).
- **Leaves out:** tuning the 5s, the 2s, and the 30 minutes from v1's recordings; how far the following machine carries the aircraft, how it eases, and the marker for a sim stopped on purpose, for the flight-model sync; and how an ex-PF's cockpit comes to the new PF's state, which [04-order-and-recovery](../sync/04-order-and-recovery.md#a-change-of-control) settles.

## A receiver estimates each sender's clock offset from one timed exchange a second

Numbered as [decision 038](../../decisions/038-clock-offset-from-timed-exchange.md) on 2026-10-13.

- **Decided:** each core's heartbeat carries one clock exchange a second with each other core; it takes the offset as NTP does, ½[(T2 − T1) + (T3 − T4)], from the exchange with the shortest round trip of the last 8, and starts afresh when the sender's restart count rises.
  The recording keeps each sender's offset estimate and restart count once a second.
  This answers the spine's questions of how a receiver estimates a sender's offset, what a higher restart count does to it, and how far two PCs' counters part ([01-spine](01-spine.md#left-open)).
  Settled in node 2 by the user, 2026-10-11.
- **Because:**
  - 2.3 estimated each PC's counter against our droplets through the shortest of each eight exchanges, and the estimates scattered by 95µs to 249µs ([network log, 2.3][n23]).
  - The three PCs' counters ran from 13.4 ppm slow to 25.8 ppm fast, so two parted by up to 39 ppm, 3.4s a day (same entry), and an estimate 8s old is off by 0.3ms at that rate (arithmetic).
- **Leaves out:** the error when a connection's two directions take unequal times, which is half the difference; and easing the offset the following machine applies when it steps, for the flight-model sync ([01-between-machines](../network/01-between-machines.md#clock-offsets)).

## A cut link comes back by replay, and a sim, core, or PC that went down comes back as a late joiner

Numbered as [decision 039](../../decisions/039-cut-link-replays-others-late-join.md) on 2026-10-13.

- **Decided:** after a cut link, with the sim and the core still running, a pilot gets a replay of every missed change in causal order, each after the gap the PF left, capped at 2s, except that of each run of changes to a PF-owned entry with only PF-owned changes between them, it applies only the last, in its place.
  That pacing holds for every cockpit message, live or replayed: each waits the gap its sender left before it, capped at 2s, counted from when the one before it applied, so it waits only what's left, and the core alone paces, with our panel bridge playing each press when the core hands it over.
  A pilot whose sim run ends, which their core sees as the sim closes or finds at start after a PC crash, has left the flight: if they were the PF, control passes on, at once or once the crew's first message has passed, to a pilot still in the flight, and the pilot comes back as a late joiner under the same pilot ID, with a catch-up of state and a notice that pages, FMS, and avionics state may differ.
  Each change of control carries its maker's vector clock, a receiver drops the superseded PF's messages made under the value it lost only where that clock doesn't include them, live or in a replay, and every machine that applied one catches up state from the new PF.
  Control can't pass to a pilot while their own replay or catch-up runs over a link that's up, by key, button, or voice; when the PF leaves, it passes anyway, to a pilot still in the flight, an up-to-date one where there is one.
  This changes node 2's rules that a sim crash passes nothing and that control drops the superseded PF's messages that reach a receiver in a replay, and settles how a replay is paced and how an ex-PF and a crashed PF come back ([architecture plan](plan.md#3-sync-and-the-session)).
  Settled in node 3 by the user, 2026-10-11, and the pacing of every message by the user, 2026-10-12 ([04-order-and-recovery](../sync/04-order-and-recovery.md#what-comes-back-after-what)).
- **Because:**
  - A sim that closed has lost its pages, FMS, and avionics state, such as a GTN 750's flight plan, which no profile entry reads and replayed presses needn't rebuild (user, 2026-10-11).
  - A replay's 2s cap bounds it at 2s a change (arithmetic), and a PF working the throttle changes it every time the lever moves, while a following machine only shows it (user, 2026-10-11); keeping the last change of each run in its place keeps each lever where it was before the next event, such as a starter press.
  - A PF's own handover comes after every message it made, so its clock includes them all, while a takeover during a cut doesn't include the solo flying it supersedes; dropping by the replay instead would drop a leaving PF's last changes from a PM still replaying.
  - A pilot who took control partway through a replay would fly a cockpit that dates from before the cut, and one who took it during catch-up a cockpit whose own changes were never sent.
  - FS Copilot's panels paced presses the same way, "Each waits its *remaining* gap, not the full one, so live gestures add no latency" (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, 0.4), and a panel that paced too would wait each gap a second time.
- **Leaves out:** tuning the 2s cap from v1's recordings, and which up-to-date pilot receives control in a crew of more than two.

## Catch-up writes in the order the flying machine's cockpit first took each value

Numbered as [decision 040](../../decisions/040-catch-up-first-final-value-order.md) on 2026-10-13.

- **Decided:** catch-up writes each entry at the flying machine's value, in the order the flying machine's cockpit first took each of those values, read from its recording, with entries it took before the session or never changed first.
  It carries the flying machine's vector clock, which the catching-up machine takes for every counter but its own, which never goes back, so every message the state already holds drops as a copy, and it starts again from a new flying machine, skipping what already matches, if control passes between other pilots.
  v1's catch-up pipeline has one step, catching up state; the simulation rate and pause reach a late joiner as session keys, the time and date aren't synced in v1, and traffic reaches them as the host's objects, which a receiver spawns whenever its sim is in a flight.
  A catch-up ends once it has made its last write and its aircraft has settled, whichever comes later, and the core reads an input event's value once when it starts watching it, so a catch-up can tell whether that entry matches.
  A session started after the aircraft loaded counts the settle rule's 30s floor from Ready to fly and its 15s quiet window from the profile's load.
  This settles [03-catch-up](../sync/03-catch-up.md#choosing-the-order)'s order and the spine's question of settling in such a session ([01-spine](01-spine.md#left-open)).
  Settled in node 3 by the user, 2026-10-11, and when a catch-up ends and the first read of an input event by the user, 2026-10-12 ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).
- **Because:**
  - Where an interlock makes order matter, this order writes the battery before the hypothetical APU master, and where order doesn't matter it costs nothing, so no probe of interlocks could change the choice ([03-catch-up](../sync/03-catch-up.md#choosing-the-order)).
  - The recording keeps every change of the session ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
  - The catching-up pilot's changes aren't sent while catch-up runs ([03-catch-up](../sync/03-catch-up.md#while-catch-up-runs)), so a cockpit taken over halfway would differ from the others' with nothing sent to bring them together.
  - An aircraft that settled long ago, at the end of preflight, for an ex-PF, or after a core restart, would end a catch-up timed by settling alone the moment it began.
  - Subscribing to an input event reports nothing until its value changes (fsc-editor, `docs/sim-vars/build/v1-log.md`), and our Rust client read one in a flight (measured on MSFS 2024, 2026-10-09, [architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
- **Leaves out:** later steps of the pipeline, which the picks that need them add ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)).

## A core that crashes comes back as a late joiner

Numbered as [decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md) on 2026-10-13.

- **Decided:** a core that crashes while its sim keeps running comes back as a sim that closed does: the watcher restarts it, it counts its pilot as having left the flight, passes control on if they held it, and rejoins its pilot as a late joiner, and the crew's notice asks for a bug report.
  Because the aircraft didn't reload, each shadow value starts at the flying machine's, and the aircraft counts as settled at once.
  The recording's minimal mode keeps the cockpit stream, from which catch-up takes its order.
  This answers the spine's question of how a restarted core recovers, and what it keeps beyond the session file ([01-spine](01-spine.md#left-open)).
  Settled in node 3 by the user, 2026-10-11, and changed to a late join by the user, 2026-10-12 ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-core-that-restarts)).
- **Because:**
  - Crosscheck aims for a core that never crashes, so a crash is a bug to report and fix rather than a state to recover from, and a late join reuses the path a sim crash already takes, where recovering in place needed a journal written before every send, a rebuild of four structures, a comparison with the sim, and a wait for the panels (user, 2026-10-12).
  - A restarted core's aircraft kept the controls it had, which matched the flying machine's, so the flying machine's shadow values are the nearest to its own.
- **Leaves out:** a shadow value's turns its pilot made while the core was down; and the presses either pilot made in that window, which are lost.

## A machine's vector clock is its record of what it applied, and a skipped message counts as applied

Numbered as [decision 042](../../decisions/042-vector-clock-records-what-applied.md) on 2026-10-13.

- **Decided:** a receiver's vector clock is its one record of what it applied: a message the clock already covers is a copy and drops, the sender's own counter is a message's number, and the heartbeat acknowledges by carrying the clock.
  A message counts as applied once its write is made, its event fired, or its press played by the display's panel through to its release.
  A machine sends each state entry's newest value at most 20 times a second, a starting value, and any value it's holding goes out before its next event or press, which go out as they happen.
  A receiver skips the messages a change of control drops, presses during its own catch-up or for a display whose panel hasn't announced itself, changes to an entry the aircraft drives itself, and in a replay all but the last of a run of PF-owned changes, each counting as applied, and a machine with no aircraft in a flight, or with an aircraft other than the flying machine's, holds the stream and sends nothing on it until its catch-up.
  A message names its entry by name and its clock's counters by pilot ID and restart count, and of two changes from one pilot under two restart counts that neither saw, the higher count wins.
  This answers the spine's questions of how the cockpit channel tells a copy from a late message, how a clock names its counters, and how two changes from one pilot under two restart counts are ordered ([01-spine](01-spine.md#left-open)).
  Settled in node 3 by the user, 2026-10-11, and the cap and a press played through by the user, 2026-10-12 ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)).
- **Because:**
  - A hardware axis that jitters with no dead zone changes its lever every frame, up to 360 messages a second for the 58P's six engine levers at 60 fps, against node 2's assumed 5 to 20 (arithmetic), and FS Copilot sampled every entry that wasn't shared every 30ms (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, `AddLink`).
  - FS Copilot's panel plays a press for as long as the pilot held it, up to 1.5s (read in the FS Copilot fork, `pointer.js`, `hold`), so a press counted at the hand-over could let the next event land before its click.
  - FS Copilot's acknowledgment meant "received by the app", not "applied by the panel" (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, the constructor's comment), and its restarted app dropped a press with "No panel for DisplayUnits|config=N324DU; event dropped" (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone").
  - One value for the copy check, the acknowledgment, and what catch-up hands over means a catch-up's clock covers every message its state holds, where a separate count of applied messages let a late joiner's queued messages apply again on top of its catch-up.
  - Names in full cost 84 bytes for a sample cockpit change against 27 for an index and member-list places ([network log, 2.2][n22]), 285 bytes to 1.1 KB a second more at node 2's assumed rates (arithmetic), for one encoding that depends on nothing the receiver publishes.
- **Leaves out:** the exact fields of a cockpit message, which sync's stage of step 8 lays out in the message crate.

## A shared entry every machine's aircraft keeps changing stops syncing, and a machine puts back what it may not send

Numbered as [decision 043](../../decisions/043-driven-entries-and-putting-back.md) on 2026-10-13.

- **Decided:** a machine counts a shared state entry, or an event entry, as driven by the aircraft when, in every 3s for 30s, its own aircraft changed or fired it, other than by Crosscheck's write, and another machine's change or firing arrived, a replayed one included; it then stops sending and applying that entry for the rest of the load, marks the recording, and shows the once-a-flight notice of a write that never lands.
  When a machine's sim reports a change Crosscheck didn't write that the machine may not send, it writes back the value it holds: a PF-owned entry on a following machine, any entry during its own catch-up, and the simulation rate on any machine but the flying one.
  Settled in node 3 by the user, 2026-10-11, and the test's reach to event entries by the user, 2026-10-13 ([04-order-and-recovery](../sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself)).
- **Because:**
  - An entry for something that ticks, which a profile's author added by mistake, would send a change or a firing at every tick and fill every replay, whatever the IDE warned (user, 2026-10-11), and 21 of the A220's input events reported four times a second on an untouched aircraft (measured on MSFS 2024, 2026-09-04, fsc-editor, as the [A220 study](../aircraft/synaptic-a220/study.md) cites).
  - A pilot changes an entry on one machine, and the others' aircraft only take the writes, so no pilot produces the sign; a PF-owned entry is left out, since following machines put it back, and a PM's hand resting on a throttle would otherwise trip the test.
  - Catch-up already moved a catching-up pilot's changes back, and v1's scope already put back another pilot's change to the simulation rate ([time, date, sim rate, and pause](../product/03-v1-scope.md#time-date-sim-rate-and-pause)), so one rule replaces three.
  - FS Copilot wrote no PF-owned value back, so a PM's throttle could spool up their own engine until the PF next moved theirs ([take-control key](../product/03-v1-scope.md#take-control-key)), and the pitch axis fired no event inside a dead zone set in MSFS, while the throttle, propeller, and mixture axes are unmeasured ([flight-controls log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)).
- **Leaves out:** tuning the 3s and the 30s from v1's recordings.

## v1's table of roles holds the PF and the traffic and ATC host, whom a pilot chooses by hand

Numbered as [decision 044](../../decisions/044-table-of-roles.md) on 2026-10-13.

- **Decided:** each member writes its own entry on the session channel, crew in v1 and passenger later; crew members hold vector clock counters and acknowledge on the heartbeat, and a passenger, on a one-way feed off the crew's links, holds nothing up.
  The table of roles gives each role who may hold it, how it moves, and what happens when its holder loses the link, leaves the flight, or leaves the session.
  Any crew member may hold control, which moves by the take-control key or button, or by voice, to any pilot but one whose own catch-up or replay runs over a link that's up, or, when the PF leaves the flight or the session or their sim run ends, to a pilot still in the flight, an up-to-date one where there is one, the PM in v1; a lost link changes nothing.
  The take-control input is live only while its pilot is in the flight, after preflight; once preflight has ended, a session with no pilot in the flight ends; and a session flies one aircraft, its PF's, with preflight only at its start.
  The traffic and ATC host is one role, which any pilot takes at any time by turning on "Share my traffic and ATC", turning the old host's switch off, two at once settled by the stamp, and which the host releases by turning theirs off; through a lost link, a flight left, or a crash it stays with its holder until they leave the session.
  Two rules remove a host's copies: when the session channel stops naming a pilot as host, every machine removes that host's copies, and a copy with no sample for 15s is removed and its identity forgotten, while the host sends each object's sample at least every 5s; a receiver keeps each sender's identities apart and shows the host's.
  This answers [traffic sync](../product/03-v1-scope.md#traffic-sync)'s question of how the host is chosen, and builds the table [04-room-for-later](../product/04-room-for-later.md#roles) asks v1 for.
  Settled in node 3 by the user, 2026-10-11; the take-control input, a session's end, and one aircraft a session by the user, 2026-10-12; and taking the host's role at any time by the user, 2026-10-13 ([roles and members](../session/01-roles-and-members.md)).
- **Because:**
  - FS Copilot's build had no taking over, "a toggle is disabled while someone else hosts that feature", removed a host's traffic once the host stopped, withdrew hosting while the host's sim was disconnected, and removed a copy after 15s without a sample (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`, "Decisions locked with the user (2026-09-06)", rows 2 and 4, and "Key invariants"); it dropped a disconnected host's claim after the 15s its networking took to call a peer gone, sent each object at least every 5s, and forgot an identity with its stale copy (read in the FS Copilot fork, `FsCopilot/Simulation/ShareSwitch.cs`, `OnPeers`, `FsCopilot/Network/RelayNetwork.cs`, `DisconnectTimeout`, `FsCopilot/Simulation/TrafficHost.cs`, `Heartbeat`, and `TrafficReceiver.cs`, line 413).
  - Taking the role automatically would need Crosscheck to tell which pilot runs a traffic injector, which is unknown ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
  - Pilots who all want the best for the session settle a tussle over the switch on voice, so a role anyone can take needs no rule that frees it from a host who went quiet, and covers a host who doesn't come back (user, 2026-10-13).
  - Control that rests only with a pilot in the flight never lands on one with no aircraft, and a session with nobody in the flight has nothing left to sync, so starting a new one is the clean way back (user, 2026-10-12).
  - Keeping the role while its holder is quiet costs up to 15s of copies standing still, which the user accepted for the simpler design (user, 2026-10-11).
- **Leaves out:** which pilot receives control when the PF leaves a crew of more than two, and hosts of their own for traffic and ATC, for the picks that need them.

## A profile is YAML whose script is JavaScript, where names only name and only `write()` writes

Numbered as [decision 045](../../decisions/045-profile-format-yaml-and-javascript.md) on 2026-10-13.

- **Decided:** a profile is one YAML file, and its values that name or write something in the sim are JavaScript calling Crosscheck's globals: `L()`, `A()`, `B()`, `K()`, and `H()` name, with the names quoted, and `write()` is the one call that writes, a plugin's writes included; a run's plain `write()` calls go out together, in call order, and only a chain spaces them.
  Every entry's `write:` is required, and is a name, a map for `toggle` or `inc` and `dec`, a plugin's write method, a function `(value) => …` that reads the global `state` and returns nothing, or, on a state entry, `none` for a watch-only entry.
  A state entry whose value no variable shows counts events into a shadow value starting from `default`, and `wrap` and `range` appear only in a map that steps or counts, `wrap` required in each but a counted entry's stepping write, which takes the count's.
  An entry's direction is `owner`, `pilot_flying` or `shared` by default, and the PF's entries are the engine levers and trim, since the yoke, rudder, and toe brakes travel in the flight model's samples; an `aircraft:` header maps variant IDs to SimObjects folders, or to presets inside one, which entries and seats select with `only`; a profile imports modules by path, and a module carries no `only` or `location`; and profiles and modules live as flat files in one public repository.
  The core, CI, and the IDE run one checker, and a load fails on anything that breaks a rule.
  This gives [01-profile-entries](../sync/01-profile-entries.md) the syntax and file layout that step 7's exit names ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
  Settled in node 4 by the user, 2026-10-11 and 2026-10-12 ([01-format-and-delivery](../profiles/01-format-and-delivery.md)).
- **Because:**
  - YAML is easy for a simmer who doesn't code, and functions let the IDE guide and check a strict API (user, 2026-10-11).
  - Quoted names keep one real language, which QuickJS-ng runs and TypeScript checks as they are, where a grammar of our own would make every condition in a write function a feature to build (user, 2026-10-11).
  - Names that only name and one call that writes let the engine see every write, which it marks as its own, paces, orders, and checks ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
  - FS Copilot's format guessed a setter's kind from its characters and fell back silently, emptied a whole profile on one unknown key, and ran a repeated name as two subscriptions (fsc-editor, `docs/fscopilot-behavior.md` and `docs/sim-vars/18-language-core.md`).
  - A required `write`, with `none` for watch-only, turns a forgotten `write` into a load error rather than a silent watch-only entry, and a required `wrap` turns a forgotten one into a load error rather than a heading bug that crosses north by 359 steps the long way (user, 2026-10-12).
  - The first aircraft after the 58P with a control no variable shows would otherwise wait for a Crosscheck release before its profile could be written (user, 2026-10-12).
  - The Fenix's A319, A320, and A321 are presets of one folder, `FNX_32X`, and both pilots must fly the same preset (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md#identity)), while FS Copilot keeps only the folder from the path the sim reports (read in the FS Copilot fork, `FsCopilot/Connection/SimConnectConsumer.cs`, `PushAircraft`), so a folder alone can't tell those variants apart (the root's walk, 2026-10-12).
- **Leaves out:** whether the core tells which preset loaded from the path the sim reports or from `A:TITLE`, for the core's stage of step 8; settings on following machines, a request field, a plugin's changes to aircraft files, libraries that plugins share, reading client data, and locations for a module's entries, each until a profile or plugin needs it; and how the sync engine checks a write, tells its own echo from a pilot's change, retries, follows a moving knob, and runs write functions, which sync's stage of step 8 settles on a two-instance bench, starting from one attempt per write and one run of a function per value, with the cases [01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write) lists (user, 2026-10-12).

## Each aircraft's profile and plugin run in runtimes of their own, with 64 MB each, 100ms a call, and 4 KB a value

Numbered as [decision 046](../../decisions/046-sandbox-runtimes-and-limits.md) on 2026-10-13.

- **Decided:** each loaded aircraft gets two QuickJS-ng runtimes in the core, one for its profile's script and one for its plugin, each limited to 64 MB of memory and 100ms a call by the clock, and an entry's value is capped at 4 KB as sent, with no cap of its own on the state object.
  A write function at a limit fails that write and its entry is flagged; a plugin at a limit is turned off for the rest of the session, and every machine stops syncing its entries; and a value over 4 KB isn't sent and its entry is flagged.
  This sets the size limits of the sandbox that write functions run in, which step 7's exit names ([the product plan](../product/plan.md#7-tech-stack-and-architecture)).
  Settled in node 4 by the user, 2026-10-11 and 2026-10-12 ([01-format-and-delivery](../profiles/01-format-and-delivery.md#the-sandbox)).
- **Because:**
  - The limits are for bugs, a loop that never ends or an allocation that never stops, which would otherwise stop every write from a profile or run the PC short of memory, and not for bad actors, whom what a profile and a plugin can reach already stops (user, 2026-10-12).
  - QuickJS stopped a runaway allocation at a 64 MB limit in 88ms and an endless loop at a 100ms limit, with the host running on, and an idle runtime held 0.9 MB, while 100 write functions took 75µs a frame (measured on our development machine, 2026-10-08, [architecture log](log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)).
  - The time limit runs by the clock, and on a PC MSFS keeps busy a short call can wait behind other work, so a limit near a healthy call's time could turn off a healthy plugin for the session, while a stuck call is a bug that 100ms of held-up writes costs little (user, 2026-10-12).
  - A plugin turned off on one machine freezes its values there, so a later catch-up would write the frozen values into a crewmate's working plugin unless every machine stops syncing them (node 4's review, 2026-10-12).
  - A cockpit change naming its entry and two pilots in full took 84 bytes ([network log, 2.2][n22]), and the largest value we know of, the KNS-81's 10 waypoints, would be a few hundred bytes (an estimate).
  - A profile fixes its entries when it loads, so the cap on each value bounds the state object.
- **Leaves out:** what real profiles and plugins need, which the 58P's profile and plugin measure.

## Crosscheck's code is a platform, engines, and features, and deleting a feature's crate leaves the rest whole

- **Decided:** Crosscheck's code is in three tiers: the platform, the services every feature uses, in the core and, through the panel bridge and our WASM module, in the sim; engines, libraries that know nothing of the app; and features, each one thing a pilot gets.
  Three tests stand in for a definition of clean: deleting a feature, its crate, its one registration, its modules in the message crate and the profile engine, its routines in our WASM module and their line in the module's list, its panel modules, and its section in each app, leaves everything else building and passing its tests; an engine builds and runs outside the core; and CI checks each crate's dependencies against the ones the code map allows.
  A feature's messages stay in the one message crate, and its profile block in the profile engine, which is why deleting a feature deletes a module in each.
  Settled in node 5 by the user, 2026-10-14 ([02-code-map](02-code-map.md#tiers)).
- **Because:**
  - The user wants each system clean, "almost like you could take it out of the project", with confidence in it before any product code, and without a definition in prose that agents would enforce where it doesn't fit (user, 2026-10-14).
  - A hand-kept copy of a contract bred bugs in fsc-editor's Trace, which copied eight of FS Copilot's C# functions into TypeScript, and of the bugs in its first cut, "All three were found by re-reading, not by any check" (fsc-editor, `docs/help/trace-panel.md`, "The problem, stated honestly").
    fsc-editor's module keeps its wire format in TypeScript and in C++, and "nothing but `src/main/sim/link.test.ts` notices when the two" drift (read in fsc-editor, `link/README.md`).
    An engine that the core and the IDE both link leaves nothing to copy.
  - The core, CI, and the IDE already run one checker for profiles ([01-format-and-delivery](../profiles/01-format-and-delivery.md#what-fails-a-load)), and CI and the IDE check a profile without the core.
  - The tier is the platform, not the host, because "the host" already names the pilot who starts a session ([invite code](../product/03-v1-scope.md#invite-code)), as "the traffic host" and "the ATC host" name pilots ([traffic sync](../product/03-v1-scope.md#traffic-sync), [hearing ATC](../product/03-v1-scope.md#hearing-atc)), and because a newcomer opening the repository reads `platform/` as what the features are built on (user, 2026-10-15).
- **Leaves out:** the units themselves, which [the units](02-code-map.md#the-units) names.

## The core runs as one loop that takes every input, stamped, from one recorded queue

- **Decided:** one thread owns the platform's services, every feature's state, and the QuickJS-ng runtimes, and handles one input at a time from one queue, which edge tasks for SimConnect, tokio's sockets and timers, the core helper's pipe, and a pool for slow work fill, each stamping an input as it pushes it.
  Everything the loop reads from disk, the settings, the session file, and the profile's bundle, arrives as an input.
  Handlers are synchronous, read no clock, draw no random number, do no I/O, and iterate no `HashMap`; time and any random ID arrive with an input, and timers and slow work leave as outputs and come back as inputs.
  A profile's script and a plugin get no clock: their QuickJS-ng contexts leave out `Date`, `performance`, and `Math.random`, and one that has to wait asks the platform for a timer; the 100ms limit stays by the clock, and the recording keeps the count of interrupt calls at which it fired.
  The platform records the queue under a header that names the build, so the same build replays a whole run, and only that build reads it as a replay; what a later version reads from a recording is a separate, self-describing record with named fields.
  Settled in node 5.1 by the user, 2026-10-14 ([02-code-map](02-code-map.md#one-loop)).
- **Because:**
  - Sans-IO cores, LMAX, and TigerBeetle run this way, game studios replayed matches from recorded inputs to reproduce bugs, while actors leave the order between features to the scheduler and simulation runtimes replay a seeded world, not a pilot's run ([architecture log, 5.1.1][a511]).
  - A bug report's recording then reproduces a bug in the core on our own PC, which the user found "super appealing" (user, 2026-10-14).
  - QuickJS-ng reads the wall clock in `Date`, `performance.now`, and the seed of `Math.random` (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `js_date_constructor`, `js_perf_now`, and `JS_NewContextRaw`), and neither a profile nor a plugin needs the time (user, 2026-10-14).
  - A replay needs its own build anyway, so the replay log needs no rules for being read across versions, while the report page, the debrief timeline, and plugin tests do, and names survive a field added later where postcard's positions don't (read in postcard 1.1.3, `src/ser/serializer.rs`, `serialize_unit_variant`).
- **Leaves out:**
  - whether a recording replays on a PC with another CPU, since Windows' C runtime picks its FMA3 math by CPU ([architecture log, 5.1.1][a511]), which replaying a recording on two PCs settles
  - how much of the queue the recording keeps, and the self-describing record, for node 6's design of recording
  - whether one loop meets its budgets, for node 7's bench

## A feature reaches other features only through the platform, and blocks a request only through a guard

- **Decided:** each feature's crate exposes one `register` function, which the core's `main` calls from one list, and through which the feature declares the platform's moments it handles, its session keys, channels, cockpit stream kinds, catch-up steps, guards, client state and commands, settings, notices, items for the match check, and the core helper's input and audio it needs.
  A handler writes only its own feature's state, reads the platform's, and acts through an outbox, asking the platform for any change to the platform's state, which the platform decides before the next input.
  Features reach each other only through moments the platform raises, and no feature raises one of its own.
  A feature that can block a request the platform decides, such as taking control or claiming a role's key, registers a guard, a quick check that allows the request or denies it with a reason, and any denial refuses it.
  The platform asks every guard after every input and keeps each request's verdict, which the apps show and a request takes; its own rules are guards it registers on itself; and a pass the platform makes itself, such as when the PF leaves the flight, isn't a request.
  Settled in node 5.1 by the user, 2026-10-14 ([02-code-map](02-code-map.md#what-a-feature-registers)).
- **Because:**
  - Deleting a feature has to leave every other feature whole, and a feature that called another, or that the platform checked by name, would break that.
    FS Copilot wired its features together by constructor injection, with `TrafficHost` and `AtcHost` built after `Coordinator` (read in the FS Copilot fork, `FsCopilot/Program.cs`).
  - A moment one feature raised for another would have its type either in the raising feature's crate, which the handling feature would then depend on, or in the platform's, which would keep it after the raising feature is deleted (node 5.1's review, 2026-10-14).
  - A guard lets a later feature, such as a hypothetical one that lets only an instructor take control, block a request without the platform knowing it exists.
    Only the platform can ask every guard, so only the platform can say why not before a pilot presses the button, as [04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up) asks (node 5.1's review, 2026-10-14).
- **Leaves out:** which hooks plugins reach through QuickJS-ng, for node 6's design of plugins, once the features they may plug into are designed (user, 2026-10-14).

## A role is a session key that names its holder

- **Decided:** a role a feature holds is one of its session keys, whose value names the member who holds it and which the platform clears of a member who leaves the session; who may hold a role, where a later role limits it, is a guard on writing its key.
  The table of roles stays in [roles and members](../session/01-roles-and-members.md#the-table-of-roles) as the session's documentation, and the code holds no registry of roles.
  This changes [decision 044](../../decisions/044-table-of-roles.md), and [04-room-for-later](../product/04-room-for-later.md#roles)'s "one table of roles" that v1 builds, once step 8's decisions are numbered.
  Settled in node 5.1 by the user, 2026-10-14 ([02-code-map](02-code-map.md#what-a-feature-registers)).
- **Because:** each column of v1's rows for the traffic host and the ATC host is what a session key already does: any crew member writes it, the session channel's stamp settles two writes at once, it keeps its value through a lost link or a flight left, and it's cleared when its holder leaves the session ([01-between-machines](../network/01-between-machines.md#channels); node 5.1's review, 2026-10-14).
  A later flight engineer, whom control never passes to by request, is a guard on taking control, and the PF stays the platform's control value.

## Traffic and ATC audio each hold a role, and one request claims both

- **Decided:** traffic declares the traffic host's key and ATC audio the ATC host's, and the platform offers one request that claims several keys together, refused whole if any guard denies one.
  The apps' "Share my traffic and ATC" switch sends it with both keys, and shows on while the pilot holds both, so the platform never knows what either key is for.
  This changes [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host), which gives the two one role that can split.
  Settled in node 5.1 by the user, 2026-10-14 ([02-code-map](02-code-map.md#the-traffic-and-atc-switch)).
- **Because:**
  - With one shared role, deleting traffic would take ATC's role with it, while with two, deleting traffic leaves the switch claiming ATC alone, and the apps lose traffic's key from the switch as they lose any deleted feature's section.
  - A command that traffic or ATC audio owned would go with its feature, or reach the other feature's key, and a command the platform owned would make the platform know both features (node 5.1's review, 2026-10-14).

## A feature whose messages keep the cockpit's order registers cockpit stream kinds, not a channel

- **Decided:** a feature whose messages must apply in order with the cockpit's, such as a later bus bridge carrying a message that opens a page, registers kinds on the cockpit stream, so no channel declares a place in the cockpit's order and a cockpit message carries one tag, its kind.
  This changes [decision 035](../../decisions/035-channels-declare-how-they-travel.md) once step 8's decisions are numbered.
  Settled in node 5.1 by the user, 2026-10-14 ([02-code-map](02-code-map.md#what-a-feature-registers)).
- **Because:** a channel that joined the cockpit's order rode the cockpit stream anyway, tagged with its channel beside its kind ([01-between-machines](../network/01-between-machines.md#channels)), so the replay, catch-up, pacing, and drops on a change of control already reached it as a kind (node 5.1's review, 2026-10-14).

## A write function that hits its limit stops its entry syncing for the rest of the load

- **Decided:** a write function that hits its 64 MB or 100ms limit fails that write, and its entry stops syncing on every machine for the rest of the load, flagged as a write that never lands is, as a plugin at its limit is turned off.
  This changes [decision 046](../../decisions/046-sandbox-runtimes-and-limits.md), under which a write function at a limit fails only that write, once step 8's decisions are numbered.
  Settled in node 5.1 by the user, 2026-10-14 ([02-code-map](02-code-map.md#budgets)).
- **Because:** on one loop, a stuck call holds up every input behind it.
  A write function that loops forever on a knob the PF turns would take 100ms for each of up to 20 values a second, so within 1s the PM's WASM module would stop hearing from the core and unfreeze the aircraft, and within 5s the link would count as lost (node 5.1's review, 2026-10-14; [04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream); [01-between-machines](../network/01-between-machines.md#the-link-between-two-cores)).

## The core meets the sim at SimConnect's own calls, and makes sense of them on the loop

- **Decided:** the seam between the core's code and the sim is SimConnect's calls and what comes back: each message, copied whole, each `SimConnect_Open`'s result, and each connection's loss, stamped and recorded.
  The edge, an engine the core and the IDE both link, makes each call through `SimConnect.dll` and tags each exception with its call's handle; the sim client, an engine on the loop, hands out SimConnect's IDs, parses each message, routes it to the call that caused it, and makes a lost connection's definitions, requests, and subscriptions again when the platform opens it again.
  A stand-in sim in the edge's place, or a replay of the recorded queue, takes the sim's place below the seam.
  A feature calls the sim through its outbox, naming variables and events as the sim spells them, and gets back each value, object ID, and exception with the handle of the call that caused it.
  Masking, the WASM module's version and counter, and the CommBus event that announces the core's port stay the platform's, and sim awareness raises one moment for each load, and one for the load it finds when the platform connects to a sim already in a flight.
  Settled in node 5.2 by the user, 2026-10-15 ([02-code-map](02-code-map.md#the-sim-seam)).
- **Because:** each failure our earlier sim layers had sits above the seam, where the bench runs it and a replay runs it again: values read in definition order, which a rejected variable cut short ([04-01](../../learn/foundations/04-01-connection-and-data.md#data-definitions-and-requests)); a watch set never defined on a new connection, and a replay that ran its steps beside the live path, where a bug shipped (fsc-editor, `src/main/sim/session.ts` and `src/main/sim/fixtures/README.md`); and exceptions FS Copilot's `SimClient` never read, and a bench that couldn't run with the sim open (FS Copilot fork, `FsCopilot/Connection/SimConnectConsumer.cs` and `record/pointer-forwarding/docs/14-test-bench.md`); [02-code-map](02-code-map.md#why-the-seam-sits-at-simconnects-calls) quotes each.
- **Leaves out:** the stand-in's model, and whether tagging exceptions through `SimConnect_GetLastSentPacketID`, which the SDK intends for debugging and testing, holds among writes each frame, for node 7.
  Node 6.3 made the logic in sim awareness that reads a load's signals an engine of its own, and added the sim's process as a fourth kind of input ([below](#sim-awareness-is-an-engine-whose-stages-each-load-enters-once)).

## Each feature reaches the sim on a connection of its own for each load, beside the platform's

- **Decided:** the platform holds one SimConnect connection from the moment `SimConnect_Open` succeeds until the sim closes, for sim awareness, masking, the module's version and counter, and the core's CommBus announcement.
  It opens one for each feature at the feature's first sim call after its profile loads, and closes it when the profile unloads or the feature closes it, and a closed connection's setup goes with it.
  No feature sees a connection, so the platform can put features on one connection without any feature changing.
  Settled in node 5.2 by the user, 2026-10-15 ([02-code-map](02-code-map.md#a-connection-for-each-feature-for-each-load)).
- **Because:**
  - Closing a connection ends a feature's work in the sim: the SDK says the server then removes "all objects, menu items, group definitions and so on" the client defined or requested (documented, [SimConnect_Close](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Close.htm)), and killing a client removed its AI objects (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled") and its masks ([flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)).
  - In one client, clearing one group cut another group off from the sim event both held ([architecture log](log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)), so on a shared connection one feature's teardown could silence another's listener; that a group on another connection keeps hearing is unverified.
  - A masking group that registers after an aircraft's module sits behind it ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)), so the platform's connection opens as the sim starts and holds the group from then.
- **Leaves out:** whether closing a connection removes what killing its client did, whether a group on another connection keeps hearing, and what a connection costs the sim's frame, for [node 7](plan.md#7-testing)'s tests in the sim; if closing leaves objects or masks behind, the sim service removes each feature's objects before closing its connection, and if connections cost too much, it puts the features on one.

## A feature's work in the sim is routines in our WASM module and panel modules, each its own

- **Decided:** a feature adds work to our WASM module as routines, each a crate of its own built into the module's one binary through one line in the module's list, and to the panel bridge as panel modules, each a TypeScript file the bridge loads by name when the core answers a panel's first message, so deleting a feature deletes its routines, their line in the list, and its panel modules.
  A routine never calls the sim: each frame it asks the routine host to read or write named variables, of the pilot's aircraft or of an object by its ID, to freeze the aircraft, or to run calculator code, and only the module's edge calls the sim's APIs, so node 7's bench can run the routine host and the routines natively.
  A plugin ships no code into the sim, and drives the same mechanisms through the platform.
  Settled in node 5.3 by the user, 2026-10-15 ([02-code-map](02-code-map.md#work-in-the-sim)).
- **Because:**
  - A following aircraft's smoothing and a figure's place in the cockpit are each one feature's logic, so generic mechanisms driven from the core would put that logic in the platform, where deleting the feature would leave it behind (user, 2026-10-15).
  - A syntax error in a panel file takes out the whole file ([04-room-for-later](../product/04-room-for-later.md#code-inside-the-sim)), so a file for each panel module keeps one module's mistake out of the others' files; whether a file that fails to parse stops the bridge's later loads is unverified, and a bench case settles it.
- **Leaves out:** which operations the bridge's `ops` module offers plugins, for [node 6](plan.md#6-systems); where routines and panel modules live, and whether the module builds in the core's Cargo workspace, for [5.4](plan.md#54-the-workspace).
  Node 6.3 chose the sim's API for each want ([below](#our-wasm-module-runs-no-routine-on-a-feed-from-another-build-and-carries-each-want-through-the-sims-fsvars-and-fsevents-apis)).

## A routine runs while its feature feeds it, and the routine host undoes only the freeze

- **Decided:** a routine runs from its feature's first feed until the feature's end mark, or until 1s passes with no write to its slot.
  The sim service writes each feed on the feature's own connection and writes the last one again every 200ms until the feature feeds another or ends the routine, and the routine host makes a routine new at its first feed.
  Preflight's hold and the plugins' mechanisms are the platform's own routines, which live in the routine host and are fed on the platform's connection.
  Each frame a routine asks for what it wants, and the routine host freezes the aircraft while any routine asks, and unfreezes it, if it froze it, once none does, so no routine keeps a flag the routine host must clear; following asks for the freeze in every frame it runs, with a pose to write or not.
  The platform ends each of a feature's routines before it closes the feature's connection, and when the module's counter hasn't moved for 3s in a flight that's neither loading nor paused, while a routine of ours is live, the core unfreezes the aircraft through its own connection ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-modules-status)).
  The module never learns the session's state, so routines' slots replace [decision 017](../../decisions/017-core-writes-control-slot-every-200ms.md)'s control slot, which carries that state, and a numbered decision makes the change once step 8's decisions are numbered; the module still leaves its version in a slot and writes a counter every second.
  Settled in node 5.3 by the user, 2026-10-15 ([02-code-map](02-code-map.md#routines-in-our-wasm-module)).
- **Because:**
  - A routine's life is its feeding: it starts at the first write, and ends at its feature's end mark, or 1s after the last write when the core is gone, so nothing in the module needs the session's state (user, 2026-10-15).
  - FS Copilot's module, on its timeout, sends the unfreeze whoever froze the aircraft and leaves its own `frz_by_me` set, so `interpolate` stays armed and writes whatever pose its buffer returns into the aircraft it unfroze (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `Update_StandAlone` and `interpolate`, and `stream_buffer.h`; not run).
  - A module whose code hits an error goes `DIRTY`, and the sim stops running it (documented, [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md#debugging-crashes-required-exports)), which would leave nothing in the sim to unfreeze the aircraft; whether a Rust panic puts our module there is unverified.
  - A client outside the sim released a frozen Baron by sending the three freeze events with 0 (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)).
- **Leaves out:** two cores in sessions on one sim, which would write the same slots, and which a developer doesn't run (user, 2026-10-15); whether the sim runs a standalone module's update during a pause, for [node 7](plan.md#7-testing)'s tests in the sim.

## The panel bridge owns only what can block the pilot's input

- **Decided:** a panel module adds its own listeners, removes them in its own `stop`, and wraps none of the sim's APIs.
  The bridge owns the locks, the overlays it places for pointer sync, a visible one over a display blocked through an outage and an unseen one while another pilot's gesture replays, with a hit test that looks past them; a lock holds only while the core renews it over the panel's socket every 2s, 8s to 10s after the last renewal a visible lock turns into a warning that blocks nothing and an unseen one goes, and a lock drops at once when the panel module that asked for it stops or the socket closes.
  It also owns any API a later feature has wrapped, suppressed only for one dispatch and cleared unconditionally after it, restored by `window.CROSSCHECK_BRIDGE_UNLOCK()`, and uninstalled after 120s idle; each CommBus handler of ours, run in a `try`; and `window.CROSSCHECK_BRIDGE_UNLOCK()`, which removes every lock and wrapper in its document and stops every panel module, its name by [names the sim shares](02-code-map.md#names-the-sim-shares).
  A panel's first message naming the instruments another socket holds replaces that socket, which the core closes.
  Settled in node 5.3 by the user, 2026-10-15 ([02-code-map](02-code-map.md#what-the-bridge-owns)).
- **Because:**
  - A listener a buggy `stop` leaves behind reads clicks and blocks none, while a wrapper left behind took every click on an A350 display, with the only handle to the original deleted ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  - `Coherent._trigger` calls a name's handlers with no `try`, so a handler of ours that throws would stop the aircraft's own handlers after it (read in the sim's `Coherent._trigger`, [CommBus log](../commbus/log.md#2026-09-28-a-script-that-arrives-after-a-panel-loaded-can-list-every-commbus-name-the-panel-registered); not run).
  - The core's CommBus announcement goes on with no session, so it can't renew a lock; and a page's socket stays open after the page reloads ([decision 010](../../decisions/010-clients-message-core-every-2s.md)), so without the replacement a reloaded panel's presses could go to its old socket (node 5.3's review, 2026-10-15).

## One repository holds all of Crosscheck, its folders by tier, with each feature's parts in one folder

- **Decided:** one repository holds Crosscheck's programs, our WASM module, our code in the sim, the backend, the Crosscheck IDE once it's built, and the profiles.
  Its top-level folders are `engines/`, `platform/`, `features/`, `apps/`, `sim-package/`, `profiles/`, `backend/`, and `tools/`.
  `features/<name>/` holds every part a feature has: its crate in the core, its routines, its panel modules, and its sections of the desktop app and the EFB app.
  `apps/` holds a folder for each program on the pilot's PC, the core helper's among them as `apps/core-helper/`; `sim-package/` holds what the sim loads from our Community package, `wasm-module/` and `pages/`; and `tools/` holds what builds, checks, and tests them, the profile builder among it (user, 2026-10-15).
  The profiles, plugins, and modules live in `profiles/`, with `aircraft/` and `modules/` inside, and an import names a module's path from `profiles/`; CI checks and builds them against the profile engine at the same commit, fails when a released level's schema or declarations differ from its release tag, and publishes them on this repository's GitHub Pages site, apart from Crosscheck's releases.
  Nobody outside the core team gets write access, so the profiles have no `CODEOWNERS` file; the core team reviews and merges every profile's pull request, and a profile's authors review it without their approval counting toward a merge.
  This changes [01-format-and-delivery](../profiles/01-format-and-delivery.md#the-repository), which gives the profiles a public repository of their own; [decision 021](../../decisions/021-profiles-and-plugins-apart-from-releases.md)'s "one public repository" holds, since Crosscheck's is public from v1.
  Settled in node 5.4 by the user, 2026-10-15 ([02-code-map](02-code-map.md#the-workspace)).
- **Because:**
  - Deleting a feature is then deleting its folder, its modules in the message crate and the profile engine, and its line in each program's list, the code map's first test.
  - One pull request can change the profile engine, a new level's declarations, and the profiles that use it, and no package of our tools has to be published for another repository's CI (user, 2026-10-15).
  - An author can clone the repository without file contents and check out only `profiles/` and the root's files, with git's partial clone and sparse checkout, or edit a profile on GitHub's site, and the repository is public from v1, as GitHub Free for organizations needs for a Pages site (user, 2026-10-15; documented, [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)).
  - A released level frozen at its release tag lets CI check against the engine at the same commit, while a schema edited after its release would pass that check and fail the load in released cores (node 5.4's review, 2026-10-15).
  - A code owner must have write access (documented, [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)), a role narrower than write takes GitHub Enterprise Cloud (documented, [About custom repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/about-custom-repository-roles)), and anyone with write access can read every secret the repository holds (documented, [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)), so the user gives write access to nobody outside the core team (user, 2026-10-15).
- **Leaves out:** whether a released level's builder output is held to its tag too, for node 6's design of the profile engine.

## One Cargo workspace and one npm lockfile build every target, from the SDK cargo-msfs installs

- **Decided:** every Rust crate is a member of one Cargo workspace, our WASM module's cdylib among them, left out of `default-members` with the rest of `sim-package/` and built by cargo-msfs from its own folder; the routine host and the routines are crates of their own.
  The bindings' build scripts read the SDK from the copy cargo-msfs installs, and bindgen generates them at each build, telling Cargo every header it read, so nothing derived from the SDK's headers is in the repository; the build prints the SDK version it built against; nothing sets `RUSTFLAGS`.
  TypeScript has one lockfile, with npm workspaces only in `apps/desktop/` and `backend/`, and a tsconfig for each target's `lib`; the messages' TypeScript types are generated into a folder emptied first, committed, and checked by CI, which fails on a difference when it generates them again.
  The one version lives in the root `Cargo.toml`'s `[workspace.package]`, and `tools/build.ts`, run by Node, builds every target but the backend and the profiles, and lays out the Community package.
  Settled in node 5.4 by the user, 2026-10-15 ([02-code-map](02-code-map.md#building-every-target)).
- **Because:**
  - Our module built that way against the same message crate as a Windows program, in one `target/` folder and one `Cargo.lock`, and building either side after the other compiled no crate (measured on our development machine, 2026-10-15, [architecture log](log.md#2026-10-15-our-wasm-module-builds-with-cargo-msfs-from-inside-the-cores-cargo-workspace-against-the-same-message-crate-and-neither-build-disturbs-the-others)).
  - cargo-msfs refuses a crate whose build outputs more than one file, and hands the build its caller's environment after setting `RUSTFLAGS` (read in navigraph/cargo-msfs v1.1.0, `src/main.rs`, Build).
  - cargo-msfs's copy of the SDK holds SimConnect's header, import library, and `SimConnect.dll` (read on disk, SDK 1.8.1, 2026-10-15), and it installs only the newest SDK (read in navigraph/cargo-msfs v1.1.0, `src/sdk.rs`, `install_latest_sdk`).
  - ts-rs removes no file it wrote before, so a deleted message's type would stay behind (read in ts-rs 12.0.1, in node 5.4's review).
  - esbuild, Vite, wrangler, and our packaging script are all Node's, as p08's build script is (user, 2026-10-15).
- **Leaves out:** whether the one copy of the SDK serves the Windows side's bindings, which the first build of the sim's edge settles; what the build does with an SDK newer than a release's, and whether Tauri 2 reads a version a crate inherits, for the build's design ([02-code-map](02-code-map.md#left-open)).

## CI runs on Windows, and one script checks crates and TypeScript imports against the code map

- **Decided:** every CI job runs on Windows runners, and a pull request that changes only `profiles/` runs the profiles' job alone.
  The code map's third test is a script in `tools/` that takes each crate's tier from its folder and reads the resolved graph from `cargo metadata`, crates from outside the workspace included, takes each TypeScript file's imports, type-only ones included, from the TypeScript compiler's own resolution, finds a feature naming another feature's module in the message crate or the profile engine by name, and checks all of it against the code map's rules.
  Settled in node 5.4 by the user, 2026-10-15 ([02-code-map](02-code-map.md#ci)).
- **Because:**
  - Crosscheck runs only on Windows, so CI runs our code on the system pilots run it on, and builds bundles on the system the core builds a local one on, whose hash two testers compare ([01-format-and-delivery](../profiles/01-format-and-delivery.md#testing-an-edit)).
  - Standard runners are free for a public repository (documented, [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)), as this one is when CI starts (user, 2026-10-15); Windows runners build slower, a whole build nearly 70% slower in one report (documented, [rust-lang/rust#66192](https://github.com/rust-lang/rust/issues/66192)).
  - esbuild drops a type-only import from its metafile (measured on our development machine, 2026-10-15, esbuild 0.28.2, in node 5.4's review).
  - cargo-deny bans a dependency only by naming, for each crate, which crates may depend on it (read in torrust/torrust-tracker, `deny.toml`, at 9c8bcdf), where the script holds each rule once, and one script covers both languages (user, 2026-10-15).
- **Leaves out:** how long CI takes, which the build's design measures.

## The platform in the core is a kernel and a crate for each of its services, which the kernel never names, and each moment lives in the crate that raises it

- **Decided:** the platform in the core is the kernel and a crate for each of its services, as [the units](02-code-map.md#the-units) lists them, each depending only on the lines below its own in the code map's picture, and each registering with the kernel through the same `register` a feature uses, before the features.
  The kernel holds the registry, moments, requests and their guards, the outbox, timers, jobs, and the store of each unit's state, and each crate adds the hooks it runs, so the kernel names no service.
  Each moment's type lives in the crate that raises it, and each unit's state is written by its own handlers alone.
  Outside the core, the platform is the routine host, the panel bridge, and the shells of the EFB app and the desktop app.
  The routine host also holds the platform's own routines, `Hold` and `Mechanisms`.
  A feature's section imports its app's shell and never an app, and neither half of the platform depends on the other.
  New engines hold QuickJS-ng's runtimes, an aircraft's models, and a sim page's socket; each crate in `apps/` and `sim-package/` is named `crosscheck-` and its folder; bug reports stay in the platform's recording crate rather than becoming a feature.
  [The units](02-code-map.md#the-units) names every unit, what it uses, and the systems [node 6](plan.md#6-systems) designs.
  Settled in node 5 by the user, 2026-10-15 ([02-code-map](02-code-map.md#the-units)).
- **Because:**
  - Node 6 designs each system as whole units, the map check holds the platform's own layering, and a change to one crate rebuilds only the crates that depend on it (user, 2026-10-15).
  - A moment's type in the crate that raises it puts it in a crate the handling feature already reads, and keeps a list of moments out of the kernel.
  - A section that imported from its app would tie the app and the feature both ways, while with the shell in the platform, the assemblies in `apps/` and `sim-package/` depend on the features and nothing depends on them.
  - Bug reports as a feature would need a part in `backend/` for their routes, a folder no feature has (user, 2026-10-15).
  - The module can't link a crate in the core, so the routines the platform feeds from the core live in the routine host (node 5's review, 2026-10-15).
  - Cargo names a program after its crate (documented, [Cargo targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html#binaries)), and refuses a workspace with two crates of one name (measured on our development machine, 2026-10-15, [architecture log](log.md#2026-10-15-cargo-refuses-two-crates-of-one-name-in-a-workspace-and-p10s-loop-reaches-no-crate-that-does-io)).
- **Leaves out:** where the installer lives, and where the relays' configuration lives, for node 6; and where the list of routines lives if node 7's bench runs them natively.

## Every crate outside the assemblies, the tools, the transport, and the sim edge keeps the loop's rules, and none draws randomness from the operating system

- **Decided:** the loop's crates are a rule on folders: every crate outside `apps/`, `sim-package/`, `tools/`, the transport, and the sim edge keeps [the loop's rules](02-code-map.md#one-loop), which forbid drawing randomness from the operating system as well as reading a clock, the routine host among them though it never runs on the loop, and the stand-in sim until node 7 decides otherwise.
  A random ID the core draws, such as the session's, comes from a ChaCha20 generator in the kernel, which the core's edge seeds once, with 256 bits from the operating system in the core's first input, so a replay draws the same IDs (node 6.1, user, 2026-10-15; [01-loop-and-edge](../core/01-loop-and-edge.md#timers-jobs-and-ids)); and the core's edge hands the sandbox the check behind QuickJS-ng's 100ms limit, so no loop crate reads the clock itself.
  The map check fails a loop crate that reaches, through any crate, one on [its list of crates that do I/O](02-code-map.md#the-map-check), which holds `getrandom` and the Windows crates beside tokio and the networking crates; it reads normal dependencies only, and a listed crate it lets a loop crate reach anyway carries its reason in the script.
  Only the two edges, the sim edge and our WASM module's, declare foreign functions, and `apps/core` the C runtime's `_set_FMA3_enable` alone, which no binding crate has (node 6.1, 2026-10-15; [01-loop-and-edge](../core/01-loop-and-edge.md#the-cores-math)), and the map check searches our crates' source for any other; the bindings crate holds SimConnect's types and constants.
  Settled in node 5 by the user, 2026-10-15 ([02-code-map](02-code-map.md#the-map-check)).
- **Because:**
  - A replay that drew its own random IDs would name the session differently from the run it replays, and [decision 022](../../decisions/022-random-uuids-as-text.md) has the host's core draw the session's ID (node 5's map, 2026-10-15).
  - The edge can't tell which input will ask for an ID, since the loop parses every input's bytes, so a generator seeded once spares each unit that draws an ID a round trip to the edge (node 6.1, 2026-10-15).
  - A rule on folders needs no edit when a feature is added.
  - p10's loop has 11 crates besides itself among its normal dependencies, rquickjs and zstd among them, none on the list (measured on our development machine, 2026-10-15, [architecture log](log.md#2026-10-15-cargo-refuses-two-crates-of-one-name-in-a-workspace-and-p10s-loop-reaches-no-crate-that-does-io)), while p07's message crate turned on uuid's `v4`, which reaches `getrandom` (read in `experiments/areas/architecture/types/messages/Cargo.toml` and `types/Cargo.lock`), so the message crate keeps it off.
  - With SimConnect's functions declared in the edges alone, the crate graph shows which crate can call `SimConnect.dll`, which one bindings crate holding both would hide, and the source search catches a crate that declares its own.
- **Leaves out:** an outside crate that calls std's file, socket, or clock functions itself, which passes the check and which we review as each dependency is added; and whether [node 7](plan.md#7-testing) frees the stand-in sim from the loop's rules.

## The core's queue stamps each input under its lock, and an input is its source and its unparsed bytes

- **Decided:** every thread that feeds the loop pushes through one queue, which reads the counter, stamps the input, and gives it the next sequence number under its lock, so the stamps rise in the order the loop takes the inputs.
  An input is its sequence number, its stamp, the source a unit registered for it, and the bytes that came in, which the unit that owns the source parses on the loop.
  The edge records every input from the core's first, in every run, with or without a session.
  Settled in node 6.1, 2026-10-15 ([01-loop-and-edge](../core/01-loop-and-edge.md)).
- **Because:**
  - Two threads that stamp and then push can push in the other order: FS Copilot's pre-PR review found, by reading its code, that its resend history could record two events with their times opposite to their sequence numbers, and the receiver would drop one as a copy (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R15 · History is ordered by wall clock, not by Seq").
  - With the bytes parsed on the loop, the only code that runs live and never in a replay is the edge's copying, where fsc-editor's replay ran a path of its own and a bug shipped ([02-code-map](02-code-map.md#why-the-seam-sits-at-simconnects-calls)).
  - A replay starts where the run did, since the seed, the handles, sim awareness, and the clients build up from the first input.
- **Leaves out:** which lock, a choice inside `apps/core`; and what a run's log is kept for, for node 6's design of recording.

## The core's timers wait on a high-resolution waitable timer, and the core links the C runtime statically with its FMA3 math off

- **Decided:** the core's edge runs the loop's timers on a thread of its own that waits on a high-resolution waitable timer, and asks nothing of `timeBeginPeriod`, which changes [decision 027](../../decisions/027-core-runs-on-tokio.md) for the loop's timers once step 8's decisions are numbered.
  The core links the C runtime statically, and `main` calls `_set_FMA3_enable(0)` before it starts any thread, in a live run and a replay.
  Settled in node 6.1, 2026-10-15 ([01-loop-and-edge](../core/01-loop-and-edge.md#the-cores-math)).
- **Because:**
  - tokio's sleep woke up to 16.9ms late, and after `timeBeginPeriod(1)` as late in three of four runs, while a high-resolution waitable timer woke at most 1.46ms late (measured on our development machine, 2026-10-15, [core log][c01]).
  - Rust's `f64` math and QuickJS-ng's `Math` both call the C runtime's functions, whose results changed with the FMA3 switch, alike in both, and differed between the runtime's DLL that comes with Windows and the one linked into the program, even with FMA3 off (same entry).
- **Leaves out:** whether two CPUs give the same bits from one build with FMA3 off, which replaying a friend's recording on ours settles; and the timers with the sim running and the PC busy, for [node 7](plan.md#7-testing)'s bench.

## A panic crashes the core, which comes back as a late joiner

- **Decided:** a release build sets `panic = "abort"`, and the panic hook logs the panic, its input, and the unit that ran, and has the recording's writer end its frame, waiting at most 500ms; the crash then takes [decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)'s path.
  Settled in node 6.1 by the user, 2026-10-15 ([01-loop-and-edge](../core/01-loop-and-edge.md#a-panic)).
- **Because:** turning a panicking feature off would recover from our own bug and leave a session half working, as a following machine with its flight-model feature off would fly on its own, where decision 041's late join brings every feature back, and a replay of the log reproduces the panic at the same input (user, 2026-10-15).

## A recording keeps a hash of the core's outputs once a second, so a replay finds the second it diverged

- **Decided:** the kernel folds each output's postcard encoding into a running 64-bit hash, and the edge records that hash, with the input's sequence number, each time an input's stamp starts a new second; a replay compares its own at each checkpoint and names the first that differs.
  A recording made for the bench can hold one before every input instead.
  Settled in node 6.1 by the user, 2026-10-15 ([01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)).
- **Because:**
  - A recording of inputs alone can't show whether a replay diverged from the run it replays.
  - A hash before every input would cost about 8.6 MB an hour at an assumed 300 inputs a second (unverified, since p10 never ran), and hashes don't compress, while one a second costs about 58 KB an hour (arithmetic).

## A quit leaves the session before the core exits, and a deliberate exit returns 0

- **Decided:** a quit, from the desktop app, the watcher's tray, or Windows ending the pilot's session, which the core hears through a top-level window it never shows, runs as a Leave before the core exits; every deliberate exit drains the edges' outputs within 750ms and returns 0, and a panic's abort never does.
  Settled in node 6.1, 2026-10-15 ([01-loop-and-edge](../core/01-loop-and-edge.md#quitting)).
- **Because:**
  - A core killed in a session looks like an outage to the crew, and FS Copilot's quit did: its goodbye was queued and "the process exits before LiteNetLib's update thread sends it" (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A deliberate quit reaches the peer as an outage").
  - Windows sends `WM_QUERYENDSESSION` to a window, and a core with no window would end without hearing it (documented, [WM_QUERYENDSESSION](https://learn.microsoft.com/en-us/windows/win32/shutdown/wm-queryendsession)).
  - The watcher starts the core again when it exits while the sim runs ([decision 002](../../decisions/002-core-starts-with-every-sim-run.md)), so it needs the exit code to tell a quit from a crash.
- **Leaves out:** whether Windows sends those messages to a window that's never shown, for [node 7](plan.md#7-testing)'s bench; and how the pilot asks for a quit, for node 6's designs of the apps and of installing and updating.

## The core serves its clients with tokio-websockets, and closes a socket with another Origin before reading it

- **Decided:** the core's edge serves the WebSockets of its clients with tokio-websockets, its `server` feature turned on, reads `Origin` from the request its `accept` returns, and closes a socket whose `Origin` is neither `coui://html_ui` nor absent with code 1008 before reading anything from it.
  Settled in node 6.2 by the user, 2026-10-15 ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#the-websocket-server)).
- **Because:**
  - iroh 1.3 already brings tokio-websockets 0.13.3 into the core through iroh-relay, so serving the clients with it keeps the core at one WebSocket implementation and adds no crate, where tokio-tungstenite 0.30.0 would add a second implementation, three crates beyond what iroh brings (read in our network probes' lockfiles, 2026-10-15, [core log][c02]).
  - Refusing a connection during the handshake, which tungstenite's callback does and tokio-websockets' `accept` doesn't, isn't a priority, since no message from a closed socket reaches the core either way (user, 2026-10-15).
  - tokio-tungstenite has 3,512 dependents to tokio-websockets' 34, and a head start of nearly six years (documented, crates.io's API, as of 2026-10-15; same entry), which says how widely it's run, not which is better made.
- **Leaves out:** the WebSocket client in the desktop app's Rust side, for node 6's design of the apps.

## The core and each client send at least every 2s, only the core closes a quiet socket, and client state reaches the clients that show it on a timer

- **Decided:** the core, as well as each client, sends a message at least every 2s, which adds the core's half to [decision 010](../../decisions/010-clients-message-core-every-2s.md) once step 8's decisions are numbered; only the core closes a socket that has been quiet for 8s, and a client keeps its socket through the core's silence, while any message from the core renews a panel's locks.
  A unit reaches the clients through slices of state, which `clients` builds and sends on a timer to the clients that watch them, through commands, whose answer says only whether each was taken, and through messages of its own to a client by name; `clients` raises a client joining or leaving, a panel's socket replaced, and a setting changed, and logs and drops a message that doesn't parse.
  page-client queues nothing while it has no socket, and connects again on the core's next announcement.
  Settled in node 6.2, 2026-10-15 ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#the-protocol)).
- **Because:**
  - With only the clients sending, a client can't see a core that hangs; and a client that closed on the core's silence would drop a panel's locks and modules through a hang, where the code map turns a visible lock into a warning ([02-code-map](02-code-map.md#how-work-in-the-sim-ends)).
  - A timer bounds the work of client state however many inputs arrive, and needs no unit to mark what it changed.
  - A core that restarted comes back as a late joiner ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)), so a press kept through the restart would play into a cockpit already caught up; FS Copilot's channel kept up to 200 messages for 30s (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`).
  - `clients` sits below the session crate, pointer sync, and the core-helper-service in the code map's units, so it tells them through moments.

## A client whose version differs from the core's is logged, and the core goes on talking to it

- **Decided:** a `hello` whose version or message crate hash differs from the core's is logged by the client's name with both versions, and nothing else changes, for the clients on WebSockets.
  Settled in node 6.2 by the user, 2026-10-15 ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#a-client-whose-version-differs)).
- **Because:** the watcher updates the Community package with Crosscheck while the sim is closed ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so we expect a mismatch to mean a developer's stale package (inference).
- **Leaves out:** what the pilot sees, for node 6's design of the apps.
  Our WASM module, whose data slots are read in place, runs no routine on a feed from another build ([below](#our-wasm-module-runs-no-routine-on-a-feed-from-another-build-and-carries-each-want-through-the-sims-fsvars-and-fsevents-apis)).

## v1 builds no listener beyond the PC, and the protocol leaves room for one

- **Decided:** the protocol takes nothing about a client from its address, and v1 binds no listener beyond 127.0.0.1; this changes [04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client), which has v1 build that listener, off by default, and [decision 027](../../decisions/027-core-runs-on-tokio.md)'s core that "can listen beyond the PC, off by default", once step 8's decisions are numbered.
  Settled in node 6.2 by the user, 2026-10-15 ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#clients-beyond-the-pc)).
- **Because:** no v1 client could use or test the listener, and the tablet's own design decides how its page is served, its `Origin`, and how its token travels.

## Our VCockpit.js hands each instrument to the bridge without ever delaying it, and loads our files outside the sim's loader

- **Decided:** our `VCockpit.js` is the stock file with two blocks between markers: one adds a script element of its own for the bridge in a `try`, and one, after the sim has set each instrument up, hands it to the bridge, or queues it for the bridge if the bridge hasn't loaded, in a `try`; the bridge loads `CommBus.js` and each panel module through script elements of its own too, never through `Include.addImports`; the build puts the blocks in at named anchors and refuses when one is missing.
  Settled in node 6.2, 2026-10-15 ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)).
- **Because:**
  - Code there runs inside the loading of every instrument, so a bridge that never loads has to leave the cockpit as if Crosscheck weren't installed ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
  - The sim's loader holds every later script behind one that never loads, while it loads one at a time as it does for each instrument (read in the sim's `common.js`, `IncludeMgr`, not run; [core log][c03]).
- **Leaves out:** how the build gets the stock file after each sim update, since the sim streams it, for node 6's design of the build; and whether a script element's `onerror` fires in Coherent GT, for [node 7](plan.md#7-testing)'s bench.

## Sim awareness is an engine, whose stages each load enters once

- **Decided:** sim awareness is an engine, `sim-awareness`: one step function, with no clock and no I/O, from the sim's signals to its state, the stage, the aircraft, the pause flags, the run of the sim, and how the last run ended.
  The stages are Closed, Starting, Menu, Loading, Ready to fly, and Flying; a load starts at `FlightLoaded`, Ready to fly at `RTC_START`, Flying at `RTC_END`, and Menu at `BACK_TO_MAIN_MENU`, and every other signal, `FLIGHT_END` among them, leaves the stage as it is.
  A core that connects mid-run leaves Starting by the menu script's master page, `MasterPage` for Menu and `MasterPage_InGame` for Flying, or by a load's signal.
  The aircraft is the last `AircraftLoaded` path heard while Loading, lowercased and cut below `simobjects/airplanes/`, which names the folder and the preset, and the core logs `A:TITLE` beside it.
  The sim service raises one moment, `SimChanged`, for each change, so a load is one entry into Loading.
  Settled in node 6.3 by the user, 2026-10-15 ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#sim-awareness)).
- **Because:**
  - The IDE can link it, as it links the sim client, where fsc-editor worked the sim's state out again on every `AircraftLoaded` (read in fsc-editor, `src/main/sim/session.ts`, `aircraftChanged`), and the bench can feed it recorded signals with nothing else running (user, 2026-10-15).
  - p08's client heard two of its three `AircraftLoaded` in the main menu, and `FLT_LOAD` three times in one load ([core log][c05]).
  - `Sim` read 1 in the main menu and through a load's screen, and a Restart sent `FLIGHT_END` inside its load ([core log][c06]).
  - The path names the preset on the PA-24 and the A350, and a profile names a preset by that path ([01-format-and-delivery](../profiles/01-format-and-delivery.md#the-aircraft-and-its-variants)), while `A:TITLE` carries the livery in an aircraft that isn't modular ([02-02](../../learn/foundations/02-02-aircraft.md#how-an-aircraft-is-identified)).
- **Leaves out:** a core that connects mid-flight without our copy of BlurPage, which brings the menu script, stays Starting until the next load.

## The core's edge watches the sim's process, and a sim whose process ends with no quit message before it crashed

- **Decided:** the sim edge looks for `FlightSimulator2024.exe` every 2s while it holds no process, and hands up the process's ID and creation time when it finds it and its exit code when it ends, a fourth kind of input through the sim seam.
  A run of the sim ends as a close when the sim's quit message arrives on the platform's connection, and as a crash when its process exits with no quit message before it; after the quit message, the core opens nothing until another process is found.
  Settled in node 6.3 by the user, 2026-10-15 ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#a-crash-and-a-close)).
- **Because:**
  - Every sim crash in our aircraft harness closed SimConnect's connection with no quit message before it ([core log][c04]).
  - The session file holds the run of the sim, which the spine names by its process's ID and creation time ([IDs](01-spine.md#ids)), and the process's end ends a run even when SimConnect reports nothing.
- **Leaves out:** whether a clean close sends the quit message, for [node 7](plan.md#7-testing)'s tests in the sim, after which the exit code decides if it doesn't; and whether the Microsoft Store edition's process has the same name, which a pilot's crash report on the SDK's forum gives (unverified, [CTD always on startup](https://devsupport.flightsimulator.com/t/ctd-always-on-startup/10774)).

## Our WASM module runs no routine on a feed from another build, and carries each want through the sim's fsVars and fsEvents APIs

- **Decided:** the module leaves its version, the slots hash, a hash of the slot structs alone, and its counter in `CROSSCHECK_MODULE_STATUS`, in a layout that never changes, and each routine's slot header carries the slots hash; the routine host ignores a feed whose slots hash isn't its own, and the sim service logs both versions and reports the module as differing.
  The routine host reads and writes `A:`, `L:`, and `Z:` variables through `fsVarsAVarGet`, `fsVarsAVarSet`, `fsVarsLVarGet`, `fsVarsLVarSet`, `fsVarsZVarGet`, and `fsVarsZVarSet`, freezes through `fsEventsTriggerKeyEvent` with the SDK's `KEY_FREEZE_*_SET` numbers, and runs a plugin's calculator code through `execute_calculator_code`.
  The core unfreezes the aircraft once the counter has been still for 3s spent in Flying, unpaused, with a routine of ours live.
  Settled in node 6.3 by the user, 2026-10-15 ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#our-wasm-module)).
- **Because:**
  - A routine reads its slot in place, so a struct laid out by another build could become wrong values written into the pilot's aircraft, and a hash of the slot structs alone spares a developer a sim restart for a change to a WebSocket message.
  - p12 read and wrote `A:` variables through `fsVarsAVarGet` and `fsVarsAVarSet` in the sim (read in `experiments/areas/avatars/wasm/src/follow.cpp`, `read_pose` and `write_pose`), and SDK 1.7.3 marks `execute_calculator_code` deprecated while nothing else runs calculator code (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/Legacy/gauges.h`).
  - The session sits above the sim service, which can't read it, and a module with no routine live froze nothing.
- **Leaves out:** whether `fsVarsAVarSet` holds the pilot's own aircraft's pose and whether `fsEventsTriggerKeyEvent` freezes it, for [node 7](plan.md#7-testing)'s tests in the sim, after which calculator code carries either that fails, as FS Copilot's module writes its pose and freeze; and whether bindgen brings in the freeze events' numbers, since p08's build generated bindings only from `SimConnect.h` and `MSFS_Vars.h`.

## Every name the sim shares is CROSSCHECK_, a kind, and a name

- **Decided:** every name of ours that the sim shares with other packages, in a panel's globals, the CommBus, client data areas, SimObject titles, and `L:` and `Z:` variables, is `CROSSCHECK_<KIND>_<NAME>`, where the kind is what owns the name, from the list in [names the sim shares](02-code-map.md#names-the-sim-shares), or a probe's ID.
  So a routine's slot is `CROSSCHECK_ROUTINE_FOLLOW`, the module's own `CROSSCHECK_MODULE_STATUS`, the core's announcement `CROSSCHECK_CORE_ANNOUNCE`, and the bridge's globals `CROSSCHECK_BRIDGE_API`, `CROSSCHECK_BRIDGE_PENDING`, and `CROSSCHECK_BRIDGE_UNLOCK`.
  Settled in node 6.3 by the user, 2026-10-15.
- **Because:** a reader can tell what owns a name at a glance, and names of two kinds in one namespace never collide, where without the kind a routine whose ID was `MODULE` would take the module's own status slot (user, 2026-10-15).
- **Leaves out:** the figure's SimObject title, `CROSSCHECK_Figure`, for node 6's design of avatars.

## The network decides on the loop, and the transport keeps only what turns on time and bytes

- **Decided:** the network crate, on the loop, decides each link's state and timers, every dial and close, which of two connections stays, whether a first message passes, each sender's clock offset, and what goes out on which channel to whom.
  The transport, an engine at the core's edge, runs iroh, keeps the newest packet of each channel and key until QUIC's queue has room, paces what goes through a relay below its cap, writes the heartbeat's send stamp, and binds under a timeout; its commands and events live in the message crate.
  Settled in node 6.4 by the user, 2026-10-16 ([02-units](../network/02-units.md#what-runs-where)).
- **Because:**
  - A replay reproduces a decision only when the loop makes it ([one loop](02-code-map.md#one-loop)).
  - The map check lists the transport among the crates that do I/O, so the network crate can't depend on it ([the map check](02-code-map.md#the-map-check)).
  - QUIC's room for one-off packets changes with every packet it carries, which the loop never sees.
- **Leaves out:** whether the newest-only slots change anything on a direct path, which a case run by hand on our droplets settles.

## The network owns everything between machines, and the session crate fills each first message through one hook

- **Decided:** the network crate owns the endpoint and its key, each link, the first message's header, the version check at join, and every request to the backend.
  The session crate registers the session channel as the one opener, whose keys fill each connection's first message, and asks the network to host, join, open links, dial a member, and leave; the network raises `LinkUp`, `LinkLost`, `MemberLeft`, `MemberOut`, and `BackendAnswered`.
  The network keeps one link for each pilot ID, which starts lost, so a first join redials every 2s as a lost link does; `LinkUp` comes each time the link takes a connection, with `again` false after a higher restart count, so a restarted core gets a late join and no replay.
  The endpoint key comes from the kernel's ChaCha20 generator, through `cx.random_bytes()`, and the network signs the backend's requests with it on the loop.
  Settled in node 6.4 by the user, 2026-10-16 ([02-units](../network/02-units.md#the-network-crate)).
- **Because:**
  - The session crate sits above the network in the code map, so the network can't read the session's keys, and a key's stamp compares control values first, which are the session's ([channels](../network/01-between-machines.md#channels)).
  - Signing the backend's requests and renewing them as links come up both need the network's key and links.
  - Two dials that land at once can move a link onto a second connection after its first `LinkUp`, and what went out on the closed one may be lost (noq, [leaving](../network/01-between-machines.md#leaving)), and [decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md) gives a restarted core a late join.
- **Leaves out:** whether ed25519-dalek reaches `getrandom` with its `rand_core` feature off, which the map check shows at the first build.

## A channel declares its delivery and priority, and the heartbeat carries only the clock exchange

- **Decided:** a channel is a constant in its owner's module of the message crate, with its number, message type, delivery (`Stream`, `Newest`, or `Deadline`), and priority; each send names its receivers, the crew or one member, and the receiving handler checks who may send.
  The heartbeat carries the clock exchange alone, with send stamps the transport writes, and the cockpit-stream crate sends its vector clock once a second on a one-off channel of its own.
  This changes [decision 035](../../decisions/035-channels-declare-how-they-travel.md)'s channels that declare who sends and receives them, and decisions [037](../../decisions/037-while-a-link-is-lost.md), [042](../../decisions/042-vector-clock-records-what-applied.md), and [044](../../decisions/044-table-of-roles.md)'s acknowledgment on the heartbeat, once step 8's decisions are numbered.
  Settled in node 6.4 by the user, 2026-10-16 ([02-units](../network/02-units.md#channels-and-sends)).
- **Because:**
  - The network can't evaluate a role such as the flying machine, because the session crate that knows it sits above the network.
  - A send stamp taken as the packet goes to QUIC leaves the loop's own delay out of the time on the path.
  - The acknowledgment's own channel costs up to one packet a second, about 58 bytes of headers ([network log, 2.2][n22]), and the heartbeat knows nothing of the cockpit stream.
- **Leaves out:** nothing.

## Our relays run on two servers of ours, configured from relays/

- **Decided:** two DigitalOcean droplets, in New York and Frankfurt, run `iroh-relay` 1.3, at $4 to $6 a month each (documented, [research report 06](../network/results/2026-10-10-transport-research-reports/06-relay-hosting-and-cost.txt), prices fetched 2026-10-09).
  `relays/relays.toml` lists each relay's region, URL, tokens, and cap once; each release's default relay list compiles in from it, and `relays/deploy.ts` renders each relay's configuration from it; a relay of our own, if we ever write one, lives there too.
  Settled in node 6.4 by the user, 2026-10-16 ([02-units](../network/02-units.md#the-relays)).
- **Because:**
  - n0's shared relays admit an endpoint through a token n0's own preset mints from a project API key, state a 5 MB/s limit without saying what it applies to, and lock no version, which only Dedicated relays do, at $199 a month for each region (documented, [shared relays](https://docs.iroh.computer/iroh-services/relays/shared), [dedicated relays](https://docs.iroh.computer/iroh-services/relays/managed), [pricing](https://www.iroh.computer/pricing), undated, read 2026-10-16), where [decision 033](../../decisions/033-relays-run-iroh-relay-unmodified.md) has tokens of our own, a cap for each client, and pinned versions.
  - p03, p05, p06, and p07 measured iroh through droplets in those two cities, of 2 vCPUs and 2 GiB ([network log, 2.3][n23]; [network log, p07][p07]).
  - The tokens are public either way, since each release carries them.
- **Leaves out:** whether a droplet with 1 vCPU and 512 MiB carries `iroh-relay`, which the first deployment shows, and whether pilots in Asia and Oceania need a third region, which v1's recordings show.

## The backend is a Worker on D1, which counts only wrong codes against an address

- **Decided:** the backend is a Cloudflare Worker in TypeScript, with a plain `fetch` handler and no framework, on D1 with no Durable Object.
  It serves four requests, and every request but a lookup carries the member's endpoint ID and an Ed25519 signature by the endpoint key.
  A lookup reads its address's count of wrong codes for the hour first, refuses at 20, and adds one only for a wrong code; it answers a session with no member renewed within 30 minutes as no such code.
  Settled in node 6.4 by the user, 2026-10-16 ([02-units](../network/02-units.md#the-backend)).
- **Because:**
  - The backend holds no connection, where fsc-editor's Worker holds a Durable Object for each code because it holds each session's WebSockets (read in fsc-editor, `relay/src/index.ts`, `Session`).
  - D1's Workers Free plan allows 100,000 rows written a day, a write counting one more row for each index it touches ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), as of 2026-04-21), and Workers Free 100,000 requests a day ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), about 8,000 to 16,000 pilot-hours of renewals (arithmetic).
  - Reading the count before the lookup refuses an address at its limit even when it guesses right, where fsc-editor's Worker counts every well-formed join (same file, `join`).
  - A counter against replayed requests would be lost with a restarted core, whose renewals it would then refuse, and a captured request carries the code, which admits its holder anyway.
- **Leaves out:** bug reports' files, which may pass D1's 2 MB a row ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)), for node 6.6; and whether Workers verify Ed25519 as [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) lists, which the backend's tests settle.

## The bench stands in for a relay's loss with a proxy, and a direct path's loss runs by hand

- **Decided:** in CI and on a developer's PC, two cores run through a local `iroh-relay` bound to `127.0.0.1`, behind a TCP proxy that holds bytes back as TCP's resend after a loss would, or cuts a core's connection, and against a local backend.
  v1's full mix on a direct path under loss runs by hand, through `tc netem` on our droplets, at the network's stage of the build and whenever iroh's or noq's pinned version changes.
  Settled in node 6.4 by the user, 2026-10-16 ([02-units](../network/02-units.md#cases-for-the-bench)).
- **Because:**
  - CI runs on Windows only ([CI](02-code-map.md#ci)), and `iroh-relay` 1.3.0 builds and runs there, answering on IPv6 loopback only in dev mode ([network log][nwin]).
  - On iroh's relay QUIC sees no loss, only late packets ([network log, p06][p06]), so holding bytes back stands in for loss there.
  - Only a direct path's loss needs packets dropped, and the core runs only on Windows.
- **Leaves out:** whether the network crate and the transport build on Linux for the case run by hand, which that program's first build settles; and whether `iroh-relay` answers on `127.0.0.1` when its configuration binds it there, which no run has tried.

## The core helper runs while a feature wants something of it, and the core sends it every want whole

- **Decided:** each feature registers its bindings, captures, playback streams, phrases, and the mouse with `core-helper-service`, each off until the feature turns it on, and its sounds, which the service sends after each `Hello`; the service runs the helper while anything is on, and sends it every want whole after its `Hello` and at each change.
  A want the helper can't carry out it reports, and runs the rest, and the service shows a warning naming the feature.
  When the helper exits while something is wanted, or goes 8s without a message, the service starts it again 2s later, for as long as something is wanted, and shows a trouble notice naming the features whose wants are on once 5s pass with no matching `Hello`; a helper whose version or hash differs is killed and counts as down.
  The helper exits when its standard input closes.
  Settled in node 6.5 by the user, 2026-10-16 ([04-core-helper](../core/04-core-helper.md#the-helpers-life)).
- **Because:**
  - A started-again helper gets everything in one round, as the session crate sends its keys whole on every `LinkUp` ([02-units](../network/02-units.md#moments)).
  - Take-control turns its binding on only in a session, and the next press and the lists are on only while the desktop app binds a key or lists devices, so [decision 019](../../decisions/019-input-and-audio-run-in-helper.md)'s rule for when the helper runs holds without the service knowing what a session is.
  - Starting it again every 2s adds no mechanism beyond the notice, which the pilot needs either way.
- **Leaves out:** whether a Windows program with no console reads a piped standard input, which p08's helper never had (read in `experiments/areas/architecture/p08-flight.mjs`), and whether it closes when the core crashes, which the helper's first build and a bench case settle.

## Messages on the core helper's pipe are postcard after a 4-byte length

- **Decided:** each message on the core helper's standard input and output is a 4-byte little-endian length, then a `ToHelper` or `FromHelper` in postcard, at most 1 MiB.
  Settled in node 6.5 by the user, 2026-10-16 ([04-core-helper](../core/04-core-helper.md#the-pipe)).
- **Because:**
  - Every message between cores is postcard ([decision 035](../../decisions/035-channels-declare-how-they-travel.md)), and the kernel already hashes outputs' postcard ([01-loop-and-edge](../core/01-loop-and-edge.md#outputs)).
  - postcard writes an enum's variant as its position (read in postcard 1.1.3, `src/ser/serializer.rs`, `serialize_unit_variant`), which is safe because the core starts the helper from its own folder, and the `Hello` catches a helper of another build.
- **Leaves out:** nothing.

## Of the pilot's input, only bound presses, the next press while binding, and the mouse in the sim's window cross the core helper's pipe, and of the microphone only the phrase heard does

- **Decided:** the helper reports a bound key's or button's press and release, the next press while the desktop app binds a key, and the mouse only while the sim's main window itself is in front, not a popped-out display; every other key, button, and click stays in the helper.
  The helper tells speech from noise and recognizes phrases itself, so only the phrase heard crosses.
  Settled in node 6.5 by the user, 2026-10-16 ([04-core-helper](../core/04-core-helper.md#raw-input)).
- **Because:** every input the core takes is recorded ([01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)), so a keystroke typed into another program would otherwise reach a bug report, and [voice phrases](../product/03-v1-scope.md#voice-phrases) keeps a pilot's audio on their machine.
- **Leaves out:** whether Raw Input sees an Xbox controller's buttons, which reach Windows through XInput.

## Opus, its gate, and the playback buffer run in the core helper, through opus-rs

- **Decided:** the helper encodes a captured program's audio into 20ms Opus frames, sends only those above the gate, and decodes, conceals, buffers, and mixes what it plays, through opus-rs, a pure-Rust port of libopus 1.6, behind three calls; ATC audio sets the bitrate, the gate, and the buffer's rule.
  Sounds are Ogg Opus files in each feature's crate, read with `ogg` 0.9.2.
  Settled in node 6.5 by the user, 2026-10-16 ([04-core-helper](../core/04-core-helper.md#opus)).
- **Because:**
  - At 24 kbps a frame averages 60 bytes, about 3 KB/s, where 48 kHz mono 16-bit audio would put 96 KB/s, about 345 MB an hour, in every recording (arithmetic), and the codec's native code stays out of the core, as [decision 019](../../decisions/019-input-and-audio-run-in-helper.md) wants.
  - Every libopus binding we found builds through CMake, `opus` 0.4.0 among them through opusic-sys (read 2026-10-16 in the dependencies crates.io lists for `opus` 0.4.0, opusic-sys 0.7.5, libopus_sys 0.3.2, and opus-codec 0.2.0), which nothing else in our build uses, while opus-rs needs no CMake; nothing else in Crosscheck depends on ATC audio or the cues, so a young codec costs little, and swapping in `opus` 0.4.0, bindings to libopus 1.6.1, changes one crate and no message (user, 2026-10-16).
- **Leaves out:** whether opus-rs holds up, which a bench case and a listen at the helper's stage of the build settle.

## A microphone setting sits beside the output device, and each follows Windows' default unless the pilot picks one

- **Decided:** `core-helper-service` keeps an output device and a microphone setting, each Windows' default device or one the pilot picked, by its endpoint ID and name; the helper follows Windows' default when it changes, for the output and the microphone alike, takes a picked device by its name when no device has its ID, and plays or listens on the default while a picked device is missing, which the service shows as a warning.
  This adds a setting to [03-v1-scope](../product/03-v1-scope.md#hearing-atc), and settles its open question on following Windows' default output device.
  Settled in node 6.5 by the user, 2026-10-16 ([04-core-helper](../core/04-core-helper.md#the-devices)).
- **Because:** on the wrong microphone, a voice handover fails with no sign of why.
- **Leaves out:** nothing.

## A recording is a replay log less the high-rate samples a feature marks, and a replay checks only the units whose inputs are whole

- **Decided:** a unit registered as partly recorded can declare a channel, a sim call, a core helper want, or a job unrecorded, and the edge's writer leaves its inputs out of the recording.
  Such a unit runs in a replay on what was recorded, and its outputs go unchecked; it may register no guard, catch-up step, or cockpit kind, or make a request the platform decides, and turns a core helper want on or off only on a recorded input.
  Each unit counts its own handles, draws its own IDs, and numbers its own SimConnect connections; each output names its unit; and a platform crate decides nothing on an unrecorded input beyond handing it to its unit, so the network's lost-link timer counts only recorded inputs, and the core helper sends `Alive`, and the core sends each client `alive`, every 2s whatever else it sends.
  The panic hook records the input being handled, even an unrecorded one; a development setting records everything; and a replay on the same commit with uncommitted changes warns and runs.
  v1's partly recorded units are traffic, ATC audio, avatars, and flight-model sync.
  Settled in node 6.6 by the user, 2026-10-16 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
- **Because:**
  - A flying machine that hosts traffic at EGLL took in 285 MB of inputs an hour, 45 MB with zstd, 87% of the raw bytes traffic's positions ([architecture log][p10]), and without its traffic's positions, flight model, and camera its sim inputs came to 0.9 MB an hour ([architecture log][lean]).
  - Reading less would have cut it to 13 MB an hour ([architecture log][lean]), but a recording is a debugging tool, and mustn't set traffic's radius or rate, or anything else a pilot feels (user, 2026-10-16).
  - The line that matters runs between a feature's events and its samples, not between features, so traffic's identities and the figure's creation stay in the recording (user, 2026-10-16).
  - Splitting a feature into a replayed unit for its events and an unrecorded one for its samples would have let the recorder shape the feature's code, for exact replay of traffic's spawns alone, since flight-model sync and avatars decide sample by sample.
- **Leaves out:** how big a following machine's recording is, which v1's friend sessions show.

## The edge keeps the home folder's path, and anything but an invite code on the clipboard, out of every input

- **Decided:** the edge puts a run of `~` as many bytes long as the home folder's path in its place wherever it appears in an input, in UTF-8 or the ANSI code page, as written or lowercased, and the real path back in each output that names a file; the clipboard's job hands up only six characters from the invite code's alphabet; and the log subscriber writes each line with the home folder's path and the Windows username replaced.
  Settled in node 6.6 by the user, 2026-10-16 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#what-stays-out)).
- **Because:**
  - `AircraftLoaded` names a Community aircraft by a path under `%APPDATA%`, in the pilot's home folder, lowercased (measured on MSFS 2024, 2026-10-09, `experiments/areas/architecture/results/p08-flight-2026-10-09-17-12-31.txt`), and [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) scrubs home folders from every report.
  - Scrubbing a recording after the fact would change its inputs and break its replay, while a placeholder of the same length keeps every SimConnect record's size, and a replay opens no file.
- **Leaves out:** the Windows username outside a path in an input, which we know of no input to carry, so 03-v1-scope's rule holds for usernames in the logs alone.

## Each PC keeps whole runs within 1 GB, with no minimal recording

- **Decided:** the recording crate deletes each run with no session that isn't among the 3 newest runs before the one starting, then the oldest runs while all together pass 1 GB, never the newest that held a session; each run's small JSON index of its sessions, with their times, aircraft, departure airport, crew, and upload, is the one record a later Crosscheck reads; and no setting chooses full or minimal recording.
  This changes [decision 016](../../decisions/016-core-keeps-pilots-settings.md)'s recording mode, once step 8's decisions are numbered.
  Settled in node 6.6 by the user, 2026-10-16 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#what-each-pc-keeps)).
- **Because:** a replay starts at a run's first input ([01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)), and at a few MB an hour of session, 1 GB holds hundreds of hours, so size no longer calls for a minimal mode (user, 2026-10-16).
- **Leaves out:** the desktop app's list of recordings with their sizes and a way to delete them, for [6.16](plan.md#616-the-apps).

## A bug report's parts go to R2 through our Worker, only from the session's members, for 30 days

- **Decided:** each pilot's core uploads each file of their part to `POST /v1/reports`, signed with the endpoint key it held in the session; the Worker checks the signature against the endpoint ID and the members it kept for that session, and stores the file in R2 under the session, the endpoint, and the run, where a lifecycle rule expires it at 30 days; a leave marks a member's row as left, and the hourly Cron Trigger keeps sessions' and members' rows 30 days after the later of their last renewal and their leave; a core offers a missing pilot's part when R2 holds a crewmate's; and `tools/reports.ts`, with a secret the Worker holds, lists and fetches reports from R2's listing.
  Settled in node 6.6 by the user, 2026-10-16 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#a-bug-report)).
- **Because:**
  - Blobs split across D1's rows of at most 2 MB (documented, [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)) would be a hack (user, 2026-10-16), while R2 stores 10 GB-month free each month and costs $0.015 a GB-month past it (documented, [R2 pricing](https://developers.cloudflare.com/r2/pricing/)).
  - A member's own endpoint key already signs the backend's requests ([02-units](../network/02-units.md#its-requests)), so admitting only members keeps out junk with no accounts.
  - Every session ends in a leave, so a leave that ended a member's row would refuse their upload the next morning.
- **Leaves out:** whether the R2 subscription, which an account adds through Cloudflare's checkout ([R2 get started](https://developers.cloudflare.com/r2/get-started/)), needs a card on file, which subscribing shows.

## Every core works out who is in the flight from each member's own key, and a pilot in another aircraft joins out of the flight

- **Decided:** each member writes its sim's stage, aircraft, and pause flags, how its last sim run ended, and its links, as a session key of its own, and every core counts a member in the flight while that key says Ready to fly or Flying in the session's aircraft; a pilot in another aircraft joins and waits out of the flight with a notice, which replaces the rule that such a pilot can't join; control passes, preflight counts, and the session ends by that one rule.
  Settled in node 6.7 by the user, 2026-10-16 ([the session's units](../session/02-units.md#in-the-flight)).
- **Because:** refusing every join from a flight would make a pilot cut off for 30 minutes, or who pressed Leave by mistake, quit their flight to come back, and refusing only another aircraft would need the session's aircraft before the join (user, 2026-10-16).
- **Leaves out:** nothing.

## A session key is written by a member, anyone, or the PF alone, and every write is a request the session crate decides

- **Decided:** a key declares its writer as each member of itself, any member, settled by the stamp, or the PF alone, whose key the session crate drops from anyone else; every write goes through `WriteKeys`, which any guard on one of its keys refuses whole; the session crate's own keys are `control`, `preflight`, which holds the session's aircraft and preflight's phase, and each member's `member`, `status`, `ready`, which also names whom that member goes without, and `match`.
  This adds a writer to [decision 035](../../decisions/035-channels-declare-how-they-travel.md)'s session keys once step 8's decisions are numbered.
  Settled in node 6.7 by the user, 2026-10-16 ([the session's units](../session/02-units.md#session-keys)).
- **Because:** the simulation rate, the session's aircraft, and preflight's phase come only from the flying machine, the session's authority ([the connection](../product/03-v1-scope.md#the-connection)), and a key a follower could write would need each feature to check its writer; a Go without written in each member's own key loses no write when two pilots go without two members at once.
- **Leaves out:** nothing.

## The PF's core sets the session's aircraft and runs preflight, and its profile loader pins the newest bundle its cache holds

- **Decided:** the host's core writes `control` naming its pilot when the session starts; the PF's core writes the session's aircraft whenever its pilot is in a flight and the key holds none or, before preflight ends, another; runs the countdown, and ends preflight with a key every core follows; ends it at once when its aircraft is first in a flight with `A:SIM ON GROUND` at 0; and its profile loader writes, as a key of its own, the newest bundle its cache holds for that aircraft, which every other core loads by hash.
  The crew can't go without a PF who dropped out; before preflight ends with nobody in the flight, a PF who leaves the session passes control to the other member anyway, and one who only leaves the flight keeps it.
  Settled in node 6.7 by the user, 2026-10-16 ([the session's units](../session/02-units.md#preflight); [which bundle a session pins](../session/02-units.md#which-bundle-a-session-pins)).
- **Because:**
  - Every pilot in a session runs one release, so two caches differ only by when each core started, and the PF's choice settles it without the cores comparing caches.
  - A host who loaded the wrong aircraft reloads before preflight ends (user, 2026-10-16).
  - Two cores each running a countdown could end preflight apart, one before an un-ready reached it and one after.
  - A preflight with no PF could never end, since only the PF writes `preflight`.
- **Leaves out:** how the session crate tells which of several pilots in the flight is up to date for a pass, for the pick that brings larger crews.

## Active pause is set through the EFB app's call to the toolbar's `TOOLBAR_SET_ACTIVE_PAUSE`

- **Decided:** rate and pause has a part in the EFB app, which calls `Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE", on)` when the core asks, so a following machine takes the crew's active pause; the simulation rate is stepped with `K:SIM_RATE_INCR` and `K:SIM_RATE_DECR` toward the flying machine's.
  Settled in node 6.7 by the user, 2026-10-16 ([the session's units](../session/02-units.md#rate-and-pause)).
- **Because:** none of the SimConnect events we tried set active pause, `K:PAUSE_ON` raised the sim pause, and the toolbar's call, run through the inspector, worked from the toolbar's and the EFB's documents, with the EFB closed (user, 2026-10-16), and from neither the one cockpit panel nor mainUi ([environment log][p02]).
- **Leaves out:** whether our EFB app's own code can make the call, as the inspector made it in the EFB's document, which a case in the sim settles.

## Go to puts a joiner at the PF's stand, or on a runway while the PF's engines run

- **Decided:** the PF's core writes its departure airport and stand from its flight file's `[Departure]`, and whether any engine runs; Go to selects that stand while the PF's engines are off, and the first runway the world map lists for that airport while they run; it never names a stand the PF taxied to.
  Settled in node 6.7 by the user, 2026-10-16 ([the session's units](../session/02-units.md#go-to)).
- **Because:** catch-up writes each entry once at the PF's value, so it can't start an engine, whose start takes time (inference), and a runway start runs the engines (reported by the user, 2026-10-16); a joiner is moved to the PF anyway, so the stand matters only for where they load.
- **Leaves out:** how a gate's name in the world map's list matches the flight file's `GateName` and `GateNumber`, and whether the runway request takes a runway's ID or its place in the list, which cases in the sim settle.

## The match check compares an aircraft's package, where it's installed, and its manifest's version, and a streamed copy has none

- **Decided:** the match check reads an aircraft's version from its package's `manifest.json`, found under the sim's packages folder, and compares the package, whether it's in Community, Official, or streamed, and the version; a streamed copy against an installed one shows a warning that its version can't be read and asks both pilots to compare; a session in an aircraft with no published profile flies, with the missing profile shown as an error.
  Settled in node 6.7 by the user, 2026-10-16 ([the session's units](../session/02-units.md#the-match-check)).
- **Because:** on our development machine, none of 1,221 streamed packages had a `manifest.json`, the sim's `Content.xml` lists only names and activation, and the world map's aircraft list carried no version ([aircraft log](../aircraft/log.md#2026-10-16-a-streamed-package-keeps-no-version-on-disk-while-every-installed-one-with-a-manifest-has-its-package_version)).
- **Leaves out:** nothing.

## The core loads only bundles, which the profile builder builds with TypeScript 6.0.3 inside QuickJS-ng

- **Decided:** the core never builds a bundle: a published one comes from Pages, and an unpublished one from a local folder that the profile builder or the IDE wrote it into.
  An engine of its own, `profile-build`, type-checks and compiles with TypeScript 6.0.3's `typescript.js` inside QuickJS-ng through rquickjs, the same in CI, in the `crosscheck-profile-builder` program with its watch mode, and later in the IDE, which rebuilds on each save; the profile engine parses YAML with saphyr's tree and our own checker, and a bundle's hash is SHA-256.
  This changes [decision 021](../../decisions/021-profiles-and-plugins-apart-from-releases.md), whose core builds a local bundle itself, once step 8's decisions are numbered.
  Settled in node 6.8 by the user, 2026-10-16 ([the profiles' units](../profiles/02-units.md#the-builder)).
- **Because:**
  - A compiler in the core would ship to every pilot for the few who author, while a crewmate testing with an author can take the author's one bundle file instead of the sources (user, 2026-10-16).
  - The IDE carries a TypeScript anyway, for errors and completions as an author types, so the size of the one it carries counts: `typescript.js` is 1.2 MB under zstd, against 7.7 MB for tsgo 7.0.2's program, whose 7.0 has no stable programmatic API ([profiles log][pr02]; user, 2026-10-16).
  - It ran inside QuickJS-ng unmodified, with errors and output matching Node's byte for byte, and checked 300 write functions in about 0.9s with its load ([profiles log][pr02]).
  - A level's declarations and the one compile target are what a released core relies on, so moving the builder to TypeScript 7 later changes no released core (user, 2026-10-16).
  - saphyr makes a repeated key an error and carries a span on every node, and a field's level is a check serde can't express.
- **Leaves out:** the builder program's name and how authors get it, for [6.18](plan.md#618-the-build); the TypeScript the IDE's editor runs, for the IDE's design.

## CI publishes bundles from a branch it only adds to, at released levels, and the index lists the bundle each level takes

- **Decided:** CI's profiles job commits each new bundle and the index to a `pages` branch that Pages serves from a subdomain of ours, and never deletes a file there; it publishes only bundles at levels a release supports, and runs on each release too; it reads each bundle back against its level's frozen schema, and compiles every script at ES2020, and nothing holds the builder's bytes to a release tag; the index lists, for each profile, only the bundles some level takes, the newest at or below it.
  This answers the line 5.4 raised, and changes [decision 021](../../decisions/021-profiles-and-plugins-apart-from-releases.md), whose index lists every published bundle, once step 8's decisions are numbered.
  Settled in node 6.8 by the user, 2026-10-16 ([publishing](../profiles/02-units.md#publishing)).
- **Because:**
  - Pages publishes a branch's folder on each push, so a bundle stays as long as the branch keeps its file.
  - A level still on `main` can change before its release, so a bundle published at it could be kept for good under a schema its release doesn't hold.
  - Reading the bundle back checks the bytes a released loader reads, and one target keeps the syntax it parses fixed, without one cached builder per release.
  - Pages answered a repeat fetch of an unchanged file with a 304 and no body ([profiles log][pr01]), so an index fetched at each start costs headers when nothing changed, and an index of the bundles each level takes grows with profiles and levels, not merges.
  - A core that's never updated fetches from the address it shipped with, so the address is ours, to outlive a move off Pages (user, 2026-10-16).
- **Leaves out:** expiring superseded bundles, if the site nears its 1 GB.

## The profile loader parses a bundle in a job, and the recording keeps the decoded profile

- **Decided:** a job reads the pinned bundle, parses and checks it with the profile engine at the core's level, and hands up the checked profile encoded with postcard; the loop decodes it, finds the variant, and raises `ProfileLoaded`; the recording keeps the job's result, so a replay decodes the same profile with no file read, and a bug report carries a local bundle's text, since a published one stays on Pages.
  Settled in node 6.8 by the user, 2026-10-16 ([loading](../profiles/02-units.md#loading)).
- **Because:**
  - Our profiles carry seats, possibly hundreds on an airliner, and plugins of any length, so a bundle's size has no cap, and a parse on the loop would hold up every input behind it (user, 2026-10-16).
  - A replay runs no job, so a recording that kept only the hash would need the replay to fetch and parse, and a local bundle isn't on Pages to fetch (user, 2026-10-16).
- **Leaves out:** nothing.

## The catching-up machine asks for its catch-up, whose order each machine keeps in memory

- **Decided:** a following machine asks the flying machine for its catch-up whenever its profile loads after preflight has ended, when preflight ends with its profile loaded, when control passes to another pilot during it, and after a change of control drops a message it applied; each machine's sync engine keeps when its cockpit first took each of an entry's last 16 distinct values, and the flying machine's gives catch-up its order.
  This changes [decision 040](../../decisions/040-catch-up-first-final-value-order.md), which reads the order from the flying machine's recording, once step 8's decisions are numbered.
  Settled in node 6.9 by the user, 2026-10-16 ([the sync units](../sync/05-units.md#catch-up)).
- **Because:**
  - After a pass, only the catching-up machine knows that a catch-up was running.
  - A joiner's profile loads only once it's in the flight, and a pin that goes from none to a bundle after an airborne start finds cockpits that drifted while no profile was loaded, so one trigger covers both.
  - The recording holds the inputs, not when the cockpit took each value, so reading the order from it would mean running the sync engine over the run at each catch-up.
- **Leaves out:** nothing.

## State sync fires `H:` events from a routine in our WASM module, and hears them through one panel's own handler

- **Decided:** state sync's routine `HEvents` fires each name fed to it with `fsEventsRegisterHEvent` and `fsEventsHEventCall`; its panel module `h-events`, in the first panel asked about once a profile that watches an `H:` event loads, registers its own handler with `Coherent.on("OnInteractionEvent", …)`.
  This settles the spine's item on how the profile engine fires `H:` events ([left open](01-spine.md#left-open)).
  Settled in node 6.9 by the user, 2026-10-16 ([`H:` events](../sync/05-units.md#h-events)).
- **Because:**
  - The SDK documents that `fsEventsHEventCall` reaches `OnInteractionEvent` in every JavaScript VCockpit ([fsEventsHEventCall](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/wasm/event-api/fseventsheventcall/index.md)), and documents no SimConnect route to an `H:` event ([SimConnect_MapClientEventToSimEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_MapClientEventToSimEvent.htm)).
  - A handler beside the stock one blocks nothing, where wrapping each instrument's `onInteractionEvent`, as FS Copilot does, puts our code in the path of the pilot's input ([03-02](../../learn/foundations/03-02-events-and-other-namespaces.md#h-html-events)).
- **Leaves out:** whether `fsEventsHEventCall` reaches an instrument, with calculator code in the routine if not, and whether an event sent to one instrument reaches another document, which cases in the sim settle.

## The sync engine starts the bench from a pending write, one attempt checked within 1.5s, and steps it counts itself

- **Decided:** a value the engine writes is pending until a reading equals it, and a reading that equals no pending value is a pilot's change; a write gets one attempt, and one still pending 1.5s later is flagged; a stepping write counts from its own steps; a write function runs once for each value, and is checked whatever it wrote; an unused echo token lasts 1s; an event with one value or none goes by SimConnect's legacy call; the sim service hears a `K:` event through a group that never masks, at the highest priority; and the cockpit stream holds each state entry's newest value, which state sync withdraws when an arriving change beats it.
  Settled in node 6.9 by the user, 2026-10-16 ([the sync engine](../sync/05-units.md#the-sync-engine); [the cockpit stream](../sync/05-units.md#the-cockpit-stream)).
- **Because:**
  - Each pending value clears within 2 frames of a write that lands ([sync log](../sync/log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)), so a pilot turning a knob back is heard, where a rule that remembered written values for a time would swallow the turn.
  - The engine can't tell which entries read a computed readout, and 1.5s covers the slowest measured, the Fenix's battery lamp at 1.2s ([sync log](../sync/log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).
  - A stepping write that read a lagging value again would overshoot ([checking a write](../profiles/01-format-and-delivery.md#checking-a-write)).
  - The PMDG 777's module acted on a masked axis event sent by the legacy call and dropped it sent by `_EX1` ([flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)).
  - The held value lives in the stream because the press it goes out before is pointer sync's.
- **Leaves out:** retries, running a function again when an entry it read lands, a longer check for a computed readout, and stepping inside a routine, which the bench's cases decide.

## Our WASM module keeps the core's counter, and a routine of ours reads and stamps the flying aircraft

- **Decided:** on the flying machine, flight-model sync's routine `Lead` reads the aircraft's pose, velocities, surfaces, and toe brakes at each 50ms mark and reports each read, stamped with its frame's `Frame::now`; the routine host's `Frame::now` is WASI's monotonic clock plus the largest gap, since the module started, between the core's counter in a slot's header and that clock as the module read the header.
  This settles the spine's item on the module's clock: the module stamps on its own clock, carried onto the core's timeline by the module ([left open](01-spine.md#left-open)).
  Settled in node 6.10 by the user, 2026-10-17 ([flight-model sync](../flight-model/01-flight-model-sync.md#the-cores-counter-in-our-module)).
- **Because:**
  - A variable read through SimConnect and stamped as it arrived trailed its frame's slot by up to 2.90ms at the 99th percentile and once by 193ms ([architecture log][a1009]), 15m off the path at 150 kt.
  - WASI's monotonic clock counts `QueryPerformanceCounter`'s ticks, one constant offset fitting a flight's 1,476 echoes over 299s ([architecture log][a1009]), so one offset per run of the module holds.
  - `Follow` draws on the module's clock, so the following machine needs the samples on it whoever stamps them, and the core already writes every slot at least every 200ms.
- **Leaves out:** nothing; the bench measures how soon the offset settles.

## A flight-model sample carries its control's generation alone, and a receiver drops one under any other value

- **Decided:** a sample carries its control value's generation, and its PF is its sender; a following machine drops a sample whose sender and generation aren't the session's control, a newer one included, until the control key arrives.
  This changes [decision 036](../../decisions/036-control-is-one-value.md), under which every sample carries the whole value and a receiver adopts a newer one met on a sample, once step 8's decisions are numbered.
  Settled in node 6.10 by the user, 2026-10-17 ([taking a sample](../flight-model/01-flight-model-sync.md#taking-a-sample)).
- **Because:**
  - Only the flying machine sends samples, and the network hands each message to its handler with its sender's pilot ID ([channels and sends](../network/02-units.md#channels-and-sends)), so the 16 bytes of a pilot ID in every sample say nothing new.
  - Flight-model sync can't change control, which the session crate holds, and the next sample after the key replaces each one dropped.
- **Leaves out:** nothing.

## A following machine draws 400ms behind, carries through a gap for up to 2s, and eases back over 3s, and a paused flying machine repeats its last sample

- **Decided:** `Follow` draws the aircraft 400ms behind its samples, along straight lines between them; past the newest, it carries the position along the last two samples' line for up to 2s, then holds; it eases from what it last wrote to the drawn pose over 3s, and writes at once a correction of more than 1km; it starts by carrying its aircraft's own motion; a paused flying machine sends its last sample again every 50ms; and the following core moves the clock offset it applies by at most 5ms a second.
  This settles what [softening a short gap](../network/01-between-machines.md#softening-a-short-gap) and [clock offsets](../network/01-between-machines.md#clock-offsets) leave to flight-model sync: how far it carries, how it eases, how a pause reaches the following machine, and easing the offset, which [decision 038](../../decisions/038-clock-offset-from-timed-exchange.md) leaves to it too.
  Settled in node 6.10 by the user, 2026-10-17 ([the following machine](../flight-model/01-flight-model-sync.md#the-following-machine)).
- **Because:**
  - In the friends' runs of 2.3, samples later than 400ms came to 0.4% or less in all but one, at 1.6% ([softening a short gap](../network/01-between-machines.md#softening-a-short-gap)).
  - A dead direct path gives way to the relay 2s after it dies ([paths](../network/01-between-machines.md#paths)), and 2s of carrying strays about 8m in a standard-rate turn at 150 kt (arithmetic).
  - At a handover, the ex-PF's aircraft must fall 0.4s behind; carried and eased, it slows to about three-quarters of its speed for 3s, where held and written it would stop in the air for 0.4s and then jump back about 31m at 150 kt (arithmetic).
- **Leaves out:** the starting values, which the bench and friends' sessions tune, and a delay that follows the path.

## Pointer sync sends each gesture as it happens, and the panel bridge sends no span

- **Decided:** a gesture on a synced display goes to the crew as a down, its moves at most every 33ms once the pointer has moved 2px, a held message each second nothing else goes, and an up, each a cockpit message keyed by the display; each other machine's panel plays each as it arrives, and a long press plays for as long as it's held; the cockpit stream's gaps, on the core's counter, time a gesture in a replay.
  A gesture's down, moves, and held messages count as applied once handed to the display's panels, and its up once they're done with it, or after 1s; the catch-up that preflight's end starts plays the gestures queued behind its writes, and any other catch-up skips them.
  This settles the spine's item on which clock the panel bridge measures a span on: it sends none ([left open](01-spine.md#left-open)).
  It changes [03-v1-scope](../product/03-v1-scope.md#pointer-sync)'s pointer sync, which carries over FS Copilot's gesture sent whole at its release, with a hold capped at 1.5s, and leaves long presses out of v1 (user, 2026-10-17); and it changes [decision 042](../../decisions/042-vector-clock-records-what-applied.md), under which a press counts as applied once played through to its release and a receiver skips every press during its own catch-up, once step 8's decisions are numbered.
  Settled in node 6.11 by the user, 2026-10-17 ([a gesture](../pointer-sync/01-pointer-sync.md#a-gesture); [playing a gesture](../pointer-sync/01-pointer-sync.md#playing-a-gesture)).
- **Because:**
  - FS Copilot's record rejects live streaming for "More packets, more reordering risk, and no proven benefit", naming no mechanism (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, 4.7), and the cockpit stream carries every message in one causal order.
  - Sent whole, a gesture reaches the other display only after its release, a map pan its whole length late, while avatars' hand follows the drag from at most one mouse move every 16ms ([raw input](../core/04-core-helper.md#raw-input)).
  - Streamed, a switch flipped on hardware during a held press lands between the down and the up, as it happened.
  - Neither cockpit's displays were touched in preflight ([preflight](../product/03-v1-scope.md#preflight)), so the PF's first presses after it play on the same pages, where a late joiner's displays may show others.
- **Leaves out:** how a display takes the `mouseup` on the document that ends a gesture whose rest never came, which a case in the sim settles.

## A display takes no press while another pilot's gesture plays on it, and a machine other than the PF's locks its displays while it has no link up to the PF or is catching up

- **Decided:** from another pilot's down to their up, the bridge holds an unseen lock over the display, which the panel module renews at each of the gesture's messages and no message from the core renews, lapsing 2s after the last; a press that lands on it is dropped and paints it in one solid color, with no words, until that press's up, and a lock a blocked press is held on stays until that up; on a machine other than the PF's, every synced display locks, visibly, while this core has no link up to the PF and while its replay or its catch-up runs, and nothing locks in preflight; pointer sync asks for a lock only once its own pilot's gesture on that display has ended.
  This adds catch-up to the times [decision 037](../../decisions/037-while-a-link-is-lost.md) and [the replay](../sync/04-order-and-recovery.md#the-replay) lock a PM's displays.
  Settled in node 6.11 by the user, 2026-10-17 ([locks](../pointer-sync/01-pointer-sync.md#locks)).
- **Because:**
  - FS Copilot's veil over every held press and every drag it replayed covered the display just as its pilot watched it change, so it went silent (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "The replay interlock blocks silently; twelve seconds is where it speaks"), and a press that does nothing with no sign looks like a display ignoring its pilot.
  - Ending at the up, the flash reads as the press's own doing, and the other pilot's figure at the display says who's pressing, so it needs no words (user, 2026-10-17).
  - A catch-up other than preflight's skips the crew's gestures, so its pilot's presses would reach the crew's displays while theirs don't reach it.
  - The core sends a message to every panel at least every 2s, so a lock it renewed would outlive a module that failed partway.
  - A lock lifting under a held press would let its release act on a control behind it and go unsent.
- **Leaves out:** the look and words of the visible lock and the flash's color, for [6.16](plan.md#616-the-apps) and the build.

## The take-control input takes control on its down or held 1s, and a pass plays a cue and a notice with no recorded line

- **Decided:** a bound key or button takes control on its down, or, set as a long press, once held 1s, before its release, and has no default binding; a bound key counts only while a window of the sim is in front, and the desktop app asks the pilot to keep the input unbound in the sim; outside the flight or before preflight's end it does nothing; a press the guards refuse plays a refusal cue and shows each denial's reason; a press while the link to the PF is lost takes control at once and shows the warning after, the apps' buttons showing it before; and a pass plays the control-passed cue on every machine in the flight, with a notice naming the new PF and no recorded line.
  This changes [03-v1-scope](../product/03-v1-scope.md#take-control-key)'s take-control key, under which the new PF hears "you have control" and the old one "they have control" (user, 2026-10-17).
  Settled in node 6.12 by the user, 2026-10-17 ([take-control](../control/01-take-control.md)).
- **Because:**
  - The helper reads Raw Input whichever program is in front ([raw input](../core/04-core-helper.md#raw-input)), so without the rule on keys, a bound key typed in a chat would take control (user, 2026-10-17); nobody types on a yoke, so buttons need no such rule.
  - Crosscheck can't read the sim's own bindings, so it asks the pilot instead, and a Soon pick reads them if they can be read (user, 2026-10-17).
  - A long press keeps a brushed button from taking control.
  - A pilot pressing hardware in VR gets no other sign of a refusal before looking at the banner.
  - Good neutral voice lines are hard to come by, and the cue and the banner already mark the pass (user, 2026-10-17).
- **Leaves out:** the cues' sounds, which the build makes; and the notices' words, for [6.16](plan.md#616-the-apps).

## A pilot's own core works out their figure, and Figure draws every figure on arrival, each frame

- **Decided:** a pilot's own core takes their seat from the camera, casts each click's ray, and decides each hand's target and when it changes, the overlap of two hands on a yoke included, and sends the whole figure as a pose on avatars' channel at each change, at most every 33ms and at least every 1s; the pose carries the seat held, which no session key does.
  On every machine, `Figure` eases each part toward its newest target as it arrives, with no delay and no clock offset, places a hand on a yoke from that machine's own yoke, works out all 28 joints, and places each figure inside the frame, every frame.
  In the aircraft, the ray comes from `SimConnect_CameraGet`'s `SIMOBJECT` referential, and on foot from its `WORLD` referential.
  This changes [avatars' tentative decision on the ray](../avatars/decisions.md#the-ray-needs-no-calibration), which takes `WORLD` inside and out, and the seat claims [01-between-machines](../network/01-between-machines.md#channels) puts on the session channel.
  Settled in node 6.13 by the user, 2026-10-17 ([what runs where](../avatars/01-avatars.md#what-runs-where); [the pose](../avatars/01-avatars.md#the-pose)).
- **Because:**
  - Avatars is partly recorded, so it makes no request the platform decides, and every write of a session key is one ([unrecorded inputs](../recording/01-recording-and-bug-reports.md#unrecorded-inputs); [session keys](../session/02-units.md#session-keys)); no other unit reads a seat.
  - A following machine draws the yoke 0.4s behind a hand's point, so only that machine's own yoke keeps the hand on its horn ([avatars' tentative decisions](../avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)), and every core loads the models anyway for its own pilot's clicks.
  - The probes wrote every joint from outside the sim every 33ms while the module placed the figure's root inside the frame (read in `experiments/areas/avatars/p25-figure-hands.mjs`, `drive`), which is one candidate for the frame the figure missed now and then (unverified).
  - Drawn on arrival, a hand lands about its reach time after its switch moves, where a delay for smoothing the head would add to every hand.
  - `WORLD` in flight needs the aircraft's pose from the camera's own frame, one frame apart being 2.6m at 150 kt and 30 fps (arithmetic), while p25 cast from `SIMOBJECT` at up to 185 kt GS ([avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
- **Leaves out:** the hands' times, which the build's stage for avatars tunes in the 58P.

## Of the seats whose radius holds the camera, the one with the nearest eye takes it

- **Decided:** a camera takes a free seat when it's inside that seat's take radius, 0.4m unless the profile gives one, and that seat's eye is the nearest of every seat's; no check limits a radius, and of two pilots who take one seat within a trip, the PF keeps it, or else the lower pilot ID.
  This changes [avatar sync](../product/03-v1-scope.md#avatar-sync)'s note of 2026-10-17, under which the take radius stays under half the distance between two seats' eyes.
  Settled in node 6.13 by the user, 2026-10-17 ([a seat](../avatars/01-avatars.md#a-seat)).
- **Because:** the 58P's eyes sit 0.49m apart, so a radius under half that leaves a small seat, while the nearest eye draws a flat border halfway between two eyes whatever their radii, so an author can cover the whole left side of the 58P, and no author meets an error they wouldn't understand (user, 2026-10-17).
- **Leaves out:** nothing.

## The aircraft model is four engines of our own, on serde_json and quick-xml

- **Decided:** `msfs-gltf` reads an MSFS glTF on `serde_json`, `msfs-rpn` expands and runs an aircraft's calculator code, `ray-cast` builds a BVH for each mesh and casts through the nodes' transforms, and `aircraft-model` puts the three together with `quick-xml` 0.42 for the behavior XML; a job builds the model and hands it up as one flat buffer the loop reads in place.
  Settled in node 6.13 by the user, 2026-10-17 ([the aircraft model](../avatars/01-avatars.md#the-aircraft-model)).
- **Because:**
  - `gltf` 1.4.1 refuses the required `MSFT_texture_dds` unless a feature is on, and its typed readers end in `unreachable!()` on MSFS's signed-short texture coordinates; `roxmltree` refuses a template file the Comanche's cockpit includes; `bvh` 0.13 turns on rayon by default, and `obvhs` 0.4 reads `Instant::now()` in a builder; and no Rust crate runs MSFS's calculator code ([avatars log](../avatars/log.md#2026-10-17-the-58ps-models-need-no-gltf-compression-but-carry-msfss-own-vertex-layouts-and-no-rust-crate-reads-them-their-behavior-files-and-their-code-as-the-core-needs)).
  - Each of the three does one job its own tests check, and the crate graph shows that none depends on another.
- **Leaves out:** whether the loop takes the 58P's model within a handler's 1ms, which the bench measures.

## A located change brings the hand after 100ms, past its deadband, and never while a hand is out from a press

- **Decided:** on `CockpitSent` for an entry with a location, avatars reaches for it after 100ms unless another located change comes within that time, a hand is out from a press, or a number entry has moved less than its `deadband` since the hand last reached for it; `deadband` is a new optional field beside `location`, and a cockpit kind that changes an entry declares how to read the entry's number, which `CockpitSent` carries.
  This settles what [avatars' tentative decision](../avatars/decisions.md#a-click-or-a-change-at-a-controls-spot-brings-the-hand-and-on-foot-the-hand-touches-up-to-3m) leaves to 6.13 on one instant and on noise, and adds to [the sync units](../sync/05-units.md#sending)' `CockpitSent`.
  Settled in node 6.13 by the user, 2026-10-17 ([a change made without a click](../avatars/01-avatars.md#a-change-made-without-a-click)).
- **Because:** only the author knows an axis's units and travel, and a feature can't read another feature's types, so the kind gives the number.
- **Leaves out:** nothing.

[a1009]: log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[c04]: ../core/log.md#2026-10-15-every-sim-crash-our-aircraft-harness-saw-closed-simconnects-connection-with-no-quit-message-before-it
[c05]: ../core/log.md#2026-10-15-two-of-the-three-aircraftloaded-our-client-heard-around-a-flight-load-came-in-the-main-menu
[c06]: ../core/log.md#2026-10-15-the-sim-state-reads-1-in-the-main-menu-and-through-a-loads-screen-and-a-restart-sends-flight_end-inside-its-load
[c02]: ../core/log.md#2026-10-15-iroh-13-already-brings-tokio-websockets-into-the-core-so-serving-the-clients-with-it-keeps-the-core-at-one-websocket-implementation
[c03]: ../core/log.md#2026-10-15-the-sims-script-loader-holds-every-later-script-behind-one-that-never-loads-while-it-loads-one-at-a-time
[c01]: ../core/log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version
[a511]: log.md#2026-10-14-a-core-replays-a-whole-run-when-one-ordered-loop-owns-its-state-and-takes-every-input-stamped-through-one-queue-as-sans-io-cores-lmax-and-tigerbeetle-run-and-neither-actors-nor-simulation-runtimes-can-replay-a-run-from-a-pilots-pc
[n21]: ../network/log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[n22]: ../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[n23]: ../network/log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: ../network/log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
[p05]: ../network/log.md#2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
[p06]: ../network/log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
[p07]: ../network/log.md#2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
[nwin]: ../network/log.md#2026-10-16-iroh-relay-130-builds-and-runs-on-windows-and-in-dev-mode-answers-on-ipv6-loopback-only
[p10]: log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly
[lean]: log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour
[p02]: ../environment/log.md#2026-10-16-the-toolbars-toolbar_set_active_pause-called-from-the-toolbars-or-the-efbs-document-turns-active-pause-on-and-off-and-no-simconnect-event-we-tried-does
[pr01]: ../profiles/log.md#2026-10-16-github-pages-answers-a-repeat-fetch-of-an-unchanged-file-with-a-304-and-no-body-and-compresses-what-it-sends-when-asked
[pr02]: ../profiles/log.md#2026-10-16-typescript-603s-compiler-type-checks-and-compiles-inside-quickjs-ng-as-under-node-in-09s-for-300-write-functions-on-a-1-mb-stack
