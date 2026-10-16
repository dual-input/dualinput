# Session: its units

```text
Purpose:     The session crate's interfaces, and how rate and pause, Go to, and the menu script work as the session's features.
Depends on:  01-roles-and-members.md, ../architecture/02-code-map.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../profiles/01-format-and-delivery.md, ../sync/04-order-and-recovery.md, ../product/03-v1-scope.md, ../environment/log.md, ../interface/log.md
Decides:     The session crate's members, session keys, control, session file, joining and leaving, preflight, match check, and what it raises; who is in the flight; which pilot's bundle a session pins; where the match check reads an aircraft's version; how rate and pause sets active pause and the simulation rate; how Go to picks a stand or a runway; what the menu script reports and runs; when the core exits; the budgets; and the cases for the bench (node 6.7).
```

The session crate keeps the members, the session's keys, control, the session file, preflight, and the match check, and decides every request about them on the loop; the network carries its keys, and the features hang off its moments.
Every core works out who is in the flight from keys each member writes about its own sim, so a pilot in another aircraft joins and waits out of the flight, and control, preflight, and the session's end all turn on that one rule.
The PF's core sets the session's aircraft, runs preflight's countdown, and ends preflight with a key, and its profile loader pins the newest bundle its cache holds for that aircraft.
Rate and pause sets active pause through the EFB app, since only the toolbar's own call does it, and Go to puts a joiner on a runway, engines running, whenever the PF's engines run.

This answers node 6.7 of the [architecture plan](../architecture/plan.md#67-the-session).
[01-roles-and-members](01-roles-and-members.md), the code map's [what a feature registers](../architecture/02-code-map.md#what-a-feature-registers) and [guards](../architecture/02-code-map.md#guards), [02-units](../network/02-units.md#requests-the-session-crate-makes)'s requests, and [03-v1-scope](../product/03-v1-scope.md#session)'s session, preflight, and match check give the rules this design builds on, and this document holds only what they leave out.
The flying machine is the PF's, and a following machine is any other pilot's.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `session` | Platform | The members, the session's keys and their stamps, control, the session file, joining and leaving, preflight and `Hold`, the match check and its items, the display name setting, and when the core exits | On the loop |
| `rate-and-pause` | Feature | Active pause, the simulation rate, the pause menu's notice, and the match check's time of day | Its crate in the core, and a part in the EFB app |
| `go-to` | Feature | The PF's spot and the Go to button | Its crate in the core, and a section in the desktop app |
| The menu script | Platform outside the core | Reporting the menu's page, and running the world map's requests | In mainUi, through our copy of BlurPage, in `sim-package/pages` |

The session crate depends on the kernel, `clients`, `sim-service`, `network`, and `recording`, as the code map's [platform](../architecture/02-code-map.md#the-platform) row has it.
The crates above it reach it through its moments, its requests, and the keys they declare: the profile loader writes the pinned bundle, state sync guards Ready, and the cockpit stream guards control.

## Members

- A member is a pilot ID with the restart count and endpoint ID of its latest first message, as [02-units](../network/02-units.md#moments) has it.
- This core is a member from its `BackendAnswered`; another is a member from its first `LinkUp`, and stops being one at `MemberLeft` or `MemberOut`, or when another member's `sim` key lists it as left.
- Each member writes three keys of its own on the session channel:

| Key | Holds | Rewritten |
| --- | --- | --- |
| `member` | Pilot ID, display name, kind, and endpoint ID ([01-roles-and-members](01-roles-and-members.md#the-member-list)) | Never, after the first message |
| `sim` | Its sim awareness's stage and aircraft, how its last sim run ended, and its link to each other member: up, lost, or left | On each `SimChanged` and each link change |
| `ready` | Its Ready during preflight | On Ready and un-ready |

- The `sim` key's links let every pilot's banner show the whole crew, as [the connection](../product/03-v1-scope.md#the-connection) asks, and tell a member that can't reach a leaver that they left, as [leaving](../network/01-between-machines.md#leaving) asks of the session channel.
- A member that leaves takes its own keys with it, and the session crate clears every session-wide key whose value names it.
- The display name is a setting the session crate registers, empty at first; Host and Join answer that a name is needed while it's empty, and Crosscheck asks the pilot for one, where and how being [6.16](../architecture/plan.md#616-the-apps)'s.
  Nothing fills it from the Windows account, whose name would reach crewmates, their recordings, and our R2 (user, 2026-10-16).
- Each member joining, and each one gone, raises `MemberJoined` or `MemberGone`, and the session crate tells the recording crate the joiner's display name ([the index](../recording/01-recording-and-bug-reports.md#the-index)).

## In the flight

A member is in the flight while its `sim` key's stage is Ready to fly or Flying and its aircraft is the session's, folder and preset, compared ignoring case ([the aircraft](../core/03-sim-seam-and-wasm-module.md#the-aircraft)).
Every core works this out the same way, with one function of the session crate's, from the keys it holds, so no member writes a yes or no of its own, and a change of the session's aircraft moves every member's answer at once.

- A change of any member's answer raises `FlightChanged { member, in_flight }`.
- Nothing of the flight acts on a member out of it: the cockpit stream applies nothing on its machine ([the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream)), the profile loader loads nothing for another aircraft, and control can't pass to it.
- A pilot who joins in another aircraft joins and is out of the flight, with a notice to load the session's aircraft, such as "Load the Baron 58P to fly with James", and the crew sees "Adam is in the A320"; this replaces the 2026-10-12 rule that such a pilot can't join (user, 2026-10-16).
  Nothing has to know the session's aircraft before a join, and a pilot cut off for 30 minutes, or who pressed Leave by mistake, types the code again from their flight.
- Before the PF has loaded a flight, the session has no aircraft and nobody is in the flight, and a joiner sees "James hasn't loaded a flight yet".
- Once preflight has ended, a core that sees no member in the flight leaves the session, so the session ends ([the PF](01-roles-and-members.md#the-pf)).

## Session keys

```rust
// a sketch: the message crate's rate-and-pause module; the numbers are hypothetical
pub const PAUSE: Key<bool> = Key::new(40, Writer::Anyone);           // any member, settled by the stamp
pub const RATE: Key<f32> = Key::new(41, Writer::Pf);                 // the flying machine alone
pub const IN_PAUSE_MENU: Key<bool> = Key::new(42, Writer::Member);   // each member, of itself

// a sketch: rate and pause in the core
pub fn register(r: &mut Registry) {
    let me = r.unit::<RateAndPause>("rate-and-pause");
    me.session_key(rate_and_pause::PAUSE);
    me.session_key(rate_and_pause::RATE);
    me.session_key(rate_and_pause::IN_PAUSE_MENU);
    me.on::<KeyChanged>(RateAndPause::apply);
    me.on::<SimChanged>(RateAndPause::read);
}

fn read(me: &mut RateAndPause, _: &SimChanged, cx: &mut Cx) {
    let active = cx.read::<SimAwareness>().pause.active();
    if me.mine(active, cx) {
        cx.ask(WriteKeys::one(rate_and_pause::PAUSE, &active));      // the session crate decides it
    }
}
```

- A key is a constant in its owner's module of the message crate: a number, its value's type, its writer, and whether its value names a member, so a test fails on two keys with one number, as on two channels ([channels and sends](../network/02-units.md#channels-and-sends)).
- A key's writer is one of three, where the code map's hook has two, one member or the whole session:
  - `Member`: each member writes its own copy, such as `ready`.
  - `Anyone`: any member writes it, and the stamp settles two writes, such as active pause.
  - `Pf`: only the PF writes it, and the session crate drops a value from anyone else, such as the simulation rate or the session's aircraft.
- Every write is a request, `WriteKeys`, so a feature never changes a key itself, and any guard on one key refuses the whole request, as [the traffic and ATC switch](../architecture/02-code-map.md#the-traffic-and-atc-switch) needs; its verdict, for the apps, is built as the switch's claim of every role key a feature declared.
- A key's stamp is the code map's: the writer's control value, a number one past the highest its writer has seen on the key, and the writer's pilot ID ([channels](../network/01-between-machines.md#channels)); a write goes on the session channel to every member at once, and each change, local or arriving, raises `KeyChanged { key }`.
- The session crate fills each connection's first message with every key it holds, through the opener hook, and sends them all again on every `LinkUp` ([the first message](../network/02-units.md#the-first-message)).
- A handler reads a key with `cx.read::<Session>().key(KEY)`, which gives the value, and for a `Member` key, each member's.

The session crate's own keys, beside the three each member writes:

| Key | Writer | Holds |
| --- | --- | --- |
| `control` | Whoever changes it, by control's own order | The generation and the PF's pilot ID ([control](../network/01-between-machines.md#control)) |
| `aircraft` | `Pf` | The session's aircraft, folder and preset |
| `preflight` | `Pf` | Waiting, running, the countdown, ended, or skipped |
| `go-without` | `Anyone` | The pilot IDs preflight no longer counts |
| `match` | `Member` | This member's value for each item of the match check |

## Control

- The session crate declares `TakeControl`, built as this pilot taking control now; the take-control key and button, and the voice handover's answer, each ask it ([6.12](../architecture/plan.md#612-control)).
- Two guards ride it: the session crate's own, live only while this pilot is in the flight and preflight has ended, and the cockpit stream's, which holds control back from a pilot whose catch-up or replay runs over a link that's up ([guards](../architecture/02-code-map.md#guards)).
- A pass the platform makes itself isn't a request: the session crate makes it when this core's pilot holds control and leaves the flight, before a Leave or a quit, and once a restarted core's first message has passed with the crew ([a core that restarts](../sync/04-order-and-recovery.md#a-core-that-restarts)).
  It goes to the member in the flight with the lowest pilot ID, which with two pilots is the other one, and to nobody when none is in the flight; preferring an up-to-date pilot is for the pick that brings larger crews ([the PF](01-roles-and-members.md#the-pf)).
- Every change raises the generation to one past the highest this core has seen, writes `control`, writes every `Anyone` and `Pf` key again under the new value, and raises `ControlPassed { before, after, made_here }`.
- [04-order-and-recovery](../sync/04-order-and-recovery.md#a-change-of-control) has each change of control carry its maker's vector clock, which the session crate can't read, since the cockpit stream sits above it; on `ControlPassed` with `made_here`, the cockpit stream sends a message of its own kind, whose vector clock is the maker's, which is [6.9](../architecture/plan.md#69-sync)'s to design.

## The session file

- The session file is JSON in the data folder, through serde_json, so the watcher can tell it exists, which holds updates back ([a session file after a long outage](../network/01-between-machines.md#a-session-file-after-a-long-outage)).
- It holds the session's ID and code, the pilot's ID, the core's restart count, the run of the sim it last saw, the endpoint key, the relay list with its tokens, and the crew's endpoint IDs ([the session file](../architecture/01-spine.md#the-session-file-and-a-core-that-restarts); [02-units](../network/02-units.md#requests-the-session-crate-makes)).
- The session crate writes it as a job, between `BackendAnswered` and `Open`, and asks `Open` only once the job says it's written ([outputs](../core/01-loop-and-edge.md#outputs)); it writes it again when the crew or the sim's run changes, and deletes it when the session ends for this core.
- A core that starts and finds it raises the restart count, writes the file, and then asks `Open` with the crew it holds; the network asks the backend if nobody answers within 10s ([requests the session crate makes](../network/02-units.md#requests-the-session-crate-makes)).
- The run of the sim, from sim awareness, tells the crew's notice whether a restarted core's sim kept running, and how the last run ended, close or crash, tells it which ([a crash and a close](../core/03-sim-seam-and-wasm-module.md#a-crash-and-a-close)).

## Joining and leaving

| Command | The session crate |
| --- | --- |
| Host | Draws the session's ID and this pilot's ID with `cx.new_id()`, asks `Host`, and on the code, writes the file and asks `Open` with no crew |
| Join, with a code | Draws this pilot's ID and asks `Join`; on the backend's answer, writes the file and asks `Open` with the crew; on a refusal, shows it as a notice, naming whose version is older ([the first message](../network/02-units.md#the-first-message)) |
| The code box selected, in the EFB app | Reads the clipboard as a job, which hands up only an invite code ([what stays out](../recording/01-recording-and-bug-reports.md#what-stays-out)), and joins with it at once |
| Leave | Un-readies during preflight, passes control if this pilot holds it, then asks `Leave` |
| Quit, from the desktop app, the watcher's tray, or Windows ending the pilot's session | Leaves as above with the quit code, asks `clients` for `bye`, and puts out the exit |

- A session starts for this core at its `BackendAnswered`: the session crate raises `SessionStarted`, tells the recording crate the session's ID and the endpoint key, and calls `sim_service::announce(cx, true)` ([the announcement](../core/03-sim-seam-and-wasm-module.md#the-announcement)).
- Host and Join are refused while a session is held.
- A PF who leaves passes control as an ordinary handover, and asks `Leave` once a message from the new PF carries the new control value, or after 1s ([leaving](../network/01-between-machines.md#leaving)).
- The session ends for this core at Leave, at `MemberOut` for the last other member, or when no member is in the flight after preflight; it then deletes the file, raises `SessionEnded`, tells the recording crate, and calls `sim_service::announce(cx, false)`.
- Windows ending the pilot's session reaches the core as `WM_QUERYENDSESSION` on its window, which the edge pushes as an input of its own, and the session crate quits within 3s of it ([quitting](../core/01-loop-and-edge.md#quitting)).
- The core exits once sim awareness says Closed, no session is held, and no desktop app is connected, which `clients`' moments tell ([what moves them](../architecture/01-spine.md#what-moves-them)), and after a quit.

## Preflight

The PF's core runs preflight, since the flying machine is the session's authority ([the connection](../product/03-v1-scope.md#the-connection)), and every core follows its `preflight` key:

| Phase | Entered when | Every core |
| --- | --- | --- |
| Waiting | The session starts, or the PF leaves the flight before preflight ends with nobody else in it | Holds nothing |
| Running | The PF is in a flight on the ground | Feeds `Hold` while its pilot is in the flight, and each member writes `ready` |
| The countdown | Every counted member is ready | Shows the 3s countdown |
| Ended | The PF's 3s timer fires | Ends `Hold`, raises `PreflightEnded`, and tells the recording crate the aircraft and the departure airport |
| Skipped | The PF is first in a flight with `A:SIM ON GROUND` at 0 | As ended, with every other member a late joiner ([preflight](../product/03-v1-scope.md#preflight)) |

- **The session's aircraft:** the PF's core writes `aircraft` each time its pilot enters a flight, and clears it when they leave one, until preflight ends, after which it stays.
  A host who loaded the wrong aircraft reloads, and a PF who leaves the flight while another member is in it passes control first, so the aircraft stays the one the new PF flies.
- **Who counts:** every member not in `go-without`; a counted member is ready when its `ready` key is set, it's in the flight, and the PF's link to it is up, so a pilot who drops out counts as unready.
- **Ready** is a request the session crate declares, with its own guard, this pilot in the flight while preflight runs, and state sync's, which holds it until the aircraft has settled ([settling after a load](../sync/03-catch-up.md#settling-after-a-load)); a member that loses a link during preflight writes its `ready` off, so it comes back unready.
- **The countdown:** the PF's core starts a 3s timer when every counted member is ready, and goes back to running, the timer canceled, when one isn't; an un-ready that reaches it after the timer fired is too late, and the flight starts.
- **Go without:** a ready pilot names a counted member who has dropped out, and the session crate adds it to `go-without`; the PF can't be named, since control stays with a PF whose link is lost, so preflight waits for a PF who dropped out until they come back, leave the flight, which passes control, or are counted out at 30 minutes.
- **A late joiner** enters the flight after preflight ended, or after the crew went without them, and skips Ready; the cockpit stream starts their catch-up on `FlightChanged` ([while catch-up runs](../sync/03-catch-up.md#while-catch-up-runs)).
- The departure airport is the `[Departure]` section's `ICAO` in this pilot's flight file, which the sim service reads at each `FlightLoaded` and keeps in sim awareness, since Go to reads it too.
- The PF's checklist of counted controls is state sync's, beside the preflight summary ([preflight](../product/03-v1-scope.md#preflight)).

## The match check

```rust
// a sketch: rate and pause's item
me.match_item(rate_and_pause::TIME_OF_DAY, RateAndPause::time_of_day);   // a value of the item's type, which compares itself
```

- The session crate keeps the items, its own and the features', and writes this member's value for each into its `match` key when this pilot enters the flight, and again when any member's aircraft changes ([preflight match check](../product/03-v1-scope.md#preflight-match-check)).
- Each core compares every member's values item by item, with the item's own comparison, which names an error or a warning, and shows the differences beside each Ready and as counts on the banner's summary.
- A feature that a difference breaks reads the result and turns itself off for the session, as [preflight match check](../product/03-v1-scope.md#preflight-match-check)'s rules have it.
- The aircraft's folder and preset aren't an item: another aircraft puts a pilot out of the flight ([in the flight](#in-the-flight)).

| Item | Owner | Compared | Level |
| --- | --- | --- | --- |
| The aircraft's package and where it's installed, Community, Official, or streamed | The session crate | Equal | A warning |
| The aircraft's version | The session crate | Equal, where both copies have one | An error; a warning when one copy is streamed |
| The livery, `A:LIVERY NAME` | The session crate | Equal | A warning |
| The profile's bundle | The profile loader | The hash each core loaded, "unpublished" for a local one, and "no profile" when none is published | An error |
| The sim's date and time of day, `E:ZULU TIME` and the zulu date | Rate and pause | Within 10 minutes, a starting value, on the same date | A warning |
| Traffic packs, injectors, and multiplayer | Traffic | [6.14](../architecture/plan.md#614-traffic-and-atc)'s | A warning |

- The session crate finds the package that holds the aircraft's folder with a job that looks under `UserCfg.opt`'s `InstalledPackagesPath`, as the installer finds it ([installing and updating](../product/03-v1-scope.md#installing-and-updating)), in `Community`, `Official2024`'s store folder, and `StreamedPackages`, and reads `package_version` from the package's `manifest.json`.
- A streamed copy has no version on disk: on our development machine, `StreamedPackages` held 1,221 packages and none had a `manifest.json`, and the ones we opened held only a `content` folder; the sim's `Content.xml` lists each package's name and whether it's active, and nothing more; and the world map's aircraft list p08 captured carried each aircraft's `creator` and no version (read on 2026-10-16; `experiments/areas/interface/results/p08-world-map-aircraft-2026-10-05-19-32-47.ndjson`).
  So two streamed copies show no version difference, and a streamed copy against an installed one shows a warning that says the streamed copy's version can't be read and asks both pilots to compare their versions in the sim themselves (user, 2026-10-16).
- A session in an aircraft with no published profile flies: state sync, pointer sync, and avatars find nothing to load, while flight-model sync, control, rate and pause, traffic, and ATC run, and the profile loader's item shows "No profile for this aircraft" as an error (user, 2026-10-16).

## Which bundle a session pins

- The profile loader, on the PF's core, writes the pinned bundle's hash into a `Pf` key of its own whenever `aircraft` changes, taking the newest bundle its cache holds for that aircraft ([delivery](../profiles/01-format-and-delivery.md#delivery)); every other core's loader loads that hash, and fetches it by hash when its cache lacks it.
- Every pilot in a session runs one release, by the version check at join, so two caches differ only when one core started before a merge and the other after, and the PF's choice settles it without the cores comparing their caches.
- After preflight ends the aircraft stays, so the pin does too, as [delivery](../profiles/01-format-and-delivery.md#delivery) requires outside a test session; how the loader writes, fetches, and loads is [6.8](../architecture/plan.md#68-profiles)'s.

## Rate and pause

| | Active pause | The simulation rate |
| --- | --- | --- |
| Key | `PAUSE`, `Anyone` | `RATE`, `Pf` |
| Written | When this core's sim's active pause flag, `Pause_EX1` 4, changes and differs from the key | On the flying machine, when `E:SIMULATION RATE` changes |
| Applied | When this sim's flag differs from the key, through the EFB app's part | On a following machine, by `K:SIM_RATE_INCR` or `K:SIM_RATE_DECR`, one step at a time, each once the last shows in `E:SIMULATION RATE` |
| A following pilot's own change | Writes the key, so every machine follows | Differs from the key, so it's stepped back, as [putting back](../sync/04-order-and-recovery.md#putting-back) has it |

- Only `TOOLBAR_SET_ACTIVE_PAUSE`, the call the sim's toolbar makes, turns active pause on and off from code, and only from the toolbar's or the EFB's document, with the EFB closed: no SimConnect event did, `K:PAUSE_ON` raised the sim pause, and a cockpit panel's and mainUi's documents answered "not bound" (measured on MSFS 2024, 2026-10-16, [environment log][p02]).
- So rate and pause has a part in the EFB app, code with no screen of its own: the core sends it a `unit` message with the pause wanted, and it calls `Coherent.call("TOOLBAR_SET_ACTIVE_PAUSE", on)`, as our EFB app's own code calls `TOGGLE_EFB` ([interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
  A change of the flag within 1s of such a call is the call's, not the pilot's.
- Both apply only while this pilot is in the flight, and a core writes neither key from outside it.
- Each member writes `IN_PAUSE_MENU` from its sim pause flag, `Pause_EX1` 8, and the others show "James is in the pause menu" for the PF's ([time, date, sim rate, and pause](../product/03-v1-scope.md#time-date-sim-rate-and-pause)).
- The time and date aren't synced, and rate and pause's match item compares them ([the match check](#the-match-check)).

## Go to

- The PF's core writes go-to's `SPOT` key, `Pf`: the departure airport and stand from sim awareness's `[Departure]`, and whether any of the PF's engines is running, from `A:GENERAL ENG COMBUSTION` for each of `A:NUMBER OF ENGINES`.
- A pilot out of the flight sees where the PF is, in the desktop app, such as "James is at EGLL, PARKING 140", and Go to:
  - points the world map at the PF's departure airport and selects the PF's stand while the PF's engines are off;
  - selects the first runway the world map lists for that airport while they run, so the joiner's aircraft starts with its engines running, which catch-up can't do, since an engine start takes time ([considered and dropped](../sync/03-catch-up.md#considered-and-dropped)); a runway start runs the engines (user, 2026-10-16).
  - Crosscheck then moves the joiner's aircraft to the PF, airborne or not, as flight-model sync does for every joiner.
- It never names a stand the PF taxied to, since a joiner is moved to the PF anyway; with no `[Departure]` airport, Go to is unavailable and says so.
- It's available only on the main menu's home page and Free flight's world map, by sim awareness's page, and only while the menu script is connected, which it isn't without our copy of BlurPage ([preflight](../product/03-v1-scope.md#preflight)).
- It runs as the sim service's `world_map` requests, each answered before the next goes ([what a feature calls](../core/03-sim-seam-and-wasm-module.md#what-a-feature-calls)), and a failed step shows the pilot which step failed.

## The menu script

| `world_map` request | The menu script | Measured |
| --- | --- | --- |
| `free_flight` | Presses the home page's `FreeflightButton`, and answers once `FreeFlightPage` is up | [interface log][join] |
| `departure_airport { icao }` | Sends the airport search for the ICAO, selects the result whose `ICAO` matches, and answers once the departure reads it | [interface log][map] |
| `departure_stand { name, number }` | Selects, by its `ID`, the stand whose name starts with the name and number, as "PARKING 140 -- RAMP CARGO" does for `GateName=PARKING; GateNumber=140`, or answers that none matches, and Go to keeps the airport alone | [interface log][map] |
| `departure_runway` | Selects the departure's first runway, as `SET_DEPARTURE_RUNWAY` with index 0 does in the sim's own code (read in fs-base-ui, `html_ui/JS/Flight.js`, `setDepartureRunwayIndex`) | Not run |

- It reports its master page and the page, `Startpage`, `Homepage`, `FreeFlightPage`, `OptionsPage`, `InstallPage`, `Career_ConfirmationPage`, or unknown, when the sim service asks as its socket joins ([leaving Starting](../core/03-sim-seam-and-wasm-module.md#leaving-starting)), and in a session reads the page every 500ms and reports a change ([interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
- With no session, it answers when asked and watches nothing ([components with no session](../architecture/01-spine.md#components-with-no-session)).
- It decides nothing beyond which list entry matches a request, and every request names what to pick.

## What the code map changes in 01-roles-and-members

Nothing beyond the note at the top of [01-roles-and-members](01-roles-and-members.md), since it names roles and members, not units.
This design adds three things there, which its note lists: a member's own `sim` key, from which every core works out who is in the flight; the pass the platform makes, to the member in the flight with the lowest pilot ID; and a PF who drops out during preflight, whom the crew can't go without.

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
| A quit | Leaving and exiting within 3s, as [quitting](../core/01-loop-and-edge.md#quitting) has it |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores and the stand-in sim:

- A host starts a session before the sim runs; the joiner sees "hasn't loaded a flight yet", then the stand once the host loads at one.
- A joiner in another aircraft is a member and out of the flight, and enters the flight, as a late joiner after preflight, once it loads the session's aircraft.
- The PF loads the wrong aircraft in preflight, then the right one: `aircraft` follows, and the pinned hash with it.
- Both pilots ready: the countdown runs and preflight ends on both cores; an un-ready at 2.9s cancels it; a lost link during the countdown cancels it, and the returning member is unready.
- Go without a PM who dropped out: preflight ends, and the PM late-joins on return; the PM can't name the PF.
- The PF airborne when first in a flight: preflight is skipped.
- The PF leaves the flight after preflight with the PM in it: control passes to the PM; then the PM leaves the flight too: both cores leave, and the session ends.
- A PF's Leave: the PM holds control before the PF's `Leave` goes, or 1s after.
- A restarted core with a session file: a raised restart count before `Open`, and a pass of control it held once the crew's first message passes.
- Two pilots press active pause at once: both machines keep one value; a following pilot's change of the rate is stepped back.
- The EFB app's part sets active pause on the stand-in's toolbar call, and the flag that comes back writes no key.
- A streamed copy against an installed one: a warning; two streamed copies: nothing.
- A session in an aircraft with no published profile: the error, and every feature that needs no profile running.
- `WM_QUERYENDSESSION`: a Leave with the quit code and an exit within 3s.

In the sim:

- `departure_runway` from the menu script, and the Baron 58P's engines at Ready to fly after it.
- `departure_stand` against a gate whose list name has a letter, such as "GATE N 17 -- GATE MEDIUM", against its flight file's `GateName` and `GateNumber`.

## Left open

- How the gate stands' list names match the flight file beyond "PARKING 140", which the case in the sim settles; until it does, Go to keeps the airport alone when no name matches.
- Two members writing `go-without` at once lose one write, since it's one key; with v1's two pilots it never happens, and the pick that brings larger crews settles it.

[p02]: ../environment/log.md#2026-10-16-only-the-toolbars-toolbar_set_active_pause-called-from-the-toolbars-or-the-efbs-document-turns-active-pause-on-and-off
[map]: ../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight
[join]: ../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly
