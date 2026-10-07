# Product: plan

This is Crosscheck's master plan: the steps from ideas to a released v1, each with what it produces and the criterion that ends it.
Each step's content lives in the document it produces, except step 3's picks and step 6's risks, which live here.
The steps don't run strictly in order: a probe in step 6 can move an idea into or out of v1, and when it does, step 3's picks change.

## 0. Aims and non-goals

Produces: [01-aims](01-aims.md).
Exit: the aims are agreed.
Done on 2026-10-02.

## 1. Ideas

Produces: [ideas](ideas.md).
Exit: every idea we'd consider for v1 has an entry.
Done on 2026-10-02.
New ideas keep arriving after that, and each gets an entry.

## 2. Users

Produces: [02-users](02-users.md).
Exit: each kind of pilot we design for is described, with what they need from a session.
Done on 2026-10-02.

## 3. v1 or later

Produces: the picks below, and the aircraft v1 supports.
Exit: every idea in [ideas](ideas.md) is in a bucket or under Ideas left out, and v1's aircraft are named.
Done on 2026-10-02.

An idea goes in one of three buckets:

- **v1:** the first release isn't done without it.
- **Soon:** we're committed to it, and it comes right after v1.
- **Later:** we want it, with no timing.

A pick can carry a condition, such as "v1 if its probe passes".
Where an entry bundles a small core with a bigger extension, such as a take-control key and voice phrases in Voice handover, each part gets its own pick.

v1 has these whatever is picked, because they're the product rather than ideas:

- flight-model sync, which keeps the aircraft's position, attitude, and velocity the same on every machine
- the connection between machines
- profiles, starting with the 58P's, written without the Crosscheck IDE, which is a Soon pick

v1's aircraft is the pressurized 58P variant of the [Black Square Baron Pro](../aircraft/black-square-baron-pro/study.md).

The picks, picked on 2026-10-02:

- **v1:**
  - [State sync](ideas.md#state-sync-with-variables-and-events)
  - [Pointer sync](ideas.md#pointer-sync)
  - [Traffic sync](ideas.md#traffic-sync)
  - Hearing ATC, from [ATC sync](ideas.md#atc-sync)
  - Time, date, sim rate, and pause, from [Environment sync](ideas.md#environment-sync)
  - [Preflight match check](ideas.md#preflight-match-check)
  - The two-step start, joining and then starting to fly, from [Pre-sync checklist](ideas.md#pre-sync-checklist), moved from Soon on 2026-10-03, because it's better built in from the start than added later
  - The PF's checklist of the profile's starting values, from [Pre-sync checklist](ideas.md#pre-sync-checklist), moved from Soon on 2026-10-04, because [catch-up](../sync/03-catch-up.md#when-preflight-ends) is right only if the PF's aircraft starts at them
  - [The PF's spot on the world map](ideas.md#the-pfs-spot-on-the-world-map), picked on 2026-10-05, when step 6's probe set the world map from code in the menu's document; it replaces flight setup by the host, which went to Ideas left out on 2026-10-03
  - The invite code, from [One-click invite](ideas.md#one-click-invite)
  - The take-control key, and voice phrases, both from [Voice handover](ideas.md#voice-handover)
  - Recording and bug reports, from [Flight recorder and debrief](ideas.md#flight-recorder-and-debrief)
  - Crosscheck's controls as an app on the sim's EFB, from [Crosscheck's interface in the EFB and on a tablet](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet), because [01-aims](01-aims.md) requires that a pilot in VR can use Crosscheck without taking the headset off
  - The [notification banner](ideas.md#notification-banner), split from Crosscheck objects in the cockpit and moved to v1 on 2026-10-03, because a notice can't depend on the EFB being open
  - [Avatar sync](ideas.md#avatar-sync), moved from Soon on 2026-10-03, which in v1 takes the 58P's seats and the spots of its controls from the profile, set without the Crosscheck IDE
  - [Plugins](ideas.md#plugins) for aircraft, with one for the 58P, picked on 2026-10-04, because the code that serves one aircraft needs a home outside Crosscheck's own code from the first aircraft on
- **Soon:**
  - [Ground operations sync](ideas.md#ground-operations-sync)
  - [Soft takeover](ideas.md#soft-takeover-on-handover), moved from v1 on 2026-10-03, because it needs masking, which is too large a job for v1
  - [Mixed flight controls](ideas.md#mixed-flight-controls)
  - The rest of the profile's checklist, and state watching, both from [Pre-sync checklist](ideas.md#pre-sync-checklist)
  - The [Crosscheck IDE](ideas.md#crosscheck-ide), out of v1's baseline on 2026-10-03, because the 58P's profile can be written without it
- **Later:**
  - [Bus bridge](ideas.md#bus-bridge)
  - [EventBus bridge](ideas.md#eventbus-bridge)
  - [WASM instrument sync](ideas.md#wasm-instrument-sync)
  - The second pilot's mic reaching ATC, from [ATC sync](ideas.md#atc-sync)
  - Weather, from [Environment sync](ideas.md#environment-sync)
  - Home-network discovery, from [One-click invite](ideas.md#one-click-invite)
  - Crews beyond two, and passengers, both from [Join modes](ideas.md#join-modes)
  - The tablet in a browser, from [Crosscheck's interface in the EFB and on a tablet](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet)
  - The debrief timeline, from [Flight recorder and debrief](ideas.md#flight-recorder-and-debrief)
  - Automatic profile fetch, and the community profile registry, both from [Profile registry](ideas.md#profile-registry)
  - [What doesn't sync](ideas.md#what-doesnt-sync), moved out of the aims on 2026-10-03, because we first learn what Crosscheck can sync
  - [Crosscheck objects in the cockpit](ideas.md#crosscheck-objects-in-the-cockpit), picked on 2026-10-03
  - [Telemetry](ideas.md#telemetry), picked on 2026-10-04
  - [Aircraft adapters](ideas.md#aircraft-adapters), picked on 2026-10-04, each built as a plugin

[Seat awareness](ideas.md#seat-awareness) left Soon on 2026-10-04: avatar sync took telling a pilot's seat into v1, the IDE pick places the seats, and moving a pilot's camera to a seat went to [Ideas left out](ideas.md#ideas-left-out), as did permanent codes.

How the connection shows to pilots, such as "Direct, 38ms" in One-click invite, is left to step 4, because it's a detail of the interface rather than a feature.

## 4. v1 scope

Produces: [03-v1-scope](03-v1-scope.md), written with the users from step 2 in mind.
Exit: every v1 feature, and installing and updating Crosscheck, is agreed: what it does, the cases v1 covers and leaves out, the rules for its behavior, what it depends on, and its open questions.
Then a pass strings the features into one session, from installing Crosscheck to ending a flight, and scopes the gaps between them, such as rejoining after a dropped connection and switching seats before or during a flight.

We take one feature at a time: we gather what the record establishes and what's open, discuss it, and run a sim probe where a decision needs data the record doesn't have.
We scope control first, because which pilot is flying decides which machine flies the aircraft, then sync, then the session, then the remaining features, and installing and updating last.

Agreed:

- The take-control key, on 2026-10-03.
- The voice phrases, on 2026-10-03.
- Flight-model sync, on 2026-10-03.
- State sync, on 2026-10-03.
- Pointer sync, on 2026-10-03.
- The invite code, on 2026-10-03.
- The connection, on 2026-10-03.
- The preflight match check, on 2026-10-03.
- Traffic sync, on 2026-10-03.
- Hearing ATC, on 2026-10-03.
- Time, date, sim rate, and pause, on 2026-10-03.
- Recording and bug reports, on 2026-10-03.
- The EFB app and the notification banner, on 2026-10-03, and revised on 2026-10-04.
- Installing and updating, on 2026-10-03.
- Avatar sync, on 2026-10-04.
- Plugins, on 2026-10-04, during step 5.

Every v1 feature is agreed, and so is the pass that strings them into one session, which added preflight on 2026-10-04.
The sync design that preflight's catch-up rests on, [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md), was agreed the same day.
Done on 2026-10-04.

## 5. What later features need from v1

Produces: [04-room-for-later](04-room-for-later.md).
Exit: each Soon and Later pick says what Crosscheck must allow for it, such as a low-delay stream of the other pilot's axes for mixed flight controls.
A pick gets only that much detail, so the architecture knows the future it has to leave room for.
Done on 2026-10-04, which also added Plugins to v1 and two probes to step 6.

## 6. Probes that retire architecture risks

Produces: entries in the logs of the areas the probes belong to.
Exit: each risk below has a log entry that answers it, or is deferred with a reason.

- Whether a CommBus message carried to the other machine changes that aircraft's state ([Bus bridge](ideas.md#bus-bridge)).
  Deferred until we look at the bus bridge again, after v1 (user, 2026-10-06).
- Whether our own code can listen on `wt.eb.evt` ([EventBus bridge](ideas.md#eventbus-bridge)).
  Answered on 2026-10-06: [CommBus log](../commbus/log.md#2026-10-06-our-own-code-hears-wtebevt-from-the-efbs-document-and-the-g3000-acts-on-a-package-it-sends).
- How much network delay mixed flight controls can take ([Mixed flight controls](ideas.md#mixed-flight-controls)).
  Answered on 2026-10-06, for one pilot in a light twin: [flight-controls log](../flight-controls/log.md#2026-10-06-a-pilots-own-pitch-and-roll-input-was-flyable-150ms-late-and-not-300ms-late-in-the-baron-at-cruise).
- What share of pilot pairs can't connect directly, which decides how much traffic the relay carries ([01-aims](01-aims.md#relay-and-license)).
  Answered on 2026-10-06 from research, not measurement: [network log](../network/log.md#2026-10-06-research-puts-the-share-of-pilot-pairs-that-need-the-relay-between-5-and-31-and-one-small-servers-transfer-covers-tens-of-thousands-of-session-hours-a-month).
- Whether a fast local recognizer hears the [voice phrases](03-v1-scope.md#voice-phrases) accurately with our accents, stays quiet inside longer sentences such as "you have control of the radios", and works while Discord uses the same microphone; an audio probe in `experiments/` answers it, with no sim.
  Deferred to the build: speech recognition is proven, so we research it, build our best version of what v1 needs, then test it with our voices and calibrate (user, 2026-10-06).
- Whether masking holds back the Baron's mixture levers, which the Baron takes through its own input events, such as `BKSQ_TurbochargedMixtureController_1` (read in its [study](../aircraft/black-square-baron-pro/study.md)); soft takeover depends on it.
  Answered on 2026-10-06: masking holds back a lever bound in MSFS and not one SPAD.neXt drives, so soft takeover needs another way for those pilots ([flight-controls log](../flight-controls/log.md#2026-10-06-masking-holds-back-a-mixture-lever-bound-in-msfs-and-not-one-spadnext-drives-because-spadnext-sets-the-input-event-itself)).
- Whether a click on a [notification banner](03-v1-scope.md#notification-banner) notice opens Crosscheck's EFB app when the app is on neither the EFB's dock nor the first page of its app list, and whether the app's own code runs while the EFB is closed.
  The probe fills the EFB with far more apps than its dock and the first page of its app list hold.
  The chain ran only from a stand-in we put into the EFB's document through the sim's inspector, pressing GSX's button on the dock ([interface log](../interface/log.md#2026-10-04-a-click-on-a-notice-in-our-panel-opens-the-efb-onto-another-app-whether-the-efb-was-open-or-closed)).
  Answered on 2026-10-06: [interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed).
- How the notification banner's panel shows in VR, which tells us whether it meets v1's commitment to VR pilots; nobody has tried.
  Deferred until we have a headset to try it with (user, 2026-10-06).
- Whether anything outside the sim can set the world map's departure, which decides whether [the PF's spot on the world map](ideas.md#the-pfs-spot-on-the-world-map) is in v1.
  Answered on 2026-10-05 through the sim's inspector: [interface log](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight).
  Whether a package of ours can put that code there was answered on 2026-10-06, through a copy of the sim's BlurPage component, in a run from a closed sim to Ready to fly: [interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly).
- How fast an aircraft takes stepped writes, which checks the default pace in [01-profile-entries](../sync/01-profile-entries.md#what-a-profile-says-once-per-aircraft): send the Synaptic A220's `K:HEADING_BUG_INC` 10 times in one frame, then once per frame, and count the degrees the bug moves (its study's sim question 5); write `L:INI_BARO1_INC_COMMAND` twice before one update of the iniBuilds A350, then once per update (its sim question 3); and add 10 to the Fenix's `L:E_FCU_HEADING` at once (its sim questions 1 and 2).
  Answered on 2026-10-05: [sync log](../sync/log.md#2026-10-05-the-a220s-fcp-ignores-stock-autopilot-events-the-a350-takes-a-command-at-most-every-2-frames-and-the-fenix-reads-a-counters-jump-as-that-many-detents), and for the A350's heading, [sync log](../sync/log.md#2026-10-05-the-a350s-stock-heading-is-an-output-of-its-module-and-its-dial-takes-a-value-written-straight-into-it).
- When an aircraft loaded cold stops restoring its own controls, which checks [catch-up's settle rule](../sync/03-catch-up.md#settling-after-a-load): load each studied aircraft and log every variable it changes, every 250ms for 3 minutes; the Baron's sim question 2 is part of it.
  Answered on 2026-10-05, from every change for 2 minutes after Ready to fly: [sync log](../sync/log.md#2026-10-05-every-aircraft-restores-its-switches-within-15s-of-ready-to-fly-and-settling-timed-from-fly-misleads).
- Whether the input event double-fire stays inside [live sync's duplicate filter](../sync/02-live-sync.md#keeping-a-change-from-applying-twice) at low frame rates (the PA-24 session's wasn't recorded), and whether a held key bound to a momentary input event repeats inside that window.
  Answered on 2026-10-05 for the PA-24: [sync log](../sync/log.md#2026-10-05-the-pa-24s-double-fire-comes-one-frame-apart-at-31-and-21-fps-and-a-held-key-doesnt-repeat).
- Whether SimConnect applies the writes Crosscheck sends in one frame in the order sent, how long an aircraft takes to show a write, and how many retries a write takes to land on each studied aircraft, which decide catch-up's order and live sync's read-back wait and retry count.
  Answered on 2026-10-05: [sync log](../sync/log.md#2026-10-05-two-writes-in-one-frame-land-in-the-order-sent-and-a-write-shows-within-2-frames).
- Whether one sim draws several of our figures, each posed from variables of its own object, and what 2, 20, and 180 figures cost in frame time with every joint moving every frame, which decides how the avatars' module and channel are built ([04-room-for-later](04-room-for-later.md#people-beyond-the-crew)).
  Answered on 2026-10-05, up to 1,000 figures: [avatars log](../avatars/log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view).
- Whether an EFB app and the notification banner's in-game panel can each hold a WebSocket to a program on the same PC, as a cockpit panel can, or show a page that program serves, as the Fenix's tablet app does, which decides whether every client of Crosscheck speaks one protocol ([04-room-for-later](04-room-for-later.md#one-protocol-for-every-client)).
  Answered on 2026-10-05: [interface log](../interface/log.md#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves).

The world map probe and the six after it, on stepped writes, settling, the double-fire, writes landing, figures, and WebSockets, made one batched sim session, on 2026-10-05.
The probes on `wt.eb.evt`, the Baron's mixture, the crowded EFB, and the world map from our package made a second, on 2026-10-06.
Steps 4 and 5 add to this list as they find risks.

## 7. Tech stack and architecture

Produces: decisions in `record/decisions/`.
The work runs as a tree of questions in [the architecture plan](../architecture/plan.md), which says where it stands.
Exit: the language, the frameworks, the core architecture, and the profile format each have a decision.
The profile format takes the shape [01-profile-entries](../sync/01-profile-entries.md) gives it, two blocks of entries and a writer API, and the decision picks its syntax and file layout.
The decisions also pick whether each machine sends to every other directly or through the flying machine ([live sync](../sync/02-live-sync.md#one-stream-in-causal-order)), the sandbox that write functions run in, with its size limits, and the order catch-up applies state in, where we lean toward first-final-value order ([catch-up](../sync/03-catch-up.md#choosing-the-order)).
They build in what [04-room-for-later](04-room-for-later.md) says v1 builds now, and pick where each part of a [plugin](03-v1-scope.md#plugins) runs and what language plugins are written in.
The tooling includes one check that every file that runs in Coherent GT, experiments included, parses within the engine's measured limits, run in CI and after edits; before writing its rules, we look for Coherent GT's own documentation of its JavaScript and for rules others already maintain.

The leading candidate for the core architecture, proposed on 2026-10-03, is a headless core that owns SimConnect, the session, and the network, with the desktop app, the EFB app, and the in-sim pieces as its clients, and later the tablet and perhaps the Crosscheck IDE.
The EFB app is panel code that runs in Coherent GT, whose user agent claims Chrome 49 while its measured features don't match it (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), so code it shares with the desktop app is compiled down to the syntax that engine parses, with the missing functions filled in, and what it can share depends on what the EFB's own app framework and Coherent GT's CSS allow, which a probe measures.
The architecture lets a Crosscheck developer run a whole session on one machine: two cores, each with its own ports and identity, and a stand-in for the second pilot's sim, as fsc-exerciser does and as the FS Copilot fork's two-instance bench did (measured on a two-instance bench, 2026-09-12, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "Q12 is survivable and it is not a two-pilot special case").
Whether a second MSFS, with its own Crosscheck, can run in a virtual machine on the same PC is open, and a probe settles it.

On 2026-10-06 we leaned toward TypeScript throughout, with Electron only for the windows people look at, and toward running Crosscheck as two processes (user):

- **A watcher,** which starts with Windows, for the pilot's own account and as a setting, and does only this: it notices the sim's process starting and stopping, from the operating system rather than SimConnect; keeps our copy of BlurPage current by watching the sim's own file; applies a plugin's changes to an aircraft's files before the sim boots; installs Crosscheck's updates while the sim is closed, which takes over the helpers [installing and updating](03-v1-scope.md#installing-and-updating) describes; and starts the core.
- **The core,** a plain Node process with no Electron, which starts with the sim and runs as long as it does, out of sight, with the desktop app and the EFB app as its clients.

A pilot who rarely flies with a crew will ask why the watcher runs all day, so it records its own CPU and memory use and shows them over its last 24 hours of running, in words a pilot takes in at a glance, when they open it from the tray icon, choose to quit it, or find its setting.
Beside the numbers it says what it does for them and what quitting costs, in concrete terms, such as Go to staying off after a sim update until Crosscheck runs again.
It asks once per quit, gives Quit and Keep running equal weight, and a choice to turn it off stays off (user, 2026-10-06).

A core that's running when the sim starts has its masks registered before any aircraft's module, which decided who got the pilot's input on the PA-24 ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)).
It also lets a pilot who started the sim with no plan to fly together start or join a session later, from the EFB app.
An idle Node process took 29 MB of memory and no measurable CPU, and Electron 43's own executable running as plain Node took 35 MB (measured on our development machine, 2026-10-06, with Node 22.23.1).
Whether the core can claim its masking priority at sim start without holding back the pilot's controls until a session wants them is unverified, and a probe settles it.

Step 7 also decides sim awareness, a part of the core proposed on 2026-10-06 (user) that reports whether the sim is closed, starting, in the menu and on which page, loading, at Ready to fly, or in a flight and with which aircraft.
It reports state only and knows nothing of features: a feature that depends on the sim's state reads it there instead of watching the sim itself, and decides on its own what to do with it, as preflight's Go to button is unavailable on a page it can't work from ([03-v1-scope](03-v1-scope.md#preflight); [interface log](../interface/log.md#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
Its sources are the sim's process, SimConnect's system and flow events, and the page our script in the menu reports, and it reports a page it doesn't know as unknown rather than guessing.

## 8. v1 build plan

Produces: a plan with build stages, in the areas the architecture names.
Exit: everything v1 includes, the picks and the three parts step 3 lists, is in a stage with its own exit criterion.

## 9. Build, test, and release v1

Exit: both of these happen.

- We fly a full flight with a friend, gate to gate, in an aircraft we list, and neither pilot notices the cockpits disagree.
- A friend who has never used Crosscheck installs it and flies with us without our help.

## 10. After v1

What follows v1 gets decided once v1 ships.
