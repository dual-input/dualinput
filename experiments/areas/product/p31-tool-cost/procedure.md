# p31 procedure: what each tool costs one PC

This runs p31 on the sim's PC with nobody at it: runs with no tool, with FS Copilot, and with Dual Input, in turn and repeated, then a report of the sim's frame times and each tool's CPU, memory, and network side by side.
You start two commands and come back to the report.

Each run starts the sim through Steam, loads the Black Square Baron 58P on runway 14 at Seymour, SEGS, sets the time to noon, measures for 5 minutes, and closes the sim.
A crash or a hang starts the run over; on its third try a voice asks for the flight by hand, and waits 10 minutes.
With the default 2 rounds the six runs take about 75 minutes, from p10's 164s from Steam to Ready to fly plus each 5-minute window, and longer for each crash.
A fourth mode, Dual Input with no figures, adds two runs, about 25 minutes, and needs a core of its own, which [Building the core with no figures](#building-the-core-with-no-figures) makes.

## Before you start

- Close the sim.
- Close anything whose load changes from minute to minute: a torrent client, any game, and any Claude session working on this PC.
- Leave running what you always fly with, such as ChasePlane or GSX, and keep everything as it is until the schedule ends, a Moonlight stream from Sunshine included.
  The comparison holds a steady load evenly across the tools, but a program started, closed, or connected partway lands on some tools' runs and not others.
- If `target\p31\PresentMon-2.6.0-x64.exe` isn't in your checkout, download it from [PresentMon's 2.6.0 release](https://github.com/GameTechDev/PresentMon/releases/tag/v2.6.0) into that folder.
  The PresentMon in NVIDIA's FrameView SDK records nothing outside FrameView.
- Keep Steam running, started as usual from the Start menu.
- Open Terminal as administrator: Win+X, then Terminal (Admin).
  PresentMon and the network trace each start an ETW session, which Windows allows only an elevated terminal.

## Steps

1. Go to your main checkout of Dual Input, on `main` and up to date with `origin/main`.

   ```powershell
   cd $env:USERPROFILE\dev\crosscheck
   ```

2. See what's ready.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts check
   ```

   You'll see a line per thing a run needs, each `ok` or `MISSING`, then the busiest processes over 5s.
   If something other than the terminal is busy, close it.

3. Build what the runs need, with the sim closed.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts prepare
   ```

   It installs main's package into Community, and builds the pilot's core with the release profile and the bench's second pilot.
   If fsc-exerciser holds an older FS Copilot than the fork's main, it builds FS Copilot and syncs the exerciser to it.
   In a checkout that has never built, this compiles everything from nothing.
   You're done when it prints `FS Copilot ... is ready to run from fsc-exerciser's copy`.

4. Start every run, and leave the PC.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts all
   ```

   It first has PresentMon time frames for 3s, and stops at once if it can't, so wait for `PresentMon traced frames in a 3s check` before you leave.
   `--repeats 3` runs a third round, about 40 minutes more.
   `--modes none,fsc,dualinput,dualinput-no-figures` adds the runs with no figures.
   You're done when it prints `Every run is done` and the report's path, in `experiments/areas/product/results/`.
   By then it has moved `dualinput` and `fscopilot-bridge` back into Community, as they were.

## Building the core with no figures

The runs with no figures use the pilot's core built with `no-figures.patch` beside run.ts, which creates no figure in the sim and changes nothing else.
The patch never goes into a commit, so the core is built in a worktree and copied into the checkout that runs the schedule.

1. In a worktree at the same commit as your main checkout, apply the patch.

   ```powershell
   git apply experiments/areas/product/p31-tool-cost/no-figures.patch
   ```

   `git diff --stat` shows one file, `src/features/avatars/core/src/crew.rs`, with 2 lines changed.

2. Build the core and its core helper into a target folder of their own, so the release core `prepare` built stays as it was.

   ```powershell
   cargo build --release -p dualinput-core -p dualinput-core-helper --target-dir target\p31-no-figures
   ```

3. Copy both programs and `SimConnect.dll` into the main checkout's `target\p31\no-figures\`.
   Without the DLL beside it, Windows ends the core before it prints anything.

   ```powershell
   New-Item -ItemType Directory -Force $env:USERPROFILE\dev\crosscheck\target\p31\no-figures
   ```

   ```powershell
   Copy-Item target\p31-no-figures\release\dualinput-core.exe, target\p31-no-figures\release\dualinput-core-helper.exe, target\p31-no-figures\release\SimConnect.dll -Destination $env:USERPROFILE\dev\crosscheck\target\p31\no-figures\
   ```

   `run.ts check` in the main checkout then says `ok` for all three files of the core with no figures.

4. Take the patch back out of the worktree.

   ```powershell
   git apply -R experiments/areas/product/p31-tool-cost/no-figures.patch
   ```

## What you'll see

- FS Copilot's runs open two FS Copilot windows before the sim starts: yours, and a second pilot's, which joins your session through a local relay and never connects to the sim.
  Both start from fsc-exerciser's copy of FS Copilot, a path Windows Firewall already allows, so no firewall prompt comes.
- Dual Input's runs start the pilot's core and a bench core as the second pilot, with no windows, then host a session once the flight is loaded.
- The sim goes from its first screen to the flight on its own: the run's code presses through the menu as a pilot would.

## If a run stops partway

- Ctrl+C stops the run and its tool, and leaves the sim open; quit it yourself.
- To finish what's measured so far, run the step below, which moves both packages back and writes the report from the runs of the last 12 hours.

  ```powershell
  node experiments/areas/product/p31-tool-cost/run.ts finish
  ```

- Until then the packages may sit in `dualinput-p31-aside`, beside your Community folder, and nothing deletes them.
