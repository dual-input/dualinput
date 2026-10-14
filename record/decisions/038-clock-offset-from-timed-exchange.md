# 038: A receiver estimates each sender's clock offset from one timed exchange a second

Each core's heartbeat carries one clock exchange a second with each other core, and a receiver takes that sender's offset as NTP, the Network Time Protocol, does, ½[(T2 − T1) + (T3 − T4)], from the exchange with the shortest round trip of the last 8.
The estimate starts afresh when the sender's restart count rises, and the recording keeps each sender's offset estimate and restart count once a second.
Decided by the user on 2026-10-11, in node 2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-receiver-estimates-each-senders-clock-offset-from-one-timed-exchange-a-second).

## Context

Every stamp in a message is µs on the sender's PC's `QueryPerformanceCounter`, and a receiver reads a sender's stamps through an offset it keeps estimating for that sender ([decision 024](024-times-in-microseconds-on-monotonic-clock.md)), which the flight-model sync uses.
The spine left three questions open: how a receiver estimates that offset, what a higher restart count does to it, and how far two PCs' counters part in practice ([01-spine](../areas/architecture/01-spine.md#left-open)).
2.3 answered the last: its three PCs' counters ran from 13.4 ppm slow to 25.8 ppm fast, so two parted by up to 39 ppm, 3.4s a day ([network log, 2.3][n23]).

## Options

1. **One offset, estimated once.**
   Two PCs' counters part by up to 39 ppm, 3.4s a day, so one estimate doesn't hold ([network log, 2.3][n23]).
2. **FS Copilot's estimate for the user aircraft: arrival minus stamp on one-way packets, seeded by the first packet, then moved 1% of the way toward each new packet's.**
   One-way packets can't separate the offset from the trip time, an offset averaged over every packet takes in every queuing spike, and a first packet that arrived late shifts every later sample ([08-05](../learn/foundations/08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
3. **Our fork's estimate for traffic: the smallest arrival minus stamp seen, moved 0.2% of the way toward any larger one.**
   A minimum leaves out the queuing spikes, but one-way packets still can't separate the offset from the trip time (same chapter).
4. **NTP's: from a round trip's four stamps, the offset ½[(T2 − T1) + (T3 − T4)], keeping the exchange with the shortest round trip of the last 8.**
   It assumes both directions take equal time, so it's off by up to half the difference between them, which a relayed connection can make larger than a direct one, and the offset can step when the connection moves between paths ([01-between-machines](../areas/network/01-between-machines.md#clock-offsets)).

## Decision

Option 4, with one exchange a second on each core's heartbeat.
2.3 estimated each PC's counter against our droplets the same way, through the shortest of each eight exchanges, and the estimates scattered by 95µs to 249µs ([network log, 2.3][n23]).
At 39 ppm, an estimate 8s old is off by 0.3ms (arithmetic).
On one-off packets, a lost exchange costs nothing but its place among the 8 ([01-between-machines](../areas/network/01-between-machines.md#clock-offsets)).
A higher restart count from a sender starts its estimate afresh, since the count says the sender's timeline may have changed ([01-spine](../areas/architecture/01-spine.md#times)).

## What it commits us to

- The heartbeat, which each core sends once a second whatever its sim is doing, carries a clock exchange with each other core ([decision 035](035-channels-declare-how-they-travel.md)).
- The recording keeps each sender's offset estimate and restart count once a second, so a bug report's recordings line up in time ([recording and bug reports](../areas/product/03-v1-scope.md#recording-and-bug-reports)).
- It answers the spine's questions of how a receiver estimates a sender's offset, what a higher restart count does to it, and how far two PCs' counters part ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It leaves open the error when a connection's two directions take unequal times, which is half the difference.
- It leaves to the flight-model sync easing the offset the following machine applies when it steps ([01-between-machines](../areas/network/01-between-machines.md#clock-offsets)).

[n23]: ../areas/network/log.md#2026-10-10-iroh-moves-to-the-relay-one-path-idle-timeout-after-a-direct-link-dies-and-back-within-60s-and-at-3-loss-its-tcp-relays-p99-lateness-grows-with-the-round-trip-to-the-relay-from-53ms-at-22ms-away-to-534ms-at-131ms
