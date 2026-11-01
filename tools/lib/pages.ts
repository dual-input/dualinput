// Builds our code in the sim: each esbuild bundle at es2017, the EFB app's stylesheet, fonts, and icon, and our VCockpit.js, made from
// the sim's stock file with our two blocks put in at named anchors; then checks each file
// against what Coherent GT runs (record/areas/build/01-the-build.md, "The Coherent GT check";
// record/areas/core/02-clients-and-panel-bridge.md, "Our VCockpit.js").

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { checkFile, format } from "coherent-checks"
import * as esbuild from "esbuild"

import { buildCss, KIT } from "./css.ts"
import { fromRoot, ROOT } from "./repo.ts"
import { Failed } from "./run.ts"
import { STOCK } from "./stock.ts"

/** Where the build writes our code in the sim, with each bundle's map beside it. */
export const PAGES = path.join(ROOT, "target", "sim-pages")

/** Our EFB app's folder, by whose name the EFB finds it, and the name its script and stylesheet take. `INTERNAL_NAME` in src/sim-package/pages/efb.tsx names it too. */
const EFB_APP = "html_ui/efb_ui/efb_apps/DualInput"

/** The banner's folder, which its panel definition names, src/sim-package/panel/InGamePanels/dualinput-banner.xml. */
const BANNER = "html_ui/InGamePanels/DualInput"

/** The source files the banner's classes can come from, on top of the kit's. */
const BANNER_CONTENT = ["src/platform/banner/src/**/*.{ts,tsx}", "src/packages/crew/src/**/*.{ts,tsx}"]

/** The source files the EFB app's classes can come from, on top of the kit's. */
const EFB_CONTENT = ["src/platform/efb-shell/src/**/*.{ts,tsx}", "src/packages/crew/src/**/*.{ts,tsx}", "src/sim-package/pages/efb.tsx", "src/features/*/efb/**/*.{ts,tsx}"]

/** Each bundle of the sim package's own, by its entry, and where our package puts it. */
const BUNDLES: { entry: string; to: string }[] = [
  { entry: "src/sim-package/pages/bridge.ts", to: "html_ui/DualInput/bridge.js" },
  { entry: "src/sim-package/pages/menu.ts", to: "html_ui/DualInput/menu.js" },
  { entry: "src/sim-package/pages/efb.tsx", to: `${EFB_APP}/DualInput.js` },
  { entry: "src/sim-package/pages/banner.tsx", to: `${BANNER}/banner.js` },
]

/**
 * Each feature's panel modules: every `.ts` file directly in a feature's `panel/` folder is one,
 * such as src/features/pointer-sync/panel/pointer-sync.ts, which the bridge loads as
 * /DualInput/modules/pointer-sync.js once the core names it, so deleting a feature's folder
 * takes its modules out of our package with no edit here
 * (record/areas/core/02-clients-and-panel-bridge.md, "Panel modules").
 */
function panelModules(root = ROOT): { entry: string; to: string }[] {
  const features = path.join(root, "src", "features")
  if (!fs.existsSync(features)) return []
  return fs.readdirSync(features).flatMap((feature) => {
    const panel = path.join(features, feature, "panel")
    if (!fs.existsSync(panel)) return []
    return fs
      .readdirSync(panel)
      .filter((f) => f.endsWith(".ts") && fs.statSync(path.join(panel, f)).isFile())
      .map((f) => ({ entry: `src/features/${feature}/panel/${f}`, to: `html_ui/DualInput/modules/${f.replace(/\.ts$/, ".js")}` }))
  })
}

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
export async function buildPages(out = PAGES): Promise<Built[]> {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const built: Built[] = []
  for (const { entry, to } of [...BUNDLES, ...panelModules()]) {
    const file = path.join(out, to.replace(/^html_ui\/DualInput\//, ""))
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
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    })
    for (const warning of result.warnings) console.warn(`warning: ${entry}: ${warning.text}`)
    built.push({ file, to })
  }
  built.push(...(await buildEfbAssets(out)), ...(await buildBannerAssets(out)))
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

/** What the EFB app takes beside its script: its stylesheet, whose fonts sit beside it, and its icon. */
async function buildEfbAssets(out: string): Promise<Built[]> {
  const dir = path.join(out, EFB_APP.replace(/^html_ui\//, ""))
  fs.mkdirSync(dir, { recursive: true })
  const css = path.join(dir, "DualInput.css")
  fs.writeFileSync(css, await buildCss(EFB_CONTENT))
  const fonts = path.join(KIT, "fonts")
  return [
    { file: css, to: `${EFB_APP}/DualInput.css` },
    ...fs.readdirSync(fonts).map((font) => ({ file: path.join(fonts, font), to: `${EFB_APP}/fonts/${font}` })),
    { file: path.join(ROOT, "src", "sim-package", "pages", "efb-icon.svg"), to: `${EFB_APP}/Assets/app-icon.svg` },
  ]
}

/** What the banner takes beside its script: its page, its stylesheet, whose fonts sit beside it, and the toolbar's icon, which 2024 looks for under html_ui/icons/toolbar/ (measured on MSFS 2024, 2026-10-04, record/areas/interface/log.md). */
async function buildBannerAssets(out: string): Promise<Built[]> {
  const dir = path.join(out, BANNER.replace(/^html_ui\//, ""))
  fs.mkdirSync(dir, { recursive: true })
  const css = path.join(dir, "banner.css")
  fs.writeFileSync(css, await buildCss(BANNER_CONTENT))
  const fonts = path.join(KIT, "fonts")
  const pages = path.join(ROOT, "src", "sim-package", "pages")
  return [
    { file: css, to: `${BANNER}/banner.css` },
    { file: path.join(pages, "banner.html"), to: `${BANNER}/banner.html` },
    ...fs.readdirSync(fonts).map((font) => ({ file: path.join(fonts, font), to: `${BANNER}/fonts/${font}` })),
    { file: path.join(pages, "banner-icon.svg"), to: "html_ui/icons/toolbar/ICON_TOOLBAR_DUALINPUT_BANNER.svg" },
  ]
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
  for (const { file } of built.filter((b) => b.file.endsWith(".js") || b.file.endsWith(".css"))) {
    if (file.endsWith(".js")) {
      const parsed = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" })
      if (parsed.status !== 0) findings.push(`${fromRoot(file)} doesn't parse:\n${parsed.stderr}`)
    }
    for (const f of checkFile(file)) findings.push(format(fromRoot(file), f))
  }
  if (findings.length) throw new Failed(`our code in the sim runs what Coherent GT can't:\n${findings.join("\n")}`)
}
