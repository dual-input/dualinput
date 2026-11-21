import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../lib/repo.ts"
import { matrix, SCENARIOS } from "./order.ts"

const scenarios = fs
  .readdirSync(path.join(ROOT, "tools", "bench", "scenarios"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""))

test("every scenario has a title and a time, and every entry is a scenario", () => {
  assert.deepEqual(scenarios.filter((s) => !SCENARIOS[s]), [], "add each of these to tools/bench/order.ts")
  assert.deepEqual(Object.keys(SCENARIOS).filter((s) => !scenarios.includes(s)), [])
})

test("CI's matrix holds every scenario once, longest first", () => {
  const jobs = matrix(scenarios)
  assert.deepEqual(jobs.map((j) => j.name).sort(), [...scenarios].sort())
  const times = jobs.map((j) => SCENARIOS[j.name]!.seconds)
  assert.deepEqual(times, [...times].sort((a, b) => b - a))
})
