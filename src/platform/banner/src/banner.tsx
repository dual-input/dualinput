// The banner's page: Dual Input's in-game panel over the cockpit, which tells a pilot what needs them while they fly,
// with the EFB open or not (record/areas/product/03-v1-scope.md, Notification banner). The panel stays open through
// each flight of a session, and the page shows and hides its own content from the slices it watches, so with nothing
// to say it paints nothing (record/areas/interface/01-apps.md, "The banner").

import { inPreflight } from "@dualinput/crew"
import { Root } from "@dualinput/ui"
import { useEffect, useRef, useState } from "react"

import type { NetSlice } from "../../../engines/messages/ts/net/NetSlice.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import { useCoreState, useSlice } from "../../../engines/page-client/src/core-link.ts"
import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { serviceNote } from "./note.ts"
import type { Landing, Note } from "./note.ts"
import { PreflightCard } from "./preflight-card.tsx"
import { BOX, Stack } from "./stack.tsx"

/** The command a click sends, and the name a click on the summary goes by, since the summary is no notification. `NOTIFICATION_CLICKED` in src/engines/messages/src/clients.rs names the command too. */
const CLICKED = "clients.notification-clicked"
const SUMMARY_CLICK = "banner.preflight-summary"
/** What the page raises for a click while no core can carry it, which the EFB app watches while its own link is down. `OPEN_EFB_VARIABLE` in src/platform/efb-shell/src/landing.ts names the same one, so change both together. */
export const OPEN_EFB_VARIABLE = "L:DUALINPUT_BANNER_OPEN_EFB"

/** How long a change of the window has to rest before the panel looks at its shape, in milliseconds, and the share of its shape that counts as the same. */
const WINDOW_SETTLES = 300
const SAME_SHAPE = 0.01
/** How often the page reads whether the EFB app is on screen, in milliseconds. */
const LOOK_AT_EFB_EVERY = 250

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

/**
 * The sim sizes a panel as it opens, then stretches it with the window, which moves our box in from the screen's corner, or cuts it off (measured on MSFS 2024, 2026-11-02,
 * record/areas/interface/log.md). So once a change of the window settles, a panel whose shape differs from the one it opened with asks for a new opening.
 */
function useAskToReopen(host: HTMLElement, ask: () => void): void {
  useEffect(() => {
    // The panel measures nothing at times, as it may with another window in front of the sim, which says nothing of its shape.
    const shape = () => (host.offsetHeight > 0 ? host.offsetWidth / host.offsetHeight : 0)
    let opened = shape()
    let later = 0
    const onResize = () => {
      window.clearTimeout(later)
      later = window.setTimeout(() => {
        const now = shape()
        if (!now) return
        if (!opened) opened = now
        else if (Math.abs(now - opened) > opened * SAME_SHAPE) ask()
      }, WINDOW_SETTLES)
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.clearTimeout(later)
    }
  }, [host, ask])
}

/** Whether our EFB app is on screen, which no event says from another document. */
function useOverEfbApp(onScreen: () => boolean): boolean {
  const [over, setOver] = useState(onScreen)
  useEffect(() => {
    const timer = window.setInterval(() => setOver(onScreen()), LOOK_AT_EFB_EVERY)
    return () => window.clearInterval(timer)
  }, [onScreen])
  return over
}

export type BannerProps = {
  /** The element the panel's page gives the banner, which fills the panel. */
  host: HTMLElement
  link: CoreLink
  /** Opens the EFB while the core is gone, which can't carry the click. */
  openWithoutCore: () => void
  /** Asks the EFB app to open the panel anew. */
  askToReopen: () => void
  /** Whether our EFB app is on screen, showing the crew and Ready that the preflight summary would repeat. */
  efbAppOnScreen: () => boolean
}

export function Banner({ host, link, openWithoutCore, askToReopen, efbAppOnScreen }: BannerProps) {
  const scale = useBoxScale(host)
  useAskToReopen(host, askToReopen)
  const overEfbApp = useOverEfbApp(efbAppOnScreen)
  const core = useCoreState(link)
  const session = useSlice<SessionSlice>(link, "session")
  const network = useSlice<NetSlice>(link, "network")
  const raised = useSlice<Note[]>(link, "notifications")
  const connectedOnce = useRef(false)
  if (core === "connected") connectedOnce.current = true
  const service = serviceNote(core, connectedOnce.current)
  // A restart comes back in about 2s, so a card holds through reconnecting, and with the service gone nothing would ever clear it.
  const held = core === "connected" || core === "reconnecting" ? (raised ?? []) : []
  const notes = service ? [service, ...held] : held
  const open = (id: string, landing: Landing) => {
    // A click that doesn't reach the core still opens the EFB.
    if (core === "connected" && landing !== "stay") void link.client.command(CLICKED, { id, landing }).catch(() => openWithoutCore())
    else openWithoutCore()
  }
  return (
    <Root scale={scale} style={{ width: BOX.width, height: BOX.height, overflow: "hidden" }}>
      <div className="pointer-events-none">
        <Stack
          notes={notes}
          onOpen={(note) => open(note.id, note.landing)}
          summary={
            inPreflight(session) && core === "connected" && !overEfbApp ? (
              <PreflightCard session={session!} network={network} onOpen={() => open(SUMMARY_CLICK, "session")} onReady={(on) => void link.client.command("session.ready", { on }).catch(() => {})} />
            ) : null
          }
        />
      </div>
    </Root>
  )
}
