/*
 * p07: which of ts-rs, specta, and typeshare generates TypeScript types from a
 * Rust crate of messages that match what serde_json sends; whether the same
 * messages reach TypeScript running in QuickJS-ng through rquickjs; and whether
 * the data slots' structs keep one layout on x86_64 and wasm32 (architecture
 * plan, node 1.4.1). Needs no sim.
 *
 *   node experiments/areas/architecture/p07-types.mjs
 *
 * Install esbuild and TypeScript once with `npm ci` in types/. The first run
 * builds typeshare's command-line tool into types/.tools with cargo install.
 *
 *   1. Each generator writes TypeScript for types/messages, the way its docs say,
 *      and then with the opt-in its own error asks for, where it refuses.
 *   2. TypeScript's compiler, under --strict, checks every sample message as
 *      serde_json wrote it against each generator's types, and checks that
 *      deliberately wrong messages fail (each marked @ts-expect-error, so a type
 *      too loose to catch one is an error too).
 *   3. The plugin in types/ts/plugin.ts is type-checked against each
 *      generator's types, then bundled once and run in QuickJS-ng by
 *      p07-quickjs, which sends each sample and compares the reply.
 *   4. types/slots builds for x86_64 and for wasm32-wasip1; its compile-time
 *      assertions hold on both or the build fails. The probe also reads the
 *      layout back from each build.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const TYPES = path.join(REPO, "experiments", "areas", "architecture", "types")
const GEN = path.join(TYPES, "gen")
const DIST = path.join(TYPES, "dist")
const TYPESHARE = path.join(TYPES, ".tools", "bin", "typeshare.exe")
const TYPESHARE_VERSION = "1.13.4"
const TSC = path.join(TYPES, "node_modules", "typescript", "bin", "tsc")

// typeshare's errors name files by absolute path, which would put a home folder
// in the result, so every line names them from the repository instead.
const out = []
const note = (s = "") => {
  s = s.split(REPO + path.sep).join("")
  console.log(s)
  out.push(s)
}
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: TYPES, encoding: "utf8", windowsHide: true, ...opts })
const firstError = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[^\]]*\]\s*ERROR\s*\[[^\]]*\]\s*/, "").trim())
    .find((l) => /error|failed|forbid|unsupported/i.test(l)) ?? text.trim().split(/\r?\n/).slice(-1)[0]

// Build.
fs.rmSync(GEN, { recursive: true, force: true })
fs.mkdirSync(GEN, { recursive: true })
const build = run("cargo", ["build", "--release"])
if (build.status !== 0) {
  console.error(build.stderr)
  process.exit(1)
}
if (!fs.existsSync(TYPESHARE)) {
  const install = run("cargo", ["install", "typeshare-cli", "--version", TYPESHARE_VERSION, "--locked", "--root", ".tools"])
  if (install.status !== 0) {
    console.error(install.stderr)
    process.exit(1)
  }
}

// 1. Generate. Each attempt records whether it wrote anything, and its error.
const attempts = []
function gen(name, how, features = []) {
  const r = run("cargo", ["run", "--release", "-q", "-p", "p07-messages", "--bin", "gen", ...(features.length ? ["--features", features.join(",")] : []), "--", ...how])
  const ok = r.status === 0
  attempts.push({ name, ok, error: ok ? null : firstError(`${r.stdout}\n${r.stderr}`) })
  return ok
}
function typeshare(name, srcDir) {
  const dir = path.join(GEN, name)
  fs.mkdirSync(dir, { recursive: true })
  const r = run(TYPESHARE, [srcDir, "--lang=typescript", `--config-file=${path.join(TYPES, "typeshare.toml")}`, `--output-file=${path.join(dir, "index.ts")}`])
  const ok = r.status === 0 && fs.existsSync(path.join(dir, "index.ts"))
  attempts.push({ name, ok, error: ok ? null : firstError(`${r.stdout}\n${r.stderr}`) })
  if (!ok) fs.rmSync(dir, { recursive: true, force: true })
  return ok
}

gen("ts-rs, its defaults", ["ts-rs", path.join(GEN, "ts-rs")])
gen("ts-rs, large integers as number", ["ts-rs-number", path.join(GEN, "ts-rs-number")])
gen("specta, Format", ["specta", path.join(GEN, "specta-format")])
gen("specta, PhasesFormat", ["specta-phases", path.join(GEN, "specta-phases")])
gen("specta, PhasesFormat, each u64 marked Number", ["specta-phases", path.join(GEN, "specta")], ["specta-number"])
gen("samples", ["samples", path.join(GEN, "samples.json")])

// typeshare reads source, so its opt-ins go into copies of lib.rs.
const libSource = fs.readFileSync(path.join(TYPES, "messages", "src", "lib.rs"), "utf8")
const copySource = (dir, edit) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "lib.rs"), edit(libSource))
  return dir
}
const markU53 = (s) => s.replace(/^(\s*)((?:pub )?sent_at_us: u64)/gm, `$1#[typeshare(serialized_as = "U53")]\n$1$2`)
const dropToCore = (s) => s.replace(/#\[typeshare\]\r?\n(#\[serde\(tag = "kind", rename_all = "camelCase", rename_all_fields)/, "$1")
typeshare("typeshare, its defaults", path.join(TYPES, "messages", "src"))
typeshare("typeshare, each u64 marked U53", copySource(path.join(GEN, "typeshare-src-u53"), markU53))
const typeshareOk = typeshare("typeshare", copySource(path.join(GEN, "typeshare-src"), (s) => dropToCore(markU53(s))))
attempts[attempts.length - 1].name = "typeshare, each u64 marked U53, ToCore left out"

// ts-rs writes a file per type, so each of its folders gets an index.
for (const dir of ["ts-rs", "ts-rs-number"]) {
  const d = path.join(GEN, dir)
  if (!fs.existsSync(d)) continue
  const names = fs.readdirSync(d).filter((f) => f.endsWith(".ts") && f !== "index.ts").map((f) => f.slice(0, -3))
  fs.writeFileSync(path.join(d, "index.ts"), names.map((n) => `export type { ${n} } from "./${n}"\n`).join(""))
}

// 2 and 3. Type-check samples, wrong messages, and the plugin against each output.
const samples = JSON.parse(fs.readFileSync(path.join(GEN, "samples.json"), "utf8"))
const plugin = fs.readFileSync(path.join(TYPES, "ts", "plugin.ts"), "utf8")
const outputs = [
  ["ts-rs, its defaults", "ts-rs"],
  ["ts-rs, large integers as number", "ts-rs-number"],
  ["specta, PhasesFormat, each u64 marked Number", "specta"],
  ["typeshare, each u64 marked U53, ToCore left out", "typeshare"],
].filter(([, dir]) => fs.existsSync(path.join(GEN, dir, "index.ts")))

const WRONG = [
  ["a missing field", `{ kind: "notice", body: { level: "warning" } }`, "FromCore"],
  ["a kind that doesn't exist", `{ kind: "nothing", body: {} }`, "FromCore"],
  ["a number where a UUID's text goes", `{ kind: "session", body: { session: 1, pilots: [], flying: null, sentAtUs: 0 } }`, "FromCore"],
  ["a level that doesn't exist", `{ kind: "notice", body: { text: "x", level: "fatal" } }`, "FromCore"],
  ["a field that doesn't exist", `{ kind: "heartbeat", extra: 1 }`, "ToCore"],
]

function check(dir, hasToCore) {
  const d = path.join(GEN, dir)
  const lines = [`import type { FromCore${hasToCore ? ", ToCore" : ""} } from "./index"`]
  for (const [i, s] of samples.entries()) {
    lines.push(`export const message${i}: FromCore = ${JSON.stringify(s.message)}`)
    if (hasToCore) lines.push(`export const reply${i}: ToCore = ${JSON.stringify(s.reply)}`)
  }
  fs.writeFileSync(path.join(d, "samples.ts"), lines.join("\n") + "\n")
  const wrong = [`import type { FromCore${hasToCore ? ", ToCore" : ""} } from "./index"`]
  for (const [i, [what, value, type]] of WRONG.entries()) {
    if (type === "ToCore" && !hasToCore) continue
    wrong.push(`// ${what}`, "// @ts-expect-error", `export const wrong${i}: ${type} = ${value}`)
  }
  fs.writeFileSync(path.join(d, "wrong.ts"), wrong.join("\n") + "\n")
  if (hasToCore) fs.writeFileSync(path.join(d, "plugin.ts"), plugin)
  const files = ["samples.ts", "wrong.ts", ...(hasToCore ? ["plugin.ts"] : [])].map((f) => path.join(d, f))
  const r = run(process.execPath, [TSC, "--strict", "--noEmit", "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler", ...files])
  const errors = `${r.stdout}${r.stderr}`
    .split(/\r?\n/)
    .filter((l) => /error TS\d+/.test(l))
    .map((l) => l.replace(d + path.sep, "").replace(/\\/g, "/"))
  const runtime = (fs.readFileSync(path.join(d, "index.ts"), "utf8").match(/^export (enum|const|function|class|let|var) \w+/gm) ?? []).concat(
    fs.readdirSync(d).filter((f) => f.endsWith(".ts") && !["index.ts", "samples.ts", "wrong.ts", "plugin.ts"].includes(f)).flatMap((f) => fs.readFileSync(path.join(d, f), "utf8").match(/^export (enum|const|function|class|let|var) \w+/gm) ?? []),
  )
  return { errors, runtime }
}

const checks = outputs.map(([name, dir]) => ({ name, dir, ...check(dir, dir !== "typeshare") }))

// Bundle the plugin once: its types erase, so every generator's copy compiles to the same JavaScript.
fs.mkdirSync(DIST, { recursive: true })
const esbuildModule = await import(pathToEsbuild())
const esbuild = esbuildModule.default ?? esbuildModule
await esbuild.build({
  entryPoints: [path.join(GEN, outputs.find(([, dir]) => dir !== "typeshare")[1], "plugin.ts")],
  outfile: path.join(DIST, "plugin.js"),
  bundle: true,
  format: "iife",
  globalName: "pluginBundle",
  target: "es2020",
  logLevel: "warning",
})
function pathToEsbuild() {
  return new URL(`file:///${path.join(TYPES, "node_modules", "esbuild", "lib", "main.js").replace(/\\/g, "/")}`).href
}

const host = run(path.join(TYPES, "target", "release", "p07-quickjs.exe"), [path.join(DIST, "plugin.js")])
const tagged = (tag) =>
  host.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith(`${tag} `))
    .map((l) => JSON.parse(l.slice(tag.length + 1)))

// 4. Data slots on both targets.
const wasmBuild = run("cargo", ["build", "--release", "-p", "p07-slots", "--target", "wasm32-wasip1"])
let wasmLayout = null
if (wasmBuild.status === 0) {
  const bytes = fs.readFileSync(path.join(TYPES, "target", "wasm32-wasip1", "release", "p07_slots.wasm"))
  const module = await WebAssembly.compile(bytes)
  const imports = {}
  for (const imp of WebAssembly.Module.imports(module)) {
    imports[imp.module] ??= {}
    imports[imp.module][imp.name] = () => 0
  }
  const instance = await WebAssembly.instantiate(module, imports)
  const ptr = instance.exports.p07_layout()
  wasmLayout = Array.from(new Uint32Array(instance.exports.memory.buffer, ptr, 12))
}
const LAYOUT_NAMES = ["Control size", "Control align", "counter", "state", "sent_at_us", "session", "Pose size", "seq", "lat", "heading", "Unpinned size", "Unpinned count"]

// Report.
const tool = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", cwd: TYPES }).trim().split(/\r?\n/)[0]
  } catch {
    return "?"
  }
}
const lock = fs.readFileSync(path.join(TYPES, "Cargo.lock"), "utf8").replace(/\r/g, "")
const crate = (name) => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock)?.[1] ?? "?"
const engine = tagged("ENGINE")[0]?.quickjs ?? "?"
note(`p07-types, ${new Date().toISOString()}`)
note(`Windows ${os.release()}; ${tool("rustc", ["--version"])}; Node ${process.version}`)
note(`Crates: serde ${crate("serde")}, serde_json ${crate("serde_json")}, uuid ${crate("uuid")}, ts-rs ${crate("ts-rs")}, specta ${crate("specta")}, specta-typescript ${crate("specta-typescript")}, specta-serde ${crate("specta-serde")}, typeshare ${crate("typeshare")}, rquickjs ${crate("rquickjs")} (QuickJS-ng ${engine})`)
note(`Tools: ${tool(TYPESHARE, ["--version"])} (typeshare-cli), TypeScript ${tool(process.execPath, [TSC, "--version"])}, esbuild ${esbuild.version}`)
note("Type check: tsc --strict --noEmit --target es2020 --module esnext --moduleResolution bundler.")
note()

note("1. Generating")
for (const a of attempts.filter((a) => a.name !== "samples")) note(`- ${a.name}: ${a.ok ? "wrote TypeScript" : `REFUSED: ${a.error}`}`)
note()

note(`2 and 3. Type checks: ${samples.length} sample messages as serde_json wrote them, each with its reply; ${WRONG.length} wrong messages; and the plugin`)
for (const c of checks) {
  note(`- ${c.name}: ${c.errors.length === 0 ? "no errors" : `${c.errors.length} error${c.errors.length === 1 ? "" : "s"}`}${c.runtime.length ? `; code that runs, not only types: ${c.runtime.join(", ")}` : ""}`)
  for (const e of c.errors) note(`  - ${e}`)
}
note()

note("3. The plugin in QuickJS-ng: each sample in as an object, the reply out through JSON")
for (const s of tagged("SAMPLE")) {
  if (s.error && !s.reply) note(`- ${s.i}: the plugin THREW: ${s.error}`)
  else note(`- ${s.i}: ${s.matches ? "matches" : "DIFFERS"}: sent ${s.sent}; got ${s.reply}${s.matches ? "" : `; expected ${s.expected}`}${s.error ? `; serde_json: ${s.error}` : ""}`)
}
if (host.status !== 0) note(`- p07-quickjs exited ${host.status}: ${host.stderr.trim().split(/\r?\n/).slice(-1)[0]}`)
note()

note("4. Data slots")
const x86 = tagged("LAYOUT")[0]?.layout ?? "?"
note(`- x86_64 build: compiled, so its assertions held; ${x86}`)
if (wasmLayout) {
  note(`- wasm32-wasip1 build: compiled, so its assertions held; read back from the module's memory: ${wasmLayout.map((v, i) => `${LAYOUT_NAMES[i]} ${v}`).join(", ")}`)
} else {
  note(`- wasm32-wasip1 build FAILED: ${firstError(wasmBuild.stderr)}`)
}
note()

note("Generated TypeScript")
for (const [name, dir] of outputs) {
  const d = path.join(GEN, dir)
  const files = dir.startsWith("ts-rs") ? fs.readdirSync(d).filter((f) => f.endsWith(".ts") && !["index.ts", "samples.ts", "wrong.ts", "plugin.ts"].includes(f)) : ["index.ts"]
  note(`--- ${name}`)
  for (const f of files) {
    if (files.length > 1) note(`// ${f}`)
    note(fs.readFileSync(path.join(d, f), "utf8").trimEnd())
  }
}
note()
note("Samples, as serde_json wrote them")
for (const s of samples) note(s.text)

console.log(`saved ${repoRelative(saveResult("architecture", "p07-types", out.join("\n")))}`)
