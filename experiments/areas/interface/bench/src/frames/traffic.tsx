// The Traffic and ATC audio tabs. Traffic and ATC audio are shared apart, each with a host of its
// own taken by its own switch, and Dual Input doesn't check whether one pilot holds both; each tab
// holds its feature's sharing, settings, and warnings, and an amber dot on its icon flags a warning
// on every page (record/areas/interface/decisions.md, Traffic and ATC audio are shared apart, and
// The Traffic and ATC audio tabs hold their sharing, settings, and warnings). Outside a session
// the switches are off and can't be turned on, since a role is a session key, and the settings
// still change.
// Each tab is the sharing card, with the switch and the role's own setting, which shows only for
// the role it serves; then how the feature works, in a sentence or two; then the check, a line for
// each rule of it with what Dual Input knows of it now. The words, the packs' names and versions,
// the counts, and the devices are drafts and examples.
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Package,
  TriangleAlert,
  Volume2,
} from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, InlineLink, useShowDot, useShowShared } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"
import { ScrollPage } from "./scroller"
import { Head } from "./figure-head"
import { MOMENT, part, Room, useMoment, type Stage } from "./ease"
import { Rolling } from "./home"
import { FIGURE_COLORS } from "./figure-portrait"

// Who shares as the frame opens: James, nobody, or this pilot; or no session at all. In a session,
// James shares the other feature, as on the session page's flying frames, so its chip shows in the
// header. The pilots' colors are the session page's examples.
type Sharer = "James" | "You" | undefined
type Where = { session: boolean; sharer?: Sharer }
const HUE: Record<"James" | "You", string> = { James: "red", You: "orange" }
const hexOf = (pilot: "James" | "You") =>
  FIGURE_COLORS.find((c) => c.name === HUE[pilot])!.hex

// The flight's frame around a tab: the phase in the header and the take-control strip under the
// tabs while flying, as on every tab; neither outside a session.
function useFlightAround(session: boolean) {
  useShowPhase(session ? "syncing" : undefined)
  useShowSession(session)
  const [mine, setMine] = useState(false)
  const takeNow = useRef(() => setMine(true))
  const control = useMemo<Control | undefined>(
    () =>
      session
        ? { mine, pf: "James", bound: "F9", take: () => takeNow.current() }
        : undefined,
    [session, mine]
  )
  useShowControl(control)
}

// The sharing card, one row in every state: what's happening on the left, and its control on the
// right. With nobody sharing, "Share my traffic" and its switch; while this pilot is sharing, their
// head and "You're sharing traffic" with the switch on, to stop; while another pilot is, their head
// and "James is sharing traffic" with Take over in place of the switch, which says what a switch
// with a note under it had to, and takes over at once, with no question (user, 2026-10-31).
// Outside a session the switch is off and can't turn on. Then the role's own setting, which shows
// while this pilot is sharing and hides when they stop, and outside a session, where the settings
// still change (user, 2026-10-31). How it works says what the switch does, so the card carries no
// description, and a status of something happening now takes the progressive (user, 2026-10-31).
// While the row holds the switch, the whole row is its label, out to the card's edges, so a VR
// pointer anywhere on it flips the switch, and the row tints under the pointer to say so (user,
// 2026-10-31). The card's padding moves into the row for that, and into the settings below it.
// The row is a label in every state, so a change of state doesn't redraw it from scratch. With Take
// over in it, the switch it names isn't there, so a press on it does nothing; a label naming no
// control would take the first it holds, Take over. The row is Take over's 32px tall in every
// state, so the card keeps its height as Take over gives way to the switch (user, 2026-10-31: the
// 28px a switch needs made a take-over jump 4px). Its one line of words centers its capitals on the
// row from the words' baseline, as the check's icons do, since each platform places the words in
// their line box differently: an empty strut 21px tall, half the row and half Geist's 10px capitals
// at 14px, sets the baseline its bottom edge gives (user, 2026-10-31: centered by its line box,
// the line sat 1px high on the user's machine). Outside a session the label and its note center as
// a block.
// The card shows the moment's state (ease.tsx), but the switch follows the press, so it slides the
// moment it's pressed. In the moment, what changes in the row fades out, then the row takes its new
// layout while nothing in it shows, so no word slides sideways, and its new parts arrive at once,
// not waiting on the page's layout below: an arriving head pops in first, as a crew row's does as
// its pilot joins, and the words and the control a step after it. On a take-over, the new pilot's
// head popping in is what the eye follows (user, 2026-10-31; tried and dropped: the head's spot
// easing open, which left the row blank while it opened).
type CardMoment = { stage: Stage; from: Sharer; to: Sharer; settings?: boolean }
function RoleCard({
  label,
  noun,
  session,
  sharer,
  live = sharer,
  moment,
  onChange,
  children,
}: {
  label: string
  noun: string
  session: boolean
  sharer: Sharer
  live?: Sharer
  moment?: CardMoment
  onChange: (on: boolean) => void
  children?: React.ReactNode
}) {
  const { Button, Card, Separator, Switch } = useUI()
  // Every frame on the canvas draws this card, so the switch's id is each card's own.
  const id = useId()
  const of = (s: Sharer) => (session ? s : undefined)
  const someone = of(sharer)
  const takeOver = !!someone && someone !== "You"
  const stage = moment?.stage ?? "idle"
  const changes = !!moment && of(moment.from) !== of(moment.to)
  const isTake = (s: Sharer) => !!of(s) && of(s) !== "You"
  const controlChanges = !!moment && isTake(moment.from) !== isTake(moment.to)
  return (
    <Card className="gap-0 py-0 [--card-spacing:--spacing(5)]">
      <label
        htmlFor={id}
        className={
          "box-content flex min-h-8 p-(--card-spacing) " +
          (session ? "items-baseline " : "items-center ") +
          (session && !takeOver
            ? "cursor-pointer transition-colors hover:bg-muted/40 active:bg-muted/60"
            : "")
        }
      >
        <HeadSpot who={someone} stage={stage} changes={changes} />
        {session && <span aria-hidden className="h-[21px] w-0 self-baseline" />}
        <span
          className={
            "flex flex-1 flex-col text-sm " + (someone ? "" : "font-medium")
          }
        >
          <span style={part(stage, changes, 1, true, true)}>
            {someone === "You"
              ? `You're sharing ${noun}`
              : someone
                ? `${someone} is sharing ${noun}`
                : label}
          </span>
          {!session && (
            <span className="text-xs font-normal text-muted-foreground">
              Sharing needs a session
            </span>
          )}
        </span>
        <span
          className="ml-3 flex self-center"
          style={part(stage, controlChanges, 1, true, true)}
        >
          {takeOver ? (
            <Button variant="outline" size="sm" onClick={() => onChange(true)}>
              Take over
            </Button>
          ) : (
            <Switch
              id={id}
              disabled={!session}
              checked={of(live) === "You"}
              onCheckedChange={onChange}
            />
          )}
        </span>
      </label>
      <Room open={!!children} style={part(stage, !!moment?.settings, 2, false)}>
        <Separator />
        <div className="flex flex-col gap-5 p-(--card-spacing)">{children}</div>
      </Room>
    </Card>
  )
}

// The head's spot, its 28px and the 12px after it, is there while a pilot is sharing. A head that
// goes fades in the moment's first step, and its spot goes once it's gone; one that arrives pops in
// as the second starts, its window with it. Nothing clips the spot, since the pop swells the head
// to 1.25 times its size, as a crew row's does (user, 2026-10-31: clipped, its edges were cut).
function HeadSpot({
  who,
  stage,
  changes,
}: {
  who: Sharer
  stage: Stage
  changes: boolean
}) {
  const head = who
  const look: React.CSSProperties = !changes
    ? {}
    : stage === "out"
      ? { opacity: 0, transition: `opacity ${MOMENT.out}ms ease-in` }
      : {}
  return (
    <span className="flex shrink-0 self-center" style={{ width: who ? 40 : 0 }}>
      {head && (
        <span key={head} className="flex" style={look}>
          <Head
            hex={hexOf(head)}
            pop={changes && stage !== "out" && stage !== "idle" ? 0 : undefined}
          />
        </span>
      )}
    </span>
  )
}

// How the feature works, in a sentence or two under a heading in the card titles' style, since in
// the small muted label it read as a caption (user, 2026-10-31); then the check: one line for each
// rule of it, each with what Dual Input knows of it now (user, 2026-10-31: one place to explain,
// suggest, teach, and troubleshoot, where a guide, a comparison, and tips were scattered). A line is
// checked and fine, checked and different, with what differs under it, which also lights the tab's
// dot, or beyond what Dual Input can check, so the line is the tip; with nobody sharing, every line
// waits. A line's id stays as its state changes, so the line changes in place.
type State = "ok" | "differs" | "unchecked" | "rule"
type Line = {
  id?: string
  state: State
  says: React.ReactNode
  detail?: React.ReactNode
}
const lineId = (l: Line) => l.id ?? String(l.says)
// Each icon centers on the capital letters of its line's first words, so it's placed from the
// text's baseline, which sits at the same spot on every platform, where the line box doesn't:
// placed in the 20px line by margin, the icon sat on the capitals' middle in Chromium on Linux and
// 2px low in the user's browser (user, 2026-10-31), since each platform reads the font's height
// from another table. The row aligns its items' baselines, an icon's being its bottom edge, and
// the icon moves 3px down, half its 16px less half Geist's 10px capitals at 14px, and a rule's
// 6px dot 1px up, to the lowercase letters' middle, as a list's points sit. Coherent GT lists
// align-items as working, but its baseline value is unmeasured there.
const ICON = "size-4 shrink-0 [transform:translateY(3px)]"
const STATE_ICON: Record<State, React.ReactNode> = {
  ok: <CircleCheck className={ICON + " text-success"} />,
  differs: <TriangleAlert className={ICON + " text-warning"} />,
  unchecked: <CircleDashed className={ICON + " text-muted-foreground"} />,
  // A rule is a plain list's point rather than a state, so it takes a small solid dot, in the 16px
  // column the states' icons fill (user, 2026-10-31: the dashed circle read as "can't check" where
  // nothing was being checked yet).
  rule: (
    <span className="mx-[5px] block size-1.5 shrink-0 [transform:translateY(-1px)] rounded-full bg-muted-foreground" />
  ),
}
// While nobody's sharing, and outside a session, there's nothing to check, so the same lines are
// the feature's rules, and the list says so (user, 2026-10-31). A note on the feature's cost sits
// under how it works, in a paragraph of its own, since it's neither a rule nor a check (user,
// 2026-10-31), on the tab of the pilot it speaks to.
// In the moment (ease.tsx), the note and the list each open or shut as a room; arriving, each fades
// in as one block, with no rise, two steps after the card's head (user, 2026-10-31: the list's
// title and lines rising one after another was too flashy). A line whose state turns, its list staying, fades its icon and words out and
// back as the new state, its detail's room opening or shutting under it (user, 2026-10-31).
type CheckMoment = {
  stage: Stage
  note: boolean
  list: boolean
  line: (id: string) => boolean
}
function HowAndCheck({
  how,
  note,
  lines,
  rules,
  moment,
}: {
  how: string
  note?: string
  lines: Line[]
  rules: boolean
  moment?: CheckMoment
}) {
  const stage = moment?.stage ?? "idle"
  return (
    <div className="flex flex-col">
      <section className="flex flex-col">
        <h2 className="text-sm font-medium">How it works</h2>
        <p className="pt-2 text-sm text-muted-foreground">{how}</p>
        <Room
          open={!!note}
          pad="pt-2"
          style={part(stage, !!moment?.note, 2, false)}
        >
          <p className="text-sm text-muted-foreground">{note}</p>
        </Room>
      </section>
      <Room open={lines.length > 0} pad="pt-6">
        <section
          className="flex flex-col gap-2"
          style={part(stage, !!moment?.list, 2, false)}
        >
          <h2 className="text-sm font-medium">{rules ? "Rules" : "Check"}</h2>
          <ul className="flex flex-col gap-3">
            {lines.map((l) => {
              const turns = !moment?.list && !!moment?.line(lineId(l))
              return (
                <li key={lineId(l)} className="flex items-baseline gap-2.5">
                  <span className="flex" style={part(stage, turns, 0)}>
                    {STATE_ICON[l.state]}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm" style={part(stage, turns, 1)}>
                      {l.says}
                    </span>
                    <Room
                      open={!!l.detail}
                      pad="pt-0.5"
                      style={part(stage, turns, 2, false)}
                    >
                      <span
                        className={
                          "block text-xs " +
                          (l.state === "differs"
                            ? "text-warning"
                            : "text-muted-foreground")
                        }
                      >
                        {l.detail}
                      </span>
                    </Room>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      </Room>
    </div>
  )
}
const differs = (lines: Line[]) => lines.some((l) => l.state === "differs")

// The traffic packs on this PC, as traffic lists them when asked: each folder whose name a known
// traffic pack matches, with its manifest's `package_version`
// (record/areas/traffic-atc/01-traffic-and-atc.md, Traffic packs). Pilots compare them with the
// host's by hand, since the counts above
// catch a mismatch whatever its cause, where comparing the crew's lists saw only the packs on the
// known list, which starts with `fsltl-traffic-base`, and needed the lists sent between the cores
// (user, 2026-10-31). A pack the list doesn't know isn't shown, so the title says the packs were
// detected. It's a supplement to the check, so it sits in a tint with no border, in smaller text,
// with no tip, since the rules and the check's lines already say what to compare (user,
// 2026-10-31). It sits at the page's foot, so it holds still as the parts above it open and shut,
// and follows them once the page outgrows the EFB (user, 2026-10-31). The second pack's name is
// hypothetical, and every version is an example.
type Pack = { name: string; version: string }
const PACKS: Record<"match" | "differ", Pack[]> = {
  match: [
    { name: "fsltl-traffic-base", version: "1.2.0" },
    { name: "fsltl-traffic-liveries", version: "2.0.3" },
  ],
  differ: [{ name: "fsltl-traffic-base", version: "1.1.4" }],
}
function PacksOnThisPc({ packs }: { packs: Pack[] }) {
  return (
    <section className="mt-auto flex flex-col gap-2.5 rounded-xl bg-muted/20 px-4 py-3.5 text-xs">
      <h2 className="flex items-center gap-1.5 font-medium text-muted-foreground/80">
        <Package className="size-3.5 shrink-0" />
        Detected traffic packs on this PC
      </h2>
      <ul className="flex flex-col gap-1.5">
        {packs.map((p) => (
          <li
            key={p.name}
            className="flex items-baseline justify-between gap-4"
          >
            <span className="text-foreground/75">{p.name}</span>
            <span className="text-muted-foreground/80 tabular-nums">
              {p.version}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
type Counts = { missing: number; others: number }

// What Dual Input checks for a receiving pilot is what their sim shows: the traffic host's aircraft
// it shows as stand-ins or not at all, and the aircraft that aren't the host's
// (record/areas/traffic-atc/01-traffic-and-atc.md, Notifications). The first catches a pack that
// differs whatever the pack, and the second the pilot's own traffic left on. The host's own sim
// has nothing to check, so their tab has no check (user, 2026-10-31). The first count sees only
// creates the sim refused, so its passing line says the aircraft loaded, not that they show:
// a copy with another pack's livery, or floating over other scenery, still counts as loaded, and
// whether the sim refuses a title it lacks at all is a check in the sim
// (record/areas/traffic-atc/01-traffic-and-atc.md, Creating a copy). Counts handle the singular.
function trafficLines(
  session: boolean,
  sharer: Sharer,
  counts: Counts
): Line[] {
  if (sharer === "You") return []
  if (sharer && session)
    return [
      counts.missing
        ? {
            id: "missing",
            state: "differs",
            says: (
              <>
                <Rolling value={counts.missing} /> aircraft from {sharer}{" "}
                {counts.missing === 1 ? "is" : "are"} missing or shown
                incorrectly
              </>
            ),
            detail: "Usually caused by a difference in installed traffic packs",
          }
        : {
            id: "missing",
            state: "ok",
            says: `All aircraft from ${sharer} loaded in your sim`,
          },
      counts.others
        ? {
            id: "others",
            state: "differs",
            says: (
              <>
                <Rolling value={counts.others} /> aircraft in your sim{" "}
                {counts.others === 1 ? "isn't" : "aren't"} coming from {sharer}
              </>
            ),
            detail: "Turn off AI traffic on your PC",
          }
        : {
            id: "others",
            state: "ok",
            says: `No extra aircraft on top of what comes from ${sharer}`,
          },
    ]
  // The rules, in the user's words (user, 2026-10-31). Copies are frozen rather than held to the
  // ground, so with other scenery, whose ground can sit at another elevation, they float or sink
  // (record/areas/traffic-atc/01-traffic-and-atc.md, Known limits). Traffic has no radius setting,
  // since the traffic generators keep their aircraft near the pilot and the airport's own aircraft,
  // where the frame rate goes, stay at any radius, so the lever is the density at the traffic's
  // source, which How it works notes (record/areas/interface/decisions.md, Traffic polls within the
  // sim's 200km cap).
  // Multiplayer off is a rule for all of Dual Input, not traffic's, so it isn't here.
  return [
    {
      state: "rule",
      says: "Receiving pilots should turn off their own AI traffic",
      detail: "To ensure everyone sees the same traffic",
    },
    {
      state: "rule",
      says: "Everyone should have the same traffic packs installed",
      detail: "To avoid missing or incorrect aircraft",
    },
    {
      state: "rule",
      says: "Everyone should have the same scenery",
      detail:
        "To avoid issues such as floating aircraft due to different ground elevation",
    },
  ]
}

// A frame can play the counts changing, as they do live: each step's counts after its time, in
// milliseconds from the frame's opening.
type CountsLater = { after: number; counts: Counts }[]
function TrafficPage({
  where,
  packs = "match",
  counts = { missing: 0, others: 0 },
  later = [],
}: {
  where: Where
  packs?: keyof typeof PACKS
  counts?: Counts
  later?: CountsLater
}) {
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const [countsNow, setCountsNow] = useState(counts)
  useEffect(() => {
    const timers = later.map((step) =>
      window.setTimeout(() => setCountsNow(step.counts), step.after)
    )
    return () => timers.forEach(clearTimeout)
    // It plays once, from the frame's opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const live = trafficLines(where.session, sharer, countsNow)
  useShowDot("traffic", differs(live))
  useShowShared("traffic", where.session ? sharer : undefined)
  useShowShared("atc", where.session ? "James" : undefined)
  // One moment for the page (ease.tsx) whenever who's sharing changes or a line turns; a count that
  // moves while its line keeps its state rolls in place, with no moment.
  const m = useMoment(
    `${sharer}|${live.map((l) => `${lineId(l)}:${l.state}`)}`,
    {
      sharer,
      counts: countsNow,
    }
  )
  const linesOf = (v: { sharer: Sharer; counts: Counts }) =>
    trafficLines(where.session, v.sharer, v.counts)
  const lines = linesOf(m.shown)
  const [from, to] = [linesOf(m.from), linesOf(m.to)]
  const stateIn = (ls: Line[], id: string) =>
    ls.find((l) => lineId(l) === id)?.state
  // The note speaks to the pilot whose traffic is shared, so it shows only on their tab.
  const notes = (s: Sharer) => where.session && s === "You"
  const rulesOf = (s: Sharer) => !where.session || !s
  return (
    <ScrollPage>
      <RoleCard
        label="Share my traffic"
        noun="traffic"
        session={where.session}
        sharer={m.shown.sharer}
        live={sharer}
        moment={{ stage: m.stage, from: m.from.sharer, to: m.to.sharer }}
        onChange={(on) => setSharer(on ? "You" : undefined)}
      />
      <HowAndCheck
        how="One pilot shares. Dual Input watches the AI traffic in their sim and injects it into everyone else's. This works by reading the traffic straight from the sim and works regardless of the original method of traffic generation."
        note={
          notes(m.shown.sharer)
            ? "Performance issues? Since your traffic is shared as-is, PCs that aren't as powerful as yours might struggle to keep up. If that happens, decrease your traffic density in your AI traffic app."
            : undefined
        }
        lines={lines}
        rules={rulesOf(m.shown.sharer)}
        moment={{
          stage: m.stage,
          note: notes(m.from.sharer) !== notes(m.to.sharer),
          list:
            from.length > 0 !== to.length > 0 ||
            rulesOf(m.from.sharer) !== rulesOf(m.to.sharer),
          line: (id) => stateIn(from, id) !== stateIn(to, id),
        }}
      />
      <PacksOnThisPc packs={PACKS[packs]} />
    </ScrollPage>
  )
}

// ATC audio's tab holds no check and no rules: everyone understands sharing audio, How it works
// says Dual Input plays the sharing pilot's ATC app on every other pilot's machine, and the tab
// shows only what goes wrong in Dual Input's own pipeline (user, 2026-10-31), which is nothing yet:
// Automatic waits for an ATC app silently, a link that drops is the header's, and an output device
// that's gone is every sound's, so Settings'. Tried and dropped: a check line for each thing a pilot
// sets up by hand, then rules for them; turning off the sim's own ATC, which pilots who know ATC
// apps have off already, "none of our business"; a warning while the capture waits for an ATC app;
// a status line under the picker, which the picker's own live mark says; and a warning when ATC
// breaks up, from the frames the core helper conceals, which waits for a threshold (user,
// 2026-10-31).
// The card holds the setting of the role this pilot has, as Traffic's does: the ATC app while they
// share, the volume while another pilot shares, nothing while nobody shares, and both outside a
// session, where the settings still change (user, 2026-10-31: the volume in the card). The output
// device carries every sound Dual Input plays, so it's set in Settings and only shown here. The
// words are drafts.
type Capture = "capturing" | "none"
type CaptureLater = { after: number; capture: Capture }[]

// The ATC app setting, as FS Copilot's dropdown was (FS Copilot fork, AtcHost.cs, read in
// record/areas/traffic-atc/results/2026-10-17-fsc-atc-code.txt): Automatic, which captures the
// first known ATC app that's running, then every program playing audio, the known ATC apps first,
// for the core helper lists the programs that own an audio session; a program picked is a
// preference, not a lock (record/areas/traffic-atc/01-traffic-and-atc.md, The ATC host). Closed, it
// says what it captures, with a green dot by the chevron while it does, the sync's green, which says
// engaged, where its coming and going moves no word (user, 2026-10-31; tried and dropped: the dot
// before the name, which pushed it aside):
// "Automatic · BeyondATC", or "Automatic" alone while no ATC app runs, and open, beside the
// program it captures (user, 2026-10-31). The
// sim and Dual Input itself never show, since capturing the sim would take all its sound. The
// programs other than BeyondATC are examples.
const PLAYING = ["BeyondATC", "Discord", "Google Chrome", "Spotify"]
const KNOWN = ["BeyondATC", "SayIntentions"]
function AtcAppPicker({
  running,
  liveLook,
}: {
  running?: string
  liveLook: React.CSSProperties
}) {
  const {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
    SelectItem,
  } = useUI()
  const [value, setValue] = useState("auto")
  const captured =
    value === "auto" ? running : PLAYING.includes(value) ? value : running
  const items = [
    { value: "auto", label: "Automatic" },
    ...PLAYING.map((p) => ({ value: p, label: p })),
  ]
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">ATC app</span>
      <Select
        items={items}
        value={value}
        onValueChange={(v: string | null) => v && setValue(v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(v: string) => (
              <span className="flex w-full items-center gap-2">
                {v === "auto" ? "Automatic" : v}
                {v === "auto" && captured && (
                  <span className="text-muted-foreground" style={liveLook}>
                    · {captured}
                  </span>
                )}
                {captured && (
                  <span
                    className="mr-1 ml-auto size-1.5 shrink-0 rounded-full bg-success"
                    style={liveLook}
                  />
                )}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        {/* Below the picker, as a plain dropdown: the kit's default lays the picked item over the
            picker and highlights it, so Automatic read as a box of its own (user, 2026-10-31). */}
        <SelectContent alignItemWithTrigger={false}>
          {/* A group of its own, since the kit pads a group's items 6px in from the list's
              edges, and Automatic alone outside one sat flush against them (user, 2026-10-31). */}
          <SelectGroup>
            <SelectItem value="auto">Automatic</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            {/* 18px under the separator, where the kit's 22px read loose (user, 2026-10-31). */}
            <SelectLabel className="pt-1.5">Playing audio</SelectLabel>
            {[...PLAYING]
              .sort(
                (x, y) => Number(KNOWN.includes(y)) - Number(KNOWN.includes(x))
              )
              .map((p) => (
                <SelectItem key={p} value={p}>
                  <span className="flex items-center gap-2">
                    {p}
                    {p === captured && (
                      <span className="size-1.5 shrink-0 rounded-full bg-success" />
                    )}
                  </span>
                </SelectItem>
              ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

// The volume of another pilot's ATC here, and the device it plays on, which Settings sets: the
// device's name in one quiet row under the slider, the whole row opening Settings, so a VR pointer
// has one wide target (user, 2026-10-31; tried and dropped: "Plays on Headset (USB Audio) · Change
// in Settings", a line with a link at its end).
function AtcVolume() {
  const { Slider } = useUI()
  const [volume, setVolume] = useState([100])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span>Volume</span>
        <span className="text-muted-foreground tabular-nums">{volume[0]}%</span>
      </div>
      <Slider
        value={volume}
        onValueChange={(v: number | number[]) =>
          setVolume(Array.isArray(v) ? v : [v])
        }
        max={100}
        step={5}
      />
      <button
        type="button"
        onClick={() => toast("Opening Settings on the output device")}
        className="-mx-2 -mb-1.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:[transform:translateY(1px)]"
      >
        <Volume2 className="size-3.5 shrink-0" />
        Headset (USB Audio)
        <ChevronRight className="ml-auto size-3.5 shrink-0" />
      </button>
    </div>
  )
}

// The page changes in one moment (ease.tsx), as Traffic's does: the card's row as there, and its
// settings as the role changes, the card easing to their height, opening as sharing starts and
// shutting as it stops; an ATC app that starts or stops while this pilot shares changes only the
// picker's live mark, which comes and goes in place.
function AtcPage({
  where,
  capture = "capturing",
  later = [],
}: {
  where: Where
  capture?: Capture
  later?: CaptureLater
}) {
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const [captureNow, setCaptureNow] = useState(capture)
  useEffect(() => {
    const timers = later.map((step) =>
      window.setTimeout(() => setCaptureNow(step.capture), step.after)
    )
    return () => timers.forEach(clearTimeout)
    // It plays once, from the frame's opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const role = (s: Sharer) =>
    !where.session ? "both" : s === "You" ? "host" : s ? "listen" : "none"
  useShowShared("atc", where.session ? sharer : undefined)
  useShowShared("traffic", where.session ? "James" : undefined)
  const m = useMoment(
    `${sharer}|${role(sharer) === "host" ? captureNow : ""}`,
    { sharer, capture: captureNow }
  )
  const [from, to] = [m.from.sharer, m.to.sharer]
  const turns =
    role(from) === "host" &&
    role(to) === "host" &&
    m.from.capture !== m.to.capture
  const shown = role(m.shown.sharer)
  // Only a sharing pilot's capture runs, so only theirs takes a program.
  const running =
    shown === "host" && m.shown.capture === "capturing"
      ? "BeyondATC"
      : undefined
  return (
    <ScrollPage>
      <RoleCard
        label="Share my ATC"
        noun="ATC"
        session={where.session}
        sharer={m.shown.sharer}
        live={sharer}
        moment={{
          stage: m.stage,
          from,
          to,
          settings: role(from) !== role(to),
        }}
        onChange={(on) => setSharer(on ? "You" : undefined)}
      >
        {shown !== "none" && (
          <>
            {(shown === "host" || shown === "both") && (
              <AtcAppPicker
                running={running}
                liveLook={part(m.stage, turns, 0, true, true)}
              />
            )}
            {(shown === "listen" || shown === "both") && <AtcVolume />}
          </>
        )}
      </RoleCard>
      <HowAndCheck
        how="One pilot shares. Dual Input captures audio from their selected ATC app and plays it on every other pilot's machine."
        lines={[]}
        rules={false}
      />
    </ScrollPage>
  )
}

export function TrafficFrame({
  theme,
  where,
  packs,
  counts,
  later,
}: {
  theme: Theme
  where: Where
  packs?: keyof typeof PACKS
  counts?: Counts
  later?: CountsLater
}) {
  return (
    <AppFrame theme={theme} tab="traffic" fixed>
      <TrafficPage where={where} packs={packs} counts={counts} later={later} />
    </AppFrame>
  )
}
export function AtcFrame({
  theme,
  where,
  capture,
  later,
}: {
  theme: Theme
  where: Where
  capture?: Capture
  later?: CaptureLater
}) {
  return (
    <AppFrame theme={theme} tab="atc" fixed>
      <AtcPage where={where} capture={capture} later={later} />
    </AppFrame>
  )
}
