/*
 * What an aircraft package marks for a hand on its flight controls: the [VR]
 * section of each .cfg, which names the yoke node and its two animations in
 * the aircraft that have one; the HANDLING_ hand nodes in its glTF models,
 * which the yoke hand holds (record/areas/avatars/decisions.md); and the nodes
 * and animations whose names say stick or joystick, for a sidestick's grip.
 *
 *   node experiments/areas/avatars/tools/grips.mjs [package...]
 *
 * With no package named, it reads every installed package that has
 * SimObjects/Airplanes. Of a model's levels of detail it reads only the most
 * detailed, the file named _LOD00 or with no LOD number. It reads files only;
 * the sim needn't run.
 */

import fs from "node:fs"
import path from "node:path"

import { dirs, findPackage, packageRoots } from "../../aircraft/lib/flights.mjs"

const ANCHOR = /^HANDLING_.*(Hand|Wheel_Center)|_Hand_(Left|Right)$/i
// "Sticker" and "Decal" are labels on the panels, and "Priority" and "Shaker"
// are the A220's sidestick priority buttons and the stick shaker.
const STICK = /stick|joy/i
const NOT_STICK = /sticker|decal|priority|shaker/i

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const lodOf = (f) => Number(path.basename(f).match(/_LOD(\d+)\.gltf$/i)?.[1] ?? 0)
const modelKey = (f) => path.join(path.dirname(f), path.basename(f).replace(/_LOD\d+(?=\.gltf$)/i, "")).toLowerCase()

function report(pkgDir) {
  const name = path.basename(pkgDir)
  const manifest = path.join(pkgDir, "manifest.json")
  const version = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")).package_version : "?"
  const files = walk(path.join(pkgDir, "SimObjects"))
  const rel = (f) => path.relative(pkgDir, f).replace(/\\/g, "/")
  console.log(`\n== ${name} ${version}`)

  for (const f of files.filter((f) => /\.cfg$/i.test(f))) {
    const text = fs.readFileSync(f, "latin1")
    const vr = text.match(/^\s*\[VR\][^\n]*\n([\s\S]*?)(?=^\s*\[|(?![\s\S]))/im)
    if (!vr) continue
    const lines = vr[1].split(/\r?\n/).map((l) => l.replace(/;.*$/, "").trim()).filter(Boolean)
    console.log(`  [VR] in ${rel(f)}: ${lines.length ? lines.join(" | ") : "empty"}`)
  }

  const best = new Map()
  for (const f of files.filter((f) => /\.gltf$/i.test(f))) {
    const k = modelKey(f)
    if (!best.has(k) || lodOf(f) < lodOf(best.get(k))) best.set(k, f)
  }
  if (!best.size) console.log("  no glTF on disk")
  let shown = 0
  for (const f of [...best.values()].sort()) {
    let g
    try { g = JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) { console.log(`  ${rel(f)}: unreadable, ${e.message}`); continue }
    const nodes = (g.nodes ?? []).map((n) => n.name ?? "")
    const anchors = nodes.filter((n) => ANCHOR.test(n))
    const sticks = nodes.filter((n) => STICK.test(n) && !NOT_STICK.test(n))
    const anims = (g.animations ?? []).map((a) => a.name ?? "").filter((n) => STICK.test(n) && !NOT_STICK.test(n))
    if (!anchors.length && !sticks.length && !anims.length) continue
    shown++
    console.log(`  ${rel(f)}`)
    if (anchors.length) console.log(`    hand nodes: ${anchors.join(", ")}`)
    if (sticks.length) console.log(`    stick nodes: ${sticks.join(", ")}`)
    if (anims.length) console.log(`    stick animations: ${anims.join(", ")}`)
  }
  if (best.size && !shown) console.log(`  no hand or stick nodes in ${best.size} models`)
}

const named = process.argv.slice(2)
const packages = named.length
  ? named.map((n) => findPackage(n) ?? (console.error(`no installed package ${n}`), null)).filter(Boolean)
  : packageRoots().flatMap((r) => dirs(r).map((d) => path.join(r, d))).filter((d) => fs.existsSync(path.join(d, "SimObjects", "Airplanes")))
for (const p of packages) report(p)
