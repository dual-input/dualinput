# Aircraft study template

A study says how one aircraft is built, where its state lives, and what changes that state.
Its reader will design a Crosscheck feature later, and wants to know what this aircraft will make that feature do.
The sections below are the least a study covers.
Add a section for whatever this aircraft does that none of them fits, and remove a section only when saying it's empty would tell the reader nothing.

## Header

`# <Aircraft>`, then this block:

```text
Packages:  <package> <version>, and each other package it needs
Studied:   <YYYY-MM-DD>, from its files
Readable:  what we could open, and what we couldn't and why
```

Then one paragraph that leads with how this aircraft departs from the sim's stock way of building one, with `A:` variables, `K:` events, and Asobo's instruments, and what that means for Crosscheck.

## Sections

**Identity.**
Packages, variants, and liveries, and what a livery changes.
Options that change behavior, where the aircraft keeps them, and their defaults.
What the sim reports to identify it: folder, title, and `panel.cfg` keys.

**Code architecture.**
What runs where: WASM modules, JavaScript instruments, XML behaviors, programs outside the sim, and the EFB.
Per module, its size, what it imports from the sim, and what it's for.
A text diagram of how the parts talk to each other and to the sim, with real names.

**State.**
Which namespaces hold cockpit state (`A:`, `L:`, input events, `O:`, CommBus, client data, files), with counts and naming conventions.
Which stock variables the aircraft ignores or overwrites, since those still read plausible values.

**Input path.**
How a click becomes a state change, followed through the files for one control of each kind: latching, momentary, toggle, relative, guarded, multi-position, spring-loaded, and any kind this aircraft adds.
For each, what Crosscheck would write on the other machine to reproduce it.

**Displays.**
One row per display: drawn in JavaScript or WASM, what input it takes (touch, cursor, keypad, knobs), where its page state lives, and whether it pops out.

**Flight controls and autoflight.**
How the yoke, throttles, and trim reach the aircraft's systems, and what the autopilot and autothrottle read and write.

**Hidden state.**
FMS entries, flight plans, navigation data, timers, failures, the EFB, and ground services: where each lives, and whether anything outside the aircraft can read or set it.

**Outputs.**
Lamps, sounds, callouts, and other values the aircraft computes, and which of them it recomputes when something else writes them.

**Persistence and initial state.**
Panel states, saved files, what the aircraft keeps between flights, and what reloading a panel resets.

**Vendor interfaces.**
SDKs, documented variables and events, and external tools the vendor supports.

**Prior records.**
Each claim our records or FS Copilot's profile make about this aircraft, and whether its files confirm it, contradict it, or can't settle it.

**Sim questions.**
Numbered.
Each says what to find out, what to do in the sim to find it (which control to move, which values to watch), the state the aircraft must be in, and what each answer would change in the study.

**Sources.**
Numbered, as the claims cite them.

**License.**
Only when the aircraft's license restricts reverse engineering, decompiling, or publishing: the clause, and a link.
