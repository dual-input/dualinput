/*
 * p03: what the real sim shows of AI traffic through traffic and ATC audio's session in the sim. Every 10s it lists
 * each AI aircraft and helicopter within 3km and each ground object within 1km, with what traffic reads and writes on
 * them: the five light switches beside the five `LIGHT … ON` variables, the four flap surfaces beside the flaps'
 * handle, the three freezes, the velocities, and `IS USER SIM`. Over each 10s it scores up to 30 aircraft moving
 * within 3km on FS Copilot's jitter measure, read on each sim frame: the mean frame-to-frame change in displacement
 * over the mean displacement, where 0 is constant motion and about 1 is standing still, then a snap (FS Copilot
 * fork, record/traffic-atc/docs/build/log.md, "Jitter measured, not eyeballed"). And it counts the sim's frames.
 *
 *   node experiments/areas/traffic-atc/p03-sim-session/reads.mjs --labels <labels file>
 *
 * A line appended to the labels file names what the following windows measure, as p29's update times do, and a
 * line `pushback` sends K:TOGGLE_PUSHBACK to the pilot's aircraft as well. It ends with Ctrl+C, or at the sim's end,
 * and prints each label's windows.
 */

import fs from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }
const LABELS = arg("--labels")
if (LABELS) fs.writeFileSync(LABELS, "", { flag: "a" })

// SIMCONNECT_SIMOBJECT_TYPE: aircraft 2, helicopter 3, ground 5 (MSFS 2024 SDK, SimConnect.h).
const AIRCRAFT = 2, HELICOPTER = 3, GROUND = 5
const AIR_M = 3_000, GROUND_M = 1_000
const WINDOW_MS = 10_000
const MOVERS = 30
/** Moving, for the jitter measure: over 3kt, as a taxiing aircraft is. */
const MOVING_KT = 3

const LIGHTS = ["STROBE", "LANDING", "TAXI", "BEACON", "NAV"]
const SURFACES = ["TRAILING EDGE FLAPS LEFT", "TRAILING EDGE FLAPS RIGHT", "LEADING EDGE FLAPS LEFT", "LEADING EDGE FLAPS RIGHT"]
const FREEZES = ["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"]
const NUMBERS = [
  ["GROUND VELOCITY", "knots"],
  ["SIM ON GROUND", "bool"],
  ["IS USER SIM", "bool"],
  ...LIGHTS.map((l) => [`LIGHT ${l}`, "bool"]),
  ...LIGHTS.map((l) => [`LIGHT ${l} ON`, "bool"]),
  ...SURFACES.map((s) => [`${s} PERCENT`, "percent"]),
  ["FLAPS HANDLE INDEX", "number"],
  ...FREEZES.map((f) => [f, "bool"]),
  ["VELOCITY BODY Z", "feet per second"],
  ["ROTATION VELOCITY BODY Y", "radians per second"],
  ["GENERAL ENG COMBUSTION:1", "bool"],
]
const POSE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"]]

const rec = new Recorder("p03-sim-session-reads", { area: "traffic-atc" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p03 reads" })

let label = "start"
const windows = new Map()
const titles = new Map()

/** Each object's numbers once, and its title the first time it's seen. */
async function snapshot(type, radius) {
  const ids = await sim.byType(type, radius)
  const out = []
  for (const id of ids) {
    if (!titles.has(id)) {
      const t = await sim.readStrings(["TITLE", "ATC ID"], { object: id })
      titles.set(id, { title: t.get("TITLE") ?? "?", tail: t.get("ATC ID") ?? "" })
    }
    const values = type === GROUND ? new Map() : await sim.read(NUMBERS, { object: id, timeoutMs: 2_000 })
    out.push({ id, ...titles.get(id), values })
  }
  return out
}

/** FS Copilot's measure over one object's poses, a frame apart: mean |d(i) - d(i-1)| / mean |d(i)|, in meters. */
function jitter(poses) {
  const m = (a, b) => {
    const r = Math.PI / 180
    return [(b.lat - a.lat) * 111_195, (b.lon - a.lon) * 111_195 * Math.cos(a.lat * r), (b.alt - a.alt) * 0.3048]
  }
  const d = poses.slice(1).map((p, i) => m(poses[i], p))
  if (d.length < 10) return null
  const len = (v) => Math.hypot(...v)
  const meanD = d.reduce((s, v) => s + len(v), 0) / d.length
  if (meanD < 1e-4) return null
  const changes = d.slice(1).map((v, i) => len(v.map((x, k) => x - d[i][k])))
  return changes.reduce((s, x) => s + x, 0) / changes.length / meanD
}

function summary(air, ground) {
  const lit = (o, suffix) => LIGHTS.filter((l) => o.values.get(`LIGHT ${l}${suffix}`) === 1)
  const count = (list, f) => list.filter(f).length
  const parked = air.filter((o) => (o.values.get("GROUND VELOCITY") ?? 0) < 1 && !o.values.get("IS USER SIM"))
  const moving = air.filter((o) => (o.values.get("GROUND VELOCITY") ?? 0) >= 1 && !o.values.get("IS USER SIM"))
  const lines = []
  for (const [name, list] of [["parked", parked], ["moving", moving]]) {
    if (!list.length) continue
    const each = LIGHTS.map((l) => `${l.toLowerCase()} ${count(list, (o) => o.values.get(`LIGHT ${l}`) === 1)}/${count(list, (o) => o.values.get(`LIGHT ${l} ON`) === 1)}`).join(", ")
    const differ = count(list, (o) => lit(o, "").join() !== lit(o, " ON").join())
    const flaps = count(list, (o) => SURFACES.some((s) => (o.values.get(`${s} PERCENT`) ?? 0) > 0))
    const handle = count(list, (o) => (o.values.get("FLAPS HANDLE INDEX") ?? 0) > 0)
    const frozen = count(list, (o) => FREEZES.every((f) => o.values.get(f) === 1))
    const velocity = count(list, (o) => Math.abs(o.values.get("VELOCITY BODY Z") ?? 0) > 0.1)
    lines.push(`${list.length} ${name}: switch/ON lit ${each}; ${differ} with switches unlike ON; ${flaps} with a surface out, ${handle} with the handle past 0; ${frozen} frozen; ${velocity} with a body velocity`)
  }
  const user = air.filter((o) => o.values.get("IS USER SIM") === 1).map((o) => `${o.title} (${o.id})`)
  lines.push(`IS USER SIM 1: ${user.join(", ") || "none"}`)
  const groundTitles = new Map()
  for (const o of ground) groundTitles.set(o.title.replace(/_\d+$/, ""), (groundTitles.get(o.title.replace(/_\d+$/, "")) ?? 0) + 1)
  lines.push(`ground within 1km: ${[...groundTitles].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${n} × ${t}`).join(", ") || "none"}`)
  const stand = air.filter((o) => /PassiveAircraft/.test(o.title)).map((o) => o.title)
  if (stand.length) lines.push(`stand-ins: ${stand.join(", ")}`)
  return lines
}

process.on("SIGINT", () => { report(); process.exit(0) })

function report() {
  const lines = []
  for (const [name, list] of windows) {
    const scores = list.flatMap((w) => w.scores).sort((a, b) => a - b)
    const fps = list.map((w) => w.fps).sort((a, b) => a - b)
    const median = (a) => (a.length ? a[a.length >> 1] : null)
    lines.push(`${name}: ${list.length} windows, median ${median(list.map((w) => w.aircraft).sort((a, b) => a - b))} aircraft, ${scores.length} mover scores, jitter median ${median(scores)?.toFixed(2) ?? "-"}, worst ${scores.at(-1)?.toFixed(2) ?? "-"}; fps median ${median(fps)?.toFixed(1) ?? "-"}`)
  }
  rec.log("report", `\n${lines.join("\n")}`, { lines })
}

let labelRead = 0
let watched = []
let frames = 0
const clock = sim.watch([["SIMULATION TIME", "seconds"]], { period: "frame", changed: false, label: "frames", onData: () => frames++ })
for (;;) {
  if (LABELS) {
    const text = fs.readFileSync(LABELS, "utf8")
    if (text.length > labelRead) {
      for (const line of text.slice(labelRead).split(/\r?\n/).filter(Boolean)) {
        if (line.trim() === "pushback") sim.transmit("K:TOGGLE_PUSHBACK")
        else label = line.trim()
        rec.log("label", line.trim())
      }
      labelRead = text.length
    }
  }
  const started = Date.now()
  frames = 0
  // Every mover picked last window is read on each frame through this one.
  const poses = new Map(watched.map((id) => [id, []]))
  const watches = watched.map((id) => sim.watch(POSE, { period: "frame", changed: false, object: id, label: `pose ${id}`, onData: (got) => poses.get(id).push({ lat: got.get("PLANE LATITUDE"), lon: got.get("PLANE LONGITUDE"), alt: got.get("PLANE ALTITUDE") }) }))
  const air = [...(await snapshot(AIRCRAFT, AIR_M).catch(() => [])), ...(await snapshot(HELICOPTER, AIR_M).catch(() => []))]
  const ground = await snapshot(GROUND, GROUND_M).catch(() => [])
  if (sim.gone) break
  await sleep(Math.max(0, WINDOW_MS - (Date.now() - started)))
  for (const w of watches) w.stop()
  const fps = frames / ((Date.now() - started) / 1_000)
  const scores = [...poses.values()].map(jitter).filter((s) => s !== null)
  const window = { aircraft: air.length, scores, fps }
  if (!windows.has(label)) windows.set(label, [])
  windows.get(label).push(window)
  const lines = summary(air, ground)
  rec.log("window", `${label}: ${air.length} aircraft, ${ground.length} ground objects, ${fps.toFixed(1)} fps, jitter over ${scores.length} movers: ${scores.map((s) => s.toFixed(2)).join(" ") || "-"}\n  ${lines.join("\n  ")}`, { label, fps, scores, objects: air.map((o) => ({ id: o.id, title: o.title, tail: o.tail, ...Object.fromEntries(o.values) })), ground: ground.map((o) => o.title) })
  watched = air.filter((o) => (o.values.get("GROUND VELOCITY") ?? 0) > MOVING_KT && !o.values.get("IS USER SIM")).slice(0, MOVERS).map((o) => o.id)
}
clock.stop()
report()
process.exit(0)
