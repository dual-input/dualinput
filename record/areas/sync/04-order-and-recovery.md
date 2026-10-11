# Sync: order and recovery

```text
Purpose:     How the cockpit stream keeps its order through outages and restarts, how catch-up runs, and what comes back after something goes down.
Depends on:  01-profile-entries.md, 02-live-sync.md, 03-catch-up.md, ../network/01-between-machines.md, ../architecture/01-spine.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md
Decides:     What comes back after a link, a core, a sim, or a PC goes down; how the cockpit stream tells a copy from a late message, and which messages a receiver skips; how a vector clock names its counters; catch-up's order and pipeline; how a replay is paced; how an ex-PF's cockpit comes back after a takeover; how a core that restarted recovers; how an entry the aircraft drives itself is caught; how a following machine puts back a PF-owned lever; when an aircraft that loaded before its session counts as settled; and how a message names a profile entry.
```

What comes back depends on whether the sim kept running.
While it runs, its cockpit keeps everything no profile entry reads, such as a display's page or an FMS, so a returning pilot gets every missed change replayed in order, and loses nothing.
Once it closes, none of that can be restored, so the pilot comes back as a late joiner, with the profile's entries caught up and the rest as their aircraft loaded (user, 2026-10-11).
A few rules for the cockpit stream, its replay, and catch-up hold whatever went down.

This answers node 3 of the [architecture plan](../architecture/plan.md#3-sync-and-the-session) for sync, and [the session's roles and members](../session/01-roles-and-members.md) answers it for the session.
The flying machine is the PF's, and a following machine is any other pilot's.
The control value, the session channel, the heartbeat, and a link's states are [01-between-machines](../network/01-between-machines.md)'s.

## What comes back after what

| What went down | The sim | What comes back |
| --- | --- | --- |
| A link, cut for less than 30 minutes | Kept running | A replay of every change the pilot missed, in order ([the replay](#the-replay)) |
| The core | Kept running | Its state rebuilt from its recording, what its pilot changed meanwhile, then the replay ([a core that restarts](#a-core-that-restarts)) |
| The sim, by a crash or by the pilot closing it | Closed | A late join ([a sim that closed](#a-sim-that-closed)) |
| The PC | Closed | A late join |

A link cut for 30 minutes ends the session for that pilot ([01-between-machines](../network/01-between-machines.md#coming-back)).

## A sim that closed

A sim that closed has lost every display's page, its FMS, and each avionics suite's own state, such as a GTN 750's flight plan, and no profile entry reads them, so Crosscheck restores none of it (user, 2026-10-11).
Replaying the presses that built them wouldn't either, because a press does what the pilot meant only on the page they saw, and a scrolled waypoint list needn't scroll the same way twice.

So a sim that closes, by a crash or by the pilot closing it, counts as leaving the flight, and its pilot comes back as a late joiner (user, 2026-10-11):

- If they were the PF, their core, which stays up, passes control to the PM at once, as it does for a PF who goes to the main menu ([the connection](../product/03-v1-scope.md#the-connection)), and the crew's notice says their sim crashed.
- Once they're in a flight again, their core rejoins them under the same pilot ID, with no code to type, and their cockpit catches up state from the flying machine ([catch-up](#catch-up)).
- They're told that their displays' pages, their FMS, and anything else the profile can't read may differ from the PF's.

A PC that crashes takes the core down with the sim, so the others see a lost link ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)), and the pilot comes back as a late joiner once their sim is in a flight again.

## The cockpit stream

Every cockpit message is named by its sender's pilot ID, restart count, and number ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)), and reaches a receiver in its sender's order, whether on that sender's stream or in a replay from whoever kept it ([01-between-machines](../network/01-between-machines.md#coming-back)).

- A receiver keeps, for each sender's pilot ID and restart count, the highest number it has applied, and drops any message at or below it as a copy, whether it came twice or came again in a replay.
- A message counts as applied once Crosscheck has made its write, fired its event, or handed its press to the display's panel, and the heartbeat acknowledges only messages applied ([01-between-machines](../network/01-between-machines.md#channels)).
  FS Copilot's acknowledgment meant received rather than applied, and its app, restarted, dropped a press it had no panel for yet, logging "No panel for DisplayUnits|config=N324DU; event dropped" (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone").
- A receiver skips a message in four cases, and a skipped message counts as applied, so nothing held back waits on it and the sender stops keeping it:
  - [control](../network/01-between-machines.md#control) drops it, as an ex-PF's message made under the control value it lost, reaching the receiver in a replay;
  - it's a press that arrives while the receiver's cockpit catches up ([03-catch-up](03-catch-up.md#while-catch-up-runs));
  - it's a press for a display whose panel hasn't announced itself, as FS Copilot's pointer sync drops one (documented in the FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`);
  - its entry is one the aircraft drives itself ([below](#entries-the-aircraft-drives-itself)).

A vector clock names each counter, a pilot ID and a restart count, by a small number that the sender defines on its stream the first time that counter appears, and each new connection defines its numbers afresh.
So a clock with two pilots costs a few bytes, where naming each counter by its pilot's ID would cost 16 bytes a counter ([01-spine](../architecture/01-spine.md#ids)).
Only members who send cockpit messages have counters, so a passenger never appears in one ([04-room-for-later](../product/04-room-for-later.md#people-beyond-the-crew)).

[The conflict rule](02-live-sync.md#when-two-pilots-change-one-entry) gains one tie-break: of two changes from one pilot under two restart counts, neither made after its sender saw the other, the higher restart count wins, since it's the later.
That happens only after a PC crash, because a core that restarts while its PC runs carries its clock on from its recording ([a core that restarts](#a-core-that-restarts)).

## Catch-up

Catch-up writes each entry at the flying machine's value in the order the flying machine's cockpit first took each of those values, which its recording holds, since the recording keeps every change of the session ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
That settles [03-catch-up](03-catch-up.md#choosing-the-order)'s choice of order: where an interlock makes order matter, as with the hypothetical APU master that tries once to start the APU, it writes the battery first, and where order doesn't matter, it costs nothing, so no probe can change the choice.
Entries whose value the flying machine took before the session began, or never changed, go first.

- The catch-up carries the flying machine's vector clock as of the state it sends, and the catching-up machine's clock starts from it, so its own changes afterward follow everything that state holds.
  Changes that arrive while catch-up runs queue, and apply on top in stream order ([03-catch-up](03-catch-up.md#while-catch-up-runs)).
- When a new connection opens, or control passes, while catch-up runs, it starts again from the flying machine and skips every entry that already matches.
- A pilot can't press take-control until their own catch-up ends, as Ready waits for their aircraft to settle ([preflight](../product/03-v1-scope.md#preflight)), and the button says why.
  Their own changes aren't sent while it runs ([03-catch-up](03-catch-up.md#while-catch-up-runs)), so a cockpit taken over halfway would differ from the others' with nothing sent to bring them together.

Catch-up is a pipeline of steps, and v1's has one, [catching up state](03-catch-up.md#catching-up-state).
Each step names the steps it runs after and how it checks that it landed, and a later pick adds steps, such as an A220 plugin's `A22X.Resync` ([04-room-for-later](../product/04-room-for-later.md#a-catch-up-pipeline)).
The 58P's plugin adds none, since its values are ordinary entries ([plugins](../product/03-v1-scope.md#plugins)).
The time, date, simulation rate, and pause aren't steps, because they're session keys, which every machine applies to its sim whenever its sim differs, and neither is traffic, because the host's whole set of identities comes with every new connection, and a receiver spawns what it lacks ([01-between-machines](../network/01-between-machines.md#channels)).

## The replay

[03-catch-up](03-catch-up.md#replaying-a-short-outage)'s rule holds for a cut of up to 30 minutes: every missed change, in causal order, each after the gap the PF left before it, capped at 2s.

- So a replay lasts at most 2s for each change it carries, and changes made close together, such as a knob turned through 20 degrees, replay at their own spacing.
  A replay lasts as long as its cut only if the PF changed something at least every 2s for the whole cut, which only an entry the aircraft drives itself does, and [its test](#entries-the-aircraft-drives-itself) stops that within 30s.
- While the replay runs, the returning PM's synced displays stay locked, as they were while the link was lost ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)), and the banner says they're catching up.

## An ex-PF after a takeover

When another pilot took control while the ex-PF's link was lost, every receiver drops the ex-PF's messages made under the value it lost that reach it in a replay ([01-between-machines](../network/01-between-machines.md#control)), so the ex-PF's cockpit holds changes no other cockpit has.

- An ex-PF whose machine sent any message under the value it lost in a replay follows the replay with a catch-up of state from the new PF.
  Its machine can't always tell which of those messages the new PF dropped, such as when the takeover came partway through the replay, and a catch-up skips every entry that already matches, so running one costs nothing where none was needed.
- Its aircraft follows the new PF's from the moment control settles, as the warning the new PF saw said it would ([01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
- The notice tells the ex-PF that what they changed alone is undone, and that pages and FMS entries they made alone may differ from the new PF's.

## A core that restarts

A core that restarts while its sim keeps running, such as after a crash of its own, rebuilds from its recording, which is its journal:

1. While it runs, the core records each message before it sends it, and each message after it applies it.
   The operating system keeps what the core wrote when the core's process dies.
2. On a start with a session file whose run of the sim is still running ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)), it rebuilds what the sync engine held in memory: the state object, each entry's stamp, the vector clock, the shadow values, and the highest number it applied from each sender.
3. It compares each entry's value in the sim with the state object, and sends each difference as its pilot's change, since the pilot made it while the core was down.
   A write the core made just before it went down that landed afterward sends the value it wrote, which changes nothing.
4. It opens its links under its raised restart count, and the replay brings each side what it lacks, the core's own unacknowledged messages included ([01-between-machines](../network/01-between-machines.md#coming-back)).

- Every component in the sim sends a core that connects its whole current state, before any change, so the core rebuilds its view of the sim at once.
  fsc-editor's module outlived its app, and an editor that restarted "found the table already walked and heard nothing" (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Verified live: `L:` values in the editor, end to end").
- On a following machine, our WASM module unfroze the aircraft once the core had been quiet for 1s ([01-spine](../architecture/01-spine.md#what-moves-them)), and the core freezes it again and writes the flying machine's next sample when it comes back.
- A core keeps no cockpit message only in memory, so a restart loses none that it kept for another member's replay, and the replay has no gap from one ([01-between-machines](../network/01-between-machines.md#coming-back)).
  A PC that crashes can lose what its operating system hadn't yet written, but its pilot comes back as a late joiner, and the others still hold every message that pilot hadn't acknowledged.
- The recording's minimal mode still records the cockpit stream, since the journal is the recording ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).

## Entries the aircraft drives itself

An entry for something the aircraft changes on its own, such as a timer or a blinking light, is a profile's mistake, since an entry carries a cause ([02-live-sync](02-live-sync.md#values-not-events)), and it would send a change at every tick and fill every replay.
The IDE warns of one while the profile is written ([01-profile-entries](01-profile-entries.md#what-the-ide-does-with-a-profile)), and Crosscheck catches one the author missed by a sign no pilot makes: every machine's own aircraft keeps changing it.

- A machine counts an entry as driven by the aircraft when, in every 3s for 30s, its own aircraft changed the entry, other than by Crosscheck's write, and it also received another machine's change to it.
- It then stops syncing that entry for the rest of the load: it sends no change to it, applies none, and writes no PF value back to it, and each aircraft drives its own copy, as it would anyway.
- During a replay, a receiver runs the same test against the replayed changes, and skips the rest of that entry's once it trips.
- It marks the recording and shows the once-a-flight notice that a write never landed shows ([02-live-sync](02-live-sync.md#checking-that-a-write-landed)), so the profile reaches us in a bug report.

A pilot who turns a knob, or holds the trim through a climb, changes the entry on their own machine only, and the other machines' aircraft only take the writes, so the test never catches a pilot.
The 3s and the 30s are starting values, which v1's recordings tune.

## The PF's levers on a following machine

When a following machine's sim reports a change to a PF-owned entry that wasn't Crosscheck's write, such as the PM's throttle hardware moving, the following machine writes the PF's last value back at once through the entry's write, and sends nothing ([01-between-machines](../network/01-between-machines.md#channels)).

- An axis fires no event inside a dead zone set in MSFS (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)), so the two machines fight only while the PM's hand moves.
- FS Copilot wrote nothing back, so a PM's throttle could spool up their own engine until the PF next moved theirs ([take-control key](../product/03-v1-scope.md#take-control-key)).
- At a handover, the new flying machine stops writing back, and each lever stays at the old PF's value until the new PF moves their hardware ([take-control key](../product/03-v1-scope.md#take-control-key)).

## An aircraft that loaded before its session

When a session starts, or its profile loads, after the pilot's Ready to fly, the 30s floor of [03-catch-up's settle rule](03-catch-up.md#settling-after-a-load) still counts from Ready to fly, and its 15s quiet window counts from when the profile loads, since nothing watched the entries before then.
If Ready to fly came 1.5 minutes ago or more, the aircraft counts as settled at once ([01-spine](../architecture/01-spine.md#what-moves-them)).

## A profile entry in a message

A cockpit message names its entry by the entry's index in the profile when the receiver's profile hash matches the sender's, and by its name otherwise, and says which.
The index cuts a cockpit change from 84 bytes to 27 ([network log, 2.2](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)), and the hashes can differ, since the [preflight match check](../product/03-v1-scope.md#preflight-match-check) lets a crew fly with different profiles.
The sender reads the receiver's hash from what the receiver's machine publishes for the match check.

## Keys several members write

The session channel's stamp is all that active pause, the countdown, Go without, and seat claims need: of two changes made at once, every machine keeps the same one, and a new PF's win ([01-between-machines](../network/01-between-machines.md#channels)).
None needs the cockpit's causal order, since none acts on a page another change opened.

## Known limits

- After a core restart, a shadow value misses the events its pilot fired while the core was down, so it's right only if they didn't touch that control meanwhile ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- After a sim closes, a pilot's pages, FMS, and avionics state come back as their aircraft loaded, and the notice says so.

## Left open

- The driven-entry test's 3s and 30s, and the replay's 2s cap, which v1's recordings tune.
