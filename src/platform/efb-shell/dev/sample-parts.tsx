// Parts for the sample, so the app shows its five tabs and the card's fold before the features' stages bring
// theirs: the checklist state sync's part will draw, on the entries a profile's authors would write, and a tab
// for each feature with what a page of its kind holds.

import { Button, Card, CardContent, Fades, ScrollPage, Slider, Switch, toast } from "@dualinput/ui"
import { Headset, Plane, PersonStanding } from "lucide-react"
import { useState } from "react"

import { PhaseIcon } from "../src/header/phase.tsx"
import { definePart } from "../src/part.ts"
import { Checklist } from "../src/session/checklist.tsx"

const ITEMS = [
  { id: "heading_bug", name: "Heading bug", default: "360" },
  { id: "course", name: "Course", default: "000", description: "The OBS knob, at the lower left of the HSI" },
  { id: "landing_elevation", name: "Cabin pressure controller landing field elevation", default: "1000", description: "The outer ring on the cabin pressure controller, on the right of the instrument panel, below the radios" },
  { id: "failure_rate", name: "Tablet failure rate", default: "0", description: "Each sim rolls its own failures, so every pilot sets this" },
  { id: "gps_flight_plan", name: "GPS flight plan", default: "Loaded", description: "The GPS's flight plan doesn't sync, so load the same one on every machine" },
  { id: "altimeter", name: "Altimeter setting", default: "29.92" },
  { id: "fuel_selector", name: "Fuel selector", default: "Left", description: "The selector on the floor between the seats" },
  { id: "mixture", name: "Mixture", default: "Rich" },
  { id: "propeller", name: "Propeller", default: "High RPM" },
  { id: "cowl_flaps", name: "Cowl flaps", default: "Open" },
  { id: "elevator_trim", name: "Elevator trim", default: "Takeoff", description: "The wheel left of the throttle quadrant" },
  { id: "transponder", name: "Transponder code", default: "1200" },
]

function PlaceholderPage({ title }: { title: string }) {
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(60)
  return (
    <ScrollPage>
      <Fades>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">This tab comes with its feature's stage. Words outside a card fade over the page's top as it scrolls, and cards fold under it.</p>
      </Fades>
      {[1, 2, 3, 4].map((n) => (
        <Card key={n}>
          <CardContent className="flex items-center justify-between">
            <span className="text-sm">A setting on card {n}</span>
            <Switch checked={on} onCheckedChange={setOn} />
          </CardContent>
          <CardContent>
            <Slider value={level} onValueChange={setLevel} />
          </CardContent>
          <CardContent>
            <p className="text-sm text-muted-foreground">The card shortens from its top as the page scrolls, its content fading just under the held edge while its surface stays whole.</p>
          </CardContent>
        </Card>
      ))}
    </ScrollPage>
  )
}

/** A row under the tabs on every tab, standing where Take control will. */
function UnderTabs() {
  return (
    <div className="shrink-0 px-5 pb-3">
      <Button variant="secondary" className="w-full" onClick={() => toast("Take control comes with its stage")}>
        Take control
      </Button>
    </div>
  )
}

/** A section of Settings, standing where Take control's binding will. */
function SettingsSection() {
  return (
    <section className="flex flex-col">
      <h2 className="mb-2 text-sm font-medium">Take control</h2>
      <Card>
        <CardContent className="text-sm text-muted-foreground">The binding comes with its stage.</CardContent>
      </Card>
    </section>
  )
}

export const SAMPLE_PARTS = [
  definePart({ name: "state-sync", preflight: () => <Checklist items={ITEMS} /> }),
  definePart({
    name: "traffic",
    tab: { icon: Plane, label: "Traffic", page: () => <PlaceholderPage title="Traffic" /> },
    phaseIcon: () => (
      <PhaseIcon on label="Sharing traffic">
        <Plane />
      </PhaseIcon>
    ),
  }),
  definePart({
    name: "atc-audio",
    tab: { icon: Headset, label: "ATC audio", page: () => <PlaceholderPage title="ATC audio" /> },
    phaseIcon: () => (
      <PhaseIcon on hushed label="Sharing ATC, turned all the way down here">
        <Headset />
      </PhaseIcon>
    ),
  }),
  definePart({ name: "avatars", tab: { icon: PersonStanding, label: "Figures", landing: "figures", page: () => <PlaceholderPage title="Figures" /> } }),
  definePart({ name: "take-control", underTabs: UnderTabs, settings: SettingsSection }),
]
