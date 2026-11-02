import assert from "node:assert/strict"
import { test } from "node:test"

import type { Notification } from "../../../engines/messages/ts/clients/Notification.ts"
import { raisedRows } from "../src/header/raised.ts"

const raised = (id: string, landing: Notification["landing"] = "header", level: Notification["level"] = "trouble"): Notification => ({ id, level, text: `${id} says`, detail: `${id} costs`, landing })

test("only what lands on the header gets a row, in the header's order, with the core's own words", () => {
  const rows = raisedRows([raised("sim-service.package"), raised("session.crew-1", "session"), raised("clients.no-panel")])
  assert.deepEqual(
    rows.map((row) => [row.id, row.word, row.title, row.detail]),
    [
      ["clients.no-panel", "Screens", "clients.no-panel says", "clients.no-panel costs"],
      ["sim-service.package", "WASM", "sim-service.package says", "sim-service.package costs"],
    ],
  )
})

test("a helper's failed want says what kind it is, a key by default", () => {
  const words = (id: string) => raisedRows([raised(id, "header", "warning")])[0]!
  assert.equal(words("core-helper.failed.binding-3").word, "Keybind")
  assert.equal(words("core-helper.failed.next-press").word, "Keybind")
  assert.equal(words("core-helper.failed.mouse").word, "Mouse")
  assert.equal(words("core-helper.failed.capture-1").word, "Audio")
  assert.equal(words("core-helper.failed.stream-2").word, "Audio")
  assert.equal(words("core-helper.failed.mouse").trouble, false)
})

test("a kind the header doesn't know yet still shows, last", () => {
  const rows = raisedRows([raised("avatars.seat"), raised("clients.no-panel")])
  assert.deepEqual(rows.map((row) => row.word), ["Screens", "Trouble"])
})
