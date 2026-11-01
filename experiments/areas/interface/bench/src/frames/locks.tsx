// The cockpit's locks: what Dual Input draws over a synced display in the cockpit itself, from the
// panel bridge, which owns every lock (record/areas/pointer-sync/01-pointer-sync.md, Locks;
// record/areas/architecture/02-code-map.md, What the bridge owns). A visible lock covers each
// synced display on a machine other than the PF's while it has no link up to the PF, or while it
// catches up; it blocks presses, and the pilot may still want to read the display through it, so
// it's a dark scrim at 50% under an opaque card that says why, the banner's card, centered (user,
// 2026-11-01: "yes, build it", to my sketch). The lock that 8s to 10s after the core last renewed
// it blocks nothing becomes a strip along the display's top edge; and a press blocked while
// another pilot's gesture plays flashes the display's whole rect, one solid color with no words,
// while it's held (user, 2026-10-17). What each says is the content call of 2026-11-01 in the
// stage notes; the words are drafts, and the names and the key are examples.
// The displays here are stand-ins, a primary flight display and a radio's, drawn as plain shapes
// so the locks can be judged on something like what they cover.
import { TriangleAlert } from "lucide-react"

import { useUI } from "@/bench/ui"
import type { Theme } from "@/bench/theme"
import { Themed } from "./banner"

// A display's size on the canvas, in pixels: a primary flight display and a radio's, the smallest a
// lock is likely to cover. A cockpit display's own size varies with the aircraft, and the pilot
// sees it at an angle, near or far.
const DISPLAYS = {
  pfd: { width: 456, height: 342 },
  radio: { width: 240, height: 80 },
}
type DisplayKind = keyof typeof DISPLAYS

// One layout at every display size, its text sized from the display, a 26th of its width or a
// fifth and a half of its height, whichever is smaller, with no form that drops the words, since a
// pilot can zoom in far enough to read small text (user, 2026-11-01: "tiny text could work in tiny
// screens"). The card is the banner's, sized to its words up to 17em or 90% of the display.
const emOf = (d: { width: number; height: number }) => Math.min(d.width / 26, d.height / 5.5)

export type Lock = { kind: "lost"; key?: string } | { kind: "catching-up" } | { kind: "silent" } | { kind: "flash" }

function LockCard({ lock }: { lock: Lock }) {
  const { Spinner } = useUI()
  const lead =
    lock.kind === "lost" ? <TriangleAlert className="text-warning" style={{ width: "1.1em", height: "1.1em" }} /> : <Spinner className="text-muted-foreground" style={{ width: "1.1em", height: "1.1em" }} />
  return (
    <div className="flex items-start bg-card text-card-foreground inset-ring inset-ring-foreground/10" style={{ maxWidth: "min(90%, 17em)", padding: "0.75em 0.9em", gap: "0.6em", borderRadius: "0.6em" }}>
      <span className="flex shrink-0 items-center" style={{ height: "1.25em" }}>
        {lead}
      </span>
      <span className="flex min-w-0 flex-col" style={{ gap: "0.25em" }}>
        <span className="font-semibold" style={{ lineHeight: "1.25em" }}>
          {lock.kind === "lost" ? "Reconnecting to James" : "Catching up with James"}
        </span>
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

function LockOver({ lock }: { lock: Lock }) {
  if (lock.kind === "flash") return <div className="absolute inset-0" style={{ background: "rgba(255, 84, 32, 0.6)" }} />
  if (lock.kind === "silent")
    return (
      <div className="absolute inset-x-0 top-0 truncate bg-warning font-medium text-warning-foreground" style={{ fontSize: "0.8em", padding: "0.3em 0.7em" }}>
        Not syncing · Dual Input stopped responding
      </div>
    )
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
      <LockCard lock={lock} />
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

// A display in its bezel, on a panel's gray, with the lock over it at its size.
export function LockFrame({ theme, display = "pfd", lock }: { theme: Theme; display?: DisplayKind; lock: Lock }) {
  const d = DISPLAYS[display]
  return (
    <Themed theme={theme}>
      <div className="flex items-center justify-center rounded-xl px-6 py-10" style={{ background: "#3a3d42" }}>
        <div className="rounded-lg bg-[#111214] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="relative overflow-hidden" style={{ width: d.width, height: d.height, fontSize: emOf(d) }}>
            {display === "pfd" ? <PfdStandIn /> : <RadioStandIn />}
            <LockOver lock={lock} />
          </div>
        </div>
      </div>
    </Themed>
  )
}
