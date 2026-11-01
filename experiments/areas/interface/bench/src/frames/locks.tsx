// The cockpit's locks: what Dual Input draws over a synced display in the cockpit itself, from the
// panel bridge, which owns every lock (record/areas/pointer-sync/01-pointer-sync.md, Locks;
// record/areas/architecture/02-code-map.md, What the bridge owns). A visible lock covers each
// synced display on a machine other than the PF's while it has no link up to the PF, or while it
// catches up; it blocks presses, and the pilot may still want to read the display through it, so
// it's a veil the display shows through, under an opaque card that says why, the banner's card,
// centered (user, 2026-11-01: "yes, build it", to my sketch). A lock the core hasn't renewed for 8s
// to 10s turns into a warning that blocks nothing, since the core is silent and whatever sits in
// the pilot's input path fails open (record/areas/architecture/02-code-map.md, What the bridge
// owns): it looks like a lock, its veil and card over the whole display, but presses pass through
// it, and only its Dismiss takes one, which dismisses the warning on every display at once (user,
// 2026-11-01: "a full overlay here with a dismiss button that dismisses all not responding
// overlays at once"; tried and dropped: a strip along the display's top edge). With the core
// silent, the panels tell each other without it, through a shared `L:` variable perhaps, which no
// run has tried. And a press blocked while another pilot's gesture plays flashes the display's
// whole rect, one solid color with no words, while it's held (user, 2026-10-17). What each says is the content call of 2026-11-01 in the
// stage notes; the words are drafts, and the names and the key are examples.
// The displays here are stand-ins, a primary flight display and a radio's, drawn as plain shapes
// so the locks can be judged on something like what they cover.
import { useState } from "react"
import { CircleX, TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { Themed } from "./banner"

// A display's size on the canvas, in pixels: a primary flight display, a large one, and a radio's,
// the smallest a lock is likely to cover. A cockpit display's own size varies with the aircraft,
// and the pilot sees it at an angle, near or far.
const DISPLAYS = {
  pfd: { width: 456, height: 342 },
  large: { width: 800, height: 600 },
  radio: { width: 240, height: 80 },
}
type DisplayKind = keyof typeof DISPLAYS

// One layout at every display size, its text 16px, the banner's scale, and smaller on a display
// too small for it, a 26th of its width, or as much as lets its card's height fit, with no form
// that drops the words, since a pilot can zoom in far enough to read small text (user, 2026-11-01:
// "tiny text could work in tiny screens", then of a card that grew with the display: "are we
// oversizing the overlay card on larger panels? I'd rather not"). The card is the banner's, sized
// to its words up to 20em or 90% of the display; its height in em, with room around it, is the
// lost link's 6, the catch-up's 3.5, and the stopped warning's 9, with its button.
const CARD_EMS = { lost: 6, "catching-up": 3.5, silent: 9, flash: 1 }
const emOf = (d: { width: number; height: number }, lock: Lock) => Math.min(16, d.width / 26, d.height / CARD_EMS[lock.kind])

export type Lock = { kind: "lost"; key?: string } | { kind: "catching-up" } | { kind: "silent" } | { kind: "flash" }

const TITLE = { lost: "Reconnecting to James", "catching-up": "Catching up with James", silent: "Dual Input stopped responding" }
function LockCard({ lock, onDismiss }: { lock: Exclude<Lock, { kind: "flash" }>; onDismiss?: () => void }) {
  const { Spinner } = useUI()
  const icon = { width: "1.1em", height: "1.1em" }
  const lead = lock.kind === "lost" ? <TriangleAlert className="text-warning" style={icon} /> : lock.kind === "silent" ? <CircleX className="text-destructive" style={icon} /> : <Spinner className="text-muted-foreground" style={icon} />
  return (
    <div className="flex items-start bg-card text-card-foreground inset-ring inset-ring-foreground/10" style={{ maxWidth: "min(90%, 20em)", padding: "0.75em 0.9em", gap: "0.6em", borderRadius: "0.6em" }}>
      <span className="flex shrink-0 items-center" style={{ height: "1.25em" }}>
        {lead}
      </span>
      <span className="flex min-w-0 flex-col" style={{ gap: "0.25em" }}>
        <span className="font-semibold" style={{ lineHeight: "1.25em" }}>
          {TITLE[lock.kind]}
        </span>
        {lock.kind === "silent" && (
          <>
            <span className="text-muted-foreground" style={{ fontSize: "0.8em", lineHeight: 1.35 }}>
              This screen works, but it isn't syncing until Dual Input is back.
            </span>
            {/* The kit's secondary button, in em, so it scales with the card. */}
            <button
              type="button"
              onClick={onDismiss}
              className="pointer-events-auto self-start bg-secondary font-medium text-secondary-foreground outline-none hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-ring active:[transform:translateY(1px)]"
              style={{ marginTop: "0.45em", fontSize: "0.8em", padding: "0.35em 0.8em", borderRadius: "0.45em" }}
            >
              Dismiss
            </button>
          </>
        )}
        {lock.kind === "lost" && (
          <span className="text-muted-foreground" style={{ fontSize: "0.8em", lineHeight: 1.35 }}>
            Wait for them to come back.{" "}
            {lock.key ? (
              <>
                If they don't, press <span className="font-semibold text-foreground">{lock.key}</span> to take control.
              </>
            ) : (
              "If they don't, take control in Dual Input's EFB app."
            )}
          </span>
        )}
      </span>
    </div>
  )
}

// The veil is tinted for its lock, amber from our warning color for a lost link, red from our
// trouble color once Dual Input stops responding, and neutral for a catch-up, at about 45%, with a
// fine diagonal hatch over it in the same tint, which reads as "disabled" at any display size, as
// FS Copilot's lock does (user, 2026-11-01: "the visual overlay backdrops we implemented there were
// nicer looking"). The hatch is a 4px tile, fine as FS Copilot's 8px one looked on panels whose
// pages are wider than the screen they're shown on (user, 2026-11-01: "the hatching seems to thick
// compared to what we built in fsc"), repeated by background-size rather than drawn as one
// repeating gradient, since Coherent GT works gradients out at reduced precision, and a few pixels'
// period across a wide panel smeared into broad bands (FS Copilot fork, overlay.js, apply).
const VEIL = {
  lost: { veil: "rgba(22, 17, 6, 0.48)", hatch: "rgba(241, 190, 77, 0.14)" },
  "catching-up": { veil: "rgba(10, 12, 16, 0.48)", hatch: "rgba(255, 255, 255, 0.07)" },
  silent: { veil: "rgba(24, 9, 10, 0.44)", hatch: "rgba(234, 121, 119, 0.14)" },
}
const HATCH_TILE = 4
const hatched = (veil: string, line: string): React.CSSProperties => ({
  backgroundColor: veil,
  backgroundImage: `linear-gradient(45deg, ${line} 25%, transparent 25%, transparent 50%, ${line} 50%, ${line} 75%, transparent 75%, transparent)`,
  backgroundSize: `${HATCH_TILE}px ${HATCH_TILE}px`,
})

function LockOver({ lock, onDismiss }: { lock: Lock; onDismiss?: () => void }) {
  if (lock.kind === "flash") return <div className="absolute inset-0" style={{ background: "rgba(255, 84, 32, 0.6)" }} />
  return (
    <div className={"absolute inset-0 flex items-center justify-center " + (lock.kind === "silent" ? "pointer-events-none" : "")} style={hatched(VEIL[lock.kind].veil, VEIL[lock.kind].hatch)}>
      <LockCard lock={lock} onDismiss={onDismiss} />
    </div>
  )
}

// The stand-ins: an attitude display's sky and ground with a horizon, a speed and an altitude tape
// at its sides, and a radio's two frequencies.
function PfdStandIn() {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(180deg, #2f6fc4 0%, #5d9be0 52%, #7a4f2a 52%, #5e3b1e 100%)" }}>
      <div className="absolute inset-x-0 h-0.5 bg-white" style={{ top: "52%" }} />
      <div className="absolute left-1/2 h-1.5 w-28 rounded-full bg-yellow-300" style={{ top: "52%", marginLeft: -56, marginTop: -3 }} />
      {[
        { left: 0, says: "122" },
        { right: 0, says: "3500" },
      ].map((t) => (
        <div key={t.says} className="absolute inset-y-8 flex w-16 items-center justify-center bg-black/45 font-mono text-sm text-white" style={{ left: t.left, right: t.right }}>
          <span className="border border-white bg-black px-1">{t.says}</span>
        </div>
      ))}
    </div>
  )
}
function RadioStandIn() {
  return (
    <div className="absolute inset-0 flex items-center justify-around bg-[#0b0f0c] font-mono text-lg text-[#5cf08a]">
      <span>121.500</span>
      <span className="text-[#5cc8f0]">118.700</span>
    </div>
  )
}

// Displays in their bezels, on a panel's gray, each with the lock over it at its size. A warning
// dismissed on one display goes from every display in the frame, as it goes from every panel.
export function LockFrame({ theme, displays = ["pfd"], lock }: { theme: Theme; displays?: DisplayKind[]; lock: Lock }) {
  const [dismissed, setDismissed] = useState(false)
  return (
    <Themed theme={theme}>
      <div className="flex items-center justify-center gap-6 rounded-xl px-6 py-10" style={{ background: "#3a3d42" }}>
        {displays.map((kind, i) => {
          const d = DISPLAYS[kind]
          return (
            <div key={i} className="rounded-lg bg-[#111214] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="relative overflow-hidden" style={{ width: d.width, height: d.height, fontSize: emOf(d, lock) }}>
                {kind === "radio" ? <RadioStandIn /> : <PfdStandIn />}
                {!dismissed && <LockOver lock={lock} onDismiss={() => setDismissed(true)} />}
              </div>
            </div>
          )
        })}
      </div>
    </Themed>
  )
}
