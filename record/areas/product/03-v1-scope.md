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
v1 sessions have two pilots, because crews beyond two are a Later pick.

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
