# Interface: the apps

```text
Purpose:     How the EFB app, the banner, and the desktop app connect to the core and to each feature, and what trouble in each component raises.
Depends on:  ../core/02-clients-and-panel-bridge.md, ../architecture/02-code-map.md, ../architecture/01-spine.md, ../session/02-units.md, decisions.md, log.md
Decides:     How a feature's part plugs into the EFB app and comes out; what a part may use; the slices and commands the apps need that no unit had; how any client changes a setting and quits; when and how the banner is opened and closed; how a click on a notification reaches the EFB app; what trouble in each component raises; and what the apps learn when the core goes (node 6.16).
```

> **Note**
> Since stage 21, a part also shows on the session card's crew rows, as Go to's Join ends the pilot flying's row, a row taking the first part's answer, and `profiles.pick` loads an aircraft at the world map through the menu script (user, 2026-11-17; [session log](../session/log.md#2026-11-17-in-the-sim-join-set-the-world-map-and-started-the-flight-within-09s-and-active-pause-followed-from-our-efb-apps-code-in-264ms-once-the-menu-script-parsed)).

A feature shows itself in the EFB app through one part, which the app lists in one line, so deleting a feature deletes its folder and that line, and the platform's shells never name a feature.
The apps reach the core only through slices of state, commands, and a part's `unit` messages, and any client sends any command, a setting's change among them.
In each flight of a session, the EFB app's code opens the banner, calling the toolbar again until the banner's page connects, and the page shows and hides its own content while the panel stays open.
Trouble that costs the pilot a feature raises a notification from the unit that sees it, and the rest goes to the log and the recording.

This answers node 6.16 of the [architecture plan](../architecture/plan.md#616-the-apps), narrowed by the user on 2026-10-17 to how the apps connect to the rest of Dual Input.
The apps' looks, words, and screens are in [the tentative decisions](decisions.md), and the frames they name.
[02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s protocol, notifications, and settings, the code map's [tiers](../architecture/02-code-map.md#tiers) and [workspace](../architecture/02-code-map.md#the-workspace), decisions [012](../../decisions/012-efb-app-opens-banner-panel.md), [014](../../decisions/014-apps-find-core-through-port-file.md), [016](../../decisions/016-core-keeps-pilots-settings.md), and [030](../../decisions/030-in-sim-code-es2017-esbuild.md), and this area's [log](log.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| `efb-shell` | The EFB app's frame and the platform's screens in it, the part API, and calling the toolbar for the banner's panel |
| `banner` | The banner's page: its notifications and the preflight summary ([the banner's decision](decisions.md#the-banner-draws-with-react-and-the-kit)) |
| `desktop-shell` | The desktop app's window: [its own screens](decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest), with no part of any feature in them |
| `src/apps/desktop` | Tauri's Rust side, which holds the tray, the figures, and [the fixed local port](decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port), and the window's entry |
| `src/sim-package/pages` | The EFB app's entry and the list of its parts, the banner's entry, the menu script, and the `VCockpit.js` override |

All three pages are React drawn with one kit, `@dualinput/ui`, styled with Tailwind 3 through msfs-tailwind ([the kit](decisions.md#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3)).
What the EFB app and the banner both draw of a crew, a pilot's head and Ready with its countdown, is a second package, `@dualinput/crew`, since neither page's code may reach into the other's.
The EFB app [touches the MSFS Avionics Framework only to register](decisions.md#the-efb-app-touches-the-framework-only-to-register-through-the-efbs-own-copy), through the EFB's own copy.
Every screen a pilot uses Dual Input through is in the EFB app ([one full window](decisions.md#dual-inputs-one-full-window-is-its-efb-app)).

## A feature's parts

```ts
// a sketch: take-control's part, src/features/take-control/efb/index.tsx
export default definePart({ name: "take-control", underTabs: TakeControl, settings: Binding })

// a sketch: rate and pause's part, code with no screen of its own
export default definePart({
  name: "rate-and-pause",
  start(api) {
    api.onUnit("rate-and-pause", (body) => setActivePause(body))
  },
})

// a sketch: the EFB app's list, in src/sim-package/pages/efb.tsx
const PARTS: Part[] = [takeControl, rateAndPause, goTo]
```

- **A part** is one module in a feature's `efb/` folder, named for its unit in the core.
  It has a `start` and a `stop` for code with no screen of its own, and a view for each place it shows in.
- **The EFB app lists its parts** in `src/sim-package/pages`, one line each, as the core's `main` lists features ([what a feature registers](../architecture/02-code-map.md#what-a-feature-registers)).
  The shell starts each part when the app loads and stops it when the app goes, each call in a `try`, so a part that throws stops only itself, as the panel bridge runs its modules ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)).
- **The places** are the regions of the EFB app the shell draws, where it shows every listed part's view for that place, in the list's order: a tab between the Session tab and Settings, the Session tab during preflight, under the tab bar, a section of the Settings tab, and an icon after the phase's name in the header ([a header, five tabs, and take control](decisions.md#the-efb-app-is-a-header-five-tabs-and-take-control-under-the-tabs)).
- **Deleting a feature** deletes its folder and its line in the list, and nothing else in the app, because no shell names a feature: the shells reach a feature's state only through the notifications, the settings, the match check's differences, and the role keys' labels, which carry every feature's alike.
  The map check holds it: it fails a platform unit, in Rust or TypeScript, whose source names a feature's module of the message crate, which the import rules let through, since the message crate is an engine every unit may import.

v1's parts:

| Feature | In the EFB app |
| --- | --- |
| Take-control | Its button under the tab bar, and its binding in Settings ([take control](decisions.md#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s), [the Settings tab](decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version)) |
| Rate and pause | Code with no screen, which sets active pause ([rate and pause](../session/02-units.md#rate-and-pause)) |
| Go to | Its screens at Free flight's world map ([Go to](decisions.md#go-to-from-the-efb-app-runs-through-the-menu-script-so-blurpage-stays)) |
| State sync | Its checklist on the Session tab during preflight ([the checklist](decisions.md#the-checklist-takes-any-entry-an-author-writes-and-every-pilot-has-one)) |
| Traffic and ATC audio | A tab each, with its sharing, settings, and warnings ([the tabs](decisions.md#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon)) |
| Avatars | The Figures tab ([the Figures tab](decisions.md#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do)) |
| Pointer sync and flight-model sync | None |

## What a part reaches

- **The core:** a part gets `watch(slice)`, `command(name, args)`, and the `unit` messages it trades with its own unit by name.
  It gets nothing else of the protocol.
- **Shared code:** a part imports only from `efb-shell`, the kit, and the message crate's TypeScript types ([tiers](../architecture/02-code-map.md#tiers)), so code that parts share lives in the shell or the kit.
- **npm packages:** a feature's folder has no `package.json` of its own ([building every target](../architecture/02-code-map.md#building-every-target)), so a part's `react` resolves from the root's `node_modules`, where npm's default strategy installs a package that isn't duplicated (documented, [npm's `install-strategy`](https://docs.npmjs.com/cli/v11/using-npm/config)).
- **Tailwind** builds a part's classes when the page's build names its folder as a source, and the theme's colors and spacing are the kit's.

## Slices and commands

Each unit registers its own slices and commands, named for it in the message crate ([what a feature registers](../architecture/02-code-map.md#what-a-feature-registers)).
These are the ones the apps need that no unit had:

| Unit | Its slice adds | Its commands add |
| --- | --- | --- |
| `clients` | Whether a banner page's socket is open; and `core`, what the setup screens and the header read of the core itself | A notification clicked outside its action |
| `session` | The members, with each one's name, color, `status`, and `ready`; control; preflight and its countdown; the invite code; the attempt and its refusal; the match check's differences, each with its level and its owner's words; the verdicts on Ready and on each feature's sharing switch; and the role keys this pilot can claim, each with its label | Each sharing switch, which asks the kernel's request for its role key ([session keys](../session/02-units.md#session-keys)) |
| `sim-service` | Sim awareness's stage, page, aircraft, pause, and how the last run ended; where the pilot is, and the aircraft's names; and the module's status ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status)) | None |
| `network` | The servers it can reach ([its units](../network/02-units.md)) | None |
| `profile-loader` | `profiles`, the supported aircraft and what's loaded | `profiles.pick`, which refuses until the menu script makes the world map's requests |
| `recording` | The recorded runs, by their folders' names, which are their starts in UTC, with each one's size and which is in progress | Delete a run, which refuses the run in progress; and mark the moment, which writes a line to the run's log and has [no sender](decisions.md#mark-the-moment-leaves-the-efb-app) |
| `go-to` | The PF's spot, whether Go to is available, and the step that failed | None beyond Go to |
| `traffic` | This machine's traffic packs, after `LIST_PACKS` | None beyond `LIST_PACKS` |
| `atc-audio` | The program the core helper captures, or that it's waiting for one | None |
| `avatars` | Why the figures do less in the loaded aircraft, which [the Figures tab](decisions.md#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do)'s note says | None |

- `recording`'s slice reads the runs' folders, since v1 writes no index (user, 2026-10-23; [recording log][recording 23]), and it says nothing of uploads, since v1 uploads no bug report: the command to upload a session comes after v1 (user, 2026-10-21; [recording log][recording 21]).
- A match item names its words as it names its level ([the match check](../session/02-units.md#the-match-check)), and a role key registers a label in its feature's words, so the shells show both without naming a feature.
- The network's, the core helper service's, the cockpit stream's, state sync's, and take-control's slices are their own designs' ([02-units](../network/02-units.md#what-the-pilot-sees-and-settings), [the devices](../core/04-core-helper.md#the-devices), [the sync units](../sync/05-units.md#catch-up), [taking control](../control/01-take-control.md#taking-control)).
- The update's state, Install now, Check now, the firewall rule, and Start with Windows are the desktop app's own, so they're no unit's slice or command, and the EFB app reaches them over [the fixed local port](decisions.md#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port), which no core carries.

## Settings

- Any client changes any setting with `clients`' one command, and the Settings tab offers them (user, 2026-10-17).
  This changes [decision 016](../../decisions/016-core-keeps-pilots-settings.md), whose EFB app offers no setting in v1, once step 8's decisions are numbered.
- A setting registers, beside its key, type, and default ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), a label in its feature's words, as a notification's text is, and what an app needs that the type doesn't say: a number's range, a list's choices or the slice that lists them, such as the output devices, and whether only its feature's part shows it, as take-control's input, which its section writes after Bind.
- A development setting says so when it registers, and shows in no app: a developer edits `settings.json` while the core is stopped.
- The profile loader's local folder is a development setting, since v1 ships no authoring tool ([the local folder](../profiles/02-units.md#the-local-folder); user, 2026-10-18).
- No setting records everything, since the core records every input (user, 2026-10-21; [recording log][recording 21]).
- The display name is a setting like any other, which Host and Join need ([members](../session/02-units.md#members)), and first-time setup asks for it ([setup](decisions.md#first-time-setup-asks-for-the-name-and-color-once-and-checks-the-pc-and-our-servers)).

## Quit

Quit is the session crate's command ([joining and leaving](../session/02-units.md#joining-and-leaving)), so any client may send it.
Only the desktop app's tray offers it ([the desktop app's screens](decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest)), through the window's ask, whose Quit anyway sends it and ends the app ([one program from login](../install/01-installing-and-updating.md#one-program-from-login)).

## Notifications

A click on a notification outside its action sends `clients`' command with the notification's ID, and `clients` sends the EFB app the order that opens the EFB onto our app, which carries where to land ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol); [a notification's click](decisions.md#a-notifications-click-opens-the-efb-app-where-its-explained-or-acted-on)).
A notification's unit can clear it while the pilot's click is on its way, and the click still opens the EFB, since the pilot asked to look.
A one-time notification stays 6s, and that time pauses while the pointer is over it, so it stays as the pilot reaches for it ([the banner's box](decisions.md#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right); user, 2026-10-24; [log](log.md#2026-10-24-the-apps-wiring-calls-notices-notifications-gives-the-banners-socket-a-slice-of-its-own-and-passes-a-development-cores-data-folder-to-the-desktop-app)).

## The banner

- The banner's panel stays open through each flight of a session, and its page shows and hides its notifications and the preflight summary itself, from the slices it watches, so no slice says whether it should be open (user, 2026-10-18).
- `clients`' slice says whether a banner page's socket is open.
  `clients` closes that socket 8s to 10s after the page's last message, since it checks every 2s ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol)).
- In each flight of a session, the EFB app's code opens the panel, calling `TOOLBAR_BUTTON_TOGGLE` again after 3s until a banner page's socket opens.
  A pilot who closes it from its toolbar button keeps it closed until the next flight.
- The EFB app's code calls again at the end of each load, and treats a socket that closes within 12s of that as the old page's.
  In a Restart, the old page's socket closed 0.4s after `ReadyToFly`, 9.2s into the load (measured on MSFS 2024, 2026-11-02, [log][panel sizing]).
- The sim works out a panel's size only as it opens, so when the window changes shape, the page asks the EFB app through `L:DUALINPUT_BANNER_RESIZED` to close and open it (same entry).
  The call with `true` on an open panel changes nothing, and `false` then `true` gives a new page at the right size (same entry).
- The EFB app tells the page through `L:DUALINPUT_EFB_ON_SCREEN` when our app is on screen, which hides the preflight summary, since the app shows the same.
- The EFB app's code closes the panel once, with no retry, when the session ends or the core says `bye`, since the core says nothing more after either.
- A closed panel's page is destroyed ([log](log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)), but the sim doesn't close its socket promptly: one stayed open for the 35s the run watched (measured on MSFS 2024, 2026-10-08, [log][coverage]).
  So `clients` closing the socket is what says the page is gone.

## Trouble

| Component | Trouble | Who sees it | It raises |
| --- | --- | --- | --- |
| The core | No core heard, a `bye`, 8s silent, or its socket closed | Each page, through [the connection's state](#when-the-core-goes), and the panel bridge, whose visible locks turn into warnings ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)) | [One of the EFB app's three screens](decisions.md#without-the-service-the-efb-app-shows-one-of-three-screens-and-another-version-shows-setups-box), and the banner's card |
| Our package | A module file missing from a package that otherwise loaded | The sim service | One trouble notification |
| Our WASM module | Stopped while any routine is fed | The sim service | A trouble notification of its own, cleared when the module runs or no routine is fed |
| The panel bridge | Under a profile that a panel module serves, no cockpit panel's `hello` within 10s of the profile loading | `clients` | A trouble notification, cleared when a panel connects or the profile unloads |
| The EFB app, the banner, and a page from another version | Not connected, or its version or hash differs | `clients` | The log, since the EFB app and the banner are where a notification would show; and the EFB app shows setup's "Add-on version mismatch" box ([a client whose version differs](../core/02-clients-and-panel-bridge.md#a-client-whose-version-differs)) |

- The core helper's, the network's, and Go to's trouble are their own designs' notifications and slices ([the helper's life](../core/04-core-helper.md#the-helpers-life), [02-units](../network/02-units.md), [go to](../session/02-units.md#go-to)).
- The core checks nothing of our package on disk, since the module's status covers it ([our own package](../install/01-installing-and-updating.md#our-own-package)), and the module's status stops raising the package's notification once the module runs or no routine is fed ([the module's status](../core/03-sim-seam-and-wasm-module.md#the-modules-status); user, 2026-10-18).
- The sim service watches the module while any routine is fed, preflight's `Hold` among them, rather than in a session, because it sits below the session crate and can't read it; in v1 a routine is fed only in a session.
- The panel bridge's check waits only under a profile that needs a panel, since an aircraft can have no cockpit panels: each panel module says whether the loaded profile names anything it serves, and a profile no module serves raises nothing ([the banner's content](decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on); user, 2026-11-01).
- `clients`' notification names the likeliest cause, another package's `VCockpit.js` override, and the sim service searches no other package for one ([packages that override our files](../install/01-installing-and-updating.md#packages-that-override-our-files); user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).

## When the core goes

- `page-client` gives its page the connection's state: no core heard, connected, quit after a `bye`, silent for 8s with the socket kept, or closed without a `bye`.
- The desktop app's window needs no core, so an open window keeps none running ([one full window](decisions.md#dual-inputs-one-full-window-is-its-efb-app)).
- The desktop app wants a core while the sim runs or a session file exists, and starts one when the port file names none running ([decision 014](../../decisions/014-apps-find-core-through-port-file.md)).
  It starts one again 2s after an exit with a code other than 0 ([exiting](../core/01-loop-and-edge.md#exiting)), and after an exit with 0 it starts none until the sim next starts ([the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)).
  Of two cores started at once, the second finds the first running and exits ([finding the core](../architecture/01-spine.md#finding-the-core)).

## Bringing the desktop app forward

The EFB app has no button that brings the desktop app forward, and the core never starts the desktop app's program, so a pilot opens its window only from the tray or the Start menu ([one full window](decisions.md#dual-inputs-one-full-window-is-its-efb-app)).

## Budgets

| What | Budget |
| --- | --- |
| The banner's panel opening, outside a load | Within 2s of the EFB app's code first calling the toolbar for it. In nine hosts the page connected 0.45s to 2.05s after the session started, and that first call comes up to 100ms after the start (measured on MSFS 2024, 2026-11-02, [log][third session]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with the stand-in sim:

- A part whose `start` throws leaves the app's other parts running.
- Deleting a feature's folder and its line in the list leaves the app building, and the map check fails a shell that names a feature's module of the message crate.
- A setting changed, and a quit sent, from the EFB app's socket each take effect.
- A notification clicked outside its action reaches the EFB app as the order that opens the EFB.
- In a flight of a session, the stand-in's toolbar call fails twice: the EFB app's code calls again until the banner's page connects; once it's open, a banner closed by its toolbar button stays closed until the next flight.
- When the session ends, and on a `bye`, the EFB app's code closes the banner with one call.
- The core killed: the desktop app starts it again; after an exit with 0, it starts none until the sim next starts.
- Under a profile a panel module serves, no cockpit panel connects within 10s of the profile loading: `clients`' trouble notification, cleared when a panel connects.
- A module from another build while `Hold` is fed: the sim service's trouble notification for our package.
- A restarted core with `Follow` fed: whether the trouble notification for our package shows before the module's first status write.
- Rate and pause's `unit` message sent while the EFB app reconnects: whether active pause catches up.

## Left to the apps' stage

Stage 11b settled what the earlier nodes left to it, in [the tentative decisions](decisions.md) and the frames they name, which is where the apps' looks, words, and places are.

## Left open

- How soon the banner's panel opens during a flight load, before Ready to Fly, which no run has timed.
  After a Restart, and after a load from the world map, its page connected 4.2s after Ready to Fly (measured on MSFS 2024, 2026-11-02, [log][second session]).
- How the desktop app sends the session crate's Quit, which waits for the socket to the core that [stage 15](../build/plan.md#15-installing-and-updating) gives it.

## What this changes elsewhere

[The code map](../architecture/02-code-map.md), [the spine](../architecture/01-spine.md), [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md), [01-loop-and-edge](../core/01-loop-and-edge.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [the session's units](../session/02-units.md), [the sync units](../sync/05-units.md), [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md), [traffic and ATC](../traffic-atc/01-traffic-and-atc.md), [01-between-machines](../network/01-between-machines.md), and [03-v1-scope](../product/03-v1-scope.md) hold what this design changes there, and the [tentative decisions](../architecture/decisions.md#a-feature-shows-itself-in-each-app-through-one-part-the-app-lists-and-no-shell-names-a-feature) give the reasons.

[coverage]: log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel
[second session]: log.md#2026-11-02-a-second-session-in-the-sim-confirms-bootmode-2-restart-and-a-load-from-the-world-map-and-finds-a-large-l-value-reads-0-and-a-canvas-repaints-only-when-its-element-changes
[third session]: log.md#2026-11-02-a-third-session-in-the-sim-passes-the-heads-a-changed-window-a-cards-click-with-no-core-and-a-joiners-preflight-card
[panel sizing]: log.md#2026-11-02-the-sim-sizes-a-panel-only-as-it-opens-the-toolbars-open-call-changes-nothing-on-an-open-panel-and-a-loads-old-page-closes-after-a-short-load-has-ended
[recording 21]: ../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour
[recording 23]: ../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb
