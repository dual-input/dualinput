/*
 * p02: what an object of our own can show as Crosscheck's floating panel, held
 * in front of the pilot's view, on MSFS 2024: which kinds of HTML surface the
 * sim runs on an object that isn't the pilot's aircraft.
 *
 * It needs crosscheck-p02-panel built (interface/panel/build.mjs) and mounted
 * with the Project Editor's Build and Mount. The module in it,
 * crosscheck-p02-panel, places one object every frame from the camera's pose
 * relative to the aircraft (panel/src/panel.cpp), 35cm ahead of the eye.
 *
 * One object at a time, about 15s each, with nothing to do but look ahead.
 * What each carries changes from round to round (panel/build.mjs, OBJECTS,
 * and SURFACES below): in round 1, gauge, painted, and tablet are livery
 * paintings with different locations, materials, and calls, and baked is the
 * card's PNG beside the model. For each, the probe lists the inspector's
 * pages on 127.0.0.1:19999 and takes a screenshot, and for a painting reads
 * its document's frames and redraws and takes a second screenshot 4s later,
 * to see whether the panel follows the painting's clock. The sim window must
 * be in front and uncovered.
 *
 *   node experiments/areas/interface/p02-floating-panel.mjs
 *   node experiments/areas/interface/p02-floating-panel.mjs --only painted
 *   node experiments/areas/interface/p02-floating-panel.mjs --clicks painted
 *
 * --clicks holds that surface up for 30s after Page Down: hold the view
 * still, click Start flying three times, then twice on the card away from the
 * button, then once off the card, and note whether anything behind the panel
 * moved. Each click's ray (the cursor, and CameraGet's field of view as the
 * view's height, as p20 measured in record/areas/avatars/log.md) is mapped onto
 * the card, which the module keeps straight ahead of the eye, and the gauge
 * and the painting count any press that reaches them.
 *
 * Output: experiments/areas/interface/results/p02-floating-panel-<time>.txt
 * with the .ndjson beside it, and the screenshots in the folder of that name.
 */

import path from "node:path"
import { fileURLToPath } from "node:url"

import { InitPosition, PositionReferential } from "node-simconnect"

import { startBeeper, startKeys } from "../../tools/guide.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { startMouse } from "../../tools/mouse.mjs"
import { startShooter } from "../../tools/shot.mjs"
import { Recorder, fmt, plural, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { BUTTON, HEIGHT, PANEL, WIDTH } from "./panel/card.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RAD = Math.PI / 180
const CLICK_MS = 30_000
const POSE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const L = (n) => [`L:CROSSCHECK_P02_${n}`, "number"]
// Locked to the view at the panel's curve's radius, led as the seated figure
// is (record/areas/avatars/log.md, p15 and p16).
const LOCKED = { DIST: PANEL.radius, SCALE: 1, DOWN: 0, RIGHT: 0, LEAD: 1, CAM_LEAD: 0, LAZY_S: 0, DEAD_DEG: 0, ROLL: 0, SIGN_PITCH: -1, SIGN_BANK: -1 }
// What each object carries this round: panel/build.mjs, OBJECTS.
// Round 2; the aircraft goes last, in case spawning it takes the sim down.
const ROUND_PAINTING = "exterior, see-through, RegistrationNumberLoaded"
const SURFACES = {
  baked: { title: "CROSSCHECK_P02_Baked" },
  baked2: { title: "CROSSCHECK_P02_Baked2" },
  static: { title: "CROSSCHECK_P02_PaintStatic", painting: `StaticObject, ${ROUND_PAINTING}` },
  boat: { title: "CROSSCHECK_P02_PaintBoat", painting: `Boat, ${ROUND_PAINTING}` },
  vehicle: { title: "CROSSCHECK_P02_PaintVehicle", painting: `GroundVehicle, ${ROUND_PAINTING}` },
  viewer: { title: "CROSSCHECK_P02_PaintViewer", painting: `Viewer, ${ROUND_PAINTING}` },
  human: { title: "CROSSCHECK_P02_PaintHuman", painting: `Human, ${ROUND_PAINTING}` },
  aircraft: { title: "CROSSCHECK_P02_Aircraft", painting: `an aircraft of ours, ${ROUND_PAINTING}`, aircraft: true },
}
const arg = (flag) => { const i = process.argv.indexOf(flag); return i === -1 ? null : process.argv[i + 1] }
const only = arg("--only")
const clickOn = arg("--clicks")
for (const s of [only, clickOn]) if (s && !SURFACES[s]) { console.error(`No surface ${JSON.stringify(s)}: ${Object.keys(SURFACES).join(", ")}`); process.exit(2) }

const rec = new Recorder("p02-floating-panel", { area: "interface" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p02-floating-panel" })
rec.open()
const beep = startBeeper()
const shooter = startShooter(path.join(HERE, "results", `p02-floating-panel-${rec.when}`))
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P02_${n}`) ?? null]))
}
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P02_${k}`, quiet: true }) }
async function shot(name) {
  const s = await shooter.shot(name)
  rec.log("shot", s.error ? `${name}: ${s.error}` : `${name}: ${path.basename(s.file)}, brightness ${s.brightness.toFixed(0)}`, s)
  return s
}

let object = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  const m = await readModule(["FRAMES", "ERRORS", "LAST_ERROR"]).catch(() => null)
  setModule({ MODE: 0, OBJECT: 0 })
  if (object !== null) sim.remove(object)
  await sleep(800)
  if (m && m.FRAMES !== null) note("module", `the module wrote the panel in ${plural(m.FRAMES ?? 0, "frame")}, with ${plural(m.ERRORS ?? 0, "error")}${m.ERRORS ? ` (last ${fmt(m.LAST_ERROR)})` : ""}`)
  const text = [
    "p02 · What an object of our own can show as a floating panel in front of the pilot's view, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Ended by ${why}`,
    "",
    ...lines.map((l) => `  ${l}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  shooter.close()
  sim.close()
  await rec.close()
  process.exit(0)
}
process.on("SIGINT", () => finish("Ctrl+C"))

// Spawned at the aircraft and frozen, then carried by the module, as p25
// carries the figure.
async function hold(title, { aircraft = false } = {}) {
  const v = await sim.read(POSE)
  const init = new InitPosition()
  Object.assign(init, { latitude: v.get("PLANE LATITUDE"), longitude: v.get("PLANE LONGITUDE"), altitude: v.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: v.get("PLANE HEADING DEGREES TRUE"), onGround: false, airspeed: 0 })
  const r = await sim.spawn(title, "", init)
  if (r.id === undefined) {
    note("spawn", `${title}: not created: ${r.error}. Is crosscheck-p02-panel built and mounted?`)
    return null
  }
  object = r.id
  // An AI aircraft is flown by the sim's AI unless released, as p24 releases
  // the figure (experiments/areas/avatars/p24-figure.mjs).
  if (aircraft) sim.release(r.id)
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  setModule({ ...LOCKED, OBJECT: r.id })
  setModule({ MODE: 1 })
  return r.id
}
async function drop() {
  setModule({ MODE: 0, OBJECT: 0 })
  if (object !== null) sim.remove(object)
  object = null
  await sleep(600)
}

let waiting = null
sim.handle.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function camera() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => sim.handle.cameraGet(PositionReferential.SIMOBJECT))
  return got
}

// ------------------------------------------------ setup

const a0 = (await readModule(["ALIVE"])).ALIVE
await sleep(600)
const a1 = (await readModule(["ALIVE"])).ALIVE
if (!(a0 !== null && a1 !== null && a1 > a0)) {
  note("module", `crosscheck-p02-panel isn't running: ALIVE read ${fmt(a0)} then ${fmt(a1)}; Build and Mount the package`)
  await finish("the module not running")
}
note("module", `crosscheck-p02-panel is running: ALIVE went from ${fmt(a0)} to ${fmt(a1)} in 0.6s`)
const aircraft = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(aircraft)}`)
setModule({ ...LOCKED, MODE: 0, ERRORS: 0, FRAMES: 0, GAUGE_FRAMES: 0, GAUGE_CLICKS: 0, PAINT_FRAMES: 0, PAINT_CAPTURES: 0, PAINT_CLICKS: 0 })

// ------------------------------------------------ the surfaces

async function surface(name) {
  const s = SURFACES[name]
  beep(1000, 150)
  const pagesBefore = (await listPages().catch(() => [])).map((p) => String(p.title ?? ""))
  if ((await hold(s.title, { aircraft: s.aircraft })) === null) return
  await sleep(3000)
  const facts = []
  if (s.painting) facts.push(`painting: ${s.painting}`)
  try {
    const after = (await listPages()).map((p) => String(p.title ?? ""))
    const added = after.filter((t) => after.filter((x) => x === t).length > pagesBefore.filter((x) => x === t).length)
    facts.push(`the inspector lists ${plural(after.length, "page")}${added.length ? `, added since it appeared: ${[...new Set(added)].map((t) => JSON.stringify(t)).join(", ")}` : ", none added since it appeared"}`)
    rec.data("pages", name, { titles: after })
  } catch (e) {
    facts.push(`the inspector didn't answer: ${e.message.split("\n")[0]}`)
  }
  await shot(name)
  if (s.painting) {
    const a = await paintingState()
    await sleep(4000)
    await shot(`${name}-4s-later`)
    const b = await paintingState()
    facts.push(a.error ? `its document couldn't be read: ${a.error}` : `its document, ${a.title}: ${a.frames} frames and ${a.captures} redraws at the first screenshot, ${b.frames} and ${b.captures} at the second`)
  }
  note(name, `${s.title}: ${facts.join("; ")}`)
}

// The newest painting document's own state, through the inspector: a removed
// object's painting stays open (p02, 2026-10-04), so the newest is the one with
// the highest VLivery number.
async function paintingState() {
  let insp = null
  try {
    const number = (p) => Number((String(p.title).match(/^VLivery(\d+)/) ?? [0, -1])[1])
    const page = (await listPages()).filter((p) => /CrosscheckP02Painting/.test(String(p.title ?? ""))).sort((a, b) => number(b) - number(a))[0]
    if (!page) return { error: "no page titled CrosscheckP02Painting" }
    insp = await new Inspector(page.id).open()
    const state = await insp.evaluate(`(function () { var el = document.querySelector("vlivery-panel") && document.querySelector("vlivery-panel").firstElementChild; return JSON.stringify({ title: document.title, frames: el ? el.frames : null, captures: el ? el.captures : null, capture: el ? el.capture : null }) })()`)
    rec.data("painting", page.title, JSON.parse(state))
    return JSON.parse(state)
  } catch (e) {
    return { error: e.message.split("\n")[0] }
  } finally {
    insp?.close()
  }
}

// Where a click's ray meets the card, in the card's pixels, with the panel
// locked straight ahead of the eye at its curve's radius: the ray in the
// view's own frame (forward 1, right r, up u), its angle around the curve
// giving the column and its height where it meets the curve giving the row.
function onCard(m, fov) {
  const tv = Math.tan(fov / 2), th = tv * (m.width / m.height)
  const r = m.x * th, u = m.y * tv
  const across = 0.5 + (Math.atan2(r, 1) * PANEL.radius) / PANEL.width
  const down = 0.5 - (u * PANEL.radius / Math.hypot(1, r)) / PANEL.height
  const px = across * WIDTH, py = down * HEIGHT
  const where = px >= BUTTON.left && px <= BUTTON.left + BUTTON.width && py >= BUTTON.top && py <= BUTTON.top + BUTTON.height
    ? "Start flying"
    : across >= 0 && across <= 1 && down >= 0 && down <= 1 ? "the card" : "off the card"
  return { px, py, where }
}

async function clicks(name) {
  if ((await hold(SURFACES[name].title)) === null) return
  const keys = await startKeys()
  console.log("\nPage Down starts 30s of clicks.")
  let k = await keys.next()
  while (k.key !== "START") k = await keys.next()
  beep(1000, 150)
  const c = await camera()
  const fov = c ? c.fov : null
  const before = await readModule(["GAUGE_CLICKS", "PAINT_CLICKS"])
  const hits = []
  const stop = await startMouse((m) => {
    if (m.kind !== "left" || !fov) return
    const h = { ...onCard(m, fov), x: m.x, y: m.y, width: m.width, height: m.height, foreground: m.foreground }
    hits.push(h)
    rec.log("click", `${h.where}, at card pixel ${h.px.toFixed(0)}, ${h.py.toFixed(0)}${m.foreground ? "" : " (the sim wasn't in front)"}`, h)
  })
  await sleep(CLICK_MS)
  stop()
  beep(500, 600)
  const after = await readModule(["GAUGE_CLICKS", "PAINT_CLICKS"])
  const count = (w) => hits.filter((h) => h.where === w).length
  note("clicks", `${SURFACES[name].title}: ${plural(hits.length, "click")} with the field of view at ${fov ? fmt(fov / RAD) : "?"}°: ${count("Start flying")} on Start flying, ${count("the card")} on the rest of the card, ${count("off the card")} off it; the gauge counted ${plural((after.GAUGE_CLICKS ?? 0) - (before.GAUGE_CLICKS ?? 0), "press", "presses")} and the painting ${plural((after.PAINT_CLICKS ?? 0) - (before.PAINT_CLICKS ?? 0), "press", "presses")}`, { hits })
}

if (clickOn) {
  await clicks(clickOn)
} else {
  for (const name of only ? [only] : Object.keys(SURFACES)) {
    await surface(name)
    await drop()
  }
  beep(500, 600)
}
await finish(clickOn ? "the end of the clicks" : "the end of the surfaces")
