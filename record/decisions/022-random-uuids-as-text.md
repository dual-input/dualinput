# 022: Sessions and pilots are named by random UUIDs, carried as text where JSON or TypeScript reads them

A session's ID and a pilot's ID are each a version 4 UUID, which has 122 random bits, and each crosses as its lowercase text wherever JSON or TypeScript reads it.
The host's core draws the session's when it starts the session, and each pilot's core draws theirs when they start or join a session, and keeps it through every rejoin of it; a run of the sim is named by its process's ID and the time the process was created.
Decided by the user on 2026-10-09, in node 1.4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#sessions-and-pilots-are-named-by-random-uuids-carried-as-text-where-json-or-typescript-reads-them).

## Context

The record left two forms to step 7 by name: a pilot ID's ([02-live-sync](../areas/sync/02-live-sync.md#when-two-pilots-change-one-entry)) and a session ID's ([03-v1-scope](../areas/product/03-v1-scope.md#recording-and-bug-reports)), as [node 1.4](../areas/architecture/plan.md#14-shared-conventions) of the architecture plan lists.
A session's ID labels each pilot's recording and their part of a bug report, and a pilot's ID keys their counters in the vector clocks and breaks the conflict rule's ties ([01-spine](../areas/architecture/01-spine.md#ids)).
Both cross to TypeScript sides as well as Rust ones: the sim's pages, the desktop app's pages, and plugins ([01-spine](../areas/architecture/01-spine.md#messages-between-components)).
A core that restarts also has to tell from its session file whether the sim restarted too ([01-spine](../areas/architecture/01-spine.md#ids)).

## Options

For a session's and a pilot's ID:

1. **64 random bits.**
   Among 10 million sessions, a hypothetical lifetime total, the chance that any two share an ID is about 1 in 370,000 ([01-spine](../areas/architecture/01-spine.md#ids)).
2. **A version 4 UUID, with 122 random bits.**
   The chance is about 1 in 10^23, and as text an ID costs 36 characters each time it crosses: once per join or link, in every message on a link that carries several senders' messages, and in every message if the vector clocks name each counter by ID ([01-spine](../areas/architecture/01-spine.md#ids)).
3. **The invite code, for the session.**
   A later session can draw the same six characters, so the code can't name a session for a bug report ([recording and bug reports](../areas/product/03-v1-scope.md#recording-and-bug-reports)).

For how an ID crosses where JSON or TypeScript reads it:

1. **As a JavaScript number.**
   `BigInt` was missing from the one cockpit panel's document we probed for it, and a JavaScript number holds every integer exactly only up to 2^53, which our QuickJS-ng run showed, so a 128-bit ID can't cross as one ([01-spine](../areas/architecture/01-spine.md#ids)).
2. **As its lowercase text.**
   It takes 36 characters, where in a binary serde format the `uuid` crate writes its 16 bytes instead (read in uuid 1.27.0, `src/external/serde_support.rs`, `is_human_readable`).

For naming a run of the sim:

1. **By its process's ID alone.**
   A process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)), so the ID alone can't tell one run of the sim from the next.
2. **By its process's ID and its creation time,** the `FILETIME` that `GetProcessTimes` gives (documented, [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)).

## Decision

A version 4 UUID, crossing as text where JSON or TypeScript reads it, and a run named by its process's ID and creation time.
The user chose 122 random bits over 64 for the margin against two sessions sharing an ID (user, 2026-10-09).
As lowercase text, two pilots' IDs compare in the order their 128-bit values do, so the conflict rule's tie-break compares them as text ([01-spine](../areas/architecture/01-spine.md#ids)).

## What it commits us to

- This answers [03-v1-scope](../areas/product/03-v1-scope.md#recording-and-bug-reports)'s question of what form the session's ID takes, and [02-live-sync](../areas/sync/02-live-sync.md#when-two-pilots-change-one-entry)'s of a pilot ID's form.
- A development core with a data folder of its own has a session file, and a pilot ID, of its own ([01-spine](../areas/architecture/01-spine.md#the-session-file-and-a-core-that-restarts)).
- A pilot keeps their ID through a core restart ([decision 023](023-pilot-id-and-restart-count.md)).
- This decision leaves out how the cores pack each vector clock counter's key, by pilot ID and restart count or by place in the member list ([01-spine](../areas/architecture/01-spine.md#left-open)), which [decision 042](042-vector-clock-records-what-applied.md) settles: by pilot ID and restart count.
