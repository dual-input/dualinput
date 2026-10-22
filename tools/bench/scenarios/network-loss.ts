// Every delivery through the bench's relay with bytes held back, standing in for loss on the
// sender's link, a held-back pair beside two that aren't, and the busiest mix, whose rate
// through the relay sets the relay's cap (record/areas/network/02-units.md, "Cases for the
// bench" and "Budgets").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun, type Core } from "../cores.ts"
import { BenchNetwork, cpuMs, report, session } from "../network.ts"

/** p06's busiest mix, about 121 one-off packets and 20 cockpit changes a second, for `seconds`. */
function busiest(core: Core, seconds: number): void {
  core.net({ act: "send", delivery: "newest", count: 71 * seconds, every_ms: 14, bytes: 200 })
  core.net({ act: "send", delivery: "deadline", count: 50 * seconds, every_ms: 20, bytes: 110 })
  core.net({ act: "send", delivery: "stream", count: 20 * seconds, every_ms: 50, bytes: 150 })
}

const ms = (us: number | undefined) => ((us ?? 0) / 1_000).toFixed(1)

test("at 1% and 3% held back, the streams' p99 lateness stays within 17ms of the one-off packets'", { timeout: 300_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-loss", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  await session(a, [b])
  await report(b)
  const relay = net.relays[0]!
  const pid = a.process.pid!

  // p06's round trips to the relay through Frankfurt and New York, with a held packet held
  // for a round trip and a quarter.
  for (const rtt of [22, 84]) {
    for (const rate of [0.01, 0.03]) {
      await relay.delay(pid, rtt / 2)
      await relay.loss(pid, rate, Math.round(rtt * 1.25))
      busiest(a, 20)
      await sleep(22_000)
      const got = (await report(b)).probes
      const [stream, newest, deadline] = [got["1001"], got["1002"], got["1003"]]
      t.diagnostic(
        `${rtt}ms away at ${rate * 100}%: p99 stream ${ms(stream?.p99_us)}ms, newest ${ms(newest?.p99_us)}ms, deadline ${ms(deadline?.p99_us)}ms; ` +
          `${stream?.count ?? 0}, ${newest?.count ?? 0}, and ${deadline?.count ?? 0} came, ${newest?.behind ?? 0} newest behind a newer one`,
      )
      assert.equal(newest?.behind ?? 0, 0, "no newest probe should come after a newer one")
      const gap = Math.abs((stream?.p99_us ?? 0) - (newest?.p99_us ?? 0)) / 1_000
      assert.ok(gap <= 17, `the stream's p99 sat ${gap.toFixed(1)}ms from the one-off packets'`)
    }
  }
})

test("holding one core's relay connection back leaves the other pair's messages on time", { timeout: 180_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-held-pair", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  const c = await run.core("c", net.core())
  await session(a, [b, c])
  await sleep(2_000)
  await Promise.all([report(b), report(c)])
  const relay = net.relays[0]!
  await relay.delay(c.process.pid!, 42)
  await relay.loss(c.process.pid!, 0.03, 105)
  busiest(a, 15)
  await sleep(17_000)
  const [onTime, held] = [(await report(b)).probes, (await report(c)).probes]
  t.diagnostic(`p99 to the core not held back: newest ${ms(onTime["1002"]?.p99_us)}ms, stream ${ms(onTime["1001"]?.p99_us)}ms; to the held one: newest ${ms(held["1002"]?.p99_us)}ms`)
  assert.ok((onTime["1002"]?.p99_us ?? Infinity) < 50_000, "the pair not held back should get its one-off packets within 50ms")
  // The proxy found the held core's connection by its process, so the hold reached it.
  assert.ok(String(c.process.pid) in (await relay.rates()), "the relay should know the held core's process")
  assert.ok((held["1002"]?.p99_us ?? 0) > 100_000, "the held core's one-off packets should come late")
})

test("v1's busiest mix through the relay: its peak rate, the cores' CPU, and the loop's minute", { timeout: 240_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-busiest", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  const { joinMs } = await session(a, [b])
  const relay = net.relays[0]!
  const before = [cpuMs(a.process.pid!), cpuMs(b.process.pid!)]
  const started = performance.now()
  busiest(a, 65)
  await sleep(66_000)
  const wall = performance.now() - started
  const after = [cpuMs(a.process.pid!), cpuMs(b.process.pid!)]
  const rates = await relay.rates()
  const sending = rates[String(a.process.pid)] ?? [0, 0]
  const percent = (i: number) => (((after[i]! - before[i]!) / wall) * 100).toFixed(2)
  const got = (await report(b)).probes
  t.diagnostic(`join through the relay ${joinMs.toFixed(0)}ms; the sender's peak through the relay ${sending[1]} bytes in a second, ${(sending[0] / 65).toFixed(0)} a second on average`)
  t.diagnostic(`CPU of one core over the mix: the sender ${percent(0)}%, the receiver ${percent(1)}%`)
  t.diagnostic(`received: ${got["1002"]?.count} newest, ${got["1003"]?.count} deadline, ${got["1001"]?.count} stream; p99 ${ms(got["1002"]?.p99_us)}ms, ${ms(got["1003"]?.p99_us)}ms, ${ms(got["1001"]?.p99_us)}ms`)
  // The loop's stats for a minute window of the receiver, which took about 140 inputs a second,
  // once it exits, which writes its log whole.
  b.send({ kind: "exit" })
  await b.exited
  // The first whole minute's line, as src/apps/core/src/loop_stats.rs writes it.
  const minute = b
    .log()
    .split(/\r?\n/)
    .find((l) => l.includes("the loop's stats") && l.includes('window="minute" seconds=60'))
  t.diagnostic(`the receiver's loop: ${minute ?? "no minute's stats"}`)
  assert.ok(sending[1] < 262144, `the sender's peak, ${sending[1]} bytes in a second, passed the cap`)
})
