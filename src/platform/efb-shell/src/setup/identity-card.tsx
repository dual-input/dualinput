// How others see a pilot: their name and their figure's color, beside a portrait of the figure whose head turns
// toward the cursor, as the figure in the cockpit turns where its pilot looks. First-time setup asks for both with
// it, and the Figures tab changes them with it, so it's one card in both places.

import { Card, CardContent, Input, useRoot } from "@dualinput/ui"
import { useEffect, useLayoutEffect, useRef } from "react"
import type { RefObject } from "react"

import { FigurePortrait, HEAD_IN_PORTRAIT } from "../figure/portrait.tsx"
import { FIGURE_COLORS } from "@dualinput/crew"
import { unit } from "@dualinput/crew/trace"
import type { V } from "@dualinput/crew/trace"

/** A display name runs to 20 characters, so it fits every place the app shows it, and a Windows account's name runs to 20 too, so the one the field starts with always fits. */
export const NAME_MAX = 20

/** As tall as the name and color fields beside it, in the root's units, and square, since Coherent GT drops aspect-ratio. */
const PORTRAIT = 128

/** Each swatch is a 28px target, for a VR pointer, showing a 22px dot, so the picked one's 2px ring sits 1px off the dot inside it. */
function Swatch({ hex, name, on, onPick, set }: { hex: string; name: string; on: boolean; onPick: () => void; set: (element: HTMLButtonElement | null) => void }) {
  return (
    <button ref={set} type="button" onClick={onPick} aria-label={name} aria-pressed={on} className="relative flex size-7 shrink-0 items-center justify-center rounded-full">
      <span className="absolute inset-x-0 inset-y-0 rounded-full border-2 border-foreground" style={{ opacity: on ? 1 : 0, transform: on ? "none" : "scale(0.8)", transition: "opacity 180ms ease-out, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
      <span className="size-[22px] rounded-full" style={{ background: hex }} />
    </button>
  )
}

export type IdentityCardProps = {
  name: string
  onName: (name: string) => void
  /** The picked color, by its name in the palette. */
  color: string
  onColor: (color: string) => void
  /** Where the figure watches the cursor, the card with none given. */
  region?: RefObject<HTMLElement | null>
  focus?: boolean
}

/** Until the cursor comes near, the figure looks at the color it wears, since facing you its nose is a dot. */
export function IdentityCard({ name, onName, color, onColor, region, focus }: IdentityCardProps) {
  const { scale } = useRoot()
  const field = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const swatches = useRef(new Map<string, HTMLButtonElement>())
  const aim = useRef<V>([0, 0, 1])
  const colorNow = useRef(color)
  colorNow.current = color

  useEffect(() => {
    if (!focus) return
    field.current?.focus()
    field.current?.select()
  }, [focus])

  /** A point on the page as if the page were a window in front of the figure, a little more than the portrait's width away. */
  const toward = (x: number, y: number): V => {
    const b = box.current!.getBoundingClientRect()
    return unit([x - (b.left + b.width * HEAD_IN_PORTRAIT[0]), -(y - (b.top + b.height * HEAD_IN_PORTRAIT[1])), b.width * 1.3])
  }
  const lookAtColor = (name: string) => {
    const swatch = swatches.current.get(name)?.getBoundingClientRect()
    if (swatch) aim.current = toward(swatch.left + swatch.width / 2, swatch.top + swatch.height / 2)
  }
  useLayoutEffect(() => lookAtColor(color), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = region?.current ?? card.current
    if (!element) return
    const move = (event: MouseEvent) => {
      aim.current = toward(event.clientX / scale, event.clientY / scale)
    }
    const leave = () => lookAtColor(colorNow.current)
    element.addEventListener("mousemove", move)
    element.addEventListener("mouseleave", leave)
    return () => {
      element.removeEventListener("mousemove", move)
      element.removeEventListener("mouseleave", leave)
    }
    // The region is fixed for the card's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  return (
    <div ref={card}>
      <Card>
        <CardContent className="flex items-center">
          <div ref={box} className="relative mr-5 shrink-0" style={{ width: PORTRAIT, height: PORTRAIT }}>
            <FigurePortrait hex={FIGURE_COLORS.find((candidate) => candidate.name === color)!.hex} size={PORTRAIT} aim={aim} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="mb-2 text-xs text-muted-foreground">Name</span>
            <Input ref={field} title="Display name" aria-label="Display name" maxLength={NAME_MAX} value={name} onChange={(event) => onName(event.target.value)} />
            <span className="mb-2 mt-4 text-xs text-muted-foreground">Color</span>
            <div className="flex justify-between">
              {FIGURE_COLORS.map((candidate) => (
                <Swatch
                  key={candidate.name}
                  hex={candidate.hex}
                  name={candidate.name}
                  on={color === candidate.name}
                  onPick={() => onColor(candidate.name)}
                  set={(element) => {
                    if (element) swatches.current.set(candidate.name, element)
                  }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
