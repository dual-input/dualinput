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

import { buildDesktopPages, DESKTOP } from "./lib/desktop-pages.ts"
import { readMessageTypes, writeMessageTypes } from "./lib/messages.ts"
import { buildModule, clippyModule, missingExports } from "./lib/module.ts"
import { workspaceVersion } from "./lib/package.ts"
import { buildPages, checkPages } from "./lib/pages.ts"
import { panelCompileProblem } from "./lib/panel.ts"
import { fromRoot, ROOT } from "./lib/repo.ts"
import { Failed, main, output, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"
import { stockMismatches } from "./lib/stock.ts"
import { mismatches as figureMismatches } from "./lib/figure.ts"

const checks: [string, () => void | Promise<void>][] = [
  ["Rustfmt", () => run("cargo", ["fmt", "--all", "--", "--check"])],
  // This check compares ts/ before and after writing it again. `cargo test` writes ts/ too,
  // so this runs before the tests, or it would compare fresh files with fresh files.
  ["the messages' TypeScript types", checkMessageTypes],
  // RUSTFLAGS would replace the static C runtime that .cargo/config.toml sets, so
  // -D warnings goes on Clippy's command line instead. --all-features lints the bench
  // build's code too, which only src/apps/core's `stand-in` feature compiles.
  ["Clippy", () => run("cargo", ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"])],
  ["the default members' tests", () => run("cargo", ["test"])],
  ["the desktop app's Rustfmt, Clippy, and tests", checkDesktop],
  ["the desktop app's message crate against messages::HASH", checkDesktopMessages],
  ["our WASM module's build and exports", checkModule],
  ["Clippy on our WASM module", clippyModule],
  ["each tsconfig's type check", typeCheck],
  ["the stock files against stock.json", checkStockFiles],
  ["the banner's panel against its source", checkPanel],
  ["the figure's sources against source.json", checkFigure],
  ["the Coherent GT check on our code in the sim", async () => checkPages(await buildPages())],
  ["the map check", () => run(process.execPath, [path.join("tools", "map-check.ts")])],
  ["the profiles' level files", checkLevels],
  ["the profiles' build", () => run("cargo", [...BUILDER, "build", "profiles"])],
  // The tools' tests, and our TypeScript's own, such as page-client's and the backend's, the
  // backend's on a local D1, on Node's test runner.
  ["the TypeScript tests", () => run(process.execPath, ["--test", ...typeScriptTests()])],
]

/** The profile builder, run from the tree. */
const BUILDER = ["run", "--quiet", "--package", "dualinput-profile-builder", "--"]

main(async () => {
  for (const [name, check] of checks) {
    console.log(`\ncheck: ${name}`)
    await check()
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
 * Each level of the profile format has a JSON Schema and declarations that the profile engine
 * generates, committed in levels/, which a release freezes, and level 1's declarations open with
 * the JavaScript tools/javascript-types.ts generates. This writes them all again and fails if any
 * file changed, leaving the new files in place, as checkMessageTypes does.
 */
function checkLevels(): void {
  const engine = path.join(ROOT, "src", "engines", "profile-engine")
  const generated = () => [...find(path.join(engine, "levels"), ""), path.join(engine, "javascript", "javascript.d.ts")]
  const read = () => new Map(generated().map((f) => [fromRoot(f), fs.readFileSync(f, "utf8")]))
  const before = read()
  run(process.execPath, [path.join("tools", "javascript-types.ts")])
  run("cargo", [...BUILDER, "levels"])
  const after = read()
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort()
  if (changed.length) {
    throw new Failed(`the profile format's level files differed from what the engine generates, and are written again: ${changed.join(", ")}`)
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

/** The desktop app is a Cargo workspace of its own, so the workspace's checks above don't reach it, and its version is written apart from the root's. It embeds its pages as it compiles, so they build first, or Clippy and the tests would compile an old window. */
async function checkDesktop(): Promise<void> {
  await buildDesktopPages()
  const version = /^version = "([^"]+)"/m.exec(fs.readFileSync(path.join(DESKTOP, "Cargo.toml"), "utf8"))?.[1]
  if (version !== workspaceVersion()) throw new Failed(`src/apps/desktop/Cargo.toml names version ${version}, and the root Cargo.toml ${workspaceVersion()}`)
  run("cargo", ["fmt", "--", "--check"], { cwd: DESKTOP })
  run("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"], { cwd: DESKTOP })
  run("cargo", ["test"], { cwd: DESKTOP })
}

/**
 * Two builds whose messages would encode differently refuse to talk, because each program's first message carries
 * `messages::HASH`, which covers the version of every package the message crate reaches. Build.rs finds the root's
 * Cargo.lock above the crate, so the desktop app's build takes its hash from that lock while compiling against its
 * own. This fails when the desktop app's lock gives the message crate a package version the root's lock doesn't, so
 * the hash covers what the desktop app compiles.
 */
function checkDesktopMessages(): void {
  const reached = (cwd: string, edges: string) =>
    new Set(
      output("cargo", ["tree", "--package", "messages", "--edges", edges, "--target", "all", "--prefix", "none", "--format", "{p}", "--locked"], { cwd })
        .split("\n")
        .map((line) => line.replace(/ \((\*|proc-macro)\)/g, "").trim())
        // A path package, the message crate among them, ends with its folder, as in `messages v0.1.0 (C:\...\messages)`, which differs between the two.
        .filter((line) => line && !/ \((?:[A-Za-z]:)?[\\/]/.test(line)),
    )
  // The root's lock also holds the message crate's dev-dependencies, which the hash covers too.
  const root = reached(ROOT, "normal,build,dev")
  const missing = [...reached(DESKTOP, "normal,build")].filter((pkg) => !root.has(pkg)).sort()
  if (missing.length) {
    throw new Failed(`src/apps/desktop/Cargo.lock gives the message crate ${missing.join(", ")}, which the root's Cargo.lock doesn't, so messages::HASH doesn't cover them: cargo update each package in one lock or the other until both pin the same versions`)
  }
}

/** CI has no sim to compile with, so it checks only that the committed compile came from this source. */
function checkPanel(): void {
  const problem = panelCompileProblem()
  if (problem) throw new Failed(problem)
}

/** CI has no sim, so it checks only that each stock file matches stock.json. */
function checkStockFiles(): void {
  const mismatched = stockMismatches()
  if (mismatched.length) throw new Failed(`src/sim-package/stock/ doesn't match its stock.json: ${mismatched.join(", ")}`)
}

/** Avatars' figure: its sources as the generator writes them, and compiled since they changed. */
function checkFigure(): void {
  const mismatched = figureMismatches()
  if (mismatched.length) throw new Failed(`the figure's sources don't match:\n  ${mismatched.join("\n  ")}`)
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
