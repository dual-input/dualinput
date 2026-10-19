# Sync: profile entries

```text
Purpose:     What a profile says about an aircraft's cockpit, so Dual Input can sync it.
Depends on:  ../product/03-v1-scope.md (state sync), 02-live-sync.md, 03-catch-up.md
Decides:     The profile's two blocks, the fields of an entry, the writer API, and what a profile says once per aircraft.
```

> **Note**
> Since 2026-10-11, [01-format-and-delivery](../profiles/01-format-and-delivery.md) gives this format its syntax, and changes it in these ways.
> A profile's script is JavaScript calling Dual Input's globals, with names quoted, as `L('BKSQ_MixtureLeverPosition_1')`, where the sketches below leave names bare.
> The direction field is `owner`, `pilot_flying` or `shared` by default.
> `write:` is required on every entry, and takes a name, which it sets, a map for `toggle` or `inc` and `dec`, a plugin's write method, a function, or `none`, which marks a watch-only entry in place of a missing `write`; `set:` and `then` are gone.
> A write function takes only the value to write, reads the global `state`, writes through `write()`, as in `write(K('SET_XPDR_MODE'), value)`, in place of the writer's `k()`, `l()`, `b()`, and `h()`, and returns nothing; when the engine runs it, and whether it runs again when an entry it read changes, as [the writer API](#the-writer-api) below says, stay open for sync's stage of step 8 ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)).
> A counting `watch` takes `inc` and `dec`, `set`, or `count`, in place of the `on:` rules below, and `wrap`, required, and `range` live only in a map that steps or counts, where the `inc` and `dec` form's `range` and `wrap` sit beside them below.
> A plugin's values are `plugin.state.<name>`, and its writes `plugin.write.<name>(…)`, each the whole write; an aircraft's client data is read by its plugin, not watched by name.
> An event entry's `run` is named `write`.
> The settings for following machines wait until a profile needs them; a profile names no transport, since the engine picks the call by how many values an event carries; a pace is written `2 frames` or `40ms`, for the whole aircraft in the profile's header; and the engine caps one entry's value, not the whole state object, since a profile fixes its entries when it loads.
>
> Since 2026-10-16, [the sync units](05-units.md) settles two of this document's open lines: state sync fires `H:` events from a routine of its own in our WASM module through `fsEventsHEventCall`, since the SDK documents no SimConnect route to them, which [the writer API](#the-writer-api) leaves unverified ([`H:` events](05-units.md#h-events)); and a write function runs once for each value it's given, and never again when an entry it read changes, where the writer API runs it again ([write functions](05-units.md#write-functions)).

A profile describes an aircraft's cockpit in two blocks.
`state:` holds the controls whose value Dual Input can read, or can track by counting the events that change it: it syncs them as values, checks that each write landed, and brings a cockpit that missed changes back to the flying machine's state.
`events:` holds what Dual Input can only see happen: it forwards those live, best effort, and never catches them up.
The flying machine is the PF's, and a following machine is any other pilot's.

An author writes what they can find in the aircraft's files: where a control's value can be read, and what changes it.
The engine decides how to sync it, so an author never has to know, for example, that an absolute setter beats a toggle.
Field names that do something are verbs, such as `watch`, `write`, and `ignore`.
`watch` names what Dual Input observes in both blocks: a value under `state:`, and an occurrence under `events:`.

This document fixes the shape of the profile format.
Its syntax and file layout are step 7's decision in [the plan](../product/plan.md), so every example below is a sketch.

The split between reading and writing matches how profiles are already written: 9,673 of the setters in FS Copilot's community profiles write a different name than they read, against 701 that write the same one (measured across those profiles, fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-08-29, "The insurance rules, and the setter family measured down to three").

## State entries

| Field | What it says |
| --- | --- |
| `name` | The control's name for people, used in the Dual Input IDE, the preflight checklist, and notices |
| `watch` | Where the value comes from: a variable, a plugin's value, or rules that count events into a shadow value |
| `default` | A shadow value's starting value |
| `write` | How to change the control: `set`, `toggle`, `inc` and `dec`, `then`, or a write function, and with no `write` the entry is watch-only |
| direction | Whether only the flying machine sends the entry, or any pilot's machine can |
| `ignore` | The names this entry's action also fires, which Dual Input ignores once afterward |

On each machine, the state object is all of an aircraft's state entries with their current values.

### Watching a value

`watch` names a variable when the control's value is one:

```yaml
fcu_heading:
  name: FCU heading
  watch: L:var_fcuHeading      # hypothetical name
  write:
    set: L:var_fcuHeading
```

A variable here is an `L:` or `A:` variable, an input event's `B:` value, or an aircraft's own client data, such as the PMDG 777's battery switch `ELEC_Battery_Sw_ON` (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)).
`watch` can also name a value the aircraft's [plugin](../product/03-v1-scope.md#plugins) exports, as `plugin.state.<name>`, which the plugin finds where no variable shows it, such as in a gauge's JavaScript.
`set:` can name the same value, and calls the write method of that name that the plugin registers ([the writer API](#the-writer-api)).

When no variable shows the value, `watch` counts the events that change it instead, and Dual Input keeps the result as a shadow value: its own copy of a value the aircraft keeps out of sight.

```yaml
speed:
  name: FCU speed
  default: 80
  watch:
    on: K:SOME_AC_SPEED_INC, increment(1)      # hypothetical event names
    on: K:SOME_AC_SPEED_DEC, decrement(1)
  write:
    inc: K:SOME_AC_SPEED_INC
    dec: K:SOME_AC_SPEED_DEC
```

A rule can also count a variable's change, which covers counters whose value means nothing on its own.
The Fenix's `L:E_FCU_HEADING` adds 1 for every detent of the heading knob (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md)).
The Fenix's systems program, `FenixSystem.exe`, which runs outside the sim, acts on the change: a jump of 10 in the counter moved the FCU heading 10 degrees (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).
So writing the PF's counter value on a following machine would move that machine's heading by the gap between the two counters.
Where the heading itself can be read, the entry watches the heading and writes the counter, adding the whole difference in one write.
Where it can't, a rule counts the counter's changes into a shadow heading.

### Keeping a shadow value

A shadow value is the last resort, because nothing can check it: a shadow that misses one event stays wrong, and since every following machine takes the PF's value, a wrong shadow on the PF's machine spreads to everyone.

- `default` is the value the aircraft always starts with, such as the sketch's 80 for a speed the aircraft resets at every load.
- Every `default` goes on the PF's preflight checklist by its `name`, because the shadow is right only if the PF's aircraft starts there ([03-catch-up](03-catch-up.md#when-preflight-ends)).
- A shadow goes back to its `default` whenever the aircraft reloads.

### Writing a value

`write` takes one of these forms, and the engine chooses how to use it:

| Form | When | What the engine does |
| --- | --- | --- |
| `set: <variable, event, or plugin value>` | One variable, event, or plugin value takes the value | Writes the variable, sends the event once, or calls the plugin's write method |
| `toggle: <event>` | The only write flips the control | Compares the wanted value with the local one, and flips only if they differ |
| `inc` and `dec`, with `step`, `range`, and `wrap` | The control only steps | Turns the difference into steps, the shorter way round when `wrap` is true, and clamps at the ends of `range` when it's false |
| `then: <action>` after another form | One action isn't enough | Runs the second action after the first |
| A write function | Anything less regular | Runs the function and carries out the actions it returns |

An entry with no `write` is watch-only: Dual Input watches it on every machine and compares the values, and never writes it.
Dual Input never falls back to writing an entry's `watch` variable.
The rest of the pre-sync checklist, a Soon pick, uses watch-only entries to tick off a control once both cockpits agree on it ([04-room-for-later](../product/04-room-for-later.md#profiles)).

`toggle` is common enough to be built in.
About 20 entries in FS Copilot's Synaptic A220 profile compare before they flip (unverified, FS Copilot profiles, `definitions/synaptic_a220.yaml`).
The A350's `B:AIRLINER_ELEC_BAT_1_Set` flips the battery whatever value it's given (read in inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md); unverified in the sim).
On the Baron 58P, a bare `B:ELECTRICAL_Battery_1` write left the battery unchanged while `B:ELECTRICAL_Battery_1_Toggle` flipped it, with no other form tried (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air").

`then` covers a control whose system listens for a second name.
The L-1011's fuel pump click flips `L:SWITCH_FUEL_PUMP_1_1` and fires `H:FUEL`, and its flight engineer's script acts only on `H:FUEL` (read in inibuilds-aircraft-l1011 1.0.8, [L-1011 study](../aircraft/inibuilds-l1011/study.md); unverified in the sim):

```yaml
fuel_pump_1_1:
  name: Fuel pump 1-1
  watch: L:SWITCH_FUEL_PUMP_1_1
  write:
    set: L:SWITCH_FUEL_PUMP_1_1
    then: H:FUEL
```

One value crosses the wire, and the receiving machine turns it, through the entry's write, into however many calls the aircraft needs.

A write function receives the state object, any context it needs, and a writer, and returns the actions to take, such as skipping the transponder while the battery is off:

```typescript
// a sketch
(state, context, writer) => {
  if (state.battery1 === 0) return
  return writer.k('SET_XPDR_MODE', state.xpdr)    // hypothetical event name
}
```

The engine records which entries each run of a write function read, and runs it again when any of them changes, so this transponder function runs again when the battery comes on, and the author lists nothing.
A write function that reads a key the profile doesn't have is an error when the profile loads.

### Choosing who sends

An entry either belongs to the PF, so only the flying machine sends it and Dual Input puts back a following machine's change, or it's shared, so any pilot's change syncs.
The PF's entries are the categories [the take-control key](../product/03-v1-scope.md#take-control-key) names, and shared is the default.
The field's name and its values, such as `pilot_flying`, are chosen with the format.

### Ignoring a consequence

One click can fire several names, and syncing each would apply the action twice.
The Bonanza's autopilot master click fires `K:AP_MASTER`, and `K:TOGGLE_FLIGHT_DIRECTOR` too when the director is off, while a block running at 2 Hz that watches `A:AUTOPILOT MASTER` turns the director on once the autopilot engages (read in bksq-aircraft-bonanzapro 0.1.1, [Bonanza study](../aircraft/black-square-bonanza-pro/study.md)).
Forwarding both events would let the receiving machine's own block turn the director on between them, and the forwarded toggle would then turn it off again.
`ignore` names what the entry's action also fires, in a state entry or an event entry alike:

```yaml
events:
  ap_master:
    watch: K:AP_MASTER
    ignore: [K:TOGGLE_FLIGHT_DIRECTOR]
```

After the entry fires, Dual Input ignores the next occurrence of each name in the list on the machine where the entry fired, if it comes within 1s, so the click's own toggle doesn't travel.
A consequence that's a readable state entry needs no `ignore`, because a value written twice stays the same.

## Event entries

An event entry watches for something happening and runs an action on the other machines:

```yaml
events:
  somethingHappen:
    watch: K:SOME_AC_SOMETHING_HAPPEN       # hypothetical; run defaults to the same event
  someKeyPressed:
    watch: H:SOME_KEY_PRESSED
    run: b('SOME_KEY_PRESS_1')
  someTicker:
    watch: L:someTicker                    # a pulse: each rise from 0 is one occurrence
    run: k('SET_SOME_THING', 0)
```

- `watch` takes a `K:`, `H:`, `B:`, or `L:` name.
  A watched `L:` variable is a pulse: each rise from 0 counts as one occurrence.
  Some aircraft use a variable that way instead of an event: the A350's cockpit sets command variables such as `L:INI_MASTER_WARNING_COMMAND` to 1 (read in inibuilds-aircraft-a350 1.2.6, `A350_Interior.behavior.xml`), and its module acts on the 1 and clears it (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-the-a350s-stock-heading-is-an-output-of-its-module-and-its-dial-takes-a-value-written-straight-into-it)).
  Whether a reader outside the aircraft ever sees the 1 is unverified (the A350 study's sim question 2).
- `run` defaults to replaying what was watched, and otherwise uses the writer's names, `k`, `h`, `b`, and `l`.
- `ignore` works as it does for a state entry.

Controls whose meaning is their sequence belong here, not under `state:`.
The A380's refuel selector starts refueling only after AUTO, OFF, AUTO (documented: iniBuilds A380 manual 1.2, p. 28, as the [A380 study](../aircraft/inibuilds-a380/study.md) cites it; not measured), and catch-up, which writes each state entry once at its final value, would write only the final AUTO.

Dual Input catches a pulse by reading the variable once per frame, so a pulse the aircraft sets and clears within one frame is missed.
Two kinds of pulse could be caught every time (unverified): one written by panel JavaScript, which code Dual Input injects into that panel could see, and one set by an input event, whose subscription reports changes.
A powered A220's subscription reported every transition of 11 latching switches (measured on MSFS 2024, 2026-09-04, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The `B:` subscription is a change feed; the entry below was wrong"), but nobody has tested a pulse shorter than a frame.
So where a pulse moves something readable, such as a ticker that steps a heading, the entry watches the heading and writes through the pulse, and never depends on catching it.

## The writer API

A write function's writer returns actions as data, and the engine carries them out:

- `k(name, ...values)` for a `K:` event, with up to as many values as the event takes, such as `K:KOHLSMAN_SET`'s altimeter index: on the Baron 58P, `K:2:KOHLSMAN_SET` set only altimeter 2 (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air")
- `l(name, value, unit)` for an `L:` variable
- `b(name, value)` for an input event
- `h(name)` for an `H:` event
- paced sequences, such as `writer.repeat(delta).every(1, 'frame').k('SOME_EVENT')` or `.every(40, 'ms')`, with TypeScript types for the units
- `plugin()` for the write methods the aircraft's plugin registers, such as `writer.plugin().radar_range(value)` (hypothetical), and `plugin('<id>')` for an add-on's plugin

A plugin never calls the writer: it registers its write methods, and they run only when the engine calls them, so a write into a gauge's JavaScript or into DataStorage is an action the engine sees like any other.
A write method may be a setter for one of the plugin's values, under the value's name, or an action of its own with arguments, such as loading a panel state by name.
It has to be safe to repeat, because a retry repeats it ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)).

Because the engine sees each action, it can mark its own writes as echoes, pace them, put them in order with the rest of the session, cut a paced sequence short when a new value arrives for the same entry, and check every name against the sim when the profile loads.
Authors write no calculator code.
FS Copilot's profiles are built on it: 15,933 of their 26,533 entries, 60%, write through the calculator code the format generates, `<value> (>NAME, Units)`, beside 6,720 JavaScript, 2,017 prepended, and 1,863 literal setters (measured across those profiles, fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-08-25, "A setter is a script, and most entries do not have one"), but the engine can't pace, order, or recognize as its own a write hidden in calculator code, because it can't tell what the code writes.
The engine can still use calculator code inside its own WASM module, where no profile's code runs, such as for `H:` events, which SimConnect's client events might not reach (unverified; firing an `H:` event from a SimConnect client and watching for it settles it).

Write functions run in a sandbox with no file or network access, because profiles will come from the community, and the engine caps how large one entry and the whole state object can grow.
Step 7's decisions in [the plan](../product/plan.md) set the limits.

## What a profile says once per aircraft

Some facts belong to the aircraft, not to one control:

- **Pacing:** how fast this aircraft takes stepped writes.
  The engine sends one step per frame unless the profile sets a slower pace for the aircraft, and an entry can set its own on its `inc` and `dec`.
  An aircraft can read a command once per update of its own code, which can be every frame or slower.
  
  The A350 takes at most one command every 2 frames: two baro commands in one frame moved the baro 1 hPa, and ten sent once a frame moved it 5 hPa (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).
  So the A350's profile paces its commands at 2 frames or more.
  Its heading knob also accelerates: ten up commands, one every 2 frames, moved the dial 30 degrees, so a heading syncs as one write to `L:INI_HEADING_DIAL`, which holds a written value, rather than as steps (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-the-a350s-stock-heading-is-an-output-of-its-module-and-its-dial-takes-a-value-written-straight-into-it)).
  Whether slower commands step 1 degree each is untested.
  On the A220, `K:HEADING_BUG_INC` sent through SimConnect moved nothing, once a frame or ten in one frame, so its autopilot targets sync through the flight control panel's (FCP's) own controls, whose pace is untested (measured on MSFS 2024, 2026-10-05, [sync log](log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents)).
  FS Copilot's A220 profile, whose dropped setter sent the same event as calculator code, says a burst collapses into one change (unverified, FS Copilot profiles, `definitions/synaptic_a220.yaml`), so the route an event takes may decide whether the A220 acts on it (unverified).
- **Transport:** which call an event needs on this aircraft.
  For the yoke's masked axis events, the PMDG 777's module drops one sent with SimConnect's `_EX1` call and acts on the same event sent with the legacy call (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)), and its other events are untested.
- **Following machines' settings:** values Dual Input sets on every following machine while the session runs, so only one machine runs something each machine would otherwise run for itself.
  The Baron's tablet assesses failures every 10s, from failure times each machine draws for itself with `Math.random()` (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so a following machine's failure rate would go to 0, and the PF's failures would reach the others as events.
  That a rate of 0 stops them, and that `H:` events mirror every failure, are unverified (the Baron study's sim questions 3 and 7).

A profile gives no signal for when the aircraft has finished loading, because only an author who understands Dual Input's catch-up would fill it in ([03-catch-up](03-catch-up.md#settling-after-a-load)).

## What the IDE does with a profile

- It shows the state object live, entry by entry, and lists the watch-only entries, because a forgotten `write` makes an entry watch-only without a word.
- It warns about an entry with both a readable `watch` and a `default`, an `ignore` naming a readable state entry, and, under `state:`, a pulsing `L:` variable or a control with no readable value whose only event is a toggle, which belong under `events:`.
- It tests an entry's write across two instances, with a stand-in for the second pilot like fsc-exerciser, which as of 2026-10-04 exercises only pointer sync: click the control on one, apply the entry's write on the other, and compare everything that changed on each.
  A write that sets only `L:SWITCH_FUEL_PUMP_1_1` passes Dual Input's own read-back, and this comparison would catch that the pump's stock switch, `A:FUELSYSTEM PUMP SWITCH:1`, moved on one side only (unverified in the sim, the L-1011 study's sim question 1).

The IDE doesn't build entries by itself from what a click fires.
fsc-editor tried that with its Activity view.
A capture found 195 `L:` variables, mostly ambient, changing within 400ms of one knob turn (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "195 variables change within 400 ms of an interaction. Proximity alone cannot rank.").
The Activity view's ranking put the beacon's own variable first in one capture and outside the top five in another, beaten by click sounds that move on every interaction (measured on MSFS 2024, 2026-08-24, same log, "The ranking's problem is companions, not ambient rate").

## Known limits

- State in display or FMS code has no entry.
  The A220's display formats live in its DisplayUnits' Redux store (read in synaptic-aircraft-a220 1.0.10, [A220 study](../aircraft/synaptic-a220/study.md)), and pointer sync carries presses on those displays while both show the same page.
  An aircraft's [plugin](../product/03-v1-scope.md#plugins) is the path to that state, as an [aircraft adapter](../product/ideas.md#aircraft-adapters).
- Values each aircraft computes from the same inputs, such as a managed speed, aren't synced, on the assumption that both machines run the same configuration and compute the same value.
- A press whose action depends on how long it's held fits neither block, and the PA-24's JPI step button might be one (unverified, the [PA-24 study](../aircraft/a2a-pa24-comanche/study.md)'s sim question 9).
- A rate knob fits no write form, because what it changes depends on how long it's held off center, not on a count of steps: the PMDG 777's baro knob `L:CABaroKnob` recenters after 0.5s (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)), and reaching a value would need a loop that drives it and reads back until the machines agree.
