# Plugins and the sandbox

```text
Purpose:     Why v1 builds no plugins, how a profile reads state that lives in a gauge's JavaScript instead, and the rules the sandbox runs a profile's scripts under.
Depends on:  ../profiles/01-format-and-delivery.md, ../profiles/02-units.md, ../sync/05-units.md, ../core/02-clients-and-panel-bridge.md, ../core/01-loop-and-edge.md, ../architecture/02-code-map.md, ../aircraft/black-square-baron-pro/study.md
Decides:     That plugins come after v1; the `instrument()` name, what its path may reach, and the values it reads; how state sync reads it and writes a gauge's state through its H: events; the Baron 58P's entries for its gauges' state; and the sandbox's rules against randomness a replay can't repeat (node 6.15).
```

v1 builds no plugins.
The Baron 58P's settings that live only in its gauges' JavaScript reach its profile through a name, `instrument()`, which a panel module of state sync's reads in the gauge's panel every 250ms, and the profile writes them only through the gauges' own H: events, in write functions that check the mode another entry already syncs.
That was the 58P plugin's whole job, so plugins wait for the first pick that needs code, such as GSX, and are designed afresh then.
The sandbox, which runs each profile's write functions, leaves out everything a replay couldn't repeat: the clock, `Math.random`, and a stack limit that moves with the Rust stack.

This answers node 6.15 of the [architecture plan](../architecture/plan.md#615-plugins).
Two reads back it, both on 2026-10-17: the 58P's gauges, in [the Baron's gauge state](results/2026-10-17-baron-gauge-state.txt), and QuickJS-ng through rquickjs, in [the QuickJS-ng sandbox](results/2026-10-17-quickjs-sandbox.txt); the [plugins log](log.md) holds what they found.

## No plugins in v1

[03-v1-scope](../product/03-v1-scope.md#plugins) gave the 58P's plugin one job: find the settings that live only in its gauges' JavaScript, export them as values its profile syncs, and register the write methods that set them.
Read field by field, that job splits in two:

- **Reading** a field is all a profile can't do today, since a gauge's JavaScript has no variable SimConnect reads.
- **Writing** needs no plugin: each field changes only through the gauge's own `onInteractionEvent`, on H: events state sync already fires ([`H:` events](../sync/05-units.md#h-events)), and a write function can check the mode that makes an event safe, since it reads `state` (read in bksq-aircraft-baronpro 0.1.1, `KR87A.js`, `KAS297B.js`, and `bksq_wradar1.js`, `onInteractionEvent` and `onEvent`).

So a name that reads a field does the plugin's job, and v1 builds none of what plugins would need: no plugins crate, no plugin API or its declarations, no `plugin:` key or `plugin.state` and `plugin.write` forms in the format's first level, no `ops` module in the panel bridge, and no `Mechanisms` routine in our WASM module.
When a pick needs plugins, their design starts from a mostly clean drawing board (user, 2026-10-17): the plugin parts of decisions [020](../../decisions/020-plugin-code-runs-only-in-core.md), [021](../../decisions/021-profiles-and-plugins-apart-from-releases.md), and [046](../../decisions/046-sandbox-runtimes-and-limits.md), and of [04-room-for-later](../product/04-room-for-later.md#plugins), are where it starts, not what it must keep.

Two of the 58P's states stay out of v1:

- **The tablet's failures.** A plugin could mirror the PF's failure rows, but only with the other machines held at a failure rate of 0, which is the format's deferred settings on following machines, plus knowing which machine flies, the tablet's readiness flags, and putting each follower's DataStorage back at the session's end, since its tablet saves the mirrored rows as its own (read in `BlackSquareTablet.js`, `failureAssessment`, `saveFailureState`, `loadFailureStates`).
  The profile syncs `L:var_globalFailureRate` as a shared entry instead, which the tablet reads back every 2.5s (read in `BlackSquareTablet.js`, `updateSimVars`), so a crew at 0 gets no failures anywhere.
- **The ADF's elapsed seconds.** The KR 87 adds each frame's wall-clock time to `elapsedTimeSeconds` while its timer runs (read in `KR87A.js`, `Update`), so an entry for it would change every frame, and [the driven-entry test](../sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself) would stop it.

## The 58P's state in its gauges

The KX 155B's knob-pulled states need no `instrument()`: the gauge mirrors each to `L:COM_1_KNOB_PULLED` and its siblings and never reads them back, and the aircraft's XML reads them only for the knob's animation, so the profile watches the variable and writes a `toggle` on `H:RADIO1_COM_Knob_Small_PUSH` and its siblings (read in `KX155B.js`, `onInteractionEvent`, and `BaronProfessional_Base_INT.xml`).
That corrects 03-v1-scope, which has setting them take a write method.
The other radios' knob-pulled states, `L:var_adfKnobPulled`, `L:var_VsAdjustMode`, and `L:var_rnavKnobPulled`, are variables their code reads back, so they're ordinary entries (same reads).

The rest, with hypothetical entry keys and instrument keys derived from the code rather than seen at run time:

| Entry | Instrument and path | Reads | Its write |
| --- | --- | --- | --- |
| `adf_ant` | `KR87A`, `antMode` | 1 or 0 | `toggle` on `H:adf_AntAdf` |
| `adf_bfo` | `KR87A`, `bfoMode` | 1 or 0 | `toggle` on `H:adf_bfo` |
| `adf_mode` | `KR87A`, `multiMode` | 0 FRQ, 1 FLT, 2 ET | A function: `H:adf_FltEt` steps 0 to 1, 1 to 2, and 2 to 1, and `H:adf_frqTransfert` goes to 0, sent only from 1 or 2, since in FRQ it swaps the ADF's frequencies |
| `adf_timer`, an event entry | none: it watches `H:adf_SetRst` | | `H:adf_SetRst`, so each press replays and each machine counts from the press it applied |
| `kas_arm` | `KAS297B_1\|Index=1`, `optionalArmingMode` | 1 or 0 | `toggle` on `H:kas297b_ArmButton`, which arms only 100 ft or more from the selected altitude |
| `kas_armed_vs` | `KAS297B_1\|Index=1`, `armedVerticalSpeed` | ft/min, −3,000 to 3,000 | A function: 100 ft/min steps of `H:kas297b_100_INC` and `_DEC`, only while `L:var_VsAdjustMode` is 1 and vertical speed hold is off, since otherwise they step the autopilot's vertical speed or the altitude preselect |
| `radar_alert` | `bksq_wradar1`, `weatherRadarMainMap.map.alertMode` | 1 or 0 | `toggle` on `H:bksq_wradar1_radarAlertToggle` |
| `radar_profile` | `bksq_wradar1`, `weatherRadarMainMap.map.verticalMode` | 1 or 0 | `toggle` on `H:bksq_wradar1_radarProfile` |
| `radar_hold` | `bksq_wradar1`, `weatherRadarMainMap.map.radarHold` | 1 or 0 | A function: `H:bksq_wradar1_radarHold` only while `L:var_radarMode` is 3 or less, since on the systems page, mode 4, it refills the oxygen |
| `radar_track` | `bksq_wradar1`, `weatherRadarMainMap.map.radarTrack` | degrees, −35 to 35 | A function: 2.5° steps of `H:bksq_wradar1_radarTrackLeft` and `Right`, only in mode 3 or less, since in mode 4 they repair engine 2 and set the battery voltage, and in mode 5 the right one resets every failure |
| `radar_range` | `bksq_wradar1`, `weatherRadarMainMap.map.instrument.getWeatherRange()` | nautical miles | A function: steps through the radar's ten ranges with `H:bksq_wradar1_radarRangeInc` and `Dec`, only in mode 3 or less |

Each field is set in its gauge's constructor and saved nowhere, so every machine's gauges start alike at each load, and the readings matter for catch-up and a rejoin (read in each gauge's constructor).
The radar's events reach its map only while the map's mode is 3 or less, and in modes 4 and 5 the gauge's outer handler acts on them instead (read in `bksq_wradar1.js`, `bksq_wradar1.onEvent` and `bksq_wradar1_MapElement.onEvent`).

Three of these as profile entries, a sketch:

```yaml
state:
  adf_bfo:
    name: ADF BFO
    watch: instrument('KR87A', 'bfoMode')
    write: {toggle: H('adf_bfo')}

  adf_mode:
    name: ADF mode
    watch: instrument('KR87A', 'multiMode')
    write: |
      (value) => {
        if (value == 0) { if (state.adf_mode != 0) write(H('adf_frqTransfert')) }
        else if (state.adf_mode == 0) write(H('adf_FltEt')).repeat(value)
        else if (state.adf_mode != value) write(H('adf_FltEt'))
      }

  radar_hold:
    name: Radar hold
    watch: instrument('bksq_wradar1', 'weatherRadarMainMap.map.radarHold')
    write: |
      (value) => {
        if (state.radar_mode <= 3 && value != state.radar_hold) write(H('bksq_wradar1_radarHold'))
      }
```

`state.radar_mode` is the profile's entry for `L:var_radarMode`, which the aircraft's XML owns and the profile syncs anyway.
A guard's mode and the value it guards change on the cockpit stream in the order the pilot made them, so the mode lands first when the pilot changed it first ([one stream, in causal order](../sync/02-live-sync.md#one-stream-in-causal-order)).

## The instrument name

`instrument(key, path)` names one value in a gauge's JavaScript: `key` is the instrument's key, as [`displays`](../profiles/01-format-and-delivery.md#displays) names a panel's instruments ([cockpit panels and their modules](../core/02-clients-and-panel-bridge.md#cockpit-panels-and-their-modules)), and `path` is a dotted string from the instrument's object.

- It's a word, not a letter, because MSFS owns the single-letter namespaces, and a word of ours can't collide with one the sim adds later (user, 2026-10-17).
- A state entry may watch it; a `write`, an event entry's `watch`, and an `ignore` may not, and each fails the load as a name of the wrong kind for its field ([what fails a load](../profiles/01-format-and-delivery.md#what-fails-a-load)).
- A path is names and whole numbers separated by dots, and its last step may end in `()`; any other path fails the load.

### What a path reaches

- Each step must be an own property of the object before it, which `Object.prototype.hasOwnProperty` tells, so a path stays in the gauge's own data: an instrument's own properties are the fields its constructor set, while the DOM's, such as `ownerDocument` or `children`, live on its prototypes, and so do `__proto__` and `constructor`.
- A last step ending in `()` calls a method with no arguments, found on the object's prototypes, as the radar's range needs `getWeatherRange()` on Asobo's map, the call the radar's own code makes (read in `bksq_wradar1.js`, `bksq_wradar1_MapElement.onEvent`); which field holds the range is in Asobo's `MapInstrument.js`, which isn't among the sim's files on our disk, so we haven't read it.
  The method must be one the panel's own scripts wrote, the aircraft's or the sim's, never one built into Coherent GT: the module refuses a function whose source text holds `[native code]`, the form built-in functions print, so a path can't call a DOM method such as `remove()` or `click()`.
  That Coherent GT prints a built-in that way is unverified, and a case in the sim settles it.
- Profiles still reach no file and no network ([decision 020](../../decisions/020-plugin-code-runs-only-in-core.md)): a path reads, and calls only a method that takes nothing from the profile.

### Its values

An entry's value is a number or text ([a cockpit message](../sync/05-units.md#a-cockpit-message)), so the panel module converts what a path reads before it sends anything:

| The path reads | The entry gets |
| --- | --- |
| A finite number | That number |
| `true` or `false` | 1 or 0, so a `toggle` or a function compares it as it does a switch |
| A string | That text, under the 4 KB cap on a value ([decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)) |
| Anything else: `undefined`, `null`, `NaN`, an object, an array, or a function, or a path or method that throws | An error |

An error leaves the entry with no reading, and state sync shows its notice once for each load, as for a write that never lands, and marks the recording ([notices and marks](../sync/05-units.md#ready-notices-marks-and-the-checklist)).
A wrong path, from a typo or an aircraft update that renamed a field, reads `undefined`, so an author sees it the first time the profile loads.
A later level can carry objects and arrays as JSON text, which would let a profile sync the KNS-81's ten waypoints as one value; nothing in v1 needs it.

## Reading it in the panel

State sync reads every `instrument()` through a panel module of its own, `instrument-reads`, beside `h-events` ([state sync's units](../sync/05-units.md#the-units)).

1. Its rule gives the module to each panel holding an instrument the loaded variant's `instrument()` names name, by its key, as pointer sync's rule takes the instruments `displays` names ([cockpit panels and their modules](../core/02-clients-and-panel-bridge.md#cockpit-panels-and-their-modules)).
2. Once the module starts, state sync sends it that panel's paths, each with a number, and the bridge hands it each named instrument's object from its record of each instrument ([our VCockpit.js](../core/02-clients-and-panel-bridge.md#our-vcockpitjs)).
3. The module reads every path at once, then every 250ms, a starting value, and sends one message with each value that changed since it last sent it, by number, or the path's error once until it reads a value again.
4. State sync takes each message as an input stamped as it arrives, so the recording holds it and a replay reads it again, and hands the engine each value as a reading of its entry, as it does an `L:` variable's.
5. When the profile unloads, the core stops the module, which clears its timer.

- The module only reads, each read in a `try`, and installs no listener or wrapper, so nothing of it sits in the pilot's input path, and a gauge whose read throws keeps running ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)).
- The KR 87's and the KAS 297B's fields change only inside the gauge's event handler, but the armed vertical speed also follows the autopilot's target whenever that changes (read in `KAS297B.js`, `Update`), so the module reads on a timer rather than after each H: event.
- A read every 250ms puts up to 250ms between a pilot's press and its reading, against the 1.5s state sync's engine waits for a write to show before it flags it ([checking a write](../sync/05-units.md#checking-a-write)).

In the sync engine, an `instrument()` is one more kind of watch, a sketch:

```rust
pub enum Watch { /* ... */ Instrument { key: String, path: String } }   // read by instrument-reads, every 250ms
```

## The sandbox

The sandbox gives each loaded profile one QuickJS-ng runtime, under [decision 046](../../decisions/046-sandbox-runtimes-and-limits.md)'s 64 MB and 100ms a call, and v1 builds no second runtime, since it has no plugin.
Its contexts already leave out `Date` and `Performance` ([one loop](../architecture/02-code-map.md#one-loop)), and the QuickJS-ng read found three more things a replay couldn't repeat, and one it can:

| What | Why it differs between a run and its replay | The rule |
| --- | --- | --- |
| `Math.random` | QuickJS-ng seeds it from the wall clock when it makes a context (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `JS_NewContextRaw` and `js_math_random`) | The sandbox deletes it from `Math` after making the context, and deletes `queueMicrotask` too, since nothing drains the jobs it queues |
| The stack's limit | QuickJS-ng sets its limit from the stack pointer when the runtime was made, and rquickjs moves it only with its `parallel` feature, so how deep a recursion gets before its `RangeError` turns on how deep the Rust stack stood at the call (read in rquickjs-core 0.14.0, `src/runtime/raw.rs`, and `quickjs.c`, `update_stack_limit`) | The sandbox calls `JS_UpdateStackTop` at its one entry into JS, so the limit sits 1 MB below the same frame at every call, and sets the size with `JS_SetMaxStackSize` rather than trust a default rquickjs's docs give as 256 KB, where QuickJS-ng's `quickjs.h` has 1 MB; the loop's thread has 16 MB ([threads](../core/01-loop-and-edge.md#threads)) |
| `WeakRef` and `FinalizationRegistry` | Their callbacks follow when the garbage collector frees an object, which repeats only if the host's own allocations in the runtime repeat (read in `quickjs.c`, `reset_weak_ref`) | The context leaves out the `WeakRef` intrinsic |
| A Rust `HashMap` handed into JS | rquickjs builds the object in the map's iteration order, which is randomly seeded (read in rquickjs-core 0.14.0, `src/value/convert/into.rs`) | The sync engine hands values in from a `Vec` or a `BTreeMap` only |
| The hash seed | Also taken from the wall clock, but read only in `map_hash_key`, to pick a Map's or a Set's bucket, while every way to iterate one walks a list kept in insertion order (read in `quickjs.c`, `map_hash_key`, `js_map_forEach`, `js_map_iterator_next`) | None: a script sees nothing of it, which settles the code map's item in [left open](../architecture/02-code-map.md#left-open) |

- The context holds the base objects QuickJS-ng always adds, and of rquickjs's intrinsics only `Eval`, which compiling the write functions needs, and `RegExp`, the one more that a level's declarations name ([the profiles' units](../profiles/02-units.md)), so no Map, Set, or Promise exists for a script to reach.
- QuickJS-ng throws "out of memory" as an error a script can catch, so a write function that catches it carries on, and the host never learns it met the limit (read in `quickjs.c`, `JS_ThrowOutOfMemory`).
  We accept that: the limits are for bugs, and a function that catches the error and keeps allocating meets the 100ms limit (user, 2026-10-17).
- The interrupt counter carries over between calls and starts at 0 in a new context, so where a call's first check lands depends on every call into JS since the context was made (read in `quickjs.c`, `js_poll_interrupts`), which a replay makes again; the recording numbers each call into JS, compiling the write functions at load among them, so a stop's recorded count lands on the same call ([what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds)).
- An interrupted call ends with an error no `catch` or `finally` in the script sees, and the runtime runs on (read in `quickjs.c`, `JS_ThrowInterrupted`; measured on our development machine, 2026-10-08, [architecture log](../architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)).

## What this answers

| Raised by | Its question | The answer |
| --- | --- | --- |
| [01-spine](../architecture/01-spine.md#left-open) | Which APIs our panel bridge and WASM module offer plugins | None in v1, so `ops` and `Mechanisms` aren't built; the panel bridge offers state sync's `instrument-reads` |
| 6.15's question | Whether the 58P's plugin needs any of [01-format-and-delivery](../profiles/01-format-and-delivery.md#deferred)'s deferred APIs | Its radios need none; its failures would need settings on following machines, which is why they stay out of v1 |
| [02-code-map](../architecture/02-code-map.md#left-open) | Whether QuickJS-ng's hash seed changes anything a script sees | No, and with no Map or Set in the context, nothing reads it |
| 5.1, 5.3, 6.4, 6.6, 6.9, 6.14 | Plugins' hooks and moments, `ops`' operations and how they name panels, a plugin's channel instances, plugin tests in the recording, a plugin's values and writes in state sync, and a plugin's object mirroring and claims | Each waits for plugins' design, after v1; for 6.9, an entry's value that's neither a number nor text is an error, as [its values](#its-values) has it |

## What this changes elsewhere

Each doc this changes carries a note at its top, and the tentative decision behind the changes is [v1 builds no plugins](../architecture/decisions.md#v1-builds-no-plugins-and-a-profile-reads-a-gauges-javascript-through-instrument-and-writes-it-only-through-the-gauges-h-events):

- [03-v1-scope](../product/03-v1-scope.md#plugins) and [04-room-for-later](../product/04-room-for-later.md#plugins): no plugin in v1, and the KX 155B's knob-pulled states need no write method.
- [01-format-and-delivery](../profiles/01-format-and-delivery.md#names): `instrument()` joins the names, and the plugin forms and the `plugin:` key wait for plugins.
- [The profiles' units](../profiles/02-units.md): the declarations gain `instrument` and lose `plugin`.
- [The sync units](../sync/05-units.md#reaching-the-sim): state sync gains `instrument-reads`, and its row for a plugin's value goes.
- [02-code-map](../architecture/02-code-map.md#the-units): no `plugins` crate, `ops`, or `Mechanisms` in v1, and the plugins system is the sandbox alone.
- [01-spine](../architecture/01-spine.md#plugins), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), and [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#ops): no calculator code for plugins, and no `ops`.
- [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#left-open) and [traffic and ATC](../traffic-atc/01-traffic-and-atc.md#the-object-mirror-engine): what each left to 6.15 waits for plugins' design.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing) measures:

- `instrument-reads` adds no frame time we can measure to a panel, as the code map's [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim) has for every panel module, and sends a message only when a value changes.
- A path's value is read within 250ms of its change.

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, on the bench or in the sim:

- A profile whose write function recurses until its `RangeError`, called from two depths of the Rust stack, stops at the same depth both times, live and in a replay.
- A run and two replays count the same interrupt checks in each call into JS.
- A write function that calls `Math.random` or `queueMicrotask` fails its write, and a profile that names them fails its type check.
- In the sim, on the 58P: `instrument-reads` reads each path in the table above, and each entry's write moves the other machine's gauge; a path ending in `remove()` is refused; and a field renamed by hand in the inspector reads as an error with its notice.

## Known limits

- A gauge's panel that reloads mid-flight sets its fields back to their constructor's values, and `instrument-reads` sends those as this pilot's change; a reload comes from a gauge's crash or Developer Mode, which Crosscheck doesn't support.
- A late joiner's ADF timer starts stopped at 0, and two machines' timers run apart by the network's delay between their presses.
- With the tablet's failure rate above 0, each machine rolls its own failures, as without Crosscheck.

## Left open

- Whether Coherent GT prints a built-in function's source as `[native code]`, which the case in the sim above settles; if it doesn't, the module calls no method, and the radar's range waits for a field that holds it.
</content>
</invoke>
