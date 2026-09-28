# Crosscheck

Crosscheck is a shared cockpit for Microsoft Flight Simulator: two pilots on two PCs flying one aircraft, each seeing the other's switches, knobs, and displays move.
Don't write product code until a plan in `record/` has a stage for it.
Until a decision in `record/decisions/` picks them, propose a language, framework, or architecture rather than choosing one.

@record/writing.md

## Layout

- `docs/` is reserved for documentation people write for other people.
  Create or edit it only when asked, and keep the author's voice.
- `record/` holds the documents agents write.
  [record/index.md](record/index.md) is the map.
  Keep its top level to `decisions/`, `learn/`, `areas/`, and the files there now, and give each part of Crosscheck a folder under `areas/`, so twenty areas don't bury the rest.
- `experiments/` holds probes and prototypes, and their raw results, in `experiments/areas/<area>/`, the same path the area has under `record/`.
  A finding worth keeping goes in the area's log in `record/areas/<area>/`, and the area's README links to that log and says nothing else that can go stale.
  `experiments/tools/` drives the sim's inspector on 127.0.0.1:19999, which runs JavaScript in any panel, so a panel probe needs no one to paste it.
- `record/writing.md` is how everything agents write is written.
  It's imported above, so it's already loaded.
- `scripts/prose-lint.mjs` makes the mechanical checks from writing.md.
  A hook runs it after every Markdown edit, and its findings come back to you as context.
- `.claude/agents/doc-reviewer.md` makes the judgment checks the lint can't.
- `.claude/skills/learn/` writes one chapter of the learning material (`/learn <part>`), running the `chapter-writer` agent, then the `fact-checker` on full-depth sections.

## Targets

Crosscheck supports MSFS 2024 only.
Don't spend effort on MSFS 2020 compatibility, and don't assume a 2020 source holds for 2024.

## Prior work

Before Crosscheck we worked on FS Copilot, another shared-cockpit app, and on tools around it.
Before designing a probe or planning a sim session, search their records, because they hold measured answers to many of the questions we'll have.
They're sibling checkouts on the development machine.
Read and run them, but don't edit their files, commit, or switch branches there, because each has its own work in progress.
Build output and logs from running them are fine.

| Path | What's there | Cite as |
| --- | --- | --- |
| `../fsc/ahead/record/` | Findings from our FS Copilot work: pointer forwarding, traffic and ATC, the exerciser, and a self-hosted relay. `conventions.md` holds the rules that work followed. | FS Copilot fork |
| `../fsc/ahead/` | The FS Copilot fork: a C# desktop app, a WASM bridge module, a JavaScript panel bridge, and a relay. | FS Copilot fork |
| `../fsc/profiles/` | FS Copilot aircraft profiles, architecture notes in `docs/`, and MSFS simulation-variable reference pages as PDFs in `docs-msfs/`. | FS Copilot profiles |
| `../fsc-editor/` | A profile editor with its own SimConnect link (`src/main/sim/`), WASM module (`link/`), and relay (`relay/`). `docs/sim-vars/build/v1-log.md` is our most detailed record of how the sim behaves. | fsc-editor |
| `../fsc-exerciser/` | A test bench that plays the second pilot on the same machine. | fsc-exerciser |

When the record uses one of their findings, restate it and cite it as [Evidence](record/writing.md#evidence) describes, using the names in the last column.

Some of these records contradict each other.
Prefer the one anchored in source code or a measurement, and say which you used.

## Working rules

**Batch everything that needs the simulator into one deliberate session.**
Getting MSFS into a flight with the right aircraft and panel takes a person minutes.
Write each probe to answer as much as it can in one run, and print a report that stands on its own.
We haven't tried loading a flight through SimConnect, and this rule loosens if that works.

**Product code never imports from `experiments/`.**
A prototype that works reaches the product through a plan stage that rebuilds it, so a prototype's shortcuts never ship.
An experiment needs no plan and no decision on language: run it, and write down only what's worth keeping.
Probes are Node `.mjs` files and panel `.js` files.

**Prefix every name the sim shares with `CROSSCHECK_`.**
That covers panel globals, CommBus events, client data areas, and `L:` variables.
Every package in the Community folder shares these namespaces, and FS Copilot's `FSC_` and fsc-editor's `FSCEDITOR_` are already in use there.

**Never delete as a side effect.**
Deleting a file, or running `git checkout`, `restore`, `stash`, or `reset` on a path, is its own proposal: ask first, and say why.
Uncommitted work these discard can't be recovered, so anything else that discards it, such as `git clean` or `Remove-Item`, is a proposal too.

**Commit at any checkpoint without asking.**
Until the repository goes public, commits are only checkpoints.
On the day it goes public, we squash the history into one commit.

**Nothing personal in the tree.**
The squash removes old commits, not the files in the last one, so everything in the tree on that day goes public.
No file in the tree may carry a username, a home folder path, a machine name, or an email address.
Before committing, run this in Git Bash.
No output means it found none of your account name, machine name, or email address:

```bash
git grep -inE --untracked "$(whoami)|$(hostname)|$(git config user.email)"
```

It can't see inside images or compressed files, so check screenshots and captures by eye before adding them.

## Before writing code that runs in a panel

MSFS 2024 panels run in Coherent GT, whose engine is Chrome 49 (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`).
These are syntax errors there, and a syntax error takes out the whole file rather than one line: optional chaining (`a?.b`), `??`, logical assignment (`||=`, `&&=`, `??=`), class fields and `#private` members, and numeric separators (`1_000`).
`Object.fromEntries`, `Array.prototype.at`, `String.prototype.replaceAll`, and `Promise.allSettled` don't exist, and fail when called.

Run `node --check` on every panel file before packaging it.
That catches a file that doesn't parse at all, the failure that once broke every instrument in the sim through a shared `VCockpit.js` (FS Copilot fork, `record/conventions.md`).
It doesn't catch syntax newer than Chrome 49, because Node accepts it.

Anything injected into the pilot's own input path must fail open.
In our FS Copilot work, a probe that wrapped a sim API to suppress input was left installed and disabled the aircraft's clicks, and the handle to undo it had already been deleted (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "13 · Dead ends").
So clear suppressing state unconditionally, expose a restore function at a fixed global that survives losing every other handle (FS Copilot's is `window.fscUnlock()`), and add a deadman timer that uninstalls the injection on its own.
