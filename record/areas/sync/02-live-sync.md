# Sync: live sync

```text
Purpose:     How a change made in one cockpit reaches every other cockpit while a session runs.
Depends on:  01-profile-entries.md, ../product/03-v1-scope.md (state sync, the connection)
Decides:     What crosses the wire, the order changes apply in, how a conflict resolves, how Crosscheck checks that a write landed, and how it keeps a change from applying twice.
```

A state entry crosses the wire as its new value, and each receiving machine moves its cockpit to that value through the entry's write, then reads it back to check.
Events and pointer presses cross as what happened.
All three travel in one stream, in an order every machine agrees on, so a page key always lands before a press on the page it opened.
When two pilots change one shared entry at once, every machine ends on the same value.

The flying machine is the PF's, and a following machine is any other pilot's.
The entry's write is what the engine does with an entry's `write` field ([01-profile-entries](01-profile-entries.md#writing-a-value)).

## Values, not events

When the PM turns the beacon on, the PM's machine sees `beacon` change in its state object, and sends "beacon is now 1".
The PF's machine writes 1 through the entry's write, whatever the aircraft needs for that, such as a variable, an absolute event, or a compare-then-toggle.

So how the PM changed the beacon doesn't matter: a click, a key binding, and a home cockpit switch all change the same value, and only the value travels.
An entry writes the cause, the variable the aircraft computes the control from, not a readout the aircraft displays, because the aircraft can rebuild the readout from the cause.
On the Baron 58TC and 58P, the behavior XML rewrites `A:GENERAL ENG MIXTURE LEVER POSITION:n` from `L:BKSQ_MixtureLeverPosition_n` at 2 Hz (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so an entry that wrote the stock variable would see its write undone within half a second if the XML runs as read (unverified, the Baron study's sim question 5), and the mixture entry reads and writes the `L:` variable instead.

A read-only entry, one with no `write`, crosses the wire too, and the receiving machine compares it with its own value instead of writing it ([01-profile-entries](01-profile-entries.md#writing-a-value)).

## One stream, in causal order

State changes, events, and pointer presses travel in one stream.
Each message carries a vector clock, one counter per pilot, which tells whether a message was sent after its sender saw another one.
A receiver holds back a message until it has every message that one depended on.

Say pilot A presses a page key, pilot B sees the page open and presses the display, and B's press reaches pilot C before A's key does.
C holds B's press until A's key arrives, then applies the key, then the press.

A stepped write that takes several frames, such as a heading stepped one detent per frame, finishes before the next message in the stream applies, so a later event can't overtake it.
The one exception is a new value for the same entry, which cuts the remaining steps short and steps toward the new value instead.

The flight model travels apart from the stream, from the flying machine to every following machine, and only its newest sample matters.

The architecture, at step 7 of [the plan](../product/plan.md), chooses whether each machine sends to every other directly, which needs a link between every pair of machines, or sends everything through the flying machine.
Links between every pair are the leading candidate, because routing through the flying machine adds a hop between following machines and has to re-form at every handover.

## When two pilots change one entry

Say the battery is shared, and within the network delay, 50ms in this hypothetical, the PF switches it off and the PM switches it on.
Each machine applies its own change at once and then receives the other's, so without a rule the PF's battery ends on and the PM's off, and the two cockpits stay crossed for the rest of the flight.

So each machine keeps, for every state entry, the stamp of the value it holds: the vector clock of the message that set it, the ID of the pilot who made the change, and who was PF at that moment.
A pilot ID is an identifier each pilot's machine has for the session, and step 7 decides its form.
An arriving change to a shared entry applies only if its stamp wins:

- If one change was made after its sender saw the other, the later one wins.
- If neither sender saw the other's change, the change from the flying machine wins, and between two following machines, the one from the lower pilot ID.
- The PF here is whoever was PF when the change was made, which the stamp records, so a handover between a change and its arrival can't make two machines judge one pair differently.

Every machine compares the same two stamps by the same rules, so every machine picks the same winner, whatever order the messages arrived in.
The pilot whose change lost sees their control move back a moment later.
Entries that belong to the PF never conflict, because only the flying machine sends them, and their stamps can order [catch-up](03-catch-up.md#choosing-the-order).

Two pilots firing the same toggle event at once flip it twice and cancel, because an event carries no value to compare, and events stay best effort.

In a session that isn't interrupted, every shared entry ends on the same value on every machine, provided the transport delivers every message, resending what's lost, and every write lands, which the next section checks.

## Checking that a write landed

Every state entry has something to read, so after writing, the receiving machine reads the entry back.

1. It waits 500ms, a starting value, because an aircraft can update the variable an entry reads on a slower loop than the one that takes the write, and step 6 of [the plan](../product/plan.md) measures how long studied aircraft take.
2. If the value doesn't match, it writes again, up to a retry count still to set.
3. If the value still doesn't match, it gives up on that entry and flags it.

A flag does two things, once per entry per flight:

- The recording gets a marker carrying the entry, both machines' values, and the retries, the same kind of marker as the [EFB app](../product/03-v1-scope.md#efb-app)'s button that marks the moment for a [bug report](../product/03-v1-scope.md#recording-and-bug-reports).
- The [notification banner](../product/03-v1-scope.md#notification-banner) shows a notice naming the entry, such as "Couldn't sync the beacon. After your flight, send a bug report from the desktop app."

A retry repeats the entry's write, which is safe for the forms that do only what's left: `set` writes the value again, `toggle` compares before it flips, and `inc` and `dec` step only the remaining difference.
A retry also repeats a `then` action and a write function's actions, so those need to be safe to repeat, such as the L-1011's `H:FUEL`, which the flight engineer's script answers by re-reading the fuel panel's switches (read in inibuilds-aircraft-l1011 1.0.8, [L-1011 study](../aircraft/inibuilds-l1011/study.md)), and that a repeat is harmless is unverified.

Two cases get past the check:

- A shadow value has nothing to read back ([01-profile-entries](01-profile-entries.md#keeping-a-shadow-value)).
- A write that sets the readout but not the cause reads back correctly while the system stays wrong, such as an L-1011 fuel pump switch written without the `H:FUEL` its flight engineer's script listens for (unverified in the sim, the L-1011 study's sim question 1).
  The IDE's two-instance write test catches it ([01-profile-entries](01-profile-entries.md#what-the-ide-does-with-a-profile)).

## Keeping a change from applying twice

A value written twice stays the same, so state entries that read a value can't double-apply.
The risk is confined to events and shadow values: a duplicate fires an event entry's action a second time, and moves a shadow value one step too far.
The engine filters, in this order:

1. **The transport** gives every message an ID, and the receiver applies each ID once, whether it came directly, through the relay, or both, and drops what a reconnecting machine replays that it already applied.
2. **The input event double-fire.**
   On the A2A PA-24, the sim reported each input event twice: of 53 same-name, same-value pairs, 43 were 17ms to 21ms apart, 9 were 37ms to 40ms apart, and the 53rd, a course knob dragged through the same value, was a real repeat 261ms apart (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Stage 2 verified live. The double-fire is frame-locked, and tighter than measured.").
   fsc-editor read the clusters as roughly one and two frames, so the echo looks tied to frames (unverified; the second open question below settles it), and other aircraft are untested.
   So the engine drops a report with the same name and value as one from the last 3 frames, but never one more than 200ms after it, because at a low frame rate 3 frames could reach the 261ms repeat.
3. **Our own writes.**
   For a state entry, an incoming read that equals the value Crosscheck just wrote is its own write.
   For an event, the engine keeps one token for each event it fires, and the next matching occurrence on that machine uses the token up instead of being sent.
   A token that no occurrence uses expires, because an aircraft that masks the event never reports it, and the token would otherwise swallow a pilot's next press.
   A `K:` event uses the same tokens.
   A `K:` event sent with SimConnect's `_EX1` call carries a spare value that reaches every listener and could tag it as ours (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values)), but the legacy call the PMDG 777 needs carries no spare value ([01-profile-entries](01-profile-entries.md#what-a-profile-says-once-per-aircraft)).
4. **One click firing several names**, which the entry's `ignore` covers ([01-profile-entries](01-profile-entries.md#ignoring-a-consequence)).

A pointer press that also changes a state entry applies once too: the stream carries the press before the change it caused, so the receiver replays the press, and the state change then arrives as a value its cockpit already holds.

## Open questions

- Whether held keys repeat a momentary input event faster than the double-fire window: a momentary input event reports 0 every time (measured on MSFS 2024, 2026-09-04, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The `B:` subscription is a change feed; the entry below was wrong"), so if they do, the filter drops the real repeats as echoes.
- Whether the double-fire stays within 3 frames at low frame rates, and on aircraft other than the PA-24 (the PA-24 session's frame rate wasn't recorded).
- Whether SimConnect applies the writes Crosscheck sends within one frame in the order it sent them.
- How long to wait before reading back, how many retries before a flag, and how long an unused echo token lasts.
- How to keep a `then` action or a write function's actions from doing harm when a retry repeats them.

[The plan](../product/plan.md)'s step 6 lists the probes for the first four, except the token's lifetime and aircraft other than the PA-24.
