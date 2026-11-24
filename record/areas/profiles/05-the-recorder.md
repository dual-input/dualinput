# Profiles: the recorder

```text
Purpose:     The recorder, which records what an author does in the cockpit and plays it back into the same cockpit as a crewmate's changes, and the platform unit `tape` behind it.
Depends on:  04-the-extension-in-the-sim.md, 02-units.md, ../sync/05-units.md, ../sync/04-order-and-recovery.md, ../flight-model/01-flight-model-sync.md, ../architecture/02-code-map.md, ../core/02-clients-and-panel-bridge.md
Decides:     What a recording holds and how long it's kept; how playback puts the cockpit and the aircraft back and applies what was recorded; how the aircraft flies the recorded path; when the recorder works; the platform unit `tape` and what the cockpit stream gains for it; the recorder's island in the Dual Input panel; and the budgets, known limits, and cases (stage 22h).
```

The recorder lets one author on one PC see what a crewmate's changes do in their cockpit.
You press Record and work the cockpit, press Stop, and press Play: Dual Input puts the cockpit back as it was when you pressed Record, then plays each change you made into it as if a crewmate had sent it, at the pace you made it.
The aircraft goes back to where it stood at Record too, and flies the path you flew.
Each change takes the route a crewmate's takes, through the cockpit stream and state sync's own handlers, and the path takes flight-model sync's `Follow`, so what you see is what a crewmate sees on their PC in a real flight.
The recorder sits in an island of its own at the bottom of the Dual Input panel, and the platform unit `tape` holds the recording.

The user designed it with us on 2026-11-23, a call at a time, and its flight-model replay on 2026-11-24, and the reasons below are the ones that decided each part.

## What an author does

1. Host a session from the EFB app, alone, in an aircraft your profile covers, and fly past Ready, as you would to use Run ([in a session](04-the-extension-in-the-sim.md#in-a-session)).
2. In VS Code, save the profile, so the session flies what you've written.
   While the open text differs from the bundle the session pinned, the recorder asks you to save first.
3. Press Record in the recorder's island, work the cockpit, and press Stop.
   The island shows the recording's length.
4. Change the profile if you want, save it, and wait for the session to reload it, as a test session reloads every save ([test sessions](02-units.md#test-sessions)).
5. Press Play.
   The cockpit and the aircraft go back to where they were when you pressed Record, and then your changes play into the cockpit, the profile's writes running on each as they would for a crewmate's, while the aircraft flies your path.
   The aircraft flies the recording until the playback ends, so your controls move nothing until then.

## What a recording holds

- Every cockpit message of a recorded kind that the cockpit stream sends from Record to Stop: its kind, its key, its body, and its time since Record.
  State sync's three kinds, `CHANGE`, `PF_CHANGE`, and `FIRED`, and pointer sync's `GESTURE` are the recorded ones, each marked with an option of its own at registration (user, 2026-11-23 and 2026-11-24).
- Each catch-up step's payload as you press Record, which is what a late joiner would get from you then: state sync's gives each entry's value and stamp, in the order the cockpit took them ([catch-up's order](../sync/05-units.md#catch-ups-order)).
- Each flight-model sample this machine sends from Record to Stop, about 20 a second, with its time since Record: the aircraft's pose, velocities, control surfaces, and toe brakes, as [the sample](../flight-model/01-flight-model-sync.md#the-sample) has them (user, 2026-11-24).
  Samples travel on a channel of their own, `SAMPLES`, rather than the cockpit stream, so flight-model sync hands each to `tape` as it sends it ([flying the recorded path](#flying-the-recorded-path)).

Alone in a session, the stream still makes every message: it sends each to an empty crew and keeps none (read in `src/platform/cockpit-stream/src/lib.rs`, `send_message`).
So a recording holds what a crewmate would have received, in the stream's order: each entry's newest value at most 20 times a second, and any value the stream was holding sent ahead of the event after it ([the cockpit stream](../sync/04-order-and-recovery.md#the-cockpit-stream)).
It holds the stream's messages rather than the sim's readings, since a reading means nothing until state sync turns it into an entry's change, and the core's replay log holds only readings, keyed by handles its earlier calls set up ([why it records every input](../recording/01-recording-and-bug-reports.md#why-it-records-every-input)).

There's one recording, kept until the next Record or the session's end (user, 2026-11-23).
Saving recordings can come later, if authors need it.

## Playback

1. **Putting back.**
   The cockpit stream takes the recording's catch-up as a late joiner takes one, from a pretend sender, so state sync writes each entry the cockpit doesn't already match, at its value from Record, in catch-up's order (user, 2026-11-23).
   A counting entry steps back to its shadow value from Record, as catch-up steps one, and an event entry has nothing to put back.
   As Play is pressed, flight-model sync starts `Follow` with the recording's first sample, so the aircraft goes back at once to where it stood at Record, and stays frozen there while the cockpit is put back ([flying the recorded path](#flying-the-recorded-path); user, 2026-11-24).
2. **Playing.**
   Once the playback's catch-up has ended, every step's writes made and the aircraft settled, which the stream raises as the moment `PretendCaughtUp`, each recorded message arrives from the pretend sender at its recorded time, counted from then, and the stream applies it as it applies a crewmate's (user, 2026-11-23).
   Each recorded sample goes to `Follow` at its recorded time, counted from the same moment, so the aircraft flies the recorded path 400ms behind the played changes, as a crewmate's PC draws it ([drawing](../flight-model/01-flight-model-sync.md#drawing)).
   It waits for the catch-up's end rather than its writes, since pointer sync skips every gesture that comes during a catch-up but preflight's end's (read in `src/features/pointer-sync/core/src/lib.rs`, `play`), and alone in a session the aircraft has long settled, so the wait costs nothing.
   A stepping write holds every later message until its last step, unless a new value for the same entry arrives and cuts the steps short.
   Each message then waits what's left of its recorded gap, counted from when the message before it applied, as [applying](../sync/05-units.md#applying) has it.
   State sync's own waits hold too, such as a toggle's behind another entry's pending value ([sync's units](../sync/05-units.md)' note of stage 14c).

`tape` hands each message to the stream at its recorded time, because the stream caps a message's wait at 2s (read in `src/platform/cockpit-stream/src/order.rs`, `GAP_CAP`): handed over all at once, a 10s pause between two changes would play as 2s.
Handed over on time, a recorded message 10s after the last arrives 10s later, as a crewmate's does.

Putting the whole cockpit back, rather than only the entries the recording changed, is what makes a second Play match the first, since a write function reads `state`, and a switch you moved after Stop would change what it does.
Catch-up's payload is state sync's own, so the stream can't take entries out of it, and catch-up already writes nothing that matches.

### The pretend sender

- The pretend sender is one origin for the whole session, a pilot ID no member holds, and each Play's messages number on from the last of its messages that applied.
  So this machine's clock gains one counter however often you Play, and a crewmate who joins later gets that one counter on every message, not one for each Play.
- Each message's clock is this machine's clock as the stream hands it to its kind's handler, with the pretend sender's counter set to its number, so it follows every change this cockpit made before it applied, and wins the conflict rule as a newer change does ([the conflict rule](../sync/05-units.md#the-conflict-rule)).
  That includes this machine's own changes during playback, such as the target an autopilot sets as a played mode engages, which this machine sends as its own ([sync's units](../sync/05-units.md)' note of the first flight with friends).
  Against such a change, a clock from Play would leave the two concurrent, and the conflict rule's tie-break, which favors the PF's stamp, would skip the target played after it (read in `src/engines/messages/src/sync.rs`, `Stamp::wins`).
- Each message carries the session's control value at Play, as a crewmate's carries the one it was made under.
- The stream says nothing in the banner while it takes the recording's catch-up, since the island shows it and the author pressed Play; the banner would otherwise say "Catching up with a pilot", naming nobody in the session.
- Stop counts a message still stepping as applied at once, rather than when its last step lands, so a crewmate who joins after Stop takes a clock that covers every pretend message, and never waits for one.

### Flying the recorded path

A playback is a second reason for flight-model sync to run `Follow`, beside another pilot holding control, so the aircraft flies the recording while control stays with the author (user, 2026-11-24).
The user chose it over a pretend pilot holding control through the playback, so the session and the apps never show a pilot who isn't there.

| Routine | Runs while |
| --- | --- |
| `Lead` | This pilot holds control and is in the flight, and no playback runs |
| `Follow` | This pilot is in the flight, and another pilot holds control or a playback runs, from Play to the playback's end or its stop |

- While `Lead` runs and a recording runs, flight-model sync hands `tape` each sample it sends, including the last sample it sends again every 50ms while the sim is paused, so a sim pause during the recording plays back as the aircraft standing still ([the flying machine](../flight-model/01-flight-model-sync.md#the-flying-machine)).
- At Play, flight-model sync starts `Follow` on the recording's first sample, stamped 450ms before now: the 400ms delay, plus one 50ms period, since the first frame's time is at least now, often exactly, and `Follow` draws only from a sample strictly older than its time less the delay (read in `src/features/flight-model/core/src/lib.rs`, `put_back`).
  So `Follow`'s first frame that places the aircraft finds the sample already old enough, and writes it at once however far away the aircraft stands, since `Follow` has written no earlier pose to ease from (read in `src/features/flight-model/routines/src/follow.rs`, `Follow::frame`).
  With that one sample, `Follow` holds the aircraft there, frozen, until the samples after it arrive.
- Each sample `tape` hands back carries the playback's `shift`, the µs from Record to `PretendCaughtUp`, and flight-model sync feeds it to `Follow` with its stamp moved on by `shift`.
  The samples came from this machine, so their stamps are on this core's counter already, and take no clock offset.
- When the playback ends at the recording's length, or stops, flight-model sync ends `Follow` and starts `Lead`, and the aircraft flies on from the velocities `Follow` last wrote, as a pilot's aircraft does when they take control ([the code map's cases](../architecture/02-code-map.md#cases-for-the-bench-for-work-in-the-sim)).

### When the recorder works

Record and Play work only alone in a session's flight, after preflight, once every catch-up step is ready, and with the open text saved (user, 2026-11-23).
Otherwise the island's buttons are off, with a line that says why.

| What's off | Why |
| --- | --- |
| With a crew | The pretend sender's counter enters this machine's clock, which every message it sends carries, and a crewmate's stream would wait for the pretend messages, which never reach it (read in `src/platform/cockpit-stream/src/order.rs`, `next`'s `depends`) |
| Outside a session's flight, or before preflight ends | The stream sends nothing then ([sending](../sync/05-units.md#sending)), so there's nothing to record or to apply |
| Before every catch-up step is ready | State sync's step turns ready 1.5s after its profile loads, and a payload before then holds no values ([sync's units](../sync/05-units.md)' note) |
| With the open text unsaved | Playback runs the bundle the session pinned, not the open text |

`serve` already holds the open text's bundle and the pinned bundle's hash, and compares them for the panel's notice only with a crew (read in `tools/profile-builder/src/serve/sim.rs`, `panel_view`); the recorder's check makes the same comparison alone.

- A member joining stops what's running, as Stop does, and a recording keeps what it had.
- The profile's unload stops what's running the same way, since messages played between an unload and the next load would be skipped, and a recording would miss what changed meanwhile.
  A save's reload, leaving the flight, and the session's end each unload the profile first ([loading](02-units.md#loading)).
- When a member's joining or the profile's unload stops what's running, the island says why until your next press, as "Recording stopped because you saved", so an author learns the rule (user, 2026-11-24).
  A save keeps the recording, so an author can change a write function, save, and play the same recording again (user, 2026-11-24).
- Stop during playback drops every recorded message still waiting, and ends a putting back that's still running; a write state sync has already taken on still goes, such as a knob's steps, and a toggle state sync holds behind them (measured on the bench, 2026-11-24, the scenario `tape`).

## The recorder's island

The Dual Input panel is a surface of islands in its one webview, laid out as we choose, rather than one VS Code view for each tool, since switching views from a menu is cumbersome (user, 2026-11-23).
The status island holds the status line with Run or the picker, and the recorder's island sits below it, about the size of a cassette, and stays in view while you Run (user, 2026-11-23).
Hiding and showing islands can come later.

- Record, Stop, and Play side by side, as on a tape deck, with a readout of the time: recording so far, the recording's length, or how far playback has got (user, 2026-11-23).
- A button that can't act now is off, from [when the recorder works](#when-the-recorder-works).
- A line above the buttons says only what the buttons and the readout can't, and the status island doesn't already: that the cockpit is being restored, why a recording or playback stopped, or that the recorder needs you alone, the profile saved, or Ready pressed (user, 2026-11-24).
  The status island says "In a flight" from the flight's start, before preflight ends, so the island says that the recorder waits for Ready.
  Outside a flight the status island says why, and a profile's load passes in seconds, so neither gets a line of the recorder's.
- Its states: nothing recorded, recording, recorded, putting back, playing, and off.

Its words, its layout, and its look come from a draft built whole and refined by eye with the user, on the panel's dev page, `profile-panel` in `tools/lib/dev-pages.ts`, as the panel's were ([the Dual Input panel](04-the-extension-in-the-sim.md#the-dual-input-panel)).

## How it works

| Part | Where | What it holds |
| --- | --- | --- |
| `tape` | `src/platform/tape`, in the core, on a line of its own above the platform's top line, since it uses `cockpit-stream` | The recording, its timer for each message's and sample's arrival, the commands `tape.record`, `tape.stop`, and `tape.play`, the guards of [when the recorder works](#when-the-recorder-works) that the core can see, and the slice `tape`: the state, its times, and why it last stopped |
| `cockpit-stream` | `src/platform/cockpit-stream` | Recorded kinds, a catch-up step's payloads on request, and the pretend sender: a catch-up taken from it, its messages put in the inbox, and its messages dropped |
| `flight-model` | `src/features/flight-model/core` | Its samples handed to `tape` while a recording runs, and `Follow` from Play to the playback's end, fed the recording's samples |
| `serve` | `tools/profile-builder` | The island's view, from the slice `tape` and the saved check, and the three commands |
| The extension | `src/apps/profile-extension` | The island, with its dev page states |

`tape` is a unit of its own rather than part of `authoring`, since no feature depends on another's code ([the code map](../architecture/02-code-map.md#tiers)), so a recorder inside `authoring` could never record pointer sync's gestures (user, 2026-11-23).
It's named `tape` because the core's `recording` unit is the replay log, and "playback" already names the core helper's audio streams ([the code map](../architecture/02-code-map.md#the-platform)).
It takes its commands from any client, without the release check `authoring` makes, since `serve`, their one sender, sends nothing while its release and the core's differ ([the connection](04-the-extension-in-the-sim.md#the-connection)).

### What the cockpit stream gains

```rust
// a sketch
me.cockpit_kind(state_sync::CHANGE, StateSync::apply).hold_newest().recorded();   // `tape` hears what it sends

pub struct CockpitSent { /* as it is, */ pub recorded: bool, pub body: Vec<u8> }
pub struct PretendCaughtUp;   // raised once the pretend sender's catch-up has ended

let ready = cx.read::<CockpitStream>().steps_ready();             // whether every catch-up step can give and take, for the guards
let payloads = cx.read::<CockpitStream>().payloads(&cx.view());   // each catch-up step's payload now, as `answer` makes them
cx.cockpit().pretend(payloads);         // a Play from the pretend sender, whose catch-up the stream takes at once
cx.cockpit().arrive(kind, key, body);   // the pretend sender's next message, into the inbox
cx.cockpit().stop_pretending();         // drops its waiting messages, counts one still stepping as applied, and ends its catch-up
```

- `CockpitSent` already carries each message of a feature's kind the stream sends, for avatars, and gains its body and whether its kind is recorded, so `tape` reads no state of the stream's.
- `payloads` is a read, as a handler reads another unit's state, so `tape` has the payload in the same handler that takes Record, and `answer` makes a catch-up's from the same function.
- The stream holds the session's one pretend sender, so `arrive` and `stop_pretending` name none.
- The pretend sender's catch-up runs as [catch-up](../sync/05-units.md#catch-up) has a taken one run: each step gets its payload, the inbox applies on top once every step's writes are made, and the catch-up ends once every step is done.
  It takes no clock from the payload, since the pretend sender's messages carry their own.
- Only `tape` calls these, and only alone, by its guards; it stops what's running on `MemberJoined`, which the session crate raises as the member's first message passes, before that member can ask for a catch-up.

### What a feature registers with `tape`

```rust
// a sketch
me.taped(flight_model::SAMPLES, FlightModel::played);   // a channel of the feature's that `tape` records and plays back
cx.tape().take(flight_model::SAMPLES, &sample);          // while a recording runs, `tape` keeps it with its time since Record

let playing = cx.read::<Tape>().playing();                  // from Play to the playback's end or stop
let first = cx.read::<Tape>().first(flight_model::SAMPLES); // the recording's first sample, for putting the aircraft back

pub struct PlaybackChanged;                              // raised as a playback starts, ends, or stops
pub struct Played<B> { pub body: B, pub shift: u64 }    // shift: µs from Record to the moment the playback's messages start
```

- A feature registers a channel of its own whose messages it sends outside the cockpit stream, as a cockpit kind marks itself recorded, so `tape` names no feature, and a feature that registers nothing never hears of the recorder.
- `tape` files each registered channel under its number, and keeps the channel's messages as postcard bytes in the order they came, timed from Record as the cockpit stream's messages are, so a playback hands out both on one timeline.
- `playing` is `tape`'s own state, read where the feature decides what to run, so the feature keeps no copy of it, and `PlaybackChanged` tells it when to read again.

## Budgets

Each is a starting value:

- **Putting back:** a catch-up's, which state sync's budgets set ([sync's units](../sync/05-units.md#budgets)).
- **A message's arrival:** within 20ms of its recorded time, on a timer of the loop's, a sample's included.
- **A recording's size:** a lever moved for an hour without a pause makes 72,000 messages at 20 a second, and flight-model sync's samples make 72,000 more, each under 90 bytes in postcard ([the sample](../flight-model/01-flight-model-sync.md#the-sample)), about 6.5 MB of samples an hour (arithmetic), so a recording needs no cap; what a message costs in memory is the stage's to measure.

## Known limits

- Playback runs the saved profile, and the recorder works alone in a session only ([when the recorder works](#when-the-recorder-works)).
- Play puts back every entry, so a switch you moved after Stop goes back too ([playback](#playback)).
- Restoring is best effort, so a playback can start from a cockpit that differs from the recording's start in ways the island doesn't show (user, 2026-11-24).
  It's a late joiner's catch-up, which writes the profile's synced state entries at their values from Record and nothing else: not what the profile doesn't cover, such as an avionics page, an FMS entry, or a system the aircraft runs itself, which catch-up's own notification warns of as "Pages and FMS entries may still differ" (read in `src/platform/cockpit-stream/src/lib.rs`, `say_catching_up`).
  It also leaves a watch-only entry as it stands, and a write the aircraft refuses; an event entry's effect has no value to restore; and a counting entry after a save is the limit below.
- A save between Record and Play reloads the profile, which starts each counting entry's shadow value at its `default`, so putting back steps the entry's control from its `default` rather than from where it stands, the limit a test session's reload already has ([test sessions](02-units.md#test-sessions)); the 58P's profile has no counting entry.
  The island says nothing of it, so that a save's one rule, which stops what's running and keeps the recording, is all an author learns (user, 2026-11-24).
- A recording lasts until the next Record or the session's end, and a VS Code reload keeps it, since `tape` doesn't watch the extension's connection.
- A notification of state sync's about a played change that never landed names "A pilot" as the sender, since `Session::name_of` knows no pretend sender (read in `src/features/state-sync/core/src/notices.rs`, `whose`).
- A recorded press plays on whatever page its display shows then, since nothing catches up a display, and the island says nothing of it, since an author learns that pointer sync replays presses alone (user, 2026-11-24).
- Putting the aircraft back takes its pose, velocities, and controls from the recording's first sample, and nothing else: fuel, whether the engines run, and anything else neither the sample nor the profile covers stay as they stand at Play (user, 2026-11-24).
- While a playback runs, the author's controls move nothing, and when it ends, the aircraft flies on with them wherever the author's hands hold them, as after a take-control.
  An autopilot engaged while `Follow` holds the aircraft winds up, and can roll the aircraft and run its trim once the playback ends, as after a handover ([flight-model sync](../flight-model/01-flight-model-sync.md)'s note of 2026-11-19).
- The playback ends at the recording's length, when `Follow` has drawn the path up to 400ms before Stop, so the aircraft flies on from there, and the path's last 400ms go undrawn.
- When the cockpit already stands as it did at Record, the playback's catch-up has nothing to write and can end at once, so the first played sample's feed can follow the put-back's within 50ms, and whether two writes to one slot in one frame both reach our module is unmeasured ([the WASM module](../architecture/01-spine.md#the-wasm-module)).
  If only the second arrived, `Follow` would start on a sample not yet old enough, carry the aircraft on its own motion for 400ms, then ease it back over 3s rather than at once, unless it stood over 1km away.
  Nobody watched for it in the sim, and the user judged that it doesn't matter (user, 2026-11-24, [log](log.md#2026-11-24-in-the-sim-playbacks-flew-the-58p-back-along-its-recorded-paths-with-follow-from-play-to-the-end)).

## Cases

On the bench, in a scenario of its own, `tape`: a bench core alone in a session on the stand-in sim, with the fake `serve` from `authoring`'s scenario, and a second core where a case names a crew.

- A recording of a toggle, a lever, a stepping knob, an event entry, and a counting entry's steps, played back after each is moved elsewhere: the cockpit goes back to Record's values in catch-up's order, then the stand-in sees the calls that a second core in a crew makes when the first core sends the same changes live.
- A knob's stepping write, then a toggle: the toggle waits for the knob's last step; a new value for the knob cuts its steps short.
- A pause of 5s between two changes plays as 5s.
- A second Play gives the same calls as the first.
- Refused: Record and Play with a crew, outside the flight, before preflight ends, and before every catch-up step is ready.
- A member joining during playback stops it, and their catch-up and the stream's messages after it run as they would with no playback before.
- Stop during putting back and during playing leaves nothing waiting in the stream or `tape`.
- A save during playback, and during a recording, stops it.
- On the stand-in's vertical-mode rules for the 58P: playback turns a mode on, the stand-in sets the mode's own target, which this machine sends as its change, and the target recorded after it then lands.
- A crewmate who joins after a Play stopped during a knob's steps gets a clock that covers every pretend message, and their stream waits on none.
- No banner notification shows while a recording's catch-up runs.
- A press on a synced display, recorded and played, reaches that display's panel as a crewmate's gesture, after the playback's catch-up has ended.
- A short path with a turn, flown on the stand-in's aircraft, recorded and played: as Play is pressed the aircraft is frozen and written at once at the recording's first sample, holds there while the cockpit is put back, then follows the recorded path, and at the playback's end it's unfrozen and flies on.

As unit tests:

- The cockpit stream's order: a pretend sender's messages apply in order with the gaps and the hold of a stepping write, with three machines and no core, as `order.rs`' own tests do.
- `tape`'s timeline: a playback hands each message and each sample at its recorded time, in order across the two, and ends at the recording's length.
- Flight-model sync's: a played sample's stamp moved on by the playback's shift, and the first sample stamped 450ms before Play, the 400ms delay and one 50ms period.
- `serve`'s: the island's view in each state, and the saved check against the pinned hash.
- The extension's, through `node --test`: the island's view from `serve`'s.

By hand:

- The panel's dev page, with the island in each state, by eye with the user.

In the sim, in one session on the 58P:

- Record the battery, the avionics, a turn of the heading knob, and the mixture lever; move them; Play: the cockpit goes back, then each change plays at its pace.
- In flight, record a turn with a change of the elevator trim; fly on; Play: the aircraft goes back to where it stood at Record at once, then flies the turn as the trim plays, and flies on when the playback ends.

## What this changes elsewhere

- [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md)'s Dual Input panel becomes a surface of islands, with the recorder's island below the status island, in its note of stage 22h.
- [The code map](../architecture/02-code-map.md) gains `tape`, on a line of its own above the platform's top line, using `cockpit-stream`, `profile-loader`, `session`, and `clients`, and used by `flight-model`, in its note of stage 22h.
- [Flight-model sync](../flight-model/01-flight-model-sync.md) runs `Follow` during a playback too, and hands its samples to `tape` while a recording runs, in its note of stage 22h.
- [Sync's units](../sync/05-units.md) has the cockpit stream gain recorded kinds, `CockpitSent`'s body, a step's payloads on request, and the pretend sender, in its note of stage 22h.
- The profile authors' documentation of the recorder is [stage 22e](../build/plan.md#22e-the-docs)'s, once 22h is done; it says to record alone with the profile saved, that a save stops what's running and keeps the recording, and that restoring is best effort, from [known limits](#known-limits) (user, 2026-11-24).
