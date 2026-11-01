// The notification banner: Dual Input's in-game panel over the cockpit, which tells a pilot what
// needs them while they fly, with the EFB open or not, in VR as on a monitor
// (record/areas/product/03-v1-scope.md, Notification banner). It sits in the screen's top right,
// one card wide, its cards stacking down from the top with the newest first, and during preflight
// the preflight summary leads (user, 2026-11-01). The panel is a fixed box, and whether clicks
// pass through its empty part is untested, so the box is only as tall as the summary and two
// notifications, which keeps it above the instrument panel.
// The sim blurs whatever lies behind the pixels a panel paints (record/areas/interface/log.md,
// 2026-10-04), so every card is opaque: its edge is an inset ring over its own fill, and it casts
// no shadow, since a translucent pixel shows the blurred cockpit through it (user, 2026-11-01:
// "let's cancel blur").
// What each notification is, and which go elsewhere, are the content call of 2026-11-01 in the
// stage notes. The words are drafts.
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CircleX, Hand, Info, TriangleAlert } from "lucide-react"

import { ThemeContext, UI, UIContext, useUI } from "@/bench/ui"
import { themeVars, type Theme } from "@/bench/theme"
import { FIGURE_COLORS } from "./figure-portrait"
import { Head } from "./figure-head"
import { COUNTDOWN, CountdownRing, ReadyButton, StripHead, type HeadState, type Pilot } from "./home"

// The banner's box on a 1920 by 1080 screen, in pixels: one card wide, 16px in from the screen's
// top and right edges, and as tall as the preflight summary and two notifications. The sim sizes a
// panel in percents of the screen's height (record/areas/interface/log.md, 2026-10-04), so the box
// is about 33% of the height wide and 28% tall.
export const BANNER = { width: 360, inset: 16, gap: 8, height: 300 }
export const SCREEN = { width: 1920, height: 1080 }

// A stand-in for the cockpit behind the banner: a daytime sky through the windshield, and on the
// full screen the glare shield and the panel's displays under it, so the box's size and place can
// be judged. The cards are opaque, so what's behind them doesn't change how they read.
const SKY = "linear-gradient(180deg, #56738f 0%, #7d96ab 60%, #a3b5c3 100%)"

const YOU: Pilot = { name: "You", hue: "orange" }
const JAMES: Pilot = { name: "James", hue: "red" }
const ADAM: Pilot = { name: "Adam", hue: "green" }
const hexOf = (hue: string) => FIGURE_COLORS.find((c) => c.name === hue)!.hex

// A notification is information, a warning, or trouble that costs the pilot a feature, as the
// record has them (record/areas/core/02-clients-and-panel-bridge.md, What a unit registers and
// calls). One about a crewmate, or about who has control, leads with that pilot's head, slumped
// while they're out of the flight, as the crew rows draw it; one about something happening now
// that ends by itself, catching up, leads with a spinner in a neutral color, as the take-control
// strip's line does; the rest lead with their level's icon, as the header's rows do.
type Level = "info" | "warning" | "trouble"
type Note = { level: Level; title: string; detail?: string; list?: string[]; who?: Pilot; out?: boolean; busy?: boolean }
const LEVEL_ICON: Record<Level, React.ReactNode> = {
  info: <Info className="size-4 text-info" />,
  warning: <TriangleAlert className="size-4 text-warning" />,
  trouble: <CircleX className="size-4 text-destructive" />,
}

// Each notification on the banner, with when it shows. A held one stays while its cause lasts; the
// rest stay 6s, longer while the pointer rests on one. A notification's title has no period, and its
// detail is sentences, as the header's rows are. The names, the key, and the controls are examples.
export const NOTES = {
  "control-you": { when: "Control passes to you", note: { level: "info", who: YOU, title: "You have control" } },
  "control-them": { when: "Control passes to another pilot", note: { level: "info", who: JAMES, title: "James has control" } },
  "control-left": { when: "Control passes to you as the pilot flying leaves the flight", note: { level: "info", who: YOU, title: "You have control", detail: "James left the flight." } },
  "refused-catch-up": { when: "Take control refused while you catch up", note: { level: "warning", title: "Couldn't take control", detail: "You're catching up with James." } },
  "lost-pf": { when: "No link to the pilot flying, held", note: { level: "warning", title: "Reconnecting to James", detail: "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect." } },
  "taken-while-away": { when: "Back after another pilot took control while your link was lost", note: { level: "warning", title: "Adam took control while you were disconnected", detail: "What you changed in that time was undone, and your pages and FMS entries may differ from Adam's." } },
  "catching-up": { when: "Catching up, after joining late or after a short outage, held", note: { level: "info", busy: true, title: "Catching up with James", detail: "Anything you move in the cockpit now will be reset." } },
  "caught-up": { when: "Caught up after joining late", note: { level: "info", title: "Caught up with James", detail: "Pages and FMS entries may still differ from James's." } },
  "caught-up-outage": { when: "Caught up after a short outage", note: { level: "info", title: "Caught up with James" } },
  pause: { when: "The pilot flying in the pause menu, held, on the others' banners", note: { level: "info", who: JAMES, title: "James has paused" } },
  left: { when: "A crewmate goes to the menu or another flight", note: { level: "info", who: ADAM, out: true, title: "Adam left the flight", detail: "They're still in the session." } },
  closed: { when: "A crewmate closes their sim", note: { level: "info", who: ADAM, out: true, title: "Adam closed their sim", detail: "They're still in the session." } },
  crashed: { when: "A crewmate's sim crashes", note: { level: "warning", who: ADAM, out: true, title: "Adam's sim crashed", detail: "They're still in the session." } },
  "left-session": { when: "A crewmate leaves the session", note: { level: "info", who: ADAM, out: true, title: "Adam left the session" } },
  back: { when: "A crewmate is back in the flight", note: { level: "info", who: ADAM, title: "Adam is back in the flight" } },
  "service-reconnecting": { when: "The service's link lost, held", note: { level: "trouble", title: "Reconnecting to the Dual Input service", detail: "Nothing syncs until it's back." } },
  "service-down": { when: "The service not running, held", note: { level: "trouble", title: "Dual Input service isn't running", detail: "Nothing syncs until it's back. Open it from the Start menu." } },
  "sync-one": { when: "A control that never matched, once per control for each load", note: { level: "warning", title: "Couldn't sync Beacon", detail: "Yours may differ from James's." } },
  "sync-several": { when: "Several at one load, as one notification", note: { level: "warning", title: "Couldn't sync 3 controls", detail: "Yours may differ from James's:", list: ["Beacon", "Taxi light", "Fuel pump 2"] } },
  bridge: { when: "The panel bridge didn't load, held", note: { level: "trouble", title: "Cockpit screens aren't syncing", detail: "Dual Input couldn't load into the cockpit's panels. Another add-on that replaces VCockpit.js is the likeliest cause." } },
  "module-stopped": { when: "Our module stopped, held", note: { level: "trouble", title: "Dual Input's WASM module stopped", detail: "Restart the sim to fly together again." } },
  "module-missing": { when: "Our module's file missing from a package that loaded, held", note: { level: "trouble", title: "Dual Input's WASM module is missing", detail: "Reinstall Dual Input with the sim closed to fly together again." } },
  helper: { when: "The Windows helper down, held", note: { level: "trouble", title: "Dual Input's Windows helper is down", detail: "Keybinds, audio, and your figure's pointing won't work until it's back." } },
  want: { when: "A feature's want the helper can't carry out, held", note: { level: "warning", title: "Your take-control key isn't working", detail: "Windows didn't let Dual Input listen for F9." } },
  seat: { when: "This pilot's camera in another figure's seat, held", note: { level: "info", who: JAMES, title: "This seat is taken" } },
} satisfies Record<string, { when: string; note: Note }>
export type NoteKey = keyof typeof NOTES

// A card's fill and edge, which every card on the banner shares. The kit's card draws its edge as an
// outer ring; this one's is inset, so it lies over the card's own fill rather than over the cockpit.
const CARD = "w-full rounded-3xl bg-card text-card-foreground inset-ring inset-ring-foreground/10"

// A click anywhere on a card opens Dual Input's app on the EFB, on Home; where each notification
// lands waits for the frames (user, 2026-11-01).
const openEfb = () => toast("Opening Dual Input on the EFB")

function NoteCard({ note }: { note: Note }) {
  const { Spinner } = useUI()
  // A head is 28px, taller than the title's line, so a card led by one centers on it; an icon
  // stands in a box the title's line tall, so it centers on the title whatever follows it.
  const lead = note.who ? (
    <span className="flex shrink-0">
      <Head hex={hexOf(note.who.hue)} slumped={note.out} />
    </span>
  ) : (
    <span className="flex h-5 shrink-0 items-center">{note.busy ? <Spinner className="size-4 text-muted-foreground" /> : LEVEL_ICON[note.level]}</span>
  )
  return (
    <button type="button" onClick={openEfb} className={CARD + " flex gap-3 px-4 py-3 text-left outline-none hover:bg-muted focus-visible:inset-ring-ring " + (note.who ? "items-center" : "items-start")}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{note.title}</span>
        {note.detail && <span className="text-xs text-muted-foreground">{note.detail}</span>}
        {note.list && (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {note.list.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </span>
    </button>
  )
}

// The preflight summary, which leads the banner from the moment preflight starts until the flight
// does (record/areas/product/03-v1-scope.md, Notification banner): the folded session card's row,
// every pilot's head badged ready, not ready, or out, then this pilot's Ready with the countdown's
// ring before it once it runs; then home's hand line, in its words, for every pilot; for the pilot
// flying, where the checklist is; and the match check's differences as counts, which the EFB app
// lists. Ready is the card's one action, and a click anywhere else on it opens the EFB app, as a
// notification's does. The countdown here holds at its last second, where the flight would start.
export type Summary = { pf: boolean; crew: { pilot: Pilot; state: HeadState }[]; settled?: boolean; ready?: boolean; errors?: number; warnings?: number }
function useCountdown(on: boolean) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!on) return setLeft(null)
    setLeft(COUNTDOWN)
    const tick = window.setInterval(() => setLeft((l) => (l !== null && l > 1 ? l - 1 : l)), 1000)
    return () => window.clearInterval(tick)
  }, [on])
  return left
}
function PreflightCard({ summary }: { summary: Summary }) {
  const [ready, setReady] = useState(!!summary.ready)
  const left = useCountdown(ready && summary.crew.every((c) => c.state === "ready"))
  const heads = [{ pilot: YOU, state: (ready ? "ready" : "waiting") as HeadState }, ...summary.crew]
  return (
    <div role="button" tabIndex={0} onClick={openEfb} className={CARD + " flex cursor-pointer flex-col gap-2 px-4 py-3 outline-none hover:bg-muted focus-visible:inset-ring-ring"}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          {heads.map(({ pilot, state }) => (
            <StripHead key={pilot.name} pilot={pilot} state={state} />
          ))}
        </span>
        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <CountdownRing left={left} />
          <ReadyButton ready={ready} settled={summary.settled ?? true} onToggle={() => setReady((r) => !r)} />
        </span>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-info">
        <Hand className="mt-px size-3.5 shrink-0" />
        Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.
      </p>
      {summary.pf && <p className="text-xs text-muted-foreground">Your preflight checklist is in Dual Input's EFB app</p>}
      {(summary.errors || summary.warnings) && (
        <p className="flex items-center gap-3 text-xs">
          {!!summary.errors && (
            <span className="flex items-center gap-1 text-destructive">
              <CircleX className="size-3.5" />
              {summary.errors}
            </span>
          )}
          {!!summary.warnings && (
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3.5" />
              {summary.warnings}
            </span>
          )}
          <span className="text-muted-foreground">Differences between your setups</span>
        </p>
      )}
    </div>
  )
}

// The banner's stack: the preflight summary first while preflight runs, then the notifications,
// newest first, 8px apart. With more than fit the box, the oldest of those that stay 6s leaves
// early, and the held ones stay.
function Stack({ summary, notes }: { summary?: Summary; notes: NoteKey[] }) {
  return (
    <div className="flex flex-col" style={{ width: BANNER.width, gap: BANNER.gap }}>
      {summary && <PreflightCard summary={summary} />}
      {notes.map((k) => (
        <NoteCard key={k} note={NOTES[k].note} />
      ))}
    </div>
  )
}

// What every banner frame shares: the theme and the kit, as the app's frame gives them.
function Themed({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  const ui = UI[theme.preset] ?? UI.nova
  return (
    <ThemeContext.Provider value={theme}>
      <UIContext.Provider value={ui}>
        <div className="dark font-sans text-foreground" style={themeVars(theme) as React.CSSProperties}>
          {children}
        </div>
      </UIContext.Provider>
    </ThemeContext.Provider>
  )
}

// The screen's top right corner, as wide as the EFB's frames, with the banner at its place.
export function BannerFrame({ theme, summary, notes = [] }: { theme: Theme; summary?: Summary; notes?: NoteKey[] }) {
  return (
    <Themed theme={theme}>
      <div className="flex justify-end overflow-hidden rounded-xl" style={{ background: SKY, padding: `${BANNER.inset}px ${BANNER.inset}px 48px` }}>
        <Stack summary={summary} notes={notes} />
      </div>
    </Themed>
  )
}

// Every notification at once, each under when it shows, in the banner's column.
export function EveryNotificationFrame({ theme }: { theme: Theme }) {
  return (
    <Themed theme={theme}>
      <div className="flex justify-end overflow-hidden rounded-xl" style={{ background: SKY, padding: `${BANNER.inset}px ${BANNER.inset}px 48px` }}>
        <div className="flex flex-col gap-4" style={{ width: BANNER.width }}>
          {(Object.keys(NOTES) as NoteKey[]).map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <span className="text-xs text-white/85">{NOTES[k].when}</span>
              <NoteCard note={NOTES[k].note} />
            </div>
          ))}
        </div>
      </div>
    </Themed>
  )
}

// The whole screen at its size, with the banner's box outlined at its place, holding the
// preflight summary and two notifications, the most it's sized for.
const DISPLAYS = [
  { left: 330, width: 300 },
  { left: 660, width: 300 },
  { left: 990, width: 300 },
  { left: 1320, width: 300 },
]
export function BannerOnScreenFrame({ theme, summary, notes }: { theme: Theme; summary: Summary; notes: NoteKey[] }) {
  const panelTop = Math.round(SCREEN.height * 0.56)
  return (
    <Themed theme={theme}>
      <div className="relative overflow-hidden rounded-xl" style={{ width: SCREEN.width, height: SCREEN.height, background: SKY }}>
        <div className="absolute inset-x-0 bottom-0" style={{ top: panelTop, background: "#2a2d31" }}>
          <div className="absolute inset-x-0 top-0 h-10" style={{ background: "#1e2023" }} />
          {DISPLAYS.map((d) => (
            <div key={d.left} className="absolute rounded-md" style={{ left: d.left, width: d.width, top: 90, height: 260, background: "#0d1014" }} />
          ))}
        </div>
        <div className="absolute border border-dashed border-sky-300/80" style={{ top: BANNER.inset, right: BANNER.inset, width: BANNER.width, height: BANNER.height }}>
          <span className="absolute top-full right-0 pt-1.5 text-xs whitespace-nowrap text-white/85">
            The banner's box, {BANNER.width} by {BANNER.height}
          </span>
        </div>
        <div className="absolute" style={{ top: BANNER.inset, right: BANNER.inset }}>
          <Stack summary={summary} notes={notes} />
        </div>
      </div>
    </Themed>
  )
}

// The preflight summaries the frames show: this pilot flying, with a crewmate ready and the
// match check's differences; one of the others, with the pilot flying ready; before this pilot's
// aircraft has settled, so Ready waits; everyone ready, with the countdown running; and a crewmate
// out of the flight.
export const SUMMARIES = {
  pf: { pf: true, crew: [{ pilot: ADAM, state: "ready" }], errors: 1, warnings: 2 },
  others: { pf: false, crew: [{ pilot: { ...JAMES, flying: true }, state: "ready" }], warnings: 1 },
  settling: { pf: false, settled: false, crew: [{ pilot: { ...JAMES, flying: true }, state: "waiting" }] },
  counting: { pf: false, ready: true, crew: [{ pilot: { ...JAMES, flying: true }, state: "ready" }], warnings: 1 },
  out: { pf: true, crew: [{ pilot: ADAM, state: "out" }], errors: 1, warnings: 2 },
} satisfies Record<string, Summary>
