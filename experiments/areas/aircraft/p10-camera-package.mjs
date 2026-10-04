/*
 * p10: whether a Community package of our own can add camera views to an
 * aircraft by putting a cameras.cfg at the aircraft's own path in the sim's
 * virtual file system, on MSFS 2024, so Crosscheck can give a seat a view with
 * the sim's own camera.
 *
 * Releasing the camera into one of the aircraft's views seats the pilot there
 * and leaves them their look (p04); the Camera API has no call that adds a view
 * (read in MSFS 2024 SDK 1.7.3), and views added to the per-user camera file
 * reach neither SimConnect nor ChasePlane (p08); all in
 * record/areas/aircraft/log.md. Packages override one another's files, and in
 * MSFS 2024 the package whose file "appears in the file system before" wins,
 * hence names like aaa_ (AVSIM forum thread 671783, not read: it refused us;
 * unverified). So --install writes two packages that both shadow the 58P's
 * cameras.cfg, each a copy of the installed file built on this machine with one
 * test view of its own appended, and the names say which one the sim took:
 *
 *   aaa-crosscheck-camera-test  "Crosscheck: AAA", (-0.10, +0.10, +0.10)m from CoPilot
 *   zzz-crosscheck-camera-test  "Crosscheck: ZZZ", (-0.245, -0.05, -1.20)m from CoPilot
 *
 * x right, y up, z forward, as the 58P's own CoPilot definition sits at
 * InitialXyz 0.495, 0.201, -0.009 (read in bksq-aircraft-baronpro 0.1.1,
 * bksq-aircraft-baronpropress\cameras.cfg). The HUES texture pack for the PMDG
 * 777 names its folder zHUES_PMDG777_REV (reported by the user, 2026-10-04),
 * which suggests the later name wins instead.
 *
 * --install also appends "Crosscheck: ROOT", (-0.05, +0.05, -0.40)m from
 * CoPilot, to the sim's root Cameras.CFG, the global FSX-style camera file in
 * its AppData folder, after backing it up to the temp folder; --remove puts it
 * back. The sim mounts packages at boot, so restart it after --install.
 *
 *   node experiments/areas/aircraft/p10-camera-package.mjs --install
 *   node experiments/areas/aircraft/p10-camera-package.mjs --check    after the restart, in the 58P
 *   node experiments/areas/aircraft/p10-camera-package.mjs --move     move each test view 0.3m up,
 *                                                                     then start a new flight and --check
 *   node experiments/areas/aircraft/p10-camera-package.mjs --remove   delete the two test packages
 *
 * --check turns ChasePlane off through its API while it measures, and back on.
 * Output: --check's report in
 * experiments/areas/aircraft/results/p10-camera-package-<time>.txt with the
 * .ndjson beside it. Paths are written relative to the Community folder.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { startBeeper } from "../../tools/guide.mjs"
import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const AIRCRAFT_REL = "SimObjects/Airplanes/bksq-aircraft-baronpropress/cameras.cfg"
const SOURCE_PKG = "bksq-aircraft-baronpro"
const COPILOT_XYZ = [0.495, 0.201, -0.009]
const TESTS = [
  { pkg: "aaa-crosscheck-camera-test", title: "Crosscheck: AAA", d: [-0.1, 0.1, 0.1] },
  { pkg: "zzz-crosscheck-camera-test", title: "Crosscheck: ZZZ", d: [-0.245, -0.05, -1.2] },
]
const MOVE_UP = 0.3
// Also in the same restart: one view appended to the sim's root Cameras.CFG, the
// global FSX-style camera file in the sim's AppData folder, backed up first.
const ROOT = { title: "Crosscheck: ROOT", d: [-0.05, 0.05, -0.4] }
const ROOT_FILE = join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "Cameras.CFG")
const ROOT_BACKUP = join(process.env.TEMP, "crosscheck-p10-root-Cameras.CFG")

function community() {
  const opt = join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "UserCfg.opt")
  const line = readFileSync(opt, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/.test(l))
  if (!line) throw new Error("no InstalledPackagesPath in UserCfg.opt")
  return join(line.replace(/^\s*InstalledPackagesPath\s+"?/, "").replace(/"\s*$/, ""), "Community")
}
const COMMUNITY = community()
const xyz = (d, up = 0) => COPILOT_XYZ.map((v, i) => +(v + d[i] + (i === 1 ? up : 0)).toFixed(3))

// --item <value> gives the test views that SubCategoryItem, with Transition 1 as
// the 58P's Pilot and CoPilot have. Releasing the camera into the 58P's views
// handed it back only into Pilot ("DefaultPilot") and CoPilot ("CoPilot"); its
// "None" views and ours fell back to Pilot (2026-10-04). The SDK's other pilot
// items include ClosePilot, LandingPilot, and TrueCockpit, which the 58P leaves
// unused (MSFS 2024 SDK, cameras.cfg).
const itemAt = process.argv.indexOf("--item")
const ITEM = itemAt > 0 ? process.argv[itemAt + 1] : "None"

// Copied from the 58P's CoPilot definition, with our title, a fresh Guid, and our offset.
function definition(index, t, up) {
  const [x, y, z] = xyz(t.d, up)
  const item = ITEM
  const transition = ITEM === "None" ? 0 : 1
  return [
    `[CAMERADEFINITION.${index}]`, `Title ="${t.title}"`, `Guid ="{${randomUUID()}}"`, `Description =""`,
    `Origin ="Virtual Cockpit"`, `MomentumEffect =1`, `SnapPbhAdjust ="Swivel"`, `SnapPbhReturn =0`,
    `PanPbhAdjust ="Swivel"`, `PanPbhReturn =0`, `Track ="None"`, `ShowAxis ="YES"`, `AllowZoom =1`,
    `InitialZoom =0.293`, `SmoothZoomTime =2`, `ZoomPanScalar =1`, `ShowWeather =1`, `XyzAdjust =1`,
    `ShowLensFlare =0`, `Category ="Cockpit"`, `SubCategory ="Pilot"`, `SubCategoryItem ="${item}"`,
    `PitchPanRate =20`, `HeadingPanRate =60`, `InitialXyz = ${x},${y},${z}`, `InitialPbh = -11.371,0,0`,
    `ClipMode ="Normal"`, `BoundingBoxRadius =0.1`, `UITitle="${t.title}"`, `TargetCategory="None"`,
    `CycleHidden=0`, `CycleHideRadius=0`, `ShowPanel=0`, `InstancedBased=0`, `NoSortTitle=0`, `Transition=${transition}`,
  ].join("\r\n")
}

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
function writePackage(t, up) {
  const dir = join(COMMUNITY, t.pkg)
  const source = readFileSync(join(COMMUNITY, SOURCE_PKG, ...AIRCRAFT_REL.split("/")), "latin1")
  const last = Math.max(-1, ...[...source.matchAll(/\[CAMERADEFINITION\.(\d+)\]/gi)].map((m) => Number(m[1])))
  const cfg = source.replace(/\s*$/, "") + "\r\n\r\n" + definition(last + 1, t, up) + "\r\n"
  const target = join(dir, ...AIRCRAFT_REL.split("/"))
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, cfg, "latin1")
  // Keep the hint --hint set, since --move rewrites the package.
  const manifest = join(dir, "manifest.json")
  const hint = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).package_order_hint ?? "" : ""
  writeFileSync(manifest, JSON.stringify({
    dependencies: [], content_type: "MISC", title: `Crosscheck p10 camera test (${t.pkg.slice(0, 3)})`, manufacturer: "", creator: "Crosscheck",
    package_version: "0.1.0", minimum_game_version: "1.8.16", minimum_compatibility_version: "8.11.0.236", export_type: "Community",
    builder: "Microsoft Flight Simulator 2024", package_order_hint: hint, release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
  }, null, 2) + "\n")
  const s = statSync(target)
  writeFileSync(join(dir, "layout.json"), JSON.stringify({ content: [{ path: AIRCRAFT_REL.toLowerCase(), size: s.size, date: 0 }] }, null, 2).replace('"date": 0', `"date": ${filetime(s.mtimeMs)}`) + "\n")
}

if (process.argv.includes("--install")) {
  for (const t of TESTS) if (existsSync(join(COMMUNITY, t.pkg))) throw new Error(`${t.pkg} is already in Community; run --remove first`)
  if (existsSync(ROOT_BACKUP)) throw new Error(`a root Cameras.CFG backup is already in the temp folder; run --remove first`)
  for (const t of TESTS) writePackage(t, 0)
  const root = readFileSync(ROOT_FILE, "latin1")
  writeFileSync(ROOT_BACKUP, root, "latin1")
  const n = String(1 + Math.max(0, ...[...root.matchAll(/\[CameraDefinition\.(\d+)\]/gi)].map((m) => Number(m[1])))).padStart(3, "0")
  const [x, y, z] = xyz(ROOT.d)
  writeFileSync(ROOT_FILE, root.replace(/\s*$/, "") + "\r\n\r\n" + [
    `[CameraDefinition.${n}]`, `Title = ${ROOT.title}`, `Guid = {${randomUUID().toUpperCase()}}`, `Description = Crosscheck p10 test view.`,
    `Origin = Virtual Cockpit`, `MomentumEffect = Yes`, `SnapPbhAdjust = Swivel`, `SnapPbhReturn = False`, `PanPbhAdjust = Swivel`,
    `PanPbhReturn = False`, `Track = None`, `ShowAxis = YES`, `AllowZoom = TRUE`, `InitialZoom = 0.7`, `SmoothZoomTime = 2.0`,
    `ZoomPanScalar = 1.0`, `ShowWeather = Yes`, `XyzAdjust = TRUE`, `ShowLensFlare=FALSE`, `Category = Cockpit`,
    `PitchPanRate=30`, `HeadingPanRate=75`, `InitialXyz = ${x}, ${y}, ${z}`, `InitialPbh = -11.371, 0, 0`,
  ].join("\r\n") + "\r\n", "latin1")
  console.log(`Installed ${TESTS.map((t) => `${t.pkg} with "${t.title}" at ${xyz(t.d).join(", ")}`).join("; ")}; appended "${ROOT.title}" at ${x}, ${y}, ${z} to the root Cameras.CFG, backed up to the temp folder. Restart the sim, load the 58P, then run --check.`)
  process.exit(0)
}
if (process.argv.includes("--move")) {
  for (const t of TESTS) if (!existsSync(join(COMMUNITY, t.pkg))) throw new Error(`${t.pkg} isn't installed`)
  for (const t of TESTS) writePackage(t, MOVE_UP)
  console.log(`Moved each test view ${MOVE_UP}m up in its package's file. Start a new flight in the 58P, then run --check --moved.`)
  process.exit(0)
}
// --hint <value> rewrites both test packages' package_order_hint. The sim mounts
// packages in groups by that hint and alphabetically within a group, the
// 58P's package in CUSTOM_SIMOBJECTS_PATCH; with an empty hint ours mounted
// long before it, and neither test view showed (AsoboReport-RunningSession.txt,
// [FlightSimulator_Packages], 2026-10-04). Takes effect at the next sim start.
const hintAt = process.argv.indexOf("--hint")
if (hintAt > 0) {
  const hint = process.argv[hintAt + 1] ?? ""
  for (const t of TESTS) {
    const m = join(COMMUNITY, t.pkg, "manifest.json")
    const j = JSON.parse(readFileSync(m, "utf8"))
    j.package_order_hint = hint
    writeFileSync(m, JSON.stringify(j, null, 2) + "\n")
  }
  console.log(`Set package_order_hint "${hint}" on both test packages. Restart the sim for it to take effect.`)
  process.exit(0)
}

if (process.argv.includes("--remove")) {
  for (const t of TESTS) {
    const dir = join(COMMUNITY, t.pkg)
    // Only ever our own two test packages, recognized by their manifest.
    if (existsSync(dir) && /Crosscheck p10 camera test/.test(readFileSync(join(dir, "manifest.json"), "utf8"))) { rmSync(dir, { recursive: true }); console.log(`Removed ${t.pkg}.`) }
  }
  if (existsSync(ROOT_BACKUP)) {
    writeFileSync(ROOT_FILE, readFileSync(ROOT_BACKUP))
    console.log("Put the root Cameras.CFG back from its backup; the backup stays in the temp folder, renamed .restored.")
    writeFileSync(`${ROOT_BACKUP}.restored`, readFileSync(ROOT_BACKUP))
    rmSync(ROOT_BACKUP)
  }
  process.exit(0)
}
if (!process.argv.includes("--check")) {
  console.log("Pass --install, --check, --move, or --remove.")
  process.exit(2)
}

// ---------------------------------------------------------------- --check

const up = process.argv.includes("--moved") ? MOVE_UP : 0
const rec = new Recorder("p10-camera-package", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p10-camera-package" })
rec.open()
const beep = startBeeper()
const h = sim.handle
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }
const installed = readdirSync(COMMUNITY).filter((n) => TESTS.some((t) => t.pkg === n))
const hints = installed.map((n) => `${n} hint "${JSON.parse(readFileSync(join(COMMUNITY, n, "manifest.json"), "utf8")).package_order_hint}"`)
note("packages", `Installed in Community: ${hints.join(", ") || "neither test package"}${up ? `; their views moved ${up}m up since boot` : ""}`)
// Where the sim mounted ours and the 58P's, in its running-session report.
try {
  const report = readFileSync(join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "AsoboReport-RunningSession.txt"), "utf8").split(/\r?\n/)
  const at = (name) => report.findIndex((l) => l.startsWith(`${name}=`))
  const order = [...TESTS.map((t) => t.pkg), SOURCE_PKG].map((n) => ({ n, i: at(n) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.n)
  note("packages", `Mount order in the sim's report: ${order.join(", ")}`)
} catch (e) { note("packages", `Mount order: ${e.message}`) }

let definitions = []
h.on("cameraDefinitionList", (l) => { definitions = [...definitions, ...l.cameraDefinitions.map((d) => d.name)] })
sim.send("enumerate camera definitions", () => h.enumerateCameraDefinitions())
await sleep(1200)
const listed = [...TESTS, ROOT].filter((t) => definitions.includes(t.title))
note("simconnect", `SimConnect lists ${definitions.length} definitions; of the test views: ${listed.map((t) => t.title).join(", ") || "none"}`, { definitions })

const status = async () => new Promise((resolve) => { h.once("cameraStatus", (s) => resolve(s.acquiredState)); sim.send("camera get status", () => h.cameraGetStatus()); setTimeout(() => resolve(null), 1500) })
let cp = null
let cpTurnedOff = false
try {
  cp = await connectChasePlane("CROSSCHECK p10-camera-package", { rec })
  await sleep(500)
  const cpViews = (await cp.getViews()).filter((v) => /crosscheck/i.test(v.name)).map((v) => `${v.name} at ${JSON.stringify(v.position)}`)
  note("chaseplane", `ChasePlane's views with Crosscheck in the name: ${cpViews.join("; ") || "none"}`)
  if (cp.state.masterEnabled || (await status()) === 2) { await cp.setMasterEnabled(false); cpTurnedOff = true; await sleep(1500) }
} catch (e) { note("chaseplane", `ChasePlane: ${e.message}`) }

if (listed.length) {
  let waiting = null
  h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
  const eye = async () => {
    const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
    sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
    const c = await got
    return c ? [-c.position.x, c.position.y, c.position.z] : null // SIMOBJECT x points left
  }
  const seat = async (name) => {
    sim.send("camera acquire", () => h.cameraAcquire("CROSSCHECK p10-camera-package"))
    await sleep(300)
    sim.send(`camera release into ${name}`, () => h.cameraRelease(name))
    await sleep(1500)
    return eye()
  }
  const base = await seat("CoPilot")
  const fmt3 = (a) => a.map((v) => (v >= 0 ? "+" : "") + v.toFixed(3)).join(", ")
  for (const t of listed) {
    const asked = t.d.map((v, i) => v + (i === 1 && t !== ROOT ? up : 0))
    const offBy = (e) => Math.hypot(...e.map((v, i) => v - base[i] - asked[i]))
    // While holding: where the view itself is, which shows whether the sim read our current file.
    sim.send("camera acquire", () => h.cameraAcquire("CROSSCHECK p10-camera-package"))
    await sleep(300)
    sim.send(`camera set using ${t.title}`, () => h.cameraSetUsingCameraDefinition(t.title))
    await sleep(1500)
    const held = await eye()
    if (held && base) note("eye", `${t.title}, holding the camera: ${fmt3(held.map((v, i) => v - base[i]))}m from CoPilot, asked ${fmt3(asked)}, off by ${(offBy(held) * 1000).toFixed(0)}mm`, { title: t.title, held, asked })
    // Released into it: whether the sim hands the camera back there.
    sim.send(`camera release into ${t.title}`, () => h.cameraRelease(t.title))
    await sleep(1500)
    const e = await eye()
    const st = await status()
    if (!e || !base) { note("eye", `${t.title}: no reply`); continue }
    note("eye", `${t.title}, released into it: ${fmt3(e.map((v, i) => v - base[i]))}m from CoPilot, off by ${(offBy(e) * 1000).toFixed(0)}mm; camera ${st === 0 ? "NOT_ACQUIRED" : st}`, { title: t.title, released: e, status: st })
    if (offBy(e) < 0.02 && st === 0) {
      beep(1000, 150)
      let lo = Infinity, hi = -Infinity, drift = 0
      for (let s = 1; s <= 10; s++) {
        await sleep(1000)
        const c = await new Promise((resolve) => { h.once("cameraData", (d) => resolve(d.cameraData)); sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT)); setTimeout(() => resolve(null), 1000) })
        if (!c) continue
        lo = Math.min(lo, c.pbh.bank); hi = Math.max(hi, c.pbh.bank) // CameraGet's Bank field carries the yaw
        drift = Math.max(drift, Math.hypot(-c.position.x - e[0], c.position.y - e[1], c.position.z - e[2]))
      }
      beep(500, 600)
      note("hold", `${t.title}, the 10s look test after the release: yaw ${lo.toFixed(0)}° to ${hi.toFixed(0)}°, the eye at most ${(drift * 1000).toFixed(0)}mm from where the release put it`)
    }
  }
  await seat("Pilot")
} else {
  note("eye", "No test view listed, so none was measured")
}
if (cpTurnedOff) { try { await cp.setMasterEnabled(true); note("chaseplane", "Turned ChasePlane back on") } catch (e) { note("chaseplane", `Turning ChasePlane back on failed: ${e.message}`) } }
cp?.close()

const text = [
  "p10 · Camera views from a Community package of our own that shadows the 58P's cameras.cfg, on MSFS 2024",
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
