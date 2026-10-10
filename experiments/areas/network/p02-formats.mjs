/*
 * p02: how many bytes each v1 channel's message takes between cores in each
 * binary format, and how long encoding and decoding take (architecture plan,
 * node 2.2). Needs no sim.
 *
 *   node experiments/areas/network/p02-formats.mjs
 *
 * Builds formats/ in release and runs it. The Rust program encodes each sample
 * message in postcard, MessagePack through rmp-serde (with and without field
 * names), bitcode through serde and through its own derive, and wincode, checks
 * that each decodes back to the same value, and prints sizes and times.
 */

import { spawnSync } from "node:child_process"
import path from "node:path"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const CRATE = path.join(REPO, "experiments", "areas", "network", "formats")
const run = (cmd, args) => spawnSync(cmd, args, { cwd: CRATE, encoding: "utf8", windowsHide: true })

const build = run("cargo", ["build", "--release", "-q"])
if (build.status !== 0) {
  console.error(build.stderr)
  process.exit(1)
}
const exe = path.join(CRATE, "target", "release", "p02-formats.exe")
const probe = run(exe, [])
if (probe.status !== 0) {
  console.error(probe.stderr)
  process.exit(1)
}

const versions = run("cargo", ["tree", "--depth", "1", "-e", "normal", "--prefix", "none"])
const report = [
  probe.stdout.trimEnd(),
  "",
  "Crates, as built:",
  ...versions.stdout
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("p02-formats"))
    .map((l) => "  " + l.replace(/\s*\(\*\)$/, "")),
].join("\n")

console.log(report)
console.log("\nSaved " + repoRelative(saveResult("network", "p02-formats", report)))
