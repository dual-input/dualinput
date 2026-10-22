// The core going away and coming back: suspended for 12s, it keeps every page's socket and
// each panel's modules, and restarted on another port, every page connects again within 2s
// of its next announcement (record/areas/core/02-clients-and-panel-bridge.md, "Cases for the
// bench" and "Budgets").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"
import { FakePage } from "../pages.ts"
import { resume, suspend } from "../suspend.ts"

async function announcing(run: BenchRun, name: string): Promise<Core> {
  const core = await run.core(name)
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  return core
}

test("the core suspended for 12s leaves every page its socket, and each panel's modules carry on without loading again", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-suspended", t)
  const core = await announcing(run, "a")
  core.clients({ act: "session", on: true })
  const efb = new FakePage(core, { component: "efb" })
  const panel = new FakePage(core, { component: "panel-bridge", sessionOnly: true, panel: "VCockpit60", instruments: ["PFD_0"] })
  t.after(() => [efb, panel].forEach((p) => p.close()))
  await panel.until(() => panel.client.connected && efb.client.connected, "both pages connecting")
  core.clients({ act: "profile", loaded: true, picks: ["PFD"] })
  await panel.until(() => panel.messages("load").length === 1, "the panel's load")

  suspend(core.process.pid!)
  try {
    await sleep(12_000)
    assert.equal(efb.client.state, "silent", "a page notes the core's silence")
    assert.equal(panel.client.state, "silent")
  } finally {
    resume(core.process.pid!)
  }
  await panel.until(() => panel.client.state === "connected" && efb.client.state === "connected", "both pages hearing the core again")
  await sleep(4_000)
  assert.equal(efb.opened.length, 1, "the page's socket was kept")
  assert.equal(panel.opened.length, 1, "the panel's socket was kept")
  assert.equal(panel.messages("load").length, 1, "the panel's modules carried on without loading again")
})

test("the core restarted on another port has every page connect again within 2s of its next announcement", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-restarted", t)
  const first = await announcing(run, "a")
  const pages = [new FakePage(first, { component: "efb" }), new FakePage(first, { component: "menu-script" })]
  t.after(() => pages.forEach((p) => p.close()))
  await pages[0]!.until(() => pages.every((p) => p.client.connected), "every page connecting")
  const port = first.port()
  await first.kill()

  const second = await run.core("a")
  let announced = 0
  const stop = second.onCommBus((name) => {
    if (name === "DUALINPUT_CORE_ANNOUNCE" && !announced) announced = performance.now()
  })
  for (const p of pages) p.listenTo(second)
  second.act({ act: "watch", process: run.stub().id })
  await pages[0]!.until(() => pages.every((p) => p.opened.length === 2), "every page connecting to the restarted core")
  stop()
  assert.notEqual(second.port(), port, "the restarted core listens on another port")
  // Each page's second socket opened within 2s of the restarted core's first announcement.
  for (const p of pages) {
    const reconnected = p.opened[1]! + (performance.now() - p.now()) - announced
    console.log(`budget: a page connected again ${reconnected.toFixed(0)}ms after the restarted core's announcement, against 2,000ms`)
    assert.ok(reconnected < 2_000, `a page connected again ${reconnected.toFixed(0)}ms after the announcement`)
  }
})
