/*
 * The files of the loaded aircraft that the hand needs, found from its title:
 * its aircraft.cfg, the interior model's behavior XML and its most detailed
 * glTF, and the aircraft.cfg [VR] section that names its yoke.
 *
 *   const files = cockpitFiles("Black Square Baron 58 Professional N972HJ")
 *     { cfg, modelDir, xml, gltf, vr: { yoke_node, yoke_anim_x, ... } } or null
 *
 * The route, read in two packages: the [FLTSIM.n] section with the title names
 * a model folder (model = "base" means model.base); its model.cfg names the
 * interior XML under [models], which may sit in another aircraft's folder
 * (bksq-aircraft-baronpro 0.1.1: "interior = \..\..\bksq-aircraft-baronpro\
 * model.base\BaronProfessional_Base_INT.xml"); and the XML's <LOD> list gives
 * each level's glTF, the largest minSize being the most detailed. A modular
 * aircraft keeps aircraft.cfg in a preset and its model in common/model
 * (a2a-aircraft-pa24 2.1.3).
 */

import fs from "node:fs"
import path from "node:path"

import { dirs, packageRoots } from "../../aircraft/lib/flights.mjs"

const read = (f) => fs.readFileSync(f, "latin1")

// One section of a .cfg file as key = value pairs, quotes and comments dropped.
export function cfgSection(text, name) {
  const out = {}
  let on = false
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\s*\[([^\]]+)\]/)
    if (head) { on = head[1].trim().toLowerCase() === name.toLowerCase(); continue }
    if (!on) continue
    const kv = line.replace(/[;].*$/, "").match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/)
    if (kv) out[kv[1].toLowerCase()] = kv[2].replace(/^"|"$/g, "")
  }
  return out
}

// The [FLTSIM.n] section whose title is this one, or null.
function fltsimWithTitle(text, title) {
  for (const m of text.matchAll(/^\s*\[(FLTSIM\.\d+)\]/gim)) {
    const s = cfgSection(text, m[1])
    if ((s.title ?? "").trim().toLowerCase() === title.toLowerCase()) return s
  }
  return null
}

export function cockpitFiles(title) {
  for (const root of packageRoots()) {
    for (const pkg of dirs(root)) {
      const planes = path.join(root, pkg, "SimObjects", "Airplanes")
      for (const plane of dirs(planes)) {
        const base = path.join(planes, plane)
        const cfgs = [path.join(base, "aircraft.cfg")]
        for (const a of dirs(path.join(base, "presets"))) for (const b of dirs(path.join(base, "presets", a))) cfgs.push(path.join(base, "presets", a, b, "config", "aircraft.cfg"))
        for (const cfg of cfgs) {
          if (!fs.existsSync(cfg)) continue
          const text = read(cfg)
          const sim = fltsimWithTitle(text, title)
          if (!sim) continue
          const folder = sim.model ? `model.${sim.model}` : "model"
          const modelDir = [path.join(base, folder), path.join(base, "common", "model")].find((d) => fs.existsSync(path.join(d, "model.cfg")))
          if (!modelDir) return null
          const models = cfgSection(read(path.join(modelDir, "model.cfg")), "models")
          if (!models.interior) return null
          const xml = path.join(modelDir, models.interior.replace(/^[\\/]+/, ""))
          const lods = [...read(xml).matchAll(/<LOD\b[^>]*minSize="(\d+)"[^>]*ModelFile="([^"]+)"/g)].map((m) => ({ size: Number(m[1]), file: m[2] }))
          lods.sort((a, b) => b.size - a.size)
          const gltf = lods.length ? path.join(path.dirname(xml), lods[0].file) : null
          // [VR] sits in this aircraft.cfg, or in common/config's for a modular aircraft.
          const common = path.join(base, "common", "config", "aircraft.cfg")
          let vr = cfgSection(text, "VR")
          if (!Object.keys(vr).length && fs.existsSync(common)) vr = cfgSection(read(common), "VR")
          return { cfg, modelDir, xml, gltf, vr, package: pkg }
        }
      }
    }
  }
  return null
}
