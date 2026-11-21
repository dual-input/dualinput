import assert from "node:assert/strict"
import { test } from "node:test"

import { inFolders, sameAircraft } from "../src/session/pick.ts"

const BARON = { maker: "Black Square", model: "Baron 58P", folders: ["bksq-aircraft-baronpropress"] }

test("a pick lands on its folder whatever the sim names the aircraft", () => {
  const loaded = { path: "bksq-aircraft-baronpropress", maker: "Black Square", model: "Baron 58P Professional" }
  assert.notEqual(loaded.model, BARON.model)
  assert.equal(inFolders(loaded.path, BARON.folders), true)
})

test("a preset's path lands on its folder", () => {
  assert.equal(inFolders("pa24-250/presets/a2a/pa24-250", ["pa24-250"]), true)
})

test("another folder is no landing, though it starts the same", () => {
  assert.equal(inFolders("bksq-aircraft-baronproturbo", BARON.folders), false)
  assert.equal(inFolders("bksq-aircraft-baronpro", BARON.folders), false)
})

test("a tile the core sent again is the same aircraft", () => {
  const sentAgain: typeof BARON = JSON.parse(JSON.stringify(BARON))
  assert.notEqual(sentAgain, BARON)
  assert.equal(sameAircraft(BARON, sentAgain), true)
  assert.equal(sameAircraft(BARON, { ...BARON, model: "Baron 58" }), false)
})
