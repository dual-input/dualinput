// The apps' wiring over the core's real WebSocket, with the bench's fake EFB app and banner:
// the banner's slice, a notification clicked outside its action, and the EFB app's button
// that starts the desktop app's program, as record/areas/interface/01-apps.md's cases for the
// bench have them.

import assert from "node:assert/strict"
import { test } from "node:test"

import { announcing, BenchRun } from "../cores.ts"
import { StandInDesktopApp } from "../desktop-app.ts"
import { FakeApp, FakeBanner, FakeEfbApp, type FakePage } from "../pages.ts"

/** Waits until each of `pages` has connected to the core. */
async function connected(...pages: FakePage[]): Promise<void> {
  for (const page of pages) await page.until(() => page.client.connected, "the page connecting")
}

test("the banner's slice says whether a banner page's socket is open", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("apps-banner", t)
  const core = await announcing(run, "a")
  const efb = new FakeEfbApp(core)
  t.after(() => efb.close())
  await efb.until(() => efb.slice("banner") === false, "the banner's slice saying no banner's socket is open")
  const banner = new FakeBanner(core)
  t.after(() => banner.close())
  await efb.until(() => efb.bannerOpen(), "the banner's socket opening")
  banner.close()
  await efb.until(() => !efb.bannerOpen(), "the banner's socket closing")
})

test("a notification clicked outside its action reaches the EFB app as the order that opens the EFB", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("apps-notification-click", t)
  const core = await announcing(run, "a")
  const efb = new FakeEfbApp(core)
  const banner = new FakeBanner(core)
  t.after(() => {
    efb.close()
    banner.close()
  })
  await connected(efb, banner)
  core.clients({ act: "notify", id: "look", text: "Something for the bench to look at" })
  await banner.until(() => banner.notifications().some((n) => n.id === "bench-clients.look"), "the banner showing the notification")
  await banner.click("bench-clients.look")
  await efb.until(() => efb.orders.length > 0, "the EFB app's order")
  assert.deepEqual(efb.orders, [{ t: "open-efb" }])
  assert.deepEqual(banner.messages("unit"), [], "only the EFB app gets the order")
  assert.match(core.log(), /a notification was clicked outside its action, so the EFB app opens the EFB onto our app/)
})

test("the EFB app's button starts the desktop app's program, whether or not a desktop app is connected", { timeout: 30_000 }, async (t) => {
  const run = new BenchRun("apps-desktop-forward", t)
  const desktopApp = new StandInDesktopApp(run, "a")
  const core = await announcing(run, "a", desktopApp.coreOptions())
  const efb = new FakeEfbApp(core)
  t.after(() => efb.close())
  await connected(efb)
  await efb.bringDesktopForward()
  await desktopApp.until(1)
  // A bench core runs on a data folder of its own, so it passes the folder on, and that
  // folder's desktop app opens rather than the pilot's.
  assert.deepEqual(desktopApp.starts(), [["--data", core.data]])
  // The desktop app's `hello` and the EFB app's press come in on two sockets, so the press
  // waits until the core has sent the desktop app a slice it watches, which it does only
  // after reading its `hello`.
  const app = await FakeApp.open(core, ["settings"])
  t.after(() => app.close())
  await app.until(() => app.slice("settings") !== undefined, "the core reading the desktop app's hello")
  await efb.bringDesktopForward()
  await desktopApp.until(2)
  assert.deepEqual(desktopApp.starts()[1], ["--data", core.data])
  assert.ok(!app.received().some((m) => m.t === "unit"), "the desktop app gets no message, since its program's running copy opens its window")
  assert.match(core.log(), /a client asked for the desktop app.*desktop_apps=1|desktop_apps=1.*a client asked for the desktop app/)
})
