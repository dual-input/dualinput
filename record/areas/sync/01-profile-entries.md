# Sync: profile entries

```text
Purpose:     What a profile says about an aircraft's cockpit, so Crosscheck can sync it.
Depends on:  ../product/03-v1-scope.md (state sync), 02-live-sync.md, 03-catch-up.md
Decides:     The profile's two blocks, the fields of an entry, the writer API, and what a profile says once per aircraft.
```

A profile describes an aircraft's cockpit in two blocks.
`state:` holds the controls whose value Crosscheck can read, or can track by counting the events that change it: it syncs them as values, checks that each write landed, and brings a cockpit that missed changes back to the flying machine's state.
`events:` holds what Crosscheck can only see happen: it forwards those live, best effort, and never catches them up.
The flying machine is the PF's, and a following machine is any other pilot's.

An author writes what they can find in the aircraft's files: where a control's value can be read, and what changes it.
The engine decides how to sync it, so an author never has to know, for example, that an absolute setter beats a toggle.
Field names that do something are verbs, such as `read`, `write`, `watch`, and `ignore`.

This document fixes the shape of the profile format.
Its syntax and file layout are step 7's decision in [the plan](../product/plan.md), so every example below is a sketch.

The split between reading and writing matches how profiles are already written: 9,673 of the setters in FS Copilot's community profiles write a different name than they read, against 701 that write the same one (measured across those profiles, fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-08-29, "The insurance rules, and the setter family measured down to three").

## State entries

| Field | What it says |
| --- | --- |
| `name` | The control's name for people, used in the Crosscheck IDE, the preflight checklist, and notices |
| `read` | Where the value comes from: a variable, or rules that count events into a shadow value |
| `default` | A shadow value's starting value |
| `write` | How to change the control: omitted, `set`, `toggle`, `inc` and `dec`, `then`, or a write function |
| direction | Whether only the flying machine sends the entry, or any pilot's machine can |
| `ignore` | The names this entry's action also fires, which Crosscheck ignores once afterward |

On each machine, the state object is all of an aircraft's state entries with their current values.

### Reading a value

`read` names a variable when the control's value is one:

```yaml
fcu_heading:
  name: FCU heading
  read: L:var_fcuHeading      # hypothetical name; write omitted, so Crosscheck writes the variable
```

A variable here is an `L:` or `A:` variable, an input event's `B:` value, or an aircraft's own client data, such as the PMDG 777's battery switch `ELEC_Battery_Sw_ON` (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)).

When no variable shows the value, `read` counts the events that change it instead, and Crosscheck keeps the result as a shadow value: its own copy of a value the aircraft keeps out of sight.

```yaml
speed:
  name: FCU speed
  default: 80
  read:
    on: K:SOME_AC_SPEED_INC, increment(1)      # hypothetical event names
    on: K:SOME_AC_SPEED_DEC, decrement(1)
  write:
    inc: K:SOME_AC_SPEED_INC
    dec: K:SOME_AC_SPEED_DEC
```

A rule can also count a variable's change, which covers counters whose value means nothing on its own.
The Fenix's `L:E_FCU_HEADING` adds 1 for every detent of the heading knob (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md)).
If the Fenix's systems program acts on the change, writing the PF's counter value on the PM would jump the PM's heading by the gap between the two counters, and how the program reads a jump is unverified (the Fenix study's sim question 2, in [the plan](../product/plan.md)'s step 6).
Where the heading itself can be read, the counter belongs under `write`, as the way to step it.
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
| Omitted | The `read` variable can be written | Writes the variable |
| `set: <event>` | One event takes the value | Sends it once |
| `toggle: <event>` | The only write flips the control | Compares the wanted value with the local one, and flips only if they differ |
| `inc` and `dec`, with `step`, `range`, and `wrap` | The control only steps | Turns the difference into steps, the shorter way round when `wrap` is true, and clamps at the ends of `range` when it's false |
| `then: <action>` after another form | One action isn't enough | Runs the second action after the first |
| A write function | Anything less regular | Runs the function and carries out the actions it returns |

`toggle` is common enough to be built in.
About 20 entries in FS Copilot's Synaptic A220 profile compare before they flip (unverified, FS Copilot profiles, `definitions/synaptic_a220.yaml`).
The A350's `B:AIRLINER_ELEC_BAT_1_Set` flips the battery whatever value it's given (read in inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md); unverified in the sim).
On the Baron 58P, a bare `B:ELECTRICAL_Battery_1` write left the battery unchanged while `B:ELECTRICAL_Battery_1_Toggle` flipped it, with no other form tried (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air").

`then` covers a control whose system listens for a second name.
The L-1011's fuel pump click flips `L:SWITCH_FUEL_PUMP_1_1` and fires `H:FUEL`, and its flight engineer's script acts only on `H:FUEL` (read in inibuilds-aircraft-l1011 1.0.8, [L-1011 study](../aircraft/inibuilds-l1011/study.md); unverified in the sim):

```yaml
fuel_pump_1_1:
  name: Fuel pump 1-1
  read: L:SWITCH_FUEL_PUMP_1_1
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

An entry either belongs to the PF, so only the flying machine sends it and Crosscheck puts back a following machine's change, or it's shared, so any pilot's change syncs.
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

After the entry fires, Crosscheck ignores the next occurrence of each name in the list on the machine where the entry fired, if it comes within 1s, so the click's own toggle doesn't travel.
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
  Some aircraft use a variable that way instead of an event: the A350's cockpit sets command variables such as `L:INI_MASTER_WARNING_COMMAND` to 1, and its module acts on the 1 and clears it, and whether a reader outside the aircraft ever sees the 1 is unverified.
- `run` defaults to replaying what was watched, and otherwise uses the writer's names, `k`, `h`, `b`, and `l`.
- `ignore` works as it does for a state entry.

Controls whose meaning is their sequence belong here, not under `state:`.
The A380's refuel selector starts refueling only after AUTO, OFF, AUTO (documented: iniBuilds A380 manual 1.2, p. 28, as the [A380 study](../aircraft/inibuilds-a380/study.md) cites it; not measured), and catch-up, which writes each state entry once at its final value, would write only the final AUTO.

Crosscheck catches a pulse by reading the variable once per frame, so a pulse the aircraft sets and clears within one frame is missed.
Two kinds of pulse might be caught every time, and both are unverified: one written by panel JavaScript, which code Crosscheck injects into that panel could see, and one set by an input event, whose subscription reports changes.
A powered A220's subscription reported the transitions of 11 latching switches, though 21 of its 464 input events also report at 4 Hz with no change (measured on MSFS 2024, 2026-09-04, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The `B:` subscription is a change feed; the entry below was wrong").
So where a pulse moves something readable, such as a ticker that steps a heading, the entry reads the heading and writes through the pulse, and never depends on catching it.

## The writer API

A write function's writer returns actions as data, and the engine carries them out:

- `k(name, ...values)` for a `K:` event, with up to as many values as the event takes, such as `K:KOHLSMAN_SET`'s altimeter index: on the Baron 58P, `K:2:KOHLSMAN_SET` set only altimeter 2 (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air")
- `l(name, value, unit)` for an `L:` variable
- `b(name, value)` for an input event
- `h(name)` for an `H:` event
- paced sequences, such as `writer.repeat(delta).every(1, 'frame').k('SOME_EVENT')` or `.every(40, 'ms')`, with TypeScript types for the units

Because the engine sees each action, it can mark its own writes as echoes, pace them, put them in order with the rest of the session, cut a paced sequence short when a new value arrives for the same entry, and check every name against the sim when the profile loads.
Authors write no calculator code.
FS Copilot's profiles are built on it, with 1,863 literal and 6,720 JavaScript setters among their 26,533 entries (measured across those profiles, fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-08-25, "A setter is a script, and most entries do not have one"), but the engine can't pace, order, or recognize as its own a write hidden in calculator code, because it can't tell what the code writes.
The engine can still use calculator code inside its own WASM module, where only it reaches, such as for `H:` events, which SimConnect's client events might not reach (unverified; firing an `H:` event from a SimConnect client and watching for it settles it).

Write functions run in a sandbox with no file or network access, because profiles will come from the community, and the engine caps how large one entry and the whole state object can grow.
Step 7's decisions in [the plan](../product/plan.md) set the limits.

## What a profile says once per aircraft

Some facts belong to the aircraft, not to one control:

- **Pacing:** how fast this aircraft takes stepped writes.
  The engine sends one step per frame unless the profile sets a slower pace for the aircraft, and an entry can set its own on its `inc` and `dec`.
  Several aircraft read a command once per update.
  
  Whether the A350 counts two steps before one update as one is unverified in the sim.
  FS Copilot's A220 profile says a burst of heading increments collapses into one change (unverified, FS Copilot profiles, `definitions/synaptic_a220.yaml`).
- **Transport:** which call an event needs on this aircraft.
  For the yoke's masked axis events, the PMDG 777's module drops one sent with SimConnect's `_EX1` call and acts on the same event sent with the legacy call (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)), and its other events are untested.
- **Following machines' settings:** values Crosscheck sets on every following machine while the session runs, so only one machine runs something each machine would otherwise run for itself.
  The Baron's tablet assesses failures every 10s, from failure times each machine draws for itself with `Math.random()` (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so a following machine's failure rate would go to 0, and the PF's failures would reach the others as events.
  That a rate of 0 stops them, and that `H:` events mirror every failure, are unverified (the Baron study's sim questions 3 and 7).

A profile gives no signal for when the aircraft has finished loading, because only an author who understands Crosscheck's catch-up would fill it in ([03-catch-up](03-catch-up.md#settling-after-a-load)).

## What the IDE does with a profile

- It shows the state object live, entry by entry.
- It warns about an entry with both a readable `read` and a `default`, an `ignore` naming a readable state entry, and a pulsing `L:` variable or a toggle-only event under `state:`, which belong under `events:`.
- It tests an entry's write across two instances, with a stand-in for the second pilot like fsc-exerciser, which today exercises only pointer sync: click the control on one, apply the entry's write on the other, and compare everything that changed on each.
  A write that sets only `L:SWITCH_FUEL_PUMP_1_1` passes Crosscheck's own read-back, and this comparison would catch that the pump's stock switch, `A:FUELSYSTEM PUMP SWITCH:1`, moved on one side only (unverified in the sim, the L-1011 study's sim question 1).

The IDE doesn't build entries by itself from what a click fires.
fsc-editor tried that with its Activity view, and found 195 variables changing within 400ms of one interaction, so nearness in time couldn't tell the control's own names from their companions (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "195 variables change within 400 ms of an interaction. Proximity alone cannot rank."; and 2026-08-24, "The ranking's problem is companions, not ambient rate").

## Known limits

- State in display or FMS code has no entry.
  The A220's display formats live in its DisplayUnits' Redux store (read in synaptic-aircraft-a220 1.0.10, [A220 study](../aircraft/synaptic-a220/study.md)), and pointer sync carries presses on those displays while both show the same page.
  [Aircraft adapters](../product/ideas.md#aircraft-adapters) are the Later path to that state.
- Values each aircraft computes from the same inputs, such as a managed speed, aren't synced, on the assumption that both machines run the same configuration and compute the same value.
- A press whose action depends on how long it's held fits neither block, and the PA-24's JPI step button might be one (unverified, the [PA-24 study](../aircraft/a2a-pa24-comanche/study.md)'s sim question 9).
- A rate knob fits no write form, because what it changes depends on how long it's held off center, not on a count of steps: the PMDG 777's baro knob `L:CABaroKnob` recenters after 0.5s (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)), and reaching a value would need a loop that drives it and reads back until the machines agree.
