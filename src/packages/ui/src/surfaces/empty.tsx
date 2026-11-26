import { createContext, useContext } from "react"
import type { HTMLAttributes } from "react"

import { cx } from "../lib/cx.ts"

// shadcn's empty state in its Luma style, for a place with nothing in it yet: an icon, a title, a line on what fills
// it, and what to do (read in https://ui.shadcn.com/r/styles/base-luma/empty.json on 2026-11-25). It spaces its parts
// with margins where shadcn's has `gap`, which msfs-tailwind turns off since Coherent GT drops it, and leaves out
// `text-balance` for the same reason (record/areas/architecture/coherent-gt.md, "CSS").

/** Whether the empty place is compact, which its parts read to size themselves. */
const Compact = createContext(false)

/**
 * The empty place, centered in the room it fills. `compact` is for a short one, such as VS Code's bottom panel a few
 * rows tall, where shadcn's padding and title alone would take the room: it draws them smaller, as its parts do.
 */
export function Empty({ compact = false, className, ...rest }: HTMLAttributes<HTMLDivElement> & { compact?: boolean }) {
  return (
    <Compact.Provider value={compact}>
      <div className={cx("flex w-full min-w-0 flex-1 flex-col items-center justify-center rounded-2xl text-center", compact ? "p-4" : "p-12", className)} {...rest} />
    </Compact.Provider>
  )
}

/** The icon, title, and description, in a column narrow enough to read at a glance. */
export function EmptyHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("flex max-w-sm flex-col items-center", className)} {...rest} />
}

const MEDIA = {
  plain: "bg-transparent",
  icon: "size-10 rounded-xl bg-muted text-foreground [&_svg]:size-5",
}

/** What heads the empty place: an icon on a tile of its own, or anything else as it is. */
export function EmptyMedia({ variant = "plain", className, ...rest }: HTMLAttributes<HTMLDivElement> & { variant?: keyof typeof MEDIA }) {
  const compact = useContext(Compact)
  return <div className={cx("flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0", compact ? "mb-3" : "mb-4", MEDIA[variant], className)} {...rest} />
}

export function EmptyTitle({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const compact = useContext(Compact)
  return <div className={cx("font-medium", compact ? "text-base" : "text-lg tracking-tight", className)} {...rest} />
}

export function EmptyDescription({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const compact = useContext(Compact)
  return <div className={cx("leading-relaxed text-muted-foreground", compact ? "mt-1 text-xs" : "mt-2 text-sm", className)} {...rest} />
}

/** What to do about it, such as a button, under the description. */
export function EmptyContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const compact = useContext(Compact)
  return <div className={cx("flex w-full min-w-0 max-w-sm flex-col items-center", compact ? "mt-3 text-xs" : "mt-4 text-sm", className)} {...rest} />
}
