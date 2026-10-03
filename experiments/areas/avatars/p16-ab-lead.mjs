/*
 * p16: an A/B of two leads for the WASM-written seated figure, for as long as
 * the pilot likes, on MSFS 2024.
 *
 * In p15, with the offset turned by full attitude (both signs negative,
 * measured against the seat object), GSX's seated passenger held the C152's
 * passenger seat best at a lead of 0.75 frames and nearly as well at 1 frame
 * (record/areas/avatars/log.md, 2026-10-03). Each step lasted 8s. This keeps
 * the passenger in the seat and lets the pilot switch between the two leads
 * at will, through any flying they like.
 *
 *   Page Down   switch between A, 0.75 frames (a high beep), and B, 1 frame
 *               (a low beep)
 *   Page Up     end
 *
 * Every switch is logged with the speed, pitch, and bank at that moment, and
 * the report gives how long each lead was on. It ends by itself after 30
 * minutes.
 *
 * In the C152, in flight, with crosscheck-p12-follow 0.4.0 or later installed:
 *
 *   node experiments/areas/avatars/p16-ab-lead.mjs
 *
 * Nothing touches the pilot's input. The tool turns the module off and
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
// p03's parked offset of the C152's passenger seat, and p15's seat drop.
const PARKED_BESIDE = { forward: 0.10, right: 0.21, up: -0.13 }
const SEAT_DROP_M = -0.7
// p15: nose up and right wing down are both negative.
const SIGNS = [-1, -1]
const LEADS = [{ name: "A", lead: 0.75, beep: [1200, 120] }, { name: "B", lead: 1, beep: [600, 120] }]
const CAP_MS = 30 * 60_000
const KT = 1.94384
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]

const rec = new Recorder("p16-ab-lead", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p16-ab-lead" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

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
const state = () => (ac ? `${(speed * KT).toFixed(0)} kt, pitch ${ac.pitch.toFixed(1)}°, bank ${ac.bank.toFixed(1)}°` : "no aircraft")

await sleep(1000)
const a0 = await readModule(["ALIVE"])
await sleep(500)
const a1 = await readModule(["ALIVE"])
const alive = a0.ALIVE !== null && a1.ALIVE > a0.ALIVE
rec.log("module", alive ? "crosscheck-p12-follow is running" : "crosscheck-p12-follow isn't running: rebuild it with the sim closed, then restart the sim")

let beside = null
for (const id of ac ? await sim.byType(1, 50, { timeoutMs: 2000 }) : []) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (/^SEAT_/i.test(t) && !/_pilot$/i.test(t)) { beside = { id, title: t }; break }
}
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
rec.log("setup", `aircraft TITLE ${JSON.stringify(title)}; ${beside ? `beside the pilot: ${beside.title}` : "no passenger seat object: fly the C152"}`)

let figure = null
const time = { A: 0, B: 0 }
const switches = []
let current = null
let since = Date.now()

function select(i) {
  if (current) time[current.name] += Date.now() - since
  current = LEADS[i]
  since = Date.now()
  setModule({ LEAD: current.lead })
  beep(...current.beep)
  switches.push({ t: Date.now(), name: current.name })
  rec.log("lead", `${current.name}: ${current.lead} frames; ${state()}`, { name: current.name, lead: current.lead })
}

let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  if (current) time[current.name] += Date.now() - since
  setModule({ MODE: 0, OBJECT: 0, LEAD: 0 })
  if (figure !== null) sim.remove(figure)
  figure = null
  await sleep(800)
  const text = [
    "p16 · A/B of a 0.75-frame and a 1-frame lead for the WASM-written seated figure, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Aircraft: TITLE ${JSON.stringify(title)}; ended by ${why}`,
    "",
    `  A, 0.75 frames: ${(time.A / 1000).toFixed(0)}s on; B, 1 frame: ${(time.B / 1000).toFixed(0)}s on; ${switches.length} switches`,
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}
process.on("SIGINT", () => finish("Ctrl+C"))

if (alive && beside && ac) {
  const sv = await sim.read(POS, { object: beside.id })
  const init = new InitPosition()
  Object.assign(init, { latitude: sv.get("PLANE LATITUDE"), longitude: sv.get("PLANE LONGITUDE"), altitude: sv.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(FIGURE, "", init)
  if (r.id === undefined) {
    rec.log("figure", `${FIGURE}: not created: ${r.error}`)
    await finish("a failed spawn")
  }
  figure = r.id
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  setModule({ MODE: 0, OBJECT: r.id, FWD: PARKED_BESIDE.forward, RIGHT: PARKED_BESIDE.right, UP: PARKED_BESIDE.up + SEAT_DROP_M, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1] })
  select(0)
  setModule({ MODE: 1 })
  console.log(`\n▶ The passenger is in the seat on A, 0.75 frames.\n  ${START} switches between A (high beep) and B (1 frame, low beep). ${SKIP} ends. It ends by itself after 30 minutes.`)
  let i = 0
  const cap = setTimeout(() => finish("the 30-minute cap"), CAP_MS)
  for (;;) {
    const k = await keys.next()
    if (k.key === "SKIP") break
    i = 1 - i
    select(i)
  }
  clearTimeout(cap)
  await finish("Page Up")
} else {
  await finish("a missing module, seat, or aircraft")
}
