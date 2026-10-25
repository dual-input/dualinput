import assert from "node:assert/strict"
import { type TestContext, test } from "node:test"

import type { PanelCtx } from "../src/bridge.ts"
import { asElement, type FakeElement } from "./fake-document.ts"
import { type FakePanel, started } from "./fake-panel.ts"

/** A panel whose one display, `PFD`, has a button, with a module started on it that hands back its ctx. */
function panelWithModule(t: TestContext): { panel: FakePanel; display: FakeElement; button: FakeElement; ctx: PanelCtx; unlock: () => void } {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { panel, bridge } = started()
  const display = panel.doc.instrument("PFD", { left: 100, top: 100, width: 400, height: 300 })
  const button = display.add("button", { left: 120, top: 120, width: 40, height: 40 })
  bridge.add(asElement(display))
  panel.join()
  panel.say({ t: "load", modules: [{ name: "m", instruments: ["PFD"] }] })
  let ctx: PanelCtx | null = null
  bridge.define("m", { start: (c) => (ctx = c) })
  return { panel, display, button, ctx: ctx!, unlock: () => bridge.unlock() }
}

/** The bridge's locks in the panel's document. */
function locks(panel: FakePanel): FakeElement[] {
  return panel.doc.querySelectorAll("[data-dualinput-lock]")
}

test("an unseen lock takes the pilot's presses and lapses 2s after its last renewal", (t) => {
  const { panel, button, display, ctx } = panelWithModule(t)
  const lock = ctx.unseenLock(asElement(display))
  panel.doc.press(130, 130)
  panel.doc.release(130, 130)
  assert.equal(button.heard.length, 0, "the display hears nothing")
  t.mock.timers.tick(1_500)
  lock.renew()
  t.mock.timers.tick(1_900)
  assert.equal(locks(panel).length, 1, "a renewal holds it another 2s")
  t.mock.timers.tick(200)
  assert.equal(locks(panel).length, 0)
  panel.doc.press(130, 130)
  assert.equal(button.heard.at(-1)?.type, "mousedown", "the display hears the pilot again")
})

test("a press on an unseen lock flashes it until the up, and a lock released meanwhile stays until then", (t) => {
  const { panel, display, ctx } = panelWithModule(t)
  const lock = ctx.unseenLock(asElement(display))
  assert.equal(locks(panel)[0]!.style.get("background-color"), "transparent", "an unseen lock paints nothing")
  panel.doc.press(300, 200)
  assert.equal(locks(panel)[0]!.style.get("background-color"), "rgba(255, 69, 0, 0.6)", "the flash")
  assert.equal(locks(panel)[0]!.textContent, "", "the flash has no words")
  lock.release()
  assert.equal(locks(panel).length, 1, "the lock the press is held on stays")
  panel.doc.release(130, 130)
  assert.equal(locks(panel).length, 0, "and goes at the press's up")
})

test("a press a lock took whose up the panel never hears holds the lock no longer than 10s", (t) => {
  const { panel, display, ctx } = panelWithModule(t)
  const lock = ctx.unseenLock(asElement(display))
  panel.doc.press(300, 200)
  lock.release()
  t.mock.timers.tick(9_900)
  assert.equal(locks(panel).length, 1)
  t.mock.timers.tick(100)
  assert.equal(locks(panel).length, 0)
})

test("the hit test looks past every lock, and an event the module fires is ours", (t) => {
  const { panel, button, display, ctx } = panelWithModule(t)
  ctx.unseenLock(asElement(display))
  ctx.visibleLock(asElement(display), "Locked")
  assert.equal(panel.doc.elementFromPoint(130, 130)?.hasAttribute("data-dualinput-lock"), true)
  const hit = ctx.hitTest(130, 130)
  assert.equal(hit, asElement(button))
  assert.equal(locks(panel)[0]!.style.pointerEvents, "auto", "the lock blocks again after the hit test")
  const seen: Event[] = []
  panel.doc.addEventListener("mousedown", (e) => seen.push(e as unknown as Event), true)
  ctx.fire(hit!, "mousedown", 130, 130, 0)
  assert.equal(button.heard.at(-1)?.type, "mousedown", "a fired event reaches the display under the lock")
  assert.equal(ctx.ours(seen[0]!), true)
  panel.doc.press(130, 130)
  panel.doc.release(130, 130)
  assert.equal(ctx.ours(seen[1]!), false, "a press that lands on a lock is the pilot's")
  assert.equal(ctx.onLock(seen[1]!), true, "and it's on a lock")
  ctx.visibleLock(asElement(display), null)
  t.mock.timers.tick(2_000)
  panel.doc.press(130, 130)
  assert.equal(ctx.onLock(seen[2]!), false, "the pilot's press with no lock reaches the display")
})

test("with the core silent for 8s, a visible lock turns into a warning within 10s of its last message, and unlock removes it at once", (t) => {
  const { panel, display, ctx, unlock } = panelWithModule(t)
  ctx.visibleLock(asElement(display), "No link to the pilot flying.")
  const lock = locks(panel)[0]!
  assert.equal(lock.textContent, "No link to the pilot flying.")
  assert.equal(lock.style.pointerEvents, "auto", "it blocks")
  panel.advance(7_900)
  assert.equal(lock.style.pointerEvents, "auto", "it blocks while the core has been silent under 8s")
  panel.advance(2_000)
  assert.equal(locks(panel)[0]!.style.pointerEvents, "none", "the warning blocks nothing")
  assert.match(locks(panel)[0]!.textContent, /stopped responding/)
  panel.say({ t: "alive" })
  assert.equal(locks(panel)[0]!.style.pointerEvents, "auto", "the core's next message makes it a lock again")
  unlock()
  assert.equal(locks(panel).length, 0)
})

test("with the core's socket closed, every lock drops at once", (t) => {
  const { panel, display, ctx } = panelWithModule(t)
  ctx.unseenLock(asElement(display))
  ctx.visibleLock(asElement(display), "Catching up.")
  panel.doc.press(130, 130)
  panel.socket!.s.onclose!()
  assert.equal(locks(panel).length, 0, "a press held on one included")
  ctx.unseenLock(asElement(display))
  ctx.visibleLock(asElement(display), "Catching up.")
  assert.equal(locks(panel).length, 0, "a stopped module's locks hold nothing")
})

test("unlock removes a lock the bridge lost track of", (t) => {
  const { panel, unlock } = panelWithModule(t)
  const stray = panel.doc.createElement("div")
  stray.setAttribute("data-dualinput-lock", "m")
  panel.doc.body.appendChild(stray)
  unlock()
  assert.equal(locks(panel).length, 0)
})
