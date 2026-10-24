// Builds our code in the sim: each esbuild bundle at es2017, and our VCockpit.js, made from
// the sim's stock file with our two blocks put in at named anchors; then checks each file
// against what Coherent GT runs (record/areas/build/01-the-build.md, "The Coherent GT check";
// record/areas/core/02-clients-and-panel-bridge.md, "Our VCockpit.js").

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import * as esbuild from "esbuild"

import { checkFile, format } from "../coherent-check/check.ts"
import { fromRoot, ROOT } from "./repo.ts"
import { Failed } from "./run.ts"
import { STOCK } from "./stock.ts"

/** Where the build writes our code in the sim, with each bundle's map beside it. */
export const PAGES = path.join(ROOT, "target", "sim-pages")

/** Each bundle, by its entry, and where our package puts it. */
const BUNDLES: { entry: string; to: string }[] = [
  { entry: "src/sim-package/pages/bridge.ts", to: "html_ui/DualInput/bridge.js" },
  { entry: "src/sim-package/pages/menu.ts", to: "html_ui/DualInput/menu.js" },
]

/** Our VCockpit.js, where our package puts it, so it takes the stock file's place in every cockpit panel. */
const VCOCKPIT = "html_ui/Pages/VCockpit/Core/VCockpit.js"

/** BlurPage, the smallest of the components MasterPage places in the menu, which no other package we've seen copies (record/areas/interface/log.md, 2026-10-06). */
const BLURPAGE = "{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}"

/**
 * What our BlurPage copy adds before the stock component's last closing tag, so it sits inside
 * its root element: a hidden image with no source, whose error handler loads menu.js once in
 * each document, as Flow Pro's copy of the start page loads its script (read in
 * p42-util-flow-pro 26.33.5; record/areas/interface/log.md, 2026-10-06).
 */
const MENU_LOADER = `<svg style="display:none"><foreignObject><img src onerror="(function () { if (!window.DUALINPUT_MENU_LOADED) { window.DUALINPUT_MENU_LOADED = true; var script = document.createElement('script'); script.type = 'text/javascript'; script.src = 'coui://html_ui/DualInput/menu.js'; document.head.appendChild(script); } })()"></img></foreignObject></svg>`

/**
 * Our two blocks, each put in at its anchor, a line of the stock file that holds its text
 * exactly once: the bridge's loader before the file's first line, and the hand-off in
 * `createInstrument`, after the sim has set the instrument up.
 */
const BLOCKS: { file: string; anchor: string; where: "before" | "after" }[] = [
  { file: "src/platform/panel-bridge/vcockpit/top.js", anchor: "class VCockpitInstrumentData {", where: "before" },
  { file: "src/platform/panel-bridge/vcockpit/create.js", anchor: "this.setupInstrument(template);", where: "after" },
]

/** A file the build made for our package: where it is, and where the package puts it. */
export type Built = { file: string; to: string }

/** Builds every bundle and our VCockpit.js into `out`, and returns each with where the package puts it. */
export function buildPages(out = PAGES): Built[] {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const built: Built[] = []
  for (const { entry, to } of BUNDLES) {
    const file = path.join(out, path.basename(to))
    const result = esbuild.buildSync({
      entryPoints: [path.join(ROOT, entry)],
      bundle: true,
      format: "iife",
      target: "es2017",
      // A map beside the bundle, which the check reads to name our TypeScript's line, and no
      // comment naming it, since the package ships the bundle without its map.
      sourcemap: "external",
      outfile: file,
      logLevel: "silent",
    })
    for (const warning of result.warnings) console.warn(`warning: ${entry}: ${warning.text}`)
    built.push({ file, to })
  }
  const vcockpit = path.join(out, "VCockpit.js")
  fs.writeFileSync(vcockpit, makeVCockpit(fs.readFileSync(path.join(STOCK, "VCockpit.js"), "utf8")))
  built.push({ file: vcockpit, to: VCOCKPIT })
  const blurpage = path.join(out, `${BLURPAGE}.html`)
  fs.writeFileSync(blurpage, makeBlurPage(fs.readFileSync(path.join(STOCK, `${BLURPAGE}.html`), "utf8")))
  built.push({ file: blurpage, to: `cookedcomps/${BLURPAGE}.html` })
  // The component's .json, which says it has no animations, states, or exposed children,
  // goes as the sim ships it.
  built.push({ file: path.join(STOCK, `${BLURPAGE}.json`), to: `cookedcomps/${BLURPAGE}.json` })
  return built
}

/** Our BlurPage copy: the stock component with the menu script's loader before its last closing tag. */
export function makeBlurPage(stock: string): string {
  const at = stock.lastIndexOf("</")
  if (at < 0) throw new Failed(`the stock ${BLURPAGE}.html has no closing tag to put the menu script's loader before`)
  return stock.slice(0, at) + MENU_LOADER + stock.slice(at)
}

/**
 * Our VCockpit.js: the stock file with our blocks at their anchors, in the stock file's own
 * CRLF line ends. It refuses when an anchor is missing or appears twice, as a sim update
 * that moved one would leave our block in the wrong place or out.
 */
export function makeVCockpit(stock: string, blocks = BLOCKS, root = ROOT): string {
  const eol = stock.includes("\r\n") ? "\r\n" : "\n"
  const lines = stock.split(/\r?\n/)
  for (const { file, anchor, where } of blocks) {
    const at = lines.flatMap((line, i) => (line.includes(anchor) ? [i] : []))
    if (at.length !== 1) {
      throw new Failed(`the stock VCockpit.js holds "${anchor}" ${at.length} times, where our block from ${file} needs it once`)
    }
    const block = fs.readFileSync(path.join(root, file), "utf8").replace(/\r?\n$/, "").split(/\r?\n/)
    lines.splice(where === "before" ? at[0]! : at[0]! + 1, 0, ...block)
  }
  return lines.join(eol)
}

/**
 * Checks each built file: `node --check`, as CLAUDE.md asks of every panel file, then the
 * Coherent GT check, whose findings name our source's line. Throws `Failed` naming each.
 */
export function checkPages(built: Built[]): void {
  const findings: string[] = []
  for (const { file } of built.filter((b) => b.file.endsWith(".js"))) {
    const parsed = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" })
    if (parsed.status !== 0) findings.push(`${fromRoot(file)} doesn't parse:\n${parsed.stderr}`)
    for (const f of checkFile(file)) findings.push(format(fromRoot(file), f))
  }
  if (findings.length) throw new Failed(`our code in the sim runs what Coherent GT can't:\n${findings.join("\n")}`)
}
