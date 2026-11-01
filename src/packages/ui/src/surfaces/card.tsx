import type { HTMLAttributes, Ref } from "react"

import { cx } from "../lib/cx.ts"

export type CardProps = HTMLAttributes<HTMLDivElement> & { flush?: boolean; ref?: Ref<HTMLDivElement> }

/** A surface of the app. `flush` drops its space above and below and between what it holds, for rows that reach its edges. */
export function Card({ flush, className, ...rest }: CardProps) {
  return <div className={cx("flex flex-col overflow-hidden rounded-4xl bg-card text-sm text-card-foreground shadow-md ring-1 ring-foreground/10", !flush && "space-y-5 py-5", className)} {...rest} />
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-5", className)} {...rest} />
}
