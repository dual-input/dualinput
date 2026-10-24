# Sync: order and recovery

```text
Purpose:     How the cockpit stream keeps its order through outages and restarts, how catch-up runs, and what comes back after something goes down.
Depends on:  01-profile-entries.md, 02-live-sync.md, 03-catch-up.md, ../network/01-between-machines.md, ../architecture/01-spine.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md
Decides:     What comes back after a link, a core, a sim, or a PC goes down; how a machine records what it applied, drops copies, and skips messages; catch-up's order and pipeline, when it ends, and when control can't pass; how every cockpit message is paced, and how often a state entry is sent; which messages a change of control drops, and who catches up after one; how a core that restarted recovers; how an entry the aircraft drives itself is caught; how a machine puts back a change it may not send; and when an aircraft that loaded before its session counts as settled.
```

> **Note**
> Since 2026-10-21, the core records every input, so [keys several members write](#keys-several-members-write)' reason for seat claims riding avatars' poses rather than the session channel, avatars being partly recorded, goes, and whether they move is open, as [avatars](../avatars/01-avatars.md)' note of 2026-10-21 says (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).
>
> Since 2026-10-23, a recording holds no marks, so a driven entry, in [entries the aircraft drives itself](#entries-the-aircraft-drives-itself), goes in the run's log at info rather than marking the recording (user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).
>
> Since 2026-10-23, an aircraft whose session or profile starts after it loaded counts as settled 30s after its Ready to fly, in [an aircraft that loaded before its session](#an-aircraft-that-loaded-before-its-session), with no quiet window from the profile's load ([decision 048](../../decisions/048-settled-30s-after-ready-to-fly.md)).

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

A sim that closed has lost every display's page, its FMS, and each avionics suite's own state, such as a GTN 750's flight plan, and no profile entry reads them, so Dual Input restores none of it (user, 2026-10-11).
Replaying the presses that built them wouldn't either, because a press does what the pilot meant only on the page they saw.

So a pilot whose sim run has ended has left the flight, and comes back as a late joiner (user, 2026-10-11).
Their core learns the run ended in one of two ways: it watches the sim close, by a crash or by the pilot closing it, or it starts after a PC crash and finds that the run its session file names is gone ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
Either way:

- If they were the PF, their core passes control on, at once if it watched the sim close, as for a PF who goes to the main menu ([the connection](../product/03-v1-scope.md#the-connection)), and once the crew's first message has passed if it found the run gone, since only then does it know the current control value, so a PF back from a PC crash never returns holding control.
  Control passes only to a pilot still in the flight, in v1 the PM, and with more crew one whose cockpit is up to date where there is one; if no pilot is in the flight once preflight has ended, the session ends ([roles and members](../session/01-roles-and-members.md#the-pf)).
- The crew's notification says their sim closed, or crashed once the core can tell the two apart, which is open for sim awareness ([01-spine](../architecture/01-spine.md#left-open)).
- Once they're in a flight again, their core rejoins them under the same pilot ID, with no code to type, and their cockpit catches up state from the flying machine ([catch-up](#catch-up)).
- They're told that their displays' pages, their FMS, and anything else the profile can't read may differ from the PF's.

While a crashed PC is down, the others see a lost link ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).

## The cockpit stream

Every cockpit message carries its sender's vector clock, with a counter for each pilot ID and restart count that has sent cockpit messages, named by that pilot ID and restart count ([01-spine](../architecture/01-spine.md#ids)), and the sender's own counter is the message's number ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
A receiver's own vector clock is its one record of what it has applied, and serves as the copy check and the acknowledgment too:

- A message reaches a receiver in its sender's order, on that sender's stream or in a replay from whoever kept it ([01-between-machines](../network/01-between-machines.md#coming-back)), and waits until the receiver's clock covers every message it depends on ([02-live-sync](02-live-sync.md#one-stream-in-causal-order)).
  A message the receiver's clock already covers is a copy, and the receiver drops it.
- Pointer sync sends each gesture, a press or drag on a display, as it happens: its down, its moves, and its up ([pointer sync](../pointer-sync/01-pointer-sync.md#a-gesture)).
  A message counts as applied, and moves the receiver's clock on, once Dual Input has made its write, fired its event, or handed a gesture's message to the display's panels, and a gesture's up once they're done with it ([playing a gesture](../pointer-sync/01-pointer-sync.md#playing-a-gesture)).
  The receiver acknowledges by sending its clock once a second on a one-off channel of the cockpit-stream crate's own, so the heartbeat knows nothing of the cockpit stream ([02-units](../network/02-units.md#the-heartbeat-and-clock-offsets)).
  A panel plays a gesture's click at its up, so an up counted at the hand-over could let the next event land before the click.
  FS Copilot's acknowledgment meant "received by the app", not "applied by the panel" (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, the constructor's comment), and its app, restarted, dropped a press it had no panel for yet, logging "No panel for DisplayUnits|config=N324DU; event dropped" (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone").
- A receiver skips a message in five cases, and a skipped message counts as applied, so nothing waits on it and its sender stops keeping it:
  - [a change of control](#a-change-of-control) drops it;
  - it's a press that arrives while the receiver's cockpit catches up ([03-catch-up](03-catch-up.md#while-catch-up-runs)), other than in the catch-up that preflight's end starts, where a press queues behind that catch-up's writes and applies once they're made, since neither cockpit's displays were touched in preflight ([playing a gesture](../pointer-sync/01-pointer-sync.md#playing-a-gesture));
  - it's a press for a display whose panel hasn't announced itself to the core, as for a display the receiver's aircraft lacks, which FS Copilot's pointer sync drops too (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`);
  - its entry is one the aircraft drives itself ([below](#entries-the-aircraft-drives-itself));
  - it's a change to a PF-owned entry in a replay that a later change to the same entry follows, with only PF-owned changes between them ([the replay](#the-replay)).
- A machine with no aircraft in a flight, such as a joiner still in the sim's menu, or with an aircraft other than the flying machine's, which keeps its pilot out of the flight ([03-v1-scope](../product/03-v1-scope.md)), applies nothing from the cockpit stream and sends nothing on it.
  A machine holds what arrives while it's out of the flight and while its [catch-up](#catch-up) waits for its answer, and in the flight with no profile loaded applies it, state sync skipping its own kinds ([applying](05-units.md#applying)).
- A machine sends each state entry's newest value at most 20 times a second, a starting value v1's recordings tune; any value it's holding goes out before its next event or press, and events and presses go out as they happen (user, 2026-10-12).
  A hardware axis that jitters with no dead zone changes its lever every frame, so without the cap the 58P's six engine levers could send up to 360 messages a second at 60 fps, against node 2's assumed 5 to 20 (arithmetic); FS Copilot sampled every entry that wasn't shared every 30ms (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, `AddLink`).
  A change undone within 50ms never goes out, which no pilot's hand does; a button that pulses an `L:` variable is an event entry, which the cap never holds ([01-format-and-delivery](../profiles/01-format-and-delivery.md#event-entries)).

A message names its entry by name, and each counter by its pilot ID and restart count, which [2.2] measured at 84 bytes for a sample cockpit change against 27 for an entry's index and each pilot's place in the member list (measured on our development machine, 2026-10-10).
At node 2's assumed 5 to 20 changes a second, that's 285 bytes to 1.1 KB a second more (arithmetic), which buys one encoding that depends on nothing the receiver publishes and holds nothing to rebuild after a reconnect.
Only members who send cockpit messages have counters, so a passenger never appears in one ([04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew)).

[The conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) gains one tie-break: of two changes from one pilot under two restart counts, neither made after its sender saw the other, the higher restart count wins, since it's the later.
That happens only after a crash of the core or the PC ([a core that restarts](#a-core-that-restarts)).

## Catch-up

Catch-up writes each entry at the flying machine's value in the order the flying machine's cockpit first took each of those values.
Each machine's sync engine keeps that order, from when its cockpit first took each of an entry's last 16 distinct values ([catch-up's order](05-units.md#catch-ups-order)).
That settles [03-catch-up](03-catch-up.md#choosing-the-order)'s choice of order: where an interlock makes order matter, as with the hypothetical APU master that tries once to start the APU, it writes the battery first, and where order doesn't matter, it costs nothing, so no probe can change the choice.
Entries whose value the flying machine took before the session began, or never changed, go first.

- The catching-up machine asks the flying machine for its catch-up ([catch-up](05-units.md#catch-up)).
- The catch-up carries the flying machine's vector clock as of the state it sends, and the catching-up machine takes it for every counter but its own, which keeps the larger of the two, since a machine's own counter never goes back and a number used twice would drop the second message as a copy ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
  So every message the state already holds, queued while the machine waited or arriving late on the stream, drops as a copy, and the rest apply on top in stream order, paced as [the replay](#the-replay) says ([03-catch-up](03-catch-up.md#while-catch-up-runs)).
- A catch-up ends once it has made its last write and its aircraft has settled, whichever comes later, where made means the engine has carried out every entry's write, a stepping write's last step included; whether each write landed is the bench's ([01-format-and-delivery](../profiles/01-format-and-delivery.md#checking-a-write)).
  An aircraft that settled long ago, at the end of preflight, for an ex-PF, or after a core restart, would otherwise end its catch-up the moment it began, while its writes were still landing.
- A synced display on a machine other than the PF's locks while that machine's catch-up runs, as it does through a [replay](#the-replay) ([pointer sync](../pointer-sync/01-pointer-sync.md#on-a-machine-other-than-the-pfs)).
- When the core starts watching an input event, it reads its value once with `SimConnect_GetInputEvent`, since subscribing reports nothing until the value changes (fsc-editor, `docs/sim-vars/build/v1-log.md`), and our Rust client read one in a flight (measured on MSFS 2024, 2026-10-09, [architecture log](../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start)).
  Until that read returns, the entry's value is unknown, and catch-up holds its write until the first reading arrives, as it does for every entry with no reading yet, an `instrument()` entry included, so a toggle never flips blind (user, 2026-10-18).
  A counted or event entry, which never gets a reading, is exempt, and a read the sim refuses drops the held write ([writing](05-units.md#writing)).
- When control passes between two other pilots while catch-up runs, it starts again from the new flying machine and skips every entry that already matches.
- Control can't pass to a pilot while their own catch-up or [replay](#the-replay) runs over a link that's up, by the take-control key or button, and the button says why; if the link is lost again first, the lost-link rules apply instead, and any pilot may take control ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
  During catch-up their own changes aren't sent ([03-catch-up](03-catch-up.md#while-catch-up-runs)), and during a replay their cockpit is behind by what's left of it, so a pilot who took over partway would fly a cockpit that differs from the others' or dates from before the cut.
  When the PF leaves the flight, the pass happens anyway, to a pilot still in the flight, an up-to-date one where there is one, and a pilot whose catch-up is running when control reaches them stops catching up, since they're now the source ([roles and members](../session/01-roles-and-members.md#the-pf)).

Catch-up is a pipeline of steps, and v1's has one, [catching up state](03-catch-up.md#catching-up-state).
Each step names the steps it runs after and how it checks that it landed, and a later pick adds steps, such as an A220 plugin's `A22X.Resync` ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)).
The 58P's plugin adds none, since its values are ordinary entries ([plugins](../product/03-v1-scope.md#plugins)).
The simulation rate and the pause aren't steps, because they're session keys, which every machine applies to its sim whenever its sim differs ([01-between-machines](../network/01-between-machines.md#channels)); the time and date aren't synced in v1, and the match check compares them ([03-v1-scope](../product/03-v1-scope.md)); and traffic isn't a step either, because a receiver spawns the host's objects it lacks whenever its sim is in a flight ([roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).

## The replay

[03-catch-up](03-catch-up.md#replaying-a-short-outage)'s rule holds for a cut of up to 30 minutes: every missed change, in causal order, each after the gap the PF left before it, capped at 2s.

That rule paces every cockpit message, live or replayed: each waits the gap its sender left before it, capped at 2s, counted from when the one before it applied, so it waits only what's left of that gap (user, 2026-10-12).
A live message, already spaced by the network, waits nothing; messages queued behind a replay or a catch-up keep their spacing; and the catch-up's queue ends when nothing is waiting.
FS Copilot's panels paced presses the same way: "Each waits its *remaining* gap, not the full one, so live gestures add no latency" (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, 0.4).
The core alone paces, and our panel bridge plays each press when the core hands it over, so FS Copilot's panel carries over without its own pacing, which would wait each gap a second time ([03-v1-scope](../product/03-v1-scope.md)).

- The one exception is a run of changes to a PF-owned entry, such as an engine lever or the trim, with nothing between them but other PF-owned changes: the replay skips all but the last of the run, which applies in its place with no wait before it (user, 2026-10-11).
  A PF working the throttle changes it every time the lever moves, and a following machine only shows it, as it shows the yoke from the flight model's newest sample ([01-between-machines](../network/01-between-machines.md#channels)).
  Each lever still holds the value it had before every event or press that followed it, so a starter press replays against the mixture the PF had then.
- So a replay lasts at most 2s for each change it carries, and changes made close together, such as a knob turned through 20 degrees, replay at their own spacing.
  How long that is turns on how often the PF changed shared entries during the cut, which v1's recordings will show; an entry the aircraft drives itself, which would change at every tick, stops syncing within 30s ([its test](#entries-the-aircraft-drives-itself)).
- A replay opens with its sender's clock, and runs on the receiving machine until that machine's clock covers the sender's, which is when the replay ends and control can pass to its pilot again ([kept messages and a replay](05-units.md#kept-messages-and-a-replay)).
- While the replay runs, the returning PM's synced displays stay locked, as they were while the link was lost ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)), the banner says they're catching up, and control can't pass to them while the link stays up ([catch-up](#catch-up)).

## A change of control

Each change of control carries its maker's vector clock.
A receiver drops a message that the superseded PF made under the value it lost only when that clock doesn't include it, whether it arrives live or in a replay, so what the new PF took control without having seen is dropped, and nothing the old PF did before passing control itself is.
This replaces [01-between-machines](../network/01-between-machines.md#control)'s rule that drops such a message when it reaches a receiver in a replay:

- A takeover during a cut drops the ex-PF's solo flying, as node 2 meant.
- A PF who leaves the flight during the PM's replay drops nothing, since the handover it makes includes every message it made.
- A switch the PF flipped in the moment another pilot pressed take-control, before it learned of the press, is dropped, and the ex-PF's catch-up below undoes it in its own cockpit.

Every machine other than the new PF's that applied a message the change drops catches up state from the new PF once its replay ends, skipping what already matches: the ex-PF always, and with more crew, a pilot who got the message live.

- The ex-PF's aircraft follows the new PF's from the moment control settles, as the warning the new PF saw said it would ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
- The notification tells the ex-PF that what they changed alone is undone, and that pages and FMS entries they made alone may differ from the new PF's.

## A core that restarts

A core that crashes while its sim keeps running comes back as a [sim that closed](#a-sim-that-closed) does: the desktop app starts it again ([the sim and the core](../install/01-installing-and-updating.md#the-sim-and-the-core)), it counts its pilot as having left the flight, passes control on if they held it, and rejoins its pilot as a late joiner, whose catch-up starts at once, since the sim is still in the flight.
Dual Input aims for a core that never crashes, so a crash is a bug to report and fix rather than a state to recover from, and the crew's notification asks for a bug report (user, 2026-10-12).

Two things differ from a late join after a load, because the aircraft didn't reload:

- Each shadow value starts at the flying machine's, since the core lost its own, and the aircraft's controls stayed where they were, matching the flying machine's, rather than going back to `default` ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- The aircraft counts as settled at once, since the core missed Ready to fly, and nothing restores itself in an aircraft that didn't load.

A PF whose core crashes loses control, and their aircraft then follows the new PF's, so it jumps back by the seconds the core was down; presses either pilot made in that window are lost (user, 2026-10-12).

## Entries the aircraft drives itself

An entry for something the aircraft changes or fires on its own, such as a timer, a blinking light, or an `H:` event a gauge fires on a timer, is a profile's mistake, since an entry carries a cause ([02-live-sync](02-live-sync.md#values-not-events)), and it would send a change or a firing at every tick and fill every replay.
Input events can report on their own: 21 of the A220's reported four times a second on an untouched aircraft (measured on MSFS 2024, 2026-09-04, fsc-editor, as the [A220 study](../aircraft/synaptic-a220/study.md) cites).
The IDE shows every entry live while the profile is written, where an author can see one change on its own ([01-profile-entries](01-profile-entries.md#what-the-ide-does-with-a-profile)), and Dual Input catches a shared entry the author missed by a sign no pilot makes: every machine's own aircraft keeps changing it.

- A machine counts a shared state entry, or an event entry, as driven by the aircraft when, in every 3s for 30s, its own aircraft changed or fired it, other than by Dual Input's write, and it also received another machine's change to it or firing of it, a replayed one included.
- It then stops syncing that entry for the rest of the load, sending no change to it and applying none, and each aircraft drives its own copy, as it would anyway.
- It marks the recording and shows the once-a-flight notification that a write never landed shows ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)), so the profile reaches us in a bug report.

A pilot who turns a knob changes the entry on their own machine only, and the other machines' aircraft only take the writes, so the test never catches a pilot.
It leaves PF-owned entries out: only the flying machine sends them, and every following machine [puts them back](#putting-back), so a PM's hand resting on a throttle would otherwise trip it.
The 3s and the 30s are starting values, which v1's recordings tune.

## Putting back

When a machine's sim reports a change that Dual Input didn't write and the machine may not send, the machine writes back at once the value it holds, and sends nothing.
A machine may not send:

- a PF-owned entry, unless it's the flying machine, such as when the PM's throttle hardware moves ([01-between-machines](../network/01-between-machines.md#channels));
- any entry while its own catch-up runs, which also undoes the aircraft restoring its saved state ([03-catch-up](03-catch-up.md#while-catch-up-runs));
- the simulation rate, unless it's the flying machine ([time, date, sim rate, and pause](../product/03-v1-scope.md#time-date-sim-rate-and-pause)).

FS Copilot put nothing back, so a PM's throttle could spool up their own engine until the PF next moved theirs ([take-control key](../product/03-v1-scope.md#take-control-key)).
The pitch axis fired no event inside a dead zone set in MSFS (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)), so with a dead zone a machine puts a lever back only while the PM's hand moves it; the throttle, propeller, and mixture axes are unmeasured, and a jittering axis with no dead zone would be put back for as long as it jitters, as [the take-control key](../product/03-v1-scope.md#take-control-key)'s open question already says for a handover.
At a handover, the new flying machine may send the levers, so it stops putting them back, and each lever stays at the old PF's value until the new PF moves their hardware ([take-control key](../product/03-v1-scope.md#take-control-key)).

## An aircraft that loaded before its session

When a session starts, or its profile loads, after the pilot's Ready to fly, the 30s floor of [03-catch-up's settle rule](03-catch-up.md#settling-after-a-load) still counts from Ready to fly, and its 15s quiet window counts from when the profile loads, since nothing watched the entries before then.
If Ready to fly came 1.5 minutes ago or more, the aircraft counts as settled at once ([01-spine](../architecture/01-spine.md#what-moves-them)).

## Keys several members write

The session channel's stamp is all that active pause, the countdown, and Go without need: of two changes made at once, every machine keeps the same one, and a new PF's win ([01-between-machines](../network/01-between-machines.md#channels)).
None needs the cockpit's causal order, since none acts on a page another change opened.
Seat claims ride avatars' poses rather than the session channel, since avatars, partly recorded, writes no session key, and of two pilots who take one seat within a trip, the PF keeps it, or else the lower pilot ID ([a seat](../avatars/01-avatars.md#a-seat)).

## Known limits

- After a core restart, each shadow value takes the flying machine's, so it's right only if its pilot didn't touch that control while the core was down ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- After a sim closes, a pilot's pages, FMS, and avionics state come back as their aircraft loaded, and the notification says so.
- A PF-owned entry the aircraft drives itself isn't caught at runtime, only by its author in the IDE.

## Left open

- The driven-entry test's 3s and 30s, the 2s cap on a gap, and the 20 values a second a state entry is sent at most, which v1's recordings tune.

[2.2]: ../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
