import assert from "node:assert/strict"
import { test } from "node:test"

import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { definePart, startParts, stopParts } from "../src/part.ts"

/** No part here reaches the core, so no link stands behind this. */
const NO_LINK = { client: {} } as CoreLink

function quietly(run: () => void): string[] {
  const said: string[] = []
  const error = console.error
  console.error = (text: string) => void said.push(text)
  run()
  console.error = error
  return said
}

test("a part whose start throws leaves the app's other parts running", () => {
  const started: string[] = []
  const parts = [
    definePart({ name: "first", start: () => void started.push("first") }),
    definePart({
      name: "broken",
      start: () => {
        throw new Error("no aircraft")
      },
    }),
    definePart({ name: "last", start: () => void started.push("last") }),
  ]
  const said = quietly(() => startParts(parts, NO_LINK))
  assert.deepEqual(started, ["first", "last"])
  assert.equal(said.length, 1)
  assert.match(said[0]!, /the broken part's start threw: Error: no aircraft/)
})

test("a part whose stop throws leaves the others to stop", () => {
  const stopped: string[] = []
  const parts = [
    definePart({
      name: "broken",
      stop: () => {
        throw new Error("gone")
      },
    }),
    definePart({ name: "last", stop: () => void stopped.push("last") }),
  ]
  const said = quietly(() => stopParts(parts))
  assert.deepEqual(stopped, ["last"])
  assert.match(said[0]!, /the broken part's stop threw/)
})
