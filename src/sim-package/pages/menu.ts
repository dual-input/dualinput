// menu.js: the menu script, one esbuild bundle of it and page-client, which our copy of
// BlurPage loads into the sim's menu document. It joins the core as `menu-script`, and when
// the sim service asks, as its socket joins, it reports the master page, `MasterPage` in the
// main menu and `MasterPage_InGame` in a flight, which tells a core that found the sim already
// running where the pilot is (record/areas/session/02-units.md, "The menu script";
// record/areas/core/03-sim-seam-and-wasm-module.md, "Leaving Starting"). From then on it reports
// each change, which is how the aircraft picker and Join know the pilot is at the world map. It
// also makes the world map's requests the sim service hands it, which Join sends (world-map.ts).
//
// It touches no input, so it has nothing to fail open from.

import type { MenuPage } from "../../engines/messages/ts/sim/MenuPage.ts"
import type { WorldMapAnswer } from "../../engines/messages/ts/sim/WorldMapAnswer.ts"
import type { WorldMapCall } from "../../engines/messages/ts/sim/WorldMapCall.ts"
import { PageClient } from "../../engines/page-client/src/page-client.ts"
import { simEnv } from "../../engines/page-client/src/sim-env.ts"
import { run } from "./world-map.ts"

/** The component its `hello` names. `component::MENU_SCRIPT` in src/engines/messages/src/clients.rs names it too. */
const COMPONENT = "menu-script"

/** The unit its report goes to, which asks for it. `MENU_UNIT` in src/engines/messages/src/sim.rs names it too. */
const UNIT = "sim-service"

/** How often it looks for a change of page, in milliseconds (record/areas/session/02-units.md, "The menu script"). */
const WATCH_MS = 500

/**
 * The master page on screen. The pause menu puts `MasterPage_Pause` over a flight's
 * `MasterPage_InGame`, so a flight's master page decides first (measured on MSFS 2024,
 * 2026-10-06, record/areas/interface/log.md, "Code in the menu's document tells which page is up,
 * and nothing we found takes the menu home without the sim in front"). The world map shows as the
 * large page component `FreeFlightPage` over the main menu's master page (same entry), and the
 * menu script found it in this form (measured on MSFS 2024, 2026-11-17,
 * record/areas/session/log.md, "In the sim, Join set the world map and started the flight within
 * 0.9s, and active pause followed from our EFB app's code in 264ms, once the menu script parsed").
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
  client.onUnit(UNIT, (body) => {
    const asked = body as Partial<WorldMapCall> | null
    if (asked && typeof asked.call === "number" && asked.request) {
      const call = asked.call
      void run(asked.request).then((outcome) => {
        const answer: WorldMapAnswer = { call, outcome }
        client.sendUnit(UNIT, answer)
      })
      return
    }
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
