// figure.json's numbers changed in place, the rest of the file as it was.

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { FIGURE } from "../lib/figure.ts"
import { setNumbers } from "./spec.ts"

const text = fs.readFileSync(path.join(FIGURE, "figure.json"), "utf8")

test("a changed number is the one change, the file's layout kept", () => {
  const changed = setNumbers(text, { "/head/radius": 0.105, "/rest/hand/up": 0.12, "/telescope/3": 0.17 })
  const before = text.split("\n")
  const after = changed.split("\n")
  assert.equal(after.length, before.length)
  const differ = after.filter((line, i) => line !== before[i])
  assert.deepEqual(differ, [
    `  "head": { "radius": 0.105, "eyeForward": 0.06 },`,
    `    "hand": { "fwd": 0.2, "right": 0.17, "up": 0.12 },`,
    `  "telescope": [0.02, 0.04, 0.08, 0.17, 0.32, 0.64, 1.28, 2.56],`,
  ])
  const spec = JSON.parse(changed) as { head: { radius: number }; palette: unknown[] }
  assert.equal(spec.head.radius, 0.105)
  assert.equal(spec.palette.length, 9)
})

test("a pointer with no number there is refused", () => {
  assert.throws(() => setNumbers(text, { "/head/size": 1 }), /no number at \/head\/size/)
  assert.throws(() => setNumbers(text, { "/palette/0/name": 1 }), /no number at/)
})
