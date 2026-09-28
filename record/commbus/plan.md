# CommBus sync: plan

This plan finds out whether Crosscheck can sync state that an aircraft keeps only on the CommBus.
The test case is the Synaptic A220-300's selected altimeter setting.
Its systems module publishes the setting as `qnh_hpa` and `qnh_inhg` in the JSON it sends on `A22X.L PFD Data` and `A22X.R PFD Data`, and no `L:` or `A:` variable holds it (fsc-editor, `docs/aircraft/synaptic-a220.md`, "THE ALTIMETER PROBLEM", read from the aircraft's files and unconfirmed in a flight).

The feature has two halves, and they live in different places.
Finding the names an aircraft uses is authoring work, and belongs in the profile IDE.
At runtime, Crosscheck listens only to the names a profile lists, takes a value out of each message, and syncs it like any other value.

The probes are in [experiments/commbus](../../experiments/commbus/README.md), and their raw output goes in `results/` beside this plan.

## Constraints

- Crosscheck overrides `VCockpit.js` to get code into every panel, and working alongside other shared-cockpit tools isn't a goal.
  Neither is in `record/decisions/` yet.
- Probes reach panels through the inspector the sim hosts on 127.0.0.1:19999, which runs JavaScript in any panel with DevMode off (measured on MSFS 2024, 2026-09-01, FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, Q00).
- The A220's two CTPs share the title `CTP`, and its four FCPs share `FCP`, so a probe selects those panels by id (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - A220 panel identifiers collide, and MKP is not interactive").

## Sim sessions

Stages 1 to 3 need the sim in a flight with the A220 and its panels powered.
Stage 1 is read-only and takes seconds, so it can run whenever the sim is up.
Stages 2 and 3 share one session.
Stage 4 needs a session of its own, because the sim reads a new package's `layout.json` only at startup (FS Copilot fork, `record/pointer-forwarding/CLAUDE.md`).

## Stages

### 1. Read how panel JavaScript reaches the CommBus

`p01-commbus-source.mjs` reads the sim's CommBus code out of each panel, and counts which of the A220's scripts use it.
It answers three questions:

- Which `Coherent` calls do `RegisterCommBusListener` and the listener it returns make?
- Does the listener keep its registrations where a script that arrives after the panel loaded can read them?
- Which of the A220's panels use the CommBus from JavaScript, and so where does stage 2 attach?

**Exit:** a log entry names the calls, and says whether registrations made before a probe attached can be read.

**Status:** p01 written, not run.

### 2. Watch the A220's CommBus from a running panel

`p02` wraps the CommBus listener in each A220 panel through the inspector, in the way stage 1 shows, and records every name registered, called, or received after it attaches, each as it happens.

**Exit:** a results file shows messages on `A22X.L PFD Data` whose `qnh_hpa` changes as the pilot turns the captain's baro knob.

**Status:** not started.

### 3. Test whether a SimConnect client hears the A220's CommBus

`p03` subscribes to `A22X.L PFD Data` with `SimConnect_SubscribeToCommBusEvent`, through node-simconnect, which has the CommBus calls as of version 4.2.0 (fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-23 — `L:` cannot be read from a SimConnect client. The module is on the critical path.").
Our A220 notes say SimConnect can't see its CommBus traffic, while the SDK says a module's call reaches SimConnect clients by default, and [04-01](../learn/04-01-connection-and-data.md#what-it-is) records that disagreement.
If messages arrive, Crosscheck's app can read this state with no module and no panel code.

**Exit:** a log entry says whether any message arrived during 60s of turning the knob.

**Status:** not started.

### 4. Load the wrapper with the panel

A Community package overrides `VCockpit.js` and installs the stage 2 wrapper before any aircraft script runs.
Stage 5 builds on it, and it catches names a panel registers while loading, which a probe that attaches later can miss.

**Exit:** a results file lists every CommBus name each A220 panel registered, from the start of a flight.

**Status:** not started.

### 5. Read a named value off the CommBus

This is a prototype of the runtime half.
A panel script takes entries shaped like a profile's, each a channel name and a way to get the value out of a message, and sends the value to a local process when it changes.
A panel can hold a WebSocket to a process on loopback with DevMode off (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/06-open-questions.md`, Q08).
The stage also settles what a profile entry holds: a field path such as `qnh_hpa`, or a small function.

**Exit:** a Node process prints `qnh_hpa` as the pilot turns the knob, with nothing injected through the inspector.

**Status:** not started.

### 6. Set the A220's altimeter to a synced value

This is the write half.
The A220 takes a signed count of knob detents in `L:A22X L Altimeter Set` rather than a pressure, so no single write can name the target (fsc-editor, `docs/aircraft/synaptic-a220.md`, "Baro controls that *are* reachable").
With stage 5 reading `qnh_hpa` back, a controller writes detents until the reading matches the target.
Whether 3 writes move the knob 3 detents is unknown, because the module might reset the variable each frame; stage 6's runs settle it.

**Exit:** a script sets the captain's altimeter to 1013 hPa from three different starting settings, and it lands on 1013 each time.

**Status:** not started.
