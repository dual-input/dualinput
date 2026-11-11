// The desktop app's window with no app behind it, a day of figures standing in, and a row of states to look at it in.

import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { Button, Root } from "@dualinput/ui"

import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { DesktopLink, Sample, Screen, Usage, View } from "../src/link.ts"
import { DesktopWindow } from "../src/window.tsx"

const MB = 1024 * 1024
/** `WIDTH` in src/apps/desktop/src/screens.rs names the same one, so change both together. */
const WIDTH = 400
const NOW = 1_800_000_000

/** A day of a sample a minute, with a window opened twice, an update downloaded once, and a morning the PC was off. */
function aDay(): Usage {
  const samples: Sample[] = []
  const wobble = (at: number, by: number) => (Math.sin(at * 1.7) + Math.sin(at * 0.61 + 2) * 0.7) * by
  for (let minute = 1440; minute >= 0; minute--) {
    if (minute > 1000 && minute < 1180) continue
    const open = (minute <= 620 && minute > 612) || minute < 2
    samples.push({
      at: NOW - minute * 60,
      memory: open ? 72 * MB : (4 + wobble(minute, 0.1)) * MB,
      cpu: open ? 2.8 : 0.06 + Math.abs(wobble(minute, 0.02)),
      network: minute === 340 ? 12 * MB : minute === 339 ? 6 * MB : minute % 180 === 0 ? 30 * 1024 : 0,
    })
  }
  return { samples, windowOpened: [NOW - 620 * 60, NOW - 90], updateDownloaded: [NOW - 340 * 60], now: NOW }
}

const OPENED_MOMENTS_AGO: Usage = { samples: [{ at: NOW, memory: 71 * MB, cpu: 2.4, network: 0 }], windowOpened: [NOW - 3], updateDownloaded: [], now: NOW }

const DESKTOP: DesktopState = { update: { state: "current", checked: "2 hours ago" }, firewall: "allows", start_with_windows: "on" }

function Page() {
  const [screen, setScreen] = useState<Screen>("main")
  const [simRunning, setSimRunning] = useState(false)
  const [sessionHeld, setSessionHeld] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [declines, setDeclines] = useState(false)
  const [fresh, setFresh] = useState(false)
  const [desktop, setDesktop] = useState(DESKTOP)
  const [welcomes, setWelcomes] = useState(0)
  const [height, setHeight] = useState(0)
  const view: View = { screen, usage: fresh ? OPENED_MOMENTS_AGO : aDay(), desktop, simRunning, sessionHeld, fixingFirewall: fixing }
  const link: DesktopLink = {
    view: () => Promise.resolve(view),
    ask: (ask) => {
      if (ask.t === "set-start-with-windows") setDesktop({ ...desktop, start_with_windows: ask.on ? "on" : "off" })
      // Windows' UAC prompt, which the pilot answers 2s later, yes unless "declines" is on.
      if (ask.t === "fix-firewall") {
        setFixing(true)
        window.setTimeout(() => {
          setFixing(false)
          if (!declines) setDesktop({ ...desktop, firewall: "allows" })
        }, 2000)
      }
      return Promise.resolve()
    },
    fit: (asked) => {
      setHeight(asked)
      return Promise.resolve(asked)
    },
    drag: () => undefined,
    close: () => undefined,
    quit: () => undefined,
  }
  const toggle = (label: string, on: boolean, set: (on: boolean) => void) => (
    <Button key={label} size="xs" variant={on ? "default" : "outline"} onClick={() => set(!on)}>
      {label}
    </Button>
  )
  useEffect(() => window.dualInputShow?.(screen), [screen])
  return (
    <div className="flex">
      {/* A new key per state, since the window reads its link once a poll, and this should show at once. */}
      <div style={{ width: WIDTH }} key={JSON.stringify(screen === "welcome" ? [screen, welcomes] : [screen, simRunning, sessionHeld, fresh, desktop])}>
        <DesktopWindow version="0.1.0" link={link} />
      </div>
      <Root>
        <div className="ml-6 space-y-2 p-4 text-sm text-foreground">
          <div className="text-muted-foreground">Window height: {height}px</div>
          <div className="space-x-1">
            {(["main", "quit", "welcome"] as const).map((one) => toggle(one, screen === one, () => setScreen(one)))}
          </div>
          <div className="space-x-1">
            {toggle("sim running", simRunning, setSimRunning)}
            {toggle("in a session", sessionHeld, setSessionHeld)}
            {toggle("first minutes", fresh, setFresh)}
          </div>
          <div className="space-x-1">
            {toggle("firewall blocks", desktop.firewall === "blocks", (on) => setDesktop({ ...desktop, firewall: on ? "blocks" : "allows" }))}
            {toggle("UAC declined", declines, setDeclines)}
            <Button size="xs" variant="outline" onClick={() => setWelcomes(welcomes + 1)}>
              replay welcome
            </Button>
          </div>
          <div className="space-x-1">
            {(["on", "off", "off-in-windows"] as const).map((one) => toggle(one, desktop.start_with_windows === one, () => setDesktop({ ...desktop, start_with_windows: one })))}
          </div>
          <div className="space-x-1">
            {toggle("current", desktop.update.state === "current", () => setDesktop({ ...desktop, update: DESKTOP.update }))}
            {toggle("checking", desktop.update.state === "checking", () => setDesktop({ ...desktop, update: { state: "checking" } }))}
            {toggle("downloading", desktop.update.state === "downloading", () => setDesktop({ ...desktop, update: { state: "downloading", next: "0.2.0", done: 42 } }))}
            {toggle("available", desktop.update.state === "available", () => setDesktop({ ...desktop, update: { state: "available", next: "0.2.0" } }))}
            {toggle("ready", desktop.update.state === "ready", () => setDesktop({ ...desktop, update: { state: "ready", next: "0.2.0" } }))}
            {toggle("failed", desktop.update.state === "failed", () => setDesktop({ ...desktop, update: { state: "failed", next: "0.2.0", error: "The connection dropped" } }))}
          </div>
        </div>
      </Root>
    </div>
  )
}

createRoot(document.getElementById("page") as HTMLElement).render(<Page />)
