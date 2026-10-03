# Product: v1 scope

```text
Purpose:     What each v1 feature does, where v1 stops, and the rules for its behavior.
Depends on:  01-aims.md, 02-users.md, and the v1 picks in plan.md
Decides:     The scope of every v1 feature.
```

This document scopes each feature [the plan](plan.md) puts in v1, one section per feature, in the order step 4 gives.
Each section says what the feature does, the cases v1 covers and leaves out, the rules for its behavior, what it depends on, and its open questions.
It says what Crosscheck does, not how: mechanisms are for the architecture, step 7, and screens and wording for a later pass.

The pilot flying (PF) is the pilot whose yoke, rudder, toe brakes, engine levers, and trim fly the aircraft, and the pilot monitoring (PM) is the other front-seat pilot.
The flying machine is the PF's, and the following machine is the PM's.
v1 sessions have two pilots, because crews beyond two are a Later pick, but the design supports larger crews from the start, unless that costs much more work, so nothing gets rebuilt when they come.

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

**Not in v1:**

- Telling pilots what on their aircraft doesn't sync, a Later pick in [the plan](plan.md), because we first learn what Crosscheck can sync.
- Detecting and correcting cockpits that drift apart, because Crosscheck can't reliably read the state of most aircraft ([Ideas left out](ideas.md#ideas-left-out)).
- The pilot's own MSFS EFB overlay.

**Rules:**

- The profile marks which of its entries belong to the PF: the aircraft's flight controls, toe brakes, engine levers, and trim, the categories the [take-control key](#take-control-key) names.
  Those reach the following machine from the flying machine.
  Everything else in the profile is shared: either pilot can change it, and the other cockpit follows.
- When both pilots change the same thing at nearly the same moment, the flying machine decides which change stands, and both cockpits end in that state.
- Crosscheck sends every change a pilot makes, and never a change it applied itself.
  The PM turns the beacon on, Crosscheck sets it on the PF's machine, and the PF's sim reports that the beacon changed: Crosscheck doesn't send that report back.
  If the PF turns the beacon off half a second later, that change goes through, where a guard that ignores reports for a while after each write would drop it, as one dropped two real pilot inputs in our FS Copilot work ([08-02](../../learn/foundations/08-02-echoes-and-initial-sync.md#echo-loops-and-suppressing-them)).
- A change the aircraft makes on its own syncs like a pilot's, such as the Baron taking its chocks away once it moves.

**Depends on:**

- Profiles, which name what syncs, how each entry is set, and which entries belong to the PF.
- The [take-control key](#take-control-key), for which machine is flying.

**Open questions:**

- Joining or reconnecting mid-flight.
  A machine can take the flying machine's state only for entries with an absolute setter, since an increment sent at connect changes nothing useful, so the profile format answers it.
- How Crosscheck recognizes its own writes on each channel, which the architecture settles.
  A `K:` event can carry a tag in its spare fifth value, which reaches every listener (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values)), while a variable write carries only the value.

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
- A replayed press does what the pilot meant only when both displays show the same page, and Crosscheck doesn't check that they do, for the reason state sync doesn't detect drift.
- During a long outage, the following pilot's synced displays lock, and taking control unlocks them (measured on a two-instance bench, 2026-09-12, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "Q12 is survivable and it is not a two-pilot special case").

**Depends on:**

- Profiles, which name the displays.
  A display's identifier can carry the livery, as the A220's `DisplayUnits|config=N324DU` does, so matching it is the profile format's job and comparing liveries is the [preflight match check](ideas.md#preflight-match-check)'s (measured on MSFS 2024, 2026-09-17, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "The A220's DisplayUnits key carries the livery, and the profile names only Default").

**Open questions:**

- When both pilots type on one display at once, each machine may apply the keys in a different order (unverified, [08-06](../../learn/foundations/08-06-divergence-and-one-screen.md#unverified-claims)).
- A display press that also changes a value state sync sends could apply twice, flipping a toggle back; we deal with it if a profile runs into it.

## Session

### Invite code

The host starts a session and gets a code, and the other pilot enters it to join.

**In v1:**

- The code is six characters from the 30-character alphabet fsc-editor uses, which leaves out I, L, O, U, 0, and 1, because codes are read aloud and typed by someone looking at a sim (read in fsc-editor, `src/shared/remote-connect.ts`, `CODE_ALPHABET`, and `docs/remote-connect.md`, "The code").
- When the pilot selects the box for the code, Crosscheck fills it from the clipboard if the clipboard holds a code, and joins at once.
- The code lasts until the host ends the session, and a pilot who dropped out rejoins with the same code.

**Not in v1:**

- Invite links, because Discord shows a `crosscheck://` link as plain text and an https redirect adds two prompts ([One-click invite](ideas.md#one-click-invite)).
- Permanent codes, handed out first come, first served, a Later pick in [the plan](plan.md).
- Reading the clipboard at any other moment.
- Host approval of each joiner.

**Rules:**

- The code alone admits a pilot, as it does in fsc-editor, where the relay limits how fast one address can guess codes and the host sees how many peers are connected (read in fsc-editor, `docs/remote-connect.md`, "The code").
  It's a game among friends, and confirming each joiner would get in the way.
- The host always sees who's in the crew.

**Depends on:**

- The connection between machines, which carries the code to the host's session.

**Open questions:**

- Whether the EFB app can fill its box from the clipboard: the EFB runs inside the sim's panel, so Crosscheck's own app would read the clipboard when the EFB's box is selected (unverified).
- Whether the profile IDE joins through the same session and code, making the Crosscheck session the editing session too, or the session points the IDE at a server of its own; either way has consequences for the relay and the protocol, settled later.
