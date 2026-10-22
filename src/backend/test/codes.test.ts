import assert from "node:assert/strict"
import { test } from "node:test"

import { ALPHABET, ATTEMPTS, claim, draw } from "../src/codes.ts"

/** A random source that hands out `bytes` in turn. */
function sequence(bytes: number[]) {
  let at = 0
  return (out: Uint8Array<ArrayBuffer>) => {
    out[0] = bytes[at++ % bytes.length] ?? 0
    return out
  }
}

test("a byte at 240 or above is drawn again, so every character is equally likely", () => {
  assert.equal(draw(sequence([0, 240, 255, 29, 30, 239, 59, 1])), "A9A99B")
})

test("a code that meets a held one is drawn again, up to 5 times", async () => {
  const held = new Set([draw(sequence([0])), draw(sequence([1]))])
  let draws = 0
  const random = sequence([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
  const code = await claim(random, async (code) => {
    draws++
    return !held.has(code)
  })
  assert.equal(code, ALPHABET[2]?.repeat(6))
  assert.equal(draws, 3)

  assert.equal(await claim(random, async () => false), null)
  assert.equal(ATTEMPTS, 5)
})
