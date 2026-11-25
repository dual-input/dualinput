# Profiles: the sync log

```text
Purpose:     The Sync log, a view in VS Code's bottom panel that shows, live and in the engine's own words, each decision state sync's engine makes on this PC.
Depends on:  04-the-extension-in-the-sim.md, 05-the-recorder.md, ../sync/05-units.md, ../core/01-loop-and-edge.md, ../core/02-clients-and-panel-bridge.md, ../recording/01-recording-and-bug-reports.md, ../architecture/02-code-map.md
Decides:     What the sync engine logs, and that it costs nothing while nobody watches; how state sync sends the log to the profile extension; the rows and their steps; the words, and the five renames that give the code and the sync docs the same ones; the Sync log view, the hint at the end of a line, and the definitions on hover; how much history `serve` keeps; the note after a Run; the sync log of a replayed recording; and the budgets, known limits, and cases (stage 22i).
```

The Sync log shows an author why a synced entry did what it did on this PC.
Each row is one cause, such as a change on this PC or a value from a crewmate, and opens to every step the sync engine took for it, in order, with values and times: `waits behind Altitude hold`, `read back 1`, `never landed`.
The engine logs each step in the branch that takes it, state sync sends the steps to the profile extension while one is connected, and the extension lists them in a view of its own in VS Code's bottom panel, with each entry's latest step at the end of its `watch:` line.
The log uses the engine's own words, and the engine and the sync docs take five new names first, so the log, the docs, and the code share one word for each thing.

The user designed it with us on 2026-11-25, a call at a time, and the reasons below are the ones that decided each part.

The user chose it over an offline trace like fsc-editor's Trace, which mirrored FS Copilot's C# in TypeScript; of the bugs in Trace's first cut, "All three were found by re-reading, not by any check" (fsc-editor, `docs/help/trace-panel.md`, "The problem, stated honestly").
A trace run without the sim can say which event a write fires, and little more.
An entry fails on what the engine decides against real readings: a watch on the wrong variable, the aircraft putting a write back, a real change taken for a read back, a crewmate's change that lost the conflict rule, a write that waits, and a write that never landed (user, 2026-11-25).
The Sync log is the core's own engine reporting those decisions as it takes them, as the [architecture plan](../architecture/plan.md#5-the-code-map) foresaw: "An IDE that links the sync engine runs the core's own code instead."

## What an author sees

Everything below shows during a session's flight, alone or with a crew, through the author's own core, as live values do ([in a session](04-the-extension-in-the-sim.md#in-a-session)).

- **The Sync log**, a view in VS Code's bottom panel beside Problems, Output, and Terminal, lists a row for each cause, in time order.
  A row shows its time, the entry's `name:`, its cause, the value it brings, and its latest step, which changes as the engine goes on: `pending` until the sim reads the write back, then `landed` or `never landed`.
- **A row opens** to show every step, each with its time from the row's first.
- **The hint:** each entry's latest step also shows at the end of its `watch:` line, after the box with its live value, as `landed 84ms`.
- **Definitions:** every engine word, in the log and in the hint, has a dotted underline, and hovering or clicking it shows the word's definition, with a link to the word in the authors' docs (user, 2026-11-25).

```text
14:02:11.384  Battery    from Ana       0 → 1         landed
              +0       arrived from Ana: 1
              +0       toggle: reads 0, writes its event
              +0       pending 1
              +84ms    read back 1: landed
14:02:14.502  VS hold    from Ana       on → off      already matches
              +0       waits behind Altitude hold
              +40ms    Altitude hold read back
              +52ms    goes, already matches
14:02:22.700  Throttle   local change   0.82 → 0.40   put back
              +0       you're the pilot monitoring, and the pilot flying owns it
              +0       put back to 0.82, its synced value
```

That's a sketch of a made-up session; the steps' exact words, the layout, and the look come from the view's draft ([the Sync log view](#the-sync-log-view)).

The Dual Input panel in the side bar stays for doing things: Run, the display picker, and the recorder.
The log goes in the bottom panel rather than in an island of that panel, since a row's steps run as sentences, which fsc-editor's Trace found need "the wide short slot" (fsc-editor, `docs/help/trace-panel.md`, "Chrome").
That doesn't reverse [the islands](05-the-recorder.md#the-recorders-island), which keep the panel's tools out of a menu (user, 2026-11-25).

## Rows and steps

### A row is a cause

| Cause | The engine call | A row for |
| --- | --- | --- |
| local change | `seen`, for a reading no pending value matches, or an occurrence no token or `ignore` uses | A change on this PC, by the pilot's hand or by the aircraft's own systems |
| first reading | `seen`, for an entry's first reading since the profile loaded | What each entry read as the profile loaded, which for a misspelled `L:` is 0 |
| from a crewmate, by name | `arrived` | A crewmate's change or firing, as the cockpit stream applies it |
| playback | `arrived`, from the recorder's pretend sender | A recorded change, played back ([the pretend sender](05-the-recorder.md#the-pretend-sender)) |
| catch-up, from a crewmate by name or from a playback | `take` | Each entry a catch-up writes, a playback's putting back included |
| control passed | `control_passed` | Each entry the PF owns that the engine writes as control passes to this pilot ([sync's units](../sync/05-units.md)' note of the first flight with friends) |

- Most rows are a local change or a value from a crewmate, and a catch-up's value counts as a crewmate's (user, 2026-11-25).
  Control passed and first reading get rows of their own, since the log shows every decision the engine takes, and an author debugging a handover wants the writes made as they took control (user, 2026-11-25).
- A write function that doesn't compile stops its entry as the profile loads, and shows only as state sync's notification, since the builder refuses such a function first, and an author with the extension always builds through it (user, 2026-11-25).

### Steps

Each step is one decision the engine took for the row, in the order it took them.
Whatever a row's write leaves behind carries the row's number: a pending value, a write that waits, a stepping write's run, a token, an `ignore`, an input event's report, and a watch-only entry's value to compare.
So a later input's decision on it joins the row that left it: the reading that matches a pending value is the arrival's `read back`, not a row of its own, and the 1.5s check that drops it is the arrival's `never landed` ([checking a write](../sync/05-units.md#checking-a-write)).
A row's verdict, in its header and in the hint, is its latest step's word, as `landed` for a read back, so the view makes up no word of its own (user, 2026-11-25).

| Step | The engine takes it when |
| --- | --- |
| sent | The cockpit stream sent a local change (`sent`) |
| replaced | A newer local change of the entry went to the stream before the stream sent this one |
| withdrawn | The entry went back to the value last sent before the stream sent this one |
| not sent before Ready | Preflight hadn't ended |
| put back | This pilot may not send the change, as a PM moving an entry the PF owns, or during their own catch-up, so the engine writes the entry's synced value |
| not sent | The same, for a watch-only entry, which has nothing to put back |
| too large | A text over 4 KB ([the sandbox](01-format-and-delivery.md#the-sandbox)) |
| stopped: driven | The driven-entry test stopped the entry ([entries the aircraft drives itself](../sync/04-order-and-recovery.md#entries-the-aircraft-drives-itself)) |
| reported twice | An input event's second report within 3 frames, which drops |
| ignored | An occurrence that the row's entry's `ignore` used up |
| lost | The conflict rule: a newer change of this pilot's wins, and nothing is written ([the conflict rule](../sync/05-units.md#the-conflict-rule)) |
| won | It beat a change of this pilot's that the stream still held, which the engine withdraws |
| compared | A watch-only entry's value from a crewmate, compared with the reading 1.5s later, then `matches` or `differs` |
| waits for a first reading | The entry has no reading since the profile loaded ([writing](../sync/05-units.md#writing)) |
| waits behind, and the entry | A toggle, stepping write, or write function, while another entry's write is pending ([sync's units](../sync/05-units.md)' note of stage 14c) |
| goes | The write it waited for read back, or was dropped |
| already matches | The reading already equals the value |
| writes, and the action | Each action as the engine hands it over, a stepping write's steps over the frames they take |
| function wrote | A write function's run: the actions it wrote, and the value it says the entry will read |
| function failed | A write function threw, so its value goes pending and is checked |
| stopped: limit | A write function reached the sandbox's limit |
| pending, and the value | The value waits for the sim to read it back |
| read back, and the value, then landed | A reading matched it, so the write landed |
| overtaken | A later pending value of the entry read back first, which clears this one ([reading back](../sync/05-units.md#its-own-echo)) |
| never landed | Still pending 1.5s after its write, or after a stepping write's last step |
| unchecked | A following machine's write of what the PF owns, which the check drops without a flag |
| token left, token used | An event's write leaves a token, and the aircraft's report of that event uses it up |
| no value | An event entry whose write sets a variable, from a firing that carried no value |
| dropped: refused | The sim refused the entry's read, so a write waiting for its first reading drops |
| shadow taken | A core back from a restart takes the flying machine's shadow value for a counting entry, writing nothing |
| skipped: stopped | The entry stopped syncing earlier in the load |

## The words

The log, the authors' docs, the sync design docs, and the code use one word for each thing, so an author and a developer hold one model of the engine, and a word an author quotes from the log finds its branch in the code (user, 2026-11-25).
When a word of the engine's reads badly to an author, the engine and the docs rename it, and the view never translates it.
fsc-editor's Trace came to the same rule: plainer labels than its model's were built and turned down, since "The labels stay as the model has them", and a word an author lacked, "calculator", got a definition on hover rather than a replacement (fsc-editor, `docs/help/trace-panel.md`, "Tried and rejected — do not re-propose" and "`calculator` is glossed rather than removed").

The stage renames five things before it adds the log (user, 2026-11-25):

| The log says | What it is | In the code | In the sync docs |
| --- | --- | --- | --- |
| waits for a first reading | A write the engine makes only once the entry has read, so a toggle never flips blind | `StateSlot::waiting` becomes `awaiting_reading` | "Holds every write … until the entry's first reading", and "held" for such a write, become "waits for the entry's first reading" |
| waits behind | A toggle, stepping write, or write function waiting while another entry's write is pending | `Engine::held`, `Held`, and `is_held` become `behind`, `Behind`, and `is_behind` | The note of stage 14c's "held arrival", "held write", and "holds … behind it" become "waits behind" |
| synced value | The value this PC keeps for an entry from its latest local change, arrival, or catch-up, which a put-back writes | `StateSlot::held` becomes `synced` | "Puts back the value it holds" becomes "puts back its synced value" |
| local change | A reading on this PC that no pending value or token explains | `own_change` becomes `local_change` | "This machine's own change" becomes "a local change" |
| read back | A reading that matches a pending value, which confirms the write | Comments that call it the echo say "read back" | "Echo" names only the loop it guards against, a write sent back to the crew |

- With these, "held" in sync's code names only the cockpit stream's holding of each key's newest message ([kinds](../sync/05-units.md#kinds)).
- `token` keeps its name, and the authors' docs define it: the engine leaves a token for each firing its own write makes, and the aircraft's report of that firing uses the token up and isn't sent, while a report that finds no token goes to the crew (user, 2026-11-25).
- Every other word the log shows is already the engine's and the docs': pending, landed, never landed, put back, the conflict rule, lost, stopped, driven, catch-up, stepping write, write function, shadow value, and watch-only.
  The one new word is `overtaken`, which the sync docs gain with the renames.
- Each word's definition is written once, in one list the extension ships, and the authors' docs take their glossary from the same list.

## What the engine logs

```rust
// a sketch, in src/engines/sync-engine
impl Engine {
    pub fn keep_log(&mut self, on: bool);          // off as an engine loads
    pub fn take_log(&mut self) -> Vec<LogStep>;    // the steps since the last call, in the order taken
}

// in the message crate's `sync` module, beside `Stamp` and `CatchUpState`
pub struct LogStep { pub row: u32, pub at: u64, pub entry: String, pub step: Step }
pub enum Step { /* a row's cause, or one of the steps above, each with its values */ }
```

- **It costs nothing while nobody watches.**
  The engine is the core's hot path, run for every reading in a flight.
  While the log is off, each decision costs one check that the log is on: the engine builds a step inside a closure it calls only then, numbers rows only then, and leaves 0 as the row's number on what a write leaves meanwhile.
  The stage closes on the whole bench, and measures an engine call with the log off against the same call before the stage (user, 2026-11-25).
- **It changes nothing the engine decides.**
  A step records what its branch already decided, and no branch reads the log or a row's number, so an engine with the log on returns the outs it returns with the log off.
- **Every decision logs its step, in the branch that acts on it**: each branch that drops, waits, writes, sends, or stops.
  A branch added later without its step leaves a hole in the log, so the engine's tests assert each case's steps in order.
- A step names its entry by its key, and `serve` names it by its `name:` from the profile it built.
- The step types sit in the message crate's `sync` module, as `Stamp` and `CatchUpState` do, since they cross to `serve`, and every message between our components is a type of that crate ([decision 025](../../decisions/025-messages-in-one-rust-crate.md)).
- No unit is added and no dependency changes, so [the map check](../architecture/02-code-map.md#the-map-check) passes as it stands: the sync engine already uses the message crate, and state sync already uses `clients`.

## How it reaches the view

State sync sends its own engine's steps to the profile extension, as `unit` messages to every connected client whose component is `profile-extension` (user, 2026-11-25).

- `authoring` can't carry them, since no feature depends on another's code, and no feature raises a moment of its own ([tiers](../architecture/02-code-map.md#tiers), [what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does)).
  Its own engine, loaded with `load_only_asked` for Run, takes no arrival, catch-up, or pass of control, so it never takes the decisions the log is for ([the sync engine's single write](04-the-extension-in-the-sim.md#the-sync-engines-single-write)).
- A slice would resend its whole value each 50ms round it changes, so a log kept in one would resend every row; a `unit` message goes once, to the clients connected then ([what a unit registers and calls](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls)), and `serve` keeps the history.
- State sync keeps its engine's log on while a `profile-extension` client whose `hello` carries this core's version is connected, from `clients`' moments of a client joining and leaving, and turns it on in each engine it loads meanwhile.
  So a pilot who never runs the extension never turns it on, and with nobody connected, `clients` sends nothing.
- After each engine call, state sync takes the engine's new steps and sends them in one message: the load they belong to, by the stamp of the profile's load, since each load numbers its rows from 1; the steps; and the name of each sender in them, as the session names its members, with the recorder's pretend sender marked as a playback.

```rust
// a sketch: state sync's module of the message crate
pub struct SyncLog { pub load: u64, pub steps: Vec<LogStep>, pub senders: Vec<Sender> }
pub struct Sender { pub origin: Origin, pub name: String, pub playback: bool }
```

- The cockpit stream lets state sync tell its pretend sender from a member, and tells `take` whose catch-up it hands over, the pretend sender's included, so a played change and a playback's putting back start `playback` rows ([what the cockpit stream gains](05-the-recorder.md#what-the-cockpit-stream-gains)).

### What `serve` keeps

- `serve` keeps the last 10,000 rows, dropping the oldest first, until you press Clear or close VS Code (user, 2026-11-25).
  It keeps them through a save's reload, so you can compare the rows before and after a fix, and past the session's end, so you can read a flight's rows once you've left it.
- It joins each step to its row by the load and the row's number, and drops a step for a row it never saw begin, as for a write that began before the extension connected.
- It sends the view each new step in a notification of its own, `dualInput/syncLog`, and the whole list when the view opens.
- It adds each entry's latest step to the text it sends for that entry's box in `dualInput/values` ([the connection](04-the-extension-in-the-sim.md#the-connection)).

## The Sync log view

- The Sync log is a webview view in VS Code's bottom panel, which the extension contributes through `viewsContainers.panel` in its manifest (documented, [contribution points](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers)), titled "Sync log" (user, 2026-11-25).
- It's drawn in our kit, `@dualinput/ui`, with our palette and fonts, in dark and light, as the Dual Input panel is ([the Dual Input panel](04-the-extension-in-the-sim.md#the-dual-input-panel)).
- It lists every entry's rows in time order, and never follows the editor's cursor, as an IDE's own logs don't (user, 2026-11-25):
  - A filter box narrows it to the entries you name, as VS Code's Problems panel does.
  - Each entry's name is a link that opens its line in the editor, through the lookup Go to Definition uses ([navigation](03-the-extension.md#navigation)); so is the name of the entry another waits behind.
  - Clear empties it, in `serve` too.
- Its words, its layout, and its look come from a draft built whole and refined by eye with the user, on a dev page of its own, `sync-log`, in `tools/lib/dev-pages.ts`, as the Dual Input panel's were.

## The hint at the end of a line

- Each entry's latest step shows after the first box of its `watch:`, in the decoration that draws the box, in muted text, as `landed 84ms`, and changes as its row does, at the rate the boxes change.
- Its word carries the same dotted underline and definition as the log's.
- An entry with no row since the extension connected shows no hint.

## Run and the Sync log

- A Run's own decisions don't show in the log, since `authoring`'s engine takes them, outside the sync's path: `write_once` writes with no stamp, no conflict rule, and no wait behind another entry's write, refuses an entry with no reading where a sync waits for one, and flags nothing (read in `src/engines/sync-engine/src/once.rs`, `write_once`).
  Run's preview and revert notice show what it sends and whether the aircraft put it back ([the panel's Run](04-the-extension-in-the-sim.md#the-panels-run)).
- A Run's write lands in the cockpit, and state sync's engine reads it as a local change, so that's what the log shows.
- When a local change of an entry starts within 1.5s of a Run's first action on that entry, `serve` adds a note under its row, such as "You ran Mixture 40ms before this. Run skips most of an incoming change's path: record and play back to see all of it." (user, 2026-11-25).
  The view's draft refines the words.
  - The note says when you ran the entry, which `serve` knows, and not that the Run caused the change, so the row stays the engine's decision.
  - 1.5s is the engine's own check, the time it gives any write to read back, so a note never lands on a change made long after.
  - `authoring`'s Run result gains the core's stamp of the Run's first action, which `serve` compares with the row's.
- For the whole path of an incoming change on your own, record your changes and play them back: a playback sends them through state sync's own handlers as a crewmate's, so the log shows every step ([playback](05-the-recorder.md#playback)).
  With a crew, a crewmate's real changes show the same way.

## The sync log of a recording

A pilot's recording holds every input the core took, so replaying it with the log on gives the sync log of the whole run after the fact, and a support case that comes with a recording gets the why of each change ([a replay](../recording/01-recording-and-bug-reports.md#a-replay)).
A later stage builds it, and this design leaves room for it:

1. `dualinput-core replay <recording> --sync-log` replays as [running a replay](../core/01-loop-and-edge.md#running-a-replay) has it, with each state sync engine of the run keeping its log from its load, and writes the steps, one JSON object to a line, to `sync-log.jsonl` beside the recording.
2. The kernel gives units one read-only fact, whether the replay asked for the sync log, which no live run sets.
   While it's set, state sync turns its engine's log on, and hands each step to the core's log under a target of its own, `sync_log`, whose lines the replay writes to that file and to no other, so nothing parses the core's text log.
3. The replay still checks every checkpoint, since the log changes nothing the engine decides.
   The checkpoints' hash folds in the core's outputs, and the core's log isn't one ([outputs](../core/01-loop-and-edge.md#outputs)), so a replay with a log line added matches every checkpoint ([the recording's cases](../recording/01-recording-and-bug-reports.md#cases-for-the-bench)).
   A run in which `serve` was connected sent its steps as outputs, and its replay sends the same ones, since the connection was an input.

So what this stage builds has to hold two things for that stage: each step state sync hands on carries everything a reader needs without `serve`, its load, which state sync adds, and its row, time, entry, and values; and the log changes nothing the engine decides, which the bench's cases check.

## How it works

| Part | Where | What it holds |
| --- | --- | --- |
| `sync-engine` | `src/engines/sync-engine` | The five renames; `keep_log` and `take_log`; a step in each branch; and the row's number on what a write leaves |
| The message crate | `src/engines/messages` | `LogStep` and `Step` in `sync`, `SyncLog` in `state_sync`, the Run result's stamp in `authoring`, and their TypeScript |
| `state-sync` | `src/features/state-sync` | The log kept on while an extension of this release is connected, and each engine call's steps sent with their senders' names |
| `cockpit-stream` | `src/platform/cockpit-stream` | Its pretend sender told apart from a member, and whose catch-up `take` hands over |
| `authoring` | `src/features/authoring` | The stamp of a Run's first action, in its result |
| `serve` | `tools/profile-builder` | The last 10,000 rows, the hint's text, the note after a Run, and the entries' lines for the links |
| The extension | `src/apps/profile-extension` | The Sync log view, with its dev page; the hint; and the words' definitions on hover |

## Budgets

Each is a starting value:

- **Off:** with no extension connected, an engine call takes what it took before the stage, within the bench's spread from run to run, on the `state-sync` scenario.
- **A step to the view:** within 150ms of the engine's call at p95, on the 58P, as a value reaches its box ([budgets](04-the-extension-in-the-sim.md#budgets)).
- **On:** state sync's handler stays under the code map's 1ms with the log on and a lever moving ([budgets](../architecture/02-code-map.md#budgets)), and each `SyncLog` message under the protocol's 64 KiB ([budgets](../core/02-clients-and-panel-bridge.md#budgets)).
- **History:** 10,000 rows in `serve` under 10 MB, at about 500 bytes a row with its steps (an estimate the stage measures).

## Known limits

- The log shows this PC's engine.
  What a crewmate's engine did with your change shows in their Sync log, or in a replay of their recording.
- A Run's own decisions don't show ([Run and the Sync log](#run-and-the-sync-log)).
- The cockpit stream's own decisions don't show: a copy it drops, a message a change of control drops, a run of the PF's changes a replay collapses, and the wait for a message's gap; an arrival's row starts as state sync applies the message ([applying](../sync/05-units.md#applying)).
- The sim reports a value, not who moved it, so a pilot's hand and the aircraft's own systems are both a local change, as they are to the engine.
- A lever moved makes a local change for each reading, up to one a sim frame, whose rate is unmeasured; at the 89.2 updates a second our module ran through a flight ([sync's budgets](../sync/05-units.md#budgets)), 10,000 rows hold under 2 minutes of a lever moved without a pause (arithmetic).
- A write that began before the extension connected shows none of its later steps.
- The rows go when VS Code closes or `serve` restarts.
- A write function that doesn't compile shows only as state sync's notification ([a row is a cause](#a-row-is-a-cause)).

## Cases

On the bench, in a scenario of its own, `sync-log`: a bench core in a session on the stand-in sim with the fake `serve` from `authoring`'s scenario, and a second core where a case names a crew:

- With no extension connected, state sync sends no `SyncLog`; with the fake `serve` connected, every step of the cases below reaches it; once it leaves, the steps stop.
- A crewmate's toggle that lands: `from` the crewmate, `writes`, `pending`, then `read back` on the same row.
- A crewmate's write to an entry with no reading yet: `waits for a first reading` on the crewmate's row, a `first reading` row of its own, then `writes` on the crewmate's row.
- On the stand-in's vertical-mode rules for the 58P, a vertical speed toggle that arrives with altitude hold's event: `waits behind`, `goes`, then `already matches`, as stage 14c's case has them ([sync's units](../sync/05-units.md)' note of stage 14c).
- A crewmate's change that loses to a newer change of this pilot's: `lost`; one that beats a change the stream still holds: `won`.
- A `toggle` over a lamp the stand-in lights 2s late: `never landed` at 1.5s.
- A local change, `sent`; two before the stream sends, the first `replaced`; one undone before it sends, `withdrawn`; one before Ready, `not sent before Ready`.
- The PM's throttle on a following machine: `put back`.
- An entry the stand-in changes every 3s on both machines: `stopped: driven`.
- An event entry that watches an `H:` event and writes an input event: `token left`, then `token used`, on one row.
- A crewmate's knob turned a detent a frame, arriving as 100, 101, and 102: a row for each, and `overtaken` on an earlier row when a later value reads back first.
- A late joiner's catch-up: a catch-up row for each entry it writes; a takeover: `control passed` rows.
- A playback: `playback` rows, the putting back's included.
- The cases of the `state-sync` scenario, with the fake `serve` connected to each core, make the stand-in's calls they make without it.

As unit tests:

- The sync engine's: each case above gives its steps in order; and with the log off, `take_log` gives nothing, and the outs are the log-on run's.
- `serve`'s: the 10,001st row drops the first; Clear empties the rows; a local change 1.4s after a Run of its entry gets the note, and one at 1.6s or on another entry gets none; and a step for a row never seen to begin drops.
- The extension's, through `node --test`: the hint's text for each verdict, and a definition for each word the log shows.

By hand:

- The view's dev page in each of its states, by eye with the user.

In the sim, in one session on the 58P, alone, with `node tools/sim/sync-log.ts`:

- A switch flipped by hand gives a local change, `sent`.
- A recording of the battery, a turn of the heading knob, and the vertical modes, played back, gives each row's steps as on the bench, with the 58P's own read-back times, and each step reaches the view within the budget.

## What this changes elsewhere

- [Sync's units](../sync/05-units.md) gains the five renames, `overtaken`, and the sync engine's log, in its note of stage 22i.
- [04-the-extension-in-the-sim](04-the-extension-in-the-sim.md) gains each entry's latest step after its box, the Sync log beside the Dual Input panel, and the Run result's stamp, in its note of stage 22i.
- [The code map](../architecture/02-code-map.md) is unchanged, since no unit or dependency is added.
- [v1's scope](../product/03-v1-scope.md#test-sessions) gains the Sync log in v1, beside the extension's live values, Run, and picker, with stage 22i.
- The profile authors' documentation of the Sync log is [stage 22e](../build/plan.md#22e-the-docs)'s, once 22i is done: its words, with the glossary from the extension's list and `token` defined; and which tool answers which question, Run whether a write does the right thing, and the Sync log, during a playback or with a crew, why a change landed or didn't (user, 2026-11-25).
- [Running a replay](../core/01-loop-and-edge.md#running-a-replay) and [a replay](../recording/01-recording-and-bug-reports.md#a-replay) gain `--sync-log` with the stage that builds [the sync log of a recording](#the-sync-log-of-a-recording).
