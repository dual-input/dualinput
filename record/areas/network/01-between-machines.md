# Network: between machines

```text
Purpose:     How a session's cores reach each other, the relay, and the backend.
Depends on:  ../architecture/01-spine.md, ../product/01-aims.md, ../product/03-v1-scope.md, ../product/04-room-for-later.md, ../sync/02-live-sync.md, ../sync/03-catch-up.md, log.md
Decides:     The topology, the transport, the way through home routers, the relay and its language, encryption, how a crew finds each other, how each channel travels and tells a copy from a late message, how control travels, what a session does while a link is lost and when it comes back, which ways to soften a short gap v1 builds, two cores on one PC, and how a receiver estimates a sender's clock offset.
```

> **Note**
> Since 2026-10-11, a sim that closes, by a crash or by its pilot, counts as leaving the flight, so a PF whose sim crashes passes control to the PM at once, and the pilot comes back as a late joiner; this replaces [control](#control)'s rule that a crash passes nothing, and what [leaving](#leaving) compares with it is the PM's machine having lost the flying machine ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-sim-that-closed)).
> A replay needs no shortening beyond skipping all but the last of each run of PF-owned changes, since its 2s cap on each gap bounds it at 2s a change, and a test that stops syncing an entry the aircraft drives itself keeps one from filling it, so [coming back](#coming-back)'s promise rests on nothing more of node 3's ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-replay)).
> Since 2026-10-11, each change of control carries its maker's vector clock, and a receiver drops the superseded PF's messages only when that clock doesn't include them, live or in a replay, which replaces [control](#control)'s rule that drops them when they reach a receiver in a replay; every machine that applied one catches up from the new PF ([04-order-and-recovery](../sync/04-order-and-recovery.md#a-change-of-control)).
> The heartbeat's acknowledgment is the receiver's vector clock, a cockpit message carries no number beside its clock, and it names its entry and its clock's counters in full ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)); a receiver merges traffic's identity set rather than replacing its own, since a copy with no sample for 15s is removed, and its identity forgotten ([roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
> Since 2026-10-12, the session channel's keys hold no time of day or date, which leave v1, and a machine sends each state entry's newest value at most 20 times a second, which caps a lever that jitters with no dead zone, though the 58P's six engine levers jittering at once could still send 120 changes a second against the 5 to 20 this document assumes ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream)).
> Since 2026-10-14, a feature whose messages must apply in order with the cockpit's registers kinds on the cockpit stream rather than a channel, so no channel declares whether it joins the cockpit's shared order, as [channels](#channels) below has one do, and a cockpit message carries its kind and no channel's tag; and the traffic host and the ATC host are two session keys, which one request claims together ([02-code-map](../architecture/02-code-map.md#what-a-feature-registers)).
>
> Since 2026-10-12, a core that restarts while its sim keeps running comes back as a late joiner, with a catch-up and no replay ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)), where [a session file after a long outage](#a-session-file-after-a-long-outage) gives it a replay when the sim is still on the run the file names.
>
> Since 2026-10-16, [02-units](02-units.md) changes this document in five places:
>
> - The heartbeat carries the clock exchange alone, and the cockpit-stream crate acknowledges on a one-off channel of its own once a second, where [channels](#channels) has the heartbeat carry the acknowledgment.
> - A channel declares its delivery and priority, each send names its receivers, and the receiving handler checks who may send, where [channels](#channels) has a channel declare who sends and receives it.
> - Our relays run on two servers of ours, DigitalOcean droplets in New York and Frankfurt, which settles [left open](#left-open)'s item on who hosts them.
> - The backend is a Cloudflare Worker on D1, which [who does what](#who-does-what) calls a candidate.
> - In the CI tests that [two cores on one PC](#two-cores-on-one-pc) describes, a proxy that holds bytes back stands in for a relay's loss, and [left open](#left-open)'s check of v1's full mix on a direct path under loss runs by hand on our droplets.
>
> Since 2026-10-17, [flight-model sync](../flight-model/01-flight-model-sync.md) changes this document in two places:
>
> - A flight-model sample carries its control value's generation alone, its PF being its sender, where [channels](#channels) and [control](#control) have it carry the whole value; and a following machine drops a sample under a newer value until the control key arrives, where control has a receiver adopt a newer value met on a sample.
> - [The following machine](../flight-model/01-flight-model-sync.md#the-following-machine) settles what [softening a short gap](#softening-a-short-gap) and [clock offsets](#clock-offsets) leave to flight-model sync, and carries the aircraft along the line through its last two samples, where softening a short gap carries it on its last velocities.
>
> Since 2026-10-17, the seat claims that [channels](#channels) lists among the session channel's keys ride avatars' poses on the avatars channel, each pose carrying the whole figure, since avatars, partly recorded, writes no session key ([the pose](../avatars/01-avatars.md#the-pose)).
> Since 2026-10-17, how the status list looks, which [left open](#left-open) gives to the banner's design, waits for the apps' stage, and node 6.16 settles only how the apps reach the network's and the session's slices ([the apps](../interface/01-apps.md#left-to-the-apps-stage)).

Every pair of cores in a session holds one QUIC connection that iroh 1.3 makes and keeps: directly when hole punching gets through both pilots' routers, and through one of our relays when it doesn't.
Our backend turns an invite code into the crew's endpoint IDs when a pilot joins, and no running session waits on it; the relays run n0's `iroh-relay` with nothing of ours on them.
Four models carry the rest:

- **One state machine per link:** up; lost after 5s of silence, on which the core closes the connection and redials; up again once a new connection's first message passes; and disconnected after 30 minutes without a connection.
  Every return is the same sequence: a new connection whose first message carries the session's state whole, then the cockpit stream's replay.
- **One replayed log, the cockpit's.** Everything else that must arrive is state, sent as the newest value of each key, and whole on each new connection.
- **One control value,** a generation and the PF's pilot ID, raised by every change of PF, which every machine compares the same way; every message that depends on who flies carries it, and the session's shared settings are stamped the same way.
- **No address tracking:** a core reaches a crew member by endpoint ID through every relay in the session's list, and iroh finds the direct path itself.

This answers node 2 of the [architecture plan](../architecture/plan.md#2-how-the-cores-reach-each-other) from its children's findings in the [network log](log.md): [2.1] chose iroh, [2.2] the encoding, and [2.3] measured iroh across home networks, and [p04] to [p07] settled what the design leaned on.

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
               ◀──── relay path: TCP 443, through the dialed ──▶
                          pilot's home relay
      │                                                                 │
      ├── to its home relay: "what's my public address?"                │
      └── HTTPS to the backend, when joining: code ⇄ crew's endpoints ◀─┘
```

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Every core | On each pilot's PC | Its iroh endpoint, under a key drawn fresh for each session; a connection to every other crew member, and each link's state; the channels and what sends them; the session's state and the replay when a link comes back; clock offsets; recording each connection's path, loss, and relay stalls, and each sender's clock offset |
| The flying machine's core | The PF's PC | What 03-v1-scope already gives it: the flight model and the aircraft's authority; nothing more for the connection |
| Relay | n0's `iroh-relay`, unmodified, on servers off the pilots' machines, in at least two regions | Carries a pair's packets when no direct path works, tells each endpoint its public address, and admits only Crosscheck |
| Backend | Off the pilots' machines; its candidate is a Cloudflare Worker ([01-spine](../architecture/01-spine.md#components)) | Draws invite codes and maps each to the crew's endpoint IDs, limits code guessing, and holds bug reports; nothing a running session waits on |

## The link between two cores

Each core holds one connection to every other core in the session and sends each message straight to each receiver, the connection between every pair that [02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order) leads with.
A v1 session has two pilots, so it has one connection, and a larger crew later adds a connection per pair.
A core keys everything it keeps about a sender, its message numbers, what it applied, its clock offset, and its replay position, by the sender's pilot ID and restart count, never by a connection or an endpoint.
In v1 every message reaches its receiver from its own sender, so the sender names itself once, in its first message on the connection, and a later feature that forwards others' messages carries each one's pilot ID and restart count with it, the spine's form for a link that carries several senders' messages ([01-spine](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).

Each link has one state, as its core sees it:

| State | When | What the core does |
| --- | --- | --- |
| Up | A connection's first message has passed ([joining](#joining)) | Sends and receives |
| Lost | Nothing on the connection for 5s | Closes the connection with an application code of ours and redials; the session is degraded ([while a link is lost](#while-a-link-is-lost)) |
| Up again | A new connection's first message, which carries the session's state, has passed | Sends the replay ([coming back](#coming-back)) |
| Disconnected | 30 minutes without a connection to that member | Counts the member out of the session; a core disconnected from every member leaves the session itself ([coming back](#coming-back)) |

A core closes a lost connection rather than waiting for it, because a fresh connection carried data 0.3s to 1.4s after a total outage ended, while one that lived through a 10s outage took 5s to 7s ([p07]).
At iroh's default path timers, that connection's QUIC was waiting out the probes it had backed off; at v1's, why it waited is unverified, and the relay's TCP connection backing off its resends would fit ([p07]).
So every return takes one path, a new connection, whatever the outage's length.

Any packet on a connection, one-off packets included, counts as hearing from its member, and the heartbeat channel ([channels](#channels)), which each core sends once a second whatever its sim is doing, guarantees one at least that often.
iroh's path keep-alives don't count, because iroh sends and answers them itself, and the core never sees them.
5s is a starting value, to tune once recordings hold real outages: it sits above the 2s a dead direct path takes to give way to the relay, after which packets came again at once ([2.3]).

A joining core dials every member.
When a link is lost, both cores redial, each running one dial at a time and starting a new one every 2s in place of the last, because every dial still running when the link returns connects, up to 15 of them within 6.5s ([p07]).
When two connections between a pair both pass their first message, each side picks the one that stays from what it knows itself, so both pick the same one however the two dials raced:

- A first message with a higher restart count than an existing connection's closes that connection, because its pilot's core restarted and dropped it.
- Of two connections from the same restart, the one the lower endpoint ID dialed stays, comparing the two IDs as numbers, which both sides hold; of two the same side dialed, the newer stays, since a core dials a member only while it holds no connection to them.
  The rule needs nothing a cut puts in doubt, such as who is PF.
- A connection with nothing on it for 5s closes, as any lost one does, which clears one whose other side dropped it without the close arriving.
- A connection whose first message hasn't arrived within 10s closes.
- Each close carries an application code of its own.

In our FS Copilot work, two connections between one pair carried every packet twice, and a duplicate arriving at the same instant pulled the traffic receiver's delay estimate down until the aircraft stuttered (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", item 5).

## Joining

1. The host's core draws its key and asks the backend for a code, sending the session's ID, the session's relay list with each relay's token, and the host's pilot ID, display name, endpoint ID, Crosscheck version, and message crate hash.
   The backend draws a code that no live session holds, as fsc-editor's relay does ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)), and keeps the session under it.
2. A joining core draws its key and looks up the code.
   If its version or hash differs from the session's, the backend refuses and names who is behind, before anyone dials ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
   Otherwise it answers with the session's ID, its relay list and tokens, and each member's pilot ID, display name, kind, and endpoint ID, and lists nobody new.
3. The joining core builds its endpoint with exactly the session's relays, so it homes at one of them, and dials each member by endpoint ID with every relay in that list.
   Until a connection has chosen a path, iroh sends its first packets to every address it knows (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `handle_msg_send_datagram`), and an endpoint's address holds several relays at once (read in iroh-base 1.3.0, `src/endpoint_addr.rs`), so the dial reaches the member through whichever relay it homes at, and iroh learns the direct addresses over the connection itself (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `trigger_holepunching`).
4. Each side's first message on a connection opens the session channel's stream with a header that no release changes, holding Crosscheck's version and the message crate's hash, followed by the session's code, the sender's pilot ID and restart count, and every key of the session channel the sender holds, its own member entry and control among them.
   A core accepts a connection whose first message carries its session's code, version, and hash, and closes any other with an application code that says why.
   Until that first message has passed, it applies nothing else from the connection: neither its other streams, which QUIC keeps no order with, nor its one-off packets, which QUIC can deliver before the first stream data.
   So every receiver knows the session's state, and who flies, before anything that depends on them.
5. Once its first message has passed with any member, the joining core registers itself with the backend, which then lists it.

A session uses one relay list, its host's, because iroh presents a relay's token only to relays in its own list (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `start_active_relay`), and a relay with tokens refuses a client without one, so two pilots whose lists differed couldn't reach each other's home relays.
Building the joiner's endpoint from that list makes one list per session true by construction.

The code is the credential: it admits a pilot with no approval, as [the invite code](../product/03-v1-scope.md#invite-code) rules, and it crosses only inside QUIC's encryption and the backend's HTTPS.
A joiner counts as a crew member, and shows in the crew, only once its first message has passed, because FS Copilot counted a handshake that later failed as a peer and locked the pilot's panels for 5 minutes ([09-06](../../learn/foundations/09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
Each member's kind is crew in v1, and the field leaves room for passengers later.

The backend keeps a session only as long as its crew uses it, and no running session waits on it:

- Each core renews its place every 10 minutes, and the backend drops a member that hasn't renewed for 30 minutes.
- Leave session tells the backend at once, and the backend frees the code once its last member has left or lapsed.
- The backend limits how many wrong codes one address can try, as fsc-editor's Worker limits join attempts per IP address ([09-04](../../learn/foundations/09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)), counting only wrong codes, since carrier-grade NAT puts many pilots behind one address ([network log, 2026-10-06](log.md#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month)).
- Each request a core makes about itself carries a signature by its endpoint key, and the backend keys members by endpoint ID, so nobody else can register, renew, or leave in a pilot's name.
- The backend's requests and answers are JSON, with the message crate's types and a version of the backend's own, and the backend serves each version still in pilots' hands, since one backend serves every Crosscheck release in use.

The session file keeps the crew's endpoint IDs and the session's relay list and tokens, so a returning core dials the crew with no backend, and asks the backend by code only if nobody answers.
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
Each release of Crosscheck carries the default relay list, each entry with its URL, its token, and the rate it caps a client at (user, 2026-10-11).
A setting overrides the list, so a group can point Crosscheck at relays of its own, as [01-aims](../product/01-aims.md#relay-and-license) asks, and a session uses the list its host started with ([joining](#joining)).

A core builds its endpoint from iroh's `presets::Minimal`, with `RelayMode::Custom` and the session's relay list, as 2.3's probe did ([2.3]).
iroh's `presets::N0` would publish each pilot's endpoint ID and home relay to n0's DNS for the whole session (read in iroh 1.3.0, `src/endpoint/presets.rs`), and an endpoint bound with relays turned off never gets a relay at all ([2.3]).

Our relays admit only Crosscheck (user, 2026-10-11).
Each relay's configuration lists one or more shared tokens, and admits only a client that presents one (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig::SharedToken`), and a core presents the token its relay list carries.
That keeps other iroh applications off our relays, though not someone who reads the token out of Crosscheck.
A session's members all run one release ([joining](#joining)), so they all hold its tokens, and a token changes only with a release, after which a relay lists the old token and the new one until the old release is out of use.
`iroh-relay` reads its tokens only when it starts, and reloads only its certificates (read in iroh-relay 1.3.0, `src/main.rs`), so a change of tokens restarts the relay, as an upgrade does, and a restart drops every relayed connection through it until a redial lands, which waits for the dialed core's home relay connection to come back, as long as 23.8s after a link outage in [p07]; we restart relays at a quiet hour.
Each relay also caps how fast one client can send (read in iroh-relay 1.3.0, `src/main.rs`, `limits.client.rx`), above v1's live traffic, and the core paces everything it sends through a relay below the cap its list gives ([sending](#sending)).

Each endpoint picks its home relay by latency, never by cost, as [the connection](../product/03-v1-scope.md#the-connection)'s rule that flight data wins asks (read in iroh 1.3.0, `src/net_report.rs`):

- At start, on a major network change, and every 5 minutes, it probes the first 5 relays in its map, which iroh orders by URL (read in iroh-relay 1.3.0, `src/relay_map.rs`), and stops once 3 have answered, or all of them if there are fewer; in between, it measures only the relay it holds a probe connection to.
- It keeps each relay's best latency from the last 5 minutes, homes at the fastest, and moves to another only when that one's latency is under two-thirds of the current one's.

So with v1's two relays, each pilot starts at the nearer, and moves only when the other answers in under two-thirds of the time.
Both directions of a relayed connection cross the home relay of the endpoint that was dialed ([p05]), so which relay a relayed pair runs through follows from which dial [the link's rule](#the-link-between-two-cores) keeps.

A relay carries everything over one TCP connection per pilot, so it loses nothing, and a lost packet holds back everything behind it until TCP resends it ([2.1]).
With the loss on the sender's link, the hold-up grew with the sender's round trip to the relay: at 3% loss, iroh's p99 lateness was 53ms at 22ms away, 264ms at 42ms, 346ms at 97ms, and 534ms at 131ms, where a UDP relay under the same loss lost about 3% and stayed within 81ms ([2.3]).
TCP resends across the leg that lost the packet, so loss on the receiver's link would grow with the receiver's round trip instead (inference), and whether a relayed pair would gain from a relay chosen nearer one pilot turns on which pilot's link loses packets, which v1's recordings show.
Every channel shares that lateness, streams and one-off packets alike, since QUIC never saw a lost packet through the relay: at 1% and 3% loss, the cockpit stream's p99 came within 17ms of the flight model's, and nothing a sender does with its channels changed when they arrived ([p06]).
v1 accepts that, with an adaptive buffer for ATC audio (user, 2026-10-10).
At 3% loss through a relay 97ms to 131ms from the sender, the worst 1% of ATC frames came 337ms to 534ms late, and 6% to 11% came more than 170ms late; at 1% loss, the worst 1% came 168ms to 184ms late ([2.3]; p03's digest, `experiments/areas/network/results/p03-home-networks-2026-10-10/analysis/digest.txt`).
So a crewmate of a relayed ATC host on a lossy link, far from the relay their packets cross, hears some calls later than the 300ms at which the host's readback on Discord would overtake them ([hearing ATC](../product/03-v1-scope.md#hearing-atc)).

## Encryption

QUIC encrypts every packet with TLS 1.3 and has no mode that doesn't, so Crosscheck builds nothing for encryption, as it needn't (user, 2026-10-09).
QUIC's own header and frames, the encryption's tag among them, take about 30 of the 58 bytes every packet carries before any message ([2.2]).
iroh's handshake checks the accepting core's key against the endpoint ID the dialer asked for, and has the dialing core sign with its own key, so each side knows the other's endpoint ID (read in iroh 1.3.0, `src/tls/verifier.rs`, `verify_server_cert` and `verify_client_cert`).

## Channels

A channel declares who sends it, as a role such as the flying machine or as every machine; who receives it; its delivery, every message in order, the newest value of each key, or the lowest delay with loss acceptable; its priority; and whether it joins the cockpit's shared order, as [04-room-for-later](../product/04-room-for-later.md#channels) asks.

- v1's channels have fixed numbers in the message crate, whose hash both sides check, and each stream opens with a header naming its channel, so no stream waits on an announcement made on another.
- A channel that joins the cockpit's shared order, such as a later bus bridge, rides the cockpit stream, each message tagged with its channel, under the stream's one number per sender and one vector clock, because QUIC keeps no order across streams.
- A plugin opens instances of the kinds of channel Crosscheck provides, object mirroring and audio capture, such as a GSX plugin mirroring GSX's vehicles, and defines no kind of its own (user, 2026-10-11; [04-room-for-later](../product/04-room-for-later.md#plugins)).
  A plugin's instance announces its number and stable name on the session channel; a receiver drops a one-off packet with a number it doesn't know, since a plugin's channel exists only where that plugin runs, and a channel's priority comes from its kind.

The cockpit stream is the one log a link replays.
Everything else that must arrive is state: the session channel and traffic's identities carry the newest value of each key, and each sends all of its keys again on a new connection, the session channel's in the first message, so a returning core never replays a stale pause or sim-rate change.

| Channel | From | Carried as | Copies and late values | Priority |
| --- | --- | --- | --- | --- |
| Session | Every machine | A stream from each sender, the newest value of each key, all of them again in a new connection's first message | A receiver keeps each key's value with the highest stamp (below) | Above every other stream |
| Cockpit | Every machine | A stream from each sender, the one replayed log | Causal order across senders ([02-live-sync](../sync/02-live-sync.md#one-stream-in-causal-order)); telling a copy from a late message is node 3's ([01-spine](../architecture/01-spine.md#left-open)) | Below the session's |
| Catch-up | The flying machine | A stream to the catching-up machine, started again on a new connection | In order | Below the cockpit's |
| Flight model | The flying machine | One-off packets, one sample each, at a fixed rate | A receiver drops a sample whose stamp isn't later than the newest it applied from that sender, or that was made under a control value older than the newest it knows | Ahead of every stream |
| Avatars | Every machine | One-off packets, one pose each | The newest pose of each figure, by stamp | Ahead of every stream |
| Traffic | The traffic host | Each object's identity on a stream, the newest value of each, the whole set again on a new connection; samples as one-off packets in batches | Each object's newest identity, a new connection's set replacing the receiver's so an object the sim removed during a cut goes, and each object's newest sample by the time it was read | Identities below the cockpit's; samples ahead of every stream |
| ATC audio | The ATC host | One-off packets, one 20ms Opus frame each, numbered | Played in number order behind an adaptive buffer; a frame that arrives after its turn is dropped | Ahead of every stream |
| Heartbeat | Every machine | One-off packets, one a second | Each carries a clock exchange ([clock offsets](#clock-offsets)) and the last number its sender applied from each sender on the cockpit stream | Ahead of every other channel |

- The session channel's keys are the session's state: the control value ([control](#control)); each member's entry, its pilot ID, display name, kind, and endpoint ID, which it writes itself; Ready, the countdown, and seat claims; the traffic host and the ATC host; the time, date, simulation rate, and pause; the PF's position and stand; the match check's comparison; a sim crash or a flight left; the plugin channel instances; and whom each member is connected to and who left ([03-v1-scope](../product/03-v1-scope.md#a-session-from-start-to-finish)).
  A core dials any member it learns of from another's entry and holds no connection to, so two pilots who join at the same moment, each listed by the backend without the other, still find each other.
- Every key but control carries a stamp: the control value its writer held, a number one past the highest its writer has seen on that key, and the writer's pilot ID.
  A receiver keeps the value with the highest stamp, comparing control values first, as [control](#control) orders them, then the numbers, with the lower pilot ID winning a tie.
  So of two changes to a key several pilots write, such as active pause, made at once or during a cut, every machine keeps the same one.
  A key only one member writes, such as its entry, its Ready, or whom it's connected to, needs nothing more, since each of its writer's changes stamps higher than the last.
- A core that takes control writes every session-wide key again, every key that isn't one member's own, under the new control value, so nothing the ex-PF set during a cut, such as a sim rate or a pause, outranks the new PF's session, as its cockpit messages don't ([control](#control)).
  A key added later is either one member's own or session-wide, and the rule covers it either way.
- The flight-model sample also carries the yoke, rudder, and toe-brake positions the flying aircraft applied, which move nearly every frame while the PF hand-flies and would flood the cockpit stream and its replay; the fixed rate means the PF's values overwrite any yoke input of the PM's within a sample, and a later feature that mixes the PM's input adds a channel toward the flying machine and changes nothing the following machines read (user, 2026-10-11).
  Which fields the sample carries is the flight-model sync's.
- The PF's engine levers and trim move far less often, so they stay entries on the cockpit stream, owned by the PF, and the following machine writes the PF's last value back at once when its own sim reports that the PM moved one, which keeps [the take-control key](../product/03-v1-scope.md#take-control-key)'s rule that the PM's hardware can't hold them away (user, 2026-10-11).
- Every cockpit message and every flight-model sample carries the control value it was made under, its generation and its PF ([control](#control)).

### Sending

- noq queues one-off packets in order, sends the oldest first, and drops the oldest, of any channel, only to make room for a new one (read in noq-proto 1.3.0, `src/connection/datagrams.rs`), so a traffic batch could push out a flight sample, and a newer sample could wait behind stale ones.
  So the core sets that queue's size in bytes to a few packets of 1,162 bytes each (`QuicTransportConfigBuilder::datagram_send_buffer_size`, read in iroh 1.3.0, `src/endpoint/quic.rs`), and hands a packet to QUIC only when `Connection::datagram_send_buffer_space` shows room (read in iroh 1.3.0, `src/endpoint/connection.rs`).
  Until then it holds only the newest packet for each connection, channel, and key a channel names, such as each figure's newest pose and each traffic batch's newest copy, and ATC frames wait in a short queue of their own, each dropped once its turn to play has passed.
  It hands them over in a fixed order: the heartbeat, the flight model, ATC audio, avatars, then traffic.
- On iroh's relay those slots changed nothing, because QUIC saw no loss there and its queue never held more than 361 bytes ([p06]); on a direct path, where QUIC sees losses itself and narrows its congestion window, they would keep a stale sample from waiting (unverified), which a check in [left open](#left-open) settles.
- noq orders the streams by `SendStream::set_priority` (read in noq 1.3.0, `src/send_stream.rs`), and QUIC builds each packet from what's waiting, queued one-off packets first, then stream data, until the packet is full (read in noq-proto 1.3.0, `src/connection/mod.rs`, `populate_packet`).
- A batch of traffic samples stays under 1,162 bytes, the one-off packet's size at QUIC's starting packet size ([research digest](results/2026-10-10-transport-research-digest.txt)), not the size a path has discovered.
  A relayed packet crosses links that each discover their size separately, so FS Copilot sized its budget to the floor (FS Copilot fork, `record/traffic-atc/docs/04-transport.md`, "The MTU floor"), and noq drops a queued one-off packet that outgrows a shrunken path without saying so (read in noq-proto 1.3.0, `src/connection/datagrams.rs`, `drop_oversized`).
- While a relay carries its connections, the core keeps everything it sends through that relay, summed over those connections, below the cap the relay list gives, pacing a replay, a catch-up, and every bulk transfer after v1, such as a profile sent to a pilot who lacks it, behind the live channels.
- Every message between cores is postcard ([2.2]).
  Which fields each message carries, which changes its size more than the format does, is for the parts that design the messages: node 3 for the cockpit's, and the flight-model sync for its samples ([2.2]).
- A message's stamp is µs on its sender's counter, and its sender's restart count, which the sender's first message names, tells the receiver when that counter's timeline may have changed ([01-spine](../architecture/01-spine.md#times)).

## Control

Control is one value: a generation and the PF's pilot ID.
Every change of PF raises the generation to one past the highest its maker has seen: the take-control key, a handover by voice, a PF leaving the flight, and a takeover while a link is lost or after a sim crash.
Of two changes with the same generation, the one naming the lower pilot ID wins, so every machine compares the same two numbers and reaches the same answer, where comparing the moments of two presses through each machine's own clock estimate could order them differently on two machines.
This replaces [the take-control key](../product/03-v1-scope.md#take-control-key)'s rule that the earlier press wins, however small the gap: two presses within one round trip of each other are settled by pilot ID, which no pilot can notice (user, 2026-10-11).
Who may change control, and when, is the table of roles that [node 3](../architecture/plan.md#3-sync-and-the-session) designs; this design says how the value travels.

The value rides the session channel as one key, so a new connection's first message carries it, and a receiver applies nothing else from that connection until the first message has passed ([joining](#joining)).
Every cockpit message and flight-model sample carries the whole value it was made under, so a receiver can tell apart two pilots who took control from the same generation.
A receiver that meets a newer value on any message or sample adopts it as though the key had come, since QUIC can deliver a new PF's first lever change before the control key it rode after.

- A receiver drops a flight-model sample made under a value older than the newest it knows, since only the flying machine sends samples.
- Of cockpit messages, a receiver drops only those a superseded value's PF made under that value that reach it in a replay ([coming back](#coming-back)), so an ex-PF's solo flying through a cut never replays into the new PF's cockpit, as FS Copilot once replayed a pilot's solo input into a fresh session (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R04).
  A message made live, such as a switch the PF flipped in the round trip before it learned of a handover, applies as usual, so both cockpits keep the switch.
- A dropped message counts as delivered for the cockpit stream's causal order, so no later message waits on it; how the order marks it is node 3's, as is how the ex-PF's own cockpit comes to the new PF's state.

A PF who leaves the flight, for the main menu or another flight, passes control to the PM, as [the connection](../product/03-v1-scope.md#the-connection)'s rules for a pilot who leaves the flight say.
A PF who leaves the session passes control the same way first ([leaving](#leaving)).
A PF whose sim crashes passes nothing, because Crosscheck recovers from a crash (user, 2026-10-11): the PF's core, which stays up, puts the crash on the session channel, the PM's machine locks and holds as when it has lost the flying machine, its banner names the crash, and the PM can take control, with no warning, since a crashed sim flies nothing.
How the crashed PF's aircraft and cockpit come back, as PF if nobody took control, is node 3's.

## While a link is lost

While a core has lost a link, the session is degraded for it, and no core decides who lost the connection (user, 2026-10-11):

- The PF flies on.
- A PM that has lost the flying machine locks its synced displays, and its aircraft carries on and then holds, as a short gap's does ([softening a short gap](#softening-a-short-gap)); FS Copilot's pointer sync locks the following pilot's displays during a long outage the same way, and taking control unlocks them ([pointer sync](../product/03-v1-scope.md#pointer-sync)).
  A lost link to any other member only marks that member, which matters once crews pass two.
- Every pilot's banner lists each crew member with the state of this core's link to them, and whether this PC reaches the internet, from a fresh request to a relay with a 2s timeout, which informs the pilots and decides nothing.
- Any pilot whose role may hold control can take it, as at any time ([take-control key](../product/03-v1-scope.md#take-control-key)), and a PM who does gets a warning that names what follows, such as "James may still be flying. If he is, his aircraft will jump to yours when he reconnects."

## Coming back

Each side's first message on a new connection carries the session channel's keys whole, control among them ([joining](#joining)).
Once it has passed, each side sends traffic's identities whole, catch-up starts again where one was running, and each side sends the cockpit stream's replay.

Each core keeps every sender's cockpit messages that it applied, its own included, until every current member has acknowledged them on the heartbeat, for up to 30 minutes: about 0.8MB to 3MB a sender, at 2.2's 84 bytes a cockpit change and an assumed 5 to 20 changes a second ([2.2]; arithmetic).
On a new connection, each side sends the other what it lacks from any sender, and the receiver drops what it already applied, and what [control](#control) drops.
With two pilots, that's what each sent; with more, a member's replay comes from whoever kept it, so a message whose sender left still reaches a member who missed it.
The one-off channels resend nothing, because the newest sample after the outage replaces what was lost.

Within 30 minutes, a returning pilot whose sim kept running gets a replay, never a catch-up of state as a late joiner gets, because a replay brings back what the profile can't read, such as a display's page or an FMS (user, 2026-10-11).
A replay keeps the PF's spacing, with each gap cut to 2s ([03-catch-up](../sync/03-catch-up.md#replaying-a-short-outage)), so through a cut in which the PF was busy it runs nearly as long as the cut, up to 30 minutes.
So the promise rests on node 3 shortening it, such as by applying state entries at their newest value and keeping the spacing only for events and presses, and an entry it skips counts as delivered, as one [control](#control) drops does.
A gap in the replay happens only when a core that kept messages restarted and lost them, and how a restarted core recovers is node 3's ([01-spine](../architecture/01-spine.md#left-open)).
A late joiner's catch-up serves a first join, and a pilot whose sim restarted, where nothing is left to replay into.

At 30 minutes without a connection to a member, a core counts that member out, and a core that has had no connection to any member for 30 minutes leaves the session, PF or PM, since a flight cut off that long has usually ended; that pilot types the code again to come back (user, 2026-10-11).
This replaces [the connection](../product/03-v1-scope.md#the-connection)'s 5-minute cut-off.

## Leaving

Leave session closes each connection with an application code of ours that only Leave sends, and that close is the goodbye:

- noq lets a peer drop stream data it hasn't delivered once a close arrives (read in noq 1.3.0, `src/connection.rs`, `Connection::close`), so a goodbye message sent just before the close could be lost.
- So a PF who leaves first passes control to the PM as an ordinary handover, and closes once a message from the PM carries the new control value, which the PM's rewrite of the session-wide keys sends at once ([channels](#channels)), or once 1s has passed.
  If the close comes first, the PM's machine locks and holds as after a PF's sim crash, and the PM can take control with no warning ([control](#control)).
- Closing Crosscheck any other way, from the tray, by a Windows shutdown or logoff, or for an update, passes control the same way and closes each connection with a quit code of ours before `Endpoint::close`, and the others treat a quit as a Leave (user, 2026-10-11).
- A process that dies sends no close, or at most one with code 0, which noq sends when every handle to a connection is dropped (read in noq 1.3.0, `src/connection.rs`, the docs of `Connection`), so code 0 and every error QUIC or iroh closes with count as a lost link, never as a leave.
- A core that exits awaits iroh's `Endpoint::close`, bounded in time, which resends the closes until each peer acknowledges them (read in iroh 1.3.0, `src/endpoint.rs`, `Endpoint::close`).
- Leave session also tells the backend, which frees the code once the last member has left, and the session channel tells any member who can't reach the leaver.

## A session file after a long outage

A core that starts and finds a session file can't tell how long it was gone, because the file holds no time the core measures with ([01-spine](../architecture/01-spine.md#left-open)).
So it dials the crew from the file, and a crew member that answers, which timed the silence on its own clock, tells it whether it's still in the session:

- If it was gone for less than 30 minutes, it comes back as [coming back](#coming-back) says: a replay if the sim is still on the run the file names, and a late joiner's catch-up if the sim restarted.
- If it was gone for 30 minutes or more, the session ended for that pilot, the core deletes the file, and the pilot can enter the code again.
- If nobody answers, the core asks the backend whether its code still holds the session, deletes the file if it doesn't, and otherwise keeps dialing for 30 minutes from its own start.

Crosscheck installs no update while a session file exists.
Otherwise it installs a waiting update when the sim closes, and a crash closes the sim too, so a core could restart mid-session on a new version that can't rejoin a crew still on the old one ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).

## Paths

The core sets iroh's path idle timeout to 2s and its path keep-alive to 0.67s, a third of the timeout, as 2.3 ran them ([2.3]):

- For 2s after a direct path dies, iroh keeps sending on it, so nothing arrives.
  Then the connection moves to the relay path, which stays open, and one-off packets sent into the dead path stay lost ([2.3]).
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

## Clock offsets

Each core's heartbeat, once a second, carries a clock exchange with each other core, and each core estimates the other's offset as NTP does: from the four stamps of an exchange, the offset is ½[(T2 − T1) + (T3 − T4)], and of the last 8 exchanges it keeps the one with the shortest round trip ([08-05](../../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
On one-off packets, a lost exchange costs nothing but its place among the 8.
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
- the relay a session runs through taken down for 40s, and a core's home relay moved;
- two relays, with the dialed and the dialing core homed at different ones;
- both cores redialing at once after an outage, with each pair of dials in either order;
- a take-control during a cut, with the ex-PF changing the sim rate and pause alone, and the return after it;
- a PF's Leave session mid-flight.

## iroh as a dependency

The design leans on behavior iroh keeps private and a minor release may change: the 60s timer for punching again, the 5s ceiling on a path keep-alive, the 15s ceiling on a path idle timeout, the two-thirds rule for moving home relay, sending a dial's first packets to every known address, and the home relay connection's reconnect backoff of up to 16s plus its 10s connect timeout (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `src/endpoint/quic.rs`, `src/net_report.rs`, and `src/socket/transports/relay/actor.rs`).
So Crosscheck pins the exact versions of iroh, noq, and `iroh-relay`, and an upgrade is a change of its own:

1. Read the release notes, and the diff of that behavior.
2. Change the pins.
3. Run the network tests, and 2.3's switch, cutting the direct path and timing the move to the relay and back.
4. Upgrade our relays before the release that carries the new iroh, since iroh keeps its wire protocol stable within a major version ([2.1]), at a quiet hour, since a restart drops relayed connections ([the relays](#the-relays)).

An iroh 2.0 is work of its own.
On Windows, iroh 0.96.1's `bind` hung on about half of one game's players' PCs, and the maintainers put it down to CPU-specific build flags in the ring cryptography library and closed the issue as not planned (documented in iroh's issue #3968, as [research report 02](results/2026-10-10-transport-research-reports/02-iroh.txt) summarizes it; unverified on iroh 1.3).
So a release build targets the baseline x86-64 CPU, and the core binds its endpoint under a timeout and reports a failure rather than hanging.

## Left open

- Who hosts the relays, our own servers or n0's managed relays, whose page lists a tier at "$19/month and up" (documented, [iroh hosting](https://iroh.computer/services/hosting), as of 2026-10-11): the choice changes nothing else, because the relay list is a setting.
  n0's free public relays are out, since n0 calls them "suitable for development and hobby use only" (documented, [public relays](https://docs.iroh.computer/iroh-services/relays/public), as of 2026-10-11).
- How the status list looks, which is for the banner's design, and how a pilot sees which kind of connection they have, which [the connection](../product/03-v1-scope.md#the-connection) leaves to a design for later.
- The 5s, the 2s path idle timeout, the 30 minutes, the 10-minute renewal, the relay's cap, and the ATC buffer's limits, which v1's recordings tune.
- Checks for the network's stage of step 8, which tune the network layer without changing this design (user, 2026-10-11):
  - v1's full mix of channels on a direct path under loss, with and without the newest-only slots, since [p06] ran only through the relay;
  - a redial between pilots who reach each other only through a relay, which [p07] didn't test, and which can't land until the dialed core's home relay connection is back: in p07 that connection dropped 3.3s to 9.3s into every outage of 30s or more and came back 2.7s to 23.8s after the link, so a relayed PM could stay locked that long, the one case where closing and redialing isn't yet shown to beat waiting;
  - v1's peak rate through a relay, for its cap.

[2.1]: log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[2.2]: log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[2.3]: log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p04]: log.md#2026-10-11-two-iroh-endpoints-in-two-processes-on-one-pc-each-with-its-own-key-and-ports-connect-directly-over-the-pcs-own-address
[p05]: log.md#2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
[p06]: log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
[p07]: log.md#2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
