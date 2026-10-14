# 037: While a link is lost, the PF flies on, a PM that lost the flying machine locks, and any pilot can take control

While a link is lost, the PF flies on, a PM that lost the flying machine locks its synced displays, and any pilot whose role may hold control can take it, a PM with a warning that names what follows; no core decides who lost the connection.
A pilot back within 30 minutes whose sim and core kept running gets a replay of the cockpit stream, and a core with no connection to any member for 30 minutes leaves the session.
Decided by the user on 2026-10-10 and 2026-10-11, in node 2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#while-a-link-is-lost-the-pf-flies-on-a-pm-that-lost-the-flying-machine-locks-and-any-pilot-can-take-control).

## Context

The PF, the pilot flying, holds control, and their machine is the flying machine; a following machine is any other pilot's, and the PM, the pilot monitoring, is the other front-seat pilot ([03-v1-scope](../areas/product/03-v1-scope.md)).
Every pair of cores holds one QUIC connection through iroh, directly or through one of our relays ([decision 032](032-one-quic-connection-through-iroh.md)), and a link counts as lost after 5s with nothing on its connection, when its core closes the connection and redials ([01-between-machines](../areas/network/01-between-machines.md#the-link-between-two-cores)).
A direct path can die with no warning, and iroh then moves the connection to the relay one path idle timeout later, while the flight-model stream goes silent ([network log, 2.3][n23]).

Four rules and questions from earlier work bear on what happens then:

- **A short gap.** [The connection](../areas/product/03-v1-scope.md#the-connection) holds the following aircraft still through a short gap in the flying machine's data and jumps it when data returns, and lists three ways to soften the gap for the architecture to weigh.
- **Who flies.** [The take-control key](../areas/product/03-v1-scope.md#take-control-key) passes control to the PM when the PF's connection drops.
- **The cut-off.** After 5 minutes cut off, the session ends for that pilot, as our FS Copilot fork waits the same 5 minutes (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, `DegradedTimeout`, and `record/pointer-forwarding/docs/13-pr-prep.md`).
- **A session file after a long outage.** A core that starts and finds a session file can't tell how long it was gone, because the file holds no time the core measures with ([01-spine](../areas/architecture/01-spine.md#left-open)).

## Options

The path timers:

1. **iroh's default path idle timeout, 15s, or a 5s one.**
   After a firewall cut the direct path, the flight-model stream went silent for 15.0s or 5.0s, the whole timeout, before the relay took over ([network log, 2.3][n23]).
2. **A 2s path idle timeout, with the path keep-alive at 0.67s, a third of it.**
   The stream went silent for 2.0s.
   A stall that holds a direct path's packets for 2s trips the timeout too, and the connection then stays on the relay until iroh's next punch, so a 2s stall can cost up to a minute of relaying (inference, [network log, 2.3][n23]).

A short gap in the flying machine's samples:

3. **Hold the following aircraft still through the gap, and jump it to the flying machine's position when data returns,** the rule in the connection.
4. **Carry the aircraft on its last velocities, and ease it to the true position when samples come again.**
   The flying machine has to mark a stretch in which its sim stopped on purpose, such as a pause or a load, so the following machine carries the aircraft only through a gap the network made ([01-between-machines](../areas/network/01-between-machines.md#softening-a-short-gap)).
5. **Send the last few samples in each packet.**
   The following machine draws the aircraft 0.4s in the past, so when one sample is lost, the samples 50ms before and after it have already arrived to draw between, and the late samples in the friends' runs were held back by the relay's TCP, not lost, so copies in later packets would arrive no sooner ([01-between-machines](../areas/network/01-between-machines.md#softening-a-short-gap)).
6. **Send copies through the relay while the direct path is in doubt.**
   iroh can't on one connection, since it sends on one path at a time ([network log, 2.1][n21]).

Who flies while a link is lost:

7. **Control passes to the PM when the PF's connection drops,** the take-control key's rule.
   Telling which pilot lost the connection takes a third party both cores trust (user, 2026-10-11).
8. **The PF flies on, and any pilot whose role may hold control can take it.**
   A PM who takes control while the PF may still be flying makes the PF's aircraft jump to the PM's when the PF reconnects, which the PM's warning names, such as "James may still be flying. If he is, his aircraft will jump to yours when he reconnects." ([01-between-machines](../areas/network/01-between-machines.md#while-a-link-is-lost)).

The cut-off, and what a returning pilot gets:

9. **A 5-minute cut-off, after which a returning pilot comes back as a late joiner, with a catch-up of state.**
   A catch-up of state can't bring back what a profile can't read, such as a display's page or an FMS, which a replay brings back (user, 2026-10-11).
10. **A 30-minute cut-off, with a replay for a returning pilot whose sim kept running.**
    Each core keeps every sender's cockpit messages until every member has acknowledged them, for up to 30 minutes, about 0.8MB to 3MB a sender at 84 bytes a cockpit change and an assumed 5 to 20 changes a second ([network log, 2.2][n22]; arithmetic), and a replay runs at up to 2s a change ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#the-replay)).

How a pilot says goodbye:

11. **A goodbye message before the close.**
    noq lets a peer drop stream data it hasn't delivered once a close arrives, so the goodbye could be lost (read in noq 1.3.0, `src/connection.rs`).
12. **QUIC's close itself, with an application code that only Leave sends.**

## Decision

Options 2, 4, 8, 10, and 12.
iroh moved to the relay 2.0s after a firewall cut the direct path, every time, and samples came again through the relay at once; no move happened that a cut didn't cause ([network log, 2.3][n23]).
The keep-alive also holds each router's mapping open, since one friend's router forgot an idle port within 30s (same entry).
Without a third party, a pilot who sees the crew's links, warned of what a takeover does, decides as well (user, 2026-10-11).
After a long outage, a few minutes of replay beat a quick catch-up of state, and a flight cut off for 30 minutes has usually ended (user, 2026-10-11).
noq closes a connection with code 0 when every handle to it is dropped (read in noq 1.3.0, `src/connection.rs`), so a process that dies can close with code 0, and only a code of our own tells a Leave from a lost link.

## What it commits us to

- iroh's path idle timeout is 2s and its path keep-alive 0.67s, and the core sends no copies over a second path, since iroh sends on one path at a time ([network log, 2.1][n21]).
- Through a short gap, the following machine carries the aircraft on its last velocities and eases it to the true position when samples come again.
- While a link is lost, every pilot's banner lists each crew member's link and whether this PC reaches the internet.
- A new connection's first message carries the session's state whole, control among it, and then each side sends the cockpit stream's replay: each core keeps every sender's cockpit messages it applied until every member has acknowledged them on the heartbeat, for up to 30 minutes, and sends the other what it lacks.
- Within 30 minutes, a returning pilot whose sim and core kept running gets a replay, which its 2s cap on each gap bounds at 2s a change ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#the-replay)); at 30 minutes without a connection to any member, a core leaves the session, PF or PM.
- A core that starts with a session file asks the crew whether its pilot is still in, since a crew member timed the silence.
- Closing Crosscheck any other way than Leave session sends a quit code that the others treat as a Leave.
- It replaces [the take-control key](../areas/product/03-v1-scope.md#take-control-key)'s rule that control passes to the PM when the PF's connection drops, and [the connection](../areas/product/03-v1-scope.md#the-connection)'s 5-minute cut-off.
- It answers which ways to soften a short gap v1 builds ([the connection](../areas/product/03-v1-scope.md#the-connection)), and what a core does with a session file found after a long outage ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It leaves tuning the 5s, the 2s, and the 30 minutes to v1's recordings.
- It leaves to the flight-model sync how far the following machine carries the aircraft, how it eases it, and the marker for a sim stopped on purpose.
- How an ex-PF's cockpit comes to the new PF's state is [decision 039](039-cut-link-replays-others-late-join.md)'s ([04-order-and-recovery](../areas/sync/04-order-and-recovery.md#a-change-of-control)).

[n21]: ../areas/network/log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[n22]: ../areas/network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[n23]: ../areas/network/log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
