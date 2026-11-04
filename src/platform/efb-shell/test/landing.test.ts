import assert from "node:assert/strict"
import { test } from "node:test"

import { askedAgain } from "../src/landing.ts"

test("a changed count is a new ask", () => {
  assert.equal(askedAgain(1, 0), true)
  assert.equal(askedAgain(4, 3), true)
})

test("an unchanged count is none", () => {
  assert.equal(askedAgain(3, 3), false)
})

test("a flight load's reset to 0 is no ask, so it opens no EFB unasked", () => {
  assert.equal(askedAgain(0, 1), false)
})
