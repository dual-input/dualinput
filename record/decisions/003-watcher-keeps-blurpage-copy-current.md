# 003: The watcher keeps the BlurPage copy current

The watcher, not the core, makes our copy of the sim's BlurPage component from the sim's own file, watches that file, and makes the copy again whenever the file's hash differs from the one the copy was made from.
Decided by the user on 2026-10-07, in node 1.1 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-watcher-keeps-the-blurpage-copy-current).

## Context

Our script reaches the main menu's document through a copy of one of the sim's UI components, and BlurPage is the one we copy, because it's the smallest component loaded from the first screen and the plainest, with nothing a mod would change (user, 2026-10-06).
With only our copy of BlurPage installed, our script ran the whole join from a closed sim to Ready to fly, with nobody at the sim (measured on MSFS 2024, 2026-10-06, [interface log](../areas/interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)), and that script is what preflight's Go to button runs ([preflight](../areas/product/03-v1-scope.md#preflight)).

Two facts decide who makes the copy:

- The copy has to follow the sim's own file.
  The sim's copies are files in its install folder, `Packages/fs-base-ui/cookedcomps/{GUID}.html` and `.json`, and on 2026-10-06 Flow Pro's copy of the start page had older element ids than the sim's, so a copy shipped once falls behind the sim's updates ([interface log](../areas/interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
- The copy has to be right before the sim starts, because the sim loads a package only when it boots ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).

## Options

1. **Ship one copy in our package, as Flow Pro ships its copy of the start page.**
   The copy falls behind the sim's updates, as Flow Pro's had.
2. **Have the core make the copy from the sim's own file, at install, at each start, and before it launches the sim, whenever the stock file's hash differs from the one the copy was made from,** as the [interface log's 2026-10-06 entry](../areas/interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly) gave it.
   The core starts when the sim does ([decision 002](002-core-starts-with-every-sim-run.md)), so it may not be running yet when the copy has to be right, before the sim boots.
3. **Have the watcher make the copy, watch the sim's file, and make the copy again whenever the file's hash differs.**
   The watcher starts with Windows, for the pilot's own account, as a setting the pilot can turn off (user, 2026-10-06; [installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)), so it runs before the sim starts unless the pilot has turned it off.

## Decision

Option 3.
The copy has to be right before the sim boots, when the core may not be running yet, and the watcher, which starts with Windows, runs then.
This changes the interface log's 2026-10-06 entry, which gives the job to the core.

## What it commits us to

- There's no fallback.
  When a sim update removes BlurPage or stops MasterPage placing it, or another package copies it, Dual Input has no copy installed, and the Go to button is unavailable and says why until a Dual Input release picks another component (user, 2026-10-06; [preflight](../areas/product/03-v1-scope.md#preflight)).
- The watcher tells a pilot who chooses to quit it what quitting costs, such as Go to staying off after a sim update until Dual Input runs again ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
- This decision leaves open whether a sim update can change `fs-base-ui` while the sim boots, after the watcher's last check, which no run has tried ([interface log](../areas/interface/log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)).
- No run has tried the Microsoft Store edition either, whose install folder may not be readable (same entry).
