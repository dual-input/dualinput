# Session: its units

```text
Purpose:     The session crate's interfaces, and how rate and pause, Go to, and the menu script work as the session's features.
Depends on:  01-roles-and-members.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../profiles/01-format-and-delivery.md, ../profiles/02-units.md, ../sync/04-order-and-recovery.md, ../sync/05-units.md, ../avatars/01-avatars.md, ../traffic-atc/01-traffic-and-atc.md, ../interface/01-apps.md, ../install/01-installing-and-updating.md, ../product/03-v1-scope.md, ../environment/log.md, ../interface/log.md, ../aircraft/log.md
Decides:     The session crate's members, session keys, control, session file, joining and leaving, preflight, match check, and what it raises; who is in the flight; which pilot's bundle a session pins; where the match check reads an aircraft's version; how rate and pause sets active pause and the simulation rate; how Go to picks a stand or a runway; what the menu script reports and runs; when the core exits; the budgets; and the cases for the bench (node 6.7).
```

The session crate keeps the members, the session's keys, control, the session file, preflight, and the match check, and decides every request about them on the loop; the network carries its keys, and the features hang off its moments.
Every core works out who is in the flight from a key each member writes about its own sim, so a pilot in another aircraft joins and waits out of the flight, and control, preflight, and the session's end all turn on that one rule.
The PF's core sets the session's aircraft, runs preflight's countdown, and ends preflight with a key, and its profile loader pins a local bundle that covers that aircraft, or else the one its cached index gives its level.
Rate and pause sets active pause through the EFB app, the one way we found, and Go to puts a joiner on a runway, engines running, whenever the PF's engines run.

This answers node 6.7 of the [architecture plan](../architecture/plan.md#67-the-session).
[01-roles-and-members](01-roles-and-members.md), the code map's [what a feature registers](../architecture/02-code-map.md#what-a-feature-registers) and [guards](../architecture/02-code-map.md#guards), [02-units](../network/02-units.md#requests-the-session-crate-makes)'s requests, and [03-v1-scope](../product/03-v1-scope.md#session)'s session, preflight, and match check give the rules this design builds on, and this document holds only what they leave out.
The flying machine is the PF's, and a following machine is any other pilot's.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `session` | Platform | The members, the session's keys and their stamps, control, the session file, joining and leaving, preflight and `Hold`, the match check and its items, the display name setting, and when the core exits | On the loop |
| `rate-and-pause` | Feature | Active pause, the simulation rate, the pause menu's notice, and the match check's time of day | Its crate in the core, and a part in the EFB app |
| `go-to` | Feature | The PF's spot and the Go to button | Its crate in the core, and a section in the desktop app |
| The menu script | Platform outside the core | Reporting the menu's page, and running the world map's requests | In mainUi, through our copy of BlurPage, in `src/sim-package/pages` |

The session crate depends on the kernel, `clients`, `sim-service`, and `network`, as the code map's [platform](../architecture/02-code-map.md#the-platform) row has it, and tells the recording crate nothing, since v1 writes no index of a run's sessions (user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).
The crates above it reach it through its moments, its requests, and the keys they declare: the profile loader writes the pinned bundle, state sync guards Ready, and the cockpit stream guards control.
The session crate and Go to each register a slice of client state, which [slices and commands](../interface/01-apps.md#slices-and-commands) lists.

## Members

- A member is a pilot ID with the restart count and endpoint ID of its latest first message, as [02-units](../network/02-units.md#moments) has it.
- This core is a member from the session's start for it ([joining and leaving](#joining-and-leaving)); another is a member from its first `LinkUp`, and stops being one at `MemberLeft` or `MemberOut`, or when another member's `status` key lists it as left.
- Each member writes four keys of its own on the session channel:

| Key | Holds | Rewritten |
| --- | --- | --- |
| `member` | Pilot ID, display name, kind, and endpoint ID ([01-roles-and-members](01-roles-and-members.md#the-member-list)) | Never, after the first message |
| `status` | Its sim awareness's stage, aircraft, and pause flags, its aircraft's title, how its last sim run ended, and its link to each other member: up, lost, or left | On each `SimChanged`, each change of the aircraft's facts, and each link change |
| `ready` | Its Ready during preflight, and the members it goes without | On Ready, un-ready, and Go without |
| `match` | Its value for each item of the match check | When one of its values changes ([the match check](#the-match-check)) |

- The `status` key's links let every pilot's banner show the whole crew, as [the connection](../product/03-v1-scope.md#the-connection) asks, and tell a member that can't reach a leaver that they left, as [leaving](../network/01-between-machines.md#leaving) asks of the session channel.
- A member that leaves takes its own keys with it, and the session crate clears every session-wide key whose value names it.
- The display name is a setting the session crate registers, empty at first, which any app writes with `clients`' settings command ([settings](../interface/01-apps.md#settings)).
  Host and Join answer that a name is needed while it's empty, and Dual Input asks the pilot for one, in a place the apps' design picks.
  Nothing fills it from the Windows account, whose name would reach crewmates and their recordings (user, 2026-10-16).
- Each member joining, and each one gone, raises `MemberJoined` or `MemberGone`.

## In the flight

A member is in the flight while its `status` key's stage is Ready to fly or Flying and its aircraft is the session's, folder and preset, compared ignoring case ([the aircraft](../core/03-sim-seam-and-wasm-module.md#the-aircraft)).
Every core works this out the same way, with one function of the session crate's, from the keys it holds, so no member writes a yes or no of its own, and a change of the session's aircraft moves every member's answer at once.

- A change of any member's answer raises `FlightChanged { member, in_flight }`.
- Nothing of the flight acts on a member out of it: the cockpit stream applies nothing on its machine ([the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream)), the profile loader loads nothing for another aircraft, and control can't pass to it.
- A pilot who joins in another aircraft joins and is out of the flight, with a notice to load the session's aircraft, such as "Load the Baron 58P to fly with James", and the crew sees "Adam is in the A320" (user, 2026-10-16).
  Nothing has to know the session's aircraft before a join, and a pilot cut off for 30 minutes, or who pressed Leave by mistake, types the code again from their flight.
- Before the PF has loaded a flight, the session has no aircraft and nobody is in the flight, and a joiner sees "James hasn't loaded a flight yet".
- Once preflight has ended, a core that sees no member in the flight leaves the session, so the session ends ([the PF](01-roles-and-members.md#the-pf)).

## Session keys

```rust
// a sketch: the message crate's rate-and-pause module; the numbers are hypothetical
pub const PAUSE: Key<bool> = Key::new(40, Writer::Anyone);   // any member, settled by the stamp
pub const RATE: Key<f32> = Key::new(41, Writer::PilotFlying); // the flying machine alone

// a sketch: rate and pause in the core
pub fn register(r: &mut Registry) {
    let me = r.unit::<RateAndPause>("rate-and-pause");
    me.session_key(rate_and_pause::PAUSE);
    me.session_key(rate_and_pause::RATE);
    me.on::<KeyChanged>(RateAndPause::apply);
    me.on::<SimChanged>(RateAndPause::read);
}

fn read(me: &mut RateAndPause, _: &SimChanged, cx: &mut Cx) {
    let active = cx.read::<SimAwareness>().pause.active();
    let session = cx.read::<Session>();
    if session.in_flight(session.me()) && session.key(rate_and_pause::PAUSE) != Some(&active) {
        cx.ask(WriteKeys::one(rate_and_pause::PAUSE, &active));    // the session crate decides it
    }
}
```

- A key is a constant in its owner's module of the message crate: a number, its value's type, its writer, and whether its value names a member.
  A test fails on two keys with one number, as on two channels ([channels and sends](../network/02-units.md#channels-and-sends)).
- A key's writer is one of three, where the code map's hook has two, one member or the whole session:
  - `Member`: each member writes its own copy, such as `ready`.
  - `Anyone`: any member writes it, and the stamp settles two writes, such as active pause.
  - `PilotFlying`: only the PF writes it, and the session crate drops a value from anyone else, such as the simulation rate or `preflight`.
- Every write is a request, `WriteKeys`, so a feature never changes a key itself, and any guard on one key refuses the whole request, as [the traffic and ATC switch](../architecture/02-code-map.md#the-traffic-and-atc-switch) needs.
  The apps show its verdict on the "Share my traffic and ATC" switch, which the kernel builds as this pilot claiming every role key a feature declared.
  The switch is the session crate's command, and each role key registers a label in its feature's words ([slices and commands](../interface/01-apps.md#slices-and-commands)).
- A key's stamp is [channels](../network/01-between-machines.md#channels)'s, and each change, local or arriving, raises `KeyChanged { key }`.
- The session crate fills each connection's first message with every key it holds, through the opener hook, as [the first message](../network/02-units.md#the-first-message) has it.
- A handler reads a key with `cx.read::<Session>().key(KEY)`, which gives the value, and for a `Member` key, each member's.

Beside each member's four, the session crate has two session-wide keys: `control`, the generation and the PF's pilot ID, which [control](../network/01-between-machines.md#control) orders; and `preflight`, a `PilotFlying` key holding the session's aircraft, folder and preset, or none, and preflight's phase ([preflight](#preflight)).
Seat claims ride avatars' poses, so the session crate holds none ([the pose](../avatars/01-avatars.md#the-pose)).

## Control

- The session crate declares `TakeControl`, built as this pilot taking control now; the take-control key and button each ask it ([6.12](../architecture/plan.md#612-control)), and no voice answer asks for control in v1, since the voice phrases are a Soon pick (user, 2026-10-18).
- Two guards ride it: the session crate's own, live only while this pilot is in the flight and preflight has ended, and the cockpit stream's, which holds control back from a pilot whose catch-up or replay runs over a link that's up ([guards](../architecture/02-code-map.md#guards)).
- When a session starts, the host's core writes `control` naming its pilot, since the host is the PF when a session starts ([take-control key](../product/03-v1-scope.md#take-control-key)).
- A pass the platform makes itself isn't a request.
  The session crate makes one when this core's pilot holds control and leaves the flight, before its Leave or quit, and when a restarted core's first message has passed with the crew, before it raises its own `FlightChanged` ([a core that restarts](../sync/04-order-and-recovery.md#a-core-that-restarts)).
  - It goes to a member in the flight, an up-to-date one where there is one ([the PF](01-roles-and-members.md#the-pf)); with v1's two pilots that's the other one, and how the session crate tells which of several is up to date is for the pick that brings larger crews, which adds a check to the pass and changes nothing here.
  - With nobody in the flight before preflight ends, a PF who leaves the session passes control to the other member anyway, so a PF remains to finish preflight, and a PF who only leaves the flight keeps it.
    After preflight ends, nobody in the flight ends the session instead ([in the flight](#in-the-flight)).
- Every change writes `control`, as [control](../network/01-between-machines.md#control) orders it, writes every `Anyone` and `PilotFlying` key again under the new value, and raises `ControlPassed { before, after, made_here }`.
- [04-order-and-recovery](../sync/04-order-and-recovery.md#a-change-of-control) has each change of control carry its maker's vector clock, which the session crate can't read, since the cockpit stream sits above it; on `ControlPassed` with `made_here`, the cockpit stream sends a message of its own kind, whose vector clock is the maker's, which is [6.9](../architecture/plan.md#69-sync)'s to design.

## The session file

- The session file is JSON in the data folder, through serde_json, holding what [the session file](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts) and [02-units](../network/02-units.md#requests-the-session-crate-makes) put in it, and the run of the sim it last saw.
- The session crate writes it as a job, where [02-units](../network/02-units.md#requests-the-session-crate-makes) orders it, again when the crew or the sim's run changes, and deletes it when the session ends for this core.
- A core that starts and finds it raises the restart count, writes it, and asks `Open` with the crew it holds.
- The run of the sim tells the crew's notice whether a restarted core's sim kept running, and how its last run ended tells a close from a crash ([a crash and a close](../core/03-sim-seam-and-wasm-module.md#a-crash-and-a-close)).

## Joining and leaving

| Command | The session crate |
| --- | --- |
| Host | Draws the session's ID and this pilot's ID with `cx.new_id()`, asks `Host`, and on the code, writes the file and asks `Open` with no crew |
| Join, with a code | Draws this pilot's ID and asks `Join`; on the backend's answer, writes the file and asks `Open` with the crew; on a refusal, shows it as a notice, naming whose version is older ([its requests](../network/02-units.md#its-requests)) |
| The code box selected, in the EFB app | Reads the clipboard as a job, which hands up only an invite code ([what stays out](../recording/01-recording-and-bug-reports.md#what-stays-out)), and joins with it at once |
| Leave | Un-readies during preflight, passes control if this pilot holds it, and asks `Leave` as [leaving](../network/01-between-machines.md#leaving) orders it |
| Quit, from any client, the desktop app's tray among them ([quit](../interface/01-apps.md#quit)) | Leaves as above with the quit code, asks `clients` for `bye`, and puts out the exit, as [quitting](../core/01-loop-and-edge.md#quitting) requires |

- A session starts for this core at its `BackendAnswered`, or when it starts and finds a session file: the session crate raises `SessionStarted` and calls `sim_service::announce(cx, true)` ([the announcement](../core/03-sim-seam-and-wasm-module.md#the-announcement)).
- Host and Join are refused while a session is held.
- The session ends for this core at Leave, at `MemberOut` for the last other member, or when no member is in the flight after preflight; it then deletes the file, raises `SessionEnded`, and calls `sim_service::announce(cx, false)`.
- Windows ending the pilot's session ends the core with no quit, since the core keeps no window to hear `WM_QUERYENDSESSION`, so the crew sees a lost link rather than a leave (user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
- The core exits once sim awareness says a run of the sim has closed, no session is held, and no desktop app is connected, which `clients`' moments tell ([what moves them](../architecture/01-spine.md#what-moves-them)), and after a quit; a core that starts before the sim doesn't exit on the Closed it starts in, since no run of the sim has closed yet.

## Preflight

The PF's core runs preflight, since the flying machine is the session's authority ([the connection](../product/03-v1-scope.md#the-connection)), and every core follows its `preflight` key:

| Phase | Entered when | Every core |
| --- | --- | --- |
| No aircraft | The session starts, or the PF leaves the flight before preflight ends with nobody else in it | Holds nothing |
| Running | The PF is in a flight on the ground | Feeds `Hold` while its pilot is in the flight, and each member writes `ready` |
| The countdown | Every counted member is ready | Shows the 3s countdown |
| Ended | The PF's 3s timer fires, or the PF is first in a flight with `A:SIM ON GROUND` at 0, so there's no preflight ([preflight](../product/03-v1-scope.md#preflight)) | Raises `PreflightEnded` once, when it first sees the phase, which ends `Hold` |

- **The session's aircraft:** the PF's core writes it into `preflight` whenever its pilot is in a flight and the key holds no aircraft or, before preflight ends, another, so a host already in a flight sets it at once, and a host who loaded the wrong aircraft reloads; after preflight ends it stays.
  A PF who leaves the flight while another member is in it passes control first, so the aircraft stays the one the new PF flies.
- **Who counts:** every member that no member's `ready` key goes without; a counted member is ready when its `ready` key says so, it's in the flight, and the PF's link to it is up.
- **Ready** is a request the session crate declares, with its own guard, this pilot in the flight while preflight runs, and state sync's, which holds it until the aircraft has settled ([settling after a load](../sync/03-catch-up.md#settling-after-a-load)).
  A member that loses a link or leaves the flight during preflight writes its Ready off, so it comes back unready, and either counts as dropping out.
- **The countdown:** the PF's core starts a 3s timer when every counted member is ready, and goes back to running, the timer canceled, when one isn't; an un-ready that reaches it after the timer fired is too late, and the flight starts.
- **Go without:** a ready pilot names a counted member who has dropped out, and the session crate adds it to that pilot's own `ready` key.
  The PF can't be named, since control stays with a PF whose link is lost, so preflight waits for a PF who dropped out until they come back, leave the flight, which passes control, or are counted out at 30 minutes.
- **A late joiner** enters the flight after preflight ended and skips Ready; the cockpit stream starts their catch-up when their profile loads, since a joiner's profile loads only once it's in the flight ([while catch-up runs](../sync/03-catch-up.md#while-catch-up-runs), [catch-up](../sync/05-units.md#catch-up)).
  A member the crew went without whose sim kept running never changes its answer, and raises `PreflightEnded` when it comes back and first sees the phase, so its catch-up starts there, and what its replay brings that the catch-up covers drops as a copy ([catch-up](../sync/04-order-and-recovery.md#catch-up)).
- The PF's checklist of counted controls is state sync's, beside the preflight summary ([preflight](../product/03-v1-scope.md#preflight)).

## The match check

```rust
// a sketch: rate and pause's item; `set_match` is a hypothetical name
me.match_item(rate_and_pause::TIME_OF_DAY);   // a value of the item's type, which compares itself
me.on::<FlightChanged>(|me, _, cx| cx.set_match(rate_and_pause::TIME_OF_DAY, me.time_of_day(cx)));   // handed over when a member enters the flight
```

- The session crate keeps the items, its own and the features'.
  Each item's owner hands it the item's value whenever the value changes, and the session crate writes this member's `match` key on each, so a profile that loads after its member entered the flight shows as loaded (user, 2026-10-18).
  Rate and pause hands it the sim's time when a member enters the flight, so a late join compares fresh values ([preflight match check](../product/03-v1-scope.md#preflight-match-check); user, 2026-10-18).
- Each core compares every member's values item by item, with the item's own comparison, which names an error or a warning and gives the difference's words, and shows the differences beside each Ready and as counts on the banner's summary.
  The session crate's slice carries them, each with its level and its item's words ([slices and commands](../interface/01-apps.md#slices-and-commands)).
- A feature that a difference breaks reads the result and turns itself off for the session.
- The aircraft's folder and preset aren't an item: another aircraft puts a pilot out of the flight ([in the flight](#in-the-flight)).
- Traffic feeds no item in this table: a receiving machine raises notices for other traffic and for missing copies, and a page lists the machine's traffic packs when asked ([notices](../traffic-atc/01-traffic-and-atc.md#notices)); whether it also feeds one is [left open](#left-open).

| Item | Owner | Compared | Level |
| --- | --- | --- | --- |
| The aircraft's package and where it's installed, Community, Official, or streamed | The session crate | Equal | A warning |
| The aircraft's version | The session crate | Equal, where both copies have one | An error; a warning when one copy is streamed |
| The livery, `A:LIVERY NAME` | The session crate | Equal | A warning |
| The profile's bundle | The profile loader | Whether the pinned bundle loaded, with "Couldn't get the session's profile" when it couldn't be fetched, found, or read, and "No profile for this aircraft" when there's none; the pinned hash shows once, "unpublished" for a local one, since every core loads only the pinned bundle ([the match check's item](../profiles/02-units.md#the-match-checks-item); user, 2026-10-18) | An error for either quoted value, even when every member shows it |
| The sim's date and time of day, `E:ZULU TIME` and the zulu date | Rate and pause | Within 10 minutes, a starting value, on the same date | A warning |

- No item lists other packages that override our files, since the sim service searches for none ([packages on disk](../core/03-sim-seam-and-wasm-module.md#packages-on-disk)).

- The aircraft's items read the loaded aircraft's facts, aircraft awareness, which the sim service holds ([the aircraft's facts](../core/03-sim-seam-and-wasm-module.md#the-aircrafts-facts); user, 2026-10-18).
- While a session is held, the sim service finds the package that holds the aircraft's folder with a job that looks in each package folder under the `InstalledPackagesPath` it reads from `UserCfg.opt` ([02-01](../../learn/foundations/02-01-installs-and-packages.md), [the packages folders](../install/01-installing-and-updating.md#the-packages-folders)): `Community`, `Community2024`, `Official2020`, `Official2024`'s store folder, and `StreamedPackages`; it reads `package_version` from the package's `manifest.json`.
- A streamed copy has no version on disk: none of the 1,221 streamed packages on our development machine had a `manifest.json`, the sim's `Content.xml` gives each package only its name and whether it's active, and the world map's aircraft list carries no version (read on 2026-10-16, [aircraft log][p16]).
  So two streamed copies show no version difference, and a streamed copy against an installed one shows a warning that says the streamed copy's version can't be read and asks both pilots to compare their versions in the sim themselves (user, 2026-10-16).
- A session in an aircraft with no published profile flies: state sync, pointer sync, and avatars find nothing to load, while flight-model sync, control, rate and pause, traffic, and ATC run, and the profile loader's item shows "No profile for this aircraft" as an error (user, 2026-10-16).

## Which bundle a session pins

- The profile loader, on the PF's core, writes the pinned bundle's hash into a `PilotFlying` key of its own whenever the session's aircraft changes, and when the key holds none and its choice becomes one, after preflight ends too ([the pin](../profiles/02-units.md#the-pin)).
  Its choice is a local bundle that covers the aircraft, which the pin marks so no core fetches it from Pages, or else the bundle its cached index gives its level ([delivery](../profiles/01-format-and-delivery.md#delivery)); every other core's loader loads that hash, and fetches a published one by hash when its cache lacks it.
- Every pilot in a session runs one release, by the version check at join, so two caches differ only when one core started before a merge and the other after, and the PF's choice settles it without the cores comparing their caches.
- After preflight ends the aircraft stays, so a pinned bundle does too, as [delivery](../profiles/01-format-and-delivery.md#delivery) requires outside a test session, and the pin changes only from none; how the loader writes, fetches, and loads is [6.8](../architecture/plan.md#68-profiles)'s.

## Rate and pause

| | Active pause | The simulation rate |
| --- | --- | --- |
| Key | `PAUSE`, `Anyone` | `RATE`, `PilotFlying` |
| Written | When this sim's active pause flag, `Pause_EX1` 4, differs from the key, so the flag our own call brings back writes nothing | On the flying machine, when `E:SIMULATION RATE` changes |
| Applied | When this sim's flag differs from the key, through the EFB app's part | On a following machine, by `K:SIM_RATE_INCR` or `K:SIM_RATE_DECR`, one step at a time, each once the last shows in `E:SIMULATION RATE` |
| A following pilot's own change | Writes the key, so every machine follows | Differs from the key, so it's stepped back, as [putting back](../sync/04-order-and-recovery.md#putting-back) has it |

- The one way we found for code to turn active pause on and off is `TOOLBAR_SET_ACTIVE_PAUSE`, the call the sim's toolbar makes: through the inspector, it worked from the toolbar's and the EFB's documents with the EFB closed (user, 2026-10-16), while `K:PAUSE_ON` raised the sim pause, `K:PAUSE_TOGGLE` and four guessed names for active pause did nothing, and the one cockpit panel and mainUi we tried answered "not bound" (measured on MSFS 2024, 2026-10-16, [environment log][p02]).
- So rate and pause has a part in the EFB app, code with no screen of its own: the core sends it a `unit` message with the pause wanted, and it calls `Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE", on)`.
  That our EFB app's own code can make the call, as it calls `TOGGLE_EFB` ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), is unverified, and a case in the sim settles it.
- Both apply only while this pilot is in the flight, and a core writes neither key from outside it.
- Rate and pause shows "James is in the pause menu" while the PF's `status` key has `Pause_EX1`'s flag 8, the sim pause ([time, date, sim rate, and pause](../product/03-v1-scope.md#time-date-sim-rate-and-pause)).
- The time and date aren't synced, and rate and pause's match item compares them.

## Go to

- The PF's core writes go-to's `SPOT` key, `PilotFlying`: the departure airport and stand from sim awareness's `[Departure]`, and whether any of the PF's engines is running, from `A:GENERAL ENG COMBUSTION` for each of `A:NUMBER OF ENGINES`.
- A pilot out of the flight sees where the PF is, in the desktop app, such as "James is at EGLL, PARKING 140", and Go to:
  - points the world map at the PF's departure airport and selects the PF's stand while the PF's engines are off;
  - selects the first runway the world map lists for that airport while they run, so the joiner's aircraft starts with its engines running, which catch-up can't give it, since it writes each entry once at the PF's value and an engine start takes time (inference); a runway start runs the engines (reported by the user, 2026-10-16).
  - Dual Input then moves the joiner's aircraft to the PF, airborne or not, as flight-model sync does for every joiner.
- It never names a stand the PF taxied to, since a joiner is moved to the PF anyway; with no `[Departure]` airport, Go to is unavailable and says so.
- It's available by sim awareness's page, while the menu script is connected, as [preflight](../product/03-v1-scope.md#preflight) limits it.
- It runs as the sim service's `world_map` requests, each answered before the next goes ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls)), and a failed step shows the pilot which step failed.

## The menu script

| `world_map` request | The menu script | Measured |
| --- | --- | --- |
| `free_flight` | Presses the home page's `FreeflightButton`, and answers once `FreeFlightPage` is up | [interface log][join] |
| `departure_airport { icao }` | Sends the airport search for the ICAO, selects the result whose `ICAO` matches, and answers once the departure reads it | [interface log][map] |
| `departure_stand { name, number }` | Selects, by its `ID`, the stand whose name is the name and number followed by ` --` or nothing, as "PARKING 140 -- RAMP CARGO" is for `GateName=PARKING; GateNumber=140`, or answers that none matches, and Go to keeps the airport alone | [interface log][map] |
| `departure_runway` | Selects the first runway in the departure's list through the world map's own request, as its runway list does with `SetDepartureRunwayIndex.request` (read in fs-base-ui 0.1.10, `html_ui/Global/pkg/base.bundle.js`, `cbOnSelectRunway`); whether that takes the runway's ID, as the stand's request does, or its place in the list is unverified | Not run |

- It reports its master page and the page, `Startpage`, `Homepage`, `FreeFlightPage`, `OptionsPage`, `InstallPage`, `Career_ConfirmationPage`, or unknown, when the sim service asks as its socket joins ([leaving Starting](../core/03-sim-seam-and-wasm-module.md#leaving-starting)), and in a session reads the page every 500ms and reports a change ([interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
  The sim service asks with an empty `unit` message, and the script answers with its master page, `MasterPage_InGame` first, since the pause menu puts `MasterPage_Pause` over it.
- Our copy of BlurPage is the stock component with a hidden image before its last closing tag, whose error handler loads the script once in each document, under the global `DUALINPUT_MENU_LOADED`.
- It decides nothing beyond which list entry matches a request.

## What the code map changes in 01-roles-and-members

Nothing: [01-roles-and-members](01-roles-and-members.md) names roles and members, not units, and what this design adds there is in its note.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets](../architecture/02-code-map.md#budgets) and [02-units](../network/02-units.md#budgets)'s.

| What | Budget |
| --- | --- |
| A handler | Inside the code map's 1ms: a key compares a few values, and the guards' verdicts run after each input for about three requests ([requests and guards](../core/01-loop-and-edge.md#requests-and-guards)) |
| Memory | Under 1 MB for the keys and members of a v1 session |
| A first message's keys | Under 4 KB with two pilots, unverified until the message crate's types exist |
| Preflight's end | Each core within one network delay of the PF's |
| A following machine's active pause | Applied within 500ms of the key arriving |
| Go to | From the press to the stand or runway selected within 5s from the home page; p07 set the airport in 553ms and the stand in 28ms ([interface log][map]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores and the stand-in sim:

- A host starts a session before the sim runs; the joiner sees "hasn't loaded a flight yet", then the stand once the host loads at one.
- A host starts a session from a flight: `control` names the host, `preflight` holds the aircraft at once, and preflight runs, or ends at once when the host is airborne.
- A joiner in another aircraft is a member and out of the flight, and enters the flight, as a late joiner after preflight, once it loads the session's aircraft.
- The PF loads the wrong aircraft in preflight, returns to the menu, keeping control, then loads the right one: the aircraft follows, and the pinned hash with it.
- The PF leaves the session in preflight while the PM is at the menu: the PM holds control, and preflight runs once the PM is in a flight.
- Both pilots ready: the countdown runs and preflight ends on both cores; an un-ready at 2.9s cancels it; a lost link during the countdown cancels it, and the returning member is unready; a ready pilot whose sim crashes comes back unready.
- Go without a PM whose sim kept running: preflight ends, and on return the PM raises `PreflightEnded` and catches up, and the replay's copies drop; the PM can't name the PF.
- A late joiner who reloads the same aircraft: every member's `match` is written again, and the time of day compares fresh.
- The PF leaves the flight after preflight with the PM in it: control passes to the PM; then the PM leaves the flight too: both cores leave, and the session ends.
- A restarted core with a session file: a raised restart count before `Open`, `SessionStarted` and the announcement, and a pass of control it held before its own `FlightChanged`.
- Two pilots press active pause at once: both machines keep one value; a pilot who presses it twice within one round trip ends with every machine on one value; a following pilot's change of the rate is stepped back.
- The EFB app's part sets active pause on the stand-in's toolbar call, and the flag that comes back writes no key.
- `departure_stand` for PARKING 14 at an airport that has PARKING 140: it selects PARKING 14.
- A streamed copy against an installed one: a warning; two streamed copies: nothing.
- A session in an aircraft with no published profile: the error, and every feature that needs no profile running.

In the sim:

- Our EFB app's own code calls `TOOLBAR_SET_ACTIVE_PAUSE` with the EFB closed, and active pause turns on and off.
- `departure_runway` from the menu script: what its request takes, and the Baron 58P's engines at Ready to fly after it.
- `departure_stand` against a gate whose list name has a letter, such as "GATE N 17 -- GATE MEDIUM", against its flight file's `GateName` and `GateNumber`.

## Left open

- How the gate stands' list names match the flight file beyond "PARKING 140", and what the runway request takes, which the cases in the sim settle; until the first does, Go to keeps the airport alone when no name matches.
- Whether traffic feeds the match check an item: none of the reasons against it holds since every input is recorded (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)), and the stage that builds traffic sync settles it.

[p02]: ../environment/log.md#2026-10-16-the-toolbars-toolbar_set_active_pause-called-from-the-toolbars-or-the-efbs-document-turns-active-pause-on-and-off-and-no-simconnect-event-we-tried-does
[p16]: ../aircraft/log.md#2026-10-16-a-streamed-package-keeps-no-version-on-disk-while-every-installed-one-with-a-manifest-has-its-package_version
[map]: ../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight
[join]: ../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly
