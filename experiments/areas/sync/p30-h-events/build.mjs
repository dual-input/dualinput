/*
 * Builds p30's module and its package, dualinput-p30-h-events, and with --install puts the
 * package in the Community folder, as p08's build.mjs does. The sim reads packages when it
 * starts, so --install refuses while it runs.
 *
 *   node experiments/areas/sync/p30-h-events/build.mjs [--install]
 *
 * Needs cargo-msfs with its SDK and LLVM for bindgen's libclang, as p08's build says.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { REPO } from "../../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "sync", "p30-h-events")
const BUILD = path.join(HERE, "build")
const PACKAGE = "dualinput-p30-h-events"

const die = (why) => {
  console.error(`\n${why}`)
  process.exit(1)
}
const llvm = path.join(process.env.USERPROFILE, "scoop", "apps", "llvm", "current", "bin")
const env = { ...process.env, LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? llvm, PATH: `${llvm};${process.env.PATH}` }

fs.rmSync(BUILD, { recursive: true, force: true })
fs.mkdirSync(path.join(BUILD, PACKAGE, "modules"), { recursive: true })
const wasm = path.join(BUILD, "dualinput-p30.wasm")
execFileSync("cargo-msfs", ["build", "msfs2024", "-i", path.join(HERE, "module"), "-o", wasm], { stdio: "inherit", env })
fs.copyFileSync(wasm, path.join(BUILD, PACKAGE, "modules", "dualinput-p30.wasm"))

// layout.json lists every file with its size and a FILETIME date, past Number.MAX_SAFE_INTEGER,
// written as a bare number (fsc-editor, link/tools/layout.mjs); manifest.json names the package.
const dir = path.join(BUILD, PACKAGE)
const files = fs.readdirSync(path.join(dir, "modules")).map((f) => ({ path: `modules/${f}`, size: fs.statSync(path.join(dir, "modules", f)).size }))
const date = ((BigInt(Date.now()) + 11644473600000n) * 10000n).toString()
fs.writeFileSync(path.join(dir, "layout.json"), `{\n  "content": [\n${files.map((f) => `    {\n      "path": "${f.path}",\n      "size": ${f.size},\n      "date": ${date}\n    }`).join(",\n")}\n  ]\n}\n`)
fs.writeFileSync(
  path.join(dir, "manifest.json"),
  JSON.stringify(
    {
      dependencies: [],
      content_type: "MISC",
      title: "Dual Input p30 H: events",
      manufacturer: "",
      creator: "Dual Input",
      package_version: "0.1.0",
      minimum_game_version: "1.8.14",
      export_type: "Community",
      builder: "Microsoft Flight Simulator 2024",
      package_order_hint: "",
      release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
      total_package_size: String(files.reduce((s, f) => s + f.size, 0)),
    },
    null,
    2,
  ) + "\n",
)
console.log(`packaged ${PACKAGE}`)

if (process.argv.includes("--install")) {
  const running = execFileSync("tasklist", ["/FI", "IMAGENAME eq FlightSimulator2024.exe", "/NH"], { encoding: "utf8" }).includes("FlightSimulator2024.exe")
  if (running) die("not installed: the sim is running, and reads packages only at boot")
  const cfg = fs.readFileSync(path.join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "UserCfg.opt"), "utf8")
  const root = /InstalledPackagesPath\s+"([^"]+)"/.exec(cfg)?.[1]
  if (!root) die("not installed: no InstalledPackagesPath in UserCfg.opt")
  const dest = path.join(root, "Community", PACKAGE)
  // Replaces only this probe's own package.
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(dir, dest, { recursive: true })
  console.log(`installed ${PACKAGE} into the Community folder`)
}
