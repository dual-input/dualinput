// The sim's own files that our package ships changed copies of, kept byte for byte in
// src/sim-package/stock/ (record/areas/build/01-the-build.md, "The sim's stock files").

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./repo.ts"
import { Failed, output } from "./run.ts"

export const STOCK = path.join(ROOT, "src", "sim-package", "stock")
export const STOCK_JSON = path.join(STOCK, "stock.json")

/** Each stock file by its name in src/sim-package/stock/, and its path in the sim's Packages folder. */
export const STOCK_FILES: { name: string; from: string }[] = [
  { name: "VCockpit.js", from: "asobo-vcockpits-core/html_ui/Pages/VCockpit/Core/VCockpit.js" },
  // BlurPage, the menu's page our copy brings our menu script in through.
  {
    name: "{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html",
    from: "fs-base-ui/cookedcomps/{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html",
  },
  {
    name: "{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.json",
    from: "fs-base-ui/cookedcomps/{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.json",
  },
]

export type StockJson = {
  /** The sim's release, `FlightSimulator2024.exe`'s file version, such as 1.9.18.0. */
  sim: string
  /** The Steam branch the files came from, which is always `public`. */
  branch: string
  files: Record<string, { from: string; sha256: string }>
}

/** The Steam edition of the sim on this PC: its folder, its release, and the branch Steam installed. */
export type SteamSim = { folder: string; version: string; branch: string }

export function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase()
}

export function readStockJson(file = STOCK_JSON): StockJson {
  return JSON.parse(fs.readFileSync(file, "utf8")) as StockJson
}

/** The names of the files in `stock` whose bytes don't match `stock.json`, as CI checks them. */
export function stockMismatches(stock = STOCK): string[] {
  const json = readStockJson(path.join(stock, "stock.json"))
  return STOCK_FILES.filter(({ name }) => {
    const file = path.join(stock, name)
    return !fs.existsSync(file) || sha256(file) !== json.files[name]?.sha256
  }).map((f) => f.name)
}

/** The names of the stock files whose copy in the sim differs from `stock.json`'s. */
export function changedInSim(sim: SteamSim, json = readStockJson()): string[] {
  return STOCK_FILES.filter(({ name, from }) => {
    const file = path.join(sim.folder, "Packages", from)
    return !fs.existsSync(file) || sha256(file) !== json.files[name]?.sha256
  }).map((f) => f.name)
}

/**
 * The sim's Steam edition, found through Steam's `libraryfolders.vdf` as p10's build finds it
 * (read in experiments/areas/interface/menu/build.mjs), or `null` on a PC without it, such as
 * CI's runner.
 */
export function steamSim(steam = steamFolder()): SteamSim | null {
  const vdf = path.join(steam, "steamapps", "libraryfolders.vdf")
  if (!fs.existsSync(vdf)) return null
  const libraries = [...fs.readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1]!.replace(/\\\\/g, "\\"))
  for (const library of libraries) {
    const folder = path.join(library, "steamapps", "common", "Limitless")
    if (!fs.existsSync(folder)) continue
    return { folder, version: fileVersion(path.join(folder, "FlightSimulator2024.exe")), branch: branch(library) }
  }
  return null
}

/** Steam's folder, from the registry, or its default when the registry names none. */
function steamFolder(): string {
  try {
    const text = output("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"])
    const found = /SteamPath\s+REG_SZ\s+(.+)/.exec(text)?.[1]?.trim()
    if (found) return path.normalize(found)
  } catch (error) {
    if (!(error instanceof Failed)) throw error
  }
  return "C:\\Program Files (x86)\\Steam"
}

/**
 * The branch Steam installed, from the app manifest's `BetaKey` in its `MountedConfig`
 * block, which names what's on disk; `UserConfig`'s names what the pilot picked.
 */
function branch(library: string): string {
  const acf = path.join(library, "steamapps", "appmanifest_2537590.acf")
  if (!fs.existsSync(acf)) throw new Failed(`${acf} is missing, so the sim's Steam branch is unknown`)
  const text = fs.readFileSync(acf, "utf8")
  const mounted = text.slice(Math.max(0, text.indexOf('"MountedConfig"')))
  return /"BetaKey"\s+"([^"]*)"/.exec(mounted)?.[1] || "public"
}

function fileVersion(exe: string): string {
  const text = output("powershell", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${exe}').VersionInfo.FileVersion`])
  return text.trim().replace(/,\s*/g, ".")
}

/**
 * Stops a build when a stock file in the tree doesn't match `stock.json`, or when the sim on
 * this PC ships a stock file that differs from it, since our copies would then carry the
 * sim's old code. A beta branch only warns, so a beta's files never reach pilots on the
 * public sim through `tools/stock.ts`.
 */
export function checkStock(): void {
  const mismatched = stockMismatches()
  if (mismatched.length) throw new Failed(`src/sim-package/stock/ doesn't match its stock.json: ${mismatched.join(", ")}`)
  const sim = steamSim()
  if (!sim) return
  const changed = changedInSim(sim)
  if (!changed.length) return
  const what = `the sim's ${changed.join(", ")} differ${changed.length === 1 ? "s" : ""} from src/sim-package/stock/`
  if (sim.branch !== "public") {
    console.warn(`warning: ${what}, on Steam's ${sim.branch} branch; the build goes on with the public branch's files`)
    return
  }
  throw new Failed(`${what}, so a sim update changed them; run node tools/stock.ts to copy them in, and commit what it changed`)
}
