# Case studies: FS Copilot internals

- [FS Copilot internals, from our records](#fs-copilot-internals-from-our-records)
  - [Processes and what runs where](#processes-and-what-runs-where)
  - [One switch flip](#one-switch-flip)
  - [One position update](#one-position-update)
  - [Design choices and what they cost](#design-choices-and-what-they-cost)
  - [What it changes for Dual Input](#what-it-changes-for-dual-input)
  - [Known failures and open problems](#known-failures-and-open-problems)
- [Sources](#sources)
- [Unverified claims](#unverified-claims)

YourControls, and the two tools compared, are in [10-02-yourcontrols](10-02-yourcontrols.md).

Parts 2 to 9 took FS Copilot apart one mechanism at a time, and this chapter puts it back together.
It describes the `ahead` branch of our FS Copilot fork at 9d4e864: FS Copilot 1.2.1, by its project file, plus the pointer forwarding, traffic, ATC audio, and relay protocol version 2 that our fork added to upstream's code [1].
As in [08-01](08-01-replication-models-and-authority.md), the flying machine is the pilot in control's, and the following machine is the other; FS Copilot's code calls them master and slave.

## FS Copilot internals, from our records

FS Copilot is four programs: a .NET desktop app on each pilot's PC, a standalone WASM module and a set of panel scripts that the app installs into the sim as a package, and a server that introduces the apps to each other and relays for pairs that can't link directly.
A switch flip leaves the flying machine as a variable's new value and arrives as calculator code that the following machine's module runs.
A position update crosses the same network, and the following machine's module writes it into a frozen aircraft every frame, 400ms behind.

### Processes and what runs where

```text
each pilot's PC
  MSFS 2024
    panel documents: FS Copilot's VCockpit.js, hook.js, and six more of its scripts
        | CommBus                            | WebSocket to 127.0.0.1:9020-9024 (our fork)
    FsCopilot.wasm, a standalone module      |
        | SimConnect: variables, events,     |
        |   and 11 client data areas         |
  FsCopilot.exe  <---------------------------+
    five SimConnect connections: four for the cockpit and the module, one for traffic
    Coordinator, MasterSwitch, PanelServer, HybridNetwork
        | LiteNetLib over UDP
        +-- a direct link to every other pilot's app, after hole punching
        +-- FsCopilot.Discovery server: rendezvous on UDP 3480, relay on UDP 3600
```

| Piece | Where it runs | What it does | Taught in |
| --- | --- | --- | --- |
| `FsCopilot.exe` | Each pilot's PC, as a .NET 9 Avalonia app [1] | Reads and writes the sim, loads the aircraft's profile, and runs the network | [04-01](04-01-connection-and-data.md#what-it-is), [04-03](04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects) |
| `FsCopilot.wasm` | Inside the sim, from the `fscopilot-bridge` package | Freezes the following aircraft, writes its position every frame, runs calculator code, and relays panel messages | [05-01](05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit), [05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm) |
| Panel scripts | Inside every panel document, loaded by FS Copilot's copy of `VCockpit.js` | Report `H:` events and clicks, and in our fork, capture and replay pointer gestures | [06-02](06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open), [06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost) |
| `FsCopilot.Discovery` | A server, as one ASP.NET Core process that hosts both services [1] | Introduces apps for hole punching, and relays for pairs that can't punch | [09-03](09-03-nat-and-traversal.md#stun-turn-ice-and-hole-punching), [09-04](09-04-relays-and-sessions.md#relays-when-theyre-needed-hosting-fan-out-cost) |
| Profile server | Upstream's host, `p2p.fscopilot.com`, port 2320 [2] | Serves the aircraft profiles the app downloads | This chapter |

Inside the app, work runs on several loops rather than one main loop [3].
Each SimConnect connection belongs to one loop, the only code that calls it ([04-03](04-03-client-data-ai-and-throughput.md#throughput-threading-and-reconnects)).
The direct and relay links each have a polling loop, every 15ms ([09-01](09-01-addresses-and-link-quality.md#latency-jitter-loss-and-bandwidth-typical-figures-on-a-lan-vs-the-internet)), and the panel server accepts WebSockets on a loop of its own.
Timers drive the 200ms control write to the module, the 50ms and 30ms samples, and our fork's acknowledgments, and messages pass between all of these as Rx observable streams [3].

### One switch flip

The pilot in control presses the autopilot button on a Synaptic A220, whose profile entry reads `L:A22X AP Master` and fires `K:AP_MASTER` only when the two machines disagree ([07](07-aircraft-specific-systems.md#control-semantics)).

```text
flying machine                                     following machine
[A220 systems] -2 SimConnect-> [app: Coordinator] -5 LiteNetLib-> [app: profile, Jint]
      1                               3, 4                               6, 7
                                                                           |
[A220 systems] <-9 K:AP_MASTER- [module: calculator code] <-8 FSC_EXE area-+
      |
      +-10 SimConnect report-> [app: skip counter drops it]
```

| Hop | Where | What happens | Taught in |
| --- | --- | --- | --- |
| 1 | Flying sim | The A220's systems module sets `L:A22X AP Master` to 1 | [07](07-aircraft-specific-systems.md#why-study-level-aircraft-diverge) |
| 2 | SimConnect | One of the app's two reading connections reports the change, from a data definition for that one variable, requested every simulated frame with the `CHANGED` flag | [04-01](04-01-connection-and-data.md#data-definitions-and-requests), [03-03](03-03-reading-and-writing.md#precision-change-thresholds-and-value-types-on-the-wire) |
| 3 | Flying app | No skip counter is waiting on the variable, so the Coordinator sends it | [08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them) |
| 4 | Flying app | The change becomes an `Update` packet: a packet ID, the name, a type code, and 1.0, 27 bytes in all | [09-05](09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions) |
| 5 | Network | The `Reliable` class sends it reliable-ordered on channel 1, on every live link | [08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped), [09-02](09-02-transports-and-delivery.md#delivery-modes-reliable-ordered-sequenced-unreliable-head-of-line-blocking-mtu-and-fragmentation) |
| 6 | Following app | The link's loop picks it up, and the app applies it because its own profile has an entry with that name | [09-05](09-05-versions-and-security.md#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim) |
| 7 | Following app | The entry's `set:` runs as JavaScript: the value 1 differs from the local 0, so it returns `(>K:AP_MASTER)`, and the app adds 1 to the variable's skip counter [4] | [07](07-aircraft-specific-systems.md#control-semantics), [08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them) |
| 8 | Following module | The app writes the expression into the `FSC_EXE` client data area, and the module runs it with `execute_calculator_code` [4] | [05-01](05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements), [05-03](05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs) |
| 9 | Following sim | The A220 takes `K:AP_MASTER` and sets its own `L:A22X AP Master` to 1 | [07](07-aircraft-specific-systems.md#why-study-level-aircraft-diverge) |
| 10 | Following app | SimConnect reports the change, and the skip counter drops the report instead of sending it back | [08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them) |


### One position update

The following aircraft is already frozen: the app writes the machine's role into the `FSC_CONTROL` area every 200ms, and the module froze the aircraft when that role became following ([05-01](05-01-kinds-lifecycle-and-apis.md#lifecycle-init-per-frame-update-deinit), [08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)).

```text
flying machine                                          following machine
[flight model] -1 SimConnect-> [app: newest every 50ms] -3 LiteNetLib-> [app]
                                        2                                  |
[frozen aircraft] <-6 every frame- [module: time shift, buffer] <-4 FSC_PHYSICS area
                                              5
```

| Hop | Where | What happens | Taught in |
| --- | --- | --- | --- |
| 1 | SimConnect | The flying app reads `Physics`, 13 doubles, every simulated frame | [08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact) |
| 2 | Flying app | The Coordinator sends the newest sample every 50ms, stamped with the app's clock and a session ID | [08-04](08-04-rates-actions-and-flight-controls.md#change-detection-sample-rates-bandwidth-budgets), [08-05](08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate) |
| 3 | Network | The `Sequenced` class sends it on channel 2, 149 bytes on the wire, about 3 KB/s | [08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped), [09-01](09-01-addresses-and-link-quality.md#latency-jitter-loss-and-bandwidth-typical-figures-on-a-lan-vs-the-internet) |
| 4 | Following app | The app writes the packet into the `FSC_PHYSICS` client data area | [04-03](04-03-client-data-ai-and-throughput.md#client-data-areas-and-their-size-limits) |
| 5 | Module, on arrival | The module maps the stamp onto its own clock and keeps samples at least 200ms apart | [08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact) |
| 6 | Module, every frame | The module draws 400ms behind, interpolates between samples, and writes 13 `A:` variables in one `execute_calculator_code` call | [05-01](05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements), [08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact) |

Control surfaces travel the same way in a `Surfaces` packet, and the module writes each one twice, as an `A:` variable and as a `K:AXIS_*` event ([08-04](08-04-rates-actions-and-flight-controls.md#flight-controls-who-flies-and-local-hardware-fighting-synced-values)).

### Design choices and what they cost

**Authority goes to whoever claimed it last.**
Any pilot takes control at once, with no host and no acceptance step, and each machine follows the last `SetMaster` it heard ([08-01](08-01-replication-models-and-authority.md#authority-pilot-in-control-per-system-or-per-control-ownership-handover-contention)).
It has no rule for claims that cross: with three pilots, two claims within one network delay can leave nobody flying, and nothing notices two machines in control or none (unverified).
When the pilot in control leaves, the other pilot's aircraft stays frozen until that pilot takes control.

**Replication is a hybrid.**
Position and `master:` entries are state sent from the flying machine, `shared:` entries are usually a state read on either machine and a cause written on the other, and display clicks and `H:` events are input ([08-01](08-01-replication-models-and-authority.md#replication-models-state-input-lockstep-hybrid)).
State written into a frozen aircraft is smooth and 400ms late ([08-05](08-05-position-and-clocks.md#position-and-attitude-freeze-and-set-slew-dead-reckoning-interpolation-buffers-jitter-time-shift-ground-contact)).
A cause worked out from a state is corrected by the next update, and an input replayed onto a display showing another page presses something else ([08-04](08-04-rates-actions-and-flight-controls.md#relative-vs-absolute-actions)).
Nothing sends a snapshot, so a machine that joins receives only later changes (unverified, [08-02](08-02-echoes-and-initial-sync.md#initial-sync-a-snapshot-on-join-late-join-resync-after-reconnect)).

**Transport is LiteNetLib over UDP, with a mesh of direct links and a relay behind them.**
Four delivery classes keep a loss in one stream from holding up another ([08-03](08-03-ordering-and-classes-of-data.md#classes-of-data-what-must-arrive-vs-what-can-be-dropped)).
Every pair of apps links directly after hole punching, 153ms from call to link in one logged join, or through the relay after the 4s direct attempt fails ([09-04](09-04-relays-and-sessions.md#setting-up-a-session-codes-rendezvous-servers)).
The costs sit at the edges: nothing encrypts, the code is the only credential, builds with different version numbers can't connect (read from source), and a dropped peer link stays down ([09-05](09-05-versions-and-security.md#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim), [09-06](09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).

**Aircraft knowledge is a profile per aircraft folder, which each machine keeps on its own.**
The app picks the profile by the loaded aircraft's folder ([02-02](02-02-aircraft.md#how-an-aircraft-is-identified)), reads it from a `Definitions` folder beside the app, and asks the profile server on every aircraft load whether a newer one exists [2].
A `set:` expression that holds a quote, a backtick, `?`, or a brace is JavaScript, which the Jint engine evaluates into calculator code [4].
No packet type carries the aircraft or its profile, so nothing checks that both machines loaded the same aircraft and the same profile version, and each applies only the names in its own profile [5].
Profiles also carry their authors' guesses: the A220's was written without the aircraft installed, and syncs baro through two names absent from the aircraft's systems module ([07](07-aircraft-specific-systems.md#why-study-level-aircraft-diverge)).

**Panel sync runs through a replaced `VCockpit.js`.**
Every panel document runs FS Copilot's copy of the file, which wraps each instrument ([06-02](06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)).
Upstream syncs clicks by element name through the CommBus, the module, and 512-byte client data areas ([05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), and reports `H:` events the same way, holding each for 500ms before sending it ([03-02](03-02-events-and-other-namespaces.md#h-html-events)).
Our fork adds pointer gestures, numbered and acknowledged, over a WebSocket from each panel document to the app ([06-04](06-04-websockets-to-localhost.md#websockets-from-a-panel-to-localhost)).
Element names miss every SVG, canvas, and WASM display, and positions drive SVG.
Of the WASM displays tested, only the A380's has been driven from a panel, by a probe that wraps the press in `mouseover`, `mouseenter`, and `mouseleave` ([06-03](06-03-display-kinds-input-and-pop-outs.md#touchscreens-pointer-events-and-who-owns-hover)).
The copy has to be redone after any sim update that changes the stock file.
The sim runs only one package's copy of a file ([02-01](02-01-installs-and-packages.md#packages-and-the-virtual-file-system)), and FS Copilot's installer deletes YourControls' package.
Its app also reports "Conflict detected with YourControls package." whenever `L:YourControlsPanelId` is above 0, a sign that YourControls' panel code ran [5].

### What it changes for Dual Input

Each hop in the two diagrams is a place where a message can be lost, copied, reordered, echoed, or read by another version, and FS Copilot guards against those at some hops and not at others: a pointer gesture carries a session and a sequence number end to end, and a cockpit update carries only a name and a value.
So for each hop, Dual Input needs a stated rule for each of those five, and how long a switch flip takes from one cockpit to the other is an open question no record has measured.

### Known failures and open problems

Each links to the chapter that shows it, except the last, which this chapter adds.

- Crossing control claims among three pilots can leave nobody flying, and two machines in control each fly their own aircraft (unverified, [08-01](08-01-replication-models-and-authority.md#unverified-claims)).
- `K:TOGGLE_LAUNCH_BAR_SWITCH` takes control from any source, a real launch bar or a bound button included (unverified, [08-01](08-01-replication-models-and-authority.md#unverified-claims)).
- A machine that joins mid-flight keeps its own setting of every switch nobody touches afterward (unverified, [08-02](08-02-echoes-and-initial-sync.md#unverified-claims)).
- Two pilots moving one `shared:` control within one network delay end swapped (unverified, [08-01](08-01-replication-models-and-authority.md#unverified-claims)).
- The skip counter can drop the pilot's next change after a write that drew no report, and its warning fires on harmless writes too ([08-02](08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)).
- A `master:` update lost on the sequenced channel stays lost until the control moves again (unverified, [08-03](08-03-ordering-and-classes-of-data.md#unverified-claims)).
- A `master:` entry whose `set:` is a key event fires it twice (unverified, [08-04](08-04-rates-actions-and-flight-controls.md#unverified-claims)).
- The following pilot's own throttle and stick still reach their sim (unverified, [08-04](08-04-rates-actions-and-flight-controls.md#flight-controls-who-flies-and-local-hardware-fighting-synced-values)).
- Pause, simulation rate, and time of day aren't synced ([08-05](08-05-position-and-clocks.md#clocks-offset-estimation-sim-time-vs-wall-time-syncing-pause-and-sim-rate)).
- After an outage, the following aircraft holds still, then jumps (unverified, [08-05](08-05-position-and-clocks.md#unverified-claims)).
- `L:` values travel as 32-bit floats, and `A:` values in 18 unit names as 32-bit integers ([03-03](03-03-reading-and-writing.md#precision-change-thresholds-and-value-types-on-the-wire)).
- Two links to one peer deliver every packet twice, and a cockpit update has no sequence number to drop the copy by ([08-03](08-03-ordering-and-classes-of-data.md#ordering-sequence-numbers-deduplication-idempotency-last-writer-wins)).
- Nothing encrypts, anyone can test which codes are live, the Windows user name goes to every peer, and a text value may run as calculator code on the receiver ([09-05](09-05-versions-and-security.md#security-authentication-encryption-validating-what-a-peer-writes-into-your-sim)).
- A dropped peer link stays down until a pilot joins again ([09-06](09-06-connection-lifecycle.md#connection-lifecycle-heartbeats-timeouts-a-clean-leave-vs-an-outage-reconnecting)).
- Our fork's apps can't use upstream's relay, which speaks relay protocol version 1 ([09-04](09-04-relays-and-sessions.md#relays-when-theyre-needed-hosting-fan-out-cost)).
- Profiles write 32 variables the SDK marks read-only, and sync a constant 0 for `Z:AUDIO_Knob_Selector_1` ([03-01](03-01-units-and-variables.md#a-simulation-variables), [03-01](03-01-units-and-variables.md#l-and-z-local-variables)).
- A livery can change the A220's panel key so that its pointer entry matches nothing (unverified, [02-02](02-02-aircraft.md#unverified-claims)).
- Element-name sync skips every instrument whose `isInteractive` is false, such as the A220's MKP ([06-01](06-01-the-engine-and-instruments.md#vcockpit-baseinstrument-and-panelcfg-gauges)).
- A replayed press on one of the A350's WASM displays lands wherever the receiving pilot's cursor is ([06-03](06-03-display-kinds-input-and-pop-outs.md#touchscreens-pointer-events-and-who-owns-hover)).
- The module drops a panel message over 512 bytes without a log, and sizes `FSC_EXE` at 200 bytes where the app writes 512 ([05-02](05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm), [05-03](05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
- The module calls `SimConnect_CallDispatch` once, and nothing in MSFS 2024 shows that's enough (unverified, [05-02](05-02-simconnect-and-the-commbus.md#unverified-claims)).
- Two pilots working one display at once leave it diverged, and only pressing the same page button brings it back ([08-06](08-06-divergence-and-one-screen.md#two-pilots-on-one-screen)).
- The 500ms hold on `H:` events has no measured reason ([08-02](08-02-echoes-and-initial-sync.md#unverified-claims)).
- A copy of an `H:` event fires the event a second time (unverified).

## Sources

1. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/FsCopilot.csproj`, for .NET 9, version 1.2.1, Avalonia, Jint 4.4.1, and LiteNetLib 1.3.1; `FsCopilot/Program.cs`, which builds the app's services and says in its comment on the relay host that upstream's relay doesn't speak relay protocol version 2; `FsCopilot.Discovery/Program.cs`, which hosts `Stun` and `Relay` in one ASP.NET Core process; and the merge commits 0b1b972 and 0daa4c2, which bring in our pointer forwarding, traffic, and ATC audio.
2. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Program.cs`, where the `Updater` gets `http://p2p.fscopilot.com:2320`; `FsCopilot/Updater.cs`, `Check` and `Download`, which call `/api/profiles/<key>`; `FsCopilot/ViewModels/MainViewModel.cs`, which loads the profile and checks for a newer one on every aircraft announcement; and `FsCopilot/Simulation/Definitions.cs`, `Load` and `Save`, which read and write the `Definitions` folder beside the app.
3. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Connection/SimConnectConsumer.cs`, `AutoReconnect` and `Connect`; `FsCopilot/Connection/PanelServer.cs`, `AcceptLoop`; `FsCopilot/Connection/SimClient.cs`, the 200ms interval in the constructor; and `FsCopilot/Simulation/Coordinator.cs`, the 50ms and 30ms `Sample` calls and the acknowledgment interval.
4. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: `FsCopilot/Simulation/Definitions.cs`, `Set`, which hands an expression to Jint when it holds a quote, a backtick, `?`, `{`, or `}`, and `ApplyTo`, which sends a `shared:` entry's expression to `SimClient.Execute`; and `FsCopilot/Connection/SimClient.cs`, `Execute`, which writes it into the `FSC_EXE` area.
5. Documented, read from source: FS Copilot fork, `ahead` branch at 9d4e864: the registered packet types, `Update`, `Interact`, `Physics`, `Surfaces`, `PointerEvent`, and `PointerAck` in `FsCopilot/Simulation/Coordinator.cs`, `SetMaster` in `MasterSwitch.cs`, the hosting, traffic, and ATC packets in `ShareSwitch.cs`, and `PeerTags`, which carries each peer's ID and name, in `FsCopilot/Network/PeerTags.cs`; `Coordinator.cs`, `AddLink(Definition)`, which drops a received update whose name isn't in the local profile; and `FsCopilot/Connection/SimClient.cs`, the `_conflict` stream on `L:YourControlsPanelId`, with its message in `FsCopilot/ViewModels/MainViewModel.cs`.

## Unverified claims

Claims restated from earlier chapters keep their marks, and each links to the chapter that says what would settle it.
This chapter adds one.

- **A copy of an `H:` event fires the event a second time.**
  An `H:` event travels as an `Update`, which carries no sequence number, and the receiver runs every `Update` it gets ([08-03](08-03-ordering-and-classes-of-data.md#ordering-sequence-numbers-deduplication-idempotency-last-writer-wins)) [4] [5], so a copy from a second link would fire the event again.
  Our records measured copies only on traffic packets.
  Joining two instances on one PC where both the LAN and the hairpin punch succeed, pressing one A220 keypad key, and reading both scratchpads would settle it.
