import assert from "node:assert/strict"
import { type TestContext, test } from "node:test"

import type { Gesture } from "../../../../engines/messages/ts/pointer-sync/Gesture.ts"
import type { Bridge } from "../../../../platform/panel-bridge/src/bridge.ts"
import { asElement, type FakeElement } from "../../../../platform/panel-bridge/test/fake-document.ts"
import { type FakePanel, started } from "../../../../platform/panel-bridge/test/fake-panel.ts"
import { NAME, pointerSync } from "../src/module.ts"

type Sent = { t: string; display?: string; gesture?: Gesture; displays?: string[]; up?: number }

/**
 * A panel with the module started on its displays: `PFD` at 100,100, 400 by 300, with a button
 * in its top-left corner, and `MFD|side=2` beside it. Its clock starts at 0.
 */
function panel(t: TestContext): { panel: FakePanel; bridge: Bridge; pfd: FakeElement; button: FakeElement; mfd: FakeElement } {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 })
  const { panel, bridge } = started()
  const pfd = panel.doc.instrument("PFD", { left: 100, top: 100, width: 400, height: 300 })
  const button = pfd.add("button", { left: 100, top: 100, width: 100, height: 100 })
  const mfd = panel.doc.instrument("MFD", { left: 600, top: 100, width: 400, height: 300 }, "/MFD.html?side=2")
  bridge.add(asElement(pfd))
  bridge.add(asElement(mfd))
  panel.join()
  panel.say({ t: "load", modules: [{ name: NAME, instruments: ["PFD", "MFD|side=2"] }] })
  bridge.define(NAME, pointerSync())
  return { panel, bridge, pfd, button, mfd }
}

/** What the module sent its feature, oldest first. */
function sent(p: FakePanel): Sent[] {
  return p.sent("unit").map((m) => m.body as Sent)
}

function gestures(p: FakePanel): Gesture[] {
  return sent(p).flatMap((m) => (m.t === "gesture" ? [m.gesture!] : []))
}

/** Another pilot's gesture message, as the core hands it to the panel. */
function play(p: FakePanel, display: string, gesture: Gesture, up?: number): void {
  p.say({ t: "unit", unit: NAME, body: up === undefined ? { display, gesture } : { display, gesture, up } })
}

function locks(p: FakePanel): FakeElement[] {
  return p.doc.querySelectorAll("[data-dualinput-lock]")
}

test("a tap goes out as a down and an up that clicks, at fractions of the display's rect, after the displays it serves", (t) => {
  const { panel: p } = panel(t)
  p.doc.press(200, 175)
  p.doc.release(201, 176)
  assert.deepEqual(sent(p)[0], { t: "displays", displays: ["PFD", "MFD|side=2"] })
  assert.deepEqual(gestures(p), [{ down: { button: 0, point: { x: 0.25, y: 0.25 } } }, { up: { point: { x: 101 / 400, y: 76 / 300 }, click: true } }])
})

test("a drag's moves go at most every 33ms and 2px apart, a press held still sends Held each 1s, and a drag's up doesn't click", (t) => {
  const { panel: p } = panel(t)
  p.doc.press(200, 200)
  t.mock.timers.tick(20)
  p.doc.move(210, 200)
  t.mock.timers.tick(20)
  p.doc.move(220, 200)
  t.mock.timers.tick(40)
  p.doc.move(221, 200)
  t.mock.timers.tick(1_000)
  t.mock.timers.tick(1_000)
  p.doc.release(260, 200)
  const kinds = gestures(p).map((g) => (typeof g === "string" ? g : Object.keys(g)[0]))
  assert.deepEqual(kinds, ["down", "move", "held", "held", "up"], "the move 20ms after the down waits, and the one 1px on doesn't go")
  assert.deepEqual(gestures(p)[1], { move: { point: { x: 0.3, y: 1 / 3 } } })
  assert.deepEqual(gestures(p)[4], { up: { point: { x: 0.4, y: 1 / 3 }, click: false } })
})

test("two displays in one panel each send under their own key, and a down with a gesture open sends its up first", (t) => {
  const { panel: p } = panel(t)
  p.doc.press(200, 200)
  p.doc.press(700, 200)
  p.doc.release(700, 200)
  assert.deepEqual(
    sent(p).filter((m) => m.t === "gesture").map((m) => [m.display, typeof m.gesture === "string" ? m.gesture : Object.keys(m.gesture!)[0]]),
    [
      ["PFD", "down"],
      ["PFD", "up"],
      ["MFD|side=2", "down"],
      ["MFD|side=2", "up"],
    ],
  )
  assert.equal((gestures(p)[1] as { up: { click: boolean } }).up.click, false, "the up it never heard doesn't click")
  p.doc.release(700, 200)
  assert.equal(gestures(p).length, 4, "an up with no gesture open sends nothing")
})

test("another pilot's tap plays at the same fractions under an unseen lock, and nothing the module dispatches goes back out", (t) => {
  const { panel: p, button } = panel(t)
  play(p, "PFD", { down: { button: 0, point: { x: 0.1, y: 0.1 } } })
  assert.equal(locks(p).length, 1, "the unseen lock comes with the down")
  play(p, "PFD", { up: { point: { x: 0.1, y: 0.1 }, click: true } }, 7)
  assert.deepEqual(
    button.heard.map((h) => [h.type, h.x, h.y]),
    [
      ["mousedown", 140, 130],
      ["mouseup", 140, 130],
      ["click", 140, 130],
    ],
  )
  assert.deepEqual(gestures(p), [], "none of it is captured")
  assert.deepEqual(sent(p).at(-1), { t: "done", up: 7 })
  assert.equal(locks(p).length, 0, "the up releases the lock")
})

test("a press on a display under another pilot's gesture flashes it, starts no gesture, and reaches nothing", (t) => {
  const { panel: p, button } = panel(t)
  play(p, "PFD", { down: { button: 0, point: { x: 0.5, y: 0.5 } } })
  p.doc.press(150, 150)
  assert.equal(locks(p)[0]!.style.get("background-color"), "rgba(255, 69, 0, 0.6)")
  play(p, "PFD", { up: { point: { x: 0.5, y: 0.5 }, click: false } }, 1)
  assert.equal(locks(p).length, 1, "the lock stays while the press is held")
  p.doc.release(150, 150)
  assert.equal(locks(p).length, 0)
  assert.deepEqual(gestures(p), [])
  assert.deepEqual(
    button.heard.map((h) => h.type),
    [],
    "the pilot's press never reached the button",
  )
})

test("an up for a display with no gesture playing is answered at once, and a lapsed gesture starts again at its up and clicks", (t) => {
  const { panel: p, button } = panel(t)
  play(p, "PFD", { up: { point: { x: 0.1, y: 0.1 }, click: true } }, 3)
  assert.deepEqual(sent(p).at(-1), { t: "done", up: 3 })
  assert.equal(button.heard.length, 0)
  play(p, "PFD", { down: { button: 0, point: { x: 0.1, y: 0.1 } } })
  t.mock.timers.tick(2_000)
  assert.equal(p.doc.heard.at(-1)?.type, "mouseup", "the lapse ends it with a mouseup on the document")
  assert.equal(locks(p).length, 0)
  play(p, "PFD", { up: { point: { x: 0.1, y: 0.1 }, click: true } }, 4)
  assert.deepEqual(
    button.heard.map((h) => h.type),
    ["mousedown", "mousedown", "mouseup", "click"],
  )
})

test("another pilot's down while this pilot's button is down locks the display only at this pilot's up, which goes out", (t) => {
  const { panel: p } = panel(t)
  p.doc.press(300, 300)
  play(p, "PFD", { down: { button: 0, point: { x: 0.9, y: 0.9 } } })
  assert.equal(locks(p).length, 0)
  p.doc.release(300, 300)
  assert.equal(locks(p).length, 1, "the lock comes at the up")
  assert.deepEqual(Object.keys(gestures(p).at(-1) as object), ["up"])
})

test("this pilot's up ends its gesture wherever it lands, a lock included", (t) => {
  const { panel: p } = panel(t)
  p.doc.press(700, 200)
  play(p, "PFD", { down: { button: 0, point: { x: 0.5, y: 0.5 } } })
  p.doc.release(300, 250)
  assert.deepEqual(
    gestures(p).map((g) => Object.keys(g as object)[0]),
    ["down", "up"],
    "the up on the PFD's lock ends the MFD's gesture",
  )
})

test("a gesture whose pilot is still for 30s ends with an up and no click, and a module that stops serves no display", (t) => {
  const { panel: p, bridge } = panel(t)
  p.doc.press(200, 200)
  for (let s = 0; s < 29; s++) t.mock.timers.tick(1_000)
  assert.equal(gestures(p).filter((g) => g === "held").length, 29, "Held each 1s while it's held still")
  t.mock.timers.tick(1_000)
  assert.deepEqual(gestures(p).at(-1), { up: { point: { x: 0.25, y: 1 / 3 }, click: false } })
  bridge.unlock()
  assert.deepEqual(sent(p).at(-1), { t: "displays", displays: [] })
})

test("the visible lock shows the slice's words on every display, each once its own pilot's gesture there has ended", (t) => {
  const { panel: p } = panel(t)
  p.doc.press(300, 300)
  p.say({ t: "state", slice: NAME, value: "no-link" })
  assert.equal(locks(p).length, 1, "only the display without a gesture open locks")
  assert.match(locks(p)[0]!.textContent, /Take control/)
  p.doc.release(300, 300)
  assert.equal(locks(p).length, 2)
  p.say({ t: "state", slice: NAME, value: "none" })
  assert.equal(locks(p).length, 0)
})
