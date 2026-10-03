/*
 * p13: whether a figure written every frame from inside the sim onto the
 * aircraft's own seat object sits in the seat and follows pitch and roll, on
 * MSFS 2024.
 *
 * In p12 the module kept a wand up with a flying C152, but the pilot saw it by
 * the tail at every step, and it lagged in pitch and roll because the module
 * turned its offset by heading only (record/areas/avatars/log.md, 2026-10-03).
 * This probe changes both:
 *
 *   - The stand-in is GSX's seated passenger, FSDT_Passenger_CASUAL_M_0030_SEATED,
 *     whose origin p05 found at its feet, not the marshaller's wand, whose
 *     origin is unknown. It goes 0.45m below the point, a guess at seat
 *     height, since in p05 its feet sat where the seat object is.
 *   - In the first step the module (crosscheck-p12-follow 0.2.0, mode 3) puts
 *     it on the seat object's own position every frame, which the sim already
 *     carries through pitch and roll. In the second (mode 1) it goes at the
 *     seat's parked offset from the aircraft, as in p12. Both give it the
 *     aircraft's heading, pitch, and bank.
 *
 * The module also reports where the seat object reads from inside the frame,
 * against SimConnect's reading from outside, which in flight put it about
 * 2.3m behind its parked spot (p08, p09).
 *
 * About 30s in the C152, in flight at cruise, autopilot off, the sim in front.
 * Press Page Down, then rock the wings and pitch gently, and watch the seat
 * beside you. A short beep starts each 12s step. PRESS PAGE DOWN WHENEVER THE
 * PASSENGER SITS STILL IN THE SEAT.
 *
 *   node experiments/areas/avatars/p13-seat-follow.mjs
 *
 * Nothing touches the pilot's input. The probe sets the module's mode back to
 * 0 and removes the passenger at the end and on Ctrl+C.
 *
 * Output: one line per step on the console, the readings in
 * experiments/areas/avatars/results/p13-seat-follow-<time>.ndjson, and the
 * report in the .txt beside it.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody, wrap } from "./lib/pose.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const ATTITUDE = [["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]
const FIGURE = "FSDT_Passenger_CASUAL_M_0030_SEATED"
const SEAT_DROP_M = -0.45
const STEP_MS = 12_000
const STEPS = [{ name: "on the seat object", mode: 3 }, { name: "at the parked offset", mode: 1 }]
const KT = 1.94384
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]

const rec = new Recorder("p13-seat-follow", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p13-seat-follow" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const where = (b) => `${b.forward.toFixed(2)}m forward, ${b.right.toFixed(2)}m right, ${b.up.toFixed(2)}m up`

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

// The seats, from the sim's own objects near the aircraft.
const seats = []
for (const id of ac ? await sim.byType(1, 50, { timeoutMs: 2000 }) : []) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (/^SEAT_/i.test(t)) seats.push({ id, title: t })
}
const beside = seats.find((s) => !/_pilot$/i.test(s.title)) ?? null
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${(speed * KT).toFixed(0)} kt; seats ${seats.map((s) => `${s.title} (${s.id})`).join(", ") || "none"}`)

// p03's parked offset of the C152's passenger seat, for the second step.
const PARKED_BESIDE = { forward: 0.10, right: 0.21, up: -0.13 }

let figure = null
async function cleanUp() {
  setModule({ MODE: 0, OBJECT: 0 })
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

console.log("\nBefore you start: in the C152, in flight at cruise, autopilot off, the sim in front. About 30s.")
console.log(`\n▶ A passenger beside you\n  Press Page Down, then rock the wings and pitch gently, and watch the seat beside you. A short beep starts each of ${STEPS.length} steps, ${STEP_MS / 1000}s each.\n  PRESS PAGE DOWN WHENEVER THE PASSENGER SITS STILL IN THE SEAT.\n  ${START} to start, ${SKIP} to skip.`)
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
    setModule({ MODE: 0, OBJECT: r.id, SEAT: beside.id, FWD: PARKED_BESIDE.forward, RIGHT: PARKED_BESIDE.right, UP: SEAT_DROP_M })
    const presses = []
    let step = null
    const unlisten = keys.listen((x) => { if (x.key === "START" && step) { presses.push(step); rec.log("press", `Page Down during ${step}`) } })
    // The seat object as SimConnect reads it from outside, against the
    // aircraft from the same frame.
    const outside = []
    const sw = sim.watch(POS, {
      period: "frame", changed: false, label: "seat, outside", object: beside.id,
      onData: (v) => { if (step && ac) outside.push({ step, ...toBody(ac, { lat: v.get("PLANE LATITUDE"), lon: v.get("PLANE LONGITUDE"), alt: v.get("PLANE ALTITUDE") }) }) },
    })
    await sleep(1000)
    for (const s of STEPS) {
      const before = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"])
      setModule({ MODE: s.mode })
      step = s.name
      beep(1000, 100)
      const inside = []
      const attitude = []
      const t0 = Date.now()
      while (Date.now() - t0 < STEP_MS) {
        const m = await readModule(["SEAT_FWD", "SEAT_RIGHT", "SEAT_UP"])
        if (m.SEAT_FWD !== null) inside.push({ forward: m.SEAT_FWD, right: m.SEAT_RIGHT, up: m.SEAT_UP })
        if (ac) attitude.push(Math.max(Math.abs(ac.pitch), Math.abs(ac.bank)))
        await sleep(200)
      }
      step = null
      const after = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"])
      const mid = (list) => ({ forward: median(list.map((x) => x.forward)), right: median(list.map((x) => x.right)), up: median(list.map((x) => x.up)) })
      const out = outside.filter((x) => x.step === s.name)
      const res = {
        step: s.name, presses: presses.filter((p) => p === s.name).length, speedKt: speed * KT,
        attitude: attitude.length ? Math.max(...attitude) : null,
        frames: after.FRAMES - before.FRAMES, errors: after.ERRORS - before.ERRORS, lastError: after.LAST_ERROR,
        seatInside: inside.length ? mid(inside) : null, seatOutside: out.length ? mid(out) : null,
      }
      note("step", `${s.name}: ${res.presses} press${res.presses === 1 ? "" : "es"}; ${res.speedKt.toFixed(0)} kt, attitude up to ${res.attitude?.toFixed(1)}°; module wrote ${res.frames} frames with ${res.errors} errors${res.errors ? ` (last ${res.lastError})` : ""}; the seat object reads ${res.seatInside ? where(res.seatInside) : "—"} from inside the frame, ${res.seatOutside ? where(res.seatOutside) : "—"} from SimConnect outside`, res)
    }
    beep(500, 600)
    unlisten()
    sw.stop()
    console.log("  Tell Claude where the passenger sat in each step, and whether it followed the rocking and pitching.")
  }
}

await cleanUp()
const text = [
  "p13 · A seated figure written every frame from inside the sim, on the seat object or at its parked offset, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines.map((l) => `  ${l}`),
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
