# Network: between machines

```text
Purpose:     How a session's cores reach each other, the relay, and the backend.
Depends on:  ../architecture/01-spine.md, ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md, log.md
Decides:     The topology, the transport, the way through home routers, the relay and its language, encryption, how a crew finds each other, how each channel travels and tells a copy from a late message, what a session does while a connection is lost, which ways to soften a short gap v1 builds, two cores on one PC, a session file found after a long outage, and how a receiver estimates a sender's clock offset.
```

Every pair of cores in a session holds one QUIC connection that iroh 1.3 makes and keeps: directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't.
Our backend turns an invite code into the crew's endpoints when a pilot joins, and has no part in a running session; the relays run n0's `iroh-relay` with nothing of ours on them.
Each channel rides the connection by the delivery it needs: a stream that resends what's lost for messages that must arrive, and one-off packets for what the next message replaces.
When a core hears nothing from a crew member for 5s, the session is degraded for it: the PF flies on, a PM's displays lock, every pilot sees whom they can reach, and any pilot can take control, with a warning, and no core decides who lost the connection.
This answers node 2 of the [architecture plan](../architecture/plan.md#2-how-the-cores-reach-each-other) from its children's findings in the [network log](log.md): [2.1] chose iroh, [2.2] the encoding, and [2.3] measured iroh across home networks.

The terms:

- iroh is n0's Rust library for QUIC between devices, built on noq, n0's fork of the QUIC library quinn ([2.1]).
- An endpoint is one iroh instance, and its endpoint ID is the public half of its key, which other endpoints dial.
- A path is one way a connection's packets travel, direct or through a relay; a connection keeps several and sends on one.
- A pilot's home relay is the relay their endpoint stays connected to, where other endpoints reach it.
- A one-off packet is a QUIC datagram, which QUIC sends once and never resends.

## Who does what

```text
 Pilot A's core                one QUIC connection                Pilot B's core
 iroh endpoint ◀──────────── direct path: UDP ─────────────────▶ iroh endpoint
               ◀──────── relay path: TCP 443, through a relay ──▶
      │                                                                 │
      ├── to its home relay: "what's my public address?"                │
      └── HTTPS to the backend, when joining: code ⇄ crew's endpoints ◀─┘
```

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Every core | On each pilot's PC | Its iroh endpoint, under a key drawn fresh for each session; a connection to every other crew member; the channels and the one scheduler that sends them; replay after an outage; clock offsets; the degraded state; recording each connection's path, loss, and relay stalls |
| The flying machine's core | The PF's PC | What 03-v1-scope already gives it: the flight model, the flight controls, and the aircraft's authority; nothing more for the connection |
| Relay | n0's `iroh-relay`, unmodified, on servers off the pilots' machines, in at least two regions | Carries a pair's packets when no direct path works, tells each endpoint its public address, and admits only Crosscheck |
| Backend | Off the pilots' machines; its candidate is a Cloudflare Worker ([01-spine](../architecture/01-spine.md#components)) | Draws invite codes and maps each to the crew's endpoints, limits code guessing, serves the relay list, and holds bug reports; nothing during a running session |

## Topology

Each core holds one connection to every other core in the session and sends each message straight to each receiver, the connection between every pair that [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) leads with.
A v1 session has two pilots, so it has one connection, and a larger crew later adds a connection per pair.

A core keys everything it keeps about a sender, its message numbers, what it applied, its clock offset, and its replay position, by the sender's pilot ID and restart count, never by a connection or an endpoint.
In v1 every message reaches its receiver from its own sender, so the sender names itself once, in its first message on the connection ([how a crew finds each other](#how-a-crew-finds-each-other)).
A later feature that forwards others' messages, such as a feed to passengers, carries each message's pilot ID and restart count with it, the spine's form for a link that carries several senders' messages ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)), and nothing built for v1 changes.

Two cores hold one connection, not two.
After an outage, only the core with the lower endpoint ID dials; if two connections open anyway, the one the lower ID dialed stays, and the other closes with an application code of its own.
In our FS Copilot work, two connections between one pair carried every packet twice, and a duplicate arriving at the same instant pulled the traffic receiver's delay estimate down until the aircraft stuttered (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", item 5).

## How a crew finds each other

1. The host's core asks the backend for a code, sending the session's ID and the host's pilot ID, display name, endpoint ID, home relay, Crosscheck version, and message crate hash.
   The backend draws a code that no live session holds, as fsc-editor's relay does ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)), and keeps the session under it.
2. A joining core sends the code with the same details of its own.
   If its version or hash differs from the session's, the backend refuses and names who is behind, in its own answer, before anyone dials ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
   Otherwise it answers with the session's ID and each crew member's pilot ID, display name, endpoint ID, and home relay, and adds the joiner.
3. The joining core dials every crew member at once, by endpoint ID and home relay, and iroh learns the direct addresses over the connection, since it punches toward the addresses the other side advertises on it (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `trigger_holepunching`).
4. Each side's first message on the connection opens with a header that no release changes, holding Crosscheck's version and the message crate's hash, followed by the session's code and the sender's pilot ID and restart count.
   A core accepts a connection whose first message carries its session's code, version, and hash, and closes any other with an application code that says why.
   Until that first message has passed, it ignores the connection's one-off packets, which QUIC can deliver before the first stream data.

The code is the credential: it admits a pilot with no approval, as [the invite code](../product/03-v1-scope.md#invite-code) rules, and it crosses only inside QUIC's encryption and the backend's HTTPS.
A joiner counts as a crew member, and shows in the crew, only once its first message has passed, because FS Copilot counted a handshake that later failed as a peer and locked the pilot's panels for 5 minutes ([09-06](../../learn/foundations/09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
Crew members tell each other on the session stream whom they're connected to, so two pilots who joined at once find each other.

The backend keeps a session only as long as its crew uses it, without watching a running session:

- Each core renews its place every 10 minutes, and the backend drops a member that hasn't renewed for 30 minutes, which no running session notices, since none asks the backend anything.
- Leave session tells the backend at once, and the backend frees the code once its last member has left or lapsed.
- The backend limits how fast one address can try codes, as fsc-editor's Worker allows 20 join attempts a minute from each IP address ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)).
- Each request to the backend carries a signature by the core's endpoint key, and the backend binds a pilot ID to the endpoint ID it first registered with, so nobody else can renew or leave in that pilot's name.
- The backend's requests and answers are JSON, with the message crate's types and a version of the backend's own, and the backend serves each version still in pilots' hands, since one backend serves every Crosscheck release in use.

A pilot coming back to a session dials the crew's endpoints their core kept, with no backend, and asks the backend by code only if no one answers.
The relays speak iroh's own protocol, and nothing of ours.

## The way through home routers

iroh punches holes inside QUIC, asks the router for a port through UPnP, NAT-PMP, and PCP, prefers IPv6, and punches again when either side's addresses change ([2.1]).
From each of two friends' home networks to ours, 10 of 10 connections went direct, including from a router that lets in only replies and answered no UPnP, because both it and ours keep one public port for every destination ([2.3]).
The two friends' routers were never paired with each other, because 2.3's test between friends failed in the build they ran.
Connections opened in a median 24ms to 159ms, about one round trip to a relay, which fits a connection that starts through the relay (inference), and those that went direct moved to it in a median 42ms to 316ms ([2.3]).
A simulated router that picks a new public port for each destination was reached directly only from the friend near New York, whose router answered UPnP, which would let in the ports it mapped (inference, [2.3]).

The installer adds a Windows Firewall rule that lets the core receive, for every network profile, on the core's install path compared without regard to letter case.
2.3's tester matched its own path in Windows Firewall's rules only where the letter case matched ([2.3]).
Whether the rule also has to remove a block rule left by a dismissed prompt, because Windows lets a block rule win over an allow rule, is unverified, and a clean install that dismisses the prompt settles it.

Wi-Fi, carrier-grade NAT, double NAT, and mobile links are unmeasured, since 2.3's three PCs were all wired at home.
v1 records each connection's path, loss, and relay stalls in the recording that bug reports carry, which tells how many pilots end up relayed, far from the relay their packets cross, and on lossy links (user, 2026-10-10).

## The relays

A relay runs n0's `iroh-relay`, in Rust, unmodified, which settles the relay's language the [spine](../architecture/01-spine.md#between-machines) left to this node.
We run relays in at least two regions (user, 2026-10-11).
The backend serves the default relay list, which a setting overrides, so a group can point Crosscheck at relays of its own, as [01-aims](../product/01-aims.md#relay-and-license) asks.
A core reads the list before it binds its endpoint, and binds a new one between sessions when the list changed, because iroh leaves the relay out of an endpoint bound without it, and a relay added afterward never takes effect (read in iroh 1.3.0, `src/endpoint.rs`, `From<RelayMode>`; [2.3]).

Our relays admit only Crosscheck (user, 2026-10-11).
Each relay's configuration lists one or more shared tokens, and admits only a client that presents one (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig::SharedToken`), and every copy of Crosscheck carries the token with the relay list.
That keeps other iroh applications off our relays, though not someone who digs the token out of our program, and listing two tokens at once lets us change it without cutting anyone off.
Each relay also caps the rate one client can send.

Each endpoint picks its home relay by latency, never by cost, as [the connection](../product/03-v1-scope.md#the-connection)'s rule that flight data wins asks (read in iroh 1.3.0, `src/net_report.rs`):

- At start, on a major network change, and every 5 minutes, it probes the first 5 relays in its list and stops once 3 have answered, or all of them if there are fewer; in between, it measures only the relay it holds a probe connection to.
- It keeps each relay's best latency from the last 5 minutes, homes at the fastest, and moves to another only when that one's latency is under two-thirds of the current one's.

So with v1's two relays, each pilot homes at the nearer.

A relayed packet goes to the receiver's home relay, unless the sender already holds a connection to a relay where it has heard from the receiver (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `active_relay_handle_for_endpoint`).
So when one pilot dials another through the other's home relay, the replies likely come back the same way, and both directions cross one relay, with the dialer's leg the long one when the two are far apart.
Which relay each direction uses in practice is unmeasured; a probe with two pilots homed at different relays settles it.

A relay carries everything over one TCP connection per pilot, so it loses nothing, and a lost packet holds back everything behind it until TCP resends it ([2.1]).
The hold-up grows with the sender's round trip to the relay: at 3% loss, iroh's p99 lateness was 53ms at 22ms away, 264ms at 42ms, 346ms at 97ms, and 534ms at 131ms, where a UDP relay under the same loss lost about 3% and stayed within 81ms ([2.3]).
v1 accepts that, with an adaptive buffer for ATC audio (user, 2026-10-10).
At 3% loss through a relay 97ms to 131ms from the sender, the worst 1% of ATC frames came 346ms to 534ms late, and 6% to 11% came more than 170ms late; at 1% loss, the worst 1% came 168ms to 188ms late ([2.3]).
So a crewmate of a relayed ATC host on a lossy link, far from the relay their packets cross, hears some calls later than the 300ms at which the host's readback on Discord would overtake them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).

## Encryption

QUIC encrypts every packet with TLS 1.3 and has no mode that doesn't, so Crosscheck builds nothing for encryption, as it needn't (user, 2026-10-09).
QUIC's own header and frames, the encryption's tag among them, take about 30 of the 58 bytes every packet carries before any message ([2.2]).
iroh's handshake checks the accepting core's key against the endpoint ID the dialer asked for, and has the dialing core sign with its own key, so each side knows the other's endpoint ID (read in iroh 1.3.0, `src/tls/verifier.rs`, `verify_server_cert` and `verify_client_cert`).

## Channels

A channel declares who sends it, as a role such as the flying machine or as every machine; who receives it; its delivery, every message in order, the newest value of each key, or the lowest delay with loss acceptable; its priority; and whether it joins the cockpit's shared order, as [04-room-for-later](../product/04-room-for-later.md#channels) asks.
The core keeps a registry of the channels a session runs, and each stream opens with its channel's ID, as each one-off packet does.
A plugin opens instances of the kinds of channel Crosscheck provides, object mirroring and audio capture, such as a GSX plugin mirroring GSX's vehicles, and defines no kind of its own (user, 2026-10-11; [04-room-for-later](../product/04-room-for-later.md#plugins)).

v1's channels:

| Channel | From | Carried as | Copies and late messages | Priority |
| --- | --- | --- | --- | --- |
| Session | Every machine | A stream from each sender | Applied in order; a receiver drops a message at or below the last number it applied from that sender | Above every other stream |
| Cockpit | Every machine | A stream from each sender | Causal order across senders ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)); telling a copy from a late message is node 3's ([01-spine](../architecture/01-spine.md#left-open)) | Below the session's |
| Flight model | The flying machine | One-off packets, one sample each, at a fixed rate | A receiver drops a sample whose stamp isn't later than the newest it applied from that sender | Ahead of every stream |
| Flight controls | The flying machine | One-off packets, at the flight model's rate, each with the newest yoke, rudder, and toe-brake positions | The same as the flight model's | Ahead of every stream |
| Avatars | Every machine | One-off packets, one pose each | The newest pose of each figure, by stamp | Ahead of every stream |
| Traffic | The traffic host | Each object's identity on a stream; samples as one-off packets in batches | Identities in order, as the session's; each object's newest sample by the time it was read | Identities below the cockpit's; samples ahead of every stream |
| ATC audio | The ATC host | One-off packets, one 20ms Opus frame each, numbered | Played in number order behind an adaptive buffer; a frame that arrives after its turn is dropped | Ahead of every stream |

The flight controls ride a channel of their own because the yoke and rudder move nearly every frame while the PF hand-flies, which would flood the cockpit stream and its replay, and a fixed rate means the PF's values overwrite any yoke input of the PM's within a sample (user, 2026-10-11).
The PF's engine levers and trim move far less often, so they stay entries on the cockpit stream, owned by the PF, and the following machine writes the PF's last value back at once when its own sim reports that the PM moved one, which keeps [the take-control key](../product/03-v1-scope.md#take-control-key)'s rule that the PM's hardware can't hold them away (user, 2026-10-11).

Sending:

- noq's queue for one-off packets drops the oldest packet of any channel only to make room for a new one (read in noq 1.3.0, `src/connection.rs`, `send_datagram`), so a traffic batch could push out a flight sample, and a stale sample could wait behind newer ones.
  So the core sets that queue to a few packets (`QuicTransportConfigBuilder::datagram_send_buffer_size`, read in iroh 1.3.0, `src/endpoint/quic.rs`), keeps one slot per one-off channel that holds only its newest packet, and hands a packet to QUIC only when `Connection::datagram_send_buffer_space` shows room (read in iroh 1.3.0, `src/endpoint/connection.rs`).
- One scheduler for the whole core drains those slots by priority and gives every channel a share, so the streams are never shut out, across every connection a core holds.
  Whether one-off packets starve the streams on a lossy relay, and whether the slots prevent it, is unmeasured; a probe running v1's full mix of channels through iroh's relay under loss settles it.
- QUIC builds each packet from what's waiting when it builds it: queued one-off packets first, then stream data, until the packet is full (read in noq-proto 1.3.0, `src/connection/mod.rs`, `populate_packet`).
  The core hands over what one sim frame produced together, though whether two messages handed over together share one packet is unmeasured.
- A batch of traffic samples stays under 1,162 bytes, the one-off packet's size at QUIC's starting packet size ([research digest](results/2026-10-10-transport-research-digest.txt)), not the size a path has discovered.
  A relayed packet crosses links that each discover their size separately, so FS Copilot sized its budget to the floor (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The MTU floor"), and noq drops a queued one-off packet that outgrows a shrunken path without saying so (read in noq-proto 1.3.0, `src/connection/datagrams.rs`, `drop_oversized`).
- While the relay path carries a connection, the core paces a replay and every bulk transfer after v1, such as a profile sent to a pilot who lacks it, since QUIC sees no loss through the relay's TCP until a queue overflows ([2.1]).
- Every message between cores is postcard ([2.2]).
  Which fields each message carries, which changes its size more than the format does, is for the parts that design the messages: node 3 for the cockpit's, and the flight-model sync for its samples ([2.2]).
- A message's stamp is µs on its sender's counter, and its sender's restart count, which the sender's first message names, tells the receiver when that counter's timeline may have changed ([01-spine](../architecture/01-spine.md#times)).

## Paths

The core sets iroh's path idle timeout to 2s and its path keep-alive to 0.67s, a third of the timeout, as 2.3 ran them ([2.3]):

- For 2s after a direct path dies, iroh keeps sending on it, so nothing arrives.
  Then the connection moves to the relay path, which stays open, and one-off packets sent into the dead path stay lost ([2.3]).
  Streams resend over the relay what the dead path swallowed, which 2.3 didn't record (unverified).
- In 2.3, where a firewall cut the direct path mid-session, flight-model samples came again through the relay 2.0s after the cut every time, and no move happened that a cut didn't cause, across 55 connections in each run ([2.3]).
- iroh punches again at once when the operating system reports a network change, and otherwise every 60s, so the connection is back on a direct path within 60s of one working again ([2.3]).
- The keep-alive also holds each router's mapping open: one friend's router forgot an idle port within 30s ([2.3]).
- A short stall that holds a direct path's packets for 2s, as on Wi-Fi, costs up to a minute on the relay, and 2.3's PCs were all wired, so the recording counts every move to the relay that came with no network change.

iroh sends on one path at a time ([2.1]), so the core sends no copies over a second path.

## Softening a short gap

A short gap is a stretch in which the following machine gets no flight-model samples although the flying machine sent them: one lost packet, or the 2s in which a dead direct path gives way to the relay.
[The connection](../product/03-v1-scope.md#the-connection) lists three ways to soften one, for the architecture to weigh, and v1 builds the first:

- The following machine carries the aircraft on its last velocities through the gap, and eases it to the true position when samples come again, rather than holding it still and jumping (user, 2026-10-11).
  Through a 2s move to the relay, that's about 1.6s of carrying, the 2s less the 0.4s the following machine draws behind, plus the relay route's extra one-way delay, 0ms to 75ms in 2.3 (arithmetic, [2.3]).
  The flying machine sends samples at a fixed rate even while nothing changes, and marks a stretch in which its sim stopped on purpose, such as a pause or a load, so the following machine carries the aircraft only through a gap the network made; how far it carries before holding, how it eases, and that marker are the flight-model sync's, in its stage of step 8 ([01-spine](../architecture/01-spine.md#parts)).
- Sending the last few samples in each packet, which v1 doesn't build: the following machine draws the aircraft 0.4s in the past ([flight-model sync](../product/03-v1-scope.md#flight-model-sync)), so when one sample is lost, the samples 50ms before and after it, at 2.3's 20 a second, have already arrived to draw between.
  Flight-model samples later than 0.4s came to 0.4% or less in every 2.3 run but one, the friend near New York through the Frankfurt relay at 3% loss, at 1.6% ([2.3]).
- Sending copies through the relay while the direct path is in doubt, which iroh can't do, since it sends on one path at a time ([2.1]).

## While a connection is lost

Once a second, each core times an exchange with each other core on the session stream ([clock offsets](#clock-offsets)), whatever its sim is doing, and that exchange is the heartbeat the core counts.
iroh's path keep-alives don't count, because iroh sends and answers them itself, and the core never sees them.

A core that has heard nothing from a crew member for 5s counts its connection to that member lost.
5s is a starting value, to tune once recordings hold real outages: it sits above the silence a move to the relay causes, the 2s path idle timeout plus the relay route's extra delay ([2.3]), so a move to the relay never counts as a lost connection.

While a core has lost a connection, the session is degraded for it, and no core decides who lost the connection (user, 2026-10-11):

- The PF flies on.
- A PM's synced displays lock, and its aircraft carries on and then holds, as a short gap's does ([above](#softening-a-short-gap)); FS Copilot's pointer sync locks the following pilot's displays during a long outage the same way, and taking control unlocks them ([pointer sync](../product/03-v1-scope.md#pointer-sync)).
- Every pilot's banner lists each crew member with the state of this core's connection to them, and whether this PC reaches the internet, from a fresh request to a relay with a 2s timeout, which informs the pilots and decides nothing.
- Any pilot can take control, as at any time ([take-control key](../product/03-v1-scope.md#take-control-key)), and a PM who does gets a warning that names what follows, such as "James may still be flying. If he is, his aircraft will jump to yours when he reconnects."

The connection comes back on its own: after an outage shorter than iroh's 30s idle timeout for a connection, on the same connection, and after a longer one, through a redial by the core with the lower endpoint ID (read in iroh 1.3.0, `src/socket.rs`, `RELAY_PATH_MAX_IDLE_TIMEOUT` and its comment).
Data arriving again ends the degraded state, and each side resends what the other missed ([below](#reconnecting-and-replaying)).
If control changed while the connection was lost, the later take-control wins, and the other machine follows the new PF; bringing a returning ex-PF's cockpit and aircraft to the new PF's state, over what it flew alone, is node 3's (user, 2026-10-11).

A crew member that a core hasn't heard from for 5 minutes is out of the session for that core.
A PM that has heard from nobody for 5 minutes leaves the session, which is [the connection](../product/03-v1-scope.md#the-connection)'s 5-minute cut-off, and the PF stays in it, so its code still admits a pilot who comes back.

Leave session closes the connection with an application code of ours that only Leave sends, and that close is the goodbye:

- noq lets a peer drop stream data it hasn't delivered once a close arrives (read in noq 1.3.0, `src/connection.rs`, `Connection::close`), so a goodbye message sent just before the close could be lost.
- A process that dies sends no close, or at most one with code 0, which noq sends when every handle to a connection is dropped (read in noq 1.3.0, `src/connection.rs`, the docs of `Connection`), so code 0 and every error QUIC or iroh closes with count as a lost connection, never as a leave.
- Other closes of ours, such as the second of two connections between a pair, carry codes of their own.
- A core that exits awaits iroh's `Endpoint::close`, bounded in time, which resends the closes until each peer acknowledges them (read in iroh 1.3.0, `src/endpoint.rs`, `Endpoint::close`).
- Leave session also tells the backend, which frees the code once the last member has left.

## Reconnecting and replaying

Each core tells the other, on the once-a-second exchange, the last number it applied from it on each stream that resends.
Each core keeps everything it sent on those streams that the other hasn't acknowledged, and the 5-minute cut-off bounds how much that is, about 600 KB at an assumed 20 cockpit changes a second of 100 bytes (arithmetic).
When data flows again, each side resends what the other hasn't acknowledged, and the receiver drops what it already applied.
The one-off channels resend nothing, because the newest sample after the outage replaces what was lost.

With two pilots, a gap in the replay happens only when a sender's core restarted and lost what it kept, and how a restarted core recovers is node 3's ([01-spine](../architecture/01-spine.md#left-open)).
The user prefers replaying what there is over a full catch-up of state as a late joiner gets, which can't restore a display's page or an FMS (user, 2026-10-11).

## A session file after a long outage

A core that starts and finds a session file can't tell how long it was gone, because the file holds no time the core measures with ([01-spine](../architecture/01-spine.md#left-open)).
So it dials the crew's endpoints from the file, and a crew member that answers, which timed the silence on its own clock, tells it whether it's still in the session:

- If it was gone for less than 5 minutes, the core reconnects the pilot as [the connection](../product/03-v1-scope.md#the-connection) says: it replays what they missed if the sim is still on the run the file names, and rejoins them as a late joiner if the sim restarted.
- If it was gone for 5 minutes or more, the session ended for that pilot, the core deletes the file, and the pilot can enter the code again and join as a late joiner.
- If nobody answers, the core asks the backend whether its code still holds the session, deletes the file if it doesn't, and otherwise keeps dialing for 5 minutes from its own start.

## Clock offsets

Each core times one exchange a second with each other core, on the session stream, and estimates the other's offset as NTP does: from the four stamps of an exchange, the offset is ½[(T2 − T1) + (T3 − T4)], and of the last 8 exchanges it keeps the one with the shortest round trip ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
2.3 estimated each PC's counter against our droplets the same way, through the shortest of each eight exchanges, and the estimates scattered by 95µs to 211µs ([2.3]).

- The counters of 2.3's three PCs ran from 13.1 ppm slow to 25.6 ppm fast, so two PCs parted by up to 39 ppm, 3.4s a day, which answers the spine's question of how far they part in practice ([2.3]).
  At 39 ppm, an estimate 8s old is off by 0.3ms (arithmetic).
- A higher restart count from a sender starts its estimate afresh, since the count says its timeline may have changed ([01-spine](../architecture/01-spine.md#times)).
- The estimate assumes both directions take equal time, so it's off by up to half the difference between them, which a relayed connection can make larger than a direct one.
  When the connection moves between paths, the exchange the filter keeps changes, and the offset can step; easing the offset the following machine applies, rather than stepping it, is the flight-model sync's.
  How the take-control key's rule that the earlier press wins copes with that error is node 3's ([01-spine](../architecture/01-spine.md#left-open)).

## Two cores on one PC

A core draws a fresh endpoint key for each session and keeps it in the session file, so a restarted core keeps its endpoint ID, and the backend and the relays can't link one pilot's sessions by an ID that outlives them (user, 2026-10-11).
A development core, with a data folder and session file of its own, gets an endpoint ID of its own, and iroh binds each endpoint to free ports.
Two endpoints in two processes on our development machine, with relays turned off, connected directly over the PC's own address in 2.2ms, and each named the other's endpoint ID ([p04]).

Two cores on one PC link directly and never use the relay, so a development setting builds a core's endpoint with its IP transports cleared, through `Builder::clear_ip_transports()` as 2.3's probe did ([architecture plan, 2.3](../architecture/plan.md#23-a-probe-across-friends-home-networks)), against an `iroh-relay` on the same PC, and CI runs every channel through that relay with injected loss.
FS Copilot's relay dropped every one-off packet, and nobody saw it, because its two instances on one machine punched through to each other and the direct copies carried every test (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The failure that forced this").

## iroh as a dependency

The design leans on values iroh keeps private and a minor release may change: the 60s timer for punching again, the 30s idle timeout on a relay path, the 5s ceiling on a path keep-alive, the 15s ceiling on a path idle timeout, and the two-thirds rule for moving home relay (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `src/socket.rs`, `src/endpoint/quic.rs`, and `src/net_report.rs`).
So Crosscheck pins the exact versions of iroh, noq, and `iroh-relay`, and an upgrade is a change of its own:

1. Read the release notes, and the diff of those values.
2. Change the pins.
3. Run the network tests: two cores on one PC, directly and through a local relay with injected loss, and 2.3's switch, cutting the direct path and timing the move to the relay and back.
4. Upgrade our relays before the release that carries the new iroh, since iroh keeps its wire protocol stable within a major version ([2.1]).

An iroh 2.0 is work of its own.
On Windows, iroh's `bind` hung on about half of one game's players' PCs, which the maintainers put down to CPU-specific build flags in the ring cryptography library, read by a research agent in iroh's issue #3968 ([research report 02](results/2026-10-10-transport-research-reports/02-iroh.txt)).
So a release build targets the baseline x86-64 CPU, and the core binds its endpoint under a timeout and reports a failure rather than hanging.

## Left open

- Who hosts the relays, our own servers or n0's managed relays, whose page lists a tier at "$19/month and up" (documented, [iroh hosting](https://iroh.computer/services/hosting), as of 2026-10-11): the choice changes nothing else, because the relay list is a setting.
  n0's free public relays are out, since n0 calls them "suitable for development and hobby use only" (documented, [public relays](https://docs.iroh.computer/iroh-services/relays/public), as of 2026-10-11).
- How the status list looks, which is for the banner's design, and how a pilot sees which kind of connection they have, which [the connection](../product/03-v1-scope.md#the-connection) leaves to a design for later.
- The 5s, the 2s path idle timeout, the 10-minute renewal, and the ATC buffer's limits, which v1's recordings tune.
- Three probes running on 2.3's droplets: which relay each direction uses when two pilots home at different relays, whether v1's full mix of channels starves the streams on a lossy relay, and how long a connection takes to come back after a full outage.

[2.1]: log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[2.2]: log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[2.3]: log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
