# Product: v1 scope

```text
Purpose:     What each v1 feature does, where v1 stops, and the rules for its behavior.
Depends on:  01-aims.md, 02-users.md, and the v1 picks in plan.md
Decides:     The scope of every v1 feature.
```

> **Note**
> Stage 11b's tentative decision that [Dual Input's one full window is its EFB app](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app) changes several sections until the apps' design confirms it (user, 2026-10-25):
>
> - [The EFB app](#efb-app) holds every screen a pilot uses Dual Input through, the report page and the recordings list among them, built on the kit our pages in the sim draw with, so its "Not in v1" no longer holds, and it has no button that brings the desktop app to the front.
> - What this document puts in the desktop app, such as Leave session, the recordings list, take-control's binding, and where a notification sends the pilot to act, is the EFB app's, and the desktop app's window shows only [its own screens](../interface/decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest), whose figures are the tray app's alone, with no core's (user, 2026-11-03).
> - [Preflight](#preflight)'s Go to is offered from Free flight's world map, where the EFB opens, rather than also from the main menu's home page.
> - [Installing and updating](#installing-and-updating) may let the pilot start an update from the EFB app, which restarts the sim; how the EFB app learns the update's state is the user's to settle.

> **Note**
> Stage 11b's tentative decision that [Join takes a joiner from the world map into the PF's flight, or only sets it up](../interface/decisions.md#join-takes-a-joiner-from-the-world-map-into-the-pfs-flight-or-only-sets-it-up) widens [preflight](#preflight)'s Go to until the apps' design confirms it (user, 2026-10-29).
> From the world map it also sets the PF's aircraft and livery, and a press offers two answers: Set up only stops there, and Join now also starts the flight and presses Ready to fly.
> So loading a pilot's flight for them, which preflight's "Not in v1" leaves out, is in v1 from the world map.
> The Go to button is also unavailable, and says why, while the joiner lacks the PF's aircraft.

> **Note**
> Stage 11b's tentative decision that [traffic and ATC audio are shared apart](../interface/decisions.md#traffic-and-atc-audio-are-shared-apart-each-by-a-switch-of-its-own) changes [traffic sync](#traffic-sync) and [hearing ATC](#hearing-atc) until the apps' design confirms it (user, 2026-10-31).
> Each has a host of its own, taken by a switch of its own, "Share my traffic" or "Share my ATC", in place of one "Share my traffic and ATC" switch, and the rule that the traffic host is also the ATC host no longer holds.

> **Note**
> Stage 11b's tentative decision that [the Traffic and ATC audio tabs hold their sharing, settings, and warnings](../interface/decisions.md#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon) changes [traffic sync](#traffic-sync) until the apps' design confirms it (user, 2026-10-31): a receiving machine's two notifications become counts kept live on its Traffic tab, flagged by a dot on the tab's icon, and the page of traffic packs is part of that tab.

> **Note**
> Stage 11b's tentative decision that [traffic polls within the sim's 200km cap, with no radius setting](../interface/decisions.md#traffic-polls-within-the-sims-200km-cap-with-no-radius-setting) takes out [traffic sync](#traffic-sync)'s radius setting until the apps' design confirms it (user, 2026-10-31), since the traffic generators keep their aircraft near the pilot and the airport's own aircraft stay at any radius.

> **Note**
> Stage 11b's other tentative decisions change this document until the apps' design confirms them (user, 2026-10-25 to 2026-11-01):
>
> - [Take-control key](#take-control-key)'s long press holds 0.35s, the button's hold ([take control](../interface/decisions.md#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s)).
> - [The notification banner](#notification-banner)'s place, box, and dismissal are [the banner's box](../interface/decisions.md#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right), its content is [the banner's content](../interface/decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on), and this document's example lines give way to the words in the frames: "Couldn't sync Beacon", with no ask for a bug report, and a crash's "They're still in the session."
> - [The EFB app](#efb-app) has no button that marks the moment ([mark the moment](../interface/decisions.md#mark-the-moment-leaves-the-efb-app)).
> - [Avatar sync](#avatar-sync) has four switches for which figures show, and its banner says "This seat is taken" rather than naming the free seat ([the Figures tab](../interface/decisions.md#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do)).
> - [The recording rule](#recording-and-bug-reports) has the log replace the home folder's path alone, not the Windows username ([the core's log](../interface/decisions.md#the-cores-log-keeps-display-names-and-replaces-only-the-home-folders-path)).

This document walks one v1 session from start to finish, then scopes each feature [the plan](plan.md) puts in v1, one section per feature, in the order step 4 gives.
Each feature's section says what the feature does, the cases v1 covers and leaves out, the rules for its behavior, what it depends on, and its open questions.
It says what Dual Input does, not how: mechanisms are for the sync design in `record/areas/sync/` and the architecture, step 7, and screens and wording for a later pass.

The pilot flying (PF) is the pilot whose yoke, rudder, toe brakes, engine levers, and trim fly the aircraft, and the pilot monitoring (PM) is the other front-seat pilot.
The flying machine is the PF's, and a following machine is any other pilot's, in v1 the PM's.
v1 sessions have two pilots, because crews beyond two are a Later pick, but v1 builds what larger crews need from it ([04-room-for-later](04-room-for-later.md#people-beyond-the-crew)), so nothing gets rebuilt when they come.

## A session from start to finish

A v1 session runs in this order, and each step's rules are in the section it links to.

1. Each pilot installs Dual Input once, with its Community package ([installing and updating](#installing-and-updating)).
2. Dual Input and the sim start in either order, and the host starts a session and shares its code, which the other pilots enter to join ([invite code](#invite-code)).
3. Each pilot loads a flight at the PF's stand, or at a runway of the PF's departure airport while the PF's engines run, which Dual Input shows them, and once they're in it, Dual Input moves their aircraft to the PF's position and holds every aircraft still for [preflight](#preflight).
4. In preflight, each pilot works through the [preflight match check](#preflight-match-check)'s list, takes a seat ([avatar sync](#avatar-sync)), and clicks Ready, and the PF also checks the profile's starting values.
5. When every pilot is ready, a countdown ends [preflight](#preflight): every other pilot's cockpit takes the PF's value for every control the profile can read or track, and the aircraft is free to move.
6. The crew flies, passing control by the [take-control key](#take-control-key), with [notifications](#notification-banner) for what needs their attention.
7. A pilot who drops out reconnects or rejoins as a late joiner, and the others fly on ([the connection](#the-connection)).
8. Each pilot leaves with Leave session, the session ends with the last, and each machine keeps its recording for a [bug report](#recording-and-bug-reports).

## Control

### Take-control key

A pilot presses take-control and becomes the PF at once, and their machine becomes the flying machine.

**In v1:**

- v1 flies the traditional way, as FS Copilot does: the following machine freezes its aircraft's position, altitude, and attitude, and takes the flying machine's values (read in the FS Copilot fork, `FsCopilot/Simulation/MasterSwitch.cs`, `FsCopilot/Simulation/Coordinator.cs`, and `FsCopilot.Bridge.Wasm/wasm_module.cpp`).
- Taking control from a button in Dual Input's app or its EFB app, a keyboard key, or a button on the pilot's flight hardware.
- The pilot binds the key or hardware button in Dual Input's settings, not the sim's, and chooses whether it takes a single press or a long press.
  A single press takes control on its down, and a long press once held 1s, before its release ([take-control](../control/01-take-control.md)).
  A bound key takes control only while a window of the sim is in front, and Dual Input's settings ask the pilot to keep the key or button unbound in the sim (user, 2026-10-17).

**Not in v1:**

- Soft takeover and masking, which are Soon picks in [the plan](plan.md).
- A button to give control away, so the PF has no way to give control in v1, and control passes only when a pilot takes it, by the take-control key or buttons.
  Giving control by voice comes with the [voice phrases](#voice-phrases), a Soon pick (user, 2026-10-17; [the plan](plan.md)).

**Rules:**

- The host is the PF when a session starts.
- Any pilot can take control at any time, and it passes at once, without the PF agreeing, with two exceptions.
  The take-control key and button work only while their pilot is in the flight, after [preflight](#preflight), and control passes only to a pilot in the flight (user, 2026-10-12; [roles and members](../session/01-roles-and-members.md#the-pf)).
  Control also can't pass to a pilot while their own catch-up or replay runs over a link that's up ([04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).
  A PF who leaves the flight passes control anyway, to an up-to-date pilot where there is one, and never to a flight engineer or a passenger, as [the connection](#the-connection) says.
  If the PM is catching up when control reaches them, their catch-up stops first.
- A press these rules refuse, such as one during the pilot's own catch-up, plays a refusal cue and shows the reason on the [notification banner](#notification-banner).
- Control is one value, a generation that every change of PF raises and the PF's pilot ID, and of two changes with the same generation, the lower pilot ID wins (user, 2026-10-11; [01-between-machines](../network/01-between-machines.md#control)).
  So two presses within one round trip of each other are settled by pilot ID, which no pilot can notice.
- The PF's yoke, rudder, toe brakes, engine levers, and trim fly the aircraft.
  The engine levers are the throttles, propellers, and mixtures.
- The PM's hardware can't change the following aircraft's flight controls, engine levers, or trim for longer than it takes the flying machine's next values to arrive, so the following aircraft's engines and gauges match the flying machine's.
  In FS Copilot a PM's throttle could spool up their own engine until the PF next moved theirs, because the flying machine sends a value only when it changes (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, and from our experience with FS Copilot).
  The PM's mouse on those controls snaps back the same way (unverified, and not worth a probe).
- Flaps and gear work from either pilot's hardware at any time.
- At a handover, each of the aircraft's levers stays where it was until the new PF moves theirs, and then jumps to where their hardware is.
  The aircraft itself doesn't jump or lose noticeable speed at a handover (from our experience with FS Copilot).
- When control passes, every pilot in the flight hears the control-passed cue, and no recorded line plays: the banner shows "You have control" to the new PF and who has control to the others (user, 2026-10-17).
- When a pilot's core loses its connection to another, the PF flies on, a PM's synced displays lock, the banner lists each pilot's connection, and any pilot can take control, a PM with a warning that names what follows (user, 2026-10-11; [01-between-machines](../network/01-between-machines.md#while-a-link-is-lost)).
  A press while the link to the PF is lost takes control at once, with no confirming step, and shows the warning after.

**Depends on:**

- Flight-model sync, which the following machine's frozen aircraft takes its position, attitude, and velocity from.
- State sync, for flaps and gear from either pilot.

**Open questions:**

- An axis that fires events while nobody moves it jumps its lever as soon as control passes.
  A dead zone set in MSFS stops that, since the axis fires no event inside one (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-inside-a-dead-zone-set-in-msfs-the-axis-fires-no-event)), and whether pilots need more than that is unknown.

### Voice phrases

The PF offers control by voice, and the PM takes it by answering within 5s.
The voice phrases are a Soon pick, out of v1, because a voice handover is a nice-to-have that v1 can ship without (user, 2026-10-17; [the plan](plan.md)), so this section scopes that pick.

**In the pick:**

- An offer is "You have" followed by control, controls, the controls, the flight controls, the aircraft, or the airplane, and an answer is "I have" followed by any of the same.
  Those are the endings regulators, militaries, and airlines use, with "You have …" and "I have …" the shape in every convention we found (documented: [FAA AC 61-115](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40455386&FileExtension=.PDF&FileName=FAA+AC+61_115_Positive+Exchange+of+Flight+Controls-Master.PDF), [Transport Canada TP 975](https://tc.canada.ca/sites/default/files/migrated/tp975e.pdf), [UK MAA RA 2309](https://assets.publishing.service.gov.uk/media/62454dcdd3bf7f32a7c01197/RA2309_Issue_8.pdf), [USAF AFMAN 11-248](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40445920&FileExtension=.PDF&FileName=Operations+-+Attachment+16+-+Excerpts+%E2%80%93+AFMAN+11-248+T-6+General+Flying-Master.PDF), [US Army TC 3-04.51](https://asktop.net/wp/download/5/tc3_04x51.pdf), and Airbus as quoted in [AAIB Bulletin 1/2013](https://assets.publishing.service.gov.uk/media/5423034de5274a1314000b7f/Airbus_A319-111_G-EZFV_01-13.pdf)).
- "Your controls" also offers and "my controls" also answers, for pilots who hand over casually, though we found the pair only on a blog (unverified).
- English, recognized as well as the recognizer manages with each pilot's accent.
- Dual Input listens whenever a session is syncing, with no push-to-talk key.

**Not in the pick:**

- Taking control by voice without an offer.
  Instructors do it in every convention that covers it, such as the FAA's "I have the flight controls", but the [take-control key](#take-control-key) covers it, and a misheard phrase can't move control.
- "You've got it" and "I've got it", which AOPA warns against because nobody can tell who has the aircraft ([AOPA](https://www.aopa.org/news-and-media/all-news/2023/august/08/training-and-safety-tip-ive-got-it-youve-got-it-whos-got-it)).
- "Your airplane" and "my airplane", which pilots say casually (unverified).
- Canceling an offer: it expires after 5s instead.
- Waiting for the FAA's third call, the offer repeated, which no other convention we found has.
- Languages other than English.

**Rules:**

- Dual Input hears each pilot only through their own microphone, so it always knows who spoke.
  That's what tells an offer from an answer, since the two differ only in "you" and "I".
  The microphone is a setting beside the output device, which comes with this pick: Windows' default device, which Dual Input follows when the pilot switches headsets, or a device the pilot picks ([04-core-helper](../core/04-core-helper.md#the-devices)).
- Only the PF's offer counts, and it opens a 5s window.
- The PM's answer inside the window passes control, and the endings needn't match: "You have control" answered with "I have the aircraft" passes it.
  An answer works only while its pilot is in the flight, after [preflight](#preflight), and passes no control while their own catch-up or replay runs over a link that's up, as for the [take-control key](#take-control-key).
- Every other phrase does nothing, including an answer outside a window and "I have control" from the PF.
- Both pilots hear a subtle cue when an offer opens a window, another when control passes, and a third when a window times out.
  The control-passed cue is the same one the [take-control key](#take-control-key) plays, so pilots learn one sound for it.
- A voice handover plays no recorded lines, because the pilots already hear each other say the phrases.
- Audio never leaves the pilot's machine: the recognizer runs locally and answers fast.
  It needn't be a model, but it isn't Windows' own speech recognition, which recognizes poorly (from our own use).

**Depends on:**

- The [take-control key](#take-control-key)'s rules for what control covers.

**Open questions:**

- Whether a local recognizer is accurate enough with non-native English accents, the first thing to test once it's built, when we calibrate it with our own voices ([the plan](plan.md)'s step 6).
- Whether a phrase counts inside a longer sentence.
  A UK CAA examiner says "follow me through, you have control" ([CAA Standards Document 01(H)](https://www.caa.co.uk/publication/download/13074)), and the same rule would let "you have control of the radios" open a window.
- How Dual Input tells speech from noise before it listens for a phrase.
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
- The PM sees the aircraft about 0.4s behind the PF, because a following machine places each sample through the clock offset rather than by when it arrived, so the trip uses up part of the 0.4s ([flight-model sync's design](../flight-model/01-flight-model-sync.md#drawing)).
  The 0.4s is FS Copilot's: its following machine draws the aircraft 400ms in the past (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm`).
  That's acceptable, because the PM has nothing to compare it against, and shortening it is welcome but not required.
- At a handover, the new flying machine carries on from the last state it was written, and a small step there is acceptable (from our experience with FS Copilot).
- If Dual Input stops on the following machine, the aircraft unfreezes within about 1s and nothing writes to it afterward.
  FS Copilot's module unfreezes after 1s without a write, and may keep writing its last pose into the unfrozen aircraft after that (read in the FS Copilot fork, `FsCopilot.Bridge.Wasm/wasm_module.cpp`; unverified in the sim).

**Depends on:**

- The [take-control key](#take-control-key), for which machine flies.
- The flying machine's engine levers reaching the following machine as each change, with the following machine writing the PF's last value back when the PM moves one, as the take-control key's rules require ([01-between-machines](../network/01-between-machines.md#channels)): in the replay they carried RPM, manifold pressure, and fuel flow.

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
- Dual Input checks that each write it makes lands, and when one never does, it logs it and shows a notification on the [notification banner](#notification-banner) ([live sync](../sync/02-live-sync.md#checking-that-a-write-landed); user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).

**Not in v1:**

- Telling pilots what on their aircraft doesn't sync, a Later pick in [the plan](plan.md), because we first learn what Dual Input can sync.
- Comparing whole cockpits through a flight to find ones that drifted apart, beyond checking each write, because we don't know how reliably Dual Input can read an aircraft's state, and a resync prompt interrupts the pilots ([Ideas left out](ideas.md#ideas-left-out)).
- Catching up what the profile doesn't reach, such as a display's page or an FMS's contents.
- Catching a restore that lands after Dual Input judged the aircraft settled, which moves that control in every cockpit, the PF's included ([catch-up](../sync/03-catch-up.md#settling-after-a-load)).
- The pilot's own MSFS EFB overlay.

**Rules:**

- The profile marks which of its entries belong to the PF: of the categories the [take-control key](#take-control-key) names, only the engine levers and trim, since the yoke, rudder, and toe brakes travel in the flight model's samples ([01-between-machines](../network/01-between-machines.md#channels)).
  Those reach the following machine from the flying machine.
  Everything else in the profile is shared: either pilot can change it, and the other cockpit follows.
- When both pilots change the same shared entry at nearly the same moment, both machines end on the same value: the later change when one pilot saw the other's, and the PF's when neither did ([live sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)).
- Dual Input sends every change a pilot makes, and never a change it applied itself.
  The PM turns the beacon on, Dual Input sets it on the PF's machine, and the PF's sim reports that the beacon changed: Dual Input doesn't send that report back.
  If the PF turns the beacon off half a second later, that change goes through, where a guard that ignores reports for a while after each write would drop it, as one dropped two real pilot inputs in our FS Copilot work ([08-02](../../learn/foundations/08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)).
- A change the aircraft makes on its own syncs like a pilot's, such as the Baron taking its chocks away once it moves (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-the-barons-ground-contact-follows-the-written-altitude-and-its-own-physics-writes-dont-hold-against-ours)).
- Until an aircraft has settled after a load, the changes it makes to itself don't sync: in preflight, Ready waits for it, and while a cockpit catches up, Dual Input moves those changes back to the PF's state ([catch-up](../sync/03-catch-up.md#settling-after-a-load)).

**Depends on:**

- Profiles, which name what syncs, how each entry is set, and which entries belong to the PF ([profile entries](../sync/01-profile-entries.md)).
- The [take-control key](#take-control-key), for which machine is flying.

### Pointer sync

A press or drag on a panel display travels to the other machine as the position the pointer went to, and the receiving display decides what's there, which reaches displays whose state Dual Input can't read or write.

**In v1:**

- Presses, long presses, and drags on the HTML displays the aircraft's profile names, each long press played for as long as it's held (user, 2026-10-17).
- The panel side of our FS Copilot fork's pointer sync, carried over: its capture, hit-testing, overlay, and lock (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`).
  The fork's app-side history, acknowledgments, and resends, and the panel's own pacing, give way to the cockpit stream's, whose core alone paces presses ([04-order-and-recovery](../sync/04-order-and-recovery.md#the-replay)).
- A gesture goes to the crew as it happens, its down, its moves, and its up, so the other display moves with the pilot's hand ([a gesture](../pointer-sync/01-pointer-sync.md#a-gesture)).

**Not in v1:**

- The scroll wheel and hover.
- Showing which pilot is working which display, such as "FO on the MCDU".
  [Avatar sync](ideas.md#avatar-sync) may show it, and if it doesn't, we'll look again later.
- Displays drawn by WASM code, which need [WASM instrument sync](ideas.md#wasm-instrument-sync), a Later pick.

**Rules:**

- A gesture replays at the same position, as a fraction of the display's size, and the receiving display decides what it hits.
  A peer's press sent that way drove the A220's ND to plan mode, and replayed drags work with a small drift in their timing (measured on MSFS 2024, 2026-09-17 and 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "A peer's press drove the real A220 ND, opted in by identifier alone" and "The drag drift candidate is real but small, and temporal not spatial").
- A replayed press does what the pilot meant only when both displays show the same page, and Dual Input can't check that they do, because a display's page is state no profile entry reads.
- During a long outage, the following pilot's synced displays lock, and taking control unlocks them (measured on a two-instance bench, 2026-09-12, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "Q12 is survivable and it is not a two-pilot special case").
  A synced display on a machine other than the PF's also locks while that machine's catch-up runs ([locks](../pointer-sync/01-pointer-sync.md#locks)).
- A press on a display while another pilot's gesture plays there flashes the display in one color, with no words, until its up (user, 2026-10-17).
- Two pilots pressing one display within one trip of each other can leave it different on the two machines, which is rare because each sees the other's figure reach for it ([known limits](../pointer-sync/01-pointer-sync.md#known-limits)).

**Depends on:**

- Profiles, which name the displays.
  A display's identifier can carry the livery, as the A220's `DisplayUnits|config=N324DU` does, so matching it is the profile format's job and comparing liveries is the [preflight match check](ideas.md#preflight-match-check)'s (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "The A220's DisplayUnits key carries the livery, and the profile names only Default").

### Plugins

A plugin is code we ship for one aircraft or one add-on.
It finds state a profile can't reach, exports it as values the profile watches, registers the write methods that set them, and reaches the rest through hooks into Dual Input, so Dual Input's own code never names a product.

**In v1:**

- No plugins, the 58P's included: plugins come with the first pick that needs code, designed afresh then (user, 2026-10-17; [plugins and the sandbox](../plugins/01-plugins.md)).
- Some of the 58P's radio settings live only in its gauges' JavaScript: the ADF's modes and timers, the KAS 297B's armed vertical speed, and the radar's range and modes (read in bksq-aircraft-baronpro 0.1.1, `KR87A.js`, `KAS297B.js`, and `bksq_wradar1.js`).
  The 58P's profile reads them through a name, `instrument()`, and writes them through the gauges' own `H:` events (user, 2026-10-17).
  The radar's range syncs only if a data field of Asobo's map holds it (user, 2026-10-18; [plugins and the sandbox](../plugins/01-plugins.md)).
- The KX 155B mirrors its knob-pulled state to `L:COM_1_KNOB_PULLED` and never reads it back (read in `KX155B.js`), so a profile can watch it, and setting it needs no write method: a `toggle` on the knob's `H:` event sets it.
  The other radios' knob-pulled states are variables their code reads back.
- The tablet's 15 saved settings need no plugin, because each mirrors an `L:` variable the profile syncs directly, such as `L:var_FrontArmrest` (read in `BlackSquareTablet.js`, `aircraftConfigSave`).
- A late joiner's ADF elapsed timer starts at 0, and the tablet rolls each machine's own failures unless the crew sets its failure rate to 0, which the profile syncs ([no plugins in v1](../plugins/01-plugins.md#no-plugins-in-v1)).

**Not in v1:**

- Plugins for add-ons, such as one for GSX, which comes with [ground operations sync](ideas.md#ground-operations-sync), a Soon pick.
- Changing an aircraft's files: how a plugin does it waits until one needs it.
- The KNS-81's 10 waypoints, which the gauge keeps in its JavaScript, saves to the sim's DataStorage every 60s while it has power, and reads back only when it loads (read in bksq-aircraft-baronpro 0.1.1, `KNS81.js`, `radioConfigSave` and `radioConfigLoad`).
  A plugin could sync them: its write method would write the PF's waypoints to the gauge's keys with the sim's `SetStoredData` (read in the sim's `dataStorage.js`, FS Copilot profiles, `sim-sources/vcockpit12-efba220-1/html_UI_JS_dataStorage.js`; not run), then reload the gauge's panel document, which our FS Copilot fork did from the sim's inspector (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-09-17 — A peer's press drove the real A220 ND, opted in by identifier alone"), though a reload through our own panel code is untried.
  Or it would call the gauge's own `radioConfigLoad`, the waypoint load, which also tunes NAV 3 to waypoint 1 and writes that frequency into the waypoint on display (read in bksq-aircraft-baronpro 0.1.1, `KNS81.js`, `radioConfigLoad` and `setStandbyFrequency`; [the Baron's gauge state](../plugins/results/2026-10-17-baron-gauge-state.txt)), and nobody has tried that either.
  The KNS-81 sits alone in its panel document, `VCockpit13`, so a reload costs only its own JavaScript state: the displayed and used waypoint, the navigation mode, and the data entry mode, of which the gauge mirrors the waypoint number and the data entry mode to `L:` variables (read in `KNS81.js`).

**Rules:**

- Plugins' design, after v1, starts from these rules and isn't bound by them (user, 2026-10-17; [no plugins in v1](../plugins/01-plugins.md#no-plugins-in-v1)).
- Code that serves one aircraft or add-on lives in a plugin, never in Dual Input's own code, so dropping support for an aircraft means removing its plugin and its profile.
- Each aircraft has one plugin, which runs alongside any add-on's plugin, and plugins share no library, which comes when two plugins need the same code ([01-format-and-delivery](../profiles/01-format-and-delivery.md#deferred)).
  Black Square's Baron Pro and Bonanza Pro each ship a tablet file named `BlackSquareTablet.js`, of 4,830 and 5,383 lines (read in bksq-aircraft-baronpro 0.1.1 and bksq-aircraft-bonanzapro 0.1.1), and how much code the two share is unverified.
- A plugin runs while a variant its profile covers is loaded, and is published inside its profile's file, so pilots never install a plugin or pick one to run, and profiles and plugins reach pilots apart from Dual Input's releases ([architecture's tentative decisions](../architecture/decisions.md#plugin-code-runs-only-in-the-core), [decision 021](../../decisions/021-profiles-and-plugins-apart-from-releases.md)).
- A plugin's code runs only in Dual Input's core, the program that owns the session ([EFB app](#efb-app)), and reaches the panels and the WASM module through our own code's APIs (same decisions).
  It reaches only the sim and the aircraft, through Dual Input's APIs, and never the pilot's files (same decisions).
  It changes what Dual Input watches only in the write methods it registers, which run only when Dual Input calls them, because Dual Input would see any other change as a pilot's and send it to the crew.
  A write method writes however the aircraft needs, such as into DataStorage or a gauge's JavaScript ([01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
- Dual Input turns off a plugin that fails for the rest of the session, the [notification banner](#notification-banner) says so, and the flight goes on.
  A plugin turned off on any machine stops its entries syncing on every machine.
- A plugin changes an aircraft's files only on the pilot's machine, the pilot can turn such a plugin off in Dual Input's settings, and Dual Input never ships a file of another developer's ([decision 001](../../decisions/001-changing-other-developers-packages.md)).

**Depends on:**

- Profiles, which name the values a plugin exports.
- [State sync](#state-sync), which syncs those values as it syncs any entry.

**Open questions:**

- What language plugins are written in, which plugins' design decides when a pick needs them ([no plugins in v1](../plugins/01-plugins.md#no-plugins-in-v1)).
- Whether authors outside our team write plugins after v1, and what makes that easy.

## Session

### Invite code

The host starts a session and gets a code, and the other pilot enters it to join.

**In v1:**

- The code is six characters from the 30-character alphabet fsc-editor uses, which leaves out I, L, O, U, 0, and 1, because codes are read aloud and typed by someone looking at a sim (read in fsc-editor, `src/shared/remote-connect.ts`, `CODE_ALPHABET`, and `docs/remote-connect.md`, "The code").
- When the pilot selects the box for the code, Dual Input fills it from the clipboard if the clipboard holds a code, and joins at once.
- The code belongs to the session, not to any pilot's machine, and lasts until the last pilot leaves, so it doesn't change when control passes, and a pilot who dropped out rejoins with the same code.
- Dual Input and the sim start in either order: a host can start a session, and a pilot can enter a code, before the sim runs, and Dual Input attaches to the sim whenever it starts.

**Not in v1:**

- Invite links, because Discord shows a `dualinput://` link as plain text and an https redirect adds two prompts ([One-click invite](ideas.md#one-click-invite)).
- Permanent codes, left out on 2026-10-04 ([Ideas left out](ideas.md#ideas-left-out)).
- Reading the clipboard at any other moment.
- Host approval of each joiner.

**Rules:**

- The code admits a pilot with no approval from the host, as it does in fsc-editor, where the relay limits how fast one address can guess codes and the host sees how many peers are connected (read in fsc-editor, `docs/remote-connect.md`, "The code").
  It's a game among friends, and confirming each joiner would get in the way.
- Every pilot sees who's in the crew.
- Dual Input asks each pilot for the name the crew sees before they first start or join a session, and never takes it from the Windows account ([members](../session/02-units.md#members)).

**Depends on:**

- [The connection](#the-connection), which carries the code to the session.

**Open questions:**

- Whether the EFB app can fill its box from the clipboard: the EFB runs inside the sim's panel, so Dual Input's own app would read the clipboard when the EFB's box is selected (unverified).
- Whether the Dual Input IDE joins through the same session and code, making the Dual Input session the editing session too, or the session points the IDE at a server of its own; either way has consequences for the relay and the protocol, settled later.

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
- Through a short gap in the flying machine's data, the following machine carries the aircraft along the line through its last two samples, and eases it to the flying machine's position when data returns (user, 2026-10-11; [01-between-machines](../network/01-between-machines.md#softening-a-short-gap); [flight-model sync's design](../flight-model/01-flight-model-sync.md#drawing)).
- When a pilot loses the connection, the others fly on without pausing, and the [take-control key](#take-control-key)'s rules say what locks, what the [notification banner](#notification-banner) shows, and who can take control.
- After 30 minutes cut off, a pilot leaves the session, PF or PM (user, 2026-10-11; [01-between-machines](../network/01-between-machines.md#coming-back)).
  Our FS Copilot fork waits 5 minutes, which its notes call "long enough for a router reboot or a sim reload" (read in the FS Copilot fork, `FsCopilot/Simulation/Coordinator.cs`, `DegradedTimeout`, and `record/pointer-forwarding/docs/13-pr-prep.md`).
- Recovery is the app's job, and each part of Dual Input recovers its own state within it.
  The app tells whether a returning pilot's sim kept running or restarted, from session state it saves on the pilot's machine with an identifier for the sim's run.
  If the sim kept running, Dual Input reconnects the pilot with no action from them, from that saved state, and replays what they missed in the order it happened ([catch-up](../sync/03-catch-up.md#replaying-a-short-outage)).
  If the sim restarted, Dual Input rejoins the pilot once they're in a flight again, with the code it remembers, as a [late joiner](#preflight): flight-model sync puts them back in the aircraft's place, their cockpit catches up on every control the profile can read or track, and Dual Input tells them that their displays' pages, their FMS, and anything else the profile can't read may differ from the PF's.
  A pilot whose Dual Input crashed while their sim kept running comes back as a late joiner too, as one whose sim crashed does; Dual Input aims for a core that never crashes, and asks for a bug report when one does (user, 2026-10-12; [04-order-and-recovery](../sync/04-order-and-recovery.md#a-core-that-restarts)).
- A sim that closes, by a crash or by its pilot, counts as leaving the flight, and its pilot comes back as a late joiner, since a closed sim's pages, FMS, and avionics state can't be restored (user, 2026-10-11; [04-order-and-recovery](../sync/04-order-and-recovery.md#a-sim-that-closed)).
  A PF's crash passes control to the PM at once.
  When a pilot's sim crashes, their core stays up, and the others' notification says that pilot's sim crashed rather than that their connection dropped, such as "James's sim crashed. Dual Input rejoins them once they're back in a flight." ([Telling the crew a sim crashed](ideas.md#telling-the-crew-a-sim-crashed); user, 2026-10-07).
  How the core tells a crash from a pilot closing the sim is open (same entry).
- A pilot who leaves the flight but not the session, by going to the sim's main menu or loading another flight, drops out of flying: control passes to the PM if they were the PF, and the others get a notification.
  Once they're in a flight again, Dual Input rejoins them as a late joiner.
- A pilot leaves the session with Leave session, in the [EFB app](#efb-app) or the desktop app, and closing Dual Input from the tray or for an update counts as a Leave, while a Windows shutdown or logoff ends it with no quit, so the crew sees a lost link ([leaving](../network/01-between-machines.md#leaving)).

**Depends on:**

- The [take-control key](#take-control-key), for which machine is flying.
- The [invite code](#invite-code), for who joins.

**Open questions:**

- Whether a cut-off pilot's switches can be blocked as well as their displays, which needs input blocking such as the masking that [soft takeover](ideas.md#soft-takeover-on-handover), a Soon pick, uses.

### Preflight

From the moment a joined pilot is in a flight until the crew starts flying, every aircraft in the crew holds still at the PF's position, and the crew starts together once everyone is ready.

**In v1:**

- Joining and flying are two steps.
  Joining admits a pilot to the session once Dual Input's own checks pass, such as compatible Dual Input versions, which [installing and updating](#installing-and-updating) scopes.
- Once a pilot has joined, and until they're in a flight, they see where the PF is, such as "James is at EGLL stand X12", or "James hasn't loaded a flight yet" before the PF has ([in the flight](../session/02-units.md#in-the-flight)).
  A Go to button points the world map at the PF's departure airport and selects the PF's stand while the PF's engines are off, and a runway at that airport while they run, so the joiner's engines start running ([go to](../session/02-units.md#go-to)).
  It does so with the world map's own requests, made by a script of ours that a copy of the sim's BlurPage component brings into the menu's document.
  From a closed sim, that script set the departure, stand, and aircraft (measured on MSFS 2024, 2026-10-06, [interface log, 2026-10-06](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)), and a flight started after those requests loaded at the stand they set (measured on MSFS 2024, 2026-10-05, [interface log, 2026-10-05](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)).
  The copy ships in our package, built from the sim's stock file as our `VCockpit.js` is, and a release follows any sim update that changes either (user, 2026-10-18; [our package](../install/01-installing-and-updating.md#our-package)).
  Go to takes the stand from the `[Departure]` section of `CustomFlight.FLT`, the flight file the sim names in `FlightLoaded`, which names the stand a flight loaded at, such as `GateName=PARKING; GateNumber=140` (measured on MSFS 2024, 2026-10-05, [interface log](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)), so it never names a stand the PF taxied to.
- Each pilot loads their flight at the PF's stand, or at a runway of the PF's departure airport while the PF's engines run, because moving an aircraft across the world makes the sim load new scenery there, which can stall it or fill its video memory (unverified; a probe that moves a parked aircraft to an airport on another continent settles it).
- When a joined pilot is in a flight, Dual Input puts their aircraft at the PF's position, and from then until preflight ends, every aircraft in the crew, the PF's included, holds its position, altitude, and attitude, so the crew is in one aircraft from the start.
- Each pilot works through the [preflight match check](#preflight-match-check)'s list and clicks Ready.
- When every pilot counted is ready, a 3s countdown runs, and when it ends, preflight ends: the aircraft is free to move, and the rest of sync starts.
- When preflight ends, every other pilot's cockpit catches up to the PF's, as [state sync](#state-sync) scopes.
- The PF works through a checklist of the controls Dual Input tracks by counting their events, because no variable shows their value, and confirms each is where the aircraft starts it, such as a hypothetical "FCU speed 80" on an Airbus.
  Dual Input counts from that value, so a wrong start on the PF's aircraft reaches every other cockpit ([01-profile-entries](../sync/01-profile-entries.md#keeping-a-shadow-value)).
  Whether the 58P's profile has any such controls, and so whether v1's checklist has anything on it, is unknown until the profile is written.

**Not in v1:**

- Warning a pilot who spawned far from the PF before Dual Input moves them to the PF's position, which risks the scenery load above.
- Loading a pilot's flight at the PF's stand for them: the pilot loads it from the world map, and Dual Input moves their aircraft only once they're in it.
  The world map's own requests can also choose the aircraft and livery and start the flight (measured on MSFS 2024, 2026-10-05, [interface log, 2026-10-05](../interface/log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)), and our script went from a closed sim to Ready to fly with nobody at the sim (measured on MSFS 2024, 2026-10-06, [interface log, 2026-10-06](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)), but handling every page a pilot might start from would add days to v1's build, so it stays out (user, 2026-10-05).

**Rules:**

- If the PF's aircraft isn't on the ground when the session starts, there's no preflight: the crew flies at once, and every other pilot joins as a late joiner (user, 2026-10-08).
  Holding the PF still in the air would go wrong, because a frozen aircraft keeps integrating its velocities: a parked Baron, frozen and written 5 ft up, had its `A:VELOCITY BODY Z` climb from 0 to 68 ft/s in 4s (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-freezing-holds-the-pose-but-not-the-velocities-so-a-follower-has-to-write-them-all)), and skipping preflight is simpler than finding out whether writing every velocity each frame would hold them (user, 2026-10-08).
- A pilot's Ready is unavailable until their aircraft has settled after loading ([catch-up](../sync/03-catch-up.md#settling-after-a-load)).
- The Go to button is unavailable, and says why, on any page but the main menu's home page and Free flight's world map, or when Dual Input has no copy of BlurPage installed: a sim update removes BlurPage or stops MasterPage placing it, or another package copies it.
  Dual Input tries no other component, so the button stays unavailable until a Dual Input release picks one (user, 2026-10-06; [interface log](../interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
- Pilots other than the PF touch nothing in the cockpit during preflight, because catch-up sets only what the profile holds: a PM who switches a display to another page during preflight keeps that page after the PF's state arrives.
  The PF touches nothing beyond the checklist.
- Un-readying during the countdown cancels it, and the flight doesn't start until every pilot counted is ready again.
- During preflight, a ready pilot un-readies before Leave session is available to them, so leaving cancels a running countdown, and a pilot who has left no longer counts.
- A pilot who drops out during preflight becomes unready and still counts, so by default the crew waits for them.
  Any pilot who's ready can choose Go without, such as "Go without James", which takes James out of the count.
- A pilot who drops out and comes back before preflight ends is back in preflight, unready, and clicks Ready again.
- A late joiner, who joins after preflight ended or comes back after the crew went without them, skips Ready: once they're in a flight, Dual Input puts their aircraft at the flying machine's position, airborne or not, and their catch-up starts ([catch-up](../sync/03-catch-up.md#while-catch-up-runs)).
- Preflight comes only at a session's start, because once it has ended, a session with no pilot in the flight ends (user, 2026-10-12; [roles and members](../session/01-roles-and-members.md#the-pf)).
  A session flies one aircraft, its PF's, so a crew that wants another starts a new session.

**Depends on:**

- [Flight-model sync](#flight-model-sync), which puts each joined pilot's aircraft at the PF's position and holds it there; preflight also holds the PF's own aircraft.
- [State sync](#state-sync), whose catch-up brings every cockpit to the PF's when preflight ends.
- The [preflight match check](#preflight-match-check), for the list each pilot works through.
- [The connection](#the-connection), for who drops out.

**Open questions:**

- Whether moving a joiner's aircraft from a runway at the PF's departure airport to an airborne PF stalls the sim (unverified; the probe that moves a parked aircraft to another continent settles it).

### Preflight match check

During [preflight](#preflight), and when a late joiner is in a flight, Dual Input compares what each pilot has for the shared aircraft and lists what differs.

**In v1:**

- The differences show beside each Ready button, as a list of warnings and errors in the EFB app and as counts on the [notification banner](#notification-banner)'s summary, and how they look is for a later design.
- The comparison covers the aircraft's package, where it's installed, its manifest's version, and the livery ([the match check](../session/02-units.md#the-match-check)), since two pilots can run the iniBuilds L-1011's "1.0.8" from different stores with different files (read in inibuilds-aircraft-l1011 1.0.8, `common/flt/runway.flt`, against the same file in its streamed copy's unencrypted `minimal.fsarchive`).
  A streamed copy, which keeps no version on disk, shows against an installed one as a warning that asks both pilots to compare versions themselves.
- Each pilot's profile for the aircraft is compared by a hash the core computes, since a profile carries no version of its own, so a profile someone edited by hand shows as an error, and a copy not yet published shows as "unpublished" ([01-format-and-delivery](../profiles/01-format-and-delivery.md#the-aircraft-and-its-variants)).
- Each sim's time of day is compared at preflight and at a late join, and a difference shows as a warning (user, 2026-10-12; [04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).

**Not in v1:**

- Stopping a pilot from flying over a difference other than the aircraft itself.
- Detecting which licensed add-on an aircraft uses, such as the Baron choosing its GPS unit by the TDS license (documented in bksq-aircraft-baronpro 0.1.1, `Manual\BKSQ_BaronProfessionalManual.pdf`, "TDS GTNxi 750 Integration"), which pilots sort out themselves.

**Rules:**

- Two pilots fly together only in the same aircraft, the same SimObjects folder and preset, so a different variant, such as the Baron's 58P against its base model, counts as a different aircraft (user, 2026-10-12; [01-format-and-delivery](../profiles/01-format-and-delivery.md#the-aircraft-and-its-variants)).
  A pilot in a flight with another aircraft, whether they joined in it or loaded it later, stays in the session but out of the flight, as at the main menu, with a notification to load the session's aircraft, and once they load the flying machine's aircraft, they rejoin as a late joiner (user, 2026-10-16; [in the flight](../session/02-units.md#in-the-flight)).
- No other difference stops the flight: versions, liveries, and add-ons stop nothing.
  An error says something will likely go wrong, and a warning says it might: a different aircraft version can be an error, and a different livery a warning.
  A developer's update that fixes textures changes the version without touching anything Dual Input syncs, and making a pilot spend 10 minutes updating for it would only get in the way.
- A difference that breaks one feature turns that feature off for the session and shows a warning, rather than an error for the whole flight.
  A machine that can't read the aircraft's models turns off only part of avatar sync, as [avatar sync](#avatar-sync) says.
- A session in an aircraft with no published profile flies with state sync, pointer sync, and avatars idle, and the check shows the missing profile as an error ([the match check](../session/02-units.md#the-match-check)).
- The check runs again whenever either pilot's aircraft changes.

**Depends on:**

- Profiles, whose hashes the check compares.
  What a feature needs follows from what the profile references, such as the display identifiers pointer sync replays into, and Dual Input checks each machine for those itself.
- [Preflight](#preflight), whose join step admits the pilot and during which the check runs.

**Open questions:**

- Which add-ons can be compared without work for each aircraft.
  A package's manifest declares its dependencies, but optional add-ons go undeclared, as the Baron's GPS units do, so the profile could list the packages that matter.
- Whether the check compares the scenery at the departure airport, since v1 doesn't support different scenery.

## Around the aircraft

### Traffic sync

The AI traffic in one pilot's sim, usually injected by an ATC add-on such as BeyondATC, appears in every pilot's sim, out of the window and on TCAS.

**In v1:**

- A traffic host, the pilot whose sim has the traffic, in a role of its own, separate from control, as in our FS Copilot fork (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "One host, and it need not be the master").
  A pilot takes the role by hand, with a "Share my traffic and ATC" switch, and any pilot can take it at any time by turning theirs on (user, 2026-10-11 and 2026-10-13; [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
- Aircraft, and ground objects only within 1km of the traffic host's aircraft and only when their title is on a list, which starts with the sim's pushback tugs and takes others, GSX's among them, as the build finds them, accepting that ground objects may show issues in v1 (user, 2026-10-17; [traffic and ATC's design](../traffic-atc/01-traffic-and-atc.md)).
- A radius as a setting, up to the SDK's 200km cap, which is the default (FS Copilot fork, same file, "Reading").
- A notification on a receiving machine while its sim shows aircraft that aren't the traffic host's, and another while any of the traffic host's aircraft is missing or shown as a stand-in, and a page that lists the machine's traffic packs when asked; the [preflight match check](#preflight-match-check)'s list names no traffic source, traffic pack, or multiplayer.

**Not in v1:**

- Removing another source's traffic for the pilot, because SimConnect removes only the AI objects its own client created ([SimConnect_AIRemoveObject](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/API_Reference/AI_Object/SimConnect_AIRemoveObject.htm)).
- Hiding another source's traffic, which would leave ATC talking to aircraft nobody sees, so Dual Input hides none.
- GSX's other vehicles and its people, which wait for [ground operations sync](ideas.md#ground-operations-sync).
- Detecting a pushback started in a following machine's sim (user, 2026-10-17).

**Rules:**

- A receiving pilot runs the same traffic packs as the host and no others, and the same scenery.
  With other packs, aircraft go missing or fall back to generic models, and a frozen object isn't clamped to the ground, so with other scenery it floats or sinks (FS Copilot fork, same file, "Model matching"; measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Baseline: BeyondATC's own traffic scores 0.56").
  Two groups of FS Copilot testers missed this and flew with airliners missing (from our experience with FS Copilot), which is why a receiving machine raises a notification while any of the traffic host's aircraft is missing or shown as a stand-in.
- The copies move smoothly.
  Frozen and written every frame from samples at 2Hz, our fork's copies scored 0.17 median jitter against 0.56 for BeyondATC's own traffic, on one PC (measured on MSFS 2024, 2026-09-06, same log, "Jitter measured, not eyeballed"), and ran well between two machines (from our experience with FS Copilot).
  BeyondATC has since released an update for smoother AI traffic, which we haven't compared (reported by the user, 2026-10-03).
- When the traffic host changes, the new host removes the traffic it had injected before it starts, and the old host stops sending (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "One host, and it need not be the master").
- The role stays with its holder through a lost link, a flight left, or a crash, and the holder's copies on the other machines go after 15s without a sample (user, 2026-10-13; [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host)).
- A pilot who starts a pushback, from GSX, an ATC add-on such as BeyondATC, or the sim's own `K:TOGGLE_PUSHBACK`, takes control first and flies it.
  A pushback in a following machine's sim acts on an aircraft frozen to the flying machine's, so we expect it to move nothing (unverified).
  The tug shows to the rest of the crew only when that pilot is also the traffic host, and only if traffic sync carries it: our fork listed and spawned GSX's tugs in a replay of a recorded session on one sim, though nobody judged how they look when driven (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "2026-09-06 · First visual replay; engines, pushback, ground vehicles", and `record/traffic-atc/docs/02-open-questions.md`, Q07).
  [Ground operations sync](ideas.md#ground-operations-sync), a Soon pick, replaces this rule.

**Depends on:**

- The [notification banner](#notification-banner), for traffic's notifications.
- [The connection](#the-connection).

**Open questions:**

- Whether traffic sync carries the tug of a pilot's own pushback, which rests on a check in the sim: the sim's pushback tugs show in traffic's poll as `ASO_Pushback_` objects, and BeyondATC's pushback may use the sim's own tug (reported by the user, 2026-10-04, unverified).
- Whether the count of aircraft that aren't the traffic host's sees multiplayer's other pilots (unverified).
- How our copies compare with BeyondATC's updated traffic.

### Hearing ATC

The ATC app's audio on the traffic host's machine plays on every other pilot's machine, so the whole crew hears ATC.

**In v1:**

- ATC apps that run as their own program, such as BeyondATC, captured by process and found by program name or picked from a list of programs playing audio, as our FS Copilot fork does (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Capturing" and "Choosing the ATC app").
  Dual Input finds BeyondATC by itself, and SayIntentions by its program's name, which a check in the sim confirms ([traffic and ATC's design](../traffic-atc/01-traffic-and-atc.md)).
- Dual Input plays the audio on the output device, with no window needed, so a pilot in VR hears it too.
  The output device is a setting: Windows' default device, which Dual Input follows when the pilot switches headsets, or a device the pilot picks ([04-core-helper](../core/04-core-helper.md#the-devices)).
  Dual Input's own sounds, such as the handover cues, play on the same device.
- An ATC volume setting turns ATC down alone ([traffic and ATC's design](../traffic-atc/01-traffic-and-atc.md)).

**Not in v1:**

- The sim's own ATC, which plays mixed with the rest of the sim's sound; pilots who share ATC turn it off.
- The receiving pilot's COM volume or tuned frequency shaping the audio, which BeyondATC already does.
- The host pilot's own transmissions, which the crew hears on Discord.

**Rules:**

- The traffic host is also the ATC host.
- Turning the ATC app down in the host's Windows mixer doesn't turn it down for the crew.
  Windows applies the mixer level before the capture, so the host divides it back out, up to +20dB, as our fork's did (measured on MSFS 2024, 2026-09-06, FS Copilot fork, `record/traffic-atc/docs/build/log.md`, "Stage 3: the audio path works on one machine").
- ATC reaches the crew about 130ms after the app plays it, plus the network delay, plus whatever depth past 60ms the buffer picks at the start of a transmission, up to 300ms (same entry; [traffic and ATC's design](../traffic-atc/01-traffic-and-atc.md)).
  At times it reaches a crewmate later than 300ms, the delay at which a readback on Discord would overtake the call, when the ATC host is relayed on a lossy link far from the relay their packets cross, which the user accepts for v1 (user, 2026-10-10; [01-between-machines](../network/01-between-machines.md#the-relays)).
  A direct path that dies with no warning loses up to 2s of it, the 2s the connection takes to move to the relay (same section).
- Dual Input picks up an ATC app started after it, and attaches again when the app restarts (FS Copilot fork, `record/traffic-atc/docs/01-design.md`, "Choosing the ATC app").

**Depends on:**

- The traffic host role in [traffic sync](#traffic-sync).
- [The connection](#the-connection).

**Open questions:**

- Whether capture works on Windows 10, which our fork never tested.
- Which ATC apps besides BeyondATC capture cleanly, since only BeyondATC was tried live; SayIntentions works through our FS Copilot fork's capture (reported by the user, 2026-10-17).
- An ATC app that injects no traffic, on one pilot's machine, alongside a traffic injector on another's would want two hosts; v1 treats that as too rare to support.

### Time, date, sim rate, and pause

The crew's sims share one simulation rate and an active pause that holds for everyone, so clocks that start together stay together.

**In v1:**

- When any pilot turns active pause on or off, every machine follows.
- The flying machine's simulation rate reaches every machine when [preflight](#preflight) ends, when a late joiner is in a flight, and whenever the PF changes it.
  Dual Input puts back any change another pilot makes to it.
- When the PF opens the sim's pause menu, the [notification banner](#notification-banner) tells the rest of the crew, such as "James is in the pause menu", so a frozen aircraft has a reason.

**Not in v1:**

- Syncing the time of day and date: the [preflight match check](#preflight-match-check) compares each sim's time of day instead, and shows a difference as a warning (user, 2026-10-12; [04-order-and-recovery](../sync/04-order-and-recovery.md#catch-up)).
- Syncing the pause menu itself.
  It raises the sim pause, which stops that pilot's aircraft and leaves the sim's clock running (measured on MSFS 2024, 2026-10-03, [environment log](../environment/log.md#2026-10-03-the-pause-menu-is-the-sim-pause-and-lets-the-clock-run-active-pause-stops-it-and-only-simconnect-raised-a-full-pause)), so the PF's following machines stop with the PF's aircraft and no clock drifts.
- Weather, a Later pick.

**Rules:**

- Active pause is the pause that syncs, because it stops the sim's clock, and one machine in active pause alone would drift behind the others (same entry).
- A following machine sets active pause through the EFB app, since the one way we found is the toolbar's own call, from the toolbar's or the EFB's document ([rate and pause](../session/02-units.md#rate-and-pause)).
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

Each pilot sees the other pilot as a figure of Dual Input's own, in their seat, looking where they look, reaching for what they change, and on foot beside them on the walkaround.

**In v1:**

- The figure is a few plain shapes that carry meaning by how they move, as the idea [Avatar sync](ideas.md#avatar-sync) describes, posed from variables of its own (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-our-own-figure-poses-in-the-sim-from-its-variables-plays-between-frames-smoothly-and-changes-color-through-asobo_property_animation)).
- Seated, the figure's body sits on its seat as the profile tunes it, and its head goes where the pilot's camera is and turns where they look, so a lean shows, with the neck stretching to cover the difference.
  `SimConnect_CameraGet` gives the camera's position and look, a head tracker's rotation included (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-simconnect_cameraget-includes-a-tobii-head-trackers-rotation-and-its-position-is-in-meters)).
- The hands follow [the avatars' tentative decisions](../avatars/decisions.md): a hand goes where the pilot clicks or drags, found from the aircraft's own model, and the yoke hands follow a pilot's habits in either seat.
  Only the PF's figure holds a yoke at rest, any other figure rests both hands on its thighs, and when control passes, the new PF's figure takes its yoke and the old PF's lets go ([the hands' habits](../avatars/decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat)).
  A press on a yoke's wheel rather than a button is a grab by the hand on that side (user, 2026-10-17).
  A hand holding the yoke stays on its horn on every machine, the receiving machine placing the grip from its own yoke, since a following machine draws the aircraft and its yoke 0.4s behind ([the other machine](../avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)).
- A hand also reaches for a change made without a click, such as a home cockpit's switch or a key binding, at the control's spot, which the profile holds as the entry's `location` ([01-format-and-delivery](../profiles/01-format-and-delivery.md#state-entries)).
  A click tool records the spots: it walks the profile's entries, and the author clicks each control.
  Such a change brings the hand only to a control a pilot moves with hardware or a key and the aircraft never moves itself, only after 100ms with no other such change, and only past the entry's deadband, so neither several entries changing in the same instant nor noise on an axis brings one ([what brings the hand](../avatars/decisions.md#a-click-or-a-change-at-a-controls-spot-brings-the-hand-and-on-foot-the-hand-touches-up-to-3m); [a change made without a click](../avatars/01-avatars.md#a-change-made-without-a-click)).
  A wheel turn brings the hand as a tap does.
- A cockpit change never waits for the hand ([no waiting](../avatars/decisions.md#a-change-applies-without-waiting-for-the-hand)).
- On foot, the figure walks, runs, crouches, and idles as the pilot's avatar does, from the avatar's position, facing, ground speed, and `A:IS CROUCH`, which SimConnect reads every frame (measured on MSFS 2024, 2026-10-02, [avatars log](../avatars/log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame); `A:IS CROUCH` switched between 0 and 1 while the pilot crouched, in [p01's results](../../../experiments/areas/avatars/results/p01-avatar-2026-10-02-21-05-51.txt)).
- On foot, the arm touches a spot up to 3m away, and past 3m it points at the spot at 0.6m long (user, 2026-10-17).
  The pilot clicked from a median 1.8m to 2.6m and up to 5.8m away (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
- A pilot sees their own figure inside the aircraft and in an outside view, on by default with a setting to turn it off, so the pilot sees what they show the crew (user, 2026-10-17).
  While their camera sits at the figure's head, the figure's head and neck hide and its hands fade, and where the sim can't fade a figure's material, the hands hide.
  To hide the sim's own avatar in an outside view, Dual Input ships an avatar with nothing to show, which the pilot picks, as the [No Avatar](https://flightsim.to/addon/59715/no-aavatar) add-on does, and v1 tells the pilot how to pick it.
- Each pilot picks their figure's color in Dual Input's settings, and two pilots who picked the same color both show it and sort it out between themselves; only a pilot who never picked one gets one nobody shows, and gray stays the color of a dropped pilot (user, 2026-10-17).
  A "Show the crew's figures" setting, on by default, hides every figure but the pilot's own when the pilot turns it off.
- When a pilot's connection drops, their figure slumps in its seat and turns gray, and when they leave the session, it disappears.
  A figure slumps and turns gray only on a machine that reaches the internet, by the network's check of our relays ([the network's units](../network/02-units.md#what-the-pilot-sees-and-settings)), and no figure slumps before the check answers.
  On a machine that doesn't reach it, the other figures ease to rest in their own colors, the PF's still holding its yoke, and that machine's own figure turns gray without slumping, so a PM cut off by their own connection doesn't see the PF look incapacitated.
- A pilot in the session but out of the flight shows as one whose connection dropped.
- When a pilot switches to an outside view, their figure stays seated, facing forward.
- A pilot whose camera moves around inside the aircraft, in no seat, shows as a head floating at their camera.
- A WASM module places each figure inside the sim's frame, turned by the aircraft's attitude and led by up to a frame, which held our figure in the 58P's right seat at up to 185 kt GS (measured on MSFS 2024, 2026-10-03, [avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  Dual Input edits no other developer's package to hold it there.

**Not in v1:**

- Moving a pilot's camera to a seat for them, left out on 2026-10-04 ([Ideas left out](ideas.md#ideas-left-out)): pilots set up their own views, with the sim's camera or ChasePlane.
- Hands for a pilot in VR, whose clicks give no cursor place for the ray (unverified); their figure still sits and looks.
- Sidesticks and center sticks, since the hand rules are for a yoke, and the 58P has yokes.
- Passengers, a Later pick in [the plan](plan.md).
- Feet on the pedals, though the 58P poses its pedals from its own code (read in bksq-aircraft-baronpro 0.1.1, `BaronProfessional_Base_INT.xml`, `RUDDERPEDALS`), because telescoping legs reaching a pedal look uncanny where telescoping arms look playful, and an author can tune a seat's knees and feet but not a foot's arc onto a pedal.

**Rules:**

- The profile holds every seat the aircraft has: its name, the figure's pose on the cushion, and the eye point.
  The authoring tool seeds a seat from the seat objects SimConnect lists, then from the cockpit model's `PILOT_` nodes, then from a click on the cushion, and the author tunes it ([Seat awareness](ideas.md#seat-awareness)).
  The 58P lists a seat object only for the pilot's seat, so its right seat starts from its model's `PILOT_1` node (measured on MSFS 2024, 2026-10-03, [aircraft log](../aircraft/log.md#2026-10-03-the-baron-58p-lists-only-its-pilots-seat-because-the-seat-objects-are-the-seats-in-each-aircrafts-navigation-graph)).
- Each pilot moves to a seat themselves, with their own camera.
- Dual Input tells which seat a pilot is in from their camera's position: a pilot takes a free seat when their camera comes within its take radius of its eye point, 0.4m unless the profile gives one, and of the seats whose radius holds the camera, the one with the nearest eye takes it (user, 2026-10-17; [a seat](../avatars/01-avatars.md#a-seat)).
- A pilot leaves a seat only by taking another, going on foot, or moving their camera more than 0.8m behind the seat's hip, so a close-up of the panel never takes a pilot out of their seat (user, 2026-10-17).
  A leave radius would have to pass 0.77m to keep a pilot seated in the 58P's eight instrument views, which sit 0.35m to 0.77m from the nearer seat's eye in any direction (read in bksq-aircraft-baronpro 0.1.1, `bksq-aircraft-baronpropress/cameras.cfg`).
  Measured backward alone, the farthest back of those instrument views, `EmergencyGearExtension`, is 0.58m behind the `Pilot` eye, which stays under 0.8m behind the hip while the seat's eye sits less than 0.22m behind its hip (arithmetic), and `CabinForward` is about 2m behind it (same file).
- A pilot holds one seat, so taking a free seat leaves the one they held.
- Nobody takes a seat another pilot holds, and a figure hides from a pilot whose camera is in its seat.
  The banner names the free seat, and Ready doesn't wait for a seat, since both pilots' sims start them in the `Pilot` view (unverified).
  Two pilots swap seats by one leaving theirs first, down the cabin or, in a two-seater, out to the tail and back.
- On a machine that can't read the aircraft's models, its pilot's clicks bring no hand and no figure holds a yoke, while seats, heads, and changes made without a click still show ([a machine that can't read the models](../avatars/01-avatars.md#a-machine-that-cant-read-the-models)).
- The build's stage for avatars ends only when no part of the figure visibly skips a frame in flight: our test pilot saw some part of it miss a frame now and then in the 58P ([avatars log](../avatars/log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).

**Depends on:**

- Profiles, for the seats and the control spots.
- [The connection](#the-connection), which carries each pilot's camera, clicks, and avatar.

**Open questions:**

- How Dual Input's empty avatar is built, and whether the pilot picks it in the sim's own avatar screen or Dual Input can select it (unverified).
- Whether the sim can fade a figure's material, through the material animation that colors it, so a dropped pilot's figure can turn see-through and a pilot's own hands can fade (unverified).
- Whether a click through the pilot's own figure still reaches the control behind it.

## Interface

### EFB app

A small app on the sim's EFB holds what a pilot needs during a flight, so a pilot in VR can use Dual Input without taking the headset off.

**In v1:**

- An app of its own, built on the sim's EFB framework, not the desktop app reused.
  Shipping EFB apps are written that way: A2A's tablet is TSX bundled by esbuild on Asobo's EFB API and the MSFS Avionics Framework, and it registers with `Efb.use` (read in a2a-aircraft-aerostar600 1.0.6, `A2ATabletApp.js`).
- What a pilot needs during a flight: the take-control button, the crew and the connection's state, the Ready button beside the match check's warnings and errors, Go without for each pilot who drops out during [preflight](#preflight), the box for an invite code, Leave session, and a button for a bug report that logs the moment the pilot pressed it, which the recording also holds as an input (user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).
- Opening onto what a notification on the [notification banner](#notification-banner) is about when the pilot clicks it anywhere but on its action, whether the EFB was open on another app or closed.
  The core passes the click to the app, whose own code runs while the EFB is closed: it opens the EFB if it's closed and fires `OPEN_BY_KEY` with its own name, which opened a crowded EFB onto our app whether the EFB was closed, open on another app, or closed after use, with our app on neither the dock nor the first page of the app list (measured on MSFS 2024, 2026-10-06, [interface log](../interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
- A button that brings the desktop app to the front while Dual Input's core is running.
- How it looks is for a design later.

**Not in v1:**

- The desktop app's interface running in the EFB.
  Coherent GT rejects syntax newer tools emit and lacks APIs a desktop interface uses (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), and fitting the main app to it would hold the main app back.
- The report page, which stays in the desktop app.

**Rules:**

- The EFB app shows the core's state and sends it commands, and decides nothing itself, so two interfaces don't mean two implementations.
- Any client changes any setting and can watch the notifications, so whether the EFB app offers settings and shows notifications is for [the apps' design](../interface/01-apps.md) (user, 2026-10-17).

**Depends on:**

- Dual Input's core, which owns the session; a headless core with the apps as its clients is the architecture's leading candidate in [the plan](plan.md).

**Open questions:**

- Whether the EFB app can fill its code box from the clipboard, as the [invite code](#invite-code) section asks.

### Notification banner

Dual Input's notifications slide in at the right of the screen, on a see-through in-game panel, the kind of window the sim's toolbar opens, so the pilot sees them whether or not the EFB is open.
A notification can carry one action of its own, such as Ready on the preflight summary, and a click anywhere else on it opens the [EFB app](#efb-app) at what the notification is about.

**In v1:**

- The banner, in VR as on a monitor, for notifications such as "James is in the pause menu", "You've lost the connection", and "You have control".
- A notification when a synced control never matches after Dual Input's retries, once per control per flight, such as "Couldn't sync the beacon." ([live sync](../sync/02-live-sync.md#checking-that-a-write-landed)).
- While a pilot's cockpit catches up, a "Catching up..." notification saying that switches they move now will be reset ([catch-up](../sync/03-catch-up.md#while-catch-up-runs)).
- During [preflight](#preflight), a summary of who has joined, who's ready, and how many warnings and errors the [preflight match check](#preflight-match-check) found, with a Ready button, and for pilots other than the PF, a line telling them to touch nothing in the cockpit.
- Dual Input opening the banner's panel itself when a flight loads, with no click from the pilot.

**Not in v1:**

- The rest of Dual Input's controls, which live in the EFB app.
- A banner that floats in front of the pilot's view on an object of ours, like a pair of AR glasses: its text smeared while the view moved, and parts of the cockpit sometimes cut into it (judged by the pilot in MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-a-banner-drawn-on-an-object-of-ours-smears-in-motion-and-is-clipped-behind-the-cockpit-so-we-parked-it-for-an-in-game-panel)).
- Dual Input's other objects in the cockpit, such as a take-control button stuck to a window, a Later pick.

**Rules:**

- The banner shows during preflight, and after that only when something needs the pilot's attention, such as a lost connection, a PF who dropped out, or control passing to them.
- Between notifications the panel draws nothing, because the sim blurs whatever lies behind the pixels a panel paints (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).
- A notification that asks the pilot to act says where: on the notification, in the EFB app, or in the desktop app.

**Depends on:**

- The [EFB app](#efb-app)'s code, which opens the banner's panel ([architecture's tentative decisions](../architecture/decisions.md#the-efb-apps-code-opens-the-banner-panel)).
  It and a script that Dual Input's toolbar icon puts into the sim's toolbar each opened the panel from our installed package after a flight load and mid-flight ([interface log](../interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)), and Dual Input ships no toolbar script, since it rests on Parallel 42's trick, not a sim feature: the toolbar runs markup it finds in an icon, and an update could stop that.
- The [EFB app](#efb-app), which a click on a notification opens.

**Open questions:**

- Whether the EFB app's code opens the panel at every flight load: no run has had it open the panel during a load or after a second flight load ([architecture's spine](../architecture/01-spine.md#left-open)).
  It calls the toolbar again until the banner's page connects, and a check in the sim times it ([the apps' design](../interface/01-apps.md)).
  Our toolbar script left the panel closed after the first of three Build and Mounts, with no error, for a reason we don't know (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).
- How long a notification stays, and how notifications come and go.
- Which further notifications v1 needs, such as connection trouble short of a drop.
- How the banner looks and reads in VR, which nobody has tried, since our development machine has no headset.
  ChasePlane closes its own full-screen overlay when the toolbar's `globalVars.vrMode` is set (read in p42-util-chaseplane 2026.39.1.16, `HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE_OVERLAY.svg`), which suggests a panel like ours may not work in VR (unverified).
- Whether clicks on the panel's empty part reach the cockpit beneath it, which nobody has tried.
  If they don't, the full-height column blocks that part of the cockpit for the whole flight, and reporting only the notification's rectangle with `UPDATE_PANEL_RECT` might let them through (unverified, [interface log](../interface/log.md#2026-10-04-an-in-game-panels-size-is-a-percent-of-the-screens-height-capped-at-150-of-it-so-ours-cant-span-a-wide-screen-though-parallel-42s-panels-do)).
- How to keep the panel on the right when Dual Input opens it: opened from code, it sat at the left of the screen (measured on MSFS 2024, 2026-10-04, [interface log](../interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).

## Tools

### Recording and bug reports

Every pilot's machine records its side of the session, and a bug report gathers the crew's recordings, so we can see the session as if we'd been there.

**In v1:**

- Every crew member's machine records every input that passes through Dual Input, such as each synced change, each handover, and the connection's events, the high-rate samples such as traffic's positions and the flight model's included ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md); user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).
- The recording keeps the readings state sync's panel module takes from the gauges' JavaScript, which arrive as inputs, and what plugin tests need from a recording waits for plugins' design, after v1 ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md#left-open)).
- The recording keeps each watch-only profile entry whose value differs between machines, with both values ([live sync](../sync/02-live-sync.md#values-not-events)).
- Dual Input logs a synced control that never matches after its retries, with both machines' values and the retries, as the [EFB app](#efb-app)'s button logs the moment the pilot pressed it, which the recording also holds as an input ([live sync](../sync/02-live-sync.md#checking-that-a-write-landed); user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).
- Each machine keeps its runs within 1 GB, which holds about 17 hours of a busy session's recording (user, 2026-10-23; [recording log](../recording/log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb)).
- A bug report brings together every crew member's recording, with everything else that helps us see the session as if we'd been there, such as the logs, the versions of Dual Input, the sim, and the aircraft, the profile, and the connection's statistics.
- When a pilot reports a problem, we ask for the run's log first, and for the recording only when the log isn't enough, and the pilot sends the run's folder by hand (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).
- The desktop app lists the machine's runs by when each started, with its size, and deletes any but the one in progress ([what each PC keeps](../recording/01-recording-and-bug-reports.md#what-each-pc-keeps)).

**Not in v1:**

- The debrief timeline that plays a flight back, a Later pick in [the plan](plan.md).
- Uploads, which come after v1 (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)):
  - Each pilot uploading their own part to our Worker, labeled with the session's ID, where the parts meet, so a report works after the crew has gone: if something goes wrong on landing and everyone goes to bed, there's no live session the next morning.
    The Worker keeps each part in R2 for 30 days, and takes it only from a member of that session ([01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md)).
    The session's ID is a version 4 UUID, drawn by the host's core when it starts the session, and every machine shares it; it can't be the code, since a later session can draw the same six characters ([architecture's spine](../architecture/01-spine.md#ids)).
  - A report page that lists the pilot's recorded sessions from each run's index, so each is easy to recognize, by date and time, aircraft, departure airport, and crew, and offers to upload one.
  - On our end, a report showing as one session with who has uploaded and who's missing, such as "uploaded: James, Adam; missing: Greg".
  - A pilot's Dual Input offering their part when a crewmate has sent one.

**Rules:**

- Each run's log has home-folder paths and the Windows username replaced as each line is written, while a recording's inputs keep them as they came, since a replay needs their bytes; pilots' display names stay ([the home folder's path](../recording/01-recording-and-bug-reports.md#the-home-folders-path)).
  A screenshot taken during our avatar work showed both a home folder's path and a person's name ([avatars log](../avatars/log.md#2026-10-03-a-probe-can-screenshot-the-sim-window-and-a-screenshot-can-show-a-home-folders-path-and-a-persons-name)).

**Depends on:**

- [The connection](#the-connection), for the session's ID that labels every part after v1.

### Test sessions

A profile's author changes the profile during a test flight, and every pilot's cockpit takes the change within seconds, with no new session.

**In v1:**

- An author's save builds a new bundle into their local folder, through the profile builder's `watch` or the profile extension, and their Dual Input sends it to the crew, whose PCs all reload it ([test sessions](../profiles/02-units.md#test-sessions); user, 2026-11-21).
- Any pilot in the session can be the author, and the newest save wins, so two authors can take turns.
- A crewmate needs none of the author's files: a pilot who joins or rejoins gets the bundle from the PF's Dual Input.
- While the profile is unpublished, the EFB app's session card shows the profile's short hash and who saved it, each crew row shows the hash that pilot's PC runs, or that it's still loading, and the banner says once when every PC has loaded a new save ([a test session shows the bundle each PC runs](../interface/decisions.md#a-test-session-shows-the-bundle-each-pc-runs)).
- In a session's flight, the profile extension shows each `watch:` line's live value, runs one entry's write with a value the author types, and lists the cockpit's panels for `displays`, outlining in the sim the one the author is on ([04-the-extension-in-the-sim](../profiles/04-the-extension-in-the-sim.md); user, 2026-11-21).
- Its Sync log shows, live, each decision state sync's engine takes on the author's PC, as a row for each change with every step it took, and each entry's latest step at the end of its line ([06-the-sync-log](../profiles/06-the-sync-log.md); user, 2026-11-25).

**Not in v1:**

- Merging two authors' edits: each save replaces the whole bundle.
- The Dual Input IDE's dev loop beyond the profile extension's, such as discovering what an aircraft exposes ([the IDE](ideas.md#dual-input-ide)).

**Rules:**

- No setting turns a test session on: a session becomes one at the first save, and only a tool that builds a profile writes into the local folder.
- A save that fails to build changes nothing, since only a bundle that built reaches the folder.
- A reload changes nothing but the profile: the aircraft keeps following the PF's, and traffic stays, while the crew's figures go and come back.

**Depends on:**

- [The connection](#the-connection), which carries the bundle.
- [State sync](#state-sync), whose catch-up brings each cockpit to the PF's after a reload.

## Getting Dual Input

### Installing and updating

One installer puts Dual Input's app and its package in the sim's Community folder on a pilot's PC, and updates keep both current without catching the pilot mid-flight.

**In v1:**

- One installer, for the app and the Community package together.
  It finds the Community folder as fsc-editor does, from the `InstalledPackagesPath` line in `UserCfg.opt`, which the Steam and Microsoft Store installs keep in different places ([02-01](../../learn/foundations/02-01-installs-and-packages.md)).
  Nothing asks the pilot for a Community folder: the sim finds its folders only through `UserCfg.opt`, so a pilot who installs before the sim's first run gets our package when that run closes, provided the run writes `UserCfg.opt` (unverified; [the packages folders](../install/01-installing-and-updating.md#the-packages-folders)).
- Updates download silently, and Dual Input checks for one each time it starts, before the pilot is likely to have the sim running.
  The desktop app also checks on a timer and when the pilot asks ([when the app checks](../install/01-installing-and-updating.md#when-the-app-checks)), and its window shows whether it's checking, downloading, up to date, ready and what holds it back, or failed (user, 2026-10-18).
- The app and the package update together, as one version, and only while the sim is closed, because the sim loads a package only at boot ([02-01](../../learn/foundations/02-01-installs-and-packages.md)) and an app ahead of its loaded package would have to cope with every pairing.
- An "install when the sim is closed" option: when the sim exits, the desktop app, which runs from login as a tray icon, updates Dual Input then.
  Dual Input installs no update while a session file exists, since a sim crash closes the sim too, and the option would then leave a core on a new version that its crew refuses ([01-between-machines](../network/01-between-machines.md#a-session-file-after-a-long-outage)).
  Install now quits the core so the update applies, waiting while the sim runs or a session is held (user, 2026-10-18; [install now](../install/01-installing-and-updating.md#install-now)).
- Dual Input has no watcher: the desktop app starts with Windows as a tray icon, for the pilot's own account, as a setting the pilot can turn off (user, 2026-10-06 and 2026-10-18; [one program from login](../install/01-installing-and-updating.md#one-program-from-login)).
  A pilot who rarely flies with a crew will ask why it runs all day, so it records its own CPU and memory use and the core's, and shows them over its last 24 hours of running, in words a pilot takes in at a glance, when they open it from the tray icon, choose to quit it, or find its setting.
  Beside the numbers it says what it does for them and what quitting costs, in concrete terms.
- Dual Input searches no other Community package for one that overrides `VCockpit.js`, such as FS Copilot's or YourControls' (user, 2026-10-23; [architecture log](../architecture/log.md#2026-10-23-a-review-against-the-simplicity-rule-cut-eight-guards-and-kept-every-designed-feature-it-questioned)).
  The SDK says the package mounted later wins (documented, [02-01](../../learn/foundations/02-01-installs-and-packages.md)), so only one override runs, but ours won over FS Copilot's against the mount order a search would rely on (same entry).
  A losing Dual Input's panel bridge never loads, so pointer sync and every module a feature names in a panel stop, with no error, and the notification when no cockpit panel connects names another package's `VCockpit.js` as the likeliest cause, without naming the package (same entry).
  Removing that package is the pilot's ([packages that override our files](../install/01-installing-and-updating.md#packages-that-override-our-files)).
  FS Copilot treats YourControls' package as a conflict: its setup won't continue until the pilot removes it, and its app warns "Conflict detected with YourControls package." while YourControls' panel variable is set (read in the FS Copilot fork, `FsCopilot/ViewModels/SetupViewModel.cs` and `FsCopilot/ViewModels/MainViewModel.cs`; user, 2026-10-08).
  Its code doesn't say why they conflict, and both overriding `VCockpit.js` is the likely reason (unverified).

**Not in v1:**

- Code signing, so the installer meets Windows SmartScreen's warning about an unknown publisher; the signing fsc-editor priced was about $10 a month, and flight sim pilots are used to tools that ask more of them (fsc-editor, `docs/pipeline/09-open-questions.md`, "Code signing").
  A pilot whose Smart App Control enforces has to turn it off to run a release of ours that has no positive reputation yet (user, 2026-10-18; [an unsigned v1](../install/01-installing-and-updating.md#an-unsigned-v1)).
- A beta channel, since all of v1 is a beta.
- Pilots on different Dual Input versions flying together.
- A warning, early in the sim's load, that a waiting update will need a sim restart, since Windows' Focus assist turns on by default while a game runs and hides other apps' banners (user, 2026-10-18; [no warning early in the sim's load](../install/01-installing-and-updating.md#no-warning-early-in-the-sims-load)).
- An offer from the desktop app to disable another package, and a rule that makes disabling reversible, which are Later picks (user, 2026-10-18).

**Rules:**

- Pilots on different versions can't join each other's session, and the join check says who is behind and what to do, such as "Adam has a newer Dual Input; close the sim to update".
- When the pilot chooses to quit the desktop app, it asks once, giving Quit and Keep running equal weight, and a choice to turn it off stays off (user, 2026-10-06).

**Depends on:**

- [Preflight](#preflight)'s join step, which runs the version check before it admits a pilot.
