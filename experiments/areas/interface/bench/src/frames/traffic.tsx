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
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleCheck, CircleDashed, Package, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, InlineLink, useShowDot } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"
import { ScrollPage } from "./scroller"
import { Head } from "./figure-head"
import { FIGURE_COLORS } from "./figure-portrait"

// Who shares as the frame opens: James, nobody, or this pilot; or no session at all. The pilots'
// colors are the session page's examples.
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
// Outside a session the switch is off and can't turn on. Then the role's own setting, which shows while this
// pilot is sharing and hides when they stop, and outside a session, where the settings still change
// (user, 2026-10-31). How it works says what the switch does, so the card carries no description,
// and a status of something happening now takes the progressive (user, 2026-10-31).
function RoleCard({
  id,
  label,
  noun,
  session,
  sharer,
  onChange,
  children,
}: {
  id: string
  label: string
  noun: string
  session: boolean
  sharer: Sharer
  onChange: (on: boolean) => void
  children?: React.ReactNode
}) {
  const { Button, Card, CardContent, Separator, Switch } = useUI()
  const someone = session ? sharer : undefined
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex min-h-7 items-center gap-3">
        {someone && (
          <span className="flex shrink-0">
            <Head hex={hexOf(someone)} />
          </span>
        )}
        <label
          htmlFor={id}
          className={
            "flex flex-1 flex-col text-sm " +
            (someone ? "" : "font-medium ") +
            (session ? "cursor-pointer" : "")
          }
        >
          {someone === "You"
            ? `You're sharing ${noun}`
            : someone
              ? `${someone} is sharing ${noun}`
              : label}
          {!session && (
            <span className="text-xs font-normal text-muted-foreground">
              Sharing needs a session
            </span>
          )}
        </label>
        {someone && someone !== "You" ? (
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
      </CardContent>
      {children && (
        <>
          <Separator />
          <CardContent className="flex flex-col gap-5">{children}</CardContent>
        </>
      )}
    </Card>
  )
}

// How the feature works, in a sentence or two under a heading in the card titles' style, since in
// the small muted label it read as a caption (user, 2026-10-31); then the check: one line for each rule of it, each
// with what Dual Input knows of it now (user, 2026-10-31: one place to explain, suggest, teach,
// and troubleshoot, where a guide, a comparison, and tips were scattered). A line is checked and
// fine, checked and different, with what differs under it, which also lights the tab's dot, or
// beyond what Dual Input can check, so the line is the tip; with nobody sharing, every line waits.
type State = "ok" | "differs" | "unchecked" | "rule"
type Line = { state: State; says: string; detail?: React.ReactNode }
const STATE_ICON: Record<State, React.ReactNode> = {
  ok: <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />,
  differs: <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />,
  unchecked: (
    <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  ),
  // A rule is a plain list's point rather than a state, so it takes a small solid dot, centered on
  // the line where the states' icons fill a 16px box (user, 2026-10-31: the dashed circle read as
  // "can't check" where nothing was being checked yet).
  rule: (
    <span className="flex size-4 shrink-0 items-center justify-center pt-1">
      <span className="size-1.5 rounded-full bg-muted-foreground" />
    </span>
  ),
}
// While nobody's sharing, and outside a session, there's nothing to check, so the same lines are
// the feature's rules, and the list says so (user, 2026-10-31). A note on the feature's cost sits
// under how it works, in a paragraph of its own, since it's neither a rule nor a check (user,
// 2026-10-31), on the tab of the pilot it speaks to.
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
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">How it works</h2>
        <p className="text-sm text-muted-foreground">{how}</p>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </section>
      {lines.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{rules ? "Rules" : "Check"}</h2>
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.says} className="flex items-start gap-2.5">
                {STATE_ICON[l.state]}
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm">{l.says}</span>
                  {l.detail && (
                    <span
                      className={
                        "text-xs " +
                        (l.state === "differs"
                          ? "text-warning"
                          : "text-muted-foreground")
                      }
                    >
                      {l.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
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
// 2026-10-31). The second pack's name is hypothetical, and every version is an example.
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
    <section className="flex flex-col gap-2.5 rounded-xl bg-muted/20 px-4 py-3.5 text-xs">
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
// has nothing to check, so their tab has no check (user, 2026-10-31).
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
            state: "differs",
            says: `${counts.missing} of ${sharer}'s aircraft are missing or shown as stand-ins`,
            detail: `Usually a traffic pack that differs from ${sharer}'s`,
          }
        : { state: "ok", says: `Every one of ${sharer}'s aircraft is showing` },
      counts.others
        ? {
            state: "differs",
            says: `${counts.others} aircraft in your sim aren't ${sharer}'s`,
            detail: "Turn off your own AI traffic",
          }
        : { state: "ok", says: `No aircraft but ${sharer}'s in your sim` },
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

function TrafficPage({
  where,
  packs = "match",
  counts = { missing: 0, others: 0 },
}: {
  where: Where
  packs?: keyof typeof PACKS
  counts?: Counts
}) {
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const lines = trafficLines(where.session, sharer, counts)
  useShowDot("traffic", differs(lines))
  // The note speaks to the pilot whose traffic is shared, so it shows only on their tab.
  const sharing = where.session && sharer === "You"
  return (
    <ScrollPage>
      <RoleCard
        id="share-traffic"
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
  const apps = [
    { value: "auto", label: "Automatic: BeyondATC or SayIntentions" },
    { value: "pick", label: "Pick a program playing audio…" },
  ]
  return (
    <ScrollPage>
      <RoleCard
        id="share-atc"
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
}: {
  theme: Theme
  where: Where
  packs?: keyof typeof PACKS
  counts?: Counts
}) {
  return (
    <AppFrame theme={theme} tab="traffic" fixed>
      <TrafficPage where={where} packs={packs} counts={counts} />
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
