/*
 * p03: what Crosscheck can read and show of the other pilot in the cockpit,
 * on MSFS 2024.
 *
 * Seated, the avatar's object sits 0.3m from the aircraft's reference point at
 * the aircraft's heading, and A:CAMERA GAMEPLAY PITCH YAW read 0 throughout
 * with ChasePlane running (record/areas/avatars/log.md, 2026-10-02). This
 * probe asks three things:
 *
 *   - Does the seated avatar's object turn or move when the pilot looks around?
 *     If it does, it gives their head direction whatever camera add-on runs.
 *   - Does anything give the camera's direction: the sim's camera variables,
 *     with ChasePlane running and then closed, or ChasePlane's own L: variables?
 *     L:p42_cp_rendered_camera_sequence and its kin are in a flight file the
 *     sim saved with ChasePlane running
 *     (experiments/areas/aircraft/flights/f0-fenix-a321-gvac.flt).
 *   - Does a person spawned in the seat beside the pilot show in the cockpit?
 *     The C152 has seat objects, SEAT_C152_Pilot and SEAT_C152_Pax (p01's run),
 *     so the probe looks for objects titled SEAT_ near the aircraft and uses
 *     them as positions.
 *
 * About 1.5 minutes, seated in the cockpit:
 *
 *   look     Press Page Down, then look left, right, up, and down until the
 *            long low beep, 8s.
 *   beside   Press Page Down, and a GSX passenger appears in the seat beside
 *            you for 8s. Look at it, and press Page Down if you see it.
 *   no CP    Optional: close ChasePlane (its bridge, CP MSFS Bridge.exe),
 *            press Page Down, and look around again for 8s. Page Up skips it.
 *
 * Nothing touches the pilot's input. The passenger goes with AIRemoveObject at
 * the end of its step and on Ctrl+C, and the sim removes a client's AI objects
 * when the client disconnects (measured on MSFS 2024, 2026-09-06, FS Copilot
 * fork, record/traffic-atc/docs/build/log.md, "2026-09-06 · Stage 0 capture
 * read; TrafficInject built and smoke-tested — Q01, Q08 settled").
 *
 *   node experiments/areas/avatars/p03-cockpit.mjs
 *
 * Output: one line per step on the console, every change in
 * experiments/areas/avatars/results/p03-cockpit-<time>.ndjson, and the report
 * in the .txt beside it.
 */

import { execFileSync } from "node:child_process"

import { InitPosition } from "node-simconnect"

import { SKIP, START, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { offset, toBody, turn, wrap } from "./lib/pose.mjs"

// MSFS 2024 SDK, SimConnect.h: SIMCONNECT_OBJECT_ID_MAX + 1, which p01
// measured following the avatar.
const USER_AVATAR = 0xffffffff - 128 + 1
const USER = 0

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const AVATAR = [...POS, ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]

// Read on object 0. The sim's camera variables are in the MSFS 2024 SDK's
// Camera Variables page; the L: variables are ChasePlane's, from the flight
// file named above.
const CAMERA = [
  ["CAMERA STATE", "number"], ["CAMERA SUBSTATE", "number"],
  ["CAMERA GAMEPLAY PITCH YAW:0", "radians"], ["CAMERA GAMEPLAY PITCH YAW:1", "radians"],
  ["CAMERA VIEW TYPE AND INDEX:0", "number"], ["CAMERA VIEW TYPE AND INDEX:1", "number"],
  ["L:p42_cp_rendered_camera_valid", "number"], ["L:p42_cp_rendered_camera_sequence", "number"],
  ["L:p42_cp_camera_api_heartbeat", "number"], ["L:p42_cp_is_avatar", "number"],
]

// Seen in front of the pilot in p02's run (record/areas/avatars/log.md).
const PASSENGER = "FSDT_Passenger_CASUAL_M_0030"
const LOOK_MS = 8000
const BESIDE_MS = 8000

function chasePlaneRunning() {
  try {
    return execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" }).split(/\r?\n/).some((l) => /^"CP MSFS Bridge/i.test(l))
  } catch {
    return null
  }
}

const rec = new Recorder("p03-cockpit", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p03-cockpit" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()

const report = { setup: [], windows: [], beside: null }
const spawned = new Set()

// ------------------------------------------------ where things are

const readPose = async (object, vars = POS) => {
  const v = await sim.read(vars, { object, timeoutMs: 1500 })
  const [lat, lon, alt, hdg] = POS.map(([n]) => v.get(n))
  return Number.isFinite(lat) ? { lat, lon, alt, hdg, error: null } : { error: v.error ?? "no position" }
}
const bodyText = (b) => `${b.forward.toFixed(2)}m forward, ${b.right.toFixed(2)}m right, ${b.up.toFixed(2)}m up`

const aircraft = await readPose(USER)
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const isAircraft = await sim.readOne("IS AIRCRAFT", "bool")
const setup = (text, fields = {}) => { report.setup.push(text); rec.log("setup", text, fields) }
setup(`aircraft TITLE ${JSON.stringify(title)}, ${aircraft.error ? aircraft.error : `heading ${Math.round(aircraft.hdg)}°`}; IS AIRCRAFT ${fmt(isAircraft)}${isAircraft === 1 ? "" : ": sit down in the cockpit before you start"}`, { title, aircraft, isAircraft })
setup(`ChasePlane's bridge is ${chasePlaneRunning() ? "running" : "not running"}`)

const avatar = await readPose(USER_AVATAR)
const avatarBody = !avatar.error && !aircraft.error ? toBody(aircraft, avatar) : null
setup(avatar.error ? `avatar: ${avatar.error}` : `avatar's object: ${bodyText(avatarBody)} of the aircraft's reference point, heading ${Math.round(avatar.hdg)}°`, { avatar, avatarBody })

// Seat objects near the aircraft.
const seats = []
for (const id of aircraft.error ? [] : await sim.byType(1, 50, { timeoutMs: 2000 })) {
  const t = (await sim.readStrings(["TITLE"], { object: id })).get("TITLE") ?? ""
  if (!/^SEAT_/i.test(t)) continue
  const p = await readPose(id)
  if (p.error) continue
  const b = toBody(aircraft, p)
  seats.push({ id, title: t, pose: p, body: b, fromAvatar: avatarBody ? Math.hypot(b.forward - avatarBody.forward, b.right - avatarBody.right, b.up - avatarBody.up) : null })
  setup(`seat ${t}: ${bodyText(b)}, heading ${Math.round(p.hdg)}°${avatarBody ? `, ${seats[seats.length - 1].fromAvatar.toFixed(2)}m from the avatar's object` : ""}`, { id, title: t, body: b })
}
if (!seats.length) setup("no object titled SEAT_ within 50m")

// ------------------------------------------------ watching

let win = null

function track(map, name, v) {
  let s = map.get(name)
  if (!s) map.set(name, s = { n: 0, min: v, max: v, first: v, last: v, turned: 0 })
  if (name.startsWith("PLANE HEADING") && s.n) s.turned += Math.abs(turn(s.last, v))
  s.n++
  s.last = v
  s.min = Math.min(s.min, v)
  s.max = Math.max(s.max, v)
}

sim.watch(AVATAR, {
  period: "frame",
  label: "avatar",
  object: USER_AVATAR,
  onChange: (name, v) => {
    if (!win) return
    rec.data("avatar", `${name} ${fmt(v)}`, { name, value: v })
    track(win.avatar, name, v)
  },
})
sim.watch(CAMERA, {
  period: "frame",
  label: "camera",
  onChange: (name, v) => {
    if (!win) return
    rec.data("camera", `${name} ${fmt(v)}`, { name, value: v })
    track(win.camera, name, v)
  },
})

const rangeText = (s, unit = "") => (s.min === s.max ? `${fmt(s.min)}${unit}` : `${fmt(s.min)}..${fmt(s.max)}${unit}`)

function windowText(w) {
  const moved = (map) => [...map].filter(([, s]) => s.n > 1)
  const avatarMoved = moved(w.avatar)
  const cameraMoved = moved(w.camera)
  const deg = (name, s) => (name.startsWith("CAMERA GAMEPLAY") ? `${(s.min * 180 / Math.PI).toFixed(1)}°..${(s.max * 180 / Math.PI).toFixed(1)}°` : rangeText(s))
  return [
    `${w.name} (ChasePlane ${w.chasePlane === null ? "unknown" : w.chasePlane ? "running" : "closed"})`,
    `    avatar's object: ${avatarMoved.length ? avatarMoved.map(([n, s]) => `${n} ${n.startsWith("PLANE HEADING") ? `turned ${Math.round(s.turned)}° (${rangeText(s, "°")})` : rangeText(s)}, ${plural(s.n, "change")}`).join("; ") : "no change"}`,
    `    camera: ${cameraMoved.length ? cameraMoved.map(([n, s]) => `${n} ${deg(n, s)}, ${plural(s.n, "change")}`).join("; ") : "no change"}`,
    `    unchanged: ${[...w.camera].filter(([, s]) => s.n === 1).map(([n, s]) => `${n} ${fmt(s.last)}`).join(", ") || "—"}`,
  ].join("\n")
}

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
  return k.key === "START"
}

// Each window starts with every value read once, so a value that never
// changes still shows in the report with what it held.
async function look(name) {
  win = { name, chasePlane: chasePlaneRunning(), avatar: new Map(), camera: new Map() }
  const a = await sim.read(AVATAR, { object: USER_AVATAR, timeoutMs: 1500 })
  for (const [n, v] of a) track(win.avatar, n, v)
  const c = await sim.read(CAMERA, { timeoutMs: 1500 })
  for (const [n, v] of c) track(win.camera, n, v)
  beep(1000, 100)
  await sleep(LOOK_MS)
  beep(500, 600)
  const w = win
  win = null
  report.windows.push(w)
  const text = windowText(w)
  rec.log("look", text.replace(/\n\s+/g, " · "), { window: name })
  return w
}

function removeAll() {
  for (const id of spawned) sim.remove(id)
  spawned.clear()
}

let stopping = false
process.on("SIGINT", async () => {
  if (stopping) process.exit(1)
  stopping = true
  rec.log("stop", "Ctrl+C: removing the passenger and writing the report")
  removeAll()
  await finish()
  process.exit(0)
})

console.log([
  "",
  "Before you start:",
  "  - seated in the cockpit, with the aircraft parked",
  "  - about 1.5 minutes",
].join("\n"))

// look --------------------------------------------

if (await ask("Look around", `Press Page Down, then look left, right, up, and down until the long low beep, ${LOOK_MS / 1000}s.`)) await look("looking around")

// beside ------------------------------------------

// The seat that isn't the pilot's, or with none listed, the avatar's spot
// mirrored across the aircraft's centerline.
const other = seats.find((s) => !/_pilot$/i.test(s.title)) ?? null
const spot = other
  ? { pose: other.pose, from: `seat ${other.title}` }
  : avatarBody && !aircraft.error
    ? { pose: { ...offset(aircraft, avatarBody.forward, -avatarBody.right), alt: avatar.alt, hdg: aircraft.hdg }, from: "the avatar's spot mirrored across the centerline" }
    : null

if (!spot) {
  rec.log("beside", "skipped: no seat and no avatar position to place the passenger by")
} else if (await ask("A person beside you", `Press Page Down, and ${PASSENGER} appears at ${spot.from} for ${BESIDE_MS / 1000}s. Look at it, and press Page Down if you see it.`)) {
  const presses = []
  const unlisten = keys.listen((k) => {
    if (k.key !== "START") return
    presses.push(k.t)
    rec.log("press", "Page Down: the passenger seen")
  })
  const init = new InitPosition()
  Object.assign(init, { latitude: spot.pose.lat, longitude: spot.pose.lon, altitude: spot.pose.alt, pitch: 0, bank: 0, heading: wrap(aircraft.hdg), onGround: false, airspeed: 0 })
  beep(1000, 100)
  const t0 = Date.now()
  const r = await sim.spawn(PASSENGER, "", init)
  const out = { from: spot.from, id: r.id ?? null, error: r.error ?? null, seen: false, readBack: null }
  if (out.id !== null) {
    spawned.add(out.id)
    // Released and frozen, then put back at the seat, since a created object
    // may settle before the freeze lands (FS Copilot fork,
    // record/traffic-atc/docs/01-design.md, Driving).
    sim.release(out.id)
    for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: out.id, quiet: true })
    sim.set(POS, [spot.pose.lat, spot.pose.lon, spot.pose.alt, aircraft.hdg], { object: out.id, label: "passenger pose" })
    await sleep(500)
    const p = await readPose(out.id)
    out.readBack = p.error ? { error: p.error } : { body: toBody(aircraft, p), offBy: toBody(spot.pose, p) }
  }
  await sleep(Math.max(0, t0 + BESIDE_MS - Date.now()))
  out.seen = presses.length > 0
  unlisten()
  removeAll()
  beep(500, 600)
  report.beside = out
  rec.log("beside", out.id === null
    ? `${PASSENGER}: not created: ${out.error}`
    : `${PASSENGER} at ${spot.from}: object ${out.id}${out.readBack?.body ? `, read back at ${bodyText(out.readBack.body)}` : `, ${out.readBack?.error}`}; ${out.seen ? "SEEN" : "not seen"}`, out)
}

// no ChasePlane -----------------------------------

if (await ask("Look around without ChasePlane (optional)", `Close ChasePlane's bridge (CP MSFS Bridge.exe), then press Page Down and look left, right, up, and down until the long low beep, ${LOOK_MS / 1000}s. ${SKIP} skips this.`)) {
  await look("looking around, ChasePlane closed")
}

await finish()
process.exit(0)

// ---------------------------------------------------------------- report

async function finish() {
  removeAll()
  const b = report.beside
  const lines = [
    "p03 · The other pilot in the cockpit: the seated avatar, the camera, and a person beside you, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    "",
    "Setup:",
    ...report.setup.map((s) => `  ${s}`),
    "",
    "Looking around:",
    ...(report.windows.length ? report.windows.map((w) => `  ${windowText(w)}`) : ["  not run"]),
    "",
    `Person beside you: ${b ? (b.id === null ? `not created: ${b.error}` : `${PASSENGER} at ${b.from}${b.readBack?.body ? `, read back at ${bodyText(b.readBack.body)}` : ""}; ${b.seen ? "SEEN" : "not seen"}`) : "not run"}`,
  ]
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  lines.push("", `Exceptions: ${counted.size ? "" : "none"}`)
  for (const [e, n] of counted) lines.push(`  ${n} × ${e}`)
  const text = lines.join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
}
