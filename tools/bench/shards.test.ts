import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT } from "../lib/repo.ts"
import { seconds, SECONDS, share } from "./shards.ts"

const scenarios = fs
  .readdirSync(path.join(ROOT, "tools", "bench", "scenarios"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""))

test("every scenario runs in exactly one of CI's 8 shares", () => {
  const shares = Array.from({ length: 8 }, (_, i) => share(scenarios, i + 1, 8))
  assert.deepEqual(shares.flat().sort(), [...scenarios].sort())
})

test("no share runs longer than another by more than its own shortest file", () => {
  const shares = Array.from({ length: 8 }, (_, i) => share(scenarios, i + 1, 8))
  const times = shares.map(seconds)
  for (const [i, files] of shares.entries()) {
    const shortest = Math.min(...files.map((f) => SECONDS[f] ?? 60))
    assert.ok(files.length === 1 || times[i]! - shortest <= Math.min(...times), `share ${i + 1}, ${files.join(" ")}, runs ${times[i]}s`)
  }
})

test("every file SECONDS times is a scenario", () => {
  assert.deepEqual(Object.keys(SECONDS).filter((f) => !scenarios.includes(f)), [])
})
