import { useRef } from "react"
import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react"

import { cx } from "../lib/cx.ts"
import { mouseIn, useRoot } from "../lib/root.tsx"

export type SliderProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & { value: number; min?: number; max?: number; step?: number; disabled?: boolean; onValueChange?: (value: number) => void }

/** The thumb's width in px, which keeps it inside the track at either end. */
const THUMB = 24

/** Follows a drag from the window, so it keeps going off the slider, since Coherent GT has no pointer events, and so no pointer capture (record/areas/architecture/coherent-gt.md, "Web APIs"). */
export function Slider({ value, min = 0, max = 100, step = 1, disabled, onValueChange, className, ...rest }: SliderProps) {
  const { scale } = useRoot()
  const track = useRef<HTMLDivElement>(null)
  const share = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0
  const follow = (event: MouseEvent | ReactMouseEvent) => {
    const box = track.current
    if (!box) return
    const room = box.offsetWidth - THUMB
    const x = mouseIn(event, scale).x - box.getBoundingClientRect().left - THUMB / 2
    const raw = min + (Math.min(room, Math.max(0, x)) / room) * (max - min)
    onValueChange?.(Math.round(raw / step) * step)
  }
  return (
    <div
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      className={cx("group relative flex h-4 w-full cursor-pointer select-none items-center", disabled && "pointer-events-none opacity-50", className)}
      onMouseDown={(event) => {
        if (disabled || event.button !== 0) return
        event.preventDefault()
        follow(event)
        const up = () => {
          window.removeEventListener("mousemove", follow)
          window.removeEventListener("mouseup", up)
        }
        window.addEventListener("mousemove", follow)
        window.addEventListener("mouseup", up)
      }}
      {...rest}
    >
      <div ref={track} className="relative h-2 w-full overflow-hidden rounded-full bg-track">
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${share})` }} />
      </div>
      <div
        className="absolute h-4 w-6 rounded-full bg-white shadow-md ring-1 ring-black/10 hover:ring-4 hover:ring-ring/30 active:ring-4 active:ring-ring/30"
        style={{ left: `calc((100% - ${THUMB}px) * ${share})` }}
      />
    </div>
  )
}
