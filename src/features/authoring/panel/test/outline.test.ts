import assert from "node:assert/strict"
import { type TestContext, test } from "node:test"

import type { Outline } from "../../../../engines/messages/ts/authoring/Outline.ts"
import type { Bridge } from "../../../../platform/panel-bridge/src/bridge.ts"
import { asElement, type FakeElement } from "../../../../platform/panel-bridge/test/fake-document.ts"
import { type FakePanel, started } from "../../../../platform/panel-bridge/test/fake-panel.ts"
import { MARK, NAME, outline } from "../src/outline.ts"

/** A panel with the module started on `KX155B|Index=1` at 100,100, 400 by 200, with a button on it, and `KX155B|Index=2` beside it. */
function panel(t: TestContext): { panel: FakePanel; bridge: Bridge; one: FakeElement; two: FakeElement; button: FakeElement } {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 })
  const { panel, bridge } = started()
  const one = panel.doc.instrument("KX155B", { left: 100, top: 100, width: 400, height: 200 }, "/KX155B.html?Index=1")
  const button = one.add("button", { left: 100, top: 100, width: 50, height: 50 })
  const two = panel.doc.instrument("KX155B", { left: 600, top: 100, width: 400, height: 200 }, "/KX155B.html?Index=2")
  bridge.add(asElement(one))
  bridge.add(asElement(two))
  panel.join()
  panel.say({ t: "load", modules: [{ name: NAME, instruments: ["KX155B|Index=1", "KX155B|Index=2"] }] })
  bridge.define(NAME, outline())
  return { panel, bridge, one, two, button }
}

function say(p: FakePanel, body: Outline): void {
  p.say({ t: "unit", unit: NAME, body })
}

function boxes(p: FakePanel): FakeElement[] {
  return p.doc.querySelectorAll(`[${MARK}]`)
}

test("the outline is a box over the instrument with its key in the middle, which passes every press", (t) => {
  const { panel: p, button } = panel(t)
  say(p, { instruments: ["KX155B|Index=1"] })
  const [box] = boxes(p)
  assert.ok(box, "a box")
  assert.equal(boxes(p).length, 1)
  assert.deepEqual(box.getBoundingClientRect(), { left: 100, top: 100, width: 400, height: 200 })
  assert.equal(box.textContent, "KX155B|Index=1")
  assert.equal(box.style.pointerEvents, "none")
  assert.equal(p.doc.elementFromPoint(120, 120), button, "a press there reaches the display's button")
  p.doc.press(120, 120)
  p.doc.release(120, 120)
  assert.deepEqual(
    button.heard.map((h) => h.type),
    ["mousedown", "mouseup"],
  )
})

test("each message replaces the outline, and an empty one clears it", (t) => {
  const { panel: p } = panel(t)
  say(p, { instruments: ["KX155B|Index=1", "KX155B|Index=2"] })
  assert.equal(boxes(p).length, 2, "both, for a heading over two keys")
  say(p, { instruments: ["KX155B|Index=2"] })
  assert.deepEqual(
    boxes(p).map((b) => b.getAttribute(MARK)),
    ["KX155B|Index=2"],
  )
  say(p, { instruments: [] })
  assert.equal(boxes(p).length, 0)
})

test("stopping the module removes its boxes, as the bridge's unlock does", (t) => {
  const { panel: p, bridge } = panel(t)
  say(p, { instruments: ["KX155B|Index=1"] })
  bridge.unlock()
  assert.equal(boxes(p).length, 0)
  say(p, { instruments: ["KX155B|Index=1"] })
  assert.equal(boxes(p).length, 0, "a stopped module draws nothing")
})
