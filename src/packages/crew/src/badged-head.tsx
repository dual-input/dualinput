// A pilot's head with a badge at its lower right, for a row of every pilot in preflight: an empty ring while the
// countdown waits on them, green filling it from the middle once they're ready, and a red cross while they're out
// of the flight.

import { cx } from "@dualinput/ui"
import { Check, X } from "lucide-react"
import type { HTMLAttributes } from "react"

import { Head } from "./heads/head.tsx"

export type HeadState = "ready" | "out" | "waiting"

const SAYS: Record<HeadState, string> = { ready: "ready", out: "out of the flight", waiting: "not ready" }
const FILL_MS = 220
const BADGE = "absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-card"

export type BadgedHeadProps = HTMLAttributes<HTMLSpanElement> & {
  pilot: string
  name: string
  state: HeadState | undefined
  /** Watches the cursor, as heads on the EFB's session page do. */
  alive?: boolean
  /** Turns its back to us as the card's fold docks it. */
  turns?: boolean
  /** Goes on the badge, which a card's fold fades apart from the head. */
  badge?: HTMLAttributes<HTMLSpanElement>
}

export function BadgedHead({ pilot, name, state, alive, turns, badge, className, ...rest }: BadgedHeadProps) {
  const ready = state === "ready"
  return (
    <span aria-label={state ? `${name}, ${SAYS[state]}` : name} className={cx("relative inline-flex", className)} {...rest}>
      <Head pilot={pilot} alive={alive} turns={turns} slumped={state === "out"} />
      {state === "out" && (
        <span {...badge} className={cx(BADGE, "bg-destructive text-destructive-foreground")}>
          <X className="size-2.5" strokeWidth={3} />
        </span>
      )}
      {(state === "waiting" || ready) && (
        <span {...badge} className={cx(BADGE, "bg-card text-success-foreground")}>
          <span className="absolute inset-x-0 inset-y-0 rounded-full border border-muted-foreground" />
          <span className="absolute inset-x-0 inset-y-0 rounded-full bg-success" style={{ transform: ready ? "none" : "scale(0)", transition: `transform ${FILL_MS}ms ease-out` }} />
          <Check className="relative size-2.5" strokeWidth={3} style={{ opacity: ready ? 1 : 0, transition: `opacity ${FILL_MS}ms ease-out` }} />
        </span>
      )}
    </span>
  )
}
