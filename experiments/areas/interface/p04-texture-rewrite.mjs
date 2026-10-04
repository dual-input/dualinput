/*
 * p04: whether the floating panel's picture can change while the sim runs, by
 * rewriting its texture file, on MSFS 2024.
 *
 * The card shows on CROSSCHECK_P02_Baked as an uncompressed DDS that a Copy
 * asset group ships under the name the compiled model points at
 * (record/areas/interface/log.md, 2026-10-04). If the sim reads that file
 * again, Crosscheck's app could draw any notice as HTML, write it over the
 * file at the same size, and the banner would show it. A file added to the
 * mounted package after Build and Mount didn't show, so this rewrites one the
 * sim already knows.
 *
 * It needs crosscheck-p02-panel built and mounted, with the module running.
 * Nothing to do but look ahead, about 30s:
 *
 *   1  spawn the panel; a screenshot shows the card
 *   2  overwrite the texture with a notice stamped with the time, same size;
 *      screenshots 1s and 5s later show whether the panel changes while up
 *   3  remove the panel and spawn it again; a screenshot shows whether a fresh
 *      spawn reads the new file
 *   4  write the card back
 *
 * It rewrites the file in the package Build and Mount mounted,
 * panel/package/Packages/crosscheck-p02-panel, and in the copy in Community,
 * and notes whether the sim's package builder, which watches the project
 * folder, logged anything in BuilderLogError.txt meanwhile.
 *
 *   node experiments/areas/interface/p04-texture-rewrite.mjs
 *
 * Output: experiments/areas/interface/results/p04-texture-rewrite-<time>.txt
 * with the .ndjson beside it, and the screenshots in the folder of that name.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { InitPosition } from "node-simconnect"

import { startBeeper } from "../../tools/guide.mjs"
import { startShooter } from "../../tools/shot.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { CARD_CSS, HEIGHT, PANEL, WIDTH, noticeMarkup } from "./panel/card.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL_DIR = path.join(HERE, "panel")
const CARD_DIR = path.join(PANEL_DIR, "build", "card")
// --slot writes the notice over the texture of CROSSCHECK_P02_Baked2 instead,
// whose own texture never loaded (our KTX2, which the sim refused), and spawns
// that, to see whether the sim reads a texture file when it first needs it.
// The notice is padded with zeros to that file's size, since layout.json lists
// each file's size.
const SLOT = process.argv.includes("--slot")
const TITLE = SLOT ? "CROSSCHECK_P02_Baked2" : "CROSSCHECK_P02_Baked"
const REL = `SimObjects/Misc/${TITLE}/TEXTURE/CROSSCHECK_P02_CARD.PNG.KTX2`
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p))
const POSE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const L = (n) => [`L:CROSSCHECK_P02_${n}`, "number"]
const LOCKED = { DIST: PANEL.radius, SCALE: 1, DOWN: 0, RIGHT: 0, LEAD: 1, CAM_LEAD: 0, LAZY_S: 0, DEAD_DEG: 0, ROLL: 0, SIGN_PITCH: -1, SIGN_BANK: -1 }
const BUILDER_LOG = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "BuilderLogError.txt")

const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
const packagesLine = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
const TARGETS = [path.join(PANEL_DIR, "package", "Packages", "crosscheck-p02-panel", REL), path.join(packagesLine.match(/"([^"]+)"/)[1], "Community", "crosscheck-p02-panel", REL)].filter((f) => fs.existsSync(f))

const rec = new Recorder("p04-texture-rewrite", { area: "interface" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p04-texture-rewrite" })
rec.open()
const beep = startBeeper()
const shooter = startShooter(path.join(HERE, "results", `p04-texture-rewrite-${rec.when}`))
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }
const setModule = (values) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P02_${k}`, quiet: true }) }
async function shot(name) {
  const s = await shooter.shot(name)
  rec.log("shot", s.error ? `${name}: ${s.error}` : `${name}: ${path.basename(s.file)}, brightness ${s.brightness.toFixed(0)}`, s)
  return s
}

// The notice as an uncompressed DDS, drawn the way build.mjs draws the card:
// headless Edge to a PNG, then panel/tools/png-to-dds.ps1.
function drawNotice(stamp) {
  const html = path.join(CARD_DIR, "notice.html")
  const png = path.join(CARD_DIR, "notice.png")
  const dds = path.join(CARD_DIR, "notice.dds")
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>html, body { margin: 0; background: transparent; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }${CARD_CSS}</style></head><body>${noticeMarkup({ title: "You've lost the connection", body: "Crosscheck keeps trying. Your displays are locked.", stamp })}</body></html>\n`)
  fs.rmSync(png, { force: true })
  spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${png}`, pathToFileURL(html).href], { stdio: "ignore", timeout: 60_000 })
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PANEL_DIR, "tools", "png-to-dds.ps1"), "-In", png, "-Out", dds], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`png-to-dds.ps1: ${r.stderr || r.stdout}`)
  return fs.readFileSync(dds)
}

let object = null
async function spawn() {
  const v = await sim.read(POSE)
  const init = new InitPosition()
  Object.assign(init, { latitude: v.get("PLANE LATITUDE"), longitude: v.get("PLANE LONGITUDE"), altitude: v.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: v.get("PLANE HEADING DEGREES TRUE"), onGround: false, airspeed: 0 })
  const r = await sim.spawn(TITLE, "", init)
  if (r.id === undefined) throw new Error(`${TITLE}: not created: ${r.error}`)
  object = r.id
  for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
  setModule({ ...LOCKED, OBJECT: r.id })
  setModule({ MODE: 1 })
}
async function remove() {
  setModule({ MODE: 0, OBJECT: 0 })
  if (object !== null) sim.remove(object)
  object = null
  await sleep(1000)
}
const writeAll = (bytes) => TARGETS.map((f) => { fs.writeFileSync(f, bytes); return path.relative(PANEL_DIR, f) })

if (!TARGETS.length) { console.error(`No ${REL} in either package: build and mount crosscheck-p02-panel first.`); process.exit(2) }
const original = fs.readFileSync(TARGETS[0])
const logBefore = fs.existsSync(BUILDER_LOG) ? fs.statSync(BUILDER_LOG).mtimeMs : 0
const shown = (f) => (f.startsWith(process.env.APPDATA ?? "\0") ? `%APPDATA%${f.slice(process.env.APPDATA.length)}` : path.relative(PANEL_DIR, f))
note("targets", `rewriting ${TARGETS.length} copies of the texture, ${original.length} bytes each: ${TARGETS.map(shown).join(", ")}`)

try {
  beep(1000, 150)
  if (SLOT) {
    const stamp = new Date().toTimeString().slice(0, 8)
    let notice = drawNotice(stamp)
    if (notice.length > original.length) throw new Error(`the notice is ${notice.length} bytes, more than the slot's ${original.length}`)
    notice = Buffer.concat([notice, Buffer.alloc(original.length - notice.length)])
    writeAll(notice)
    note("rewrite", `wrote the notice drawn at ${stamp} over ${TITLE}'s texture, which never loaded, padded to ${notice.length} bytes, before spawning it`)
    await spawn()
    await sleep(3000)
    await shot("slot-spawned")
    await sleep(3000)
    await shot("slot-spawned-3s-later")
    throw new Error("done")
  }
  await spawn()
  await sleep(3000)
  await shot("1-card")
  const stamp = new Date().toTimeString().slice(0, 8)
  const notice = drawNotice(stamp)
  if (notice.length !== original.length) throw new Error(`the notice is ${notice.length} bytes, the card ${original.length}`)
  writeAll(notice)
  note("rewrite", `wrote the notice drawn at ${stamp} over the texture, ${notice.length} bytes, with the panel up`)
  await sleep(1000)
  await shot("2-rewritten-1s")
  await sleep(4000)
  await shot("3-rewritten-5s")
  await remove()
  await spawn()
  await sleep(3000)
  await shot("4-respawned")
  note("respawn", "removed the panel and spawned it again")
} catch (e) {
  if (e.message !== "done") note("error", e.message)
} finally {
  writeAll(original)
  note("restore", "wrote the card back")
  await remove()
  const logAfter = fs.existsSync(BUILDER_LOG) ? fs.statSync(BUILDER_LOG).mtimeMs : 0
  note("builder", logAfter > logBefore ? "BuilderLogError.txt changed during the run" : "BuilderLogError.txt didn't change during the run")
  beep(500, 600)
}

const text = [
  "p04 · Whether rewriting the floating panel's texture file changes its picture, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines.map((l) => `  ${l}`),
  "",
  "Read the screenshots: 1 the card; 2 and 3 after the rewrite with the panel up; 4 after a fresh spawn.",
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
shooter.close()
sim.close()
await rec.close()
process.exit(0)
