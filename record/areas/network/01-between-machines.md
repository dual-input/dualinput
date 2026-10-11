# Network: between machines

```text
Purpose:     How a session's cores reach each other, the relay, and the backend.
Depends on:  ../architecture/01-spine.md, ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md, log.md
Decides:     The topology, the transport, the way through home routers, the relay and its language, encryption, how a crew finds each other, how each channel travels and tells a copy from a late message, what a session does while a connection is lost, which ways to soften a short gap v1 builds, two cores on one PC, a session file found after a long outage, and how a receiver estimates a sender's clock offset.
```

Every pair of cores in a session holds one QUIC connection that iroh 1.3 makes and keeps: directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't.
Our backend turns an invite code into the crew's endpoints when a pilot joins, and no running session waits on it; the relays run n0's `iroh-relay` with nothing of ours on them.
Each channel rides the connection by the delivery it needs: a stream that resends what's lost for messages that must arrive, and one-off packets for what the next message replaces.
When a core hears nothing from a crew member for 5s, the session is degraded for it: the PF flies on, a PM who has lost the flying machine locks its displays, every pilot sees whom they can reach, and any pilot can take control, with a warning, and no core decides who lost the connection.
This answers node 2 of the [architecture plan](../architecture/plan.md#2-how-the-cores-reach-each-other) from its children's findings in the [network log](log.md): [2.1] chose iroh, [2.2] the encoding, and [2.3] measured iroh across home networks.

The terms:

- iroh is n0's Rust library for QUIC between devices, built on noq, n0's fork of the QUIC library quinn ([2.1]).
- An endpoint is one iroh instance, and its endpoint ID is the public half of its key, which other endpoints dial.
- A path is one way a connection's packets travel, direct or through a relay; a connection keeps several and sends on one.
- A pilot's home relay is the relay their endpoint stays connected to, where other endpoints reach it.
- A one-off packet is a QUIC datagram, which QUIC sends once and never resends.
- A control generation is the count of take-controls in a session, which every take-control raises ([while a connection is lost](#while-a-connection-is-lost)).

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
| Every core | On each pilot's PC | Its iroh endpoint, under a key drawn fresh for each session; a connection to every other crew member; the channels and the one scheduler that sends them; replay after an outage; clock offsets; the degraded state; recording each connection's path, loss, and relay stalls, and each sender's clock offset |
| The flying machine's core | The PF's PC | What 03-v1-scope already gives it: the flight model, the flight controls, and the aircraft's authority; nothing more for the connection |
| Relay | n0's `iroh-relay`, unmodified, on servers off the pilots' machines, in at least two regions | Carries a pair's packets when no direct path works, tells each endpoint its public address, and admits only Crosscheck |
| Backend | Off the pilots' machines; its candidate is a Cloudflare Worker ([01-spine](../architecture/01-spine.md#components)) | Draws invite codes and maps each to the crew's endpoints, limits code guessing, serves the relay list, and holds bug reports; nothing a running session waits on |

## Topology

Each core holds one connection to every other core in the session and sends each message straight to each receiver, the connection between every pair that [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) leads with.
A v1 session has two pilots, so it has one connection, and a larger crew later adds a connection per pair.

A core keys everything it keeps about a sender, its message numbers, what it applied, its clock offset, and its replay position, by the sender's pilot ID and restart count, never by a connection or an endpoint.
In v1 every message reaches its receiver from its own sender, so the sender names itself once, in its first message on the connection ([how a crew finds each other](#how-a-crew-finds-each-other)).
A later feature that forwards others' messages, such as a feed to passengers, carries each message's pilot ID and restart count with it, the spine's form for a link that carries several senders' messages ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)), and nothing built for v1 changes.

Two cores hold one connection, not two, and when a second opens, the rule that picks which stays doesn't depend on which side is still alive:

- A connection whose first message names a higher restart count for its pilot than an open one replaces it at once, because the other side's core restarted and the old connection is dead.
- Between two connections that passed their first message under the same restart count, the one the lower endpoint ID dialed stays, and if one core dialed both, the newer stays.
- A connection whose first message hasn't arrived within 10s closes, and counts in neither rule.
- The connection a rule closes carries an application code of its own.

In our FS Copilot work, two connections between one pair carried every packet twice, and a duplicate arriving at the same instant pulled the traffic receiver's delay estimate down until the aircraft stuttered (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", item 5).

## How a crew finds each other

1. The host's core asks the backend for a code, sending the session's ID, the session's relay list with each relay's token, and the host's pilot ID, display name, endpoint ID, home relay, Crosscheck version, and message crate hash.
   The backend draws a code that no live session holds, as fsc-editor's relay does ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)), and keeps the session under it.
2. A joining core sends the code with the same details of its own.
   If its version or hash differs from the session's, the backend refuses and names who is behind, in its own answer, before anyone dials ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
   Otherwise it answers with the session's ID, its relay list and tokens, and each member's pilot ID, display name, kind, endpoint ID, and home relay, and lists the joiner as pending.
3. The joining core adds to its endpoint any relay of the session's list it lacks, and dials every member at once, by endpoint ID and home relay; iroh learns the direct addresses over the connection, since it punches toward the addresses the other side advertises on it (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `trigger_holepunching`).
4. Each side's first message on the connection opens with a header that no release changes, holding Crosscheck's version and the message crate's hash, followed by the session's code, the sender's pilot ID and restart count, and its current home relay and direct addresses.
   A core accepts a connection whose first message carries its session's code, version, and hash, and closes any other with an application code that says why.
   Until that first message has passed, it ignores the connection's one-off packets, which QUIC can deliver before the first stream data.
5. The core that accepted the joiner tells the backend, which lists the joiner as a member; a pending joiner nobody confirms drops off the list after 10 minutes.

A session uses one relay list, the one its host started with, because iroh presents a relay's token only to relays in its own list (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `start_active_relay`), and a relay with tokens refuses a client without one, so two pilots whose lists differ couldn't reach each other's home relays.
A core adds a relay to its running endpoint with `Endpoint::insert_relay` (read in iroh 1.3.0, `src/endpoint.rs`).

The code is the credential: it admits a pilot with no approval, as [the invite code](../product/03-v1-scope.md#invite-code) rules, and it crosses only inside QUIC's encryption and the backend's HTTPS.
A joiner counts as a crew member, and shows in the crew, only once its first message has passed, because FS Copilot counted a handshake that later failed as a peer and locked the pilot's panels for 5 minutes ([09-06](../../learn/foundations/09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
Each member's kind is crew in v1, and the field leaves room for passengers later.

On the session stream, members tell each other whom they're connected to, each member's current home relay and direct addresses whenever they change, and who left, so pilots who joined at once find each other, a redial reaches a member whose address changed, and a member who can't reach a leaver still learns of the leave.
Each core keeps the crew's latest addresses, and the session's relay list and tokens, in its session file.

The backend keeps a session only as long as its crew uses it, and no running session waits on it:

- Each core renews its place every 10 minutes, with its current home relay, and the backend drops a member that hasn't renewed for 30 minutes.
- Leave session tells the backend at once, and the backend frees the code once its last member has left or lapsed.
- The backend limits how many wrong codes one address can try, as fsc-editor's Worker limits join attempts per IP address ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)), counting only wrong codes, since carrier-grade NAT puts many pilots behind one address ([network log, 2026-10-06](log.md#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month)).
- Each request about a session carries a signature by the core's endpoint key, and the backend keys members by endpoint ID and binds each pilot ID to the endpoint ID it first registered with, so nobody else can renew or leave in that pilot's name.
- The backend's requests and answers are JSON, with the message crate's types and a version of the backend's own, and the backend serves each version still in pilots' hands, since one backend serves every Crosscheck release in use.

A pilot coming back to a session dials the crew at the addresses its session file keeps, with the relay list and tokens the file also keeps, so the return needs no backend, and asks the backend by code only if no one answers.
The relays speak iroh's own protocol, and nothing of ours.

## The way through home routers

iroh punches holes inside QUIC, asks the router for a port through UPnP, NAT-PMP, and PCP, prefers IPv6, and punches again when either side's addresses change ([2.1]).
From each of two friends' home networks to ours, 10 of 10 connections went direct, including from a router that lets in only replies and answered no UPnP, because both it and ours keep one public port for every destination ([2.3]).
The two friends' routers were never paired with each other, because 2.3's test between friends failed in the build they ran.
Connections opened in a median 24ms to 159ms, about one round trip to a relay, which fits a connection that starts through the relay (inference), and those that went direct moved to it in a median 42ms to 316ms ([2.3]).
A simulated router that picks a new public port for each destination was reached directly only from the friend near New York, whose router answered UPnP, which would let in the ports it mapped (inference, [2.3]).

The installer adds a Windows Firewall rule, for every network profile, that lets the program at the core's install path receive, and an update keeps that path.
When the core looks for its own rule, it compares paths without regard to letter case, because the rules 2.3's tester read held its path in a letter case other than its own ([2.3]).
Whether the installer must also remove a block rule left by a dismissed prompt, which would win over its allow rule if Windows ranks block rules first (unverified), a clean install that dismisses the prompt settles.

Wi-Fi, carrier-grade NAT, double NAT, and mobile links are unmeasured, since 2.3's three PCs were all wired at home.
v1 records each connection's path, loss, and relay stalls in the recording that bug reports carry, which tells how many pilots end up relayed, far from the relay their packets cross, and on lossy links (user, 2026-10-10).

## The relays

A relay runs n0's `iroh-relay`, in Rust, unmodified, which settles the relay's language the [spine](../architecture/01-spine.md#language-and-toolchains) left to this node.
We run relays in at least two regions (user, 2026-10-11).
The backend serves the default relay list with each relay's token, and the core keeps both in its data folder.
A setting overrides the list, so a group can point Crosscheck at relays of its own, as [01-aims](../product/01-aims.md#relay-and-license) asks.

A core builds its endpoint from iroh's `presets::Minimal`, with `RelayMode::Custom` and the session's relay list, as 2.3's probe did ([2.3]).
iroh's `presets::N0` would publish each pilot's endpoint ID and home relay to n0's DNS for the whole session (read in iroh 1.3.0, `src/endpoint/presets.rs`), and an endpoint bound with relays turned off never gets a relay at all ([2.3]).

Our relays admit only Crosscheck (user, 2026-10-11).
Each relay's configuration lists one or more shared tokens, and admits only a client that presents one (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig::SharedToken`), and a core presents the token the backend served with that relay.
That keeps other iroh applications off our relays, though not someone who reads the token out of a running Crosscheck, and listing two tokens at once lets us change it without cutting anyone off, as long as the old one stays listed longer than the longest session.
Each relay also caps how fast one client can send (read in iroh-relay 1.3.0, `src/main.rs`, `limits.client.rx`), and a client at the cap waits on everything it sends through that relay ([research report 02](results/2026-10-10-transport-research-reports/02-iroh.txt)), so the cap sits above v1's peak, with a burst at least the size of a replay, both from the network's build ([left open](#left-open)).

Each endpoint picks its home relay by latency, never by cost, as [the connection](../product/03-v1-scope.md#the-connection)'s rule that flight data wins asks (read in iroh 1.3.0, `src/net_report.rs`):

- At start, on a major network change, and every 5 minutes, it probes the first 5 relays in its map, which iroh orders by URL (read in iroh-relay 1.3.0, `src/relay_map.rs`), and stops once 3 have answered, or all of them if there are fewer; in between, it measures only the relay it holds a probe connection to.
- It keeps each relay's best latency from the last 5 minutes, homes at the fastest, and moves to another only when that one's latency is under two-thirds of the current one's.

So with v1's two relays, each pilot starts at the nearer, and moves only when the other answers in under two-thirds of the time.

A relayed packet goes to the receiver's home relay, unless the sender already holds a connection to a relay where it has heard from the receiver (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `active_relay_handle_for_endpoint`).
So when two pilots home at different relays, their two directions may cross one relay or two, which nobody has measured and nothing in this design depends on.

A relay carries everything over one TCP connection per pilot, so it loses nothing, and a lost packet holds back everything behind it until TCP resends it ([2.1]).
The hold-up grows with the sender's round trip to the relay: at 3% loss, iroh's p99 lateness was 53ms at 22ms away, 264ms at 42ms, 346ms at 97ms, and 534ms at 131ms, where a UDP relay under the same loss lost about 3% and stayed within 81ms ([2.3]).
v1 accepts that, with an adaptive buffer for ATC audio (user, 2026-10-10).
At 3% loss through a relay 97ms to 131ms from the sender, the worst 1% of ATC frames came 337ms to 534ms late, and 6% to 11% came more than 170ms late; at 1% loss, the worst 1% came 168ms to 184ms late ([2.3]; p03's digest, `experiments/areas/network/results/p03-home-networks-2026-10-10/analysis/digest.txt`).
So a crewmate of a relayed ATC host on a lossy link, far from the relay their packets cross, hears some calls later than the 300ms at which the host's readback on Discord would overtake them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).

## Encryption

QUIC encrypts every packet with TLS 1.3 and has no mode that doesn't, so Crosscheck builds nothing for encryption, as it needn't (user, 2026-10-09).
QUIC's own header and frames, the encryption's tag among them, take about 30 of the 58 bytes every packet carries before any message ([2.2]).
iroh's handshake checks the accepting core's key against the endpoint ID the dialer asked for, and has the dialing core sign with its own key, so each side knows the other's endpoint ID (read in iroh 1.3.0, `src/tls/verifier.rs`, `verify_server_cert` and `verify_client_cert`).

## Channels

A channel declares who sends it, as a role such as the flying machine or as every machine; who receives it; its delivery, every message in order, the newest value of each key, or the lowest delay with loss acceptable; its priority; and whether it joins the cockpit's shared order, as [04-room-for-later](../product/04-room-for-later.md#channels) asks.
The core keeps a registry of the channels a session runs:

- A channel that joins the cockpit's shared order, such as a later bus bridge, rides the cockpit stream, each message tagged with its channel, under the stream's one number per sender and one vector clock, because QUIC keeps no order across streams, and its messages replay with the cockpit's.
- Every other channel rides a stream or one-off packets of its own, and each stream opens with its channel's number, as each one-off packet carries it.
- A channel's number stands for a stable name, its kind and instance, which the sender announces on the session stream before it uses the number.
- A receiver drops a one-off packet with a number it doesn't know, and stops a stream with one, without closing the connection, since a plugin's channel exists only where that plugin runs.
- A channel's priority comes from its kind, so no plugin's channel outranks the flight model.

A plugin opens instances of the kinds of channel Crosscheck provides, object mirroring and audio capture, such as a GSX plugin mirroring GSX's vehicles, and defines no kind of its own (user, 2026-10-11; [04-room-for-later](../product/04-room-for-later.md#plugins)).

v1's channels:

| Channel | From | Carried as | Copies and late messages | Priority |
| --- | --- | --- | --- | --- |
| Session | Every machine | A stream from each sender | Applied in order; a receiver drops a message at or below the last number it applied from that sender | Above every other stream |
| Cockpit | Every machine | A stream from each sender | Causal order across senders ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)); telling a copy from a late message is node 3's ([01-spine](../architecture/01-spine.md#left-open)) | Below the session's |
| Catch-up | The flying machine | A stream to the catching-up machine | In order | Below the cockpit's |
| Flight model | The flying machine | One-off packets, one sample each, at a fixed rate | A receiver drops a sample whose stamp isn't later than the newest it applied from that sender, or whose control generation is older than the newest it knows | Ahead of every stream |
| Flight controls | The flying machine | One-off packets, at the flight model's rate, each with the yoke, rudder, and toe-brake positions the flying aircraft applied | The same as the flight model's | Ahead of every stream |
| Avatars | Every machine | One-off packets, one pose each | The newest pose of each figure, by stamp | Ahead of every stream |
| Traffic | The traffic host | Each object's identity on a stream; samples as one-off packets in batches | Identities in order, as the session's; each object's newest sample by the time it was read | Identities below the cockpit's; samples ahead of every stream |
| ATC audio | The ATC host | One-off packets, one 20ms Opus frame each, numbered | Played in number order behind an adaptive buffer; a frame that arrives after its turn is dropped | Ahead of every stream |

- The session channel also carries what preflight and the crew need from each machine: the PF's position and stand, the match check's comparison, Ready, the countdown, the time, date, simulation rate, and pause, take-control, a sim crash or a flight left, and the members' addresses ([03-v1-scope](../product/03-v1-scope.md#a-session-from-start-to-finish)).
- The catch-up stream carries the flying machine's state object when a cockpit catches up ([03-catch-up](../sync/03-catch-up.md#catching-up-state)), apart from the cockpit stream so a catch-up never holds back live changes.
- The flight controls ride a channel of their own because the yoke and rudder move nearly every frame while the PF hand-flies, which would flood the cockpit stream and its replay, and a fixed rate means the PF's values overwrite any yoke input of the PM's within a sample (user, 2026-10-11).
  They carry the positions the flying aircraft applied, so a later feature that mixes the PM's input into the flying machine's adds a channel toward it and changes nothing the following machines read.
- The PF's engine levers and trim move far less often, so they stay entries on the cockpit stream, owned by the PF, and the following machine writes the PF's last value back at once when its own sim reports that the PM moved one, which keeps [the take-control key](../product/03-v1-scope.md#take-control-key)'s rule that the PM's hardware can't hold them away (user, 2026-10-11).
  A change to a PF-owned entry, like each flight-model and flight-controls sample, carries the control generation it was made under.

Sending:

- noq queues one-off packets in order, sends the oldest first, and drops the oldest, of any channel, only to make room for a new one (read in noq-proto 1.3.0, `src/connection/datagrams.rs`), so a traffic batch could push out a flight sample, and a newer sample waits behind stale ones.
  So the core sets that queue's size in bytes to a few packets of 1,162 bytes each (`QuicTransportConfigBuilder::datagram_send_buffer_size`, read in iroh 1.3.0, `src/endpoint/quic.rs`), and hands a packet to QUIC only when `Connection::datagram_send_buffer_space` shows room (read in iroh 1.3.0, `src/endpoint/connection.rs`).
  Until then it holds, for each connection, channel, and key a channel names, only the newest packet: the newest sample, each figure's newest pose, each traffic batch's newest copy.
  ATC frames wait in a short queue of their own, each dropped once its turn to play has passed.
- One scheduler for the whole core drains those slots and queues by priority, across every connection a core holds, and gives every channel a share, so the streams are never shut out.
  Whether one-off packets starve the streams on a lossy relay, and whether the slots prevent it, is unmeasured, and the network's build checks it before it sets the shares ([left open](#left-open)).
- QUIC builds each packet from what's waiting when it builds it: queued one-off packets first, then stream data, until the packet is full (read in noq-proto 1.3.0, `src/connection/mod.rs`, `populate_packet`).
  The core hands over what one sim frame produced together, though whether two messages handed over together share one packet is unmeasured.
- A batch of traffic samples stays under 1,162 bytes, the one-off packet's size at QUIC's starting packet size ([research digest](results/2026-10-10-transport-research-digest.txt)), not the size a path has discovered.
  A relayed packet crosses links that each discover their size separately, so FS Copilot sized its budget to the floor (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The MTU floor"), and noq drops a queued one-off packet that outgrows a shrunken path without saying so (read in noq-proto 1.3.0, `src/connection/datagrams.rs`, `drop_oversized`).
- While the relay path carries a connection, the core paces a replay, a catch-up, and every bulk transfer after v1, such as a profile sent to a pilot who lacks it, below the relay's cap, summed over every connection through that relay, since they all share the pilot's one TCP connection to it; iroh's relay lost no packets in 2.3, so QUIC would see no loss to slow down for (inference, [2.3]).
- Every message between cores is postcard ([2.2]).
  Which fields each message carries, which changes its size more than the format does, is for the parts that design the messages: node 3 for the cockpit's, and the flight-model sync for its samples ([2.2]).
- A message's stamp is µs on its sender's counter, and its sender's restart count, which the sender's first message names, tells the receiver when that counter's timeline may have changed ([01-spine](../architecture/01-spine.md#times)).

## Paths

The core sets iroh's path idle timeout to 2s and its path keep-alive to 0.67s, a third of the timeout, as 2.3 ran them ([2.3]):

- For 2s after a direct path dies, iroh keeps sending on it, so nothing arrives.
  Then the connection moves to the relay path, which stays open, and one-off packets sent into the dead path stay lost ([2.3]).
  Streams resend over the relay what the dead path swallowed, which 2.3 didn't record (unverified).
- In 2.3, where a firewall cut the direct path mid-session, flight-model samples came again through the relay 2.0s after the cut every time, and no move happened that a cut didn't cause, across 55 connections in each run ([2.3]).
- iroh punches again at once when it counts an operating-system network change as major (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `handle_msg_network_change`), and otherwise every 60s, so the connection is back on a direct path within 60s of one working again ([2.3]).
- The keep-alive also holds each router's mapping open: one friend's router forgot an idle port within 30s ([2.3]).
- A stall that holds a direct path's packets for 2s trips the path idle timeout, and the connection then stays on the relay until iroh's next 60s punch finds the direct path again, so a 2s stall can cost up to a minute of relaying (inference, [2.3]).
  2.3's PCs were all wired and saw no such stall, so the recording counts every move to the relay that came with no network change.

iroh sends on one path at a time ([2.1]), so the core sends no copies over a second path.

## Softening a short gap

A short gap is a stretch in which the following machine gets no flight-model samples although the flying machine sent them: one lost packet, or the 2s in which a dead direct path gives way to the relay.
[The connection](../product/03-v1-scope.md#the-connection) lists three ways to soften one, for the architecture to weigh, and v1 builds the first:

- The following machine carries the aircraft on its last velocities through the gap, and eases it to the true position when samples come again, rather than holding it still and jumping (user, 2026-10-11).
  Through a 2s move to the relay, that's about 1.6s of carrying, the 2s less the 0.4s the following machine draws behind, plus the relay route's extra one-way delay, 0ms to 75ms in 2.3 (arithmetic, [2.3]).
  The flying machine sends samples at a fixed rate even while nothing changes, and marks a stretch in which its sim stopped on purpose, such as a pause or a load, so the following machine carries the aircraft only through a gap the network made; how far it carries before holding, how it eases, and that marker are the flight-model sync's, in its stage of step 8 ([01-spine](../architecture/01-spine.md#parts)).
- Sending the last few samples in each packet, which v1 doesn't build: the following machine draws the aircraft 0.4s in the past ([flight-model sync](../product/03-v1-scope.md#flight-model-sync)), so when one sample is lost, the samples 50ms before and after it, at 2.3's 20 a second, have already arrived to draw between.
  In the friends' runs, flight-model samples later than 0.4s came to 0.4% or less in every run but one, the friend near New York through Frankfurt at 3% loss, at 1.6%; in our own run, with loss on both legs, they reached 1.1% in one direction and 2.7% in the other through New York at 3% ([2.3]; p03's digest).
  Those late samples were held back by the relay's TCP, not lost, so copies of them in later packets would arrive no sooner.
- Sending copies through the relay while the direct path is in doubt, which iroh can't do on one connection, since it sends on one path at a time ([2.1]).

## While a connection is lost

Any packet from a crew member, one-off packets included, tells a core that the member is there, and the once-a-second exchange on the session stream ([clock offsets](#clock-offsets)), which each core sends whatever its sim is doing, guarantees one at least that often.
iroh's path keep-alives don't count, because iroh sends and answers them itself, and the core never sees them.

A core that has heard nothing from a crew member for 5s counts its connection to that member lost, and counts it back once two exchanges have come within 2s, so a link that flaps doesn't flicker the degraded state.
5s is a starting value, to tune once recordings hold real outages.
It sits above the silence a move to the relay caused for one-off packets in 2.3, the 2s path idle timeout plus the relay route's extra delay ([2.3]), so a move to the relay shouldn't count as a lost connection; whether the session stream also recovers within it is unmeasured, and the network's build checks it ([left open](#left-open)).

While a core has lost a connection, the session is degraded for it, and no core decides who lost the connection (user, 2026-10-11):

- The PF flies on.
- A PM that has lost the flying machine locks its synced displays, and its aircraft carries on and then holds, as a short gap's does ([above](#softening-a-short-gap)); FS Copilot's pointer sync locks the following pilot's displays during a long outage the same way, and taking control unlocks them ([pointer sync](../product/03-v1-scope.md#pointer-sync)).
  A lost connection to any other member only marks that member, which matters once crews pass two.
- Every pilot's banner lists each crew member with the state of this core's connection to them, and whether this PC reaches the internet, from a fresh request to a relay with a 2s timeout, which informs the pilots and decides nothing.
- Any pilot whose role may hold control can take it, as at any time ([take-control key](../product/03-v1-scope.md#take-control-key)), and a PM who does gets a warning that names what follows, such as "James may still be flying. If he is, his aircraft will jump to yours when he reconnects."

A take-control raises the control generation to one past the highest its taker has seen, and of two take-controls with the same generation, the one by the lower pilot ID wins, so every machine compares the same two numbers and reaches the same answer, where comparing the moments of two presses through each machine's own clock estimate could order them differently on two machines.
When a connection comes back:

1. Each side's first message after the outage carries the control generation and PF it holds, and control settles on the higher generation before either side sends or applies any replay.
2. The side whose control lost drops what it sent on the cockpit stream under the losing generation and hasn't had acknowledged, and a receiver drops samples and changes to PF-owned entries made under an older generation than the newest it knows.
3. Bringing a returning ex-PF's cockpit and aircraft to the new PF's state, over what it flew alone, is node 3's (user, 2026-10-11).

A PF who leaves the flight, for the main menu or another flight, passes control to the PM, which the PF's core announces on the session stream, as [the connection](../product/03-v1-scope.md#the-connection)'s rules for a pilot who leaves the flight say.
A PF whose sim crashes passes nothing, because Crosscheck recovers from a crash (user, 2026-10-11): the PF's core, which stays up, tells the crew the sim crashed, the PM's machine locks and holds as when it has lost the flying machine, its banner names the crash, and the PM can take control, with no warning, since a crashed sim flies nothing.
How the crashed PF's aircraft and cockpit come back, as PF if nobody took control, is node 3's.

After an outage shorter than iroh's 30s idle timeout for a connection, which its relay path matches (read in iroh 1.3.0, `src/socket.rs`, the comment on `RELAY_PATH_MAX_IDLE_TIMEOUT`), the same connection comes back on its own.
After a longer one, both cores redial, the one with the higher endpoint ID 2s after the other, at the latest addresses each heard on the session stream, with every relay in the session's list as a way in, and [the topology's rule](#topology) settles a second connection.
A redial that only one side made could fail for good: in FS Copilot a link that went dark never came back on its own (FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-12 — A blackholed peer link never comes back on its own").

A crew member that a core hasn't heard from for 5 minutes is out of the session for that core.
A PM that has heard from nobody for 5 minutes leaves the session, which is [the connection](../product/03-v1-scope.md#the-connection)'s 5-minute cut-off.
A PF never leaves on its own: it keeps redialing until its pilot presses Leave session, so its code still admits a pilot who comes back, and two machines that each took control during an outage find each other again when the network returns (user, 2026-10-11).

Leave session closes the connection with an application code of ours that only Leave sends, and that close is the goodbye:

- noq lets a peer drop stream data it hasn't delivered once a close arrives (read in noq 1.3.0, `src/connection.rs`, `Connection::close`), so a goodbye message sent just before the close could be lost.
- Closing Crosscheck any other way, from the tray, by a Windows shutdown or logoff, or for an update, closes each connection with a quit code of ours before `Endpoint::close`, and the others treat a quit as a Leave (user, 2026-10-11).
- A process that dies sends no close, or at most one with code 0, which noq sends when every handle to a connection is dropped (read in noq 1.3.0, `src/connection.rs`, the docs of `Connection`), so code 0 and every error QUIC or iroh closes with count as a lost connection, never as a leave.
- Other closes of ours, such as one [the topology's rule](#topology) makes, carry codes of their own.
- A core that exits awaits iroh's `Endpoint::close`, bounded in time, which resends the closes until each peer acknowledges them (read in iroh 1.3.0, `src/endpoint.rs`, `Endpoint::close`).
- Leave session also tells the backend, which frees the code once the last member has left, and the session stream tells any member who can't reach the leaver.

## Reconnecting and replaying

On a connection that survives an outage, QUIC resends its streams' unacknowledged data itself, and the core resends nothing.
On a new connection after a longer outage, the core resends what the other side lacks.

Each core tells every other, on the once-a-second exchange, the last number it applied from each sender on each stream that resends.
Each core keeps every sender's messages on those streams that it applied, its own included, until every current member has acknowledged them, and the 5-minute cut-off bounds how much that is, about 600 KB at an assumed 20 cockpit changes a second of 100 bytes (arithmetic).
On a new connection, each side sends the other what it lacks from any sender, and the receiver drops what it already applied.
With two pilots, that's what each sent, and with more, a member's replay comes from whoever kept it, so a message whose sender left still reaches a member who missed it.
The one-off channels resend nothing, because the newest sample after the outage replaces what was lost.

A receiver applies any backlog, whether QUIC or the core resent it, paced by the senders' stamps as [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage)'s replay is, and how the replay paces state entries against events and presses is node 3's.
A gap in the replay happens only when a core that kept messages restarted and lost them, and how a restarted core recovers is node 3's ([01-spine](../architecture/01-spine.md#left-open)).
The user prefers replaying what there is over a full catch-up of state as a late joiner gets, which can't restore a display's page or an FMS (user, 2026-10-11).

## A session file after a long outage

A core that starts and finds a session file can't tell how long it was gone, because the file holds no time the core measures with ([01-spine](../architecture/01-spine.md#left-open)).
So it dials the crew at the addresses in the file, and a crew member that answers, which timed the silence on its own clock, tells it whether it's still in the session:

- If it was gone for less than 5 minutes, the core reconnects the pilot as [the connection](../product/03-v1-scope.md#the-connection) says: it replays what they missed if the sim is still on the run the file names, and rejoins them as a late joiner if the sim restarted.
- If it was gone for 5 minutes or more, the session ended for that pilot, the core deletes the file, and the pilot can enter the code again and join as a late joiner.
- If nobody answers, the core asks the backend whether its code still holds the session, deletes the file if it doesn't, and otherwise keeps dialing for 5 minutes from its own start.

Crosscheck installs no update while a session file exists.
Otherwise it installs a waiting update when the sim closes, and a crash closes the sim too, so a core could restart mid-session on a new version that can't rejoin a crew still on the old one ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).

## Clock offsets

Each core times one exchange a second with each other core, on the session stream, and estimates the other's offset as NTP does: from the four stamps of an exchange, the offset is ½[(T2 − T1) + (T3 − T4)], and of the last 8 exchanges it keeps the one with the shortest round trip ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
2.3 estimated each PC's counter against our droplets the same way, through the shortest of each eight exchanges, and the estimates scattered by 95µs to 249µs ([2.3]; p03's digest).

- The counters of 2.3's three PCs ran from 13.4 ppm slow to 25.8 ppm fast, so two PCs parted by up to 39 ppm, 3.4s a day, which answers the spine's question of how far they part in practice ([2.3]; p03's digest).
  At 39 ppm, an estimate 8s old is off by 0.3ms (arithmetic).
- A higher restart count from a sender starts its estimate afresh, since the count says its timeline may have changed ([01-spine](../architecture/01-spine.md#times)).
- The estimate assumes both directions take equal time, so it's off by up to half the difference between them, which a relayed connection can make larger than a direct one.
  When the connection moves between paths, the exchange the filter keeps changes, and the offset can step; easing the offset the following machine applies, rather than stepping it, is the flight-model sync's.
- The recording keeps each sender's offset estimate and restart count once a second, so a bug report's recordings line up in time ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).

## Two cores on one PC

A core draws a fresh endpoint key for each session and keeps it in the session file, so a restarted core keeps its endpoint ID, and the backend and the relays can't link one pilot's sessions by an ID that outlives them (user, 2026-10-11).
A development core, with a data folder and session file of its own, gets an endpoint ID of its own, and iroh binds each endpoint to free ports.
Two endpoints in two processes on our development machine, with relays turned off, connected directly over the PC's own address in 2.2ms, and each named the other's endpoint ID ([p04]).

Two cores on one PC link directly, so tests between them never exercise the relay unless they force it.
FS Copilot's relay dropped every one-off packet, and nobody saw it, because its two instances on one machine punched through to each other and the direct copies carried every test (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The failure that forced this").
So a development setting builds a core's endpoint with its IP transports cleared, through `Builder::clear_ip_transports()` as 2.3's probe did ([architecture plan, 2.3](../architecture/plan.md#23-a-probe-across-friends-home-networks)), against an `iroh-relay` on the same PC with the production token and cap, and CI runs the network's tests through it:

- every channel through the relay with injected loss;
- a core suspended for 60s, and a core killed and restarted;
- the relay both cores home at taken down for 40s, and a core's home relay moved;
- two relays, with the two cores' lists different before they join;
- a take-control during a cut, and the reconnect after it.

## iroh as a dependency

The design leans on values iroh keeps private and a minor release may change: the 60s timer for punching again, the 30s idle timeout for a connection, which its relay path matches, the 5s ceiling on a path keep-alive, the 15s ceiling on a path idle timeout, and the two-thirds rule for moving home relay (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `src/socket.rs`, `src/endpoint/quic.rs`, and `src/net_report.rs`).
So Crosscheck pins the exact versions of iroh, noq, and `iroh-relay`, and an upgrade is a change of its own:

1. Read the release notes, and the diff of those values.
2. Change the pins.
3. Run the network tests, and 2.3's switch, cutting the direct path and timing the move to the relay and back.
4. Upgrade our relays before the release that carries the new iroh, since iroh keeps its wire protocol stable within a major version ([2.1]).

An iroh 2.0 is work of its own.
On Windows, iroh 0.96.1's `bind` hung on about half of one game's players' PCs, and the maintainers put it down to CPU-specific build flags in the ring cryptography library and closed the issue as not planned (documented in iroh's issue #3968, as [research report 02](results/2026-10-10-transport-research-reports/02-iroh.txt) summarizes it; unverified on iroh 1.3).
So a release build targets the baseline x86-64 CPU, and the core binds its endpoint under a timeout and reports a failure rather than hanging.

## Left open

- Who hosts the relays, our own servers or n0's managed relays, whose page lists a tier at "$19/month and up" (documented, [iroh hosting](https://iroh.computer/services/hosting), as of 2026-10-11): the choice changes nothing else, because the relay list is a setting.
  n0's free public relays are out, since n0 calls them "suitable for development and hobby use only" (documented, [public relays](https://docs.iroh.computer/iroh-services/relays/public), as of 2026-10-11).
- How the status list looks, which is for the banner's design, and how a pilot sees which kind of connection they have, which [the connection](../product/03-v1-scope.md#the-connection) leaves to a design for later.
- The 5s, the 2s path idle timeout, the 10-minute renewal, the relay's cap, and the ATC buffer's limits, which v1's recordings tune.
- Checks for the network's stage of step 8, which tune the network layer without changing this design (user, 2026-10-11), and which the probes p05 to p07, running on 2.3's droplets as of 2026-10-11, may answer first:
  - v1's full mix of channels through iroh's relay at 1% and 3% loss, with and without the newest-only slots, measuring how late the session and cockpit streams arrive, since the session stream carries take-control and the heartbeat;
  - how long the session stream takes to carry data again after a direct path dies, against the 5s;
  - how long a connection takes to carry data again after outages of 10s to 120s, which is how long a PM stays locked once the network is back;
  - v1's peak rate through a relay, for its cap.

[2.1]: log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[2.2]: log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[2.3]: log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
