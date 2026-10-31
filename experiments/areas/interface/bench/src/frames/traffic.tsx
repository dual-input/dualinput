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
import { CircleCheck, CircleDashed, Package, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, InlineLink, useShowDot, useShowShared } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"
import { ScrollPage } from "./scroller"
import { Head } from "./figure-head"
import { Swap, Room } from "./ease"
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
// control would take the first it holds, Take over.
// As the state changes, the row changes in place (user, 2026-10-31): the words and the control give
// way to the next (Swap), and a switch that only flips slides; a head's spot opens or shuts, and a
// head pops into it, as a crew row's does as its pilot joins, a new one for a new pilot.
function RoleCard({
  label,
  noun,
  session,
  sharer,
  onChange,
  children,
}: {
  label: string
  noun: string
  session: boolean
  sharer: Sharer
  onChange: (on: boolean) => void
  children?: React.ReactNode
}) {
  const { Button, Card, Separator, Switch } = useUI()
  // Every frame on the canvas draws this card, so the switch's id is each card's own.
  const id = useId()
  const someone = session ? sharer : undefined
  const takeOver = !!someone && someone !== "You"
  const says =
    someone === "You"
      ? `You're sharing ${noun}`
      : someone
        ? `${someone} is sharing ${noun}`
        : label
  return (
    <Card className="gap-0 py-0 [--card-spacing:--spacing(5)]">
      <label
        htmlFor={id}
        className={
          "box-content flex min-h-7 items-center p-(--card-spacing) " +
          (session && !takeOver
            ? "cursor-pointer transition-colors hover:bg-muted/40 active:bg-muted/60"
            : "")
        }
      >
        <HeadSpot who={someone} />
        <span
          className={
            "flex flex-1 flex-col text-sm " + (someone ? "" : "font-medium")
          }
        >
          <Swap id={says}>{says}</Swap>
          {!session && (
            <span className="text-xs font-normal text-muted-foreground">
              Sharing needs a session
            </span>
          )}
        </span>
        <Swap
          id={takeOver ? "take-over" : "switch"}
          className="ml-3 justify-items-end"
        >
          {takeOver ? (
            <Button variant="outline" size="sm" onClick={() => onChange(true)}>
              Take over
            </Button>
          ) : (
            <Switch
              id={id}
              disabled={!session}
              checked={someone === "You"}
              onCheckedChange={onChange}
            />
          )}
        </Swap>
      </label>
      {children && (
        <>
          <Separator />
          <div className="flex flex-col gap-5 p-(--card-spacing)">
            {children}
          </div>
        </>
      )}
    </Card>
  )
}

// The head's spot, its 28px and the 12px after it, eases open as a pilot starts sharing and shut as
// they stop, the head fading as it shuts. A head that arrives after the card first shows pops in,
// once the spot is partly open; one there from the start doesn't.
const HEAD_SPOT = { width: 40, ease: 300, popAfter: 120 }
function HeadSpot({ who }: { who: Sharer }) {
  const last = useRef(who)
  if (who) last.current = who
  const [was, setWas] = useState(who)
  const [popFor, setPopFor] = useState<Sharer>()
  if (who !== was) {
    setWas(who)
    if (who) setPopFor(who)
  }
  const shown = last.current
  return (
    <span
      className="flex shrink-0 overflow-hidden"
      style={{
        width: who ? HEAD_SPOT.width : 0,
        opacity: who ? 1 : 0,
        transition: `width ${HEAD_SPOT.ease}ms ease-out, opacity ${who ? 0 : 150}ms ease-in`,
      }}
    >
      {shown && (
        <Head
          key={shown}
          hex={hexOf(shown)}
          pop={popFor === shown ? HEAD_SPOT.popAfter : undefined}
        />
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
// The note and the list open and shut as rooms do (Room) as sharing starts or stops, and a line
// whose state changes swaps its icon and words in place, its detail opening or shutting under it
// (user, 2026-10-31).
function HowAndCheck({
  how,
  note,
  lines,
  rules,
}: {
  how: string
  note?: string
  lines: Line[]
  rules: boolean
}) {
  return (
    <div className="flex flex-col">
      <section className="flex flex-col">
        <h2 className="text-sm font-medium">How it works</h2>
        <p className="pt-2 text-sm text-muted-foreground">{how}</p>
        <Room pad="pt-2">
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </Room>
      </section>
      <Room pad="pt-6">
        {lines.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{rules ? "Rules" : "Check"}</h2>
            <ul className="flex flex-col gap-3">
              {lines.map((l) => (
                <li
                  key={l.id ?? String(l.says)}
                  className="flex items-baseline gap-2.5"
                >
                  <Swap id={l.state}>{STATE_ICON[l.state]}</Swap>
                  <span className="flex flex-col">
                    <Swap id={l.state} className="text-sm">
                      {l.says}
                    </Swap>
                    <Room pad="pt-0.5">
                      {l.detail && (
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
                      )}
                    </Room>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
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
  const lines = trafficLines(where.session, sharer, countsNow)
  useShowDot("traffic", differs(lines))
  useShowShared("traffic", where.session ? sharer : undefined)
  useShowShared("atc", where.session ? "James" : undefined)
  // The note speaks to the pilot whose traffic is shared, so it shows only on their tab.
  const sharing = where.session && sharer === "You"
  return (
    <ScrollPage>
      <RoleCard
        label="Share my traffic"
        noun="traffic"
        session={where.session}
        sharer={sharer}
        onChange={(on) => setSharer(on ? "You" : undefined)}
      />
      <HowAndCheck
        how="One pilot shares. Dual Input watches the AI traffic in their sim and injects it into everyone else's. This works by reading the traffic straight from the sim and works regardless of the original method of traffic generation."
        note={
          sharing
            ? "Performance issues? Since your traffic is shared as-is, PCs that aren't as powerful as yours might struggle to keep up. If that happens, decrease your traffic density in your AI traffic app."
            : undefined
        }
        lines={lines}
        rules={!where.session || !sharer}
      />
      <PacksOnThisPc packs={PACKS[packs]} />
    </ScrollPage>
  )
}

// ATC audio's settings each serve one side: the ATC app, which program a host shares, Automatic
// capturing the first of BeyondATC and SayIntentions that runs; the ATC volume, how loud another
// host's ATC plays here (record/areas/traffic-atc/01-traffic-and-atc.md, ATC audio). The output
// device carries every sound Dual Input plays, so it's set in Settings and only shown here. A
// receiving pilot who runs an ATC app of their own hears two, and nothing finds one on a receiving
// machine; the sim's own ATC can't be shared, so pilots who share ATC turn it off; and Dual Input
// carries no voice, so the crew talks, and hears the host's readbacks, over Discord
// (record/areas/product/03-v1-scope.md, Hearing ATC).
function atcLines(
  session: boolean,
  sharer: Sharer,
  capture: "capturing" | "waiting"
): Line[] {
  if (sharer === "You")
    return [
      capture === "waiting"
        ? {
            state: "differs",
            says: "Your ATC app is running",
            detail: "Waiting for BeyondATC or SayIntentions to start",
          }
        : {
            state: "ok",
            says: "Your ATC app is running",
            detail: "Sharing BeyondATC",
          },
      {
        state: "unchecked",
        says: "The sim's own ATC is off",
        detail: "Dual Input can't share it, or check it",
      },
      {
        state: "unchecked",
        says: "The crew's own ATC apps are closed",
        detail: "Dual Input can't check this",
      },
    ]
  if (sharer && session)
    return [
      {
        state: "unchecked",
        says: "Your own ATC app is closed",
        detail: "With one open you'd hear two, and Dual Input can't check this",
      },
      {
        state: "unchecked",
        says: "The sim's own ATC is off",
        detail: "Dual Input can't check this",
      },
    ]
  return [
    {
      state: "rule",
      says: "Receiving pilots should close their own ATC app",
      detail: "To avoid hearing two",
    },
    {
      state: "rule",
      says: "Everyone should turn off the sim's own ATC",
      detail: "Dual Input can't share it",
    },
  ]
}

function AtcPage({
  where,
  capture = "capturing",
}: {
  where: Where
  capture?: "capturing" | "waiting"
}) {
  const {
    Card,
    CardContent,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Slider,
  } = useUI()
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const [volume, setVolume] = useState([100])
  const hosting = where.session && sharer === "You"
  const lines = atcLines(where.session, sharer, capture)
  useShowDot("atc", differs(lines))
  useShowShared("atc", where.session ? sharer : undefined)
  useShowShared("traffic", where.session ? "James" : undefined)
  const apps = [
    { value: "auto", label: "Automatic: BeyondATC or SayIntentions" },
    { value: "pick", label: "Pick a program playing audio…" },
  ]
  return (
    <ScrollPage>
      <RoleCard
        label="Share my ATC"
        noun="ATC"
        session={where.session}
        sharer={where.session ? sharer : undefined}
        onChange={(on) => setSharer(on ? "You" : undefined)}
      >
        {(hosting || !where.session) && (
          <div className="flex flex-col gap-3">
            <span className="text-sm">ATC app</span>
            <Select items={apps} defaultValue="auto">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {apps.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </RoleCard>
      <HowAndCheck
        how="One pilot shares their ATC at a time: Dual Input plays their ATC app's voice on everyone else's machine. It carries ATC, not your voices, so talk to each other, and hear the readbacks, on Discord."
        lines={lines}
        rules={!where.session || !sharer}
      />
      {!hosting && (
        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span>Crew's ATC volume</span>
              <span className="text-muted-foreground tabular-nums">
                {volume[0]}%
              </span>
            </div>
            <Slider
              value={volume}
              onValueChange={(v: number | number[]) =>
                setVolume(Array.isArray(v) ? v : [v])
              }
              max={100}
              step={5}
            />
            <span className="text-xs text-muted-foreground">
              Plays on Headset (USB Audio) ·{" "}
              <InlineLink
                onClick={() => toast("Opening Settings on the output device")}
              >
                Change in Settings
              </InlineLink>
            </span>
          </CardContent>
        </Card>
      )}
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
}: {
  theme: Theme
  where: Where
  capture?: "capturing" | "waiting"
}) {
  return (
    <AppFrame theme={theme} tab="atc" fixed>
      <AtcPage where={where} capture={capture} />
    </AppFrame>
  )
}
