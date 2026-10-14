# 035: Each channel declares how it travels, and only the cockpit stream is replayed

The core keeps a registry of the session's channels, each declaring who sends and receives it, its delivery, its priority, and whether it joins the cockpit's shared order.
The cockpit stream is the one replayed log, while the session channel and traffic's identities carry the newest value of each key, all of them again on a new connection.
The flight model's samples, the avatars, traffic's samples, ATC audio, and a heartbeat once a second ride one-off packets, and every message between cores is postcard.
Decided by the user on 2026-10-11, in node 2 of the [architecture plan](../areas/architecture/plan.md), with how a receiver takes traffic's identities changed in node 3, and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#each-channel-declares-how-it-travels-and-only-the-cockpit-stream-is-replayed).

## Context

[04-room-for-later](../areas/product/04-room-for-later.md#channels) asks v1 for a transport in which each channel declares who sends and receives it, its delivery, its priority, and whether it joins the cockpit's shared order, because our FS Copilot fork found every cockpit update waiting behind about 130 traffic identities on its one reliable ordered wire channel (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-08 · Unreliable never crossed the relay; relay protocol v2, channels, budgets").
The spine left open how the cores pack a message, and how each channel other than the cockpit's tells a copy from a late message ([01-spine](../areas/architecture/01-spine.md#left-open)).
Every pair of cores holds one QUIC connection, and a link comes back after a cut on a new one ([decision 032](032-one-quic-connection-through-iroh.md)); QUIC keeps no order across streams.

## Options

1. **Replaying every channel that must arrive, as the cockpit's is.**
   A replayed stale pause or sim-rate change would undo the session's state, where each key's newest value can't.
2. **Streams that depend on each other's order:** the session's state on a stream of its own, a channel in the cockpit's shared order on a stream of its own, or a stream that waits on a channel's announcement made on another.
   QUIC keeps no order across streams, so the state could arrive after the replay it should precede, the channel would lose the cockpit's order, and the stream could arrive before its announcement.
3. **Session keys with no stamp.**
   Two pilots who change pause during a cut each hold a value the other's numbering can't order, so each would take the other's and the two sims would swap.
4. **Leaving the session-wide keys as they stand when a core takes control.**
   An ex-PF that sets the sim rate alone during a cut stamps it higher than the value the new PF holds and never changed, so the ex-PF's rate would win on return.
5. **The yoke, rudder, and toe brakes on the cockpit stream.**
   They move nearly every frame while the PF hand-flies, which would flood the cockpit stream and its replay (user, 2026-10-11).
6. **Handing every one-off packet to QUIC as it's made.**
   noq queues one-off packets in order and drops the oldest, of any channel, only to make room for a new one (read in noq-proto 1.3.0, `src/connection/datagrams.rs`), so a traffic batch could push out a flight sample, and a newer sample could wait behind stale ones ([01-between-machines](../areas/network/01-between-machines.md#sending)).
   On iroh's relay that never happened, and nothing a sender did changed when its channels arrived ([network log, p06][p06]).
7. **A traffic batch sized to the packet size a path discovered.**
   A relayed packet crosses links that discover their packet size separately, so FS Copilot budgeted to the smallest (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The MTU floor"), and noq drops a queued one-off packet that outgrows a shrunken path without saying so (read in noq-proto 1.3.0, `src/connection/datagrams.rs`, `drop_oversized`).
8. **MessagePack, bitcode, or wincode in place of postcard**, as node 2.2's probe, p02, compared them ([network log, 2.2][n22]).
   MessagePack without field names took 3% to 37% more than postcard, and its traffic batch, 1,165 bytes, is 3 bytes over the 1,162 a one-off packet carries at QUIC's starting packet size.
   wincode took 7% to 126% more, and has no serde support.
   bitcode beat postcard only on the traffic batch, 922 bytes to 945, lists a "Stable format across major versions" as a non-goal, and for traffic alone would save 50 to 250 bytes a second for two formats to keep.
   bincode itself was out: its development "has ceased" ([bincode 3.0.0 on docs.rs](https://docs.rs/crate/bincode/3.0.0)).
9. **The channels as decided.**
   Every new connection carries every session key and traffic identity again, and through a relay every channel shares TCP's lateness, streams and one-off packets alike ([network log, p06][p06]).

## Decision

Option 9, which avoids the failure each of options 1 to 7 carries.
postcard packed every v1 message smallest but one, with a stable wire format and serde's derives, which the crate's messages already have ([network log, 2.2][n22]).
The newest-only slots changed nothing on iroh's relay, and on a direct path, where QUIC sees losses itself, they would keep a stale sample from waiting (unverified), which the network's stage of step 8 checks ([01-between-machines](../areas/network/01-between-machines.md#sending)).

## What it commits us to

- v1's channels have fixed numbers in the message crate, each stream opens with a header naming its channel, and a channel in the cockpit's shared order rides the cockpit stream, tagged with its channel.
- A plugin opens only instances of the kinds of channel Crosscheck provides, object mirroring and audio capture, and announces each on the session channel ([01-between-machines](../areas/network/01-between-machines.md#channels)).
- A new connection's first message carries every session key, and a core applies nothing else from the connection until it has passed; catch-up starts again on the new connection.
- Every session key but control carries a stamp: the control value its writer held, a number one past the highest its writer has seen on that key, and the writer's pilot ID.
  A receiver keeps the value with the highest stamp, comparing control values first, as [decision 036](036-control-is-one-value.md) orders them, then the numbers, with the lower pilot ID winning a tie ([01-between-machines](../areas/network/01-between-machines.md#channels)).
  A core that takes control writes every session-wide key again under the new value.
- Each member writes its own entry, its pilot ID, display name, kind, and endpoint ID, as a session key, and a core dials any member it learns of and holds no connection to.
- The flight model's samples also carry the yoke, rudder, and toe-brake positions the flying aircraft applied, and the PF's engine levers and trim ride the cockpit stream, where the following machine writes the PF's last value back when the PM moves one.
- The core holds only the newest packet for each connection, channel, and key, and ATC frames in a short queue with a deadline, and hands them to a QUIC queue of a few packets in a fixed order as it has room.
  It keeps a traffic batch under 1,162 bytes, and paces what it sends through a relay below the cap the relay list gives ([decision 033](033-relays-run-iroh-relay-unmodified.md)).
- A receiver merges traffic's identity set, and a copy with no sample for 15s is removed and its identity forgotten, since an object the sim removes during a cut never sends its removal ([roles and members](../areas/session/01-roles-and-members.md#the-traffic-and-atc-host)).
- Each channel but the cockpit's tells a copy from a late value by the rule [01-between-machines](../areas/network/01-between-machines.md#channels) gives it, which answers the spine's questions of how the cores pack a message and how each channel other than the cockpit's tells a copy from a late message.
- How the cockpit channel tells a copy from a late message was left to node 3, and [decision 042](042-vector-clock-records-what-applied.md) answers it.
- Which fields each message carries is left to node 3 and the flight-model sync ([network log, 2.2][n22]).
- How one-off packets behave on a direct path under loss is left to the network's stage of step 8 ([01-between-machines](../areas/network/01-between-machines.md#left-open)).

[n22]: ../areas/network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[p06]: ../areas/network/log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
