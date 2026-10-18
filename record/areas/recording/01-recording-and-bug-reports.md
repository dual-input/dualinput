# Recording: the recording and bug reports

```text
Purpose:     What each machine records for investigating a bug report, how long it keeps it, and how a report reaches us.
Depends on:  ../core/01-loop-and-edge.md, ../architecture/02-code-map.md, ../network/02-units.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../core/04-core-helper.md, ../architecture/log.md, ../architecture/decisions.md
Decides:     Which inputs a recording leaves out, and how a feature declares them; what a replay runs and checks, and what keeps a partly recorded unit's drift to itself; how the recording and its index are encoded; what keeps a home folder's path and the clipboard out; what each PC keeps; how a bug report is uploaded, admitted, kept, and fetched; the budgets; and the cases for the bench (node 6.6).
```

> **Note**
> Since 2026-10-16, a bug report also carries the text of a local bundle its run loaded, since a published one stays on Pages under its hash, and the profile loader tells the recording crate each loaded bundle's hash and whether it's local; the recording holds the loaded profile as the decoded result of the job that read it ([in the recording](../profiles/02-units.md#in-the-recording)).
>
> Since 2026-10-17, flight-model sync's unrecorded sim call is its request for `Lead`'s reports, which come about 20 times a second on the flying machine, where [unrecorded inputs](#unrecorded-inputs) has it read the pose every sim frame ([flight-model sync](../flight-model/01-flight-model-sync.md#the-flying-machine)).
>
> Since 2026-10-17, avatars' unrecorded sim calls also take in three watches: the variables its model's posing code reads, the avatar on foot, and the aircraft's pose while its pilot is on foot, beside the camera and the `Frame` events in [declaring one](#declaring-one)'s table; and a notice counts as the output of the unit that raised it, not of `clients`, whose notices slice gathers every unit's, so a partly recorded unit's notices stay out of the checkpoints' hash, where [what keeps the drift from spreading](#what-keeps-the-drift-from-spreading) names a slice by its owner ([avatars](../avatars/01-avatars.md#the-units)).
>
> Since 2026-10-17, traffic reads no `Frame` event, since its routine `Traffic` writes its copies each frame, where [declaring one](#declaring-one)'s table lists traffic's `Frame` events among the unrecorded sim calls; its unrecorded sim calls are its polls, among them a count every 10s of the aircraft that aren't its copies, and its reads of each new object's identity; and ATC audio's reports from the core helper, on its capture and on each transmission played, stay recorded, so a recording shows what the buffer did without the frames ([traffic and ATC](../traffic-atc/01-traffic-and-atc.md#the-units)).
>
> Since 2026-10-17, v1 has no plugins, so what plugin tests need from a recording, which [left open](#left-open) gives to 6.15, waits for plugins' design after v1; state sync's readings of a gauge's JavaScript arrive from its panel module and stay recorded ([plugins and the sandbox](../plugins/01-plugins.md#reading-it-in-the-panel)).
> Since 2026-10-17, the recording crate registers a slice of the recorded runs and commands to mark the moment, upload a session, and delete a run, which refuses the run in progress ([slices and commands](../interface/01-apps.md#slices-and-commands)); how the desktop app lists them is the apps' design, which settles what [a bug report](#a-bug-report) leaves to 6.16.

A recording is a replay log of the core's inputs, less the high-rate samples a feature marks as unrecorded, such as traffic's positions and the flight model's, so their bytes never reach the disk while the events around them do.
A unit with any unrecorded input runs in a replay on what was recorded, and its outputs go unchecked, while every other unit replays exactly: the platform's, and the features state sync, pointer sync, take-control, voice, rate and pause, and Go to.
Each PC keeps its runs whole within 1 GB, and each pilot uploads their part of a report to R2 through our Worker, signed with the key they held in that session.

This answers node 6.6 of the [architecture plan](../architecture/plan.md#66-recording-and-bug-reports).
The code map's [one loop](../architecture/02-code-map.md#one-loop), [01-loop-and-edge](../core/01-loop-and-edge.md)'s [replay](../core/01-loop-and-edge.md#replay), [02-units](../network/02-units.md#the-backend)'s backend, and [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) give the rules this design builds on, and this document holds only what they leave out.

## Why it records less than every input

p10 recorded a flying machine that hosts traffic at EGLL: 285 MB an hour of inputs, 45 MB with zstd, 87% of the raw bytes traffic's positions, and most of the rest the flight model and the camera, each read every sim frame ([architecture log][p10]).
That's too much to upload after a flight, or to keep several flights of (user, 2026-10-16).
Reading less would shrink it, to 13 MB an hour with traffic read only as it changes, within 50km, once a second, the flight model and the camera capped at 20 and 10 reads a second, and a varint header ([architecture log][lean]), but a recording is a debugging tool and mustn't set traffic's radius or rate, or anything else a pilot feels (user, 2026-10-16).

The inputs a replay can't do without are the ones behind the core's own decisions, where a bug in two machines' shared logic is found only by running that logic again: a value applied wrong, catch-up's order, the conflict rule's tie-break, a handover during a lost link.
A traffic copy's jitter, the figure's hand, and the following aircraft's smoothness are found by testing on our own PCs.
Under this design's rules, p10's sim inputs came to 0.9 MB an hour with zstd at level 3 ([architecture log][lean]).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `recording` | Platform | Each run's index, marks, the recorded sessions the report page lists, which runs to keep, uploads and the check for a missing part, and the setting that records everything | On the loop |
| `recording-format` | Engine | The run file's encoding: its header, inputs, the sandbox's stops, checkpoints, and marks; and the index's JSON | Wherever the message crate does |
| kernel | Platform | Each unit's handles, IDs, and connection numbers, each output's unit, and which units a replay checks | On the loop |
| `apps/core`'s edge | App | The writer and its filter, the home folder's placeholder, the clipboard's filter, and the upload's HTTPS | The edge's threads |
| `backend/`'s reports | Backend | The report requests, and the files in R2 | On Cloudflare Workers |
| `tools/reports.ts` | Tool | Listing and fetching reports | On our PCs |

## Unrecorded inputs

### Declaring one

A unit says at registration that it's partly recorded, then marks each unrecorded input where it declares it, beside its delivery or its period:

```rust
// a sketch: the message crate's traffic module, where 6.4 has a channel declared
pub const IDENTITIES: Channel<Identity> = Channel::new(31, Delivery::Stream, Priority(6));
pub const STATES: Channel<States> = Channel::new(32, Delivery::Newest, Priority(4)).unrecorded();

// a sketch: traffic on the host; `poll`, for SimConnect_RequestDataOnSimObjectType, is a call
// 6.14 adds to 6.3's sim calls
pub fn register(r: &mut Registry) {
    let me = r.unit::<Traffic>("traffic").partly_recorded();
    me.channel(traffic::STATES, Traffic::on_states);
}

fn start(me: &mut Traffic, cx: &mut Cx) {
    me.poll = Some(cx.sim().poll::<TrafficState>(Radius::km(200), Period::Ms(500)).unrecorded());
}
```

| Where | Declared on | v1's unrecorded inputs |
| --- | --- | --- |
| A channel | Its constant in the message crate, so both machines read one flag | Traffic's states, avatars' poses, the flight model's samples, and ATC audio's frames |
| A sim call | The watch's, poll's, camera read's, or `frames`' handle | Traffic's polls, the flight model's pose every frame, avatars' camera every frame, and traffic's and avatars' `Frame` events |
| A core helper want | Its registration ([04-core-helper](../core/04-core-helper.md#what-a-feature-registers-and-calls)) | ATC audio's captured frames |
| A job | The job's call | Avatars' read of an aircraft's models |

- A unit that didn't say it's partly recorded can't declare an unrecorded input: the channel's registration, the sim service, the core helper's service, or the kernel refuses the call.
  So the units are known at registration, before the header is written.
- Everything else on those features' channels, connections, and wants stays recorded: traffic's identities and the object IDs its creates get back, the figure's create answer and the core helper's clicks, a lost connection, and each exception.
  So a recording answers "did the figure appear?" from the sim's own answer, though not "why did the hand go there?", which turned on the camera.

### What the edge drops

The writer drops an unrecorded input, bytes, stamp, and all, by fields it reads without parsing the input:

- **A message between cores:** the transport event's channel.
- **A SimConnect record:** its connection, its kind, `dwID` at byte 8, and for an object's or a client data area's data, its request ID at byte 12, since a camera answer and a `Frame` event carry no request ID (read in MSFS 2024 SDK 1.8.1, `SimConnect.h`, `SIMCONNECT_RECV_SIMOBJECT_DATA`, `SIMCONNECT_RECV_CAMERA_DATA`, and `SIMCONNECT_RECV_EVENT_FRAME`).
- **A core helper message:** its capture.
- **A job's result:** its unit and its handle.

The owning platform crate hands the edge each unrecorded channel, request, kind on a connection, capture, or job before the call goes out, so the filter is in place before the first answer can arrive.
In a live run, every unit still gets every input; only the disk doesn't.

### What a platform crate may do with one

A platform crate hands an unrecorded input to its unit and decides nothing else on it, so its own state replays exactly without it.
Two crates count arrivals today, and count only recorded ones:

- The network's lost-link timer counts a connection's recorded inputs: its streams, its heartbeat once a second, and its recorded one-off channels, where [links](../network/02-units.md#links) counts every packet.
  So a link that drops up to 1s after a heartbeat is found up to 1s sooner than a count of every packet would find it.
- The core helper sends `Alive` every 2s whatever else it sends, where [the pipe](../core/04-core-helper.md#the-pipe) has it send `Alive` only after 2s of nothing, so the core's check on the helper's silence counts only recorded messages, and still sees an `Alive` every 2s while the helper sends captured frames a replay never sees.

## A replay

### What it runs

- In a replay, every unit runs, a partly recorded one on the inputs that were recorded, and the edge's sinks drop every output, as [running a replay](../core/01-loop-and-edge.md#running-a-replay) has it.
- A partly recorded unit drifts from its live run, so a replay checks only the outputs of the units that aren't, the whole units.
- The recording's header lists the partly recorded units, so a replay says what it won't check before it starts.

### What keeps the drift from spreading

- **Handles, IDs, and connections per unit:** each unit counts its own timers, jobs, and calls, draws its random IDs from a generator of its own, seeded from the core's one seed and the unit's place in the registry, and numbers its SimConnect connections by its place and its own count of opens, where [timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids) has one counter and one ChaCha20 generator for all.
  A partly recorded unit that draws fewer handles, or never opens its connection, in a replay then shifts no other unit's, and the sim service drops an input for a connection it hasn't opened, as it drops one for a connection it closed.
- **Each output names its unit:** the unit whose handler put it out, the unit whose call a platform crate was carrying out, or, for a slice of client state, the unit whose slice it is.
  The kernel folds into the checkpoints' hash only whole units' outputs.
- **A platform output that gathers several units' parts doesn't turn on a partly recorded one's drift:**
  - The core sends a client `alive` every 2s whatever else it sends, where [the protocol](../core/02-clients-and-panel-bridge.md#the-protocol) has it send one after 2s of nothing, since traffic's slice keeps the desktop app's socket busy live and not in a replay.
  - A partly recorded unit turns a core helper want on or off only on a recorded input, since `core-helper-service` sends every want whole ([04-core-helper](../core/04-core-helper.md#the-helpers-life)).
- **A partly recorded unit is a leaf:** it registers no guard, catch-up step, or cockpit kind, and makes no request the platform decides, and the kernel refuses one that tries, at registration or at the call.
  No unit reads another feature's state anyway ([what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does)).

v1's partly recorded units are traffic, ATC audio, avatars, and flight-model sync.

### A panic

The panic hook has the writer record the input being handled, even an unrecorded one, before it ends its frame ([a panic](../core/01-loop-and-edge.md#a-panic)).
A panic in a whole unit replays at the same input; one in a partly recorded unit's handler leaves that input in the recording to read, and replays only if the unit's drift reaches the same state.

### Recording everything

When we're chasing a bug in one of those four features, we ask the pilot to turn on a development setting that records every input from the core's next start, so all four units are whole and their replays checked.
The header says the setting was on.

### A replay on the same commit with local changes

One on the same commit with uncommitted changes, such as a log line added to investigate, warns and runs, and the checkpoints show the first second its outputs part from the recording's, where [running a replay](../core/01-loop-and-edge.md#running-a-replay) has every other build refuse.

## The files

Each run of the core writes a folder of its own in the data folder's `recordings\`, named by the run's start in UTC:

| File | Holds | Encoded |
| --- | --- | --- |
| `inputs.zst` | The header, then the recorded inputs, the sandbox's stops, the checkpoints, and the marks, in the order they happened | zstd frames, one ended each second ([threads](../core/01-loop-and-edge.md#threads)) |
| `index.json` | The run's sessions, [below](#the-index) | JSON with named fields |
| `log.txt` | The run's `tracing` lines ([logging](../core/01-loop-and-edge.md#logging)), with the home folder's path and the Windows username replaced as each line is written | Text |
| `key` | The endpoint key of each session the run held, for signing its upload | Raw bytes |

### The inputs

- An input is its sequence number, its stamp as a gap in µs from the input before, its source, and its bytes, each number a varint, since a varint gap, kind, and length took p10's recording from 45.4 to 42.5 MB an hour with zstd at level 3, against 14 fixed bytes an input ([architecture log][lean]).
- The stops and the checkpoints are [01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)'s, and a mark is a fourth record, [below](#marks).
- Storing each record as its difference from the last of its kind and object made the whole 6% smaller at level 3 ([architecture log][p10]), so the inputs go to zstd as they are.
- Only the build that wrote the file reads it as a replay, so it carries no version beyond the header's build.

### The index

The index is the one record a later Crosscheck reads, so the report page lists a session recorded before an update.
A hypothetical example:

```json
{
  "version": "1.0.0",
  "sessions": [
    {
      "id": "3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a",
      "started": "2026-10-16T14:02:11Z",
      "ended": "2026-10-16T15:31:47Z",
      "aircraft": "bksq-aircraft-baronpro/presets/bksq/baron58p",
      "departure": "EGLL",
      "crew": ["James", "Adam"],
      "uploaded": null
    }
  ]
}
```

- The session crate tells the recording crate when a session starts, with its ID and its endpoint key; when a member joins, with their display name; when preflight ends, with the aircraft and the departure airport; and when the session ends ([6.7](../architecture/plan.md#67-the-session)).
- The departure airport is the `[Departure]` section's `ICAO` in the flight file the core reads at preflight ([components](../architecture/01-spine.md#components)), as the sim's own `CustomFlight.FLT` of 2026-09-29 holds `ICAO=GVAC` there (read in `experiments/areas/aircraft/flights/f0-fenix-a321-gvac.flt`, kept unchanged by the aircraft harness).
- The recording crate writes the index again, as a job, at each of those and at an upload, so a run that crashed keeps what it had written.
- A field added later breaks no older reader, which skips what it doesn't know.

### Marks

- `cx.recording().mark(...)` writes a mark into `inputs.zst` at its moment: a kind, a short text, and named values, such as a write that never landed with its entry, both machines' values, and the retries, or a watch-only entry whose values differ ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
- The EFB app's button that marks the moment sends the recording crate's own command.
- A mark is a record, not an input, so a replay puts out the same marks and needs none, and a viewer shows each on the timeline.

## What stays out

### The home folder's path

The sim's `AircraftLoaded` names an aircraft from the Community folder by a path under `%APPDATA%`, which is in the pilot's home folder (measured on MSFS 2024, 2026-10-09, `experiments/areas/architecture/results/p08-flight-2026-10-09-17-12-31.txt`), and `FlightLoaded` names the flight file there too (measured on MSFS 2024, 2026-10-05, `experiments/areas/sync/results/p04-a350-heading-2026-10-05-20-04-47.ndjson`); each probe wrote `%APPDATA%` in place of the real path.

- The edge replaces the home folder's path wherever it appears in an input's bytes with a run of `~` the same number of bytes long, before it stamps the input.
  It looks for the path, as `%USERPROFILE%` gives it, in UTF-8 and in the system's ANSI code page, each as written and lowercased, since the sim sent `AircraftLoaded` lowercased (same file).
  So a SimConnect record keeps its size, every string's position stays where its struct puts it, and the core never holds the real path.
- An output that names a file, such as a job that reads the flight file, gets the real path back from the edge before the file is opened.
- A replay needs no pilot's path, since it opens no file: every job's result is in the recording.
- `apps/core`'s log subscriber replaces the home folder's path and the Windows username in each line as it writes it, since the edge's own lines aren't inputs.
- The Windows username elsewhere in an input, outside a path, stays, which narrows [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)' rule to paths and logs; we know of no input that carries it.

### The clipboard

The core reads the clipboard when the pilot selects the EFB app's code box ([invite code](../product/03-v1-scope.md#invite-code)).
The edge's job hands up only a string of six characters from the invite code's alphabet, and nothing otherwise, so whatever else the pilot copied never reaches a recording.

## What each PC keeps

- A run is kept or deleted whole, since a replay starts at the run's first input ([what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds)).
- When the core starts, the recording crate lists `recordings\`, with each folder's size, through a job, and deletes:
  - each run that held no session and isn't among the 3 newest runs before this one, so a crash with no session still has its recording;
  - then, while all runs together pass 1 GB, the oldest, but never the newest run that held a session.
- At under 4 MB an hour of session ([budgets](#budgets)), 1 GB holds over 250 hours.
- The desktop app's list of recordings, with each one's size and a way to delete it, is [6.16](../architecture/plan.md#616-the-apps)'s.

## A bug report

### Uploading a part

1. The report page lists the recorded sessions from each run's index, by date, aircraft, departure airport, and crew ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
2. The pilot picks one, and the recording crate gathers every run whose index names that session, since a core that restarted spans several, and each run's `inputs.zst`, `log.txt`, and `index.json`.
3. The edge uploads each file as a job, in one request each, to `POST /v1/reports`, with the session's ID, this pilot's endpoint ID, the run's folder, the file's name, its size, and its SHA-256, and an Ed25519 signature over those by the session's endpoint key, from the run's `key`.
4. The index records the upload, and the page shows it sent.

At the budget's 4 MB an hour, a 2-hour session's part is under 10 MB, which takes about 40s at 2 Mbps (arithmetic).
A Worker takes a request body of up to 100 MB on the free plan (documented, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).
Only a run with the setting that records everything reaches that, after about 2 hours 15 minutes at p10's 45 MB an hour (arithmetic).
The page refuses a file over 100 MB with a notice, and we fetch it from that pilot by hand.

### What the backend admits

- The Worker takes a part only when that endpoint was a member of that session within the last 30 days, checking the signature against the endpoint ID itself, the key's public half (read in iroh-base 1.3.0, `src/key.rs`, `EndpointId`), through `crypto.subtle`, which Cloudflare lists for Ed25519 (unverified until the backend's tests run, as [its requests](../network/02-units.md#its-requests) has it).
- So the backend keeps a session's row and its members' rows for 30 days after the later of the last renewal and the member's leave:
  - A leave marks the member's row as left, with its time, where [its requests](../network/02-units.md#its-requests)' leave ends it.
  - A lookup lists only members who haven't left and renewed within 30 minutes, and answers a session with none as no such code.
  - The hourly Cron Trigger deletes a row 30 days after the later of its last renewal and its leave, where [codes, lapses, and wrong codes](../network/02-units.md#codes-lapses-and-wrong-codes) has it delete a member as it lapses; a code stays taken those 30 days, which the Worker's redraw on a held code covers.
- It stores the file in R2 at `reports/<session>/<endpoint>/<run>/<file>`.
- R2 stores 10 GB-month free each month and takes 1 million Class A operations free, the class that holds writes and listings, past which it costs $0.015 a GB-month and $4.50 a million Class A operations, with no charge for downloads' bytes (documented, [R2 pricing](https://developers.cloudflare.com/r2/pricing/)); an account adds an R2 subscription through Cloudflare's checkout before it can use R2 (documented, [R2 get started](https://developers.cloudflare.com/r2/get-started/)).
- A lifecycle rule on `reports/` expires each file 30 days old, which R2 removes within about a day after (documented, [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)).

### Asking a missing pilot

When the core starts and holds a session from the last 30 days that it hasn't uploaded, the recording crate asks `POST /v1/reports/asked` with those sessions' IDs, and the Worker answers which of them hold a part from another endpoint, from R2's listing of each `reports/<session>/`.
For each, the recording crate shows a notice offering to send this pilot's part, whose action uploads it, as [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) suggests.

### On our end

- `tools/reports.ts` lists the reports from R2's listing, each session with the parts uploaded and the members missing, from the members table, such as "uploaded: James, Adam; missing: Greg", and fetches a session's files.
- Its requests carry a secret the Worker holds, and nobody else has one.
- We delete nothing by hand: a fetched report stays until R2 expires it, so a missing pilot is still asked.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench and v1's friend sessions measure.

| What | Budget |
| --- | --- |
| A session's recording | Under 4 MB an hour with zstd, on a flying machine that hosts traffic or a following machine; under these rules p10's sim inputs took 0.9 MB an hour ([architecture log][lean]), and the crew's messages, the core helper's, and the clients' add the rest (unmeasured) |
| A run with no session | Under 0.5 MB an hour |
| The writer | Under 0.5% of one CPU core |
| A replay | [01-loop-and-edge](../core/01-loop-and-edge.md#budgets)'s, which p10's loop beat at 600s replayed in 1.8s ([architecture log][p10]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- A session with traffic, avatars, the flight model, and ATC audio running: no input on an unrecorded channel, request, kind, capture, or job reaches `inputs.zst`, and the replay matches every whole unit's checkpoints.
- The same session with the setting that records everything: every unit is whole, and the replay matches every checkpoint.
- A test unit with an unrecorded channel that registers a guard, and one that declares an unrecorded input without saying it's partly recorded: the kernel refuses each.
- A replay in which a partly recorded unit draws fewer timers, and never opens its connection: no whole unit's handle, ID, or connection changes.
- A link that carries only a following machine's flight-model samples and heartbeats: it's lost at the same input live and in the replay.
- The desktop app showing traffic's slice: the core's `alive` messages match in the replay.
- A panic in a partly recorded unit's handler: the recording holds the input it was handling.
- A flight file and an aircraft under a home folder named with a letter outside ASCII, reached through a lowercased `AircraftLoaded`: the loop sees `~` in place of the home folder, the job that reads the file opens it, and `inputs.zst` holds no home folder.
- The clipboard holding a password, then a code: nothing, then the code, reaches the recording.
- Four runs with no session, then a fifth start: the oldest is deleted; runs past 1 GB: the oldest go, and the newest that held a session stays.
- A replay on the same commit with a log line added: it warns, runs, and matches every checkpoint.
- A part signed by a member who left the session is taken; one signed by an endpoint that wasn't in it, or for a session over 30 days old, is refused.
- A core that restarted in a session uploads both runs, and neither overwrites the other.
- One pilot uploads, and the other's core, started next, offers its part.

## Left open

- How big a following machine's recording is, and how much the crew's messages add, which v1's friend sessions show from their own recordings.
- Whether R2's subscription needs a card on file, which subscribing shows.
- What plugin tests would need from a recording, which [04-room-for-later](../product/04-room-for-later.md#recording) has v1 build for: they're a Later pick, and the plugins' design in [6.15](../architecture/plan.md#615-plugins) says whether a plugin's exported values need marks of their own.

[p10]: ../architecture/log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly
[lean]: ../architecture/log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour
