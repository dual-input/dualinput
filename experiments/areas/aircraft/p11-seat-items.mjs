/*
 * p11: how many seat views a package of ours can give one aircraft, on MSFS
 * 2024, by which SubCategoryItem values let the camera hand back into a view.
 *
 * A Community package that mounts after the aircraft's and replaces its
 * cameras.cfg with a copy plus a view whose SubCategoryItem is "LandingPilot",
 * a pilot item the 58P leaves free, seated the pilot anywhere with their look
 * as usual; views with "None" fell back to Pilot (p10, record/areas/aircraft/log.md,
 * "A Community package of ours adds a seat view anywhere in the aircraft").
 * The SDK lists seven pilot items (MSFS 2024 SDK, cameras.cfg), and an airliner
 * needs 180 seats, so this asks whether views can share an item or use one of
 * our own:
 *
 *   S1  LandingPilot   the control
 *   S2  LandingPilot   two views sharing one item
 *   S3  Crosscheck_S3  an item of our own
 *   S4  CoPilot        an item the aircraft already uses
 *   S5  ClosePilot     another free item
 *
 * Each sits at its own point, offsets from the 58P's CoPilot view, x right, y up,
 * z forward (CoPilot's InitialXyz is 0.495, 0.201, -0.009; read in
 * bksq-aircraft-baronpro 0.1.1, bksq-aircraft-baronpropress\cameras.cfg).
 * One package, zzz-crosscheck-seat-test, package_order_hint
 * CUSTOM_SIMOBJECTS_PATCH, holds the 58P's file, copied on this machine.
 *
 *   node experiments/areas/aircraft/p11-seat-items.mjs --install   with the sim closed, then start it
 *   node experiments/areas/aircraft/p11-seat-items.mjs --check     in the 58P
 *   node experiments/areas/aircraft/p11-seat-items.mjs --remove    with the sim closed
 *
 * --check turns ChasePlane off through its API while it measures, and back on.
 * Output: --check's report in
 * experiments/areas/aircraft/results/p11-seat-items-<time>.txt with the .ndjson beside it.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const PKG = "zzz-crosscheck-seat-test"
const HINT = "CUSTOM_SIMOBJECTS_PATCH"
const AIRCRAFT_REL = "SimObjects/Airplanes/bksq-aircraft-baronpropress/cameras.cfg"
const SOURCE_PKG = "bksq-aircraft-baronpro"
const COPILOT_XYZ = [0.495, 0.201, -0.009]
const SEATS = [
  { title: "Crosscheck: S1", item: "LandingPilot", d: [-0.489, -0.1, -0.8] },
  { title: "Crosscheck: S2", item: "LandingPilot", d: [0.0, -0.1, -0.8] },
  { title: "Crosscheck: S3", item: "Crosscheck_S3", d: [-0.489, -0.15, -1.9] },
  { title: "Crosscheck: S4", item: "CoPilot", d: [0.0, -0.15, -1.9] },
  { title: "Crosscheck: S5", item: "ClosePilot", d: [-0.245, 0.1, -0.4] },
]

function community() {
  const opt = join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "UserCfg.opt")
  const line = readFileSync(opt, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/.test(l))
  return join(line.replace(/^\s*InstalledPackagesPath\s+"?/, "").replace(/"\s*$/, ""), "Community")
}
const COMMUNITY = community()
const DIR = join(COMMUNITY, PKG)
const xyz = (d) => COPILOT_XYZ.map((v, i) => +(v + d[i]).toFixed(3))
const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()

// Copied from the 58P's CoPilot definition, with our title, item, Guid, and offset.
function definition(index, s) {
  const [x, y, z] = xyz(s.d)
  return [
    `[CAMERADEFINITION.${index}]`, `Title ="${s.title}"`, `Guid ="{${randomUUID()}}"`, `Description =""`,
    `Origin ="Virtual Cockpit"`, `MomentumEffect =1`, `SnapPbhAdjust ="Swivel"`, `SnapPbhReturn =0`,
    `PanPbhAdjust ="Swivel"`, `PanPbhReturn =0`, `Track ="None"`, `ShowAxis ="YES"`, `AllowZoom =1`,
    `InitialZoom =0.293`, `SmoothZoomTime =2`, `ZoomPanScalar =1`, `ShowWeather =1`, `XyzAdjust =1`,
    `ShowLensFlare =0`, `Category ="Cockpit"`, `SubCategory ="Pilot"`, `SubCategoryItem ="${s.item}"`,
    `PitchPanRate =20`, `HeadingPanRate =60`, `InitialXyz = ${x},${y},${z}`, `InitialPbh = -11.371,0,0`,
    `ClipMode ="Normal"`, `BoundingBoxRadius =0.1`, `UITitle="${s.title}"`, `TargetCategory="None"`,
    `CycleHidden=0`, `CycleHideRadius=0`, `ShowPanel=0`, `InstancedBased=0`, `NoSortTitle=0`, `Transition=1`,
  ].join("\r\n")
}

if (process.argv.includes("--install")) {
  if (existsSync(DIR)) throw new Error(`${PKG} is already in Community; run --remove first`)
  for (const other of ["aaa-crosscheck-camera-test", "zzz-crosscheck-camera-test"]) if (existsSync(join(COMMUNITY, other))) throw new Error(`p10's ${other} is still installed; run p10 --remove first`)
  const source = readFileSync(join(COMMUNITY, SOURCE_PKG, ...AIRCRAFT_REL.split("/")), "latin1")
  const last = Math.max(-1, ...[...source.matchAll(/\[CAMERADEFINITION\.(\d+)\]/gi)].map((m) => Number(m[1])))
  const cfg = source.replace(/\s*$/, "") + "\r\n\r\n" + SEATS.map((s, i) => definition(last + 1 + i, s)).join("\r\n\r\n") + "\r\n"
  const target = join(DIR, ...AIRCRAFT_REL.split("/"))
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, cfg, "latin1")
  writeFileSync(join(DIR, "manifest.json"), JSON.stringify({
    dependencies: [], content_type: "MISC", title: "Crosscheck p11 seat item test", manufacturer: "", creator: "Crosscheck",
    package_version: "0.1.0", minimum_game_version: "1.8.16", minimum_compatibility_version: "8.11.0.236", export_type: "Community",
    builder: "Microsoft Flight Simulator 2024", package_order_hint: HINT, release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
  }, null, 2) + "\n")
  const st = statSync(target)
  writeFileSync(join(DIR, "layout.json"), `{\n  "content": [\n    {\n      "path": ${JSON.stringify(AIRCRAFT_REL.toLowerCase())},\n      "size": ${st.size},\n      "date": ${filetime(st.mtimeMs)}\n    }\n  ]\n}\n`)
  console.log(`Installed ${PKG} with ${SEATS.map((s) => `${s.title} (${s.item}) at ${xyz(s.d).join(", ")}`).join("; ")}. Start the sim and load the 58P, then run --check.`)
  process.exit(0)
}
if (process.argv.includes("--remove")) {
  if (existsSync(DIR) && /Crosscheck p11 seat item test/.test(readFileSync(join(DIR, "manifest.json"), "utf8"))) { rmSync(DIR, { recursive: true }); console.log(`Removed ${PKG}.`) }
  process.exit(0)
}
if (!process.argv.includes("--check")) {
  console.log("Pass --install, --check, or --remove.")
  process.exit(2)
}

// ---------------------------------------------------------------- --check

const rec = new Recorder("p11-seat-items", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p11-seat-items" })
rec.open()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

try {
  const report = readFileSync(join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "AsoboReport-RunningSession.txt"), "utf8").split(/\r?\n/)
  const at = (name) => report.findIndex((l) => l.startsWith(`${name}=`))
  note("packages", `Mount order in the sim's report: ${[SOURCE_PKG, PKG].map((n) => ({ n, i: at(n) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.n).join(", ")}`)
} catch (e) { note("packages", `Mount order: ${e.message}`) }

let definitions = []
h.on("cameraDefinitionList", (l) => { definitions = [...definitions, ...l.cameraDefinitions.map((d) => d.name)] })
sim.send("enumerate camera definitions", () => h.enumerateCameraDefinitions())
await sleep(1200)
const listed = SEATS.filter((s) => definitions.includes(s.title))
note("simconnect", `SimConnect lists ${definitions.length} definitions; of the seat views: ${listed.map((s) => s.title).join(", ") || "none"}`, { definitions })

const status = async () => new Promise((resolve) => { h.once("cameraStatus", (s) => resolve(s.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
let cp = null
let cpTurnedOff = false
try {
  cp = await connectChasePlane("CROSSCHECK p11-seat-items", { rec })
  await sleep(500)
  if (cp.state.masterEnabled || (await status()) === 2) { await cp.setMasterEnabled(false); cpTurnedOff = true; await sleep(1500) }
} catch (e) { note("chaseplane", `ChasePlane: ${e.message}`) }

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
const eye = async () => {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? [-c.position.x, c.position.y, c.position.z] : null // SIMOBJECT x points left
}
const acquire = async () => { sim.send("camera acquire", () => h.cameraAcquire("CROSSCHECK p11-seat-items")); await sleep(300) }
const release = async (name) => { sim.send(`camera release into ${name}`, () => h.cameraRelease(name)); await sleep(1500) }
const fmt3 = (a) => a.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join(", ")

await acquire()
await release("CoPilot")
const base = await eye()
const results = []
for (const s of listed) {
  const off = (e) => (e && base ? Math.hypot(...e.map((v, i) => v - base[i] - s.d[i])) : null)
  await acquire()
  sim.send(`camera set using ${s.title}`, () => h.cameraSetUsingCameraDefinition(s.title))
  await sleep(1500)
  const held = await eye()
  await release(s.title)
  const e = await eye()
  const st = await status()
  const works = off(e) !== null && off(e) < 0.02 && st === 0
  results.push({ s, works })
  note("eye", `${s.title} (${s.item}): holding, ${held && base ? fmt3(held.map((v, i) => v - base[i])) : "?"}m from CoPilot (asked ${fmt3(s.d)}, off by ${held ? (off(held) * 1000).toFixed(0) : "?"}mm); released into it, ${e && base ? fmt3(e.map((v, i) => v - base[i])) : "?"}m (off by ${e ? (off(e) * 1000).toFixed(0) : "?"}mm), camera ${st === 0 ? "NOT_ACQUIRED" : st}: ${works ? "seated" : "not seated"}`, { title: s.title, item: s.item, held, released: e, status: st, works })
}
await acquire()
await release("Pilot")
note("summary", `Seated: ${results.filter((r) => r.works).map((r) => `${r.s.title} (${r.s.item})`).join(", ") || "none"}; not seated: ${results.filter((r) => !r.works).map((r) => `${r.s.title} (${r.s.item})`).join(", ") || "none"}`)
if (cpTurnedOff) { try { await cp.setMasterEnabled(true); note("chaseplane", "Turned ChasePlane back on") } catch (e) { note("chaseplane", `Turning ChasePlane back on failed: ${e.message}`) } }
cp?.close()

const text = [
  "p11 · Which SubCategoryItem values let the camera hand back into a seat view, on MSFS 2024",
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
