# Flight model: flight-model sync

```text
Purpose:     How the flying machine's pose, velocities, and flight controls reach each following machine's aircraft, and on which clock each sample is stamped.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../core/03-sim-seam-and-wasm-module.md, ../network/01-between-machines.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../session/02-units.md, log.md
Decides:     Who reads the flying aircraft, and how often; what a sample carries; the clock our WASM module stamps on, and how it learns the core's; whether a page's arrival stamp matters; how a following machine takes a sample, draws the aircraft, carries it through a gap or a pause, eases it back, and starts; how it eases the clock offset; when each routine runs; what this adds to our module; the budgets; and the cases for the bench (node 6.10).
```

On the flying machine, a routine in our WASM module, `Lead`, reads the aircraft's pose, velocities, control surfaces, and toe brakes about 20 times a second, each read stamped with its frame's time, and the core sends each read to the crew as a sample.
On each following machine, `Follow` draws the aircraft 400ms behind those samples, along straight lines between them, carries it on through a gap of up to 2s, holds it through the flying machine's pause, and eases it back over 3s.
Our module keeps an estimate of the core's counter, from a stamp the core puts in every slot it writes, so every routine runs on the core's timeline and the core never estimates the module's clock.

This answers node 6.10 of the [architecture plan](../architecture/plan.md#610-flight-model-sync).
[03-v1-scope](../product/03-v1-scope.md#flight-model-sync)'s flight-model sync, [decision 005](../../decisions/005-wasm-module-writes-following-aircraft.md), the code map's [routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module), [01-between-machines](../network/01-between-machines.md)'s channels, control, softening a short gap, and clock offsets, and decisions [024](../../decisions/024-times-in-microseconds-on-monotonic-clock.md) and [038](../../decisions/038-clock-offset-from-timed-exchange.md) give the rules this design builds on, and this document holds only what they leave out.
The flying machine is the PF's, and a following machine is any other pilot's.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `flight-model` | Feature | On the flying machine, `Lead`'s feed and each report turned into a sample; on a following machine, the samples it drops, the clock offset it applies, and `Follow`'s feeds | Its crate in the core, and the routines `Lead` and `Follow` in our WASM module |

It depends on the network for its channel and each sender's offset, on the session for control and who is in the flight, and on the sim service for its routines and the flying sim's pause.
It registers as partly recorded, with `Lead`'s reports and its samples' channel unrecorded, and so registers no guard, catch-up step, or cockpit kind, and makes no request the platform decides ([unrecorded inputs](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
It loads no profile, so it flies a session whose aircraft has none ([the match check](../session/02-units.md#the-match-check)).

## The sample

```rust
// a sketch: flight-model sync's module of the message crate
pub const SAMPLES: Channel<Sample> = Channel::new(N, Delivery::Newest, Priority(P)).unrecorded();  // N and P hypothetical

pub struct Sample {
    pub at: u64,          // µs on the sender's counter, the frame Lead read it in
    pub generation: u32,  // the control value's generation; its PF is the sender
    pub paused: bool,     // the flying sim's Pause_EX1 wasn't 0
    pub pose: Pose,
}

pub struct Pose {
    pub lat: f64, pub lon: f64, pub alt: f64,
    pub pitch: f32, pub bank: f32, pub heading: f32,
    pub velocity: [f32; 3],
    pub rotation: [f32; 3],
    pub surfaces: [i16; 3],
    pub brakes: [u16; 2],
}
```

| Field | The sim's variable | Unit |
| --- | --- | --- |
| `lat`, `lon` | `A:PLANE LATITUDE`, `A:PLANE LONGITUDE` | radians, `f64` |
| `alt` | `A:PLANE ALTITUDE` | feet, `f64` |
| `pitch`, `bank`, `heading` | `A:PLANE PITCH DEGREES`, `A:PLANE BANK DEGREES`, `A:PLANE HEADING DEGREES TRUE` | radians |
| `velocity` | `A:VELOCITY BODY X`, `Y`, and `Z` | feet per second |
| `rotation` | `A:ROTATION VELOCITY BODY X`, `Y`, and `Z` | radians per second |
| `surfaces` | `A:AILERON POSITION`, `A:ELEVATOR POSITION`, `A:RUDDER POSITION` | the SDK's −16K to 16K |
| `brakes` | `A:BRAKE LEFT POSITION`, `A:BRAKE RIGHT POSITION` | the SDK's 0 to 32K, 0 off |

- The pose and both velocities are what [p02](log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart) wrote each frame to hold a replayed 58P's airspeed within 3.2 kt.
- Position stays `f64`, because an `f32` latitude steps by about 0.4m, and the rest is `f32`, which cut 2.2's sample from 105 bytes to 69 in postcard ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)).
  With the surfaces, brakes, stamp, generation, and flag, a sample comes to about 90 bytes (arithmetic).
- The surfaces and brakes are the yoke, rudder, and toe brakes that [channels](../network/01-between-machines.md#channels) puts in the sample.
  FS Copilot reads the same three surfaces in "Position 16k" (read in the FS Copilot fork, `FsCopilot/Simulation/Surfaces.cs`), and on the 58P each read what its yoke or pedal variable read, `A:YOKE Y POSITION` what `A:ELEVATOR POSITION` did, through every phase of our masking probe (measured on MSFS 2024, 2026-10-01, [p01's result](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-28-54.txt)), so on v1's aircraft the surfaces stand for the yoke and pedals.
  The units are the SDK's ([control variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Control_Variables.htm); [brake variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Brake_Landing_Gear_Variables.htm)).
- A sample carries its control value's generation and not its PF, since only the flying machine sends samples and the network hands each message to its handler with its sender's pilot ID ([channels and sends](../network/02-units.md#channels-and-sends)), which saves the 16 bytes of a pilot ID in every sample.

## The flying machine

```rust
// a sketch: flight-model sync's routine on the flying machine
pub struct Lead { next: u64, period: u64 }

impl Routine for Lead {
    const ID: RoutineId = routine::LEAD;
    type Slot = LeadSlot;      // the period, 50ms
    type Report = Report;      // at and Pose

    fn on_slot(&mut self, s: &LeadSlot) { self.period = s.period }

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        if f.now < self.next { return }
        self.next = if f.now - self.next < self.period { self.next + self.period } else { f.now + self.period };
        want.report(Report { at: f.now, pose: want.read::<Pose>() });
    }
}
```

- `Lead` reports in the first frame at or past each 50ms mark, so reports average 20 a second at any frame rate above 20 fps, and after a frame that passes a whole period the marks start again from that frame.
  20 a second is what 2.3 and p06 ran ([network log](../network/log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing)), and it puts 8 samples in the following machine's 400ms.
  A sample every frame would send about 4 times the packets for nothing: a straight line between samples 50ms apart strays about 1mm from a standard-rate turn at 150 kt (arithmetic).
- Each report's `at` is the frame's time on the core's counter, as [the core's counter in our module](#the-cores-counter-in-our-module) gives it, so a report that reaches the core late still carries when it was read.
  Read through SimConnect instead and stamped as it arrived, a variable set in the frame of a slot's write trailed that slot by 1.14ms to 2.90ms at the 99th percentile and once by 193ms (measured on MSFS 2024, 2026-10-09, [architecture log][flight]), which at 150 kt would put that sample 15m off its path (arithmetic); and the core would take about 89 reads a second, one each sim frame, rather than 20.
- On each report, flight-model sync builds a sample with the session's control generation and the sim service's pause, `Pause_EX1` not 0 ([what the platform's connection holds](../core/03-sim-seam-and-wasm-module.md#what-the-platforms-connection-holds)), and sends it `To::Crew`.
- While the flying sim is paused and no report has gone for 100ms, flight-model sync sends the last sample again every 50ms, stamped with the core's time and marked paused, so a following machine holds at once rather than carrying the aircraft on.
  That works whether or not the module's update runs in a pause, which is unmeasured ([when the module stops](../architecture/02-code-map.md#when-the-module-stops)).
- A load needs no mark: a PF who loads a flight leaves the flight, and control passes ([control](../session/02-units.md#control)).

## The core's counter in our module

Our WASM module keeps an estimate of the core's counter, and `Frame::now` is that estimate, so the samples the core feeds `Follow` and the stamps `Lead` makes are on one timeline, the core's.

- Each routine slot's header also carries the core's counter at the write, in µs: the stamp of the input the sim service was handling when it wrote, so a replay writes the same bytes.
- The module reads WASI's monotonic clock as `SimConnect_CallDispatch` returns in each update, and the routine host takes, for each header that update delivered, the core's counter less that clock.
  The largest of the last 60s is its offset, and `Frame::now` is its clock plus that offset.
- Every write reached the module after it was made, so the offset can only fall short, by the shortest delay from a write to the module's read in that minute, and `Frame::now` runs behind the core's counter by that much.
  The shortfall is the same for every stamp, so it moves every sample alike, which neither `Lead`'s stamps nor `Follow`'s drawing can see; the 60s window lets the offset follow any drift between the two clocks.
- WASI's monotonic clock counts `QueryPerformanceCounter`'s ticks: one constant offset fit all 1,476 of a flight's echoes over 299s, any drift within ±33 ppm (measured on MSFS 2024, 2026-10-09, [architecture log][flight]).
- Which event sets that clock's 0, about 12s after Steam was asked to start the sim in that run (same entry), changes nothing: a module that starts again, as `module_init` may after sign-in ([left open](../core/03-sim-seam-and-wasm-module.md#left-open)), starts its offset again from the next header, and a routine runs only from its first feed, whose header brings one.

This settles the spine's item on the module's clock ([left open](../architecture/01-spine.md#left-open)): the module stamps what it reads on its own clock, carried onto the core's timeline by one offset per run of the module, which the module estimates rather than the core.

The spine's other item, how far the core's arrival stamp trails the sim's read for a page's message, settles as one no v1 unit waits on.
Flight-model sync's stamps come from the module.
A page that times something sends the span, measured on its own clock ([times](../architecture/01-spine.md#times)), as pointer sync's presses do, and an `H:` event that `h-events` hears is matched against a token that lasts 1s ([its own echo](../sync/05-units.md#its-own-echo)).
Half the round trip of a page's echo of the core's message bounds the trail, and a case for the bench records it.

## The following machine

```rust
// a sketch: flight-model sync's crate on a following machine
fn on_sample(me: &mut FlightModel, s: &Sample, from: &Sender, cx: &mut Cx) {
    let control = cx.session().control();
    if from.pilot != control.pf || s.generation != control.generation || s.at <= me.newest { return }
    let Some(offset) = me.offset.apply(cx.net().offset(from), cx.now()) else { return };   // none yet: dropped
    me.newest = s.at;
    cx.module().feed(routine::FOLLOW, FollowSlot { delay: DELAY, sample: s.on_our_counter(offset) });
}
```

### Taking a sample

- The handler drops a sample from a sender who isn't the session's PF, under a generation other than the session's, or with a stamp no later than the newest it took from that sender.
  So it drops a newer control value's samples until the session's control key arrives, where [control](../network/01-between-machines.md#control) has a receiver adopt a newer value met on a sample: flight-model sync can't change control, which the session crate holds, and the next sample after the key replaces each one dropped.
- It drops a sample whose sender the network has no offset for yet, which lasts until the first heartbeat's exchange on that link, at most about 1s ([the heartbeat and clock offsets](../network/02-units.md#the-heartbeat-and-clock-offsets)).
- It moves the offset it applies toward the network's estimate by at most 5ms a second, and takes the first estimate for a sender's pilot ID and restart count at once, so a step in the estimate, as when the connection moves between paths, slows or speeds the drawn aircraft by at most 0.5% rather than moving it in one frame; a 10ms step taken at once would move it 0.8m at 150 kt (arithmetic).
- It feeds `Follow` each sample with its stamp moved onto this core's counter, and with the delay, so a later delay that follows the path changes only the core.

### Drawing

```rust
// a sketch: flight-model sync's routine on a following machine
impl Routine for Follow {
    fn on_slot(&mut self, s: &FollowSlot) { self.delay = s.delay; self.samples.push(s.sample) }

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        want.freeze();                                         // in every frame it runs
        let target = self.target(f, want);                     // between two samples, carried, held, or its own motion
        let pose = self.ease.apply(target, f.now);             // what's left of the last correction
        want.write(&pose.placed());                            // the pose and both velocities
        want.events(&pose.controls());                         // the five axis events
    }
}
```

- `Follow` draws the aircraft at `now` less 400ms, as FS Copilot's module does (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `interpolate`), and 2.3 measured lateness against: flight-model samples later than 400ms came to 0.4% or less in every run but one, which reached 1.6% ([softening a short gap](../network/01-between-machines.md#softening-a-short-gap)).
- Between the two samples around that time, it draws position, both velocities, the surfaces, and the brakes along a straight line, and each angle the shorter way round, as FS Copilot's module does (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/interpolators.h`).
- It writes the pose and both velocities through the routine host's write, and sends `K:AXIS_AILERONS_SET`, `K:AXIS_ELEVATOR_SET`, and `K:AXIS_RUDDER_SET` with the surfaces, as FS Copilot's module sends them (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`), and `K:AXIS_LEFT_BRAKE_SET` and `K:AXIS_RIGHT_BRAKE_SET` with each brake less 16,384, since the 58P's own brake event read −16,384 released (measured on MSFS 2024, 2026-10-01, [p01's result](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-28-54.txt)).
  A frozen aircraft doesn't fly by its surfaces, so these move only what the following pilot sees: the yoke, the pedals, and the surfaces.
- An event moves the aircraft's own controls as its hardware would, where whether a written `A:YOKE Y POSITION` moves the 58P's yoke is unrun.

### Through a gap or a pause

- One lost sample changes nothing: the 400ms holds 8, so `Follow` draws between the two either side of it.
- Past the newest sample, `Follow` carries the aircraft's position on along the line through the last two samples for up to 2s, holding the newest's attitude, velocities, and controls, then holds the pose where the carry ended, still writing the last velocities so the gauges don't fall to 0.
  Through the 2s move to the relay, that's about 1.6s of carrying ([softening a short gap](../network/01-between-machines.md#softening-a-short-gap)), and in a standard-rate turn at 150 kt, 2s of carrying strays about 8m from the path (arithmetic).
  The line through two samples carries a raised simulation rate in it, where carrying on the velocities would leave the aircraft behind.
- Past a sample marked paused, it holds at once.
- When a sample is old enough to draw from again, `Follow` takes the difference between what it last wrote and the drawn pose as a correction, adds it to each pose it writes, and shrinks it to nothing over 3s, so the aircraft eases back rather than jumping.
- Through a gap longer than 2s it holds, frozen, as the code map's case for a 20s gap has it ([cases for the bench](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim)).

### Its first frames

- In its first frame, `Follow` reads its aircraft's own pose and `A:VELOCITY WORLD X`, `Y`, and `Z`, and carries that motion on until a sample is old enough to draw from, then eases in over 3s, as after a gap.
- When the first drawn pose is more than 1km from the carried one, as for a joiner on a runway whose PF is airborne, it writes the pose at once, with no correction.
- So at a handover, the ex-PF's aircraft, which has been flying itself, flies on for 0.4s, then eases about 65m back over 3s, slowing to about 70% of its speed at 150 kt, since the new PF's aircraft was drawn 0.4s plus the trip behind (arithmetic, for a 50ms trip).
  The code map's rule would freeze it in place for 0.4s, then jump it about 35m back.
- A joiner whose aircraft loaded at the PF's stand eases to the PF's spot over 3s.

## When each routine runs

| Routine | Runs while | Fed with | Ended when |
| --- | --- | --- | --- |
| `Lead` | This pilot holds control and is in the flight, preflight included | The period, 50ms | Control passes away, this pilot leaves the flight, or the session ends |
| `Follow` | This pilot is in the flight and another holds control, preflight included, where the session crate's `Hold` also freezes the aircraft | Each sample, with the delay | This pilot takes control, leaves the flight, or the session ends |

- Flight-model sync starts and ends them on `FlightChanged`, `ControlPassed`, and `SessionEnded` ([the session's units](../session/02-units.md)).
- `Follow`'s end mark lets the new PF's aircraft unfreeze on the next frame and fly on from the velocities last written ([cases for the bench](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim)).
- With more than two pilots, a machine that goes on following across a change of PF ends `Follow` and feeds it again, so the new PF's samples start a new buffer, carried and eased in as at any start.

## What this adds to our WASM module

| Addition | What it does |
| --- | --- |
| The core's counter in each routine slot's header | Gives the routine host its offset, above |
| A report | A routine hands the routine host a struct, which it writes once every routine's frame has run into the routine's report slot, `CROSSCHECK_REPORT_` and the routine's ID, which the module creates in `module_init` with the read-only flag; the sim service requests it `ON_SET` on the feature's connection through `cx.module().reports(routine)`, and each report reaches the feature as a value |
| Events with values | `fsEventsTriggerKeyEvent` takes an event and its values (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`), sent once every routine's frame has run; nothing to undo when no routine asks |
| `flight_model::Lead` | Joins the module's list, with `CROSSCHECK_ROUTINE_LEAD` and `CROSSCHECK_REPORT_LEAD` |

- `REPORT` is a kind of its own in [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares), owned by the routine host, so a report slot never collides with a routine whose ID ends in `_REPORT`.
- A partly recorded unit declares a report request `.unrecorded()`, as it does a watch.

## What this changes in done designs

Each has a note at its top:

- The code map: `Lead`, the report slot and its kind, the counter in each header, the two wants, `Frame::now` on the core's counter, and `Follow`'s first frames carried and eased rather than held still.
- [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md): the slot header's counter, the report slot, the two wants, and `reports` among what a feature calls.
- [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md): flight-model sync's unrecorded sim call is `Lead`'s reports, not a pose read every frame.
- [01-between-machines](../network/01-between-machines.md): a sample carries its generation alone, and a newer one is dropped until the control key arrives; and the gap, the pause mark, and the eased offset are as above.
- The spine: its two items under flight-model sync, and the two that 01-between-machines' note added, are settled here.
- [Decision 036](../../decisions/036-control-is-one-value.md)'s sample carrying the whole value, and adopting a newer one, change through a tentative decision once step 8's decisions are numbered ([decisions](../architecture/decisions.md#a-flight-model-sample-carries-its-controls-generation-alone-and-a-receiver-drops-one-under-any-other-value)).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| Samples | 20 a second from the flying machine, about 90 bytes each, about 3 KB/s with 2.2's 58 bytes of headers a packet (arithmetic) |
| `Lead` and `Follow` | Inside the code map's 0.1ms a frame for the module's update |
| The routine host's offset | Within 2ms of where it settles, 10s after its first header (unverified) |
| From the flying machine's read to the following machine's write | 400ms plus the trip, plus the module's shortfall |
| A handler | Inside the code map's 1ms, at 20 reports or samples a second |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, and the routine host built natively:

- At 30 fps and at 89 fps, `Lead` reports 20 times a second on average.
- A report the stand-in delivers 193ms late: the following aircraft's path doesn't move.
- With the stand-in's module clock 12s behind the core's counter, and write delays drawn from 2026-10-09's round trips, the routine host's offset settles within its budget and stays there through a 2-hour run.
- One lost sample: nothing carried, nothing eased.
- The 2s move to the relay: carried about 1.6s, then eased over 3s, and no frame moves the aircraft by more than its speed allows plus the correction's share.
- A 20s gap: carried 2s, then held, frozen throughout.
- A PF in the pause menu with the stand-in's module not updating: the follower holds at once and never carries; with it updating, the same.
- A 30ms step in the network's offset: the applied offset reaches it within 6s, and the written pose never jumps.
- A sample from a sender who isn't the PF, under an older or a newer generation before the key, with an old stamp, or before the link's first offset: each dropped.
- A handover: the ex-PF's aircraft flies on, eases back, and never stops or jumps; the new PF's unfreezes at `Follow`'s end mark.
- A joiner whose PF is 50km away: written at once at the first drawn pose; one at the PF's stand 10m away: eased over 3s.
- A restarted sender, under a higher restart count: its first offset taken at once.
- A page's echo of a message from the core: its round trip recorded, half of which bounds the arrival stamp's trail.

In the sim:

- On the 58P, the follower's yoke, rudder pedals, and toe brakes move with the PF's through the five axis events.
- With the autopilot engaged on both machines, the follower's axis events leave its autopilot engaged, since state sync would send a disengaged autopilot to the PF.
- Whether the single-frame spikes p02 read in the body and rotation velocities, up to 7.6 ft/s and 2.3 rad/s, remain with the writes made inside the frame, which [03-v1-scope](../product/03-v1-scope.md#flight-model-sync) asks.
- A joiner moved from a runway to a PF 50km away: the sim loads the scenery without stalling, which [preflight](../product/03-v1-scope.md#preflight) asks.
- Whether the module's update runs through each kind of pause, which changes nothing here.

With friends, on two PCs:

- Whether two machines with the same scenery agree on the ground's elevation, which [03-v1-scope](../product/03-v1-scope.md#flight-model-sync) asks.
- Whether the following pilot sees the aircraft move smoothly, in flight and through a handover.

## Left open

- A delay that follows the path, shorter on a direct one, which the feed's delay leaves to the core alone.
- Gauges a frozen aircraft computes from motion that the sample doesn't carry: FS Copilot's module also writes `A:VERTICAL SPEED` and `A:G FORCE` (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`), where p02's follower read vertical speed within 9 ft/min on average with the velocities written ([flight-model log](log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)); a G meter on a following machine is unchecked.
- An aircraft whose autopilot moves its surfaces without its yoke, or whose yoke isn't stock, where the yoke's own variables or a profile's names would replace the surfaces; v1's 58P reads the same in both.

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
