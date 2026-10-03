/*
 * p12: whether an object written every frame from inside the sim, by a WASM
 * module, holds still in a moving cockpit, on MSFS 2024.
 *
 * Written every frame from outside the sim, a wand beside the pilot of a
 * Cessna 152 at about 95 kt stuttered at every lead from 0ms to 300ms
 * (record/areas/avatars/log.md, 2026-10-03). The module crosscheck-p12-follow
 * (experiments/areas/avatars/wasm/) writes it from Update_StandAlone instead,
 * which runs after the sim's update and before the frame is drawn, by one of
 * two calls, chosen through L:CROSSCHECK_P12_MODE.
 *
 * Build and install the module with MSFS closed, then start the sim:
 *
 *   node experiments/areas/avatars/wasm/build.mjs
 *
 * About 40s in the C152, in level flight at cruise, the sim in front. The wand
 * floats 0.4m above the seat beside you, aimed at the seat's parked position
 * from p03. Press Page Down, then watch it; a short beep starts each step:
 *
 *   outside        written by this probe, from outside the sim, as in p09
 *   fsVarsAVarSet  written by the module with fsVarsAVarSet, targeting the wand
 *   SimConnect     written by the module with SimConnect_SetDataOnSimObject
 *
 * Press Page Down whenever the wand sits still on the seat.
 *
 * Nothing touches the pilot's input. The probe sets the module's mode back to
 * 0 and removes the wand at the end and on Ctrl+C, and the sim removes a
 * client's AI objects when the client disconnects (measured on MSFS 2024,
 * 2026-09-06, FS Copilot fork, record/traffic-atc/docs/build/log.md,
 * "2026-09-06 · Stage 0 capture read; TrafficInject built and smoke-tested —
 * Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p12-wasm.mjs
 *
 * Output: one line per step on the console, every frame's readings in
 * experiments/areas/avatars/results/p12-wasm-<time>.ndjson, and the report in
 * the .txt beside it.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody, toWorld, wrap } from "./lib/pose.mjs"

// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX + 1.
const USER_AVATAR = 0xffffffff - 128 + 1

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]

// Parked seat positions from p03 (experiments/areas/avatars/results/
// p03-cockpit-2026-10-02-21-42-04.txt), meters from the reference point.
const PARKED = {
  "Cessna C152 Aerial Advertising": { pilot: { forward: 0.10, right: -0.23, up: -0.14 }, beside: { forward: 0.10, right: 0.21, up: -0.13 } },
}

const STAND_IN = "Marshaller_Stick"
const HAND_UP_M = 0.4
const STEP_MS = 10_000
const STEPS = [
  { name: "outside", mode: 0 },
  { name: "fsVarsAVarSet", mode: 1 },
  { name: "SimConnect", mode: 2 },
]
const KT = 1.94384
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]
const COUNTERS = ["ALIVE", "FRAMES", "ERRORS", "LAST_ERROR"].map(L)

const rec = new Recorder("p12-wasm", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p12-wasm" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
const quantile = (a, q) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : null)
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

// ------------------------------------------------ every frame

let ac = null
let speed = 0
const history = []
const wand = { id: null, target: null, fromNode: false }
let step = null
const readings = new Map()

sim.watch(POS, {
  period: "frame",
  changed: false,
  label: "aircraft",
  onData: (v, t) => {
    const [lat, lon, alt, hdg] = POS.map(([n]) => v.get(n))
    if (!Number.isFinite(lat)) return
    ac = { t, lat, lon, alt, hdg }
    history.push(ac)
    while (history[0].t < t - 600) history.shift()
    const old = history[0]
    if (old !== ac) { const d = toBody(old, ac); speed = Math.hypot(d.forward, d.right) / ((t - old.t) / 1000) }
    if (wand.id !== null && wand.fromNode) {
      const at = toWorld(ac, wand.target)
      sim.set(POS, [at.lat, at.lon, at.alt, ac.hdg], { object: wand.id, label: "wand pose", quiet: true })
    }
  },
})

function bodyWatch(object, label, onBody) {
  return sim.watch(POS, {
    period: "frame",
    changed: false,
    label,
    object,
    onData: (v) => {
      const [lat, lon, alt] = POS.map(([n]) => v.get(n))
      if (!ac || !Number.isFinite(lat)) return
      onBody(toBody(ac, { lat, lon, alt }))
    },
  })
}

function keep(kind, b) {
  if (!step) return
  let r = readings.get(step)
  if (!r) readings.set(step, r = { avatar: [], wand: [], speed: [] })
  r[kind].push(b.forward)
  if (kind === "wand") r.speed.push(speed)
  rec.data(kind, step, b)
}
bodyWatch(USER_AVATAR, "avatar", (b) => keep("avatar", b))

// ------------------------------------------------ the module

async function counters() {
  const v = await sim.read(COUNTERS, { timeoutMs: 2000 })
  return Object.fromEntries(COUNTERS.map(([n]) => [n.replace("L:CROSSCHECK_P12_", "").toLowerCase(), v.get(n) ?? null]))
}

async function setModule(values) {
  for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}` })
}

await sleep(1000)
const a = await counters()
await sleep(500)
const b = await counters()
const alive = a.alive !== null && b.alive > a.alive
note("module", alive ? `crosscheck-p12-follow is running: L:CROSSCHECK_P12_ALIVE went ${a.alive} → ${b.alive} in 0.5s` : `crosscheck-p12-follow isn't running (L:CROSSCHECK_P12_ALIVE ${a.alive} → ${b.alive}): build it with the sim closed, then restart the sim`)

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const seats = PARKED[title] ?? null
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${(speed * KT).toFixed(0)} kt; ${seats ? "seats from p03's parked measurement" : "no parked seat positions for this aircraft: fly the C152"}`)

// ------------------------------------------------ the steps

let stopping = false
async function cleanUp() {
  wand.fromNode = false
  await setModule({ MODE: 0, OBJECT: 0 })
  if (wand.id !== null) sim.remove(wand.id)
  wand.id = null
  await sleep(800)
}
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: turning the module off and removing the wand")
  await cleanUp()
  process.exit(0)
})

const results = []
console.log("\nBefore you start: in the C152, in level flight at cruise, the sim in front. About 40s.")
console.log(`\n▶ The wand beside you\n  Press Page Down and watch the wand above the seat beside you. A short beep starts each of ${STEPS.length} steps, ${STEP_MS / 1000}s each.\n  PRESS PAGE DOWN WHENEVER THE WAND SITS STILL ON THE SEAT.\n  ${START} to start, ${SKIP} to skip.`)
const k = alive && seats && ac ? await keys.next() : { key: "SKIP" }
rec.log("key", `${k.key}${k.foreground ? `, with ${k.foreground} in front` : ""}`, k)

if (k.key === "START") {
  wand.target = { ...seats.beside, up: seats.beside.up + HAND_UP_M }
  const at = toWorld(ac, wand.target)
  const init = new InitPosition()
  Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: at.alt, pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(STAND_IN, "", init)
  if (r.id === undefined) {
    note("wand", `${STAND_IN}: not created: ${r.error}`)
  } else {
    for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
    wand.id = r.id
    await setModule({ MODE: 0, OBJECT: r.id, FWD: wand.target.forward, RIGHT: wand.target.right, UP: wand.target.up })
    const w = bodyWatch(r.id, "wand", (x) => keep("wand", x))
    const presses = []
    const unlisten = keys.listen((x) => { if (x.key === "START" && step) { presses.push(step); rec.log("press", `Page Down during ${step}`) } })
    await sleep(1000)
    for (const s of STEPS) {
      const before = await counters()
      wand.fromNode = s.mode === 0
      await setModule({ MODE: s.mode })
      step = s.name
      beep(1000, 100)
      await sleep(STEP_MS)
      step = null
      const after = await counters()
      const rr = readings.get(s.name) ?? { avatar: [], wand: [], speed: [] }
      const jumps = (f) => f.slice(1).map((x, i) => Math.abs(x - f[i]))
      const res = {
        step: s.name, presses: presses.filter((p) => p === s.name).length,
        speedKt: median(rr.speed) * KT,
        moduleFrames: after.frames - before.frames, moduleErrors: after.errors - before.errors, lastError: after.last_error,
        gap: rr.wand.length && rr.avatar.length ? median(rr.wand) - median(rr.avatar) - (wand.target.forward - seats.pilot.forward) : null,
        wandJump: median(jumps(rr.wand)), wandJump95: quantile(jumps(rr.wand), 0.95), avatarJump: median(jumps(rr.avatar)), avatarJump95: quantile(jumps(rr.avatar), 0.95),
      }
      results.push(res)
      note("step", `${s.name}: ${res.presses} press${res.presses === 1 ? "" : "es"}; ${res.speedKt?.toFixed(0)} kt; module wrote ${res.moduleFrames} frames with ${res.moduleErrors} errors${res.moduleErrors ? ` (last ${res.lastError})` : ""}; wand ahead of the sim's own objects by ${res.gap?.toFixed(2)}m; frame-to-frame the wand moved median ${res.wandJump?.toFixed(2)}m (p95 ${res.wandJump95?.toFixed(2)}m), the avatar's object ${res.avatarJump?.toFixed(2)}m (p95 ${res.avatarJump95?.toFixed(2)}m)`, res)
    }
    beep(500, 600)
    unlisten()
    w.stop()
    console.log("  Tell Claude how the wand sat in each step.")
  }
}

await cleanUp()
const text = [
  "p12 · An object written every frame from inside the sim by a WASM module, in a moving cockpit, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines.map((l) => `  ${l}`),
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
