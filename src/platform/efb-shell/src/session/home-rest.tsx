// What sits under the start card on home: on a first visit the guide, and after it, in an aircraft Dual Input has a
// profile for, the pilot's figure, waiting for them to host, or in one it doesn't, what a session there still shares.

import { Link, toast, Tooltip } from "@dualinput/ui"
import { ArrowRightLeft, BookOpen, Check, ExternalLink, TriangleAlert } from "lucide-react"
import { useState } from "react"
import type { RefObject } from "react"

import { StandingFigure } from "../figure/standing-figure.tsx"
import type { FigureSignals } from "../figure/standing-figure.tsx"
import { FIGURE_COLORS } from "@dualinput/crew"
import { useCoreSlice, useShell } from "../part.ts"
import { WANTED } from "../wanted.ts"
import type { Wanted } from "../wanted.ts"
import { AircraftPicker } from "./aircraft-picker.tsx"
import type { PickableAircraft } from "./aircraft-picker.tsx"
import { Farewell, WelcomeGuide } from "./guide.tsx"

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

export function HomeRest({ page, signals, onFigureGone }: { page: RefObject<HTMLElement | null>; signals: FigureSignals; onFigureGone: () => void }) {
  const { link } = useShell()
  const wanted = useCoreSlice<Wanted>(WANTED)
  const [picking, setPicking] = useState(false)
  const [farewell, setFarewell] = useState(false)
  const [guideGone, setGuideGone] = useState(false)
  const aircraft = wanted?.aircraft
  const supported = !!aircraft?.maturity
  const guiding = !!wanted?.firstVisit && !guideGone
  const color = FIGURE_COLORS.find((candidate) => candidate.name === wanted?.color)?.hex ?? FIGURE_COLORS[5]!.hex
  const onPick = (picked: PickableAircraft) => link.client.command("aircraft.pick", { maker: picked.maker, model: picked.model }).catch(() => toast("Dual Input couldn't load that aircraft"))
  return (
    <div className="relative mt-6 flex min-h-0 flex-1 flex-col">
      {guiding ? (
        <WelcomeGuide
          supported={supported}
          onPick={() => setPicking(true)}
          onLeave={() => setFarewell(true)}
          onClose={() => {
            setGuideGone(true)
            void link.client.command("guide.done", null).catch(() => {})
          }}
        />
      ) : !aircraft ? null : !supported ? (
        <UnsupportedAircraft onPick={() => setPicking(true)} />
      ) : !farewell ? (
        // It runs through the page's bottom and right padding, to the tab bar and the window's edge, so its legs leave the page at the tab bar rather than ending in the air.
        <div className="relative -mb-5 -mr-5 ml-auto w-[260px] flex-1 self-end">
          <StandingFigure hex={color} page={page} signals={signals} onGone={onFigureGone} />
        </div>
      ) : null}
      {farewell && <Farewell onGone={() => setFarewell(false)} />}
      <AircraftPicker open={picking} onOpenChange={setPicking} aircraft={wanted?.supported ?? []} canLoad={wanted?.where !== "flight"} onPick={onPick} />
    </div>
  )
}
