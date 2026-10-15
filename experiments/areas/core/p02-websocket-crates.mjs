/*
 * p02: which crates each WebSocket library brings into the core, and which one
 * the core already links through iroh, for node 6.2 of the architecture plan,
 * clients and the panel bridge.
 *
 * It runs `cargo tree` on two empty programs, one with tokio-tungstenite 0.30.0
 * and one with tokio-websockets 0.13.3, each with its server and client on and
 * tokio 1.53.2's net, and reads which crate depends on a WebSocket library in
 * the network probes' lockfiles, which build iroh 1.3.
 *
 *   node experiments/areas/core/p02-websocket-crates.mjs
 *
 * Output: results/p02-websocket-crates-<time>.txt.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { REPO, repoRelative, resultFile } from "../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "core", "ws-crates")
const lines = []
const say = (s) => {
  console.log(s)
  lines.push(s)
}

for (const lib of ["tokio-tungstenite", "tokio-websockets"]) {
  const r = spawnSync("cargo", ["tree", "-e", "normal", "--prefix", "none"], { cwd: path.join(HERE, lib), encoding: "utf8" })
  if (r.status !== 0) throw new Error(r.stderr)
  const crates = [...new Set(r.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(" ").slice(0, 2).join(" ")))]
    .filter((c) => !c.startsWith("p02-"))
    .sort()
  say(`${lib}\t${crates.length} crates besides the program, tokio's own among them`)
  say(`${lib}\t${crates.join(", ")}`)
}

const LOCKS = ["two-cores", "p03-home-networks", "p05-relay-homes", "p06-relay-mix", "p07-outage"]
for (const probe of LOCKS) {
  const file = path.join(REPO, "experiments", "areas", "network", probe, "Cargo.lock")
  if (!existsSync(file)) continue
  const packages = readFileSync(file, "utf8").split("[[package]]")
  const name = (p) => /name = "([^"]+)"\s*\r?\nversion = "([^"]+)"/.exec(p)
  for (const lib of ["tokio-websockets", "tokio-tungstenite", "tungstenite"]) {
    const users = packages
      .filter((p) => p.includes(`"${lib}`) && name(p)?.[1] !== lib)
      .map((p) => `${name(p)[1]} ${name(p)[2]}`)
    const own = packages.map(name).find((n) => n?.[1] === lib)
    if (own) say(`${probe}\t${lib} ${own[2]}, depended on by ${users.join(", ") || "nothing"}`)
  }
}

const file = resultFile("core", "p02-websocket-crates")
writeFileSync(file, lines.join("\n") + "\n")
console.log(`\nSaved ${repoRelative(file)}`)
