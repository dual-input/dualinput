// The client protocol over the core's real WebSocket: a page that heard the core's
// announcement connects, a browser page is turned away, and the core answers what a page
// sends, as record/areas/core/02-clients-and-panel-bridge.md's cases for the bench have it.

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { HASH, VERSION } from "../../../src/engines/messages/ts/stamp.ts"
import { announcing, BenchRun, OFFLINE_SETTINGS } from "../cores.ts"
import { FakePage, RawSocket } from "../pages.ts"

const hello = (component: string, version = VERSION) => JSON.stringify({ t: "hello", component, version, hash: HASH })

test("a fake page that heard the stand-in's announcement connects, and the core answers its commands", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("clients-connect", t)
  const core = await announcing(run, "a")
  const page = new FakePage(core, { component: "efb-app" })
  t.after(() => page.close())
  await page.until(() => page.client.connected, "the page connecting")
  assert.match(core.log(), /a client joined.*component="efb-app"|component="efb-app".*a client joined/)
  await assert.rejects(page.client.command("nobody.knows", null), /unknown/)
  // The case from the loop's design: a command's handler reads the clients crate's settings
  // while the clients crate dispatches it, here a setting changed from the page's socket.
  await assert.rejects(page.client.command("bench.read-setting", null), /isn't set/)
  await page.client.command("clients.set-setting", { key: "bench.flag", value: true })
  await page.client.command("bench.read-setting", null)
  // A command whose arguments don't read answers with an error.
  await assert.rejects(page.client.command("clients.set-setting", { key: "bench.flag" }), /arguments didn't read/)
  assert.deepEqual(page.overBudget(), [])
})

test("a socket from a browser page closes with 1008, and nothing it sent reaches the loop", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("clients-origin", t)
  const core = await announcing(run, "a")
  const browser = new RawSocket(core.port(), "https://example.com")
  t.after(() => browser.close())
  await browser.until(() => browser.closed !== null, "the browser's socket closing")
  assert.equal(browser.closed!.code, 1008)
  const desktop = new RawSocket(core.port(), null)
  t.after(() => desktop.close())
  await desktop.open()
  desktop.send(hello("desktop"))
  await sleep(300)
  const log = core.log()
  assert.match(log, /a WebSocket from a page outside the sim was closed/)
  assert.equal((log.match(/a client joined/g) ?? []).length, 1, "only the desktop app's socket, which sends no Origin, joined")
})

test("a client of another version is logged with both versions and still served, and a message that doesn't parse is dropped", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("clients-versions", t)
  const core = await announcing(run, "a")
  const old = new RawSocket(core.port())
  t.after(() => old.close())
  await old.open()
  old.send(hello("efb-app", "0.0.1"))
  old.send("{ this isn't JSON")
  old.send(JSON.stringify({ t: "command", id: 1, name: "nobody.knows", args: null }))
  await old.until(() => old.received.some((m) => m.t === "answer"), "the command's answer")
  assert.deepEqual(old.received.find((m) => m.t === "answer"), { t: "answer", id: 1, error: "unknown" })
  const log = core.log()
  assert.match(log, /a client's version differs from the core's/)
  assert.match(log, /client_version="0\.0\.1"/)
  assert.match(log, /a client's message didn't read, so it was dropped/)
})

test("a settings file keeps a key no unit registered through the core's write of it", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("clients-settings", t)
  const core = await announcing(run, "a", { settings: { "gone.feature": 3, "bench.flag": false } })
  const page = new FakePage(core, { component: "desktop" })
  t.after(() => page.close())
  await page.until(() => page.client.connected, "the page connecting")
  await page.client.command("clients.set-setting", { key: "bench.flag", value: true })
  const file = path.join(core.data, "settings.json")
  await page.until(() => JSON.parse(fs.readFileSync(file, "utf8"))["bench.flag"] === true, "the settings file's write")
  // The bench gives every core its servers, so no core fetches from the internet.
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ...OFFLINE_SETTINGS, "gone.feature": 3, "bench.flag": true })
})

test("a slice that changes 100 times a second reaches a page at most once a round", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("clients-rounds", t)
  const core = await announcing(run, "a")
  const page = new FakePage(core, { component: "efb-app" })
  t.after(() => page.close())
  page.client.watch("bench", () => {})
  await page.until(() => page.slice("bench") !== undefined, "the slice's first value")
  const before = page.received.length
  core.clients({ act: "churn", per_second: 100, for_ms: 2_000 })
  await sleep(2_500)
  const sent = page.received.slice(before).filter((r) => r.message.t === "state" && r.message.slice === "bench").length
  const counter = (page.slice("bench") as { counter: number }).counter
  // A round every 50ms, so 2s of changes reach the page in about 40 messages, not 200.
  assert.ok(counter >= 190, `the slice changed ${counter} times`)
  assert.ok(sent <= 45, `the page got ${sent} messages for 2s of changes`)
  assert.ok(sent >= 20, `the page got only ${sent} messages`)
})
