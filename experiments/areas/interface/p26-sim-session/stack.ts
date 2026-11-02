/*
 * Everything a session needs around the real sim's core, on this PC: a local relay, the backend on a local D1, the
 * profiles' site, and a bench core as the second pilot, in a Baron 58P on a stand-in sim. Dual Input's own servers aren't
 * deployed until stage 22, and the banner shows only in a session, so a sim try of the banner needs these.
 *
 *   node tools/bench.ts session        (once, if target/bench is older than the tree: it builds what this runs)
 *   node experiments/areas/interface/p26-sim-session/stack.ts
 *
 * It writes the settings for a new data folder for the real core, so the core's first run is a pilot's, then prints how
 * to start that core. The second pilot joins the code written to target/sim-session/join.txt, and hosts a session of its
 * own at the start, whose code it prints, so the sim's pilot can try Join under a pilot flying who is in a flight.
 * Ctrl-C ends it all.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun } from "../../../../tools/bench/cores.ts"
import { BARON, load } from "../../../../tools/bench/flights.ts"
import { app, BenchNetwork, host, join } from "../../../../tools/bench/network.ts"
import { ROOT } from "../../../../tools/lib/repo.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
process.env.DUALINPUT_BENCH_CORE = path.join(OUT, "dualinput-core.exe")
process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(OUT, "stand-in-core-helper.exe")
process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

const FOLDER = path.join(ROOT, "target", "sim-session")
const REAL_CORE = path.join(FOLDER, `core-${new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")}`)
const JOIN_FILE = path.join(FOLDER, "join.txt")
const SECOND_PILOT = "Second pilot"

fs.mkdirSync(REAL_CORE, { recursive: true })
fs.rmSync(JOIN_FILE, { force: true })

const network = await BenchNetwork.start(1)
const { settings } = network.core()

// The real core reads the real UserCfg.opt, so it takes these keys and nothing else of a bench core's.
fs.writeFileSync(path.join(REAL_CORE, "settings.json"), JSON.stringify(settings, null, 2))

const run = new BenchRun("sim-session")
const second = await run.core("second-pilot", { settings })
// A day's worth, where the bench's Stub ends after 10 minutes, which left the second pilot's sim closed by the time the pilot joined.
const sim = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
second.act({ act: "watch", process: sim.pid! })
await second.hear("stage Starting aircraft none")
await load(second, BARON)
const code = await host(second, SECOND_PILOT)

console.log(`backend ${network.backend.url}, relay ${network.relays[0]!.url}, profiles ${network.profiles.url}`)
console.log(`start the real core: target\\debug\\dualinput-core.exe --data ${path.relative(ROOT, REAL_CORE)}`)
console.log(`the second pilot hosts ${code}, in a Baron 58P; write a code to ${path.relative(ROOT, JOIN_FILE)} to have them join it`)

const end = async () => {
  await second.kill()
  sim.kill()
  await network.stop()
  process.exit(0)
}
process.on("SIGINT", () => void end())

for (;;) {
  await sleep(500)
  if (!fs.existsSync(JOIN_FILE)) continue
  const wanted = fs.readFileSync(JOIN_FILE, "utf8").trim()
  fs.rmSync(JOIN_FILE, { force: true })
  const desktop = await app(second)
  await desktop.ok("session.leave")
  await sleep(1000)
  await join(second, wanted, SECOND_PILOT)
  console.log(`the second pilot joins ${wanted}`)
}
