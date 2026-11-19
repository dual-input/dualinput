/*
 * Where p31 finds what it runs and puts what it writes. Our other checkouts sit beside this
 * repository's main checkout, so from a worktree under .claude/worktrees/ they're found by walking
 * up until a folder holds them.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT } from "../../../../tools/lib/repo.ts"

/** The checkout `name` beside this repository's main checkout, such as `fsc-exerciser`. */
export function sibling(name: string): string {
  for (let dir = ROOT; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    const there = path.join(path.dirname(dir), name)
    if (fs.existsSync(there)) return there
  }
  return path.resolve(ROOT, "..", name)
}

export const HERE = path.dirname(fileURLToPath(import.meta.url))
/** What a reader keeps: each run's numbers and the report, committed. */
export const RESULTS = path.join(HERE, "..", "results")
/** What only this PC needs: PresentMon and its CSVs, the network traces, and FS Copilot's working folders. */
export const WORK = path.join(ROOT, "target", "p31")

/** The FS Copilot fork's checkout, on its one main branch, which p31 only builds and reads. */
export const FSC_SOURCE = path.join(sibling("fsc"), "src")
export const FSC_PROJECT = path.join(FSC_SOURCE, "FsCopilot", "FsCopilot.csproj")

/**
 * FS Copilot and its relay as fsc-exerciser's sync copies them from the fork's Release build, with
 * no Community folder, so the app deploys nothing into the sim's. p31 runs both from there, since
 * Windows' firewall has a rule for each of those paths: a program at a new path that opens a UDP
 * socket raises the firewall's prompt, which takes the focus from the sim (seen on our development
 * machine, 2026-11-18).
 */
export const EXERCISER = sibling("fsc-exerciser")
export const FSC_APP = path.join(EXERCISER, "fsc", "FsCopilot.exe")
export const FSC_RELAY_EXE = path.join(EXERCISER, "relay", "p2p_serv.exe")
/** The pilot's FS Copilot's working folder, where it writes its log. */
export const FSC_PILOT_FOLDER = path.join(WORK, "fsc-pilot")
/** The second pilot's, which also holds the SimConnect.cfg that run.ts's holdOffSim writes, so that app never reaches the sim. */
export const FSC_SECOND_FOLDER = path.join(WORK, "fsc-second")

/** The bench's builds, which `prepare` makes as tools/bench.ts does. */
export const BENCH_OUT = path.join(ROOT, "target", "bench", "release-with-checks")
export const BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")
/** The pilot's core, built with the release profile a pilot's runs, and its core helper beside it. */
export const RELEASE_CORE = path.join(ROOT, "target", "release", "dualinput-core.exe")
/**
 * The same core built with no-figures.patch beside run.ts, which creates no figure in the sim, for
 * the run that measures what the figures cost the sim's frames.
 * procedure.md says how to build it.
 */
export const NO_FIGURES_CORE = path.join(WORK, "no-figures", "dualinput-core.exe")
/**
 * What the core with no figures needs beside it: Windows ends a core that has no SimConnect.dll
 * beside it before it prints anything, so its run only times out waiting for the port file.
 */
export const NO_FIGURES_FILES = ["dualinput-core.exe", "dualinput-core-helper.exe", "SimConnect.dll"].map((file) => path.join(path.dirname(NO_FIGURES_CORE), file))
