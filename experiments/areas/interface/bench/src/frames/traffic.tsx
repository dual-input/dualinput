// The Traffic and ATC audio tabs, each holding its feature's switch, since traffic and ATC audio are
// shared apart, each with a host of its own, and Dual Input doesn't check whether one pilot holds
// both (user, 2026-10-31; record/areas/interface/decisions.md, Traffic and ATC audio are shared
// apart). On the traffic host, the AI traffic in their sim shows in every other pilot's sim; on the
// ATC host, their ATC app's speech plays on every other pilot's machine; and any pilot takes either
// role by turning their own switch on (record/areas/product/03-v1-scope.md, Traffic sync and
// Hearing ATC). Under the switch, each tab says what a pilot sets by hand for it to work, which
// home's guide leaves to these tabs (user, 2026-10-29). The tabs' design is a first pass, made
// without a sketch (user, 2026-10-31: "I'll skip the sketch this time and see what we get"). The
// words are drafts.
import { useMemo, useRef, useState } from "react"
import { Dot } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, Label, type Tab } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"

// Who shares as the frame opens: James, nobody, or this pilot. The names are examples.
type Sharer = "James" | "You" | undefined

// Each tab's switch and what a pilot sets by hand, receiving or sharing. A receiving pilot runs the
// same traffic packs and scenery as the traffic host and no others, or copies go missing or float,
// and nothing removes or hides another source's traffic, so their own goes off. A receiving pilot
// who runs an ATC app of their own hears two ATCs, since nothing finds one on a receiving machine
// (record/areas/traffic-atc/01-traffic-and-atc.md, Known limits), and the sim's own ATC can't be
// shared, so pilots who share ATC turn it off (record/areas/product/03-v1-scope.md, Hearing ATC).
const SHARING = {
  traffic: {
    switch: "Share my traffic",
    what: "The AI traffic in your sim shows in the others' sims.",
    noun: "traffic",
    receiving: (host: string) => [`Run the same traffic packs and scenery as ${host}, and no others`, "Turn off your own AI traffic and multiplayer"],
    sharing: ["Run your traffic as you would alone, from the sim or an injector"],
  },
  atc: {
    switch: "Share my ATC",
    what: "The others hear your ATC app, such as BeyondATC, which Dual Input finds by itself.",
    noun: "ATC",
    receiving: () => ["Close your own ATC app, or you'll hear two", "Turn off the sim's own ATC"],
    sharing: ["Run your ATC app", "Turn off the sim's own ATC, which Dual Input can't share"],
  },
}
type Feature = keyof typeof SHARING

function SharePage({ feature, first }: { feature: Feature; first: Sharer }) {
  const { Card, CardContent, Separator, Switch } = useUI()
  const f = SHARING[feature]
  const [sharer, setSharer] = useState<Sharer>(first)
  // The frames show these tabs in a flight, so the header has the phase and the strip shows under
  // the tabs, as on every tab while flying.
  useShowPhase("syncing")
  useShowSession(true)
  const [mine, setMine] = useState(false)
  const takeNow = useRef(() => setMine(true))
  const control = useMemo<Control>(() => ({ mine, pf: "James", bound: "F9", take: () => takeNow.current() }), [mine])
  useShowControl(control)

  const status = sharer === "You" ? `You share ${f.noun}.` : sharer ? `${sharer} shares ${f.noun}. Turning yours on takes over.` : `Nobody shares ${f.noun}.`
  const steps = sharer === "You" ? f.sharing : sharer ? f.receiving(sharer) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 p-5 pt-0">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex items-start gap-4">
          <label htmlFor={`share-${feature}`} className="flex flex-1 cursor-pointer flex-col gap-1">
            <span className="text-sm font-medium">{f.switch}</span>
            <span className="text-xs text-muted-foreground">{f.what}</span>
          </label>
          <Switch id={`share-${feature}`} checked={sharer === "You"} onCheckedChange={(on: boolean) => setSharer(on ? "You" : undefined)} />
        </CardContent>
        <Separator />
        <CardContent>
          <p className="text-sm text-muted-foreground">{status}</p>
        </CardContent>
      </Card>
      {steps && (
        <section className="flex flex-col gap-2">
          <Label>{sharer === "You" ? "While you share" : `While ${sharer} shares`}</Label>
          <ul className="flex flex-col gap-1.5">
            {steps.map((s) => (
              <li key={s} className="flex items-start gap-1 text-sm">
                <Dot className="size-5 shrink-0 text-muted-foreground" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const TAB: Record<Feature, Tab> = { traffic: "traffic", atc: "atc" }
export function ShareFrame({ theme, feature, sharer }: { theme: Theme; feature: Feature; sharer?: Sharer }) {
  return (
    <AppFrame theme={theme} tab={TAB[feature]} fixed>
      <SharePage feature={feature} first={sharer} />
    </AppFrame>
  )
}
