// The core helper on the bench: a bench core starts the stand-in core helper over the real
// pipe, through the development setting that names the helper's program, and the core helper's
// test unit stands in for the features that want things of it
// (record/areas/core/04-core-helper.md, "The helper's life", "Cases for the bench", and
// "Budgets"; record/areas/build/02-testing.md, "The stand-in core helper").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { type TestContext, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { Bound } from "../../../src/engines/messages/ts/core_helper/Bound.ts"
import { ROOT } from "../../lib/repo.ts"
import { BenchRun, type Core } from "../cores.ts"
import { type HelperRun, StandInHelper } from "../helper.ts"
import { FakePage } from "../pages.ts"

const KEY_A: Bound = { input: { key: { scan: 30, extended: false } }, name: "A" }
const KEY_B: Bound = { input: { key: { scan: 48, extended: false } }, name: "B" }
const TONE_BYTES = fs.statSync(path.join(ROOT, "src", "apps", "core", "src", "bench", "tone.opus")).size

async function started(run: BenchRun, name: string, settings: Record<string, unknown> = {}): Promise<{ core: Core; helper: StandInHelper }> {
  const helper = await StandInHelper.start()
  const core = await run.core(name, helper.coreOptions(settings))
  return { core, helper }
}

/** Whether `run` was last sent wants binding exactly `bound`'s input. */
function binds(run: HelperRun | undefined, bound: Bound | null): boolean {
  const wants = run?.wants().at(-1)
  if (!wants) return false
  return JSON.stringify(wants.bindings.map(([, input]) => input)) === JSON.stringify(bound ? [bound.input] : [])
}

test("the helper runs only while a want is on, gets the sound and then the wants after its hello, and exits once nothing is wanted", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-life", t)
  const { core, helper } = await started(run, "a", { "bench.input": KEY_A })
  t.after(() => helper.close())
  await sleep(1_000)
  assert.equal(helper.runs.length, 0, "no want is on, so no helper runs")

  core.helper({ act: "binding", on: true })
  await helper.until(() => binds(helper.latest, KEY_A), "wants binding A")
  const lines = helper.latest!.lines.map((l) => l.line)
  assert.deepEqual(lines.slice(0, 3), ["started", "sound", "wants"])
  assert.deepEqual(helper.latest!.lines[1], { line: "sound", sound: 3, bytes: TONE_BYTES })

  core.helper({ act: "binding", on: false })
  await helper.until(() => helper.latest!.closed !== undefined, "its exit")
  assert.equal(helper.latest!.lines.at(-1)?.line, "closed", "the core closed its standard input")
  assert.match(core.log(), /nothing is wanted of the core helper, so it stops/)
})

test("a press reaches the feature, and a helper killed while a want is on runs again within 3s with the binding sent as before", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-killed", t)
  const { core, helper } = await started(run, "a", { "bench.input": KEY_A })
  t.after(() => helper.close())
  core.helper({ act: "binding", on: true })
  await helper.until(() => binds(helper.latest, KEY_A), "wants binding A")
  helper.latest!.act({ act: "press", binding: 0, down: true })
  helper.latest!.act({ act: "press", binding: 0, down: false })
  await core.hear(/^press down \d+us after its stamp$/)
  await core.hear(/^press up \d+us after its stamp$/)

  const killed = performance.now()
  process.kill(helper.latest!.process!)
  await helper.until(() => helper.runs.length === 2 && binds(helper.latest, KEY_A), "a second run with binding A")
  const again = performance.now() - killed
  console.log(`budget: the helper ran again with every want sent ${again.toFixed(0)}ms after it was killed, against 3,000ms`)
  assert.ok(again < 3_000, `the helper ran again ${again.toFixed(0)}ms after it was killed`)
  assert.match(core.log(), /the core helper exited while something was wanted of it/)
})

test("the core killed, the helper exits within 1s", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-core-killed", t)
  const { core, helper } = await started(run, "a", { "bench.input": KEY_A })
  t.after(() => helper.close())
  core.helper({ act: "binding", on: true })
  await helper.until(() => binds(helper.latest, KEY_A), "wants binding A")
  const killed = performance.now()
  await core.kill()
  await helper.until(() => helper.latest!.closed !== undefined, "its exit")
  const exited = helper.latest!.closed! - killed
  console.log(`budget: the helper exited ${exited.toFixed(0)}ms after the core was killed, against 1,000ms`)
  assert.ok(exited < 1_000, `the helper exited ${exited.toFixed(0)}ms after the core was killed`)
  assert.equal(helper.latest!.lines.at(-1)?.line, "closed", "its standard input closed with the core")
})

test("a helper of another build is logged, killed, and started again, and the trouble notice shows 5s after it went down", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-other-build", t)
  const { core, helper } = await started(run, "a", { "bench.input": KEY_A })
  t.after(() => helper.close())
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const efb = new FakePage(core, { component: "efb" })
  t.after(() => efb.close())
  efb.client.watch("notices", () => {})
  await efb.until(() => efb.slice("notices") !== undefined, "the notices")
  const ids = () => ((efb.slice("notices") ?? []) as { id: string }[]).map((n) => n.id)

  helper.helloAs = { version: "0.0.0" }
  core.helper({ act: "binding", on: true })
  await helper.until(() => helper.runs.length === 1, "its first run")
  const first = helper.latest!.connected
  await efb.until(() => ids().includes("core-helper.down"), "the trouble notice", 10_000)
  const shown = performance.now() - first
  assert.ok(shown > 4_500 && shown < 7_000, `the trouble notice showed ${shown.toFixed(0)}ms after the helper went down`)
  assert.ok(helper.runs.length >= 2, "the core started it again")
  assert.match(core.log(), /a core helper of another build said hello, so the core killed it/)

  helper.helloAs = {}
  await efb.until(() => !ids().includes("core-helper.down"), "the notice clearing at a matching hello", 10_000)
  assert.ok(binds(helper.latest, KEY_A))
})

test("the next press turns itself off once it comes, and a setting changed whose key a binding names sends the wants again", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-binding", t)
  const { core, helper } = await started(run, "a")
  t.after(() => helper.close())
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const desktop = new FakePage(core, { component: "desktop" })
  t.after(() => desktop.close())
  await desktop.until(() => desktop.client.connected, "the desktop app's page connecting")

  // As the desktop app binds a key: the binding is on with nothing in its setting, and the
  // next press is on.
  core.helper({ act: "binding", on: true })
  core.helper({ act: "next-press", on: true })
  await helper.until(() => helper.latest?.wants().at(-1)?.next_press === true, "wants the next press")
  assert.ok(binds(helper.latest, null), "a binding with no input set binds nothing")
  helper.latest!.act({ act: "next-press", input: KEY_B.input, name: "B" })
  await core.hear("next press B")
  // The next press turned itself off, and the binding holds no input yet, so nothing is
  // wanted and the helper exits.
  await helper.until(() => helper.latest!.closed !== undefined, "its exit once the next press came")

  // As the desktop app writes what came back into the binding's setting.
  await desktop.client.command("clients.set-setting", { key: "bench.input", value: KEY_B })
  await helper.until(() => helper.runs.length === 2 && binds(helper.latest, KEY_B), "a run that binds B")
})

test("a sound plays while the helper runs, and a play while it's stopped is dropped", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-sounds", t)
  const { core, helper } = await started(run, "a")
  t.after(() => helper.close())
  core.helper({ act: "sounds", on: true })
  await helper.until(() => helper.latest?.wants().at(-1)?.sounds === true, "wants sounds")
  core.helper({ act: "play" })
  await helper.until(() => helper.latest!.lines.some((l) => l.line === "play"), "the play")
  core.helper({ act: "sounds", on: false })
  await helper.until(() => helper.latest!.closed !== undefined, "its exit")
  core.helper({ act: "play" })
  await sleep(500)
  assert.match(core.log(), /a sound wasn't played, since the core helper isn't running/)
})

/** A core with the stand-in, announcing so a fake page joins it, and a page that watches the notices and the helper's slice. */
async function withPage(t: TestContext, scenario: string) {
  const run = new BenchRun(scenario, t)
  const { core, helper } = await started(run, "a")
  t.after(() => helper.close())
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const page = new FakePage(core, { component: "desktop" })
  t.after(() => page.close())
  page.client.watch("notices", () => {})
  page.client.watch("core-helper", () => {})
  await page.until(() => page.slice("notices") !== undefined, "the notices")
  const notices = () => (page.slice("notices") ?? []) as { id: string; text: string }[]
  return { core, helper, page, notices }
}

test("a want the helper can't carry out warns, naming the feature, until the want goes off, and the device list ends at its answer or its failure", { timeout: 60_000 }, async (t) => {
  const { core, helper, page, notices } = await withPage(t, "core-helper-failed")
  core.helper({ act: "mouse", on: true })
  await helper.until(() => helper.latest?.wants().at(-1)?.mouse === true, "wants the mouse")
  helper.latest!.act({ act: "failed", want: "Mouse", error: "Raw Input refused the mouse" })
  await page.until(() => notices().some((n) => n.id === "core-helper.failed.mouse"), "the mouse's warning")
  assert.match(notices().find((n) => n.id === "core-helper.failed.mouse")!.text, /bench-helper's mouse isn't working/)
  core.helper({ act: "mouse", on: false })
  await page.until(() => !notices().some((n) => n.id === "core-helper.failed.mouse"), "the warning clearing with the mouse off")
  await helper.until(() => helper.latest!.closed !== undefined, "its exit with nothing wanted")

  await page.client.command("core-helper.list", null)
  await helper.until(() => helper.runs.length === 2 && helper.latest!.wants().at(-1)?.lists === true, "a run that wants the lists")
  helper.latest!.act({ act: "lists", outputs: [{ id: "speakers", name: "Speakers" }], programs: ["BeyondATC"] })
  await page.until(() => JSON.stringify(page.slice("core-helper")).includes("BeyondATC"), "the lists in the slice")
  await helper.until(() => helper.latest!.closed !== undefined, "its exit once the lists came")

  await page.client.command("core-helper.list", null)
  await helper.until(() => helper.runs.length === 3 && helper.latest!.wants().at(-1)?.lists === true, "a third run that wants the lists")
  helper.latest!.act({ act: "failed", want: "Lists", error: "no devices" })
  await helper.until(() => helper.latest!.closed !== undefined, "its exit once the lists failed")
})

test("a capture's program and frames reach its feature, and a missing output device warns until the helper plays on it", { timeout: 60_000 }, async (t) => {
  const { core, helper, page, notices } = await withPage(t, "core-helper-capture")
  core.helper({ act: "capture", programs: ["BeyondATC"] })
  await helper.until(() => helper.latest?.wants().at(-1)?.captures.length === 1, "wants a capture")
  const capture = helper.latest!.wants().at(-1)!.captures[0]!
  helper.latest!.act({ act: "capturing", capture, program: "BeyondATC" })
  helper.latest!.act({ act: "frame", capture, bytes: 60 })
  await core.hear('capturing Some("BeyondATC")')
  await core.hear(/^captured 60 bytes 0{120}$/)

  core.helper({ act: "sounds", on: true })
  await page.client.command("clients.set-setting", { key: "core-helper.output", value: { id: "headset", name: "Headset" } })
  await helper.until(() => helper.latest!.wants().length >= 2, "the wants with the picked device")
  helper.latest!.act({ act: "in-use", output: { id: "speakers", name: "Speakers" } })
  await page.until(() => notices().some((n) => n.id === "core-helper.missing-output"), "the missing headset's warning")
  helper.latest!.act({ act: "in-use", output: { id: "headset-2", name: "Headset" } })
  await page.until(() => !notices().some((n) => n.id === "core-helper.missing-output"), "the warning clearing once it plays on a device of the headset's name")
})

test("a helper that won't start is tried again while a want is on, even after a want went on and off before the start failed", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-missing", t)
  const core = await run.core("a", { settings: { "core-helper.program": "no-such-helper.exe", "bench.input": KEY_A } })
  const failures = () => core.log().split("\n").filter((l) => l.includes("the core helper didn't start")).length
  // On and off in two lines in a row, both handled before the edge says the start failed.
  core.helper({ act: "binding", on: true })
  core.helper({ act: "binding", on: false })
  for (let waited = 0; failures() < 1 && waited < 5_000; waited += 50) await sleep(50)
  assert.equal(failures(), 1)
  core.helper({ act: "binding", on: true })
  for (let waited = 0; failures() < 2 && waited < 5_000; waited += 50) await sleep(50)
  assert.equal(failures(), 2, "the want on again tried to start the helper again")
})

test("the pipe carries 200 messages a second each way, each handled within the loop's 1ms", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("core-helper-pipe", t)
  const { core, helper } = await started(run, "a")
  t.after(() => helper.close())
  core.helper({ act: "mouse", on: true })
  core.helper({ act: "stream", on: true })
  await helper.until(() => {
    const wants = helper.latest?.wants().at(-1)
    return wants?.mouse === true && wants.streams.length === 1
  }, "wants the mouse and a stream")
  helper.latest!.act({ act: "moves", per_second: 200, for_ms: 3_000 })
  core.helper({ act: "frames", per_second: 200, bytes: 60, for_ms: 3_000 })
  await sleep(4_000)
  const moves = core.heard().filter((h) => h.startsWith("mouse Move")).length
  const frames = helper.latest!.lines.filter((l) => l.line === "frame").length
  console.log(`budget: ${moves} mouse moves reached the core and ${frames} frames reached the helper in 3s, each way against 200 a second`)
  assert.ok(moves >= 580, `${moves} mouse moves reached the core`)
  assert.ok(frames >= 580, `${frames} frames reached the helper`)

  // The loop's stats for the whole run, which the core logs as it exits
  // (record/areas/core/01-loop-and-edge.md, "Logging").
  core.send({ kind: "exit" })
  assert.equal(await core.exited, 0)
  core.checkHandlers("a run with 200 messages a second each way")
})
