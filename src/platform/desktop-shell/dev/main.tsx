// The desktop app's window with no app behind it, a day of figures standing in, its named scenes, and toggles to look at it
// in any state between them. A scene named in the address, as `?scene=Quit`, is the one it starts on, so
// tools/screenshots.ts can take a picture of each with no jump from another.

import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import { Button, Root } from "@dualinput/ui"

import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { DesktopLink, Sample, Screen, Usage, View } from "../src/link.ts"
import { DesktopWindow } from "../src/window.tsx"
import { DESKTOP_COLOR, WindowOnDesktop } from "./frame.tsx"

const MB = 1024 * 1024
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

/** What a scene sets: the screen, what the app knows of the sim and the session, the window's first minutes, and its state. */
type State = { screen: Screen; simRunning: boolean; sessionHeld: boolean; fresh: boolean; desktop: DesktopState }
const START: State = { screen: "main", simRunning: false, sessionHeld: false, fresh: false, desktop: DESKTOP }
const update = (to: DesktopState["update"]) => ({ desktop: { ...DESKTOP, update: to } })

/** Each state a person looks at, by name, with what it sets on top of the main screen with nothing to report. */
const SCENES: Record<string, Partial<State>> = {
  Main: {},
  "Main, first minutes": { fresh: true },
  "Main, checking for an update": update({ state: "checking" }),
  "Main, downloading an update": update({ state: "downloading", next: "0.2.0", done: 42 }),
  "Main, update ready": update({ state: "ready", next: "0.2.0" }),
  "Main, update waits for the sim": { ...update({ state: "ready", next: "0.2.0" }), simRunning: true },
  "Main, update waits for the session": { ...update({ state: "ready", next: "0.2.0" }), simRunning: true, sessionHeld: true },
  "Main, update failed": update({ state: "failed", next: "0.2.0", error: "The connection dropped" }),
  "Main, Start with Windows off": { desktop: { ...DESKTOP, start_with_windows: "off" } },
  "Main, turned off in Windows": { desktop: { ...DESKTOP, start_with_windows: "off-in-windows" } },
  Quit: { screen: "quit" },
  "Quit, sim running": { screen: "quit", simRunning: true },
  "Quit, in a session": { screen: "quit", simRunning: true, sessionHeld: true },
}

const asked = new URLSearchParams(window.location.search).get("scene")
const FIRST = asked !== null && asked in SCENES ? asked : "Main"

function Page() {
  const [state, setState] = useState<State>({ ...START, ...SCENES[FIRST] })
  const [scene, setScene] = useState(FIRST)
  const [fixing, setFixing] = useState(false)
  const [declines, setDeclines] = useState(false)
  const [welcomes, setWelcomes] = useState(0)
  const [height, setHeight] = useState(0)
  const shot = useRef<HTMLDivElement>(null)
  const { screen, simRunning, sessionHeld, fresh, desktop } = state
  const change = (changes: Partial<State>) => setState({ ...state, ...changes })
  const setUpdate = (to: DesktopState["update"]) => change({ desktop: { ...desktop, update: to } })
  const show = (name: string) => {
    setState({ ...START, ...SCENES[name] })
    setScene(name)
  }
  const view: View = { screen, usage: fresh ? OPENED_MOMENTS_AGO : aDay(), desktop, simRunning, sessionHeld, fixingFirewall: fixing }
  const link: DesktopLink = {
    view: () => Promise.resolve(view),
    ask: (ask) => {
      if (ask.t === "set-start-with-windows") change({ desktop: { ...desktop, start_with_windows: ask.on ? "on" : "off" } })
      // Windows' UAC prompt, which the pilot answers 2s later, yes unless "declines" is on.
      if (ask.t === "fix-firewall") {
        setFixing(true)
        window.setTimeout(() => {
          setFixing(false)
          if (!declines) change({ desktop: { ...desktop, firewall: "allows" } })
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
  // The handle tools/screenshots.ts drives: the scenes by name, a jump to one, and the element its picture is of.
  useEffect(() => {
    Object.assign(window, { DUALINPUT_DEV: { scenes: Object.keys(SCENES), show, shot: shot.current } })
  })
  return (
    // The kit's classes reach only inside a root, so the page around the window is styled inline.
    <div style={{ display: "flex", background: DESKTOP_COLOR, minHeight: "100vh", alignItems: "flex-start" }}>
      {/* A new key per state, since the window reads its link once a poll, and this should show at once. */}
      <WindowOnDesktop height={height || undefined} shot={shot}>
        <div key={JSON.stringify(screen === "welcome" ? [screen, welcomes] : state)}>
          <DesktopWindow version="0.1.0" link={link} />
        </div>
      </WindowOnDesktop>
      <Root>
        <div className="ml-6 space-y-2 p-4 text-sm text-foreground">
          <div className="flex max-w-xl flex-wrap">
            {Object.keys(SCENES).map((name) => (
              <Button key={name} size="xs" variant={name === scene ? "default" : "ghost"} className="mb-1 mr-1" onClick={() => show(name)}>
                {name}
              </Button>
            ))}
          </div>
          <div className="text-muted-foreground">Window height: {height}px</div>
          <div className="space-x-1">
            {(["main", "quit", "welcome"] as const).map((one) => toggle(one, screen === one, () => change({ screen: one })))}
          </div>
          <div className="space-x-1">
            {toggle("sim running", simRunning, (on) => change({ simRunning: on }))}
            {toggle("in a session", sessionHeld, (on) => change({ sessionHeld: on }))}
            {toggle("first minutes", fresh, (on) => change({ fresh: on }))}
          </div>
          <div className="space-x-1">
            {toggle("firewall blocks", desktop.firewall === "blocks", (on) => change({ desktop: { ...desktop, firewall: on ? "blocks" : "allows" } }))}
            {toggle("UAC declined", declines, setDeclines)}
            <Button size="xs" variant="outline" onClick={() => setWelcomes(welcomes + 1)}>
              replay welcome
            </Button>
          </div>
          <div className="space-x-1">
            {(["on", "off", "off-in-windows"] as const).map((one) => toggle(one, desktop.start_with_windows === one, () => change({ desktop: { ...desktop, start_with_windows: one } })))}
          </div>
          <div className="space-x-1">
            {toggle("current", desktop.update.state === "current", () => setUpdate(DESKTOP.update))}
            {toggle("checking", desktop.update.state === "checking", () => setUpdate({ state: "checking" }))}
            {toggle("downloading", desktop.update.state === "downloading", () => setUpdate({ state: "downloading", next: "0.2.0", done: 42 }))}
            {toggle("available", desktop.update.state === "available", () => setUpdate({ state: "available", next: "0.2.0" }))}
            {toggle("ready", desktop.update.state === "ready", () => setUpdate({ state: "ready", next: "0.2.0" }))}
            {toggle("failed", desktop.update.state === "failed", () => setUpdate({ state: "failed", next: "0.2.0", error: "The connection dropped" }))}
          </div>
        </div>
      </Root>
    </div>
  )
}

createRoot(document.getElementById("page") as HTMLElement).render(<Page />)
