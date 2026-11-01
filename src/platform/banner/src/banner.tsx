// The banner's page: Dual Input's in-game panel over the cockpit, which tells a pilot what needs them while they fly,
// with the EFB open or not (record/areas/product/03-v1-scope.md, Notification banner). The panel stays open through
// each flight of a session, and the page shows and hides its own content from the slices it watches, so with nothing
// to say it paints nothing (record/areas/interface/01-apps.md, "The banner").

import { Root } from "@dualinput/ui"
import { useEffect, useRef, useState } from "react"

import type { NetSlice } from "../../../engines/messages/ts/net/NetSlice.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import { useCoreState, useSlice } from "../../../engines/page-client/src/core-link.ts"
import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { serviceNote } from "./note.ts"
import type { Landing, Note } from "./note.ts"
import { inPreflight, PreflightCard } from "./preflight-card.tsx"
import { BOX, Stack } from "./stack.tsx"

/** The command a click sends, and the name a click on the summary goes by, since the summary is no notification. `NOTIFICATION_CLICKED` in src/engines/messages/src/clients.rs names the command too. */
const CLICKED = "clients.notification-clicked"
const SUMMARY_CLICK = "banner.preflight-summary"
/** What the page raises for a click while no core can carry it, which the EFB app watches while its own link is down. `OPEN_EFB_VARIABLE` in src/platform/efb-shell/src/landing.ts names the same one, so change both together. */
export const OPEN_EFB_VARIABLE = "L:DUALINPUT_BANNER_OPEN_EFB"

/** The panel takes its size from the screen's height, so its pixels do too: the box always covers the same share of the screen. */
function useBoxScale(host: HTMLElement): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const update = () => {
      if (host.offsetHeight > 0) setScale(host.offsetHeight / BOX.height)
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [host])
  return scale
}

export type BannerProps = {
  /** The element the panel's page gives the banner, which fills the panel. */
  host: HTMLElement
  link: CoreLink
  /** Opens the EFB while the core is gone, which can't carry the click. */
  openWithoutCore: () => void
}

export function Banner({ host, link, openWithoutCore }: BannerProps) {
  const scale = useBoxScale(host)
  const core = useCoreState(link)
  const session = useSlice<SessionSlice>(link, "session")
  const network = useSlice<NetSlice>(link, "network")
  const raised = useSlice<Note[]>(link, "notifications")
  const connectedOnce = useRef(false)
  if (core === "connected") connectedOnce.current = true
  const service = serviceNote(core, connectedOnce.current)
  const notes = service ? [service, ...(raised ?? [])] : (raised ?? [])
  const open = (id: string, landing: Landing) => {
    if (core === "connected") void link.client.command(CLICKED, { id, landing }).catch(() => {})
    else openWithoutCore()
  }
  return (
    <Root scale={scale} className="pointer-events-none" style={{ width: BOX.width, height: BOX.height, overflow: "hidden" }}>
      <Stack
        notes={notes}
        onOpen={(note) => open(note.id, note.landing)}
        summary={
          inPreflight(session) && core === "connected" ? (
            <PreflightCard session={session!} network={network} onOpen={() => open(SUMMARY_CLICK, "session")} onReady={(on) => void link.client.command("session.ready", { on }).catch(() => {})} />
          ) : null
        }
      />
    </Root>
  )
}
