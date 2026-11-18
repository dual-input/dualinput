# p31 procedure: what each tool costs one PC

This runs p31 on the sim's PC: three runs of the same flight, one with no tool, one with FS Copilot, and one with Dual Input, then a report of the sim's frame times and each tool's CPU, memory, and network side by side.
The builds take a while the first time and need no one; the runs need you at the sim for about 40 minutes.

Each run starts the sim through Steam, asks aloud for the flight, measures for 5 minutes, then closes the sim itself.
While it measures, keep your hands off the mouse and keyboard: a beep starts the 5.5 minutes, and a high beep ends them.

## Before you start

- Close the sim.
- Close anything that would move the camera or load the PC: ChasePlane, BeyondATC, SayIntentions, GSX, a torrent client, and any game.
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
   If something other than the sim or a tool is busy, close it.

3. Build what the runs need, with the sim closed.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts prepare
   ```

   It installs main's package into Community, builds the pilot's core with the release profile and the bench's second pilot, and copies FS Copilot with your 58P profile into `target\p31\fsc`.
   In a checkout that has never built, this compiles everything from nothing, so start it and come back.
   You're done when it prints `copied FS Copilot into target\p31\fsc`.

4. Run with no tool.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts none
   ```

   The sim starts, and a voice asks for the flight: the Black Square Baron 58P at Seymour, SEGS, on runway 14, weather preset Clear Skies, time at noon.
   Press Ready to fly, start the engines if they aren't running, set the parking brake, stay in the cockpit view, and press Page Up.
   If the voice asks, click once on the sim's window.
   Then keep your hands off until the high beep, after which the sim closes.
   You're done when the terminal prints where the numbers are.

5. Run with FS Copilot.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts fsc
   ```

   FS Copilot and fsc-exerciser open their windows first, and the exerciser joins FS Copilot's session on a local relay.
   Then the same flight as step 4, and the same hands-off window.

6. Run with Dual Input.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts dualinput
   ```

   The pilot's core and a bench core as the second pilot start first, with no windows.
   After you press Page Up, the run hosts a session, the second pilot joins and takes the copilot's seat, and preflight ends, which takes up to 2 minutes.
   Then the same hands-off window.

7. If you have 15 minutes left, run with no tool again.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts none
   ```

   A second run with no tool shows how far the PC drifted across the runs, so the report can tell a tool's cost from drift.

8. Put Community back and write the report.

   ```powershell
   node experiments/areas/product/p31-tool-cost/run.ts finish
   ```

   It moves `dualinput` and `fscopilot-bridge` back into Community, and prints the report it wrote to `experiments/areas/product/results/`.

## If a run stops partway

- If the sim is still running, quit it.
- Run the same step again.
  Each run sets Community as it needs, so nothing has to be undone first.
- If you stop for the day, run step 8, which puts both packages back.
  Until then they may sit in `dualinput-p31-aside`, beside your Community folder, and nothing deletes them.
