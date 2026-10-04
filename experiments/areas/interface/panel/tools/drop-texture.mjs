/*
 * Puts the card into the built package by hand, where the compiled model looks
 * for it, since neither packager took the PNG (record/areas/interface/log.md,
 * 2026-10-04): an uncompressed DDS (png-to-dds.ps1) under the name the model
 * points at, ..\TEXTURE\CROSSCHECK_P02_CARD.PNG.KTX2, in the package Build and
 * Mount mounted and in the copy in Community, each with a layout.json entry.
 * Textures load when an object spawns, so a fresh spawn may pick it up with no
 * rebuild.
 *
 *   node experiments/areas/interface/panel/tools/drop-texture.mjs
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL = path.join(HERE, "..")
const NAME = "crosscheck-p02-panel"
const CARD = "CROSSCHECK_P02_CARD.PNG"
const OBJECTS = ["CROSSCHECK_P02_Baked", "CROSSCHECK_P02_Baked2"]

const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
const roots = [path.join(PANEL, "package", "Packages", NAME), path.join(line.match(/"([^"]+)"/)[1], "Community", NAME)]

const dds = path.join(PANEL, "package", "card", `${CARD}.DDS`)
console.log(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "png-to-dds.ps1"), "-In", path.join(PANEL, "package", "card", CARD), "-Out", dds], { encoding: "utf8" }).trim())

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
for (const root of roots) {
  if (!fs.existsSync(root)) { console.log(`no package at ${root}`); continue }
  // The dates are bare FILETIME numbers, too big for a JS number to keep
  // exactly, so the file is edited as text rather than parsed and rewritten.
  const layoutFile = path.join(root, "layout.json")
  let text = fs.readFileSync(layoutFile, "utf8")
  for (const o of OBJECTS) {
    const rel = `SimObjects/Misc/${o}/TEXTURE/${CARD}.KTX2`
    const to = path.join(root, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(dds, to)
    const key = JSON.stringify(rel.toLowerCase())
    if (text.includes(key)) {
      text = text.replace(new RegExp(`(${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},\\s*"size": )\\d+`), `$1${fs.statSync(to).size}`)
    } else {
      const row = `    {\n      "path": ${key},\n      "size": ${fs.statSync(to).size},\n      "date": ${filetime(fs.statSync(to).mtimeMs)}\n    }`
      text = text.replace(/\}\s*\]\s*\}\s*$/, `},\n${row}\n  ]\n}\n`)
    }
    console.log(`${root}: ${rel}`)
  }
  fs.writeFileSync(layoutFile, text)
}
