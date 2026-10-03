/*
 * Reading an aircraft's compiled glTF: where each node sits in the model's own
 * space, in meters, and the triangles of its meshes.
 *
 * MSFS's compiled glTF is plain glTF 2.0 underneath its ASOBO_ extensions: in
 * a2a-aircraft-pa24 2.1.3, PA24_250_INTERIOR_LOD00.gltf keeps float32 VEC3
 * positions in interleaved buffer views (stride 36 or 48) and uint16 indices,
 * one accessor of each per primitive, all in one .bin.
 */

import fs from "node:fs"
import path from "node:path"

// Column-major 4x4 matrices, as glTF stores them.
export const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export function mul(a, b) {
  const r = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]
  return r
}
export function local(n) {
  if (n.matrix) return n.matrix.slice()
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]
  return mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1], mul(R, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]))
}
export const apply = (m, p) => [0, 1, 2].map((r) => m[12 + r] + m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2])

// The inverse of a transform that rotates, scales, and moves, as a node's do:
// the 3x3 part inverted by its cofactors, and the translation carried back.
export function invert(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det)
  const t = [m[12], m[13], m[14]]
  const u = [0, 1, 2].map((row) => -(r[row * 3] * t[0] + r[row * 3 + 1] * t[1] + r[row * 3 + 2] * t[2]))
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, u[0], u[1], u[2], 1]
}

// One glTF file: its JSON, each node's parent, and each node's transform to the
// model's space, composed down from the root.
export function readGltf(file) {
  const g = JSON.parse(fs.readFileSync(file, "utf8"))
  const nodes = g.nodes ?? []
  const parent = new Array(nodes.length).fill(-1)
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)))
  const world = nodes.map((n, i) => {
    const chain = []
    for (let j = i; j !== -1; j = parent[j]) chain.unshift(j)
    return chain.reduce((m, j) => mul(m, local(nodes[j])), ident())
  })
  return { file, name: path.basename(file), g, nodes, parent, world }
}

// The names from a node up to the root, the node's own first.
export function ancestry(model, i) {
  const out = []
  for (let j = i; j !== -1; j = model.parent[j]) if (model.nodes[j].name) out.push(model.nodes[j].name)
  return out
}

// Every triangle of every node that has a mesh, turned into the model's space:
// per primitive, the node, its vertices as x, y, z floats, the same vertices in
// the node's own space (local), its indices, its bounds, and whether its
// material is invisible (ASOBO_material_invisible).
export function triangles(model) {
  const { g, nodes, world } = model
  const bin = fs.readFileSync(path.join(path.dirname(model.file), g.buffers[0].uri))
  const out = []
  nodes.forEach((n, i) => {
    if (n.mesh === undefined || n.skin !== undefined) return
    for (const p of g.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4 || p.indices === undefined) continue
      const pa = g.accessors[p.attributes.POSITION]
      const pv = g.bufferViews[pa.bufferView]
      if (pa.componentType !== 5126 || pa.type !== "VEC3") continue
      const stride = pv.byteStride ?? 12
      const base = (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0)
      const m = world[i]
      const pos = new Float32Array(pa.count * 3)
      const own = new Float32Array(pa.count * 3)
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      for (let v = 0; v < pa.count; v++) {
        const o = base + v * stride
        const p = [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]
        const q = apply(m, p)
        for (let k = 0; k < 3; k++) { own[v * 3 + k] = p[k]; pos[v * 3 + k] = q[k]; if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k] }
      }
      const ia = g.accessors[p.indices]
      const iv = g.bufferViews[ia.bufferView]
      const ibase = (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0)
      const idx = new Uint32Array(ia.count)
      for (let k = 0; k < ia.count; k++) idx[k] = ia.componentType === 5125 ? bin.readUInt32LE(ibase + k * 4) : ia.componentType === 5121 ? bin.readUInt8(ibase + k) : bin.readUInt16LE(ibase + k * 2)
      const material = p.material !== undefined ? g.materials?.[p.material] : null
      out.push({ node: i, pos, local: own, idx, lo, hi, invisible: !!material?.extensions?.ASOBO_material_invisible })
    }
  })
  return out
}
