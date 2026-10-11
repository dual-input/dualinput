# Profiles: format and delivery

```text
Purpose:     How a profile and its plugin are written, checked, limited, and delivered to pilots.
Depends on:  ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/04-order-and-recovery.md, ../architecture/01-spine.md, ../architecture/decisions.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md
Decides:     A profile's syntax, fields, and file layout; how its script names and writes things; how a write is checked; what a plugin can reach; what fails a load; the sandbox's limits; and how profiles and plugins reach pilots, with the level of the format each needs.
```

A profile is one YAML file, and wherever a value names or writes something in the sim, it's JavaScript calling functions Crosscheck defines.
`L('BKSQ_MixtureLeverPosition_1')` names a variable, and `write()` is the one call that writes.
Profiles live as flat files in a public repository, where CI checks each one, works out the level of the format it needs, merges in the modules it imports, and publishes it on GitHub Pages under its hash.
When an aircraft loads, the core reads the published index and takes the newest profile it can run, and the session pins that profile by its hash.
An aircraft's plugin is a TypeScript file beside its profile, and every write it makes goes through `write()` too.

This answers node 4 of the [architecture plan](../architecture/plan.md#4-profiles-and-plugin-delivery).
A profile's shape, a block of state entries, a block of event entries, and a writer, is [01-profile-entries](../sync/01-profile-entries.md)'s, and this document gives it a syntax; a note at the top of 01-profile-entries says where this document changes it.
The user chose each part of the format with us on 2026-10-11, and the reasons below are the ones that decided it.

## A profile

```yaml
authors: James Smith                          # hypothetical

aircraft:
  variants:
    press: bksq-aircraft-baronpropress

import: modules/kfc-150                       # hypothetical module

state:
  mixture_1:
    name: Left mixture
    watch: L('BKSQ_MixtureLeverPosition_1')
    write: L('BKSQ_MixtureLeverPosition_1')
    owner: pilot_flying
    location: [0.21, 0.55, 1.92]              # hypothetical

events:
  radar_alert:
    name: Radar alert
    watch: H('bksq_wradar1_radarAlertToggle')
    write: H('bksq_wradar1_radarAlertToggle')

displays: BlackSquareTablet                   # hypothetical identifier

seats:
  pilot:
    name: Pilot
    hip: [0.31, 0.12, 1.40]                   # hypothetical numbers
    knees: [0.05, 0.45]
    feet: [-0.42, 0.62]
    eye: [0.63, -0.05]
```

The 58P's mixture lever drags `L:BKSQ_MixtureLeverPosition_1`, and the aircraft's behavior code writes the stock mixture from it (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)).
The radar's event name comes from FS Copilot's 58P profile and is unverified.

| Top-level key | What it holds |
| --- | --- |
| `authors` | Who wrote the profile, as free text, shown wherever the profile is credited |
| `aircraft` | The variants the profile covers, and a pace for the whole aircraft |
| `import` | The modules it uses |
| `state` | [State entries](#state-entries) |
| `events` | [Event entries](#event-entries) |
| `displays` | The panels pointer sync replays presses into |
| `seats` | Where each seated figure sits |

A field that takes a list also takes one item on its own, so `only: press` means `only: [press]`, and a list can be written in YAML's block form or its bracketed form.
The loader ignores comments, and the IDE reads and writes section headings in them by fsc-editor's convention, `# ═══ TITLE` for a section and `# ── Title` for a subsection, so one file holds what would otherwise be a folder of files (fsc-editor, `docs/profile-format.md`).

## Names

A name says what something in the sim is, and never acts.

| Call | Names | Arguments after the name |
| --- | --- | --- |
| `L(name, unit)` | An `L:` variable | A unit, `Number` if left out |
| `A(name, unit)` | An `A:` variable, with its index in the name, as in `'GENERAL ENG THROTTLE LEVER POSITION:1'` | A unit, always |
| `B(name)` | An input event's value | None |
| `K(name, ...values)` | A `K:` event | The event's other values |
| `H(name)` | An `H:` event | None |

- `A()` takes a unit every time, because the unit sets the scale and more than one resolves.
  Of the 2,464 `A:` lines in FS Copilot's profiles that carry a unit, 549 use one other than the SDK documents, such as `Position 16k` for a percentage, and they work, since both machines run the same profile (counted by fsc-editor, `docs/sim-vars/18-language-core.md`, the struck row on unit categories).
  The IDE fills in the documented unit.
- A unit on `B()`, `K()`, or `H()` is an error: 60 `H:` lines in FS Copilot's profiles carry a `Bool` that the calculator ignores (same document, `get-unit-meaningless`).
- A string unit reads text, as in `A('TITLE', 'string')`.
- `K()`'s other values go after the value a write passes: `K('KOHLSMAN_SET', 2)` sets altimeter 2 only, as `K:2:KOHLSMAN_SET` did on the Baron 58P (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air").
  For an event that takes the written value later in its list, `value` marks the place: `K('SOME_EVENT', 3, value)`, for a hypothetical event, sends 3, then the value.
  Where each event takes its value is documented for only 662 of the SDK's 1,524 `K:` events (counted by fsc-editor, same document, "Confidence tiers").
- An aircraft's client data, such as the PMDG 777's `ELEC_Battery_Sw_ON` (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)), has no name call: what its bytes mean comes from a layout only that aircraft has, so the aircraft's plugin reads it and exports what the profile needs ([plugins](#plugins)).

Names are quoted because they're JavaScript strings, and the same JavaScript runs everywhere a profile has script.

## Writing

`write:` takes a name, a map, a plugin's write method, or a function:

| Form | Example | What the engine does |
| --- | --- | --- |
| A name | `write: L('BKSQ_MixtureLeverPosition_1')` | Writes the value into it: sets the variable, or sends the event once |
| A map with `toggle` | `write: {toggle: K('TOGGLE_BEACON_LIGHTS')}` | Compares the wanted value with the local one, and flips only if they differ |
| A map with `inc` and `dec` | Below | Turns the difference into steps |
| A plugin's write method | `write: plugin.write.radar_range` | Calls it with the value ([plugins](#plugins)) |
| A function | Below | Runs it |

```yaml
heading_bug:
  name: Heading bug
  watch: A('AUTOPILOT HEADING LOCK DIR', 'Degrees')
  write:
    inc: K('HEADING_BUG_INC')
    dec: K('HEADING_BUG_DEC')
    range: [0, 359]
    wrap: true
    pace: 2 frames
```

- An `inc` and `dec` map steps the shorter way round when `wrap` is true, and clamps at the ends of `range` when it's false.
  `step` defaults to 1, `wrap` to false, and `pace` to the aircraft's, and `range` is required, because the engine needs the ends.
- An entry with no `write` is watch-only: every machine watches it and compares the values, and none writes it.
- Nothing else writes: two `write()` calls in a function do what a second action after the first would, and a name on its own is a set.

### Write functions

```yaml
xpdr_mode:
  name: Transponder mode
  watch: L('XPDR_MODE')                       # hypothetical
  write: |
    (value) => {
      if (state.battery_1 === 0) return
      write(K('SET_XPDR_MODE'), value)        // hypothetical event
    }
```

- A write function takes the value to write.
  `state`, the state object, is a global, and so are the names and `write()`, so nothing else is passed in.
- It reads only `state`, never through a name, and one that reads a key the profile doesn't have fails the load.
- `write(target)` sends the name's own arguments, and `write(target, value)` sends the value, then the name's arguments.
- Each `write()` hands the engine one action, and the engine carries the actions out in call order once the function returns.
  So the engine sees every action, as 01-profile-entries' writer required: it marks each one's echo, paces it, orders it with the rest of the session, and checks it.
- The function returns nothing, and a run that calls no `write()`, such as the transponder's while the battery is off, gets no [check](#checking-a-write).
- A paced sequence is a chain: `write(K('HEADING_BUG_INC')).repeat(steps).every('2 frames')` sends the event `steps` times, 2 frames apart.
  When a new value arrives for the entry, or the function runs again, the engine drops whatever is left of the last run's paced writes.
- The engine records which entries a run read, and when one of them changes, runs the function again, but only while its own entry's value still differs from the value it was asked to write.
  So the transponder function writes once the battery comes on, and a function whose write already landed never presses a button again because a neighbor changed.
  An event entry's function never runs again, since an event happens once.

### Pace

A pace is written the same way in YAML and in a chain: `1 frame`, `<number> frames`, or `<number>ms`, as in `pace: 2 frames` and `.every('2 frames')`, and TypeScript checks the string in a chain.
The engine sends one step a frame unless a pace says otherwise: `aircraft:`'s `pace` sets it for the whole aircraft, an `inc` and `dec` map's `pace` for one entry, and `.every()` for one chain, each overriding the one before.
The A350 takes at most one command every 2 frames (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)), so its profile would set `pace: 2 frames` once.

### Which call sends an event

The engine sends an event that carries at most one value through SimConnect's legacy transmit call, and one that carries more through `_EX1`, the only call that carries them, so a profile never says which.
The PMDG 777's module dropped a yoke axis event sent with `_EX1` and acted on the same event sent with the legacy call (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)).
That every aircraft acts on an event sent with the legacy call is unverified: FS Copilot sends every `K:` event with `_EX1` (fsc-editor, `docs/fscopilot-behavior.md`, "How writes reach the sim"), and the 58P's profile is the first test.

## State entries

| Field | Required | What it says |
| --- | --- | --- |
| `name` | Yes | The control's name for people, used in the IDE, notices, and the recording |
| `watch` | Yes | A variable, or a plugin's value, which every machine reads |
| `write` | No | How to change the control, and without it, the entry is watch-only |
| `owner` | No | `pilot_flying`, or `shared`, the default |
| `only` | No | The variant IDs the entry applies to |
| `ignore` | No | The names this entry's action also fires |
| `location` | No | Where the control is, for the figure's hand |

- With `owner: pilot_flying`, only the flying machine sends the entry, and a following machine puts back its own pilot's change ([04-order-and-recovery](../sync/04-order-and-recovery.md#putting-back)).
  The PF's entries are the flight controls, toe brakes, engine levers, and trim ([state sync](../product/03-v1-scope.md#state-sync)).
  `owner` names a role from the [table of roles](../session/01-roles-and-members.md#the-table-of-roles), so a later crew role with a panel of its own needs no new field.
- A request, which 04-room-for-later keeps room for as a third direction, becomes a field of its own when ground operations need it.
  A pushback still belongs to the PF; what changes is what happens to another pilot's change, put back in v1 and forwarded to the PF as a request then ([04-room-for-later](../product/04-room-for-later.md#profiles)).
- An entry's key is lowercase snake_case starting with a letter, so a function reads it as `state.battery_1`, and it's unique across the profile and its modules, in both blocks.
- `only` lets one profile cover variants that differ.
  On the base Baron, the mixture lever drags `A:GENERAL ENG MIXTURE LEVER POSITION`, and on the 58TC and 58P it drags `L:BKSQ_MixtureLeverPosition_n` (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so two entries with different keys and `only` lists cover the mixture.
- After the entry fires, Crosscheck ignores the next occurrence of each name in `ignore` on that machine, if it comes within 1s, as [01-profile-entries](../sync/01-profile-entries.md#ignoring-a-consequence) describes.
- `location` is `[x, y, z]` in meters from the aircraft's reference point, in the frame SimConnect's camera reports, with x to the left, y up, and z forward (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-includes-a-tobii-head-trackers-rotation-and-its-position-is-in-meters)).
  Where a variant's cockpit puts a control elsewhere, `location` is a map from variant ID to a point, and a variant missing from the map gets no location.
  When a change arrives that no click made, such as one from a home cockpit's switch or a key binding, the figure's hand reaches for the location, and a click always wins, since it's where the pilot's hand went ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
  The click tool writes it, one click per control with each variant loaded.

## Event entries

| Field | Required | What it says |
| --- | --- | --- |
| `name` | Yes | The event's name for people |
| `watch` | Yes | A `K:`, `H:`, `B:`, or `L:` name; an `L:` variable is a pulse, each rise from 0 one occurrence |
| `write` | Yes | What to do on the other machines, in any of the four forms; a function gets the event's value, if it carried one |
| `only`, `ignore`, `location` | No | As for a state entry |

```yaml
events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
    ignore: K('TOGGLE_FLIGHT_DIRECTOR')
```

On a state entry, a missing `write` makes the entry watch-only, so `write` is required here rather than defaulting to a replay of what was watched, which would make one omission mean two things.
The IDE fills it with the watched name.
The Bonanza's autopilot click fires `K:AP_MASTER`, and `K:TOGGLE_FLIGHT_DIRECTOR` too when the director is off (read in bksq-aircraft-bonanzapro 0.1.1, [Bonanza study](../aircraft/black-square-bonanza-pro/study.md)), which is what the `ignore` above is for.

## Checking a write

After a machine writes a state entry, it reads the entry's value in the state object, from its `watch`, every frame, and the write has landed the moment the value matches what it was asked to write.
The same match tells the engine that a change it sees is its own write, so it doesn't send it.

- The engine waits up to 2s, a starting value, because a readout the aircraft computes from a write can take time: on the Fenix, the battery bus and a battery lamp followed a write to the battery switch after 1.2s (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).
  An entry that reads the variable it writes matches within 2 frames ([02-live-sync](../sync/02-live-sync.md#checking-that-a-write-landed)).
- It compares within float32 precision, because an animation frame we wrote as 165 read back as 165.000002 (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own)).
- If the value still differs after 2s, a name, `toggle`, or `inc` and `dec` writes again, up to the retry count 02-live-sync leaves open, since those forms do only what's left: a name writes the same value, `toggle` compares first, and steps cover only the difference.
  Catch-up leans on this, since a radio frequency written before the battery bus has power lands on a retry ([03-catch-up](../sync/03-catch-up.md#choosing-the-order)).
- A function or a plugin's write method gets one write and no retry, since a retry could press a button twice, so nothing an author writes by hand has to be safe to repeat.
  Where a function's write needs power, the function reads the battery and runs again when it comes on ([write functions](#write-functions)).
- A write that never matches flags its entry, once a flight, as 02-live-sync describes.

## The aircraft and its variants

```yaml
aircraft:
  variants:
    base: bksq-aircraft-baronpro
    turbo: bksq-aircraft-baronproturbo
    press: bksq-aircraft-baronpropress
```

- `variants` maps a short ID, which `only` and `location` use, to a SimObjects folder, so each folder's name is written once.
  It's a map even with one variant, so adding a second is one more line.
- The core matches a loaded aircraft by its folder alone, from the path the sim reports when it loads, as FS Copilot does, and compares the folder ignoring case, since one load reported a relative, mixed-case path and then an absolute, lowercase one ([02-02](../../learn/foundations/02-02-aircraft.md#how-an-aircraft-is-identified)).
- The core finds the package that holds the folder from the same path, for the aircraft's version and the [preflight match check](../product/03-v1-scope.md#preflight-match-check), so a profile names no package.
  One package can hold several aircraft: `bksq-aircraft-baronpro` 0.1.1 holds all three Barons ([Baron study](../aircraft/black-square-baron-pro/study.md#identity)).
- A profile lists no aircraft versions, because authors would leave the list empty or wrong too often for its warning to mean anything, and the match check still compares the two pilots' aircraft versions with each other.
- `pace` sets the pace for the whole aircraft ([pace](#pace)).

## Displays

`displays` lists the panels pointer sync replays presses into, by the identifiers our FS Copilot fork's `pointer:` took.

- A bare identifier, such as `DisplayUnits`, opts in every panel that carries it, which survives liveries: on livery N324DU, the A220's panel identifies as `DisplayUnits|config=N324DU`, and a profile naming `DisplayUnits|config=Default` matched nothing (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — The A220's DisplayUnits key carries the livery, and the profile names only Default").
- A full key opts in exactly that panel, for an identifier several instruments share, such as the A220's CTPs, MKPs, and FCPs (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.10 Profile key shape: identifier by default, full key to narrow").
- A panel that isn't listed gets no replayed presses, so the format needs no list of panels to leave out, as FS Copilot's `ignore:` is.
- A `WasmInstrument|` key fails the load in v1, since v1's pointer sync reaches HTML displays only, and [WASM instrument sync](../product/ideas.md#wasm-instrument-sync) lifts that.
- The list holds identifiers, and a display's name for people, for something like "FO on the MCDU", can come later as a map form without breaking a profile.

## Seats

```yaml
seats:
  pilot:
    name: Pilot
    hip: [0.31, 0.12, 1.40]                   # hypothetical numbers
    knees: [0.05, 0.45]
    feet: [-0.42, 0.62]
    eye: [0.63, -0.05]
  copilot:
    name: Copilot
    hip: [-0.31, 0.12, 1.40]
    knees: [0.05, 0.45]
    feet: [-0.42, 0.62]
    eye: [0.63, -0.05]
    take_radius: 0.25
```

- A seat's key is its ID, which seat claims carry between machines, and `name` is what a pilot reads.
- `hip` is `[x, y, z]`, in the frame `location` uses, and a figure whose origin is at the hip sits on a seat object there with no offset (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own)).
- `knees`, `feet`, and `eye` are `[up, forward]` in meters from the hip, in the seat's own frame.
  Legs and eyes don't go sideways from the hip, and measured from it they hold for a seat that faces sideways too, and move with the hip while it's tuned.
- The thigh and shin stretch to fit between the hip, the knees, and the feet, as the figure's neck stretches to reach the camera, so a deep cushion moves the knees forward; that stretched limbs look right is unverified, and the first cockpits we try settle it.
- `facing` is optional, in degrees from the nose, positive to the right, and defaults to 0.
- `take_radius` and `leave_radius`, in meters, are optional, for a seat where the defaults misjudge it ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
- Which hand rules a seat uses follows from the side of the centerline its hip is on ([avatars' tentative decisions](../avatars/decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat)).
- A variant with a different cabin gets seats of its own, under keys of their own, with `only`.
- The seat tool seeds the numbers, from the seat objects SimConnect lists, then the cockpit model's `PILOT_` nodes, then a click on the cushion, and the author tunes them in the sim; the tool writes them into the profile itself.

## Plugins

- An aircraft's plugin is `profiles/<name>.plugin.ts`, beside `profiles/<name>.yaml`.
  A profile has at most one plugin, names nothing to find it, and shares it with no other profile.
- The plugin runs while its profile is loaded, on every variant the profile covers, and reads the global `aircraft`, whose `variant` holds the profile's variant ID, such as `'press'`, to tell them apart.
- A profile watches a plugin's value as `plugin.state.<name>`, and writes through one of its write methods as `plugin.write.<name>(…)`, which is the whole write: a profile chains nothing onto it, and any pacing is the plugin's.
  Calling it hands the engine one action, as `write()` does, so a function's writes keep their call order.
- Every write a plugin makes ends in `write()`, so the engine paces, orders, marks, and checks those too.
  A setting that lives only in a gauge's JavaScript, or in the sim's DataStorage, is written through an operation of our panel bridge, and those operations are `write()` targets like any name.
  Which operations the panel bridge offers is for plugins' stage of step 8, from what the 58P's plugin needs ([01-spine](../architecture/01-spine.md#left-open)).
- A plugin reaches the sim and the aircraft through our APIs and nothing more: no files and no network.
  So the worst a plugin can do is spoil a flight, as a profile can, and neither needs a signature ([delivery](#delivery)).
  The 58P's plugin reads and writes its gauges' JavaScript and DataStorage through our panel bridge, and needs no files ([plugins](../product/03-v1-scope.md#plugins)).
- Plugins share no code yet, and a library they import comes when two plugins need the same code.
- How a plugin changes an aircraft's files waits until a plugin needs it, and [decision 001](../../decisions/001-changing-other-developers-packages.md) holds meanwhile.

## Modules

```yaml
import:
  - modules/gns-430                           # hypothetical names
  - modules/gtn-650-750
```

- A module is a profile without `aircraft:`: it holds `authors`, `state`, `events`, and `displays`.
  FS Copilot's 11 modules include the GNS 430, PMS50's and TDS's GTNs, the KFC 150 autopilot, and fuel and payload (read in the FS Copilot fork, `Definitions/modules/`).
- An import is the module's path from the repository's root, without `.yaml`.
- A module can't use `only` or a `location` map, since variant IDs belong to each profile.
- A missing module, an import cycle, or a key defined in two files fails the load.
  FS Copilot skips a missing include with an information-level log line and never checks for cycles (read in the FS Copilot fork, `FsCopilot/Simulation/Definitions.cs`, `TryLoadTree`), and 2 of its 125 includes named files that don't exist, such as `modules/paload.yaml` (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-29 — include-missing lands, after the level-3 entry point failed its own catalogue").
- CI publishes each profile with its modules merged in, as one file, and that file is what gets hashed and pinned, so a change to a module can't change what a pinned profile does.
- A module for an add-on the pilot hasn't installed loads anyway: on that machine its variables never change and its displays never appear, so it does nothing.
  Which add-ons the match check compares between pilots stays its open question ([preflight match check](../product/03-v1-scope.md#preflight-match-check)).

## What fails a load

The core, CI, and the IDE run one checker.
An error stops a profile loading and stops CI publishing it, and a warning is the IDE's advice and blocks nothing.

Errors:

- YAML that doesn't parse, such as a key repeated in one map; some of FS Copilot's CRJ profiles are invalid YAML for that reason (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — A setter is a script, and most entries do not have one").
- An unknown block or field, or one above the core's [level](#levels).
- An entry key that isn't lowercase snake_case starting with a letter, or a key defined twice across a profile and its modules.
- Two entries watching the same name on one variant.
  FS Copilot runs a repeated name as two subscriptions, and 197 of its entries are exact copies, which press twice for a button (fsc-editor, same log, "2026-08-29 — Level 3 opens, and a duplicate get: turns out to be two subscriptions"); one entry whose function writes several targets covers the deliberate cases.
- A name of the wrong kind for its field, such as a state entry watching an event, an event entry watching an `A:` variable, or `toggle` given a variable.
- A unit where a name takes none, or no unit on `A()`.
- A function that fails to type-check on any one variant, such as one that reads a key that variant doesn't have.
- `only`, or a `location` map, naming an unknown variant; a missing module or an import cycle; `value` twice in one name, or in a name that `write()` also gives a value; a pace in any other form than [pace](#pace) gives; `inc` and `dec` without `range`; a `WasmInstrument|` display in v1; and a `plugin.state` or `plugin.write` name the plugin doesn't register.

Warnings:

- An `ignore` naming a variable a state entry watches, which needs no `ignore`, since a value written twice stays the same.
- A name the loaded aircraft doesn't know, which is weak evidence, because the sim's tables fill as add-ons load (fsc-editor, `docs/sim-vars/18-language-core.md`, `b-preset-unknown`).
- A state entry whose value changes on its own, which the IDE sees live, and which [the driven-entry test](../sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself) catches in flight.
- Every watch-only entry, listed, since a forgotten `write` makes one without a word.

## The sandbox

Each loaded aircraft gets two QuickJS-ng runtimes in the core, one for its profile's script and one for its plugin, each with its own limits, so a plugin that fails can't stop the profile's writes.

| Limit | Value | Why that value |
| --- | --- | --- |
| Memory | 64 MB per runtime | QuickJS stopped a runaway allocation at this limit in 88ms, and the host ran on; an idle runtime held 0.9 MB, and a profile's state object should take a few MB at most (an estimate the 58P's profile measures) |
| Time | 10ms per call | A runtime runs one call at a time, so a stuck call holds up every write behind it, and 10ms is less than one sim frame at 60 fps; p04's write functions averaged under 1µs a call, 100 in 75µs |
| One entry's value | 4 KB, as sent | Numbers and switches never come near it; the KNS-81's 10 waypoints, the largest value we know of, would be a few hundred bytes (an estimate), and a cockpit change naming its entry and two pilots in full took 84 bytes ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)) |

The memory, time, and allocation figures are measured on our development machine, 2026-10-08 ([architecture log](../architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)), where QuickJS's interrupt handler also stopped an endless loop at its limit.
Time a plugin spends waiting on a panel's answer through our API doesn't count, since no JavaScript runs while it waits.
The state object needs no cap of its own, because a profile fixes its entries when it loads, and 4 KB bounds each.
All three values are starting values, and the 58P's profile and plugin show what real use needs.

At a limit:

- A write function fails that write, and its entry is flagged as for a write that never landed.
- A plugin is turned off for the rest of the session, and the banner says so ([plugins](../product/03-v1-scope.md#plugins)).
- A value over 4 KB isn't sent, and its entry is flagged.

## The repository

Profiles, plugins, and modules live in one public repository of flat files:

```text
crosscheck-profiles/
  profiles/
    baron-pro.yaml
    baron-pro.plugin.ts
    pa24.yaml
  modules/
    gns-430.yaml
    gtn-650-750.yaml
  .github/
    CODEOWNERS
  README.md
```

- Each profile's latest version is always at its one path, and git keeps the rest.
- `CODEOWNERS` names each profile's maintainers by path, and GitHub asks them to review every pull request that touches their files.
- An author finds a profile by browsing `profiles/`, or by searching the repository for the aircraft's SimObjects folder, which the profile lists under `variants`, and the desktop app can link to the file of the profile it loaded.
- To test an edit, the author puts the file in a local profiles folder, laid out as the repository is, which the core reads before the published profiles: a profile there overrides the published one for its variants, its imports resolve there first, and the match check shows it as "unpublished".
  A crewmate testing with them puts the same file there, and equal hashes prove they run the same copy.
- A pull request goes through CI's checks, and once merged, CI publishes it.

## Delivery

On each merge, CI publishes static files on GitHub Pages, built from the repository and its history:

- `index.json`, listing every published version of every profile with the variants it covers, its hash, the date CI published it, and its [level](#levels)
- every version of every profile, with its modules merged in, and every plugin, compiled to JavaScript, each under its hash and kept for good

The core uses them:

1. When an aircraft loads, the core fetches `index.json`, asking only for changes since the copy it holds, and takes the newest profile whose variants include the loaded folder and whose level is at or below its own.
2. It fetches that profile, and its plugin if it has one, by hash, and checks that the bytes match the hash.
3. The session pins one profile by its hash, nothing changes mid-session, and a pilot who lacks the pinned version fetches it by its hash ([tentative decisions](../architecture/decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)).
4. Offline, the core uses what it has cached.

- **Why Pages:** GitHub Pages "sites have a soft bandwidth limit of 100 GB per month", and a published site "may be no larger than 1 GB" (documented, [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)), while GitHub's REST API allows an unauthenticated address 60 requests an hour (documented, [rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  FS Copilot's 58P profile, merged but for its five modules, is 59 KB (read on disk, FS Copilot profiles, `profiles/bksq-aircraft-baronpropress.yaml`), so 1,000 pilots fetching a profile that size 30 times a month would take about 1.8 GB (arithmetic), and a fetch that finds nothing changed sends almost nothing.
- **Nothing is signed.** A profile's script can't touch files or the network, and neither can a plugin ([plugins](#plugins)), so a profile or plugin published from a hijacked repository could spoil flights and do nothing more.
  The hash check guarantees that pilots pinned to one profile run identical bytes.
  If a later plugin needs the pilot's files, signing comes back with it, with a key kept off GitHub, since a key CI holds would sign whatever a hijacked repository asks.
- The core checks for new versions whenever an aircraft loads, which answers the [spine](../architecture/01-spine.md#left-open)'s question of how often.

A profile carries no version or date of its own: the core computes the hash, and the date is when CI published it, so neither can be forgotten or wrong, and a copy passed around for testing shows as "unpublished".

## Levels

The format and the plugin API share one level, an integer that goes up by 1 whenever a Crosscheck release adds anything to either: a block, a field, a name call, or a method on the chain.
Levels only add, so a Crosscheck runs every profile and plugin at its own level and below, and each release carries the highest level it supports, which answers the [spine](../architecture/01-spine.md#left-open)'s question of how that version relates to Crosscheck's.

CI works out each profile's and plugin's level, so no author writes one.
It checks a profile's YAML against each level's schema and type-checks its script against each level's declarations, and the lowest level that passes is the profile's; a plugin is type-checked the same way.

For example, with hypothetical releases and dates:

1. Crosscheck 1.0 ships at level 1, and on 2026-10-20 the 58P's profile is published using level 1 alone, so the index lists it, hash `a1b2…`, at level 1.
2. Crosscheck 1.1 ships at level 2, adding a `checklist:` block, and on 2026-11-05 the profile gains one; level 1's schema refuses the unknown block and level 2's passes, so the index adds hash `c3d4…` at level 2.
3. Two pilots on 1.1 both take `c3d4…`, and a pilot still on 1.0 takes `a1b2…`, the profile from before the checklist, which loads, and flies with pilots on 1.0, who take the same.

A fix published after the checklist reaches only pilots on 1.1 or later, so a pilot who doesn't update Crosscheck keeps the older profile, bug included.
FS Copilot shows what levels prevent: its fork's new `pointer:` key "bricks profile loading on older releases" (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, item 6), because an unknown key emptied the whole profile (fsc-editor, `docs/sim-vars/18-language-core.md`, `key-unknown`).

## Deferred

Each of these waits until a profile or plugin needs it, and adding it takes a new level and changes no profile already written:

- **Counting into a shadow value, and `default`:** [01-profile-entries](../sync/01-profile-entries.md#keeping-a-shadow-value)'s last resort for a control no variable shows.
  Whether the 58P has such a control is unknown until its profile is written, and until then the PF's checklist of starting values is empty ([preflight](../product/03-v1-scope.md#preflight)).
- **Settings on following machines,** such as a failure rate of 0 on the Baron's tablet, which also need a rule for what happens when control passes.
- **A request field** for ground operations.
- **How a plugin changes an aircraft's files.**
- **Libraries** that plugins share.
- **Reading an aircraft's client data,** among the plugin APIs that step 8 designs.

## Left open

- Which pilot's version of a profile the session pins, when two pilots' cores took different versions, such as when one fetched the index after a merge; that's the session's to decide in step 8.
- How many times a built-in form retries, which [02-live-sync](../sync/02-live-sync.md#open-questions) leaves open.
- Where the core reads the version of a streamed Marketplace aircraft, which keeps no `manifest.json` in its folder, the match check's open question ([preflight match check](../product/03-v1-scope.md#preflight-match-check)).
- Whether the legacy transmit call reaches every aircraft's handlers ([which call sends an event](#which-call-sends-an-event)).
</content>
</invoke>
