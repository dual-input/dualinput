# Variables, events, and units: events and other namespaces

- [`K:` key events](#k-key-events)
- [`B:` input events](#b-input-events)
- [`H:` HTML events](#h-html-events)
- [The other namespaces](#the-other-namespaces)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Units, `A:`, `L:`, and `Z:` are in [03-01-units-and-variables](03-01-units-and-variables.md), and calculator code, access from each API, and values on the wire are in [03-03-reading-and-writing](03-03-reading-and-writing.md).

## `K:` key events

A `K:` event is a command the sim accepts, such as `K:FLAPS_SET` or `K:TOGGLE_MASTER_BATTERY`, from a fixed list the SDK documents [1].
It carries integer parameters, and in calculator code the value pushed last becomes parameter `[0]`, so a two-parameter event takes its parameters in reverse order on the stack [1].

**How it works.**
The SDK names each event twice: an Event ID, such as `KOHLSMAN_SET`, for calculator code, and a Key Name, such as `KEY_KOHLSMAN_SET` [1].
It documents `K:KOHLSMAN_SET` with two parameters: `[0]`, the altimeter setting in millibars times 16, and `[1]`, the altimeter's index [2].
Calculator code passes one parameter as `[0] (>K:EVENT)` and two as `[1] [0] (>K:2:EVENT)` [1].

fsc-editor tested both forms on a Black Square Baron, which has two altimeters [3]:

| Code | Result |
| --- | --- |
| `2 16272 (>K:2:KOHLSMAN_SET)` | Altimeter 2 set to 1017 millibars, which is 16272 / 16, and altimeter 1 unchanged |
| `2 16240 (>K:KOHLSMAN_SET)` | Both altimeters set to 1015 millibars, and the 2 left on the stack |

Without the `2:`, the event took only the top of the stack, as `[0]`.
Its missing index defaulted to 0, and index 0 reached every altimeter [3].
MSFS 2024 also accepts a component's name where an event takes an index, as in `50 'MyCircuit'_n (>K:2:PANEL_LIGHTS_POWER_SETTING_SET)` [1].

Outside calculator code, `SimConnect_TransmitClientEvent_EX1` carries up to five parameters as 32-bit unsigned values, `dwData0` to `dwData4` [4].
FS Copilot reverses a profile's stack order into those slots, rounds a fraction away from zero, and lets a negative number wrap, so −1 arrives as 4294967295 [5] [6].
`K:ELEVATOR_SET` takes −16383 to 16384 [7], so its negative values travel that way.

**What it changes for Crosscheck.**
A key event is an action, not a state.
Crosscheck can replay the event a pilot's click caused, but a toggle or a step lands on whatever state the other aircraft is in, which [part 8](outline.md#8-synchronization-full) covers as relative vs. absolute actions.
Each parameter must travel as an integer, in its documented slot.

**Traps.**

- A missing parameter is 0, not an error, and 0 can mean every instance [3].
- The SDK's parameter list can be incomplete.
  It lists none for `K:FREEZE_LATITUDE_LONGITUDE_SET` [8], yet FS Copilot sends it 1 to freeze and 0 to release [9].
  When our traffic tool sent it 1 for an injected aircraft, `A:IS LATITUDE LONGITUDE FREEZE ON` read back 1 [10].
- The SDK says SimConnect takes the Key Name [1], but our traffic tool mapped the Event ID, `FREEZE_LATITUDE_LONGITUDE_SET`, and the sim accepted it [10].
  We trust the measurement.
- An aircraft can take a key event over.
  An input event with `<Binding EventID=...>` intercepts it ([02-02](02-02-aircraft.md#model-behaviors)), and the A220's systems module intercepts a list of key events of its own [11].
  A key event sent through SimConnect may skip that interception: Asobo said so for MSFS 2020 SU15, and it's unverified for 2024 ([04-02](04-02-events.md#client-events)).
  The same event can do different things on different aircraft.

## `B:` input events

A `B:` event is one of the aircraft's own controls, declared in its model behavior XML together with the code that reads and changes it ([02-02](02-02-aircraft.md#model-behaviors)).
It's the one namespace SimConnect can list for the loaded aircraft, and a SimConnect client can read, set, and subscribe to each input event without any code in the sim [12] [16].

**How it works.**
[02-02](02-02-aircraft.md#model-behaviors) shows how an `<InputEvent>` declares presets.
A preset keeps its state in a `<Value>` element and changes it with the code in its `<Inc>`, `<Dec>`, and `<Set>` elements [13].
Calculator code reads an input event as `(B:NAME)`, and writes to a preset by appending the operation to its ID, as in `(>B:Sound_COM1_Volume_Inc)` [13] [14].
An aircraft can also define its own suffixes, such as `_On`, `_Off`, and `_Toggle`, as aliases with `<Binding Alias=...>` [15].
On the Baron, `1 (>B:ELECTRICAL_Battery_1)` changed nothing, and `(>B:ELECTRICAL_Battery_1_Toggle)` turned the battery on [3].

From outside, `SimConnect_EnumerateInputEvents` returns "a paginated list of all available InputEvents for the current aircraft", each with a hash [12].
`SimConnect_GetInputEvent`, `SimConnect_SetInputEvent`, and `SimConnect_SubscribeInputEvent` each take that hash [4].
fsc-editor measured these on the Synaptic A220 [16] [17]:

- The list held 464 input events, and `SimConnect_GetInputEvent` answered each of them with a number.
- The subscription reported each change as a pilot worked the overhead panel: `OVH_LTS_TAXI` went 2, 1, 0, 1, 2 through its detents.
- A momentary control, such as `AIRLINER_FCU_ALT_PUSH`, reported 0 on every press.
- Subscribing sent no current value, and 21 input events reported four times a second whether or not anyone touched anything.

The A220's list holds `<InputEvent ID>` values, such as `AIRLINER_FCU_CHRONO_2`, and none of the preset names, such as `AIRLINER_FCU_CHRONO_2_Push`, that the Behaviors window shows [18].
The PA-24's subscription reported a preset's name instead ([02-02](02-02-aircraft.md#model-behaviors)), and which rule holds for which aircraft is unverified.

**What it changes for Crosscheck.**
On an aircraft whose controls are input events, SimConnect alone tells Crosscheck which controls exist and when one moves.
It doesn't say whether a control latches or springs back, and some aircraft declare few input events: a Black Square Bonanza declares 5 of its own ([02-02](02-02-aircraft.md#model-behaviors)).

**Traps.**

- Nothing marks a control as momentary.
  All 464 of the A220's input events declare the type `DOUBLE`, and `SimConnect_EnumerateInputEventParams` returned `;FLOAT64` for every one [17].
- One knob can fire several input events.
  Turning one radio volume knob on the PA-24 fired `AS430_NAV1_VOLUME`, `AS430_COM1_VOLUME`, and their two AS530 counterparts [19].
- Each switch flipped on the PA-24 reported its input event twice ([02-02](02-02-aircraft.md#model-behaviors)).

## `H:` HTML events

An `H:` event is a named signal that an aircraft's behavior code sends to its JavaScript instruments, such as a key press on an FMS keypad.
Nothing declares it in advance, it holds no value to read back, and only JavaScript receives it [14] [20].

**How it works.**
The SDK says `H:` events "only go in one direction: from the panel to the JavaScript / HTML code", and that they needn't be defined ahead of time [14].
The PA-24's battery switch fires `H:A2A_BATTERY_1_SWITCH` as well as writing `L:Battery1Switch` ([02-02](02-02-aircraft.md#model-behaviors)).
On the A220's keypad, most keys fire their own `H:` event, named in the pattern `H:A220_KBD_<ID>_#INDEX#`, but Cancel and Execute write `L:A22X Flight Plan Cancel` and `L:A22X Flight Plan Execute` instead [11].
A WASM module can send one with `fsEventsHEventCall` [20].
The SDK header calls `H:` events "events distributed to js vcockpits", and declares no way for a module to receive one [20].

A JavaScript instrument receives `H:` events through its `onInteractionEvent` method.
FS Copilot's panel hook wraps that method on each instrument and forwards `_args[0]`, the event's name [21].
It reports an event only from the one instrument whose random ID is in `L:FSC_HOOK` [21], which suggests that every instrument receives every event (unverified).
FS Copilot holds each `H:` event for 500ms before sending it to the other machine, where its WASM module fires the event through calculator code [5] [22].

**What it changes for Crosscheck.**
Glass cockpits and FMS keypads often talk to their displays through `H:` events, so syncing them needs code in a panel to see each event ([part 6](outline.md#6-glass-cockpits-and-coherent-gt-full)) and code in the sim to fire it.
An `H:` event has no value to re-read, so one lost on the way leaves the two displays different, with nothing to compare.

**Traps.**

- The sim can't list `H:` events: they're found in the aircraft's XML or by watching [23].
- One click can fire an `H:` event and write an `L:` variable, and nothing says which of the two the aircraft's systems act on ([02-02](02-02-aircraft.md#model-behaviors)).

## The other namespaces

Five more namespaces appear in aircraft code: `E:` for sim-wide state such as time, `O:` and `I:` for variables scoped to one component or one instrument, `M:` for the mouse inside a click handler, and `C:` for the FS9 GPS module [14].

**How it works.**

| Namespace | Holds | Example | Reached from |
| --- | --- | --- | --- |
| `E:` | Sim-wide environment state, mostly read-only [24] | `E:ZULU TIME`, `E:SIMULATION RATE` | Calculator code and SimConnect [24], and the WASM API [20] |
| `O:` | A variable scoped to one component of the aircraft's model behaviors [14] | `(O:MyValue)` | Calculator code in that component, and SimConnect and the WASM API by component path [20] [25] |
| `I:` | A variable scoped to one instrument and every component in it [14] | — | The same as `O:` [20] [25] |
| `M:` | The mouse's position and event inside a mouse handler [14] | `(M:Event) 'LeftSingle' scmp` | Mouse handlers only, and not input events [14] |
| `C:` | FS9 GPS variables, deprecated in MSFS 2024 [26] | `(C:fs9gps:Variable Name, Units)` | Calculator code and JavaScript [26] |

SimConnect names an `O:` or `I:` variable by its component's path, as in `O:Path:To:Component@alias:NAME` [25].
The SDK's list has six more prefixes: `F:` for built-in functions, `G:` for gauge variables, `P:` as another name for `E:`, `R:` for localized strings, `W:` for sound events, and `X:` for mission parameters [14].

**What it changes for Crosscheck.**
`O:` and `I:` variables hold state inside an aircraft's model behaviors that no list exposes, and reaching one needs its component path from the aircraft's XML.
`E:` variables hold sim-wide state, such as the simulation rate, that [part 8](outline.md#8-synchronization-full) syncs as clocks rather than as aircraft state.

**Traps.**

- An `O:` or `I:` variable reads 0 while its component isn't valid, which includes while the aircraft loads, and resets when the aircraft reloads [25].
- The SDK warns that a WASM module using `C:` variables can get inconsistent data or crash, because modules run on their own thread in MSFS 2024 [26].

## Sources

1. Documented: MSFS 2024 SDK, [Key Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Key_Events.htm), the opening section and "Event IDs As Key Events", including "Using Indexed Parameter Names".
2. Documented: MSFS 2024 SDK, [Aircraft Instrumentation Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Aircraft_Instrumentation_Events.htm), `KOHLSMAN_SET`.
3. Measured on MSFS 2024, 2026-08-29: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-29 — The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air".
4. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`, the declarations of `SimConnect_TransmitClientEvent_EX1` and the input event functions.
5. Documented, read from FS Copilot's source: fsc-editor, `docs/fscopilot-behavior.md`, sections "The execution split: shared vs master", "How a change leaves this machine", and "K: event parameters are coerced to uint".
6. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs`, `TransmitKEvent`, and `FsCopilot/Simulation/Definitions.cs`, `ParseSet`.
7. Documented: MSFS 2024 SDK, [Aircraft Flight Control Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Aircraft_Flight_Control_Events.htm), `ELEVATOR_SET`.
8. Documented: MSFS 2024 SDK, [Miscellaneous Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Key_Events/Miscellaneous_Events.htm), `FREEZE_LATITUDE_LONGITUDE_SET`.
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/wasm_module.cpp`.
10. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Jitter measured, not eyeballed — freeze + per-frame writes wins; Q16 settled".
    The tool is `record/traffic-atc/tools/TrafficInject/Program.cs`, which maps the freeze events by their Event IDs and sends each the value 1.
11. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, sections "Architecture — the thing to remember", "Key events the WASM intercepts", and "Pedestal".
12. Documented: MSFS 2024 SDK, [Input Events](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/InputEvents/Input_Events.htm), the SimConnect function list.
13. Documented: MSFS 2024 SDK, [Input Event XML Properties](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/ModelBehaviors/Input_Event_XML_Properties.htm), the opening template and the paragraph on the `B:` variable.
14. Documented: MSFS 2024 SDK, [Reverse Polish Notation](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Reverse_Polish_Notation.htm), sections "Variable Types", "Function Library", and "Mouse Variables".
15. Documented: MSFS 2024 SDK, [Model Behaviors Inputs](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/ModelBehaviors/UsingBehaviours/Model_Behaviors_Inputs.htm), section "Aliases".
16. Measured on MSFS 2024, 2026-09-03: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-09-03 — `B:` values are readable two ways, and the subscription is not a change feed", for the reads; its conclusion about the subscription is superseded by [17].
17. Measured on MSFS 2024, 2026-09-04: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-09-04 — The `B:` subscription is a change feed; the entry below was wrong".
18. Measured on MSFS 2024, 2026-09-03: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-09-03 — The input-event table lists IDs; the preset rules were reading it as names".
19. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — 195 variables change within 400 ms of an interaction. Proximity alone cannot rank."
20. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h`, the `HEvents` region, and `WASM/include/MSFS/MSFS_Vars.h`.
21. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/hook.js`.
22. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Simulation/Coordinator.cs`, the 500ms delay on names starting with `H`, and `FsCopilot/Connection/SimClient.cs`, `Set`.
23. Documented in our record: fsc-editor, `docs/sim-vars/02-namespaces.md`, the table and section "`H:` and the DOM layer".
24. Documented: MSFS 2024 SDK, [Environment Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/Environment_Variables.htm).
25. Documented: MSFS 2024 SDK, [SimConnect_AddToDataDefinition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddToDataDefinition.htm), the remark "I and O Vars".
26. Documented: MSFS 2024 SDK, [GPS Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/GPSVars/GPS_Variables.htm).

## Unverified claims

- **Every JavaScript instrument receives every `H:` event.**
  FS Copilot's hook elects one instrument to report events [21], which only makes sense if several receive them, and nobody has logged it.
  Logging `onInteractionEvent` in two instruments of one aircraft while pressing a keypad key would settle it.
- **Which name SimConnect reports for an input event.**
  The A220 lists `<InputEvent ID>` values [18], and the PA-24 reported a preset's name ([02-02](02-02-aircraft.md#unverified-claims)).
  Enumerating both aircraft and matching each name against their XML would settle it.
- **A negative key event parameter survives FS Copilot's wrap.**
  FS Copilot sends −1 as 4294967295 [5], and nobody has checked that the sim reads it back as −1.
  Sending −8000 to `K:ELEVATOR_SET` through SimConnect and reading `A:ELEVATOR POSITION` would settle it.
