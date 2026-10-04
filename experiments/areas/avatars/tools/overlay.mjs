/*
 * Draws our copy of an aircraft's cockpit over a screenshot of the sim, to see
 * whether the copy lines up with what the sim draws: the copy's vertices that
 * the camera sees, as cyan dots, projected by p20's ray (lib/pick.mjs) turned
 * around. A copy that hangs in the wrong place shows as a doubled cockpit.
 *
 *   node experiments/areas/avatars/tools/overlay.mjs <package> <x,y,z> <glTF in the package> [more glTF...] [options]
 *
 * x,y,z is where the models' origin hangs in the aircraft, in meters along the
 * model's axes (+x left, y up, z forward): the attach node's position, such as
 * the A350-900's AP_A359_Cockpit, 0,1.418,25.026.
 *
 *   --nodes a,b     draws every vertex of these nodes and the nodes under them
 *                   in magenta, seen or not, to compare one part at a time
 *   --shift x,y,z   draws the copy again, moved by that much, in yellow, and
 *                   the --nodes parts moved too, in orange, to try a guess at
 *                   the error
 *   --redraw f.jpg  draws on a screenshot taken before, from the camera saved
 *                   beside it, without the sim
 *
 * A new screenshot needs the sim's window in front and the view held still:
 * the tool takes the camera before and after the screenshot and tries again,
 * for up to 2 minutes, until the sim is in front and the two agree within 2mm
 * and 0.2°, then beeps. The camera's roll is left out, as in lib/pick.mjs.
 * The screenshot, its camera, and the drawing go to the scratch folder named
 * by CROSSCHECK_OVERLAY_DIR, or the system's temporary folder, since a
 * screenshot can show what shouldn't go in the tree (experiments/tools/shot.mjs).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { open, Protocol } from "node-simconnect"

import { powershell, startBeeper } from "../../../tools/guide.mjs"
import { startShooter } from "../../../tools/shot.mjs"
import { findPackage } from "../../aircraft/lib/flights.mjs"
import { ancestry, readGltf, triangles } from "../lib/gltf.mjs"

const RAD = Math.PI / 180
const SIMOBJECT = 1
// The shooter's JPEG: 1,200 pixels wide with the top 100 cut off.
const JPEG_WIDTH = 1200
const CROP_TOP = 100
// The depth test's grid, in screen pixels per cell, and how far behind the
// nearest surface a vertex may sit and still count as seen.
const CELL_PX = 4
const SEEN_M = 0.015
const USAGE = "usage: node overlay.mjs <package> <x,y,z> <glTF in the package> [more glTF...] [--nodes a,b] [--shift x,y,z] [--redraw f.jpg]"

const args = process.argv.slice(2)
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null }
const shift = option("--shift")?.split(",").map(Number) ?? null
const nodes = new Set(option("--nodes")?.split(",") ?? [])
const redraw = option("--redraw")
const [pkgName, at, ...gltfs] = args
const pkg = pkgName && findPackage(pkgName)
const origin = at?.split(",").map(Number)
if (!pkg || origin?.length !== 3 || origin.some(Number.isNaN) || !gltfs.length || shift?.some(Number.isNaN)) { console.error(USAGE); process.exit(1) }
const dir = process.env.CROSSCHECK_OVERLAY_DIR ?? path.join(os.tmpdir(), "crosscheck-overlay")

// ------------------------------------------------ the camera and the screenshot

async function screenshot() {
  const { handle } = await open("CROSSCHECK overlay", Protocol.SunRise)
  let cam = null
  handle.on("cameraData", (r) => {
    const c = r.cameraData
    if (c.positionReferential !== SIMOBJECT) return
    cam = { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank, fov: c.fov > Math.PI ? c.fov * RAD : c.fov }
  })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const camera = async () => {
    cam = null
    handle.cameraGet(SIMOBJECT)
    for (let i = 0; i < 40 && !cam; i++) await sleep(25)
    return cam
  }
  const still = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.002 && Math.abs(a.pitch - b.pitch) < 0.2 && Math.abs(a.yaw - b.yaw) < 0.2 && Math.abs(a.fov - b.fov) < 0.002
  const shooter = startShooter(dir)
  let shot = null, waiting = false
  for (const end = Date.now() + 120_000; Date.now() < end && !shot;) {
    const before = await camera()
    const s = await shooter.shot("overlay")
    const after = await camera()
    if (s.error) {
      if (!waiting) { console.log(`${s.error}; waiting for it`); waiting = true }
      await sleep(500)
    } else if (still(before, after)) shot = { file: s.file, view: after, W: s.width, H: s.height }
    else console.log("the view moved during the screenshot; trying again")
  }
  shooter.close()
  handle.close()
  if (!shot) { console.error("no still screenshot in 2 minutes"); process.exit(1) }
  startBeeper()(1000, 150)
  fs.writeFileSync(shot.file.replace(/\.jpg$/, ".json"), JSON.stringify(shot))
  return shot
}

const shot = redraw ? { ...JSON.parse(fs.readFileSync(redraw.replace(/\.jpg$/, ".json"), "utf8")), file: redraw } : await screenshot()
const { view, W, H } = shot
console.log(`camera at ${[view.x, view.y, view.z].map((x) => x.toFixed(3)).join(", ")}, pitch ${view.pitch.toFixed(1)}°, yaw ${view.yaw.toFixed(1)}°, fov ${(view.fov / RAD).toFixed(1)}°; window ${W}×${H}`)

// ------------------------------------------------ the copy, projected

// lib/pick.mjs's rayThrough with MEASURED's signs, run backward: a point in
// the aircraft to window pixels and its depth along the view, or null behind.
function project(p) {
  const r = -(p[0] - view.x), u = p[1] - view.y, f = p[2] - view.z
  const y = view.yaw * RAD, q = -view.pitch * RAD
  const f0 = f * Math.cos(y) + r * Math.sin(y), r0 = -f * Math.sin(y) + r * Math.cos(y)
  const f1 = f0 * Math.cos(q) + u * Math.sin(q), u1 = -f0 * Math.sin(q) + u * Math.cos(q)
  if (f1 < 0.05) return null
  const tv = Math.tan(view.fov / 2), th = tv * (W / H)
  return [((r0 / f1 / th) + 1) / 2 * W, (1 - u1 / f1 / tv) / 2 * H, f1]
}
const toJpeg = (s) => [Math.round(s[0] * JPEG_WIDTH / W), Math.round((s[1] - CROP_TOP) * JPEG_WIDTH / W)]
const inView = (s) => s && s[0] >= 0 && s[0] < W && s[1] >= CROP_TOP && s[1] < H

const matched = new Set()
const prims = gltfs.flatMap((g) => {
  const model = readGltf(path.join(pkg, g))
  return triangles(model).map((p) => {
    const hits = ancestry(model, p.node).filter((n) => nodes.has(n))
    for (const n of hits) matched.add(n)
    return { ...p, picked: hits.length > 0 }
  })
}).filter((p) => !p.invisible)
for (const n of nodes) if (!matched.has(n)) console.log(`no mesh under ${n} in the models`)
const GW = Math.ceil(W / CELL_PX), GH = Math.ceil(H / CELL_PX)
const moved = (p, v, offset) => [p.pos[v * 3] + offset[0], p.pos[v * 3 + 1] + offset[1], p.pos[v * 3 + 2] + offset[2]]

// The nearest surface in each cell, from every triangle at its corners' depths.
function depthGrid(offset) {
  const grid = new Float32Array(GW * GH).fill(Infinity)
  for (const p of prims) {
    const n = p.pos.length / 3
    const s = new Array(n)
    for (let v = 0; v < n; v++) s[v] = project(moved(p, v, offset))
    for (let k = 0; k < p.idx.length; k += 3) {
      const a = s[p.idx[k]], b = s[p.idx[k + 1]], c = s[p.idx[k + 2]]
      if (!a || !b || !c) continue
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) / CELL_PX)), x1 = Math.min(GW - 1, Math.floor(Math.max(a[0], b[0], c[0]) / CELL_PX))
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) / CELL_PX)), y1 = Math.min(GH - 1, Math.floor(Math.max(a[1], b[1], c[1]) / CELL_PX))
      if (x1 < x0 || y1 < y0 || (x1 - x0) * (y1 - y0) > 40_000) continue
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
      if (Math.abs(den) < 1e-9) continue
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const px = (gx + 0.5) * CELL_PX, py = (gy + 0.5) * CELL_PX
        const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den
        const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den
        const l3 = 1 - l1 - l2
        if (l1 < 0 || l2 < 0 || l3 < 0) continue
        const z = l1 * a[2] + l2 * b[2] + l3 * c[2]
        const i = gy * GW + gx
        if (z < grid[i]) grid[i] = z
      }
    }
  }
  return grid
}

// The vertices the camera sees, in the JPEG's pixels, at most one per cell.
function seen(offset) {
  const grid = depthGrid(offset)
  const taken = new Uint8Array(GW * GH)
  const out = []
  for (const p of prims) {
    for (let v = 0; v < p.pos.length / 3; v++) {
      const s = project(moved(p, v, offset))
      if (!inView(s)) continue
      const i = Math.floor(s[1] / CELL_PX) * GW + Math.floor(s[0] / CELL_PX)
      if (taken[i] || s[2] > grid[i] + SEEN_M) continue
      taken[i] = 1
      out.push(toJpeg(s))
    }
  }
  return out
}

// Every vertex of the picked parts, seen or not.
function picked(offset) {
  const out = []
  for (const p of prims) {
    if (!p.picked) continue
    for (let v = 0; v < p.pos.length / 3; v++) {
      const s = project(moved(p, v, offset))
      if (inView(s)) out.push(toJpeg(s))
    }
  }
  return out
}

const shifted = shift && origin.map((x, k) => x + shift[k])
const layers = [{ color: "Cyan", size: 2, points: seen(origin) }]
if (shifted) layers.push({ color: "Yellow", size: 2, points: seen(shifted) })
if (nodes.size) layers.push({ color: "Magenta", size: 2, points: picked(origin) })
if (nodes.size && shifted) layers.push({ color: "Orange", size: 2, points: picked(shifted) })
for (const l of layers) console.log(`${l.color}: ${l.points.length} points`)

// ------------------------------------------------ the drawing

const tag = [nodes.size ? "nodes" : "", shift ? `shift-${shift.join("_")}` : ""].filter(Boolean).join("-")
const pointsFile = path.join(dir, "overlay-points.json")
fs.writeFileSync(pointsFile, JSON.stringify(layers))
const out = shot.file.replace(/\.jpg$/, `-overlay${tag ? `-${tag}` : ""}.png`)
const DRAW_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Drawing
$layers = Get-Content -Raw '${pointsFile}' | ConvertFrom-Json
$img = [System.Drawing.Image]::FromFile('${shot.file}')
$bmp = New-Object System.Drawing.Bitmap $img
$img.Dispose()
$g = [System.Drawing.Graphics]::FromImage($bmp)
foreach ($l in $layers) {
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromName($l.color))
  foreach ($p in $l.points) { $g.FillRectangle($brush, $p[0] - 1, $p[1] - 1, $l.size, $l.size) }
}
$g.Dispose()
$bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`
await new Promise((resolve) => powershell(DRAW_PS, ["ignore", "ignore", "inherit"]).on("exit", resolve))
console.log(out)
process.exit(0)
