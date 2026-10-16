# Recording: the recording and bug reports

```text
Purpose:     What each machine records, how long it keeps it, and how a bug report reaches us.
Depends on:  ../core/01-loop-and-edge.md, ../architecture/02-code-map.md, ../network/02-units.md, ../core/03-sim-seam-and-wasm-module.md, ../core/04-core-helper.md, ../architecture/log.md, ../architecture/decisions.md
Decides:     Which inputs a recording leaves out, and how a feature declares them; what a replay runs and checks; how the replay log and the index are encoded; what keeps a home folder's path and the clipboard out; what each PC keeps; how a bug report is uploaded, admitted, kept, and fetched; the budgets; and the cases for the bench (node 6.6).
```

A recording is a replay log of the core's inputs, less the high-rate samples a feature marks as unrecorded, such as traffic's positions and the flight model's, so their bytes never reach the disk while the events around them do.
A unit with any unrecorded input runs in a replay on what was recorded, and its outputs go unchecked, while every other unit replays exactly: the platform, sync, the cockpit stream, catch-up, the session, control, and pointer sync.
Each PC keeps its runs whole within 1 GB, and each pilot uploads their part of a report to R2 through our Worker, signed with the key they held in that session.

This answers node 6.6 of the [architecture plan](../architecture/plan.md#66-recording-and-bug-reports).
The code map's [one loop](../architecture/02-code-map.md#one-loop), [01-loop-and-edge](../core/01-loop-and-edge.md)'s [replay](../core/01-loop-and-edge.md#replay), [02-units](../network/02-units.md#the-backend)'s backend, and [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) give the rules this design builds on, and this document holds only what they leave out.

## Why it records less than every input

p10 recorded a flying machine that hosts traffic at EGLL: 285 MB an hour of inputs, 45 MB with zstd, 87% of the raw bytes traffic's positions, and most of the rest the flight model and the camera, each read every sim frame ([architecture log][p10]).
That's too much to upload after a flight, or to keep several flights of (user, 2026-10-16).
Reading less would shrink it, to 13 MB an hour with traffic read only as it changes, within 50km, once a second ([architecture log][lean]), but a recording is a debugging tool and mustn't set traffic's radius or rate, or anything else a pilot feels (user, 2026-10-16).

The inputs a replay can't do without are the ones behind the core's own decisions, where a bug in two machines' shared logic is found only by running that logic again: a value applied wrong, catch-up's order, the conflict rule's tie-break, a handover during a lost link.
A traffic copy's jitter, the figure's hand, and the following aircraft's smoothness are found by testing on our own PCs.
Without p10's traffic, flight model, and camera, its sim inputs came to 0.78 MB an hour with zstd (arithmetic, on [p10's capture][p10]).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `recording` | Platform | Each run's index, marks, the recorded sessions the report page lists, which runs to keep, uploads and the check for a missing part, and the setting that records everything | On the loop |
| `recording-format` | Engine | The run file's encoding: its header, inputs, the sandbox's stops, checkpoints, and marks; and the index's JSON | Wherever the message crate does |
| kernel | Platform | Each unit's handles and random IDs, each output's unit, and which units a replay checks | On the loop |
| `apps/core`'s edge | App | The writer and its filter, the home folder's placeholder, the clipboard's filter, and the upload's HTTPS | The edge's threads |
| `backend/`'s reports | Backend | The report requests, the parts table in D1, and the files in R2 | On Cloudflare Workers |
| `tools/reports.ts` | Tool | Listing, fetching, and deleting reports | On our PCs |

## Unrecorded inputs

### Declaring one

A feature marks an input unrecorded where it declares it, beside its delivery or its period:

```rust
// a sketch: the message crate's traffic module, where 6.4 has a channel declared
pub const IDENTITIES: Channel<Identity> = Channel::new(31, Delivery::Stream, Priority(6));
pub const STATES: Channel<States> = Channel::new(32, Delivery::Newest, Priority(4)).unrecorded();

// a sketch: traffic on the host; `poll`, for SimConnect_RequestDataOnSimObjectType, is a call
// 6.14 adds to 6.3's sim calls
fn start(me: &mut Traffic, cx: &mut Cx) {
    me.poll = Some(cx.sim().poll::<TrafficState>(Radius::km(200), Period::Ms(500)).unrecorded());
}
```

| Where | Declared on | v1's unrecorded inputs |
| --- | --- | --- |
| A channel | Its constant in the message crate, so both machines read one flag | Traffic's states, avatars' poses, the flight model's samples, and ATC audio's frames |
| A sim call | The watch or poll's handle | Traffic's polls, the flight model's pose every frame, and avatars' camera every frame |
| A core helper want | Its registration ([04-core-helper](../core/04-core-helper.md#what-a-feature-registers-and-calls)) | ATC audio's captured frames |
| A job | The job's call | Avatars' read of an aircraft's models |

Everything else on those features' channels, connections, and wants stays recorded: traffic's identities and the object IDs its creates get back, the figure's create answer and the core helper's clicks, a lost connection, and each exception.
So a recording answers "did the figure appear?" from the sim's own answer, though not "why did the hand go there?", which turned on the camera.

### What the edge drops

- The writer drops an unrecorded input's bytes, stamp, and all, by a field it reads without parsing the input: a transport event's channel, a SimConnect record's request ID at byte 12 on its connection (read in MSFS 2024 SDK 1.7.3, `SimConnect.h`, `SIMCONNECT_RECV_SIMOBJECT_DATA`), a core helper frame's capture, or a job's handle.
- The owning platform crate hands the edge each unrecorded request, connection, capture, or job before the call goes out, so the filter is in place before its first answer can arrive.
- In a live run, every unit still gets every input; only the disk doesn't.

### What a platform crate may do with one

A platform crate hands an unrecorded input to its unit and decides nothing else on it, so its own state replays exactly without it.
Two crates count arrivals today, and count only recorded ones:

- The network's lost-link timer counts a connection's recorded inputs: its streams, its heartbeat once a second, and its recorded one-off channels, where [links](../network/02-units.md#links) counts every packet.
  A link dropping right after a heartbeat is then found up to 1s sooner than a count of every packet would find it.
- The core helper sends `Alive` every 2s whatever else it sends, where [the pipe](../core/04-core-helper.md#the-pipe) has it send `Alive` only after 2s of nothing, so its captured frames never count toward its silence.

## A replay

### What it runs

- A unit with any unrecorded input is **partly recorded**; the others are whole.
- In a replay, every unit runs, a partly recorded one on the inputs that were recorded, and the edge's sinks drop every output, as [running a replay](../core/01-loop-and-edge.md#running-a-replay) has it.
- A partly recorded unit drifts from its live run, so a replay checks only the outputs of whole units.
- The recording's header lists the partly recorded units, so a replay says what it won't check before it starts.

### What keeps the drift from spreading

- **Handles and IDs per unit:** each unit counts its own timers, jobs, and calls, and draws its random IDs from a generator of its own, seeded from the core's one seed and the unit's place in the registry, where [timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids) has one counter and one ChaCha20 generator for all.
  A partly recorded unit that draws fewer handles in a replay then shifts no other unit's.
- **Each output names its unit:** the unit whose handler put it out, the unit whose call a platform crate was carrying out, or, for a slice of client state, the unit whose slice it is.
  The kernel folds into the checkpoints' hash only whole units' outputs.
- **A partly recorded unit is a leaf:** it registers no guard, catch-up step, or cockpit kind, makes no request the platform decides, and the kernel refuses one that tries, at registration.
  No unit reads another feature's state anyway ([what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does)).

v1's partly recorded units are traffic, ATC audio, avatars, and flight-model sync, so a replay checks the platform, state sync, pointer sync, take-control, voice, rate and pause, and Go to.

### Recording everything

A development setting turns every unrecorded declaration off from the core's next start, for a pilot we're chasing a bug in one of those four features with, so that each is whole and its replay checked.
The header says the setting was on.

### On another build

A replay on the build the header names runs as [running a replay](../core/01-loop-and-edge.md#running-a-replay) has it.
One on the same commit with uncommitted changes, such as a log line added to investigate, warns and runs, and the checkpoints show the first second its outputs part from the recording's, where 01-loop-and-edge has any other build refuse.
One on another commit refuses, naming the commit.

## The files

Each run of the core writes a folder of its own in the data folder's `recordings\`, named by the run's start in UTC:

| File | Holds | Encoded |
| --- | --- | --- |
| `inputs.zst` | The header, then the recorded inputs, the sandbox's stops, the checkpoints, and the marks, in the order they happened | zstd frames, one ended each second ([01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)) |
| `index.json` | The run's sessions, marks, and sizes, [below](#the-index) | JSON with named fields |
| `log.txt` | The run's `tracing` lines ([logging](../core/01-loop-and-edge.md#logging)) | Text |
| `key` | The endpoint key of each session the run held, for signing its upload | Raw bytes |

### The inputs

- An input is its sequence number, its stamp as a gap in µs from the input before, its source, and its bytes, each number a varint, since a varint header took p10's recording from 45.4 to 42.5 MB an hour with zstd at level 3, where 14 fixed bytes an input cost the difference ([architecture log][lean]).
- The stops and the checkpoints are 01-loop-and-edge's.
- A mark is a fourth record, [below](#marks).
- Storing each record as its difference from the last of its kind and object gained 7% at level 3 ([architecture log][p10]), so the inputs go to zstd as they are.
- Only the build that wrote the file reads it as a replay, so it carries no version beyond the header's build.

### The index

The index is the one record a later Crosscheck reads, so the report page lists a session recorded before an update.

```json
{
  "run": { "started": "2026-10-16T13:52:24Z", "ended": "2026-10-16T15:40:02Z", "how": "quit", "version": "1.0.0" },
  "sessions": [
    {
      "id": "3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a",
      "started": "2026-10-16T14:02:11Z",
      "ended": "2026-10-16T15:31:47Z",
      "aircraft": "bksq-aircraft-baronpro/presets/...",
      "departure": "EGLL",
      "crew": ["James", "Adam"],
      "marks": [{ "at": "2026-10-16T15:12:03Z", "what": "pilot" }],
      "uploaded": null
    }
  ],
  "partly_recorded": ["traffic", "atc-audio", "avatars", "flight-model"],
  "bytes": { "inputs": 6113024, "log": 402113 }
}
```

- The session crate tells the recording crate when a session starts, with its ID, its endpoint key, its crew's display names, the aircraft, and the departure airport from the flight file it reads at preflight, and when it ends ([6.7](../architecture/plan.md#67-the-session)).
- The recording crate writes the index again, as a job, at each such change and at each mark, and the edge writes `how` as the run ends: a quit, an exit, or nothing after a crash.
- A field added later breaks no older reader, which skips what it doesn't know.

### Marks

- `cx.recording().mark(...)` writes a mark: a kind, a short text, and named values, such as a write that never landed with its entry, both machines' values, and the retries, or a watch-only entry whose values differ ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- The EFB app's button that marks the moment sends the recording crate's own command.
- A mark goes into `inputs.zst` at its moment, and into the index, so a viewer shows it on the timeline and the report page beside its session.
- A mark is a record, not an input, so a replay compares it but needs none.

## What stays out

### The home folder's path

The sim's `AircraftLoaded` names the aircraft's folder in the Community folder under `%APPDATA%`, which is in the pilot's home folder, and `FlightLoaded` names the flight file there too (measured on MSFS 2024, 2026-10-09, `experiments/areas/architecture/results/p08-flight-2026-10-09-17-12-31.txt`, and 2026-10-05, `experiments/areas/sync/results/p04-a350-heading-2026-10-05-20-04-47.ndjson`, each probe writing `%APPDATA%` in place of the real path).

- The edge replaces the home folder's path, as `%USERPROFILE%` gives it, wherever it appears in an input's bytes, ignoring case, with a run of `~` of the same length, before it stamps the input.
  So a SimConnect record keeps its size, every string's position stays where its struct puts it, and the core never holds the real path.
- An output that names a file, such as a job that reads the flight file, gets the real path back from the edge before the file is opened.
- A replay needs no pilot's path, since it opens no file: every job's result is in the recording.
- The upload scrubs `log.txt` too, replacing the home folder's path and the Windows username with placeholders, since the edge's own lines aren't inputs.

### The clipboard

The core reads the clipboard when the pilot selects the EFB app's code box ([invite code](../product/03-v1-scope.md#invite-code)).
The edge's job hands up only a string of six characters from the invite code's alphabet, and nothing otherwise, so whatever else the pilot copied never reaches a recording.

## What each PC keeps

- A run is kept or deleted whole, since a replay starts at the run's first input ([what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds)).
- When the core starts, the recording crate lists `recordings\`, through a job, and deletes:
  - each run that held no session, beyond the 3 newest runs, so a crash with no session still has its recording;
  - then, while all runs together pass 1 GB, the oldest, but never the newest run that held a session.
- At the 2 to 4 MB an hour a session's recording should take ([budgets](#budgets)), 1 GB holds over 250 hours.
- The desktop app's list of recordings, with each one's size and a way to delete it, is [6.16](../architecture/plan.md#616-the-apps)'s.

## A bug report

### Uploading a part

1. The report page lists the recorded sessions from each run's index, by date, aircraft, departure airport, and crew ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
2. The pilot picks one, and the recording crate gathers every run whose index names that session, since a core that restarted spans several, and each run's `inputs.zst`, its scrubbed `log.txt`, and its `index.json`.
3. The edge uploads each file as a job, in one request, to `POST /v1/reports`, with the session's ID, this pilot's endpoint ID, the file's name, size, and SHA-256, and an Ed25519 signature over those by the session's endpoint key, from the run's `key`.
4. The index records the upload, and the page shows it sent.

A 2-hour session's part should come to under 10 MB, which takes about 40s at 2 Mbps (arithmetic); a Worker takes a request body of up to 100 MB on the free plan (documented, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), and a file larger than that is refused with a notice, which no budgeted run reaches.

### What the backend admits

- An endpoint ID is the endpoint key's public half, so the Worker checks the signature with the ID itself, through `crypto.subtle`, as [its requests](../network/02-units.md#its-requests) does.
- It takes a part only when that endpoint was a member of that session within the last 30 days.
  So the hourly Cron Trigger keeps a session's row and its members' rows for 30 days after the last renewal, where [codes, lapses, and wrong codes](../network/02-units.md#codes-lapses-and-wrong-codes) deletes them as they lapse; a lookup still answers a session with no member renewed within 30 minutes as no such code.
- It stores the file in R2 at `reports/<session>/<endpoint>/<file>`, and a row in D1's parts table with the session, the endpoint, the file, its size, and when.
- R2 keeps 10 GB a month free, past which it costs $0.015 a GB-month, with nothing charged for downloads (documented, [R2 pricing](https://developers.cloudflare.com/r2/pricing/)); third-party guides say Cloudflare asks for a card before R2 can be turned on, which its own page doesn't say (unverified).

### Asking a missing pilot

When the core starts and holds a session from the last 30 days that it hasn't uploaded, the recording crate asks `POST /v1/reports/asked` with those sessions' IDs, and the backend answers which of them have a part from someone else.
For each, the recording crate shows a notice offering to send this pilot's part, whose action uploads it, as [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) suggests.

### On our end

- `tools/reports.ts` lists the reports, each session with the parts uploaded and the members missing, from the members table, such as "uploaded: James, Adam; missing: Greg", fetches a session's files, and deletes them.
- Its requests carry a secret the Worker holds, and nobody else has one.
- R2 deletes every report 30 days after its upload through a lifecycle rule (documented, [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)), and we delete one as soon as we've fetched it.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench and v1's friend sessions measure.

| What | Budget |
| --- | --- |
| A session's recording | Under 4 MB an hour with zstd, on a flying machine that hosts traffic or a following machine; p10's sim inputs without its traffic, flight model, and camera took 0.78 MB an hour ([architecture log][p10]), and the crew's messages, the core helper's, and the clients' add the rest (unmeasured) |
| A run with no session | Under 0.5 MB an hour |
| The writer | Under 0.5% of one CPU core |
| The recordings on disk | Under 1 GB |
| A part's upload | Under 10 MB for a 2-hour session |
| A replay | 01-loop-and-edge's hour in under 6 minutes; p10's loop replayed 600s in 1.8s ([architecture log][p10]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- A session with traffic, avatars, the flight model, and ATC audio running: no input on an unrecorded channel, request, capture, or job reaches `inputs.zst`, and the replay matches every whole unit's checkpoints.
- The same session with the setting that records everything: every unit is whole, and the replay matches every checkpoint.
- A test unit with an unrecorded channel that registers a guard: the kernel refuses it at registration.
- A replay in which a partly recorded unit draws fewer timers than it did live: no whole unit's handle or ID changes.
- A link that carries only a following machine's flight-model samples and heartbeats: it's lost at the same input live and in the replay.
- A flight file under the home folder: the loop sees the path with `~` in place of the home folder, the job that reads the file opens it, and `inputs.zst` holds no home folder.
- The clipboard holding a password, then a code: nothing, then the code, reaches the recording.
- Four runs with no session, then a fifth start: the oldest is deleted; runs past 1 GB: the oldest go, and the newest that held a session stays.
- A replay on the same commit with a log line added: it warns, runs, and matches every checkpoint.
- A part signed by a member is taken; one signed by an endpoint that wasn't in the session, or for a session over 30 days old, is refused.
- One pilot uploads, and the other's core, started next, offers its part.

## Left open

- How big a following machine's recording is, and how much the crew's messages add, which v1's friend sessions show from their own recordings.
- Whether Cloudflare asks for a card to turn R2 on, which turning it on shows.
- What plugin tests would need from a recording, which [04-room-for-later](../product/04-room-for-later.md#recording) has v1 build for: they're a Later pick, and the plugins' design in [6.15](../architecture/plan.md#615-plugins) says whether a plugin's exported values need marks of their own.

[p10]: ../architecture/log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly
[lean]: ../architecture/log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour
