/*
 * p16: where an aircraft's version can be read on disk, for the preflight
 * match check (record/areas/session/02-units.md), with no sim running.
 *
 * A package's version is package_version in its manifest.json
 * (record/learn/foundations/07-aircraft-specific-systems.md), and 03-v1-scope
 * says a streamed Marketplace copy has none in its folder. This lists every
 * folder under UserCfg.opt's InstalledPackagesPath, counts the packages in
 * each and how many have a manifest.json with a package_version, and for the
 * streamed packages, what each holds at its top. It also lists the attributes
 * the sim's Content.xml gives a package.
 *
 *   node experiments/areas/aircraft/p16-package-versions.mjs
 *
 * Output: the report on the console and in
 * experiments/areas/aircraft/results/p16-package-versions-<time>.txt.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { scrub } from "./lib/out.mjs"
import { saveResult } from "../../tools/results.mjs"

// The Steam edition keeps UserCfg.opt under %APPDATA%, and the Microsoft Store
// edition under its package's LocalCache (record/learn/foundations/
// 02-01-installs-and-packages.md).
const CANDIDATES = [
  join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt"),
  join(process.env.LOCALAPPDATA ?? "", "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"),
]

const cfg = CANDIDATES.find((p) => existsSync(p))
if (!cfg) throw new Error("no UserCfg.opt found for either edition")
const line = readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/.test(l))
const root = line.replace(/^\s*InstalledPackagesPath\s+"?/, "").replace(/"\s*$/, "")

// A Community entry can be a link whose target is gone, which statSync throws on.
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const dirs = (p) => readdirSync(p).filter((n) => isDir(join(p, n)))
const versionOf = (pkg) => {
  const m = join(pkg, "manifest.json")
  if (!existsSync(m)) return null
  try { return JSON.parse(readFileSync(m, "utf8")).package_version ?? "no package_version" } catch { return "unreadable" }
}

// Official2024 and Official2020 hold a folder per store, such as Steam, with
// the packages inside it.
function packagesIn(folder) {
  const here = dirs(folder)
  const stores = here.filter((n) => !existsSync(join(folder, n, "manifest.json")) && dirs(join(folder, n)).some((c) => existsSync(join(folder, n, c, "manifest.json"))))
  if (/^Official/i.test(folder.split(/[\\/]/).pop()) && stores.length) return stores.flatMap((s) => dirs(join(folder, s)).map((p) => join(folder, s, p)))
  return here.map((p) => join(folder, p))
}

const report = [
  "p16 · Where an aircraft's version can be read on disk",
  `${new Date().toISOString()}, UserCfg.opt at ${scrub(cfg)}`,
  `InstalledPackagesPath: ${scrub(root)}`,
  "",
]

for (const name of dirs(root)) {
  const pkgs = packagesIn(join(root, name))
  const versions = pkgs.map(versionOf)
  const withVersion = versions.filter((v) => v && !/^no |unreadable/.test(v)).length
  const aircraft = pkgs.filter((p) => /aircraft/i.test(p.split(/[\\/]/).pop()) && !/livery/i.test(p))
  report.push(`${name}: ${pkgs.length} packages, ${versions.filter(Boolean).length} with a manifest.json, ${withVersion} with a package_version; ${aircraft.length} whose name has "aircraft" and not "livery"`)
  if (/^streamed/i.test(name)) {
    const tops = new Map()
    for (const p of pkgs) {
      const key = readdirSync(p).sort().join(", ")
      tops.set(key, [...(tops.get(key) ?? []), p.split(/[\\/]/).pop()])
    }
    for (const [key, names] of tops) {
      report.push(`  ${names.length} hold at their top: ${key}${names.length <= 5 ? ` (${names.join(", ")})` : ""}`)
    }
    for (const p of pkgs.filter((x) => existsSync(join(x, "on-demand.json")))) {
      const keys = Object.keys(JSON.parse(readFileSync(join(p, "on-demand.json"), "utf8")))
      report.push(`  ${p.split(/[\\/]/).pop()}'s on-demand.json has the keys: ${keys.join(", ")}`)
    }
  }
}

const content = join(root, "..", "Content.xml")
if (existsSync(content)) {
  const attrs = new Set()
  for (const m of readFileSync(content, "utf8").matchAll(/<Package\s+([^>]*?)\/?>/g)) {
    for (const a of m[1].matchAll(/(\w+)=/g)) attrs.add(a[1])
  }
  report.push("", `Content.xml beside the packages folder gives each package the attributes: ${[...attrs].join(", ")}`)
}

const text = report.join("\n")
console.log(text)
console.log(`\nsaved ${scrub(saveResult("aircraft", "p16-package-versions", text))}`)
