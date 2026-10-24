/*
 * p08: where does preflight's Hold stop between our module and the aircraft? p07 found the
 * core's feed reaching the sim under the module's slots hash, every 200ms, yet p06 read all
 * three freezes off for 50s of Hold. This runs against our module built with
 * p08-module-diag.patch, which reports what the routine host's freeze did every 250ms in
 * DUALINPUT_P08_OUT: frames, reads of the flags with each value's high 32 bits and its error,
 * and sends; and which sends the freeze through the module's own SimConnect connection
 * instead of fsEventsTriggerKeyEvent while DUALINPUT_P08_MODE holds 1. It starts the release
 * core on a data folder of its own, hosts a session alone so the core feeds Hold, and prints
 * the report and a cockpit panel's read of the freezes for 5s in each mode. At the end it
 * stops the core, and turns the freezes off from the panel's JavaScript too.
 *
 *   git apply experiments/areas/core/p08-module-diag.patch
 *   node tools/build.ts install                        with the sim closed
 *   node experiments/areas/core/p08-module-freeze.mjs <core program>
 *   git apply -R experiments/areas/core/p08-module-diag.patch
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
import { evaluate, listPages } from "../../../tools/sim/inspector.ts"

const program = path.resolve(process.argv[2] ?? "")
if (!process.argv[2] || !fs.existsSync(program)) {
  console.error("usage: node experiments/areas/core/p08-module-freeze.mjs <core program>")
  process.exit(1)
}

const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")
const results = path.join(import.meta.dirname, "results")
fs.mkdirSync(results, { recursive: true })
const report = path.join(results, `p08-module-freeze-${stamp}.txt`)
const data = path.join(ROOT, "target", "sim", "runs", `${stamp}-p08`, "core")
fs.mkdirSync(data, { recursive: true })
const started = Date.now()
const at = () => `${((Date.now() - started) / 1000).toFixed(2).padStart(6)}s`
const say = (line) => {
  console.log(`${at()}  ${line}`)
  fs.appendFileSync(report, `${at()}  ${line}\n`)
}

// Runs in a cockpit panel, Coherent GT: ES2017.
const FLAGS = `["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"].map(function (n) { return SimVar.GetSimVarValue(n, "bool") ? 1 : 0; }).join(" ")`
const UNFREEZE = `["K:FREEZE_LATITUDE_LONGITUDE_SET", "K:FREEZE_ALTITUDE_SET", "K:FREEZE_ATTITUDE_SET"].forEach(function (k) { SimVar.SetSimVarValue(k, "number", 0); }), true`
const panel = (await listPages()).find((p) => /^VCockpit/i.test(p.title))
if (!panel) {
  console.error("no cockpit panel: load a flight first")
  process.exit(1)
}
// The inspector refuses a socket to a page while the last one to it closes.
async function inPanel(expression) {
  for (let tries = 0; ; tries++) {
    try {
      const value = await evaluate(panel, expression)
      await sleep(300)
      return value
    } catch (error) {
      if (tries >= 5) return `the panel didn't answer: ${error.message}`
      await sleep(700)
    }
  }
}

const backend = await startBackend()
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ "network.backend": backend.url, "network.relays": [], "session.name": "Pilot" }))
const out = fs.openSync(`${data}-output.txt`, "w")
const core = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })

function log() {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const run = fs.readdirSync(recordings).sort().at(-1)
  const file = run && path.join(recordings, run, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

async function until(test, ms, what) {
  for (const begun = Date.now(); !test(); await sleep(250)) {
    if (Date.now() - begun > ms) throw new Error(`gave up waiting for ${what}`)
  }
}

const { handle } = await open("CROSSCHECK p08 module freeze", Protocol.SunRise)
let last = null
handle.on("exception", (e) => say(`exception ${e.exception} for send ${e.sendId}, index ${e.index}`))
let words = null
handle.on("clientData", (d) => {
  if (d.requestID !== 1) return
  const b = d.data.readBytes(Math.min(128, d.data.remaining()))
  const w = (i) => b.readUInt32LE(i * 4)
  const h = (i) => w(i).toString(16)
  words =
    `exceptions ${w(16)}, the last ${w(17)} for send ${w(18)} index ${w(19)}; mode writes heard at the low ID ${w(20)} and at 0xD000 ${w(21)}; ` +
    `client data heard ${w(22)}, the last for request ${w(23)}; HOLD writes heard ${w(24)}; send IDs: status ${w(25)}, HOLD's request ${w(26)}, ` +
    `the low mode's ${w(27)}, the 0xD000 mode's ${w(28)}; dispatch callbacks ${w(29)}, with a null context ${w(30)}`
  last =
    `frames ${w(0) + w(1) * 2 ** 32}, reads ${w(2)}, mode ${w(3)}, values ${h(4)} ${h(5)} ${h(6)}, errors ${w(7)} ${w(8)} ${w(9)}, ` +
    `ids ${w(10)}, fsEvents sends ${w(11)}, SimConnect sends ${w(12)} last result ${h(13)}, clock ${w(14)}s, marker ${h(15)}`
})
handle.mapClientDataNameToID("DUALINPUT_P08_OUT", 1)
handle.addToClientDataDefinition(1, 0, 128)
handle.requestClientData(1, 1, 1, ClientDataPeriod.ON_SET, 0)
handle.mapClientDataNameToID("DUALINPUT_P08_MODE", 2)
handle.addToClientDataDefinition(2, 0, 4)
handle.mapClientDataNameToID("DUALINPUT_P08_MODEHI", 3)
handle.addToClientDataDefinition(3, 0, 4)
// Both mode areas, so the report says which of the module's two IDs heard the write.
const mode = (m) => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(m)
  handle.setClientData(2, 2, 0, 0, 4, bytes)
  handle.setClientData(3, 3, 0, 0, 4, bytes)
}

async function watch(name, seconds) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1_000)
    say(`  ${name}: module ${last ?? "no report heard"}`)
    say(`  ${name}: panel freezes ${await inPanel(FLAGS)}`)
  }
}

try {
  mode(0)
  await sleep(1_500)
  say(`before the core: module ${last ?? "no report heard"}`)
  say(`before the core: the module's connection: ${words ?? "no report heard"}`)
  await until(() => /the sim's stage changed stage=Flying/.test(log()), 120_000, "the core to see the flight")
  const port = JSON.parse(fs.readFileSync(path.join(data, "port.json"), "utf8")).port
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise((resolve) => (ws.onopen = resolve))
  ws.send(JSON.stringify({ t: "hello", component: "desktop", version: VERSION, hash: HASH }))
  setInterval(() => ws.send(JSON.stringify({ t: "alive" })), 2_000).unref()
  ws.send(JSON.stringify({ t: "command", id: 1, name: "session.host", args: null }))
  await until(() => /holds the aircraft for preflight on=true/.test(log()), 30_000, "Hold")
  say("the core holds the aircraft; the module sends through fsEventsTriggerKeyEvent")
  await watch("fsEvents", 5)
  mode(1)
  say("the module sends through its SimConnect connection")
  await watch("SimConnect", 5)
  core.kill()
  say("the core stopped, so the routine host drops Hold 1s after its last feed")
  await watch("after the core", 3)
  say(`the module's connection: ${words ?? "no report heard"}`)
} catch (error) {
  say(error.message)
} finally {
  core.kill()
  say(`the panel's own unfreeze: ${await inPanel(UNFREEZE)}; panel freezes ${await inPanel(FLAGS)}`)
  handle.close()
  await backend.stop()
  say(`the report is ${path.relative(ROOT, report)}`)
  process.exit(0)
}
