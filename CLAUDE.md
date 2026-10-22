# Dual Input

Dual Input is a shared cockpit for Microsoft Flight Simulator: two pilots on two PCs flying one aircraft, each seeing the other's switches, knobs, and displays move.
Don't write product code until a plan in `record/` has a stage for it.
Until a decision in `record/decisions/` picks them, propose a language, framework, or architecture rather than choosing one.

## Layout

- `src/` holds the product's code, in the folders [the workspace](record/areas/architecture/02-code-map.md#the-workspace) lays out, and `tools/` holds what builds, checks, and tests it, so a new part of Dual Input goes in a folder under `src/`, never a new one at the root.
- `docs/` is reserved for documentation people write for other people.
  Create or edit it only when asked, and keep the author's voice.
- `record/` holds the documents agents write.
  [record/index.md](record/index.md) is the map.
  Keep its top level to `index.md`, `decisions/`, `learn/`, and `areas/`, and give each part of Dual Input a folder under `areas/`, so twenty areas don't bury the rest.
- `experiments/` holds probes and prototypes, and their raw results, in `experiments/areas/<area>/`, the same path the area has under `record/`.
  A finding worth keeping goes in the area's log in `record/areas/<area>/`, and the area's README links to that log and says nothing else that can go stale.
  `experiments/tools/` drives the sim's inspector on 127.0.0.1:19999, which runs JavaScript in any panel, so a panel probe needs no one to paste it.
- `.claude/rules/` holds the conventions agents follow, and Claude Code loads the files there on its own.
  `writing.md` is how everything agents write is written, and it loads into every session.
  `chapter-guide.md` is how a learning chapter is written, and it loads when a file in `record/learn/` is read.
- `tools/prose-lint.mjs` makes the mechanical checks from writing.md, on Markdown and on the comments in code.
  A hook runs it after every edit, and its findings come back to you as context.
- `.claude/agents/doc-reviewer.md` makes the judgment checks the lint can't.
- `.claude/agents/code-reviewer.md` checks product code against its plan stage, its design doc, and the rules below.
  If an agent in `.claude/agents/` isn't available as an agent type, which happens when its definition was added after the session started, run a general-purpose agent told to read that definition and act as that agent, in the background if its front matter says `background: true`.
- `.claude/skills/resume/` picks up work on one area of `record/areas/` from its plan, its log, or both (`/resume <area>`).
- `.claude/skills/learn/` writes one chapter of the learning material (`/learn <course> <part>`), running the `chapter-writer` agent, then the `fact-checker` on full-depth sections.
- `.claude/skills/stage-map/` makes a build stage's map, the page the user reads before the stage's diff (`/stage-map <stage>`).
- `.claude/skills/study-aircraft/` studies one aircraft from every file of it we can open (`/study-aircraft <aircraft>`).
  Start a background subagent per aircraft and have it invoke the skill, because a study fills a whole context.
  When it reports, commit its folder and mark it in `record/areas/aircraft/plan.md`.

## Targets

Dual Input supports MSFS 2024 only.
Don't spend effort on MSFS 2020 compatibility, and don't assume a 2020 source holds for 2024.

## Prior work

Before Dual Input we worked on FS Copilot, another shared-cockpit app, and on tools around it.
Before designing a probe or planning a sim session, search their records, because they hold measured answers to many of the questions we'll have.
They're sibling checkouts on the development machine.
Read and run them, but don't edit their files, commit, or switch branches there, because each has its own work in progress.
Build output and logs from running them are fine.

| Path | What's there | Cite as |
| --- | --- | --- |
| `../fsc/src/record/` | Findings from our FS Copilot work: pointer forwarding, WASM displays, traffic and ATC, the exerciser, and a self-hosted relay. `conventions.md` holds the rules that work followed. | FS Copilot fork |
| `../fsc/src/` | The FS Copilot fork, on one `main` branch: a C# desktop app, a WASM bridge module, a JavaScript panel bridge, and a relay. | FS Copilot fork |
| `../fsc/profiles/` | FS Copilot aircraft profiles, architecture notes in `docs/`, and MSFS simulation-variable reference pages as PDFs in `docs-msfs/`. | FS Copilot profiles |
| `../fsc-editor/` | A profile editor with its own SimConnect link (`src/main/sim/`), WASM module (`link/`), and relay (`relay/`). `docs/sim-vars/build/v1-log.md` is our most detailed record of how the sim behaves. | fsc-editor |
| `../fsc-exerciser/` | A test bench that plays the second pilot on the same machine. | fsc-exerciser |

When the record uses one of their findings, restate it and cite it as [Evidence](.claude/rules/writing.md#evidence) describes, using the names in the last column.

Some of these records contradict each other.
Prefer the one anchored in source code or a measurement, and say which you used.
FS Copilot's aircraft profiles come from community contributors with varying experience of each aircraft, so treat a profile's claim as a lead to check, not as evidence.

## Working rules

**Batch everything that needs the simulator into one deliberate session.**
Getting MSFS into a flight with the right aircraft and panel takes a person minutes.
Write each probe to answer as much as it can in one run, and print a report that stands on its own.
`SimConnect_FlightLoad` can switch the aircraft without a person, but MSFS 2024 crashed on 5 of about 30 such loads ([aircraft log](record/areas/aircraft/log.md)), so plan on someone nearby to relaunch it.

**Product code never imports from `experiments/`.**
A prototype that works reaches the product through a plan stage that rebuilds it, so a prototype's shortcuts never ship.
An experiment needs no plan and no decision on language: run it, and write down only what's worth keeping.
Probes are Node `.mjs` files and panel `.js` files.

**Group a folder's files by what they're for once the plan shows it growing past about a dozen.**
Name each group's folder, and each file, for what it holds, as in `edges/timer.rs` and `data_folder.rs`, and in Rust put `edges.rs` beside `edges/` rather than an `edges/mod.rs`.
`src/apps/core/src` reached 17 flat files, among them `data.rs` and `built.rs`, which hid what belonged together, while a folder made for files that won't grow only adds nesting.

**Name everything the sim shares `DUALINPUT_<KIND>_<NAME>`.**
That covers panel globals, CommBus events, client data areas, and `L:` variables.
Every package in the Community folder shares these namespaces, and FS Copilot's `FSC_` and fsc-editor's `FSCEDITOR_` are already in use there.
The kind is what owns the name, from the list in [02-code-map](record/areas/architecture/02-code-map.md#names-the-sim-shares), or a probe's ID such as `P08`, so a reader can tell a routine's slot from the module's own, and names of two kinds never collide.
Probes from before 2026-10-19 keep `CROSSCHECK_`, the product's earlier name, as [writing.md](.claude/rules/writing.md#voice) says.

**Never delete as a side effect.**
Deleting a file, or running `git checkout`, `restore`, `stash`, or `reset` on a path, is its own proposal: ask first, and say why.
Uncommitted work these discard can't be recovered, so anything else that discards it, such as `git clean` or `Remove-Item`, is a proposal too.

**Commit only the changes you made.**
Other sessions edit files in this working tree too, so `git add -A` would put their unfinished work in your commit.
Before you commit or rebase, run `git status --short`.
Stage by explicit path, never with `git add -A` or `git add .`, and tell the user which changes you left out.
If a change you didn't make is in a file you're about to edit, stop and ask.

**Never create a merge commit.**
A merge commit turns the history into a graph, which `git log` and `git bisect` read worse than a line.
To bring a branch up to date, rebase it onto `origin/main`, and push a rebased branch with `--force-with-lease`.
If the tree holds changes you didn't make, stop and ask before rebasing, because git won't rebase over them without a stash.
Don't run `git merge`, or `git pull` without `--rebase`.
The Claude desktop app's `sync_with_base_branch` tool merges too, so don't use it.

**Ask before a code review.**
After writing or substantially changing product code, ask the user whether to run the `code-reviewer` agent, because the user decides which changes are worth a review.
Experiments get none.

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

MSFS 2024 runs panel code in Coherent GT, whose user agent says Chrome 49 while its features match no browser, so go by [its measured limits](record/areas/architecture/coherent-gt.md), not a browser version.
A syntax error there takes out the whole file rather than one line: FS Copilot's `VCockpit.js`, the one file loaded into every panel, sat unparseable for two commits (FS Copilot fork, `record/conventions.md`).
So write TypeScript compiled to `es2017`, or JavaScript, and in either keep to ES2017's syntax, which the reference shows the engine parses, because a compiler leaves ES2018's regex features broken.
Use no built-in or web API it lists as missing or as filled in only in some documents, such as `globalThis` and `Promise.prototype.finally`.

Run `node --check` on every panel file before packaging it.
It catches a file that doesn't parse at all, but not newer syntax such as `?.`, which Node accepts, so check hand-written panel JavaScript against the reference's syntax table.

Anything injected into the pilot's own input path must fail open.
In our FS Copilot work, a probe that wrapped a sim API to suppress input was left installed and disabled the aircraft's clicks, and the handle to undo it had already been deleted (FS Copilot fork, `record/pointer-forwarding/docs/13-pr-prep.md`, "13 · Dead ends").
So clear suppressing state unconditionally, expose a restore function at a fixed global that survives losing every other handle (FS Copilot's is `window.fscUnlock()`), and add a deadman timer that uninstalls the injection on its own.
