// The traffic tab, the switch's home (user, 2026-10-31: the session page has no clean place for it).
// One pilot at a time shares, the traffic and ATC host: the AI traffic in their sim shows in every
// other pilot's sim, and their ATC app's audio plays on every other pilot's machine, and any pilot
// takes the role by turning their own switch on (record/areas/product/03-v1-scope.md, Traffic sync
// and Hearing ATC). The page under the switch says what each side sets by hand, which home's guide
// leaves to this tab (user, 2026-10-29). The tab's design is a first pass, made without a sketch
// (user, 2026-10-31: "I'll skip the sketch this time and see what we get"). The words are drafts.
import { useMemo, useRef, useState } from "react"
import { Dot } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame, Label } from "./shell"
import { useShowPhase } from "./phase"
import { useShowControl, useShowSession, type Control } from "./flight"

// Who shares as the frame opens: James, nobody, or this pilot. The names are examples.
type Sharer = "James" | "You" | undefined

// What a pilot sets by hand for shared traffic and ATC to work. A receiving pilot runs the same
// traffic packs and scenery as the host and no others, or aircraft go missing or float; nothing
// removes or hides another source's traffic, so their own AI traffic and multiplayer go off; and
// the sim's own ATC can't be shared, so pilots who share ATC turn it off
// (record/areas/product/03-v1-scope.md, Traffic sync and Hearing ATC).
const RECEIVING = (host: string) => [`Run the same traffic packs and scenery as ${host}, and no others`, "Turn off your own AI traffic and multiplayer", "Turn off the sim's own ATC"]
const SHARING = ["Run your ATC app, such as BeyondATC, which Dual Input finds by itself", "Turn off the sim's own ATC, which Dual Input can't share"]

function TrafficPage({ first }: { first: Sharer }) {
  const { Card, CardContent, Separator, Switch } = useUI()
  const [sharer, setSharer] = useState<Sharer>(first)
  // The frames show this tab in a flight, so the header has the phase and the strip shows under
  // the tabs, as on every tab while flying.
  useShowPhase("syncing")
  useShowSession(true)
  const [mine, setMine] = useState(false)
  const takeNow = useRef(() => setMine(true))
  const control = useMemo<Control>(() => ({ mine, pf: "James", bound: "F9", take: () => takeNow.current() }), [mine])
  useShowControl(control)

  const status = sharer === "You" ? "You share traffic and ATC." : sharer ? `${sharer} shares traffic and ATC. Turning yours on takes over.` : "Nobody shares traffic and ATC."
  const steps = sharer === "You" ? SHARING : sharer ? RECEIVING(sharer) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 p-5 pt-0">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent className="flex items-start gap-4">
          <label htmlFor="share-traffic" className="flex flex-1 cursor-pointer flex-col gap-1">
            <span className="text-sm font-medium">Share my traffic and ATC</span>
            <span className="text-xs text-muted-foreground">The AI traffic in your sim shows in the others' sims, and they hear your ATC app.</span>
          </label>
          <Switch id="share-traffic" checked={sharer === "You"} onCheckedChange={(on: boolean) => setSharer(on ? "You" : undefined)} />
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

export function TrafficFrame({ theme, sharer }: { theme: Theme; sharer?: Sharer }) {
  return (
    <AppFrame theme={theme} tab="traffic" fixed>
      <TrafficPage first={sharer} />
    </AppFrame>
  )
}
