// The desktop app's window. Every screen a pilot uses Dual Input through is in the EFB app, so this answers only a pilot who
// asks why this app is always running: what it takes of the PC, what it does, and what quitting it costs
// (record/areas/interface/decisions.md, "The desktop app shows Velopack's windows and its own figures, and the build designs
// the rest").

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { Button, cx, Room, Root, Spinner, Switch, useReveal } from "@dualinput/ui"
import { ChevronDown, X } from "lucide-react"

import type { DesktopLink, Screen, View } from "./link.ts"
import { UsageChart } from "./usage-chart.tsx"
import { quitCost } from "./usage.ts"
import { Welcome } from "./welcome.tsx"

/** How often an open window reads the figures and the states again. */
const READ_EVERY = 5000
/** How long the Rust side takes to carry out an ask, well under a second, so a switch shows what holds soon after a press. */
const READ_AFTER_ASK = 150
const BAR_HEIGHT = 32

const TITLES: Record<Exclude<Screen, "welcome">, string> = { main: "Dual Input Tray App", quit: "Quit Dual Input?" }

/** The window's own title bar, since the one dark look has to reach the top of the window. It moves the window as Windows' does. */
function TitleBar({ title, link }: { title: string; link: DesktopLink }) {
  return (
    <div
      className="flex select-none items-center justify-between border-b border-border pl-3.5 pr-1 text-xs text-muted-foreground"
      style={{ height: BAR_HEIGHT }}
      onMouseDown={(event) => {
        if (event.button === 0) link.drag()
      }}
    >
      <span>{title}</span>
      <button
        type="button"
        aria-label="Close"
        className="flex size-6 items-center justify-center rounded-xl hover:bg-muted hover:text-foreground"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={link.close}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-medium">{children}</h2>
}

function Usage({ view }: { view: View }) {
  return (
    <section>
      <p>This tray app keeps Dual Input ready for your next flight. When it's in the background, you'd barely know it's there:</p>
      <UsageChart usage={view.usage} />
    </section>
  )
}

function WhatItDoes() {
  return (
    <>
      <ul className="list-disc space-y-1 pl-4 text-foreground/80">
        <li>Starts the Dual Input service with the sim, before any aircraft loads. This matters on some aircraft, where Dual Input needs to get ahead of their own flight control systems.</li>
        <li>Installs updates while the sim is closed, so you rarely have to restart for Dual Input. Updates usually download only what changed, so they won't hog your connection.</li>
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">It also revives the Dual Input service if it crashes during a flight.</p>
    </>
  )
}

function StartWithWindows({ view, ask }: { view: View; ask: DesktopLink["ask"] }) {
  const state = view.desktop.start_with_windows
  const warning = useReveal(state !== "on")
  return (
    <div className="border-t border-border py-2.5">
      <div className="flex items-center justify-between">
        <span>Start with Windows</span>
        <Switch checked={state === "on"} disabled={state === "off-in-windows"} aria-label="Start with Windows" onCheckedChange={(on) => ask({ t: "set-start-with-windows", on })} />
      </div>
      <Room open={warning.open} pad="pt-1" style={warning.style}>
        {/* The EFB app's Settings tab says these two lines under its switch, src/platform/efb-shell/src/settings/settings-page.tsx, so change both together. */}
        {state === "off-in-windows" && <p className="mb-1 text-xs text-muted-foreground">Turned off in Windows. Turn it back on in Settings, under Apps, Startup.</p>}
        <p className="text-xs text-warning">
          With this off, you'll need to open Dual Input from the Start menu for each flight. Forgetting to launch it early enough can result in certain features breaking in some aircraft. No automatic updates means you may need to restart the sim just as you are preparing to fly.
        </p>
      </Room>
    </div>
  )
}

function Version({ version, view, ask }: { version: string; view: View; ask: DesktopLink["ask"] }) {
  const update = view.desktop.update
  const check = () => ask({ t: "check-for-updates" })
  // What holds a ready update back, which the pilot ends first (record/areas/install/01-installing-and-updating.md, "Install now").
  const held = view.sessionHeld ? " It installs once you leave your session." : view.simRunning ? " It installs once the sim is closed." : ""
  return (
    <div className="flex items-center justify-between border-t border-border pt-2.5">
      <div className="min-w-0">
        <div>Version {version}</div>
        <div className={cx("text-xs", update.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {update.state === "current" && `Up to date${update.checked ? `, checked ${update.checked}` : ""}`}
          {update.state === "checking" && (
            <span className="flex items-center">
              <Spinner className="mr-1.5 size-3" />
              Checking for updates
            </span>
          )}
          {update.state === "downloading" && `Downloading ${update.next}, ${update.done}%`}
          {(update.state === "available" || update.state === "ready") && `Version ${update.next} is available.${held}`}
          {update.state === "failed" && (update.next === null ? `Couldn't check for updates: ${update.error}` : `Couldn't download ${update.next}: ${update.error}`)}
        </div>
      </div>
      {(update.state === "current" || update.state === "checking") && (
        <Button size="sm" variant="secondary" className="ml-3" disabled={update.state === "checking"} onClick={check}>
          Check now
        </Button>
      )}
      {/* Found or downloaded, it's one new version to the pilot, and Install now downloads what it hasn't. */}
      {(update.state === "available" || update.state === "ready") && (
        <Button size="sm" className="ml-3" disabled={held !== ""} onClick={() => ask({ t: "install-update" })}>
          Install now
        </Button>
      )}
      {update.state === "failed" && (
        <Button size="sm" variant="secondary" className="ml-3" onClick={check}>
          Try again
        </Button>
      )}
    </div>
  )
}

function Main({ version, view, ask }: { version: string; view: View; ask: DesktopLink["ask"] }) {
  return (
    <>
      <Usage view={view} />
      <section className="mt-3.5">
        <Heading>What does this do?</Heading>
        <div className="mt-1">
          <WhatItDoes />
        </div>
      </section>
      <section className="mt-3.5">
        <StartWithWindows view={view} ask={ask} />
        <Version version={version} view={view} ask={ask} />
      </section>
    </>
  )
}

/** Quit's ask. What the app does is folded, since the pilot's choice here turns on the red line and not on reading the list. */
function Quit({ view, link }: { view: View; link: DesktopLink }) {
  const [open, setOpen] = useState(false)
  const list = useReveal(open)
  return (
    <>
      <Usage view={view} />
      <section className="mt-3.5">
        {/* Its padding hangs out into the margin, so the words line up with the headings around it, and it's thin enough to leave the pill clear of the window's edge. */}
        <Button variant="ghost" size="sm" aria-expanded={open} style={{ height: 24, marginLeft: -6, paddingLeft: 6, paddingRight: 6 }} onClick={() => setOpen(!open)}>
          What does this do?
          <ChevronDown className={cx("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </Button>
        <Room open={list.open} pad="pt-1" style={list.style}>
          <WhatItDoes />
        </Room>
      </section>
      <section className="mt-3.5 text-destructive">
        <Heading>If you quit</Heading>
        <p className="mt-0.5">{quitCost(view)}</p>
      </section>
      <div className="mt-3.5 flex justify-end">
        <Button size="sm" variant="outline" onClick={link.quit}>
          Quit anyway
        </Button>
        <Button size="sm" className="ml-2" onClick={link.close}>
          Keep running
        </Button>
      </div>
    </>
  )
}


export function DesktopWindow({ version, link }: { version: string; link: DesktopLink }) {
  const [view, setView] = useState<View>()
  const [screen, setScreen] = useState<Screen>()
  /** The height the screen leaves what the window shows, while that's less than it needs. */
  const [room, setRoom] = useState<number>()
  const content = useRef<HTMLDivElement>(null)

  const read = useCallback(
    () =>
      link.view().then((next) => {
        setView(next)
        setScreen((shown) => shown ?? next.screen)
      }),
    [link],
  )

  useEffect(() => {
    window.dualInputShow = setScreen
    read()
    const every = setInterval(read, READ_EVERY)
    return () => {
      clearInterval(every)
      delete window.dualInputShow
    }
  }, [read])

  const ask: DesktopLink["ask"] = (asked) => {
    setTimeout(read, READ_AFTER_ASK)
    return link.ask(asked)
  }

  // The window hugs what it shows, since a folded list, the switch's warning, and each screen all differ in height, and it
  // follows them frame by frame as they ease open or shut. What it shows only scrolls when the screen has too little room, and
  // the Rust side says when that is: a page that scrolled whenever it grew would flash a scrollbar until the window caught up,
  // which narrows the text and jumps the layout. Nothing's measured until the first read has come, since the first fit shows the
  // window, and an empty page would show it as a strip.
  const ready = view !== undefined && screen !== undefined
  // The welcome draws no title bar, since it's a short sequence the pilot steps through and closes with its last button.
  const bar = screen === "welcome" ? 0 : BAR_HEIGHT
  useLayoutEffect(() => {
    const element = content.current
    if (!element || !ready) return
    const fit = () => {
      const height = Math.ceil(element.getBoundingClientRect().height) + bar
      void link.fit(height).then((shown) => setRoom(shown < height ? shown - bar : undefined))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [link, ready, bar])

  return (
    <Root>
      <div className="bg-background text-[13px] leading-snug text-foreground">
        {bar > 0 && <TitleBar title={screen && screen !== "welcome" ? TITLES[screen] : TITLES.main} link={link} />}
        <div style={room === undefined ? undefined : { height: room, overflowY: "auto" }}>
          {view && screen === "welcome" ? (
            <div ref={content}>
              <Welcome view={view} link={link} read={read} />
            </div>
          ) : (
            // The kit's root turns selection off for the sim's pages, and a window on the desktop reads like any other, so its
            // words can be copied. A line of text has room above its capitals, so a thinner top looks the same as the left.
            <div ref={content} className="px-3.5 pb-3.5 pt-2.5" style={{ WebkitUserSelect: "text" }}>
              {view && screen === "main" && <Main version={version} view={view} ask={ask} />}
              {view && screen === "quit" && <Quit view={view} link={link} />}
            </div>
          )}
        </div>
      </div>
    </Root>
  )
}
