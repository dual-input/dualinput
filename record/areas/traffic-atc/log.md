# Traffic and ATC: log

What our reads and probes found about carrying one pilot's AI traffic and ATC audio to the other pilots' machines, newest entry first.
Our FS Copilot fork built both, and its record, `record/traffic-atc/` in the FS Copilot fork, holds the measurements made before this area existed: smooth copies from freezing each object and writing it every frame, a 2Hz poll, a gate that sends about 20% of samples, and ATC audio about 130ms from capture to speaker.
The probes are in [experiments/areas/traffic-atc](../../../experiments/areas/traffic-atc), and their raw output is in [experiments/areas/traffic-atc/results](../../../experiments/areas/traffic-atc/results).

## 2026-11-16: Traffic held its budget with 25 moving copies, and the cost the day before came from 19 moving aircraft and 30 the stand-in turned

**Asked:** `Traffic`'s time in the sim with 25 copies moving, the case its budget names, and where the 60µs it took the day before went, with p04's patch timing each part of our module's update over windows of 300 frames: taking the core's slot writes, `Traffic`'s frame, the other routines' frames, and carrying out their writes.

**Expected:** `Traffic` under 0.1ms with 25 moving copies, and parked copies writing nothing.

**Found:** on MSFS 2024 at KSFO in the Black Square Baron 58P, with multiplayer and the sim's AI traffic off, the real core receiving and the second pilot of p03's harness sharing its stand-in's AI traffic; each line gives the medians of the windows' p50 and p99:

| Copies | Windows | `Traffic`'s frame | Its writes | Our module's whole update |
| --- | --- | --- | --- | --- |
| None | 13 | 0 | 0.3µs, 0.7µs | 33.4µs, 82.1µs |
| 25 taxiing circles, each moving every frame | 12 | 5.6µs, 8.4µs | 16.4µs, 24.8µs | 55.5µs, 101.2µs |
| FS Copilot's KSFO capture, as the day before | 15 | 21.6µs, 30.8µs | 28.2µs, 47.7µs | 84.6µs, 136.9µs |
| The capture, its parked aircraft held whole | 12 | 22.6µs, 29.6µs | 19.6µs, 30.1µs | 68.6µs, 106.3µs |
| Both, the parked aircraft held whole | 11 | 28.7µs, 40.3µs | 37.2µs, 59.2µs | 100.4µs, 174.0µs |

- With 25 moving copies, `Traffic`'s frame and its writes together took about 22µs at p50, and at most 33µs at p99, the sum of the two.
- The capture holds a median 136 objects in any 5s, 19 of them moving and 14 of those airborne; 2026-11-15's entries counted 3 or 4 moving, which were the movers reads.mjs scored within 3km.
- The stand-in moves an AI object's altitude and attitude by its velocities unless their freezes are on, and the harness froze only latitude and longitude, so it turned the 30 of the capture's 124 parked aircraft that hold a small rotation or vertical velocity while still, and their copies were written every frame; with all three freezes on, the writes took 19.6µs, from 28.2µs.
- In `Traffic`'s frame, a parked copy took about 0.15µs a frame and a moving one 0.22µs, and each value written took about 0.22µs more, where a parked copy wrote nothing. At the traffic host's 500 objects, 50 of them moving with 4 values each, that comes to about 120µs at p50 (unverified).

**Changed:** the harness holds each played aircraft with all three freezes on. `Traffic`'s budget holds, and the 60µs of 2026-11-15's entry was the capture's 19 movers and the 30 aircraft the stand-in turned.

**Affects:** the plan's stage 18.

**Evidence:** [p04's windows](../../../experiments/areas/traffic-atc/results/p04-traffic-parts-2026-11-16-18-34-27.ndjson), from [p04-traffic-time](../../../experiments/areas/traffic-atc/p04-traffic-time).

## 2026-11-16: The whole bench passed 175 of 176 cases on stage 18's committed tree, the desktop app's idle CPU over its 0.2% as on every run the day before

**Asked:** whether the whole bench passes on the tree committed for stage 18, with its late changes in: `Traffic` writing only what changed, the playout's alike samples, the B505 stand-in, and the kit's rooms measuring only on a shown page.

**Expected:** every case to pass.

**Found:** on our development machine, with other programs taking about 12% of its CPU:

- 175 of 176 cases passed in 51 minutes, every `traffic` and `atc-audio` case among them.
- ATC audio took 7,082 bytes a second while ATC talks, 141.6 bytes a frame through the relay, against about 7KB/s.
- The one failure: the desktop app, with no window and the sim closed, used 0.260% of one CPU core over 60s against 0.2%, and held 4.06 MB. It read 0.24% to 0.29% on every run of 2026-11-15, where stage 15 read 0.14% to 0.15% ([install log](../install/log.md#2026-11-11-the-bench-read-the-desktop-apps-cpu-in-whole-156ms-clock-ticks-read-from-cycles-the-app-uses-014-to-015-of-a-core)); stage 18 changes nothing the desktop app runs, and why it reads higher is unknown.

**Changed:** nothing.

**Affects:** the plan's stage 18, whose bench this is, and the desktop app's CPU budget, stage 15's.

**Evidence:** `node tools/bench.ts` on 2026-11-16.

## 2026-11-15: Writing only what changed, `Traffic` took about 60µs a frame with 105 copies, the copies kept their velocities, and the B505 created as the helicopter's stand-in

**Asked:** the checks the first session left for a rebuild: `Traffic`'s time once each copy writes only the values that changed and two alike samples skip the interpolation, whether a frozen copy keeps written velocities between frames, the B505 as the helicopter's stand-in, and the Traffic tab once the kit's rooms measure only on a shown page.

**Expected:** `Traffic` near its 0.1ms, moving copies still reading their velocities, and the B505 creating.

**Found:** on MSFS 2024 at KSFO, the same setup as the entry below, with FS Copilot's KSFO capture replayed smoothly:

- Our module's update took a median 98µs to 113µs at p50 with about 105 copies, 2 to 4 of them moving, against 36µs to 48µs with none in the same run, so `Traffic` took about 60µs at p50, down from about 85µs; at p99 the windows with and without copies overlapped, 120µs to 390µs against 165µs to 425µs, too spread to give `Traffic`'s share.
- Every moving copy read a body velocity, written only when it changed, so a frozen copy keeps written velocities between frames.
- The helicopter's made-up title threw, and its stand-in, `Asobo PassiveAircraft B505`, created; the airliner's created as the CJ4, and the Traffic tab counted both as missing or shown incorrectly, with the dot on its icon.
- The Traffic tab's rules no longer ran over its packs card, and its plane showed in the tab bar and the header, where in the first session the tab bar showed none; what hid it then is unknown.
- Copies scored 0.15 to 0.17 on FS Copilot's jitter measure, at 30.3 fps to 31.0 fps.

**Changed:** nothing more; `Traffic`'s remaining 60µs, which isn't the writes, is unexplained.

**Affects:** the plan's stage 18, whose `Traffic` budget this leaves open.

**Evidence:** [the sessions' results](../../../experiments/areas/traffic-atc/results/p03-sim-session-2026-11-15.txt), its second session's section.

## 2026-11-15: In the sim, copies drew at 0.16 on FS Copilot's jitter measure, written lights and flaps took on them, and AI aircraft's light switches showed what the sim drew where no flap variable did

**Asked:** stage 18's cases in the sim ([cases for the bench](01-traffic-and-atc.md#cases-for-the-bench), "In the sim", and the note of 2026-11-15's four checks), and its budgets there: the sim's frame on a receiving machine, `Traffic`'s time, and ATC from the app to the crew.

**Expected:** copies as smooth as FS Copilot's 0.17, the five light switches and four flap surfaces following what the sim draws, and `Traffic` under 0.1ms at p99.

**Found:** on MSFS 2024 at KSFO in the Black Square Baron 58P, on one PC, with the real core hosting and a bench core as the second pilot ([the session's results](../../../experiments/areas/traffic-atc/results/p03-sim-session-2026-11-15.txt)):

- With the real core as traffic host over the sim's AI traffic and BeyondATC, every poll was whole, 13ms to 45ms each, carrying 144 to 277 objects at 20 to 26 bytes a second each, which is 2.6KB/s to 7.1KB/s; the second pilot held 147, then 247 copies.
- The parked 58P read `IS USER SIM` 1 throughout while its pilot walked around it, so the poll never carries it.
- The sim's own tugs, `ASO_Pushback_White` and `ASO_Pushback_Blue`, became copies; GSX's, about 60 titled `FSDT_Pushback_03_ASOBO_…` and `FSDT_Tug_M1A_…` within 1km, didn't, the allowlist leaving them out. `K:TOGGLE_PUSHBACK` on the 58P brought no tug, so whether the poll finds the tug of the pilot's own pushback stays open; GSX's pushback of it brought `FSDT_Tug_660_UA` and two others.
- On BeyondATC's aircraft, the five light switches showed what the sim drew and the `LIGHT … ON` variables didn't: 68 parked aircraft read all five `ON` while their pilot saw them dark but for their logo lights, and the switches read mostly off; on aircraft holding short and lining up, the switches read taxi, beacon, and nav, then strobes and landing lights at the runway, as the pilot saw.
- No flap variable showed the flaps BeyondATC's FSLTL 737s drew: on two, lined up and rolling with their flaps visibly out, the four surfaces, their angles and indexes, and the handle's index and percent all read 0; on aircraft whose flaps showed up, the surfaces read 0 and the handle 0 or 1.
- Copies took what traffic wrote, with one write each: every light switched on showed on every copy, parked ones too, and read back; flaps written at 60% read back 60 on 97 of 101 parked copies and every mover; a copy whose taxi light switched kept its nav and beacon on throughout. Every copy read its three freezes on, every moving copy a body velocity, and the copies showed on the 58P's traffic display.
- Copies of FS Copilot's KSFO capture, which the second pilot replayed as its stand-in's AI traffic, scored a median 0.16 and p90 0.25 over 149 movers on FS Copilot's jitter measure, against BeyondATC's own traffic's median 0.21 and p90 0.38 in the same sim; the sim held a median 30.9 fps with about 105 copies, against 30.4 with none.
  Replayed at the capture's 2Hz with the stand-in moving each aircraft on its velocities, copies eased back at each stop and hitched now and then, both the replay's: the stand-in carried each aircraft past its next state, and two 2Hz clocks beat; moved between its states every 100ms, the stand-in gave neither.
- With about 105 copies, 3 or 4 moving, our module's update took a median 120µs to 130µs at p50 and 280µs to 325µs at p99, against 37µs to 40µs and 150µs to 170µs with none, so `Traffic` cost about 85µs at p50 and about 120µs at p99, over its 0.1ms with 25 movers. Natively the same mix takes 6.0µs at p50, and 4.8µs once two alike samples skip the interpolation, so most of the 85µs is likely the 12 values each mover writes each frame (unverified).
- For a title the sim lacked, the airliner's create threw and its stand-in, the CJ4, created; the helicopter's stand-in, `Asobo PassiveAircraft Bell 407`, threw too, being none of MSFS 2024's 16 passive helicopters, among them `Asobo PassiveAircraft B505`. None of the capture's 140 titles threw.
- The real core captured BeyondATC, and the second pilot played every transmission whole on the same speakers: 106 to 679 frames each, none late or concealed, at the least depth, 60ms; the pilot heard the copy as an echo come and go with its volume.
- The real core, a debug build, held 47.9 MB private and 83.9 MB working set with about 105 copies.
- The sim crashed once, before anything was shared and about a minute after BeyondATC's first aircraft, our module stopping 22s before its connections were lost; nothing in our core's log ties it to us, and it didn't recur.

**Changed:** the helicopter's stand-in is `Asobo PassiveAircraft B505`, which the next session in the sim checks; the playout returns two alike samples as they are; and stage 18's in-sim cases stand as passed but for `Traffic`'s budget, the helicopter's stand-in, the tug of the pilot's own pushback, multiplayer's pilots in the count, and SayIntentions' capture.

**Affects:** [01-traffic-and-atc](01-traffic-and-atc.md)'s dress, its stand-ins, and its known limits, through a note.

**Evidence:** [the session's results](../../../experiments/areas/traffic-atc/results/p03-sim-session-2026-11-15.txt), from [p03-sim-session](../../../experiments/areas/traffic-atc/p03-sim-session); [the sim's helicopter titles](../../../experiments/areas/traffic-atc/results/p03-titles-2026-11-15-17-48-57.ndjson).

## 2026-11-15: Stage 18's bench passed traffic's and ATC audio's cases, a poll's 851 answers each within 1ms, and ATC audio took 6.8KB/s through a relay

**Asked:** stage 18's [cases for the bench](01-traffic-and-atc.md#cases-for-the-bench) and its [budgets](01-traffic-and-atc.md#budgets) there.

**Expected:** each case to pass, and each budget to hold.

**Found:**

- Every case passed on the bench's cores at the end, a quiet PC's runs counting for the timings: a state that comes before its identity waited for it, through the bench's new hold on a channel; a copy that stopped held where its original did, once the gate's fix was in (entry below); and a traffic host carried 500 objects at most, its receiving pilot leaving the flight and coming back within the kernel's 1,000 calls an input.
- A poll's answers, 130 aircraft and a helicopter and 20 tugs and 700 GSX signs, each took under 1ms; the one input of either core's run over it was the profile's load as the aircraft entered the flight, at 1.2ms to 1.5ms, which every scenario has.
- The traffic host's states took 1,818 bytes a second for 151 objects, in postcard, against about 2.5KB/s for 120 aircraft.
- ATC audio took 136 bytes a frame through the relay, 6.8KB/s while ATC talks, with the link's idle traffic taken off: 80 bytes of speech, as 32 kbps averages, and about 56 of each frame's number and stamp and the link's framing. The user accepted about 7KB/s on 2026-11-15, over bundling two frames to a packet, which saves about 1.3KB/s for 20ms more delay.
- A joiner created 150 copies 6ms to 7ms after entering the flight, its identities already held, against 5s; a pilot already in the flight created 150 copies 323ms to 432ms after its link came up, against 500ms.

**Changed:** [the plan's stage 18](../build/plan.md#18-traffic-and-atc-audio) takes about 7KB/s through a relay as ATC audio's budget.

**Affects:** [01-traffic-and-atc](01-traffic-and-atc.md)'s budgets, through a note.

**Evidence:** `node tools/bench.ts traffic atc-audio` on 2026-11-15, and `tools/bench/scenarios/traffic.ts` and `atc-audio.ts`.

## 2026-11-15: A copy whose original stopped was carried past the stop and held there, since the stop's repeats came at its own time

**Asked:** whether a taxiing copy on the bench stops where its original stopped, as [the cases for the bench](01-traffic-and-atc.md#cases-for-the-bench) say: "its stop goes out on three polls, and the receiving machine draws it stopped once".

**Expected:** the copy to stop within 1m of where its original stopped, 1s after it.

**Found:**

- On stage 18's bench, a stand-in AI aircraft taxiing north at 20 kt had its velocity set to 0, and its copy stopped 3.31m past where it stopped, and held there ([the bench's output](results/2026-11-15-bench-stop-carried-past.txt)).
- The gate sent the stop again on the next two polls at the stop's own time, as FS Copilot's did, so the receiving machine dropped both repeats as no newer (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficGate.cs`, `Decide`).
- The stop stayed the copy's newest sample, and past the newest the playout carries a copy along the line through its last two samples for up to 500ms at 2Hz, as FS Copilot's interpolator does (read in `FsCopilot/Simulation/TrafficInterpolator.cs`, `TryRender`).
  So the copy went on past the stop by up to the length of its last step, and only the next heartbeat, 5s on, would have brought it back.
- FS Copilot's gate says the repeats are there because a lost stop leaves the receiver carrying the copy past it, which the carry does to a stop that arrived as well.
  An AI aircraft that slows over its last steps has a short last step, which may be why FS Copilot's testers didn't report it (unverified).

**Changed:** `object-mirror`'s gate sends each repeat of the stop at its own poll's time, so the copy's last segment stands still at the stop, and a copy whose stop was lost reaches it a poll late rather than passing it.

**Affects:** [01-traffic-and-atc](01-traffic-and-atc.md)'s gate and its playout, through a note.

**Evidence:** [the bench's output](results/2026-11-15-bench-stop-carried-past.txt), from `tools/bench/scenarios/traffic.ts`.

## 2026-11-15: FS Copilot's host read all five lights on for every parked AI aircraft, so its copies lit up at the gate

**Asked:** why an FS Copilot 1.3 tester flying SayIntentions' traffic saw every parked copy with its landing lights on, while the copies in flight looked right and both pilots had the same FSLTL package (reported by the tester, relayed by the user on 2026-11-15), and whether [stage 18's design](01-traffic-and-atc.md) carries the same fault.

**Expected:** the host to read a parked aircraft's lights as off, and the fault to be in what the receiver writes.

**Found:**

- FS Copilot's host reads `LIGHT STROBE ON`, `LIGHT LANDING ON`, `LIGHT TAXI ON`, `LIGHT BEACON ON`, and `LIGHT NAV ON`, and its receiver writes `LIGHT STROBE`, `LIGHT LANDING`, `LIGHT TAXI`, `LIGHT BEACON`, and `LIGHT NAV`, the switches, once after the create and again on each change (read in the FS Copilot fork, `FsCopilot/Simulation/TrafficDefinitions.cs`, `ObjectState` and `Appearance`, and `TrafficReceiver.cs`, `Dress`).
- In FS Copilot's seven traffic captures from 2026-09-06, and a gated copy of one, every parked AI aircraft, one whose last ground speed was under 1kt, read all five `ON` variables as 1: 64 to 104 aircraft a capture, and in the six captures that recorded engines, at most two of them a capture with an engine running ([p02's output](../../../experiments/areas/traffic-atc/results/p02-fsc-capture-lights-2026-11-15-10-40-26.txt)).
  The moving aircraft read all five on too, except one aircraft in each of four captures with its landing light off, and the ground objects read none.
- FS Copilot never checked the lights it wrote: its log says only that the sim accepted them, while it read the engines back after writing them (FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled" and "2026-09-06 · First visual replay; engines, pushback, ground vehicles").

**Changed:** the tester's report implies the host's sim drew its parked aircraft dark (unverified).
If it did, a parked AI aircraft's `ON` variables don't follow what the sim draws, and FS Copilot's receiver wrote their values into each copy's switches.
[Polling](01-traffic-and-atc.md#polling) read FS Copilot's state, so it would have lit every parked copy the same way.
So polling reads the five switches, which traffic writes on each copy, and the four flap surfaces, `TRAILING EDGE FLAPS LEFT PERCENT` and the others, which traffic writes on each copy in place of `FLAPS HANDLE INDEX`, since nothing measured says an AI aircraft's handle follows its surfaces.
Stage 18's session in the sim checks the switches and surfaces against what the sim draws on AI aircraft, and that a copy takes what traffic writes, as [01-traffic-and-atc](01-traffic-and-atc.md)'s note lists.

**Affects:** [01-traffic-and-atc](01-traffic-and-atc.md)'s polling and its dress, through a note.

**Evidence:** [p02's output](../../../experiments/areas/traffic-atc/results/p02-fsc-capture-lights-2026-11-15-10-40-26.txt), from [p02-fsc-capture-lights.mjs](../../../experiments/areas/traffic-atc/p02-fsc-capture-lights.mjs).

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
- The SDK puts the maximum at 1,000 objects without saying whether for one client or for all, lists `CREATE_OBJECT_FAILED` among a create's exceptions without tying it to a missing title, and lists no variable that says which client spawned an object; `AIReleaseControl` failed on every `StaticObject` our probes created, and their freeze held anyway ([SDK and probes report](results/2026-10-17-sdk-and-probes.txt), sections A and B).
- p10's capture at EGLL held 850 ground objects within 5km over its 10 minutes: 823 of GSX's, 594 of them `FSDT_GSX_Font_BLED_VGDS_small_yellow` docking-guidance boards and 219 `FSDT_SafeDock_TS24_wall_off` walls, none of which moved, and 27 titled `ASO_Pushback_White` or `ASO_Pushback_Blue`, the sim's pushback tugs, 7 of which moved, likely pushing AI aircraft, which p01 didn't check against the aircraft's tracks ([p01's output](../../../experiments/areas/traffic-atc/results/p01-ground-objects-2026-10-17-13-51-07.txt)).
  705 of GSX's objects and 23 of the tugs came within 1km of the pilot's aircraft, and no fuel truck, catering truck, or baggage cart appeared.

**Changed:** each sim that runs GSX likely makes its own signs (unverified), so carrying every ground object would show them twice, and no variable the SDK documents tells one spawned for the crew's aircraft from one each sim makes itself.
So [traffic](01-traffic-and-atc.md#which-objects-the-host-carries) carries a ground object only by an allowlist of titles, starting with the pushback tugs; ATC audio picks its app automatically by `BeyondATC` and `SayIntentionsAI`; and each ATC frame carries its stamp, which the buffer reads.

**Affects:** [01-traffic-and-atc](01-traffic-and-atc.md), and [traffic sync](../product/03-v1-scope.md#traffic-sync) and [hearing ATC](../product/03-v1-scope.md#hearing-atc) through their notes.

**Evidence:** the three reports in [results/](results/), and [p01's output](../../../experiments/areas/traffic-atc/results/p01-ground-objects-2026-10-17-13-51-07.txt) from [p01-ground-objects.mjs](../../../experiments/areas/traffic-atc/p01-ground-objects.mjs).
