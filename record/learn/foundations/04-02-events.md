# SimConnect: events

- [Client events](#client-events)
- [System events and state](#system-events-and-state)
- [The input events API](#the-input-events-api)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

The connection, data definitions, and writing data are in [04-01-connection-and-data](04-01-connection-and-data.md), and client data areas, AI objects and facilities, and threading and reconnects are in [04-03-client-data-ai-and-throughput](04-03-client-data-ai-and-throughput.md).

## Client events

A client event is a client's own number for a sim event, such as `K:FLAPS_SET`.
The client maps the number to the event's name, then transmits it to fire the event, or adds it to a notification group to hear the event whenever anyone fires it [1] [2] [3].
Groups hear an event in priority order, and the sim takes its turn among them, at a fixed priority [4].
The SDK says a group ahead of the sim can mask an event so the sim never acts on it, and on MSFS 2024 it does, though a forum thread says masking has never worked in MSFS [4] [5] [26].

**How it works.**
Picture an event bus whose subscribers are ordered by a number, lowest first, with the sim as one of them [4] [6].
The picture holds for the order, and the traps below cover where delivery may not follow it:

```text
event fired, by the sim's own input or by TransmitClientEvent
  → groups at 1 to 9,999,999                 hear it first, and can't mask it
  → groups at 10,000,000 (HIGHEST_MASKABLE)  and below can mask it, if added as maskable
  → the sim, at 2,000,000,000 (DEFAULT)      acts on it, unless a group above masked it
  → groups down to 4,000,000,000 (LOWEST)    hear it last
```

Three calls set a client up, and one fires an event [1] [2] [3]:

| Call | What it does |
| --- | --- |
| `SimConnect_MapClientEventToSimEvent(id, name)` | Ties the client's ID to a sim event; a name with a period in it is a custom event between clients, and no name makes a private one |
| `SimConnect_AddClientEventToNotificationGroup(group, id, maskable)` | Adds the event to a group, up to 1000 events a group; an event outside every group sends the client nothing |
| `SimConnect_SetNotificationGroupPriority(group, priority)` | Places the group in the order above |
| `SimConnect_TransmitClientEvent(object, id, data, group, flags)` | Fires the event at an object; with `SIMCONNECT_EVENT_FLAG_GROUPID_IS_PRIORITY`, the group argument is instead the priority where delivery starts |

The `_EX1` form of the transmit call carries five parameters ([03-02](03-02-events-and-other-namespaces.md#k-key-events)), and a notification arrives as `SIMCONNECT_RECV_EVENT` with one `dwData` or `SIMCONNECT_RECV_EVENT_EX1` with five [6].

Our code does both halves:

| Half | Who | Calls |
| --- | --- | --- |
| Fire | Our traffic tool, freezing an AI aircraft [7] [8] | Map `FREEZE_LATITUDE_LONGITUDE_SET`, then `TransmitClientEvent(objectId, event, 1, 1, GROUPID_IS_PRIORITY)`, with data 1 and priority 1; `A:IS LATITUDE LONGITUDE FREEZE ON` read back 1 |
| Hear | FS Copilot, watching a profile's `K:` entries [9] | Map the event, add it to group 0 as not maskable, and set group 0 to `SIMCONNECT_GROUP_PRIORITY_HIGHEST`; each firing arrives with its `dwData` |

**What it changes for Dual Input.**
Dual Input can hear key events on one machine and fire them on the other, but, by the SDK, the machine that fires an event can hear it again, so it needs the guard [part 8](outline.md#8-synchronization-full) covers as echo suppression [2].
Dual Input can stop a pilot's input before the sim acts on it by masking, as long as its group sits ahead of any aircraft module that masks the same events, which means registering before the aircraft loads [26].

**Traps.**

- An event a client transmits may skip the aircraft's own interception.
  Answering a report from MSFS 2020 SU15, an Asobo developer wrote on the forum that `SimConnect_TransmitClientEvent`, "just like trigger_key_event and execute_calculator_code in the Gauge API will bypass JS and Input Event interception", and logged a bug [10].
  If that holds in MSFS 2024, a `<Binding EventID=...>` in the aircraft ([02-02](02-02-aircraft.md#model-behaviors)) never sees an event Dual Input sends this way (unverified).
- Which key events a listener hears at all is unmeasured: FS Copilot's profiles rely on hearing some, and nothing in our records checks events that an aircraft's own XML or WASM code fires.
- Which message an event arrives in is unsettled.
  The header has both `SIMCONNECT_RECV_ID_EVENT` and `SIMCONNECT_RECV_ID_EVENT_EX1` [6], the SDK's page for `SIMCONNECT_RECV_EVENT_EX1` says it arrives with `SIMCONNECT_RECV_ID_EVENT` [11], and an Asobo developer on the forum said events a module fires with `trigger_key_event_EX1` arrive as `SIMCONNECT_RECV_ID_EVENT_EX1` [12].
  We trust the header and the developer.
  On MSFS 2024, our listener received hardware axis events as `SIMCONNECT_RECV_EVENT` and a client's `_EX1` sends as `SIMCONNECT_RECV_EVENT_EX1`, and the PMDG 777's module masked the second and dropped it [26].
  FS Copilot's listener handles only `OnRecvEvent`, so it misses any event that arrives the other way [9].
- Two groups can't share a priority, across all clients: the SDK gives a group that asks for a taken priority the next lower one free [4].
  Our measurements fit it: the A2A PA-24's module beat our masks when the aircraft loaded first and lost when our masks went in first, and a send at 10,000,001 reached our own group, asked for at 10,000,000 [26].
- The SDK limits a group to 1000 events, and a forum poster reports adding about 1,800 to one group without seeing an error or a missing notification (unverified) [3] [14].

## System events and state

A system event is a named notification from the sim, such as `AircraftLoaded` or `Frame`, which a client subscribes to once [15].
It reports only what happens after the subscription, so a client that connects mid-flight also asks for the current state with `SimConnect_RequestSystemState` [15] [16].
[02-03](02-03-the-running-sim.md#the-flight-lifecycle) lists the events, what each means, and their bugs in MSFS 2024.

**How it works.**
Each event arrives in the message type that fits its data [6] [15]:

| Call | Reply |
| --- | --- |
| `SubscribeToSystemEvent(id, "AircraftLoaded")` or `"FlightLoaded"` | `SIMCONNECT_RECV_EVENT_FILENAME`, carrying a path |
| `SubscribeToSystemEvent(id, "Frame")` | `SIMCONNECT_RECV_EVENT_FRAME`, carrying the frame rate and the simulation rate |
| `SubscribeToSystemEvent(id, "Pause_EX1")` or `"SimStart"` | `SIMCONNECT_RECV_EVENT`, with any data, such as the pause flags, in `dwData` |
| `RequestSystemState(requestId, name)` | `SIMCONNECT_RECV_SYSTEM_STATE`, carrying an integer, a float, and a string |

The states a client can ask for are `AircraftLoaded`, `DialogMode`, `FlightLoaded`, `FlightPlan`, and `Sim` [16].
`SimConnect_SetSystemEventState` turns a subscription off and on, and `SimConnect_UnsubscribeFromSystemEvent` ends it [15].

fsc-editor subscribes to `AircraftLoaded` and asks for it at every connection, "so connecting mid-flight works as well as connecting before loading" [17].
FS Copilot's consumer connection does the same [9].
In a 437s session that changed aircraft twice, fsc-editor saw each load reported twice, once through each route [18].

**What it changes for Dual Input.**
Either pilot may start Dual Input mid-flight, so it has to subscribe and ask on every connection, and treat two announcements of one load as one.
Which event marks an aircraft as loaded and settled is still open ([02-03](02-03-the-running-sim.md#the-flight-lifecycle)).

**Traps.**

- `ObjectAdded` reports only objects created after the subscription.
  At a gate with 109 AI aircraft already present, our traffic reader got no `ObjectAdded` event for any of them, which is why it polls instead [19].
- Several `Frame` events can arrive in one `ReceiveMessage` when the sim outpaces the client's thread, all of them for frames already drawn [13].
- fsc-editor's first probe read node-simconnect's `stringValue`, which doesn't exist, and reported no aircraft without an error; the field is `dataString` [20].
- The SDK says the `Sim` state, 1 while the user controls the aircraft and 0 in the menus, is the state `SimStart` and `SimStop` announce [16], so it may share their MSFS 2024 bugs ([02-03](02-03-the-running-sim.md#the-flight-lifecycle)), and nothing in our records has read it.

## The input events API

Six calls reach the loaded aircraft's input events, each named by a 64-bit hash: enumerate the list, get a value, set one, subscribe to changes, unsubscribe, and list an event's parameters [6] [21].
[03-02](03-02-events-and-other-namespaces.md#b-input-events) covers what input events are and what fsc-editor measured of their values, including that subscribing sends no current value.

**How it works.**
The replies, from the header and the SDK [6] [21] [22] [23]:

| Call | Reply |
| --- | --- |
| `EnumerateInputEvents(requestId)` | One or more `SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS`, each a page of descriptors: a name of up to 64 bytes, the hash, and a type |
| `GetInputEvent(requestId, hash)` | `SIMCONNECT_RECV_GET_INPUT_EVENT`: the request ID, the type, and the value, without the hash |
| `SetInputEvent(hash, size, value)` | None |
| `SubscribeInputEvent(hash)`, with 0 for all; `UnsubscribeInputEvent(hash)` | `SIMCONNECT_RECV_SUBSCRIBE_INPUT_EVENT` on each change: the hash, the type, and the value |
| `EnumerateInputEventParams(hash)` | `SIMCONNECT_RECV_ENUMERATE_INPUT_EVENT_PARAMS`: the hash and a string |

The SDK calls the hash "CRC based" [21].

fsc-editor runs this cycle on every `AircraftLoaded` [17]:

1. Unsubscribe every hash, clear its tables of names and hashes, and enumerate again under a new request ID, dropping any page that carries an older one.
2. When the list is whole, subscribe to every hash on it.
3. Call `GetInputEvent` once for each input event someone is watching, and remember which request ID asked about which name, because the reply doesn't carry the hash.

In a session with the PA-24, the subscription showed two things the cycle has to absorb [18] [24]:

- Ahead of each aircraft change came a burst of every subscribed input event with its current value, 318 events arriving within 2ms to 4ms, 4.1s before the `AircraftLoaded` event the first time and 8.2s the second.
- Each switch reported twice, 17ms to 21ms apart in 43 of 53 pairs and 37ms to 40ms in 9, which fsc-editor reads as one or two frames.

**What it changes for Dual Input.**
The list, the hashes, and the subscriptions belong to one aircraft, so Dual Input has to rebuild them on every aircraft change.
It also has to tell the burst ahead of a change from a pilot's hands, and the second report of a switch from a second flip.

**Traps.**

- Nobody in our records has called `SetInputEvent`, so whether it runs the input event's `<Set>` code and bindings, as a click does, is unmeasured.
  A forum poster reports that in MSFS 2024 a client doesn't hear its own `SetInputEvent` through its subscription, as it did in MSFS 2020 (unverified) [25].
- The SDK's "CRC based" suggests a name always gets the same hash, while fsc-editor's source assumes an aircraft change reassigns hashes [17] [21].
  Neither is measured.
- The header says a page's `dwEntryNumber` counts sends, from 0 to `dwOutOf` − 1 [6], while fsc-editor treats the list as whole once `entryNumber + arraySize` reaches `outOf`, reading them as item counts [17].
  By the header's meaning, that test would pass on the first page of a list split across several.
- The list holds input events, not their presets.
  An Asobo developer said on the forum in 2023, in the MSFS 2020 days, that leaving out the `_INC`, `_DEC`, `_TOGGLE`, `_ON`, and `_OFF` presets was by design "for this first iteration" [25], which matches the A220 ([03-02](03-02-events-and-other-namespaces.md#b-input-events)).

## Sources

1. Documented: MSFS 2024 SDK, [SimConnect_MapClientEventToSimEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_MapClientEventToSimEvent.htm).
2. Documented: MSFS 2024 SDK, [SimConnect_TransmitClientEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_TransmitClientEvent.htm): the `GroupID` and `Flags` parameters and the remarks.
3. Documented: MSFS 2024 SDK, [SimConnect_AddClientEventToNotificationGroup](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Events_And_Data/SimConnect_AddClientEventToNotificationGroup.htm).
4. Documented: MSFS 2024 SDK, [SimConnect API Reference](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_API_Reference.htm), the section on priorities.
5. Unverified, forum: MSFS DevSupport, [How to intercept and block a simulator event using SimConnect?](https://devsupport.flightsimulator.com/t/how-to-intercept-and-block-a-simulator-event-e-g-com1-volume-change-using-simconnect/14466), 2025-06-01, where a reply says "priorities and blocking never has worked properly in MSFS".
6. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`: the priority constants, `SIMCONNECT_RECV_ID`, and the receive structures.
7. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Jitter measured, not eyeballed — freeze + per-frame writes wins; Q16 settled".
8. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `record/traffic-atc/tools/TrafficInject/Program.cs`, `OnAssigned` and the `GRP` enum.
9. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimClient.cs`, `KEvent`, and `FsCopilot/Connection/SimConnectConsumer.cs`, `Connect`.
10. Unverified, forum: MSFS DevSupport, [XML Key Event Bindings do not intercept Key Events via SimConnect](https://devsupport.flightsimulator.com/t/xml-key-event-bindings-do-not-intercept-key-events-via-simconnect/8320), reported on SU15, 1.37.4.0, with the Asobo reply of 2024-02-27; tagged `bug_logged`.
11. Documented: MSFS 2024 SDK, [SIMCONNECT_RECV_EVENT_EX1](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_EVENT_EX1.htm), the remarks.
12. Unverified, forum: MSFS DevSupport, [Events sent by trigger_key_event_EX1 are not received by Simconnect](https://devsupport.flightsimulator.com/t/events-sent-by-trigger-key-event-ex1-are-not-received-by-simconnect/5673), 2023-05, an MSFS 2020 thread, with the Asobo reply of 2023-05-22.
13. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864, `FsCopilot/Connection/SimTraffic.cs`, the comment on the `Frame` event.
14. Unverified, forum: MSFS DevSupport, [Behavior when adding more than 1000 events to a notification group?](https://devsupport.flightsimulator.com/t/behavior-when-adding-more-than-1000-events-to-a-notification-group/10943), 2024-11-13.
15. Documented: MSFS 2024 SDK, [SimConnect_SubscribeToSystemEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_SubscribeToSystemEvent.htm).
16. Documented: MSFS 2024 SDK, [SimConnect_RequestSystemState](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_RequestSystemState.htm).
17. Documented, read from source: fsc-editor at 4cbf8ab, `src/main/sim/session.ts`: `ready`, the `inputEventsList` and `getInputEvent` handlers, `aircraftChanged`, and the comments on the `Live` interface.
18. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — Stage 2 verified live. The double-fire is frame-locked, and tighter than measured."
19. Measured on MSFS 2024, 2026-09-06: FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested — Q01, Q08 settled", and `record/traffic-atc/docs/01-design.md`, section "Reading".
20. Measured on MSFS 2024, 2026-08-18: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-18 — Question 2 failed on a spike bug, not a sim limitation".
21. Documented: MSFS 2024 SDK, [SimConnect_EnumerateInputEvents](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/InputEvents/SimConnect_EnumerateInputEvents.htm).
22. Documented: MSFS 2024 SDK, [SimConnect_SetInputEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/InputEvents/SimConnect_SetInputEvent.htm).
23. Documented: MSFS 2024 SDK, [SimConnect_SubscribeInputEvent](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/InputEvents/SimConnect_SubscribeInputEvent.htm).
24. Measured on MSFS 2024, 2026-08-23: fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — An aircraft change snapshots every input event before it announces itself".
25. Unverified, forum: MSFS DevSupport, [EnumerateInputEvents doesn't return _INC, _DEC, _TOGGLE, _ON, and _OFF events](https://devsupport.flightsimulator.com/t/enumerateinputevents-doesnt-return-inc-dec-toggle-on-and-off-events/6598), with the Asobo reply of 2023-10-26 and the report on `SetInputEvent` of 2024-11-21.
26. Measured on MSFS 2024, 2026-10-01: [record/areas/flight-controls/log.md](../../areas/flight-controls/log.md), every entry of that date.

## Unverified claims

- **A key event sent through SimConnect skips the aircraft's input event bindings in MSFS 2024.**
  Asobo said so for MSFS 2020 [10].
  Transmitting a key event the PA-24 binds, and watching whether its input event fires, would settle it.
- **Which key events a listener hears, and in which message type.**
  Listening for both `SIMCONNECT_RECV_EVENT` and `SIMCONNECT_RECV_EVENT_EX1` while firing one key event from the keyboard, one from a cockpit click that runs `(>K:...)`, one with `TransmitClientEvent`, and one with `TransmitClientEvent_EX1` would settle it.
- **What `SetInputEvent` runs, and whether the setter hears it.**
  Setting `SWITCH_BATTERY_MASTER_2STATES` on the PA-24 while subscribed to it, and reading `L:Battery1Switch`, would settle it [25].
- **Whether hashes survive an aircraft change, and what `dwEntryNumber` counts.**
  Enumerating one aircraft, loading another, reloading the first, and logging every page's fields and hashes would settle both.
- **What the `Sim` state reads through a flight's lifecycle on MSFS 2024.**
  Requesting it at the main menu, during loading, and in flight would settle it.
