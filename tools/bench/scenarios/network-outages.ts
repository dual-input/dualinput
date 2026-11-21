// Outages between two cores through the bench's relay: a core suspended for 60s, the proxy
// cutting both cores for 30s, 60s, and 120s, and the relay down for 40s, each with the time
// from the outage's end to the link up again, recorded with no bound
// (record/areas/network/02-units.md, "Cases for the bench"). The 10s cut runs in network.ts.

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"
import { BenchNetwork, EARLIEST_LOST_MS, session } from "../network.ts"
import { resume, suspend } from "../suspend.ts"

/** Waits for both cores to lose the link and get it back, and returns the ms from `began` to the later loss, and from `ended` to the later link up. */
async function lostAndBack(a: Core, b: Core, after: [number, number], began: number, ended: () => number): Promise<{ lostMs: number; backMs: number }> {
  await a.hear(/^net lost /, { after: after[0], ms: 10_000 })
  await b.hear(/^net lost /, { after: after[1], ms: 10_000 })
  const lostMs = performance.now() - began
  await a.hear(/^net up \S+ again=true restart=0$/, { after: after[0], ms: 180_000 })
  await b.hear(/^net up \S+ again=true restart=0$/, { after: after[1], ms: 180_000 })
  return { lostMs, backMs: performance.now() - ended() }
}

test("the link is lost 4s to 5s into each outage, and comes back after it", { timeout: 600_000 }, async (t) => {
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
  // back connects too, moves the link, and raises `LinkUp` again, and each `LinkUp` sends a replay.
  // The next outage waits for them, or it would cut a replay off, and hear a late `LinkUp` as the
  // link's return from itself.
  const settle = (): Promise<void> => sleep(3_000)

  for (const seconds of [30, 60, 120]) {
    const after = at()
    const cut = performance.now()
    await relay.cut(0, seconds * 1_000)
    const { lostMs, backMs } = await lostAndBack(a, b, after, cut, () => cut + seconds * 1_000)
    t.diagnostic(`a ${seconds}s cut: lost after ${lostMs.toFixed(0)}ms, up again ${backMs.toFixed(0)}ms after it ended`)
    assert.ok(lostMs >= EARLIEST_LOST_MS && lostMs <= 6_500, `lost ${lostMs.toFixed(0)}ms into the cut`)
    await settle()
  }

  {
    const after = at()
    const down = performance.now()
    await relay.down(true)
    const back = sleep(40_000).then(() => relay.down(false))
    let upAt = 0
    void back.then(() => (upAt = performance.now()))
    const { lostMs, backMs } = await lostAndBack(a, b, after, down, () => upAt || down + 40_000)
    await back
    t.diagnostic(`the relay down for 40s: lost after ${lostMs.toFixed(0)}ms, up again ${backMs.toFixed(0)}ms after it came back`)
    await settle()
  }

  {
    const after = at()
    await suspend(b.process.pid!)
    await a.hear(/^net lost /, { after: after[0], ms: 10_000 })
    await sleep(55_000)
    await resume(b.process.pid!)
    const resumed = performance.now()
    await a.hear(/^net up \S+ again=true restart=0$/, { after: after[0], ms: 60_000 })
    await b.hear(/^net up \S+ again=true restart=0$/, { after: after[1], ms: 60_000 })
    t.diagnostic(`a core suspended for 60s: up again ${(performance.now() - resumed).toFixed(0)}ms after it resumed`)
    // On a link up again, the cockpit stream on each side replays what the other lacks
    // (record/areas/sync/05-units.md, "Kept messages and a replay"). A link that moves raises
    // `LinkUp` again, and a replay sent on the connection it left can be lost, so the count to
    // hold is a replay for each outage, not one for each `LinkUp`.
    const outages = 5
    for (const [core, other] of [[a, b], [b, a]] as const) {
      const ups = other.heard().filter((l) => /^net up \S+ again=true/.test(l)).length
      for (const started = Date.now(); replays(core) < outages && Date.now() - started < 5_000; ) await sleep(100)
      assert.ok(ups >= outages, `${other.data} should have its link up again after each of ${outages} outages`)
      assert.ok(replays(core) >= outages, `${core.data}'s cockpit stream should get a replay after each of ${outages} outages, and got ${replays(core)}`)
    }
  }
})
