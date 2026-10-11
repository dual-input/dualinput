# Network: log

What we found about connecting the crew's machines, directly or through our relay, newest entry first.

## 2026-10-11: Two iroh endpoints in two processes on one PC, each with its own key and ports, connect directly over the PC's own address

**Asked:** can a developer run two cores on one PC, each with its own identity and ports, linked as two pilots' cores would be ([architecture plan, 2](../architecture/plan.md#2-how-the-cores-reach-each-other))?

**Expected:** yes, from iroh's design, but nobody had run it.

**Found:** [p04](../../../experiments/areas/network/p04-two-cores.mjs) started two copies of one Rust program on iroh 1.3.0 with relays turned off: one listened and printed its address, and the other dialed it and timed 20 round trips on a stream (measured on our development machine, 2026-10-11).

- Each copy drew its own key, so their endpoint IDs differed, and each bound its own ports, one IPv4 and one IPv6 socket apiece: 53293 and 53295 for the listener, 53302 and 53304 for the dialer.
- The dialer connected in 2.2ms over the PC's LAN address, and the listener named the dialer's endpoint ID as the one that connected.
- The 20 round trips took 45µs to 676µs, 68µs median, all on that direct path.

**Changed:** two cores on one PC need nothing special: a core's key gives it its own endpoint ID, and iroh binds each endpoint to free ports of its own.

**Affects:** node 2's design doc.

**Evidence:** [p04-two-cores.mjs](../../../experiments/areas/network/p04-two-cores.mjs), the program in [two-cores](../../../experiments/areas/network/two-cores/), and its output in `experiments/areas/network/results/p04-two-cores-2026-10-11-08-40-22.txt`.

## 2026-10-10: iroh moves to the relay one path idle timeout after a direct link dies and back within 60s, and at 3% loss its TCP relay's p99 lateness grows with the round trip to the relay, from 53ms at 22ms away to 534ms at 131ms

**Asked:** between real home networks, how often does iroh link two PCs directly, how much do its TCP relay's stalls cost a session's traffic against a UDP relay under the same loss, how fast does it move to the relay when a direct link dies silently, how much does a busy upload add to a session's delays, and how far does a PC's `QueryPerformanceCounter` part from true time ([architecture plan, 2.3](../architecture/plan.md#23-a-probe-across-friends-home-networks))?

**Expected:** from [2.1's arithmetic](#2026-10-10-iroh-13-leads-for-carrying-a-session-between-home-pcs-provided-its-tcp-relays-stalls-dont-show-and-its-switch-to-the-relay-can-be-made-fast), stalls of about 35ms to 70ms through a relay in the pilot's region and 145ms to 170ms across an ocean, and a move to the relay after the 15s default path idle timeout.

**Found:** [p03](../../../experiments/areas/network/p03-home-networks/) ran three times on 2026-10-10, each for 35 to 43 minutes: from our PC, and from two friends' PCs, one nearer our droplet in New York and one nearer our droplet in Frankfurt (measured 2026-10-10 with p03).
All three PCs were wired.
Each friend's relayed traffic went to the peer on our PC, and `tc netem` dropped packets only on the friend's leg, between their PC and the relay; in our own run, both ends sat behind our router, so the loss hit both legs.
The sample is two home networks plus ours.
It has no Wi-Fi, since the user expects most simmers to be wired (user, 2026-10-10), no carrier-grade NAT, no mobile link, no double NAT, no real router that picks a new public port per destination, which only a simulated NAT stood in for, and no IPv6 path between pilots, since only one PC had a public IPv6 address.

The three routers:

| | Our PC | Friend near New York | Friend near Frankfurt |
| --- | --- | --- | --- |
| Public port | One for every destination, not the PC's own port number | One for every destination, the PC's own port number | One for every destination, the PC's own port number |
| Lets in | Only replies from the address and port the PC sent to | Only replies from the address and port the PC sent to | Only replies from the address and port the PC sent to |
| UPnP, NAT-PMP, PCP | None answered | UPnP answered, an eero Pro 7, and granted a mapping | None answered |
| Public IPv6 | No | No | Yes, and 4 of 4 STUN servers answered over it |
| Idle port kept | Through 120s, gone by 150s | Through 15s, gone by 30s | Through 120s, gone by 150s |

Each idle-port check used a port that had seen one request and one reply; how long a port with steady two-way traffic lasts, the run doesn't show.

Hole punching, 10 fresh connections to each target, with the median time from the connection opening to a direct path:

| Target | From our PC | Friend near New York | Friend near Frankfurt |
| --- | --- | --- | --- |
| Simulated NAT: one port, lets anyone in | 10 direct, 105ms | 10 direct, 84ms | 10 direct, 42ms |
| Simulated NAT: one port, only replies | 10 direct, 106ms | 10 direct, 105ms | 10 direct, 42ms |
| Simulated NAT: a new port per destination | 0 direct | 10 direct, 125ms | 0 direct |
| The peer on our PC | the same PC | 10 direct, 316ms | 10 direct, 106ms |

- The friend near New York's direct paths to the new-port NAT ran to ports it never advertised, which only the open UPnP mapping on the friend's router would let in (inference).
  Between our router and the friend near Frankfurt's, which both let in only replies and neither answered UPnP, every connection went direct, because both keep one public port for every destination.
- Connections opened in a median of 24ms to 159ms, about one round trip to the relay, and moved to a direct path, where one opened, within the times above.

The switch, two runs at each path idle timeout, set through `QuicTransportConfigBuilder::default_path_max_idle_timeout` on both ends, the firewall dropping the direct path mid-session:

| Path idle timeout | To the relay | Back to direct, after the path works again |
| --- | --- | --- |
| 15s | 15.0s | 29.9s |
| 5s | 5.0s | 39.9s |
| 2s | 2.0s | 42.9s |

- All three runs matched to within 0.06s.
  The flight-model stream went silent for the whole timeout, then resumed through the relay.
- Each end's path keep-alive was a third of the timeout, 0.67s at 2s, set through `default_path_keep_alive_interval`.
  iroh's default is 5s (read in iroh 1.3.0, `src/socket.rs`, `HEARTBEAT_INTERVAL`), above a 2s timeout, so at the default an idle backup path would time out between keep-alives (inference); with the lowered keep-alive the relay path stayed open, and it took over each time.
- iroh tries hole punching again on a new connection, a network change the operating system reports, new candidate addresses on either side, and every 60s while no direct path has a round trip of 10ms or less, and retries with the same candidates at least 5s apart (read in iroh 1.3.0, `src/socket/remote_map/remote_state.rs`, `UPGRADE_INTERVAL`, `GOOD_ENOUGH_LATENCY`, `check_connections`, and `HOLEPUNCH_ATTEMPTS_INTERVAL`); all four are private.
  The three return times differ by exactly the differences between the timeouts, and each return came about 55s after the drop, 60s after the connection opened, which fits all three returning on the same 60s tick (inference).
- No switch happened that the firewall didn't cause: across 55 connections in each run, the only 6 moves from a direct path to the relay each came inside a drop.

iroh's relay against the UDP forwarder, both carrying the same session-shaped traffic at once for 150s per run, in the friend's sending direction, the worse of the two in every run with loss.
Late is delay above the run's lowest, what a playout buffer of that size would have to absorb; a share counts packets later than the threshold.

| Friend | Relay | Loss | iroh p99 late | iroh max late | Flight samples >100ms | Audio frames >60ms | Audio frames >170ms | UDP forwarder lost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Near New York | New York, 42ms away | none | 5ms | 17ms | 0% | 0% | 0% | 0% |
| | | 1% | 79ms | 555ms | 0.7% | 2.8% | 0.6% | 1.3% |
| | | 3% | 264ms | 405ms | 2.9% | 8.4% | 2.0% | 3.8% |
| | | bursts | 43ms | 144ms | 0.3% | 0.8% | 0% | 0.7% |
| | Frankfurt, 131ms away | none | 8ms | 21ms | 0% | 0% | 0% | 0% |
| | | 1% | 168ms | 444ms | 6.2% | 9.4% | 0.8% | 1.1% |
| | | 3% | 534ms | 1,085ms | 21% | 30% | 5.9% | 3.2% |
| | | bursts | 109ms | 217ms | 1.0% | 1.4% | 0.4% | 0.7% |
| Near Frankfurt | Frankfurt, 22ms away | none | 12ms | 18ms | 0% | 0% | 0% | 0% |
| | | 1% | 52ms | 239ms | 0.1% | 0.4% | 0.07% | 1.2% |
| | | 3% | 53ms | 101ms | 0.03% | 0.4% | 0% | 3.4% |
| | | bursts | 13ms | 103ms | 0.1% | 0.5% | 0% | 0.7% |
| | New York, 97ms away | none | 20ms | 138ms | 0.2% | 0.5% | 0% | 0.07% |
| | | 1% | 188ms | 379ms | 8.6% | 12% | 2.3% | 1.1% |
| | | 3% | 346ms | 583ms | 26% | 34% | 11% | 3.1% |
| | | bursts | 90ms | 199ms | 0.8% | 1.2% | 0.2% | 0.6% |

- "Bursts" dropped everything both ways for 70ms every 8s to 12s, about 0.7% of the time.
- iroh's relay lost nothing; the UDP forwarder lost about what `tc netem` dropped, and its p99 lateness stayed within 13ms through the near relay and reached 81ms through the far one at 3%, where QUIC's congestion control held datagrams back after each loss.
- The stall grows with the friend's round trip to the relay: at 3% loss, iroh's p99 lateness was 53ms at 22ms away, 264ms at 42ms, 346ms at 97ms, and 534ms at 131ms.
- With no injected loss, the path through New York lost 0.04% to 0.07% of the friend near Frankfurt's packets on its own, and those losses alone held iroh's packets up to 138ms.
- In the receiving direction, where Linux's TCP on the relay resends, the stalls were shorter: at 3% through the far relay, a p99 of 281ms against 534ms, and 171ms against 346ms.
- Flight-model samples later than 400ms: 1.6% for the friend near New York through Frankfurt at 3%, and 0.4% or less in every other run.
- Audio frames later than 120ms ran between the 60ms and 170ms columns: 17% and 21% in the two far runs at 3%, and 2.6% or less through the near relay.
- The cockpit stream, which resends, reached up to 295ms at p99 through the UDP forwarder under loss, and up to 584ms through iroh's relay.
- In our own run, with loss on both legs, iroh's p99 at 1% was 118ms through Frankfurt, 53ms from our PC, and 311ms through New York; the UDP forwarder's was 6ms and 101ms.

The real link, with no injected loss:

| | Friend near New York | Friend near Frankfurt | Our PC |
| --- | --- | --- | --- |
| Round trip to the near droplet, median (p95) | 44ms (49ms) | 24ms (30ms) | 55ms (64ms) |
| Round trip, direct to the peer on our PC | 161ms | 57ms | the same PC |
| Through the New York relay to our PC, iroh / UDP forwarder | 161ms / 156ms | 208ms / 210ms | |
| Through the Frankfurt relay to our PC, iroh / UDP forwarder | 184ms / 182ms | 76ms / 74ms | |
| Jitter, the mean change in one-way delay between packets | 0.5ms to 1.5ms | 0.2ms to 2.4ms | |
| Upload, as the station received it, median | 18.8 Mbps | 275 Mbps | 39 Mbps |
| Round trip before and during the upload | 44.5ms, 44.5ms | 21.2ms, 21.4ms | 54.1ms, 53.9ms |
| Flight model's p99 lateness before and during | 2.9ms, 4.5ms | 2.8ms, 10.6ms | 4.8ms, 4.8ms |
| Flight-model samples lost during the upload | 0% | 0.08% | 0.84% |

- No upload raised the round trip; ours lost 0.84% of the session's packets instead.
- Whether the friend near Frankfurt filled their uplink, the run can't show: at 275 Mbps to 786 Mbps, the droplet or the path may have been the limit.

Clocks, against the droplets' chrony-disciplined clocks, through the shortest of each eight exchanges over 32 to 43 minutes:

- The friend near New York's counter ran 13.1 ppm slow, the friend near Frankfurt's within 0.33 ppm, and ours 25.6 ppm fast, each the same against both droplets to within 0.5 ppm, with 95µs to 211µs of scatter.
  Two of these PCs part by up to 39 ppm, 3.4s a day (arithmetic).
- Windows Time ran on both friends' PCs and doesn't on ours.
  Both friends' system clocks sat 63ms to 115ms behind the droplets; ours sat 14.5s behind and drifted with its counter, and the friend near Frankfurt's moved 23 ppm against the droplets while its counter held.

Faults in the probe:

- Step 8, the side test between friends whose runs overlap, couldn't connect in the build friends ran: each tester opened its side endpoint before consent with relays disabled, and iroh leaves its relay transport out of such an endpoint (read in iroh 1.3.0, `src/endpoint.rs`, `From<RelayMode>`), so the relay added after consent never took effect.
  The two friends' runs overlapped: 48 minutes into serving after its test, the copy near New York dialed the one near Frankfurt with no relay address, only that PC's public IPv4 and IPv6 addresses, and timed out after 20s; it had no IPv6 of its own, and the other router lets in only replies.
  The tester's `run.rs` binds the side endpoint after consent, with both relays, in a build no friend received.
- The tester replaced its own path in Windows Firewall's rules only where the letter case matched, so the uploads carried user folder names; the committed copy blanks them, and the tester's `sysmon.rs` ignores case, in a build no friend received.

**Changed:** iroh 1.3 as it is meets both of 2.1's conditions at the user's pass lines (user, 2026-10-10):

- A 2s path idle timeout is acceptable, with the path keep-alive below it, and so is the measured return to direct, up to 60s after the direct path works again.
- iroh's relay over TCP is acceptable for v1, with an adaptive buffer for ATC audio.
  The 300ms line in [03-v1-scope](../product/03-v1-scope.md) stands, because in a busy moment, such as a heading right after takeoff, the pilot knows the answer before the controller finishes and reads back the moment the call ends.
  So relayed pilots far from the relay, on lossy links, will hear ATC past that line in v1, an accepted cost.

So 2.1's lead holds for node 2's design doc.
v1 records each session's path, loss, and relay stalls in the recording that bug reports carry, which tells how many pilots end up relayed, far from the relay, and on lossy links, and what we'd do about it waits until that data asks for it (user, 2026-10-10).
Every router here kept an idle port at least 15s, so iroh's path keep-alive, 5s by default, keeps a direct path's mapping open.

**Affects:** node 2's design doc, the ATC audio buffer, the flight-model sync's delay, and 1.4's question of how far two PCs' counters part ([01-spine](../architecture/01-spine.md#left-open)).

**Evidence:** [p03](../../../experiments/areas/network/p03-home-networks/), and its results in [results/p03-home-networks-2026-10-10](../../../experiments/areas/network/results/p03-home-networks-2026-10-10/): `analysis/digest.txt` and one summary per run in `analysis/`, from `analyze/analyze.mjs`, and `raw/`, every tester's upload with each public address replaced by a label and user folder names blanked, and the peers' and stations' logs without iroh's debug lines and the forwarder's per-packet lines.
The originals, with addresses, packet captures, and those lines, stay outside the repository.

## 2026-10-10: postcard packs every v1 message smallest but one, and which fields a message carries changes its size more than the format does

**Asked:** which binary format does the message crate use between cores, and how many bytes does each channel's message take in it ([architecture plan, 2.2](../architecture/plan.md#22-packing-a-message-between-cores))?

**Expected:** bitcode, which packs values bit by bit, to come out smallest.

**Found:** [p02](../../../experiments/areas/network/p02-formats.mjs) encoded nine sample messages, one or two per v1 channel, in six encodings, decoded each back to the value it came from, and timed an encode and a decode together (measured on our development machine, 2026-10-10).
Every message survived every encoding.
Sizes, in bytes:

| Message | postcard | MessagePack | MessagePack with field names | bitcode through serde | bitcode's own derive | wincode |
| --- | --- | --- | --- | --- | --- | --- |
| Cockpit change, entry by name, clock by pilot ID | 84 | 96 | 181 | 92 | 90 | 122 |
| Cockpit change, entry by index, clock by member slot | 27 | 37 | 120 | 35 | 35 | 61 |
| Flight-model sample, every field `f64` | 105 | 123 | 219 | 120 | 116 | 112 |
| Flight-model sample, attitude and velocities `f32` | 69 | 87 | 183 | 75 | 75 | 76 |
| Avatar pose, 27 joints and a color | 121 | 157 | 193 | 126 | 126 | 129 |
| Traffic batch, 23 aircraft | 945 | 1,165 | 3,189 | 922 | 922 | 1,013 |
| ATC audio frame, 60 bytes of Opus | 70 | 75 | 96 | 74 | 74 | 84 |
| Join, IDs and hash as bytes | 85 | 106 | 157 | 88 | 87 | 107 |
| Join, IDs and hash as text | 158 | 162 | 213 | 159 | 159 | 203 |

- postcard was smallest for 8 of the 9 messages.
  bitcode beat it only on the traffic batch, 922 bytes to 945, where bitcode's derive groups each field across the 23 aircraft.
- MessagePack without field names took 3% to 37% more than postcard, and with them 1.4 to 4.4 times as much.
  Its traffic batch, 1,165 bytes, is 3 bytes over the 1,162 a QUIC one-off packet carries at QUIC's starting packet size ([research digest](results/2026-10-10-transport-research-digest.txt)), where postcard's 945 fits.
- wincode writes bincode's format, with integers at their full width, and took 7% to 126% more than postcard.
- No encoding took longer than 6.1µs to encode and decode the traffic batch once, or 3.7µs for any other message, and wincode took under 0.3µs for every one.
  At the 75 messages a second of [2.3](../architecture/plan.md#23-a-probe-across-friends-home-networks)'s traffic, the slowest costs well under 1ms of CPU a second, so speed doesn't separate them.
- Weighted by how often each message goes, postcard's lead holds (arithmetic).
  Against bitcode's derive, it saves 11 bytes per flight-model sample, 220 bytes a second at 20 samples a second.
  bitcode's 23 bytes per traffic batch come to 56 to 260 bytes a second at the 2.4 to 11 batches of 23 a second that FS Copilot's traffic for 130 aircraft took with and without its change gate, 1.8 and 8.3 KB/s at 32 bytes a state (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · The change gate: 20 % of samples, 8.3 → 1.8 KB/s").
  With avatar poses and cockpit changes at an assumed 20 and 5 a second, postcard comes out about 100 to 500 bytes a second ahead; 2.3 records the real rates.
- Every packet carries about 58 bytes before any message, QUIC's 30 or so and IPv4's and UDP's 28, so at 75 packets a second the headers alone take about 4.3 KB/s, about ten times any difference between formats (arithmetic).
- The fields change a message's size more than the format does.
  In postcard, a cockpit change took 84 bytes carrying its entry's name and a vector clock that names two pilots by ID, and 27 bytes carrying the entry's index and each pilot's slot in the member list.
  A flight-model sample took 105 bytes in `f64` and 69 with attitude and velocities in `f32`; its position stays `f64`, because an `f32` latitude steps by about 0.4m.
  A join took 85 bytes with its IDs and hash as bytes and 158 as text.
- postcard has had "a documented and stable wire format" since 1.0.0, writes every integer wider than 8 bits as a varint, and works through serde's derives, which the crate's messages already have (documented, [postcard 1.1.3 on docs.rs](https://docs.rs/postcard/1.1.3/postcard/)).
  bitcode lists a "Stable format across major versions" as a non-goal ([bitcode 0.6.9 on docs.rs](https://docs.rs/bitcode/0.6.9/bitcode/)), and wincode has no serde support and needs derives of its own ([wincode 0.6.2 on docs.rs](https://docs.rs/wincode/0.6.2/wincode/)).

**Changed:** postcard leads for the messages between cores: smallest on all but one message, a stable wire format, and no second set of derives.
Mixing formats by channel, bitcode for traffic alone, would save 50 to 250 bytes a second for two formats to keep, so one format serves every channel.
Fewer packets save more than any format: a cockpit change that rides in the same packet as the next flight-model sample saves that packet's 58 bytes of headers, so node 2's design doc weighs putting several messages in one packet.
The larger savings are in which fields each message carries, and those belong to the parts that design the messages: naming an entry by its index in the profile, and a vector clock counter by a member-list slot rather than a pilot's ID, which [node 3](../architecture/plan.md#3-sync-and-the-session) decides, would cut a cockpit change from 84 bytes to 27; `f32` attitude and velocities would cut a flight-model sample from 105 to 69, for the flight-model sync to weigh.

**Affects:** node 2's design doc, node 3's choice of how a vector clock names its counters, and the flight-model sync.

**Evidence:** [p02-formats.mjs](../../../experiments/areas/network/p02-formats.mjs), the Rust program in [formats](../../../experiments/areas/network/formats/), and its output in `experiments/areas/network/results/p02-formats-2026-10-10-10-16-39.txt`.

## 2026-10-10: iroh 1.3 leads for carrying a session between home PCs, provided its TCP relay's stalls don't show and its switch to the relay can be made fast

**Asked:** how do the best current designs carry real-time traffic between two home PCs, directly and through a relay, and which Rust library lets us build the best of them ([architecture plan, 2.1](../architecture/plan.md#21-carrying-a-sessions-traffic))?

**Expected:** no prediction.

**Found:** six research agents read each candidate's documentation and source on 2026-10-09, and two more read the code behind the leading combinations on 2026-10-10.
We rechecked each claim below marked documented or read, as [Evidence](../../../.claude/rules/writing.md#evidence) uses the words; the rest are the agents' reads, unverified, condensed in [the research digest](results/2026-10-10-transport-research-digest.txt).

The terms, for a reader new to them:

- ICE (Interactive Connectivity Establishment) is the standard way two programs find a direct link: each gathers its addresses, they swap them, and each tests pairs of addresses, one of its own with one of the other's, and sends on the pair it settles on, the nominated pair.
- STUN is a request that asks a server which public address it arrived from.
- TURN (Traversal Using Relays around NAT) is the standard relay protocol: a program takes an allocation, a public address on the TURN server that relays to and from it.
- UPnP, NAT-PMP, and PCP are three ways a program asks a home router to open a port.
- n0 is the company that makes iroh, and noq is its fork of the QUIC library quinn.
- A relayed packet travels two legs, pilot to relay and relay to pilot.

The design the research points to, whatever the library:

1. A session starts through the relay at once and upgrades to a direct link in the background, so nobody waits on hole punching, as Tailscale does ([How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)).
2. The relay carries UDP.
   Some pilots will relay on every flight, so the relay is their whole experience (user, 2026-10-09), and over TCP one lost packet holds back everything behind it ([09-02](../../learn/foundations/09-02-transports-and-delivery.md#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation)).
3. Each channel gets its own delivery, by strict priority: a resending stream for messages that must arrive, and one-off packets for what the next message replaces.
4. Both paths stay warm, with copies sent over both while the direct link is in doubt.
   Tailscale sends on both its direct path and its relay once it stops trusting the direct one (read in tailscale/tailscale, main branch on 2026-10-10, `wgengine/magicsock/endpoint.go`, `addrForSendLocked`).
5. The standby path carries heartbeats, plus point 4's copies while the direct link is in doubt, and the flight-model stream serves as the active path's heartbeat.

Encryption isn't a requirement, because nothing a session carries is sensitive, so a transport that encrypts anyway is judged only on the bytes its encryption adds (user, 2026-10-09).
Building hole punching ourselves is out: its success rate rests on edge cases in routers we can't reproduce, and each pair it fails relays (user, 2026-10-10).

| Option | Finding a path | Relay | Channels | Where it stands |
| --- | --- | --- | --- | --- |
| iroh 1.3.0 as it is | Built in, with router ports, IPv6, and retries | iroh's, over TCP | QUIC on noq, n0's fork of quinn | Lead, on two conditions |
| iroh with TURN plugged in | iroh's | TURN, over UDP | QUIC on noq | Behind: an unstable API, and it still needs an iroh relay |
| ICE through `is`, TURN, and quinn | `is`, with our glue | TURN, over UDP | QUIC on quinn | Next if iroh fails a condition |
| WebRTC through str0m, with TURN | Built in | TURN, over UDP | SCTP, the layer WebRTC's data channels run on, with no priorities | Behind the ICE-and-quinn option |
| quinn with our own hole punching | Ours | Ours | QUIC on quinn | Set aside: the edge cases |
| Valve's GameNetworkingSockets | Built in | TURN | Lanes with priorities | Set aside: unsafe calls, C++ build |
| WebRTC through webrtc-rs | Built in | TURN | SCTP | Set aside: open relay bugs |
| rust-libp2p | DCUtR, its hole punching through a relay | Circuit relay, one stream | QUIC without one-off packets | Set aside: no one-off packets or priorities, and a relay capped by default at 2 minutes and 128 KiB |
| No hole punching | None | Any | Any | Set aside: too many relayed pairs |
| A UDP protocol of our own | Ours | Ours | Ours | Set aside: we'd build all of it |

**iroh as it is.**

- iroh reached 1.0 on 2026-06-15, with the API and wire protocol stable within a major version, and 1.3.0 on 2026-09-28 ([Iroh 1.0](https://www.iroh.computer/blog/v1)).
  One developer's write-up, [Why iroh, not libp2p or WebRTC](https://www.uniclipboard.app/blog/why-iroh-not-libp2p-webrtc), argues for it over both for a desktop app whose devices know each other.
  crates.io counted 2.0 million downloads of iroh in the 90 days to 2026-10-10, against 2.3 million for libp2p (documented, crates.io API).
- Its direct path is QUIC over UDP, with a stream per channel, `SendStream::set_priority`, and one-off packets queued ahead of the streams, the oldest dropped when the queue fills ([iroh 1.3.0 on docs.rs](https://docs.rs/iroh/1.3.0/iroh/)).
  It punches holes inside QUIC, asks the router for a port through UPnP, PCP, and NAT-PMP, prefers IPv6, and retries when addresses change.
  n0 says "roughly 9 out of 10 connections go direct", with no method (documented, [iroh FAQ](https://docs.iroh.computer/about/faq)).
- Its relay carries everything over "Outbound TCP 443", "an HTTPS connection that upgrades to a WebSocket" (documented, same FAQ, "What ports does iroh use?"), and the agents read the same in `iroh-relay/src/client.rs`.
  So on a relayed path, a lost packet holds back every channel until TCP resends it.
  TCP's RACK loss detection marks a packet lost once a packet sent after it has been acknowledged and a round trip and a quarter have passed since it was sent ([RFC 8985](https://www.rfc-editor.org/rfc/rfc8985)).
  So the lost packet, and everything behind it, arrives late by a round trip and a quarter, or by a round trip plus the gap to the next packet, whichever is longer.
  That's about 35ms to 70ms through a relay in the pilot's region, where our PC's round trip to Cloudflare's nearest site averaged 22ms, and about 145ms to 170ms across an ocean, where its round trip to New York was 117ms ([09-01](../../learn/foundations/09-01-addresses-and-link-quality.md#latency-jitter-loss-and-bandwidth-typical-figures-on-a-lan-vs-the-internet)), the lower figures at 2.3's 75 packets a second and the higher at the flight model's 20 alone (arithmetic, unmeasured).
  At 1% loss, that's a stall about every 1.3s on each leg at 75 packets a second, and every 5s at 20.
  Windows on our development machine has RACK and Tail Loss Probe on (read with `netsh int tcp show supplemental`, 2026-10-10), which governs the leg the pilot's PC sends on, and the relay's own operating system resends on the leg to the other pilot.
  When no packet follows a lost one, Tail Loss Probe, or failing that this PC's 300ms minimum resend timeout, finds the loss instead.
  The flight model would hide every such stall behind the 0.4s by which v1 accepts the following pilot sees the aircraft ([flight-model sync](../product/03-v1-scope.md#flight-model-sync)).
  A 60ms audio buffer, as FS Copilot's ATC audio used (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 3: the audio path works on one machine — Q10, Q12, Q13 settled"), would absorb most stalls through a relay in the region and play each one across an ocean as a dropout (inference).
  Counting IPv4 and its other headers, a relayed packet carries about 130 to 150 bytes of overhead, against about 55 on the direct path.
- It sends on one path at a time: only the selected path is `PathStatus::Available`, and every other is `Backup` (read in n0-computer/iroh v1.3.0, `iroh/src/socket/remote_map/remote_state.rs`, `path_status_for_addr`).
  So it sends no copies while a direct link is in doubt, and a direct link that dies silently is dropped only after the path idle timeout, 15s by default.
  The agents read that `QuicTransportConfigBuilder::default_path_max_idle_timeout` accepts lower values (unverified).
- Its relay runs as our own `iroh-relay`, whose address is a setting, and n0's [public relays](https://docs.iroh.computer/iroh-services/relays/public) are for development and hobby use (the agents' read).

**iroh with TURN plugged in** through the `unstable-custom-transports` feature (documented, [Builder on docs.rs](https://docs.rs/iroh/1.3.0/iroh/endpoint/struct.Builder.html)).
iroh learns its own public address only from an iroh relay, opens a custom path only if that path carried the handshake, and chooses a path again only when one opens or is abandoned (the agents' read of v1.3.0).
So it would keep an iroh relay of ours and the idle-timer switch, on an API with no semver promise, which broke in 1.1.0.

**ICE through `is`, TURN, and quinn.**

- `is` 0.11.1 is str0m's ICE agent as a crate of its own that does no networking itself (documented, [is on docs.rs](https://docs.rs/is/latest/is/)), and Firezone runs it in production under WireGuard.
  It hands the application one pair to send on, the last `NominatedSend`, and prunes failed pairs (read in algesten/str0m at `95e5038c`, `crates/is/src/agent.rs`), so keeping a direct and a relayed path both alive takes two agents per peer (the agents' inference).
- quinn takes a socket of ours with a made-up peer address per connection, and drops a duplicate packet with its "RFC4303-style sliding window" (read in quinn-rs/quinn at tag `quinn-proto-0.11.18`, `quinn-proto/src/connection/spaces.rs`, `Dedup`).
  STUN, TURN, and QUIC can share one port, sorted by first byte and by whether a packet came from the TURN server, if QUIC never randomizes its fixed bit, which QUIC calls greasing (documented, [RFC 9443](https://www.rfc-editor.org/rfc/rfc9443)).
- turn-client-proto 0.7.3 does TURN's channel framing, refreshes, and stale-nonce retries.
  Cloudflare grants the 1800s it asks for and relays from one of its allocations to another, but an allocation exchanges data with only 10 peer addresses over its life and silently drops an 11th, so ICE spends a slot on each remote address it checks from the relay ([the entry below](#2026-10-10-a-cloudflare-turn-allocation-exchanges-data-with-10-peer-addresses-over-its-life-and-silently-drops-everything-to-or-from-an-11th)).
  Each pilot's allocation sits in the Cloudflare data center nearest that pilot, and Cloudflare bills only traffic sent to TURN clients (documented, [Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)).
- The glue is about 2,500 to 4,000 lines plus a test harness, by one agent's estimate.
  Carrying one QUIC connection over both paths removes the glue's hardest part, moving must-arrive channels between two connections, because quinn drops the copies itself.
  It costs one round-trip estimate and one congestion window shared by both paths.

**WebRTC through str0m** keeps checking every pair and "can change the nominated pair without needing an ICE restart" (documented, algesten/str0m main branch on 2026-10-10, `docs/ice.md`), and leaves TURN to the caller (documented, its README).
Its SCTP layer serves channels from two first-in-first-out queues with no priority between them (read in algesten/sctp-proto, main branch on 2026-10-10, `src/queue/pending_queue.rs`).
It adds about 65 bytes a packet with DTLS 1.2, against about 30 for QUIC, neither counting IP and UDP headers.

Hole-punching rates come from different populations and methods, so they don't compare directly: libp2p's DCUtR connected 70% ± 7.1% of pairs directly over 4.4 million attempts ([Trautwein et al.](https://arxiv.org/abs/2510.27500)), callstats.io's WebRTC conferences needed a relay 22% of the time in 2015 and 2016 ([the 2026-10-06 entry](#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month)), iroh claims about 9 in 10 direct, and Tailscale "well north of 90%" ([NAT traversal improvements, pt. 1](https://tailscale.com/blog/nat-traversal-improvements-pt-1)).

**Changed:** iroh 1.3 as it is leads for node 2's transport, because it finds paths, opens router ports, and relays with no glue of ours, where ICE through `is` needs about 2,500 to 4,000 lines.
It leads on two conditions nobody has measured: its relay's TCP stalls mustn't show in relayed pilots' flight data and ATC audio, and its move to the relay when a direct link dies silently must be fast enough once its path idle timeout is lowered.
Neither has a pass line yet; we expect stalls across an ocean to break a 60ms audio buffer, so the user sets the audio buffer and the switch time we'd accept from 2.3's counts, before node 2 picks.
[2.3](../architecture/plan.md#23-a-probe-across-friends-home-networks) measures both, against a UDP relay under the same injected loss.
If iroh fails either, 2.1 reopens, and ICE through `is` with TURN and quinn, over one QUIC connection, comes next.
On any QUIC option, Crosscheck drops a waiting flight-model sample as soon as a newer one is ready, because QUIC's one-off queue drops the oldest only when its 1 MiB fills, thousands of stale samples at 150 bytes each (research digest).
It paces bulk transfers so they never crowd the flight model.

**Affects:** [2.3](../architecture/plan.md#23-a-probe-across-friends-home-networks), node 2's design doc, and the spine's [between machines](../architecture/01-spine.md#between-machines), which leaves the relay's language to node 2: iroh's relay is Rust.

**Evidence:** the sources linked above, and [the research digest](results/2026-10-10-transport-research-digest.txt); the agents' full reports, each with what it was asked, are in [results/2026-10-10-transport-research-reports](results/2026-10-10-transport-research-reports/), where 08a to 08d are the reads that 08's agent ran and folded into its report.

## 2026-10-10: A Cloudflare TURN allocation exchanges data with 10 peer addresses over its life, and silently drops everything to or from an 11th

**Asked:** does a Cloudflare Realtime TURN allocation stop relaying once it has exchanged data with 10 distinct peer transport addresses (IP and port), as a developer reported in [cloudflare/cloudflare-docs#33972](https://github.com/cloudflare/cloudflare-docs/issues/33972), opened 2026-10-04 and unanswered by Cloudflare as of 2026-10-10?
Node 2.1 of the [architecture plan](../architecture/plan.md), how the crew's cores carry traffic, leads with Cloudflare Realtime TURN as the relay, and a cap matters to it: a design with one relayed connection per allocation addresses one peer, but ICE checks several remote addresses from one relayed candidate.

**Expected:** no prediction, since the issue reports the cap and Cloudflare's [TURN page](https://developers.cloudflare.com/realtime/turn/) states only rates per allocation, ">5 new IP/sec" among them, and no total.

**Found:** the cap holds as the issue describes it, and it counts every peer address an allocation has sent to, heard from, or bound a channel to, across IPs, for the allocation's whole life (measured 2026-10-10 with [p01-turn-peer-cap](../../../experiments/areas/network/p01-turn-peer-cap.mjs)).
Each peer was a UDP socket on one PC, sending through a router that gave it its own public port on our public IP, the same port whatever the destination, so the relay saw each peer at the port STUN reported.

- Of 15 peers sending to one allocation in turn, 2s apart, the first 10 got every datagram through as Data indications, and the 11th to 15th got none, with no error to either side.
- Nothing reaches an 11th address either.
  Send indications to it never arrived, and ChannelBind to it failed with `400` and an empty reason phrase, the cap's only visible sign.
  The first 10 took Send indications, ChannelBind, and ChannelData in both directions.
- Sending first takes a slot.
  An allocation that had heard from nobody sent Send indications to 12 peers in turn: the first 10 received them, and the 11th and 12th received nothing, then couldn't send to it.
  A ChannelBind before any data takes one too: 10 succeeded, and the 11th and 12th got `400 ""`.
  Each peer had first opened its NAT toward the relay with a datagram whose TTL of 4 expired before Cloudflare, 9 hops away, and the relay heard none of those.
- The count spans IPs.
  An allocation heard from a second IP, 8 ports on our IP, and a third IP, the second and third being other Cloudflare allocations' relayed addresses, and then refused a fourth IP and a ninth port on our IP.
- Twenty peers sending at once got exactly 10 through, but not the first 10 sent: the 10th was refused and the 11th got through.
- Refreshing keeps the count: a 16th peer got nothing after a Refresh with `LIFETIME` 600.
- Quiet peers keep their slots.
  The allocation was refreshed, and its permission for our IP renewed, every 2 minutes.
  5.5 minutes after the 10 peers had last sent, one of them still got through and a new peer got nothing, and 10.5 minutes after, past the 600s channel lifetime, another of them got through and another new peer got nothing.
- A lapsed permission frees no slot either.
  After 5.5 minutes with no CreatePermission, a peer holding a slot got nothing, which showed the permission had lapsed.
  After a new CreatePermission, another peer holding a slot got through, and a new peer got nothing.
- A new allocation starts at zero.
  A fresh allocation heard from the same 15 peers in reverse order, took the 5 the first had refused and 5 more, and refused the last 5, which the first had taken.
  Deleting an allocation and allocating again from the same client socket also starts at zero.
- A peer that holds a slot keeps it: one sending once a second throughout got 669 of 669 datagrams through over 11 minutes.
- Two Cloudflare allocations relay to each other.
  CreatePermission and ChannelBind toward another of our allocations' relayed addresses were accepted, and data went both ways between two allocations, by Send and Data indications and by ChannelData.
  Allocations don't share one relayed IP: 8 in one run used 6 relayed IPs.
- Cloudflare grants the LIFETIME a request asks for, up to at least 1800s.
  An Allocate asking 1800s got 1800s, and Refreshes asking 1800s, 600s, and 300s got exactly that.
  An Allocate or Refresh with no LIFETIME got 600s, and so did a Refresh asking 3600s.
  turn-client-proto 0.7.3 asks for 1800s in its Allocate and in every Refresh, and ignores a Refresh response that grants under 600s (read on docs.rs, turn-client-proto 0.7.3, `src/protocol.rs`, `send_initial_request`, `poll_transmit`, and `MIN_LIFETIME`).
- Cloudflare pads the ChannelData it sends to a multiple of 4 bytes, 17 bytes of data arriving with 3 of padding, and it takes ChannelData from the client with or without padding.
- This connection forgets an idle UDP mapping after between 120s and 150s, which spoiled the permission check in two of our three idle runs.
  Cloudflare never answered the Refreshes of an allocation whose client socket had been silent for about 130s, and a peer that held a slot got nothing after 5.5 quiet minutes, presumably because each came back on a new public port (unverified).
  With every socket sending a STUN Binding request every 15s, both worked.

**Changed:** a Cloudflare allocation serves 10 peer addresses and is then spent, and nothing but a `400` on ChannelBind says so.
So a core that relays through Cloudflare must take a new allocation before it addresses an 11th, whether the peer reconnected from a new port or ICE has more remote candidates to check than the allocation has slots left.
One allocation per relayed connection spends a slot each time the peer's address changes, and ICE spends one on each remote candidate it checks from the relayed candidate, before any pair wins.
When both pilots need the relay, their two allocations can relay to each other.
Cloudflare grants the 1800s turn-client-proto asks for, so the crate's allocation doesn't lapse on its check against grants under 600s.
On a connection like this one, a socket quiet for 2 minutes loses its public port, so a core's keepalives must come more often than that, to the relay and to a direct peer alike.

**Affects:** node 2.1 of the [architecture plan](../architecture/plan.md).

**Evidence:** [p01-turn-peer-cap](../../../experiments/areas/network/p01-turn-peer-cap.mjs) and its output in [results](../../../experiments/areas/network/results/): phases 1 to 5 in `p01-turn-peer-cap-2026-10-10-08-34-08.txt`, phase 7 in `p01-turn-peer-cap-2026-10-10-08-39-06.txt`, phase 8 in `p01-turn-peer-cap-2026-10-10-09-19-51.txt`, and phase 6, with its controls, in `p01-turn-peer-cap-2026-10-10-08-54-57.txt`.
The idle runs `p01-turn-peer-cap-2026-10-10-08-36-28.txt` and `p01-turn-peer-cap-2026-10-10-08-46-48.txt` came before the keepalives: their checks on quiet peers agree, and the NAT spoiled their permission checks.
`p01-turn-peer-cap-2026-10-10-09-19-28.txt` is an identical phase 8 run that labels our IP `other-ip-1`.

## 2026-10-06: Research puts the share of pilot pairs that need the relay between 5% and 31%, and one small server's transfer covers tens of thousands of session-hours a month

**Asked:** what share of pilot pairs can't connect directly, which decides how much traffic the relay carries ([the plan](../product/plan.md)'s step 6, [01-aims](../product/01-aims.md#relay-and-license))?

**Expected:** no prediction.

**Found:** no source measured home simmers, so the share comes from other populations and from arithmetic on them, gathered by a research agent and checked against each source on 2026-10-06:

| Source | Data from | What was counted | Result | Kind |
| --- | --- | --- | --- | --- |
| [Trautwein et al.](https://arxiv.org/abs/2510.27500), the libp2p hole-punching campaign | 2022-12 | 4.4M hole punches from volunteers' clients in 859 networks to peers in about 87,000 more | 70% ± 7.1% connected directly, TCP and QUIC alike, and 97.6% of those on the first try; the authors warn their volunteers may sit on friendlier networks than most | Measured |
| [ProbeLab](https://probelab.io/blog/can-libp2p-punch-through-nats/) | Published 2026-08-03 | 43,684 IPFS peers, publicly reachable ones included, by the kind of NAT each sat behind | 3.9% behind a symmetric NAT, a lower bound, since 42.5% couldn't be told apart; a plain hole punch usually can't get through one, and the 39.7% that did, the authors doubt | Measured |
| [callstats.io, via webrtcHacks](https://webrtchacks.com/usage-stats/) | 2015-01 to 2016-02 | Conferences in the WebRTC apps of 100 or more customers, mostly conferencing products | 22% needed a relay, and 9% needed TCP | Measured by a vendor, method unpublished |
| Tailscale, [NAT traversal improvements](https://tailscale.com/blog/nat-traversal-improvements-pt-1) | Published 2025-10-15 | Connections between Tailscale's machines in typical conditions | "well north of 90%" direct | Claimed |
| [Richter et al.](https://arxiv.org/abs/1605.05606), IMC 2016 | To 2016-03 | Carrier-grade NAT (CGNAT), counted by network, not by subscriber | in 17% to 18% of fixed-line ISPs' networks and over 90% of mobile ones | Measured |

- A pair fails when both pilots sit behind a symmetric NAT, or one does and the other's router doesn't accept packets from an unknown port.
  With h the share of pilots behind a symmetric NAT, o the share of the rest whose router accepts such packets, and f the failure rate between two routers that should connect, the failing share is h² + 2h(1−h)(1−o) + (1−h)²f.
  We assumed h from 5% to 10% and f from 5% to 15%, which no source gives (unverified), and o is unknown, so the share runs from 5%, with every router accepting, to 31%, with none.
- Three things lower it, by amounts nobody has measured for a population like ours:
  - IPv6 on both ends;
  - asking the router to open a port with UPnP, NAT-PMP, or PCP, which would do nothing behind CGNAT (unverified);
  - probing many ports, which Tailscale calculates connects 98% of pairs with one symmetric NAT in about 10s at 100 probes a second, if the symmetric side has 256 ports open, while two symmetric NATs need about 170,000 probes a side ([How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)), so probing doesn't help the h² term.
- YourControls caps its own relay, Cloud Host, at 100 connections, and asks pilots to use it only when its other two modes fail ([YourControls docs](https://docs.yourcontrols.org/running.md)).
  Neither it nor FS Copilot publishes how many sessions need a relay.
- FS Copilot asks the router for a UPnP mapping at startup, waiting 3s for a device, and its NAT-PMP fallback waits another 3s but discards what it finds, so it never makes a NAT-PMP mapping.
  For each peer it then tries a hole punch through its rendezvous server for 4s, then its relay (read in the FS Copilot fork, `ahead` branch, `FsCopilot/Network/P2PNetwork.cs`, `Start` and `GetNat`, and `HybridNetwork.cs`, `DirectAttemptTimeout`; [09-03](../../learn/foundations/09-03-nat-and-traversal.md) says the same).
- The FS Copilot fork's own relay runs on a $4 DigitalOcean server with 500 GB of transfer a month (FS Copilot fork, `record/self-hosted-relay/docs/03-runbook.md`).
- A pilot sends about 5 KB/s, by an estimate from packet sizes in an FS Copilot architecture document older than its code, with the rate of variable updates assumed, not measured (FS Copilot profiles, `docs/synchronization.md`).
  At that rate, a relayed two-pilot session sends 36 MB an hour out of the relay, the direction DigitalOcean bills, so 500 GB carries about 13,900 relayed session-hours a month.

**Changed:** one $4 server carries the relayed sessions until crews fly about 46,000 hours a month in all, if 30% of them go through the relay, and more if fewer do, so the aim of about $10 a month holds while Crosscheck stays that small and sends no more than FS Copilot does; how many hours crews will fly is unknown.
Crosscheck connects directly first, with IPv6, a port opened on the router, and port probing, and falls back to the relay.
The real share for our pilots gets measured later: a script that friends run for a minute, with no sim, can report the kind of NAT each sits behind, and opt-in telemetry after launch can count the sessions that went through the relay.

**Affects:** [01-aims](../product/01-aims.md#relay-and-license), and the plan's step 6.

**Evidence:** the sources above; no probe ran.
