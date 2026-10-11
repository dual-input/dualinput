# Network: between machines

```text
Purpose:     How a session's cores reach each other, the relay, and the backend.
Depends on:  ../architecture/01-spine.md, ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md, log.md
Decides:     The topology, the transport, the way through home routers, the relay and its language, encryption, how a crew finds each other, how each channel travels and tells a copy from a late message, how a core learns another went quiet, which ways to soften a short gap v1 builds, two cores on one PC, a session file found after a long outage, and how a receiver estimates a sender's clock offset.
```

Every pair of cores in a session holds one QUIC connection that iroh 1.3 makes and keeps: directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't.
Our backend turns an invite code into the crew's endpoints, and the relays run n0's `iroh-relay` with nothing of ours on them.
Each channel rides the connection by the delivery it needs: a stream that resends what's lost for messages that must arrive, and one-off packets for what the next message replaces.
This answers node 2 of the [architecture plan](../architecture/plan.md#2-how-the-cores-reach-each-other) from its children's findings in the [network log](log.md): [2.1] chose iroh, [2.2] the encoding, and [2.3] measured iroh across home networks.

The terms:

- iroh is n0's Rust library for QUIC between devices, built on noq, n0's fork of the QUIC library quinn ([2.1]).
- An endpoint is one iroh instance, and its endpoint ID is the public half of its key.
- A path is one way a connection's packets travel, direct or through a relay; a connection keeps several and sends on one.
- A pilot's home relay is the relay their endpoint stays connected to, where other endpoints reach it.
- A one-off packet is a QUIC datagram, which QUIC sends once and never resends.

## The pieces

```text
 Pilot A's core                 one QUIC connection                 Pilot B's core
 iroh endpoint ◀──────────── direct path: UDP ────────────────────▶ iroh endpoint
               ◀── relay path: TCP 443, through the receiver's ───▶
                               home relay
      │                                                                   │
      ├── to its home relay: "what's my public address?"                  │
      └── HTTPS to the backend: invite code ⇄ the crew's endpoints ◀──────┘
```

| Piece | Where it runs | What it does |
| --- | --- | --- |
| iroh endpoint | In each core, one per core, on the core's tokio runtime | Holds the core's identity, a key kept in its data folder; opens and accepts connections; punches holes; asks the router for a port; picks a home relay |
| Relay | n0's `iroh-relay`, unmodified, on servers off the pilots' machines, in at least two regions | Carries a pair's packets when no direct path works, and tells each endpoint its public address |
| Backend | Off the pilots' machines; its candidate is a Cloudflare Worker ([01-spine](../architecture/01-spine.md#components)) | Draws invite codes, keeps each session's crew and their endpoints, and holds bug reports |

## Topology

Each core holds one connection to every other core in the session, and sends each message straight to each receiver, the connection between every pair that [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) leads with.
A v1 session has two pilots, so it has one connection, and a larger crew later adds a connection per pair with nothing rebuilt.
Each sender's streams carry only its own messages, so the first message on its session stream names its pilot ID and restart count ([how a crew finds each other](#how-a-crew-finds-each-other)), and no later message repeats them ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
No core forwards another's messages, and a relay passes iroh's encrypted packets without reading them.

## How a crew finds each other

1. The host's core asks the backend for a code, sending the session's ID, the host's pilot ID, its endpoint ID, and its home relay.
   The backend draws a code that no running session holds, as fsc-editor's relay does ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)), and keeps the session's crew under it.
2. A joining core sends the code with its own pilot ID, endpoint ID, and home relay, and the backend answers with the crew's endpoint IDs and home relays and adds the joiner.
3. The joining core dials each crew member by endpoint ID and home relay, and iroh learns the direct addresses over the connection itself, since it punches toward the addresses the other side advertises on it (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `trigger_holepunching`).
4. The first message on the new connection's session stream carries the sender's pilot ID, restart count, Crosscheck version, and the message crate's hash, and a core refuses a join whose version or hash differs from its own, saying who is behind ([tentative decisions](../architecture/decisions.md#every-first-message-carries-one-version-number-and-a-hash-of-the-message-crate)).

A core accepts a connection only from an endpoint ID the backend lists in its session's crew.
iroh's TLS 1.3 handshake checks the accepting core's key against the endpoint ID the dialer asked for, and has the dialing core sign with its own key, so each side knows the other's endpoint ID (read in iroh 1.3.0, `src/tls/verifier.rs`, `verify_server_cert` and `verify_client_cert`).

Each core refreshes its place in the crew with the backend every 60s, and tells it at once when its home relay changes or its pilot presses Leave session.
The backend counts a pilot out of the crew after 5 minutes with no refresh, and drops the session and frees its code once the crew is empty, so the code lasts until the last pilot leaves, as the [invite code](../product/03-v1-scope.md#invite-code) requires.
The backend limits how fast one address can try codes, as fsc-editor's Worker allows 20 join attempts a minute from each IP address ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)).

The backend's requests and answers are the message crate's, as JSON with ts-rs's types for the backend's TypeScript, as every message sent as JSON is ([tentative decisions](../architecture/decisions.md#messages-are-defined-in-one-rust-crate-json-typed-by-ts-rs-for-typescript-fixed-width-structs-in-data-slots-and-length-prefixed-binary-to-the-helper)).
The relays speak iroh's own protocol, and nothing of ours.

## The way through home routers

iroh punches holes inside QUIC, asks the router for a port through UPnP, NAT-PMP, and PCP, prefers IPv6, and punches again when either side's addresses change ([2.1]).
A connection starts on whichever path answers first, usually the relay, and moves to a direct path once one works, so nobody waits on hole punching.
Across two friends' home networks and ours, every connection between real routers went direct ([2.3]).
That included two routers that let in only replies and answered no UPnP, because both keep one public port for every destination.
Connections opened in a median 24ms to 159ms, and those that went direct moved to it in a median 42ms to 316ms.
A simulated router that picks a new public port for each destination was reached directly only from the router whose UPnP opened a port ([2.3]).

The installer adds a Windows Firewall rule that lets the core receive, so no pilot meets Windows' prompt, and none blocks the core by dismissing it.

Wi-Fi, carrier-grade NAT, double NAT, and mobile links are unmeasured, since 2.3's three PCs were all wired at home.
v1 records each session's path, loss, and relay stalls in the recording that bug reports carry, which tells how many pilots end up relayed, far from the relay their packets go through, and on lossy links (user, 2026-10-10).

## The relays

A relay runs n0's `iroh-relay`, in Rust, unmodified, which settles the relay's language the [spine](../architecture/01-spine.md#between-machines) left to this node.
We run relays in at least two regions (user, 2026-10-11), and their list is a setting in the app, so a group can point Crosscheck at relays of its own, as [01-aims](../product/01-aims.md#relay-and-license) asks.

Each endpoint measures its latency to every relay in the list, keeps each one's best latency from the last 5 minutes, and makes the fastest its home relay, moving to another only when that one's latency is under two-thirds of the current one's (read in iroh 1.3.0, `src/net_report.rs`, `add_report_history_and_set_preferred_relay`).
So each pilot homes at the relay nearest them, chosen by latency and never by cost, as [the connection](../product/03-v1-scope.md#the-connection)'s rule that flight data wins asks.
A relayed packet goes to the receiver's home relay (read in iroh 1.3.0, `src/lib.rs`), so packets sent to a pilot cross the shortest leg the relay list allows, and the sender's leg is the long one when the two pilots are far apart.
A pair on two continents has that long leg whatever relays run, and more regions shorten both legs for a pair in one region.

A relay carries everything over one TCP connection per pilot, so it loses nothing, and a lost packet holds back everything behind it until TCP resends it ([2.1]).
The hold-up grows with the pilot's round trip to the relay: at 3% loss, iroh's p99 lateness was 53ms at 22ms away, 264ms at 42ms, 346ms at 97ms, and 534ms at 131ms, where a UDP relay under the same loss lost about 3% and stayed within 81ms ([2.3]).
v1 accepts that, with an adaptive buffer for ATC audio (user, 2026-10-10).
So when a relayed ATC host's link loses packets and their crewmate's home relay is far from them, as for a pair on two continents or a host far from every relay we run, the crewmate hears ATC more than 300ms late.
A readback the host gives on Discord the moment the call ends can then reach the crewmate before the call does ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).

## Encryption

QUIC encrypts every packet with TLS 1.3 and has no mode that doesn't, so Crosscheck builds nothing for encryption, as it needn't (user, 2026-10-09).
It costs about 30 bytes of QUIC's own per packet, in the 58 bytes every packet carries before any message ([2.2]).
The same handshake proves each core's endpoint ID, [above](#how-a-crew-finds-each-other).

## Channels on the connection

| Channel | Carried as | Copies and late messages | Priority |
| --- | --- | --- | --- |
| Session | A stream from each sender | Applied in order; a receiver drops a message at or below the last number it applied from that sender | Above every other stream |
| Cockpit | A stream from each sender | Causal order across senders ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)); telling a copy from a late message is node 3's ([01-spine](../architecture/01-spine.md#left-open)) | Below the session's |
| Flight model | One-off packets, one sample each | A receiver drops a sample whose stamp isn't later than the newest it applied from that sender | Ahead of every stream |
| Avatars | One-off packets, one pose each | The newest pose of each figure, by stamp | Ahead of every stream |
| Traffic | Each object's identity on a stream; samples as one-off packets in batches | Identities in order, as the session's; each object's newest sample by the time it was read | Identities below the cockpit's; samples ahead of every stream |
| ATC audio | One-off packets, one 20ms Opus frame each, numbered | Played in number order behind an adaptive buffer; a frame that arrives after its turn is dropped | Ahead of every stream |

- QUIC builds each packet from what's waiting when it builds it: queued one-off packets first, then stream data, until the packet is full (read in noq-proto 1.3.0, `src/connection/mod.rs`, `populate_packet`).
  So the core hands over what one sim frame produced together, and a cockpit change rides in the packet with the next flight-model sample, saving the 58 bytes of headers a packet of its own would take ([2.2]).
- Streams take strict priority through `SendStream::set_priority` (read in noq 1.3.0, `src/send_stream.rs`), and bulk transfers after v1, such as a profile sent to a pilot who lacks it, take the lowest and are paced ([2.1]).
- QUIC drops queued one-off packets only to make room, oldest first (read in noq 1.3.0, `src/connection.rs`, `send_datagram`), so the core drops a waiting flight-model sample itself as soon as a newer one is ready.
- A batch of traffic samples stays under `Connection::max_datagram_size`, which the core reads as it sends; postcard's batch of 23 aircraft took 945 bytes ([2.2]).
- Every message between cores is postcard ([2.2]).
  Which fields each message carries, which changes its size more than the format does, is for the parts that design the messages: node 3 for the cockpit's, and the flight-model sync for its samples ([2.2]).
- A message's stamp is µs on its sender's counter, and its sender's restart count, which the sender's first message names, tells the receiver when that counter's timeline may have changed ([01-spine](../architecture/01-spine.md#times)).

## Paths

The core sets iroh's path idle timeout to 2s and its path keep-alive to 0.67s, a third of the timeout, as 2.3 ran them ([2.3]):

- A direct path that goes silent is dropped after 2s, and the connection moves to the relay path, which stays open.
  In 2.3, the move came 2.0s after the drop every time, and no move happened that a drop didn't cause, across 55 connections in each run.
- In those 2s, streams resend over the relay what the dead path swallowed, and one-off packets sent into it are lost.
  The following aircraft holds still through the gap and jumps when data returns, which [the connection](../product/03-v1-scope.md#the-connection) accepts for v1.
- iroh punches again at once when the operating system reports a network change, and otherwise every 60s, so the connection is back on a direct path within 60s of one working again ([2.3]).
- The keep-alive also holds each router's mapping open: one friend's router forgot an idle port within 30s ([2.3]).

iroh sends on one path at a time ([2.1]), so the core sends no copies over a second path.

## Softening a short gap

[The connection](../product/03-v1-scope.md#the-connection) lists three ways to soften a short gap for the architecture to weigh, and v1 builds none of them:

- Copies through the relay while the direct path is in doubt, because iroh sends on one path at a time.
- The last few samples in each packet, because the following machine draws the aircraft 0.4s in the past ([flight-model sync](../product/03-v1-scope.md#flight-model-sync)), so when one sample is lost, the samples 50ms before and after it, at 2.3's 20 a second, have already arrived to draw between.
  Flight-model samples later than 0.4s came to 0.4% or less in every 2.3 run but one, the far relay at 3% loss, at 1.6% ([2.3]).
- Carrying the aircraft on its last velocities and easing it to the true position, which belongs to the flight-model sync, since v1 accepts the aircraft holding still.

## How a core learns another went quiet

During a session, packets cross every connection both ways many times a second: flight-model samples one way, avatar poses both ways, and the path keep-alive every 0.67s.
So silence is the signal.

- A core counts another cut off once nothing has come from it for 5s, a starting value above the 2s move to the relay, to tune once recordings hold real outages.
  [The connection](../product/03-v1-scope.md#the-connection)'s rules then run: the cut-off pilot's displays lock, the banner says so, and control passes to the PM if the PF was cut off.
- A pilot who presses Leave session sends a goodbye on the session stream, the core closes the connection with QUIC's close and an application code of ours, and it waits for that close to go out before it exits, since a goodbye queued on the way out never leaves ([09-06](../../learn/foundations/09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
- After 30s with nothing on any path, iroh closes the connection, its default idle timeout for a connection, which iroh gives its relay path too (read in iroh 1.3.0, `src/socket.rs`, `RELAY_PATH_MAX_IDLE_TIMEOUT` and its comment).
  The core goes on dialing the cut-off core by endpoint ID and home relay, and asks the backend for its home relay again when a dial fails, until the 5-minute cut-off.
- An endpoint homes only at a relay that answered its latest measurement (read in iroh 1.3.0, `src/net_report.rs`), so a relay that goes down moves its pilots to the next nearest, and the core records the move.
- When the backend can't be reached, a pilot can't start or join a session, and the core says so; a running session doesn't need the backend.

## Reconnecting and replaying

A connection that opens again under the same restart count, which its first message names, is the same core back from an outage ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
That first message also names, for the session and cockpit streams, the last number its core applied from the other, and each side resends the rest of what it kept; the receiver drops what it already applied.
Each core keeps the last 5 minutes of what it sent on those two streams, which [03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage)'s replay needs, about 130 KB at an assumed 5 cockpit changes a second of 84 bytes (arithmetic).
The one-off channels resend nothing, because the newest sample after the outage replaces what was lost.

## A session file after a long outage

A core that starts and finds a session file asks the backend whether its pilot is still in the crew.
The file can't say how long the core was gone, because it holds no time the core measures with ([01-spine](../architecture/01-spine.md#left-open)).
The backend can, because it timed the gap since that core's last refresh on its own clock.

- If the pilot was out for 5 minutes or more, the session ended for them, and the core deletes the file; the pilot can enter the code again and join as a late joiner.
- If not, the core reconnects the pilot as [the connection](../product/03-v1-scope.md#the-connection) says: it replays what they missed if the sim is still on the run the file names, and rejoins them as a late joiner if the sim restarted.
- If the backend can't be reached, the core keeps the file and asks again.

## Clock offsets

Each core times one exchange a second with each other core, on the session stream, and estimates the other's offset as NTP does: from the four stamps of an exchange, the offset is ½[(T2 − T1) + (T3 − T4)], and of the last 8 exchanges it keeps the one with the shortest round trip ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
2.3 estimated each PC's counter against our droplets the same way, through the shortest of each eight exchanges, and the estimates scattered by 95µs to 211µs ([2.3]).

- The counters of 2.3's three PCs ran from 13.1 ppm slow to 25.6 ppm fast, so two PCs parted by up to 39 ppm, 3.4s a day, which answers the spine's question of how far they part in practice ([2.3]).
  At 39 ppm, an estimate 8s old is off by 0.3ms (arithmetic).
- A higher restart count from a sender starts its estimate afresh, since the count says its timeline may have changed ([01-spine](../architecture/01-spine.md#times)).
- The estimate assumes both directions take equal time, so it's off by up to half the difference between them, which a relayed pair's two directions, through two different relays, can make larger than a direct pair's.
  How the take-control key's rule that the earlier press wins copes with that error is node 3's ([01-spine](../architecture/01-spine.md#left-open)).

## Two cores on one PC

A core keeps its key in its data folder, so a development core beside a pilot's has an endpoint ID of its own, and iroh binds each endpoint to free ports.
Two endpoints in two processes on our development machine, with relays turned off, connected directly over the PC's own address in 2.2ms, and each named the other's endpoint ID ([p04]).

## Left open

- Who hosts the relays, our own servers or n0's managed relays, whose page lists a tier at "$19/month and up" (documented, [iroh hosting](https://iroh.computer/services/hosting), as of 2026-10-11): the choice changes nothing else, because the relay list is a setting.
  n0's free public relays are out, since n0 calls them "suitable for development and hobby use only" (documented, [public relays](https://docs.iroh.computer/iroh-services/relays/public), as of 2026-10-11).
- How a pilot sees which kind of connection they have, which [the connection](../product/03-v1-scope.md#the-connection) leaves to a design for later.
- The 5s cut-off, the 2s path idle timeout, and the ATC buffer's limits, which v1's recordings tune.

[2.1]: log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[2.2]: log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[2.3]: log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
