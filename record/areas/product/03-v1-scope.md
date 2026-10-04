# Product: v1 scope

```text
Purpose:     What each v1 feature does, where v1 stops, and the rules for its behavior.
Depends on:  01-aims.md, 02-users.md, and the v1 picks in plan.md
Decides:     The scope of every v1 feature.
```

This document walks one v1 session from start to finish, then scopes each feature [the plan](plan.md) puts in v1, one section per feature, in the order step 4 gives.
Each feature's section says what the feature does, the cases v1 covers and leaves out, the rules for its behavior, what it depends on, and its open questions.
It says what Crosscheck does, not how: mechanisms are for the sync design in `record/areas/sync/` and the architecture, step 7, and screens and wording for a later pass.

The pilot flying (PF) is the pilot whose yoke, rudder, toe brakes, engine levers, and trim fly the aircraft, and the pilot monitoring (PM) is the other front-seat pilot.
The flying machine is the PF's, and a following machine is any other pilot's, in v1 the PM's.
v1 sessions have two pilots, because crews beyond two are a Later pick, but v1 builds what larger crews need from it ([04-room-for-later](04-room-for-later.md#people-beyond-the-crew)), so nothing gets rebuilt when they come.

## A session from start to finish

A v1 session runs in this order, and each step's rules are in the section it links to.

1. Each pilot installs Crosscheck once, with its Community package ([installing and updating](#installing-and-updating)).
2. Crosscheck and the sim start in either order, and the host starts a session and shares its code, which the other pilots enter to join ([invite code](#invite-code)).
3. Each pilot loads a flight at the PF's stand, which Crosscheck shows them, and once they're in it, Crosscheck moves their aircraft to the PF's position and holds every aircraft still for [preflight](#preflight).
4. In preflight, each pilot works through the [preflight match check](#preflight-match-check)'s list, takes a seat ([avatar sync](#avatar-sync)), and clicks Ready, and the PF also checks the profile's starting values.
5. When every pilot is ready, a countdown ends [preflight](#preflight): every other pilot's cockpit takes the PF's value for every control the profile can read or track, and the aircraft is free to move.
6. The crew flies, passing control by the [take-control key](#take-control-key) or the [voice phrases](#voice-phrases), with [notices](#notification-banner) for what needs their attention.
7. A pilot who drops out reconnects or rejoins as a late joiner, and the others fly on ([the connection](#the-connection)).
8. Each pilot leaves with Leave session, the session ends with the last, and each machine keeps its recording for a [bug report](#recording-and-bug-reports).

## Control

### Take-control key

A pilot presses take-control and becomes the PF at once, and their machine becomes the flying machine.

**In v1:**

- v1 flies the traditional way, as FS Copilot does: the following machine freezes its aircraft's position, altitude, and attitude, and takes the flying machine's values (read in the FS Copilot fork, `FsCopilot/Simulation/MasterSwitch.cs`, `FsCopilot/Simulation/Coordinator.cs`, and `FsCopilot.Bridge.Wasm/wasm_module.cpp`).
- Taking control from a button in Crosscheck's app or its EFB app, a keyboard key, or a button on the pilot's flight hardware.
- The pilot binds the key or hardware button in Crosscheck's settings, not the sim's, and chooses whether it takes a single press or a long press.

**Not in v1:**

- Soft takeover and masking, which are Soon picks in [the plan](plan.md).
- A button to give control away.
  The PF gives control only by voice, through the [voice phrases](#voice-phrases).

**Rules:**

- The host is the PF when a session starts.
- Any pilot can take control at any time, and it passes at once, without the PF agreeing.
- When two pilots press take-control at nearly the same moment, the earlier press wins, however small the gap.
- The PF's yoke, rudder, toe brakes, engine levers, and trim fly the aircraft.
  The engine levers are the throttles, propellers, and mixtures.
- The PM's hardware can't change the following aircraft's flight controls, engine levers, or trim for longer than it takes the flying machine's next values to arrive, so the following aircraft's engines and gauges match the flying machine's.
  In FS Copilot a PM's throttle could spool up their own engine until the PF next moved theirs, because the flying machine sends a value only when it changes (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, and from our experience with FS Copilot).
  The PM's mouse on those controls snaps back the same way (unverified, and not worth a probe).
- Flaps and gear work from either pilot's hardware at any time.
- At a handover, each of the aircraft's levers stays where it was until the new PF moves theirs, and then jumps to where their hardware is.
  The aircraft itself doesn't jump or lose noticeable speed at a handover (from our experience with FS Copilot).
- When control passes, both pilots hear the control-passed cue that the [voice phrases](#voice-phrases) use, the pilot who took it hears a recorded "you have control", and the pilot who lost it hears "they have control".
- When the PF's connection drops, control passes to the PM, never to a flight engineer or a passenger, and the PM hears "you have control".
  If the PM is catching up, their catch-up stops first.

**Depends on:**

- Flight-model sync, which the following machine's frozen aircraft takes its position, attitude, and velocity from.
- State sync, for flaps and gear from either pilot.

**Open questions:**

- How the machines agree on which of two presses came first, which the architecture settles.
- An axis that fires events while nobody moves it jumps its lever as soon as control passes.
  A dead zone set in MSFS stops that, since the axis fires no event inside one (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)), and whether pilots need more than that is unknown.

### Voice phrases

The PF offers control by voice, and the PM takes it by answering within 5s.

**In v1:**

- An offer is "You have" followed by control, controls, the controls, the flight controls, the aircraft, or the airplane, and an answer is "I have" followed by any of the same.
  Those are the endings regulators, militaries, and airlines use, with "You have …" and "I have …" the shape in every convention we found (documented: [FAA AC 61-115](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40455386&FileExtension=.PDF&FileName=FAA+AC+61_115_Positive+Exchange+of+Flight+Controls-Master.PDF), [Transport Canada TP 975](https://tc.canada.ca/sites/default/files/migrated/tp975e.pdf), [UK MAA RA 2309](https://assets.publishing.service.gov.uk/media/62454dcdd3bf7f32a7c01197/RA2309_Issue_8.pdf), [USAF AFMAN 11-248](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40445920&FileExtension=.PDF&FileName=Operations+-+Attachment+16+-+Excerpts+%E2%80%93+AFMAN+11-248+T-6+General+Flying-Master.PDF), [US Army TC 3-04.51](https://asktop.net/wp/download/5/tc3_04x51.pdf), and Airbus as quoted in [AAIB Bulletin 1/2013](https://assets.publishing.service.gov.uk/media/5423034de5274a1314000b7f/Airbus_A319-111_G-EZFV_01-13.pdf)).
- "Your controls" also offers and "my controls" also answers, for pilots who hand over casually, though we found the pair only on a blog (unverified).
- English, recognized as well as the recognizer manages with each pilot's accent.
- Crosscheck listens whenever a session is syncing, with no push-to-talk key.

**Not in v1:**

- Taking control by voice without an offer.
  Instructors do it in every convention that covers it, such as the FAA's "I have the flight controls", but the [take-control key](#take-control-key) covers it, and a misheard phrase can't move control.
- "You've got it" and "I've got it", which AOPA warns against because nobody can tell who has the aircraft ([AOPA](https://www.aopa.org/news-and-media/all-news/2023/august/08/training-and-safety-tip-ive-got-it-youve-got-it-whos-got-it)).
- "Your airplane" and "my airplane", which pilots say casually (unverified).
- Canceling an offer: it expires after 5s instead.
- Waiting for the FAA's third call, the offer repeated, which no other convention we found has.
- Languages other than English.

**Rules:**

- Crosscheck hears each pilot only through their own microphone, so it always knows who spoke.
  That's what tells an offer from an answer, since the two differ only in "you" and "I".
- Only the PF's offer counts, and it opens a 5s window.
- The PM's answer inside the window passes control, and the endings needn't match: "You have control" answered with "I have the aircraft" passes it.
- Every other phrase does nothing, including an answer outside a window and "I have control" from the PF.
- Both pilots hear a subtle cue when an offer opens a window, another when control passes, and a third when a window times out.
  The control-passed cue is the same one the [take-control key](#take-control-key) plays, so pilots learn one sound for it.
- A voice handover plays no recorded lines, because the pilots already hear each other say the phrases.
- Audio never leaves the pilot's machine: the recognizer runs locally and answers fast.
  It needn't be a model, but it isn't Windows' own speech recognition, which recognizes poorly (from our own use).

**Depends on:**

- The [take-control key](#take-control-key)'s rules for what control covers.

**Open questions:**

- Whether a local recognizer is accurate enough with non-native English accents, the first thing to test, which a step 6 audio probe in [the plan](plan.md) answers.
- Whether a phrase counts inside a longer sentence.
  A UK CAA examiner says "follow me through, you have control" ([CAA Standards Document 01(H)](https://www.caa.co.uk/publication/download/13074)), and the same rule would let "you have control of the radios" open a window.
- How Crosscheck tells speech from noise before it listens for a phrase.
  The intent is to run recognition only while the pilot's microphone is loud enough to be speech, and the architecture designs it.

## Sync

### Flight-model sync

The following machine's aircraft goes where the flying machine's goes, with the same position, attitude, and motion, so both pilots fly one aircraft.

**In v1:**

- The following machine freezes its aircraft's position, altitude, and attitude, as FS Copilot's does (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`).
- Each frame it writes the flying machine's pose and its body and rotation velocities.

**Not in v1:**

- Different scenery on the two machines.
  The following aircraft sits high or low against its own ground (from our experience with FS Copilot), and a frozen Baron's ground contact follows the written altitude, so a few feet high tells it it's airborne (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-the-barons-ground-contact-follows-the-written-altitude-and-its-own-physics-writes-dont-hold-against-ours)).

**Rules:**

- The following machine writes the velocities along with the pose, every frame.
  A frozen aircraft keeps integrating its own velocities, and with the pose alone a replayed Baron's airspeed was 22 kt off within two minutes, where written velocities kept it within 3.2 kt (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-written-every-frame-the-velocities-hold-and-the-followers-airspeed-matches-while-its-engine-temperatures-start-apart)).
- The following aircraft moves smoothly in flight.
  Writes from outside the sim stutter in a moving cockpit and writes from inside the sim's frame don't (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-writes-from-outside-the-sim-place-an-object-in-a-moving-cockpit-but-cant-hold-it-still)), and the architecture decides how.
- The PM sees the aircraft about 0.4s plus the network delay behind the PF, as FS Copilot's following machine draws it 400ms in the past (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm`).
  That's acceptable, because the PM has nothing to compare it against, and shortening it is welcome but not required.
- At a handover, the new flying machine carries on from the last state it was written, and a small step there is acceptable (from our experience with FS Copilot).
- If Crosscheck stops on the following machine, the aircraft unfreezes within about 1s and nothing writes to it afterward.
  FS Copilot's module unfreezes after 1s without a write, and may keep writing its last pose into the unfrozen aircraft after that (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`; unverified in the sim).

**Depends on:**

- The [take-control key](#take-control-key), for which machine flies.
- The flying machine's engine levers reaching the following machine continuously, as the take-control key's rules require: in the replay they carried RPM, manifold pressure, and fuel flow.

**Open questions:**

- Whether two machines with the same scenery agree on the ground's elevation closely enough, which needs two PCs.
- Whether the single-frame spikes in the replayed body and rotation velocities, up to 7.6 ft/s and 2.3 rad/s, show on screen or come from mixing samples across sharp changes such as the touchdown.

### State sync

A change either pilot makes in the cockpit shows up in the other pilot's cockpit, so both cockpits stay in the same state.

**In v1:**

- Every control, and every panel with a function in flying the aircraft, display units included, that the aircraft's profile names.
- A cockpit that missed changes, or never had them, catches up ([catch-up](../sync/03-catch-up.md)).
  When [preflight](#preflight) ends, when a pilot joins late, and when one rejoins after a sim restart, it takes the flying machine's value for every control the profile can read, or can track by counting the events that change it.
  After a short outage with the sim still running, it replays the changes it missed, in order.
- Crosscheck checks that each write it makes lands, and when one never does, it marks the recording and shows a notice on the [notification banner](#notification-banner) ([live sync](../sync/02-live-sync.md#checking-that-a-write-landed)).

**Not in v1:**

- Telling pilots what on their aircraft doesn't sync, a Later pick in [the plan](plan.md), because we first learn what Crosscheck can sync.
- Comparing whole cockpits through a flight to find ones that drifted apart, beyond checking each write, because we don't know how reliably Crosscheck can read an aircraft's state, and a resync prompt interrupts the pilots ([Ideas left out](ideas.md#ideas-left-out)).
- Catching up what neither the profile nor the aircraft's [plugin](#plugins) reaches, such as a display's page or an FMS's contents.
- Catching a restore that lands after Crosscheck judged the aircraft settled, which moves that control in every cockpit, the PF's included ([catch-up](../sync/03-catch-up.md#settling-after-a-load)).
- The pilot's own MSFS EFB overlay.

**Rules:**

- The profile marks which of its entries belong to the PF: the aircraft's flight controls, toe brakes, engine levers, and trim, the categories the [take-control key](#take-control-key) names.
  Those reach the following machine from the flying machine.
  Everything else in the profile is shared: either pilot can change it, and the other cockpit follows.
- When both pilots change the same shared entry at nearly the same moment, both machines end on the same value: the later change when one pilot saw the other's, and the PF's when neither did ([live sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
- Crosscheck sends every change a pilot makes, and never a change it applied itself.
  The PM turns the beacon on, Crosscheck sets it on the PF's machine, and the PF's sim reports that the beacon changed: Crosscheck doesn't send that report back.
  If the PF turns the beacon off half a second later, that change goes through, where a guard that ignores reports for a while after each write would drop it, as one dropped two real pilot inputs in our FS Copilot work ([08-02](../../learn/foundations/08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)).
- A change the aircraft makes on its own syncs like a pilot's, such as the Baron taking its chocks away once it moves (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-the-barons-ground-contact-follows-the-written-altitude-and-its-own-physics-writes-dont-hold-against-ours)).
- Until an aircraft has settled after a load, the changes it makes to itself don't sync: in preflight, Ready waits for it, and while a cockpit catches up, Crosscheck moves those changes back to the PF's state ([catch-up](../sync/03-catch-up.md#settling-after-a-load)).

**Depends on:**

- Profiles, which name what syncs, how each entry is set, and which entries belong to the PF ([profile entries](../sync/01-profile-entries.md)).
- The [take-control key](#take-control-key), for which machine is flying.

### Pointer sync

A press or drag on a panel display travels to the other machine as the position the pointer went to, and the receiving display decides what's there, which reaches displays whose state Crosscheck can't read or write.

**In v1:**

- Presses and drags on the HTML displays the aircraft's profile names.
- The pointer sync logic of our FS Copilot fork, carried over as it is, including the overlay while a peer's gesture replays and the lock on the following pilot's displays during a long outage (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`).

**Not in v1:**

- The scroll wheel, hover, and long presses.
- Showing which pilot is working which display, such as "FO on the MCDU".
  [Avatar sync](ideas.md#avatar-sync) may show it, and if it doesn't, we'll look again later.
- Displays drawn by WASM code, which need [WASM instrument sync](ideas.md#wasm-instrument-sync), a Later pick.

**Rules:**

- A gesture replays at the same position, as a fraction of the display's size, and the receiving display decides what it hits.
  A peer's press sent that way drove the A220's ND to plan mode, and replayed drags work with a small drift in their timing (measured on MSFS 2024, 2026-09-17 and 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "A peer's press drove the real A220 ND, opted in by identifier alone" and "The drag drift candidate is real but small, and temporal not spatial").
- A replayed press does what the pilot meant only when both displays show the same page, and Crosscheck can't check that they do, because a display's page is state no profile entry reads.
- During a long outage, the following pilot's synced displays lock, and taking control unlocks them (measured on a two-instance bench, 2026-09-12, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "Q12 is survivable and it is not a two-pilot special case").

**Depends on:**

- Profiles, which name the displays.
  A display's identifier can carry the livery, as the A220's `DisplayUnits|config=N324DU` does, so matching it is the profile format's job and comparing liveries is the [preflight match check](ideas.md#preflight-match-check)'s (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "The A220's DisplayUnits key carries the livery, and the profile names only Default").

**Open questions:**

- When both pilots type on one display at once, each machine may apply the keys in a different order (unverified, [08-06](../../learn/foundations/08-06-divergence-and-one-screen.md#unverified-claims)).

### Plugins

A plugin is code we ship for one aircraft or one add-on.
It finds state a profile can't reach, exports it as values the profile watches, registers the write methods that set them, and reaches the rest through hooks into Crosscheck, so Crosscheck's own code never names a product.

**In v1:**

- Plugins for aircraft, with one in v1, the 58P's.
  Some of the 58P's radio settings live only in its gauges' JavaScript, where no profile entry reaches: the ADF's modes and timers, the KAS 297B's armed vertical speed, and the radar's range and modes (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)).
  The radios' knob-pulled states are mirrored to `L:` variables the gauges never read back, such as `L:COM_1_KNOB_PULLED`, so a profile can watch them, but setting one takes a write method or the gauge's own events (same study).
  The plugin's first candidate job is to find them in the gauges' panel documents, export them as values that the 58P's profile syncs and [catch-up](../sync/03-catch-up.md) applies like any other entry, and register the write methods that set them, and its job is settled when the 58P's profile is written.
  The tablet's 15 saved settings need no plugin, because each mirrors an `L:` variable the profile syncs directly, such as `L:var_FrontArmrest` (same study).
  The profile's settings for following machines would keep each following machine's tablet from rolling failures of its own, if a failure rate of 0 stops the rolls (unverified, the Baron study's sim questions 3 and 7; [01-profile-entries](../sync/01-profile-entries.md#what-a-profile-says-once-per-aircraft)).
- Plugins ship with Crosscheck, in its installer and its Community package, and update with it, so every pilot in a crew runs the same plugins: pilots on different Crosscheck versions can't fly together ([installing and updating](#installing-and-updating)).
- A plugin says which aircraft it applies to, such as every variant of the Baron Pro, and Crosscheck runs it while one of them is loaded, so pilots never install a plugin or pick one to run, and can turn off only one that changes their aircraft's files.

**Not in v1:**

- Plugins for add-ons, such as one for GSX, which comes with [ground operations sync](ideas.md#ground-operations-sync), a Soon pick.
- Plugins delivered apart from a Crosscheck release.
- Changing an aircraft's files, unless the 58P's plugin needs it.
- The KNS-81's 10 waypoints, which the gauge keeps in its JavaScript, saves to the sim's DataStorage every 60s while it has power, and reads back only when it loads (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)).
  A plugin could sync them: its write method would write the PF's waypoints to the gauge's keys with the sim's `SetStoredData` (documented, as the Baron study cites it; not run, the study's sim question 11), then reload the gauge's panel document, which our FS Copilot fork did from the sim's inspector (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone"), though a reload from a plugin's own panel code is untried.
  Or it would call the gauge's own `radioConfigLoad`, which nobody has tried either.
  The KNS-81 sits alone in its panel document, `VCockpit13`, so a reload costs only its own JavaScript state: the displayed and used waypoint, the navigation mode, and the data entry mode, of which it mirrors only the waypoint number and the data entry mode to `L:` variables (same study).

**Rules:**

- Code that serves one aircraft or add-on lives in a plugin, never in Crosscheck's own code, so dropping support for an aircraft means removing its plugin and its profile.
- Each aircraft has one plugin, which runs alongside any add-on's plugin, and plugins for aircraft that share code share it through a library they import rather than a copy.
  Black Square's Baron Pro and Bonanza Pro each ship a tablet file named `BlackSquareTablet.js`, of 4,830 and 5,383 lines (read in bksq-aircraft-baronpro 0.1.1 and bksq-aircraft-bonanzapro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md), [Bonanza study](../aircraft/black-square-bonanza-pro/study.md)), and how much code the two share is unverified.
- A plugin may read the sim, the aircraft's panels, and the pilot's files directly, because we review every plugin.
  It changes what Crosscheck watches only in the write methods it registers, which run only when Crosscheck calls them, because Crosscheck would see any other change as a pilot's and send it to the crew.
  A write method writes however the aircraft needs, such as into DataStorage or a gauge's JavaScript ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
- Crosscheck turns off a plugin that fails for the rest of the session, the [notification banner](#notification-banner) says so, and the flight goes on.
- A plugin changes an aircraft's files only on the pilot's machine, the pilot can turn such a plugin off in Crosscheck's settings, and Crosscheck never ships a file of another developer's ([decision 001](../../decisions/001-changing-other-developers-packages.md)).

**Depends on:**

- Profiles, which name the values a plugin exports.
- [State sync](#state-sync), which syncs those values as it syncs any entry.

**Open questions:**

- Whether a plugin's panel code can read and set the radio settings in the 58P's gauges' JavaScript from their panel documents (unverified).
- Where each part of a plugin runs, in Crosscheck's core, the program that owns the session ([EFB app](#efb-app)), in the aircraft's panels, or in a WASM module, and what language plugins are written in, which step 7 of [the plan](plan.md) decides.
- Whether authors outside our team write plugins after v1, and what makes that easy.

## Session

### Invite code

The host starts a session and gets a code, and the other pilot enters it to join.

**In v1:**

- The code is six characters from the 30-character alphabet fsc-editor uses, which leaves out I, L, O, U, 0, and 1, because codes are read aloud and typed by someone looking at a sim (read in fsc-editor, `src/shared/remote-connect.ts`, `CODE_ALPHABET`, and `docs/remote-connect.md`, "The code").
- When the pilot selects the box for the code, Crosscheck fills it from the clipboard if the clipboard holds a code, and joins at once.
- The code belongs to the session, not to any pilot's machine, and lasts until the last pilot leaves, so it doesn't change when control passes, and a pilot who dropped out rejoins with the same code.
- Crosscheck and the sim start in either order: a host can start a session, and a pilot can enter a code, before the sim runs, and Crosscheck attaches to the sim whenever it starts.

**Not in v1:**

- Invite links, because Discord shows a `crosscheck://` link as plain text and an https redirect adds two prompts ([One-click invite](ideas.md#one-click-invite)).
- Permanent codes, left out on 2026-10-04 ([Ideas left out](ideas.md#ideas-left-out)).
- Reading the clipboard at any other moment.
- Host approval of each joiner.

**Rules:**

- The code admits a pilot with no approval from the host, as it does in fsc-editor, where the relay limits how fast one address can guess codes and the host sees how many peers are connected (read in fsc-editor, `docs/remote-connect.md`, "The code").
  It's a game among friends, and confirming each joiner would get in the way.
- Every pilot sees who's in the crew.

**Depends on:**

- [The connection](#the-connection), which carries the code to the session.

**Open questions:**

- Whether the EFB app can fill its box from the clipboard: the EFB runs inside the sim's panel, so Crosscheck's own app would read the clipboard when the EFB's box is selected (unverified).
- Whether the Crosscheck IDE joins through the same session and code, making the Crosscheck session the editing session too, or the session points the IDE at a server of its own; either way has consequences for the relay and the protocol, settled later.

### The connection

The connection carries everything between the crew's machines, directly when it can and through our relay when it can't.

**In v1:**

- Machines connect directly when they can, and through our relay when they can't, as [01-aims](01-aims.md#relay-and-license) sets out.
- Pilots can see which kind of connection they have, such as direct or relayed, in a design for later.
- Every pilot sees the whole crew.

**Not in v1:**

- Pausing the flight when a pilot drops out, which wouldn't rescue a pilot whose sim restarted and doesn't suit flights on online networks such as VATSIM ([Ideas left out](ideas.md#ideas-left-out)).
- Finding a second PC on the home network without a code, a Later pick.

**Rules:**

- No pilot owns the session.
  The flying machine is its authority at every moment, and authority moves with control, so when the PF leaves, it passes to the PM along with control.
- The session lives as long as any pilot is in it, and its code stays the same throughout.
- Every change applies exactly once, whichever path carried it.
- When the cheapest relay and the best one for flight data differ, flight data wins.
- A short gap in the flying machine's data holds the following aircraft still, and it jumps to the flying machine's position when data returns, which is acceptable for v1.
- When a pilot loses the connection, the others fly on without pausing.
  The cut-off pilot's synced displays lock, and the [notification banner](#notification-banner) tells them they've lost the connection, while Crosscheck offers to keep trying or to disconnect and take control of their own aircraft.
- After 5 minutes cut off, the session ends for that pilot.
  Our FS Copilot fork waits the same 5 minutes, which its notes call "long enough for a router reboot or a sim reload" (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, `DegradedTimeout`, and `record/pointer-forwarding/docs/13-pr-prep.md`).
- Recovery is the app's job, and each part of Crosscheck recovers its own state within it.
  The app tells whether a returning pilot's sim kept running or restarted, from session state it saves on the pilot's machine with an identifier for the sim's run.
  If the sim kept running, Crosscheck reconnects the pilot with no action from them, from that saved state, and replays what they missed in the order it happened ([catch-up](../sync/03-catch-up.md#replaying-a-short-outage)).
  If the sim restarted, Crosscheck rejoins the pilot once they're in a flight again, with the code it remembers, as a [late joiner](#preflight): flight-model sync puts them back in the aircraft's place, their cockpit catches up on every control the profile can read or track, and Crosscheck tells them that their displays' pages, their FMS, and anything else the profile can't read may differ from the PF's.
- A pilot who leaves the flight but not the session, by going to the sim's main menu or loading another flight, drops out of flying as a pilot who loses the connection does: control passes to the PM if they were the PF, and the others get a notice.
  Once they're in a flight again, Crosscheck rejoins them as a late joiner.
- A pilot leaves the session with Leave session, in the [EFB app](#efb-app) or the desktop app.

**Depends on:**

- The [take-control key](#take-control-key), for which machine is flying.
- The [invite code](#invite-code), for who joins.

**Open questions:**

- Whether a cut-off pilot's switches can be blocked as well as their displays, which needs input blocking such as the masking that [soft takeover](ideas.md#soft-takeover-on-handover), a Soon pick, uses.
- How to soften a short gap, for the architecture to weigh: carry the aircraft on its last velocities for about a second and then ease it to the true position when data returns, have each packet carry the last few samples so one lost packet costs nothing, and send a copy through the relay only while the direct link is losing packets or switching paths.

### Preflight

From the moment a joined pilot is in a flight until the crew starts flying, every aircraft in the crew holds still at the PF's position, and the crew starts together once everyone is ready.

**In v1:**

- Joining and flying are two steps.
  Joining admits a pilot to the session once Crosscheck's own checks pass, such as compatible Crosscheck versions, which [installing and updating](#installing-and-updating) scopes.
- Once a pilot has joined, and until they're in a flight, they see where the PF is, such as "James is at EGLL stand X12".
  If the step 6 probe finds a way to set the world map from outside the sim, a Go to button points the world map at that spot and selects the stand.
- Each pilot loads their flight at the PF's stand, because moving an aircraft across the world makes the sim load new scenery there, which can stall it or fill its video memory (unverified; a probe that moves a parked aircraft to an airport on another continent settles it).
- When a joined pilot is in a flight, Crosscheck puts their aircraft at the PF's position, and from then until preflight ends, every aircraft in the crew, the PF's included, holds its position, altitude, and attitude, so the crew is in one aircraft from the start.
- Each pilot works through the [preflight match check](#preflight-match-check)'s list and clicks Ready.
- When every pilot counted is ready, a 3s countdown runs, and when it ends, preflight ends: the aircraft is free to move, and the rest of sync starts.
- When preflight ends, every other pilot's cockpit catches up to the PF's, as [state sync](#state-sync) scopes.
- The PF works through a checklist of the controls Crosscheck tracks by counting their events, because no variable shows their value, and confirms each is where the aircraft starts it, such as a hypothetical "FCU speed 80" on an Airbus.
  Crosscheck counts from that value, so a wrong start on the PF's aircraft reaches every other cockpit ([01-profile-entries](../sync/01-profile-entries.md#keeping-a-shadow-value)).
  Whether the 58P's profile has any such controls, and so whether v1's checklist has anything on it, is unknown until the profile is written.

**Not in v1:**

- Warning a pilot who spawned far from the PF before Crosscheck moves them to the PF's position, which risks the scenery load above.
- Loading a pilot's flight at the PF's stand for them: the pilot loads it from the world map, and Crosscheck moves their aircraft only once they're in it.

**Rules:**

- A pilot's Ready is unavailable until their aircraft has settled after loading ([catch-up](../sync/03-catch-up.md#settling-after-a-load)).
- Pilots other than the PF touch nothing in the cockpit during preflight, because catch-up sets only what the profile holds: a PM who switches a display to another page during preflight keeps that page after the PF's state arrives.
  The PF touches nothing beyond the checklist.
- Un-readying during the countdown cancels it, and the flight doesn't start until every pilot counted is ready again.
- During preflight, a ready pilot un-readies before Leave session is available to them, so leaving cancels a running countdown, and a pilot who has left no longer counts.
- A pilot who drops out during preflight becomes unready and still counts, so by default the crew waits for them.
  Any pilot who's ready can choose Go without, such as "Go without James", which takes James out of the count.
- A pilot who drops out and comes back before preflight ends is back in preflight, unready, and clicks Ready again.
- A late joiner, who joins after preflight ended or comes back after the crew went without them, skips Ready: once they're in a flight, Crosscheck puts their aircraft at the flying machine's position, and their catch-up starts ([catch-up](../sync/03-catch-up.md#while-catch-up-runs)).

**Depends on:**

- [Flight-model sync](#flight-model-sync), which puts each joined pilot's aircraft at the PF's position and holds it there; preflight also holds the PF's own aircraft.
- [State sync](#state-sync), whose catch-up brings every cockpit to the PF's when preflight ends.
- The [preflight match check](#preflight-match-check), for the list each pilot works through.
- [The connection](#the-connection), for who drops out.

**Open questions:**

- What a joined pilot sees when the PF isn't in a flight yet, such as when the host started the session before the sim.
- Whether Crosscheck can name the stand an aircraft is on, from SimConnect directly or by matching the aircraft's position against the airport's parking spots (unverified).
- Whether anything outside the sim can point the world map at a spot, which the step 6 probe for [the PF's spot on the world map](ideas.md#the-pfs-spot-on-the-world-map) in [the plan](plan.md) answers.

### Preflight match check

During [preflight](#preflight), and when a late joiner is in a flight, Crosscheck compares what each pilot has for the shared aircraft and lists what differs.

**In v1:**

- The differences show beside each Ready button, as a list of warnings and errors in the EFB app and as counts on the [notification banner](#notification-banner)'s summary, and how they look is for a later design.
- The comparison covers the aircraft's package, version, and variant, such as the Baron's 58P against its base model, and the livery.
- The aircraft's version is also checked against the versions its profile covers.
- Each pilot's profile for the aircraft is compared by its version and a hash of its contents, so a profile someone edited by hand shows as an error.

**Not in v1:**

- Stopping a pilot from flying over a difference.
- Detecting which licensed add-on an aircraft uses, such as the Baron choosing its GPS unit by the TDS license (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), which pilots sort out themselves.

**Rules:**

- No difference stops the flight.
  An error says something will likely go wrong, and a warning says it might: a different aircraft version can be an error, and a different livery a warning.
  A developer's update that fixes textures changes the version without touching anything Crosscheck syncs, and making a pilot spend 10 minutes updating for it would only get in the way.
- An aircraft version the profile doesn't cover shows as a warning.
- A difference that breaks one feature turns that feature off for the session and shows a warning, rather than an error for the whole flight.
  For example, once avatar sync exists, if only one pilot's copy of an aircraft has a model it needs, avatar sync stays off.
- The check runs again whenever either pilot's aircraft changes.

**Depends on:**

- Profiles, which say which aircraft versions they cover.
  What a feature needs follows from what the profile references, such as the display identifiers pointer sync replays into, and Crosscheck checks each machine for those itself.
- [Preflight](#preflight), whose join step admits the pilot and during which the check runs.

**Open questions:**

- What identifies a copy of an aircraft beyond its version string, since two pilots can run the iniBuilds L-1011's "1.0.8" from different stores with different files (read in inibuilds-aircraft-l1011 1.0.8, [L-1011 study](../aircraft/inibuilds-l1011/study.md)).
  Candidates are the folder it's installed in with its manifest's `export_type`, or a hash of its `layout.json`, which lists every file with its size and date; a streamed Marketplace copy has no `manifest.json` in its folder, and an experiment settles which works.
- Which add-ons can be compared without work for each aircraft.
  A package's manifest declares its dependencies, but optional add-ons go undeclared, as the Baron's GPS units do, so the profile could list the packages that matter.
- Whether the check compares the scenery at the departure airport, since v1 doesn't support different scenery.

## Around the aircraft

### Traffic sync

The AI traffic in one pilot's sim, usually injected by an ATC add-on such as BeyondATC, appears in every pilot's sim, out of the window and on TCAS.

**In v1:**

- A traffic host, the pilot whose sim has the traffic, in a role of its own, separate from control, as in our FS Copilot fork (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "One host, and it need not be the master").
- Aircraft and ground vehicles, GSX's tugs, fuel trucks, and catering among them, accepting that ground vehicles may show issues in v1.
- A radius as a setting, up to the SDK's 200km cap, which is the default (FS Copilot fork, same file, "Reading").
- In the [preflight match check](#preflight-match-check)'s list, the traffic sources a receiving pilot should turn off, the traffic packs that differ from the host's, and a warning when multiplayer is on, each where Crosscheck can detect it.

**Not in v1:**

- Removing another source's traffic for the pilot, because SimConnect removes only the AI objects its own client created ([SimConnect_AIRemoveObject](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/SimConnect_AIRemoveObject.htm)).

**Rules:**

- A receiving pilot runs the same traffic packs as the host and no others, and the same scenery.
  With other packs, aircraft go missing or fall back to generic models, and a frozen object isn't clamped to the ground, so with other scenery it floats or sinks (FS Copilot fork, same file, "Model matching"; measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Baseline: BeyondATC's own traffic scores 0.56").
  Two groups of FS Copilot testers missed this and flew with airliners missing (from our experience with FS Copilot), which is why the [preflight match check](#preflight-match-check)'s list names packs one by one.
- The copies move smoothly.
  Frozen and written every frame from samples at 2Hz, our fork's copies scored 0.17 median jitter against 0.56 for BeyondATC's own traffic, on one PC (measured on MSFS 2024, 2026-09-06, same log, "Jitter measured, not eyeballed"), and ran well between two machines (from our experience with FS Copilot).
  BeyondATC has since released an update for smoother AI traffic, which we haven't compared (reported by the user, 2026-10-03).
- When the traffic host changes, the new host removes the traffic it had injected before it starts, and the old host stops sending (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "One host, and it need not be the master").
- A pilot who starts a pushback, from GSX, an ATC add-on such as BeyondATC, or the sim's own `K:TOGGLE_PUSHBACK`, takes control first and flies it.
  A pushback in a following machine's sim acts on an aircraft frozen to the flying machine's, so we expect it to move nothing (unverified).
  The tug shows to the rest of the crew only when that pilot is also the traffic host, and only if traffic sync carries it: our fork listed and spawned GSX's tugs in a replay of a recorded session on one sim, though nobody judged how they look when driven (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · First visual replay; engines, pushback, ground vehicles", and `record/traffic-atc/docs/02-open-questions.md`, Q07).
  [Ground operations sync](ideas.md#ground-operations-sync), a Soon pick, replaces this rule.

**Depends on:**

- The [preflight match check](#preflight-match-check)'s list.
- [The connection](#the-connection).

**Open questions:**

- Whether Crosscheck can tell that a pushback started in a following machine's sim, such as from `A:PUSHBACK STATE` on its frozen aircraft, so the [notification banner](#notification-banner) can tell that pilot to take control first (unverified).
- Whether traffic sync carries the sim's own pushback tug, which BeyondATC's pushback may use (reported by the user, 2026-10-04, unverified).
- Whether the traffic host is chosen by hand or taken automatically by whoever has traffic, perhaps as a setting with a default yet to pick.
- How Crosscheck detects installed traffic packs, running injectors, and multiplayer: the installed packages and the running processes are candidates (unverified).
- Whether Crosscheck can hide another source's traffic without removing it, such as by freezing it out of sight, which is untested and would leave ATC talking to aircraft nobody sees.
- How our copies compare with BeyondATC's updated traffic.

### Hearing ATC

The ATC app's audio on the traffic host's machine plays on every other pilot's machine, so the whole crew hears ATC.

**In v1:**

- ATC apps that run as their own program, such as BeyondATC, captured by process and found by program name or picked from a list of programs playing audio, as our FS Copilot fork does (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Capturing" and "Choosing the ATC app").
- Crosscheck plays the audio on the output device each pilot picks, with no window needed, so a pilot in VR hears it too.
  Crosscheck's own sounds, such as the handover cues, play on the same device.

**Not in v1:**

- The sim's own ATC, which plays mixed with the rest of the sim's sound; pilots who share ATC turn it off.
- The receiving pilot's COM volume or tuned frequency shaping the audio, which BeyondATC already does.
- The host pilot's own transmissions, which the crew hears on Discord.

**Rules:**

- The traffic host is also the ATC host.
- Turning the ATC app down in the host's Windows mixer doesn't turn it down for the crew.
  Windows applies the mixer level before the capture, so the host divides it back out, up to +20dB, as our fork's did (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Stage 3: the audio path works on one machine").
- ATC reaches the crew about 130ms after the app plays it, plus the network delay, well inside the 300ms at which a readback on Discord would overtake the call (same entry).
- Crosscheck picks up an ATC app started after it, and attaches again when the app restarts (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Choosing the ATC app").

**Depends on:**

- The traffic host role in [traffic sync](#traffic-sync).
- [The connection](#the-connection).

**Open questions:**

- Whether capture works on Windows 10, which our fork never tested.
- Which ATC apps besides BeyondATC capture cleanly, since only BeyondATC was tried live.
- An ATC app that injects no traffic, on one pilot's machine, alongside a traffic injector on another's would want two hosts; v1 treats that as too rare to support.
- Whether Crosscheck follows Windows' default output device when a pilot switches headsets mid-session.

### Time, date, sim rate, and pause

The crew's sims share one clock: the same time of day, date, and simulation rate, and an active pause that holds for everyone.

**In v1:**

- When any pilot turns active pause on or off, every machine follows.
- The PF's time of day, date, and simulation rate reach every machine when [preflight](#preflight) ends, when a late joiner is in a flight, and whenever the PF changes them.
  Crosscheck puts back any change another pilot makes to one of them.
- When the PF opens the sim's pause menu, the [notification banner](#notification-banner) tells the rest of the crew, such as "James is in the pause menu", so a frozen aircraft has a reason.

**Not in v1:**

- Syncing the pause menu itself.
  It raises the sim pause, which stops that pilot's aircraft and leaves the sim's clock running (measured on MSFS 2024, 2026-10-03, [environment log](../environment/log.md#2026-10-03-the-pause-menu-is-the-sim-pause-and-lets-the-clock-run-active-pause-stops-it-and-only-simconnect-raised-a-full-pause)), so the PF's following machines stop with the PF's aircraft and no clock drifts.
- Weather, a Later pick.

**Rules:**

- Active pause is the pause that syncs, because it stops the sim's clock, and one machine in active pause alone would drift behind the others (same entry).
- The simulation rate moves in steps, since `K:SIM_RATE_INCR` and `K:SIM_RATE_DECR` work and `K:SIM_RATE_SET` does nothing (measured on MSFS 2024, 2026-10-03, [environment log](../environment/log.md#2026-10-03-the-rate-steps-and-the-time-events-work-from-simconnect-and-ksim_rate_set-doesnt)).
- The time and date events hold on this build, and `K:ZULU_DAY_SET` takes a day of the year (same date, [environment log](../environment/log.md#2026-10-03-kzulu_day_set-takes-a-day-of-the-year-and-the-date-events-hold)).

**Depends on:**

- The [take-control key](#take-control-key), for which pilot is the PF.
- [Flight-model sync](#flight-model-sync), which stops the following aircraft when the PF's aircraft stops.

**Open questions:**

- What happens when an add-on puts one machine into a full pause: no pilot action raised one, but `K:PAUSE_SET` from SimConnect did, and SimConnect then sent no frame data until it cleared (measured, same date, [environment log](../environment/log.md#2026-10-03-the-pause-menu-is-the-sim-pause-and-lets-the-clock-run-active-pause-stops-it-and-only-simconnect-raised-a-full-pause)).
- Whether a frozen follower keeps up at a raised simulation rate, which a replay at 4x would show.
- Whether the pause menu stops a flying aircraft, which our parked run couldn't show.

## Presence

### Avatar sync

Each pilot sees the other pilot as a figure of Crosscheck's own, in their seat, looking where they look, reaching for what they change, and on foot beside them on the walkaround.

**In v1:**

- The figure is a few plain shapes that carry meaning by how they move, as the idea [Avatar sync](ideas.md#avatar-sync) describes, posed from variables of its own (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-our-own-figure-poses-in-the-sim-from-its-variables-plays-between-frames-smoothly-and-changes-color-through-asobo_property_animation)).
- Seated, the figure's body sits on its seat as the profile tunes it, and its head goes where the pilot's camera is and turns where they look, so a lean shows, with the neck stretching to cover the difference.
  `SimConnect_CameraGet` gives the camera's position and look, a head tracker's rotation included (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-includes-a-tobii-head-trackers-rotation-and-its-position-is-in-meters)).
- The hands follow [the avatars' tentative decisions](../avatars/decisions.md): a hand goes where the pilot clicks or drags, found from the aircraft's own model, and the yoke hands follow a pilot's habits in either seat.
- A hand also reaches for a change made without a click, such as a home cockpit's switch or a key binding, at the control's spot, which the profile holds.
  A click tool records the spots: it walks the profile's entries, and the author clicks each control.
  That reverses the tentative decision that only a click brings the hand.
- On foot, the figure walks, runs, crouches, and idles as the pilot's avatar does, from the avatar's position, facing, ground speed, and `A:IS CROUCH`, which SimConnect reads every frame (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame); `A:IS CROUCH` switched between 0 and 1 while the pilot crouched, in [p01's results](../../../experiments/areas/avatars/results/p01-avatar-2026-10-02-21-05-51.txt)).
- On foot, for a click within 2m to 3m, the arm extends to touch the spot, and for one farther, it extends to a maximum arm length and points at it.
  The pilot clicked from a median 1.8m to 2.6m and up to 5.8m away (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
- A pilot sees their own figure in an outside view too, on by default with a setting to turn it off, its hands see-through or left out.
  To hide the sim's own avatar there, Crosscheck ships an avatar with nothing to show, which the pilot picks, as the [No Avatar](https://flightsim.to/addon/59715/no-aavatar) add-on does.
- When a pilot's connection drops, their figure slumps in its seat and turns gray, and when they leave the session, it disappears.
- When a pilot switches to an outside view, their figure stays seated, facing forward.
- A pilot whose camera moves around inside the aircraft, in no seat, shows as a head floating at their camera.
- A WASM module places each figure inside the sim's frame, turned by the aircraft's attitude and led by up to a frame, which held our figure in the 58P's right seat at up to 185 kt GS (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  Crosscheck edits no other developer's package to hold it there.

**Not in v1:**

- Moving a pilot's camera to a seat for them, left out on 2026-10-04 ([Ideas left out](ideas.md#ideas-left-out)): pilots set up their own views, with the sim's camera or ChasePlane.
- Hands for a pilot in VR, whose clicks give no cursor place for the ray (unverified); their figure still sits and looks.
- Sidesticks and center sticks, since the hand rules are for a yoke, and the 58P has yokes.
- Passengers, a Later pick in [the plan](plan.md).
- Instructions for picking Crosscheck's empty avatar, which come after v1, perhaps in Crosscheck's settings.

**Rules:**

- The profile holds every seat the aircraft has: its name, the figure's pose on the cushion, and the eye point.
  The authoring tool seeds a seat from the seat objects SimConnect lists, then from the cockpit model's `PILOT_` nodes, then from a click on the cushion, and the author tunes it ([Seat awareness](ideas.md#seat-awareness)).
  The 58P lists a seat object only for the pilot's seat, so its right seat starts from its model's `PILOT_1` node (measured on MSFS 2024, 2026-10-03, [aircraft log](../aircraft/log.md#2026-10-03-the-baron-58p-lists-only-its-pilots-seat-because-the-seat-objects-are-the-seats-in-each-aircrafts-navigation-graph)).
- Each pilot moves to a seat themselves, with their own camera.
- Crosscheck tells which seat a pilot is in from their camera's position: a pilot takes a free seat when their camera comes within a take radius of its eye point, and leaves it when the camera moves past a wider leave radius, such as on a walkaround or a trip down the cabin.
  The leave radius keeps a pilot in their seat when they lean toward a side window or the panel, and a profile can set its own radii for an aircraft where the defaults misjudge a seat.
- A pilot holds one seat, so taking a free seat leaves the one they held.
- Nobody takes a seat another pilot holds, and a pilot whose camera is in one sees that pilot's figure there.
  Two pilots swap seats by one leaving theirs first, down the cabin or, in a two-seater, out to the tail and back.

**Depends on:**

- Profiles, for the seats and the control spots.
- [The connection](#the-connection), which carries each pilot's camera, clicks, and avatar.

**Open questions:**

- How Crosscheck's empty avatar is built, and whether the pilot picks it in the sim's own avatar screen or Crosscheck can select it (unverified).
- How long the arm reaches before it points.
- The default radii for taking and leaving a seat, which trying them in two or three cockpits settles.
- Whether a dropped pilot's figure can turn see-through, through the material animation that colors it (unverified).
- What makes some part of the figure miss a frame now and then in flight, which our test pilot saw in the 58P ([avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
- Whether the figure's joints follow variables of its own object, so one sim can draw several figures, which v1 needs, since each sim draws the other pilot's figure and, in an outside view, the pilot's own.
  p17's sphere took its size and color from variables of its own object (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-a-model-of-our-own-compiles-from-generated-gltf-and-its-size-and-color-follow-variables-of-its-own-object)), and a step 6 probe in [the plan](plan.md) settles the joints and what many figures cost.

## Interface

### EFB app

A small app on the sim's EFB holds what a pilot needs during a flight, so a pilot in VR can use Crosscheck without taking the headset off.

**In v1:**

- An app of its own, built on the sim's EFB framework, not the desktop app reused.
  Shipping EFB apps are written that way: A2A's tablet is TSX bundled by esbuild on Asobo's EFB API and the MSFS Avionics Framework, and it registers with `Efb.use` (read in a2a-aircraft-aerostar600 1.0.6, `A2ATabletApp.js`).
- What a pilot needs during a flight: the take-control button, the crew and the connection's state, the Ready button beside the match check's warnings and errors, Go without for each pilot who drops out during [preflight](#preflight), the box for an invite code, Leave session, and a button that marks the moment for a bug report, which the pilot uploads later from the desktop app.
- Opening onto what a notice on the [notification banner](#notification-banner) is about when the pilot clicks the notice anywhere but on its action, whether the EFB was open on another app or closed.
  With GSX standing in for our app, a click on a notice opened a closed EFB onto GSX, and switched an open one to it without closing it (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-a-click-on-a-notice-in-our-panel-opens-the-efb-onto-another-app-whether-the-efb-was-open-or-closed)).
- A button that brings the desktop app to the front while Crosscheck's core is running.
- How it looks is for a design later.

**Not in v1:**

- The desktop app's interface running in the EFB.
  Coherent GT rejects syntax newer tools emit and lacks APIs a desktop interface uses (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), and fitting the main app to it would hold the main app back.
- Settings, binding the take-control key, the output device, the recording mode, and the report page, which stay in the desktop app, set before the headset goes on.
- Notices, which go on the [notification banner](#notification-banner), because the EFB may be closed when one comes.

**Rules:**

- The EFB app shows the core's state and sends it commands, and decides nothing itself, so two interfaces don't mean two implementations.

**Depends on:**

- Crosscheck's core, which owns the session; a headless core with the apps as its clients is the architecture's leading candidate in [the plan](plan.md).

**Open questions:**

- Whether the EFB app can start the core when it isn't running, since a panel may not be allowed to start a program.
- Whether the EFB can fill its code box from the clipboard, as the [invite code](#invite-code) section asks.
- Whether a click on a notice opens our app when it's off the EFB's dock and the first page of its app list, and whether our app's code runs while the EFB is closed, which a step 6 probe in [the plan](plan.md) answers.

### Notification banner

Crosscheck's notices slide in at the right of the screen, on a see-through in-game panel, the kind of window the sim's toolbar opens, so the pilot sees them whether or not the EFB is open.
A notice can carry one action of its own, such as Ready on the preflight summary, and a click anywhere else on it opens the [EFB app](#efb-app) at what the notice is about.

**In v1:**

- The banner, in VR as on a monitor, for notices such as "James is in the pause menu", "You've lost the connection", and "You have control".
- A notice when a synced control never matches after Crosscheck's retries, once per control per flight, such as "Couldn't sync the beacon. After your flight, send a bug report from the desktop app." ([live sync](../sync/02-live-sync.md#checking-that-a-write-landed)).
- While a pilot's cockpit catches up, a "Catching up..." notice saying that switches they move now will be reset ([catch-up](../sync/03-catch-up.md#while-catch-up-runs)).
- During [preflight](#preflight), a summary of who has joined, who's ready, and how many warnings and errors the [preflight match check](#preflight-match-check) found, with a Ready button, and for pilots other than the PF, a line telling them to touch nothing in the cockpit.
- Crosscheck opening the banner's panel itself when a flight loads, with no click from the pilot.

**Not in v1:**

- The rest of Crosscheck's controls, which live in the EFB app.
- A banner that floats in front of the pilot's view on an object of ours, like a pair of AR glasses: its text smeared while the view moved, and parts of the cockpit sometimes cut into it (judged by the pilot in MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-a-banner-drawn-on-an-object-of-ours-smears-in-motion-and-is-clipped-behind-the-cockpit-so-we-parked-it-for-an-in-game-panel)).
- Crosscheck's other objects in the cockpit, such as a take-control button stuck to a window, a Later pick.

**Rules:**

- The banner shows during preflight, and after that only when something needs the pilot's attention, such as a lost connection, a PF who dropped out, or control passing to them.
- Between notices the panel draws nothing, because the sim blurs whatever lies behind the pixels a panel paints (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).
- A notice that asks the pilot to act says where: on the notice, in the EFB app, or in the desktop app.

**Depends on:**

- A script that Crosscheck's toolbar icon puts into the sim's toolbar, which opened the banner's panel with no click after two of three Build and Mounts (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).
  It's Parallel 42's trick, not a sim feature: the toolbar runs markup it finds in an icon, and an update could stop that.
- The [EFB app](#efb-app), which a click on a notice opens.

**Open questions:**

- Whether the toolbar script opens the panel at every flight load: we've seen it run only after a Build and Mount, and it left the panel closed after the first of three, for a reason we don't know (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).
  A script that retries until the toolbar lists the panel as open is built and hasn't run.
- How long a notice stays, and how notices come and go.
- Which further notices v1 needs, such as connection trouble short of a drop.
- How the banner looks and reads in VR, which nobody has tried, since our development machine has no headset.
  ChasePlane closes its own full-screen overlay when the toolbar's `globalVars.vrMode` is set (read in p42-util-chaseplane 2026.39.1.16, `HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE_OVERLAY.svg`), which suggests a panel like ours may not work in VR (unverified).
- Whether clicks on the panel's empty part reach the cockpit beneath it, which nobody has tried.
  If they don't, the full-height column blocks that part of the cockpit for the whole flight, and reporting only the notice's rectangle with `UPDATE_PANEL_RECT` might let them through (unverified, [interface log](../interface/log.md#2026-10-04-an-in-game-panels-size-is-a-percent-of-the-screens-height-capped-at-150-of-it-so-ours-cant-span-a-wide-screen-though-parallel-42s-panels-do)).
- How to keep the panel on the right when Crosscheck opens it: opened from code, it sat at the left of the screen (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).

## Tools

### Recording and bug reports

Every pilot's machine records its side of the session, and a bug report gathers the crew's recordings, so we can see the session as if we'd been there.

**In v1:**

- Every crew member's machine records what passes through Crosscheck: each synced change, each handover, and the connection's events.
- The recording also keeps the flight model's samples, and every value each [plugin](#plugins) exported and every write method Crosscheck called on it, so a test can replay a recorded flight against the plugin's profile entries ([04-room-for-later](04-room-for-later.md#recording)).
- The recording keeps each watch-only profile entry whose value differs between machines, with both values ([live sync](../sync/02-live-sync.md#values-not-events)).
- Crosscheck marks the recording itself when a synced control never matches after its retries, with the control, both machines' values, and the retries, the same kind of marker as the [EFB app](#efb-app)'s button that marks the moment ([live sync](../sync/02-live-sync.md#checking-that-a-write-landed)).
- Each machine keeps at least the whole flight, and more flights if recordings turn out small enough.
- A bug report brings together every crew member's recording, with everything else that helps us see the session as if we'd been there, such as the logs, the versions of Crosscheck, the sim, and the aircraft, the profile, and the connection's statistics.
- Each pilot uploads their own part to a server of ours, labeled with the session's ID, and the parts meet there, so a report works after the crew has gone: if something goes wrong on landing and everyone goes to bed, there's no live session the next morning.
- A report page lists the pilot's recorded sessions so each is easy to recognize, by date and time, aircraft, departure airport, and crew, and offers to upload one.
- On our end, a report shows as one session with who has uploaded and who's missing, such as "uploaded: James, Adam; missing: Greg".
- A setting chooses full or minimal recording, and says that a minimal recording limits how far we can help.

**Not in v1:**

- The debrief timeline that plays a flight back, a Later pick in [the plan](plan.md).

**Rules:**

- Home-folder paths and Windows usernames are scrubbed from everything in a report, and pilots' display names stay.
  A screenshot taken during our avatar work showed both a home folder's path and a person's name ([avatars log](../avatars/log.md#2026-10-03-a-probe-can-screenshot-the-sim-window-and-a-screenshot-can-show-a-home-folders-path-and-a-persons-name)).

**Depends on:**

- [The connection](#the-connection), for the session's ID that labels every part.

**Open questions:**

- How a missing pilot is asked for their part: their Crosscheck could offer the upload the next time it starts, once the server holds a report for a session they were in.
- What form the session's ID takes: every machine shares it, and it can't be the code, since a later session can draw the same six characters; the architecture decides it.
- How long the server keeps reports, and how it limits junk uploads with no accounts, as fsc-editor's relay limits how fast one address can guess codes.
- What the server runs on, which the architecture decides: a Cloudflare Worker is the candidate, with D1 for the reports and R2 for the recordings, since D1 caps a row at 2MB and a free database at 500MB ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- How big a flight's recording is, which decides how many flights each machine keeps.
- What a minimal recording leaves out.

## Getting Crosscheck

### Installing and updating

One installer puts Crosscheck's app and its package in the sim's Community folder on a pilot's PC, and updates keep both current without catching the pilot mid-flight.

**In v1:**

- One installer, for the app and the Community package together.
  It finds the Community folder as fsc-editor does, from the `InstalledPackagesPath` line in `UserCfg.opt`, which the Steam and Microsoft Store installs keep in different places, and it asks the pilot only if it can't find one ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
- Updates download silently, and Crosscheck checks for one each time it starts, before the pilot is likely to have the sim running.
- The app and the package update together, as one version, and only while the sim is closed, because the sim loads a package only at boot ([02-01](../../learn/foundations/02-01-installs-and-packages.md)) and an app ahead of its loaded package would have to cope with every pairing.
- An "install when the sim is closed" option: if Crosscheck is open when the sim exits, it updates itself then, and if it was closed first, a helper does it.
- A helper that the sim launches warns, in a Windows notification early in the sim's load, that a waiting update will need a sim restart, so the pilot can close the sim before waiting for it to load.
  It warns only a pilot who has flown with Crosscheck lately, judged by the date of their last session, and stays quiet for one who hasn't used it in a while.
- At launch, before anything else, Crosscheck names any Community package that overrides `VCockpit.js`, such as FS Copilot's or YourControls', and offers to disable it, since only one override can win the mount order and a losing Crosscheck quietly breaks pointer sync ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
  If the sim is running, disabling it takes a sim restart, and Crosscheck says so.

**Not in v1:**

- Code signing, so the installer meets Windows SmartScreen's warning about an unknown publisher; the signing fsc-editor priced was about $10 a month, and flight sim pilots are used to tools that ask more of them (fsc-editor, `docs/pipeline/09-open-questions.md`, "Code signing").
- A beta channel, since all of v1 is a beta.
- Pilots on different Crosscheck versions flying together.

**Rules:**

- Pilots on different versions can't join each other's session, and the join check says who is behind and what to do, such as "Adam has a newer Crosscheck; close the sim to update".
- Disabling another package is reversible from Crosscheck's settings, and puts the package back exactly as it was.

**Depends on:**

- [Preflight](#preflight)'s join step, which runs the version check before it admits a pilot.

**Open questions:**

- Where the Microsoft Store install keeps `exe.xml` (unverified).
  The sim launches programs from it in MSFS 2024: on a Steam install it's `%APPDATA%\Microsoft Flight Simulator 2024\EXE.xml`, nine add-ons launch from ours, among them Fenix, GSX's Couatl, and ChasePlane, and ChasePlane's bridge started 79s and 102s after two sim starts (read and observed on our development machine, 2026-10-04).
  ChasePlane also launches its manager from there with `--silent-update-latest`, so it updates itself at sim launch, though our updates wait for the sim to close.
- How a package is disabled and re-enabled: a folder renamed with a suffix such as `.off` may not stop the sim mounting it, and moving it out of the Community folder does (unverified either way), which a probe across one sim restart settles.
- How recent a last session has to be for the helper to warn.
