// CI will run a set of checks on every pull request. This runs the same checks on the code
// that exists so far, so a problem shows up before a push rather than after. Run it before
// every push; it stops at the first check that fails. When you add the first code that
// another of CI's checks covers, add that check here
// (record/areas/architecture/02-code-map.md, "CI", lists them).
//
//   node tools/check.ts

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

import { readMessageTypes, writeMessageTypes } from "./lib/messages.ts"
import { buildModule, clippyModule, missingExports } from "./lib/module.ts"
import { buildPages, checkPages } from "./lib/pages.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { Failed, main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"
import { stockMismatches } from "./lib/stock.ts"

const checks: [string, () => void][] = [
  ["Rustfmt", () => run("cargo", ["fmt", "--all", "--", "--check"])],
  // This check compares ts/ before and after writing it again. `cargo test` writes ts/ too,
  // so this runs before the tests, or it would compare fresh files with fresh files.
  ["the messages' TypeScript types", checkMessageTypes],
  // RUSTFLAGS would replace the static C runtime that .cargo/config.toml sets, so
  // -D warnings goes on Clippy's command line instead. --all-features lints the bench
  // build's code too, which only src/apps/core's `stand-in` feature compiles.
  ["Clippy", () => run("cargo", ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])],
  ["the default members' tests", () => run("cargo", ["test"])],
  ["our WASM module's build and exports", checkModule],
  ["Clippy on our WASM module", clippyModule],
  ["each tsconfig's type check", typeCheck],
  ["the stock files against stock.json", checkStockFiles],
  ["the Coherent GT check on our code in the sim", () => checkPages(buildPages())],
  ["the map check", () => run(process.execPath, [path.join("tools", "map-check.ts")])],
  // The tools' tests, and our TypeScript's own, such as page-client's and the backend's, the
  // backend's on a local D1, on Node's test runner.
  ["the TypeScript tests", () => run(process.execPath, ["--test", ...typeScriptTests()])],
]

main(() => {
  for (const [name, check] of checks) {
    console.log(`\ncheck: ${name}`)
    check()
  }
  console.log(`\ncheck: all ${checks.length} checks passed`)
})

/**
 * The messages' generated TypeScript files are committed, so a change to the message crate
 * has to come with them written again. This writes them again and fails if any file
 * changed. It leaves the new files in place, so the next run passes and git status shows
 * them to commit.
 */
function checkMessageTypes(): void {
  const before = readMessageTypes()
  writeMessageTypes()
  const after = readMessageTypes()
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort()
  if (changed.length) {
    throw new Failed(
      `the messages' generated files differed from what the message crate generates, and are written again: ${changed.join(", ")}`,
    )
  }
}

/**
 * A module that lacks a function the sim calls in a standalone module builds, packages, and
 * loads without a word, and fails only in the sim. So this builds the module with cargo-msfs,
 * which the default members' build and tests leave out, and fails unless it exports each.
 */
function checkModule(): void {
  requireSdk()
  const missing = missingExports(fs.readFileSync(buildModule()))
  if (missing.length) throw new Failed(`our WASM module lacks exports the sim calls: ${missing.join(", ")}`)
}

function typeCheck(): void {
  const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc")
  const configs = ["src", "tools"].flatMap((f) => find(path.join(ROOT, f), "tsconfig.json"))
  for (const config of configs) run(process.execPath, [tsc, "-p", fromRoot(config)])
}

function typeScriptTests(): string[] {
  return ["src", "tools"].flatMap((f) => find(path.join(ROOT, f), ".test.ts")).map((f) => fromRoot(f))
}

/** CI has no sim, so it checks only that each stock file matches stock.json. */
function checkStockFiles(): void {
  const mismatched = stockMismatches()
  if (mismatched.length) throw new Failed(`src/sim-package/stock/ doesn't match its stock.json: ${mismatched.join(", ")}`)
}

/** Every file under `dir` whose name ends with `suffix`, outside node_modules and target. */
function find(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "target" ? [] : find(full, suffix)
    return e.name.endsWith(suffix) ? [full] : []
  })
}
