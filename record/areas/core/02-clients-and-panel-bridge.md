# Core: clients and the panel bridge

```text
Purpose:     How the core's clients reach it and talk to it, and how a cockpit panel loads what features run there.
Depends on:  ../architecture/02-code-map.md, ../architecture/01-spine.md, 01-loop-and-edge.md, ../architecture/decisions.md, log.md
Decides:     The core's WebSocket library and its Origin check; the client protocol's messages; how a feature's slice of state reaches the apps; commands, notices, and settings; what a component whose version differs gets; how page-client finds, joins, and rejoins the core; how our VCockpit.js loads the bridge and the bridge loads panel modules; the transport for ops; what v1 builds for clients beyond the PC; and the budgets (node 6.2).
```

The core serves every client over one protocol of JSON messages on a WebSocket, through tokio-websockets, which iroh already brings into the core.
A client opens with a `hello` that names it, its version, and the slices of state it shows, and from then on each side sends something at least every 2s.
A feature reaches the apps through slices of state, which the `clients` crate sends at most every 50ms to the clients that show them, and through commands the apps send it.
In a cockpit panel, our `VCockpit.js` hands each instrument to the panel bridge without ever delaying it, and the bridge loads each panel module a feature's rule gives that panel, from a file of its own.

This answers node 6.2 of the [architecture plan](../architecture/plan.md#62-clients-and-the-panel-bridge).
The spine's [communication](../architecture/01-spine.md#communication), decisions [008](../../decisions/008-every-link-ends-at-core.md) to [011](../../decisions/011-cockpit-panels-connect-only-in-session.md), [013](../../decisions/013-core-accepts-sim-origin-or-none.md), [014](../../decisions/014-apps-find-core-through-port-file.md), and [016](../../decisions/016-core-keeps-pilots-settings.md), the code map's [modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge) and [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), and [01-loop-and-edge](01-loop-and-edge.md) give the rules this design builds on, and this document holds only what they leave out.

## The units

| Unit | Holds |
| --- | --- |
| `apps/core`'s edge | The WebSocket server, its `Origin` check, a tokio task for each socket, and socket IDs from a counter; a socket opening, a text message, and a close come in as inputs, and "send this text" and "close this socket" go out as outputs |
| `clients`, on the loop | The protocol, the table of clients, the keepalive both ways, client state, commands, notices, settings, which panel modules each panel loads, and the transport for `ops` |
| `page-client`, in TypeScript | Hearing the core's announcement, connecting, the `hello`, the keepalive, the goodbye, and handing each message to whoever registered its tag |
| `panel-bridge`, in TypeScript | Our two blocks in `VCockpit.js`, a record of each instrument, loading panel modules, locks and overlays, the `ops` module, and `window.CROSSCHECK_UNLOCK()` |

## The WebSocket server

- **The library is tokio-websockets 0.13.3,** which iroh 1.3 already brings into the core through iroh-relay, so serving the clients with it adds no crate, where tokio-tungstenite 0.30.0 would add a second WebSocket implementation and 15 more crates ([core log][p02]).
  tokio-tungstenite has far more users, from a six-year head start and the frameworks that bring it in, such as axum, poem, and warp (same entry).
- **`Origin`:** `ServerBuilder::accept` writes the upgrade before it returns the request ([core log][p02]), so the edge reads `Origin` from that request at once, and closes a socket whose `Origin` is neither `coui://html_ui` nor absent with code 1008, `CloseCode::POLICY_VIOLATION` (read in tokio-websockets 0.13.3, `src/proto/types.rs`), before reading anything from it.
  No message from it reaches the loop, so [decision 013](../../decisions/013-core-accepts-sim-origin-or-none.md)'s rule holds; a browser page sees its socket open and close, where a refusal during the handshake would have shown it a 403.
- **Limits:** `max_payload_len` has no limit unless set ([core log][p02]), so the edge sets it to 1 MiB, against the budget's 64 KiB for any message, and a message past it closes the socket.
- **Frames:** text only, and a binary message closes the socket.
- **Socket IDs** come from the edge's counter inside each input, so a replay sees the same IDs ([01-loop-and-edge](01-loop-and-edge.md#inputs)).

## The protocol

Each message is JSON with a `t` tag, defined in the message crate's clients module, and a feature's own bodies are defined in its module there.

| `t` | From | Carries |
| --- | --- | --- |
| `hello` | A client | Its component, its version, the message crate's hash, the slices it shows, a `token` that v1 leaves empty ([beyond the PC](#clients-beyond-the-pc)), and for a cockpit panel its instruments' keys |
| `welcome` | The core | The core's version |
| `alive` | Either | Nothing: a side sends it once it has sent nothing for 2s |
| `state` | The core | One slice's name and its whole value |
| `watch` | A client | The slices it shows from now on |
| `command`, then `answer` | A client, then the core | An ID, the command's name, and its arguments; then the same ID, and "taken" or an error |
| `load`, `stop`, `none` | The core, to a cockpit panel | The panel modules to load or to stop, or nothing for this panel, after which it closes its socket ([decision 011](../../decisions/011-cockpit-panels-connect-only-in-session.md)) |
| `module` | Either | A panel module's name and a body of its own, such as pointer sync's press or an `ops` request |
| `bye` | The core | Why the core is going, an exit or a quit ([01-loop-and-edge](01-loop-and-edge.md#exiting)) |

- **Each side sends at least every 2s, and closes after 8s of silence.**
  [Decision 010](../../decisions/010-clients-message-core-every-2s.md) has the clients send every 2s; the core's half lets the EFB app see a core that hangs, and any message from the core renews a panel's locks, the renewal every 2s that [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns) asks for.
  This adds the core's half to decision 010 once step 8's decisions are numbered.
- **A command's answer says only whether the command was taken.**
  What it led to shows in state: a join, for one, answers at once, and its progress shows in the session's slice.
- **`bye`** goes to every client as the core exits, before its outputs drain.
  A panel drops its locks when its socket closes whether or not `bye` came; the apps use it to tell the pilot whether Crosscheck quit or stopped, as FS Copilot's panels told a deliberate shutdown from a crash by its goodbye (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`).

## A component whose version differs

A `hello` whose version or hash differs from the core's is logged by the component's name, with both versions, and the core goes on talking to it (user, 2026-10-15).
The watcher updates the Community package with Crosscheck while the sim is closed ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), so a mismatch mostly means a developer's stale package.
This settles the spine's item in [left open](../architecture/01-spine.md#left-open) on what the core does beyond logging; whether the pilot sees it is part of what counts as trouble, for [6.16](../architecture/plan.md#616-the-apps).

## Client state

- A feature registers a slice with `me.client_state::<S>("take-control", view)`, where `S` is `Serialize + PartialEq` and `view` builds the slice from the feature's state and the platform's.
- Every 50ms, while any client is connected, a timer has `clients` build each slice some client shows, and send each client the slices that changed since it last sent them; a client that starts showing a slice gets it at once.
  The timer bounds the work to 20 rounds a second, however many inputs arrive, and needs no feature to mark what changed.
- A client names the slices it shows in its `hello` and in `watch`, so an app's section asks only for its own feature's slices, and a slice no unit registered, such as a deleted feature's, is ignored.

## Commands, notices, and settings

- **Commands:** `me.command("take-control.request", handler)`, which `clients` calls by name through the kernel once its own handler returns ([01-loop-and-edge](01-loop-and-edge.md#hooks)); a name no unit registered answers "unknown".
- **Notices:** `cx.notice(id, Notice { level, text, action })` raises a notice, and `cx.clear_notice(id)` clears it.
  Its ID is its unit's own, its feature writes its text, its level is information, a warning, or trouble, and its action, if it has one, is the command a click on it sends.
  The notices are a slice of `clients`' own, and where each one shows is [6.16](../architecture/plan.md#616-the-apps)'s.
- **Settings:** a unit registers each setting with a key, a type, and a default, and `clients` keeps them in `settings.json` in the data folder, whose bytes come with the core's first input ([01-loop-and-edge](01-loop-and-edge.md#starting-and-stopping)).
  - A change writes the whole file again, as a job.
  - A stored value that no longer fits its type gives way to the default, and the core logs it.
  - A key no unit registered stays in the file through every write, so a feature deleted and restored finds its values.
  - The desktop app shows the settings as a slice and changes one by command ([decision 016](../../decisions/016-core-keeps-pilots-settings.md)).

## Cockpit panels and their modules

- A feature registers a panel module with a rule that, given the loaded profile, says which instruments get it, as pointer sync's takes the instruments its profile's [`displays`](../profiles/01-format-and-delivery.md#displays) names.
- An instrument's key is the profile's: its identifier, and the query of its panel's URL where several instruments share an identifier, as FS Copilot's channel keyed them (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`, `keyFor`).
- Once the profile has loaded and a panel's `hello` has arrived, `clients` answers it with `load` and the modules its instruments get, or with `none`; a profile that unloads sends `stop`.
- A `hello` naming instruments another socket holds replaces that socket ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)).

## page-client

1. It listens for the core's announcement, a CommBus event named `CROSSCHECK_CORE` whose payload holds the core's port, whether a session runs, and the core's version: the menu script through `ADD_VIEW_LISTENER`, and every other page through `RegisterCommBusListener`, loading `CommBus.js` where the page lacks it ([finding the core](../architecture/01-spine.md#finding-the-core)).
2. When it hears one and has no socket open, it connects to that port and sends its `hello`; a cockpit panel connects only while a session runs.
3. When its socket closes, it connects again on the next announcement, which comes every 2s, so it needs no backoff, and an announcement with another port moves it there.
4. It queues nothing while it has no socket: a send then is dropped, since "stale input is worse than none" (FS Copilot fork, `FsCopilot.Bridge/PackageSources/HTML_UI/FsCopilot/channel.js`), and a core that restarted comes back as a late joiner anyway ([decision 041](../../decisions/041-core-crash-comes-back-as-late-joiner.md)).

It's written in TypeScript compiled to `es2017`, within what Coherent GT runs ([coherent-gt](../architecture/coherent-gt.md)).

## The panel bridge

### Our VCockpit.js

Our `VCockpit.js` is the stock file with two blocks between markers, as FS Copilot's copy has ([06-02](../../learn/foundations/06-02-apis-debugger-and-injection.md#injecting-code-into-panels-overriding-vcockpit-load-order-conflicts-failing-open)):

- The block at the top sets `CROSSCHECK_PENDING = []` and, in a `try`, loads the sim's `CommBus.js` and then `/Crosscheck/bridge.js`, one esbuild bundle of the bridge and page-client, through `Include.addImports`.
- The block in `createInstrument`, after the sim's code has set the instrument up, runs `try { if (window.CROSSCHECK_BRIDGE) CROSSCHECK_BRIDGE.add(template); else CROSSCHECK_PENDING.push(template); } catch (e) {}`, and the bridge takes every instrument waiting in `CROSSCHECK_PENDING` when it loads.

So the sim creates each instrument exactly as it would without us, and if `bridge.js` never loads, the cockpit runs as if Crosscheck weren't installed.
The build makes our copy by putting the two blocks into the stock file at named anchors, and refuses when an anchor is missing, as our prototype refused when one of FS Copilot's markers was (same chapter).
The sim streams its stock file rather than keeping it on disk (same chapter), so how the build gets it after each sim update is [6.18](../architecture/plan.md#618-the-build)'s.

### Panel modules

- Each panel module is a file in `/Crosscheck/modules/`, built from its feature's `panel/` folder ([the workspace](../architecture/02-code-map.md#the-workspace)), which the bridge loads through `Include.addImports` when `load` names it, calling its `start` and `stop` each in a `try` ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)).
- A module's `ctx` sends and receives its `module` messages, and asks the bridge for a lock.

### Locks

A lock holds while messages from the core arrive at least every 2s, which the bridge checks every 2s, so a visible lock turns into a warning 8s to 10s after the core's last message, an unseen one goes, and a closed socket drops every lock at once ([what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns)).

### ops

An `ops` request carries an ID, an operation's name, and its arguments, and its answer carries the same ID and a value or an error; the plugins crate gives up on a request after 1s, through a timer.
Which operations `ops` offers is [6.15](../architecture/plan.md#615-plugins)'s.

## Clients beyond the PC

The protocol takes nothing about a client from its address, and `hello` carries a `token` field, so a client beyond the PC, such as the tablet in a browser, is one more client with a token ([04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client)).
v1 binds no listener beyond 127.0.0.1 and checks no token, because no v1 client could use or test that listener, and the tablet's own design decides how its page is served, its `Origin`, and how its token travels on the home network (user, 2026-10-15).
This changes 04-room-for-later's "v1 builds one protocol that every client speaks, which can listen beyond the PC itself, off by default", whose listener the tablet's design adds, and settles the spine's item in [left open](../architecture/01-spine.md#left-open) on how a client beyond the PC is let in, for v1; a web page that connects, opt-in, waits with it.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures.

| What | Budget |
| --- | --- |
| A message | Under 64 KiB; the edge closes a socket at 1 MiB |
| One round of client state | Under 1ms on the loop |
| Messages to one panel | Under 30 a second, the rate at which sockets in each of 16 cockpit panels cost no frame time we could measure ([the sim's pages](../architecture/01-spine.md#the-sims-pages)) |
| A session's start | All 20 of the Baron's panels answered with `load` or `none` within 1s of the profile loading |
| A page after a core restart | Connected again within 2s of the core's next announcement |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- A socket from a browser page closes with 1008, and nothing it sent reaches the loop.
- A `hello` from a component of another version is logged with both versions, and the session runs on.
- A panel that reloads takes over its old socket's instruments.
- A suspended core: every client sees the silence within 8s, and each visible lock turns into a warning.
- The core restarts on another port, and every page connects again within 2s of the next announcement.
- A slice that changes 100 times a second reaches a client at most 20 times.
- A command no unit registered answers "unknown".
- A settings file keeps a key no unit registered.
- An `ops` request nobody answers gives up after 1s.
- A cockpit whose `bridge.js` is missing, or throws as it loads, loads every instrument as it would without Crosscheck.

## Left open

- The fields of each message, and the 50ms between rounds of client state: choices inside the message crate and `clients`.
- Whether `Include.addImports` goes on loading after a file that fails to parse, already a case for the bench ([modules in the panel bridge](../architecture/02-code-map.md#modules-in-the-panel-bridge)).

[p02]: log.md#2026-10-15-iroh-13-already-brings-tokio-websockets-into-the-core-with-15-fewer-crates-than-tokio-tungstenite-would-add
