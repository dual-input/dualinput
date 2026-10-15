/*
 * p12: two things the map check of 02-code-map's "The workspace" leans on
 * (architecture plan, node 5.4):
 *
 *   1. Does Cargo take globs in `default-members` as in `members`, so deleting a
 *      feature's folder needs no edit to the root Cargo.toml, while a crate left
 *      out of `default-members` stays out of a plain `cargo build`?
 *   2. Does esbuild's metafile list a type-only import, which a map check reading
 *      it would need to see one feature importing another's types?
 *
 *   node experiments/areas/architecture/p12-map-inputs.mjs
 *
 * It writes a throwaway Cargo workspace and two TypeScript files into a folder
 * of the OS's temp directory, and uses p07's esbuild (types/node_modules).
 * Nothing here touches the sim.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const require = createRequire(import.meta.url)
const esbuild = require(path.join(REPO, "experiments", "areas", "architecture", "types", "node_modules", "esbuild"))

const lines = []
const say = (s = "") => { lines.push(s); console.log(s) }
const write = (root, rel, text) => {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crosscheck-p12-"))
say(`p12 ${new Date().toISOString()}`)
say(`cargo: ${spawnSync("cargo", ["--version"], { encoding: "utf8" }).stdout.trim()}`)
say(`esbuild: ${esbuild.version}`)
say()

// 1. Globs in both lists. features/a/core and features/b/core match
// features/*/core; apps/core is a default member; apps/wasm-module isn't, and
// its build script fails, so a plain build that tried it would fail.
say("1. Cargo globs")
const ws = path.join(dir, "cargo")
write(ws, "Cargo.toml", `[workspace]
members = ["features/*/core", "apps/core", "apps/wasm-module"]
default-members = ["features/*/core", "apps/core"]
resolver = "3"
`)
for (const f of ["a", "b"]) {
  write(ws, `features/${f}/core/Cargo.toml`, `[package]\nname = "feature-${f}"\nversion = "0.1.0"\nedition = "2024"\n`)
  write(ws, `features/${f}/core/src/lib.rs`, "")
}
write(ws, "apps/core/Cargo.toml", `[package]\nname = "app-core"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nfeature-a = { path = "../../features/a/core" }\nfeature-b = { path = "../../features/b/core" }\n`)
write(ws, "apps/core/src/main.rs", "fn main() {}\n")
write(ws, "apps/wasm-module/Cargo.toml", `[package]\nname = "wasm-module"\nversion = "0.1.0"\nedition = "2024"\n`)
write(ws, "apps/wasm-module/build.rs", `fn main() { panic!("built outside cargo-msfs") }\n`)
write(ws, "apps/wasm-module/src/lib.rs", "")
const build = spawnSync("cargo", ["build"], { cwd: ws, encoding: "utf8" })
const built = [...`${build.stdout}${build.stderr}`.matchAll(/Compiling (\S+) v/g)].map((m) => m[1]).sort()
say(`  cargo build at the root: ${build.status === 0 ? "ok" : `failed (exit ${build.status})`}, compiled ${built.join(", ")}`)
const meta = JSON.parse(spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], { cwd: ws, encoding: "utf8" }).stdout)
say(`  members: ${meta.workspace_members.length}, default members: ${meta.workspace_default_members?.length ?? "not reported"}`)
say()

// 2. A type-only import from another feature's file.
say("2. esbuild's metafile and a type-only import")
const ts = path.join(dir, "ts")
write(ts, "features/b/panel/press.ts", "export interface Press { x: number; y: number }\nexport const kind = 'press'\n")
write(ts, "features/a/panel/types-only.ts", "import type { Press } from '../../b/panel/press'\nexport function f(p: Press): number { return p.x }\n")
write(ts, "features/a/panel/value.ts", "import { kind } from '../../b/panel/press'\nexport const k = kind\n")
for (const entry of ["types-only.ts", "value.ts"]) {
  const r = await esbuild.build({ entryPoints: [path.join(ts, "features", "a", "panel", entry)], bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent" })
  const inputs = r.metafile.inputs
  const own = Object.keys(inputs).find((k) => k.endsWith(entry))
  const imports = inputs[own].imports.map((i) => `${i.path.replace(/\\/g, "/").split("/").slice(-3).join("/")} (${i.kind})`)
  say(`  ${entry}: the metafile lists ${imports.length ? imports.join(", ") : "no import"}`)
}

fs.rmSync(dir, { recursive: true, force: true })
const file = saveResult("architecture", "p12-map-inputs", lines.join("\n"))
console.log(`\nsaved ${repoRelative(file)}`)
