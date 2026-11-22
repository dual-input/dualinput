/*
 * p04: how fast TypeScript's language service answers an editor inside a profile's write
 * functions, in QuickJS-ng embedded in Rust and in Node, on the 58P's own program.
 *
 * The profile extension's completion, hovers, and signature help inside write functions come
 * from TypeScript's language service, which could run in the profile builder's language
 * server, in the QuickJS-ng the builder already runs typescript.js in, or in the extension's
 * own Node. This times both on the same requests. Needs no sim.
 *
 *   node experiments/areas/profiles/p04-language-service.mjs
 *
 * It builds language-service/ with `cargo build --release` (rquickjs 0.14.0, and the profile
 * engine at this commit), and then:
 *
 *   1. Writes the TypeScript program the builder checks profiles/aircraft/bksq-baronpro.yaml
 *      with: level 1's declarations and a file for each variant.
 *   2. Runs language-service/src/service.js on it in QuickJS-ng, on an 8 MB thread as the
 *      builder does, and in Node, with TypeScript 6.0.3 from the root's typescript-6.
 *      service.js times, after an edit each: completion after `state.`, signature help after
 *      `write(`, a hover on `write`, and the file's diagnostics, RUNS times each.
 *
 * Output: the report on the console and in
 * experiments/areas/profiles/results/p04-language-service-<time>.txt.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import vm from "node:vm"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "profiles", "language-service")
const HOST = path.join(HERE, "target", "release", "p04-language-service.exe")
const TS_JS = path.join(REPO, "node_modules", "typescript-6", "lib", "typescript.js")
const SERVICE = fs.readFileSync(path.join(HERE, "src", "service.js"), "utf8")
const RUNS = 30

const out = []
const note = (s = "") => {
  console.log(s)
  out.push(s)
}
const must = (r, what) => {
  if (r.status !== 0) {
    console.error(`${what} failed\n${r.stdout ?? ""}\n${r.stderr ?? ""}`)
    process.exit(1)
  }
  return r.stdout
}

// Build, and write the program.
must(spawnSync("cargo", ["build", "--release"], { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }), "cargo build")
const programFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p04-")), "program.json")
note(must(spawnSync(HOST, ["dump", path.join(REPO, "profiles"), "aircraft/bksq-baronpro.yaml", programFile], { encoding: "utf8" }), "dump").trim())
const program = fs.readFileSync(programFile, "utf8")

// QuickJS-ng.
const quick = must(spawnSync(HOST, ["run", TS_JS, programFile, String(RUNS)], { encoding: "utf8", maxBuffer: 64 * 1048576 }), "QuickJS-ng run")
const line = (tag) => quick.split(/\r?\n/).find((l) => l.startsWith(tag + " "))?.slice(tag.length + 1)
if (!line("RESULT")) {
  console.error(quick)
  process.exit(1)
}
const inQuick = { load: Number(line("LOAD")), memory: Number(line("MEMORY")), ...JSON.parse(line("RESULT")) }

// Node.
const t = performance.now()
const ts = createRequire(import.meta.url)(TS_JS)
const nodeLoad = performance.now() - t
globalThis.ts = ts
vm.runInThisContext(SERVICE)
const inNode = { load: nodeLoad, memory: process.memoryUsage().heapUsed, ...JSON.parse(globalThis.p04.measure(program, () => performance.now(), RUNS)) }

// Report.
const ms = (v) => `${v.toFixed(1)}ms`
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `median ${ms(at(0.5))}, p95 ${ms(at(0.95))}, max ${ms(s[s.length - 1])}`
}
note(`TypeScript ${inQuick.version} on ${inQuick.file}: ${inQuick.fileLines} lines, ${inQuick.scripts} write functions, declarations ${inQuick.declarationsBytes} bytes`)
note(`Node ${process.version}, ${os.cpus()[0].model}, ${RUNS} runs of each request, each after an edit`)
note()
for (const [name, r] of [["QuickJS-ng (rquickjs 0.14.0)", inQuick], ["Node (V8)", inNode]]) {
  note(name)
  note(`  load typescript.js   ${ms(r.load)}`)
  note(`  first completion     ${ms(r.cold)} (builds the program), ${r.completionEntries} entries after state.`)
  note(`  completion           ${stats(r.completion)}`)
  note(`  signature help       ${stats(r.signature)}, ${r.signatureItems} signatures for write(`)
  note(`  hover                ${stats(r.hover)}: ${r.hoverText}`)
  note(`  diagnostics          ${stats(r.diagnostics)}, ${r.diagnosticCount} found`)
  note(`  memory               ${(r.memory / 1048576).toFixed(0)} MB${name.startsWith("Node") ? " (V8 heap used)" : ""}`)
  note()
}
note(`saved ${repoRelative(saveResult("profiles", "p04-language-service", out.join("\n")))}`)
