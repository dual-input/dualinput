/*
 * Builds the crosscheck-p12-follow module and installs its package into the
 * Community folder, with MSFS closed.
 *
 *   node experiments/areas/avatars/wasm/build.mjs
 *
 * The steps are fsc-editor's (fsc-editor, link/build.sh and link/README.md),
 * each there because a shortcut failed only in the sim:
 *
 *   1. MSBuild through the MSFS2024 platform toolset, which owns the flags.
 *   2. An export check: a module without the allocator exports MSFS calls
 *      into registers and is never scheduled.
 *   3. fspackagetool, which writes manifest.json and drives the sim's
 *      executable, so it hangs rather than fails while MSFS is running.
 *   4. layout.json, which fspackagetool doesn't write, with each date as a
 *      bare Windows FILETIME number.
 *
 * Then it copies the package into Community. A package is read when the sim
 * starts, so start MSFS after this.
 *
 * To take it out again, delete the crosscheck-p12-follow folder from
 * Community.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAME = "crosscheck-p12-follow"
const SDK = process.env.MSFS_SDK ?? "C:/MSFS 2024 SDK"
const PACKAGE_TOOL = path.join(SDK, "Tools", "bin", "fspackagetool.exe")
const WASM = path.join(HERE, "PackageSources", "Modules", `${NAME}.wasm`)
const BUILT = path.join(HERE, "Packages", NAME)

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

// ------------------------------------------------ before anything

const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
if (/"FlightSimulator2024\.exe"/i.test(tasks)) die("MSFS is running. fspackagetool drives the sim's executable and hangs while it runs: close the sim and run this again.")

const msbuild = process.env.MSBUILD ?? ["Enterprise", "Professional", "Community", "BuildTools"]
  .map((e) => `C:/Program Files/Microsoft Visual Studio/2022/${e}/MSBuild/Current/Bin/MSBuild.exe`)
  .find((p) => fs.existsSync(p))
if (!msbuild) die("No MSBuild found: install Visual Studio 2022 with the MSFS platform toolset, or set MSBUILD.")
if (!fs.existsSync(PACKAGE_TOOL)) die(`No fspackagetool at ${PACKAGE_TOOL}: set MSFS_SDK.`)

// UserCfg.opt's InstalledPackagesPath, the way record/learn/foundations/02-01
// says the packages are found.
function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!fs.existsSync(cfg)) die(`No UserCfg.opt at ${cfg}.`)
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  const packages = line?.match(/"([^"]+)"/)?.[1]
  const dir = packages && path.join(packages, "Community")
  if (!dir || !fs.existsSync(dir)) die(`No Community folder from ${cfg}.`)
  return dir
}
const COMMUNITY = community()

// ------------------------------------------------ 1. the module

// Deleted first, so a failed compile can't leave an old binary for the check.
fs.rmSync(WASM, { force: true })
console.log("building the module (MSFS2024 toolset)...")
const b = spawnSync(msbuild, [path.join(HERE, `${NAME}.vcxproj`), "-p:Configuration=Release", "-p:Platform=MSFS", "-v:minimal", "-nologo"], { stdio: "inherit" })
if (b.status !== 0 || !fs.existsSync(WASM)) die("The build produced no module.")

// ------------------------------------------------ 2. the exports

// The required list is fsc-editor's, from FS Copilot's working module and the
// toolset's own link line (fsc-editor, link/tools/check.mjs).
const REQUIRED = ["malloc", "free", "mallinfo", "mchunkit_begin", "mchunkit_next", "get_pages_state", "mark_decommit_pages", "__wasm_call_ctors", "GetSimConnectVersion", "module_init", "module_deinit", "Update_StandAlone"]

function exportsOf(file) {
  const buf = fs.readFileSync(file)
  let o = 8
  const u = () => { let r = 0, s = 0, y; do { y = buf[o++]; r |= (y & 0x7f) << s; s += 7 } while (y & 0x80); return r >>> 0 }
  const str = () => { const n = u(); const s = buf.toString("utf8", o, o + n); o += n; return s }
  const names = []
  while (o < buf.length) {
    const id = buf[o++]
    const size = u()
    const end = o + size
    if (id === 7) {
      const n = u()
      for (let i = 0; i < n; i++) { const nm = str(); const kind = buf[o++]; u(); if (kind === 0) names.push(nm) }
    }
    o = end
  }
  return new Set(names)
}
const missing = REQUIRED.filter((n) => !exportsOf(WASM).has(n))
if (missing.length) die(`The module is missing exports MSFS needs: ${missing.join(", ")}. It would load and never run.`)
console.log(`exports OK: all ${REQUIRED.length} present`)

// ------------------------------------------------ 3. the package

// The hand sphere's glTF is generated, so it's written fresh for each build.
const s = spawnSync(process.execPath, [path.join(HERE, "tools", "sphere.mjs")], { stdio: "inherit" })
if (s.status !== 0) die("tools/sphere.mjs failed.")

console.log("packaging (fspackagetool)...")
const p = spawnSync(PACKAGE_TOOL, [path.join(HERE, "project.xml"), "-nopause"], { stdio: "inherit", cwd: HERE })
if (p.status !== 0 || !fs.existsSync(path.join(BUILT, "manifest.json"))) die(`fspackagetool wrote no package at ${BUILT}.`)

// ------------------------------------------------ 4. layout.json

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
const files = []
;(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r)
    else if (e.name !== "layout.json" && e.name !== "manifest.json") files.push({ path: r.toLowerCase(), size: fs.statSync(abs).size, date: filetime(fs.statSync(abs).mtimeMs) })
  }
})(BUILT, "")
const rows = files.map((f) => `    {\n      "path": ${JSON.stringify(f.path)},\n      "size": ${f.size},\n      "date": ${f.date}\n    }`).join(",\n")
fs.writeFileSync(path.join(BUILT, "layout.json"), `{\n  "content": [\n${rows}\n  ]\n}\n`)
console.log(`layout.json written: ${files.length} file(s)`)

// ------------------------------------------------ install

const target = path.join(COMMUNITY, NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(BUILT, target, { recursive: true })
console.log(`\ninstalled to Community\\${NAME}. Start MSFS: packages are read at startup.`)
