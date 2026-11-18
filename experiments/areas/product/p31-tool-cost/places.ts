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
/** What only this PC needs: PresentMon's CSVs, the network traces, the cores' folders, and FS Copilot's copy. */
export const WORK = path.join(ROOT, "target", "p31")

export const EXERCISER = sibling("fsc-exerciser")
export const EXERCISER_EXE = path.join(EXERCISER, "src", "bin", "Debug", "net9.0", "win-x64", "FsCopilot.Exerciser.exe")
/** The exerciser's Serilog file, which it opens in its working folder, its checkout's root when run.cmd starts it. */
export const EXERCISER_LOG = path.join(EXERCISER, "exerciser-log")
export const FSC_RELAY_EXE = path.join(EXERCISER, "relay", "p2p_serv.exe")
/** The FS Copilot build the exerciser compiled against, which its sync copied in from the fork. */
export const FSC_SYNCED = path.join(EXERCISER, "fsc")
/** p31's own copy of that build, with the user's 58P profile in its Definitions, and no Community folder, so it deploys nothing into the sim's. */
export const FSC_COPY = path.join(WORK, "fsc")
export const FSC_SOURCE = path.join(sibling("fsc"), "src")

/** The bench's builds, which `prepare` makes as tools/bench.ts does. */
export const BENCH_OUT = path.join(ROOT, "target", "bench", "release-with-checks")
export const BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")
/** The pilot's core, built with the release profile a pilot's runs, and its core helper beside it. */
export const RELEASE_CORE = path.join(ROOT, "target", "release", "dualinput-core.exe")
