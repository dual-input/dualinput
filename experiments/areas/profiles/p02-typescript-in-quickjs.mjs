/*
 * p02: whether TypeScript's own compiler, typescript.js, type-checks and emits
 * inside QuickJS-ng embedded in Rust, how long a check of a profile-sized
 * program takes there, and how much memory and stack it needs.
 *
 * The profile builder has to type-check a profile's write functions and its
 * plugin against our declarations, and compile the plugin to JavaScript
 * (record/areas/profiles/01-format-and-delivery.md). A builder that runs the
 * compiler inside the QuickJS-ng we already embed needs no Node and no second
 * program. Needs no sim.
 *
 *   node experiments/areas/profiles/p02-typescript-in-quickjs.mjs
 *
 * It installs TypeScript 6.0.3 into typescript/ with npm the first time, builds
 * typescript/ with `cargo build --release` (rquickjs 0.14.0), and then:
 *
 *   1. Writes two in-memory projects, each with a small lib of our own in place
 *      of TypeScript's (`noLib`): "plugin", a plugin with one deliberate type
 *      error, and "profile", 300 write functions wrapped the way a builder
 *      would wrap them, with one reading a key the state doesn't have.
 *   2. Runs each in QuickJS-ng 5 times on one loaded compiler, on a 64 MB
 *      thread, and prints the load time, each run's time, and the memory.
 *   3. Runs the same driver under Node, and compares the diagnostics and the
 *      emitted files with QuickJS-ng's byte for byte.
 *   4. Runs "profile" once on threads of 1, 2, 4, 8, and 16 MB, to find the
 *      stack the compiler needs.
 *
 * Output: the report on the console and in
 * experiments/areas/profiles/results/p02-typescript-in-quickjs-<time>.txt.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import zlib from "node:zlib"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "profiles", "typescript")
const HOST = path.join(HERE, "target", "release", "p02-typescript-host.exe")
const TS_JS = path.join(HERE, "node_modules", "typescript", "lib", "typescript.js")
const DRIVER = fs.readFileSync(path.join(HERE, "src", "driver.js"), "utf8")
const TARGET = "ES2020"
const FUNCTIONS = 300

const out = []
const note = (s = "") => {
  console.log(s)
  out.push(s)
}
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" })
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr)
    process.exit(1)
  }
}

// Build.
if (!fs.existsSync(TS_JS)) run("npm", ["install"], HERE)
run("cargo", ["build", "--release"], HERE)

// The projects. The lib is a sketch of our declarations, not theirs: with
// noLib, TypeScript still needs these ten global types to exist.
const LIB = `interface Array<T> { length: number; [n: number]: T; push(...items: T[]): number; }
interface Boolean {}
interface CallableFunction {}
interface Function {}
interface IArguments {}
interface NewableFunction {}
interface Number { toFixed(digits?: number): string; }
interface Object {}
interface RegExp {}
interface String { readonly length: number; }
declare type Name = { readonly kind: "L" | "A" | "K" | "H" | "B"; readonly name: string };
declare function L(name: string, unit?: string): Name;
declare function K(name: string, ...values: number[]): Name;
declare function write(target: Name, value?: number): void;
`

const plugin = {
  roots: ["/lib.d.ts", "/plugin.ts"],
  files: {
    "/lib.d.ts": LIB + "declare const state: { readonly radar_range: number };\n",
    "/plugin.ts": `export const radar_range = (value: number): void => { write(L('RADAR_RANGE'), value ?? state.radar_range) }
export const radar_mode = (value: number): void => { write(L('RADAR_MODE'), 'wx') }
`,
  },
  options: { target: TARGET },
}

const keys = Array.from({ length: FUNCTIONS }, (_, i) => `pump_${i + 1}`)
const functions = keys.map((key, i) => {
  const read = i === FUNCTIONS - 1 ? "state.pump_missing" : `state.${key}`
  return `export const ${key}: (value: number) => void = (value) => {
  write(L('SWITCH_FUEL_PUMP_${i + 1}'), value)
  if (${read} !== value) write(K('FUEL_PUMP_TOGGLE', ${i + 1}))
}`
})
const profile = {
  roots: ["/lib.d.ts", "/profile.ts"],
  files: {
    "/lib.d.ts": LIB + `declare const state: { ${keys.map((k) => `readonly ${k}: number`).join("; ")} };\n`,
    "/profile.ts": functions.join("\n") + "\n",
  },
  options: { target: TARGET },
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p02-"))
const save = (name, project) => {
  const file = path.join(tmp, `${name}.json`)
  fs.writeFileSync(file, JSON.stringify(project))
  return file
}

const host = (projectFile, stackMb, runs) => {
  const r = spawnSync(HOST, [TS_JS, projectFile, String(stackMb), String(runs)], { encoding: "utf8", maxBuffer: 64 * 1048576 })
  const lines = (r.stdout ?? "").split(/\r?\n/)
  const get = (tag) => lines.filter((l) => l.startsWith(tag + " ")).map((l) => l.slice(tag.length + 1))
  return {
    exit: r.status,
    load: get("LOAD")[0],
    runs: get("RUN").map((l) => l.split(" ")[1]),
    result: get("RESULT")[0],
    memory: Number(get("MEMORY")[0]),
    error: get("ERROR")[0] ?? (r.status !== 0 ? `exit ${r.status} ${r.stderr.trim().split("\n").pop()}` : undefined),
  }
}

// Node runs the same driver on the same compiler.
const require = createRequire(path.join(HERE, "package.json"))
globalThis.ts = require("typescript")
const node = (project, runs) => {
  globalThis.PROJECT = JSON.stringify(project)
  const times = []
  let result
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    result = (0, eval)(DRIVER)
    times.push((performance.now() - t).toFixed(1))
  }
  return { times, result }
}

const tsBytes = fs.statSync(TS_JS).size
const lock = fs.readFileSync(path.join(HERE, "Cargo.lock"), "utf8").replace(/\r/g, "")
const crate = (name) => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock)?.[1] ?? "?"
note(`p02-typescript-in-quickjs, ${new Date().toISOString()}`)
note(`TypeScript ${globalThis.ts.version}, rquickjs ${crate("rquickjs")}, rquickjs-sys ${crate("rquickjs-sys")}, Node ${process.version}, ${os.cpus()[0].model}`)
note(`typescript.js: ${tsBytes} bytes, ${zlib.gzipSync(fs.readFileSync(TS_JS), { level: 9 }).length} gzip -9, ` +
  `${zlib.zstdCompressSync(fs.readFileSync(TS_JS), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } }).length} zstd -19`)
note(`target ${TARGET}, noLib with a lib of our own; "profile" is ${FUNCTIONS} write functions, ${profile.files["/profile.ts"].length} bytes`)

for (const [name, project] of [["plugin", plugin], ["profile", profile]]) {
  note()
  note(`${name}:`)
  const q = host(save(name, project), 64, 5)
  if (q.error) {
    note(`  QuickJS-ng: ${q.error}`)
    continue
  }
  note(`  QuickJS-ng: load ${q.load}ms, runs ${q.runs.join(", ")}ms, memory ${(q.memory / 1048576).toFixed(1)} MB`)
  const n = node(project, 5)
  note(`  Node:       runs ${n.times.join(", ")}ms`)
  note(`  same diagnostics and output as Node: ${q.result === n.result ? "yes, byte for byte" : "NO"}`)
  const r = JSON.parse(q.result)
  for (const d of r.diags) note(`  ${d.file}:${d.line}:${d.column} TS${d.code} ${d.message}`)
  const emitted = Object.entries(r.out)
  note(`  emitted ${emitted.length} file(s): ${emitted.map(([f, t]) => `${f} ${t.length} bytes`).join(", ")}`)
}

note()
note("stack, \"profile\" once:")
for (const mb of [1, 2, 4, 8, 16]) {
  const q = host(path.join(tmp, "profile.json"), mb, 1)
  note(`  ${String(mb).padStart(2)} MB thread: ${q.error ? q.error : `ok, run ${q.runs[0]}ms`}`)
}

fs.rmSync(tmp, { recursive: true, force: true })
note()
note(`saved ${repoRelative(saveResult("profiles", "p02-typescript-in-quickjs", out.join("\n")))}`)
