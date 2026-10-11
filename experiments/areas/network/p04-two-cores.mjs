/*
 * p04: whether two iroh endpoints in two processes on one PC, each with its own key and its
 * own port, connect to each other over the PC's own addresses with no relay, as two cores on
 * a developer's PC would (architecture plan, node 2). Needs no sim.
 *
 *   node experiments/areas/network/p04-two-cores.mjs
 *
 * Builds two-cores/ in release, starts one copy listening, hands its address to a second
 * copy, which connects and times 20 round trips, and prints both copies' reports.
 */

import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import readline from "node:readline"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const CRATE = path.join(REPO, "experiments", "areas", "network", "two-cores")
const EXE = path.join(CRATE, "target", "release", "p04-two-cores.exe")

const build = spawnSync("cargo", ["build", "--release", "-q"], { cwd: CRATE, encoding: "utf8", windowsHide: true })
if (build.status !== 0) {
  console.error(build.stderr)
  process.exit(1)
}

const lines = []
const listener = spawn(EXE, ["listen"], { windowsHide: true })
listener.stderr.on("data", (d) => process.stderr.write(d))
const listenerOut = readline.createInterface({ input: listener.stdout })
const listenerDone = new Promise((resolve) => listener.on("exit", resolve))

const first = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("the listener printed no address within 10s")), 10_000)
  listenerOut.once("line", (line) => {
    clearTimeout(timer)
    resolve(line)
  })
})
lines.push("listen: " + first)
listenerOut.on("line", (line) => lines.push("listen: " + line))

const dial = spawnSync(EXE, ["dial", first], { encoding: "utf8", windowsHide: true, timeout: 30_000 })
for (const line of dial.stdout.split(/\r?\n/).filter(Boolean)) lines.push("dial: " + line)
if (dial.status !== 0) lines.push("dial failed, exit " + dial.status + ": " + dial.stderr.trim())

const listenerExit = await Promise.race([listenerDone, new Promise((r) => setTimeout(() => r("timeout"), 10_000))])
if (listenerExit === "timeout") listener.kill()
lines.push("listener exit: " + listenerExit)

const report = [
  "p04: two iroh 1.3.0 endpoints in two processes on one PC, relays disabled",
  "",
  ...lines,
].join("\n")
console.log(report)
console.log("\nSaved " + repoRelative(saveResult("network", "p04-two-cores", report)))
