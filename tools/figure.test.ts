// The figure's check: its sources as the generator writes them, and compiled since they last
// changed (record/areas/build/01-the-build.md, "Cases for the bench").

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { FIGURE, mismatches, sha256, sources, spec, walk } from "./lib/figure.ts"

/** A figure folder with figure.json, its sources as generated, and source.json for them. */
function compiledCopy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figure-"))
  fs.copyFileSync(path.join(FIGURE, "figure.json"), path.join(dir, "figure.json"))
  for (const [rel, content] of sources(spec(dir)).files) {
    const file = path.join(dir, "source", rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  const source = path.join(dir, "source")
  const hashes = Object.fromEntries(walk(source).map((rel) => [rel, sha256(fs.readFileSync(path.join(source, rel)))]))
  fs.writeFileSync(path.join(dir, "source.json"), JSON.stringify(hashes))
  return dir
}

test("sources compiled as they stand pass", () => {
  assert.deepEqual(mismatches(compiledCopy()), [])
})

test("a figure source changed without a recompile fails, as figure.json changed without a generate does", () => {
  const dir = compiledCopy()
  const cfg = path.join(dir, "source", "PackageSources", "SimObjects", "Misc", "DUALINPUT_FIGURE_PILOT", "sim.cfg")
  fs.appendFileSync(cfg, "\n")
  const changed = mismatches(dir)
  assert.ok(changed.some((m) => m.includes("sim.cfg changed since compiled/ was compiled")), changed.join("\n"))

  const spec = path.join(dir, "figure.json")
  fs.writeFileSync(spec, fs.readFileSync(spec, "utf8").replace('"radius": 0.1', '"radius": 0.11'))
  assert.ok(mismatches(dir).some((m) => m.includes("isn't what figure.json and model.ts give")))
})
