/*
 * p02: which lights FS Copilot's traffic host read on parked and moving AI aircraft.
 *
 * An FS Copilot tester saw every parked copy with its landing lights on. FS Copilot's
 * host reads the five `LIGHT … ON` variables and records them as one mask, `l`
 * (strobe 1, landing 2, taxi 4, beacon 8, nav 16), beside `e`, the engines'
 * combustion mask (FS Copilot fork, record/traffic-atc/tools/README.md). This reads
 * its captures, with no sim, and counts each object's last state by its type, by
 * parked (ground speed under 1kt) or moving, and by its light and engine masks.
 *
 * Run: node experiments/areas/traffic-atc/p02-fsc-capture-lights.mjs [recordings folder]
 * Output: experiments/areas/traffic-atc/results/p02-fsc-capture-lights-<time>.txt
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const FOLDER = process.argv[2] ?? join(REPO, "..", "fsc", "src", "record", "traffic-atc", "recordings")

const lines = []
for (const name of readdirSync(FOLDER).filter((n) => n.endsWith(".ndjson")).sort()) {
  const types = new Map()
  const last = new Map()
  for (const line of readFileSync(join(FOLDER, name), "utf8").split("\n")) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.k === "add") types.set(r.o, r.type)
    if (r.k === "s") last.set(r.o, r)
  }
  const counts = new Map()
  for (const s of last.values()) {
    if (s.u) continue
    const key = `${types.get(s.o) ?? "?"} ${(s.gs ?? 0) < 1 ? "parked" : "moving"} l=${s.l ?? "-"} e=${s.e ?? "-"}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  lines.push(name)
  for (const [key, n] of [...counts].sort()) lines.push(`  ${String(n).padStart(4)}  ${key}`)
}

const file = saveResult("traffic-atc", "p02-fsc-capture-lights", lines.join("\n"))
console.log(lines.join("\n"))
console.log(`\nSaved ${repoRelative(file)}`)
