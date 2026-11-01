import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { isInSimCode } from "./lib/in-sim.ts"
import { makeBlurPage } from "./lib/pages.ts"
import { STOCK } from "./lib/stock.ts"

test("the hook rebuilds our bundles for an edit in the sim's code, by a path from the repository's root", () => {
  for (const file of [
    "src/engines/page-client/src/page-client.ts",
    "src/packages/ui/src/button.tsx",
    "src/platform/efb-shell/src/shell.tsx",
    "src/platform/panel-bridge/src/start.ts",
    "src/platform/panel-bridge/vcockpit/top.js",
    "src/sim-package/pages/menu.ts",
    "src/features/pointer-sync/panel/src/module.ts",
    "src/features/take-control/efb/part.tsx",
  ]) {
    assert.ok(isInSimCode(file), `${file} runs in the sim`)
  }
  for (const file of ["src/platform/clients/src/lib.rs", "src/features/pointer-sync/core/src/lib.rs", "tools/check.ts", "sim-package/pages/menu.ts"]) {
    assert.ok(!isInSimCode(file), `${file} doesn't run in the sim`)
  }
})

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
