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
import { fromRoot, ROOT } from "./lib/repo.ts"
import { Failed, main, run } from "./lib/run.ts"

const checks: [string, () => void][] = [
  ["Rustfmt", () => run("cargo", ["fmt", "--all", "--", "--check"])],
  // This check compares ts/ before and after writing it again. `cargo test` writes ts/ too,
  // so this runs before the tests, or it would compare fresh files with fresh files.
  ["the messages' TypeScript types", checkMessageTypes],
  // RUSTFLAGS would replace the static C runtime that .cargo/config.toml sets, so
  // -D warnings goes on Clippy's command line instead.
  ["Clippy", () => run("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"])],
  ["the default members' tests", () => run("cargo", ["test"])],
  ["each tsconfig's type check", typeCheck],
  ["the map check", () => run(process.execPath, [path.join("tools", "map-check.ts")])],
  ["the tools' tests", () => run(process.execPath, ["--test", ...toolTests()])],
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

function typeCheck(): void {
  const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc")
  const configs = ["engines", "platform", "features", "apps", "sim-package", "tools"].flatMap((f) => find(path.join(ROOT, f), "tsconfig.json"))
  for (const config of configs) run(process.execPath, [tsc, "-p", fromRoot(config)])
}

function toolTests(): string[] {
  return find(path.join(ROOT, "tools"), ".test.ts").map((f) => fromRoot(f))
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
