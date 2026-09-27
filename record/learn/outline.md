# Learning outline

The concepts we need to build Crosscheck, in the order we'll learn them.
The reader is an experienced software developer and simmer, so software and flight-sim basics are left out, and networking and the MSFS SDK get the most depth.

Each part is marked with its depth:

- **Brief:** a paragraph or two.
- **Refresher:** a quick pass over material the reader mostly knows.
- **Full:** the material itself, taught from the ground up where the reader is new to it.

## [1. Prior art and crew practice (brief)](01-prior-art-and-crew-practice.md)

- Prior art: FSX and P3D shared cockpit, YourControls, FS Copilot, SmartCopilot (X-Plane), JoinFS
- CRM, callouts, and transfer of control

## [2. The MSFS 2024 platform](02-01-installs-and-packages.md)

- Brief: Store vs. Steam installs, `UserCfg.opt`, where packages live
- Refresher: packages (Community, Official, streamed), `manifest.json`, `layout.json`, load order, overriding core files, the virtual file system, why package changes need a restart
- Full:
  - SimObjects: the aircraft folder, `aircraft.cfg`, `systems.cfg`, `panel.cfg`, `flight_model.cfg`, presets, liveries
  - How an aircraft is identified: title vs. folder vs. livery
  - Model behaviors: XML templates, components, where input events come from
  - The sim loop: frames, simulation rate, pause types, slew, replay, time of day
  - The flight lifecycle: main menu, loading, flight start, aircraft change, return to menu
  - Developer Mode tools: the Behaviors window, the SimVar watcher, the console, the Project Editor

## [3. Variables, events, and units (full)](03-01-units-and-variables.md)

- Units: names, conversions, enums, booleans, `Position 16k`, percent vs. `percent over 100`
- `A:` simulation variables: indexed, read-only vs. settable
- `L:` and `Z:` local variables
- `K:` key events: parameters, multi-parameter events
- `B:` input events: presets, enumeration
- `H:` HTML events
- The other namespaces: `E:`, `O:`, `I:`, `M:`, `C:`
- RPN calculator code
- Which namespace can be read, written, or listed from where: SimConnect, WASM, or JS
- Enumerating vs. observing
- Precision, change thresholds, and value types on the wire

## [4. SimConnect (full)](04-01-connection-and-data.md)

- What it is: client–server IPC; native, managed .NET, and third-party bindings
- Connecting: `SimConnect.cfg`, named pipes, remote SimConnect, version detection
- Data definitions and requests: periods, the `CHANGED` and `TAGGED` flags, epsilon
- Writing data, and what the sim overwrites on the next frame
- Client events: mapping, transmitting, notification groups, priorities, masking and intercepting
- System events and state: SimStart, Pause, AircraftLoaded, FlightLoaded, Frame
- The input events API: enumerate, get, set, subscribe
- Client data areas and their size limits
- The AI objects API and the Facilities API
- Throughput, threading, and reconnects

## [5. WASM modules (full)](05-01-kinds-lifecycle-and-apis.md)

- Gauge vs. standalone modules; the sandbox: no sockets, restricted file access, the work folder
- Lifecycle: init, per-frame update, deinit
- Gauge API: named variables, calculator code, triggering key events, the typed variables API
- SimConnect from inside a module
- The CommBus: WASM to JS to WASM
- Toolchain: SDK, platform toolset, `fspackagetool`, the Project Editor
- Protocol versioning between the app and the module; packed structs
- Debugging, crashes, required exports

## 6. Glass cockpits and Coherent GT (full)

- Coherent GT: the Chrome 49 engine and its limits
- VCockpit, `BaseInstrument`, `panel.cfg` gauges; the instrument lifecycle, lazy loading, reloads
- The MSFS Avionics Framework (FSComponent, EventBus) and Working Title avionics
- The JS APIs: `Coherent.call`, `SimVar`, CommBus listeners
- The Coherent debugger on port 19999
- Injecting code into panels: overriding VCockpit, load-order conflicts, failing open
- Display kinds: HTML, React on DOM, React on SVG, canvas, WASM gauges
- Touchscreens, pointer events, who owns hover
- Pop-out windows
- WebSockets from a panel to localhost

## 7. Aircraft-specific systems (refresher)

- Why study-level aircraft diverge: their own systems code, variables, and events
- How major addons expose state: FlyByWire, PMDG, Fenix, iniBuilds, the Asobo defaults
- Control semantics: latching vs. momentary, toggle vs. set, relative vs. absolute, guarded, multi-position, spring-loaded
- Causes vs. effects
- Hidden state: FMS and MCDU, flight plans, avionics pages, failures, timers
- Sources of divergence: randomness, frame timing, physics
- Matching aircraft: the same addon, version, and livery on both machines

## 8. Synchronization (full)

- Replication models: state, input, lockstep, hybrid
- Authority: pilot in control, per-system or per-control ownership, handover, contention
- Echo loops and suppressing them
- Initial sync: a snapshot on join, late join, resync after reconnect
- Ordering, sequence numbers, deduplication, idempotency, last writer wins
- Classes of data: what must arrive vs. what can be dropped
- Change detection, sample rates, bandwidth budgets
- Relative vs. absolute actions
- Flight controls: who flies, and local hardware fighting synced values
- Position and attitude: freeze and set, slew, dead reckoning, interpolation buffers, jitter, time shift, ground contact
- Clocks: offset estimation, sim time vs. wall time, syncing pause and sim rate
- Detecting divergence and correcting it
- Two pilots on one screen

## 9. Networking (full, from the ground up)

- Addresses and ports: public vs. private addresses, what a home router does
- Latency, jitter, loss, and bandwidth: typical figures on a LAN vs. the internet
- TCP, UDP, WebSocket, WebRTC data channels, QUIC
- Delivery modes: reliable-ordered, sequenced, unreliable; head-of-line blocking; MTU and fragmentation
- NAT types, CGNAT, port forwarding, UPnP and NAT-PMP
- STUN, TURN, ICE, and hole punching
- Relays: when they're needed, hosting, fan-out, cost
- Setting up a session: codes, rendezvous servers
- Serialization, protocol versioning, and compatibility between app versions
- Security: authentication, encryption, validating what a peer writes into your sim
- Connection lifecycle: heartbeats, timeouts, a clean leave vs. an outage, reconnecting

## 10. Case studies

- FS Copilot internals, from our records
- YourControls
