/*
 * p05: whether a seated GSX passenger sits and moves in the seat beside the
 * pilot with nothing driving it, on MSFS 2024.
 *
 * In p03 a standing GSX passenger placed on SEAT_C152_Pax showed in the
 * cockpit, standing and clipping through the aircraft
 * (experiments/areas/avatars/results/p03-cockpit-2026-10-02-21-42-04.txt).
 * GSX ships seated people as their own objects, such as
 * FSDT_Passenger_CASUAL_M_0030_SEATED, whose model loops its seated clip with
 * typeParam="AutoPlay,Random" and no variable (read in fsdreamteam-gsx-pro
 * 4.0.19, SimObjects/GroundVehicles/FSDT_Passengers_Seated/sim.cfg and the
 * title's model XML). Whether it plays when we spawn it is unmeasured.
 *
 * About 20s, seated in the cockpit:
 *
 *   seated   Press Page Down, and the seated passenger appears on the other
 *            seat for 12s. Look at it, and press Page Down if it sits.
 *            Then tell Claude whether it moved on its own and where it sat
 *            against the seat.
 *
 * Nothing touches the pilot's input. The passenger goes with AIRemoveObject at
 * the end of its step and on Ctrl+C, and the sim removes a client's AI objects
 * when the client disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot
 * fork, record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture
 * read; TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p05-seated.mjs
 *
 * Output: one line per step on the console, the records in
 * experiments/areas/avatars/results/p05-seated-<time>.ndjson, and the report in
 * the .txt beside it.
 */

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { offset, toBody, wrap } from "./lib/pose.mjs"

const USER = 0
// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX + 1, which p01
// measured following the avatar.
const USER_AVATAR = 0xffffffff - 128 + 1

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SEATED = "FSDT_Passenger_CASUAL_M_0030_SEATED"
const SHOW_MS = 12_000

const rec = new Recorder("p05-seated", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p05-seated" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const readPose = async (object) => {
  const v = await sim.read(POS, { object, timeoutMs: 1500 })
  const [lat, lon, alt, hdg] = POS.map(([n]) => v.get(n))
  return Number.isFinite(lat) ? { lat, lon, alt, hdg, error: null } : { error: v.error ?? "no position" }
}
const bodyText = (b) => `${b.forward.toFixed(2)}m forward, ${b.right.toFixed(2)}m right, ${b.up.toFixed(2)}m up`

const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

const aircraft = await readPose(USER)
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("setup", `aircraft TITLE ${JSON.stringify(title)}${aircraft.error ? `: ${aircraft.error}` : ""}`, { title, aircraft })

// The seat that isn't the pilot's, as in p03, or with none listed, the avatar's
// spot mirrored across the aircraft's centerline.
const seats = []
for (const id of aircraft.error ? [] : await sim.byType(1, 50, { timeoutMs: 2000 })) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (!/^SEAT_/i.test(t)) continue
  const p = await readPose(id)
  if (!p.error) seats.push({ title: t, pose: p })
}
const other = seats.find((s) => !/_pilot$/i.test(s.title)) ?? null
let spot = other ? { pose: other.pose, from: `seat ${other.title}` } : null
if (!spot && !aircraft.error) {
  const avatar = await readPose(USER_AVATAR)
  if (!avatar.error) {
    const b = toBody(aircraft, avatar)
    spot = { pose: { ...offset(aircraft, b.forward, -b.right), alt: avatar.alt, hdg: aircraft.hdg }, from: "the avatar's spot mirrored across the centerline" }
  }
}
note("setup", spot ? `placing at ${spot.from}: ${bodyText(toBody(aircraft, spot.pose))}` : "no seat and no avatar position to place the passenger by")

let id = null
let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: removing the passenger and writing the report")
  if (id !== null) sim.remove(id)
  await finish()
  process.exit(0)
})

console.log("\nBefore you start: seated in the cockpit, with the aircraft parked. About 20s.")

if (spot) {
  console.log(`\n▶ A seated passenger beside you\n  Press Page Down, and ${SEATED} appears at ${spot.from} for ${SHOW_MS / 1000}s. Press Page Down if it sits.\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  if (k.key === "START") {
    const presses = []
    const unlisten = keys.listen((x) => {
      if (x.key !== "START") return
      presses.push(x.t)
      rec.log("press", "Page Down: it sits")
    })
    const init = new InitPosition()
    Object.assign(init, { latitude: spot.pose.lat, longitude: spot.pose.lon, altitude: spot.pose.alt, pitch: 0, bank: 0, heading: wrap(aircraft.hdg), onGround: false, airspeed: 0 })
    beep(1000, 100)
    const t0 = Date.now()
    const r = await sim.spawn(SEATED, "", init)
    if (r.id === undefined) {
      note("seated", `${SEATED}: not created: ${r.error}`)
    } else {
      id = r.id
      // Frozen, then put back at the seat, as in p03. A static object may refuse
      // AIReleaseControl, which p01 saw on Marshaller_Stick.
      sim.release(id)
      for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: id, quiet: true })
      sim.set(POS, [spot.pose.lat, spot.pose.lon, spot.pose.alt, aircraft.hdg], { object: id, label: "passenger pose" })
      await sleep(500)
      const p = await readPose(id)
      const cat = (await sim.readStrings(["CATEGORY"], { object: id })).get("CATEGORY") ?? null
      await sleep(Math.max(0, t0 + SHOW_MS - Date.now()))
      sim.remove(id)
      id = null
      note("seated", `${SEATED}: object ${r.id}, ${cat ?? "no category"}, read back at ${p.error ? p.error : bodyText(toBody(aircraft, p))}; ${presses.length ? "SITS" : "not seen sitting"}`, { category: cat, readBack: p, presses: presses.length })
    }
    unlisten()
    beep(500, 600)
    console.log("  Tell Claude whether it moved on its own, and where it sat against the seat: too high, too low, too far forward or back.")
  }
}

await finish()
process.exit(0)

async function finish() {
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  const text = [
    "p05 · A seated GSX passenger beside the pilot, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    "",
    ...lines.map((l) => `  ${l}`),
    "",
    `Exceptions: ${counted.size ? "" : "none"}`,
    ...[...counted].map(([e, n]) => `  ${n} × ${e}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
