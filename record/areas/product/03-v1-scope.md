# Product: v1 scope

```text
Purpose:     What each v1 feature does, where v1 stops, and the rules for its behavior.
Depends on:  01-aims.md, 02-users.md, and the v1 picks in plan.md
Decides:     The scope of every v1 feature.
```

This document scopes each feature [the plan](plan.md) puts in v1, one section per feature, in the order step 4 gives.
Each section says what the feature does, the cases v1 covers and leaves out, the rules for its behavior, what it depends on, and its open questions.
It says what Crosscheck does, not how: mechanisms are for the architecture, step 7, and screens and wording for a later pass.

The pilot in control is the pilot whose yoke, rudder, toe brakes, engine levers, and trim drive the aircraft.
v1 sessions have two pilots, because crews beyond two are a Later pick.

## Control

### Take-control key

A pilot presses take-control and becomes the pilot in control at once.

**In v1:**

- Taking control from a button in Crosscheck's app or its EFB app, a keyboard shortcut, or a button on the pilot's flight hardware.
- The pilot maps that hardware button in Crosscheck, not in the sim's controls settings, so Crosscheck can tell a long press from a short one.

**Not in v1:**

- A button to give control away.
  The pilot in control gives control only by voice, through the [voice phrases](#voice-phrases).
- Choosing which crew member gets control when the pilot in control drops out, which crews beyond two would need: the copilot's seat, not the flight engineer's.

**Rules:**

- The host is in control when a session starts.
- Any pilot can take control at any time, and it passes at once, without the pilot in control agreeing.
- When two pilots press take-control at nearly the same moment, the earlier press wins, however small the gap.
- Only the pilot in control's yoke, rudder, toe brakes, engine levers, and trim reach the aircraft.
  The engine levers are the throttles, propellers, and mixtures.
- Flaps and gear work from either pilot's hardware at any time.
- When control passes, the pilot who took it hears a recorded "you have control", and the pilot who lost it hears "they have control".
- When the pilot in control's connection drops, control passes to the other pilot, who hears "you have control".

**Depends on:**

- Soft takeover, so the new pilot's levers and trim don't jump the aircraft's to where their hardware sits.
- Holding back the other pilot's hardware: masking holds back the Baron 58P's yoke and throttles (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-masking-stops-a-pilots-hardware-input-and-closing-the-masking-client-gives-it-back)), and its mixtures are a step 6 risk in [the plan](plan.md).

**Open questions:**

- Whether taking control takes a long press, so a pilot can't take it by brushing a button.
- How the machines agree on which of two presses came first, which the architecture settles.

### Voice phrases

The pilot in control offers control by voice, and the other pilot takes it by answering within 5s.

**In v1:**

- An offer is "You have" followed by control, controls, the controls, the flight controls, the aircraft, or the airplane, and an answer is "I have" followed by any of the same.
  Those are the endings regulators, militaries, and airlines use, with "You have …" and "I have …" the shape in every convention we found (documented: [FAA AC 61-115](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40455386&FileExtension=.PDF&FileName=FAA+AC+61_115_Positive+Exchange+of+Flight+Controls-Master.PDF), [Transport Canada TP 975](https://tc.canada.ca/sites/default/files/migrated/tp975e.pdf), [UK MAA RA 2309](https://assets.publishing.service.gov.uk/media/62454dcdd3bf7f32a7c01197/RA2309_Issue_8.pdf), [USAF AFMAN 11-248](https://data.ntsb.gov/Docket/Document/docBLOB?ID=40445920&FileExtension=.PDF&FileName=Operations+-+Attachment+16+-+Excerpts+%E2%80%93+AFMAN+11-248+T-6+General+Flying-Master.PDF), [US Army TC 3-04.51](https://asktop.net/wp/download/5/tc3_04x51.pdf), and Airbus as quoted in [AAIB Bulletin 1/2013](https://assets.publishing.service.gov.uk/media/5423034de5274a1314000b7f/Airbus_A319-111_G-EZFV_01-13.pdf)).
- "Your controls" also offers and "my controls" also answers, though we found them only on a blog (unverified).
- English, recognized as well as the speech model manages with each pilot's accent.
- Crosscheck listens whenever a session is syncing, with no push-to-talk key.

**Not in v1:**

- Taking control by voice without an offer.
  Instructors do it in every convention that covers it, such as the FAA's "I have the flight controls", but the [take-control key](#take-control-key) covers it, and a misheard phrase can't move control.
- "I've got it" and "you've got it", which AOPA warns against because nobody can tell who has the aircraft ([AOPA](https://www.aopa.org/news-and-media/all-news/2023/august/08/training-and-safety-tip-ive-got-it-youve-got-it-whos-got-it)).
- Waiting for the FAA's third call, the offer repeated, which no other convention we found has.
- Languages other than English.

**Rules:**

- Crosscheck hears each pilot only through their own microphone, so it always knows who spoke.
  That's what tells an offer from an answer, since the two differ only in "you" and "I".
- Only the pilot in control's offer counts, and it opens a 5s window.
- The other pilot's answer inside the window passes control, and the endings needn't match: "You have control" answered with "I have the aircraft" passes it.
- Every other phrase does nothing, including an answer outside a window and "I have control" from the pilot already in control.
- When control passes by voice, the pilots hear the same recorded lines as with the take-control key.

**Depends on:**

- The [take-control key](#take-control-key)'s rules for what control covers and what each pilot hears.
- Soft takeover, the same as the take-control key.

**Open questions:**

- Whether recognition is accurate enough with non-native English accents, the first thing to test.
- Whether a phrase counts inside a longer sentence.
  A UK CAA examiner says "follow me through, you have control" ([CAA Standards Document 01(H)](https://www.caa.co.uk/publication/download/13074)), and the same rule would let "you have control of the radios" open a window.
- How Crosscheck tells speech from noise before it listens for a phrase.
  The intent is to run recognition only while the pilot's microphone is loud enough to be speech, and the architecture designs it.
