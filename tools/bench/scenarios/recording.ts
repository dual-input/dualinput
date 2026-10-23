// The recording crate's runs over the core's real WebSocket: the slice lists the runs with
// the newest in progress, a page's command deletes an older run and is refused the one in
// progress, and marking the moment writes a line to the run's log, as
// record/areas/recording/01-recording-and-bug-reports.md's note of 2026-10-23 has it.

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import type { RecordingSlice } from "../../../src/engines/messages/ts/recording/RecordingSlice.ts"
import type { Run } from "../../../src/engines/messages/ts/recording/Run.ts"
import { BenchRun } from "../cores.ts"
import { FakePage } from "../pages.ts"

test("a page deletes an older run, is refused the one in progress, and marks the moment", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("recording-runs", t)
  const old = path.join(run.folder, "a", "recordings", "2026-01-01_00-00-00")
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, "log.txt"), "an old run's log\n")
  const core = await run.core("a")
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")

  const page = new FakePage(core, { component: "desktop" })
  t.after(() => page.close())
  page.client.watch("recording", () => {})
  const runs = () => (page.slice("recording") as RecordingSlice | undefined)?.runs ?? []
  await page.until(() => runs().length === 2, "the slice listing both runs")
  const [older, current] = runs() as [Run, Run]
  assert.deepEqual(older, { name: "2026-01-01_00-00-00", size: 17, in_progress: false })
  assert.equal(current.in_progress, true)

  await assert.rejects(page.client.command("recording.delete", { name: current.name }), /in progress/)
  await assert.rejects(page.client.command("recording.delete", { name: "..\\settings.json" }), /no run named/)
  await page.client.command("recording.delete", { name: older.name })
  await page.until(() => runs().length === 1, "the slice without the deleted run")
  assert.equal(runs()[0]?.name, current.name)
  assert.equal(fs.existsSync(old), false, "the deleted run's folder is gone")

  await page.client.command("recording.mark", null)
  await page.until(() => /the pilot marked the moment/.test(core.log()), "the mark in the run's log")
})
