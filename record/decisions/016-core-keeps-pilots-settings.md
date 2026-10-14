# 016: The core keeps the pilot's settings

The core keeps the pilot's settings in its data folder, such as the take-control binding, the output device, and the recording mode, and reads them when it starts.
The desktop app edits them by command and decides nothing, the EFB app offers no setting in v1, and the desktop app stays the place a pilot edits the settings [03-v1-scope](../areas/product/03-v1-scope.md#efb-app) gives it, while the core keeps their values.
Decided by the user on 2026-10-09, in node 1.1 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-core-keeps-the-pilots-settings).

## Context

[03-v1-scope](../areas/product/03-v1-scope.md#efb-app) keeps the settings, binding the take-control key, the output device, and the recording mode, in the desktop app, set before the headset goes on.
The desktop app is optional, and a pilot in VR flies with it closed, while the core acts on each of those settings in flight:

- It catches the bound take-control key or button ([take-control key](../areas/product/03-v1-scope.md#take-control-key); [decision 006](006-core-catches-take-control-input.md)).
- It plays ATC "on the output device each pilot picks, with no window needed" ([hearing ATC](../areas/product/03-v1-scope.md#hearing-atc); [decision 007](007-core-runs-audio.md)).
- It records in the mode a setting chooses ([recording and bug reports](../areas/product/03-v1-scope.md#recording-and-bug-reports)).

Node 1's walk through a session found on 2026-10-09 that the core needs the pilot's settings while the optional desktop app is closed, and reopened node 1.1 ([architecture plan](../areas/architecture/plan.md#11-components)).

## Options

1. **The desktop app keeps the settings in a file of its own.**
   The values the core acts on would live with a component that shows Crosscheck's state, sends it commands, and decides nothing ([04-room-for-later](../areas/product/04-room-for-later.md#one-protocol-for-every-client)), and the core would need them while that component is closed.
2. **The core keeps the settings in its data folder, and the desktop app edits them by command.**
   The desktop app stays where a pilot edits them, and the core holds the values it acts on.

## Decision

Option 2.
The core needs the bound key, the output device, and the recording mode with the desktop app closed, and keeping them in the core leaves the desktop app a client that edits them and decides nothing ([01-spine](../areas/architecture/01-spine.md#components)).

## What it commits us to

- The desktop app edits a setting by a command over its WebSocket to the core ([01-spine](../areas/architecture/01-spine.md#communication)).
- The watcher keeps its own settings, such as whether it starts with Windows ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)), which this decision leaves out.
- Which plugins may change aircraft files waits with how a plugin changes an aircraft's files ([decision 020](020-plugin-code-runs-only-in-core.md)).
