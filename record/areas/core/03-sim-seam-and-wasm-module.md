# Core: the sim seam and our WASM module

```text
Purpose:     How the core reaches the sim and knows what it's doing, and how our WASM module runs the routines features feed it.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, 02-clients-and-panel-bridge.md, ../architecture/decisions.md, log.md
Decides:     The sim edge's thread and its inputs, the sim's process among them; the sim client's and the sim service's interfaces; sim awareness's stages and its one moment, and that it's an engine; how the core tells a crash from a close, and which aircraft and preset loaded; our WASM module's slots, its status, and what happens to a module from another build; which of the sim's APIs carries each want; the module through a flight load; the core's announcement; and the budgets (node 6.3).
```

> **Note**
> Since 2026-10-16, a watch, a camera read, or `frames` in [what a feature calls](#what-a-feature-calls) can be declared `.unrecorded()` by a unit registered as partly recorded, and the sim service hands the edge each such request's connection, kind, and ID before the call goes out, so the recording leaves out its answers; the sim service decides nothing on such an answer beyond routing it to its feature. Each unit numbers its own connections, by its place in the registry and its own count of opens, and the sim service drops an input for a connection it hasn't opened, as it does one for a connection it closed ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#unrecorded-inputs)).
>
> Since 2026-10-16, [the session's units](../session/02-units.md) changes this document in three places:
>
> - The sim service reads, as a job, the flight file each `FlightLoaded` names, and gives sim awareness its `[Departure]` section's airport, stand name, and stand number as a signal of its own, beside the signals in [sim awareness](#sim-awareness), since the session crate and Go to both read it ([preflight](../session/02-units.md#preflight)).
> - The `world_map` requests in [what a feature calls](#what-a-feature-calls) are `free_flight`, `departure_airport`, `departure_stand`, and `departure_runway` ([the menu script](../session/02-units.md#the-menu-script)).
> - In a session, the menu script reads the page every 500ms and reports a change, beside its report when its socket joins in [leaving Starting](#leaving-starting).
>
> Since 2026-10-16, [the sync units](../sync/05-units.md#reaching-the-sim) changes this document in three places:
>
> - `key` sends with SimConnect's legacy call when the event carries one value or none, and with `_EX1` only when it carries more, where [what a feature calls](#what-a-feature-calls) always sends `_EX1`.
> - The sim service gains `listen(event)`, which maps the event, adds it to a group that never masks, and gives the group the highest priority.
> - State sync fires `H:` events from a routine of its own, `HEvents`, and the routine host carries that want with `fsEventsRegisterHEvent` and `fsEventsHEventCall`, a row [wants and the sim's APIs](#wants-and-the-sims-apis) lacks, which settles what a feature calls' line on `H:` events ([`H:` events](../sync/05-units.md#h-events)).
>
> Since 2026-10-17, [flight-model sync](../flight-model/01-flight-model-sync.md#what-this-adds-to-our-wasm-module) changes this document in four places:
>
> - A routine slot's header also carries the core's counter at the write, in µs, after the slots hash in [its slots](#its-slots), and the routine host's `Frame::now` is its estimate of the core's counter ([the core's counter in our module](../flight-model/01-flight-model-sync.md#the-cores-counter-in-our-module)), where the module reads WASI's monotonic clock only to count its status slot's seconds.
> - The module also creates a report slot, `CROSSCHECK_REPORT_` and the routine's ID, read-only, for each routine that reports, and a feature requests it through `cx.module().reports(routine)`, beside the calls in [what a feature calls](#what-a-feature-calls), which a partly recorded unit may declare `.unrecorded()`.
> - [Wants and the sim's APIs](#wants-and-the-sims-apis) gains a report, through `SimConnect_SetClientData` on the module's own connection, and events with values, through `fsEventsTriggerKeyEvent` with its values.
> - The sketch in [what a feature calls](#what-a-feature-calls) has flight-model sync watch the pose each sim frame once a profile loads; it feeds its routine `Lead` instead, which reads the pose in the module, and loads no profile.
>
> Since 2026-10-17, a `watch` and a `key` in [what a feature calls](#what-a-feature-calls) can name an object by its ID rather than the pilot's aircraft, as avatars watches `SIMCONNECT_OBJECT_ID_USER_AVATAR` on foot and freezes each figure it creates; and the figure's SimObject title is `CROSSCHECK_FIGURE_PILOT`, of the kind `FIGURE` ([avatars](../avatars/01-avatars.md#names)).
>
> Since 2026-10-17, [traffic and ATC's design](../traffic-atc/01-traffic-and-atc.md) changes this document in four places:
>
> - [What a feature calls](#what-a-feature-calls) gains `poll(type, radius)`, one `SimConnect_RequestDataOnSimObjectType` for each call under a request ID of its own, which a partly recorded unit may declare `.unrecorded()`, as 6.6 asked ([polling](../traffic-atc/01-traffic-and-atc.md#polling)).
> - It also gains `release(object)`, for `SimConnect_AIReleaseControl` on an object the feature created.
> - A `watch` takes a period of once, which reads an object's variables one time, as traffic reads each new object's identity; such a watch reuses one definition for its names, and the sim client doesn't make it again on a new connection, where [the sim client](#the-sim-client) makes every setup call again.
> - Traffic's copies are written each frame by its routine `Traffic`, so traffic's connection makes a few calls a second, and the 4,096 packet IDs [its thread](#its-thread) keeps for each connection hold far more than the 1s it gives them.
>
> Since 2026-10-17, v1 has no plugins, so the routine host runs no `Mechanisms` routine and carries no want for calculator code, and [wants and the sim's APIs](#wants-and-the-sims-apis) loses `execute_calculator_code`'s row ([plugins and the sandbox](../plugins/01-plugins.md#no-plugins-in-v1)).
> Since 2026-10-17, the sim service registers a slice of client state holding sim awareness's stage, page, aircraft, pause, and how the last run ended, and the module's status, and raises a trouble notice while any routine is fed and the module is Missing, Differs, or Stopped, cleared when it runs or no routine is fed; which of the slice the apps show is the apps' design, which settles what [sim awareness](#sim-awareness) and [the module's status](#the-modules-status) leave to 6.16 ([the apps](../interface/01-apps.md#trouble)).
> Since 2026-10-18, the sim service also reads the sim's packages folders from `UserCfg.opt`, for the session crate's search too; at the core's start and each time it finds the sim's process, it searches other packages' `layout.json` for the paths ours lists outside our own folders and raises a warning notice for each package found, and checks our own package, raising a trouble notice when it's missing, at another version, or off in the sim ([installing and updating](../install/01-installing-and-updating.md#the-checks-in-the-core)).
>
> Since 2026-10-18, the sim service also holds the loaded aircraft's facts, aircraft awareness, beside sim awareness's aircraft path in [the aircraft](#the-aircraft) (user, 2026-10-18):
>
> - The package that holds the aircraft's folder, its folder on disk, where it's installed (`Community`, `Community2024`, an `Official` folder, or `StreamedPackages`), its `package_version` where its `manifest.json` has one, and the livery, `A:LIVERY NAME`.
> - A job finds the package in the packages folders the sim service reads from `UserCfg.opt`, as [the session's match check](../session/02-units.md#the-match-check) had the session crate's job find it, while a session is held: at each aircraft load, and when a session starts with an aircraft already loaded, since every v1 reader is in a session.
> - The sim service raises `AircraftChanged` when those facts change, the search's result included, and the match check's items and avatars' model job read them there, so no feature takes the aircraft's package from another's key.
>
> Since 2026-10-18, the module's status of Missing or Differs and the sim service's check of our package on disk raise one trouble notice for our package, where [the module's status](#the-modules-status) and the note of 2026-10-17 raise one for the module apart from the package's; Stopped keeps its own (user, 2026-10-18).

The core reaches the sim through one thread at its edge, which holds every SimConnect connection and watches the sim's process, and everything that thread hands up is parsed on the loop.
Sim awareness, an engine of its own, turns the sim's signals into six stages, and the sim service raises one moment, `SimChanged`, for each change, so a load is one entry into Loading however many signals the sim sends.
A crash is a sim whose process ends with no quit message before it, and the loaded aircraft is the folder and preset in the path `AircraftLoaded` reports.
Our WASM module runs a routine only on feeds from its own build, which it tells by the slots hash, and carries each want through the sim's `fsVars` and `fsEvents` APIs, with calculator code only for a plugin's calculator code.

This answers node 6.3 of the [architecture plan](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module).
The code map's [sim seam](../architecture/02-code-map.md#the-sim-seam), [work in the sim](../architecture/02-code-map.md#work-in-the-sim), and [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares), the spine's [sim awareness](../architecture/01-spine.md#sim-awareness), [01-loop-and-edge](01-loop-and-edge.md), and [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `sim-edge` | Engine | One thread holding every SimConnect connection and the sim's process: it makes each call, tags each exception, and hands up each message, open, loss, and change of the process as an input | Off the loop, in the core and the IDE |
| `sim-client` | Engine | For each connection: its IDs, the calls that set it up, which it makes again on a new connection, and a feature's call turned into SimConnect's calls | On the loop, and in the IDE |
| `sim-awareness` | Engine | One step function from a sim signal to the sim's state, with no clock and no I/O | On the loop, on the bench, and in the IDE |
| `sim-service` | Platform | The connections, the calls features make, routines' feeds, the module's status and the unfreeze, the masking group, the announcement, and the world map's requests; it raises `SimChanged` | On the loop |
| `routine-host` | Platform, outside the core | Routines, their slots and wants, the freeze, and the module's status slot | In our WASM module, and natively on the bench |
| `sim-package/wasm-module` | Sim package | The module's edge on the sim's APIs, and the list of routines | In the sim |

Sim awareness is an engine so that the IDE can link it, as it links the sim client, rather than work out the sim's state again, as fsc-editor did on every `AircraftLoaded` (read in fsc-editor, `src/main/sim/session.ts`, `aircraftChanged`), and so that the bench can feed it recorded signals with nothing else running (user, 2026-10-15).

## The edge

### Its thread

- One thread, the sim thread of [01-loop-and-edge](01-loop-and-edge.md#threads), holds every connection's handle, as the code map's edge requires.
- It waits in `WaitForMultipleObjects` on each connection's event, the one it passes to `SimConnect_Open`, on the sim's process, and on an event that the loop's sink for `SimCall` sets when it queues calls.
  It waits at most 2ms, so the edge still reads a connection whose event never fires, because the SDK says only that a client "can be written to respond to Windows Events" ([SimConnect_Open](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/General/SimConnect_Open.htm)), not when the sim signals one.
  p08's client waited the same way through a flight (read in `experiments/areas/architecture/flight/client/src/main.rs`; [architecture log][flight]).
- On each wake it makes the queued calls in their order, then takes each connection's messages through `SimConnect_GetNextDispatch` until none is left.
- After each call it reads `SimConnect_GetLastSentPacketID`, and keeps each packet ID with its call's handle for the last 4,096 calls on each connection, about 1s of writes while traffic writes 132 injected objects every frame at 32.5 fps, 4,290 a second (arithmetic, from [04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
  An exception whose packet ID it holds goes up tagged with that handle.

### Its inputs

Four kinds of input come up through the seam, each stamped and recorded ([inputs](01-loop-and-edge.md#inputs)):

| Input | Carries |
| --- | --- |
| A message | The connection's number, and the record SimConnect handed over, copied whole, with its call's handle when it's an exception whose packet ID the edge holds |
| An open | The connection's number, and `SimConnect_Open`'s result |
| A loss | The connection's number, after a call on it returned an error |
| The sim's process | Found, with its ID and creation time; or exited, with its exit code |

- The code map also counts the quit message and a failed dispatch as a loss, and the edge raises neither as one:
  - The quit message comes up as a message, and the sim service takes it as its connection's loss.
  - A failed dispatch raises nothing: p08's client took any result of `SimConnect_GetNextDispatch` but `S_OK` to mean no message was left (read in `experiments/areas/architecture/flight/client/src/main.rs`), and whether a failure returns anything else is unverified.
- The sim's process is the fourth kind, beside the three the code map names.
  It gives the session file the run of the sim, which the spine names by the process's ID and creation time ([IDs](../architecture/01-spine.md#ids)), and it ends a run of the sim even when SimConnect reports nothing.
- How a crash reaches a `SimConnect.dll` connection, as a failed call or as nothing until the process is gone, is unmeasured, and node 7's test that kills the sim shows which comes first.

### The sim's process

- While it holds no process, the edge looks for one each time the sim service asks ([connections](#connections)): it walks a `CreateToolhelp32Snapshot` of the processes for `FlightSimulator2024.exe`, ignoring case.
  That's the name the Windows Application log gave each sim that crashed in our aircraft harness, on the Steam edition ([crashes.tsv](../../../experiments/areas/aircraft/results/crashes.tsv)), and the name a pilot's crash report gave the Microsoft Store edition, under `C:\Program Files\WindowsApps\Microsoft.Limitless_1.0.77.0_x64__8wekyb3d8bbwe` (unverified, a forum post: [CTD always on startup](https://devsupport.flightsimulator.com/t/ctd-always-on-startup/10774)).
- It opens the process with `PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE`, reads its creation time with `GetProcessTimes`, hands both up, and waits on the process with its connections.
- When the process ends, it hands up `GetExitCodeProcess`'s code, which for a crash is "the exception value for an unhandled exception that caused the process to terminate" (documented, [GetExitCodeProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess)), for the log.

## The sim client

- **Calls:** `SimCall`, the output type the edge carries out, has a variant for each SimConnect function our code calls, with its arguments owned, so the edge maps each variant to one call, and the stand-in sim answers each ([node 7](../architecture/plan.md#7-testing)).
- **IDs:** each connection counts its definitions, requests, client events, groups, and client data from 1, on the loop, so a replay hands out the same.
- **Setup:** it keeps, in order, each call that set something up on a connection, and makes them all again on that connection's next open, as FS Copilot keeps a list of setup actions for each connection ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
- **Watches:** a watch's datum IDs are its names' places in it, so each tagged value names its variable; a number is `FLOAT64`, and a string `STRING256`.
- **`B:` names:** at a connection's first `B:` name, it enumerates the input events, holds the connection's `B:` calls until the list is whole, then makes each by its hash, as fsc-editor's cycle does ([04-02](../../learn/foundations/04-02-events.md#the-input-events-api)); a name not on the list answers its call with an error.

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

- Every 2s, the sim service asks the edge to look for the sim's process while it holds none, and to open the platform's connection while it holds a process whose run hasn't ended and that connection is closed, as FS Copilot tries again every 2s ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
- So after the quit message, it opens nothing until that process has exited and another is found.
  A sim that is shutting down may still return `S_OK` (unverified), and `S_OK` came 46s before the open reply as the sim booted ([architecture log][flight]), so the core couldn't tell that connection from one to a sim starting up.
- A connection lost while its run hasn't ended, the platform's or a feature's, opens again at once, as [a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load) has it.

### What the platform's connection holds

The platform's connection makes these calls at `S_OK`, without waiting for the sim's open reply, because in p08 the calls made before the reply took effect ([the core](../architecture/01-spine.md#the-core)):

- takes masking group A, as [the spine](../architecture/01-spine.md#components-with-no-session) has it;
- subscribes to `AircraftLoaded`, `FlightLoaded`, `Pause_EX1`, and the flow events, and asks `RequestSystemState` for `AircraftLoaded`;
- maps `CROSSCHECK_MODULE_STATUS`, and requests it `ON_SET`;
- starts the [announcement](#the-announcement).

## Sim awareness

```rust
// a sketch
pub enum Signal<'a> {
    Process(Process), Quit,
    AircraftLoaded(&'a str), AircraftState(&'a str), FlightLoaded,
    Flow(Flow), Pause(u32), Page(MenuPage),
}

pub struct SimAwareness {
    pub stage: Stage,                 // Closed, Starting, Menu, Loading, ReadyToFly, Flying
    pub page: MenuPage,               // the menu script's last report, or Unknown
    pub aircraft: Option<Aircraft>,   // its folder and preset
    pub pause: Pause,                 // Pause_EX1's flags
    pub run: Option<SimRun>,          // the sim process's ID and creation time
    pub ended: Option<Ending>,        // Close or Crash, for the run that ended last
}

impl SimAwareness {
    pub fn step(&mut self, signal: Signal) -> bool;   // true when the state changed
}
```

The stage, the page, and the aircraft are types of the message crate, since the clients show them; which the apps show is [6.16](../architecture/plan.md#616-the-apps)'s.

### Stages

| Stage | Entered on | From |
| --- | --- | --- |
| Closed | The quit message on the platform's connection, or the sim's process exiting, [below](#a-crash-and-a-close) | Any |
| Starting | The sim's process found | Closed |
| Menu | `BACK_TO_MAIN_MENU`, or the menu script's master page `MasterPage` | Any but Closed |
| Loading | `FlightLoaded` | Starting, Menu, Flying |
| Ready to fly | `RTC_START` | Starting, Loading |
| Flying | `RTC_END`, or the menu script's master page `MasterPage_InGame` | Starting, Ready to fly |

- The master page counts only while Starting ([leaving Starting](#leaving-starting)).
- Every other signal leaves the stage as it is, among them `FLT_LOAD`, `FLT_LOADED`, `FLIGHT_START`, `FLIGHT_END`, and a teleport.
- p08 heard `FlightLoaded`, then `FLT_LOAD` three times through the load, `RTC_START`, and `RTC_END` 57.7s later, when the pilot pressed Ready to fly ([core log][signals]).
- A Restart from the pause menu sent `FlightLoaded`, then `FLIGHT_END` 72ms later, then `FLT_LOAD`, and later `RTC_START` and `RTC_END` ([core log][sim-state]), so `FLIGHT_END` moves no stage, and a Restart is one load.
- The sim sent `BACK_TO_MAIN_MENU`, with `FLIGHT_END`, 4s after the prompt to leave the flight (measured on MSFS 2024, 2026-10-08, [interface log][coverage]).

### The aircraft

- The aircraft is the last `AircraftLoaded` path heard while Loading.
  One heard in any other stage changes nothing: the main menu's own aircraft, which p08 heard twice ([core log][signals]), or one from Developer Mode's Aircraft Selector, which Crosscheck doesn't support (user, 2026-10-15).
- When Starting gives way to Ready to fly or Flying, the aircraft is the `AircraftLoaded` state's answer, which the platform's connection asked for at `S_OK`.
- The engine lowercases the path, turns `\` into `/`, keeps what follows `simobjects/airplanes/`, and drops a final `config/aircraft.cfg` or `aircraft.cfg`.
  So the PA-24's `SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG` becomes `pa24-250/presets/a2a/pa24-250`, whose first part is the folder ([02-02](../../learn/foundations/02-02-aircraft.md#how-an-aircraft-is-identified)).
- So the A350's two reports of one load, 1ms apart, one relative and mixed-case and one absolute and lowercase (same chapter), name one aircraft, and a profile's preset path, compared ignoring case, matches it ([the aircraft and its variants](../profiles/01-format-and-delivery.md#the-aircraft-and-its-variants)).
- The path names the preset on the PA-24 and the A350 (same chapter), so the core reads the preset from it, not from `A:TITLE`, which a profile would have to list and which carries the livery in an aircraft that isn't modular (same chapter; user, 2026-10-15).
  The sim service reads `A:TITLE` once each load reaches Flying, and logs it beside the path.
- A path with no `simobjects/airplanes/` in it gives no aircraft, and the sim service logs it.

### The moment

- The sim service raises `SimChanged`, which carries the state before, once for each step that changes the state, so a load is one entry into Loading, however many signals it brings.
- A feature reads the state through `cx.read::<SimAwareness>()`.

### Leaving Starting

A core stays Starting until the menu script reports its master page, or until `FlightLoaded`, `RTC_START`, or `RTC_END` arrives, whichever way it found the sim:

- It found the sim booting, and between `S_OK` and the first `FlightLoaded`, p08 heard nothing that marks the main menu ([core log][signals]).
- It connected to a sim already running, after its own restart or when the desktop app started it then, and `AircraftLoaded` reports only what happens after the subscription ([04-02](../../learn/foundations/04-02-events.md#system-events-and-state)).

The menu script reports its master page when the sim service asks, as its socket joins: `MasterPage` in the main menu and `MasterPage_InGame` in a flight (measured on MSFS 2024, 2026-10-06, [interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
The `Sim` state can't tell them apart: it read 1 in the main menu, and again 1s into a load's screen ([core log][sim-state]).
Without our copy of BlurPage, which brings the menu script ([preflight](../product/03-v1-scope.md#preflight)), the core stays Starting until the next load.

### A crash and a close

- A run ends as a close when the sim's quit message, which "Specifies that the user has exited from Microsoft Flight Simulator 2024" (documented, [SIMCONNECT_RECV_ID](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/Structures_And_Enumerations/SIMCONNECT_RECV_ID.htm)), arrives on the platform's connection, and the stage goes to Closed at once.
- It ends as a crash when the sim's process exits with no quit message before it.
  Every sim crash in our aircraft harness closed its node-simconnect connection with no quit message before it ([core log][crashes]); we haven't seen a `SimConnect.dll` connection through a crash.
- A lost connection alone ends no run.
- The exit code goes in the log either way, and the session's notice to the crew reads `ended` ([a sim that closed](../sync/04-order-and-recovery.md#a-sim-that-closed)).
- No run of ours has recorded a clean close; if node 7's test finds one sends no quit message, the exit code decides instead, since the edge already holds the process (user, 2026-10-15).

## Our WASM module

### Its slots

| Slot | Created by | Written by | Holds |
| --- | --- | --- | --- |
| `CROSSCHECK_MODULE_STATUS` | The module, with `SIMCONNECT_CREATE_CLIENT_DATA_FLAG_READ_ONLY` | The module | The module's version, the slots hash, and the counter, in a layout that never changes, so any build reads any other's |
| `CROSSCHECK_ROUTINE_<ID>` | The module | The sim service | A header of the feed count (`u32`), the end mark (`u32`), and the slots hash (`u64`), then the routine's struct |

- The module creates every slot in `module_init`, as fsc-editor's and p08's modules create theirs (read in fsc-editor, `link/src/module.cpp`, `module_init`, and `experiments/areas/architecture/flight/module/src/lib.rs`), and subscribes to each routine's slot `ON_SET`.
- The read-only flag lets "only ClientData creator" write the status slot (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`).
- The module counts seconds on WASI's monotonic clock, which counted `QueryPerformanceCounter`'s ticks in a flight ([architecture log][flight]), and raises its counter once a second.

### A module from another build

- The slots hash is a hash of the slot structs alone, which the build computes as it computes the message crate's ([versions](../architecture/01-spine.md#versions)), so a change to a WebSocket message leaves it as it was, and a developer needn't restart the sim for one.
- The routine host ignores a feed whose header carries another slots hash, so no routine runs on a struct laid out by another build, which it would read in place ([messages and their types](../architecture/01-spine.md#messages-and-their-types)) and could turn into wrong values written into the pilot's aircraft (user, 2026-10-15).
- The sim service compares the status slot's hash with its own, and when they differ, logs both versions and reports the module as differing, as [02-clients-and-panel-bridge](02-clients-and-panel-bridge.md#a-client-whose-version-differs) logs a client whose version differs.

### Wants and the sim's APIs

| Want | API | Evidence |
| --- | --- | --- |
| Read an `A:` variable, of the pilot's aircraft or of an object by its ID | `fsVarsAVarGet` | p12 read both in the sim (read in `experiments/areas/avatars/wasm/src/follow.cpp`, `read_pose`) |
| Write an `A:` variable | `fsVarsAVarSet` | p12 wrote another object's pose each frame (same file, `write_pose`); on the pilot's own aircraft, unrun |
| Read or write an `L:` or `Z:` variable | `fsVarsLVarGet`, `fsVarsLVarSet`, `fsVarsZVarGet`, and `fsVarsZVarSet` | p08 and p12 ran them in the sim (same file; `experiments/areas/architecture/flight/module/src/lib.rs`) |
| Freeze the pilot's aircraft | The three `A:IS ... FREEZE ON` flags through `fsVarsAVarGet`, and `fsEventsTriggerKeyEvent` with `KEY_FREEZE_LATITUDE_LONGITUDE_SET`, `KEY_FREEZE_ALTITUDE_SET`, and `KEY_FREEZE_ATTITUDE_SET` | Unrun; FS Copilot's module sends the same events as calculator code (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`, `apply_control`) |
| Run calculator code, for a plugin | `execute_calculator_code` | Ran on MSFS 2024 on 2026-08-25 ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)) |

- The routine host looks each ID up once and keeps it: an `A:` variable's through `fsVarsGetAVarId`, an `L:` variable's through `fsVarsRegisterLVar`, since `fsVarsGetLVarId` returns -1 for one that doesn't exist yet and doesn't create it, a `Z:` variable's through `fsVarsRegisterZVar`, and a unit's through `fsVarsGetUnitId`.
  It forgets them all when the handler it registers with `fsVarsRegisterVarsStatusUpdateHandler` reports a `REMOVE` or a `RESET`, which fsc-editor's module heard on an aircraft change (measured on MSFS 2024, 2026-08-27, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-27 — The typed variable API works, and the sim announces invalidation", for both).
- `fsEventsTriggerKeyEvent` takes an event's number, and `MSFS_EventsEnum.h` defines the freeze events' numbers (read in MSFS 2024 SDK 1.7.3, `WASM/include/MSFS/MSFS_Events.h` and `Types/MSFS_EventsEnum.h`), so the module needs no table of names for the freeze.
  p08's build generated bindings only from `SimConnect.h` and `MSFS_Vars.h` (read in `experiments/areas/architecture/flight/module/build.rs`), so whether bindgen brings in these numbers is unverified until the module's build adds `MSFS_Events.h`.
- SDK 1.7.3 marks `execute_calculator_code` deprecated, "Panels API is now deprecated" (read in `WASM/include/MSFS/Legacy/gauges.h`), and nothing else runs calculator code ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)), so it carries only a plugin's.
- A later want that fires an `H:` event has `fsEventsRegisterHEvent`, which takes the event's name, and `fsEventsHEventCall` (read in `MSFS_Events.h`).
- If node 7's tests in the sim find that `fsVarsAVarSet` doesn't hold the pilot's own aircraft's pose, or that `fsEventsTriggerKeyEvent` doesn't freeze it, calculator code carries that want, as FS Copilot's module writes its pose and its freeze (read in `wasm_module.cpp`, `apply_physics` and `apply_control`), and no routine changes.

### Each frame

In `Update_StandAlone`, the module calls `SimConnect_CallDispatch` before any routine runs, as fsc-editor's, p08's, and p12's modules call it before their own work with the sim, and copies each slot delivered into the routine host.
The routine host then runs its frame, as the code map's [routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module) and [what a routine can ask for](../architecture/02-code-map.md#what-a-routine-can-ask-for) have it, and the module writes its status slot once a second has passed since the last.

### Through a flight load

- After a load, the routine host looks up its variable and unit IDs again once the `RESET` arrives, and sets up nothing else.
  The slots last for the rest of the sim's run after the clients that created them are gone ([04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits)), and the module's own connection echoed every write through p08's load ([architecture log][flight]).
- p08's round trips through the module reached 2.8s during the load (same entry), and the sim service judges the counter only in Flying, so a still counter through a load counts for nothing.

### The module's status

| Status | When |
| --- | --- |
| Missing | No write to the status slot heard yet |
| Differs | Its slots hash isn't the core's |
| Running | Its counter moves |
| Stopped | Its counter has been still for 3s spent in Flying, unpaused, with a routine live |

- On Stopped, the sim service unfreezes the aircraft through the platform's connection, as the code map's [when the module stops](../architecture/02-code-map.md#when-the-module-stops) has it.
- The 3s count only while all three hold, so an aircraft unpaused after a long pause isn't unfrozen before the module's next write.
- "Unpaused" means `Pause_EX1` reads 0: the pause menu raised 8, active pause and the pilot's pause key 4, and `K:PAUSE_SET` 1 (measured on MSFS 2024, 2026-10-03, [environment log](../environment/log.md#2026-10-03-the-pause-menu-is-the-sim-pause-and-lets-the-clock-run-active-pause-stops-it-and-only-simconnect-raised-a-full-pause)), and whether the module's update runs in each pause is unmeasured ([when the module stops](../architecture/02-code-map.md#when-the-module-stops)).
- "A routine live" takes the place of the code map's "in a session", since the session sits above the sim service, which can't read it, and a module with no routine live froze nothing.
- When the pilot sees a module that's missing, differs, or stopped, and how, is [6.16](../architecture/plan.md#616-the-apps)'s.

## The announcement

- The platform's connection calls `SimConnect_CallCommBusEvent` with `CROSSCHECK_CORE_ANNOUNCE`, `SIMCONNECT_COMM_BUS_BROADCAST_TO_JS`, and a JSON body of the core's port and whether a session runs ([page-client](02-clients-and-panel-bridge.md#page-client)), a type of the message crate, such as a hypothetical `{"port":51234,"session":false}`.
- It calls it every 2s from `S_OK`, and at once when the session crate calls `sim_service::announce(cx, session)` as a session starts or ends; the port is the clients crate's.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [sim seam's budgets](../architecture/02-code-map.md#the-sim-seams-budgets) and [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| Closed, after the quit message or the sim's process exiting | Within 100ms |
| The platform's connection | Open within 2s of the sim taking connections |
| The announcement | Within one input of the session crate's call |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- p08's recorded signals ([core log][signals]), after the sim's process is found, raise one Loading, one Ready to fly, and one Flying, with the PA-24's folder and preset, and the main menu's two `AircraftLoaded` raise nothing.
- The Restart's recorded signals ([core log][sim-state]) raise one Loading, and no Menu.
- The A350's two paths for one load name one aircraft.
- A connection made in the main menu reaches Menu, and one made in a flight reaches Flying with the `AircraftLoaded` state's aircraft, by the menu script's master page.
- The quit message, then the process exiting, ends the run as a close, and nothing opens between the two; the process exiting with no quit message ends it as a crash; a loss with no quit message, then an open that succeeds, changes no stage, and each feature hears its own connection's loss.
- A feed whose slots hash differs runs no routine, and the sim service reports the module as differing.
- The counter still for 3s in Flying, unpaused, with a routine live, unfreezes the aircraft; still while Loading, while paused, with no routine live, or for under 3s since a pause ended, it does nothing.
- After a `RESET`, `Figure`'s `Z:` writes still land.

In the sim:

- Closing the sim from its menu sends the quit message before its process exits.
- Killing the sim: which of a failed call, the quit message, and the process's exit reaches the edge first, and how soon.
- A second flight load in one run of the sim: the module's own connection and its slots carry on, and `Follow` starts new at its first feed.
- `fsVarsAVarSet` holds the pilot's own aircraft's pose, and `fsEventsTriggerKeyEvent` freezes and unfreezes it.
- A Marketplace aircraft's path names its folder and preset, and each of the L-1011's four presets gives a path of its own ([L-1011 study](../aircraft/inibuilds-l1011/study.md), sim question 13).
- A connection's event, not the 2ms timeout, wakes the edge within the code map's 1ms budget ([the sim seam's budgets](../architecture/02-code-map.md#the-sim-seams-budgets)).
- The Microsoft Store edition's process is `FlightSimulator2024.exe`.

## Left open

- `module_init` also runs "after sign-in", so it may run twice in one run of the sim ([05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit)); whether a second run finds its slots already created is unverified.

[flight]: ../architecture/log.md#2026-10-09-in-a-flight-a-rust-client-on-simconnectdll-masks-creates-ai-objects-with-liveries-sets-input-events-reads-the-camera-and-follows-the-load-the-rust-module-echoes-raw-input-gets-a-persons-key-and-button-and-the-modules-clock-counts-the-counters-ticks-from-near-the-sims-start
[signals]: log.md#2026-10-15-two-of-the-three-aircraftloaded-our-client-heard-around-a-flight-load-came-in-the-main-menu
[crashes]: log.md#2026-10-15-every-sim-crash-our-aircraft-harness-saw-closed-simconnects-connection-with-no-quit-message-before-it
[sim-state]: log.md#2026-10-15-the-sim-state-reads-1-in-the-main-menu-and-through-a-loads-screen-and-a-restart-sends-flight_end-inside-its-load
[coverage]: ../interface/log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel
