# 043: A shared entry every machine's aircraft keeps changing stops syncing, and a machine puts back what it may not send

A machine counts a shared state entry, or an event entry, as driven by the aircraft when, in every 3s for 30s, its own aircraft changed or fired it, other than by Crosscheck's write, and another machine's change or firing arrived, a replayed one included; it then stops sending and applying that entry for the rest of the load.
When a machine's sim reports a change Crosscheck didn't write that the machine may not send, it writes back the value it holds: a PF-owned entry on a following machine, any entry during its own catch-up, and the simulation rate on any machine but the flying one.
Decided by the user on 2026-10-11 and 2026-10-13, in node 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-shared-entry-every-machines-aircraft-keeps-changing-stops-syncing-and-a-machine-puts-back-what-it-may-not-send).

## Context

The PF is the pilot flying, the flying machine is the PF's, and a following machine is any other pilot's; the PM, the pilot monitoring, is the other front-seat pilot ([03-v1-scope](../areas/product/03-v1-scope.md)).
A PF-owned entry, an engine lever or the trim, is one only the flying machine sends ([decision 045](045-profile-format-yaml-and-javascript.md)).

Two problems meet here:

- **An entry the aircraft drives.** An entry for something the aircraft changes or fires on its own, such as a timer, a blinking light, or an `H:` event a gauge fires on a timer, is a profile's mistake, and it would send a change or a firing at every tick and fill every replay ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself)).
  Input events can report on their own: 21 of the A220's input events reported four times a second on an untouched aircraft (measured on MSFS 2024, 2026-09-04, fsc-editor, as the [A220 study](../areas/aircraft/synaptic-a220/study.md) cites).
- **A change a machine may not send.** A following machine's sim reports changes the machine may not send, such as the PM's throttle hardware moving a PF-owned lever ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#putting-back)).
  Catch-up already moved a catching-up pilot's changes back ([03-catch-up](../areas/sync/03-catch-up.md#while-catch-up-runs)), and v1's scope already put back another pilot's change to the simulation rate ([time, date, sim rate, and pause](../areas/product/03-v1-scope.md#time-date-sim-rate-and-pause)).

## Options

Catching an entry the aircraft drives:

1. **Leave it to the IDE, which shows every entry live while the profile is written and warns of a state entry whose value changes on its own ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#what-fails-a-load)).**
   An entry the author added by mistake would still send a change or a firing at every tick and fill every replay, whatever the IDE warned (user, 2026-10-11).
2. **A test at runtime of shared state entries alone.**
   An `H:` event a gauge fires on a timer would still fire at every tick and fill every replay ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself)).
3. **A test at runtime of shared state entries and event entries, on a sign no pilot makes: every machine's own aircraft keeps changing the entry.**
   A PF-owned entry the aircraft drives itself isn't caught at runtime, only by its author in the IDE ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#known-limits)).

A change a machine may not send:

4. **Put nothing back, as FS Copilot did.**
   FS Copilot wrote no PF-owned value back, so a PM's throttle could spool up their own engine until the PF next moved theirs ([take-control key](../areas/product/03-v1-scope.md#take-control-key)).
5. **Write back the value the machine holds, whenever its sim reports a change Crosscheck didn't write that the machine may not send.**

## Decision

Options 3 and 5.
A pilot changes an entry on one machine, and the others' aircraft only take the writes, so no pilot produces the sign.
The test leaves PF-owned entries out, since following machines put them back, and a PM's hand resting on a throttle would otherwise trip it.
The test reaches event entries as well as state entries (user, 2026-10-13).
One put-back rule replaces three: catch-up's, the simulation rate's, and the PF-owned entries'.

## What it commits us to

- An entry the test catches stops syncing for the rest of the load, and each aircraft drives its own copy, as it would anyway.
- The machine marks the recording and shows the once-a-flight notice of a write that never lands, so the profile reaches us in a bug report.
- The 3s and the 30s are starting values, and the decision leaves tuning them to v1's recordings.
- A machine writes back at once, and sends nothing, when its sim reports a change it may not send: a PF-owned entry, unless it's the flying machine; any entry while its own catch-up runs, which also undoes the aircraft restoring its saved state; and the simulation rate, unless it's the flying machine.
- The pitch axis fired no event inside a dead zone set in MSFS (measured on MSFS 2024, 2026-10-01, [flight-controls log](../areas/flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)), so with a dead zone a machine puts a lever back only while the PM's hand moves it; the throttle, propeller, and mixture axes are unmeasured, and a jittering axis with no dead zone would be put back for as long as it jitters ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#putting-back)).
