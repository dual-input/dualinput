# SimConnect: the connection and data

- [What it is](#what-it-is)
- [Connecting](#connecting)
- [Data definitions and requests](#data-definitions-and-requests)
- [Writing data](#writing-data)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

Client events, system events, and input events are in [04-02-events](04-02-events.md), and client data areas, AI objects and facilities, and threading and reconnects are in [04-03-client-data-ai-and-throughput](04-03-client-data-ai-and-throughput.md).

## What it is

SimConnect is the sim's client API: MSFS 2024 runs a SimConnect server, and client programs connect to it [1].
Its calls look like functions and work as messages: each sends a request and returns at once, and each answer, an error included, arrives later as a message that carries IDs the client chose [2] [3].
Apps outside the sim reach it through the native `SimConnect.dll`, a managed .NET wrapper, or a third-party binding, and WASM modules inside the sim reach it too [1].

**How it works.**
Reading one variable takes two requests and a loop that pumps replies.
This sketch follows FS Copilot's C# source, with the managed wrapper's names [4]:

```text
AddToDataDefinition(defId, "PLANE ALTITUDE", "feet", ...)       which variables, in which units
RequestDataOnSimObject(reqId, defId, SIMCONNECT_OBJECT_ID_USER,
                       SIM_FRAME, CHANGED)                        which object, and how often
loop: wait on the event handle, then ReceiveMessage()            pump the queue
  → OnRecvSimobjectData(dwRequestID, dwDefineID, dwData)          one reply per change
```

The IDs are the client's own numbers, and every reply carries them back so the client can route it [2].
A native client pumps the queue with `SimConnect_CallDispatch` or `SimConnect_GetNextDispatch` [3].
A rejected request doesn't fail where it was made: a `SIMCONNECT_RECV_EXCEPTION` arrives later, carrying the exception, the packet ID of the call that caused it, and the index of the parameter it blames [2].
FS Copilot's traffic code records `GetLastSentPacketID()` after every call, so it can name the call an exception belongs to [5].

A program can hold several connections at once, each opened under its own name.
FS Copilot's app opens five, named `FS Copilot (Consumer)`, `(Producer)`, `(Consumer 1)`, `(Consumer 2)`, and `(Traffic)`, and its WASM module opens a sixth, `FsCopilot Bridge` [4] [6].

| Binding | What it is | Used by |
| --- | --- | --- |
| Native | `SimConnect.h`, `SimConnect.lib`, and `SimConnect.dll` from the SDK, for C and C++ [2] | The WASM modules of FS Copilot and fsc-editor, which [part 5](outline.md#5-wasm-modules-full) covers [6] [7] |
| Managed .NET | `Microsoft.FlightSimulator.SimConnect.dll`, a `SimConnect` class whose constructor opens the connection and whose `OnRecv…` events deliver messages [8] | FS Copilot, a .NET 9 app that ships it beside the native `SimConnect.dll` [9] |
| node-simconnect | The wire protocol written again in JavaScript, with no native code and no DLL [10] | fsc-editor's app [10] |
| Rust `simconnect` crate | Bindings to `SimConnect.dll`, published by YourControls' author [11] | YourControls, which keeps `SimConnect.dll` in its repository [11] |

The SDK groups the API as General, Events and Data, Input Events, AI Objects, Facilities, Flights, Camera, Communication, and Debug [12].
This part covers the first five, and the Communication group, a CommBus API, belongs to [part 5](outline.md#5-wasm-modules-full).

**What it changes for Crosscheck.**
Whatever language Crosscheck's app is written in brings a binding with it, and the binding decides which calls exist.
Every request needs an ID scheme that routes its replies and its exceptions back to the code that made it.

**Traps.**

- The SDK says SimConnect clients "are not currently thread-safe" [1]; [04-03](04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects) shows how FS Copilot confines each connection to one thread.
- A binding that reimplements the protocol has only the calls its authors wrote.
  fsc-editor checked that node-simconnect 4.2.0 had the input event calls before it adopted the library [10].
- The managed wrapper delivers only an `int` in `dwData` unless the client registers a struct for the definition with `RegisterDataDefineStruct` [8].
- The SDK documents SimConnect clients exchanging CommBus events with JavaScript and WASM, and a module's CommBus call reaches SimConnect clients by default [2] [12], while our A220 notes say SimConnect can't see its CommBus traffic ([03-03](03-03-reading-and-writing.md#which-namespace-can-be-read-written-or-listed-from-where)).
  We lean to the SDK, but nothing in our records has tried the SimConnect CommBus calls.

## Connecting

A client opens a connection with `SimConnect_Open`, giving a name, and with no configuration file it connects to the sim on the same PC [3] [13].
The first message back, `SIMCONNECT_RECV_OPEN`, names the application and its version, which is how a client tells MSFS 2024 from MSFS 2020 [2] [3].
Connecting from another PC needs a `SimConnect.xml` on the sim's machine that opens a server with `global` scope, and a `SimConnect.cfg` beside the client that points at it [13] [14].

**How it works.**
The server side is `SimConnect.xml`, which a Steam install keeps in `%APPDATA%\Microsoft Flight Simulator 2024\` [14].
By default the sim starts three local servers, one each on a named pipe, IPv4, and IPv6 [14].
The SDK says MSFS 2024 has deprecated dynamic ports and writes no ports to the registry, and that local clients should prefer pipes [14].

The client side is `SimConnect.cfg`, in the client's own folder [13].
Each `[SimConnect]` or `[SimConnect.N]` section gives a `Protocol` (`Pipe`, `IPv4`, or `IPv6`), an `Address`, and a `Port`, and `SimConnect_Open`'s last argument picks the section [3] [13].
`SIMCONNECT_OPEN_CONFIGINDEX_LOCAL`, −1, ignores the file and forces a local connection [2].

node-simconnect looks for the server itself, in this order [15]:

1. A `SimConnect.cfg` in the working folder, then one in the user's home folder.
2. The pipe `\\.\pipe\Microsoft Flight Simulator\SimConnect`.
3. The port in the registry value `SimConnect_Port_IPv4`, or port 2048 if the registry can't be read.

A node-simconnect client also names a protocol version when it opens: fsc-editor tries protocol 6, which node-simconnect calls `SunRise`, then protocol 5, `KittyHawk`, and MSFS 2024 accepted `SunRise` on the first try [15] [16].

The open reply fsc-editor logged from MSFS 2024 on 2026-08-18 [16]:

| Field of `SIMCONNECT_RECV_OPEN` | Value |
| --- | --- |
| Application version | 12.2 |
| Application build | 282174.999 |
| SimConnect version | 12.2 |

FS Copilot's traffic code reads a major version of 12 as MSFS 2024 and 11 as MSFS 2020 [5] [17].
The SDK says a client built with the MSFS 2020 SDK is detected as one and works "without the new features" [1], and that a client built against a newer SimConnect than the server gets `SIMCONNECT_EXCEPTION_VERSION_MISMATCH` [3].

**What it changes for Crosscheck.**
Crosscheck targets MSFS 2024 only, and `SIMCONNECT_RECV_OPEN` is where its app can confirm that before calling anything 2024-only, such as the `_EX1` calls that create AI objects with a livery [17].
Remote SimConnect reaches a sim on another PC only where the network lets the client reach that port, which is [part 9](outline.md#9-networking-full-from-the-ground-up)'s subject.

**Traps.**

- The version arrives as a message, so the client has to pump the queue before it can know it.
  FS Copilot's traffic connection waits up to 5s for the open reply before it does anything else [5].
- The SDK says MSFS 2024 writes no ports to the registry [14], but on our development machine, with the sim closed, the registry holds `SimConnect_Port_IPv4` = 65441, and the sim's `SimConnect.xml` still lists dynamic IPv4 and IPv6 ports [18].
  Which program wrote that value is unknown.
- In fsc-editor's packaged build, node-simconnect's registry read failed with `Can not find script file`, and node-simconnect then uses port 2048 without raising an error, which matters whenever there's no pipe to find first [15] [19].

## Data definitions and requests

A data definition is a client's list of variables, each with a unit, a type, and an epsilon, and a request asks the sim to send that list for one object at a period [21] [22].
Values arrive packed in definition order, or, with the `TAGGED` flag, as pairs of datum ID and value [22].
With the `CHANGED` flag, the sim sends only when a value has changed by more than its epsilon ([03-03](03-03-reading-and-writing.md#precision-change-thresholds-and-value-types-on-the-wire)) [22].

**How it works.**
It works like a prepared query with a subscription attached, except that the sim rejects a bad variable only after the call has returned.
`SimConnect_AddToDataDefinition` adds one variable to a definition ID, and `SimConnect_RequestDataOnSimObject` starts the sim sending it, with these choices [2] [22]:

| Parameter | Choices |
| --- | --- |
| Period | `NEVER`, `ONCE`, `VISUAL_FRAME`, `SIM_FRAME`, and `SECOND` ([02-03](02-03-the-running-sim.md#the-sim-loop)) [2] |
| `origin`, `interval`, `limit` | Periods to wait before the first send, periods between sends, and how many sends before the request ends, with 0 meaning at once, every period, and forever [22] |
| Flags | `CHANGED`, `TAGGED`, both, or neither [22] |

The SDK says that with `CHANGED` alone, the sim sends every variable in the definition when any one of them changes [22].

Our two clients read in different shapes:

| Client | Definitions | Request |
| --- | --- | --- |
| FS Copilot | One per variable | `SIM_FRAME` and `CHANGED`, epsilon 0 [4] |
| fsc-editor | One holding every watched `A:` variable, each tagged with its index in the watch list | `SIM_FRAME` and `TAGGED`, showing every sample and writing one a second to its capture file [20] |

fsc-editor's first version read the values by position, and crashed [23]:

```text
RangeError: Illegal offset: 0 <= 476 (+8) <= 476
  at RawBuffer.readFloat64
```

The sim had rejected a definition entry for a variable it doesn't have, after the call had returned, so the message held fewer values than the app's list [23].
A rejected entry in the middle would have shifted every later value onto the wrong variable, without a crash to show it [23].
Requesting tagged data fixed both, because each value names its datum [23].

**What it changes for Crosscheck.**
Crosscheck will read variables some loaded aircraft don't have, so its reads must survive a rejected entry.
How to group variables into definitions trades message count against resending unchanged values, and [part 8](outline.md#8-synchronization-full) covers change detection and sample rates.

**Traps.**

- Variable-length strings belong only in a definition requested with `SIMCONNECT_PERIOD_ONCE` [22].
- Changing a request's period or its definition costs the sim more than changing `origin`, `interval`, or `limit`, and a request can't be changed to `ONCE` without a new request ID [22].
- fsc-editor's source says clearing a definition the server never saw returns an exception, so it clears only one it has defined [20].
- In MSFS 2024, `SIMCONNECT_OBJECT_ID_USER` is marked deprecated in the header, beside `SIMCONNECT_OBJECT_ID_USER_AIRCRAFT`, `SIMCONNECT_OBJECT_ID_USER_AVATAR`, and `SIMCONNECT_OBJECT_ID_USER_CURRENT`, the last for whichever of the aircraft or the on-foot avatar the user is [2].
  Which object a request against the old constant reads while the pilot walks around is unverified.

## Writing data

`SimConnect_SetDataOnSimObject` writes a definition's values into an object [24].
The sim rejects a variable it doesn't let clients set, with a later exception, and treats one it accepts as a starting value: anything the simulation computes, such as position from velocity, it computes again on the next frame [24] [25].

**How it works.**
The SDK marks each `A:` variable settable or not ([03-01](03-01-units-and-variables.md#a-simulation-variables)), and says a write to one that can't be set this way returns an exception [24].
Our traffic tool, writing to AI aircraft, found `SetDataOnSimObject` following the marks [25] [26] [27] [28]:

| Variable | SDK mark | Result of `SetDataOnSimObject` |
| --- | --- | --- |
| `A:FLAPS HANDLE PERCENT` | Not settable | `DATA_ERROR`, at index 2 of the definition |
| `A:BRAKE PARKING POSITION` | Not settable | Rejected, 120 exceptions |
| `A:GENERAL ENG COMBUSTION` | Settable | Accepted, and read back as written |

Position is the variable the sim computes most visibly.
The traffic tool created AI aircraft, released them from the AI with `AIReleaseControl`, and wrote each one's position, while it scored how smoothly they moved: 0 for constant motion, near 1 for stop-and-snap [25].

| How the tool wrote | Jitter, median |
| --- | --- |
| At 20Hz, not frozen, with the sampled velocities | 0.52 |
| On every `Frame` event, not frozen, with velocities fitted to the path | 0.28 |
| At 20Hz, frozen with `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET` | 1.65 |
| On every `Frame` event, frozen | 0.17 |

Unfrozen, the sim moved each aircraft on its own between writes, and the writes fought it, less so when the velocities matched the path [25].
Frozen, the sim stopped moving it, so at 20Hz into a sim at about 33 fps it moved on some frames and stood still on others [25].
Frozen and written every frame, nothing fought the writes [25].
The SDK says the same of AI objects: without `AIReleaseControl` "the AI system and client may fight each other", and the `FREEZE_*` events stop the sim updating position and attitude [29].

FS Copilot does this for the user aircraft on the machine of the pilot not in control, from its WASM module rather than through SimConnect.
It freezes the aircraft, then writes position, attitude, velocities, and G force every frame, and writes each control surface twice, as `A:AILERON POSITION` and as `K:AXIS_AILERONS_SET`, with the comment "correct usage depends on aircraft" [30].

**What it changes for Crosscheck.**
For each value it syncs, Crosscheck needs to know whether the sim or the aircraft recomputes it.
A switch position written once stays written, but anything the simulation drives has to be frozen and written every frame, or not written at all.

**Traps.**

- Frozen objects lose the sim's ground clamping, so a frozen aircraft sits wherever the written altitude puts it, above or below the local scenery [31].
- An aircraft's own code can write back a variable a client set.
  fsc-editor reads this line from FS Copilot's log as that happening: `Skip counter for 'L:XMLVAR_ELT_STATE' expired (590.72s > 2.00s). Possible desync detected.` [32].
- Every write measured above was to AI aircraft.

## Sources

1. Documented: MSFS 2024 SDK, [SimConnect SDK](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_SDK.htm).
2. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`, and `WASM/include/MSFS/MSFS_CommBus.h`, `FsCommBusBroadcast_Default`.
3. Documented: MSFS 2024 SDK, [SimConnect_Open](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Open.htm), [SimConnect_CallDispatch](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_CallDispatch.htm), and [SimConnect_GetNextDispatch](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_GetNextDispatch.htm).
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs` (`SimVar`, `Stream`, and the constructor), `SimConnectConsumer.cs`, and `SimConnectProducer.cs`.
5. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimTraffic.cs` (`Call` and `Connect`) and `record/traffic-atc/tools/Traffic.Sim/SimLink.cs`.
6. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Program.cs`, where the connections get their names, and `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `SimConnect_Open`.
7. Documented, read from source: fsc-editor at 4cbf8ab, `link/src/module.cpp`, `module_init`.
8. Documented: MSFS 2024 SDK, [Programming SimConnect Clients Using Managed Code](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/Programming_SimConnect_Clients_Using_Managed_Code.htm).
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/FsCopilot.csproj` and the two DLLs committed beside it.
10. Measured on 2026-08-18, without the sim: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — node-simconnect is pure JS and implements the input-event API".
11. Documented, read from source: [YourControls](https://github.com/Sequal32/yourcontrols), `master` on 2026-09-27, `src/yourcontrols/Cargo.toml` and the root folder; and [the `simconnect` crate](https://crates.io/crates/simconnect), published by Sequal32.
12. Documented: MSFS 2024 SDK, [SimConnect API Reference](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_API_Reference.htm), for the groups, and [Communication API](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Communication/Communication_API.htm), for CommBus calls between SimConnect, JavaScript, and WASM.
13. Documented: MSFS 2024 SDK, [SimConnect CFG Definition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_CFG_Definition.htm).
14. Documented: MSFS 2024 SDK, [SimConnect XML Definition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_XML_Definition.htm).
15. Documented, read from source: node-simconnect 4.2.0, as installed in fsc-editor at 4cbf8ab, `dist/connectionParameters.js` (`autodetectServerAddress`) and `dist/enums/Protocol.js`.
16. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — Stage 0 passes against the sim. The module is off the critical path.", and fsc-editor at 4cbf8ab, `src/main/sim/session.ts`, `attempt`, for the order the protocols are tried.
17. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · TrafficRead built and smoke-tested — Q03 settled yes"; and `record/traffic-atc/docs/01-design.md`, section "MSFS 2020 and 2024".
18. Measured on our development machine, a Steam install, on 2026-09-27, with the sim closed: the registry key `HKCU\Software\Microsoft\Microsoft Games\Flight Simulator`, and the sim's `SimConnect.xml`.
19. Measured on 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Adopting node-simconnect quietly made the packaged app unshippable".
20. Documented, read from source: fsc-editor at 4cbf8ab, `src/main/sim/session.ts`: `defineWatch` and the `simObjectData` handler.
21. Documented: MSFS 2024 SDK, [SimConnect_AddToDataDefinition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddToDataDefinition.htm).
22. Documented: MSFS 2024 SDK, [SimConnect_RequestDataOnSimObject](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_RequestDataOnSimObject.htm).
23. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The `A:` read crashed the app. Positional reads were the wrong shape."
24. Documented: MSFS 2024 SDK, [SimConnect_SetDataOnSimObject](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_SetDataOnSimObject.htm), the remarks.
25. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Jitter measured, not eyeballed — freeze + per-frame writes wins; Q16 settled".
26. Documented: MSFS 2024 SDK, the Settable column of [Aircraft Control Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Control_Variables.htm), [Aircraft Brake/Landing Gear Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Brake_Landing_Gear_Variables.htm), and [Aircraft Engine Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Engine_Variables.htm), read 2026-09-27.
27. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled", for `FLAPS HANDLE PERCENT`.
28. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · First visual replay; engines, pushback, ground vehicles", for `GENERAL ENG COMBUSTION`.
29. Documented: MSFS 2024 SDK, [SimConnect_AIReleaseControl](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/SimConnect_AIReleaseControl.htm), the remarks.
30. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_physics` and `apply_control`.
31. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Baseline: BeyondATC's own traffic scores 0.56; visual confirmation of the fix".
32. Documented in our record: fsc-editor, `docs/sim-vars/10-probe.md`, section "Cause versus symptom", whose reading of the line is an inference, not a measurement.

## Unverified claims

- **Which of the SDK and [03-03](03-03-reading-and-writing.md) is right about SimConnect and the CommBus.**
  Subscribing a SimConnect client to one of the A220's CommBus events with `SimConnect_SubscribeToCommBusEvent` would settle it.
- **Who writes `SimConnect_Port_IPv4` on a machine with only MSFS 2024.**
  Deleting the value, starting MSFS 2024, and reading the registry again would settle it.
- **What `SIMCONNECT_OBJECT_ID_USER` reads while the pilot is on foot.**
  Reading `A:PLANE LATITUDE` against it and against `SIMCONNECT_OBJECT_ID_USER_CURRENT` during a walkaround would settle it.
- **Whether the user aircraft rejects writes to variables the SDK marks read-only**, as AI aircraft did.
  Writing `A:FLAPS HANDLE PERCENT` to the user aircraft and watching for an exception would settle it, and would answer the question [03-01](03-01-units-and-variables.md#unverified-claims) leaves open.
- **What a one-off write to `A:ELEVATOR POSITION` does while the pilot holds the stick.**
  Writing it once with a joystick connected and reading it on the next few frames would settle it.
