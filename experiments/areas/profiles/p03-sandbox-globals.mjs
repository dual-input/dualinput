/*
 * p03: which globals, and which of their properties, a QuickJS-ng context holds when it's
 * made as the sandbox's design makes one: the base objects, and of rquickjs 0.14.0's
 * intrinsics Eval and RegExp alone, with Math.random and queueMicrotask deleted
 * (record/areas/plugins/01-plugins.md, "The sandbox"). Level 1 of the profile format declares
 * exactly these for write functions. Needs no sim.
 *
 *   node experiments/areas/profiles/p03-sandbox-globals.mjs
 *
 * It builds sandbox-globals/ with `cargo build --release`, runs it, and prints each global
 * with its own properties and its prototype's, then a few things a write function might try.
 *
 * Output: the report on the console and in
 * experiments/areas/profiles/results/p03-sandbox-globals-<time>.txt.
 */

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { repoRelative, saveResult } from "../../tools/results.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const crate = path.join(here, "sandbox-globals")
const built = spawnSync("cargo", ["build", "--release", "--quiet"], { cwd: crate, stdio: "inherit" })
if (built.status !== 0) process.exit(built.status ?? 1)
const ran = spawnSync(path.join(crate, "target", "release", "p03-sandbox-globals.exe"), { encoding: "utf8" })
const report = `p03: a QuickJS-ng context made as the sandbox's design makes one, rquickjs 0.14.0\n\n${ran.stdout}${ran.stderr}`
console.log(report)
console.log(`saved ${repoRelative(saveResult("profiles", "p03-sandbox-globals", report))}`)
