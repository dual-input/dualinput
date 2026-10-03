/*
 * p08: whether camera views added to the sim's per-user camera file for an
 * aircraft become views a SimConnect client can seat the pilot in, on MSFS 2024,
 * and whether ChasePlane picks them up, so Crosscheck could add a view for each
 * seat the profile defines.
 *
 * The sim keeps a pilot's saved custom cameras per aircraft in a cameras.CFG of
 * its own, outside any package: on a Steam install,
 * %APPDATA%\Microsoft Flight Simulator 2024\SimObjects\Airplanes\<folder>\.
 * Releasing the camera into one of the aircraft's views seats the pilot there
 * (p04), and ChasePlane loads its own views through its API (p05); both logged
 * in record/areas/aircraft/log.md.
 *
 * Three test views, copied from the 58P's own CoPilot definition (read in
 * bksq-aircraft-baronpro 0.1.1, bksq-aircraft-baronpropress\cameras.cfg) at
 * offsets from it that can't happen by chance, x right, y up, z forward:
 *
 *   A  Crosscheck: Test A  in the right seat, (-0.10, +0.10, +0.10)m from CoPilot
 *   B  Crosscheck: Test B  in the cabin, (-0.245, -0.05, -1.20)m from CoPilot
 *   C  Crosscheck: Test C  (-0.05, +0.05, -0.40)m from CoPilot, filed as
 *                          SubCategory "Custom" like the pilot's saved cameras,
 *                          where A and B are "Pilot" like CoPilot
 *
 *   node experiments/areas/aircraft/p08-camera-file.mjs --write    back up the file, add the views
 *   node experiments/areas/aircraft/p08-camera-file.mjs --check    what SimConnect and ChasePlane list,
 *                                                                  and, with the camera free, release
 *                                                                  into each view and measure the eye
 *   node experiments/areas/aircraft/p08-camera-file.mjs --restore  put the backed-up file back
 *
 * --check --force releases into every test view whether SimConnect lists it or
 * not, and into the pilot's saved custom camera "2".
 *
 * --folder <name> picks another aircraft's folder; the default is the 58P's,
 * bksq-aircraft-baronpropress. The backup goes to the system's temp folder,
 * never into the tree, and --write refuses to replace a backup already there.
 *
 * Output: the check on the console, and in
 * experiments/areas/aircraft/results/p08-camera-file-<time>.txt with the
 * .ndjson beside it. Paths are written with %APPDATA%, never the home folder.
 */

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const FOLDER = arg("--folder", "bksq-aircraft-baronpropress")
const DIR = join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "SimObjects", "Airplanes", FOLDER)
const FILE = join(DIR, "cameras.CFG")
const SHOWN = `%APPDATA%\\Microsoft Flight Simulator 2024\\SimObjects\\Airplanes\\${FOLDER}\\cameras.CFG`
const BACKUP = join(tmpdir(), `crosscheck-p08-${FOLDER}-cameras.CFG`)

// The 58P's own CoPilot definition, InitialXyz 0.495,0.201,-0.009.
const COPILOT_XYZ = [0.495, 0.201, -0.009]
const TESTS = [
  { title: "Crosscheck: Test A", sub: "Pilot", d: [-0.1, 0.1, 0.1] },
  { title: "Crosscheck: Test B", sub: "Pilot", d: [-0.245, -0.05, -1.2] },
  { title: "Crosscheck: Test C", sub: "Custom", d: [-0.05, 0.05, -0.4] },
]
const xyz = (t) => COPILOT_XYZ.map((v, i) => +(v + t.d[i]).toFixed(3))

function definition(index, t) {
  const [x, y, z] = xyz(t)
  return [
    `[CAMERADEFINITION.${index}]`,
    `Title="${t.title}"`,
    `Guid="{${randomUUID().toUpperCase()}}"`,
    `UITitle="${t.title}"`,
    `Description=""`,
    `Origin="Virtual Cockpit"`,
    `MomentumEffect=1`,
    `SnapPbhAdjust="Swivel"`,
    `SnapPbhReturn=0`,
    `PanPbhAdjust="Swivel"`,
    `PanPbhReturn=0`,
    `Track="None"`,
    `ShowAxis="YES"`,
    `AllowZoom=1`,
    `InitialZoom=0.293`,
    `SmoothZoomTime=2`,
    `ZoomPanScalar=1`,
    `ShowWeather=1`,
    `XyzAdjust=1`,
    `ShowLensFlare=0`,
    `Category="Cockpit"`,
    `SubCategory="${t.sub}"`,
    `SubCategoryItem="None"`,
    `PitchPanRate=20`,
    `HeadingPanRate=60`,
    `InitialXyz= ${x}, ${y}, ${z}`,
    `InitialPbh= -11.371, 0, 0`,
    `ClipMode="Normal"`,
    `BoundingBoxRadius=0.1`,
    `TargetCategory="None"`,
    `CycleHidden=0`,
    `CycleHideRadius=0`,
    `ShowPanel=0`,
    `InstancedBased=0`,
    `NoSortTitle=0`,
    `Transition=0`,
    `XYZRate=0.25`,
  ].join("\r\n")
}

const writeAtomic = (path, text) => { writeFileSync(`${path}.crosscheck-tmp`, text); renameSync(`${path}.crosscheck-tmp`, path) }
const ours = (text) => TESTS.filter((t) => text.includes(`Title="${t.title}"`)).map((t) => t.title)

if (process.argv.includes("--write")) {
  if (!existsSync(FILE)) throw new Error(`no per-user camera file at ${SHOWN}`)
  if (existsSync(BACKUP)) throw new Error(`a backup is already in the temp folder; run --restore first, or remove ${BACKUP} if it's stale`)
  const text = readFileSync(FILE, "latin1")
  if (ours(text).length) throw new Error(`the file already holds ${ours(text).join(", ")}`)
  copyFileSync(FILE, BACKUP)
  const last = Math.max(-1, ...[...text.matchAll(/\[CAMERADEFINITION\.(\d+)\]/g)].map((m) => Number(m[1])))
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const added = TESTS.map((t, i) => definition(last + 1 + i, t).replace(/\r\n/g, eol)).join(eol)
  writeAtomic(FILE, text.replace(/\s*$/, "") + eol + added + eol)
  console.log(`Backed up ${SHOWN} to the temp folder and added ${TESTS.map((t) => `"${t.title}" at ${xyz(t).join(", ")}`).join("; ")}.`)
  process.exit(0)
}

if (process.argv.includes("--restore")) {
  if (!existsSync(BACKUP)) throw new Error("no backup in the temp folder; nothing to restore")
  const before = readFileSync(FILE, "latin1")
  writeAtomic(FILE, readFileSync(BACKUP))
  console.log(`Put the backup back over ${SHOWN}; it held ${ours(before).length ? ours(before).join(", ") : "none of the test views"} before. The backup stays in the temp folder.`)
  process.exit(0)
}

if (!process.argv.includes("--check")) {
  console.log("Pass --write, --check, or --restore.")
  process.exit(2)
}

// ---------------------------------------------------------------- --check

const rec = new Recorder("p08-camera-file", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p08-camera-file" })
rec.open()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

const fileNow = existsSync(FILE) ? readFileSync(FILE, "latin1") : ""
note("file", `${SHOWN} holds ${ours(fileNow).length ? ours(fileNow).join(", ") : "none of the test views"}`)

let definitions = []
h.on("cameraDefinitionList", (l) => { definitions = [...definitions, ...l.cameraDefinitions.map((d) => d.name)] })
sim.send("enumerate camera definitions", () => h.enumerateCameraDefinitions())
await sleep(1200)
const listed = TESTS.filter((t) => definitions.includes(t.title)).map((t) => t.title)
note("simconnect", `SimConnect lists ${definitions.length} definitions; of the test views: ${listed.length ? listed.join(", ") : "none"}`, { definitions })
const customs = definitions.filter((n) => /^\d$/.test(n))
note("simconnect", `Of the pilot's saved custom cameras: ${customs.length ? customs.join(", ") : "none"}`)

try {
  const ws = new WebSocket("ws://localhost:8652")
  const views = await new Promise((resolve, reject) => {
    const id = `get_views_${Date.now()}`
    ws.onopen = () => ws.send(JSON.stringify({ message: "api_connect", payload: { client_name: "CROSSCHECK p08-camera-file" } }))
    ws.onerror = () => reject(new Error("ChasePlane's API isn't reachable"))
    ws.onmessage = (m) => {
      if (typeof m.data !== "string" || m.data.startsWith("PING")) return
      let x
      try { x = JSON.parse(m.data) } catch { return }
      if (x.message === "initialized") ws.send(JSON.stringify({ message: "api_request", request_id: id, command: "get_views", payload: {} }))
      if (x.message === "api_reply" && x.request_id === id) {
        let p = x.payload
        for (let i = 0; i < 4 && p && typeof p === "object" && "payload" in p; i++) p = p.payload
        resolve(Array.isArray(p) ? p : p?.views ?? [])
      }
    }
    setTimeout(() => reject(new Error("ChasePlane's API gave no views in 5s")), 5000)
  })
  ws.close()
  const cp = views.filter((v) => /crosscheck|^\d$/i.test(v.name)).map((v) => `${v.name} at ${JSON.stringify(v.position)}`)
  note("chaseplane", `ChasePlane lists ${views.length} views; of the test views and the saved custom cameras: ${cp.length ? cp.join("; ") : "none"}`)
} catch (e) {
  note("chaseplane", `ChasePlane: ${e.message}`)
}

// Measure each listed view's eye against CoPilot's, with the camera free.
const status = await new Promise((resolve) => { h.once("cameraStatus", (s) => resolve(s.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
if (status === 2) {
  note("skip", "Another client holds the camera (ChasePlane?), so no view was measured")
} else if (listed.length || process.argv.includes("--force")) {
  let waiting = null
  h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
  const eye = async () => {
    const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
    sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
    const c = await got
    // SIMOBJECT x points left (measured, record/areas/avatars/log.md); turn it to x right.
    return c ? [-c.position.x, c.position.y, c.position.z] : null
  }
  const seat = async (name) => {
    sim.send("camera acquire", () => h.cameraAcquire("CROSSCHECK p08-camera-file"))
    await sleep(300)
    sim.send(`camera release into ${name}`, () => h.cameraRelease(name))
    await sleep(1500)
    return eye()
  }
  const base = await seat("CoPilot")
  note("eye", `CoPilot: eye at ${base ? base.map((v) => v.toFixed(3)).join(", ") : "no reply"} (x right, y up, z forward)`)
  // --force releases into every test view, listed or not, and into the pilot's
  // saved custom camera "2", whose InitialXyz in the same file is
  // -0.013993, 0.087536, -0.497054.
  if (process.argv.includes("--force")) {
    const e = await seat("2")
    const asked = [-0.013993, 0.087536, -0.497054].map((v, i) => v - COPILOT_XYZ[i])
    if (e && base) {
      const got = e.map((v, i) => v - base[i])
      note("eye", `Custom camera "2": ${got.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join(", ")}m from CoPilot, its file entry ${asked.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join(", ")}, off by ${(Math.hypot(...got.map((v, i) => v - asked[i])) * 1000).toFixed(0)}mm`)
    }
  }
  for (const t of TESTS.filter((x) => listed.includes(x.title) || process.argv.includes("--force"))) {
    const e = await seat(t.title)
    if (!e || !base) { note("eye", `${t.title}: no reply`); continue }
    const got = e.map((v, i) => v - base[i])
    const err = Math.hypot(...got.map((v, i) => v - t.d[i]))
    note("eye", `${t.title}: ${got.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join(", ")}m from CoPilot, asked ${t.d.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join(", ")}, off by ${(err * 1000).toFixed(0)}mm`, { title: t.title, got, asked: t.d, err })
  }
  await seat("Pilot")
  note("eye", "Released back into Pilot")
}

const text = [
  "p08 · Camera views added to the per-user camera file, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
