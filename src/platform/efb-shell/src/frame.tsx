// The EFB app's window: below the EFB's own status bar, the header, the page of the tab that's open, and the
// tab bar (record/areas/interface/decisions.md, "The EFB app is a header, five tabs, and take control under the
// tabs"). The Session and Settings tabs are the platform's, and each part may add one between them, so this
// names no feature. Layout is flexbox's, so it fills whatever view the tablet gives it. Every tab's page stays
// mounted, hidden while another shows, so a page keeps its scroll and what's typed into it.

import { Root, TabBar, Toaster } from "@dualinput/ui"
import { Settings as SettingsIcon, Users } from "lucide-react"
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { ComponentType } from "react"

import type { NetSlice } from "../../../engines/messages/ts/net/NetSlice.ts"
import type { Notification } from "../../../engines/messages/ts/clients/Notification.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../engines/messages/ts/sim/SimSlice.ts"
import { useCoreState, useSlice } from "./core-link.ts"
import type { CoreLink } from "./core-link.ts"
import { Header, HEADER_HEIGHT } from "./header/header.tsx"
import { issuesOf } from "./header/issues.tsx"
import type { HeaderStatus } from "./header/issues.tsx"
import type { SessionPhase } from "./header/phase.tsx"
import { Reconnecting, ServiceDown } from "./lost-service.tsx"
import { ShellContext, startParts, stopParts } from "./part.ts"
import type { Part, Shell } from "./part.ts"
import { SessionTab } from "./session/session-tab.tsx"
import { SetupFlow } from "./setup/setup-flow.tsx"
import { SettingsPage } from "./settings/settings-page.tsx"
import { useViewSize } from "./view.ts"
import { WANTED } from "./wanted.ts"
import type { Wanted } from "./wanted.ts"

/**
 * How much of the view's top the EFB's own status bar covers, in the root's units: its notifications and the
 * date draw over whatever sits there, at `z-index` 998, 25px tall at Small (record/areas/interface/log.md,
 * 2026-11-01). It's measured, since it scales with the tablet.
 */
function useStatusBarInset(scale: number): number {
  const [inset, setInset] = useState(0)
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".status-bar")
    setInset(bar ? bar.offsetHeight / scale : 0)
  }, [scale])
  return inset
}

/** The header shows a phase once this pilot is in the flight of a session in preflight or flying. */
function phaseOf(session: SessionSlice | undefined): SessionPhase | undefined {
  if (!session?.held) return undefined
  const me = session.members.find((member) => member.pilot === session.me)
  if (!me?.in_flight) return undefined
  const phase = session.preflight.phase
  return phase === "ended" ? "syncing" : phase === "running" || phase === "countdown" ? "preflight" : undefined
}

function useHeaderStatus(link: CoreLink, version: string, open: (tab: string) => void): HeaderStatus {
  const net = useSlice<NetSlice>(link, "network")
  const sim = useSlice<SimSlice>(link, "sim")
  const notifications = useSlice<Notification[]>(link, "notifications")
  const wanted = useSlice<Wanted>(link, WANTED)
  const raised = (id: string) => !!notifications?.some((notification) => notification.id === id)
  const update = wanted?.update
  return {
    offline: net?.internet === false,
    servers: wanted?.servers,
    firewall: wanted?.firewall,
    module: sim?.module === "stopped" ? "stopped" : sim?.module === "missing" ? "missing" : undefined,
    bridge: raised("clients.no-panel"),
    helper: raised("core-helper.down"),
    update: update?.state === "ready" ? { next: update.next, have: version, view: () => open("settings") } : undefined,
  }
}

export type FrameProps = {
  host: HTMLElement
  link: CoreLink
  version: string
  parts: Part[]
}

type TabPage = { id: string; icon: ComponentType<{ className?: string }>; label: string; page: ComponentType }

export function Frame({ host, link, version, parts }: FrameProps) {
  const { width, height, scale } = useViewSize(host)
  const inset = useStatusBarInset(scale)
  const core = useCoreState(link)
  const [tab, setTab] = useState("session")
  const [dots, setDots] = useState<Record<string, boolean>>({})
  const setDot = useCallback((id: string, on: boolean) => setDots((now) => (!!now[id] === on ? now : { ...now, [id]: on })), [])
  const shell = useMemo<Shell>(() => ({ link, open: setTab, setDot }), [link, setDot])
  useEffect(() => {
    startParts(parts, link)
    return () => stopParts(parts)
  }, [parts, link])
  const tabs = useMemo<TabPage[]>(
    () => [
      { id: "session", icon: Users, label: "Session", page: () => <SessionTab parts={parts} /> },
      ...parts.filter((part) => part.tab).map((part) => ({ id: part.name, ...part.tab! })),
      { id: "settings", icon: SettingsIcon, label: "Settings", page: () => <SettingsPage version={version} /> },
    ],
    [parts, version],
  )
  const session = useSlice<SessionSlice>(link, "session")
  const status = useHeaderStatus(link, version, setTab)
  const down = core === "not-running" || core === "closed"
  const issues = down ? [] : issuesOf(status, !!session?.held)
  const setup = useSlice<Wanted>(link, WANTED)?.setup
  // Setup has the whole window, with no header or tabs, until the pilot has a name.
  const [setupDone, setSetupDone] = useState(false)
  if (!down && setup && !setupDone) {
    return (
      <ShellContext.Provider value={shell}>
        <Root scale={scale} style={{ width, height, overflow: "hidden" }}>
          <div data-app-frame className="relative flex h-full flex-col bg-background" style={{ paddingTop: inset }}>
            <SetupFlow
              key={setup.failure ?? "clear"}
              facts={{ ...setup, version }}
              onFix={(failure) => void link.client.command("setup.fix", { failure }).catch(() => {})}
              onDone={(name, color) => {
                setSetupDone(true)
                void link.client.command("clients.set-setting", { key: "session.name", value: name }).catch(() => {})
                void link.client.command("setup.done", { color }).catch(() => {})
              }}
            />
          </div>
          <Toaster />
        </Root>
      </ShellContext.Provider>
    )
  }
  return (
    <ShellContext.Provider value={shell}>
      <Root scale={scale} style={{ width, height, overflow: "hidden" }}>
        <div data-app-frame className="relative flex h-full flex-col bg-background" style={{ paddingTop: inset }}>
          <Header version={version} phase={down ? undefined : phaseOf(session)} issues={issues} offline={!!status.offline} />
          <div className="flex min-h-0 flex-1 flex-col">
            {down ? (
              <ServiceDown closed={core === "closed"} headerHeight={HEADER_HEIGHT} />
            ) : (
              tabs.map(({ id, page }) => (
                <div key={id} className="min-h-0 flex-1 flex-col" style={{ display: id === tab ? "flex" : "none" }}>
                  {createElement(page)}
                </div>
              ))
            )}
          </div>
          {!down && <TabBar tabs={tabs.map(({ id, icon, label }) => ({ id, icon, label, dot: dots[id] }))} active={tab} onSelect={setTab} />}
          {!down && <Reconnecting on={core === "reconnecting"} />}
        </div>
        <Toaster />
      </Root>
    </ShellContext.Provider>
  )
}
