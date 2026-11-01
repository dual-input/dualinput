// The EFB app's window: below the EFB's own status bar, the header, the page of the tab that's open, and the
// tab bar (record/areas/interface/decisions.md, "The EFB app is a header, five tabs, and take control under the
// tabs"). The Session and Settings tabs are the platform's, and each part may add one between them, so this
// names no feature. Layout is flexbox's, so it fills whatever view the tablet gives it. Every tab's page stays
// mounted, hidden while another shows, so a page keeps its scroll and what's typed into it.

import { Root, TabBar, Toaster } from "@dualinput/ui"
import { Settings as SettingsIcon, Users } from "lucide-react"
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { ComponentType } from "react"

import type { CoreSlice } from "../../../engines/messages/ts/clients/CoreSlice.ts"
import type { NetSlice } from "../../../engines/messages/ts/net/NetSlice.ts"
import type { Notification } from "../../../engines/messages/ts/clients/Notification.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../../engines/messages/ts/sim/SimSlice.ts"
import { useCoreState, useSlice } from "../../../engines/page-client/src/core-link.ts"
import type { CoreLink, CoreState } from "../../../engines/page-client/src/core-link.ts"
import { BannerPanel } from "./banner-panel.ts"
import { useDesktopState } from "./desktop-link.ts"
import type { DesktopLink } from "./desktop-link.ts"
import { Header, HEADER_HEIGHT } from "./header/header.tsx"
import { issuesOf } from "./header/issues.tsx"
import type { HeaderStatus } from "./header/issues.tsx"
import type { SessionPhase } from "./header/phase.tsx"
import { useLanding } from "./landing.ts"
import { Reconnecting, ServiceDown } from "./lost-service.tsx"
import { ShellContext, startParts, stopParts } from "./part.ts"
import type { Part, Shell } from "./part.ts"
import { SessionTab } from "./session/session-tab.tsx"
import { AddonMismatch, SetupFlow } from "./setup/setup-flow.tsx"
import type { SetupFailure } from "./setup/setup-flow.tsx"
import { FIGURE_COLOR, NAME, SETUP_DONE, useSetting, writeSetting } from "./settings/setting.ts"
import { SettingsPage } from "./settings/settings-page.tsx"
import type { SimWindow } from "./sim-window.ts"
import { useViewSize } from "./view.ts"

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

/** The stages of a pilot's sim that have a flight, or are loading one, in which the banner's panel opens. */
const IN_A_FLIGHT = ["loading", "ready-to-fly", "flying"]

/** Keeps the banner's panel to the session and this pilot's flights, as the core says them. */
function useBannerPanel(link: CoreLink, sim: SimWindow, session: SessionSlice | undefined, core: CoreState): void {
  const pageOpen = useSlice<boolean>(link, "banner") === true
  const panel = useMemo(() => new BannerPanel({ toolbar: sim.toggleBanner, setTimer: (then, ms) => window.setTimeout(then, ms), clearTimer: (timer) => window.clearTimeout(timer) }), [sim])
  const stage = session?.members.find((member) => member.pilot === session.me)?.status.stage
  const held = !!session?.held
  const flying = held && !!stage && IN_A_FLIGHT.includes(stage)
  useEffect(() => {
    if (core === "closed") panel.coreQuit()
    else if (core === "connected") panel.follow({ held, flying, pageOpen })
  }, [panel, core, held, flying, pageOpen])
}

function useHeaderStatus(link: CoreLink, desktop: DesktopLink, version: string, viewUpdate: () => void, fixFirewall: () => void): HeaderStatus {
  const net = useSlice<NetSlice>(link, "network")
  const sim = useSlice<SimSlice>(link, "sim")
  const notifications = useSlice<Notification[]>(link, "notifications")
  const local = useDesktopState(desktop)
  const raised = (id: string) => !!notifications?.some((notification) => notification.id === id)
  const want = notifications?.find((notification) => notification.id.indexOf("core-helper.failed.") === 0) as (Notification & { detail?: string }) | undefined
  const update = local?.update
  return {
    offline: net?.internet === false,
    servers: net?.servers ?? undefined,
    firewall: local?.firewall,
    fixFirewall,
    connection: raised("network.bind"),
    module: sim?.module === "stopped" ? "stopped" : sim?.module === "missing" ? "missing" : undefined,
    bridge: raised("clients.no-panel"),
    helper: raised("core-helper.down"),
    want: want && { title: want.text, detail: want.detail },
    update: update?.state === "ready" ? { next: update.next, have: version, view: viewUpdate } : undefined,
  }
}

export type FrameProps = {
  host: HTMLElement
  link: CoreLink
  desktop: DesktopLink
  sim: SimWindow
  version: string
  parts: Part[]
}

type TabPage = { id: string; icon: ComponentType<{ className?: string }>; label: string; page: ComponentType }

export function Frame({ host, link, desktop, sim, version, parts }: FrameProps) {
  const { width, height, scale } = useViewSize(host)
  const inset = useStatusBarInset(scale)
  const core = useCoreState(link)
  const [tab, setTab] = useState("session")
  const [dots, setDots] = useState<Record<string, boolean>>({})
  const setDot = useCallback((id: string, on: boolean) => setDots((now) => (!!now[id] === on ? now : { ...now, [id]: on })), [])
  // Asks Settings to show its update section, by counting up, since the page stays mounted between asks.
  const [updateAsks, setUpdateAsks] = useState(0)
  const shell = useMemo<Shell>(() => ({ link, desktop, open: setTab, setDot, updateAsks }), [link, desktop, setDot, updateAsks])
  useEffect(() => {
    startParts(parts, link)
    return () => stopParts(parts)
  }, [parts, link])
  const viewUpdate = useCallback(() => {
    setTab("settings")
    setUpdateAsks((asks) => asks + 1)
  }, [])
  const tabs = useMemo<TabPage[]>(
    () => [
      { id: "session", icon: Users, label: "Session", page: () => <SessionTab parts={parts} /> },
      ...parts.filter((part) => part.tab).map((part) => ({ id: part.name, ...part.tab! })),
      { id: "settings", icon: SettingsIcon, label: "Settings", page: () => <SettingsPage version={version} parts={parts} /> },
    ],
    [parts, version],
  )
  const session = useSlice<SessionSlice>(link, "session")
  const status = useHeaderStatus(link, desktop, version, viewUpdate, () => desktop.ask({ t: "fix-firewall" }))
  const down = core === "not-running" || core === "closed"
  const issues = down ? [] : issuesOf(status, !!session?.held)
  useBannerPanel(link, sim, session, core)
  const [headerOpened, setHeaderOpened] = useState(0)
  useLanding(link, sim, core !== "connected", (landing) => {
    if (landing === "header") setHeaderOpened((times) => times + 1)
    else setTab(landing === "session" ? "session" : (parts.find((part) => part.tab?.landing === landing)?.name ?? "session"))
  })
  const coreSlice = useSlice<CoreSlice>(link, "core")
  const net = useSlice<NetSlice>(link, "network")
  const local = useDesktopState(desktop)
  const coreVersion = coreSlice?.version
  const mismatch = !down && coreVersion !== undefined && coreVersion !== version
  // Setup has the whole window, with no header or tabs, until the pilot has a name. Its Continue ends it here at once, ahead of the setting's coming back from the core.
  const setupDone = useSetting(link, SETUP_DONE)
  const [continued, setContinued] = useState(false)
  useEffect(() => {
    if (setupDone === true) setContinued(false)
  }, [setupDone])
  const failures = [mismatch && "addon", net?.internet === false && "offline", net?.servers === "unreachable" && "servers", local?.firewall === "blocks" && "firewall"].filter((failure): failure is SetupFailure => !!failure)
  if (!down && setupDone === false && !continued) {
    return (
      <ShellContext.Provider value={shell}>
        <Root scale={scale} style={{ width, height, overflow: "hidden" }}>
          <div data-app-frame className="relative flex h-full flex-col bg-background" style={{ paddingTop: inset }}>
            <SetupFlow
              facts={{ failures, username: coreSlice?.username ?? "", addonVersion: version, version: coreVersion ?? version }}
              onFix={(failure) => desktop.ask(failure === "addon" ? { t: "restart-sim" } : { t: "fix-firewall" })}
              onDone={(name, color) => {
                setContinued(true)
                writeSetting(link, NAME, name)
                writeSetting(link, FIGURE_COLOR, color)
                writeSetting(link, SETUP_DONE, true)
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
          <Header version={version} phase={down || mismatch ? undefined : phaseOf(session)} icons={parts.map((part) => part.phaseIcon && createElement(part.phaseIcon, { key: part.name }))} issues={mismatch ? [] : issues} offline={!!status.offline} opened={headerOpened} />
          <div className="flex min-h-0 flex-1 flex-col">
            {down ? (
              <ServiceDown closed={core === "closed"} headerHeight={HEADER_HEIGHT} />
            ) : mismatch ? (
              <AddonMismatch addon={version} service={coreVersion} headerHeight={HEADER_HEIGHT} onRestart={() => desktop.ask({ t: "restart-sim" })} />
            ) : (
              tabs.map(({ id, page }) => (
                <div key={id} className="min-h-0 flex-1 flex-col" style={{ display: id === tab ? "flex" : "none" }}>
                  {createElement(page)}
                </div>
              ))
            )}
          </div>
          {!down && !mismatch && <TabBar tabs={tabs.map(({ id, icon, label }) => ({ id, icon, label, dot: dots[id] }))} active={tab} onSelect={setTab} />}
          {!down && !mismatch && parts.map((part) => part.underTabs && createElement(part.underTabs, { key: part.name }))}
          {!down && <Reconnecting on={core === "reconnecting"} />}
        </div>
        <Toaster />
      </Root>
    </ShellContext.Provider>
  )
}
