// The welcome's bench: its window as Windows 11 draws ours, with no title bar, a hairline edge, rounded corners, and a shadow,
// on a desktop's color, with a picker for each of its states, which the page remembers across the reloads each edit brings.
//
//   node tools/dev.ts welcome

import { useState } from "react"
import { createRoot } from "react-dom/client"

import { Button, Root } from "@dualinput/ui"

import type { DesktopState } from "../../../engines/messages/ts/desktop/DesktopState.ts"
import type { DesktopLink, View } from "../src/link.ts"
import { Welcome, WELCOME_HEIGHT, type WelcomeStill } from "../src/welcome.tsx"

/** `WIDTH` in src/apps/desktop/src/screens.rs names the same one, so change both together. */
const WIDTH = 400
const REMEMBERED = "dualinput-welcome-bench"
/** A Windows desktop's color behind the window, so its edge shows. */
const DESKTOP_COLOR = "#2c4a66"

type Pick = "live" | "live-no-rule" | WelcomeStill | "firewall-waiting"

const PICKS: { pick: Pick; label: string }[] = [
  { pick: "live", label: "Live, rule missing" },
  { pick: "live-no-rule", label: "Live, rule in" },
  { pick: "greeting", label: "Greeting" },
  { pick: "firewall", label: "1 Firewall" },
  { pick: "firewall-waiting", label: "1 Waiting" },
  { pick: "firewall-declined", label: "1 Declined" },
  { pick: "tray", label: "2 Tray" },
  { pick: "efb", label: "3 EFB" },
]

/** What the page remembered, or the live flow. Storage can be missing or refuse, as in a private window, and then nothing's remembered. */
function remembered(): Pick {
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
    // Windows 11 rounds an undecorated window's corners, and gives it a hairline edge and its shadow. The kit's classes reach
    // only inside a root, so the frame and the page are styled inline.
    <div style={{ width: WIDTH, height: WELCOME_HEIGHT, overflow: "hidden", borderRadius: 8, boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 16px 48px rgba(0,0,0,0.5)" }}>
      <Root>
        <div className="bg-background text-[13px] leading-snug text-foreground">
          <Welcome view={view} link={link} read={() => Promise.resolve()} still={still} />
        </div>
      </Root>
    </div>
  )
}

function Page() {
  const [pick, setPick] = useState<Pick>(remembered)
  const [replays, setReplays] = useState(0)
  const choose = (next: Pick) => {
    remember(next)
    setPick(next)
    setReplays(replays + 1)
  }
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
    <div style={{ display: "flex", alignItems: "flex-start", minHeight: "100vh", boxSizing: "border-box", background: DESKTOP_COLOR, padding: 48 }}>
      <div key={`${pick}-${replays}`}>{still === undefined ? <LiveWindow ruleIn={pick === "live-no-rule"} /> : <Framed view={view} still={still} />}</div>
      <Root>
        <div className="ml-10 flex flex-col items-start space-y-1.5">
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
