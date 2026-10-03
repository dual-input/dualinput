/*
 * Maps an aircraft's cockpit controls to where they are in its model: each
 * interactive behavior component, the input event it uses, the node it names,
 * and that node's position in the model's own space, in meters.
 *
 *   node experiments/areas/avatars/tools/controls.mjs <model folder> <behavior.xml> <lod00.gltf> [more.gltf...]
 *
 * For example, for the A2A Comanche, from its package's common/model folder:
 *
 *   node experiments/areas/avatars/tools/controls.mjs "<Community>/a2a-aircraft-pa24/SimObjects/Airplanes/pa24-250/common/model" PA24_250_INTERIOR.xml PA24_250_INTERIOR_LOD00.gltf PA24_250_LOD00.gltf
 *
 * The route is the one a subagent traced by hand in a2a-aircraft-pa24 2.1.3:
 * PA24_250_INTERIOR.xml's <Component ID="SWITCH_avionics_master"
 * Node="ELECTRICAL_Switch_Avionics_Master"> uses <UseInputEvent
 * ID="SWITCH_avionics_master"/>, and that node is in PA24_250_INTERIOR_LOD00.gltf,
 * placed by its parents' transforms. It also reports the seat nodes PILOT_1
 * and PILOT_2, which the Comanche's navigation graph names for its seat
 * objects, so a run in the sim can tie the model's space to SimConnect's.
 *
 * Node names are matched without case, since the XML and the glTF differ in
 * case. A component whose node comes from a template it uses is reported as
 * unresolved: expanding templates is a later step.
 *
 * The output is a JSON file in experiments/sim-sources/avatars/, which
 * .gitignore keeps out of the tree, since it's drawn from another developer's
 * files.
 */

import fs from "node:fs"
import path from "node:path"

import { simSourcesDir } from "../../../tools/results.mjs"

const [folder, xmlName, ...gltfNames] = process.argv.slice(2)
if (!folder || !xmlName || !gltfNames.length) {
  console.error("usage: node controls.mjs <model folder> <behavior.xml> <lod00.gltf> [more.gltf...]")
  process.exit(1)
}

// Column-major 4x4 matrices, as glTF stores them.
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a, b) {
  const r = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]
  return r
}
function local(n) {
  if (n.matrix) return n.matrix.slice()
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]
  return mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1], mul(R, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]))
}
const apply = (m, p) => [0, 1, 2].map((r) => m[12 + r] + m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2])
const round = (v) => v.map((x) => Math.round(x * 1000) / 1000)

// Every node of every glTF, by lower-case name: where its origin is, and the
// center of its mesh's bounds, if it has a mesh.
const nodes = new Map()
for (const name of gltfNames) {
  const g = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"))
  const list = g.nodes ?? []
  const parent = new Array(list.length).fill(-1)
  list.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)))
  list.forEach((n, i) => {
    if (!n.name || nodes.has(n.name.toLowerCase())) return
    let m = ident()
    const chain = []
    for (let j = i; j !== -1; j = parent[j]) chain.unshift(j)
    for (const j of chain) m = mul(m, local(list[j]))
    let center = null
    if (n.mesh !== undefined) {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      for (const p of g.meshes[n.mesh].primitives) {
        const a = g.accessors[p.attributes.POSITION]
        if (a?.min) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]) }
      }
      if (Number.isFinite(lo[0])) center = round(apply(m, lo.map((v, k) => (v + hi[k]) / 2)))
    }
    nodes.set(n.name.toLowerCase(), { name: n.name, file: name, origin: round(apply(m, [0, 0, 0])), center })
  })
}

// The interactive components: each one's ID, node, and input event.
const xml = fs.readFileSync(path.join(folder, xmlName), "utf8")
const controls = []
const unresolved = []
for (const part of xml.split(/<Component\b/).slice(1)) {
  const head = part.slice(0, part.indexOf(">") + 1)
  const body = part.split(/<\/Component>/)[0]
  if (!/TOOLTIP|MouseRect|MOUSEFLAGS|INTERACTION_TYPE|UseInputEvent|INPUT_EVENT_ID/i.test(body)) continue
  const id = head.match(/ID="([^"]+)"/)?.[1] ?? null
  const node = head.match(/Node="([^"]+)"/)?.[1] ?? body.match(/<NODE_ID>([^<#]+)<\/NODE_ID>/)?.[1] ?? body.match(/<MOUSERECT_HIGHLIGHT_NODE_ID>([^<#]+)</)?.[1] ?? null
  const inputEvent = body.match(/UseInputEvent ID="([^"]+)"/)?.[1] ?? body.match(/<USE_INPUT_EVENT_ID>([^<]+)</)?.[1] ?? body.match(/<INPUT_EVENT_ID_SOURCE>([^<]+)</)?.[1] ?? null
  const found = node ? nodes.get(node.toLowerCase()) : null
  if (!found) { unresolved.push({ id, node, inputEvent }); continue }
  controls.push({ id, inputEvent, node: found.name, file: found.file, origin: found.origin, center: found.center })
}

const seats = Object.fromEntries(["PILOT_1", "PILOT_2"].map((n) => [n, nodes.get(n.toLowerCase()) ?? null]))
const out = { folder: path.basename(path.resolve(folder, "..", "..")), xml: xmlName, gltf: gltfNames, seats, controls, unresolved }
const dir = simSourcesDir("avatars")
const file = path.join(dir, `controls-${out.folder}.json`)
fs.writeFileSync(file, JSON.stringify(out, null, 1))
console.log(`${controls.length} controls placed, ${controls.filter((c) => c.inputEvent).length} with an input event; ${unresolved.length} unresolved`)
console.log(`seats: ${Object.entries(seats).map(([k, v]) => `${k} ${v ? `${v.file} origin ${v.origin.join(", ")}` : "not found"}`).join("; ")}`)
for (const c of controls.filter((x) => x.inputEvent).slice(0, 12)) console.log(`  ${c.inputEvent.padEnd(32)} ${c.node.padEnd(40)} ${(c.center ?? c.origin).join(", ")}`)
console.log(`written to experiments/sim-sources/avatars/${path.basename(file)}`)
