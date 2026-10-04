/*
 * Where a sidestick's grip is across the stick's travel: for each node named,
 * the nodes above and below it, what its two animations move, the size of its
 * mesh, and where its origin and the center and top of its mesh sit at the
 * start, middle, and end of each animation (lib/animate.mjs). Positions are in
 * the model's space, meters, +x left, y up, z forward.
 *
 *   node experiments/areas/avatars/tools/stick.mjs <package> <glTF in the package> <node>=<roll animation>,<pitch animation> [...]
 *
 * For example, for the Synaptic A220's two sticks:
 *
 *   node experiments/areas/avatars/tools/stick.mjs synaptic-aircraft-a220 SimObjects/Airplanes/Synaptic_A220/attachments/inibuilds/Part_Interior_A223_Cockpit/model/A220_Cockpit_LOD00.gltf CPT_STICK_HANDLE=SIDE_STICK_ROLL_CPT,SIDE_STICK_PITCH_CPT FO_STICK_HANDLE=SIDE_STICK_ROLL_FO,SIDE_STICK_PITCH_FO
 *
 * The middle of an animation is the stick's center only where the aircraft's
 * code maps center there: the A220's Sidestick.xml plays each from
 * "(L:A22X L Sidestick X, Percent) neg 2 / 50 +" (synaptic-aircraft-a220 1.0.10).
 * It reads files only; the sim needn't run.
 */

import path from "node:path"

import { findPackage } from "../../aircraft/lib/flights.mjs"
import { findAnimation, poseAt } from "../lib/animate.mjs"
import { ancestry, apply, readGltf } from "../lib/gltf.mjs"

const [pkgName, gltfPath, ...specs] = process.argv.slice(2)
const pkg = pkgName && findPackage(pkgName)
if (!pkg || !gltfPath || !specs.length) {
  console.error("usage: node stick.mjs <package> <glTF in the package> <node>=<roll animation>,<pitch animation> [...]")
  process.exit(1)
}
const model = readGltf(path.join(pkg, gltfPath))
const { g, nodes } = model
const fmt = (p) => p.map((x) => x.toFixed(3).padStart(7)).join(", ")
const cm = (a, b) => `${(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100).toFixed(1)}cm`

// A mesh's bounds in its node's own space, from its POSITION accessors.
function bounds(i) {
  const mesh = nodes[i].mesh != null ? g.meshes[nodes[i].mesh] : null
  if (!mesh) return null
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const p of mesh.primitives) {
    const acc = g.accessors[p.attributes.POSITION]
    lo = lo.map((v, k) => Math.min(v, acc.min[k]))
    hi = hi.map((v, k) => Math.max(v, acc.max[k]))
  }
  return { lo, hi }
}

console.log(`${path.basename(pkg)}, ${model.name}`)
for (const spec of specs) {
  const [name, anims = ""] = spec.split("=")
  const i = nodes.findIndex((n) => n.name === name)
  if (i < 0) { console.log(`\n== no node ${name}`); continue }
  console.log(`\n== ${name}, node ${i}: ${ancestry(model, i).join(" < ")}`)
  const below = (j, depth) => (nodes[j].children ?? []).forEach((c) => { console.log(`${"  ".repeat(depth)}under it: ${nodes[c].name}${nodes[c].mesh != null ? " (mesh)" : ""}`); below(c, depth + 1) })
  below(i, 1)
  const [roll, pitch] = anims.split(",").map((a) => (a ? findAnimation(g, a) : null))
  anims.split(",").forEach((a, k) => { if (a && ![roll, pitch][k]) console.log(`  no animation ${a}`) })
  for (const a of [roll, pitch].filter(Boolean)) {
    console.log(`  ${a.name} moves ${[...new Set(a.channels.map((c) => `${nodes[c.target.node].name}.${c.target.path}`))].join(", ")}`)
  }
  const b = bounds(i)
  if (b) console.log(`  mesh ${fmt(b.hi.map((v, k) => v - b.lo[k]))} m across`)
  const center = b && b.lo.map((v, k) => (v + b.hi[k]) / 2)
  const top = b && [center[0], b.hi[1], center[2]]
  const at = (r, p) => {
    const world = poseAt(model, [roll && { animation: roll, frame: r }, pitch && { animation: pitch, frame: p }].filter(Boolean))
    return { origin: apply(world[i], [0, 0, 0]), center: b && apply(world[i], center), top: b && apply(world[i], top) }
  }
  const mid = at(50, 50)
  for (const [r, p, label] of [[50, 50, "middle"], [0, 50, "roll start"], [100, 50, "roll end"], [50, 0, "pitch start"], [50, 100, "pitch end"]]) {
    const s = at(r, p)
    const moved = label === "middle" ? "" : ` | top moved ${cm(s.top ?? s.origin, mid.top ?? mid.origin)}`
    console.log(`  ${label.padEnd(11)}: origin ${fmt(s.origin)}${b ? ` | center ${fmt(s.center)} | top ${fmt(s.top)}` : ""}${moved}`)
  }
}
