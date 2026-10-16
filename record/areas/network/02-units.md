# Network: its units

```text
Purpose:     The network crate's and the transport's interfaces, the backend, and the relays' hosting and configuration.
Depends on:  01-between-machines.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../architecture/decisions.md, log.md
Decides:     What runs on the loop and what in the transport; the network crate's channels, sends, moments, and requests, and the hook the session's first message comes through; the transport's commands and events; the heartbeat and its clock stamps; the endpoint key; the backend's framework, storage, requests, and its count of wrong codes; who hosts the relays and where their configuration lives; what the code map changes in 01-between-machines; the budgets; and the cases for the bench (node 6.4).
```

The network crate makes every decision on the loop: each link's state and timers, every dial and close, which connection stays, and what goes out on which channel, so a replay reproduces each one.
The transport, an engine at the core's edge, runs iroh and keeps only what turns on real time and bytes: the newest packet of each kind waiting for room in QUIC's queue, pacing through a relay, and the heartbeat's send stamp.
The network owns everything between machines, the backend's requests among it, and the session crate fills each connection's first message with the session's keys through one hook.
The backend is a Cloudflare Worker on D1, and our relays run on two servers of ours, in New York and Frankfurt, configured from `relays/`.

This answers node 6.4 of the [architecture plan](../architecture/plan.md#64-the-network).
[01-between-machines](01-between-machines.md), decisions [032](../../decisions/032-one-quic-connection-through-iroh.md) to [039](../../decisions/039-cut-link-replays-others-late-join.md), the code map's [units](../architecture/02-code-map.md#the-units), [01-loop-and-edge](../core/01-loop-and-edge.md), and [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `network` | Platform | Each link and its connections, their timers, the channels' handlers, the heartbeat and clock offsets, the endpoint key, and the backend's requests; it raises `LinkUp`, `LinkLost`, `MemberOut`, and `BackendAnswered` | On the loop |
| `transport` | Engine | iroh's endpoint, its connections and streams, the newest-only slots and ATC audio's queue, pacing through a relay, and the send stamp | On tokio at the core's edge, and in any program that links it |
| The message crate's `net` module | Engine | The kinds of delivery, the first message's header, and the transport's commands and events, while each channel's constant lives in its owner's module | Wherever the message crate does |
| `backend/`'s sessions | Backend | Invite codes, sessions, members, and wrong codes, in D1 | On Cloudflare Workers |
| `relays/` | Configuration | Each relay's region, URL, tokens, and cap, and the script that deploys them | On our relay servers, and compiled into each release's default list |

The transport's commands and events live in the message crate because the network crate keeps the loop's rules, and the map check lists the transport among the crates that do I/O, so the network crate can't depend on it ([the map check](../architecture/02-code-map.md#the-map-check)).
The sim's calls follow the same split: `SimCall` lives in the sim client, not in the sim edge ([03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md#the-sim-client)).

## What runs where

| Work | Runs in | Because |
| --- | --- | --- |
| Each link's state, and its 5s, 2s, 10s, and 30-minute timers ([the link between two cores](01-between-machines.md#the-link-between-two-cores)) | The network crate | A replay reproduces when each link was lost and when it came back |
| Which of two connections stays, and whether a first message passes | The network crate | Both turn on what this core holds, which the loop's state is |
| Clock offsets | The network crate | Each is arithmetic on stamped inputs |
| What goes out, on which channel, to whom | The network crate | Handlers put it out |
| The newest packet of each channel and key, waiting for room in QUIC's queue, and the order packets go to QUIC | The transport | QUIC's room changes with every packet it carries, which the loop never sees |
| Pacing everything sent through a relay below its cap | The transport | It counts bytes against real time |
| The heartbeat's send stamp | The transport | A stamp taken as the packet goes to QUIC leaves the loop's own delay out of the time on the path |
| Binding the endpoint under a timeout | The transport | iroh 0.96.1's `bind` hung on Windows ([iroh as a dependency](01-between-machines.md#iroh-as-a-dependency)) |

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
  - `Deadline`: one-off packets in a short queue, each dropped once its deadline passes, which ATC audio uses.
- **Priority** orders streams among streams and one-off packets among one-off packets, as [channels](01-between-machines.md#channels) ranks them, and QUIC puts waiting one-off packets ahead of stream data in every packet it builds ([sending](01-between-machines.md#sending)).
- **A send names its receivers:** `To::Crew`, every member whose link is up, or `To::Member(pilot)`, as catch-up's stream goes only to the machine catching up.
- **A received message reaches its channel's handler** with its sender's pilot ID and restart count and its input's stamp.
  The handler checks who may send it, since only units above the network can read control, as a flight-model sample made under an older control value is dropped by flight-model sync ([control](01-between-machines.md#control)).
  A message on a channel no unit registered, such as a plugin's that runs only on the other machine, is dropped.
- A channel declares no sender or receiver beyond this, which changes [decision 035](../../decisions/035-channels-declare-how-they-travel.md)'s "who sends and receives it": the network can't evaluate a role such as "the flying machine", because the session crate that knows it sits above the network.

### The first message

- The session crate registers the session channel with `me.opener(session::CHANNEL, Session::open)`, and only one unit may.
- When a connection comes up, the network asks the kernel to call `open`, which sends every session key the core holds with `cx.net().first(conn, &keys)`, and the network puts the header in front of it: Crosscheck's version, the message crate's hash, the session's code, and this core's pilot ID and restart count ([joining](01-between-machines.md#joining)).
- On a connection's first message, the network checks the header itself.
  - A code, version, or hash other than its own closes the connection with an application code naming which.
  - Otherwise it hands the keys to the session channel's handler and raises `LinkUp`.
- Until then, the network drops the connection's one-off packets and keeps its other streams' bytes in arrival order, since QUIC keeps no order across streams; after 10s with no first message, it closes the connection ([the link between two cores](01-between-machines.md#the-link-between-two-cores)).
- So the version check at join is the network's, at the backend and at the first message, and the session crate shows what the network reports.

### Links and connections

- Each connection keeps when it last heard anything, a stream's bytes or a one-off packet.
  One timer per connection fires at that time plus 5s; when it fires and something has arrived since, it's set again for the new time plus 5s, and otherwise the link is lost.
- While a link is lost, the network dials every 2s, each dial replacing the one running ([the link between two cores](01-between-machines.md#the-link-between-two-cores)).
- Of two connections whose first messages pass, the network keeps one by 01-between-machines' rule, from the restart counts and from which side dialed, comparing endpoint IDs as numbers.
- A member's 30-minute timer starts when its link is lost, or when a core opens from its session file before that member has answered.

### Moments

| Moment | Raised when | Such as |
| --- | --- | --- |
| `LinkUp { member, again }` | A connection's first message passes; `again` when the member's link was lost | The session crate lists a new member; on `again`, the cockpit stream sends its replay and traffic sends its identities whole ([coming back](01-between-machines.md#coming-back)) |
| `LinkLost { member }` | 5s with nothing on the member's connection | Pointer sync locks its displays ([while a link is lost](01-between-machines.md#while-a-link-is-lost)) |
| `MemberOut { member }` | 30 minutes without a connection to the member | The session crate counts the member out, and leaves once none is left |
| `BackendAnswered(answer)` | The backend answers a request of the session crate's, or doesn't within 10s | The session crate writes its session file, then asks `Open` |

A member here is a pilot ID, a restart count, and an endpoint ID.
These replace the code map's two, "link lost" and the link's return, which are `LinkLost` and `LinkUp` with `again`.

### Requests the session crate makes

| Request | What the network does | It answers with |
| --- | --- | --- |
| `Host { session, me }` | Draws the endpoint key, and asks the backend for a code, sending the session's ID, its relay list with tokens, and the host's member entry | `BackendAnswered`: the code, or why not |
| `Join { code, me }` | Draws the endpoint key, and looks the code up | `BackendAnswered`: the session's ID, relays, and crew, or why not |
| `Open { session, key, relays, crew }` | Binds the endpoint with that key and relay list, and dials each crew member | `LinkUp`, member by member |
| `Dial { member }` | Dials a member that another's entry names and this core holds no connection to | `LinkUp` |
| `Leave { quit }` | Closes each connection with Leave's code, or the quit code, tells the backend, and shuts the endpoint | Nothing; the session crate exits or goes on without a session |

- The session crate writes its session file between `BackendAnswered` and `Open`, because it opens links only once the file is written ([outputs](../core/01-loop-and-edge.md#outputs)).
  The key it writes is in the network's state, which the session crate reads.
- A core back from a restart sends `Open` with the crew from its session file; when no member's first message has passed within 10s, the network looks the code up, and `BackendAnswered` says whether the session still holds it ([a session file after a long outage](01-between-machines.md#a-session-file-after-a-long-outage)).
- The backend lists a host from `Host` and a joiner from its first `LinkUp`, when the network registers it; the network renews every 10 minutes, and tells the backend on `Leave` ([joining](01-between-machines.md#joining)).
- A PF who leaves hands over control before asking `Leave`, which is the session crate's ([leaving](01-between-machines.md#leaving)).

### The heartbeat and clock offsets

- The network sends a heartbeat on each connection once a second, a one-off packet carrying the last heartbeat it received on that connection: that packet's send stamp, and the stamp of the input it arrived in.
  The transport adds the packet's own send stamp as it hands the packet to QUIC, 8 bytes of µs on the PC's counter.
- From a heartbeat, the receiver takes T1 as its own earlier send stamp, echoed back, T2 as the other core's receive stamp of it, T3 as this packet's send stamp, and T4 as this input's stamp, and keeps the offset ½[(T2 − T1) + (T3 − T4)] with the shortest round trip of the last 8, as [decision 038](../../decisions/038-clock-offset-from-timed-exchange.md) has it.
- Receive stamps are the queue's, read as the edge pushes the input ([the queue](../core/01-loop-and-edge.md#the-queue)), so the error left is the time between the socket and the queue, and between QUIC and the wire, which the shortest round trip keeps small.
- The heartbeat carries no acknowledgment of the cockpit stream: the cockpit-stream crate sends its vector clock once a second on a `Newest` channel of its own, which [04-order-and-recovery](../sync/04-order-and-recovery.md#the-cockpit-stream) has ride the heartbeat.
  It costs up to one more packet a second, about 58 bytes of headers ([2.2]), and the heartbeat then knows nothing of the cockpit stream.
- Each sender's offset sits in the network's state, by pilot ID and restart count, for flight-model sync to read.

### The endpoint key

- On `Host` or `Join`, the network draws 32 bytes through `cx.random_bytes()`, from the kernel's ChaCha20 generator that the edge seeds from the operating system, a call beside `cx.new_id()` that this design adds to the kernel ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids)).
- The network signs each backend request on the loop with ed25519-dalek, the crate iroh-base builds its keys on (read in iroh-base 1.3.0, `Cargo.toml`), since Ed25519 signing reads neither a clock nor randomness ([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032#section-5.1.6)).
  Whether ed25519-dalek with its `rand_core` feature off still reaches `getrandom`, the map check shows at the first build.
- A recording's first input holds the seed, so a recording rebuilds the key, which lets whoever holds it act as that pilot's endpoint until the session ends; the session file holds the key in plain text anyway.

### What the pilot sees, and settings

- The network keeps a slice of client state: each member with its link's state and path, direct or the relay's URL, and whether this PC reaches the internet, from a `/ping` to the first relay in the session's list with a 2s timeout ([network log][win]).
- It registers two settings: the relay list, whose default each release compiles in from `relays/`, and, for development, sending through relays only, which clears the endpoint's IP transports ([two cores on one PC](01-between-machines.md#two-cores-on-one-pc)).

## The transport

### Its commands

| Command | The transport |
| --- | --- |
| `Bind { key, relays, ip }` | Builds the endpoint from `presets::Minimal` with `RelayMode::Custom` and the relays and their tokens, the 2s path idle timeout and 0.67s keep-alive, and a one-off queue of 3 packets of 1,162 bytes ([sending](01-between-machines.md#sending)); clears its IP transports when `ip` is off; and binds under a 5s timeout |
| `Dial { attempt, endpoint, relays }` | Dials the endpoint through every relay in the list, and drops any dial still running to that endpoint |
| `Close { conn, code }` | Closes the connection with that application code |
| `Stream { conn, channel, priority, bytes }` | Writes to the channel's stream on that connection, opening it with the channel's number and its priority on first use |
| `OneOff { conn, channel, key, delivery, priority, bytes, stamp }` | Puts the packet in its slot, or in its channel's deadline queue, and adds the send stamp when `stamp` is set |
| `Probe { relay }` | Asks the relay for `/ping`, with a 2s timeout |
| `Shutdown { code }` | Closes each connection with the code, then awaits `Endpoint::close` for at most 500ms, inside the 750ms [exiting](../core/01-loop-and-edge.md#exiting) gives the edges |

### Its events

| Event | Carries |
| --- | --- |
| `Bound` | The endpoint ID, or the error, or the timeout |
| `Connected` | The connection's number, the other endpoint's ID, and the dial's attempt, if this side dialed |
| `Stream` | The connection, the channel's number, and the bytes |
| `OneOff` | The connection and the bytes |
| `Closed` | The connection, and its application code or the error |
| `Path` | The connection, direct or the relay's URL, and the round trip |
| `Stats` | Once a second for each connection: packets sent and lost, the round trip, and the congestion window |
| `HomeRelay` | The relay's URL |
| `Probed` | The relay, and whether it answered |

- Connection numbers come from a counter in the transport, inside each event, so a replay sees the same numbers, as socket IDs do in [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#the-websocket-server).
- Every event is an input, so the recording holds each connection's path, loss, and round trip, which [the way through home routers](01-between-machines.md#the-way-through-home-routers) asks v1 to record.

### Sending one-off packets

- Each connection holds the newest packet for each `Newest` channel and key, and a queue for each `Deadline` channel, whose packets go once their turn comes and are dropped once their deadline passes.
- The transport hands a packet to QUIC only when `Connection::datagram_send_buffer_space` shows room, highest priority first, so a flight sample waits behind no traffic batch and no older sample ([sending](01-between-machines.md#sending)).
  Whether that matters on a direct path, where QUIC sees losses and narrows its window, is unverified, and the case run by hand settles it ([cases for the bench](#cases-for-the-bench)).
- While a connection's path is a relay, the transport sums everything it sends through that relay, over every connection, and keeps the sum below the relay's cap by holding stream data back, the lowest priority first, so a replay or a catch-up waits behind the live channels.

## The backend

### Its framework and storage

- A Cloudflare Worker in TypeScript with a plain `fetch` handler, routing its five requests by path, with no framework, as fsc-editor's Worker routes its two (read in fsc-editor, `relay/src/index.ts`).
- D1 holds three tables: sessions, members, and wrong codes.
  On the Workers Free plan, D1 allows 5 million rows read and 100,000 written a day and 5 GB in all ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), as of 2026-04-21), and a database of at most 500 MB ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- No Durable Object: fsc-editor's Worker holds one per code because it holds each session's WebSockets (read in fsc-editor, `relay/src/index.ts`, `Session`), and this backend holds no connection.
- Bug reports' files, which may pass D1's 2 MB a row, are [6.6](../architecture/plan.md#66-recording-and-bug-reports)'s to store.
- Its bodies are the message crate's types, through the TypeScript ts-rs generates ([building every target](../architecture/02-code-map.md#building-every-target)).

### Its requests

| Request | Body | Answer |
| --- | --- | --- |
| `POST /v1/sessions` | The session's ID, its relay list with tokens, the host's member entry, and Crosscheck's version and the message crate's hash | The code |
| `POST /v1/lookup` | The code, the version, and the hash | The session's ID, relays, and crew; or a refusal: no such code, a version or hash that differs, naming whose is older, or too many wrong codes |
| `POST /v1/members` | The code and the member's entry | Taken |
| `POST /v1/members/renew` | The code and the endpoint ID | Taken |
| `POST /v1/members/leave` | The code and the endpoint ID | Taken |

- Every request but a lookup carries the member's endpoint ID, a counter one past the last the backend took from that endpoint, and an Ed25519 signature over the body by the endpoint key.
  The backend refuses a counter that isn't higher, so a captured request can't be sent again, and it checks the signature through `crypto.subtle`, which lists Ed25519 for `verify()` ([Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), as of 2026-09-30), unverified until the backend's tests run.
- The path carries the backend's version, and the backend serves each version still in pilots' hands ([joining](01-between-machines.md#joining)).

### Codes, lapses, and wrong codes

- A code is six characters from the 30-character alphabet of [the invite code](../product/03-v1-scope.md#invite-code), drawn through `crypto.getRandomValues` with rejection sampling, as fsc-editor's Worker draws them (read in fsc-editor, `relay/src/index.ts`, `randomCode`).
- The code is the sessions table's key, so an insert that meets a live session's code fails, and the Worker draws again, up to 5 times, as fsc-editor's does (same file, `CODE_ATTEMPTS`).
- A member row keeps when it last renewed: a lookup lists only members renewed within 30 minutes, a session with none is free and a new session may take its code, and an hourly Cron Trigger deletes lapsed members and empty sessions.
- Each address, as `CF-Connecting-IP` names it, has a count of wrong codes for the current hour.
  A lookup reads the count first and refuses at 20, then looks the code up, and adds one only when the code is wrong.
  So a right code never counts, and an address at the limit is refused even when it guesses right, where fsc-editor's Worker counts every join through Cloudflare's rate-limiting binding (read in fsc-editor, `relay/src/index.ts`, `join`).
  With 30⁶, about 729 million codes, and 1,000 live sessions, an address's 20 guesses an hour hit one with a chance of about 1 in 36,000 (arithmetic).

## The relays

### Who hosts them

- Two servers of ours, DigitalOcean droplets in New York and Frankfurt, where p03 to p07 ran ([2.3]; [p07]), at $4 to $6 a month each (documented, [research report 06](results/2026-10-10-transport-research-reports/06-relay-hosting-and-cost.txt), as of 2026-10-10), so $8 to $12 a month for both (user, 2026-10-16).
- Two $4 droplets pool 1,000 GiB of transfer a month (same report), about 6,000 relayed session-hours at [p06]'s busy mix with 2.1's 130 to 150 bytes of overhead a relayed packet, about 168 MB an hour out of the relay (arithmetic, [2.1]).
- `iroh-relay` keeps its own certificates through its `LetsEncrypt` certificate mode (read in iroh-relay 1.3.0, `src/main.rs`, `CertMode`).
- n0's managed relays don't take [decision 033](../../decisions/033-relays-run-iroh-relay-unmodified.md)'s tokens and caps.
  Their shared relays, at $19 a month for 4 relays, a 5 MB/s limit, and 100 GB, admit an endpoint through a token n0's own preset mints from a project API key, describe no cap for each client, and lock no version below Dedicated, at $199 a month for each region (documented, [shared relays](https://docs.iroh.computer/iroh-services/relays/shared), [dedicated relays](https://docs.iroh.computer/iroh-services/relays/managed), [pricing](https://www.iroh.computer/pricing), undated, read 2026-10-16).

### Their configuration

- `relays/relays.toml` lists each relay: its region, its URL, its tokens newest first, and its cap in bytes a second, written once (user, 2026-10-16).
  - The network crate compiles each release's default relay list from it: each relay's URL, its first token, and its cap.
  - A deploy script beside it, `relays/deploy.ts`, run by Node as `tools/build.ts` is, renders each relay's `iroh-relay` configuration from the same entry, `access.shared_token` with all its tokens and `limits.client.rx.bytes_per_second` with its cap (read in iroh-relay 1.3.0, `src/main.rs`, `AccessConfig` and `RateLimitConfig`), installs it over SSH, and restarts the relay, at a quiet hour ([the relays](01-between-machines.md#the-relays)).
- The tokens go public with the repository, the same exposure as a token read out of a release ([the relays](01-between-machines.md#the-relays)).
- A relay of our own, if we ever write one, lives in `relays/` too (user, 2026-10-16).

## 01-between-machines and the code map

The code map changes nothing in 01-between-machines beyond its note of 2026-10-14, because that document names components and never units, and the split above adds detail to it.
This design changes it in five places, which its note lists:

- The heartbeat carries the clock exchange alone, and the cockpit stream acknowledges on a channel of its own.
- A channel declares its delivery and priority, a send names its receivers, and the receiving handler checks the sender.
- The relays run on two servers of ours, which settles its [left open](01-between-machines.md#left-open)'s item on who hosts them.
- The backend is a Cloudflare Worker on D1.
- The tests it gives CI run through a proxy that holds a relay's bytes back for loss, and its check of a direct path under loss runs by hand ([cases for the bench](#cases-for-the-bench)).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets](../architecture/02-code-map.md#budgets) and [01-loop-and-edge](../core/01-loop-and-edge.md#budgets)'s.

| What | Budget |
| --- | --- |
| Inputs from one link | About 140 a second from a busy PF: [p06]'s busy mix sent 121 one-off packets and 20 cockpit changes a second |
| A network handler | The code map's 1ms; most inputs only move a connection's last-heard time on and hand the bytes to a channel's handler |
| The transport | Inside 01-loop-and-edge's 2% of one CPU core for the edge's threads |
| QUIC's one-off queue | 3,486 bytes, three packets of 1,162 |
| A relay's cap | 256 KiB/s for each pilot, several times what [p06]'s busy mix sent, until the bench's peak rate sets it |
| A join | From the code entered to the first message passing within 3s, on a direct path |
| A lost link | Declared 5s after the last input on its connection, within the timer's 2ms |
| The backend | A renewal every 10 minutes is 6 writes an hour for each pilot, so D1's free 100,000 writes a day cover about 16,000 pilot-hours a day (arithmetic) |
| Memory | Inside 01-loop-and-edge's 100 MB for a busy session, beside the cockpit stream's kept messages, which are [6.9](../architecture/plan.md#69-sync)'s |
| The relays | $8 to $12 a month for two |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test.
In CI and on a developer's PC, on Windows, two cores run through a local `iroh-relay` bound to `127.0.0.1` ([network log][win]), with the production token and cap and each core's IP transports cleared ([two cores on one PC](01-between-machines.md#two-cores-on-one-pc)).
A TCP proxy sits in front of the relay, and both cores' relay list names the proxy, since a session uses one list ([joining](01-between-machines.md#joining)); the proxy can hold back or cut each core's connection through it on its own.
On iroh's relay a lost packet only holds back the packets behind it until TCP resends it, and QUIC sees no loss ([p06]), so the proxy stands in for loss by holding bytes back as TCP's resend would, about a round trip and a quarter ([2.1]), at a 1% and a 3% rate:

- Every v1 channel through the relay at both rates: the streams' p99 lateness stays within 17ms of the one-off packets', as [p06] saw.
- A core suspended for 60s: `LinkLost` after 5s; on resuming, a redial, a first message, `LinkUp` with `again`, and the cockpit stream's replay.
- A core killed and restarted: its higher restart count closes the old connection on the other side.
- The proxy cutting both cores for 10s, 30s, 60s, and 120s: the time from the cut's end to data again, the redial between relayed pilots that [p07] didn't test.
- The relay down for 40s, and a core's home relay moved.
- Two relays, with the two cores homed at different ones: both directions cross the dialed core's home relay ([p05]).
- Both cores redialing at once after a cut, each pair of dials in either order: both sides keep the same connection.
- No first message for 10s closes the connection; a wrong code, version, or hash closes it with the code naming which.
- A take-control during a cut, with the ex-PF changing the sim rate and pause alone: after the return, every machine holds the new PF's values.
- A PF's Leave mid-flight: the PM holds control within 1s; a PF's quit does the same, closes with the quit code, tells the backend, and exits within 01-loop-and-edge's 3s for a quit.
- A burst of one-off packets: QUIC's queue never holds more than three, and a flight sample never goes out after a newer one.
- Two cores read one PC's counter, so each one's estimate of the other's offset stays within 1ms of 0.
- v1's busiest session through the relay, with a replay and a catch-up beside the live channels: its peak rate sets the relay's cap.
- The backend, against a local D1: each request's answer; a code that meets a live session's drawn again; the 21st wrong code in an hour refused, and a right code from that address too; a member unrenewed for 30 minutes missing from a lookup; a counter that isn't higher refused; a signature by another key refused; a joiner on an older version told whose is older.

By hand, on our droplets, at the network's stage of the build and whenever iroh's or noq's pinned version changes, as step 3 of [iroh as a dependency](01-between-machines.md#iroh-as-a-dependency) runs the network's tests (user, 2026-10-16):

- v1's full mix on a direct path at no loss, 1%, and 3%, through `tc netem` as [p06] ran it, with and without the newest-only slots, in a program built on the network crate and the transport, since the core runs only on Windows; whether those two build on Linux, that program's first build settles.

## Left open

- The 5s, the 2s path idle timeout, the 30 minutes, the 10-minute renewal, the relay's cap, and ATC audio's buffer, which v1's recordings tune ([left open](01-between-machines.md#left-open)).
- Whether the newest-only slots change anything on a direct path, which the case run by hand settles.
- Whether a core reaches the bench's local relay over plain HTTP, as `--dev` serves it, or needs a certificate it trusts, which the bench's first run shows.
- Whether a $4 droplet's 512 MiB holds `iroh-relay` through a busy evening, which the first deployment's memory shows.
- A sweep of wrong codes from many addresses could spend D1's 100,000 free writes in a day, which would stop new sessions until the day resets; the Workers Paid plan raises the limit, and we move to it if that happens.
- Pilots in Asia and Oceania relay through New York or Frankfurt, and v1's recordings show whether a third region pays for itself.

[2.1]: log.md#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast
[2.2]: log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
[2.3]: log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
[p05]: log.md#2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
[p06]: log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
[p07]: log.md#2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
[win]: log.md#2026-10-16-iroh-relay-130-builds-and-runs-on-windows-and-in-dev-mode-answers-on-ipv6-loopback-only
