// Our WASM module, as the stand-in runs it natively: its status, a module from another build,
// a routine's life between feedings, and the core unfreezing the aircraft once the module
// stops with a routine live in Flying, unpaused, and not otherwise
// (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench";
// record/areas/architecture/02-code-map.md, "Cases for the bench, for work in the sim").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"

const FREEZES = ["IS LATITUDE LONGITUDE FREEZE ON", "IS ALTITUDE FREEZE ON", "IS ATTITUDE FREEZE ON"]
const RTC_END = 11

/** Whether the stand-in's aircraft has all three freezes on, or all three off. */
async function frozen(core: Core): Promise<boolean | "partly"> {
  const variables = new Map((await core.report()).variables)
  const on = FREEZES.map((name) => variables.get(name) === "1")
  return on.every(Boolean) ? true : on.some(Boolean) ? "partly" : false
}

async function untilFrozen(core: Core, want: boolean, ms = 5_000): Promise<number> {
  const started = performance.now()
  while (performance.now() - started < ms) {
    if ((await frozen(core)) === want) return performance.now() - started
    await sleep(25)
  }
  throw new Error(`the aircraft didn't ${want ? "freeze" : "unfreeze"} within ${ms}ms`)
}

/** A core whose sim is found, its module running, and the sim in Flying, unless `flying` is false. */
async function started(run: BenchRun, name: string, { flying = true } = {}): Promise<Core> {
  const core = await run.core(name)
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  await core.hear("module Running")
  if (flying) {
    core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "flow", event: RTC_END } }] })
    await core.hear("stage Flying aircraft none")
  }
  return core
}

test("a module from another build runs none of the core's feeds, and the core reports it differs", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-module-differs", t)
  const core = await started(run, "a")
  core.act({ act: "module-from", slots_hash: "1" })
  await core.hear("module Differs")
  core.call({ call: "feed", routine: "PROBE", mode: 3 })
  await sleep(500)
  assert.equal(await frozen(core), false, "the module ran a feed from another build")
})

test("the sim's exit ends every routine, and the next run of the sim starts none and reads Missing until its module writes", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-module-next-run", t)
  const core = await run.core("a")
  const first = run.stub()
  core.act({ act: "watch", process: first.id })
  await core.hear("module Running")
  core.call({ call: "feed", routine: "HOLD", mode: 0 })
  await untilFrozen(core, true)
  const heard = core.heard().length
  await first.kill()
  await core.hear("module Missing", { after: heard })
  // The stand-in's module outlives the stub, so its host drops the unfed Hold, and lifts
  // the freeze, 1s after the core's last write.
  await untilFrozen(core, false)
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none", { after: heard })
  await core.hear("module Running", { after: heard })
  await sleep(1_500)
  assert.equal(await frozen(core), false, "the next run of the sim got the last run's Hold")
})

test("a routine fed again after its end starts with nothing from its last feeding", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-module-feeds", t)
  const core = await started(run, "a")
  // Without an end between them, the second feed reaches the same routine, which asks for
  // the freeze while it remembers the first feed's mark.
  core.call({ call: "feed", routine: "PROBE", mode: 1 })
  core.call({ call: "feed", routine: "PROBE", mode: 2 })
  await untilFrozen(core, true)
  core.call({ call: "end", routine: "PROBE" })
  await untilFrozen(core, false)
  core.call({ call: "feed", routine: "PROBE", mode: 1 })
  core.call({ call: "end", routine: "PROBE" })
  core.call({ call: "feed", routine: "PROBE", mode: 2 })
  await sleep(500)
  assert.equal(await frozen(core), false, "the routine remembered its last feeding's mark")
})

test("a module stopped by a routine's panic, with a routine live in Flying, has the core unfreeze the aircraft", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-module-stopped", t)
  const core = await started(run, "a")
  core.call({ call: "feed", routine: "HOLD", mode: 0 })
  await untilFrozen(core, true)
  const heard = core.heard().length
  core.call({ call: "feed", routine: "PROBE", mode: 4 })
  while (!(await core.report()).module_stopped) await sleep(25)
  const unfrozen = await untilFrozen(core, false, 6_000)
  await core.hear("module Stopped", { after: heard })
  t.diagnostic(`the aircraft unfroze ${unfrozen.toFixed(0)}ms after the module stopped`)
  // The counter ticks once a second, so its last tick came up to 1s before the stop, and the
  // core takes 3s of stillness from that tick, checks every 200ms, then reads the freeze
  // flags before it turns them off.
  assert.ok(unfrozen <= 3_500, `the core unfroze the aircraft ${unfrozen.toFixed(0)}ms after the module stopped`)
})

for (const [why, arrange] of [
  [
    "while Loading",
    async (core: Core) => core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "flight-loaded", path: "x.FLT" } }] }),
  ],
  ["while paused", async (core: Core) => core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: 4 } }] })],
] as const) {
  test(`a module that stops ${why} leaves the aircraft frozen`, { timeout: 30_000 }, async (t) => {
    const run = new BenchRun(`sim-module-${why.replace(" ", "-")}`, t)
    const core = await started(run, "a")
    core.call({ call: "feed", routine: "HOLD", mode: 0 })
    await untilFrozen(core, true)
    await arrange(core)
    await sleep(200)
    core.act({ act: "stop-module" })
    await sleep(4_500)
    assert.equal(await frozen(core), true)
  })
}

test("a module that stops with no routine live leaves the aircraft frozen", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-module-no-routine", t)
  const core = await started(run, "a")
  for (const event of ["K:FREEZE_LATITUDE_LONGITUDE_SET", "K:FREEZE_ALTITUDE_SET", "K:FREEZE_ATTITUDE_SET"]) {
    core.call({ call: "key", event, value: 1 })
  }
  await untilFrozen(core, true)
  core.act({ act: "stop-module" })
  await sleep(4_500)
  assert.equal(await frozen(core), true)
})

test("a stopped module's 3s count only from the end of a pause", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("sim-module-after-pause", t)
  const core = await started(run, "a")
  core.call({ call: "feed", routine: "HOLD", mode: 0 })
  await untilFrozen(core, true)
  core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: 4 } }] })
  await sleep(200)
  core.act({ act: "stop-module" })
  await sleep(4_000)
  core.act({ act: "play", signals: [{ after_ms: 0, signal: { signal: "pause", flags: 0 } }] })
  await sleep(2_000)
  assert.equal(await frozen(core), true, "the core unfroze the aircraft under 3s after the pause ended")
  const unfrozen = await untilFrozen(core, false, 3_000)
  t.diagnostic(`the aircraft unfroze ${(2_000 + unfrozen).toFixed(0)}ms after the pause ended`)
})
