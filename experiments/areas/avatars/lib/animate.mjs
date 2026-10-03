/*
 * Posing an aircraft's compiled glTF the way its behavior XML would: each
 * animation set to a frame, and every node's transform to the model's space
 * composed again from the sampled translations, rotations, and scales.
 *
 *   const model = readGltf(cockpitFiles(title).gltf)
 *   const lr = findAnimation(model.g, vr.yoke_anim_x)
 *   const world = poseAt(model, [{ animation: lr, frame: 50 }])
 *
 * A frame is what the XML's ANIM_CODE returns, 0 to the <Animation> Length
 * (ANIM_LENGTH, 100 unless the component sets it). The sim divides it by the
 * length and multiplies the result, clamped to 0..1, by the glTF animation's
 * own duration, so no frame rate enters (documented, SDK, Animation XML
 * Properties, AnimLength:
 * https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Models/Animation_XML_Properties.htm).
 * A fixed rate would break one of the two yokes we read: in
 * bksq-aircraft-baronpro 0.1.1 the yoke's 101 keys span 4.1667s, 24 to the
 * second, and frame 50 is key 50; in a2a-aircraft-pa24 2.1.3 they are 100 keys
 * over 3.3s, a 30-per-second export, where 24 per second would put frame 50 at
 * key 62.5, off center. We haven't measured this mapping in the sim.
 */

import fs from "node:fs"
import path from "node:path"

import { local, mul } from "./gltf.mjs"

// The Baron's [VR] section, its XML, and its glTF spell the yoke's fore-aft
// animation three ways: HANDLING_YOKE_Lever_StickForeAft,
// HANDLING_Yoke_Lever_StickForeAft, and HANDLING_yoke_Lever_StickForeAft.
export const findAnimation = (g, name) => (g.animations ?? []).find((a) => (a.name ?? "").toLowerCase() === name.toLowerCase()) ?? null

// An accessor's floats. Both aircraft above store every animation accessor as
// float32; a quantized one (KHR_mesh_quantization) throws rather than misreads.
const bins = new WeakMap()
function floats(model, index) {
  const { g } = model
  const a = g.accessors[index]
  if (a.componentType !== 5126) throw new Error(`accessor ${index} has componentType ${a.componentType}; only float32 (5126) is read`)
  const v = g.bufferViews[a.bufferView]
  if (!bins.has(model)) bins.set(model, [])
  const cache = bins.get(model)
  cache[v.buffer] ??= fs.readFileSync(path.join(path.dirname(model.file), g.buffers[v.buffer].uri))
  const bin = cache[v.buffer]
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
  const stride = v.byteStride ?? n * 4
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out = new Float64Array(a.count * n)
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = bin.readFloatLE(base + i * stride + k * 4)
  return out
}

// Each channel's keys, read once per animation. The animation's duration is its
// latest key over every channel, since a channel that ends early holds its last
// value through the rest.
const decoded = new WeakMap()
function channels(model, anim) {
  if (decoded.has(anim)) return decoded.get(anim)
  const out = anim.channels.filter((c) => c.target.node !== undefined && c.target.path !== "weights").map((c) => {
    const s = anim.samplers[c.sampler]
    return { node: c.target.node, path: c.target.path, interpolation: s.interpolation ?? "LINEAR", input: floats(model, s.input), output: floats(model, s.output), n: c.target.path === "rotation" ? 4 : 3 }
  })
  out.end = Math.max(0, ...out.map((c) => c.input[c.input.length - 1]))
  decoded.set(anim, out)
  return out
}

function slerp(a, b, u) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  if (d < 0) { b = b.map((x) => -x); d = -d }
  if (d > 0.9995) {
    const q = a.map((x, k) => x + (b[k] - x) * u)
    const l = Math.hypot(...q)
    return q.map((x) => x / l)
  }
  const th = Math.acos(d), s = Math.sin(th)
  return a.map((x, k) => (Math.sin((1 - u) * th) * x + Math.sin(u * th) * b[k]) / s)
}

// One channel's value at t seconds. CUBICSPLINE keeps an in-tangent, the value,
// and an out-tangent per key; we read only the values and interpolate between
// them as LINEAR does, so a cubic channel is exact at its keys and only there.
function sample(c, t) {
  const { input, output, n } = c
  const at = (i) => { const o = (c.interpolation === "CUBICSPLINE" ? 3 * i + 1 : i) * n; return Array.from(output.subarray(o, o + n)) }
  const last = input.length - 1
  if (t <= input[0]) return at(0)
  if (t >= input[last]) return at(last)
  let i = 0
  while (input[i + 1] <= t) i++
  if (c.interpolation === "STEP") return at(i)
  const u = (t - input[i]) / (input[i + 1] - input[i])
  const a = at(i), b = at(i + 1)
  return c.path === "rotation" ? slerp(a, b, u) : a.map((x, k) => x + (b[k] - x) * u)
}

// Every node's transform to the model's space with these animations played:
// plays is [{ animation, frame, length = 100 }], the animation an object from
// findAnimation or its name. Two plays on the same node and path: the later wins.
export function poseAt(model, plays) {
  const { g, nodes, parent } = model
  const posed = new Map()
  for (const p of plays) {
    const anim = typeof p.animation === "string" ? findAnimation(g, p.animation) : p.animation
    if (!anim) throw new Error(`no animation ${p.animation} in ${model.name}`)
    const cs = channels(model, anim)
    const t = Math.min(Math.max(p.frame / (p.length ?? 100), 0), 1) * cs.end
    for (const c of cs) {
      if (!posed.has(c.node)) posed.set(c.node, { ...nodes[c.node] })
      posed.get(c.node)[c.path] = sample(c, t)
    }
  }
  const world = new Array(nodes.length)
  const at = (i) => {
    if (!world[i]) world[i] = parent[i] === -1 ? local(posed.get(i) ?? nodes[i]) : mul(at(parent[i]), local(posed.get(i) ?? nodes[i]))
    return world[i]
  }
  nodes.forEach((_, i) => at(i))
  return world
}
