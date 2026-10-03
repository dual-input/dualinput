/*
 * p18: whether the hand sphere lands on a cockpit control while the pilot
 * operates it, placed from the aircraft's own model files, on MSFS 2024.
 *
 * Crosscheck already knows which control changed: the input event it syncs.
 * tools/controls.mjs maps each input event of the A2A Comanche to the model
 * node its behavior component names, and that node's position in the model's
 * own space (experiments/sim-sources/avatars/controls-pa24-250.json, from
 * a2a-aircraft-pa24 2.1.3). In that space the seat nodes PILOT_1 and PILOT_2
 * sit at x +0.305m and -0.303m, so +x is left, y up, and z forward.
 *
 * The probe ties the model's space to SimConnect's: parked, it reads where the
 * seat objects SEAT_DEFAULT_Pilot and SEAT_DEFAULT_Copilot are from the
 * aircraft's reference point, which the Comanche's navigation graph puts on
 * PILOT_1 and PILOT_2 (navigation_graph_pilot.cfg). The two seats give the
 * offset and check the axes. Then, every time an input event from the map
 * changes, the module (crosscheck-p12-follow 0.5.0) puts the green sphere on
 * that control for 2.5s, turned by the aircraft's full attitude and led one
 * frame (p15, p16), and returns it, red, to a rest spot in front of the
 * pilot's seat.
 *
 * In the A2A Comanche, parked at first, the sim in front:
 *
 *   calibrate   Runs on its own, parked: about 2s.
 *   controls    Flip switches, turn knobs, and pull levers, parked and then in
 *               flight if you like, and watch whether the sphere lands on each.
 *               Page Up ends; it ends by itself after 20 minutes.
 *
 *   node experiments/areas/avatars/p18-hand-controls.mjs
 *
 * Nothing touches the pilot's input: input events are watched, not set. The
 * probe turns the module off and removes the sphere at the end and on Ctrl+C.
 */

import fs from "node:fs"
import path from "node:path"

import { InitPosition } from "node-simconnect"

import { REPO } from "../../tools/results.mjs"
import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { toBody, wrap } from "./lib/pose.mjs"

const MAP = path.join(REPO, "experiments", "sim-sources", "avatars", "controls-pa24-250.json")
const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const HOLD_MS = 2500
const CAP_MS = 20 * 60_000
const COLOR = { rest: 0, touching: 1 }
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]

const rec = new Recorder("p18-hand-controls", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p18-hand-controls" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const where = (b) => `${b.forward.toFixed(3)}m forward, ${b.right.toFixed(3)}m right, ${b.up.toFixed(3)}m up`
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet: true }) }

let sphere = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  setModule({ MODE: 0, OBJECT: 0, LEAD: 0 })
  if (sphere !== null) sim.remove(sphere)
  await sleep(800)
  const text = [
    "p18 · The hand sphere on the control the pilot operates, placed from the model files, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Ended by ${why}`,
    "",
    ...lines.map((l) => `  ${l}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}
process.on("SIGINT", () => finish("Ctrl+C"))

// ------------------------------------------------ setup

if (!fs.existsSync(MAP)) {
  console.error(`No control map at ${MAP}: run tools/controls.mjs first (see its header).`)
  process.exit(1)
}
const map = JSON.parse(fs.readFileSync(MAP, "utf8"))
await sleep(1000)
const m0 = await readModule(["ALIVE"])
await sleep(500)
const m1 = await readModule(["ALIVE"])
if (!(m0.ALIVE !== null && m1.ALIVE > m0.ALIVE)) { note("module", "crosscheck-p12-follow isn't running"); await finish("no module") }
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const speed = await sim.readOne("GROUND VELOCITY", "knots")
note("setup", `aircraft TITLE ${JSON.stringify(title)}, ${fmt(speed)} kt; map ${map.controls.length} controls from ${map.folder}`)

// ------------------------------------------------ calibrate

// Parked, the seat objects' readings hold no motion (p08, p09).
const ac = await sim.read(POS)
const aircraft = Object.fromEntries([["lat", "PLANE LATITUDE"], ["lon", "PLANE LONGITUDE"], ["alt", "PLANE ALTITUDE"], ["hdg", "PLANE HEADING DEGREES TRUE"]].map(([k, n]) => [k, ac.get(n)]))
const seatBody = {}
for (const id of await sim.byType(1, 50, { timeoutMs: 2000 })) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  const key = /^SEAT_.*_Pilot$/i.test(t) ? "PILOT_1" : /^SEAT_.*_Copilot$/i.test(t) ? "PILOT_2" : null
  if (!key) continue
  const reads = []
  for (let i = 0; i < 10; i++) {
    const v = await sim.read(POS, { object: id })
    reads.push(toBody(aircraft, { lat: v.get("PLANE LATITUDE"), lon: v.get("PLANE LONGITUDE"), alt: v.get("PLANE ALTITUDE") }))
    await sleep(50)
  }
  seatBody[key] = { title: t, forward: median(reads.map((r) => r.forward)), right: median(reads.map((r) => r.right)), up: median(reads.map((r) => r.up)) }
}

// Model space to the aircraft's frame: forward = z, right = -x, up = y, plus
// an offset from the seats.
const toFrame = (p) => ({ forward: p[2], right: -p[0], up: p[1] })
const pairs = Object.keys(seatBody).filter((k) => map.seats[k])
if (!pairs.length || speed > 1) {
  note("calibrate", `${speed > 1 ? "moving" : "no seat objects found"}: start the probe parked in the Comanche`)
  await finish("no calibration")
}
const diffs = pairs.map((k) => { const f = toFrame(map.seats[k].origin); return { forward: seatBody[k].forward - f.forward, right: seatBody[k].right - f.right, up: seatBody[k].up - f.up } })
const offset = { forward: diffs.reduce((s, d) => s + d.forward, 0) / diffs.length, right: diffs.reduce((s, d) => s + d.right, 0) / diffs.length, up: diffs.reduce((s, d) => s + d.up, 0) / diffs.length }
const spread = diffs.length > 1 ? Math.hypot(diffs[0].forward - diffs[1].forward, diffs[0].right - diffs[1].right, diffs[0].up - diffs[1].up) : null
note("calibrate", `${pairs.map((k) => `${seatBody[k].title} at ${where(seatBody[k])}, model ${k} ${map.seats[k].origin.join(", ")}`).join("; ")}; offset ${where(offset)}${spread !== null ? `; the two seats disagree by ${spread.toFixed(3)}m` : ""}`, { seatBody, offset, spread })
const place = (c) => { const f = toFrame(c.center ?? c.origin); return { forward: f.forward + offset.forward, right: f.right + offset.right, up: f.up + offset.up } }
// At rest: 0.35m in front of the pilot's seat and 0.25m up.
const pilot = seatBody.PILOT_1 ?? seatBody.PILOT_2
const rest = { forward: pilot.forward + 0.35, right: pilot.right, up: pilot.up + 0.25 }

// ------------------------------------------------ the sphere

const v0 = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: v0.get("PLANE LATITUDE"), longitude: v0.get("PLANE LONGITUDE"), altitude: v0.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(v0.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
const r = await sim.spawn(SPHERE, "", init)
if (r.id === undefined) { note("sphere", `${SPHERE}: not created: ${r.error}`); await finish("a failed spawn") }
sphere = r.id
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
setModule({ OBJECT: r.id, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD, SCALE: 30, COLOR: COLOR.rest, FWD: rest.forward, RIGHT: rest.right, UP: rest.up, MODE: 1 })

// ------------------------------------------------ the controls

const byName = new Map(map.controls.filter((c) => c.inputEvent).map((c) => [c.inputEvent.toLowerCase(), c]))
const list = await sim.inputEvents()
const watched = list.filter((d) => byName.has(d.name.toLowerCase()))
note("controls", `${list.length} input events in the sim, ${watched.length} of them in the map`, { watched: watched.map((d) => d.name) })
const nameOf = new Map(watched.map((d) => [String(d.hash), d.name]))
let holdUntil = 0
let touches = 0
const seen = new Map()
sim.subscribeInputEvents(watched.map((d) => d.hash), ({ hash, value }) => {
  const name = nameOf.get(String(hash))
  const c = byName.get(name?.toLowerCase())
  if (!c) return
  const b = place(c)
  setModule({ FWD: b.forward, RIGHT: b.right, UP: b.up, COLOR: COLOR.touching })
  holdUntil = Date.now() + HOLD_MS
  touches++
  seen.set(name, (seen.get(name) ?? 0) + 1)
  rec.log("touch", `${name} = ${fmt(value)}: ${c.node}, ${where(b)}`, { name, value, node: c.node, body: b })
})
const tick = setInterval(() => {
  if (holdUntil && Date.now() > holdUntil) {
    holdUntil = 0
    setModule({ FWD: rest.forward, RIGHT: rest.right, UP: rest.up, COLOR: COLOR.rest })
  }
}, 50)

console.log(`\n▶ Operate the Comanche's controls\n  The red sphere rests in front of your seat; when you operate a control, it turns green on that control for ${HOLD_MS / 1000}s. ${SKIP} ends.`)
beep(1000, 100)
const cap = setTimeout(() => finish("the 20-minute cap"), CAP_MS)
for (;;) { const k = await keys.next(); if (k.key === "SKIP") break }
clearInterval(tick)
clearTimeout(cap)
note("touches", `${touches} input event changes from ${seen.size} controls: ${[...seen].map(([n, c]) => `${n} ×${c}`).join(", ")}`)
await finish("Page Up")
