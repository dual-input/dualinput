# 023: A pilot keeps their ID through a core restart, and the core counts its restarts

The core keeps a session file in its data folder, which holds the pilot's ID and the core's restart count among the session's state, and the count goes up by 1 each time the core starts while the file exists.
Between cores, every message is named by its sender's pilot ID, restart count, channel, and number, and in the vector clocks each counter belongs to a pilot's ID and a restart count.
Decided by the user on 2026-10-09, in node 1.4 of the [architecture plan](../areas/architecture/plan.md), with a restarted core's late join decided on 2026-10-12, in node 3, and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-pilot-keeps-their-id-through-a-core-restart-and-the-core-counts-its-restarts).

## Context

A receiver drops a message it has already applied ([02-live-sync](../areas/sync/02-live-sync.md#keeping-a-change-from-applying-twice)), so a receiver that didn't know a core restarted would take its messages, numbered from 1 again, for copies of old ones.
[The connection](../areas/product/03-v1-scope.md#the-connection) reconnects a returning pilot from session state saved on their machine.
Node 1.1 raised what a pilot's identity is across a core restart, since FS Copilot made a restarted app "a new peer in every respect" (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03), and [node 1.4](../areas/architecture/plan.md#14-shared-conventions) took the question.

## Options

1. **A restarted core is a new peer, as FS Copilot made it.**
   The fix FS Copilot's pre-PR review settled on lived with three limits: up to one acknowledgment interval of events could apply twice on a restarted peer, a restarted sender's history was gone, and a new third person got a replay they didn't need (documented in the FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03).
2. **The pilot keeps their ID, and the core numbers its messages from 1 again.**
   A receiver would take the restarted core's messages for copies of old ones and drop them.
3. **The pilot keeps their ID, and the core saves the number of each message it sends and goes on numbering after a restart.**
   That puts a disk write ahead of every send.
4. **The pilot keeps their ID, and the core counts its restarts.**
   The count costs one write per start, and each restart adds a counter to every vector clock for the rest of the session ([01-spine](../areas/architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).

## Decision

Option 4.
A link back from an outage under the same count is the same core, whose replay the receiver dedupes against the numbers it kept, and a higher count tells the receiver that the sender restarted and numbers from 1 again.
A crashed core reconnects its pilot under the same ID, as a late joiner ([decision 041](041-core-crash-comes-back-as-late-joiner.md)).
The third of FS Copilot's limits doesn't arise in Crosscheck, since a first join catches up state ([01-spine](../areas/architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).

## What it commits us to

- The core keeps the session file from when the pilot starts or first joins a session until they press Leave session, the session ends for them after 30 minutes cut off ([01-between-machines](../areas/network/01-between-machines.md#coming-back)), or the core learns the session has ended.
- The file holds the session's ID and invite code, the pilot's ID, the core's restart count, the run of the sim the pilot was in, the core's endpoint key for the session, the crew's endpoint IDs, and the session's relay list with its tokens ([01-between-machines](../areas/network/01-between-machines.md#joining)).
- The core flushes the raised count to disk before it opens any link, because a core that sent under a count it hadn't saved would reuse that count after a crash, and the others would drop its messages as copies ([01-spine](../areas/architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
- A link that carries only its sender's messages names the pilot ID and restart count once, as it opens, and a link that carries several senders' messages carries them with each message.
- A receiver keeps what it knew of a sender's numbers when its link opens again with the same count, and starts them afresh when it sees a higher count for that sender, on a link that opens with it or on a message that carries it.
- This changes [02-live-sync](../areas/sync/02-live-sync.md#one-stream-in-causal-order)'s and [04-room-for-later](../areas/product/04-room-for-later.md#people-beyond-the-crew)'s one counter per pilot, gives 02-live-sync's message ID its form, and settles node 1.4's question of what a pilot's identity is across a core restart ([architecture plan](../areas/architecture/plan.md#14-shared-conventions)).
- A core that restarts rejoins the pilot under the same ID as a late joiner, whether its sim kept running or restarted too, so it rebuilds nothing the sync engine held only in memory ([decision 041](041-core-crash-comes-back-as-late-joiner.md)).
- It leaves out how each channel tells a copy from a late message, for the part that designs sync and the node on how the cores reach each other ([01-spine](../areas/architecture/01-spine.md#left-open)), which [decision 035](035-channels-declare-how-they-travel.md) answers for every channel but the cockpit's, and [decision 042](042-vector-clock-records-what-applied.md) for the cockpit's.
- It leaves out how the conflict rule orders two changes from one pilot under two restart counts, which comparing pilot IDs can't, for the part that designs sync ([01-spine](../areas/architecture/01-spine.md#left-open)); under [decision 042](042-vector-clock-records-what-applied.md), the higher count wins.
- It leaves out what a core does when it starts and finds a session file after being down long enough that its pilot may have been cut off for more than 30 minutes, which node 2 answers ([01-between-machines](../areas/network/01-between-machines.md#a-session-file-after-a-long-outage); [decision 037](037-while-a-link-is-lost.md)).
- It leaves out what a core that restarts mid-flight gives up by registering its masks after the aircraft loaded ([01-spine](../areas/architecture/01-spine.md#left-open)).
