# Flight model: log

What our experiments found about syncing the aircraft's flight model between the flying machine and the following machine, newest entry first.
A frozen Black Square Baron 58P holds the pose we write, but the sim keeps integrating its velocities, so a following machine has to write every velocity along with the pose.
The Baron's ground contact follows the written altitude, and neither its chocks nor its engine-start shake held against our writes.
The probe is [p01-frozen-baron.mjs](../../../experiments/areas/flight-model/p01-frozen-baron.mjs), and its raw output is in [experiments/areas/flight-model/results](../../../experiments/areas/flight-model/results).
Every entry was measured on MSFS 2024 SunRise 12.2.282174.999 on 2026-10-03, with the Black Square Baron 58P Professional, bksq-aircraft-baronpro 0.1.1, parked on a ramp.
Our writes came from outside the sim, once per sim frame, which is fine on the ground and stutters in a moving cockpit ([avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)).

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
  Whether the cockpit shook on screen wasn't recorded.

**Changed:** a follower's written altitude decides what the Baron reports about the ground, so a follower written even a few feet high tells the Baron it's airborne.
The chocks don't stop a follower, but the Baron took its own chocks away once the written aircraft moved: the follower's aircraft changed its own state in reply to written motion, and state sync would see that change as if a pilot had made it.
The engine-start shake doesn't reach a follower's attitude.

**Affects:** flight-model sync and state sync in [03-v1-scope](../product/03-v1-scope.md); the Baron study's sim question 6.

**Evidence:** [the first run](../../../experiments/areas/flight-model/results/p01-frozen-baron-2026-10-03-09-18-08.txt) for the ground and chocks, and [the engine-start run](../../../experiments/areas/flight-model/results/p01-frozen-baron-2026-10-03-09-26-18.txt), with each frame in the `.ndjson` beside each.
