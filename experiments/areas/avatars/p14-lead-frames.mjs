/*
 * p14: how many frames ahead the WASM module has to write a figure for it to
 * sit in the seat of a flying aircraft, on MSFS 2024.
 *
 * In p13 the module wrote GSX's seated passenger every frame, and it sat
 * outside behind the C152's cabin: a meter or two back at the seat's parked
 * offset from the aircraft, and further back on the seat object's own
 * position. From inside the frame the seat object read about one frame of
 * travel behind the aircraft (experiments/areas/avatars/results/
 * p13-seat-follow-2026-10-03-06-41-53.txt, and the pilot's screen recording).
 * Neither stuttered, so the gap is steady, and a steady gap can be led.
 *
 * The module (crosscheck-p12-follow 0.3.0) moves the figure on by
 * L:CROSSCHECK_P12_LEAD times what the aircraft moved since the previous
 * frame. Three steps, 10s each, a short beep at each:
 *
 *   offset, 1 frame    at the seat's parked offset, led by one frame
 *   offset, 2 frames   the same, led by two
 *   seat, 2 frames     on the seat object's own position, led by two
 *
 * About 35s in the C152, in flight at cruise, the sim in front. Press Page
 * Down, then look at the seat beside you, rocking the wings gently. PRESS PAGE
 * DOWN WHENEVER THE PASSENGER SITS IN THE SEAT.
 *
 *   node experiments/areas/avatars/p14-lead-frames.mjs
 *
 * Nothing touches the pilot's input. The probe turns the module off and
 * removes the passenger at the end and on Ctrl+C.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody, wrap } from "./lib/pose.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const ATTITUDE = [["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]
const FIGURE = "FSDT_Passenger_CASUAL_M_0030_SEATED"
// p13's guess at seat height; the pilot says if it sits too high or low.
const SEAT_DROP_M = -0.45
// p03's parked offset of the C152's passenger seat.
const PARKED_BESIDE = { forward: 0.10, right: 0.21, up: -0.13 }
const STEP_MS = 10_000
const STEPS = [
  { name: "offset, 1 frame", mode: 1, lead: 1 },
  { name: "offset, 2 frames", mode: 1, lead: 2 },
  { name: "seat, 2 frames", mode: 3, lead: 2 },
]
const KT = 1.94384
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]

const rec = new Recorder("p14-lead-frames", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p14-lead-frames" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

let ac = null
let speed = 0
const history = []
sim.watch([...POS, ...ATTITUDE], {
  period: "frame",
  changed: false,
  label: "aircraft",
  onData: (v, t) => {
    const [lat, lon, alt, hdg, pitch, bank] = [...POS, ...ATTITUDE].map(([n]) => v.get(n))
    if (!Number.isFinite(lat)) return
    ac = { t, lat, lon, alt, hdg, pitch, bank }
    history.push(ac)
    while (history[0].t < t - 600) history.shift()
    const old = history[0]
    if (old !== ac) { const d = toBody(old, ac); speed = Math.hypot(d.forward, d.right) / ((t - old.t) / 1000) }
  },
})

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}` }) }

await sleep(1000)
const a = await readModule(["ALIVE"])
await sleep(500)
const b = await readModule(["ALIVE"])
const alive = a.ALIVE !== null && b.ALIVE > a.ALIVE
note("module", alive ? `crosscheck-p12-follow is running (L:CROSSCHECK_P12_ALIVE ${a.ALIVE} → ${b.ALIVE} in 0.5s)` : "crosscheck-p12-follow isn't running: rebuild it with the sim closed, then restart the sim")

const seats = []
for (const id of ac ? await sim.byType(1, 50, { timeoutMs: 2000 }) : []) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (/^SEAT_/i.test(t)) seats.push({ id, title: t })
}
const beside = seats.find((s) => !/_pilot$/i.test(s.title)) ?? null
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${(speed * KT).toFixed(0)} kt; seats ${seats.map((s) => s.title).join(", ") || "none"}`)

let figure = null
async function cleanUp() {
  setModule({ MODE: 0, OBJECT: 0, LEAD: 0 })
  if (figure !== null) sim.remove(figure)
  figure = null
  await sleep(800)
}
let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: turning the module off and removing the passenger")
  await cleanUp()
  process.exit(0)
})

console.log("\nBefore you start: in the C152, in flight at cruise, the sim in front. About 35s.")
console.log(`\n▶ A passenger beside you\n  Press Page Down, then look at the seat beside you, rocking the wings gently. A short beep starts each of ${STEPS.length} steps, ${STEP_MS / 1000}s each.\n  PRESS PAGE DOWN WHENEVER THE PASSENGER SITS IN THE SEAT.\n  ${START} to start, ${SKIP} to skip.`)
const k = alive && beside && ac ? await keys.next() : { key: "SKIP" }
rec.log("key", `${k.key}${k.foreground ? `, with ${k.foreground} in front` : ""}`, k)

if (k.key === "START") {
  const sv = await sim.read(POS, { object: beside.id })
  const init = new InitPosition()
  Object.assign(init, { latitude: sv.get("PLANE LATITUDE"), longitude: sv.get("PLANE LONGITUDE"), altitude: sv.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(FIGURE, "", init)
  if (r.id === undefined) {
    note("figure", `${FIGURE}: not created: ${r.error}`)
  } else {
    figure = r.id
    for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
    setModule({ MODE: 0, LEAD: 0, OBJECT: r.id, SEAT: beside.id, FWD: PARKED_BESIDE.forward, RIGHT: PARKED_BESIDE.right, UP: SEAT_DROP_M })
    const presses = []
    let step = null
    const unlisten = keys.listen((x) => { if (x.key === "START" && step) { presses.push(step); rec.log("press", `Page Down during ${step}`) } })
    await sleep(1000)
    for (const s of STEPS) {
      const before = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"])
      setModule({ LEAD: s.lead, MODE: s.mode })
      step = s.name
      beep(1000, 100)
      const attitude = []
      const t0 = Date.now()
      while (Date.now() - t0 < STEP_MS) {
        if (ac) attitude.push(Math.max(Math.abs(ac.pitch), Math.abs(ac.bank)))
        await sleep(200)
      }
      step = null
      const after = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"])
      const res = {
        step: s.name, presses: presses.filter((p) => p === s.name).length, speedKt: speed * KT,
        attitude: attitude.length ? Math.max(...attitude) : null,
        frames: after.FRAMES - before.FRAMES, errors: after.ERRORS - before.ERRORS, lastError: after.LAST_ERROR,
      }
      note("step", `${s.name}: ${res.presses} press${res.presses === 1 ? "" : "es"}; ${res.speedKt.toFixed(0)} kt, attitude up to ${res.attitude?.toFixed(1)}°; module wrote ${res.frames} frames with ${res.errors} errors${res.errors ? ` (last ${res.lastError})` : ""}`, res)
    }
    beep(500, 600)
    unlisten()
    console.log("  Tell Claude where the passenger sat in each step: behind, in, or ahead of the seat, and how high.")
  }
}

await cleanUp()
const text = [
  "p14 · How many frames ahead the WASM module writes a seated figure, in a flying aircraft, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines.map((l) => `  ${l}`),
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
