// The figure's model, built from its spec, figure.json: spheres and sticks whose joints are
// glTF animations, each driven by one `Z:` variable of the figure's own object, which
// `Figure` writes (record/areas/avatars/01-avatars.md, "Names"). It imports nothing, so
// generate.ts writes it for the sim and tools/figure-viewer builds the same model in a
// browser.
//
// It follows the probes' figure, which posed in the sim and changed color there (measured on
// MSFS 2024, 2026-10-03, record/areas/avatars/log.md, "Our own figure poses in the sim from its
// variables"), with what that figure learned built in:
//
//   - A stick that stretches telescopes: a pair of fixed pieces of length s, one forward from
//     its base and one back from the node at its end, covers any length from s to 2s, and
//     visibility rules on the length show only the pair that fits. A scale animation along
//     the stick drew the sticks at their full length, and a skinned stick killed
//     fspackagetool (read in experiments/areas/avatars/figure/model.mjs).
//   - Each stick size is a mesh of its own, since fspackagetool rewrote one unit stick shared
//     by nodes with uneven scales (same file).
//   - Every animated node carries one animated path, and a node that needs a second motion has
//     a child carry it.
//
// The model's axes are the sim's: +x left, +y up, +z forward. The channels and `Figure` use
// forward, right, and up in meters from the hips' center, and yaw right, pitch up, and roll
// right in degrees, each positive.

export type Spec = {
  head: { radius: number; eyeForward: number }
  nose: { radius: number; length: number; tip: number }
  chest: { radius: number; at: number }
  hips: { radius: number }
  shoulders: { width: number; down: number }
  legs: { width: number; down: number }
  arm: { radius: number }
  leg: { radius: number }
  knee: { arc: number; segments: number }
  hand: { radius: number }
  foot: { radius: number }
  telescope: number[]
  material: { roughness: number; lighten: number }
  palette: { name: string; hex: string }[]
}

export const FPS = 30
export const FRAMES = 120
const ROT_STEP = 30
const STRETCH_MIN = 0.01
const THINNER = 0.99

/** The SimObject's title, which avatars creates its figures by. */
export const TITLE = "DUALINPUT_FIGURE_PILOT"
export const variable = (name: string) => `DUALINPUT_FIGURE_${name}`

/** What `Z:DUALINPUT_FIGURE_SHOWS` holds, as messages::avatars::slots's `SHOWS_*`. */
export const SHOWS = { body: 1, head: 2, hands: 4, faded: 8 }

type Kind = "move" | "turn" | "stretch"
type Axis = "fwd" | "right" | "up" | "yaw" | "pitch" | "roll" | "twist" | "bend"
export type Channel = { name: string; kind: Kind; axis?: Axis; node?: string; end?: string; segments?: boolean; min: number; max: number }

/**
 * The 27 channels, in the order `CHANNELS` in src/features/avatars/routines/src/solve.rs
 * gives them, which writes each, so change both together. An arm's length reaches past the
 * 3m a hand reaches on foot.
 */
export function channels(spec: Spec): Channel[] {
  const reach = 2 * spec.telescope[spec.telescope.length - 1]!
  const moves = ["HEAD", "CHEST"].flatMap((b): Channel[] => [
    { name: `${b}_FWD`, node: `${b.toLowerCase()}_fwd`, kind: "move", axis: "fwd", min: -1, max: 1 },
    { name: `${b}_RIGHT`, node: `${b.toLowerCase()}_right`, kind: "move", axis: "right", min: -1, max: 1 },
    { name: `${b}_UP`, node: `${b.toLowerCase()}_up`, kind: "move", axis: "up", min: -0.5, max: 1.5 },
  ])
  const arms = ["L", "R"].flatMap((s): Channel[] => [
    { name: `ARM_${s}_YAW`, node: `arm_${s.toLowerCase()}_yaw`, kind: "turn", axis: "yaw", min: -180, max: 180 },
    { name: `ARM_${s}_PITCH`, node: `arm_${s.toLowerCase()}_pitch`, kind: "turn", axis: "pitch", min: -90, max: 90 },
    { name: `ARM_${s}_LEN`, end: `arm_${s.toLowerCase()}_end`, kind: "stretch", min: STRETCH_MIN, max: reach },
  ])
  const legs = ["L", "R"].flatMap((s): Channel[] => {
    const l = `leg_${s.toLowerCase()}`
    return [
      { name: `LEG_${s}_YAW`, node: `${l}_yaw`, kind: "turn", axis: "yaw", min: -180, max: 180 },
      { name: `LEG_${s}_PITCH`, node: `${l}_pitch`, kind: "turn", axis: "pitch", min: -90, max: 90 },
      { name: `LEG_${s}_LEN`, end: `${l}_knee`, kind: "stretch", min: STRETCH_MIN, max: 1.5 },
      { name: `LEG_${s}_ROLL`, node: `${l}_roll`, kind: "turn", axis: "twist", min: -180, max: 180 },
      { name: `LEG_${s}_BEND`, node: `${l}_seg`, kind: "turn", axis: "bend", segments: true, min: 0, max: 180 },
      { name: `LEG_${s}_SHIN`, end: `${l}_shin_end`, kind: "stretch", min: STRETCH_MIN, max: 1.5 },
    ]
  })
  return [
    ...moves,
    { name: "HEAD_YAW", node: "head_yaw", kind: "turn", axis: "yaw", min: -180, max: 180 },
    { name: "HEAD_PITCH", node: "head_pitch", kind: "turn", axis: "pitch", min: -90, max: 90 },
    { name: "HEAD_ROLL", node: "head_roll", kind: "turn", axis: "roll", min: -90, max: 90 },
    ...arms,
    ...legs,
  ]
}

/** The palette as one more channel, its value a palette index: each color on a frame. */
export const colorChannel = (spec: Spec): Channel => ({ name: "COLOR", kind: "turn", min: 0, max: spec.palette.length - 1 })

/** The model XML's ANIM_CODE: the variable mapped onto the animation's frames. */
export function animCode(ch: Channel): string {
  const num = (x: number) => String(+x.toFixed(6))
  const shift = ch.min < 0 ? ` ${num(-ch.min)} +` : ch.min > 0 ? ` ${num(ch.min)} -` : ""
  return `(Z:${variable(ch.name)})${shift} ${num(FRAMES / (ch.max - ch.min))} * 0 max ${FRAMES} min`
}

/** A visibility rule: the node shows while a length lies in [lo, hi), and its part shows. */
export type Rule = { node: string; part: keyof typeof SHOWS; channel?: string; lo?: number; hi?: number }

/**
 * The model XML's VISIBILITY_CODE for a rule. Faded hands hide until the sim session settles
 * whether the sim can fade the figure's material, as 01-avatars allows (record/areas/avatars/
 * 01-avatars.md, "The figures this machine draws").
 */
export function visibilityCode(rule: Rule): string {
  const shows = `(Z:${variable("SHOWS")})`
  const terms = [`${shows} ${SHOWS[rule.part]} & 0 !=`]
  if (rule.part === "hands") terms.push(`${shows} ${SHOWS.faded} & 0 ==`)
  if (rule.channel) {
    const v = `(Z:${variable(rule.channel)})`
    if (rule.lo && rule.lo > 0) terms.push(`${v} ${rule.lo} >=`)
    if (rule.hi !== undefined && Number.isFinite(rule.hi)) terms.push(`${v} ${rule.hi} <`)
  }
  return terms.reduce((code, t, i) => (i ? `${code} ${t} and` : t), "")
}

/** How finely each level of detail draws its spheres and sticks. */
export type Detail = { name: string; minSize: number; rings: number; segments: number; stick: number }

/** The levels of detail, nearest first, which the model XML lists by `minSize`. */
export const DETAILS: Detail[] = [
  { name: "LOD00", minSize: 40, rings: 10, segments: 16, stick: 10 },
  { name: "LOD01", minSize: 12, rings: 6, segments: 10, stick: 6 },
  { name: "LOD02", minSize: 0, rings: 4, segments: 6, stick: 4 },
]

type Geometry = { pos: number[]; nrm: number[]; idx: number[] }

/** Rings around the z axis, each { z, r, nr, nz }, joined into one surface. */
function lathe(rings: { z: number; r: number; nr: number; nz: number }[], segs: number): Geometry {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = []
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

const arc = (z0: number, r: number, from: number, to: number, steps: number) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps
    return { z: z0 + r * Math.sin(t), r: r * Math.cos(t), nr: Math.cos(t), nz: Math.sin(t) }
  })

const sphere = (d: Detail) => lathe(arc(0, 1, -Math.PI / 2, Math.PI / 2, d.rings), d.segments)
const stick = (r: number, from: number, to: number, segs: number) =>
  lathe([{ z: from, r, nr: 1, nz: 0 }, { z: to, r, nr: 1, nz: 0 }], segs)

/** The nose, from the head's center along +z, tapering to a rounded tip. */
function nose(spec: Spec, d: Detail): Geometry {
  const R = spec.head.radius, r = spec.nose.radius, rt = r * spec.nose.tip
  const out = Math.sqrt(Math.max(0, R * R - r * r))
  const center = R + spec.nose.length - rt
  let slope = 0, end = { z: center, r: rt }
  for (let i = 0; i < 3; i++) {
    slope = Math.atan2(r - end.r, end.z - out)
    end = { z: center + rt * Math.sin(slope), r: rt * Math.cos(slope) }
  }
  const side = { nr: Math.cos(slope), nz: Math.sin(slope) }
  return lathe([
    { z: 0, r, nr: 1, nz: 0 },
    { z: out, r, nr: 1, nz: 0 },
    { z: out, r, ...side },
    { z: end.z, r: end.r, ...side },
    ...arc(center, rt, slope, Math.PI / 2, Math.max(2, d.rings / 2)),
  ], d.segments)
}

/** A palette entry's main and light colors, as linear RGB. */
export function colors(spec: Spec, index: number) {
  const hex = spec.palette[index % spec.palette.length]!.hex
  const n = parseInt(hex.slice(1), 16)
  const srgb = [16, 8, 0].map((s) => ((n >> s) & 255) / 255)
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const f = spec.material.lighten
  return { main: srgb.map(linear), light: srgb.map((c) => linear(c + (1 - c) * f)) }
}

/** Where the figure's anchors sit, forward, right, and up from the hips' center. */
export function anchors(spec: Spec) {
  return {
    leg: (side: number) => ({ fwd: 0, right: (side * spec.legs.width) / 2, up: -spec.legs.down }),
    shoulder: (side: number) => ({ fwd: 0, right: (side * spec.shoulders.width) / 2, up: -spec.shoulders.down }),
  }
}

type P = { fwd?: number; right?: number; up?: number }
const m = (p: P) => [-(p.right ?? 0), p.up ?? 0, p.fwd ?? 0]

/** Yaw right, pitch up, and twist toward the right are negative turns about the model's axes. */
function quat(axis: Axis, deg: number): number[] {
  const a = ((axis === "roll" || axis === "bend" ? deg : -deg) * (Math.PI / 180)) / 2
  const s = Math.sin(a), c = Math.cos(a)
  return axis === "yaw" ? [0, s, 0, c] : axis === "pitch" || axis === "bend" ? [s, 0, 0, c] : [0, 0, s, c]
}

/** The buffer's views and accessors, packed as glTF wants them. */
function packer() {
  const chunks: Uint8Array[] = [], bufferViews: object[] = [], accessors: Record<string, unknown>[] = []
  let offset = 0
  const view = (typed: Float32Array | Uint16Array, target?: number) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    const pad = (4 - (bytes.length % 4)) % 4
    chunks.push(bytes, new Uint8Array(pad))
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) })
    offset += bytes.length + pad
    return bufferViews.length - 1
  }
  const accessor = (typed: Float32Array | Uint16Array, type: string, componentType: number, target?: number, bounds = false) => {
    const size = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[type]!
    const a: Record<string, unknown> = { bufferView: view(typed, target), componentType, count: typed.length / size, type }
    if (bounds) {
      const each = (k: number) => Array.from(typed).filter((_, i) => i % size === k)
      a.min = Array.from({ length: size }, (_, k) => Math.min(...each(k)))
      a.max = Array.from({ length: size }, (_, k) => Math.max(...each(k)))
    }
    accessors.push(a)
    return accessors.length - 1
  }
  return {
    accessors,
    bufferViews,
    floats: (arr: number[], type: string, bounds = false) => accessor(new Float32Array(arr), type, 5126, 34962, bounds),
    keys: (arr: number[]) => accessor(new Float32Array(arr), "SCALAR", 5126, undefined, true),
    out: (arr: number[], type: string) => accessor(new Float32Array(arr), type, 5126),
    indices: (arr: number[]) => accessor(new Uint16Array(arr), "SCALAR", 5123, 34963),
    bin() {
      const out = new Uint8Array(offset)
      let o = 0
      for (const c of chunks) { out.set(c, o); o += c.length }
      return out
    },
  }
}

/**
 * One level of detail's glTF, its buffer, its visibility rules, and what it costs: its nodes,
 * the nodes that draw a mesh, each a draw call, and the triangles it draws with one telescope
 * pair showing on each stick, as a pose shows them.
 */
export type Built = {
  json: Record<string, unknown>
  bin: Uint8Array
  rules: Rule[]
  cost: { nodes: number; draws: number; triangles: number; materials: number }
}

type Node = { name: string; mesh?: number; children?: number[]; [key: string]: unknown }

export function buildGltf(spec: Spec, detail: Detail): Built {
  const P = packer()
  const meshes: { name: string; primitives: object[] }[] = []
  const MESH: Record<string, number> = {}
  const meshTriangles: number[] = []
  const mesh = (name: string, g: Geometry, material = 0) => {
    MESH[name] = meshes.length
    meshTriangles.push(g.idx.length / 3)
    meshes.push({
      name,
      primitives: [{
        attributes: { POSITION: P.floats(g.pos, "VEC3", true), NORMAL: P.floats(g.nrm, "VEC3") },
        indices: P.indices(g.idx),
        material,
        mode: 4,
      }],
    })
  }
  const ball = sphere(detail)
  mesh("sphere_main", ball, 0)
  mesh("sphere_light", ball, 1)
  // The knee's and shin's balls are a limb's width, a few centimeters across, so half the
  // rings and segments draw them as round as the head looks.
  mesh("sphere_small", sphere({ ...detail, rings: Math.max(3, detail.rings / 2), segments: Math.max(4, detail.segments / 2) }), 0)
  const kneePiece = spec.knee.arc / spec.knee.segments
  mesh("knee_stick", stick(spec.leg.radius, 0, kneePiece, detail.stick))
  mesh("nose", nose(spec, detail))
  // A leg never stretches past 1.5m, so its telescope stops at the pair that reaches it.
  const legPieces = spec.telescope.filter((s, k) => k === 0 || spec.telescope[k - 1]! * 2 < 1.5)
  for (const [part, r, pieces] of [["arm", spec.arm.radius, spec.telescope], ["leg", spec.leg.radius, legPieces]] as const) {
    pieces.forEach((s, k) => {
      mesh(`${part}_fore_${k}`, stick(r, 0, s, detail.stick))
      mesh(`${part}_back_${k}`, stick(r * THINNER, -s, 0, detail.stick))
    })
  }

  const nodes: Node[] = []
  const at: Record<string, number> = {}
  const add = (parent: number | null, node: Node) => {
    nodes.push(node)
    const i = nodes.length - 1
    at[node.name] = i
    if (parent !== null) (nodes[parent]!.children ??= []).push(i)
    return i
  }
  const rules: Rule[] = []
  const sphereNode = (parent: number, name: string, r: number, meshName: string, part: Rule["part"], p?: P) => {
    add(parent, { name, mesh: MESH[meshName], scale: [r, r, r], ...(p ? { translation: m(p) } : {}) })
    rules.push({ node: name, part })
  }
  const chain = (parent: number, names: string[]) => names.reduce((p, n) => add(p, { name: n }), parent)

  const a = anchors(spec)
  const root = add(null, { name: "figure" })
  sphereNode(root, "hips_ball", spec.hips.radius, "sphere_main", "body")

  const look = chain(root, ["head_fwd", "head_right", "head_up", "head_yaw", "head_pitch", "head_roll"])
  sphereNode(look, "head_ball", spec.head.radius, "sphere_main", "head", { fwd: -spec.head.eyeForward })
  add(look, { name: "nose_tip", mesh: MESH.nose, translation: m({ fwd: -spec.head.eyeForward }) })
  rules.push({ node: "nose_tip", part: "head" })

  const chest = chain(root, ["chest_fwd", "chest_right", "chest_up"])
  sphereNode(chest, "chest_ball", spec.chest.radius, "sphere_light", "body")

  // A stick from `base` along its +z to `end`, the node a stretch animation moves: each
  // telescope pair's two pieces, and when that pair shows.
  const stretchStick = (base: number, end: number, name: string, part: "arm" | "leg", channel: string) => {
    const pieces = part === "arm" ? spec.telescope : legPieces
    pieces.forEach((s, k) => {
      const lo = k ? s : 0, hi = k === pieces.length - 1 ? Infinity : 2 * s
      for (const [node, side] of [[base, "fore"], [end, "back"]] as const) {
        const piece = `${name}_${side}_${k}`
        add(node, { name: piece, mesh: MESH[`${part}_${side}_${k}`] })
        rules.push({ node: piece, part: "body", channel, lo, hi })
      }
    })
  }

  for (const [s, side] of [["l", -1], ["r", 1]] as const) {
    const l = `arm_${s}`
    const pitch = chain(add(chest, { name: l, translation: m(a.shoulder(side)) }), [`${l}_yaw`, `${l}_pitch`])
    const end = add(pitch, { name: `${l}_end` })
    sphereNode(end, `${l}_ball`, spec.hand.radius, "sphere_main", "hands")
    stretchStick(pitch, end, l, "arm", `ARM_${s.toUpperCase()}_LEN`)
  }
  for (const [s, side] of [["l", -1], ["r", 1]] as const) {
    const l = `leg_${s}`, n = `LEG_${s.toUpperCase()}`
    const pitch = chain(add(root, { name: l, translation: m(a.leg(side)) }), [`${l}_yaw`, `${l}_pitch`])
    const kneeAt = add(pitch, { name: `${l}_knee` })
    stretchStick(pitch, kneeAt, l, "leg", `${n}_LEN`)
    let tip = add(kneeAt, { name: `${l}_roll` })
    for (let k = 0; k < spec.knee.segments; k++) {
      const seg = add(tip, { name: `${l}_seg${k}`, ...(k ? { translation: [0, 0, kneePiece] } : {}) })
      const bend = add(seg, { name: `${l}_seg${k}_bend` })
      sphereNode(bend, `${l}_seg${k}_ball`, spec.leg.radius, "sphere_small", "body")
      add(bend, { name: `${l}_seg${k}_stick`, mesh: MESH.knee_stick })
      rules.push({ node: `${l}_seg${k}_stick`, part: "body" })
      tip = bend
    }
    const shin = add(tip, { name: `${l}_shin`, translation: [0, 0, kneePiece] })
    sphereNode(shin, `${l}_shin_ball`, spec.leg.radius, "sphere_small", "body")
    const foot = add(shin, { name: `${l}_shin_end` })
    sphereNode(foot, `${l}_ball`, spec.foot.radius, "sphere_main", "body")
    stretchStick(shin, foot, `${l}_shin`, "leg", `${n}_SHIN`)
  }

  const animations = channels(spec).map((ch) => {
    const n = ch.segments ? spec.knee.segments : 1
    const samplers: object[] = [], targets: object[] = []
    const track = (node: string, path: string, input: number, output: number) => {
      samplers.push({ input, output, interpolation: "LINEAR" })
      targets.push({ sampler: samplers.length - 1, target: { node: at[node], path } })
    }
    if (ch.kind === "turn") {
      // A key every 30°, since glTF turns the short way between two keys.
      const steps = Math.round((ch.max - ch.min) / ROT_STEP)
      const input = P.keys(Array.from({ length: steps + 1 }, (_, k) => (k * FRAMES) / steps / FPS))
      const out = P.out(Array.from({ length: steps + 1 }, (_, k) => quat(ch.axis!, (ch.min + k * ROT_STEP) / n)).flat(), "VEC4")
      if (ch.segments) for (let k = 0; k < n; k++) track(`${ch.node}${k}_bend`, "rotation", input, out)
      else track(ch.node!, "rotation", input, out)
    } else {
      const input = P.keys([0, FRAMES / FPS])
      const values = ch.kind === "move" ? [...m({ [ch.axis!]: ch.min }), ...m({ [ch.axis!]: ch.max })] : [0, 0, ch.min, 0, 0, ch.max]
      track(ch.kind === "move" ? ch.node! : ch.end!, "translation", input, P.out(values, "VEC3"))
    }
    return { name: variable(ch.name), samplers, channels: targets }
  })

  // The color, through ASOBO_property_animation on both materials' base colors, which a glTF
  // animation carries only beside an ordinary channel, so it also holds an empty node still.
  const palette = spec.palette.length
  const input = P.keys(Array.from({ length: palette }, (_, k) => (k * FRAMES) / Math.max(1, palette - 1) / FPS))
  const shades = spec.palette.map((_, k) => colors(spec, k))
  const still = add(root, { name: "color_key" })
  animations.push({
    name: variable("COLOR"),
    samplers: [
      { input, output: P.out(Array.from({ length: palette }, () => [0, 0, 0]).flat(), "VEC3"), interpolation: "LINEAR" },
      { input, output: P.out(shades.flatMap((s) => [...s.main, 1]), "VEC4"), interpolation: "LINEAR" },
      { input, output: P.out(shades.flatMap((s) => [...s.light, 1]), "VEC4"), interpolation: "LINEAR" },
    ],
    channels: [{ sampler: 0, target: { node: still, path: "translation" } }],
    extensions: {
      ASOBO_property_animation: {
        channels: [
          { sampler: 1, target: "materials/0/pbrMetallicRoughness/baseColorFactor" },
          { sampler: 2, target: "materials/1/pbrMetallicRoughness/baseColorFactor" },
        ],
      },
    },
  } as never)

  const c = colors(spec, 0)
  const material = (name: string, rgb: number[]) => ({
    name,
    pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: spec.material.roughness },
  })
  const bin = P.bin()
  const json = {
    asset: { version: "2.0", generator: "Dual Input src/features/avatars/figure/model.ts" },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    meshes,
    materials: [material("DUALINPUT_FIGURE_MAIN", c.main), material("DUALINPUT_FIGURE_LIGHT", c.light)],
    animations,
    accessors: P.accessors,
    bufferViews: P.bufferViews,
    buffers: [{ byteLength: bin.length }],
    extensionsUsed: ["ASOBO_property_animation"],
  }
  // A telescope piece shows only while its stick's length falls in its pair's range, so a
  // pose draws one pair of each stick's pieces: every piece but the longest pair's is left
  // out of the count, the pair that draws the most.
  const hidden = new Set(rules.filter((r) => r.channel && Number.isFinite(r.hi ?? Infinity)).map((r) => r.node))
  let triangles = 0, draws = 0
  for (const n of nodes) {
    if (n.mesh === undefined || hidden.has(n.name)) continue
    triangles += meshTriangles[n.mesh]!
    draws += 1
  }
  return { json, bin, rules, cost: { nodes: nodes.length, draws, triangles, materials: 2 } }
}
