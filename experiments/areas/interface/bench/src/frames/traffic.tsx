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
import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, InlineLink, Label, useShowDot } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"

// Who shares as the frame opens: James, nobody, or this pilot; or no session at all.
type Sharer = "James" | "You" | undefined
type Where = { session: boolean; sharer?: Sharer }

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

// The sharing card: the switch and what it does, then the role's own setting, which only a pilot
// who shares or could share needs. Who shares is the check's first line.
function RoleCard({ id, label, what, session, sharing, onChange, children }: { id: string; label: string; what: string; session: boolean; sharing: boolean; onChange: (on: boolean) => void; children?: React.ReactNode }) {
  const { Card, CardContent, Separator, Switch } = useUI()
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex items-start gap-4">
        <label htmlFor={id} className={"flex flex-1 flex-col gap-1 " + (session ? "cursor-pointer" : "")}>
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{what}</span>
        </label>
        <Switch id={id} disabled={!session} checked={sharing} onCheckedChange={onChange} />
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

// How the feature works, in a sentence or two, then the check: one line for each rule of it, each
// with what Dual Input knows of it now (user, 2026-10-31: one place to explain, suggest, teach,
// and troubleshoot, where a guide, a comparison, and tips were scattered). A line is checked and
// fine, checked and different, with what differs under it, which also lights the tab's dot, or
// beyond what Dual Input can check, so the line is the tip; with nobody sharing, every line waits.
type State = "ok" | "differs" | "unchecked"
type Line = { state: State; says: string; detail?: React.ReactNode }
const STATE_ICON: Record<State, React.ReactNode> = {
  ok: <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />,
  differs: <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />,
  unchecked: <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
}
function HowAndCheck({ how, lines }: { how: string; lines: Line[] }) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <Label>How it works</Label>
        <p className="text-sm text-muted-foreground">{how}</p>
      </section>
      <section className="flex flex-col gap-3">
        <Label>Check</Label>
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.says} className="flex items-start gap-2.5">
              {STATE_ICON[l.state]}
              <span className="flex flex-col gap-0.5">
                <span className="text-sm">{l.says}</span>
                {l.detail && <span className={"text-xs " + (l.state === "differs" ? "text-warning" : "text-muted-foreground")}>{l.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
const differs = (lines: Line[]) => lines.some((l) => l.state === "differs")

// Traffic packs, compared by folder name and `package_version`: a receiving pilot runs the traffic
// host's packs and no others, or copies go missing, fall back to stand-ins, or float
// (record/areas/product/03-v1-scope.md, Traffic sync). Traffic's list of known packs starts with
// `fsltl-traffic-base`; the second pack's name is hypothetical, and every version is an example.
// Nothing compares the scenery, or, from the host's side, what the crew's own sims show.
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
const packSays = (p: Pack, host: string) => (!p.mine ? `You don't have ${p.name}, ${host} runs ${p.host}` : !p.host ? `You run ${p.name}, which ${host} doesn't` : `Your ${p.name} is ${p.mine}, ${host} runs ${p.host}`)
// On the traffic host's tab, what differs in a crewmate's packs from theirs.
const CREW_PACKS = ["Adam doesn't have fsltl-traffic-liveries", "Adam's fsltl-traffic-base is 1.1.4, yours is 1.2.0"]
type Counts = { missing: number; others: number }
const Lines = ({ items }: { items: string[] }) => (
  <>
    {items.map((i) => (
      <span key={i} className="block">
        {i}
      </span>
    ))}
  </>
)

function trafficLines(session: boolean, sharer: Sharer, packs: Pack[], counts: Counts): Line[] {
  if (sharer === "You")
    return [
      { state: "ok", says: "You share your traffic", detail: "Turning theirs on takes over from you" },
      CREW_PACKS.length ? { state: "differs", says: "The crew's traffic packs match yours", detail: <Lines items={CREW_PACKS} /> } : { state: "ok", says: "The crew's traffic packs match yours" },
      { state: "unchecked", says: "The crew's own AI traffic and multiplayer are off", detail: "Each crewmate's Traffic tab checks this" },
      { state: "unchecked", says: "The crew's scenery matches yours", detail: "Dual Input can't check this" },
    ]
  if (sharer && session) {
    const packsDiffer = packs.filter((p) => p.host !== p.mine)
    return [
      { state: "ok", says: `${sharer} shares their traffic`, detail: "Turning yours on takes over" },
      counts.others ? { state: "differs", says: "Your own AI traffic and multiplayer are off", detail: `${counts.others} aircraft in your sim aren't ${sharer}'s` } : { state: "ok", says: "Your own AI traffic and multiplayer are off" },
      packsDiffer.length ? { state: "differs", says: `Your traffic packs match ${sharer}'s`, detail: <Lines items={packsDiffer.map((p) => packSays(p, sharer))} /> } : { state: "ok", says: `Your traffic packs match ${sharer}'s` },
      { state: "unchecked", says: `Your scenery matches ${sharer}'s`, detail: "Dual Input can't check this" },
      counts.missing ? { state: "differs", says: `${sharer}'s aircraft show in your sim`, detail: `${counts.missing} missing or shown as stand-ins` } : { state: "ok", says: `${sharer}'s aircraft show in your sim` },
    ]
  }
  return [
    { state: "unchecked", says: "One pilot shares their traffic", detail: session ? "Nobody shares yet" : "Sharing needs a session" },
    { state: "unchecked", says: "Everyone else turns off their own AI traffic and multiplayer" },
    { state: "unchecked", says: "Everyone runs the same traffic packs and scenery", detail: "Dual Input compares the packs once someone shares" },
  ]
}

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
  const lines = trafficLines(where.session, sharer, PACKS[packs], counts)
  useShowDot("traffic", differs(lines))
  return (
    <div className={PAGE}>
      <RoleCard id="share-traffic" label="Share my traffic" what="The AI traffic in your sim shows in the others' sims." session={where.session} sharing={sharer === "You"} onChange={(on) => setSharer(on ? "You" : undefined)}>
        {!receiving && <Radius />}
      </RoleCard>
      <HowAndCheck how="One pilot shares their traffic at a time: Dual Input copies the AI traffic in their sim into everyone else's. The copies look right when everyone else runs the same traffic packs and scenery, with their own traffic off." lines={lines} />
    </div>
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
function atcLines(session: boolean, sharer: Sharer, capture: "capturing" | "waiting"): Line[] {
  if (sharer === "You")
    return [
      { state: "ok", says: "You share your ATC", detail: "Turning theirs on takes over from you" },
      capture === "waiting" ? { state: "differs", says: "Your ATC app runs", detail: "Waiting for BeyondATC or SayIntentions to run" } : { state: "ok", says: "Your ATC app runs", detail: "Sharing BeyondATC" },
      { state: "unchecked", says: "The sim's own ATC is off", detail: "Dual Input can't share it, or check it" },
      { state: "unchecked", says: "The crew's own ATC apps are closed", detail: "Dual Input can't check this" },
    ]
  if (sharer && session)
    return [
      { state: "ok", says: `${sharer} shares their ATC`, detail: "Turning yours on takes over" },
      { state: "unchecked", says: "Your own ATC app is closed", detail: "Dual Input can't check this. With one open, you'd hear two" },
      { state: "unchecked", says: "The sim's own ATC is off", detail: "Dual Input can't check this" },
    ]
  return [
    { state: "unchecked", says: "One pilot shares their ATC", detail: session ? "Nobody shares yet" : "Sharing needs a session" },
    { state: "unchecked", says: "Everyone else closes their own ATC app" },
    { state: "unchecked", says: "Everyone turns off the sim's own ATC" },
  ]
}

function AtcPage({ where, capture = "capturing" }: { where: Where; capture?: "capturing" | "waiting" }) {
  const { Card, CardContent, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Slider } = useUI()
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const [volume, setVolume] = useState([100])
  const receiving = where.session && !!sharer && sharer !== "You"
  const hosting = where.session && sharer === "You"
  const lines = atcLines(where.session, sharer, capture)
  useShowDot("atc", differs(lines))
  const apps = [
    { value: "auto", label: "Automatic: BeyondATC or SayIntentions" },
    { value: "pick", label: "Pick a program playing audio…" },
  ]
  return (
    <div className={PAGE}>
      <RoleCard id="share-atc" label="Share my ATC" what="The others hear your ATC app." session={where.session} sharing={hosting} onChange={(on) => setSharer(on ? "You" : undefined)}>
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
          </div>
        )}
      </RoleCard>
      <HowAndCheck how="One pilot shares their ATC at a time: Dual Input plays their ATC app's voice on everyone else's machine. It carries ATC, not your voices, so talk to each other, and hear the readbacks, on Discord." lines={lines} />
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
          </CardContent>
        </Card>
      )}
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
