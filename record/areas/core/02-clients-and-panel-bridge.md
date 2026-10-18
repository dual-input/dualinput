# Core: clients and the panel bridge

```text
Purpose:     How the core's clients reach it and talk to it, and how a cockpit panel loads what features run there.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, ../architecture/decisions.md, log.md
Decides:     The core's WebSocket library and its Origin check; the client protocol's messages; how a unit's state, commands, and messages reach the clients; notices and settings; the moments the clients crate raises; what a client whose version differs gets; how page-client finds, joins, and rejoins the core; how our VCockpit.js loads the bridge and the bridge loads panel modules; the transport for ops; what v1 builds for clients beyond the PC; and the budgets (node 6.2).
```

> **Note**
> Since 2026-10-15, every name the sim shares is `CROSSCHECK_<KIND>_<NAME>` ([names the sim shares](../architecture/02-code-map.md#names-the-sim-shares)), so the core's announcement is `CROSSCHECK_CORE_ANNOUNCE`, where [page-client](#page-client) has `CROSSCHECK_CORE`, and the bridge's globals are `CROSSCHECK_BRIDGE_API`, `CROSSCHECK_BRIDGE_PENDING`, and `window.CROSSCHECK_BRIDGE_UNLOCK()`, where [the units](#the-units) and [our VCockpit.js](#our-vcockpitjs) have `CROSSCHECK_BRIDGE`, `CROSSCHECK_PENDING`, and `window.CROSSCHECK_UNLOCK()` ([03-sim-seam-and-wasm-module](03-sim-seam-and-wasm-module.md)).
> Since 2026-10-16, the core sends each client `alive` every 2s whatever else it sends, where [the protocol](#the-protocol) has it send `alive` once it has sent nothing for 2s, so a slice of a partly recorded unit, which drifts in a replay, never moves when the core's `alive` goes out; and a partly recorded unit's slice is left out of a replay's check ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#what-keeps-the-drift-from-spreading)).
> Since 2026-10-17, beside what [panel modules](#panel-modules) has a `ctx` do, a panel module's `ctx` watches a slice of client state through `ctx.watch`, as pointer sync's watches its visible lock, and `load` names each module's instruments.
> An unseen lock lapses 2s after the module last renews it, where [the protocol](#the-protocol) has any message from the core renew a panel's locks; a press that lands on it paints it until that press's up, and a lock a blocked press is held on stays until that up ([pointer sync](../pointer-sync/01-pointer-sync.md#locks)).
> Since 2026-10-17, v1 has no plugins, so the panel bridge has no `ops` module and `clients` carries no `ops` request, where [the units](#the-units), [the protocol](#the-protocol), [the moments clients raises](#the-moments-clients-raises-and-the-calls-it-takes), and [ops](#ops) have them, and the case for the bench on an unanswered `ops` request goes; a panel module that reads values in a gauge's JavaScript is state sync's `instrument-reads` ([plugins and the sandbox](../plugins/01-plugins.md#reading-it-in-the-panel)).
> Since 2026-10-17, [the apps' design](../interface/01-apps.md) changes this document in four places:
>
> - Any client changes any setting with `clients`' command, where [what a unit registers and calls](#what-a-unit-registers-and-calls) has the desktop app change them, and a setting also registers a label and what an app needs that its type doesn't say, while a development setting shows in no app ([settings](../interface/01-apps.md#settings)).
> - A `unit` message also reaches an app's part, by its unit's name; `clients` also holds a command for a notice clicked outside its action and one that brings the desktop app forward, and its slice says whether a banner page's socket is open; and `page-client` gives its page the connection's state ([the apps](../interface/01-apps.md#slices-and-commands)).
> - `clients` raises a trouble notice when no cockpit panel's `hello` comes within 10s of the profile loading ([trouble](../interface/01-apps.md#trouble)).
> - A client whose version differs is logged and nothing more, which settles what [a client whose version differs](#a-client-whose-version-differs) leaves to 6.16; where a notice shows waits for the apps' stage.
>
> Since 2026-10-18, the sim's stock `VCockpit.js` is on disk in our Steam install, in its `asobo-vcockpits-core` package, where [our VCockpit.js](#our-vcockpitjs) has the sim stream it; the build makes our copy from the stock file it keeps in `sim-package/stock/`, and a build on a PC with the sim compares the sim's own file with it ([the sim's stock files](../build/01-the-build.md#the-sims-stock-files); [build log](../build/log.md#2026-10-18-the-sims-stock-vcockpitjs-is-on-disk-in-our-steam-install-in-asobo-vcockpits-core-not-streamed)).

The core serves every client over one protocol of JSON messages on a WebSocket, through tokio-websockets, which iroh already brings into the core.
A client opens with a `hello` that names it and its version, and from then on each side sends something at least every 2s, while only the core closes a socket that goes quiet.
A unit reaches the clients through slices of state, which the `clients` crate sends on a timer to the clients that show them, through commands the clients send it, and through messages of its own to a client by name.
In a cockpit panel, our `VCockpit.js` hands each instrument to the panel bridge without ever delaying it, and loads our files through script elements of its own, outside the sim's script loader.

This answers node 6.2 of the [architecture plan](../architecture/plan.md#62-clients-and-the-panel-bridge).
The spine's [communication](../architecture/01-spine.md#communication), decisions [008](../../decisions/008-every-link-ends-at-core.md) to [011](../../decisions/011-cockpit-panels-connect-only-in-session.md), [013](../../decisions/013-core-accepts-sim-origin-or-none.md), [014](../../decisions/014-apps-find-core-through-port-file.md), and [016](../../decisions/016-core-keeps-pilots-settings.md), the code map's [modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge) and [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), and [01-loop-and-edge](01-loop-and-edge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| `apps/core`'s edge | The WebSocket server, its `Origin` check, and a tokio task for each socket; a socket opening, a text message, and a close come in as inputs, and "send this text" and "close this socket" go out as outputs |
| `clients`, on the loop | The protocol, the table of clients, the keepalive, client state, commands, messages to clients, notices, settings, which panel modules each panel loads, and the transport for `ops`; it raises a client joining or leaving, a panel's socket replaced, and a setting changed |
| `page-client`, in TypeScript | Hearing the core's announcement, connecting, the `hello`, the keepalive, and handing each message to whoever registered its tag |
| `panel-bridge`, in TypeScript | Our two blocks in `VCockpit.js`, a record of each instrument, loading panel modules, locks and overlays, the `ops` module, and `window.CROSSCHECK_UNLOCK()` |

## The WebSocket server

- **The library is tokio-websockets 0.13.3.**
  iroh 1.3 already brings it into the core through iroh-relay, so serving the clients with it keeps the core at one WebSocket implementation, where tokio-tungstenite 0.30.0 would add a second ([core log][p02]).
  The core turns on its `server` feature, which iroh-relay leaves off and which adds no crate (same entry).
- **`Origin`:** `ServerBuilder::accept` writes the upgrade before it returns the request ([core log][p02]), so the edge reads `Origin` from that request at once, and closes a socket whose `Origin` is neither `coui://html_ui` nor absent with code 1008, `CloseCode::POLICY_VIOLATION` (read in tokio-websockets 0.13.3, `src/proto/types.rs`), before reading anything from it.
  No message from it reaches the loop, so [decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md)'s rule holds.
- **Limits:** tokio-websockets' `Limits` cap a message at 64 MiB by default ([core log][p02]); the edge sets 1 MiB, sixteen times the [budget](#budgets)'s 64 KiB, so a message over budget still arrives and the bench catches it, while a runaway closes the socket.
  Only text is taken, and a binary message closes the socket.
- **Socket IDs** come from a counter at the edge, inside each input, so a replay sees the same IDs.

## The protocol

Each message is JSON with a `t` tag, defined in the message crate's clients module, and a unit's own bodies are defined in its module there.

| `t` | From | Carries |
| --- | --- | --- |
| `hello` | A client | Its component, its version, the message crate's hash, and for a cockpit panel its instruments' keys |
| `alive` | Either | Nothing: a side sends it once it has sent nothing for 2s |
| `watch` | A client | The slices of state it shows, after its `hello` and whenever that changes |
| `state` | The core | One slice's name and its whole value |
| `command`, then `answer` | A client, then the core | An ID, the command's name, and its arguments; then the same ID, and "taken" or an error |
| `unit` | Either | A unit's name and a body of its own: a panel module's press, an `ops` request, the sim service's world-map request to the menu script, or the order that opens the EFB onto our app |
| `load`, `stop`, `none` | The core, to a cockpit panel | The panel modules to load or to stop, or nothing for this panel, after which it closes its socket ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) |
| `bye` | The core | Nothing: the core sends it as it quits ([01-loop-and-edge](01-loop-and-edge.md#quitting)) |

- **Each side sends at least every 2s, and only the core closes a socket that has been quiet for 8s.**
  [Decision 010](../../decisions/010-clients-message-core-every-2s.md) has the clients' message every 2s and the core's close after 8s; the core's own message every 2s is this design's, and adds to decision 010 once step 8's decisions are numbered.
  A client notes the core's silence and keeps its socket, and the EFB app can show it.
  Any message from the core renews a panel's locks, so when the core hangs, the bridge turns a visible lock into a warning 8s to 10s after the core's last message, as the code map's [how work in the sim ends](../architecture/02-code-map.md#how-work-in-the-sim-ends) has it.
- **A command's answer says only whether the command was taken.**
  What it led to shows in state: a join, for one, answers at once, and its progress shows in the session's slice.
- **`bye`** goes to every client when the session crate quits, which asks `clients` for it in the handler that puts out the exit; the apps use it to tell the pilot that Crosscheck quit rather than stopped, as FS Copilot's panels told a deliberate shutdown from a crash by its goodbye (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`).
- **A message that doesn't parse never stops the core.**
  `clients` reads a `hello`'s component, version, and hash before the rest of it, so a client is always named; it logs and drops any other message that doesn't parse, with its client's name, and answers a `command` whose arguments don't parse with an error.

## A client whose version differs

A `hello` whose version or hash differs from the core's is logged by the client's name, with both versions, and the core goes on talking to it (user, 2026-10-15).
The watcher updates the Community package with Crosscheck while the sim is closed ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so we expect a mismatch to mean a developer's stale package (inference).
This settles, for the WebSocket clients, the spine's item in [left open](../architecture/01-spine.md#left-open) on what the core does beyond logging; our WASM module, whose data slots are structs the module reads in place ([messages and their types](../architecture/01-spine.md#messages-and-their-types)), is [6.3](../architecture/plan.md#63-the-sim-seam-and-our-wasm-module)'s, and whether the pilot sees a mismatch is [6.16](../architecture/plan.md#616-the-apps)'s.

## What a unit registers and calls

```rust
// a sketch, beside 01-loop-and-edge's
me.client_state::<TakeControlView>("take-control", view);   // a slice, built by `view` from the unit's state and the platform's
me.command("take-control.request", TakeControl::request);   // a command, called by name
cx.send(To::Component("menu-script"), body);                  // a message to a client
cx.notice(id, Notice { level, text, action });                // a notice, and cx.clear_notice(id)
```

- **Client state:** while any client is connected, `clients` runs a timer every 50ms, a starting value, and each time it fires, `clients` builds each slice some client shows, and sends each client the slices whose value differs from the one it last sent that client.
  A client that starts showing a slice gets it at once.
  The timer bounds the work however many inputs arrive, and needs no unit to mark what changed.
  A slice no unit registered, such as a deleted feature's, is ignored.
- **Commands:** `clients` calls a command's handler by name, through the kernel, once its own handler returns ([01-loop-and-edge](01-loop-and-edge.md#hooks)); a name no unit registered answers "unknown".
- **Messages to a client:** `cx.send` puts out a `unit` message to every client of a component, or to a panel module, and a client's `unit` message reaches the unit that registered its name.
  Unlike a slice, a message goes once, so a client that connects later never gets it: a menu script that reconnects never gets a world-map request the sim service sent before it.
- **Notices:** a notice's ID is its unit's own, its feature writes its text, its level is information, a warning, or trouble, and its action, if it has one, is the command a click on it sends.
  The notices are a slice of `clients`' own, and where each one shows is [6.16](../architecture/plan.md#616-the-apps)'s.
- **Settings:** a unit registers each setting with a key, a type, and a default, and `clients` keeps them in `settings.json` in the data folder, whose bytes come with the core's first input ([01-loop-and-edge](01-loop-and-edge.md#starting-and-stopping)).
  - A change writes the whole file again, as a job.
  - A stored value that no longer fits its type gives way to the default, and the core logs it.
  - A key no unit registered stays in the file through every write, so a feature deleted and restored finds its values.
  - The desktop app shows the settings as a slice and changes one by command ([decision 016](../../decisions/016-core-keeps-pilots-settings.md)).

## The moments clients raises, and the calls it takes

`clients` sits below most of the platform in the code map's [units](../architecture/02-code-map.md#the-units), so it tells the crates above it through moments, and they reach it through calls it declares:

| Moment | Raised when | Such as |
| --- | --- | --- |
| A client joined, or left | A `hello` arrives, or a socket closes, with the client's component | The session crate exits once the desktop app has gone and the rest of the spine's rule holds ([what moves them](../architecture/01-spine.md#what-moves-them)) |
| A panel's socket replaced | A `hello` names instruments another socket holds | Pointer sync counts a press sent to the old socket that its panel never played as applied ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)) |
| A setting changed | A command changes a setting, with its key | The core-helper-service gives the core helper a rebound take-control key |

- The profile loader hands `clients` the profile it loaded, and its unload, so `clients` can run the panel modules' rules.
- The session crate asks `clients` for `bye` before it puts out the exit.
- The plugins crate sends `ops` requests through `clients`.

## Cockpit panels and their modules

- A panel module's rule picks instruments, given the loaded profile, as pointer sync's takes the instruments its profile's [`displays`](../profiles/01-format-and-delivery.md#displays) names.
- An instrument's key is its identifier, or its tag's name if it has none, followed by `|` and the query of its `url` attribute where it has one, as FS Copilot's `Channel.keyFor` joins them (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`), the key the profile's `displays` names.
- Once the profile has loaded and a panel's `hello` has arrived, `clients` answers the panel with `load` and the modules its instruments get, or with `none`; a profile that unloads sends `stop`.
- A panel told `none` stays closed until an announcement brings another port or says the session ended, so it connects once a session.

## page-client

1. It listens for the core's announcement, a CommBus event named `CROSSCHECK_CORE` whose payload holds the core's port and whether a session runs, by each kind of page's route in [finding the core](../architecture/01-spine.md#finding-the-core).
   The event's name is new in this design.
2. When it hears an announcement with no socket open, or one naming a port other than its socket's, it connects to that port and sends its `hello`; a cockpit panel connects only to an announcement that says a session runs ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)).
3. When its socket closes, it connects again on the next announcement, so it needs no backoff.
4. It queues nothing while it has no socket, and a send then is dropped: a core that restarted comes back as a late joiner ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)), and a press played into a cockpit already caught up would undo the catch-up.
   FS Copilot's channel kept up to 200 messages for at most 30s, since "stale input is worse than none" (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`, `MAX_QUEUE` and `MAX_QUEUE_AGE_MS`); ours keeps none.

## The panel bridge

### Our VCockpit.js

Our `VCockpit.js` is the stock file with two blocks between markers, as FS Copilot's copy has ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)):

- The block at the top sets `CROSSCHECK_PENDING = []` and, in a `try`, adds a script element of its own for `/Crosscheck/bridge.js`, one esbuild bundle of the bridge and page-client, which loads the sim's `CommBus.js` the same way where the panel lacks it.
- The block in `createInstrument`, after the sim's code has set the instrument up, runs `try { if (window.CROSSCHECK_BRIDGE) CROSSCHECK_BRIDGE.add(template); else CROSSCHECK_PENDING.push(template); } catch (e) {}`, and the bridge takes every instrument waiting in `CROSSCHECK_PENDING` when it loads.

Our files never go through the sim's `Include.addImports`, which FS Copilot's copy uses.
Stock `VCockpit.js` sets the sim's loader to one script at a time before it loads each instrument's scripts, and in that mode the loader requests a script only once the one before it fires `onload`, so a file of ours that never loads would keep every instrument script behind it from being requested (read in the sim's `common.js`, `IncludeMgr`, not run; [core log][include]).
So the sim creates each instrument exactly as it would without us, and if `bridge.js` never loads, the cockpit should run as if Crosscheck weren't installed (unverified; a case for the bench settles it).
The build makes our copy by putting the two blocks into the stock file at named anchors, and refuses when an anchor is missing, as our prototype refused when one of FS Copilot's markers was (same chapter).
The sim streams its stock file rather than keeping it on disk (same chapter), so how the build gets it after each sim update is [6.18](../architecture/plan.md#618-the-build)'s.

### Panel modules

- Each panel module is a file in `/Crosscheck/modules/`, built from its feature's `panel/` folder ([the workspace](../architecture/02-code-map.md#the-workspace)), which the bridge loads through a script element of its own when `load` names it.
- A module's `ctx` sends and receives its `unit` messages, and asks the bridge for a lock.

### ops

An `ops` request carries an ID, an operation's name, and its arguments, and its answer carries the same ID and a value or an error; the plugins crate gives up on a request after 1s, through a timer.
Which operations `ops` offers is [6.15](../architecture/plan.md#615-plugins)'s.

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
- An `ops` request nobody answers gives up after 1s.
- A cockpit whose `bridge.js` is missing, or throws as it loads, loads every instrument as it would without Crosscheck.

## Left open

- The fields of each message: choices inside the message crate.
- Whether a script element's `onerror` fires in Coherent GT for a file that's missing or doesn't parse, which the last case for the bench shows.

[p02]: log.md#2026-10-15-iroh-13-already-brings-tokio-websockets-into-the-core-so-serving-the-clients-with-it-keeps-the-core-at-one-websocket-implementation
[include]: log.md#2026-10-15-the-sims-script-loader-holds-every-later-script-behind-one-that-never-loads-while-it-loads-one-at-a-time
