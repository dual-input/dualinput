# 004: The core works out where the figure's hand goes

On the clicking pilot's machine, the core reads the aircraft's models, the camera, and the cursor, and finds each hand's point.
Decided by the user on 2026-10-07, in node 1.1 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-works-out-where-the-figures-hand-goes).

## Context

Each pilot sees the other as a figure of Dual Input's own, and a hand goes where the pilot clicks or drags, found from the aircraft's own model ([avatar sync](../areas/product/03-v1-scope.md#avatar-sync)).
The avatars' tentative decisions settle how: at each click, Dual Input casts a ray from the pilot's eye through the cursor into the aircraft's own model, and the hand goes to the point the ray meets ([avatars decisions](../areas/avatars/decisions.md#the-hand-goes-where-the-pilot-clicks-found-from-the-aircrafts-geometry)).
The clicking pilot's machine finds the point, and the other machine receives it, relative to the aircraft, and its WASM module places the figure there every frame ([avatars decisions](../areas/avatars/decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it)).
So one component on the clicking pilot's machine reads the models, the camera, and the cursor, and node 1.1 had to name it.

## Options

1. **The desktop app, as the avatars' tentative decision first gave it.**
   The desktop app and the EFB app show Dual Input's state and send it commands, and decide nothing ([04-room-for-later](../areas/product/04-room-for-later.md#one-protocol-for-every-client)).
   The desktop app is also optional, so a hand worked out there would stop whenever the pilot closes it.
2. **The core.**
   It reads the cursor from outside the sim, as our avatar probes read the pilot's mouse through Windows' Raw Input in sink mode, which sits in nobody's input path ([mouse.mjs](../../experiments/tools/mouse.mjs)).

## Decision

Option 2.
The core runs whether or not the desktop app is open ([decision 002](002-core-starts-with-every-sim-run.md)), so the hand doesn't stop when the pilot closes a window, and the desktop app stays a client that decides nothing.
This changes the avatars' tentative decision, which gave the job to the desktop app.

## What it commits us to

- The core's helper reads the mouse through Raw Input for it, with the keyboard and flight hardware ([01-spine](../areas/architecture/01-spine.md#components); [decision 019](019-input-and-audio-run-in-helper.md)).
  So a crash in the helper costs the figure's hand until the core restarts it ([01-spine](../areas/architecture/01-spine.md#the-helper)).
- The helper reads the cursor only in a session ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
- The ray, the models, and the hands' habits follow the avatars' tentative decisions until avatar sync's design confirms, changes, or drops each one ([avatars decisions](../areas/avatars/decisions.md)).
