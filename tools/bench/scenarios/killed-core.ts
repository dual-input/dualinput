// The core is killed, its recording reads up to its last flush, and it loses at most the
// recording's last second (record/areas/core/01-loop-and-edge.md, "Cases for the bench" and
// "Budgets"). The recording's writer flushes once a second, so a kill loses only what it
// hadn't flushed.

import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun } from "../cores.ts"

/**
 * The writer flushes on a timer that can wake a scheduler tick late, 15.6ms at
 * Windows' default, and a line takes a little while to reach the loop.
 */
const SLACK_MS = 100

test("a killed core's recording replays to its last flush, losing at most its last second", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("killed-core", t)
  const core = await run.core("a")
  // Lines go out for about 4s, so the kill lands between two of the writer's flushes.
  const sent: number[] = []
  for (let n = 1; n <= 300; n++) {
    core.send({ kind: "count", n })
    sent.push(performance.now())
    await sleep(10)
  }
  const killed = performance.now()
  await core.kill()

  const [recording, ...others] = core.recordings()
  assert.ok(recording, "the core should have recorded its run")
  assert.equal(others.length, 0)
  const replayed = run.replay(recording, "debug")
  // The test unit logs each line's number as it handles one, and the lines reach the loop
  // in the order they were sent, so the recording holds lines 1 to the highest it logged.
  const counted = [...fs.readFileSync(replayed.log, "utf8").matchAll(/a line from the bench reached the loop n=(\d+)/g)].map((m) => Number(m[1]))
  const reached = counted.length
  assert.deepEqual(counted, Array.from({ length: reached }, (_, i) => i + 1), "the lines should reach the loop in order")
  const firstLost = sent[reached]
  const lostMs = firstLost === undefined ? 0 : killed - firstLost
  t.diagnostic(
    `${reached} of ${sent.length} lines reached the recording, which lost the last ${lostMs.toFixed(0)}ms before the kill${replayed.cut ? " and stopped after its last flush" : ""}`,
  )
  assert.ok(lostMs <= 1_000 + SLACK_MS, `the recording lost the last ${lostMs.toFixed(0)}ms of lines`)
})
