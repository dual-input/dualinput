# Interface: the apps

```text
Purpose:     How the EFB app, the banner, and the desktop app connect to the core and to each feature, and what trouble in each component raises.
Depends on:  ../core/02-clients-and-panel-bridge.md, ../architecture/02-code-map.md, ../architecture/01-spine.md, ../session/02-units.md, log.md
Decides:     How a feature's part plugs into each app and comes out; what a part may use; the slices and commands the apps reach; how any client changes a setting; how the banner is opened; how a click on a notice reaches the EFB app; what trouble in each component raises; what the apps learn when the core goes; how Crosscheck is quit; and how the EFB app brings the desktop app forward (node 6.16).
```

A feature shows itself in each app through one part, which the app lists in one line, so deleting a feature deletes its folder and that line, and the platform's shells never name a feature.
The apps reach the core only through slices of state, commands, and a part's `unit` messages, and any client changes any setting with `clients`' one command.
The core says whether the banner should be open, and the EFB app's code sets the panel to that state until the banner's page answers.
Trouble the pilot can act on is a notice raised by the unit that sees it, and the rest goes to the log and the recording.

This answers node 6.16 of the [architecture plan](../architecture/plan.md#616-the-apps), narrowed by the user on 2026-10-17 to how the apps connect to the rest of Crosscheck: the apps' looks and words, which slices each shows, and their own code wait for the apps' stage, which [left to the apps' stage](#left-to-the-apps-stage) lists.
[02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s protocol, notices, and settings, the code map's [tiers](../architecture/02-code-map.md#tiers) and [workspace](../architecture/02-code-map.md#the-workspace), decisions [012](../../decisions/012-efb-app-opens-banner-panel.md), [014](../../decisions/014-apps-find-core-through-port-file.md), [016](../../decisions/016-core-keeps-pilots-settings.md), and [028](../../decisions/028-desktop-pages-react-vite-tailwind.md) to [030](../../decisions/030-in-sim-code-es2017-esbuild.md), and this area's [log](log.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| `efb-shell`, in TypeScript on the MSFS Avionics Framework | The EFB app's frame and the platform's screens in it, the banner's page, the part API in the EFB's document, and setting the banner's panel open or closed |
| `desktop-shell`, in TypeScript, React, and Tailwind | The desktop app's frame and the platform's screens in it, the part API in its pages, the components and theme parts share, and the settings drawn from their registrations |
| `apps/desktop` | Tauri's Rust side, which holds the WebSocket to the core, Vite's entry, and the list of the desktop app's parts |
| `sim-package/pages` | The EFB app's entry and the list of its parts, the banner's entry, the menu script, and the `VCockpit.js` override |
| `page-client` | Finding the core and the connection's state, for the EFB app, the banner, and the menu script ([page-client](../core/02-clients-and-panel-bridge.md#page-client)) |

The banner's page is `efb-shell`'s, since both of our pages in the sim draw on the same framework ([decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md)) and show the same notices.

## A feature's parts

```ts
// a sketch: rate and pause's part in the EFB app, features/rate-and-pause/efb/index.ts
export default definePart("rate-and-pause", {
  start(api) {
    api.on((body: PauseWanted) => Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE", body.on));   // the session's units
  },
});

// a sketch: take-control's part in the desktop app; the place's name is hypothetical
export default definePart("take-control", { views: { settings: BindingSection } });

// a sketch: the desktop app's list, in apps/desktop
export const parts = [takeControl, goTo, traffic];
```

- **A part** is one module in a feature's `efb/` or `desktop/` folder, named for its unit in the core.
  It has a `start` and a `stop` for code with no screen of its own, and views keyed by the places its app names.
- **Each app lists its parts**, one line each, as the core's `main` lists features ([what a feature registers](../architecture/02-code-map.md#what-a-feature-registers)): the desktop app's list is in `apps/desktop`, and the EFB app's in `sim-package/pages`.
  The shell starts each part when its app loads and stops it when the app goes, each call in a `try`, so a part that throws stops only itself, as a panel module does ([panel modules](../core/02-clients-and-panel-bridge.md#panel-modules)).
- **Each place** is a region of a screen the shell draws, where it shows every listed part's view for that place, in the list's order.
  Which places each app has, and where each sits, are the apps' design.
- **Deleting a feature** deletes its folder and its line in each list, and nothing else in either app, because no shell names a feature: the shells reach a feature's state only through the notices, the settings, and the match check's items, which carry every feature's alike.
  The map check holds it: beside the import rules, it fails a platform unit, in Rust or TypeScript, whose source names a feature's module of the message crate, since the message crate is an engine every unit may import ([the map check](../architecture/02-code-map.md#the-map-check)).
- **The EFB's document** also takes later code with no screen this way, such as the [EventBus bridge](../product/ideas.md#eventbus-bridge)'s listener, which has to run there ([code inside the sim](../product/04-room-for-later.md#code-inside-the-sim)).

v1's parts:

| Feature | EFB app | Desktop app |
| --- | --- | --- |
| Take-control | Its button ([take-control](../control/01-take-control.md#the-units)) | Its section, which binds the input |
| Rate and pause | Code with no screen, which sets active pause ([rate and pause](../session/02-units.md#rate-and-pause)) | None |
| Go to | None | Its section ([go to](../session/02-units.md#go-to)) |
| Traffic, ATC audio, and state sync | Wherever the apps' design shows their slices: traffic's packs, ATC audio's capture, and state sync's checklist | The same |
| Pointer sync, avatars, and flight-model sync | None | None |

## What a part reaches

- **The core:** a part gets `watch(slice)`, which gives a value its view updates from, `command(name, args)`, which answers "taken" or an error, and the `unit` messages it trades with its own unit by name.
  It gets nothing else of the protocol, and the two apps' APIs use the same names, while each gives a value in its framework's own form.
- **Shared code:** a part imports only from its app's shell and the message crate's TypeScript types ([tiers](../architecture/02-code-map.md#tiers)), so code that parts share lives in the shell, and nothing imports from `apps/`.
- **npm packages:** a feature's folder has no `package.json` of its own ([building every target](../architecture/02-code-map.md#building-every-target)), so a part's `react` resolves from the root's `node_modules`, where npm's workspaces install the desktop app's dependencies, and the app and its parts run one copy.
- **Vite** bundles a part because the app's list imports it, and its development server serves files within the workspace root it finds, a folder whose `package.json` has a `workspaces` field, as our root's has (documented, [Vite's `server.fs.allow`](https://vite.dev/config/server-options#server-fs-allow)), so `features/` is in reach.
- **Tailwind** builds the classes a desktop part uses, because the desktop app's stylesheet names `features/*/desktop/` with `@source` ([building every target](../architecture/02-code-map.md#building-every-target)); the theme's colors and spacing are the shell's, so every part draws from the same ones.
- **In the EFB app,** a part imports `efb-shell` and `@microsoft/msfs-sdk`, and esbuild bundles it at `es2017` from the list in `sim-package/pages` ([decision 030](../../decisions/030-in-sim-code-es2017-esbuild.md)).

## Slices and commands

Each unit registers its own slices and commands, named for it in the message crate, where their fields are settled at build, and a request's verdict rides in the slice of the unit that declares the request ([guards](../architecture/02-code-map.md#guards)).
These are v1's, with those this design adds marked:

| Unit | Its slice holds | Its commands |
| --- | --- | --- |
| `clients` | The notices; the settings, each with its value and what [settings](#settings) adds | Change a setting; a notice clicked outside its action; bring the desktop app forward (added) |
| `session` (added) | The members, with each one's name, `status`, `ready`, and `match`; control; preflight and its countdown; the invite code; the verdicts on Ready and on the "Share my traffic and ATC" switch; whether the banner should be open, and whether the banner's page is talking to the core | Host; Join, with a code; the code box selected; Leave; Ready and un-ready; Go without; the switch, which asks the kernel's request for every role key ([session keys](../session/02-units.md#session-keys)) |
| `sim-service` (added) | Sim awareness's stage, page, aircraft, pause, and how the last run ended, and the module's status ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status)) | None |
| `network` | Each member's link and path, and whether this PC reaches the internet ([02-units](../network/02-units.md#what-the-pilot-sees-and-settings)) | None |
| `core-helper-service` | The devices and programs ([the devices](../core/04-core-helper.md#the-devices)) | List them |
| `recording` (added) | The recorded runs from each run's index, with each one's size, whether it's uploaded, and which is in progress | Mark the moment; upload a session; delete a run, which refuses the run in progress |
| `cockpit-stream` | Whether a catch-up or a replay runs ([the sync units](../sync/05-units.md#ready-notices-marks-and-the-checklist)) | None |
| `state-sync` | The PF's checklist while preflight runs | None |
| `take-control` | Its `TakeControlView` ([taking control](../control/01-take-control.md#taking-control)) | Request; bind |
| `go-to` (added) | The PF's spot, whether Go to is available, and the step that failed | Go to |
| `traffic` (added) | This machine's traffic packs, after `LIST_PACKS` | `LIST_PACKS` ([traffic packs](../traffic-atc/01-traffic-and-atc.md#traffic-packs)) |
| `atc-audio` (added) | The program the core helper captures, or that it's waiting for one | None |

A pilot's quit isn't a command any app sends: [quit](#quit) has it come from the watcher's tray or from Windows.

## Settings

- Any client changes any setting with `clients`' one command, and which app offers which setting is the apps' design (user, 2026-10-17).
  This changes [decision 016](../../decisions/016-core-keeps-pilots-settings.md), whose EFB app offers no setting in v1, once step 8's decisions are numbered.
- A setting's registration carries, beside its key, type, and default ([02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), a label in its feature's words, as a notice's text is, and a kind, so an app shows any setting without its feature's code:
  - on or off;
  - a number in a range;
  - one of a list;
  - one of a slice's list, such as the output device from the core helper's;
  - text;
  - its feature's own, which only the feature's part shows, such as take-control's input, which its section writes after Bind.
- A development setting, such as the relays-only switch ([02-units](../network/02-units.md#what-the-pilot-sees-and-settings)) or the setting that records everything ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)), shows in no app, and a developer edits `settings.json` while the core is stopped.
- The display name is a setting like any other: Host and Join answer that a name is needed while it's empty ([members](../session/02-units.md#members)), and the app the pilot is using writes it.
- So avatars' and traffic's settings, ATC audio's, the profile loader's local folder, and the output device need no part.

## Notices

- A click on a notice outside its action sends `clients`' command with the notice's ID, and `clients` sends the EFB app the order that opens the EFB onto our app ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol)), naming the unit whose ID the notice carries, so the EFB app can open at that unit's part.
  Every link ends at the core ([decision 008](../../decisions/008-every-link-ends-at-core.md)), so the banner never reaches the EFB app itself.
- A feature reaches the banner only through a notice: the banner watches the notices and the platform's slices, and never a feature's slice.

## The banner

- The session's slice says whether the banner should be open, and whether the banner's page is talking to the core, which `clients` knows from the page's messages ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol)).
  The rule for when it should be open is the apps' design.
- The EFB app's code calls `TOOLBAR_BUTTON_TOGGLE` with the wanted state, which opened and closed our panel from the EFB's document (measured on MSFS 2024, 2026-10-04, [log](log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), when the wanted state changes, and again every 2s while the two differ.
  A closed panel's page is destroyed, and its socket stays open (same log, [2026-10-08][coverage]), so a closed banner shows as its messages stop, and the core closes its socket 8s later.
- Calling again covers a flight load, the time before Ready to fly, and a second flight load in one run of the sim, where no run has had our code open the panel ([decision 012](../../decisions/012-efb-app-opens-banner-panel.md)): the panel opens on the first call the sim takes, and [the cases in the sim](#cases-for-the-bench) measure how long that takes.
- The EFB app's code runs from the sim's start, in the menu and in flights ([log](log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), so it's there whenever the core wants the banner open.

## Trouble

| Component | Trouble | Who sees it | It raises |
| --- | --- | --- | --- |
| The core | No core heard, a `bye`, 8s silent, or its socket closed | Each app, through [the connection's state](#when-the-core-goes), and the panel bridge, whose visible locks turn into warnings ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)) | Nothing the core can send |
| The core helper | Down, a want it can't carry out, or a picked device missing | The core helper's service | Its notices ([the helper's life](../core/04-core-helper.md#the-helpers-life)) |
| Our WASM module | Missing, from another build, or stopped while a feature feeds a routine | The sim service | A trouble notice naming the features whose routines it feeds, cleared when the module runs or no routine is fed |
| The panel bridge | No cockpit panel's `hello` within 10s of the profile loading | `clients` | A trouble notice naming the features with panel modules, cleared when a panel connects or the profile unloads |
| The menu script | Not connected | The sim service | Go to's slice says Go to is unavailable ([go to](../session/02-units.md#go-to)) |
| The EFB app, the banner, and a page from another version | Not connected, or its version or hash differs | `clients` | The log alone, since the EFB app and the banner are where a notice would show, and every component updates together ([a client whose version differs](../core/02-clients-and-panel-bridge.md#a-client-whose-version-differs)) |
| The network | A refused connection, an endpoint that failed to bind, or a refused join | The network and the session crate | Their notices ([02-units](../network/02-units.md)) |

- The sim service watches the module while a feature feeds a routine, rather than in a session, because it sits below the session crate and can't read it; in v1 a routine is fed only in a session.
- With no bridge, v1's panel modules stop: pointer sync's, and state sync's `h-events` and `instrument-reads`.
  The core keeps a panel for `h-events` in every session with a profile ([the sim's pages](../architecture/01-spine.md#the-sims-pages)), so 10s with no panel is trouble.
- Another package's `VCockpit.js` override, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) shows as a conflict, is the likeliest cause of a bridge that never connects, and the check that names it is [6.17](../architecture/plan.md#617-installing-and-updating)'s.

## When the core goes

- `page-client` gives its page, and the desktop app's Rust side gives its pages, the connection's state: no core heard, connected, quit after a `bye`, silent for 8s with the socket kept, or closed without a `bye`.
  What each app shows for each is the apps' design.
- The desktop app reads the port file again after a close, and starts the core when the file names no running core ([decision 014](../../decisions/014-apps-find-core-through-port-file.md)), unless a `bye` came, since a `bye` means the pilot quit.
  The watcher also starts a core that exits while the sim runs ([decision 002](../../decisions/002-core-starts-with-every-sim-run.md)), and of two cores started at once, the second finds the first running and exits ([finding the core](../architecture/01-spine.md#finding-the-core)).

## Quit

The desktop app offers no quit: Leave session leaves a session, and a pilot quits Crosscheck from the watcher's tray, which [6.17](../architecture/plan.md#617-installing-and-updating) designs, or Windows ends the pilot's session ([quitting](../core/01-loop-and-edge.md#quitting)).
A quit from the desktop app would end a core the watcher starts again while the sim runs, while the tray belongs to the program that starts it.

## Bringing the desktop app forward

- The EFB app's button sends `clients`' command; with a desktop app connected, `clients` sends it a `unit` message, and its Rust side raises its window; with none, the core starts the desktop app's program, which 6.17 puts beside the core.
- Windows lets a program bring its window to the front only on conditions such as being the foreground process or having received the last input, and otherwise "flashes the taskbar button" (documented, [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)).
  The pilot pressed the button in the sim, so the sim holds the foreground, and whether the window comes forward or only flashes is unverified; [a case in the sim](#cases-for-the-bench) settles it.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The banner's panel reaching the wanted state, outside a load | Within 2s of the session's slice changing |
| The desktop app after a core restart | Connected again within 2s of the new port file |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with the stand-in sim:

- A part whose `start` throws leaves the app's other parts running.
- Deleting a feature's folder and its line in each list leaves both apps building, and the map check fails a shell that names a feature's module of the message crate.
- A setting changed from the EFB app's socket changes, and the desktop app's settings slice shows the new value.
- A notice clicked outside its action reaches the EFB app as the order that names the notice's unit.
- The session's slice wants the banner open, and the stand-in's toolbar call fails twice: the EFB app's code calls again every 2s until the banner's page connects.
- The core killed while the desktop app is open: the desktop app starts it and connects within 2s of the new port file; after a `bye`, it starts none.
- No cockpit panel connects within 10s of the profile loading: `clients`' trouble notice, cleared when a panel connects.
- A module from another build while `Hold` is fed: the sim service's trouble notice.
- With a desktop app connected, the EFB app's button sends it the `unit` message; with none, the core starts its program.

In the sim:

- The EFB app's code opens the banner during a flight load, before Ready to fly, and after a second flight load in one run, and how long each takes.
- `TOOLBAR_BUTTON_TOGGLE` with the panel already in the wanted state: whether it reloads or moves the panel, which decides whether the EFB app's code calls only while the two states differ, as above.
- The EFB app's button with the sim in front: whether the desktop app's window comes forward, or only flashes in the taskbar.

## Left to the apps' stage

The user narrowed this node to the apps' connections on 2026-10-17, so these wait for the apps' stage of step 8.

The apps' design:

- Where each notice shows, by its level, how long it stays, and how notices come and go.
- Which slices each app's frame shows, and how the status list looks ([01-between-machines](../network/01-between-machines.md#left-open)).
- The places each app names for parts' views, and where each sits.
- When the banner should be open, where it sits on screen, whether clicks through its empty part reach the cockpit, and how it shows in VR ([notification banner](../product/03-v1-scope.md#notification-banner)).
- What each app shows for each state of the connection, and after a `bye` against a close without one.
- Where in the EFB app a click on a notice lands.
- Which app offers which setting, and where Crosscheck asks for the display name.
- Whether the desktop app's take-control button hides outside the flight, as the EFB app's does ([taking control](../control/01-take-control.md#taking-control)).
- The traffic packs page, and whether it shows the crew's lists beside this machine's, which are the user's ([traffic packs](../traffic-atc/01-traffic-and-atc.md#traffic-packs)).
- The recordings list, and the report page ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)).
- The visible lock's look and words, and the blocked press's flash, red-orange at about 60% opacity as a start ([locks](../pointer-sync/01-pointer-sync.md#locks)).
- The words of every notice, verdict, and warning the earlier nodes raised: the core helper's; the network's; the session's, the pause menu's, and Go to's; the recording's; state sync's, with its Ready reason and its `instrument()` notice ([plugins and the sandbox](../plugins/01-plugins.md#its-values)); take-control's; avatars'; and traffic's two.
- The match check's wording, the streamed copy's warning among it, and how the profile item's hash shows ([the profiles' units](../profiles/02-units.md#the-match-checks-item)).

The apps' own code:

- Whether the EFB app draws with our pinned copy of the MSFS Avionics Framework or the sim's own, and which version we pin, which [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) leaves to this stage; p08's EFB app rebuilt against a bundled copy settles the first.
- The desktop app's WebSocket library, which sends no `Origin` or `coui://html_ui` ([decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md)); its Rust side sends `alive`, since a hidden window's timers may run slowly (unverified).
- Whether the desktop app's pages and its Rust side trade text through Tauri's commands, events, or channels, and whether tauri-specta types the calls ([messages and their types](../architecture/01-spine.md#messages-and-their-types)).
- How an EFB part styles itself, and the banner's panel name, which joins [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares).

No v1 page sends a span, so the spine's item on the clock a page measures one on closes for v1 ([01-spine](../architecture/01-spine.md#left-open)).

## What this changes elsewhere

The notes at the top of [the code map](../architecture/02-code-map.md), [the spine](../architecture/01-spine.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the session's units](../session/02-units.md), [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md), [traffic and ATC](../traffic-atc/01-traffic-and-atc.md), [01-between-machines](../network/01-between-machines.md), and [03-v1-scope](../product/03-v1-scope.md) list what this design changes there, and the [tentative decisions](../architecture/decisions.md#a-feature-shows-itself-in-each-app-through-one-part-the-app-lists-and-no-shell-names-a-feature) give the reasons.

[coverage]: log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel
