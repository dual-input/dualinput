/*
 * Builds dualinput-p25-efb, the EFB app's sample on a stand-in core, and installs it into the Community folder
 * in place of p24's package, which it deletes.
 *
 *   node experiments/areas/interface/p25-efb-sample/build-efb.mjs [--no-install]
 *
 * The Community folder is under %APPDATA%, which the Claude desktop app's shell sees through a private
 * copy, so run this from a terminal outside it, with the sim closed, since the sim reads packages when
 * it starts. To take the package out, delete dualinput-p25-efb from Community.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

import { buildCss, KIT } from "../../../../tools/lib/css.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const NAME = "dualinput-p25-efb"
const OLD = "dualinput-p24-efb"
const INTERNAL = "DualInputP25"
const OUT = path.join(HERE, "package", NAME)
const DIR = `html_ui/efb_ui/efb_apps/${INTERNAL}`

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!fs.existsSync(cfg)) die("No UserCfg.opt in its usual folder.")
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  const packages = line?.match(/"([^"]+)"/)?.[1]
  const dir = packages && path.join(packages, "Community")
  if (!dir || !fs.existsSync(dir)) die("No Community folder from UserCfg.opt.")
  return dir
}

const write = (rel, data) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  return file
}

fs.rmSync(path.join(HERE, "package"), { recursive: true, force: true })

const bundled = await esbuild.build({
  entryPoints: [path.join(HERE, "app-efb.tsx")],
  absWorkingDir: ROOT,
  bundle: true,
  format: "iife",
  target: "es2017",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  logLevel: "warning",
})
const jsFile = write(`${DIR}/${INTERNAL}.js`, bundled.outputFiles[0].text)
const cssFile = write(`${DIR}/${INTERNAL}.css`, await buildCss(["src/platform/efb-shell/src/**/*.{ts,tsx}", "src/platform/efb-shell/dev/**/*.{ts,tsx}"]))
for (const font of fs.readdirSync(path.join(KIT, "fonts"))) write(`${DIR}/fonts/${font}`, fs.readFileSync(path.join(KIT, "fonts", font)))
fs.copyFileSync(path.join(ROOT, "src/sim-package/pages/efb-icon.svg"), (fs.mkdirSync(path.join(OUT, DIR, "Assets"), { recursive: true }), path.join(OUT, DIR, "Assets/app-icon.svg")))

const syntax = spawnSync(process.execPath, ["--check", jsFile], { stdio: "inherit" })
if (syntax.status !== 0) die(`${INTERNAL}.js doesn't parse.`)
const coherent = spawnSync(process.execPath, ["node_modules/coherent-checks/dist/main.js", jsFile, cssFile], { cwd: ROOT, stdio: "inherit" })
if (coherent.status !== 0) die("It fails the Coherent GT check.")

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
const files = []
;(function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const abs = path.join(d, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r)
    else files.push({ path: r, size: fs.statSync(abs).size, date: filetime(fs.statSync(abs).mtimeMs) })
  }
})(OUT, "")
fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify({ content: files }, null, 2) + "\n")
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  dependencies: [],
  content_type: "MISC",
  title: "Dual Input p25 sample",
  manufacturer: "",
  creator: "Dual Input",
  package_version: "0.1.0",
  minimum_game_version: "0.0.0",
  release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
  package_order_hint: "NONE",
  total_package_size: files.reduce((s, f) => s + f.size, 0),
}, null, 2) + "\n")
console.log(`${INTERNAL} written: ${files.length} files, ${(fs.statSync(jsFile).size / 1024).toFixed(0)} KB of script`)
if (process.argv.includes("--no-install")) process.exit(0)

const running = execFileSync("tasklist", ["/FI", "IMAGENAME eq FlightSimulator2024.exe"], { encoding: "utf8" })
if (/FlightSimulator2024/i.test(running)) die("The sim is running, and it reads packages only when it starts. Close it first.")
const packages = community()
fs.rmSync(path.join(packages, OLD), { recursive: true, force: true })
const target = path.join(packages, NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(OUT, target, { recursive: true })
console.log(`took out ${OLD}, and installed Community\\${NAME}. Start MSFS: packages are read at startup.`)
