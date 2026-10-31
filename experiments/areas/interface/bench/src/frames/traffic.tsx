// The Traffic and ATC audio tabs. Traffic and ATC audio are shared apart, each with a host of its
// own taken by its own switch, and Dual Input doesn't check whether one pilot holds both; each tab
// holds its feature's sharing, settings, and warnings, and an amber dot on its icon flags a warning
// on every page (record/areas/interface/decisions.md, Traffic and ATC audio are shared apart, and
// The Traffic and ATC audio tabs hold their sharing, settings, and warnings). Outside a session
// the switches are off and can't be turned on, since a role is a session key, and the settings
// still change. The words, the packs' names and versions, the counts, and the devices are drafts
// and examples.
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, Dot, Info, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, InlineLink, Label, useShowDot } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"

// Who shares as the frame opens: James, nobody, or this pilot; or no session at all.
type Sharer = "James" | "You" | undefined
type Where = { session: boolean; sharer?: Sharer }

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

// A tab's page scrolls once it holds more than the window, its parts keeping their height rather
// than shrinking to fit.
const PAGE = "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 pt-0 [&>*]:shrink-0"

// A switch with what it does, and under it who shares; outside a session, why it's off.
function ShareCard({ id, label, what, noun, where, onChange }: { id: string; label: string; what: string; noun: string; where: Where & { sharer: Sharer }; onChange: (s: Sharer) => void }) {
  const { Card, CardContent, Separator, Switch } = useUI()
  const { session, sharer } = where
  const status = !session ? "Sharing needs a session. Host or join one first." : sharer === "You" ? `You share ${noun}.` : sharer ? `${sharer} shares ${noun}. Turning yours on takes over.` : `Nobody shares ${noun}.`
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex items-start gap-4">
        <label htmlFor={id} className={"flex flex-1 flex-col gap-1 " + (session ? "cursor-pointer" : "")}>
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{what}</span>
        </label>
        <Switch id={id} disabled={!session} checked={sharer === "You"} onCheckedChange={(on: boolean) => onChange(on ? "You" : undefined)} />
      </CardContent>
      <Separator />
      <CardContent>
        <p className="text-sm text-muted-foreground">{status}</p>
      </CardContent>
    </Card>
  )
}

// One line of a check: a check mark when it's fine, an amber triangle when it isn't.
function CheckLine({ ok, children, hint }: { ok: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
      <span className="flex flex-col">
        <span>{children}</span>
        {hint && !ok && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </li>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((s) => (
        <li key={s} className="flex items-start gap-1 text-sm">
          <Dot className="size-5 shrink-0 text-muted-foreground" />
          {s}
        </li>
      ))}
    </ul>
  )
}

// Traffic packs, compared by folder name and `package_version`: a receiving pilot runs the traffic
// host's packs and no others, or copies go missing, fall back to stand-ins, or float
// (record/areas/product/03-v1-scope.md, Traffic sync). Traffic's list of known packs starts with
// `fsltl-traffic-base`; the second pack's name is hypothetical, and every version is an example.
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
const packSays = (p: Pack, host: string) =>
  p.host === p.mine ? `${p.name} ${p.mine}` : !p.mine ? `${p.name}: ${host} has ${p.host}, you don't have it` : !p.host ? `${p.name}: you have ${p.mine}, ${host} doesn't run it` : `${p.name}: ${host} has ${p.host}, you have ${p.mine}`
// On the traffic host's tab, each crewmate's packs that differ from theirs.
const CREW_PACKS: { name: string; differs: string[] }[] = [{ name: "Adam", differs: ["fsltl-traffic-liveries: Adam doesn't have it", "fsltl-traffic-base: Adam has 1.1.4, you have 1.2.0"] }]

type Counts = { missing: number; others: number }

// The radius the traffic host polls within, up to the SDK's 200km cap, 200km at first
// (record/areas/traffic-atc/01-traffic-and-atc.md, Settings); it applies while this pilot shares.
function Radius() {
  const { Field, FieldLabel, FieldDescription, Slider } = useUI()
  const [km, setKm] = useState([200])
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>Radius</FieldLabel>
        <span className="text-sm text-muted-foreground tabular-nums">{km[0]} km</span>
      </div>
      <Slider value={km} onValueChange={(v: number | number[]) => setKm(Array.isArray(v) ? v : [v])} min={10} max={200} step={10} />
      <FieldDescription>How far around you to share traffic, while you share it.</FieldDescription>
    </Field>
  )
}

function TrafficPage({ where, packs = "match", counts = { missing: 0, others: 0 } }: { where: Where; packs?: keyof typeof PACKS; counts?: Counts }) {
  useFlightAround(where.session)
  const [sharer, setSharer] = useState<Sharer>(where.sharer)
  const receiving = where.session && !!sharer && sharer !== "You"
  const hosting = where.session && sharer === "You"
  const list = PACKS[packs]
  const packsDiffer = list.some((p) => p.host !== p.mine)
  const warns = (receiving && (packsDiffer || counts.missing > 0 || counts.others > 0)) || (hosting && CREW_PACKS.length > 0)
  useShowDot("traffic", warns)
  return (
    <div className={PAGE}>
      <ShareCard id="share-traffic" label="Share my traffic" what="The AI traffic in your sim shows in the others' sims." noun="traffic" where={{ ...where, sharer }} onChange={setSharer} />
      {receiving && (
        <>
          <section className="flex flex-col gap-2">
            <Label>Traffic packs</Label>
            <ul className="flex flex-col gap-2">
              {list.map((p) => (
                <CheckLine key={p.name} ok={p.host === p.mine}>
                  {packSays(p, sharer)}
                </CheckLine>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <Label>In your sim</Label>
            <ul className="flex flex-col gap-2">
              <CheckLine ok={counts.missing === 0} hint="Usually a traffic pack that differs from theirs">
                {counts.missing === 0 ? `Every one of ${sharer}'s aircraft shows` : `${counts.missing} of ${sharer}'s aircraft missing or shown as stand-ins`}
              </CheckLine>
              <CheckLine ok={counts.others === 0} hint="Turn off your own AI traffic and multiplayer">
                {counts.others === 0 ? `No aircraft but ${sharer}'s` : `${counts.others} aircraft that aren't ${sharer}'s`}
              </CheckLine>
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <Label>While {sharer} shares</Label>
            <Steps items={[`Run the same traffic packs and scenery as ${sharer}, and no others`, "Turn off your own AI traffic and multiplayer"]} />
          </section>
        </>
      )}
      {hosting && (
        <section className="flex flex-col gap-2">
          <Label>Crew's traffic packs</Label>
          <ul className="flex flex-col gap-2">
            {CREW_PACKS.map((c) => c.differs.map((d) => <CheckLine key={d} ok={false}>{d}</CheckLine>))}
          </ul>
        </section>
      )}
      <Radius />
    </div>
  )
}

// The ATC app setting: Automatic, which captures the first of BeyondATC and SayIntentions that
// runs, or one program picked from those playing audio; the ATC volume, which sets how loud the
// ATC host's speech plays here (record/areas/traffic-atc/01-traffic-and-atc.md, ATC audio). The
// output device carries every sound Dual Input plays, so it's set in Settings and only shown here.
// A receiving pilot who runs an ATC app of their own hears two, and the sim's own ATC can't be
// shared, so pilots who share ATC turn it off; Dual Input carries no voice, so the crew talks, and
// hears the ATC host's readbacks, over Discord (record/areas/product/03-v1-scope.md, Hearing ATC).
function AtcPage({ where, capture = "capturing" }: { where: Where; capture?: "capturing" | "waiting" }) {
  const { Field, FieldLabel, FieldDescription, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Slider, Spinner } = useUI()
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
  return (
    <div className={PAGE}>
      <ShareCard id="share-atc" label="Share my ATC" what="The others hear your ATC app." noun="ATC" where={{ ...where, sharer }} onChange={setSharer} />
      {hosting && (
        <p className={"flex items-center gap-2 text-sm " + (capture === "waiting" ? "text-warning" : "")}>
          {capture === "waiting" ? <Spinner className="size-4" /> : <span className="size-2 rounded-full bg-success" />}
          {capture === "waiting" ? "Waiting for BeyondATC or SayIntentions to run" : "Sharing BeyondATC"}
        </p>
      )}
      {receiving && (
        <section className="flex flex-col gap-2">
          <Label>While {sharer} shares</Label>
          <Steps items={["Close your own ATC app, or you'll hear two", "Turn off the sim's own ATC"]} />
        </section>
      )}
      {hosting && (
        <section className="flex flex-col gap-2">
          <Label>While you share</Label>
          <Steps items={["Turn off the sim's own ATC, which Dual Input can't share"]} />
        </section>
      )}
      <Field>
        <FieldLabel>ATC app</FieldLabel>
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
        <FieldDescription>The program Dual Input shares while you share ATC.</FieldDescription>
      </Field>
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel>ATC volume</FieldLabel>
          <span className="text-sm text-muted-foreground tabular-nums">{volume[0]}%</span>
        </div>
        <Slider value={volume} onValueChange={(v: number | number[]) => setVolume(Array.isArray(v) ? v : [v])} max={100} step={5} />
        <p className="text-xs text-muted-foreground">
          Plays on Headset (USB Audio). <InlineLink onClick={() => toast("Opening Settings on the output device")}>Change in Settings</InlineLink>
        </p>
      </Field>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        Dual Input shares ATC, not your voices: talk to each other, and hear the readbacks, on Discord.
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
