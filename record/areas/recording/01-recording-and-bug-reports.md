# Recording: the recording and bug reports

```text
Purpose:     What each machine records for investigating a bug report, how long it keeps it, and how a report reaches us.
Depends on:  ../core/01-loop-and-edge.md, ../architecture/02-code-map.md, ../network/02-units.md, ../core/02-clients-and-panel-bridge.md, ../core/03-sim-seam-and-wasm-module.md, ../core/04-core-helper.md, ../architecture/log.md, ../architecture/decisions.md, log.md
Decides:     That a recording holds every input; what a replay runs and checks; how the recording is encoded; what keeps a home folder's path out of the log and the clipboard out of the recording; what each PC keeps; how a bug report reaches us in v1, and how one is uploaded, admitted, kept, and fetched after v1; the budgets; and the cases for the bench (node 6.6).
```

> **Note**
> Stage 11b's tentative decisions change this design until the apps' design confirms them.
> [The core's log keeps display names](../interface/decisions.md#the-cores-log-keeps-display-names-and-replaces-only-the-home-folders-path), so [the home folder's path](#the-home-folders-path), `log.txt`'s row, and the case for a log line replace the home folder's path alone, not the Windows username (user, 2026-10-25).
> [The EFB app has no button that marks the moment](../interface/decisions.md#mark-the-moment-leaves-the-efb-app), so `recording.mark` stays with no sender (user, 2026-10-31).
> [The Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) lists the runs, opens a run's folder for a report, and says when a recording stopped (user, 2026-10-31).

A recording is a replay log of every input the core takes, so a replay runs every unit and checks every unit's outputs (user, 2026-10-21; [recording log][every]).
Each PC keeps its runs whole within 1 GB.
When a pilot reports a problem, we ask for the run's log first, and for its recording only when the log isn't enough, and the pilot sends the run's folder by hand; uploading a part of a report to R2 through our Worker, signed with the key the pilot held in that session, comes after v1.

This answers node 6.6 of the [architecture plan](../architecture/plan.md#66-recording-and-bug-reports).
The code map's [one loop](../architecture/02-code-map.md#one-loop), [01-loop-and-edge](../core/01-loop-and-edge.md)'s [replay](../core/01-loop-and-edge.md#replay), [02-units](../network/02-units.md#the-backend)'s backend, and [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) give the rules this design builds on, and this document holds only what they leave out.

## Why it records every input

p10 recorded a flying machine that hosts traffic at EGLL: 285 MB an hour of inputs, 45 MB with zstd, 87% of the raw bytes traffic's positions, and most of the rest the flight model and the camera, each read every sim frame ([architecture log][p10]).
Recording every input costs 45 to 126 MB an hour, which v1 sends nowhere: it uploads no report, and we ask for a run's log first (user, 2026-10-21; [recording log][every]).
Partial recording, which left a feature's high-rate inputs out, caused three bugs in stage 4's sim service (same log entry).

Reading less would shrink p10's recording, to 13 MB an hour with traffic read only as it changes, within 50km, once a second, the flight model and the camera capped at 20 and 10 reads a second, and a varint header ([architecture log][lean]), but a recording is a debugging tool and mustn't set traffic's radius or rate, or anything else a pilot feels (user, 2026-10-16).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `recording` | Platform | The runs it last listed, which to keep, a slice of the runs, and commands to mark the moment and to delete a run; after v1, each run's index, the recorded sessions the report page lists, uploads, and the check for a missing part | On the loop |
| `recording-format` | Engine | The replay log's encoding: its header, inputs, and checkpoints | Wherever the message crate does |
| kernel | Platform | Each output's unit, for the log | On the loop |
| `src/apps/core`'s edge | App | The writer, the log subscriber's replacement of the home folder's path and the Windows username, and the clipboard's filter; after v1, the upload's HTTPS | The edge's threads |
| `src/backend/`'s reports | Backend | After v1: the report requests, and the files in R2 | On Cloudflare Workers |
| `tools/reports.ts` | Tool | After v1: listing and fetching reports | On our PCs |

## A replay

### What it runs

- In a replay, every unit runs on the recorded inputs, and the edge's sinks drop every output, as [running a replay](../core/01-loop-and-edge.md#running-a-replay) has it.
- A replay checks every unit's outputs.
- Each output names its unit, for the log, and the kernel draws every unit's handles from one counter and its random IDs from one generator, as [timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids) has it (user, 2026-10-23).

### A panic

A panic in any unit replays at the same input, since the writer already holds the input being handled ([a panic](../core/01-loop-and-edge.md#a-panic)).

### A replay on the same commit with local changes

One on the same commit with uncommitted changes, such as a log line added to investigate, warns and runs, and the checkpoints show the first second its outputs part from the recording's, where [running a replay](../core/01-loop-and-edge.md#running-a-replay) has every other build refuse.

## The files

Each run of the core writes a folder of its own in the data folder's `recordings\`, named by the run's start in UTC, holding two files.
The recording stops when the data folder's drive has under 1 GB free, as it stops when a write fails (user, 2026-10-23; [recording log][flush]).

| File | Holds | Encoded |
| --- | --- | --- |
| `inputs.zst` | The header, then the inputs and the checkpoints, in the order they happened | One zstd frame for the run, flushed each second ([threads](../core/01-loop-and-edge.md#threads)), so a killed core loses only its last second |
| `log.txt` | The run's `tracing` lines ([logging](../core/01-loop-and-edge.md#logging)), with the home folder's path and the Windows username replaced as each line is written | Text |

After v1, a run's folder also holds `index.json`, [below](#the-index), and `key`, the endpoint key of each session the run held, in raw bytes, for signing its upload; v1 writes neither.

### The inputs

- An input is its sequence number, its stamp as a gap in µs from the input before, its source, and its bytes, each number a varint, since a varint gap, kind, and length took p10's recording from 45.4 to 42.5 MB an hour with zstd at level 3, against 14 fixed bytes an input ([architecture log][lean]).
- The checkpoints are [01-loop-and-edge](../core/01-loop-and-edge.md#what-a-recording-holds)'s.
  The file holds no sandbox's stops, since the sandbox's time limit counts QuickJS-ng's interrupt checks, so a replay stops a call at the same check with nothing recorded ([decision 047](../../decisions/047-sandbox-time-limit-counts-interrupt-checks.md)).
- The recording holds a loaded profile as the decoded result of the job that read it ([in the recording](../profiles/02-units.md#in-the-recording)).
- Storing each record as its difference from the last of its kind and object made the whole 6% smaller at level 3 ([architecture log][p10]), so the inputs go to zstd as they are.
- Only the build that wrote the file reads it as a replay, so it carries no version beyond the header's build.

### The index

The index, after v1, is the one record a later Dual Input reads, so the report page lists a session recorded before an update.
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

- After v1, the session crate tells the recording crate when a session starts, with its ID and its endpoint key; when a member joins, with their display name; when preflight ends, with the aircraft and the departure airport; and when the session ends ([6.7](../architecture/plan.md#67-the-session)).
- After v1, the profile loader tells the recording crate each loaded bundle's hash and whether it's local ([in the recording](../profiles/02-units.md#in-the-recording)).
- The departure airport is the `[Departure]` section's `ICAO` in the flight file the core reads at preflight ([components](../architecture/01-spine.md#components)), as the sim's own `CustomFlight.FLT` of 2026-09-29 holds `ICAO=GVAC` there (read in `experiments/areas/aircraft/flights/f0-fenix-a321-gvac.flt`, kept unchanged by the aircraft harness).
- The recording crate writes the index again, as a job, at each of those and at an upload, so a run that crashed keeps what it had written.
- A field added later breaks no older reader, which skips what it doesn't know.

### Marking the moment

- The EFB app's button that marks the moment sends the recording crate's command, which the recording holds as an input and the crate logs at info (user, 2026-10-23; [recording log][flush]).
- A write that never lands is an info line in the log.

## What stays out

### The home folder's path

The sim's `AircraftLoaded` names an aircraft from the Community folder by a path under `%APPDATA%`, in lowercase, which is in the pilot's home folder (measured on MSFS 2024, 2026-10-09, `experiments/areas/architecture/results/p08-flight-2026-10-09-17-12-31.txt`), and `FlightLoaded` names the flight file there too (measured on MSFS 2024, 2026-10-05, `experiments/areas/sync/results/p04-a350-heading-2026-10-05-20-04-47.ndjson`); each probe wrote `%APPDATA%` in place of the real path.

- `src/apps/core`'s log subscriber replaces the home folder's path and the Windows username in each line as it writes it (user, 2026-10-23).
- The edge leaves every input as it came, so a recording holds the home folder's path and the Windows username wherever an input carries them, which narrows [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)' rule to the log.
- A replay needs no pilot's path, since it opens no file: every job's result is in the recording.

### The clipboard

The core reads the clipboard when the pilot selects the EFB app's code box ([invite code](../product/03-v1-scope.md#invite-code)).
The edge's job hands up only a string of six characters from the invite code's alphabet, and nothing otherwise, so whatever else the pilot copied never reaches a recording.

## What each PC keeps

- A run is kept or deleted whole, since a replay starts at the run's first input ([what a recording holds](../core/01-loop-and-edge.md#what-a-recording-holds)).
- When the core starts, the recording crate lists `recordings\`, with each folder's size, through a job, and deletes the oldest runs while all of them together pass 1 GB (user, 2026-10-23).
- At 45 to 126 MB an hour, 1 GB holds roughly 8 to 22 hours (user, 2026-10-21; [recording log][every]).
- The recording crate's slice lists the runs by their folders' names, which are their starts in UTC, with their sizes, and its command deletes a run (user, 2026-10-23).
  Of the folders named as runs, it takes the newest as the one in progress, which the slice shows and the delete refuses, and the edge opens a run's files so Windows refuses to delete them while the core writes them.
  How the EFB app lists the runs is [the apps' design](../interface/01-apps.md#slices-and-commands), since every screen a pilot uses Dual Input through is the EFB app's ([tentative decisions](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app)).

## A bug report

When a pilot reports a problem, we ask for the run's `log.txt` first, and for the recording only when the log isn't enough, and the pilot sends the run's folder by hand (user, 2026-10-21; [recording log][every]).
After v1, uploads build on the same files, as the four sections below give them.

### Uploading a part

After v1, each pilot uploads their part of a report to R2 through our Worker, signed with the key they held in that session:

1. The report page lists the recorded sessions from each run's index, by date, aircraft, departure airport, and crew ([recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports)).
2. The pilot picks one, and the recording crate's command that uploads a session ([slices and commands](../interface/01-apps.md#slices-and-commands)) gathers every run whose index names that session, since a core that restarted spans several, and each run's `inputs.zst`, `log.txt`, and `index.json`.
   The part also carries the text of each local bundle the run loaded, since a published one stays on Pages under its hash ([in the recording](../profiles/02-units.md#in-the-recording)).
3. The edge uploads each file over HTTPS as a job, in one request each, to `POST /v1/reports`, with the session's ID, this pilot's endpoint ID, the run's folder, the file's name, its size, and its SHA-256, and an Ed25519 signature over those by the session's endpoint key, from the run's `key`.
4. The index records the upload, and the page shows it sent.

A Worker takes a request body of up to 100 MB on the free plan (documented, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).
A run's `inputs.zst` reaches that after about 2 hours 15 minutes at p10's 45 MB an hour (arithmetic).
The page refuses a file over 100 MB with a notification, and we fetch it from that pilot by hand.

### What the backend admits

- After v1, the Worker takes a part only when that endpoint was a member of that session within the last 30 days, checking the signature against the endpoint ID itself, the key's public half (read in iroh-base 1.3.0, `src/key.rs`, `EndpointId`), through `crypto.subtle`, which Cloudflare lists for Ed25519 (unverified until the backend's tests run, as [its requests](../network/02-units.md#its-requests) has it).
- So the backend keeps a session's row and its members' rows for 30 days after the later of the last renewal and the member's leave, which v1's backend doesn't ([codes, lapses, and wrong codes](../network/02-units.md#codes-lapses-and-wrong-codes)):
  - A leave marks the member's row as left, with its time, rather than ending it as v1's leave does ([its requests](../network/02-units.md#its-requests)).
  - A lookup lists only members who haven't left and renewed within 30 minutes, and answers a session with none as no such code.
  - The hourly Cron Trigger deletes a row 30 days after the later of its last renewal and its leave, rather than as it lapses; a code stays taken those 30 days, which the Worker's redraw on a held code covers.
- It stores the file in R2 at `reports/<session>/<endpoint>/<run>/<file>`.
- R2 stores 10 GB-month free each month and takes 1 million Class A operations free, the class that holds writes and listings, past which it costs $0.015 a GB-month and $4.50 a million Class A operations, with no charge for downloads' bytes (documented, [R2 pricing](https://developers.cloudflare.com/r2/pricing/)); an account adds an R2 subscription through Cloudflare's checkout before it can use R2 (documented, [R2 get started](https://developers.cloudflare.com/r2/get-started/)).
- A lifecycle rule on `reports/` expires each file 30 days old, which R2 removes within about a day after (documented, [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)).

### Asking a missing pilot

After v1, when the core starts and holds a session from the last 30 days that it hasn't uploaded, the recording crate asks `POST /v1/reports/asked` with those sessions' IDs, and the Worker answers which of them hold a part from another endpoint, from R2's listing of each `reports/<session>/`.
For each, the recording crate shows a notification offering to send this pilot's part, whose action uploads it, as [recording and bug reports](../product/03-v1-scope.md#recording-and-bug-reports) suggests.

### On our end

- After v1, `tools/reports.ts` lists the reports from R2's listing, each session with the parts uploaded and the members missing, from the members table, such as "uploaded: James, Adam; missing: Greg", and fetches a session's files.
- Its requests carry a secret the Worker holds, and nobody else has one.
- We delete nothing by hand: a fetched report stays until R2 expires it, so a missing pilot is still asked.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench and v1's friend sessions measure.

| What | Budget |
| --- | --- |
| A session's recording | Under 60 MB an hour with zstd, on either machine (user, 2026-10-23; [recording log][flush]) |
| A run with no session | Under 0.5 MB an hour |
| The aircraft's model, which a recording keeps at each load | A figure avatars' stage sets |
| The writer | Under 0.5% of one CPU core |
| A replay | [01-loop-and-edge](../core/01-loop-and-edge.md#budgets)'s, which p10's loop beat at 600s replayed in 1.8s ([architecture log][p10]) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test:

- A recording cut between two flushes replays to the last.
- Runs past 1 GB lose the oldest at the next start.
- The delete removes an older run and refuses the one in progress.
- A log line holding the home folder's path and the username shows neither.
- The clipboard holding a password, then a code: nothing, then the code, reaches the recording.
- A replay on the same commit with a log line added: it warns, runs, and matches every checkpoint.

## Left open

- How big a following machine's recording is, and how much the crew's messages add, which v1's friend sessions show from their own recordings.
- After v1, whether R2's subscription needs a card on file, which subscribing shows.
- What plugin tests would need from a recording, which [04-room-for-later](../product/04-room-for-later.md#recording) has v1 build for: they're a Later pick, v1 has no plugins, and the plugins' design after v1 says whether a plugin's exported values need marks of their own ([plugins and the sandbox](../plugins/01-plugins.md#reading-it-in-the-panel)).

[p10]: ../architecture/log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly
[lean]: ../architecture/log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour
[every]: log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour
[flush]: log.md#2026-10-23-one-zstd-frame-flushed-each-second-keeps-a-busy-flights-recording-at-426-mb-an-hour-where-a-frame-ended-each-second-takes-667-mb
