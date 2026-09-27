# Variables, events, and units: reading and writing

- [RPN calculator code](#rpn-calculator-code)
- [Which namespace can be read, written, or listed from where](#which-namespace-can-be-read-written-or-listed-from-where)
- [Enumerating vs. observing](#enumerating-vs-observing)
- [Precision, change thresholds, and value types on the wire](#precision-change-thresholds-and-value-types-on-the-wire)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Units and variables are in [03-01-units-and-variables](03-01-units-and-variables.md), and events and the other namespaces are in [03-02-events-and-other-namespaces](03-02-events-and-other-namespaces.md).

## RPN calculator code

Calculator code is a stack language in reverse Polish notation [1].
A number pushes onto the stack, an operator pops its operands and pushes its result, `(X:NAME, unit)` pushes a variable's value, and `(>X:NAME, unit)` pops a value into a variable or fires an event [1].
It's the one language that reaches every namespace, and aircraft XML, WASM modules, and FS Copilot's profiles all run it [1] [2] [3].

**How it works.**
The PA-24's battery switch hands its template two pieces of calculator code ([02-02](02-02-aircraft.md#model-behaviors)), shown here with the XML escaping removed:

```text
GET_STATE_EXTERNAL:  (L:Battery1Switch) sp0
SET_STATE_EXTERNAL:  (>H:A2A_BATTERY_1_SWITCH) p0 (>L:Battery1Switch)
```

The first pushes the variable's value, then `sp0` stores it in register 0 and pops it.
The second fires the `H:` event, pushes `p0`, the value the template passes in, and pops it into the `L:` variable [1] [4].

The operators, from the SDK [1]:

| Kind | Examples |
| --- | --- |
| Arithmetic and comparison | `+`, `-`, `*`, `/`, `==`, `>`, `min`, `max` |
| Logic | `!`, `and`, `or` |
| Stack | `d` duplicates the top, `p` pops it, `r` swaps the top two |
| Registers | `s0` stores the top, `l0` loads it back, and `sp0` stores and pops, for registers 0 to 49 |
| Control | `if{ ... } els{ ... }`, `case`, `quit` |
| Strings | Single quotes, with `scat` to join and `scmp` to compare |

Inside the sim, a WASM module runs calculator code with `execute_calculator_code` [2].
No SimConnect function runs calculator code: of the 117 in `SimConnect.h`, the nearest, `SimConnect_ExecuteAction`, calls a named action from an XML file [5] [30].
So FS Copilot's and fsc-editor's apps each pass calculator code to their own WASM module to run [3] [6].
When fsc-editor ran `1 (>L:Battery1Switch)` that way, it got back `ok` and 0, because a write leaves nothing on the stack [6].

**What it changes for Crosscheck.**
An aircraft's behavior is written in calculator code, so its XML is where Crosscheck's authors will learn what a control does.
Running calculator code needs Crosscheck to have code inside the sim, which [part 5](outline.md#5-wasm-modules-full) covers.

**Traps.**

- `ok` means the code parsed, not that it did anything.
  A bare `K:KOHLSMAN_SET` word, without the `(>...)` around it, changed nothing, raised no error, and didn't stop the code around it [7].
- An event given too few parameters leaves the rest on the stack: `2 16240 (>K:KOHLSMAN_SET)` returned 2 ([03-02](03-02-events-and-other-namespaces.md#k-key-events)).
- A leading zero makes a number octal: `022` is 18 [1].
- XML spells `>` as `&gt;` inside calculator code [1], so a text search of an aircraft's XML for `(>L:` finds none of its writes.
- Reading a missing `L:` or `Z:` variable creates it at 0 ([03-01](03-01-units-and-variables.md#l-and-z-local-variables)).

## Which namespace can be read, written, or listed from where

Crosscheck's code can run in three places: an app outside the sim using SimConnect, a WASM module inside the sim, and JavaScript in a cockpit panel.
No one place reaches everything: only SimConnect lists input events, only a WASM module lists `L:` variables, and only JavaScript receives `H:` events.

**How it works.**

| Namespace | SimConnect app | WASM module | Panel JavaScript |
| --- | --- | --- | --- |
| `A:` | Read; write where settable [8] | Read and write [9] | Read and write [10] |
| `L:` | Read and write [3] [8] | Read, write, and list [9] [11] | Read and write [10] [12] |
| `Z:`, `I:`, `O:` | Read and write, with a component path for `I:` and `O:` [8] | Read and write [9] | Not in our records |
| `E:` | Read [13] | Read [9] | Read [10] |
| `K:` | Send and watch [3] [5] | Send and watch [14] | Send [10] |
| `B:` | List, read, set, and subscribe [5] [15] | Read and call by name [9] | Not in our records |
| `H:` | None [5] | Send [14] | Receive [12] |

A WASM module can also run calculator code, which reaches every namespace the aircraft's own code does.
FS Copilot's module writes `B:`, `H:`, and `Z:` that way, and reads `B:` and `Z:` by running `(NAME, units)` every frame [3] [16].
JavaScript names an `A:` variable without its prefix, as in `SimVar.GetSimVarValue("GROUND VELOCITY", "knots")`, and every other namespace with it, as in `"E:ABSOLUTE TIME"` or `SimVar.SetSimVarValue("K:AP_NAV_SELECT_SET", "number", _index)` [10].

**What it changes for Crosscheck.**
An app using SimConnect alone reaches `A:`, `L:`, `K:`, and `B:`.
Seeing `H:` events, listing `L:` variables, and running calculator code each need code inside the sim, in a WASM module ([part 5](outline.md#5-wasm-modules-full)) or a panel ([part 6](outline.md#6-glass-cockpits-and-coherent-gt-full)).

**Traps.**

- Our records disagree on whether a SimConnect app can read `L:` variables.
  An fsc-editor log entry concluded that it can't, from the functions the node-simconnect library exposes [17].
  The SDK documents `L:` in data definitions [8], FS Copilot reads and writes `L:` that way [3], and fsc-editor's own later language-core doc says so too [18].
  We trust the SDK and FS Copilot's source.
- An aircraft can keep its state out of every namespace.
  The A220's systems module publishes most of its live state, including the altimeter setting, on the CommBus, which SimConnect can't see [19].

## Enumerating vs. observing

Enumerating asks the sim for a list of names, and observing watches values move.
The sim lists only `L:` and `B:` names for a running aircraft, and neither list says which names the aircraft uses.
What a control does is learned by watching it move or by reading the aircraft's files.

**How it works.**

| Namespace | List from the running sim | What the list holds |
| --- | --- | --- |
| `A:`, `K:` | None: the SDK documents a fixed list [20] [21] | Every variable or event, used or not |
| `L:` | A WASM module walks the table by ID [11] | Every add-on's variables: 5,364 with the PA-24 loaded, against the 279 that FS Copilot's PA-24 profile uses [22] |
| `B:` | `SimConnect_EnumerateInputEvents` [15] | The aircraft's input events and the sim's own: 318 on the PA-24, against 181 declared in A2A's XML [23] |
| `H:`, `Z:`, `I:`, `O:` | None [23] [24] | — |

Observing means working a control and recording what moved.
fsc-editor did this on the PA-24: one turn of a radio volume knob fired four input events, and 195 `L:` variables changed within 400ms of it [25].
Most of those 195 change all the time, such as `InGameTime` and `FSDT_GSX_HEARTBEAT` [25].
Over 4 minutes of the PA-24 at rest, two counters made up 87% of 5,739 change records, 3,514 and 1,499 of them [26].
So fsc-editor ranks each variable by how far its changes depart from its rate while nobody touches anything, and uses closeness in time only to break ties [25].
One lever can also move several variables together: pulling the PA-24's cabin vent moves five `L:` variables on the same sample every time, `L:CabinVentLeftLever` among them [27].

**What it changes for Crosscheck.**
The sim won't tell Crosscheck an aircraft's controls when it connects, so that knowledge has to exist before the flight.
How it's built, from the aircraft's files, from watching the aircraft, or both, is a question for [part 7](outline.md#7-aircraft-specific-systems-refresher).

**Traps.**

- Silence from an aircraft nobody touches isn't absence.
  fsc-editor once concluded, from 5s of an untouched A220, that the input event subscription never reports most events, and a second run with a pilot working the controls showed it reports every change [28].
- A name in the `L:` table doesn't mean the loaded aircraft uses it, because nothing leaves the table when the aircraft changes ([03-01](03-01-units-and-variables.md#l-and-z-local-variables)).
- Only the typed WASM lookup tells a missing `Z:` or `L:` from one at 0: it returns −1, where calculator code creates the variable ([03-01](03-01-units-and-variables.md#l-and-z-local-variables)).

## Precision, change thresholds, and value types on the wire

A SimConnect client chooses the type each value arrives as, which is a 64-bit float unless it asks for another [8].
For a request that reports only changes, it also chooses the smallest change worth reporting [8].
Key event parameters are 32-bit unsigned integers [5].
Each choice can round or drop a value before it leaves the machine.

**How it works.**
`SimConnect_AddToDataDefinition` takes a datum type, `SIMCONNECT_DATATYPE_FLOAT64` by default, and an epsilon [8].
With the `SIMCONNECT_DATA_REQUEST_FLAG_CHANGED` flag, the sim sends a value only when it has changed by more than the epsilon, and for an integer type it truncates the epsilon first, so 2.9 acts as 2 [8].

FS Copilot's choices, read from its source [3] [29] [30]:

| What | Type on the wire | Threshold |
| --- | --- | --- |
| `L:` variables | `FLOAT32` | 0, checked every simulated frame |
| `A:` variables in `feet`, `percent`, `bool`, `enum`, and 14 other unit names | `INT32` | 0, checked every simulated frame |
| `A:` variables in `number` and every other unit | `FLOAT64` | 0, checked every simulated frame |
| `B:` and `Z:` values, read in its WASM module | A double | 1e-6, checked every frame |
| `K:` event parameters | 32-bit unsigned | None |

A 32-bit float keeps about seven significant digits: 118.275 becomes 118.2750015258789, and 16,777,217 becomes 16,777,216.
The SDK says `L:` variables are 64-bit floats [8], so FS Copilot moves them through a narrower type than the sim stores, and we haven't found an `L:` value that the narrowing changes.
A 32-bit integer drops the fraction, so an `A:` variable FS Copilot reads in `feet` arrives in whole feet, and a throttle at 45.7 `percent` arrives as a whole number.
Whether SimConnect rounds or truncates when it converts is unmeasured.

The threshold decides what counts as a change.
With a threshold of 0, a clock-like variable changes on every tick, which is how two counters made 87% of the PA-24's change records ([Enumerating vs. observing](#enumerating-vs-observing)).
fsc-editor's module reads at 15Hz with a 1e-6 threshold, and starts each variable's last value at NaN, so its first tick reports every variable [31].
FS Copilot sends an entry from a profile's `master:` block, which only the pilot in control sends, at most every 30ms and unreliably; it sends a `shared:` entry reliably [29].

**What it changes for Crosscheck.**
For each variable, Crosscheck needs a wire type that keeps every value the receiving aircraft can tell apart, and a threshold that drops noise without dropping a step a pilot made.
[Part 8](outline.md#8-synchronization-full) covers change detection, sample rates, and bandwidth.

**Traps.**

- The input event subscription sends no current value, so each value has to be read once with `SimConnect_GetInputEvent` ([03-02](03-02-events-and-other-namespaces.md#b-input-events)).
- FS Copilot rounds a fractional key event parameter away from zero, so 0.6 arrives as 1 ([03-02](03-02-events-and-other-namespaces.md#k-key-events)).

## Sources

1. Documented: MSFS 2024 SDK, [Reverse Polish Notation](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Reverse_Polish_Notation.htm), sections "RPN In Microsoft Flight Simulator 2024", "Variable Types", and "Expression Operators", and its notes on octal numbers and XML escaping.
2. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/Legacy/gauges.h`, the declaration of `execute_calculator_code`.
3. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs`: `Execute`, `Set`, `SetLVar`, `TransmitKEvent`, `Stream`, `SimVar`, `ClientVar`, and `KEvent`.
4. Documented, read from the installed package: A2A PA-24 (`a2a-aircraft-pa24`) in the Community folder of our development machine, 2026-09-27, `SimObjects/Airplanes/pa24-250/common/model/PA24_250_INTERIOR.xml`, the component `Switch_Battery_Master`.
5. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`: the function declarations, `SIMCONNECT_DATATYPE`, and `SIMCONNECT_DATA_REQUEST_FLAG_CHANGED`.
6. Measured on MSFS 2024, 2026-08-25: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean".
7. Measured on MSFS 2024, 2026-08-29: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-29 — Bare words are ignored, and five dead corpus lines get their rule".
8. Documented: MSFS 2024 SDK, [SimConnect_AddToDataDefinition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddToDataDefinition.htm): the parameters, and the remarks "L Vars", "I and O Vars", and "Z (or L:1) variables".
9. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Vars.h`.
10. Documented, read from JavaScript captured out of the running sim: FS Copilot profiles at d3d7689, `sim-sources/`, captured from MSFS 2024 on 2026-08-30: in `vcockpit02-displayunits/`, the sim's `html_UI_JS_avionics.js` and `html_UI_JS_simplane.js`, and the A220's `html_ui_pages_vcockpit_instruments_a22x_displayunits_instrument.js`.
11. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — `get_name_of_named_variable` is deprecated. MSFS 2024 has a better `L:` API." and "2026-08-23 — Stage 2a COMPLETE. All five questions pass; `L:` is reachable."
12. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/hook.js`.
13. Documented: MSFS 2024 SDK, [Environment Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Environment_Variables.htm).
14. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`, and `WASM/include/MSFS/Legacy/gauges.h`, `trigger_key_event_EX1` and `register_key_event_handler_EX1`.
15. Documented: MSFS 2024 SDK, [Input Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/InputEvents/Input_Events.htm).
16. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/var_watcher.h`, and `wasm_module.cpp`, `Update_StandAlone`.
17. Documented in our record, and superseded: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — `L:` cannot be read from a SimConnect client. The module is on the critical path."
18. Documented in our record: fsc-editor, `docs/sim-vars/18-language-core.md`, section "The two execution paths — read from FS Copilot's source, 2026-08-27".
19. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, sections "Architecture — the thing to remember" and "THE ALTIMETER PROBLEM".
20. Documented: MSFS 2024 SDK, [Simulation Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variables.htm), "SimVar Index".
21. Documented: MSFS 2024 SDK, [Key Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Key_Events.htm), "Key Event Index".
22. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `L:` table is a superset too, and by twenty to one".
23. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — The runtime input-event list is a superset of the aircraft's own", and, for `H:`, fsc-editor, `docs/sim-vars/02-namespaces.md`, the table at the top.
24. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Vars.h`, which has a function that returns an `L:` name from its ID and none for any other namespace.
25. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — 195 variables change within 400 ms of an interaction. Proximity alone cannot rank."
26. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Change count is the wrong ranking signal. Two clocks are 88% of the stream."
27. Measured on MSFS 2024, 2026-08-24: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-24 — An aircraft keeps five names for one lever".
28. Measured on MSFS 2024, 2026-09-04: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-09-04 — The `B:` subscription is a change feed; the entry below was wrong".
29. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, sections "How a change leaves this machine", "What type a value is", and "K: event parameters are coerced to uint", checked against `FsCopilot/Simulation/Coordinator.cs` in the FS Copilot fork at 9d4e864.
30. Documented: MSFS 2024 SDK, [SimConnect_ExecuteAction](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_ExecuteAction.htm).
30. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimConnectExtensions.cs`, `InferDataType`.
31. Documented in our record: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Stage 2b: the module streams. Transport built, untested against the sim.", which describes the module's design; the entry itself says it hadn't yet run against the sim.

## Unverified claims

- **FS Copilot's `FLOAT32` read changes some `L:` value that matters.**
  The SDK says `L:` variables are 64-bit [8], and nobody has compared a 32-bit and a 64-bit read of the same variable.
  Reading every `L:` a profile syncs both ways for one flight, and listing those that differ, would settle it.
- **Whether SimConnect rounds or truncates a value it converts to `INT32`.**
  Reading `A:GENERAL ENG THROTTLE LEVER POSITION:1` in `percent` as both `FLOAT64` and `INT32` with the lever at a fractional position would settle it.