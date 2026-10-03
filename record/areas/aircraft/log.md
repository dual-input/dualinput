# Aircraft studies: log

What the sim found about the studied aircraft, newest entry first.
The probes, the harness, and their raw output are in [experiments/areas/aircraft](../../../experiments/areas/aircraft), with the results in its `results/` folder.

## 2026-10-03: Two partly encrypted aircraft list seat objects, the Phenom 300E for its pilots and passengers and the A380 for its pilots

**Asked:** does the sim list seat objects through SimConnect for an aircraft whose model files are partly encrypted, so a figure can be seated where the cockpit model can't be loaded?
The C152 and the A2A Comanche, whose files are readable, list theirs ([avatars log](../avatars/log.md#2026-10-02-seat-objects-place-the-other-pilot-in-the-cockpit-and-the-seated-avatar-doesnt-turn-with-the-look)).

**Expected:** yes, since the sim spawns seat objects rather than reading them from the model.

**Found:** with the FSReborn Phenom 300E loaded, fsreborn-aircraft-phenom300e 1.0.24, a Marketplace package with encrypted archives ([Phenom study](fsreborn-phenom-300e/study.md)), the 15 objects within 50m included 10 seats:

- `SEAT_FSReborn_Phenom300E_Pilot`, 3.60m ahead of the aircraft's reference point, 0.34m left, and 0.46m up, facing forward.
- `SEAT_FSReborn_Phenom300E_Copilot`, listed as two objects at the same spot, 3.59m ahead, 0.33m right, and 0.48m up.
- 7 of `SEAT_FSReborn_Phenom300E_Pax`, from 0.96m behind the reference point to 0.78m ahead and about 0.4m either side, 4 facing forward and 3 facing aft.

The seated pilot's avatar object sat exactly on the pilot's seat.
The package's readable files show only a passenger seat part, `fsreborn_phenom300e_seat_pax` ([files](fsreborn-phenom-300e/files.md)), so SimConnect shows more than the files did.

With the iniBuilds A380 loaded, inibuilds-aircraft-a380 1.0.0, also a partly encrypted Marketplace package ([A380 study](inibuilds-a380/study.md)), the 4 objects within 50m included 2 seats, `SEAT_INI_A380_PILOT`, 21.96m ahead of the reference point, 0.53m left, and 6.32m up, and `SEAT_INI_A380_COPILOT`, 21.95m ahead, 0.50m right, and 6.32m up, with the seated avatar exactly on the pilot's.
No passenger seats showed within 50m, which covers most of the cabin of a 73m aircraft.

**Changed:** a figure can sit in the right seat on an aircraft whose cockpit model can't be loaded, though it can't reach for controls without the model.
Which seats an aircraft lists varies: the Phenom lists every passenger seat and the A380 only the pilots'.

**Affects:** the ideas [Seat awareness](../product/ideas.md#seat-awareness) and [Avatar sync](../product/ideas.md#avatar-sync).

**Evidence:** p03's runs on [the Phenom](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-14-37.txt) and [the A380](../../../experiments/areas/aircraft/results/p03-seat-objects-2026-10-03-20-17-11.txt).

## 2026-10-01: Loading flights through SimConnect works, but the sim crashed on 5 of about 30 loads, so we canceled the unattended session

**Asked:** can a harness answer the 108 unattended sim questions in [questions.tsv](../../../experiments/areas/aircraft/questions.tsv) by loading each aircraft from a flight file with `SimConnect_FlightLoad`, with nobody at the sim?

**Expected:** a few hours of unattended runs, one aircraft at a time.

**Found:**

- `SimConnect_FlightLoad` from node-simconnect 4.2.0 loads a `.FLT` file from inside a flight, including one that names another aircraft: the PA-24, then the Fenix A321, then the PA-24 again all reached the file's position, title, and livery within 1.8 to 3.9s, and settled within 3 to 27s ([p01 results](../../../experiments/areas/aircraft/results/p01-flight-load-2026-10-01-17-29-57.txt)).
- Setting `A:CAMERA STATE` to 3 reverted to 2 within 30ms while ChasePlane ran, so we have no way to move the camera from the harness.
- MSFS 2024 1.8.16.0 crashed 5 times in about 30 loads, each with exception 0xc0000005 10 to 16s after a `FlightLoad`, around the sim's `FLIGHT_START` step ([crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv)):
  - The Fenix A320 starting at a gate crashed both times, at the same offset in `FlightSimulator2024.exe`.
  - The other three crashes followed a load of the same aircraft, a restore of an aircraft's files while the sim ran, and a load right after the harness's probes.
  - Loading nothing between aircraft, a silent window during each load, and restoring files only with the sim closed didn't stop them.
- The harness answered 2 questions, both on the A2A PA-24 Comanche 2.1.3 (measured on MSFS 2024, 2026-10-01, [run results](../../../experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-18-20-15.txt)):
  - **Question 11, input events:** the sim lists 318 input events at runtime, and 153 of the package's 223 declared IDs match one of them.
    Setting `SWITCH_BATTERY_MASTER_2STATES` to 0 and back to 1 moves `L:Battery1Switch` with it, while `A:ELECTRICAL MASTER BATTERY:1` stays 1 through the 1.5s the test watched.
    Setting the tooltip-only `RADIO1_DME_SWITCH_DRAG` moves nothing.
  - **Question 7, stock events:** `K:ELECT_FUEL_PUMP1_SET` 1 moves `A:GENERAL ENG FUEL PUMP SWITCH:1` from 0 to 1, and `K:TOGGLE_AVIONICS_MASTER` moves `A:AVIONICS MASTER SWITCH:1` from 1 to 0, both passed through to the sim.
    A client at or above the highest maskable priority masks `K:TOGGLE_BEACON_LIGHTS`, and `A:LIGHT BEACON` and `L:BeaconLightSwitch` still go from 1 to 0.
    It masks `K:PITOT_HEAT_ON` too, but the pitot heat was already on, so whether the event from another client would turn it on stays open.
- The harness backed up each aircraft's saved files before its loads and restored them with the sim closed; every restore matched byte for byte.

**Changed:** we canceled pass two of the [plan](plan.md#pass-two-canceled), because at this crash rate the 108 questions would take days.
A question gets answered when a design needs it, with the harness in `experiments/areas/aircraft/` and that aircraft alone.

**Affects:** the [PA-24 study](a2a-pa24-comanche/study.md), whose State, Input path, Prior records, and Sim questions sections cite these answers; and `CLAUDE.md`'s working rule on batching sim work.
