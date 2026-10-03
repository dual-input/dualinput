/*
 * The figure's model, built from its spec (figure.json): spheres and sticks
 * whose joints are glTF animations, each driven by one variable of the
 * figure's own object, the way p17's hand sphere scaled with
 * Z:CROSSCHECK_SCALE (record/areas/avatars/log.md, 2026-10-03).
 *
 * Plain JavaScript with no Node imports, so the dev page builds in the browser
 * the same model build.mjs writes for the sim.
 *
 * The model's axes are the sim's: +x left, +y up, +z forward (p18). The spec,
 * the channels, and solve.mjs use forward, right, and up in meters, and yaw
 * right, pitch up, and roll right in degrees, each positive.
 *
 * Each channel's value maps onto frames 0 to FRAMES of its animation, and the
 * animation's keys make that mapping exact at any fractional frame:
 *
 *   move     one node's translation along one axis, two keys
 *   turn     one node's rotation about one axis, a key every ROT_STEP degrees,
 *            because glTF interpolates a rotation the short way round
 *   stretch  a limb's length: its stick's scale along z, and its hand or
 *            foot's translation along z, both in one animation
 *
 * A limb points along +z at zero yaw and pitch, and its stick is a unit
 * cylinder, so yaw, pitch, and length put the hand or foot at any point while
 * the stick stays round.
 */

export const FPS = 30
export const FRAMES = 120
const ROT_STEP = 30

const LIMBS = [
  ["ARM_L", "arm_l"],
  ["ARM_R", "arm_r"],
  ["LEG_L", "leg_l"],
  ["LEG_R", "leg_r"],
]

export const CHANNELS = [
  ...["HEAD", "CHEST"].flatMap((b) => [
    { name: `${b}_FWD`, node: `${b.toLowerCase()}_fwd`, kind: "move", axis: "fwd", min: -1, max: 1 },
    { name: `${b}_RIGHT`, node: `${b.toLowerCase()}_right`, kind: "move", axis: "right", min: -1, max: 1 },
    { name: `${b}_UP`, node: `${b.toLowerCase()}_up`, kind: "move", axis: "up", min: -0.5, max: 1.5 },
  ]),
  { name: "HEAD_YAW", node: "head_yaw", kind: "turn", axis: "yaw", min: -180, max: 180 },
  { name: "HEAD_PITCH", node: "head_pitch", kind: "turn", axis: "pitch", min: -90, max: 90 },
  { name: "HEAD_ROLL", node: "head_roll", kind: "turn", axis: "roll", min: -90, max: 90 },
  ...LIMBS.flatMap(([n, l]) => [
    { name: `${n}_YAW`, node: `${l}_yaw`, kind: "turn", axis: "yaw", min: -180, max: 180 },
    { name: `${n}_PITCH`, node: `${l}_pitch`, kind: "turn", axis: "pitch", min: -90, max: 90 },
    { name: `${n}_LEN`, node: `${l}_len`, end: `${l}_end`, kind: "stretch", min: 0, max: 1.5 },
  ]),
]

export const variable = (ch) => `CROSSCHECK_${ch.name}`

export function frameOf(ch, value) {
  const v = Math.min(ch.max, Math.max(ch.min, value))
  return ((v - ch.min) / (ch.max - ch.min)) * FRAMES
}

// The model XML's ANIM_CODE: the variable mapped onto the animation's frames.
export function animCode(ch) {
  const num = (x) => String(+x.toFixed(6))
  const shift = ch.min < 0 ? ` ${num(-ch.min)} +` : ch.min > 0 ? ` ${num(ch.min)} -` : ""
  return `(Z:${variable(ch)})${shift} ${num(FRAMES / (ch.max - ch.min))} * 0 max ${FRAMES} min`
}

// The points the model and solve.mjs share, forward, right, and up in meters:
// the hips and the legs' anchors from the seat point, and the shoulders from
// the chest's center.
export function anchors(spec) {
  const hipUp = spec.hips.up, back = -spec.hips.back
  const leg = (side) => ({ fwd: back, right: (side * spec.legs.width) / 2, up: hipUp - spec.legs.down })
  const shoulder = (side) => ({ fwd: 0, right: (side * spec.shoulders.width) / 2, up: -spec.shoulders.down })
  return { hips: { fwd: back, right: 0, up: hipUp }, legL: leg(-1), legR: leg(1), shoulderL: shoulder(-1), shoulderR: shoulder(1) }
}

const m = (p) => [-(p.right ?? 0), p.up ?? 0, p.fwd ?? 0]

function quat(axis, deg) {
  const a = (axis === "roll" ? deg : -deg) * (Math.PI / 180) / 2
  const s = Math.sin(a), c = Math.cos(a)
  return axis === "yaw" ? [0, s, 0, c] : axis === "pitch" ? [s, 0, 0, c] : [0, 0, s, c]
}

// ------------------------------------------------ geometry

// Rings around the z axis, each {z, r, nr, nz}, joined into one surface whose
// normal at angle a is (nr cos a, nr sin a, nz).
function lathe(rings, segs) {
  const pos = [], nrm = [], idx = []
  for (const ring of rings) {
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2
      pos.push(ring.r * Math.cos(a), ring.r * Math.sin(a), ring.z)
      nrm.push(ring.nr * Math.cos(a), ring.nr * Math.sin(a), ring.nz)
    }
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let s = 0; s < segs; s++) {
      const a = k * (segs + 1) + s, b = a + segs + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  return { pos, nrm, idx }
}

const arc = (z0, r, from, to, steps) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps
    return { z: z0 + r * Math.sin(t), r: r * Math.cos(t), nr: Math.cos(t), nz: Math.sin(t) }
  })

const sphere = () => lathe(arc(0, 1, -Math.PI / 2, Math.PI / 2, 24), 40)
const stick = () => lathe([{ z: 0, r: 1, nr: 1, nz: 0 }, { z: 1, r: 1, nr: 1, nz: 0 }], 20)
function nose(spec) {
  const r = spec.nose.radius
  const tip = spec.head.radius + spec.nose.length - r
  return lathe([{ z: 0, r, nr: 1, nz: 0 }, ...arc(tip, r, 0, Math.PI / 2, 8)], 24)
}

// ------------------------------------------------ buffer

function packer() {
  const chunks = [], bufferViews = [], accessors = []
  let offset = 0
  function view(typed, target) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    const pad = (4 - (bytes.length % 4)) % 4
    chunks.push(bytes, new Uint8Array(pad))
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
    offset += bytes.length + pad
    return bufferViews.length - 1
  }
  function accessor(typed, type, componentType, target, bounds) {
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    const a = { bufferView: view(typed, target), componentType, count: typed.length / size, type }
    if (bounds) {
      a.min = Array.from({ length: size }, (_, k) => Math.min(...typed.filter((_, i) => i % size === k)))
      a.max = Array.from({ length: size }, (_, k) => Math.max(...typed.filter((_, i) => i % size === k)))
    }
    accessors.push(a)
    return accessors.length - 1
  }
  return {
    accessors,
    bufferViews,
    floats: (arr, type, bounds) => accessor(new Float32Array(arr), type, 5126, type === "SCALAR" ? undefined : 34962, bounds),
    keys: (arr) => accessor(new Float32Array(arr), "SCALAR", 5126, undefined, true),
    out: (arr, type) => accessor(new Float32Array(arr), type, 5126),
    indices: (arr) => accessor(arr.length && Math.max(...arr) > 65535 ? new Uint32Array(arr) : new Uint16Array(arr), "SCALAR", Math.max(...arr) > 65535 ? 5125 : 5123, 34963),
    bin() {
      const out = new Uint8Array(offset)
      let o = 0
      for (const c of chunks) { out.set(c, o); o += c.length }
      return out
    },
  }
}

// ------------------------------------------------ color

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

// The palette entry's main and light colors, as linear RGB.
export function colors(spec, index) {
  const hex = spec.palette[index % spec.palette.length].hex
  const n = parseInt(hex.slice(1), 16)
  const srgb = [16, 8, 0].map((s) => ((n >> s) & 255) / 255)
  const f = spec.material.lighten
  return { main: srgb.map(srgbToLinear), light: srgb.map((c) => srgbToLinear(c + (1 - c) * f)) }
}

// ------------------------------------------------ the model

export function buildGltf(spec, colorIndex = 0) {
  const P = packer()
  const geometry = (g) => ({ POSITION: P.floats(g.pos, "VEC3", true), NORMAL: P.floats(g.nrm, "VEC3"), indices: P.indices(g.idx) })
  const geo = { sphere: geometry(sphere()), stick: geometry(stick()), nose: geometry(nose(spec)) }
  const prim = (g, material) => ({ attributes: { POSITION: g.POSITION, NORMAL: g.NORMAL }, indices: g.indices, material, mode: 4 })
  const meshes = [
    { name: "sphere_main", primitives: [prim(geo.sphere, 0)] },
    { name: "sphere_light", primitives: [prim(geo.sphere, 1)] },
    { name: "stick", primitives: [prim(geo.stick, 0)] },
    { name: "nose", primitives: [prim(geo.nose, 0)] },
  ]
  const MESH = { sphere_main: 0, sphere_light: 1, stick: 2, nose: 3 }

  const nodes = []
  const at = {}
  const add = (parent, node) => {
    nodes.push(node)
    const i = nodes.length - 1
    at[node.name] = i
    if (parent !== null) (nodes[parent].children ??= []).push(i)
    return i
  }
  const ball = (parent, name, r, mesh, p) => add(parent, { name, mesh: MESH[mesh], scale: [r, r, r], ...(p ? { translation: m(p) } : {}) })
  const chain = (parent, names) => names.reduce((p, n) => add(p, { name: n }), parent)

  const a = anchors(spec)
  const root = add(null, { name: "figure" })
  ball(root, "hips_ball", spec.hips.radius, "sphere_main", a.hips)

  const look = chain(root, ["head_fwd", "head_right", "head_up", "head_yaw", "head_pitch", "head_roll"])
  ball(look, "head_ball", spec.head.radius, "sphere_main", { fwd: -spec.head.eyeForward })
  add(look, { name: "nose_tip", mesh: MESH.nose, translation: m({ fwd: -spec.head.eyeForward }) })

  const chest = chain(root, ["chest_fwd", "chest_right", "chest_up"])
  ball(chest, "chest_ball", spec.chest.radius, "sphere_light")

  function limb(parent, l, anchor, stickR, endR) {
    const base = add(parent, { name: l, translation: m(anchor) })
    const pitch = chain(base, [`${l}_yaw`, `${l}_pitch`])
    const len = add(pitch, { name: `${l}_len` })
    add(len, { name: `${l}_stick`, mesh: MESH.stick, scale: [stickR, stickR, 1] })
    const end = add(pitch, { name: `${l}_end` })
    ball(end, `${l}_ball`, endR, "sphere_main")
  }
  limb(chest, "arm_l", a.shoulderL, spec.arm.radius, spec.hand.radius)
  limb(chest, "arm_r", a.shoulderR, spec.arm.radius, spec.hand.radius)
  limb(root, "leg_l", a.legL, spec.leg.radius, spec.foot.radius)
  limb(root, "leg_r", a.legR, spec.leg.radius, spec.foot.radius)

  const animations = CHANNELS.map((ch) => {
    let values, keys
    if (ch.kind === "turn") {
      const steps = Math.round((ch.max - ch.min) / ROT_STEP)
      keys = Array.from({ length: steps + 1 }, (_, k) => (k * FRAMES) / steps / FPS)
      values = Array.from({ length: steps + 1 }, (_, k) => quat(ch.axis, ch.min + k * ROT_STEP)).flat()
    } else {
      keys = [0, FRAMES / FPS]
    }
    const input = P.keys(keys)
    const samplers = [], channels = []
    const track = (node, path, out) => {
      samplers.push({ input, output: out, interpolation: "LINEAR" })
      channels.push({ sampler: samplers.length - 1, target: { node: at[node], path } })
    }
    if (ch.kind === "turn") track(ch.node, "rotation", P.out(values, "VEC4"))
    if (ch.kind === "move") track(ch.node, "translation", P.out([...m({ [ch.axis]: ch.min }), ...m({ [ch.axis]: ch.max })], "VEC3"))
    if (ch.kind === "stretch") {
      track(ch.node, "scale", P.out([1, 1, ch.min, 1, 1, ch.max], "VEC3"))
      track(ch.end, "translation", P.out([0, 0, ch.min, 0, 0, ch.max], "VEC3"))
    }
    return { name: variable(ch), samplers, channels }
  })

  const c = colors(spec, colorIndex)
  const material = (name, rgb) => ({
    name,
    pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: spec.material.roughness },
  })
  const bin = P.bin()
  const json = {
    asset: { version: "2.0", generator: "Crosscheck experiments/areas/avatars/figure/model.mjs" },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    meshes,
    materials: [material("CROSSCHECK_Main", c.main), material("CROSSCHECK_Light", c.light)],
    animations,
    accessors: P.accessors,
    bufferViews: P.bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  return { json, bin }
}

// A binary glTF of one JSON chunk and one buffer chunk, for the dev page's loader.
export function toGlb(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLen = Math.ceil(text.length / 4) * 4
  const binLen = Math.ceil(bin.length / 4) * 4
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, out.length, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(text, 20)
  out.fill(0x20, 20 + text.length, 20 + jsonLen)
  dv.setUint32(20 + jsonLen, binLen, true)
  dv.setUint32(24 + jsonLen, 0x004e4942, true)
  out.set(bin, 28 + jsonLen)
  return out
}
