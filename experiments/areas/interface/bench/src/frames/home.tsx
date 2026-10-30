// The EFB app's home page, designed from the user's sketch of 2026-10-26: the start card, then on a
// pilot's first visit a short guide to how a session works that ends on the aircraft check, and on
// later visits the profile authors' notes. The aircraft and the notes are examples.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowRightLeft, BookOpen, Check, CircleCheck, CircleX, Copy, ExternalLink, Hand, LogOut, Maximize2, Minimize2, TriangleAlert, X } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { StatusChip } from "@/bench/screens"
import { AppFrame, InlineLink, Label, type Core, type HeaderStatus } from "./shell"
import { FIGURE_COLORS } from "./figure-portrait"
import { StandingFigure } from "./figure-standing"
import { ConfirmButton, RESTART_SIM } from "./confirm"
import { AircraftContext, AircraftPicker, LOADED, LOADED_UNSUPPORTED, PROFILES, type Aircraft } from "./aircraft"
import { useScroller } from "./scroller"
import { EmptyHead, Head } from "./figure-head"


// How hosting and joining can be refused: either one when the PC seems offline, which Windows
// reports, with the words of the header's row and setup's check for it, and when our servers don't
// answer; and joining with the four refusals the backend's lookup gives
// (record/areas/network/02-units.md, Its requests). The words are drafts, and the versions and the
// time are examples: the count of wrong codes is per clock hour, so the pause ends on the next hour.
const REFUSALS = {
  offline: { title: "Your PC seems offline", detail: "Dual Input needs the internet to connect you and your crew. Check your connection and try again?" },
  servers: { title: "Couldn't reach our servers", detail: "Dual Input needs them to connect you and your crew. Try again in a moment." },
  "no-code": { title: "No session has this code", detail: "Check it with your host and try again." },
  "you-older": { title: "Your Dual Input is older than the host's", detail: "Your host has 1.0.3 while you have 1.0.2.", action: { label: "Restart the sim to update", ...RESTART_SIM } },
  "host-older": { title: "The host's Dual Input is older than yours", detail: "Your host has 1.0.1 while you have 1.0.2. They need to update before you can join." },
  "too-many": { title: "Too many wrong codes", detail: "You are being rate limited because you've tried too many wrong codes in an hour. Joining is paused until 15:00. If you think this is a mistake, please contact us on our Discord." },
}
type Refusal = keyof typeof REFUSALS
// When each refusal shows, for the sheet that lays them side by side.
const REFUSED_WHEN: Record<Refusal, string> = {
  offline: "Hosting or joining: the PC seems offline",
  servers: "Hosting or joining: our servers didn't answer",
  "no-code": "Joining: no session has the code",
  "you-older": "Joining: your version is older",
  "host-older": "Joining: the host's version is older",
  "too-many": "Joining: too many wrong codes",
}
export type Action = "host" | "join"
// A join is dialing once our servers have found its code and it's reaching the crew; slow, once
// the attempt has taken SLOW_AFTER.
type Status =
  | { kind: "idle" }
  | { kind: "busy"; on: Action; dialing?: boolean; slow?: boolean }
  | { kind: "done"; on: Action }
  | { kind: "refused"; on: Action; why: Refusal }

// A normal attempt is done well under 2s: one request to our servers, and for a join a connection,
// which opened in a median of 24ms to 159ms from friends' homes to ours (record/areas/network/
// 01-between-machines.md, The way through home routers). By 6s a joiner has redialed twice, so an
// attempt that long shows a line saying so, with Cancel, under the control that asked. Wi-Fi and
// carrier-grade NAT are unmeasured, so v1's recordings would tune it.
const SLOW_AFTER = 6000

// What the page's standing figure reacts to: an attempt to host or join, as a figure-attempt event,
// our servers' answer, as figure-answer with ok in its detail, and Cancel, as figure-cancel, all
// bubbling from the card. In the app any join announces itself, the clipboard's included. The bench
// fakes our servers: they answer after a moment, yes; or refusing, no, refusing a host as
// unreachable and a join as naming no session, the refusal that also marks the code's slots; or
// slow, answering a host only after SLOW_ANSWER_AFTER, and finding a join's code at once while the
// host it names never answers, as when their sim has crashed and the backend still lists them; or
// out of reach of a PC that's offline, which refuses either at once, since the request fails
// without leaving it, after a moment that lets the press show. The host's name is an example.
export type Servers = "answering" | "refusing" | "slow" | "offline"
const DEMO_CODE = "K7R4XM"
const DEMO_HOST = "James"
const ANSWER_AFTER = 1000
const SLOW_ANSWER_AFTER = 10000
const OFFLINE_ANSWER_AFTER = 300
// How long "Session started" holds before the card turns to the session, and how long a turn's
// height takes to ease, in milliseconds.
const SESSION_AFTER = 900
const HALF_EASE = 300

// The kit's solid red, for a button whose action is hard to take back.
const RED_BUTTON = "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/30"
// The kit's solid green, for a button pressed into a state that's good to be in.
const GREEN_BUTTON = "bg-success text-success-foreground hover:bg-success/90 focus-visible:border-success/40 focus-visible:ring-success/30"

// Where a crewmate is before preflight, as the session's keys tell every core
// (record/areas/session/02-units.md, Members and In the flight): their sim's stage, at the main menu
// which page, and in a flight its aircraft, which before the session has one, or in another, leaves
// them out of the flight; or their link lost, which Dual Input mends on its own, or their sim
// crashed, after which it rejoins them once they're back in a flight. It shows under their name,
// the two troubles in the warning color. The aircraft is an example.
type Whereabouts = "closed" | "starting" | "menu" | "world-map" | "loading" | "aircraft" | "lost" | "crashed"
const WHERE: Record<Whereabouts, { when: string; shows: string; trouble?: boolean }> = {
  closed: { when: "Their sim isn't running", shows: "Sim not running" },
  starting: { when: "Their sim is starting", shows: "Starting the sim" },
  menu: { when: "At the sim's main menu", shows: "At the main menu" },
  "world-map": { when: "At Free flight's world map", shows: "At the world map" },
  loading: { when: "Loading a flight", shows: "Loading a flight" },
  aircraft: { when: "In a flight before the session has an aircraft, or in another one", shows: "In the A320" },
  lost: { when: "Their link is lost, and Dual Input is reconnecting them", shows: "Connection lost", trouble: true },
  crashed: { when: "Their sim crashed, and Dual Input rejoins them once they're back in a flight", shows: "Sim crashed", trouble: true },
}

// A session as a frame opens on it, or as Host or Join turns the card to it: whether this pilot
// joined it or hosts it, and who else is in it. The host starts as the pilot flying, so a joiner's
// host, James, is flying, and James's row gives the joiner the way there. A crew bigger than v1's two
// (record/areas/product/03-v1-scope.md) is a Later pick drawn now. The names, colors, and where
// each pilot is are examples.
// Once preflight runs, a pilot in the flight shows their link, its path and round trip, as the
// network's slice carries them, and whether they're ready.
type Pilot = { name: string; hue: string; at?: Whereabouts; flying?: boolean; way?: Way; link?: string; ready?: boolean }
type Session = { joined: boolean; crew: Pilot[]; preflight?: Preflight }

// Preflight, from the moment the PF is in a flight on the ground, as every core follows the PF's
// `preflight` key (record/areas/session/02-units.md, Preflight and The match check;
// record/areas/product/03-v1-scope.md, Preflight and Preflight match check): whether this pilot's
// aircraft has settled after its load, which Ready waits for; whether this pilot starts ready; the
// match check's differences, each in its item's words from this pilot's side, with whose fix it
// is; and for the PF, the checklist of the controls Dual Input counts, each by its profile entry's
// ID, `name`, and `default` (record/areas/sync/05-units.md, Ready, notifications, log lines, and the
// checklist), and a `description`, a field the profile format doesn't have yet.
type Difference = { level: "error" | "warning"; says: string; fix?: string }
type ChecklistItem = { id: string; name: string; default: string; description?: string }
type Preflight = { settled: boolean; ready?: boolean; differences: Difference[]; checklist?: ChecklistItem[] }
// The differences a version, a livery, and a time of day make, from each side; the versions and
// the time are examples.
const DIFFERENCES: Record<"host" | "joiner", Difference[]> = {
  host: [
    { level: "error", says: "James has version 2.1.2 of the aircraft, and you have 2.1.3", fix: "James updates it" },
    { level: "warning", says: "Different liveries", fix: "Each of you sees your own" },
    { level: "warning", says: "James's sim is 4 hours ahead of yours", fix: "Set the same time in each sim" },
  ],
  joiner: [
    { level: "error", says: "You have version 2.1.2 of the aircraft, and James has 2.1.3", fix: "You update it" },
    { level: "warning", says: "Different liveries", fix: "Each of you sees your own" },
    { level: "warning", says: "Your sim is 4 hours ahead of James's", fix: "Set the same time in each sim" },
  ],
}
// The checklist's items are hypothetical. Every pilot's list holds the profile authors' items, for
// what Dual Input can't sync and each pilot sets by hand, here from the authors' notes' example;
// the PF's opens with the controls Dual Input counts, and whether the 58P's profile counts any is
// unknown until the profile is written (record/areas/product/03-v1-scope.md, Preflight). The last
// counted one's name is too long for its row, and its description runs past a line.
const EVERY_PILOT: ChecklistItem[] = [
  { id: "failure_rate", name: "Tablet failure rate", default: "0", description: "Each sim rolls its own failures, so every pilot sets this" },
  { id: "gps_flight_plan", name: "GPS flight plan", default: "Loaded", description: "The GPS's flight plan doesn't sync, so load the same one on every machine" },
]
const PF_CHECKLIST: ChecklistItem[] = [
  { id: "heading_bug", name: "Heading bug", default: "360" },
  { id: "course", name: "Course", default: "000", description: "The OBS knob, at the lower left of the HSI" },
  {
    id: "landing_elevation",
    name: "Cabin pressure controller landing field elevation",
    default: "1000",
    description: "The outer ring on the cabin pressure controller, on the right of the instrument panel, below the radios",
  },
  ...EVERY_PILOT,
]
const LINK = "Relay · 120ms"

const JAMES: Pilot = { name: DEMO_HOST, hue: "red" }
const SESSIONS: Record<"alone" | "crewmate" | "bigger-crew" | "joined" | "preflight-alone" | "preflight-loading" | "preflight-crew" | "preflight-settling" | "preflight-dropped" | "preflight-countdown" | "preflight-joined", Session> = {
  alone: { joined: false, crew: [] },
  crewmate: { joined: false, crew: [{ ...JAMES, at: "world-map" }] },
  "bigger-crew": {
    joined: false,
    crew: [
      { ...JAMES, at: "world-map" },
      { name: "Adam", hue: "green", at: "aircraft" },
      { name: "Mia", hue: "blue", at: "loading" },
    ],
  },
  joined: { joined: true, crew: [{ ...JAMES, flying: true, way: "stand" }] },
  // Preflight on the host's card: alone; with James still loading; with James in the flight, ready;
  // with the host's aircraft still settling; with James dropped out while the host is ready; and
  // with everyone ready, so the countdown runs. Then on the joiner's card, in the flight.
  "preflight-alone": { joined: false, crew: [], preflight: { settled: true, differences: [], checklist: PF_CHECKLIST } },
  "preflight-loading": { joined: false, crew: [{ ...JAMES, at: "loading" }], preflight: { settled: true, differences: [], checklist: PF_CHECKLIST } },
  "preflight-crew": { joined: false, crew: [{ ...JAMES, link: LINK, ready: true }], preflight: { settled: true, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-settling": { joined: false, crew: [{ ...JAMES, link: LINK }], preflight: { settled: false, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-dropped": { joined: false, crew: [{ ...JAMES, at: "lost" }], preflight: { settled: true, ready: true, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-countdown": { joined: false, crew: [{ ...JAMES, link: LINK, ready: true }], preflight: { settled: true, ready: true, differences: DIFFERENCES.host, checklist: PF_CHECKLIST } },
  "preflight-joined": { joined: true, crew: [{ ...JAMES, flying: true, link: LINK }], preflight: { settled: true, differences: DIFFERENCES.joiner, checklist: EVERY_PILOT } },
}
// How long the countdown runs once every counted pilot is ready, in seconds.
const COUNTDOWN = 3
export type SessionKey = keyof typeof SESSIONS
const hexOf = (hue: string) => FIGURE_COLORS.find((c) => c.name === hue)!.hex

// For a joiner not yet in the flight, where the pilot flying is, under their name, and Join at the
// row's end (record/areas/interface/decisions.md, Join takes a joiner from the world map into the
// PF's flight; record/areas/session/02-units.md, Go to). Join asks first: Set up only has the menu
// script set the world map to the PF's airport, their stand while their engines are off or a runway
// there while they run, so the joiner's run too, their aircraft, and their livery where the joiner
// has it; Join now does the same, then starts the flight and presses Ready to fly. Once the joiner
// is in it, Dual Input moves their aircraft to the PF's. It works only at Free flight's world map,
// the EFB's one place outside a flight, so in a flight, without the PF's aircraft, or with the
// script gone after a sim update, Join is disabled, and its tooltip says why. A toast says how it
// went: what's left after Set up only; a stand the world map doesn't list, which leaves the airport
// alone; or the step that failed. The words name pilots, never he or she, since Dual Input doesn't
// know anyone's pronouns, and a tooltip or toast of one sentence has no period (user, 2026-10-29).
// The airport, stand, and aircraft are examples.
type Way = "stand" | "runway" | "no-stand" | "fails" | "no-flight" | "no-aircraft" | "other-aircraft" | "no-departure" | "no-script"
const WAYS: Record<Way, { when: string; at: string; why?: string; setUp?: string; now?: string; outcome?: "warning" | "error" }> = {
  stand: { when: "James is at a stand, engines off", at: "At EGLL, Parking 140", setUp: "Your departure is EGLL, Parking 140, in the Baron 58P. Start the flight when you're ready.", now: "Starting your flight at EGLL, Parking 140" },
  runway: { when: "James's engines are running", at: "At EGLL, engines running", setUp: "Your departure is a runway at EGLL, in the Baron 58P, so your engines run. Start the flight when you're ready.", now: "Starting your flight on a runway at EGLL, engines running" },
  "no-stand": { when: "Join finds no Parking 140 in EGLL's stands", at: "At EGLL, Parking 140", setUp: "Your departure is EGLL, in the Baron 58P, but its stands have no Parking 140. Pick James's stand on the world map, then start the flight.", now: "EGLL's stands have no Parking 140, so you'll start elsewhere there, and Dual Input moves you to James.", outcome: "warning" },
  fails: { when: "Join's airport search fails", at: "At EGLL, Parking 140", setUp: "Join couldn't find EGLL on the world map. Try again, or set up the flight yourself.", now: "Join couldn't find EGLL on the world map. Try again, or set up the flight yourself.", outcome: "error" },
  "no-flight": { when: "James hasn't loaded a flight", at: "Hasn't loaded a flight yet", why: "You can join once James is in a flight" },
  "no-aircraft": { when: "You don't have James's aircraft", at: "At EGLL, Parking 140", why: "Install the Baron 58P to fly with James" },
  "other-aircraft": { when: "You're in a flight in another aircraft", at: "At EGLL, Parking 140", why: "End this flight to join James from the world map" },
  "no-departure": { when: "James's flight names no departure airport", at: "In the Baron 58P", why: "Can't detect departure airport. Start your flight anywhere and Dual Input will teleport you to James." },
  "no-script": { when: "Join can't run, as after a sim update", at: "At EGLL, Parking 140", why: "Looks like something broke Join (perhaps a sim update, or corrupted Dual Input installation)." },
}
// How long the bench takes to set up the world map, in milliseconds: the airport search, then the
// stand or runway, the aircraft, and the livery.
const SET_UP_AFTER = 1200

// Join now takes the sim's own flight-button yellow, so it reads as starting the flight, as the
// world map's Start flight does: `--colorSpecial` and `--colorSpecial_Content` (read in fs-base-ui
// 0.1.10, components/shared/variables.css).
const SIM_FLY_BUTTON = "bg-[#FFDE03] text-[#242934] hover:bg-[#FFDE03]/90 focus-visible:border-[#FFDE03]/40 focus-visible:ring-[#FFDE03]/30"

// A pilot in the crew list: their figure's head, their name with the pilot flying marked, and under
// it where they are, where that says anything. The row's end is for each pilot's Ready once
// preflight runs, and before it, when no pilot can give one, it's empty but for Join on the pilot
// flying's row for a joiner out of the flight, since getting into that flight comes first.
// Under the name, a pilot in the flight shows their link instead of where they are. The row's end
// is the card's to give: during preflight, each pilot's Ready.
// A row given pop pops its head in after that many milliseconds, fixed when the row first shows.
function CrewRow({ pilot, pop, end }: { pilot: Pilot; pop?: number; end?: React.ReactNode }) {
  const { Badge } = useUI()
  const [popAfter] = useState(pop)
  const under = pilot.way ? { shows: WAYS[pilot.way].at, trouble: false } : pilot.at ? WHERE[pilot.at] : pilot.link ? { shows: pilot.link, trouble: false } : undefined
  const last = end ?? (pilot.way && <JoinPf way={pilot.way} />)
  return (
    <li className="flex items-center gap-3">
      <Head hex={hexOf(pilot.hue)} pop={popAfter} />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-sm font-medium">
          {pilot.name}
          {pilot.flying && <Badge variant="secondary">Pilot flying</Badge>}
        </span>
        {under && <span className={"text-xs " + (under.trouble ? "text-warning" : "text-muted-foreground")}>{under.shows}</span>}
      </div>
      {last && <span className="ml-auto">{last}</span>}
    </li>
  )
}

// Join, on the pilot flying's row. A press asks first, in the confirm popover, since Join now
// starts a flight: the question names the pilot flying, the row already says where they are, and
// the two answers say how far to go. It names no aircraft, whose name can run long. While the
// script works, Join shows a spinner. Where Join can't go, it's disabled, and a tooltip says why; a
// disabled button takes no pointer events, so the tooltip hangs on a wrapper.
function JoinPf({ way }: { way: Way }) {
  const { Button, Spinner, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  const w = WAYS[way]
  const [busy, setBusy] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const go = (now: boolean) => {
    setBusy(true)
    timer.current = window.setTimeout(() => {
      setBusy(false)
      const show = w.outcome === "error" ? toast.error : w.outcome === "warning" ? toast.warning : toast
      show(now ? w.now : w.setUp)
    }, SET_UP_AFTER)
  }
  if (w.why)
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button size="sm" disabled>
            Join
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{w.why}</TooltipContent>
      </Tooltip>
    )
  return (
    <ConfirmButton
      label={
        <>
          {busy && <Spinner data-icon="inline-start" />}
          Join
        </>
      }
      question={`Join ${DEMO_HOST}?`}
      also={{ label: "Set up only", onSelect: () => go(false) }}
      go="Join now"
      onConfirm={() => go(true)}
      trigger={{ size: "sm", disabled: busy, asking: "data-popup-open:bg-primary/20 data-popup-open:text-primary data-popup-open:hover:bg-primary/20" }}
      className={SIM_FLY_BUTTON}
      align="end"
    />
  )
}

// This pilot's Ready, at the end of their row: outlined until pressed, then filled green with a
// check, and pressed again it un-readies. Until the aircraft has settled after its load, about 30s after
// Ready to fly (decision 048), it's disabled, and a tooltip says why.
function ReadyButton({ ready, settled, onToggle }: { ready: boolean; settled: boolean; onToggle: () => void }) {
  const { Button, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  if (!settled)
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button size="sm" variant="outline" disabled>
            Ready
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">Ready opens once your aircraft has settled, about 30s after Ready to fly</TooltipContent>
      </Tooltip>
    )
  return (
    <Button size="sm" variant={ready ? "default" : "outline"} className={ready ? GREEN_BUTTON : undefined} onClick={onToggle}>
      {ready && <Check data-icon="inline-start" />}
      Ready
    </Button>
  )
}

// For every pilot but the PF, the line preflight's rule asks for: catch-up sets only what the
// profile holds, so a display a PM pages through now keeps that page (record/areas/product/
// 03-v1-scope.md, Preflight, Rules). It asks gently, and leaves room for what the pilot's own
// checklist asks them to set by hand.
function TouchNothing({ checklist }: { checklist: boolean }) {
  return (
    <p className="flex items-center gap-2 rounded-2xl bg-info/10 px-4 py-2.5 text-sm text-info">
      <Hand className="size-4 shrink-0" />
      {checklist ? "Until the flight starts, try to change only what the checklist asks for" : "Until the flight starts, try to leave the cockpit as it is"}
    </p>
  )
}

// The countdown, under the crew where each pilot's Ready is, once every counted pilot is ready: the
// seconds left beside a bar that drains over them (index.css, countdown-drain), and how to stop it.
// It's green, as a pressed Ready is, since it runs because every Ready is, and the line on how to
// stop it is the same green, fainter. In the folded card's row it's only the seconds and the bar,
// between the crew and Ready, the button that stops it.
function Countdown({ left, inRow }: { left: number; inRow?: boolean }) {
  return (
    <div className={"flex animate-in items-center gap-3 duration-200 fade-in " + (inRow ? "" : "rounded-2xl bg-success/10 px-4 py-2.5")}>
      <span className="text-sm font-medium whitespace-nowrap text-success tabular-nums">Flight starts in {left}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-success/20">
        <div className="h-full origin-left rounded-full bg-success" style={{ animation: `countdown-drain ${COUNTDOWN}s linear both` }} />
      </div>
      {!inRow && <span className="text-xs text-success/70">Un-ready to stop</span>}
    </div>
  )
}

// The session's phase: preflight from the moment the PF is in a flight on the ground
// (record/areas/session/02-units.md, Preflight), so a joiner whose PF waits at a stand is in it
// before they're in the flight, then syncing once its countdown ends. Before preflight there's
// none, since the crew list already shows where everyone is. Preflight says what it is: sync
// hasn't started yet, rather than paused, which would say it ran and stopped, and pause is the
// sim's word too; syncing needs no explaining.
type SessionPhase = "preflight" | "syncing"
const PHASES: Record<SessionPhase, { name: string; text: string; line?: string }> = {
  preflight: { name: "Preflight", text: "text-primary", line: "Sync starts once everyone's ready" },
  syncing: { name: "Sync active", text: "text-success" },
}
const phaseOf = (session: Session, started: boolean): SessionPhase | undefined =>
  started ? "syncing" : session.preflight || session.crew.find((p) => p.flying)?.way ? "preflight" : undefined

// The phase as a 20px line on the page right above the session card, on the page's left edge, in
// line with the header's mark and the card's side: a dot in the phase's color, pulsing while
// preflight waits on the crew, from the kit's ping, then its name in capitals, in the same color,
// then, for a phase that needs it, a line saying what it is, muted, on one line.
// When the phase changes, the new line uncovers the old from left to right over LIP_WIPE_MS, so the
// flight's start shows as a sweep of green.
const LIP_WIPE_MS = 600
// Each face of the line has the page's background, so the face a new phase sweeps in covers the
// old one.
function LipFace({ phase, className = "", style }: { phase: SessionPhase; className?: string; style?: React.CSSProperties }) {
  const p = PHASES[phase]
  return (
    <div className={"flex h-5 items-center gap-2 bg-background whitespace-nowrap " + className} style={style}>
      <span className={"relative flex size-1.5 shrink-0 " + p.text}>
        {phase === "preflight" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75" />}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      <span className={"text-[10px] font-semibold tracking-widest uppercase " + p.text}>{p.name}</span>
      {p.line && <span className="min-w-0 truncate text-xs text-muted-foreground">{p.line}</span>}
    </div>
  )
}
function PhaseLip({ phase }: { phase: SessionPhase }) {
  const [leaving, setLeaving] = useState<SessionPhase | null>(null)
  const last = useRef(phase)
  useEffect(() => {
    if (last.current === phase) return
    setLeaving(last.current)
    last.current = phase
    const t = window.setTimeout(() => setLeaving(null), LIP_WIPE_MS)
    return () => clearTimeout(t)
  }, [phase])
  return (
    <div className="relative h-5 shrink-0">
      {leaving && <LipFace phase={leaving} className="absolute inset-0" />}
      <LipFace key={phase} phase={phase} className="absolute inset-0" style={leaving ? { animation: `lip-wipe ${LIP_WIPE_MS}ms ease-in-out both` } : undefined} />
    </div>
  )
}

// A pilot's head in the folded card's row, named for a screen reader, with a badge at its lower right once
// there's something to say: a green check once they're ready, a red cross while they're out of
// the flight, a dropped link or a crashed sim. A ring in the card's color parts the badge from the
// head.
function StripHead({ pilot, ready }: { pilot: Pilot; ready: boolean }) {
  const out = pilot.at === "lost" || pilot.at === "crashed"
  return (
    <span className="relative inline-flex" aria-label={pilot.name}>
      <Head hex={hexOf(pilot.hue)} />
      {(ready || out) && (
        <span className={"absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-card " + (ready ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground")}>
          {ready ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
        </span>
      )}
    </span>
  )
}

// The match check's differences, in a section of the session card: an error's icon in red and a
// warning's in amber, the difference, and whose fix it is, muted.
function Differences({ differences }: { differences: Difference[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {differences.map((d) => (
        <li key={d.says} className="flex items-start gap-2">
          {d.level === "error" ? <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
          <span>
            {d.says}
            {d.fix && <span className="text-muted-foreground"> · {d.fix}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// The pilot's checklist, on the page under the session card, for them to work through before
// Ready: every pilot's holds what the profile's authors list for each pilot to set by hand, and the
// PF's also opens with the controls Dual Input tracks by counting their events, since no variable
// shows their value, and counts from where the aircraft starts them (record/areas/product/
// 03-v1-scope.md, Preflight). Its rows read as an aircraft's checklist does, each control, dots,
// then its starting value, in capitals, in B612 Mono, the typeface Airbus made for its cockpit
// displays, and a row checked turns green. Each row is the page's width and at least 44px tall, so
// a VR controller's pointer lands on one without careful aim. A row checked is the pilot's own
// note, and Ready doesn't wait for it.
// Profile authors write the names, values, and descriptions, and Dual Input makes some entries
// itself, so the rows take any length rather than the format limiting it: a value always shows
// whole, since a value cut short reads as another value, and wraps once it passes half the row; a
// name takes the rest of the line, cut at its edge, and slides to show its end while the pointer
// rests on it; the dots between keep at least three; and a description wraps under the name as
// long as it runs. Rows go by the entry's ID, since two entries can share a name.
// The button right after the title gives the checklist the page, folding the session card to a
// row that keeps Ready, as the user's sketch of 2026-10-26 has it, and folds it back. It's sky,
// the app's color for what can be pressed, and reaches past the title's line without making it
// taller.
const LEADER = ".".repeat(80)
function Checklist({ items, expanded, onExpand }: { items: ChecklistItem[]; expanded: boolean; onExpand: () => void }) {
  const { Button } = useUI()
  const [done, setDone] = useState<string[]>([])
  const [pointed, setPointed] = useState<string | null>(null)
  const toggle = (id: string) => setDone((d) => (d.includes(id) ? d.filter((n) => n !== id) : [...d, id]))
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-0.5">
          <h3 className="text-[15px] font-semibold">Preflight Checklist</h3>
          <Button variant="ghost" size="icon-sm" className="-my-1.5 text-primary hover:text-primary" aria-label={expanded ? "Show the whole session card" : "Give the checklist the page"} onClick={onExpand}>
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">Check these before you click Ready, so every cockpit starts in sync.</p>
      </div>
      {/* The rows reach 8px past the text on either side, so their text lines up with the title
          while a hovered row's tint has room around it. */}
      <ul className="-mx-2 flex flex-col font-checklist text-[13px]">
        {items.map((item) => {
          const checked = done.includes(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(item.id)}
                onMouseEnter={() => setPointed(item.id)}
                onMouseLeave={() => setPointed((p) => (p === item.id ? null : p))}
                className={"flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-[6px] px-2 py-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 " + (checked ? "text-success" : "")}
              >
                <span className="flex items-center gap-3">
                  <ChecklistBox checked={checked} />
                  {/* B612 Mono leaves more room under its baseline than above its capitals, so
                      centered lines put the capitals 1px above the box's center; the text drops
                      that 1px. */}
                  <ChecklistName text={item.name} sliding={pointed === item.id} />
                  <span className="relative top-px min-w-[3ch] flex-1 overflow-hidden whitespace-nowrap opacity-40">{LEADER}</span>
                  <span className="relative top-px max-w-1/2 shrink-0 text-right break-words uppercase">{item.default}</span>
                </span>
                {/* Under the name, past the box and its gap. */}
                {item.description && <span className="pl-7 text-[11px] leading-snug opacity-60">{item.description}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// A checklist name too long for its line, cut at the line's edge, slides left to show its end
// while the pointer rests on its row: after a beat, so a pointer passing over doesn't set it moving,
// at a pace to read by, holding at the end, and back once the pointer leaves. It's a transition on
// transform, which Coherent GT keeps, so each name slides its own distance without a keyframe per
// name. The distance is the name's own width past the line's, both measured untransformed.
const SLIDE = { wait: 500, pxPerSecond: 50, backMs: 250 }
function ChecklistName({ text, sliding }: { text: string; sliding: boolean }) {
  const line = useRef<HTMLSpanElement>(null)
  const name = useRef<HTMLSpanElement>(null)
  const [past, setPast] = useState(0)
  useLayoutEffect(() => {
    if (line.current && name.current) setPast(Math.max(0, name.current.offsetWidth - line.current.clientWidth))
  }, [text, sliding])
  const go = sliding && past > 0
  return (
    <span ref={line} className="relative top-px min-w-0 overflow-hidden whitespace-nowrap uppercase">
      <span
        ref={name}
        className="inline-block"
        style={{
          transform: `translateX(${go ? -past : 0}px)`,
          transition: go ? `transform ${(past / SLIDE.pxPerSecond) * 1000}ms linear ${SLIDE.wait}ms` : `transform ${SLIDE.backMs}ms ease-out`,
        }}
      >
        {text}
      </span>
    </span>
  )
}

// A checklist row's box, drawn as an avionics display draws one: a square outline with sharp
// corners, dimmed while open, and once checked, a check stroked inside it with square ends, both in
// the row's color.
function ChecklistBox({ checked }: { checked: boolean }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" aria-hidden className="size-4 shrink-0">
      <rect x="1" y="1" width="16" height="16" strokeWidth={1.5} opacity={checked ? 1 : 0.6} />
      {checked && <polyline points="4.5,9.5 7.5,12.5 13.5,5.5" strokeWidth={2.25} strokeLinecap="square" strokeLinejoin="miter" />}
    </svg>
  )
}

// The heads pop in as the card turns to the session, one after another down the list, while the
// figure that stood under the card leaps off the page, so the pilot seems to land in the crew; a
// pilot who joins later pops in as their row appears. The first head's wait, and each next one's,
// in milliseconds.
const POP = { first: 120, stagger: 70 }

// The session's side of the card, from the moment Host or Join succeeds, in place of the aircraft
// and Host and Join, under the session's phase, once there is one, which the card heads it with: the
// invite code, with Copy, every pilot's to share, since it belongs to the session; and Leave, in
// the kit's tinted red, since it ends the session for this pilot, asking first once anyone else is
// in it. Then the crew, each pilot by their figure's head, this pilot first
// as You. The host is the pilot flying when a session starts, and alone, a row waits for the
// crewmate the code brings, so the list shows what comes next; v1 sessions are two pilots, so that
// row fills and goes with the first join. This pilot's color is an example.
// During preflight, each row ends with that pilot's Ready, this pilot's as their button. Every
// pilot counts but those a ready pilot went without, and a pilot who dropped out is unready and
// still counts, so the crew waits for them unless someone goes without them; the PF can't be gone
// without. Once every counted pilot is ready, the countdown runs, and un-readying stops it. A
// joiner's card says to touch nothing, and the match check's differences have a section of their
// own. The flight starting, which the card hands up and the phase shows, is as far as these frames
// go.
// While the checklist has the page, the card folds to one row for what a pilot working through it
// watches: every pilot's head, badged ready or out, so they see whom they're waiting on, and their
// own Ready at the end, with the countdown between once it runs. The code, Leave, Go without, and
// the match check wait for the whole card.
function SessionHalf({ session, started, folded, onStarted, onLeave }: { session: Session; started: boolean; folded: boolean; onStarted: () => void; onLeave: () => void }) {
  const { Button, CardContent, Separator } = useUI()
  const { joined, crew, preflight } = session
  const turnedIn = useRef(false)
  useEffect(() => {
    turnedIn.current = true
  }, [])
  const me: Pilot = { name: "You", hue: "orange", flying: !joined }

  const [ready, setReady] = useState(!!preflight?.ready)
  const [goneWithout, setGoneWithout] = useState<string[]>([])
  const [left, setLeft] = useState<number | null>(null)
  const allReady = !!preflight && !started && ready && crew.filter((p) => !goneWithout.includes(p.name)).every((p) => p.ready)
  useEffect(() => {
    if (!allReady) {
      setLeft(null)
      return
    }
    setLeft(COUNTDOWN)
    const tick = window.setInterval(() => setLeft((l) => (l === null ? null : l - 1)), 1000)
    return () => clearInterval(tick)
  }, [allReady])
  useEffect(() => {
    if (left === 0) onStarted()
    // It hands up the moment the countdown ends, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])
  const endOf = (p: Pilot, you: boolean): React.ReactNode => {
    if (!preflight || started) return undefined
    if (you) return <ReadyButton ready={ready} settled={preflight.settled} onToggle={() => setReady((r) => !r)} />
    if (goneWithout.includes(p.name)) return <span className="text-xs text-muted-foreground">Not counted</span>
    if ((p.at === "lost" || p.at === "crashed") && ready && !p.flying)
      return (
        <Button size="sm" variant="secondary" onClick={() => setGoneWithout((g) => [...g, p.name])}>
          Go without
        </Button>
      )
    if (p.way) return undefined
    return p.ready ? <StatusChip level="success">Ready</StatusChip> : <span className="text-xs text-muted-foreground">Not ready</span>
  }
  const code = `${DEMO_CODE.slice(0, 3)}-${DEMO_CODE.slice(3)}`
  const copy = (
    <Button variant="ghost" size="icon-sm" aria-label="Copy the invite code" onClick={() => toast("Copied the invite code")}>
      <Copy />
    </Button>
  )
  if (folded && preflight)
    return (
      <CardContent className="flex items-center gap-4">
        <div className="flex shrink-0 items-center gap-1.5">
          {[me, ...crew].map((p, i) => (
            <StripHead key={p.name} pilot={p} ready={i === 0 ? ready : !!p.ready} />
          ))}
        </div>
        <div className="min-w-0 flex-1">{left !== null && <Countdown left={left} inRow />}</div>
        <ReadyButton ready={ready} settled={preflight.settled} onToggle={() => setReady((r) => !r)} />
      </CardContent>
    )
  const leave = (
    <>
      Leave <LogOut data-icon="inline-end" />
    </>
  )
  return (
    <>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label>Invite code</Label>
          <div className="flex items-center gap-1">
            <span className="font-mono text-2xl font-medium tracking-wider">{code}</span>
            {copy}
          </div>
        </div>
        {crew.length > 0 ? (
          <ConfirmButton label={leave} question="Leave the session?" go="Leave" onConfirm={onLeave} trigger={{ variant: "destructive", size: "sm" }} className={RED_BUTTON} align="end" />
        ) : (
          <Button variant="destructive" size="sm" onClick={onLeave}>
            {leave}
          </Button>
        )}
      </CardContent>
      <Separator />
      <CardContent className="flex flex-col gap-3">
        {preflight && joined && !started && <TouchNothing checklist={!!preflight.checklist?.length} />}
        <Label>Crew</Label>
        <ul className="flex flex-col gap-2">
          {[me, ...crew].map((p, i) => (
            <CrewRow key={p.name} pilot={p} pop={turnedIn.current ? 0 : POP.first + i * POP.stagger} end={endOf(p, i === 0)} />
          ))}
          {crew.length === 0 && (
            <li className="flex items-center gap-3 text-sm text-muted-foreground/60">
              <EmptyHead />
              Send the invite code for others to join
            </li>
          )}
        </ul>
        {left !== null && <Countdown left={left} />}
      </CardContent>
      {preflight && preflight.differences.length > 0 && (
        <>
          <Separator />
          <CardContent className="flex flex-col gap-3">
            <Label>Match check</Label>
            <Differences differences={preflight.differences} />
          </CardContent>
        </>
      )}
    </>
  )
}

// The loaded aircraft on top, since a session flies the host's aircraft, then Host and the code
// field to join with. Selecting the code field fills it from the clipboard and joins at once
// (record/areas/product/03-v1-scope.md, Invite code), so the field stays in view. Host, the code
// field, and Join are marked data-figure-target, which the figure locks on to; Host is also
// data-host, which it looks at by default; and Host and Join are data-figure-press, a press on which
// winds it up. A disabled button takes no pointer events, so the figure ignores Join until the code is
// whole.
// While our servers answer, the button that asked shows it's busy and the code field is locked, and
// a refusal, or the line for an attempt taking long, opens under the control that asked: Host, or
// the code. Once Host or Join succeeds, the card turns to the session, the one hosted or the one
// joined, which has no use for the aircraft, and Leave turns it back; a frame can open on a session,
// and have a crewmate join it after joinsAfter milliseconds. In preflight, the pilot's checklist
// sits under the card until the flight starts, and can take the page, folding the card to a row; a
// frame can open with it taken.
function StartCard({ aircraft, servers = "answering", play, session, joinsAfter, checklistExpanded }: { aircraft: Aircraft; servers?: Servers; play?: Action; session?: SessionKey; joinsAfter?: number; checklistExpanded?: boolean }) {
  const { Badge, Button, Card, CardContent, Separator, Spinner, InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } = useUI()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [code, setCode] = useState("")
  const codeNow = useRef("")
  codeNow.current = code
  const hostButton = useRef<HTMLButtonElement>(null)
  const joinButton = useRef<HTMLButtonElement>(null)
  const working = status.kind === "busy" || status.kind === "done"

  // An attempt's timers: its slow line's, and the fake servers' answers. A new attempt or Cancel
  // clears them, so a timer from an attempt before can't reach this one.
  const timers = useRef<number[]>([])
  const stop = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => stop, [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  useEffect(() => {
    if (joinsAfter) later(joinsAfter, () => setShown("crewmate"))
    // It plays once, from the frame's opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const busy =(change: { dialing?: boolean; slow?: boolean }) => setStatus((s) => (s.kind === "busy" ? { ...s, ...change } : s))

  // The card turns between the aircraft with Host and Join, and the session, as the guide's pages
  // turn: the side it leaves fades out, then the next fades in, rising 6px, as the card eases to
  // its height. The height is measured after every render while a turn eases it, and in the
  // session, since Coherent GT has no ResizeObserver; at rest on Host and Join, the card sets its
  // own, since a refusal's room eases open there and a measured height would clip it.
  const [half, setHalf] = useState<"start" | "session">(session ? "session" : "start")
  const [shown, setShown] = useState<SessionKey>(session ?? "alone")
  const [started, setStarted] = useState(false)
  const checklist = half === "session" && !started ? SESSIONS[shown].preflight?.checklist : undefined
  const [expanded, setExpanded] = useState(!!checklistExpanded)
  const folded = expanded && !!checklist
  // A session card that ends on the match check ends on a line of text, whose line box leaves room
  // under the letters, so the card's turning part reaches 4px into its bottom padding to look as far
  // from the edge as the icons are from the side. The trim goes on the turning part, not on what's
  // inside it, since the turning part clips to its contents' height.
  const endsOnText = half === "session" && !folded && !!SESSIONS[shown].preflight?.differences.length
  // The session's phase sits above the card, outside the part that turns, so it stays put through a
  // turn, and through the card folding to its row.
  const phase = half === "session" ? phaseOf(SESSIONS[shown], started) : undefined
  const [turning, setTurning] = useState<"out" | "in" | null>(null)
  const turnTo = (next: "start" | "session") => {
    setTurning("out")
    later(TURN.out, () => {
      setHalf(next)
      setTurning("in")
    })
    later(TURN.out + HALF_EASE, () => setTurning(null))
  }
  const halfBox = useRef<HTMLDivElement>(null)
  const halfInner = useRef<HTMLDivElement>(null)
  const [halfHeight, setHalfHeight] = useState<number>()
  useLayoutEffect(() => {
    const h = turning === "out" ? halfBox.current?.offsetHeight : turning === "in" || half === "session" ? halfInner.current?.offsetHeight : undefined
    if (h !== halfHeight) setHalfHeight(h)
  })
  // Leave turns back to Host and Join, the code cleared; leaving needs no answer from our servers.
  const leave = () => {
    stop()
    setStatus({ kind: "idle" })
    setCode("")
    setStarted(false)
    setExpanded(false)
    turnTo("start")
  }

  const attempt = (on: Action, from: HTMLElement) => {
    stop()
    from.dispatchEvent(new CustomEvent("figure-attempt", { bubbles: true }))
    setStatus({ kind: "busy", on })
    later(SLOW_AFTER, () => busy({ slow: true }))
    const answer = (why?: Refusal) => {
      from.dispatchEvent(new CustomEvent("figure-answer", { bubbles: true, detail: { ok: !why } }))
      setStatus(why ? { kind: "refused", on, why } : { kind: "done", on })
      if (!why)
        later(SESSION_AFTER, () => {
          setShown(on === "host" ? "alone" : "joined")
          turnTo("session")
        })
    }
    if (servers === "offline") later(OFFLINE_ANSWER_AFTER, () => answer("offline"))
    else if (servers === "refusing") later(ANSWER_AFTER, () => answer(on === "host" ? "servers" : "no-code"))
    else if (servers === "answering") later(ANSWER_AFTER, () => answer())
    else if (on === "host") later(SLOW_ANSWER_AFTER, () => answer())
    else later(ANSWER_AFTER, () => busy({ dialing: true }))
  }
  const join = (from: HTMLElement) => codeNow.current.length === 6 && attempt("join", from)
  // Cancel stops the attempt here alone: a joiner registers with our servers only once it reaches
  // the crew, and a session they start for a canceled host after all lapses, since nobody renews
  // it. The code stays.
  const cancel = (from: HTMLElement) => {
    stop()
    from.dispatchEvent(new CustomEvent("figure-cancel", { bubbles: true }))
    setStatus({ kind: "idle" })
  }

  // A frame asked to play hosting or joining plays it a moment after it opens: for a join it types
  // the demo code, and then it presses its button and lets go on it, as a pilot's click does.
  useEffect(() => {
    if (!play) return
    const timers: number[] = []
    const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms))
    const click = (at: number, button: () => HTMLButtonElement | null, act: (b: HTMLElement) => void) => {
      later(at, () => button()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
      later(at + 300, () => {
        const b = button()
        if (!b) return
        b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
        act(b)
      })
    }
    if (play === "host") click(1400, () => hostButton.current, (b) => attempt("host", b))
    else {
      DEMO_CODE.split("").forEach((_, i) => later(900 + i * 110, () => setCode(DEMO_CODE.slice(0, i + 1))))
      click(1900, () => joinButton.current, (b) => join(b))
    }
    return () => timers.forEach(clearTimeout)
    // It plays once, from the frame's opening; each play button opens the frame afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A refused join clears when the code is edited; a code that names no session marks its slots.
  const refusedOn = (on: Action) => (status.kind === "refused" && status.on === on ? status.why : undefined)
  const joinRefused = refusedOn("join") !== undefined
  const badCode = refusedOn("join") === "no-code"
  // Under each control, its refusal, or its slow line, which names the host once a join is dialing.
  const under = (on: Action) => {
    const why = refusedOn(on)
    if (why) return <Refused why={why} />
    if (status.kind === "busy" && status.on === on && status.slow)
      return <SlowLine text={status.dialing ? `Still trying to reach ${DEMO_HOST}…` : "This is taking longer than usual."} onCancel={cancel} />
  }
  // Before a session, the card never shrinks, so the notes below are what gives way on a full page.
  // In a session the page ends at the card, with the PF's checklist under it in preflight, and the
  // two can run past the page, so they scroll as one, out through the page's side and bottom padding
  // to the window's edge and the tab bar, with fades and dragging as the aircraft picker has. The
  // card's edge is a ring drawn outside its box, which the scroller would clip at the top, so the
  // scroller starts 1px higher and pads that 1px back.
  const scroller = useScroller()
  const scrolls = half === "session"
  const fade = (to: "top" | "bottom", shown: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, var(--background), transparent)`, opacity: shown ? 1 : 0 })
  return (
    // The card's padding matches the page's 20px, where Luma's default card spacing is 24px.
    // It sits above what's under it, so the figure's canvas can stay put as the card grows down over
    // its empty top. The card's parts sit inside the part that turns, which spaces them as the
    // card's own gap would.
    <div className={"relative flex flex-col " + (scrolls ? "-mx-5 -mt-px -mb-5 min-h-0" : "shrink-0")}>
    <div
      ref={scroller.ref}
      onScroll={scroller.onScroll}
      onMouseDown={scrolls ? scroller.onMouseDown : undefined}
      className={
        "flex flex-col gap-5 " +
        (scrolls ? "min-h-0 overflow-y-auto px-5 pt-px pb-5 select-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-foreground/20 [&::-webkit-scrollbar-track]:bg-transparent " + scroller.cursor : "")
      }
    >
    {/* The phase sits 8px above the card, closer than the page's gap between the card and what
        follows, so it reads as the card's. */}
    <div className="flex shrink-0 flex-col gap-2">
    {phase && <PhaseLip phase={phase} />}
    <Card className="relative z-10 shrink-0 [--card-spacing:--spacing(5)]">
      <div ref={halfBox} className={"overflow-hidden transition-[height] ease-out " + (endsOnText ? "-mb-1" : "")} style={{ height: halfHeight, transitionDuration: `${HALF_EASE}ms` }}>
        <div
          ref={halfInner}
          key={half}
          className={"flex flex-col gap-(--card-spacing) " + (turning === "in" ? "animate-in fade-in slide-in-from-bottom-[6px]" : "")}
          style={{ animationDuration: `${TURN.in}ms`, opacity: turning === "out" ? 0 : 1, transition: `opacity ${TURN.out}ms ease-out` }}
        >
          {half === "session" ? (
            <SessionHalf session={SESSIONS[shown]} started={started} folded={folded} onStarted={() => setStarted(true)} onLeave={leave} />
          ) : (
            <>
            <CardContent className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label>{aircraft.maker}</Label>
                <span className="truncate text-lg leading-tight font-semibold">{aircraft.model}</span>
                <span className="text-xs text-muted-foreground">{aircraft.tail}</span>
              </div>
              {aircraft.maturity ? <Badge variant={aircraft.maturity === "Stable" ? "secondary" : "outline"}>{aircraft.maturity}</Badge> : <StatusChip level="warning">Not supported yet</StatusChip>}
            </CardContent>
            <Separator />
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col">
                <Button ref={hostButton} size="lg" className="w-full" data-host data-figure-target data-figure-press disabled={working} onClick={(e: React.MouseEvent<HTMLElement>) => attempt("host", e.currentTarget)}>
                  {status.kind === "busy" && status.on === "host" ? (
                    <>
                      <Spinner data-icon="inline-start" /> Starting your session…
                    </>
                  ) : status.kind === "done" && status.on === "host" ? (
                    <>
                      <Check data-icon="inline-start" /> Session started
                    </>
                  ) : (
                    "Host a session"
                  )}
                </Button>
                <UnderSlot>{under("host")}</UnderSlot>
              </div>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or join with a code</span>
                <Separator className="flex-1" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-3">
                  <div data-figure-target onKeyDown={(e) => e.key === "Enter" && join(e.currentTarget)}>
                    <InputOTP
                      maxLength={6}
                      value={code}
                      disabled={working}
                      onChange={(v: string) => {
                        setCode(v.toUpperCase())
                        if (joinRefused) setStatus({ kind: "idle" })
                      }}
                    >
                      <InputOTPGroup>
                        {[0, 1, 2].map((i) => (
                          <InputOTPSlot key={i} index={i} className={"font-mono " + (badCode ? "border-destructive/60" : "")} />
                        ))}
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        {[3, 4, 5].map((i) => (
                          <InputOTPSlot key={i} index={i} className={"font-mono " + (badCode ? "border-destructive/60" : "")} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <Button ref={joinButton} variant="outline" disabled={code.length < 6 || working} data-figure-target data-figure-press onClick={(e: React.MouseEvent<HTMLElement>) => join(e.currentTarget)}>
                    {status.kind === "busy" && status.on === "join" ? <Spinner /> : status.kind === "done" && status.on === "join" ? <Check /> : "Join"}
                  </Button>
                </div>
                <UnderSlot>{under("join")}</UnderSlot>
              </div>
            </CardContent>
            </>
          )}
        </div>
      </div>
    </Card>
    </div>
    {checklist && <Checklist items={checklist} expanded={folded} onExpand={() => setExpanded((e) => !e)} />}
    </div>
    {scrolls && (
      <>
        <div className="pointer-events-none absolute top-0 right-0 left-0 z-20 h-6 transition-opacity duration-200" style={fade("top", scroller.above)} />
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-8 transition-opacity duration-200" style={fade("bottom", scroller.below)} />
      </>
    )}
    </div>
  )
}

// The guide's pages before the aircraft check, in the user's words.
const GUIDE = [
  {
    title: "Flying together",
    body: "One of you hosts and shares their invite code, and others enter it to join. You each spawn into the same aircraft, preferably cold and dark, and Dual Input keeps you in sync.",
  },
  {
    title: "Who flies",
    body: "The host starts as the pilot flying: their yoke, rudder, and throttles move the aircraft. You both work the switches, knobs, and displays. Others can take over as pilot flying at any time (see Settings for keybinds).",
  },
  {
    title: "Preflight",
    body: "The Preflight phase lines everyone up before anything moves. Dual Input flags deal breakers between your setups and presents any checklist items from profile authors to help avoid sync issues.",
  },
  {
    title: "Profiles",
    body: "Profile files tell Dual Input which switches, knobs, and displays to sync and how. They are mostly built by community members. How well an aircraft is synced depends on the specific way an aircraft was built and how the profile handles it.",
  },
]
const PAGES = GUIDE.length + 1
// How long the guide takes to go once closed, and a page turn's two halves, in milliseconds.
const LEAVE_MS = 300
const TURN = { out: 110, in: 170 }

// The guide's last page: whether Dual Input supports the loaded aircraft, and when it doesn't, what
// a session still shares in it and the way to the aircraft it does support, the aircraft picker.
function AircraftCheck({ supported }: { supported: boolean }) {
  const [picking, setPicking] = useState(false)
  if (supported)
    return (
      <>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <CircleCheck className="size-4 shrink-0 text-success" />
          This aircraft is supported
        </h3>
        <p className="text-sm text-muted-foreground">Click Host above and share the invite code with someone to start flying together.</p>
      </>
    )
  return (
    <>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlert className="size-4 shrink-0 text-warning" />
        Dual Input doesn't support this aircraft yet
      </h3>
      <p className="text-sm text-muted-foreground">Cockpit state won't sync but you can still fly it together, sharing its position, who's flying, traffic, and ATC.</p>
      <p className="pt-3 text-sm text-muted-foreground">
        Alternatively, switch to a <InlineLink onClick={() => setPicking(true)}>supported aircraft</InlineLink>, or try your hand at building a profile for it (<InlineLink>see how</InlineLink>).
      </p>
      <AircraftPicker open={picking} onOpenChange={setPicking} />
    </>
  )
}

// What a session still does in an aircraft Dual Input has no profile for, in the user's words:
// everything but the cockpit's state, which takes a profile.
const SHARED_UNSUPPORTED = ["Share flight and physics", "Pass control between each other", "Share Traffic and ATC"]

// Home on a later visit in an aircraft Dual Input has no profile for: what a session still does
// there, as a list, then the two ways forward as text buttons, as Continue anyway is in setup, one
// below the other under their own lead-in. Each lead-in sits close over what it leads to.
// Switching opens the aircraft picker. Learning to build a profile is to open the pilot's browser,
// so its button says it leaves the app, but the page it opens doesn't exist yet, so it's disabled
// until it does, and its tooltip says it's coming soon.
function UnsupportedAircraft() {
  const { Button, Tooltip, TooltipContent, TooltipTrigger } = useUI()
  const [picking, setPicking] = useState(false)
  const leadIn = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          Dual Input has no profile for this aircraft yet
        </h3>
        {leadIn("You can still fly together and:")}
        <ul className="flex flex-col gap-2 pt-1 text-sm">
          {SHARED_UNSUPPORTED.map((what) => (
            <li key={what} className="flex items-center gap-3">
              <Check className="size-4 shrink-0 text-success" />
              {what}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        {leadIn("Other options:")}
        {/* A second list, anchored as the first is: an icon in the checks' column, and their
            rhythm, 8px between lines and 10px under the lead-in. Each link reaches 4px above and
            below its text, so for a VR pointer, which wavers, the two are 28px targets that meet. */}
        <div className="flex flex-col items-start">
          <Button variant="link" className="h-auto gap-3 border-0 px-0 py-1" onClick={() => setPicking(true)}>
            <ArrowRightLeft className="size-4" />
            Switch to a supported aircraft
          </Button>
          {/* Disabled until its page exists. A disabled button takes no pointer events, so the
              tooltip saying why hangs on a wrapper around it. */}
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button variant="link" disabled className="h-auto gap-3 border-0 px-0 py-1">
                <BookOpen className="size-4" />
                <span className="flex items-center gap-1.5">
                  Learn how to build a profile <ExternalLink className="size-3.5" />
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <AircraftPicker open={picking} onOpenChange={setPicking} />
    </section>
  )
}

// The welcome text's place on a pilot's first visit: three pages on how a session works, then the
// aircraft check. Done and Skip guide close it for good, leaving the start card alone, as home is
// on later visits. It says when it starts to leave, and when it's gone.
function WelcomeGuide({ supported, startAt = 0, onLeave, onClose }: { supported: boolean; startAt?: number; onLeave: () => void; onClose: () => void }) {
  const { Button, Card, CardContent } = useUI()
  const [page, setPage] = useState(startAt)
  const [back, setBack] = useState(false)
  // The card eases to the page's height. Coherent GT has no ResizeObserver, so the height is
  // measured after every render, which also catches a page whose content changes while it shows,
  // such as the aircraft check when the pilot loads another aircraft.
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measured = content.current?.offsetHeight
    if (measured !== undefined && measured !== height) setHeight(measured)
  })
  const last = page === PAGES - 1
  // A turn hands over: the page it leaves stays a moment and fades out, then the new one fades in,
  // so the text never cuts, and never shows two pages at once, which read as trippy. Each drifts
  // 6px the way the turn goes. A timer clears the old page, as one ends the guide, and a quicker
  // turn takes the place of one still under way.
  const [from, setFrom] = useState<{ page: number; back: boolean } | null>(null)
  const turned = useRef<number>(undefined)
  const [hasTurned, setHasTurned] = useState(false)
  const go = (to: number) => {
    if (to === page) return
    setHasTurned(true)
    setFrom({ page, back: to < page })
    setBack(to < page)
    setPage(to)
    window.clearTimeout(turned.current)
    turned.current = window.setTimeout(() => setFrom(null), TURN.out)
  }
  useEffect(() => () => window.clearTimeout(turned.current), [])
  // What arrives with a turn waits, unseen, for the old page to go; the first page needs no wait.
  // The wait turns on whether the guide has turned at all, not on the old page still showing,
  // since changing a running animation's delay would jump it ahead.
  const turnIn: React.CSSProperties = { animationDuration: `${TURN.in}ms`, animationDelay: hasTurned ? `${TURN.out}ms` : "0ms", animationFillMode: "backwards" }
  const body = (p: number) =>
    p === PAGES - 1 ? (
      <AircraftCheck supported={supported} />
    ) : (
      <>
        <h3 className="text-base font-semibold">{GUIDE[p].title}</h3>
        <p className="text-sm text-muted-foreground">{GUIDE[p].body}</p>
      </>
    )
  // Closing, it sinks and fades the way it rose, and goes once that's over. A timer ends it rather
  // than the animation's end event, so it goes even where that event never comes.
  const [leaving, setLeaving] = useState(false)
  const close = () => {
    if (leaving) return
    setLeaving(true)
    onLeave()
    window.setTimeout(onClose, LEAVE_MS)
  }
  const title = (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">Welcome to Dual Input</h2>
      {!last && (
        <Button variant="link" className="h-auto border-0 p-0 text-muted-foreground" onClick={close}>
          Skip guide
        </Button>
      )}
    </div>
  )
  const pageView = (
    <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
      <div ref={content} className="relative">
        {/* Keyed by page, so each page drifts in from the side it comes from. Pages before the
            check share one height, the longest's, so the buttons stay put between them. The page
            being left lies over it, out of the flow, so the card eases to the new page's height. */}
        <div key={page} className={"flex min-h-28 animate-in flex-col gap-1.5 px-5 fade-in " + (back ? "slide-in-from-left-[6px]" : "slide-in-from-right-[6px]")} style={turnIn}>
          {body(page)}
        </div>
        {from && (
          <div
            key={`from-${from.page}`}
            aria-hidden
            className={"pointer-events-none absolute top-0 right-0 left-0 flex min-h-28 animate-out flex-col gap-1.5 px-5 fade-out " + (from.back ? "slide-out-to-right-[6px]" : "slide-out-to-left-[6px]")}
            style={{ animationDuration: `${TURN.out}ms`, animationFillMode: "forwards" }}
          >
            {body(from.page)}
          </div>
        )}
      </div>
    </div>
  )
  // The dots sit near the row's bottom edge, 24px from the bottom and 20px from the left.
  const controls = (
    <>
      <div className="mb-1 flex items-center gap-1.5">
        {Array.from({ length: PAGES }, (_, i) => (
          <button
            key={i}
            aria-label={`Page ${i + 1} of ${PAGES}`}
            onClick={() => go(i)}
            className={"h-1.5 rounded-full transition-all " + (i === page ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground")}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        {/* Back fades in with the second page, as the pages do. */}
        {page > 0 && (
          <Button variant="ghost" className="animate-in fade-in" style={turnIn} onClick={() => go(page - 1)}>
            Back
          </Button>
        )}
        <Button variant="secondary" onClick={() => (last ? close() : go(page + 1))}>
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </>
  )
  return (
    // It rises in a beat after the page appears, so the eye lands on it once.
    <section
      className={"flex flex-col gap-3 " + (leaving ? "pointer-events-none animate-out fade-out slide-out-to-bottom-4" : "animate-in duration-500 fade-in slide-in-from-bottom-4")}
      style={leaving ? { animationDuration: `${LEAVE_MS}ms`, animationFillMode: "forwards" } : { animationDelay: "400ms", animationFillMode: "backwards" }}
    >
      {title}
      <Card className="relative [--card-spacing:--spacing(5)]">
        {/* A sky flap in the top-left corner, cut by the card's rounded corner, with a shadow along
            its fold. */}
        <span className="pointer-events-none absolute top-0 left-0 size-[22px]" style={{ background: "linear-gradient(135deg, var(--primary) 50%, transparent 50%)", filter: "drop-shadow(1px 1px 1px rgb(0 0 0 / 0.35))" }} />
        {pageView}
        <CardContent className="flex items-end justify-between gap-3">{controls}</CardContent>
      </Card>
    </section>
  )
}

// The profile authors' notes on the loaded aircraft, from the sketch, which a profile field after
// v1 carries; the page makes room for them now. The notes are examples. They look like something the
// authors slipped in: a slip of paper taped to the page, title included, written by hand.
const HAND: React.CSSProperties = { fontFamily: "Kalam, cursive", fontSize: 17, lineHeight: "28px" }
// Two inks: black for the notes and their dashes, and red pencil for the title and its underline.
const INK = { body: "#1c1b1a", title: "#a33a2c" }

const PAPER = "#cdc2a6"

// Example notes: a short set from the sketch, and a long one that runs past the page. Each is signed
// with the profile's `authors`, free text the profile format shows wherever it credits a profile,
// written as the authors wrote it; the names are hypothetical.
const NOTES = {
  short: {
    authors: "James Smith",
    lead: "Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures.",
    items: ["A pilot who joins late starts the ADF's elapsed timer at 0.", "The KNS-81's 10 waypoints don't sync, so enter them on each machine."],
  },
  long: {
    authors: "James Smith and Alex Doe",
    lead: "Set the tablet's failure rate to 0 on every machine before you fly, since each sim rolls its own failures. Start cold and dark on every machine, and let the pilot flying run the engine start.",
    items: [
      "A pilot who joins late starts the ADF's elapsed timer at 0.",
      "The KNS-81's 10 waypoints don't sync, so enter them on each machine.",
      "The GPS is a separate add-on, so every pilot needs the same version of it, and its flight plan doesn't sync: load the same plan on each machine.",
      "The cabin pressure controller follows the pilot flying's settings, so the other pilot's cabin altitude can lag by a second or two.",
      "The de-ice boots cycle on each machine's own timer, so their lights can blink out of step.",
      "The tablet's own pages don't sync, so each pilot sets up their own.",
    ],
  },
}

// The notes scroll inside the slip when they run past the page, under a title that stays put, and a
// fade at either end shows there's more that way.
function AuthorsNotes({ notes }: { notes: (typeof NOTES)["short"] }) {
  const { ref, onScroll, onMouseDown, above, below, cursor } = useScroller()
  const fade = (to: "top" | "bottom", shown: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, ${PAPER}, transparent)`, opacity: shown ? 1 : 0 })
  return (
    // Manila paper, turned a little off square, with a strip of tape at the top. It's darker than
    // white paper, so it doesn't outshine the dark page around it.
    <section className="relative mx-1 flex min-h-0 flex-col rounded-[2px] px-5 pt-3.5" style={{ ...HAND, background: PAPER, color: INK.body, transform: "rotate(-0.8deg)", boxShadow: "0 8px 18px rgb(0 0 0 / 0.4)" }}>
      <span className="absolute -top-2.5 left-1/2 h-5 w-20" style={{ background: "rgb(226 218 196 / 0.55)", transform: "translateX(-50%) rotate(2deg)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.15)" }} />
      <h2 className="relative shrink-0 self-start font-bold" style={{ color: INK.title, fontSize: 19 }}>
        Notes from the profile authors
        {/* A quick, slightly uneven stroke under the title. */}
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" fill="none" aria-hidden className="absolute bottom-0 left-0 h-1.5 w-full">
          <path d="M1 4C22 2.2 46 4.6 70 3C82 2.3 92 2.8 99 3.6" stroke={INK.title} strokeWidth={1.8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </h2>
      {/* The 8px between the title and the notes, and the 16px under them, are the scroller's own
          padding, so they scroll away with the notes: the fades start right at the underline and
          the slip's bottom edge, and the scrollbar's track keeps to the text between. The scroller reaches
          12px into the slip's 20px right padding, so its 6px scrollbar sits 8px from the slip's
          edge, with the same 8px between it and the text. The scrollbar is
          styled through ::-webkit-scrollbar, which Coherent GT keeps, where it drops
          scrollbar-color and scrollbar-width. */}
      <div className="relative -mr-3 flex min-h-0 flex-col">
        <div
          ref={ref}
          onScroll={onScroll}
          onMouseDown={onMouseDown}
          className={
            "min-h-0 overflow-y-auto pt-2 pr-2 pb-4 select-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[rgb(28_27_26/0.3)] [&::-webkit-scrollbar-track]:mt-2 [&::-webkit-scrollbar-track]:mb-4 [&::-webkit-scrollbar-track]:bg-transparent " +
            cursor
          }
        >
          <p>{notes.lead}</p>
          <ul>
            {notes.items.map((note) => (
              <li key={note} className="relative pl-5">
                <span className="absolute left-0">–</span>
                {note}
              </li>
            ))}
          </ul>
          {/* The authors sign at the end, like a letter, and a profile with no authors leaves the
              line out. */}
          {notes.authors && <p className="mt-1 text-right">— {notes.authors}</p>}
        </div>
        {/* The fades stop short of the scrollbar and its gap. */}
        <div className="pointer-events-none absolute top-0 right-3.5 left-0 h-12 transition-opacity duration-200" style={fade("top", above)} />
        <div className="pointer-events-none absolute right-3.5 bottom-0 left-0 h-12 transition-opacity duration-200" style={fade("bottom", below)} />
      </div>
    </section>
  )
}

// A refusal from our servers, in the tinted box first-time setup's failures use, with the refusal's
// own action where it has one, which asks first, since restarting the sim ends the pilot's flight.
function Refused({ why }: { why: Refusal }) {
  const r: { title: string; detail: string; action?: { label: string; question: string; go: string } } = REFUSALS[why]
  return (
    <div className="flex animate-in flex-col gap-1 rounded-3xl border border-destructive/20 bg-destructive/10 px-5 py-4 duration-200 fade-in">
      <p className="text-sm font-medium text-destructive">{r.title}</p>
      <p className="text-sm text-foreground/75">{r.detail}</p>
      {r.action && (
        <div className="mt-2">
          <ConfirmButton
            label={r.action.label}
            question={r.action.question}
            align="start"
            go={r.action.go}
            onConfirm={() => toast("Restarting the sim to update")}
            className={RED_BUTTON}
          />
        </div>
      )}
    </div>
  )
}

// An attempt taking long: a line of text with Cancel at its end, and no box, since nothing has
// failed; the button that asked keeps its spinner.
function SlowLine({ text, onCancel }: { text: string; onCancel: (from: HTMLElement) => void }) {
  return (
    <p className="animate-in text-sm text-muted-foreground duration-200 fade-in">
      {text}{" "}
      <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => onCancel(e.currentTarget)}>
        Cancel
      </button>
    </p>
  )
}

// The room under a control for its refusal or slow line, easing open to its height and shut to
// none, still showing what it had while it shuts. Coherent GT has no ResizeObserver, so the height
// is measured after every render, as the guide's is.
function UnderSlot({ children }: { children?: React.ReactNode }) {
  const last = useRef(children)
  if (children) last.current = children
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const measured = children ? (inner.current?.offsetHeight ?? 0) : 0
    if (measured !== height) setHeight(measured)
  })
  return (
    <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
      <div ref={inner} className="pt-3">
        {last.current}
      </div>
    </div>
  )
}

// A supported aircraft whose profile has no notes leaves the page's rest to the pilot's figure,
// standing on the right, waiting for them to host; the guide and the start card's own words say
// how. The figure's color is an example.
function NoNotes() {
  const hex = FIGURE_COLORS.find((c) => c.name === "orange")!.hex
  return (
    <div className="relative flex min-h-0 flex-1 justify-end">
      {/* It runs through the page's bottom and right padding, to the tab bar and the window's edge,
          so the figure's legs leave the page at the tab bar rather than ending in the air, and what
          swings right as it falls leaves at the window's edge. */}
      <div className="relative -mr-5 -mb-5 w-[260px] shrink-0 self-stretch">
        <StandingFigure hex={hex} />
      </div>
    </div>
  )
}

// The start card for the loaded aircraft, and under it the page's rest; a frame's servers and play
// go to the card. A loaded aircraft with a maturity has a profile. The header shows what a frame
// says of our servers, the firewall, and an update, and a frame can open it.
function HomePage({ theme, aircraft, servers, play, header, headerOpen, core, session, joinsAfter, checklistExpanded, children }: { theme: Theme; aircraft: Aircraft; servers?: Servers; play?: Action; header?: HeaderStatus; headerOpen?: boolean; core?: Core; session?: SessionKey; joinsAfter?: number; checklistExpanded?: boolean; children: React.ReactNode }) {
  return (
    <AppFrame
      theme={theme}
      status={header}
      headerOpen={headerOpen}
      core={core}
      fixed
    >
      {/* None on top, since the header leaves as much room under its pill as above it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 p-5 pt-0" data-home-page>
        <StartCard aircraft={aircraft} servers={servers} play={play} session={session} joinsAfter={joinsAfter} checklistExpanded={checklistExpanded} />
        {children}
      </div>
    </AppFrame>
  )
}

// After the guide, whichever way it closed, a send-off on the page by itself, in the room the guide
// leaves: it fades in as the guide goes, from a little low, holds, and fades out as it rises on.
// Coherent GT has no @starting-style, so it mounts unseen and a transition brings it in two frames
// later; timers end it, as they end the guide. In milliseconds.
const FAREWELL = { delay: 150, in: 700, hold: 1500, out: 600 }
function Farewell({ onGone }: { onGone: () => void }) {
  const [phase, setPhase] = useState<"mounted" | "shown" | "going">("mounted")
  useEffect(() => {
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setPhase("shown"))))
    const going = window.setTimeout(() => setPhase("going"), FAREWELL.delay + FAREWELL.in + FAREWELL.hold)
    const gone = window.setTimeout(onGone, FAREWELL.delay + FAREWELL.in + FAREWELL.hold + FAREWELL.out)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(going)
      clearTimeout(gone)
    }
    // It runs once, from its mounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shown = phase === "shown"
  return (
    // Raised from the room's middle, where it would look low under the start card.
    <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center pb-16">
      <p
        className="text-lg font-medium text-foreground/90 transition-[opacity,transform] ease-out"
        style={{
          opacity: shown ? 1 : 0,
          transform: `translateY(${phase === "mounted" ? 6 : phase === "shown" ? 0 : -4}px)`,
          transitionDuration: `${phase === "going" ? FAREWELL.out : FAREWELL.in}ms`,
          transitionDelay: shown ? `${FAREWELL.delay}ms` : "0ms",
        }}
      >
        Have a nice flight!
      </p>
    </div>
  )
}

// The aircraft a frame starts in, which it keeps for the aircraft picker: picking one on the world
// map, where home's frames are, loads it, and home follows.
function useLoaded(aircraft: "supported" | "unsupported") {
  const [loaded, setLoaded] = useState(aircraft === "supported" ? LOADED : LOADED_UNSUPPORTED)
  return { loaded, context: { at: "world-map" as const, pick: setLoaded, profiles: PROFILES } }
}

// A frame for the aircraft check opens the guide on its last page.
export function HomeFirstTimeFrame({ theme, aircraft, openOnCheck }: { theme: Theme; aircraft: "supported" | "unsupported"; openOnCheck?: boolean }) {
  const { loaded, context } = useLoaded(aircraft)
  const [guiding, setGuiding] = useState(true)
  const [farewell, setFarewell] = useState(false)
  return (
    <AircraftContext.Provider value={context}>
      <HomePage theme={theme} aircraft={loaded}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {guiding && <WelcomeGuide supported={!!loaded.maturity} startAt={openOnCheck ? PAGES - 1 : 0} onLeave={() => setFarewell(true)} onClose={() => setGuiding(false)} />}
          {farewell && <Farewell onGone={() => setFarewell(false)} />}
        </div>
      </HomePage>
    </AircraftContext.Provider>
  )
}

// Home on a later visit: the authors' notes, or the figure when there are none, and in an aircraft
// Dual Input has no profile for, which has no notes to show, what a session there shares, with the
// aircraft picker a press away. A frame also says how our servers, faked, answer, and can play
// hosting or joining by itself, what the header shows and whether it opens out, how the link to
// the service stands, and whether it opens on a session, which one, with whom, whether a crewmate
// joins it a while later, and whether the checklist has the page.
export function HomeLaterFrame({ theme, aircraft, notes, servers, play, header, headerOpen, core, session, joinsAfter, checklistExpanded }: { theme: Theme; aircraft: "supported" | "unsupported"; notes?: keyof typeof NOTES; servers?: Servers; play?: Action; header?: HeaderStatus; headerOpen?: boolean; core?: Core; session?: SessionKey; joinsAfter?: number; checklistExpanded?: boolean }) {
  const { loaded, context } = useLoaded(aircraft)
  return (
    <AircraftContext.Provider value={context}>
      <HomePage theme={theme} aircraft={loaded} servers={servers} play={play} header={header} headerOpen={headerOpen} core={core} session={session} joinsAfter={joinsAfter} checklistExpanded={checklistExpanded}>
        {/* A session's page ends at the card: the authors' notes are for before it (user,
            2026-10-29), and the figure leaps off the page when a session starts. */}
        {session ? null : !loaded.maturity ? (
          <UnsupportedAircraft />
        ) : notes ? (
          <AuthorsNotes notes={NOTES[notes]} />
        ) : (
          <NoNotes />
        )}
      </HomePage>
    </AircraftContext.Provider>
  )
}

// Home while the service restarts after a crash: the window dims under the line that it's
// reconnecting, and comes back as it was once the service does, here after this many milliseconds.
const RECONNECTS_AFTER = 5000
export function ReconnectingFrame({ theme }: { theme: Theme }) {
  const [core, setCore] = useState<Core>("reconnecting")
  useEffect(() => {
    const t = window.setTimeout(() => setCore("connected"), RECONNECTS_AFTER)
    return () => window.clearTimeout(t)
  }, [])
  return <HomeLaterFrame theme={theme} aircraft="supported" core={core} />
}

// Every refusal's message in a card like the start card, so each shows at the width and on the
// background it has there, under a line saying when it shows.
function RefusalsSheet() {
  const { Card, CardContent } = useUI()
  return (
    <div className="p-5">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col gap-6">
          {(Object.keys(REFUSALS) as Refusal[]).map((why) => (
            <div key={why} className="flex flex-col gap-2">
              <Label>{REFUSED_WHEN[why]}</Label>
              <Refused why={why} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
// The sheet takes the kit from the frame's context, so it's drawn inside the frame.
export function RefusalsFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <RefusalsSheet />
    </AppFrame>
  )
}

// Every place a crewmate can be before preflight, as their row in the host's crew list, and every
// way a joiner can stand toward the pilot flying, as that pilot's row in theirs, each in a card
// like the session's under a line saying when it shows.
function SessionSheet({ children }: { children: React.ReactNode }) {
  const { Card, CardContent } = useUI()
  return (
    <div className="p-5">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>
    </div>
  )
}
export function CrewmateStatesFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <SessionSheet>
        {(Object.keys(WHERE) as Whereabouts[]).map((at) => (
          <div key={at} className="flex flex-col gap-2">
            <Label>{WHERE[at].when}</Label>
            <ul>
              <CrewRow pilot={{ ...JAMES, at }} />
            </ul>
          </div>
        ))}
      </SessionSheet>
    </AppFrame>
  )
}
export function WaysFrame({ theme }: { theme: Theme }) {
  return (
    <AppFrame theme={theme} header={false} tabs={false}>
      <SessionSheet>
        {(Object.keys(WAYS) as Way[]).map((way) => (
          <div key={way} className="flex flex-col gap-2">
            <Label>{WAYS[way].when}</Label>
            <ul>
              <CrewRow pilot={{ ...JAMES, flying: true, way }} />
            </ul>
          </div>
        ))}
      </SessionSheet>
    </AppFrame>
  )
}
