import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { makeBlurPage } from "./lib/pages.ts"
import { STOCK } from "./lib/stock.ts"

test("our BlurPage copy is the stock component with the menu script's loader inside its root element", () => {
  const stock = fs.readFileSync(path.join(STOCK, "{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}.html"), "utf8")
  const copy = makeBlurPage(stock)
  const at = copy.indexOf("<svg")
  assert.ok(at > 0, "the loader should be in the copy")
  assert.equal(copy.slice(0, at), stock.slice(0, stock.lastIndexOf("</")), "everything before the loader should be the stock component's")
  assert.ok(copy.endsWith("</ui-resource-element>"), "the copy should still close its root element")
  assert.match(copy, /script\.src = 'coui:\/\/html_ui\/DualInput\/menu\.js'/)
  assert.match(copy, /window\.DUALINPUT_MENU_LOADED/, "the loader should load the script once in each document")
})
