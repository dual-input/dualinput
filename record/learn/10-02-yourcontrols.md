# Case studies: YourControls

- [YourControls](#yourcontrols)
  - [Processes and what runs where](#processes-and-what-runs-where)
  - [One switch flip](#one-switch-flip)
  - [One position update](#one-position-update)
  - [Design choices and what they cost](#design-choices-and-what-they-cost)
  - [What it changes for Crosscheck](#what-it-changes-for-crosscheck)
  - [Known failures and open problems](#known-failures-and-open-problems)
- [The two tools compared](#the-two-tools-compared)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

FS Copilot's internals are in [10-01-fs-copilot](10-01-fs-copilot.md), and this chapter follows the same outline, so the two can be read side by side.
It describes YourControls at commit 31b1706, version 2.8.16, and its MSFS 2024 package [1].
As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other.
The host is the app that started the session, or on YourControls' Cloud Host, a server process that takes that place.

## YourControls

YourControls is a Rust desktop app on each pilot's PC, a standalone WASM module and a set of panel scripts in its sim package, and a server process that runs its rendezvous and its hosted relay.
The session is a star: every message between two pilots who aren't the host passes through the host.
The host picks the aircraft definition and sends it to each pilot who joins, so every machine runs the host's entries.

### Processes and what runs where

```text
each pilot's PC
  MSFS 2024
    panel documents: YourControls' VCockpit.js, Main.js, and three more scripts
        |                                          | WebSocket per instrument, port 7780
    YourControlsGauge.wasm, a standalone module     |
        | SimConnect: variables, events, and 5 client data areas, such as YCSEND
  YourControls.exe  <------------------------------+
    UI thread: a web view
    main loop, every 10ms: SimConnect, definitions, panel WebSockets, sync
    network thread, every 5ms: laminar over UDP
        +-- a joiner: one link, to the host's app or, on Cloud Host, to the hoster
        +-- the host: one link to each joiner
        +-- yourcontrols-server: rendezvous and hoster, on UDP ports its .env file sets
```

| Piece | Where it runs | What it does | Taught in |
| --- | --- | --- | --- |
| `YourControls.exe` | Each pilot's PC, as one Rust process that runs three threads of its own [1] [2] | Reads and writes the sim through one SimConnect connection, serves the panels' WebSockets, and runs the network | [04-01](04-01-connection-and-data.md#what-it-is), [06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost) |
| `YourControlsGauge.wasm` | Inside the sim, from the `modules` folder of the `YourControls` package [6] | Reads `L:` variables, runs calculator code, freezes the following aircraft, and interpolates its position | [05-01](05-01-kinds-lifecycle-and-apis.md#gauge-vs-standalone-modules-and-the-sandbox), [05-02](05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module) |
| Panel scripts | Inside every panel document, loaded by YourControls' copy of `VCockpit.js` | Report `H:` events, touchscreen clicks, and text entry, and replay the other pilot's | [06-02](06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open) |
| `yourcontrols-server` | A server, as one process with a rendezvous thread and a hoster thread [8] | Hands out session codes, introduces pilots for Cloud P2P, and hosts Cloud Host sessions | [09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching), [09-04](09-04-relays-and-sessions.md#relays-when-theyre-needed-hosting-fan-out-cost) |

Each pass of the main loop drains SimConnect's messages, drains what the network thread passed it, handles one message from the UI, and sends what changed, then sleeps 10ms if the pass took less [1] [3].
The network thread and the main loop talk through channels, and only the main loop touches the sim and the sync state [1] [2].

The module's source isn't in the repository: `src/yourcontrols-gauge` holds only a Rust `Cargo.lock`, and the built module's strings name a C++ file, `YourControlsGauge.cpp` [6].
It exports `module_init` and `module_deinit` and no `Update_StandAlone`, and its only import that can set a variable or fire an event is `execute_calculator_code` [6].

### One switch flip

The pilot in control presses the autopilot button in a Flysimware Cessna 414AW Chancellor, whose definition includes YourControls' autopilot module: a `ToggleSwitch` that reads `A:AUTOPILOT MASTER` and fires `K:AP_MASTER` through calculator code when the two machines disagree [9].
In a two-pilot session hosted by the pilot in control, the message goes straight from the host to the other pilot.

```text
flying machine (the host)                               following machine
[sim] -2 SimConnect-> [main loop] -4 channel-> [network thread] -5 laminar-> [network thread]
  1                        3                                                        |
[sim] <-8 K:AP_MASTER- [module] <-7 YCSEND area- [main loop: ToggleSwitch] <-6 channel+
  |
  +-9 SimConnect report-> [main loop: 1s window drops it]
```

| Hop | Where | What happens | Taught in |
| --- | --- | --- | --- |
| 1 | Flying sim | The sim sets `A:AUTOPILOT MASTER` to 1 | [03-01](03-01-units-and-variables.md#a-simulation-variables) |
| 2 | SimConnect | The app's one data definition, which holds every `A:` entry, reports the change; it's requested every simulated frame with the `CHANGED` and `TAGGED` flags [4] | [04-01](04-01-connection-and-data.md#data-definitions-and-requests) |
| 3 | Flying main loop | Nothing wrote the variable from the network in the last 1s, so the same pass sends it, in the reliable batch because its entry isn't marked `unreliable:` or `interpolate:` [3] [4] | [08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them) |
| 4 | Flying app | The batch becomes an `Update` payload, carrying the sender's name and its clock in Unix seconds, encoded as MessagePack and compressed with zstd [2] | [09-05](09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions) |
| 5 | Network | laminar sends it reliable-ordered on stream 0; from a pilot who isn't the host, the host would also pass it on to every other pilot [2] | [09-02](09-02-transports-and-delivery.md#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation) |
| 6 | Following main loop | The app applies it because the sender isn't an observer and the 3s wait after joining is over, and starts the variable's 1s window [3] [4] | [08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect) |
| 7 | Following main loop | The `ToggleSwitch` sees the local value 0 and the received 1, so it writes `(>K:AP_MASTER)` into the `YCSEND` client data area [4] [5] | [07](07-aircraft-specific-systems.md#control-semantics), [04-03](04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits) |
| 8 | Following module | The module runs it with `execute_calculator_code`, and the sim turns the autopilot on [6] | [05-01](05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements) |
| 9 | Following main loop | SimConnect reports the change inside the 1s window, so the app doesn't send it back [4] | [08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them) |

### One position update

The following aircraft is already frozen.
When a machine loses control, its app sends `1 (>K:FREEZE_LATITUDE_LONGITUDE_SET)` and the matching altitude and attitude events through the module, and a joining machine sends them again whenever the sim's freeze variables disagree with its role [5].

```text
flying machine                                        following machine
[flight model] -1 SimConnect-> [main loop, each pass] -3 laminar-> [main loop]
                                         2                               |
[frozen aircraft] <-5 calculator code- [module: interpolates] <-4 YCSENDINTERPOLATE area
```

| Hop | Where | What happens | Taught in |
| --- | --- | --- | --- |
| 1 | SimConnect | The data definition reports the 13 `master:` entries of the physics module, from `A:PLANE LATITUDE` to `A:VELOCITY WORLD Z`, on each simulated frame they change [4] [9] | [04-01](04-01-connection-and-data.md#data-definitions-and-requests) |
| 2 | Flying main loop | Each pass sends what changed since the last, and puts entries marked `interpolate:` in the unreliable batch [3] [4] | [08-04](08-04-rates-actions-and-flight-controls.md#change-detection-sample-rates-bandwidth-budgets) |
| 3 | Network | laminar sends it unreliable-sequenced on stream 0, stamped with the sender's clock in Unix seconds [2] | [08-05](08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate), [09-02](09-02-transports-and-delivery.md#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation) |
| 4 | Following app | The app takes `master:` entries only from the pilot it holds in control, and writes the sender's time and the values into the `YCSENDINTERPOLATE` client data area [4] [5] | [04-03](04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits) |
| 5 | Following module | The module interpolates and writes each variable, by code that isn't published [6] | [08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact) |

Read from source, position updates leave at most once a simulated frame and at least 10ms apart.
Nobody has measured their actual rate, the delay the module adds, or whether its interpolation needs the two PCs' clocks to agree.

### Design choices and what they cost

**Authority lives with the host.**
The host starts in control.
The pilot in control gives it away with a button or with `K:TOGGLE_LAUNCH_BAR_SWITCH`, a pilot without it takes it with a Take Control button or the same key, and the host can make a pilot an observer, whose updates the other machines ignore [3] [9].
YourControls' documentation describes only giving [10], and the source has both, which we trust for what the build does.
The host tells each joiner who is in control, and each machine takes `master:` entries only from that pilot [2] [3] [4].
When the pilot in control leaves, the host takes control back ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)), and on Cloud Host the hoster hands it to a remaining pilot [8].
Each machine applies its own control change before the host relays it, so two changes that cross can leave the machines disagreeing on who is in control (unverified).

**Replication is a hybrid, with a snapshot on join.**
`A:` and `L:` entries travel as state: `shared:` ones from either machine, `master:` ones from the pilot in control, `server:` ones from the host, and `init:` ones only in the snapshot [4].
`K:` event entries, `H:` events, and touchscreen clicks travel as input; the receiver applies at most one queued event per pass of its main loop, and spaces `H:` events at least 50ms apart [4].
A joiner waits a fixed 3s, then gets every value from the pilot in control and the sim's time ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).
The echo guard is a 1s window for each name after any write from the network, so a pilot's own change to that control inside the window isn't sent (unverified) [4].

**Transport is laminar over UDP, in a star around the host.**
laminar is a Rust library that adds reliable and sequenced delivery to UDP, and YourControls builds a fork of it from Sequal32's GitHub account [1] [2].
Control messages go reliable-ordered on stream 1, and each pass's changes on stream 0, reliable-ordered or unreliable-sequenced [2].
A session starts one of three ways [2] [8] [10]:

- **Cloud P2P:** the rendezvous server gives each side the other's endpoints, and both send handshakes every second, giving up after 5.
- **Cloud Host:** the hoster thread of `yourcontrols-server` plays the host, and the first pilot to arrive gets control.
- **Direct:** the host listens on UDP 25071 by default and asks the router for a UPnP mapping, and the joiner types the host's address.

The link sends a heartbeat every 0.5s and times out after 5s by default [2] [3].
The costs, read from source: every message between two joiners takes two legs through the host, the host's departure ends a session it hosts, nothing encrypts, and a pilot-hosted session admits only the host's exact version string [2].

**Aircraft knowledge is the host's definition, sent to every joiner.**
The host's pilot picks a YAML definition from a list, one file per aircraft, and nothing in the app reads which aircraft the sim loaded (read from source) [3].
The app flattens its included modules into one list and sends it to each joiner, as MessagePack compressed at zstd level 22, and the joiner uses it in place of its own files [2] [3] [4].
Entries come in 12 types, such as `ToggleSwitch`, `NumSet`, and `CustomCalculator`, and most can carry a condition on another variable: the receiver writes the aileron entry as `K:AXIS_AILERONS_SET` only while its own `A:AUTOPILOT MASTER` is false [4] [9].
So both machines always run the same entries, and they run them whether or not both sims loaded the aircraft the file was written for.

**Panel sync runs through a replaced `VCockpit.js` and a WebSocket per instrument.**
One elected document sends each `H:` event it sees to the app as `H:YCH<name>`, 100ms after it fires.
The other machine fires `H:YCH<name>` through its module, and its panel handler strips the prefix, passes the event to the instruments, and doesn't send it back [7].
On a touchscreen instrument, the script gives every element without an `id` one built from a hash of its tag, attributes, depth, and place among its siblings, every 400ms [7].
A left-button release sends the `id` of the element released on, or of its nearest ancestor with one, as `H:YCB<instrument>#<id>`, and the matching instrument on the other machine dispatches `mousedown`, `mouseup`, and `click` on the element with that `id`, marked so they aren't sent back [7].
An element's `id` depends on its attributes when the scan reached it, so the two machines can give one button different `id`s (unverified).

### What it changes for Crosscheck

Both machines have to run the same aircraft knowledge and agree on who is in control, and nothing in MSFS makes either happen.
YourControls settles both at the host, which puts one pilot's machine on every path.
Which machine, if any, should hold that role in Crosscheck is an open question.

### Known failures and open problems

- FMC and MCDU keypresses sync and the FMC's state doesn't, and time syncs only when a pilot joins [10].
- The fixed 3s wait before a joiner's snapshot can come before an aircraft's `L:` variables exist ([08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).
- The ground-height correction is written, and its calls are commented out ([08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact)).
- Two control changes that cross can leave the machines disagreeing on who is in control (unverified).
- A pilot's own change inside the 1s echo window isn't sent (unverified).
- Two machines can generate different `id`s for one touchscreen button (unverified).
- A throw from the panel handler's constructor may stop a document's later gauges from loading (unverified, [06-02](06-02-apis-debugger-and-injection.md#unverified-claims)).
- On a WASM display, a replayed click would press whatever the receiving pilot's cursor is over, as FS Copilot's does (unverified for YourControls, [06-03](06-03-display-kinds-input-and-pop-outs.md#touchscreens-pointer-events-and-who-owns-hover)).
- The sim runs one package's copy of `VCockpit.js`, so YourControls and FS Copilot can't both put code in the panels (unverified, [01](01-prior-art-and-crew-practice.md#unverified-claims)).
- The app's panel WebSocket server listens on every network interface, at `0.0.0.0:7780`, where the panels need only loopback [5].
- The app and its module exchange no version, and the app reads SimConnect exception 31, `SIMCONNECT_EXCEPTION_OUT_OF_BOUNDS`, as a missing module [5] [11].
- The module's source isn't published, so its interpolation, its pace, and its limits can't be read [6].

## The two tools compared

The two agree on freezing the following aircraft and writing its position from a module, on a YAML file per aircraft, and on replacing `VCockpit.js`, and differ most in topology, in where aircraft knowledge comes from, and in how control moves.

| | FS Copilot ([10-01](10-01-fs-copilot.md)) | YourControls |
| --- | --- | --- |
| Pieces | C# app, C++ module, panel scripts, one server process, and upstream's profile server | Rust app, C++ module shipped without source, panel scripts, one server process |
| App threads | A loop for each SimConnect connection and each link, plus timers | Three: UI, a 10ms main loop, a 5ms network loop |
| Topology | Mesh: every pair of apps links | Star: every message crosses the host |
| Authority | The last claim wins, and any pilot takes control | The host tracks it, with give, take, and observers |
| Replication | Hybrid: state, cause worked out from state, and input | The same hybrid |
| Join | No snapshot | A snapshot after 3s, and the sim's time |
| Position | The newest every 50ms, drawn 400ms behind | Each change, interpolated by unpublished code |
| Echo guard | A skip counter for each variable, expiring after 2s | A 1s window for each name |
| Transport | LiteNetLib, four delivery classes | laminar, reliable-ordered and unreliable-sequenced |
| Traversal | Hole punching, then a relay after 4s | Hole punching (Cloud P2P), a hosted server (Cloud Host), or Direct with a forwarded port |
| Security | No encryption, an 8-letter code | No encryption, an 8-letter code |
| Versions | Matching packet fingerprints, which include the app's version | The host's exact version, or a minimum on Cloud Host |
| Aircraft knowledge | Each machine's own profile, picked by aircraft folder | The host's definition, picked by the pilot |
| Panel sync | Element names through the CommBus, and pointer positions over a WebSocket in our fork | Generated element `id`s over a WebSocket |

## Sources

1. Documented, read from source: [YourControls](https://github.com/YourControls/yourcontrols) at commit 31b1706: `src/yourcontrols/Cargo.toml`, for version 2.8.16, the `laminar` fork, and `web-view`; `src/yourcontrols/src/app.rs`, which runs the web view on its own thread; and `src/yourcontrols/src/program.rs`, the main loop and its 10ms sleep.
2. Documented, read from source: YourControls at 31b1706, `src/yourcontrols-net/src/`: `util.rs`, for laminar's settings, the 0.5s heartbeat, the 5ms network loop, and the Unix-seconds clock; `messages.rs`, for each payload's delivery, MessagePack, and zstd; and `client.rs` and `server.rs`, for the network thread, the handshakes every second up to 5 tries, the version check, the host relaying to every other pilot, and the UPnP mapping.
3. Documented, read from source: YourControls at 31b1706, `src/yourcontrols/src/`: `program/network.rs`, `program/sync.rs`, `program/app_loop.rs`, and `simconfig.rs`, for the default port and timeout; and `src/yourcontrols/web/main.js` and `index.html`, for the Take Control button.
4. Documented, read from source: YourControls at 31b1706, `src/yourcontrols/src/definitions.rs`, for the categories, the 1s window, the event queue, `get_sync`, `write_aircraft_data`, `on_connected`, `get_buffer_bytes`, and `parse_var`; and `syncdefs.rs`, `ToggleSwitch`.
5. Documented, read from source: YourControls at 31b1706, `src/yourcontrols/src/`: `sync/gaugecommunicator.rs`, for the client data areas; `sync/freezer.rs`; `sync/jscommunicator.rs`, which binds `0.0.0.0:7780`; and `program/simconnect.rs`, for exception 31.
6. Read from the built module on our development machine, 2026-09-27: `scripts/build-include/2024/YourControls/modules/YourControlsGauge.wasm` in YourControls at 31b1706, its exports and imports listed with Node's `WebAssembly.Module`, and its strings.
   `src/yourcontrols-gauge/` holds only `Cargo.lock` and `.cargo/Config.toml` at that commit, and on GitHub on 2026-09-27 in both the YourControls and Sequal32 repositories.
7. Documented, read from source: YourControls at 31b1706, `scripts/build-include/2024/YourControls/html_ui/YourControls/`: `Main.js`, `Network.js`, `HTMLEvents.js`, and `HTMLTrigger.js`.
8. Documented, read from source: YourControls at 31b1706, `src/yourcontrols-server/`: `README.md`; `src/main.rs`; `src/rendezvous.rs`; `src/hoster.rs`, `set_host` and the `MINIMUM_VERSION` check; and `src/util.rs`, `get_random_id` and `SESSION_ID_LENGTH`.
9. Documented, read from source: YourControls at 31b1706, `definitions/FS2024/modules/`: `physics.yaml`, `controls.yaml`, `general.yaml`, and `autopilot.yaml`; and `definitions/FS2024/aircraft/Flysimware - Cessna 414AW Chancellor.yaml`.
10. Documented: YourControls documentation, [Running](https://docs.yourcontrols.org/running) and [Syncing Expectations](https://docs.yourcontrols.org/syncing-expectations), read 2026-09-27.
11. Documented, read from the SDK: MSFS 2024 SDK 1.7.3, `SimConnect SDK/include/SimConnect.h`, `SIMCONNECT_EXCEPTION`, whose 32nd member, value 31, is `SIMCONNECT_EXCEPTION_OUT_OF_BOUNDS`.

## Unverified claims

Claims restated from earlier chapters keep their marks, and each links to the chapter that says what would settle it.
This chapter adds five.

- **Two control changes that cross leave the machines disagreeing on who is in control.**
  Each app applies its own `TransferControl` at once, and a machine that hears another pilot take control doesn't give up its own unless it was the one named as giving it [2] [3].
  Two joiners pressing Take Control within 50ms of each other, and every machine logging its control state, would settle it.
- **A pilot's own change inside the 1s echo window isn't sent.**
  The window drops every local report of a name for 1s after a network write to it [4].
  Toggling a `shared:` switch from the other machine, then flipping it back locally within 1s, and reading it on both machines, would settle it.
- **Two machines can give one touchscreen button different `id`s.**
  Each machine builds `id`s from the attributes an element has when its own scan reaches it [7], and nobody has compared two machines.
  Reading the `id` of each element in one touchscreen instrument on both machines, through the Coherent debugger, would settle it.
- **A YourControls click replayed onto a WASM display presses whatever the receiving pilot's cursor is over.**
  YourControls dispatches mouse events on an element in the panel document [7], which on a WASM display reaches the sim the way FS Copilot's replayed events did ([06-03](06-03-display-kinds-input-and-pop-outs.md#touchscreens-pointer-events-and-who-owns-hover)); whether YourControls treats a WASM instrument as a touchscreen at all is unknown.
  Clicking the A350's MFD on one machine while the other pilot's cursor rests on a different MFD button would settle it.
- **How YourControls' module paces and interpolates, and whether it needs both PCs' clocks to agree.**
  The source isn't published [6].
  Setting one PC's clock 2s off and flying a session while recording the following aircraft's position every frame would settle the clock question.
