// What every frame of the EFB app shares: its size, the header, the tab bar, the small label,
// and the frame that gives a page the theme and the preset's components.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleArrowUp, CircleX, ExternalLink, Headset, PersonStanding, Plane, Settings as Gear, TriangleAlert, Users } from "lucide-react"

import { ThemeContext, UI, UIContext, useUI } from "@/bench/ui"
import { themeVars, type Theme } from "@/bench/theme"
import { FailureBox, SERVICE_NOT_RUNNING } from "./failure"
import { ControlContext, SessionContext, TakeControl, type Control } from "./flight"
import { HeaderStart, PhaseContext, type SessionPhase, type Shared, type SharedFeature } from "./phase"
import { ARRIVE, MOMENT } from "./ease"

// The sim's EFB sizes its apps from a 516 by 716 base (record/areas/interface/log.md, 2026-10-24).
export const EFB = { width: 516, height: 716 }

// The version the frames run, an example, which the header's mark and an update's row both show.
const VERSION = "1.0.2"

export type Tab = "session" | "traffic" | "atc" | "avatars" | "settings"
const TABS: { id: Tab; icon: typeof Users; label: string }[] = [
  { id: "session", icon: Users, label: "Session" },
  { id: "traffic", icon: Plane, label: "Traffic" },
  { id: "atc", icon: Headset, label: "ATC audio" },
  { id: "avatars", icon: PersonStanding, label: "Avatars" },
  { id: "settings", icon: Gear, label: "Settings" },
]

// Dual Input's mark: two lines merging into one, two pilots' inputs flying one aircraft. The user
// picked it on 2026-10-28, from the marks of the 2026-10-24 apps design page.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" />
    </svg>
  )
}

// The mark cut out of a sky-300 tile, sized in em so the tile stands as tall as a capital letter
// beside it: Geist's capital D measured 0.75em tall. Set it on the text's baseline, which flexbox
// takes from the tile's bottom edge only while the tile has no content in flow, so the mark sits
// absolutely inside it. The stroke is heavier than the mark's own, since the mark inside is only
// about 10px at text-xl.
export function MarkTile() {
  return (
    <span className="relative inline-block shrink-0 rounded-[0.16em] bg-primary text-background" style={{ width: "0.75em", height: "0.75em" }}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden className="absolute inset-0 m-auto" style={{ width: "0.5em", height: "0.5em" }}>
        <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Label({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="text-xs text-muted-foreground" {...rest}>
      {children}
    </span>
  )
}

// A link inside a sentence, which does what it's given; one given nothing, such as "see how", opens
// nothing yet.
export function InlineLink({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        onClick?.()
      }}
      className="text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  )
}

// The header's status, which is only what needs the pilot: the PC offline, our servers not
// answering, Windows Firewall blocking Dual Input, and the version of an update that's ready.
// Neither the service nor the sim can fail while the header shows, since the app's window covers a
// lost service and the core's link to the sim ends only with the sim
// (record/areas/core/03-sim-seam-and-wasm-module.md); and whether Dual Input supports the loaded
// aircraft is home's to say.
export type HeaderStatus = {
  offline?: boolean
  servers?: "reachable" | "unreachable"
  firewall?: "allows" | "blocks"
  update?: string
}

type Tone = "bad" | "warn" | "news"
const TONE_ICON = {
  bad: <CircleX className="size-4 text-destructive" />,
  warn: <TriangleAlert className="size-4 text-warning" />,
  news: <CircleArrowUp className="size-4 text-primary" />,
}

// Each thing that needs the pilot, with the word the header's pill shows it by, and the title, the
// detail, and the action its row in the island gives it. The words follow setup's failures and
// home's refusals: the title says what's wrong, as the pilot sees it, and the detail what it costs.
type Issue = { tone: Tone; word: string; title: string; detail: string; action?: React.ReactNode }

// What a status shows, in the header's order. The PC offline stands in for our servers, since
// with no internet Dual Input can't tell whether they answer, as setup's check tells the two apart.
// Our servers are "can't reach", where a refusal's are "couldn't", since this is a state that lasts
// rather than one attempt.
// In a session each row says what it costs there (user, 2026-10-31). Offline cuts every link to the
// crew, so it stays an error, and the core reconnects and replays what was missed
// (record/areas/sync/03-catch-up.md, Replaying a short outage). A running session doesn't wait on
// the backend (record/areas/network/01-between-machines.md, Who does what), and a relayed link that
// drops shows on its crewmate's row, so our servers become a warning about joins. The links have
// their paths already, so the firewall becomes a warning too, and Fix stays, since a relayed link
// can go direct within a minute of the rule landing (inference, from iroh's 60s punch). An update
// restarts the sim, which would end the flight, so it waits until the session ends.
function issuesOf(status: HeaderStatus, Button: ReturnType<typeof useUI>["Button"], inSession = false): Issue[] {
  const issues: Issue[] = []
  if (status.offline)
    issues.push({
      tone: "bad",
      word: "Internet",
      title: "Your PC seems offline",
      detail: inSession ? "You've lost the connection to the others. When it's back, Dual Input will reconnect you and replay what you missed." : "Dual Input needs an internet connection to host or join.",
    })
  else if (status.servers === "unreachable")
    issues.push({
      tone: inSession ? "warn" : "bad",
      word: "Servers",
      title: "Can't reach our servers",
      detail: inSession ? "Pilots can't join or rejoin your session until our servers are back." : "Dual Input needs them to connect you and your crew.",
    })
  if (status.firewall === "blocks")
    issues.push({
      tone: inSession ? "warn" : "bad",
      word: "Firewall",
      title: "Windows Firewall is blocking Dual Input",
      detail: inSession ? "Connections may run through our relay servers, with more latency." : "You can still connect through our relay servers, but with more latency.",
      action: (
        <Button size="sm" variant="secondary" onClick={() => toast("Waiting for Windows")}>
          Fix
        </Button>
      ),
    })
  if (status.update && !inSession)
    issues.push({
      tone: "news",
      word: "Update",
      title: `Dual Input ${status.update} is ready`,
      detail: `You have ${VERSION}.`,
      // It opens Settings on its update section, where the update installs.
      action: (
        <Button size="sm" variant="secondary" onClick={() => toast("Opening the update in Settings")}>
          View update
        </Button>
      ),
    })
  return issues
}

// Under the rows when something's wrong, a way to people for a pilot our words haven't helped,
// which opens their browser on our Discord. An update alone is news, not trouble, so it gets no
// line, and a PC that's offline can't load the page, so then the line doesn't show either.
function HelpLine() {
  return (
    <p className="text-xs text-muted-foreground">
      Not sure what to do?{" "}
      <InlineLink onClick={() => toast("Opening our Discord in your browser")}>
        Ask on our Discord <ExternalLink className="inline size-3 align-[-1px]" />
      </InlineLink>
    </p>
  )
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0">{TONE_ICON[issue.tone]}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{issue.title}</span>
        <span className="text-xs text-muted-foreground">{issue.detail}</span>
      </span>
      {issue.action}
    </div>
  )
}

// How the header's status opens into its details, in milliseconds: after the pointer has rested on
// it this long, so a cursor passing over it on the way to Host or a tab doesn't flash it open, nor
// a VR pointer that wavers; and it closes this long after the pointer leaves, so moving down into
// it to press an action doesn't close it underneath. It grows on a curve that overshoots and
// settles, for a fluid feel, and shrinks on a plain one. Coherent GT has transitions and
// cubic-bezier(). Open, it's this many pixels wide, short of the window's 516, so it floats. The
// header is this many pixels tall, its mark and 32px pill centered in it, so the pill sits 11px
// from the window's top, as from its right, and a page starts 11px under the pill, with no top
// padding of its own.
const HEADER = { openAfter: 200, closeAfter: 300, grow: 260, shrink: 220, spring: "cubic-bezier(0.32, 1.18, 0.6, 1)", openWidth: 400, height: 54 }

// The header: the mark and version, then each thing that needs the pilot as a word and an icon,
// together in a pill. With nothing, it's the mark alone. While a session is in preflight or flying,
// its phase stands where the mark and version are (phase.tsx). Hovering the pill tints it, and resting
// there grows it from its top right corner, left and down, into an island of details over the
// window, a row for each with its action, if it has one, while the window dims under it. A press
// keeps it open, as does pressing anything in it, so its actions and their popovers don't close
// under the pointer; then a press elsewhere or Escape closes it. The copy is drafts.
export function Header({ status, startOpen, phase, shared = {}, inSession }: { status: HeaderStatus; startOpen?: boolean; phase?: SessionPhase; shared?: Shared; inSession?: boolean }) {
  const { Button } = useUI()
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(!!startOpen)
  const [pinned, setPinned] = useState(!!startOpen)
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const timer = useRef<number>(undefined)
  const later = (ms: number, f: () => void) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(f, ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // Coherent GT has no ResizeObserver, so the pill and the details are measured after every render.
  const [size, setSize] = useState({ pill: 0, panel: 0 })
  useLayoutEffect(() => {
    const pill = wrap.current?.offsetWidth ?? 0
    const h = panel.current?.offsetHeight ?? 0
    if (pill !== size.pill || h !== size.panel) setSize({ pill, panel: h })
  })
  const close = () => {
    setPinned(false)
    setOpen(false)
  }
  // A press elsewhere in the app's window closes a pinned panel, but not one in a popover an action
  // opened, which the kit draws at the document's root. Only the app's window counts, which in the
  // EFB is all there is, so on the frames canvas a press in another frame leaves this one open.
  useEffect(() => {
    if (!pinned) return
    const down = (e: MouseEvent) => {
      const t = e.target as Element
      const app = wrap.current?.closest("[data-app-frame]")
      if (app?.contains(t) && !wrap.current?.contains(t) && !t.closest?.("[data-slot=popover-content]")) close()
    }
    const key = (e: KeyboardEvent) => e.key === "Escape" && close()
    window.addEventListener("mousedown", down, true)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("mousedown", down, true)
      window.removeEventListener("keydown", key)
    }
  }, [pinned])

  const brand = (
    <HeaderStart
      phase={phase}
      shared={shared}
      brand={
        <div className="flex items-center gap-2">
          <Mark className="size-4 text-primary" />
          <span className="text-sm font-medium">Dual Input</span>
          <span className="text-xs text-muted-foreground">v{VERSION}</span>
        </div>
      }
    />
  )
  const rows = issuesOf(status, Button, inSession)
  const trouble = rows.some((r) => r.tone !== "news")
  // The mark lines up with the pages' 20px gutter.
  if (!rows.length)
    return (
      <div className="flex shrink-0 items-center gap-2 px-5 select-none" style={{ height: HEADER.height }}>
        {brand}
      </div>
    )

  const moving: React.CSSProperties = { transitionDuration: `${open ? HEADER.grow : HEADER.shrink}ms`, transitionTimingFunction: open ? HEADER.spring : "ease-in-out" }
  return (
    <>
      {/* The whole window dims under the open island, the mark too; pinned, it takes the press that
          closes it. */}
      <div className={"absolute top-0 right-0 bottom-0 left-0 z-20 bg-black/40 transition-opacity duration-200 " + (open ? "opacity-100" : "opacity-0") + (open && pinned ? "" : " pointer-events-none")} />
      {/* Both ends line up with the pages' 20px gutter: the mark, and the pill's last icon, 11px
          of the row's padding and 9px of the pill's. */}
      <div className="flex shrink-0 items-center gap-2 pr-[11px] pl-5 select-none" style={{ height: HEADER.height }}>
        {brand}
        {/* The pill's place in the row, which the hover goes by; the island grows out of it. */}
        <div
          ref={wrap}
          className="relative z-30 ml-auto"
          onMouseEnter={() => {
            setHovered(true)
            if (open) window.clearTimeout(timer.current)
            else later(HEADER.openAfter, () => setOpen(true))
          }}
          onMouseLeave={() => {
            setHovered(false)
            if (pinned) window.clearTimeout(timer.current)
            else later(HEADER.closeAfter, () => setOpen(false))
          }}
        >
          {/* The island: the pill's tint on hover, which grows from the top right corner, its
              corners tightening from the pill's half height to the details' 12px. The details sit
              at their open width from the start, anchored right, so growing uncovers them rather
              than reflowing them. */}
          <div
            className={"absolute top-0 right-0 overflow-hidden transition-[width,height,border-radius,background-color,box-shadow] " + (open ? "bg-popover shadow-xl" : hovered ? "bg-muted/60" : "")}
            style={{ ...moving, width: open ? HEADER.openWidth : size.pill, height: open ? 32 + size.panel : 32, borderRadius: open ? 12 : 16 }}
          >
            <div
              ref={panel}
              onMouseDown={() => setPinned(true)}
              className="absolute top-8 right-0 flex flex-col gap-3 px-4 pt-2 pb-4 transition-opacity"
              style={{ width: HEADER.openWidth, opacity: open ? 1 : 0, transitionDuration: open ? "160ms" : "100ms", transitionDelay: open ? "80ms" : "0ms" }}
            >
              {/* The details keep 16px from the island's sides and bottom, whatever the pill's own
                  padding, which fits its icons to its round end. */}
              {rows.map((r) => (
                <IssueRow key={r.word} issue={r} />
              ))}
              {!status.offline && trouble && <HelpLine />}
            </div>
          </div>
          {/* The last icon sits 9px from the pill's right, as from its top and bottom, (32 - 14) / 2,
              so it's concentric with the pill's round end. A VR pointer wavers, so while it rests,
              the pill takes hovers and presses past its edges, into the space around it no one
              aims at: up and right to the window's edges, down to the header's, and 12px left
              toward the mark. Open, the island is the target, so the margin goes, and a press on a
              row's edge doesn't close it. */}
          <button
            className={"relative flex h-8 cursor-pointer items-center gap-4 pr-[9px] pl-3 text-xs whitespace-nowrap outline-none " + (open ? "" : "before:absolute before:-top-[11px] before:-right-[11px] before:-bottom-[11px] before:-left-3")}
            aria-expanded={open}
            onClick={() => (pinned ? close() : (setPinned(true), setOpen(true)))}
          >
            {rows.map((r) => (
              <span key={r.word} className="flex items-center gap-1 text-muted-foreground">
                {r.word} <span className="[&_svg]:size-3.5">{TONE_ICON[r.tone]}</span>
              </span>
            ))}
          </button>
        </div>
      </div>
    </>
  )
}

// Every row the header's island can show, each under a line saying when, in a box of the island's
// width, colors, and padding, so each shows as it does there. The version is an example.
const EVERY_ISSUE: { when: string; status: HeaderStatus; inSession?: boolean }[] = [
  { when: "PC offline, in place of our servers", status: { offline: true } },
  { when: "Our servers down", status: { servers: "unreachable" } },
  { when: "Firewall blocking", status: { firewall: "blocks" } },
  { when: "Update ready, outside a session only", status: { update: "1.0.3" } },
  { when: "In a session: PC offline", status: { offline: true }, inSession: true },
  { when: "In a session: our servers down", status: { servers: "unreachable" }, inSession: true },
  { when: "In a session: firewall blocking", status: { firewall: "blocks" }, inSession: true },
]
function EveryIssueSheet() {
  const { Button } = useUI()
  return (
    <div className="p-5">
      <div className="mx-auto flex flex-col gap-6 rounded-xl bg-popover p-4 shadow-xl" style={{ width: HEADER.openWidth }}>
        {EVERY_ISSUE.map(({ when, status, inSession }) => (
          <div key={when} className="flex flex-col gap-2">
            <Label>{when}</Label>
            <IssueRow issue={issuesOf(status, Button, inSession)[0]} />
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <Label>Under the rows when something's wrong, unless the PC is offline</Label>
          <HelpLine />
        </div>
      </div>
    </div>
  )
}

// A tab whose page holds a warning shows an amber dot on its icon, on every page, so a pilot sees
// it from wherever they are: traffic's when a pack differs or a count of aircraft is above 0, ATC
// audio's when its capture waits for an ATC app (user, 2026-10-31). The page says so, as a session
// page says its phase. The dot is 8px at the icon's lower right, big enough to notice at an EFB's
// distance and no bigger (user, 2026-10-31; tried and dropped: 10px at the upper right), with a
// ring of the bar's own color parting it from the icon. It keeps to the page's moment (ease.tsx):
// it shrinks away with what goes, and springs in with what arrives, once the layout has moved.
export const DotContext = createContext<(tab: Tab, on: boolean) => void>(() => {})
export function useShowDot(tab: Tab, on: boolean) {
  const show = useContext(DotContext)
  useLayoutEffect(() => {
    show(tab, on)
  }, [show, tab, on])
  useLayoutEffect(() => () => show(tab, false), [show, tab])
}

// Who is sharing traffic and who is sharing ATC audio in this session, which the header shows
// beside the phase (phase.tsx). Whichever page is showing says what it knows, as with the dots.
export const SharedContext = createContext<(feature: SharedFeature, sharer: string | undefined) => void>(() => {})
export function useShowShared(feature: SharedFeature, sharer: string | undefined) {
  const show = useContext(SharedContext)
  useLayoutEffect(() => {
    show(feature, sharer)
  }, [show, feature, sharer])
  useLayoutEffect(() => () => show(feature, undefined), [show, feature])
}

export function TabBar({ active = "session", dots = {} }: { active?: Tab; dots?: Partial<Record<Tab, boolean>> }) {
  return (
    <nav className="flex h-14 shrink-0 border-t">
      {TABS.map(({ id, icon: Icon, label }) => (
        <button key={id} title={label} className={"relative flex flex-1 items-center justify-center outline-none hover:text-foreground " + (id === active ? "text-primary" : "text-muted-foreground")}>
          {id === active && <span className="absolute inset-x-4 -top-px h-0.5 rounded-full bg-primary" />}
          <span className="relative flex">
            <Icon className="size-5" />
            <span aria-label={dots[id] ? "Needs attention" : undefined} aria-hidden={!dots[id]} className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-warning ring-2 ring-background" style={{ opacity: dots[id] ? 1 : 0, transform: dots[id] ? "none" : "scale(0.4)", transition: dots[id] ? `opacity 180ms ease-out ${ARRIVE}ms, transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1) ${ARRIVE}ms` : `opacity ${MOMENT.out}ms ease-in, transform ${MOMENT.out}ms ease-in` }} />
          </span>
        </button>
      ))}
    </nav>
  )
}

// The EFB app's link to the core, Dual Input's service, which page-client gives the app
// (record/areas/interface/01-apps.md, When the core goes). A socket that closed without a `bye`, or
// 8s of silence, is reconnecting, since the tray app starts a crashed core again 2s after it exits;
// no core heard, or still none 10s into reconnecting, is not running; and a `bye` is closed, since
// the pilot quit it.
export type Core = "connected" | "reconnecting" | "not-running" | "closed"

// While it reconnects, the window dims under a line saying so, and takes presses, since every
// command would fail; most reconnects take a few seconds, so the page stays under it as it was.
// It fades in and out, mounted while it shows.
function Reconnecting({ on }: { on: boolean }) {
  const { Spinner } = useUI()
  const [shown, setShown] = useState(on)
  useEffect(() => {
    if (on) return setShown(true)
    const t = window.setTimeout(() => setShown(false), 200)
    return () => window.clearTimeout(t)
  }, [on])
  if (!shown) return null
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 z-40 flex animate-in items-center justify-center bg-black/50 transition-opacity duration-200 fade-in" style={{ opacity: on ? 1 : 0 }}>
      <div className="flex items-center gap-2.5 rounded-full border border-foreground/10 bg-popover py-2.5 pr-5 pl-4 text-sm shadow-xl">
        <Spinner className="size-4 text-muted-foreground" /> Reconnecting to the Dual Input service
      </div>
    </div>
  )
}

// With no service, no page works, so the window shows only why, with the header's mark alone and
// no tabs: setup's failure when it isn't running, and when the pilot quit it, which is no
// failure, the way back in plain words. The app comes back by itself once the service starts.
function ServiceDown({ closed }: { closed: boolean }) {
  return (
    // As much room under it as the header takes above, so it centers in the window.
    <div className="flex flex-1 animate-in flex-col items-center justify-center px-12 text-center duration-300 fade-in" style={{ paddingBottom: HEADER.height }}>
      {closed ? (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">Dual Input is closed</p>
          <p className="text-sm text-muted-foreground">Open it from the Start menu to fly together.</p>
        </div>
      ) : (
        <FailureBox failure={SERVICE_NOT_RUNNING} />
      )}
    </div>
  )
}

// A frame of the EFB app. It's the EFB's height at least, and grows past it for a page that
// shows more than one screen holds, such as the preflight page with the UI kit. A fixed frame
// stays at the EFB's height, as the EFB's window does, for a page that scrolls part of itself.
// It's marked data-app-frame, the app's window, which a popup opens inside. A frame can open with
// the header's details out, and say how its link to the service stands. A session page in it says
// its phase, which the frame hands to the header, whether a session is held, which the header's
// rows read, and once the flight starts, how control stands, which the frame draws under the tabs
// on every page (flight.tsx). A frame can open on a tab other than the session's.
export function AppFrame({ theme, status = {}, header = true, tabs = true, tab, fixed, headerOpen, core = "connected", children }: { theme: Theme; status?: HeaderStatus; header?: boolean; tabs?: boolean; tab?: Tab; fixed?: boolean; headerOpen?: boolean; core?: Core; children?: React.ReactNode }) {
  const ui = UI[theme.preset] ?? UI.nova
  const down = core === "not-running" || core === "closed"
  const [phase, setPhase] = useState<SessionPhase>()
  const [inSession, setInSession] = useState(false)
  const [control, setControl] = useState<Control>()
  const [dots, setDots] = useState<Partial<Record<Tab, boolean>>>({})
  const showDot = useCallback((tab: Tab, on: boolean) => setDots((d) => (!!d[tab] === on ? d : { ...d, [tab]: on })), [])
  const [shared, setShared] = useState<Shared>({})
  const showShared = useCallback((feature: SharedFeature, sharer: string | undefined) => setShared((d) => (d[feature] === sharer ? d : { ...d, [feature]: sharer })), [])
  return (
    <ThemeContext.Provider value={theme}>
      <UIContext.Provider value={ui}>
      <PhaseContext.Provider value={setPhase}>
      <SessionContext.Provider value={setInSession}>
      <ControlContext.Provider value={setControl}>
      <DotContext.Provider value={showDot}>
      <SharedContext.Provider value={showShared}>
        <div
          data-app-frame
          className="dark relative flex flex-col overflow-hidden rounded-xl border bg-background font-sans text-foreground shadow-2xl"
          style={{ ...(themeVars(theme) as React.CSSProperties), width: EFB.width, ...(fixed ? { height: EFB.height } : { minHeight: EFB.height }) }}
        >
          {header && <Header status={down ? {} : status} startOpen={headerOpen} phase={down ? undefined : phase} shared={down ? {} : shared} inSession={!down && inSession} />}
          <div className="flex min-h-0 flex-1 flex-col">{down ? <ServiceDown closed={core === "closed"} /> : children}</div>
          {tabs && !down && <TabBar active={tab} dots={dots} />}
          {tabs && !down && <TakeControl control={control} />}
          {!down && <Reconnecting on={core === "reconnecting"} />}
        </div>
      </SharedContext.Provider>
      </DotContext.Provider>
      </ControlContext.Provider>
      </SessionContext.Provider>
      </PhaseContext.Provider>
      </UIContext.Provider>
    </ThemeContext.Provider>
  )
}

// The sheet takes the kit from the frame's context, so it's drawn inside the frame.
export function EveryIssueFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <EveryIssueSheet />
    </AppFrame>
  )
}
