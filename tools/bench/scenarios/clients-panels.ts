// Cockpit panels and their modules, with a session hosted through the bench's local backend,
// and the clients' test unit standing in for the profile loader: panels connect only in a
// session, each is answered once the profile loads, a panel told none stays away, a reloaded
// panel replaces its socket, and trouble shows when no panel connects
// (record/areas/core/02-clients-and-panel-bridge.md, "Cases for the bench" and "Budgets";
// record/areas/interface/01-apps.md, "Cases for the bench").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"
import { app, BenchNetwork, host } from "../network.ts"
import { FakePage } from "../pages.ts"

/** A core on a stub sim, with the bench's backend, which its session needs. */
async function announcing(run: BenchRun, name: string, net: BenchNetwork): Promise<Core> {
  const core = await run.core(name, net.core())
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  return core
}

/** A fake cockpit panel's bridge, named as the sim names a panel. */
function panel(core: Core, name: string, instruments: string[]): FakePage {
  return new FakePage(core, { component: "panel-bridge", sessionOnly: true, panel: name, instruments })
}

/** Resolves with when the core next announces with `session`, in ms after the call. */
function nextAnnouncement(core: Core, session: boolean): Promise<number> {
  const started = performance.now()
  return new Promise((resolve) => {
    const stop = core.onCommBus((name, data) => {
      if (name === "DUALINPUT_CORE_ANNOUNCE" && (JSON.parse(data) as { session: boolean }).session === session) {
        stop()
        resolve(performance.now() - started)
      }
    })
  })
}

test("panels connect only in a session, each of 20 is answered within 1s of the profile loading, and one told none stays away until the next session", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-panels", t)
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const core = await announcing(run, "a", net)
  // As many cockpit panels as the Black Square Baron 58P has, 3 of them with a display the
  // profile's panel module takes (record/areas/interface/log.md, 2026-10-04), and the last
  // two each holding an instrument keyed GNS_DISABLED, as two of the Baron's do.
  const instruments = (i: number) => (i < 3 ? [`PFD_${i}|side=${i}`, `KNOB_${i}`] : i >= 18 ? ["GNS_DISABLED"] : [`GAUGE_${i}`])
  const panels = Array.from({ length: 20 }, (_, i) => panel(core, `VCockpit${i + 60}`, instruments(i)))
  t.after(() => panels.forEach((p) => p.close()))
  await sleep(2_500)
  assert.equal(panels.filter((p) => p.opened.length).length, 0, "no panel connects with no session")

  // The announcement goes out within one input of the session crate's call, in the input of
  // the backend's answer, so long before the next 2s one
  // (record/areas/core/03-sim-seam-and-wasm-module.md, "Budgets").
  const announced = nextAnnouncement(core, true)
  await host(core, "Host")
  const ms = await announced
  assert.ok(ms < 500, `the announcement came ${ms.toFixed(0)}ms after the session started`)
  await panels[0]!.until(() => panels.every((p) => p.client.connected), "every panel connecting")

  const loading = performance.now()
  core.clients({ act: "profile", loaded: true, picks: ["PFD"] })
  await panels[0]!.until(() => panels.every((p) => p.messages("load").length + p.messages("none").length > 0), "every panel's answer", 5_000)
  const answered = performance.now() - loading
  console.log(`budget: 20 panels answered ${answered.toFixed(0)}ms after the profile loaded, against 1,000ms`)
  assert.ok(answered < 1_000, `the panels were answered ${answered.toFixed(0)}ms after the profile loaded`)
  for (const [i, p] of panels.entries()) {
    if (i < 3) assert.deepEqual(p.messages("load"), [{ t: "load", modules: [{ name: "bench-panel", instruments: [`PFD_${i}|side=${i}`] }] }])
    else assert.deepEqual(p.messages("none"), [{ t: "none" }])
  }

  const told = panels[5]!
  await sleep(4_500)
  assert.equal(told.opened.length, 1, "a panel told none connected again in the same session")
  // A session's end closes every panel's socket, those with modules among them (decision 011).
  await (await app(core)).ok("session.leave")
  await panels[0]!.until(() => panels.every((p) => p.client.state === "closed"), "every panel's socket closing at the session's end")
  await host(core, "Host")
  await told.until(() => told.opened.length === 2, "the panel told none connecting in the next session")
  for (const p of panels) assert.deepEqual(p.overBudget(), [])
})

test("a panel module's messages reach its feature and come back, and a reloaded panel gets its modules on its new socket while the core closes the old", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-panel-reload", t)
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const core = await announcing(run, "a", net)
  await host(core, "Host")
  const first = panel(core, "VCockpit60", ["PFD_0|side=0"])
  t.after(() => first.close())
  await first.until(() => first.client.connected, "the panel connecting")
  core.clients({ act: "profile", loaded: true, picks: ["PFD"] })
  await first.until(() => first.messages("load").length === 1, "the panel's load")
  first.client.sendUnit("bench-panel", { n: 1 })
  await first.until(() => first.messages("unit").length === 1, "the module's echo")
  assert.deepEqual(first.messages("unit"), [{ t: "unit", unit: "bench-panel", body: { n: 1 } }])

  // The panel reloads: a new page names the same panel, and the old page's socket stays
  // open, as a reloaded page's did (record/areas/interface/log.md, 2026-10-08).
  const reloaded = panel(core, "VCockpit60", ["PFD_0|side=0"])
  t.after(() => reloaded.close())
  await reloaded.until(() => reloaded.messages("load").length === 1, "the reloaded panel's load")
  await first.until(() => first.client.state === "closed", "the core closing the old socket")
  assert.match(core.log(), /a cockpit panel's new socket replaced its old one/)
})

test("a slice 20 panels watch reaches each under 30 messages a second, though it changes 100 times a second, and each round takes under 1ms on the loop", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-panel-rate", t)
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const core = await announcing(run, "a", net)
  await host(core, "Host")
  const panels = Array.from({ length: 20 }, (_, i) => panel(core, `VCockpit${i + 60}`, [`GAUGE_${i}`]))
  t.after(() => panels.forEach((p) => p.close()))
  await panels[0]!.until(() => panels.every((p) => p.client.connected), "every panel connecting")
  for (const p of panels) p.client.watch("bench", () => {})
  core.clients({ act: "churn", per_second: 100, for_ms: 5_000 })
  await sleep(1_000)
  const from = panels.map((p) => p.received.length)
  await sleep(3_000)
  const rate = Math.max(...panels.map((p, i) => (p.received.length - from[i]!) / 3))
  console.log(`budget: at most ${rate.toFixed(1)} messages a second to one panel, against 30`)
  assert.ok(rate < 30, `${rate} messages a second reached a panel`)

  // The loop's stats for the whole run, which the core logs as it exits, give its slowest
  // input, every round of client state among them (record/areas/core/01-loop-and-edge.md,
  // "Logging").
  core.send({ kind: "exit" })
  assert.equal(await core.exited, 0)
  core.checkHandlers("a run with 20 panels in rounds")
})

test("no cockpit panel within 10s of the profile loading raises the clients crate's trouble notice, cleared once one connects", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-no-panel", t)
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const core = await announcing(run, "a", net)
  const efb = new FakePage(core, { component: "efb" })
  t.after(() => efb.close())
  efb.client.watch("notices", () => {})
  await efb.until(() => efb.slice("notices") !== undefined, "the notices")
  await host(core, "Host")
  core.clients({ act: "profile", loaded: true, picks: ["PFD"] })
  const ids = () => ((efb.slice("notices") ?? []) as { id: string }[]).map((n) => n.id)
  await sleep(9_000)
  assert.deepEqual(ids(), [], "the notice came before 10s")
  await efb.until(() => ids().includes("clients.no-panel"), "the trouble notice", 3_000)
  const p = panel(core, "VCockpit60", ["CLOCK"])
  t.after(() => p.close())
  await efb.until(() => !ids().includes("clients.no-panel"), "the notice clearing")
})

test("a module from another build while a test routine is fed raises the sim service's trouble notice for our package", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("clients-package-notice", t)
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const core = await announcing(run, "a", net)
  await core.hear("module Running")
  const efb = new FakePage(core, { component: "efb" })
  t.after(() => efb.close())
  efb.client.watch("notices", () => {})
  const ids = () => ((efb.slice("notices") ?? []) as { id: string }[]).map((n) => n.id)
  core.act({ act: "module-from", slots_hash: "1" })
  await core.hear("module Differs")
  await sleep(500)
  assert.deepEqual(ids(), [], "no routine is fed yet, so no notice")
  core.call({ call: "feed", routine: "PROBE", mode: 3 })
  await efb.until(() => ids().includes("sim-service.package"), "the package's trouble notice")
  core.call({ call: "end", routine: "PROBE" })
  await efb.until(() => !ids().includes("sim-service.package"), "the notice clearing once no routine is fed")
})
