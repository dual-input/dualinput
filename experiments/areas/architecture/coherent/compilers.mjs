/*
 * What TypeScript and esbuild do at es2017 with the syntax they can't lower
 * into what Coherent GT parses: regex named groups, lookbehind, the s flag,
 * and a BigInt literal (p09, record/areas/architecture/coherent-gt.md). Needs
 * no sim.
 *
 *   node experiments/areas/architecture/coherent/compilers.mjs
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

import { REPO, repoRelative, saveResult } from "../../../tools/results.mjs"

const TYPES = path.join(REPO, "experiments", "areas", "architecture", "types")
const SOURCE = String.raw`const a = /(?<y>\d{4})/.exec("2026");
const b = /(?<=x)y/;
const c = /a.b/s;
const d = 10n;
export { a, b, c, d };
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p09-compilers-"))
fs.writeFileSync(path.join(dir, "sample.ts"), SOURCE)

const TSC = path.join(TYPES, "node_modules", "typescript", "bin", "tsc")
const tsc = spawnSync(process.execPath, [TSC, "sample.ts", "--target", "es2017", "--module", "es2015", "--outDir", "out"], { cwd: dir, encoding: "utf8" })
const tscOut = fs.existsSync(path.join(dir, "out", "sample.js")) ? fs.readFileSync(path.join(dir, "out", "sample.js"), "utf8") : "(nothing emitted)"
const esbuild = createRequire(import.meta.url)(path.join(TYPES, "node_modules", "esbuild"))
let es
try {
  const r = esbuild.transformSync(SOURCE, { loader: "ts", target: "es2017" })
  es = r.code + r.warnings.map((w) => `warning: ${w.text}\n`).join("")
} catch (e) {
  es = (e.errors ?? []).map((x) => `error: ${x.text}`).join("\n")
}
fs.rmSync(dir, { recursive: true, force: true })

const text = [
  `p09-compilers, ${new Date().toISOString()}`,
  `TypeScript ${spawnSync(process.execPath, [TSC, "--version"], { encoding: "utf8" }).stdout.trim()}, esbuild ${esbuild.version}, both at es2017`,
  "",
  "Source:",
  SOURCE,
  `TypeScript reported (exit ${tsc.status}):`,
  ...(tsc.stdout + tsc.stderr).trim().split(/\r?\n/).map((l) => `  ${l.replace(/^.*sample\.ts/, "sample.ts")}`),
  "TypeScript emitted:",
  tscOut,
  "esbuild emitted:",
  es,
].join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("architecture", "p09-compilers", text))}`)
