// The apps' wiring over the core's real WebSocket, with the bench's fake EFB app and banner:
// the banner's slice, and a notification clicked outside its action, as
// record/areas/interface/01-apps.md's cases for the bench have them.

import assert from "node:assert/strict"
import { test } from "node:test"

import { announcing, BenchRun } from "../cores.ts"
import { FakeBanner, FakeEfbApp, type FakePage } from "../pages.ts"

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
  await banner.click(banner.notifications().find((n) => n.id === "bench-clients.look")!)
  await efb.until(() => efb.orders.length > 0, "the EFB app's order")
  assert.deepEqual(efb.orders, [{ t: "open-efb", landing: "session", id: "bench-clients.look" }])
  assert.deepEqual(banner.messages("unit"), [], "only the EFB app gets the order")
  await core.logged(/a notification was clicked outside its action, so the EFB app opens the EFB onto our app/)
})
