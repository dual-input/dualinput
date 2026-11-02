// Where a click on a banner's card opens the EFB app (record/areas/interface/decisions.md, "A notification's click opens
// the EFB app where it's explained or acted on"), and how a click reaches the app with no core to carry it: a page in
// the sim can't tell another page anything directly, so the banner's page raises an `L:` variable and this app reads it,
// as the chain did that first opened an app of ours from a click (measured on MSFS 2024, 2026-10-04,
// record/areas/interface/log.md). The EFB app polls it only while its link to the core is down.

import { useEffect, useRef } from "react"

import type { EfbAppOrder } from "../../../engines/messages/ts/clients/EfbAppOrder.ts"
import type { Landing } from "../../../engines/messages/ts/clients/Landing.ts"
import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import type { SimWindow } from "./sim-window.ts"

/** The variable the banner's page raises. `OPEN_EFB_VARIABLE` in src/platform/banner/src/banner.tsx names the same one, so change both together. */
export const OPEN_EFB_VARIABLE = "L:DUALINPUT_BANNER_OPEN_EFB"
const POLL_MS = 200

/** Hears the core's order, and the banner's call while the core is gone, opening the EFB for each. */
export function useLanding(link: CoreLink, sim: SimWindow, down: boolean, land: (landing: Landing, id: string) => void): void {
  const landNow = useRef(land)
  landNow.current = land
  useEffect(
    () =>
      link.client.onUnit("clients", (body) => {
        const order = body as EfbAppOrder
        if (order.t !== "open-efb") return
        sim.openEfb()
        landNow.current(order.landing, order.id)
      }),
    [link, sim],
  )
  useEffect(() => {
    if (!down) return
    // A click while the app's own screen covers every tab lands wherever the app was, so it only opens the EFB.
    let seen = sim.bannerAsked()
    const timer = window.setInterval(() => {
      const asked = sim.bannerAsked()
      if (asked !== seen) sim.openEfb()
      seen = asked
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [down, sim])
}
