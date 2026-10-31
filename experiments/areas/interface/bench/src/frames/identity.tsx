// How others see a pilot: their name and their figure's color, beside a portrait of the figure
// whose head turns toward the cursor, as the figure in the cockpit turns where its pilot looks.
// First-time setup asks for both with it, and the Avatars tab changes them with it (user,
// 2026-10-31), so it's one card in both places.
import { useEffect, useLayoutEffect, useRef } from "react"

import { useUI } from "@/bench/ui"
import { Label } from "./shell"
import { Head } from "./figure-head"
import { FIGURE_COLORS, FigurePortrait, HEAD_IN_PORTRAIT, unit, type V } from "./figure-portrait"

export const WINDOWS_USERNAME = "jordan"
// A display name runs to 20 characters, so it fits every place the app shows it, such as the crew
// rows and Join's question; a Windows account's name runs to 20 too, so the one the field starts
// with always fits (record/areas/interface/decisions.md, A display name runs to 20 characters).
export const NAME_MAX = 20

// A crewmate whose color shows on its swatch.
export type Mate = { name: string; hue: string }

// Each swatch is a 28px target, for a VR pointer in the EFB, and shows a 22px dot, so the picked
// one's 2px ring sits 1px off the dot inside the target, and eight spread across the fields'
// column, at least 2px apart, so the row ends where the name field does, in setup's narrower card
// too (user, 2026-10-31: 20px swatches were small for VR, and the card keeps its symmetry). A color a crewmate
// wears shows as their head, as on the crew list, so a pilot sees the clash before picking it; two
// pilots may share a color and sort it out between themselves
// (record/areas/avatars/01-avatars.md, The pose). The ring eases between swatches as the pick moves.
function Swatch({ hex, name, on, mate, onPick, set }: { hex: string; name: string; on: boolean; mate?: string; onPick: () => void; set: (el: HTMLButtonElement | null) => void }) {
  return (
    <button
      ref={set}
      type="button"
      onClick={onPick}
      aria-label={mate ? `${name}, ${mate}'s color` : name}
      aria-pressed={on}
      className="relative flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="absolute inset-0 rounded-full border-2 border-foreground" style={{ opacity: on ? 1 : 0, transform: on ? "none" : "scale(0.8)", transition: "opacity 180ms ease-out, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
      {mate ? (
        <span className="flex" style={{ transform: "scale(0.786)" }}>
          <Head hex={hex} />
        </span>
      ) : (
        <span className="size-[22px] rounded-full" style={{ background: hex }} />
      )}
    </button>
  )
}

// The portrait stands as tall as the name and color fields beside it, 128px, so change it with
// them; Coherent GT drops aspect-ratio, so it can't square itself to their height. The figure looks
// at the cursor anywhere in the region it's given, the card when it's given none, and until the
// cursor comes near, at the color it wears, since facing you its nose is a dot.
export function IdentityCard({
  name,
  onName,
  hue,
  onHue,
  crew = [],
  region,
  focus,
  className,
}: {
  name: string
  onName: (name: string) => void
  hue: string
  onHue: (hue: string) => void
  crew?: Mate[]
  region?: React.RefObject<HTMLElement | null>
  focus?: boolean
  className?: string
}) {
  const { Card, CardContent, Input } = useUI()
  const field = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const swatches = useRef(new Map<string, HTMLButtonElement>())
  const aim = useRef<V>([0, 0, 1])
  const hueNow = useRef(hue)
  hueNow.current = hue

  useEffect(() => {
    if (!focus) return
    field.current?.focus({ preventScroll: true })
    field.current?.select()
  }, [focus])

  // The figure looks at a point on the page as if the page were a window in front of it, a little
  // more than the portrait's width away, so its nose points at the cursor.
  const toward = (x: number, y: number): V => {
    const b = box.current!.getBoundingClientRect()
    const dx = x - (b.left + b.width * HEAD_IN_PORTRAIT[0])
    const dy = y - (b.top + b.height * HEAD_IN_PORTRAIT[1])
    return unit([dx, -dy, b.width * 1.3])
  }
  const lookAtColor = (c: string) => {
    const s = swatches.current.get(c)?.getBoundingClientRect()
    if (s) aim.current = toward(s.left + s.width / 2, s.top + s.height / 2)
  }
  useLayoutEffect(() => lookAtColor(hue), [])
  useEffect(() => {
    const el = region?.current ?? card.current
    if (!el) return
    const move = (e: MouseEvent) => (aim.current = toward(e.clientX, e.clientY))
    const leave = () => lookAtColor(hueNow.current)
    el.addEventListener("mousemove", move)
    el.addEventListener("mouseleave", leave)
    return () => {
      el.removeEventListener("mousemove", move)
      el.removeEventListener("mouseleave", leave)
    }
    // The region is fixed for the card's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card ref={card} className={className}>
      <CardContent className="flex items-center gap-5">
        {/* The backdrop clips to the box's rounded corners on its own, since the figure's hands
            hang over the box's bottom edge. */}
        <div ref={box} className="relative size-[128px] shrink-0">
          <div className="absolute inset-0 overflow-hidden rounded-2xl bg-muted" />
          <FigurePortrait hex={FIGURE_COLORS.find((c) => c.name === hue)!.hex} aim={aim} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input ref={field} aria-label="Display name" maxLength={NAME_MAX} value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Color</Label>
            <div className="flex justify-between gap-0.5">
              {FIGURE_COLORS.map((c) => (
                <Swatch
                  key={c.name}
                  hex={c.hex}
                  name={c.name}
                  on={hue === c.name}
                  mate={crew.find((m) => m.hue === c.name)?.name}
                  onPick={() => onHue(c.name)}
                  set={(el) => {
                    if (el) swatches.current.set(c.name, el)
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
