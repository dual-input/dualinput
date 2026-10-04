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
  - [The PF's spot on the world map](ideas.md#the-pfs-spot-on-the-world-map), if a probe finds a way to set the world map from outside the sim; it replaces flight setup by the host, which went to Ideas left out on 2026-10-03
  - The invite code, from [One-click invite](ideas.md#one-click-invite)
  - The take-control key, and voice phrases, both from [Voice handover](ideas.md#voice-handover)
  - Recording and bug reports, from [Flight recorder and debrief](ideas.md#flight-recorder-and-debrief)
  - Crosscheck's controls as an app on the sim's EFB, from [Crosscheck's interface in the EFB and on a tablet](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet), because [01-aims](01-aims.md) requires that a pilot in VR can use Crosscheck without taking the headset off
  - The [notification banner](ideas.md#notification-banner), split from Crosscheck objects in the cockpit and moved to v1 on 2026-10-03, because a notice can't depend on the EFB being open
  - [Avatar sync](ideas.md#avatar-sync), moved from Soon on 2026-10-03, which in v1 takes the 58P's seats and the spots of its controls from the profile, set without the Crosscheck IDE
- **Soon:**
  - [Ground operations sync](ideas.md#ground-operations-sync)
  - [Soft takeover](ideas.md#soft-takeover-on-handover), moved from v1 on 2026-10-03, because it needs masking, which is too large a job for v1
  - [Mixed flight controls](ideas.md#mixed-flight-controls)
  - [Seat awareness](ideas.md#seat-awareness), except telling a pilot's seat from where their camera is, which avatar sync took into v1 on 2026-10-04
  - The profile's checklist, and state watching, both from [Pre-sync checklist](ideas.md#pre-sync-checklist)
  - The [Crosscheck IDE](ideas.md#crosscheck-ide), out of v1's baseline on 2026-10-03, because the 58P's profile can be written without it
- **Later:**
  - [Bus bridge](ideas.md#bus-bridge)
  - [EventBus bridge](ideas.md#eventbus-bridge)
  - [WASM instrument sync](ideas.md#wasm-instrument-sync)
  - The second pilot's mic reaching ATC, from [ATC sync](ideas.md#atc-sync)
  - Weather, from [Environment sync](ideas.md#environment-sync)
  - Home-network discovery, and permanent codes, both from [One-click invite](ideas.md#one-click-invite)
  - Crews beyond two, and passengers, both from [Join modes](ideas.md#join-modes)
  - The tablet in a browser, from [Crosscheck's interface in the EFB and on a tablet](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet)
  - The debrief timeline, from [Flight recorder and debrief](ideas.md#flight-recorder-and-debrief)
  - Automatic profile fetch, and the community profile registry, both from [Profile registry](ideas.md#profile-registry)
  - [What doesn't sync](ideas.md#what-doesnt-sync), moved out of the aims on 2026-10-03, because we first learn what Crosscheck can sync
  - [Crosscheck objects in the cockpit](ideas.md#crosscheck-objects-in-the-cockpit), picked on 2026-10-03
  - [Telemetry](ideas.md#telemetry), picked on 2026-10-04

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

Every v1 feature is agreed, and so is the pass that strings them into one session, which added preflight on 2026-10-04.
Step 4 stays open until the architecture, in step 7, settles one question: whether v1 can bring every cockpit to the PF's state when preflight ends ([state sync](03-v1-scope.md#state-sync)).

## 5. What later features need from the core

Produces: a design doc.
Exit: each Soon and Later pick says what the core must allow for it, such as a low-delay stream of the other pilot's axes for mixed flight controls.
A pick gets only that much detail, so the architecture knows the future it has to leave room for.

## 6. Probes that retire architecture risks

Produces: entries in the logs of the areas the probes belong to.
Exit: each risk below has a log entry that answers it.

- Whether a CommBus message carried to the other machine changes that aircraft's state ([Bus bridge](ideas.md#bus-bridge)).
- Whether our own code can listen on `wt.eb.evt` ([EventBus bridge](ideas.md#eventbus-bridge)).
- How much network delay mixed flight controls can take ([Mixed flight controls](ideas.md#mixed-flight-controls)).
- What share of pilot pairs can't connect directly, which decides how much traffic the relay carries ([01-aims](01-aims.md#relay-and-license)).
- Whether a fast local recognizer hears the [voice phrases](03-v1-scope.md#voice-phrases) accurately with our accents, stays quiet inside longer sentences such as "you have control of the radios", and works while Discord uses the same microphone; an audio probe in `experiments/` answers it, with no sim.
- Whether masking holds back the Baron's mixture levers, which the Baron takes through its own input events, such as `BKSQ_TurbochargedMixtureController_1` (read in its [study](../aircraft/black-square-baron-pro/study.md)); soft takeover depends on it.
  We expect it to hold, because on the 58P masking the throttle's key events also stopped the throttle's input event (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)), but nobody has masked the mixture.
- Whether a click on a [notification banner](03-v1-scope.md#notification-banner) notice opens Crosscheck's EFB app when the app is on neither the EFB's dock nor the first page of its app list, and whether the app's own code runs while the EFB is closed.
  The probe fills the EFB with far more apps than its dock and the first page of its app list hold.
  The chain ran only from a stand-in we put into the EFB's document through the sim's inspector, pressing GSX's button on the dock ([interface log](../interface/log.md#2026-10-04-a-click-on-a-notice-in-our-panel-opens-the-efb-onto-another-app-whether-the-efb-was-open-or-closed)).
- How the notification banner's panel shows in VR, which tells us whether it meets v1's commitment to VR pilots; nobody has tried.
- Whether anything outside the sim can set the world map's departure, which decides whether [the PF's spot on the world map](ideas.md#the-pfs-spot-on-the-world-map) is in v1.
Steps 4 and 5 add to this list as they find risks.

## 7. Tech stack and architecture

Produces: decisions in `record/decisions/`.
Exit: the language, the frameworks, the core architecture, and the profile format each have a decision.
The profile format waits for the features, because they decide what it has to express, and it decides in turn how a cockpit takes the flying machine's state at once, when preflight ends, when a late joiner arrives, and after a reconnect ([state sync](03-v1-scope.md#state-sync)).

The leading candidate for the core architecture, proposed on 2026-10-03, is a headless core that owns SimConnect, the session, and the network, with the desktop app, the EFB app, and the in-sim pieces as its clients, and later the tablet and perhaps the Crosscheck IDE.
The EFB app is panel code that runs in Coherent GT, whose user agent claims Chrome 49 while its measured features don't match it (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), so code it shares with the desktop app is compiled down to the syntax that engine parses, with the missing functions filled in, and what it can share depends on what the EFB's own app framework and Coherent GT's CSS allow, which a probe measures.
The pilot starts the core whenever they want a shared cockpit; the EFB app, opened while the core isn't running, says so and offers to start it if a panel can (unverified).
The architecture lets a Crosscheck developer run a whole session on one machine: two cores, each with its own ports and identity, and a stand-in for the second pilot's sim, as fsc-exerciser does and as the FS Copilot fork's two-instance bench did (measured, 2026-09-12, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "Q12 is survivable and it is not a two-pilot special case").
Whether a second MSFS, with its own Crosscheck, can run in a virtual machine on the same PC is open, and a probe settles it.

## 8. v1 build plan

Produces: a plan with build stages, in the areas the architecture names.
Exit: everything v1 includes, the picks and the three parts step 3 lists, is in a stage with its own exit criterion.

## 9. Build, test, and release v1

Exit: both of these happen.

- We fly a full flight with a friend, gate to gate, in an aircraft we list, and neither pilot notices the cockpits disagree.
- A friend who has never used Crosscheck installs it and flies with us without our help.

## 10. After v1

What follows v1 gets decided once v1 ships.
