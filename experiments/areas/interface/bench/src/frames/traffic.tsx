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
import { ScrollPage } from "./scroller"
import { Head } from "./figure-head"
import { FIGURE_COLORS } from "./figure-portrait"

// Who shares as the frame opens: James, nobody, or this pilot; or no session at all. The pilots'
// colors are the session page's examples.
type Sharer = "James" | "You" | undefined
type Where = { session: boolean; sharer?: Sharer }
const HUE: Record<"James" | "You", string> = { James: "red", You: "orange" }
const hexOf = (pilot: "James" | "You") => FIGURE_COLORS.find((c) => c.name === HUE[pilot])!.hex

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

// The sharing card: the switch, then who's sharing, the tab's first question, by their head as on
// the crew list, with what turning a switch on does to them (user, 2026-10-31: the host's head in
// the card "was nice", where a line of the check named them); with nobody sharing, nothing, since
// the switch says it (user, 2026-10-31). Then the role's own setting, which shows while this pilot
// is sharing and hides when they stop, and outside a session, where the settings still change
// (user, 2026-10-31). How it works says what the switch does, so the card carries no description
// (user, 2026-10-31). A status of something happening now takes the progressive, "James is sharing
// traffic" (user, 2026-10-31).
function RoleCard({ id, label, noun, session, sharer, onChange, children }: { id: string; label: string; noun: string; session: boolean; sharer: Sharer; onChange: (on: boolean) => void; children?: React.ReactNode }) {
  const { Card, CardContent, Separator, Switch } = useUI()
  const who = !session ? (
    <span className="text-muted-foreground">Sharing needs a session</span>
  ) : sharer ? (
    <>
      <span className="flex shrink-0">
        <Head hex={hexOf(sharer)} />
      </span>
      <span className="flex flex-col">
        <span>{sharer === "You" ? `You're sharing ${noun}` : `${sharer} is sharing ${noun}`}</span>
        <span className="text-xs text-muted-foreground">{sharer === "You" ? "Turning theirs on takes over from you" : "Turning yours on takes over"}</span>
      </span>
    </>
  ) : undefined
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex items-start gap-4">
        <label htmlFor={id} className={"flex-1 text-sm font-medium " + (session ? "cursor-pointer" : "")}>
          {label}
        </label>
        <Switch id={id} disabled={!session} checked={sharer === "You"} onCheckedChange={onChange} />
      </CardContent>
      {who && <CardContent className="flex min-h-7 items-center gap-3 text-sm">{who}</CardContent>}
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
      CREW_PACKS.length ? { state: "differs", says: "The crew's traffic packs match yours", detail: <Lines items={CREW_PACKS} /> } : { state: "ok", says: "The crew's traffic packs match yours" },
      { state: "unchecked", says: "The crew's own AI traffic and multiplayer are off", detail: "Each crewmate's Traffic tab checks this" },
      { state: "unchecked", says: "The crew's scenery matches yours", detail: "Dual Input can't check this" },
    ]
  if (sharer && session) {
    const packsDiffer = packs.filter((p) => p.host !== p.mine)
    return [
      counts.others ? { state: "differs", says: "Your own AI traffic and multiplayer are off", detail: `${counts.others} aircraft in your sim aren't ${sharer}'s` } : { state: "ok", says: "Your own AI traffic and multiplayer are off" },
      packsDiffer.length ? { state: "differs", says: `Your traffic packs match ${sharer}'s`, detail: <Lines items={packsDiffer.map((p) => packSays(p, sharer))} /> } : { state: "ok", says: `Your traffic packs match ${sharer}'s` },
      { state: "unchecked", says: `Your scenery matches ${sharer}'s`, detail: "Dual Input can't check this" },
      counts.missing ? { state: "differs", says: `${sharer}'s aircraft are showing in your sim`, detail: `${counts.missing} missing or shown as stand-ins` } : { state: "ok", says: `${sharer}'s aircraft are showing in your sim` },
    ]
  }
  return [
    { state: "unchecked", says: "Everyone else turns off their own AI traffic and multiplayer" },
    { state: "unchecked", says: "Everyone runs the same traffic packs and scenery", detail: "Dual Input compares the packs once someone's sharing" },
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
  const lines = trafficLines(where.session, sharer, PACKS[packs], counts)
  useShowDot("traffic", differs(lines))
  return (
    <ScrollPage>
      <RoleCard id="share-traffic" label="Share my traffic" noun="traffic" session={where.session} sharer={sharer} onChange={(on) => setSharer(on ? "You" : undefined)}>
        {(sharer === "You" || !where.session) && <Radius />}
      </RoleCard>
      <HowAndCheck how="One pilot shares their traffic at a time: Dual Input copies the AI traffic in their sim into everyone else's. The copies look right when everyone else runs the same traffic packs and scenery, with their own traffic off." lines={lines} />
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
function atcLines(session: boolean, sharer: Sharer, capture: "capturing" | "waiting"): Line[] {
  if (sharer === "You")
    return [
      capture === "waiting" ? { state: "differs", says: "Your ATC app is running", detail: "Waiting for BeyondATC or SayIntentions to start" } : { state: "ok", says: "Your ATC app is running", detail: "Sharing BeyondATC" },
      { state: "unchecked", says: "The sim's own ATC is off", detail: "Dual Input can't share it, or check it" },
      { state: "unchecked", says: "The crew's own ATC apps are closed", detail: "Dual Input can't check this" },
    ]
  if (sharer && session)
    return [
      { state: "unchecked", says: "Your own ATC app is closed", detail: "With one open you'd hear two, and Dual Input can't check this" },
      { state: "unchecked", says: "The sim's own ATC is off", detail: "Dual Input can't check this" },
    ]
  return [
    { state: "unchecked", says: "Everyone else closes their own ATC app" },
    { state: "unchecked", says: "Everyone turns off the sim's own ATC" },
  ]
}

function AtcPage({ where, capture = "capturing" }: { where: Where; capture?: "capturing" | "waiting" }) {
  const { Card, CardContent, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Slider } = useUI()
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
      <RoleCard id="share-atc" label="Share my ATC" noun="ATC" session={where.session} sharer={where.session ? sharer : undefined} onChange={(on) => setSharer(on ? "You" : undefined)}>
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
    </ScrollPage>
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
