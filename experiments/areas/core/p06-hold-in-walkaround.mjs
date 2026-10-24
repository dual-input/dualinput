/*
 * p06: does preflight's Hold freeze the aircraft while the pilot is in walkaround? Stage 9's
 * sim session fed Hold from Ready to fly, with the pilot in walkaround, and 10s into the
 * flight a cockpit panel read all three freezes off. Our module reads the flags on the user
 * aircraft, but fsEventsTriggerKeyEvent names no object, so in walkaround its events may reach
 * the avatar instead (unverified). This starts the release core on a data folder of its own,
 * hosts a session alone, and with Hold on reads the freezes and A:CAMERA STATE each second:
 * with the pilot in the cockpit, in walkaround, and back in the cockpit; then readies, and
 * reads them after preflight's end. It says each step aloud.
 *
 *   node experiments/areas/core/p06-hold-in-walkaround.mjs <core program>
 *
 * Start it in a flight on the ground, sitting in the cockpit.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { HASH, VERSION } from "../../../src/engines/messages/ts/stamp.ts"
import { startBackend } from "../../../tools/lib/backend.ts"
import { ROOT } from "../../../tools/lib/repo.ts"
import { Guide } from "../../../tools/sim/guide.ts"
import { evaluate, listPages } from "../../../tools/sim/inspector.ts"

const program = path.resolve(process.argv[2] ?? "")
if (!process.argv[2] || !fs.existsSync(program)) {
  console.error("usage: node experiments/areas/core/p06-hold-in-walkaround.mjs <core program>")
  process.exit(1)
}

// Runs in a page of the sim, Coherent GT: ES2017.
const READ = `(function () {
  return [
    SimVar.GetSimVarValue("IS LATITUDE LONGITUDE FREEZE ON", "bool"),
    SimVar.GetSimVarValue("IS ALTITUDE FREEZE ON", "bool"),
    SimVar.GetSimVarValue("IS ATTITUDE FREEZE ON", "bool"),
    SimVar.GetSimVarValue("CAMERA STATE", "number")
  ];
})()`

const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")
const results = path.join(import.meta.dirname, "results")
fs.mkdirSync(results, { recursive: true })
const report = path.join(results, `p06-hold-in-walkaround-${stamp}.txt`)
const data = path.join(ROOT, "target", "sim", "runs", `${stamp}-p06`, "core")
fs.mkdirSync(data, { recursive: true })

const started = Date.now()
const at = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`
const say = (line) => {
  console.log(`${at()}  ${line}`)
  fs.appendFileSync(report, `${at()}  ${line}\n`)
}

const guide = await Guide.start()
const backend = await startBackend()
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ "network.backend": backend.url, "network.relays": [], "session.name": "Pilot" }))
const out = fs.openSync(`${data}-output.txt`, "w")
const core = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
const stop = async (code) => {
  core.kill()
  await backend.stop()
  guide.close()
  process.exit(code)
}
process.on("SIGINT", () => stop(1))

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

/** The freezes and the camera state, from the first page with SimVar that answers. */
async function read() {
  const pages = await listPages()
  const ordered = [...pages.filter((p) => /^VCockpit/i.test(p.title)), ...pages.filter((p) => !/^VCockpit/i.test(p.title))]
  for (const page of ordered) {
    try {
      const [ll, alt, att, camera] = await evaluate(page, READ, 3_000)
      return `freezes ${[ll, alt, att].map((f) => (f ? 1 : 0)).join(" ")}, camera ${camera}, from ${page.title}`
    } catch {
      // A page without SimVar, or one still loading.
    }
  }
  return "no page read the freezes"
}

async function phase(name, ask, reads) {
  guide.tick()
  guide.say(ask)
  say(`${name}: ${ask}`)
  await sleep(6_000)
  for (let i = 0; i < reads; i++) {
    say(`  ${name}: ${await read()}`)
    await sleep(1_000)
  }
}

say(`the core started on ${path.relative(ROOT, data)}`)
await until(() => /the sim's stage changed stage=Flying/.test(log()), 120_000, "the core to see the flight")
const port = JSON.parse(fs.readFileSync(path.join(data, "port.json"), "utf8")).port
const ws = new WebSocket(`ws://127.0.0.1:${port}`)
await new Promise((resolve) => (ws.onopen = resolve))
let preflight = null
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  if (message.t === "state" && message.slice === "session") preflight = message.value.preflight.phase
}
ws.send(JSON.stringify({ t: "hello", component: "desktop", version: VERSION, hash: HASH }))
ws.send(JSON.stringify({ t: "watch", slices: ["session"] }))
setInterval(() => ws.send(JSON.stringify({ t: "alive" })), 2_000).unref()
ws.send(JSON.stringify({ t: "command", id: 1, name: "session.host", args: null }))
await until(() => /holds the aircraft for preflight on=true/.test(log()), 30_000, "Hold")
say("the core holds the aircraft")

await phase("cockpit", "Sit in the cockpit.", 8)
await phase("walkaround", "Go to walkaround now, and try to walk.", 12)
await phase("cockpit again", "Go back to the cockpit now.", 8)

ws.send(JSON.stringify({ t: "command", id: 2, name: "session.ready", args: { on: true } }))
await until(() => preflight === "ended", 15_000, "preflight's end")
say("preflight ended")
await sleep(2_000)
for (let i = 0; i < 3; i++) {
  say(`  after preflight: ${await read()}`)
  await sleep(1_000)
}
guide.pass()
guide.say("Done.")
say(`done; the report is ${path.relative(ROOT, report)}`)
await sleep(1_500)
await stop(0)
