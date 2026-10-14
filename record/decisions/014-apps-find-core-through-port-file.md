# 014: Apps outside the sim find the core through a port file

The core writes its port, its process ID, and its process's creation time, the `FILETIME` that `GetProcessTimes` gives, to a file in its data folder, and a core that finds the file naming a core that's still running, with that ID and that creation time, exits, so one core runs for each data folder.
The desktop app reads the port there, and starts the core when the file names no running process with that ID and creation time; the watcher reads the process ID and creation time, and shows the CPU and memory use of the process that matches both beside its own.
Decided by the user on 2026-10-08 and 2026-10-09, in node 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#apps-outside-the-sim-find-the-core-through-a-port-file).

## Context

The core listens on 127.0.0.1, on a port Windows picks, and the sim's pages learn the port from the core's announcements on the CommBus ([decision 009](009-sim-pages-find-core-over-commbus.md)).
Two of Crosscheck's programs outside the sim need the core too:

- The desktop app talks to the core over a WebSocket on 127.0.0.1 ([01-spine](../areas/architecture/01-spine.md#communication)), and starts the core when the pilot opens it and the core isn't running ([decision 002](002-core-starts-with-every-sim-run.md)).
- The watcher shows the core's CPU and memory use beside its own, because a pilot who rarely flies with a crew will ask why it runs all day ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).

A Crosscheck developer runs a whole session on one PC, with two cores, each with its own ports and identity ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)).
Node 1's walk through a session reopened node 1.2 on 2026-10-09, because the port file named the core by a process ID Windows may reuse ([architecture plan](../areas/architecture/plan.md#12-communication)).

## Options

1. **The CommBus, as the sim's pages use.**
   The CommBus joins modules, panel JavaScript, and SimConnect clients ([05-02](../learn/foundations/05-02-simconnect-and-the-commbus.md#the-commbus-wasm-to-js-to-wasm)), and the desktop app and the watcher hold no SimConnect connection, so it can't reach them.
2. **A port file that names the core by its process ID.**
   A crashed core leaves its port file behind, and a process's ID "may be reused" once "all handles to the process are closed and the process object is freed" (documented, [PROCESS_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information)), so the ID alone could name another program, and a restarted core could find it and exit.
3. **A port file that names the core by its process ID and its process's creation time.**
   Every reader of the file has to match both ([01-spine](../areas/architecture/01-spine.md#finding-the-core)).

## Decision

Option 3.
A file reaches the two programs the CommBus can't, and a development core with a data folder of its own gets a file of its own, so it runs beside the pilot's.
The creation time tells a running core from another process that took a crashed core's ID, the same way a run of the sim is named by its process's ID and creation time ([decision 022](022-random-uuids-as-text.md)).

## What it commits us to

- A pilot's PC runs one core, and a development core with a data folder of its own runs beside it ([01-spine](../areas/architecture/01-spine.md#finding-the-core)).
- The desktop app starts the core when the file names no running process with that ID and creation time, and waits for the file to be written again ([01-spine](../areas/architecture/01-spine.md#the-watcher-and-the-desktop-app)).
- The watcher opens no socket to the core, and reads what its jobs need from files beside the port file ([decision 015](015-watcher-reads-files-core-writes.md)).
