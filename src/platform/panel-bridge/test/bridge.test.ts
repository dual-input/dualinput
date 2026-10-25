import assert from "node:assert/strict"
import { test } from "node:test"

import { keyFor, type PanelModuleDef } from "../src/bridge.ts"
import { started } from "./fake-panel.ts"

function instrument(tag: string, identifier?: string, url?: string): Element {
  return {
    tagName: tag.toUpperCase(),
    instrumentIdentifier: identifier,
    getAttribute: (name: string) => (name.toLowerCase() === "url" ? (url ?? null) : null),
  } as unknown as Element
}

/** A panel module that records what happened to it. */
function recorder(log: string[], name: string, throws = false): PanelModuleDef {
  return {
    start(ctx) {
      log.push(`${name} started with ${ctx.instruments.length}`)
      if (throws) throw new Error("broken")
    },
    stop() {
      log.push(`${name} stopped`)
    },
  }
}

test("an instrument's key is its identifier or tag, and its url's query, as FS Copilot's", () => {
  assert.equal(keyFor(instrument("ctp-display", "CTP", "/Pages/VCockpit/Instruments/CTP.html?side=left")), "CTP|side=left")
  assert.equal(keyFor(instrument("as1000-pfd", undefined, "/x.html")), "as1000-pfd")
})

test("a panel module that fails to load, or throws in start, leaves the others running", () => {
  const { panel, bridge } = started()
  bridge.add(instrument("pfd", "PFD"))
  panel.join()
  assert.deepEqual(panel.socket!.sent[0]!.instruments, ["PFD"])
  panel.say({ t: "load", modules: [{ name: "a", instruments: ["PFD"] }, { name: "b", instruments: ["PFD"] }, { name: "c", instruments: [] }] })
  assert.deepEqual(panel.scripts.map((s) => s.src), ["/DualInput/modules/a.js", "/DualInput/modules/b.js", "/DualInput/modules/c.js"])
  const log: string[] = []
  panel.scripts[0]!.failed()
  bridge.define("b", recorder(log, "b", true))
  bridge.define("c", recorder(log, "c"))
  assert.deepEqual(log, ["b started with 1", "c started with 0"])
  assert.ok(panel.logs.some((l) => l.includes("panel module a didn't load")))
  assert.ok(panel.logs.some((l) => l.includes("panel module b threw")))
})

test("with the core's socket closed, every panel module stops at once, and unlock stops them too", () => {
  const { panel, bridge } = started()
  panel.join()
  const log: string[] = []
  panel.say({ t: "load", modules: [{ name: "a", instruments: [] }] })
  bridge.define("a", recorder(log, "a"))
  panel.socket!.s.onclose!()
  assert.deepEqual(log, ["a started with 0", "a stopped"])
  panel.join()
  panel.say({ t: "load", modules: [{ name: "a", instruments: [] }] })
  bridge.define("a", recorder(log, "a"))
  bridge.unlock()
  assert.deepEqual(log.slice(2), ["a started with 0", "a stopped"])
})

test("a load naming a running module loads nothing again, and its messages reach it until it stops", () => {
  const { panel, bridge } = started()
  panel.join()
  const heard: unknown[] = []
  panel.say({ t: "load", modules: [{ name: "a", instruments: [] }] })
  bridge.define("a", { start: (ctx) => ctx.on((body) => heard.push(body)) })
  panel.say({ t: "load", modules: [{ name: "a", instruments: [] }] })
  assert.equal(panel.scripts.length, 1)
  panel.say({ t: "unit", unit: "a", body: 1 })
  panel.say({ t: "stop", modules: ["a"] })
  panel.say({ t: "unit", unit: "a", body: 2 })
  assert.deepEqual(heard, [1])
})

test("a stop that leaves the panel no module closes its socket", () => {
  const { panel, bridge } = started()
  panel.join()
  panel.say({ t: "load", modules: [{ name: "a", instruments: [] }] })
  bridge.define("a", { start() {} })
  panel.say({ t: "stop", modules: ["a"] })
  assert.equal(panel.socket!.closed, true)
  assert.equal(bridge.status().connection, "closed")
})

test("an instrument created after the hello joins again, so the core's hello names every instrument", () => {
  const { panel, bridge } = started()
  bridge.add(instrument("pfd", "PFD"))
  panel.join()
  bridge.add(instrument("mfd", "MFD"))
  panel.socket!.s.onopen!()
  assert.deepEqual(panel.socket!.sent[0]!.instruments, ["PFD", "MFD"])
})

test("a rejoin stops the panel's modules, so the core's load on the new socket starts each again with its instruments", () => {
  const { panel, bridge } = started()
  bridge.add(instrument("pfd", "PFD"))
  panel.join()
  const log: string[] = []
  panel.say({ t: "load", modules: [{ name: "a", instruments: ["PFD"] }] })
  bridge.define("a", recorder(log, "a"))
  bridge.add(instrument("mfd", "MFD"))
  assert.deepEqual(log, ["a started with 1", "a stopped"])
  panel.socket!.s.onopen!()
  panel.say({ t: "load", modules: [{ name: "a", instruments: ["PFD", "MFD"] }] })
  assert.equal(panel.scripts.length, 2, "the module's file loads again")
  bridge.define("a", recorder(log, "a"))
  assert.deepEqual(log.slice(2), ["a started with 2"])
})
