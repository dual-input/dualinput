// The aircraft on home: the one the sim has loaded, every aircraft Dual Input has a profile for, and
// the picker that switches the pilot to one of those. The aircraft, their tail numbers, and which
// are installed are examples.
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Check, ChevronRight, XIcon } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { AppFrame } from "./shell"
import { useScroller } from "./scroller"

// An aircraft as home names it: the maker from its package's manifest, the model, and its tail
// number, which the sim reports as `A:ATC ID`; for one Dual Input has a profile for, the maturity
// the profile's authors set, and whether the pilot has it installed.
export type Aircraft = { maker: string; model: string; tail?: string; maturity?: "Stable" | "Experimental"; installed?: boolean }

export const LOADED: Aircraft = { maker: "Black Square", model: "Baron 58P", tail: "N58BK", maturity: "Stable", installed: true }
export const LOADED_UNSUPPORTED: Aircraft = { maker: "Fenix", model: "A320", tail: "G-FNXA" }
export const PROFILES: Aircraft[] = [
  LOADED,
  { maker: "Synaptic Simulations", model: "A220-300", tail: "C-GJYA", maturity: "Stable", installed: true },
  { maker: "A2A Simulations", model: "PA24-250 Comanche", tail: "N6338P", maturity: "Experimental", installed: true },
  { maker: "FSReborn", model: "Phenom 300E", tail: "PR-NHT", maturity: "Experimental", installed: true },
  { maker: "PMDG", model: "777-300ER", tail: "A6-ENZ", maturity: "Experimental", installed: true },
  { maker: "A2A Simulations", model: "Aerostar 600", maturity: "Experimental" },
  { maker: "Black Square", model: "Bonanza", maturity: "Stable" },
  { maker: "iniBuilds", model: "A350", maturity: "Experimental" },
  { maker: "iniBuilds", model: "A380", maturity: "Experimental" },
  { maker: "iniBuilds", model: "L-1011 TriStar", maturity: "Experimental" },
]
const nameOf = (a: Aircraft) => `${a.maker} ${a.model}`
const byName = (a: Aircraft, b: Aircraft) => nameOf(a).localeCompare(nameOf(b))

// Where the pilot is, which decides whether the picker can switch. On the world map it asks the
// core to select the aircraft there, through the menu script Go to uses, since the EFB's own
// document can't make the world map's requests (record/areas/interface/log.md, 2026-10-25), and
// the menu's can (2026-10-05). In a flight it can't: the selection lives on the world map, and
// Dual Input doesn't switch an aircraft mid-flight (user, 2026-10-29). A frame also says which
// aircraft have profiles, and which of those the pilot has installed.
export type At = "world-map" | "flight"
export const AircraftContext = createContext<{ at: At; pick: (a: Aircraft) => void; profiles: Aircraft[] }>({ at: "world-map", pick: () => {}, profiles: PROFILES })
// The supported aircraft for a pilot who has none of them, as a pilot might early on, while there
// are few profiles.
export const NONE_INSTALLED = PROFILES.map((a) => ({ ...a, installed: false }))

// The picker on its own, over a plain window of the app, since more than one page opens it: home
// in an unsupported aircraft, and later Settings. It opens with the frame; a pick closes it, with
// nothing behind it to follow the new aircraft, and Replay opens it again. A frame says where the
// pilot is, and whether they have none of the supported aircraft.
export function AircraftPickerFrame({ theme, at = "world-map", noneInstalled }: { theme: Theme; at?: At; noneInstalled?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <AircraftContext.Provider value={{ at, pick: () => {}, profiles: noneInstalled ? NONE_INSTALLED : PROFILES }}>
      <AppFrame theme={theme} status={null} fixed>
        <div className="flex-1" />
        <AircraftPicker open={open} onOpenChange={setOpen} />
      </AppFrame>
    </AircraftContext.Provider>
  )
}

// The world map showed a newly selected aircraft within 1s (record/areas/interface/log.md,
// 2026-10-05), and the sim then reports it, which moves home on; the bench fakes the wait. Loaded,
// the tile says so for a moment before the popup closes. In milliseconds.
const SWITCH_MS = 1000
const LOADED_MS = 500

// The supported aircraft, in a large popup over the EFB app: the pilot's installed ones first, then
// the rest, dimmed, which they'd have to get first. Simmers don't expect an EFB to switch their
// aircraft, so on the world map the popup says a pick loads it, and each installed aircraft is a
// tile, the whole of it the button, with a sky Load, the app's color for what can be pressed. In a
// flight it only lists them, as tiles without Load, since nothing can be picked there. A press shows on the
// tile: it brightens under the pointer, darkens and dips 1px as it's pressed, then shows it's
// loading and, once loaded, a check, while the others wait dimmed. A tile is 52px tall, for a VR
// pointer's waver.
//
// It's the kit's dialog, opened inside the app's window, the element marked data-app-frame, rather
// than over the page, so the frames canvas shows it at the EFB's size; it scrolls with fades, as the
// authors' notes do.
export function AircraftPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { Badge, Button, Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle, Spinner } = useUI()
  const { at, pick, profiles } = useContext(AircraftContext)
  const anchor = useRef<HTMLSpanElement>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useEffect(() => setRoot(anchor.current?.closest<HTMLElement>("[data-app-frame]") ?? null), [])
  const [choice, setChoice] = useState<{ aircraft: Aircraft; loaded: boolean } | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const scroller = useScroller()

  const choose = (a: Aircraft) => {
    if (choice) return
    setChoice({ aircraft: a, loaded: false })
    later(SWITCH_MS, () => {
      setChoice({ aircraft: a, loaded: true })
      later(LOADED_MS, () => {
        onOpenChange(false)
        later(150, () => pick(a))
      })
    })
  }
  const installed = profiles.filter((a) => a.installed).sort(byName)
  const others = profiles.filter((a) => !a.installed).sort(byName)
  const canPick = at === "world-map" && installed.length > 0
  const fade = (to: "top" | "bottom", shown: boolean): React.CSSProperties => ({ background: `linear-gradient(to ${to === "top" ? "bottom" : "top"}, var(--popover), transparent)`, opacity: shown ? 1 : 0 })
  // A group's heading and count stay at full strength, even over the dimmed group.
  const heading = (text: string, count: number, first?: boolean) => (
    <p className={"px-1 pb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase " + (first ? "pt-1" : "pt-5")}>
      {text} · {count}
    </p>
  )
  // The maker over the model, as the start card names the loaded aircraft, with the maturity beside it.
  const naming = (a: Aircraft) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-xs text-muted-foreground">{a.maker}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{a.model}</span>
        <Badge variant={a.maturity === "Stable" ? "secondary" : "outline"}>{a.maturity}</Badge>
      </span>
    </span>
  )
  // 12px at the sides and 8px above and below.
  const tile = "flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left"
  const state = (a: Aircraft) =>
    choice?.aircraft !== a ? (
      // Medium, as the kit sets every button's text, the app's other links among them.
      <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary">
        Load <ChevronRight className="size-4" />
      </span>
    ) : choice.loaded ? (
      <span className="flex shrink-0 items-center gap-1.5 text-sm text-success">
        <Check className="size-4" /> Loaded
      </span>
    ) : (
      <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" /> Loading…
      </span>
    )

  return (
    <>
      <span ref={anchor} hidden />
      {root && (
        // Not modal, and not closed by a press outside it: on the frames canvas, outside is every
        // other frame, which a modal dialog would hold until a press there closed it. Its overlay
        // covers only the app's window and closes it, as a press outside it does in the EFB,
        // whose window is all there is.
        <Dialog open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
          <DialogPortal container={root}>
            {/* Coherent GT has no backdrop-filter, so the bench draws none either. */}
            <DialogOverlay className="absolute bg-black/50 supports-backdrop-filter:backdrop-blur-none" onClick={() => onOpenChange(false)} />
            <DialogPrimitive.Popup className="absolute top-4 right-4 bottom-4 left-4 z-50 flex flex-col rounded-4xl bg-popover text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 duration-100 outline-none data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
              <div className="flex shrink-0 items-start justify-between gap-3 pt-5 pr-4 pb-3 pl-6">
                <div className="flex flex-col gap-1.5 pt-1.5">
                  <DialogTitle>Supported aircraft</DialogTitle>
                  {canPick && <p className="text-sm text-muted-foreground">Click one to load it in the sim.</p>}
                </div>
                <DialogClose render={<Button variant="ghost" size="icon-sm" className="bg-secondary" />}>
                  <XIcon />
                  <span className="sr-only">Close</span>
                </DialogClose>
              </div>
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                  ref={scroller.ref}
                  onScroll={scroller.onScroll}
                  onMouseDown={scroller.onMouseDown}
                  className={"min-h-0 flex-1 overflow-y-auto px-5 pb-5 select-none [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-foreground/20 [&::-webkit-scrollbar-track]:bg-transparent " + scroller.cursor}
                >
                  {/* With none installed, the group is left out, and the list opens on the rest,
                      whose heading says why none can be picked. */}
                  {installed.length > 0 && heading("Installed", installed.length, true)}
                  {installed.length === 0 ? null : canPick ? (
                    <div className="flex flex-col gap-1.5">
                      {installed.map((a) => (
                        // A transform rather than the translate property, which Coherent GT lacks
                        // (record/areas/architecture/coherent-gt.md).
                        <button
                          key={nameOf(a)}
                          onClick={() => choose(a)}
                          disabled={!!choice && choice.aircraft !== a}
                          className={tile + " bg-muted/40 transition-[background-color,transform,opacity] duration-100 outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/30 active:bg-muted active:[transform:translateY(1px)] disabled:opacity-40"}
                        >
                          {naming(a)}
                          {state(a)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    // In a flight they're still tiles, which read better than rows, with no Load.
                    <div className="flex flex-col gap-1.5">
                      {installed.map((a) => (
                        <div key={nameOf(a)} className={tile + " bg-muted/40"}>
                          {naming(a)}
                        </div>
                      ))}
                    </div>
                  )}
                  {heading("Not installed", others.length, installed.length === 0)}
                  {/* Not tiles, since none can be picked: one line each, lined up with their
                      heading, the maturity at the right edge, where the tiles show Load. They're
                      dimmed to set them apart from the tiles, and at full strength when there are
                      none, since dimming them all would make the whole popup look disabled. */}
                  <div className="flex flex-col gap-2.5 px-1 pt-1">
                    {others.map((a) => (
                      <div key={nameOf(a)} className={"flex items-center justify-between gap-3 " + (installed.length > 0 ? "opacity-50" : "")}>
                        <span className="truncate">
                          <span className="text-muted-foreground">{a.maker}</span> {a.model}
                        </span>
                        <Badge variant={a.maturity === "Stable" ? "secondary" : "outline"}>{a.maturity}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pointer-events-none absolute top-0 right-0 left-0 h-8 transition-opacity duration-200" style={fade("top", scroller.above)} />
                <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-10 rounded-b-4xl transition-opacity duration-200" style={fade("bottom", scroller.below)} />
              </div>
            </DialogPrimitive.Popup>
          </DialogPortal>
        </Dialog>
      )}
    </>
  )
}
