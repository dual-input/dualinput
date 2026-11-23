# Profiles: the extension in the sim

```text
Purpose:     The profile extension's features that need the sim, and what the core, the platform, and the sync engine add for them.
Depends on:  03-the-extension.md, 01-format-and-delivery.md, 02-units.md, ../sync/05-units.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../architecture/02-code-map.md
Decides:     What an author sees with the sim: live values on watch lines, the Dual Input panel, Run, and the display picker; how the extension reaches the sim through the author's own core; the feature `authoring`; the platform crate `sim-variables`, which reads and writes the sim's variables and fires its events by a profile's names for every feature; the sync engine's single write; how every panel stays for the picker; and the budgets, known limits, and cases (stage 22g).
```

During a session's flight, the profile extension shows each `watch:` line's value at the end of the line, and runs one entry's write with a value the author types.
For `displays`, it lists the cockpit's panels and outlines the one the author is on, in the sim.
It reaches the sim through the author's own running Dual Input: `serve`, the extension's language server, `dualinput-profile-builder serve`, connects to the core as one more client, and a feature of the core's, `authoring`, serves it.
`authoring` reaches the sim through a new platform crate, `sim-variables`, which state sync uses too, so a Run takes the route a synced write takes.

The user picked the three features from fsc-editor's on 2026-11-21, split them from [stage 22d](../build/plan.md#22d-the-profile-extension) into 22g, and designed them with us on 2026-11-22, a call at a time; the reasons below are the ones that decided each part.
fsc-editor's versions are the starting point, and where ours differs, this doc says why (read in fsc-editor, `src/main/sim/` and `src/renderer/src/components/`).

## In a session

Live values, Run, and the picker work only while you're in a session's flight, alone or with a crew, in an aircraft your profile covers, through a Dual Input of the same release as the extension (user, 2026-11-22).
You host the session from the EFB app, as you would to test a save ([building on save](03-the-extension.md#building-on-save)), and the extension starts none itself, since hosting holds your aircraft until you click Ready ([preflight](../product/03-v1-scope.md#preflight)) and would stand in the way of joining a crewmate's session (user, 2026-11-22).

So no decision or rule of the loader's changes: outside a session, no profile loads and no cockpit panel connects ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)), and the extension shows only what it shows without the sim.

## Live values

| A `watch:` that names | Shows |
| --- | --- |
| A variable in a state entry: `L()`, `A()`, `B()`, or `instrument()` | Its value, in the unit the line names |
| An event in an event entry: `K()`, `H()`, `B()`, or an `L:` pulse | How many times it has fired since the line was watched, as `×3`, and the last value it carried, if it carried one |
| A counting map's event, on its `inc:`, `dec:`, or `set:` line | Its firings, the same way |
| A counting map's `count:` variable | Its value |

- Only `watch:` lines show values, and a `write:` line shows none (user, 2026-11-22).
- A counting entry's shadow value shows nothing, since only state sync keeps it, and `authoring` reads nothing of state sync's.
- Values come from the open text, saved or not, so a line you've just typed shows its value once typing pauses, and a module open on its own shows values too (user, 2026-11-22).
  Finding the right name is most of what an author uses them for.
- A value shows in any open file, a profile for another aircraft included, since a module such as the GNS 430 fits many aircraft (user, 2026-11-22).
- A number shows with its trailing zeros dropped and at most 3 decimals, as `1` and `0.25`, and a `Bool` unit's as `true` or `false`, as fsc-editor showed them (read in fsc-editor, `src/renderer/src/lib/live-decorations.ts`, `formatValue`).

### The box

Each value shows at the end of its line, always, in a box of its own: text in our palette's sky on a faint tint of it, with rounded corners, as fsc-editor's box had blue text on a 7% blue tint with 3px corners (read in fsc-editor, `src/renderer/src/index.css`, `.fsc-live-value`; user, 2026-11-22).
It's never an underline or a hover, since an author working a switch in the sim glances at VS Code and sees the change there (user, 2026-11-22).

- The extension draws it as a VS Code decoration after the line, in the dark or light palette its token colors use ([highlighting](03-the-extension.md#highlighting)).
- VS Code's inlay hints would show the same text, but in VS Code's one pair of inlay-hint colors for every language, and not at all for an author who turns them off; the decoration keeps our look whatever the setting (user, 2026-11-22).
- fsc-editor drew its own for a different reason: Monaco 0.55.1's inlay hints stopped listening after their second refresh (read in fsc-editor, `src/renderer/src/lib/live-decorations.ts`), a bug VS Code 1.147 doesn't have, since it subscribes again on every run (read in VS Code 1.147.0, `workbench.desktop.main.js`, the inlay hints controller).

### A name the aircraft lacks

A misspelled `L:` reads 0, the same as a switch at 0 (user, 2026-11-22), since the sim creates an `L:` at 0 the first time code names it (documented, [03-01](../../learn/foundations/03-01-units-and-variables.md#l-and-z-local-variables)).
That the sim service's `watch` creates one too is unverified, and the session in the sim watches a misspelled `L:` on the 58P.
So a box that never moves while you work its control means a misspelled name or the wrong variable.

The box carries no mark of its own for it (user, 2026-11-22).
Our WASM module could look the name up, as fsc-editor's did, but its answer is wrong in both directions:

- It calls a real name missing when the aircraft hasn't registered it yet, since aircraft register their `L:` names in bursts after a load, and fsc-editor's walk stopped with 1,380 of an A2A aircraft's cockpit names still to come (measured on MSFS 2024, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — Re-enumeration stops on a pause, not on a finished table").
- It calls a typo present once anything has named it, since naming creates it: a calculator read created a missing `Z:` (measured on MSFS 2024, 2026-08-27, fsc-editor, same log, "2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal"), and state sync's own watch of a saved typo may be such a read.

Every other kind of name already reports a wrong one, and the box shows the error's words in place of a value:

- SimConnect refuses a data-definition entry for an `A:` the sim doesn't have, as an exception that comes later rather than where the entry was added (measured on MSFS 2024, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `A:` read crashed the app. Positional reads were the wrong shape."), which the sim service hands back with the watch's handle ([its thread](../core/03-sim-seam-and-wasm-module.md#its-thread)).
- The sim client answers a call for a `B:` name not on the input events list with an error ([the sim client](../core/03-sim-seam-and-wasm-module.md#the-sim-client)).
- An `instrument()` path that doesn't read is reported ([what a feature asks of it](#what-a-feature-asks-of-it)), and `authoring` marks one whose key no open panel's `hello` names ([what `authoring` does](#what-authoring-does)).

## The Dual Input panel

The Dual Input panel is a view in VS Code's right-hand side bar, the secondary side bar, drawn by the extension as a webview in our kit, `@dualinput/ui`, with our palette and fonts, in dark and light, so it looks and feels like the rest of our apps (user, 2026-11-22).
It stays put as you switch files and narrows no editor, and you can drag it to the left bar or the bottom panel.
VS Code takes a view container in the secondary side bar from an extension's manifest from 1.106.0, whose release notes have it as "View containers in Secondary Side Bar" (documented, [VS Code 1.106](https://code.visualstudio.com/updates/v1_106)), behind a proposal before it (read in VS Code's repository, commits `03baef1008` and `c1d7cfd709`), so the extension's lowest VS Code rises from 1.91 to 1.106.0, and `@types/vscode` with it.

It holds everything the sim gives an author (user, 2026-11-22):

- **A status line** at the top: whether your Dual Input is running, whether you're in a session's flight, the aircraft loaded, and whether it's the open profile's.
  It says why nothing else shows when nothing does, such as no session; names the side to update when the extension and Dual Input are of different releases; and, with a crew, says when the open text isn't the bundle the session pinned, so your crew still flies the saved one, which alone in a session concerns nobody (user, 2026-11-22).
- **Run**, for the entry whose `▶ Run` you clicked, below it.
- **The display picker**, in Run's place, when you open it on `displays`.

Its words, its layout, and its look come from a draft built whole and refined by eye with the user, on a dev page of its own in `tools/lib/dev-pages.ts`, as the apps' screens were (user, 2026-10-29).

## Run

### Starting one

- A `▶ Run` code lens sits above each entry that has a write, in the profile the session flies and the modules it imports, and clicking it opens the panel on that entry (user, 2026-11-22).
  It's the one clickable spot VS Code gives an extension on each entry, since VS Code's API offers no click on a decoration in the margin or after a line (unverified; the stage's build settles it).
- "Dual Input: Run entry" opens the panel on the entry at the cursor, on Ctrl+Alt+F5 in a profile, which VS Code's own keys on Windows leave free, and F5 is what runs things in VS Code (read in VS Code 1.147.0's default key bindings).
- The lenses show only while Run can run in the file, as fsc-editor's buttons did (read in fsc-editor, `src/renderer/src/components/run-setter/widget.tsx`, `runnableNow`), so they come once a session's flight starts and go when it ends.
- While you're the PM, the pilot monitoring, the lens on an entry the PF, the pilot flying, owns reads `▶ Run · pilot flying only`, and the panel says Run waits until you have control, since state sync puts back any change the PM makes to that entry ([who sends, and putting back](../sync/05-units.md#who-sends-and-putting-back)) (user, 2026-11-22).
  Alone in a session you're always the PF, so a solo test is never blocked.
- VS Code's test runner could put a clickable run button in the margin, by listing every entry as a test, which would borrow that feature for its side effect, so the extension doesn't.

### The panel's Run

| Part | What it does |
| --- | --- |
| The entry | Its `name:` and key, and its live value, larger than the box's |
| The value field | Enter runs it, and the field keeps the focus, so Enter, Enter, Enter is the gesture, as in fsc-editor's popover (read in fsc-editor, `src/renderer/src/components/run-setter/panel.tsx`) |
| Values seen | A button for each value the entry's watch has read since it was watched, in ascending order, up to 8, and none for a watch that has read more; a click fills the field, and a double-click runs it |
| The preview | What Run sends for the value typed, worked out by the sync engine as typing pauses, such as "set `L:BKSQ_MixtureLeverPosition_1` to 0.5", or the build's error |
| The revert notice | For 1s after a run's last action, `authoring` reads the entry's watch every frame, and if the value left its reading from before the run and came back to it, the panel says so, as "Back to 0 after 120ms" |

The user picked these three beside the field, and no list of past runs (user, 2026-11-22).

- **Values seen:** fsc-editor stops at 8, since in a 75s capture, 30% of the `L:` variables it measured took 2 values or fewer and 40% took 10 or fewer, so a switch gets buttons and a gauge, whose values would be an arbitrary sample, gets none (read in fsc-editor, `src/main/sim/picks.ts`).
- **The preview** catches a wrong scale or target without touching the sim, as fsc-editor's preview of its calculator code did (same file as the panel, above).
- **The revert notice** is the reason fsc-editor built Run: an aircraft that owns a variable puts it back, at a median of 83ms and a p90 of 464ms over 6,760 such reverts across 101 variables, too fast to see in a live value, and an author who reads that as "no effect" rewrites a write that was right (read in fsc-editor, `src/main/sim/run.ts`).
  1s caught 97.4% of them there.
  fsc-editor's module read every 66ms, so a revert inside one read went unseen; `authoring` reads every frame, so it sees all but a revert inside one frame.
  A write that holds, and one that moves nothing, say nothing, since the box above shows both.

### What a Run runs

Run runs the open text, saved or not (user, 2026-11-22):

1. `serve` builds the profile the session flies from the open files, as a save's build does but writing nothing, as typing pauses ([TypeScript in two runtimes](03-the-extension.md#typescript-in-two-runtimes)).
   For a module, that's the session's profile, which imports it.
2. When the bundle's hash differs from the last it sent, `serve` sends `authoring` the bundle, and `authoring` loads it into a sync engine of its own, as state sync loads the pinned one, and hands the new engine every reading it already holds, since the engine holds an entry's writes until its first reading ([writing](../sync/05-units.md#writing)) and a still switch sends none.
3. A Run sends the entry's key and the value, and `authoring` asks its engine for that entry's write, through the engine's [single write](#the-sync-engines-single-write), and carries out the actions through `sim-variables`.

So you try a changed write function without saving it, and without reloading the crew's cockpits on every try, as a save does in a test session ([test sessions](02-units.md#test-sessions)).
A file that doesn't build has no Run, and the panel shows the build's first error.

- **A name, a `toggle`, a stepping write, or a function:** each does what [writing](../sync/05-units.md#writing) has it do on a receiving machine, from this cockpit's readings: a `toggle` flips only when the reading differs from the value, a stepping write steps from the reading at the aircraft's pace, and a function sees `state` as this cockpit stands.
- **An event entry:** the field may be empty, and Run fires the entry's write with no value.
- **A counting entry:** the field takes a step count, such as `+3` or `-2`, and Run sends that many of the write's `inc` or `dec` at the aircraft's pace, which the event lines count (user, 2026-11-22).
  A step count, since the shadow value it would step from is state sync's.

With a crew, the write lands in your cockpit, state sync reads it as a change of yours, and sends it as it sends any, so a crewmate's cockpit follows.
Each crewmate's state sync writes it there with the bundle the session pinned, so a write function you changed and haven't saved runs only on your PC, which the status line says, and your crew runs it once you save.

## The display picker

A "Pick displays" lens above `displays:`, with an inspect icon rather than Run's play icon (user, 2026-11-22), opens the picker in the panel, and "Dual Input: Pick displays" opens it in a profile or module that has no `displays:` yet.
It lists the cockpit's panels from their `hello`s, and the row you're on is outlined in the sim, which is how fsc-editor's picker answered "which of these is `KX155B_2`" (read in fsc-editor, `src/renderer/src/components/panel-picker/panel.tsx`).

- An identifier only one instrument holds is one row, which writes the identifier, so it survives liveries ([displays](01-format-and-delivery.md#displays)).
- An identifier several instruments share is a heading with a row for each full key under it, since only a full key names one of them; ticking the heading ticks all of them.
- A full key that more than one panel holds, as two of the 58P's panels each hold `GNS_DISABLED` ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)), is one row that says how many panels hold it, and outlines each, since `displays` takes them all.
- A row already in `displays` shows ticked.
- A `WasmInstrument` row shows its reason and can't be ticked, since v1's pointer sync reaches HTML displays only and such a key fails the load ([displays](01-format-and-delivery.md#displays)).
- Up and Down move the row, Space ticks it, Enter writes the ticked rows into `displays`, one to a line, as the formatter writes it, and Escape leaves; the mouse moves and ticks the same row.
- The outline is a box over the instrument, with its key in the middle, that passes every press, drawn by `authoring`'s panel module `outline`.
  `authoring` sends the outline to the panels of the row you move to and a clear to those of the row you left, and clears it when the picker closes or `serve` leaves.
  It's a module's own drawing, since it blocks nothing, and the bridge owns only what can ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)); its `stop` removes it, and `window.DUALINPUT_BRIDGE_UNLOCK()` stops it with every module.

No "pick in cockpit", fsc-editor's mode that took your next click on a display as the pick: walking the list with the outline following it is what's useful, and the mode put our code in the pilot's input path (user, 2026-11-22).

### Every panel stays while the extension is connected

[Decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md) keeps only the panels the core gives something, so the panels no feature uses close their sockets at a session's start, and those are the ones an author is looking for.

- While `serve` is connected, `authoring`'s rule gives every cockpit panel `outline`, so every panel stays, by 011's own rule (user, 2026-11-22).
- When `serve` connects after the session started, `authoring` tells `clients` its rule changed and asks the sim service to raise the announcement's `panels` count.
  A panel told `none` connects again when the count differs from the one it was told `none` under, gets `outline`, and stays.
- When `serve` leaves, `authoring` tells `clients` again, and `clients` answers each open panel once more: a panel left with no module stops and closes its socket.
- A profile's unload, as at each save's reload in a test session, re-answers each open panel the same way, so `outline`, whose rule reads no profile, stays through it; and `authoring` doesn't mark its sim work as ending with the profile, so its watches stay too ([a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load)'s note of 2026-11-21).

A panel the session still uses never closes.
On the Black Square Baron 58P, all 20 cockpit panels have joined the core ([core log](../core/log.md#2026-10-22-stage-5s-bridge-loads-in-all-20-of-the-barons-panels-joins-the-core-on-a-sessions-announcement-and-leaves-the-cockpit-whole-when-bridgejs-is-missing-or-throws-but-two-panels-shared-an-instrument-key)), so all 20 hold a socket while `serve` is connected.
The other way was to keep every panel in every session, which would change every pilot's session for a tool only authors use, and reverse a numbered decision to save a counter (user, 2026-11-22).

## How it works

| Part | Where | What it holds |
| --- | --- | --- |
| `sim-variables` | `src/platform/sim-variables`, in the core, on the platform's top line beside `profile-loader` | Reading and writing the sim's variables and firing its events by a profile's names, for every feature, each kind by its route: its connection, the routine `HtmlAndInputEvents`, and the panel modules `h-events` and `instrument-reads` ([below](#reaching-the-sim-by-name)) |
| `sync-engine` | `src/engines/sync-engine` | One entry's write outside a sync, its plan for the preview, and the mark of an engine that only runs the writes it's asked for ([below](#the-sync-engines-single-write)) |
| `state-sync` | `src/features/state-sync` | What it holds, with its watches and writes through `sim-variables` and no routes of its own |
| `authoring` | `src/features/authoring`: `core`, and `panel` for `outline` | The extension's side of the core: the open files' names, values seen, its own engine for Run, the revert notice, the guards, the panels' list, and the outline |
| `clients` | `src/platform/clients` | Answering the cockpit panels once every unit has handled the profile's load; each open panel's name and instruments' keys, for features; and answering every open panel again when a module's rule changes or the profile unloads |
| `sim-service`, `page-client` | `src/platform/sim-service`, `src/engines/page-client` | The announcement's `panels` count, and a panel told `none` connecting again when it changes |
| `serve` | `tools/profile-builder` | The connection to the author's core, the open files' names, the bundle for Run, the boxes' text, the lenses, and the picker's edit |
| The extension | `src/apps/profile-extension` | Drawing the boxes, the lenses' commands, and the Dual Input panel's webview, with its dev page |

`authoring` is named for whoever it serves rather than for the extension, since it will grow past these three features, as the IDE's commands of its own, such as discovering what an aircraft exposes, join it ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client); user, 2026-11-22).
It ships in every release core and does nothing until `serve` connects in a session, so a pilot who never writes a profile carries the code and nothing else (user, 2026-11-22).
Deleting it leaves everything else building, as [tiers](../architecture/02-code-map.md#tiers)' first test asks.

### The connection

- `serve` reads the core's port from `port.json` in the core's data folder, `%APPDATA%\DualInput\`, or the folder the setting `dualInput.dataFolder` names, for a development core, such as the one `tools/sim/` runs on a data folder of its own.
  It connects with no `Origin`, which the core takes ([decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md)).
- Its `hello` names the component `profile-extension`, with the extension's version, and it reads `port.json` again every 2s while it has no socket.
  Each `authoring.open` names its VS Code window, and `authoring`'s slice names the window it serves, since a slice reaches every client alike, so a second window sees that it doesn't have the sim.
- `serve` reads the core's version from `clients`' slice `core` ([clients and the panel bridge](../core/02-clients-and-panel-bridge.md)'s first note), and while the two differ, it sends nothing more and the status line names the side to update; `authoring` serves a `profile-extension` client only when its `hello`'s version is the core's, so a client of another release gets no watches, no Run, and no panels kept for it.
- A program on the PC that connects could write to the sim through `authoring`, as it already can through SimConnect itself, so the socket needs no token (user, 2026-11-22).

| From `serve` | Carries |
| --- | --- |
| `authoring.open` | Every name call on a `watch:` line of each open file, with its unit, as typing pauses and as files open and close; and the open text's bundle of the session's profile, when its hash differs from the last sent |
| `authoring.panel` | What the panel shows: Run's entry and the value typed, for values seen and the preview; or the picker's row; or nothing |
| `authoring.run` | An entry's key and the value, or the step count |

- `serve` sends `authoring.open` and `authoring.panel` again on each new socket, and `authoring` keeps the last of each for as long as the socket stays open, so a session that starts after `serve` connected, a core that restarted, and a second session in one run each start from them.
- `authoring`'s slice, which `serve` watches, holds the status line's facts, the session's profile and its pinned bundle's hash, each watched name's value or error, the panel's entry's values seen, its preview, and its last run's result, and the panels' list while the picker is open.
- A slice reaches a client at most once a `clients` round, every 50ms ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), so values reach the boxes at most 20 times a second, with no rate of their own; fsc-editor's module sent at 15 a second.
- As the protocol has every command, a Run's answer says only that it was taken, and its preview and result show in the slice ([the protocol](../core/02-clients-and-panel-bridge.md#the-protocol)).

`serve` turns the slice into the editor's: a notification of its own, `dualInput/values`, with each open file's lines and their boxes' text, which the extension draws; LSP's code lenses, refreshed when Run's availability changes, control passing included; and the picker's edit to `displays`, through LSP's `workspace/applyEdit`.
The panel's webview talks to the extension, and the extension to `serve`, so the server still owns everything but what VS Code alone draws, as [the extension](03-the-extension.md#how-it-works)'s split has it.

### What `authoring` does

- It watches, through `sim-variables`, the union of every name `authoring.open` names and every name its engine's bundle reads, so a write function sees `state` as this cockpit stands.
- It keeps each watched name's distinct values in order of first reading, up to 9, so it knows 8 from more, from the moment the name was first watched.
- It marks an `instrument()` line "no panel holds `<key>`" when no open panel's `hello` names its key, once every panel has answered, which it can tell since every panel stays while `serve` is connected; `sim-variables` leaves that watch waiting for its panel, as state sync's must, since a profile can load before any panel has said hello.
  After it asks for every panel again, it holds the mark back for 2s, one period of [the announcement](../core/03-sim-seam-and-wasm-module.md#the-announcement), since a panel told `none` before `serve` connected is still coming back, and a key it holds would read as no panel's until its `hello` arrives.
- It reads each bundle in a job, off the loop, since the 58P's took 1.9ms in a release build against a handler's 1ms ([budgets](../core/01-loop-and-edge.md#budgets)), and refuses a Run while a newer bundle is still being read, rather than queue it.
- It refuses a bundle whose profile isn't the one the session flies, by its maker and model, then by whether one of its variants covers this pilot's aircraft, and a Run of a key the bundle lacks, so a Run never writes one aircraft's values into another, as fsc-editor guarded against (read in fsc-editor, `widget.tsx`, `runnableNow`); and it refuses a Run on a PF-owned entry while this pilot is the PM, from the session crate's control.
- It loads its engine with the mark of [the single write](#the-sync-engines-single-write), so the engine sends, withdraws, and puts back nothing, and every action it returns is a Run's; state sync already puts back a PM's change to a PF-owned entry ([who sends, and putting back](../sync/05-units.md#who-sends-and-putting-back)), and without the mark `authoring`'s engine would do it a second time.
- It tells `clients` when its rule for `outline` changes, as `serve` comes and goes, and sends the outline and its clear to the panels of the picker's rows.

### Reaching the sim by name

`sim-variables` is how any feature reads and writes the sim's variables and fires its events, by the names a profile writes, since that's a lower-level job than syncing, and state sync built each route only because it was the first feature to need it (user, 2026-11-22).
A feature names what it wants, and never sees the route.

| Name | Watch | Act |
| --- | --- | --- |
| `L()`, `A()` | The sim service's `watch`, every frame, on change | `write` |
| `B()` | `input`, then its subscription | A preset, as calculator code, through `HtmlAndInputEvents` |
| `K()` | `listen` | `key`, the legacy call with one value or none |
| `H()` | `h-events`, in one panel | `(>H:<name>)`, as calculator code, through `HtmlAndInputEvents` |
| `instrument()` | `instrument-reads`, in its instrument's panel | Nothing writes one ([names](01-format-and-delivery.md#names)) |

The routes are state sync's of [reaching the sim](../sync/05-units.md#reaching-the-sim) and [`H:` events](../sync/05-units.md#h-events), with their notes, moved one tier down with the same code:

- `carry.rs`'s routing becomes `sim-variables`' act: actions in the order they come, with `H:` events and presets batched into the routine's next feed.
- State sync's routine `NamedEvents` becomes the routine host's own, as `Hold` and `Camera` are, renamed `HtmlAndInputEvents` for the two kinds it fires, `H:` events, the HTML events, and input events' presets, with its slot renamed `DUALINPUT_ROUTINE_HTML_AND_INPUT_EVENTS` (user, 2026-11-22).
- `h-events` and `instrument-reads` move to `src/platform/sim-variables/panel/`, built into `/DualInput/modules/` as a feature's panel modules are, and `h-events` keeps `one_panel_module`.

Building it showed that moving these pieces moved their code but not when each starts, answers, and ends, which state sync had supplied by owning them ([profiles log](log.md#2026-11-22-building-22g-found-that-moving-state-syncs-routes-to-the-platform-moved-their-code-but-not-their-lifetimes-so-sim-variables-has-one-of-its-own)).
So `sim-variables` keeps four rules:

1. **Two lifetimes.**
   A feature's watch lasts until the feature ends it, as state sync ends its own at the profile's unload.
   `sim-variables`' side in the sim lasts one flight: its own SimConnect connection opens at its first call, and closes as this pilot leaves the session's flight, through the sim service's `close`, a feature closing its own connection, which the sim service already does at an unload for a feature marked to end with the profile.
   Within a flight it never removes a watch from the sim, since the sim client has no call that takes one back and replays every call that set the connection up after a loss; ending a watch stops handing its readings on.
   Outside a flight, an action does nothing.
2. **Shared watches.**
   It watches each variable once, by what SimConnect reads: an `L:` or `A:` by its name and unit, so `L('X')` and `L('X', 'Number')` are one, and an `instrument()` by its key, path, and type.
   It keeps each one's last reading or error, and hands it to a feature that starts watching later, since a watch already live sends nothing until the value changes (read in `src/engines/sim-client/src/client.rs`, `watch_on`, `FLAG_CHANGED`), so a profile reloaded in a test session would otherwise never read its switches.
   One listen for each `K:` event serves every feature, where two of state sync's own entries on one event had the second listen overwrite the first's handle (read in `src/platform/sim-service/src/calls.rs`, `listen_for`).
3. **The routine and the panel modules.**
   `sim-variables` feeds `HtmlAndInputEvents` on its own connection, as one unit, folding every feature's batch into its next feed, since the sim service keys a feed by its unit and rewrites it every 200ms, and two units' feeds of one slot would each read as new and fire a `_Toggle` preset again (read in `src/platform/sim-service/src/module.rs`, `feeds`); the routine runs from its first feed until the flight ends.
   `h-events` and `instrument-reads` run while some feature watches a name they serve, and when a watched `H:` or `instrument()` name comes or goes, `sim-variables` tells `clients` its rules changed, so an `instrument()` line typed mid-flight gets `instrument-reads` in its panel, and sends a running `instrument-reads` its paths again.
   `instrument-reads` takes every instrument of a panel holding one a watch names, as `h-events` does, and `sim-variables` sends it only the paths a watch names.
   So a line on another instrument of a panel already running it is read there too, since `clients` carries on a module a panel keeps with the instruments it started with.
   `clients` answers the cockpit panels only once every unit has handled the profile's load, so the modules' rules see what each feature registered as it loaded; it answered them at once, which was right only while state sync's rules read the loaded profile (read in `src/platform/clients/src/panels.rs`, `loaded`).
4. **A vocabulary of its own.**
   Its watches and actions are its own types, on the profile engine's `Name`, so a platform crate doesn't link the sync engine and its sandbox; state sync and `authoring` hand it their engines' watches and actions.

It sits on the platform's top line beside `profile-loader`, since it reads the session for the flight, above the sim service, which stays the sim seam and needs none of the profile engine's types, and above `clients`, through which it reaches the panels (user, 2026-11-22).

#### What a feature asks of it

```rust
// a sketch
let watch = cx.variables().watch(&watches);   // a handle now; each reading or firing reaches on_variables with it
cx.variables().act(actions);                  // actions in order, each by its route
cx.variables().end(watch);                    // stops handing this watch's readings on
```

- A reading or a firing reaches the feature as `Read`, with the watch's place and the value, or `Fired`, with the value it carried, and a variable the sim refuses as `Failed`, with the error's words, including an `A:` the sim refused later, as an exception.
- A watch names, for each name, whether it watches a value or occurrences, since an input event watched as an occurrence drops its first read, which says only where the input stands.
- Two features watching one variable each get its readings, and a feature that starts watching a variable already watched gets its last reading at once.

### The sync engine's single write

```rust
// in src/engines/sync-engine
impl Engine {
    pub fn write_once(&mut self, entry: &str, given: Given, cx: Ctx) -> Result<Vec<Out>, String>;   // the write of one entry, carried on by `frame` at its pace
    pub fn plan(&mut self, entry: &str, given: Given) -> Result<Vec<Planned>, String>;   // the same actions, with their spacing, changing nothing
}
pub enum Given { Value(Value), Nothing, Steps(i32) }
pub struct Planned { pub action: Action, pub times: u64, pub every: Pace }   // one for each chain, so a `repeat` of a billion previews as one line
```

- `write_once` runs the entry's write as [writing](../sync/05-units.md#writing) has it on a receiving machine, from the engine's readings, outside a sync: with no stamp, no conflict rule, and no wait behind another entry's pending value.
  Its values go pending, as a receiving machine's do, so a second Run of a stepping write before the first's last step reads back doesn't step again from a lagging reading.
- `plan` runs the same code and carries nothing on, so the preview is what Run sends; a function's `write()` calls run in its sandbox, which reaches nothing outside it ([the sandbox](01-format-and-delivery.md#the-sandbox)), and `plan` takes the engine mutably for the sandbox alone.
- A name or `toggle` whose reading already matches sends nothing, as in a sync, so a Run of an `H:` event over a switch already there flips nothing.
- Both refuse, with words `authoring` shows, an unknown entry, a `write: none`, a state entry with no reading yet, a step count for an entry that doesn't count, a value for one that does, and a counting entry whose write isn't `inc` and `dec`.
- `Steps` takes a counting entry's step count, and `Nothing` an event entry's empty field.
- An engine loaded through `Engine::load_only_asked` runs only the writes it's asked for: it takes no arrival or catch-up, and its own readings send, withdraw, put back, and stop nothing, so every action it returns is a `write_once`'s or the steps `frame` carries on for one; `authoring` loads its engine that way, and state sync goes on calling `Engine::load`.

## Budgets

Each is a starting value:

- **A value's change to its box:** within 150ms of the sim's change at p95, on the 58P, through a `clients` round of 50ms.
- **A Run:** its first action out within 100ms of Enter when the bundle is the one `authoring` holds, and within the builder's 2s ([budgets](02-units.md#budgets)) when the text changed.
- **The slice:** under the protocol's 64 KiB for a message, and its round under `clients`' 1ms ([budgets](../core/02-clients-and-panel-bridge.md#budgets)), with the 58P's profile open; its bundle, which `authoring.open` carries, was 32,651 bytes (measured on our development machine, 2026-11-22, the local folder's `bksq-baronpro.yaml`).

## Known limits

- A misspelled `L:` reads 0, with no mark ([a name the aircraft lacks](#a-name-the-aircraft-lacks)).
- Watching a name creates an `L:` the aircraft lacks, so a pause in the middle of typing a name leaves an unused `L:` in the sim until it restarts, which the SDK says doesn't keep one between runs ([03-01](../../learn/foundations/03-01-units-and-variables.md#l-and-z-local-variables)).
- A name an author types and abandons keeps its watch in the sim until the flight ends, since `sim-variables` never takes one back mid-flight, and what many such watches cost the sim's frame is unmeasured; `serve` sends names only as typing pauses.
- A revert inside one frame goes unseen.
- A counting entry's shadow value shows nowhere in the editor.
- A bundle over 64 KiB, as an airliner's with hundreds of entries may be (unverified), goes over the protocol's 64 KiB budget for a message, though it still fits under the edge's 1 MiB cap ([the WebSocket server](../core/02-clients-and-panel-bridge.md#the-websocket-server)).
- Between the extension's update and Dual Input's, which waits for the sim to close ([known limits](03-the-extension.md#known-limits)), the two are of different releases, and the panel asks for Dual Input's update rather than run.
- `authoring` serves one VS Code window, the last whose `serve` connected, and the panel of another says that a second window has the sim.
- An airliner's cockpit with many more panels than the Baron's 20 holds all of them open while `serve` is connected, and no run has timed the sockets of more than 16 ([budgets](../core/02-clients-and-panel-bridge.md#budgets)).

## Cases

On the bench, in a scenario of its own, `authoring`, with a fake `serve`, a client in `tools/bench/` that speaks the protocol, a bench core alone in a session on the stand-in sim, and a second core where a case names a crew:

- Live values: the open text's `L:`, `A:`, `B:`, and `instrument()` lines get their values, an event line and a counting map's event lines their firings, a `count:` line its value, a misspelled `L:` reads 0, a misspelled `A:` and an `instrument()` key no panel holds get their errors, and a line typed after the watch gets its value without a save.
- Run, on a profile of the scenario's own: a name, a `toggle` over a reading that matches and one that differs, a stepping write at its pace, a function with a chain and a pace, an event entry with and without a value, and a counting entry's `+3`, each making the stand-in's calls that [writing](../sync/05-units.md#writing) gives; a changed write function runs without a save; and a `toggle` right after a new bundle runs on the readings `authoring` already held.
- The preview gives the actions Run then sends, and the stand-in sees no call from it.
- The revert notice: a variable the stand-in puts back 120ms after a write gives "Back after" about 120ms; a write that holds gives nothing.
- Refused: a Run outside a session's flight, a bundle that isn't the session's profile, a Run from text that doesn't build, a Run on a PF-owned entry while this pilot is the PM, and every command from a `profile-extension` client of another release.
- With a crew: a Run on a shared entry reaches the other core through state sync, and a PM's change to a PF-owned entry is put back once, by state sync.
- A `B:` preset that state sync fed and a Run's preset in the next frame each fire once.
- Reconnecting: a `serve` that connected before the session started, and one whose core restarted, get their boxes and Run back with no edit.
- Panels: with `serve` connected at the session's start, no panel is told `none`; connected after it, every panel told `none` connects again on the next announcement, a key one of them holds never reads as no panel's, and a key no panel holds is marked only once the announcement's period has passed; a profile's reload leaves every panel open; once `serve` leaves, a panel left with nothing closes; the outline goes to the row's panels, both panels for a key two hold, and leaves the row you left.
- The slice for the 58P's profile stays under 64 KiB, and its round under 1ms.

- `sim-variables`: state sync and `authoring` watching one `L:` and one `K:` event each get every reading and firing; a feature that starts watching a variable already watched gets its last reading at once, as state sync's watches do after a test session's reload; a feature ending its watch leaves the other's running; an `instrument()` on another instrument of a panel already running `instrument-reads` gets its value, and state sync still reads its own there after a profile's reload; and leaving the flight closes `sim-variables`' connection and ends the routine.

State sync's own cases run unchanged on its routes through `sim-variables`: `state-sync`, `clients-panels`, whose panels share keys for `h-events`, `test-sessions`, and `profiles`.

As unit tests:

- The sync engine's: `write_once` and `plan` give the same actions for each form, `plan` changes nothing, and `Steps` steps a counting entry.
- `page-client`'s: a panel told `none` connects again when the `panels` count changes, and not when only the session's announcement repeats.
- `sim-variables`': an action outside a flight sends nothing, and `HtmlAndInputEvents` fed by two features in one input gets a feed for each feature's batch, which together hold each event once, in the order acted.
- The extension's, through `node --test`: a box's text for a number, a `Bool`, an event's firings, and an error; and the lens's text for each state.

By hand:

- The panel's dev page, in each state of the status line and of Run and the picker, by eye with the user.

In the sim, in one session on the 58P with `node tools/sim/authoring.ts`:

- A lever moved by hand moves its box within the budget, a switch's box follows each flip, and a misspelled `L:` reads 0.
- A Run lands by each route: an `L:`, an `A:`, a `K:` event, an `H:` event, and a `B:` preset.
- A variable the 58P puts back, if the session finds one, gives the revert notice.
- The picker lists the 58P's 20 panels, and moving the row outlines each in turn.
- State sync's routes through `sim-variables`: an `H:` event fired and heard, an `instrument()` read, and a preset called, as stage 14's session had them ([sync log](../sync/log.md#2026-11-09-stage-14s-session-in-the-sim-passed-in-four-aircraft-and-no-aircraft-took-an-h-event-our-module-fired)).

## What this changes elsewhere

- [The code map](../architecture/02-code-map.md) gains `sim-variables` and `authoring`, the routine host gains `HtmlAndInputEvents`, state sync's `NamedEvents` renamed, and state sync loses its routine and panel modules, in its note of stage 22g.
- [Sync's units](../sync/05-units.md) has state sync reach the sim through `sim-variables`, and the sync engine gain `write_once`, `plan`, and the mark of an engine that only runs the writes it's asked for, in its note of stage 22g.
- [Clients and the panel bridge](../core/02-clients-and-panel-bridge.md) has a panel told `none` connect again on a new `panels` count, and `clients` answer open panels again when a rule changes or the profile unloads, in its note of stage 22g.
- [The sim seam](../core/03-sim-seam-and-wasm-module.md)'s announcement gains `panels`, its sim service gains `close` for a feature's own connection, and `NamedEvents` becomes the routine host's `HtmlAndInputEvents`, in its note of stage 22g.
- [03-the-extension](03-the-extension.md) points here for the features that need the sim, and gains the setting `dualInput.dataFolder`, in its note of stage 22g.
- [v1's scope](../product/03-v1-scope.md#test-sessions) has the extension's live values, Run, and picker in v1, where its "Not in v1" listed live values and Run with the IDE.
- Decision 011 is unchanged, since a panel `authoring` gives a module stays by its own rule.
- The profile authors' documentation of these features is [stage 22e](../build/plan.md#22e-the-docs)'s, once 22g is done (user, 2026-11-22); it says to host a session from the EFB app to use them, what a box that never moves means, and why Run is off on an entry the PF owns.
