// The Traffic and ATC audio tabs. Traffic and ATC audio are shared apart, each with a host of its
// own taken by its own switch, and Dual Input doesn't check whether one pilot holds both; each tab
// holds its feature's sharing, settings, and warnings, and an amber dot on its icon flags a warning
// on every page (record/areas/interface/decisions.md, Traffic and ATC audio are shared apart, and
// The Traffic and ATC audio tabs hold their sharing, settings, and warnings). Outside a session
// the switches are off and can't be turned on, since a role is a session key, and the settings
// still change.
// Each tab answers its first question first: who shares, in one card with the switch and the
// role's own setting. Under it, only what this pilot's part needs: a receiving pilot's comparison
// with the host, which says "matches" in one line or lists only what differs, each with its fix;
// and a setting shows only for the role it serves (user, 2026-10-31: a first pass gave every part
// the same weight and repeated its advice). The words, the packs' names and versions, the counts,
// and the devices are drafts and examples.
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { CircleCheck, Info, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, InlineLink, Label, useShowDot } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"
import { Head } from "./figure-head"
import { FIGURE_COLORS } from "./figure-portrait"

// Who shares as the frame opens: James, nobody, or this pilot; or no session at all. The pilots'
// colors are the session page's examples.
type Sharer = "James" | "You" | undefined
type Where = { session: boolean; sharer?: Sharer }
const HUE: Record<"James" | "You", string> = { James: "red", You: "orange" }
const hexOf = (pilot: "James" | "You") => FIGURE_COLORS.find((c) => c.name === HUE[pilot])!.hex

// A tab's page scrolls once it holds more than the window, its parts keeping their height rather
// than shrinking to fit.
const PAGE = "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 pt-0 [&>*]:shrink-0"

// The flight's frame around a tab: the phase in the header and the take-control strip under the
// tabs while flying, as on every tab; neither outside a session.
function useFlightAround(session: boolean) {
  useShowPhase(session ? "syncing" : undefined)
  useShowSession(session)
  const [mine, setMine] = useState(false)
  const takeNow = useRef(() => setMine(true))
  const control = useMemo<Control | undefined>(() => (session ? { mine, pf: "James", bound: "F9", take: () => takeNow.current() } : undefined), [session, mine])
  useShowControl(control)
}

// The sharing card: the switch and what it does, then who shares, by their head as on the crew
// list, with a line under it: for another pilot's role, that turning this one on takes over, and
// for this pilot's, its state where it has one, such as which ATC app it shares; then the role's
// own setting, which only a pilot who shares or could share needs.
function RoleCard({ id, label, what, noun, session, sharer, onChange, state, children }: { id: string; label: string; what: string; noun: string; session: boolean; sharer: Sharer; onChange: (s: Sharer) => void; state?: React.ReactNode; children?: React.ReactNode }) {
  const { Card, CardContent, Separator, Switch } = useUI()
  const who = !session ? (
    <span className="text-muted-foreground">Sharing needs a session</span>
  ) : sharer ? (
    <>
      <span className="flex shrink-0">
        <Head hex={hexOf(sharer)} />
      </span>
      <span className="flex flex-col">
        <span>{sharer === "You" ? `You share ${noun}` : `${sharer} shares ${noun}`}</span>
        {sharer !== "You" ? <span className="text-xs text-muted-foreground">Turning yours on takes over</span> : state}
      </span>
    </>
  ) : (
    <span className="text-muted-foreground">Nobody shares {noun}</span>
  )
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex items-start gap-4">
        <label htmlFor={id} className={"flex flex-1 flex-col gap-1 " + (session ? "cursor-pointer" : "")}>
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{what}</span>
        </label>
        <Switch id={id} disabled={!session} checked={sharer === "You"} onCheckedChange={(on: boolean) => onChange(on ? "You" : undefined)} />
      </CardContent>
      <CardContent className="flex min-h-7 items-center gap-3 text-sm">{who}</CardContent>
      {children && (
        <>
          <Separator />
          <CardContent className="flex flex-col gap-5">{children}</CardContent>
        </>
      )}
    </Card>
  )
}

// A receiving pilot's comparison with the host: one line while everything matches, and otherwise
// only what differs, each with its fix under it.
type Difference = { says: string; fix: string }
function Comparison({ title, matches, differences, note }: { title: string; matches: string; differences: Difference[]; note?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <Label>{title}</Label>
      {differences.length === 0 ? (
        <p className="flex items-center gap-2.5 text-sm">
          <CircleCheck className="size-4 shrink-0 text-success" />
          {matches}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {differences.map((d) => (
            <li key={d.says} className="flex items-start gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm">{d.says}</span>
                <span className="text-xs text-muted-foreground">{d.fix}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  )
}

// Traffic packs, compared by folder name and `package_version`: a receiving pilot runs the traffic
// host's packs and no others, or copies go missing, fall back to stand-ins, or float
// (record/areas/product/03-v1-scope.md, Traffic sync). Traffic's list of known packs starts with
// `fsltl-traffic-base`; the second pack's name is hypothetical, and every version is an example.
// The comparison can't see the scenery, so a note asks for the same.
type Pack = { name: string; host?: string; mine?: string }
const PACKS: Record<"match" | "differ", Pack[]> = {
  match: [
    { name: "fsltl-traffic-base", host: "1.2.0", mine: "1.2.0" },
    { name: "fsltl-traffic-liveries", host: "2.0.3", mine: "2.0.3" },
  ],
  differ: [
    { name: "fsltl-traffic-base", host: "1.2.0", mine: "1.1.4" },
    { name: "fsltl-traffic-liveries", host: "2.0.3" },
  ],
}
const packDifference = (p: Pack, host: string): Difference =>
  !p.mine
    ? { says: `You don't have ${p.name}`, fix: `Install it: ${host} runs ${p.host}` }
    : !p.host
      ? { says: `You run ${p.name}, which ${host} doesn't`, fix: "Turn it off for this flight" }
      : { says: `Your ${p.name} is ${p.mine}`, fix: `${host} runs ${p.host}` }
// On the traffic host's tab, what differs in a crewmate's packs from theirs.
const CREW_PACKS: Difference[] = [
  { says: "Adam doesn't have fsltl-traffic-liveries", fix: "You run 2.0.3" },
  { says: "Adam's fsltl-traffic-base is 1.1.4", fix: "You run 1.2.0" },
]
type Counts = { missing: number; others: number }

// The radius the traffic host polls within, up to the SDK's 200km cap, 200km at first
// (record/areas/traffic-atc/01-traffic-and-atc.md, Settings).
function Radius() {
  const { Slider } = useUI()
  const [km, setKm] = useState([200])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span>Radius</span>
        <span className="text-muted-foreground tabular-nums">{km[0]} km</span>
      </div>
      <Slider value={km} onValueChange={(v: number | number[]) => setKm(Array.isArray(v) ? v : [v])} min={10} max={200} step={10} />
    </div>
  )
}

function TrafficPage({ where, packs = "match", counts = { missing: 0, others: 0 } }: { where: Where; packs?: keyof typeof PACKS; counts?: Counts }) {
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const receiving = where.session && !!sharer && sharer !== "You"
  const hosting = where.session && sharer === "You"
  const host = sharer ?? ""
  const differences: Difference[] = receiving
    ? [
        ...PACKS[packs].filter((p) => p.host !== p.mine).map((p) => packDifference(p, host)),
        ...(counts.missing > 0 ? [{ says: `${counts.missing} of ${host}'s aircraft missing or shown as stand-ins`, fix: "Usually a traffic pack that differs" }] : []),
        ...(counts.others > 0 ? [{ says: `${counts.others} aircraft that aren't ${host}'s`, fix: "Turn off your own AI traffic and multiplayer" }] : []),
      ]
    : []
  useShowDot("traffic", differences.length > 0 || (hosting && CREW_PACKS.length > 0))
  return (
    <div className={PAGE}>
      <RoleCard id="share-traffic" label="Share my traffic" what="The AI traffic in your sim shows in the others' sims." noun="traffic" session={where.session} sharer={sharer} onChange={setSharer}>
        {!receiving && <Radius />}
      </RoleCard>
      {receiving && (
        <Comparison
          title={`Your traffic and ${host}'s`}
          matches={`Your traffic packs and the aircraft in your sim match ${host}'s`}
          differences={differences}
          note={`Use the same scenery as ${host} too, which Dual Input can't compare.`}
        />
      )}
      {hosting && <Comparison title="The crew's traffic packs" matches="Everyone runs your traffic packs" differences={CREW_PACKS} />}
    </div>
  )
}

// ATC audio's settings each serve one side: the ATC app, which program a host shares, Automatic
// capturing the first of BeyondATC and SayIntentions that runs; the ATC volume, how loud another
// host's ATC plays here (record/areas/traffic-atc/01-traffic-and-atc.md, ATC audio). The output
// device carries every sound Dual Input plays, so it's set in Settings and only shown here. A
// receiving pilot who runs an ATC app of their own hears two, and the sim's own ATC can't be
// shared, so pilots who share ATC turn it off; Dual Input carries no voice, so the crew talks, and
// hears the host's readbacks, over Discord (record/areas/product/03-v1-scope.md, Hearing ATC).
function AtcPage({ where, capture = "capturing" }: { where: Where; capture?: "capturing" | "waiting" }) {
  const { Card, CardContent, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Slider, Spinner } = useUI()
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const [volume, setVolume] = useState([100])
  const receiving = where.session && !!sharer && sharer !== "You"
  const hosting = where.session && sharer === "You"
  useShowDot("atc", hosting && capture === "waiting")
  const apps = [
    { value: "auto", label: "Automatic: BeyondATC or SayIntentions" },
    { value: "pick", label: "Pick a program playing audio…" },
  ]
  const state =
    capture === "waiting" ? (
      <span className="flex items-center gap-1.5 text-xs text-warning">
        <Spinner className="size-3" /> Waiting for BeyondATC or SayIntentions to run
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">From BeyondATC</span>
    )
  return (
    <div className={PAGE}>
      <RoleCard id="share-atc" label="Share my ATC" what="The others hear your ATC app." noun="ATC" session={where.session} sharer={sharer} onChange={setSharer} state={state}>
        {!receiving && (
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
            <span className="text-xs text-muted-foreground">Turn off the sim's own ATC while you share, since Dual Input can't share it.</span>
          </div>
        )}
      </RoleCard>
      {!hosting && (
        <Card className="[--card-spacing:--spacing(5)]">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span>Crew's ATC volume</span>
              <span className="text-muted-foreground tabular-nums">{volume[0]}%</span>
            </div>
            <Slider value={volume} onValueChange={(v: number | number[]) => setVolume(Array.isArray(v) ? v : [v])} max={100} step={5} />
            <span className="text-xs text-muted-foreground">
              Plays on Headset (USB Audio) · <InlineLink onClick={() => toast("Opening Settings on the output device")}>Change in Settings</InlineLink>
            </span>
            {receiving && <span className="text-xs text-muted-foreground">Close your own ATC app and turn off the sim's, or you'll hear two.</span>}
          </CardContent>
        </Card>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        Dual Input shares ATC, not your voices. Talk to each other, and hear the readbacks, on Discord.
      </p>
    </div>
  )
}

export function TrafficFrame({ theme, where, packs, counts }: { theme: Theme; where: Where; packs?: keyof typeof PACKS; counts?: Counts }) {
  return (
    <AppFrame theme={theme} tab="traffic" fixed>
      <TrafficPage where={where} packs={packs} counts={counts} />
    </AppFrame>
  )
}
export function AtcFrame({ theme, where, capture }: { theme: Theme; where: Where; capture?: "capturing" | "waiting" }) {
  return (
    <AppFrame theme={theme} tab="atc" fixed>
      <AtcPage where={where} capture={capture} />
    </AppFrame>
  )
}
