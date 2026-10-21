// The bench: bench builds of the core on one PC, each with a data folder of its own, which
// the scenarios drive only from outside, where a pilot's surroundings reach a core
// (record/areas/build/02-testing.md, "The bench"). It builds the bench build from the tree
// first, and runs that build by the path Cargo reported, so it never runs a core from
// another commit. A stage's code passes both this and tools/check.ts.
//
//   node tools/bench.ts               runs every scenario in tools/bench/scenarios/
//   node tools/bench.ts load [plays]  runs the loop under load: p10's flight, played
//                                     `plays` times over, 6 unless given, which is an hour

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

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
  const env = { ...process.env, DUALINPUT_BENCH_CORE: buildBenchCore(what === "load") }
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
 * Builds the core with its `stand-in` feature into target/bench, and returns the path Cargo
 * wrote it to. A build with the feature in target/ would replace the dualinput-core.exe a
 * plain `cargo build` writes there, and a developer's next build would replace the bench's.
 */
function buildBenchCore(release: boolean): string {
  const args = ["build", "-p", "dualinput-core", "--features", "stand-in", "--target-dir", path.join("target", "bench")]
  if (release) args.push("--release")
  console.log(`> cargo ${args.join(" ")}`)
  const result = spawnSync("cargo", [...args, "--message-format", "json-render-diagnostics"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (result.status !== 0) throw new Failed(`cargo ${args.join(" ")} exited with ${result.status}`)
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue
    const message = JSON.parse(line) as { reason?: string; target?: { name?: string }; executable?: string | null }
    if (message.reason === "compiler-artifact" && message.target?.name === "dualinput-core" && message.executable) {
      return message.executable
    }
  }
  throw new Failed("cargo reported no dualinput-core.exe for the bench build")
}
