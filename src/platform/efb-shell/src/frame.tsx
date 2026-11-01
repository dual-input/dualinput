// The EFB app's window: below the EFB's own status bar, the header, the page of the tab that's open,
// the tab bar, and the place take control sits under it on every tab
// (record/areas/interface/decisions.md, "The EFB app is a header, five tabs, and take control under the
// tabs"). Layout is flexbox's, so it fills whatever view the tablet gives it.

import { Root, TabBar, Toaster } from "@dualinput/ui"
import { Headset, Plane, PersonStanding, Settings, Users } from "lucide-react"
import { useLayoutEffect, useState } from "react"
import type { ReactNode } from "react"

import { useCoreState } from "./core-link.ts"
import type { CoreLink } from "./core-link.ts"
import { Reconnecting, ServiceDown } from "./lost-service.tsx"
import { Mark } from "./mark.tsx"
import { useViewSize } from "./view.ts"

export type Tab = "session" | "traffic" | "atc" | "figures" | "settings"

const TABS: { id: Tab; icon: typeof Users; label: string }[] = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC audio" },
  { id: "figures", icon: PersonStanding, label: "Figures" },
  { id: "settings", icon: Settings, label: "Settings" },
]

/** The header's height: its 32px pill centered, so it sits 11px from the window's top, as from its right. */
export const HEADER_HEIGHT = 54

/**
 * How much of the view's top the EFB's own status bar covers, in the root's units: its notifications
 * and the date draw over whatever sits there, at `z-index` 998, 25px tall at Small
 * (record/areas/interface/log.md, 2026-11-01). It's measured, since it scales with the tablet.
 */
function useStatusBarInset(scale: number): number {
  const [inset, setInset] = useState(0)
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".status-bar")
    setInset(bar ? bar.offsetHeight / scale : 0)
  }, [scale])
  return inset
}

export type FrameProps = {
  host: HTMLElement
  link: CoreLink
  version: string
  /** The page of each tab. */
  pages: Partial<Record<Tab, ReactNode>>
}

export function Frame({ host, link, version, pages }: FrameProps) {
  const { width, height, scale } = useViewSize(host)
  const inset = useStatusBarInset(scale)
  const core = useCoreState(link)
  const [tab, setTab] = useState<Tab>("session")
  const down = core === "not-running" || core === "closed"
  return (
    <Root scale={scale} style={{ width, height, overflow: "hidden" }}>
      <div className="relative flex h-full flex-col bg-background" style={{ paddingTop: inset }}>
        <div className="flex shrink-0 select-none items-center px-5" style={{ height: HEADER_HEIGHT }}>
          <Mark className="mr-2 size-4 text-primary" />
          <span className="mr-2 text-sm font-medium">Dual Input</span>
          <span className="text-xs text-muted-foreground">v{version}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{down ? <ServiceDown closed={core === "closed"} headerHeight={HEADER_HEIGHT} /> : pages[tab]}</div>
        {!down && <TabBar tabs={TABS} active={tab} onSelect={setTab} />}
        {!down && <Reconnecting on={core === "reconnecting"} />}
      </div>
      <Toaster />
    </Root>
  )
}
