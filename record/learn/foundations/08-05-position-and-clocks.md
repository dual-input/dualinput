# Synchronization: position and clocks

- [Position and attitude: freeze and set, slew, dead reckoning, interpolation buffers, jitter, time shift, ground contact](#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact)
- [Clocks: offset estimation, sim time vs. wall time, syncing pause and sim rate](#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Replication models and authority are in [08-01-replication-models-and-authority](08-01-replication-models-and-authority.md), echo loops and initial sync in [08-02-echoes-and-initial-sync](08-02-echoes-and-initial-sync.md), ordering and classes of data in [08-03-ordering-and-classes-of-data](08-03-ordering-and-classes-of-data.md), change detection, relative actions, and flight controls in [08-04-rates-actions-and-flight-controls](08-04-rates-actions-and-flight-controls.md), and divergence and two pilots on one screen in [08-06-divergence-and-one-screen](08-06-divergence-and-one-screen.md).

As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other.

## Position and attitude: freeze and set, slew, dead reckoning, interpolation buffers, jitter, time shift, ground contact

The following machine can't fly the aircraft in step with the flying one, so it stops its own flight model and writes the flying machine's position every frame.
Samples arrive late and unevenly, so it draws the aircraft a fixed time in the past, between two samples it already holds.
Our records measured this as the smooth choice.
It costs lag, and on the AI aircraft we measured, freezing also ended the sim's hold on the ground.

**How it works.**
[04-01](04-01-connection-and-data.md#writing-data) measured the core of it on AI aircraft: frozen with the three `FREEZE_*_SET` events and written on every frame, an aircraft scored 0.17 for jitter, and every other combination fought the sim or stuttered.
FS Copilot applies the same discipline to the user aircraft.
Its module freezes the aircraft when its app says the machine is following, and releases it when its app says the machine is in control [1].
The pipeline, read from source [1] [2] [3]:

```text
flying app       read position at every simulated frame; send the newest every 50ms,
                 stamped with the app's own clock (TimeMs) and a random SessionId
following app    write the packet into the module's FSC_PHYSICS client data area
module, arrival  t = the packet's TimeMs on this machine's clock (the time shift)
                 keep the sample if t is 200ms or more after the last one kept,
                 and otherwise set it aside
module, frame    render_t = now − 400ms
                 if render_t reaches the newest kept sample, keep the one set aside too
                 between two kept samples: interpolate; past the newest: hold it
                 write 13 A: variables, from PLANE LATITUDE to VELOCITY WORLD Z
```

So while samples flow, the ones it keeps sit 200ms apart, and the 400ms delay spans two of them.
The following pilot sees the aircraft about 400ms plus the network delay behind the flying pilot.
When they stop, the sample set aside lets the aircraft end at the last position sent.
Latitude, longitude, altitude, and the velocities are interpolated in a straight line, and pitch, bank, and heading take the shorter way around the circle [3].
The time shift, which puts the sender's `TimeMs` on the receiver's clock, is in [Clocks](#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate).
Slew is the other way to stop the sim moving an aircraft (`K:SLEW_SET`, [02-03](02-03-the-running-sim.md#the-sim-loop)), and neither our records nor YourControls use it for this.

**Interpolation buffers.**
How far behind to draw depends on how often samples come and how many can be lost:

| | Samples | Drawn behind the newest | Past the newest sample |
| --- | --- | --- | --- |
| FS Copilot, user aircraft [2] | 20 a second sent, one every 200ms kept | 400ms, fixed | Holds it |
| Our fork's traffic [4] | 2 a second | The smoothed spacing of moving samples plus 200ms, growing by at most 0.25ms and shrinking by at most 2ms each frame | Carries on along the last segment for up to 600ms, then holds |
| Fiedler's rule of thumb [5] | 10 a second | 350ms: three intervals, "so that I can lose two packets in a row and still have something to interpolate towards", plus about 50ms for jitter | Extrapolates only briefly, and only for straight-line motion |

The traffic delay moves slowly because a delay tied to the spacing of the newest pair jumps every time a sample arrives, which the traffic work found when it moved from recorded files to a network [6].
No record measures why FS Copilot chose 400ms, and the profiles repo calls it an "empirical optimum" without data [7].

**Dead reckoning** carries an object forward from its last known position and velocity until the next update.
In the Distributed Interactive Simulation protocol, every machine moves an object by an agreed algorithm, and the owner runs the same algorithm and sends a new state only when the true state and the prediction differ by more than a threshold [8].
Our traffic work tried the sim's version: it wrote positions and velocities into unfrozen aircraft and let the sim carry them between 2Hz samples, which scored 0.50 and "fights the sim's own ground physics on anything that was spawned stationary" [9] [10].
Fiedler finds extrapolation workable "for short time periods (50-250ms or so)" in straight-line motion [5], and the traffic receiver's 600ms is that idea with a bound.

**Jitter** means two things.
Network jitter is the uneven spacing of arrivals, which the buffer absorbs.
Visual jitter is uneven motion on screen, which our traffic work scored for each aircraft as "mean frame-to-frame change in displacement over mean displacement": 0 for constant motion, and around 1 for standing still and then snapping [11].
BeyondATC's own taxiing traffic scored 0.56, against 0.17 for our frozen aircraft written every frame [10].

**Ground contact.**
The sim didn't clamp frozen AI aircraft to the ground, so each sat wherever the written altitude put it, above or below the local scenery ([04-01](04-01-connection-and-data.md#writing-data)), and nobody has checked the frozen user aircraft.
That made identical scenery a firm requirement for our traffic copies [10].
YourControls' source describes sending altitude with the ground's height removed below 1,000 feet and adding each machine's own ground height back, and the calls that would apply it are commented out at 31b1706 [12].
Whether a frozen user aircraft's own systems see it on the ground, through `A:SIM ON GROUND`, is unmeasured.

**What it changes for Dual Input.**
The following machine needs a writer inside the sim that runs every frame ([05-01](05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)) and a render delay long enough for the samples it gets, and that delay is lag the following pilot sees.
A landing on scenery that differs between the two machines is an open question.

**Traps.**

- A frozen aircraft written less often than the frame rate stutters: it scored 1.65 at 20Hz ([04-01](04-01-connection-and-data.md#writing-data)).
- After an outage, FS Copilot's buffer holds the last pose, then discards samples older than 3s when the next one arrives, so the aircraft stands still and then jumps (unverified) [2].
- Holding the newest sample turns every late sample into a pause, and the traffic receiver's bounded extrapolation bridges one lost sample without one [4].

## Clocks: offset estimation, sim time vs. wall time, syncing pause and sim rate

Each PC has its own clock, and each sim keeps its own time, which can pause, run at another rate, or be set.
A receiver that places samples on its own timeline needs the offset between the sender's clock and its own, and our records estimate it two ways, both from one-way stamps.
FS Copilot syncs none of pause, simulation rate, and time of day.

**How it works.**
A packet stamped when it's sent and read when it arrives gives arrival minus stamp, which is the offset between the two clocks plus that packet's trip time.
One-way packets can't separate the two.
NTP can, from a round trip: with T1 and T4 the client's send and receive times, and T2 and T3 the server's, it computes the offset as ½[(T2 − T1) + (T3 − T4)] and the delay as (T4 − T1) − (T3 − T2) [13].
The offset is the mean of the two one-way differences, so it's exact only when both directions take equal time.
NTP also keeps the last 8 samples, sorts them by delay, and uses the least-delayed, because "The first entry on the sorted list represents the best sample" [13].

Our two estimators, read from source:

| | FS Copilot, user aircraft | Our fork's traffic |
| --- | --- | --- |
| Stamps | `TimeMs` on each packet, from a .NET `Stopwatch` in the sender's app [14] | The host's time on each batch, and each sample's age within it [15] |
| Estimate | Arrival minus stamp, seeded by the first packet, then moved 1% of the way toward each new packet's [16] | The smallest arrival minus stamp seen, taken at once, and moved 0.2% of the way toward any larger one [15] |
| Trip time it keeps | The average | The shortest |

Either way, samples land on the receiver's clock about one trip after they happened, which a playout buffer absorbs.
The traffic work found two rules by measurement [6]:

- "Sample times must not be arrival times", because arrival times carry the network's jitter into the path.
- A sample's time is when the host read it, not when its batch left, which is why each sample carries its age.

**Sim time and wall time.**
The sim publishes its own clocks as `E:` variables: `E:SIMULATION TIME`, the seconds since the simulation started; `E:ZULU TIME` and `E:ABSOLUTE TIME`, the world clock; and `E:SIMULATION DELTA TIME`, the time between the last two simulated frames [17].
Whether `E:SIMULATION TIME` stops in pause or scales with the simulation rate is undocumented.
Both our position pipelines run on wall time.
FS Copilot's module reads a steady clock and ignores the frame time the sim passes it ([05-01](05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)), and its app stamps packets from a `Stopwatch` [14] [16].
The traffic work tried a render clock stepped by the frame rate the sim reports, and it "drifts from real time and snaps on re-sync" [6].

**Pause and simulation rate.**
Each machine pauses and sets its simulation rate on its own ([02-03](02-03-the-running-sim.md#the-sim-loop)), and FS Copilot syncs neither.
Read from its source, a pause on the flying machine stops its position changing, so it stops sending, and the following machine holds the last pose while its own systems keep running (unverified) [2] [14].
A raised rate on the flying machine sends positions at the pace they happen in real time, so the following aircraft moves at that pace while its own systems run at their own rate (unverified).
YourControls syncs the sim's time once, when a pilot joins ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).
The sim has events that set all three, such as `K:PAUSE_SET`, `K:SIM_RATE_SET`, and `K:ZULU_HOURS_SET`, and forum reports say the time events don't hold on MSFS 2024 ([02-03](02-03-the-running-sim.md#the-sim-loop)).

**What it changes for Dual Input.**
Dual Input needs a clock mapping for each peer on any stream it times, and has to decide whether pause, simulation rate, and time of day are shared state with an owner, like any other value.
Whether the events that set them work on MSFS 2024, and what the following machine's systems should do while the flying machine is paused, are open questions.

**Traps.**

- An offset averaged over every packet takes in every queuing spike, and a minimum doesn't, which is why NTP takes the least-delayed sample [13] [15] [16].
- FS Copilot's offset starts from the first packet, so a first packet that arrived late shifts every later sample.
  The 1% steps wear the error down by about two-thirds every 100 packets, 5s at 20 a second (unverified) [16].
- Pause reports have had bugs on MSFS 2024 ([02-03](02-03-the-running-sim.md#the-sim-loop)), so a pause sync that listens for `Pause_EX1` inherits them.

## Sources

1. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/wasm_module.cpp`: `apply_control` for the control state, `interpolate`, `apply_physics`, `dispatch`, and `Update_StandAlone`.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/stream_buffer.h`, `push`, `interpolate`, and `prune`, and `FsCopilot.Bridge.Wasm/wasm_module.h`, where `k_delay_sec` is 0.4 and `k_max_age_sec` is 3.0.
3. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/interpolators.h`.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/TrafficInterpolator.cs`, its constants and comments.
5. Documented: Glenn Fiedler, [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/), Gaffer On Games, 2014-11-30.
6. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 4, traffic: what the app needed that the prototype did not", items 3 and 4 and the two dead ends.
7. Documented, and older than the source it describes: FS Copilot profiles at d3d7689, `docs/synchronization.md`, section "Why 400ms Delay?".
8. Documented: Jesse Aronson, [Dead Reckoning: Latency Hiding for Networked Games](https://www.gamedeveloper.com/programming/dead-reckoning-latency-hiding-for-networked-games), Game Developer, 1997-09-19.
9. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/01-design.md`, section "Driving", its amendment of 2026-09-06.
10. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Jitter measured, not eyeballed — freeze + per-frame writes wins; Q16 settled" and "2026-09-06 · Baseline: BeyondATC's own traffic scores 0.56; visual confirmation of the fix".
11. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/MotionScore.cs`, the class comment.
12. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706, `src/yourcontrols/src/corrector.rs`, the comment on `Corrector`, and `src/yourcontrols/src/definitions.rs`, where every call to its methods but `on_connected` is commented out.
13. Documented: D. Mills and others, [RFC 5905, Network Time Protocol Version 4](https://www.rfc-editor.org/rfc/rfc5905), 2010-06, section 8 for the offset and delay, section 10 for the clock filter, and Appendix A.5.2, `clock_filter`.
14. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/Coordinator.cs`: the `Stopwatch`, the session ID, and `AddLink<TPacket>`.
15. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/TrafficReceiver.cs`, `OnStates` and the comment on `_hostOffset`.
16. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/time_shift.h`, and `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `dispatch`, where each physics packet's session gets its own `time_shift`.
17. Documented: MSFS 2024 SDK, [Environment Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Environment_Variables.htm): `SIMULATION TIME`, `ZULU TIME`, `ABSOLUTE TIME`, and `SIMULATION DELTA TIME`.

## Unverified claims

- **FS Copilot's following aircraft stands still through an outage, then jumps.**
  We read it from `stream_buffer.h` [2].
  Cutting the link for 10s during a flight and recording the following machine's position every frame would settle it.
- **A frozen user aircraft loses the sim's ground clamping, and whether its systems still know it's on the ground.**
  We measured the clamping on AI aircraft only ([04-01](04-01-connection-and-data.md#writing-data)), and nothing in our records reads `A:SIM ON GROUND` on a following machine.
  Writing a parked following aircraft's altitude 5 feet high, then reading `A:PLANE ALT ABOVE GROUND` and `A:SIM ON GROUND` there, parked and through a landing, would settle both.
- **What the following machine does while the flying machine pauses or runs at a raised rate.**
  We read it from the source [2] [14].
  Pausing the flying machine for 60s, then setting it to rate 4 for 60s, while comparing position, fuel, and `E:SIMULATION TIME` on both machines, would settle it, along with whether `E:SIMULATION TIME` stops in pause.
- **A late first packet shifts FS Copilot's timeline for seconds.**
  We read it from `time_shift.h` [16].
  Feeding `time_shift` a first packet 200ms late, then on-time packets, in a unit test, and logging the offset, would settle it.
