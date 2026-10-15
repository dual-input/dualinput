# Core: the sim seam and our WASM module

```text
Purpose:     How the core reaches the sim and knows what it's doing, and how our WASM module runs the routines features feed it.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, 02-clients-and-panel-bridge.md, ../architecture/decisions.md, log.md
Decides:     The sim edge's thread and its inputs, the sim's process among them; the sim client's and the sim service's interfaces; sim awareness's stages and its one moment, and that it's an engine; how the core tells a crash from a close, and which aircraft and preset loaded; our WASM module's slots, its status, and what happens to a module from another build; which of the sim's APIs carries each want; the module through a flight load; the core's announcement; and the budgets (node 6.3).
```

The core reaches the sim through one thread at its edge, which holds every SimConnect connection and watches the sim's process, and everything that thread hands up is parsed on the loop.
Sim awareness, an engine of its own, turns the sim's signals into six stages, and the sim service raises one moment, `SimChanged`, for each change, so a load is one entry into Loading however many signals the sim sends.
A crash is a sim whose process ends with no quit message before it, and the loaded aircraft is the folder and preset in the path `AircraftLoaded` reports.
Our WASM module runs a routine only on feeds from its own build, which it tells by a hash of the slots' layouts, and carries each want through the sim's `fsVars` and `fsEvents` APIs, with calculator code only for a plugin's calculator code.

This answers node 6.3 of the [architecture plan](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module).
The code map's [sim seam](../architecture/02-code-map.md#the-sim-seam) and [work in the sim](../architecture/02-code-map.md#work-in-the-sim), the spine's [sim awareness](../architecture/01-spine.md#sim-awareness), [01-loop-and-edge](01-loop-and-edge.md), and [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md) give the rules this design builds on, and this document holds only what they leave out.
Every name the sim shares is `CROSSCHECK_<KIND>_<NAME>` (user, 2026-10-15), and the code map's [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares) lists the kinds.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `sim-edge` | Engine | One thread holding every SimConnect connection and the sim's process: it makes each call, tags each exception, and hands up each message, open, loss, and change of the process as an input | Off the loop, in the core and the IDE |
| `sim-client` | Engine | For each connection: its IDs, the calls that set it up, which it makes again on a new connection, a feature's call turned into SimConnect's calls, and each message parsed and routed to the call that caused it | On the loop, and in the IDE |
| `sim-awareness` | Engine | One step function from a sim signal to the sim's state, with no clock and no I/O | On the loop, on the bench, and in the IDE |
| `sim-service` | Platform | The connections, the calls features make, routines' feeds, the module's status and the unfreeze, the masking group, the announcement, and the world map's requests; it raises `SimChanged` | On the loop |
| `routine-host` | Platform, outside the core | Routines, their slots and wants, the freeze, and the module's status slot | In our WASM module, and natively on the bench |
| `sim-package/wasm-module` | Sim package | The module's edge on the sim's APIs, and the list of routines | In the sim |

Sim awareness is an engine so that the IDE can link it, as it links the sim client, rather than work out the sim's state again, as fsc-editor did on every `AircraftLoaded` (read in fsc-editor, `src/main/sim/session.ts`, `aircraftChanged`), and so that the bench can feed it recorded signals with nothing else running (user, 2026-10-15).

## The edge

### Its thread

- One thread, the sim thread of [01-loop-and-edge](01-loop-and-edge.md#threads), holds every connection's handle, since SimConnect's clients "are not currently thread-safe" ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
- It waits in `WaitForMultipleObjects` on each connection's event, the one it passes to `SimConnect_Open`, on the sim's process, and on an event that the loop's sink for `SimCall` sets when it queues calls.
  It waits at most 2ms, as p08's client waited on its connection's event in a flight (read in `experiments/areas/architecture/flight/client/src/main.rs`; [architecture log][flight]), since the SDK says only that a client "can be written to respond to Windows Events" ([SimConnect_Open](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Open.htm)), not when it signals one.
- On each wake it makes the queued calls in their order, then takes each connection's messages through `SimConnect_GetNextDispatch` until none is left.
- After each call it reads `SimConnect_GetLastSentPacketID`, and keeps each packet ID with its call's handle for the last 4,096 calls on each connection, about 1s of traffic's writes with 132 copies at 32.5 fps (arithmetic, from [04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
  An exception whose packet ID it holds goes up tagged with that handle.
- Each connection's name in `SimConnect_Open` is `Crosscheck` for the platform's and `Crosscheck ` and the unit's name for a feature's, so Developer Mode's SimConnect Inspector, which shows each client's calls ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)), names whose they are.

### Its inputs

Four kinds of input come up through the seam, each stamped and recorded ([inputs](01-loop-and-edge.md#inputs)):

| Input | Carries |
| --- | --- |
| A message | The connection's number, and the record SimConnect handed over, copied whole, with its call's handle when it's an exception whose packet ID the edge holds |
| An open | The connection's number, and `SimConnect_Open`'s result |
| A loss | The connection's number, after a call on it returned an error |
| The sim's process | Found, with its ID and creation time; or exited, with its exit code |

The sim's process is the fourth, beside the three the code map names.
It gives the session file the run of the sim, which the spine names by the process's ID and creation time ([IDs](../architecture/01-spine.md#ids)), and it ends a run of the sim even when SimConnect reports nothing.
Whether a crashed sim's connection fails the next call, or reports nothing until the process is gone, is unmeasured, and node 7's test that kills the sim shows which comes first.

### The sim's process

- While it holds no process, the edge looks for one each time the sim service asks, every 2s: it walks a `CreateToolhelp32Snapshot` of the processes for `FlightSimulator2024.exe`, ignoring case, the name the Windows Application log gave each sim that crashed in our aircraft harness ([crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv)).
- It opens the process with `PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE`, reads its creation time with `GetProcessTimes`, hands both up, and waits on the process with its connections.
- When the process ends, it hands up `GetExitCodeProcess`'s code, which for a crash is "the exception value for an unhandled exception that caused the process to terminate" (documented, [GetExitCodeProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess)), for the log.

## The sim client

- **Calls:** `SimCall`, the output type the edge carries out, has a variant for each SimConnect function our code calls, with its arguments owned, so the edge maps each variant to one call, and the stand-in sim answers each ([node 7](../architecture/plan.md#7-testing)).
- **IDs:** each connection counts its definitions, requests, client events, groups, and client data from 1, on the loop, so a replay hands out the same.
- **Setup:** it keeps, in order, each call that set something up on a connection, and makes them all again on that connection's next open, as FS Copilot keeps a list of setup actions for each connection ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
- **Watches:** a feature's names become one data definition, with a datum ID for each name, requested `TAGGED`, so each value arrives with its name's ID, and a name the sim rejects leaves the others whole ([why the seam sits at SimConnect's calls](../architecture/02-code-map.md#why-the-seam-sits-at-simconnects-calls)).
  A number is `FLOAT64`, and a string `STRING256`.
- **`B:` names:** at a connection's first `B:` name, it enumerates the input events, holds the connection's `B:` calls until the list is whole, then makes each by its hash, as fsc-editor's cycle does ([04-02](../../learn/foundations/04-02-events.md#the-input-events-api)); a name not on the list answers its call with an error.
- **Messages:** it parses each record by its `dwID`, and routes it by its request ID, event ID, or the edge's tag to the handle of the call that caused it.

## The sim service

### What a feature calls

```rust
// a sketch: flight-model sync on the flying machine
pub fn register(r: &mut Registry) {
    let me = r.unit::<FlightModel>("flight-model");
    me.on_sim(FlightModel::on_sim);                 // a value, an object's ID, an exception, a lost connection
    me.on::<ProfileLoaded>(FlightModel::start);     // a hypothetical name for the profile loader's moment
}

fn start(me: &mut FlightModel, _: &ProfileLoaded, cx: &mut Cx) {
    me.pose = Some(cx.sim().watch::<Pose>(Period::SimFrame));   // a handle now; the first call opens the feature's connection
}
```

| Call | SimConnect |
| --- | --- |
| `watch(names or a struct, period)` | One definition, requested `TAGGED`, with `CHANGED` when the period is "on change" |
| `write(watch, values)` | `SetDataOnSimObject` on that definition |
| `key(event, values)` | `MapClientEventToSimEvent` once, then `TransmitClientEvent_EX1` |
| `input`, `set_input` | `GetInputEvent`, `SubscribeInputEvent`, and `SetInputEvent`, by hash |
| `create_ai`, `remove` | `AICreateNonATCAircraft_EX1` or `AICreateSimulatedObject_EX1`, and `AIRemoveObject` |
| `camera` | `CameraGet` |
| `commbus_call`, `commbus_listen` | `CallCommBusEvent`, and `SubscribeToCommBusEvent` |
| `frames` | `SubscribeToSystemEvent` for `Frame` |
| `cx.module().feed(routine, slot)`, `.end(routine)` | `SetClientData` on the routine's slot, [below](#its-slots) |
| `world_map(request)` | A `unit` message to the menu script ([the protocol](02-clients-and-panel-bridge.md#the-protocol)), answered with the call's handle; the requests are [6.7](../architecture/plan.md#67-the-session)'s |

- A feature's call is a call to the sim service, which the kernel runs once the feature's handler has returned ([hooks](01-loop-and-edge.md#hooks)), and its handle comes from the kernel's counter at once ([timers, jobs, and IDs](01-loop-and-edge.md#timers-jobs-and-ids)).
- A call made while the sim is closed is answered at once with an error.
- `H:` events aren't on the list: whether the profile engine fires them through SimConnect's client events or through our module is [6.9](../architecture/plan.md#69-sync)'s ([left open](../architecture/01-spine.md#left-open)).

### Connections

- While the platform's connection is closed, the sim service asks the edge every 2s to open it and to look for the sim's process, as FS Copilot tries again every 2s ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
- A connection lost while the sim's process runs, the platform's or a feature's, opens again at once, and its feature hears the loss, since its objects went with it ([a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load)).
- As a load starts, the profile unloads, and the sim service ends each feature's routines and then closes its connection (same section).

### What the platform's connection holds

At `S_OK`, before the sim's open reply, whose wait the calls made in it survive ([the core](../architecture/01-spine.md#the-core)), the platform's connection:

- takes masking group A, as [the spine](../architecture/01-spine.md#components-with-no-session) has it;
- subscribes to `AircraftLoaded`, `FlightLoaded`, `Pause_EX1`, and the flow events, and asks `RequestSystemState` for `Sim` and `AircraftLoaded`;
- maps `CROSSCHECK_MODULE_STATUS`, and requests it `ON_SET`;
- starts the [announcement](#the-announcement).

## Sim awareness

```rust
// a sketch
pub enum Signal<'a> {
    Process(Process), Opened, OpenFailed, OpenReply, Quit, Lost,
    AircraftLoaded(&'a str), FlightLoaded(&'a str), Pause(u32), Flow(Flow),
    SimState(i32), AircraftState(&'a str), Page(MenuPage),
}

pub struct SimAwareness {
    pub stage: Stage,                 // Closed, Starting, Menu, Loading, ReadyToFly, Flying
    pub page: MenuPage,               // the menu script's last report, or Unknown
    pub aircraft: Option<Aircraft>,   // its folder and preset
    pub pause: Pause,                 // Pause_EX1's flags
    pub run: Option<SimRun>,          // the sim process's ID and creation time
    pub ended: Option<Ending>,        // Quit or Crash, for the run that ended last
    pub loads: u32,                   // loads in this run
}

impl SimAwareness {
    pub fn step(&mut self, signal: Signal) -> bool;   // true when the state changed
}
```

The stage, the page, and the aircraft are types of the message crate, since the clients show them; which the apps show is [6.16](../architecture/plan.md#616-the-apps)'s.

### Stages

| Stage | Entered on | From |
| --- | --- | --- |
| Closed | The quit message on the platform's connection, or the run's end, [below](#a-crash-and-a-close) | Any |
| Starting | The sim's process found, or `SimConnect_Open` returning `S_OK` | Closed |
| Menu | `Sim`'s answer of 0 after the open reply, `FLIGHT_END`, or `BACK_TO_MAIN_MENU` | Starting, Loading, Ready to fly, Flying |
| Loading | `FlightLoaded` or `FLT_LOAD` | Menu, Flying |
| Ready to fly | `RTC_START` | Loading |
| Flying | `RTC_END`, or `Sim`'s answer of 1 after the open reply | Ready to fly, Starting |

- Every other signal leaves the stage as it is: a second `FLT_LOAD` inside a load, `FLT_LOADED`, `FLIGHT_START`, and a teleport among them.
- p08 heard `FlightLoaded`, then `FLT_LOAD`, then at `FLIGHT_START` a second `FLT_LOAD` and `RTC_START`, and `RTC_END` 57.7s later when the pilot pressed Ready to fly ([core log][signals]).
- A Restart also reached Ready to fly: the Baron's values settled 44.8s after Ready on a Restart (measured on MSFS 2024, 2026-10-05, [sync log](../sync/log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads)).
- The sim sent `FLIGHT_END` and `BACK_TO_MAIN_MENU` 4s after the prompt to leave the flight (measured on MSFS 2024, 2026-10-08, [interface log][coverage]).

### The aircraft

- The aircraft is the last `AircraftLoaded` path heard while Loading.
  One heard in any other stage changes nothing: the main menu's own aircraft, which p08 heard twice ([core log][signals]), or one from Developer Mode's Aircraft Selector, which Crosscheck doesn't support (user, 2026-10-15).
- The engine lowercases the path, turns `\` into `/`, keeps what follows `simobjects/airplanes/`, and drops a final `config/aircraft.cfg` or `aircraft.cfg`.
  So the PA-24's `SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG` becomes `pa24-250/presets/a2a/pa24-250`, whose first part is the folder ([02-02](../../learn/foundations/02-02-aircraft.md#how-an-aircraft-is-identified)).
- So the A350's two reports of one load, 1ms apart, one relative and mixed-case and one absolute and lowercase (same chapter), name one aircraft, and a profile's preset path, compared ignoring case, matches it ([the aircraft and its variants](../profiles/01-format-and-delivery.md#the-aircraft-and-its-variants)).
- The path names the preset on the PA-24 and the A350 (same chapter), so the core reads the preset from it, not from `A:TITLE`, which a profile would have to list and which carries the livery in an aircraft that isn't modular (same chapter; user, 2026-10-15).
  The sim service reads `A:TITLE` once each load reaches Flying, and logs it beside the path.
- A path with no `simobjects/airplanes/` in it gives no aircraft, and the sim service logs it.

### The moment

- The sim service raises `SimChanged`, which carries the state before, once for each step that changes the state, so a load is one entry into Loading, however many signals it brings.
- A feature reads the state through `cx.read::<SimAwareness>()`.

### Connecting to a sim in a flight

- A system event reports only what happens after the subscription ([04-02](../../learn/foundations/04-02-events.md#system-events-and-state)), so the stage stays Starting until `Sim` answers: 0 is Menu, and 1 is Flying with `AircraftLoaded`'s answer for its aircraft, as one load.
- The SDK says `Sim` is 1 while the user controls the aircraft and 0 in the menus, and nothing of ours has read it (same section).
  If it misreads, the menu script's master page tells a flight from the menu, `MasterPage_InGame` against `MasterPage` (measured on MSFS 2024, 2026-10-06, [interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).

### A crash and a close

- A run ends as a quit when the sim's quit message arrives on the platform's connection, and the stage goes to Closed at once, since the sim is going.
- It ends as a crash when, with no quit message before it, the sim's process exits, or, with no process held, a lost connection is followed by an open that fails.
  Every sim crash in our aircraft harness closed SimConnect's connection with no quit message before it ([core log][crashes]).
- A connection lost while the process runs ends nothing: the sim service opens it again.
- The exit code goes in the log either way, and the session's notice to the crew reads `ended` ([a sim that closed](../sync/04-order-and-recovery.md#a-sim-that-closed)).
- No run of ours has recorded a clean close, which SimConnect announces with `SIMCONNECT_RECV_ID_QUIT` (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`) and FS Copilot's managed wrapper reports as `OnRecvQuit` when the sim closes ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
  If node 7's test finds a clean close sends none, the exit code decides instead, since the edge already holds the process (user, 2026-10-15).

## Our WASM module

### Its slots

| Slot | Created by | Written by | Holds |
| --- | --- | --- | --- |
| `CROSSCHECK_MODULE_STATUS` | The module, with `SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY` | The module | A magic number; this slot's layout number, which never changes; the module's version; the slots hash; and the counter |
| `CROSSCHECK_ROUTINE_<ID>` | The module | The sim service | A header of the feed count (`u32`), the end mark (`u32`), and the slots hash (`u64`), then the routine's struct |

- The module creates every slot in `module_init`, as fsc-editor's and p08's modules create theirs (read in fsc-editor, `link/src/module.cpp`, `module_init`, and `experiments/areas/architecture/flight/module/src/lib.rs`), and subscribes to each routine's slot `ON_SET`.
- The read-only flag lets "only ClientData creator" write the status slot (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`).
- The module counts seconds on WASI's monotonic clock, which counted `QueryPerformanceCounter`'s ticks in a flight ([architecture log][flight]), and raises its counter once a second.

### A module from another build

- The slots hash is a hash of the slot structs alone, which the build computes as it computes the message crate's ([versions](../architecture/01-spine.md#versions)), so a change to a WebSocket message leaves it as it was, and a developer needn't restart the sim for one.
- The routine host ignores a feed whose header carries another slots hash, so no routine runs on a struct laid out by another build, which it would read in place ([messages and their types](../architecture/01-spine.md#messages-and-their-types)) and could turn into wrong values written into the pilot's aircraft (user, 2026-10-15).
- The sim service compares the status slot's hash with its own, and when they differ, logs both versions and reports the module as differing, as [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md#a-client-whose-version-differs) logs a client whose version differs.
- The watcher updates our package only while the sim is closed ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so we expect a module from another build to mean a developer's stale package (inference).

### Wants and the sim's APIs

| Want | API | Evidence |
| --- | --- | --- |
| Read an `A:` variable, of the pilot's aircraft or of an object by its ID | `fsVarsAVarGet` | p12 read both in the sim (read in `experiments/areas/avatars/wasm/src/follow.cpp`, `read_pose`) |
| Write an `A:` variable | `fsVarsAVarSet` | p12 wrote another object's pose each frame (same file, `write_pose`); on the pilot's own aircraft, unrun |
| Read or write an `L:` or `Z:` variable | `fsVarsLVarGet`, `fsVarsLVarSet`, `fsVarsZVarSet` | p08 and p12 ran them in the sim (same file; `experiments/areas/architecture/flight/module/src/lib.rs`) |
| Freeze the pilot's aircraft | The three `A:IS ... FREEZE ON` flags through `fsVarsAVarGet`, and `fsEventsTriggerKeyEvent` with `KEY_FREEZE_LATITUDE_LONGITUDE_SET`, `KEY_FREEZE_ALTITUDE_SET`, and `KEY_FREEZE_ATTITUDE_SET` | Unrun; FS Copilot's module sends the same events as calculator code (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_control`) |
| Run calculator code, for a plugin | `execute_calculator_code` | Ran on MSFS 2024 on 2026-08-25 ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)) |

- The routine host looks each ID up once, through `fsVarsGetAVarId`, `fsVarsGetLVarId`, `fsVarsRegisterZVar`, and `fsVarsGetUnitId`, and keeps it.
  It forgets them all when the handler it registers with `fsVarsRegisterVarsStatusUpdateHandler` reports a `REMOVE` or a `RESET`, which fsc-editor's module heard on an aircraft change (measured on MSFS 2024, 2026-08-27, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The typed variable API works, and the sim announces invalidation").
- `fsEventsTriggerKeyEvent` takes an event's number, which bindgen generates from the SDK's `MSFS_EventsEnum.h` (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h` and `Types/MSFS_EventsEnum.h`), so the module needs no table of names for the freeze.
- SDK 1.7.3 marks `execute_calculator_code` deprecated, "Panels API is now deprecated" (read in `WASM/include/MSFS/Legacy/gauges.h`), and nothing else runs calculator code ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)), so it carries only a plugin's.
- A later want that fires an `H:` event has `fsEventsRegisterHEvent`, which takes the event's name, and `fsEventsHEventCall` (read in `MSFS_Events.h`).
- If node 7's tests in the sim find that `fsVarsAVarSet` doesn't hold the pilot's own aircraft's pose, or that `fsEventsTriggerKeyEvent` doesn't freeze it, calculator code carries that want, as FS Copilot's module writes its pose and its freeze (read in `wasm_module.cpp`, `apply_physics` and `apply_control`), and no routine changes.

### Each frame

In `Update_StandAlone`, the module:

1. calls `SimConnect_CallDispatch`, as fsc-editor's, p08's, and p12's modules do at the top of each update, and copies each slot delivered into the routine host;
2. drops each routine whose end mark arrived or that has gone 1s with no write, and makes a routine new at its first feed after that;
3. runs each live routine's frame, collecting its wants;
4. reads the three freeze flags, freezes the aircraft while any routine asks and it isn't frozen, and unfreezes it, if it froze it, once none asks;
5. makes the writes, once every routine's frame has run;
6. writes its status slot, once a second has passed since the last.

### Through a flight load

- The routine host takes nothing up after a load but its IDs, after the `RESET`:
  - The slots outlive the clients that created them, for the rest of the sim's run ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)).
  - The module's own connection carried it through p08's load ([architecture log][flight]).
  - Each routine starts new at its first feed after the load ([routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module)).
- Nothing feeds it through the load, since the profile unloads as the load starts, and the sim service ends every routine first.
- p08's round trips through the module reached 2.8s during the load ([architecture log][flight]), and the sim service judges the counter only in Flying, so a still counter through a load counts for nothing.

### The module's status

| Status | When |
| --- | --- |
| Missing | No write to the status slot 3s after the sim's open reply |
| Differs | Its slots hash isn't the core's |
| Running | Its counter moves |
| Stopped | Its counter has been still for 3s, in Flying, with no pause and a routine live |

- On Stopped, the sim service unfreezes the aircraft through its own connection, as the code map's [when the module stops](../architecture/02-code-map.md#when-the-module-stops) has it.
- "A routine live" takes the place of the code map's "in a session", since the session sits above the sim service, which can't read it, and a module with no routine live froze nothing.
- How the pilot sees a module that's missing, differs, or stopped is [6.16](../architecture/plan.md#616-the-apps)'s.

## The announcement

- The platform's connection calls `SimConnect_CallCommBusEvent` with `CROSSCHECK_CORE_ANNOUNCE`, `SIMCONNECT_COMM_BUS_BROADCAST_TO_JS`, and a JSON body, such as `{"port":51234,"session":false}`, a type of the message crate ([page-client](02-clients-and-panel-bridge.md#page-client)).
- It calls it every 2s from `S_OK`, and at once when the session crate calls `sim_service::announce(cx, session)` as a session starts or ends; the port is the clients crate's.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [sim seam's budgets](../architecture/02-code-map.md#the-sim-seams-budgets) and [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| Closed, after the sim's process exits | Within 100ms |
| Closed, with no process held | Within 2s of the loss, one failed open |
| The platform's connection | Open within 2s of the sim taking connections |
| The announcement | Within one input of the session crate's call |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- p08's recorded signals ([core log][signals]) raise one Loading, one Ready to fly, and one Flying, with the PA-24's folder and preset, and the main menu's two `AircraftLoaded` raise nothing.
- The A350's two paths for one load name one aircraft.
- A connection to a sim in a flight raises one load, into Flying.
- The quit message, then the process exiting, ends the run as a quit; the process exiting with no quit message ends it as a crash; a loss with no quit message, then an open that succeeds, changes no stage, and each feature hears its own connection's loss.
- A feed whose slots hash differs runs no routine, and the sim service reports the module as differing.
- The counter still for 3s in Flying, unpaused, with a routine live, unfreezes the aircraft; still while Loading, while paused, or with no routine live, it does nothing.
- After a `RESET`, `Figure`'s `Z:` writes still land.

In the sim:

- Closing the sim from its menu sends the quit message before its process exits.
- Killing the sim: which of a failed call, the quit message, and the process's exit reaches the edge first, and how soon.
- A second flight load in one run of the sim: the module's own connection and its slots carry on, and `Follow` starts new at its first feed.
- `fsVarsAVarSet` holds the pilot's own aircraft's pose, and `fsEventsTriggerKeyEvent` freezes and unfreezes it.
- `Sim` answers 1 to a connection made in a flight.
- A Marketplace aircraft's path names its folder and preset, and each of the L-1011's four presets gives a path of its own ([L-1011 study](../aircraft/inibuilds-l1011/study.md), sim question 13).
- A connection's event wakes the edge within the 1ms budget without the 2ms timeout.

## Left open

- The Microsoft Store edition's process name, since our runs used the Steam edition; with no process found, the core still opens SimConnect, and a failed open ends a run.
- Whether `Pause_EX1` reports each pause on MSFS 2024, which forum reports doubt ([02-03](../../learn/foundations/02-03-the-running-sim.md#the-sim-loop)); the module's Stopped status and its unfreeze lean on it.
- A connection made during a load or on the Ready to fly screen, where what `Sim` answers is unknown.
- `module_init` also runs "after sign-in", so it may run twice in one run of the sim ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)); whether a second run finds its slots already created is unverified.

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[signals]: log.md#2026-10-15-two-of-the-three-aircraftloaded-our-client-heard-around-a-flight-load-came-in-the-main-menu
[crashes]: log.md#2026-10-15-every-sim-crash-our-aircraft-harness-saw-closed-simconnects-connection-with-no-quit-message-before-it
[coverage]: ../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel
