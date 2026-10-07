# Architecture: the spine

```text
Purpose:     What every other part of Crosscheck rests on: its components, how they talk, the conventions they share, and its language.
Depends on:  decisions.md, ../product/plan.md (step 7), ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md
Decides:     What each component does with no session, and what moves it into one and back (node 1.1.2).
```

Each section answers one child of node 1 in the [architecture plan](plan.md), and the tentative decisions behind it, with their findings, are in [decisions.md](decisions.md).
The watcher and the core are the two processes in [step 7 of the product plan](../product/plan.md#7-tech-stack-and-architecture), and the core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)).
The flying and following machines are defined in [03-v1-scope](../product/03-v1-scope.md).
A pilot is in a session from starting or joining it until leaving it, or until 5 minutes cut off ([the connection](../product/03-v1-scope.md#the-connection)).

## Components with no session

With no session, each component does only what lets a session start, and nothing that serves one.
A pilot may fly the Baron every day and with a crew once a week, so on the other six days no profile loads, no plugin runs, and nothing watches the cockpit (user, 2026-10-07).
Each component has to be told to idle, because an app can do session work with nobody to fly with: FS Copilot's app connected to its relay and registered with its rendezvous server at launch, session or not (read in the FS Copilot fork, `FsCopilot/Program.cs`, `BuildAvaloniaApp`, and `FsCopilot/Network/RelayNetwork.cs` and `P2PNetwork.cs`, their constructors).
So the core tells every component below when a session starts.

| Component | With no session | In a session |
| --- | --- | --- |
| Watcher | Notices the sim's process starting and stopping, keeps the BlurPage copy current, applies plugins' changes to aircraft files before the sim boots, and starts the core | No different |
| Core | Holds its SimConnect connection and its masking group; follows the sim's system and flow events; serves its clients on 127.0.0.1 | Also brings up the network, loads the profile and plugins while the pilot's aircraft is loaded, watches the cockpit, records, runs the audio, and reads the take-control input |
| Desktop app | Optional; offers to start or join a session | Optional; shows the session |
| WASM module | Runs, and does nothing each frame | Places the figures, holds the aircraft in preflight, and on a following machine writes the aircraft |
| Panel bridge | Runs in every cockpit panel, loads no modules, and captures nothing | Runs pointer sync, and loads the modules that features and plugins name |
| EFB app | Offers to start a session or enter a code | Shows the session's controls |
| Toolbar script | Waits for the core | Opens the banner panel when the session has something to show |
| Banner panel | Closed, so it has no page | Shows the session's notices |
| Menu script | Answers the core when asked, and watches nothing | Reports which menu page is up, and runs Go to |

The watcher's duties are step 7's ([the product plan](../product/plan.md#7-tech-stack-and-architecture)), with the BlurPage copy from the [tentative decisions](decisions.md#the-watcher-keeps-the-blurpage-copy-current).
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

## Left to later nodes

- How the core tells the components in the sim that a session started, such as an idle socket in every panel or one `L:` variable they all read, and how the WASM module hears from the core every second, are node 1.2's.
- How each module tears itself down is the panel bridge's and the plugins' to design.
- Whether the toolbar script can open the banner outside a Build and Mount, at a flight load or mid-flight when a session starts then, is open: we've seen it open the panel only after Build and Mounts, two times in three ([03-v1-scope](../product/03-v1-scope.md#notification-banner)).
