# 015: The watcher reads what its jobs need from files the core writes

Beside the port file, the core writes what the watcher's jobs need, the date of the pilot's last session.
The watcher reads it, and opens no socket to the core.
Decided by the user on 2026-10-09, in node 1.2 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-watcher-reads-what-its-jobs-need-from-files-the-core-writes).

## Context

The watcher warns, in a Windows notification early in the sim's load, that a waiting update will need a sim restart, and it warns only a pilot who has flown with Dual Input lately, judged by the date of their last session ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
The core knows when the pilot last flew, but it may not be running ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
Node 1's walk through a session reopened node 1.2 on 2026-10-09, because the watcher had no way to learn what its jobs need from the core ([architecture plan](../areas/architecture/plan.md#12-communication)).

## Options

1. **The watcher asks the core over a socket, as the desktop app does.**
   The core may not be running when the watcher needs the date ([01-spine](../areas/architecture/01-spine.md#components-with-no-session)).
2. **The core writes the date to a file beside the port file, and the watcher reads it.**
   The file is there whether or not the core runs.

## Decision

Option 2.
The watcher's warning needs the date whether or not the core runs, and a file the core writes holds it either way, where a socket needs the core up.

## What it commits us to

- The date of the pilot's last session is the one wall-clock date a component compares with today ([01-spine](../areas/architecture/01-spine.md#times)).
- The watcher sends the core nothing, so the core can't tell whether the watcher runs ([01-spine](../areas/architecture/01-spine.md#how-the-core-knows-a-component-is-alive)).
- How recent a last session has to be for the watcher to warn stays open, as [installing and updating](../areas/product/03-v1-scope.md#installing-and-updating) leaves it.
- Plugins' changes to aircraft files, which the watcher would apply before the sim boots from files the core writes, wait with how a plugin changes an aircraft's files ([decision 020](020-plugin-code-runs-only-in-core.md)).
