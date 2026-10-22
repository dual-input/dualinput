// Two cores through the bench's local relay and its proxy, and its backend on a local D1:
// joining, a lost link and its return, a restarted core, and the connections a core refuses
// (record/areas/network/02-units.md, "Cases for the bench").

import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { BenchRun } from "../cores.ts"
import { BenchNetwork, report, session, took } from "../network.ts"

test("two cores join through the backend, link through a relay, lose the link, and link again", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-link", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())

  const { joinMs } = await session(a, [b])
  await a.hear(/^net up \S+ again=false restart=0$/)
  await a.hear("net keys Joiner 1")
  await b.hear("net keys Host")
  t.diagnostic(`from the code entered to the link up through the relay: ${joinMs.toFixed(0)}ms`)

  const [aBefore, bBefore] = [a.heard().length, b.heard().length]
  const cut = performance.now()
  await net.relays[0]!.cut(0, 10_000)
  await a.hear(/^net lost /, { after: aBefore, ms: 10_000 })
  await b.hear(/^net lost /, { after: bBefore, ms: 10_000 })
  const lostMs = performance.now() - cut
  assert.ok(lostMs >= 4_500, `the link was lost ${lostMs.toFixed(0)}ms into the cut, before its 5s`)
  // Both redial every 2s once the cut ends. A dial still running when the link comes back
  // connects too, and the link's rule moves both sides onto the same one of them, raising
  // `LinkUp` again with each move.
  await a.hear(/^net up \S+ again=true restart=0$/, { after: aBefore, ms: 60_000 })
  await b.hear(/^net up \S+ again=true restart=0$/, { after: bBefore, ms: 60_000 })
  t.diagnostic(`a 10s cut: the link lost after ${lostMs.toFixed(0)}ms, and up again ${(performance.now() - cut - 10_000).toFixed(0)}ms after the cut ended`)

  // Data both ways on the connection each kept, once the dials still running have landed,
  // since a move closes the connection it leaves, and what went out on it may be lost. Then
  // 12s of heartbeats, enough for 8 clock exchanges.
  await sleep(3_000)
  a.net({ act: "send", delivery: "stream", count: 20, every_ms: 50, bytes: 100 })
  b.net({ act: "send", delivery: "newest", count: 20, every_ms: 50, bytes: 100 })
  await sleep(12_000)
  const [ra, rb] = [await report(a), await report(b)]
  assert.equal(rb.probes["1001"]?.count, 20, "every stream probe should arrive")
  assert.ok((ra.probes["1002"]?.count ?? 0) >= 18, "nearly every one-off probe should arrive")
  const ups = [a, b].map((c, i) => c.heard().slice([aBefore, bBefore][i]).filter((l) => l.startsWith("net up")).length)
  t.diagnostic(`LinkUp after the cut: ${ups[0]} on the host, ${ups[1]} on the joiner`)
  // Both cores read one PC's counter, so each one's offset from the other is about 0.
  const offsets = [...Object.values(ra.offsets), ...Object.values(rb.offsets)]
  t.diagnostic(`clock offsets: ${offsets.join(", ")}µs`)
  for (const offset of offsets) assert.ok(offset !== null && Math.abs(offset) <= 1_000, `an offset of ${offset}µs`)
})

test("a core killed and started again links under a higher restart count, with no member counted out", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-restart", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  await session(a, [b])
  await a.hear(/^net up \S+ again=false restart=0$/)

  const before = a.heard().length
  await b.kill()
  // The restarted core opens from its session file as it handles its first input, before the
  // bench connects to it, so the other core's `LinkUp` is what shows it.
  const restarted = await run.core("b", net.core())
  const upMs = await took(a, /^net up \S+ again=false restart=1$/, before, 30_000)
  await restarted.hear(/^net up \S+ again=false restart=0$/, { ms: 30_000 })
  const since = a.heard().slice(before)
  t.diagnostic(`the restarted core linked ${upMs.toFixed(0)}ms after it started; the other core said: ${since.join("; ")}`)
  assert.ok(!since.some((l) => l.startsWith("net out")), "no member should be counted out")
})

test("a joiner whose first dials fail redials every 2s and links once the proxy lets it through", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-first-dials", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  a.net({ act: "host", name: "Host" })
  const code = (await a.hear(/^net host code /, { ms: 15_000 })).split(" ").at(-1)!
  await net.relays[0]!.cut(b.process.pid!, 8_000)
  const started = performance.now()
  b.net({ act: "join", code, name: "Joiner", open_as: null })
  await b.hear(/^net up \S+ again=false restart=0$/, { ms: 30_000 })
  const ms = performance.now() - started
  t.diagnostic(`linked ${ms.toFixed(0)}ms after the join, through an 8s cut`)
  assert.ok(ms >= 8_000, `linked ${ms.toFixed(0)}ms after the join, inside the cut`)
})

test("a connection with another code closes with its code, and one with no first message never links", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-refusals", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  const c = await run.core("c", net.core())
  a.net({ act: "host", name: "Host" })
  const code = (await a.hear(/^net host code /, { ms: 15_000 })).split(" ").at(-1)!

  c.net({ act: "join", code, name: "Wrong", open_as: "ZZZZZZ" })
  await c.hear(/^net join found 1$/)
  await sleep(6_000)
  assert.match(a.log(), /the network refused a connection conn=\d+ code=10/, "the host should refuse the other code with code 10")
  assert.match(c.log(), /the network refused a connection conn=\d+ code=10|code=Ok\(10\)/, "the refused core should see code 10")

  // The silent core takes the host's first message, so its own link comes up, hears nothing
  // for 5s, and redials, closing each connection before the host's 10s; the network's own
  // tests hold a connection silent for the 10s.
  b.net({ act: "first", send: false })
  b.net({ act: "join", code, name: "Silent", open_as: null })
  await b.hear(/^net join found 1$/)
  await sleep(14_000)
  assert.ok(!a.heard().some((l) => l.startsWith("net up")), "a connection with no first message should never link")
  t.diagnostic("the host refused the other code with code 10, and never linked the silent core")
})
test("a join on a direct path links within 3s of the code entered", { timeout: 60_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-direct", t)
  t.after(() => net.stop())
  // Two cores on one PC link directly once they may, and a dial still starts through the relay.
  const direct = { settings: { ...net.core().settings, "network.relays-only": false } }
  const a = await run.core("a", direct)
  const b = await run.core("b", direct)
  const { joinMs } = await session(a, [b])
  t.diagnostic(`from the code entered to the link up: ${joinMs.toFixed(0)}ms`)
  assert.ok(joinMs < 3_000, `the join took ${joinMs.toFixed(0)}ms`)
})