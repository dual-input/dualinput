// The welcome's bench: its window as Windows 11 draws ours, on a desktop's color, with a picker for each of its states, which
// the page remembers across the reloads each edit brings. The states it holds still in are its scenes, and a scene named in
// the address, as `?scene=Tray`, is the one it starts on, so tools/screenshots.ts can take a picture of each.
//
//   node tools/dev.ts welcome

import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import { Button, Root } from "@dualinput/ui"

import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { DesktopLink, View } from "../src/link.ts"
import { Welcome, WELCOME_HEIGHT, type WelcomeStill } from "../src/welcome.tsx"
import { DESKTOP_COLOR, WindowOnDesktop } from "./frame.tsx"

const REMEMBERED = "dualinput-welcome-bench"

type Pick = "live" | "live-no-rule" | WelcomeStill | "firewall-waiting"

/** Each pick, and the scene's name of each that holds still. */
const PICKS: { pick: Pick; label: string; scene?: string }[] = [
  { pick: "live", label: "Live, rule missing" },
  { pick: "live-no-rule", label: "Live, rule in" },
  { pick: "greeting", label: "Greeting", scene: "Greeting" },
  { pick: "firewall", label: "1 Firewall", scene: "Firewall" },
  { pick: "firewall-waiting", label: "1 Waiting", scene: "Firewall, waiting for Windows" },
  { pick: "firewall-declined", label: "1 Declined", scene: "Firewall, declined" },
  { pick: "tray", label: "2 Tray", scene: "Tray" },
  { pick: "efb", label: "3 EFB", scene: "EFB" },
]

/** The scene the address names, or what the page remembered, or the live flow. Storage can be missing or refuse, as in a private window, and then nothing's remembered. */
function first(): Pick {
  const asked = new URLSearchParams(window.location.search).get("scene")
  const named = PICKS.find((one) => one.scene !== undefined && one.scene === asked)
  if (named) return named.pick
  try {
    const held = window.localStorage.getItem(REMEMBERED)
    return PICKS.some((one) => one.pick === held) ? (held as Pick) : "live"
  } catch {
    return "live"
  }
}

function remember(pick: Pick): void {
  try {
    window.localStorage.setItem(REMEMBERED, pick)
  } catch {
    // Nothing's remembered, and the page still works.
  }
}

const QUIET: DesktopState = { update: { state: "current", checked: null }, firewall: "blocks", start_with_windows: "on" }

/** The live flow's window, whose firewall step's prompt the pilot answers yes 2s after Add the rule. */
function LiveWindow({ ruleIn }: { ruleIn: boolean }) {
  const [desktop, setDesktop] = useState<DesktopState>({ ...QUIET, firewall: ruleIn ? "allows" : "blocks" })
  const [fixing, setFixing] = useState(false)
  const view: View = { screen: "welcome", usage: { samples: [], windowOpened: [], updateDownloaded: [], now: 0 }, desktop, simRunning: false, sessionHeld: false, fixingFirewall: fixing }
  return <Framed view={view} onFix={() => {
    setFixing(true)
    window.setTimeout(() => {
      setFixing(false)
      setDesktop({ ...desktop, firewall: "allows" })
    }, 2000)
  }} />
}

function Framed({ view, still, onFix }: { view: View; still?: WelcomeStill; onFix?: () => void }) {
  const link: DesktopLink = {
    view: () => Promise.resolve(view),
    ask: (ask) => {
      if (ask.t === "fix-firewall") onFix?.()
      return Promise.resolve()
    },
    fit: (height) => Promise.resolve(height),
    drag: () => undefined,
    close: () => undefined,
    quit: () => undefined,
  }
  return (
    <Root>
      <div className="bg-background text-[13px] leading-snug text-foreground">
        <Welcome view={view} link={link} read={() => Promise.resolve()} still={still} />
      </div>
    </Root>
  )
}

function Page() {
  const [pick, setPick] = useState<Pick>(first)
  const [replays, setReplays] = useState(0)
  const shot = useRef<HTMLDivElement>(null)
  const choose = (next: Pick) => {
    remember(next)
    setPick(next)
    setReplays(replays + 1)
  }
  // The handle tools/screenshots.ts drives: the scenes by name, a jump to one, and the element its picture is of.
  useEffect(() => {
    const scenes = PICKS.filter((one) => one.scene !== undefined)
    Object.assign(window, { DUALINPUT_DEV: { scenes: scenes.map((one) => one.scene), show: (name: string) => choose(scenes.find((one) => one.scene === name)!.pick), shot: shot.current } })
  })
  const still = pick === "live" || pick === "live-no-rule" ? undefined : pick === "firewall-waiting" ? "firewall" : pick
  const view: View = {
    screen: "welcome",
    usage: { samples: [], windowOpened: [], updateDownloaded: [], now: 0 },
    desktop: { ...QUIET, firewall: still === "tray" || still === "efb" ? "allows" : "blocks" },
    simRunning: false,
    sessionHeld: false,
    fixingFirewall: pick === "firewall-waiting",
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-start", minHeight: "100vh", boxSizing: "border-box", background: DESKTOP_COLOR, padding: 8 }}>
      <WindowOnDesktop height={WELCOME_HEIGHT} shot={shot}>
        <div key={`${pick}-${replays}`}>{still === undefined ? <LiveWindow ruleIn={pick === "live-no-rule"} /> : <Framed view={view} still={still} />}</div>
      </WindowOnDesktop>
      <Root>
        <div className="ml-10 mt-10 flex flex-col items-start space-y-1.5">
          {PICKS.map((one) => (
            <Button key={one.pick} size="xs" variant={pick === one.pick ? "default" : "outline"} onClick={() => choose(one.pick)}>
              {one.label}
            </Button>
          ))}
          <Button size="xs" variant="secondary" className="!mt-4" onClick={() => setReplays(replays + 1)}>
            Replay
          </Button>
        </div>
      </Root>
    </div>
  )
}

createRoot(document.getElementById("page") as HTMLElement).render(<Page />)
