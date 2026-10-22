---
name: study-aircraft
description: Studies how one MSFS 2024 aircraft is built, from every file of it we can open, decompiled WASM and JavaScript included, and writes the study to record/areas/aircraft/<aircraft>/. Use when the user asks to study or research an aircraft, for example "/study-aircraft synaptic-a220", or "/study-aircraft synaptic-a220 the EFB" to take one part deeper. A study fills a whole context, so start a background subagent per aircraft and have it invoke this skill, rather than running it in your own session.
argument-hint: <aircraft> [focus]
---

# Study one aircraft

You study one aircraft: how it's built, where its state lives, and what changes that state.
Dual Input will later decide how two pilots share its cockpit, and no question is fixed yet, so your judgment decides what matters.

The aircraft is `$0`, the name of its folder in `record/areas/aircraft/`.
An aircraft studied before has that folder already.
For a new one, the name is `<vendor>-<aircraft>` in kebab-case, such as `pmdg-777-300er`.
Any words after the name in `$ARGUMENTS` are a focus: the part of the aircraft to take deeper.

You write to two folders:

- `record/areas/aircraft/$0/` holds `study.md`, `files.md`, and `inventory/`, and goes public.
  Identifiers and short strings from the vendor's files can go there, and the vendor's code can't.
- `experiments/sim-sources/aircraft/$0/<version>/` is gitignored, and holds the vendor's files as decoded text, and your `notes.md`, which may quote them.
  `<version>` is the main package's `package_version`.

## Prepare

1. Read `.claude/rules/writing.md` in full, then `${CLAUDE_SKILL_DIR}/template.md`, which says what a study covers.
2. Read the Prior work section of `CLAUDE.md`, then `record/learn/foundations/02-01-installs-and-packages.md` and `record/learn/foundations/07-aircraft-specific-systems.md`.
3. Run `node ${CLAUDE_SKILL_DIR}/scripts/setup.mjs`, which fetches any missing tool into the skill's `bin/`.
   If it fails, stop and report its error.

## Decide what this run does

- **No `study.md`:** study the aircraft from the start.
- **`files.md` has rows with no status:** an earlier run stopped partway.
  Read its `notes.md`, and carry on from the first row with no status.
- **The study names an older package version than the one installed:** study the aircraft again at the new version, in a new gitignored folder, and edit the study in place.
- **The study is current and complete:** if there's a focus, take that part deeper and add to the study.
  If there's none, report that the study is current, and stop.

## Find every file

1. Read `InstalledPackagesPath` from `UserCfg.opt`, as 02-01 describes, and find every package of the aircraft in `Community`, `Official2024`, and `StreamedPackages`.
   Count the livery packages, and open one to see what a livery carries, rather than decoding each.
2. Look for the aircraft's files outside its packages: its WASM work folder under `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\`, and a vendor install in `Program Files`, `ProgramData`, or `Documents`.
   Search only folders you name, and never run `find` or any recursive walk from `/` or a drive root, because on our development machine it reaches a vJoy driver that crashes Windows.
3. If the aircraft is the FlyByWire A32NX, find the newest `v2024.*` release of https://github.com/flybywiresim/aircraft that isn't a pre-release, and clone that tag into your gitignored folder with `git clone --depth 1 --branch <tag>`.
   Its source is what you study, because the aircraft isn't installed, and the history would add gigabytes you won't read.

## Decode

1. Run `node ${CLAUDE_SKILL_DIR}/scripts/decode.mjs <your gitignored folder> <folder> ...`, passing every folder you found.
   It turns WASM modules into their imports, exports, names, strings, and decompiled code, reformats minified JavaScript, copies other text, and lists every file with what it did in `decode-report.tsv`.
2. Write `files.md` from that report: one row per file of code, configuration, behavior, or documentation, and one row per group of art, sound, or model files, with a count and a total size.
   Each row gets a status as you go: read, skimmed, skipped with the reason, or unreadable with the reason.
   A rerun resumes from this file, so keep it current.
3. For a file the script left alone that you need, use what you have: read a PDF with the Read tool, or its text with `pdftotext`.
   Check each `.fsarchive` header: a Marketplace package can mark some archives `notEncrypted`, storing their files uncompressed and listed in the header's index, as two of the iniBuilds A380's seven were (its study's Code architecture section says how to read them).
   Leave an encrypted archive shut, because a way to open it would open every product on the Marketplace.
   If it needs a tool we don't have, such as a .NET decompiler, mark it unreadable, name the tool, and report it.
   Don't install anything.

A decompiled module past a few MB is too big to read whole.
Start from its `.objdump.txt`: the imports say which sim APIs it calls, and the function names, where it has them, map its systems.
Then search its `.strings.txt` and `.dcmp` for the names you're following, and read the functions that use them.

A name in a module's strings says the module knows it, not what the module does with it, and the direction is what Dual Input needs.
So find the module's wrappers around the imports that register names with the sim, such as `SimConnect_AddToDataDefinition`, `SimConnect_MapClientEventToSimEvent`, and `SimConnect_AddClientEventToNotificationGroup`, and resolve every call site.
Record each variable as read or written, by which data definition `SimConnect_RequestDataOnSimObject` and `SimConnect_SetDataOnSimObject` use, and each event as listened for, listened for and masked, or only sent.
A module copies each name from its data segment into a buffer just before the call, but builds a name of 8 bytes or fewer from an integer constant, which a strings search misses, so decode the constants stored into the buffer too.


## Read

Read in this order, because each step tells you where to look in the next:

1. The vendor's documentation, and each package's `manifest.json`.
2. Configuration: `aircraft.cfg`, `panel.cfg`, `systems.cfg`, `flight_model.cfg`, and the rest.
3. Model behaviors: input events, mouse callbacks, and the variables and events they use.
4. Instrument code: the gauges `panel.cfg` names, and their HTML and JavaScript.
5. WASM modules.
6. Programs that run outside the sim.
7. Our prior records on this aircraft, including every copy of its FS Copilot profile: `../fsc/profiles/definitions/` and the fork's `../fsc/ahead/Definitions/` can hold different versions.
   Take the newest by its `Updated:` line, and cite an older copy only where it differs.
   FS Copilot's profiles come from community contributors with varying experience of each aircraft, so treat a profile's claim as a lead to check in the files, not as evidence.
   In `notes.md`, list every concrete claim each prior source makes about the aircraft, with a status: confirmed, contradicted, unsettled, or not checked.
   Where our records measured something the files also say, compare the two and explain each difference.
8. The web: the vendor's SDK pages, manuals, and forums, marked unverified.

The template's sections are the least a study covers.
Where this aircraft does something none of them fits, give it a section of its own.
Write what you find to `notes.md` as you read, because a long read outlasts your memory of its start.

## Write

1. Write each name list you pulled, such as input events, `L:` variables, CommBus names, or a module's imports, to its own plain-text file in `inventory/`.
   Its first line says which package, version, file, and method it came from, and each name carries its direction where the files say it.
2. Write `study.md` from the template, citing each claim as the Evidence section of writing.md says.
3. Run `node tools/prose-lint.mjs` on each Markdown file, fix what it reports, and do steps 1 and 2 of Finishing a document in writing.md.
   Then check every sentence that cites one of our measurements against the log entry it cites, because a study read from files can outrun what was measured.
4. Search what you wrote for a username, a home folder path, or a machine name, and replace each path with a placeholder such as `%APPDATA%`.
5. Last, find the aircraft's license, in its packages, its installer, or on the vendor's site.
   If it restricts reverse engineering, decompiling, or publishing what we found, add a License section at the end of the study that names the clause and links to it.

Don't commit, and don't edit `record/areas/aircraft/plan.md`.
Several studies can run at once in separate subagents, and they'd collide on git's lock and on the plan's table, so the session that started the study does both after you report.

## Report

Return:

- the study's path and word count
- the number of sim questions
- each file in `files.md` not read or skimmed, with the reason
- the license finding
- the folder to commit, `record/areas/aircraft/$0/`

Don't paste the study.
