/*
 * p15: whether turning the seat offset by full pitch and bank, with signs the
 * sim itself confirms, holds a WASM-written figure in the seat of a rocking
 * aircraft, on MSFS 2024.
 *
 * Led by one frame, the module put GSX's seated passenger in the C152's
 * passenger seat, but it didn't hold still while the pilot rocked the wings
 * (record/areas/avatars/log.md, 2026-10-03). The module turned the offset by
 * heading only, because the signs of A:PLANE PITCH DEGREES and A:PLANE BANK
 * DEGREES weren't known.
 *
 * crosscheck-p12-follow 0.4.0 turns it by pitch and bank too, and measures the
 * signs: every frame it predicts where SEAT_C152_Pax is from the seat's parked
 * offset, under each of the four sign pairs, from this frame's aircraft pose
 * and from the previous frame's, and keeps each prediction's RMS error. The
 * sim carries the seat through pitch and roll itself, so the pair near zero is
 * the convention.
 *
 * About a minute in the C152, in flight at cruise, autopilot off, the sim in
 * front:
 *
 *   signs   Press Page Down, then rock the wings and pitch up and down for
 *           12s, firmly: about 20° of bank each way and 5° of pitch.
 *   seat    Press Page Down, and keep rocking and pitching gently while you
 *           watch the passenger. A short beep starts each 8s step:
 *             offset, 0.75 / 1 / 1.25 frames   the parked offset, led
 *             seat, 2 frames                   the seat object, led
 *           PRESS PAGE DOWN WHENEVER THE PASSENGER SITS STILL IN THE SEAT.
 *
 *   node experiments/areas/avatars/p15-attitude.mjs
 *
 * Nothing touches the pilot's input. The probe turns the module off and
 * removes the passenger at the end and on Ctrl+C.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody, wrap } from "./lib/pose.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const ATTITUDE = [["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]
const FIGURE = "FSDT_Passenger_CASUAL_M_0030_SEATED"
// p03's parked offset of the C152's passenger seat.
const PARKED_BESIDE = { forward: 0.10, right: 0.21, up: -0.13 }
// p14's passenger sat too high at -0.45m; this is a second guess.
const SEAT_DROP_M = -0.7
const CAL_MS = 12_000
const STEP_MS = 8000
const SUFFIXES = ["PP", "PN", "NP", "NN"]
const SIGNS = { PP: [1, 1], PN: [1, -1], NP: [-1, 1], NN: [-1, -1] }
const KT = 1.94384
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]

const rec = new Recorder("p15-attitude", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p15-attitude" })
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

// The pitch and bank range over a window, sampled every 200ms.
async function watchAttitude(ms) {
  const p = [], b = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (ac) { p.push(ac.pitch); b.push(ac.bank) }
    await sleep(200)
  }
  const range = (a) => (a.length ? `${Math.min(...a).toFixed(1)}..${Math.max(...a).toFixed(1)}°` : "—")
  return { pitch: range(p), bank: range(b) }
}

await sleep(1000)
const a0 = await readModule(["ALIVE"])
await sleep(500)
const a1 = await readModule(["ALIVE"])
const alive = a0.ALIVE !== null && a1.ALIVE > a0.ALIVE
note("module", alive ? `crosscheck-p12-follow is running (L:CROSSCHECK_P12_ALIVE ${a0.ALIVE} → ${a1.ALIVE} in 0.5s)` : "crosscheck-p12-follow isn't running: rebuild it with the sim closed, then restart the sim")

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

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}${k.foreground ? `, with ${k.foreground} in front` : ""}`, k)
  return k.key === "START"
}

console.log("\nBefore you start: in the C152, in flight at cruise, autopilot off, the sim in front. About a minute.")

// signs -------------------------------------------

let signs = null
if (alive && beside && ac && await ask("Signs", `Press Page Down, then rock the wings and pitch up and down for ${CAL_MS / 1000}s, firmly: about 20° of bank each way and 5° of pitch. Stop at the long low beep.`)) {
  setModule({ SEAT: beside.id, CAL_FWD: PARKED_BESIDE.forward, CAL_RIGHT: PARKED_BESIDE.right, CAL_UP: PARKED_BESIDE.up, CAL_RESET: 1 })
  beep(1000, 100)
  const att = await watchAttitude(CAL_MS)
  beep(500, 600)
  const cal = await readModule([...SUFFIXES.map((s) => `CAL_NOW_${s}`), ...SUFFIXES.map((s) => `CAL_PREV_${s}`)])
  const all = [...SUFFIXES.map((s) => ({ key: s, from: "now", err: cal[`CAL_NOW_${s}`] })), ...SUFFIXES.map((s) => ({ key: s, from: "prev", err: cal[`CAL_PREV_${s}`] }))].filter((x) => x.err !== null)
  const best = all.sort((x, y) => x.err - y.err)[0] ?? null
  signs = best ? SIGNS[best.key] : null
  note("signs", `pitch ${att.pitch}, bank ${att.bank}; RMS error predicting the seat, this frame's pose: ${SUFFIXES.map((s) => `${s} ${fmt(cal[`CAL_NOW_${s}`])}m`).join(", ")}; previous frame's pose: ${SUFFIXES.map((s) => `${s} ${fmt(cal[`CAL_PREV_${s}`])}m`).join(", ")}; best ${best ? `${best.key} from the ${best.from === "now" ? "current" : "previous"} frame, so nose up is ${signs[0] > 0 ? "+" : "−"}pitch and right wing down is ${signs[1] > 0 ? "+" : "−"}bank` : "none"}`, { cal, best })
}

// seat --------------------------------------------

const STEPS = [
  { name: "offset, 0.75 frames", mode: 1, lead: 0.75 },
  { name: "offset, 1 frame", mode: 1, lead: 1 },
  { name: "offset, 1.25 frames", mode: 1, lead: 1.25 },
  { name: "seat, 2 frames", mode: 3, lead: 2 },
]

if (signs && await ask("A passenger beside you", `Press Page Down, and keep rocking and pitching gently while you watch the seat beside you. A short beep starts each of ${STEPS.length} steps, ${STEP_MS / 1000}s each. PRESS PAGE DOWN WHENEVER THE PASSENGER SITS STILL IN THE SEAT.`)) {
  const sv = await sim.read(POS, { object: beside.id })
  const init = new InitPosition()
  Object.assign(init, { latitude: sv.get("PLANE LATITUDE"), longitude: sv.get("PLANE LONGITUDE"), altitude: sv.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(FIGURE, "", init)
  if (r.id === undefined) {
    note("figure", `${FIGURE}: not created: ${r.error}`)
  } else {
    figure = r.id
    for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
    setModule({ MODE: 0, LEAD: 0, OBJECT: r.id, FWD: PARKED_BESIDE.forward, RIGHT: PARKED_BESIDE.right, UP: PARKED_BESIDE.up + SEAT_DROP_M, SIGN_PITCH: signs[0], SIGN_BANK: signs[1] })
    const presses = []
    let step = null
    const unlisten = keys.listen((x) => { if (x.key === "START" && step) { presses.push(step); rec.log("press", `Page Down during ${step}`) } })
    await sleep(1000)
    for (const s of STEPS) {
      const before = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"])
      // Mode 3's UP is meters above the seat object itself.
      setModule({ LEAD: s.lead, MODE: s.mode, UP: s.mode === 3 ? SEAT_DROP_M : PARKED_BESIDE.up + SEAT_DROP_M })
      step = s.name
      beep(1000, 100)
      const att = await watchAttitude(STEP_MS)
      step = null
      const after = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"])
      const n = presses.filter((p) => p === s.name).length
      note("step", `${s.name}: ${n} press${n === 1 ? "" : "es"}; ${(speed * KT).toFixed(0)} kt, pitch ${att.pitch}, bank ${att.bank}; module wrote ${after.FRAMES - before.FRAMES} frames with ${after.ERRORS - before.ERRORS} errors${after.ERRORS - before.ERRORS ? ` (last ${after.LAST_ERROR})` : ""}`, { step: s.name, presses: n })
    }
    beep(500, 600)
    unlisten()
    console.log("  Tell Claude where the passenger sat in each step, how high, and whether it held still while you rocked.")
  }
}

await cleanUp()
const text = [
  "p15 · Pitch and bank in the WASM module's placement, with the signs measured against the seat object, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines.map((l) => `  ${l}`),
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
