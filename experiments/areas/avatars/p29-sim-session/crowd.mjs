/*
 * p29: what the product's figure costs a frame at each level of detail, against p28's figure.
 * It needs update-timer.patch's module, since a figure draws nothing until its
 * `Z:DUALINPUT_FIGURE_SHOWS` says so.
 *
 *   node experiments/areas/avatars/p29-sim-session/crowd.mjs
 *   node experiments/areas/avatars/p29-sim-session/crowd.mjs --count 50 --seconds 15
 *
 * In any aircraft, parked, looking forward from the cockpit, with the sim in front, the frame
 * rate uncapped, and frame generation off. It measures the frame rate with no figures, then with
 * the crowd at each level's distance, shown and still, then every joint moving, then with no
 * figures again. By the sim's own sizes (avatars' log, "The session in the sim"), a figure is at
 * LOD0 within about 3.7m of the camera, LOD1 to about 20m, and LOD2 beyond.
 */

import { spawnSync } from "node:child_process"
import path from "node:path"
import { InitPosition } from "node-simconnect"
import { setTimeout as sleep } from "node:timers/promises"

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const COUNT = arg("--count", 50)
const SECONDS = arg("--seconds", 15)
// A script that saves a screenshot to the path it's given, so a run shows that its figures were
// in view, taken before each measurement.
const SHOT = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null
const TITLE = "DUALINPUT_FIGURE_PILOT"
const PER_ROW = 10
const POSE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]

// Meters forward of the aircraft's reference point to the first row, between rows, and between
// figures in a row, and meters above the reference point. LOD0's crowd stands packed above the
// nose, inside the camera's 3.7m, and the others stand on the ramp ahead.
const LEVELS = [
  { name: "LOD0", forward: 2, row: 0.1, side: 0.2, up: 0.8 },
  { name: "LOD1", forward: 8, row: 2, side: 1.5, up: 0 },
  { name: "LOD2", forward: 30, row: 2, side: 1.5, up: 0 },
]

const rec = new Recorder("p29-crowd", { area: "avatars" })
rec.open()
const sim = await Sim.connect(rec, { name: "DUALINPUT p29 crowd" })
const p = await sim.read(POSE)
const ac = { lat: p.get("PLANE LATITUDE"), lon: p.get("PLANE LONGITUDE"), alt: p.get("PLANE ALTITUDE"), hdg: p.get("PLANE HEADING DEGREES TRUE") }
const results = []

function place(forward, right, up) {
  const h = (ac.hdg * Math.PI) / 180
  const north = forward * Math.cos(h) - right * Math.sin(h)
  const east = forward * Math.sin(h) + right * Math.cos(h)
  const init = new InitPosition()
  Object.assign(init, {
    latitude: ac.lat + north / 111_320,
    longitude: ac.lon + east / (111_320 * Math.cos((ac.lat * Math.PI) / 180)),
    altitude: ac.alt + up * 3.28084,
    pitch: 0,
    bank: 0,
    heading: (ac.hdg + 180) % 360,
    onGround: false,
    airspeed: 0,
  })
  return init
}

async function measure(label) {
  await sleep(1_500)
  if (SHOT) spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SHOT, path.join(path.dirname(SHOT), `crowd-${label.replace(/[^A-Za-z0-9]+/g, "-")}.jpg`)])
  await sleep(1_500)
  const r = await sim.frameRate(SECONDS * 1_000)
  const ms = r.fps ? 1_000 / r.fps : null
  rec.log("fps", `${label}: ${r.fps?.toFixed(1) ?? "no"} fps, ${ms?.toFixed(2) ?? "?"}ms`, { label, ...r })
  results.push({ label, fps: r.fps, ms })
  return ms
}

function setCrowd(first, count, mode) {
  sim.write("L:DUALINPUT_P29_CROWD_FIRST", "number", first)
  sim.write("L:DUALINPUT_P29_CROWD_COUNT", "number", count)
  sim.write("L:DUALINPUT_P29_CROWD_MODE", "number", mode)
}

const none = await measure("no figures")
for (const level of LEVELS) {
  const ids = []
  for (let i = 0; i < COUNT; i++) {
    const row = Math.floor(i / PER_ROW)
    const r = await sim.spawn(TITLE, "", place(level.forward + row * level.row, ((i % PER_ROW) - (PER_ROW - 1) / 2) * level.side, level.up))
    if (r.id === undefined) { rec.log("warn", `figure ${i + 1} not created: ${r.error}`); break }
    for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
    ids.push(r.id)
  }
  // The sim's IDs come in clusters millions apart, and the module looks up every ID in the range
  // it's given in one frame, which stalled the sim for seconds over 24 million of them. So the
  // crowd is the largest cluster, and the figures outside it draw nothing.
  const sorted = [...ids].sort((a, b) => a - b)
  const clusters = []
  for (const id of sorted) {
    if (clusters.at(-1) && id - clusters.at(-1).at(-1) < 500_000) clusters.at(-1).push(id)
    else clusters.push([id])
  }
  const shown = clusters.reduce((best, c) => (c.length > best.length ? c : best))
  const first = shown[0]
  const span = shown.at(-1) - first + 1
  rec.log("figures", `${shown.length} of ${ids.length} figures shown, IDs ${first} to ${first + span - 1}`, { ids })
  setCrowd(first, span, 1)
  await sleep(2_000)
  const still = await measure(`${level.name}, ${shown.length} figures, still`)
  setCrowd(first, span, 2)
  const moving = await measure(`${level.name}, ${shown.length} figures, moving`)
  setCrowd(0, 0, 0)
  for (const id of ids) sim.remove(id)
  rec.log("cost", `${level.name}: a still figure adds ${((1_000 * (still - none)) / shown.length).toFixed(0)}µs, moving ${((1_000 * (moving - none)) / shown.length).toFixed(0)}µs`)
  results.push({ label: `${level.name} per figure`, stillUs: (1_000 * (still - none)) / shown.length, movingUs: (1_000 * (moving - none)) / shown.length })
  await sleep(2_000)
}
await measure("no figures, after")
rec.log("report", JSON.stringify(results, null, 2))
process.exit(0)
