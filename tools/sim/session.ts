// The session's cases in the sim, for a session with someone at the sim
// (record/areas/build/plan.md, "9 The session"): our BlurPage copy brings the menu script,
// whose master page takes the core out of Starting; and preflight's `Hold` freezes the pilot's
// aircraft through our WASM module's `fsEventsTriggerKeyEvent`, and lets it go at preflight's
// end. It starts the release core on a data folder of its own, with the backend run on this
// PC, hosts a session alone through the core's WebSocket, as the desktop app does, and reads
// the aircraft's freezes in a cockpit panel through the sim's inspector. It writes the report
// to report.txt in the run's folder.
//
//   node tools/build.ts install                     with the sim closed, so our package holds
//                                                    this tree's menu script and module
//   node tools/sim/session.ts --core <program>     the release core, built from this tree
//
// Then start the sim, wait at the main menu, load a flight on the ground in any aircraft, and
// press Ready to fly; the script says each step aloud. Keys:
//   q   stops the core, replays its recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import { type LocalBackend, startBackend } from "../lib/backend.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages } from "./inspector.ts"

/** The three freezes the routine host sets, as a cockpit panel reads them. Runs in Coherent GT, so it's ES2017. */
const READ_FREEZES = `(function () {
  return ["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"].map(function (name) {
    return SimVar.GetSimVarValue(name, "bool");
  });
})()`

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--core") throw new Failed("usage: node tools/sim/session.ts --core <program>")
  const core = path.resolve(args[1]!)
  if (!fs.existsSync(core)) throw new Failed(`there's no core at ${core}`)
  run(core).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(program: string): Promise<void> {
  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-session`)
  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
  const report = path.join(folder, "report.txt")
  const guide = await Guide.start()
  const say = (line: string, aloud = false) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
    if (aloud) guide.say(line)
  }
  const result = (ok: boolean, line: string) => {
    say(`${ok ? "PASSED" : "FAILED"}: ${line}`)
    if (ok) guide.pass()
    else guide.fail()
  }

  const backend = await startBackend()
  // A session alone needs no relay, and the backend run on this PC hands out its code.
  const settings = { "network.backend": backend.url, "network.relays": [], "session.name": "Pilot" }
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify(settings, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  watchKeys(say, child, program, data, backend, guide)
  say(`the core started, in ${path.relative(ROOT, folder)}`)
  say("Start the sim, and wait at the main menu.", true)

  // The menu script reports its master page when the sim service asks, as its socket joins.
  await until(() => (log(data).includes("the menu script reported its master page master=Main") ? true : undefined), 60 * 60_000)
  const menu = /the sim's stage changed stage=Menu/.test(log(data))
  result(menu, "our BlurPage copy brought the menu script, whose master page took the core from Starting to Menu")

  const app = await desktop(data, ["session"])
  const slice = () => app.slice<SessionSlice>("session")
  await app.command("session.host", null)
  const code = await until(() => slice()?.code ?? undefined, 30_000)
  say(`hosted the session ${code}`)
  say("Load a flight on the ground in any aircraft, then press Ready to fly.", true)
  await until(() => (/the sim's stage changed stage=Flying/.test(log(data)) ? true : undefined), 60 * 60_000)
  say("the sim is Flying; waiting 10s for the cockpit's panels")
  await sleep(10_000)

  const holding = log(data).includes("this core holds the aircraft for preflight on=true")
  const frozen = await freezes()
  result(holding && frozen.every(Boolean), `preflight's Hold froze the aircraft: the core fed Hold ${holding}, and the freezes read ${JSON.stringify(frozen)}`)

  await app.command("session.ready", { on: true })
  await until(() => (slice()?.preflight.phase === "ended" ? true : undefined), 15_000)
  say("preflight ended; waiting 3s for the routine host to drop Hold")
  await sleep(3_000)
  const freed = await freezes()
  result(freed.every((f) => !f), `preflight's end let the aircraft go: the freezes read ${JSON.stringify(freed)}`)
  say("Done. Press q in the terminal to stop the core and replay its recording.", true)
}

/** The three freezes, read in the first cockpit panel that answers. */
async function freezes(): Promise<boolean[]> {
  for (const page of (await listPages()).filter((p) => /^VCockpit/i.test(p.title))) {
    try {
      // `SimVar` may give a bool as 1 or as true, so either reads as frozen.
      return (await evaluate<(number | boolean)[]>(page, READ_FREEZES)).map((f) => Boolean(f))
    } catch {
      // A panel without the sim's SimVar, such as one still loading.
    }
  }
  throw new Failed("no cockpit panel read the aircraft's freezes")
}

function log(data: string): string {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const run = fs.readdirSync(recordings).sort().at(-1)
  const file = run && path.join(recordings, run, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

async function until<T>(get: () => T | undefined, ms: number): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s`)
    await sleep(250)
  }
}

function watchKeys(
  say: (line: string) => void,
  child: ReturnType<typeof spawn>,
  program: string,
  data: string,
  backend: LocalBackend,
  guide: Guide,
): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    child.kill()
    await sleep(1_000)
    const recordings = path.join(data, "recordings")
    const run = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
    const recording = run && path.join(recordings, run, "inputs.zst")
    if (recording && fs.existsSync(recording)) {
      const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
      say(`the core's replay: ${(replayed.stdout + replayed.stderr).trim()}`)
    }
    await backend.stop()
    guide.close()
    process.exit(0)
  })
}
