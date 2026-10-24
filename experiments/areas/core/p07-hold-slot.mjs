/*
 * p07: does the core's Hold feed reach the sim, under the slots hash our module runs? p06 fed
 * Hold for 50s with the pilot in the cockpit, and a cockpit panel read all three freezes off
 * throughout, while the same three events sent from the panel's JavaScript froze the aircraft
 * at once. The routine host ignores a write whose header carries another slots hash, or that
 * is shorter than its slot (src/platform/routine-host/src/lib.rs, `written`). This starts the
 * release core on a data folder of its own, hosts a session alone so the core feeds Hold, and
 * from a SimConnect client of its own prints, for 5s, every write to DUALINPUT_ROUTINE_HOLD,
 * header by header, and every status our module writes, with its slots hash.
 *
 *   node experiments/areas/core/p07-hold-slot.mjs <core program>
 *
 * Start it in a flight on the ground. It needs no one at the controls.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { ClientDataPeriod, Protocol, open } from "node-simconnect"

import { HASH, VERSION } from "../../../src/engines/messages/ts/stamp.ts"
import { startBackend } from "../../../tools/lib/backend.ts"
import { ROOT } from "../../../tools/lib/repo.ts"

const program = path.resolve(process.argv[2] ?? "")
if (!process.argv[2] || !fs.existsSync(program)) {
  console.error("usage: node experiments/areas/core/p07-hold-slot.mjs <core program>")
  process.exit(1)
}

const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")
const results = path.join(import.meta.dirname, "results")
fs.mkdirSync(results, { recursive: true })
const report = path.join(results, `p07-hold-slot-${stamp}.txt`)
const data = path.join(ROOT, "target", "sim", "runs", `${stamp}-p07`, "core")
fs.mkdirSync(data, { recursive: true })
const started = Date.now()
const at = () => `${((Date.now() - started) / 1000).toFixed(2).padStart(6)}s`
const say = (line) => {
  console.log(`${at()}  ${line}`)
  fs.appendFileSync(report, `${at()}  ${line}\n`)
}

const backend = await startBackend()
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ "network.backend": backend.url, "network.relays": [], "session.name": "Pilot" }))
const out = fs.openSync(`${data}-output.txt`, "w")
const core = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
const stop = async (code) => {
  core.kill()
  await backend.stop()
  process.exit(code)
}

function log() {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const run = fs.readdirSync(recordings).sort().at(-1)
  const file = run && path.join(recordings, run, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

async function until(test, ms, what) {
  for (const begun = Date.now(); !test(); await sleep(250)) {
    if (Date.now() - begun > ms) {
      say(`gave up waiting for ${what}`)
      await stop(1)
    }
  }
}

say(`the core started on ${path.relative(ROOT, data)}`)
await until(() => /the sim's stage changed stage=Flying/.test(log()), 120_000, "the core to see the flight")
const port = JSON.parse(fs.readFileSync(path.join(data, "port.json"), "utf8")).port
const ws = new WebSocket(`ws://127.0.0.1:${port}`)
await new Promise((resolve) => (ws.onopen = resolve))
ws.send(JSON.stringify({ t: "hello", component: "desktop", version: VERSION, hash: HASH }))
setInterval(() => ws.send(JSON.stringify({ t: "alive" })), 2_000).unref()
ws.send(JSON.stringify({ t: "command", id: 1, name: "session.host", args: null }))
await until(() => /holds the aircraft for preflight on=true/.test(log()), 30_000, "Hold")
say("the core holds the aircraft")

// SlotHeader (src/engines/messages/src/module/slots.rs): feeds u32, end u32, slots_hash u64,
// counter u64. ModuleStatus (module.rs): counter u64, slots_hash u64, version 16 bytes.
const HOLD = { area: 1, definition: 1, size: 24 }
const STATUS = { area: 2, definition: 2, size: 32 }
const { handle } = await open("CROSSCHECK p07 hold slot", Protocol.SunRise)
const hex = (b, at) => b.readBigUInt64LE(at).toString(16).padStart(16, "0")
const writes = []
const hashes = new Set()
let moduleHash = null
handle.on("exception", (e) => say(`exception ${e.exception} for send ${e.sendId}, index ${e.index}`))
handle.on("clientData", (d) => {
  if (d.requestID === 1 || d.requestID === 3) {
    const b = d.data.readBytes(Math.min(HOLD.size, d.data.remaining()))
    if (b.length < HOLD.size) return say(`HOLD: ${b.length} bytes`)
    const write = { feeds: b.readUInt32LE(0), end: b.readUInt32LE(4), hash: hex(b, 8), counter: b.readBigUInt64LE(16) }
    hashes.add(write.hash)
    if (d.requestID === 3) say(`HOLD once: feeds ${write.feeds}, end ${write.end}, slots hash ${write.hash}, counter ${write.counter}`)
    else writes.push(write)
  } else if (d.requestID === 2) {
    const b = d.data.readBytes(Math.min(STATUS.size, d.data.remaining()))
    moduleHash = hex(b, 8)
    say(`status: counter ${b.readBigUInt64LE(0)}, slots hash ${moduleHash}, version ${b.subarray(16, 32).toString("utf8").replace(/\0+$/, "")}`)
  }
})
handle.mapClientDataNameToID("DUALINPUT_ROUTINE_HOLD", HOLD.area)
handle.addToClientDataDefinition(HOLD.definition, 0, HOLD.size)
handle.requestClientData(HOLD.area, 1, HOLD.definition, ClientDataPeriod.ON_SET, 0)
handle.requestClientData(HOLD.area, 3, HOLD.definition, ClientDataPeriod.ONCE, 0)
handle.mapClientDataNameToID("DUALINPUT_MODULE_STATUS", STATUS.area)
handle.addToClientDataDefinition(STATUS.definition, 0, STATUS.size)
handle.requestClientData(STATUS.area, 2, STATUS.definition, ClientDataPeriod.ON_SET, 0)

await sleep(5_000)
say(`HOLD: ${writes.length} writes in 5s, feeds ${[...new Set(writes.map((w) => w.feeds))].join(", ")}, end ${[...new Set(writes.map((w) => w.end))].join(", ")}`)
say(`slots hashes the core wrote: ${[...hashes].join(", ") || "none"}; the module's: ${moduleHash ?? "none heard"}`)
handle.close()
await stop(0)
