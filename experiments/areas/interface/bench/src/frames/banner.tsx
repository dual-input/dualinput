// The notification banner: Dual Input's in-game panel over the cockpit, which tells a pilot what
// needs them while they fly, with the EFB open or not, in VR as on a monitor
// (record/areas/product/03-v1-scope.md, Notification banner). It sits at the screen's right, about
// three notifications' height down from the top, one card wide, its cards stacking down from its
// top with the newest first, and during preflight the preflight summary leads (user, 2026-11-01).
// The panel is a fixed box, and whether clicks pass through its empty part is untested, so the box
// is only as tall as the summary and three notifications, which keeps it above the instrument
// panel.
// The sim blurs whatever lies behind the pixels a panel paints (record/areas/interface/log.md,
// 2026-10-04), so every card is opaque: its edge is an inset ring over its own fill, and it casts
// no shadow, since a translucent pixel shows the blurred cockpit through it (user, 2026-11-01:
// "let's cancel blur").
// What each notification is, and which go elsewhere, are the content call of 2026-11-01 in the
// stage notes. The words are drafts.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleX, Hand, Info, ListChecks, TriangleAlert, X } from "lucide-react"

import { ThemeContext, UI, UIContext, useUI } from "@/bench/ui"
import { themeVars, type Theme } from "@/bench/theme"
import { FIGURE_COLORS } from "./figure-portrait"
import { Head } from "./figure-head"
import { COUNTDOWN, CountdownRing, ReadyButton, Rolling, StripHead, type HeadState, type Pilot } from "./home"
import { MOMENT, part, Room, useMoment } from "./ease"
import { PART_TROUBLE } from "./shell"

// The banner's box on a 1920 by 1080 screen, in pixels: one card wide, 16px in from the screen's
// right edge, its top 210px down, the height of three notifications with a line of detail each,
// and as tall as the preflight summary and three such notifications (user, 2026-11-01: "make the
// notifications box taller? and move it down say - 3 notification heights"). The sim sizes a panel
// in percents of the screen's height (record/areas/interface/log.md, 2026-10-04), so the box is
// about 33% of the height wide and 36% tall, with its top 19% down.
export const BANNER = { width: 360, inset: 16, top: 210, gap: 8, height: 390 }
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
// calls). One about a crewmate, or about who has control, leads with that pilot's head, facing
// forward, and at 40% opacity while they're out of the flight, as the crew rows' slumped head is,
// where the slump itself read as turned too far at a card's size (user, 2026-11-01: "feel free to
// apply lower opacity in crashes, etc"); one about something happening now
// that ends by itself, catching up, leads with a spinner in a neutral color, as the take-control
// strip's line does; the rest lead with their level's icon, as the header's rows do.
type Level = "info" | "warning" | "trouble"
type Note = { level: Level; title: string; detail?: string; list?: string[]; who?: Pilot; out?: boolean; busy?: boolean; held?: boolean; lands?: Landing }
const LEVEL_ICON: Record<Level, React.ReactNode> = {
  info: <Info className="size-4 text-info" />,
  warning: <TriangleAlert className="size-4 text-warning" />,
  trouble: <CircleX className="size-4 text-destructive" />,
}

// Each notification on the banner, with when it shows. A held one stays while its cause lasts, or
// until the pilot dismisses it; the rest stay 6s, longer while the pointer rests on one. A notification's title has no period, and its
// detail is sentences, as the header's rows are. The names, the key, and the controls are examples.
export const NOTES = {
  "control-you": { when: "Control passes to you", note: { level: "info", who: YOU, title: "You have control" } },
  "control-them": { when: "Control passes to another pilot", note: { level: "info", who: JAMES, title: "James has control" } },
  "control-left": { when: "Control passes to you as the pilot flying leaves the flight", note: { level: "info", who: YOU, title: "You have control", detail: "James left the flight." } },
  "refused-catch-up": { when: "Take control refused while you catch up", note: { level: "warning", title: "Couldn't take control", detail: "You're catching up with James." } },
  "lost-pf": { when: "No link to the pilot flying, held", note: { level: "warning", held: true, title: "Reconnecting to James", detail: "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect." } },
  "taken-while-away": { when: "Back after another pilot took control while your link was lost", note: { level: "warning", title: "Adam took control while you were disconnected", detail: "What you changed in that time was undone, and your pages and FMS entries may differ from Adam's." } },
  "catching-up": { when: "Catching up, after joining late or after a short outage, held", note: { level: "info", held: true, busy: true, title: "Catching up with James", detail: "Anything you move in the cockpit now will be reset." } },
  "caught-up": { when: "Caught up after joining late", note: { level: "info", title: "Caught up with James", detail: "Pages and FMS entries may still differ from James's." } },
  "caught-up-outage": { when: "Caught up after a short outage", note: { level: "info", title: "Caught up with James" } },
  pause: { when: "The pilot flying in the pause menu, held, on the others' banners", note: { level: "info", held: true, who: JAMES, title: "James has paused" } },
  left: { when: "A crewmate goes to the menu or another flight", note: { level: "info", who: ADAM, out: true, title: "Adam left the flight", detail: "They're still in the session." } },
  closed: { when: "A crewmate closes their sim", note: { level: "info", who: ADAM, out: true, title: "Adam closed their sim", detail: "They're still in the session." } },
  crashed: { when: "A crewmate's sim crashes", note: { level: "warning", who: ADAM, out: true, title: "Adam's sim crashed", detail: "They're still in the session." } },
  "left-session": { when: "A crewmate leaves the session", note: { level: "info", who: ADAM, out: true, title: "Adam left the session" } },
  back: { when: "A crewmate is back in the flight", note: { level: "info", who: ADAM, title: "Adam is back in the flight" } },
  "service-reconnecting": { when: "The service's link lost, held", note: { level: "trouble", lands: "stay", held: true, title: "Reconnecting to the Dual Input service", detail: "Nothing syncs until it's back." } },
  "service-down": { when: "The service not running, held", note: { level: "trouble", lands: "stay", held: true, title: "Dual Input service isn't running", detail: "Nothing syncs until it's back. Open it from the Start menu." } },
  "sync-one": { when: "A control that never matched, once per control for each load", note: { level: "warning", title: "Couldn't sync Beacon", detail: "Yours may differ from James's." } },
  "sync-several": { when: "Several at one load, as one notification", note: { level: "warning", title: "Couldn't sync 3 controls", detail: "Yours may differ from James's:", list: ["Beacon", "Taxi light", "Fuel pump 2"] } },
  bridge: { when: "The panel bridge didn't load, held", note: { level: "trouble", lands: "header", held: true, ...PART_TROUBLE.bridge } },
  "module-stopped": { when: "Our module stopped, held", note: { level: "trouble", lands: "header", held: true, ...PART_TROUBLE["module-stopped"] } },
  "module-missing": { when: "Our module's file missing from a package that loaded, held", note: { level: "trouble", lands: "header", held: true, ...PART_TROUBLE["module-missing"] } },
  helper: { when: "The Windows helper down, held", note: { level: "trouble", lands: "header", held: true, ...PART_TROUBLE.helper } },
  want: { when: "A feature's want the helper can't carry out, held", note: { level: "warning", lands: "header", held: true, ...PART_TROUBLE.want } },
  seat: { when: "This pilot's camera in another figure's seat, held", note: { level: "info", lands: "figures", held: true, who: JAMES, title: "This seat is taken" } },
} satisfies Record<string, { when: string; note: Note }>
export type NoteKey = keyof typeof NOTES

// Every card's edge is an inset ring, where the kit's card draws an outer one, so it lies over the
// card's own fill rather than over the cockpit (LAYER).

// A click anywhere on a card opens Dual Input's app on the EFB where the notification is explained or
// acted on (user, 2026-11-01: "yes", to my table): the Session tab, where the take-control strip,
// the crew rows, the checklist, and the differences are, for control, the crew, catching up, sync,
// and preflight; the header opened on the row that repeats it, for trouble in Dual Input's own
// parts; the Figures tab, which explains seats, for a seat that's taken; and wherever the app was
// for the service gone, since the app's own screen for that covers every tab. The order that opens
// the EFB carries where to land (record/areas/interface/01-apps.md, Notifications, left that
// open).
type Landing = "session" | "figures" | "header" | "stay"
const LANDS_ON: Record<Landing, string> = {
  session: "Opening the Session tab on the EFB",
  figures: "Opening the Figures tab on the EFB",
  header: "Opening Dual Input's status on the EFB",
  stay: "Opening Dual Input on the EFB",
}
const openEfb = (lands: Landing = "session") => toast(LANDS_ON[lands])

// A card's padding is 12px on every side, so a head sits as far from the card's top as from its side
// (user, 2026-11-01: 12px above and below and 16px at the sides "aren't symmetric", then "try
// 12px instead of 16"). A card nudges down 1px while it's pressed, as the kit's buttons do,
// through `transform`, since Coherent GT has no `translate` property, and from mouse events, since
// it has no PointerEvent (user, 2026-11-01). Its click is a layer under its content, which lets
// presses through to it, so hovering its × lights the × and not the card (user, 2026-11-01), with
// no `:has()`, which Coherent GT isn't measured to have; the layer carries the card's edge, since
// its hover fill would cover an edge drawn under it.
function useCardPress() {
  const [pressed, setPressed] = useState(false)
  return {
    pressed,
    handlers: {
      onMouseDown: (e: React.MouseEvent) => e.button === 0 && setPressed(true),
      onMouseUp: () => setPressed(false),
      onMouseLeave: () => setPressed(false),
    },
  }
}
const LAYER = "absolute inset-0 rounded-[inherit] inset-ring inset-ring-foreground/10 outline-none hover:bg-muted focus-visible:inset-ring-ring"

// A notification goes when its × is pressed, or when it's dragged toward the screen's edge, as a
// desktop's notifications are (user, 2026-11-01: "how does one dismiss notifications (even held
// ones, since they can be annoying if the user can't fix them in the moment)?"). The × is always
// shown, in the muted color, since one that shows only on hover is hard to find, and it's a 28px
// target, as Figures' swatches are, for a VR pointer, 8px in from the card's right, and 8px down from
// its top, so the ×s line up down the stack, or on a card that's only a title, centered on its
// height (user, 2026-11-01: "x button alignments are off between messages", then "for title only
// notifications we vertically center the x button"). A press
// becomes a drag only past 6px, so a pointer that wobbles still clicks; the card follows it to the
// right only, fading as it goes, and let go past a third of its width, or flung faster than
// 0.5px/ms, it slides away, or else springs back. A held notification that's dismissed stays
// hidden until its cause ends, and shows again if it comes back. The × sends a card away as a
// drag let go does, sliding right and fading (user, 2026-11-01).
const DRAG = { start: 6, away: 1 / 3, fling: 0.5, ms: 200 }
function useDragAway(onAway?: () => void) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const moved = useRef(false)
  const away = (width: number) => {
    setDx(width + BANNER.inset)
    window.setTimeout(() => onAway?.(), DRAG.ms)
  }
  const start = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || !onAway) return
    moved.current = false
    const el = e.currentTarget
    // The canvas zooms its frames, so a screen pixel is this many of the card's.
    const scale = el.getBoundingClientRect().width / el.offsetWidth
    const width = el.offsetWidth
    const x0 = e.clientX
    let last = { x: x0, t: performance.now() }
    let speed = 0
    let d = 0
    const move = (m: MouseEvent) => {
      d = Math.max(0, (m.clientX - x0) / scale)
      if (!moved.current && d < DRAG.start) return
      moved.current = true
      const now = performance.now()
      speed = (m.clientX - last.x) / scale / Math.max(1, now - last.t)
      last = { x: m.clientX, t: now }
      setDragging(true)
      setDx(d)
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      setDragging(false)
      if (!moved.current) return
      if (d > width * DRAG.away || speed > DRAG.fling) away(width)
      else setDx(0)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }
  return { dx, dragging, start, moved, away }
}

// A held notification whose news moves on, as catching up does into caught up, changes in place,
// in the page's moment (ease.tsx): its words fade out, the card eases to the new words' height, and
// they fade in. One that isn't held goes after its lifetime, which pauses while the pointer rests on
// the card, so it stays as the pilot reaches for it (record/areas/interface/01-apps.md,
// Notifications).
function NoteCard({ note: given, noteKey, onDismiss, lifetime, onExpire }: { note: Note; noteKey: string; onDismiss?: () => void; lifetime?: number; onExpire?: () => void }) {
  const { Button, Spinner } = useUI()
  const press = useCardPress()
  const drag = useDragAway(onDismiss)
  const card = useRef<HTMLDivElement>(null)
  const moment = useMoment(noteKey, given)
  const note = moment.shown
  const expire = useRef(onExpire)
  useEffect(() => {
    expire.current = onExpire
  })
  useEffect(() => {
    const el = card.current
    if (!lifetime || !el) return
    let left = lifetime
    let since = performance.now()
    let timer = window.setTimeout(() => expire.current?.(), left)
    const pause = () => {
      window.clearTimeout(timer)
      left -= performance.now() - since
    }
    const resume = () => {
      since = performance.now()
      timer = window.setTimeout(() => expire.current?.(), left)
    }
    el.addEventListener("mouseenter", pause)
    el.addEventListener("mouseleave", resume)
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener("mouseenter", pause)
      el.removeEventListener("mouseleave", resume)
    }
  }, [noteKey, lifetime])
  // A head is 28px, taller than the title's line, so a card led by one centers on it; an icon
  // stands in a box the title's line tall, so it centers on the title whatever follows it.
  const lead = note.who ? (
    <span className={"flex shrink-0 " + (note.out ? "opacity-40" : "")}>
      <Head hex={hexOf(note.who.hue)} />
    </span>
  ) : (
    <span className="flex h-5 shrink-0 items-center">{note.busy ? <Spinner className="size-4 text-muted-foreground" /> : LEVEL_ICON[note.level]}</span>
  )
  const width = card.current?.offsetWidth ?? BANNER.width
  return (
    <div
      ref={card}
      className="relative w-full rounded-4xl bg-card text-card-foreground"
      style={{
        transform: `translateX(${drag.dx}px)${press.pressed && !drag.moved.current ? " translateY(1px)" : ""}`,
        opacity: Math.max(0, 1 - drag.dx / width),
        transition: drag.dragging ? "none" : `transform ${DRAG.ms}ms ease-out, opacity ${DRAG.ms}ms ease-out`,
      }}
    >
      <button
        type="button"
        aria-label="Open Dual Input on the EFB"
        onClick={() => !drag.moved.current && openEfb(note.lands)}
        {...press.handlers}
        onMouseDown={(e) => {
          press.handlers.onMouseDown(e)
          drag.start(e)
        }}
        className={LAYER}
      />
      <Room open>
        <div className={"pointer-events-none relative flex gap-3 p-3 " + (note.who ? "items-center" : "items-start")} style={part(moment.stage, true)}>
          {lead}
          <span className={"flex min-w-0 flex-1 flex-col gap-0.5 " + (onDismiss ? "pr-7" : "")}>
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
        </div>
      </Room>
      {onDismiss && (
        <span className={"absolute right-2 flex items-center " + (note.detail || note.list ? "top-2" : "inset-y-0")}>
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => drag.away(width)} className="text-muted-foreground">
            <X />
          </Button>
        </span>
      )}
    </div>
  )
}

// The preflight summary, which leads the banner from the moment preflight starts until the flight
// does (record/areas/product/03-v1-scope.md, Notification banner): the folded session card's row,
// every pilot's head badged ready, not ready, or out, then this pilot's Ready with the countdown's
// ring before it once it runs; then, 12px under that row, its lines, 6px apart, each led by an icon
// in one column so their words start in one place: home's hand line, in its words, for every
// pilot; for the pilot flying, where the checklist is; and the match check's differences, counted
// and led by the worst one's icon, which the EFB app lists (user, 2026-11-01: "fix the spacing
// between the elements"). Ready is the card's one action, and a click anywhere else on it opens
// the EFB app, as a notification's does. That click is a layer of its own under the card's
// content, which lets presses through to it, so hovering Ready lights Ready and not the card (user,
// 2026-11-01), with no `:has()`, which Coherent GT isn't measured to have; the layer carries the
// card's edge, since its hover fill would cover an edge drawn by the card under it. Pressing the
// layer nudges the whole card down 1px, as a notification's press does. It has no ×: it's the
// banner's whole job during preflight, it leaves when the flight starts, and the toolbar's button
// closes the banner. When the countdown ends, the flight starts, and the summary leaves the banner as
// a card does.
export type Summary = { pf: boolean; crew: { pilot: Pilot; state: HeadState }[]; settled?: boolean; ready?: boolean; errors?: number; warnings?: number }
function useCountdown(on: boolean, onDone?: () => void) {
  const [left, setLeft] = useState<number | null>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (!on) return setLeft(null)
    setLeft(COUNTDOWN)
    const tick = window.setInterval(() => setLeft((l) => (l !== null && l > 0 ? l - 1 : l)), 1000)
    return () => window.clearInterval(tick)
  }, [on])
  useEffect(() => {
    if (left === 0) done.current?.()
  }, [left])
  return left
}
function Line({ icon, className, children }: { icon: React.ReactNode; className: string; children: React.ReactNode }) {
  return (
    <p className={"flex items-start gap-1.5 " + className}>
      <span className="flex h-4 shrink-0 items-center [&>svg]:size-3.5">{icon}</span>
      {children}
    </p>
  )
}
const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
function PreflightCard({ summary, onStarted }: { summary: Summary; onStarted?: () => void }) {
  const [ready, setReady] = useState(!!summary.ready)
  const press = useCardPress()
  const left = useCountdown(ready && summary.crew.every((c) => c.state === "ready"), onStarted)
  const heads = [{ pilot: YOU, state: (ready ? "ready" : "waiting") as HeadState }, ...summary.crew]
  const errors = summary.errors ?? 0
  const warnings = summary.warnings ?? 0
  const differences = [errors && counted(errors, "error"), warnings && counted(warnings, "warning")].filter(Boolean).join(" and ")
  return (
    <div className="relative flex w-full flex-col gap-3 rounded-4xl bg-card p-3 text-card-foreground" style={{ transform: press.pressed ? "translateY(1px)" : undefined }}>
      <button type="button" aria-label="Open Dual Input on the EFB" onClick={() => openEfb("session")} {...press.handlers} className={LAYER} />
      <div className="pointer-events-none relative flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          {heads.map(({ pilot, state }) => (
            <StripHead key={pilot.name} pilot={pilot} state={state} />
          ))}
        </span>
        <span className="pointer-events-auto flex items-center gap-2">
          <CountdownRing left={left} />
          <ReadyButton ready={ready} settled={summary.settled ?? true} onToggle={() => setReady((r) => !r)} />
        </span>
      </div>
      <div className="pointer-events-none relative flex flex-col gap-1.5 text-xs">
        <Line icon={<Hand />} className="text-info">
          Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.
        </Line>
        {summary.pf && (
          <Line icon={<ListChecks />} className="text-muted-foreground">
            Your preflight checklist is in Dual Input's EFB app
          </Line>
        )}
        {differences && (
          <Line icon={errors ? <CircleX className="text-destructive" /> : <TriangleAlert className="text-warning" />} className="text-muted-foreground">
            {differences} between your setups
          </Line>
        )}
      </div>
    </div>
  )
}

// The banner's stack: the preflight summary first while preflight runs, then the notifications,
// newest first, 8px apart, in the box's height. When they don't fit, the oldest of those that stay
// 6s leave early; if the held ones still don't fit, the ones that keep a place are trouble before
// warnings before information, newest first among each, and the rest wait behind a line at the
// box's foot that counts them and dismisses every notification at once, so dismissing all is there
// only when it's needed (user, 2026-11-01: "thoughts on a dismiss/clean all button at the
// bottom?"); as a card leaves, the next one waiting takes its place. The heights are measured from
// a copy of every card laid out unseen, since which fit depends on how their words wrap.
const LEVEL_RANK: Record<Level, number> = { trouble: 0, warning: 1, info: 2 }
const MORE_LINE = 36
function place(keys: NoteKey[], height: (k: NoteKey) => number, room: number): { shown: NoteKey[]; waiting: number } {
  const total = (ks: NoteKey[]) => ks.reduce((sum, k) => sum + height(k), 0) + BANNER.gap * Math.max(0, ks.length - 1)
  const held = (k: NoteKey) => !!(NOTES[k].note as Note).held
  let shown = [...keys]
  while (total(shown) > room) {
    const oldest = [...shown].reverse().find((k) => !held(k))
    if (!oldest) break
    shown = shown.filter((k) => k !== oldest)
  }
  if (total(shown) <= room) return { shown, waiting: 0 }
  const ranked = [...shown].sort((a, b) => LEVEL_RANK[NOTES[a].note.level as Level] - LEVEL_RANK[NOTES[b].note.level as Level] || keys.indexOf(a) - keys.indexOf(b))
  const kept: NoteKey[] = []
  for (const k of ranked) if (total([...kept, k]) <= room - MORE_LINE - BANNER.gap) kept.push(k)
  return { shown: keys.filter((k) => kept.includes(k)), waiting: shown.length - kept.length }
}
function MoreLine({ count, onDismissAll }: { count: number; onDismissAll: () => void }) {
  const { Button } = useUI()
  return (
    <div className="flex w-full items-center justify-between rounded-4xl bg-card pr-1.5 pl-3 text-xs text-muted-foreground inset-ring inset-ring-foreground/10" style={{ height: MORE_LINE }}>
      <span className="flex items-center gap-1">
        <Rolling value={count} /> more
      </span>
      <Button variant="ghost" size="xs" onClick={onDismissAll}>
        Dismiss all
      </Button>
    </div>
  )
}

// How the stack moves (user, 2026-11-01: "yes, build it", to my plan, in the page's timings,
// ease.tsx). A card arriving opens its room, the cards under it sliding down, and slides in 24px from
// the screen's edge as it fades in, once the room is half open; one going by its lifetime slides 24px
// toward the edge as it fades, then its room shuts, the cards under it sliding up; one dismissed by
// its × or a drag has already slid off, so its room shuts at once. Arriving and leaving share the one
// direction, toward the edge the banner sits on. The summary, and the line counting the cards
// waiting, come and go as a card does. Each slot holds its gap under it, so a shut room leaves none.
const SLOT_MS = { out: 160, slide: 24 }
type SlotStage = "enter" | "open" | "rest" | "out" | "shut"
function Slot({ fresh, leaving, away, onGone, children }: { fresh: boolean; leaving: boolean; away: boolean; onGone: () => void; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [stage, setStage] = useState<SlotStage>(fresh ? "enter" : "rest")
  const gone = useRef(onGone)
  useEffect(() => {
    gone.current = onGone
  })
  useLayoutEffect(() => {
    const h = inner.current?.offsetHeight ?? 0
    if (h !== height) setHeight(h)
  })
  useEffect(() => {
    if (!fresh) return
    let f = requestAnimationFrame(() => (f = requestAnimationFrame(() => setStage("open"))))
    const t = window.setTimeout(() => setStage((st) => (st === "open" ? "rest" : st)), MOMENT.inAt + MOMENT.in)
    return () => {
      cancelAnimationFrame(f)
      window.clearTimeout(t)
    }
  }, [fresh])
  useEffect(() => {
    if (!leaving) return
    const timers: number[] = []
    if (away) setStage("shut")
    else {
      setStage("out")
      timers.push(window.setTimeout(() => setStage("shut"), SLOT_MS.out))
    }
    timers.push(window.setTimeout(() => gone.current(), (away ? 0 : SLOT_MS.out) + MOMENT.move))
    return () => timers.forEach(window.clearTimeout)
  }, [leaving, away])
  const roomHeight = stage === "enter" || stage === "shut" ? 0 : stage === "rest" ? undefined : height
  const look: React.CSSProperties =
    stage === "enter"
      ? { opacity: 0, transform: `translateX(${SLOT_MS.slide}px)` }
      : stage === "open"
        ? { opacity: 1, transform: "none", transition: `opacity ${MOMENT.in}ms ease-out ${MOMENT.inAt}ms, transform ${MOMENT.in}ms ease-out ${MOMENT.inAt}ms` }
        : stage === "out"
          ? { opacity: 0, transform: `translateX(${SLOT_MS.slide}px)`, transition: `opacity ${SLOT_MS.out}ms ease-in, transform ${SLOT_MS.out}ms ease-in` }
          : stage === "shut"
            ? { opacity: 0 }
            : {}
  return (
    <div style={{ height: roomHeight, overflow: stage === "rest" ? "visible" : "hidden", transition: `height ${MOMENT.move}ms ease-in-out` }}>
      <div ref={inner} style={{ paddingBottom: BANNER.gap }}>
        <div style={look}>{children}</div>
      </div>
    </div>
  )
}

// A held notification that becomes another keeps its slot, so it changes in place.
const SLOT_OF: Partial<Record<NoteKey, string>> = { "catching-up": "catch", "caught-up": "catch", "caught-up-outage": "catch" }
const slotOf = (k: NoteKey) => SLOT_OF[k] ?? k
type Item = { id: string; kind: "summary" | "note" | "more"; key?: NoteKey; fresh?: boolean; leaving?: boolean; away?: boolean }
// The items to show, merged into those shown: one that's gone stays where it was, leaving; one that's
// new goes in after the item it follows.
function merge(shown: Item[], want: Item[], awayOf: (it: Item) => boolean): Item[] {
  const wanted = new Map(want.map((w) => [w.id, w]))
  const out = shown.map((it) => (wanted.has(it.id) ? { ...it, ...wanted.get(it.id)!, fresh: it.fresh, leaving: false } : it.leaving ? it : { ...it, leaving: true, away: awayOf(it) }))
  want.forEach((w, i) => {
    if (out.some((o) => o.id === w.id)) return
    const before = want
      .slice(0, i)
      .reverse()
      .find((b) => out.some((o) => o.id === b.id))
    const at = before ? out.findIndex((o) => o.id === before.id) + 1 : 0
    out.splice(at, 0, { ...w, fresh: true })
  })
  return out
}

function Stack({ summary, notes, timed }: { summary?: Summary; notes: NoteKey[]; timed?: boolean }) {
  const [gone, setGone] = useState<Map<NoteKey, boolean>>(new Map())
  const [started, setStarted] = useState(false)
  const live = notes.filter((k) => !gone.has(k))
  const leave = (k: NoteKey, away: boolean) => setGone((g) => new Map(g).set(k, away))
  const measure = useRef<HTMLDivElement>(null)
  const summaryBox = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    const next: Record<string, number> = { summary: summaryBox.current?.offsetHeight ?? heights.summary ?? 0 }
    measure.current?.querySelectorAll<HTMLElement>("[data-measure]").forEach((el) => (next[el.dataset.measure!] = el.offsetHeight))
    if (Object.keys(next).some((k) => next[k] !== heights[k])) setHeights(next)
  })
  const withSummary = !!summary && !started
  const room = BANNER.height - (withSummary ? (heights.summary ?? 0) + BANNER.gap : 0)
  const { shown, waiting } = place(live, (k) => heights[k] ?? 0, room)
  const want: Item[] = [
    ...(withSummary ? [{ id: "summary", kind: "summary" as const }] : []),
    ...shown.map((k) => ({ id: slotOf(k), kind: "note" as const, key: k })),
    ...(waiting > 0 ? [{ id: "more", kind: "more" as const }] : []),
  ]
  const wantKey = want.map((w) => w.id + ":" + (w.key ?? "")).join(",")
  const [items, setItems] = useState<Item[]>(want)
  useLayoutEffect(() => {
    setItems((now) => merge(now, want, (it) => (it.key ? !!gone.get(it.key) : false)))
    // The items follow what's wanted, which the key names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey])
  // The line keeps its last count while it leaves.
  const [count, setCount] = useState(waiting)
  if (waiting > 0 && waiting !== count) setCount(waiting)
  return (
    <div className="relative flex flex-col" style={{ width: BANNER.width, marginBottom: -BANNER.gap }}>
      {items.map((it) => (
        <Slot key={it.id} fresh={!!it.fresh} leaving={!!it.leaving} away={!!it.away} onGone={() => setItems((all) => all.filter((x) => x.id !== it.id))}>
          {it.kind === "summary" ? (
            <div ref={summaryBox}>
              <PreflightCard summary={summary!} onStarted={() => setStarted(true)} />
            </div>
          ) : it.kind === "more" ? (
            <MoreLine count={count} onDismissAll={() => setGone(new Map(notes.map((k) => [k, false])))} />
          ) : (
            <NoteCard
              note={NOTES[it.key!].note}
              noteKey={it.key!}
              onDismiss={() => leave(it.key!, true)}
              lifetime={timed && !(NOTES[it.key!].note as Note).held ? LIFETIME : undefined}
              onExpire={() => leave(it.key!, false)}
            />
          )}
        </Slot>
      ))}
      <div ref={measure} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col" style={{ width: BANNER.width }}>
        {notes.map((k) => (
          <div key={k} data-measure={k}>
            <NoteCard note={NOTES[k].note} noteKey={k} onDismiss={() => {}} />
          </div>
        ))}
      </div>
    </div>
  )
}
// A notification that isn't held stays this long, in milliseconds.
const LIFETIME = 6000

// What every banner frame shares: the theme and the kit, as the app's frame gives them.
export function Themed({ theme, children }: { theme: Theme; children: React.ReactNode }) {
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

// The banner's top at the screen's right edge, as wide as the EFB's frames, with the cards at their
// place.
// With box, the box's outline shows how much room the stack has. A script plays the notifications
// as they'd come, each step the list at that time, newest first; timed, the ones that aren't held go
// after their lifetime.
export type Script = { at: number; notes: NoteKey[] }[]
export function BannerFrame({ theme, summary, notes = [], box, script, timed }: { theme: Theme; summary?: Summary; notes?: NoteKey[]; box?: boolean; script?: Script; timed?: boolean }) {
  const [playing, setPlaying] = useState<NoteKey[]>(script ? script[0].notes : notes)
  useEffect(() => {
    if (!script) return
    const timers = script.map((step) => window.setTimeout(() => setPlaying(step.notes), step.at))
    return () => timers.forEach(window.clearTimeout)
  }, [script])
  return (
    <Themed theme={theme}>
      <div className="relative flex justify-end overflow-hidden rounded-xl" style={{ background: SKY, padding: `${BANNER.inset}px ${BANNER.inset}px 48px`, minHeight: box ? BANNER.height + 64 : undefined }}>
        {box && <div className="absolute border border-dashed border-sky-300/80" style={{ top: BANNER.inset, right: BANNER.inset, width: BANNER.width, height: BANNER.height }} />}
        <Stack summary={summary} notes={script ? playing : notes} timed={timed} />
      </div>
    </Themed>
  )
}

// Every notification at once, each under when it shows, in the banner's column.
export function EveryNotificationFrame({ theme }: { theme: Theme }) {
  const [gone, setGone] = useState<NoteKey[]>([])
  return (
    <Themed theme={theme}>
      <div className="flex justify-end overflow-hidden rounded-xl" style={{ background: SKY, padding: `${BANNER.inset}px ${BANNER.inset}px 48px` }}>
        <div className="flex flex-col gap-4" style={{ width: BANNER.width }}>
          {(Object.keys(NOTES) as NoteKey[]).map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <span className="text-xs text-white/85">{NOTES[k].when}</span>
              {gone.includes(k) ? <span className="h-5 text-xs text-white/60">Dismissed</span> : <NoteCard note={NOTES[k].note} noteKey={k} onDismiss={() => setGone((g) => [...g, k])} />}
            </div>
          ))}
        </div>
      </div>
    </Themed>
  )
}

// The whole screen at its size, with the banner's box outlined at its place, holding the
// preflight summary and three notifications, the most it's sized for.
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
        <div className="absolute border border-dashed border-sky-300/80" style={{ top: BANNER.top, right: BANNER.inset, width: BANNER.width, height: BANNER.height }}>
          <span className="absolute top-full right-0 pt-1.5 text-xs whitespace-nowrap text-white/85">
            The banner's box, {BANNER.width} by {BANNER.height}
          </span>
        </div>
        <div className="absolute" style={{ top: BANNER.top, right: BANNER.inset }}>
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
// The plays: notifications coming and going, a held one with two that stay their 6s, arriving a
// moment apart; and catching up, which becomes caught up in place, then goes.
export const SCRIPTS: Record<string, Script> = {
  arrivals: [
    { at: 0, notes: [] },
    { at: 500, notes: ["pause"] },
    { at: 1700, notes: ["control-you", "pause"] },
    { at: 2900, notes: ["sync-one", "control-you", "pause"] },
  ],
  catchUp: [
    { at: 0, notes: [] },
    { at: 500, notes: ["catching-up"] },
    { at: 3500, notes: ["caught-up"] },
  ],
}

export const SUMMARIES = {
  pf: { pf: true, crew: [{ pilot: ADAM, state: "ready" }], errors: 1, warnings: 2 },
  others: { pf: false, crew: [{ pilot: { ...JAMES, flying: true }, state: "ready" }], warnings: 1 },
  settling: { pf: false, settled: false, crew: [{ pilot: { ...JAMES, flying: true }, state: "waiting" }] },
  counting: { pf: false, ready: true, crew: [{ pilot: { ...JAMES, flying: true }, state: "ready" }], warnings: 1 },
  out: { pf: true, crew: [{ pilot: ADAM, state: "out" }], errors: 1, warnings: 2 },
} satisfies Record<string, Summary>
