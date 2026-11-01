# Interface: the apps

```text
Purpose:     How the EFB app, the banner, and the desktop app connect to the core and to each feature, and what trouble in each component raises.
Depends on:  ../core/02-clients-and-panel-bridge.md, ../architecture/02-code-map.md, ../architecture/01-spine.md, ../session/02-units.md, log.md
Decides:     How a feature's part plugs into each app and comes out; what a part may use; the slices and commands the apps need that no unit had; how any client changes a setting and quits; when and how the banner is opened and closed; how a click on a notification reaches the EFB app; what trouble in each component raises; what the apps learn when the core goes; and how the EFB app brings the desktop app forward (node 6.16).
```

> **Note**
> Stage 11b's [tentative decisions](decisions.md) change this design until the apps' design rewrites it (user, 2026-10-25):
>
> - Every screen a pilot uses Dual Input through is in the EFB app, and the desktop app's window shows only its own: the update's progress and the last 24 hours of CPU and memory use ([Dual Input's one full window](decisions.md#dual-inputs-one-full-window-is-its-efb-app)).
>   So take-control's binding and Go to are the EFB app's parts, and no feature has a part in the desktop app.
> - `efb-shell` and `desktop-shell` draw with one kit of React components styled with Tailwind 3, not Tailwind 4 ([the kit](decisions.md#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3)), so [what a part reaches](#what-a-part-reaches) says nothing of Vite or a Tailwind `@source` for a feature's `desktop/` folder, and a part in the EFB app imports React and the kit, not the MSFS Avionics Framework.
> - The EFB app bundles React, and [touches the framework only to register](decisions.md#the-efb-app-touches-the-framework-only-to-register-through-the-efbs-own-copy), through the EFB's own copy, which settles [left to the apps' stage](#left-to-the-apps-stage)'s question of which copy it draws with.
> - The banner's page draws its notifications and a few lines, such as the preflight countdown and a hint to open the EFB app, in plain markup with the kit's colors and no framework, so it isn't `efb-shell`'s, and [the banner](#the-banner) shows no part's view and no checklist ([the banner's decision](decisions.md#the-banner-draws-its-few-lines-in-plain-markup-with-the-kits-colors-and-no-framework)).
> - The EFB app has no button that brings the desktop app forward, so [bringing the desktop app forward](#bringing-the-desktop-app-forward), its budget, and its cases go.
> - An open desktop app window keeps no core running, so [when the core goes](#when-the-core-goes) no longer has the desktop app want a core while its window is open.
> - The EFB app shows an update and asks for Install now, in place of [slices and commands](#slices-and-commands)' desktop app window, over [a fixed local port](decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port) that no core carries.
> - [Quit](#quit) lives only in the tray, and `recording`'s command that marks the moment has no sender ([mark the moment](decisions.md#mark-the-moment-leaves-the-efb-app)).
> - [Notifications](#notifications)' order that opens the EFB carries where to land ([a notification's click](decisions.md#a-notifications-click-opens-the-efb-app-where-its-explained-or-acted-on)), and a one-time notification stays 6s ([the banner's box](decisions.md#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right)).
> - [Trouble](#trouble)'s row for a page from another version changes for the EFB app, which shows setup's "Add-on version mismatch" box ([without the service](decisions.md#without-the-service-the-efb-app-shows-one-of-three-screens-and-another-version-shows-setups-box)), and its row for our package keeps only a module file missing from a package that otherwise loaded.
> - The panel bridge's check warns falsely in an aircraft with no cockpit panels, so it needs to know the aircraft has panels ([the banner's content](decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on)).
> - The rest of [left to the apps' stage](#left-to-the-apps-stage)'s design list is settled in [the tentative decisions](decisions.md) and the frames they name, but for the desktop app's own screens.

A feature shows itself in each app through one part, which the app lists in one line, so deleting a feature deletes its folder and that line, and the platform's shells never name a feature.
The apps reach the core only through slices of state, commands, and a part's `unit` messages, and any client sends any command, a setting's change and a quit among them.
In each flight of a session, the EFB app's code opens the banner, calling the toolbar again until the banner's page connects, and the page shows and hides its own content while the panel stays open.
Trouble that costs the pilot a feature raises a notification from the unit that sees it, and the rest goes to the log and the recording.

This answers node 6.16 of the [architecture plan](../architecture/plan.md#616-the-apps), narrowed by the user on 2026-10-17 to how the apps connect to the rest of Dual Input: the apps' looks and words, which slices each shows, and their own code wait for the apps' stage, which [left to the apps' stage](#left-to-the-apps-stage) lists.
[02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s protocol, notifications, and settings, the code map's [tiers](../architecture/02-code-map.md#tiers) and [workspace](../architecture/02-code-map.md#the-workspace), decisions [012](../../decisions/012-efb-app-opens-banner-panel.md), [014](../../decisions/014-apps-find-core-through-port-file.md), [016](../../decisions/016-core-keeps-pilots-settings.md), and [028](../../decisions/028-desktop-pages-react-vite-tailwind.md) to [030](../../decisions/030-in-sim-code-es2017-esbuild.md), and this area's [log](log.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| `efb-shell`, in TypeScript on the MSFS Avionics Framework | The EFB app's frame and the platform's screens in it, the banner's page, the part API in both, and calling the toolbar for the banner's panel |
| `desktop-shell`, in TypeScript, React, and Tailwind | The desktop app's frame and the platform's screens in it, the part API in its pages, the components and theme parts share, and the settings drawn from their registrations |
| `src/apps/desktop` | Tauri's Rust side, which holds the WebSocket to the core, Vite's entry, and the list of the desktop app's parts |
| `src/sim-package/pages` | The EFB app's entry and the list of its parts, the banner's entry, the menu script, and the `VCockpit.js` override |

The banner's page is `efb-shell`'s, since our two pages in the sim draw on the same framework ([decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md)) and show the same notifications.

## A feature's parts

```ts
// a sketch: rate and pause's part in the EFB app, src/features/rate-and-pause/efb/index.ts
export default definePart("rate-and-pause", {
  start(api) {
    api.on((body: PauseWanted) => Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE", body.on));   // the session's units
  },
});

// a sketch: take-control's part in the desktop app; the place's name is hypothetical
export default definePart("take-control", { views: { settings: BindingSection } });

// a sketch: the desktop app's list, in src/apps/desktop
export const parts = [takeControl, goTo, traffic];
```

- **A part** is one module in a feature's `efb/` or `desktop/` folder, named for its unit in the core.
  It has a `start` and a `stop` for code with no screen of its own, and views keyed by the places its app names.
- **Each app lists its parts**, one line each, as the core's `main` lists features ([what a feature registers](../architecture/02-code-map.md#what-a-feature-registers)): the desktop app's list is in `src/apps/desktop`, and the EFB app's in `src/sim-package/pages`.
  The shell starts each part when its app loads and stops it when the app goes, each call in a `try`, so a part that throws stops only itself, as the panel bridge runs its modules ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)).
- **Each place** is a region of a screen the shell draws, where it shows every listed part's view for that place, in the list's order.
  Which places each app has, and where each sits, are the apps' design.
  The banner's page shows the EFB app's parts' views for places of its own, while their code with no screen runs only in the EFB app, so state sync's checklist can sit beside the preflight summary if the design puts it there ([the sync units](../sync/05-units.md#ready-notifications-log-lines-and-the-checklist)).
- **Deleting a feature** deletes its folder and its line in each list, and nothing else in either app, because no shell names a feature: the shells reach a feature's state only through the notifications, the settings, the match check's differences, and the role keys' labels, which carry every feature's alike.
  The map check gains a rule to hold it: it fails a platform unit, in Rust or TypeScript, whose source names a feature's module of the message crate, which the import rules let through, since the message crate is an engine every unit may import.

v1's parts:

| Feature | EFB app | Desktop app |
| --- | --- | --- |
| Take-control | Its button ([take-control](../control/01-take-control.md#the-units)) | Its section, which binds the input |
| Rate and pause | Code with no screen, which sets active pause ([rate and pause](../session/02-units.md#rate-and-pause)) | None |
| Go to | None | Its section ([go to](../session/02-units.md#go-to)) |
| Pointer sync, avatars, and flight-model sync | None | None |

Traffic, ATC audio, and state sync have parts wherever the apps' design shows their slices: traffic's packs, ATC audio's capture, and state sync's checklist.

## What a part reaches

- **The core:** a part gets `watch(slice)`, a value that updates as the slice changes, `command(name, args)`, which answers "taken" or an error, and the `unit` messages it trades with its own unit by name.
  It gets nothing else of the protocol, and the two apps' APIs use the same names, while each gives a value in its framework's own form.
- **Shared code:** a part imports only from its app's shell and the message crate's TypeScript types ([tiers](../architecture/02-code-map.md#tiers)), so code that parts share lives in the shell.
- **npm packages:** a feature's folder has no `package.json` of its own ([building every target](../architecture/02-code-map.md#building-every-target)), so a part's `react` resolves from the root's `node_modules`, where npm's default strategy installs a package that isn't duplicated (documented, [npm's `install-strategy`](https://docs.npmjs.com/cli/v11/using-npm/config)); the app and its parts run one copy unless another workspace pins a second version.
- **Vite** bundles a part because the app's list imports it, and its development server serves files within the workspace root it finds, a folder whose `package.json` has a `workspaces` field (documented, [Vite's `server.fs.allow`](https://vite.dev/config/server-options#server-fs-allow)), as our root's will, since the code map gives it two npm workspaces; the first build of the desktop app checks that `src/features/` is in reach.
- **Tailwind** builds a desktop part's classes from the `@source` that names `src/features/*/desktop/` ([building every target](../architecture/02-code-map.md#building-every-target)), and the theme's colors and spacing are the shell's.
- **In the EFB app,** a part imports `efb-shell` and the MSFS Avionics Framework, whose copy is the apps' stage's to settle ([decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md)).

## Slices and commands

Each unit registers its own slices and commands, named for it in the message crate ([what a feature registers](../architecture/02-code-map.md#what-a-feature-registers)).
These are the ones the apps need that no unit had:

| Unit | Its slice adds | Its commands add |
| --- | --- | --- |
| `clients` | Whether a banner page's socket is open | A notification clicked outside its action; bring the desktop app forward |
| `session` | The members, with each one's name, `status`, and `ready`; control; preflight and its countdown; the invite code; the match check's differences, each with its level and its owner's words; the verdicts on Ready and on the "Share my traffic and ATC" switch; and the role keys this pilot can claim, each with its label | The switch, which asks the kernel's request for every role key ([session keys](../session/02-units.md#session-keys)) |
| `sim-service` | Sim awareness's stage, page, aircraft, pause, and how the last run ended, and the module's status ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status)) | None |
| `recording` | The recorded runs, by their folders' names, which are their starts in UTC, with each one's size and which is in progress | Mark the moment, which writes a line to the run's log; delete a run, which refuses the run in progress |
| `go-to` | The PF's spot, whether Go to is available, and the step that failed | None beyond Go to |
| `traffic` | This machine's traffic packs, after `LIST_PACKS` | None beyond `LIST_PACKS` |
| `atc-audio` | The program the core helper captures, or that it's waiting for one | None |

- `recording`'s slice reads the runs' folders, since v1 writes no index (user, 2026-10-23; [recording log][recording 23]), and it says nothing of uploads, since v1 uploads no bug report: the command to upload a session comes after v1 (user, 2026-10-21; [recording log][recording 21]).
- A match item names its words as it names its level ([the match check](../session/02-units.md#the-match-check)), and a role key registers a label in its feature's words, so the shells show both without naming a feature.
- The network's, the core helper service's, the cockpit stream's, state sync's, and take-control's slices are their own designs' ([02-units](../network/02-units.md#what-the-pilot-sees-and-settings), [the devices](../core/04-core-helper.md#the-devices), [the sync units](../sync/05-units.md#catch-up), [taking control](../control/01-take-control.md#taking-control)).
- The update's state, Install now, and Check now are the desktop app's own, in its window, so they're no unit's slice or command ([updates](../install/01-installing-and-updating.md#updates)).

## Settings

- Any client changes any setting with `clients`' one command, and which app offers which setting is the apps' design (user, 2026-10-17).
  This changes [decision 016](../../decisions/016-core-keeps-pilots-settings.md), whose EFB app offers no setting in v1, once step 8's decisions are numbered.
- A setting registers, beside its key, type, and default ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), a label in its feature's words, as a notification's text is, and what an app needs that the type doesn't say: a number's range, a list's choices or the slice that lists them, such as the output devices, and whether only its feature's part shows it, as take-control's input, which its section writes after Bind.
  So avatars' settings, and traffic's and ATC audio's, need no part.
- A development setting says so when it registers, and shows in no app: a developer edits `settings.json` while the core is stopped.
- The profile loader's local folder is a development setting, since v1 ships no authoring tool ([the local folder](../profiles/02-units.md#the-local-folder); user, 2026-10-18).
- No setting records everything, since the core records every input (user, 2026-10-21; [recording log][recording 21]).
- The display name is a setting like any other, which Host and Join need ([members](../session/02-units.md#members)).

## Quit

Quit is the session crate's command ([joining and leaving](../session/02-units.md#joining-and-leaving)), so any client may send it, and which app offers it is the apps' design.
The desktop app runs from login as a tray icon, and its tray's Quit sends it too ([one program from login](../install/01-installing-and-updating.md#one-program-from-login)).

## Notifications

A click on a notification outside its action sends `clients`' command with the notification's ID, and `clients` sends the EFB app the order that opens the EFB onto our app ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol)).
What the order carries for where in the EFB app it lands waits with that choice, in the apps' design.
A notification's unit can clear it while the pilot's click is on its way, and the click still opens the EFB, since the pilot asked to look.
An app that hides a notification after a time pauses that time while the pointer is over it, so the notification stays as the pilot reaches for it, and how long the time is waits for the apps' design (user, 2026-10-24; [log](log.md#2026-10-24-the-apps-wiring-calls-notices-notifications-gives-the-banners-socket-a-slice-of-its-own-and-passes-a-development-cores-data-folder-to-the-desktop-app)).

## The banner

- The banner's panel stays open through each flight of a session, and its page shows and hides its notifications and the preflight summary itself, from the slices it watches, as our panel's page did with CSS (measured on MSFS 2024, 2026-10-04, [log](log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), so no slice says whether it should be open (user, 2026-10-18).
- `clients`' slice says whether a banner page's socket is open, which `clients` closes 8s after the page's last message ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol)).
- In each flight of a session, the EFB app's code opens the panel, calling `TOOLBAR_BUTTON_TOGGLE` again after a wait until a banner page's socket opens.
  A pilot who closes it from its toolbar button keeps it closed until the next flight.
- The EFB app's code closes the panel once, with no retry, when the session ends or the core says `bye`, since the core says nothing more after either.
- The call opened and closed our panel from the EFB's document (measured on MSFS 2024, 2026-10-04 and 2026-10-09, [log](log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)), and each measured call asked for the opposite of the panel's state, so whether it sets the state it's given or toggles is unverified, and [the cases in the sim](#cases-for-the-bench) set how long the code waits before calling again.
- A closed panel's page is destroyed ([log](log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), and its socket stayed open for the 35s the 2026-10-08 run watched ([log][coverage]), so the socket `clients` closes, not the page's own, says the page is gone.
- No run has had our code open the panel during a flight load, before Ready to fly, or after a second flight load in one run ([decision 012](../../decisions/012-efb-app-opens-banner-panel.md)).
  Calling again until a banner page's socket opens covers them, provided the sim takes a call there at all, which is unverified, since a call our toolbar script made once left the panel closed with no error ([log](log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)); the cases in the sim time each.

## Trouble

| Component | Trouble | Who sees it | It raises |
| --- | --- | --- | --- |
| The core | No core heard, a `bye`, 8s silent, or its socket closed | Each app, through [the connection's state](#when-the-core-goes), and the panel bridge, whose visible locks turn into warnings ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)) | Nothing the core can send |
| Our package | Our WASM module missing or from another build while any routine is fed | The sim service | One trouble notification |
| Our WASM module | Stopped while any routine is fed | The sim service | A trouble notification of its own, cleared when the module runs or no routine is fed |
| The panel bridge | No cockpit panel's `hello` within 10s of the profile loading | `clients` | A trouble notification, cleared when a panel connects or the profile unloads |
| The EFB app, the banner, and a page from another version | Not connected, or its version or hash differs | `clients` | The log alone, since the EFB app and the banner are where a notification would show, and every component updates together ([a client whose version differs](../core/02-clients-and-panel-bridge.md#a-client-whose-version-differs)) |

- The core helper's, the network's, and Go to's trouble are their own designs' notifications and slices ([the helper's life](../core/04-core-helper.md#the-helpers-life), [02-units](../network/02-units.md), [go to](../session/02-units.md#go-to)).
- The core checks nothing of our package on disk, since the module's status of Missing or Differs covers it ([our own package](../install/01-installing-and-updating.md#our-own-package)), and the module's status stops raising the package's notification once the module runs or no routine is fed ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status); user, 2026-10-18).
- The sim service watches the module while any routine is fed, preflight's `Hold` among them, rather than in a session, because it sits below the session crate and can't read it; in v1 a routine is fed only in a session.
- Every cockpit panel's bridge sends a `hello` when a session starts, whether or not a module is named for it ([the sim's pages](../architecture/01-spine.md#the-sims-pages)), so 10s with none means the bridge didn't load, which stops pointer sync and every other panel module, whatever this profile names.
- `clients`' notification names the likeliest cause, another package's `VCockpit.js` override, which [installing and updating](../product/03-v1-scope.md#installing-and-updating) shows as a conflict, and the sim service searches no other package for one ([packages that override our files](../install/01-installing-and-updating.md#packages-that-override-our-files); user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).

## When the core goes

- `page-client` gives its page, and the desktop app's Rust side gives its pages, the connection's state: no core heard, connected, quit after a `bye`, silent for 8s with the socket kept, or closed without a `bye`.
  What each app shows for each is the apps' design.
- While its window is open, the desktop app holds a socket to the core the port file names, and closing the window destroys the window rather than hiding it ([one program from login](../install/01-installing-and-updating.md#one-program-from-login)).
- The desktop app wants a core while the sim runs, its window is open, or a session file exists, and starts one when the port file names none running ([decision 014](../../decisions/014-apps-find-core-through-port-file.md)).
  It starts one again 2s after an exit with a code other than 0 ([exiting](../core/01-loop-and-edge.md#exiting)), and after an exit with 0 it starts none until the sim next starts or its window next opens ([the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)).
  Of two cores started at once, the second finds the first running and exits ([finding the core](../architecture/01-spine.md#finding-the-core)).

## Bringing the desktop app forward

The EFB app's button sends `clients`' command, and the core starts the desktop app's program whether or not a desktop app is connected.
The program's one running copy opens its window, so `clients` sends the desktop app no message for it ([one program from login](../install/01-installing-and-updating.md#one-program-from-login); user, 2026-10-18).
A core on a data folder other than the pilot's starts the program with `--data <folder>`, so the EFB app's button, on a development core, opens the desktop app on that core's data folder, and a pilot's core passes no argument, as the Start menu passes none (user, 2026-10-24; [log](log.md#2026-10-24-the-apps-wiring-calls-notices-notifications-gives-the-banners-socket-a-slice-of-its-own-and-passes-a-development-cores-data-folder-to-the-desktop-app)).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| The banner's panel opening, outside a load | Within 2s of the EFB app's code first calling the toolbar for it |
| The desktop app after a core restart | Connected again within 2s of the new port file |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with the stand-in sim:

- A part whose `start` throws leaves the app's other parts running.
- Deleting a feature's folder and its line in each list leaves both apps building, and the map check fails a shell that names a feature's module of the message crate.
- A setting changed, and a quit sent, from the EFB app's socket each take effect.
- A notification clicked outside its action reaches the EFB app as the order that opens the EFB.
- In a flight of a session, the stand-in's toolbar call fails twice: the EFB app's code calls again until the banner's page connects; once it's open, a banner closed by its toolbar button stays closed until the next flight.
- When the session ends, and on a `bye`, the EFB app's code closes the banner with one call.
- The core killed while the desktop app's window is open: the desktop app starts it again and connects within 2s of the new port file; after an exit with 0, it starts none until the sim next starts or its window next opens.
- No cockpit panel connects within 10s of the profile loading: `clients`' trouble notification, cleared when a panel connects.
- A module from another build while `Hold` is fed: the sim service's trouble notification for our package.
- A restarted core with `Follow` fed: whether the trouble notification for our package shows before the module's first status write.
- The EFB app's button, whether or not a desktop app is connected: the core starts the desktop app's program.
- Rate and pause's `unit` message sent while the EFB app reconnects: whether active pause catches up.

In the sim:

- The EFB app's code opens the banner during a flight load, before Ready to fly, and after a second flight load in one run, and how long each takes.
- `TOOLBAR_BUTTON_TOGGLE` with the panel already in the state it's given: whether it sets the state, toggles, reloads, or moves the panel, which sets how long the EFB app's code waits before calling again.
- Whether clicks reach the cockpit through the banner panel's see-through part; if they don't, the banner's shape comes back to design.

## Left to the apps' stage

The user narrowed this node to the apps' connections on 2026-10-17, so these wait for the apps' stage of step 8.

The apps' design:

- Where each notification shows, by its level, how long it stays, and how notifications come and go.
- Which slices each app's frame shows, which app takes traffic's, ATC audio's, and state sync's parts, and how the status list looks ([01-between-machines](../network/01-between-machines.md#left-open)).
- The places each app and the banner name for parts' views, and where each sits.
- Where the banner sits on screen, and how it shows in VR ([notification banner](../product/03-v1-scope.md#notification-banner)).
- What each app shows for each state of the connection, and after a `bye` against a close without one.
- Where in the EFB app a click on a notification lands, and what the order carries for it.
- Which app offers which setting and Quit, and where Dual Input asks for the display name.
- Whether the desktop app's take-control button hides outside the flight, as the EFB app's does ([taking control](../control/01-take-control.md#taking-control)).
- The traffic packs page, and whether it shows the crew's lists beside this machine's, which are the user's ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md#left-open)).
- The recordings list, and the report page, whose upload comes after v1 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md); user, 2026-10-21; [recording log][recording 21]).
- The visible lock's look and words, and the blocked press's flash ([locks](../pointer-sync/01-pointer-sync.md#locks)).
- The words of every notification, verdict, warning, and match difference the earlier nodes raised, which [6.16's raised lines](../architecture/plan.md#616-the-apps) list.

The apps' own code:

- Whether the EFB app draws with our pinned copy of the MSFS Avionics Framework or the sim's own, and which version we pin, which [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) leaves to this stage; p08's EFB app rebuilt against a bundled copy settles the first.
- The desktop app's WebSocket library, which sends no `Origin` or `coui://html_ui` ([decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md)); its Rust side sends `alive`, since a hidden window's timers may run slowly (unverified).
- Whether the desktop app's pages and its Rust side trade text through Tauri's commands, events, or channels, and whether tauri-specta types the calls ([messages and their types](../architecture/01-spine.md#messages-and-their-types)).
- How the desktop app's Rust side brings its window forward while the sim holds the foreground: Windows lets a process take the foreground only on conditions such as being the foreground process or having received the last input, and otherwise "flashes the taskbar button" (documented, [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)), so whether the window comes forward is unverified until the button is pressed in the sim.
- How an EFB part styles itself, and the banner's panel name, which joins [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares).

No v1 page sends a span, so the spine's item on the clock a page measures one on closes for v1 ([01-spine](../architecture/01-spine.md#left-open)).

## What this changes elsewhere

[The code map](../architecture/02-code-map.md), [the spine](../architecture/01-spine.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the session's units](../session/02-units.md), [the sync units](../sync/05-units.md), [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md), [traffic and ATC](../traffic-atc/01-traffic-and-atc.md), [01-between-machines](../network/01-between-machines.md), and [03-v1-scope](../product/03-v1-scope.md) hold what this design changes there, and the [tentative decisions](../architecture/decisions.md#a-feature-shows-itself-in-each-app-through-one-part-the-app-lists-and-no-shell-names-a-feature) give the reasons.

[coverage]: log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel
[recording 21]: ../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour
[recording 23]: ../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb
