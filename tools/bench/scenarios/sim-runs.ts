// A run of the sim ends as a close when its quit message comes before its process exits, and
// as a crash when the process exits with none, and between the quit message and the exit
// the core opens nothing (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the
// bench"). Two bench cores on one PC each see only their own stub, and killing one stub
// ends that core's sim alone (record/areas/build/02-testing.md, "Cases for the bench").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun } from "../cores.ts"

/** The sim service tries again every 2s, and a check waits out one try with room to spare. */
const RETRY_MS = 2_500

test("the quit message then the exit is a close, nothing opens between them, and an exit alone is a crash", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("sim-runs", t)
  const core = await run.core("a")
  const sim = run.stub()
  core.act({ act: "watch", process: sim.id })
  await core.hear("stage Starting aircraft none")
  // The platform's connection subscribes as it opens.
  while (!(await core.report()).calls.some((c) => c.function === "SubscribeToSystemEvent")) await sleep(50)

  let heard = core.heard().length
  core.act({ act: "quit" })
  await core.hear("stage Closed aircraft none", { after: heard })
  await core.hear("ended Some(Close)", { after: heard })
  const opens = (await core.report()).opens.length
  await sleep(RETRY_MS)
  assert.equal((await core.report()).opens.length, opens, "the core opened a connection after the quit message")

  heard = core.heard().length
  await sim.kill()
  await sleep(500)
  const after = core.heard().slice(heard).filter((what) => /^(stage|ended) /.test(what))
  assert.deepEqual(after, [], "the exit after the quit message changed the stage or the ending")

  const next = run.stub()
  core.act({ act: "watch", process: next.id })
  await core.hear("stage Starting aircraft none", { after: heard })
  heard = core.heard().length
  await next.kill()
  await core.hear("stage Closed aircraft none", { after: heard })
  await core.hear("ended Some(Crash { code: 1 })", { after: heard })
})

test("two bench cores each see only their own stub, and killing one ends that core's sim alone", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("sim-stubs", t)
  const [a, b] = [await run.core("a"), await run.core("b")]
  const [simA, simB] = [run.stub(), run.stub()]
  a.act({ act: "watch", process: simA.id })
  b.act({ act: "watch", process: simB.id })
  await a.hear("stage Starting aircraft none")
  await b.hear("stage Starting aircraft none")
  const heardB = b.heard().length
  await simA.kill()
  await a.hear("ended Some(Crash { code: 1 })")
  await sleep(500)
  const sims = b.heard().slice(heardB).filter((what) => /^(stage|ended) /.test(what))
  assert.deepEqual(sims, [], "core b's sim changed with core a's")
})
