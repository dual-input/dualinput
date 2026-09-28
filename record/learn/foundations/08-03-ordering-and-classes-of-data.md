# Synchronization: ordering and classes of data

- [Ordering, sequence numbers, deduplication, idempotency, last writer wins](#ordering-sequence-numbers-deduplication-idempotency-last-writer-wins)
- [Classes of data: what must arrive vs. what can be dropped](#classes-of-data-what-must-arrive-vs-what-can-be-dropped)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Replication models and authority are in [08-01-replication-models-and-authority](08-01-replication-models-and-authority.md), echo loops and initial sync in [08-02-echoes-and-initial-sync](08-02-echoes-and-initial-sync.md), change detection, relative actions, and flight controls in [08-04-rates-actions-and-flight-controls](08-04-rates-actions-and-flight-controls.md), position and clocks in [08-05-position-and-clocks](08-05-position-and-clocks.md), and divergence and two pilots on one screen in [08-06-divergence-and-one-screen](08-06-divergence-and-one-screen.md).

As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other.

## Ordering, sequence numbers, deduplication, idempotency, last writer wins

A receiver has to tell a newer message from an older one, and a new message from a copy.
A counter that each sender stamps on its messages answers both.
A message that sets a value is idempotent, so applying it twice does no harm, and an action applied twice does harm.
Last writer wins converges only when every machine agrees who wrote last.

**How it works.**
Our fork's pointer packets carry two numbers [1]:

- `Session`, random for each run of the sender's app.
- `Seq`, which counts up from 1 for each gesture that sender captures.

The receiver keeps the last `Seq` it applied for each `Session`, drops any gesture at or below it, and logs a warning when `Seq` skips ahead [2].
The `Session` turns a sender that restarted, and counts from 1 again, into a new sender rather than a stream of old numbers.

The order on the wire isn't always the order the app handles messages in.
Presses and drags were once two packet types, and the network layer handed each type to the thread pool separately after arrival, so a drag could reach the check after the press that followed it and be dropped as old [3].
The fix made them one type, "one ordered stream from the wire to the panel socket, and one sequence space" [1].

Copies arrive without any bug in the app.
FS Copilot sends every packet on its direct link and on the relay whenever both are up [11].
Where NAT hole punching, which [part 9](outline.md#9-networking-full-from-the-ground-up) covers, succeeded on both the LAN address and the hairpin address, two peers held two direct connections and received every packet twice, and the relay did the same over its two link directions [4].
A copy with zero spacing pulled the traffic receiver's delay estimate below the real spacing, and aircraft stuttered, until a window over the last 64 sequence numbers dropped copies and late stragglers before they reached the interpolator [4].

Whether a copy does harm depends on the message.
The traffic interpolator refuses a sample at or before its newest [5], so a repeated sample costs nothing, which is what lets the sender repeat the sample where an aircraft stopped ([Classes of data](#classes-of-data-what-must-arrive-vs-what-can-be-dropped)).
A replayed press isn't idempotent: applied twice, it presses twice, so the pointer path's resend after an outage depends on the `Seq` check to drop what the receiver already applied ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).

Under last writer wins, each machine keeps the most recent write, which makes copies harmless too, but the machines converge only if they agree which write was the most recent.
FS Copilot's cockpit updates carry a name and a value, with no sequence number or time [2], and each machine applies whatever arrives, so two writes that cross leave each machine holding the other's ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)).
Our fork's rule for hosting traffic converges because it ignores arrival order: the smallest peer ID wins, on every machine ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)).

**What it changes for Crosscheck.**
Every stream Crosscheck sends needs a stated order and a rule for copies, and each synced value has to travel either as an idempotent value or as a numbered action.
For a value both pilots can change, Crosscheck needs a winner that every machine picks the same way.

**Traps.**

- A reordered message can pass for a lost one: the receiver logs a gap when the later message arrives, then drops the earlier one without a word [3].
- Sort a resend by sequence number, not by time: two gestures recorded on different threads could hold times in the opposite order to their `Seq`, and the receiver would drop the lower one as a copy [6].
- An acknowledgment confirms one hop only: our fork's means "received by the app", not "applied by the panel" [2].
- A sender that keeps what any peer hasn't acknowledged keeps growing after a third peer leaves for good, because that peer's last acknowledgment stays the lowest, so our fork caps what it keeps at 2,000 gestures [1].

## Classes of data: what must arrive vs. what can be dropped

A value that the next message fully replaces can be dropped, because the next one comes soon.
A change sent once, an event, and an action must arrive, in order when their order matters.
Our fork sorts every packet into one of four delivery classes by that test.

**How it works.**
[Part 9](outline.md#9-networking-full-from-the-ground-up) covers transports, and three delivery modes are enough here:

- **Reliable-ordered** delivery resends a lost packet and holds every later packet on the same channel until it arrives.
- **Sequenced** delivery drops any packet that arrives after a newer one on the same channel.
- **Unreliable** delivery hands over whatever arrives, in any order.

Our fork's classes, from its source and its transport notes [7] [8]:

| Class | Mode | Carries | Because |
| --- | --- | --- | --- |
| `Reliable` | Reliable-ordered, channel 1 | Cockpit updates, `SetMaster`, display clicks, and pointer gestures | Each is sent once and must arrive in order |
| `Bulk` | Reliable-ordered, channel 3 | Traffic identities, removals, and hosting claims | Must arrive, and comes in bursts that would hold `Reliable` packets up |
| `Sequenced` | Sequenced, channel 2 | The user aircraft's physics | Each packet fully replaces the one before |
| `Unreliable` | Unreliable, no channel | Traffic states and ATC audio | Each stream numbers its own packets and decides what's stale |

Two rules came out of the traffic work.

The first is that two streams may share an ordered channel "only if neither is hurt by waiting behind the other" [7].
A joining peer receives about 130 traffic identities at once, and while they shared the reliable channel, every cockpit update waited behind them, so they moved to `Bulk` [9].

The second is that "Sequenced is correct only when packet N+1 fully supersedes packet N" [8].
Traffic states travel in batches that each carry different aircraft, so a sequenced channel drops one batch's aircraft whenever the next batch arrives first.
On our one-PC bed, the shared sequenced channel dropped about a quarter of the traffic batches, 30 to 40 gaps in 30s, and none after they moved to unreliable delivery with their own sequence numbers [10].

Between the classes sits targeted redundancy.
"The one unreliable loss that shows is an object's last sample" [8]: a lost sample of a moving aircraft is replaced by the next, and a lost "stopped here" leaves the receiver carrying the aircraft 600ms past the stop and holding it there until the 5s heartbeat.
So the traffic sender repeats the stopping sample on its next two polls, and a receiver that already has it drops the copy [8].

**What it changes for Crosscheck.**
Each Crosscheck stream needs a class, chosen by whether the next message replaces this one, and streams that share an ordered channel have to tolerate waiting behind each other.
An `H:` event must arrive, because a lost one leaves no value to read again ([03-02](03-02-events-and-other-namespaces.md#h-html-events)).

**Traps.**

- FS Copilot's `master:` updates travel sequenced too, on the physics channel, though an update for one variable doesn't replace one for another [2] [11].
  One that arrives after a newer packet on that channel is dropped, and since the entry sends only on change, the following machine keeps the old value until that control moves again (unverified).
- A class can fail on one path only.
  Unreliable packets carry no channel number, and the relay told control frames from data by channel, so no traffic state or audio frame crossed the relay; the one-PC bed missed it because its direct link carried every packet too [8].
- An unreliable packet longer than the link's MTU, the largest packet the path carries, is thrown away rather than split.
  A relayed packet crosses two links, so our fork sizes these packets for 1,024 bytes, the MTU LiteNetLib 1.3.1 starts every link at [8].

## Sources

1. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, sections "3.2 App ↔ peer (binary packets)", "4.5 One packet type, not two", and "4.6 History: everything after the last ack".
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/Coordinator.cs`: `Fresh`, `SendPointer`, the comment above the `PointerAck` subscription, `AddLink(Definition)`, and the `Update` record.
3. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R08 · Press and drag streams can reorder past the dedupe".
4. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", item 5.
5. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/TrafficInterpolator.cs`, `Push`.
6. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, "R15 · History is ordered by wall clock, not by Seq".
7. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/Delivery.cs` and `FsCopilot/Network/Transport.cs`.
8. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, sections "The failure that forced this", "Channels are ordering domains", "Delivery per stream", and "The MTU floor".
9. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-08 · Unreliable never crossed the relay; relay protocol v2, channels, budgets", the paragraph on four channels, which gives the identities' blocking as a reason found while building rather than a measurement.
10. Measured on MSFS 2024, 2026-09-06, on one PC: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", item 2, which the entry of 2026-09-08 corrects on one point: the drops were on the direct path, not the relay.
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Network/HybridNetwork.cs`: `SendAll(TPacket, bool)`, which sends `unreliable: true` as `Delivery.Sequenced`, and `SendAll(TPacket, Delivery)`, which sends on both the direct and the relay transport.

## Unverified claims

- **A `master:` update can be dropped on the sequenced channel and stay lost.**
  We read it from the source [2] [11], and nobody has counted `master:` updates at both ends.
  Logging every `master:` update sent and received during a flight over the relay, and comparing the final throttle value on both machines after each movement, would settle it.
