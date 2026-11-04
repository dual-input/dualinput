// A section of the Settings tab: a heading over a card, whose rows reach its edges. A part's section draws with these, so
// it looks like the platform's (record/areas/interface/decisions.md, "The Settings tab").

import { Card, cx, Fades } from "@dualinput/ui"
import type { ReactNode, Ref } from "react"

export function Section({ title, aside, foot, at, children }: { title: string; aside?: ReactNode; foot?: ReactNode; at?: Ref<HTMLElement>; children: ReactNode }) {
  return (
    <section ref={at} className="flex flex-col">
      <Fades className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside && <span className="text-xs tabular-nums text-muted-foreground">{aside}</span>}
      </Fades>
      {children}
      {foot && (
        <Fades className="mt-2.5 px-1">
          <p className="text-xs text-muted-foreground">{foot}</p>
        </Fades>
      )}
    </section>
  )
}

/** The card's rows reach its edges, 20px in, each with room above and below of its own. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card flush>
      <div className="py-2">{children}</div>
    </Card>
  )
}

/** A row with its control at the right, 36px tall, as a switch's row is. */
export function Row({ label, note, tone, children }: { label: ReactNode; note?: ReactNode; tone?: string; children?: ReactNode }) {
  return (
    <div className={cx("flex min-h-8 items-center px-5", note ? "py-1.5" : "py-0.5")}>
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        {label}
        {note && <span className={cx("mt-0.5 text-xs", tone ?? "text-muted-foreground")}>{note}</span>}
      </span>
      {children && <span className="ml-3 flex shrink-0 items-center">{children}</span>}
    </div>
  )
}
