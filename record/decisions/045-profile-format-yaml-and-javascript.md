# 045: A profile is YAML whose script is JavaScript, where names only name and only `write()` writes

A profile is one YAML file, and its values that name or write something in the sim are JavaScript calling Crosscheck's globals: `L()`, `A()`, `B()`, `K()`, and `H()` name, with the names quoted, and `write()` is the one call that writes, a plugin's writes included.
Every entry's `write:` is required, and the core, CI, and the IDE run one checker, so a load fails on anything that breaks a rule.
Decided by the user on 2026-10-11 and 2026-10-12, in node 4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-profile-is-yaml-whose-script-is-javascript-where-names-only-name-and-only-write-writes).

## Context

A profile describes an aircraft's cockpit so Crosscheck can sync it, in the shape [01-profile-entries](../areas/sync/01-profile-entries.md) gives it: a block of state entries, a block of event entries, and a writer.
Step 7's exit asks for its syntax and file layout ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)), and profiles will come from the community ([01-profile-entries](../areas/sync/01-profile-entries.md#the-writer-api)).

Our earlier work shows what a format can cost:

- FS Copilot's format guessed a setter's kind from its characters and fell back silently, emptied a whole profile on one unknown key, and ran a repeated name as two subscriptions (fsc-editor, `docs/fscopilot-behavior.md` and `docs/sim-vars/18-language-core.md`).
- 15,933 of the 26,533 entries in FS Copilot's profiles, 60%, write through the calculator code the format generates (measured across those profiles, fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-08-25, "A setter is a script, and most entries do not have one"), and the engine can't pace, order, or recognize as its own a write hidden in calculator code ([01-profile-entries](../areas/sync/01-profile-entries.md#the-writer-api)).
- The Fenix's A319, A320, and A321 are presets of one folder, `FNX_32X`, and both pilots must fly the same preset (read in fnx-aircraft-320 2.4.0.4720, [Fenix study](../areas/aircraft/fenix-a320-family/study.md#identity)), while FS Copilot keeps only the folder from the path the sim reports (read in the FS Copilot fork, `FsCopilot/Connection/SimConnectConsumer.cs`, `PushAircraft`).

## Options

The language of a profile's script:

1. **FS Copilot's format, with setters in calculator code.**
   It brings the failures above, and the engine can't see the writes it hides.
2. **A grammar of our own, in which names go unquoted.**
   Every condition in a write function would be a feature to build (user, 2026-10-11).
3. **YAML, with JavaScript wherever a value names or writes something, and the names quoted.**
   Quoted names keep one real language, which QuickJS-ng runs and TypeScript checks as written (user, 2026-10-11).

Required fields:

4. **An optional `write`, with no `write` meaning a watch-only entry, as 01-profile-entries had it.**
   A forgotten `write` makes an entry watch-only without a word ([01-profile-entries](../areas/sync/01-profile-entries.md#what-the-ide-does-with-a-profile)).
5. **An optional `wrap` on a map that steps.**
   A forgotten one makes a heading bug that crosses north by 359 steps the long way (user, 2026-10-12).

A control no variable shows:

6. **Leave counting events into a shadow value to a later release.**
   The first aircraft after the 58P with a control no variable shows would wait for a Crosscheck release before its profile could be written (user, 2026-10-12).

A variant:

7. **A SimObjects folder alone, as FS Copilot keeps it.**
   A folder alone can't tell the Fenix's variants apart (the root's walk, 2026-10-12).

## Decision

Option 3, with `write` and `wrap` required, counting into a shadow value in v1's format, and variants named by folder or preset.
YAML is easy for a simmer who doesn't code, and functions let the IDE guide and check a strict API (user, 2026-10-11).
Names that only name and one call that writes let the engine see every write, which it marks as its own, paces, orders, and checks ([01-profile-entries](../areas/sync/01-profile-entries.md#the-writer-api)).
A required `write`, with `none` for watch-only, turns a forgotten `write` into a load error, and a required `wrap` does the same for a forgotten `wrap` (user, 2026-10-12).

## What it commits us to

- A run's plain `write()` calls go out together, in call order, and only a chain spaces them.
- An entry's `write:` is a name, a map for `toggle` or `inc` and `dec`, a plugin's write method, a function `(value) => …` that reads the global `state` and returns nothing, or, on a state entry, `none` for a watch-only entry ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#event-entries)).
- A state entry whose value no variable shows counts events into a shadow value starting from `default`, and `wrap` and `range` appear only in a map that steps or counts, `wrap` required in each but a counted entry's stepping write, which takes the count's ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#counting-into-a-shadow-value)).
- An entry's direction is `owner`, `pilot_flying` or `shared` by default, and the entries of the PF, the pilot flying, are the engine levers and trim, since the yoke, rudder, and toe brakes travel in the flight model's samples ([decision 035](035-channels-declare-how-they-travel.md)).
- An `aircraft:` header maps variant IDs to SimObjects folders, or to presets inside one, which entries and seats select with `only`.
- A profile imports modules by path, and a module carries no `only` or `location`.
- Profiles and modules live as flat files in one public repository ([decision 021](021-profiles-and-plugins-apart-from-releases.md)).
- What fails a load is [01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#what-fails-a-load)'s list, which the core, CI, and the IDE all check.
- It gives [01-profile-entries](../areas/sync/01-profile-entries.md) the syntax and file layout that step 7's exit names ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)).
- It leaves to the core's stage of step 8 whether the core tells which preset loaded from the path the sim reports or from `A:TITLE`.
- It leaves settings on following machines, a request field, a plugin's changes to aircraft files, libraries that plugins share, reading client data, and locations for a module's entries, each until a profile or plugin needs it.
- It leaves to sync's stage of step 8 how the sync engine checks a write, tells its own echo from a pilot's change, retries, follows a moving knob, and runs write functions, settled on a two-instance bench, starting from one attempt per write and one run of a function per value, with the cases [01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#checking-a-write) lists (user, 2026-10-12).
