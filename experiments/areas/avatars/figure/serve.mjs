/*
 * The figure's dev page, for shaping and posing the figure in the Baron 58P's
 * cockpit without the sim.
 *
 *   node experiments/areas/avatars/figure/serve.mjs
 *
 * then open http://localhost:5181. The page builds the figure in the browser
 * from model.mjs, the same code build.mjs uses for the sim, and saving it
 * writes figure.json.
 *
 * The cockpit comes from the Black Square Baron Pro in the sim's Community
 * folder, read when the page asks for it and never copied into the
 * repository. Its glTF goes to the page with the textures and the ASOBO_
 * extensions taken out, so a stock loader reads it: flat gray materials,
 * glass marked to show see-through, and invisible shells marked to hide.
 * The geometry is the file's own, and nodes are at the pose the file stores.
 */

import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEV = path.join(HERE, "dev")
const THREE = path.join(HERE, "..", "..", "..", "node_modules", "three")
const PORT = 5181

// The 58P, v1's aircraft (record/areas/product/plan.md).
const AIRCRAFT = {
  package: "bksq-aircraft-baronpro",
  simObject: "SimObjects/Airplanes/bksq-aircraft-baronpropress",
  models: {
    int: "model.press/BaronProfessional_Pressurized_INT.gltf",
    ext: "model.press/BaronProfessional_Pressurized_EXT.gltf",
  },
  cameras: { pilot: "Pilot", copilot: "CoPilot" },
}

// UserCfg.opt's InstalledPackagesPath, as wasm/build.mjs finds it.
function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  return path.join(line.match(/"([^"]+)"/)[1], "Community")
}
const SIMOBJECT = path.join(community(), AIRCRAFT.package, AIRCRAFT.simObject)

// ------------------------------------------------ the cockpit

const GLASS = ["ASOBO_material_glass", "ASOBO_material_kitty_glass", "ASOBO_material_glass_v2", "ASOBO_material_windshield", "ASOBO_material_windshield_v3", "ASOBO_material_parallax_window"]
const HIDDEN = ["ASOBO_material_invisible", "ASOBO_material_environment_occluder", "ASOBO_material_fake_terrain"]

const cache = {}
function cockpitGltf(part) {
  if (cache[part]) return cache[part]
  const file = path.join(SIMOBJECT, AIRCRAFT.models[part])
  const g = JSON.parse(fs.readFileSync(file, "utf8"))
  for (const k of ["images", "textures", "samplers", "extensionsUsed", "extensionsRequired", "animations", "skins"]) delete g[k]
  delete g.asset.extensions
  g.materials = (g.materials ?? []).map((mat) => {
    const ext = Object.keys(mat.extensions ?? {})
    const glass = ext.some((e) => GLASS.includes(e)) || mat.alphaMode === "BLEND"
    const hidden = ext.some((e) => HIDDEN.includes(e))
    const base = mat.pbrMetallicRoughness?.baseColorFactor
    const plain = !base || base.slice(0, 3).every((c) => c > 0.95)
    return {
      name: mat.name,
      pbrMetallicRoughness: {
        baseColorFactor: glass ? [0.7, 0.8, 0.9, 0.12] : plain ? [0.5, 0.5, 0.52, 1] : [...base.slice(0, 3), 1],
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
      ...(glass ? { alphaMode: "BLEND" } : {}),
      doubleSided: true,
      extras: { glass, hidden },
    }
  })
  for (const mesh of g.meshes ?? []) {
    for (const p of mesh.primitives) {
      const keep = { POSITION: p.attributes.POSITION }
      if (p.attributes.NORMAL !== undefined) {
        keep.NORMAL = p.attributes.NORMAL
        const a = g.accessors[keep.NORMAL]
        if (a.componentType !== 5126) a.normalized = true
      }
      p.attributes = keep
      delete p.extensions
      delete p.extras
    }
  }
  for (const n of g.nodes ?? []) {
    delete n.extensions
    delete n.skin
  }
  const bins = g.buffers.map((b) => path.join(path.dirname(file), b.uri))
  g.buffers = g.buffers.map((b, i) => ({ byteLength: b.byteLength, uri: `${part}.${i}.bin` }))
  cache[part] = { json: JSON.stringify(g), bins }
  return cache[part]
}

// Each camera's eye from cameras.cfg: [VIEWS] eyepoint, in feet forward,
// right, and up from the reference datum, plus the camera's InitialXyz in
// meters right, up, and forward. The pair matched SimConnect's camera within
// 4mm in the Comanche (record/areas/avatars/log.md, 2026-10-03, p19).
// Returned in the model's axes, +x left, +y up, +z forward.
function eyes() {
  const text = fs.readFileSync(path.join(SIMOBJECT, "cameras.cfg"), "utf8")
  const nums = (s) => s.split(";")[0].split(",").map(Number)
  const eyepoint = nums(text.match(/^\s*eyepoint\s*=\s*(.+)$/im)[1]).map((ft) => ft * 0.3048)
  const out = {}
  for (const block of text.split(/^\s*\[/m)) {
    const title = block.match(/^\s*Title\s*=\s*"?([^"\r\n]+)"?/im)?.[1]?.trim()
    const xyz = block.match(/^\s*InitialXyz\s*=\s*(.+)$/im)?.[1]
    for (const [key, want] of Object.entries(AIRCRAFT.cameras)) {
      if (title === want && xyz) {
        const [x, y, z] = nums(xyz)
        out[key] = [-(eyepoint[1] + x), eyepoint[2] + y, eyepoint[0] + z]
      }
    }
  }
  return out
}

// ------------------------------------------------ the server

// figure.json's layout: an object or array of plain values on one line, so a
// saved change shows in a diff as the one part that changed.
function format(value, indent = "") {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  const inner = indent + "  "
  const list = Array.isArray(value)
  const entries = list ? value.map((v) => [null, v]) : Object.entries(value)
  const item = ([k, v]) => (k === null ? "" : `${JSON.stringify(k)}: `) + format(v, inner)
  const [open, close] = list ? ["[", "]"] : ["{", "}"]
  if (entries.every(([, v]) => v === null || typeof v !== "object")) return `${open} ${entries.map(item).join(", ")} ${close}`
  return `${open}\n${entries.map((e) => inner + item(e)).join(",\n")}\n${indent}${close}`
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".gltf": "model/gltf+json", ".bin": "application/octet-stream" }

function sendFile(res, base, rel) {
  const file = path.resolve(base, "." + rel)
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("not found")
    return
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" })
  fs.createReadStream(file).pipe(res)
}

function send(res, type, body) {
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body)
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
    try {
      if (req.method === "POST" && url === "/figure/figure.json") {
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", () => {
          const spec = JSON.parse(body)
          fs.writeFileSync(path.join(HERE, "figure.json"), format(spec) + "\n")
          console.log("figure.json saved")
          send(res, "text/plain", "saved")
        })
        return
      }
      if (url === "/") return sendFile(res, DEV, "/index.html")
      if (url === "/app.js") return sendFile(res, DEV, "/app.js")
      if (url.startsWith("/figure/")) return sendFile(res, HERE, url.slice("/figure".length))
      if (url.startsWith("/three/")) return sendFile(res, THREE, url.slice("/three".length))
      if (url === "/cockpit/info.json") return send(res, "application/json", JSON.stringify({ aircraft: AIRCRAFT.simObject, eyes: eyes() }))
      const m = url.match(/^\/cockpit\/(int|ext)(?:\.gltf|\.(\d+)\.bin)$/)
      if (m) {
        const c = cockpitGltf(m[1])
        if (m[2] === undefined) return send(res, "model/gltf+json", c.json)
        const bin = c.bins[Number(m[2])]
        res.writeHead(200, { "content-type": "application/octet-stream" })
        return fs.createReadStream(bin).pipe(res)
      }
      res.writeHead(404).end("not found")
    } catch (e) {
      console.error(e)
      res.writeHead(500).end(String(e))
    }
  })
  .listen(PORT, () => console.log(`figure dev page: http://localhost:${PORT}\ncockpit: Community\\${AIRCRAFT.package}\\${AIRCRAFT.simObject.replaceAll("/", "\\")}`))
