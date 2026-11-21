import assert from "node:assert/strict"
import { test } from "node:test"

import { holdsLevels } from "./lib/levels.ts"

test("only a release from 1.0.0 on freezes its levels", () => {
  for (const tag of ["0.1.0", "0.12.3"]) assert.equal(holdsLevels(tag), false, tag)
  for (const tag of ["1.0.0", "1.4.2", "12.0.0"]) assert.equal(holdsLevels(tag), true, tag)
})
