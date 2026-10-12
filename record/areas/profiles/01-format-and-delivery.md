# Profiles: format and delivery

```text
Purpose:     How a profile and its plugin are written, checked, limited, and delivered to pilots.
Depends on:  ../sync/01-profile-entries.md, ../sync/02-live-sync.md, ../sync/04-order-and-recovery.md, ../architecture/01-spine.md, ../architecture/decisions.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md
Decides:     A profile's syntax, fields, and file layout; how its script names and writes things; how a write is checked; what a plugin can reach; what fails a load; the sandbox's limits; and how profiles and plugins reach pilots, with the level of the format each needs.
```

A profile is one YAML file, and wherever a value names or writes something in the sim, it's JavaScript calling functions Crosscheck defines.
`L('BKSQ_MixtureLeverPosition_1')` names a variable, and `write()` is the one call that writes.
Profiles live as flat files in a public repository, where CI checks each one, works out the level of the format it needs, and publishes it on GitHub Pages as one file, with its modules and its compiled plugin in it, under its hash.
Each time the core starts, it brings its cache up to date from the published index, it loads every profile from that cache, and a session, which flies one aircraft, pins its profile by its hash.
An aircraft's plugin is a TypeScript file beside its profile, and every write it makes goes through `write()` too.

This answers node 4 of the [architecture plan](../architecture/plan.md#4-profiles-and-plugin-delivery).
A profile's shape, a block of state entries, a block of event entries, and a writer, is [01-profile-entries](../sync/01-profile-entries.md)'s, and this document gives it a syntax; a note at the top of 01-profile-entries says where this document changes it.
The user chose each part of the format with us on 2026-10-11 and 2026-10-12, and the reasons below are the ones that decided it.

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

The 58P's mixture lever drags `L:BKSQ_MixtureLeverPosition_1`, and the aircraft's behavior code writes the stock mixture from it, and its weather radar's gauge fires `H:bksq_wradar1_radarAlertToggle` (read in bksq-aircraft-baronpro 0.1.1, `bksq_wradar1.js`, [Baron study](../aircraft/black-square-baron-pro/study.md)).

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
| `B(name)` | An input event: watched, its value; written, the preset its name gives, such as `B('ELECTRICAL_Battery_1_Toggle')` | None |
| `K(name, ...values)` | A `K:` event | The event's other values |
| `H(name)` | An `H:` event | None |

- `A()` takes a unit every time, because the unit sets the scale and more than one resolves.
  Of the 2,464 `A:` lines in FS Copilot's profiles that carry both a written unit and a documented one, 549 disagree, such as `Position 16k` for a percentage, and they work, since both machines run the same profile (counted by fsc-editor, `docs/sim-vars/18-language-core.md`, the struck row on unit categories).
  The IDE fills in the documented unit.
- A unit on `B()`, `K()`, or `H()` is an error.
  60 `H:` lines in FS Copilot's profiles carry a `Bool` that the calculator ignores (same document, `get-unit-meaningless`); that a unit means nothing on `B:` and `K:` names too is unverified.
- A string unit reads text, as in `A('TITLE', 'string')`.
- `K()`'s other values go after the value a write passes: `K('KOHLSMAN_SET', 2)` is meant to set altimeter 2 only.
  As calculator code, `2 16272 (>K:2:KOHLSMAN_SET)` set only altimeter 2 on the Baron 58P (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air"); that the index sent as `_EX1`'s second value does the same is unverified.
  For an event that takes the written value later in its list, `value` marks the place: `K('SOME_EVENT', 3, value)`, for a hypothetical event, sends 3, then the value.
  Where each event takes its value is documented for only 662 of the SDK's 1,524 `K:` events (counted by fsc-editor, same document, "Confidence tiers").
- `none` names nothing, and `write: none` marks a watch-only entry ([state entries](#state-entries)).
- An aircraft's client data, such as the PMDG 777's `ELEC_Battery_Sw_ON` (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)), has no name call: what its bytes mean comes from a layout only that aircraft has, so the aircraft's plugin reads it and exports what the profile needs ([plugins](#plugins)).

Names are quoted because they're JavaScript strings, and the same JavaScript runs everywhere a profile has script.

## Writing

`write:` is required on every entry, and takes a name, a map, a plugin's write method, a function, or `none`:

| Form | Example | What the engine does |
| --- | --- | --- |
| A name | `write: L('BKSQ_MixtureLeverPosition_1')` | Writes the value into it: sets the variable, or sends the event once |
| A map with `toggle` | `write: {toggle: K('TOGGLE_BEACON_LIGHTS')}` | Compares the wanted value with the local one, and flips only if they differ |
| A map with `inc` and `dec` | Below | Turns the difference into steps |
| A plugin's write method | `write: plugin.write.radar_range` | Calls it with the value ([plugins](#plugins)) |
| A function | Below | Runs it |
| `none` | `write: none` | Nothing: the entry is watch-only, and every machine watches it and compares the values |

A sketch, with stock names, of a heading bug that steps:

```yaml
heading_bug:
  name: Heading bug
  watch: A('AUTOPILOT HEADING LOCK DIR', 'Degrees')
  write:
    inc: K('HEADING_BUG_INC')
    dec: K('HEADING_BUG_DEC')
    wrap: true
    range: [0, 359]
```

- An `inc` and `dec` map steps from the local value to the wanted one, `step` at a time, which defaults to 1.
  Both values are the aircraft's own readings, so the steps never ask the control to pass its ends.
- `wrap` is required in the map, except on a counted entry, whose write steps by the count's `wrap` and `range` ([counting](#counting-into-a-shadow-value)): `true` for a control that goes from its top straight back to its bottom, like a heading, and `false` for one that stops.
  With `wrap: true`, `range` is required too, and the engine steps the shorter way round, so a turn from 359 to 0 is one step rather than 359 the other way.
  The load error for a missing `wrap` asks that question, and the IDE fills in `dec`, `wrap`, and `range` once `inc` is typed.
- An `inc` and `dec` map takes an optional `pace` ([pace](#pace)).
- Nothing else writes: two `write()` calls in a function do what a second action after the first would, and a name on its own is a set.

### Write functions

```yaml
fuel_pump_1_1:
  name: Fuel pump 1-1
  watch: L('SWITCH_FUEL_PUMP_1_1')
  write: |
    (value) => {
      write(L('SWITCH_FUEL_PUMP_1_1'), value)
      write(H('FUEL'))
    }
```

The L-1011's fuel pump click flips `L:SWITCH_FUEL_PUMP_1_1` and fires `H:FUEL`, and its flight engineer's script acts only on `H:FUEL` (read in inibuilds-aircraft-l1011 1.0.8, [L-1011 study](../aircraft/inibuilds-l1011/study.md); unverified in the sim).

- A write function takes the value to write, and returns nothing.
  `state`, the state object, is a global, and so are the names and `write()`, so nothing else is passed in.
- It reads only `state`, never through a name, and one that reads a key the profile doesn't have fails the load.
- `write(target)` sends the name's own arguments, and `write(target, value)` sends the value, then the name's arguments.
- Each `write()` hands the engine one action, and the engine sends a run's actions together, in call order, so it sees every action, as 01-profile-entries' writer required.
  Two writes to one variable in one frame landed in the order sent on six aircraft (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)); whether an aircraft's code sees writes to two different targets in the order sent is untested.
- Only a chain spaces actions out: `write(K('HEADING_BUG_INC')).repeat(steps)` sends the event `steps` times at the aircraft's [pace](#pace), and `.every('2 frames')` sets the spacing for that chain.
- When the engine runs a function, and what it does with a run that writes nothing, belong to the sync engine ([checking a write](#checking-a-write)).

### Pace

A pace is written the same way in YAML and in a chain: `1 frame`, `<number> frames`, or `<number>ms`, as in `pace: 2 frames` and `.every('2 frames')`, and TypeScript checks the string in a chain.
A pace spaces the steps of an `inc` and `dec` map and the actions of a chain, one step a frame unless a pace says otherwise: `aircraft:`'s `pace` sets it for the whole aircraft, a map's `pace` for one entry, and `.every()` for one chain, each overriding the one before.
The A350 takes at most one command every 2 frames (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)), so its profile would set `pace: 2 frames` once.

### Which call sends an event

The engine sends an event that carries at most one value through SimConnect's legacy transmit call, and one that carries more through `_EX1`, which takes up to five where the legacy call "only permits one" (documented, [SimConnect_TransmitClientEvent_EX1](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_TransmitClientEvent_EX1.htm)), so a profile never says which.
The PMDG 777's module dropped a yoke axis event sent with `_EX1` and acted on the same event sent with the legacy call (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)).
That every aircraft acts on an event sent with the legacy call is unverified: FS Copilot sends every `K:` event with `_EX1` (fsc-editor, `docs/fscopilot-behavior.md`, "How writes reach the sim"), and the 58P's profile is the first test.

## State entries

| Field | Required | What it says |
| --- | --- | --- |
| `name` | Yes | The control's name for people, used in the IDE, notices, the PF's checklist, and the recording |
| `watch` | Yes | A variable or a plugin's value, which every machine reads, or a map that counts events into a [shadow value](#counting-into-a-shadow-value) |
| `write` | Yes | How to change the control ([writing](#writing)) |
| `default` | With a counting `watch` | The shadow value's starting value |
| `owner` | No | `pilot_flying`, or `shared`, the default |
| `only` | No | The variant IDs the entry applies to |
| `ignore` | No | The names this entry's action also fires |
| `location` | No | Where the control is, for the figure's hand |

- With `owner: pilot_flying`, only the flying machine sends the entry, and a following machine puts back its own pilot's change ([04-order-and-recovery](../sync/04-order-and-recovery.md#putting-back)).
  A profile's PF-owned entries are the engine levers and trim, and the yoke, rudder, and toe brakes travel in the flight model's samples instead ([01-between-machines](../network/01-between-machines.md#channels)).
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

### Counting into a shadow value

When no variable shows a control's value, `watch` counts the events that change it, and Crosscheck keeps the result as a shadow value, starting from `default`, as [01-profile-entries](../sync/01-profile-entries.md#keeping-a-shadow-value) designed it.

```yaml
fcu_heading:
  name: FCU heading
  default: 0
  watch:
    inc: K('SOME_AC_HDG_INC')                 # hypothetical aircraft and events
    dec: K('SOME_AC_HDG_DEC')
    wrap: true
    range: [0, 359]
  write:
    inc: K('SOME_AC_HDG_INC')
    dec: K('SOME_AC_HDG_DEC')
```

- A counting `watch` takes any of: `inc` and `dec`, each moving the shadow a `step`, which defaults to 1; `set`, an event whose value becomes the shadow; and `count`, a variable whose change is added, for a counter such as the Fenix's `L:E_FCU_HEADING`, which adds 1 for every detent of the heading knob (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md)).
- It requires `wrap` and `range`, because the count has to stop, or go round, where the aircraft's does: a shadow that kept counting past the top of a speed the aircraft holds at its top would stay wrong, and every following machine would take its value.
- The entry's stepping write steps by the count's `wrap` and `range`, since the shadow is where the write both starts and ends, and a stepping write on a counted entry that gives its own fails the load.
- `default` goes on the PF's preflight checklist under the entry's `name`, because the shadow is right only if the PF's aircraft starts there, and the shadow goes back to it whenever the aircraft reloads ([01-profile-entries](../sync/01-profile-entries.md#keeping-a-shadow-value)).
- A shadow has nothing to read back, so its writes get no [check](#checking-a-write) ([02-live-sync](../sync/02-live-sync.md#checking-that-a-write-landed)).

`wrap` and `range` appear only in a map that steps or counts, and nowhere else.

## Event entries

| Field | Required | What it says |
| --- | --- | --- |
| `name` | Yes | The event's name for people |
| `watch` | Yes | A `K:`, `H:`, `B:`, or `L:` name; an `L:` variable is a pulse, each rise from 0 one occurrence |
| `write` | Yes | What to do on the other machines, in any form but `none`; a function gets the event's value, if it carried one |
| `only`, `ignore`, `location` | No | As for a state entry |

```yaml
events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
    ignore: K('TOGGLE_FLIGHT_DIRECTOR')
```

The Bonanza's autopilot click fires `K:AP_MASTER`, and `K:TOGGLE_FLIGHT_DIRECTOR` too when the director is off (read in bksq-aircraft-bonanzapro 0.1.1, [Bonanza study](../aircraft/black-square-bonanza-pro/study.md)), which is what the `ignore` above is for.
The IDE fills `write` with the watched name.

## Checking a write

How the engine checks that a write landed, how it tells the echo of its own write from a pilot's change, whether it retries, how a stepped write follows a knob that's still moving, and when it runs a write function all belong to the sync engine inside the core, and none of them changes the format.
They stay open for sync's stage of step 8, to be settled on a two-instance bench in the sim rather than on paper, because each turns on timing: a write shows in a reading within 2 frames, and a readout the aircraft computes can follow 1.2s later, as the Fenix's battery bus and lamp did after a write to its battery switch (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames), and [sync log](../sync/log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).
[02-live-sync](../sync/02-live-sync.md#checking-that-a-write-landed)'s rules hold until then.

The bench starts from two simplifications (user, 2026-10-12):

- A write gets one attempt, with no retry, since every write that landed in our tests landed on the first try, and the one that didn't, the A220's heading, didn't land after 3 retries either (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames)).
- A write function runs once for each value it's given.

It tests the cases node 4's and node 3's reviews traced, each of which broke a rule written on paper or turns on frame timing:

- A knob turned a detent a frame, sending 100, 101, and 102: the receiving machine reads 100 when 102 is already wanted, so an echo rule that knows only the newest wanted value sends 100 back as a pilot's change, and a stepped write that starts again from a lagging reading overshoots.
- A pilot turning a knob back within 2s of a write that passed through the same values, whose change an echo rule that remembers those values would swallow, against [state sync](../product/03-v1-scope.md#state-sync)'s rule that such a change goes out.
- A `toggle` over a lamp that lights after the check gives up, or never lights, where a retry would flip the switch a second time.
- A write right behind the battery switch in catch-up's burst, before the bus has power, and a write function that checks for power and writes nothing, whose value is lost without a flag unless the engine checks it anyway.
- A press on a synced display that sets a variable the profile also syncs, whose change reaches the core through SimConnect before the press arrives over the panel's WebSocket, so the other machine writes the variable, then replays the press, which flips it back, and that later change wins everywhere (node 3's review, 2026-10-13).
  The 58P's tablet mirrors its settings to `L:` variables the profile syncs ([plugins](../product/03-v1-scope.md#plugins)), so its profile meets this if it also lists the tablet as a display.
- A button that sets an `L:` variable to 1 and back to 0 within one frame, which a reading once a frame may never see, so an event entry watching it never fires (node 3's review, 2026-10-13).
- A value written as 165 that reads back as 165.000002 (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own)), so a check compares within float32 precision.

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
- An aircraft built the MSFS 2024 way keeps its variants as presets inside one folder, so a variant can name presets instead, each by its path below `SimObjects\Airplanes\`, written with `/`, and one ID can list several.
  A bare folder covers every preset in it.

```yaml
aircraft:
  variants:
    a359: [A350/presets/inibuilds/A350-900_Default_Cabin, A350/presets/inibuilds/A350-900_No_Cabin]
    a35k: [A350/presets/inibuilds/A350-1000_Default_Cabin, A350/presets/inibuilds/A350-1000_No_Cabin]
```

- The iniBuilds A350's -900 and -1000 are presets of the folder `A350`, and the Fenix's A319, A320, and A321 are presets of `FNX_32X`, whose study says both pilots must fly the same preset (read in inibuilds-aircraft-a350 1.2.6 and fnx-aircraft-320 2.4.0.4720, [A350 study](../aircraft/inibuilds-a350/study.md#identity), [Fenix study](../aircraft/fenix-a320-family/study.md#identity)).
- The core matches a loaded aircraft by its folder and its preset, from the path the sim reports when it loads, and compares them ignoring case, since one load reported a relative, mixed-case path and then an absolute, lowercase one ([02-02](../../learn/foundations/02-02-aircraft.md#how-an-aircraft-is-identified)).
  FS Copilot keeps only the folder, the path's segment after `SimObjects\Airplanes\` (read in the FS Copilot fork, `FsCopilot/Connection/SimConnectConsumer.cs`, `PushAircraft`), though the PA-24's path named its preset too: `pa24-250\presets\a2a\pa24-250\config\aircraft.CFG` (measured on MSFS 2024, 2026-08-18, fsc-editor, [A2A PA-24 study](../aircraft/a2a-pa24-comanche/study.md)).
  The PA-24 has one preset, so whether the path names the loaded preset on an aircraft with several, and whether `A:TITLE` gives the preset's own title, is the [L-1011 study](../aircraft/inibuilds-l1011/study.md)'s sim question 13; the profile names the preset either way, so which of the two the core reads is for the core's stage of step 8.
- Two pilots fly together only in the same folder and preset: another aircraft, a different variant included, keeps a pilot out of the flight, while different versions and liveries stop nothing ([03-v1-scope](../product/03-v1-scope.md); user, 2026-10-12).
- The core finds the package that holds the folder from the same path, for the aircraft's version and the [preflight match check](../product/03-v1-scope.md#preflight-match-check), so a profile names no package.
  One package can hold several aircraft: `bksq-aircraft-baronpro` 0.1.1 holds all three Barons ([Baron study](../aircraft/black-square-baron-pro/study.md#identity)).
- A profile lists no aircraft versions, because authors would leave the list empty or wrong too often for its warning to mean anything, and the match check still compares the two pilots' aircraft versions with each other.
- `pace` sets the pace for the whole aircraft ([pace](#pace)).

## Displays

`displays` lists the panels pointer sync replays presses into, by the identifiers our FS Copilot fork's `pointer:` took.

- A bare identifier, such as `DisplayUnits`, opts in every panel that carries it, which survives liveries: a peer's press, opted in by `DisplayUnits` alone, drove the A220's ND to plan mode on livery N324DU, whose panel identifies as `DisplayUnits|config=N324DU` (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone").
  A profile naming `DisplayUnits|config=Default` would match nothing on that livery (read, not flown, same log, "2026-09-17 — The A220's DisplayUnits key carries the livery, and the profile names only Default").
- A full key opts in exactly that panel, for an identifier several instruments share, such as the A220's CTPs, MKPs, and FCPs (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "4.10 Profile key shape: identifier by default, full key to narrow").
- A panel that isn't listed gets no replayed presses, so the format needs no list of panels to leave out, as FS Copilot's `ignore:` is, and no `only`, since a panel a variant lacks never appears.
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
- `hip` is `[x, y, z]`, in the frame `location` uses.
  A GSX figure whose origin is at its feet sat a seat's height too high on a seat object, so a figure whose origin is at the hip should sit there with no offset (inferred from that run, measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-writing-a-gsx-persons-animation-frame-makes-it-walk-and-a-seated-one-moves-on-its-own); unverified until a hip-origin figure sits).
- `knees`, `feet`, and `eye` are `[up, forward]` in meters from the hip, in the seat's own frame.
  Legs and eyes don't go sideways from the hip, and measured from it they hold for a seat that faces sideways too, and move with the hip while it's tuned.
- The thigh and shin stretch to fit between the hip, the knees, and the feet, as the figure's neck stretches to reach the camera, so a deep cushion moves the knees forward; that stretched limbs look right is unverified, and the first cockpits we try settle it.
- `facing` is optional, in degrees from the nose, positive to the right, and defaults to 0.
- `take_radius` and `leave_radius`, in meters, are optional, for a seat where the defaults misjudge it ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
- Which hand rules a seat uses, the left seat's or the right's ([avatars' tentative decisions](../avatars/decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat)), this document takes from the side of the centerline its hip is on, so a seat needs no field for it.
- A variant with a different cabin gets seats of its own, under keys of their own, with `only`.
- The seat tool seeds the numbers, from the seat objects SimConnect lists, then the cockpit model's `PILOT_` nodes, then a click on the cushion, and the author tunes them in the sim; the tool writes them into the profile itself.

## Plugins

- An aircraft's plugin is `profiles/<name>.plugin.ts`, beside `profiles/<name>.yaml`.
  A profile has at most one plugin, names nothing to find it, and shares it with no other profile.
- The plugin is published inside its profile's file, with one hash and one level ([delivery](#delivery)), so a pinned profile pins its plugin too.
- The plugin runs while its profile is loaded, on every variant the profile covers, and reads the global `aircraft`, whose `variant` holds the profile's variant ID, such as `'press'`, to tell them apart.
- A profile watches a plugin's value as `plugin.state.<name>`, and writes through one of its write methods as `plugin.write.<name>(…)`, which is the whole write: a profile chains nothing onto it, and any spacing is the plugin's.
  Calling it hands the engine one action, as `write()` does, so a function's writes keep their call order.
- Every write a plugin makes ends in `write()`, so the engine orders, marks, and checks those too.
  A setting that lives only in a gauge's JavaScript, or in the sim's DataStorage, is written through an operation of our panel bridge, and those operations are `write()` targets like any name.
  Which operations the panel bridge offers is for plugins' stage of step 8, from what the 58P's plugin needs ([01-spine](../architecture/01-spine.md#left-open)).
- A plugin reaches the sim and the aircraft through our APIs and nothing more: no files and no network.
  So the worst a plugin can do is spoil a flight, as a profile can, and neither needs a signature ([delivery](#delivery)).
  The 58P's plugin is expected to read and write its gauges' JavaScript and DataStorage through our panel bridge and need no files; whether panel code can reach those settings is still [plugins](../product/03-v1-scope.md#plugins)' open question.
- When a plugin is turned off on any machine, every machine stops syncing that plugin's entries for the rest of the session, and the banner says so, so the machines never disagree over values one of them has frozen.
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
- A module can't use `only` or `location`: variant IDs belong to each profile, and a GNS 430 sits somewhere different in every cockpit.
  So an imported entry's control gets no reach from a hardware change, and a click on it still brings the hand; a profile could give its imported entries locations by key later, as an added field.
- A missing module, an import cycle, or a key defined in two files fails the load.
  FS Copilot skips a missing include with an information-level log line and never checks for cycles (read in the FS Copilot fork, `FsCopilot/Simulation/Definitions.cs`, `TryLoadTree`), and 2 of its 125 includes named files that don't exist, such as `modules/paload.yaml` (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-29 — include-missing lands, after the level-3 entry point failed its own catalogue").
- A module for an add-on the pilot hasn't installed loads anyway: on that machine its variables never change and its displays never appear, so it does nothing.
  Which add-ons the match check compares between pilots stays its open question ([preflight match check](../product/03-v1-scope.md#preflight-match-check)).

## What fails a load

The core, CI, and the IDE run one checker.
An error stops a profile loading and stops CI publishing it, and a warning is the IDE's advice and blocks nothing.

Errors:

- YAML that doesn't parse, such as a key repeated in one map; some of FS Copilot's CRJ profiles are invalid YAML for that reason (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — A setter is a script, and most entries do not have one").
- An unknown block or field, or one above the core's [level](#levels), and a `plugin:` key in a source file, which only the [bundle](#delivery) has.
- An entry with no `write`, an entry key that isn't lowercase snake_case starting with a letter, or a key defined twice across a profile and its modules.
- Two entries watching the same name on one variant.
  FS Copilot runs a repeated name as two subscriptions, and 197 of its entries are exact copies, which press twice for a button (fsc-editor, same log, "2026-08-29 — Level 3 opens, and a duplicate get: turns out to be two subscriptions"); one entry whose function writes several targets covers the deliberate cases.
- A name of the wrong kind for its field, such as a state entry watching a `K:` or `H:` event, an event entry watching an `A:` variable, or `toggle` given an `L:` or `A:` variable.
- A unit where a name takes none, or no unit on `A()`.
- A function that fails to type-check on any one variant, such as one that reads a key that variant doesn't have.
- In a map that steps or counts: no `wrap`, except in a counted entry's stepping write; `wrap: true` without `range`; a counting `watch` without `range` or without `default`; or a stepping write on a counted entry that gives its own `wrap` or `range`.
  Outside such a map, any `wrap` or `range`.
- `only`, or a `location` map, naming an unknown variant; `only` or `location` in a module; `only` on a display; a missing module or an import cycle; `value` twice in one name, or in a name that `write()` also gives a value; a pace in any other form than [pace](#pace) gives; a `WasmInstrument|` display in v1; and a `plugin.state` or `plugin.write` name the plugin doesn't register.

Warnings:

- An `ignore` naming a variable a state entry watches, which needs no `ignore`, since a value written twice stays the same.
- A name the loaded aircraft doesn't know, which is weak evidence, because the sim's tables fill as add-ons load (fsc-editor, `docs/sim-vars/18-language-core.md`, `b-preset-unknown`).
- A state entry whose value changes on its own, which the IDE sees live, and which [the driven-entry test](../sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself) catches in flight.
- A knob that went from 359 to 0 while the author turned it, on an entry marked `wrap: false`.

## The sandbox

Each loaded aircraft gets two QuickJS-ng runtimes in the core, one for its profile's script and one for its plugin, each with its own limits, so a plugin that fails can't stop the profile's writes.
The limits are for bugs, such as a loop that never ends or an array that never stops growing, not for bad actors, whom what a profile and a plugin can reach already stops ([plugins](#plugins)).
Without them, an endless loop would stop every write from that profile, and a runaway allocation could run the PC short of memory, with the sim the likeliest thing to crash.

| Limit | Value | Why that value |
| --- | --- | --- |
| Memory | 64 MB per runtime | QuickJS stopped a runaway allocation at this limit in 88ms, and the host ran on; an idle runtime held 0.9 MB, and a profile's state object should take a few MB at most (an estimate the 58P's profile measures) |
| Time | 100ms per call, by the clock | QuickJS stopped an endless loop at this limit, and the host ran on; a call that does little can still wait behind other work on a PC MSFS keeps busy, so the limit sits far above what a healthy call takes, 100 write functions in 75µs, and a stuck call, a bug, holds up the writes behind it for no longer |
| One entry's value | 4 KB, as sent | Numbers and switches never come near it; the KNS-81's 10 waypoints, the largest value we know of, would be a few hundred bytes (an estimate), and a cockpit change naming its entry and two pilots in full took 84 bytes ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)) |

The memory and time figures were measured on our development machine, 2026-10-08, in a host doing nothing else, not inside a core at work ([architecture log](../architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off)).
Time a plugin spends waiting on a panel's answer through our API doesn't count, since no JavaScript runs while it waits.
The state object needs no cap of its own, because a profile fixes its entries when it loads, and 4 KB bounds each.
All three values are starting values, and the 58P's profile and plugin show what real use needs.

At a limit:

- A write function fails that write, and its entry is flagged as for a write that never landed.
- A plugin is turned off for the rest of the session, every machine stops syncing its entries, and the banner says so ([plugins](#plugins)).
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
- `CODEOWNERS` names each profile's maintainers by path, and "Code owners are automatically requested for review when someone opens a pull request that modifies code that they own" (documented, [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)).
- An author finds a profile by browsing `profiles/`, or by searching the repository for the aircraft's SimObjects folder, which the profile lists under `variants`, and the desktop app can link to the file of the profile it loaded.
- A pull request goes through CI's checks, and once merged, CI publishes it.

### Testing an edit

- The author works in a local profiles folder, laid out as the repository is, which the core reads before the published profiles: a profile there overrides the published one for its variants, and its imports resolve there first.
- When it loads a profile from there, the core builds the same [bundle](#delivery) CI would, with the same builder code, and the match check shows it as "unpublished".
  A crewmate testing with the author puts the same files in their own local folder, and equal hashes prove they run the same copy.

Rapid testing, where the core rebuilds on every save and the author's core sends each new bundle to the crew over the session, which reloads the session's profile on every machine, is a test session (user, 2026-10-12).
The one-file bundle makes each reload one message, and a crewmate's core runs the author's exact bytes with no folder or compiler of its own.
Test sessions are for step 8, with the Crosscheck IDE's dev loop, a Soon pick ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client) lists reloading a profile mid-session among the IDE's commands), and node 4's review found three things they need: a reload starts a plugin that was turned off afresh, a reload skips [catch-up's settling window](../sync/04-order-and-recovery.md#an-aircraft-that-loaded-before-its-session), since the aircraft didn't load again, and the author's core sends the current bundle to a pilot who joins or rejoins, since a test bundle isn't on Pages.

## Delivery

On each merge, CI builds every profile into a bundle and publishes static files on GitHub Pages, from the repository and its history:

- **A bundle** is a profile in this same YAML format, with its modules merged in, so it has no `import`, and with its plugin compiled to JavaScript under a `plugin:` key, which only the builder writes.
  It gets one hash, over its bytes, and one [level](#levels), the higher of the profile's and the plugin's.
  A bug report can carry the exact profile and plugin a session ran as one text file.
- **`index.json`** lists every published bundle with its profile's path, the variants it covers, its hash, the date CI published it, and its level.
- **Every bundle** is published under its hash and kept for good.

The core uses them:

1. Each time it starts, the core fetches `index.json` and downloads, for each profile, the newest bundle at or below its own level that its cache lacks, and checks that the bytes match the hash; it never rebuilds a published bundle.
   The core starts with every sim run ([tentative decisions](../architecture/decisions.md#the-core-starts-with-every-sim-run)), so a bundle CI publishes reaches a pilot at their next sim start.
2. It loads a profile from its cache whenever the spine's [what moves them](../architecture/01-spine.md#what-moves-them) says to, such as when a session starts with the aircraft already loaded, so a load never waits on the network.
3. A session flies one aircraft, its PF's ([roles and members](../session/01-roles-and-members.md#the-pf)), and pins that aircraft's bundle by its hash, which doesn't change for the rest of the session outside a test session; a pilot whose cache lacks it fetches it by its hash ([tentative decisions](../architecture/decisions.md#profiles-and-plugins-reach-pilots-apart-from-crosschecks-releases)).
4. Offline, the core uses what it has cached.

- **Why Pages:** GitHub Pages "sites have a soft bandwidth limit of 100 GB per month", and a published site "may be no larger than 1 GB" (documented, [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)), while GitHub's REST API allows an unauthenticated address 60 requests an hour (documented, [rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  FS Copilot's 58P profile, merged but for its five modules, is 59 KB (read on disk, FS Copilot profiles, `profiles/bksq-aircraft-baronpropress.yaml`), and a pilot downloads each bundle once, so 1,000 pilots taking 50 bundles that size, a hypothetical count, take about 3 GB once, and after that only what CI publishes, plus the index at each start (arithmetic).
  Whether Pages answers a repeat fetch of an unchanged `index.json` with "not modified", sending almost nothing, is unverified.
- **Nothing is signed.** A profile's script can't touch files or the network, and neither can a plugin ([plugins](#plugins)), so a bundle published from a hijacked repository could spoil flights and do nothing more.
  The hash check guarantees that pilots pinned to one bundle run identical bytes.
  If a later plugin needs the pilot's files, signing comes back with it, with a key kept off GitHub, since a key CI holds would sign whatever a hijacked repository asks.
- The core checks for new versions each time it starts, which answers the [spine](../architecture/01-spine.md#left-open)'s question of how often.

A profile carries no version or date of its own: the core computes the hash, and the date is when CI published it, so neither can be forgotten or wrong, and a copy passed around for testing shows as "unpublished".

## Levels

The format and the plugin API share one level, an integer that goes up by 1 whenever a Crosscheck release adds anything to either: a block, a field, a name call, or a method on the chain.
Levels only add, so a Crosscheck runs every bundle at its own level and below, and each release carries the highest level it supports, which answers the [spine](../architecture/01-spine.md#left-open)'s question of how that version relates to Crosscheck's.

CI works out each bundle's level, so no author writes one.
It checks the profile's YAML against each level's schema and type-checks its script and its plugin against each level's declarations, and the lowest level that passes all three is the bundle's.

For example, with hypothetical releases and dates:

1. Crosscheck 1.0 ships at level 1, and on 2026-10-20 the 58P's profile is published using level 1 alone, so the index lists its bundle, hash `a1b2…`, at level 1.
2. Crosscheck 1.1 ships at level 2, adding a `checklist:` block, and on 2026-11-05 the profile gains one; level 1's schema refuses the unknown block and level 2's passes, so the index adds hash `c3d4…` at level 2.
3. Two pilots on 1.1 both take `c3d4…`, and a pilot still on 1.0 takes `a1b2…`, the bundle from before the checklist, which loads, and flies with pilots on 1.0, who take the same.

A fix published after the checklist reaches only pilots on 1.1 or later, so a pilot who doesn't update Crosscheck keeps the older bundle, bug included.
FS Copilot shows what levels prevent: its fork's new `pointer:` key "bricks profile loading on older releases" (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, item 6), because an unknown key emptied the whole profile (fsc-editor, `docs/sim-vars/18-language-core.md`, `key-unknown`).

## Deferred

Each of these waits until a profile or plugin needs it, and adding it takes a new level and changes no profile already written:

- **Settings on following machines,** such as a failure rate of 0 on the Baron's tablet, which also need a rule for what happens when control passes.
- **A request field** for ground operations.
- **How a plugin changes an aircraft's files.**
- **Libraries** that plugins share.
- **Reading an aircraft's client data,** among the plugin APIs that step 8 designs.
- **Locations for a module's entries,** given by the profile that imports it.

## Left open

- Which pilot's bundle the session pins, when two pilots' cores hold different ones, such as when one pilot's sim started after a merge; that's the session's to decide in step 8.
- Whether the core tells which preset loaded from the path the sim reports or from `A:TITLE`, for the core's stage of step 8 ([the aircraft and its variants](#the-aircraft-and-its-variants)).
- Where the core reads the version of a streamed Marketplace aircraft, which keeps no `manifest.json` in its folder, the match check's open question ([preflight match check](../product/03-v1-scope.md#preflight-match-check)).
- Whether the legacy transmit call reaches every aircraft's handlers ([which call sends an event](#which-call-sends-an-event)).
- Which compiler the core embeds to build a local bundle's plugin, for step 8.
- How the sync engine checks a write, tells its own echo from a pilot's change, retries, follows a moving knob, and runs write functions, for sync's stage of step 8 ([checking a write](#checking-a-write)).
