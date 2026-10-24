// The bench: bench builds of the core on one PC, each with a data folder of its own, which
// the scenarios drive only from outside, where a pilot's surroundings reach a core
// (record/areas/build/02-testing.md, "The bench"). It builds the bench build from the tree
// first, and runs that build by the path Cargo reported, so it never runs a core from
// another commit, and the stand-in core helper beside it. A stage's code passes both this and
// tools/check.ts.
//
//   node tools/bench.ts                 runs every scenario in tools/bench/scenarios/
//   node tools/bench.ts <scenario>...   runs the scenarios named, such as `network network-loss`,
//                                       as a stage closes on the ones it added or changed
//                                       (record/areas/build/plan.md, "Working a stage")
//   node tools/bench.ts load [plays]    runs the loop under load: p10's flight, played
//                                       `plays` times over, 6 unless given, which is an hour

import fs from "node:fs"
import path from "node:path"

import { level } from "./bench/profiles.ts"
import { buildPrograms } from "./lib/cargo.ts"
import { writeMessageTypes } from "./lib/messages.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { Failed, main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"

main(() => {
  const args = process.argv.slice(2)
  const [what, plays] = args
  const scenarios = path.join(ROOT, "tools", "bench", "scenarios")
  const all = fs.readdirSync(scenarios).filter((f) => f.endsWith(".ts")).sort().map((f) => f.replace(/\.ts$/, ""))
  const named = what === "load" ? [] : args
  const unknown = named.filter((n) => !all.includes(n))
  if (unknown.length > 0) {
    throw new Failed(`usage: node tools/bench.ts [<scenario>... | load [plays]]\nno scenario named ${unknown.join(", ")}; the scenarios are ${all.join(", ")}`)
  }
  requireSdk()
  // The cores check their hash against these types, so they're written from this tree too.
  writeMessageTypes()
  // The loop under load runs the release profile, as a pilot's core does; the scenarios run it
  // with overflow checks and debug assertions on, and without `lto`, which only slows their
  // build (record/areas/build/02-testing.md, "Building what it runs").
  const built = buildBench(what === "load")
  const env = {
    ...process.env,
    DUALINPUT_BENCH_CORE: built.core,
    DUALINPUT_BENCH_STAND_IN_HELPER: built.helper,
    DUALINPUT_BENCH_RELAY: built.relay,
    DUALINPUT_BENCH_BUILDER: built.builder,
    DUALINPUT_BENCH_PROFILES: publishProfiles(built.builder),
  }
  if (what === "load") {
    run(process.execPath, [path.join("tools", "bench", "load.ts"), plays ?? "6"], { env })
    return
  }
  const files = (named.length > 0 ? named : all).map((n) => fromRoot(path.join(scenarios, `${n}.ts`)))
  // One scenario at a time, so no scenario's cores take CPU from another's timing; and each
  // scenario's process exits once its tests end, whatever handle a failed one left open.
  run(process.execPath, ["--test", "--test-concurrency=1", "--test-force-exit", ...files], { env })
})

/**
 * Builds the core with its `stand-in` feature, the stand-in core helper, the stand-in desktop
 * app, and the bench relay, into target/bench, and returns the paths Cargo wrote them to. A
 * build with the feature in target/ would replace the dualinput-core.exe a plain `cargo build`
 * writes there, and a developer's next build would replace the bench's.
 */
function buildBench(release: boolean): { core: string; helper: string; relay: string; builder: string } {
  const programs = ["dualinput-core", "stand-in-core-helper", "stand-in-desktop-app", "bench-relay", "dualinput-profile-builder"] as const
  const args = [...programs.flatMap((p) => ["-p", p]), ...["--features", "dualinput-core/stand-in", "--target-dir", path.join("target", "bench")]]
  args.push("--profile", release ? "release" : "release-with-checks")
  const built = buildPrograms(args, programs)
  // The core starts the desktop app's program from its own folder, by the name a release's
  // folder gives it, so the stand-in goes beside the bench's core under that name.
  // `PROGRAM` in src/apps/core/src/edges/desktop_app.rs names the same file, so change both
  // together.
  copyIfChanged(built["stand-in-desktop-app"], path.join(path.dirname(built["dualinput-core"]), "dualinput-desktop.exe"))
  return {
    core: built["dualinput-core"],
    helper: built["stand-in-core-helper"],
    relay: built["bench-relay"],
    builder: built["dualinput-profile-builder"],
  }
}

/** Copies `from` to `to` unless `to` already holds the same bytes, so a run that built nothing copies nothing. */
function copyIfChanged(from: string, to: string): void {
  if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) return
  fs.copyFileSync(from, to)
}

/**
 * Publishes the tree's profiles into target/bench/profiles, from nothing, as CI would publish
 * them for a release of this tree, at every level the tree has, and returns the folder, which
 * each scenario's profiles' site serves a copy of.
 */
function publishProfiles(builder: string): string {
  const pages = path.join(ROOT, "target", "bench", "profiles")
  fs.rmSync(pages, { recursive: true, force: true })
  run(builder, ["publish", "--released", String(level()), "--profiles", "profiles", "--pages", pages])
  return pages
}
