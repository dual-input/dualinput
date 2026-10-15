/*
 * p11: can one Cargo workspace hold the core's crates and our WASM module, so the
 * module, its host, and its routines build against the same message crate the
 * core does (architecture plan, node 5.4)? p08 kept its module out of its
 * workspace (flight/Cargo.toml, exclude = ["module"]), and nobody tried it in.
 *
 *   node experiments/areas/architecture/p11-workspace.mjs [--clean]
 *
 * workspace/ holds a stand-in for the message crate, the module's host, one
 * routine (Follow), the module, a cdylib for cargo-msfs, and a Windows program
 * that runs the host and Follow natively, as the core's stand-in sim would. The
 * probe builds the Windows side with cargo, tests it, builds the module with
 * cargo-msfs from its own folder, checks the module's exports against what the
 * sim calls and its imports against p08's module, which ran in the sim, then
 * builds each side again to see whether switching between them rebuilds
 * anything. --clean deletes workspace/target first, for a cold build's times.
 *
 * Needs Rust, cargo-msfs with its SDK (module/build.mjs in p03 says how), and
 * LLVM for bindgen's libclang, which scoop installs with `scoop install llvm`.
 * Nothing here touches the sim.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "architecture")
const WS = path.join(HERE, "workspace")
const WASM = path.join(WS, "build", "crosscheck-p11.wasm")
const P08 = path.join(HERE, "flight", "build", "crosscheck-p08.wasm")

// What the sim calls in a standalone module (p03's module/build.mjs, from
// fsc-editor's link/tools/check.mjs and 05-03).
const REQUIRED = ["module_init", "module_deinit", "Update_StandAlone", "malloc", "free", "mallinfo", "mchunkit_begin", "mchunkit_next", "get_pages_state", "mark_decommit_pages", "__wasm_call_ctors"]

const llvm = path.join(process.env.USERPROFILE, "scoop", "apps", "llvm", "current", "bin")
const env = { ...process.env, LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? llvm, PATH: `${llvm};${process.env.PATH}` }
// cargo-msfs passes its flags in RUSTFLAGS, then hands the build our whole
// environment, so one of ours would replace them (read in navigraph/cargo-msfs
// v1.1.0, src/main.rs, Build).
delete env.RUSTFLAGS

const lines = []
const say = (s = "") => { lines.push(s); console.log(s) }

function run(label, cmd, args, cwd = WS) {
  const t0 = performance.now()
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8" })
  const s = ((performance.now() - t0) / 1000).toFixed(1)
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  const compiled = (out.match(/^\s*Compiling /gm) ?? []).length
  say(`${label}: ${r.status === 0 ? "ok" : `FAILED (exit ${r.status})`}, ${s}s, ${compiled} crates compiled`)
  if (r.status !== 0) say(out.split("\n").slice(-25).join("\n"))
  return { ok: r.status === 0, out, compiled, s }
}

function shape(file) {
  const m = new WebAssembly.Module(fs.readFileSync(file))
  return {
    exports: WebAssembly.Module.exports(m).map((e) => e.name),
    imports: WebAssembly.Module.imports(m).map((i) => `${i.module}.${i.name}`),
  }
}

say(`p11 ${new Date().toISOString()}`)
say(`rust: ${spawnSync("rustc", ["--version"], { encoding: "utf8" }).stdout.trim()}`)
if (process.argv.includes("--clean")) fs.rmSync(path.join(WS, "target"), { recursive: true, force: true })
fs.mkdirSync(path.dirname(WASM), { recursive: true })
say()

say("1. The Windows side and the module, each built once")
run("cargo build --release, the default members", "cargo", ["build", "--release"])
const tests = run("cargo test, the default members", "cargo", ["test"])
const passed = [...tests.out.matchAll(/test result: ok\. (\d+) passed/g)].reduce((n, m) => n + Number(m[1]), 0)
say(`  tests passed: ${passed}`)
run("cargo-msfs build msfs2024, from module/", "cargo-msfs", ["build", "msfs2024", "-i", path.join(WS, "module"), "-o", WASM], REPO)
say()

say("2. The module's shape")
if (fs.existsSync(WASM)) {
  const p11 = shape(WASM)
  say(`  size: ${fs.statSync(WASM).size} bytes`)
  const missing = REQUIRED.filter((e) => !p11.exports.includes(e))
  say(`  required exports missing: ${missing.length ? missing.join(", ") : "none"}`)
  say(`  imports: ${p11.imports.length}`)
  for (const i of p11.imports) say(`    ${i}`)
  if (fs.existsSync(P08)) {
    const p08 = shape(P08)
    const extra = p11.imports.filter((i) => !p08.imports.includes(i))
    say(`  imports p08's module, which ran in the sim, lacks: ${extra.length ? extra.join(", ") : "none"}`)
  }
} else say("  no .wasm")
say()

say("3. Switching between the two builds")
run("cargo build --release again", "cargo", ["build", "--release"])
run("cargo-msfs build again", "cargo-msfs", ["build", "msfs2024", "-i", path.join(WS, "module"), "-o", WASM], REPO)
run("cargo build --release once more", "cargo", ["build", "--release"])
say()

say("4. The module's host and Follow, run natively by the Windows program")
const native = run("cargo run --release -p p11-core", "cargo", ["run", "--release", "-q", "-p", "p11-core"])
for (const l of native.out.trim().split("\n")) say(`  ${l}`)

const file = saveResult("architecture", "p11-workspace", lines.join("\n"))
console.log(`\nsaved ${repoRelative(file)}`)
