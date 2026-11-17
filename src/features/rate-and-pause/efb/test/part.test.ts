import assert from "node:assert/strict"
import { test } from "node:test"

import type { JsonValue } from "../../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { PartApi } from "../../../../platform/efb-shell/src/part.ts"
import { NAME, rateAndPause } from "../index.ts"

test("each unit message sets active pause through the toolbar's call, until the part stops", () => {
  const calls: [string, boolean][] = []
  const part = rateAndPause(async (name, on) => void calls.push([name, on]))
  let hear: ((body: JsonValue) => void) | undefined
  const api: PartApi = {
    watch: () => () => {},
    command: async () => {},
    onUnit: (unit, f) => {
      assert.equal(unit, NAME)
      hear = f
      return () => (hear = undefined)
    },
    sendUnit: () => true,
  }
  part.start!(api)
  hear!({ on: true })
  hear!({ on: false })
  assert.deepEqual(calls, [
    ["TOOLBAR_SET_ACTIVE_PAUSE", true],
    ["TOOLBAR_SET_ACTIVE_PAUSE", false],
  ])
  part.stop!()
  assert.equal(hear, undefined)
})
