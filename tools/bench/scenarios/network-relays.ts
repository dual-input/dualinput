// Two relays, with the two cores homed at different ones, and a core's home relay cut from it
// mid-session (record/areas/network/02-units.md, "Cases for the bench"). Each endpoint homes at
// the relay that answers it fastest, so the proxy's delay picks each core's home.

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"
import { BenchNetwork, report, session } from "../network.ts"

/** The relays the core's log says its endpoint homed at, in order. */
function homes(core: Core): string[] {
  return [...core.log().matchAll(/the endpoint's home relay is (\S+)/g)].map((m) => m[1]!)
}

test("with the cores homed at different relays, both directions cross the dialed core's home relay", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start(2)
  const run = new BenchRun("network-relays", t)
  t.after(() => net.stop())
  const [one, two] = net.relays as [(typeof net.relays)[0], (typeof net.relays)[0]]
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  // The host homes at the first relay, and the joiner at the second.
  await two.delay(a.process.pid!, 80)
  await one.delay(b.process.pid!, 80)
  await session(a, [b])
  await sleep(3_000)
  t.diagnostic(`homes: the host ${homes(a).join(" then ")}, the joiner ${homes(b).join(" then ")}`)

  const before = [await one.rates(), await two.rates()]
  a.net({ act: "send", delivery: "newest", count: 200, every_ms: 20, bytes: 500 })
  b.net({ act: "send", delivery: "newest", count: 200, every_ms: 20, bytes: 500 })
  await sleep(5_000)
  const after = [await one.rates(), await two.rates()]
  const sent = (relay: number, core: Core) =>
    (after[relay]![String(core.process.pid)]?.[0] ?? 0) - (before[relay]![String(core.process.pid)]?.[0] ?? 0)
  t.diagnostic(
    `bytes into each relay over 5s: the host ${sent(0, a)} and ${sent(1, a)}, the joiner ${sent(0, b)} and ${sent(1, b)}`,
  )
  assert.ok((await report(a)).probes["1002"]?.count, "the host should get the joiner's probes")
  assert.ok((await report(b)).probes["1002"]?.count, "the joiner should get the host's probes")

  // The host's home relay cut from it for 60s: whether the link stays up or comes back by a
  // redial, and how long, which nothing has measured.
  const marks = [a.heard().length, b.heard().length]
  const cut = performance.now()
  await one.cut(a.process.pid!, 60_000)
  await sleep(62_000)
  const lost = a.heard().slice(marks[0]).some((l) => l.startsWith("net lost"))
  if (lost) await a.hear(/^net up \S+ again=true restart=0$/, { after: marks[0], ms: 120_000 })
  t.diagnostic(
    `the host's home relay cut for 60s: the link ${lost ? `was lost, and up again ${(performance.now() - cut - 60_000).toFixed(0)}ms after the cut ended` : "stayed up"}; homes then: ${homes(a).join(" then ")}`,
  )
})
