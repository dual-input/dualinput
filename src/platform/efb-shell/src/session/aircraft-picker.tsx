// The supported aircraft, in a large popup over the EFB app: the pilot's installed ones first, then the rest, dimmed,
// which they'd have to get first. Simmers don't expect an EFB to switch their aircraft, so on the world map the popup
// says a pick loads it, and each installed aircraft is a tile, the whole of it the button
// (record/areas/interface/decisions.md, "The aircraft picker loads an aircraft through the world map's store").

import { Badge, cx, Dialog, fadeMask, NO_SCROLLBAR, showPress, Spinner, toast, useScroller } from "@dualinput/ui"
import type { BadgeVariant } from "@dualinput/ui"
import { Check, ChevronRight, CircleCheck, Contrast, FlaskConical, Gem } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import type { ProfileStatus } from "../../../../engines/messages/ts/profiles/ProfileStatus.ts"
import type { SupportedAircraft } from "../../../../engines/messages/ts/profiles/SupportedAircraft.ts"
import { inFolders, sameAircraft } from "./pick.ts"

const nameOf = (aircraft: SupportedAircraft) => `${aircraft.maker} ${aircraft.model}`
const byName = (a: SupportedAircraft, b: SupportedAircraft) => nameOf(a).localeCompare(nameOf(b))

/**
 * Flawless stands out in a pearl's sheen, since it's rare, Complete and Partial rank by brightness, and Experimental warns in
 * amber, since the aircraft itself may misbehave with two pilots. Each carries an icon, so Complete and Partial differ
 * at a glance, and Experimental differs from the start card's amber Not supported yet.
 */
const STATUS_BADGES: Record<ProfileStatus, [BadgeVariant, LucideIcon]> = {
  Flawless: ["pearl", Gem],
  Complete: ["soft", CircleCheck],
  Partial: ["faint", Contrast],
  Experimental: ["warning", FlaskConical],
}

/** How well a shared cockpit works in an aircraft, by its profile's status, as the picker and the start card tag it. */
export function StatusBadge({ status }: { status: ProfileStatus }) {
  const [variant, Icon] = STATUS_BADGES[status]
  return (
    <Badge variant={variant}>
      <Icon />
      {status}
    </Badge>
  )
}

/** How long a tile says it's loaded before the popup closes, in milliseconds. */
const LOADED_MS = 500

/** The maker over the model, as the start card names the loaded aircraft, with the status beside it. */
function Naming({ aircraft }: { aircraft: SupportedAircraft }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-xs text-muted-foreground">{aircraft.maker}</span>
      <span className="flex min-w-0 items-center">
        <span className="mr-2 truncate font-medium">{aircraft.model}</span>
        <StatusBadge status={aircraft.status} />
      </span>
    </span>
  )
}

const TILE = "flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left"

function Heading({ first, children }: { first: boolean; children: ReactNode }) {
  return <p className={cx("px-1 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground", first ? "pt-1" : "pt-5")}>{children}</p>
}

export type AircraftPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  aircraft: SupportedAircraft[]
  /** Whether the pilot is at Free flight's world map, the one place a pick can load. */
  canLoad: boolean
  inFlight: boolean
  /** What the sim says is loaded, by its path, which tells a pick has landed. */
  loaded: { path: string } | null
  /** Asks the core to load it, which refuses or takes the ask. */
  onPick: (aircraft: SupportedAircraft) => Promise<void>
  /** How many picks the world map couldn't carry out, which counts up when one the core took fails. */
  failed: number
}

export function AircraftPicker({ open, onOpenChange, aircraft, canLoad, inFlight, loaded, onPick, failed }: AircraftPickerProps) {
  const [choice, setChoice] = useState<{ aircraft: SupportedAircraft; loaded: boolean; failed: number } | null>(null)
  const scroller = useScroller()
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (open) setChoice(null)
  }, [open])
  const choose = (picked: SupportedAircraft) => {
    if (choice) return
    setChoice({ aircraft: picked, loaded: false, failed })
    onPick(picked).catch(() => {
      setChoice(null)
      toast("Dual Input couldn't load that aircraft")
    })
  }
  // The core took the pick, and the world map couldn't carry it out.
  const missed = !!choice && !choice.loaded && failed > choice.failed
  useEffect(() => {
    if (!missed) return
    setChoice(null)
    toast("Dual Input couldn't load that aircraft")
  }, [missed])
  const landed = !!choice && !choice.loaded && !!loaded && inFolders(loaded.path, choice.aircraft.folders)
  useEffect(() => {
    if (!landed) return
    setChoice((now) => now && { ...now, loaded: true })
    timer.current = window.setTimeout(() => onOpenChange(false), LOADED_MS)
  }, [landed, onOpenChange])
  const installed = aircraft.filter((one) => one.installed).sort(byName)
  const others = aircraft.filter((one) => !one.installed).sort(byName)
  const pickable = canLoad && installed.length > 0
  const chosen = (one: SupportedAircraft) => !!choice && sameAircraft(choice.aircraft, one)
  const state = (one: SupportedAircraft) =>
    !choice || !chosen(one) ? (
      <span className="ml-3 flex shrink-0 items-center text-sm font-medium text-primary">
        Load <ChevronRight className="ml-0.5 size-4" />
      </span>
    ) : choice.loaded ? (
      <span className="ml-3 flex shrink-0 items-center text-sm text-success">
        <Check className="mr-1.5 size-4" /> Loaded
      </span>
    ) : (
      <span className="ml-3 flex shrink-0 items-center text-sm text-muted-foreground">
        <Spinner className="mr-2 size-3.5" /> Loading…
      </span>
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Supported aircraft" description={pickable ? "Click one to load it in the sim." : inFlight ? "To switch aircraft, end this flight and pick one on the world map." : undefined}>
      <div
        ref={scroller.ref}
        onScroll={scroller.onScroll}
        onMouseDown={scroller.onMouseDown}
        onWheel={scroller.onWheel}
        className={cx("relative min-h-0 flex-1 select-none overflow-y-auto px-5 pb-5", NO_SCROLLBAR, scroller.cursor)}
        style={fadeMask(scroller.above, scroller.below, 32, 40)}
      >
        {installed.length > 0 && (
          <>
            <Heading first>Installed · {installed.length}</Heading>
            <div className="space-y-1.5">
              {installed.map((one) =>
                pickable ? (
                  <button
                    key={nameOf(one)}
                    type="button"
                    onMouseDown={showPress}
                    onClick={() => choose(one)}
                    disabled={!!choice && !chosen(one)}
                    className={cx(TILE, "bg-muted/40 hover:bg-muted/70 disabled:opacity-40 data-[pressed]:translate-y-[var(--hair)] data-[pressed]:bg-muted")}
                  >
                    <Naming aircraft={one} />
                    {state(one)}
                  </button>
                ) : (
                  <div key={nameOf(one)} className={cx(TILE, "bg-muted/40")}>
                    <Naming aircraft={one} />
                  </div>
                ),
              )}
            </div>
          </>
        )}
        <Heading first={installed.length === 0}>Not installed · {others.length}</Heading>
        {/* Dimmed to set them apart from the tiles, and at full strength when there are none, since dimming them all would make the whole popup look disabled. */}
        <div className="space-y-2.5 px-1 pt-1">
          {others.map((one) => (
            <div key={nameOf(one)} className={cx("flex items-center justify-between", installed.length > 0 && "opacity-50")}>
              <span className="mr-3 truncate">
                <span className="text-muted-foreground">{one.maker}</span> {one.model}
              </span>
              <StatusBadge status={one.status} />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
