// The figure posed as the sim would pose it, for the page: each channel's frame from the
// ANIM_CODE model.ts writes into the model XML, each node's visibility from its
// VISIBILITY_CODE, and the color from its property animation. Running the code itself, rather
// than the formula it encodes, shows a fault in the code the sim will run. It touches no page,
// so Node runs its tests, and serve.ts strips its types for the browser.

import { FRAMES, animCode, variable, visibilityCode, type Built, type Channel } from "../../../src/features/avatars/figure/model.ts"

/** A variable's value, by its prefix and name, such as `Z` and `DUALINPUT_FIGURE_SHOWS`. */
export type Read = (prefix: string, name: string) => number

/**
 * The sim's calculator code run on `read`, with the words model.ts writes: numbers, variables
 * in parentheses, arithmetic, comparisons, `&`, `and`, `or`, `max`, and `min`. Any other word
 * throws, so a change to model.ts that writes one shows on the page rather than drawing wrong.
 */
export function rpn(code: string, read: Read): number {
  const stack: number[] = []
  for (const word of code.match(/\([^)]*\)|\S+/g) ?? []) {
    const named = /^\((\w):([^,)]+)(?:,[^)]*)?\)$/.exec(word)
    if (named) {
      stack.push(read(named[1]!, named[2]!.trim()))
      continue
    }
    if (/^-?\d/.test(word)) {
      stack.push(Number(word))
      continue
    }
    const b = stack.pop() ?? 0
    const a = stack.pop() ?? 0
    const ops: Record<string, (a: number, b: number) => number> = {
      "+": (a, b) => a + b,
      "-": (a, b) => a - b,
      "*": (a, b) => a * b,
      "/": (a, b) => a / b,
      "&": (a, b) => (a | 0) & (b | 0),
      "==": (a, b) => +(a === b),
      "!=": (a, b) => +(a !== b),
      "<": (a, b) => +(a < b),
      "<=": (a, b) => +(a <= b),
      ">": (a, b) => +(a > b),
      ">=": (a, b) => +(a >= b),
      and: (a, b) => +(a !== 0 && b !== 0),
      or: (a, b) => +(a !== 0 || b !== 0),
      max: Math.max,
      min: Math.min,
    }
    const op = ops[word]
    if (!op) throw new Error(`the figure's code has a word the page doesn't run: ${word}`)
    stack.push(op(a, b))
  }
  return stack.pop() ?? 0
}

/** A recorded frame's variables: each of `channels`, by its name, holds the value at its place. */
export function reader(channels: string[], values: number[]): Read {
  const by = new Map(channels.map((c, i) => [variable(c), values[i] ?? 0]))
  return (prefix, name) => (prefix === "Z" ? (by.get(name) ?? 0) : 0)
}

/**
 * The time into a channel's clip of `duration` seconds that its frame plays at, the frame its
 * ANIM_CODE gives out of the animation's frames, as aircraft-model maps a frame to a time.
 */
export function timeOf(ch: Channel, read: Read, duration: number): number {
  const frame = rpn(animCode(ch), read)
  return Math.min(Math.max(frame / FRAMES, 0), 1) * duration
}

type Node = { name: string; mesh?: number; children?: number[] }
type Accessor = { bufferView: number; count: number; type: string }
type View = { byteOffset: number }
type Gltf = {
  nodes: Node[]
  meshes: { primitives: { indices: number }[] }[]
  accessors: Accessor[]
  bufferViews: View[]
  animations: { samplers: { input: number; output: number }[] }[]
}

/**
 * Which nodes show by their own rules, and what the nodes that show draw: each a draw call,
 * and its triangles. A node shows only while every node above it does, as in the sim.
 */
export function shown(built: Built, read: Read) {
  const g = built.json as unknown as Gltf
  const visible = new Map<string, boolean>()
  for (const rule of built.rules) visible.set(rule.node, rpn(visibilityCode(rule), read) !== 0)
  let draws = 0
  let triangles = 0
  const walk = (i: number) => {
    const n = g.nodes[i]!
    if (visible.get(n.name) === false) return
    if (n.mesh !== undefined) {
      draws++
      for (const p of g.meshes[n.mesh]!.primitives) triangles += g.accessors[p.indices]!.count / 3
    }
    for (const c of n.children ?? []) walk(c)
  }
  const children = new Set(g.nodes.flatMap((n) => n.children ?? []))
  g.nodes.forEach((_, i) => children.has(i) || walk(i))
  return { visible, draws, triangles }
}

/** An accessor's floats, from the built buffer. */
function floats(built: Built, accessor: number): Float32Array {
  const g = built.json as unknown as Gltf
  const a = g.accessors[accessor]!
  const size = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type] ?? 1
  const offset = built.bin.byteOffset + g.bufferViews[a.bufferView]!.byteOffset
  return new Float32Array(built.bin.buffer.slice(offset, offset + a.count * size * 4))
}

/** An animation's sampler at `t` seconds, held outside its keys and linear between them. */
export function sample(built: Built, animation: number, sampler: number, t: number): number[] {
  const s = (built.json as unknown as Gltf).animations[animation]!.samplers[sampler]!
  const times = floats(built, s.input)
  const values = floats(built, s.output)
  const width = values.length / times.length
  const at = (k: number) => Array.from(values.subarray(k * width, (k + 1) * width))
  if (t <= times[0]!) return at(0)
  for (let k = 1; k < times.length; k++) {
    if (t <= times[k]!) {
      const u = (t - times[k - 1]!) / (times[k]! - times[k - 1]!)
      const [a, b] = [at(k - 1), at(k)]
      return a.map((v, i) => v + (b[i]! - v) * u)
    }
  }
  return at(times.length - 1)
}

/** A glTF and its buffer as one GLB in memory, which a stock loader reads. */
export function glb(json: object, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const pad = (n: number) => (n + 3) & ~3
  const [jsonLength, binLength] = [pad(text.length), pad(bin.length)]
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLength)
  out.set(text, 20)
  const at = 20 + jsonLength
  view.setUint32(at, binLength, true)
  view.setUint32(at + 4, 0x004e4942, true)
  out.set(bin, at + 8)
  return out.buffer
}
