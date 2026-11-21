# Flight model: flight-model sync

```text
Purpose:     How the flying machine's pose, velocities, and flight controls reach each following machine's aircraft, and on which clock each sample is stamped.
Depends on:  ../product/03-v1-scope.md, ../architecture/01-spine.md, ../architecture/02-code-map.md, ../core/03-sim-seam-and-wasm-module.md, ../network/01-between-machines.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../session/02-units.md, log.md
Decides:     Who reads the flying aircraft, and how often; what a sample carries; the clock our WASM module stamps on, and how it learns the core's; whether a page's arrival stamp matters; how a following machine takes a sample, draws the aircraft, carries it through a gap, eases it back, and starts; how it eases the clock offset; when each routine runs; what this adds to our module; the budgets; and the cases for the bench (node 6.10).
```

> **Note**
> In [what this adds to our WASM module](#what-this-adds-to-our-wasm-module), `Follow` also says where it puts the aircraft each frame, through a want of the routine host, and `Figure` seats its figures on that pose, where they sat still in flight (seen on MSFS 2024, 2026-11-11, [flight-model log](log.md#2026-11-11-seated-on-the-pose-follow-says-it-writes-a-figure-keeps-its-seat-on-the-following-machine-and-the-58p-banks-and-pitches-with-the-aircraft-it-follows)).
> In [cases for the bench](#cases-for-the-bench), the cases with friends have their answers: two PCs with the same scenery agreed on the ground's elevation, and the following pilot saw the aircraft move smoothly in flight and through 13 handovers over a relayed link (seen on MSFS 2024, 2026-11-11, [flight-model log](log.md#2026-11-12-two-pilots-on-two-pcs-flew-one-58p-smoothly-through-13-handovers-over-a-relayed-link-and-after-a-handover-with-the-autopilot-engaged-the-aircraft-drifted)).
> A following machine's own camera reads behind the pilot's seat in flight, which is avatars' to answer ([avatars log](../avatars/log.md#2026-11-12-on-a-following-machine-in-flight-the-camera-reads-1m-to-3m-behind-the-pilots-seat-so-the-crew-sees-that-pilot-as-a-head-in-the-cabin)).
> In [cases for the bench](#cases-for-the-bench), the 58P's brakes don't read what the PF's do between the ends of their travel: `K:AXIS_LEFT_BRAKE_SET` follows a curve, and a brake the PF holds at 73% reads 51% on the following aircraft.
> `A:BRAKE LEFT POSITION` and `A:BRAKE RIGHT POSITION` carry the parking brake too, so a PF parked with it set shows as full toe brakes on a following aircraft.
> Both stay as they are for now, as known limits: a frozen aircraft's brakes change only what the pilot sees, not how it moves, and the curve was read on the 58P alone (user, 2026-11-11; measured on MSFS 2024, 2026-11-11, [flight-model log](log.md#2026-11-11-in-the-sim-the-58p-follows-a-stand-ins-path-within-centimeters-a-figure-on-the-following-machine-slid-along-the-aircraft-and-the-brake-events-follow-a-curve)).
> In [drawing](#drawing), sending each brake less 16,384 is measured on the 58P.
> With the parking brake set, a sweep of `K:AXIS_LEFT_BRAKE_SET` read `A:BRAKE LEFT POSITION EX1` at 0 for -16,383 and at 32,767 for 16,383, in `Position 32k`, so the event's ends land on the toe brake's, and between them it follows the curve above, reading 8,846 for an event of 0, while `A:BRAKE LEFT POSITION` read 2,130 at -16,383 (measured on MSFS 2024, 2026-11-11, same entry; [results](results/2026-11-11-stage-16-session-first-run.txt)).
> In [its first frames](#its-first-frames), a raised rate moves the aircraft that many times faster than its velocity: at a simulation rate of 2, the former pilot flying's aircraft carried on at about the speed it flew, 133.3 m/s before the handover and 123.8 m/s in `Follow`'s first 400ms, neither half nor double (measured on MSFS 2024, 2026-11-11, [flight-model log](log.md#2026-11-11-seated-on-the-pose-follow-says-it-writes-a-figure-keeps-its-seat-on-the-following-machine-and-the-58p-banks-and-pitches-with-the-aircraft-it-follows)).

> **Note**
> In [through a gap](#through-a-gap), `Follow` eases at every step in where the aircraft belongs: when a sample is old enough to draw from again, and when a carry goes on from a newer sample, as when a gap's samples arrive together.
> While every sample it holds is ahead of the frame's time, it holds the aircraft where it was.
> In [its first frames](#its-first-frames), it carries its own motion for at most 2s, then holds, as it does past its newest sample.
> In [taking a sample](#taking-a-sample), the link's first offset can take about 2s, two heartbeats, not 1s.
> In [the sample](#the-sample), `Lead`'s report and the sample between cores are one struct, `Sample`, and the feed that starts `Follow` carries no sample ([flight-model log](log.md#2026-11-11-on-the-bench-a-following-aircraft-keeps-to-the-flying-ones-path-400ms-behind-and-samples-that-arrive-together-after-a-gap-made-follow-jump)).

> **Note**
> `Lead` and `Follow` run on through a profile's unload while their pilot stays in the flight, as a [test session](../profiles/02-units.md#test-sessions)'s reload makes one, since the sim service ends at an unload only the routines of a feature that marks its sim work as ending with the profile, which flight-model sync doesn't ([architecture log](../architecture/log.md#2026-11-21-a-profiles-unload-ended-every-features-sim-work-flight-model-syncs-included-so-it-ends-only-the-work-of-features-that-load-a-profile); user, 2026-11-21).
> The fix the [flight-model log](log.md#2026-11-11-on-the-bench-a-following-aircraft-keeps-to-the-flying-ones-path-400ms-behind-and-samples-that-arrive-together-after-a-gap-made-follow-jump) sketched marked the features that follow the session instead, and the mark went to the two features that load a profile, state sync and avatars.

> **Note**
> A known limit, measured on the 58P: a following machine's own autopilot, when engaged, keeps flying the aircraft `Follow` holds frozen and winds up, and once `Follow` lets the aircraft go at a handover, it rolls the aircraft and runs its trim for several seconds.
> The 58P's KFC 150 is the sim's own autopilot and flies pitch through the trim, which within 0.5s ran to +38.7% in one run and -55.1% in the other, while the bank reached 7.2° and 7.9° within about 2.5s, and the autopilot settled the aircraft within about 9s (measured on MSFS 2024, 2026-11-19, [flight-model log](log.md#2026-11-19-after-a-handover-the-58ps-own-autopilot-rolls-the-aircraft-and-runs-its-trim-wound-up-while-follow-held-it-frozen-which-v1-keeps-as-a-known-limit)).
> Other aircraft are unmeasured.
> v1 builds nothing for it (user, 2026-11-19).

On the flying machine, the PF's, a routine in our WASM module, `Lead`, reads the aircraft's pose, velocities, control surfaces, and toe brakes about 20 times a second, each read stamped with its frame's time, and the core sends each read to the crew as a sample.
On each following machine, any other pilot's, `Follow` draws the aircraft 400ms behind those samples, along straight lines between them, carries it on through a gap of up to 2s, and eases it back over 3s.
Our module keeps an estimate of the core's counter, from a stamp the core puts in every slot it writes, so every routine runs on the core's timeline and the core never estimates the module's clock.

This answers node 6.10 of the [architecture plan](../architecture/plan.md#610-flight-model-sync), and holds only what these leave out: [03-v1-scope](../product/03-v1-scope.md#flight-model-sync)'s flight-model sync, [decision 005](../../decisions/005-wasm-module-writes-following-aircraft.md), the code map's [routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module), [01-between-machines](../network/01-between-machines.md)'s channels, control, softening a short gap, and clock offsets, and decisions [024](../../decisions/024-times-in-microseconds-on-monotonic-clock.md) and [038](../../decisions/038-clock-offset-from-timed-exchange.md).
Here a pose is the aircraft's position and attitude.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `flight-model` | Feature | On the flying machine, the last sample it sent, which it sends again through a pause; on a following machine, the newest stamp it took, the clock offset it applies, and `Follow`'s feeds | Its crate in the core, and the routines `Lead` and `Follow` in our WASM module |

It depends on the network for its channel and each sender's offset, on the session for control and who is in the flight, and on the sim service for its routines and the flying sim's pause.
The core records every input, `Lead`'s reports and its samples' channel among them, so a replay checks flight-model sync's outputs (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).
It loads no profile, so it flies a session whose aircraft has none.

## The sample

```rust
// a sketch: flight-model sync's module of the message crate
pub const SAMPLES: Channel<Sample> = Channel::new(N, Delivery::Newest, Priority(P));  // N and P hypothetical
pub const PERIOD: u64 = 50_000;   // µs between Lead's reports

pub struct Sample {
    pub at: u64,              // µs on the sender's counter, the frame Lead read it in
    pub snapshot: Snapshot,
}

pub struct Snapshot {
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
| `surfaces` | `A:AILERON POSITION`, `A:ELEVATOR POSITION`, `A:RUDDER POSITION` | Position 16k, −16,384 to 16,384, as FS Copilot reads them (read in the FS Copilot fork, `FsCopilot/Simulation/Surfaces.cs`) |
| `brakes` | `A:BRAKE LEFT POSITION`, `A:BRAKE RIGHT POSITION` | the SDK's 0 to 32K, 0 off ([brake variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Brake_Landing_Gear_Variables.htm)) |

- With the pose alone, p02's replayed 58P was 22 kt off within two minutes, and with both velocities written each frame as well it stayed within 3.2 kt ([flight-model log](log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)).
- Position stays `f64`, because an `f32` latitude steps by about 0.4m, and the rest is `f32`, which cut 2.2's sample from 105 bytes to 69 in postcard ([network log](../network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does)).
  With the surfaces, brakes, and stamp, a sample comes to under 90 bytes (arithmetic).
- The surfaces and brakes are the yoke, rudder, and toe brakes that [channels](../network/01-between-machines.md#channels) puts in the sample.
  The SDK calls `A:AILERON POSITION` the "aileron input" ([control variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Control_Variables.htm)), and on the 58P each surface variable read its axis event's value negated, through the six phases of our masking probe's first run (measured on MSFS 2024, 2026-10-01, [p01's result](../../../experiments/areas/flight-controls/results/p01-mask-2026-10-01-20-28-54.txt)).
  So a surface sent back negated repeats the PF's input, and the following aircraft moves its own yoke from it.
  The yoke's own variables are the aircraft's response, not its input: `A:YOKE X POSITION` read 6/25 of `A:AILERON POSITION` at small deflections in the same run.
- A sample carries nothing of control, neither its PF nor the control value's generation (user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
  Its PF is its sender, since only the flying machine sends samples, and the network hands each message to its handler with its sender's pilot ID ([channels and sends](../network/02-units.md#channels-and-sends)), so a sample saves the 16 bytes of a pilot ID.

## The flying machine

```rust
// a sketch: flight-model sync's routine on the flying machine
pub struct Lead { next: u64 }

impl Routine for Lead {
    const ID: RoutineId = routine::LEAD;
    type Slot = LeadSlot;      // nothing beyond its header
    type Report = Report;      // at and a Snapshot

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        if f.now < self.next { return }
        self.next = if f.now - self.next < PERIOD { self.next + PERIOD } else { f.now + PERIOD };
        want.report(Report { at: f.now, snapshot: want.read::<Snapshot>() });
    }
}
```

- `Lead` reports in the first frame at or past each 50ms mark, so reports average 20 a second at any frame rate above 20 fps, and after a frame that passes a whole period the marks start again from that frame.
  20 a second is what 2.3 ran ([softening a short gap](../network/01-between-machines.md#softening-a-short-gap)) and p06's mix sent ([network log](../network/log.md#2026-10-11-on-irohs-relay-under-loss-v1s-streams-run-as-late-as-its-one-off-packets-and-no-later-because-quic-never-sees-a-loss-there-so-a-sender-that-keeps-only-each-channels-newest-packet-changes-nothing)), and it puts 8 samples in the following machine's 400ms.
  A sample every frame would send about 4 times the packets for nothing: a straight line between samples 50ms apart strays about 1mm from a standard-rate turn at 150 kt (arithmetic).
- Each report's `at` is the frame's time on the core's counter, as [the core's counter in our module](#the-cores-counter-in-our-module) gives it, so a report that reaches the core late still carries when it was read.
  Read through SimConnect instead and stamped as it arrived, an `L:` variable our module set in the frame of a slot's write trailed that slot by 1.14ms at least, 2.90ms at the 99th percentile, and once by 193ms (measured on MSFS 2024, 2026-10-09, [architecture log][flight]), which at 150 kt would put that sample 15m off its path (arithmetic).
  The core would also take a read each sim frame, about 89 a second if the frames came as the module's updates did in that run (inference), rather than 20.
- On each report, flight-model sync builds a sample and sends it `To::Crew`.
- While the flying sim is paused, `Pause_EX1` not 0 ([what the platform's connection holds](../core/03-sim-seam-and-wasm-module.md#what-the-platforms-connection-holds)), flight-model sync sends the last sample again every 50ms once no report has gone for 100ms.
  Each repeat is stamped 50ms after the one before, so a following machine draws the aircraft standing still rather than carrying it on.
  That works whether or not the module's update runs in a pause, which is unmeasured ([when the module stops](../architecture/02-code-map.md#when-the-module-stops)).
- A load needs nothing of its own: a PF who loads a flight leaves the flight, and control passes ([control](../session/02-units.md#control)).

## The core's counter in our module

Our WASM module keeps an estimate of the core's counter, and `Frame::now` is that estimate, so the samples the core feeds `Follow` and the stamps `Lead` makes are on one timeline, the core's.

- Each routine slot's header also carries the core's counter at the write, in µs: the stamp of the input the sim service was handling when it wrote, so a replay writes the same bytes.
- The module reads WASI's monotonic clock as `SimConnect_CallDispatch` returns in each update, and the routine host takes, for each header that update delivered, the core's counter less that clock.
  The largest since the module started is its offset, and `Frame::now` is its clock plus that offset.
- Every write reached the module after it was made, so the offset grows toward the true one and never passes it, short by the shortest delay from a write to the module's read; that shortfall moves every stamp alike, which neither `Lead`'s stamps nor `Follow`'s drawing can see.
- WASI's monotonic clock counts `QueryPerformanceCounter`'s ticks: one constant offset fit all 1,476 of a flight's echoes over 299s, any drift within ±33 ppm (measured on MSFS 2024, 2026-10-09, [architecture log][flight]), so the offset holds for the whole run of the module, through a flight load in which no header arrives.
- Which event sets that clock's 0 changes nothing: a module that starts again, as `module_init` may after sign-in ([left open](../core/03-sim-seam-and-wasm-module.md#left-open)), starts its offset again from the next header, and a routine runs only from its first feed, whose header brings one.

This settles the spine's item on the module's clock ([left open](../architecture/01-spine.md#left-open)).
The spine's other item, how far the core's arrival stamp trails a page's read, is one no v1 unit waits on.
Pointer sync's presses send no span: each gesture goes as it happens, and the cockpit stream's gaps time it in a replay, each the difference between two arrival stamps, so a constant delay before the core's stamp cancels ([pointer sync](../pointer-sync/01-pointer-sync.md#timing)).
A page that times something sends the span ([times](../architecture/01-spine.md#times)), and `h-events` matches an `H:` event against a token that lasts 1s ([its own echo](../sync/05-units.md#its-own-echo)).

## The following machine

```rust
// a sketch: flight-model sync's crate on a following machine
fn on_sample(me: &mut FlightModel, s: &Sample, from: &Sender, cx: &mut Cx) {
    let control = cx.session().control();
    if !me.following || from.pilot != control.pf || s.at <= me.newest { return }
    let Some(offset) = me.offset.apply(cx.net().offset(from), cx.now()) else { return };   // none yet: dropped
    me.newest = s.at;
    cx.module().feed(routine::FOLLOW, FollowSlot { delay: DELAY, sample: s.on_our_counter(offset) });
}
```

### Taking a sample

- The handler drops every sample while flight-model sync isn't running `Follow`, so a pilot out of the flight, at the main menu or in another aircraft, never has an aircraft frozen and moved.
- It drops a sample from a sender who isn't the session's PF, or with a stamp no later than the newest it took since `Follow` started (user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
  So it drops a new PF's samples until the session's control key arrives, because flight-model sync can't change control, which the session crate holds; the next sample after the key replaces each one dropped.
  A sample delayed across two handovers that hand control back to its sender can draw one stale point (same entry).
- It drops a sample whose sender the network has no offset for yet, which lasts until the first heartbeat's exchange on that link, at most about 1s ([the heartbeat and clock offsets](../network/02-units.md#the-heartbeat-and-clock-offsets)).
- Each time it starts `Follow`, it forgets the newest stamp it took and takes the network's next estimate of the PF's offset at once.
  After that, it moves the offset it applies toward the network's estimate by at most 5ms a second, so a step in the estimate, as when the connection moves between paths, slows or speeds the drawn aircraft by at most 0.5% rather than moving it in one frame; a 10ms step taken at once would move it 0.8m at 150 kt (arithmetic).
- It feeds `Follow` each sample with its stamp moved onto this core's counter, and with the delay, so a later delay that follows the path changes only the core.

### Drawing

```rust
// a sketch: flight-model sync's routine on a following machine
impl Routine for Follow {
    fn on_slot(&mut self, s: &FollowSlot) { self.delay = s.delay; self.samples.push(s.sample) }

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        want.freeze();                                         // in every frame it runs
        let target = self.target(f, want);                     // between two samples, carried, held, or its own motion
        let drawn = self.ease.apply(target, f.now);            // what's left of the last correction
        want.write(&drawn.placed());                           // the pose and both velocities
        want.events(&drawn.controls());                        // the five axis events
    }
}
```

- `Follow` draws the aircraft at `now` less 400ms, the delay of FS Copilot's module (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.h`, `k_delay_sec`).
  Since each sample's stamp is placed through the clock offset, not by when it arrived, the following pilot sees the aircraft 400ms behind the PF, and the trip uses up part of that 400ms.
  In the friends' runs of 2.3, flight-model samples later than 400ms came to 0.4% or less in all but one, which reached 1.6%, and in our own run, with loss on both legs, 1.1% and 2.7% ([softening a short gap](../network/01-between-machines.md#softening-a-short-gap)).
- Between the two samples around that time, it draws each field along a straight line, and each angle the shorter way round, as FS Copilot's module draws its fields (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/interpolators.h`).
- It writes the pose and both velocities through the routine host's write, and sends `K:AXIS_AILERONS_SET`, `K:AXIS_ELEVATOR_SET`, and `K:AXIS_RUDDER_SET` with each surface negated, as FS Copilot's module sends them (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_control`).
  An event moves the aircraft's controls as its hardware would: on the 58P, a SimConnect client that sent back the pilot's own elevator and aileron events moved the yoke (measured on MSFS 2024, 2026-10-06, [flight-controls log](../flight-controls/log.md#2026-10-06-a-pilots-own-pitch-and-roll-input-was-flyable-150ms-late-and-not-300ms-late-in-the-baron-at-cruise)); the rudder's, and any sent from our module, are unrun.
  If the events don't move them, `Follow` also writes the three surface variables, as FS Copilot's module does, and nothing else changes.
- It sends `K:AXIS_LEFT_BRAKE_SET` and `K:AXIS_RIGHT_BRAKE_SET` with each brake less 16,384, which is unverified: the 58P's own brake event ran −16,384 to −2,505 in p01 (measured, same result), the SDK's page for MSFS 2020 documents the event's scale as non-linear ([aircraft misc events](https://docs.flightsimulator.com/html/Programming_Tools/Event_IDs/Aircraft_Misc_Events.htm)), and FS Copilot's 58P profile reads `A:BRAKE LEFT POSITION EX1` and sends it less 16,384 (read in the FS Copilot profiles, `definitions/bksq-aircraft-baronpro.yaml`, a lead).
- A frozen aircraft doesn't fly by its surfaces or brakes (inference: its position and attitude are frozen and written, and its velocities written), so these move only what the following pilot sees: the yoke, the pedals, and the surfaces.

### Through a gap

- Past the newest sample, `Follow` carries the aircraft's position on along the line through the last two samples for up to 2s, holding the newest's attitude, velocities, and controls, then holds the pose where the carry ended.
  It goes on writing the last velocities, since a frozen aircraft keeps integrating its own, which with the pose alone left a replayed 58P's airspeed 22 kt off ([flight-model log](log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)).
- In a standard-rate turn at 150 kt, 2s of carrying strays about 8m from the path (arithmetic).
  Carrying along the line through two samples keeps a raised simulation rate, where carrying on the velocities would leave the aircraft behind.
- When a sample is old enough to draw from again, `Follow` takes the difference between what it last wrote and the drawn pose as a correction, adds it to each pose it writes, and shrinks it to nothing over 3s, so the aircraft eases back rather than jumping.
- When a correction would be more than 1km, after a long gap or at `Follow`'s start, `Follow` writes the drawn pose at once instead, since easing 1km in 3s would slide the aircraft far faster than it flies.

### Its first frames

- In its first frame, `Follow` reads its aircraft's own pose, `A:VELOCITY WORLD X`, `Y`, and `Z`, and `E:SIMULATION RATE`; FS Copilot reads the first two velocities (read in the FS Copilot fork, `FsCopilot/Simulation/Physics.cs`).
  It carries that motion, at the velocity times the rate, until a sample is old enough to draw from, then eases in over 3s, as after a gap.
  The rate is there because a raised rate moves the aircraft that many times faster than its velocity (unverified).
- So a joiner on a runway whose PF is airborne is written at the PF's pose at once, and one whose aircraft loaded at the PF's stand eases to the PF's spot.
- At a handover, the ex-PF's aircraft, which has been flying itself, flies on for 0.4s, then eases about 62m back over 3s, slowing to about three-quarters of its speed at 150 kt, since the new PF's aircraft was drawn 0.4s behind (arithmetic).

## When each routine runs

| Routine | Runs while | Fed with |
| --- | --- | --- |
| `Lead` | This pilot holds control and is in the flight, preflight included | Nothing beyond its header |
| `Follow` | This pilot is in the flight and another holds control, preflight included | Each sample, with the delay |

- Flight-model sync starts and ends them on `FlightChanged`, `ControlPassed`, and `SessionEnded` ([the session's units](../session/02-units.md)).
- On every `ControlPassed`, it ends the routine it runs and starts the one the new control calls for, so with more than two pilots, a machine that goes on following starts a new buffer for the new PF's samples.

## What this adds to our WASM module

- **The core's counter in each routine slot's header,** which gives the routine host its offset, above.
- **A report:** a routine hands the routine host a struct, and once every routine's frame has run, the host writes it into the routine's report slot, `DUALINPUT_REPORT_` and the routine's ID.
  The module creates that slot in `module_init` with the read-only flag, and the sim service requests it `ON_SET` on the feature's connection through `cx.module().reports(routine)`, so each report reaches the feature as a value, which the core records as it does every input.
- **Events with values:** `fsEventsTriggerKeyEvent` takes an event and its values (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`), sent once every routine's frame has run, with nothing to undo when no routine asks.
- **`flight_model::Lead`** joins the module's list, with `DUALINPUT_ROUTINE_LEAD` and `DUALINPUT_REPORT_LEAD`.
  `REPORT` is a kind of its own in [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares), owned by the routine host, so a report slot never collides with a routine whose ID ends in `_REPORT`.

The text or the notes at the top of [the code map](../architecture/02-code-map.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md), [01-between-machines](../network/01-between-machines.md), [the spine](../architecture/01-spine.md), and [03-v1-scope](../product/03-v1-scope.md) list what this design changes there, and a [tentative decision](../architecture/decisions.md#a-flight-model-sample-carries-nothing-of-control-and-a-receiver-drops-one-from-a-sender-who-isnt-the-pf) changes [decision 036](../../decisions/036-control-is-one-value.md).

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| Samples | 20 a second from the flying machine, about 3 KB/s with 2.2's 58 bytes of headers a packet ([the sample](#the-sample); arithmetic) |
| The routine host's offset | Within 2ms of where it settles, 10s after its first header (unverified) |
| From the flying machine's read to the following machine's write | 400ms, plus the following module's shortfall less the flying module's |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, or three where a third is named, the stand-in sim, and the routine host built natively:

- At 30 fps and at 89 fps, `Lead` reports 20 times a second on average.
- A report the stand-in delivers 193ms late: the following aircraft's path doesn't move.
- With the stand-in's module clock 12s behind the core's counter, and write delays drawn from 2026-10-09's round trips, the routine host's offset settles within its budget, keeps it through a flight load with no header, and holds through a 2-hour run.
- One lost sample: nothing carried, nothing eased.
- The 2s move to the relay: carried about 1.6s, then eased over 3s.
- A 20s gap: carried 2s, then held, frozen throughout, and written at once when samples return more than 1km on.
- A PF in the pause menu, the stand-in's module updating or not: the following aircraft holds and never carries, and the first report after the pause is taken.
- A 30ms step in the network's offset: the applied offset reaches it within 6s, and the written pose never jumps.
- A sample while this pilot is out of the flight, from a sender who isn't the PF, from a new PF before the key, with an old stamp, or before the link's first offset: each dropped.
- A handover: the ex-PF's aircraft flies on, eases back, and never stops or jumps.
- Three cores, across a change of PF: the third machine takes the new PF's samples, with the new PF's offset taken at once.
- A joiner whose PF is 50km away: written at once at the first drawn pose; one at the PF's stand 10m away: eased over 3s.

In the sim:

- On the 58P, the following aircraft's yoke, rudder pedals, and toe brakes move with the PF's through the five axis events sent from our module, and each brake reads what the PF's does.
- With the autopilot engaged on both machines, the following aircraft's axis events leave its autopilot engaged, since state sync would send a disengaged autopilot to the PF.
- Whether the single-frame spikes p02 read in the body and rotation velocities, up to 7.6 ft/s and 2.3 rad/s, remain with the writes made inside the frame, which [03-v1-scope](../product/03-v1-scope.md#flight-model-sync) asks.
- A joiner moved from a runway to a PF 50km away: the sim loads the scenery without stalling, which [preflight](../product/03-v1-scope.md#preflight) asks.
- A handover at a simulation rate of 2: the ex-PF's aircraft carries on at the speed it flew.

With friends, on two PCs:

- Whether two machines with the same scenery agree on the ground's elevation, which [03-v1-scope](../product/03-v1-scope.md#flight-model-sync) asks.
- Whether the following pilot sees the aircraft move smoothly, in flight and through a handover.

## Left open

- A delay that follows the path, shorter on a direct one, which the feed's delay leaves to the core alone.
- Gauges a frozen aircraft computes from motion that the sample doesn't carry: FS Copilot's module also writes `A:VERTICAL SPEED` and `A:G FORCE` (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`), where p02's following aircraft read vertical speed within 9 ft/min on average with the velocities written ([flight-model log](log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)); a G meter on a following machine is unchecked.
- An aircraft whose own module masks the axis events, as Accu-Sim and the PMDG 777's do ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims); [flight-controls log](../flight-controls/log.md#2026-10-01-the-pmdg-777-takes-a-value-sent-back-with-the-legacy-transmit-call)), where `Follow`'s events may need another route or a profile's names; v1's 58P has stock flight controls.

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
