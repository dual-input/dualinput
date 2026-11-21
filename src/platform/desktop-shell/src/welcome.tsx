// The first run's welcome: a greeting, then the firewall rule, where the app lives, and where to find it in the sim, one
// step at a time in a small window with no title bar and no close button, since three short steps ask little, and Alt+F4 or
// the taskbar still close it (record/areas/interface/decisions.md, "The desktop app shows
// Velopack's windows and its own figures, and the build designs the rest").

import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { ALONE, Button, cx, GLYPH, glyphBox, Mark, MarkTile, MOMENT, part, Spinner, useMoment } from "@dualinput/ui"
import { ChevronUp, Monitor, ShieldAlert, ShieldCheck, Volume2, Wifi } from "lucide-react"

import type { DesktopLink, View } from "./link.ts"

/** How long the greeting holds and fades. Setup in the EFB app, src/platform/efb-shell/src/setup/setup-flow.tsx, draws the same greeting with the same timings, so change both together. */
const GREETING = { hold: 1600, out: 450 }
/** The window's height, the same on every step, so nothing jumps as the pilot steps through. */
export const WELCOME_HEIGHT = 344
/** How often the window reads the firewall again while Windows asks the pilot. */
const READ_WHILE_FIXING = 400

type Step = "firewall" | "tray" | "efb"

/** A state the welcome holds still in, for its bench in src/platform/desktop-shell/dev/welcome.tsx, which picks one to look at. */
export type WelcomeStill = "greeting" | Step | "firewall-declined"

/**
 * Our app's button in the sim's EFB, as the pilot finds it there: the EFB's own tile, 64px with 5px corners and a gradient,
 * around the white glyph that src/sim-package/pages/efb-icon.svg gives it (read in fs-base-efb 0.1.10,
 * html_ui/efb_ui/efb_os/efb_os.css, `.app-button > .icon-button.icon`).
 */
const EFB_TILE = { side: 64, radius: 5, background: "linear-gradient(to right top, #144893 0%, #1e2836 100%)" }

function EfbAppIcon({ size }: { size: number }) {
  const scale = size / EFB_TILE.side
  const { viewBox, aspect } = glyphBox(ALONE.stroke)
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: EFB_TILE.radius * scale, background: EFB_TILE.background }} aria-hidden>
      <svg viewBox={viewBox} width={ALONE.efbWidth * scale} height={ALONE.efbWidth * scale * aspect}>
        <path d={GLYPH} fill="none" stroke="#ffffff" strokeWidth={ALONE.stroke} strokeLinecap="round" />
      </svg>
    </span>
  )
}

/** Lucide's monitor is 24 units tall with its screen's middle at 10, where the line between the two PCs runs. */
const MONITOR = 44
const SCREEN_MIDDLE = (MONITOR * 10) / 24
const SHIELD = 30

/**
 * Two pilots' PCs joined by a line, with Windows Firewall's shield on it, checked, as the rule lets the line through, or, once
 * the pilot declined the prompt, amber with an exclamation mark, as the line under it is.
 */
function FirewallPicture({ declined }: { declined: boolean }) {
  const Shield = declined ? ShieldAlert : ShieldCheck
  return (
    <div className="flex items-center">
      <Monitor className="shrink-0 text-muted-foreground" strokeWidth={1.5} style={{ width: MONITOR, height: MONITOR }} />
      <div className="relative mx-1.5 flex w-24 justify-center" style={{ height: MONITOR }}>
        <span className="absolute inset-x-0 h-0.5 rounded-full bg-muted-foreground" style={{ top: SCREEN_MIDDLE - 1 }} />
        {/* Filled with the window's background, so the line runs into the shield rather than across it. */}
        <Shield className={cx("absolute fill-background transition-colors", declined ? "text-warning" : "text-primary")} strokeWidth={1.5} style={{ width: SHIELD, height: SHIELD, top: SCREEN_MIDDLE - SHIELD / 2 }} />
      </div>
      <Monitor className="shrink-0 text-muted-foreground" strokeWidth={1.5} style={{ width: MONITOR, height: MONITOR }} />
    </div>
  )
}
/** An icon in the tray's hidden icons, 16px as Windows draws them, which a stand-in gray square fills for other apps. */
const TRAY_ICON = 16
/** The taskbar's corner, wide enough for the chevron, two glyphs, and the clock. */
const TASKBAR = 140
/** The chevron's middle, 19px into the taskbar: 6px of padding, a 1px edge, and half its 24px button. */
const CHEVRON_MIDDLE = 19

/**
 * The corner of Windows 11's taskbar, with the hidden icons opened above the chevron and ours among them. Our icon, the
 * picture's subject, sits in the flyout's middle column on the picture's middle line, the chevron right under it, and the
 * taskbar runs off to the right of it, as Windows draws it.
 */
function TrayPicture() {
  const icons = [false, true, false, false, false, false]
  return (
    <div className="flex flex-col items-center">
      <div className="mb-1.5 grid grid-cols-3 rounded-lg border border-border bg-muted shadow-lg" style={{ gap: 10, padding: 10 }}>
        {icons.map((ours, index) =>
          ours ? (
            <span key={index} className="flex items-center justify-center rounded-[3px] bg-primary text-background ring-2 ring-primary/60 ring-offset-2 ring-offset-muted" style={{ width: TRAY_ICON, height: TRAY_ICON }}>
              <Mark className="size-3" />
            </span>
          ) : (
            <span key={index} className="rounded-[3px] bg-foreground/20" style={{ width: TRAY_ICON, height: TRAY_ICON }} />
          ),
        )}
      </div>
      {/* Centered, the taskbar's middle would be under the flyout's, so it moves right until the chevron's is. */}
      <div className="flex h-9 items-center rounded-md border border-border bg-muted/60 pl-1.5 pr-3 text-[11px] text-foreground/80" style={{ width: TASKBAR, transform: `translateX(${TASKBAR / 2 - CHEVRON_MIDDLE}px)` }}>
        {/* Pressed, since its flyout is open. */}
        <span className="mr-3 flex size-6 shrink-0 items-center justify-center rounded bg-foreground/10">
          <ChevronUp className="size-3.5" />
        </span>
        <Wifi className="mr-2 size-3.5 shrink-0" />
        <Volume2 className="mr-3 size-3.5 shrink-0" />
        <span>14:05</span>
      </div>
    </div>
  )
}
function EfbPicture() {
  return (
    <div className="flex items-center">
      <kbd className="flex h-11 items-center rounded-lg border border-b-4 border-border bg-muted px-4 font-sans text-base font-medium text-foreground">Tab</kbd>
      <span className="mx-4 text-lg text-muted-foreground">+</span>
      <EfbAppIcon size={52} />
    </div>
  )
}

/** One step's words, which change in the page's moment. */
function Words({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <>
      <h1 className="text-base font-medium">{heading}</h1>
      <div className="mt-1.5 text-foreground/80">{children}</div>
    </>
  )
}

export function Welcome({ view, link, read, still }: { view: View; link: DesktopLink; read: () => Promise<void>; still?: WelcomeStill }) {
  // The firewall's step shows only when the rules need mending as the welcome opens: a reinstall finds the rule an
  // uninstall left behind.
  const [steps] = useState<Step[]>(() => (view.desktop.firewall === "blocks" ? ["firewall", "tray", "efb"] : ["tray", "efb"]))
  const [greeting, setGreeting] = useState<"in" | "out" | "gone">(still === undefined || still === "greeting" ? "in" : "gone")
  const [at, setAt] = useState(() => Math.max(0, steps.indexOf(still === "firewall-declined" ? "firewall" : (still as Step))))
  const [asked, setAsked] = useState(still === "firewall-declined")
  const step = steps[at]!
  // Nothing's layout moves between steps, so the next follows the last's fade two frames later, rather than waiting out the
  // kit's move, which left the window blank for a beat.
  const moment = useMoment(step, step, 2 * 16)
  // The first step rises in as each later one does, rather than appearing whole once the greeting has gone.
  const [first] = useState(at)
  const entering = at === first
  const shown = moment.shown

  useEffect(() => {
    if (still !== undefined) return
    const timers = [window.setTimeout(() => setGreeting("out"), GREETING.hold), window.setTimeout(() => setGreeting("gone"), GREETING.hold + GREETING.out)]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [still])

  // While Windows asks the pilot, the window reads again often, so the step moves on as soon as the rule is in.
  const fixing = view.fixingFirewall
  useEffect(() => {
    if (!fixing) return
    const every = window.setInterval(read, READ_WHILE_FIXING)
    return () => window.clearInterval(every)
  }, [fixing, read])
  const mended = useRef(false)
  useEffect(() => {
    if (step === "firewall" && view.desktop.firewall === "allows" && !mended.current) {
      mended.current = true
      setAt((now) => now + 1)
    }
  }, [step, view.desktop.firewall])
  const declined = step === "firewall" && asked && !fixing && view.desktop.firewall === "blocks"

  const next = () => (at + 1 < steps.length ? setAt(at + 1) : link.close())
  // The step takes the rule still missing with no fix running for a declined prompt, and the view it holds was read before the
  // click, so the step counts the ask only once a view read after the Rust side took it has come, which shows the fix running.
  const fix = () => {
    void link
      .ask({ t: "fix-firewall" })
      .then(read)
      .then(() => setAsked(true))
  }

  const style = (order: number) =>
    entering && moment.stage === "idle" ? { animation: `dualinput-rise-in ${MOMENT.in}ms ease-out ${order * MOMENT.step}ms both` } : part(moment.stage, true, order)
  return (
    <div
      className="flex select-none flex-col p-5"
      style={{ height: WELCOME_HEIGHT }}
      // With no title bar, the window moves by anything but a button, as it would by Windows' own bar.
      onMouseDown={(event) => {
        if (event.button === 0 && !(event.target as HTMLElement).closest("button")) link.drag()
      }}
    >
      {greeting !== "gone" ? (
        <div className="flex flex-1 items-center justify-center" style={{ opacity: greeting === "out" ? 0 : 1, transition: `opacity ${GREETING.out}ms ease-out` }}>
          <h1 className="flex items-baseline text-2xl font-semibold" style={{ animation: "dualinput-rise-in 700ms ease-out" }}>
            <span className="mr-2">Welcome to</span>
            <span className="flex items-baseline text-primary">
              <span className="mr-1.5">
                <MarkTile />
              </span>
              Dual Input
            </span>
          </h1>
        </div>
      ) : (
        <>
          {/* The picture and the words, as one block about the middle of the whole window, footer included: what's left over
          above the footer splits 2 to 1. Centered between the window's top and the footer, it read as sitting high. */}
          <div className="flex min-h-0 flex-1 flex-col">
          <div style={{ flex: 2 }} />
          <div className="pointer-events-none flex shrink-0 justify-center" style={style(0)}>
            {shown === "firewall" && <FirewallPicture declined={declined} />}
            {shown === "tray" && <TrayPicture />}
            {shown === "efb" && <EfbPicture />}
          </div>
          {/* One gap under every picture, whatever its height, as the tray's tall one had. */}
          <div className="mt-4 text-center" style={style(1)}>
            {shown === "firewall" && (
              <Words heading="Let other pilots reach you">
                Dual Input adds a Windows Firewall rule so other pilots can connect to you directly. Windows will ask for your permission.
                {declined && <p className="mt-3 text-xs text-warning">Windows didn't add the rule. You can still connect through our relay servers, but with more latency.</p>}
              </Words>
            )}
            {shown === "tray" && (
              <Words heading="Dual Input lives in your tray">
                It starts with Windows and gets everything ready every time you start the sim. In the background, it uses about 5 MB of memory and practically no CPU.
              </Words>
            )}
            {shown === "efb" && (
              <Words heading="Fly from the EFB">
                In the sim, press Tab, then open Dual Input. It works at the world map and in any flight.
                <p className="mt-3 text-xs text-muted-foreground">Don't see it? Restart the sim.</p>
              </Words>
            )}
          </div>
          <div style={{ flex: 1 }} />
          </div>
          <div className="mt-3 flex shrink-0 items-center justify-between">
            {/* A small button is 32px tall, and the dots sit level with its middle, so they're inset as far from the left as from the bottom. */}
            <div className="flex" style={{ marginLeft: (32 - 6) / 2 }}>
              {steps.map((one, index) => (
                <span key={one} className={cx("mr-1.5 size-1.5 rounded-full transition-colors", index === at ? "bg-primary" : "bg-foreground/20")} />
              ))}
            </div>
            <div className="flex" style={style(2)}>
              {/* The rule can wait, and the EFB app's header offers it again, so the step never makes a pilot turn Windows down to pass. */}
              {shown === "firewall" && (
                <Button size="sm" variant="ghost" className="mr-2" disabled={fixing} onClick={next}>
                  Not now
                </Button>
              )}
              {shown === "firewall" && (
                <Button size="sm" disabled={fixing} onClick={fix}>
                  {fixing ? (
                    <>
                      <Spinner className="mr-1.5 size-3.5" />
                      Waiting for Windows
                    </>
                  ) : declined ? (
                    "Try again"
                  ) : (
                    "Add the rule"
                  )}
                </Button>
              )}
              {shown === "tray" && (
                <Button size="sm" onClick={next}>
                  Next
                </Button>
              )}
              {shown === "efb" && (
                <Button size="sm" onClick={next}>
                  Done
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
