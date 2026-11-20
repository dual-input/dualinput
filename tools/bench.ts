// The bench: bench builds of the core on one PC, each with a data folder of its own, which
// the scenarios drive only from outside, where a pilot's surroundings reach a core
// (record/areas/build/02-testing.md, "The bench"). It builds the bench build from the tree
// first, and runs that build by the path Cargo reported, so it never runs a core from
// another commit, and the stand-in core helper beside it. A stage's code passes both this and
// tools/check.ts.
//
//   node tools/bench.ts                        runs every scenario in tools/bench/scenarios/
//   node tools/bench.ts <scenario>...          runs the scenarios named, such as `network network-loss`,
//                                              as a stage closes on the ones it added or changed
//                                              (record/areas/build/plan.md, "Working a stage")
//   node tools/bench.ts --shard <n>/<count>    runs share n of `count` shares of the scenarios,
//                                              balanced by each file's time, as each of CI's bench
//                                              jobs runs its own
//   node tools/bench.ts build <folder>         builds the bench's programs into <folder> and runs
//                                              nothing, as CI's job that builds them once does
//   node tools/bench.ts --programs <folder> …  runs the scenarios, all, named, or a share, on the
//                                              programs `build` put in <folder>, building nothing
//   node tools/bench.ts load [plays]           runs the loop under load: p10's flight, played
//                                              `plays` times over, 6 unless given, which is an hour
//
// `--programs` is for CI, where the job that built the folder checked out the same commit as
// the job that runs it, so the programs still come from the tree under test.

import fs from "node:fs"
import path from "node:path"

import { level } from "./bench/profiles.ts"
import { seconds, share } from "./bench/shards.ts"
import { buildPrograms } from "./lib/cargo.ts"
import { buildDesktopPages, DESKTOP } from "./lib/desktop-pages.ts"
import { writeMessageTypes } from "./lib/messages.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { Failed, main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"

/** The scenarios that run the desktop app, which the bench builds only when one of them runs. */
const WITH_DESKTOP = ["desktop-app"]

const USAGE = `usage: node tools/bench.ts [--programs <folder>] [<scenario>... | --shard <n>/<count>]
       node tools/bench.ts build <folder>
       node tools/bench.ts load [plays]`

type Programs = { core: string; helper: string; relay: string; builder: string }

/**
 * Each program's file name in a folder `build` writes, and the SimConnect.dll the core loads
 * from its own folder, which the sim edge's build script copies beside it.
 */
const FILES = {
  core: "dualinput-core.exe",
  helper: "stand-in-core-helper.exe",
  relay: "bench-relay.exe",
  builder: "dualinput-profile-builder.exe",
  desktop: "dualinput-desktop.exe",
  simConnect: "SimConnect.dll",
} as const

main(async () => {
  let args = process.argv.slice(2)
  let from: string | undefined
  if (args[0] === "--programs") {
    from = args[1]
    args = args.slice(2)
    if (!from) throw new Failed(USAGE)
  }
  const scenarios = path.join(ROOT, "tools", "bench", "scenarios")
  const all = fs.readdirSync(scenarios).filter((f) => f.endsWith(".ts")).sort().map((f) => f.replace(/\.ts$/, ""))

  if (args[0] === "build") {
    if (args.length !== 2 || from) throw new Failed(USAGE)
    await buildInto(path.resolve(args[1]!))
    return
  }
  if (args[0] === "load") {
    if (args.length > 2 || from) throw new Failed(USAGE)
    run(process.execPath, [path.join("tools", "bench", "load.ts"), args[1] ?? "6"], { env: environment(prepare(true)) })
    return
  }

  let chosen = args.length > 0 ? args : all
  if (args[0] === "--shard") {
    const [, n, count] = /^(\d+)\/(\d+)$/.exec(args[1] ?? "")?.map(Number) ?? []
    if (args.length !== 2 || !n || !count || n > count) throw new Failed(USAGE)
    chosen = share(all, n, count)
    if (chosen.length === 0) return console.log(`share ${n} of ${count} holds no scenario, since there are only ${all.length}`)
    console.log(`share ${n} of ${count}: ${chosen.join(", ")}, about ${Math.round(seconds(chosen) / 60)} minutes on our development machine`)
  }
  const unknown = chosen.filter((n) => !all.includes(n))
  if (unknown.length > 0) throw new Failed(`${USAGE}\nno scenario named ${unknown.join(", ")}; the scenarios are ${all.join(", ")}`)

  const built = from ? inFolder(path.resolve(from)) : prepare(false)
  const env = environment(built)
  if (chosen.some((n) => WITH_DESKTOP.includes(n))) env.DUALINPUT_BENCH_DESKTOP = from ? found(path.resolve(from), FILES.desktop) : await buildDesktop()
  const files = chosen.map((n) => fromRoot(path.join(scenarios, `${n}.ts`)))
  // One scenario at a time, so no scenario's cores take CPU from another's timing; and each
  // scenario's process exits once its tests end, whatever handle a failed one left open.
  run(process.execPath, ["--test", "--test-concurrency=1", "--test-force-exit", ...files], { env })
})

/**
 * Builds what the scenarios run from the tree. The loop under load builds with the release
 * profile, as a pilot's core runs; the scenarios with overflow checks and debug assertions on,
 * and without `lto`, which only slows their build (record/areas/build/02-testing.md, "Building
 * what it runs").
 */
function prepare(release: boolean): Programs {
  requireSdk()
  // The cores check their hash against these types, so they're written from this tree too.
  writeMessageTypes()
  return buildBench(release)
}

/** Builds every program a scenario runs, the desktop app among them, and copies each into `folder`. */
async function buildInto(folder: string): Promise<void> {
  const built = { ...prepare(false), desktop: await buildDesktop() }
  fs.rmSync(folder, { recursive: true, force: true })
  fs.mkdirSync(folder, { recursive: true })
  for (const [program, file] of Object.entries(built)) fs.copyFileSync(file, path.join(folder, FILES[program as keyof typeof built]))
  fs.copyFileSync(path.join(path.dirname(built.core), FILES.simConnect), path.join(folder, FILES.simConnect))
  console.log(`built the bench's programs into ${folder}`)
}

/** The programs `build` put in `folder`. */
function inFolder(folder: string): Programs {
  return {
    core: found(folder, FILES.core),
    helper: found(folder, FILES.helper),
    relay: found(folder, FILES.relay),
    builder: found(folder, FILES.builder),
  }
}

function found(folder: string, file: string): string {
  const program = path.join(folder, file)
  if (!fs.existsSync(program)) throw new Failed(`${program} is missing; run node tools/bench.ts build ${fromRoot(folder)}`)
  return program
}

/** The scenarios' environment: where each program is, and the tree's profiles published for them. */
function environment(built: Programs): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DUALINPUT_BENCH_CORE: built.core,
    DUALINPUT_BENCH_STAND_IN_HELPER: built.helper,
    DUALINPUT_BENCH_RELAY: built.relay,
    DUALINPUT_BENCH_BUILDER: built.builder,
    DUALINPUT_BENCH_PROFILES: publishProfiles(built.builder),
  }
}

/**
 * Builds the core with its `stand-in` feature, the stand-in core helper, the bench relay, and
 * the profile builder, into target/bench, and returns the paths Cargo wrote them to. A build
 * with the feature in target/ would replace the dualinput-core.exe a plain `cargo build` writes
 * there, and a developer's next build would replace the bench's.
 */
function buildBench(release: boolean): Programs {
  const programs = ["dualinput-core", "stand-in-core-helper", "bench-relay", "dualinput-profile-builder"] as const
  const args = [...programs.flatMap((p) => ["-p", p]), ...["--features", "dualinput-core/stand-in", "--target-dir", path.join("target", "bench")]]
  args.push("--profile", release ? "release" : "release-with-checks")
  const built = buildPrograms(args, programs)
  return {
    core: built["dualinput-core"],
    helper: built["stand-in-core-helper"],
    relay: built["bench-relay"],
    builder: built["dualinput-profile-builder"],
  }
}

/**
 * The desktop app's own workspace builds with the release profile a pilot's runs, since its
 * scenario measures what the app takes of the PC.
 */
async function buildDesktop(): Promise<string> {
  await buildDesktopPages()
  return buildPrograms(["--release"], ["dualinput-desktop"], DESKTOP)["dualinput-desktop"]
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
