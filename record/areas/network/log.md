# Network: log

What we found about connecting the crew's machines, directly or through our relay, newest entry first.

## 2026-11-21: our relay in Frankfurt answers `/ping` over HTTPS on the certificate it took from Let's Encrypt

**Asked:** whether `node src/relays/deploy.ts fra` deploys the relay that [their configuration](02-units.md#their-configuration) describes, once `fra.relay.dualinput.app` points at a droplet of ours, the test stage 7 left to [stage 22](../build/plan.md#22-github).

**Expected:** iroh-relay 1.3.0 installed and checked against its SHA-256, its certificate ordered from Let's Encrypt once it runs, and `/ping` answering within the script's 60s.

**Found:** on 2026-11-21 the script reached `dualinput-relay-fra`, a $4 droplet in fra1 with 1 vCPU and 512 MiB on Ubuntu 24.04, as root over SSH.
The release's archive passed its SHA-256 check, the service started, and the script reported `fra answers at https://fra.relay.dualinput.app`.
Node then read the relay's certificate as issued by Let's Encrypt's YE1 for `fra.relay.dualinput.app`, valid to 2027-02-18 and trusted, and `/ping` answered 200 with an empty body.
`dual-input/relay-tokens` held no commit until that day, so its first `tokens.toml` holds one token for `fra`, 32 random bytes as hex, which the relay's configuration lists and the next release's build compiles in.

**Changed:** nothing in the design; the relay runs as [the network's units](02-units.md)' note of 2026-11-20 has it, one in Frankfurt and none in New York.

**Affects:** nothing beyond [stage 22](../build/plan.md#22-github)'s test.

## 2026-10-23: on a direct path 85ms away at 3% loss, the newest-only slots keep one-off packets within 39ms at p99, where without them they run up to 221ms late

**Asked:** do the newest-only slots change anything on a direct path, which [left open](02-units.md#left-open) asks, and how late does v1's busy mix run on a direct path under loss, the case [02-units](02-units.md#cases-for-the-bench) runs by hand on our droplets?

**Expected:** on a direct path QUIC sees each loss, unlike through a relay, where [p06] found the slots change nothing; so its congestion window shrinks, one-off packets queue in QUIC up to its 1 MiB default, and the packets behind them run late, which the slots bound.

**Found:** on 2026-10-23, `tools/bench/droplet` at 16091ce ran between our two droplets, `dualinput-relay-fra` in fra1 and `dualinput-relay-nyc` in nyc3, each 1 vCPU and 512 MB on Ubuntu 24.04 ([results](results/2026-10-23-droplet-run/report.txt)).
The dialer sent [p06]'s busy mix for 60s from a network namespace on the Frankfurt droplet, whose link lost packets each way at the run's rate through `tc netem`, to a listener on the same droplet with 11ms added each way, a 23ms round trip, or on the New York droplet, 83ms to 93ms away, about 85ms.
Each case ran on the transport as it ships, and on a copy with [the patch](results/2026-10-23-droplet-run/without-slots.patch) that hands every one-off packet to QUIC as it comes, with QUIC's default queue, as p06's variant (a) did.
Every connection went direct 68ms to 362ms after it opened, and in one run 1,008ms and 1,422ms after at its two ends, before its mix started, and stayed direct to its end.

How late each came above its direction's fastest one-off packet, at p99, in ms, with the slots and without:

| Round trip, loss | Flight | Audio | Cockpit stream | Session round trip |
| --- | --- | --- | --- | --- |
| 23ms, 0% | 5.4, 2.5 | 5.3, 2.9 | 5.1, 2.5 | 29.8, 24.4 |
| 23ms, 1% | 2.9, 4.7 | 4.5, 5.0 | 26.1, 27.1 | 39.5, 68.9 |
| 23ms, 3% | 6.5, 4.7 | 6.9, 5.4 | 32.6, 32.9 | 122.6, 95.3 |
| 85ms, 0% | 6.6, 4.1 | 7.3, 4.8 | 7.4, 4.3 | 132.8, 91.3 |
| 85ms, 1% | 8.1, 16.0 | 8.3, 12.3 | 29.4, 95.5 | 119.8, 95.0 |
| 85ms, 3% | 38.7, 180.3 | 34.0, 221.2 | 108.3, 183.2 | 292.7, 887.8 |

The session round trip is the whole trip, not its lateness.

- **23ms away**, the two builds came within 3ms of each other on every one-off part at every rate, and the stream's p99 rose to 26ms to 33ms under loss, about the round trip QUIC takes to resend a lost packet's stream data.
- **85ms away at 3%**, without the slots every part ran late: the flight, controls, avatar, and audio parts 180ms to 221ms at p99, the batch 122ms, the avatar coming back 321ms, the cockpit stream 183ms, and the session's round trip 888ms.
  With them, the one-off parts stayed within 39ms, the stream within 108ms, and the round trip within 293ms.
  At 1%, the slots kept the stream within 29ms, against 96ms without.
  That fits one-off packets queued in QUIC ahead of the rest while its window shrank, which this run didn't log (inference).
- **The slots drop a sample a newer one replaces**, which the report counts as lost: 0.3% of the flight, controls, avatar, and batch probes 23ms away with no loss, where QUIC lost no packet and the build without them lost none.
  Under netem's loss, each one-off part lost within 1.3 points of its rate with either build.
- **Single probes ran far late** in a few runs whose p99 stayed low, such as an audio probe 212.7ms late 23ms away with no loss and the slots, against a p99 of 5.3ms, which a stall of the droplet's one CPU would give (unverified).

**Changed:** nothing in the design: the slots stay, as the burst case already kept them, and this run settles left open's item on them.
The patch stays out of the tree, as 02-units' note of 2026-10-23 has it.

**Affects:** [02-units](02-units.md)' note of 2026-10-23, and [stage 7](../build/plan.md#7-the-network)'s exit, whose run on our droplets this is.

## 2026-10-23: Cargo.lock ran noq-proto 1.4.0 under our 1.3.0 pins, so the transport pins the crates iroh and noq are built from too

**Asked:** does the transport run the iroh and noq our experiments measured, as [iroh as a dependency](01-between-machines.md#iroh-as-a-dependency) asks?

**Expected:** yes, since the transport's `Cargo.toml` pins iroh, noq, and `iroh-relay` at `=1.3.0`.

**Found:** on 2026-10-23, building the droplet run's program for Linux showed `Cargo.lock` holding `noq-proto` 1.4.0, `noq-udp` 1.4.0, `iroh-base` 1.4.1, and `iroh-dns` 1.4.1 beside them.
iroh 1.3.0 and `iroh-relay` 1.3.0 ask for each of those as `"1.3.0"`, which Cargo reads as any 1.x from 1.3.0 (read in iroh 1.3.0 and iroh-relay 1.3.0, `Cargo.toml`), so the lock took the newest.
Every network experiment of ours that ran iroh ran 1.3.0 of all four: p03, p05, p06, p07, and two-cores (read in each one's `Cargo.lock` in `experiments/areas/network/`).
`noq-proto` holds QUIC's own logic, including the one-off packets' queue, which [sending](01-between-machines.md#sending) read in 1.3.0, so [the stage's bench run](#2026-10-22-on-the-bench-two-cores-join-in-11s-lose-the-link-50s-into-each-outage-and-get-it-back-01s-to-30s-after-and-every-channel-runs-within-8ms-of-the-others-through-a-lossy-relay) ran QUIC code no experiment had measured.
`n0-watcher`, a small crate of iroh's on its own version line, sits at 1.0.1 against the experiments' 1.0.0, and stays unpinned.

**Changed:** the transport pins the four at `=1.3.0`, without their default features, so a pin turns on nothing iroh doesn't already.
Its 12 tests pass on them, and so do the 10 cases of the bench's four network scenarios ([results](results/2026-10-23-network-scenarios-on-pinned-crates.txt)): a join through the relay took 1,088ms, the streams' p99 through a lossy relay came within 8.0ms of the one-off packets', and the cuts of 30s and longer and the relay's 40s down came back 13.5s to 28.8s after they ended, against 14.8s to 31.9s in the stage's run.

**Affects:** [02-units](02-units.md)' note of 2026-10-23.

## 2026-10-22: on the bench, two cores join in 1.1s, lose the link 5.0s into each outage and get it back 0.1s to 30s after, and every channel runs within 8ms of the others through a lossy relay

**Asked:** for stage 7 of the [build plan](../build/plan.md#7-the-network), do the network crate, the transport, and the backend pass [02-units' cases](02-units.md#cases-for-the-bench), and where do the network's [budgets](02-units.md#budgets) land?

**Expected:** the cases as 02-units words them; p06's finding that a relay's held-back bytes hold every channel back alike ([p06]); and no bound on the time from an outage's end to data again, which this first run sets.

**Found:** on our development machine, on 2026-10-22, with bench cores on one PC, everything through the bench's local relay with its IP transports cleared, the bench's backend on a local D1, and a game running beside the bench:

- **Joining:** from the code entered to the link up took 1,061ms to 1,184ms through the relay, and 1,166ms on a direct path, within the 3s budget.
  The direct path first took 4,118ms, because each core waited 3.0s after binding before it took a home relay: iroh asks each relay for the PC's address over QUIC, and a relay over plain HTTP, as the bench's and `iroh-relay --dev` are, answers no such probe.
- **A lost link:** every outage raised `LinkLost` 4,995ms to 5,001ms in.
- **Back after an outage**, from its end to `LinkUp` with `again`:

  | Outage | Back after |
  | --- | --- |
  | The proxy cutting both cores for 10s | 5.1s to 7.8s, in five runs |
  | for 30s | 16.8s and 26.8s |
  | for 60s | 14.8s and 16.3s |
  | for 120s | 30.2s and 31.9s |
  | The relay down for 40s | 18.3s and 26.2s |
  | A core suspended for 60s | 0.14s at most |
  | A joiner's dials cut for 8s | 5.3s to 9.3s, in three runs |

  The longer waits fit iroh's reconnect backoff for the home relay connection, up to 16s plus a 10s connect timeout ([iroh as a dependency](01-between-machines.md#iroh-as-a-dependency)), as p07's 23.8s did ([p07]), which this run didn't trace (inference).
- **A restarted core** linked 38ms to 204ms after it started, its `LinkUp` with restart count 1 and `again` false, and no `MemberOut` or `LinkLost` on the other core.
- **Both redialing after a cut:** a dial still running when the link came back connected too, and the link's rule moved both cores onto one connection, raising `LinkUp` up to 3 times on each core; a stream probe sent before a move was lost with the connection it left, as [links](02-units.md#links) expects, and probes sent 3s after the link came back all arrived.
- **Through a relay holding the sender's bytes back**, on release builds, 20s of the busiest mix each, with every probe arriving and no newest probe after a newer one:

  | Round trip to the relay, held back | p99 of the stream | of the newest-only channel | of the deadline channel |
  | --- | --- | --- | --- |
  | 22ms, 1% | 40.4ms | 38.9ms | 40.2ms |
  | 22ms, 3% | 40.6ms | 42.3ms | 40.6ms |
  | 84ms, 1% | 148.2ms | 148.4ms | 140.8ms |
  | 84ms, 3% | 150.6ms | 154.4ms | 152.7ms |

  The stream's p99 came within 7.4ms of the one-off packets', inside the case's 17ms, as [p06] found.
  The proxy draws its hold once for each read, and a read can carry several of the relay's frames, so in a burst fewer than 1% or 3% of packets were held.
- **A held-back pair:** with one of three cores held back, the other pair's one-off packets came at a p99 of 0.3ms, and the held core's at 154ms.
- **The busiest mix**, p06's 121 one-off packets and 20 stream messages a second for 65s, on release builds: the sender's busiest second through the relay carried 35,102 bytes, 7.5 times under the cap of 262,144, and each core used 1.9% to 2.0% of one CPU core in all; the receiver's loop took 9,255 inputs in its first minute, 154 a second, busy 0.09% of it, its queue's wait at 13µs p99 and 2.1ms at most, none over 1ms.
- **Two relays:** with the host homed at one and the joiner at the other, the joiner's dial put both directions through the host's home relay, 124,207 and 123,987 bytes into it in 5s and none into the other, as [p05] found.
  The host's home relay cut from it for 60s lost the link, which came back 2.0s after the cut ended, and the host homed at the other relay meanwhile.
- **Clock offsets:** each core's estimate of the other's offset came to between −164µs and 163µs.
- **Refusals:** the host refused a core opening under another code with code 10, `WRONG_CODE`.
  A core that sent no first message never linked, but the host's 10s timeout never fired: the silent core took the host's first message, so its own link came up, heard nothing for 5s, and redialed, closing each connection before the host's 10s ran out.
- **Plain HTTP:** a core reached the bench's relay over `http://` with a test token, which settles [left open](02-units.md#left-open)'s item.

Not in this run: QUIC's queue holding no more than 3,486 bytes, which the transport keeps by handing a packet over only when the queue has room for it; a refusal for another version or hash, and the refused side's notification, which the network crate's tests cover; and the backend's requests, which its tests run against a local D1 in `tools/check.ts`.

The first runs measured lateness and offsets through a proxy that waited a timer tick, about 15.6ms on Windows, on every read, which gave every probe a p99 of about 20ms and the offsets 3.8ms; the table and the offsets above come after its fix.

**Changed:**

- The transport asks no relay over plain HTTP for QUIC address discovery.
- The bench's proxy writes a read at once when nothing holds it back, and asks Windows for 1ms timers.
- The bench's refusal case asserts that a core sending no first message never links, where 02-units' case has the host close it after 10s, since the silent core closes each connection first; only the network crate's tests hold a connection silent for 10s.
- The redial case counts each `LinkUp` after the cut rather than expecting one, and sends its probes 3s after the link comes back, since a dial still running moves the link and loses what went out before the move.
- The restart case waits for the other core's `LinkUp`, since the restarted core opens from its session file before the bench connects to it, and tells the bench nothing it can hear.
- The cap stays 256 KiB/s: v1's busiest session also carries a replay and a catch-up, which come with stage 13's cockpit stream, and its peak sets the cap then.
- What the build settled beside these is in [02-units](02-units.md)'s note of this date.

**Affects:** [02-units](02-units.md)' budgets, cases, and left open; [01-between-machines](01-between-machines.md)' coming back.

**Evidence:** [results/2026-10-22-stage-7-bench.txt](results/2026-10-22-stage-7-bench.txt), each run's output and the receiver's loop stats.

## 2026-10-16: iroh-relay 1.3.0 builds and runs on Windows, and in dev mode answers on IPv6 loopback only

**Asked:** for node 6.4, can CI's Windows runners build and run the `iroh-relay` that the network's tests run through ([01-between-machines](01-between-machines.md#two-cores-on-one-pc)), since CI runs on Windows only ([02-code-map](../architecture/02-code-map.md#ci))?

**Expected:** no prediction; our relays ran on Linux droplets, and nobody had built `iroh-relay` on Windows.

**Found:** on our development machine, on 2026-10-16:

- `cargo install iroh-relay --version =1.3.0 --features server --locked` built a 9.7 MB `iroh-relay.exe` in 50s.
- Started with `--dev`, it answered `/` with 200, `/ping` with 200 and an empty body, and `/generate_204` with 204 on `http://[::1]:3340`, while every request to `http://127.0.0.1:3340` timed out.
- Dev mode binds `[::]:3340` (read in iroh-relay 1.3.0, `src/main.rs`, `DEV_MODE_HTTP_PORT`), and on Windows "an IPv6 socket created on Windows Vista and later only operates over the IPv6 protocol" unless the program turns `IPV6_V6ONLY` off (documented, [Dual-stack sockets](https://learn.microsoft.com/en-us/windows/win32/winsock/dual-stack-sockets)), which fits the timeouts (inference; `netstat -ano` showing only `[::]:3340` would settle it).
- `/ping` answers anyone, with no check of the relay's tokens (read in iroh-relay 1.3.0, `src/server.rs`, `probe_handler`).

**Changed:** a Windows PC builds and runs `iroh-relay` 1.3.0, so CI's Windows runners likely can too (unverified until CI's first run).
CI should bind it to an address the cores dial, such as `http_bind_addr` set to `127.0.0.1:3340` (read in iroh-relay 1.3.0, `src/main.rs`), which no run has tried yet.
A core can ask any of our relays for `/ping` with no token, to tell whether the PC reaches the internet.

**Affects:** [02-units](02-units.md)'s cases for the bench, and its internet check.

**Evidence:** [results/2026-10-16-iroh-relay-on-windows.txt](results/2026-10-16-iroh-relay-on-windows.txt), the build's last lines and each request's result.

## 2026-10-11: after a total outage, a redialed connection carries data 0.3s to 1.4s after the link returns, while one that lived through a 10s outage takes 5s to 7s

**Asked:** for node 2's revision, when everything between two pilots stops for 10s, 30s, 60s, or 120s, how long after the link returns does data flow again, on the same connection where it lives and through a redial where it doesn't, and when does iroh's relay connection come back ([architecture plan, 2](../architecture/plan.md#2-how-the-cores-reach-each-other))?

**Expected:** a connection inside QUIC's 30s idle timeout picks up within a round trip or two; past it, the redial connects on its first attempt after the link returns; iroh's relay connection comes back within its reconnect backoff of up to 16s plus its 10s connect timeout (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `ExponentialBuilder` and `CONNECT_TIMEOUT`).

**Found:** [p07](../../../experiments/areas/network/p07-outage/) ran twice on 2026-10-11, once at iroh's default path timers, a 15s path idle timeout and a 5s keep-alive, and once at the v1 timers 2.3 accepted, a 2s idle timeout and a 0.67s keep-alive.
Endpoint A ran in a network namespace of its own on the Frankfurt droplet, behind a NAT that keeps its port, and endpoint B beside New York's relay.
Both listed both relays and kept their direct addresses, so they connected directly, with an 84ms round trip, and each sent the flight-model stream, 20 packets a second.
A's endpoint ID was the lower, so A dialed, and after a connection closed it started a dial every 2s, each left running up to 30s, until one connected.
`tc netem` then dropped every packet both ways on A's link, direct and relayed alike, for 10s, 30s, 60s, and 120s, each followed by 90s with the link back.
The link itself stayed up, so neither operating system saw a network change.
A fresh packet is one its sender made after the link came back.

| Outage | Timers | The connection | Fresh data after the link came back, A to B / B to A | Carried by | A's home relay connected again, after the link came back |
| --- | --- | --- | --- | --- | --- |
| 10s | default | lived | 5.4s / 5.2s | the relay | never dropped |
| | v1 | lived | 7.1s / 7.2s | the relay | never dropped |
| 30s | default | lived | 1.3s / 2.1s | the relay | 3.7s |
| | v1 | timed out 30.2s after the drop | 0.4s / 0.4s | a redialed direct connection | 2.7s |
| 60s | default | timed out 34.3s after the drop | 1.4s / 1.4s | a redialed direct connection | 8.7s |
| | v1 | timed out 30.1s after the drop | 0.3s / 0.3s | a redialed direct connection | 20.1s |
| 120s | default | timed out 30.2s after the drop | 0.4s / 0.4s | a redialed direct connection | 23.8s |
| | v1 | timed out 30.1s after the drop | 0.4s / 0.5s | a redialed direct connection | 16.2s |

- Each row is one run.
- A connection that lived through a 10s outage was the slowest to recover.
  In the default run, A's direct path stopped sending about 3s into the outage, once its 12,000 B congestion window was full of packets nobody had acknowledged, and QUIC counted none of them lost, so from then on it sent only probes, at growing intervals.
  After the link came back it sent nothing more on that path, and 15s after the drop the path's idle timeout closed it; the relay took over, and data flowed through it at once.
- In the v1 run, both ends moved to the relay 2.0s into the outage, though A's dead link cut that path too.
  When the link came back, B received 71 of A's packets made during the outage within 1s, but nothing of B's reached A for 6.9s, and then B's QUIC counted 73 packets lost.
  Why B's packets waited, the run doesn't show; the relay's TCP connection to A backing off its resends through the outage would fit (unverified; an `ss` sample of the relay's socket to A during the recovery would settle it).
- In the default run's 30s outage, both ends had moved to the relay 15s in, data resumed through it, and the direct path returned 4.4s after the link.
  After each 10s outage, the direct path returned 19.0s to 19.3s after the link.
- The connection timed out 30.1s to 30.2s after the drop, and 34.3s once, so a 30s outage sits on the edge: the default run's connection lived through it and the v1 run's didn't.
- Every redial connected 0.2s to 1.3s after the link came back, directly, to the address B's endpoint address carried.
  Every attempt started during the outage connected too, up to 15 of them within 6.5s of the link's return, and A closed all but the first.
- A's home relay connection dropped 3.3s to 9.3s into each outage of 30s or more, and came back 2.7s to 23.8s after the link, within iroh's backoff of up to 16s plus its 10s connect timeout.
  No redial waited for it, since each went direct.

**Changed:** a connection that outlives a short outage recovers 5s to 7s after the link returns, because QUIC waits out its own backed-off probes, while a fresh connection carries data within 1.4s.
So node 2's design can't leave recovery to the surviving connection; one option is a second connection dialed alongside a silent one, keeping whichever carries data first, which p07 didn't test.
The v1 timers don't help here: they move traffic to the relay sooner, but a total outage cuts the relay too, and their 10s recovery was the slower of the two.
A redial should cancel its older attempts, since every attempt still running connects when the link returns.
How a redial fares between pilots who reach each other only through a relay, p07 didn't test.

**Affects:** node 2's design doc: how a core notices a dead link, when it redials, and what it does with a connection that survives.

**Evidence:** [p07](../../../experiments/areas/network/p07-outage/), and its results in [results/p07-outage-2026-10-11](../../../experiments/areas/network/results/p07-outage-2026-10-11/): `analysis.txt` from `analyze.mjs`, with each outage's timeline, and `raw/`, both endpoints' logs and the outage script's times, with the droplets' addresses replaced by their station names.

## 2026-10-11: on iroh's relay under loss, v1's streams run as late as its one-off packets and no later, because QUIC never sees a loss there, so a sender that keeps only each channel's newest packet changes nothing

**Asked:** for node 2's revision, on iroh's relay under loss, do v1's one-off channels starve the session and cockpit streams, and does a sender that keeps only each channel's newest datagram, handing it to QUIC only when QUIC's datagram buffer has room, fix it ([architecture plan, 2](../architecture/plan.md#2-how-the-cores-reach-each-other))?

**Expected:** under loss, QUIC's congestion window shrinks, datagrams queue in front of the streams' packets, up to the 1 MiB QUIC holds by default (read in noq-proto 1.3.0, `src/config/transport.rs`, `datagram_send_buffer_size`), and the streams fall behind; the newest-only sender bounds that queue.

**Found:** [p06](../../../experiments/areas/network/p06-relay-mix/) ran 24 runs of 60s on 2026-10-11 between two endpoints on our droplets, every packet through iroh's relay, with direct addresses off through `clear_ip_transports()`.
The dialer ran in a network namespace of its own on the Frankfurt droplet, whose link `tc netem` dropped packets on both ways, standing in for a pilot's lossy home link; the listener ran beside the relay under test.
Near was Frankfurt's relay with 11ms added each way, a 22ms round trip; far was New York's relay, an 84ms round trip.

The dialer sent all of v1's channels:

- as datagrams: the flight model, 20/s at 130 B; flight controls, 20/s at 40 B; avatar poses, 20/s at 121 B; ATC audio, 50/s at 70 B; and traffic batches of 945 B;
- on one stream, cockpit changes of 84 B;
- on another, a 64 B session request each second, which the listener answered at once.

The listener sent avatar poses back.
The quiet mix sent batches at 2.4/s and cockpit changes at 5/s, 97 kbps of payload; the busy mix sent 11/s and 20/s, 172 kbps.
Sender (a) handed every datagram to `send_datagram` as it was made, at iroh's defaults.
Sender (b) set `datagram_send_buffer_size` to 3,600 B, three 1,200 B packets, kept each one-off channel's newest datagram in a slot of its own, and handed the oldest slot to QUIC whenever `datagram_send_buffer_space()` had room.

Late is one-way delay above the run's lowest that way, so it's what a playout buffer would have to absorb; the session's figure is its round trip, whose p99 over 61 exchanges is the slowest.
Each cell is sender (a) / sender (b), in ms:

| Relay | Loss | Mix | Flight model's p99 late | Cockpit stream's p99 late | Session round trip, p99 |
| --- | --- | --- | --- | --- | --- |
| Frankfurt, 22ms | none | quiet | 2 / 2 | 1 / 1 | 24 / 25 |
| | | busy | 3 / 3 | 2 / 3 | 26 / 27 |
| | 1% | quiet | 32 / 30 | 33 / 31 | 68 / 164 |
| | | busy | 31 / 31 | 31 / 31 | 57 / 76 |
| | 3% | quiet | 45 / 47 | 33 / 46 | 204 / 100 |
| | | busy | 45 / 45 | 45 / 45 | 114 / 128 |
| New York, 84ms | none | quiet | 7 / 3 | 7 / 4 | 91 / 88 |
| | | busy | 4 / 5 | 4 / 5 | 90 / 92 |
| | 1% | quiet | 107 / 106 | 107 / 107 | 257 / 255 |
| | | busy | 108 / 107 | 108 / 106 | 337 / 190 |
| | 3% | quiet | 138 / 148 | 130 / 131 | 316 / 413 |
| | | busy | 169 / 143 | 177 / 156 | 314 / 286 |

- Every packet arrived in every run, on every channel.
- QUIC counted no lost packet and no congestion event in any run, on either end, and its congestion window stayed at its initial 12,000 B.
  The relay's TCP resent what `tc netem` dropped, so QUIC saw a late packet, never a lost one, and its datagram buffer, sampled each second, never held more than 361 B.
- So sender (b) never replaced a datagram, and none waited in a slot longer than 0.2ms at p99.
  Both senders put the same packets on the wire at the same moments, so the gaps between their columns, up to 26ms at p99 on the flight model and the cockpit stream, are the spread between runs; the session's p99 is its one slowest exchange, so it spreads further.
- In every run with loss, the cockpit stream's p99 came within 17ms of the flight model's, above it in some runs and below in others, and ATC audio's within 9ms.
  The relay's TCP connection carries every QUIC packet in one byte stream, so a resend holds up everything behind it, whatever channel it carries.
- The busy mix's 172 kbps added no lateness beyond the spread between runs.
- Lateness grows with the round trip to the relay, as in [2.3](#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms): at 1% loss, the flight model's p99 was 30ms to 32ms at 22ms away and 106ms to 108ms at 84ms.
  At 3% through Frankfurt, its p99 of 45ms to 47ms sits beside 2.3's 53ms for the friend 22ms from Frankfurt.
- The flight model's longest silence was 316ms, at 3% loss.

**Changed:** on iroh's relay, nothing the sender does with its channels changes when they arrive, because the relay's TCP connection holds them all alike, and the session and cockpit streams share the one-off channels' lateness, so 2.3's accepted cost for ATC audio covers them too.
Node 2's design needs no newest-only sender for the relay path.
Whether it needs one on a direct path, where QUIC sees losses itself and shrinks its congestion window, p06 didn't test, because its packets never went direct.

**Affects:** node 2's design doc, its sender's handling of datagrams and its priorities between channels.

**Evidence:** [p06](../../../experiments/areas/network/p06-relay-mix/), and its results in [results/p06-relay-mix-2026-10-11](../../../experiments/areas/network/results/p06-relay-mix-2026-10-11/): `analysis.txt` from `analyze.mjs`, with every channel's counts and lateness per run, `netem-events.json`, and `raw/`, both endpoints' logs of every packet, with the droplets' addresses replaced by their station names.

## 2026-10-11: when two endpoints home at different relays, iroh carries both directions through the dialed endpoint's home relay, so whoever dials picks the relay

**Asked:** for node 2's revision, when two pilots' endpoints home at different relays, which relay carries each direction ([architecture plan, 2](../architecture/plan.md#2-how-the-cores-reach-each-other))?

**Expected:** no prediction; each sender could have used its receiver's home relay, the one each endpoint's address names, or both directions could have shared one.

**Found:** [p05](../../../experiments/areas/network/p05-relay-homes/) ran twice on 2026-10-11 between two endpoints on our droplets, with direct addresses off through `clear_ip_transports()`.
The endpoint on the Frankfurt droplet homed at Frankfurt's relay and the one on the New York droplet at New York's, as each one's `home_relay_status()` reported.
In each run the dialer sent the flight-model stream, 20 packets a second, for 10s, then the listener sent it back for 10s, and `ss` on both droplets counted each endpoint's bytes on its TCP connection to each relay:

| Who dials | Direction | Frankfurt's relay, sender sent / receiver received | New York's relay, sender sent / receiver received | Path both ends selected |
| --- | --- | --- | --- | --- |
| Frankfurt's endpoint | Frankfurt to New York | 0 B / no connection | 48,734 B / 52,334 B | New York's relay |
| | New York to Frankfurt | no connection / 0 B | 49,037 B / 51,035 B | New York's relay |
| New York's endpoint | New York to Frankfurt | 48,734 B / 52,334 B | 0 B / no connection | Frankfurt's relay |
| | Frankfurt to New York | 49,036 B / 52,690 B | no connection / 0 B | Frankfurt's relay |

- The dialer opened a second relay connection, to the dialed endpoint's home relay, and connected in 339ms and 343ms.
  The dialed endpoint never opened the dialer's home relay, and the selected path didn't change in either run.
- The round trip through the shared relay had a median of 85ms to 88ms on both ends in both runs, the same either way, because each endpoint sat beside its own relay.
- iroh sends to a remote through the relay its address names if it already holds a connection there, otherwise through a relay it holds that has heard from that remote, and only otherwise opens the named relay (read in iroh 1.3.0, `src/socket/transports/relay/actor.rs`, `active_relay_handle_for_endpoint`).
  The dialer holds no connection to the dialed endpoint's relay, so it opens one, and the dialed endpoint answers on the path it heard the dialer on, through its own home relay (inference from the selected paths).
- Each run lasted about 30s, so whether iroh ever moves a long relayed session to the other relay, we haven't measured.

**Changed:** which pilot dials decides which relay carries a relayed session, and so whose TCP leg to the relay crosses the distance between them.
[2.3](#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms) found that a lossy pilot's stalls grow with that pilot's round trip to the relay, so the dialed pilot keeps a short leg and the dialer takes the long one.
Node 2's design has to say who dials, because a rule chosen for another reason, such as the lower endpoint ID dialing, picks the relay by chance.

**Affects:** node 2's design doc, its rule for which pilot dials and redials.

**Evidence:** [p05](../../../experiments/areas/network/p05-relay-homes/), and its results in [results/p05-relay-homes-2026-10-11](../../../experiments/areas/network/results/p05-relay-homes-2026-10-11/): `analysis.txt` from `analyze.mjs`, and `raw/`, both endpoints' logs and the `ss` samples, with the droplets' addresses replaced by their station names.

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

Clocks, against the droplets' chrony-disciplined clocks, through the shortest of each eight exchanges, over 35 minutes for our PC, 43 minutes for the friend near Frankfurt, and 3.5 hours for the friend near New York, whose copy went on serving after its test:

- The friend near New York's counter ran 13.4 ppm slow, the friend near Frankfurt's within 0.33 ppm, and ours 25.6 ppm to 25.8 ppm fast, each the same against both droplets to within 0.5 ppm, with 95µs to 249µs of scatter.
  Two of these PCs part by up to 39 ppm, 3.4s a day (arithmetic).
- Windows Time ran on both friends' PCs and doesn't on ours.
  The friends' system clocks sat 63ms to 66ms and 184ms to 187ms behind the droplets; ours sat 14.5s behind and drifted with its counter, and the friend near Frankfurt's moved 23 ppm against the droplets while its counter held.
- These figures were corrected on 2026-10-11 against [p03's digest](../../../experiments/areas/network/results/p03-home-networks-2026-10-10/analysis/digest.txt), which the entry first misquoted.

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
On any QUIC option, Dual Input drops a waiting flight-model sample as soon as a newer one is ready, because QUIC's one-off queue drops the oldest only when its 1 MiB fills, thousands of stale samples at 150 bytes each (research digest).
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

**Changed:** one $4 server carries the relayed sessions until crews fly about 46,000 hours a month in all, if 30% of them go through the relay, and more if fewer do, so the aim of about $10 a month holds while Dual Input stays that small and sends no more than FS Copilot does; how many hours crews will fly is unknown.
Dual Input connects directly first, with IPv6, a port opened on the router, and port probing, and falls back to the relay.
The real share for our pilots gets measured later: a script that friends run for a minute, with no sim, can report the kind of NAT each sits behind, and opt-in telemetry after launch can count the sessions that went through the relay.

**Affects:** [01-aims](../product/01-aims.md#relay-and-license), and the plan's step 6.

**Evidence:** the sources above; no probe ran.

[p05]: #2026-10-11-when-two-endpoints-home-at-different-relays-iroh-carries-both-directions-through-the-dialed-endpoints-home-relay-so-whoever-dials-picks-the-relay
[p06]: #2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing
[p07]: #2026-10-11-after-a-total-outage-a-redialed-connection-carries-data-03s-to-14s-after-the-link-returns-while-one-that-lived-through-a-10s-outage-takes-5s-to-7s
