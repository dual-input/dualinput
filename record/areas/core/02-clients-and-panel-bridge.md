# Core: clients and the panel bridge

```text
Purpose:     How the core's clients reach it and talk to it, and how a cockpit panel loads what features run there.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, ../architecture/decisions.md, log.md
Decides:     The core's WebSocket library and its Origin check; the client protocol's messages; how a unit's state, commands, and messages reach the clients; notifications and settings; the moments the clients crate raises; what a client whose version differs gets; how page-client finds, joins, and rejoins the core; how our VCockpit.js loads the bridge and the bridge loads panel modules; what v1 builds for clients beyond the PC; and the budgets (node 6.2).
```

> **Note**
> Since 2026-10-24, `clients`' own slice `banner` says whether a banner page's socket is open, not the notifications' slice that [what a unit registers and calls](#what-a-unit-registers-and-calls) gives it to (user, 2026-10-24; [interface log](../interface/log.md#2026-10-24-the-apps-wiring-calls-notices-notifications-gives-the-banners-socket-a-slice-of-its-own-and-passes-a-development-cores-data-folder-to-the-desktop-app)).

The core serves every client over one protocol of JSON messages on a WebSocket, through tokio-websockets, which iroh already brings into the core.
A client opens with a `hello` that names it and its version, and from then on each side sends `alive` every 2s, while only the core closes a socket that goes quiet.
A unit reaches the clients through slices of state, which the `clients` crate sends on a timer to the clients that show them, through commands the clients send it, and through messages of its own to a client by name.
In a cockpit panel, our `VCockpit.js` hands each instrument to the panel bridge without ever delaying it, and loads our files through script elements of its own, outside the sim's script loader.

This answers node 6.2 of the [architecture plan](../architecture/plan.md#62-clients-and-the-panel-bridge).
The spine's [communication](../architecture/01-spine.md#communication), decisions [008](../../decisions/008-every-link-ends-at-core.md) to [011](../../decisions/011-cockpit-panels-connect-only-in-session.md), [013](../../decisions/013-core-accepts-sim-origin-or-none.md), [014](../../decisions/014-apps-find-core-through-port-file.md), and [016](../../decisions/016-core-keeps-pilots-settings.md), the code map's [modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge) and [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), and [01-loop-and-edge](01-loop-and-edge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| `src/apps/core`'s edge | The WebSocket server, its `Origin` check, and a tokio task for each socket; a socket opening, a text message, and a close come in as inputs, and "send this text" and "close this socket" go out as outputs |
| `clients`, on the loop | The protocol, the table of clients, the keepalive, client state, commands, messages to clients, notifications, settings, and which panel modules each panel loads; it raises a client joining or leaving, a panel's socket replaced, and a setting changed |
| `page-client`, in TypeScript | Hearing the core's announcement, connecting, the `hello`, the keepalive, handing each message to whoever registered its tag, and giving its page the connection's state |
| `panel-bridge`, in TypeScript | Our two blocks in `VCockpit.js`, a record of each instrument, loading panel modules, locks and overlays, and `window.DUALINPUT_BRIDGE_UNLOCK()` |

## The WebSocket server

- **The library is tokio-websockets 0.13.3.**
  iroh 1.3 already brings it into the core through iroh-relay, so serving the clients with it keeps the core at one WebSocket implementation, where tokio-tungstenite 0.30.0 would add a second ([core log][p02]).
  The core turns on its `server` feature, which iroh-relay leaves off and which adds no crate (same entry).
- **`Origin`:** `ServerBuilder::accept` writes the upgrade before it returns the request ([core log][p02]), so the edge reads `Origin` from that request at once, and closes a socket whose `Origin` is neither `coui://html_ui` nor absent with code 1008, `CloseCode::POLICY_VIOLATION` (read in tokio-websockets 0.13.3, `src/proto/types.rs`), before reading anything from it.
  No message from it reaches the loop, so [decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md)'s rule holds.
- **Limits:** tokio-websockets' `Limits` cap a message at 64 MiB by default ([core log][p02]); the edge sets 1 MiB, sixteen times the [budget](#budgets)'s 64 KiB, so a message over budget still arrives and the bench catches it, while a runaway closes the socket.
  Only text is taken, and a binary message closes the socket.
- **Socket IDs** come from a counter at the edge, inside each input, so a replay sees the same IDs.
- **The port file** is `port.json` in the core's data folder, the message crate's `PortFile`: the port, the core's process ID, and its creation time.

## The protocol

Each message is JSON with a `t` tag, defined in the message crate's clients module, and a unit's own bodies are defined in its module there.

| `t` | From | Carries |
| --- | --- | --- |
| `hello` | A client | Its component, its version, the message crate's hash, and for a cockpit panel its panel's name and its instruments' keys |
| `alive` | Either | Nothing: each side sends it every 2s, whatever else it sends |
| `watch` | A client | The slices of state it shows, after its `hello` and whenever that changes |
| `state` | The core | One slice's name and its whole value |
| `command`, then `answer` | A client, then the core | An ID, the command's name, and its arguments; then the same ID, and "taken" or an error |
| `unit` | Either | A unit's name and a body of its own: a panel module's press, the sim service's world-map request to the menu script, or the order that opens the EFB onto our app |
| `load`, `stop`, `none` | The core, to a cockpit panel | The panel modules to load, with each one's instruments, or to stop, or nothing for this panel, after which it closes its socket ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) |
| `bye` | The core | Nothing: the core sends it as it quits ([01-loop-and-edge](01-loop-and-edge.md#quitting)) |

- **Each side sends `alive` every 2s, and only the core closes a socket that has been quiet for 8s.**
  One timer on each side sends it, with no record of what went to each client, at about 10 messages a second across the 20 cockpit panels of the Black Square Baron 58P (user, 2026-10-22).
  [Decision 010](../../decisions/010-clients-message-core-every-2s.md) has the clients' message every 2s and the core's close after 8s; the core's own message every 2s is this design's, and adds to decision 010 once step 8's decisions are numbered.
  A 2s tick of `clients` that fires more than 2s late starts each client's 8s of quiet again, since the core itself stopped and heard nothing, so a core suspended for 12s closes no page's socket ([core log][stage5]).
  A client notes the core's silence and keeps its socket, and the EFB app can show it.
  Any message from the core renews a panel's visible locks, so when the core hangs, the bridge turns a visible lock into a warning 8s to 10s after the core's last message, as the code map's [how work in the sim ends](../architecture/02-code-map.md#how-work-in-the-sim-ends) has it.
- **A command's answer says only whether the command was taken.**
  What it led to shows in state: a join, for one, answers at once, and its progress shows in the session's slice.
- **`bye`** goes to every client when the session crate quits, which asks `clients` for it in the handler that puts out the exit; the apps use it to tell the pilot that Dual Input quit rather than stopped, as FS Copilot's panels told a deliberate shutdown from a crash by its goodbye (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`).
- **A message that doesn't parse never stops the core.**
  `clients` reads a `hello`'s component, version, and hash before the rest of it, so a client is always named; it logs and drops any other message that doesn't parse, with its client's name, and answers a `command` whose arguments don't parse with an error.

## A client whose version differs

A `hello` whose version or hash differs from the core's is logged by the client's name, with both versions, and nothing more: the core goes on talking to it (user, 2026-10-15), and no notification shows ([trouble](../interface/01-apps.md#trouble)).
The watcher updates the Community package with Dual Input while the sim is closed ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so we expect a mismatch to mean a developer's stale package (inference).
This settles, for the WebSocket clients, the spine's item in [left open](../architecture/01-spine.md#left-open) on what the core does beyond logging; our WASM module, whose data slots are structs the module reads in place ([messages and their types](../architecture/01-spine.md#messages-and-their-types)), is [6.3](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module)'s.

## What a unit registers and calls

```rust
// a sketch, beside 01-loop-and-edge's
me.client_state::<TakeControlView>("take-control", view);   // a slice, built by `view` from the unit's state and the platform's
me.command("take-control.request", TakeControl::request);   // a command, called by name
cx.send(To::Component("menu-script"), body);                  // a message to a client
clients::notify(cx, id, level, text, action);                 // a notification, and clients::clear_notification(cx, id)
```

- **Client state:** while any client is connected, `clients` runs a timer every 50ms, a starting value, and each time it fires, `clients` builds each slice some client shows, and sends each client the slices whose value differs from the one it last sent that client.
  A client that starts showing a slice gets it at once.
  The timer bounds the work however many inputs arrive, and needs no unit to mark what changed.
  A slice no unit registered, such as a deleted feature's, is ignored.
- **Commands:** `clients` calls a command's handler by name, through the kernel, once its own handler returns ([01-loop-and-edge](01-loop-and-edge.md#hooks)); a name no unit registered answers "unknown".
  `clients` holds a command for a notification clicked outside its action, and one that brings the desktop app forward ([the apps](../interface/01-apps.md#slices-and-commands)).
- **Messages to a client:** `cx.send` puts out a `unit` message to every client of a component, to a panel module, or to an app's part, by its unit's name, and a client's `unit` message reaches the unit that registered its name ([the apps](../interface/01-apps.md#slices-and-commands)).
  Unlike a slice, a message goes once, so a client that connects later never gets it: a menu script that reconnects never gets a world-map request the sim service sent before it.
- **Notifications:** a notification's ID is its unit's own, its feature writes its text, its level is information, a warning, or trouble, and its action, if it has one, is the command a click on it sends.
  The notifications are a slice of `clients`' own, which also says whether a banner page's socket is open, and where each notification shows waits for the apps' stage ([left to the apps' stage](../interface/01-apps.md#left-to-the-apps-stage)).
- **Settings:** a unit registers each setting with a key, a type, a default, a label, and what an app needs that its type doesn't say, and `clients` keeps them in `settings.json` in the data folder, whose bytes come with the core's first input ([01-loop-and-edge](01-loop-and-edge.md#starting-and-stopping)).
  - A change writes the whole file again, as a job.
  - A stored value that doesn't fit its type gives way to the default, and the core logs it.
  - A key no unit registered stays in the file through every write, so a feature deleted and restored finds its values.
  - The settings are a slice, which the desktop app shows, and any client changes any setting with `clients`' command ([decision 016](../../decisions/016-core-keeps-pilots-settings.md); [settings](../interface/01-apps.md#settings)).
  - A development setting shows in no app.

## The moments clients raises, and the calls it takes

`clients` sits below most of the platform in the code map's [units](../architecture/02-code-map.md#the-units), so it tells the crates above it through moments, and they reach it through calls it declares:

| Moment | Raised when | Such as |
| --- | --- | --- |
| A client joined, or left | A `hello` arrives, or a socket closes, with the client's component | The session crate exits once the desktop app has gone and the rest of the spine's rule holds ([what moves them](../architecture/01-spine.md#what-moves-them)) |
| A panel's socket replaced | A `hello` names the panel another socket holds | Pointer sync counts a press sent to the old socket that its panel never played as applied ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)) |
| A setting changed | A command changes a setting, with its key | The core-helper-service gives the core helper a rebound take-control key |

A cockpit panel's `hello` names its panel as the sim's `globalPanelData.sName` gives it, such as `VCockpit66`, and the panel's name decides a replacement, since two of the Black Square Baron's panels each hold an instrument keyed `GNS_DISABLED` (user, 2026-10-22; [core log][stage5]).
Whether a reloaded panel keeps its name is [left open](#left-open).

- The profile loader tells `clients` when its profile loads and unloads, and each panel module's rule reads the loaded profile from the profile loader's state, so `clients` needs no type of the profile engine's.
- The session crate asks `clients` for `bye` before it puts out the exit.

## Cockpit panels and their modules

- A panel module's rule picks instruments, given the loaded profile, as pointer sync's takes the instruments its profile's [`displays`](../profiles/01-format-and-delivery.md#displays) names.
- An instrument's key is its identifier, or its tag's name if it has none, followed by `|` and the query of its `url` attribute where it has one, as FS Copilot's `Channel.keyFor` joins them (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`), the key the profile's `displays` names.
- Once the profile has loaded and a panel's `hello` has arrived, `clients` answers the panel with `load`, naming the modules its instruments get and each one's instruments, or with `none`; a profile that unloads sends `stop`.
- `clients` raises a trouble notification when no cockpit panel's `hello` comes within 10s of the profile loading ([trouble](../interface/01-apps.md#trouble)).
- A panel told `none` stays closed until an announcement brings another port or says the session ended, so it connects once a session.

## page-client

1. It listens for the core's announcement, a CommBus event named `DUALINPUT_CORE_ANNOUNCE` whose payload holds the core's port and whether a session runs, by each kind of page's route in [finding the core](../architecture/01-spine.md#finding-the-core).
   The event's name is new in this design, and follows [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares).
2. When it hears an announcement with no socket open, or one naming a port other than its socket's, it connects to that port and sends its `hello`; a cockpit panel connects only to an announcement that says a session runs ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)).
3. When its socket closes, it connects again on the next announcement, so it needs no backoff.
4. It queues nothing while it has no socket, and a send then is dropped: a core that restarted comes back as a late joiner ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)), and a press played into a cockpit already caught up would undo the catch-up.
   FS Copilot's channel kept up to 200 messages for at most 30s, since "stale input is worse than none" (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`, `MAX_QUEUE` and `MAX_QUEUE_AGE_MS`); ours keeps none.

`page-client` gives its page the connection's state ([the apps](../interface/01-apps.md#slices-and-commands)).

## The panel bridge

### Our VCockpit.js

Our `VCockpit.js` is the stock file with two blocks between markers, as FS Copilot's copy has ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)):

- The block at the top sets `DUALINPUT_BRIDGE_PENDING = []` and, in a `try`, adds a script element of its own for `/DualInput/bridge.js`, one esbuild bundle of the bridge and page-client, which loads the sim's `CommBus.js` the same way where the panel lacks it.
- The block in `createInstrument`, after the sim's code has set the instrument up, runs `try { if (window.DUALINPUT_BRIDGE_API) DUALINPUT_BRIDGE_API.add(template); else DUALINPUT_BRIDGE_PENDING.push(template); } catch (e) {}`, and the bridge takes every instrument waiting in `DUALINPUT_BRIDGE_PENDING` when it loads.

Our files never go through the sim's `Include.addImports`, which FS Copilot's copy uses.
Stock `VCockpit.js` sets the sim's loader to one script at a time before it loads each instrument's scripts, and in that mode the loader requests a script only once the one before it fires `onload`, so a file of ours that never loads would keep every instrument script behind it from being requested (read in the sim's `common.js`, `IncludeMgr`, not run; [core log][include]).
So the sim creates each instrument exactly as it would without us, and if `bridge.js` never loads, or throws as it loads, the cockpit runs as if Dual Input weren't installed (measured on MSFS 2024, 2026-10-22, [core log](log.md#2026-10-22-stage-5s-bridge-loads-in-all-20-of-the-barons-panels-joins-the-core-on-a-sessions-announcement-and-leaves-the-cockpit-whole-when-bridgejs-is-missing-or-throws-but-two-panels-shared-an-instrument-key)).
The build makes our copy from the stock file it keeps in `src/sim-package/stock/`, putting the two blocks into it at named anchors, and refuses when an anchor is missing, as our prototype refused when one of FS Copilot's markers was (same chapter).
The sim's stock `VCockpit.js` is on disk in our Steam install, in its `asobo-vcockpits-core` package, and a build on a PC with the sim compares the sim's own file with the one we keep ([the sim's stock files](../build/01-the-build.md#the-sims-stock-files); [build log](../build/log.md#2026-10-18-the-sims-stock-vcockpitjs-is-on-disk-in-our-steam-install-in-asobo-vcockpits-core-not-streamed)).

### Panel modules

- Each panel module is a file in `/DualInput/modules/`, built from its feature's `panel/` folder ([the workspace](../architecture/02-code-map.md#the-workspace)), which the bridge loads through a script element of its own when `load` names it.
- A module's `ctx` sends and receives its `unit` messages, asks the bridge for a lock, and watches a slice of client state through `ctx.watch`, as pointer sync's watches its visible lock.
- An unseen lock lapses 2s after the module last renews it; a press that lands on it paints it until that press's up, and a lock a blocked press is held on stays until that up ([pointer sync](../pointer-sync/01-pointer-sync.md#locks)).
- v1 has no plugins, so the bridge has no `ops` module, and a panel module that reads values in a gauge's JavaScript is state sync's `instrument-reads` ([plugins and the sandbox](../plugins/01-plugins.md#reading-it-in-the-panel)).

## Clients beyond the PC

The protocol takes nothing about a client from its address, so a client beyond the PC, such as the tablet in a browser, is one more client once the tablet's design adds a listener and a way in ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
v1 binds no listener beyond 127.0.0.1, because no v1 client could use or test it, and the tablet's design decides how its page is served, its `Origin`, and how its token travels (user, 2026-10-15).
This changes 04-room-for-later, which has v1 build that listener, off by default, and settles the spine's item in [left open](../architecture/01-spine.md#left-open) on how a client beyond the PC is let in, for v1; a web page that connects, opt-in, waits with it.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| A message | Under 64 KiB |
| One round of client state | Under 1ms on the loop |
| Messages to one panel | Under 30 a second, the rate at which sockets in each of 16 cockpit panels cost no frame time we could measure ([the sim's pages](../architecture/01-spine.md#the-sims-pages)) |
| A session's start | Every cockpit panel answered with `load` or `none` within 1s of the profile loading, 20 in the Black Square Baron 58P (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges)) |
| A page after a core restart | Connected again within 2s of the core's next announcement |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- A socket from a browser page closes with 1008, and nothing it sent reaches the loop.
- A `hello` from a client of another version is logged with both versions, and the session runs on.
- A message that doesn't parse is logged and dropped, and a `command` whose arguments don't parse answers with an error.
- The core is suspended for 12s: every client keeps its socket, and once the core runs again, each panel's modules carry on without loading again.
- The core restarts on another port, and every page connects again within 2s of the next announcement.
- A panel told `none` connects no more until the session ends.
- A slice that changes 100 times a second reaches a client at most once a round.
- A command no unit registered answers "unknown".
- A settings file keeps a key no unit registered.
- A cockpit whose `bridge.js` is missing, or throws as it loads, loads every instrument as it would without Dual Input.

## Left open

- The fields of each message: choices inside the message crate.
- Whether a script element's `onerror` fires in Coherent GT for a file that's missing or doesn't parse, which the last case for the bench shows.
- Whether a reloaded panel keeps its `sName`: if it doesn't, its new socket joins beside the old one, which the core closes 8s after the old page's last message (inference); reading `sName` before and after reloading one panel through the sim's inspector settles it.

[p02]: log.md#2026-10-15-iroh-13-already-brings-tokio-websockets-into-the-core-so-serving-the-clients-with-it-keeps-the-core-at-one-websocket-implementation
[include]: log.md#2026-10-15-the-sims-script-loader-holds-every-later-script-behind-one-that-never-loads-while-it-loads-one-at-a-time
[stage5]: log.md#2026-10-22-stage-5s-bridge-loads-in-all-20-of-the-barons-panels-joins-the-core-on-a-sessions-announcement-and-leaves-the-cockpit-whole-when-bridgejs-is-missing-or-throws-but-two-panels-shared-an-instrument-key
