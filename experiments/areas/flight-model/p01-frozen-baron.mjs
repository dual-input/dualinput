/*
 * p01: what a frozen Black Square Baron 58P does when we set it the way a
 * following machine would, on MSFS 2024.
 *
 * v1 flies the traditional way: the following machine freezes its aircraft's
 * position, altitude, and attitude and writes the flying machine's values every
 * frame, as our FS Copilot fork does (read in the FS Copilot fork,
 * FsCopilot.Bridge.Wasm/wasm_module.cpp, apply_control and interpolate). Two
 * things about the Baron could break that (read in bksq-aircraft-baronpro
 * 0.1.1, record/areas/aircraft/black-square-baron-pro/study.md, sim question 6):
 *
 *   - Its logic reads A:SIM ON GROUND, and nobody knows what a frozen aircraft
 *     written above or below the ground reports there.
 *   - It writes physics of its own: A:VELOCITY BODY X and Z set to 0 at 60 Hz
 *     while L:bksq_WheelChocks is set, and A:PLANE BANK DEGREES at 15 Hz during
 *     an engine start. Either could fight a follower's writes.
 *
 * Our writes come from outside the sim, once per sim frame, which stutters in
 * a moving cockpit (record/areas/avatars/log.md, 2026-10-03). On the ground,
 * moving slowly, that doesn't matter: the question is whose value the sim
 * holds, ours or the Baron's.
 *
 * Steps, about 1.5 minutes, the first five on their own:
 *
 *   baseline   3s: the parked aircraft as it is, nothing written.
 *   ground     14s: frozen and written where it is, then 5 ft high, then 2 ft
 *              low, then where it was. What do A:SIM ON GROUND, the gear, the
 *              cowl flaps, and the chocks do?
 *   chocks     7s: chocks in, frozen, and written rolling forward at 5 ft/s
 *              for 5s, then put back. Does the Baron's zeroing of VELOCITY BODY
 *              Z show, and does the position hold where we write it?
 *   released   3s: unfrozen. Does the aircraft drop, bounce, or roll?
 *   start      You, up to 45s: frozen and its attitude written every frame,
 *              you start the left engine. Does the Baron's bank shake show?
 *
 * It fails open: every step unfreezes when it ends, Ctrl+C and any crash
 * unfreeze on the way out, and from any terminal
 *
 *   node experiments/areas/flight-model/p01-frozen-baron.mjs --unfreeze
 *
 * clears the three freezes. The chocks go back to how they were.
 *
 *   node experiments/areas/flight-model/p01-frozen-baron.mjs
 *
 * Output: one line per step on the console, every frame in
 * experiments/areas/flight-model/results/p01-frozen-baron-<time>.ndjson, and
 * the report in the .txt beside it.
 */

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { offset, toBody, turn } from "../avatars/lib/pose.mjs"

const FREEZES = ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]

// Written together, positionally, so every name here has to be one the sim
// accepts for writing.
const POSE = [
  ["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"],
  ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"], ["PLANE HEADING DEGREES TRUE", "degrees"],
]
const SPEED = [["VELOCITY BODY Z", "feet per second"], ["VELOCITY BODY X", "feet per second"]]

const WATCH = [
  ...POSE, ...SPEED,
  ["GROUND VELOCITY", "knots"], ["SIM ON GROUND", "bool"], ["PLANE ALT ABOVE GROUND", "feet"],
  ["GEAR IS ON GROUND:0", "bool"], ["GEAR IS ON GROUND:1", "bool"], ["GEAR IS ON GROUND:2", "bool"],
  ["RECIP ENG COWL FLAP POSITION:1", "percent"],
  ["IS LATITUDE LONGITUDE FREEZE ON", "bool"], ["IS ALTITUDE FREEZE ON", "bool"], ["IS ATTITUDE FREEZE ON", "bool"],
  ["GENERAL ENG STARTER:1", "bool"], ["ENG COMBUSTION:1", "bool"], ["PROP RPM:1", "rpm"],
  ["L:bksq_WheelChocks", "number"], ["L:bksq_controlLocks", "number"],
]
const SETS = ["SIM ON GROUND", "GEAR IS ON GROUND:0", "GEAR IS ON GROUND:1", "GEAR IS ON GROUND:2",
  "IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON",
  "GENERAL ENG STARTER:1", "ENG COMBUSTION:1", "L:bksq_WheelChocks", "L:bksq_controlLocks"]
const RANGES = ["PLANE ALT ABOVE GROUND", "RECIP ENG COWL FLAP POSITION:1", "GROUND VELOCITY", "PROP RPM:1"]

const ROLL_FPS = 5
const FT = 0.3048
const START_MS = 45_000
const RUNNING_MS = 5000

// ---------------------------------------------------------------- --unfreeze

if (process.argv.includes("--unfreeze")) {
  const rec = new Recorder("p01-unfreeze", { area: "flight-model" })
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-unfreeze" })
  for (const e of FREEZES) sim.transmit(e, [0])
  await sleep(500)
  const v = await sim.read(WATCH.filter(([n]) => n.startsWith("IS ")))
  console.log([...v].map(([n, x]) => `${n} ${fmt(x)}`).join(", "))
  sim.close()
  process.exit(0)
}

// ---------------------------------------------------------------- the probe

const rec = new Recorder("p01-frozen-baron", { area: "flight-model" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p01-frozen-baron" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

let frozen = false
let title = null
let chocksBefore = null
function freeze(on) {
  for (const e of FREEZES) sim.transmit(e, [on ? 1 : 0], { quiet: true })
  frozen = on
  rec.log(on ? "freeze" : "unfreeze", on ? "position, altitude, and attitude frozen" : "freezes cleared")
}

// Whatever happens, the aircraft doesn't stay frozen.
process.on("exit", () => {
  if (!frozen || sim.gone) return
  try { for (const e of FREEZES) sim.transmit(e, [0], { quiet: true }) } catch { /* the connection is gone */ }
})
process.on("uncaughtException", (e) => {
  rec.log("error", e.stack ?? String(e))
  process.exit(1)
})

// The pose we write each frame while a step drives, or null.
let drive = null
let phase = null
const steps = []

const w = sim.watch(WATCH, {
  period: "frame",
  changed: false,
  label: "frame",
  onData: (v, t) => {
    const read = Object.fromEntries(v)
    let wrote = null
    if (drive) {
      wrote = drive(t)
      sim.set(POSE, wrote.pose, { label: "write pose", quiet: true })
      if (wrote.speed) sim.set(SPEED, wrote.speed, { label: "write speed", quiet: true })
    }
    if (phase) {
      phase.frames.push({ t, read, wrote })
      rec.data("frame", "", { phase: phase.name, read, wrote })
    }
  },
})

const latest = () => Object.fromEntries(w.values)
const poseOf = (r) => ({
  lat: r["PLANE LATITUDE"], lon: r["PLANE LONGITUDE"], alt: r["PLANE ALTITUDE"],
  pitch: r["PLANE PITCH DEGREES"], bank: r["PLANE BANK DEGREES"], hdg: r["PLANE HEADING DEGREES TRUE"],
})
const poseValues = (p) => [p.lat, p.lon, p.alt, p.pitch, p.bank, p.hdg]

async function step(name, ms, { driver = null, until = null } = {}) {
  phase = { name, frames: [], started: Date.now() }
  drive = driver
  beep(1000, 100)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (until?.()) break
    await sleep(50)
  }
  drive = null
  const done = phase
  phase = null
  done.summary = summarize(done)
  steps.push(done)
  rec.log("step", `${name}: ${done.summary}`, { step: name })
  return done
}

function summarize(s) {
  const f = s.frames
  if (!f.length) return "no frames"
  const parts = [`${f.length} frames in ${((f[f.length - 1].t - f[0].t) / 1000).toFixed(1)}s`]
  for (const n of SETS) {
    const vals = [...new Set(f.map((x) => x.read[n]).filter((x) => x !== undefined))]
    parts.push(`${n} ${vals.length ? vals.map(fmt).join("/") : "—"}`)
  }
  for (const n of RANGES) {
    const vals = f.map((x) => x.read[n]).filter(Number.isFinite)
    parts.push(`${n} ${vals.length ? `${fmt(Math.min(...vals))}..${fmt(Math.max(...vals))}` : "—"}`)
  }
  const written = f.filter((x) => x.wrote)
  if (written.length) {
    let posM = 0, altFt = 0, bankDeg = 0, pitchDeg = 0, hdgDeg = 0
    let vzOff = 0, vzMin = Infinity, vzMax = -Infinity
    for (const x of written) {
      const r = poseOf(x.read)
      const [lat, lon, alt, pitch, bank, hdg] = x.wrote.pose
      const b = toBody({ lat, lon, alt, hdg }, r)
      posM = Math.max(posM, Math.hypot(b.forward, b.right))
      altFt = Math.max(altFt, Math.abs(r.alt - alt))
      pitchDeg = Math.max(pitchDeg, Math.abs(r.pitch - pitch))
      bankDeg = Math.max(bankDeg, Math.abs(r.bank - bank))
      hdgDeg = Math.max(hdgDeg, Math.abs(turn(hdg, r.hdg)))
      const vz = x.read["VELOCITY BODY Z"]
      if (Number.isFinite(vz)) {
        vzMin = Math.min(vzMin, vz)
        vzMax = Math.max(vzMax, vz)
        if (x.wrote.speed && Math.abs(vz - x.wrote.speed[0]) > 0.5) vzOff++
      }
    }
    parts.push(`read back against the frame's write: position up to ${posM.toFixed(2)}m off, altitude ${altFt.toFixed(2)} ft, pitch ${pitchDeg.toFixed(2)}°, bank ${bankDeg.toFixed(2)}°, heading ${hdgDeg.toFixed(2)}°`)
    if (written.some((x) => x.wrote.speed)) parts.push(`VELOCITY BODY Z ${fmt(vzMin)}..${fmt(vzMax)} ft/s, ${vzOff} of ${written.length} frames more than 0.5 ft/s from what we wrote`)
  }
  return parts.join(", ")
}

let stopping = false
async function finish(why = null) {
  if (stopping) return
  stopping = true
  drive = null
  phase = null
  if (frozen) freeze(false)
  if (chocksBefore !== null && latest()["L:bksq_WheelChocks"] !== chocksBefore) sim.write("L:bksq_WheelChocks", "number", chocksBefore, { label: "put the chocks back" })
  await sleep(300)
  w.stop()
  const lines = [
    "p01 · A frozen Baron 58P set the way a following machine would, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Aircraft: TITLE ${JSON.stringify(title)}`,
    why ? `Stopped: ${why}` : null,
    "",
  ].filter((x) => x !== null)
  for (const s of steps) lines.push(`${s.name}: ${s.summary}`, "")
  const exceptions = rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text)
  const counted = new Map()
  for (const e of exceptions) counted.set(e, (counted.get(e) ?? 0) + 1)
  lines.push(`Exceptions: ${exceptions.length ? "" : "none"}`)
  for (const [e, n] of counted) lines.push(`  ${n} × ${e}`)
  const text = lines.join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}

process.on("SIGINT", async () => {
  rec.log("stop", "Ctrl+C: unfreezing and writing the report")
  await finish("Ctrl+C")
  process.exit(0)
})

// ---------------------------------------------------------------- steps

title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
rec.log("aircraft", `TITLE ${JSON.stringify(title)}`)
if (!/baron/i.test(title ?? "")) console.log("  This isn't a Baron; the probe runs anyway, but it asks about the Baron.")

console.log([
  "",
  "Before you start:",
  "  - the Baron 58P parked on a ramp, engines off, with at least 15m clear ahead",
  "  - the sim in front, with this console where you can read it",
  "  - the first five steps run on their own, about 30s; then the probe asks you to start the left engine",
].join("\n"))
await sleep(1500)

const base = poseOf(latest())
chocksBefore = latest()["L:bksq_WheelChocks"] ?? null
rec.log("base", `at ${fmt(base.lat)}, ${fmt(base.lon)}, ${fmt(base.alt)} ft, heading ${fmt(base.hdg)}°, chocks ${fmt(chocksBefore)}`)

// --start runs only the last step, for a run whose engine start was missed.
if (!process.argv.includes("--start")) await groundSteps()
await startStep()
await finish()
process.exit(0)

async function groundSteps() {
await step("baseline", 3000)

freeze(true)
const at = (dAlt) => () => ({ pose: poseValues({ ...base, alt: base.alt + dAlt }) })
await step("frozen where it is", 3000, { driver: at(0) })
await step("frozen 5 ft high", 4000, { driver: at(5) })
await step("frozen 2 ft low", 4000, { driver: at(-2) })
await step("frozen where it was", 3000, { driver: at(0) })

sim.write("L:bksq_WheelChocks", "number", 1, { label: "chocks in" })
await sleep(500)
let rollStart = null
await step("frozen, chocks in, rolling at 5 ft/s", 5000, {
  driver: (t) => {
    rollStart ??= t
    const m = ((t - rollStart) / 1000) * ROLL_FPS * FT
    return { pose: poseValues({ ...offset(base, m, 0), alt: base.alt, pitch: base.pitch, bank: base.bank, hdg: base.hdg }), speed: [ROLL_FPS, 0] }
  },
})
await step("frozen, chocks in, put back", 2000, { driver: () => ({ pose: poseValues(base), speed: [0, 0] }) })
if (chocksBefore !== null) sim.write("L:bksq_WheelChocks", "number", chocksBefore, { label: "chocks as they were" })

freeze(false)
await step("released", 3000)
beep(500, 600)
}

async function startStep() {
if (latest()["ENG COMBUSTION:1"] === 1) console.log("\n  The left engine is running. Shut it down before you press Page Down, or the step has no start to watch.")
console.log(`\n▶ Engine start, frozen\n  Press ${START} first, then start the left engine as you normally would. The aircraft stays frozen and its attitude is written every frame. The step ends 5s after the engine catches, or after 45s. ${SKIP} skips it.`)
const k = await keys.next()
rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
if (k.key === "START") {
  const here = poseOf(latest())
  freeze(true)
  let cranked = false
  let runningSince = null
  await step("frozen, engine start", START_MS, {
    driver: () => ({ pose: poseValues(here) }),
    // Only an engine that caught after the starter turned ends the step, so an
    // engine already running when the step began doesn't end it.
    until: () => {
      const r = latest()
      if (r["GENERAL ENG STARTER:1"] === 1) cranked = true
      if (cranked && r["ENG COMBUSTION:1"] === 1) runningSince ??= Date.now()
      else runningSince = null
      return runningSince !== null && Date.now() - runningSince > RUNNING_MS
    },
  })
  // While the starter turned is when the Baron writes its shake.
  const s = steps[steps.length - 1]
  const cranking = s.frames.filter((x) => x.read["GENERAL ENG STARTER:1"] === 1 && x.wrote)
  const dev = cranking.map((x) => Math.abs(x.read["PLANE BANK DEGREES"] - x.wrote.pose[4])).filter(Number.isFinite)
  s.summary += `; while the starter was engaged, ${cranking.length} frames, bank up to ${dev.length ? Math.max(...dev).toFixed(2) : "—"}° from what we wrote, ${dev.filter((d) => d > 0.05).length} frames more than 0.05° off`
  freeze(false)
  beep(500, 600)
}
}
