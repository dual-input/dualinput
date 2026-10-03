/*
 * Writes the hand sphere's glTF and its buffer: a 4cm ball in four colors,
 * under one node with a scale animation, for fspackagetool to compile.
 *
 *   node experiments/areas/avatars/wasm/tools/sphere.mjs
 *
 * build.mjs runs this before packaging. The model's XML beside the output
 * (CROSSCHECK_HandSphere.xml) drives the animation and the colors:
 *
 *   hand        the root, which the module places
 *   hand_scale  scaled by the animation CROSSCHECK_Scale, 100 frames at 30 a
 *               second, from 0.5 (2cm) at frame 0 to 5 (20cm) at frame 100
 *   ball_0..3   the same ball in red, green, blue, and yellow, each shown when
 *               the color index selects it
 *
 * Plain glTF 2.0 with no Asobo extensions: the packaged models we've read
 * carry ASOBO_asset_optimized, which fspackagetool adds when it compiles them
 * (read in fsdreamteam-gsx-pro 4.0.19, FSDT_BypassPin's model).
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "..", "PackageSources", "SimObjects", "Misc", "CROSSCHECK_HandSphere", "model")
const NAME = "CROSSCHECK_HandSphere"
const RADIUS = 0.02
const RINGS = 12
const SEGMENTS = 18
const FRAMES = 100
const FPS = 30
const COLORS = [[1, 0.15, 0.1], [0.1, 0.9, 0.2], [0.15, 0.35, 1], [1, 0.85, 0.1]]

// A UV sphere: positions, normals, texture coordinates, and triangle indices.
const pos = [], nrm = [], uv = [], idx = []
for (let r = 0; r <= RINGS; r++) {
  const v = r / RINGS
  const th = v * Math.PI
  for (let s = 0; s <= SEGMENTS; s++) {
    const u = s / SEGMENTS
    const ph = u * 2 * Math.PI
    const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph)
    pos.push(x * RADIUS, y * RADIUS, z * RADIUS)
    nrm.push(x, y, z)
    uv.push(u, v)
  }
}
for (let r = 0; r < RINGS; r++) {
  for (let s = 0; s < SEGMENTS; s++) {
    const a = r * (SEGMENTS + 1) + s, b = a + SEGMENTS + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
}

// One buffer, each view 4-byte aligned.
const parts = []
let offset = 0
function view(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
  const pad = (4 - (bytes.length % 4)) % 4
  parts.push(bytes, Buffer.alloc(pad))
  const v = { buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) }
  offset += bytes.length + pad
  return v
}
const bufferViews = [
  view(new Float32Array(pos), 34962),
  view(new Float32Array(nrm), 34962),
  view(new Float32Array(uv), 34962),
  view(new Uint16Array(idx), 34963),
  view(new Float32Array([0, FRAMES / FPS])),
  view(new Float32Array([0.5, 0.5, 0.5, 5, 5, 5])),
]
const count = pos.length / 3
const accessors = [
  { bufferView: 0, componentType: 5126, count, type: "VEC3", min: [-RADIUS, -RADIUS, -RADIUS], max: [RADIUS, RADIUS, RADIUS] },
  { bufferView: 1, componentType: 5126, count, type: "VEC3" },
  { bufferView: 2, componentType: 5126, count, type: "VEC2" },
  { bufferView: 3, componentType: 5123, count: idx.length, type: "SCALAR" },
  { bufferView: 4, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [FRAMES / FPS] },
  { bufferView: 5, componentType: 5126, count: 2, type: "VEC3" },
]

const gltf = {
  asset: { version: "2.0", generator: "Crosscheck experiments/areas/avatars/wasm/tools/sphere.mjs" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "hand", children: [1] },
    { name: "hand_scale", children: [2, 3, 4, 5] },
    ...COLORS.map((_, i) => ({ name: `ball_${i}`, mesh: i })),
  ],
  meshes: COLORS.map((_, i) => ({ name: `ball_${i}`, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: i, mode: 4 }] })),
  materials: COLORS.map((c, i) => ({
    name: `${NAME}_${i}`,
    pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0, roughnessFactor: 0.6 },
    emissiveFactor: c.map((x) => x * 0.6),
  })),
  animations: [{ name: "CROSSCHECK_Scale", samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: 1, path: "scale" } }] }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset, uri: `${NAME}.bin` }],
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, `${NAME}.bin`), Buffer.concat(parts))
fs.writeFileSync(path.join(OUT, `${NAME}.gltf`), JSON.stringify(gltf, null, 1))
console.log(`sphere written: ${count} vertices, ${idx.length / 3} triangles, ${offset} bytes`)
