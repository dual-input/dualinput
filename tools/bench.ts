// The bench: bench builds of the core on one PC, each with a data folder of its own, which
// the scenarios drive only from outside, where a pilot's surroundings reach a core
// (record/areas/build/02-testing.md, "The bench"). It builds the bench build from the tree
// first, and runs that build by the path Cargo reported, so it never runs a core from
// another commit, and the stand-in core helper beside it. A stage's code passes both this and
// tools/check.ts.
//
//   node tools/bench.ts               runs every scenario in tools/bench/scenarios/
//   node tools/bench.ts load [plays]  runs the loop under load: p10's flight, played
//                                     `plays` times over, 6 unless given, which is an hour

import fs from "node:fs"
import path from "node:path"

import { buildPrograms } from "./lib/cargo.ts"
import { writeMessageTypes } from "./lib/messages.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { Failed, main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"

main(() => {
  const [what, plays] = process.argv.slice(2)
  if (what !== undefined && what !== "load") throw new Failed("usage: node tools/bench.ts [load [plays]]")
  requireSdk()
  // The cores check their hash against these types, so they're written from this tree too.
  writeMessageTypes()
  // The loop under load measures timing, so it runs the release profile, as a pilot's core
  // does; the scenarios check behavior, and build faster without it.
  const built = buildBench(what === "load")
  const env = { ...process.env, DUALINPUT_BENCH_CORE: built.core, DUALINPUT_BENCH_STAND_IN_HELPER: built.helper }
  if (what === "load") {
    run(process.execPath, [path.join("tools", "bench", "load.ts"), plays ?? "6"], { env })
    return
  }
  const scenarios = path.join(ROOT, "tools", "bench", "scenarios")
  const files = fs.readdirSync(scenarios).filter((f) => f.endsWith(".ts")).sort().map((f) => fromRoot(path.join(scenarios, f)))
  // One scenario at a time, so no scenario's cores take CPU from another's timing; and each
  // scenario's process exits once its tests end, whatever handle a failed one left open.
  run(process.execPath, ["--test", "--test-concurrency=1", "--test-force-exit", ...files], { env })
})

/**
 * Builds the core with its `stand-in` feature, and the stand-in core helper, into
 * target/bench, and returns the paths Cargo wrote them to. A build with the feature in
 * target/ would replace the dualinput-core.exe a plain `cargo build` writes there, and a
 * developer's next build would replace the bench's.
 */
function buildBench(release: boolean): { core: string; helper: string } {
  const args = [
    ...["-p", "dualinput-core", "-p", "stand-in-core-helper"],
    ...["--features", "dualinput-core/stand-in", "--target-dir", path.join("target", "bench")],
  ]
  if (release) args.push("--release")
  const built = buildPrograms(args, ["dualinput-core", "stand-in-core-helper"])
  return { core: built["dualinput-core"], helper: built["stand-in-core-helper"] }
}
