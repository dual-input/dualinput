import fs from "node:fs"
import path from "node:path"

import { COMPILED, OBJECT } from "./figure.ts"
import type { Built } from "./pages.ts"
import { ROOT } from "./repo.ts"
import { Failed } from "./run.ts"

/** Our package's folder in each packages folder's Community, by which the sim names it. */
export const PACKAGE_NAME = "dualinput"

/** Where the build lays out our package. */
export const PACKAGE = path.join(ROOT, "target", "sim-package", PACKAGE_NAME)

/** Dual Input's version, from the root Cargo.toml's `[workspace.package]`, which every crate inherits. */
export function workspaceVersion(root = ROOT): string {
  const lines = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8").split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === "[workspace.package]")
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (line.trim().startsWith("[")) break
    const version = /^\s*version\s*=\s*"([^"]+)"/.exec(line)?.[1]
    if (version) return version
  }
  throw new Failed("the root Cargo.toml's [workspace.package] names no version")
}

/**
 * Lays out our package in `dir`: the WASM module in `wasm` as `modules/dualinput.wasm`, our
 * code in the sim from `pages`, each where it says, avatars' figure as fspackagetool compiled
 * it, then the `layout.json` and `manifest.json` that make the folder a package the sim
 * mounts. It empties `dir` first, so the package holds only what this build made.
 */
export function layOutPackage(wasm: string, pages: Built[], dir = PACKAGE, version = workspaceVersion(), figure = COMPILED): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, "modules"), { recursive: true })
  fs.copyFileSync(wasm, path.join(dir, "modules", `${PACKAGE_NAME}.wasm`))
  for (const { file, to } of pages) {
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true })
    fs.copyFileSync(file, path.join(dir, to))
  }
  // Before its first compile the figure has no compiled/, which tools/check.ts reports.
  if (fs.existsSync(figure)) fs.cpSync(figure, path.join(dir, OBJECT), { recursive: true })

  // layout.json lists every file with its size and last write as a Windows FILETIME, 100ns
  // ticks since 1601, written as a bare number though it's past what a JavaScript number
  // holds exactly, which JSON.stringify can't write. p08's package was laid out this way,
  // and the sim mounted it and ran its module in a flight (record/areas/architecture/log.md).
  const files = filesIn(dir)
  const entries = files.map(
    (f) => `    {\n      "path": "${f.path}",\n      "size": ${f.size},\n      "date": ${filetime(f.written)}\n    }`,
  )
  fs.writeFileSync(path.join(dir, "layout.json"), `{\n  "content": [\n${entries.join(",\n")}\n  ]\n}\n`)

  // The fields p08's package carried, with the order hint FS Copilot's package takes, whose
  // VCockpit.js override ran in a cockpit's panels (record/areas/build/01-the-build.md, "Our
  // package").
  const manifest = {
    dependencies: [],
    content_type: "MISC",
    title: "Dual Input",
    manufacturer: "",
    creator: "Dual Input",
    package_version: version,
    minimum_game_version: "1.8.14",
    export_type: "Community",
    builder: "Microsoft Flight Simulator 2024",
    package_order_hint: "PANEL_PATCH",
    release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
    total_package_size: String(files.reduce((sum, f) => sum + f.size, 0)),
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

type PackageFile = { path: string; size: number; written: number }

/** Every file under `dir`, by its path from `dir` with `/` between folders, in order of path. */
function filesIn(dir: string): PackageFile[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const full = path.join(e.parentPath, e.name)
      const stat = fs.statSync(full)
      return { path: path.relative(dir, full).split(path.sep).join("/"), size: stat.size, written: stat.mtimeMs }
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** A time in ms since 1970 as a Windows FILETIME, in 100ns ticks since 1601. */
function filetime(ms: number): string {
  return ((BigInt(Math.floor(ms)) + 11_644_473_600_000n) * 10_000n).toString()
}
