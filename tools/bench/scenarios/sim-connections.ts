// Each unit's own connection to the sim: the platform's takes its masking group as soon as
// SimConnect_Open returns S_OK, before the sim's open reply; a connection the sim loses opens
// again with its setup made again; a message for a connection that's gone is dropped; a
// variable the sim rejects leaves the watch's other values arriving; and a call with no sim
// fails at once (record/areas/architecture/02-code-map.md, "Cases for the bench";
// record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench" and "What a
// feature calls").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core, type StandInReport } from "../cores.ts"

const ALTITUDE: [string, string] = ["A:IS ALTITUDE FREEZE ON", "bool"]
const ATTITUDE: [string, string] = ["A:IS ATTITUDE FREEZE ON", "bool"]

/** Waits until the stand-in's report shows what `done` looks for. */
async function until(core: Core, done: (report: StandInReport) => boolean, ms = 10_000): Promise<StandInReport> {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(50)) {
    const report = await core.report()
    if (done(report)) return report
  }
  throw new Error(`the stand-in's report never showed what the scenario waited for:\n${JSON.stringify(await core.report(), null, 2)}`)
}

/** The calls made on one connection, by function and arguments. */
function on(report: StandInReport, unit: number, open: number): string[] {
  return report.calls.filter((c) => c.unit === unit && c.open === open).map((c) => c.arguments)
}

test("a call with no sim fails at once", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-no-sim", t)
  const core = await run.core("a")
  core.call({ call: "key", event: "K:FREEZE_ALTITUDE_SET", value: 1 })
  await core.hear("a call failed")
})

test("several Frame events in one read each reach the loop as an input of its own", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-frame-burst", t)
  const core = await run.core("a")
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  // With the sim's own frames stopped, only the burst's reach the unit.
  core.act({ act: "frames", per_second: 0 })
  core.call({ call: "frames" })
  await until(core, (r) => r.calls.some((c) => c.function === "SubscribeToSystemEvent" && /"Frame"/.test(c.arguments)))
  await sleep(200)
  const after = core.heard().length
  core.act({ act: "frame-burst", count: 5 })
  for (let seen = 0; seen < 5; ) {
    await core.hear("frame", { after: after + seen })
    seen = core.heard().slice(after).filter((line) => line === "frame").length
  }
  assert.equal(core.heard().slice(after).filter((line) => line === "frame").length, 5, "five Frame events in one read bring five inputs")
})

test("an AI create whose title the sim lacks has its exception reach the call, and a create it can fill reaches the call too", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-create", t)
  const core = await run.core("a")
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  core.act({ act: "lack", title: "DUALINPUT_FIGURE_PILOT" })
  core.call({ call: "create", title: "DUALINPUT_FIGURE_PILOT" })
  await core.hear(/^exception \d+ for create 0$/)
  core.call({ call: "create", title: "A title the sim has" })
  await core.hear(/^created object \d+ for create Some\(1\)$/)
  const report = await core.report()
  assert.deepEqual(report.objects.map((o) => o.title), ["A title the sim has"], "only the create the sim could fill made an object")
})

test("the platform's connection takes its masking group before the sim's open reply", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-mask", t)
  const core = await run.core("a")
  // The sim sent its open reply 46s after S_OK as it booted (record/areas/architecture/01-spine.md, "The core").
  core.act({ act: "open-reply", delay_ms: 60_000 })
  core.act({ act: "watch", process: run.stub().id })
  const report = await until(core, (r) => r.calls.some((c) => c.function === "SetNotificationGroupPriority"))
  const group = report.calls.filter((c) => /NotificationGroup|MapClientEventToSimEvent/.test(c.function))
  assert.ok(group.length >= 3, "the group maps K:SIM_RATE_INCR, adds it, and takes its priority")
  assert.ok(
    group.every((c) => c.before_open_reply),
    "every call of the masking group went out before the open reply",
  )
  assert.match(group.find((c) => c.function === "SetNotificationGroupPriority")!.arguments, /priority: 10000000\b/)
})

test("a lost connection opens again with its setup made again, and the gone one's messages are dropped", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("sim-lost", t)
  const core = await run.core("a")
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  core.call({ call: "watch", vars: [ALTITUDE], once: false })
  await core.hear("values of watch Some(0): 0=0")
  const first = await until(core, (r) => r.calls.some((c) => c.function === "RequestDataOnSimObject"))
  const unit = first.calls.find((c) => c.function === "RequestDataOnSimObject")!.unit
  const platform = first.calls.find((c) => c.function === "SubscribeToSystemEvent")!.unit
  assert.notEqual(unit, platform, "the test unit's watch is on a connection of its own")

  // The test unit's connection: the loss reaches it, and its watch is made again at once.
  let heard = core.heard().length
  core.act({ act: "lose", unit: "bench-sim" })
  await core.hear("lost", { after: heard })
  await core.hear("values of watch Some(0): 0=0", { after: heard })
  let report = await until(core, (r) => on(r, unit, 2).length > 0)
  assert.deepEqual(on(report, unit, 2), on(report, unit, 1), "the new connection made the same setup")

  // The platform's: no stage moves, and it opens again with its subscriptions.
  heard = core.heard().length
  core.act({ act: "lose", unit: "sim-service" })
  report = await until(core, (r) => on(r, platform, 2).some((call) => call.startsWith("SubscribeToSystemEvent")))
  const setup = (open: number) => on(report, platform, open).filter((call) => !call.startsWith("RequestSystemState"))
  assert.deepEqual(setup(2), setup(1), "the platform's new connection made the same setup")

  // A message the stand-in sends on the test unit's lost connection reaches no unit.
  core.act({ act: "stale", unit: "bench-sim" })
  await sleep(500)
  const after = core.heard().slice(heard)
  assert.deepEqual(after.filter((what) => !what.startsWith("module ")), [], "a gone connection's message reached a unit, or a stage moved")
})

test("a variable the sim rejects leaves the watch's other values arriving", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-rejected", t)
  const core = await run.core("a")
  core.act({ act: "reject", name: "A:NO SUCH VARIABLE" })
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  core.call({ call: "watch", vars: [ALTITUDE, ["A:NO SUCH VARIABLE", "number"], ATTITUDE], once: false })
  await core.hear(/^exception \d+ for watch Some\(0\)$/)
  await core.hear("values of watch Some(0): 0=0 2=0")
})
