/*
 * A ray caster over an aircraft's cockpit model, in the model's own space:
 * meters, with +x to the left, y up, and z forward (p18,
 * record/areas/avatars/log.md).
 *
 *   const cockpit = loadCockpit([".../PA24_250_INTERIOR_LOD00.gltf"])
 *   const hit = cast(cockpit, origin, direction)   nearest hit or null
 *
 * It hits triangles from either side, and skips invisible ones unless asked:
 * the Comanche wraps its panel and cabin in invisible shells,
 * PANEL_COLLISION 1.6cm in front of the breakers and WINDSHIELD_COLLISION
 * around the pilot's head, which a ray from the eyepoint hits before the
 * control. Nodes are at the pose the file stores, so a lever pulled away from
 * it is hit where it rests.
 */

import { ancestry, apply, readGltf, triangles } from "./gltf.mjs"

export function loadCockpit(files) {
  const models = files.map(readGltf)
  const prims = models.flatMap((m, mi) => triangles(m).map((p) => ({ ...p, model: mi })))
  return { models, prims, triangles: prims.reduce((s, p) => s + p.idx.length / 3, 0) }
}

// Moves the triangles of the given nodes of one model to a new pose, such as
// the yoke posed by lib/animate.mjs: world holds every node's transform.
export function repose(cockpit, modelIndex, world, nodes) {
  for (const p of cockpit.prims) {
    if (p.model !== modelIndex || !nodes.has(p.node)) continue
    const m = world[p.node]
    p.lo = [Infinity, Infinity, Infinity]
    p.hi = [-Infinity, -Infinity, -Infinity]
    for (let v = 0; v < p.local.length; v += 3) {
      const q = apply(m, [p.local[v], p.local[v + 1], p.local[v + 2]])
      for (let k = 0; k < 3; k++) { p.pos[v + k] = q[k]; if (q[k] < p.lo[k]) p.lo[k] = q[k]; if (q[k] > p.hi[k]) p.hi[k] = q[k] }
    }
  }
}

// A node and every node under it.
export function subtree(model, root) {
  const out = new Set([root])
  for (let i = 0; i < model.nodes.length; i++) {
    for (let j = model.parent[i]; j !== -1; j = model.parent[j]) if (out.has(j)) { out.add(i); break }
  }
  return out
}

// The distance along the ray to a box, or Infinity.
function box(o, inv, lo, hi) {
  let t0 = 0, t1 = Infinity
  for (let k = 0; k < 3; k++) {
    let a = (lo[k] - o[k]) * inv[k], b = (hi[k] - o[k]) * inv[k]
    if (a > b) [a, b] = [b, a]
    if (a > t0) t0 = a
    if (b < t1) t1 = b
    if (t0 > t1) return Infinity
  }
  return t0
}

// Möller–Trumbore, both faces.
function triangle(o, d, pos, i0, i1, i2) {
  const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2]
  const e1x = pos[i1 * 3] - ax, e1y = pos[i1 * 3 + 1] - ay, e1z = pos[i1 * 3 + 2] - az
  const e2x = pos[i2 * 3] - ax, e2y = pos[i2 * 3 + 1] - ay, e2z = pos[i2 * 3 + 2] - az
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-12) return Infinity
  const f = 1 / det
  const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az
  const u = f * (sx * px + sy * py + sz * pz)
  if (u < 0 || u > 1) return Infinity
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
  const v = f * (d[0] * qx + d[1] * qy + d[2] * qz)
  if (v < 0 || u + v > 1) return Infinity
  const t = f * (e2x * qx + e2y * qy + e2z * qz)
  return t > 1e-4 ? t : Infinity
}

// skip: nodes, by index into the first model, the ray passes through, such as
// a yoke the sim hides.
export function cast(cockpit, origin, direction, { maxM = 5, invisible = false, skip = null } = {}) {
  const n = Math.hypot(...direction)
  const d = direction.map((x) => x / n)
  const inv = d.map((x) => 1 / x)
  const near = cockpit.prims
    .filter((p) => (invisible || !p.invisible) && !(skip && p.model === 0 && skip.has(p.node)))
    .map((p) => ({ p, t: box(origin, inv, p.lo, p.hi) }))
    .filter((x) => x.t <= maxM)
    .sort((a, b) => a.t - b.t)
  let best = Infinity, hit = null, tri = -1
  for (const { p, t } of near) {
    if (t > best) break
    for (let k = 0; k < p.idx.length; k += 3) {
      const tt = triangle(origin, d, p.pos, p.idx[k], p.idx[k + 1], p.idx[k + 2])
      if (tt < best) { best = tt; hit = p; tri = k }
    }
  }
  if (!hit || best > maxM) return null
  const model = cockpit.models[hit.model]
  return {
    distance: best,
    point: origin.map((x, k) => x + d[k] * best),
    normal: facing(hit.pos, hit.idx[tri], hit.idx[tri + 1], hit.idx[tri + 2], d),
    file: model.name,
    node: hit.node,
    chain: ancestry(model, hit.node),
    invisible: hit.invisible,
  }
}

// The triangle's unit normal, turned to face back along the ray.
function facing(pos, i0, i1, i2, d) {
  const e1 = [0, 1, 2].map((k) => pos[i1 * 3 + k] - pos[i0 * 3 + k])
  const e2 = [0, 1, 2].map((k) => pos[i2 * 3 + k] - pos[i0 * 3 + k])
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const len = Math.hypot(...n)
  const s = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) > 0 ? -1 / len : 1 / len
  return n.map((x) => x * s)
}

// Where the ray crosses the plane through point with this normal, or null
// when it runs along the plane, points away from it, or meets it beyond maxM.
export function crossPlane(origin, direction, point, normal, { maxM = 5 } = {}) {
  const n = Math.hypot(...direction)
  const d = direction.map((x) => x / n)
  const den = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]
  if (Math.abs(den) < 1e-3) return null
  const t = ((point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1] + (point[2] - origin[2]) * normal[2]) / den
  if (t <= 0 || t > maxM) return null
  return origin.map((x, k) => x + d[k] * t)
}
