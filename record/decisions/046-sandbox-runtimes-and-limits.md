# 046: Each aircraft's profile and plugin run in runtimes of their own, with 64 MB each, 100ms a call, and 4 KB a value

> **Note**
> [Decision 047](047-sandbox-time-limit-counts-interrupt-checks.md) changes this decision's time limit: a call stops after a fixed count of QuickJS-ng's interrupt checks, about 100ms on our development machine, rather than at 100ms by the clock.

Each loaded aircraft gets two QuickJS-ng runtimes in the core, one for its profile's script and one for its plugin, each limited to 64 MB of memory and 100ms a call by the clock, and an entry's value is capped at 4 KB as sent, with no cap of its own on the state object.
A write function at a limit fails that write and its entry is flagged; a plugin at a limit is turned off for the rest of the session, and every machine stops syncing its entries; and a value over 4 KB isn't sent and its entry is flagged.
Decided by the user on 2026-10-11 and 2026-10-12, in node 4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#each-aircrafts-profile-and-plugin-run-in-runtimes-of-their-own-with-64-mb-each-100ms-a-call-and-4-kb-a-value).

## Context

A profile's write functions and an aircraft's plugin are JavaScript that runs in the core ([decision 018](018-rust-and-typescript.md); [decision 020](020-plugin-code-runs-only-in-core.md)), and neither reaches the pilot's files or the network ([decision 021](021-profiles-and-plugins-apart-from-releases.md)).
Step 7's exit names the size limits of the sandbox that write functions run in ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)), and [01-profile-entries](../areas/sync/01-profile-entries.md#the-writer-api) had the engine cap how large one entry and the whole state object can grow.
The limits are for bugs, a loop that never ends or an allocation that never stops, which would otherwise stop every write from a profile or run the PC short of memory, and not for bad actors, whom what a profile and a plugin can reach already stops (user, 2026-10-12).

## Options

The engine, which [decision 018](018-rust-and-typescript.md) chose, by how each held limits of 64 MB and 100ms embedded in a Rust host (measured on our development machine, 2026-10-08, [architecture log][engines]):

1. **V8, through the `v8` crate.**
   Its process died at the 1 GB cap on an endless allocation unless TurboFan was off, its heap limit doesn't count ArrayBuffers unless the host gives it an allocator that counts them, and an idle runtime held 3.4 MB.
2. **Node's `vm` module.**
   It has no memory limit: under `--max-old-space-size=64`, endless allocation ended the whole process, and a worker thread with `resourceLimits` ended alone, but in one of two runs the 10 frames after it didn't match their checksums.
3. **QuickJS-ng, through rquickjs.**
   It stopped a runaway allocation at the 64 MB limit in 88ms and an endless loop at the 100ms limit, with the host running on, and an idle runtime held 0.9 MB, while 100 write functions took 75µs a frame.

How many runtimes:

4. **One runtime for an aircraft's profile and plugin together.**
   A plugin that fails could stop the profile's writes ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#the-sandbox)).
5. **Two, one for the profile's script and one for the plugin, each with its own limits.**

The time limit:

6. **A limit near the time a healthy call takes.**
   The limit runs by the clock, and on a PC MSFS keeps busy a short call can wait behind other work, so it could turn off a healthy plugin for the session (user, 2026-10-12).
7. **100ms a call.**
   A stuck call holds up the writes behind it for 100ms, which costs little, since a stuck call is a bug (user, 2026-10-12).

A plugin at a limit:

8. **Turn it off on the machine where it hit the limit.**
   A plugin turned off on one machine freezes its values there, so a later catch-up would write the frozen values into a crewmate's working plugin (node 4's review, 2026-10-12).
9. **Turn it off, and have every machine stop syncing its entries.**

## Decision

Options 3, 5, 7, and 9, with each entry's value capped at 4 KB as sent.
QuickJS-ng held both limits as built, with the host running on, and the smallest footprint.
Numbers and switches never come near 4 KB: a cockpit change naming its entry and two pilots in full took 84 bytes ([network log, 2.2][n22]), and the largest value we know of, the KNS-81's 10 waypoints, would be a few hundred bytes (an estimate).
A profile fixes its entries when it loads, so the cap on each value bounds the state object, which needs no cap of its own.

## What it commits us to

- A write function at a limit fails that write, and its entry is flagged as for a write that never landed.
- A plugin at a limit is turned off for the rest of the session, every machine stops syncing its entries, and the banner says so ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#plugins)).
- A value over 4 KB isn't sent, and its entry is flagged.
- Time a plugin spends waiting on a panel's answer through our API doesn't count, since no JavaScript runs while it waits ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#the-sandbox)).
- It sets the size limits of the sandbox that write functions run in, which step 7's exit names.
- The memory and time figures come from a host doing nothing else, not from a core at work, and all three values are starting values, so the decision leaves what real profiles and plugins need to the 58P's profile and plugin, which measure it.

[engines]: ../areas/architecture/log.md#2026-10-08-embedded-in-rust-quickjs-runs-100-write-functions-a-frame-in-75µs-idles-under-1-mb-and-holds-its-memory-and-time-limits-while-v8s-memory-limit-failed-until-turbofan-was-off
[n22]: ../areas/network/log.md#2026-10-10-postcard-packs-every-v1-message-smallest-but-one-and-which-fields-a-message-carries-changes-its-size-more-than-the-format-does
