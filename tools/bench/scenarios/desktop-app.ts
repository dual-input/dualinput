// The desktop app's jobs, on a stand-in install with a bench core as its dualinput-core.exe and
// a stub named FlightSimulator2024.exe as the sim's process: starting the core with the sim and
// again after a crash, writing our package, a second start, and update checks
// (record/areas/install/01-installing-and-updating.md, "Cases for the bench" and "Budgets").
// The app finds the sim by its program's name, so no sim and no other scenario may run beside
// these.

import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { VERSION } from "../../../src/engines/messages/ts/stamp.ts"
import { budget } from "../budgets.ts"
import { BenchRun } from "../cores.ts"
import { DesktopApp, DesktopBench, ended, figures, kill, running, writeFeed } from "../desktop.ts"
import { BenchNetwork, host, join } from "../network.ts"

/** The design's budgets for starting the core with the sim and again after a crash (record/areas/install/01-installing-and-updating.md, "Budgets"). */
const START_MS = 3_000
/** How long the app's walk for the sim can take to come round, every 2s, with room for the start. */
const WALK_MS = 2_500

test("the sim's start starts a core within 3s, and an app that starts while the sim runs starts one too", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("desktop-app-start", t)
  const bench = new DesktopBench(run)
  const app = await bench.app()
  await app.hear(/starts in the tray/)
  await sleep(WALK_MS)
  assert.doesNotMatch(app.log(), /started the core/, "no core starts with no sim and no session")

  const after = app.lines()
  const sim = bench.sim()
  const appeared = performance.now()
  const pid = await app.started({ after, ms: START_MS + 1_000 })
  const tookMs = performance.now() - appeared
  t.diagnostic(`the core started ${tookMs.toFixed(0)}ms after the sim's process appeared`)
  budget(tookMs < START_MS, `the core started ${tookMs.toFixed(0)}ms after the sim, over the budget's 3s`)
  // A bench core, on the app's own data folder, answers on its bench socket there.
  await run.attach(bench.data, pid)

  // The app goes, and the core with it, while the sim runs on; the next app starts a core at once.
  await app.kill()
  kill(pid)
  await until(() => !running(pid), "the killed core gone")
  // Both apps write one log, so the next one's line comes after the first's.
  const before = app.lines()
  const next = await bench.app()
  await run.attach(bench.data, await next.started({ after: before, ms: START_MS + 1_000 }))
  await ended(sim)
})

test("a core that crashes while the sim runs comes back within 3s as a bench core, and one that exits with 0 stays down until the sim starts again", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("desktop-app-crash", t)
  const bench = new DesktopBench(run)
  const sim = bench.sim()
  const app = await bench.app()
  const first = await app.started({ ms: START_MS + 1_000 })
  await run.attach(bench.data, first)

  let after = app.lines()
  kill(first)
  const crashed = performance.now()
  await app.hear(/the core exited with 0x1$/, { after })
  const again = await app.started({ after, ms: START_MS + 1_000 })
  const tookMs = performance.now() - crashed
  t.diagnostic(`the core started again ${tookMs.toFixed(0)}ms after the crash`)
  budget(tookMs < START_MS, `the core started again ${tookMs.toFixed(0)}ms after its crash, over the budget's 3s`)
  const core = await run.attach(bench.data, again)

  // An exit with 0 is the core's choice, as a quit is, so none starts while this sim runs.
  after = app.lines()
  core.send({ kind: "exit" })
  await app.hear(/the core exited with 0x0$/, { after })
  await sleep(WALK_MS + 2_000)
  assert.doesNotMatch(app.log().split(/\r?\n/).slice(after).join("\n"), /started the core/, "no core starts after an exit with 0 while the same sim runs")

  // The sim's next start wants a core again.
  await ended(sim)
  await sleep(WALK_MS)
  after = app.lines()
  bench.sim()
  await run.attach(bench.data, await app.started({ after, ms: START_MS + 1_000 }))
})

test("a sim that starts again as the core exits for the last one gets a core", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("desktop-app-next-run", t)
  const bench = new DesktopBench(run)
  const first = bench.sim()
  const app = await bench.app()
  const core = await run.attach(bench.data, await app.started({ ms: START_MS + 1_000 }))
  core.act({ act: "watch", process: first.pid! })
  await core.hear("stage Starting aircraft none")

  // The next run starts while the core still exits for the last, whichever the app sees first.
  const after = app.lines()
  await ended(first)
  bench.sim()
  await app.hear(/the core exited with 0x0$/, { after })
  await run.attach(bench.data, await app.started({ after, ms: WALK_MS + START_MS }))
})

test("a unit's panic in a session crashes the core, which the app starts again, comes back as a late joiner, and replays to the same input; with the sim closed, the session held brings a crashed core back too", { timeout: 120_000 }, async (t) => {
  const net = await BenchNetwork.start()
  t.after(() => net.stop())
  const run = new BenchRun("desktop-app-panic", t)
  const bench = new DesktopBench(run, { settings: net.core().settings })
  const sim = bench.sim()
  const app = await bench.app()
  const joiner = await run.attach(bench.data, await app.started({ ms: START_MS + 1_000 }))
  const hostCore = await run.core("host", net.core())
  const code = await host(hostCore, "Host")
  await join(joiner, code, "Joiner")
  await joiner.hear(/^net up \S+ again=false restart=0$/, { ms: 15_000 })

  let after = app.lines()
  joiner.send({ kind: "panic" })
  const crash = await app.hear(/the core exited with 0x[0-9a-f]+$/, { after })
  assert.doesNotMatch(crash, /0x0$/, "a panic exits with a code other than 0")
  const restarted = await run.attach(bench.data, await app.started({ after, ms: START_MS + 1_000 }))
  await until(() => /the core found a session file, so it comes back to the session code=\S+ restart=1/.test(restarted.log()), "the restarted core coming back to the session")
  // The core's log, since the link can come up before the bench connects to the new core, and the bench's socket keeps no
  // line from before then. Its restart count is the host's.
  await until(() => /a member's link is up conn=\S+ again=\S+ restart=0/.test(restarted.log()), "the restarted core's link to the host")
  const panicked = joiner.recordings().find((file) => /panic at input/.test(fs.readFileSync(path.join(path.dirname(file), "log.txt"), "utf8")))
  assert.ok(panicked, "the crashed run's recording should be there")
  const at = run.replayPanic(panicked)
  assert.equal(at.replay, at.run, "the replay panics at the input the run did")

  // The sim closes while the crew flies on, then the core crashes: the session file wants a core.
  await ended(sim)
  await sleep(WALK_MS)
  after = app.lines()
  await restarted.kill()
  await run.attach(bench.data, await app.started({ after, ms: START_MS + 1_000 }))
})

test("a second start hands its request to the running app and exits", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("desktop-app-second", t)
  const bench = new DesktopBench(run)
  const app = await bench.app()
  await app.hear(/starts in the tray/)
  const second = DesktopApp.start(path.join(bench.current, "dualinput-desktop.exe"), bench.data, app.port)
  assert.equal(await second.exited, 0)
  await app.hear(/handed Tray to the app already running, and exits/)
  assert.equal(app.process.exitCode, null, "the first app runs on")
})

test("our package goes into Community at the app's start and each time the sim closes, where it's missing or of another version, and never while the sim runs", { timeout: 60_000 }, async (t) => {
  const run = new BenchRun("desktop-app-package", t)
  const bench = new DesktopBench(run)
  const app = await bench.app()
  await app.hear(/wrote our package into/)
  assert.equal(bench.installed(), VERSION)
  assert.deepEqual(fs.readdirSync(bench.packages), ["Community"], "the copy's folder is gone")

  // Removed, then at another version: each comes back as the sim closes.
  for (const change of [() => fs.rmSync(path.join(bench.community, "dualinput"), { recursive: true }), () => fs.writeFileSync(path.join(bench.community, "dualinput", "manifest.json"), JSON.stringify({ package_version: "0.0.1" }))]) {
    change()
    const sim = bench.sim()
    await sleep(WALK_MS + 500)
    const after = app.lines()
    await ended(sim)
    await app.hear(/wrote our package into/, { after })
    assert.equal(bench.installed(), VERSION)
  }

  // An app that starts while the sim runs writes nothing until the sim closes, as after an
  // install with the sim running and a restart of the PC before it closed.
  await app.kill()
  fs.rmSync(path.join(bench.community, "dualinput"), { recursive: true })
  const sim = bench.sim()
  await sleep(WALK_MS)
  const next = await bench.app()
  await next.hear(/the sim started/)
  await sleep(WALK_MS)
  assert.equal(bench.installed(), null, "nothing is written while the sim runs")
  const after = next.lines()
  await ended(sim)
  await next.hear(/wrote our package into/, { after })
  assert.equal(bench.installed(), VERSION)
})

test("Check now goes through checking to up to date, and to failed with the error when the feed can't be reached; a release found while the sim runs waits for it to close, unless asked for", { timeout: 90_000 }, async (t) => {
  const run = new BenchRun("desktop-app-updates", t)
  // A feed that answers after 500ms, as one across the internet takes a moment, so the check's
  // state shows before its answer replaces it.
  const feed = await slowFeed(writeFeed(path.join(run.folder, "feed"), [VERSION]), 500)
  t.after(() => feed.close())
  const bench = new DesktopBench(run, { feed: feed.url })
  const app = await bench.app()
  const link = await app.link()
  // No rule names the bench's core, so the firewall reads as blocking it, which the EFB app's header shows.
  await link.until((s) => s.firewall === "blocks", "the firewall blocking the core")
  await link.until((s) => s.update.state === "current" && s.update.checked !== null, "up to date after the start's check")
  const asked = link.states.length
  link.ask({ t: "check-for-updates" })
  await link.until((s) => link.states.indexOf(s) >= asked && s.update.state === "checking", "checking after Check now")
  await link.until((s) => link.states.indexOf(s) > asked && s.update.state === "current", "up to date again")
  link.close()
  await app.kill()

  // A feed nothing answers on, as with the network cut.
  bench.settings({ "desktop.update-feed": "http://127.0.0.1:1/" })
  const offline = await bench.app()
  const cut = await offline.link()
  const failed = await cut.until((s) => s.update.state === "failed", "a failed check")
  assert.ok(failed.update.state === "failed" && failed.update.next === null && failed.update.error.length > 0, `a failed check names no version and says why: ${JSON.stringify(failed.update)}`)
  cut.close()
  await offline.kill()

  // A newer release, found while the sim runs: it waits, and Check now downloads it at once.
  // The feed lists it with no file behind it, so its download fails, which shows it started.
  bench.settings({ "desktop.update-feed": writeFeed(path.join(run.folder, "newer"), [VERSION, "99.0.0"]) })
  const sim = bench.sim()
  await sleep(WALK_MS)
  const flying = await bench.app()
  const newer = await flying.link()
  await newer.until((s) => s.update.state === "available" && s.update.next === "99.0.0", "99.0.0 available while the sim runs")
  await sleep(1_000)
  assert.ok(!newer.states.some((s) => s.update.state === "downloading"), "no download starts while the sim runs")
  newer.ask({ t: "check-for-updates" })
  await newer.until((s) => s.update.state === "failed" && s.update.next === "99.0.0", "the download asked for, failing on the missing file")
  newer.close()
  await flying.kill()

  // With the sim closing, the found release downloads by itself.
  const waiting = await bench.app()
  const closing = await waiting.link()
  await closing.until((s) => s.update.state === "available", "99.0.0 available while the sim runs")
  await ended(sim)
  await closing.until((s) => s.update.state === "failed" && s.update.next === "99.0.0", "the download once the sim closed")
  closing.close()
})

test("the app with no window and the sim closed takes under 5 MB and 0.2% of one CPU core", { timeout: 120_000 }, async (t) => {
  const run = new BenchRun("desktop-app-budget", t)
  const bench = new DesktopBench(run)
  const app = await bench.app()
  await app.hear(/wrote our package into/)
  // The start's check, firewall read, and package write settle first.
  await sleep(15_000)
  const pid = app.process.pid!
  const before = figures(pid)
  await sleep(60_000)
  const after = figures(pid)
  const share = (after.cpuMs - before.cpuMs) / 60_000
  t.diagnostic(`the app held ${(after.memory / 1e6).toFixed(2)} MB and used ${(share * 100).toFixed(3)}% of one CPU core over 60s`)
  budget(after.memory < 5e6, `the app held ${(after.memory / 1e6).toFixed(2)} MB, over 5 MB`)
  budget(share < 0.002, `the app used ${(share * 100).toFixed(3)}% of one CPU core, over 0.2%`)
})

/** Serves the feed in `folder` over HTTP, answering each request after `delayMs`. */
async function slowFeed(folder: string, delayMs: number): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    // Velopack asks for releases.<channel>.json with its own query after it.
    const name = path.basename(new URL(request.url ?? "/", "http://feed").pathname)
    const file = path.join(folder, name)
    setTimeout(() => {
      if (!fs.existsSync(file)) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { "content-type": "application/json" }).end(fs.readFileSync(file))
    }, delayMs)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

/** Waits until `ok` holds, checking every 25ms for 10s. */
async function until(ok: () => boolean, what: string): Promise<void> {
  for (let waited = 0; !ok(); waited += 25) {
    if (waited > 10_000) throw new Error(`${what} didn't happen within 10s`)
    await sleep(25)
  }
}
