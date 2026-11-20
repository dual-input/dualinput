// What sits under the start card on home: on a first visit the guide, and after it, in an aircraft Dual Input has a
// profile for, the pilot's figure, waiting for them to host, or in one it doesn't, what a session there still shares.

import { Link, Tooltip } from "@dualinput/ui"
import { ArrowRightLeft, BookOpen, Check, ExternalLink, TriangleAlert } from "lucide-react"
import { useState } from "react"
import type { RefObject } from "react"

import { StandingFigure } from "../figure/standing-figure.tsx"
import type { FigureSignals } from "../figure/standing-figure.tsx"
import { FIGURE_COLORS } from "@dualinput/crew"
import type { ProfilesSlice } from "../../../../engines/messages/ts/profiles/ProfilesSlice.ts"
import type { SimSlice } from "../../../../engines/messages/ts/sim/SimSlice.ts"
import { useCoreSlice, useShell } from "../part.ts"
import { FIGURE_COLOR, GUIDE_DONE, useSetting, writeSetting } from "../settings/setting.ts"
import { AircraftPicker } from "./aircraft-picker.tsx"
import type { PickableAircraft } from "./aircraft-picker.tsx"
import { Farewell, WelcomeGuide } from "./guide.tsx"
import type { HomeAircraft } from "./start-side.tsx"

const SHARED_UNSUPPORTED = ["Share flight and physics", "Pass control between each other", "Share Traffic and ATC"]

/** Each link reaches 4px above and below its text, so for a VR pointer, which wavers, the two are 28px targets that meet. */
function UnsupportedAircraft({ onPick }: { onPick: () => void }) {
  return (
    <section>
      <h3 className="flex items-center text-base font-semibold">
        <TriangleAlert className="mr-2 size-4 shrink-0 text-warning" />
        Dual Input has no profile for this aircraft yet
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground">You can still fly together and:</p>
      <ul className="mt-2.5 space-y-2 text-sm">
        {SHARED_UNSUPPORTED.map((what) => (
          <li key={what} className="flex items-center">
            <Check className="mr-3 size-4 shrink-0 text-success" />
            {what}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-muted-foreground">Other options:</p>
      <div className="mt-1.5 flex flex-col items-start">
        <Link className="py-1 font-medium" onClick={onPick}>
          <ArrowRightLeft className="mr-3 inline size-4 align-[-3px]" />
          Switch to a supported aircraft
        </Link>
        {/* Disabled until its page exists. */}
        <Tooltip content="Coming soon">
          <span className="inline-flex">
            <Link className="py-1 font-medium" disabled>
              <BookOpen className="mr-3 inline size-4 align-[-3px]" />
              Learn how to build a profile <ExternalLink className="ml-1 inline size-3.5 align-[-2px]" />
            </Link>
          </span>
        </Tooltip>
      </div>
    </section>
  )
}

export function HomeRest({ page, signals, aircraft, onFigureGone }: { page: RefObject<HTMLElement | null>; signals: FigureSignals; aircraft: HomeAircraft | null; onFigureGone: () => void }) {
  const { link } = useShell()
  const sim = useCoreSlice<SimSlice>("sim")
  const profiles = useCoreSlice<ProfilesSlice>("profiles")
  const guideDone = useSetting(link, GUIDE_DONE)
  const figureColor = useSetting(link, FIGURE_COLOR)
  const [picking, setPicking] = useState(false)
  const [farewell, setFarewell] = useState(false)
  const [guideGone, setGuideGone] = useState(false)
  const supported = !!aircraft?.maturity
  const guiding = guideDone === false && !guideGone
  // Orange for a pilot who never picked a color. `FIRST_COLOR` in src/features/avatars/efb/part.tsx and `CrewCard`'s
  // color in ../setup/setup-flow.tsx name the same color, so change all three together.
  const color = FIGURE_COLORS.find((candidate) => candidate.name === figureColor)?.hex ?? FIGURE_COLORS[5]!.hex
  const onPick = (picked: PickableAircraft) => link.client.command("profiles.pick", { maker: picked.maker, model: picked.model })
  return (
    <div className="relative mt-6 flex min-h-0 flex-1 flex-col">
      {guiding ? (
        <WelcomeGuide
          supported={supported}
          onPick={() => setPicking(true)}
          onLeave={() => setFarewell(true)}
          onClose={() => {
            setGuideGone(true)
            writeSetting(link, GUIDE_DONE, true)
          }}
        />
      ) : !aircraft ? null : !supported ? (
        <UnsupportedAircraft onPick={() => setPicking(true)} />
      ) : !farewell ? (
        // It runs through the page's bottom and right padding, to the tab bar and the window's edge, so its legs leave the page at the tab bar rather than ending in the air.
        <div className="relative -mb-5 -mr-5 ml-auto min-h-0 w-[260px] flex-1 self-end">
          <StandingFigure hex={color} page={page} signals={signals} onGone={onFigureGone} />
        </div>
      ) : null}
      {farewell && <Farewell onGone={() => setFarewell(false)} />}
      <AircraftPicker open={picking} onOpenChange={setPicking} aircraft={profiles?.supported ?? []} canLoad={sim?.where === "world-map"} inFlight={sim?.where === "flight"} loaded={sim?.aircraft ?? null} onPick={onPick} failed={profiles?.pick_failed ?? 0} />
    </div>
  )
}
