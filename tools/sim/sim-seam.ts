// The sim seam's cases in the sim, for a session with someone at the sim
// (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench"). It builds the
// release core from the tree, starts it on a data folder of its own, and reports each thing
// the cases look for as the core's log shows it: the sim found, its connection open, our
// module running, each stage with the loaded aircraft, the quit message and the process's
// exit, and the sim edge's wake-ups each minute. It writes the same report to report.txt in
// the run's folder.
//
//   node tools/sim/sim-seam.ts                     builds the release core, then runs it
//   node tools/sim/sim-seam.ts --core <program>    runs a core already built, such as one
//                                                  built in a shell that holds the SDK
//
// Then start the sim, load flights, and close it, while the report runs. Keys:
//   k   kills the sim, as a crash would
//   q   stops the core, replays its recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { buildPrograms } from "../lib/cargo.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { requireSdk } from "../lib/sdk.ts"

/** The sim's process, as the edge finds it (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim's process"). */
const SIM = "FlightSimulator2024.exe"

/**
 * What each log line the cases look for says, as `src/apps/core` and `src/platform/sim-service` log
 * them, so change both together. A line is `<stamp>µs #<seq> [<unit>] <LEVEL> <target>:
 * <message> <fields>`.
 */
const WANTED: [RegExp, string][] = [
  [/the sim's process was found/, "the sim's process was found"],
  [/the sim's process exited code="([^"]+)"/, "the sim's process exited, with $1"],
  [/a connection to the sim opened connection=Connection \{ unit: (\d+), open: (\d+) \}/, "connection $1.$2 opened"],
  [/a connection to the sim was lost connection=Connection \{ unit: (\d+), open: (\d+) \}/, "connection $1.$2 was lost"],
  [/the sim's open reply arrived .*application="([^"]+)" version=(\[[^\]]+\])/, "the sim's open reply: $1 $2"],
  [/the sim sent its quit message/, "the quit message"],
  [/the sim's stage changed stage=(\w+)(?: aircraft="([^"]+)")?/, "stage $1 $2"],
  [/the loaded aircraft's title title="([^"]+)"/, "title: $1"],
  [/our WASM module is running module="([^"]+)"/, "our WASM module is running, version $1"],
  [/our WASM module is from another build/, "our WASM module is from another build"],
  [/our WASM module stopped/, "our WASM module stopped"],
  [/a call of the platform's failed (.*)/, "a call of the platform's failed: $1"],
  [/the sim edge's stats (.*)/, "the sim edge's wake-ups: $1"],
  [/the loop is behind its queue (.*)/, "the loop is behind its queue: $1"],
  [/ERROR (.*)/, "ERROR $1"],
]

main(() => {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 2 && args[0] === "--core")) throw new Failed("usage: node tools/sim/sim-seam.ts [--core <program>]")
  let core: string
  if (args[1]) {
    core = path.resolve(args[1])
    if (!fs.existsSync(core)) throw new Failed(`there's no core at ${core}`)
  } else {
    requireSdk()
    core = buildCore()
  }
  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", started)
  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
  const report = fs.openSync(path.join(folder, "report.txt"), "w")
  const say = (line: string) => {
    console.log(line)
    fs.writeSync(report, `${line}\n`)
  }
  const out = fs.openSync(path.join(folder, "core-output.txt"), "w")
  const child = spawn(core, ["--data", data], { stdio: ["ignore", out, out] })
  say(`the core started, on the data folder ${path.relative(ROOT, data)}; start the sim, load flights, then close it`)
  say("keys: k kills the sim, q stops the core and replays")

  let first: number | undefined
  let read = 0
  let log: string | undefined
  const follow = setInterval(() => {
    log ??= newestLog(data)
    if (!log) return
    const text = fs.readFileSync(log, "utf8")
    const end = text.lastIndexOf("\n") + 1
    for (const line of text.slice(read, end).split("\n").filter(Boolean)) {
      const stamp = Number(/^(\d+)µs/.exec(line)?.[1])
      first ??= stamp
      for (const [pattern, shown] of WANTED) {
        const m = pattern.exec(line)
        if (m) say(`${((stamp - first) / 1e6).toFixed(3).padStart(9)}s  ${m[0].replace(pattern, shown).trim()}`)
      }
    }
    read = end
  }, 200)

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", (key: Buffer) => {
    switch (key.toString("utf8")) {
      case "k":
        say("killing the sim")
        spawnSync("taskkill", ["/IM", SIM, "/F"], { stdio: "ignore" })
        break
      case "q":
      case "\u0003":
        clearInterval(follow)
        child.kill()
        child.once("exit", () => {
          const recording = log && path.join(path.dirname(log), "inputs.zst")
          if (recording && fs.existsSync(recording)) {
            const replayed = spawnSync(core, ["replay", recording], { encoding: "utf8" })
            say(`the replay: ${(replayed.stdout + replayed.stderr).trim()}`)
          }
          fs.closeSync(report)
          process.exit(0)
        })
        break
    }
  })
})

/** The run's log, in the newest run's folder of the data folder's recordings, once there is one. */
function newestLog(data: string): string | undefined {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return undefined
  const run = fs.readdirSync(recordings).sort().at(-1)
  const log = run && path.join(recordings, run, "log.txt")
  return log && fs.existsSync(log) ? log : undefined
}

/** Builds the release core, which a pilot runs, and returns the path Cargo wrote it to. */
function buildCore(): string {
  return buildPrograms(["--release", "-p", "dualinput-core"], ["dualinput-core"])["dualinput-core"]
}
