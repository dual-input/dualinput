/*
 * p10: whether the sim carries an object of category Viewer with the aircraft
 * by itself, on MSFS 2024.
 *
 * Objects we wrote every frame from outside the sim stuttered against a
 * moving cockpit (record/areas/avatars/log.md, 2026-10-03), yet the pilot has
 * seen GSX's seated passengers sit still in a flying Fenix A320. GSX's
 * in-sim module does no per-frame writes (read in fsdreamteam-gsx-pro 4.0.19,
 * modules/fsdt-msfs-bridge.wasm, whose imports are client data, events, and
 * execute_calculator_code). Its per-aircraft seat object,
 * FSDT_Passengers_Seats_FNX_A320_01, has category = Viewer, and its model
 * hangs a seated passenger on each seat node, shown while that seat's
 * L:FSDT_GSX_PASSENGER_SEAT_<row><letter> and L:FSDT_GSX_INTPAX_VISIBLE are
 * set (read in the same package, SimObjects/GroundVehicles/
 * FSDT_Passengers_Seats). What category Viewer means isn't documented.
 *
 * The probe spawns that object at the aircraft's position, writes nothing to
 * it, turns on the passengers of rows 1 to 31, and reads every frame where the
 * object is against the aircraft. If the sim carries it, its distance from the
 * aircraft holds; if not, the aircraft flies away from it.
 *
 * About 30s in level flight, the sim in front:
 *
 *   viewer   Press Page Down, then look ahead and behind for passengers
 *            floating around the aircraft, until the long low beep, 20s.
 *
 * The probe reads every L: variable it sets first and puts each back at the
 * end and on Ctrl+C, because GSX uses them. The object goes with
 * AIRemoveObject at the end, and the sim removes a client's AI objects when
 * the client disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot fork,
 * record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture read;
 * TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p10-viewer.mjs
 *
 * Output: one line per step on the console, every frame's readings in
 * experiments/areas/avatars/results/p10-viewer-<time>.ndjson, and the report
 * in the .txt beside it.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody, wrap } from "./lib/pose.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SEATS = "FSDT_Passengers_Seats_FNX_A320_01"
const ROWS = 31
const LETTERS = ["A", "B", "C", "D", "E", "F"]
const LVARS = ["L:FSDT_GSX_INTPAX_VISIBLE", ...Array.from({ length: ROWS }, (_, i) => LETTERS.map((l) => `L:FSDT_GSX_PASSENGER_SEAT_${i + 1}${l}`)).flat()]
const WATCH_MS = 20_000
const KT = 1.94384

const rec = new Recorder("p10-viewer", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p10-viewer" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

let ac = null
const history = []
let speed = 0
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
  },
})

// What each L: variable held before, so the probe can put it back.
let saved = null
async function setPassengers(on) {
  if (on) {
    const v = await sim.read(LVARS.map((n) => [n, "number"]), { timeoutMs: 3000 })
    saved = new Map(LVARS.map((n) => [n, v.get(n) ?? 0]))
    for (const n of LVARS) sim.set([[n, "number"]], [1], { quiet: true, label: `set ${n}` })
    rec.log("lvars", `set ${LVARS.length} L: variables to 1; ${[...saved.values()].filter((x) => x !== 0).length} were nonzero before`)
  } else if (saved) {
    for (const [n, x] of saved) sim.set([[n, "number"]], [x], { quiet: true, label: `restore ${n}` })
    rec.log("lvars", `put back ${saved.size} L: variables`)
    saved = null
  }
}

let id = null
const readings = []
let watching = false

process.on("SIGINT", async () => {
  rec.log("stop", "Ctrl+C: restoring the L: variables and removing the object")
  await setPassengers(false)
  if (id !== null) sim.remove(id)
  setTimeout(() => process.exit(0), 500)
})

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

await sleep(1000)
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
rec.log("setup", `aircraft TITLE ${JSON.stringify(title)}, ${(speed * KT).toFixed(0)} kt over the ground`)
console.log("\nBefore you start: in level flight, the sim in front. About 30s.")

let result = null
if (ac && await ask("GSX's seat object", `Press Page Down, then look ahead and behind for passengers floating around the aircraft, until the long low beep, ${WATCH_MS / 1000}s.`)) {
  const start = { ...ac }
  const init = new InitPosition()
  Object.assign(init, { latitude: start.lat, longitude: start.lon, altitude: start.alt, pitch: 0, bank: 0, heading: wrap(start.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(SEATS, "", init)
  if (r.id === undefined) {
    result = { error: r.error }
    rec.log("viewer", `${SEATS}: not created: ${r.error}`)
  } else {
    id = r.id
    const cat = (await sim.readStrings(["CATEGORY"], { object: id })).get("CATEGORY") ?? null
    await setPassengers(true)
    const t0 = Date.now()
    watching = true
    const w = sim.watch(POS, {
      period: "frame",
      changed: false,
      label: "seat object",
      object: id,
      onData: (v, t) => {
        const [lat, lon, alt] = POS.map(([n]) => v.get(n))
        if (!watching || !ac || !Number.isFinite(lat)) return
        const b = toBody(ac, { lat, lon, alt })
        const fromStart = toBody(start, { lat, lon, alt })
        readings.push({ s: (t - t0) / 1000, ...b, movedM: Math.hypot(fromStart.forward, fromStart.right), speed })
        rec.data("seats", "", readings[readings.length - 1])
      },
    })
    beep(1000, 100)
    await sleep(WATCH_MS)
    watching = false
    w.stop()
    beep(500, 600)
    const first = readings.slice(0, 30)
    const last = readings.slice(-30)
    const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length
    result = readings.length
      ? {
          category: cat, frames: readings.length,
          startForward: avg(first, "forward"), endForward: avg(last, "forward"),
          endRight: avg(last, "right"), endUp: avg(last, "up"),
          movedM: last[last.length - 1].movedM, seconds: last[last.length - 1].s, speedKt: avg(readings, "speed") * KT,
        }
      : { category: cat, frames: 0 }
    const carried = result.frames && Math.abs(result.endForward - result.startForward) < 10
    rec.log("viewer", result.frames
      ? `${SEATS} (${cat}): ${result.frames} frames; forward of the aircraft ${result.startForward.toFixed(1)}m at the start and ${result.endForward.toFixed(1)}m at the end, after the object itself moved ${result.movedM.toFixed(0)}m over the ground in ${result.seconds.toFixed(0)}s at ${result.speedKt.toFixed(0)} kt: ${carried ? "CARRIED with the aircraft" : "left behind"}`
      : `${SEATS} (${cat}): no position read back`, result)
    console.log("  Tell Claude whether you saw passengers, where, and whether they kept up with you smoothly.")
    await setPassengers(false)
    sim.remove(id)
    id = null
  }
}

const text = [
  "p10 · An object of category Viewer, spawned and not written, in a flying aircraft, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  `Aircraft: TITLE ${JSON.stringify(title)}`,
  "",
  result === null ? "  not run"
    : result.error ? `  ${SEATS}: not created: ${result.error}`
      : result.frames
        ? `  ${SEATS} (${result.category}): ${result.frames} frames; ${result.startForward.toFixed(1)}m forward of the aircraft at the start, ${result.endForward.toFixed(1)}m at the end (${result.endRight.toFixed(1)}m right, ${result.endUp.toFixed(1)}m up); the object moved ${result.movedM.toFixed(0)}m over the ground in ${result.seconds.toFixed(0)}s at ${result.speedKt.toFixed(0)} kt`
        : `  ${SEATS} (${result.category}): no position read back`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
