# Aircraft studies: log

What the sim found about the studied aircraft, newest entry first.
The probes, the harness, and their raw output are in [experiments/areas/aircraft](../../../experiments/areas/aircraft), with the results in its `results/` folder.

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
    Setting `SWITCH_BATTERY_MASTER_2STATES` moves `L:Battery1Switch`, and setting the tooltip-only `RADIO1_DME_SWITCH_DRAG` moves nothing.
  - **Question 7, stock events:** `K:ELECT_FUEL_PUMP1_SET` and `K:TOGGLE_AVIONICS_MASTER` pass through and move the stock variables.
    `Accusim.wasm` masks `K:TOGGLE_BEACON_LIGHTS` and still moves both the stock and the `L:` variable, and masks `K:PITOT_HEAT_ON` and moves neither.
- The harness backed up each aircraft's saved files before its loads and restored them with the sim closed; every restore matched byte for byte.

**Changed:** we canceled pass two of the [plan](plan.md#pass-two-canceled), because at this crash rate the 108 questions would take days.
A question gets answered when a design needs it, with the harness in `experiments/areas/aircraft/` and that aircraft alone.

**Affects:** the PA-24 study's Input path and State sections, which don't cite these two answers yet; and `CLAUDE.md`'s working rule on batching sim work, which says loading a flight through SimConnect is untried.
