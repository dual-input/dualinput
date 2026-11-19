# Flight model: log

What our experiments and the build found about syncing the aircraft's flight model between the flying machine and the following machine, newest entry first.
A frozen Black Square Baron 58P holds the pose we write, but the sim keeps integrating its velocities, so a following machine has to write every velocity along with the pose.
Written each frame, the velocities hold, and the follower's airspeed and vertical speed stay with the flight it follows, while its engine temperatures start apart and close only over minutes.
The Baron's ground contact follows the written altitude, and neither its chocks nor its engine-start shake held against our writes.
The probes are [p01-frozen-baron.mjs](../../../experiments/areas/flight-model/p01-frozen-baron.mjs) and [p02-replay.mjs](../../../experiments/areas/flight-model/p02-replay.mjs), and their raw output is in [experiments/areas/flight-model/results](../../../experiments/areas/flight-model/results).
The entries of 2026-10-03 were measured on MSFS 2024 SunRise 12.2.282174.999, with the Black Square Baron 58P Professional, bksq-aircraft-baronpro 0.1.1, parked on a ramp.
Their writes came from outside the sim, once per sim frame, which is fine on the ground and stutters in a moving cockpit ([avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)).
Written from our WASM module, inside the frame, a following 58P stays within 0.7m of the flying aircraft's path 400ms before at 130 m/s, and banks and pitches with it, as the entries of 2026-11-11 measured on the same sim version.

## 2026-11-19: After a handover the 58P's own autopilot rolls the aircraft and runs its trim, wound up while `Follow` held it frozen, which v1 keeps as a known limit

**Asked:** in [stage 16c](../build/plan.md#16c-trim-and-bank-after-a-handover), what moves the Baron 58P's elevator trim and bank in the frames after `Follow` lets it go at a handover ([sync log](../sync/log.md#2026-11-18-in-stage-14bs-session-the-58p-took-every-preset-value-and-its-heading-bug-followed-and-as-it-took-control-its-own-trim-fell-and-it-banked-after-our-trim-write-went-out)), and does it happen behind a PF whose aircraft moves?

**Expected:** the following machine's own autopilot, wound up while it flies an aircraft `Follow` holds frozen, the lead stage 14b left (unverified).

**Found:** on MSFS 2024 on our development machine, 2026-11-19, in bksq-aircraft-baronpro 0.1.1, through [p40](../../../experiments/areas/flight-model/p40-handover-autopilot/session.ts), in two runs.
The real core flew the 58P, a bench core on a stand-in played the second pilot, flying straight and level at 150 kt at 3,100 ft, and a cockpit panel read the 58P each of its frames, 30 a second.

- **The 58P's autopilot winds up while the aircraft is frozen.**
  In heading and altitude hold, through the last 10s of following, it held the aileron at 14.6% to 18.7% in the first run and 15.4% to 21.4% in the second, toward a flight director bank of -3.2° to -4.8° that the frozen aircraft never reached.
- **Once `Follow` let it go, that aileron rolled the 58P at once, and the autopilot ran its trim.**
  Within 0.5s the trim went from -3.7% to +38.7% in the first run and from -6.1% to -55.1% in the second, and within about 2.5s the bank reached 7.2° and 7.9° and the heading drifted 4.5° and 5.0°.
  The autopilot brought the aircraft back on heading and level within about 9s, 109 ft above where it started in the first run and 76 ft below in the second.
- **With the autopilot off, in the off case, neither moved:** the aileron and the trim kept their values through the following and the 12s after.
  In both runs that case came after the catch-up below, so the 58P's autopilot was off there and may have been unpowered too.
- **It happens behind a PF whose aircraft moves.**
  In [the first flight with friends](#2026-11-12-two-pilots-on-two-pcs-flew-one-58p-smoothly-through-13-handovers-over-a-relayed-link-and-after-a-handover-with-the-autopilot-engaged-the-aircraft-drifted), four handovers had the autopilot engaged ([trim readings](results/2026-11-11-flight-with-friends-trim-at-handovers.txt)).
  As the joiner took control in vertical speed mode, its trim ran from -7% to -44% in the last 2s of following and to -91% within 0.5s after, and as the host took control once, from -38% to -52%.
  At a third the trim held at -13%, and at the fourth it was already at -100% as the joiner took control, since that release didn't put the trim back while following.
  These are state sync's readings in [stage 14b's replays](../sync/log.md#2026-11-16-the-drift-after-a-handover-was-the-hosts-heading-bug-which-no-write-moved-after-its-first-and-every-_set-preset-that-missed-took-the-value-of-its-first-call) of the two recordings, with a log line for each reading.
- The 58P's KFC 150 is the sim's own autopilot ([study](../aircraft/black-square-baron-pro/study.md)), and it flies pitch through the trim: the 58P's `systems.cfg` sets `pitch_use_trim = 1`, `pitch_pid_reset_mode=2`, and `roll_pid_reset_mode=2` (read in bksq-aircraft-baronpro 0.1.1, `SimObjects/Airplanes/bksq-aircraft-baronpropress/systems.cfg`).
  The SDK documents that the sim resets a PID only when it hasn't run for 10 frames, under mode 2 to the aircraft's state, so one that runs keeps what it has built up ([systems.cfg](https://docs.flightsimulator.com/msfs2024/retail/content-configuration/cfg-files/systems.cfg/)); no key event resets one ([autopilot events](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/key-events/aircraft-autopilot-and-flight-assistance-events/)).
- FS Copilot follows the same way: its module freezes the aircraft and writes its pose and velocities each frame (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`), and its 58P profile syncs the KFC 150 and the trim (read in the FS Copilot profiles, `definitions/bksq-aircraft-baronpropress.yaml`), so its following autopilot would wind up the same way (unverified).
- **The off-engage, reset, and on-again cases tested nothing, in both runs.**
  The cases ran in the order on, off, off-engage, reset, on-again.
  In both runs, as control passed back to the second pilot after the on case, the real core caught up from the stand-in's cockpit and wrote the altimeters to the stand-in's 0, since the stand-in runs no preset, and from then on the 58P's autopilot didn't engage: state sync logged its `ap_master` write as never landing.
  After the second run the 58P read the switch of its autopilot actuators' circuit, `A:CIRCUIT SWITCH ON:73`, as off and its avionics bus at 0 V, either of which makes its XML hold the autopilot off, but it had come down by then, so what turned the autopilot off is unverified.
  In the first run the stand-in also carried the 58P's descent into the next case, and the 58P ended in the water.
  So the cure p40 meant to try, the autopilot off for over 10 frames around the handover and on again, never ran.
  p40 now levels the stand-in at each case, gives it the 58P's values for the input events the profile watches and the altimeters first, and runs the reset case first; that version hasn't run.
- Both runs' recordings replayed with every checkpoint matching, 197 and 235.

**Changed:** the roll and the trim after a handover with the autopilot engaged are a known limit of flight-model sync, and stage 16c builds nothing (user, 2026-11-19).
The lead, if pilots mind it: as control passes, the machine taking control turns its autopilot off for over 10 frames and on again in the same modes, so each PID starts from the aircraft's state.
On the 58P that also means setting the flight director and modes again, which its XML clears on a disengage (read in bksq-aircraft-baronpro 0.1.1, `BaronProfessional_Base_INT.xml`).

**Affects:** [01-flight-model-sync](01-flight-model-sync.md), through a note at its top; [stage 16c](../build/plan.md#16c-trim-and-bank-after-a-handover); and the comments on the 58P profile's elevator trim and on the sync engine's write as control passes.

**Evidence:** p40's [first run](../../../experiments/areas/flight-model/results/p40-handover-autopilot-2026-11-19-18-46-02.txt) and [second run](../../../experiments/areas/flight-model/results/p40-handover-autopilot-2026-11-19-18-59-03.txt), and the [trim readings of the flight with friends](results/2026-11-11-flight-with-friends-trim-at-handovers.txt).

## 2026-11-12: At the stage's close the bench passed 130 of 131 tests, and the gap's test had waited a fixed 6s for a return that takes 7.5s on a quiet PC

**Asked:** do the scenarios that hold a session in a flight pass on the stage's final tree, the 18 that [stage 16](../build/plan.md#16-flight-model-sync) closes on?

**Expected:** all of them, as the `flight-model` and `avatars` scenarios had passed the evening before.

**Found:** on our development machine, 2026-11-12, after midnight, with the sim closed and little else running.

- The 18 scenarios passed 130 of 131 tests in 41 minutes.
- The failure was the `flight-model` scenario's 2s cut of the relay: 6s after the cut began, the following aircraft was 14.69m from the path, and in two runs of the scenario alone, 69.01m and 9.23m.
  The same test had passed on 2026-11-11 with other programs running.
- QUIC sends again only at its next probe of the silent path, and its probes come at intervals that double, so the samples can return about 2s after a 2s cut ends, and the ease back takes 3s more (unverified against iroh's timers; the times fit).
  With the test changed to wait for the aircraft's return, the aircraft was back on the path 7.5s after the cut began, the 7s the cut, the probe's wait, and the ease add up to plus the half second the test's check takes, and the scenario passed 7 of 7.
- In the two runs of the scenario by itself, its first test failed too: one core's run had a second input over 1ms, which in the first of the two took 23.4ms, at the core's seventh input.
  Every earlier run of that test had one input over 1ms already, the 58P profile's load, at 1.18ms to 1.61ms in 12 cores' runs, which uses up the one pause the bench allows a run.
  So any pause Windows adds fails the test, and it passed again on the third run alone.

**Changed:** the gap's test waits until the aircraft is back within 5m, asserts that takes under 9s, and then checks it stays on the path.

**Affects:** none.
The profile's load over the code map's 1ms for a handler is the profiles' to answer, and isn't changed here.

**Evidence:** the bench's output for [the 18 scenarios](results/2026-11-12-stage-16-bench-at-the-close.txt), and for the `flight-model` scenario's three runs by itself, [the first](results/2026-11-12-stage-16-bench-flight-model-first-rerun.txt), [the second](results/2026-11-12-stage-16-bench-flight-model-second-rerun.txt), and [the third, with the test changed](results/2026-11-12-stage-16-bench-flight-model-third-rerun.txt).

## 2026-11-12: Two pilots on two PCs flew one 58P smoothly through 13 handovers over a relayed link, and after a handover with the autopilot engaged the aircraft drifted

**Asked:** in [stage 16](../build/plan.md#16-flight-model-sync)'s first flight with friends, do two pilots on two PCs, each on an installed release, fly one 58P, each taking control in turn, and do [flight-model sync's cases with friends](01-flight-model-sync.md#cases-for-the-bench) and the cases the plan carried to this flight hold?

**Expected:** the flight to match the sessions in the sim below, with the following aircraft on its wheels where both PCs have the same scenery, and the autopilot left engaged by `Follow`'s axis events.

**Found:** on MSFS 2024 SunRise 12.2.282174.999 on both PCs, from 2026-11-11 23:18 to 2026-11-12 00:06 local, in the Black Square Baron 58P Professional, each PC on the release 0.1.0 packed from this tree and installed from its Setup.exe.
The servers were the bench's backend, one relay, and the profiles' site on our development machine, each behind a Cloudflare quick tunnel, which `tools/sim/friends.ts` starts.
What the pilots saw is theirs, by eye, and the rest is read from the two cores' logs.

- **The link stayed on the relay** for the whole session, as the tunnels carry HTTP alone, so the flight shows a relayed link and no direct one.
  The cores' logs hold no line at error and one at warn: as the sim closed on the joiner's PC, with `Lead` running, `our WASM module stopped with a routine live, so the aircraft stays frozen until the routine ends still_ms=3126`, with its trouble notification, 1s before the sim's quit message.
  Whether a closing sim should raise that trouble is the sim service's to answer, and isn't changed here.
- **Both machines agreed on the ground's elevation:** after preflight, the following pilot saw the 58P on its wheels on the stand, neither above it nor in it, at one airport with the same scenery on both PCs.
- **Flight was smooth on the following machine**, from inside and outside, straight and in turns, through the 30 minutes from preflight's end to the first pilot's leaving.
- **Control passed 13 times, each way, in level flight and in turns**, and both pilots saw no stop or jump at any of them.
  The sessions in the sim measured the 3s ease the new following machine flies through.
- **The autopilot's master stayed engaged through a handover, each way**, so `Follow`'s axis events don't disengage it.
- **After a handover with the autopilot engaged the aircraft drifted, mainly sideways**, the pilot who watched it said.
  State sync's log lines give a likely cause, which the [sync log](../sync/log.md#2026-11-12-in-the-first-flight-with-friends-14-of-state-syncs-writes-read-another-value-15s-later-11-on-the-following-machine-the-elevator-trim-and-autopilot-modes-among-them) has: 1.5s after the write, the following machine's elevator trim and several autopilot modes read other values than the flying pilot's, so the new pilot flying may have taken over with its own (unverified: the logs hold no later reading).
- **The parking brake's `_Set` preset set the other pilot's brake, each way**, the pilots saw, though the joining pilot's log has one such write that didn't land, which the same sync entry lists.
- **A catch-up took about 300ms**: 279ms at preflight's end, and 309ms, 284ms, and 274ms at the three handovers where a change of control had dropped a message, two on the joiner's machine and one on the host's, for 4,421 to 7,699 bytes.
- **The cores' loops were busy 0.89% of a minute at most** on the joining pilot's PC and 1.67% on the host's.

Before the flight, on 2026-11-11, two bench cores on our development machine ran through the same servers and tunnels: the session was hosted in 215ms, both members were in after 1.7s, the path was the relay through its tunnel at a 90ms round trip, and the follower kept within 0.01m of the leader's path 400ms before over 401 frames.

**Changed:**

- The stage's exit has its flight.
- The drift after a handover is state sync's to settle, in work of its own after this stage (user, 2026-11-12).

**Affects:** [01-flight-model-sync](01-flight-model-sync.md), through a note at its top on the cases with friends.

**Evidence:** the two cores' logs, with the pilots' session names replaced by `pilot-a`, who joined, and `pilot-b`, who hosted: [pilot-a](results/2026-11-11-flight-with-friends-pilot-a-core-log.txt), [pilot-a after the tray's Quit](results/2026-11-11-flight-with-friends-pilot-a-core-log-after-the-quit.txt), and [pilot-b](results/2026-11-11-flight-with-friends-pilot-b-core-log.txt).
The three recordings, 28.0 MB, 15.5 MB, and 39.1 MB, stay out of the tree ([recording log](../recording/log.md#2026-11-12-a-friends-recording-of-a-47-minute-flight-replayed-on-our-pc-with-another-cpu-and-every-checkpoint-matched)).

## 2026-11-11: Seated on the pose `Follow` says it writes, a figure keeps its seat on the following machine, and the 58P banks and pitches with the aircraft it follows

**Asked:** in [stage 16](../build/plan.md#16-flight-model-sync)'s second session in the sim, with `Follow` saying where it puts the aircraft and `Figure` seating its figures there, does a figure on the following machine sit still, does the 58P bank and pitch with the stand-in, what does the handover in flight do to its speed, and what does our module's update cost?

**Expected:** the figure to hold its seat, since the routines' test holds it within 1cm, and the handover to slow the 58P by about 800ms of its path over 3s.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, 2026-11-11, with `tools/sim/flight-model.ts`, the release core of this tree, and a pilot at the sim.

- **The figure sat still on the following machine** in flight at about 90 m/s to 130 m/s, the pilot saw, as it did on the flying machine.
- **The 58P banks and pitches with the stand-in.**
  Through a turn of 60.0° with the stand-in banked 25° and pitched up 3°, each over 2s, the 58P's bank went from 0.2° to -25.0°, the sim's bank being negative to the right, and frame by frame its pitch was within 0.14° and its bank within 1.18° of the stand-in's 400ms before.
  It stayed within 0.62m of the stand-in's path, and the pilot saw it bank into the turn and roll out.
- **The handover in flight slows the aircraft for 3s, and the pilot found it smooth.**
  The 58P flew 89.1 m/s before it, between 64.4 m/s and 103.2 m/s after, and 89.4 m/s at the end.
  The largest change between two frames was 26.0 m/s, the step into the ease, and we haven't explained the 103.2 m/s, which may be one frame's time read late (unverified).
- **The velocities read back as written.**
  Frame by frame in straight flight, the 58P's body velocities read 0.00 ft/s and its rotation velocities 0.000 rad/s from the ones the samples carried, where p02's writes from outside the frame read up to 7.6 ft/s and 2.3 rad/s off.
  The stand-in's velocities were constant there, so this shows no spike in a frame, not how the 58P tracks a changing velocity.
- **The brakes read 17,807 and 4,524** for the stand-in's 24,000 and 8,000, where the first session read 16,767 and 2,559.
  The 58P's parking brake was set this time, and those are the sweep's readings of `A:BRAKE LEFT POSITION` with it set, as the first session's are its readings of `A:BRAKE LEFT POSITION EX1`.
- **Straight flight** stayed 0.40m from the stand-in's path 400ms before at the median and 0.44m at most over 221 frames.
- **On the ground** the 58P stayed 0.02m from the path at the median and at p99, and 1.38m at most, in the frames where the script stepped the stand-in up 5 ft at once.
- **At a simulation rate of 2** the ex-PF's aircraft carried on at about the speed it flew: 133.3 m/s before the handover and 123.8 m/s in `Follow`'s first 400ms, neither half nor double.
  So a raised rate does move the aircraft that many times faster than its velocity, as [its first frames](01-flight-model-sync.md#its-first-frames) takes it to.
- **A jump of 50km** left 75ms as the longest gap between two of a panel's frames.
- **Our module's update**, over windows of 300 frames, against the design's 100µs:

  | Routines running | p50 | p99 | Most |
  | --- | --- | --- | --- |
  | `Lead`, on the ground | 42µs | 180µs | 200µs |
  | `Lead` and `Figure`, in flight | 47µs | 91µs | 160µs |
  | `Follow`, on the ground | 51µs | 246µs | 483µs |
  | `Follow` and `Figure`, in flight | 49µs | 207µs | 403µs |

- **Through a second flight load** `Follow` froze the 58P again, but the script read it 201.5m from the stand-in, and 179.9m in the first session.
  That is about 1.5s of flight, where the delay accounts for 0.4s.
  The script reads the two aircraft up to 1s apart, which could be the rest, so whether `Follow` places the 58P late after a second load is unverified, and reading both aircraft frame by frame, as the other cases do, would settle it.
- **Three cases read nothing.**
  The parking brake's case set the stand-in's variable to the value it already held: the stand-in runs no preset, so its copy never took the value the catch-up brought.
  The autopilot was off again after the handover, since the 58P caught up from the stand-in's cockpit, which has none engaged, as in the first session.
  During the Steam overlay's step the pilot used other programs, whose windows are among its reads.
- The core's loop was busy 0.53% of its last minute, and its recording replayed with all 587 checkpoints matching.

**Changed:**

- The user accepted our module's update as measured for this stage, over the design's 100µs at p99: about 50µs at the median, 91µs to 180µs at p99 with `Lead`, and 207µs to 335µs at p99 with `Follow`, over the two sessions (user, 2026-11-11).
- The parking brake's case and the autopilot's go to the flight with friends, where the second aircraft is a 58P too ([build plan](../build/plan.md#16-flight-model-sync)).

**Affects:** [the code map](../architecture/02-code-map.md), through a note at its top on its budgets for work in the sim, and the first session's three notes, which name this entry for the figure.

**Evidence:** [results/2026-11-11-stage-16-session-second-run.txt](results/2026-11-11-stage-16-session-second-run.txt).

## 2026-11-11: In the sim the 58P follows a stand-in's path within centimeters, a figure on the following machine slid along the aircraft, and the brake events follow a curve

**Asked:** in [stage 16](../build/plan.md#16-flight-model-sync)'s first session in the sim, does the Black Square Baron 58P follow a second pilot's aircraft through our WASM module's writes, do the five axis events move its controls, and what does `Follow` cost a frame?
The second pilot was a bench core on a stand-in sim, whose aircraft moves by its velocities alone, with no ground, no flight model, and none of the 58P's presets.

**Expected:** the pose to hold, since p01 and p02 held it from outside the sim, and no prediction for the events or for a figure in an aircraft `Follow` writes, which [the avatars design](../avatars/01-avatars.md#figure-each-frame) names as unmeasured.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, 2026-11-11, with `tools/sim/flight-model.ts`, the release core of this tree, and a pilot at the sim.

- **The pose holds.**
  Frozen by the three freeze events and written through `fsVarsAVarSet`, the 58P moved 23.2m and rose with the stand-in on the ground, 0.02m from the stand-in's path 400ms before at the median and 0.03m at most over 116 frames.
  In flight at about 130 m/s it stayed 0.59m from that path at the median and 0.66m at most over 221 frames, an offset of about 5ms of the panel's clock against the stand-in's, with 7cm between its least and most.
  Through a flat turn of 58.8° it stayed within 0.60m.
- **Pitch and bank weren't tested.**
  The script turned the stand-in by a yaw rate alone, and read no pitch or bank of the 58P.
- **`Lead` reports 20 times a second:** the second pilot's core wrote `Follow`'s slot 250 times in 10s, which is 20 samples a second beside the sim service's 5 rewrites a second.
- **The three surface events land exactly:** with the stand-in's surfaces at -8,000, 6,000, and -5,000 in Position 16k, the 58P's read -8,000, 6,000, and -5,000, its yoke's variables moved, and the pilot saw the yoke held over.
- **The brake events follow a curve.**
  With the stand-in's brakes at 24,000 and 8,000 in Position 32k, sent as the position less 16,384, the 58P's read 16,767 and 2,559.
  A sweep of `K:AXIS_LEFT_BRAKE_SET` afterwards read 0 at -16,383, 8,846 at 0, 16,767 at 7,616, and 32,767 at 16,383.
  From half travel up, the output is close to the square of the input as a fraction of full travel: 0.27 at 0.50, and 0.51 at 0.73.
  `A:BRAKE LEFT POSITION` read 32,767 at rest with the parking brake set, and `A:BRAKE LEFT POSITION EX1` read 0, so the plain variable carries the parking brake too.
- **A figure on the following machine slid forward and back along the aircraft**, the pilot saw, while it sat still on the flying machine.
  The routine host makes a routine's reads at once and its writes once every routine has run, so `Figure` read the pose `Follow` wrote the frame before and led it by the last frame's change, which lands right only when two frames take the same time.
  A test of the module's list of routines, with frames of 12ms to 22ms at 130 m/s, has the figure's hip 0.62m to 2.70m ahead of the aircraft's reference point, where its seat is at 1.4m.
- **The handover in flight felt a bit rough**, the pilot said.
  Each follower is drawn 400ms behind, so at a handover the aircraft drops back about 800ms of its path, about 100m at that speed, eased over 3s (arithmetic on the design's delay and ease).
  The script recorded nothing through the handover, so whether that's what the pilot felt is unverified.
- **At a simulation rate of 2** the ex-PF's aircraft carried on at about the speed it flew: 130.8 m/s before the handover and 123.3 m/s in `Follow`'s first 400ms, neither half nor double.
- **A jump of 50km** went through with no stall: the longest gap between two of a panel's frames was 77ms, and the pilot saw no freeze.
- **Through a second flight load**, `Follow` froze the 58P again and wrote it to the stand-in's place, which the script read 179.9m from it, and which by then was under the sea's surface, since the stand-in has no ground.
  The frozen 58P didn't crash there (seen once).
  The machine's catch-up after that load took 30s, against 0.6s at the handover in flight.
- **Our module's update**, timed by the patch stage 17 used, over windows of 300 frames, against the design's 100µs:

  | Routines running | p50 | p99 | Most |
  | --- | --- | --- | --- |
  | `Lead`, on the ground | 41µs | 135µs | 198µs |
  | `Lead` and `Figure`, in flight | 47µs | 112µs | 208µs |
  | `Follow`, on the ground | 54µs | 335µs | 622µs |
  | `Follow` and `Figure`, in flight | 49µs | 313µs | 438µs |

- **The autopilot's case read nothing.**
  The 58P's autopilot was off after the second pilot took control, and at that handover the machine caught up from the stand-in's cockpit, which has none engaged, so the run can't tell whether the axis events disengage it.
- **Stage 14's parking brake case failed on the script's timing** (unverified).
  The script set the stand-in's parking brake within 2s of preflight's end, while the second pilot's core was still taking its catch-up, and the 58P's never moved.
  From a cockpit panel afterwards, `B:LANDING_GEAR_ParkingBrake_Set` set and released it within about 100ms, twice each way, and it held, with the pilot's hardware enabled and disabled.
- **Steam's overlay** left the sim's own window under the cursor in all 34 reads, stage 17's check.
- The core's loop was busy 0.57% of its last minute, and its recording replayed with all 470 checkpoints matching.

**Changed:**

- `Follow` says where it puts the aircraft each frame through a new want of the routine host, and `Figure`, after it in the module's list, seats its figures on that pose with no lead; with no such pose, `Figure` reads the aircraft and leads it by a frame as before.
  We weighed it against a read that returns the frame's earlier writes, which changes what every read means and holds only while both routines name the pose in the same units, and against a store for any note between routines, which is a wider mechanism than one note needs (user, 2026-11-11).
  That the figure then sits still in the 58P waits for the next session.
- The brakes stay as they are for now, as known limits of [01-flight-model-sync](01-flight-model-sync.md): a following aircraft's toe brakes read less than the PF's in mid-travel, and full while the PF's parking brake is set (user, 2026-11-11).
  A frozen aircraft's brakes change only what the pilot sees, not how it moves, and the curve was read on one aircraft, so a table of it could put another aircraft's further off.
  A pilot who takes control on the ground starts with the brake the events last left, which is untested.
- The script banks and pitches the stand-in through its turn and reads the 58P's pitch and bank, records through the handover in flight, waits for the second pilot's catch-up before the parking brake's case, and prints the module's times in µs.

**Affects:** [01-flight-model-sync](01-flight-model-sync.md), [the avatars design](../avatars/01-avatars.md), and [the code map](../architecture/02-code-map.md), each through a note at its top.

**Evidence:** [results/2026-11-11-stage-16-session-first-run.txt](results/2026-11-11-stage-16-session-first-run.txt), and the test in `src/sim-package/routines/src/tests.rs`.

## 2026-11-11: On the bench a following aircraft keeps to the flying one's path 400ms behind, and samples that arrive together after a gap made `Follow` jump

**Asked:** [stage 16](../build/plan.md#16-flight-model-sync) built `Lead`, `Follow`, and the feature's crate, and ran [01-flight-model-sync's cases](01-flight-model-sync.md#cases-for-the-bench) as the routines' own tests and on the bench, with two and three cores whose stand-in aircraft move by their velocities.
Do the cases pass as the design has them, and do its budgets hold?

**Expected:** the cases to pass, since the design's rules are arithmetic on samples.

**Found:** on our development machine, with the bench's builds of this tree.

- **Following:** over 783 frames in 10s, the following stand-in's aircraft stayed within 0.01m of where the flying one's was 400ms before, at 150 kt.
  Two cores on one PC share its counter, and a stand-in hands a slot's write to its module at once, so neither module's shortfall shows here.
- **Samples:** the following core wrote `Follow`'s slot 251 times in 10s: 20 samples a second, and the sim service's rewrite every 200ms, 5 a second.
  A sample is at most 85 bytes in postcard (arithmetic on its fields' largest encodings), and a test holds it under the design's 90.
- **The loop:** each core's slowest input in that run took 1,557µs and 1,363µs, the one input over 1ms on each, which was its profile's load, and the loop was busy 0.44% of the run.
- **The routine host's offset:** with the module's clock 12s behind and write delays drawn from 2026-10-09's round trips, the offset 10s after its first header was within 2ms of where it stood after 2 hours, in the routine host's own test.
- **A gap's samples arriving together made `Follow` jump.**
  The bench's relay holds a cut core's packets back and hands them over together, so after a cut the samples of the gap arrived at once, each older than the frame's time less the delay.
  `Follow` then carried on from the newest of them, which put the aircraft back on the path in one frame: a step at 1,183 m/s where it flies at 77.
  The design eases only "when a sample is old enough to draw from again", and a carry that goes on from a newer sample is a step too.
- **Samples all ahead of the frame's time sent the aircraft back to its start.**
  With more samples than `Follow` keeps, all stamped ahead of the frame's time less the delay, no sample was old enough, and `Follow` took that for its first frames and moved the aircraft as it moved when `Follow` started.
- **The first clock offset takes about 2s.**
  A following core drops samples until the network has its sender's offset, and two cores that linked and entered the flight within 0.2s took their first sample about 2s after the link came up, where the design says at most about 1s.
  An exchange needs this core's heartbeat echoed in one of the other's, and each goes once a second, so the first can take two.
- **A restarted core** that follows showed no trouble notification for our package before the module's first status write, the case [the apps' design](../interface/01-apps.md#cases-for-the-bench) asks.
- **Rust's float-to-integer casts** compile to an instruction cargo-msfs's check refuses, as stage 17 found, so the routines clamp a surface's value themselves and convert it unchecked.

**Changed:**

- `Follow` records what placed the aircraft in each frame: its own motion, two samples, a carry and the sample it goes on from, or a hold.
  Whenever the place can be a step from the frame before's, it takes the difference as a correction and eases it over 3s, or writes at once past 1km.
  The same test cases pass, and two more: a gap's samples arriving together, and samples all ahead of the frame's time, which hold the aircraft where it was.
- Before its first sample, `Follow` carries its own motion for at most 2s, then holds, as it does past its newest sample.
- `Lead`'s report and the sample between cores are one struct, `Sample`, and the feed that starts `Follow` carries no sample.
- A profile's unload ends flight-model sync's routines along with every other feature's, and flight-model sync doesn't start them again.
  v1 unloads a profile only as the pilot leaves the flight or the session ends, when the routines end anyway ([build plan](../build/plan.md#16-flight-model-sync)).
  A profile reloaded mid-flight would end `Lead` for good, which only the IDE's reload can do, after v1.
  We weighed a tie to the session in the sim service, about 15 lines that the bench couldn't exercise in v1 and that cost the same to add with the IDE, and left it out as a known limit of [01-flight-model-sync](01-flight-model-sync.md) (user, 2026-11-11).

**Affects:** [01-flight-model-sync](01-flight-model-sync.md), [the code map](../architecture/02-code-map.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), and [testing](../build/02-testing.md), each through a note at its top.

**Evidence:** `node tools/bench.ts flight-model`, whose `budget:` lines carry the figures, and the tests in `src/features/flight-model/routines/src/tests.rs`, `src/features/flight-model/core/src/`, and `src/platform/routine-host/src/tests.rs`.

## 2026-10-03: Written every frame, the velocities hold, and the follower's airspeed matches while its engine temperatures start apart

**Asked:** with the pose, every velocity, and the engine levers written each frame, do the velocities hold where we write them, and does the frozen Baron read the same airspeed, engine, and gauge values as the flight it follows?

**Expected:** the velocities to hold, and no prediction for the Baron's own engine model.

**Found:**

- We recorded a 414s circuit in the 58P, 12,794 frames, and replayed it into the same aircraft parked with both engines running.
  Each frame wrote the pose, `VELOCITY BODY X`, `Y`, and `Z`, `ROTATION VELOCITY BODY X`, `Y`, and `Z`, both throttles and propeller levers, and `L:BKSQ_MixtureLeverPosition_1` and `_2`.
- The velocities held:
  - `VELOCITY BODY Z` read 0.06 ft/s from what we wrote on average and 0.97 ft/s at most, against up to 352 ft/s in the recording.
  - `X` and `Y` read 0.24 ft/s off on average, with single frames up to 7.6 ft/s.
  - The rotation velocities read 0.09 rad/s off on average, with single frames up to 2.3 rad/s.
- The follower's readings matched the recording:
  - `A:AIRSPEED INDICATED` was 0.9 kt off on average and 3.2 kt at most.
  - `A:VERTICAL SPEED` was 9 ft/min off on average and 146 ft/min at most.
  - `A:PROP RPM` was 7 rpm off on average, with up to 340 rpm during power changes.
  - Manifold pressure was 0.07 inHg off and fuel flow 0.09 gal/h off, on average.
- The engine temperatures started apart and closed slowly, because the follower's engines had just been started while the recording's were warm:
  - The stock left CHT was 59°C off on average in the first fifth of the replay and 6°C in the last.
  - `L:BKSQ_CHT_1` was 134 off in the first fifth and 11 in the last, in the Baron's own units.
- Replayed again with the pose and levers but no velocities, stopped after 120s:
  - Airspeed was 12 kt off on average and 22 kt at most.
  - Vertical speed was 354 ft/min off on average and 1,307 ft/min at most.
  - RPM, manifold pressure, and fuel flow tracked about as well as before, with the levers setting them.
- The pilot watching saw little difference between the two replays out of the window.

**Changed:** writing the velocities each frame is what keeps the following pilot's airspeed and vertical speed indicators with the flying pilot's: without them, the follower's airspeed was 22 kt off within two minutes.
The levers carry RPM, manifold pressure, and fuel flow.
On the Baron, a follower whose engines started cold shows CHT readings that disagree with the flying machine's for minutes.

**Affects:** flight-model sync and state sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [the recording](../../../experiments/areas/flight-model/results/p02-replay-record-2026-10-03-09-45-01.txt), [the replay](../../../experiments/areas/flight-model/results/p02-replay-replay-2026-10-03-09-52-02.txt), and [the replay without velocities](../../../experiments/areas/flight-model/results/p02-replay-replay-pose-only-2026-10-03-09-59-04.txt), with each frame in the gzipped `.ndjson.gz` beside each.

## 2026-10-03: Freezing holds the pose but not the velocities, so a follower has to write them all

**Asked:** when the following machine freezes the aircraft's position, altitude, and attitude and writes the pose every frame, as our FS Copilot fork does (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`), what happens to everything else the flight model computes?

**Expected:** no prediction.

**Found:**

- With `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET` at 1, all three freeze flags read 1, and the written latitude, longitude, altitude, pitch, bank, and true heading read back exactly, at most 0.01° off, except for one frame each time the written value jumped.
- Frozen and written 5 ft above where it sat, with only the pose written, the parked aircraft's `A:VELOCITY BODY Z` climbed from 0 to 68 ft/s in 4s, `A:GROUND VELOCITY` reached 42 kt, and the left propeller windmilled to 204 rpm with the engine off.
  The aircraft didn't move, because its position was frozen and written.
- Written back onto the ground, still frozen, the velocity fell from 72 ft/s to 6 ft/s over 4s, and `A:PROP RPM:1` swung as low as -76 rpm before settling at 0.
- Released on the ground once the velocity had bled off, the aircraft sat still: no drop, bounce, or roll.

**Changed:** a frozen aircraft's flight model still integrates speed, and the propeller and engine follow the speed it computes.
So a following machine has to write every velocity the flight model integrates, each frame, or the frozen aircraft's airspeed, propeller, and the Baron's own engine model drift away from the flying machine's.
Our FS Copilot fork's physics packet leaves out `VELOCITY WORLD Y`, `VELOCITY BODY X`, and the rotation velocities (read in the FS Copilot fork, `FsCopilot/Simulation/Physics.cs`), so those would drift on its following machine (unverified: we haven't run it).
Whether writing every velocity each frame keeps them all pinned is unmeasured.

**Affects:** flight-model sync in [03-v1-scope](../product/03-v1-scope.md).

**Evidence:** [the first run](../../../experiments/areas/flight-model/results/p01-frozen-baron-2026-10-03-09-18-08.txt), steps "frozen 5 ft high" through "released", with each frame in the `.ndjson` beside it.

## 2026-10-03: The Baron's ground contact follows the written altitude, and its own physics writes don't hold against ours

**Asked:** on a frozen Baron, what does `A:SIM ON GROUND` report when we write the aircraft above or below the ground, and do the Baron's own physics writes fight a follower's?
The Baron sets `A:VELOCITY BODY X` and `Z` to 0 at 60 Hz while `L:bksq_WheelChocks` is set, and writes `A:PLANE BANK DEGREES` at 15 Hz during an engine start (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md), sim question 6).

**Expected:** no prediction.

**Found:**

- Written 5 ft high, `A:SIM ON GROUND` and `A:GEAR IS ON GROUND` for all three gear went from 1 to 0 within a frame, and `A:PLANE ALT ABOVE GROUND` read 8.29 ft against 3.29 ft parked.
  Written 2 ft low, they read 1 again, with 1.29 ft above ground.
  The cowl flaps stayed at 0% and the chocks stayed out throughout.
- With the chocks in, frozen, and written rolling forward at 5 ft/s:
  - `A:VELOCITY BODY Z` read 0 in the first frame, then 4.41 to 4.50 ft/s for 0.4s.
  - At 0.47s `L:bksq_WheelChocks` went from 1 to 0 without us writing it, and the velocity read 4.58 to 4.80 ft/s after that.
  - The position held within 0.06m of where we wrote it.
- Frozen, with the attitude written each frame, through an engine start: in all 356 frames with `A:GENERAL ENG STARTER:1` at 1, `A:PLANE BANK DEGREES` read back exactly what we wrote.
  The cockpit shook on screen all the same (seen by the pilot), so the shake reaches what the sim draws without changing the value SimConnect reads back.

**Changed:** a follower's written altitude decides what the Baron reports about the ground, so a follower written even a few feet high tells the Baron it's airborne.
The chocks don't stop a follower, but the Baron took its own chocks away once the written aircraft moved: the follower's aircraft changed its own state in reply to written motion, and state sync would see that change as if a pilot had made it.
The engine-start shake doesn't change a follower's written attitude, and the follower's pilot still sees it.

**Affects:** flight-model sync and state sync in [03-v1-scope](../product/03-v1-scope.md); the Baron study's sim question 6.

**Evidence:** [the first run](../../../experiments/areas/flight-model/results/p01-frozen-baron-2026-10-03-09-18-08.txt) for the ground and chocks, and [the engine-start run](../../../experiments/areas/flight-model/results/p01-frozen-baron-2026-10-03-09-26-18.txt), with each frame in the `.ndjson` beside each.
