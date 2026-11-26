# Profiles: log

What our experiments and the build found about building profiles' bundles and delivering them to pilots, newest entry first.
TypeScript's own compiler type-checks and compiles inside the QuickJS-ng we embed, with the same results as under Node, in about 0.66s for a profile of 300 write functions once it's loaded, which takes 0.24s.
GitHub Pages answers a repeat fetch of an unchanged file with a 304 and no body.
The sandbox's context runs QuickJS-ng's base objects and lacks JSON, Map, Set, Date, and Promise, which level 1's declarations follow.
TypeScript's language service answers inside a write function in about 40ms in QuickJS-ng, and about 3ms in Node.
The probes are [p01-pages-conditional.mjs](../../../experiments/areas/profiles/p01-pages-conditional.mjs), [p02-typescript-in-quickjs.mjs](../../../experiments/areas/profiles/p02-typescript-in-quickjs.mjs), [p03-sandbox-globals.mjs](../../../experiments/areas/profiles/p03-sandbox-globals.mjs), and [p04-language-service.mjs](../../../experiments/areas/profiles/p04-language-service.mjs), and their raw output is in [experiments/areas/profiles/results](../../../experiments/areas/profiles/results).
None needs the sim.

## 2026-11-26: A `WasmInstrument` display loads and ticks like any other, and its profile's author tests whether it syncs

The profile engine failed a load on a `displays` key whose identifier is `WasmInstrument`, and the display picker showed such a row as "Can't sync" and wouldn't tick it.
That rested on our FS Copilot fork's `pointer.js`, whose header says "It must never be enabled for WasmInstrument panels: the sim owns their hit-testing and discards synthetic coordinates while latching the press" (read in the FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/pointer.js`).
That holds for the iniBuilds A350, where our fork measured it, and the header claims it of every WASM display, while nobody measured Dual Input's pointer sync on one.
What our fork measured differs by aircraft: the A380's WASM displays pressed at the position sent once told the mouse had entered them, and the A350's pressed under the receiving pilot's own cursor ([WASM instrument sync](../product/ideas.md#wasm-instrument-sync)).
v1's pointer sync fires `mousedown`, `mousemove`, `mouseup`, and `click`, and no mouse-enter event, and without one the A380's display pressed only while the receiving pilot's own cursor was on that display, or while their sim wasn't in front (measured on MSFS 2024, 2026-09-23, FS Copilot fork, `record/wasm-pointer/docs/log.md`, "2026-09-23 — The A380 presses where we say once the display is told the mouse entered it; the A350 does not").
An author's test of a WASM display then tells only with the receiving pilot's cursor on another display and their sim in front, and whether Dual Input's module behaves as the fork's did there is unverified.
So the user decided that whether a WASM instrument syncs depends on how its aircraft builds it, that Dual Input takes one in `displays` with no warning, and that a profile's author tests it in each aircraft (user, 2026-11-26).
The change stays at level 1, since CI holds a level's files only to release tags from 1.0.0 on, and nobody flies a release before it ([01-format-and-delivery](01-format-and-delivery.md)'s note of stage 22c).

Changed: the profile engine drops the error `displays-wasm`, and level 1's schemas drop the pattern that refused such a key; the display picker's rows drop `refused`, and with it the reason "Can't sync", the muted look, and the key cut to one line with the whole key in a tooltip, so a `WasmInstrument` row reads and ticks as any row does.
[01-format-and-delivery](01-format-and-delivery.md), [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md), [03-v1-scope](../product/03-v1-scope.md), and [04-room-for-later](../product/04-room-for-later.md) gain a note of it, and [WASM instrument sync](../product/ideas.md#wasm-instrument-sync), the product plan's Later pick, and [stage 19](../build/plan.md#19-pointer-sync) say so.

## 2026-11-26: The hint at the end of a `watch:` line goes, since an author who wants a verdict opens the Sync log

After using stage 22i's Sync log, the user judged the hint after each entry's first box, its latest step as `landed 84ms`, unnecessary: it repeats the log's verdicts on every watched line, beside the live values an author reads the line for, and an author who cares about a verdict opens the log (user, 2026-11-26).
A stopped entry still raises state sync's notification, and every word keeps its definition in the log.

Changed: `serve` sends the boxes alone, without a hint or the index of each entry's latest row that found it, and the extension draws the boxes alone, in one decoration type for each kind of box, which takes away the retry that kept the hint's types ordered after the box's.
[06-the-sync-log](06-the-sync-log.md) gains a note of it.

## 2026-11-26: In the sim, the lens and the island added the C172 G1000 Skis' preset to a profile whose `g1000` names its folder

We asked whether [adding an aircraft](07-adding-an-aircraft.md) works on a real load, out of any session, as the design's case in the sim has it.
In MSFS 2024, with the C172 G1000 Skis loaded and the tree's core and extension, the user reported each step as the design has it: the lens read "Add C172SP G1000 Passengers Skis", the island said `g1000` covers the aircraft through its folder, and adding its preset into a new variant, `skis`, wrote `skis: asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis`.
The case's second half, a session's profile loading on `skis`, wasn't run in the sim; the profile engine's tests cover a variant naming a preset beating one naming its folder.

## 2026-11-26: The 58P's profile load took 1,500µs, most of it state sync starting a JavaScript runtime and compiling 18 write functions, and it takes 950µs with both moved off the load

We asked why the `authoring` scenario's 58P case failed its handler budget twice in a row, with 2 inputs over 1ms where it allows 1.
We expected the profile's load, which the 2026-11-24 bench had already caught at 1,505µs.

A patch we didn't keep timed each handler of each input, in the 58P case's core on our development machine.
The load's input took about 1,500µs:

| Part | Time |
| --- | --- |
| state sync's `StateSync::load` | 860µs |
| … starting the sandbox's runtime, `Sandbox::new` | 200µs |
| … compiling the profile's 18 write functions | 350µs |
| … taking in its 183 state and 41 event entries | 165µs |
| sim variables, watching the engine's names | 240µs |
| the sim service | 180µs |
| the profile loader, most of it decoding the bundle | 140µs |

The other input near 1ms, at 810µs, was `authoring` taking in the open file's 230 names, 460µs of it in `Names::open`.
Checking for repeats with sets in place of lists left it at 457µs, so its time is spread over reading, formatting, and copying each name, and we kept the lists.

What changed:

- The sync engine compiles a write function at its first run, rather than at the load, which costs that run about 20µs.
  A function that doesn't compile stops its entry at its first write rather than at the load, and the builder refuses such a function, so only a bundle it didn't make holds one.
- State sync starts the runtime for the next profile in an input of its own: the core's first, and each profile's unload.
- State sync's load reads the loader's profile in place, rather than copying it.

Afterward the load's input took 949µs, with state sync's part at 271µs, and no input of the run took over 1ms; a second run's slowest took 940µs.
[01-plugins](../plugins/01-plugins.md) says the write functions compile at their first run, and [06-the-sync-log](06-the-sync-log.md) and [05-units](../sync/05-units.md) gain a note of it.

## 2026-11-26: Two bundles that cover one aircraft let a stale one win, in the local folder by file name and in the index by path

**Asked:** when two bundles cover a session's aircraft, which does the PF's loader pin, and does anything warn?

**Expected:** the author's latest bundle, or the profile's latest published one, since [the local folder](02-units.md#the-local-folder) holds one bundle for each profile, and CI refuses two profiles that cover one folder or preset.

**Found:** in two places a stale bundle could win, and nothing warned (read in our code, 2026-11-26):

- The local folder keeps a renamed profile's old bundle, since the profile extension names each bundle for its profile's file ([writing a bundle there](02-units.md#writing-a-bundle-there)) and deletes none.
  `Local::covering` and `Local::status_of`, in `src/platform/profile-loader/src/local.rs`, took the first bundle by file name that covered the aircraft, so at a session's start, a profile renamed from `asobo_c172sp.yaml` to `asobo_c172sp_g1000.yaml` would pin its old bundle, since `.` sorts before `_`.
  A save during a session pinned the right one, since `test_sessions.rs` pins the newest bundle that changed.
- `publish`, in `tools/profile-builder/src/publish.rs`, refuses two profiles in `profiles/aircraft/` that cover one folder, but `Index::add`, in `src/engines/profile-engine/src/index.rs`, never drops an entry, so a renamed or deleted profile's old path stayed in `index.json` and still covered its folders.
  The PF's loader, `Profiles::choice` in `src/platform/profile-loader/src/lib.rs`, takes the first entry in path order that covers the aircraft, so it could take the old path's bundle, and the EFB app's list of supported aircraft showed both.

The user turned down two other fixes for the local folder: the extension deleting a renamed profile's old bundle, which misses a rename made in git or Explorer, and refusing to pick between two bundles as new (user, 2026-11-26).

**Changed:** stage 10b ([build plan](../build/plan.md#10b-two-bundles-that-cover-one-aircraft)): of the local bundles that cover an aircraft, the one whose file changed last wins, and `publish` drops each profile whose file is gone, with two known limits the user took (user, 2026-11-26).

**Affects:** [02-units](02-units.md)' note of stage 10b.

## 2026-11-26: The sim's aircraft store lists an aircraft's variations with their folders, but names a preset's path for only 3 of 8 aircraft, so adding an aircraft takes its path from a load

We read the world map's store in the menu's document, `mainUi`, through the inspector with [p06-aircraft-store.mjs](../../../experiments/areas/profiles/p06-aircraft-store.mjs), changing nothing, to see whether a variant picker can list an aircraft's presets before the author loads each.
The sim reports a preset's path only when it loads one, since the core's aircraft changed at each load and never while the world map's selection did (measured on MSFS 2024, 2026-11-26, [the core's lines](../aircraft/results/2026-11-26-c172-and-pc-6-loads.txt)).
We expected each variation's name and its folder, since p08 found that an aircraft's entry names its folder in its thumbnail's path ([interface log](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)), and no preset's path.

We read the store four times, measured on MSFS 2024, 2026-11-26, the first two by p06's first version:

| Read | Where the sim was | Selected |
| --- | --- | --- |
| [At the world map](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-04-17-first-version-at-the-world-map.json) | The world map, no cockpit open, on a page we didn't note | The Pilatus PC-6, "Classic / Wheels" |
| [In the PC-6](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-10-45-first-version-in-flight.json) | A flight in it | The same |
| [In the C172](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-12-35.txt) | A flight in the Cessna 172, "Basic", which loaded as `asobo_c172sp/presets/asobo/c172sp_classic_passengers` | "Basic" |
| [At the PC-6's configuration page](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-31-07.txt) | The world map, on the PC-6's page of variations, which the user opened for it | The PC-6, "Classic / Wheels" |

Found:

- `game/aircraft/configurator/items` lists the selected aircraft's variations, each a `ConfiguratorItem` with an `id`, a `title`, an `imageUrl`, and a `directoryPath`, which was empty on every item: the PC-6's 4 at the world map and in its flight, and the C172's 19 in its flight.
- In a flight, the store still holds the loaded aircraft as `game/aircraft/currentAircraft`, and its configurator's items, with the loaded variation's `isSelected` true.
- The store holds the C172 as one aircraft, "Cessna 172 Skyhawk", whose 19 variations span both its folders.
  It titles them "Basic", "G1000 Skis", "IFD Amphibious", and so on, where `A:TITLE` reads "C172SP Classic Passengers".
- Each C172 item's `imageUrl` sits in its preset's own folder, as `coui://html_ui/VFS/SimObjects/Airplanes/asobo_c172sp_g1000/presets/asobo/c172sp_avionics_passengers_skis/thumbnail/thumbnail_variation.png` does, and the three C172 presets loaded that day reported exactly the paths their pictures name.
- The PC-6's pictures sit under its liveries, as `microsoft-pilatus-pc6/liveries/microsoft/gauge_wheels_01/thumbnail/thumbnail_variation.png` does for "Classic / Wheels", whose load reported `microsoft-pilatus-pc6/presets/microsoft/pc-6_gauge_wheels`.
  So the store gives the PC-6's folder and not its presets' paths.
  On its configuration page, the PC-6's 4 items read as they had before, pictures and all, so the page the pilot is on didn't change them.
- On the PC-6's configuration page, `game/aircraft/aircraftList` held 1 entry, the PC-6's, where it held 138 in the first read and in both flights; the menu script's Join asks for `game/aircraft/updateAircraftList` before it reads the list, and whether that brings back all 138 on this page is unverified.

The user then opened six more aircraft's configuration pages at the world map, one at a time, to see how far the pictures go:

| Aircraft | Built | Its variations' pictures | Read |
| --- | --- | --- | --- |
| Black Square Baron 58P Professional | Not modular, `isModular` false | 1 item, its livery "N513LW", at `bksq-aircraft-baronpropress/texture.N513LW/thumbnail.png`: the folder, which is all an aircraft built this way has | [p06](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-34-53.txt) |
| iniBuilds A380-800 | Modular | 4, each in its preset's folder, as `inibuilds-a380/presets/inibuilds/a380-800_rr` for "A380-800 RR Cabin" | [p06](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-37-32.txt) |
| iniBuilds A350-900 | Modular | 2, each in its preset's folder, `A350/presets/inibuilds/a350-900_default_cabin` and `a350-900_no_cabin`, the folders [01-format-and-delivery](01-format-and-delivery.md#the-aircraft-and-its-variants) read in inibuilds-aircraft-a350 1.2.6 | [p06](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-39-21.txt) |
| Fenix A320 IAE WF | Modular | 1, "Standard", under its liveries, `FNX_32X/liveries/fnx/FNX_320_Fenix_IAE_WF/thumbnail/thumbnail.png`, where the folder holds 20 presets across fnx-aircraft-320 and fnx-aircraft-319-321 on disk | [p06](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-40-09.txt) |
| PMDG 777-300ER | Modular | 1, under its liveries, `PMDG 777-300ER/liveries/pmdg/…`, where the folder holds one preset, `PMDG 777-300ER/presets/pmdg/PMDG 777-300ER` | [p06](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-41-32.txt) |
| A2A Aerostar 600 | Modular | 1, "Default", under its liveries, `aerostar600/liveries/a2a/ni22pc/…`, where the folder holds one preset, `aerostar600/presets/a2a/Base` | [p06](../../../experiments/areas/profiles/results/p06-aircraft-store-2026-11-26-12-42-25.txt) |

The presets on disk are read in each package's `SimObjects\Airplanes\<folder>\presets\` folder.

So across the 8 aircraft, every picture named its aircraft's folder, and the pictures named presets' paths for the C172, the A380, and the A350 only, where their developers put each variation's picture in its preset's folder.
No picture named a wrong preset, and which aircraft's pictures name one turns on where each developer put a file, so the store is no source of a preset's path.

Changed: the variant picker this was for takes nothing from the store; [07-adding-an-aircraft](07-adding-an-aircraft.md) adds the loaded aircraft by the path the core matches, its folder or its preset, and an author adds each preset that needs a variant of its own by loading it (user, 2026-11-26).
Docs affected: 07-adding-an-aircraft.

## 2026-11-26: In the sim, the Sync log's five cases passed on the 58P, and a step reached the extension 1.2ms after its input at p95

We ran `tools/sim/sync-log.ts` on MSFS 2024, alone in the Black Square Baron 58P Professional 0.1.1, cold and dark at a stand, to see whether the log holds up against the real core and sim, and to measure [a step to the view](06-the-sync-log.md#budgets) against its 150ms at p95.
We expected the cases to pass and the step to come well inside its budget, since state sync sends each engine call's steps in one message as the call returns.

All five passed (measured on MSFS 2024, 2026-11-26, [the run's report](results/2026-11-26-sync-log-in-the-sim.txt)):

- The beacon switch, flipped on and off twice by hand, gave 4 rows, one per flip, each a local change, then sent.
- The recording, of the battery, the heading knob, and the autopilot's ALT and VS buttons, held every change the stream sent of each: `battery` 2, `heading_bug` 64, `ap_altitude_hold` 2, and `ap_vs_hold` 1.
- Playing it back first put back the cockpit's state at Record, as 180 rows from the playback, each with a catch-up's value.
  It then played each recorded change as a row of its own: `battery` 2 of 2, `heading_bug` 64 of 64, `ap_altitude_hold` 2 of 2, and `ap_vs_hold` 1 of 1, and 3 more of entries the recording moved with them, `flight_director` twice and `ap_altitude` once.
  Of the playback's 252 rows, 72 landed, read back 32ms after their first step at the median and 133ms at most; 179 found the cockpit already at their value, as most of the putting back did; and 1 ended on a token used.
- A step reached the extension 0.4ms after its input at p50, 1.2ms at p95, and 2.1ms at worst, over 1,014 steps in 438 messages, against 150ms at p95.
- The core's replay of its recording replayed 64,553 inputs, and all 178 checkpoints matched.

A first run's recording case confused the pilot running it: right after the battery came on, the Baron's heading seemed to move on its own, likely the HSI's card swinging as its gyro spun up (unverified), so it read as the script moving the knob.
The guided prompts don't say that the recorder records only what the pilot does from Record to Stop.

Nothing in the design changes.
Docs affected: none.

## 2026-11-26: The Sync log's copy pass renamed five steps, dropped `goes`, and draws a bug in the profile in red

A copy pass over every word in place, on the dev page's `Every word` scene, asked whether each word and its definition reads once for an author who hasn't read the engine.
We expected the definitions to change and the words to hold.
Five words changed with them, and so did the look of a bug and of a value (user, 2026-11-26):

- `not sent before Ready` became `not sent during preflight`, `shadow taken` became `shadow restored`, `waits behind` became `waits for`, and `brought` became `now reads`, in the engine as in the log, since the log and the code share one word for each thing; the engine's queue of waiting writes is `waiting`.
- `unchecked` became `warning skipped`: the engine checks a following machine's write of what the pilot flying owns like any other, and only skips the `never landed` warning when it doesn't read back, so "unchecked" named something that didn't happen, and the user couldn't tell what the step meant from it.
- `withdrawn` always names its reason after a colon, as `stopped` does: `lost`, or the new `undone`.
  Before, only `lost` showed, after a comma, and the other reason went unnamed.
  So `withdrawn`'s definition says what withdrawing is, and each reason's definition says why.
  A colon comes before a second word that says why, and a comma before one that adds a further fact, as `read back 1, landed`.
- `goes` left the log: the step after it lands at the same moment and already shows the write's turn came.
- A bug in the profile shows in red, on the step that met it and on its row's line (user).
  The bugs are a write function that threw, an entry stopped because its function failed to compile or ran out of time or memory, a read the sim refused, and an event entry whose write sets a variable from an event that carries no value.
  What the aircraft or the sim did wrong stays in the kit's warning amber.
- A value in the log takes the profile's syntax colors, teal for a number and the string color for a text, where [the draft](#2026-11-25-the-sync-logs-draft-shows-a-steps-time-only-where-time-passed-and-a-live-value-turns-lime-everywhere) gave every value lime: each is what a step saw or wrote at its time, and lime means the sim's value right now, in the box after a `watch:` line and in the Dual Input panel's Run (user).
- The Dual Input panel's title bar has a button of VS Code's own, Show Sync log, so an author who reads the side bar doesn't miss the log in the bottom panel; the log's tab keeps the name Sync log, since a second view of ours in the bottom panel couldn't share a tab name of Dual Input with it (user).
- `ignored` and `ignore expired` carry the event the entry's `ignore` lists, as `ignored K('TOGGLE_STARTER1')`, which the engine knew and the step left out.
- Each word's definition is a sentence or two of what happened, in the words the profile format gives an author, at most 34 words, which the words' test checks: a step's own act in the past tense, waits included, since the log is a record, and a rule or what still holds in the present (user).

Docs affected: [06-the-sync-log](06-the-sync-log.md), in a note of this entry; [05-units](../sync/05-units.md), whose note of stage 22i gives the new words; and [interface decisions](../interface/decisions.md#the-apps-take-shadcns-luma-look-at-a-4px-radius-on-neutral-grays-with-tailwinds-sky-300-as-the-main-color-and-geist), whose live-value lines give the Sync log's values the profile's syntax colors.

## 2026-11-25: The Sync log's draft shows a step's time only where time passed, and a live value turns lime everywhere

Refining the Sync log's view by eye with the user, on its dev page, asked whether the design's view held once drawn.
We expected the words and the look to change, which the design leaves to the draft, and the rows and steps to hold.
They held, as a row that opens in place to its steps in order, and two parts of the design changed (user, 2026-11-25):

- **A step's time shows only where time passed.** [06-the-sync-log](06-the-sync-log.md#what-an-author-sees) gives each step its time from the row's first; the draft shows it, as `+212ms`, only on a step that came later than the one before, since most steps take no time and an author reads their order, not their milliseconds (user).
- **A live value is lime.** [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md#the-box) draws a watched value in our sky, after fsc-editor's blue box, where blue meant the sim alone; sky is our main color here, and green already means a session's sync is on, so a value read from the sim takes a lime of its own, the kit's `live` ([interface decisions](../interface/decisions.md#the-apps-take-shadcns-luma-look-at-a-4px-radius-on-neutral-grays-with-tailwinds-sky-300-as-the-main-color-and-geist)), in the box after its line, in the Dual Input panel, and in every value the Sync log shows (user).
  Teal, the profile's color for a number, then means only a number its author wrote.

The draft also settled these, which the design left to it:

- Entry keys and the parts of a write's name calls take the token colors the extension's manifest gives the profile grammar's scopes, the ones VS Code paints a profile with, in the palette the profile takes (user).
- An open row rises into a card, its steps run down a rail with a mark on each, and each row's verdict carries an icon: trouble, done, under way, or ended with nothing to do.
- The kit gained shadcn's empty state, in its Luma style, with a compact size for a short panel, a flat look for a field over a list, and a link in the text's own color.

A panel 640px wide left the verdict's column no room, since a grid shares the room out to the columns before it first, so the column keeps 8rem.

Docs affected: [06-the-sync-log](06-the-sync-log.md) and [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md), each in a note of this entry.

## 2026-11-25: Building stage 22i's Sync log changed five parts of its design, and its log costs nothing while off

Building the Sync log ([06-the-sync-log](06-the-sync-log.md)) and its code review asked whether the design held as written.
We expected it to.
It held in most of its parts, and these five changed, each with the user, on 2026-11-25:

- **A takeover moves a run's values.** When a newer row of an entry takes over an older row's stepping write, the values the older row's steps left pending, and a counting entry's tokens, belong to the newer row from then on, whether the log is on or not. Before that fix, a reading that lagged the steps read back on the older row, which could end `landed` at a value it never reached, as a crewmate's course knob turned 90 to 95 and then to 100 showed in an engine test.
- **Keys, not names.** A row, a step's links, and the hint name an entry by its key, since an author writes the key and the filter box matches it, so `serve` looks up no `name:` (user).
- **The extension keeps a copy of the rows.** `serve` keeps the last 10,000 rows and sends the rows that changed; the extension keeps a copy of them too, since VS Code throws away a hidden view's page, and repaints the view from it when it opens, with no request to `serve` (user).
- **The decisions' cases are the engine's tests.** Each of the design's cases about what the engine decides runs as a test of the engine alone, which checks each step exactly in about 2s; the bench scenario `sync-log` keeps the four that need a core: when state sync sends, whom a row names, a playback's rows, and the log's cost with a lever moving (user).
- **The hint draws in decorations of its own.** VS Code orders two texts after a line's end by class names from a counter every extension shares, so the hint takes two decoration types of its own, made right after the boxes', which the extension makes again once if they sort out of order (read in VS Code 1.147.0's source); the code review judged that it earns its place.

`serve` also keeps the session's profile files once the session ends, so an entry's link opens its line in a closed file after the flight.

The log costs nothing while it's off.
We timed the same engine calls in-process, with the log off, on the stage's starting commit, 30c50a4e, and on the stage's code: 200 entries, each round an arrival, its read back, a local change, and a frame, the best of 7 runs, alternating the two on our development machine at 5% to 9% CPU.
The first cut took 710ns to 754ns a call against 622ns to 692ns, since some branches cloned a value for their step before the log's check and the frame's check gathered what only a step needs; with those behind the check, and the check skipping an empty list of values to compare, the stage's code took 453ns and 461ns a call against 627ns and 635ns.
That last saving is larger than the log's own checks, so their cost can't be read apart from it.

On the bench, with the log on and a lever moved for 3s, state sync sent 247 messages, the largest 253 bytes against the protocol's 64 KiB, and the slowest input took 383µs against the code map's 1ms.

Docs affected: [06-the-sync-log](06-the-sync-log.md), in its note of this entry.

## 2026-11-24: The recorder's messages reached the stream within 3.8ms of their recorded times, and a recording held about 205 bytes an entry

**Asked:** do the recorder's two [budgets](05-the-recorder.md#budgets) hold, a message's arrival within 20ms of its recorded time, a sample's included, and what a recording's message costs in memory; and do the stage's scenarios pass on main with the session's two restart fixes?

**Expected:** arrival within a few ms, since `tape` sets a timer for each message's time, and a recording small enough to need no cap.

**Found:** on our development machine, 2026-11-24, with nothing else loading the PC, `node tools/bench.ts tape flight-model session` passed all 40 of its tests on main at `0eaca55e` with the stage on top, and `node tools/check.ts` passed all 19 checks on the same tree:

- `tape` logs how late its timer handed each playback's messages over, from the inputs' stamps, and the loop's stats for the run give the longest any input then waited in the queue, so their sum bounds how late a message reached the stream.
- Two playbacks of 13 messages each: the timer at most 0.5ms and 0.7ms late, and an input at most 3.1ms in the queue, so at most 3.8ms, against 20ms.
- A playback of 71 samples along a turn: the timer at most 0.5ms late, and an input at most 2.8ms in the queue, so at most 3.3ms.
- `tape` counts what a recording holds on the heap as its lists' slots, spare ones included, and each entry's key and body, without what the allocator adds: 13 messages took 29,830 bytes, most of it the catch-up's payloads at Record, and 71 samples over 3,527ms took 14,528 bytes, about 205 bytes an entry.
- At 205 bytes an entry, an hour of a lever moved without a pause while the aircraft flies, 144,000 entries, holds about 30 MB, so a recording needs no cap (arithmetic).

The stage's code review found that `tape`'s own figure left out the queue's wait, which is why the bench adds the loop's.

**Changed:** nothing; each budget holds.

**Affects:** [05-the-recorder](05-the-recorder.md)'s budgets.

## 2026-11-24: In the sim, playbacks flew the 58P back along its recorded paths, with `Follow` from Play to the end

**Asked:** do the design's two [cases in the sim](05-the-recorder.md#cases) for flying the recorded path hold in the 58P: the aircraft back where it stood at Record, the path flown with the cockpit's changes, and control back at the end?

**Expected:** what the bench's path case found in the entry below.

**Found:** in MSFS 2024, 2026-11-24, with the tree's release core, in the Black Square Baron 58P Professional 0.1.1 in the air, in a session of one ([the core's lines](results/2026-11-24-flight-model-replay-in-the-sim.txt)):

- The user made 6 recordings, of 4.1s to 175.4s, and each took 20 samples a second, from 81 in 4,077ms to 3,506 in 175,379ms.
- 4 of them held no cockpit change, one held 111 changes in 18.5s, and one 56 in 175.4s.
- Of 10 playbacks, 5 ran to their end, each within 1ms of its recording's length, the user stopped 4, and 1 stopped as the user went to the sim's main menu, which ended the session.
- Each Play started `Follow`, and each end or stop started `Lead` again, in the same input.
- The loop took 8 to 23 inputs over 1ms a minute, of about 26,000, alike in the minutes a playback ran and those it didn't.

The user watched each playback and found that it worked well.

Not measured: how far the aircraft strayed from its recorded path in the sim, and whether the 4 playbacks with no cockpit change put the aircraft back at once or eased it back over 3s.
The user judged that the second doesn't matter.

**Changed:** 05-the-recorder's known limits take the ease back over 3s, and its cases in the sim drop the case that would have watched for it.

## 2026-11-24: A playback flew the stand-in's aircraft back along a recorded turn within 0.09m of the recorded path

**Asked:** does a playback put the aircraft back at the recording's first sample at once, hold it there while the cockpit is put back, fly it along the recorded path, and let it go at the end, as [flying the recorded path](05-the-recorder.md#flying-the-recorded-path) has it; and does `Follow` running through a playback leave flight-model sync's own scenario as it was?

**Expected:** the played path within 5m of the recorded one, and `flight-model` passing as before.

**Found:** on our development machine, 2026-11-24, `node tools/bench.ts tape flight-model` passed all 7 of `tape`'s tests, the new path case among them:

- A recording of 3,536ms, with a 45° turn in it, held 71 samples, against 20 a second.
- As Play was pressed, the aircraft froze and went back to the recording's first sample in one frame, and held there 2,450ms, while the cockpit stream's test unit held the putting back open for 2s.
- It moved 456ms after the bench saw the playback's messages start, and flew the recorded path, the turn included, within 0.09m of where the recorded aircraft was one time shift earlier.
- Once the playback ended, it was unfrozen and flew on at its recorded speed, and `Lead` ran again.

In the same run, `flight-model` passed 6 of its 7 tests: James's core took 2 inputs over 1ms, the slowest 1,858µs, against one allowed under 2,000µs, while the sim and a review agent ran on the PC.
`node tools/bench.ts flight-model` alone passed all 7, each core with one input over 1ms, at 1,838µs and 1,820µs.

The code review found that a playback timer firing about 25s late, as after a debugger held the core, would hand 500 samples to the kernel in one input, past the 1,000 queued calls at which it panics, so `tape` hands over at most 100 messages an input and the rest in the inputs after.
It also found that when a playback's catch-up has nothing to write, the put-back and the first played sample can reach `Follow` in one frame of our module, which [flying the recorded path](05-the-recorder.md#flying-the-recorded-path) now leaves to a case in the sim.
After the fixes, `node tools/bench.ts tape flight-model` passed all 14 tests, the played path within 0.18m of the recorded one.

Not measured: the memory a recording's samples take.
Not yet run: the design's two cases in flight in the sim.

**Changed:** 05-the-recorder's flying the recorded path, with the unmeasured case of two feeds in one frame, and its cases in the sim.

## 2026-11-24: Stage 22h's recorder passed its bench scenario, and a playback that ended mid-step had left the stream pretending

**Asked:** do the recorder's [cases](05-the-recorder.md#cases) hold on the stand-in sim, and does the cockpit stream's pretend sender leave every other scenario as it was?

**Expected:** each case passes, and the whole bench as before.

**Found:** on our development machine, 2026-11-24, `node tools/bench.ts tape` passed its 5 tests:

- Play put each recorded entry back to its value at Record before the first played change, then played the changes in order, with a lamp's toggle after the heading knob's last step, and a pause recorded as 5,690ms to 5,723ms played as 5,723ms to 5,729ms.
- A second Play made the same calls as the first: 30 `HDG_INC`, 40 `HDG_DEC`, 2 `TOGGLE_LAMP`, 1 `AP_MASTER`, 3 `COM_INC`, and 5 `COM_DEC`, with the same writes.
- No banner notification showed while a playback's catch-up ran.
- A crewmate joining during a playback stopped it, the slice named them, and their catch-up and the messages after it ran with nothing left waiting in their stream.
- Stop while restoring and while playing left nothing waiting, and a crewmate who joined after a Stop mid-step waited on nothing.
- A save stopped a recording and a playback, and Play was refused while the reloaded profile loaded.

The scenario's first run found that a playback that reached its end while a knob still stepped left the stream pretending, so a crewmate who joined then waited on the pretend sender's counter for good: `tape` stopped the stream's pretending only when something ran.
The stage's code review found the same, and `tape` now stops it on every join and unload, after which the scenario passed.
Stop while restoring left a toggle that state sync held behind a knob's steps to go, which [when the recorder works](05-the-recorder.md#when-the-recorder-works) now says.

The whole bench passed 201 of its 202 tests in 57 minutes.
`authoring`'s check that every input takes under 1ms failed, with 2 inputs at 1,505µs early in its run, while other scenarios' cores shared the CPU, and `node tools/bench.ts authoring` alone passed all 8.

In the sim on MSFS 2024, 2026-11-24, the user recorded the 58P's battery, avionics master, heading bug, and left mixture with the tree's core and extension, moved them, and played the recording: the cockpit went back to where it stood at Record, and the changes played in order at their pace.

Not measured: the recorder's budgets of 20ms for a message's arrival, beyond the pause above, and of a recording's memory.
Not covered: the 58P's vertical-mode case, since the stand-in has no vertical-mode rules, and a new value cutting a knob's steps short, which the stand-in's calls can't tell from steps that ran out.

**Changed:** 05-the-recorder's line on Stop.

## 2026-11-23: Stage 22g's session in the sim passed its 32 cases in the 58P, every budget held

**Asked:** do the [cases](04-the-extension-in-the-sim.md#cases) and [budgets](04-the-extension-in-the-sim.md#budgets) of live values, Run, and the display picker hold in the sim?
`tools/sim/authoring.ts` had a real core flying the Black Square Baron 58P Professional host, and a bench core on a stand-in join as the second pilot, and played the extension's `serve` with the tree's `bksq-baronpro.yaml` open.

**Expected:** each case passes, as on the bench.

**Found:** on MSFS 2024 on our development machine, 2026-11-23, the night's last run passed all 32 cases, with none skipped ([results](results/2026-11-23-authoring-in-the-sim.txt)).

| Budget | Measured | Against |
| --- | --- | --- |
| A box after the sim's change, at p95 | 24ms for the left mixture lever over 176 changes, 27ms for the beacon switch over 8 | 150ms |
| A Run, from the command to the panel's reading | 21ms to 60ms, over the 10 timed Runs on `L:`, `A:`, `K:`, `B:`, and `H:` entries | 100ms to its first action |
| The slice with every name open | 21,948 bytes | 65,536 bytes for a message |

A Run's time runs from the command to the panel's reading, a frame or more after the first action went out, and the panel's clock read from -17ms to 55ms off the PC's, so the slowest Run's first action went out within 77ms.
The slice's round with the 58P's profile open is a bench case, and the `authoring` scenario passed it in CI on 762d432f.

The rest of the run:
- All 225 names on the profile's watch lines got a value or firings within 30s, and a misspelled `L:` read 0.
- Three test buttons that spring back gave the revert notice, after 49ms to 83ms, and the transponder's code, which holds, gave none.
- The picker listed the 58P's 20 panels, outlined each row's instrument in its own panel, and cleared every outline as it closed.
- State sync's routes through `sim-variables` held: our module fired a burst of two `H:adf_SetRst`, the `h-events` module heard the pilot's SET RST, `instrument-reads` saw BFO change the KR87A's `bfoMode`, and the second pilot's battery switch moved the 58P's through its preset 84ms and 97ms after.
- The real core's loop was 1.57% busy in the last minute, its slowest input took 4,718µs in the first minute and 1,838µs in the last, and 3 to 11 inputs a minute went over 1ms, with the sim running on the same PC.
- The replay of the core's recording matched all 193 checkpoints.

The first runs that night stopped at the script's 20s wait for the second pilot's catch-up, which crawls because its stand-in takes none of the 58P's writes ([sync log](../sync/log.md#2026-11-23-a-catch-up-crawls-when-its-writes-never-land-since-each-toggle-stepping-write-or-write-function-waits-out-the-15s-check-of-the-write-before-it)).
In the next two, the script waited up to 90s, and the catch-up took 24.6s and 26.1s.
The first of those was stopped partway, and the second ran every case and failed five, each on how the script measured:
- The left mixture lever's box read 11,448ms behind the lever at p95, and the beacon's 2.7s behind its switch, the spacing of two flips, since the script paired each change of a box only with the panel's frames before it, and a box can show a value before the panel's frame reads it, so the script looks up to 100ms past the box's change.
- `adf_bfo`'s second Run, sent 126ms after its first, moved nothing, since a toggle decides from the core's last reading and `instrument()` reads every 250ms, so the script waits for the box to show the first Run's value.
- `annunciator_test` and `audio_marker_test` gave the notice after 32ms and 28ms, and the panel read no change, since the button sprang back within one of its frames, so the script skips a revert case whose notice comes within two of the panel's frames while the panel reads no change.
  In the last run the panel read both buttons back after 36ms and 34ms, so a later run may skip them.

**Changed:** the script, in e0f36bd8; nothing in the product.

**Affects:** [stage 22g](../build/plan.md#22g-the-extension-in-the-sim)'s exit.

## 2026-11-22: Building 22g found that moving state sync's routes to the platform moved their code but not their lifetimes, so sim-variables has one of its own

**Asked:** does [stage 22g](../build/plan.md#22g-the-extension-in-the-sim)'s design for the platform's routes by name, which moved state sync's watches, writes, routine, and two panel modules one tier down for every feature, hold against the code it changes ([reaching the sim by name](04-the-extension-in-the-sim.md#reaching-the-sim-by-name))?

**Expected:** a move of the same code, with each call made on the connection of the feature that asked.

**Found:** the agent building it stopped before changing a file, and the sync engine's single write showed a fourth gap; each was something state sync had supplied by owning the piece, which the move left behind (read in the tree at 490966f8):

- **Order.** `clients` answered every cockpit panel at the profile's load (`src/platform/clients/src/panels.rs`, `loaded`), which was right while state sync's rules read the loaded profile; with rules that ask what features watch, the answer came before state sync's watches arrived, so every panel would have been told `none` and closed.
- **Lifetime.** Only a profile's unload closes a feature's connection and ends its routines, and only for a feature marked to end with the profile (`src/platform/sim-service/src/connections.rs`, `unloaded`), so `NamedEvents`, moved into the platform, would have run on after every session.
- **Scope.** Failing an `instrument()` as "no panel holds" its key is true only while the extension keeps every panel, so in the platform it would have failed state sync's entries whenever a profile loaded before its panels said hello.
- **Role.** A sync engine loaded to run single writes still put back a PM's change to a PF-owned entry, which state sync already does, and the builder's way around it, telling that engine preflight never ended, used a flag for its side effect.

The user asked why, and what we'd missed: the design said where each piece lives and never walked when each starts, answers, and ends, through the code; the review round had walked authors' scenarios, not the core's load, reload, and teardown (user, 2026-11-22).
A second walk, of a reworked design through the core's start, a profile's load, a test session's reload, control passing, leaving the flight, a second flight in one run, a lost connection, and the sim closing, held once four rules were stated, and we read the code behind its claims: a watch reports only changes (`src/engines/sim-client/src/client.rs`, `watch_on`), the sim client can't take a watch back since its setup only grows, `clients` stops every module at an unload and answers no panel with no profile loaded, and two of state sync's entries listening to one `K:` event have the second listen overwrite the first's handle (`src/platform/sim-service/src/calls.rs`, `listen_for`).

**Changed:** the user took the reworked crate on 2026-11-22, named `sim-variables`, with state sync's `NamedEvents` renamed `HtmlAndInputEvents`: one connection and one lifetime of its own, a flight, closed through a new `close` in the sim service; watches shared by what SimConnect reads, with each one's last reading kept for a feature that starts watching later; its panel modules running while a feature watches what they serve, with `clients` answering the panels once every unit has handled the load; and its own types for watches and actions on the profile engine's `Name`. The no-panel check went to `authoring`, and the sync engine gained the mark of an engine that only runs the writes it's asked for.

**Affects:** [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md), edited in place before its first commit, and the notes of stage 22g in [the code map](../architecture/02-code-map.md), [sync's units](../sync/05-units.md), [clients and the panel bridge](../core/02-clients-and-panel-bridge.md), and [the sim seam](../core/03-sim-seam-and-wasm-module.md).

## 2026-11-22: Stage 22d's language server answers inside a script within 73ms at p95 on the 58P, and the scenarios whose bundles changed pass

**Asked:** do [stage 22d](../build/plan.md#22d-the-profile-extension)'s budgets hold ([budgets](03-the-extension.md#budgets)), and do the bench's scenarios that load the 58P's bundle, whose bytes the stage changes by putting `seats` last, still pass?

**Expected:** requests inside a script near p04's 40ms in QuickJS-ng, and the scenarios passing as before.

**Found:** on our development machine, with a release build of `dualinput-profile-builder`, [p05](../../../experiments/areas/profiles/p05-language-server.mjs) drove `serve` over stdio as VS Code does, on the 58P's profile, with 30 runs of each request, each right after an edit, the PC otherwise idle ([results](../../../experiments/areas/profiles/results/p05-language-server-2026-11-22-14-16-43.txt)):

| Request | p50 | p95 | Budget |
| --- | --- | --- | --- |
| Completion after `state.` | 53.1ms | 72.9ms | 100ms at p95 |
| Signature help in `write(` | 46.4ms | 64.4ms | 100ms at p95 |
| A hover on a key of `state` | 44.8ms | 65.6ms | 100ms at p95 |
| The engine's checks on a keystroke, from `didChange` to the diagnostics, stdio included | 1.9ms | 2.2ms | 20ms |

- The server answered `initialize` 535ms after its process started, against 1s, and its first completion in a script 798ms after, which took 262.8ms itself, as TypeScript built its first program; an earlier run of the same probe gave 282ms and 539ms.
- In a QuickJS-ng runtime of its own, TypeScript's language service took 253ms to load, a list of completions with no edit before it 5.5ms, one item's details 2.5ms, and the details of all 183 of the 58P's keys at once 410ms, so the server fetches an item's details as the editor highlights it.
- `node tools/bench.ts state-sync clients-panels profiles test-sessions` passed 36 of 36 cases ([results](results/2026-11-22-stage-22d-bench.txt)), and `node tools/check.ts` passed its 19 checks, `format --check` on `profiles/` among them.
- The formatter changed the 58P's profile only by moving `seats` last and refilling six paragraphs of comment to 100 columns; its bundle's hash is `1cd007862a57eb56e1ff8c9c262dae14bb055b43d71d8039b5fd56266da8e3a6`, the same before and after the format, since a bundle holds no comments.

**Changed:** nothing; each budget holds.

**Affects:** [03-the-extension](03-the-extension.md)'s budgets.

## 2026-11-22: The profile extension's design finds what VS Code reads of a .vsix and a language, what vsce costs, and what Zed allows, and the format puts seats last and takes single quotes

**Asked:** what does [stage 22d](../build/plan.md#22d-the-profile-extension)'s profile extension lean on: how VS Code gives a file a language and installs a `.vsix` from disk, what Microsoft's packer, vsce, would cost us, where an installed Dual Input names its version, and what Zed lets an extension do, since the user weighs Zed as a base for the Dual Input IDE?

**Expected:** that a `.vsix` VS Code installs needs the manifest vsce writes.

**Found:** on our development machine:

- VS Code 1.140.0 turns each of an extension's `filenamePatterns` into a file pattern, matches a pattern that holds a `/` against the file's whole path, ignoring case, and takes a file name's match over a pattern's, and a pattern's over a file extension's (read in VS Code 1.140.0, `resources/app/out/vs/workbench/workbench.desktop.main.js`).
- Installing a `.vsix`, VS Code 1.140.0 reads the extension's manifest from `extension/package.json` in the zip, and no bundle of its code holds the string `.vsixmanifest` (read in `resources/app/out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js`).
- vsce 1.0.0, published 2015-12-16, writes a `PackageManifest` of version 2.0.0, with `Microsoft.VisualStudio.Code` as its installation target and `extension/package.json` as its manifest asset, and `@vscode/vsce` 4.1.1, published 2026-11-16, writes the same, with optional properties added for the Marketplace: the engine, dependencies, the target platform, pre-release, and a sponsor (read in each npm package, `resources/extension.vsixmanifest` and `out/package.js`).
- `@vscode/vsce` 4.1.1 on its own installs 135 packages and 50.4 MB, in 11.6s from an empty cache and 6.5s through a warm `npm ci`, with install scripts off, where the root's lockfile holds 218 packages and its `node_modules` 301 MB; CI runs `npm ci` in its checks job, in its bench build, and in each scenario's job.
- An installed Dual Input names its version in `%LOCALAPPDATA%\DualInput\current\sq.version`, Velopack's nuspec, which holds `<version>0.1.1</version>` here.
- "On December 1, 2026, global Personal Access Tokens (PATs) in Azure DevOps are retired", and publishing from GitHub Actions takes the Marketplace's Trusted Publishing instead, `vsce publish --oidc`, which trades the job's GitHub OIDC token for a Marketplace credential by a policy on the publisher naming the repository and the workflow's file ([publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)); vsce 4.1.1 has `--oidc` (read in its npm package, `out/main.js`).
- As of 2026-11-22, Zed's extensions provide languages, with Tree-sitter grammars and queries, language servers, and default rules for semantic tokens, and themes, icon themes, snippets, debuggers, and MCP servers ([developing extensions](https://zed.dev/docs/extensions/developing-extensions), [languages](https://zed.dev/docs/extensions/languages)), and the docs describe no panel, status bar item, webview, or command of an extension's own.
  Zed takes semantic tokens, which are "disabled" by default ([semantic tokens](https://zed.dev/docs/semantic-tokens)), and an extension's `path_suffixes` "does not support glob patterns", which a user's `file_types` setting does ([languages](https://zed.dev/docs/extensions/languages)).
  Panels, status bar items, and webviews are proposals on Zed's GitHub, such as [RFC #53403](https://github.com/zed-industries/zed/discussions/53403) and [issue #21208](https://github.com/zed-industries/zed/issues/21208).
- The 58P's profile has 28 lines of comment, the longest 98 characters and 17 of them 90 to 99, and double quotes only in its comments (read in `profiles/aircraft/bksq-baronpro.yaml`).

**Changed** (user, 2026-11-21 and 2026-11-22): the extension's design, in [03-the-extension](03-the-extension.md), and five rules of the format:

- `seats` goes last among the top-level keys, after `events`, where [Layout](01-format-and-delivery.md#layout) put it before `state`, since an airliner's profile may hold hundreds of seats ([budgets](02-units.md#budgets)).
- Outside scripts, a profile takes single quotes only, and a double-quoted string there fails the build, while a script takes any string JavaScript takes.
- The formatter reflows each paragraph of a comment to 100 columns.
- A heading's rule runs on to column 100, as in `# ═══ ELECTRICAL ═══…`, as fsc-editor's ran on to 78.
- A script that declares `state`, `write`, `L`, `A`, `B`, `K`, or `H` fails the build, so the extension's grammar paints them as Dual Input's with no semantic tokens from its server; `value` stays free, since every write function names its parameter so.

**Affects:** [01-format-and-delivery](01-format-and-delivery.md), [02-units](02-units.md), [the build](../build/01-the-build.md), [the code map](../architecture/02-code-map.md), and the architecture's tentative decision on authoring tools.

## 2026-11-22: TypeScript's language service answers in about 40ms in QuickJS-ng on the 58P's write functions, against 3ms in Node, once QuickJS-ng has a stand-in for `Intl`

**Asked:** how fast does TypeScript 6.0.3's language service answer what the profile extension asks inside a write function, completion, signature help, a hover, and the file's diagnostics, in the QuickJS-ng the profile builder runs TypeScript in, against Node, on the 58P's own program?
The answer decides where [stage 22d](../build/plan.md#22d-the-profile-extension)'s language service runs: in the builder's language server, or in the extension's Node.

**Expected:** QuickJS-ng about ten times slower than Node, as p02's check of 300 write functions was slower there.

**Found:** on our development machine, with 30 runs of each request, each after an edit to the file, on `press.ts`, the program file for the 58P's one variant, of 303 lines, with 18 write functions and level 1's declarations of 143,541 bytes ([results](../../../experiments/areas/profiles/results/p04-language-service-2026-11-21-23-01-35.txt)):

| Request | QuickJS-ng, rquickjs 0.14.0 | Node 22.23.1 |
| --- | --- | --- |
| Loading `typescript.js` | 243.1ms | 146.0ms |
| The first completion, which builds the program | 249.6ms | 114.0ms |
| Completion after `state.` | median 42.5ms, p95 57.8ms | median 3.0ms, p95 8.4ms |
| Signature help after `write(` | median 35.9ms, p95 55.6ms | median 2.6ms, p95 9.7ms |
| A hover on `write` | median 34.8ms, p95 61.0ms | median 2.4ms, p95 8.1ms |
| The file's diagnostics | median 61.1ms, p95 68.3ms | median 8.0ms, p95 13.1ms |
| Memory | 43 MB | 23 MB of V8's heap |

- Both gave the same 183 completions after `state.`, the same 3 signatures for `write(`, and the same hover text.
- QuickJS-ng as rquickjs 0.14.0 builds it has no `Intl`, and the first completion failed with `Intl is not defined` in TypeScript's `createIntlCollatorStringComparer`, which sorts completions with `Intl.Collator`.
  The probe defines a stand-in that compares by code unit, and the run above used it.
- The diagnostics check the whole file, so they grow with its write functions, while completion, signature help, and a hover read the code around the caret (inference, from p02's check of 300 functions, which took 0.66s in QuickJS-ng).

**Changed:** the language service runs in the profile builder's language server, in two runtimes, one for requests and one for checks and builds (user, 2026-11-22; [TypeScript in two runtimes](03-the-extension.md#typescript-in-two-runtimes)).

**Affects:** [03-the-extension](03-the-extension.md).

## 2026-11-21: Stage 22b's test sessions pass their bench cases, and a reload's catch-up ended 1.5s after its load, against 4s of settling

**Asked:** do [stage 22b](../build/plan.md#22b-test-sessions)'s cases hold on its code: [the profiles' cases for the bench](02-units.md#cases-for-the-bench) that [test sessions](02-units.md#test-sessions) added, in the new `test-sessions` scenario and the changed case of `profiles`?

**Expected:** each case as designed, with a reload's catch-up ending within about 1.5s of the load, the time the new sync engine takes its first readings, since the aircraft settled long before.

**Found:** on our development machine, with the bench's profile `release-with-checks`, after the code review's fixes, `node tools/bench.ts test-sessions profiles traffic` passed 26 of 26 cases ([results](results/2026-11-21-stage-22b-bench.txt)):

- A new bundle in the PF's local folder moved the pin, both cores reloaded it, the following core's catch-up wrote the strobe the new bundle's entry covers, and the slice showed its short hash for both PCs, saved by the PF, with the banner's notice once on each.
- With settling at 4s, the following core's catch-up ended 1,494ms after its load of the new bundle, and 1,498ms in the run before the fixes.
- Through the reload, `Follow`'s slot went on being written on the connection it had before, so flight-model sync ran on.
- A file written again with the same bytes moved no pin.
- A new bundle in the following pilot's local folder reached the PF, which pinned it naming that pilot; the beacon, whose write function the sandbox had stopped, synced again under it; and the PF sent the first bundle once, as it was pinned, and never again.
- A pilot who joined after the save got the bundle from the PF as their link came up, fetched nothing, and kept it in their cache.
- In `profiles`, a member with no copy of the PF's local bundle got it from the PF and loaded it, and the match check showed no difference.
- In `traffic`, a pilot who left the flight had each copy removed once, on the connection that made it, by traffic's own removes, since a profile's unload no longer closes traffic's connection.

The build of the 200 KB profile took 2,016ms in the run before the fixes, 16ms past its 2s, while other work held the PC, and 1,718ms in the run after them, with no change to the builder.
CI's run on the stage's pull request is its whole bench.

The code review found five faults, which the stage fixed before the run above:

- From the second local pin on, the PF's core sent the previous bundle to the crew again, and a member that took control while that copy was on its way would pin it, taking the session back to the earlier save; the PF sends once the pin lands, and pins only a bundle marked as an offer.
- A member's offer that reached a core after control passed from it was dropped; that core passes it on to the PF.
- The PF's own pinned local bundle lived only in its local folder, so an author who deleted the file left a joiner loading for good; every core keeps each local bundle it sends or gets in its cache.
- A failed read of a local file made its next good read count as a new save, though its bytes hadn't changed; the folder's listing keeps each file's last good hash.
- Comments in traffic and the sim seam still said a profile's unload closes every feature's connection.

It also found that the old unload stopped rate and pause's and Go to's watches for the rest of a sim run once a profile first unloaded, since each makes its watch once and makes it again only when told its connection was lost, which a close for an unload never told it; with their connections open through an unload, the watches stay (read in `src/features/rate-and-pause/core/src/lib.rs`, `sim_changed`).
No case measured it before the change.

**Changed:** the design's known limit on a change lost during a reload covers a following machine's own gap too, while it waits for the bundle to arrive ([test sessions](02-units.md#test-sessions)).

**Affects:** [test sessions](02-units.md#test-sessions), and [the build plan](../build/plan.md)'s stage 22b.

**Evidence:** [results/2026-11-21-stage-22b-bench.txt](results/2026-11-21-stage-22b-bench.txt).

## 2026-11-21: The format's audit before level 1 freezes puts maps on their own lines, types instrument readings, and names one layout

**Asked:** what does an ordinary profile run into at level 1 that we'd change before v1's release freezes the level ([stage 22c](../build/plan.md#22c-the-formats-audit))?
And should CI's check that a released level's files match its release tag hold them to 0.1.0, the one release so far?

**Expected:** a few unclear errors, since the 58P's profile had built and flown since stage 14.

**Found:** reading the format's design docs, the profile engine, the builder, the 58P's profile, and fsc-editor's `docs/profile-format.md`, and building test profiles on our development machine:

- A map in YAML's bracketed form, `write: {toggle: K('ELECTRICAL_BUS_TO_BUS_CONNECTION_TOGGLE', 2, 6)}`, failed with "Each key in a profile is text", because YAML splits a bracketed map at its commas and the name's values became keys.
  [Writing](01-format-and-delivery.md#writing)'s example, `write: {toggle: K('TOGGLE_BEACON_LIGHTS')}`, and the ADF sketch in [01-plugins](../plugins/01-plugins.md#the-58ps-state-in-its-gauges) both use that form, and the 58P's profile wrote 32 of its toggles in it, and its 10 toggles with values on their own lines.
- A file that starts with a UTF-8 byte-order mark failed at its first key, which the parser read with the mark in front, so `maker` read as an unknown block and the profile as missing `maker`.
  Windows PowerShell 5.1's `Set-Content -Encoding utf8` wrote one into our first test file.
- A write function comparing an `instrument()` entry, `value > state.knob`, failed its type check with TS18046, since level 1's declarations type that entry `unknown`, and the 58P's profile wraps each such value in `Number()`.
- The aircraft picker shows one tile per profile and loads the first installed variant it covers (`src/platform/profile-loader/src/lib.rs`, `pick`).
  Each variant's own `aircraft.cfg` names it in `ui_type`: "Baron 58 Professional", "Baron 58TC Professional", and "Baron 58P Professional" (read in bksq-aircraft-baronpro 0.1.1, each variant's `SimObjects\Airplanes\<folder>\aircraft.cfg`).
- The format names no layout for a formatter to write, and the 58P's profile puts `displays` and `seats` before `state`, where a bundle puts them last.
  Its headings hold as written: `# ═══ TITLE` and `# ── Title` are comments to the parser, in fsc-editor's convention.
- Level 1's one schema, `schema.json`, required only a seat's fields, offered `aircraft`, `maker`, `only`, and `location` in a module, and let an event entry count, toggle, or step, each of which the checker refuses.
- The checker's rules live in the engine's code, which CI's frozen-level check doesn't compare, so a release that loosens one, letting a module use `only`, say, would publish a level-1 bundle that every core on an earlier release refuses.
  FS Copilot's fork did that with its `pointer:` key, which "bricks profile loading on older releases" (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, item 6).
- A profile with CRLF line ends built to the same bytes as with LF.

**Changed** (user, 2026-11-21):

- A map in a profile goes on its own lines: the reader refuses a bracketed map anywhere, with an error that shows the map written out, and a list keeps both forms.
- The reader skips a leading byte-order mark.
- `instrument(key, path)` reads a number and `instrument(key, path, 'string')` reads text, each typed to match in a write function, and the panel module reports a reading of the other kind as an error.
- The format names one layout, and a bundle's top-level keys come in its order ([layout](01-format-and-delivery.md#layout)).
- Each level has two schemas, `profile.json` and `module.json`, each with its required fields, and an event entry's fields only as the checker takes them; an editor picks one by the file's folder, as the builder takes a file in `profiles/aircraft/` as a profile and one it imports as a module.
- A release that lets a profile do what a level's checker refused raises the level, as a new field does.
- A profile's variants share its `name`, and once a profile has a second variant, the picker asks which one to load, naming each by its `ui_type`; v1's aircraft is the 58P alone, so nothing changes for v1.
- CI holds a level's files only to release tags from 1.0.0 on, since nobody flies a release before it, and publishing still counts every release's level as released, so 0.x releases get the tree's profiles (`tools/lib/levels.ts`).

**Affects:** [01-format-and-delivery](01-format-and-delivery.md), [02-units](02-units.md), [01-plugins](../plugins/01-plugins.md), the code map's [profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository), and the architecture's tentative decision that [one repository holds all of Dual Input](../architecture/decisions.md#one-repository-holds-all-of-dual-input-its-folders-by-tier-with-each-features-parts-in-one-folder).

## 2026-10-24: Stage 10's profiles pass the stage's bench cases, load a 221 KB bundle in one input under 730µs, and build one of 300 write functions in 1.7s

**Asked:** do [stage 10](../build/plan.md#10-profiles)'s cases and budgets hold on its code: [the profiles' cases for the bench](02-units.md#cases-for-the-bench), the builder's own, two of the session's, and the budgets for a build, a load, and a start with nothing new?

**Expected:** each case as designed, and each budget inside, with the load the closest, since it decodes the whole profile on the loop.

**Found:** on our development machine, with the bench's profile `release-with-checks`, the PC holding no game and a torrent client using about 1.5% of a core:

- All 13 cases of `tools/bench/scenarios/profiles.ts` passed, each ending in a replay of every core's recording that matched its run, the first case's replay logging the same load as the run.
  They covered the 11 cases, a bundle whose fetch failed at start fetched again at Host, which the code review added, the session's case of a wrong aircraft whose pin follows the aircraft, and its case of an aircraft with no profile, which shows "No profile for this aircraft" as an error.
- The whole bench ran 77 cases and failed 1, a clients case comparing a settings file it wrote with the core's write of it, which the bench's start of a core had written over (below); with that fixed, its scenario passed, and the 30 cases of the scenarios that start a core again on its data folder passed too.
  After the code review's fixes, `node tools/check.ts` passed, and the profiles' scenario, the one they reach, passed its 13 cases.
- **A load on the loop:** the 221,156-byte bundle of 300 write functions loaded in an input under 730µs, the run's slowest being the core's start, at 699µs to 730µs over three runs, against the code map's 1ms.
  Its first run took 1,055µs in that one input, which `resolve` spent in part copying every entry's JavaScript for this pilot's variant; it moves them instead.
- **A build:** the builder built that profile in 1,714ms to 1,782ms over four runs, its process's start and the compiler's 280ms load included, against 2s, inside the 128 MB QuickJS-ng holds the compiler to, on an 8 MB stack.
  TypeScript's type check took 642ms of it, as p02's 300 functions did; compiling each script in a call of its own took 1.2s more, until the builder compiled every script in one call.
- **A start with nothing new:** the second start of a core on its data folder fetched only `index.json`, answered with a 304 and no body.

The build changed or settled ten things the record didn't say:

- The builder program's `publish` takes `--released <level>`, the highest level a release supports, which stage 22's workflow reads from the release tags, `--pages <folder>`, and `--profiles <folder>`; and a `levels` command writes each level's files, which `tools/check.ts` runs and compares, as it does the messages' types.
- The local folder is listed at start, at each session, whenever the session's aircraft changes, and when its setting changes, where [the local folder](02-units.md#the-local-folder) lists it at each choice and lookup; a new local bundle takes effect when the design says it does.
- The pilot flying's choice waits for the cache's folder and the local folder to be listed, so a bundle already on disk isn't pinned as none first.
- A pin the session crate refuses is asked for again in a later input, not once ever.
- The match check's item reads "No profile for this aircraft", "Couldn't get the session's profile:" and the members' names, and "The pilots loaded different profiles", until the apps' stage words it; the session crate gains `clear_match`, so a member whose profile is loading shows no value.
- The profile engine depends on no crate of ours, where the code map allows it the message crate.
- The case of a job's result arriving after its member left the flight runs as a fetch the bench's site holds back, since the read of a cached bundle finishes too quickly to hold.
- The bench's site serves what the builder's `publish` lays out, from the tree's profiles at each bench run; a core the scenario gives no site fetches from a closed port on this PC, so no bench core reaches the internet; and the bench's start of a core merges into a settings file already in its data folder, where it replaced it.
- The clients' test unit keeps only its picks of instruments, and the clients' scenarios load the tree's 58P profile through a flight in the Baron; the session's scenarios fly the Baron too, so their cores load the profile and raise the clients crate's notification that no panel connected.
- A profile's file is named for its developer and aircraft, as `bksq-baronpro.yaml`, which reviews check by eye (user, 2026-10-24; [the repository](01-format-and-delivery.md#the-repository)).

The code review found the rest:

- A bundle whose fetch failed at start was never fetched again, so a pilot offline at sim start flew with "No profile for this aircraft" until the core restarted; a new session fetches it again, as [fetching](02-units.md#fetching) has it.
- `publish` took a bare folder in one profile and a preset in it in another for two aircraft; it refuses them, since a folder covers every preset in it.
- The index's ETag could go out with an index that never loaded; it goes out only with one, and is written once the index is.
- A bundle published again after a newer one at a higher level kept that level on the newer one; it replaces it.
- The registration through which a feature's module adds a block or a field of an entry comes with avatars' module in stage 17, its first user, so its shape fits a real block, where stage 10's lines had it here (user, 2026-10-24).
- TypeScript's type for a chain's pace passes paces the format refuses, so the sync engine fails a write whose chain's pace doesn't read as one (user, 2026-10-24; [pace](01-format-and-delivery.md#pace)).

**Changed:** nothing beyond the lists above.

**Affects:** [the profiles' units](02-units.md), [the format](01-format-and-delivery.md)'s pace and repository, and [the build plan](../build/plan.md)'s stages 10 and 17.

**Evidence:** [results/2026-10-24-stage-10-whole-bench.txt](results/2026-10-24-stage-10-whole-bench.txt).

## 2026-10-24: The sandbox's context runs QuickJS-ng's base objects, past ES2020, without JSON, Map, Set, Date, or Promise, and level 1 types write functions by exactly what it runs

**Asked:** what a write function can use in the sandbox, whose context holds QuickJS-ng's base objects and, of rquickjs's intrinsics, `Eval` and `RegExp` alone ([the sandbox](../plugins/01-plugins.md#the-sandbox)), so level 1's declarations, the scripts' whole world under `noLib`, can name exactly that.
Building stage 10, the declarations held only the ten global types TypeScript needs, as empty interfaces, so a write function couldn't type-check `Math.round` or an array's `map`.

**Expected:** ES2020's built-ins, less the intrinsics the context leaves out.

**Found:** p03 made a context that way, through rquickjs 0.14.0, deleted `Math.random` and `queueMicrotask` as the sandbox does, and listed every global with its own properties and its prototype's ([results](../../../experiments/areas/profiles/results/p03-sandbox-globals-2026-10-24-11-03-31.txt)):

- It defines `Object`, `Function`, `Array`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Math`, `Reflect`, `RegExp`, `Iterator`, `DisposableStack`, `Error` and its kinds, and the global functions such as `parseInt`, `isNaN`, and `encodeURIComponent`.
- Their members run past ES2020: `Object.groupBy`, `Array.prototype.toSorted`, `String.prototype.isWellFormed`, the iterator helpers, and `Math.sumPrecise`.
- It lacks `JSON`, `Map`, `Set`, `WeakMap`, `Date`, `Promise`, `Proxy`, the typed arrays, and `WeakRef`.
- A regex literal, a generator, `for of`, and spread ran.

**Changed:** level 1's declarations open with every global the context defines, and only the members it defines, typed by TypeScript 6.0.3's own library declarations, so a write function gets the whole of the JavaScript the sandbox runs, and one that names what it lacks fails its type check (user, 2026-10-24).
`tools/javascript-types.ts` generates them from TypeScript's libraries and p03's list, which `src/engines/profile-engine/javascript/sandbox.json` keeps, dropping each member or type that names a missing global, as `Array.fromAsync` names `Promise`.
The file is 3,174 lines, and marks itself as a default library, so TypeScript allows its `intrinsic` types and skips checking it on each build.
Stage 12's sandbox gets a test that its context defines exactly that list.
After the JavaScript come the names, `write()`, and the chain, and neither `instrument()`, which a write function may not call, nor `aircraft`, which [the profiles' units](02-units.md#levels) listed but the format never defined (user, 2026-10-24).

**Affects:** [the profiles' units](02-units.md#levels), whose declarations held the ten global types; [the build plan](../build/plan.md)'s stages 10 and 12.

## 2026-10-16: TypeScript 6.0.3's compiler type-checks and compiles inside QuickJS-ng, as under Node, in 0.9s for 300 write functions, on a 1 MB stack

**Asked:** the profile builder type-checks a profile's write functions and its plugin against our declarations, and compiles the plugin to JavaScript ([01-format-and-delivery](01-format-and-delivery.md#levels)).
Can TypeScript's own compiler, `typescript.js`, do that inside the QuickJS-ng that rquickjs embeds, so the builder needs no Node and no second program, and how long, how much memory, and how much stack does it take?

**Expected:** that it runs, since it's plain JavaScript, but slower than under Node, whose V8 compiles it to machine code.

**Found:** p02 loaded TypeScript 6.0.3's `typescript.js` into one QuickJS-ng runtime through rquickjs 0.14.0, and ran each project 5 times on it, in memory, with `noLib` and a lib of our own in place of TypeScript's, at target `ES2020`.
It ran unmodified.

| Project | Load | Each check and emit | Memory | Under Node, same driver |
| --- | --- | --- | --- | --- |
| A plugin of two functions, one passing a string where `write()` takes a number | 241ms | 7.3ms to 7.8ms | 35.2 MB | 3.0ms to 51.7ms |
| 300 write functions, 51,172 bytes, one reading a key the state doesn't have | 242ms | 655ms to 678ms | 57.1 MB | 40.8ms to 120.1ms |

- Both reported the error each project holds, `TS2345` and `TS2339`, at its line and column, and QuickJS-ng's diagnostics and emitted files matched Node's byte for byte.
- The 300-function check passed on a thread of 1 MB, with QuickJS-ng's own stack limit at 512 KB, and on every larger one tried.
- With `noLib`, TypeScript still needs ten global types to exist, `Array`, `Boolean`, `CallableFunction`, `Function`, `IArguments`, `NewableFunction`, `Number`, `Object`, `RegExp`, and `String`, so our declarations declare them.
- `typescript.js` is 9,144,216 bytes, 1,641,628 under gzip -9, and 1,160,209 under zstd -19.

A research pass the same day measured the alternatives on the same machine, in a scratch folder whose raw output we didn't keep:

- tsgo 7.0.2's `tsc.exe` is 24,520,544 bytes, 7,669,581 under zstd -19, and checked a one-file project in 14ms to 26ms; TypeScript 7.0 "does not yet expose a stable programmatic API", and 7.1 is expected to ship a new, different one (documented, [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)), and npm lists no WebAssembly build of 7.0.2 among its packages for each platform (read with `npm view typescript@7.0.2 optionalDependencies`).
- oxc 0.146.0's parser, transformer, and code generator added 2.2 MB to a release build, and swc_ecma_transforms_typescript 56.0.0's stripping 6.2 MB; neither type-checks.
- Monaco 0.57.0, VS Code's editor, ships TypeScript 5.9's compiler as `typescriptServices.js`, 9,075,748 bytes (read in its npm package).

**Changed:** the profile builder type-checks and compiles with TypeScript 6.0.3 inside QuickJS-ng, and the core builds no bundle, so `typescript.js` never ships to pilots ([02-units](02-units.md#the-builder)).
A profile of 300 write functions takes about 0.66s once the compiler is loaded, which is CI's cost per profile and level after one load of 0.24s, and the IDE's on each save.
Pinned at 6.0.3 exactly, its output stays put, and as of Microsoft's post of 2025-12-02, TypeScript 6.0's patches are to be "infrequent, and only issued when absolutely necessary" (documented, [Progress on TypeScript 7](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)).

**Affects:** [02-units](02-units.md); [01-format-and-delivery](01-format-and-delivery.md#testing-an-edit), whose core built a local bundle itself; [the code map](../architecture/02-code-map.md#engines), which gains an engine.

## 2026-10-16: GitHub Pages answers a repeat fetch of an unchanged file with a 304 and no body, and compresses what it sends when asked

**Asked:** the core fetches the profiles' `index.json` each time it starts, and [delivery](01-format-and-delivery.md#delivery) left unverified whether Pages answers a repeat fetch of an unchanged index with "not modified", sending almost nothing.

**Expected:** a 304 to `If-None-Match`, as a CDN in front of static files usually gives.

**Found:** p01 fetched two Pages sites, GitHub's own and an organization's, asking for gzip, then again with each validator it got:

| Site | First fetch, gzip asked | `If-None-Match` | `If-Modified-Since` | No gzip asked |
| --- | --- | --- | --- | --- |
| `pages.github.com` | 200, 3,844 bytes, `W/"689c7eef-386e"` | 304, 0 bytes | 304, 0 bytes | 200, 14,446 bytes |
| `jekyll.github.io/minima/` | 200, 3,319 bytes, `W/"68330611-25c7"` | 304, 0 bytes | 304, 0 bytes | 200, 9,671 bytes |

Every answer carried `Cache-Control: max-age=600`.
The ETag is weak on the compressed answer and strong on the plain one.
p01 fetched two unchanged HTML pages; that a JSON file on our own branch, served at our own domain, answers the same is unverified until that site exists.

**Changed:** the core fetches the index with the ETag it kept, so a start with nothing new published costs one answer of headers ([02-units](02-units.md#fetching)).
A cache may hold the old index for up to 10 minutes after Pages serves a new one, as `max-age=600` allows (inference), on top of the time Pages takes to serve a push.

**Affects:** [delivery](01-format-and-delivery.md#delivery), whose unverified line this settles.
