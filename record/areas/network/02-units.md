# Network: its units

```text
Purpose:     The network crate's and the transport's interfaces, the backend, and the relays' hosting and configuration.
Depends on:  01-between-machines.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../architecture/decisions.md, log.md
Decides:     What runs on the loop and what in the transport; the network crate's channels, sends, links, moments, and requests, and the hook the session's first message comes through; the transport's commands and events; the heartbeat and its clock stamps; the endpoint key; the backend's framework, storage, requests, and its count of wrong codes; who hosts the relays and where their configuration lives; what the code map changes in 01-between-machines; the budgets; and the cases for the bench (node 6.4).
```

> **Note**
> [Stage 11b](../build/plan.md#11b-the-apps) adds each link's round trip, from the transport's `Stats`, to [the network's slice](#what-the-pilot-sees-and-settings), so the EFB app's crew rows show it beside the link's path (user, 2026-10-26).

> **Note**
> Stage 11b widens the check in [what the pilot sees](#what-the-pilot-sees-and-settings), for setup and the header (2026-11-01).
> It runs from the core's start, in a session or not, every 60s, 5s after a server didn't answer, and at each dial while a link is lost.
> It asks the backend as well as each relay, with a GET, which only our Worker answers with a 405, and the slice gains `servers`: reachable when the backend and at least one relay answered within 2s.
> `internet` is whether anything of ours answered, since the backend and the relays run on two providers.
> The backend's lack of an answer to Host or Join waits for a check, so the session crate tells an offline PC from our servers out of reach.
> [Lookup's](#its-requests) `other-version` carries the host's version as `theirs`, and `too-many-wrong-codes` carries `until`, when the next hour begins in UTC, which the deployed Worker needs before a core reads either.

> **Note**
> Stage 11b's tentative decision on [what reaches the banner](../interface/decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on) leaves the network no notifications of its own, so [the first message](#the-first-message)'s two and the bench's refused side no longer hold (user, 2026-11-01).
> The network raises a moment, `ConnectionRefused { why }`, when it refuses a first message and when a connection closes with a refusal's code.
> The session crate then stops a join still reaching the crew, and the start card says why in the words of the backend's refusal for the same difference.
> A close names no version, so a version refusal known only from one reads as our servers not answering.
> A session under way has no start card, so there only the log says it.
> The network raises `EndpointBound` or `BindFailed` for the session's one bind, and the session crate keeps a Host an attempt until the first and ends the session on the second, so the start card says why and [no session that can't reach anyone shows](../interface/decisions.md#host-and-join-answer-inside-the-start-card) (user, 2026-11-02).

> **Note**
> In [cases for the bench](#cases-for-the-bench), the proxy's cuts still record the time from the cut's end to `LinkUp` with `again` with no bound, since the bench's first run set none (read in `tools/bench/scenarios/network-outages.ts`).
> In the bench's first run, `LinkUp` with `again` came 5.1s to 7.8s after a 10s cut ended, 16.8s and 26.8s after a 30s one, 14.8s and 16.3s after 60s, and 30.2s and 31.9s after 120s (measured on 2026-10-22, [network log](log.md#2026-10-22-on-the-bench-two-cores-join-in-11s-lose-the-link-50s-into-each-outage-and-get-it-back-01s-to-30s-after-and-every-channel-runs-within-8ms-of-the-others-through-a-lossy-relay)).

The network crate makes every decision on the loop: each link's state and timers, every dial and close, which connection stays, and what goes out on which channel, so a replay reproduces each one.
The transport, an engine at the core's edge, runs iroh and keeps only what turns on real time and bytes: the newest packet of each kind waiting for room in QUIC's queue, pacing through a relay, and the heartbeat's send stamp.
The network owns everything between machines, the backend's requests among it, and the session crate fills each connection's first message with the session's keys through one hook.
The backend is a Cloudflare Worker on D1, and our relays run on two servers of ours, in New York and Frankfurt, configured from `src/relays/`, with their tokens in a private repository of ours.

This answers node 6.4 of the [architecture plan](../architecture/plan.md#64-the-network).
[01-between-machines](01-between-machines.md), decisions [032](../../decisions/032-one-quic-connection-through-iroh.md) to [039](../../decisions/039-cut-link-replays-others-late-join.md) and [041](../../decisions/041-core-crash-comes-back-as-late-joiner.md), the code map's [units](../architecture/02-code-map.md#the-units), [01-loop-and-edge](../core/01-loop-and-edge.md), and [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `network` | Platform | Each member's link and its connection, their timers, the channels' handlers, the heartbeat and clock offsets, the endpoint key, the backend's requests, and the network's notifications; it raises `LinkUp`, `LinkLost`, `MemberLeft`, `MemberOut`, and `BackendAnswered` | On the loop |
| `transport` | Engine | iroh's endpoint, its connections and streams, the newest-only slots and ATC audio's queue, pacing through a relay, and the send stamp | On tokio at the core's edge, and in any program that links it |
| The message crate's `net` module | Engine | The kinds of delivery, the first message's header, and the transport's commands and events, while each channel's constant lives in its owner's module | Wherever the message crate does |
| `src/backend/`'s sessions | Backend | Invite codes, sessions, members, and wrong codes, in D1 | On Cloudflare Workers |
| `src/relays/` | Configuration | Each relay's region, URL, and cap, and the script that deploys them with their tokens from `dual-input/relay-tokens` | On our relay servers, and compiled into each release's default list |

The transport's commands and events live in the message crate because the network crate keeps the loop's rules, and the map check lists the transport among the crates that do I/O, so the network crate can't depend on it ([the map check](../architecture/02-code-map.md#the-map-check)).
The sim's calls follow the same split: `SimCall` lives in the sim client, not in the sim edge ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-sim-client)).

## What runs where

| Work | Runs in | Because |
| --- | --- | --- |
| Each link's state and its timers ([the link between two cores](01-between-machines.md#the-link-between-two-cores)) | The network crate | A replay reproduces when each link was lost and when it came back |
| Which of two connections stays, and whether a first message passes | The network crate | Both turn on what this core holds, which the loop's state is |
| Clock offsets | The network crate | Each is arithmetic on stamped inputs |
| What goes out, on which channel, to whom | The network crate | Handlers put it out |
| The newest packet of each channel and key, handed to QUIC, highest priority first, only when `Connection::datagram_send_buffer_space` shows room for it, so QUIC's queue never holds more than its 3,486 bytes ([sending](01-between-machines.md#sending)) | The transport | QUIC's room changes with every packet it carries, which the loop never sees |
| Pacing through a relay: the sum of everything sent through it, over every connection, kept below its cap by holding stream data back, the lowest priority first | The transport | It counts bytes against real time |
| The heartbeat's send stamp | The transport | A stamp taken as the packet goes to QUIC leaves the loop's own delay out of the time on the path |
| Binding the endpoint under a timeout | The transport | iroh 0.96.1's `bind` hung on Windows, unverified on iroh 1.3 ([iroh as a dependency](01-between-machines.md#iroh-as-a-dependency)) |

## The network crate

### Channels and sends

```rust
// a sketch: flight-model sync, beside 01-loop-and-edge's and 03-sim-seam-and-wasm-module's
pub fn register(r: &mut Registry) {
    let me = r.unit::<FlightModel>("flight-model");
    me.channel(flight_model::SAMPLES, FlightModel::on_sample);   // its number, delivery, and priority are in the message crate
    me.on::<LinkLost>(FlightModel::carry);
}

fn send(me: &mut FlightModel, sample: Sample, cx: &mut Cx) {
    cx.net().send(flight_model::SAMPLES, To::Crew, &sample);   // a value of the channel's own message type
}
```

- **A channel is a constant in its owner's module of the message crate:** its number, its message type, its delivery, and its priority, so both sides read all four from the crate whose hash their first messages compare ([joining](01-between-machines.md#joining)).
  A test in the message crate fails on two channels with one number.
- **Delivery is one of three:**
  - `Stream`: every message in order and resent, on a QUIC stream of the sender's that opens with the channel's number.
  - `Newest`: one-off packets, of which only the newest for each key waits to go, the key named by the message type, such as a pose's figure.
  - `Deadline`: one-off packets in a short queue, each dropped once its deadline passes, the deadline named by the message type, such as an ATC frame's turn to play.
  - Each one-off channel's message type implements the message crate's `OneOff` trait, whose `wait()` gives its key or its deadline, in the type's own module, because Rust accepts `impl OneOff for T` only in the crate that defines `OneOff` or the one that defines `T`.
  - The network reads the key or the deadline from the message on the loop, and hands it to the transport with the packet's bytes.
- **A one-off message's room** is `ONE_OFF_ROOM` in the message crate, 1,160 bytes, since the transport puts its channel's number in the first 2 of a packet's 1,162, and a stamped channel's message gets 8 fewer, which narrows the 1,162 bytes [sending](01-between-machines.md#sending) keeps a traffic batch under.
- **Priority** orders streams among streams and one-off packets among one-off packets, as [channels](01-between-machines.md#channels) ranks them, and QUIC puts waiting one-off packets ahead of stream data in every packet it builds ([sending](01-between-machines.md#sending)).
- **A send names its receivers:** `To::Crew`, every member whose link is up, or `To::Member(pilot)`, as catch-up's stream goes only to the machine catching up.
- **A received message reaches its channel's handler** with its sender's pilot ID and restart count and its input's stamp.
  The handler checks who may send it, since only units above the network can read control, as a flight-model sample made under an older control value is dropped by flight-model sync ([control](01-between-machines.md#control)).
  A message on a channel no unit registered, such as a plugin's that runs only on the other machine, is dropped.
- A channel declares no sender or receiver beyond this, which changes [decision 035](../../decisions/035-channels-declare-how-they-travel.md)'s "who sends and receives it" once step 8's decisions are numbered: the network can't evaluate a role such as "the flying machine", because the session crate that knows it sits above the network.

### The first message

- The session crate registers the session channel with `me.opener(session::CHANNEL, Session::open)`, and only one unit may.
- When a connection comes up, the network asks the kernel to call `open`, which sends every session key the core holds with `cx.net().first(conn, &keys)`, and the network puts the header in front of it: Dual Input's version, the message crate's hash, the session's code, and this core's pilot ID and restart count ([joining](01-between-machines.md#joining)).
- On a connection's first message, the network checks the header itself.
  - A code, version, or hash other than its own closes the connection with an application code naming which.
  - Otherwise it hands the keys to the session channel's handler, and the link takes the connection ([links](#links)).
- Until then, the network drops the connection's one-off packets and keeps its other streams' bytes in arrival order, since QUIC keeps no order across streams ([the link between two cores](01-between-machines.md#the-link-between-two-cores)).
  The first message has no timeout, so a connection whose first message never comes stays open until it closes; the bench never saw a timeout fire, since a core that sends no first message closes its own connection first (user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
- So the version check at join is the network's, at the backend and at the first message.
  The session crate shows the backend's refusal, which reaches it in `BackendAnswered`, and the network shows a connection refused for its code, version, or hash, and an endpoint that failed to bind, as notifications of its own ([notifications](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)).
  A core whose connection closes with a refusal's code shows the refusal's notification, as it does when it refuses the other core's first message itself, because the close can arrive before the first message the other core sent ahead of it.

### Links

- The network keeps one link for each member's pilot ID, holding at most one connection, the one [the link between two cores](01-between-machines.md#the-link-between-two-cores)'s rule keeps.
  Of two connections one side dialed, the newer stays.
  The two sides can rank a pair differently when a handshake's last packet is lost and a redial's connection finishes first on one side; both then close, redial, and link within a redial or two, which v1 leaves (user, 2026-10-23).
- A member that `Open` or `Dial` names starts lost, so a first join and a redial take one path.
  While a link is lost, the network dials its member every 2s, each dial replacing the one running, until a first message passes, and raises `MemberOut` once the link has been lost for 30 minutes.
- One timer per link fires at its connection's last-heard time plus 5s, counting a stream's bytes and a one-off packet alike; when it fires and something has arrived since, it's set again for the new time plus 5s, and otherwise the network raises `LinkLost`, closes the connection, and the link is lost again.
- `LinkUp` is raised each time the link takes a connection whose first message has passed: when it first comes up, when it comes back, and when the rule moves it onto the other of two connections, since what went out on the connection it closes may be lost.
- `again` is true when the link was up before under the same restart count.
  A first message with a higher restart count ends the old count's link with no `LinkLost` or `MemberOut`, and its `LinkUp` has `again` false, so the restarted core gets a late join and no replay, as [decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md) has it.
- A connection closed with Leave's code or the quit code raises `MemberLeft`, and the network stops dialing that member; code 0 and every error count as a lost link ([leaving](01-between-machines.md#leaving)).

### Moments

| Moment | Raised when | Such as |
| --- | --- | --- |
| `LinkUp { member, again }` | The member's link takes a connection whose first message has passed | The session crate lists a new member and sends its keys whole, and traffic sends its identities whole; on `again`, the cockpit stream sends what the member lacks ([coming back](01-between-machines.md#coming-back)) |
| `LinkLost { member }` | 5s with nothing on the member's connection | Pointer sync locks its displays ([while a link is lost](01-between-machines.md#while-a-link-is-lost)) |
| `MemberLeft { member }` | The member's connection closes with Leave's code or the quit code | The session crate counts the member out at once, releasing the roles it held |
| `MemberOut { member }` | 30 minutes without a connection to the member | The session crate counts the member out, and leaves once none is left |
| `BackendAnswered(answer)` | The backend answers a request of the session crate's, or doesn't within 10s | The session crate writes its session file, then asks `Open` |

- A member here is a pilot ID, with the restart count and endpoint ID of its latest first message.
- These replace the code map's two, "link lost" and the link's return, which are `LinkLost` and `LinkUp` with `again`.
- The session crate sends its keys whole on every `LinkUp`, because a key it changed after this core's first message went out, but before the other side's passed here, went to no member.

### Requests the session crate makes

| Request | What the network does | It answers with |
| --- | --- | --- |
| `Host { session, me }` | Draws the endpoint key, and asks the backend for a code, sending the session's ID, its relay list with tokens, and the host's member entry | `BackendAnswered`: the code, or why not |
| `Join { code, me }` | Draws the endpoint key, and looks the code up | `BackendAnswered`: the session's ID, relays, and crew, or why not |
| `Open { session, key, relays, crew }` | Binds the endpoint with that key and relay list, and dials each crew member | `LinkUp`, member by member |
| `Dial { member }` | Dials a member that another's entry names and this core holds no link to | `LinkUp` |
| `Leave { quit }` | Closes each connection with Leave's code, or the quit code, tells the backend, and shuts the endpoint | Nothing; the session crate exits or goes on without a session |

- The session crate writes its session file between `BackendAnswered` and `Open`, because it opens links only once the file is written ([outputs](../core/01-loop-and-edge.md#outputs)).
  The key it writes is in the network's state, which the session crate reads.
- A core back from a restart sends `Open` with the crew from its session file; when no member's first message has passed within 10s, the network looks the code up, and `BackendAnswered` says whether a member other than this core still holds the session ([a session file after a long outage](01-between-machines.md#a-session-file-after-a-long-outage)).
- The backend lists the host when it answers `Host`.
  A joiner's core posts its own entry to `/v1/members` at its first `LinkUp`, and every core posts its own entry every 10 minutes after; the backend lists an entry it doesn't hold and renews one it does ([joining](01-between-machines.md#joining)).
- A PF who leaves hands over control before asking `Leave`, which is the session crate's ([leaving](01-between-machines.md#leaving)).

### The heartbeat and clock offsets

- While a session is open, the network sends a heartbeat on each connection once a second, a one-off packet carrying the last heartbeat it received on that connection: that packet's send stamp, and the stamp of the input it arrived in.
  A core outside a session sends none, so it records no heartbeat input each second.
  The transport adds the packet's own send stamp as it hands the packet to QUIC, 8 bytes of µs on the PC's counter.
- From a heartbeat, the receiver takes T1 as its own earlier send stamp, echoed back, T2 as the other core's receive stamp of it, T3 as this packet's send stamp, and T4 as this input's stamp, and keeps the offset ½[(T2 − T1) + (T3 − T4)] with the shortest round trip of the last 8, as [decision 038](../../decisions/038-clock-offset-from-timed-exchange.md) has it.
- Receive stamps are the queue's, read as the edge pushes the input ([the queue](../core/01-loop-and-edge.md#the-queue)), so the error left is the time between the socket and the queue, and between QUIC and the wire, which the shortest round trip keeps small.
- The heartbeat carries no acknowledgment of the cockpit stream, because the network sits below the cockpit-stream crate, and carrying its vector clock would take a second hook like the session's opener.
  The cockpit-stream crate sends its clock once a second on a `Newest` channel of its own, at up to one more packet a second, about 58 bytes of headers ([2.2]), where [04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream) and decisions [037](../../decisions/037-while-a-link-is-lost.md), [042](../../decisions/042-vector-clock-records-what-applied.md), and [044](../../decisions/044-table-of-roles.md) have it ride the heartbeat, which this changes once step 8's decisions are numbered.
- Each sender's offset sits in the network's state, by pilot ID and restart count, for flight-model sync to read.

### The endpoint key

- On `Host` or `Join`, the network draws 32 bytes through `cx.random_bytes()`, from the kernel's ChaCha20 generator that the edge seeds from the operating system, a call beside `cx.new_id()` that this design adds to the kernel ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids)).
- The network signs each backend request on the loop with ed25519-dalek, the crate iroh-base builds its keys on (read in iroh-base 1.3.0, `Cargo.toml`), since Ed25519 signing reads neither a clock nor randomness ([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032#section-5.1.6)).
  Whether ed25519-dalek with its `rand_core` feature off still reaches `getrandom`, the map check shows at the first build.
- A recording's first input holds the seed, so a recording rebuilds the key, which lets whoever holds it act as that pilot's endpoint until the session ends; the session file holds the key in plain text anyway.

### What the pilot sees, and settings

- The network keeps a slice of client state: each member with its link's state and its path, direct or the relay's URL, and whether this PC reaches the internet.
  While any link is lost, each time a dial starts, unless a check ended under 5s ago, a job asks every relay in the session's list for `/ping`, which answers with no token ([network log][win]), and the PC reaches the internet when any answers before a 2s timer fires.
- It registers its settings, all for development, so no page reads or writes them: the relay list, whose default each release compiles in from `src/relays/` and `dual-input/relay-tokens`, and which the bench points at its own relays; sending through relays only, which clears the endpoint's IP transports ([two cores on one PC](01-between-machines.md#two-cores-on-one-pc)); and the backend's URL, which the bench points at a local backend.

## The transport

The transport pins iroh, noq, and `iroh-relay` at 1.3.0, the versions our probes measured, over iroh 1.4.0 and 1.4.1, of 2026-10-20 and 2026-10-21; moving to 1.4 is a change of its own, as [iroh as a dependency](01-between-machines.md#iroh-as-a-dependency) gives it (user, 2026-10-22; [build plan](../build/plan.md#7-the-network)).
It pins `noq-proto`, `noq-udp`, `iroh-base`, and `iroh-dns` at 1.3.0 beside them, the versions every network experiment of ours that ran iroh ran, because iroh 1.3.0 and `iroh-relay` 1.3.0 take any 1.x of them from 1.3.0, and `Cargo.lock` had moved them to 1.4 (user, 2026-10-23; [network log](log.md#2026-10-23-cargolock-ran-noq-proto-140-under-our-130-pins-so-the-transport-pins-the-crates-iroh-and-noq-are-built-from-too)).

### Its commands

| Command | The transport |
| --- | --- |
| `Bind { key, relays, ip }` | Builds the endpoint from `presets::Minimal` with `RelayMode::Custom` and the relays and their tokens, the 2s path idle timeout and 0.67s keep-alive, and a one-off queue of 3,486 bytes, three packets of 1,162 ([sending](01-between-machines.md#sending)); clears its IP transports when `ip` is off; and binds under a 5s timeout |
| `Dial { endpoint }` | Dials the endpoint through every relay in the list it bound with, and drops any dial still running to that endpoint |
| `Close { conn, code }` | Closes the connection with that application code |
| `Stream { conn, channel, priority, bytes }` | Writes to the channel's stream on that connection, opening it with the channel's number and its priority on first use |
| `OneOff { conn, channel, priority, delivery, bytes, stamp }` | Puts the packet in its slot when `delivery` is `Newest { key }`, or in its channel's queue when it's `Deadline { at }`, and adds the send stamp when `stamp` is set |
| `Shutdown` | Awaits `Endpoint::close`, within the 750ms [exiting](../core/01-loop-and-edge.md#exiting) gives the edges when the core exits |

### Its events

| Event | Carries |
| --- | --- |
| `Bound` | The endpoint ID, or the error, or the timeout |
| `Connected` | The connection's number, the other endpoint's ID, and whether this side dialed |
| `Stream` | The connection, the channel's number, and the bytes |
| `OneOff` | The connection, the channel's number, and the bytes |
| `Closed` | The connection, and its application code or the error |
| `Path` | The connection, and direct or the relay's URL |
| `Stats` | Once a second for each connection: packets sent and lost, the round trip, and the congestion window |

- Connection numbers come from a counter in the transport, inside each event, so a replay sees the same numbers, as socket IDs do in [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#the-websocket-server), and a higher number is the newer connection, which the rule for two connections one side dialed asks for.
- Every event is an input, so the recording holds each connection's path, loss, and round trip, which [the way through home routers](01-between-machines.md#the-way-through-home-routers) asks v1 to record.

## The backend

### Its framework and storage

- A Cloudflare Worker in TypeScript with a plain `fetch` handler, routing its four requests by path, with no framework, as fsc-editor's Worker routes its two (read in fsc-editor, `relay/src/index.ts`).
- D1 holds three tables: sessions, members, and wrong codes.
  On the Workers Free plan, D1 allows 5 million rows read and 100,000 written a day and 5 GB in all, a write counts one more row for each index its columns are in, and the limits reset at 00:00 UTC ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), as of 2026-04-21); a database holds at most 500 MB, and a row at most 2 MB ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- No Durable Object: fsc-editor's Worker holds one per code because it holds each session's WebSockets (read in fsc-editor, `relay/src/index.ts`, `Session`), and this backend holds no connection.
- Bug reports' files, which may pass D1's 2 MB a row, are [6.6](../architecture/plan.md#66-recording-and-bug-reports)'s to store, after v1: v1's backend takes no bug report's parts and stores nothing in R2, since the report endpoints come after v1 (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).
- Its bodies are the message crate's types, through the TypeScript ts-rs generates ([building every target](../architecture/02-code-map.md#building-every-target)).

### Its requests

| Request | Body | Answer |
| --- | --- | --- |
| `POST /v1/sessions` | The session's ID, its relay list with tokens, the host's member entry, and Dual Input's version and the message crate's hash | The code |
| `POST /v1/lookup` | The code, the version, and the hash | The session's ID, relays, and crew; or a refusal: no such code, a version or hash that differs, naming whose is older, or too many wrong codes |
| `POST /v1/members` | The code and the member's entry | Taken, the member listed or renewed |
| `POST /v1/members/leave` | The code and the endpoint ID | Taken |

- The bodies give pilot and endpoint IDs as lowercase hex, and a member's kind is crew or passenger, so a passenger's entry needs no new path.
- Every request but a lookup carries the member's endpoint ID and an Ed25519 signature over the body by the endpoint key, in the `DualInput-Endpoint` and `DualInput-Signature` headers, which the backend checks through `crypto.subtle`, which lists Ed25519 for `verify()` ([Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), as of 2026-09-30), unverified until the backend's tests run.
  A captured request could be sent again, but only by someone who also holds the code it carries, which admits them to the session outright, and the requests travel inside HTTPS.
- A member entry's pilot ID isn't tied to its key, so someone holding the code could list another pilot's ID under a key of their own, and v1 leaves that, since only someone the crew gave the code to could (user, 2026-10-23).
- The path carries the backend's version.
  The release workflow deploys the backend, its D1 migrations and then its Worker, just before it publishes each release, and a second workflow deploys it alone for a fix, so the backend running is the newest release's and answers older releases' cores too, and a change to a request's body takes a new path beside the old one ([the backend](../build/01-the-build.md#the-backend)).

### Codes, lapses, and wrong codes

- A code is six characters from the 30-character alphabet of [the invite code](../product/03-v1-scope.md#invite-code), each drawn from a byte of `crypto.getRandomValues` that's drawn again until it falls below 240, the largest multiple of 30 under 256, so every character is equally likely.
- The code is the sessions table's key, so an insert that meets a held code fails, and the Worker draws again, up to 5 times, as fsc-editor's does (read in fsc-editor, `relay/src/index.ts`, `CODE_ATTEMPTS`).
- A member row keeps when it last renewed.
  A lookup lists only members renewed within 30 minutes, and answers a session with none as no such code.
  An hourly Cron Trigger, one of the 5 the Workers Free plan allows an account ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), deletes lapsed members, empty sessions, and past hours' counts of wrong codes.
- A member's leave or lapse ends their row, and the backend keeps no rows for 30 days after, which only the report endpoints after v1 need, to check a part's sender ([what the backend admits](../recording/01-recording-and-bug-reports.md#what-the-backend-admits); user, 2026-10-22; [build plan](../build/plan.md#7-the-network)).
- Each address, as `CF-Connecting-IP` names it, has a count of wrong codes for the current hour: an IPv6 address counts by its /64, the network a home usually gets and whose addresses its PCs may switch among, and an IPv4 address by itself (user, 2026-10-23).
  A lookup takes its guess in the statement that checks the count, refusing at 20, then looks the code up, and a right code gives the guess back, so lookups made at once can't pass 20.
  So a right code never counts, and an address at the limit is refused even when it guesses right, where fsc-editor's Worker counts every well-formed join through Cloudflare's rate-limiting binding (read in fsc-editor, `relay/src/index.ts`, `join`).
  With 30⁶, about 729 million codes, and 1,000 live sessions, an address's 20 guesses an hour hit one with a chance of about 1 in 36,000 (arithmetic).

## The relays

### Who hosts them

- Two servers of ours, DigitalOcean droplets in New York and Frankfurt, at $4 to $6 a month each (documented, [research report 06](results/2026-10-10-transport-research-reports/06-relay-hosting-and-cost.txt), prices fetched 2026-10-09), so $8 to $12 a month for both (user, 2026-10-16).
- The relays run at `nyc.relay.dualinput.app` and `fra.relay.dualinput.app`, and the backend at `api.dualinput.app`, on Dual Input's domain (user, 2026-10-22).
- p03, p05, p06, and p07 measured iroh through droplets in those two cities ([2.3]; [p07]), with 2 vCPUs and 2 GiB each (read in `experiments/areas/network/p03-home-networks/deploy/deploy.mjs`, `SIZE`), larger than the $4 and $6 droplets, which have 1 vCPU and 512 MiB or 1 GiB (same report).
- Two $4 droplets pool 1,000 GiB of transfer a month (same report), about 6,000 relayed session-hours at [p06]'s busy mix, about 168 MB an hour out of the relay with 130 to 150 bytes of overhead a relayed packet (arithmetic; the overhead is unverified, [2.1]).
- `iroh-relay` keeps its own certificates through its `LetsEncrypt` certificate mode (read in iroh-relay 1.3.0, `src/main.rs`, `CertMode`).
- n0's managed relays don't take [decision 033](../../decisions/033-relays-run-iroh-relay-unmodified.md)'s tokens and caps.
  Their shared relays, at $19 a month for 4 relays and 100 GB, admit an endpoint through a token n0's own preset mints from a project API key, state a 5 MB/s limit without saying what it applies to, and lock no version, which only Dedicated relays do, at $199 a month for each region (documented, [shared relays](https://docs.iroh.computer/iroh-services/relays/shared), [dedicated relays](https://docs.iroh.computer/iroh-services/relays/managed), [pricing](https://www.iroh.computer/pricing), undated, read 2026-10-16).

### Their configuration

- `src/relays/relays.toml` lists each relay: its region, its URL, and its cap in bytes a second, written once (user, 2026-10-16).
- The relays' tokens stay out of this repository, which goes public: the private repository `dual-input/relay-tokens`, under Dual Input's GitHub organization, holds `tokens.toml`, each relay's tokens newest first under its region (user, 2026-10-18 and 2026-10-22).
  - Developers trusted with the tokens are given access to it, and adding or retiring a token is a commit there.
  - Stage 7 of [the build plan](../build/plan.md#7-the-network) makes it, ahead of the rest of GitHub in stage 22.
- The network crate's build compiles each release's default relay list from both, each relay's URL, its first token, and its cap, reading the tokens from the clone that `DUALINPUT_RELAY_TOKENS` names, which for a release is the copy [the release's build job](../build/01-the-build.md#a-release) checks out.
  So a token is exposed only as far as a release's program exposes it ([the relays](01-between-machines.md#the-relays)).
- A deploy script beside `relays.toml`, `src/relays/deploy.ts`, run by Node as `tools/build.ts` is, reads the tokens from a clone of `dual-input/relay-tokens` and installs n0's own build of `iroh-relay` 1.3.0, checked against its SHA-256.
  - It renders each relay's `iroh-relay` configuration from its entries, `access.shared_token` with all its tokens and `limits.client.rx.bytes_per_second` with its cap (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig` and `RateLimitConfig`), installs it over SSH, and restarts the relay, at a quiet hour ([the relays](01-between-machines.md#the-relays)).
  - A new token reaches every relay before the release that carries it.
- A relay of our own, if we ever write one, lives in `src/relays/` too (user, 2026-10-16).

## What the code map changes in 01-between-machines

Nothing beyond what [01-between-machines](01-between-machines.md) holds, because that document names components, never units, and the units above add detail to its components without changing them.
Its text holds this design's own changes to it.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets](../architecture/02-code-map.md#budgets) and [01-loop-and-edge](../core/01-loop-and-edge.md#budgets)'s.

| What | Budget |
| --- | --- |
| Inputs from one link | About 140 a second from a busy PF: [p06]'s busy mix sent 121 one-off packets and 20 cockpit changes a second |
| The transport | Inside 01-loop-and-edge's 2% of one CPU core for the edge's threads |
| Memory | Inside 01-loop-and-edge's 100 MB for a busy session, beside the cockpit stream's kept messages, which are [6.9](../architecture/plan.md#69-sync)'s |
| A relay's cap | 256 KiB/s for each pilot, about 6 times what [p06]'s busy mix sent with headers, until the bench's peak rate sets it |
| A join | From the code entered to the first message passing within 3s, on a direct path |
| The backend | A renewal every 10 minutes is 6 requests and 6 to 12 rows written an hour for each pilot, so the Workers Free plan's 100,000 requests a day ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) and D1's 100,000 rows written cover about 8,000 to 16,000 pilot-hours a day, fewer with joins and wrong codes (arithmetic) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, and [the network's log](log.md#2026-10-22-on-the-bench-two-cores-join-in-11s-lose-the-link-50s-into-each-outage-and-get-it-back-01s-to-30s-after-and-every-channel-runs-within-8ms-of-the-others-through-a-lossy-relay) holds their run at the network's stage of the build.
In CI and on a developer's PC, on Windows, two cores run through the bench's relays, each core's IP transports cleared ([two cores on one PC](01-between-machines.md#two-cores-on-one-pc)).
The bench's relays are `iroh-relay`'s own server, as a library in `tools/bench/relay`, with the production cap and a test token, so CI's tests need no access to `dual-input/relay-tokens`.
Each relay sits behind a TCP proxy, which tells one core's connection from another's by the process that owns it, and can hold back or cut each core's connection through it on its own; both cores' relay list names the proxies, since a session uses one list ([joining](01-between-machines.md#joining)).
A core reaches such a relay over plain HTTP with its token, as iroh-relay's client maps an `http` relay URL to a WebSocket without TLS (read in iroh-relay 1.3.0, `src/client.rs`), and asks a relay over plain HTTP for no QUIC address discovery.
The cores' backend is a local one on a local D1.
On iroh's relay a lost packet only holds back the packets behind it until TCP resends it, and QUIC sees no loss ([p06]), so the proxy stands in for a lost packet by holding it, and every byte behind it, for a round trip and a quarter ([2.1]) of the 22ms and 84ms round trips [p06] ran through Frankfurt and New York, at a 1% and a 3% rate:

- Every v1 channel through the relay at both rates: the streams' p99 lateness stays within 17ms of the one-off packets', as [p06] saw.
- A core suspended for 60s: `LinkLost` after 5s; on resuming, a redial, a first message, `LinkUp` with `again`, and the cockpit stream's replay.
- A core killed and restarted: its higher restart count ends the old link, `LinkUp` has `again` false, no replay goes out, and no `MemberOut` fires for the old count.
- The proxy cutting both cores for 10s, 30s, 60s, and 120s: the time from the cut's end to data again, the redial between relayed pilots that [p07] didn't test, recorded with no bound until the bench's first run.
- The relay down for 40s: `LinkLost` on both cores after 5s, then a redial and `LinkUp` with `again` once the relay is back, and the time from its return to data again.
- A core's home relay moved mid-session: the link stays up or comes back by a redial, and the time without data is recorded, since whether iroh moves a relayed connection to the new home relay is unmeasured ([p05]).
- Two relays, with the two cores homed at different ones: both directions cross the dialed core's home relay ([p05]).
- Both cores redialing at once after a cut, each pair of dials in either order: both sides keep the same connection, and the replay arrives whole.
- A joiner whose first dials fail redials every 2s and links once the proxy lets it through.
- A wrong code, version, or hash closes the connection with the code naming which, and the refused side shows a notification.
- A take-control during a cut, with the ex-PF changing the sim rate and pause alone: after the return, every machine holds the new PF's values.
- A PF's Leave mid-flight: the PM holds control within 1s, and its core raises `MemberLeft` and stops dialing; a PF's quit does the same, tells the backend, and exits within 01-loop-and-edge's 3s for a quit.
- A burst of one-off packets: QUIC's queue never holds more than 3,486 bytes, and a flight sample never goes out after a newer one.
- Two cores read one PC's counter, so each one's estimate of the other's offset stays within 1ms of 0.
- v1's busiest session through the relay, with a replay and a catch-up beside the live channels: its peak rate sets the relay's cap.
- The backend, against a local D1: each request's answer; a code that meets a held one drawn again; the 21st wrong code in an hour refused, and a right code from that address too; a member unrenewed for 30 minutes missing from a lookup, and a session with none answered as no such code; a signature by another key refused; a joiner on an older version told whose is older.

By hand, on our droplets, at the network's stage of the build and whenever iroh's or noq's pinned version changes, as step 3 of [iroh as a dependency](01-between-machines.md#iroh-as-a-dependency) runs the network's tests (user, 2026-10-16), `tools/bench/droplet` runs v1's full mix on a direct path at no loss, 1%, and 3%, through `tc netem` as [p06] ran it (user, 2026-10-23):

- `tools/bench/droplet` is a small core for Linux, since the core runs only on Windows: the kernel's loop with the clients and network crates and a test unit that sends [p06]'s busy mix, and the transport at an edge of its own.
  Its build as a static musl program settles that the network crate and the transport build on Linux.
- The listening end runs `iroh-relay`'s server as a library inside the same program, and that relay only introduces the two ends before they go direct, so the run needs no DNS and no deployed relay.
- The run without the newest-only slots happens once, on the droplet build's own copy of the transport, with a patch that drops them and is kept with that run's results, so the transport carries no switch for the slots.
  On a direct path 85ms away at 3% loss, the slots kept one-off packets within 39ms at p99, where without them they ran up to 221ms late, and 23ms away the two came within 3ms of each other ([network log](log.md#2026-10-23-on-a-direct-path-85ms-away-at-3-loss-the-newest-only-slots-keep-one-off-packets-within-39ms-at-p99-where-without-them-they-run-up-to-221ms-late)).
- Every later run, at each change of iroh's or noq's version, runs the transport as it ships, because [the burst case](#cases-for-the-bench) keeps the slots whatever that first run showed.

## Left open

- Whether a droplet with 1 vCPU and 512 MiB carries `iroh-relay` through a busy evening, since p05 to p07 ran on 2 vCPUs and 2 GiB, which the first deployment's CPU and memory show.
- A sweep of wrong codes from many addresses could spend D1's 100,000 free writes in a day, after which every D1 query fails until 00:00 UTC: no pilot could join, and renewals would fail, though running sessions fly on, since none waits on the backend; the Workers Paid plan includes 50 million rows written a month ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)), and we move to it if that happens.
- Pilots in Asia and Oceania relay through New York or Frankfurt, and v1's recordings show whether a third region pays for itself.

[2.1]: log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[2.2]: log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[2.3]: log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p05]: log.md#2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
[p06]: log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
[p07]: log.md#2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
[win]: log.md#2026-10-16-iroh-relay-130-builds-and-runs-on-windows-and-in-dev-mode-answers-on-ipv6-loopback-only
