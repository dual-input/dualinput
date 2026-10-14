# 042: A machine's vector clock is its record of what it applied, and a skipped message counts as applied

A receiver's vector clock is its one record of what it applied: a message the clock already covers is a copy and drops, the sender's own counter is a message's number, and the heartbeat acknowledges by carrying the clock.
A message counts as applied once its write is made, its event fired, or its press played by the display's panel through to its release, and a message the receiver skips counts as applied too.
Decided by the user on 2026-10-11 and 2026-10-12, in node 3 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-machines-vector-clock-is-its-record-of-what-it-applied-and-a-skipped-message-counts-as-applied).

## Context

The cockpit stream carries state changes, events, and presses on displays in one causal order, and each message carries a vector clock, which tells whether a message was sent after its sender saw another ([02-live-sync](../areas/sync/02-live-sync.md#one-stream-in-causal-order)).
It's the one log a link replays ([decision 035](035-channels-declare-how-they-travel.md)), and a core keeps each sender's messages until every member has acknowledged them ([decision 037](037-while-a-link-is-lost.md)).
Each counter belongs to a pilot's ID and their core's restart count ([decision 023](023-pilot-id-and-restart-count.md)).
The PF is the pilot flying, the flying machine is the PF's, and a PF-owned entry, an engine lever or the trim, is one only the flying machine sends ([decision 045](045-profile-format-yaml-and-javascript.md)).
The spine left node 3 three questions: how the cockpit channel tells a copy from a late message, whether a clock names each counter by its pilot's ID and restart count or by a place in the member list, and how the conflict rule orders two changes from one pilot under two restart counts, which comparing pilot IDs can't ([01-spine](../areas/architecture/01-spine.md#left-open)).

FS Copilot's record shows what an acknowledgment that means less than applied costs:

- Its acknowledgment meant "received by the app", not "applied by the panel" (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, the constructor's comment).
- Its panel plays a press for as long as the pilot held it, up to 1.5s (read in the FS Copilot fork, `pointer.js`, `hold`).
- Its restarted app dropped a press with "No panel for DisplayUnits|config=N324DU; event dropped" (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone").

## Options

What counts as applied:

1. **A message counts once the core has received it or handed it over, as FS Copilot's acknowledgment did.**
   A press counted at the hand-over could let the next event land before its click.
2. **A separate count of applied messages, beside the vector clock.**
   It let a late joiner's queued messages apply again on top of its catch-up.
3. **The vector clock alone, counting a message once its write is made, its event fired, or its press played through to its release.**

How a message names its entry and its clock's counters:

4. **By the entry's index in the profile and each pilot's place in the member list.**
   A sample cockpit change took 27 bytes ([network log, 2.2][n22]), but the encoding depends on what the receiver publishes and holds something to rebuild after a reconnect ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#the-cockpit-stream)), and how a place would name a restart count is open ([01-spine](../areas/architecture/01-spine.md#ids)).
5. **By name in full, each counter by its pilot ID and restart count.**
   A sample cockpit change took 84 bytes against 27 ([network log, 2.2][n22]), 285 bytes to 1.1 KB a second more at node 2's assumed 5 to 20 changes a second (arithmetic).

How often a state entry is sent:

6. **Every change, as it happens.**
   A hardware axis that jitters with no dead zone changes its lever every frame, up to 360 messages a second for the 58P's six engine levers at 60 fps, against node 2's assumed 5 to 20 (arithmetic).
7. **Each state entry's newest value at most 20 times a second.**
   A change undone within 50ms never goes out, which no pilot's hand does ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#the-cockpit-stream)).

## Decision

Options 3, 5, and 7.
One value for the copy check, the acknowledgment, and what catch-up hands over means a catch-up's clock covers every message its state holds.
Counting a press only once its panel has played it through keeps the next event from landing before its click.
Names in full buy one encoding that depends on nothing the receiver publishes and holds nothing to rebuild after a reconnect, for 285 bytes to 1.1 KB a second more.
The cap keeps a jittering lever from flooding the stream, and FS Copilot sampled every entry that wasn't shared every 30ms (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, `AddLink`).

## What it commits us to

- A message the receiver's clock already covers is a copy, and drops.
- A machine sends each state entry's newest value at most 20 times a second, a starting value v1's recordings tune, and any value it's holding goes out before its next event or press, which go out as they happen.
- A receiver skips, each counting as applied:
  - the messages a change of control drops ([decision 036](036-control-is-one-value.md));
  - presses during its own catch-up, or for a display whose panel hasn't announced itself;
  - changes to an entry the aircraft drives itself ([decision 043](043-driven-entries-and-putting-back.md));
  - in a replay, all but the last of a run of PF-owned changes ([decision 039](039-cut-link-replays-others-late-join.md)).
- A machine with no aircraft in a flight, or with an aircraft other than the flying machine's, holds the stream and sends nothing on it until its catch-up.
- Of two changes from one pilot under two restart counts that neither saw, the higher count wins, since it's the later.
- Only members who send cockpit messages have counters, so a passenger never appears in one ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#the-cockpit-stream)).
- It answers the spine's questions of how the cockpit channel tells a copy from a late message, how a clock names its counters, and how two changes from one pilot under two restart counts are ordered ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It leaves the exact fields of a cockpit message to sync's stage of step 8, which lays them out in the message crate.

[n22]: ../areas/network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
