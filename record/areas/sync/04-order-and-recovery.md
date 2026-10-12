# Sync: order and recovery

```text
Purpose:     How the cockpit stream keeps its order through outages and restarts, how catch-up runs, and what comes back after something goes down.
Depends on:  01-profile-entries.md, 02-live-sync.md, 03-catch-up.md, ../network/01-between-machines.md, ../architecture/01-spine.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md
Decides:     What comes back after a link, a core, a sim, or a PC goes down; how a machine records what it applied, drops copies, and skips messages; catch-up's order and pipeline, and when control can't pass; how a replay is paced; which messages a change of control drops, and who catches up after one; how a core that restarted recovers; how an entry the aircraft drives itself is caught; how a machine puts back a change it may not send; and when an aircraft that loaded before its session counts as settled.
```

What comes back depends on what went down.
A pilot whose link was cut while everything else kept running gets every missed change replayed in order, and loses nothing, since their cockpit kept everything no profile entry reads, such as a display's page or an FMS.
A pilot whose sim, core, or PC went down comes back as a late joiner, with the profile's entries caught up from the flying machine (user, 2026-10-11 and 2026-10-12).
A few rules for the cockpit stream, its replay, and catch-up hold whatever went down.

This answers node 3 of the [architecture plan](../architecture/plan.md#3-sync-and-the-session) for sync, and [the session's roles and members](../session/01-roles-and-members.md) answers it for the session.
The flying machine is the PF's, and a following machine is any other pilot's.
The control value, the session channel, the heartbeat, and a link's states are [01-between-machines](../network/01-between-machines.md)'s.

## What comes back after what

| What went down | The sim | What comes back |
| --- | --- | --- |
| A link, cut for less than 30 minutes | Kept running | A replay of every change the pilot missed, in order ([the replay](#the-replay)) |
| The core | Kept running | A late join ([a core that restarts](#a-core-that-restarts)) |
| The sim, by a crash or by the pilot closing it | Closed | A late join ([a sim that closed](#a-sim-that-closed)) |
| The PC | Closed | A late join |

A link cut for 30 minutes ends the session for that pilot ([01-between-machines](../network/01-between-machines.md#coming-back)).

## A sim that closed

A sim that closed has lost every display's page, its FMS, and each avionics suite's own state, such as a GTN 750's flight plan, and no profile entry reads them, so Crosscheck restores none of it (user, 2026-10-11).
Replaying the presses that built them wouldn't either, because a press does what the pilot meant only on the page they saw.

So a pilot whose sim run has ended has left the flight, and comes back as a late joiner (user, 2026-10-11).
Their core learns the run ended in one of two ways: it watches the sim close, by a crash or by the pilot closing it, or it starts after a PC crash and finds that the run its session file names is gone ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
Either way:

- If they were the PF, their core passes control on, at once if it watched the sim close, as for a PF who goes to the main menu ([the connection](../product/03-v1-scope.md#the-connection)), and once the crew's first message has passed if it found the run gone, since only then does it know the current control value, so a PF back from a PC crash never returns holding control.
  In v1 control passes to the PM, and with more crew to a pilot whose cockpit is up to date where there is one ([roles and members](../session/01-roles-and-members.md#the-pf)).
- If they held the traffic and ATC host's role, their core releases it the same way ([roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
- The crew's notice says their sim closed, or crashed once the core can tell the two apart, which is open for sim awareness ([01-spine](../architecture/01-spine.md#left-open)).
- Once they're in a flight again, their core rejoins them under the same pilot ID, with no code to type, and their cockpit catches up state from the flying machine ([catch-up](#catch-up)).
- They're told that their displays' pages, their FMS, and anything else the profile can't read may differ from the PF's.

While a crashed PC is down, the others see a lost link ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).

## The cockpit stream

Every cockpit message carries its sender's vector clock, with a counter for each pilot ID and restart count that has sent cockpit messages, named by that pilot ID and restart count ([01-spine](../architecture/01-spine.md#ids)), and the sender's own counter is the message's number ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
A receiver's own vector clock is its one record of what it has applied, and serves as the copy check and the acknowledgment too:

- A message reaches a receiver in its sender's order, on that sender's stream or in a replay from whoever kept it ([01-between-machines](../network/01-between-machines.md#coming-back)), and waits until the receiver's clock covers every message it depends on ([02-live-sync](02-live-sync.md#one-stream-in-causal-order)).
  A message the receiver's clock already covers is a copy, and the receiver drops it.
- A message counts as applied, and moves the receiver's clock on, once Crosscheck has made its write, fired its event, or handed its press to the display's panel, and the heartbeat acknowledges by carrying the receiver's clock ([01-between-machines](../network/01-between-machines.md#channels)).
  FS Copilot's acknowledgment meant "received by the app", not "applied by the panel" (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, the constructor's comment), and its app, restarted, dropped a press it had no panel for yet, logging "No panel for DisplayUnits|config=N324DU; event dropped" (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone").
- A receiver skips a message in five cases, and a skipped message counts as applied, so nothing waits on it and its sender stops keeping it:
  - [a change of control](#a-change-of-control) drops it;
  - it's a press that arrives while the receiver's cockpit catches up ([03-catch-up](03-catch-up.md#while-catch-up-runs));
  - it's a press for a display whose panel hasn't announced itself to the core, as for a display the receiver's aircraft lacks, which FS Copilot's pointer sync drops too (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`);
  - its entry is one the aircraft drives itself ([below](#entries-the-aircraft-drives-itself));
  - it's a change to a PF-owned entry in a replay that a later change to the same entry follows, with only PF-owned changes between them ([the replay](#the-replay)).
- A machine with no aircraft in a flight, such as a joiner still in the sim's menu, or with an aircraft other than the flying machine's, which keeps its pilot out of the flight ([03-v1-scope](../product/03-v1-scope.md)), applies nothing from the cockpit stream, sends nothing on it, and holds what arrives until its catch-up ([catch-up](#catch-up)).

A message names its entry by name, and each counter by its pilot ID and restart count, which [2.2] measured at 84 bytes for a sample cockpit change against 27 for an entry's index and each pilot's place in the member list (measured on our development machine, 2026-10-10).
At node 2's assumed 5 to 20 changes a second, that's 285 bytes to 1.1 KB a second more (arithmetic), which buys one encoding that depends on nothing the receiver publishes and holds nothing to rebuild after a reconnect.
Only members who send cockpit messages have counters, so a passenger never appears in one ([04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew)).

[The conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) gains one tie-break: of two changes from one pilot under two restart counts, neither made after its sender saw the other, the higher restart count wins, since it's the later.
That happens only after a crash of the core or the PC ([a core that restarts](#a-core-that-restarts)).

## Catch-up

Catch-up writes each entry at the flying machine's value in the order the flying machine's cockpit first took each of those values, which its recording holds, since the recording keeps every change of the session ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
That settles [03-catch-up](03-catch-up.md#choosing-the-order)'s choice of order: where an interlock makes order matter, as with the hypothetical APU master that tries once to start the APU, it writes the battery first, and where order doesn't matter, it costs nothing, so no probe can change the choice.
Entries whose value the flying machine took before the session began, or never changed, go first.

- The catch-up carries the flying machine's vector clock as of the state it sends, and the catching-up machine takes it for every counter but its own, which keeps the larger of the two, since a machine's own counter never goes back and a number used twice would drop the second message as a copy ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
  So every message the state already holds, queued while the machine waited or arriving late on the stream, drops as a copy, and the rest apply on top in stream order ([03-catch-up](03-catch-up.md#while-catch-up-runs)).
- When control passes between two other pilots while catch-up runs, it starts again from the new flying machine and skips every entry that already matches.
- Control can't pass to a pilot while their own catch-up or [replay](#the-replay) runs over a link that's up, by the take-control key or button or by their answer to a voice offer, and the button says why; if the link is lost again first, the lost-link rules apply instead, and any pilot may take control ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
  During catch-up their own changes aren't sent ([03-catch-up](03-catch-up.md#while-catch-up-runs)), and during a replay their cockpit is behind by what's left of it, so a pilot who took over partway would fly a cockpit that differs from the others' or dates from before the cut.
  When the PF leaves the flight, the pass happens anyway, to an up-to-date pilot where there is one ([roles and members](../session/01-roles-and-members.md#the-pf)).

Catch-up is a pipeline of steps, and v1's has one, [catching up state](03-catch-up.md#catching-up-state).
Each step names the steps it runs after and how it checks that it landed, and a later pick adds steps, such as an A220 plugin's `A22X.Resync` ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)).
The 58P's plugin adds none, since its values are ordinary entries ([plugins](../product/03-v1-scope.md#plugins)).
The time, date, simulation rate, and pause aren't steps, because they're session keys, which every machine applies to its sim whenever its sim differs ([01-between-machines](../network/01-between-machines.md#channels)), and neither is traffic, because a receiver spawns the host's objects it lacks whenever its sim is in a flight ([roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).

## The replay

[03-catch-up](03-catch-up.md#replaying-a-short-outage)'s rule holds for a cut of up to 30 minutes: every missed change, in causal order, each after the gap the PF left before it, capped at 2s.

- The one exception is a run of changes to a PF-owned entry, such as an engine lever or the trim, with nothing between them but other PF-owned changes: the replay skips all but the last of the run, which applies in its place with no wait before it (user, 2026-10-11).
  A PF working the throttle changes it every time the lever moves, and a following machine only shows it, as it shows the yoke from the flight model's newest sample ([01-between-machines](../network/01-between-machines.md#channels)).
  Each lever still holds the value it had before every event or press that followed it, so a starter press replays against the mixture the PF had then.
- So a replay lasts at most 2s for each change it carries, and changes made close together, such as a knob turned through 20 degrees, replay at their own spacing.
  How long that is turns on how often the PF changed shared entries during the cut, which v1's recordings will show; an entry the aircraft drives itself, which would change at every tick, stops syncing within 30s ([its test](#entries-the-aircraft-drives-itself)).
- While the replay runs, the returning PM's synced displays stay locked, as they were while the link was lost ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)), the banner says they're catching up, and control can't pass to them while the link stays up ([catch-up](#catch-up)).

## A change of control

Each change of control carries its maker's vector clock.
A receiver drops a message that the superseded PF made under the value it lost only when that clock doesn't include it, whether it arrives live or in a replay, so what the new PF took control without having seen is dropped, and nothing the old PF did before passing control itself is.
This replaces [01-between-machines](../network/01-between-machines.md#control)'s rule that drops such a message when it reaches a receiver in a replay:

- A takeover during a cut drops the ex-PF's solo flying, as node 2 meant.
- A PF who leaves the flight during the PM's replay drops nothing, since the handover it makes includes every message it made.
- A switch the PF flipped in the moment another pilot pressed take-control, before it learned of the press, is dropped, and the ex-PF's catch-up below undoes it in its own cockpit.

Every machine that applied a message the change drops catches up state from the new PF once its replay ends, skipping what already matches: the ex-PF always, and with more crew, a pilot who got the message live.

- The ex-PF's aircraft follows the new PF's from the moment control settles, as the warning the new PF saw said it would ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
- The notice tells the ex-PF that what they changed alone is undone, and that pages and FMS entries they made alone may differ from the new PF's.

## A core that restarts

A core that crashes while its sim keeps running comes back as a [sim that closed](#a-sim-that-closed) does: the watcher restarts it, it counts its pilot as having left the flight, passes control on and releases the host's role if they held them, and rejoins its pilot as a late joiner, whose catch-up starts at once, since the sim is still in the flight.
Crosscheck aims for a core that never crashes, so a crash is a bug to report and fix rather than a state to recover from, and the crew's notice asks for a bug report (user, 2026-10-12).

Two things differ from a late join after a load, because the aircraft didn't reload:

- Each shadow value starts at the flying machine's, since the core lost its own, and the aircraft's controls stayed where they were, matching the flying machine's, rather than going back to `default` ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- The aircraft counts as settled at once, since the core missed Ready to fly, and nothing restores itself in an aircraft that didn't load.

A PF whose core crashes loses control, and their aircraft then follows the new PF's, so it jumps back by the seconds the core was down; presses either pilot made in that window are lost (user, 2026-10-12).
The recording's minimal mode still records the cockpit stream, because catch-up takes its order from the flying machine's recording ([catch-up](#catch-up); [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).

## Entries the aircraft drives itself

An entry for something the aircraft changes on its own, such as a timer or a blinking light, is a profile's mistake, since an entry carries a cause ([02-live-sync](02-live-sync.md#values-not-events)), and it would send a change at every tick and fill every replay.
The IDE shows every entry live while the profile is written, where an author can see one change on its own ([01-profile-entries](01-profile-entries.md#what-the-ide-does-with-a-profile)), and Crosscheck catches a shared entry the author missed by a sign no pilot makes: every machine's own aircraft keeps changing it.

- A machine counts a shared entry as driven by the aircraft when, in every 3s for 30s, its own aircraft changed the entry, other than by Crosscheck's write, and it also received another machine's change to it, a replayed change included.
- It then stops syncing that entry for the rest of the load, sending no change to it and applying none, and each aircraft drives its own copy, as it would anyway.
- It marks the recording and shows the once-a-flight notice that a write never landed shows ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)), so the profile reaches us in a bug report.

A pilot who turns a knob changes the entry on their own machine only, and the other machines' aircraft only take the writes, so the test never catches a pilot.
It leaves PF-owned entries out: only the flying machine sends them, and every following machine [puts them back](#putting-back), so a PM's hand resting on a throttle would otherwise trip it.
The 3s and the 30s are starting values, which v1's recordings tune.

## Putting back

When a machine's sim reports a change that Crosscheck didn't write and the machine may not send, the machine writes back at once the value it holds, and sends nothing.
A machine may not send:

- a PF-owned entry, unless it's the flying machine, such as when the PM's throttle hardware moves ([01-between-machines](../network/01-between-machines.md#channels));
- any entry while its own catch-up runs, which also undoes the aircraft restoring its saved state ([03-catch-up](03-catch-up.md#while-catch-up-runs));
- the time, date, or simulation rate, unless it's the flying machine ([time, date, sim rate, and pause](../product/03-v1-scope.md#time-date-sim-rate-and-pause)).

FS Copilot put nothing back, so a PM's throttle could spool up their own engine until the PF next moved theirs ([take-control key](../product/03-v1-scope.md#take-control-key)).
The pitch axis fired no event inside a dead zone set in MSFS (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)), so with a dead zone a machine puts a lever back only while the PM's hand moves it; the throttle, propeller, and mixture axes are unmeasured, and a jittering axis with no dead zone would be put back for as long as it jitters, as [the take-control key](../product/03-v1-scope.md#take-control-key)'s open question already says for a handover.
At a handover, the new flying machine may send the levers, so it stops putting them back, and each lever stays at the old PF's value until the new PF moves their hardware ([take-control key](../product/03-v1-scope.md#take-control-key)).

## An aircraft that loaded before its session

When a session starts, or its profile loads, after the pilot's Ready to fly, the 30s floor of [03-catch-up's settle rule](03-catch-up.md#settling-after-a-load) still counts from Ready to fly, and its 15s quiet window counts from when the profile loads, since nothing watched the entries before then.
If Ready to fly came 1.5 minutes ago or more, the aircraft counts as settled at once ([01-spine](../architecture/01-spine.md#what-moves-them)).

## Keys several members write

The session channel's stamp is all that active pause, the countdown, Go without, and seat claims need: of two changes made at once, every machine keeps the same one, and a new PF's win ([01-between-machines](../network/01-between-machines.md#channels)).
None needs the cockpit's causal order, since none acts on a page another change opened.

## Known limits

- After a core restart, each shadow value takes the flying machine's, so it's right only if its pilot didn't touch that control while the core was down ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- After a sim closes, a pilot's pages, FMS, and avionics state come back as their aircraft loaded, and the notice says so.
- A PF-owned entry the aircraft drives itself isn't caught at runtime, only by its author in the IDE.

## Left open

- The driven-entry test's 3s and 30s, and the replay's 2s cap, which v1's recordings tune.

[2.2]: ../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
