# Sync: profile entries

```text
Purpose:     What a profile says about an aircraft's cockpit, so Crosscheck can sync it.
Depends on:  ../product/03-v1-scope.md (state sync), 02-live-sync.md, 03-catch-up.md
Decides:     The profile's two blocks, the fields of an entry, the writer API, and what a profile says once per aircraft.
```

A profile describes an aircraft's cockpit in two blocks.
`state:` holds the controls whose value Crosscheck can read or count: it syncs them as values, checks that each write landed, and brings a cockpit that missed changes back to the flying machine's state.
`events:` holds what Crosscheck can only see happen: it forwards those live, best effort, and never catches them up.

An author writes what they can find in the aircraft's files: where a control's value can be read, and what changes it.
The engine decides how to sync it, so an author never has to know, for example, that an absolute setter beats a toggle.
Every field name is an action, such as `read`, `write`, or `ignore`, so each says what it does.

This document fixes the shape of the profile format.
Its syntax and file layout are step 7's decision in [the plan](../product/plan.md), so every example below is a sketch.

The split between reading and writing matches how profiles are already written: 9,673 of the setters in FS Copilot's community profiles write a different name than they read, against 701 that write the same one (fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-08-29, "The insurance rules, and the setter family measured down to three").

## State entries

| Field | What it says |
| --- | --- |
| `name` | The control's name for people, used in the Crosscheck IDE, the preflight checklist, and notices |
| `read` | Where the value comes from: a variable, or rules that count events into a shadow value |
| `default` | A shadow value's starting value, which no variable shows |
| `write` | How to change the control: omitted, `set`, `toggle`, `inc` and `dec`, `then`, or a function |
| direction | Whether only the PF's machine sends the entry, or any pilot's can |
| `ignore` | The names this entry's action also fires, which Crosscheck ignores once afterward |

### Reading a value

`read` names a variable when the control's value is one:

```yaml
fcu_heading:
  name: FCU heading
  read: L:var_fcuHeading      # hypothetical name; write omitted, so Crosscheck writes the variable
```

A variable here is an `L:` or `A:` variable, an input event's `B:` value, or an aircraft's own client data, such as the PMDG 777's battery switch `ELEC_Battery_Sw_ON` (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)).

When no variable shows the value, `read` counts the events that change it instead, and Crosscheck keeps the result as a shadow value:

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
The Fenix's `L:E_FCU_HEADING` adds 1 for every detent of the heading knob, and the Fenix acts on the change, so writing the PF's counter value on the PM would jump the PM's heading by the gap between the two counters (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../aircraft/fenix-a320-family/study.md)).
Where the heading itself can be read, the counter belongs under `write`, as the way to step it, and Crosscheck never reads it at all.

### Shadow values

A shadow value is Crosscheck's own copy of a value the aircraft keeps out of sight, kept up to date from the events it sees.
It's the last resort, because nothing can check it: a shadow that misses one event stays wrong, and since every follower takes the PF's value, a wrong shadow on the PF's machine spreads to everyone.

- `default` is the value the aircraft always starts with, such as 80 for a speed the aircraft resets at every load.
- Every `default` goes on the PF's preflight checklist by its `name`, such as "FCU speed 80", because the shadow is right only if the PF's aircraft starts there ([03-catch-up](03-catch-up.md#when-preflight-ends)).
- A shadow goes back to its `default` whenever the aircraft reloads.
- An entry with both a readable `read` and a `default` is a mistake the IDE flags.

### Writing a value

`write` takes one of these forms, and the engine chooses how to use it:

| Form | When | What the engine does |
| --- | --- | --- |
| Omitted | The `read` variable can be written | Writes the variable |
| `set: <event>` | One event takes the value | Sends it once |
| `toggle: <event>` | The only write flips the control | Compares the wanted value with the local one, and flips only if they differ |
| `inc` and `dec`, with `step`, `range`, and `wrap` | The control only steps | Turns the difference into steps, the shorter way round when `wrap` is true, and clamps at the ends of `range` when it's false |
| `then: <action>` after another form | One action isn't enough | Runs the second action after the first |
| A function | Anything less regular | Runs the function and carries out the plan it returns |

`toggle` is common enough to be built in.
About 20 entries in FS Copilot's Synaptic A220 profile compare before they flip (unverified, FS Copilot profiles, `definitions/synaptic_a220.yaml`), the A350's battery `Set` flips the switch whatever value it's given (read in inibuilds-aircraft-a350 1.2.6, [A350 study](../aircraft/inibuilds-a350/study.md)), and the Baron's battery takes only its `_Toggle` form (measured on MSFS 2024, 2026-08-29, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air").

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

One value crosses the wire, and the receiving machine's writer turns it into however many calls the aircraft needs.

A function receives the state, any context it needs, and a writer, and returns a plan, such as skipping the transponder while the battery is off:

```typescript
// a sketch
(state, context, writer) => {
  if (state.battery1 === 0) return
  return writer.k('SET_XPDR_MODE', state.xpdr)    // hypothetical event name
}
```

The engine records which entries each run of a function read, and runs it again when any of them changes, so this transponder writer runs again when the battery comes on, and the author lists nothing.
A function that reads a key the profile doesn't have is an error when the profile loads.

### Direction

An entry either belongs to the PF, so only the flying machine sends it and Crosscheck puts back a follower's change, or it's shared, so any pilot's change syncs.
The PF's entries are the flight controls, toe brakes, engine levers, and trim that [the take-control key](../product/03-v1-scope.md#take-control-key) names, and shared is the default.
The field's name and its values, such as `pilot_flying`, are chosen with the format.

### Ignoring a consequence

One click can fire several names, and syncing each would apply the action twice.
The Bonanza's autopilot master fires `K:AP_MASTER` and `K:TOGGLE_FLIGHT_DIRECTOR`, and a block running at 2 Hz that watches `A:AUTOPILOT MASTER` also turns the director on (read in bksq-aircraft-bonanzapro 0.1.1, [Bonanza study](../aircraft/black-square-bonanza-pro/study.md)).
`ignore` names what the entry's action also fires, in a state entry or an event entry alike:

```yaml
events:
  ap_master:
    watch: K:AP_MASTER
    ignore: [K:TOGGLE_FLIGHT_DIRECTOR]
```

After the entry fires, Crosscheck ignores one occurrence of each name in the list, from the same machine only, within 1s, which covers the Bonanza's 2 Hz block with room to spare.
A consequence that's a readable state entry needs no `ignore`, because a value written twice stays the same, and the IDE warns when `ignore` names one.

## Event entries

An event entry watches for something happening and runs an action on the other machines:

```yaml
events:
  somethingHappen:
    watch: K:SOME_AC_SOMETHING_HAPPEN       # hypothetical; run defaults to the same event
  someKeyPressed:
    watch: H:SOME_KEY_PRESSED
    run: B('SOME_KEY_PRESS_1')
  someTicker:
    watch: L:someTicker                    # a pulse: each rise from 0 is one occurrence
    run: K('SET_SOME_THING', 0)
```

- `watch` takes a `K:`, `H:`, `B:`, or `L:` name.
  A watched `L:` variable is a pulse: some aircraft set a variable to 1 for one tick, then back to 0, instead of firing an event, and each rise from 0 counts as one occurrence.
- `run` defaults to replaying what was watched, and otherwise uses the writer's names, `K`, `H`, `B`, and `L`.
- `ignore` works as it does for a state entry.

Controls whose meaning is their sequence belong here, not under `state:`.
The A380's refuel selector starts refueling only after AUTO, OFF, AUTO (read in inibuilds-aircraft-a380 1.0.0, [A380 study](../aircraft/inibuilds-a380/study.md)), and as state only the final AUTO would arrive.

Crosscheck catches a pulse by reading the variable once per frame, so a pulse the aircraft sets and clears within one frame is missed.
Only a pulse written by panel JavaScript, which our `VCockpit.js` override can see in that panel, or set by an input event, whose subscription reports every change (measured on MSFS 2024, 2026-09-04, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The `B:` subscription is a change feed; the entry below was wrong"), is caught every time.
So where a pulse moves something readable, such as a ticker that steps a heading, the entry reads the heading and writes through the pulse, and never depends on catching it.

## The writer API

A function's writer returns actions as data, and the engine carries them out:

- `k(name, ...values)` for a `K:` event, with up to as many values as the event takes, such as the altimeter index `K:KOHLSMAN_SET` takes
- `l(name, value, unit)` for an `L:` variable
- `b(name, value)` for an input event
- `h(name)` for an `H:` event
- plans, such as `writer.repeat(delta).every(1, 'frame').k('SOME_EVENT')` or `.every(40, 'ms')`, with TypeScript types for the units

Because the engine sees each action, it can mark its own writes as echoes, pace them, put them in order with the rest of the session, cancel a plan halfway when a new value arrives, and check every name against the sim when the profile loads.
Authors write no calculator code.
FS Copilot's profiles allowed it, and the engine can't pace, order, or recognize as its own a write it can't read (from our experience with FS Copilot).
The engine may still use calculator code inside its own WASM module, where only it reaches, such as for `H:` events, which SimConnect's client events may not reach (unverified).

Profile functions run in a sandbox with no file or network access, because profiles will come from the community, and the engine caps how large one entry and the whole state object can grow.
The build sets the limits.

## What a profile says once per aircraft

Some facts belong to the aircraft, not to one control, and they're the ones an author can't learn from the aircraft's files:

- **Pacing.** The engine sends stepped writes one per frame by default, and an entry can override it, such as `increment(1, pace: ...)`.
  An aircraft can read a command once per update, so two steps inside one update can count as one.
  FS Copilot's A220 profile says a burst of heading increments collapses into one change (unverified, FS Copilot profiles, `definitions/synaptic_a220.yaml`).
- **Transport.** Which call an event needs on this aircraft.
  The PMDG 777's module drops an event sent with SimConnect's `_EX1` call and acts on the same event sent with the legacy call (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)).
- **Followers' settings.** Values Crosscheck sets on every follower while the session runs, so only one machine runs something each machine would otherwise run for itself.
  The Baron rolls random failures every 10s on each machine (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so a follower's failure rate goes to 0, and the PF's failures reach the followers as events.

A profile gives no signal for when the aircraft has finished loading, because only an author who understands Crosscheck's catch-up would fill it in ([03-catch-up](03-catch-up.md#settling-after-a-load)).

## What the IDE does with a profile

- It shows the state object live, entry by entry.
- It flags an entry with both a readable `read` and a `default`, an `ignore` naming a readable state entry, and a pulsing `L:` variable or a toggle-only event under `state:`, which belong under `events:`.
- It tests a write across two instances, with fsc-exerciser playing the second pilot: click the control on one, apply the entry's write on the other, and compare everything that changed on each.
  A write that sets only `L:SWITCH_FUEL_PUMP_1_1` passes Crosscheck's own read-back, and this comparison catches that the fuel pressure moved on one side only.

The IDE doesn't build entries by itself from what a click fires: fsc-editor's Activity view, which does that, often listed far more names than the control involved, and rarely reliably (from our experience with fsc-editor).

## Known limits

- State in display or FMS code has no entry.
  The A220's display formats live in its DisplayUnits' Redux store (read in synaptic-aircraft-a220 1.0.10, [A220 study](../aircraft/synaptic-a220/study.md)), and pointer sync carries presses on those displays while both show the same page.
  [Aircraft adapters](../product/ideas.md#aircraft-adapters) are the Later path to that state.
- Values each aircraft computes from the same inputs, such as a managed speed, aren't synced, on the assumption that both machines run the same configuration and compute the same value.
- A press whose action depends on how long it's held, such as the PA-24's JPI step button (read in a2a-aircraft-pa24 2.1.3, [PA-24 study](../aircraft/a2a-pa24-comanche/study.md)), fits neither block.
- A rate knob, which slews while held off center, fits no write form, because a step is a duration: the PMDG 777's baro knob `L:CABaroKnob` recenters after 0.5s (read in pmdg-aircraft-77w 2.4.143, [777 study](../aircraft/pmdg-777-300er/study.md)), and reaching a value would need a loop that drives it and reads back until the machines agree.
