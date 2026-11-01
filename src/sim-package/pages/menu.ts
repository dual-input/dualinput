// menu.js: the menu script, one esbuild bundle of it and page-client, which our copy of
// BlurPage loads into the sim's menu document. It joins the core as `menu-script`, and when
// the sim service asks, as its socket joins, it reports the master page, `MasterPage` in the
// main menu and `MasterPage_InGame` in a flight, which tells a core that found the sim already
// running where the pilot is (record/areas/session/02-units.md, "The menu script";
// record/areas/core/03-sim-seam-and-wasm-module.md, "Leaving Starting"). From then on it reports
// each change, which is how the aircraft picker knows it's at the world map.
//
// It touches no input, so it has nothing to fail open from.

import type { MenuPage } from "../../engines/messages/ts/sim/MenuPage.ts"
import { PageClient } from "../../engines/page-client/src/page-client.ts"
import { simEnv } from "../../engines/page-client/src/sim-env.ts"

/** The component its `hello` names. `component::MENU_SCRIPT` in src/engines/messages/src/clients.rs names it too. */
const COMPONENT = "menu-script"

/** The unit its report goes to, which asks for it. `MENU_UNIT` in src/engines/messages/src/sim.rs names it too. */
const UNIT = "sim-service"

/** How often it looks for a change of page, in milliseconds. */
const WATCH_MS = 1000

/**
 * The master page on screen. The pause menu puts `MasterPage_Pause` over a flight's
 * `MasterPage_InGame`, so a flight's master page decides first (measured on MSFS 2024,
 * 2026-10-06, record/areas/interface/log.md). The world map shows as the large page component
 * `FreeFlightPage` over the main menu's master page (same log); that it's an element in this
 * form is unverified, and a session in the sim settles it.
 */
function masterPage(): MenuPage {
  if (document.querySelector('ui-resource-element[name="MasterPage_InGame"]')) return "in-game"
  if (document.querySelector('ui-resource-element[name="FreeFlightPage"]')) return "world-map"
  if (document.querySelector('ui-resource-element[name="MasterPage"]')) return "main"
  return "unknown"
}

try {
  const client = new PageClient({ component: COMPONENT }, simEnv())
  // Null until the sim service has asked, and it asks each time the socket joins.
  let reported: MenuPage | null = null
  client.onUnit(UNIT, () => {
    reported = masterPage()
    client.sendUnit(UNIT, { master: reported })
  })
  setInterval(() => {
    const now = masterPage()
    if (reported === null || now === reported) return
    reported = now
    client.sendUnit(UNIT, { master: now })
  }, WATCH_MS)
  client.start()
} catch (e) {
  console.error(`Dual Input: the menu script didn't start: ${e}`)
}
