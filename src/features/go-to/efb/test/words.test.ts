import assert from "node:assert/strict"
import { test } from "node:test"

import type { Spot } from "../../../../engines/messages/ts/go-to/Spot.ts"
import { saidWords, standName, whereWords } from "../words.ts"

const AT_A_STAND: Spot = { airport: "EGLL", stand: { name: "PARKING", number: 140 }, engines: false, livery: "N515MR" }

test("a stand reads as the frames write it, from the flight file's capitals", () => {
  assert.equal(standName({ name: "PARKING", number: 140 }), "Parking 140")
  assert.equal(standName({ name: "GATE N", number: 17 }), "Gate N 17")
})

test("where the pilot flying is: their stand while their engines are off, the airport alone while they run", () => {
  assert.equal(whereWords(AT_A_STAND, "Baron 58P"), "At EGLL, Parking 140")
  assert.equal(whereWords({ ...AT_A_STAND, engines: true }, "Baron 58P"), "At EGLL, engines running")
  assert.equal(whereWords({ ...AT_A_STAND, airport: null, stand: null }, "Baron 58P"), "In the Baron 58P")
  assert.equal(whereWords(null, "Baron 58P"), "Hasn't loaded a flight yet")
})

test("a stand the world map lacks is a warning, and a failed airport search an error", () => {
  const missing = saidWords({ n: 1, now: false, spot: AT_A_STAND, aircraft: "Baron 58P", outcome: { as: "set-up", no_stand: true } }, "James")
  assert.equal(missing?.level, "warning")
  assert.equal(missing?.text, "Your departure is EGLL, in the Baron 58P, but its stands have no Parking 140. Pick James's stand on the world map, then start the flight.")
  const failed = saidWords({ n: 2, now: true, spot: AT_A_STAND, aircraft: "Baron 58P", outcome: { as: "failed", step: "airport" } }, "James")
  assert.deepEqual(failed, { text: "Join couldn't find EGLL. Try again, or start the flight yourself.", level: "error" })
})

test("Set up only says nothing at an airport the pilot flying's flight names no stand at, and Join now says it starts", () => {
  const noStand = { ...AT_A_STAND, stand: null }
  assert.equal(saidWords({ n: 1, now: false, spot: noStand, aircraft: "Baron 58P", outcome: { as: "set-up", no_stand: false } }, "James"), null)
  assert.deepEqual(saidWords({ n: 2, now: true, spot: noStand, aircraft: "Baron 58P", outcome: { as: "set-up", no_stand: false } }, "James"), { text: "Starting your flight at EGLL" })
})
