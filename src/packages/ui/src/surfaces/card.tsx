import { useRef } from "react"
import type { HTMLAttributes } from "react"

import { cx } from "../lib/cx.ts"
import { useFold } from "../motion/scroll-page.tsx"

export type CardProps = HTMLAttributes<HTMLDivElement> & { flush?: boolean; tint?: string }

const SURFACE = "rounded-4xl bg-card text-sm text-card-foreground shadow-md"
const SPACED = "space-y-5 py-5"

/**
 * A surface of the app. `flush` drops its space above and below and between what it holds, for rows that
 * reach its edges. `tint` makes it a tint of the page, with no border or shadow and smaller corners, as a
 * note or a guide is, by the tint's class. On a scrolling page it owns its fold: an unclipped wrapper around
 * a clipped layer with its surface, and an edge layer, so the clip can't cut the edge, and the fade is on
 * what it holds, not the surface (record/areas/interface/decisions.md, "A scrolling page folds its surfaces").
 */
export function Card({ flush, tint, className, children, ...rest }: CardProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLDivElement>(null)
  const edge = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useFold(wrapper, clip, edge, content)
  return (
    <div ref={wrapper} className={cx("relative", className)} {...rest}>
      <div ref={clip} className={cx("overflow-hidden", tint ? cx("rounded-2xl text-sm", tint) : SURFACE)}>
        <div ref={content} className={cx("flex flex-col", !flush && SPACED)}>
          {children}
        </div>
      </div>
      <div ref={edge} aria-hidden className={cx("pointer-events-none absolute inset-x-0 bottom-0 top-0", tint ? "rounded-2xl" : "rounded-4xl ring-1 ring-foreground/10")} />
    </div>
  )
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-5", className)} {...rest} />
}
