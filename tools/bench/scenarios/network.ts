// Two cores through the bench's local relay and its proxy, and its backend on a local D1:
// joining, a lost link and its return, a restarted core, and the connections a core refuses
// (record/areas/network/02-units.md, "Cases for the bench").

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import type { NetSlice } from "../../../src/engines/messages/ts/net/NetSlice.ts"
import type { SessionSlice } from "../../../src/engines/messages/ts/session/SessionSlice.ts"
import { budget } from "../budgets.ts"
import { BenchRun } from "../cores.ts"
import { app, BenchNetwork, EARLIEST_LOST_MS, host, join, report, session, took } from "../network.ts"
import { FakeApp } from "../pages.ts"

/** The members the session's slice lists, by name, this pilot first. */
function names(desktop: FakeApp): string[] {
  return desktop.slice<SessionSlice>("session")?.members.map((m) => m.name) ?? []
}

test("two cores join through the backend, link through a relay, lose the link, and link again", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-link", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())

  const { joinMs } = await session(a, [b])
  await a.hear(/^net up \S+ again=false restart=0$/)
  // Each first message carried its sender's keys, its member entry among them.
  for (const core of [a, b]) {
    const desktop = await app(core)
    await desktop.until(() => names(desktop).join(",") === (core === a ? "Host,Joiner 1" : "Joiner 1,Host"), "both members, by name")
  }
  t.diagnostic(`from the code entered to the link up through the relay: ${joinMs.toFixed(0)}ms`)

  const [aBefore, bBefore] = [a.heard().length, b.heard().length]
  const cut = performance.now()
  await net.relays[0]!.cut(0, 10_000)
  await a.hear(/^net lost /, { after: aBefore, ms: 10_000 })
  await b.hear(/^net lost /, { after: bBefore, ms: 10_000 })
  const lostMs = performance.now() - cut
  assert.ok(lostMs >= EARLIEST_LOST_MS, `the link was lost ${lostMs.toFixed(0)}ms into the cut, too soon for 5s of silence`)
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
  // The network crate's tests hold that no MemberOut follows, which needs 30 minutes.
  t.diagnostic(`the restarted core linked ${upMs.toFixed(0)}ms after it started; the other core said: ${a.heard().slice(before).join("; ")}`)
})

test("a joiner whose first dials fail redials every 2s and links once the proxy lets it through", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-first-dials", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  const code = await host(a, "Host")
  await net.relays[0]!.cut(b.process.pid!, 8_000)
  const started = performance.now()
  await join(b, code, "Joiner")
  await b.hear(/^net up \S+ again=false restart=0$/, { ms: 30_000 })
  const ms = performance.now() - started
  t.diagnostic(`linked ${ms.toFixed(0)}ms after the join, through an 8s cut`)
  assert.ok(ms >= 8_000, `linked ${ms.toFixed(0)}ms after the join, inside the cut`)
})

// The session crate always sends a first message, so a connection that sends none is the
// network crate's own test, a_connection_whose_first_message_passes_links_and_hands_on_what_waited_behind_it.
test("a connection with another session's code closes with its code, and each core's log says so", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  const run = new BenchRun("network-refusals", t)
  t.after(() => net.stop())
  const a = await run.core("a", net.core())
  const b = await run.core("b", net.core())
  await session(a, [b])

  // A core that comes back with a session file naming another code dials the crew under it,
  // as one whose session file held a code that has since gone to another session would.
  await b.kill()
  const file = path.join(b.data, "session.json")
  const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { code: string }
  fs.writeFileSync(file, JSON.stringify({ ...saved, code: "ZZZZZZ" }, null, 2))
  const before = a.heard().length
  const wrong = await run.core("b", net.core())
  // Each core checks the other's first message, so either or both can refuse, and a core that
  // hasn't read the other's yet hears the refusal from the close.
  const refusal = /the network refused a connection conn=\d+ code=10|another core refused this core's connection conn=\d+ why=Code/
  for (const core of [a, wrong]) {
    for (const started = Date.now(); !refusal.test(core.log()); await sleep(50)) {
      assert.ok(Date.now() - started < 20_000, "each core's log should say the connection was refused")
    }
  }
  assert.ok(!a.heard().slice(before).some((l) => l.startsWith("net up")), "the host should never link a connection under another code")
  assert.equal((await app(a)).slice<SessionSlice>("session")?.held, true, "a refusal should leave a running session alone")
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
  budget(joinMs < 3_000, `the join took ${joinMs.toFixed(0)}ms`)
  await sleep(3_000)
  assert.match(b.log(), /a connection's path changed conn=\d+ path=Direct/, "the link should move to a direct path")
  // The crew rows show each link's path and round trip from this slice.
  const watching = await FakeApp.open(b, ["network"])
  t.after(() => watching.close())
  await watching.until(() => watching.slice<NetSlice>("network")?.members.some((m) => m.path === "Direct" && m.round_trip_ms !== null) === true, "the link's path and round trip in the network's slice", 3_000)
})