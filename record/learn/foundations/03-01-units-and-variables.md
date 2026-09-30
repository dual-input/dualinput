# Variables, events, and units: units and variables

- [Units](#units)
- [`A:` simulation variables](#a-simulation-variables)
- [`L:` and `Z:` local variables](#l-and-z-local-variables)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Events and the other namespaces are in [03-02-events-and-other-namespaces](03-02-events-and-other-namespaces.md), and calculator code, access from each API, and values on the wire are in [03-03-reading-and-writing](03-03-reading-and-writing.md).

Every sim identifier starts with a one-letter namespace, such as `A:` for the sim's variables or `K:` for its commands, and this part takes the namespaces one at a time.
The examples use calculator code, the sim's stack language from [02-02](02-02-aircraft.md#model-behaviors): `(A:NAME, unit)` pushes a variable's value onto the stack, and `(>A:NAME, unit)` pops the top value into the variable.
[RPN calculator code](03-03-reading-and-writing.md#rpn-calculator-code) covers the rest of the language.

## Units

Every read or write of a variable names a unit, and the sim converts the stored number into it, the way you'd ask for an altitude in feet or in meters [1].
The unit list also holds scalings, such as `percent over 100` and `Position 16k`, and kinds of number, such as `Bool` and `Enum` [1].

**How it works.**
The SDK's units page groups units by dimension and gives each its aliases: `foot`, `feet`, and `ft` are one unit, and `millibar`, `mbar`, and `hectopascal` are another [1].
SimConnect lets a client ask for any unit in the same group as the one the SDK documents for a variable [2].
fsc-editor's WASM module read `A:PLANE ALTITUDE` in two units and got 132.689 feet and 40.444 meters, a ratio of 3.28084 [3].
Asked for in `ft` and in `Feet`, `A:PLANE ALTITUDE` returned the same 113.232674, and `A:KOHLSMAN SETTING MB:1` returned 1005 in both `Millibar` and `Millibars` [4].

The units that aren't dimensions say how to read the number [1]:

| Unit | What the SDK says it holds |
| --- | --- |
| `percent` | Normally 0 to 100 |
| `percent over 100` | Normally 0.0 to 1.0 |
| `Position 16k` | An integer position, which the SDK says runs "between 0 and 16843" |
| `Bool` | 0 for false, and any other value, "especially both 1 and -1", for true |
| `Enum` | An integer naming one member of a list |
| `mask`, `flags` | Bits, each standing for one item |
| `Bco16` | A four-digit octal number, used for transponder codes |
| `Frequency BCD16` | A frequency in 16-bit binary-coded decimal |

`A:FLAPS HANDLE PERCENT` is documented in `Percent Over 100`, so a half-extended flap handle reads 0.5 in that unit and 50 in `percent` [1] [5].

Key events take scaled integers of their own, documented per event: `K:FLAPS_SET` takes 0 to 16383, `K:ELEVATOR_SET` takes −16383 to 16384, and `K:KOHLSMAN_SET` takes millibars times 16 [6].
So one control can be read in one scale and written in another.
The Synaptic A220's flap lever is read as `A:FLAPS HANDLE INDEX`, from 0 to 5, and written as `K:FLAPS_SET` with the index divided by 5 and multiplied by 16383 [7].

**What it changes for Crosscheck.**
Both machines must read and write each variable in the same unit, or a value arrives off by a factor such as 100 or 16383.
A control whose read and write use different scales needs a conversion between them.

**Traps.**

- A two-state control needn't read 0 and 1.
  On the stock C172 G1000, the parking brake's input event, `B:LANDING_GEAR_PARKINGBRAKE`, read 100 [8], and the SDK allows −1 for a true `Bool` [1].
  Test a `Bool` against zero.
- The SDK's upper bound for `Position 16k`, 16843, matches none of the position key events, which end at 16383 or 16384 [1] [6], and we haven't measured the conversion.
- An `L:` variable can carry a unit too, and then asking for `number` converts it, as the fuel quantity under [`L:` and `Z:` local variables](#l-and-z-local-variables) shows.

## `A:` simulation variables

`A:` variables are the sim's own state for an aircraft or another object, such as `A:PLANE ALTITUDE`, and the SDK documents their names in a fixed list [9].
Many take an index or a component name, and the SDK marks each one settable or read-only [9] [10].

**How it works.**
An index follows the name after a colon: `A:GENERAL ENG FUEL PUMP SWITCH:1` is engine 1's fuel pump switch [11].
SimConnect numbers indices from 1 [2].
MSFS 2024's modular merge can renumber an aircraft's components ([02-02](02-02-aircraft.md#simobjects)), so the SDK says to name the component instead, as in `(A:HYDRAULIC VALVE ACTIVE:'VALVE_GEAR_LEFT_1'_n, Bool)` [9].
FS Copilot's profiles use that form in 52 lines, such as `A:LINE BREAKER PULLED:'BUS_1_To_FuelPump'_n` [12].

A few variables take a second parameter from another variable.
To ask whether circuit 45 is connected to bus 2, you set `A:BUS LOOKUP INDEX` first, then read the circuit [10]:

```text
2 (>A:BUS LOOKUP INDEX, Number) (A:CIRCUIT CONNECTION ON:45, Bool)
```

The SDK's tables give each variable a Settable column [10] [11].
`A:ELECTRICAL MASTER BATTERY` is settable, and `A:GENERAL ENG FUEL PUMP SWITCH` isn't [10] [11].
So FS Copilot's PA-24 profile reads the fuel pump switch as an `A:` variable and changes it with a key event, in this excerpt [13]:

```yaml
- get: A:GENERAL ENG FUEL PUMP SWITCH:1, Bool
  set: "`${value} (>K:ELECT_FUEL_PUMP1_SET)`"
```

How a SimConnect client writes a settable variable, and what the sim overwrites on the next frame, is [part 4](outline.md#4-simconnect-full).

**What it changes for Crosscheck.**
For each control, Crosscheck needs to know whether its `A:` variable can be written, and for a read-only one, which event changes it.
The SDK answers the first question for the sim's own systems, and [part 7](outline.md#7-aircraft-specific-systems-refresher) covers aircraft that run their own.

**Traps.**

- FS Copilot's profiles write 32 variables the SDK marks read-only, in 119 lines, through SimConnect data definitions [12].
  Nobody has measured whether those writes take effect.
- SimConnect rejects a data-definition entry for a variable the sim doesn't have, but only later, so nothing fails where the entry was added.
  fsc-editor's app then read past the end of a message and crashed, and requesting tagged data fixed it [14].
- An aircraft can keep its own copy of state the sim has an `A:` variable for.
  The A220 keeps its altimeter setting on its own CommBus channels [27].
  Whether `A:KOHLSMAN SETTING MB` follows that setting is unverified, and turning the captain's baro knob while reading the variable would settle it ([07](07-aircraft-specific-systems.md#why-study-level-aircraft-diverge)).

## `L:` and `Z:` local variables

An `L:` variable is a named number that any aircraft, gauge, or add-on creates by using the name, and one table holds them for the whole sim, not per aircraft [15] [16].
A `Z:` variable, also written `L:1:`, is the same idea scoped to one object, such as the user's aircraft [2] [15] [17].

**How it works.**
The SDK says an undefined `L:` is created and set to 0 the first time code references it, and doesn't persist between runs [15].
The PA-24's battery switch writes `L:Battery1Switch` ([02-02](02-02-aircraft.md#model-behaviors)), and fsc-editor wrote the same variable from outside through calculator code, `1 (>L:Battery1Switch)` [18].

One table serves the whole sim.
With the PA-24 loaded, a WASM module listed 5,364 `L:` names [16].
FS Copilot's PA-24 profile names 279 `L:` variables, about 5% of that count [16].

Other installed add-ons, such as a GTN 750 and GSX, and the sim registered the rest [16].
Switching to a Black Square Baron removed none of the 6,149 names and added 3 [19].
The table grew from 5,341 to 6,125 names over a few minutes with no aircraft change, as instruments and add-ons registered theirs [20].
The SDK says the same from SimConnect's side: `L:` variables are "global" in scope, and when two clients write one, the last write wins [2].

An `L:` holds a number and nothing else [15], stored as a double [2].
It can carry a unit, and the sim converts a read into the unit asked for [2].
On the PA-24, `L:Eng1_FuelQuantityCC` read 29.092951 raw and 0.110129 in `number`, a ratio of 264.17, which is the number of US gallons in a cubic meter [21].
Calculator code, `(L:Eng1_FuelQuantityCC, Number)`, also returned 0.110129 [22].
Of 1,200 non-zero `L:` variables on the PA-24, 34 carried a unit with a dimension [23].

A `Z:` variable belongs to one object.
The SDK says SimConnect reads it as 0 while the object loads, and the sim resets it when the object changes or reloads [2].
The WASM header describes it as "same as L:1 Var" [17].

**What it changes for Crosscheck.**
The sim can't tell Crosscheck which `L:` variables an aircraft uses, so that list has to come from the aircraft's files or from watching what moves ([Enumerating vs. observing](03-03-reading-and-writing.md#enumerating-vs-observing)).
Every `L:` Crosscheck writes is visible to every other add-on in the sim.

**Traps.**

- A missing or misspelled name isn't an error.
  On a stock C172, reading the missing `Z:AUDIO_Knob_Selector_1` in calculator code created it at 0, while the WASM API's lookup returns −1 for a missing name and creates nothing [3] [8].
  FS Copilot's profiles for the Black Square fleet, the PC-12, and the WB-Sim C172 read that name, so FS Copilot syncs a constant 0 for it [8] [24].
  In SDK 1.7.3 the name appears only as an animation and node name, in the NavCom template of the `Asobo` set, which the SDK calls the MSFS 2020 template set [26].
- `L:A32NX_AUTOTHRUST_TLA:1` and `L:A32NX_AUTOTHRUST_TLA:2` are two names in the sim's table, not one name with two indices, because indices belong to `A:` alone [25].
  `L:1:X` means `Z:X` [2].
- Names can contain spaces, such as `L:A22X L Altimeter Set` on the A220 [7].

## Sources

1. Documented: MSFS 2024 SDK, [Simulation Variable Units](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variable_Units.htm), sections "Length", "Pressure", and "Miscellaneous Units".
2. Documented: MSFS 2024 SDK, [SimConnect_AddToDataDefinition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddToDataDefinition.htm): the `DatumName` and `UnitsName` parameters, and the remarks "L Vars" and "Z (or L:1) variables".
3. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The typed variable API works, and the sim announces invalidation".
4. Measured on MSFS 2024, 2026-08-29: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-29 — The rest of the get: batch is measured, and none of it ships".
5. Documented: MSFS 2024 SDK, [Aircraft Control Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Control_Variables.htm), `FLAPS HANDLE PERCENT`.
6. Documented: MSFS 2024 SDK, [Aircraft Flight Control Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Aircraft_Flight_Control_Events.htm), `FLAPS_SET` and `ELEVATOR_SET`, and [Aircraft Instrumentation Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Aircraft_Instrumentation_Events.htm), `KOHLSMAN_SET`.
7. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, sections "THE ALTIMETER PROBLEM", "Baro controls that *are* reachable", and "Pedestal".
8. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal".
9. Documented: MSFS 2024 SDK, [Simulation Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variables.htm), sections "SimVar Index", "SimVars And RPN", "SimVars With Multiple Parameters", and "Using Indexed Parameter Names".
10. Documented: MSFS 2024 SDK, [Aircraft Electrics Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Electrics_Variables.htm): `BUS LOOKUP INDEX`, `CIRCUIT CONNECTION ON`, and `ELECTRICAL MASTER BATTERY`, with their Settable marks, read 2026-09-27.
11. Documented: MSFS 2024 SDK, [Aircraft Engine Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Engine_Variables.htm), `GENERAL ENG FUEL PUMP SWITCH` and its Settable mark, read 2026-09-27.
12. Documented in our record, counted over FS Copilot's profiles on 2026-08-29: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-29 — The rest of the get: batch is measured, and none of it ships", for the 52 component-name lines, and `docs/sim-vars/18-language-core.md`, the `not-settable` row under "Setter-shape rules", for the 119 lines.
13. Documented, read from disk: FS Copilot profiles, `definitions/pa24-250.yaml`, which isn't committed to that repository as of 2026-09-27.
14. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `A:` read crashed the app. Positional reads were the wrong shape."
15. Documented: MSFS 2024 SDK, [Reverse Polish Notation](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Reverse_Polish_Notation.htm), section "Variable Types", rows `L` and `L:1`.
16. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `L:` table is a superset too, and by twenty to one".
17. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Vars.h`, the comments on `fsVarsRegisterZVar` and `fsVarsGetZVarId`.
18. Measured on MSFS 2024, 2026-08-25: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean".
19. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `L:` table is global. `in sim` becomes observation, not enumeration."
20. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `L:` table grows while the sim runs".
21. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — `fsVarsLVarGet` converts units. It disagrees with the legacy read."
22. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Settled: read `L:` through `fsVarsLVarGet`, with the entry's unit".
23. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Units measured: 2.8% of `L:` variables have one. Not worth building for."
24. Documented in our record: fsc-editor, `docs/sim-vars/18-language-core.md`, the `ref-unresolved` item under "Evidence-backed rules", which lists the profiles.
25. Measured on MSFS 2024, 2026-08-27: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — One parser, one descriptor table; eight private opinions deleted".
26. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `ModelBehaviorDefs/Asobo/NAVCOM/NavComSystem.xml`, from the MSFS 2020 template set, where `AUDIO_Knob_Selector#SUFFIX_ID#` appears only as an animation and node name; `ModelBehaviorDefs/Asobo_EX1`, the 2024 set, doesn't contain the name.
27. Measured on MSFS 2024, 2026-09-28: [CommBus log](../../areas/commbus/log.md#2026-09-28-the-a220-sends-changes-not-snapshots-and-keeps-its-altimeter-setting-on-the-ads-and-ctp-channels), "The A220 sends changes, not snapshots, and keeps its altimeter setting on the ADS and CTP channels".

    The MSFS 2024 SDK's [Model Behaviors](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/ModelBehaviors/Model_Behaviors.htm) page says the `Asobo` folder holds the core files for MSFS 2020, and not to mix it with `Asobo_EX1`.

## Unverified claims

- **What `Position 16k` converts to.**
  The SDK's text gives 16843 as its upper bound, and the key events that take a position end at 16383 or 16384 [1] [6].
  Reading `A:FLAPS HANDLE PERCENT` at full flaps in both `percent over 100` and `Position 16k` would settle it.
- **Whether a SimConnect write to an `A:` variable the SDK marks read-only takes effect.**
  FS Copilot's profiles do it in 119 lines [12], and nobody has read the variable back afterward.
  On AI aircraft, the sim rejected writes to two read-only variables with exceptions ([04-01](04-01-connection-and-data.md#writing-data)), but the user aircraft is untested.
  Writing `A:GENERAL ENG FUEL PUMP SWITCH:1` on the user aircraft through a data definition and reading it over the next few seconds would settle it.
- **Whether SimConnect converts an `L:` variable's unit the way calculator code does.**
  The measured conversion came through the WASM API and calculator code [21] [22], and FS Copilot reads `L:` through SimConnect in `number`.
  Reading `L:Eng1_FuelQuantityCC` on the PA-24 through a SimConnect data definition in `number` and in `gallons` would settle it.
