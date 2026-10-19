# 002: The core starts with every sim run

The watcher starts Dual Input's core whenever the sim starts, and again if the core exits while the sim runs, and the desktop app starts it when the pilot opens the app and the core isn't running.
No code in the sim, such as a panel or the EFB app, starts the core.
Decided by the user on 2026-10-07 and 2026-10-08, in nodes 1.1 and 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-starts-with-every-sim-run).

## Context

The core owns the session, SimConnect, and the network ([01-spine](../areas/architecture/01-spine.md#components)), so something has to start it, and when it starts decides what it can do:

- **Masking.** A mask registered before the A2A PA-24 loaded got ahead of the aircraft's own, and one registered after it loaded didn't (measured on MSFS 2024, 2026-10-01, [flight-controls log](../areas/flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
  Soft takeover and mixed flight controls, both Soon picks, need that place on such aircraft ([04-room-for-later](../areas/product/04-room-for-later.md#an-input-layer)).
- **A crash mid-flight.** A core that exits stays down until something starts it again.
- **A host before the sim.** A host can start a session, and a pilot can enter a code, before the sim runs ([invite code](../areas/product/03-v1-scope.md#invite-code)).

## Options

1. **Start the core when the pilot starts or joins a session,** from the desktop app or from code in the sim.
   Code in the sim reaches a program on the PC only if that program is already listening on 127.0.0.1 ([interface log](../areas/interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)), and we found no way for a panel to start one (unverified).
   A start button in the EFB app would need the watcher to listen and start the core, which is more than the watcher should do (user, 2026-10-07).
   A core started after the flight loads couldn't take its masking priority ahead of an aircraft like the PA-24.
2. **Have a program the sim launches from `exe.xml` start the core.**
   The watcher already takes the jobs of such a program (user, 2026-10-06), where the Microsoft Store install keeps `exe.xml` is unverified, and ChasePlane's bridge started 79s and 102s after two sim starts (read and observed on our development machine, 2026-10-04, [installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
3. **Have the watcher start the core with every sim run and restart it if it exits, with the desktop app starting it too.**
   The core then runs through every sim run, session or not, so it has to cost little while idle: a Rust program showing only a tray icon took 1.0 MB of private working set and no measurable CPU (measured on our development machine, 2026-10-08, [architecture log](../areas/architecture/log.md#2026-10-08-a-tray-icon-alone-costs-10-mb-of-memory-in-rust-16-mb-in-net-native-aot-51-mb-in-winforms-and-397-mb-over-three-processes-in-electron)), while an idle core holding its SimConnect connection and its listener is unmeasured.

## Decision

Option 3.
The watcher starts with Windows and notices the sim's process starting ([01-spine](../areas/architecture/01-spine.md#components)), so it starts the core early enough to take its masking priority as soon as SimConnect answers.
A group that took its priority that way, held open by an event it only listened to, masked the PA-24's elevator ahead of Accu-Sim once the axis was added after the flight loaded, and held nothing back until then, and SimConnect answered before the main menu loaded its aircraft (measured on MSFS 2024, 2026-10-07, [flight-controls log](../areas/flight-controls/log.md#2026-10-07-a-group-that-takes-its-priority-as-the-sim-starts-held-open-by-an-event-it-only-listens-to-masks-ahead-of-accu-sim-once-it-adds-the-axis)).
The restart covers a crash, and the desktop app covers a host who starts a session before the sim.

## What it commits us to

- With no session, the core does only what lets a session start: it holds its SimConnect connection and its masking group, brings its cache of profile bundles up to date as it starts ([decision 021](021-profiles-and-plugins-apart-from-releases.md)), follows the sim's events, and serves its clients ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
- The core exits once the sim has closed, no session is held, and the desktop app isn't open ([01-spine](../areas/architecture/01-spine.md#what-moves-them)).
- A core the watcher restarts mid-session brings its pilot back as a late joiner ([decision 041](041-core-crash-comes-back-as-late-joiner.md)).
- A pilot who has quit the watcher or turned it off, which [installing and updating](../areas/product/03-v1-scope.md#installing-and-updating) allows, has no core with the sim until they open the desktop app.
