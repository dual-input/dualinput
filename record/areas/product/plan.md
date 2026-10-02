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

Produces: `02-users.md`.
Exit: each kind of pilot we design for is described, with what they need from a session.

## 3. v1 or later

Produces: the picks below, and the aircraft v1 supports.
Exit: every idea in [ideas](ideas.md) is in a bucket or under Ideas left out, and v1's aircraft are named.
In progress.

An idea goes in one of three buckets:

- **v1:** the first release isn't done without it.
- **Soon:** we're committed to it, and it comes right after v1.
- **Later:** we want it, with no timing.

A pick can carry a condition, such as "v1 if its probe passes".
Where an entry bundles a small core with a bigger extension, such as a take-control key and voice phrases in Voice handover, each part gets its own pick.

v1 has these whatever is picked, because they're the product rather than ideas:

- flight-model sync, which keeps the aircraft's position, attitude, and velocity the same on every machine
- the connection between machines
- profiles, and the profile IDE we write them in

Picks so far:

- **v1:** Crosscheck's controls as an app on the sim's EFB, from [Crosscheck's interface in the EFB and on a tablet](ideas.md#crosschecks-interface-in-the-efb-and-on-a-tablet), because [01-aims](01-aims.md) requires that a pilot in VR can use Crosscheck without taking the headset off.
  The tablet part has no pick yet.
- **v1 if its probe finds a way to hide the other pilot's copy of the aircraft:** [Multiplayer kept on](ideas.md#multiplayer-kept-on).

## 4. v1 scope

Produces: a design doc for v1's features, written with the users from step 2 in mind.
Exit: each v1 feature says what the pilot sees and does, including installing Crosscheck, updating it, and connecting through home routers.

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
- Whether SimConnect lists the other pilot's aircraft in a multiplayer session, and whether anything can hide it ([Multiplayer kept on](ideas.md#multiplayer-kept-on)).

Steps 4 and 5 add to this list as they find risks.

## 7. Tech stack and architecture

Produces: decisions in `record/decisions/`.
Exit: the language, the frameworks, and the core architecture each have a decision.

## 8. v1 build plan

Produces: a plan with build stages, in the areas the architecture names.
Exit: everything v1 includes, the picks and the three parts step 3 lists, is in a stage with its own exit criterion.

## 9. Build, test, and release v1

Exit: both of these happen.

- We fly a full flight with a friend, gate to gate, in an aircraft we list, and neither pilot notices the cockpits disagree.
- A friend who has never used Crosscheck installs it and flies with us without our help.

## 10. After v1

What follows v1 gets decided once v1 ships.
