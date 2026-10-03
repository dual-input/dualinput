/*
 * What the figure needs from an aircraft's files: where its seat node and
 * other named nodes sit, and where each cockpit camera's eye is. Positions are
 * forward, right, and up in meters from the model's origin, which lines up
 * with SimConnect's reference point within 8mm in the Comanche and about 3mm
 * in the Baron (record/areas/avatars/log.md, p18 and p21).
 */

import fs from "node:fs"

import { apply, readGltf } from "../lib/gltf.mjs"

// The model's +x left, +y up, +z forward, as forward, right, and up.
const frame = ([x, y, z]) => ({ fwd: z, right: -x, up: y })

// Each named node's position, or null where the model has no such node.
export function nodePositions(gltfFile, names) {
  const model = readGltf(gltfFile)
  const out = {}
  for (const name of names) {
    const i = model.nodes.findIndex((n) => n.name === name)
    out[name] = i < 0 ? null : frame(apply(model.world[i], [0, 0, 0]))
  }
  return out
}

// Each camera's eye from cameras.cfg: [VIEWS] eyepoint, in feet forward, right,
// and up from the reference datum, plus the camera's InitialXyz in meters
// right, up, and forward. The pair matched SimConnect's camera within 4mm in
// the Comanche (record/areas/avatars/log.md, p19). `titles` maps a key to a
// camera's Title, such as { copilot: "CoPilot" }.
export function eyes(camerasCfg, titles) {
  const text = fs.readFileSync(camerasCfg, "latin1")
  const nums = (s) => s.split(";")[0].split(",").map(Number)
  const eyepoint = nums(text.match(/^\s*eyepoint\s*=\s*(.+)$/im)[1]).map((ft) => ft * 0.3048)
  const out = {}
  for (const block of text.split(/^\s*\[/m)) {
    const title = block.match(/^\s*Title\s*=\s*"?([^"\r\n]+)"?/im)?.[1]?.trim()
    const xyz = block.match(/^\s*InitialXyz\s*=\s*(.+)$/im)?.[1]
    for (const [key, want] of Object.entries(titles)) {
      if (title === want && xyz) {
        const [x, y, z] = nums(xyz)
        out[key] = { fwd: eyepoint[0] + z, right: eyepoint[1] + x, up: eyepoint[2] + y }
      }
    }
  }
  return out
}
