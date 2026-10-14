# 020: Plugin code runs only in the core

A plugin is TypeScript that implements an interface of ours and runs only in the core, in QuickJS-ng embedded there under memory and time limits ([decision 018](018-rust-and-typescript.md)), and it reaches the cockpit panels, the WASM module, and the sim only through APIs our own code carries out, and never the pilot's files or the network.
Nothing a plugin ships runs in a panel or in the module: for something inside the sim's frame, our module offers mechanisms the plugin drives, and for something in a panel, our panel bridge offers generic operations.
Decided by the user on 2026-10-08 and 2026-10-11, in nodes 1.3 and 4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#plugin-code-runs-only-in-the-core).

## Context

[03-v1-scope](../areas/product/03-v1-scope.md#plugins) left open where each part of a plugin runs, in the core, in the aircraft's panels, or in a WASM module, and what language plugins are written in.
v1 has one plugin, the Baron 58P's, whose first candidate job is to find radio settings that live only in its gauges' JavaScript and export them as values its profile syncs (same section).
[04-room-for-later](../areas/product/04-room-for-later.md#code-inside-the-sim) gives plugins hooks in the panels and in the WASM module, both hosts that load modules by name, and lets a plugin read the sim, the aircraft's panels, and the pilot's files directly where no hook reaches, since we review every plugin ([04-room-for-later](../areas/product/04-room-for-later.md#plugins)).
Profiles and plugins reach pilots from one public repository, apart from Crosscheck's releases ([decision 021](021-profiles-and-plugins-apart-from-releases.md)).

## Options

1. **Plugin code in the panels and the WASM module too, which load its modules by name,** as [04-room-for-later](../areas/product/04-room-for-later.md#code-inside-the-sim) gives it.
   Frame logic and panel code for one aircraft would run inside our module and our panel bridge, against the rule that Crosscheck's own code owns each mechanism and a plugin owns the policy ([04-room-for-later](../areas/product/04-room-for-later.md#plugins)).
   The WASM module and the panel bridge load only when the sim boots or a panel loads, while a plugin that's only JavaScript and data can reach pilots apart from Crosscheck's releases.
2. **Plugin code only in the core, with the pilot's files and the network open to it.**
   A plugin that read the pilot's files, published from a hijacked repository, could pass them to a crewmate over a channel, so plugins would need signing, and a signature would help only with a key kept off GitHub, a manual step in every publish (user, 2026-10-11).
3. **Plugin code only in the core, reaching the panels, the module, and the sim through our APIs, and never the pilot's files or the network.**
   A plugin's logic inside the sim's frame is limited to what our module offers, such as calculator code, and the 58P's plugin is expected to read its gauges' JavaScript and DataStorage through our panel bridge and need no files, which is unverified until a panel probe reaches those settings (user, 2026-10-11).

## Decision

Option 3.
Plugins implement a framework API, the way a class implements an interface, and their code runs only in the core's engine; when a plugin needs something done in panel code, we offer the API, and our own panel code carries it out (user, 2026-10-08).
Our generic panel code then keeps the fail-open rules for anything in the pilot's input path ([CLAUDE.md](../../CLAUDE.md#before-writing-code-that-runs-in-a-panel)), whatever a plugin asks of it.
With no files or network, a plugin can do no worse than a profile, which only spoils a flight, so neither needs signing (user, 2026-10-11).

## What it commits us to

- A plugin belongs to one profile and sits beside it, runs on every variant the profile covers, and writes only through `write()`, with the panel bridge's operations among its targets ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#plugins)).
- For something inside the sim's frame, our module offers mechanisms the plugin drives, such as writing given variables every frame, running given calculator code, or placing an object.
  The one call that runs calculator code, `execute_calculator_code`, is deprecated with no replacement ([05-01](../learn/foundations/05-01-kinds-lifecycle-and-apis.md#the-gauge-api-and-its-replacements)), and it ran on MSFS 2024 on 2026-08-25 (measured, fsc-editor, `docs/sim-vars/build/v1-log.md`, "2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean").
- A plugin runs in a QuickJS-ng runtime of its own, under limits of its own ([decision 046](046-sandbox-runtimes-and-limits.md)).
- This changes [04-room-for-later](../areas/product/04-room-for-later.md#code-inside-the-sim), which gives plugins hooks in the panels and in the WASM module that load their modules by name, and the rule in 04-room-for-later's [plugins](../areas/product/04-room-for-later.md#plugins) and 03-v1-scope's [plugins](../areas/product/03-v1-scope.md#plugins) that a plugin may read the pilot's files directly, and it answers [03-v1-scope](../areas/product/03-v1-scope.md#plugins)'s question of where each part of a plugin runs.
- This decision leaves out which APIs our panel bridge and module offer, for the part that designs plugins; the Baron 58P's plugin is the first case, and its profile settles what it needs ([plugins](../areas/product/03-v1-scope.md#plugins)).
- It leaves out a plugin that needs logic inside the frame beyond what calculator code expresses, which no v1 plugin is known to need.
- It leaves out how a plugin changes an aircraft's files, which waits until a plugin needs it, with [decision 001](001-changing-other-developers-packages.md) holding meanwhile (user, 2026-10-11).
