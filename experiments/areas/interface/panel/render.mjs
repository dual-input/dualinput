/*
 * Draws a piece of HTML to a picture the floating panel can show: headless
 * Edge renders it to a PNG with a see-through background, and
 * tools/png-to-dds.ps1 turns that into the uncompressed DDS the sim showed
 * on our panel (record/areas/interface/log.md, 2026-10-04).
 *
 *   const dds = drawDds({ css, body, width, height, name })   // a Buffer; the files land in build/card
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
// Outside the package's project folder, which the sim's package builder
// watches (record/areas/interface/log.md, 2026-10-04).
export const SCRATCH = path.join(HERE, "build", "card")
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p))

export function drawPng({ css, body, width, height, name }) {
  if (!EDGE) throw new Error("No Microsoft Edge found, which draws the picture.")
  fs.mkdirSync(SCRATCH, { recursive: true })
  const html = path.join(SCRATCH, `${name}.html`)
  const png = path.join(SCRATCH, `${name}.png`)
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>html, body { margin: 0; background: transparent; width: ${width}px; height: ${height}px; overflow: hidden; }${css}</style></head><body>${body}</body></html>\n`)
  fs.rmSync(png, { force: true })
  spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${width},${height}`, `--screenshot=${png}`, pathToFileURL(html).href], { stdio: "ignore", timeout: 60_000 })
  if (!fs.existsSync(png)) throw new Error(`Edge drew no ${name}.png`)
  return png
}

export function pngToDds(png) {
  const dds = png.replace(/\.png$/i, ".dds")
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "tools", "png-to-dds.ps1"), "-In", png, "-Out", dds], { encoding: "utf8" })
  if (r.status !== 0 || !fs.existsSync(dds)) throw new Error(`png-to-dds.ps1: ${r.stderr || r.stdout}`)
  return fs.readFileSync(dds)
}

export const drawDds = (args) => pngToDds(drawPng(args))
