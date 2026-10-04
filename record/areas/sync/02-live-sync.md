# Sync: live sync

```text
Purpose:     How a change made in one cockpit reaches every other cockpit while a session runs.
Depends on:  01-profile-entries.md, ../product/03-v1-scope.md (state sync, the connection)
Decides:     What crosses the wire, the order changes apply in, how a conflict resolves, how Crosscheck checks that a write landed, and how it keeps a change from applying twice.
```

A state entry crosses the wire as its new value, and each receiving machine's own writer moves its cockpit to that value, then reads it back to check.
Events and pointer presses cross as what happened.
All three travel in one stream, in an order every machine agrees on, so a page key always lands before a press on the page it opened.
When two pilots change one shared entry at once, every machine ends on the same value.

## Values, not events

When the PM turns the beacon on, the PM's machine sees `beacon` change in its state, and sends "beacon is now 1".
The PF's machine writes 1 through the entry's writer, whatever the aircraft needs for that, such as a variable, an absolute event, or a compare-then-toggle ([01-profile-entries](01-profile-entries.md#writing-a-value)).

So how the PM changed the beacon doesn't matter: a click, a key binding, and a home cockpit switch all change the same value, and only the value travels.
The writer reproduces the cause of the value, because an aircraft may rebuild the readout from it.
The Baron's module rewrites `A:GENERAL ENG MIXTURE LEVER POSITION:n` from `L:BKSQ_MixtureLeverPosition_n` at 2 Hz (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so an entry that wrote the stock variable would see its write undone within half a second, and the mixture entry reads and writes the `L:` variable instead.

## One stream, in causal order

State changes, events, and pointer presses travel in one stream.
Each message carries a vector clock, one counter per pilot, which tells whether a message was sent after its sender saw another one.
A receiver holds back a message until it has every message that one depended on.

Say pilot A presses a page key, pilot B sees the page open and presses the display, and B's press reaches pilot C before A's key does.
C holds B's press until A's key arrives, then applies the key, then the press.

A stepped write that takes several frames, such as a heading caught up one step per frame, finishes before the next message in the stream applies, so a later event can't overtake it.

The flight model travels apart from the stream, from the flying machine to every follower, and only its newest sample matters.

Whether each machine sends to every other directly, which needs a link between every pair of machines, or everything goes through the flying machine's, is the architecture's choice ([the plan](../product/plan.md), step 7).
A link between every pair is the leading candidate, because routing through the flying machine adds a hop between followers and has to re-form at every handover.

## When two pilots change one entry

Say the battery is shared, and within the network delay, about 50ms, the PF switches it off and the PM switches it on.
Each machine applies its own change at once and then receives the other's, so without a rule the PF's battery ends on and the PM's off, and the two cockpits stay crossed for the rest of the flight.

So each machine keeps, for every shared entry, the stamp of the value it holds, and applies an arriving change only if it wins:

- If one change was made after its sender saw the other, the later one wins.
- If neither sender saw the other's change, the PF's wins, and between two followers, the lower pilot ID.
- The PF here is whoever was PF when the change was made, which the stamp records, so a handover between a change and its arrival can't make two machines judge one pair differently.

Every machine compares the same two stamps by the same rules, so every machine picks the same winner, whatever order the messages arrived in.
The pilot whose change lost sees their control move back a moment later.
Entries that belong to the PF never conflict, because only the flying machine sends them.

Two pilots firing the same toggle event at once flip it twice and cancel, because an event carries no value to compare, and events stay best effort.

In a session that isn't interrupted, every shared entry ends on the same value on every machine, provided the transport delivers every message, resending what's lost, and every write lands, which the next section checks.

## Checking that a write landed

Every state entry has something to read, so after writing, the receiving machine reads the entry back.

1. It waits at least about 500ms, because some aircraft apply a write on a slower loop, such as the Baron's 2 Hz mixture block.
2. If the value doesn't match, it writes again, a few times.
3. If the value still doesn't match, it gives up on that entry and flags it.

A flag does two things, once per entry per flight:

- The recording gets a marker carrying the entry, both machines' values, and the retries, the same kind of marker as the [EFB app](../product/03-v1-scope.md#efb-app)'s button that marks the moment for a [bug report](../product/03-v1-scope.md#recording-and-bug-reports).
- The [notification banner](../product/03-v1-scope.md#notification-banner) shows a notice naming the entry, such as "Couldn't sync the APU bleed. Please send a bug report after your flight."

A retry is safe, because each writer does only what's left: `toggle` compares before it flips, and `inc` and `dec` step only the remaining difference.

Two cases get past the check:

- A shadow value has nothing to read back, which is why shadows are the last resort.
- A writer that sets the readout but not the cause reads back correctly while the system stays wrong, such as a fuel pump switch written without the `H:FUEL` its pump needs.
  The IDE's two-instance write test catches it ([01-profile-entries](01-profile-entries.md#what-the-ide-does-with-a-profile)).

## Keeping a change from applying twice

A value written twice stays the same, so state entries that read a value can't double-apply.
The risk is confined to events and shadow values, because both count.
The engine filters, in this order:

1. **The transport** gives every message an ID and applies it once, whether it came directly, through the relay, or both, and numbers what a reconnecting machine replays so the receiver drops what it already applied.
2. **The input event double-fire.**
   The sim reports every input event twice: across 53 same-name, same-value pairs on the A2A PA-24, 43 were 17ms to 21ms apart and 9 were 37ms to 40ms apart, one and two frames at about 60 fps, while the nearest real repeat, a course knob dragged through the same value, was 261ms apart (measured on MSFS 2024, 2026-08-23, fsc-editor, `docs/sim-vars/build/v1-log.md`, "Stage 2 verified live. The double-fire is frame-locked, and tighter than measured.").
   The engine drops a report with the same name and value as one from the last 3 frames, and never one more than about 200ms later, because the echo is tied to frames and 3 frames at a low frame rate would otherwise reach the 261ms repeat.
3. **Our own writes.**
   For a state entry, an incoming read that equals the value Crosscheck just wrote is its own write.
   For an event, the engine keeps one token for each event it fires, and the next matching occurrence on that machine uses the token up instead of being sent.
   A token that no occurrence uses expires after a short window, because an aircraft that masks the event never reports it, and the token would otherwise swallow a pilot's next press.
   `K:` events get no other path, though a `K:` event sent with SimConnect's `_EX1` call carries a spare value that reaches every listener and could tag it (measured on MSFS 2024, 2026-10-01, [flight-controls log](../flight-controls/log.md#2026-10-01-a-value-sent-back-at-10000001-reached-our-own-masking-group-and-the-777-ignored-re-sent-values)), because the legacy call some aircraft need carries no spare value ([01-profile-entries](01-profile-entries.md#what-a-profile-says-once-per-aircraft)).
4. **One click firing several names**, which the entry's `ignore` covers ([01-profile-entries](01-profile-entries.md#ignoring-a-consequence)).

A pointer press that also changes a state entry applies once too: the stream carries the press before the change it caused, so the receiver replays the press, and the state change then arrives as a value its cockpit already holds.

## Open questions

- Whether a held key bound to a momentary input event repeats it faster than the double-fire window, which would drop real repeats, because a momentary input event reports 0 every time (measured on MSFS 2024, 2026-09-04, fsc-editor, `docs/sim-vars/build/v1-log.md`, "The `B:` subscription is a change feed; the entry below was wrong").
- Whether the double-fire stays within 3 frames at frame rates well below 60 fps.
- Whether SimConnect applies the writes Crosscheck sends within one frame in the order it sent them.
- How long to wait before reading back, and how many retries before a flag, which real aircraft decide.

[The plan](../product/plan.md)'s step 6 lists the probes that answer these.
