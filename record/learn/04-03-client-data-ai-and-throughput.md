# SimConnect: client data, AI objects, and throughput

- [Client data areas and their size limits](#client-data-areas-and-their-size-limits)
- [The AI objects API and the Facilities API](#the-ai-objects-api-and-the-facilities-api)
- [Throughput, threading, and reconnects](#throughput-threading-and-reconnects)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The connection, data definitions, and writing data are in [04-01-connection-and-data](04-01-connection-and-data.md), and client, system, and input events are in [04-02-events](04-02-events.md).

## Client data areas and their size limits

A client data area is a named block of memory in the SimConnect server that any client can create, write, and subscribe to, up to 8,192 bytes each and 1 MB for all of them together [1] [2].
It's how an app outside the sim and a WASM module inside it pass what no sim variable holds, such as commands, calculator code, and batches of values [1] [5].

**How it works.**
It behaves like a named slot of shared memory that notifies readers when it's written, except that a reader gets the contents in a message rather than reading the memory.
Both sides give the area the same name, and each maps the name to an ID of its own [1] [3] [4]:

| Call | What it does |
| --- | --- |
| `SimConnect_MapClientDataNameToID(name, id)` | Ties this client's ID to the area's name |
| `SimConnect_CreateClientData(id, size, flags)` | Creates the area; `SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY` lets only the creator write it |
| `SimConnect_AddToClientDataDefinition(defId, offset, sizeOrType)` | Picks the bytes to read or write: a size, or a negative type constant such as `SIMCONNECT_CLIENTDATATYPE_FLOAT64` |
| `SimConnect_RequestClientData(id, requestId, defId, period)` | Subscribes; `SIMCONNECT_CLIENT_DATA_PERIOD_ON_SET` sends the data "whenever it is set" |
| `SimConnect_SetClientData(id, defId, flags, 0, size, data)` | Writes |

Our two links use areas differently:

| | FS Copilot | fsc-editor |
| --- | --- | --- |
| Areas | 11, one per kind of message, such as `FSC_PHYSICS` for position from the other machine, and `FSC_BUS_IN` and `FSC_BUS_OUT` for one 512-byte string each [5] | 2 of 8,192 bytes: `FSCEDITOR_LINK_CMD` to the module, and `FSCEDITOR_LINK_OUT` from it [6] |
| Created by | Both the app and the module, for most names [5] | The module, when it loads; the app maps and subscribes [6] |
| Contents | Fixed C structs, with JSON inside the bus strings [5] [7] | Lines of text, each message headed by its kind, a sequence number, and how many parts are still to come [6] |

MobiFlight's WASM module, documented for MSFS 2020, gives each client areas of its own: a client sends `MF.Clients.Add.<name>` and gets `<name>.LVars`, `<name>.Command`, and `<name>.Response` [8].
Its values take 4 bytes each and its strings 128, 64 strings to an area, which fills 8,192 bytes [8].

An area holds one value, and every reader sees it.
fsc-editor's module sent its table of `L:` names once, when the first client asked, and a second client that connected later got only values it had no names for [9].
An area also outlives the client that created it, for the rest of the sim session [1].
fsc-editor's module leaves a hello message in its output area when it loads, so a client that connects later can read it once and tell a missing module from a silent one [6].

**What it changes for Crosscheck.**
If Crosscheck has a WASM module, its link to the app through SimConnect is a set of 8KB slots holding one message each.
A message larger than a slot needs chunking, a writer faster than its reader needs sequence numbers to show what was lost, and a second reader needs areas of its own.

**Traps.**

- Whether two `SetClientData` calls in one frame both reach a reader, or the second replaces the first, is an open question in our records [10].
- A definition larger than the area reads zeros past its end, with no error [11].
- An area keeps its last value after its writer restarts [1], so a reader needs something like fsc-editor's sequence number to tell a new message from an old one [6].
- FS Copilot's 512-byte strings are its own limit, not SimConnect's [7].
- What the second client to create an area gets back is unverified; the header lists `SIMCONNECT_EXCEPTION_ALREADY_CREATED` [2].
  FS Copilot's app wraps one create in `try`, which catches a failed call but not an exception the server sends later as a message [5] [12].

## The AI objects API and the Facilities API

The AI objects API creates aircraft and other objects, hands them to a client to drive, and removes them [13].
The Facilities API reads the sim's database of airports, runways, navaids, and procedures [14].
Crosscheck's shared aircraft is the user aircraft on each machine, so neither API touches the shared cockpit: AI objects matter for syncing traffic, and facilities for what an FMS reads.

**How it works.**
Four calls create AI objects, each with an `_EX1` form that also takes a livery, which is new in MSFS 2024 [13] [15]:

| Call | Creates |
| --- | --- |
| `SimConnect_AICreateParkedATCAircraft` | A parked aircraft with no flight plan |
| `SimConnect_AICreateEnrouteATCAircraft` | An aircraft about to fly, or flying, its flight plan |
| `SimConnect_AICreateNonATCAircraft` | An aircraft outside ATC, on the ground or in the air |
| `SimConnect_AICreateSimulatedObject` | Anything that isn't an aircraft |

FS Copilot's traffic feature copies the host's traffic into the other pilot's sim [15]:

1. On the host, poll `SimConnect_RequestDataOnSimObjectType` once per object type, within a radius of at most 200,000 meters; each object in range comes back as its own message [16] [17].
2. On the other machine, create each object with `SimConnect_AICreateNonATCAircraft_EX1` or `SimConnect_AICreateSimulatedObject_EX1`.
3. Read the new object's ID from `SIMCONNECT_RECV_ASSIGNED_OBJECT_ID`, which carries the create call's request ID [2].
4. Call `SimConnect_AIReleaseControl`, send the three freeze events, and write the object's position every frame ([04-01](04-01-connection-and-data.md#writing-data)).
5. Call `SimConnect_AIRemoveObject` when the host drops it.

What our traffic tools measured on MSFS 2024 [18] [19]:

- Polling 110 aircraft cost 13ms on average and 30ms at worst per type per poll, and 0.1% CPU.
- Every FSLTL title the tool tried was created and read back unchanged.
- Created aircraft arrived with their engines running, until the tool wrote `A:GENERAL ENG COMBUSTION`.
- 11 ground vehicles, such as tugs and fuel trucks, were created, and each rejected every appearance variable, such as gear and lights, with `DATA_ERROR`.
- Tail numbers were cut to 9 characters, `FSCSWA4524` becoming `FSCSWA452`, where the SDK allows 12 [20]; we trust the measurement.
- When the tool was killed without cleaning up, the sim removed every object it had created.

The Facilities API works two ways [14] [21] [22]:

- **Lists.** `SimConnect_RequestFacilitiesList` returns the facilities of one type from the sim's cache, which holds every airport in the world, about 40,000, and the waypoints, NDBs, and VORs within a radius of the aircraft, which for VORs and NDBs can exceed 200 miles.
  `SimConnect_SubscribeToFacilities` reports additions to the cache.
- **Data.** `SimConnect_AddToFacilityDefinition` builds a definition of fields, and `SimConnect_RequestFacilityData` fills it for one ICAO code and region, in as many `SIMCONNECT_RECV_FACILITY_DATA` messages as it takes, then `SIMCONNECT_RECV_FACILITY_DATA_END`.
  An ICAO code that matches several facilities returns the candidates instead.

Nothing in our records calls the Facilities API.
The A220's systems module has source paths under `simconnect/facilities`, read from panic messages in its `systems.wasm`, which suggests its FMS reads the database this way (unverified) [23].

**What it changes for Crosscheck.**
If Crosscheck syncs traffic, it inherits FS Copilot's measured method, and every injected object disappears with the connection, so a reconnect has to create them again.
Each machine's FMS reads its own sim's database, so two machines with different navigation data might build different flight plans from the same entries, which is a question for [part 7](outline.md#7-aircraft-specific-systems-refresher) (unverified).

**Traps.**

- A title the receiving sim doesn't have fails the create with an exception, so both machines need the same traffic package; FS Copilot's design retries once with a stock aircraft of the same category [15] [26].
- A radius over 200,000 meters returns `SIMCONNECT_EXCEPTION_OUT_OF_BOUNDS` [17].
- An airport list is about 40,000 items and can arrive in several packets, each of which the client must read on its own [21].

## Throughput, threading, and reconnects

The SDK says SimConnect clients "are not currently thread-safe", so each connection belongs to one thread [24].
What we've measured through SimConnect costs little next to what the sim spends on its own models.
Everything a client sets up belongs to its connection, so after a reconnect the client sets it all up again.

**How it works.**
FS Copilot gives each connection a long-running thread of its own, and other code posts work to it through a queue [25].
Its traffic connection's source states the rule: every event is raised on that connection's thread, inside `ReceiveMessage`, and only the handlers and the posted jobs may call the connection [26].
Its app reads variables over two connections, streaming each variable on one of them in turn [5], and nothing in our records says whether that helps.

The measured costs [18] [19] [27]:

| Load | Measured |
| --- | --- |
| Polling 110 AI aircraft by type, at 2Hz | 13ms average and 30ms worst per type per poll, 0.1% CPU |
| Writing 132 injected objects, at 2Hz | About 260 writes a second, with no exceptions |
| 132 injected objects, written every frame | 32.5 fps, against 44.7 with no traffic and 38.0 with BeyondATC's own 73; the models cost the frames, whoever drives them |

Developer Mode's SimConnect Inspector shows the calls a client makes each frame, and each exception with the frame it happened in [28].

What a reconnect keeps and loses:

| Lost with the connection | Kept |
| --- | --- |
| Data definitions, requests, mapped events, notification groups, and subscriptions, which both our clients set up again on every connection [25] [29] | Client data areas and their last values [1] |
| AI objects the client created [18] | |

FS Copilot keeps a list of setup actions for each connection, runs all of them on every new connection, and runs an action's teardown when its owner no longer needs it [25].
fsc-editor learned why the list matters.
A set of `A:` variables to watch that arrived while the sim was closed was never defined, because the app defined it only when the set changed, so its values stayed blank after every reconnect until the fix [29].

A client learns the connection is gone in one of these ways:

- The managed wrapper throws `COMException` from a call or from `ReceiveMessage`, or raises `OnRecvQuit` when the sim closes [12] [25] [26].
- node-simconnect emits `quit`, `close`, or `error` [29].
- A remote client's calls return `STATUS_REMOTE_DISCONNECT` [30].

FS Copilot tries again every 2s, and fsc-editor every 5s [25] [29].

**What it changes for Crosscheck.**
Crosscheck's SimConnect code needs one owner thread per connection and a record of everything it set up, replayed on each new connection.
A reconnect also loses whatever changed while it was down, so Crosscheck has to take a fresh snapshot, which [part 8](outline.md#8-synchronization-full) covers as resync after reconnect.

**Traps.**

- Work queued while the sim is away is stale by the time a new connection could run it, so FS Copilot's traffic connection refuses jobs while disconnected [26].
- A stalled thread gets its backlog all at once, such as several `Frame` events for frames already drawn ([04-02](04-02-events.md#system-events-and-state)); FS Copilot's traffic connection logs any job or `ReceiveMessage` that takes over 15ms [26].
- A failed write reports itself later, as an exception message, after the code that made it has moved on ([04-01](04-01-connection-and-data.md#what-it-is)).

## Sources

1. Documented: MSFS 2024 SDK, [SimConnect_CreateClientData](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_CreateClientData.htm).
2. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`.
3. Documented: MSFS 2024 SDK, [SimConnect_AddToClientDataDefinition](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddToClientDataDefinition.htm).
4. Documented: MSFS 2024 SDK, [SIMCONNECT_CLIENT_DATA_PERIOD](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_CLIENT_DATA_PERIOD.htm).
5. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs` (`RegisterClientStruct`, `Register`, and `SimVar`), and `FsCopilot.Bridge.Wasm/wasm_module.cpp` and `protocol.h`.
6. Documented, read from source: fsc-editor at 4cbf8ab, `src/shared/link.ts`, `src/main/sim/link.ts`, and `link/src/module.cpp` (`send` and `module_init`).
7. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/04-transport.md`, sections "What exists" and "Widening it".
8. Documented: [MobiFlight WASM module](https://github.com/MobiFlight/MobiFlight-WASM-Module), the README, read 2026-09-27.
9. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — The module streams, and a second client got no enumeration".
10. Documented in our record: FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, "Q09 · Does the existing bus survive a burst?", open.
11. Documented: MSFS 2024 SDK, [SimConnect_RequestClientData](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_RequestClientData.htm).
12. Documented: MSFS 2024 SDK, [Programming SimConnect Clients Using Managed Code](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/Programming_SimConnect_Clients_Using_Managed_Code.htm).
13. Documented: MSFS 2024 SDK, [AI Objects](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/AI_Objects.htm).
14. Documented: MSFS 2024 SDK, [Facilities](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Facilities/Facilities.htm).
15. Documented in our record: FS Copilot fork, `record/traffic-atc/docs/01-design.md`, sections "Reading", "Injecting", "Model matching", and "MSFS 2020 and 2024".
16. Documented: MSFS 2024 SDK, [SIMCONNECT_RECV_SIMOBJECT_DATA](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_SIMOBJECT_DATA.htm), `dwentrynumber` and `dwoutof`.
17. Documented: MSFS 2024 SDK, [SimConnect_RequestDataOnSimObjectType](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_RequestDataOnSimObjectType.htm), `dwRadiusMeters`.
18. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled".
19. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · First visual replay; engines, pushback, ground vehicles".
20. Documented: MSFS 2024 SDK, [SimConnect_AICreateNonATCAircraft_EX1](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/SimConnect_AICreateNonATCAircraft_EX1.htm), `szTailNumber`.
21. Documented: MSFS 2024 SDK, [SimConnect_RequestFacilitesList](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Facilities/SimConnect_RequestFacilitesList.htm), the remarks.
22. Documented: MSFS 2024 SDK, [SimConnect_RequestFacilityData](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Facilities/SimConnect_RequestFacilityData.htm), the remarks.
23. Documented in our record, read from the aircraft's files: fsc-editor, `docs/aircraft/synaptic-a220.md`, section "Rust module map (from panic paths in `systems.wasm`)".
24. Documented: MSFS 2024 SDK, [SimConnect SDK](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_SDK.htm).
25. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimConnectConsumer.cs` and `SimConnectProducer.cs`: `AutoReconnect`, `Connect`, and `Configure`.
26. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimTraffic.cs`: the class comment, `Post`, and `Connect`.
27. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Baseline: BeyondATC's own traffic scores 0.56; visual confirmation of the fix".
28. Documented: MSFS 2024 SDK, [SimConnect Inspector](https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Tools/SimConnect_Inspector.htm).
29. Documented, read from source: fsc-editor at 4cbf8ab, `src/main/sim/session.ts` (the comment on `definitionWatch`, and `ready`) and `src/shared/sim.ts`, `SIM_RETRY_MS`.
30. Documented: MSFS 2024 SDK, [SimConnect_Open](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Open.htm), the remarks.

## Unverified claims

- **Two `SetClientData` calls in one frame both arrive.**
  Writing a counter into one area twice per frame from a WASM module, and checking the app sees every value, would settle it [10].
- **What the second creator of a client data area gets.**
  Calling `SimConnect_CreateClientData` on an existing name, and logging any exception, would settle it.
- **Reading two connections in turn helps FS Copilot.**
  Streaming the same few hundred variables over one connection and over two, and comparing delivery delay, would settle it.
- **The A220's FMS reads the Facilities API**, and two machines with different navigation data diverge.
  Logging the A220's SimConnect calls in the SimConnect Inspector while it loads a flight plan would settle the first half.
