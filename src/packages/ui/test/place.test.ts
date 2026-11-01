import assert from "node:assert/strict"
import { test } from "node:test"

import { place } from "../src/lib/place.ts"

const bounds = { left: 0, top: 0, width: 500, height: 700 }
const popup = { width: 200, height: 60 }
const anchor = { left: 200, top: 300, width: 100, height: 36 }

test("a popup sits on the side it asked for, centered on its anchor, with the anchor's center under its arrow", () => {
  assert.deepEqual(place(anchor, popup, bounds, { side: "top", offset: 11 }), { left: 150, top: 229, side: "top", arrow: 100 })
  assert.deepEqual(place(anchor, popup, bounds, { side: "bottom", offset: 4 }), { left: 150, top: 340, side: "bottom", arrow: 100 })
})

test("a popup lines up with its anchor's start or end edge when it asks to", () => {
  assert.equal(place(anchor, popup, bounds, { align: "start" }).left, 200)
  assert.equal(place(anchor, popup, bounds, { align: "end" }).left, 100)
})

test("a popup takes the other side only where its own has no room and the other does", () => {
  const nearTop = { ...anchor, top: 20 }
  assert.equal(place(nearTop, popup, bounds, { side: "top" }).side, "bottom")
  const nearFoot = { ...anchor, top: 660 }
  assert.equal(place(nearFoot, popup, bounds, { side: "bottom" }).side, "top")
  const tall = { width: 200, height: 690 }
  assert.equal(place(anchor, tall, bounds, { side: "top" }).side, "top", "with room on neither side it keeps the side it asked for")
})

test("a popup stays inside the bounds, and its arrow still points at the anchor", () => {
  const atLeft = { ...anchor, left: 0, width: 40 }
  const placed = place(atLeft, popup, bounds, { inset: 8 })
  assert.equal(placed.left, 8)
  assert.equal(placed.arrow, 12)
  const atRight = { ...anchor, left: 460, width: 40 }
  assert.equal(place(atRight, popup, bounds, { inset: 8 }).left, 292)
})
