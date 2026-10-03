/*
 * p09: how far ahead of the aircraft's reported pose an external client has to
 * write an object for it to sit still in a moving cockpit, on MSFS 2024.
 *
 * In p08 a wand written every frame beside the pilot of a Cessna 152 at about
 * 90 kt trailed toward the tail (experiments/areas/avatars/results/
 * p08-in-flight-2026-10-03-05-11-58.txt). Part of that was ours: p08 took the
 * seat's position from an in-flight reading, and in flight SimConnect reported
 * the seat objects and the avatar's object about 2.3m behind where they sit
 * parked, so the target itself sat 2.3m aft.
 *
 * This probe aims at the seat's parked position instead, measured parked or,
 * for the C152, taken from p03 (experiments/areas/avatars/results/
 * p03-cockpit-2026-10-02-21-42-04.txt), and sweeps the lead: the wand is
 * written where the aircraft will be that many milliseconds after its last
 * reported pose, moving on the velocity measured over the last 0.6s.
 *
 * About 45s in level flight at cruise, straight ahead, autopilot on if the
 * aircraft has one, the sim in front:
 *
 *   sweep   Press Page Down and watch the wand above the seat beside you.
 *           Each short beep, every 5s, sets a longer lead. Press Page Down
 *           whenever the wand sits still on the seat.
 *
 * Nothing touches the pilot's input. The wand goes with AIRemoveObject at the
 * end and on Ctrl+C, and the sim removes a client's AI objects when the client
 * disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot fork,
 * record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture read;
 * TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p09-lead.mjs
 *
 * Output: one line per step on the console, every frame's readings in
 * experiments/areas/avatars/results/p09-lead-<time>.ndjson, and the report in
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
const AIRCRAFT = [...POS, ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]

// Parked seat positions from p03, in meters from the aircraft's reference
// point; the pilot's seat is where the avatar's object sat.
const PARKED = {
  "Cessna C152 Aerial Advertising": { pilot: { forward: 0.10, right: -0.23, up: -0.14 }, beside: { forward: 0.10, right: 0.21, up: -0.13 } },
}

const STAND_IN = "Marshaller_Stick"
const HAND_UP_M = 0.4
const LEADS_MS = [0, 33, 67, 100, 133, 200, 300]
const STEP_MS = 5000
const KT = 1.94384

const rec = new Recorder("p09-lead", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p09-lead" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)

// ------------------------------------------------ every frame

let ac = null
const history = []
let velocity = { forward: 0, right: 0, up: 0 }
let fps = null
const wand = { id: null, target: null, leadS: 0, failed: false }
let step = null
const readings = new Map()

sim.watch(AIRCRAFT, {
  period: "frame",
  changed: false,
  label: "aircraft",
  onData: (v, t) => {
    const [lat, lon, alt, hdg, pitch, bank] = AIRCRAFT.map(([n]) => v.get(n))
    if (!Number.isFinite(lat)) return
    ac = { t, lat, lon, alt, hdg, pitch, bank }
    history.push(ac)
    while (history.length && history[0].t < t - 600) history.shift()
    const old = history[0]
    if (old !== ac && t > old.t) {
      const d = toBody(old, ac)
      const s = (t - old.t) / 1000
      velocity = { forward: d.forward / s, right: d.right / s, up: d.up / s }
      fps = (history.length - 1) / s
    }
    if (wand.id !== null && !wand.failed) {
      const b = wand.target
      const at = toWorld(ac, { forward: b.forward + velocity.forward * wand.leadS, right: b.right + velocity.right * wand.leadS, up: b.up + velocity.up * wand.leadS })
      sim.set(POS, [at.lat, at.lon, at.alt, ac.hdg], { object: wand.id, label: "wand pose", quiet: true })
    }
  },
})
rec.onRecord((x) => { if (x.kind === "exception" && x.sent === "wand pose") wand.failed = true })

// An object's position in the aircraft's frame, against the aircraft's pose
// from the same sim frame.
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
  if (!r) readings.set(step, r = { avatar: [], wand: [], speed: [], fps: [], attitude: [] })
  r[kind].push(b.forward)
  if (kind === "wand") {
    r.speed.push(Math.hypot(velocity.forward, velocity.right))
    if (fps) r.fps.push(fps)
    r.attitude.push(Math.max(Math.abs(ac.pitch), Math.abs(ac.bank)))
  }
  rec.data(kind, step, { ...b, leadS: wand.leadS })
}

bodyWatch(USER_AVATAR, "avatar", (b) => keep("avatar", b))

// ------------------------------------------------ seats

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
await sleep(1000)
const parked = ac && Math.hypot(velocity.forward, velocity.right) < 0.5
let seats = null
if (parked) {
  // Parked, the seat objects' readings hold no motion, so they are measured
  // here; the pilot's seat is where the avatar's object sits.
  const avatar = []
  const besideSeen = []
  const a = bodyWatch(USER_AVATAR, "avatar, parked", (b) => avatar.push(b))
  for (const id of await sim.byType(1, 50, { timeoutMs: 2000 })) {
    const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
    if (!/^SEAT_/i.test(t) || /_pilot$/i.test(t)) continue
    const w = bodyWatch(id, `seat ${t}`, (b) => besideSeen.push(b))
    await sleep(1000)
    w.stop()
    break
  }
  a.stop()
  const mid = (list) => ({ forward: median(list.map((b) => b.forward)), right: median(list.map((b) => b.right)), up: median(list.map((b) => b.up)) })
  if (avatar.length) seats = { pilot: mid(avatar), beside: besideSeen.length ? mid(besideSeen) : { ...mid(avatar), right: -mid(avatar).right }, from: "measured parked" }
} else if (PARKED[title]) {
  seats = { ...PARKED[title], from: "p03's parked measurement" }
}
const where = (b) => `${b.forward.toFixed(2)}m forward, ${b.right.toFixed(2)}m right, ${b.up.toFixed(2)}m up`
rec.log("setup", `aircraft TITLE ${JSON.stringify(title)}, ${parked ? "parked" : "moving"}; ${seats ? `seats ${seats.from}: pilot ${where(seats.pilot)}, beside ${where(seats.beside)}` : "no parked seat positions for this aircraft: start the probe parked, and it measures them"}`)

// ------------------------------------------------ the sweep

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

const results = []
const presses = []

process.on("SIGINT", () => {
  rec.log("stop", "Ctrl+C: removing the wand")
  if (wand.id !== null) sim.remove(wand.id)
  setTimeout(() => process.exit(0), 300)
})

if (seats && parked) {
  console.log("\nSeats measured. Take off, settle in level flight at cruise, and press Page Down when ready.")
}

if (seats && await ask("The wand beside you", `In level flight at cruise, press Page Down and watch the wand above the seat beside you. Each short beep, every ${STEP_MS / 1000}s, sets a longer lead, ${LEADS_MS.length} in all. Press Page Down whenever the wand sits still on the seat. About ${Math.ceil((LEADS_MS.length * STEP_MS) / 1000) + 2}s.`)) {
  wand.target = { ...seats.beside, up: seats.beside.up + HAND_UP_M }
  const at = toWorld(ac, wand.target)
  const init = new InitPosition()
  Object.assign(init, { latitude: at.lat, longitude: at.lon, altitude: at.alt, pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
  const r = await sim.spawn(STAND_IN, "", init)
  if (r.id === undefined) {
    rec.log("wand", `${STAND_IN}: not created: ${r.error}`)
  } else {
    for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
    wand.id = r.id
    const w = bodyWatch(r.id, "wand", (b) => keep("wand", b))
    const unlisten = keys.listen((k) => { if (k.key === "START" && step) { presses.push({ step, t: k.t }); rec.log("press", `Page Down at ${step}`) } })
    await sleep(1500)
    for (const lead of LEADS_MS) {
      wand.leadS = lead / 1000
      step = `${lead}ms`
      beep(1000, 100)
      await sleep(STEP_MS)
      const r2 = readings.get(step) ?? { avatar: [], wand: [], speed: [], fps: [], attitude: [] }
      // The wand against the avatar's object, which the sim carries with the
      // aircraft: after taking out where each should be parked, 0 means the
      // wand reads where the sim's own objects read.
      const gap = r2.wand.length && r2.avatar.length ? median(r2.wand) - median(r2.avatar) - (wand.target.forward - seats.pilot.forward) : null
      const res = {
        lead, presses: presses.filter((p) => p.step === step).length,
        speedKt: median(r2.speed) * KT, fps: median(r2.fps), attitude: r2.attitude.length ? Math.max(...r2.attitude) : null,
        wandForward: median(r2.wand), avatarForward: median(r2.avatar), gap,
      }
      results.push(res)
      rec.log("step", `lead ${lead}ms: ${res.presses} press${res.presses === 1 ? "" : "es"}; ${res.speedKt?.toFixed(0)} kt, ${res.fps?.toFixed(0)} fps; wand reads ${res.wandForward?.toFixed(2)}m forward, the avatar's object ${res.avatarForward?.toFixed(2)}m, wand ahead of the sim's own objects by ${gap?.toFixed(2)}m`, res)
    }
    step = null
    unlisten()
    w.stop()
    sim.remove(r.id)
    wand.id = null
    beep(500, 600)
    console.log("  Tell Claude which steps looked steadiest, and whether any sat right on the seat.")
  }
}

const text = [
  "p09 · The lead an external client needs to keep an object still in a moving cockpit, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  `Aircraft: TITLE ${JSON.stringify(title)}; ${seats ? `seats ${seats.from}, the wand ${HAND_UP_M}m above the seat beside the pilot` : "no seat positions"}`,
  "",
  ...(results.length
    ? results.map((r) => `  lead ${String(r.lead).padStart(3)}ms: ${r.presses} press${r.presses === 1 ? "" : "es"}; ${r.speedKt?.toFixed(0)} kt, ${r.fps?.toFixed(0)} fps, attitude up to ${r.attitude?.toFixed(1)}°; wand reads ${r.wandForward?.toFixed(2)}m forward, avatar's object ${r.avatarForward?.toFixed(2)}m, wand ahead of the sim's objects by ${r.gap?.toFixed(2)}m`)
    : ["  not run"]),
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
if (wand.id !== null) sim.remove(wand.id)
sim.close()
await rec.close()
process.exit(0)
