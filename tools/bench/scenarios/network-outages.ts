// Outages between two cores through the bench's relay: a core suspended for 60s, the proxy
// cutting both cores for 30s, 60s, and 120s, and the relay down for 40s, each with the time
// from the outage's end to the link up again, which has no bound until this first run sets one
// (record/areas/network/02-units.md, "Cases for the bench"). The 10s cut runs in network.ts.

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"
import { BenchNetwork, session } from "../network.ts"
import { resume, suspend } from "../suspend.ts"

/** Waits for both cores to lose the link and get it back, and returns the ms from `ended` to the later link up. */
async function lostAndBack(a: Core, b: Core, after: [number, number], ended: () => number): Promise<{ lostMs: number; backMs: number }> {
  const started = performance.now()
  await a.hear(/^net lost /, { after: after[0], ms: 10_000 })
  await b.hear(/^net lost /, { after: after[1], ms: 10_000 })
  const lostMs = performance.now() - started
  await a.hear(/^net up \S+ again=true restart=0$/, { after: after[0], ms: 180_000 })
  await b.hear(/^net up \S+ again=true restart=0$/, { after: after[1], ms: 180_000 })
  return { lostMs, backMs: performance.now() - ended() }
}

test("the link is lost after 5s of each outage, and comes back after it", { timeout: 600_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-outages", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  await session(a, [b])
  await a.hear(/^net up \S+ again=false restart=0$/)
  const relay = net.relays[0]!
  const at = (): [number, number] => [a.heard().length, b.heard().length]
  const replays = (core: Core): number => core.log().split("\n").filter((l) => l.includes("another member's replay of what this machine missed begins")).length
  // Both cores redial every 2s through an outage, so a dial still running when the link comes
  // back connects too, moves the link, and raises `LinkUp` again, and each `LinkUp` starts a replay
  // about 90ms later. The next outage waits for them, or it would cut a replay off, and hear a
  // late `LinkUp` as the link's return from itself.
  const settle = (): Promise<void> => sleep(3_000)

  for (const seconds of [30, 60, 120]) {
    const after = at()
    const cut = performance.now()
    await relay.cut(0, seconds * 1_000)
    const { lostMs, backMs } = await lostAndBack(a, b, after, () => cut + seconds * 1_000)
    t.diagnostic(`a ${seconds}s cut: lost after ${lostMs.toFixed(0)}ms, up again ${backMs.toFixed(0)}ms after it ended`)
    assert.ok(lostMs >= 4_500 && lostMs <= 6_500, `lost ${lostMs.toFixed(0)}ms into the cut`)
    await settle()
  }

  {
    const after = at()
    const down = performance.now()
    await relay.down(true)
    const back = sleep(40_000).then(() => relay.down(false))
    let upAt = 0
    void back.then(() => (upAt = performance.now()))
    const { lostMs, backMs } = await lostAndBack(a, b, after, () => upAt || down + 40_000)
    await back
    t.diagnostic(`the relay down for 40s: lost after ${lostMs.toFixed(0)}ms, up again ${backMs.toFixed(0)}ms after it came back`)
    await settle()
  }

  {
    const after = at()
    suspend(b.process.pid!)
    await a.hear(/^net lost /, { after: after[0], ms: 10_000 })
    await sleep(55_000)
    resume(b.process.pid!)
    const resumed = performance.now()
    await a.hear(/^net up \S+ again=true restart=0$/, { after: after[0], ms: 60_000 })
    await b.hear(/^net up \S+ again=true restart=0$/, { after: after[1], ms: 60_000 })
    t.diagnostic(`a core suspended for 60s: up again ${(performance.now() - resumed).toFixed(0)}ms after it resumed`)
    // On a link up again, the cockpit stream on each side replays what the other lacks
    // (record/areas/sync/05-units.md, "Kept messages and a replay").
    for (const [core, other] of [[a, b], [b, a]] as const) {
      const ups = other.heard().filter((l) => /^net up \S+ again=true/.test(l)).length
      for (const started = Date.now(); replays(core) < ups && Date.now() - started < 5_000; ) await sleep(100)
      assert.ok(ups >= 5, `${other.data} should have its link up again after each of 5 outages`)
      assert.equal(replays(core), ups, `${core.data}'s cockpit stream should get a replay at each of the other's links up again`)
    }
  }
})
