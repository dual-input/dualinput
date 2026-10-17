# Traffic and ATC: log

What our reads and probes found about carrying one pilot's AI traffic and ATC audio to the other pilots' machines, newest entry first.
Our FS Copilot fork built both, and its record, `record/traffic-atc/` in the FS Copilot fork, holds the measurements made before this area existed: smooth copies from freezing each object and writing it every frame, a 2Hz poll, a gate that sends about 20% of samples, and ATC audio about 130ms from capture to speaker.
The probes are in [experiments/areas/traffic-atc](../../../experiments/areas/traffic-atc), and their raw output is in [experiments/areas/traffic-atc/results](../../../experiments/areas/traffic-atc/results).

## 2026-10-17: FS Copilot's code holds the traffic and ATC mechanisms 6.14 carries over, p10's ground objects at EGLL were GSX's gate signs and the sim's pushback tugs, and SayIntentions' program is SayIntentionsAI

**Asked:** for node 6.14's [design](01-traffic-and-atc.md), how FS Copilot's traffic and ATC code works beyond what its record says, what the SDK documents about AI objects, what our own probes measured of them, and which ground objects a traffic host's poll finds at a busy airport.

**Expected:** FS Copilot's code to match its record, and the ground objects at EGLL to be mostly the airport's own vehicles.

**Found:** three research agents read FS Copilot's code, the SDK's pages, and our records, and p01 read p10's capture with no sim running.

- FS Copilot's host polls `AIRCRAFT` and `HELICOPTER` within 200km every 500ms, `GROUND` only behind a development flag, reads each new object's identity once, and sends a state only past its gate's thresholds or on a 5s heartbeat, repeating the sample that ends a motion on the next two polls ([traffic report](results/2026-10-17-fsc-traffic-code.txt), points 1 and 4).
- Its receiver creates each copy with the host's title and livery, falls back to "Asobo PassiveAircraft Citation CJ4" or "Asobo PassiveAircraft Bell 407" on an exception, releases and freezes it, writes its gear, flaps, lights, and engines on change, and writes its pose on every `Frame` event, interpolated behind a delay that follows the samples' spacing, extrapolating at most 600ms past the newest (same report, points 3 and 4).
- Its receiver counts, every 10s, the aircraft in its own sim that it didn't create, and warns while that count is above 0 (same report, point 6).
- Its ATC capture ships with a list of six program names, `BeyondATC`, `SayIntentions`, `Pilot2ATC`, `PF3`, `FSHud`, and `VoxATC`, matched exactly against each process's name; plays behind a fixed 60ms start; and puts no stamp on its frames ([ATC report](results/2026-10-17-fsc-atc-code.txt), points 1, 3, and 5).
- On our development machine, SayIntentions' Start menu shortcut runs `SayIntentionsAI.exe`, and BeyondATC's runs `BeyondATC.exe` (read on 2026-10-17), so FS Copilot's `SayIntentions` never matches its process.
  The user has had reports of SayIntentions working well through FS Copilot's capture (reported by the user, 2026-10-17), which would then have been a program picked by hand (inference).
- The SDK caps the objects a client creates at 1,000, has a create that misses its title fail with `CREATE_OBJECT_FAILED`, and documents no variable that says which client spawned an object; `AIReleaseControl` failed on every `StaticObject` our probes created, and their freeze held anyway ([SDK and probes report](results/2026-10-17-sdk-and-probes.txt), sections A and B).
- p10's capture at EGLL held 850 ground objects within 5km over its 10 minutes: 823 of GSX's, 594 of them `FSDT_GSX_Font_BLED_VGDS_small_yellow` docking-guidance boards and 219 `FSDT_SafeDock_TS24_wall_off` walls, none of which moved, and 27 of the sim's pushback tugs, `ASO_Pushback_White` and `ASO_Pushback_Blue`, 7 of which moved, pushing AI aircraft ([p01's output](../../../experiments/areas/traffic-atc/results/p01-ground-objects-2026-10-17-13-51-07.txt)).
  705 of GSX's objects and 23 of the tugs came within 1km of the pilot's aircraft, and no fuel truck, catering truck, or baggage cart appeared.

**Changed:** each sim that runs GSX makes its own signs, so carrying every ground object would show them twice, and nothing in an object's variables tells one spawned for the crew's aircraft from one each sim makes itself.
So [traffic](01-traffic-and-atc.md#which-objects-the-host-carries) carries a ground object only by an allowlist of titles, starting with the pushback tugs; picks the ATC app automatically by `BeyondATC` and `SayIntentionsAI`; and stamps each ATC frame, which its buffer reads.

**Affects:** [01-traffic-and-atc](01-traffic-and-atc.md), and [traffic sync](../product/03-v1-scope.md#traffic-sync) and [hearing ATC](../product/03-v1-scope.md#hearing-atc) through their notes.

**Evidence:** the three reports in [results/](results/), and [p01's output](../../../experiments/areas/traffic-atc/results/p01-ground-objects-2026-10-17-13-51-07.txt) from [p01-ground-objects.mjs](../../../experiments/areas/traffic-atc/p01-ground-objects.mjs).
