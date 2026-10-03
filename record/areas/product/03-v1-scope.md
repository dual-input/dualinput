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
  The pilot in control gives control only by voice, through the voice phrases.
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
